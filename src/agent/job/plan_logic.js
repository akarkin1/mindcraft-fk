// The steps that remove a blocker of the job (spec v0.1.4.10, I2): the prompt for the model, the answer
// read as steps, and when a step is done. Only the commands of the wood, storage and crafting kind may be
// steps. Pure. Nothing here throws.
import { commandText } from '../repeat_guard.js';
import { JOB_RULES, dropOf, itemMatches, resumeCommand } from './job_logic.js';

/**
 * The commands a plan may use, with their params (type int or string, a default or none) and the line
 * the prompt shows. `either`: !chopTrees takes its two args in either order.
 */
export const PLAN_COMMANDS = Object.freeze([
    Object.freeze({ name: '!chopTrees', usage: '!chopTrees(num, kind)', description: 'Cut trees until you carry num logs. kind is the wood, for example "oak", "" for any.',
        params: Object.freeze([{ type: 'int', default: 8 }, { type: 'string', default: '' }]), either: true }),
    Object.freeze({ name: '!craftSupplies', usage: '!craftSupplies(item, num)', description: 'Craft num torch, ladder, chest, crafting_table, stick or planks, with the wood it needs.',
        params: Object.freeze([{ type: 'string' }, { type: 'int', default: 1 }]) }),
    Object.freeze({ name: '!craftRecipe', usage: '!craftRecipe(recipe_name, num)', description: 'Craft a recipe num times (not num items).',
        params: Object.freeze([{ type: 'string' }, { type: 'int', default: 1 }]) }),
    Object.freeze({ name: '!getTool', usage: '!getTool(kind, material)', description: 'Take a tool from a chest you know or craft it: pickaxe, axe, shovel, hoe or sword; material wooden, stone, iron or diamond, "" for the best you can make.',
        params: Object.freeze([{ type: 'string' }, { type: 'string', default: '' }]) }),
    Object.freeze({ name: '!fetchItem', usage: '!fetchItem(item_name, num)', description: 'Take num of an item out of a chest you know.',
        params: Object.freeze([{ type: 'string' }, { type: 'int', default: 1 }]) }),
    Object.freeze({ name: '!collectBlocks', usage: '!collectBlocks(type, num)', description: 'Mine num blocks of a type near you.',
        params: Object.freeze([{ type: 'string' }, { type: 'int', default: 1 }]) }),
    Object.freeze({ name: '!smeltItem', usage: '!smeltItem(item_name, num)', description: 'Smelt num of an item in a furnace: raw_iron to iron_ingot, raw_copper, raw_gold, sand to glass, logs to charcoal.',
        params: Object.freeze([{ type: 'string' }, { type: 'int' }]) }),
]);

/**
 * What a furnace makes of an item, for the check of a step !smeltItem (spec v0.1.4.12, 4.2). The same table as
 * SMELT_PRODUCTS of the storage pack (smelt_logic.js), which the job module may not import (no pack here); a
 * unit test keeps the two equal.
 */
export const SMELT_PRODUCTS = Object.freeze({
    raw_iron: 'iron_ingot', raw_copper: 'copper_ingot', raw_gold: 'gold_ingot',
    iron_ore: 'iron_ingot', deepslate_iron_ore: 'iron_ingot', copper_ore: 'copper_ingot', deepslate_copper_ore: 'copper_ingot',
    gold_ore: 'gold_ingot', deepslate_gold_ore: 'gold_ingot',
    sand: 'glass', red_sand: 'glass', cobblestone: 'stone', clay_ball: 'brick',
    beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit',
    cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato', kelp: 'dried_kelp', netherrack: 'nether_brick', cactus: 'green_dye',
});

/**
 * The product of smelting an item: SMELT_PRODUCTS, a log or wood that burns gives charcoal; null for anything
 * else. `minecraft:` and case do not matter.
 * @param {string} item
 * @returns {string|null}
 */
export function productOf(item) {
    const n = typeof item === 'string' ? item.trim().toLowerCase().replace(/^minecraft:/, '') : '';
    if (n === '') {
        return null;
    }
    if (Object.hasOwn(SMELT_PRODUCTS, n)) {
        return SMELT_PRODUCTS[n];
    }
    return /^[a-z_]+_(log|wood)$/.test(n) && !/^(stripped_)?(crimson|warped)_/.test(n) ? 'charcoal' : null;
}

/**
 * The supplies a plan makes with !smeltItem (spec v0.1.4.12, 4.2): the product and the item smelted for it.
 */
export const SMELT_SUPPLIES = Object.freeze({ iron_ingot: 'raw_iron', copper_ingot: 'raw_copper', gold_ingot: 'raw_gold' });

/** The iron ingots an iron tool takes (the recipes of the wood pack). */
export const IRON_TOOL_INGOTS = Object.freeze({ pickaxe: 3, axe: 3, sword: 2, shovel: 1, hoe: 2 });

/** The names of PLAN_COMMANDS. */
export const PLAN_COMMAND_NAMES = Object.freeze(PLAN_COMMANDS.map(c => c.name));

/**
 * The steps that need the surface (a tree, a chest or a crafting table, T3-1 of the decisions): an
 * underground bot leaves the mine before it runs one.
 */
export const SURFACE_COMMANDS = Object.freeze(['!chopTrees', '!fetchItem', '!craftSupplies', '!craftRecipe', '!getTool', '!collectBlocks']);

/** The way out of the mine that runs before a surface step underground. */
export const WAY_OUT_COMMAND = '!leaveMine';

/** At most this many chests, and this many kinds per chest, in the plan prompt. */
export const PROMPT_CHESTS = 8;
export const PROMPT_CHEST_KINDS = 12;

/**
 * True when the command text of a step needs the surface (SURFACE_COMMANDS).
 * @param {string} command `!fetchItem("oak_log", 8)`
 * @returns {boolean}
 */
export function needsSurface(command) {
    const name = typeof command === 'string' ? command.trim().match(/^!?(\w+)/)?.[1] : null;
    return typeof name === 'string' && SURFACE_COMMANDS.includes(`!${name}`);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * An inventory as { name: count }: from such an object, or from a list of { name, count }.
 * @param {object|Array} inventory
 * @returns {Object<string, number>}
 */
export function inventoryCounts(inventory) {
    const out = {};
    if (Array.isArray(inventory)) {
        for (const entry of inventory) {
            if (entry && typeof entry.name === 'string' && isFiniteNumber(entry.count)) {
                out[entry.name] = (out[entry.name] ?? 0) + entry.count;
            }
        }
    } else if (isPlainObject(inventory)) {
        for (const [name, count] of Object.entries(inventory)) {
            if (isFiniteNumber(count)) {
                out[name] = count;
            }
        }
    }
    return out;
}

/**
 * How many of an item the inventory holds (itemMatches: any log for `log`, ...).
 * @param {object|Array} inventory
 * @param {string} item
 * @returns {number}
 */
export function countIn(inventory, item) {
    let n = 0;
    for (const [name, count] of Object.entries(inventoryCounts(inventory))) {
        if (itemMatches(name, item)) {
            n += count;
        }
    }
    return n;
}

// craftSupplies takes "torches" or "sticks" from the model too; the check counts the item.
function supplyItem(name) {
    const clean = String(name).trim().toLowerCase();
    return ({ torches: 'torch', sticks: 'stick', ladders: 'ladder', chests: 'chest', plank: 'planks' })[clean] ?? clean;
}

/**
 * The check of a step from its command (I1): the item and the count the command names; count null for a
 * command without a count of items (`!getTool`, `!craftRecipe`), which is done when it returns ok. Since
 * v0.1.4.12 (4.2) `!smeltItem` checks its product (productOf): the step is done when the ingots are there.
 * @param {string} name the command with `!`
 * @param {Array} args the full args (defaults filled in)
 * @returns {{item: string|null, count: number|null}}
 */
export function checkOf(name, args) {
    const a = Array.isArray(args) ? args : [];
    switch (name) {
        case '!chopTrees':
            return { item: a[1] ? `${String(a[1]).toLowerCase()}_log` : 'log', count: a[0] };
        case '!craftSupplies':
            return { item: supplyItem(a[0]), count: a[1] };
        case '!craftRecipe':
            return { item: a[0], count: null };
        case '!getTool':
            return { item: a[1] ? `${a[1]}_${a[0]}` : a[0], count: null };
        case '!fetchItem':
            return { item: a[0], count: a[1] };
        case '!collectBlocks':
            return { item: dropOf(a[0]), count: a[1] };
        case '!smeltItem':
            return { item: productOf(a[0]), count: a[1] ?? null };
        default:
            return { item: null, count: null };
    }
}

function inventoryText(inventory) {
    const entries = Object.entries(inventoryCounts(inventory)).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b));
    return entries.length > 0 ? entries.map(([name, n]) => `${n} ${name}`).join(', ') : 'nothing';
}

function commandLines(commands) {
    const list = Array.isArray(commands) && commands.length > 0 ? commands : PLAN_COMMANDS;
    return list.map(c => {
        if (typeof c === 'string') {
            const known = PLAN_COMMANDS.find(p => p.name === c);
            return known ? `${known.usage}: ${known.description}` : c;
        }
        if (isPlainObject(c) && typeof c.name === 'string') {
            return `${c.usage ?? c.name}: ${c.description ?? ''}`.trim();
        }
        return null;
    }).filter(Boolean);
}

// The names a plan may use: the names of the list (strings or { name }), PLAN_COMMAND_NAMES without one.
function allowedNames(commands) {
    const list = Array.isArray(commands) && commands.length > 0 ? commands : PLAN_COMMAND_NAMES;
    return list.map(c => (typeof c === 'string' ? c : c?.name)).filter(n => typeof n === 'string')
        .map(n => (n.startsWith('!') ? n : `!${n}`));
}

/**
 * Every missing supply of a blocker (T3-1): the blocker itself, and for a mining job the other supply the
 * trip needs and the bot does not carry: a pickaxe, torches. Each kind once, the blocker first.
 * Since v0.1.4.12 (4.2) a supply that a furnace makes has `smelt`, the step that makes it: iron_ingot
 * `!smeltItem("raw_iron", n)`; an iron tool (or `no_iron`) also needs its iron_ingot, with the count of
 * the tool: `{ kind: 'no_item', item: 'iron_ingot', smelt: '!smeltItem("raw_iron", 3)' }` for a pickaxe.
 * @param {object} job the job record (I1)
 * @param {{kind: string, item: string|null}} blocker
 * @param {object|Array} inventory { name: count } or [{ name, count }]
 * @returns {{kind: string, item: string|null}[]}
 */
export function missingSupplies(job, blocker, inventory) {
    const b = isPlainObject(blocker) ? blocker : {};
    const out = [{ kind: typeof b.kind === 'string' ? b.kind : 'unknown', item: typeof b.item === 'string' ? b.item : null }];
    try {
        const first = out[0];
        const item = first.item === 'iron' || first.item === 'raw_iron' ? 'iron_ingot' : first.item;
        if (item !== null && Object.hasOwn(SMELT_SUPPLIES, item)) {
            first.smelt = `!smeltItem("${SMELT_SUPPLIES[item]}", n)`;
        }
        const tool = typeof first.item === 'string' ? first.item.match(/^iron_(pickaxe|axe|sword|shovel|hoe)$/) : null;
        if (tool || first.kind === 'no_iron') {
            const n = tool ? IRON_TOOL_INGOTS[tool[1]] : 'n';
            out.push({ kind: 'no_item', item: 'iron_ingot', smelt: `!smeltItem("raw_iron", ${n})` });
        }
    } catch {
        // the blocker alone
    }
    try {
        if (isPlainObject(job) && job.kind === 'mineOre') {
            const counts = inventoryCounts(inventory);
            const has = (test) => Object.entries(counts).some(([name, n]) => n > 0 && test(name));
            if (!has(name => name.endsWith('_pickaxe'))) {
                out.push({ kind: 'no_pickaxe', item: 'pickaxe' });
            }
            if (!has(name => name === 'torch')) {
                out.push({ kind: 'no_torches', item: 'torch' });
            }
        }
    } catch {
        // the blocker alone
    }
    return out.filter((m, i) => out.findIndex(o => o.kind === m.kind || (o.item !== null && o.item === m.item)) === i);
}

function posText(pos) {
    return `(${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)})`;
}

// `Where the bot is: underground in the mine "mine". ...` or `on the surface`; null when it is not known.
function whereText(where) {
    if (!isPlainObject(where) || typeof where.underground !== 'boolean') {
        return null;
    }
    if (where.underground) {
        const mine = typeof where.mine?.name === 'string' && where.mine.name.length > 0 ? ` in the mine "${where.mine.name}"` : '';
        return `Where the bot is: underground${mine}. Before a step that needs a tree, a chest or a crafting table it leaves the mine by itself.`;
    }
    const area = typeof where.area?.name === 'string' && where.area.name.length > 0 ? `, in "${where.area.name}"` : '';
    return `Where the bot is: on the surface${area}.`;
}

// The lines of the known chests, the nearest first when the position of the bot is given; null when the
// chests are not known (no reader).
function chestLines(chests, pos) {
    if (!Array.isArray(chests)) {
        return null;
    }
    const valid = chests.filter(c => isPlainObject(c) && isFiniteNumber(c.x) && isFiniteNumber(c.y) && isFiniteNumber(c.z));
    const items = c => Object.entries(isPlainObject(c.items) ? c.items : {}).filter(([, n]) => isFiniteNumber(n) && n > 0);
    const full = valid.filter(c => items(c).length > 0);
    if (full.length === 0) {
        return ['The chests the bot knows: none with items.'];
    }
    const here = isPlainObject(pos) && isFiniteNumber(pos.x) && isFiniteNumber(pos.y) && isFiniteNumber(pos.z) ? pos : null;
    const dist = c => (here ? (c.x - here.x) ** 2 + (c.y - here.y) ** 2 + (c.z - here.z) ** 2 : 0);
    const shown = [...full].sort((a, b) => dist(a) - dist(b)).slice(0, PROMPT_CHESTS);
    return ['The chests the bot knows and what they hold:', ...shown.map(c => {
        const kinds = items(c).sort(([a, n], [b, m]) => m - n || a.localeCompare(b)).slice(0, PROMPT_CHEST_KINDS);
        return `the chest at ${posText(c)}: ${kinds.map(([name, n]) => `${n} ${name}`).join(', ')}`;
    })];
}

/**
 * The text the model gets for a plan: the job, every missing supply (missingSupplies) and the text of the
 * failed skill (blocker.text), where the bot is, what the bot carries, the chests it knows and what they
 * hold, the commands it may use, and the format of the answer. The first line never changes.
 * @param {object} job the job record (I1)
 * @param {{kind: string, item: string|null, text?: string}} blocker
 * @param {object|Array} inventory { name: count } or [{ name, count }]
 * @param {Array} [commands] names or { name, usage, description }; PLAN_COMMANDS without
 * @param {{where?: {underground: boolean, mine?: object, area?: object}, chests?: object[], pos?: {x, y, z}}} [context]
 *   where: whereAmI of the agent; chests: the chests of the chest index ({ x, y, z, items }); pos: the bot.
 *   A part that is not given is left out.
 * @returns {string}
 */
export function planPrompt(job, blocker, inventory, commands, context = {}) {
    const j = isPlainObject(job) ? job : {};
    const c = isPlainObject(context) ? context : {};
    const count = isFiniteNumber(j.wanted) ? `, ${isFiniteNumber(j.got) ? j.got : 0} of ${j.wanted} done` : '';
    const b = isPlainObject(blocker) ? blocker : {};
    const problem = missingSupplies(j, b, inventory).map(m => `${m.kind}${m.item ? ` (${m.item}${m.smelt ? `, made by ${m.smelt}` : ''})` : ''}`);
    if (typeof b.text === 'string' && b.text.trim().length > 0) {
        problem.push(`the skill said: "${b.text.trim()}"`);
    }
    const where = whereText(c.where);
    const chests = chestLines(c.chests, c.pos);
    return [
        'You plan the steps of a Minecraft bot. Its job stopped because something is missing.',
        `The job: ${j.command ?? resumeCommand(j) ?? 'unknown'}${count}.`,
        `What is missing: ${problem.join(', ')}.`,
        ...(where ? [where] : []),
        `What the bot carries: ${inventoryText(inventory)}.`,
        ...(chests ?? []),
        'The commands you may use:',
        ...commandLines(commands),
        `Answer with the steps that get what is missing, one command per line, in the order the bot runs them, at most ${JOB_RULES.maxSteps} lines.`,
        'Write the commands with their arguments, strings in double quotes, for example !craftSupplies("stick", 8). Use no other command and write nothing else.',
        'After the steps the bot goes back to its job by itself; do not write the job command.',
        'When no steps can help, answer NONE.',
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

// The args checked against the params of the command: ints >= 1, texts; the defaults filled in. null when
// they do not fit. given: the args as written (in the order of the command).
function fitArgs(command, args) {
    let a = [...args];
    if (command.either && typeof a[0] === 'string' && !/^\d+$/.test(a[0]) && (isFiniteNumber(a[1]) || /^\d+$/.test(String(a[1] ?? '')))) {
        a = [a[1], a[0]];
    }
    if (a.length > command.params.length) {
        return null;
    }
    const given = [];
    const full = [];
    for (let i = 0; i < command.params.length; i++) {
        const param = command.params[i];
        let value = a[i];
        if (value === undefined) {
            if (param.default === undefined) {
                return null;
            }
            full.push(param.default);
            continue;
        }
        if (param.type === 'int') {
            value = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
            if (!Number.isInteger(value) || value < 1) {
                return null;
            }
        } else if (typeof value !== 'string') {
            return null;
        }
        given.push(value);
        full.push(value);
    }
    return { given, full };
}

/**
 * The steps in the answer of the model (I2): each command of the answer in order, with its check
 * (checkOf) and state todo. null when the answer is no plan: no command, NONE, more than 6 commands, a
 * command outside the list, or args that do not fit the command.
 * @param {string} answer
 * @param {Array} [commands] the names (or { name }) the plan may use; PLAN_COMMAND_NAMES without
 * @returns {{command: string, check: {item: string|null, count: number|null}, state: 'todo'}[]|null}
 */
export function parsePlan(answer, commands) {
    try {
        if (typeof answer !== 'string') {
            return null;
        }
        const allowed = allowedNames(commands);
        const steps = [];
        for (const m of answer.matchAll(COMMAND)) {
            const name = `!${m[1]}`;
            const command = PLAN_COMMANDS.find(c => c.name === name);
            if (!allowed.includes(name) || !command) {
                return null;
            }
            const args = readArgs(m[2]);
            const fit = args === null ? null : fitArgs(command, args);
            if (fit === null) {
                return null;
            }
            steps.push({ command: commandText(name, fit.given), check: checkOf(name, fit.full), state: 'todo' });
        }
        if (steps.length === 0 || steps.length > JOB_RULES.maxSteps) {
            return null;
        }
        return steps;
    } catch {
        return null;
    }
}

/**
 * True when a step is done: a step with a count when the inventory holds that many of its item; a step
 * without a count when its command returned ok (or it is marked done).
 * @param {{check: {item: string|null, count: number|null}, state?: string}} step
 * @param {object|Array} inventory { name: count } or [{ name, count }]
 * @param {boolean} [ok] the command of the step returned ok
 * @returns {boolean}
 */
export function stepDone(step, inventory, ok) {
    if (!isPlainObject(step)) {
        return false;
    }
    const check = isPlainObject(step.check) ? step.check : {};
    if (isFiniteNumber(check.count) && typeof check.item === 'string') {
        return countIn(inventory, check.item) >= check.count;
    }
    return ok === true || step.state === 'done';
}
