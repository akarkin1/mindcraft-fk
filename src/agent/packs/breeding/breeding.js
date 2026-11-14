// The work of the breeding pack (spec v0.1.4.16, 8.2, E6): !breed(pen, count). The decisions come from breeding_logic.js;
// this module reads the pen and its animals, gets the feed (the bag, else takeOrAsk of 8.1), walks the ring one block
// outside the fence, equips the feed, clicks the animals (bot.activateEntity, which the pen guard does not wrap: feeding
// over the fence is allowed by construction) and counts the young. The bot never enters the pen's box (the walk cannot
// open doors or gates, the pen's cells cost the path search the keep-out price, a goal inside the fence box is refused, and
// no stand cell lies inside), never clicks a gate, and places nothing. The pack runs as an action, so the item reflex is off
// meanwhile.
//
// A round: the stand cell is the ring cell nearest to the nearest adult that may be fed; there the bot holds the feed and
// waits up to 10 s for two adults within reach, feeds them (a pair), and goes on while pairs come; an adult that did not come
// to its nearest cell is skipped for the round, and the next stand cell is the one of the next adult. Rounds repeat after
// the game's cooldown, at most two more, until `count` young are born.
//
// ctx: { areas, log, say, now, chests?, storage?, permits? } of the pack context. options { now, wait, askMs } for tests.
import { countContents } from '../../areas/area_sense.js';
import { isBox } from '../home/box_math.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo, sayTo } from '../home/context.js';
import { blockReader, goals, gotoGoal, makeMovements } from '../home/motion.js';
import { goalAvoiding, isNoStandCell } from '../home/stand_logic.js';
import {
    BABY_WAIT_MS, BREED_COOLDOWN_MS, COME_WAIT_MS, COOLDOWN_CHECK_MS, COOLDOWN_MARGIN_MS, EXTRA_ROUNDS, FEED_REACH, PEN_CAP, STOP_CHECK_MS, adultsInReach, animalCount,
    animalsIn, cleanCount, eyesOf, feedNeeded, feedOf, feedableAdults, fenceBoxOf, findGates, gatesOf, insideBoxXZ, lowMark, nearestRingCell, newBabies,
    speciesOf, standRing, withoutGateCells,
} from './breeding_logic.js';
import { bagCount, chestsWith, takeOrAsk } from './stock_logic.js';
import {
    PURPOSES, endText, fedText, noAnimalsText, noFeedText, noWayText, penFullText, stoppedText, unknownPenText, unknownSpeciesText,
} from './texts.js';

/** The rules of the feeding: the cap, the reach, the cooldown and its checks, the waits, the rounds, the walks. */
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

// Walks to a stand cell of the ring: never into the pen, never onto the fence. True when the bot stands on the cell.
async function walkTo(s, cell) {
    const goal = goalAvoiding(new goals.GoalXZ(cell.x, cell.z), s.forbidden);
    const r = await gotoGoal(s.bot, goal, { movements: s.movements, timeoutMs: BREED_RULES.walkMs, clock: s.clock });
    if (r.reason === 'interrupted' || s.bot.interrupt_code) {
        s.stop = 'interrupted';
        return false;
    }
    const p = botPos(s.bot);
    return Boolean(p) && Math.floor(p.x) === cell.x && Math.floor(p.z) === cell.z && !insideBoxXZ(s.fenceBox, p);
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
 *   reasons: null, unknown_pen, no_animals, unknown_species, full, no_permit, no_feed, no_way, interrupted
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
    const live = liveCount(bot, box);
    const species = speciesOf(live) ?? speciesOf(pen.contents);
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
    // the feed: two per pair; from the bag, else the chests with the owner's permit (8.1), the low mark two rounds
    const feed = chooseFeed(bot, ctx, feeds);
    if (bagCount(bot, feed) < feedNeeded(target)) {
        const r = await takeOrAsk(bot, ctx, feed, feedNeeded(target), { low: lowMark(target), purpose: PURPOSES.feeding, now: options?.now, wait: options?.wait, askMs: options?.askMs });
        if (!r.ok) {
            if (r.reason === 'interrupted') {
                return refuse('interrupted', stoppedText(pen.name, 0, species, 0), { species, pen: pen.name });
            }
            if (r.reason === 'no_permit') {
                return refuse('no_permit', r.text, { species, pen: pen.name });
            }
            if (bagCount(bot, feed) < 2) {
                return refuse('no_feed', noFeedText(feed, species), { species, pen: pen.name });
            }
            logTo(ctx, r.text); // the bag feeds fewer pairs than ordered
        }
    }
    // the ring one block outside the fence, without the gates and the cells before them
    const get = blockReader(bot);
    const fenceBox = fenceBoxOf(get, box);
    const inside = { min: { x: fenceBox.min.x + 1, y: box.min.y, z: fenceBox.min.z + 1 }, max: { x: fenceBox.max.x - 1, y: box.max.y, z: fenceBox.max.z - 1 } };
    const gates = [...gatesOf(pen), ...(isBox(inside) ? findGates(get, inside) : [])];
    const ring = withoutGateCells(standRing(fenceBox), gates);
    if (ring.length === 0) {
        return refuse('no_way', noWayText(pen.name), { species, pen: pen.name });
    }
    let movements = null;
    try {
        movements = makeMovements(bot, { dig: false, doors: false, areas: [{ ...pen, flags: { ...(pen.flags ?? {}), no_enter: true } }] });
    } catch (err) {
        console.warn('Breeding pack: could not make the movements:', err?.message ?? err);
    }
    const s = {
        bot, ctx, clock, pen, box, fenceBox, species, feed, target, ring, movements,
        forbidden: node => insideBoxXZ(fenceBox, node) || isNoStandCell(get, node),
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
