// The job of the bot (spec v0.1.4.10, I1 and I2): which command is a job, when the bot goes back to it,
// what is left of it, and which failure of a skill is a blocker that steps can remove. Pure: the clock
// and the state of the bot are passed in. Nothing here throws.
import { commandText, looksLikeFailure } from '../repeat_guard.js';

/** The fixed numbers of the job. */
export const JOB_RULES = Object.freeze({
    resumeSeconds: 60,     // job_resume_seconds by default
    minResumeSeconds: 10,  // the smallest valid job_resume_seconds
    idleMinutes: 15,       // idle_jobs_minutes by default
    maxFails: 3,           // the same failing text this many times in a row pauses the job
    maxPlans: 3,           // plans of the model per job
    maxSteps: 6,           // steps per plan
    stepRuns: 2,           // a failed step is run once more before the next plan (T3-1)
});

// The item that a block gives when it is mined, for the few blocks that do not drop themselves.
const DROPS = Object.freeze({
    stone: 'cobblestone',
    deepslate: 'cobbled_deepslate',
    grass_block: 'dirt',
});

// The item of each ore (the ore table of the mining pack, kept here: no module outside the packs imports a
// pack statically). Ancient debris drops itself.
const ORE_ITEMS = Object.freeze({
    coal: 'coal', copper: 'raw_copper', iron: 'raw_iron', lapis: 'lapis_lazuli', gold: 'raw_gold',
    redstone: 'redstone', diamond: 'diamond', emerald: 'emerald', ancient_debris: 'ancient_debris',
});
// Other names that lead to an ore: the item, the smelted metal, a plural.
const ORE_NAMES = Object.freeze({
    raw_copper: 'copper', raw_iron: 'iron', raw_gold: 'gold', lapis_lazuli: 'lapis', copper_ingot: 'copper',
    iron_ingot: 'iron', gold_ingot: 'gold', netherite_scrap: 'ancient_debris', redstone_dust: 'redstone', diamonds: 'diamond', emeralds: 'emerald',
});

/**
 * The ore of a name: the ore (`iron`), one of its blocks (`deepslate_iron_ore`), its item (`raw_iron`) or
 * another name of it; as { ore, item, block } where block tells whether the name was a block. null else.
 * @param {*} name
 * @returns {{ore: string, item: string, block: boolean}|null}
 */
export function oreOf(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const clean = name.trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
    if (clean.length === 0) {
        return null;
    }
    if (ORE_ITEMS[clean]) {
        return { ore: clean, item: ORE_ITEMS[clean], block: clean === 'ancient_debris' };
    }
    if (ORE_NAMES[clean]) {
        return { ore: ORE_NAMES[clean], item: ORE_ITEMS[ORE_NAMES[clean]], block: false };
    }
    const block = clean.match(/^(?:deepslate_)?([a-z]+)_ore$/);
    if (block && ORE_ITEMS[block[1]]) {
        return { ore: block[1], item: ORE_ITEMS[block[1]], block: true };
    }
    const plural = clean.replace(/s$/, '');
    if (ORE_ITEMS[plural]) {
        return { ore: plural, item: ORE_ITEMS[plural], block: false };
    }
    return null;
}

// The kinds of tools; a tool kind alone matches every material of it.
const TOOL_KINDS = Object.freeze(['pickaxe', 'axe', 'shovel', 'hoe', 'sword']);

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
 * A command name with its `!`: `mineOre` and `!mineOre` give `!mineOre`; null for anything else.
 * @param {*} name
 * @returns {string|null}
 */
export function cleanCommandName(name) {
    const clean = str(name);
    if (clean.length === 0) {
        return null;
    }
    return clean.startsWith('!') ? clean : `!${clean}`;
}

/**
 * The item a mined block gives: the raw item of an ore block, cobblestone for stone; else the block.
 * @param {string} block
 * @returns {string|null}
 */
export function dropOf(block) {
    const name = str(block).toLowerCase().replace(/^minecraft:/, '');
    if (name.length === 0) {
        return null;
    }
    const row = oreOf(name);
    if (row && row.block) {
        return row.item;
    }
    return DROPS[name] ?? name;
}

// The args of !chopTrees in the order (num, kind): the command takes them in either order (v0.1.4.8, T5).
function chopArgs(args) {
    const a = Array.isArray(args) ? [...args] : [];
    if (typeof a[0] === 'string' && !/^-?\d+$/.test(a[0].trim()) && (isFiniteNumber(a[1]) || /^\d+$/.test(str(a[1])))) {
        return [a[1], a[0]];
    }
    return a;
}

function oreName(arg) {
    return oreOf(arg)?.ore ?? (str(arg) || 'ore');
}

/**
 * The commands that are jobs (spec I1). Per command: `words` of the texts (I3), `count` the index of the
 * count argument or null, `defaults` of the arguments, `item(args)` the inventory item that counts for
 * the progress (null: none), `thing(args)` the word after the numbers (`6 of 16 iron`), `verb(args)` the
 * words of the restart text (`I was mining iron`), and `order(args)` the args in the order of the command.
 */
export const JOB_COMMANDS = Object.freeze({
    mineOre: Object.freeze({
        words: 'the mining', count: 1, defaults: Object.freeze(['', 8, false]),
        item: (args) => oreOf(args?.[0])?.item ?? null,
        thing: (args) => oreName(args?.[0]),
        verb: (args) => `mining ${oreName(args?.[0])}`,
    }),
    farmCycle: Object.freeze({
        words: 'the farming', count: null, defaults: Object.freeze(['']),
        item: () => null, thing: () => null, verb: () => 'farming',
    }),
    chopTrees: Object.freeze({
        words: 'the wood cutting', count: 0, defaults: Object.freeze([8, '']),
        order: chopArgs,
        item: (args) => (str(args?.[1]) ? `${str(args[1]).toLowerCase()}_log` : 'log'),
        thing: (args) => (str(args?.[1]) ? `${str(args[1])} logs` : 'logs'),
        verb: () => 'cutting wood',
    }),
    getTool: Object.freeze({
        words: 'the tool making', count: null, defaults: Object.freeze(['pickaxe', '']),
        item: (args) => (str(args?.[1]) ? `${str(args[1])}_${str(args[0])}` : (str(args?.[0]) || null)),
        thing: () => null, verb: () => 'making tools',
    }),
    craftSupplies: Object.freeze({
        words: 'the crafting', count: 1, defaults: Object.freeze(['torch', 1]),
        item: (args) => str(args?.[0]) || null,
        thing: (args) => str(args?.[0]) || 'items',
        verb: (args) => `making ${str(args?.[0]) || 'supplies'}`,
    }),
    collectBlocks: Object.freeze({
        words: 'the collecting', count: 1, defaults: Object.freeze(['', 1]),
        item: (args) => dropOf(args?.[0]),
        thing: (args) => str(args?.[0]) || 'blocks',
        verb: (args) => `collecting ${str(args?.[0]) || 'blocks'}`,
    }),
    collectPassedOre: Object.freeze({
        words: 'the ore collecting', count: 1, defaults: Object.freeze(['', 8]),
        item: (args) => oreOf(args?.[0])?.item ?? null,
        thing: (args) => (str(args?.[0]) ? oreName(args[0]) : 'ore'),
        verb: (args) => `collecting ${str(args?.[0]) ? oreName(args[0]) : 'ore'}`,
    }),
    harvest: Object.freeze({
        words: 'the harvest', count: null, defaults: Object.freeze(['']),
        item: () => null, thing: () => null, verb: () => 'harvesting',
    }),
    plant: Object.freeze({
        words: 'the planting', count: null, defaults: Object.freeze(['wheat_seeds', '']),
        item: () => null, thing: () => null, verb: () => 'planting',
    }),
});

/** The kinds of jobs (the names of JOB_COMMANDS). */
export const JOB_KINDS = Object.freeze(Object.keys(JOB_COMMANDS));

/** The commands that are errands: they neither start nor end a job (spec I2). */
export const ERRAND_COMMANDS = Object.freeze(['!followPlayer', '!goToPlayer', '!goToCoordinates', '!goToRememberedPlace', '!goToShelter', '!goToBed',
    '!viewChest', '!chests', '!inventory', '!stats', '!stay', '!eat', '!closeDoor', '!pickUpItems', '!rememberHere', '!rememberArea',
    '!rememberRoute', '!rememberMine', '!rememberTunnel', '!rememberRule', '!routes', '!mines', '!cost', '!help', '!nearbyBlocks',
    '!craftable', '!savedPlaces', '!areas', '!rules', '!lookAtPlayer', '!useOn']);

/** The commands that end the job. */
export const END_COMMANDS = Object.freeze(['!stop', '!endGoal']);

/**
 * The running actions that do not keep the bot from its job: an endless follow is an errand that the job
 * may end after job_resume_seconds without an order (W85).
 */
export const OVERRIDABLE_ACTIONS = Object.freeze(['action:followPlayer']);

/** The states of a job. */
export const JOB_STATES = Object.freeze(['running', 'paused', 'done', 'left']);

/**
 * The entry of JOB_COMMANDS for a command name, with or without `!`; null for any other command.
 * @param {string} commandName
 * @returns {object|null}
 */
export function jobCommand(commandName) {
    const name = cleanCommandName(commandName);
    if (name === null) {
        return null;
    }
    return Object.prototype.hasOwnProperty.call(JOB_COMMANDS, name.slice(1)) ? JOB_COMMANDS[name.slice(1)] : null;
}

// The args of a job command: in the order of the command, the defaults where one is missing.
function fullArgs(def, args) {
    const given = typeof def.order === 'function' ? def.order(args) : (Array.isArray(args) ? [...args] : []);
    const out = [];
    for (let i = 0; i < Math.max(given.length, def.defaults.length); i++) {
        out.push(given[i] === undefined || given[i] === null ? def.defaults[i] : given[i]);
    }
    if (def.count !== null) {
        const n = Number(out[def.count]);
        out[def.count] = Number.isInteger(n) && n >= 1 ? n : def.defaults[def.count];
    }
    return out;
}

// The command text of a job command: the args after the count that hold their default are left out
// (`!mineOre("iron", 10)`, not `!mineOre("iron", 10, false)`).
function callText(kind, def, args) {
    const list = [...args];
    const keep = def.count === null ? 0 : def.count + 1;
    while (list.length > keep && list[list.length - 1] === def.defaults[list.length - 1]) {
        list.pop();
    }
    return commandText(`!${kind}`, list);
}

/**
 * The job record (I1) for a command, state running, or null when the command is no job.
 * @param {string} commandName with or without `!`
 * @param {Array} args the args of the command, as parsed
 * @param {{by?: string, text?: string, now?: string}} [options] by: 'player' (default) or 'model'; text:
 *   the order as typed or as the model gave it; now: the ISO time for started and updated
 * @returns {object|null}
 */
export function jobOf(commandName, args, options = {}) {
    const def = jobCommand(commandName);
    if (!def) {
        return null;
    }
    const kind = cleanCommandName(commandName).slice(1);
    const list = fullArgs(def, args);
    const text = str(options?.text);
    const now = typeof options?.now === 'string' ? options.now : null;
    const wanted = def.count === null ? null : list[def.count];
    return {
        version: 1,
        kind,
        command: text.length > 0 ? text : callText(kind, def, list),
        args: list,
        wanted,
        got: wanted === null ? null : 0,
        words: def.words,
        state: 'running',
        by: options?.by === 'model' ? 'model' : 'player',
        started: now,
        updated: now,
        steps: [],
        plans: 0,
    };
}

/**
 * True for the commands that end the job: `!stop` and `!endGoal`.
 * @param {string} commandName
 * @returns {boolean}
 */
export function endsJob(commandName) {
    return END_COMMANDS.includes(cleanCommandName(commandName));
}

/**
 * True for an errand (ERRAND_COMMANDS).
 * @param {string} commandName
 * @returns {boolean}
 */
export function isErrand(commandName) {
    return ERRAND_COMMANDS.includes(cleanCommandName(commandName));
}

/**
 * True when the job and the new job are the same work: the same kind and the same thing (`iron`). A new
 * order of the same work replaces the job without the leave text.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function sameWork(a, b) {
    if (!isPlainObject(a) || !isPlainObject(b) || a.kind !== b.kind) {
        return false;
    }
    const def = jobCommand(a.kind);
    if (!def) {
        return false;
    }
    return def.thing(a.args) === def.thing(b.args) && def.item(a.args) === def.item(b.args);
}

/**
 * The settings of the job with their defaults: job_resume_seconds (int >= 10, else 60), idle_jobs (the
 * non-empty texts), idle_jobs_minutes (int >= 1, else 15).
 * @param {object} settings
 * @returns {{resumeSeconds: number, idleJobs: string[], idleMinutes: number}}
 */
export function readJobSettings(settings) {
    const s = isPlainObject(settings) ? settings : {};
    const seconds = s.job_resume_seconds;
    const minutes = s.idle_jobs_minutes;
    return {
        resumeSeconds: Number.isInteger(seconds) && seconds >= JOB_RULES.minResumeSeconds ? seconds : JOB_RULES.resumeSeconds,
        idleJobs: Array.isArray(s.idle_jobs) ? s.idle_jobs.filter(e => typeof e === 'string' && e.trim().length > 0).map(e => e.trim()) : [],
        idleMinutes: Number.isInteger(minutes) && minutes >= 1 ? minutes : JOB_RULES.idleMinutes,
    };
}

/**
 * True when the bot goes back to its job now (spec section 5): the job runs, no order came for
 * resumeSeconds, no action runs, the bot does not sleep, and it is not night while the shelter reflex is
 * on. The mining job also waits at night while the bot is not underground.
 * @param {{job: object|null, now: number, lastOrderAt: number|null, actionRunning: boolean, sleeping: boolean,
 *   night: boolean, resumeSeconds: number, nightShelter?: boolean, underground?: boolean}} state night: it is
 *   night; nightShelter: the shelter reflex is on (true when not given); underground: whereAmI().underground
 * @returns {boolean}
 */
export function shouldResume({ job, now, lastOrderAt, actionRunning, sleeping, night, resumeSeconds, nightShelter, underground } = {}) {
    if (!isPlainObject(job) || job.state !== 'running') {
        return false;
    }
    if (!isFiniteNumber(now)) {
        return false;
    }
    const seconds = isFiniteNumber(resumeSeconds) && resumeSeconds >= 0 ? resumeSeconds : JOB_RULES.resumeSeconds;
    if (isFiniteNumber(lastOrderAt) && now - lastOrderAt < seconds * 1000) {
        return false;
    }
    if (actionRunning === true || sleeping === true) {
        return false;
    }
    if (night === true && nightShelter !== false) {
        return false;
    }
    if (night === true && job.kind === 'mineOre' && underground !== true) {
        return false;
    }
    return true;
}

/**
 * The command that goes on with the job: the remaining count for a job with a count
 * (`!mineOre("iron", 10)`), else its command again (as typed). A resumed `!mineOre` never digs a new mine.
 * @param {object} job
 * @returns {string|null}
 */
export function resumeCommand(job) {
    if (!isPlainObject(job)) {
        return null;
    }
    const def = jobCommand(job.kind);
    if (!def) {
        return typeof job.command === 'string' && job.command.length > 0 ? job.command : null;
    }
    if (def.count === null && typeof job.command === 'string' && job.command.length > 0) {
        return job.command;
    }
    const args = fullArgs(def, job.args);
    if (def.count !== null && isFiniteNumber(job.wanted)) {
        const got = isFiniteNumber(job.got) ? job.got : 0;
        args[def.count] = Math.max(1, Math.ceil(job.wanted - got));
    }
    if (job.kind === 'mineOre') {
        args[2] = false;
    }
    return callText(job.kind, def, args);
}

/**
 * True when an inventory item counts for a wanted item: the same name, or any log for `log`, any planks
 * for `planks`, any material of a tool kind (`pickaxe`).
 * @param {string} name the item in the inventory
 * @param {string} item the wanted item
 * @returns {boolean}
 */
export function itemMatches(name, item) {
    if (typeof name !== 'string' || typeof item !== 'string' || item.length === 0) {
        return false;
    }
    if (name === item) {
        return true;
    }
    if (item === 'log' || item === 'planks' || TOOL_KINDS.includes(item)) {
        return name.endsWith(`_${item}`);
    }
    return false;
}

/**
 * The gain of an item: a number as it is, an object { name: gain } summed over the matching names, a
 * function called with the item. 0 for anything else; never below 0.
 * @param {number|object|Function} inventoryGain
 * @param {string|null} item
 * @returns {number}
 */
export function gainOf(inventoryGain, item) {
    let gain = 0;
    try {
        if (isFiniteNumber(inventoryGain)) {
            gain = inventoryGain;
        } else if (typeof item !== 'string' || item.length === 0) {
            gain = 0;
        } else if (typeof inventoryGain === 'function') {
            const value = inventoryGain(item);
            gain = isFiniteNumber(value) ? value : 0;
        } else if (isPlainObject(inventoryGain)) {
            for (const [name, value] of Object.entries(inventoryGain)) {
                if (isFiniteNumber(value) && itemMatches(name, item)) {
                    gain += value;
                }
            }
        }
    } catch {
        gain = 0;
    }
    return Math.max(0, gain);
}

/**
 * The job with got updated: got + the gain of its item, for a job with a count. A copy; the job as it is
 * for a job without a count.
 * @param {object} job
 * @param {number|object|Function} inventoryGain see gainOf
 * @returns {object}
 */
export function progress(job, inventoryGain) {
    if (!isPlainObject(job)) {
        return job;
    }
    const out = { ...job };
    const def = jobCommand(job.kind);
    if (!def || def.count === null || !isFiniteNumber(job.wanted)) {
        return out;
    }
    const item = def.item(fullArgs(def, job.args));
    out.got = (isFiniteNumber(job.got) ? job.got : 0) + gainOf(inventoryGain, item);
    return out;
}

/**
 * True when the job is done: it has a count and got reached it, or the skill said done (skillDone).
 * @param {object} job
 * @returns {boolean}
 */
export function isDone(job) {
    if (!isPlainObject(job)) {
        return false;
    }
    if (job.skillDone === true) {
        return true;
    }
    return isFiniteNumber(job.wanted) && isFiniteNumber(job.got) && job.got >= job.wanted;
}

/**
 * A result of a command as { ok, reason, text }: a pack result as it is; a text with ok false when it
 * reads as a failure (or is a refusal of the repeat guard), else ok undefined.
 * @param {object|string|undefined} result
 * @returns {{ok: boolean|undefined, reason: string|null, text: string}}
 */
export function resultOf(result) {
    if (isPlainObject(result)) {
        return {
            ok: typeof result.ok === 'boolean' ? result.ok : undefined,
            reason: typeof result.reason === 'string' ? result.reason : null,
            text: typeof result.text === 'string' ? result.text : (typeof result.message === 'string' ? result.message : ''),
        };
    }
    if (result === undefined || result === null) {
        return { ok: undefined, reason: 'interrupted', text: '' }; // executeCommand gives undefined for a stopped command
    }
    const text = String(result).replace(/^Action output:\s*/, '').trim();
    const failed = looksLikeFailure(text) || /^I tried .* with the same result\b/.test(text);
    return { ok: failed ? false : undefined, reason: null, text };
}

const WOOD_ITEMS = /^(log|planks|stick|[a-z_]+_log|[a-z_]+_planks)$/;

function missingKind(item) {
    if (WOOD_ITEMS.test(item)) {
        return 'no_wood';
    }
    if (item === 'pickaxe' || item.endsWith('_pickaxe')) {
        return 'no_pickaxe';
    }
    if (TOOL_KINDS.some(kind => item === kind || item.endsWith(`_${kind}`))) {
        return 'no_tool';
    }
    if (item === 'torch' || item === 'torches') {
        return 'no_torches';
    }
    return 'no_item';
}

/**
 * The blocker in a failed result of a skill (spec section 5): the reasons no_pickaxe, no_tool, no_item and
 * no_supplies, the reason pickaxe of the mining pack, and the texts `I have no torches`, `I need N <item>
 * ... and have none` (or fewer), `I carry no food`, `no pickaxe`. null for a result that succeeded, was
 * stopped, or failed for another reason.
 * @param {object|string} result
 * @returns {{kind: 'no_torches'|'no_pickaxe'|'no_tool'|'no_wood'|'no_item', item: string|null}|null}
 */
export function blockerOf(result) {
    try {
        const r = resultOf(result);
        if (r.ok === true || r.reason === 'interrupted') {
            return null;
        }
        const text = r.text;
        if (/\bI have no torches\b/i.test(text)) {
            return { kind: 'no_torches', item: 'torch' };
        }
        const need = text.match(/\bI need (\d+) ([a-z_]+)\b.*?\band have (none|\d+)/);
        if (need && (need[3] === 'none' || Number(need[3]) < Number(need[1]))) {
            return { kind: missingKind(need[2]), item: need[2] };
        }
        if (/\bI carry no food\b/i.test(text)) {
            return { kind: 'no_item', item: 'food' };
        }
        const pickaxe = text.match(/\bI need an? (wooden|stone|iron|golden|diamond|netherite) pickaxe\b/);
        if (r.reason === 'no_pickaxe' || r.reason === 'pickaxe' || pickaxe || /\bno pickaxe\b/i.test(text)) {
            return { kind: 'no_pickaxe', item: pickaxe ? `${pickaxe[1]}_pickaxe` : 'pickaxe' };
        }
        const named = text.match(/\bI (?:have|carry) no ([a-z_]+)/);
        if (r.reason === 'no_tool') {
            const tool = named && TOOL_KINDS.some(kind => named[1] === kind || named[1].endsWith(`_${kind}`)) ? named[1] : null;
            return { kind: 'no_tool', item: tool };
        }
        if (r.reason === 'no_item' || r.reason === 'no_supplies') {
            const item = named ? named[1] : null;
            return { kind: item ? missingKind(item) : 'no_item', item: item === 'torches' ? 'torch' : item };
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * The command text of an entry of idle_jobs: a command as it is (`!farmCycle("farm")`); the short form of
 * the plan, `farmCycle farm` or `craftSupplies torch 32`, as a command. null for an empty entry.
 * @param {string} entry
 * @returns {string|null}
 */
export function idleCommandText(entry) {
    const text = str(entry);
    if (text.length === 0) {
        return null;
    }
    if (text.startsWith('!')) {
        return text;
    }
    const words = text.split(/\s+/);
    if (!/^\w+$/.test(words[0])) {
        return null;
    }
    const args = words.slice(1).map(w => (/^-?\d+$/.test(w) ? Number(w) : w.replace(/^["']|["']$/g, '')));
    return commandText(`!${words[0]}`, args);
}

/**
 * The entry of idle_jobs to run now (spec section 5): the first one, in order, that never ran or ran
 * `minutes` or more ago; as its command text (idleCommandText). lastRun is keyed by that text.
 * @param {{idleJobs: string[], lastRun: Object<string, number>, now: number, minutes: number}} state
 * @returns {string|null}
 */
export function nextIdleJob({ idleJobs, lastRun, now, minutes } = {}) {
    if (!Array.isArray(idleJobs) || !isFiniteNumber(now)) {
        return null;
    }
    const wait = (isFiniteNumber(minutes) && minutes > 0 ? minutes : JOB_RULES.idleMinutes) * 60 * 1000;
    const runs = isPlainObject(lastRun) ? lastRun : {};
    for (const entry of idleJobs) {
        const command = idleCommandText(entry);
        if (command === null) {
            continue;
        }
        const at = runs[command];
        if (!isFiniteNumber(at) || now - at >= wait) {
            return command;
        }
    }
    return null;
}
