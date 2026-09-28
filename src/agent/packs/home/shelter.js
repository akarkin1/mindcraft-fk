// The shelter of the bot (spec v0.1.4.6 H3): go there, get in through the door and close it; dig
// in when there is no shelter at all.
import { Vec3 } from 'vec3';
import { containsPos, distance, distanceToBox, expandBox, floorPos } from './box_math.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo, recallHome } from './context.js';
import { creeperMemory, readCreepers, runCreeperProcedure } from './creeper.js';
import { doorCenter } from './door_logic.js';
import { closeDoor, findOpenables, passThrough } from './doors.js';
import { goals, gotoGoal, makeMovements, walkNear } from './motion.js';
import { isNight } from './night_logic.js';
import { chooseCoverBlock, chooseShelter, chooseStandingPlace, isBuildingArea, isFallingBlockName, isInsideArea, orderEntrances, roomCenter } from './shelter_logic.js';
import { isBedName } from './sleep_logic.js';
import { TEXTS, creeperAtShelterText, dugInText, shelterText } from './texts.js';

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
 * True when the bot stands inside the walls of a building area of its dimension.
 * @param {object} bot
 * @param {object} ctx
 * @returns {boolean}
 */
export function isInShelter(bot, ctx) {
    try {
        const pos = botPos(bot);
        return Boolean(pos) && listAreas(ctx, dimensionOf(bot)).some(area => isBuildingArea(area) && isInsideArea(area, pos));
    } catch {
        return false;
    }
}

/**
 * The shelter of the bot by the order of H3 (see chooseShelter). Never throws.
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
    return Boolean(block) && !isEmpty(block) && !LIQUID_OR_AIR.has(block.name) && !BAD_FLOOR.has(block.name) && !isBedName(block.name);
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
    if (readCreepers(bot, 16).length === 0) {
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

async function closeOpenDoorsOf(bot, area, options) {
    let open = 0;
    for (const door of findOpenables(bot, 6)) {
        if (door.open && containsPos(area, door)) {
            if (!(await closeDoor(bot, door, { ...options, respectInterrupt: false }))) {
                open++;
            }
        }
    }
    return open;
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
    const stillOpen = await closeOpenDoorsOf(bot, area, options);
    if (stillOpen > 0) {
        return { ok: true, where: name, reason: 'door_open', text: `I am in the shelter "${name}", but a door is still open.` };
    }
    return { ok: true, where: name, reason: null, text: shelterText(name) };
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
        last = await passThrough(bot, entrance, ctx, { ...options, inside: area, areas: listAreas(ctx, dimensionOf(bot)) });
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
    return { ok: true, where: name, reason: null, text: shelterText(name) };
}

/**
 * Goes to the shelter (spec H3): 1. the building area that contains the place home, 2. the building
 * area named home, 3. the nearest building area within 128 blocks, 4. the place home without an
 * area, 5. an emergency shelter. With a creeper within 16 blocks the creeper procedure runs first.
 * A creeper that stands (F3) keeps the bot from the entrances within 16 blocks of it; without another
 * entrance the bot does not go in, and at night it digs in at least 24 blocks from the creeper.
 * `options.area` forces an area (used by sleepInBed). Never throws.
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
            return entered;
        }
        if (choice.kind === 'place') {
            const creeper = await creeperFirst(bot, ctx, options);
            if (creeper && !creeper.ok) {
                return { ok: false, where: 'home', reason: 'creeper', text: creeper.text };
            }
            const place = floorPos(choice.place);
            const walk = await walkNear(bot, place, 1, {
                clock, timeoutMs: options.timeoutMs ?? 120000, allowDig: true, areas: listAreas(ctx, dimensionOf(bot)),
            });
            if (!walk.ok) {
                return { ok: false, where: 'home', reason: walk.reason, text: 'I could not get to the place "home".' };
            }
            return { ok: true, where: 'home', reason: 'no_area', text: 'I am at the place "home". I know no building around it.' };
        }
        return await emergencyShelter(bot, ctx, options);
    } catch (err) {
        console.warn('Home pack: going to the shelter failed:', err?.message ?? err);
        return { ok: false, where: null, reason: 'error', text: `I could not get to the shelter: ${err?.message ?? err}` };
    }
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
