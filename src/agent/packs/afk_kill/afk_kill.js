// The AFK creeper kill (spec v0.1.4.16, sections 8.4 and 8.4a, E8; the owner's findings K-2 to K-6, M-5, M-6):
// !killFarm(until). The bot pauses the reflexes the farm does without (from the start, the walk too), walks to the saved
// place kill_spot, checks the room (hoppers within 3 blocks, a slab over them), switches creeper_safety off, sneaks and
// steps forward 0.7 s under the slab (the owner's method), and hits the hostile mobs whose centre is within 3 blocks of
// its eyes, the nearest first, one hit per 600 ms until it is gone, until the owner says stop, the level or the time of
// the order is reached, its health falls under 10, or it has no weapon left. It stores the drops when the bag is nearly full, eats from the bag, sleeps in the
// bed by the room at night (K-5) and comes back, and replaces a worn weapon (K-6; never a diamond or netherite one).
// When anything else ends the action, the job of the kind kill_farm (src/agent/job) brings it back with the same until.
// Zero model calls. Every refusal, question and stop writes one line through ctx.log. Executing: it moves the bot.
// It imports the home pack only: the chests, the storage and the tools of the other packs come through ctx.
import { Vec3 } from 'vec3';
import { botPos, clockOf, dimensionOf, logTo, sayTo } from '../home/context.js';
import { eatBestFood, sleepInBed } from '../home/index.js';
import { goals, gotoGoal, makeMovements, stopMoving, walkNear } from '../home/motion.js';
import { isNight } from '../home/night_logic.js';
import { bedFoot, isBedName } from '../home/sleep_logic.js';
import {
    BED_RANGE, CHEST_RANGE, CREEPER_MODE, EAT_AT_FOOD, HIT_GAP_MS, KILL_WINDOW_MS, LOOK_RANGE, LOOP_MS, PAUSED_MODES, PROGRESS_EVERY,
    STEP_MORE_MS, STEP_MS, WEAPON_CHEST_RANGE, WEAPON_NAMES, WEAPON_WEAR, badWindowVerdict, bagCounts, cellsNear, checkRoom, chestKey, chooseWeapon,
    distance, eyeOf, gainedDrops, gunpowderByChest, isKillChestName, isWeaponName, isWorn, needsSpare, newWindow, parseUntil, pickTarget,
    stopReason, storeDue, storedFigure, stuckHits, usesLeft, windowIsBad, windowOver,
} from './afk_logic.js';
import {
    TEXTS, badUntilText, lowHealthText, noWeaponText, progressText, stepCloserText, stopLevelText, stopMinutesText, stoppedText,
    storedLineText, wornWeaponText,
} from './texts.js';

/** The saved places the pack reads (the owner saves them with !rememberHere). */
export const KILL_SPOT = 'kill_spot';
export const KILL_CHEST = 'kill_chest';
export const KILL_BED = 'kill_bed';
export const KILL_EXIT = 'kill_exit';
/** The start line is said once per this long per bot: a farm the job resumes after a reflex does not say it again. */
export const START_LINE_EVERY_MS = 30 * 60 * 1000;

const WALK_MS = 180000; // the way to the spot (the tower's ladder)
const SPOT_MS = 20000; // back to the spot cell from a trip
const SLEEP_RETRY_MS = 60000;
const SPARE_RETRY_MS = 5 * 60 * 1000; // a spare that no chest had is looked for again after this long
const MY_BED = 'my_bed';
const NEAR_SAVED = 1; // the fix round (finding 9): the chest or bed of a saved place stands within 1 block of it

// When each bot said the start line last (a WeakMap: no reference keeps a bot alive).
const startSaid = new WeakMap();

function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---- the bot's blocks and bag, read here (the pack does not import the mining pack's dig.js) ----

// A reader of block names for the room check: the name of the block, null when the chunk is not loaded. The plain name,
// not the mining pack's logic name: a waterlogged slab is a slab here.
function blockNames(bot) {
    return (x, y, z) => {
        try {
            return bot.blockAt(new Vec3(x, y, z))?.name ?? null;
        } catch {
            return null;
        }
    };
}

function items(bot) {
    try {
        return bot.inventory.items();
    } catch {
        return [];
    }
}

function countOf(bot, name) {
    return items(bot).filter(i => i?.name === name).reduce((sum, i) => sum + (num(i.count) ?? 0), 0);
}

// Empty slots of the bag (36 slots), as the mining pack counts them.
function freeSlots(bot) {
    try {
        if (typeof bot.inventory.emptySlotCount === 'function') {
            return bot.inventory.emptySlotCount();
        }
    } catch {
        // counted below
    }
    return Math.max(0, 36 - items(bot).length);
}

// A saved place as { x, y, z, dimension } from ctx.places (a MemoryBank: recallPlaceInfo; a PlaceStore: recall), or null.
function recallPlace(ctx, name) {
    const places = ctx?.places;
    if (!places) {
        return null;
    }
    try {
        for (const fn of ['recallPlaceInfo', 'recall']) {
            if (typeof places[fn] === 'function') {
                const p = places[fn](name);
                if (p && num(p.x) !== null && num(p.y) !== null && num(p.z) !== null) {
                    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), dimension: p.dimension ?? null };
                }
                return null;
            }
        }
    } catch (err) {
        console.warn(`AFK kill: could not read the place ${name}:`, err?.message ?? err);
    }
    return null;
}

// The result of the command, its text logged (rule 8 of the spec: a stop and a refusal write one line).
function finish(s, ok, reason, text) {
    logTo(s.ctx, text);
    return { ok, reason, text, kills: s.kills, hits: s.hits, stored: s.storedByMe, gunpowder: storedNow(s), level: levelOf(s.bot), ms: s.clock.now() - s.started };
}

function levelOf(bot) {
    return num(bot?.experience?.level) ?? 0;
}

function pointsOf(bot) {
    return num(bot?.experience?.points) ?? 0;
}

function held(bot) {
    try {
        return bot.heldItem ?? null;
    } catch {
        return null;
    }
}

// The weapons of the bag the farm may use, as { item, name, usesLeft }.
function weaponItems(bot) {
    return items(bot).filter(i => isWeaponName(i?.name)).map(i => ({ item: i, name: i.name, usesLeft: usesLeft(i) }));
}

function weaponOf(item) {
    return item && isWeaponName(item.name) ? { item, name: item.name, usesLeft: usesLeft(item) } : null;
}

function control(s, name, on) {
    try {
        s.bot.setControlState(name, on);
    } catch {
        // the fake bots of the tests may have no controls
    }
}

function sneak(s, on) {
    control(s, 'sneak', on);
    s.sneaking = on;
}

// ---- the modes (K-2, map16-packs 4.4): creeper_safety off, the others paused, all restored on every exit ----
// The fix round of v0.1.4.16 (review finding 8): the paused modes are paused from the start of the order, before the walk to
// the spot, so that a farm the job resumes at night does not fight night_shelter on the way (pauseModes); creeper_safety is
// switched off only at the spot, after the room check (creeperOff). restoreModes in the one finally puts back both.

function creeperOff(bot, saved) {
    const modes = bot?.modes;
    if (!modes || !saved) {
        return;
    }
    try {
        if (typeof modes.exists !== 'function' || modes.exists(CREEPER_MODE)) {
            saved.creeperWasOn = typeof modes.isOn === 'function' ? modes.isOn(CREEPER_MODE) === true : null;
            if (typeof modes.setOn === 'function') {
                modes.setOn(CREEPER_MODE, false);
            }
        }
    } catch {
        saved.creeperWasOn = null;
    }
}

function pauseModes(bot) {
    const modes = bot?.modes;
    const saved = { creeperWasOn: null, paused: [] };
    if (!modes) {
        return saved;
    }
    for (const name of PAUSED_MODES) {
        try {
            if (typeof modes.exists === 'function' && !modes.exists(name)) {
                continue;
            }
            modes.pause?.(name);
            saved.paused.push(name);
        } catch {
            // a mode that is not there
        }
    }
    return saved;
}

function restoreModes(bot, saved) {
    const modes = bot?.modes;
    if (!modes || !saved) {
        return;
    }
    try {
        if (saved.creeperWasOn === true && typeof modes.setOn === 'function') {
            modes.setOn(CREEPER_MODE, true);
        }
    } catch {
        // nothing to restore
    }
    for (const name of saved.paused) {
        try {
            modes.unpause?.(name);
        } catch {
            // a mode that is gone
        }
    }
}

// ---- the places of the room: the chest and the bed ----
// The fix round of v0.1.4.16 (review finding 9): a saved kill_chest is the real chest block (KILL_CHEST_NAMES: never a barrel
// or another container) within 1 block of the saved point, and a saved kill_bed, or the bed nearest the spot, is the foot of
// that bed; the sleep gets the foot as its only candidate.

function blockOf(bot, p) {
    try {
        return bot.blockAt(new Vec3(p.x, p.y, p.z)) ?? null;
    } catch {
        return null;
    }
}

function propsOf(block) {
    try {
        return typeof block?.getProperties === 'function' ? block.getProperties() : (block?._properties ?? {});
    } catch {
        return {};
    }
}

// The foot of the bed whose block stands at the cell (a head part: the block one step against its facing), when that foot
// is a bed block too; else null.
function footOfBedAt(bot, c) {
    const block = blockOf(bot, c);
    if (!block || !isBedName(block.name)) {
        return null;
    }
    const props = propsOf(block);
    const foot = bedFoot({ x: c.x, y: c.y, z: c.z, part: props.part, facing: props.facing });
    return foot && isBedName(blockOf(bot, foot)?.name) ? foot : null;
}

// The foot of the bed nearest the point within `range` blocks, or null.
function bedFootNear(bot, point, range = NEAR_SAVED) {
    for (const c of cellsNear(point, range)) {
        const foot = footOfBedAt(bot, c);
        if (foot) {
            return foot;
        }
    }
    return null;
}

// The real chest block nearest the point within `range` blocks, or null.
function chestNear(bot, point, range = NEAR_SAVED) {
    return cellsNear(point, range).find(c => isKillChestName(blockOf(bot, c)?.name)) ?? null;
}

function chestOfRoom(s) {
    const saved = recallPlace(s.ctx, KILL_CHEST);
    if (saved) {
        const chest = chestNear(s.bot, saved);
        if (!chest) {
            // the owner named the chest: no other container takes the drops instead
            logTo(s.ctx, `The kill chest at (${saved.x}, ${saved.y}, ${saved.z}) is no chest; I keep the drops in the bag.`);
        }
        return chest;
    }
    try {
        const known = s.ctx?.chests?.nearest?.(s.spot, dimensionOf(s.bot),
            c => distance(c, s.spot) <= CHEST_RANGE + 0.5 && isKillChestName(blockOf(s.bot, c)?.name));
        if (known) {
            return { x: known.x, y: known.y, z: known.z };
        }
    } catch {
        // the index is optional
    }
    try {
        const found = s.bot.findBlocks({ matching: b => Boolean(b) && isKillChestName(b.name), maxDistance: CHEST_RANGE, count: 4,
            point: new Vec3(s.spot.x, s.spot.y, s.spot.z) });
        if (Array.isArray(found) && found.length > 0) {
            return { x: found[0].x, y: found[0].y, z: found[0].z };
        }
    } catch {
        // no chest
    }
    return null;
}

// The kill bed's foot: the bed within 1 block of the saved kill_bed, else (no place saved) the bed nearest the spot within
// BED_RANGE; null without one.
function bedOfRoom(s) {
    if (s.bedSaved) {
        return bedFootNear(s.bot, s.bedSaved);
    }
    try {
        const found = s.bot.findBlocks({ matching: b => Boolean(b) && isBedName(b.name), maxDistance: BED_RANGE, count: 4,
            point: new Vec3(s.spot.x, s.spot.y, s.spot.z) });
        for (const p of Array.isArray(found) ? found : []) {
            const foot = footOfBedAt(s.bot, { x: p.x, y: p.y, z: p.z });
            if (foot) {
                return foot;
            }
        }
    } catch {
        // no bed
    }
    return null;
}

// The context the sleep gets (K-5): the kill bed is the bot's own bed for the night (the place my_bed), so sleepInBed
// takes it first; the saves of the home pack (my_bed) go to the real places.
function sleepContext(s) {
    const ctx = s.ctx ?? {};
    const places = ctx.places ?? null;
    const bed = s.bed;
    const dimension = dimensionOf(s.bot);
    const wrap = {
        recall: (name) => (name === MY_BED ? { ...bed, dimension } : (typeof places?.recall === 'function' ? places.recall(name)
            : (typeof places?.recallPlaceInfo === 'function' ? places.recallPlaceInfo(name) : undefined))),
        remember: (...args) => (typeof places?.remember === 'function' ? places.remember(...args)
            : (typeof places?.rememberPlace === 'function' ? places.rememberPlace(...args) : false)),
    };
    // the places for the home pack's check of the villagers' beds: a PlaceStore lists them, a MemoryBank gives its JSON
    if (typeof places?.list === 'function') {
        wrap.list = () => places.list();
    } else if (typeof places?.getJson === 'function') {
        wrap.getJson = () => places.getJson();
    }
    return { ...ctx, places: wrap };
}

// ---- the stance at the spot (K-3, 8.4a): the cell centre, the sneak, the step forward under the slab ----

async function toSpotCell(s) {
    const near = botPos(s.bot);
    const centre = { x: s.spot.x + 0.5, y: s.spot.y, z: s.spot.z + 0.5 };
    if (near && Math.hypot(near.x - centre.x, near.z - centre.z) <= 0.35 && Math.abs(near.y - centre.y) <= 1) {
        return { ok: true, reason: null };
    }
    let movements;
    try {
        movements = makeMovements(s.bot, { dig: false, doors: true });
    } catch (err) {
        return { ok: false, reason: 'error', error: err };
    }
    const res = await gotoGoal(s.bot, new goals.GoalBlock(s.spot.x, s.spot.y, s.spot.z), { movements, timeoutMs: SPOT_MS, clock: s.clock });
    if (res.reason === 'interrupted') {
        return res;
    }
    const p = botPos(s.bot);
    const ok = Boolean(p) && Math.hypot(p.x - centre.x, p.z - centre.z) <= 0.75 && Math.abs(p.y - centre.y) <= 1;
    return ok ? { ok: true, reason: null } : { ok: false, reason: res.reason ?? 'no_path' };
}

// The step forward: the forward control held `ms` while sneaking, facing the hoppers; the chests' inset stops it.
async function stepForward(s, ms) {
    try {
        await s.bot.lookAt(s.aim, true);
    } catch {
        // the look is a help, not a must
    }
    control(s, 'forward', true);
    await s.clock.wait(ms);
    control(s, 'forward', false);
    await s.clock.wait(100);
}

async function takeStance(s) {
    stopMoving(s.bot);
    const walk = await toSpotCell(s);
    if (walk.reason === 'interrupted') {
        return walk;
    }
    if (!walk.ok) {
        logTo(s.ctx, `I could not get back to the kill spot (${walk.reason}).`);
    }
    sneak(s, true);
    await s.clock.wait(100);
    await stepForward(s, STEP_MS);
    for (let i = 0; i < s.extraSteps; i++) {
        await stepForward(s, STEP_MORE_MS);
    }
    const p = botPos(s.bot);
    s.stance = p;
    if (p) {
        logTo(s.ctx, `I stand at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) under the slab, sneaking.`);
    }
    return { ok: true, reason: null };
}

// True when the bot left its stance (a trip, a push): it takes it again.
function offStance(s) {
    const p = botPos(s.bot);
    return !p || !s.stance || Math.hypot(p.x - s.stance.x, p.z - s.stance.z) > 0.3 || Math.abs(p.y - s.stance.y) > 0.5;
}

// ---- the weapons (K-6, 8.4a) ----

async function equipItem(s, item) {
    try {
        await s.bot.equip(item, 'hand');
        return true;
    } catch (err) {
        logTo(s.ctx, `I could not take the ${item?.name ?? 'weapon'} in hand: ${err?.message ?? err}`);
        return false;
    }
}

// A weapon from the kill chest or a chest within 16 blocks of the spot (the chest index), else the stone sword the
// bag's cobblestone and sticks allow (ctx.tools.ensureTool). Returns the name taken or crafted, or null.
async function fetchWeapon(s) {
    const dim = dimensionOf(s.bot);
    const chests = s.ctx?.chests;
    const storage = s.ctx?.storage;
    if (chests && typeof chests.find === 'function' && typeof storage?.fetchItem === 'function') {
        for (const name of WEAPON_NAMES) {
            let list = [];
            try {
                list = chests.find(name, dim) ?? [];
            } catch {
                list = [];
            }
            const near = list.some(c => (s.chest && c.x === s.chest.x && c.y === s.chest.y && c.z === s.chest.z) || distance(c, s.spot) <= WEAPON_CHEST_RANGE);
            if (!near) {
                continue;
            }
            sneak(s, false);
            let res;
            try {
                res = await storage.fetchItem(name, 1);
            } catch (err) {
                res = { ok: false, reason: 'error', text: `${err?.message ?? err}` };
            }
            if (res?.reason === 'interrupted' || s.bot.interrupt_code) {
                return null;
            }
            if (res?.ok || (num(res?.taken) ?? 0) > 0) {
                return name;
            }
            logTo(s.ctx, `I got no ${name} from the chests. ${res?.text ?? ''}`.trim());
        }
    }
    const ensure = s.ctx?.tools?.ensureTool;
    if (typeof ensure === 'function' && countOf(s.bot, 'cobblestone') >= 2 && countOf(s.bot, 'stick') >= 1) {
        sneak(s, false);
        let res;
        try {
            res = await ensure(s.bot, s.ctx, 'sword', 'stone', { collect: false, exact: true, now: s.clock.now, wait: s.clock.wait });
        } catch (err) {
            res = { ok: false, reason: 'error', text: `${err?.message ?? err}` };
        }
        if (res?.reason === 'interrupted' || s.bot.interrupt_code) {
            return null;
        }
        if (res?.ok) {
            return res.tool ?? 'stone_sword';
        }
        logTo(s.ctx, `I could not make a sword. ${res?.text ?? ''}`.trim());
    }
    return null;
}

// The weapon rule before a hit (K-6, 8.4a): an allowed weapon with more than 10 uses in hand serves, and a spare is
// fetched once when the bag has none and the held one has 30 uses or fewer; a worn or missing one (or a diamond or
// netherite item, never used) is replaced by the best of the bag, else by one fetched or crafted; a worn one serves
// until it breaks when there is nothing else; without any weapon the farm ends with no_weapon.
// Returns { ok } or { ok: false, text } (the stop line) or { ok: false, interrupted: true }.
async function ensureWeapon(s) {
    const inHand = weaponOf(held(s.bot));
    const others = weaponItems(s.bot).filter(w => w.item !== inHand?.item);
    if (inHand && !isWorn(inHand)) {
        if (needsSpare(inHand, others) && s.clock.now() >= s.spareRetryAt) {
            s.spareRetryAt = s.clock.now() + SPARE_RETRY_MS;
            const got = await fetchWeapon(s);
            if (s.bot.interrupt_code) {
                return { ok: false, interrupted: true };
            }
            if (got) {
                logTo(s.ctx, `I took a spare ${got}.`);
            }
            if (!inHand.item || held(s.bot) !== inHand.item) {
                await equipItem(s, inHand.item);
            }
            if (offStance(s)) {
                await takeStance(s);
            }
        }
        return { ok: true };
    }
    const fresh = others.filter(w => !isWorn(w));
    if (fresh.length > 0) {
        const best = chooseWeapon(fresh);
        if (await equipItem(s, best.item)) {
            if (inHand) {
                sayTo(s.bot, s.ctx, wornWeaponText(inHand.name, best.name));
            }
            return { ok: true };
        }
    }
    // a worn weapon in hand looks for a replacement once per SPARE_RETRY_MS; without any weapon the bot looks at once
    let got = null;
    if (!inHand || s.clock.now() >= s.spareRetryAt) {
        s.spareRetryAt = s.clock.now() + SPARE_RETRY_MS;
        got = await fetchWeapon(s);
    }
    if (s.bot.interrupt_code) {
        return { ok: false, interrupted: true };
    }
    if (got) {
        const best = chooseWeapon(weaponItems(s.bot).filter(w => !isWorn(w)));
        if (best && await equipItem(s, best.item)) {
            if (inHand) {
                sayTo(s.bot, s.ctx, wornWeaponText(inHand.name, best.name));
            }
            await takeStance(s);
            return { ok: true };
        }
    }
    if (inHand) {
        return { ok: true }; // K-6: a worn weapon is still a weapon; it serves until it breaks
    }
    const worn = chooseWeapon(others);
    if (worn && await equipItem(s, worn.item)) {
        return { ok: true };
    }
    return { ok: false, text: noWeaponText(levelOf(s.bot)) };
}

// ---- the trips: the chest, the bed, the food ----

// The store trip (8.4; the fix round, review finding 10): only the drops the bag gained since the farm started go to the kill
// chest (the counts of the start are kept: the bot's own string, arrows or bow stay; its sticks, tools and food are never
// drops). Nothing gained, or a trip that stored nothing (the chest full or out of reach): no trip again until the bag's free
// slots drop under what they are now (s.storeMark), so a bag full of the bot's own things never takes it off the spot.
async function storeTrip(s, free) {
    const storage = s.ctx?.storage;
    if (!s.chest || typeof storage?.storeItems !== 'function') {
        if (s.storeFailedAt === null) {
            logTo(s.ctx, 'I cannot store the drops: the storage pack is not loaded.');
        }
        s.storeFailedAt = s.clock.now(); // tried again after 2 minutes, never in a loop
        return;
    }
    const gained = gainedDrops(s.bagAtStart, bagCounts(items(s.bot)));
    const only = Object.keys(gained);
    if (only.length === 0) {
        s.storeMark = free; // the bag is full of the bot's own things: it stays at the spot
        return;
    }
    const keep = Object.fromEntries(only.map(name => [name, s.bagAtStart[name] ?? 0]));
    sneak(s, false);
    let res;
    try {
        res = await storage.storeItems({ only, keep, chest: s.chest, now: s.clock.now, wait: s.clock.wait });
    } catch (err) {
        res = { ok: false, reason: 'error', stored: {}, text: `${err?.message ?? err}` };
    }
    if (res?.reason === 'interrupted' || s.bot.interrupt_code) {
        return;
    }
    const stored = res?.stored && typeof res.stored === 'object' ? res.stored : {};
    const gunpowder = num(stored.gunpowder) ?? 0;
    s.storedByMe += gunpowder;
    if (!s.lookFirst || !Object.hasOwn(s.lookFirst, chestKey(s.chest))) {
        s.storedOutside += gunpowder; // a chest the looks do not cover: what the bot stored there counts as it is
    }
    if (Object.values(stored).some(n => (num(n) ?? 0) > 0)) {
        s.storeMark = null;
        logTo(s.ctx, storedLineText(stored)); // the quiet line
        await lookAtChests(s); // the bot is by the chests anyway: the figure of the progress line
    } else {
        logTo(s.ctx, `I stored nothing in the kill chest. ${res?.text ?? ''}`.trim());
        s.storeMark = freeSlots(s.bot);
    }
    await takeStance(s);
}

// The meal (the fix round, review finding 4): eaten sneaking at the spot; standing up would let a creeper see the bot over
// the slab for the whole meal.
async function eatStep(s) {
    let res;
    try {
        res = await s.eat(s.bot, s.ctx, { now: s.clock.now, wait: s.clock.wait });
    } catch (err) {
        res = { ok: false, ate: 0, reason: 'error', text: `${err?.message ?? err}` };
    }
    if (res?.reason === 'interrupted' || s.bot.interrupt_code) {
        return;
    }
    if ((num(res?.ate) ?? 0) === 0 && !s.saidNoFood) {
        s.saidNoFood = true;
        sayTo(s.bot, s.ctx, TEXTS.noFood);
    }
    s.ateAt = s.clock.now();
    const weapon = chooseWeapon(weaponItems(s.bot));
    if (weapon && held(s.bot) !== weapon.item) {
        await equipItem(s, weapon.item); // the food was in hand
    }
    if (offStance(s) || !s.sneaking) {
        await takeStance(s);
    }
}

async function sleepStep(s) {
    const anchor = s.bedSaved ?? s.bed; // the saved kill_bed, else the foot found at the start
    if (!anchor) {
        if (!s.saidNoBed) {
            s.saidNoBed = true;
            sayTo(s.bot, s.ctx, TEXTS.noBed);
        }
        s.sleepRetryAt = Infinity;
        return;
    }
    // the kill bed is the only bed (8.4): gone or taken, the bot farms on and looks again after a minute; looked up again each
    // night by the saved place (a bed the owner placed anew counts)
    const foot = bedFootNear(s.bot, anchor);
    const props = foot ? propsOf(blockOf(s.bot, foot)) : {};
    if (!foot || props.occupied === true || props.occupied === 'true') {
        logTo(s.ctx, !foot
            ? `The kill bed at (${anchor.x}, ${anchor.y}, ${anchor.z}) is gone; I farm on.`
            : 'The kill bed is taken; I farm on.');
        s.sleepRetryAt = s.clock.now() + SLEEP_RETRY_MS;
        return;
    }
    s.bed = foot;
    sneak(s, false);
    let res;
    try {
        res = await s.sleep(s.bot, sleepContext(s), { now: s.clock.now, wait: s.clock.wait, only: { ...foot } });
    } catch (err) {
        res = { ok: false, reason: 'error', text: `${err?.message ?? err}` };
    }
    if (res?.reason === 'interrupted' || s.bot.interrupt_code) {
        return;
    }
    logTo(s.ctx, res?.text ?? (res?.ok ? 'I slept.' : 'I could not sleep.'));
    s.sleepRetryAt = s.clock.now() + SLEEP_RETRY_MS; // a night that goes on (a sleep refused or cut short) is tried again after a minute
    await takeStance(s);
}

// ---- the kill loop ----

// The record of the hit comes first, so that a hurt or death event the hit brings at once finds it.
function hitTarget(s, target) {
    const now = s.clock.now();
    const known = s.records.get(target.id);
    const rec = known ?? { id: target.id, name: target.name, hits: 0, landed: 0, lastHitAt: now, dead: false, reachedAt: null };
    const before = { lastHitAt: rec.lastHitAt, focus: s.focus, lastHit: s.lastHitAt };
    rec.hits++;
    rec.lastHitAt = now;
    s.records.set(target.id, rec);
    s.lastHitAt = now;
    s.focus = target.id;
    s.hits++;
    s.window.hits++;
    try {
        s.bot.attack(target);
    } catch (err) {
        rec.hits--;
        rec.lastHitAt = before.lastHitAt;
        if (!known) {
            s.records.delete(target.id);
        }
        s.lastHitAt = before.lastHit;
        s.focus = before.focus;
        s.hits--;
        s.window.hits--;
        logTo(s.ctx, `The hit failed: ${err?.message ?? err}`);
    }
}

// A landed hit; the time when the target took its stuck hits (4 with a stone or iron sword) is noted.
function onHurt(s, entity) {
    const rec = entity ? s.records.get(entity.id) : null;
    if (rec && !rec.dead) {
        rec.landed++;
        s.window.landed++;
        if (rec.reachedAt === null && rec.landed >= stuckHits(held(s.bot)?.name ?? null)) {
            rec.reachedAt = s.clock.now();
        }
    }
}

function countKill(s, rec) {
    if (rec.dead) {
        return;
    }
    rec.dead = true;
    s.dying.add(rec.id);
    if (s.focus === rec.id) {
        s.focus = null;
    }
    s.kills++;
    s.window.kills++;
    if (s.kills % PROGRESS_EVERY === 0) {
        sayTo(s.bot, s.ctx, progressText(s.kills, s.hits, levelOf(s.bot), storedNow(s)));
    }
}

// entityDead comes with the killing hit (the probe: the body goes about 1 s later)
function onDead(s, entity) {
    const rec = entity ? s.records.get(entity.id) : null;
    if (rec && s.clock.now() - rec.lastHitAt <= KILL_WINDOW_MS * 4) {
        countKill(s, rec);
    }
}

function onGone(s, entity) {
    if (!entity) {
        return;
    }
    const rec = s.records.get(entity.id);
    if (rec && !rec.dead && s.clock.now() - rec.lastHitAt <= KILL_WINDOW_MS) {
        countKill(s, rec);
    }
    s.records.delete(entity.id);
    s.dying.delete(entity.id);
    if (s.focus === entity.id) {
        s.focus = null;
    }
}

// The stuck targets of the window (the lead's rule of 2026-11-13 for the kill check): alive a kill window after they took
// their stuck hits without dying, and hit in this window; a target that stays stuck counts in every window it is hit.
function stuckCount(s) {
    const now = s.clock.now();
    let n = 0;
    for (const rec of s.records.values()) {
        if (!rec.dead && rec.reachedAt !== null && now - rec.reachedAt >= KILL_WINDOW_MS && rec.lastHitAt >= s.window.since && s.bot.entities?.[rec.id]) {
            n++;
        }
    }
    return n;
}

// The gunpowder of the kill chests (the lead's rule of 2026-11-14, T5's finding): the hoppers feed the chests, so the bot looks
// into the kill chest and the chests within 6 blocks of the spot through the storage pack (at arm's length; the walk to them
// is the storage pack's). A sneaking bot with a sword in hand cannot open a chest (the click goes to the item), so the sneak
// ends first; the caller takes the stance again. The first look is the baseline, each later one gives the figure. Returns
// true when it looked. Never throws.
async function lookAtChests(s) {
    const look = s.ctx?.storage?.lookIntoChests;
    if (typeof look !== 'function' || s.bot.interrupt_code) {
        return false;
    }
    sneak(s, false);
    let chests = null;
    try {
        chests = await look(LOOK_RANGE + 1, { now: s.clock.now, wait: s.clock.wait });
    } catch (err) {
        logTo(s.ctx, `I could not look into the kill chests: ${err?.message ?? err}`);
        return false;
    }
    if (s.bot.interrupt_code || !Array.isArray(chests)) {
        return false;
    }
    const counts = gunpowderByChest(chests, s.spot, s.chest);
    if (s.lookFirst === null) {
        s.lookFirst = counts;
    } else {
        s.lookLast = counts;
    }
    return true;
}

// The stored figure of the lines: null before a look after the first one (the lines leave the part out).
function storedNow(s) {
    return storedFigure(s.lookFirst, s.lookLast, s.storedOutside);
}

// The kill check (K-3) at the end of each 2-minute window: a bad window steps closer, a second one ends the farm.
// Returns the stop text, or null to go on.
async function killCheck(s) {
    if (!windowOver(s.window, s.clock.now())) {
        return null;
    }
    s.window.stuck = stuckCount(s);
    const bad = windowIsBad(s.window, pointsOf(s.bot));
    const hits = s.window.hits;
    s.window = newWindow(s.clock.now(), pointsOf(s.bot));
    if (!bad) {
        return null;
    }
    const verdict = badWindowVerdict(s.badWindows);
    s.badWindows++;
    if (verdict === 'closer') {
        sayTo(s.bot, s.ctx, stepCloserText(hits));
        s.extraSteps++;
        await takeStance(s);
        return null;
    }
    return TEXTS.noKill;
}

async function loop(s) {
    const bot = s.bot;
    for (;;) {
        if (bot.interrupt_code) {
            return finish(s, false, 'interrupted', stoppedText(s.kills, storedNow(s)));
        }
        const why = stopReason(s.until, { level: levelOf(bot), elapsedMs: s.clock.now() - s.started, health: bot.health });
        if (why === 'health') {
            return finish(s, false, 'low_health', lowHealthText(bot.health));
        }
        if (why === 'level' || why === 'minutes') {
            // the stop of the order: one more look into the kill chests for the stored figure
            const elapsed = s.clock.now() - s.started;
            const level = levelOf(bot);
            // B-13 (T5): the last kill's drops pass through the hopper (one item per 8 ticks) before they reach the chest
            await s.clock.wait(1500);
            await lookAtChests(s);
            return finish(s, true, null, why === 'level'
                ? stopLevelText(level, s.kills, elapsed, storedNow(s))
                : stopMinutesText(s.until.minutes, s.kills, storedNow(s)));
        }
        const now = s.clock.now();
        // the night (K-5): the bed by the room, then back; without a bed the farm goes on (said once)
        if (isNight(bot.time?.timeOfDay) && now >= s.sleepRetryAt) {
            await sleepStep(s); // without any kill bed it sets sleepRetryAt to Infinity
            continue;
        }
        // the food: from the bag at 14 or lower (the hunger reflex is paused)
        if ((num(bot.food) ?? 20) <= EAT_AT_FOOD && now - s.ateAt >= 30000) {
            await eatStep(s);
            continue;
        }
        // the drops: the chest when the bag has 4 free slots or fewer, and fewer than after a trip that stored nothing (finding 10)
        const free = s.chest ? freeSlots(bot) : null;
        if (s.chest && storeDue(free, s.storeMark) && now - (s.storeFailedAt ?? -Infinity) >= 120000) {
            await storeTrip(s, free); // nothing gained: it sets the mark and the bot stays; the next pass goes on to the hit
            continue;
        }
        const stop = await killCheck(s);
        if (stop !== null) {
            return finish(s, false, 'no_kill', stop);
        }
        // the target (8.4a): a hostile whose centre is within reach of the eyes, the one hit last until it is gone, else the
        // nearest; one hit per 600 ms
        const eye = eyeOf(botPos(bot), s.sneaking);
        const target = eye ? pickTarget(bot.entities, eye, { skip: s.dying, focus: s.focus }) : null;
        if (target && now - s.lastHitAt >= HIT_GAP_MS) {
            const weapon = await ensureWeapon(s);
            if (weapon.interrupted) {
                continue;
            }
            if (!weapon.ok) {
                return finish(s, false, 'no_weapon', weapon.text);
            }
            if (offStance(s) || !s.sneaking) {
                await takeStance(s); // a trip for a weapon moved the bot or ended the sneak
                continue;
            }
            hitTarget(s, target);
        }
        await s.clock.wait(LOOP_MS);
    }
}

// ---- the way out ----

async function wayOut(s) {
    if (s.bot.interrupt_code) {
        return;
    }
    const exit = recallPlace(s.ctx, KILL_EXIT) ?? (s.cameFrom ? { x: Math.floor(s.cameFrom.x), y: Math.floor(s.cameFrom.y), z: Math.floor(s.cameFrom.z) } : null);
    if (!exit) {
        return;
    }
    const p = botPos(s.bot);
    if (p && distance(p, { x: exit.x + 0.5, y: exit.y, z: exit.z + 0.5 }) <= 2) {
        return;
    }
    const res = await walkNear(s.bot, exit, 1, { clock: s.clock, timeoutMs: WALK_MS, allowDoors: true });
    if (!res.ok) {
        logTo(s.ctx, `I could not walk back out of the kill room (${res.reason}).`);
    }
}

function sayStartLine(s) {
    const last = startSaid.get(s.bot);
    const now = s.clock.now();
    if (typeof last === 'number' && now - last >= 0 && now - last < START_LINE_EVERY_MS) {
        logTo(s.ctx, 'I farm creepers at the kill spot again.');
        return;
    }
    startSaid.set(s.bot, now);
    sayTo(s.bot, s.ctx, TEXTS.start);
}

/**
 * !killFarm(until) (spec 8.4, 8.4a). Never throws; ends on bot.interrupt_code (the owner's "stop", or anything else that
 * ends the action: the job of the kind kill_farm brings the farm back).
 * @param {object} bot
 * @param {object} ctx the pack context: places, chests, storage, tools, routes (optional), log, say, now
 * @param {string} [until] '', `level N` or `N minutes`
 * @param {{now?: Function, wait?: Function, sleep?: Function, eat?: Function}} [options] the clock of the tests; `sleep` and
 *   `eat` replace sleepInBed and eatBestFood of the home pack (tests)
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, kills: number, hits: number, stored: number, level: number, ms: number}>}
 *   reasons: null (the level or the time reached), bad_until, no_spot, no_way, no_hopper, no_slab, no_weapon, no_kill, low_health,
 *   interrupted, error
 */
export async function killFarm(bot, ctx = {}, until = '', options = {}) {
    const clock = clockOf(ctx, options);
    const s = {
        bot, ctx: ctx ?? {}, clock, started: clock.now(), until: parseUntil(until),
        spot: null, aim: null, chest: null, bed: null, bedSaved: null, cameFrom: botPos(bot), stance: null, sneaking: false, extraSteps: 0,
        kills: 0, hits: 0, lastHitAt: -Infinity, focus: null, records: new Map(), dying: new Set(), window: null, badWindows: 0,
        storedByMe: 0, storedOutside: 0, lookFirst: null, lookLast: null, storeFailedAt: null, ateAt: -Infinity, saidNoFood: false, saidNoBed: false, sleepRetryAt: 0, spareRetryAt: 0,
        // the fix round (finding 10): the bag when the farm started (a store trip takes only what was gained since), and the free
        // slots after a trip that stored nothing (no trip again until they drop under it)
        bagAtStart: bagCounts(items(bot)), storeMark: null,
        sleep: typeof options?.sleep === 'function' ? options.sleep : sleepInBed,
        eat: typeof options?.eat === 'function' ? options.eat : eatBestFood,
    };
    if (s.until.kind === 'bad') {
        return finish(s, false, 'bad_until', badUntilText(s.until.until));
    }
    const spot = recallPlace(ctx, KILL_SPOT);
    if (!spot) {
        return finish(s, false, 'no_spot', TEXTS.noSpot);
    }
    s.spot = { x: spot.x, y: spot.y, z: spot.z };
    // the fix round (finding 8): the reflexes the farm pauses are paused from here, before the walk to the spot (a farm the job
    // resumes at night does not fight night_shelter on the way); creeper_safety goes off at the spot; both come back in the finally
    const modes = pauseModes(bot);
    const hurt = (entity) => onHurt(s, entity);
    const dead = (entity) => onDead(s, entity);
    const gone = (entity) => onGone(s, entity);
    let inRoom = false;
    try {
        // the way there: a saved route when the routes pack has one, else the path search with doors on (the ladder is a ladder)
        let walk = null;
        try {
            if (typeof ctx?.routes?.walkTo === 'function' && ctx.routes.routeFor?.(s.spot)) {
                walk = await ctx.routes.walkTo(bot, s.spot, { clock });
            }
        } catch (err) {
            logTo(ctx, `The route to the kill spot failed: ${err?.message ?? err}`);
            walk = null;
        }
        if (walk?.reason === 'interrupted' || bot.interrupt_code) {
            return finish(s, false, 'interrupted', stoppedText(0));
        }
        if (!walk?.ok) {
            walk = await walkNear(bot, s.spot, 1, { clock, timeoutMs: WALK_MS, allowDoors: true });
        }
        if (walk.reason === 'interrupted' || bot.interrupt_code) {
            return finish(s, false, 'interrupted', stoppedText(0));
        }
        if (!walk.ok) {
            return finish(s, false, 'no_way', TEXTS.noWay);
        }
        // the room check at the spot
        const room = checkRoom(blockNames(bot), s.spot);
        if (!room.ok) {
            // the lead's rule of 2026-11-14 (T5's finding): the bot does not stay in a room it called unsafe; it walks back to
            // where it stood when the order came, doors on; creeper_safety was not touched
            await wayOut(s);
            return finish(s, false, room.reason, room.reason === 'no_hopper' ? TEXTS.noHopper : TEXTS.noSlab);
        }
        inRoom = true;
        const first = room.hoppers.find(h => room.towards && (h.x - s.spot.x) * room.towards.x + (h.z - s.spot.z) * room.towards.z > 0) ?? room.hoppers[0];
        s.aim = new Vec3(first.x + 0.5, first.y + 1.6, first.z + 0.5);
        s.chest = chestOfRoom(s);
        s.bedSaved = recallPlace(ctx, KILL_BED);
        s.bed = bedOfRoom(s);
        logTo(ctx, `The kill room: ${room.hoppers.length} hoppers, the slab at (${room.slab.x}, ${room.slab.y}, ${room.slab.z}), `
            + `the chest ${s.chest ? `at (${s.chest.x}, ${s.chest.y}, ${s.chest.z})` : 'unknown'}, the bed ${s.bed ? `at (${s.bed.x}, ${s.bed.y}, ${s.bed.z})` : 'unknown'}.`);
        creeperOff(bot, modes);
        bot.on?.('entityHurt', hurt);
        bot.on?.('entityDead', dead);
        bot.on?.('entityGone', gone);
        sayStartLine(s);
        const weapon = await ensureWeapon(s);
        if (weapon.interrupted || bot.interrupt_code) {
            return finish(s, false, 'interrupted', stoppedText(0, storedNow(s)));
        }
        if (!weapon.ok) {
            return finish(s, false, 'no_weapon', weapon.text);
        }
        await lookAtChests(s); // the baseline of the stored figure
        if (bot.interrupt_code) {
            return finish(s, false, 'interrupted', stoppedText(0, storedNow(s)));
        }
        const stance = await takeStance(s);
        if (stance.reason === 'interrupted' || bot.interrupt_code) {
            return finish(s, false, 'interrupted', stoppedText(0, storedNow(s)));
        }
        s.window = newWindow(clock.now(), pointsOf(bot));
        return await loop(s);
    } catch (err) {
        console.warn('AFK kill: the farm failed:', err?.message ?? err);
        return finish(s, false, 'error', `The farm failed: ${err?.message ?? err}`);
    } finally {
        bot.removeListener?.('entityHurt', hurt);
        bot.removeListener?.('entityDead', dead);
        bot.removeListener?.('entityGone', gone);
        if (inRoom) {
            sneak(s, false);
            stopMoving(bot);
            try {
                await wayOut(s);
            } catch (err) {
                console.warn('AFK kill: the way out failed:', err?.message ?? err);
            }
        }
        restoreModes(bot, modes);
    }
}
