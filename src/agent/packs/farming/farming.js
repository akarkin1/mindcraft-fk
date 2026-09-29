// The work of the farming pack (spec v0.1.4.7 F2): harvest, plant, bone meal, fertilize and the
// farm cycle. The decisions come from crop_logic.js and field_logic.js; this module walks, clicks
// and reads every change back from the world.
//
// ctx (every field optional): { areas, log, now, home: { passThrough }, storage: { storeItems, fetchItem } }.
// Without ctx.home the gate is passed with doors.js of the home pack; without ctx.storage the chest
// is skipped. Inside a field the bot walks without sprint, parkour, digging or placing, and never
// steps where it would jump or drop onto farmland. Since v0.1.4.8 (E2) also chests (the chest index:
// which chests hold bone meal and compost items) and tools.ensureTool (the hoe). Since v0.1.4.8 (X1,
// X2) no walk ends in or on a composter, a chest, a fence or a closed gate and the path search goes
// neither into nor over them; the work at the composter is done from a free place beside it; every walk
// in and near the farm is as careful as the work in the field. Since X14 the texts count what the
// inventory gained, and the items left near the places of the work are picked up at the end.
import { Vec3 } from 'vec3';
import { scanFarm } from '../../areas/area_scan.js';
import { containsPos, distanceToBox } from '../home/box_math.js';
import { botPos, clockOf, dimensionOf, entitiesWhere, listAreas, logTo, otherPlayerPositions, pauseMode } from '../home/context.js';
import { closeDoor, passThrough } from '../home/doors.js';
import { goals, gotoGoal, isNear, makeMovements } from '../home/motion.js';
import {
    CROPS, FLOWERS, TILLABLE, bestHoe, boneMealWant, cellPlan, chestsHold, chooseCompostItem, compostInChests, compostSource, compostSources,
    cropOf, isAirName, isCompostable, isCropBlock, isRipe, seedFor, visitOrder,
} from './crop_logic.js';
import {
    PICK_RANGE, chooseComposter, chooseFarmArea, farmMiddle, fieldBox, fieldCells, findGates, goalAvoiding, insideBox, isInField, isNoStandBlock,
    isNoStandCell, itemPlace, noStandBlocks, noStandPenalty, standSpots, stepPenalty,
} from './field_logic.js';
import {
    TEXTS, boneMealStepText, boneMealText, compostedText, cycleText, fertilizeText, gateOpenText, growingText, harvestText, noPlantsToFertilizeText,
    noSeedsText, notRipeText, nothingGrowsText, nothingRipeText, nothingToPlantText, plantText, ripenedText, unknownFarmText, unknownSeedText,
    unreachedText, whereText,
} from './texts.js';

/** Limits of the farming work: time, ranges and counts. */
export const FARM_LIMITS = Object.freeze({
    baseMs: 60000,
    perCellMs: 4000,
    maxMs: 20 * 60000,
    cycleMs: 10 * 60000,
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
/** At the end of a farm skill the items within this many blocks of the places of the work are picked up (X14). */
const LEFTOVER_RANGE = 3;
/** ... at most this many items, in at most this time for each side of the fence. */
const LEFTOVER_ITEMS = 16;
const LEFTOVER_MS = 30000;
/** Time of one walk to a free place beside a block or to an item. */
const SPOT_WALK_MS = 20000;
const ITEM_WALK_MS = 8000;

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
 * jumps in the field or drops onto its farmland from a higher block. Since v0.1.4.8 (X1) the path
 * search goes neither into nor onto a composter, cauldron, hopper, chest, fence or wall (avoidNoStand),
 * and not into or onto the blocks of `avoid`; (X2) it takes no diagonal step past the corner of a
 * block, which the bot would jump round.
 * @param {object} bot
 * @param {object[]} cells as fieldCells gives them
 * @param {{x: number, y: number, z: number}[]} [avoid] blocks as noStandBlocks gives them
 * @returns {object} a Movements object
 */
export function fieldMovements(bot, cells, avoid = []) {
    const m = makeMovements(bot, { dig: false, doors: false, sprint: false });
    m.allowParkour = false;
    m.allowSprinting = false;
    m.maxDropDown = Math.min(isFiniteNumber(m.maxDropDown) ? m.maxDropDown : 4, FARM_LIMITS.maxDropDown);
    m.exclusionAreasStep.push(stepPenalty(cells));
    avoidNoStand(bot, m, avoid);
    noCornerSteps(m);
    return m;
}

// v0.1.4.8, X2: a diagonal step past the corner of a block (the composter, a fence post, a chest)
// bumps into it, and the pathfinder then jumps to get round it; a jump in the field lands on farmland
// and turns it into dirt. In the field a diagonal step is taken only when both blocks beside it are
// free at the height of the feet and of the head.
function noCornerSteps(m) {
    const diagonal = m.getMoveDiagonal;
    if (typeof diagonal !== 'function' || typeof m.getBlock !== 'function') {
        return;
    }
    m.getMoveDiagonal = function (node, dir, neighbors) {
        for (const [dx, dz] of [[dir.x, 0], [0, dir.z]]) {
            for (const dy of [0, 1]) {
                if (!this.getBlock(node, dx, dy, dz).safe) {
                    return undefined;
                }
            }
        }
        return diagonal.call(this, node, dir, neighbors);
    };
}

const NO_STAND_TYPES = new WeakMap();

// The block ids of the blocks of isNoStandBlock (gates left out: the pathfinder handles them).
function noStandTypes(bot) {
    const registry = bot?.registry;
    if (!registry || !Array.isArray(registry.blocksArray)) {
        return [];
    }
    let ids = NO_STAND_TYPES.get(registry);
    if (!ids) {
        ids = registry.blocksArray.filter(b => typeof b?.name === 'string' && !b.name.endsWith('_fence_gate') && isNoStandBlock(b.name)).map(b => b.id);
        NO_STAND_TYPES.set(registry, ids);
    }
    return ids;
}

// v0.1.4.8, X1: mineflayer-pathfinder takes a composter, a cauldron, a hopper and a chest for solid
// blocks to stand on (a composter is hollow: the bot falls in and gets out only with a jump, which the
// path search does not know). Here they count like fences: no place to stand on and none to walk
// through. The cells of `avoid` and the cells above them cost too much to step.
function avoidNoStand(bot, m, avoid) {
    try {
        if (m.fences && typeof m.fences.add === 'function') {
            for (const id of noStandTypes(bot)) {
                m.fences.add(id);
            }
        }
    } catch (err) {
        console.warn('Farming pack: could not mark the blocks to avoid:', errorText(err));
    }
    if (Array.isArray(avoid) && avoid.length > 0) {
        m.exclusionAreasStep.push(noStandPenalty(avoid));
    }
}

// Movements for the walks of the farm skills outside the fence (v0.1.4.8, X1, X2): no digging, no
// placing, no parkour, no sprint (a sprint jump), drops of at most 3 blocks, the step penalty of the
// field (no jump onto its farmland), nothing in or on a composter, chest or fence, and no diagonal step
// past a corner.
function outsideMovements(s, doors = false) {
    const m = makeMovements(s.bot, { dig: false, doors, sprint: false });
    m.allowParkour = false;
    m.allowSprinting = false;
    m.maxDropDown = Math.min(isFiniteNumber(m.maxDropDown) ? m.maxDropDown : 4, FARM_LIMITS.maxDropDown);
    m.exclusionAreasStep.push(stepPenalty(s.cells));
    avoidNoStand(s.bot, m, s.avoid);
    noCornerSteps(m);
    return m;
}

// The movements of the field while the bot is inside the fence (or of a farm without a fence), the
// outside ones else.
function walkMovements(s, doors = false) {
    if (s.box && insideFence(s)) {
        s.movements ??= fieldMovements(s.bot, s.cells, s.avoid);
        return s.movements;
    }
    return outsideMovements(s, doors);
}

function blockReader(s) {
    return (x, y, z) => readBlock(s.bot, x, y, z);
}

// A goal that never ends in or on a composter, chest, fence or closed gate (v0.1.4.8, X1).
function safeGoal(s, goal) {
    const get = blockReader(s);
    return goalAvoiding(goal, node => isNoStandCell(get, node));
}

// True when the bot stands in or on a composter, chest, fence or closed gate.
function standsBadly(s) {
    const p = botPos(s.bot);
    return Boolean(p) && isNoStandCell(blockReader(s), { x: p.x, y: p.y + 0.2, z: p.z });
}

// --- the session of one job: the farm, its cells, the gate, the clock and the reason to stop ---

function openSession(bot, ctx, farm, options) {
    const clock = clockOf(ctx, options);
    return {
        bot, ctx: ctx ?? {}, farm, options, clock, started: clock.now(), deadline: Infinity,
        cells: [], box: null, gates: [], movements: null, passedGate: false, stop: null,
        // v0.1.4.8: the blocks the bot never stands in or on (X1), the places of the work, the harvests
        // and the bone meal the composter gave that was not picked up at once, and what the pick-up at
        // the end gained (X14)
        avoid: [], composters: [], worked: new Map(), harvests: [], lostBoneMeal: 0, lateBoneMeal: 0, late: {},
    };
}

// The box of the farm and one block around it (the fence), 3 blocks higher.
function farmReadBox(farm) {
    const b = farm.box;
    return { min: { x: b.min.x - 1, y: b.min.y - 1, z: b.min.z - 1 }, max: { x: b.max.x + 1, y: b.max.y + 3, z: b.max.z + 1 } };
}

function readField(s) {
    const get = blockReader(s);
    s.cells = s.farm ? fieldCells(get, s.farm.box) : [];
    s.box = fieldBox(s.cells);
    s.movements = null;
    s.avoid = s.farm ? noStandBlocks(get, farmReadBox(s.farm)) : [];
    for (const c of s.composters) {
        if (!s.avoid.some(a => a.x === c.x && a.y === c.y && a.z === c.z)) {
            s.avoid.push({ ...c, name: 'composter' });
        }
    }
    if (s.gates.length === 0 && s.farm) {
        s.gates = s.farm.gates.length > 0 ? s.farm.gates : (s.box ? findGates((x, y, z) => readBlock(s.bot, x, y, z), s.box) : []);
    }
    return s.cells;
}

// The composter of the work: a block to avoid, also when it stands outside the farm, and a place of the work.
function noteComposter(s, pos) {
    if (!s.composters.some(c => c.x === pos.x && c.y === pos.y && c.z === pos.z)) {
        s.composters.push({ x: pos.x, y: pos.y, z: pos.z });
    }
    if (!s.avoid.some(a => a.x === pos.x && a.y === pos.y && a.z === pos.z)) {
        s.avoid.push({ x: pos.x, y: pos.y, z: pos.z, name: 'composter' });
        s.movements = null;
    }
    noteWorked(s, pos);
}

// A place of the work (a plant, the composter): the items that lie near it at the end are picked up (X14).
function noteWorked(s, pos) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (!s.worked.has(key)) {
        s.worked.set(key, { x: pos.x, y: pos.y, z: pos.z });
    }
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
        s.movements ??= fieldMovements(s.bot, s.cells, s.avoid);
        await gotoGoal(s.bot, safeGoal(s, new goals.GoalBlock(inner.x, inner.y + 1, inner.z)), {
            movements: s.movements, timeoutMs: FARM_LIMITS.cellWalkMs, clock: s.clock,
        });
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
    s.movements ??= fieldMovements(bot, s.cells, s.avoid);
    for (const goal of [new goals.GoalBlock(cell.x, cell.y + 1, cell.z), new goals.GoalNear(cell.x, cell.y + 1, cell.z, 2)]) {
        const res = await gotoGoal(bot, safeGoal(s, goal), { movements: s.movements, timeoutMs: FARM_LIMITS.cellWalkMs, clock: s.clock });
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
        const walk = await walkNearSafe(s, gate, 2);
        const closed = walk.ok && await closeDoor(s.bot, gate, { ctx: s.ctx, now: s.options.now, wait: s.options.wait, respectInterrupt: false });
        if (!closed) {
            open.push(gate);
        }
    }
    return open;
}

// After a stop nothing moves; a gate of the farm that stands open within reach is still closed
// (v0.1.4.8, E2: the gate is closed also when the work ends half way). Returns the gates it closed.
async function closeGatesInReach(s) {
    const closed = [];
    for (const gate of s.gates) {
        try {
            const b = readBlock(s.bot, gate.x, gate.y, gate.z);
            const player = otherPlayerPositions(s.bot, 16).some(p => Math.hypot(p.x - gate.x - 0.5, p.y - gate.y, p.z - gate.z - 0.5) <= 2);
            if (!b || b.properties.open !== true || player || distanceTo(s.bot, gate.x + 0.5, gate.y + 0.5, gate.z + 0.5) > FARM_LIMITS.reach) {
                continue;
            }
            if (await closeDoor(s.bot, gate, { ctx: s.ctx, now: s.options.now, wait: s.options.wait, respectInterrupt: false })) {
                closed.push(gate);
            }
        } catch {
            // the gate stays as it is
        }
    }
    return closed;
}

// The end of every job: the items left near the places of the work picked up (X14), out through the
// gate and every gate closed. Nothing moves after a stop. What the pick-up gained is credited to the
// numbers of the texts (creditLate).
async function finish(s) {
    if (s.stop === 'interrupted' || s.bot.interrupt_code) {
        await closeGatesInReach(s);
        return { ok: true, text: '', open: [] };
    }
    await pickUpLeftovers(s, true);
    const left = await leaveField(s);
    await pickUpLeftovers(s, false);
    creditLate(s);
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

// --- careful walks: never in or on a composter, chest, fence or closed gate (v0.1.4.8, X1, X2) ---

// A field with a fence and a gate: the bot is inside or outside of it.
function fenced(s) {
    return Boolean(s.box) && s.gates.length > 0;
}

// True when x, z of a position lie in the box of the field (the fence stands one block outside).
function inFieldBox(s, p) {
    const b = s.box;
    return Boolean(b) && Boolean(p) && Math.floor(p.x) >= b.min.x && Math.floor(p.x) <= b.max.x && Math.floor(p.z) >= b.min.z && Math.floor(p.z) <= b.max.z;
}

// The bot stands at a place (feet position), also on farmland (feet 1/16 lower).
function standsAt(bot, spot) {
    const p = botPos(bot);
    return Boolean(p) && Math.floor(p.x) === spot.x && Math.floor(p.z) === spot.z && p.y >= spot.y - 0.2 && p.y < spot.y + 1;
}

// Walks to within `range` of a block position, with the movements of the field inside the fence and
// the careful ones outside; the goal never ends in or on a composter, chest, fence or closed gate.
async function walkNearSafe(s, target, range, { doors = false, timeoutMs = SPOT_WALK_MS } = {}) {
    const center = { x: target.x + 0.5, y: target.y, z: target.z + 0.5 };
    if (isNear(s.bot, center, range + 0.5) && !standsBadly(s)) {
        return { ok: true, reason: null };
    }
    const res = await gotoGoal(s.bot, safeGoal(s, new goals.GoalNear(target.x, target.y, target.z, range)), {
        movements: walkMovements(s, doors), timeoutMs, clock: s.clock,
    });
    if (isNear(s.bot, center, range + 1) && !standsBadly(s)) {
        return { ok: true, reason: null };
    }
    return { ok: false, reason: res.reason === 'interrupted' ? 'interrupted' : 'no_path' };
}

// Walks to a free place beside a block (standSpots, the nearest to `from` first), on the side of the
// fence given by `inField` (true: in the field, false: outside, null: either). At most 3 places are
// tried. Returns { ok, reason, spot }.
async function walkBeside(s, block, from, inField = null, { doors = false } = {}) {
    let spots = standSpots(blockReader(s), block, from);
    if (s.box && inField !== null) {
        const side = spots.filter(p => inFieldBox(s, p) === inField);
        spots = side.length > 0 ? side : spots;
    }
    if (spots.length === 0) {
        return { ok: false, reason: 'no_path', spot: null };
    }
    let last = null;
    for (const spot of spots.slice(0, 3)) {
        if (standsAt(s.bot, spot)) {
            return { ok: true, reason: null, spot };
        }
        if (stopped(s)) {
            return { ok: false, reason: 'interrupted', spot: null };
        }
        last = await gotoGoal(s.bot, safeGoal(s, new goals.GoalBlock(spot.x, spot.y, spot.z)), {
            movements: walkMovements(s, doors), timeoutMs: SPOT_WALK_MS, clock: s.clock,
        });
        if (standsAt(s.bot, spot)) {
            return { ok: true, reason: null, spot };
        }
        if (last.reason === 'interrupted') {
            return { ok: false, reason: 'interrupted', spot: null };
        }
    }
    return { ok: false, reason: 'no_path', spot: null };
}

// The bot stands at a free place beside the block already.
function standsBeside(s, block) {
    return standSpots(blockReader(s), block, null).some(spot => standsAt(s.bot, spot));
}

// Walks to pick up an item (itemPlace): an item in or on a composter, chest or fence from the free
// place beside that block that is nearest to the item, any other item from the block where it lies.
// An item on the other side of the fence is left for later. Returns true when the walk got there.
async function walkToItem(s, entity, { timeoutMs = ITEM_WALK_MS } = {}) {
    const place = itemPlace(blockReader(s), entity?.position);
    if (!place) {
        return false;
    }
    const inside = fenced(s) ? insideFence(s) : null;
    if (place.beside) {
        return (await walkBeside(s, place.beside, entity.position, inside)).ok;
    }
    const at = place.at;
    if (inside !== null && inFieldBox(s, at) !== inside) {
        return false;
    }
    if (standsAt(s.bot, at)) {
        return true;
    }
    const res = await gotoGoal(s.bot, safeGoal(s, new goals.GoalBlock(at.x, at.y, at.z)), { movements: walkMovements(s), timeoutMs, clock: s.clock });
    if (standsAt(s.bot, at)) {
        return true;
    }
    if (res.reason === 'interrupted' || stopped(s)) {
        return false;
    }
    const near = await gotoGoal(s.bot, safeGoal(s, new goals.GoalNear(at.x, at.y, at.z, 1)), { movements: walkMovements(s), timeoutMs, clock: s.clock });
    return near.ok;
}

function isThere(bot, entity) {
    return Boolean(entity) && entity.isValid !== false && bot.entities?.[entity.id] === entity;
}

function inventoryCounts(bot) {
    const out = {};
    for (const i of items(bot)) {
        out[i.name] = (out[i.name] ?? 0) + (i.count ?? 0);
    }
    return out;
}

// X14: at the end of a farm skill the items within 3 blocks of the places of the work are picked up once
// more: `inside` those in the field (with the movements of the field, so no step needs a jump onto
// farmland), else those outside the fence (after the bot left the field). Without a fence all in the
// first pass. What the inventory gained goes to s.late.
async function pickUpLeftovers(s, inside) {
    if (s.worked.size === 0 || stopped(s) || (!fenced(s) && !inside)) {
        return;
    }
    const places = [...s.worked.values()];
    const near = e => places.some(w => Math.hypot(e.position.x - (w.x + 0.5), e.position.y - (w.y + 0.5), e.position.z - (w.z + 0.5)) <= LEFTOVER_RANGE + 0.5);
    const side = e => !fenced(s) || inFieldBox(s, e.position) === inside;
    const left = e => e.name === 'item' && e.isValid !== false && near(e) && side(e);
    if (inside && fenced(s) && !insideFence(s) && entitiesWhere(s.bot, 48, left).length > 0 && !(await enterField(s)).ok) {
        return;
    }
    const before = inventoryCounts(s.bot);
    const tried = new Set();
    const end = s.clock.now() + LEFTOVER_MS;
    for (let i = 0; i < LEFTOVER_ITEMS && !stopped(s) && s.clock.now() < end; i++) {
        const drop = entitiesWhere(s.bot, 48, e => left(e) && !tried.has(e.id))[0];
        if (!drop) {
            break;
        }
        tried.add(drop.id);
        if (await walkToItem(s, drop)) {
            await waitUntil(s, () => !isThere(s.bot, drop), 800);
        }
    }
    const after = inventoryCounts(s.bot);
    for (const [name, n] of Object.entries(after)) {
        const gain = n - (before[name] ?? 0);
        if (gain > 0) {
            s.late[name] = (s.late[name] ?? 0) + gain;
        }
    }
}

// X14: what the pick-up at the end gained counts for the plants whose crop was missing and for the
// bone meal the composter gave that was not picked up at once.
function creditLate(s) {
    for (const r of s.harvests) {
        for (const [crop, missing] of Object.entries(r.missing ?? {})) {
            const item = cropOf(crop)?.harvest;
            const add = item ? Math.min(missing, s.late[item] ?? 0) : 0;
            if (add > 0) {
                r.byCrop[crop] = (r.byCrop[crop] ?? 0) + add;
                r.missing[crop] = missing - add;
                r.harvested += add;
                r.lost -= add;
                s.late[item] -= add;
            }
        }
    }
    const meal = Math.min(s.lostBoneMeal, s.late.bone_meal ?? 0);
    if (meal > 0) {
        s.lateBoneMeal += meal;
        s.lostBoneMeal -= meal;
        s.late.bone_meal -= meal;
    }
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

// Walks over the drops that lie in the field (and one block around it). Since v0.1.4.8 (X1) a drop in
// or on the composter, a chest or the fence is picked up from a free place beside that block.
async function pickUpDrops(s) {
    if (!s.box) {
        return;
    }
    const b = s.box;
    const zone = { min: { x: b.min.x - 1, y: b.min.y - 1, z: b.min.z - 1 }, max: { x: b.max.x + 1, y: b.max.y + 3, z: b.max.z + 1 } };
    const tried = new Set();
    for (let i = 0; i < 32 && !stopped(s); i++) {
        const drop = entitiesWhere(s.bot, 64, e => e.name === 'item' && e.isValid !== false && !tried.has(e.id) && containsPos(zone, e.position))[0];
        if (!drop) {
            return;
        }
        tried.add(drop.id);
        if (await walkToItem(s, drop)) {
            await waitUntil(s, () => !isThere(s.bot, drop), 600);
        }
    }
}

// X14: a plant counts as harvested when its crop came into the inventory: per crop the harvest items
// the inventory gained (with those planted again, for carrots and potatoes), at most the plants cut.
// The rest is `missing` (per crop) and `lost` (in all), for the text and for the pick-up at the end.
function settleHarvest(bot, r, before, seeded) {
    const after = inventoryCounts(bot);
    let harvested = 0;
    let lost = 0;
    for (const [crop, n] of Object.entries(r.cut)) {
        const item = cropOf(crop)?.harvest;
        const got = item ? Math.max(0, (after[item] ?? 0) - (before[item] ?? 0) + (seeded[item] ?? 0)) : n;
        const k = Math.min(n, got);
        r.byCrop[crop] = k;
        r.missing[crop] = n - k;
        harvested += k;
        lost += n - k;
    }
    r.harvested = harvested;
    r.lost = lost;
}

// --- the jobs inside the field ---

async function harvestWork(s, limit) {
    const bot = s.bot;
    const crops = s.cells.filter(c => isCropBlock(c.above));
    const ripe = crops.filter(c => isRipe(c.above, c.age));
    const r = { byCrop: {}, harvested: 0, replanted: 0, unplanted: 0, unripe: crops.length - ripe.length, ripe: ripe.length, ripeLeft: 0, unreached: 0, plants: crops.length, gateFail: null,
        cut: {}, missing: {}, lost: 0 };
    if (ripe.length === 0 || stopped(s)) {
        return r;
    }
    const entered = await enterField(s);
    if (!entered.ok) {
        r.gateFail = entered;
        return r;
    }
    pauseMode(bot, 'unstuck');
    const before = inventoryCounts(bot);
    const seeded = {};
    const plantedFromHarvest = (row) => {
        if (row.seed === row.harvest) {
            seeded[row.harvest] = (seeded[row.harvest] ?? 0) + 1;
        }
    };
    let cut = 0;
    const empty = [];
    const order = visitOrder(ripe, botPos(bot));
    let i = 0;
    for (; i < order.length; i++) {
        if (stopped(s) || (limit > 0 && cut >= limit)) {
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
        cut++;
        r.cut[row.block] = (r.cut[row.block] ?? 0) + 1;
        noteWorked(s, { x: cell.x, y: cell.y + 1, z: cell.z });
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
            plantedFromHarvest(row);
        } else {
            empty.push({ cell, seed: row.seed, row, done: false });
        }
    }
    if (!s.stop && limit > 0 && cut >= limit) {
        r.ripeLeft = order.length - i;
    }
    // Later plants may have given the seeds that were missing.
    for (const e of empty) {
        if (stopped(s)) {
            break;
        }
        if (countOf(bot, e.seed) > 0 && await walkToCell(s, e.cell) && await plantCell(s, e.cell, e.seed)) {
            r.replanted++;
            plantedFromHarvest(e.row);
            e.done = true;
        }
    }
    r.unplanted = empty.filter(e => !e.done).length;
    if (!stopped(s)) {
        await pickUpDrops(s);
    }
    settleHarvest(bot, r, before, seeded);
    s.harvests.push(r);
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
    if (r.harvested > 0 || r.lost > 0) {
        parts.push(harvestText({ byCrop: r.byCrop, replanted: r.replanted, unripe: r.unripe, unplanted: r.unplanted, ripeLeft: r.ripeLeft, lost: r.lost }));
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
    const r = { planted: 0, tilled: 0, emptyNoSeeds: 0, emptyUnreached: 0, noHoe: !hoe && tillable.length > 0, targets: targets.length, noSeeds: false, gateFail: null,
        chestWalk: false };
    if (targets.length === 0 || stopped(s)) {
        return r;
    }
    if (countOf(bot, seed) < targets.length && typeof s.ctx.storage?.fetchItem === 'function') {
        const left = await leaveField(s);
        if (left.ok && !stopped(s)) {
            r.chestWalk = true;
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
        noteWorked(s, { x: cell.x, y: cell.y + 1, z: cell.z });
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
    return plantText({ planted: r.planted, seed, tilled: r.tilled, emptyNoSeeds: r.emptyNoSeeds, emptyUnreached: r.emptyUnreached, noHoe: r.noHoe });
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
            noteWorked(s, { x: cell.x, y: cell.y + 1, z: cell.z });
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

// The sum of harvests. Since v0.1.4.8 (X14) it is made after the pick-up at the end of the cycle,
// which may still bring the crop of a plant.
function sumHarvests(list) {
    const total = { byCrop: {}, harvested: 0, replanted: 0, unplanted: 0, unreached: 0, lost: 0 };
    for (const h of list) {
        for (const [name, n] of Object.entries(h.byCrop)) {
            total.byCrop[name] = (total.byCrop[name] ?? 0) + n;
        }
        total.harvested += h.harvested;
        total.replanted += h.replanted;
        total.unplanted += h.unplanted;
        total.unreached += h.unreached;
        total.lost += h.lost ?? 0;
    }
    return total;
}

// F6: after a walk to a chest the ripe plants are read again and harvested. The harvest joins `list`.
async function harvestAgain(s, list) {
    if (stopped(s)) {
        return;
    }
    readField(s);
    if (!s.cells.some(c => isCropBlock(c.above) && isRipe(c.above, c.age))) {
        return;
    }
    const h = await harvestWork(s, 0);
    if (!h.gateFail) {
        list.push(h);
    }
}

// The hoe for the ground to till (spec v0.1.4.8 E2): ctx.tools.ensureTool from what the bot carries
// and the chests hold; the cycle cuts no tree and breaks no stone for it. null when not needed.
async function getHoe(s) {
    if (bestHoe(items(s.bot)) || typeof s.ctx.tools?.ensureTool !== 'function' || stopped(s)) {
        return null;
    }
    if (!s.cells.some(c => TILLABLE.includes(c.ground) && isAirName(c.above))) {
        return null;
    }
    if (s.box && insideFence(s)) {
        await leaveField(s);
    }
    try {
        const r = await s.ctx.tools.ensureTool(s.bot, s.ctx, 'hoe', '', { collect: false, now: s.options.now, wait: s.options.wait });
        return r && typeof r === 'object' ? r : null;
    } catch (err) {
        console.warn('Farming pack: getting a hoe failed:', errorText(err));
        return null;
    }
}

// Bone meal for the unripe plants (spec v0.1.4.8 E2), in this order: what the bot carries; the known
// chests (bone_meal); made in the composter of the farm.
async function boneMealForCycle(s, unripe) {
    const bot = s.bot;
    const want = boneMealWant(unripe);
    const m = { carried: countOf(bot, 'bone_meal'), taken: 0, takenFrom: [], made: 0, compost: {}, compostUsed: 0, sources: null, compostChests: [],
        noComposter: false, composter: null, level: null };
    if (m.carried >= want || stopped(s)) {
        return m;
    }
    if (typeof s.ctx.storage?.fetchItem === 'function' && (!hasChestIndex(s) || chestsHold(knownChests(s), 'bone_meal'))) {
        if (s.box && insideFence(s)) {
            await leaveField(s);
        }
        s.chestWalk = true;
        const before = countOf(bot, 'bone_meal');
        const res = await callStorage(s, 'fetchItem', ['bone_meal', want - m.carried]);
        m.taken = Math.max(0, countOf(bot, 'bone_meal') - before);
        if (m.taken > 0) {
            m.takenFrom = (Array.isArray(res?.chests) ? res.chests : []).filter(c => c && isFiniteNumber(c.x)).map(c => ({ x: c.x, y: c.y, z: c.z }));
        }
    }
    if (m.carried + m.taken >= want || stopped(s)) {
        return m;
    }
    const farmBox = s.farm?.box ?? s.box;
    const pos = findComposter(bot, farmBox);
    if (!pos) {
        m.noComposter = true;
        return m;
    }
    m.composter = pos;
    noteComposter(s, pos);
    const r = await composterWork(s, pos, want - m.carried - m.taken, farmMiddle(s.box ?? farmBox));
    m.made = r.made;
    m.compost = r.compost;
    m.compostUsed = r.used;
    m.sources = r.sources;
    m.compostChests = r.chests;
    m.level = composterLevel(bot, pos);
    return m;
}

// The harvest of the cycle in words. While bone meal follows, the unripe plants are named there.
function cycleHarvestPart(s, h, total, fertilizing, planted) {
    if (h.plants === 0) {
        return planted > 0 ? null : nothingGrowsText(s.farm.name);
    }
    const parts = [];
    if (total.harvested === 0 && total.lost === 0) {
        if (!fertilizing) {
            parts.push(nothingRipeText(h.unripe));
        }
    } else {
        parts.push(harvestText({
            byCrop: total.byCrop, replanted: total.replanted, unripe: fertilizing ? 0 : h.unripe, unplanted: total.unplanted, lost: total.lost,
        }));
    }
    if (total.unreached > 0) {
        parts.push(unreachedText(total.unreached));
    }
    return join(...parts);
}

// The bone meal of the cycle in words (spec v0.1.4.8 E2), with the next step when there is none.
// `ripened` plants got ripe and their crop is in the inventory, `lost` got ripe and were cut but the
// crop was not picked up (X14).
function boneMealPart(m, unripe, used, ripened, lost = 0) {
    if (m.carried + m.taken + m.made === 0) {
        if (m.noComposter) {
            return join(TEXTS.noComposterFarm, growingText(unripe));
        }
        if (m.compostUsed > 0) {
            return join(compostedText(m.compost, m.composter, m.level), growingText(unripe));
        }
        return join(TEXTS.nothingToCompostCycle, growingText(unripe));
    }
    return join(notRipeText(unripe), boneMealStepText({ ...m, used }), ripenedText(ripened, lost));
}

/**
 * The whole farm round in one command (spec v0.1.4.8 E2), in this order:
 * 1. harvest the ripe plants and plant them again;
 * 2. store the harvest through ctx.storage.storeItems (seeds up to 32 stay with the bot);
 * 3. plant the free ground; for ground to till without a hoe, ctx.tools.ensureTool(bot, ctx, 'hoe');
 * 4. with `options.fertilize` (default true) and plants that are not ripe: get bone meal (carried,
 *    the known chests, made in the composter of the farm from compost items that are carried, in
 *    the known chests or picked near the farm), use it, and harvest what got ripe;
 * 5. out of the field, the gate closed; also when the work fails half way.
 * After every walk to a chest the ripe plants are read again. One cycle takes at most 10 minutes.
 * One text out of the parts, with numbers and the next step, for example `Farm "farm": I harvested
 * 10 wheat and planted 10 again. 48 plants are not ripe. I made 3 bone_meal from 21 leaf_litter of
 * the chest at (11, 67, 53) and used them. 9 more plants got ripe and I harvested them. The gate
 * is closed.` or `... I have nothing to compost and the chests I know have nothing. 48 plants are
 * growing. Nothing to do now.` Never throws.
 * @param {object} bot
 * @param {object} [ctx] { areas, log, now, home?, storage?, chests?, tools? }
 * @param {string} [areaName]
 * @param {{fertilize?: boolean, timeoutMs?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, harvested: number, planted: number, fertilized: number, madeBoneMeal: number}>}
 */
export async function farmCycle(bot, ctx = {}, areaName = '', options = {}) {
    const zero = { harvested: 0, planted: 0, fertilized: 0, madeBoneMeal: 0 };
    let s = null;
    try {
        const prep = prepare(bot, ctx, areaName, options, zero);
        if (prep.fail) {
            return prep.fail;
        }
        s = prep.s;
        const limit = FARM_LIMITS.cycleMs;
        s.deadline = s.started + (isFiniteNumber(s.options.timeoutMs) ? Math.min(s.options.timeoutMs, limit) : limit);
        const fertilizeOn = s.options.fertilize !== false;
        const seed = mainSeed(s.cells);
        // 1. harvest and plant again
        const h = await harvestWork(s, 0);
        if (h.gateFail) {
            const fin = await finish(s);
            return outcome(false, h.gateFail.reason ?? 'error', cycleText(s.farm.name, [h.gateFail.text, fin.text]), zero);
        }
        const again = [];
        // 2. store the harvest
        let stored = null;
        const plan = storePlan(bot, h, seed);
        if (plan && !stopped(s) && typeof s.ctx.storage?.storeItems === 'function') {
            const left = await leaveField(s);
            if (left.ok && !stopped(s)) {
                stored = await callStorage(s, 'storeItems', [plan]);
                await harvestAgain(s, again);
            }
        }
        // 3. plant, with a hoe for the ground to till
        let hoe = null;
        let p = null;
        if (!stopped(s)) {
            readField(s);
            hoe = await getHoe(s);
            p = await plantWork(s, seed);
            if (p.chestWalk) {
                await harvestAgain(s, again);
            }
        }
        // 4. bone meal for what is not ripe, and the harvest of what got ripe
        let m = null;
        let f = null;
        let h2 = null;
        let unripe = 0;
        if (fertilizeOn && !stopped(s)) {
            readField(s);
            unripe = s.cells.filter(c => isCropBlock(c.above) && !isRipe(c.above, c.age)).length;
            if (unripe > 0) {
                s.chestWalk = false;
                m = await boneMealForCycle(s, unripe);
                if (s.chestWalk) {
                    await harvestAgain(s, again);
                }
                if (countOf(bot, 'bone_meal') > 0 && !stopped(s)) {
                    readField(s);
                    f = await fertilizeWork(s);
                    if (!stopped(s) && !f.gateFail) {
                        h2 = await harvestWork(s, 0);
                    }
                }
            }
        }
        // 5. the items left near the work picked up, out of the field, the gate closed
        const fin = await finish(s);
        if (m) {
            m.made += s.lateBoneMeal;
        }
        const total = sumHarvests([h, ...again]);
        const planted = p?.planted ?? 0;
        const parts = [
            cycleHarvestPart(s, h, total, m !== null, planted),
            stored?.text ?? null,
            hoe?.ok && Array.isArray(hoe.crafted) && hoe.crafted.length > 0 ? hoe.text : null,
            p && (p.targets > 0 || p.noHoe || p.gateFail) ? plantSummary(s, p, seed) : null,
            m ? boneMealPart(m, unripe, f?.used ?? 0, h2?.harvested ?? 0, h2?.lost ?? 0) : null,
            f?.gateFail ? f.gateFail.text : null,
            fin.text,
            s.gates.length > 0 && fin.open.length === 0 && !s.stop ? TEXTS.gateClosed : null,
            stopText(s),
        ];
        const text = cycleText(s.farm.name, parts);
        logTo(ctx, text);
        const end = ending(s, fin);
        return outcome(end.ok, end.reason, text, {
            harvested: total.harvested + (h2?.harvested ?? 0), planted, fertilized: f?.used ?? 0, madeBoneMeal: m?.made ?? 0,
        });
    } catch (err) {
        console.warn('Farming pack: the farm cycle failed:', errorText(err));
        if (s) {
            try {
                await finish(s);
            } catch {
                // the gate stays as it is
            }
        }
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

// The composter (spec v0.1.4.8 E2, chooseComposter): the one in the farm area or within 8 blocks of
// it, else the nearest within 32 blocks of the bot. `farmBox` null: only the second.
function findComposter(bot, farmBox = null) {
    const me = botPos(bot);
    let range = FARM_LIMITS.composterRange;
    if (farmBox && me) {
        const d = distanceToBox(farmBox, me);
        const side = Math.hypot(farmBox.max.x - farmBox.min.x + 1, farmBox.max.z - farmBox.min.z + 1);
        range = Math.max(range, Math.min(96, Math.ceil(d + side + 10)));
    }
    let found = [];
    try {
        found = bot.findBlocks({ matching: b => b?.name === 'composter', maxDistance: range, count: 16 }) ?? [];
    } catch (err) {
        console.warn('Farming pack: could not look for a composter:', errorText(err));
        return null;
    }
    return chooseComposter(found.map(p => ({ x: p.x, y: p.y, z: p.z })), farmBox, me);
}

// The nearest farm area within 64 blocks as a farm of findFarm, for the composter, the picking and the
// careful walks of the command !makeBoneMeal (v0.1.4.8, X2: the walk to a composter in the field is
// that of the field, through the gate, which is closed at the end). null without one.
function nearestFarm(bot, ctx) {
    try {
        const choice = chooseFarmArea(listAreas(ctx, dimensionOf(bot) ?? 'overworld'), { pos: botPos(bot), dimension: dimensionOf(bot) ?? 'overworld' });
        const a = choice.area;
        return a ? { name: a.name, box: { min: { ...a.min }, max: { ...a.max } }, gates: gatesOf(a.entrances), source: 'area' } : null;
    } catch {
        return null;
    }
}

// The chests of the chest index in the dimension of the bot, [] without one.
function knownChests(s) {
    try {
        const list = typeof s.ctx.chests?.list === 'function' ? s.ctx.chests.list(dimensionOf(s.bot) ?? undefined) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function hasChestIndex(s) {
    return typeof s.ctx.chests?.list === 'function';
}

// Walks to the composter: into the field through the gate when it stands in the field, otherwise out
// of the field. Since v0.1.4.8 (X1, X2) the bot stands on a free place beside the composter
// (standSpots), never in or on it, and gets there with the careful walk of the field (no jump onto
// farmland). Within reach it does not walk, unless `adjacent` asks for a place right beside the
// composter (the bone meal pops out on it and is picked up from there).
async function walkToComposter(s, pos, { adjacent = false } = {}) {
    const inReach = distanceTo(s.bot, pos.x + 0.5, pos.y, pos.z + 0.5) <= FARM_LIMITS.reach;
    if (!standsBadly(s) && (adjacent ? standsBeside(s, pos) : inReach)) {
        return { ok: true };
    }
    const inField = inFieldBox(s, pos);
    if (inField) {
        const entered = await enterField(s);
        if (!entered.ok) {
            return entered;
        }
    } else if (s.box && insideFence(s)) {
        await leaveField(s);
    }
    if (stopped(s)) {
        return { ok: false, reason: s.stop };
    }
    const walk = await walkBeside(s, pos, botPos(s.bot), fenced(s) ? inField : null, { doors: !inField });
    if (walk.ok || walk.reason === 'interrupted') {
        return walk;
    }
    const near = distanceTo(s.bot, pos.x + 0.5, pos.y, pos.z + 0.5) <= FARM_LIMITS.reach && !standsBadly(s);
    return near && !adjacent ? { ok: true } : { ok: false, reason: 'no_path' };
}

// Compost items from the known chests, the kind the chests hold most of first (spec v0.1.4.8 E2).
// Adds what it took to r.fetched and the chests to r.chests. Returns the items it got.
async function fetchCompost(s, need, r) {
    if (need <= 0 || typeof s.ctx.storage?.fetchItem !== 'function') {
        return 0;
    }
    let got = 0;
    for (const { name } of compostInChests(knownChests(s))) {
        if (got >= need || stopped(s)) {
            break;
        }
        if (s.box && insideFence(s)) {
            await leaveField(s);
        }
        s.chestWalk = true;
        const before = countOf(s.bot, name);
        const res = await callStorage(s, 'fetchItem', [name, need - got]);
        const n = Math.max(0, countOf(s.bot, name) - before);
        got += n;
        if (n > 0) {
            for (const c of Array.isArray(res?.chests) ? res.chests : []) {
                if (c && !r.chests.some(o => o.x === c.x && o.y === c.y && o.z === c.z)) {
                    r.chests.push({ x: c.x, y: c.y, z: c.z });
                }
            }
        }
    }
    r.fetched += got;
    return got;
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
    // v0.1.4.8, X1: the walk to a bone meal on the rim or in the composter ended on top of it (a goal
    // near the item, the path search without the step penalty of the field), and the bot fell into the
    // hollow composter and never came out. Now the bot goes to the free place beside the composter that
    // is nearest to the item (from there it is within reach of the pick-up) or, for a bone meal that
    // rolled off, to the block where it lies, with the careful walk of the field.
    const gained = () => countOf(bot, 'bone_meal') > before;
    if (await waitUntil(s, gained, 700)) {
        return true;
    }
    const end = s.clock.now() + BONE_MEAL_PICKUP_MS;
    const tried = new Set();
    while (!gained() && !stopped(s) && s.clock.now() < end) {
        const drop = entitiesWhere(bot, 16, e => e.name === 'item' && e.isValid !== false && !tried.has(e.id)
            && Math.hypot(e.position.x - (pos.x + 0.5), e.position.z - (pos.z + 0.5)) <= 4 && Math.abs(e.position.y - pos.y) <= 3
            && [null, 'bone_meal'].includes(droppedName(e)))[0];
        if (!drop) {
            // not seen yet, or every one was tried: wait at the place beside the composter
            await waitUntil(s, gained, 250);
            continue;
        }
        if (!(await walkToItem(s, drop, { timeoutMs: Math.max(500, Math.min(ITEM_WALK_MS, end - s.clock.now())) }))) {
            tried.add(drop.id);
        }
        await waitUntil(s, gained, 500);
    }
    if (!gained()) {
        // the composter gave it: the pick-up at the end of the skill may still bring it (X14)
        s.lostBoneMeal++;
        return false;
    }
    return true;
}

// The item of a dropped item entity, null when it is not known yet.
function droppedName(entity) {
    try {
        return entity.getDroppedItem?.()?.name ?? null;
    } catch {
        return null;
    }
}

// Picks leaf litter and flowers (and with shears grass, ferns and natural leaves) within 32 blocks of
// `center` (the middle of the farm, v0.1.4.8 E2; the bot without a farm), outside of every protected
// area, until about `need` items are in the inventory. Returns the items it got.
async function collectCompostables(s, need, center = null) {
    const bot = s.bot;
    const me = botPos(bot);
    if (!me || need <= 0) {
        return 0;
    }
    const from = center ?? me;
    const shears = findItem(bot, 'shears');
    const areas = listAreas(s.ctx, dimensionOf(bot));
    const range = Math.min(96, Math.ceil(Math.hypot(me.x - from.x, me.z - from.z) + PICK_RANGE));
    let found = [];
    try {
        found = bot.findBlocks({
            matching: b => Boolean(b) && compostSource(b.name, propsOf(b), Boolean(shears)),
            maxDistance: range,
            count: 128,
        }) ?? [];
    } catch (err) {
        console.warn('Farming pack: could not look for plants to compost:', errorText(err));
        return 0;
    }
    const targets = found
        .filter(p => Math.abs(p.y - from.y) <= 5 && Math.hypot(p.x + 0.5 - from.x, p.z + 0.5 - from.z) <= PICK_RANGE
            && !areas.some(a => containsPos(a, p)))
        .sort((a, b) => distanceTo(bot, a.x + 0.5, a.y, a.z + 0.5) - distanceTo(bot, b.x + 0.5, b.y, b.z + 0.5))
        .slice(0, 24);
    if (targets.length > 0 && s.box && insideFence(s)) {
        await leaveField(s);
    }
    let got = 0;
    for (const p of targets) {
        if (stopped(s) || got >= need) {
            break;
        }
        const walk = await walkNearSafe(s, p, 3);
        const b = readBlock(bot, p.x, p.y, p.z);
        if (!walk.ok || !b || !compostSource(b.name, b.properties, Boolean(shears))) {
            continue;
        }
        if (!FLOWERS.includes(b.name) && b.name !== 'leaf_litter' && !(await equipItem(bot, shears))) {
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
            await walkNearSafe(s, p, 1, { timeoutMs: ITEM_WALK_MS });
            await waitUntil(s, () => compostCount(bot) > before, 1000);
        }
        got += Math.max(0, compostCount(bot) - before);
    }
    return got;
}

// The work at the composter (spec v0.1.4.8 E2): fills it until `want` bone meal are made. Compost
// items in this order: what the bot carries; the known chests (ctx.storage.fetchItem); leaf litter
// and flowers picked within 32 blocks of `center`. Never seeds, crops or food. Stops after 64 items.
// Returns the numbers for the texts; `short` says why it made less: limit, no_items, no_path, error.
async function composterWork(s, pos, want, center) {
    const bot = s.bot;
    const r = { pos, made: 0, used: 0, compost: {}, carried: compostCount(bot), fetched: 0, picked: 0, chests: [], short: null, sources: null };
    let fails = 0;
    let trips = 0;
    let chestsAsked = false;
    while (!stopped(s)) {
        const level = composterLevel(bot, pos);
        if (level === null) {
            r.short = 'error';
            break;
        }
        if (level >= 8) {
            if (r.made >= want) {
                break;
            }
            // right beside it: the bone meal that pops out on or in the composter is picked up from there
            await walkToComposter(s, pos, { adjacent: true });
            if (await takeBoneMeal(s, pos)) {
                r.made++;
            } else if (++fails >= 3) {
                r.short = 'error';
                break;
            }
            continue;
        }
        if (r.made >= want) {
            break;
        }
        if (level === 7) {
            if (!(await waitUntil(s, () => (composterLevel(bot, pos) ?? 0) >= 8, 2500))) {
                r.short = 'error';
                break;
            }
            continue;
        }
        if (r.used >= FARM_LIMITS.compostItems) {
            r.short = 'limit';
            break;
        }
        const name = chooseCompostItem(items(bot));
        if (!name) {
            // About a third of the items raise the level: get three times the levels still missing.
            const need = Math.min(FARM_LIMITS.compostItems - r.used, 3 * (7 - level + 7 * (want - r.made - 1)));
            if (!chestsAsked) {
                chestsAsked = true;
                if ((await fetchCompost(s, need, r)) > 0) {
                    continue;
                }
            }
            trips++;
            const got = trips > FARM_LIMITS.collectTrips ? 0 : await collectCompostables(s, need, center);
            r.picked += got;
            if (got === 0) {
                r.short = 'no_items';
                break;
            }
            continue;
        }
        const walk = await walkToComposter(s, pos);
        if (!walk.ok) {
            r.short = walk.reason === 'interrupted' ? null : 'no_path';
            break;
        }
        if (await putIntoComposter(s, pos, name)) {
            r.used++;
            r.compost[name] = (r.compost[name] ?? 0) + 1;
            fails = 0;
        } else if (++fails >= 3) {
            r.short = 'error';
            break;
        }
    }
    r.sources = compostSources({ carried: r.carried, fetched: r.fetched, picked: r.picked, used: r.used });
    return r;
}

/**
 * Makes bone meal in a composter. The composter (spec v0.1.4.8 E2): the one in the nearest farm area
 * within 64 blocks or within 8 blocks of it, else the nearest within 32 blocks of the bot. Compost
 * items, in this order: what the bot carries (never seeds, crops, food, bone meal or hay blocks;
 * weeds first); the known chests through ctx.storage.fetchItem (leaf_litter of a chest counts);
 * leaf litter and flowers picked, and with shears grass, ferns and natural leaves, within 32 blocks
 * of the middle of the farm (of the bot without a farm), outside of every protected area. Takes the
 * bone meal out of the full composter. Stops after 64 items. Texts: `I made 2 bone_meal from 15
 * items.`, `I found no composter within 32 blocks.`, `I found nothing to compost. I do not use
 * seeds for that.` Never throws.
 * @param {object} bot
 * @param {object} [ctx] { areas, log, now, storage?, chests? }
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
        const farm = nearestFarm(bot, ctx);
        const s = openSession(bot, ctx, farm, options ?? {});
        s.deadline = s.started + (isFiniteNumber(s.options.timeoutMs) ? s.options.timeoutMs : FARM_LIMITS.boneMealMs);
        if (stopped(s)) {
            return outcome(false, s.stop, TEXTS.stopped, { made: 0, used: 0 });
        }
        const farmBox = farm?.box ?? null;
        const pos = findComposter(bot, farmBox);
        if (!pos) {
            return outcome(false, 'no_composter', farmBox ? TEXTS.noComposterFarm : TEXTS.noComposter, { made: 0, used: 0 });
        }
        if (farm) {
            readField(s);
        }
        noteComposter(s, pos);
        const r = await composterWork(s, pos, want, farmMiddle(farmBox));
        // v0.1.4.8: the items left at the composter picked up (X14), out of the field, its gate closed (X2)
        const fin = await finish(s);
        r.made += s.lateBoneMeal;
        const { made, used } = r;
        if (r.short === 'no_path') {
            return outcome(false, 'no_path', join(`I found no way to the composter at ${whereText(pos)}.`,
                used > 0 || made > 0 ? boneMealText(made, used) : '', fin.text), { made, used });
        }
        if (made === 0 && used === 0) {
            if (s.stop) {
                return outcome(false, s.stop, join(stopText(s), fin.text), { made, used });
            }
            return outcome(false, r.short === 'no_items' ? 'nothing_to_compost' : (r.short ?? 'error'), join(TEXTS.nothingToCompost, fin.text), { made, used });
        }
        const text = join(boneMealText(made, used, made < want ? r.short : null, r.short === 'no_items' ? composterLevel(bot, pos) : null), fin.text, stopText(s));
        logTo(ctx, text);
        return outcome(made > 0 && !s.stop, s.stop ?? (made >= want ? null : r.short), text, { made, used });
    } catch (err) {
        console.warn('Farming pack: making bone meal failed:', errorText(err));
        return outcome(false, 'error', `I could not make bone_meal: ${errorText(err)}`, { made: 0, used: 0 });
    }
}
