// Sleeping in a bed (spec v0.1.4.6 H4, v0.1.4.8 C6).
// v0.1.4.16 (F6, R-8: !goToBed by the trading hall chose the villagers' beds): the bot's own bed first (the saved place
// my_bed, the foot of the bed it slept in last), then a bed in a home or a shelter the owner saved, then the rest by
// distance; a bed in a trading hall, within 8 blocks of a villager's job site or of a villager is a villager's and never a
// candidate.
import { Vec3 } from 'vec3';
import { areaType, isShelterArea } from './area_kinds.js';
import { containsPos } from './box_math.js';
import { botPos, clockOf, dimensionOf, entitiesWhere, listAreas, logTo, noteProgress, pauseMode } from './context.js';
import { blockReader, walkNear } from './motion.js';
import { goToShelter } from './shelter.js';
import { isBuildingArea, isInsideArea, withEdge } from './shelter_logic.js';
import { BED_RULES, JOB_SITE_NAMES, MY_BED, bedFoot, isBedName, isMyBed, minutesUntilNight, orderBeds, sleepErrorKind, sleepTimeState } from './sleep_logic.js';
import { TEXTS, couldNotSleepText, dayText } from './texts.js';
import { wakeUp } from './wake.js';

/** The bot lies in bed at most this long; on a server where the night does not pass it gets up. */
export const MAX_SLEEP_MS = 10 * 60 * 1000;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function thunderNow(bot) {
    return bot.isRaining === true && isFiniteNumber(bot.thunderState) && bot.thunderState > 0;
}

/**
 * The beds within range, one entry per bed (the head part), nearest first, as
 * { x, y, z, name, part, facing, occupied }. `bedrock` is no bed. Never throws.
 * @param {object} bot
 * @param {number} [range]
 * @returns {object[]}
 */
export function findBeds(bot, range = 32) {
    try {
        const positions = bot.findBlocks({ matching: b => Boolean(b) && isBedName(b.name), maxDistance: range, count: 32 });
        const beds = positions.map(p => {
            const block = bot.blockAt(p);
            const props = typeof block?.getProperties === 'function' ? block.getProperties() : (block?._properties ?? {});
            return { x: p.x, y: p.y, z: p.z, name: block?.name, part: props.part, facing: props.facing, occupied: props.occupied === true };
        }).filter(b => isBedName(b.name));
        return orderBeds(beds, botPos(bot));
    } catch {
        return [];
    }
}

// ---- the bot's own bed and the villagers' beds (v0.1.4.16, F6) ----

// The place `my_bed` from ctx.places (a PlaceStore: recall; a MemoryBank: recallPlaceInfo), or null. Never throws.
function recallMyBed(ctx) {
    const places = ctx?.places;
    try {
        for (const fn of ['recall', 'recallPlaceInfo']) {
            if (typeof places?.[fn] === 'function') {
                const p = places[fn](MY_BED);
                if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
                    return { x: p.x, y: p.y, z: p.z, dimension: p.dimension ?? null };
                }
                return null;
            }
        }
    } catch (err) {
        console.warn('Home pack: could not read the place my_bed:', err?.message ?? err);
    }
    return null;
}

// Saves the foot of the bed as the place `my_bed` (a PlaceStore: remember; a MemoryBank: rememberPlace); a later
// sleep in another bed moves it. Never throws.
function rememberMyBed(ctx, bed, dimension) {
    const foot = bedFoot(bed);
    const places = ctx?.places;
    if (!foot || !places) {
        return false;
    }
    try {
        if (typeof places.remember === 'function') {
            places.remember(MY_BED, foot.x, foot.y, foot.z, dimension ?? null);
            return true;
        }
        if (typeof places.rememberPlace === 'function') {
            return places.rememberPlace(MY_BED, foot.x, foot.y, foot.z, dimension ?? null) !== false;
        }
    } catch (err) {
        console.warn('Home pack: could not save the place my_bed:', err?.message ?? err);
    }
    return false;
}

// The saved places as { name, x, y, z } (a PlaceStore: list; a MemoryBank: getJson). Never throws.
function listPlaces(ctx) {
    const places = ctx?.places;
    try {
        if (typeof places?.list === 'function') {
            return places.list().filter(p => p && typeof p.name === 'string' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
        }
        if (typeof places?.getJson === 'function') {
            return Object.entries(places.getJson() ?? {})
                .filter(([, p]) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite))
                .map(([name, p]) => ({ name, x: p[0], y: p[1], z: p[2] }));
        }
    } catch (err) {
        console.warn('Home pack: could not list the places:', err?.message ?? err);
    }
    return [];
}

const HALL_NAME = /^trading_hall(_\d+)?$/;

// An area of the villagers' trading hall: the kind or the name trading_hall (the survey names the building so).
function isHallArea(area) {
    return area?.kind === 'trading_hall' || (typeof area?.name === 'string' && HALL_NAME.test(area.name));
}

// A home, or a shelter the owner saved (the survey's `home` counts, its other shelters do not).
function isHomeArea(area) {
    return areaType(area) === 'home' || (isShelterArea(area) && area.source !== 'survey');
}

// Why a bed is a villager's (F6): 'hall' inside a trading hall area or within 8 blocks of a trading hall place, 'job' within
// 8 blocks of a job-site block, 'villager' within 8 blocks of a villager; null for a bed the bot may use. Never throws.
// v0.1.4.16 (SPEC F6 corrected, T4's W126 run: the house's bed 7.3 blocks from the trading hall's lectern was a villager's and
// the bot never slept): the box of a trading hall area counts for every bed; the rules of nearness (a trading hall place, a job
// site, a villager within 8 blocks) only for a bed that is not `my_bed` and lies in no home and no shelter the owner saved
// (`own`). The houses of a village are buildings: their beds keep every rule.
function bedExclusion(bot, bed, center, areas, places, own = false) {
    try {
        if (areas.some(a => isHallArea(a) && containsPos(a, center))) {
            return 'hall';
        }
        if (own) {
            return null;
        }
        const near = (p, range) => Math.hypot(p.x + 0.5 - center.x, p.y - center.y, p.z + 0.5 - center.z) <= range;
        if (places.some(p => HALL_NAME.test(p.name) && near(p, BED_RULES.jobRange))) {
            return 'hall';
        }
        const jobs = bot.findBlocks({ matching: b => Boolean(b) && JOB_SITE_NAMES.includes(b.name), maxDistance: BED_RULES.jobRange, count: 1,
            point: new Vec3(bed.x, bed.y, bed.z) });
        if (Array.isArray(jobs) && jobs.length > 0) {
            return 'job';
        }
        if (entitiesWhere(bot, BED_RULES.villagerRange, e => e?.name === 'villager', center).length > 0) {
            return 'villager';
        }
    } catch (err) {
        console.warn('Home pack: could not look at the bed:', err?.message ?? err);
    }
    return null;
}

/**
 * The beds the bot may sleep in (v0.1.4.16, F6), in the order of orderBeds: its own bed (the place `my_bed`) first,
 * then the beds in a home or a shelter the owner saved, then the rest by distance; the villagers' beds (bedExclusion)
 * are left out and counted in `excluded`. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {number} [range]
 * @returns {{beds: object[], excluded: number}}
 */
export function candidateBeds(bot, ctx, range = 32) {
    try {
        const dimension = dimensionOf(bot);
        const areas = listAreas(ctx, dimension);
        const places = listPlaces(ctx);
        const myBed = recallMyBed(ctx);
        const all = findBeds(bot, range).map(bed => {
            const center = { x: bed.x + 0.5, y: bed.y, z: bed.z + 0.5 };
            const inHome = areas.some(a => isHomeArea(a) && containsPos(a, center));
            // the own bed and a home's bed keep only the trading hall's box (SPEC F6 corrected)
            const excluded = bedExclusion(bot, bed, center, areas, places, inHome || isMyBed(bed, myBed, dimension));
            return { ...bed, home: excluded === null && inHome, excluded };
        });
        return { beds: orderBeds(all, botPos(bot), { myBed, dimension }), excluded: all.filter(b => b.excluded).length };
    } catch (err) {
        console.warn('Home pack: could not choose a bed:', err?.message ?? err);
        return { beds: [], excluded: 0 };
    }
}

async function waitForSleepTime(bot, clock, ms) {
    const start = clock.now();
    while (clock.now() - start < ms) {
        if (bot.interrupt_code) {
            return false;
        }
        if (sleepTimeState({ timeOfDay: bot.time?.timeOfDay, thunder: thunderNow(bot) }) === 'now') {
            return true;
        }
        noteProgress(bot, 'sleep'); // waiting at the bed is no being stuck
        await clock.wait(500);
    }
    return sleepTimeState({ timeOfDay: bot.time?.timeOfDay, thunder: thunderNow(bot) }) === 'now';
}

async function sleepCall(bot, block, clock) {
    let settled = null;
    Promise.resolve().then(() => bot.sleep(block)).then(() => { settled = { ok: true }; }, err => { settled = { ok: false, err }; });
    const start = clock.now();
    while (settled === null && clock.now() - start < 10000) {
        await clock.wait(25);
    }
    return settled ?? { ok: false, err: new Error('bot is not sleeping') };
}

function isMorning(timeOfDay) {
    const t = ((timeOfDay % 24000) + 24000) % 24000;
    return t < 12000 || t >= 23000;
}

/**
 * Sleeps in the nearest free bed within 32 blocks until the morning. A bed inside a building area is
 * entered through goToShelter first when the bot is outside. After sunset but before mineflayer
 * lets it sleep (12541) it waits at the bed up to 40 s. The mode `unstuck` is paused from the start
 * (v0.1.4.8, C6). Texts of the spec: `I slept. It is morning.`, `I cannot sleep now, it is day. The
 * night starts in about N minutes.` (by day), `I cannot sleep now, it is not night.`, `I found no bed
 * nearby.`, `I cannot sleep, monsters are nearby.`, `All beds nearby are taken.`, `I could not sleep:
 * <error text>`. Never throws.
 * v0.1.4.16 (F6): the beds in the order of candidateBeds (the own bed, then a home's, then by distance; the villagers'
 * beds left out). When every bed within 32 blocks is a villager's: `The beds nearby are the villagers'; I found no bed
 * of mine.`; `All beds nearby are taken.` only when a candidate bed was occupied. Once the bot lies in a bed, its foot
 * is saved as the place `my_bed` through ctx.places; a later sleep in another bed moves it.
 * @param {object} bot
 * @param {object} ctx
 * @param {{maxSleepMs?: number, now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, text: string}>}
 */
export async function sleepInBed(bot, ctx = {}, options = {}) {
    try {
        const clock = clockOf(ctx, options);
        pauseMode(bot, 'unstuck'); // C6: the walk to the bed and the wait there are no being stuck
        noteProgress(bot, 'sleep');
        if (sleepTimeState({ timeOfDay: bot.time?.timeOfDay, thunder: thunderNow(bot) }) === 'no') {
            const minutes = minutesUntilNight(bot.time?.timeOfDay);
            return { ok: false, reason: 'not_night', text: minutes === null ? TEXTS.notNight : dayText(minutes) };
        }
        const { beds, excluded } = candidateBeds(bot, ctx, 32);
        if (beds.length === 0) {
            // F6: every bed within 32 blocks is a villager's, or there is none
            return excluded > 0 ? { ok: false, reason: 'villagers', text: TEXTS.villagersBeds } : { ok: false, reason: 'no_bed', text: TEXTS.noBed };
        }
        const areas = listAreas(ctx, dimensionOf(bot)).filter(isBuildingArea);
        let taken = 0;
        let lastFailure = null;
        let routeFailure = null; // v0.1.4.9 (I5): the text of a learned route that failed
        for (const bed of beds.slice(0, 5)) {
            if (bot.interrupt_code) {
                return { ok: false, reason: 'interrupted', text: 'I stopped going to bed.' };
            }
            if (bed.occupied) {
                taken++;
                continue;
            }
            // v0.1.4.15 (Q-1): the area with the kind of its edge (withEdge): a bot in the floor row by the wall of its house is
            // inside, and never sent out through its own door to "get into the shelter"
            const area = withEdge(areas.find(a => containsPos(a, { x: bed.x + 0.5, y: bed.y, z: bed.z + 0.5 })), blockReader(bot));
            if (area && !isInsideArea(area, botPos(bot))) {
                const entered = await goToShelter(bot, ctx, { ...options, area });
                if (!entered.ok) {
                    return { ok: false, reason: entered.reason ?? 'shelter', text: entered.text };
                }
            }
            // v0.1.4.11 (I7, the lead for part N): with routes_by_search a learned route to the bed goes first
            let walk = null;
            if (ctx?.routes?.bySearch?.() && ctx.routes.routeFor?.(bed)) {
                const first = await ctx.routes.walkTo(bot, bed, { clock });
                if (first?.reason === 'interrupted') {
                    return { ok: false, reason: 'interrupted', text: first.text };
                }
                if (first?.ok) {
                    walk = { ok: true };
                } else if (first && first.reason !== 'no_route') {
                    routeFailure = first.text;
                    lastFailure = 'I found no way to the bed.';
                    continue;
                }
            }
            if (!walk) {
                walk = await walkNear(bot, bed, 1, { clock, timeoutMs: 20000, allowDoors: !area });
            }
            if (!walk.ok) {
                if (walk.reason === 'interrupted') {
                    return { ok: false, reason: 'interrupted', text: 'I stopped going to bed.' };
                }
                // v0.1.4.9 (I5): a learned route where the path search finds no way
                const viaRoute = await ctx?.routes?.walkTo?.(bot, bed, { clock });
                if (viaRoute?.reason === 'interrupted') {
                    return { ok: false, reason: 'interrupted', text: viaRoute.text };
                }
                if (!viaRoute?.ok) {
                    routeFailure = viaRoute && viaRoute.reason !== 'no_route' ? viaRoute.text : routeFailure;
                    lastFailure = 'I found no way to the bed.';
                    continue;
                }
            }
            if (!(await waitForSleepTime(bot, clock, 40000))) {
                if (bot.interrupt_code) {
                    return { ok: false, reason: 'interrupted', text: 'I stopped going to bed.' };
                }
                return { ok: false, reason: 'not_night', text: TEXTS.notNight };
            }
            const block = bot.blockAt(new Vec3(bed.x, bed.y, bed.z));
            if (!block || !isBedName(block.name)) {
                continue;
            }
            const res = await sleepCall(bot, block, clock);
            if (!res.ok) {
                const kind = sleepErrorKind(res.err);
                if (kind === 'occupied') {
                    taken++;
                    continue;
                }
                if (kind === 'monsters') {
                    return { ok: false, reason: 'monsters', text: TEXTS.monstersNearBed };
                }
                if (kind === 'not_night') {
                    return { ok: false, reason: 'not_night', text: TEXTS.notNight };
                }
                return { ok: false, reason: 'error', text: couldNotSleepText(res.err) };
            }
            logTo(ctx, 'I am in bed.');
            rememberMyBed(ctx, bed, dimensionOf(bot)); // F6: this bed is the bot's own from now on
            pauseMode(bot, 'unstuck');
            const start = clock.now();
            const limit = isFiniteNumber(options.maxSleepMs) ? options.maxSleepMs : MAX_SLEEP_MS;
            while (bot.isSleeping) {
                if (bot.interrupt_code || clock.now() - start > limit) {
                    // X5: it says that it got up only when bot.isSleeping is false (wakeUp checks it)
                    const up = await wakeUp(bot, ctx, { now: options.now, wait: options.wait });
                    if (bot.interrupt_code) {
                        return up.ok
                            ? { ok: false, reason: 'interrupted', text: 'I got up before the morning.' }
                            : { ok: false, reason: 'interrupted', text: `I was stopped in bed. ${up.text}` };
                    }
                    return up.ok
                        ? { ok: false, reason: 'timeout', text: 'I lay in bed for a long time, but the night did not pass.' }
                        : { ok: false, reason: 'still_sleeping', text: `I lay in bed for a long time, but the night did not pass. ${up.text}` };
                }
                await clock.wait(500);
            }
            // The server sends the new time about once a second, after the wake up.
            const woke = clock.now();
            while (!isMorning(bot.time?.timeOfDay) && clock.now() - woke < 3000 && !bot.interrupt_code) {
                await clock.wait(100);
            }
            if (isMorning(bot.time?.timeOfDay)) {
                return { ok: true, reason: null, text: TEXTS.slept };
            }
            return { ok: false, reason: 'woke_up', text: 'I woke up before the morning.' };
        }
        if (lastFailure) {
            return { ok: false, reason: 'no_path', text: routeFailure ?? couldNotSleepText(lastFailure) };
        }
        return { ok: false, reason: taken > 0 ? 'taken' : 'no_bed', text: taken > 0 ? TEXTS.bedsTaken : TEXTS.noBed };
    } catch (err) {
        console.warn('Home pack: sleeping failed:', err?.message ?? err);
        return { ok: false, reason: 'error', text: couldNotSleepText(err) };
    }
}
