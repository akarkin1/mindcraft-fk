// Doors, fence gates and trapdoors for the home pack (spec v0.1.4.6 H2): find them, open and close
// them and CHECK the new state, pass through a door and close it behind the bot.
//
// After bot.activateBlock the new state arrives with a block update from the server. Nothing here
// assumes the click worked: every change is read back from the world.
import { Vec3 } from 'vec3';
import { containsPos, interiorBox, isBox } from './box_math.js';
import { isInsideArea } from './shelter_logic.js';
import { botPos, clockOf, dimensionOf, entitiesWhere, listAreas, logTo, otherPlayerPositions } from './context.js';
import { doorCenter, doorSides, openableKind, sideOf } from './door_logic.js';
import { isHostileForShelter } from './night_logic.js';
import { goals, gotoGoal, isNear, makeMovements, walkNear } from './motion.js';

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
 * Doors, fence gates and trapdoors that a hand can open (no iron) within range, as
 * { x, y, z, kind, open, name, facing }. Of a door only the lower block. Never throws.
 * @param {object} bot
 * @param {number} [range]
 * @returns {object[]}
 */
export function findOpenables(bot, range = 6) {
    try {
        const positions = bot.findBlocks({
            matching: block => block !== null && block !== undefined && openableKind(block.name) !== null,
            maxDistance: range,
            count: 64,
        });
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
    do {
        await clock.wait(Math.min(25, ms));
        const state = readOpenable(bot, pos);
        if (state && state.open === wantOpen) {
            return true;
        }
    } while (clock.now() - start < ms);
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

// Which side of the door is the goal: the inner side of `inside`, or the side away from the bot.
function chooseSides(state, sides, bot, inside) {
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

/**
 * Walks to the door, opens it, walks through to the other side, closes it and checks that it is
 * closed. The other side is the side inside `options.inside` (an area) when given, otherwise the
 * side away from the bot. Refuses with `monster_near` when doorIsSafe says no, before walking and
 * again at the door. A door it opened but could not pass is closed again.
 * @param {object} bot
 * @param {{x,y,z}} door the lower block of a door, or a fence gate
 * @param {object} [ctx] { areas, log, now, ... }
 * @param {{inside?: object, timeoutMs?: number, allowDig?: boolean, areas?: object[], checkMs?: number, now?: Function, wait?: Function}} [options]
 *   allowDig (default true): the walk to the door may dig as its last try, never within 2 blocks of an area
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
    const { near, far, farSign } = chooseSides(state, sides, bot, options.inside);
    const monster = (danger) => outcome(false, 'monster_near', `A monster is near the door at ${where(state)}. I do not open it.`, { mob: danger.entity });

    // Already through: inside the area when one is given, otherwise just behind the door. The side of
    // the door's plane alone is not enough: a bot behind the opposite wall is on that side too.
    const farCenter = { x: far.x + 0.5, y: far.y, z: far.z + 0.5 };
    const alreadyThrough = isBox(options.inside)
        ? isInsideArea(options.inside, botPos(bot))
        : sideOf(state, botPos(bot)) === farSign && isNear(bot, farCenter, 2.5);
    if (alreadyThrough) {
        if (state.open && !(await closeDoor(bot, state, { ...doorOpts, respectInterrupt: false }))) {
            return outcome(false, 'could_not_close', `I could not close the door at ${where(state)}.`);
        }
        return outcome(true, null, `I am on the other side of the door at ${where(state)}. It is closed.`);
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
                return outcome(false, 'interrupted', 'I stopped on my way to the door.');
            }
            return outcome(false, 'no_path', `I found no way to the door at ${where(state)}.`);
        }
    }
    if (bot.interrupt_code) {
        return outcome(false, 'interrupted', 'I stopped at the door.');
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
            return outcome(false, 'interrupted', 'I stopped at the door.');
        }
        return outcome(false, 'blocked', `The door at ${where(state)} does not open.`);
    }
    if (bot.interrupt_code) {
        await closeAgain();
        return outcome(false, 'interrupted', 'I stopped at the door.');
    }

    const through = await gotoGoal(bot, new goals.GoalBlock(far.x, far.y, far.z), {
        movements: makeMovements(bot, { dig: false, doors: false }),
        timeoutMs: isFiniteNumber(options.throughMs) ? options.throughMs : 8000,
        clock,
    });
    const pos = botPos(bot);
    const arrived = sideOf(state, pos) === farSign && isNear(bot, { x: far.x + 0.5, y: far.y, z: far.z + 0.5 }, 1.8);
    if (!arrived) {
        await closeAgain();
        if (through.reason === 'interrupted' || bot.interrupt_code) {
            return outcome(false, 'interrupted', 'I stopped in the doorway.');
        }
        return outcome(false, 'blocked', `I could not get through the door at ${where(state)}.`);
    }
    if (!(await closeDoor(bot, state, { ...doorOpts, respectInterrupt: false }))) {
        return outcome(false, 'could_not_close', `I went through the door at ${where(state)}, but I could not close it.`);
    }
    logTo(ctx, `I went through the door at ${where(state)} and closed it.`);
    return outcome(true, null, `I went through the door at ${where(state)} and closed it.`);
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
