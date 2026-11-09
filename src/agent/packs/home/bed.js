// The way to a place for a bed (v0.1.4.14, P-24, SPEC 8.6): `!placeHere("<kind>_bed")` and the bed of the sleep pack
// place a bed only on level ground (bedPlaces of bed_logic.js); the bot walks to the cell behind the foot of the
// nearest place within 4 blocks first, and places from there, facing the head (the bed lies the way the bot looks).
import { Vec3 } from 'vec3';
import { BED_SEARCH, NO_BED_GROUND_TEXT, bedPlaces } from './bed_logic.js';
import { botPos } from './context.js';
import { blockReader, goals, gotoGoal, makeMovements } from './motion.js';

function feetCell(bot) {
    const p = botPos(bot);
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null;
}

function sameCell(a, b) {
    return Boolean(a && b) && a.x === b.x && a.y === b.y && a.z === b.z;
}

/**
 * Walks to a place for a bed: the best of bedPlaces within BED_SEARCH blocks (at most 3 tried), the bot in its stand.
 * Never throws.
 * @param {object} bot
 * @param {object} [ctx] the home context (clock)
 * @returns {Promise<{ok: boolean, place: {foot, head, facing, stand}|null, text: string}>}
 *   text: NO_BED_GROUND_TEXT when no place is found or reached
 */
export async function goToBedPlace(bot, ctx = {}) {
    try {
        const read = blockReader(bot);
        const name = (x, y, z) => read(x, y, z)?.name ?? null;
        const places = bedPlaces(name, botPos(bot), BED_SEARCH);
        for (const place of places.slice(0, 3)) {
            if (sameCell(feetCell(bot), place.stand)) {
                return { ok: true, place, text: '' };
            }
            const walk = await gotoGoal(bot, new goals.GoalBlock(place.stand.x, place.stand.y, place.stand.z),
                { movements: makeMovements(bot, { dig: false }), timeoutMs: 15000, clock: ctx?.clock });
            if (walk.reason === 'interrupted') {
                return { ok: false, place: null, text: '' };
            }
            if (sameCell(feetCell(bot), place.stand)) {
                // the ground may have changed on the way: the place again from where the bot stands
                const again = bedPlaces(name, botPos(bot), 1).find(p => sameCell(p.foot, place.foot) && sameCell(p.head, place.head));
                if (again) {
                    return { ok: true, place: again, text: '' };
                }
            }
        }
        return { ok: false, place: null, text: NO_BED_GROUND_TEXT };
    } catch (err) {
        console.warn('Home pack: the place for the bed failed:', err?.message ?? err);
        return { ok: false, place: null, text: NO_BED_GROUND_TEXT };
    }
}

function itemOf(bot, name) {
    try {
        return (bot.inventory?.items?.() ?? []).find(i => i?.name === name) ?? null;
    } catch {
        return null;
    }
}

/**
 * Places a bed of the bag on level ground (P-24): goToBedPlace, then from the stand onto the top of the foot's support,
 * looking at it (the head lies the way the bot looks). Never throws.
 * @param {object} bot
 * @param {object} ctx the home context
 * @param {string} name the item, e.g. `black_bed`
 * @returns {Promise<{ok: boolean, at: {x,y,z}|null, text: string}>}
 *   text: `Placed black_bed at (x, y, z).`, NO_BED_GROUND_TEXT, `Don't have any black_bed to place.`, or the failure
 */
export async function placeBed(bot, ctx, name) {
    try {
        const item = itemOf(bot, name);
        if (!item) {
            return { ok: false, at: null, text: `Don't have any ${name} to place.` };
        }
        const way = await goToBedPlace(bot, ctx);
        if (!way.ok) {
            return { ok: false, at: null, text: way.text };
        }
        const { foot } = way.place;
        const support = bot.blockAt(new Vec3(foot.x, foot.y - 1, foot.z));
        try {
            await bot.equip(item, 'hand');
            await bot.lookAt(new Vec3(foot.x + 0.5, foot.y, foot.z + 0.5), true);
            await bot.placeBlock(support, new Vec3(0, 1, 0));
        } catch (err) {
            if (err?.name === 'ProtectedAreaError') {
                return { ok: false, at: null, text: err.message };
            }
            // the place call often ends with a timeout although the bed stands: the block decides
        }
        const placed = bot.blockAt(new Vec3(foot.x, foot.y, foot.z));
        if (placed && typeof placed.name === 'string' && placed.name.endsWith('_bed')) {
            return { ok: true, at: { ...foot }, text: `Placed ${name} at (${foot.x}, ${foot.y}, ${foot.z}).` };
        }
        return { ok: false, at: null, text: `Failed to place ${name} at (${foot.x}, ${foot.y}, ${foot.z}).` };
    } catch (err) {
        console.warn('Home pack: placing the bed failed:', err?.message ?? err);
        return { ok: false, at: null, text: `Failed to place ${name}.` };
    }
}
