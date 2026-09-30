// The last step of the escape of the mode unstuck (v0.1.4.8, X1): a bot in a hole of one block, or inside
// a hollow block (a composter, a cauldron), jumps and walks towards each of the four sides in turn and
// looks after each whether it got out. The path search of moveAway cannot plan from inside such a block.
// Pure: the world is read through getBlockName(x, y, z), which returns the name of a block, or null for a
// block that is not loaded. Positions are {x, y, z}; a side is never tried before its column was tested.

export const HOLE_RULES = Object.freeze({
    stepMs: 1000,      // jump and walk towards one side for about 1 s
    landMs: 600,       // then wait at most this long until the bot stands on the ground again
    tickMs: 50,        // the controls are set again every tick
    endWalkMs: 3000,   // the walk of moveAway that still runs gets this long to end before the bot is steered
    maxDrop: 3,        // never off a drop of more than 3 blocks
    outBlocks: 1,      // out: more than 1 block from where the bot stood
    walkBlocks: 1.1,   // the walk forward ends this far from the middle of the hole (inside the next column)
});

// The four sides in turn, as (x, z) offsets: north, east, south, west.
export const SIDES = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]].map(side => Object.freeze(side)));

// Blocks with an open top that a bot can stand inside.
const HOLLOW = new Set(['composter', 'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron']);

// Never walked into, stood on or fallen onto.
const DANGER = new Set(['lava', 'fire', 'soul_fire', 'campfire', 'soul_campfire', 'magma_block', 'cactus', 'sweet_berry_bush',
    'powder_snow', 'wither_rose', 'pointed_dripstone']);

const WATER = new Set(['water', 'bubble_column']);

// The body passes through these, or they are so low that the bot steps over them.
const PASSABLE = new Set(['air', 'cave_air', 'void_air', 'water', 'bubble_column', 'light', 'structure_void', 'snow', 'ladder',
    'vine', 'lever', 'rail', 'redstone_wire', 'tripwire', 'tripwire_hook', 'short_grass', 'grass', 'tall_grass', 'fern',
    'large_fern', 'dead_bush', 'bush', 'firefly_bush', 'short_dry_grass', 'tall_dry_grass', 'dandelion', 'poppy', 'blue_orchid',
    'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'torchflower', 'open_eyeblossom',
    'closed_eyeblossom', 'cactus_flower', 'sunflower', 'lilac', 'rose_bush', 'peony', 'pitcher_plant', 'pink_petals',
    'wildflowers', 'leaf_litter', 'wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem',
    'attached_melon_stem', 'attached_pumpkin_stem', 'torchflower_crop', 'pitcher_crop', 'nether_wart', 'sugar_cane',
    'cave_vines', 'cave_vines_plant', 'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant',
    'glow_lichen', 'hanging_roots', 'pale_hanging_moss', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'brown_mushroom',
    'red_mushroom', 'crimson_fungus', 'warped_fungus', 'crimson_roots', 'warped_roots', 'nether_sprouts', 'spore_blossom',
    'small_dripleaf', 'big_dripleaf_stem', 'mangrove_propagule']);
const PASSABLE_ENDINGS = ['_sapling', '_tulip', '_carpet', '_button', '_pressure_plate', 'torch', '_sign', '_banner', '_rail'];

// Higher than the jump of the bot (1.5 blocks): no step onto them.
const TALL_ENDINGS = ['_fence', '_wall', '_fence_gate'];

function baseName(name) {
    return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

// The name at x, y, z without 'minecraft:', null when it is not loaded or cannot be read.
function nameAt(getBlockName, x, y, z) {
    try {
        const name = getBlockName(x, y, z);
        return typeof name === 'string' && name !== '' ? baseName(name) : null;
    } catch {
        return null;
    }
}

/** True for a block with an open top that the bot can stand inside: a composter or a cauldron. */
export function isHollowName(name) {
    return typeof name === 'string' && HOLLOW.has(baseName(name));
}

/** True for lava, fire, magma, a cactus and the like: never walked into, stood on or fallen onto. */
export function isDangerName(name) {
    return typeof name === 'string' && DANGER.has(baseName(name));
}

/** True for air, water, plants and low blocks that the body of the bot passes through or steps over. */
export function isPassableName(name) {
    if (typeof name !== 'string' || name === '')
        return false;
    const n = baseName(name);
    return PASSABLE.has(n) || PASSABLE_ENDINGS.some(ending => n.endsWith(ending));
}

/**
 * True for a block that the bot can stand on after it got out: known, not passable, not a danger, not a
 * hollow block (it would stand inside again) and not a fence, wall or gate (too high to step onto).
 * @param {string} name
 * @returns {boolean}
 */
export function isStandableName(name) {
    if (typeof name !== 'string' || name === '' || isPassableName(name) || isDangerName(name) || isHollowName(name))
        return false;
    const n = baseName(name);
    return !TALL_ENDINGS.some(ending => n.endsWith(ending));
}

function isWaterName(name) {
    return typeof name === 'string' && WATER.has(baseName(name));
}

/**
 * Where the bot is caught: { kind: 'hollow', x, y, z, block } when its feet are inside a composter or a
 * cauldron (y is the block of it); { kind: 'hole', x, y, z, block } when it stands in a hole of one block
 * (y is the block of its feet, all four sides at that height are closed, block is the floor); else null.
 * A bot that stands on a block lower than a full one (farmland, a slab) has its feet in the block above.
 * @param {Function} getBlockName (x, y, z) => name | null
 * @param {{x,y,z}} pos the position of the bot
 * @returns {{kind: 'hollow'|'hole', x: number, y: number, z: number, block: string}|null}
 */
export function holeAt(getBlockName, pos) {
    if (typeof getBlockName !== 'function' || !isPoint(pos))
        return null;
    const x = Math.floor(pos.x), z = Math.floor(pos.z);
    const y0 = Math.floor(pos.y);
    const at = nameAt(getBlockName, x, y0, z);
    if (at === null)
        return null;
    if (isHollowName(at))
        return { kind: 'hollow', x, y: y0, z, block: at };
    let y = y0;
    if (!isPassableName(at)) {
        y = y0 + 1;
        if (!isPassableName(nameAt(getBlockName, x, y, z)))
            return null; // inside a solid block: nothing to climb out of
    }
    const floor = nameAt(getBlockName, x, y - 1, z);
    if (floor === null || isPassableName(floor))
        return null;
    for (const [dx, dz] of SIDES) {
        const side = nameAt(getBlockName, x + dx, y, z + dz);
        if (side === null || isPassableName(side))
            return null; // an open side (or one not loaded): no hole of one block
    }
    return { kind: 'hole', x, y, z, block: floor };
}

/**
 * The yaw of mineflayer that looks towards the side (dx, dz), as bot.lookAt computes it.
 * @param {number} dx
 * @param {number} dz
 * @returns {number}
 */
export function sideYaw(dx, dz) {
    const yaw = Math.atan2(-dx, -dz);
    return yaw === 0 ? 0 : yaw; // no -0
}

// The target of one side, or null when that side is not safe. The body needs room at y + 1 and y + 2 of
// the column (it crosses the wall of the hole up there). A closed block at the height of the feet is a
// step up: the bot stands on it. An open one: the bot lands on the first block under it, at most 3 blocks
// down. Rank 0 is plain ground; farmland (it can be trampled) and water are tried last.
function sideTarget(getBlockName, hole, dx, dz) {
    const tx = hole.x + dx, tz = hole.z + dz, y = hole.y;
    const feet = nameAt(getBlockName, tx, y, tz);
    const body = [nameAt(getBlockName, tx, y + 1, tz), nameAt(getBlockName, tx, y + 2, tz)];
    if (feet === null || body.includes(null))
        return null;
    if ([feet, ...body].some(isDangerName) || !body.every(isPassableName))
        return null;
    let wet = body.some(isWaterName);
    const target = (landY, ground) => ({ dx, dz, yaw: sideYaw(dx, dz), x: tx, z: tz, landY, ground, drop: y - landY,
        rank: (ground === 'farmland' ? 1 : 0) + (wet ? 1 : 0) });
    if (!isPassableName(feet))
        return isStandableName(feet) ? target(y + 1, feet) : null;
    wet = wet || isWaterName(feet);
    for (let down = 1; down <= HOLE_RULES.maxDrop + 1; down++) {
        const name = nameAt(getBlockName, tx, y - down, tz);
        if (name === null || isDangerName(name))
            return null;
        if (isPassableName(name)) {
            wet = wet || isWaterName(name);
            continue;
        }
        return isStandableName(name) ? target(y - down + 1, name) : null;
    }
    return null; // a drop of more than 3 blocks
}

/**
 * The sides that the bot may jump and walk to out of the hole or the hollow block at pos, the safest
 * first (plain ground, then farmland and water), else in the order north, east, south, west. A side
 * whose column holds lava, fire or the like, a block that is not loaded, no room for the body, a wall
 * higher than a step or a drop of more than 3 blocks is left out. [] when the bot is not caught in a
 * hole or a hollow block, or when there is no room for a jump above it.
 * @param {Function} getBlockName (x, y, z) => name | null
 * @param {{x,y,z}} pos the position of the bot
 * @returns {{dx: number, dz: number, yaw: number, x: number, z: number, landY: number, ground: string, drop: number, rank: number}[]}
 */
export function escapeSides(getBlockName, pos) {
    const hole = holeAt(getBlockName, pos);
    if (!hole)
        return [];
    for (const dy of [1, 2]) {
        const above = nameAt(getBlockName, hole.x, hole.y + dy, hole.z);
        if (!isPassableName(above) || isDangerName(above))
            return []; // no room for the jump
    }
    const sides = [];
    SIDES.forEach(([dx, dz], order) => {
        const target = sideTarget(getBlockName, hole, dx, dz);
        if (target)
            sides.push({ target, order });
    });
    sides.sort((a, b) => a.target.rank - b.target.rank || a.order - b.order);
    return sides.map(side => side.target);
}

/**
 * The controls in one tick of the walk towards a side: forward until the bot is walkBlocks (horizontally)
 * from the middle of the hole, jump while it is still in the column of the hole. done when it walked far
 * enough and stands on the ground, or when the time of the step is over.
 * @param {{hole: {x, z}, pos: {x,y,z}, onGround?: boolean, elapsedMs: number}} input
 * @returns {{forward: boolean, jump: boolean, done: boolean}}
 */
export function walkControls(input) {
    const i = input && typeof input === 'object' ? input : {};
    if (!i.hole || !isPoint(i.pos))
        return { forward: false, jump: false, done: true };
    const away = Math.hypot(i.pos.x - (i.hole.x + 0.5), i.pos.z - (i.hole.z + 0.5));
    const forward = away < HOLE_RULES.walkBlocks;
    const inColumn = Math.floor(i.pos.x) === i.hole.x && Math.floor(i.pos.z) === i.hole.z;
    const timeOver = !(Number.isFinite(i.elapsedMs) && i.elapsedMs < HOLE_RULES.stepMs);
    const done = timeOver || (!forward && i.onGround !== false);
    return { forward: forward && !timeOver, jump: inColumn && !timeOver, done };
}

/**
 * True when the bot got out: more than 1 block from where it stood, out of the column of the hole, its
 * feet not inside a hollow block, standing on the ground on a block it can stand on.
 * @param {Function} getBlockName (x, y, z) => name | null
 * @param {{x, z}} hole the result of holeAt
 * @param {{x,y,z}} from where the bot stood
 * @param {{x,y,z}} to where the bot is now
 * @param {boolean} [onGround] bot.entity.onGround; only false counts against it
 * @returns {boolean}
 */
export function leftHole(getBlockName, hole, from, to, onGround) {
    if (typeof getBlockName !== 'function' || !hole || !isPoint(from) || !isPoint(to) || onGround === false)
        return false;
    if (Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) <= HOLE_RULES.outBlocks)
        return false;
    const x = Math.floor(to.x), z = Math.floor(to.z);
    if (x === hole.x && z === hole.z)
        return false;
    if (isHollowName(nameAt(getBlockName, x, Math.floor(to.y), z)))
        return false;
    // the block under the feet (farmland or a slab: the block the feet are in); under a carpet or a plant, the next one
    const under = Math.floor(to.y - 0.01);
    for (const y of [under, under - 1]) {
        const name = nameAt(getBlockName, x, y, z);
        if (!isPassableName(name))
            return isStandableName(name);
    }
    return false;
}
