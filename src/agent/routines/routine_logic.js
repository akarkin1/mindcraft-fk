// The pure decisions of the routines (spec v0.1.4.15, part R, 3.1 to 3.4): the record of a routine and the two things
// code reads from its text (`every N minutes`, `when fewer than N <item>`), the commands a plan may use, the plan
// prompt, the answer read as steps and checked, which routine runs next when the bot has nothing to do, and what the
// end of a round does to the routine. Pure: the clock, the bag and the item registry are passed in. Nothing here
// throws.
import { normalizeAreaName } from '../areas/area_store.js';
import { commandText } from '../repeat_guard.js';
import { buildRulesSection } from '../rules/rule_prompt.js';
import { MINE_COMMANDS, PLAN_COMMANDS, checkOf, countIn, inventoryCounts } from '../job/plan_logic.js';
import { planReasons, sentenceOf } from './routine_texts.js';

/** The fixed numbers of the routines (3.1, 3.2, 3.3). */
export const ROUTINE_RULES = Object.freeze({
    max: 12,        // routines at most
    textMax: 400,   // characters of the text
    nameMax: 64,    // characters of the name, as an area name
    every: 15,      // minutes between rounds when the text names none
    maxSteps: 8,    // steps of a plan
    maxFails: 3,    // failed rounds in a row that pause the routine
});

/** The states of a routine. */
export const ROUTINE_STATES = Object.freeze(['active', 'paused']);

/** The four chat commands of the routines (3.5); never a step of a plan. */
export const ROUTINE_COMMAND_NAMES = Object.freeze(['!rememberRoutine', '!routines', '!forgetRoutine', '!doRoutine']);

/** How a round can end (3.3). */
export const ROUND_OUTCOMES = Object.freeze(['done', 'failed', 'left']);

/**
 * The commands a plan may use (3.2): PLAN_COMMANDS of the job and the commands of the base, each with its usage,
 * its line for the prompt and its params (type int or string, a default or none), as PLAN_COMMANDS has them. The
 * usages follow the real commands of actions.js (`!plant` takes the seed first). `when` names the switch a command
 * needs (`!goToBase` with base_survey); `!mineOre` is listed only with a known mine, as in the job's prompt.
 */
export const ROUTINE_COMMANDS = Object.freeze([
    ...PLAN_COMMANDS,
    Object.freeze({ name: '!harvest', usage: '!harvest(farm)', description: 'Harvest the ripe plants of a saved farm and plant them again; "" for the nearest farm.',
        params: Object.freeze([{ type: 'string', default: '' }]) }),
    Object.freeze({ name: '!plant', usage: '!plant(seed, farm)', description: 'Plant a seed on the free ground of a farm: wheat_seeds, carrot, potato or beetroot_seeds; farm "" for the nearest.',
        params: Object.freeze([{ type: 'string', default: 'wheat_seeds' }, { type: 'string', default: '' }]) }),
    Object.freeze({ name: '!farmCycle', usage: '!farmCycle(farm)', description: 'The whole round of a farm: harvest, store the harvest, plant, bone meal, close the gate; "" for the nearest.',
        params: Object.freeze([{ type: 'string', default: '' }]) }),
    Object.freeze({ name: '!storeItems', usage: '!storeItems()', description: 'Put what the bot carries into a chest it knows; tools, food and torches stay in the bag.',
        params: Object.freeze([]) }),
    Object.freeze({ name: '!putInChest', usage: '!putInChest(item, num)', description: 'Put num of an item into the nearest chest.',
        params: Object.freeze([{ type: 'string' }, { type: 'int' }]) }),
    Object.freeze({ name: '!goToRememberedPlace', usage: '!goToRememberedPlace(name)', description: 'Walk to a saved place.',
        params: Object.freeze([{ type: 'string' }]) }),
    Object.freeze({ name: '!goToBase', usage: '!goToBase(name)', description: 'Walk to the door of a surveyed base.',
        params: Object.freeze([{ type: 'string' }]), when: 'base_survey' }),
]);

/** The names of ROUTINE_COMMANDS. */
export const ROUTINE_PLAN_NAMES = Object.freeze(ROUTINE_COMMANDS.map(c => c.name));

// The generic names of a wanted item that the inventory check knows beside the registry (itemMatches of job_logic).
const GENERIC_ITEMS = Object.freeze(['log', 'planks', 'pickaxe', 'axe', 'shovel', 'hoe', 'sword']);

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function str(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * The commands of the prompt and the check for the switches of the bot: ROUTINE_COMMANDS without `!mineOre` unless
 * `mining` (the mining pack on and a mine known), without `!goToBase` unless `baseSurvey`.
 * @param {{mining?: boolean, baseSurvey?: boolean}} [options]
 * @returns {object[]}
 */
export function routineCommands({ mining = false, baseSurvey = false } = {}) {
    return ROUTINE_COMMANDS.filter(c => {
        if (MINE_COMMANDS.includes(c.name)) {
            return mining === true;
        }
        if (c.when === 'base_survey') {
            return baseSurvey === true;
        }
        return true;
    });
}

/**
 * The name of a routine as it is saved and looked up: as an area name (trimmed, lower case, one space for every run
 * of spaces or underscores: "The Farm", "the_farm" and "the farm" are one routine), 1 to 64 characters; the texts of
 * 3.6 print it with its spaces (`"the farm"`). null for anything else.
 * @param {*} name
 * @returns {string|null}
 */
export function normalizeRoutineName(name) {
    const clean = normalizeAreaName(name)?.replace(/_+/g, ' ').trim() ?? null;
    return clean !== null && clean.length >= 1 && clean.length <= ROUTINE_RULES.nameMax ? clean : null;
}

const EVERY = /\bevery\s+(?:(\d+)\s+)?(minutes?|mins?|hours?)\b/i;
const FEWER = /\b(?:fewer|less)\s+than\s+(\d+)\s+([a-z][a-z_ ]*)/i;

/**
 * The minutes between rounds that the text names: `every N minutes` (`every minute`: 1, `every hour`: 60, `every N
 * hours`). null when the text names none.
 * @param {string} text
 * @returns {number|null}
 */
export function everyOf(text) {
    const m = str(text).match(EVERY);
    if (!m) {
        return null;
    }
    const n = m[1] === undefined ? 1 : Number(m[1]);
    if (!Number.isInteger(n) || n < 1) {
        return null;
    }
    return m[2].toLowerCase().startsWith('hour') ? n * 60 : n;
}

// The singular of a word of the owner: torches -> torch, potatoes -> potato, berries -> berry, ingots -> ingot;
// glass stays.
function singularOf(word) {
    if (/(ch|sh|x|ss|o)es$/.test(word)) {
        return word.slice(0, -2);
    }
    if (/ies$/.test(word)) {
        return `${word.slice(0, -3)}y`;
    }
    if (/[^s]s$/.test(word)) {
        return word.slice(0, -1);
    }
    return word;
}

// The item name of the words after the number: the words joined with `_` when the registry knows them, else their
// singular when it knows that, else a generic name of the inventory check. Without a registry (isItem no function)
// the singular is taken when the word looks plural, the word as it is otherwise.
function itemNameOf(words, isItem) {
    const joined = words.join('_');
    const single = singularOf(joined);
    const known = (name) => {
        try {
            return isItem(name) === true;
        } catch {
            return false;
        }
    };
    if (typeof isItem !== 'function') {
        return GENERIC_ITEMS.includes(joined) ? joined : single;
    }
    for (const candidate of [joined, single]) {
        if (known(candidate)) {
            return candidate;
        }
    }
    return GENERIC_ITEMS.includes(joined) ? joined : (GENERIC_ITEMS.includes(single) ? single : null);
}

/**
 * The condition of the text: `when fewer than N <item>` (`less than` too) as { item, fewerThan }, the item an item
 * name of the registry (`isItem(name)` true), its singular, or a generic name the inventory check knows (log,
 * planks, a tool kind). null when the text names none or the item is not known.
 * @param {string} text
 * @param {(name: string) => boolean} [isItem] the registry
 * @returns {{item: string, fewerThan: number}|null}
 */
export function conditionOf(text, isItem) {
    const m = str(text).match(FEWER);
    if (!m) {
        return null;
    }
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1) {
        return null;
    }
    const words = m[2].trim().toLowerCase().split(/[\s_]+/).filter(Boolean).slice(0, 3);
    for (let k = words.length; k >= 1; k--) {
        const item = itemNameOf(words.slice(0, k), isItem);
        if (item) {
            return { item, fewerThan: n };
        }
    }
    return null;
}

/**
 * The two things code reads from the text (3.1) and nothing else: `every` (15 when the text names none) and the
 * condition (null when none).
 * @param {string} text
 * @param {(name: string) => boolean} [isItem]
 * @returns {{every: number, condition: {item: string, fewerThan: number}|null}}
 */
export function parseRoutineText(text, isItem) {
    return { every: everyOf(text) ?? ROUTINE_RULES.every, condition: conditionOf(text, isItem) };
}

/**
 * The record of a new routine (3.1), state active, no plan yet; null for a name or a text that cannot be saved.
 * @param {string} name
 * @param {string} text at most 400 characters
 * @param {{now?: string, isItem?: (name: string) => boolean}} [options] now: the ISO time of created and updated
 * @returns {object|null}
 */
export function routineOf(name, text, options = {}) {
    const clean = normalizeRoutineName(name);
    const t = str(text);
    if (clean === null || t.length === 0 || t.length > ROUTINE_RULES.textMax) {
        return null;
    }
    const parsed = parseRoutineText(t, options?.isItem);
    const now = typeof options?.now === 'string' ? options.now : null;
    return {
        name: clean, text: t, steps: null, every: parsed.every, condition: parsed.condition, state: 'active',
        rounds: 0, fails: 0, lastRound: null, created: now, updated: now,
    };
}

function inventoryText(inventory) {
    const entries = Object.entries(inventoryCounts(inventory)).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b));
    return entries.length > 0 ? entries.map(([name, n]) => `${n} ${name}`).join(', ') : 'nothing';
}

// `The places the bot knows: the areas farm (farm), home (home); the places post, spot.`: the saved areas by name and
// kind, and the remembered places (!rememberHere) by name, so that the model knows the names it may walk to.
function placesLine(areas, places) {
    const list = (Array.isArray(areas) ? areas : []).filter(a => isPlainObject(a) && typeof a.name === 'string' && a.name.length > 0);
    const names = (Array.isArray(places) ? places : []).map(p => (typeof p === 'string' ? p : p?.name)).filter(n => typeof n === 'string' && n.length > 0);
    const parts = [];
    if (list.length > 0) {
        parts.push(`the areas ${list.map(a => `${a.name} (${a.kind ?? a.type ?? 'area'})`).join(', ')}`);
    }
    if (names.length > 0) {
        parts.push(`the places ${names.join(', ')}`);
    }
    return parts.length === 0 ? 'The places the bot knows: none.' : `The places the bot knows: ${parts.join('; ')}.`;
}

/** At most this many chests, and this many kinds per chest, in the plan prompt (as the job's prompt). */
const PROMPT_CHESTS = 8;
const PROMPT_CHEST_KINDS = 12;

function posText(pos) {
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

// The lines of the known chests; null when the chests are not known (no reader).
function chestLines(chests) {
    if (!Array.isArray(chests)) {
        return null;
    }
    const items = c => Object.entries(isPlainObject(c.items) ? c.items : {}).filter(([, n]) => isFiniteNumber(n) && n > 0);
    const full = chests.filter(c => isPlainObject(c) && isFiniteNumber(c.x) && isFiniteNumber(c.y) && isFiniteNumber(c.z) && items(c).length > 0);
    if (full.length === 0) {
        return ['The chests the bot knows: none with items.'];
    }
    return ['The chests the bot knows and what they hold:', ...full.slice(0, PROMPT_CHESTS).map(c => {
        const kinds = items(c).sort(([a, n], [b, m]) => m - n || a.localeCompare(b)).slice(0, PROMPT_CHEST_KINDS);
        return `the chest at ${posText(c)}: ${kinds.map(([name, n]) => `${n} ${name}`).join(', ')}`;
    })];
}

/**
 * The text the model gets once per routine (3.2): the task in the owner's words, the rules of the player (when
 * given), the places the bot knows (the areas by name and kind), the chests and what they hold, what the bot
 * carries, the commands it may use and the format of the answer. The first line never changes.
 * @param {{name: string, text: string}} routine
 * @param {object|Array} inventory { name: count } or [{ name, count }]
 * @param {{name: string, kind?: string, type?: string}[]} areas the saved areas
 * @param {{x: number, y: number, z: number, items: object}[]|null} chests the chest index; null when not known
 * @param {object[]} [commands] the commands (routineCommands); ROUTINE_COMMANDS without
 * @param {{rules?: Array, places?: (string|{name: string})[]}} [context] rules: the rules of the player (rule_store.list()),
 *   the section of every prompt; places: the names of the remembered places (!rememberHere, the place store)
 * @returns {string}
 */
export function routinePlanPrompt(routine, inventory, areas, chests, commands, context = {}) {
    const r = isPlainObject(routine) ? routine : {};
    const c = isPlainObject(context) ? context : {};
    const list = Array.isArray(commands) && commands.length > 0 ? commands : ROUTINE_COMMANDS;
    const rules = buildRulesSection(c.rules);
    const lines = chestLines(chests);
    return [
        'You plan the steps of a Minecraft bot for a standing task the player described in his words.',
        `The task: ${sentenceOf(r.text) || 'none.'}`,
        ...(rules ? [rules] : []),
        placesLine(areas, c.places),
        ...(lines ?? []),
        `What the bot carries: ${inventoryText(inventory)}.`,
        'The commands you may use:',
        ...list.map(c => `${c.usage ?? c.name}: ${c.description ?? ''}`.trim()),
        `Answer with the steps of one round of the task, one command per line, in the order the bot runs them; the first command runs first; at most ${ROUTINE_RULES.maxSteps} lines.`,
        'Write the commands with their arguments, strings in double quotes, for example !harvest("farm"). Use no other command and write nothing else.',
        'When the task cannot be done with these commands, answer NONE.',
    ].join('\n');
}

const ARG = String.raw`-?\d+(?:\.\d+)?|true|false|"[^"]*"|'[^']*'`;
const COMMAND = new RegExp(String.raw`!(\w+)(?:\(([^)]*)\))?`, 'g');

// The args of a call as written, or null when the text between the parentheses is not a list of args.
function readArgs(inner) {
    if (inner === undefined || inner.trim() === '') {
        return [];
    }
    const parts = [];
    const re = new RegExp(String.raw`\s*(${ARG})\s*(,|$)`, 'gy');
    let m;
    let at = 0;
    while (at < inner.length && (m = re.exec(inner)) !== null) {
        parts.push(m[1]);
        at = re.lastIndex;
        if (m[2] === '') {
            break;
        }
    }
    if (at < inner.length) {
        return null;
    }
    return parts.map(p => {
        if (/^["']/.test(p)) {
            return p.slice(1, -1);
        }
        if (p === 'true' || p === 'false') {
            return p === 'true';
        }
        return Number(p);
    });
}

/**
 * The commands in the answer of the model, as written: { name, args, text } each, in order (args null when they
 * cannot be read). `none` when the answer holds no command (NONE, or anything else).
 * @param {string} answer
 * @returns {{none: boolean, commands: {name: string, args: Array|null, text: string}[]}}
 */
export function readPlan(answer) {
    const commands = [];
    if (typeof answer === 'string') {
        for (const m of answer.matchAll(COMMAND)) {
            commands.push({ name: `!${m[1]}`, args: readArgs(m[2]), text: m[0] });
        }
    }
    return { none: commands.length === 0, commands };
}

// A step as { name, args }: a command text, { name, args } or { command }.
function stepOf(entry) {
    if (typeof entry === 'string') {
        return readPlan(entry).commands[0] ?? null;
    }
    if (!isPlainObject(entry)) {
        return null;
    }
    if (typeof entry.name === 'string') {
        return { name: entry.name.startsWith('!') ? entry.name : `!${entry.name}`, args: Array.isArray(entry.args) ? entry.args : (entry.args === undefined ? [] : null) };
    }
    return typeof entry.command === 'string' ? (readPlan(entry.command).commands[0] ?? null) : null;
}

// The args checked against the params of the command (parsePlan's rules): ints of 1 or more, texts, the defaults
// filled in. { ok, given, full } or { ok: false, reason } with a reason of 3.6.
function fitArgs(def, args) {
    if (!Array.isArray(args)) {
        return { ok: false, reason: planReasons.text(def.name) };
    }
    let a = [...args];
    if (def.either && typeof a[0] === 'string' && !/^\d+$/.test(a[0]) && (isFiniteNumber(a[1]) || /^\d+$/.test(String(a[1] ?? '')))) {
        a = [a[1], a[0]];
    }
    const params = Array.isArray(def.params) ? def.params : [];
    if (a.length > params.length) {
        return { ok: false, reason: planReasons.tooManyArgs(def.name, params.length) };
    }
    const given = [];
    const full = [];
    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        let value = a[i];
        if (value === undefined) {
            if (param.default === undefined) {
                return { ok: false, reason: param.type === 'int' ? planReasons.number(def.name) : planReasons.text(def.name) };
            }
            full.push(param.default);
            continue;
        }
        if (param.type === 'int') {
            value = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
            if (!Number.isInteger(value) || value < 1) {
                return { ok: false, reason: planReasons.number(def.name) };
            }
        } else if (typeof value !== 'string') {
            return { ok: false, reason: planReasons.text(def.name) };
        }
        given.push(value);
        full.push(value);
    }
    return { ok: true, given, full };
}

/**
 * The check of a step of a routine: checkOf of the job for a command of PLAN_COMMANDS (the item and the count it
 * names); { item: null, count: null } for the others, which are done when they return ok.
 * @param {string} name the command with `!`
 * @param {Array} args the full args
 * @returns {{item: string|null, count: number|null}}
 */
export function routineCheckOf(name, args) {
    return PLAN_COMMANDS.some(c => c.name === name) ? checkOf(name, args) : { item: null, count: null };
}

function refuse(reason, step) {
    return { ok: false, reason, step, steps: null };
}

/**
 * The check of a plan (3.2): every command one of `commands` (ROUTINE_COMMANDS without) and none of `blocked`
 * (agent.blocked_actions) nor a routine command, its args of the types of its params (ints of 1 or more, texts), 1
 * to 8 steps. ok: `steps` holds the steps to save, { command, check } each; else `reason` is one of 3.6 and `step`
 * the step that failed, as written.
 * @param {(string|{name: string, args: Array}|{command: string})[]} steps the commands of the answer (readPlan) or texts
 * @param {object[]} [commands]
 * @param {string[]} [blocked]
 * @returns {{ok: boolean, reason: string|null, step: string|null, steps: {command: string, check: object}[]|null}}
 */
export function checkPlan(steps, commands, blocked) {
    try {
        const list = Array.isArray(commands) && commands.length > 0 ? commands : ROUTINE_COMMANDS;
        const hidden = Array.isArray(blocked) ? blocked : [];
        const given = Array.isArray(steps) ? steps : [];
        if (given.length === 0) {
            return refuse(planReasons.noSteps, null);
        }
        if (given.length > ROUTINE_RULES.maxSteps) {
            return refuse(planReasons.tooMany, null);
        }
        const out = [];
        for (const entry of given) {
            const step = stepOf(entry);
            const label = typeof entry === 'string' ? entry : (typeof entry?.text === 'string' ? entry.text : (typeof entry?.command === 'string' ? entry.command : (step?.name ?? '')));
            if (step === null) {
                return refuse(planReasons.notAllowed(label || '!'), label);
            }
            const def = list.find(c => c.name === step.name);
            if (!def || hidden.includes(step.name) || ROUTINE_COMMAND_NAMES.includes(step.name)) {
                return refuse(planReasons.notAllowed(step.name), label);
            }
            const fit = fitArgs(def, step.args);
            if (!fit.ok) {
                return refuse(fit.reason, label);
            }
            out.push({ command: commandText(step.name, fit.given), check: routineCheckOf(step.name, fit.full) });
        }
        return { ok: true, reason: null, step: null, steps: out };
    } catch {
        return refuse(planReasons.noSteps, null);
    }
}

/**
 * True when the routine is due: it never ran, or its last round is `every` minutes or more ago.
 * @param {object} routine
 * @param {number} now milliseconds
 * @returns {boolean}
 */
export function isDue(routine, now) {
    if (!isPlainObject(routine)) {
        return false;
    }
    const at = typeof routine.lastRound === 'string' ? Date.parse(routine.lastRound) : NaN;
    if (!Number.isFinite(at)) {
        return true;
    }
    const every = Number.isInteger(routine.every) && routine.every >= 1 ? routine.every : ROUTINE_RULES.every;
    return isFiniteNumber(now) && now - at >= every * 60 * 1000;
}

/**
 * True when the condition of the routine holds: the bag holds fewer than N of the item (countIn: any log for `log`,
 * ...). A routine without a condition always holds.
 * @param {object} routine
 * @param {object|Array} inventory { name: count } or [{ name, count }]
 * @returns {boolean}
 */
export function conditionHolds(routine, inventory) {
    const c = routine?.condition;
    if (!isPlainObject(c) || typeof c.item !== 'string' || !Number.isInteger(c.fewerThan)) {
        return true;
    }
    return countIn(inventory ?? {}, c.item) < c.fewerThan;
}

function lastOf(routine) {
    const at = typeof routine.lastRound === 'string' ? Date.parse(routine.lastRound) : NaN;
    return Number.isFinite(at) ? at : -Infinity;
}

/**
 * The routine whose round starts now (3.4): the active routine that is due (isDue) and whose condition holds
 * (conditionHolds) with the oldest last round (never ran first; then in the order they were given). null when none.
 * @param {object[]} routines the routines of the store, in their order
 * @param {number} now milliseconds
 * @param {object|Array} [inventory] the bag, for the conditions; empty without
 * @returns {object|null}
 */
export function nextRoutine(routines, now, inventory = {}) {
    if (!Array.isArray(routines) || !isFiniteNumber(now)) {
        return null;
    }
    const due = routines.filter(r => isPlainObject(r) && r.state === 'active' && isDue(r, now) && conditionHolds(r, inventory));
    due.sort((a, b) => lastOf(a) - lastOf(b));
    return due[0] ?? null;
}

function isoOf(now) {
    if (typeof now === 'string') {
        return now;
    }
    const t = isFiniteNumber(now) ? now : Date.now();
    return new Date(t).toISOString();
}

/**
 * The routine after a round (3.3): done counts a round and clears the failures; failed counts a failure, and the
 * third in a row pauses the routine and drops its plan (one replan when it runs again); left changes nothing else.
 * Every end sets lastRound. A copy.
 * @param {object} routine
 * @param {'done'|'failed'|'left'|{reason: string}} outcome
 * @param {number|string} now milliseconds or ISO
 * @returns {{routine: object|null, paused: boolean}}
 */
export function noteRound(routine, outcome, now) {
    if (!isPlainObject(routine)) {
        return { routine: null, paused: false };
    }
    const r = { ...routine };
    const reason = isPlainObject(outcome) ? outcome.reason : outcome;
    const at = isoOf(now);
    r.lastRound = at;
    r.updated = at;
    let paused = false;
    if (reason === 'done') {
        r.rounds = (Number.isInteger(r.rounds) ? r.rounds : 0) + 1;
        r.fails = 0;
    } else if (reason === 'failed') {
        r.fails = (Number.isInteger(r.fails) ? r.fails : 0) + 1;
        if (r.fails >= ROUTINE_RULES.maxFails) {
            r.state = 'paused';
            r.steps = null;
            paused = true;
        }
    }
    return { routine: r, paused };
}

/**
 * The routines for the watch tool (3.5): `{ routines: [{ name, text, every, condition, state, rounds, fails,
 * lastRound, steps }] }` as JSON text, the steps as their commands (null before the plan).
 * @param {object[]} routines
 * @returns {string}
 */
export function routinesJson(routines) {
    const list = (Array.isArray(routines) ? routines : []).filter(isPlainObject).map(r => ({
        name: r.name, text: r.text, every: r.every, condition: r.condition ?? null, state: r.state,
        rounds: Number.isInteger(r.rounds) ? r.rounds : 0, fails: Number.isInteger(r.fails) ? r.fails : 0, lastRound: r.lastRound ?? null,
        steps: Array.isArray(r.steps) ? r.steps.map(s => s?.command).filter(c => typeof c === 'string') : null,
    }));
    return JSON.stringify({ routines: list });
}
