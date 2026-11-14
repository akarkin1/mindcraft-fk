// The work of the breeding pack (spec v0.1.4.16, 8.2, E6): !breed(pen, count). The decisions come from breeding_logic.js;
// this module reads the pen and its animals, gets the feed (the bag, else takeOrAsk of 8.1), walks the ring one block
// outside the fence, equips the feed, clicks the animals (bot.activateEntity, which the pen guard does not wrap: feeding
// over the fence is allowed by construction) and counts the young. The bot never enters the pen's box (the walks along the
// ring cannot open doors or gates, the pen's cells cost the path search the keep-out price, a goal inside the fence box is
// refused, and no stand cell lies inside), never clicks a gate, and places nothing. The pack runs as an action, so the item
// reflex is off meanwhile.
//
// v0.1.4.16 fix round (V-6, review 6): the bot goes to the pen before it reads the animals. The feed is made ready where the
// order finds it (the chests of 8.1 are those within 48 blocks of the bot), for the animals the pen was saved with; then the
// bot leaves the building it stands in through its door (ctx.home.leaveBuilding, as the farming pack since F4) and walks to
// the ring cell nearest it, the path search allowed to open doors (a door is no pen gate; the pen guard keeps every gate of
// a pen shut by itself); only there it reads the animals of the pen (the species, the cap, the adults it may feed).
//
// v0.1.4.16 FX4 (review 16b, finding 1): a failed walk no longer refuses a pen whose ring has free cells. The walk to the pen
// tries the ring cells by distance, without the cells the bot cannot stand on (a solid block or a liquid in the cell or the
// cell above, no solid floor under it), up to approachTries walks, and goes on to the rounds when the bot ends within nearRing
// blocks of the ring after the last failed walk; the rounds take their stand cells from the same cells, without those the walk
// could not reach. A building the bot cannot leave is no refusal when the pen lies inside its box (a barn around the pen).
//
// A round: the stand cell is the ring cell nearest to the nearest adult that may be fed; there the bot holds the feed and
// waits up to 10 s for two adults within reach, feeds them (a pair), and goes on while pairs come; an adult that did not come
// to its nearest cell is skipped for the round, and the next stand cell is the one of the next adult. Rounds repeat after
// the game's cooldown, at most two more, until `count` young are born.
//
// ctx: { areas, log, say, now, chests?, storage?, permits? } of the pack context. options { now, wait, askMs } for tests.
import { Vec3 } from 'vec3';
import { countContents } from '../../areas/area_sense.js';
import { hasWalls } from '../home/area_kinds.js';
import { containsPos, isBox } from '../home/box_math.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo, sayTo } from '../home/context.js';
import { blockReader, goals, gotoGoal, makeMovements } from '../home/motion.js';
import { goalAvoiding, isNoStandCell } from '../home/stand_logic.js';
import {
    BABY_WAIT_MS, BREED_COOLDOWN_MS, COME_WAIT_MS, COOLDOWN_CHECK_MS, COOLDOWN_MARGIN_MS, EXTRA_ROUNDS, FEED_REACH, PEN_CAP, STOP_CHECK_MS, adultsInReach, animalCount,
    animalsIn, cleanCount, eyesOf, feedNeeded, feedOf, feedableAdults, fenceBoxOf, findGates, gatesOf, insideBoxXZ, lowMark, nearestRingCell, newBabies,
    ringCellStandable, speciesOf, standRing, withoutGateCells,
} from './breeding_logic.js';
import { bagCount, chestsWith, takeOrAsk } from './stock_logic.js';
import {
    PURPOSES, endText, fedText, noAnimalsText, noFeedText, noWayText, penFullText, stoppedText, unknownPenText, unknownSpeciesText, unreachedText,
} from './texts.js';

/** The rules of the feeding: the cap, the reach, the cooldown and its checks, the waits, the rounds, the walks; v0.1.4.16 fix
 *  round (V-6): the walk to the pen (its time limit per block of the way, at least walkMs; the ring cells tried, the nearest
 *  first); v0.1.4.16 FX4 (review 16b, finding 1): six walks at most (the cells the bot can stand on), and a bot that ends
 *  within nearRing blocks of the ring after the last failed walk goes on to the rounds. */
export const BREED_RULES = Object.freeze({
    cap: PEN_CAP,
    reach: FEED_REACH,
    cooldownMs: BREED_COOLDOWN_MS,
    marginMs: COOLDOWN_MARGIN_MS,
    checkMs: COOLDOWN_CHECK_MS,
    stopCheckMs: STOP_CHECK_MS,
    comeMs: COME_WAIT_MS,
    babyWaitMs: BABY_WAIT_MS,
    extraRounds: EXTRA_ROUNDS,
    walkMs: 20000,
    approachMsPerBlock: 1000,
    approachTries: 6,
    nearRing: 3,
    feedMs: 1500,
    pollMs: 250,
    defaultCount: 2,
});

function normalizeName(name) {
    return typeof name === 'string' ? name.trim().toLowerCase().replace(/\s+/g, '_') : null;
}

// The saved pen of a name: the area store's entry (get normalises the name), else the area of that name among the areas
// given; null when there is none or it is no pen.
function findPen(ctx, name) {
    const wanted = normalizeName(name);
    if (!wanted) {
        return null;
    }
    let area = null;
    try {
        if (typeof ctx?.areas?.get === 'function') {
            area = ctx.areas.get(name) ?? null;
        }
    } catch {
        area = null;
    }
    if (!area) {
        area = listAreas(ctx).find(a => normalizeName(a.name) === wanted) ?? null;
    }
    if (!area || !(area.type === 'pen' || area.kind === 'pen') || !isBox(area)) {
        return null;
    }
    return area;
}

// The feed the bag holds the most of; with none in the bag, the one the known chests hold the most of; else the preferred one.
function chooseFeed(bot, ctx, feeds) {
    const most = (countOf) => {
        let best = null;
        let n = 0;
        for (const feed of feeds) {
            const c = countOf(feed);
            if (c > n) {
                n = c;
                best = feed;
            }
        }
        return best;
    };
    const me = botPos(bot);
    return most(feed => bagCount(bot, feed))
        ?? most(feed => chestsWith(ctx, feed, me, dimensionOf(bot)).reduce((sum, c) => sum + c.count, 0))
        ?? feeds[0];
}

async function equipFeed(bot, feed) {
    try {
        if (bot.heldItem && bot.heldItem.name === feed && bot.heldItem.count > 0) {
            return true;
        }
        const item = (bot.inventory?.items?.() ?? []).find(i => i?.name === feed && i.count > 0);
        if (!item) {
            return false;
        }
        await bot.equip(item, 'hand');
        return true;
    } catch (err) {
        console.warn('Breeding pack: could not equip the feed:', err?.message ?? err);
        return false;
    }
}

function liveCount(bot, box) {
    try {
        return countContents(bot, box);
    } catch {
        return { animals: {} };
    }
}

// The clock of the options for the home pack's functions (tests), nothing in the game.
function clockOptions(options) {
    const out = {};
    if (typeof options?.now === 'function') out.now = options.now;
    if (typeof options?.wait === 'function') out.wait = options.wait;
    return out;
}

// The feed of a species for `target` young, two per pair: the feed of the species the bag holds the most of (else the one the
// known chests hold the most of); when the bag holds too little, the shortfall through the asking rule of 8.1 (the chests
// within 48 blocks of the bot). { feed } or { feed, refusal: [reason, text] } (reasons interrupted, no_permit, no_feed); a bag
// that feeds fewer pairs than ordered goes on, with the line of takeOrAsk in the log.
async function getFeed(bot, ctx, species, target, options) {
    const feed = chooseFeed(bot, ctx, feedOf(species));
    if (bagCount(bot, feed) >= feedNeeded(target)) {
        return { feed };
    }
    const r = await takeOrAsk(bot, ctx, feed, feedNeeded(target), { low: lowMark(target), purpose: PURPOSES.feeding, now: options?.now, wait: options?.wait, askMs: options?.askMs });
    if (!r.ok) {
        if (r.reason === 'interrupted') {
            return { feed, refusal: ['interrupted', ''] };
        }
        if (r.reason === 'no_permit') {
            return { feed, refusal: ['no_permit', r.text] };
        }
        if (bagCount(bot, feed) < 2) {
            return { feed, refusal: ['no_feed', noFeedText(feed, species)] };
        }
        logTo(ctx, r.text); // the bag feeds fewer pairs than ordered
    }
    return { feed };
}

// v0.1.4.16 FX4 (review 16b, finding 1): a block as the stand test of the ring reads it: the name, the properties and whether
// it is solid (a full collision box); null when the chunk is not loaded. Never throws.
function standReader(bot) {
    return (x, y, z) => {
        try {
            const b = bot.blockAt(new Vec3(x, y, z));
            if (!b || typeof b.name !== 'string') {
                return null;
            }
            const properties = typeof b.getProperties === 'function' ? b.getProperties() : (b._properties ?? null);
            return { name: b.name, properties, solid: b.boundingBox === 'block' };
        } catch {
            return null;
        }
    };
}

// The stand ring of the pen as the blocks show it now: the fence box (a saved pen's box holds the fence, B-13), the ring one
// block outside it without the gates and the cells before them, and the cells a walk may not end on (inside the fence box, on
// a no-stand block); v0.1.4.16 FX4 (review 16b, finding 1): and the stand cells, the cells of the ring the bot can stand on
// (ringCellStandable; the whole ring when the test leaves none), which the walk to the pen and the rounds walk to; review 16c
// (finding 2): never a cell inside another saved pen (a pen that shares the fence: its inside is no place to stand).
function ringOf(bot, pen, box, otherPens = []) {
    const get = blockReader(bot);
    const read = standReader(bot);
    const fenceBox = fenceBoxOf(get, box);
    const inside = { min: { x: fenceBox.min.x + 1, y: box.min.y, z: fenceBox.min.z + 1 }, max: { x: fenceBox.max.x - 1, y: box.max.y, z: fenceBox.max.z - 1 } };
    const gates = [...gatesOf(pen), ...(isBox(inside) ? findGates(get, inside) : [])];
    const ring = withoutGateCells(standRing(fenceBox), gates);
    // the ring's cells carry x and z only: a pen counts when its box overlaps the fence box's height (one block more either way)
    const inOtherPen = cell => otherPens.some(o => insideBoxXZ(o, cell) && o.min.y <= fenceBox.max.y + 1 && o.max.y >= fenceBox.min.y - 1);
    const stand = ring.filter(cell => !inOtherPen(cell) && ringCellStandable(read, fenceBox, cell));
    return {
        fenceBox,
        ring,
        stand: stand.length > 0 ? stand : ring,
        forbidden: node => insideBoxXZ(fenceBox, node) || isNoStandCell(get, node),
    };
}

const cellKey = c => `${c.x},${c.z}`;

// v0.1.4.16 FX4 (review 16b, finding 1): the bot near enough to the ring for the rounds, which walk along it by themselves:
// outside the fence box, within the height of the pen's box (one block more either way), and within nearRing blocks of the
// middle of a ring cell (x and z).
function nearRing(bot, w) {
    const p = botPos(bot);
    if (!p || insideBoxXZ(w.fenceBox, p) || p.y < w.fenceBox.min.y - 1 || p.y > w.fenceBox.max.y + 1) {
        return false;
    }
    return w.ring.some(c => Math.hypot(c.x + 0.5 - p.x, c.z + 0.5 - p.z) <= BREED_RULES.nearRing);
}

// v0.1.4.16 FX4 (review 16b, finding 1): the pen lies inside the building the bot could not leave (a barn around the pen): the
// building leaveBuilding names, else the saved building with walls the bot stands in (not the pen); the pen's fence box within
// its box in x and z, and the two boxes overlapping in height.
function penInBuilding(bot, ctx, out, w, pen) {
    const pos = botPos(bot);
    const building = isBox(out?.area) ? out.area
        : (pos ? listAreas(ctx, dimensionOf(bot)).find(a => hasWalls(a) && normalizeName(a.name) !== normalizeName(pen?.name) && containsPos(a, pos)) ?? null : null);
    if (!building) {
        return false;
    }
    const f = w.fenceBox;
    return f.min.x >= building.min.x && f.max.x <= building.max.x && f.min.z >= building.min.z && f.max.z <= building.max.z
        && f.min.y <= building.max.y && f.max.y >= building.min.y;
}

// True when the bot stands on a cell of the ring.
function onRing(bot, w) {
    const p = botPos(bot);
    if (!p || insideBoxXZ(w.fenceBox, p)) {
        return false;
    }
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    return w.ring.some(c => c.x === x && c.z === z);
}

// Walks to a stand cell of the ring (w: ringOf): never into the pen, never onto the fence. { at: true } when the bot stands
// on the cell; { interrupted: true } on the owner's stop.
async function walkToCell(bot, cell, w, movements, timeoutMs, clock) {
    const goal = goalAvoiding(new goals.GoalXZ(cell.x, cell.z), w.forbidden);
    const r = await gotoGoal(bot, goal, { movements, timeoutMs, clock });
    if (r.reason === 'interrupted' || bot.interrupt_code) {
        return { at: false, interrupted: true };
    }
    const p = botPos(bot);
    return { at: Boolean(p) && Math.floor(p.x) === cell.x && Math.floor(p.z) === cell.z && !insideBoxXZ(w.fenceBox, p), interrupted: false };
}

// v0.1.4.16 fix round (V-6): to the pen, before its animals are read. Out of the building the bot stands in first, through its
// door (ctx.home.leaveBuilding of the home pack, which does nothing outside every building: the farming pack's prepare since
// F4); then to the ring cell nearest the bot (the next nearest when it cannot be reached, approachTries in all), the path search
// allowed to open doors (a door is no pen gate: the pen guard keeps every gate of a pen shut by itself, and the pen costs the
// keep-out price) and never into the pen's box (the goal refuses the fence box). { ok, reason }: reasons interrupted, unreached.
// v0.1.4.16 FX4 (review 16b, finding 1): a building that cannot be left is no refusal when the pen lies inside it (a barn around
// the pen); the cells tried are the stand cells of the ring (w.stand: the cells the bot can stand on), by distance, up to
// approachTries (6) walks; when the last of them failed and the bot ends within nearRing (3) blocks of the ring, it goes on to
// the rounds (they walk to their stand cells by themselves). The cells whose walk failed go into `failed` (keys "x,z"): the
// rounds do not take them for stand cells.
async function approachPen(bot, ctx, w, areas, clock, options, pen, failed = new Set()) {
    const leave = ctx?.home?.leaveBuilding;
    if (typeof leave === 'function') {
        let out = null;
        try {
            out = await leave(bot, ctx, clockOptions(options));
        } catch (err) {
            console.warn('Breeding pack: could not leave the building:', err?.message ?? err);
            out = { ok: false, reason: 'error' };
        }
        if (bot.interrupt_code || out?.reason === 'interrupted') {
            return { ok: false, reason: 'interrupted' };
        }
        if (out && typeof out === 'object' && out.ok !== true && !penInBuilding(bot, ctx, out, w, pen)) {
            return { ok: false, reason: 'unreached' };
        }
    }
    if (onRing(bot, w)) {
        return { ok: true, reason: null };
    }
    let movements = null;
    try {
        movements = makeMovements(bot, { dig: false, doors: true, areas });
    } catch (err) {
        console.warn('Breeding pack: could not make the movements:', err?.message ?? err);
    }
    const me = botPos(bot);
    const cells = w.stand.map(c => ({ c, d: me ? Math.hypot(c.x + 0.5 - me.x, c.z + 0.5 - me.z) : 0 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, BREED_RULES.approachTries);
    for (const { c, d } of cells) {
        const timeoutMs = Math.max(BREED_RULES.walkMs, Math.ceil(d) * BREED_RULES.approachMsPerBlock);
        const r = await walkToCell(bot, c, w, movements, timeoutMs, clock);
        if (r.interrupted) {
            return { ok: false, reason: 'interrupted' };
        }
        if (r.at) {
            return { ok: true, reason: null };
        }
        failed.add(cellKey(c));
    }
    // every walk failed: near the ring the rounds walk along it by themselves
    return cells.length > 0 && nearRing(bot, w) ? { ok: true, reason: null } : { ok: false, reason: 'unreached' };
}

// --- the session of one order ---

function stopped(s) {
    if (s.stop === null && s.bot.interrupt_code) {
        s.stop = 'interrupted';
    }
    return s.stop !== null;
}

// The young of the species that appeared in the box since the start (by entity id), counted so far; the time a new one was
// first seen is the start of its parents' cooldown.
function babies(s) {
    for (const baby of newBabies(s.bot.entities, s.box, s.species, s.known)) {
        if (!s.babyIds.has(baby.id)) {
            s.babyIds.add(baby.id);
            s.lastBirthAt = s.clock.now();
        }
    }
    return s.babyIds.size;
}

// The options of the adults the pack may feed now: the animals of the start, not fed within the cooldown, not skipped.
function feedOptions(s, skip) {
    return { fedAt: s.fedAt, now: s.clock.now(), cooldownMs: BREED_RULES.cooldownMs, only: s.known, skip, reach: BREED_RULES.reach };
}

// Waits up to `ms` and returns at once on a stop; in steps of at most STOP_CHECK_MS.
async function pause(s, ms) {
    const until = s.clock.now() + ms;
    while (!stopped(s) && s.clock.now() < until) {
        await s.clock.wait(Math.max(1, Math.min(BREED_RULES.stopCheckMs, until - s.clock.now())));
    }
}

// Walks along the ring to a stand cell, doors off: never into the pen, never onto the fence. True when the bot stands on the cell.
async function walkTo(s, cell) {
    const r = await walkToCell(s.bot, cell, s, s.movements, BREED_RULES.walkMs, s.clock);
    if (r.interrupted) {
        s.stop = 'interrupted';
        return false;
    }
    return r.at;
}

// Waits up to comeMs for `n` adults within reach that may be fed; the nearest first (fewer when they did not come).
async function waitForAdults(s, skip, n) {
    const start = s.clock.now();
    for (;;) {
        const list = adultsInReach(s.bot.entities, s.box, s.species, eyesOf(botPos(s.bot)), feedOptions(s, skip));
        if (list.length >= n || stopped(s) || s.clock.now() - start >= BREED_RULES.comeMs) {
            return list;
        }
        await s.clock.wait(BREED_RULES.pollMs);
    }
}

// Clicks an adult with the feed in hand; the feed counts as given when it left the bag within feedMs.
async function feedOne(s, entity) {
    const before = bagCount(s.bot, s.feed);
    try {
        await s.bot.activateEntity(entity);
    } catch (err) {
        console.warn('Breeding pack: the feed click failed:', err?.message ?? err);
        return false;
    }
    const start = s.clock.now();
    while (bagCount(s.bot, s.feed) >= before && s.clock.now() - start < BREED_RULES.feedMs) {
        await s.clock.wait(100);
    }
    if (bagCount(s.bot, s.feed) < before) {
        s.fedAt.set(entity.id, s.clock.now());
        s.lastFeedAt = s.clock.now();
        return true;
    }
    return false;
}

// One feed counted: the line of a pair at every second one.
function noteFed(s) {
    s.fed++;
    if (s.fed % 2 === 0) {
        sayTo(s.bot, s.ctx, fedText(2, s.species, s.pen.name));
    }
}

// Feeds the pairs that come within reach of the cell the bot stands on. Returns the feeds given.
async function feedAtCell(s, skip, wanted) {
    let given = 0;
    for (;;) {
        // one adult completes a pair whose first one is fed already, else two make one
        const n = s.fed % 2 === 1 ? 1 : 2;
        if (stopped(s) || given >= wanted || bagCount(s.bot, s.feed) < n) {
            return given;
        }
        const near = await waitForAdults(s, skip, n);
        if (stopped(s) || near.length < n) {
            return given;
        }
        for (const adult of near.slice(0, n)) {
            if (await feedOne(s, adult)) {
                noteFed(s);
                given++;
            } else {
                skip.add(adult.id); // in love or in the game's cooldown already: the feed stayed in the bag
            }
        }
        babies(s);
    }
}

// One round: from stand cell to stand cell, each the ring cell nearest to the next adult that may be fed, until the pairs of
// the round are fed, the feed is out, or no adult is left to try. Returns the feeds given in the round.
async function feedRound(s) {
    const wanted = 2 * Math.max(0, s.target - babies(s)) - (s.fed % 2);
    const skip = new Set();
    const tried = new Set();
    let given = 0;
    while (!stopped(s) && given < wanted && bagCount(s.bot, s.feed) >= 1) {
        const open = feedableAdults(s.bot.entities, s.box, s.species, feedOptions(s, skip));
        if (open.length < (s.fed % 2 === 1 ? 1 : 2)) {
            break;
        }
        const me = botPos(s.bot);
        const next = open.map(e => ({ e, d: me ? Math.hypot(e.position.x - me.x, e.position.z - me.z) : 0 })).sort((a, b) => a.d - b.d)[0].e;
        const cell = nearestRingCell(s.ring, next.position);
        const key = cell ? `${cell.x},${cell.z}` : null;
        if (key === null || tried.has(key)) {
            skip.add(next.id); // its stand cell was tried: out of reach from outside the fence this round
            continue;
        }
        tried.add(key);
        if (!(await walkTo(s, cell))) {
            if (stopped(s)) {
                break;
            }
            s.walkFailed++;
            skip.add(next.id);
            continue;
        }
        s.reached++;
        if (!(await equipFeed(s.bot, s.feed))) {
            break;
        }
        given += await feedAtCell(s, skip, wanted - given);
        if (!s.fedAt.has(next.id)) {
            skip.add(next.id); // it did not come to its stand cell
        }
    }
    return given;
}

// After feeds: waits up to babyWaitMs for the young of the pairs fed (two in love find each other within seconds).
async function waitForYoung(s) {
    const expected = Math.min(s.target, Math.floor(s.fed / 2));
    const until = s.clock.now() + BREED_RULES.babyWaitMs;
    while (!stopped(s) && babies(s) < expected && s.clock.now() < until) {
        await s.clock.wait(Math.max(1, Math.min(BREED_RULES.stopCheckMs, until - s.clock.now())));
    }
}

// Waits the game's cooldown: from the last birth (the game starts it there), else the last feed, plus the margin; the young are
// counted every checkMs and end the wait when all are there; the stop is looked at every stopCheckMs.
async function waitCooldown(s) {
    const from = Math.max(s.lastFeedAt ?? -Infinity, s.lastBirthAt ?? -Infinity);
    const until = (Number.isFinite(from) ? from : s.clock.now()) + BREED_RULES.cooldownMs + BREED_RULES.marginMs;
    let nextCount = s.clock.now() + BREED_RULES.checkMs;
    while (!stopped(s) && s.clock.now() < until) {
        if (s.clock.now() >= nextCount) {
            nextCount += BREED_RULES.checkMs;
            if (babies(s) >= s.target) {
                return;
            }
        }
        await pause(s, Math.min(BREED_RULES.checkMs, until - s.clock.now(), nextCount - s.clock.now()));
    }
}

/**
 * !breed(pen, count): feeds pairs of the animals of a saved pen from outside its fence until `count` new animals (8.2).
 * @param {object} bot
 * @param {object} ctx the pack context: areas, log, say, now, chests, storage, permits
 * @param {string} penName the saved pen (the owner's or the survey's)
 * @param {number} [count] the new animals wanted, 2 without one
 * @param {{now?: Function, wait?: Function, askMs?: number}} [options] for tests
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, fed: number, babies: number, species?: string, pen?: string}>}
 *   reasons: null, unknown_pen, no_animals, unknown_species, full, no_permit, no_feed, no_way, unreached, interrupted
 */
export async function breed(bot, ctx, penName, count = BREED_RULES.defaultCount, options = {}) {
    const clock = clockOf(ctx, options);
    const refuse = (reason, text, extra = {}) => {
        logTo(ctx, text);
        return { ok: false, reason, text, fed: 0, babies: 0, ...extra };
    };
    const pen = findPen(ctx, penName);
    if (!pen) {
        return refuse('unknown_pen', unknownPenText(penName));
    }
    const box = { min: { ...pen.min }, max: { ...pen.max } };
    const about = species => (species ? { species, pen: pen.name } : { pen: pen.name });
    const feedRefused = (got, species) => (got.refusal[0] === 'interrupted'
        ? refuse('interrupted', stoppedText(pen.name, 0, species, 0), about(species))
        : refuse(got.refusal[0], got.refusal[1], about(species)));
    // the ring one block outside the fence, without the gates and the cells before them
    const saved = speciesOf(pen.contents);
    // review 16c (finding 2): the other saved pens, whose inside the ring's stand cells leave out
    const otherPens = listAreas(ctx, dimensionOf(bot))
        .filter(a => a && (a.type === 'pen' || a.kind === 'pen') && isBox(a) && normalizeName(a.name) !== normalizeName(pen.name));
    let w = ringOf(bot, pen, box, otherPens);
    if (w.ring.length === 0) {
        return refuse('no_way', noWayText(pen.name), about(saved));
    }
    // v0.1.4.16 fix round (V-6): the feed made ready here, where the order finds the bot (8.1 asks the chests within 48 blocks
    // of it), for the animals the pen was saved with: two per pair, from the bag, else the chests with the owner's permit, the
    // low mark two rounds. The animals themselves are read at the ring.
    let feed = null;
    const savedRoom = BREED_RULES.cap - animalCount(pen.contents);
    if (saved && feedOf(saved) && savedRoom > 0) {
        const got = await getFeed(bot, ctx, saved, Math.min(cleanCount(count), savedRoom), options);
        if (got.refusal) {
            return feedRefused(got, saved);
        }
        feed = got.feed;
    }
    // to the pen: out of the building through its door, to the ring cell nearest the bot with doors allowed; the walks along
    // the ring keep doors off. The no_enter areas of the world count (F10); the pen itself is one.
    const areas = [...listAreas(ctx, dimensionOf(bot)).filter(a => normalizeName(a.name) !== normalizeName(pen.name)),
        { ...pen, flags: { ...(pen.flags ?? {}), no_enter: true } }];
    const failed = new Set(); // v0.1.4.16 FX4 (review 16b, finding 1): the ring cells the walk to the pen could not reach
    const toPen = async (species) => {
        const r = await approachPen(bot, ctx, w, areas, clock, options, pen, failed);
        if (r.ok) {
            return null;
        }
        return r.reason === 'interrupted'
            ? refuse('interrupted', stoppedText(pen.name, 0, species ?? 'animal', 0), about(species))
            : refuse('unreached', unreachedText(pen.name), about(species));
    };
    const away = await toPen(saved);
    if (away) {
        return away;
    }
    // at the ring: the ring as the blocks near it show it, and the animals of the pen as the bot sees them now
    w = ringOf(bot, pen, box, otherPens);
    if (w.ring.length === 0) {
        return refuse('no_way', noWayText(pen.name), about(saved));
    }
    const live = liveCount(bot, box);
    const species = speciesOf(live) ?? saved;
    if (!species) {
        return refuse('no_animals', noAnimalsText(pen.name), { pen: pen.name });
    }
    const feeds = feedOf(species);
    if (!feeds) {
        return refuse('unknown_species', unknownSpeciesText(species), { species, pen: pen.name });
    }
    const animals = animalCount(live);
    if (animals >= BREED_RULES.cap) {
        return refuse('full', penFullText(pen.name, animals), { species, pen: pen.name });
    }
    const target = Math.min(cleanCount(count), BREED_RULES.cap - animals);
    // no feed made ready, or not the feed of the animals found: from the bag, else the chests near the pen; after a walk to a
    // chest, back to the ring
    if (feed === null || !feeds.includes(feed)) {
        const got = await getFeed(bot, ctx, species, target, options);
        if (got.refusal) {
            return feedRefused(got, species);
        }
        feed = got.feed;
        if (!onRing(bot, w)) {
            const back = await toPen(species);
            if (back) {
                return back;
            }
        }
    }
    let movements = null;
    try {
        movements = makeMovements(bot, { dig: false, doors: false, areas });
    } catch (err) {
        console.warn('Breeding pack: could not make the movements:', err?.message ?? err);
    }
    // v0.1.4.16 FX4 (review 16b, finding 1): the rounds stand on the stand cells of the ring (the cells the bot can stand on),
    // without those the walk to the pen could not reach (all of them when none is left)
    const reachable = w.stand.filter(c => !failed.has(cellKey(c)));
    const s = {
        bot, ctx, clock, pen, box, fenceBox: w.fenceBox, species, feed, target, ring: reachable.length > 0 ? reachable : w.stand, movements, forbidden: w.forbidden,
        fed: 0, fedAt: new Map(), lastFeedAt: null, lastBirthAt: null, known: new Set(animalsIn(bot.entities, box, species).map(e => e.id)), babyIds: new Set(),
        stop: null, reached: 0, walkFailed: 0,
    };
    for (let round = 0; !stopped(s); round++) {
        const given = await feedRound(s);
        if (stopped(s)) {
            break;
        }
        if (s.fed === 0 && s.reached === 0 && s.walkFailed > 0) {
            return refuse('no_way', noWayText(pen.name), { species, pen: pen.name });
        }
        if (given > 0) {
            await waitForYoung(s);
        }
        if (stopped(s) || babies(s) >= s.target || given === 0 || round >= BREED_RULES.extraRounds || bagCount(bot, feed) < 2) {
            break;
        }
        await waitCooldown(s);
    }
    const young = babies(s);
    if (s.stop === 'interrupted') {
        const text = stoppedText(pen.name, s.fed, species, young);
        logTo(ctx, text);
        return { ok: false, reason: 'interrupted', text, fed: s.fed, babies: young, species, pen: pen.name };
    }
    return { ok: true, reason: null, text: endText(s.fed, species, pen.name, young), fed: s.fed, babies: young, species, pen: pen.name };
}
