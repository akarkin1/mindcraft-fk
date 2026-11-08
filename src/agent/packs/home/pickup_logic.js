// Where the bot stands to pick up an item entity (v0.1.4.14, W122 B2, traced on the real server). A pure home helper:
// the wood pack uses it for the logs of a cut tree, the skills for the drops of a give and of a broken chest, so the
// rule is one. Pure: no imports.
//
// Assumed server pickup range: the player's box (0.6 x 1.8) grown by 1 sideways and 0.5 up and down, touching the
// item's box (0.25 x 0.25).

/** How far sideways from the middle of the bot's cell an item is picked up (a little less than the server's 1.425). */
export const PICKUP_SIDE = 1.3;
/** How far below the bot's feet an item is picked up (a little less than the server's 0.75). */
export const PICKUP_BELOW = 0.7;
/** How far above the bot's feet an item is picked up (a little less than the server's 2.3). */
export const PICKUP_ABOVE = 2.2;

// Blocks the bot walks through (as the wood pack reads them).
const PASSABLE = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
    'snow', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
    'torchflower', 'pink_petals', 'wildflowers', 'leaf_litter', 'bush', 'firefly_bush', 'short_dry_grass', 'tall_dry_grass',
    'brown_mushroom', 'red_mushroom', 'sunflower', 'lilac', 'rose_bush', 'peony', 'vine', 'glow_lichen', 'moss_carpet',
    'pale_moss_carpet', 'pale_hanging_moss', 'mangrove_propagule']);
const PASSABLE_ENDINGS = ['_sapling', '_tulip'];
const NOT_SOLID = new Set(['water', 'lava', 'bubble_column']);

function baseName(name) {
    if (typeof name !== 'string' || name === '') {
        return null;
    }
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && [p.x, p.y, p.z].every(n => typeof n === 'number' && Number.isFinite(n));
}

function isPassable(name) {
    const n = baseName(name);
    return n !== null && (PASSABLE.has(n) || PASSABLE_ENDINGS.some(e => n.endsWith(e)));
}

function isSolid(name) {
    const n = baseName(name);
    return n !== null && !isPassable(n) && !NOT_SOLID.has(n);
}

function isLeaves(name) {
    const n = baseName(name);
    return n !== null && (n.endsWith('_leaves') || n.endsWith('_wart_block'));
}

// A reader that never throws and reads every block once.
function reader(getBlockName) {
    const cache = new Map();
    return (x, y, z) => {
        const k = `${x},${y},${z}`;
        if (!cache.has(k)) {
            let name = null;
            try {
                name = baseName(getBlockName(x, y, z));
            } catch {
                name = null;
            }
            cache.set(k, name);
        }
        return cache.get(k);
    };
}

/**
 * The cells the bot can stand in to pick up an item: feet free or for walking through, solid below, head free or in
 * leaves, the item within the pickup range. `dig` names the leaf the head is in (the bot breaks it to stand there).
 * Those without a leaf come first, then the nearer ones to `from`. Never throws.
 * @param {(x: number, y: number, z: number) => string|null} getBlockName
 * @param {{x: number, y: number, z: number}} item the position of the item entity
 * @param {{x: number, y: number, z: number}|null} from the bot
 * @returns {{x: number, y: number, z: number, dig: {x: number, y: number, z: number}|null}[]}
 */
export function pickupStands(getBlockName, item, from = null) {
    if (!isPoint(item) || typeof getBlockName !== 'function') {
        return [];
    }
    const read = reader(getBlockName);
    const out = [];
    const ix = Math.floor(item.x);
    const iz = Math.floor(item.z);
    for (let x = ix - 1; x <= ix + 1; x++) {
        for (let z = iz - 1; z <= iz + 1; z++) {
            if (Math.abs(item.x - (x + 0.5)) > PICKUP_SIDE || Math.abs(item.z - (z + 0.5)) > PICKUP_SIDE) {
                continue;
            }
            for (let y = Math.floor(item.y - PICKUP_ABOVE); y <= Math.floor(item.y + PICKUP_BELOW); y++) {
                if (item.y - y <= -PICKUP_BELOW || item.y - y >= PICKUP_ABOVE) {
                    continue;
                }
                if (!isPassable(read(x, y, z)) || !isSolid(read(x, y - 1, z))) {
                    continue;
                }
                const head = read(x, y + 1, z);
                if (isPassable(head) || isLeaves(head)) {
                    out.push({ x, y, z, dig: isPassable(head) ? null : { x, y: y + 1, z } });
                }
            }
        }
    }
    const d = (c) => (isPoint(from) ? Math.hypot(c.x + 0.5 - from.x, c.y - from.y, c.z + 0.5 - from.z) : 0);
    return out.sort((a, b) => (a.dig ? 1 : 0) - (b.dig ? 1 : 0) || d(a) - d(b) || a.x - b.x || a.y - b.y || a.z - b.z);
}
