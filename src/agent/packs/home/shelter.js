// The shelter of the bot (spec v0.1.4.6 H3, v0.1.4.8 C4): go there, get in through the door and
// close it. Only an area of type home or the place home is a shelter. Digging in (the emergency
// shelter) is left for a creeper that stands at every entrance at night.
import { Vec3 } from 'vec3';
import { containsPos, distance, distanceToBox, expandBox, floorPos } from './box_math.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo, recallHome } from './context.js';
import { creeperCheck, creeperMemory, readCreepers, runCreeperProcedure } from './creeper.js';
import { doorCenter, sideOf } from './door_logic.js';
import { closeDoor, doorState, findOpenables, passThrough } from './doors.js';
import { goals, gotoGoal, isNear, makeMovements, walkNear } from './motion.js';
import { isNight } from './night_logic.js';
import { chooseCoverBlock, chooseShelter, chooseStandingPlace, isBuildingArea, isFallingBlockName, isInsideArea, isShelterArea, orderEntrances,
    roomCenter } from './shelter_logic.js';
import { isBedName } from './sleep_logic.js';
import { isNoStandBlock } from './stand_logic.js';
import { TEXTS, creeperAtShelterText, dugInText, inShelterText, shelterText } from './texts.js';

// Amendment 2, F3: an entrance at least this far from every creeper that stands; at night the bot
// digs in at least this far from it.
const STANDING_ENTRANCE_DISTANCE = 16;
const STANDING_DIG_DISTANCE = 24;

// The positions of the creepers that stand (the creeper procedure left them alone) and that the
// bot sees. Never throws.
function standingCreepers(bot, clock) {
    try {
        const ids = new Set(creeperMemory(bot).watch.standingIds(clock.now()));
        return ids.size === 0 ? [] : readCreepers(bot, 64).filter(c => ids.has(c.id)).map(c => c.pos);
    } catch {
        return [];
    }
}

const LIQUID_OR_AIR = new Set(['air', 'cave_air', 'void_air', 'water', 'lava']);
const AIR_NAMES = new Set(['air', 'cave_air', 'void_air']);
const BAD_FLOOR = new Set(['lava', 'magma_block', 'campfire', 'soul_campfire', 'cactus', 'fire', 'soul_fire']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function at(x, y, z) {
    return new Vec3(x, y, z);
}

function coords(p) {
    return `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}

/**
 * True when the bot stands inside the walls of a shelter of its dimension: an area of type home
 * (v0.1.4.8, C4).
 * @param {object} bot
 * @param {object} ctx
 * @returns {boolean}
 */
export function isInShelter(bot, ctx) {
    try {
        const pos = botPos(bot);
        return Boolean(pos) && listAreas(ctx, dimensionOf(bot)).some(area => isShelterArea(area) && isInsideArea(area, pos));
    } catch {
        return false;
    }
}

/**
 * The shelter of the bot by the order of C4 (see chooseShelter). The kind `emergency` means that the
 * bot knows no home. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @returns {{kind: 'area'|'place'|'emergency', area?: object, place?: object, why: string}}
 */
export function findShelter(bot, ctx) {
    try {
        const dimension = dimensionOf(bot);
        return chooseShelter({ areas: listAreas(ctx, dimension), home: recallHome(ctx), botPos: botPos(bot), dimension });
    } catch {
        return { kind: 'emergency', why: 'error' };
    }
}

// Without boundingBox (a block that is not from prismarine) the name decides: only air is free.
function isEmpty(block) {
    return block.boundingBox === undefined ? AIR_NAMES.has(block.name) : block.boundingBox === 'empty';
}

function passable(block) {
    return Boolean(block) && isEmpty(block) && block.name !== 'water' && block.name !== 'lava'
        && block.name !== 'fire' && block.name !== 'soul_fire';
}

function solidFloor(block) {
    const props = typeof block?.getProperties === 'function' ? block.getProperties() : (block?._properties ?? null);
    return Boolean(block) && !isEmpty(block) && !LIQUID_OR_AIR.has(block.name) && !BAD_FLOOR.has(block.name) && !isBedName(block.name)
        && !isNoStandBlock(block.name, props); // fix round (X1): never a place on a chest, composter, fence
}

/**
 * A test for chooseStandingPlace: the bot can stand at (x, y, z) when feet and head are free and
 * the block below is solid.
 * @param {object} bot
 * @returns {(x: number, y: number, z: number) => boolean}
 */
export function standingTest(bot) {
    return (x, y, z) => passable(bot.blockAt(at(x, y, z))) && passable(bot.blockAt(at(x, y + 1, z)))
        && solidFloor(bot.blockAt(at(x, y - 1, z)));
}

/**
 * A bed inside the walls of the building area that the bot is in, or null.
 * @param {object} bot
 * @param {object} ctx
 * @returns {{x: number, y: number, z: number}|null}
 */
export function bedInShelter(bot, ctx) {
    try {
        const pos = botPos(bot);
        const area = listAreas(ctx, dimensionOf(bot)).find(a => isBuildingArea(a) && isInsideArea(a, pos));
        if (!area) {
            return null;
        }
        const beds = bot.findBlocks({ matching: b => Boolean(b) && isBedName(b.name), maxDistance: 32, count: 16 });
        const bed = beds.find(b => containsPos(area, { x: b.x + 0.5, y: b.y, z: b.z + 0.5 }));
        return bed ? { x: bed.x, y: bed.y, z: bed.z } : null;
    } catch {
        return null;
    }
}

async function creeperFirst(bot, ctx, options) {
    // v0.1.4.8, C3: only a creeper that counts (its height, its sight, underground) starts the procedure
    if (readCreepers(bot, 16).length === 0 || creeperCheck(bot, ctx).step === 'none') {
        return null;
    }
    logTo(ctx, 'A creeper is near. I lead it away before I go in.');
    return await runCreeperProcedure(bot, ctx, options);
}

async function escapeMonster(bot, mob, ctx, options, clock) {
    if (mob?.name === 'creeper') {
        await runCreeperProcedure(bot, ctx, options);
        return;
    }
    const p = mob?.position;
    if (!p) {
        return;
    }
    logTo(ctx, `A ${mob.name ?? 'monster'} is at the door. I move away from it.`);
    await gotoGoal(bot, new goals.GoalInvert(new goals.GoalNear(p.x, p.y, p.z, 20)), {
        movements: makeMovements(bot, { dig: false, doors: false }),
        timeoutMs: 20000,
        clock,
    });
}

// Closes the open doors, gates and trapdoors of the area within 16 blocks and reads their state back.
// The counts: doors of the area found, doors still open.
async function closeOpenDoorsOf(bot, area, options) {
    let found = 0;
    let open = 0;
    for (const door of findOpenables(bot, 16)) {
        if (!containsPos(area, door)) {
            continue;
        }
        found++;
        if (door.open && !(await closeDoor(bot, door, { ...options, respectInterrupt: false }))) {
            open++;
        }
    }
    return { found, open };
}

// The reply once the bot is inside: `The door is closed.` only when the state of a door was read
// (v0.1.4.8, C4).
function insideText(name, doors) {
    if (doors.open > 0) {
        return { ok: true, where: name, reason: 'door_open', text: `I am in the shelter "${name}", but a door is still open.` };
    }
    if (doors.found === 0) {
        return { ok: true, where: name, reason: 'no_door', text: inShelterText(name) };
    }
    return { ok: true, where: name, reason: null, text: shelterText(name) };
}

async function walkToRoom(bot, area, ctx, options, clock) {
    const name = area.name ?? 'shelter';
    const center = roomCenter(area);
    const spot = chooseStandingPlace({ area, entrance: null, isFree: standingTest(bot) }) ?? floorPos(center);
    const walk = await walkNear(bot, spot, 1, { clock, timeoutMs: options.timeoutMs ?? 60000, allowDoors: true });
    if (!isInsideArea(area, botPos(bot))) {
        if (walk.reason === 'interrupted') {
            return { ok: false, where: name, reason: 'interrupted', text: 'I stopped on my way to the shelter.' };
        }
        return { ok: false, where: name, reason: 'no_path', text: `I cannot get into the shelter "${name}".` };
    }
    return insideText(name, await closeOpenDoorsOf(bot, area, options));
}

/**
 * Gets into a building area: through the entrance nearest to the bot with passThrough (the door is
 * closed and checked), then to the free standing place farthest from the entrance and the walls.
 * With monster_near the bot moves 20 blocks away from the monster (a creeper: the creeper
 * procedure) and tries another entrance or the same again; 3 attempts in all. Without entrances it
 * walks to the centre and the pathfinder opens what it needs; open doors of the area are closed.
 * @param {object} bot
 * @param {object} area
 * @param {object} ctx
 * @param {object} [options] as passThrough, plus attempts (3)
 * @returns {Promise<{ok: boolean, where: string, reason: string|null, text: string}>}
 */
export async function enterBuilding(bot, area, ctx = {}, options = {}) {
    const clock = clockOf(ctx, options);
    const name = area?.name ?? 'shelter';
    if (isInsideArea(area, botPos(bot))) {
        return { ok: true, where: name, reason: 'already_inside', text: TEXTS.inShelterAlready };
    }
    // F3: a creeper that stands keeps the bot from every entrance within 16 blocks of it
    const blockedByCreeper = (standing) => ({
        ok: false, where: name, reason: 'creeper_standing', creeper: standing[0] ?? null, text: creeperAtShelterText(name),
    });
    const usable = (standing) => orderEntrances(area, botPos(bot))
        .filter(e => standing.every(c => distance(doorCenter(e), c) >= STANDING_ENTRANCE_DISTANCE));
    if (orderEntrances(area, botPos(bot)).length === 0) {
        const standing = standingCreepers(bot, clock);
        if (standing.some(c => distanceToBox(area, c) < STANDING_ENTRANCE_DISTANCE)) {
            return blockedByCreeper(standing);
        }
        return walkToRoom(bot, area, ctx, options, clock);
    }
    const attempts = isFiniteNumber(options.attempts) ? options.attempts : 3;
    const failed = new Map();
    let last = null;
    let entrance = null;
    for (let i = 0; i < attempts; i++) {
        if (bot.interrupt_code) {
            return { ok: false, where: name, reason: 'interrupted', text: 'I stopped on my way to the shelter.' };
        }
        const standing = standingCreepers(bot, clock);
        const ordered = usable(standing);
        if (ordered.length === 0) {
            return blockedByCreeper(standing);
        }
        entrance = ordered.find(e => !failed.has(`${e.x},${e.y},${e.z}`)) ?? ordered[0];
        // v0.1.4.10 (T3-4): a trapdoor is no door to step through: the walk takes the ladder column under it
        last = isHatch(bot, entrance) ? await throughHatch(bot, area, entrance, ctx, options, clock)
            : await passThrough(bot, entrance, ctx, { ...options, inside: area, areas: listAreas(ctx, dimensionOf(bot)) });
        if (last.ok) {
            break;
        }
        const key = `${entrance.x},${entrance.y},${entrance.z}`;
        failed.set(key, (failed.get(key) ?? 0) + 1);
        if (last.reason === 'interrupted' || last.reason === 'error') {
            return { ok: false, where: name, reason: last.reason, text: last.text };
        }
        if (last.reason === 'could_not_close') {
            return { ok: false, where: name, reason: 'could_not_close', text: `I am in the shelter "${name}", but I could not close the door.` };
        }
        if (last.reason === 'monster_near') {
            await escapeMonster(bot, last.mob, ctx, options, clock);
        }
        if (isHatch(bot, entrance) && ordered.every(e => failed.has(`${e.x},${e.y},${e.z}`))) {
            break; // T3-4: the way through a trapdoor tried its passes already; no other entrance is left
        }
    }
    if (!last?.ok) {
        if (last?.reason === 'monster_near') {
            return { ok: false, where: name, reason: 'monster_near', text: TEXTS.monstersAtDoor };
        }
        return { ok: false, where: name, reason: last?.reason ?? 'no_path', text: `I cannot get into the shelter "${name}". ${last?.text ?? ''}`.trim() };
    }
    const spot = chooseStandingPlace({ area, entrance, isFree: standingTest(bot) });
    if (spot && !bot.interrupt_code) {
        await gotoGoal(bot, new goals.GoalBlock(spot.x, spot.y, spot.z), {
            movements: makeMovements(bot, { dig: false, doors: false }),
            timeoutMs: 15000,
            clock,
        });
    }
    if (!isInsideArea(area, botPos(bot))) {
        return { ok: false, where: name, reason: 'not_inside', text: `I cannot get into the shelter "${name}".` };
    }
    // passThrough closed the entrance and read it back; it is read once more, now that the bot stands inside
    let state = doorState(bot, entrance);
    if (state?.open === true) {
        await closeDoor(bot, entrance, { ...options, ctx, respectInterrupt: false });
        state = doorState(bot, entrance);
    }
    const inside = insideText(name, { found: state ? 1 : 0, open: state?.open === true ? 1 : 0 });
    return last.ladder ? { ...inside, text: `${last.ladder} ${inside.text}` } : inside;
}

// ---- through a trapdoor (v0.1.4.10, T3-4) ----

/** The walk into a shelter through a trapdoor: the ladder step when the room is this many blocks above or below. */
export const HATCH_RULES = Object.freeze({ gap: 2, passes: 3, approach: 2 });

// The ladder step of the library (library/ladder_pass.js), by a computed name: a pack imports no library module
// statically, and ladder_pass.js imports this pack's doors.js.
const LADDER_PASS = new URL('../../library/ladder_pass.js', import.meta.url).href;

async function ladderStep(bot, target, options) {
    try {
        const pass = await import(LADDER_PASS);
        return await pass.ladderStepTowards(bot, target, options);
    } catch (err) {
        console.warn('Home pack: the ladder step failed:', err?.message ?? err);
        return { tried: false, ok: false, reason: 'no_module', text: '', way: null };
    }
}

// True when the entrance is a trapdoor: as saved by the scan, or as read from the world now.
function isHatch(bot, entrance) {
    if (entrance?.kind === 'trapdoor') {
        return true;
    }
    return entrance?.kind === undefined && doorState(bot, entrance)?.kind === 'trapdoor';
}

/**
 * Into a building through a trapdoor in its ceiling or its floor (v0.1.4.10, T3-4): the walk to the standing
 * place of the room (the path search opens doors and trapdoors and climbs ladders); when it ends with the room
 * still 2 or more blocks above or below, the ladder step of the library (ladderStepTowards: the column within 6
 * blocks, the trapdoor opened, the slide or the climb; its text `I went down the ladder at (x, y, z).`), first
 * from where the bot stands and else from beside the trapdoor, then the walk again; at most 3 passes. Returns
 * as passThrough { ok, reason, text } plus `ladder`, the text of the last pass that worked. A failure is
 * no_path (a learned route may then lead in), interrupted or blocked. Never throws.
 * @param {object} bot
 * @param {object} area
 * @param {{x,y,z}} hatch
 * @param {object} ctx
 * @param {object} options
 * @param {object} clock
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, ladder?: string|null}>}
 */
export async function throughHatch(bot, area, hatch, ctx, options, clock) {
    const where = `(${hatch.x}, ${hatch.y}, ${hatch.z})`;
    const stopped = { ok: false, reason: 'interrupted', text: 'I stopped on my way to the shelter.' };
    try {
        const spot = chooseStandingPlace({ area, entrance: null, isFree: standingTest(bot) }) ?? floorPos(roomCenter(area));
        const timeoutMs = isFiniteNumber(options.timeoutMs) ? options.timeoutMs : 60000;
        const passes = [];
        const stepOptions = { passes, clock, now: clock.now, log: text => logTo(ctx, text) };
        let ladder = null;
        let failed = null;
        for (let round = 0; round <= HATCH_RULES.passes; round++) {
            if (bot.interrupt_code) {
                return stopped;
            }
            const walk = await walkNear(bot, spot, 1, { clock, timeoutMs, allowDoors: true });
            if (isInsideArea(area, botPos(bot))) {
                return { ok: true, reason: null, text: ladder ?? `I went through the trapdoor at ${where}.`, ladder };
            }
            if (walk.reason === 'interrupted' || bot.interrupt_code) {
                return stopped;
            }
            if (round === HATCH_RULES.passes || Math.abs(spot.y - botPos(bot).y) < HATCH_RULES.gap) {
                break; // no height left to climb: the ladder is no help
            }
            let step = await ladderStep(bot, spot, stepOptions);
            if (!step.tried && step.reason !== 'limit') {
                // no column near the bot that leads there: to the trapdoor first, above it or below it
                const beside = { x: hatch.x, y: spot.y < hatch.y ? hatch.y + 1 : hatch.y - 1, z: hatch.z };
                const near = await walkNear(bot, beside, HATCH_RULES.approach, { clock, timeoutMs, allowDoors: true });
                if (near.reason === 'interrupted' || bot.interrupt_code) {
                    return stopped;
                }
                step = await ladderStep(bot, spot, stepOptions);
            }
            if (!step.tried) {
                break;
            }
            if (!step.ok) {
                if (step.reason === 'interrupted' || bot.interrupt_code) {
                    return stopped;
                }
                failed = step.text;
                logTo(ctx, step.text);
                break;
            }
            ladder = step.text;
        }
        if (isInsideArea(area, botPos(bot))) {
            return { ok: true, reason: null, text: ladder ?? `I went through the trapdoor at ${where}.`, ladder };
        }
        return { ok: false, reason: 'no_path', text: failed ?? `I found no way through the trapdoor at ${where}.` };
    } catch (err) {
        console.warn('Home pack: the way through the trapdoor failed:', err?.message ?? err);
        return { ok: false, reason: 'no_path', text: `I found no way through the trapdoor at ${where}.` };
    }
}

/**
 * Goes to the shelter (v0.1.4.8, C4): 1. the area of type home that holds the place home, 2. the
 * nearest area of type home within 96 blocks, 3. the place home without an area. With no home at all
 * nothing happens: `I know no home. Tell me where home is.` (reason no_home). With a creeper within 16
 * blocks the creeper procedure runs first. A creeper that stands (F3) keeps the bot from the entrances
 * within 16 blocks of it; without another entrance the bot does not go in, and at night it digs in at
 * least 24 blocks from the creeper. `The door is closed.` is said only after the state of the door was
 * read. `options.area` forces an area (used by sleepInBed). Never throws.
 * @param {object} bot
 * @param {object} ctx { areas, places, settings, log, now }
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, where: string|null, reason: string|null, text: string}>}
 */
export async function goToShelter(bot, ctx = {}, options = {}) {
    try {
        const clock = clockOf(ctx, options);
        const choice = options.area ? { kind: 'area', area: options.area, why: 'given' } : findShelter(bot, ctx);
        if (choice.kind === 'area') {
            const name = choice.area.name ?? 'shelter';
            if (isInsideArea(choice.area, botPos(bot))) {
                return { ok: true, where: name, reason: 'already_inside', text: TEXTS.inShelterAlready };
            }
            const creeper = await creeperFirst(bot, ctx, options);
            if (creeper && !creeper.ok) {
                return { ok: false, where: name, reason: 'creeper', text: creeper.text };
            }
            const entered = await enterBuilding(bot, choice.area, ctx, options);
            if (entered.reason === 'creeper_standing' && isNight(bot.time?.timeOfDay) && !bot.interrupt_code) {
                return await digInAwayFrom(bot, entered.creeper, ctx, options, clock); // F3
            }
            if (!entered.ok && entered.reason === 'no_path' && !bot.interrupt_code) {
                // v0.1.4.9 (I5): a learned route into the building where the path search finds no way
                const viaRoute = await ctx?.routes?.walkTo?.(bot, choice.area, { clock });
                if (viaRoute?.ok) {
                    return isInsideArea(choice.area, botPos(bot)) ? await walkToRoom(bot, choice.area, ctx, options, clock)
                        : await enterBuilding(bot, choice.area, ctx, options);
                }
                if (viaRoute && viaRoute.reason !== 'no_route') {
                    return { ...entered, reason: viaRoute.reason === 'interrupted' ? 'interrupted' : entered.reason, text: viaRoute.text };
                }
            }
            return entered;
        }
        if (choice.kind === 'place') {
            const creeper = await creeperFirst(bot, ctx, options);
            if (creeper && !creeper.ok) {
                return { ok: false, where: 'home', reason: 'creeper', text: creeper.text };
            }
            const walk = await walkToHomePlace(bot, floorPos(choice.place), ctx, options, clock);
            if (!walk.ok) {
                return { ok: false, where: 'home', reason: walk.reason, text: walk.text ?? 'I could not get to the place "home".' };
            }
            const text = 'I am at the place "home". I know no building around it.';
            return { ok: true, where: 'home', reason: 'no_area', text: walk.door ? `${walk.door} ${text}` : text };
        }
        return { ok: false, where: null, reason: 'no_home', text: TEXTS.noHome };
    } catch (err) {
        console.warn('Home pack: going to the shelter failed:', err?.message ?? err);
        return { ok: false, where: null, reason: 'error', text: `I could not get to the shelter: ${err?.message ?? err}` };
    }
}

/** Fix round X6: doors and gates within this many blocks of the place "home" belong to its building. */
export const PLACE_DOOR_RANGE = 12;

// The walk to the place "home" without an area (fix round X6). The direct walk (without digging, first
// without and then with opening doors) can end at a wall of the house: the path search saw no way in
// within its time and led the bot to the point nearest to the place. Then the bot goes through the
// nearest door or gate within 12 blocks of the place with passThrough, towards the place, and walks on.
// Digging (outside the areas) comes last, as before. Returns { ok, reason, door } where door is the
// text of passThrough when the bot went through a door; v0.1.4.9: a learned route comes before the digging,
// and when it fails, nothing is dug and `text` is its text.
async function walkToHomePlace(bot, place, ctx, options, clock) {
    const areas = listAreas(ctx, dimensionOf(bot));
    const timeoutMs = options.timeoutMs ?? 120000;
    const direct = await walkNear(bot, place, 1, { clock, timeoutMs, allowDig: false });
    if (direct.ok || direct.reason === 'interrupted') {
        return direct;
    }
    const through = await throughDoorToPlace(bot, place, ctx, options, clock, areas);
    if (through.ok || through.reason === 'interrupted') {
        return through;
    }
    if (bot.interrupt_code) {
        return { ok: false, reason: 'interrupted' };
    }
    // v0.1.4.9 (I5): a learned route before digging; a route that fails digs nothing and gives its text
    const viaRoute = await ctx?.routes?.walkTo?.(bot, place, { clock });
    if (viaRoute?.ok) {
        return { ok: true, reason: null };
    }
    if (viaRoute && viaRoute.reason !== 'no_route') {
        return { ok: false, reason: viaRoute.reason === 'interrupted' ? 'interrupted' : 'no_path', text: viaRoute.text };
    }
    const center = { x: place.x + 0.5, y: place.y, z: place.z + 0.5 };
    const dig = await gotoGoal(bot, new goals.GoalNear(place.x, place.y, place.z, 1), {
        movements: makeMovements(bot, { dig: true, doors: true, areas }),
        timeoutMs,
        clock,
    });
    if (isNear(bot, center, 2)) {
        return { ok: true, reason: null };
    }
    return { ok: false, reason: dig.reason === 'interrupted' ? 'interrupted' : (dig.reason === 'timeout' ? 'timeout' : 'no_path') };
}

async function throughDoorToPlace(bot, place, ctx, options, clock, areas) {
    const center = { x: place.x + 0.5, y: place.y, z: place.z + 0.5 };
    const me = botPos(bot);
    const doors = findOpenables(bot, PLACE_DOOR_RANGE, center)
        .filter(d => d.kind !== 'trapdoor' && sideOf(d, center) !== 0)
        .map(d => ({ d, far: me ? distance(doorCenter(d), me) : 0 }))
        .sort((a, b) => a.far - b.far)
        .map(e => e.d);
    let last = { ok: false, reason: 'no_path' };
    for (const door of doors.slice(0, 2)) {
        if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted' };
        }
        const pass = await passThrough(bot, door, ctx, { ...options, toward: center, allowDig: false, areas });
        if (pass.reason === 'interrupted') {
            return { ok: false, reason: 'interrupted' };
        }
        if (!pass.ok && pass.reason !== 'could_not_close') {
            last = { ok: false, reason: pass.reason === 'monster_near' ? 'monster_near' : 'no_path' };
            continue;
        }
        const walk = await walkNear(bot, place, 1, { clock, timeoutMs: 30000 });
        if (walk.ok) {
            return { ok: true, reason: null, door: pass.text };
        }
        if (walk.reason === 'interrupted') {
            return walk;
        }
        last = walk;
    }
    return doors.length === 0 ? { ok: false, reason: 'no_door' } : last;
}

/**
 * Goes to the shelter and, when there is a bed inside, sleeps in it. For the mode night_shelter.
 * @param {object} bot
 * @param {object} ctx
 * @param {object} [options]
 * @param {Function} sleep sleepInBed (passed in to keep the modules free of cycles)
 * @returns {Promise<{ok: boolean, text: string, slept: boolean}>}
 */
export async function shelterAndSleep(bot, ctx, options, sleep) {
    const res = await goToShelter(bot, ctx, options);
    if (!res.ok || bot.interrupt_code || typeof sleep !== 'function' || !bedInShelter(bot, ctx)) {
        return { ...res, slept: false };
    }
    const s = await sleep(bot, ctx, options);
    return { ...res, ok: res.ok, slept: s.ok === true, text: `${res.text} ${s.text}` };
}

// F3: at night, with a creeper that stands at every entrance of the shelter: the emergency shelter,
// at least 24 blocks from the creeper.
async function digInAwayFrom(bot, creeperPos, ctx, options, clock) {
    const tooNear = () => Boolean(creeperPos) && distance(botPos(bot), creeperPos) < STANDING_DIG_DISTANCE;
    if (tooNear()) {
        logTo(ctx, 'A creeper stands at the shelter. I dig in away from it.');
        await gotoGoal(bot, new goals.GoalInvert(new goals.GoalNear(creeperPos.x, creeperPos.y, creeperPos.z, STANDING_DIG_DISTANCE + 3)), {
            movements: makeMovements(bot, { dig: false, doors: false }),
            timeoutMs: 30000,
            clock,
        });
    }
    if (tooNear()) {
        return { ok: false, where: 'emergency', reason: 'creeper_standing', text: 'A creeper stands at the shelter, and I could not get 24 blocks away from it to dig in.' };
    }
    return await emergencyShelter(bot, ctx, options);
}

// ---- emergency shelter ----

function protectedAt(areas, p) {
    return areas.some(area => containsPos(area, { x: p.x + 0.5, y: p.y, z: p.z + 0.5 }));
}

function columnProblem(bot, start, areas) {
    for (let i = 1; i <= 3; i++) {
        const target = { x: start.x, y: start.y - i, z: start.z };
        if (protectedAt(areas, target)) {
            return 'protected';
        }
        const block = bot.blockAt(at(target.x, target.y, target.z));
        const below = bot.blockAt(at(target.x, target.y - 1, target.z));
        if (!block || !below) {
            return 'not_loaded';
        }
        if (LIQUID_OR_AIR.has(block.name) || block.diggable === false || block.name === 'bedrock') {
            return 'bad_block';
        }
        if (LIQUID_OR_AIR.has(below.name)) {
            return 'hollow';
        }
    }
    return null;
}

async function withTimeout(promise, ms, clock, bot) {
    let settled = null;
    Promise.resolve(promise).then(() => { settled = { ok: true }; }, err => { settled = { ok: false, err }; });
    const start = clock.now();
    while (settled === null) {
        if (bot?.interrupt_code) {
            return { ok: false, err: new Error('interrupted'), interrupted: true };
        }
        if (clock.now() - start >= ms) {
            return { ok: false, err: new Error('timeout'), timeout: true };
        }
        await clock.wait(25);
    }
    return settled;
}

async function digColumn(bot, start, areas, clock) {
    for (let i = 1; i <= 3; i++) {
        if (bot.interrupt_code) {
            return 'interrupted';
        }
        const target = at(start.x, start.y - i, start.z);
        if (protectedAt(areas, target)) {
            return 'unsafe';
        }
        const below = bot.blockAt(at(start.x, start.y - i - 1, start.z));
        if (!below || LIQUID_OR_AIR.has(below.name)) {
            return 'unsafe';
        }
        const block = bot.blockAt(target);
        if (!block || LIQUID_OR_AIR.has(block.name)) {
            return 'unsafe';
        }
        try {
            const tool = bot.pathfinder?.bestHarvestTool?.(block);
            if (tool) {
                await bot.equip(tool, 'hand');
            }
        } catch {
            // dig with the hand
        }
        const dug = await withTimeout(bot.dig(block, true), 15000, clock, bot);
        if (!dug.ok) {
            try {
                bot.stopDigging?.();
            } catch {
                // nothing to stop
            }
            return dug.interrupted ? 'interrupted' : 'dig_failed';
        }
        const fallStart = clock.now();
        while (Math.floor(botPos(bot).y) > target.y && clock.now() - fallStart < 2000) {
            await clock.wait(50);
        }
    }
    return null;
}

async function coverHole(bot, start) {
    const roof = { x: start.x, y: start.y - 1, z: start.z };
    const items = bot.inventory?.items?.() ?? [];
    const isFull = name => {
        const b = bot.registry?.blocksByName?.[name];
        return Boolean(b) && b.boundingBox === 'block' && !isBedName(name) && !isFallingBlockName(name);
    };
    const choice = chooseCoverBlock(items.map(i => i.name), isFull);
    if (!choice) {
        return 'no_block';
    }
    try {
        await bot.equip(items.find(i => i.name === choice), 'hand');
    } catch {
        return 'place_failed';
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ref = bot.blockAt(at(roof.x + dx, roof.y, roof.z + dz));
        if (!ref || ref.boundingBox !== 'block') {
            continue;
        }
        try {
            await bot.placeBlock(ref, at(-dx, 0, -dz));
        } catch (err) {
            console.warn('Home pack: closing the hole failed:', err?.message ?? err);
        }
        const now = bot.blockAt(at(roof.x, roof.y, roof.z));
        if (now && now.boundingBox === 'block') {
            return null;
        }
    }
    return 'place_failed';
}

async function shiftAside(bot, areas, clock) {
    const pos = floorPos(botPos(bot));
    const test = standingTest(bot);
    const candidates = [];
    for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, 3], [3, -3], [-3, -3]]) {
        for (const dy of [0, 1, -1]) {
            const c = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
            if (!protectedAt(areas, c) && test(c.x, c.y, c.z)) {
                const d = areas.length ? Math.min(...areas.map(a => Math.hypot(c.x - (a.min.x + a.max.x) / 2, c.z - (a.min.z + a.max.z) / 2))) : 0;
                candidates.push({ c, d });
                break;
            }
        }
    }
    candidates.sort((a, b) => b.d - a.d);
    for (const { c } of candidates) {
        await gotoGoal(bot, new goals.GoalBlock(c.x, c.y, c.z), { movements: makeMovements(bot, { dig: false, doors: false }), timeoutMs: 8000, clock });
        const now = floorPos(botPos(bot));
        if (now.x !== pos.x || now.z !== pos.z) {
            return true;
        }
    }
    return false;
}

/**
 * For a bot without any shelter: digs straight down 3 blocks, one at a time. Before digging it
 * checks the column: air, water or lava below a block to dig stops it, and it moves 3 blocks and
 * starts again, up to 3 times. Then it closes the hole above its head with dirt, cobblestone or
 * any full block that does not fall. It never digs inside a protected area. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {object} [options] { now, wait } for tests
 * @returns {Promise<{ok: boolean, where: 'emergency', reason: string|null, text: string}>}
 */
export async function emergencyShelter(bot, ctx = {}, options = {}) {
    try {
        const clock = clockOf(ctx, options);
        const areas = listAreas(ctx, dimensionOf(bot)).map(a => expandBox(a, 1) ?? a);
        let lastProblem = 'no_place';
        for (let attempt = 0; attempt < 3; attempt++) {
            if (bot.interrupt_code) {
                return { ok: false, where: 'emergency', reason: 'interrupted', text: 'I stopped digging in.' };
            }
            const start = floorPos(botPos(bot));
            const problem = columnProblem(bot, start, areas);
            if (problem) {
                lastProblem = problem;
                await shiftAside(bot, areas, clock);
                continue;
            }
            const dug = await digColumn(bot, start, areas, clock);
            if (dug === 'interrupted') {
                return { ok: false, where: 'emergency', reason: 'interrupted', text: 'I stopped digging in.' };
            }
            if (dug) {
                lastProblem = dug;
                await shiftAside(bot, areas, clock);
                continue;
            }
            const cover = await coverHole(bot, start);
            const pos = botPos(bot);
            if (cover === 'no_block') {
                return { ok: false, where: 'emergency', reason: 'no_block', text: `I have no shelter. I dug in at ${coords(pos)}, but I have no block to close the hole.` };
            }
            if (cover) {
                return { ok: false, where: 'emergency', reason: cover, text: `I have no shelter. I dug in at ${coords(pos)}, but I could not close the hole.` };
            }
            logTo(ctx, dugInText(pos));
            return { ok: true, where: 'emergency', reason: null, text: dugInText(pos) };
        }
        return { ok: false, where: 'emergency', reason: lastProblem, text: 'I have no shelter and found no place to dig in.' };
    } catch (err) {
        console.warn('Home pack: digging in failed:', err?.message ?? err);
        return { ok: false, where: 'emergency', reason: 'error', text: `I have no shelter and could not dig in: ${err?.message ?? err}` };
    }
}
