// The routines on the agent (spec v0.1.4.15, part R, 3.2 to 3.5): createRoutines(agent, store, options) gives the
// object the glue keeps as agent.routines when `routines` and job_memory are on (the rounds are jobs). The four
// commands call remember, list, forget and doNow; the job's tick calls due and startRound when no job runs; the job
// calls onRoundEnd when a round is done, failed or left. The model is asked once per routine, for its plan, through
// options.askModel (promptPlan, purpose plan, with the rules of the player in the prompt); a round runs with no
// model call. Every method returns { ok, reason, text } and never throws.
import { ROUTINE_KIND } from '../job/job_logic.js';
import { busyText } from '../job/job_texts.js';
import { countIn } from '../job/plan_logic.js';
import {
    ROUTINE_RULES, checkPlan, conditionHolds, nextRoutine, normalizeRoutineName, noteRound, placeNamesOf, readPlan, routineCommands, routineOf,
    routinePlanPrompt, routinesJson,
} from './routine_logic.js';
import {
    NAME_TEXT, ROUTINES_OFF, badPlanText, forgotText, fullText, knownText, listText, noPlanText, pausedText, planText, rememberedText,
    roundStartText, textText, unknownText, waitsText,
} from './routine_texts.js';

export { RoutineStore, ROUTINES_FILE } from './routine_store.js';
export { ROUTINE_COMMAND_NAMES } from './routine_logic.js';
export { ROUTINES_OFF };

/** The warning at the start when routines is on without job_memory (the rounds are jobs). */
export const ROUTINES_WARNING = 'routines needs job_memory. The routines do not run.';

/**
 * The watch tool `routines` (3.5): the routines as JSON text; the supervisor starts one with run ['!doRoutine("x")'].
 * Registered by tools.js through registerTool, only with the switch routines, never in the pinned table.
 */
export const ROUTINES_TOOL = Object.freeze({
    name: 'routines',
    schema: Object.freeze({
        description: 'The routines the owner saved (standing work in his words), as JSON: name, text, every (minutes), condition, state (active or paused), rounds, fails, lastRound and the planned steps. Start one with run [\'!doRoutine("name")\'].',
        inputSchema: Object.freeze({ type: 'object', properties: {}, additionalProperties: false }),
    }),
    handler: async (agent) => {
        try {
            const text = agent?.routines?.json?.();
            return typeof text === 'string' ? text : routinesJson([]);
        } catch {
            return routinesJson([]);
        }
    },
});

/**
 * Registers the tool routines with registerTool of tools.js, only when the switch routines is on. Never throws.
 * @param {(name: string, schema: object, handler: Function) => boolean} register
 * @param {object} settings
 * @returns {boolean} true when it was added
 */
export function registerRoutinesTool(register, settings) {
    if (typeof register !== 'function' || settings?.routines !== true) {
        return false;
    }
    try {
        return register(ROUTINES_TOOL.name, ROUTINES_TOOL.schema, ROUTINES_TOOL.handler) === true;
    } catch (error) {
        console.warn('Could not register the tool routines:', error?.message ?? error);
        return false;
    }
}

function result(ok, reason = null, text = '') {
    return { ok, reason, text };
}

function errorResult(where, error) {
    console.warn(`The routines could not ${where}:`, error?.message ?? error);
    return result(false, 'error', `The routines could not ${where}: ${error?.message ?? error}`);
}

function str(value) {
    return typeof value === 'string' ? value.trim() : '';
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
                console.warn('The routines could not say:', error?.message ?? error);
            }
        },
        job: () => agent?.job ?? null,
        inventory: safe(() => {
            const out = {};
            for (const item of agent?.bot?.inventory?.items?.() ?? []) {
                if (item && typeof item.name === 'string') {
                    out[item.name] = (out[item.name] ?? 0) + (Number.isFinite(item.count) ? item.count : 0);
                }
            }
            return out;
        }, {}),
        areas: safe(() => agent?.area_store?.list?.() ?? [], []),
        // the remembered places (!rememberHere) by name: the place store of the world, else the memory of the bank;
        // v0.1.4.16 (F6): never the bot's own bed (`my_bed`, placeNamesOf)
        places: safe(() => {
            const bank = agent?.memory_bank;
            if (typeof bank?.store?.names === 'function') {
                return placeNamesOf(bank.store.names());
            }
            if (bank?.memory && typeof bank.memory === 'object') {
                return placeNamesOf(Object.keys(bank.memory));
            }
            const keys = typeof bank?.getKeys === 'function' ? bank.getKeys() : '';
            return placeNamesOf(typeof keys === 'string' && keys.trim() !== '' ? keys.split(',').map(k => k.trim()).filter(Boolean) : []);
        }, []),
        chests: safe(() => {
            const index = agent?._workStores?.()?.chests ?? null;
            return typeof index?.list === 'function' ? index.list(agent?.bot?.game?.dimension) : null;
        }, null),
        rules: safe(() => agent?.rule_store?.list?.() ?? [], []),
        blocked: safe(() => (Array.isArray(agent?.blocked_actions) ? agent.blocked_actions : []), []),
        // the item registry of the bot: an item name the game knows
        isItem: (name) => {
            try {
                return Boolean(agent?.bot?.registry?.itemsByName?.[name]);
            } catch {
                return false;
            }
        },
        // !mineOre in the prompt only with the mining pack and a known mine, as the job's plan prompt (W105)
        mining: safe(() => Boolean(settings?.mining_pack) && (agent?._workStores?.()?.mines?.list?.(agent?.bot?.game?.dimension)?.length ?? 0) > 0, false),
        // the running step of a round that is forgotten is stopped as !stop stops it
        stopAction: async () => {
            try {
                await agent?.actions?.stop?.('!forgetRoutine');
            } catch (error) {
                console.warn('The routines could not stop the running step:', error?.message ?? error);
            }
        },
    };
}

/**
 * The routines of the agent.
 * @param {object} agent the agent: sayText, job, bot (inventory, registry, game), area_store, _workStores, rule_store,
 *   blocked_actions, actions; each read only when the option of the same name is not given
 * @param {RoutineStore} store the store of routines.json; load() is called here
 * @param {{settings?: object, now?: () => number, askModel?: (prompt: string) => Promise<string>, say?: Function,
 *   job?: () => object|null, inventory?: () => object, areas?: () => object[], places?: () => string[], chests?: () => object[]|null, rules?: () => Array,
 *   blocked?: () => string[], isItem?: (name: string) => boolean, mining?: () => boolean, stopAction?: () => Promise<void>}} [options]
 *   settings: read at every call (mining_pack, base_survey); now: milliseconds; askModel: the call of the model for a
 *   plan (promptPlan, purpose 'plan'); job: the job of the agent (createJob), read when a round starts
 * @returns {object}
 */
export function createRoutines(agent, store, options = {}) {
    const settings = options?.settings ?? {};
    const now = typeof options?.now === 'function' ? options.now : () => Date.now();
    const readers = defaultReaders(agent, settings);
    const pick = (name) => (typeof options?.[name] === 'function' ? options[name] : readers[name]);
    const say = pick('say');
    const jobOf = pick('job');
    const inventory = pick('inventory');
    const areas = pick('areas');
    const places = pick('places');
    const chests = pick('chests');
    const rules = pick('rules');
    const blocked = pick('blocked');
    const isItem = pick('isItem');
    const mining = pick('mining');
    const stopAction = pick('stopAction');
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
    const speak = (text) => {
        if (typeof text === 'string' && text.length > 0) {
            console.log('Routines:', text);
            call(() => say(text), undefined);
        }
        return text;
    };

    try {
        store?.load?.();
    } catch (error) {
        console.warn('The routines could not load their file:', error?.message ?? error);
    }

    const state = { planning: false };

    const getRoutine = (name) => call(() => store?.get?.(name) ?? null, null);
    const saveRoutine = (routine) => call(() => store?.set?.(routine) ?? null, null);
    const listRoutines = () => call(() => store?.list?.() ?? [], []);
    const nameOf = (name) => normalizeRoutineName(name) ?? str(name);

    // A plan that fails pauses the routine: the owner is asked to say it differently; the model is not asked again
    // every `every` minutes.
    function pauseRoutine(routine) {
        routine.state = 'paused';
        saveRoutine(routine);
    }

    // The plan of a routine, once, with the model (3.2): the prompt through askModel, the answer read and checked,
    // the steps saved. { ok: true, routine } or { ok: false, reason, text } with the text of 3.6.
    async function plan(routine) {
        if (askModel === null) {
            pauseRoutine(routine);
            return result(false, 'no_model', noPlanText(routine.name));
        }
        const commands = routineCommands({ mining: call(() => mining(), false), baseSurvey: settings?.base_survey === true });
        const prompt = routinePlanPrompt(routine, call(() => inventory(), {}), call(() => areas(), []), call(() => chests(), null), commands,
            { rules: call(() => rules(), []), places: call(() => places(), []) });
        let answer = '';
        state.planning = true;
        try {
            answer = await askModel(prompt);
        } catch (error) {
            console.warn('The routines could not ask the model for a plan:', error?.message ?? error);
        } finally {
            state.planning = false;
        }
        const fresh = getRoutine(routine.name);
        if (!fresh) {
            return result(false, 'forgotten', ''); // forgotten while the model planned
        }
        const read = readPlan(answer);
        if (read.none) {
            pauseRoutine(fresh);
            return result(false, 'no_plan', noPlanText(fresh.name));
        }
        // v0.1.4.16 (F3): the places and the coordinates the owner named must be steps of the plan
        const check = checkPlan(read.commands, commands, call(() => blocked(), []), { text: fresh.text, places: call(() => places(), []) });
        if (!check.ok) {
            pauseRoutine(fresh);
            return result(false, 'bad_plan', badPlanText(fresh.name, check.reason));
        }
        fresh.steps = check.steps;
        const saved = saveRoutine(fresh);
        if (!saved) {
            return result(false, 'not_saved', '');
        }
        speak(planText(saved.name, saved.steps));
        return { ok: true, reason: 'planned', text: '', routine: saved };
    }

    return {
        /**
         * `!rememberRoutine(name, text)` (3.5): saves the routine (3.1); the plan is made at its first round.
         * @param {string} name
         * @param {string} text
         * @returns {{ok: boolean, reason: string|null, text: string}}
         */
        remember(name, text) {
            try {
                const clean = normalizeRoutineName(name);
                if (clean === null) {
                    return result(false, 'bad_name', NAME_TEXT);
                }
                const words = str(text);
                if (words.length === 0 || words.length > ROUTINE_RULES.textMax) {
                    return result(false, 'bad_text', textText(words.length)); // v0.1.4.16 (F3): the cap with the count
                }
                if (getRoutine(clean)) {
                    return result(false, 'known', knownText(clean));
                }
                if (listRoutines().length >= ROUTINE_RULES.max) {
                    return result(false, 'full', fullText(ROUTINE_RULES.max));
                }
                const routine = routineOf(clean, words, { now: iso(), isItem: (n) => call(() => isItem(n), false) });
                const saved = routine ? saveRoutine(routine) : null;
                if (!saved) {
                    return result(false, 'not_saved', textText(words.length));
                }
                return result(true, 'remembered', rememberedText(saved));
            } catch (error) {
                return errorResult('remember the routine', error);
            }
        },

        /**
         * `!routines()`: the list (3.6).
         * @returns {{ok: boolean, reason: string|null, text: string}}
         */
        list() {
            try {
                return result(true, 'list', listText(listRoutines()));
            } catch (error) {
                return errorResult('list the routines', error);
            }
        },

        /**
         * `!forgetRoutine(name)`: removes the routine; a running round of it ends (left) and its step is stopped.
         * @param {string} name
         * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
         */
        async forget(name) {
            try {
                const clean = normalizeRoutineName(name);
                const routine = clean === null ? null : getRoutine(clean);
                if (!routine) {
                    return result(false, 'unknown', unknownText(nameOf(name)));
                }
                const api = call(() => jobOf(), null);
                const job = call(() => api?.get?.() ?? null, null);
                if (job?.kind === ROUTINE_KIND && job.routine === clean && job.state === 'running') {
                    call(() => api.leaveRound?.(clean), null);
                    await stopAction();
                }
                call(() => store?.remove?.(clean), false);
                return result(true, 'forgot', forgotText(clean));
            } catch (error) {
                return errorResult('forget the routine', error);
            }
        },

        /**
         * `!doRoutine(name)` (3.4): a round now; a paused routine runs again. A running job is refused with its
         * busyText; a condition that does not hold waits (3.6).
         * @param {string} name
         * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
         */
        async doNow(name) {
            try {
                const clean = normalizeRoutineName(name);
                let routine = clean === null ? null : getRoutine(clean);
                if (!routine) {
                    return result(false, 'unknown', unknownText(nameOf(name)));
                }
                const api = call(() => jobOf(), null);
                const job = call(() => api?.get?.() ?? null, null);
                if (job?.state === 'running') {
                    return result(false, 'busy', busyText(job));
                }
                if (routine.state === 'paused') {
                    routine.state = 'active';
                    routine.fails = 0;
                    routine = saveRoutine(routine) ?? routine;
                }
                const bag = call(() => inventory(), {});
                if (!conditionHolds(routine, bag)) {
                    return result(false, 'waits', waitsText(routine.name, countIn(bag, routine.condition.item), routine.condition.item));
                }
                return await this.startRound(routine);
            } catch (error) {
                return errorResult('do the routine', error);
            }
        },

        /**
         * The routine whose round starts now (3.4, for the job's tick when no job runs): nextRoutine over the active
         * routines with the bag. null when none is due.
         * @param {number} [t] milliseconds
         * @returns {object|null}
         */
        due(t) {
            try {
                if (state.planning) {
                    return null;
                }
                return nextRoutine(listRoutines(), Number.isFinite(t) ? t : nowMs(), call(() => inventory(), {}));
            } catch {
                return null;
            }
        },

        /**
         * Starts a round of the routine (3.3): the plan first when the routine has none (one model call), then the
         * job of the kind routine through startRoutineRound of the job. The text is the round's start line (said by
         * the caller: the tick speaks it, !doRoutine answers it); a plan that fails gives its text instead.
         * @param {object} routine
         * @returns {Promise<{ok: boolean, reason: string|null, text: string, job?: object}>}
         */
        async startRound(routine) {
            try {
                let r = getRoutine(routine?.name) ?? routine;
                if (!r || typeof r.name !== 'string') {
                    return result(false, 'unknown', unknownText(nameOf(routine?.name)));
                }
                if (!Array.isArray(r.steps) || r.steps.length === 0) {
                    const planned = await plan(r);
                    if (!planned.ok) {
                        return planned;
                    }
                    r = planned.routine;
                }
                const api = call(() => jobOf(), null);
                if (typeof api?.startRoutineRound !== 'function') {
                    return result(false, 'no_job', '');
                }
                // v0.1.4.16 (F3): the round number is the persisted counter `runs` (the rounds started), not rounds + 1
                const round = (Number.isInteger(r.runs) ? r.runs : 0) + 1;
                const out = api.startRoutineRound(r, round);
                if (!out?.ok) {
                    return result(false, out?.reason ?? 'no_round', out?.text ?? '');
                }
                r.runs = round;
                r.lastRound = iso(); // the start counts, so that a round that the process loses is not started again at once
                saveRoutine(r);
                return { ...result(true, 'round', roundStartText(r.name, round)), job: out.job ?? null };
            } catch (error) {
                return errorResult('start the round', error);
            }
        },

        /**
         * The end of a round (3.3), from the job: done counts a round, failed counts a failure and the third in a
         * row pauses the routine, left sets the last round. The pause text when the routine was paused, else null.
         * @param {{routine: string, steps?: object[]}} job the job of the round
         * @param {{reason: 'done'|'failed'|'left', step?: string|null, text?: string}} outcome
         * @returns {string|null}
         */
        onRoundEnd(job, outcome) {
            try {
                const routine = getRoutine(job?.routine);
                if (!routine) {
                    return null;
                }
                const noted = noteRound(routine, outcome, nowMs());
                if (!noted.routine) {
                    return null;
                }
                saveRoutine(noted.routine);
                if (!noted.paused) {
                    return null;
                }
                const failed = typeof outcome?.step === 'string' && outcome.step.length > 0 ? outcome.step
                    : ((Array.isArray(job?.steps) ? job.steps : []).findLast(s => s?.state === 'skipped' || s?.state === 'failed')?.command ?? null); // F3: skipped
                return pausedText(noted.routine.name, failed);
            } catch (error) {
                console.warn('The routines could not note the round:', error?.message ?? error);
                return null;
            }
        },

        /**
         * The routines as JSON text for the watch tool (3.5).
         * @returns {string}
         */
        json() {
            try {
                return routinesJson(listRoutines());
            } catch {
                return routinesJson([]);
            }
        },

        /**
         * The routine file of the world the bot is in (bots/<name>/worlds/<seed>/routines.json), bound at spawn once
         * the world is known, beside the job's. Never throws.
         * @param {string|null} filePath
         * @returns {number} the routines of that world
         */
        bind(filePath) {
            try {
                const list = typeof store?.bind === 'function' ? store.bind(filePath) : listRoutines();
                return Array.isArray(list) ? list.length : 0;
            } catch (error) {
                errorResult('bind to the world', error);
                return 0;
            }
        },

        /**
         * One routine (a copy), or null. For the glue and the tests.
         * @param {string} name
         * @returns {object|null}
         */
        get(name) {
            return getRoutine(name);
        },

        /**
         * The routines (copies). For the glue and the tests.
         * @returns {object[]}
         */
        all() {
            return listRoutines();
        },
    };
}
