// The ladder shaft of the skills (the correction of 2026-10-04, the owner, no switch): down is fine by a safe way, never
// by a bare shaft. goToPosition (a walk that would be a shaft) and digDown (deeper than 3 blocks) dig a shaft of 1 by 1
// straight down and place a ladder on a wall of every block of it, so the bot and the owner can climb back up. Each
// step: shaftStep of way_logic.js decides (lava, water, a drop, no wall: stop before the dig), the block below the feet
// is broken through `breakAt` (skills.breakBlockAt, given by the caller: this file imports nothing of skills.js), the
// bot falls into the hole, and the ladder is placed on the wall of each cell it passed. The mining pack has its own
// ladder shaft (packs/mining), bound to a mine and a job; packs are reached through ctx, so the skills have this one.
// Never throws.
import Vec3 from 'vec3';
import { WALL_SIDES, shaftStep } from './way_logic.js';

const EMPTY = new Set(['air', 'cave_air', 'void_air']);
const FALL_MS = 3000;     // the bot lands in the hole within this
const PLACE_MS = 5000;    // one ladder is placed within this
const POLL_MS = 50;
const LADDER_DEPTH = 3 / 16; // the ladder takes this much of the cell at its wall
const BODY = 0.3;            // half the width of the bot

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function feetOf(bot) {
    const p = bot?.entity?.position;
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

/** The ladders in the bag. */
export function ladderCount(bot) {
    try {
        return bot.inventory.items().filter((i) => i?.name === 'ladder').reduce((n, i) => n + (Number.isFinite(i.count) ? i.count : 0), 0);
    } catch {
        return 0;
    }
}

// { name, solid } of a block for shaftStep: solid is a full block (a ladder holds on it); null when not loaded.
function reader(bot) {
    return (x, y, z) => {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (!b)
            return null;
        return { name: b.name, solid: b.boundingBox === 'block' && !EMPTY.has(b.name) && b.name !== 'ladder' };
    };
}

// Waits until the feet are at `y` or lower and the bot stands (or climbs) still. true when they are.
async function waitLanded(bot, y) {
    const start = Date.now();
    while (Date.now() - start < FALL_MS) {
        if (bot.interrupt_code)
            return false;
        const f = feetOf(bot);
        if (f && f.y <= y && (bot.entity.onGround || Math.abs(bot.entity.velocity?.y ?? 0) < 0.1))
            return true;
        await sleep(POLL_MS);
    }
    const f = feetOf(bot);
    return Boolean(f && f.y <= y);
}

// Moves the bot in short sneaking pushes away from the wall, so that the ladder does not touch its body (the server
// refuses a block that would). At most 12 pushes; best effort.
async function stepOffWall(bot, c, wall) {
    const [dx, dz] = WALL_SIDES[wall];
    const want = { x: c.x + 0.5 - dx * 0.12, z: c.z + 0.5 - dz * 0.12 };
    for (let push = 0; push < 12 && !bot.interrupt_code; push++) {
        const p = bot.entity.position;
        const fromWall = dx !== 0 ? (dx > 0 ? c.x + 1 - p.x : p.x - c.x) : (dz > 0 ? c.z + 1 - p.z : p.z - c.z);
        if (fromWall >= BODY + LADDER_DEPTH + 0.02)
            return;
        try {
            await bot.lookAt(new Vec3(want.x, p.y + 1.6, want.z), true);
            bot.setControlState('sneak', true);
            bot.setControlState('forward', true);
            await sleep(60);
        } catch {
            // best effort
        } finally {
            bot.setControlState('forward', false);
            bot.setControlState('sneak', false);
        }
        await sleep(60);
    }
}

// Places a ladder in the cell `c` on its wall `wall`. { ok, reason }; reasons no_item, protected, ladder, interrupted.
async function placeLadderAt(bot, c, wall) {
    const here = bot.blockAt(new Vec3(c.x, c.y, c.z));
    if (here?.name === 'ladder')
        return { ok: true, reason: null };
    const [dx, dz] = WALL_SIDES[wall];
    const wallBlock = bot.blockAt(new Vec3(c.x + dx, c.y, c.z + dz));
    if (!wallBlock)
        return { ok: false, reason: 'ladder' };
    try {
        if (bot.areaGuard && bot.areaGuard.canPlace(new Vec3(c.x, c.y, c.z), 'ladder') === false)
            return { ok: false, reason: 'protected' };
    } catch {
        // the guard decides elsewhere
    }
    const item = bot.inventory.items().find((i) => i?.name === 'ladder');
    if (!item)
        return { ok: false, reason: 'no_item' };
    const f = feetOf(bot);
    if (f && f.x === c.x && f.z === c.z && f.y === c.y)
        await stepOffWall(bot, c, wall);
    if (bot.interrupt_code)
        return { ok: false, reason: 'interrupted' };
    try {
        if (bot.heldItem?.name !== 'ladder')
            await bot.equip(item, 'hand');
        let timer = null;
        const limit = new Promise((resolve) => { timer = setTimeout(resolve, PLACE_MS); });
        try {
            await Promise.race([bot.placeBlock(wallBlock, new Vec3(-dx, 0, -dz)), limit]);
        } finally {
            clearTimeout(timer);
        }
    } catch {
        // checked below: the world says whether the ladder is there
    }
    for (let i = 0; i < 4; i++) {
        if (bot.blockAt(new Vec3(c.x, c.y, c.z))?.name === 'ladder')
            return { ok: true, reason: null };
        await sleep(POLL_MS);
    }
    return { ok: false, reason: bot.interrupt_code ? 'interrupted' : 'ladder' };
}

/**
 * Digs a shaft `depth` blocks straight down from the feet with a ladder on a wall of every block of it. The caller
 * checks the ladders of the bag first (laddersNeeded of way_logic.js) and says the texts. Stops before a dig at lava or
 * water next to the shaft, a drop of more than 2 blocks, the end of the world, a cell without a wall, and when it is
 * stopped. Never throws.
 * @param {object} bot
 * @param {number} depth blocks
 * @param {{breakAt: (bot: object, x: number, y: number, z: number) => Promise<boolean>}} tools
 * @returns {Promise<{ok: boolean, reason: string|null, dug: number, ladders: number, at: {x, y, z}|null}>}
 */
export async function digLadderShaft(bot, depth, { breakAt } = {}) {
    let dug = 0;
    let ladders = 0;
    let wall = null;
    const result = (ok, reason) => ({ ok, reason, dug, ladders, at: feetOf(bot) });
    try {
        const start = feetOf(bot);
        if (!start || typeof breakAt !== 'function')
            return result(false, 'end');
        const bottom = start.y - Math.max(0, Math.floor(depth));
        const read = reader(bot);
        for (;;) {
            if (bot.interrupt_code)
                return result(false, 'interrupted');
            const feet = feetOf(bot);
            if (feet.y <= bottom)
                return result(true, null);
            const step = shaftStep(read, feet, wall);
            if (step.action !== 'dig')
                return result(false, step.reason);
            if (step.dig) {
                let broke = false;
                try {
                    broke = await breakAt(bot, step.target.x, step.target.y, step.target.z);
                } catch {
                    broke = false;
                }
                if (bot.interrupt_code)
                    return result(false, 'interrupted');
                const now = bot.blockAt(new Vec3(step.target.x, step.target.y, step.target.z));
                if (!broke && now && !EMPTY.has(now.name))
                    return result(false, 'blocked');
            }
            const lowest = step.cells[step.cells.length - 1];
            if (!(await waitLanded(bot, lowest.y)))
                return result(false, bot.interrupt_code ? 'interrupted' : 'stuck');
            // the cell of the feet first (the bot stands in it), then the cells above it it fell through
            for (const c of [...step.cells].reverse()) {
                const placed = await placeLadderAt(bot, c, c.wall);
                if (!placed.ok)
                    return result(false, placed.reason === 'no_item' ? 'ladder' : placed.reason);
                ladders++;
            }
            dug += step.cells.length;
            wall = step.cells[step.cells.length - 1].wall;
        }
    } catch (err) {
        return result(false, 'blocked');
    }
}
