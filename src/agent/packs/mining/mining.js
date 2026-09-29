// The mining trip (spec v0.1.4.7 M4), built the way the owner described it: go down to the level
// of the ore on ladders, clear a room, dig one tunnel in one direction, close lava, water and
// caves with cobblestone, collect the ore, store at the chest of the mine, come back up.
//
// ctx is the pack context { areas, places, settings, log, now, mines, storage, tools, skills }:
// - mines: the MineStore of the world (without it the mine lives only for the call);
// - storage: { storeItems, fetchItem } (optional: without it the bot does not store or fetch);
// - tools: { ensureTool, craftSupplies }, called as fn(bot, ctx, ...) (optional);
// - skills.craftRecipe(bot, name, count) for a second chest (optional);
// - whereAmI() -> { underground } (v0.1.4.8, optional: without it the bot counts as on the surface);
// - say(text): a text for the player (v0.1.4.8, optional: without it the text goes to log).
// Every function returns { ok, reason, text, ... } with numbers, ends on bot.interrupt_code, has an
// upper limit of time and never throws.
import { horizontalDistanceToBox } from '../home/box_math.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo, recallHome } from '../home/context.js';
import { chooseFood, isEdibleFood } from '../home/food_logic.js';
import { walkNear } from '../home/motion.js';
import {
    blockAt, collectDrops, countOf, digClear, equipPickaxe, fillerCount, freeSlots, inventoryList, isFree, isSolid,
    logicName, nameReader, patchAll, placeInto, placeTorch, stepInto, walkTo, REACH,
} from './dig.js';
import { followDown, followUp, placeLadder, waitStanding } from './ladder.js';
import {
    backOf, chooseEntrance, classify, faceNeighbours, leftOf, offset, posKey, returnTimeMs, rightOf, roomPlan,
    shaftAllowed, shaftStep, shaftView, shouldReturn, staircaseStep, staircaseView, tripNeeds, tripStart, tunnelAllowed, tunnelSlots,
    tunnelStep, tunnelView, usablePickaxes, veinOrder,
} from './mine_logic.js';
import { MineStore } from './mine_store.js';
import { ORES, isOreBlock, oreOf, targetLevel, tripPickaxe } from './ore_table.js';
import {
    STOP_REASONS, TEXTS, askMineText, cannotMineText, descendText, mineOreText, posText, suppliesStoppedText, suppliesText, tunnelText,
    unknownOreText,
} from './texts.js';

/** Minutes of one trip when the setting mining_max_minutes is missing. */
export const DEFAULT_MAX_MINUTES = 30;
/** Moves of the shaft to the side in one descent before the bot gives up. */
export const MAX_SHAFT_MOVES = 4;
/** Tunnel steps between two checks of shouldReturn in mineOre. */
export const TUNNEL_CHUNK = 4;
/** Tries to read blocks that are not loaded yet. */
const UNKNOWN_TRIES = 3;

const ORE_ITEMS = ORES.map(r => r.item);

// ------------------------------------------------------------------ small helpers

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function feetOf(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

function errText(err) {
    return err?.message ?? String(err);
}

function storeOf(ctx) {
    const m = ctx?.mines;
    return m && typeof m.get === 'function' && typeof m.set === 'function' ? m : null;
}

function saveMine(ctx, job, mine) {
    const store = storeOf(ctx) ?? job?.memoryStore;
    try {
        const saved = store ? store.set(mine) : mine;
        return saved ?? mine;
    } catch (err) {
        console.warn('Mining pack: could not save the mine:', errText(err));
        return mine;
    }
}

function maxMinutes(ctx) {
    const v = ctx?.settings?.mining_max_minutes;
    return isFiniteNumber(v) && v > 0 ? v : DEFAULT_MAX_MINUTES;
}

function oreCounts(bot) {
    const out = {};
    for (const i of inventoryList(bot)) {
        if (ORE_ITEMS.includes(i.name)) {
            out[i.name] = (out[i.name] ?? 0) + i.count;
        }
    }
    return out;
}

function diffCounts(before, after) {
    const out = {};
    for (const [k, v] of Object.entries(after)) {
        const d = v - (before[k] ?? 0);
        if (d > 0) {
            out[k] = d;
        }
    }
    return out;
}

function addCounts(into, more) {
    for (const [k, v] of Object.entries(more ?? {})) {
        if (isFiniteNumber(v) && v > 0) {
            into[k] = (into[k] ?? 0) + v;
        }
    }
    return into;
}

function newStats() {
    return { dug: 0, ladders: 0, torches: 0, patches: 0, stairs: 0, moves: 0 };
}

function areasOf(bot, ctx) {
    try {
        return listAreas(ctx, dimensionOf(bot));
    } catch {
        return [];
    }
}

async function callTool(ctx, group, name, bot, ...args) {
    const fn = ctx?.[group]?.[name];
    if (typeof fn !== 'function') {
        return null;
    }
    try {
        return await fn(bot, ctx, ...args);
    } catch (err) {
        console.warn(`Mining pack: ${group}.${name} failed:`, errText(err));
        return { ok: false, reason: 'error', text: errText(err) };
    }
}

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

// A text for the player: ctx.say when the glue gives it, else the progress log (v0.1.4.8, E4).
function sayTo(ctx, text) {
    try {
        if (typeof ctx?.say === 'function') {
            ctx.say(text);
            return;
        }
    } catch {
        // saying must not break an action
    }
    logTo(ctx, text);
}

// True when ctx.whereAmI says the bot is under the ground; without it the bot is on the surface.
function underground(ctx) {
    try {
        return ctx?.whereAmI?.()?.underground === true;
    } catch {
        return false;
    }
}

// The place `home` in the dimension of the bot as a list of one point, for chooseEntrance.
function homePoints(ctx, bot) {
    const home = recallHome(ctx);
    const dim = dimensionOf(bot);
    const hd = typeof home?.dimension === 'string' ? home.dimension.replace(/^minecraft:/, '') : null;
    return home && (!dim || !hd || hd === dim) ? [{ x: home.x, z: home.z }] : [];
}

// Blocks from a position to the house: the nearest area of type home, else the place `home`; null without a house.
function houseDistance(ctx, bot, p) {
    const c = { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
    const homes = areasOf(bot, ctx).filter(a => a.type === 'home').map(a => horizontalDistanceToBox(a, c));
    if (homes.length > 0) {
        return Math.min(...homes);
    }
    const place = homePoints(ctx, bot)[0];
    return place ? Math.hypot(place.x - c.x, place.z - c.z) : null;
}

// The top solid blocks of the columns around the bot and the columns of the other mines, for chooseEntrance.
function entranceInput(bot, ctx, level) {
    const feet = feetOf(bot);
    const avoid = [];
    try {
        for (const other of storeOf(ctx)?.list() ?? []) {
            avoid.push(other.entrance, ...other.route.filter(l => l.kind === 'ladder').map(l => ({ x: l.x, z: l.z })));
        }
    } catch {
        // no other mines
    }
    return {
        bot: feet, level, areas: areasOf(bot, ctx), ground: groundReader(bot, (feet?.y ?? 64) + 12), avoid, homes: homePoints(ctx, bot),
        free: (x, yy, z) => isFree(blockAt(bot, { x, y: yy, z })),
    };
}

/** How long the place that mineOre offered for a new mine is used when the player says yes. */
export const PROPOSAL_MS = 10 * 60000;
// bot -> { ore, entrance: {x, y, z, dir}, at }: the place of the last question of mineOre
const proposals = new WeakMap();

// The place of a new mine for the ore: the one offered in the last question when it is recent, still
// allowed and within reach, else chooseEntrance. null when there is none.
function newEntrance(bot, ctx, row, clock) {
    const feet = feetOf(bot);
    if (!feet) {
        return null;
    }
    const input = entranceInput(bot, ctx, targetLevel(row, feet.y, bot.game?.minY ?? -64));
    const last = proposals.get(bot);
    if (last && last.ore === row.ore && clock.now() - last.at <= PROPOSAL_MS && Math.hypot(last.entrance.x - feet.x, last.entrance.z - feet.z) <= 48) {
        const again = chooseEntrance({ ...input, bot: last.entrance, range: 0, level: targetLevel(row, last.entrance.y, bot.game?.minY ?? -64) });
        if (again) {
            return again;
        }
    }
    return chooseEntrance(input);
}

// The cells the mine has opened: the route (ladder columns, walks, staircases), the room and the
// tunnel between its corners. Our own open blocks are never taken for a cave.
function mineCells(mine) {
    const cells = new Set();
    const add = p => cells.add(posKey(p));
    for (const leg of mine?.route ?? []) {
        if (leg.kind === 'ladder') {
            for (let y = leg.bottom; y <= leg.top + 2; y++) {
                add({ x: leg.x, y, z: leg.z });
            }
        } else {
            const n = Math.max(Math.abs(leg.to.x - leg.from.x), Math.abs(leg.to.z - leg.from.z));
            for (let k = 0; k <= n; k++) {
                const t = n === 0 ? 0 : k / n;
                const p = { x: Math.round(leg.from.x + (leg.to.x - leg.from.x) * t), y: Math.round(leg.from.y + (leg.to.y - leg.from.y) * t),
                    z: Math.round(leg.from.z + (leg.to.z - leg.from.z) * t) };
                for (let up = 0; up <= (leg.kind === 'stairs' ? 3 : 1); up++) {
                    add({ ...p, y: p.y + up });
                }
            }
        }
    }
    if (mine?.base && mine.direction) {
        for (const p of roomPlan(mine.base, mine.direction).all) {
            add(p);
        }
    }
    const corners = Array.isArray(mine?.tunnel) ? mine.tunnel : [];
    for (let i = 1; i < corners.length; i++) {
        const a = corners[i - 1];
        const b = corners[i];
        const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z));
        for (let k = 0; k <= n; k++) {
            const p = { x: a.x + Math.sign(b.x - a.x) * k, y: a.y, z: a.z + Math.sign(b.z - a.z) * k };
            add(p);
            add({ ...p, y: p.y + 1 });
        }
    }
    if (corners.length === 1) {
        add(corners[0]);
        add({ ...corners[0], y: corners[0].y + 1 });
    }
    return cells;
}

/**
 * The corners of a tunnel with a new cell at its end: a cell that goes on in the direction of the
 * last piece replaces its end, otherwise it is a new corner.
 * @param {{x,y,z}[]} corners
 * @param {{x,y,z}} p
 * @returns {{x: number, y: number, z: number}[]}
 */
export function extendTunnel(corners, p) {
    const list = Array.isArray(corners) ? corners.map(c => ({ x: c.x, y: c.y, z: c.z })) : [];
    const cell = { x: p.x, y: p.y, z: p.z };
    const last = list[list.length - 1];
    if (!last) {
        return [cell];
    }
    if (last.x === cell.x && last.y === cell.y && last.z === cell.z) {
        return list;
    }
    const prev = list[list.length - 2];
    const straight = prev && last.y === cell.y && prev.y === last.y
        && Math.sign(last.x - prev.x) === Math.sign(cell.x - last.x) && Math.sign(last.z - prev.z) === Math.sign(cell.z - last.z);
    if (straight) {
        list[list.length - 1] = cell;
    } else {
        list.push(cell);
    }
    return list;
}

// A reader for the logic that names our own open blocks `mined` (a solid for the logic).
function readerWith(bot, ours) {
    return (x, y, z) => {
        const block = blockAt(bot, { x, y, z });
        const name = logicName(block);
        return name !== null && ours.has(`${x},${y},${z}`) && isFree(block) ? 'mined' : name;
    };
}

function makeJob(bot, ctx, options = {}) {
    const clock = clockOf(ctx, options);
    const start = clock.now();
    const deadline = isFiniteNumber(options.deadline) ? options.deadline
        : start + (isFiniteNumber(options.timeoutMs) ? options.timeoutMs : maxMinutes(ctx) * 60000);
    return { bot, ctx, clock, start, deadline, areas: areasOf(bot, ctx), stats: newStats(), memoryStore: options.memoryStore ?? null };
}

function overdue(job) {
    return job.clock.now() > job.deadline;
}

/**
 * The mine the bot is in or at: the mine whose tunnel level or route contains the feet of the
 * bot, else the one whose entrance is nearest (within 64 blocks). null when there is none.
 * @param {object} bot
 * @param {object} ctx
 * @returns {object|null}
 */
export function currentMine(bot, ctx) {
    const store = storeOf(ctx);
    const feet = feetOf(bot);
    if (!store || !feet) {
        return null;
    }
    let mines = [];
    try {
        mines = store.list(dimensionOf(bot) ?? undefined);
    } catch {
        return null;
    }
    const inside = mines.find(m => mineCells(m).has(posKey(feet)) || mineCells(m).has(posKey({ ...feet, y: feet.y + 1 })));
    if (inside) {
        return inside;
    }
    const atLevel = mines.filter(m => m.level === feet.y && m.base && Math.hypot(m.base.x - feet.x, m.base.z - feet.z) < 160);
    if (atLevel.length > 0) {
        return atLevel[0];
    }
    const near = mines.map(m => ({ m, d: Math.hypot(m.entrance.x - feet.x, m.entrance.y - feet.y, m.entrance.z - feet.z) }))
        .filter(e => e.d <= 64).sort((a, b) => a.d - b.d);
    return near[0]?.m ?? null;
}

// ------------------------------------------------------------------ prepare

function haveFood(bot, ctx = {}) {
    const foods = bot.registry?.foodsByName;
    return carriedFood(bot, ctx).some(i => (foods ? Boolean(foods[i.name]) : false) && !['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish'].includes(i.name));
}

// The inventory for tripNeeds: inventoryList and the item of the off-hand (slot 45), v0.1.4.8 E4.
function tripInventory(bot) {
    const list = inventoryList(bot);
    try {
        const off = bot.inventory.slots?.[45];
        if (off?.name && !list.some(i => i.slot === 45)) {
            list.push({ name: off.name, count: off.count, slot: 45, uses_left: null });
        }
    } catch {
        // no off-hand
    }
    return list;
}

function foodNamesInChests(ctx, bot) {
    const foods = bot.registry?.foodsByName ?? {};
    const names = new Set();
    try {
        for (const chest of ctx?.chests?.list?.() ?? []) {
            for (const name of Object.keys(chest.items ?? {})) {
                if (foods[name] && !['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish'].includes(name)) {
                    names.add(name);
                }
            }
        }
    } catch {
        // no index
    }
    return [...names];
}

/**
 * Gets ready for a trip for the ore (spec M4): computes tripNeeds and gets what is missing,
 * from chests through ctx.storage and crafted through ctx.tools. Cobblestone is collected on the
 * way down. Without a pickaxe of the needed material (at least stone) the bot does not go; it goes
 * without torches or with fewer ladders and says so. Since v0.1.4.8 (E4) it first says what it
 * gets (ctx.say), takes ladders only for the part of the way down that has none yet, and ends
 * with `interrupted` when it is stopped.
 * @param {object} bot
 * @param {object} ctx
 * @param {string} ore
 * @param {{mine?: object, surfaceY?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, missing: object[], level: number|null, text: string}>}
 */
export async function prepareMiningTrip(bot, ctx = {}, ore = '', options = {}) {
    try {
        const row = oreOf(ore);
        if (!row) {
            return { ok: false, reason: 'unknown_ore', missing: [], level: null, text: unknownOreText(ore) };
        }
        const mine = options.mine ?? storeOf(ctx)?.get(row.ore, dimensionOf(bot) ?? undefined) ?? null;
        const feet = feetOf(bot);
        const surfaceY = mine ? mine.entrance.y : (isFiniteNumber(options.surfaceY) ? options.surfaceY : feet?.y ?? 64);
        const level = mine ? mine.level : targetLevel(row, surfaceY, bot.game?.minY ?? -64);
        const material = tripPickaxe(row);
        const way = mine && Array.isArray(mine.route) && mine.route.length > 0 ? routeEnd(mine) : null;
        const needs = () => tripNeeds(row, surfaceY, level, tripInventory(bot), {
            foods: bot.registry?.foodsByName, shaftExists: Boolean(way), wayDownTo: way?.y, hasBase: Boolean(mine?.base),
        });
        let plan = needs();
        const notes = [];
        const lack = name => plan.missing.find(m => m.name === name && !m.spare);
        const stopped = () => (bot.interrupt_code
            ? { ok: false, reason: 'interrupted', missing: plan.missing, level, text: suppliesStoppedText(plan.missing) } : null);
        const say = suppliesText(plan.missing);
        if (say) {
            sayTo(ctx, say);
        }
        if (lack('pickaxe') || plan.missing.find(m => m.name === 'pickaxe' && m.spare)) {
            const count = plan.needs.find(n => n.name === 'pickaxe')?.count ?? 1;
            await callTool(ctx, 'tools', 'ensureTool', bot, 'pickaxe', material, { count });
            plan = needs();
            if (stopped()) {
                return stopped();
            }
        }
        if (lack('pickaxe')) {
            const best = usablePickaxes(inventoryList(bot), 'wooden')[0]?.name ?? null;
            return { ok: false, reason: 'pickaxe', missing: plan.missing, level, text: cannotMineText(row.ore, material, best) };
        }
        const canFetch = typeof ctx?.storage?.fetchItem === 'function';
        const canCraft = typeof ctx?.tools?.craftSupplies === 'function';
        for (const name of ['ladder', 'torch', 'chest']) {
            const m = lack(name);
            if (!m) {
                continue;
            }
            if (canFetch) {
                await callTool(ctx, 'storage', 'fetchItem', bot, name, m.count);
            }
            plan = needs();
            if (stopped()) {
                return stopped();
            }
            const still = lack(name);
            if (still && canCraft) {
                await callTool(ctx, 'tools', 'craftSupplies', bot, name, still.count);
                plan = needs();
                if (stopped()) {
                    return stopped();
                }
            }
        }
        const food = lack('food');
        if (food && canFetch) {
            let want = food.count;
            for (const name of foodNamesInChests(ctx, bot)) {
                const r = await callTool(ctx, 'storage', 'fetchItem', bot, name, want);
                want -= isFiniteNumber(r?.taken) ? r.taken : 0;
                if (want <= 0 || bot.interrupt_code) {
                    break;
                }
            }
            plan = needs();
            if (stopped()) {
                return stopped();
            }
        }
        if (!canFetch && !canCraft) {
            notes.push(TEXTS.carryOnly);
        }
        const ladders = countOf(bot, 'ladder');
        if (lack('ladder')) {
            notes.push(`I have ${ladders} ladders for ${plan.rest} blocks, the rest of the way down is a staircase.`);
        }
        if (lack('torch')) {
            const t = countOf(bot, 'torch');
            notes.push(t === 0 ? 'I go without torches.' : `I have only ${t} torches.`);
        }
        if (lack('food')) {
            notes.push(haveFood(bot, ctx) ? 'I have little food with me.' : 'I have no food with me.');
        }
        if (lack('chest')) {
            notes.push('I have no chest for the base.');
        }
        const text = [`I am ready for the trip to level ${level}.`, ...notes].join(' ');
        logTo(ctx, text);
        return { ok: true, reason: null, missing: plan.missing, level, text };
    } catch (err) {
        console.warn('Mining pack: preparing the trip failed:', errText(err));
        return { ok: false, reason: 'error', missing: [], level: null, text: `I could not get ready for the trip: ${errText(err)}` };
    }
}

// ------------------------------------------------------------------ the shaft

async function waitFeet(job, y) {
    const { bot, clock } = job;
    const start = clock.now();
    while (clock.now() - start < 3000) {
        if (bot.interrupt_code) {
            return false;
        }
        const f = feetOf(bot);
        if (f && f.y <= y && bot.entity?.onGround) {
            return true;
        }
        await clock.wait(25);
    }
    return (feetOf(bot)?.y ?? Infinity) <= y;
}

// One sideways passage of `n` steps, 2 high, by tunnelStep. Returns the new feet or null.
async function passage(job, from, dir, n, ours) {
    const { bot, clock } = job;
    let feet = { ...from };
    for (let k = 0; k < n; k++) {
        let step = null;
        for (let look = 0; look < 4; look++) {
            step = tunnelStep(tunnelView(readerWith(bot, ours), feet, dir, 0));
            if (step.action !== 'patch') {
                break;
            }
            if (fillerCount(bot) < step.patch.length) {
                return null;
            }
            const r = await patchAll(bot, step.patch, { clock });
            job.stats.patches += r.placed;
            if (!r.ok) {
                return null;
            }
        }
        const slots = tunnelSlots(feet, dir);
        if (step.action !== 'dig' || !tunnelAllowed(slots['ahead.lower'], job.areas)) {
            return null;
        }
        for (const key of ['ahead.upper', 'ahead.lower']) {
            const r = await digClear(bot, slots[key], { clock });
            job.stats.dug += r.dug;
            if (!r.ok) {
                return null;
            }
            ours.add(posKey(slots[key]));
        }
        const w = await walkTo(bot, slots['ahead.lower'], { clock, timeoutMs: 8000 });
        if (!w.ok) {
            return null;
        }
        feet = slots['ahead.lower'];
    }
    return feet;
}

// The shaft cannot go on here: go 3 blocks to the side and start a new column of ladders there.
async function moveShaft(job, mine, leg, ours) {
    const { bot, clock } = job;
    const from = feetOf(bot);
    if (!from || job.moves >= MAX_SHAFT_MOVES) {
        return false;
    }
    job.moves = (job.moves ?? 0) + 1;
    for (const side of [rightOf(leg.face), leftOf(leg.face), leg.face]) {
        const target = offset(from, side, 3);
        if (!shaftAllowed(target, job.areas)) {
            continue;
        }
        logTo(job.ctx, `The shaft cannot go on at ${posText(from)}. I move it 3 blocks ${side}.`);
        const end = await passage(job, from, side, 3, ours);
        if (!end) {
            await walkTo(bot, from, { clock, timeoutMs: 8000 });
            if (bot.interrupt_code) {
                return false;
            }
            continue;
        }
        mine.route.push({ kind: 'walk', from, to: end });
        mine.route.push({ kind: 'ladder', x: end.x, z: end.z, top: end.y - 1, bottom: end.y, face: side, entry: offset(end, side, -1) });
        job.stats.moves++;
        return true;
    }
    return false;
}

async function handlePatch(job, step, onFail) {
    const { bot, clock } = job;
    if (fillerCount(bot) < step.patch.length) {
        return onFail('no_block');
    }
    const r = await patchAll(bot, step.patch, { clock });
    job.stats.patches += r.placed;
    return r.ok ? true : onFail(r.reason);
}

// Digs the shaft down from where the bot stands to the level: ladders while it has them, then a
// staircase. Returns { ok, reason }.
async function digDown(job, mine, level, ours) {
    const { bot, clock } = job;
    let unknown = 0;
    let turns = 0;
    let mode = mine.route.length > 0 && mine.route[mine.route.length - 1].kind === 'stairs' ? 'stairs' : 'ladder';
    let sdir = mode === 'stairs' ? mine.route[mine.route.length - 1].dir : mine.direction;
    let steps = 0;
    for (;;) {
        if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted' };
        }
        if (overdue(job)) {
            return { ok: false, reason: 'time' };
        }
        const feet = feetOf(bot);
        if (!feet) {
            return { ok: false, reason: 'error' };
        }
        if (feet.y <= level) {
            return { ok: true, reason: null };
        }
        if (steps > 0 && steps % 4 === 0) {
            Object.assign(mine, saveMine(job.ctx, job, mine));
        }
        const read = readerWith(bot, ours);
        if (mode === 'ladder') {
            const leg = mine.route[mine.route.length - 1];
            const step = shaftStep(shaftView(read, feet));
            if (step.action === 'unknown') {
                if (++unknown > UNKNOWN_TRIES) {
                    return { ok: false, reason: 'unknown' };
                }
                await clock.wait(1000);
                continue;
            }
            unknown = 0;
            if (step.action === 'bottom') {
                return { ok: false, reason: 'bottom' };
            }
            if (step.action === 'lava') {
                if (!(await moveShaft(job, mine, leg, ours))) {
                    return { ok: false, reason: bot.interrupt_code ? 'interrupted' : 'blocked' };
                }
                continue;
            }
            if (step.action === 'cave' || step.action === 'patch') {
                const ok = await handlePatch(job, step, () => false);
                if (!ok && !(await moveShaft(job, mine, leg, ours))) {
                    return { ok: false, reason: bot.interrupt_code ? 'interrupted' : 'blocked' };
                }
                continue;
            }
            // dig
            if (countOf(bot, 'ladder') === 0) {
                logTo(job.ctx, `I have no more ladders at ${posText(feet)}. I go on as a staircase.`);
                mode = 'stairs';
                sdir = mine.direction;
                continue;
            }
            const target = { x: feet.x, y: feet.y - 1, z: feet.z };
            const dug = await digClear(bot, target, { clock });
            job.stats.dug += dug.dug;
            if (!dug.ok) {
                return { ok: false, reason: dug.reason === 'interrupted' ? 'interrupted' : 'blocked' };
            }
            ours.add(posKey(target));
            await waitFeet(job, target.y);
            await waitStanding(bot, clock, 2000);
            const now = feetOf(bot);
            if (!now || now.y !== target.y) {
                return { ok: false, reason: 'stuck' };
            }
            let placed = await placeLadder(bot, now, leg.face, { clock });
            if (!placed.ok && placed.reason === 'no_item') {
                // the count of the inventory was late: the last ladder is gone, the column ends here
                leg.bottom = now.y;
                logTo(job.ctx, `I have no more ladders at ${posText(now)}. I go on as a staircase.`);
                mode = 'stairs';
                sdir = mine.direction;
                continue;
            }
            if (!placed.ok && placed.reason === 'no_wall') {
                const r = await patchAll(bot, [offset(now, backOf(leg.face))], { clock });
                job.stats.patches += r.placed;
                placed = await placeLadder(bot, now, leg.face, { clock });
            }
            if (!placed.ok) {
                return { ok: false, reason: placed.reason === 'interrupted' ? 'interrupted' : 'ladder' };
            }
            job.stats.ladders += placed.placed;
            leg.bottom = now.y;
            steps++;
            continue;
        }
        // a staircase: one forward, one down
        const column = offset(feet, sdir);
        const step = staircaseStep(staircaseView(read, feet, sdir));
        const turn = () => {
            if (++turns > 3) {
                return false;
            }
            sdir = rightOf(sdir);
            return true;
        };
        if (!shaftAllowed(column, job.areas)) {
            if (!turn()) {
                return { ok: false, reason: 'area' };
            }
            continue;
        }
        if (step.action === 'unknown') {
            if (++unknown > UNKNOWN_TRIES) {
                return { ok: false, reason: 'unknown' };
            }
            await clock.wait(1000);
            continue;
        }
        unknown = 0;
        if (step.action === 'bottom') {
            return { ok: false, reason: 'bottom' };
        }
        if (step.action === 'lava') {
            if (!turn()) {
                return { ok: false, reason: 'blocked' };
            }
            continue;
        }
        if (step.action === 'cave' || step.action === 'patch') {
            const ok = await handlePatch(job, step, () => false);
            if (!ok && !turn()) {
                return { ok: false, reason: 'blocked' };
            }
            continue;
        }
        turns = 0;
        for (const up of [2, 1, 0, -1]) {
            const p = { x: column.x, y: feet.y + up, z: column.z };
            const r = await digClear(bot, p, { clock });
            job.stats.dug += r.dug;
            if (!r.ok) {
                return { ok: false, reason: r.reason === 'interrupted' ? 'interrupted' : 'blocked' };
            }
            ours.add(posKey(p));
        }
        const next = { x: column.x, y: feet.y - 1, z: column.z };
        if (!(await stepInto(bot, next, clock))) {
            const w = await walkTo(bot, next, { clock, timeoutMs: 8000 });
            if (!w.ok) {
                return { ok: false, reason: w.reason === 'interrupted' ? 'interrupted' : 'stuck' };
            }
        }
        const last = mine.route[mine.route.length - 1];
        if (last?.kind === 'stairs' && last.dir === sdir && last.to.x === feet.x && last.to.y === feet.y && last.to.z === feet.z) {
            last.to = next;
        } else {
            mine.route.push({ kind: 'stairs', from: feet, to: next, dir: sdir });
        }
        mine.shaft = 'stairs';
        job.stats.stairs++;
        steps++;
    }
}

function routeEnd(mine) {
    const last = mine.route[mine.route.length - 1];
    if (!last) {
        return null;
    }
    return last.kind === 'ladder' ? { x: last.x, y: last.bottom, z: last.z } : last.to;
}

async function toEntrance(job, entrance) {
    const { bot, clock, ctx } = job;
    const w = await walkTo(bot, entrance, { clock, timeoutMs: 60000 });
    if (w.ok || w.reason === 'interrupted') {
        return w;
    }
    const n = await walkNear(bot, entrance, 0, { clock, timeoutMs: 90000, allowDig: true, areas: areasOf(bot, ctx) });
    const f = feetOf(bot);
    return f && f.x === entrance.x && f.z === entrance.z && Math.abs(f.y - entrance.y) <= 0 ? { ok: true, reason: null } : { ok: false, reason: n.reason ?? 'no_path' };
}

function groundReader(bot, top) {
    return (x, z) => {
        for (let y = top; y > top - 24; y--) {
            const b = blockAt(bot, { x, y, z });
            if (!b) {
                return null;
            }
            const name = logicName(b);
            if (name === 'water' || name === 'lava') {
                return { y, name };
            }
            if (isSolid(b)) {
                return { y, name };
            }
        }
        return null;
    };
}

/**
 * Goes down to level y (spec M4). With a mine in the store (options.mine, or the mine of
 * options.ore, or the mine at that level) the bot walks to its entrance and follows its way down,
 * and digs on where the way ends above the level. Otherwise it chooses an entrance on the ground at
 * least 8 blocks from every protected area and at most 48 blocks from the bot, remembers it as the
 * place `mine`, and digs a shaft of 1 by 1 with ladders on one wall by shaftStep; lava below or a
 * cave without cobblestone moves the shaft 3 blocks to the side; without ladders it goes on as a
 * staircase by staircaseStep. A torch goes at the top of the shaft.
 * @param {object} bot
 * @param {object} ctx
 * @param {number} y the level: feet of the bot in the tunnel
 * @param {{ore?: string, mine?: object, deadline?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mine: object|null, dug: number, ladders: number, torches: number, patches: number, stairs: number}>}
 */
export async function descendToLevel(bot, ctx = {}, y = 16, options = {}) {
    const job = makeJob(bot, ctx, { ...options, timeoutMs: options.timeoutMs ?? 20 * 60000 });
    const done = (ok, reason, mine, text) => ({ ok, reason, text, mine, ...job.stats });
    try {
        const level = Math.floor(y);
        const store = storeOf(ctx);
        const row = oreOf(options.ore);
        let mine = options.mine ?? (row ? store?.get(row.ore, dimensionOf(bot) ?? undefined) : null) ?? store?.atLevel?.(level, dimensionOf(bot) ?? undefined) ?? null;
        if (mine && mine.level !== level) {
            mine = null;
        }
        const feet = feetOf(bot);
        if (!feet) {
            return done(false, 'error', null, 'I do not know where I am.');
        }
        let ours;
        if (mine) {
            mine = JSON.parse(JSON.stringify(mine));
            ours = mineCells(mine);
            const inside = ours.has(posKey(feet)) && feet.y <= mine.entrance.y - 2;
            if (!inside) {
                logTo(ctx, `I go to the mine at ${posText(mine.entrance)}.`);
                const first = mine.route[0];
                if (first?.entry) {
                    const w = await walkTo(bot, first.entry, { clock: job.clock, timeoutMs: 90000 });
                    if (!w.ok) {
                        const n = await walkNear(bot, first.entry, 0, { clock: job.clock, timeoutMs: 90000, allowDig: true, areas: job.areas });
                        if (!n.ok) {
                            return done(false, n.reason === 'interrupted' ? 'interrupted' : 'no_path', mine, `I could not get to the mine at ${posText(mine.entrance)}.`);
                        }
                    }
                }
            }
            if (!inside || (feetOf(bot)?.y ?? 0) > routeEnd(mine)?.y) {
                const down = await followDown(bot, mine.route, { clock: job.clock, deadline: job.deadline });
                if (!down.ok) {
                    return done(false, down.reason === 'interrupted' ? 'interrupted' : 'stuck', mine, `I could not climb down into the mine at ${posText(mine.entrance)}.`);
                }
            }
            if ((feetOf(bot)?.y ?? Infinity) <= level) {
                return done(true, null, mine, descendText({ level, mine, climbed: true }));
            }
        } else {
            // v0.1.4.8, E4: a new mine starts only from the surface, at the place mineOre chose, or at least
            // 16 blocks from the house and the areas of people
            if (underground(ctx)) {
                return done(false, 'underground', null, TEXTS.underground);
            }
            const given = options.entrance;
            const entrance = given && isFiniteNumber(given.x) && isFiniteNumber(given.y) && isFiniteNumber(given.z) && given.dir
                ? given : chooseEntrance(entranceInput(bot, ctx, level));
            if (!entrance) {
                return done(false, 'no_entrance', null, TEXTS.noEntrance);
            }
            const e = { x: entrance.x, y: entrance.y, z: entrance.z };
            logTo(ctx, `I start a mine at ${posText(e)}, its tunnel will lead ${entrance.dir}.`);
            const w = await toEntrance(job, e);
            if (!w.ok) {
                return done(false, w.reason === 'interrupted' ? 'interrupted' : 'no_path', null, `I could not get to the place for the mine at ${posText(e)}.`);
            }
            mine = {
                ore: row?.ore ?? 'iron', entrance: e, level, base: null, chest: null, direction: entrance.dir, length: 0, shaft: 'ladder',
                dimension: dimensionOf(bot) ?? 'overworld', end: null, tunnel: [],
                route: [{ kind: 'ladder', x: e.x, z: e.z, top: e.y - 1, bottom: e.y, face: entrance.dir, entry: offset(e, backOf(entrance.dir)) }],
            };
            mine = { ...mine, ...saveMine(ctx, job, mine) };
            rememberPlace(ctx, 'mine', e, dimensionOf(bot));
            const t = await placeTorch(bot, offset(e, rightOf(entrance.dir)), { clock: job.clock });
            job.stats.torches += t.placed;
            ours = mineCells(mine);
        }
        const r = await digDown(job, mine, level, ours);
        mine = { ...mine, ...saveMine(ctx, job, mine) };
        if (!r.ok) {
            const why = {
                interrupted: 'I stopped going down.', time: 'The time for going down is over.', bottom: 'I reached the bottom of the world.',
                blocked: 'Lava, water or caves block the way down, and I found no way around them.', unknown: 'I cannot see the blocks under me.',
                ladder: 'I could not place a ladder.', area: 'The way down would come too near a protected area.', stuck: 'I got stuck in the shaft.',
            }[r.reason] ?? 'I could not go on down.';
            return done(false, r.reason, mine, `${why} I am at ${posText(feetOf(bot))}, ${descendText({ level, mine, ...job.stats }).replace(/^I went down to level -?\d+/, 'on the way to level ' + level)}`);
        }
        return done(true, null, mine, descendText({ level, mine, ...job.stats }));
    } catch (err) {
        console.warn('Mining pack: going down failed:', err?.stack ?? err);
        return done(false, 'error', null, `I could not go down: ${errText(err)}`);
    }
}

// ------------------------------------------------------------------ the base

async function openCells(job, cells, ours, allowed) {
    const { bot, clock } = job;
    for (const cell of cells) {
        if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted' };
        }
        if (overdue(job)) {
            return { ok: false, reason: 'time' };
        }
        if (!allowed(cell)) {
            return { ok: false, reason: 'area' };
        }
        const read = readerWith(bot, ours);
        const patch = [];
        const own = read(cell.x, cell.y, cell.z);
        if (own === null) {
            return { ok: false, reason: 'unknown' };
        }
        if (classify(own) === 'water' || classify(own) === 'lava') {
            patch.push(cell);
        }
        for (const n of faceNeighbours(cell)) {
            if (cells.some(c => c.x === n.x && c.y === n.y && c.z === n.z) || ours.has(posKey(n))) {
                continue;
            }
            const kind = classify(read(n.x, n.y, n.z));
            if (kind === 'unknown') {
                return { ok: false, reason: 'unknown' };
            }
            if (kind === 'air' || kind === 'water' || kind === 'lava') {
                patch.push(n);
            }
        }
        if (patch.length > 0) {
            const ok = await handlePatch(job, { patch: patch.sort((a, b) => b.y - a.y) }, () => false);
            if (!ok) {
                return { ok: false, reason: 'blocked' };
            }
        }
        const r = await digClear(bot, cell, { clock });
        job.stats.dug += r.dug;
        if (!r.ok) {
            return { ok: false, reason: r.reason === 'interrupted' ? 'interrupted' : 'blocked' };
        }
        ours.add(posKey(cell));
    }
    return { ok: true, reason: null };
}

/**
 * At the bottom of the shaft (spec M4): clears a room of 3 by 3 and 3 high in front of the shaft,
 * closing lava, water and caves around it, places the chest at the wall beside the shaft and a
 * torch, picks up what it dug and saves the mine with its base.
 * @param {object} bot
 * @param {object} ctx
 * @param {{mine?: object, deadline?: number, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mine: object|null, dug: number, patches: number, torches: number, chest: object|null}>}
 */
export async function setupMineBase(bot, ctx = {}, options = {}) {
    const job = makeJob(bot, ctx, { ...options, timeoutMs: options.timeoutMs ?? 5 * 60000 });
    const done = (ok, reason, mine, text, chest = null) => ({ ok, reason, text, mine, chest, ...job.stats });
    try {
        let mine = options.mine ?? currentMine(bot, ctx);
        const feet = feetOf(bot);
        if (!mine || !feet) {
            return done(false, 'no_mine', null, TEXTS.noMine);
        }
        mine = JSON.parse(JSON.stringify(mine));
        if (feet.y !== mine.level) {
            return done(false, 'not_at_level', mine, `I am not at the bottom of the mine: I am at ${posText(feet)}, the mine is at level ${mine.level}.`);
        }
        const base = mine.base ?? feet;
        const plan = roomPlan(base, mine.direction);
        const ours = mineCells({ ...mine, base: null });
        ours.add(posKey(base));
        const opened = await openCells(job, plan.cells, ours, p => tunnelAllowed(p, job.areas));
        if (!opened.ok) {
            return done(false, opened.reason, mine, `I could not clear the room at ${posText(base)}: ${STOP_REASONS[opened.reason] ?? opened.reason}.`);
        }
        let chest = null;
        const there = blockAt(bot, plan.chest);
        if (there?.name === 'chest') {
            chest = plan.chest;
        } else if (countOf(bot, 'chest') > 0) {
            const r = await placeInto(bot, plan.chest, 'chest', { clock: job.clock, check: b => b?.name === 'chest' });
            chest = r.ok ? plan.chest : null;
        }
        const t = await placeTorch(bot, plan.torch, { clock: job.clock });
        job.stats.torches += t.placed;
        const middle = offset(base, mine.direction, 1);
        await walkTo(bot, middle, { clock: job.clock, timeoutMs: 8000 });
        await collectDrops(bot, middle, { clock: job.clock, radius: 3, timeoutMs: 8000 });
        mine.base = base;
        mine.chest = chest;
        if (!mine.end || mine.length === 0) {
            mine.end = plan.front;
            mine.tunnel = [plan.front];
            mine.length = 0;
        }
        mine = { ...mine, ...saveMine(ctx, job, mine) };
        const text = `I set up the base of the mine at ${posText(base)}: a room of 3 by 3 with ${chest ? 'a chest' : 'no chest'} and ${job.stats.torches > 0 || blockAt(bot, plan.torch)?.name === 'torch' ? 'a torch' : 'no torch'}. I dug ${job.stats.dug} blocks and closed ${job.stats.patches} holes.`;
        logTo(ctx, text);
        return done(true, null, mine, text, chest);
    } catch (err) {
        console.warn('Mining pack: setting up the base failed:', err?.stack ?? err);
        return done(false, 'error', null, `I could not set up the base: ${errText(err)}`);
    }
}

// ------------------------------------------------------------------ the tunnel

function eyeDistance(bot, p) {
    const b = botPos(bot);
    return b ? Math.hypot(p.x + 0.5 - b.x, p.y + 0.5 - (b.y + 1.62), p.z + 0.5 - b.z) : Infinity;
}

// Mines the blocks of veins, nearest first. A hole with lava, water or a cave behind it is closed
// again after the drop is picked up; lava beside an ore block leaves it where it is.
async function mineVeins(job, blocks, ours, tunnelFeet) {
    const { bot, clock } = job;
    const toClose = [];
    let mined = 0;
    for (const v of blocks) {
        if (bot.interrupt_code || overdue(job)) {
            break;
        }
        const block = blockAt(bot, v);
        if (!isOreBlock(logicName(block)) || !tunnelAllowed(v, job.areas)) {
            continue;
        }
        const read = readerWith(bot, ours);
        const around = faceNeighbours(v).filter(n => !ours.has(posKey(n)));
        const kinds = around.map(n => classify(read(n.x, n.y, n.z)));
        if (kinds.includes('lava') || kinds.includes('unknown')) {
            continue;
        }
        // an ore block the bot stands on is dug only with a solid block under it
        const me = feetOf(bot);
        if (me && me.x === v.x && me.z === v.z && me.y - 1 === v.y && !isSolid(blockAt(bot, { x: v.x, y: v.y - 1, z: v.z }))) {
            continue;
        }
        const water = around.filter((n, i) => kinds[i] === 'water');
        if (water.length > 0) {
            const r = await patchAll(bot, water, { clock });
            job.stats.patches += r.placed;
            if (!r.ok) {
                continue;
            }
        }
        if (eyeDistance(bot, v) > REACH - 0.3) {
            await walkTo(bot, v, { clock, timeoutMs: 6000, range: 2 });
            if (eyeDistance(bot, v) > REACH) {
                continue;
            }
        }
        const r = await digClear(bot, v, { clock });
        job.stats.dug += r.dug;
        if (!r.ok) {
            continue;
        }
        mined++;
        ours.add(posKey(v));
        if (kinds.includes('air')) {
            toClose.push(v);
        }
    }
    if (mined > 0) {
        await collectDrops(bot, tunnelFeet, { clock, radius: 6, timeoutMs: 20000, dig: true, areas: job.areas });
        await walkTo(bot, tunnelFeet, { clock, timeoutMs: 10000 });
    }
    if (toClose.length > 0) {
        const r = await patchAll(bot, toClose, { clock });
        job.stats.patches += r.placed;
        for (const p of toClose) {
            ours.delete(posKey(p));
        }
    }
    return mined;
}

function pickaxeState(bot, material) {
    const list = usablePickaxes(inventoryList(bot), material);
    return { uses: list[0]?.uses ?? null, spare: list.length >= 2 };
}

// Goes 3 blocks to the side of a tunnel that cannot go on, right first.
async function sideStep(job, feet, dir, ours) {
    const { bot, clock } = job;
    for (const side of [rightOf(dir), leftOf(dir)]) {
        const end = await passage(job, feet, side, 3, ours);
        if (end) {
            return end;
        }
        await walkTo(bot, feet, { clock, timeoutMs: 8000 });
        if (bot.interrupt_code) {
            return null;
        }
    }
    return null;
}

/**
 * Digs the tunnel of the mine (spec M4): from the room, or from the end of the tunnel of the mine,
 * straight in the direction of the mine, 1 wide and 2 high, by tunnelStep; `length` steps. Lava,
 * water and air around are closed first; lava or water ahead, or a cave ahead, is closed and the
 * tunnel goes on 3 blocks to the side. The ore of the view is collected, the whole vein. A torch
 * every 8 steps on the floor. The mine is saved after every step.
 * @param {object} bot
 * @param {object} ctx
 * @param {number} [length]
 * @param {{mine?: object, deadline?: number, timeoutMs?: number, shouldStop?: () => string|null, material?: string}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mine: object|null, steps: number, length: number, collected: object, dug: number, torches: number, patches: number}>}
 */
export async function digTunnel(bot, ctx = {}, length = 8, options = {}) {
    const job = makeJob(bot, ctx, { ...options, timeoutMs: options.timeoutMs ?? Math.max(60000, length * 30000) });
    const collected = {};
    let steps = 0;
    let mine = null;
    const done = (ok, reason) => {
        const r = { ok, reason, mine, steps, length: mine?.length ?? 0, collected, ...job.stats };
        return { ...r, text: tunnelText({ ...r, reason: ok ? null : reason }) };
    };
    try {
        mine = options.mine ?? currentMine(bot, ctx);
        if (!mine) {
            return { ...done(false, 'no_mine'), text: TEXTS.noMine };
        }
        mine = JSON.parse(JSON.stringify(mine));
        if (!mine.base || !mine.end || !mine.direction) {
            return { ...done(false, 'no_base'), text: 'The mine has no base yet.' };
        }
        const ours = mineCells(mine);
        const w = await walkTo(bot, mine.end, { clock: job.clock, timeoutMs: 90000 });
        if (!w.ok) {
            return { ...done(false, w.reason === 'interrupted' ? 'interrupted' : 'stuck'), text: `I could not get to the end of the tunnel at ${posText(mine.end)}.` };
        }
        const material = options.material ?? 'stone';
        const d = mine.direction;
        let feet = { ...mine.end };
        let unknown = 0;
        let looks = 0;
        while (steps < length) {
            if (bot.interrupt_code) {
                return done(false, 'interrupted');
            }
            if (overdue(job)) {
                return done(false, 'time');
            }
            const stop = typeof options.shouldStop === 'function' ? options.shouldStop() : null;
            if (stop) {
                return done(true, stop);
            }
            if (!(await equipPickaxe(bot, material))) {
                return done(false, 'no_pickaxe');
            }
            const n = mine.length + 1;
            const step = tunnelStep(tunnelView(readerWith(bot, ours), feet, d, n));
            const slots = tunnelSlots(feet, d);
            if (step.action === 'unknown') {
                if (++unknown > UNKNOWN_TRIES) {
                    return done(false, 'unknown');
                }
                await job.clock.wait(1000);
                continue;
            }
            unknown = 0;
            if (!tunnelAllowed(slots['ahead.lower'], job.areas) || !tunnelAllowed(slots['ahead.upper'], job.areas)) {
                return done(false, 'area');
            }
            if (step.action === 'patch' && looks < 4) {
                looks++;
                const ok = await handlePatch(job, step, () => false);
                if (ok) {
                    continue;
                }
            }
            if (step.action === 'turn' || step.action === 'patch') {
                looks = 0;
                if (step.patch.length > 0) {
                    const r = await patchAll(bot, step.patch, { clock: job.clock });
                    job.stats.patches += r.placed;
                }
                logTo(ctx, `The tunnel meets ${step.action === 'turn' ? 'lava, water or a cave' : 'something I cannot close'} at ${posText(slots['ahead.lower'])}. I go 3 blocks to the side.`);
                const before = oreCounts(bot);
                const end = await sideStep(job, feet, d, ours);
                addCounts(collected, diffCounts(before, oreCounts(bot)));
                if (!end) {
                    return done(false, bot.interrupt_code ? 'interrupted' : 'blocked');
                }
                mine.tunnel = extendTunnel(extendTunnel(mine.tunnel, feet), end);
                feet = end;
                mine.length += 3;
                mine.end = feet;
                steps += 3;
                mine = { ...mine, ...saveMine(ctx, job, mine) };
                continue;
            }
            looks = 0;
            const veins = [];
            const seen = new Set();
            for (const ore of step.ores) {
                for (const v of veinOrder(ore, nameReader(bot), 12)) {
                    if (!seen.has(posKey(v)) && !(v.x === slots['ahead.upper'].x && v.y === slots['ahead.upper'].y && v.z === slots['ahead.upper'].z)
                        && !(v.x === slots['ahead.lower'].x && v.y === slots['ahead.lower'].y && v.z === slots['ahead.lower'].z)) {
                        seen.add(posKey(v));
                        veins.push(v);
                    }
                }
            }
            const before = oreCounts(bot);
            let blocked = null;
            for (const key of ['ahead.upper', 'ahead.lower']) {
                const recheck = () => ['dig'].includes(tunnelStep(tunnelView(readerWith(bot, ours), feet, d, n)).action);
                const r = await digClear(bot, slots[key], { clock: job.clock, recheck });
                job.stats.dug += r.dug;
                if (!r.ok) {
                    blocked = r.reason;
                    break;
                }
                ours.add(posKey(slots[key]));
            }
            if (blocked === 'interrupted') {
                return done(false, 'interrupted');
            }
            if (blocked) {
                if (++looks > 6) {
                    return done(false, 'blocked');
                }
                continue;
            }
            if (!isFree(blockAt(bot, slots['ahead.upper'])) || !isFree(blockAt(bot, slots['ahead.lower']))) {
                // gravel or sand fell in after all: the same step again
                if (++looks > 6) {
                    return done(false, 'blocked');
                }
                continue;
            }
            const moved = await walkTo(bot, slots['ahead.lower'], { clock: job.clock, timeoutMs: 8000 });
            if (!moved.ok) {
                return done(false, moved.reason === 'interrupted' ? 'interrupted' : 'stuck');
            }
            feet = slots['ahead.lower'];
            mine.length = n;
            mine.end = feet;
            mine.tunnel = extendTunnel(mine.tunnel, feet);
            steps++;
            if (step.torch) {
                const t = await placeTorch(bot, feet, { clock: job.clock });
                job.stats.torches += t.placed;
            }
            if (veins.length > 0) {
                await mineVeins(job, veins, ours, feet);
            }
            await collectDrops(bot, feet, { clock: job.clock, radius: 2, timeoutMs: 3000 });
            addCounts(collected, diffCounts(before, oreCounts(bot)));
            mine = { ...mine, ...saveMine(ctx, job, mine) };
        }
        return done(true, null);
    } catch (err) {
        console.warn('Mining pack: digging the tunnel failed:', err?.stack ?? err);
        return { ...done(false, 'error'), text: `I could not dig the tunnel: ${errText(err)}` };
    }
}

// ------------------------------------------------------------------ storing at the base

/**
 * Walks back to the chest of the mine and stores by the keep plan through ctx.storage (spec M4,
 * amendment 1: with `chest` set to the chest of the mine), with ore items stored and cobblestone
 * kept up to 32. With a full chest it places a second one beside it, crafted from planks if it
 * carries them. `options.keep` adds items to keep (mineOre keeps the ore of its trip).
 * @param {object} bot
 * @param {object} ctx
 * @param {{mine?: object, keep?: object, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, stored: object, left: object, mine: object|null}>}
 */
export async function depositAtBase(bot, ctx = {}, options = {}) {
    const job = makeJob(bot, ctx, { ...options, timeoutMs: options.timeoutMs ?? 3 * 60000 });
    const stored = {};
    let mine = null;
    const done = (ok, reason, text, left = {}) => ({ ok, reason, text, stored, left, mine });
    try {
        mine = options.mine ?? currentMine(bot, ctx);
        if (!mine || !mine.base) {
            return done(false, 'no_mine', TEXTS.noMine);
        }
        mine = JSON.parse(JSON.stringify(mine));
        if (typeof ctx?.storage?.storeItems !== 'function') {
            return done(false, 'no_storage', TEXTS.noStorage);
        }
        const plan = roomPlan(mine.base, mine.direction);
        const w = await walkTo(bot, offset(mine.base, mine.direction, 1), { clock: job.clock, timeoutMs: 120000 });
        if (!w.ok) {
            return done(false, w.reason === 'interrupted' ? 'interrupted' : 'stuck', `I could not get back to the base of the mine at ${posText(mine.base)}.`);
        }
        // one chest stays with the bot for the day the chest of the mine is full
        const keep = { cobblestone: 32, chest: 1, ...(options.keep ?? {}) };
        const chests = [];
        for (const p of [mine.chest, plan.chest, plan.chest2]) {
            if (p && blockAt(bot, p)?.name === 'chest' && !chests.some(c => c.x === p.x && c.y === p.y && c.z === p.z)) {
                chests.push(p);
            }
        }
        if (chests.length === 0 && countOf(bot, 'chest') > 0) {
            const r = await placeInto(bot, plan.chest, 'chest', { clock: job.clock, check: b => b?.name === 'chest' });
            if (r.ok) {
                chests.push(plan.chest);
                mine.chest = plan.chest;
            }
        }
        let last = null;
        for (let i = 0; i < 3; i++) {
            // after a new chest was placed it comes first
            const order = i === 0 ? chests : [chests[chests.length - 1], ...chests.slice(0, -1)];
            for (const chest of order) {
                last = await ctx.storage.storeItems(bot, ctx, { chest, keep });
                addCounts(stored, last?.stored);
                if (!last || last.reason !== 'full') {
                    break;
                }
            }
            if (!last || last.reason !== 'full' || chests.length >= 2 || bot.interrupt_code) {
                break;
            }
            // the chests are full: a second chest beside the first
            if (countOf(bot, 'chest') === 0 && inventoryList(bot).filter(it => it.name.endsWith('_planks')).reduce((s, it) => s + it.count, 0) >= 8
                && typeof ctx?.skills?.craftRecipe === 'function') {
                try {
                    await ctx.skills.craftRecipe(bot, 'chest', 1);
                } catch (err) {
                    console.warn('Mining pack: crafting a chest failed:', errText(err));
                }
            }
            if (countOf(bot, 'chest') === 0) {
                break;
            }
            const spot = [plan.chest, plan.chest2].find(p => !chests.some(c => c.x === p.x && c.y === p.y && c.z === p.z));
            const r = await placeInto(bot, spot, 'chest', { clock: job.clock, check: b => b?.name === 'chest' });
            if (!r.ok) {
                break;
            }
            chests.push(spot);
            if (!mine.chest) {
                mine.chest = spot;
            }
        }
        mine = { ...mine, ...saveMine(ctx, job, mine) };
        const text = `At the base of the mine: ${last?.text ?? 'I stored nothing.'}`;
        const ok = Boolean(last) && (last.ok === true || last.reason === null);
        return done(ok, ok ? null : last?.reason ?? 'error', text, last?.left ?? {});
    } catch (err) {
        console.warn('Mining pack: storing at the base failed:', err?.stack ?? err);
        return done(false, 'error', `I could not store my things at the base: ${errText(err)}`);
    }
}

// ------------------------------------------------------------------ up

/**
 * Walks to the way up of the mine and goes up (spec M4): the legs of the mine from the last to the
 * first, ladders by climbing. Ends on the surface at the entrance.
 * @param {object} bot
 * @param {object} ctx
 * @param {{mine?: object, timeoutMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mine: object|null, ms: number}>}
 */
export async function climbToSurface(bot, ctx = {}, options = {}) {
    const clock = clockOf(ctx, options);
    const t0 = clock.now();
    try {
        const mine = options.mine ?? currentMine(bot, ctx);
        const feet = feetOf(bot);
        if (!mine || !feet) {
            return { ok: false, reason: 'no_mine', text: TEXTS.noMine, mine: null, ms: 0 };
        }
        const entry = mine.route[0]?.entry ?? mine.entrance;
        if (feet.y >= mine.entrance.y - 1) {
            return { ok: true, reason: null, text: TEXTS.onSurface, mine, ms: 0 };
        }
        // where on the way is the bot? inside a column of ladders it climbs that one first
        const legs = mine.route;
        let index = legs.length - 1;
        for (let i = 0; i < legs.length; i++) {
            const leg = legs[i];
            if (leg.kind === 'ladder' && leg.x === feet.x && leg.z === feet.z && feet.y >= leg.bottom && feet.y <= leg.top + 1) {
                index = i;
                break;
            }
        }
        const route = legs.slice(0, index + 1);
        const end = routeEnd({ route });
        const inColumn = index < legs.length - 1 || (legs[index]?.kind === 'ladder' && legs[index].x === feet.x && legs[index].z === feet.z);
        if (!inColumn && end) {
            const w = await walkTo(bot, end, { clock, timeoutMs: options.timeoutMs ?? 120000 });
            if (!w.ok) {
                return { ok: false, reason: w.reason === 'interrupted' ? 'interrupted' : 'stuck', text: `I could not get to the way up at ${posText(end)}.`, mine, ms: clock.now() - t0 };
            }
        }
        const up = await followUp(bot, route, { clock });
        const now = feetOf(bot);
        const ok = up.ok && Boolean(now) && now.y >= mine.entrance.y - 1;
        if (!ok) {
            return { ok: false, reason: up.reason ?? 'stuck', text: `I could not climb up: I am at ${posText(now ?? feet)}.`, mine, ms: clock.now() - t0 };
        }
        const text = `I am on the surface at ${posText(now ?? entry)}.`;
        logTo(ctx, text);
        return { ok: true, reason: null, text, mine, ms: clock.now() - t0 };
    } catch (err) {
        console.warn('Mining pack: climbing up failed:', err?.stack ?? err);
        return { ok: false, reason: 'error', text: `I could not climb up: ${errText(err)}`, mine: null, ms: clock.now() - t0 };
    }
}

// ------------------------------------------------------------------ the trip

// The food the bot carries, the off-hand (slot 45) included (v0.1.4.8, E4): foodItems of the home
// pack (I7) through ctx.home when the glue gives it, else the inventory and slot 45 read here.
function carriedFood(bot, ctx) {
    const fn = ctx?.home?.foodItems;
    if (typeof fn === 'function') {
        try {
            const list = fn(bot);
            if (Array.isArray(list)) {
                return list;
            }
        } catch {
            // read it here
        }
    }
    const foods = bot.registry?.foodsByName ?? {};
    let list = [];
    try {
        list = [...bot.inventory.items()];
        const off = bot.inventory.slots?.[45];
        if (off?.name && !list.includes(off)) {
            list.push(off);
        }
    } catch {
        return [];
    }
    return list.filter(i => i && isEdibleFood(i.name, foods));
}

async function eatIfHungry(bot, ctx = {}) {
    try {
        if ((bot.food ?? 20) >= 14) {
            return;
        }
        const foods = bot.registry?.foodsByName ?? {};
        const list = carriedFood(bot, ctx).filter(i => isEdibleFood(i.name, foods));
        const best = chooseFood(list, foods);
        const item = list.find(i => i.name === (typeof best === 'string' ? best : best?.name)) ?? list[0];
        if (!item) {
            return;
        }
        await bot.equip(item, 'hand');
        await bot.consume();
    } catch {
        // eating is best effort
    }
}

/**
 * The whole trip (spec M4): prepare, go down, set up the base or use it, dig the tunnel and
 * collect until it mined `count` items of the ore, store at the base when shouldReturn says the
 * inventory is full and go on, and come up at the end with the ore in its inventory (the ore of
 * the trip is kept when storing). Ends after the setting mining_max_minutes, with the time of the
 * way back planned in.
 * Since v0.1.4.8 (E4, tripStart): without a known mine for the ore and without `options.newMine`
 * it only asks (reason `ask`: nothing is dug, nothing is crafted) and offers a place for a new
 * mine; under the ground it starts no new mine (reason `underground`). With `newMine` the new mine
 * is at the place it offered last, when that is recent and still allowed.
 * @param {object} bot
 * @param {object} ctx
 * @param {string} ore
 * @param {number} [count]
 * @param {{newMine?: boolean}} [options] and the clock of the tests (now, wait)
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mined: number, stored: object, mine: object|null}>}
 */
export async function mineOre(bot, ctx = {}, ore = '', count = 8, options = {}) {
    const row = oreOf(ore);
    if (!row) {
        return { ok: false, reason: 'unknown_ore', text: unknownOreText(ore), mined: 0, stored: {}, mine: null };
    }
    const wanted = isFiniteNumber(count) && count >= 1 ? Math.floor(count) : 8;
    const clock = clockOf(ctx, options);
    const t0 = clock.now();
    const maxMs = maxMinutes(ctx) * 60000;
    const memoryStore = storeOf(ctx) ? null : new MineStore(null);
    const tripCtx = memoryStore ? { ...ctx, mines: memoryStore } : ctx;
    const startCount = countOf(bot, row.item);
    const stored = {};
    let mine = null;
    let reason = null;
    const mined = () => Math.max(0, countOf(bot, row.item) - startCount) + (stored[row.item] ?? 0);
    const finish = (ok, why, extra = '') => ({
        ok, reason: why, mined: mined(), stored, mine,
        text: mineOreText({ item: row.item, mined: mined(), wanted, reason: why, mine, stored: Object.fromEntries(Object.entries(stored).filter(([k]) => k !== row.item)), extra }),
    });
    // the clock of the tests goes to every step
    const pass = { now: options.now, wait: options.wait };
    try {
        let known = options.mine ?? null;
        try {
            known = known ?? storeOf(tripCtx)?.get(row.ore, dimensionOf(bot) ?? undefined) ?? null;
        } catch {
            known = null;
        }
        const start = tripStart({ mine: known, newMine: options.newMine === true, underground: underground(ctx) });
        const early = (why, text) => ({ ok: false, reason: why, text, mined: 0, stored, mine: null });
        if (start === 'underground') {
            return early('underground', TEXTS.underground);
        }
        let entrance = null;
        if (start === 'ask' || start === 'new') {
            entrance = newEntrance(bot, tripCtx, row, clock);
            if (start === 'ask') {
                if (entrance) {
                    proposals.set(bot, { ore: row.ore, entrance, at: clock.now() });
                }
                const text = askMineText(row.ore, entrance, entrance ? houseDistance(tripCtx, bot, entrance) : null);
                logTo(ctx, text);
                return early('ask', text);
            }
            if (!entrance) {
                return early('no_entrance', TEXTS.noEntrance);
            }
            proposals.delete(bot);
        }
        const prep = await prepareMiningTrip(bot, tripCtx, row.ore, entrance ? { ...options, surfaceY: entrance.y } : options);
        if (!prep.ok) {
            return { ok: false, reason: prep.reason, text: prep.text, mined: 0, stored, mine: null };
        }
        const material = tripPickaxe(row);
        const deadline = t0 + maxMs;
        const level = prep.level;
        const down = await descendToLevel(bot, tripCtx, level, { ...pass, ore: row.ore, deadline: deadline - 60000, entrance });
        mine = down.mine;
        if (!down.ok) {
            reason = down.reason;
            if (reason !== 'interrupted' && mine) {
                await climbToSurface(bot, tripCtx, { ...pass, mine });
            }
            return finish(false, reason, down.text);
        }
        if (!mine.base) {
            const base = await setupMineBase(bot, tripCtx, { ...pass, mine, deadline: deadline - 60000 });
            if (!base.ok) {
                reason = base.reason === 'interrupted' || base.reason === 'time' ? base.reason : 'blocked';
                if (reason !== 'interrupted') {
                    await climbToSurface(bot, tripCtx, { ...pass, mine: base.mine ?? mine });
                }
                return finish(false, reason, base.text);
            }
            mine = base.mine;
        }
        const depth = mine.entrance.y - mine.level;
        let depositsWithoutProgress = 0;
        for (;;) {
            if (bot.interrupt_code) {
                reason = 'interrupted';
                break;
            }
            await eatIfHungry(bot, tripCtx);
            const pick = pickaxeState(bot, material);
            const state = {
                collected: mined(), wanted, health: bot.health, food: bot.food, hasFood: haveFood(bot, tripCtx),
                pickaxeUses: pick.uses, spare: pick.spare, elapsedMs: clock.now() - t0, returnMs: returnTimeMs(depth, mine.length), maxMs,
                freeSlots: freeSlots(bot),
            };
            const back = shouldReturn(state);
            if (back.go && back.reason !== 'inventory_full') {
                reason = back.reason;
                break;
            }
            if (back.go) {
                const dep = await depositAtBase(bot, tripCtx, { ...pass, mine, keep: { [row.item]: -1 } });
                addCounts(stored, dep.stored);
                mine = dep.mine ?? mine;
                if (freeSlots(bot) <= 3 && ++depositsWithoutProgress >= 1) {
                    reason = 'inventory_full';
                    break;
                }
                continue;
            }
            depositsWithoutProgress = 0;
            const t = await digTunnel(bot, tripCtx, TUNNEL_CHUNK, {
                ...pass, mine, material, deadline: deadline - returnTimeMs(depth, mine.length + TUNNEL_CHUNK),
                shouldStop: () => (mined() >= wanted ? 'done' : null),
            });
            mine = t.mine ?? mine;
            if (!t.ok) {
                reason = t.reason === 'time' ? 'time' : t.reason === 'interrupted' ? 'interrupted' : t.reason === 'no_pickaxe' ? 'pickaxe' : t.reason;
                break;
            }
        }
        if (reason === 'interrupted') {
            return finish(false, 'interrupted', 'I am still in the mine.');
        }
        if (mine?.base) {
            const dep = await depositAtBase(bot, tripCtx, { ...pass, mine, keep: { [row.item]: -1 } });
            addCounts(stored, dep.stored);
            mine = dep.mine ?? mine;
        }
        const up = await climbToSurface(bot, tripCtx, { ...pass, mine });
        const extra = up.ok ? '' : up.text;
        if (mined() >= wanted) {
            return finish(true, null, extra);
        }
        return finish(false, reason ?? 'error', extra);
    } catch (err) {
        console.warn('Mining pack: the trip failed:', err?.stack ?? err);
        return { ...finish(false, 'error'), text: `I could not finish the trip for ${row.ore}: ${errText(err)}` };
    }
}

/**
 * `!goToMine`: goes down into the mine of the ore, without an ore the nearest mine, and sets up
 * its base when it has none.
 * @param {object} bot
 * @param {object} ctx
 * @param {string} [ore]
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mine: object|null}>}
 */
export async function goToMine(bot, ctx = {}, ore = '', options = {}) {
    try {
        const store = storeOf(ctx);
        let mine = null;
        if (typeof ore === 'string' && ore.trim().length > 0) {
            const row = oreOf(ore);
            if (!row) {
                return { ok: false, reason: 'unknown_ore', text: unknownOreText(ore), mine: null };
            }
            mine = store?.get(row.ore, dimensionOf(bot) ?? undefined) ?? null;
            if (!mine) {
                return { ok: false, reason: 'no_mine', text: `I know no mine for ${row.ore}. Tell me to mine ${row.ore} and I make one.`, mine: null };
            }
        } else {
            const feet = feetOf(bot);
            const list = store ? store.list(dimensionOf(bot) ?? undefined) : [];
            mine = list.map(m => ({ m, d: feet ? Math.hypot(m.entrance.x - feet.x, m.entrance.z - feet.z) : 0 })).sort((a, b) => a.d - b.d)[0]?.m ?? null;
            if (!mine) {
                return { ok: false, reason: 'no_mine', text: TEXTS.noMine, mine: null };
            }
        }
        const down = await descendToLevel(bot, ctx, mine.level, { ...options, mine });
        if (!down.ok || down.mine?.base) {
            return { ok: down.ok, reason: down.reason, text: down.text, mine: down.mine };
        }
        const base = await setupMineBase(bot, ctx, { ...options, mine: down.mine });
        return { ok: base.ok, reason: base.reason, text: `${down.text} ${base.text}`, mine: base.mine ?? down.mine };
    } catch (err) {
        return { ok: false, reason: 'error', text: `I could not go into the mine: ${errText(err)}`, mine: null };
    }
}

/**
 * `!leaveMine`: comes up from the mine the bot is in.
 * @param {object} bot
 * @param {object} ctx
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
 */
export function leaveMine(bot, ctx = {}, options = {}) {
    return climbToSurface(bot, ctx, options);
}
