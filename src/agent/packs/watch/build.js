// The build of the watching pack (v0.1.4.12, part B, SPEC 4.4): the cells of a pattern that are still missing, placed or
// dug one by one after the owner's "yes" (rule 20: nothing before). The material the bot lacks is fetched through
// ctx.storage.fetchItem first (the `short` text is said before). Every cell is asked of the area guard (canPlace,
// canBreak); a refused cell is skipped and counted. A stop keeps what is built and answers `stopped`. The bot walks with
// the home pack's walkNear (no digging, no placing on the way). Never throws.
import { Vec3 } from 'vec3';
import { botPos, clockOf, logTo, sayTo } from '../home/context.js';
import { walkNear } from '../home/motion.js';
import { TEXTS } from './texts.js';
import { AIR_NAMES, DIRS, FREE_NAMES, isGateName, oppositeOf, rightOf } from './pattern_logic.js';

/** The bot places or digs a cell from at most this far (centre to centre). */
export const REACH = 4;
/** Nearer than this to a cell the bot steps to its stand first. */
export const TOO_CLOSE = 1.8;
/** The stand of a placed cell is this many blocks beside it. */
export const STAND_OFF = 2;
/** The longest walk to one stand. */
export const WALK_MS = 60000;
/** How long the bot waits for a placed or dug block to show in its world. */
export const SETTLE_MS = 1000;

const AIR = new Set(AIR_NAMES);
const FREE = new Set(FREE_NAMES);
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const offset = (c, dir, k) => ({ x: c.x + DIRS[dir].x * k, y: c.y, z: c.z + DIRS[dir].z * k });
const centre = (c) => ({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 });
const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

/**
 * The steps of a build in their order: for a line or a fence one `place` per missing cell, in the order of the pattern
 * (along the line from the placed blocks; around the fence from the placed side); for a tunnel per missing cell first
 * the feet, then the head, column after column from the opening.
 * @param {object} pattern a result of findPattern
 * @returns {{action: 'place'|'dig', x: number, y: number, z: number, name?: string, facing?: string, column?: number}[]}
 */
export function buildSteps(pattern) {
    if (!pattern || !Array.isArray(pattern.missing))
        return [];
    if (pattern.kind === 'tunnel') {
        return pattern.missing.flatMap((c, column) => [
            { action: 'dig', x: c.x, y: c.y, z: c.z, column },
            { action: 'dig', x: c.x, y: c.y + 1, z: c.z, column },
        ]);
    }
    return pattern.missing.map(c => ({ action: 'place', x: c.x, y: c.y, z: c.z, name: c.name, ...(c.facing ? { facing: c.facing } : {}) }));
}

/**
 * Where the bot stands to work on a cell. A line: STAND_OFF beside the cell on `side`. A fence: STAND_OFF outside the
 * rectangle; a gate behind it against its facing, so that the bot looks the way the gate faces. A tunnel: the column
 * before the cell.
 * @param {object} pattern
 * @param {{x: number, y: number, z: number, facing?: string}} cell
 * @param {string} [side] for a line, the direction to the side of the bot
 * @returns {{x: number, y: number, z: number}}
 */
export function standFor(pattern, cell, side = null) {
    if (pattern?.kind === 'tunnel')
        return offset(cell, oppositeOf(pattern.dir), 1);
    if (pattern?.kind === 'fence') {
        if (cell.facing && DIRS[cell.facing])
            return offset(cell, oppositeOf(cell.facing), STAND_OFF);
        const { corner, dirA, dirB, a, b } = pattern;
        const rel = { x: cell.x - corner.x, z: cell.z - corner.z };
        const i = rel.x * DIRS[dirA].x + rel.z * DIRS[dirA].z;
        const j = rel.x * DIRS[dirB].x + rel.z * DIRS[dirB].z;
        const out = j === 0 ? oppositeOf(dirB) : j === b - 1 ? dirB : i === 0 ? oppositeOf(dirA) : i === a - 1 ? dirA : oppositeOf(dirB);
        return offset(cell, out, STAND_OFF);
    }
    const dir = side && DIRS[side] ? side : rightOf(pattern?.dir) ?? 'south';
    return offset(cell, dir, STAND_OFF);
}

/**
 * The side of a line the bot is on (perpendicular to the line), so it walks along that side.
 * @param {object} pattern
 * @param {{x: number, z: number}|null} pos
 * @returns {string}
 */
export function sideOfLine(pattern, pos) {
    const right = rightOf(pattern?.dir) ?? 'south';
    if (!pos || !pattern?.from)
        return right;
    const dot = (pos.x - (pattern.from.x + 0.5)) * DIRS[right].x + (pos.z - (pattern.from.z + 0.5)) * DIRS[right].z;
    return dot >= 0 ? right : oppositeOf(right);
}

/**
 * The number of an item the bot carries.
 * @param {object} bot
 * @param {string} name
 * @returns {number}
 */
export function carried(bot, name) {
    try {
        return (bot?.inventory?.items?.() ?? []).filter(i => i?.name === name).reduce((n, i) => n + (i.count ?? 0), 0);
    } catch {
        return 0;
    }
}

function blockName(bot, c) {
    try {
        const b = bot.blockAt(new Vec3(c.x, c.y, c.z));
        return typeof b?.name === 'string' ? b.name : null;
    } catch {
        return null;
    }
}

function blockOf(bot, c) {
    try {
        return bot.blockAt(new Vec3(c.x, c.y, c.z)) ?? null;
    } catch {
        return null;
    }
}

// why the guard refuses a cell: the area that holds it, else the guard
function whyRefused(bot, c) {
    try {
        const area = bot.areaGuard?.areaAt?.({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 });
        if (area?.name)
            return TEXTS.whyArea(area.name);
    } catch {
        // the guard's text
    }
    return TEXTS.whyGuard;
}

function canPlace(bot, c, name) {
    try {
        return !bot.areaGuard || typeof bot.areaGuard.canPlace !== 'function' || bot.areaGuard.canPlace({ x: c.x, y: c.y, z: c.z }, name) !== false;
    } catch {
        return false;
    }
}

function canBreak(bot, block, c) {
    try {
        const target = block ?? { name: blockName(bot, c), position: new Vec3(c.x, c.y, c.z) };
        return !bot.areaGuard || typeof bot.areaGuard.canBreak !== 'function' || bot.areaGuard.canBreak(target) !== false;
    } catch {
        return false;
    }
}

function lavaNext(bot, c) {
    return SIDES.some(([dx, dy, dz]) => blockName(bot, { x: c.x + dx, y: c.y + dy, z: c.z + dz }) === 'lava');
}

// waits until test() is true, at most SETTLE_MS
async function settle(clock, test) {
    const start = clock.now();
    while (!test()) {
        if (clock.now() - start >= SETTLE_MS)
            return false;
        await clock.wait(100);
    }
    return true;
}

function finish(ctx, result) {
    logTo(ctx, result.text);
    return result;
}

/**
 * Builds or digs the missing cells of a pattern. options (tests): walk(bot, cell, range) -> { ok, reason },
 * place(bot, name, x, y, z) -> boolean, dig(bot, x, y, z) -> boolean, now, wait.
 * @param {object} bot
 * @param {object} ctx { skills, storage?, say?, log?, now? }
 * @param {object} pattern a result of findPattern with a kind
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, built: number, refused: number, total: number}>}
 *   reason: null, 'refused' (a cell was refused), 'short' (material missing), 'interrupted', 'error'
 */
export async function buildPattern(bot, ctx = {}, pattern, options = {}) {
    if (!pattern?.kind)
        return { ok: false, reason: 'no_plan', text: TEXTS.nothingToBuild, built: 0, refused: 0, total: 0 };
    try {
        const clock = clockOf(ctx, options);
        const tools = {
            clock,
            walk: options.walk ?? ((b, target, range) => walkNear(b, target, range, { timeoutMs: WALK_MS, clock })),
            place: options.place ?? ((b, name, x, y, z) => ctx.skills.placeBlock(b, name, x, y, z, 'bottom')),
            dig: options.dig ?? ((b, x, y, z) => ctx.skills.breakBlockAt(b, x, y, z)),
        };
        if (pattern.kind === 'tunnel')
            return finish(ctx, await digTunnel(bot, ctx, pattern, tools));
        return finish(ctx, await placeCells(bot, ctx, pattern, tools));
    } catch (error) {
        const text = `I could not build it: ${error?.message ?? error}`;
        logTo(ctx, text);
        return { ok: false, reason: 'error', text, built: 0, refused: 0, total: 0 };
    }
}

// walks to the stand of a cell when the cell is out of reach or too near (a gate: always to its stand). false when the
// cell stays out of reach.
async function reach(bot, tools, cell, stand, exact) {
    const at = botPos(bot);
    const d = at ? dist(at, centre(cell)) : Infinity;
    const atStand = at ? Math.hypot(at.x - (stand.x + 0.5), at.z - (stand.z + 0.5)) <= 0.8 : false;
    if (!(exact ? !atStand : (d > REACH || d < TOO_CLOSE)))
        return true;
    let walked = { ok: false };
    try {
        walked = await tools.walk(bot, stand, exact ? 0 : 1) ?? { ok: false };
    } catch {
        walked = { ok: false };
    }
    const now = botPos(bot);
    return walked.ok === true || (now !== null && dist(now, centre(cell)) <= REACH + 0.5);
}

async function placeCells(bot, ctx, pattern, tools) {
    const steps = buildSteps(pattern).filter(s => blockName(bot, s) !== s.name);
    const total = steps.length;
    const creative = bot.game?.gameMode === 'creative';
    // the material: what is short is fetched first, after the short text
    const need = new Map();
    for (const s of steps)
        need.set(s.name, (need.get(s.name) ?? 0) + 1);
    const had = new Map();
    for (const [name, n] of need) {
        let have = carried(bot, name);
        if (!creative && have < n) {
            sayTo(bot, ctx, TEXTS.short(name, n, have));
            if (typeof ctx.storage?.fetchItem === 'function') {
                try {
                    await ctx.storage.fetchItem(name, n - have);
                } catch {
                    // what came is counted below
                }
                if (bot.interrupt_code)
                    return { ok: false, reason: 'interrupted', text: TEXTS.stopped(0, total), built: 0, refused: 0, total };
                have = carried(bot, name);
            }
        }
        had.set(name, have);
    }
    const side = pattern.kind === 'line' ? sideOfLine(pattern, botPos(bot)) : null;
    const refusals = [];
    const lacking = new Map();
    let built = 0;
    let gates = 0;
    for (const s of steps) {
        if (bot.interrupt_code)
            return { ok: false, reason: 'interrupted', text: TEXTS.stopped(built, total), built, refused: refusals.length, total };
        const now = blockName(bot, s);
        if (now === s.name)
            continue;
        if (!creative && carried(bot, s.name) < 1) {
            lacking.set(s.name, (lacking.get(s.name) ?? 0) + 1);
            continue;
        }
        if (now === null || !FREE.has(now)) {
            refusals.push(TEXTS.refused(s, now === null ? TEXTS.whyUnreachable : TEXTS.whyInTheWay(now)));
            continue;
        }
        if (!canPlace(bot, s, s.name)) {
            refusals.push(TEXTS.refused(s, whyRefused(bot, s)));
            continue;
        }
        const exact = isGateName(s.name) && Boolean(s.facing);
        if (!(await reach(bot, tools, s, standFor(pattern, s, side), exact))) {
            if (bot.interrupt_code)
                return { ok: false, reason: 'interrupted', text: TEXTS.stopped(built, total), built, refused: refusals.length, total };
            refusals.push(TEXTS.refused(s, TEXTS.whyUnreachable));
            continue;
        }
        try {
            await tools.place(bot, s.name, s.x, s.y, s.z);
        } catch {
            // the block is read below
        }
        const there = await settle(tools.clock, () => blockName(bot, s) === s.name);
        if (there) {
            built++;
            if (isGateName(s.name))
                gates++;
        } else if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted', text: TEXTS.stopped(built, total), built, refused: refusals.length, total };
        } else {
            refusals.push(TEXTS.refused(s, TEXTS.whyPlaceFailed));
        }
    }
    let text;
    const short = [...lacking.keys()][0] ?? null;
    if (short !== null)
        text = TEXTS.shortBuilt(short, need.get(short), had.get(short) ?? 0, built, total);
    else if (pattern.kind === 'fence')
        text = TEXTS.built.fence(built - gates, gates, pattern.name);
    else
        text = TEXTS.built.line(built, pattern.name);
    if (refusals.length > 0)
        text += ' ' + TEXTS.refusals(refusals);
    const reason = short !== null ? 'short' : refusals.length > 0 ? 'refused' : null;
    return { ok: reason === null, reason, text, built, refused: refusals.length, total };
}

async function digTunnel(bot, ctx, pattern, tools) {
    const isOpen = (c) => AIR.has(blockName(bot, c) ?? '') && AIR.has(blockName(bot, { ...c, y: c.y + 1 }) ?? '');
    const columns = pattern.missing.filter(c => !isOpen(c));
    const total = columns.length;
    const refusals = [];
    let dug = 0;
    for (const col of columns) {
        if (bot.interrupt_code)
            return { ok: false, reason: 'interrupted', text: TEXTS.stopped(dug, total), built: dug, refused: refusals.length, total };
        if (!(await reach(bot, tools, col, standFor(pattern, col), false))) {
            if (bot.interrupt_code)
                return { ok: false, reason: 'interrupted', text: TEXTS.stopped(dug, total), built: dug, refused: refusals.length, total };
            refusals.push(TEXTS.refusedDig(col, TEXTS.whyUnreachable));
            continue;
        }
        let refused = false;
        for (const c of [col, { ...col, y: col.y + 1 }]) {
            const block = blockOf(bot, c);
            if (!block || AIR.has(block.name))
                continue;
            if (lavaNext(bot, c)) {
                refusals.push(TEXTS.refusedDig(c, TEXTS.whyLava));
                refused = true;
                break;
            }
            if (!canBreak(bot, block, c)) {
                refusals.push(TEXTS.refusedDig(c, whyRefused(bot, c)));
                refused = true;
                break;
            }
            try {
                await tools.dig(bot, c.x, c.y, c.z);
            } catch {
                // the block is read below
            }
            const gone = await settle(tools.clock, () => AIR.has(blockName(bot, c) ?? ''));
            if (!gone) {
                if (bot.interrupt_code)
                    return { ok: false, reason: 'interrupted', text: TEXTS.stopped(dug, total), built: dug, refused: refusals.length, total };
                refusals.push(TEXTS.refusedDig(c, TEXTS.whyDigFailed));
                refused = true;
                break;
            }
        }
        if (!refused && isOpen(col))
            dug++;
    }
    let text = TEXTS.built.tunnel(dug);
    if (refusals.length > 0)
        text += ' ' + TEXTS.refusals(refusals);
    const reason = refusals.length > 0 ? 'refused' : null;
    return { ok: reason === null, reason, text, built: dug, refused: refusals.length, total };
}
