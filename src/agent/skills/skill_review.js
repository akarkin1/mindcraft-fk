// Pure helpers for the review of a code run that may become a saved skill:
// state snapshots before and after the run, the task of the run, the review
// prompt and the parsing of the model's verdict. No side effects at import.
import { isModelErrorResponse } from '../../utils/model_errors.js';

const NEW_ACTION = '!newAction(';
const TASK_MAX = 300;
const DESCRIPTION_MAX = 200;
const NONE = '(none)';
const REVIEW_PLACEHOLDERS = /\$(STATE_CHANGE|SKILL_LIST|OUTPUT|NAME|TASK|CODE)/g;
const PLACEHOLDER_KEYS = {
    NAME: 'name',
    TASK: 'task',
    CODE: 'code',
    OUTPUT: 'output',
    STATE_CHANGE: 'stateChange',
    SKILL_LIST: 'skillList',
};
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function readProperty(value, key) {
    try {
        return isObject(value) || typeof value === 'function' ? value[key] : undefined;
    } catch {
        return undefined;
    }
}

function copyPosition(position) {
    try {
        if (!isObject(position)) {
            return null;
        }
        const x = position.x;
        const y = position.y;
        const z = position.z;
        if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
            return null;
        }
        return { x, y, z };
    } catch {
        return null;
    }
}

function numberOrNull(value) {
    return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

/**
 * State of the bot at one moment, for comparing before and after a code run.
 * `inventory` is the result of getInventoryCounts(bot), or {} if that throws or
 * returns no object. `position` is a copy of bot.entity.position, `health` and
 * `food` come from the bot; each is null when missing. Never throws.
 * @param {object} bot
 * @param {function(object): object} getInventoryCounts
 * @returns {{inventory: object, position: {x: number, y: number, z: number}|null, health: number|null, food: number|null}}
 */
export function snapshotState(bot, getInventoryCounts) {
    let inventory = {};
    try {
        const counts = getInventoryCounts(bot);
        if (isObject(counts)) {
            inventory = counts;
        }
    } catch {
        inventory = {};
    }
    const entity = readProperty(bot, 'entity');
    return {
        inventory,
        position: copyPosition(readProperty(entity, 'position')),
        health: numberOrNull(readProperty(bot, 'health')),
        food: numberOrNull(readProperty(bot, 'food')),
    };
}

function countsOf(snapshot) {
    const counts = new Map();
    try {
        const inventory = readProperty(snapshot, 'inventory');
        if (!isObject(inventory)) {
            return counts;
        }
        for (const key of Object.keys(inventory)) {
            const value = inventory[key];
            if (isFiniteNumber(value)) {
                counts.set(key, value);
            }
        }
    } catch {
        return new Map();
    }
    return counts;
}

function distanceBetween(before, after) {
    const from = copyPosition(readProperty(before, 'position'));
    const to = copyPosition(readProperty(after, 'position'));
    if (from === null || to === null) {
        return 0;
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const rounded = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 10) / 10;
    return Number.isFinite(rounded) ? rounded : 0;
}

function defineCount(target, name, count) {
    Object.defineProperty(target, name, { value: count, enumerable: true, writable: true, configurable: true });
}

/**
 * Difference of two snapshots of snapshotState. Missing or broken snapshots
 * count as empty. Never throws.
 * `text` is for example `Inventory: +3 oak_log, -1 dirt. Moved 12.3 blocks.`
 * (gained first, each group sorted by name) or `Inventory unchanged. Did not move.`
 * @param {object} before
 * @param {object} after
 * @returns {{gained: Object<string, number>, lost: Object<string, number>, moved: number, text: string}}
 *     gained and lost map item names to positive numbers, moved is the distance rounded to
 *     1 decimal, 0 when a position is missing.
 */
export function diffState(before, after) {
    const gained = {};
    const lost = {};
    const oldCounts = countsOf(before);
    const newCounts = countsOf(after);
    const names = [...new Set([...oldCounts.keys(), ...newCounts.keys()])].sort(compareNames);
    const gainedParts = [];
    const lostParts = [];
    for (const name of names) {
        const delta = (newCounts.get(name) ?? 0) - (oldCounts.get(name) ?? 0);
        if (!Number.isFinite(delta) || delta === 0) {
            continue;
        }
        if (delta > 0) {
            defineCount(gained, name, delta);
            gainedParts.push(`+${delta} ${name}`);
        } else {
            defineCount(lost, name, -delta);
            lostParts.push(`-${-delta} ${name}`);
        }
    }
    const moved = distanceBetween(before, after);
    const parts = [...gainedParts, ...lostParts];
    let text = parts.length > 0 ? `Inventory: ${parts.join(', ')}.` : 'Inventory unchanged.';
    text += moved < 0.5 ? ' Did not move.' : ` Moved ${moved} blocks.`;
    return { gained, lost, moved, text };
}

function contentOf(message) {
    const content = readProperty(message, 'content');
    return typeof content === 'string' ? content : null;
}

function roleOf(message) {
    return readProperty(message, 'role');
}

// The quoted argument of the first !newAction( in the text, or null.
function taskFromCommand(content) {
    const at = content.indexOf(NEW_ACTION);
    if (at === -1) {
        return null;
    }
    const open = content.indexOf('"', at + NEW_ACTION.length);
    if (open === -1) {
        return null;
    }
    // The closing ')' of the command is the first ')' whose nearest character
    // before it (spaces aside) is a '"' after the opening one. A ')' inside the
    // quoted text is skipped that way, and so is a '"' inside it.
    let from = open + 1;
    while (from < content.length) {
        const close = content.indexOf(')', from);
        if (close === -1) {
            break;
        }
        const inside = content.slice(open + 1, close).trimEnd();
        if (inside.endsWith('"')) {
            return inside.slice(0, -1);
        }
        from = close + 1;
    }
    // no closing ')': up to the last '"' of the text, if there is one
    const last = content.lastIndexOf('"');
    return last > open ? content.slice(open + 1, last) : null;
}

/**
 * The task of a code run, from the conversation that led to it.
 * From the last message whose role is not `system` and whose content contains
 * `!newAction(`: the quoted text of that command. If there is none (or it has no
 * quoted text): the content of the last message with role `user`. Cut to 300
 * characters. Never throws.
 * @param {{role: string, content: string}[]} messages
 * @returns {string} '' when nothing is found.
 */
export function extractTask(messages) {
    try {
        if (!Array.isArray(messages)) {
            return '';
        }
        let task = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            const content = contentOf(message);
            if (content === null || roleOf(message) === 'system' || !content.includes(NEW_ACTION)) {
                continue;
            }
            task = taskFromCommand(content);
            break;
        }
        if (task === null) {
            for (let i = messages.length - 1; i >= 0; i--) {
                const message = messages[i];
                const content = contentOf(message);
                if (roleOf(message) === 'user' && content !== null) {
                    task = content;
                    break;
                }
            }
        }
        return task === null ? '' : task.slice(0, TASK_MAX);
    } catch {
        return '';
    }
}

function valueText(value) {
    if (value === undefined || value === null || value === '') {
        return NONE;
    }
    try {
        return String(value);
    } catch {
        return NONE;
    }
}

/**
 * Fills the review template. `$NAME`, `$TASK`, `$CODE`, `$OUTPUT`,
 * `$STATE_CHANGE` and `$SKILL_LIST` become values.name, task, code, output,
 * stateChange and skillList. A missing value (undefined, null or '') becomes
 * `(none)`. The template is scanned once, so a `$` or a placeholder inside a
 * value arrives unchanged. Never throws.
 * @param {string} template
 * @param {{name?: string, task?: string, code?: string, output?: string, stateChange?: string, skillList?: string}} values
 * @returns {string} '' when template is not a string.
 */
export function buildReviewPrompt(template, values) {
    if (typeof template !== 'string') {
        return '';
    }
    const source = isObject(values) ? values : {};
    return template.replace(REVIEW_PLACEHOLDERS, (match, key) => valueText(readProperty(source, PLACEHOLDER_KEYS[key])));
}

function oneLine(value) {
    if (typeof value !== 'string') {
        return '';
    }
    return value.replace(/\r\n|\r|\n/g, ' ').trim().slice(0, DESCRIPTION_MAX);
}

function failedReview() {
    return { ok: false, achieved: false, reusable: false, description: '', reason: '' };
}

/**
 * Reads the verdict of the review model. The JSON object is the text from the
 * first `{` to the last `}`, so code fences and text around it are tolerated.
 * `ok` is false when the text is a model error (isModelErrorResponse), when no
 * JSON object is found, or when `achieved` or `reusable` is not a boolean; then
 * the other fields are false and ''. `description` and `reason` have line breaks
 * turned into spaces, are trimmed and cut to 200 characters, '' when missing.
 * Never throws.
 * @param {string} text
 * @returns {{ok: boolean, achieved: boolean, reusable: boolean, description: string, reason: string}}
 */
export function parseReview(text) {
    try {
        if (isModelErrorResponse(text)) {
            return failedReview();
        }
        let body = text;
        if (body.trimStart().startsWith(THINK_OPEN)) {
            const end = body.indexOf(THINK_CLOSE);
            if (end !== -1) {
                body = body.slice(end + THINK_CLOSE.length);
            }
        }
        const start = body.indexOf('{');
        const end = body.lastIndexOf('}');
        if (start === -1 || end < start) {
            return failedReview();
        }
        let data;
        try {
            data = JSON.parse(body.slice(start, end + 1));
        } catch {
            return failedReview();
        }
        if (!isObject(data) || Array.isArray(data)) {
            return failedReview();
        }
        if (typeof data.achieved !== 'boolean' || typeof data.reusable !== 'boolean') {
            return failedReview();
        }
        return {
            ok: true,
            achieved: data.achieved,
            reusable: data.reusable,
            description: oneLine(data.description),
            reason: oneLine(data.reason),
        };
    } catch {
        return failedReview();
    }
}
