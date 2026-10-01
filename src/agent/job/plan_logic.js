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
    Object.freeze({ name: '!smeltItem', usage: '!smeltItem(item_name, num)', description: 'Smelt an item num times in a furnace near you.',
        params: Object.freeze([{ type: 'string' }, { type: 'int' }]) }),
]);

/** The names of PLAN_COMMANDS. */
export const PLAN_COMMAND_NAMES = Object.freeze(PLAN_COMMANDS.map(c => c.name));

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
 * command without a count of items (`!getTool`, `!craftRecipe`, `!smeltItem`), which is done when it
 * returns ok.
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
            return { item: a[0], count: null };
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
 * The text the model gets for a plan: the job, the blocker (and the text of the failed skill, blocker.text),
 * what the bot carries, the commands it may use, and the format of the answer.
 * @param {object} job the job record (I1)
 * @param {{kind: string, item: string|null, text?: string}} blocker
 * @param {object|Array} inventory { name: count } or [{ name, count }]
 * @param {Array} [commands] names or { name, usage, description }; PLAN_COMMANDS without
 * @returns {string}
 */
export function planPrompt(job, blocker, inventory, commands) {
    const j = isPlainObject(job) ? job : {};
    const count = isFiniteNumber(j.wanted) ? `, ${isFiniteNumber(j.got) ? j.got : 0} of ${j.wanted} done` : '';
    const b = isPlainObject(blocker) ? blocker : {};
    const problem = [`${b.kind ?? 'unknown'}${b.item ? ` (${b.item})` : ''}`];
    if (typeof b.text === 'string' && b.text.trim().length > 0) {
        problem.push(`the skill said: "${b.text.trim()}"`);
    }
    return [
        'You plan the steps of a Minecraft bot. Its job stopped because something is missing.',
        `The job: ${j.command ?? resumeCommand(j) ?? 'unknown'}${count}.`,
        `What is missing: ${problem.join(', ')}.`,
        `What the bot carries: ${inventoryText(inventory)}.`,
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
