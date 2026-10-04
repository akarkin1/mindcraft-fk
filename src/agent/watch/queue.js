// v0.1.4.13 (part S): the command queue of the run tool (spec 4.1). The commands of a run call are handed to
// agent.handleMessage(owner, text) one after the other, each after the previous one's result: the result of
// a command of a pack is the entry of agent.running_commands (its `pack`: { ok, reason, text }), the result of
// any command is the last line the agent routed to the owner while it ran (agent.routeResponse, wrapped). A
// result that is a failure stops the queue when stop_on_failure. A skill that ran 2 s without a failure
// counts as started for the answer; the next command is still handed only after it ended, so nothing of the
// queue ever cancels a running command. While the queue runs, a `!command` of the owner other than `!stop`
// is queued behind it (agent.handleMessage, wrapped); `!stop` empties the queue and runs. The answer of a
// run call comes when its commands are done or stopped, at most 55 s after the call. Nothing here throws.
import { looksLikeFailure } from '../repeat_guard.js';
import { TEXTS } from './texts.js';

export const QUEUE_RULES = Object.freeze({
    answerMs: 55000,     // the answer of run at the latest
    longSkillMs: 2000,   // a skill that ran this long without a failure counts as started
    pollMs: 50,          // the entry of the command is looked for this often
    commandsMax: 10,
});

// v0.1.4.13 (T1-run-long, the lead): the long skills of spec 4.1 that count as started after longSkillMs; every
// other command answers with its result
export const LONG_SKILLS = Object.freeze(['!mineOre', '!farmCycle', '!followPlayer']);

/** True for a command text whose command is one of LONG_SKILLS. */
export function isLongSkill(text) {
    const name = typeof text === 'string' ? /^\s*(!\w+)/.exec(text)?.[1] : null;
    return Boolean(name) && LONG_SKILLS.includes(name);
}

// the failure texts of the spec, at the start of a line of the output
export const FAILURE_STARTS = Object.freeze([/^Failed\b/, /^I could not\b/, /^I cannot\b/, /^Path not found\b/]);

/** True for a text that is a `!command(...)` and nothing else. */
export function isCommandText(text) {
    return typeof text === 'string' && /^\s*!\w+\s*(\(.*\))?\s*$/s.test(text);
}

/** True for `!stop`. */
export function isStopCommand(text) {
    return typeof text === 'string' && /^\s*!stop\b/.test(text);
}

/** True for the echo of a typed command, `*MartyByrde2 used mineOre*`. */
export function isCommandEcho(text) {
    return typeof text === 'string' && /^\*\S+ used \w+\*$/.test(text.trim());
}

/**
 * True when the result of a command is a failure of the skill: `{ ok: false }` of the pack, or a line of the
 * output that starts with Failed, I could not, I cannot, Path not found, or a text the repeat guard reads as a
 * failure.
 * @param {{ok?: boolean}|null} pack the pack result of the entry of agent.running_commands
 * @param {string} text the output
 */
export function isFailureResult(pack, text) {
    if (pack && pack.ok === false)
        return true;
    if (typeof text !== 'string' || text.trim() === '')
        return false;
    for (const line of text.split(/\r?\n/)) {
        const clean = line.trim();
        if (FAILURE_STARTS.some((pattern) => pattern.test(clean)))
            return true;
    }
    return looksLikeFailure(text);
}

/**
 * The refusal of the arguments of run, or null: commands an array of 1 to 10 strings, each a `!command`.
 * @param {object} args
 * @returns {string|null}
 */
export function runRefusal(args = {}) {
    const commands = args?.commands;
    if (!Array.isArray(commands) || commands.length < 1 || commands.length > QUEUE_RULES.commandsMax)
        return TEXTS.badCommands;
    if (commands.some((c) => typeof c !== 'string' || c.trim() === ''))
        return TEXTS.badCommands;
    if (commands.some((c) => !isCommandText(c)))
        return TEXTS.commandsOnly;
    return null;
}

/**
 * The answer of a run call from the record of its batch. Pure.
 * @param {{items: Array<{text: string, status: string, result: string}>, stopped: {by: string|null, at: number}|null}} batch
 *   status: waiting, running, done, started, failed, skipped; stopped.at: the number (1-based) of the command
 *   the queue stopped at; stopped.by: the player of `!stop`, null for the stop rule
 * @returns {string}
 */
export function runAnswer(batch) {
    const items = Array.isArray(batch?.items) ? batch.items : [];
    const total = items.length;
    const withLine = items.filter((item) => item.status === 'done' || item.status === 'started' || item.status === 'failed');
    const out = [TEXTS.ran(withLine.length, total)];
    items.forEach((item, i) => {
        if (item.status === 'done' || item.status === 'failed')
            out.push(TEXTS.ranLine(i + 1, item.text, item.result === '' ? 'done' : item.result));
        else if (item.status === 'started')
            out.push(TEXTS.ranLine(i + 1, item.text, TEXTS.runStarted));
    });
    if (batch?.stopped) {
        out.push(batch.stopped.by ? TEXTS.stoppedBy(batch.stopped.by, batch.stopped.at, total) : TEXTS.stoppedAt(batch.stopped.at, total));
        return out.join('\n');
    }
    const running = items.findIndex((item) => item.status === 'running');
    if (running >= 0)
        out.push(TEXTS.stillRunning(running + 1, total));
    return out.join('\n');
}

function warn(what, error) {
    try {
        console.warn(`Watch queue: ${what}:`, error?.message ?? error);
    } catch {
        // nothing to do
    }
}

/**
 * The queue of the run tool, one per watch server.
 * @param {object} agent
 * @param {{now?: () => number, answerMs?: number, longSkillMs?: number, pollMs?: number}} [options] for tests
 * @returns {{run: Function, isActive: () => boolean, size: () => number, close: () => void}}
 */
export function createQueue(agent, options = {}) {
    const now = typeof options?.now === 'function' ? options.now : () => Date.now();
    const answerMs = Number.isFinite(options?.answerMs) && options.answerMs > 0 ? options.answerMs : QUEUE_RULES.answerMs;
    const longSkillMs = Number.isFinite(options?.longSkillMs) && options.longSkillMs > 0 ? options.longSkillMs : QUEUE_RULES.longSkillMs;
    const pollMs = Number.isFinite(options?.pollMs) && options.pollMs > 0 ? options.pollMs : QUEUE_RULES.pollMs;
    const items = []; // waiting, oldest first
    const seenEntries = new WeakSet();
    const batches = new Set(); // batches that wait for their answer
    let current = null; // the item that runs
    let closed = false;

    // the inner handleMessage: the one the queue's own commands go through
    const innerHandle = typeof agent?.handleMessage === 'function' ? agent.handleMessage : null;
    const ownHandle = agent && Object.prototype.hasOwnProperty.call(agent, 'handleMessage');
    const innerRoute = typeof agent?.routeResponse === 'function' ? agent.routeResponse : null;
    const ownRoute = agent && Object.prototype.hasOwnProperty.call(agent, 'routeResponse');

    const isActive = () => current !== null || items.length > 0;
    const botName = () => agent?.name || agent?.bot?.username || '';
    const isPlayer = (source) => typeof source === 'string' && source !== '' && source !== 'system' && source !== botName();

    const settleBatch = (batch) => {
        if (!batches.has(batch))
            return;
        const open = batch.items.some((item) => item.status === 'waiting' || item.status === 'running');
        if (open && !batch.stopped)
            return;
        answerBatch(batch);
    };
    const answerBatch = (batch) => {
        if (!batches.has(batch))
            return;
        batches.delete(batch);
        clearTimeout(batch.timer);
        try {
            batch.resolve(runAnswer(batch));
        } catch (error) {
            warn('could not answer a run call', error);
        }
    };

    const stopRest = (fromBatch, by, at) => {
        // the stop rule (by null) empties the rest of fromBatch; !stop of a player (by) empties everything
        for (let i = items.length - 1; i >= 0; i--) {
            const item = items[i];
            if (by === null && item.batch !== fromBatch)
                continue;
            item.status = 'skipped';
            items.splice(i, 1);
        }
        for (const batch of [...batches]) {
            if (by === null && batch !== fromBatch)
                continue;
            if (batch.stopped)
                continue;
            if (batch === fromBatch)
                batch.stopped = { by, at };
            else {
                const first = batch.items.findIndex((item) => item.status === 'skipped' || item.status === 'running');
                batch.stopped = { by, at: first >= 0 ? first + 1 : batch.items.length };
            }
            settleBatch(batch);
        }
    };

    const finishItem = (item, status, result) => {
        if (item.status !== 'running' && item.status !== 'started')
            return;
        item.status = status;
        item.result = result;
        current = null;
        clearInterval(item.poll);
        clearTimeout(item.longTimer);
        const batch = item.batch;
        if (status === 'failed' && batch && batch.stopOnFailure && !batch.stopped)
            stopRest(batch, null, batch.items.indexOf(item) + 1);
        if (batch)
            settleBatch(batch);
        pump();
    };

    const runItem = (item) => {
        current = item;
        item.status = 'running';
        item.captured = [];
        item.entry = null;
        item.startedAt = now();
        const findEntry = () => {
            if (item.entry)
                return;
            const list = Array.isArray(agent?.running_commands) ? agent.running_commands : [];
            for (let i = list.length - 1; i >= 0; i--) {
                const entry = list[i];
                if (entry && typeof entry === 'object' && !seenEntries.has(entry) && entry.by === item.by) {
                    seenEntries.add(entry);
                    item.entry = entry;
                    return;
                }
            }
        };
        item.poll = setInterval(findEntry, pollMs);
        item.poll.unref?.();
        item.longTimer = !isLongSkill(item.text) ? null : setTimeout(() => {
            if (item.status !== 'running')
                return;
            findEntry();
            const failedEarly = item.captured.some((line) => isFailureResult(null, line)) || item.entry?.pack?.ok === false;
            if (failedEarly)
                return; // the end comes with the result
            item.status = 'started';
            item.result = TEXTS.runStarted;
            if (item.batch)
                settleBatch(item.batch);
        }, longSkillMs);
        item.longTimer?.unref?.();
        let handed;
        try {
            handed = innerHandle ? Promise.resolve(innerHandle.call(agent, item.by, item.text)) : Promise.reject(new Error('the agent has no handleMessage'));
        } catch (error) {
            handed = Promise.reject(error);
        }
        handed.then(() => {
            findEntry();
            const pack = item.entry?.pack ?? null;
            const last = item.captured.length > 0 ? item.captured[item.captured.length - 1] : '';
            const text = typeof pack?.text === 'string' && pack.text !== '' ? pack.text : last;
            const failed = isFailureResult(pack, text) || (!pack && item.captured.some((line) => isFailureResult(null, line)));
            const stopped = pack?.reason === 'interrupted';
            finishItem(item, failed ? 'failed' : 'done', text !== '' ? text : (stopped ? 'stopped' : ''));
        }, (error) => {
            finishItem(item, 'failed', TEXTS.runFailed(error?.message ?? String(error)));
        });
    };

    const pump = () => {
        if (closed || current !== null || items.length === 0)
            return;
        const item = items.shift();
        try {
            runItem(item);
        } catch (error) {
            warn('could not run a command', error);
            finishItem(item, 'failed', TEXTS.runFailed(error?.message ?? String(error)));
        }
    };

    const enqueue = (texts, by, batchOptions) => {
        const batch = { items: [], stopOnFailure: batchOptions?.stopOnFailure !== false, stopped: null, resolve: null, timer: null, answers: batchOptions?.answers === true };
        for (const text of texts) {
            const item = { text: String(text).trim(), by, batch, status: 'waiting', result: '' };
            batch.items.push(item);
            items.push(item);
        }
        return batch;
    };

    // the wrappers: the owner's commands behind the queue, the lines of the agent as results
    if (agent && innerHandle) {
        agent.handleMessage = function (source, message, ...rest) {
            try {
                if (isActive() && isPlayer(source) && isCommandText(message)) {
                    if (isStopCommand(message)) {
                        stopRest(null, source, current ? current.batch.items.indexOf(current) + 1 : 0);
                    } else {
                        enqueue([message], source, { stopOnFailure: false });
                        const ahead = items.length - 1 + (current ? 1 : 0);
                        try {
                            // innerRoute, not the wrapper: the line is no result of the command that runs
                            Promise.resolve(innerRoute?.call(agent, source, TEXTS.queued(ahead))).catch(() => {});
                        } catch {
                            // the line could not be said
                        }
                        return Promise.resolve(true);
                    }
                }
            } catch (error) {
                warn('could not queue a line', error);
            }
            return innerHandle.call(this, source, message, ...rest);
        };
    }
    if (agent && innerRoute) {
        agent.routeResponse = function (to, message, ...rest) {
            try {
                if (current && typeof message === 'string' && message !== '' && !isCommandEcho(message))
                    current.captured.push(message);
            } catch {
                // the line is routed anyway
            }
            return innerRoute.call(this, to, message, ...rest);
        };
    }

    return {
        /**
         * Runs the commands as the owner and answers when they are done or stopped, at most answerMs later.
         * @param {string[]} commands
         * @param {{by: string, stopOnFailure?: boolean}} runOptions by: the owner's name
         * @returns {Promise<string>}
         */
        run(commands, runOptions = {}) {
            return new Promise((resolve) => {
                const batch = enqueue(commands, runOptions?.by ?? 'watcher', { stopOnFailure: runOptions?.stopOnFailure, answers: true });
                batch.resolve = resolve;
                batches.add(batch);
                batch.timer = setTimeout(() => answerBatch(batch), answerMs);
                batch.timer.unref?.();
                pump();
            });
        },
        isActive,
        size: () => items.length + (current ? 1 : 0),
        /** The items that wait and the one that runs, for the digest and the tests. */
        pending: () => (current ? [current, ...items] : [...items]).map((item) => ({ text: item.text, by: item.by, status: item.status })),
        close() {
            if (closed)
                return;
            closed = true;
            for (const item of items)
                item.status = 'skipped';
            items.length = 0;
            if (current) {
                clearInterval(current.poll);
                clearTimeout(current.longTimer);
                const batch = current.batch;
                if (current.status === 'running') {
                    current.status = 'skipped';
                    if (batch && !batch.stopped)
                        batch.stopped = { by: null, at: batch.items.indexOf(current) + 1 };
                }
                current = null;
            }
            for (const batch of [...batches])
                answerBatch(batch);
            if (agent) {
                if (innerHandle) {
                    if (ownHandle)
                        agent.handleMessage = innerHandle;
                    else
                        delete agent.handleMessage;
                }
                if (innerRoute) {
                    if (ownRoute)
                        agent.routeResponse = innerRoute;
                    else
                        delete agent.routeResponse;
                }
            }
        },
    };
}
