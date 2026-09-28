// The work of the farming pack (spec v0.1.4.7 F2): harvest, plant, bone meal, fertilize and the
// farm cycle. The decisions come from crop_logic.js and field_logic.js; this module walks, clicks
// and reads every change back from the world.
//
// ctx (every field optional): { areas, log, now, home: { passThrough }, storage: { storeItems, fetchItem } }.
// Without ctx.home the gate is passed with doors.js of the home pack; without ctx.storage the chest
// is skipped. Inside a field the bot walks without sprint, parkour, digging or placing, and never
// steps where it would jump or drop onto farmland.
import { Vec3 } from 'vec3';
import { scanFarm } from '../../areas/area_scan.js';
import { containsPos } from '../home/box_math.js';
import { botPos, clockOf, dimensionOf, entitiesWhere, listAreas, logTo, otherPlayerPositions, pauseMode } from '../home/context.js';
import { closeDoor, passThrough } from '../home/doors.js';
import { goals, gotoGoal, makeMovements, walkNear } from '../home/motion.js';
import {
    CROPS, FLOWERS, TILLABLE, bestHoe, cellPlan, chooseCompostItem, compostSource, cropOf, isAirName, isCompostable, isCropBlock, isRipe,
    seedFor, visitOrder,
} from './crop_logic.js';
import { chooseFarmArea, fieldBox, fieldCells, findGates, insideBox, isInField, stepPenalty } from './field_logic.js';
import {
    TEXTS, boneMealText, cycleText, fertilizeText, gateOpenText, harvestText, noPlantsToFertilizeText, noSeedsText, nothingGrowsText,
    nothingRipeText, nothingToPlantText, plantText, unknownFarmText, unknownSeedText, unreachedText, whereText,
} from './texts.js';

/** Limits of the farming work: time, ranges and counts. */
export const FARM_LIMITS = Object.freeze({
    baseMs: 60000,
    perCellMs: 4000,
    maxMs: 20 * 60000,
    cellWalkMs: 15000,
    boneMealMs: 5 * 60000,
    composterRange: 32,
    collectRange: 32,
    compostItems: 64,
    collectTrips: 3,
    keepSeeds: 32,
    maxDropDown: 3,
    gateRange: 16,
    reach: 4.2,
});

/** How long the bot tries to pick up the bone meal that a full composter gave. */
const BONE_MEAL_PICKUP_MS = 5000;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function errorText(err) {
    return err?.message ?? String(err);
}

function items(bot) {
    try {
        const list = bot.inventory.items();
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function countOf(bot, name) {
    return items(bot).filter(i => i.name === name).reduce((sum, i) => sum + (i.count ?? 0), 0);
}

function findItem(bot, name) {
    return items(bot).find(i => i.name === name && i.count > 0) ?? null;
}

function propsOf(block) {
    try {
        return (typeof block?.getProperties === 'function' ? block.getProperties() : block?._properties) ?? {};
    } catch {
        return {};
    }
}

// { name, age, properties, block } of a position, or null when it is not loaded or cannot be read.
function readBlock(bot, x, y, z) {
    try {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) {
            return null;
        }
        const properties = propsOf(block);
        return { name: block.name, age: properties.age, properties, block };
    } catch {
        return null;
    }
}

function outcome(ok, reason, text, extra = {}) {
    return { ok, reason, text, ...extra };
}

async function equipItem(bot, item) {
    if (bot.heldItem && bot.heldItem.name === item.name && bot.heldItem.count > 0) {
        return true;
    }
    try {
        await bot.equip(item, 'hand');
        return true;
    } catch (err) {
        console.warn(`Farming pack: could not hold ${item.name}:`, errorText(err));
        return false;
    }
}

function gatesOf(entrances) {
    return (Array.isArray(entrances) ? entrances : [])
        .filter(e => e && isFiniteNumber(e.x) && isFiniteNumber(e.y) && isFiniteNumber(e.z))
        .map(e => ({ x: e.x, y: e.y, z: e.z, kind: e.kind === 'door' ? 'door' : 'gate' }));
}

/**
 * The farm to work in: the farm area named `areaName` (any distance), or without a name the
 * nearest farm area within 64 blocks, or the ground inside the fence around the bot (scanFarm).
 * @param {object} bot
 * @param {object} [ctx] { areas }
 * @param {string} [areaName]
 * @returns {{ok: boolean, reason: string|null, text: string,
 *   farm: {name: string|null, box: {min: object, max: object}, gates: {x,y,z,kind}[], source: 'area'|'scan'}|null}}
 *   reason `no_farm` with the text of the spec, or the farms known when the name is unknown
 */
export function findFarm(bot, ctx = {}, areaName = '') {
    try {
        const pos = botPos(bot);
        const dimension = dimensionOf(bot) ?? 'overworld';
        const name = typeof areaName === 'string' ? areaName.trim() : '';
        const choice = chooseFarmArea(listAreas(ctx, dimension), { name, pos, dimension });
        if (choice.area) {
            const a = choice.area;
            const farm = { name: a.name, box: { min: { ...a.min }, max: { ...a.max } }, gates: gatesOf(a.entrances), source: 'area' };
            return outcome(true, null, '', { farm });
        }
        if (choice.reason === 'unknown_name') {
            return outcome(false, 'no_farm', unknownFarmText(name, choice.known), { farm: null });
        }
        if (pos) {
            const scan = scanFarm((x, y, z) => readBlock(bot, x, y, z)?.name ?? null, pos);
            if (scan.found) {
                const farm = { name: null, box: { min: scan.min, max: scan.max }, gates: gatesOf(scan.entrances), source: 'scan' };
                return outcome(true, null, '', { farm });
            }
        }
    } catch (err) {
        console.warn('Farming pack: could not find the farm:', errorText(err));
    }
    return outcome(false, 'no_farm', TEXTS.noFarm, { farm: null });
}

/**
 * Pathfinder movements for walking in a field: no sprint, no parkour, no digging, no placing, no
 * doors, drops of at most 3 blocks, and stepPenalty of the cells, which refuses every step that
 * jumps in the field or drops onto its farmland from a higher block.
 * @param {object} bot
 * @param {object[]} cells as fieldCells gives them
 * @returns {object} a Movements object
 */
export function fieldMovements(bot, cells) {
    const m = makeMovements(bot, { dig: false, doors: false, sprint: false });
    m.allowParkour = false;
    m.allowSprinting = false;
    m.maxDropDown = Math.min(isFiniteNumber(m.maxDropDown) ? m.maxDropDown : 4, FARM_LIMITS.maxDropDown);
    m.exclusionAreasStep.push(stepPenalty(cells));
    return m;
}

// --- the session of one job: the farm, its cells, the gate, the clock and the reason to stop ---

function openSession(bot, ctx, farm, options) {
    const clock = clockOf(ctx, options);
    return {
        bot, ctx: ctx ?? {}, farm, options, clock, started: clock.now(), deadline: Infinity,
        cells: [], box: null, gates: [], movements: null, passedGate: false, stop: null,
    };
}

function readField(s) {
    s.cells = s.farm ? fieldCells((x, y, z) => readBlock(s.bot, x, y, z), s.farm.box) : [];
    s.box = fieldBox(s.cells);
    s.movements = null;
    if (s.gates.length === 0 && s.farm) {
        s.gates = s.farm.gates.length > 0 ? s.farm.gates : (s.box ? findGates((x, y, z) => readBlock(s.bot, x, y, z), s.box) : []);
    }
    return s.cells;
}

function setDeadline(s, cells) {
    const ms = isFiniteNumber(s.options.timeoutMs)
        ? s.options.timeoutMs
        : Math.min(FARM_LIMITS.maxMs, FARM_LIMITS.baseMs + FARM_LIMITS.perCellMs * cells);
    s.deadline = s.started + ms;
}

function stopped(s) {
    if (s.stop) {
        return true;
    }
    if (s.bot.interrupt_code) {
        s.stop = 'interrupted';
    } else if (s.clock.now() > s.deadline) {
        s.stop = 'timeout';
    }
    return s.stop !== null;
}

function stopText(s) {
    if (s.stop === 'interrupted') {
        return TEXTS.stopped;
    }
    return s.stop === 'timeout' ? TEXTS.outOfTime : '';
}

async function waitUntil(s, test, ms) {
    const start = s.clock.now();
    for (;;) {
        let ok = false;
        try {
            ok = test() === true;
        } catch {
            ok = false;
        }
        if (ok) {
            return true;
        }
        if (s.clock.now() - start >= ms) {
            return false;
        }
        await s.clock.wait(50);
    }
}

function distanceTo(bot, x, y, z) {
    const p = botPos(bot);
    return p ? Math.hypot(p.x - x, p.y - y, p.z - z) : Infinity;
}

function standsOn(bot, cell) {
    const p = botPos(bot);
    return Boolean(p) && Math.floor(p.x) === cell.x && Math.floor(p.z) === cell.z && p.y >= cell.y + 0.5 && p.y <= cell.y + 2;
}

function inReach(bot, cell) {
    return distanceTo(bot, cell.x + 0.5, cell.y, cell.z + 0.5) <= FARM_LIMITS.reach;
}

function insideFence(s) {
    if (!s.box) {
        return false;
    }
    const b = s.box;
    return containsPos({ min: { x: b.min.x, y: b.min.y - 1, z: b.min.z }, max: { x: b.max.x, y: b.max.y + 3, z: b.max.z } }, botPos(s.bot));
}

function nearestGate(s) {
    return [...s.gates].sort((a, b) => distanceTo(s.bot, a.x + 0.5, a.y, a.z + 0.5) - distanceTo(s.bot, b.x + 0.5, b.y, b.z + 0.5))[0];
}

async function passGate(s, gate, into) {
    const pass = typeof s.ctx.home?.passThrough === 'function' ? s.ctx.home.passThrough : passThrough;
    const options = { allowDig: false };
    for (const key of ['now', 'wait']) {
        if (typeof s.options[key] === 'function') {
            options[key] = s.options[key];
        }
    }
    if (into && s.box) {
        options.inside = insideBox(s.box);
    }
    try {
        const res = await pass(s.bot, gate, s.ctx, options);
        return res && typeof res === 'object' ? res : outcome(false, 'error', `I could not pass the gate at ${whereText(gate)}.`);
    } catch (err) {
        return outcome(false, 'error', `I could not pass the gate at ${whereText(gate)}: ${errorText(err)}`);
    }
}

async function enterField(s) {
    if (!s.box || s.gates.length === 0 || isInField(s.cells, botPos(s.bot))) {
        return { ok: true };
    }
    const res = await passGate(s, nearestGate(s), true);
    if (res.ok) {
        s.passedGate = true;
        logTo(s.ctx, `I am in ${s.farm.name ? `the farm "${s.farm.name}"` : 'the farm'}.`);
    }
    return res;
}

// Leaves a fenced field through the nearest gate. The walk to the inner side of the gate uses the
// movements of the field, so passThrough only opens, steps through and closes.
async function leaveField(s) {
    if (s.gates.length === 0 || !insideFence(s)) {
        return { ok: true };
    }
    const gate = nearestGate(s);
    const inner = s.cells.find(c => Math.abs(c.x - gate.x) + Math.abs(c.z - gate.z) === 1 && isInField(s.cells, { x: c.x, y: c.y + 1, z: c.z }));
    if (inner && !standsOn(s.bot, inner)) {
        s.movements ??= fieldMovements(s.bot, s.cells);
        await gotoGoal(s.bot, new goals.GoalBlock(inner.x, inner.y + 1, inner.z), { movements: s.movements, timeoutMs: FARM_LIMITS.cellWalkMs, clock: s.clock });
    }
    if (s.bot.interrupt_code) {
        return { ok: true };
    }
    return passGate(s, gate, false);
}

async function walkToCell(s, cell) {
    const bot = s.bot;
    if (standsOn(bot, cell)) {
        return true;
    }
    s.movements ??= fieldMovements(bot, s.cells);
    for (const goal of [new goals.GoalBlock(cell.x, cell.y + 1, cell.z), new goals.GoalNear(cell.x, cell.y + 1, cell.z, 2)]) {
        const res = await gotoGoal(bot, goal, { movements: s.movements, timeoutMs: FARM_LIMITS.cellWalkMs, clock: s.clock });
        if (standsOn(bot, cell) || (res.ok && inReach(bot, cell))) {
            return true;
        }
        if (res.reason === 'interrupted' || stopped(s)) {
            return false;
        }
    }
    if (inReach(bot, cell)) {
        return true;
    }
    // Outside the fence of a field that is not a rectangle: the way in is the gate.
    if (!s.passedGate && s.gates.length > 0 && !isInField(s.cells, botPos(bot))) {
        s.passedGate = true;
        const entered = await passGate(s, nearestGate(s), true);
        return entered.ok ? walkToCell(s, cell) : false;
    }
    return false;
}

// Closes the gates of the farm that stand open, unless a player is in them or they are far.
// Returns the gates that stay open.
async function closeOpenGates(s) {
    const open = [];
    for (const gate of s.gates) {
        const b = readBlock(s.bot, gate.x, gate.y, gate.z);
        if (!b || b.properties.open !== true) {
            continue;
        }
        const player = otherPlayerPositions(s.bot, 64).some(p => Math.hypot(p.x - gate.x - 0.5, p.y - gate.y, p.z - gate.z - 0.5) <= 2);
        if (player || s.bot.interrupt_code || distanceTo(s.bot, gate.x + 0.5, gate.y, gate.z + 0.5) > FARM_LIMITS.gateRange) {
            open.push(gate);
            continue;
        }
        const walk = await walkNear(s.bot, gate, 2, { allowDig: false, allowDoors: false, clock: s.clock, timeoutMs: 20000 });
        const closed = walk.ok && await closeDoor(s.bot, gate, { ctx: s.ctx, now: s.options.now, wait: s.options.wait, respectInterrupt: false });
        if (!closed) {
            open.push(gate);
        }
    }
    return open;
}

// The end of every job: out through the gate and every gate closed. Nothing moves after a stop.
async function finish(s) {
    if (s.stop === 'interrupted' || s.bot.interrupt_code) {
        return { ok: true, text: '', open: [] };
    }
    const left = await leaveField(s);
    const open = await closeOpenGates(s);
    const texts = [];
    if (!left.ok && typeof left.text === 'string') {
        texts.push(left.text);
    }
    texts.push(...open.map(gateOpenText));
    return { ok: left.ok !== false, reason: left.ok === false ? left.reason : null, text: texts.join(' '), open };
}

function join(...parts) {
    return parts.filter(p => typeof p === 'string' && p.length > 0).join(' ');
}

// --- crop work on one cell ---

async function breakCrop(s, crop) {
    try {
        await s.bot.dig(crop.block);
    } catch (err) {
        console.warn(`Farming pack: could not harvest at ${whereText(crop.block.position)}:`, errorText(err));
        return false;
    }
    const p = crop.block.position;
    return waitUntil(s, () => {
        const b = readBlock(s.bot, p.x, p.y, p.z);
        return !b || !(b.name === crop.name && isRipe(b.name, b.age));
    }, 600);
}

async function plantCell(s, cell, seed) {
    const bot = s.bot;
    const row = cropOf(seed);
    for (let attempt = 0; attempt < 2; attempt++) {
        const ground = readBlock(bot, cell.x, cell.y, cell.z);
        const above = readBlock(bot, cell.x, cell.y + 1, cell.z);
        if (above && above.name === row.block) {
            return attempt > 0;
        }
        if (!ground || ground.name !== 'farmland' || !above || !isAirName(above.name)) {
            return false;
        }
        const item = findItem(bot, seed);
        if (!item || !(await equipItem(bot, item))) {
            return false;
        }
        try {
            await bot.activateBlock(ground.block);
        } catch (err) {
            console.warn(`Farming pack: could not plant at ${whereText(cell)}:`, errorText(err));
            return false;
        }
        if (await waitUntil(s, () => readBlock(bot, cell.x, cell.y + 1, cell.z)?.name === row.block, 600)) {
            return true;
        }
    }
    return false;
}

// Coarse dirt becomes dirt first, so the hoe may be needed twice.
async function tillCell(s, cell) {
    const bot = s.bot;
    for (let attempt = 0; attempt < 3; attempt++) {
        const ground = readBlock(bot, cell.x, cell.y, cell.z);
        if (ground?.name === 'farmland') {
            return true;
        }
        const above = readBlock(bot, cell.x, cell.y + 1, cell.z);
        const hoe = findItem(bot, bestHoe(items(bot)) ?? '');
        if (!ground || !TILLABLE.includes(ground.name) || !above || !isAirName(above.name) || !hoe || !(await equipItem(bot, hoe))) {
            return false;
        }
        try {
            await bot.activateBlock(ground.block);
        } catch (err) {
            console.warn(`Farming pack: could not till at ${whereText(cell)}:`, errorText(err));
            return false;
        }
        await waitUntil(s, () => readBlock(bot, cell.x, cell.y, cell.z)?.name !== ground.name, 600);
    }
    return readBlock(bot, cell.x, cell.y, cell.z)?.name === 'farmland';
}

async function fertilizeCell(s, cell) {
    const bot = s.bot;
    let misses = 0;
    for (let i = 0; i < 12 && misses < 2 && !stopped(s); i++) {
        const crop = readBlock(bot, cell.x, cell.y + 1, cell.z);
        if (!crop || !isCropBlock(crop.name) || isRipe(crop.name, crop.age)) {
            break;
        }
        const meal = findItem(bot, 'bone_meal');
        if (!meal || !(await equipItem(bot, meal))) {
            break;
        }
        try {
            await bot.activateBlock(crop.block);
        } catch (err) {
            console.warn(`Farming pack: could not use bone_meal at ${whereText(cell)}:`, errorText(err));
            break;
        }
        const grew = await waitUntil(s, () => {
            const b = readBlock(bot, cell.x, cell.y + 1, cell.z);
            return !b || b.name !== crop.name || Number(b.age) !== Number(crop.age);
        }, 600);
        if (!grew) {
            misses++;
        }
    }
}

// Walks over the drops that lie in the field (and one block around it).
async function pickUpDrops(s) {
    if (!s.box) {
        return;
    }
    const b = s.box;
    const zone = { min: { x: b.min.x - 1, y: b.min.y - 1, z: b.min.z - 1 }, max: { x: b.max.x + 1, y: b.max.y + 3, z: b.max.z + 1 } };
    const tried = new Set();
    for (let i = 0; i < 32 && !stopped(s); i++) {
        const drop = entitiesWhere(s.bot, 64, e => e.name === 'item' && !tried.has(e.id) && containsPos(zone, e.position))[0];
        if (!drop) {
            return;
        }
        tried.add(drop.id);
        const p = drop.position;
        s.movements ??= fieldMovements(s.bot, s.cells);
        await gotoGoal(s.bot, new goals.GoalNear(Math.floor(p.x), Math.round(p.y), Math.floor(p.z), 1), {
            movements: s.movements, timeoutMs: 8000, clock: s.clock,
        });
        await s.clock.wait(250);
    }
}

// --- the jobs inside the field ---

async function harvestWork(s, limit) {
    const bot = s.bot;
    const crops = s.cells.filter(c => isCropBlock(c.above));
    const ripe = crops.filter(c => isRipe(c.above, c.age));
    const r = { byCrop: {}, harvested: 0, replanted: 0, unplanted: 0, unripe: crops.length - ripe.length, ripe: ripe.length, ripeLeft: 0, unreached: 0, plants: crops.length, gateFail: null };
    if (ripe.length === 0 || stopped(s)) {
        return r;
    }
    const entered = await enterField(s);
    if (!entered.ok) {
        r.gateFail = entered;
        return r;
    }
    pauseMode(bot, 'unstuck');
    const empty = [];
    const order = visitOrder(ripe, botPos(bot));
    let i = 0;
    for (; i < order.length; i++) {
        if (stopped(s) || (limit > 0 && r.harvested >= limit)) {
            break;
        }
        const cell = order[i];
        if (!(await walkToCell(s, cell))) {
            if (!stopped(s)) {
                r.unreached++;
            }
            continue;
        }
        const crop = readBlock(bot, cell.x, cell.y + 1, cell.z);
        if (!crop || !isRipe(crop.name, crop.age)) {
            continue;
        }
        const row = cropOf(crop.name);
        if (!(await breakCrop(s, crop))) {
            continue;
        }
        r.harvested++;
        r.byCrop[row.block] = (r.byCrop[row.block] ?? 0) + 1;
        if (stopped(s)) {
            break;
        }
        if (countOf(bot, row.seed) === 0) {
            // The drops of this plant are picked up after half a second.
            await waitUntil(s, () => countOf(bot, row.seed) > 0, 1500);
        }
        const plan = cellPlan({ ground: 'farmland', above: 'air' }, { seeds: { [row.seed]: countOf(bot, row.seed) } });
        if (plan.includes('plant') && await plantCell(s, cell, row.seed)) {
            r.replanted++;
        } else {
            empty.push({ cell, seed: row.seed, done: false });
        }
    }
    if (!s.stop && limit > 0 && r.harvested >= limit) {
        r.ripeLeft = order.length - i;
    }
    // Later plants may have given the seeds that were missing.
    for (const e of empty) {
        if (stopped(s)) {
            break;
        }
        if (countOf(bot, e.seed) > 0 && await walkToCell(s, e.cell) && await plantCell(s, e.cell, e.seed)) {
            r.replanted++;
            e.done = true;
        }
    }
    r.unplanted = empty.filter(e => !e.done).length;
    if (!stopped(s)) {
        await pickUpDrops(s);
    }
    return r;
}

function harvestSummary(s, r) {
    if (r.gateFail) {
        return r.gateFail.text;
    }
    if (r.plants === 0) {
        return nothingGrowsText(s.farm.name);
    }
    if (r.ripe === 0) {
        return nothingRipeText(r.unripe);
    }
    const parts = [];
    if (r.harvested > 0) {
        parts.push(harvestText({ byCrop: r.byCrop, replanted: r.replanted, unripe: r.unripe, unplanted: r.unplanted, ripeLeft: r.ripeLeft }));
    }
    if (r.unreached > 0) {
        parts.push(unreachedText(r.unreached));
    }
    return join(...parts);
}

async function plantWork(s, seed) {
    const bot = s.bot;
    const hoe = Boolean(bestHoe(items(bot)));
    const free = s.cells.filter(c => c.ground === 'farmland' && isAirName(c.above));
    const tillable = s.cells.filter(c => TILLABLE.includes(c.ground) && isAirName(c.above));
    const targets = hoe ? free.concat(tillable) : free;
    const r = { planted: 0, tilled: 0, emptyNoSeeds: 0, emptyUnreached: 0, noHoe: !hoe && tillable.length > 0, targets: targets.length, noSeeds: false, gateFail: null };
    if (targets.length === 0 || stopped(s)) {
        return r;
    }
    if (countOf(bot, seed) < targets.length && typeof s.ctx.storage?.fetchItem === 'function') {
        const left = await leaveField(s);
        if (left.ok && !stopped(s)) {
            await callStorage(s, 'fetchItem', [seed, targets.length - countOf(bot, seed)]);
        }
    }
    if (countOf(bot, seed) === 0) {
        r.noSeeds = true;
        return r;
    }
    const entered = await enterField(s);
    if (!entered.ok) {
        r.gateFail = entered;
        return r;
    }
    pauseMode(bot, 'unstuck');
    const order = visitOrder(targets, botPos(bot));
    let i = 0;
    for (; i < order.length; i++) {
        if (stopped(s) || countOf(bot, seed) === 0) {
            break;
        }
        const cell = order[i];
        const ground = readBlock(bot, cell.x, cell.y, cell.z);
        const above = readBlock(bot, cell.x, cell.y + 1, cell.z);
        const plan = cellPlan({ ground: ground?.name, above: above?.name, age: above?.age }, { seeds: countOf(bot, seed), hoe });
        if (!plan.includes('plant')) {
            continue;
        }
        if (!(await walkToCell(s, cell))) {
            if (!stopped(s)) {
                r.emptyUnreached++;
            }
            continue;
        }
        if (plan[0] === 'till') {
            if (!(await tillCell(s, cell))) {
                r.emptyUnreached++;
                continue;
            }
            r.tilled++;
        }
        if (await plantCell(s, cell, seed)) {
            r.planted++;
        } else {
            r.emptyUnreached++;
        }
    }
    if (!s.stop && i < order.length) {
        r.emptyNoSeeds = order.length - i;
    }
    return r;
}

function plantSummary(s, r, seed) {
    if (r.gateFail) {
        return r.gateFail.text;
    }
    if (r.targets === 0) {
        return r.noHoe ? plantText({ planted: 0, seed, noHoe: true }) : nothingToPlantText(s.farm.name);
    }
    if (r.noSeeds) {
        return noSeedsText(seed);
    }
    return plantText({ planted: r.planted, seed, emptyNoSeeds: r.emptyNoSeeds, emptyUnreached: r.emptyUnreached, noHoe: r.noHoe });
}

async function fertilizeWork(s) {
    const bot = s.bot;
    const before = countOf(bot, 'bone_meal');
    const crops = s.cells.filter(c => isCropBlock(c.above));
    const unripe = crops.filter(c => !isRipe(c.above, c.age));
    const r = { used: 0, ripe: crops.length - unripe.length, candidates: unripe.length, noBoneMeal: before === 0, gateFail: null };
    if (before === 0 || unripe.length === 0 || stopped(s)) {
        return r;
    }
    const entered = await enterField(s);
    if (!entered.ok) {
        r.gateFail = entered;
        return r;
    }
    pauseMode(bot, 'unstuck');
    for (const cell of visitOrder(unripe, botPos(bot))) {
        if (stopped(s) || countOf(bot, 'bone_meal') === 0) {
            break;
        }
        if (await walkToCell(s, cell)) {
            await fertilizeCell(s, cell);
        }
    }
    r.used = Math.max(0, before - countOf(bot, 'bone_meal'));
    readField(s);
    r.ripe = s.cells.filter(c => isCropBlock(c.above) && isRipe(c.above, c.age)).length;
    return r;
}

function fertilizeSummary(r) {
    if (r.gateFail) {
        return r.gateFail.text;
    }
    if (r.noBoneMeal) {
        return TEXTS.noBoneMeal;
    }
    return r.candidates === 0 ? noPlantsToFertilizeText(r.ripe) : fertilizeText(r.used, r.ripe);
}

// ctx.storage is bound to the bot (Amendment 1): storeItems(options), fetchItem(name, count).
async function callStorage(s, name, args) {
    const storage = s.ctx.storage;
    const fn = storage?.[name];
    if (typeof fn !== 'function') {
        return null;
    }
    try {
        const res = await fn.call(storage, ...args);
        return res && typeof res === 'object' ? res : null;
    } catch (err) {
        console.warn(`Farming pack: ${name} failed:`, errorText(err));
        return outcome(false, 'error', `I could not use the chest: ${errorText(err)}`);
    }
}

function limitOf(options) {
    const n = Number(options.limit);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
}

function prepare(bot, ctx, areaName, options, zero) {
    if (!bot || typeof bot !== 'object') {
        return { fail: outcome(false, 'error', 'I have no body to farm with.', zero) };
    }
    if (bot.interrupt_code) {
        return { fail: outcome(false, 'interrupted', TEXTS.stopped, zero) };
    }
    const found = findFarm(bot, ctx, areaName);
    if (!found.ok) {
        return { fail: outcome(false, found.reason, found.text, zero) };
    }
    const s = openSession(bot, ctx, found.farm, options ?? {});
    readField(s);
    return { s };
}

function ending(s, fin) {
    if (s.stop) {
        return { ok: false, reason: s.stop };
    }
    return fin.ok ? { ok: true, reason: null } : { ok: false, reason: fin.reason ?? 'error' };
}

/**
 * Breaks every ripe crop of the farm and plants the same crop again at once; unripe plants stay.
 * Enters and leaves a fenced farm through its gate and closes it. Drops are picked up by walking
 * over them. Texts: `I harvested 9 wheat and planted 9 again. 6 plants are not ripe yet.`,
 * `Nothing is ripe yet. 15 plants are growing.`, `Nothing grows in the farm "wheat_farm". I can
 * plant if I get seeds.` Never throws; ends on bot.interrupt_code and after its time limit.
 * @param {object} bot
 * @param {object} [ctx] { areas, log, now, home?, storage? }
 * @param {string} [areaName] empty: the nearest farm area within 64 blocks, else the fence around the bot
 * @param {{limit?: number, timeoutMs?: number, now?: Function, wait?: Function}} [options]
 *   limit: end after that many plants
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, harvested: number, replanted: number,
 *   unripe: number, byCrop: Object<string, number>}>}
 */
export async function harvestCrops(bot, ctx = {}, areaName = '', options = {}) {
    const zero = { harvested: 0, replanted: 0, unripe: 0, byCrop: {} };
    try {
        const { s, fail } = prepare(bot, ctx, areaName, options, zero);
        if (fail) {
            return fail;
        }
        setDeadline(s, s.cells.length);
        const r = await harvestWork(s, limitOf(s.options));
        const fin = await finish(s);
        const text = join(harvestSummary(s, r), fin.text, stopText(s));
        logTo(ctx, text);
        const end = r.gateFail ? { ok: false, reason: r.gateFail.reason ?? 'error' } : ending(s, fin);
        return outcome(end.ok, end.reason, text, { harvested: r.harvested, replanted: r.replanted, unripe: r.unripe, byCrop: r.byCrop });
    } catch (err) {
        console.warn('Farming pack: harvesting failed:', errorText(err));
        return outcome(false, 'error', `I could not harvest: ${errorText(err)}`, zero);
    }
}

/**
 * Plants every free cell of farmland; with a hoe it first tills dirt, grass, coarse dirt and paths
 * inside the farm. Seeds come from the inventory, then from chests through ctx.storage.fetchItem.
 * Nothing is dug. Texts: `I planted 12 wheat_seeds. 3 places stay empty, I have no more seeds.`,
 * `I have no wheat_seeds and know no chest with them.`, and `I have no hoe, so I planted only
 * where the ground was farmland.` added when grass was left. Never throws.
 * @param {object} bot
 * @param {object} [ctx]
 * @param {string} [areaName]
 * @param {string} [seed] any name cropOf knows, default `wheat_seeds`
 * @param {{timeoutMs?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, planted: number, tilled: number}>}
 */
export async function plantField(bot, ctx = {}, areaName = '', seed = 'wheat_seeds', options = {}) {
    const zero = { planted: 0, tilled: 0 };
    try {
        const seedName = seedFor(seed ?? 'wheat_seeds');
        if (!seedName) {
            return outcome(false, 'unknown_seed', unknownSeedText(String(seed)), zero);
        }
        const { s, fail } = prepare(bot, ctx, areaName, options, zero);
        if (fail) {
            return fail;
        }
        setDeadline(s, s.cells.length);
        const r = await plantWork(s, seedName);
        const fin = await finish(s);
        const text = join(plantSummary(s, r, seedName), fin.text, stopText(s));
        logTo(ctx, text);
        let end = ending(s, fin);
        if (r.gateFail) {
            end = { ok: false, reason: r.gateFail.reason ?? 'error' };
        } else if (r.noSeeds) {
            end = { ok: false, reason: 'no_seeds' };
        }
        return outcome(end.ok, end.reason, text, { planted: r.planted, tilled: r.tilled });
    } catch (err) {
        console.warn('Farming pack: planting failed:', errorText(err));
        return outcome(false, 'error', `I could not plant: ${errorText(err)}`, zero);
    }
}

/**
 * Uses bone meal on the unripe plants of the farm until they are ripe or the bone meal is used
 * up. Texts: `I used 6 bone_meal. 4 plants are ripe now.` (ripe plants of the farm after the
 * work), `I have no bone_meal.` Never throws.
 * @param {object} bot
 * @param {object} [ctx]
 * @param {string} [areaName]
 * @param {{timeoutMs?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, used: number, ripe: number}>}
 */
export async function fertilize(bot, ctx = {}, areaName = '', options = {}) {
    const zero = { used: 0, ripe: 0 };
    try {
        const { s, fail } = prepare(bot, ctx, areaName, options, zero);
        if (fail) {
            return fail;
        }
        setDeadline(s, s.cells.length);
        const r = await fertilizeWork(s);
        const fin = await finish(s);
        const text = join(fertilizeSummary(r), fin.text, stopText(s));
        logTo(ctx, text);
        let end = ending(s, fin);
        if (r.gateFail) {
            end = { ok: false, reason: r.gateFail.reason ?? 'error' };
        } else if (r.noBoneMeal) {
            end = { ok: false, reason: 'no_bone_meal' };
        }
        return outcome(end.ok, end.reason, text, { used: r.used, ripe: r.ripe });
    } catch (err) {
        console.warn('Farming pack: fertilizing failed:', errorText(err));
        return outcome(false, 'error', `I could not use bone_meal: ${errorText(err)}`, zero);
    }
}

function mainSeed(cells) {
    const counts = new Map();
    for (const c of cells) {
        const row = cropOf(c.above);
        if (row && isCropBlock(c.above)) {
            counts.set(row.seed, (counts.get(row.seed) ?? 0) + 1);
        }
    }
    let best = 'wheat_seeds';
    let most = 0;
    for (const row of CROPS) {
        if ((counts.get(row.seed) ?? 0) > most) {
            best = row.seed;
            most = counts.get(row.seed);
        }
    }
    return best;
}

// What the cycle stores: the harvest and the seeds beyond 32 of the crops of the field.
function storePlan(bot, r, fieldSeed) {
    const rows = Object.keys(r.byCrop).map(cropOf).filter(Boolean);
    if (rows.length === 0 && countOf(bot, fieldSeed) > FARM_LIMITS.keepSeeds) {
        rows.push(cropOf(fieldSeed));
    }
    if (rows.length === 0) {
        return null;
    }
    const only = [...new Set(rows.flatMap(row => [row.harvest, row.seed]))];
    const keep = Object.fromEntries(rows.map(row => [row.seed, FARM_LIMITS.keepSeeds]));
    return { only, keep };
}

/**
 * The farm work in one command, in this order: harvest, store the harvest and the seeds beyond 32
 * through ctx.storage.storeItems, plant, and fertilize when the bot carries bone meal. It does not
 * make bone meal. One text out of the parts, for example `Farm "wheat_farm": I harvested 9 wheat
 * and planted 9 again. 6 plants are not ripe yet. I stored 9 wheat in the chest at (-13, 63, 28).
 * The gate is closed.` Never throws.
 * @param {object} bot
 * @param {object} [ctx]
 * @param {string} [areaName]
 * @param {{timeoutMs?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, harvested: number, planted: number, fertilized: number}>}
 */
export async function farmCycle(bot, ctx = {}, areaName = '', options = {}) {
    const zero = { harvested: 0, planted: 0, fertilized: 0 };
    try {
        const { s, fail } = prepare(bot, ctx, areaName, options, zero);
        if (fail) {
            return fail;
        }
        setDeadline(s, 3 * s.cells.length);
        const seed = mainSeed(s.cells);
        const h = await harvestWork(s, 0);
        if (h.gateFail) {
            return outcome(false, h.gateFail.reason ?? 'error', cycleText(s.farm.name, [h.gateFail.text]), zero);
        }
        let stored = null;
        const plan = storePlan(bot, h, seed);
        if (plan && !stopped(s) && typeof s.ctx.storage?.storeItems === 'function') {
            const left = await leaveField(s);
            if (left.ok && !stopped(s)) {
                stored = await callStorage(s, 'storeItems', [plan]);
            }
        }
        let p = null;
        if (!stopped(s)) {
            readField(s);
            p = await plantWork(s, seed);
        }
        let f = null;
        if (!stopped(s) && countOf(bot, 'bone_meal') > 0) {
            readField(s);
            f = await fertilizeWork(s);
        }
        const fin = await finish(s);
        const planted = p?.planted ?? 0;
        const parts = [
            h.plants === 0 && planted > 0 ? null : harvestSummary(s, h),
            stored?.text ?? null,
            p && (p.targets > 0 || p.noHoe || p.gateFail) ? plantSummary(s, p, seed) : null,
            f ? fertilizeSummary(f) : null,
            fin.text,
            s.gates.length > 0 && fin.open.length === 0 && !s.stop ? TEXTS.gateClosed : null,
            stopText(s),
        ];
        const text = cycleText(s.farm.name, parts);
        logTo(ctx, text);
        const end = ending(s, fin);
        return outcome(end.ok, end.reason, text, { harvested: h.harvested, planted, fertilized: f?.used ?? 0 });
    } catch (err) {
        console.warn('Farming pack: the farm cycle failed:', errorText(err));
        return outcome(false, 'error', `I could not do the farm work: ${errorText(err)}`, zero);
    }
}

// --- bone meal ---

function composterLevel(bot, pos) {
    const b = readBlock(bot, pos.x, pos.y, pos.z);
    if (!b || b.name !== 'composter') {
        return null;
    }
    const level = Number(b.properties.level ?? 0);
    return Number.isFinite(level) ? level : 0;
}

function findComposter(bot) {
    let found = [];
    try {
        found = bot.findBlocks({ matching: b => b?.name === 'composter', maxDistance: FARM_LIMITS.composterRange, count: 8 }) ?? [];
    } catch (err) {
        console.warn('Farming pack: could not look for a composter:', errorText(err));
        return null;
    }
    const near = found.map(p => ({ p, d: distanceTo(bot, p.x + 0.5, p.y + 0.5, p.z + 0.5) }))
        .filter(e => e.d <= FARM_LIMITS.composterRange + 1)
        .sort((a, b) => a.d - b.d);
    return near.length > 0 ? { x: near[0].p.x, y: near[0].p.y, z: near[0].p.z } : null;
}

function compostCount(bot) {
    return items(bot).filter(i => isCompostable(i.name)).reduce((sum, i) => sum + (i.count ?? 0), 0);
}

async function putIntoComposter(s, pos, name) {
    const bot = s.bot;
    const before = countOf(bot, name);
    const item = findItem(bot, name);
    const block = readBlock(bot, pos.x, pos.y, pos.z);
    if (!item || !block || !(await equipItem(bot, item))) {
        return false;
    }
    try {
        await bot.activateBlock(block.block);
    } catch (err) {
        console.warn('Farming pack: could not use the composter:', errorText(err));
        return false;
    }
    return waitUntil(s, () => countOf(bot, name) < before, 800);
}

// Takes the bone meal out of a full composter. Bone meal in the hand is put away first: the area
// guard does not let it be used in a building.
async function takeBoneMeal(s, pos) {
    const bot = s.bot;
    if (bot.heldItem && !isCompostable(bot.heldItem.name)) {
        try {
            await bot.unequip('hand');
        } catch {
            // an empty hand is not needed, only one without bone meal
        }
    }
    const before = countOf(bot, 'bone_meal');
    const block = readBlock(bot, pos.x, pos.y, pos.z);
    try {
        await bot.activateBlock(block.block);
    } catch (err) {
        console.warn('Farming pack: could not empty the composter:', errorText(err));
        return false;
    }
    if (!(await waitUntil(s, () => (composterLevel(bot, pos) ?? 0) < 8, 800))) {
        return false;
    }
    // The bone meal pops out on top of the composter and can roll off it. Found on the real server:
    // the answer said "I made 1 bone_meal" while the bone meal lay on the ground. The bot walks to
    // the item until the bone meal is in the inventory, at most 5 seconds; only then it counts.
    const gained = () => countOf(bot, 'bone_meal') > before;
    if (await waitUntil(s, gained, 700)) {
        return true;
    }
    const end = s.clock.now() + BONE_MEAL_PICKUP_MS;
    for (let attempt = 0; !gained() && !stopped(s) && s.clock.now() < end; attempt++) {
        const drop = entitiesWhere(bot, 16, e => e.name === 'item' && e.isValid !== false
            && Math.hypot(e.position.x - (pos.x + 0.5), e.position.z - (pos.z + 0.5)) <= 4 && Math.abs(e.position.y - pos.y) <= 3
            && [null, 'bone_meal'].includes(droppedName(e)))[0];
        const p = drop ? drop.position : pos;
        // on the rim of the composter the item is reached from its top or from beside it
        await gotoGoal(bot, new goals.GoalNear(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), attempt % 2 === 0 ? 1 : 2), {
            movements: makeMovements(bot, { dig: false }), timeoutMs: Math.max(500, end - s.clock.now()), clock: s.clock,
        });
        await waitUntil(s, gained, 500);
    }
    return gained();
}

// The item of a dropped item entity, null when it is not known yet.
function droppedName(entity) {
    try {
        return entity.getDroppedItem?.()?.name ?? null;
    } catch {
        return null;
    }
}

// Picks flowers (and with shears grass, ferns and natural leaves) within 32 blocks, outside of every
// protected area, until about `need` items are in the inventory. Returns the items it got.
async function collectCompostables(s, need) {
    const bot = s.bot;
    const me = botPos(bot);
    if (!me || need <= 0) {
        return 0;
    }
    const shears = findItem(bot, 'shears');
    const areas = listAreas(s.ctx, dimensionOf(bot));
    let found = [];
    try {
        found = bot.findBlocks({
            matching: b => Boolean(b) && compostSource(b.name, propsOf(b), Boolean(shears)),
            maxDistance: FARM_LIMITS.collectRange,
            count: 128,
        }) ?? [];
    } catch (err) {
        console.warn('Farming pack: could not look for plants to compost:', errorText(err));
        return 0;
    }
    const targets = found
        .filter(p => Math.abs(p.y - me.y) <= 4 && !areas.some(a => containsPos(a, p)))
        .sort((a, b) => distanceTo(bot, a.x + 0.5, a.y, a.z + 0.5) - distanceTo(bot, b.x + 0.5, b.y, b.z + 0.5))
        .slice(0, 24);
    let got = 0;
    for (const p of targets) {
        if (stopped(s) || got >= need) {
            break;
        }
        const walk = await walkNear(bot, p, 3, { allowDig: false, allowDoors: false, clock: s.clock, timeoutMs: 20000 });
        const b = readBlock(bot, p.x, p.y, p.z);
        if (!walk.ok || !b || !compostSource(b.name, b.properties, Boolean(shears))) {
            continue;
        }
        if (!FLOWERS.includes(b.name) && !(await equipItem(bot, shears))) {
            continue;
        }
        const before = compostCount(bot);
        try {
            await bot.dig(b.block);
        } catch (err) {
            console.warn(`Farming pack: could not pick ${b.name}:`, errorText(err));
            continue;
        }
        if (!(await waitUntil(s, () => compostCount(bot) > before, 600))) {
            await gotoGoal(bot, new goals.GoalNear(p.x, p.y, p.z, 1), { movements: makeMovements(bot, { dig: false }), timeoutMs: 8000, clock: s.clock });
            await waitUntil(s, () => compostCount(bot) > before, 1000);
        }
        got += Math.max(0, compostCount(bot) - before);
    }
    return got;
}

/**
 * Makes bone meal in the nearest composter within 32 blocks. Uses compostable items of the
 * inventory (never seeds, crops, food, bone meal or hay blocks; weeds first); without
 * enough of them it picks flowers, and with shears grass, ferns and natural leaves, within 32
 * blocks outside of every protected area. Takes the bone meal out of the full composter. Stops
 * after 64 items. Texts: `I made 2 bone_meal from 15 items.`, `I found no composter within 32
 * blocks.`, `I found nothing to compost. I do not use seeds for that.` Never throws.
 * @param {object} bot
 * @param {object} [ctx] { areas, log, now }
 * @param {number} [count] bone meal wished, 1 to 64
 * @param {{timeoutMs?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, made: number, used: number}>}
 */
export async function makeBoneMeal(bot, ctx = {}, count = 1, options = {}) {
    const want = Math.max(1, Math.min(64, Math.floor(isFiniteNumber(Number(count)) ? Number(count) : 1)));
    try {
        if (!bot || typeof bot !== 'object') {
            return outcome(false, 'error', 'I have no body to work with.', { made: 0, used: 0 });
        }
        const s = openSession(bot, ctx, null, options ?? {});
        s.deadline = s.started + (isFiniteNumber(s.options.timeoutMs) ? s.options.timeoutMs : FARM_LIMITS.boneMealMs);
        if (stopped(s)) {
            return outcome(false, s.stop, TEXTS.stopped, { made: 0, used: 0 });
        }
        const pos = findComposter(bot);
        if (!pos) {
            return outcome(false, 'no_composter', TEXTS.noComposter, { made: 0, used: 0 });
        }
        let made = 0;
        let used = 0;
        let fails = 0;
        let trips = 0;
        let short = null;
        while (!stopped(s)) {
            const level = composterLevel(bot, pos);
            if (level === null) {
                short = 'error';
                break;
            }
            if (level >= 8) {
                if (made >= want) {
                    break;
                }
                if (distanceTo(bot, pos.x + 0.5, pos.y, pos.z + 0.5) > FARM_LIMITS.reach) {
                    await walkNear(bot, pos, 2, { allowDig: false, allowDoors: true, clock: s.clock, timeoutMs: 30000 });
                }
                if (await takeBoneMeal(s, pos)) {
                    made++;
                } else if (++fails >= 3) {
                    short = 'error';
                    break;
                }
                continue;
            }
            if (made >= want) {
                break;
            }
            if (level === 7) {
                if (!(await waitUntil(s, () => (composterLevel(bot, pos) ?? 0) >= 8, 2500))) {
                    short = 'error';
                    break;
                }
                continue;
            }
            if (used >= FARM_LIMITS.compostItems) {
                short = 'limit';
                break;
            }
            const name = chooseCompostItem(items(bot));
            if (!name) {
                // About half of the items raise the level: collect twice the levels still missing.
                const need = Math.min(FARM_LIMITS.compostItems - used, 2 * (7 - level + 7 * (want - made - 1)));
                trips++;
                if (trips > FARM_LIMITS.collectTrips || (await collectCompostables(s, need)) === 0) {
                    short = 'no_items';
                    break;
                }
                continue;
            }
            if (distanceTo(bot, pos.x + 0.5, pos.y, pos.z + 0.5) > FARM_LIMITS.reach) {
                const walk = await walkNear(bot, pos, 2, { allowDig: false, allowDoors: true, clock: s.clock, timeoutMs: 30000 });
                if (!walk.ok) {
                    return outcome(false, walk.reason ?? 'no_path', join(`I found no way to the composter at ${whereText(pos)}.`,
                        used > 0 || made > 0 ? boneMealText(made, used) : ''), { made, used });
                }
            }
            if (await putIntoComposter(s, pos, name)) {
                used++;
                fails = 0;
            } else if (++fails >= 3) {
                short = 'error';
                break;
            }
        }
        // Amendment 2, I3: it ran out of things to compost, and without shears grass, ferns and
        // leaves give nothing
        const noShears = short === 'no_items' && made < want && !findItem(bot, 'shears') ? TEXTS.noShears : '';
        if (made === 0 && used === 0) {
            if (s.stop) {
                return outcome(false, s.stop, stopText(s), { made, used });
            }
            return outcome(false, short === 'no_items' ? 'nothing_to_compost' : (short ?? 'error'), join(TEXTS.nothingToCompost, noShears),
                { made, used });
        }
        const text = join(boneMealText(made, used, made < want ? short : null, short === 'no_items' ? composterLevel(bot, pos) : null), stopText(s),
            noShears);
        logTo(ctx, text);
        return outcome(made > 0 && !s.stop, s.stop ?? (made >= want ? null : short), text, { made, used });
    } catch (err) {
        console.warn('Farming pack: making bone meal failed:', errorText(err));
        return outcome(false, 'error', `I could not make bone_meal: ${errorText(err)}`, { made: 0, used: 0 });
    }
}
