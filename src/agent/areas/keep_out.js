// The walk of the mode item_collecting (spec v0.1.4.10, R1). It picks up the items near the bot as
// skills.pickupNearbyItems did, but every walk uses Movements whose exclusionAreasStep makes the fence
// gates and the pens, the farms and the no_enter areas that the bot is outside of too dear to enter, and
// an item inside such an area is never a target. Returns { ok, reason, text, picked } and never throws.
import pf from 'mineflayer-pathfinder';
import { keptOutBy, stepCostOf } from './keep_out_logic.js';

/** Items farther than this are not walked to (as pickupNearbyItems). */
export const PICK_RANGE = 8;
/** The most items of one call. */
export const PICK_MAX = 16;
/** One walk to an item ends after this many ms. */
export const WALK_LIMIT_MS = 15000;
const WATCH_MS = 250;
const SETTLE_MS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stopWalking(bot) {
    try {
        bot.pathfinder?.setGoal?.(null);
    } catch {
        // nothing to stop
    }
}

// One walk: 'arrived', 'interrupted', 'timeout' or 'failed'. The watch is always cleared.
function walk(bot, goal) {
    return new Promise((resolve) => {
        let done = false;
        let watch = null;
        const start = Date.now();
        const finish = (outcome) => {
            if (done) {
                return;
            }
            done = true;
            clearInterval(watch);
            resolve(outcome);
        };
        watch = setInterval(() => {
            if (bot.interrupt_code) {
                stopWalking(bot);
                finish('interrupted');
            } else if (Date.now() - start >= WALK_LIMIT_MS) {
                stopWalking(bot);
                finish('timeout');
            }
        }, WATCH_MS);
        try {
            Promise.resolve(bot.pathfinder.goto(goal)).then(
                () => finish(bot.interrupt_code ? 'interrupted' : 'arrived'),
                () => finish(bot.interrupt_code ? 'interrupted' : 'failed'));
        } catch {
            finish('failed');
        }
    });
}

function movementsFor(bot, areas) {
    const movements = new pf.Movements(bot);
    movements.canDig = false;
    movements.exclusionAreasStep.push(stepCostOf(areas));
    return movements;
}

/**
 * Walks to the items near the bot, nearest first, and picks them up. An item inside one of `areas` is
 * never a target; every walk keeps out of the fence gates and of `areas`.
 * @param {object} bot
 * @param {{areas?: object[], first?: object, allow?: (entity) => boolean, log?: (text: string) => void}} [options]
 *   areas: keepOutAreas(...) of keep_out_logic.js; first: the item to walk to first; allow: more items to
 *   leave (the bot's own drops); log: where the line `Picked up N items.` goes
 * @returns {Promise<{ok: boolean, reason: null|'interrupted'|'error', text: string, picked: number}>}
 */
export async function collectItems(bot, options = {}) {
    let picked = 0;
    const done = (ok, reason, text) => ({ ok, reason, text, picked });
    try {
        const areas = Array.isArray(options?.areas) ? options.areas : [];
        const allow = typeof options?.allow === 'function' ? options.allow : () => true;
        const wanted = (entity) => {
            try {
                return entity?.name === 'item' && entity.position
                    && bot.entity.position.distanceTo(entity.position) < PICK_RANGE
                    && !keptOutBy(areas, entity.position) && allow(entity);
            } catch {
                return false;
            }
        };
        let next = options?.first && wanted(options.first) ? options.first : bot.nearestEntity(wanted);
        while (next && picked < PICK_MAX) {
            if (bot.interrupt_code) {
                return done(false, 'interrupted', `I was stopped after ${picked} items.`);
            }
            bot.pathfinder.setMovements(movementsFor(bot, areas));
            const outcome = await walk(bot, new pf.goals.GoalFollow(next, 1));
            if (outcome === 'interrupted') {
                return done(false, 'interrupted', `I was stopped after ${picked} items.`);
            }
            await sleep(SETTLE_MS);
            const prev = next;
            next = bot.nearestEntity(wanted);
            if (prev === next) {
                break;
            }
            picked++;
        }
        const text = `Picked up ${picked} items.`;
        try {
            options?.log?.(text);
        } catch {
            // the line is a help only
        }
        return done(true, null, text);
    } catch (err) {
        return done(false, 'error', `I could not pick up the items: ${err?.message ?? String(err)}`);
    }
}
