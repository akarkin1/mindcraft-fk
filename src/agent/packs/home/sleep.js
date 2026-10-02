// Sleeping in a bed (spec v0.1.4.6 H4, v0.1.4.8 C6).
import { Vec3 } from 'vec3';
import { containsPos } from './box_math.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo, noteProgress, pauseMode } from './context.js';
import { walkNear } from './motion.js';
import { goToShelter } from './shelter.js';
import { isBuildingArea, isInsideArea } from './shelter_logic.js';
import { isBedName, minutesUntilNight, orderBeds, sleepErrorKind, sleepTimeState } from './sleep_logic.js';
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
        const beds = findBeds(bot, 32);
        if (beds.length === 0) {
            return { ok: false, reason: 'no_bed', text: TEXTS.noBed };
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
            const area = areas.find(a => containsPos(a, { x: bed.x + 0.5, y: bed.y, z: bed.z + 0.5 }));
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
