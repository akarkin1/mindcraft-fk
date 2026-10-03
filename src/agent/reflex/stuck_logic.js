// What counts as stuck for the mode unstuck, and what happens after its escape (spec v0.1.4.8, A1 and A2).
// Pure: no imports, no mineflayer. Positions are {x, y, z}, times are milliseconds.

export const STUCK_RULES = Object.freeze({
    limitMs: 20000,          // stuck after 20 s without progress
    obsidianLimitMs: 40000,  // 40 s while the bot digs obsidian
    moveBlocks: 2,           // moving this far is progress; an escape must get the bot this far
    escapeMs: 10000,         // the time limit of moveAway(5) with stuck_restart_after 1, as in v0.1.4.7
    escapeLongMs: 20000,     // with every other value: the door help of moveAway can need about 10 s more
    escapeDistance: 5,       // the distance of moveAway
    doorRange: 3,            // the door, gate or trapdoor named in the text of a failed escape
});

export const STUCK_TEXT = "I'm stuck!";
export const FREE_TEXT = "I'm free.";
export const KILL_TEXT = "Got stuck and couldn't get unstuck";

function isPoint(p) {
    return p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

/**
 * The distance of two positions; Infinity when one of them is no position.
 * @param {{x,y,z}} a
 * @param {{x,y,z}} b
 * @returns {number}
 */
export function distance(a, b) {
    if (!isPoint(a) || !isPoint(b))
        return Infinity;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * A short text of the counts of all slots of the inventory, the off-hand (slot 45) included, for
 * example "36:12,45:6". Empty slots are left out. '' for anything that is not an array.
 * @param {Array<{count: number}|null>} slots bot.inventory.slots
 * @returns {string}
 */
export function inventoryKey(slots) {
    if (!Array.isArray(slots))
        return '';
    const parts = [];
    slots.forEach((item, index) => {
        if (item && Number.isFinite(item.count) && item.count > 0)
            parts.push(`${index}:${item.count}`);
    });
    return parts.join(',');
}

// The dig target as a text: name and position; null when the bot digs nothing.
function digKey(target) {
    if (!target || typeof target !== 'object')
        return null;
    const p = isPoint(target.position) ? target.position : target;
    const at = isPoint(p) ? `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}` : '?';
    return `${target.name ?? '?'}@${at}`;
}

/**
 * The time without progress after which the bot is stuck: 40 s while it digs obsidian, else 20 s.
 * @param {{digTarget?: {name: string}|null}} sample
 * @returns {number}
 */
export function stuckLimitMs(sample) {
    return sample?.digTarget?.name === 'obsidian' ? STUCK_RULES.obsidianLimitMs : STUCK_RULES.limitMs;
}

/** A state without a start: the next sample starts the stuck time. */
export function newStuckState() {
    return { anchor: null, since: 0, last: null };
}

// Why the stuck time starts again with this sample, or null when it goes on.
function resetReason(state, sample) {
    if (!state.anchor || !isPoint(sample.pos) || !state.last)
        return 'start';
    if (distance(sample.pos, state.anchor) >= STUCK_RULES.moveBlocks)
        return 'moved';
    if (digKey(sample.digTarget) !== state.last.dig)
        return 'dig';
    if ((sample.inventoryKey ?? '') !== state.last.inventory)
        return 'inventory';
    if (sample.windowOpen)
        return 'window';
    if (sample.sleeping)
        return 'sleeping';
    if (sample.usingItem)
        return 'using_item';
    if (Number.isFinite(sample.notedAt) && sample.notedAt > state.since)
        return 'noted';
    if (sample.searching === true)
        return 'searching'; // v0.1.4.11 (F15): the time of a search of the walk to the player is no time stuck
    return null;
}

/**
 * One tick of the mode unstuck while an action runs. A sample is { pos, digTarget, inventoryKey,
 * windowOpen, sleeping, usingItem, notedAt }. The stuck time starts again when, against the last
 * sample: the position moved 2 blocks or more from where the stuck time started; the dig target
 * changed; inventoryKey changed; a window is open; the bot sleeps; the bot uses an item; notedAt
 * (the last noteProgress) is newer than the start of the stuck time. The bot is stuck when the stuck
 * time is over the limit (stuckLimitMs); the state then starts again.
 * @param {object} state from newStuckState or an earlier step
 * @param {object} sample
 * @param {number} now
 * @returns {{state: object, stuck: boolean, reason: string|null, elapsedMs: number}} reason: why the
 *     stuck time started again ('start', 'moved', 'dig', 'inventory', 'window', 'sleeping', 'using_item', 'noted',
 *     'searching': v0.1.4.11, F15, bot.searching of goToPlayer and followPlayer)
 */
export function stuckStep(state, sample, now) {
    const s = state && typeof state === 'object' ? state : newStuckState();
    const x = sample && typeof sample === 'object' ? sample : {};
    const last = { dig: digKey(x.digTarget), inventory: x.inventoryKey ?? '' };
    const reason = resetReason(s, x);
    if (reason !== null) {
        const anchor = isPoint(x.pos) ? { x: x.pos.x, y: x.pos.y, z: x.pos.z } : null;
        return { state: { anchor, since: now, last }, stuck: false, reason, elapsedMs: 0 };
    }
    const elapsedMs = now - s.since;
    if (elapsedMs > stuckLimitMs(x))
        return { state: newStuckState(), stuck: true, reason: null, elapsedMs };
    return { state: { anchor: s.anchor, since: s.since, last }, stuck: false, reason: null, elapsedMs };
}

/**
 * The outcome of an escape (moveAway with a time limit) while stuck_restart_after is not 1.
 * 'stopped': an interrupt (!stop, a newer action) ended it; that is no failure.
 * 'free': moveAway ended in time without an error and the bot is 2 blocks or more from where it stood.
 * 'failed': the time was over, moveAway threw, or the bot is still within 2 blocks.
 * @param {{done: boolean, error?: boolean, interrupted: boolean, from: {x,y,z}, to: {x,y,z}}} input
 * @returns {'stopped'|'free'|'failed'}
 */
export function escapeOutcome(input) {
    const i = input && typeof input === 'object' ? input : {};
    if (i.interrupted)
        return 'stopped';
    if (i.done && !i.error && isPoint(i.from) && isPoint(i.to) && distance(i.from, i.to) >= STUCK_RULES.moveBlocks)
        return 'free';
    return 'failed';
}

/**
 * True for stuck_restart_after 1 (the default): the escape is judged as in v0.1.4.7 (see legacyOutcome).
 * @param {*} limit stuck_restart_after
 * @returns {boolean}
 */
export function isLegacyEscape(limit) {
    return restartAfter(limit) === 1;
}

/**
 * The time limit of the escape: 10 s with stuck_restart_after 1, as in v0.1.4.7; 20 s with every other
 * value, because the door help of moveAway can need about 10 s.
 * @param {*} limit stuck_restart_after
 * @returns {number}
 */
export function escapeLimitMs(limit) {
    return isLegacyEscape(limit) ? STUCK_RULES.escapeMs : STUCK_RULES.escapeLongMs;
}

/**
 * The escape judged as in v0.1.4.7 (stuck_restart_after 1). Only the timer of 10 s ends the process; the
 * caller runs it around the escape. 'stopped': an interrupt ended the wait, or moveAway returned while the
 * bot was interrupted; 'throw': moveAway threw, the error is passed on; 'free': moveAway returned, and the
 * bot says "I'm free." wherever it stands.
 * @param {{done: boolean, stopped?: boolean, error?: boolean, interrupted?: boolean}} input
 * @returns {'stopped'|'throw'|'free'}
 */
export function legacyOutcome(input) {
    const i = input && typeof input === 'object' ? input : {};
    if (i.stopped || !i.done)
        return 'stopped';
    if (i.error)
        return 'throw';
    if (i.interrupted)
        return 'stopped';
    return 'free';
}

/**
 * The setting stuck_restart_after: a whole number of 0 or more; anything else is the default 1.
 * @param {*} value
 * @returns {number}
 */
export function restartAfter(value) {
    return Number.isInteger(value) && value >= 0 ? value : 1;
}

/**
 * After a failed escape: the new count of failed escapes in a row, and whether the process ends.
 * It ends when restartAfter > 0 and the count reached it; otherwise the reflex gives up.
 * @param {number} count failed escapes in a row before this one
 * @param {number} limit stuck_restart_after (0: never)
 * @returns {{count: number, kill: boolean}}
 */
export function failureStep(count, limit) {
    const next = (Number.isInteger(count) && count > 0 ? count : 0) + 1;
    const n = restartAfter(limit);
    return { count: next, kill: n > 0 && next >= n };
}

/**
 * The reflex gave up at givenUp.pos while the command number givenUp.serial ran. The pause ends when a
 * new command started or the bot is 2 blocks or more from there.
 * @param {{pos: {x,y,z}, serial: *}} givenUp
 * @param {{pos: {x,y,z}, serial: *}} now
 * @returns {boolean}
 */
export function giveUpEnds(givenUp, now) {
    if (!givenUp || typeof givenUp !== 'object')
        return true;
    const n = now && typeof now === 'object' ? now : {};
    if (n.serial !== givenUp.serial)
        return true;
    return isPoint(n.pos) && distance(n.pos, givenUp.pos) >= STUCK_RULES.moveBlocks;
}

/**
 * True for a door, a fence gate or a trapdoor, of any material.
 * @param {string} name
 * @returns {boolean}
 */
export function isOpenableName(name) {
    if (typeof name !== 'string')
        return false;
    const n = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
    return n.endsWith('_door') || n.endsWith('_trapdoor') || n.endsWith('_fence_gate');
}

/**
 * The nearest door, fence gate or trapdoor within range of pos (from pos to the middle of the block).
 * getBlockName(x, y, z) returns a name or null. On equal distance the first in the order x, y, z wins.
 * @param {Function} getBlockName
 * @param {{x,y,z}} pos
 * @param {number} [range]
 * @returns {{name: string, x: number, y: number, z: number}|null}
 */
export function nearestOpenable(getBlockName, pos, range = STUCK_RULES.doorRange) {
    if (typeof getBlockName !== 'function' || !isPoint(pos))
        return null;
    const r = Math.ceil(range);
    const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);
    let best = null;
    let bestDistance = Infinity;
    for (let x = bx - r; x <= bx + r; x++) {
        for (let y = by - r; y <= by + r; y++) {
            for (let z = bz - r; z <= bz + r; z++) {
                const d = distance(pos, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
                if (d > range || d >= bestDistance)
                    continue;
                let name = null;
                try {
                    name = getBlockName(x, y, z);
                } catch {
                    name = null;
                }
                if (isOpenableName(name)) {
                    best = { name, x, y, z };
                    bestDistance = d;
                }
            }
        }
    }
    return best;
}

/**
 * The line of the behaviour log when the reflex gives up:
 * `I am stuck at (x, y, z) and could not walk away.` plus ` I am in the area "<name>" (<type>).` and
 * ` A <block name> is at (x, y, z).` when they are known.
 * @param {{pos: {x,y,z}, area?: {name: string, type?: string}|null, door?: {name, x, y, z}|null}} input
 * @returns {string}
 */
export function stuckText(input) {
    const i = input && typeof input === 'object' ? input : {};
    const p = isPoint(i.pos) ? i.pos : { x: 0, y: 0, z: 0 };
    let text = `I am stuck at (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}) and could not walk away.`;
    if (i.area && typeof i.area.name === 'string' && i.area.name !== '')
        text += typeof i.area.type === 'string' && i.area.type !== ''
            ? ` I am in the area "${i.area.name}" (${i.area.type}).`
            : ` I am in the area "${i.area.name}".`;
    if (i.door && typeof i.door.name === 'string' && isPoint(i.door))
        text += ` A ${i.door.name} is at (${i.door.x}, ${i.door.y}, ${i.door.z}).`;
    return text;
}
