// Doors, fence gates and trapdoors for the home pack (spec v0.1.4.6 H2): find them, open and close
// them and CHECK the new state, pass through a door and close it behind the bot. The door service of
// v0.1.4.8 (C5) closes what the bot opened or passed, beside every action.
//
// After bot.activateBlock the new state arrives with a block update from the server. Nothing here
// assumes the click worked: every change is read back from the world.
import { Vec3 } from 'vec3';
import { isGatedArea } from './area_kinds.js';
import { containsPos, expandBox, interiorBox, isBox } from './box_math.js';
import { isInsideArea } from './shelter_logic.js';
import { botPos, clockOf, dimensionOf, entitiesWhere, listAreas, logTo, otherPlayerPositions } from './context.js';
import { DOOR_SERVICE_RULES, DoorWatch, doorAxis, doorCenter, doorSides, isIronOpenable, openableKind, sideOf } from './door_logic.js';
import { reflexOn } from './home_settings.js';
import { isHostileForShelter } from './night_logic.js';
import { blockReader, goals, gotoGoal, isNear, makeMovements, walkNear } from './motion.js';
import { isNoStandBlock, isNoStandCell } from './stand_logic.js';
import { closeNearText, doorClosedLog } from './texts.js';

/** How far a hostile mob may be from the door (16) and from the bot when it approaches (24). */
export const DOOR_SAFETY = Object.freeze({ nearDoor: 16, nearBot: 24 });

const passing = new WeakMap();
const closing = new WeakSet();
const seenMobs = new WeakMap();

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function where(door) {
    return `(${door.x}, ${door.y}, ${door.z})`;
}

/**
 * True while passThrough runs for this bot. The door closing reflex waits for it.
 * @param {object} bot
 * @returns {boolean}
 */
export function isPassingThrough(bot) {
    return bot !== null && typeof bot === 'object' && (passing.get(bot) ?? 0) > 0;
}

// Reads the openable block at a position as { x, y, z, kind, open, name, facing }. The upper half
// of a door is read as its lower half. undefined: the block is not loaded; null: no openable.
function readOpenable(bot, pos) {
    if (!isPoint(pos)) {
        return null;
    }
    const x = Math.floor(pos.x);
    let y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    let block = bot.blockAt(new Vec3(x, y, z));
    if (!block) {
        return undefined;
    }
    let kind = openableKind(block.name);
    if (!kind) {
        return null;
    }
    let props = typeof block.getProperties === 'function' ? block.getProperties() : (block._properties ?? {});
    if (kind === 'door' && props.half === 'upper') {
        const lower = bot.blockAt(new Vec3(x, y - 1, z));
        if (lower && lower.name === block.name) {
            y -= 1;
            block = lower;
            props = typeof lower.getProperties === 'function' ? lower.getProperties() : (lower._properties ?? {});
            kind = openableKind(lower.name);
        }
    }
    return { x, y, z, kind, open: props.open === true, name: block.name, facing: props.facing ?? null };
}

/**
 * The state of the door, gate or trapdoor at a position as { x, y, z, kind, open, name, facing }, read
 * from the world now (the upper half of a door is read as its lower half). undefined: the block is
 * not loaded; null: no openable there. Never throws.
 * @param {object} bot
 * @param {{x,y,z}} pos
 * @returns {object|null|undefined}
 */
export function doorState(bot, pos) {
    try {
        return readOpenable(bot, pos);
    } catch {
        return undefined;
    }
}

/**
 * Doors, fence gates and trapdoors that a hand can open (no iron) within range, as
 * { x, y, z, kind, open, name, facing }. Of a door only the lower block. Never throws.
 * @param {object} bot
 * @param {number} [range]
 * @param {{x,y,z}|null} [from] measure the range from this point instead of the bot (fix round X6)
 * @returns {object[]}
 */
export function findOpenables(bot, range = 6, from = null) {
    try {
        const query = {
            matching: block => block !== null && block !== undefined && openableKind(block.name) !== null,
            maxDistance: range,
            count: 64,
        };
        if (isPoint(from)) {
            query.point = new Vec3(from.x, from.y, from.z);
        }
        const positions = bot.findBlocks(query);
        const out = [];
        const seen = new Set();
        for (const pos of positions) {
            const rec = readOpenable(bot, pos);
            if (!rec) {
                continue;
            }
            const key = `${rec.x},${rec.y},${rec.z}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(rec);
            }
        }
        return out;
    } catch (err) {
        if (bot) {
            console.warn('Home pack: could not look for doors:', err?.message ?? err);
        }
        return [];
    }
}

async function waitForState(bot, pos, wantOpen, ms, clock) {
    const start = clock.now();
    // also bounded by the number of looks, so a clock that does not advance cannot keep it waiting
    const looks = Math.ceil(Math.max(ms, 1) / 25) + 1;
    let n = 0;
    do {
        await clock.wait(Math.min(25, ms));
        const state = readOpenable(bot, pos);
        if (state && state.open === wantOpen) {
            return true;
        }
        n++;
    } while (clock.now() - start < ms && n < looks);
    return false;
}

async function setDoorOpen(bot, door, wantOpen, options = {}) {
    try {
        const clock = clockOf(options.ctx, options);
        const tries = isFiniteNumber(options.tries) ? options.tries : 3;
        const checkMs = isFiniteNumber(options.checkMs) ? options.checkMs : 250;
        const respect = options.respectInterrupt !== false;
        for (let i = 0; i < tries; i++) {
            const state = readOpenable(bot, door);
            if (!state) {
                return false;
            }
            if (state.open === wantOpen) {
                return true;
            }
            if (respect && bot.interrupt_code) {
                return false;
            }
            try {
                await bot.activateBlock(bot.blockAt(new Vec3(state.x, state.y, state.z)));
            } catch (err) {
                console.warn(`Home pack: clicking the door at ${where(state)} failed:`, err?.message ?? err);
            }
            if (await waitForState(bot, state, wantOpen, checkMs, clock)) {
                return true;
            }
        }
        const final = readOpenable(bot, door);
        return Boolean(final) && final.open === wantOpen;
    } catch (err) {
        console.warn('Home pack: could not use the door:', err?.message ?? err);
        return false;
    }
}

/**
 * Closes a door, gate or trapdoor if it is open, checks the state after up to 250 ms and tries up
 * to 3 times. Ends early on bot.interrupt_code unless `respectInterrupt` is false.
 * @param {object} bot
 * @param {{x,y,z}} door
 * @param {{checkMs?: number, tries?: number, respectInterrupt?: boolean, ctx?: object, now?: Function, wait?: Function}} [options]
 * @returns {Promise<boolean>} true when it is closed
 */
export async function closeDoor(bot, door, options = {}) {
    return await setDoorOpen(bot, door, false, options);
}

/**
 * Opens a door, gate or trapdoor, like closeDoor.
 * @param {object} bot
 * @param {{x,y,z}} door
 * @param {object} [options] as closeDoor
 * @returns {Promise<boolean>} true when it is open
 */
export async function openDoor(bot, door, options = {}) {
    return await setDoorOpen(bot, door, true, options);
}

function approaching(bot, entity, me, now) {
    const pos = entity.position;
    const d = Math.hypot(pos.x - me.x, pos.z - me.z);
    let memory = seenMobs.get(bot);
    if (!memory) {
        memory = new Map();
        seenMobs.set(bot, memory);
    }
    const prev = memory.get(entity.id);
    memory.set(entity.id, { d, t: now });
    const vel = entity.velocity;
    if (vel && isFiniteNumber(vel.x) && isFiniteNumber(vel.z) && d > 0) {
        const towards = ((me.x - pos.x) * vel.x + (me.z - pos.z) * vel.z) / d;
        if (towards > 0.02) {
            return true;
        }
    }
    return Boolean(prev) && now - prev.t <= 5000 && prev.d - d >= 0.3;
}

/**
 * The hostile mob that makes the door unsafe, or null: a mob (isHostileForShelter) within 16
 * blocks of the door, or within 24 blocks of the bot and approaching it (seen from its velocity
 * or from two looks within 5 s).
 * @param {object} bot
 * @param {{x,y,z}} door
 * @param {object} [ctx]
 * @returns {{entity: object, why: 'near_door'|'approaching'}|null}
 */
export function doorDanger(bot, door, ctx = {}) {
    const center = doorCenter(door);
    const nearDoor = entitiesWhere(bot, DOOR_SAFETY.nearDoor, isHostileForShelter, center);
    const me = botPos(bot);
    const now = clockOf(ctx).now();
    let danger = nearDoor.length > 0 ? { entity: nearDoor[0], why: 'near_door' } : null;
    if (me) {
        for (const entity of entitiesWhere(bot, DOOR_SAFETY.nearBot, isHostileForShelter, me)) {
            if (approaching(bot, entity, me, now) && !danger) {
                danger = { entity, why: 'approaching' };
            }
        }
    }
    return danger;
}

/**
 * The rule for doors: false when a hostile mob is within 16 blocks of the door, or within 24 blocks
 * of the bot and approaching. Also false when the check itself fails.
 * @param {object} bot
 * @param {{x,y,z}} door
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function doorIsSafe(bot, door, ctx = {}) {
    try {
        return doorDanger(bot, door, ctx) === null;
    } catch (err) {
        console.warn('Home pack: could not check the door for monsters:', err?.message ?? err);
        return false;
    }
}

// Which side of the door is the goal: the inner side of `inside`, the side of the point `toward`
// (fix round X6: the place "home" when there is no area), or the side away from the bot.
function chooseSides(state, sides, bot, inside, toward = null) {
    if (isPoint(toward) && !isBox(inside)) {
        const goal = sideOf(state, toward);
        if (goal !== 0) {
            return goal === 1 ? { near: sides[0], far: sides[1], farSign: 1 } : { near: sides[1], far: sides[0], farSign: -1 };
        }
    }
    if (isBox(inside)) {
        const room = interiorBox(inside);
        const inA = containsPos(room, { x: sides[0].x + 0.5, y: sides[0].y, z: sides[0].z + 0.5 });
        const inB = containsPos(room, { x: sides[1].x + 0.5, y: sides[1].y, z: sides[1].z + 0.5 });
        if (inA !== inB) {
            return inA ? { near: sides[1], far: sides[0], farSign: -1 } : { near: sides[0], far: sides[1], farSign: 1 };
        }
    }
    const me = botPos(bot);
    let botSide = sideOf(state, me);
    if (botSide === 0 && me) {
        const d = s => Math.hypot(s.x + 0.5 - me.x, s.z + 0.5 - me.z);
        botSide = d(sides[0]) <= d(sides[1]) ? -1 : 1;
    }
    return botSide === 1 ? { near: sides[1], far: sides[0], farSign: -1 } : { near: sides[0], far: sides[1], farSign: 1 };
}

function outcome(ok, reason, text, extra = {}) {
    return { ok, reason, text, ...extra };
}

// ---- the step through (fix round, the last holes of X1) ----

/** How far behind the gate farmland makes the step careful. */
export const FARMLAND_BEHIND = 2;

const LIQUID_NAMES = new Set(['water', 'lava', 'bubble_column']);

function blockAtXYZ(bot, x, y, z) {
    try {
        return bot.blockAt(new Vec3(x, y, z));
    } catch {
        return null;
    }
}

function isEmptyBlock(b) {
    return Boolean(b) && (b.boundingBox === 'empty' || /^(cave_|void_)?air$/.test(b.name)) && !LIQUID_NAMES.has(b.name);
}

function isStandGround(b) {
    const props = typeof b?.getProperties === 'function' ? b.getProperties() : (b?._properties ?? null);
    return Boolean(b) && b.boundingBox === 'block' && !LIQUID_NAMES.has(b.name) && !isNoStandBlock(b.name, props);
}

// v0.1.4.11 (N1): a block that fills a cell before or behind an openable, so that nobody passes it
function fillsCell(b) {
    return Boolean(b) && b.boundingBox === 'block' && openableKind(b.name) === null;
}

/**
 * v0.1.4.11 (N1, the dry scan): whether the bot can open the openable at a position and pass it. No: no openable
 * there (or not loaded), an iron door or trapdoor (no hand opens it), a closed one that is powered (locked by
 * redstone), a door or gate with a block filling the cell before or behind it (feet or head), a trapdoor with a
 * block filling the cell above it. Reads the world only; never throws.
 * @param {object} bot
 * @param {{x,y,z}} pos
 * @returns {boolean}
 */
export function canOpen(bot, pos) {
    try {
        if (!isPoint(pos)) {
            return false;
        }
        const block = blockAtXYZ(bot, Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (!block || isIronOpenable(block.name)) {
            return false;
        }
        const state = readOpenable(bot, pos);
        if (!state) {
            return false;
        }
        const lower = blockAtXYZ(bot, state.x, state.y, state.z);
        const props = (typeof lower?.getProperties === 'function' ? lower.getProperties() : lower?._properties) ?? {};
        if (state.open !== true && (props.powered === true || props.powered === 'true')) {
            return false;
        }
        if (state.kind === 'trapdoor') {
            return !fillsCell(blockAtXYZ(bot, state.x, state.y + 1, state.z));
        }
        const height = state.kind === 'door' ? 2 : 1;
        for (const side of doorSides(state) ?? []) {
            for (let dy = 0; dy < height; dy++) {
                if (fillsCell(blockAtXYZ(bot, side.x, side.y + dy, side.z))) {
                    return false;
                }
            }
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * True when the far side of the door lies in a farm: `inside` is a farm (an area of type farm, or a box
 * without a type as the farming pack gives it), or farmland lies within 2 blocks behind the door, down to 2
 * blocks below the feet. Never throws.
 * @param {object} bot
 * @param {object} state the door as readOpenable gives it
 * @param {-1|1} farSign
 * @param {object} [inside]
 * @returns {boolean}
 */
export function farmBehind(bot, state, farSign, inside = null) {
    try {
        if (isBox(inside) && (inside.type === undefined || inside.type === null || inside.type === 'farm')) {
            return true;
        }
        const axis = doorAxis(state.facing);
        if (!axis) {
            return false;
        }
        for (let a = 1; a <= FARMLAND_BEHIND; a++) {
            for (let l = -FARMLAND_BEHIND; l <= FARMLAND_BEHIND; l++) {
                const x = state.x + axis.x * farSign * a + axis.z * l;
                const z = state.z + axis.z * farSign * a + axis.x * l;
                for (let dy = -2; dy <= 0; dy++) {
                    if (blockAtXYZ(bot, x, state.y + dy, z)?.name === 'farmland') {
                        return true;
                    }
                }
            }
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * The movements of the step through a door: without digging and without opening doors. Careful ones (into
 * a farm) also without sprint (a sprint jump), without parkour and without any step up, which needs a jump
 * (a jump onto farmland makes it dirt): the path search gets no neighbour higher than the node.
 * @param {object} bot
 * @param {boolean} careful
 * @returns {object} a Movements object
 */
export function stepMovements(bot, careful) {
    const m = makeMovements(bot, { dig: false, doors: false });
    if (careful) {
        m.allowSprinting = false;
        m.allowParkour = false;
        m.getMoveJumpUp = () => {};
        const neighbors = m.getNeighbors;
        if (typeof neighbors === 'function') {
            m.getNeighbors = function (node) {
                const list = neighbors.call(this, node);
                return Array.isArray(list) ? list.filter(n => n.y <= node.y) : list;
            };
        }
    }
    return m;
}

function throughMovements(bot, state, farSign, inside) {
    return stepMovements(bot, farmBehind(bot, state, farSign, inside));
}

/**
 * The cell of the far side where the step through ends: `far` itself, or when it is in or on a block of
 * isNoStandBlock (a composter, chest, fence ... behind the door), the nearest free cell beside it on the
 * far side: feet and head free, solid ground under them that is no such block, within 2 blocks. null when
 * there is none. Never throws.
 * @param {object} bot
 * @param {object} state the door
 * @param {{x,y,z}} far
 * @param {-1|1} farSign
 * @returns {{x: number, y: number, z: number}|null}
 */
export function freeFarCell(bot, state, far, farSign) {
    try {
        const get = blockReader(bot);
        if (!isNoStandCell(get, far)) {
            return far;
        }
        const found = [];
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                for (const dy of [0, 1, -1]) {
                    const c = { x: far.x + dx, y: far.y + dy, z: far.z + dz };
                    if ((dx === 0 && dz === 0) || sideOf(state, { x: c.x + 0.5, y: c.y, z: c.z + 0.5 }) !== farSign || isNoStandCell(get, c)) {
                        continue;
                    }
                    if (isEmptyBlock(blockAtXYZ(bot, c.x, c.y, c.z)) && isEmptyBlock(blockAtXYZ(bot, c.x, c.y + 1, c.z))
                        && isStandGround(blockAtXYZ(bot, c.x, c.y - 1, c.z))) {
                        found.push({ c, d: Math.hypot(dx, dy, dz) + Math.abs(dy) * 0.5 });
                    }
                }
            }
        }
        found.sort((a, b) => a.d - b.d || a.c.x - b.c.x || a.c.z - b.c.z || a.c.y - b.c.y);
        return found.length > 0 ? found[0].c : null;
    } catch {
        return null;
    }
}

// The word for an openable in a text (X13): door, gate or trapdoor.
function kindName(state) {
    return state?.kind === 'gate' || state?.kind === 'trapdoor' ? state.kind : 'door';
}

/**
 * Walks to the door, opens it, walks through to the other side, closes it and checks that it is
 * closed. The other side is the side inside `options.inside` (an area) when given, else the side of
 * the point `options.toward` (fix round X6), otherwise the side away from the bot. Refuses with
 * `monster_near` when doorIsSafe says no, before walking and again at the door. A door it opened but
 * could not pass is closed again. The texts name what it is: door, gate or trapdoor (X13).
 * @param {object} bot
 * @param {{x,y,z}} door the lower block of a door, or a fence gate
 * @param {object} [ctx] { areas, log, now, ... }
 * @param {{inside?: object, toward?: {x,y,z}, movements?: object, timeoutMs?: number, allowDig?: boolean, areas?: object[], checkMs?: number, now?: Function, wait?: Function}} [options]
 *   allowDig (default true): the walk to the door may dig as its last try, never within 2 blocks of an area;
 *   movements (fix round): the movements of the step through, else careful ones into a farm (no sprint,
 *   parkour or jump). The step ends on a free cell of the far side, never in or on a composter, chest, fence.
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, mob?: object}>}
 *   reasons: no_path, blocked, could_not_close, monster_near, interrupted, error
 */
export async function passThrough(bot, door, ctx = {}, options = {}) {
    if (!bot || typeof bot !== 'object') {
        return outcome(false, 'error', 'I have no body to walk with.');
    }
    passing.set(bot, (passing.get(bot) ?? 0) + 1);
    try {
        return await passInner(bot, door, ctx ?? {}, options ?? {});
    } catch (err) {
        console.warn('Home pack: passing the door failed:', err?.message ?? err);
        return outcome(false, 'error', `I could not pass the door: ${err?.message ?? err}`);
    } finally {
        const n = (passing.get(bot) ?? 1) - 1;
        if (n > 0) {
            passing.set(bot, n);
        } else {
            passing.delete(bot);
        }
    }
}

async function passInner(bot, door, ctx, options) {
    const clock = clockOf(ctx, options);
    const doorOpts = { ...options, ctx };
    const state = readOpenable(bot, door);
    if (state === undefined) {
        return outcome(false, 'no_path', 'I cannot see that door from here.');
    }
    if (!state) {
        return outcome(false, 'blocked', `There is no door I can open at ${isPoint(door) ? where(door) : 'that place'}.`);
    }
    const sides = doorSides(state);
    if (!sides) {
        return outcome(false, 'blocked', `I cannot walk through the ${state.kind} at ${where(state)}.`);
    }
    const { near, far, farSign } = chooseSides(state, sides, bot, options.inside, options.toward);
    const kind = kindName(state); // X13: the texts name what it is: door, gate or trapdoor
    const monster = (danger) => outcome(false, 'monster_near', `A monster is near the ${kind} at ${where(state)}. I do not open it.`, { mob: danger.entity });

    // Already through: inside the area when one is given, otherwise just behind the door. The side of
    // the door's plane alone is not enough: a bot behind the opposite wall is on that side too.
    const farCenter = { x: far.x + 0.5, y: far.y, z: far.z + 0.5 };
    const alreadyThrough = isBox(options.inside)
        ? isInsideArea(options.inside, botPos(bot))
        : sideOf(state, botPos(bot)) === farSign && isNear(bot, farCenter, 2.5);
    if (alreadyThrough) {
        if (state.open && !(await closeDoor(bot, state, { ...doorOpts, respectInterrupt: false }))) {
            return outcome(false, 'could_not_close', `I could not close the ${kind} at ${where(state)}.`);
        }
        return outcome(true, null, `I am on the other side of the ${kind} at ${where(state)}. It is closed.`);
    }

    let danger = doorDanger(bot, state, ctx);
    if (danger) {
        return monster(danger);
    }
    const me = botPos(bot);
    const distance = me ? Math.hypot(near.x + 0.5 - me.x, near.z + 0.5 - me.z) : 0;
    const walkMs = isFiniteNumber(options.timeoutMs) ? options.timeoutMs : Math.min(120000, 10000 + distance * 1500);
    if (sideOf(state, botPos(bot)) !== -farSign || !isNear(bot, { x: near.x + 0.5, y: near.y, z: near.z + 0.5 }, 1.6)) {
        // Digging is the last try (a bot in a pit), never in or next to a protected area.
        const areas = Array.isArray(options.areas) ? options.areas : listAreas(ctx, dimensionOf(bot));
        const walk = await walkNear(bot, near, 1, { timeoutMs: walkMs, clock, allowDig: options.allowDig !== false, areas });
        if (!walk.ok) {
            if (walk.reason === 'interrupted') {
                return outcome(false, 'interrupted', `I stopped on my way to the ${kind}.`);
            }
            return outcome(false, 'no_path', `I found no way to the ${kind} at ${where(state)}.`);
        }
    }
    if (bot.interrupt_code) {
        return outcome(false, 'interrupted', `I stopped at the ${kind}.`);
    }
    danger = doorDanger(bot, state, ctx);
    if (danger) {
        return monster(danger);
    }

    const before = readOpenable(bot, state);
    const openedByUs = Boolean(before) && !before.open;
    const closeAgain = async () => {
        const now = readOpenable(bot, state);
        const players = otherPlayerPositions(bot, 8);
        const c = doorCenter(state);
        const playerInDoor = players.some(p => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) <= 2);
        if (openedByUs && now && now.open && !playerInDoor) {
            await closeDoor(bot, state, { ...doorOpts, respectInterrupt: false });
        }
    };

    if (!(await openDoor(bot, state, doorOpts))) {
        await closeAgain();
        if (bot.interrupt_code) {
            return outcome(false, 'interrupted', `I stopped at the ${kind}.`);
        }
        return outcome(false, 'blocked', `The ${kind} at ${where(state)} does not open.`);
    }
    if (bot.interrupt_code) {
        await closeAgain();
        return outcome(false, 'interrupted', `I stopped at the ${kind}.`);
    }

    // fix round (X1): the step ends on a free cell of the far side, never in or on a composter, chest,
    // fence ...; into a farm without sprint, parkour or jump (a jump onto farmland makes it dirt)
    const target = freeFarCell(bot, state, far, farSign) ?? far;
    const through = await gotoGoal(bot, new goals.GoalBlock(target.x, target.y, target.z), {
        movements: options.movements ?? throughMovements(bot, state, farSign, options.inside),
        timeoutMs: isFiniteNumber(options.throughMs) ? options.throughMs : 8000,
        clock,
    });
    const pos = botPos(bot);
    const arrived = sideOf(state, pos) === farSign && isNear(bot, { x: target.x + 0.5, y: target.y, z: target.z + 0.5 }, 1.8);
    if (!arrived) {
        await closeAgain();
        if (through.reason === 'interrupted' || bot.interrupt_code) {
            return outcome(false, 'interrupted', `I stopped in the ${kind === 'gate' ? 'gateway' : 'doorway'}.`);
        }
        return outcome(false, 'blocked', `I could not get through the ${kind} at ${where(state)}.`);
    }
    if (!(await closeDoor(bot, state, { ...doorOpts, respectInterrupt: false }))) {
        return outcome(false, 'could_not_close', `I went through the ${kind} at ${where(state)}, but I could not close it.`);
    }
    logTo(ctx, `I went through the ${kind} at ${where(state)} and closed it.`);
    return outcome(true, null, `I went through the ${kind} at ${where(state)} and closed it.`);
}

/**
 * The door closing reflex in one call: reads the openables within 6 blocks and the other players,
 * feeds the DoorTracker and closes the doors it returns (ignoring bot.interrupt_code, because a
 * stopped bot should still close its door). Does nothing while passThrough runs or while an
 * earlier call is still closing. Never throws.
 * @param {object} bot
 * @param {import('./door_logic.js').DoorTracker} tracker
 * @param {object} [ctx]
 * @param {object} [options] as closeDoor
 * @returns {Promise<object[]>} the doors it closed
 */
export async function closeDoorsBehind(bot, tracker, ctx = {}, options = {}) {
    if (!bot || typeof bot !== 'object' || isPassingThrough(bot) || closing.has(bot)) {
        return [];
    }
    closing.add(bot);
    try {
        const me = botPos(bot);
        if (!me) {
            return [];
        }
        const doors = findOpenables(bot, 6);
        const players = otherPlayerPositions(bot, 16);
        const toClose = tracker.observe({ botPos: me, doors, players });
        const closed = [];
        for (const door of toClose) {
            if (isPassingThrough(bot)) {
                break;
            }
            if (await closeDoor(bot, door, { ...options, ctx, respectInterrupt: false })) {
                closed.push(door);
            }
        }
        return closed;
    } catch (err) {
        console.warn('Home pack: closing doors failed:', err?.message ?? err);
        return [];
    } finally {
        closing.delete(bot);
    }
}

// ---- the door service (v0.1.4.8, C5) ----

// Entities that do not stand in a door: items, orbs and projectiles.
const NOT_STANDING = new Set(['item', 'experience_orb', 'arrow', 'spectral_arrow', 'trident', 'snowball', 'egg', 'ender_pearl',
    'fishing_bobber', 'potion', 'experience_bottle', 'falling_block', 'painting', 'item_frame', 'glow_item_frame']);

// The bot itself never holds a door open (v0.1.4.10, T3-5): its entity object, its id or its name.
function isTheBot(bot, entity) {
    const me = bot?.entity;
    return entity === me || (Boolean(me) && entity.id !== undefined && entity.id === me.id)
        || (typeof bot?.username === 'string' && entity.type === 'player' && entity.username === bot.username);
}

/**
 * True when an entity other than the bot stands in the openable: its box overlaps the block of a
 * gate or trapdoor, or the two blocks of a door. Items, orbs and projectiles do not count. Never throws.
 * @param {object} bot
 * @param {{x,y,z,kind}} door
 * @returns {boolean}
 */
export function somebodyInDoor(bot, door) {
    try {
        const cx = door.x + 0.5;
        const cz = door.z + 0.5;
        const top = door.y + (door.kind === 'door' ? 2 : 1);
        for (const entity of Object.values(bot?.entities ?? {})) {
            if (!entity || isTheBot(bot, entity) || !entity.position || NOT_STANDING.has(entity.name) || entity.type === 'projectile') {
                continue;
            }
            const p = entity.position;
            const reach = (isFiniteNumber(entity.width) ? entity.width : 0.6) / 2 + 0.5;
            const height = isFiniteNumber(entity.height) ? entity.height : 1.8;
            if (Math.abs(p.x - cx) < reach && Math.abs(p.z - cz) < reach && p.y < top && p.y + height > door.y) {
                return true;
            }
        }
        return false;
    } catch {
        return true; // when in doubt, leave the door open
    }
}

/**
 * True when an entity other than the bot (a player climbing below a trapdoor) is within 1 block of the
 * openable: its feet cell at most 1 block sideways of the cell of the openable, and the openable at most 1
 * block below its feet or above its head (v0.1.4.9, F21). Items, orbs and projectiles do not count. Never throws.
 * @param {object} bot
 * @param {{x,y,z}} door
 * @returns {boolean}
 */
/**
 * True when an entity holds the closing of an openable: somebody in it, or (F21) within 1 block of a door or a
 * trapdoor. v0.1.4.11 (the lead's fix round F2, W94): a gate is held only by somebody in its cell; a chicken
 * beside the gate of its pen held the closing for ever and the pen stood open. Never throws.
 * @param {object} bot
 * @param {{x,y,z,kind}} door
 * @returns {boolean}
 */
export function occupiedBy(bot, door) {
    try {
        if (somebodyInDoor(bot, door)) {
            return true;
        }
        return door?.kind === 'gate' ? false : somebodyNear(bot, door);
    } catch {
        return false;
    }
}

export function somebodyNear(bot, door) {
    try {
        for (const entity of Object.values(bot?.entities ?? {})) {
            if (!entity || isTheBot(bot, entity) || !entity.position || NOT_STANDING.has(entity.name) || entity.type === 'projectile') {
                continue;
            }
            const p = entity.position;
            const height = isFiniteNumber(entity.height) ? entity.height : 1.8;
            if (Math.max(Math.abs(Math.floor(p.x) - door.x), Math.abs(Math.floor(p.z) - door.z)) <= 1
                && door.y >= Math.floor(p.y) - 1 && door.y <= Math.floor(p.y + height) + 1) {
                return true;
            }
        }
        return false;
    } catch {
        return true; // when in doubt, leave it open
    }
}

function botStandsIn(bot, door) {
    const me = botPos(bot);
    return Boolean(me) && Math.abs(me.x - (door.x + 0.5)) < 0.8 && Math.abs(me.z - (door.z + 0.5)) < 0.8
        && me.y < door.y + (door.kind === 'door' ? 2 : 1) && me.y + 1.8 > door.y;
}

function where3(door) {
    return `(${door.x}, ${door.y}, ${door.z})`;
}

/**
 * The door service of the bot (spec v0.1.4.8, I8 and C5). It follows doors, fence gates and trapdoors
 * (see DoorWatch of door_logic.js) and closes what the bot opened or passed, beside every action.
 * - `tick()`: for the background mode door_closing, called on every tick of the modes. It reads the
 *   openables within 6 blocks at most every 250 ms, starts at most one closing at a time without
 *   waiting for it, never touches the path search, never throws. Nothing while home_pack or
 *   home_reflexes.door_closing is off, while passThrough runs, while the bot eats, sleeps or has a
 *   window open.
 * - `closeNear(range = 6)`: the function of !closeDoor. Closes every open openable within range and
 *   reads its state back. Text: `I closed oak_door at (x, y, z) and oak_fence_gate at (x, y, z).` or
 *   `All doors near me are closed.`
 * - `stop()`: the service does nothing more.
 * - v0.1.4.11 (I8) `reserve(door, ms)`: a walk is about to pass the openable; it is not closed for ms (at most
 *   20 s), nor while the bot is within 1.5 blocks of it; `release(door)` ends that (every one without a door).
 *   The service made last for a bot is also reached with reserveDoor and releaseDoor.
 * Each closing prints `Door service: closed <name> at (x, y, z).` to the console.
 * @param {object} bot
 * @param {object} ctx { areas, settings, now, log }
 * @param {{now?: Function, wait?: Function, scanMs?: number, checkMs?: number}} [options] for tests
 * @returns {{tick: () => void, stop: () => void, closeNear: (range?: number) => Promise<object>, reserve: Function, release: Function}}
 */
// F37 of the journeys (W84, the way out of the mine): the service closed a door while the bot climbed a ladder; the
// click turned its look away from the wall, the bot stepped out of the column and fell, and the climb failed.
// The service waits while the bot is on a ladder, a vine or an open trapdoor off the ground (a click during a
// slide stalled the slide, W80 run 13). The ladder passes close the trapdoor they came through themselves, on
// the way down 2 blocks below it (closeWhenBelow of ladder_pass.js and of the route replay) and on the way up
// from beside it (F35).
const CLIMBABLE = new Set(['ladder', 'vine']);

function botOnLadder(bot) {
    try {
        const me = botPos(bot);
        if (!me || bot.entity?.onGround === true) {
            return false; // standing at the foot of a ladder (its lowest rung is at the floor) is no climb
        }
        const b = bot.blockAt(new Vec3(Math.floor(me.x), Math.floor(me.y + 0.01), Math.floor(me.z)));
        const name = b?.name ?? '';
        if (CLIMBABLE.has(name)) {
            return true;
        }
        const props = (typeof b?.getProperties === 'function' ? b.getProperties() : b?._properties) ?? {};
        return name.endsWith('_trapdoor') && (props.open === true || props.open === 'true');
    } catch {
        return false;
    }
}

// v0.1.4.11 (I8): the running door service of each bot, for reserveDoor and releaseDoor
const services = new WeakMap();

/**
 * v0.1.4.11 (I8): reserves an openable that a walk is about to pass with the running door service of the bot
 * (the one createDoorService made last): the service does not close it for `ms` (at most 20 s), nor while the
 * bot is within 1.5 blocks of it. The routes pack uses it when ctx.doors.reserve is missing. Never throws.
 * @param {object} bot
 * @param {{x,y,z}} door
 * @param {number} ms
 * @returns {boolean} true when a service took it
 */
export function reserveDoor(bot, door, ms) {
    try {
        const service = bot && typeof bot === 'object' ? services.get(bot) : null;
        return Boolean(service) && service.reserve(door, ms) === true;
    } catch {
        return false;
    }
}

/**
 * v0.1.4.11 (I8): ends the reservation of an openable (of every one without `door`). Never throws.
 * @param {object} bot
 * @param {{x,y,z}} [door]
 */
export function releaseDoor(bot, door) {
    try {
        const service = bot && typeof bot === 'object' ? services.get(bot) : null;
        service?.release(door);
    } catch {
        // nothing reserved
    }
}

export function createDoorService(bot, ctx = {}, options = {}) {
    const clock = clockOf(ctx, options);
    const watch = new DoorWatch();
    const scanMs = isFiniteNumber(options?.scanMs) ? options.scanMs : 250;
    const checkMs = isFiniteNumber(options?.checkMs) ? options.checkMs : 300;
    let stopped = false;
    let busy = false;
    let lastScan = -Infinity;
    let lastPos = null;
    let movedAt = -Infinity;

    const read = (me, now) => {
        const areas = listAreas(ctx, dimensionOf(bot)).map(a => ({ area: a, box: expandBox(a, 1) }));
        const doors = findOpenables(bot, DOOR_SERVICE_RULES.scanRange).map(door => ({
            ...door,
            inArea: areas.some(({ box }) => containsPos(box, door)),
            gated: door.kind === 'gate' && areas.some(({ area, box }) => isGatedArea(area) && containsPos(box, door)),
            occupied: occupiedBy(bot, door),
        }));
        const moving = now - movedAt <= DOOR_SERVICE_RULES.movedWithinMs || bot.pathfinder?.isMoving?.() === true;
        return watch.observe({ now, botPos: me, moving, doors, players: otherPlayerPositions(bot, 16) });
    };

    const closeOne = async (door) => {
        let outcome = 'unknown';
        try {
            const before = readOpenable(bot, door);
            if (!before || !before.open) {
                // closed meanwhile; after an attempt of the service the late block update shows its click
                if (before && (watch.noted(door)?.tries ?? 0) > 0) {
                    console.log(doorClosedLog(before));
                }
                watch.forget(door);
                return;
            }
            if (somebodyInDoor(bot, door) || somebodyNear(bot, door) || botStandsIn(bot, door)) {
                return; // tried again on a later look
            }
            const closed = await closeDoor(bot, before, { tries: 1, checkMs, respectInterrupt: false, ctx, now: options?.now, wait: options?.wait });
            outcome = watch.attempt(door, closed, clock.now());
            if (closed) {
                console.log(doorClosedLog(before));
            } else if (outcome === 'gave_up') {
                console.log(`Door service: could not close ${before.name} at ${where3(before)}.`);
            }
        } catch (err) {
            console.warn('Door service: closing failed:', err?.message ?? err);
            watch.attempt(door, false, clock.now());
        }
    };

    const service = {
        tick() {
            if (stopped) {
                return;
            }
            try {
                if (!reflexOn(ctx?.settings, 'door_closing')) {
                    return;
                }
                const me = botPos(bot);
                if (!me) {
                    return;
                }
                const now = clock.now();
                if (lastPos && Math.hypot(me.x - lastPos.x, me.y - lastPos.y, me.z - lastPos.z) >= 0.1) {
                    movedAt = now;
                }
                lastPos = me;
                if (now - lastScan < scanMs) {
                    return;
                }
                lastScan = now;
                const toClose = read(me, now);
                for (const door of watch.takeClosedLate()) {
                    console.log(doorClosedLog(door));
                }
                if (busy || toClose.length === 0 || isPassingThrough(bot) || bot.usingHeldItem === true || bot.currentWindow
                    || bot.isSleeping === true || botOnLadder(bot)) {
                    return; // F37: a click turns the look; a bot on a ladder would step out of the column and fall
                }
                busy = true;
                closeOne(toClose[0]).finally(() => {
                    busy = false;
                });
            } catch (err) {
                console.warn('Door service: the look failed:', err?.message ?? err);
            }
        },

        stop() {
            stopped = true;
            watch.reset();
            if (bot && typeof bot === 'object' && services.get(bot) === service) {
                services.delete(bot);
            }
        },

        async closeNear(range = DOOR_SERVICE_RULES.scanRange) {
            return await closeNear(bot, ctx, range, { ...options, checkMs });
        },

        // v0.1.4.11 (I8): an openable a walk is about to pass is not closed for ms (at most 20 s), nor while the
        // bot is within 1.5 blocks of it; release ends that (every reservation without a door). Never throw.
        reserve(door, ms) {
            try {
                return !stopped && watch.reserve(door, clock.now(), ms);
            } catch {
                return false;
            }
        },

        release(door) {
            try {
                watch.release(door);
            } catch {
                // nothing reserved
            }
        },
    };
    if (bot && typeof bot === 'object') {
        services.set(bot, service);
    }
    return service;
}

/**
 * Closes every open door, gate and trapdoor within range and reads its state back (v0.1.4.8, C5; the
 * command !closeDoor). One farther than 4.5 blocks is walked to first, without opening or digging.
 * An openable in which somebody stands stays open. Texts: `I closed oak_door at (x, y, z) and
 * oak_fence_gate at (x, y, z).`, `All doors near me are closed.`, plus `I could not close ...` and
 * `I left ... open, because somebody stands in it.` Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {number} [range]
 * @param {{now?: Function, wait?: Function, checkMs?: number}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, closed: object[], failed: object[], occupied: object[], text: string}>}
 */
export async function closeNear(bot, ctx = {}, range = DOOR_SERVICE_RULES.scanRange, options = {}) {
    const closed = [];
    const failed = [];
    const occupied = [];
    try {
        const clock = clockOf(ctx, options);
        const r = isFiniteNumber(range) && range > 0 ? Math.min(range, 16) : DOOR_SERVICE_RULES.scanRange;
        const me = botPos(bot);
        const open = findOpenables(bot, r).filter(d => d.open)
            .sort((a, b) => (me ? Math.hypot(a.x + 0.5 - me.x, a.y - me.y, a.z + 0.5 - me.z) - Math.hypot(b.x + 0.5 - me.x, b.y - me.y, b.z + 0.5 - me.z) : 0));
        let interrupted = false;
        for (const door of open) {
            if (bot.interrupt_code) {
                interrupted = true;
                break;
            }
            if (somebodyInDoor(bot, door) || botStandsIn(bot, door)) {
                occupied.push(door);
                continue;
            }
            if (!isNear(bot, doorCenter(door), 4.5)) {
                await walkNear(bot, door, 3, { clock, timeoutMs: 8000, allowDoors: false });
                if (readOpenable(bot, door)?.open !== true) {
                    continue; // somebody else closed it meanwhile, or it is gone
                }
            }
            const ok = await closeDoor(bot, door, { tries: 3, checkMs: isFiniteNumber(options.checkMs) ? options.checkMs : 300,
                respectInterrupt: false, ctx, now: options.now, wait: options.wait });
            if (ok) {
                closed.push(door);
                console.log(doorClosedLog(door));
            } else {
                failed.push(door);
            }
        }
        let text = closeNearText({ closed, failed, occupied });
        if (interrupted) {
            text = `${closed.length > 0 ? text : 'I closed no door.'} I was stopped before I closed the rest.`;
        }
        const reason = interrupted ? 'interrupted' : (failed.length > 0 ? 'could_not_close' : (occupied.length > 0 ? 'occupied' : null));
        logTo(ctx, text);
        return { ok: reason === null, reason, closed, failed, occupied, text };
    } catch (err) {
        console.warn('Home pack: closing the doors near me failed:', err?.message ?? err);
        return { ok: false, reason: 'error', closed, failed, occupied, text: `I could not close the doors: ${err?.message ?? err}` };
    }
}
