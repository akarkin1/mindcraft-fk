// The mine of the player (spec v0.1.4.9, B2, B3, B6): "this is the mine" (rememberMine), "dig here"
// (rememberTunnel) and "collect the ore you passed" (collectPassedOre). The commands exist only with
// the setting mine_routes; the trail and its pure functions come from the routes pack through
// ctx.routes (I4: ctx.routes.trail.list(), ctx.routes.logic.skyStart and routeFromSteps), which is
// never imported. Executing: every function returns { ok, reason, text, ... } and never throws.
import { containsPos } from '../home/box_math.js';
import { botPos, dimensionOf, listAreas, logTo } from '../home/context.js';
import { blockAt, nameReader } from './dig.js';
import { cellOf, corridorDirections, isCorridor, measureTunnel, mineAt, posKey, tunnelDirection, tunnelsOf } from './mine_logic.js';
import { NEAREST_RANGE, cleanMineName } from './mine_store.js';
import { climbToSurface, descendToLevel, takePassedOre } from './mining.js';
import { walksRoute, wayIn } from './mine_way.js';
import { oreOf } from './ore_table.js';
import { TEXTS, collectPassedText, noEntranceText, rememberMineText, rememberTunnelText, unknownOreText } from './texts.js';

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

// The tunnel measured at the feet in `dir` when it is a corridor (every cell at most 2 open
// neighbours at the feet level: no room) of 4 cells or more (fix round F7), else null.
function corridorTunnel(get, feet, dir) {
    const m = dir ? measureTunnel(get, feet, dir) : null;
    return m && m.length >= MIN_TUNNEL_CELLS && isCorridor(get, m)
        ? { start: m.start, dir: m.dir, end: m.end, level: m.level, length: m.length, branches: [] } : null;
}

// The tunnel at the feet for rememberMine: a corridor open 4 blocks or more ahead, measured away
// from the room (or the entrance). null without one.
function tunnelHere(bot, feet, anchor, yaw) {
    const get = nameReader(bot);
    const dirs = corridorDirections(get, feet).filter(d => d.length >= MIN_TUNNEL_AHEAD);
    return corridorTunnel(get, feet, tunnelDirection(dirs, feet, { anchor, yaw }));
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
 * @param {object} bot
 * @param {object} ctx
 * @param {string} [name] the name of the mine, '' for the mine here
 * @param {{playerYaw?: number}} [options]
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
        const dirs = corridorDirections(get, feet);
        const anchor = mine.room?.center ?? mine.base ?? mine.entrance;
        const tunnel = corridorTunnel(get, feet, tunnelDirection(dirs, feet, { yaw: options?.playerYaw, anchor }));
        if (!tunnel) {
            return { ok: false, reason: 'no_corridor', text: TEXTS.noCorridor, mine, tunnel: null };
        }
        mine = JSON.parse(JSON.stringify(mine));
        const list = tunnelsOf(mine);
        const same = list.findIndex(t => near(t.start, tunnel.start, SAME_TUNNEL));
        if (same >= 0) {
            tunnel.branches = list[same].dir === tunnel.dir ? list[same].branches ?? [] : [];
            list[same] = tunnel;
        } else {
            list.push(tunnel);
        }
        mine.tunnels = list;
        if (same === 0 && mine.source !== 'player' && mine.direction) {
            // the tunnel of a mine of the bot: its fields of v0.1.4.7 follow the measure
            mine.direction = tunnel.dir;
            mine.end = tunnel.end;
            mine.tunnel = [tunnel.start, tunnel.end].filter((p, i, a) => i === 0 || posKey(p) !== posKey(a[0]));
            mine.length = Math.max(0, tunnel.length - 1);
        }
        const saved = store.set(mine);
        const text = rememberTunnelText(tunnel);
        logTo(ctx, text);
        return { ok: true, reason: null, text, mine: saved, tunnel };
    } catch (err) {
        console.warn('Mining pack: measuring the tunnel failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not measure the tunnel: ${errText(err)}`, mine: null, tunnel: null };
    }
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
