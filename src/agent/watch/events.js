// v0.1.4.12 (part C): the listeners of the watch server. They feed the pure watchers of events_logic.js from the
// bot and the agent, and collect the chat lines for the chat tool:
//   chat lines: bot.on('chat'), bot.on('whisper') for the players; agent.openChat wrapped for the lines of the bot
//     (agent.say / sayText of the packs and the reflexes ends there too); agent.handleMessage wrapped for the
//     last line of a player (the last order of the state tool)
//   explosion: the packet `explosion` of bot._client (x, y, z) against the saved areas (agent.area_store)
//   health: bot.on('health'); death: bot.on('death'); night_awake: bot.on('time') and bot.on('sleep')
//   failure_repeated: agent.repeat_guard.record wrapped (the results of the commands, with repeat_guard on);
//     without a repeat guard the lines of the bot that read as a failure (looksLikeFailure)
//   far_from_home and job_stalled every 5 s, animals_missing once a minute (agent.area_store, bot.entities)
// startListeners returns stop(), which removes every listener, the timer and the wrappers. Nothing here throws.
// v0.1.4.13 (part S): help: a line of the bot that asks the player (HELP_PATTERNS), with settings.supervisor_name
//   set; report: every watch_report_seconds the digest since the last report (digest_logic); the tick lag from
//   bot.on('time') for the server tool (watch.tickLag).
import settingsOfAgent from '../settings.js';
import { looksLikeFailure, READ_ONLY_COMMANDS } from '../repeat_guard.js';
import { recallHome } from '../packs/home/context.js';
import {
    EVENT_RULES, createAnimalsWatch, createFailureWatch, createHealthWatch, createHomeWatch, createJobWatch, createNightWatch,
    createTickLagWatch, deathEvent, explosionEvent, helpEvent, reportEvent,
} from './events_logic.js';
import { digestLines, snapshotOf } from './digest_logic.js';

export const TICK_MS = 5000;

function warn(what, error) {
    try {
        console.warn(`Watch server: ${what}:`, error?.message ?? error);
    } catch {
        // nothing to do
    }
}

function resultText(result) {
    if (typeof result === 'string')
        return result.replace(/^Action output:\s*/, '');
    if (result !== null && typeof result === 'object')
        return typeof result.message === 'string' ? result.message : (typeof result.text === 'string' ? result.text : '');
    return '';
}

// failed as the repeat guard decides it: the caller's word, else ok/success of an object, else the text
function failedOf(result, failed) {
    if (typeof failed === 'boolean')
        return failed;
    if (result !== null && typeof result === 'object') {
        for (const key of ['ok', 'success']) {
            if (typeof result[key] === 'boolean')
                return !result[key];
        }
    }
    return looksLikeFailure(resultText(result));
}

/**
 * Starts the listeners.
 * @param {object} agent
 * @param {object} watch the state of the server: chat (Ring), lastSpeaker, lastLine, now()
 * @param {(event: object|null) => void} push takes an event into the ring and the streams
 * @param {{tickMs?: number, animalsEveryMs?: number, reportMs?: number}} [options] for tests; reportMs: the report
 *   every this many ms instead of settings.watch_report_seconds
 * @returns {() => void} stop
 */
export function startListeners(agent, watch, push, options = {}) {
    const undo = [];
    const now = () => (typeof watch?.now === 'function' ? watch.now() : Date.now());
    const settings = () => watch?.settings ?? settingsOfAgent;
    const emit = (event) => {
        try {
            if (event)
                push(event);
        } catch (error) {
            warn('could not keep an event', error);
        }
    };
    const bot = agent?.bot;
    const name = () => agent?.name || bot?.username || 'The bot';
    const pos = () => bot?.entity?.position ?? null;
    const dimension = () => bot?.game?.dimension;
    const areas = () => {
        try {
            return agent?.area_store?.list?.() ?? [];
        } catch {
            return [];
        }
    };
    const on = (emitter, event, fn) => {
        if (typeof emitter?.on !== 'function')
            return;
        const safe = (...args) => {
            try {
                fn(...args);
            } catch (error) {
                warn(`the ${event} listener failed`, error);
            }
        };
        emitter.on(event, safe);
        undo.push(() => (emitter.off ?? emitter.removeListener)?.call(emitter, event, safe));
    };
    const wrap = (target, key, make) => {
        if (!target || typeof target[key] !== 'function')
            return;
        const own = Object.prototype.hasOwnProperty.call(target, key);
        const original = target[key];
        target[key] = make(original);
        undo.push(() => {
            if (own)
                target[key] = original;
            else
                delete target[key];
        });
    };
    const chatLine = (who, text) => {
        if (typeof text !== 'string' || text === '')
            return;
        watch.chat?.push?.({ t: now(), name: who, text });
    };

    const healthWatch = createHealthWatch();
    const nightWatch = createNightWatch();
    const animalsWatch = createAnimalsWatch();
    const jobWatch = createJobWatch();
    const failureWatch = createFailureWatch();
    const homeWatch = createHomeWatch();
    const guard = agent?.repeat_guard ?? null;
    const readOnly = new Set(READ_ONLY_COMMANDS);

    // the chat
    const playerLine = (username, message) => {
        if (typeof username !== 'string' || username === '' || username === bot?.username || username === agent?.name)
            return; // the lines of the bot come through openChat
        chatLine(username, message);
        watch.lastSpeaker = username;
    };
    on(bot, 'chat', playerLine);
    on(bot, 'whisper', playerLine);
    wrap(agent, 'openChat', (original) => function (message, ...rest) {
        try {
            chatLine(name(), message);
            if (!guard && typeof message === 'string')
                emit(failureWatch.record(message, looksLikeFailure(message), now()));
            if (typeof message === 'string')
                emit(helpEvent(message, settings()?.supervisor_name, now())); // v0.1.4.13 (S): null without a supervisor
        } catch (error) {
            warn('could not note a line of the bot', error);
        }
        return original.call(this, message, ...rest);
    });
    wrap(agent, 'handleMessage', (original) => function (source, message, ...rest) {
        try {
            if (typeof source === 'string' && source !== 'system' && source !== agent?.name && typeof message === 'string' && message !== '')
                watch.lastLine = { text: message, by: source, at: now() };
        } catch (error) {
            warn('could not note the last line', error);
        }
        return original.call(this, source, message, ...rest);
    });
    if (guard)
        wrap(guard, 'record', (original) => function (command, args, result, failed, ...rest) {
            const answer = original.call(this, command, args, result, failed, ...rest);
            try {
                const clean = typeof command === 'string' ? (command.startsWith('!') ? command : `!${command}`) : '';
                if (clean !== '' && !readOnly.has(clean))
                    emit(failureWatch.record(resultText(result), failedOf(result, failed), now()));
            } catch (error) {
                warn('could not count a failure', error);
            }
            return answer;
        });

    // the facts of the bot
    on(bot?._client, 'explosion', (packet) => emit(explosionEvent(packet, areas(), dimension(), now())));
    if (Number.isFinite(bot?.health))
        healthWatch.update(bot.health, pos(), now());
    on(bot, 'health', () => emit(healthWatch.update(bot.health, pos(), now())));
    on(bot, 'death', () => emit(deathEvent(name(), pos(), now())));
    on(bot, 'sleep', () => nightWatch.slept());
    const tickLag = createTickLagWatch();
    if (watch && typeof watch === 'object')
        watch.tickLag = tickLag;
    on(bot, 'time', () => {
        tickLag.update(now());
        emit(nightWatch.update(bot.time?.timeOfDay, bot.isSleeping === true, now()));
    });

    // the timer
    const tickMs = Number.isFinite(options.tickMs) && options.tickMs > 0 ? options.tickMs : TICK_MS;
    const animalsEveryMs = Number.isFinite(options.animalsEveryMs) && options.animalsEveryMs > 0 ? options.animalsEveryMs : EVENT_RULES.animalsEveryMs;
    let lastAnimals = now(); // the first count a minute after the start, when the entities around the bot are known
    const tick = () => {
        const t = now();
        const here = pos();
        try {
            emit(homeWatch.check(name(), here, dimension(), recallHome({ places: agent?.memory_bank }), t));
        } catch (error) {
            warn('could not check the distance to home', error);
        }
        try {
            const job = agent?.job?.get?.() ?? null;
            if (job)
                emit(jobWatch.check(job, agent.job.status?.() ?? '', t));
        } catch (error) {
            warn('could not check the job', error);
        }
        if (t - lastAnimals >= animalsEveryMs) {
            lastAnimals = t;
            try {
                const entities = Object.values(bot?.entities ?? {}).map((e) => ({ name: e?.name, position: e?.position }));
                for (const event of animalsWatch.check(areas(), entities, here, dimension(), t))
                    emit(event);
            } catch (error) {
                warn('could not count the animals of the pens', error);
            }
        }
    };
    const timer = setInterval(tick, tickMs);
    timer.unref?.();
    undo.push(() => clearInterval(timer));

    // v0.1.4.13 (S): the report every watch_report_seconds (0: none): the digest since the last report
    const seconds = Number(settings()?.watch_report_seconds);
    const reportMs = Number.isFinite(options.reportMs) && options.reportMs > 0 ? options.reportMs : (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0);
    if (reportMs > 0) {
        let lastReport = null;
        const report = () => {
            try {
                const current = snapshotOf(agent, watch);
                const lines = lastReport ? digestLines(lastReport, current, { cursor: 0, chat: watch?.chat, events: watch?.events }).slice(1) : [];
                lastReport = current;
                emit(reportEvent(lines, now()));
                if (Number.isFinite(watch?.events?.total))
                    lastReport.eventIndex = watch.events.total; // the report is no news of the next report
            } catch (error) {
                warn('could not make the report', error);
            }
        };
        try {
            lastReport = snapshotOf(agent, watch);
        } catch {
            lastReport = null;
        }
        const reporter = setInterval(report, reportMs);
        reporter.unref?.();
        undo.push(() => clearInterval(reporter));
    }

    let stopped = false;
    return () => {
        if (stopped)
            return;
        stopped = true;
        for (const fn of undo.reverse()) {
            try {
                fn();
            } catch (error) {
                warn('could not remove a listener', error);
            }
        }
    };
}
