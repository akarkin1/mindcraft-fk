// The mine of the player (spec v0.1.4.9, B2, B3, B6): "this is the mine" (rememberMine), "dig here"
// (rememberTunnel) and "collect the ore you passed" (collectPassedOre). The commands exist only with
// the setting mine_routes; the trail and its pure functions come from the routes pack through
// ctx.routes (I4: ctx.routes.trail.list(), ctx.routes.logic.skyStart and routeFromSteps), which is
// never imported. Executing: every function returns { ok, reason, text, ... } and never throws.
// v0.1.4.10 (R4): forgetMine and minesText, for the commands !forgetMine and !mines.
// v0.1.4.11 (I3): the tunnel is measured with tunnelAt (1 or 2 wide, the rock face, the checks of W2) at the
// bot's cell, then at the player's cell; (I4) !mines lists a mine of a second level under its parent and
// !forgetMine of a parent forgets its children.
import { containsPos } from '../home/box_math.js';
import { botPos, dimensionOf, listAreas, logTo } from '../home/context.js';
import { blockAt, nameReader } from './dig.js';
import { WIDENED_TUNNEL_WIDTH, addTunnel, cellOf, classify, mineAt, tunnelAt, tunnelsOf } from './mine_logic.js';
import { NEAREST_RANGE, cleanMineName, mineId } from './mine_store.js';
import { climbToSurface, descendToLevel, takePassedOre } from './mining.js';
import { mineRoutesOn, walksRoute, wayIn } from './mine_way.js';
import { HERE_ROOM_RANGE, madeMineText, nextMineName } from './here_logic.js';
import { oreOf } from './ore_table.js';
import { TEXTS, collectPassedText, forgetMineText, mineEntryText, minesListText, noEntranceText, rememberMineText, rememberTunnelText,
    unknownOreText } from './texts.js';
// v0.1.4.11: the texts of W2 that part W adds to texts.js are reached at run time (noCorridorText); a named
// import of a name that does not exist yet would break the loading of the pack
import * as TX from './texts.js';

/** The room of a mine: these blocks within this many blocks of the bot or of a step of the way in (spec B2). */
export const ROOM_RANGE = 6;
/** The blocks of the room of the player, by the field of the room. */
export const ROOM_THINGS = Object.freeze({ chest: Object.freeze(['chest']), table: Object.freeze(['crafting_table']), furnace: Object.freeze(['furnace']) });
/** A tunnel of rememberMine is open this many blocks ahead in one direction at least (spec B2). */
export const MIN_TUNNEL_AHEAD = 4;
/** A tunnel of rememberMine and rememberTunnel has this many cells at least, start to end (fix round F7). */
export const MIN_TUNNEL_CELLS = 4;
/** A tunnel whose start is this near the start of a known one replaces it (spec B3). */
export const SAME_TUNNEL = 2;
/** The most points findRoom looks around. */
const ROOM_POINTS = 120;

function feetOf(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

function errText(err) {
    return err?.message ?? String(err);
}

function storeOf(ctx) {
    const m = ctx?.mines;
    return m && typeof m.list === 'function' && typeof m.set === 'function' ? m : null;
}

const NO_STORE = 'I cannot remember mines here: I have no mine store for this world.';

function rememberPlace(ctx, name, p, dimension) {
    const places = ctx?.places;
    try {
        if (typeof places?.remember === 'function') {
            places.remember(name, p.x, p.y, p.z, dimension);
        } else if (typeof places?.rememberPlace === 'function') {
            places.rememberPlace(name, p.x, p.y, p.z, dimension);
        }
    } catch (err) {
        console.warn('Mining pack: could not remember the place of the mine:', errText(err));
    }
}

// The blocks of the names within `range` of a point, nearest first (a scan with blockAt).
function blocksNear(bot, point, names, range = ROOM_RANGE) {
    const out = [];
    const r = Math.ceil(range);
    for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dz = -r; dz <= r; dz++) {
                const d = Math.hypot(dx, dy, dz);
                if (d > range) {
                    continue;
                }
                const p = { x: point.x + dx, y: point.y + dy, z: point.z + dz };
                const name = blockAt(bot, p)?.name;
                if (typeof name === 'string' && names.includes(name)) {
                    out.push({ ...p, d });
                }
            }
        }
    }
    return out.sort((a, b) => a.d - b.d).map(({ x, y, z }) => ({ x, y, z }));
}

/**
 * The room of the mine of the player (spec B2): the chest, the crafting table and the furnace within
 * 6 blocks of the bot, else within 6 blocks of the steps of the way in, the last step first (the
 * bot may say "this is the mine" at the end of the tunnel, far from the room). `center` is the feet
 * of the bot when they are within 6 blocks of a block of the room, else the step of the way nearest
 * to the blocks. null when none of the three is found.
 * @param {object} bot
 * @param {{x,y,z}} feet
 * @param {{x,y,z}[]} steps the steps of the way in, from the entrance
 * @returns {{center: object, chest: object|null, table: object|null, furnace: object|null}|null}
 */
export function findRoom(bot, feet, steps = []) {
    const all = [...ROOM_THINGS.chest, ...ROOM_THINGS.table, ...ROOM_THINGS.furnace];
    const points = [feet, ...[...steps].reverse().map(cellOf).filter(Boolean)];
    const scanned = [];
    let found = null;
    for (const p of points) {
        if (scanned.length >= ROOM_POINTS) {
            break;
        }
        if (scanned.some(q => Math.abs(q.x - p.x) <= 2 && Math.abs(q.y - p.y) <= 2 && Math.abs(q.z - p.z) <= 2)) {
            continue;
        }
        scanned.push(p);
        const near = blocksNear(bot, p, all);
        if (near.length > 0) {
            found = near[0];
            break;
        }
    }
    if (!found) {
        return null;
    }
    const pick = names => blocksNear(bot, found, names)[0] ?? null;
    const room = { chest: pick(ROOM_THINGS.chest), table: pick(ROOM_THINGS.table), furnace: pick(ROOM_THINGS.furnace) };
    const blocks = [room.chest, room.table, room.furnace].filter(Boolean);
    const mid = { x: blocks.reduce((s, b) => s + b.x, 0) / blocks.length, y: blocks.reduce((s, b) => s + b.y, 0) / blocks.length,
        z: blocks.reduce((s, b) => s + b.z, 0) / blocks.length };
    const dist = q => Math.hypot(q.x - mid.x, q.y - mid.y, q.z - mid.z);
    const nearFeet = blocks.some(b => Math.hypot(b.x - feet.x, b.y - feet.y, b.z - feet.z) <= ROOM_RANGE);
    const center = nearFeet ? feet : points.filter(q => blocks.some(b => Math.hypot(b.x - q.x, b.y - q.y, b.z - q.z) <= ROOM_RANGE))
        .sort((a, b) => dist(a) - dist(b))[0] ?? feet;
    return { center: { x: center.x, y: center.y, z: center.z }, ...room };
}

// The name of the area of type mine that holds the bot, or null.
function mineAreaName(bot, ctx, feet) {
    try {
        const c = { x: feet.x + 0.5, y: feet.y, z: feet.z + 0.5 };
        const area = listAreas(ctx, dimensionOf(bot)).find(a => a.type === 'mine' && containsPos(a, c));
        return typeof area?.name === 'string' && area.name.length > 0 ? area.name : null;
    } catch {
        return null;
    }
}

// The record of a measured tunnel as the store keeps it (the width is said, not stored).
function tunnelRecord(t) {
    return { start: t.start, dir: t.dir, end: t.end, level: t.level, length: t.length, branches: [] };
}

// The feet cell of a position of the player, or null.
function playerCell(pos) {
    const ok = pos && [pos.x, pos.y, pos.z].every(v => typeof v === 'number' && Number.isFinite(v));
    return ok ? { x: Math.floor(pos.x), y: Math.floor(pos.y + 0.01), z: Math.floor(pos.z) } : null;
}

/**
 * The tunnel of "dig here" (v0.1.4.11, I3): tunnelAt at the bot's cell (1 or 2 wide, the rock face, 4
 * cells or more, fix round F7), else at the cell of the player (`playerPos`, with the player's yaw).
 * `fromPlayer` when the player's cell gave it; `cause` the first check that failed at the bot's cell.
 * @returns {{tunnel: object|null, width: number, fromPlayer: boolean, cause: object|null}}
 */
function corridorTunnel(get, feet, options = {}) {
    // v0.1.4.13 (Q1): a tunnel that earlier mining widened (up to 4, floor level, ceiling closed) counts too
    const look = { yaw: options.yaw, anchor: options.anchor, minCells: MIN_TUNNEL_CELLS, maxWidth: WIDENED_TUNNEL_WIDTH };
    const first = tunnelAt(get, feet, look);
    if (first.ok) {
        return { tunnel: tunnelRecord(first.tunnel), width: first.tunnel.width, fromPlayer: false, cause: null };
    }
    const p = playerCell(options.playerPos);
    if (p && !(p.x === feet.x && p.y === feet.y && p.z === feet.z)) {
        const second = tunnelAt(get, p, look);
        if (second.ok) {
            return { tunnel: tunnelRecord(second.tunnel), width: second.tunnel.width, fromPlayer: true, cause: null };
        }
    }
    return { tunnel: null, width: 0, fromPlayer: false, cause: first.cause };
}

// The text of a measured tunnel (W2): rememberTunnelText of part W with the width and the cell; until it
// knows them, the same words built here.
function measuredText(tunnel, width, fromPlayer) {
    const t = { ...tunnel, width, fromPlayer };
    const text = rememberTunnelText(t);
    const knows = (width !== 2 || text.includes(', 2 wide.')) && (!fromPlayer || text.includes(' from where you stand:'));
    if (knows) {
        return text;
    }
    let out = rememberTunnelText(tunnel);
    if (width === 2) {
        out = out.replace(/(, at level -?\d+)\. I dig on/, '$1, 2 wide. I dig on');
    }
    return fromPlayer ? out.replace(/^I measured the tunnel:/, 'I measured the tunnel from where you stand:') : out;
}

// The text of no tunnel (W2) by its first failed check, through noCorridorText of part W.
function noCorridorWords(cause) {
    try {
        const text = typeof TX.noCorridorText === 'function' ? TX.noCorridorText(cause) : null;
        if (typeof text === 'string' && text.length > 0) {
            return text;
        }
    } catch {
        // the text of v0.1.4.10
    }
    return TEXTS.noCorridor;
}

// The tunnel at the feet for rememberMine: a corridor open 4 blocks or more ahead, measured away
// from the room (or the entrance). null without one. v0.1.4.11 (I3): by tunnelAt, 1 or 2 wide.
function tunnelHere(bot, feet, anchor, yaw) {
    const r = tunnelAt(nameReader(bot), feet, { anchor, yaw, minAhead: MIN_TUNNEL_AHEAD, minCells: MIN_TUNNEL_CELLS });
    return r.ok ? tunnelRecord(r.tunnel) : null;
}

function near(a, b, range) {
    return Boolean(a && b) && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= range;
}

/**
 * "This is the mine" (spec B2): the trail of the routes pack from its last step under open sky to
 * the bot is the route of the mine (routeFromSteps), the chest, crafting table and furnace of the
 * room (findRoom), and the tunnel the bot stands in, if any, the first tunnel. Saved as a mine of
 * the player with the name; the place of that name is its entrance. A mine of that name is
 * replaced (its tunnels that the new one does not replace and its ore list are kept while the new
 * entrance is within 64 blocks of the old one).
 * @param {object} bot
 * @param {object} ctx
 * @param {string} [name]
 * @param {{playerYaw?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mine: object|null}>}
 */
export function rememberMine(bot, ctx = {}, name = 'mine', options = {}) {
    return Promise.resolve(rememberMineNow(bot, ctx, name, options));
}

function rememberMineNow(bot, ctx, name, options) {
    try {
        const steps = ctx?.routes?.trail?.list?.();
        const logic = ctx?.routes?.logic;
        if (!Array.isArray(steps) || typeof logic?.skyStart !== 'function' || typeof logic?.routeFromSteps !== 'function') {
            return { ok: false, reason: 'no_trail', text: TEXTS.noTrail, mine: null };
        }
        const store = storeOf(ctx);
        const feet = feetOf(bot);
        if (!store || !feet) {
            return { ok: false, reason: store ? 'error' : 'no_store', text: store ? 'I do not know where I am.' : NO_STORE, mine: null };
        }
        const start = logic.skyStart(steps);
        const entrance = Number.isInteger(start) && start >= 0 ? cellOf(steps[start]) : null;
        if (!entrance) {
            const max = ctx?.settings?.trail_max_steps;
            return { ok: false, reason: 'no_entrance', text: noEntranceText(steps.length, Number.isFinite(max) ? max : undefined), mine: null };
        }
        const way = steps.slice(start);
        const route = logic.routeFromSteps(way);
        const legs = Array.isArray(route?.legs) ? route.legs : [];
        const dimension = dimensionOf(bot) ?? 'overworld';
        const clean = cleanMineName(name) ?? 'mine';
        const room = findRoom(bot, feet, way);
        const tunnel = tunnelHere(bot, feet, room?.center ?? entrance, options?.playerYaw);
        const old = store.byName?.(clean, dimension) ?? null;
        const keepOld = old && near(old.entrance, entrance, 64);
        const tunnels = tunnel ? [tunnel] : [];
        for (const t of keepOld ? tunnelsOf(old) : []) {
            if (!tunnel || !near(t.start, tunnel.start, SAME_TUNNEL)) {
                tunnels.push(t);
            }
        }
        const area = mineAreaName(bot, ctx, feet);
        const saved = store.set({
            name: clean, source: 'player', ore: 'iron', entrance, level: feet.y, base: null, chest: null, direction: null, length: 0,
            shaft: 'ladder', dimension, end: null, tunnel: [], route: legs, room, tunnels, passed: keepOld ? old.passed : [], area,
            created: old?.created,
        });
        rememberPlace(ctx, clean, entrance, dimension);
        const text = rememberMineText({ name: clean, entrance, route: legs, room, tunnel, replaced: Boolean(old), area });
        logTo(ctx, text);
        return { ok: true, reason: null, text, mine: saved };
    } catch (err) {
        console.warn('Mining pack: remembering the mine failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not remember the mine: ${errText(err)}`, mine: null };
    }
}

/**
 * "Dig here" (spec B3): the mine is the one named, else the one the bot is in (mineAt), else the
 * nearest within 64 blocks; the tunnel is measured where the bot stands (measureTunnel) in the
 * direction of the corridor nearest to the yaw of the player (`options.playerYaw`), else in the
 * longest corridor, pointing away from the room of the mine (a yaw towards the room is ignored,
 * fix round F6). The tunnel is a corridor of 4 cells or more by the rule of rememberMine (fix
 * round F7), else the text of no corridor. A tunnel whose start is within 2 blocks of the start of
 * a known one replaces it (its branches are kept when the direction is the same).
 * v0.1.4.11 (I3): the tunnel is measured by tunnelAt: 1 or 2 wide (the text says `2 wide`), at the rock
 * face away from the room; when the bot's cell is no tunnel, the cell of the player (`options.playerPos`,
 * with `options.playerYaw`) is measured (`from where you stand`); else the text names the first check
 * that failed at the bot's cell (W2), reason no_corridor.
 * @param {object} bot
 * @param {object} ctx
 * @param {string} [name] the name of the mine, '' for the mine here
 * @param {{playerYaw?: number, playerPos?: {x: number, y: number, z: number}}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mine: object|null, tunnel: object|null}>}
 */
export function rememberTunnel(bot, ctx = {}, name = '', options = {}) {
    return Promise.resolve(rememberTunnelNow(bot, ctx, name, options));
}

function rememberTunnelNow(bot, ctx, name, options) {
    try {
        const store = storeOf(ctx);
        const feet = feetOf(bot);
        if (!store || !feet) {
            return { ok: false, reason: store ? 'error' : 'no_store', text: store ? 'I do not know where I am.' : NO_STORE, mine: null, tunnel: null };
        }
        const dimension = dimensionOf(bot) ?? undefined;
        let mine = (typeof name === 'string' && name.trim().length > 0 ? store.byName?.(name, dimension) : null)
            ?? mineAt(store.list(dimension), feet)?.mine ?? store.nearest?.(feet, dimension, NEAREST_RANGE) ?? null;
        if (!mine) {
            return { ok: false, reason: 'no_mine', text: TEXTS.noMineHere, mine: null, tunnel: null };
        }
        const get = nameReader(bot);
        const anchor = mine.room?.center ?? mine.base ?? mine.entrance;
        const found = corridorTunnel(get, feet, { yaw: options?.playerYaw, anchor, playerPos: options?.playerPos });
        if (!found.tunnel) {
            return { ok: false, reason: 'no_corridor', text: noCorridorWords(found.cause), mine, tunnel: null };
        }
        // a start within 2 blocks of a known one replaces that tunnel (addTunnel, the rule of v0.1.4.9)
        const changed = addTunnel(mine, found.tunnel, SAME_TUNNEL);
        const tunnel = (changed.tunnels ?? []).find(t => near(t.start, found.tunnel.start, 0) && t.dir === found.tunnel.dir) ?? found.tunnel;
        const saved = store.set(changed);
        const text = measuredText(found.tunnel, found.width, found.fromPlayer);
        logTo(ctx, text);
        return { ok: true, reason: null, text, mine: saved, tunnel };
    } catch (err) {
        console.warn('Mining pack: measuring the tunnel failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not measure the tunnel: ${errText(err)}`, mine: null, tunnel: null };
    }
}

// v0.1.4.13 (Q1): the room of a mine made where the bot stands: a chest or a crafting table within 8 blocks (the
// nearest), with the furnace, chest and table near it; null when there is none. The center is the feet.
function roomNear(bot, feet) {
    const first = blocksNear(bot, feet, [...ROOM_THINGS.chest, ...ROOM_THINGS.table], HERE_ROOM_RANGE)[0];
    if (!first) {
        return null;
    }
    const pick = names => blocksNear(bot, first, names)[0] ?? null;
    return { center: { ...feet }, chest: pick(ROOM_THINGS.chest), table: pick(ROOM_THINGS.table), furnace: pick(ROOM_THINGS.furnace) };
}

// The anchor of the tunnel of a mine made underground: its room (a chest or table), else the far end of the longest
// open run at the feet, so that the digging goes on at the end nearer to the bot.
function hereAnchor(get, feet, room) {
    const block = room?.chest ?? room?.table ?? null;
    if (block) {
        return block;
    }
    let best = null;
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        let n = 0;
        const open = (k) => classify(get(feet.x + dx * k, feet.y, feet.z + dz * k)) === 'air'
            && classify(get(feet.x + dx * k, feet.y + 1, feet.z + dz * k)) === 'air';
        while (n < 64 && open(n + 1)) {
            n++;
        }
        if (n > 0 && (!best || n > best.n)) {
            best = { n, at: { x: feet.x + dx * n, y: feet.y, z: feet.z + dz * n } };
        }
    }
    return best?.at ?? null;
}

/**
 * `!mineOre` from where the bot stands (v0.1.4.13, Q1). Underground, in no mine the bot knows, with mine_routes on:
 * - no known mine within 64 blocks: the room within 8 blocks that has a chest or a crafting table (else the bot's cell)
 *   becomes the mine `mine N` (the next free name) with the way in unknown, and the tunnel the bot stands in (1 to 4
 *   wide, a widened one with a level floor and a closed ceiling) becomes its tunnel; the text of Q1 is said;
 * - a known mine within 64 blocks and a tunnel that earlier mining widened (3 or 4 wide): the tunnel is added to that
 *   mine as "dig here" adds it, with its text (a tunnel 1 or 2 wide is left to mineOre, as in v0.1.4.11).
 * The mine made has its entrance 2 blocks above the floor of the bot's cell: the climb of the trip then asks for the
 * way out, which says it is unknown (noWayOutText), instead of taking the bot for one on the surface.
 * Nothing happens (made false) on the surface, in a known mine, without mine_routes or without a store; and in open
 * rock with no tunnel at the feet, where mineOre gives its refusal of v0.1.4.11.
 * @param {object} bot
 * @param {object} ctx the pack context (mines, whereAmI, settings, routes, say, log)
 * @param {string} ore
 * @returns {{ok: boolean, reason: string|null, text: string, made: boolean, mine: object|null}}
 */
export function mineHere(bot, ctx = {}, ore = '') {
    const none = { ok: true, reason: null, text: '', made: false, mine: null };
    try {
        const row = oreOf(ore);
        const store = storeOf(ctx);
        const feet = feetOf(bot);
        if (!row || !store || !feet || !mineRoutesOn(ctx) || ctx?.whereAmI?.()?.underground !== true) {
            return none;
        }
        const dimension = dimensionOf(bot) ?? 'overworld';
        const mines = store.list(dimension);
        if (mineAt(mines, feet)) {
            return none; // in a known mine: the rules of v0.1.4.11 (I4)
        }
        const get = nameReader(bot);
        const near = store.nearest?.(feet, dimension, NEAREST_RANGE) ?? null;
        if (near) {
            // a known mine near: v0.1.4.11 measures a tunnel 1 or 2 wide (measureHere); Q1 adds a widened one
            const anchor = near.room?.center ?? near.base ?? near.entrance;
            if (tunnelAt(get, feet, { anchor, minCells: MIN_TUNNEL_CELLS }).ok) {
                return none;
            }
            const wide = tunnelAt(get, feet, { anchor, minCells: MIN_TUNNEL_CELLS, maxWidth: WIDENED_TUNNEL_WIDTH });
            if (!wide.ok) {
                return none;
            }
            const saved = store.set(addTunnel(near, tunnelRecord(wide.tunnel), SAME_TUNNEL));
            const text = measuredText(tunnelRecord(wide.tunnel), wide.tunnel.width, false);
            sayOrLog(ctx, text);
            return { ok: true, reason: null, text, made: true, mine: saved };
        }
        const room = roomNear(bot, feet);
        const found = tunnelAt(get, feet, { anchor: hereAnchor(get, feet, room), minCells: MIN_TUNNEL_CELLS, maxWidth: WIDENED_TUNNEL_WIDTH });
        if (!found.ok) {
            return none; // open rock with no tunnel: the old refusal of mineOre
        }
        const name = nextMineName(mines.map(m => m.name).filter(Boolean));
        const tunnel = tunnelRecord(found.tunnel);
        const saved = store.set({
            name, source: 'player', ore: row.ore, entrance: { x: feet.x, y: feet.y + 2, z: feet.z }, level: feet.y, base: null, chest: null,
            direction: null, length: 0, shaft: 'ladder', dimension, end: null, tunnel: [], route: [],
            room: room ?? { center: { ...feet }, chest: null, table: null, furnace: null }, tunnels: [tunnel], passed: [],
            area: mineAreaName(bot, ctx, feet),
        });
        const text = madeMineText(name, tunnel);
        sayOrLog(ctx, text);
        return { ok: true, reason: null, text, made: true, mine: saved };
    } catch (err) {
        console.warn('Mining pack: making the mine here failed:', err?.stack ?? err);
        return none;
    }
}

// A text for the player now (ctx.say), else into the log of the command.
function sayOrLog(ctx, text) {
    try {
        if (typeof ctx?.say === 'function') {
            ctx.say(text);
            return;
        }
    } catch {
        // the log below
    }
    logTo(ctx, text);
}

// An empty ore, `all` or `ore`: every ore of the list.
function everyOre(ore) {
    return typeof ore !== 'string' || ['', 'all', 'ore', 'ores', 'any'].includes(ore.trim().toLowerCase());
}

/**
 * "Collect the coal you passed" (spec B6): the mine the bot is in (mineAt), else the nearest within
 * 64 blocks; the entries of the ore list of that ore (every ore for '' or `all`), nearest to the room
 * first, at most `count` blocks. A bot outside the mine or on its way in walks in first (along the
 * route, or down the shaft of a mine of the bot) and comes out again at the end; a bot in the room
 * or a tunnel stays there.
 * Each entry is checked again and taken with the vein rule (takePassedOre).
 * @param {object} bot
 * @param {object} ctx
 * @param {string} ore
 * @param {number} [count]
 * @param {object} [options] the clock of the tests (now, wait)
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, collected: number}>}
 */
export async function collectPassedOre(bot, ctx = {}, ore = '', count = 8, options = {}) {
    try {
        const row = everyOre(ore) ? null : oreOf(ore);
        if (!everyOre(ore) && !row) {
            return { ok: false, reason: 'unknown_ore', text: unknownOreText(ore), collected: 0 };
        }
        const store = storeOf(ctx);
        const feet = feetOf(bot);
        if (!store || !feet) {
            return { ok: false, reason: store ? 'error' : 'no_store', text: store ? 'I do not know where I am.' : NO_STORE, collected: 0 };
        }
        const dimension = dimensionOf(bot) ?? undefined;
        const here = mineAt(store.list(dimension), feet);
        const mine = here?.mine ?? store.nearest?.(feet, dimension, NEAREST_RANGE) ?? null;
        if (!mine) {
            return { ok: false, reason: 'no_mine', text: TEXTS.noMineHere, collected: 0 };
        }
        const wanted = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 8;
        const anchor = mine.room?.center ?? mine.base ?? mine.entrance;
        const entries = (Array.isArray(mine.passed) ? mine.passed : []).filter(e => !row || e.ore === row.ore)
            .sort((a, b) => Math.hypot(a.x - anchor.x, a.y - anchor.y, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.y - anchor.y, b.z - anchor.z));
        if (entries.length === 0) {
            return { ok: false, reason: 'none', text: collectPassedText({ ore: row?.ore ?? null, none: true, mine }), collected: 0 };
        }
        const total = Math.min(entries.length, wanted);
        const pass = { now: options.now, wait: options.wait };
        // on the way in (or outside) the bot walks in first and out again at the end
        const outside = !here || here.onRoute;
        if (outside) {
            const inside = walksRoute(mine) ? await wayIn(bot, ctx, mine, pass) : await descendToLevel(bot, ctx, mine.level, { ...pass, mine });
            if (!inside.ok) {
                return { ok: false, reason: inside.reason === 'interrupted' ? 'interrupted' : 'no_path', text: inside.text, collected: 0 };
            }
        }
        const r = await takePassedOre(bot, ctx, mine, entries, { ...pass, wanted });
        let text = collectPassedText({ ore: row?.ore ?? null, collected: r.collected, stay: r.stay, stopped: r.stopped, done: r.taken, total, mine });
        let reason = r.reason;
        if (outside && !r.stopped && !bot.interrupt_code) {
            const up = await climbToSurface(bot, ctx, { ...pass, mine: r.mine ?? mine });
            if (!up.ok && typeof up.text === 'string' && up.text.length > 0) {
                // F12 of the real server: a failed way out was hidden behind the text of the ore
                text = `${text} ${up.text}`;
                reason = up.reason === 'interrupted' ? 'interrupted' : reason;
            }
        }
        logTo(ctx, text);
        return { ok: r.ok, reason, text, collected: r.taken };
    } catch (err) {
        console.warn('Mining pack: collecting the ore left behind failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not collect the ore I passed: ${errText(err)}`, collected: 0 };
    }
}

// The mines dug from inside a mine and from inside those (I4), at most 4 levels deep.
function childrenOf(store, mine, depth = 0) {
    if (typeof store?.children !== 'function' || depth >= 4) {
        return [];
    }
    return store.children(mine).flatMap(c => [c, ...childrenOf(store, c, depth + 1)]);
}

// One mine of a second level in the text of !mines (I4): `bot:-58 (from the mine "mine")`.
function childEntryText(mine) {
    try {
        const text = typeof TX.childMineEntryText === 'function' ? TX.childMineEntryText(mine) : null;
        if (typeof text === 'string' && text.length > 0) {
            return text;
        }
    } catch {
        // the words of the spec
    }
    return `${mineId(mine)} (from the mine "${mine.parent}")`;
}

/**
 * Forgets a mine (spec I6, R4): the mine of that name, else for "16" or "bot:16" the mine of the bot at
 * that level, else the mine of the bot for an ore (MineStore.remove). In every dimension.
 * `Forgot the mine "mine".` or `I know no mine "mine".`
 * @param {object} ctx with mines, the MineStore of the world
 * @param {string} name
 * @returns {{ok: boolean, reason: null|'no_store'|'no_mine'|'error', text: string}}
 */
export function forgetMine(ctx = {}, name = '') {
    try {
        const store = storeOf(ctx);
        if (!store) {
            return { ok: false, reason: 'no_store', text: NO_STORE };
        }
        const asked = typeof name === 'string' ? name.trim() : String(name ?? '').trim();
        const mine = typeof store.find === 'function' ? store.find(name) : store.byName?.(name) ?? null;
        // v0.1.4.11 (I4): the mines dug from inside it go with it
        const children = mine ? childrenOf(store, mine) : [];
        if (!mine || typeof store.remove !== 'function' || !store.remove(name)) {
            return { ok: false, reason: 'no_mine', text: forgetMineText(asked, false) };
        }
        for (const child of children) {
            store.remove(mineId(child), child.dimension);
        }
        const text = forgetMineText(mine.name ?? asked, true);
        logTo(ctx, text);
        return { ok: true, reason: null, text };
    } catch (err) {
        console.warn('Mining pack: forgetting the mine failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not forget the mine: ${errText(err)}` };
    }
}

/**
 * The mines the bot knows in a dimension (spec I6, R4), the mines with a name first, then the mines of
 * the bot, the highest level first:
 * `I know 2 mines: "mine", entrance (9, 67, 52), 2 tunnels at levels 30 and 25; the mine at (9, 67, 58) that I dug, level 16.`
 * or `I know no mines.` v0.1.4.11 (I4): a mine of a second level follows its parent:
 * `"mine", entrance (9, 67, 52), 1 tunnel at level 30; bot:-58 (from the mine "mine")`.
 * Without a store the text of rememberMine without one. Never throws: an error gives
 * `I could not read the mines: <error>`.
 * @param {object} ctx with mines, the MineStore of the world
 * @param {string} [dimension] all dimensions without one
 * @returns {string}
 */
export function minesText(ctx = {}, dimension = undefined) {
    try {
        const store = storeOf(ctx);
        if (!store) {
            return NO_STORE;
        }
        const mines = store.list(dimension ?? undefined);
        // I4: a mine whose parent is in the list is listed under it, not on its own
        const parentIn = m => typeof m.parent === 'string' && mines.some(p => p !== m && p.dimension === m.dimension && mineId(p) === m.parent);
        const top = mines.filter(m => !parentIn(m));
        const named = top.filter(m => typeof m.name === 'string' && m.name.length > 0);
        const others = top.filter(m => !named.includes(m));
        const entries = [];
        const add = (m, depth) => {
            entries.push(depth === 0 ? mineEntryText(m, tunnelsOf(m)) : childEntryText(m));
            if (depth < 4) {
                mines.filter(c => c !== m && c.parent === mineId(m) && c.dimension === m.dimension).forEach(c => add(c, depth + 1));
            }
        };
        [...named, ...others].forEach(m => add(m, 0));
        return minesListText(entries);
    } catch (err) {
        console.warn('Mining pack: listing the mines failed:', err?.stack ?? err);
        return `I could not read the mines: ${errText(err)}`;
    }
}
