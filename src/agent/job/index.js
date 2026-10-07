// The job on the agent (spec v0.1.4.10, I4): createJob(agent, store, options) gives the object that the
// glue keeps as agent.job when job_memory is on. The glue calls onCommand before and onResult after every
// command, tick every 5 s, onRestart at spawn and status for the knowledge block. Every method returns
// { ok, reason, text } (status a string) and never throws. The model is called only in plan.
//
// The decisions of the spec, section 5: a job command of the player or of the model starts the job, an
// errand changes nothing, !stop and !endGoal end it. A system order (by 'system': the resumed command, a
// step, an entry of idle_jobs) never starts or ends a job. tick runs the next step, else the resumed
// command, else the next entry of idle_jobs, through options.executeCommand(text, { by: 'system', typed:
// false }); when the glue gives no onResult for that order, tick gives it with the returned value.
import { isNight } from '../packs/home/night_logic.js';
import { reflexOn } from '../packs/home/home_settings.js';
import {
    JOB_RULES, JOB_SKILL_ROLES, OVERRIDABLE_ACTIONS, cleanCommandName, endsJob, isDone, jobOf, nextIdleJob, progress, readJobSettings,
    refusedWhileRunning, resultOf, resumeCommand, sameWork, shouldResume, blockerOf,
} from './job_logic.js';
import { PLAN_COMMANDS, PLAN_COMMAND_NAMES, WAY_OUT_COMMAND, needsSurface, planPrompt, parsePlan, stepDone } from './plan_logic.js';
import {
    busyText, doneText, idleStartText, leaveText, noJobText, noPlanText, planText, restartText, resumeText, statusText, stepStartText, stepText,
    stopText,
} from './job_texts.js';

// v0.1.4.13 fix 2: a failure of these words with nothing gained pauses the job at once
const STUCK_FAILURE = /\b(got stuck|find no way|found no way|no way from|could not get to|could not reach)\b/i;

export { JobStore, JOB_FILE } from './job_store.js';

// The commands that run at the same time are few; older entries without a result are dropped.
const MAX_ROLES = 32;

function result(ok, reason = null, text = '') {
    return { ok, reason, text };
}

function errorResult(where, error) {
    console.warn(`The job could not ${where}:`, error?.message ?? error);
    return result(false, 'error', `The job could not ${where}: ${error?.message ?? error}`);
}

function isActive(job) {
    return job !== null && typeof job === 'object' && (job.state === 'running' || job.state === 'paused');
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

// v0.1.4.13 (P5): the skill reported its own count during this run (the entry, or the system order behind it).
function reportedOf(entry) {
    return entry?.reported === true || entry?.sys?.reported === true;
}

// The default readers of the state of the bot; each never throws.
function defaultReaders(agent, settings) {
    const safe = (fn, fallback) => () => {
        try {
            return fn();
        } catch {
            return fallback;
        }
    };
    return {
        say: (text) => {
            try {
                if (typeof agent?.sayText === 'function') {
                    agent.sayText(text);
                } else {
                    agent?.openChat?.(text);
                }
            } catch (error) {
                console.warn('The job could not say:', error?.message ?? error);
            }
        },
        inventory: safe(() => {
            const out = {};
            for (const item of agent?.bot?.inventory?.items?.() ?? []) {
                if (item && typeof item.name === 'string') {
                    out[item.name] = (out[item.name] ?? 0) + (Number.isFinite(item.count) ? item.count : 0);
                }
            }
            return out;
        }, {}),
        // an action runs (an endless follow does not count), or the model works on its own goal
        actionRunning: safe(() => {
            const actions = agent?.actions;
            const busy = actions?.executing === true && !OVERRIDABLE_ACTIONS.includes(actions.currentActionLabel);
            return busy || agent?.self_prompter?.isActive?.() === true;
        }, false),
        sleeping: safe(() => agent?.bot?.isSleeping === true, false),
        night: safe(() => isNight(agent?.bot?.time?.timeOfDay), false),
        nightShelter: safe(() => {
            if (!reflexOn(settings, 'night_shelter')) {
                return false;
            }
            const modes = agent?.bot?.modes;
            return typeof modes?.isOn === 'function' ? modes.isOn('night_shelter') !== false : true;
        }, false),
        underground: safe(() => agent?.whereAmI?.()?.underground === true, false),
        // for the plan prompt (T3-1): where the bot is, its position, the chests of the chest index of this world
        where: safe(() => agent?.whereAmI?.() ?? null, null),
        position: safe(() => {
            const pos = agent?.bot?.entity?.position;
            return pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
        }, null),
        chests: safe(() => {
            const index = agent?._workStores?.()?.chests ?? null;
            return typeof index?.list === 'function' ? index.list(agent?.bot?.game?.dimension) : null;
        }, null),
    };
}

/**
 * The job of the agent (I4).
 * @param {object} agent the agent: sayText, bot (inventory, time, isSleeping, modes), actions, whereAmI,
 *   self_prompter; each read only when the option of the same name is not given
 * @param {JobStore} store the store of bots/<name>/job.json; load() is called here
 * @param {{settings?: object, now?: () => number, executeCommand?: (text: string, options: object) => Promise<*>,
 *   askModel?: (prompt: string) => Promise<string>, say?: (text: string) => void, inventory?: () => object,
 *   actionRunning?: () => boolean, sleeping?: () => boolean, night?: () => boolean, nightShelter?: () => boolean,
 *   underground?: () => boolean, where?: () => object|null, position?: () => object|null, chests?: () => object[]|null}} [options]
 *   settings: read again at every tick (job_resume_seconds, idle_jobs, idle_jobs_minutes, home_reflexes); now:
 *   milliseconds; executeCommand: runs a command text as a system order; askModel: the call of the model for a
 *   plan (purpose 'plan' of the cost meter); where, position, chests: for the plan prompt (whereAmI, the feet
 *   of the bot, the chests { x, y, z, items } of the chest index; null when not known)
 * @returns {object}
 */
export function createJob(agent, store, options = {}) {
    const settings = options?.settings ?? {};
    const now = typeof options?.now === 'function' ? options.now : () => Date.now();
    const readers = defaultReaders(agent, settings);
    const pick = (name) => (typeof options?.[name] === 'function' ? options[name] : readers[name]);
    const say = pick('say');
    const inventory = pick('inventory');
    const actionRunning = pick('actionRunning');
    const sleeping = pick('sleeping');
    const night = pick('night');
    const nightShelter = pick('nightShelter');
    const underground = pick('underground');
    const where = pick('where');
    const position = pick('position');
    const chests = pick('chests');
    const executeCommand = typeof options?.executeCommand === 'function' ? options.executeCommand : null;
    const askModel = typeof options?.askModel === 'function' ? options.askModel : null;

    const nowMs = () => {
        const t = Number(now());
        return Number.isFinite(t) ? t : Date.now();
    };
    const iso = () => new Date(nowMs()).toISOString();
    const call = (fn, fallback) => {
        try {
            return fn();
        } catch {
            return fallback;
        }
    };

    try {
        store?.load?.();
    } catch (error) {
        console.warn('The job could not load its file:', error?.message ?? error);
    }

    const state = {
        lastOrderAt: nowMs(), // the start counts as an order: the bot waits job_resume_seconds first
        roles: [],            // { name, role, started, step } of the commands that run, the newest last
        system: null,         // { name, role, text, started, step, seen } of the order that tick runs
        ticking: false,
        planning: false,
        planned: Promise.resolve(), // the plan that runs, for settled()
        lastRun: {},          // the entries of idle_jobs: command text -> milliseconds
    };

    const getJob = () => call(() => store?.get?.() ?? null, null);
    const setJob = (job) => {
        job.updated = iso();
        return call(() => store?.set?.(job) ?? null, null);
    };
    const speak = (text) => {
        if (typeof text === 'string' && text.length > 0) {
            console.log('Job:', text);
            call(() => say(text), undefined);
        }
        return text;
    };

    // The same failure again: counts it, and pauses the job at the third time. v0.1.4.13 fix 2: the same failure
    // with other numbers (a position, a length) counts as the same; a run that got stuck or found no way and gained
    // nothing pauses the job at once (the play of 2026-10-06: five walks of 150 to 250 blocks to the same "stuck").
    function noteFailure(job, text, gained = false) {
        const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
        const keyOf = (t) => (typeof t === 'string' ? t.replace(/-?\d+(\.\d+)?/g, '#') : null);
        job.fails = keyOf(job.failText) === keyOf(clean) ? (job.fails ?? 0) + 1 : 1;
        job.failText = clean;
        if (job.fails >= JOB_RULES.maxFails || (!gained && STUCK_FAILURE.test(clean))) {
            job.state = 'paused';
            setJob(job);
            return result(false, 'paused', speak(stopText(job, clean)));
        }
        setJob(job);
        return result(false, 'failed', '');
    }

    function pause(job, text) {
        job.state = 'paused';
        setJob(job);
        return speak(text);
    }

    async function plan(blocker, failText = null) {
        let mine = false; // this call plans (and ends state.planning)
        try {
            let job = getJob();
            if (!job || job.state !== 'running') {
                return result(false, 'no_job', noJobText());
            }
            if (state.planning) {
                return result(false, 'busy', '');
            }
            const b = { kind: blocker?.kind ?? 'no_item', item: typeof blocker?.item === 'string' ? blocker.item : null };
            if ((job.plans ?? 0) >= JOB_RULES.maxPlans || askModel === null) {
                return result(false, 'no_plan', pause(job, noPlanText(b)));
            }
            state.planning = true;
            mine = true;
            job.plans = (job.plans ?? 0) + 1;
            job.blocker = b;
            job.steps = [];
            setJob(job);
            const started = job.started;
            const text = typeof failText === 'string' && failText.length > 0 ? failText : null;
            const context = { where: call(() => where(), null), pos: call(() => position(), null), chests: call(() => chests(), null), mining: call(() => Boolean(settings.mining_pack) && (agent?._workStores?.()?.mines?.list?.(agent?.bot?.game?.dimension)?.length ?? 0) > 0, false) }; // v0.1.4.12 (W105): !mineOre in the prompt only with the mining pack and a known mine
            const prompt = planPrompt(job, text ? { ...b, text } : b, call(() => inventory(), {}), PLAN_COMMANDS, context);
            let answer = null;
            try {
                answer = await askModel(prompt);
            } catch (error) {
                console.warn('The job could not ask the model for a plan:', error?.message ?? error);
            }
            let steps = parsePlan(answer, PLAN_COMMAND_NAMES);
            job = getJob();
            if (!job || job.started !== started || job.state !== 'running') {
                return result(false, 'changed', ''); // a new order came while the model planned
            }
            // v0.1.4.12 (T3-1): a step that repeats the command of the job itself is dropped (the job resumes with its own
            // command after the steps); a plan of nothing else is no plan
            if (Array.isArray(steps) && typeof job.kind === 'string') {
                steps = steps.filter(step => String(step?.command ?? '').match(/^!\w+/)?.[0] !== `!${job.kind}`);
                if (steps.length === 0) {
                    steps = null;
                }
            }
            if (steps === null) {
                return result(false, 'no_plan', pause(job, noPlanText(b)));
            }
            job.steps = steps;
            job.chainAt = iso();
            setJob(job);
            const said = speak(planText(b, steps));
            // v0.1.4.13 (P3): the plan is made; its first step runs at once, in the same call, as a step
            state.planning = false;
            mine = false;
            await startFirstStep(job);
            return result(true, null, said);
        } catch (error) {
            return errorResult('plan', error);
        } finally {
            if (mine) {
                state.planning = false;
            }
        }
    }

    // The index of the next step to run: a step whose check the inventory already meets is done before it runs
    // (v0.1.4.12, T3-1). -1 without a step to do.
    function nextStep(job) {
        const steps = Array.isArray(job.steps) ? job.steps : [];
        let next = steps.findIndex(step => step.state === 'todo');
        while (next >= 0 && Number.isFinite(steps[next]?.check?.count) && stepDone(steps[next], call(() => inventory(), {}), false)) {
            steps[next].state = 'done';
            setJob(job);
            next = steps.findIndex(step => step.state === 'todo');
        }
        return next;
    }

    // Runs the step `next` of the plan as a system order, after the way out of the mine when the step needs the
    // surface and the bot is underground (T3-1); says the step text (P3) when the step starts.
    async function runStep(job, next) {
        const steps = job.steps;
        const command = steps[next].command;
        if (needsSurface(command) && call(() => underground(), false)) {
            const orderAt = state.lastOrderAt;
            const out = await runSystem(WAY_OUT_COMMAND, 'way_out', job);
            const fresh = getJob();
            const same = fresh?.state === 'running' && fresh.started === job.started && fresh.steps?.[next]?.state === 'todo'
                && fresh.steps[next].command === command;
            if (out.reason === 'interrupted' || state.lastOrderAt !== orderAt || !same) {
                return result(true, 'way_out', '');
            }
        }
        speak(stepStartText(next + 1, steps.length, steps[next]));
        return await runSystem(command, 'step', job, next);
    }

    // v0.1.4.13 (P3): the first step of a plan that was just made, at once; tick is busy meanwhile. Never throws.
    async function startFirstStep(planned) {
        if (executeCommand === null || state.ticking) {
            return;
        }
        state.ticking = true;
        try {
            const job = getJob();
            if (!job || job.state !== 'running' || job.started !== planned.started) {
                return;
            }
            const next = nextStep(job);
            if (next >= 0) {
                await runStep(job, next);
            }
        } catch (error) {
            console.warn('The job could not start its plan:', error?.message ?? error);
        } finally {
            state.ticking = false;
        }
    }

    // The result of the command of the job (typed, chosen by the model, or resumed).
    // The plan for a blocker. For a system order (a resumed command, a step) it runs on its own, so that tick
    // never waits for the model; the job waits while it plans (state.planning).
    async function startPlan(blocker, text, detached) {
        const run = plan(blocker, text);
        state.planned = run.then(() => undefined, () => undefined);
        if (!detached) {
            return await run;
        }
        return result(false, 'planning', ''); // plan() set state.planning before it asked the model
    }

    // v0.1.4.13 (P5): when the skill reported its own count (reported), got stays as the skill said it; the gain of
    // the inventory counts only for a skill that did not report.
    async function jobResult(job, r, gain, detached, reported = false) {
        const before = job.got;
        job = reported ? { ...job } : progress(job, gain);
        if (r.reason === 'interrupted') {
            setJob(job);
            return result(true, 'interrupted', '');
        }
        if (r.ok === true || (job.wanted === null && r.ok !== false)) {
            job.skillDone = true;
        }
        if (isDone(job)) {
            job.state = 'done';
            setJob(job);
            return result(true, 'done', speak(doneText(job)));
        }
        const failed = r.ok === false || (r.ok !== true && job.got === before);
        if (!failed) {
            delete job.fails;
            delete job.failText;
            setJob(job);
            return result(true, 'progress', '');
        }
        const blocker = blockerOf(r);
        if (blocker) {
            setJob(job);
            return await startPlan(blocker, r.text, detached);
        }
        return noteFailure(job, r.text, isFiniteNumber(job.got) && isFiniteNumber(before) && job.got > before);
    }

    // The result of a step of the plan.
    async function stepResult(job, index, r, detached) {
        const steps = Array.isArray(job.steps) ? job.steps : [];
        const step = steps[index];
        if (!step || step.state !== 'todo') {
            return result(true, 'none', '');
        }
        if (r.reason === 'interrupted') {
            return result(true, 'interrupted', '');
        }
        if (stepDone(step, call(() => inventory(), {}), r.ok === true || (r.ok === undefined && step.check?.count === null))) {
            step.state = 'done';
            job.chainAt = iso();
            setJob(job);
            return result(true, 'step_done', speak(stepText(index + 1, steps.length, step)));
        }
        step.fails = (Number.isInteger(step.fails) ? step.fails : 0) + 1;
        if (step.fails < JOB_RULES.stepRuns) {
            job.chainAt = iso(); // the step runs once more at the next tick, without the wait
            setJob(job);
            return result(false, 'step_again', '');
        }
        step.state = 'failed';
        setJob(job);
        return await startPlan(job.blocker ?? blockerOf(r) ?? { kind: 'no_item', item: step.check?.item ?? null }, r.text, detached);
    }

    async function handleResult(entry, value, gain) {
        if (entry.role === 'idle' || entry.role === 'other') {
            return result(true, entry.role, '');
        }
        if (entry.role === 'way_out') {
            const r = resultOf(value);
            return result(r.ok !== false, r.reason === 'interrupted' ? 'interrupted' : 'way_out', r.text);
        }
        const job = getJob();
        if (job && job.state === 'left' && job.started === entry.started && (entry.leave === true || entry.sys?.leave === true)) {
            // P5: the leave text deferred at the stop, now with the count the skill reported last
            return result(true, 'ended', speak(leaveText(job)));
        }
        if (!job || job.state !== 'running' || job.started !== entry.started) {
            return result(true, 'none', '');
        }
        const r = resultOf(value);
        if (entry.role === 'step') {
            return await stepResult(job, entry.step, r, true);
        }
        return await jobResult(job, r, gain, entry.role === 'resume', reportedOf(entry));
    }

    // v0.1.4.13 (P5, P6): the entry of the command of the job that runs now, with a role of `roles`: the newest of
    // state.roles for this job, else the system order that tick runs when the glue gave no onCommand for it. null
    // when none runs.
    function runningEntry(job, roles) {
        for (let i = state.roles.length - 1; i >= 0; i--) {
            const entry = state.roles[i];
            if (roles.includes(entry.role) && entry.started === job.started) {
                return entry;
            }
        }
        const s = state.system;
        if (s && !s.done && roles.includes(s.role) && s.started === job.started) {
            return s;
        }
        return null;
    }

    // The order that tick runs now, as the role of the command.
    function pushRole(entry) {
        state.roles.push(entry);
        if (state.roles.length > MAX_ROLES) {
            state.roles.splice(0, state.roles.length - MAX_ROLES);
        }
    }

    function systemEntry(name) {
        const s = state.system;
        if (s && !s.seen && s.name === name) {
            s.seen = true;
            return { name, role: s.role, started: s.started, step: s.step, base: s.base, sys: s };
        }
        return { name, role: 'other', started: null, step: null };
    }

    async function runSystem(text, role, job, stepIndex = null) {
        const name = cleanCommandName(String(text).match(/^!?(\w+)/)?.[1] ?? '');
        // base (P5): what the job had before a resumed command; the skill counts from there
        state.system = { name, role, text, started: job?.started ?? null, step: stepIndex, seen: false, done: false, base: isFiniteNumber(job?.got) ? job.got : 0, reported: false };
        const mine = state.system;
        let value;
        try {
            value = await executeCommand(text, { by: 'system', typed: false });
        } catch (error) {
            value = { ok: false, reason: 'error', text: `${error?.message ?? error}` };
        }
        let out = result(true, role, '');
        if (!mine.done) {
            mine.seen = true;
            mine.done = true;
            state.roles = state.roles.filter(entry => entry.sys !== mine); // an onCommand without its onResult
            out = await handleResult({ name, role, started: mine.started, step: stepIndex }, value, null);
        }
        if (state.system === mine) {
            state.system = null;
        }
        if (role === 'way_out') {
            const r = resultOf(value); // whether the glue gave its onResult or not: the way out was stopped or not
            out = result(r.ok !== false, r.reason === 'interrupted' ? 'interrupted' : 'way_out', r.text);
        }
        return out;
    }

    return {
        /**
         * Before a command runs. A job command of the player or the model starts the job or replaces it (the
         * leave text for a running job of other work); !stop and !endGoal end it (the leave text); an errand
         * and any other command change nothing. A system order changes nothing. While a plan runs, a command
         * of the model that a plan may use is no new job (the model works on the blocker too).
         * @param {string} name
         * @param {Array} args
         * @param {string} by 'player' (or the name of the player), 'model' or 'system'
         * @param {string} [text] the order as typed or as the model gave it
         * @returns {{ok: boolean, reason: string|null, text: string}}
         */
        onCommand(name, args, by, text) {
            try {
                const command = cleanCommandName(name);
                if (command === null) {
                    return result(false, 'no_command', '');
                }
                if (by === 'system') {
                    pushRole(systemEntry(command));
                    return result(true, 'system', '');
                }
                state.lastOrderAt = nowMs();
                const job = getJob();
                if (endsJob(command)) {
                    pushRole({ name: command, role: 'other', started: null, step: null });
                    if (!isActive(job)) {
                        return result(true, 'no_job', '');
                    }
                    const wasRunning = job.state === 'running';
                    // P5 (W109): a skill that counts itself is still running and reports once more when the stop reaches
                    // it; the leave text waits for its result, so that both numbers agree
                    const running = wasRunning ? runningEntry(job, ['job', 'resume']) : null;
                    job.state = 'left';
                    setJob(job);
                    if (running && reportedOf(running)) {
                        running.leave = true;
                        if (running.sys) {
                            running.sys.leave = true;
                        }
                        return result(true, 'ended', '');
                    }
                    return result(true, 'ended', wasRunning ? speak(leaveText(job)) : '');
                }
                const next = jobOf(command, args, { by: by === 'model' ? 'model' : 'player', text, now: iso() });
                const planRuns = job?.state === 'running' && (state.planning || (Array.isArray(job.steps) && job.steps.some(s => s.state === 'todo')));
                if (next === null || (by === 'model' && planRuns && PLAN_COMMAND_NAMES.includes(command))) {
                    pushRole({ name: command, role: 'other', started: null, step: null });
                    return result(true, 'errand', '');
                }
                let said = '';
                if (job?.state === 'running' && !sameWork(job, next)) {
                    said = speak(leaveText(job));
                }
                const saved = setJob(next);
                pushRole({ name: command, role: 'job', started: saved?.started ?? next.started, step: null, base: 0, reported: false });
                return result(true, 'job', said);
            } catch (error) {
                return errorResult('note the command', error);
            }
        },

        /**
         * After a command ran. For the command of the job: the progress, the done text, a blocker (a plan),
         * the same failure 3 times (the job pauses). For a step: done (the step text) or failed (the next
         * plan). Anything else changes nothing.
         * @param {string} name
         * @param {object|string|undefined} value the pack result { ok, reason, text } or the text of the command
         * @param {object|Function|number} [inventoryGainOf] the gain of the inventory while the command ran:
         *   { name: gain } (best), a function item -> gain, or a number
         * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
         */
        async onResult(name, value, inventoryGainOf) {
            try {
                const command = cleanCommandName(name);
                let at = -1;
                for (let i = state.roles.length - 1; i >= 0; i--) {
                    if (state.roles[i].name === command) {
                        at = i;
                        break;
                    }
                }
                let entry;
                if (at >= 0) {
                    entry = state.roles.splice(at, 1)[0];
                } else {
                    entry = systemEntry(command); // the glue gave no onCommand for the system order
                }
                if (entry.sys) {
                    entry.sys.done = true; // the result of the order that tick runs came through the glue
                }
                return await handleResult(entry, value, inventoryGainOf);
            } catch (error) {
                return errorResult('note the result', error);
            }
        },

        /**
         * Every 5 s: with a running job, when shouldResume holds (without the wait while the bot goes on by
         * itself after a plan or a step), the next step or else the resumed command, as a system order;
         * without a running job, the next entry of idle_jobs the same way. Never calls the model.
         * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
         */
        async tick() {
            if (state.ticking || state.planning) {
                return result(true, 'busy', '');
            }
            state.ticking = true;
            try {
                if (executeCommand === null) {
                    return result(false, 'no_executor', '');
                }
                const s = readJobSettings(settings);
                const t = nowMs();
                const view = {
                    now: t,
                    lastOrderAt: state.lastOrderAt,
                    actionRunning: call(() => actionRunning(), true),
                    sleeping: call(() => sleeping(), false),
                    night: call(() => night(), false),
                    nightShelter: call(() => nightShelter(), false),
                    underground: call(() => underground(), false),
                };
                const job = getJob();
                if (job?.state === 'running') {
                    const chainAt = typeof job.chainAt === 'string' ? Date.parse(job.chainAt) : NaN;
                    const chained = Number.isFinite(chainAt) && state.lastOrderAt <= chainAt;
                    if (!shouldResume({ ...view, job, resumeSeconds: chained ? 0 : s.resumeSeconds })) {
                        return result(true, 'wait', '');
                    }
                    // v0.1.4.12 (T3-1): a step whose check the inventory already meets is done before it runs; a step
                    // that needs the surface runs after the way out of the mine
                    const next = nextStep(job);
                    if (next >= 0) {
                        return await runStep(job, next);
                    }
                    const text = resumeCommand(job);
                    if (!text) {
                        return result(false, 'no_command', '');
                    }
                    speak(resumeText(job));
                    return await runSystem(text, 'resume', job);
                }
                if (s.idleJobs.length === 0 || !shouldResume({ ...view, job: { state: 'running', kind: 'idle' }, resumeSeconds: s.resumeSeconds })) {
                    return result(true, 'wait', '');
                }
                const text = nextIdleJob({ idleJobs: s.idleJobs, lastRun: state.lastRun, now: t, minutes: s.idleMinutes });
                if (text === null) {
                    return result(true, 'wait', '');
                }
                state.lastRun[text] = t;
                speak(idleStartText(text));
                return await runSystem(text, 'idle', null);
            } catch (error) {
                return errorResult('go on with its job', error);
            } finally {
                state.ticking = false;
            }
        },

        /**
         * At spawn: a running job says the restart text and stays running.
         * @returns {{ok: boolean, reason: string|null, text: string}}
         */
        onRestart() {
            try {
                const job = getJob();
                if (!job || job.state !== 'running') {
                    return result(true, 'no_job', '');
                }
                return result(true, 'running', speak(restartText(job)));
            } catch (error) {
                return errorResult('restart', error);
            }
        },

        /**
         * The skill's own count of the job (v0.1.4.13, P5): the pack calls ctx.job?.progress?.(got) each time it
         * reports progress, with what it got in this run. got of the job becomes what the job had before the run
         * plus that count, and the gain of the inventory is not added on top. Only for the command of the job or
         * its resumed command, never for a step. Never throws.
         * @param {number} got the count of the skill in this run
         * @returns {{ok: boolean, reason: string|null, text: string}}
         */
        progress(got) {
            try {
                const n = Number(got);
                if (!Number.isFinite(n) || n < 0) {
                    return result(false, 'bad_count', '');
                }
                const job = getJob();
                if (!job || !isFiniteNumber(job.wanted) || (job.state !== 'running' && job.state !== 'left')) {
                    return result(false, 'no_job', '');
                }
                const entry = runningEntry(job, ['job', 'resume']);
                // a job that was left takes the last report of the skill that still runs (the leave text waits for it)
                if (!entry || (job.state === 'left' && entry.leave !== true && entry.sys?.leave !== true)) {
                    return result(false, job.state === 'left' ? 'no_job' : 'not_running', '');
                }
                entry.reported = true;
                if (entry.sys) {
                    entry.sys.reported = true;
                }
                const base = isFiniteNumber(entry.base) ? entry.base : (isFiniteNumber(entry.sys?.base) ? entry.sys.base : 0);
                job.got = base + Math.floor(n);
                setJob(job);
                return result(true, 'progress', '');
            } catch (error) {
                return errorResult('note the progress', error);
            }
        },

        /**
         * v0.1.4.13 (P6): the answer to the model for a command it picks while a skill of the job runs (the
         * command of the job, its resumed command or a step): `The mining runs, 7 of 28 diamond. Say !stop first.`;
         * null when the command runs: nothing of the job runs, the order is the owner's or a system order, the
         * command is !stop, !stats, !inventory or a query. Never throws.
         * @param {string} name the command
         * @param {string} by 'model', 'system' or the player
         * @param {boolean} [query] the command is a query, no action
         * @returns {string|null}
         */
        refusal(name, by, query = false) {
            try {
                const job = getJob();
                if (!job || job.state !== 'running') {
                    return null;
                }
                const entry = runningEntry(job, JOB_SKILL_ROLES);
                if (!entry) {
                    return null;
                }
                return refusedWhileRunning(name, { by, running: entry.role, query: query === true }) ? busyText(job) : null;
            } catch {
                return null;
            }
        },

        /**
         * Asks the model once for the steps against a blocker (at most 3 plans per job); the plan text, or
         * the no-plan text and the job pauses.
         * @param {{kind: string, item: string|null}} blocker
         * @param {string} [failText] the text of the skill that failed, for the prompt
         * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
         */
        plan,

        /**
         * Resolves when the plan that runs (if any) has ended. For the glue and the tests.
         * @returns {Promise<void>}
         */
        settled() {
            return state.planned;
        },

        /**
         * The line for the knowledge block: `Job: the mining, 6 of 16 iron, step 2 of 4.`; for a job that is done
         * or left `Last job: the farming, left.` (F27); '' without a job.
         * @returns {string}
         */
        status() {
            try {
                return statusText(getJob());
            } catch {
                return '';
            }
        },

        /**
         * The job record (a copy), or null. For the glue and the tests.
         * @returns {object|null}
         */
        get() {
            return getJob();
        },

        /**
         * The text of the job for a player who asks: the status line, the Last-job line (F27), or `I have no job.`
         * @returns {string}
         */
        describe() {
            try {
                return statusText(getJob()) || noJobText();
            } catch {
                return noJobText();
            }
        },
    };
}
