// The recorder of the watching pack (v0.1.4.12, part B, SPEC 4.4): the blocks the watched player places and breaks, from
// bot.on('blockUpdate', (oldBlock, newBlock) => ...). A block that became air is a `break`, a block that became another
// block out of air (or a plant, snow, water) is a `place`; a change of state of the same block (a fence that connects,
// a gate that opens) is nothing. A change is credited to the watched player when that player is within CREDIT_RANGE
// blocks of the block and is the nearest player; the bot itself is never credited. The record is a list in memory,
// newest last, at most RECORD_MAX entries. Never throws.

/** A change counts for the watched player within this many blocks of the block. */
export const CREDIT_RANGE = 6;
/** The record keeps at most this many entries (the oldest go first). */
export const RECORD_MAX = 500;

const AIR = new Set(['air', 'cave_air', 'void_air']);
// a block that turned into a placed block: air, the plants and snow it replaces, a liquid
const REPLACED = new Set([...AIR, 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow', 'water', 'lava',
    'seagrass', 'tall_seagrass', 'bubble_column']);
// changes that are no building: liquids, fire, the plants of the ground, leaves that decay
const NOT_BLOCKS = new Set(['water', 'lava', 'bubble_column', 'fire', 'soul_fire', 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern',
    'dead_bush', 'seagrass', 'tall_seagrass', 'snow']);
const ignored = (name) => NOT_BLOCKS.has(name) || name.endsWith('_leaves');

function propsOf(block) {
    try {
        const p = typeof block?.getProperties === 'function' ? block.getProperties() : (block?._properties ?? null);
        return p && typeof p === 'object' ? p : {};
    } catch {
        return {};
    }
}

/**
 * The change of one block update as { kind, name, x, y, z, props } or null. props holds the facing of a gate or a door;
 * the upper half of a door or a tall block and the head of a bed are left out (one entry per block placed).
 * @param {object|null} oldBlock
 * @param {object|null} newBlock
 * @returns {object|null}
 */
export function changeOf(oldBlock, newBlock) {
    try {
        const pos = newBlock?.position ?? oldBlock?.position;
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z))
            return null;
        const oldName = typeof oldBlock?.name === 'string' ? oldBlock.name : null;
        const newName = typeof newBlock?.name === 'string' ? newBlock.name : null;
        if (newName === null || oldName === newName)
            return null;
        const at = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
        if (AIR.has(newName)) {
            if (oldName === null || AIR.has(oldName) || ignored(oldName))
                return null;
            const props = propsOf(oldBlock);
            if (props.half === 'upper' || props.part === 'head')
                return null;
            return { kind: 'break', name: oldName, ...at, props: {} };
        }
        if (ignored(newName) || (oldName !== null && !REPLACED.has(oldName)))
            return null;
        const props = propsOf(newBlock);
        if (props.half === 'upper' || props.part === 'head')
            return null;
        const kept = {};
        if ((newName.endsWith('_fence_gate') || newName.endsWith('_door')) && typeof props.facing === 'string')
            kept.facing = props.facing;
        return { kind: 'place', name: newName, ...at, props: kept };
    } catch {
        return null;
    }
}

/**
 * The players other than the bot with an entity: [{ name, position }].
 * @param {object} bot
 * @returns {{name: string, position: {x: number, y: number, z: number}}[]}
 */
export function otherPlayers(bot) {
    const out = [];
    try {
        for (const [name, player] of Object.entries(bot?.players ?? {})) {
            const e = player?.entity;
            if (name === bot.username || !e?.position || e === bot.entity)
                continue;
            out.push({ name, position: e.position });
        }
    } catch {
        // no players
    }
    return out;
}

/**
 * True when the change at `at` (a block position) belongs to the watched player: within CREDIT_RANGE blocks of the
 * centre of the block, and the nearest of the players other than the bot.
 * @param {object} bot
 * @param {string} watched
 * @param {{x: number, y: number, z: number}} at
 * @returns {boolean}
 */
export function creditedTo(bot, watched, at) {
    if (typeof watched !== 'string' || watched === '' || watched === bot?.username)
        return false;
    const c = { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 };
    let best = null;
    for (const p of otherPlayers(bot)) {
        const d = Math.hypot(p.position.x - c.x, p.position.y - c.y, p.position.z - c.z);
        if (best === null || d < best.d)
            best = { name: p.name, d };
    }
    return best !== null && best.name === watched && best.d <= CREDIT_RANGE;
}

/**
 * A record: entries newest last, at most `max`.
 * @param {number} [max]
 * @returns {{entries: object[], add: (entry: object) => void, clear: () => void, counts: () => {placed: number, broken: number}}}
 */
export function createRecord(max = RECORD_MAX) {
    const entries = [];
    return {
        entries,
        add(entry) {
            entries.push(entry);
            while (entries.length > max)
                entries.shift();
        },
        clear() {
            entries.length = 0;
        },
        counts() {
            return { placed: entries.filter(e => e.kind === 'place').length, broken: entries.filter(e => e.kind === 'break').length };
        },
    };
}

/**
 * Listens to bot.on('blockUpdate') and adds the changes of the watched player to the record. Returns stop(), which
 * removes the listener (more than once is fine).
 * @param {object} bot
 * @param {string} watched the name of the player
 * @param {{add: Function}} record
 * @param {() => number} [now]
 * @returns {() => void}
 */
export function startRecorder(bot, watched, record, now = () => Date.now()) {
    const onUpdate = (oldBlock, newBlock) => {
        try {
            const change = changeOf(oldBlock, newBlock);
            if (!change || !creditedTo(bot, watched, change))
                return;
            record.add({ ...change, t: now() });
        } catch {
            // a block update must never break the bot
        }
    };
    let on = false;
    try {
        bot.on('blockUpdate', onUpdate);
        on = true;
    } catch {
        // a bot without events records nothing
    }
    return () => {
        if (!on)
            return;
        on = false;
        try {
            (bot.off ?? bot.removeListener).call(bot, 'blockUpdate', onUpdate);
        } catch {
            // nothing to remove
        }
    };
}
