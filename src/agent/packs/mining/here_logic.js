// !mineOre from where the bot stands (v0.1.4.13, part Q, SPEC 4.6 Q1): the name of a mine made underground, its text,
// and the text of a mine whose way in nobody showed. Pure: no imports.

/** The room of a mine made where the bot stands: a chest or a crafting table within this many blocks of the bot. */
export const HERE_ROOM_RANGE = 8;

/** The most numbers tried for the next free name. */
const MAX_NUMBER = 999;

// The name as the mine store keeps it (cleanMineName of mine_store.js): trimmed, lower case, spaces as underscores.
function storeName(name) {
    return String(name).trim().toLowerCase().replace(/\s+/g, '_');
}

function cellText(p) {
    return `(${Math.floor(p?.x)}, ${Math.floor(p?.y)}, ${Math.floor(p?.z)})`;
}

/**
 * The next free name of a mine made underground (Q1): `mine 1`, `mine 2`, ... the first number whose name the store does
 * not hold yet. A mine called just "mine" takes the place of `mine 1`, so the second mine is `mine 2`.
 * @param {Iterable<string>} taken the names of the mines of the store (as kept: `mine_2`) or as said (`mine 2`)
 * @returns {string} the name as said, `mine 2`
 */
export function nextMineName(taken) {
    const names = new Set();
    for (const name of taken ?? []) {
        if (typeof name === 'string' && name.trim().length > 0) {
            names.add(storeName(name));
        }
    }
    for (let n = 1; n <= MAX_NUMBER; n++) {
        if (n === 1 && names.has('mine')) {
            continue;
        }
        if (!names.has(storeName(`mine ${n}`))) {
            return `mine ${n}`;
        }
    }
    return `mine ${MAX_NUMBER + 1}`;
}

/**
 * The text of Q1, word for word: `I made the mine "mine 2" here and measured the tunnel: it starts at (30, -59, -100),
 * goes north, 4 blocks. I dig on at its end.`
 * @param {string} name the name as said
 * @param {{start: {x, y, z}, dir: string, length: number}} tunnel
 * @returns {string}
 */
export function madeMineText(name, tunnel) {
    const length = Number.isFinite(tunnel?.length) ? Math.floor(tunnel.length) : 0;
    return `I made the mine "${name}" here and measured the tunnel: it starts at ${cellText(tunnel?.start)}, goes ${tunnel?.dir}, `
        + `${length} ${length === 1 ? 'block' : 'blocks'}. I dig on at its end.`;
}

/**
 * The way out of a mine that was made underground (Q1, the way in unknown): `I do not know the way out of the mine
 * "mine 2". I stay here; say "follow me" and I come with you.`
 * @param {string} label the words of the mine, mineLabel of texts.js (`the mine "mine 2"`)
 * @returns {string}
 */
export function noWayOutText(label) {
    return `I do not know the way out of ${label || 'the mine'}. I stay here; say "follow me" and I come with you.`;
}

/**
 * True for a mine whose way in is unknown (Q1): a mine of the player with no leg of a route and no parent.
 * @param {object} mine
 * @returns {boolean}
 */
export function wayInUnknown(mine) {
    if (!mine || typeof mine !== 'object' || mine.source !== 'player') {
        return false;
    }
    const parent = typeof mine.parent === 'string' && mine.parent.length > 0;
    return !parent && !(Array.isArray(mine.route) && mine.route.length > 0);
}
