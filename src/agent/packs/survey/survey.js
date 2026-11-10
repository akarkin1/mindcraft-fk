// The executing part of the base survey (v0.1.4.15 "The base survey and Routines", PLAN section 4, SPEC 2.1, 2.3 to 2.5;
// engineer E4): the seeds read with bot.findBlocks (the one exception to the no-x-ray rule of v0.1.4.13, with the ore guard:
// every scan reads through oreBlind of survey_logic.js), the places of survey_logic.js, the underground of
// underground_logic.js, every find saved at once through the stores of ctx (areas, places, routes, bases), the report of
// texts.js, the difference line of a second survey, and the work of !renameArea, !forgetArea (a base or a place) and
// !goToBase. Zero model calls. Every function here answers { ok, reason, text, ... } and never throws.
//
// ctx is the pack context of the agent: areas (the AreaStore), places (the MemoryBank; a PlaceStore works too), routes
// (ctx.routes of the routes pack: store, walkTo), bases (the BaseStore of the world, null without the pack), settings, now,
// log, say, world (getVillagerProfession). The clock is the pack's (clockOf: options.now and options.wait for tests).
import { Vec3 } from 'vec3';
import { SEED_NAMES, SEED_CATEGORIES, oreBlind, seedsOf, findPlaces, uniqueName } from './survey_logic.js';
import { undergroundOf } from './underground_logic.js';
import { reportText, tiedRuleText, nothingText, againText, renamedText, unknownPlaceText, placeExistsText, forgotBaseText, atBaseText,
    noBaseText } from './texts.js';
import { botPos, clockOf, dimensionOf, listAreas, logTo } from '../home/context.js';
import { walkNear } from '../home/motion.js';
import { containsPos, isBox } from '../home/box_math.js';
import { normalizeAreaName } from '../../areas/area_store.js';
import { typeOfKind } from '../../areas/area_kind.js';

/** The numbers of the survey (SPEC 2.1, 2.4). */
export const SURVEY_RULES = Object.freeze({
    radiusMax: 128,      // the cap of survey_radius
    radiusDefault: 128,  // without a setting
    count: 20000,        // the most blocks bot.findBlocks gives per category
    pointReach: 4,       // a point find this near to a former survey's point of its kind keeps that name
    walkMs: 120000,      // the walk of !goToBase at most
    walkNear: 2,         // ... to within this many blocks of the door
    defaultName: 'base', // the name of a base when none is given
});

/** The text of a place that was forgotten by name (the text of !forgetPlace, as today). */
export function forgotPlaceText(name) {
    return `Forgot the place "${name}".`;
}

/** The text of !goToBase when neither a route nor the path search reaches the base (E4's own: the walk has no text). */
export function noWayToBaseText(name) {
    return `I found no way to the base "${name}".`;
}

// --- helpers -----------------------------------------------------------------------------------------------------------

function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

function posOf(p) {
    if (p === null || typeof p !== 'object' || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        return null;
    }
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function result(ok, reason, text, more = {}) {
    return { ok, reason, text, ...more };
}

/**
 * The reach of the survey (SPEC 2.1): min(settings.survey_radius, 128), 128 without a number, at least 1.
 * @param {object|null} settings
 * @returns {number}
 */
export function surveyRadius(settings) {
    const value = settings?.survey_radius;
    if (!isFiniteNumber(value) || value < 1) {
        return SURVEY_RULES.radiusDefault;
    }
    return Math.min(Math.floor(value), SURVEY_RULES.radiusMax);
}

// A reader of the names of the blocks of the bot, null when not loaded. Never throws.
function blockNames(bot) {
    return (x, y, z) => {
        try {
            const b = bot.blockAt(new Vec3(x, y, z));
            return typeof b?.name === 'string' ? b.name : null;
        } catch {
            return null;
        }
    };
}

// A reader of the `facing` of a block (the ladders), null without one. Never throws.
function facings(bot) {
    return (x, y, z) => {
        try {
            const b = bot.blockAt(new Vec3(x, y, z));
            if (!b || b.name !== 'ladder') {
                return null;
            }
            const props = (typeof b.getProperties === 'function' ? b.getProperties() : b._properties) ?? {};
            return typeof props.facing === 'string' ? props.facing : null;
        } catch {
            return null;
        }
    };
}

// The ids of block names in the registry of the bot (looked up by name at run time: no numeric id lives in the code).
function idsOf(bot, names) {
    const byName = bot?.registry?.blocksByName ?? {};
    const ids = [];
    for (const name of names) {
        const id = byName[name]?.id;
        if (Number.isInteger(id) && !ids.includes(id)) {
            ids.push(id);
        }
    }
    return ids;
}

// The positions bot.findBlocks gives for a category, as plain cells. Never throws.
function findSeeds(bot, names, radius) {
    try {
        const ids = idsOf(bot, names);
        if (ids.length === 0 || typeof bot?.findBlocks !== 'function') {
            return [];
        }
        const found = bot.findBlocks({ matching: ids, maxDistance: radius, count: SURVEY_RULES.count });
        return (Array.isArray(found) ? found : []).map(posOf).filter(Boolean);
    } catch (err) {
        console.warn('Survey pack: could not read the seeds:', err?.message ?? err);
        return [];
    }
}

// The entities of the bot as plain records for seedsOf, a villager with its profession from world.js when ctx gives it.
function entitiesOf(bot, ctx) {
    const out = [];
    try {
        for (const e of Object.values(bot?.entities ?? {})) {
            if (!e || typeof e !== 'object' || e === bot.entity) {
                continue;
            }
            const record = { id: e.id, name: e.name, type: e.type, position: e.position, metadata: e.metadata, leashHolder: e.leashHolder };
            if (e.name === 'villager' && typeof ctx?.world?.getVillagerProfession === 'function') {
                try {
                    record.profession = ctx.world.getVillagerProfession(e);
                } catch {
                    // the metadata tells it, or 'unknown'
                }
            }
            out.push(record);
        }
    } catch {
        // what was read so far
    }
    return out;
}

// The saved places of ctx.places (a MemoryBank: getJson and recallPlaceInfo; or a PlaceStore: list) as
// { name, x, y, z, dimension, base, source }: a place of a base is the survey's (source 'survey'), the others the owner's.
function savedPlacesOf(ctx) {
    const places = ctx?.places;
    const out = [];
    try {
        if (typeof places?.list === 'function') {
            for (const p of places.list() ?? []) {
                out.push({ name: p.name, x: p.x, y: p.y, z: p.z, dimension: p.dimension ?? null, base: p.base ?? null, source: p.base ? 'survey' : 'manual' });
            }
        } else if (typeof places?.getJson === 'function') {
            for (const [name, pos] of Object.entries(places.getJson() ?? {})) {
                const info = typeof places.recallPlaceInfo === 'function' ? places.recallPlaceInfo(name) : null;
                const p = info ?? (Array.isArray(pos) ? { x: pos[0], y: pos[1], z: pos[2], dimension: null } : null);
                if (p) {
                    out.push({ name, x: p.x, y: p.y, z: p.z, dimension: p.dimension ?? null, base: p.base ?? null, source: p.base ? 'survey' : 'manual' });
                }
            }
        }
    } catch (err) {
        console.warn('Survey pack: could not read the saved places:', err?.message ?? err);
    }
    return out.filter(p => typeof p.name === 'string' && [p.x, p.y, p.z].every(isFiniteNumber));
}

function sameDimension(a, b) {
    const plain = d => (typeof d === 'string' && d.length > 0 ? d.replace(/^minecraft:/, '') : null);
    return plain(a) === null || plain(b) === null || plain(a) === plain(b);
}

function boxOfArea(area) {
    if (area?.box && isBox(area.box)) {
        return { min: { ...area.box.min }, max: { ...area.box.max } };
    }
    return isBox(area) ? { min: { ...area.min }, max: { ...area.max } } : null;
}

function volume(box) {
    return (box.max.x - box.min.x + 1) * (box.max.y - box.min.y + 1) * (box.max.z - box.min.z + 1);
}

function overlap(a, b) {
    const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) + 1;
    const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) + 1;
    const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z) + 1;
    return dx > 0 && dy > 0 && dz > 0 ? dx * dy * dz : 0;
}

function sameBox(a, b) {
    return a && b && a.min.x === b.min.x && a.min.y === b.min.y && a.min.z === b.min.z && a.max.x === b.max.x && a.max.y === b.max.y && a.max.z === b.max.z;
}

function centreOf(box) {
    return { x: Math.floor((box.min.x + box.max.x) / 2), y: Math.floor((box.min.y + box.max.y) / 2), z: Math.floor((box.min.z + box.max.z) / 2) };
}

function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function baseOfName(name) {
    return typeof name === 'string' ? name.replace(/_\d+$/, '') : '';
}

function isBuildingPlace(place) {
    const type = typeOfKind(place?.kind) ?? place?.type;
    return (type === 'home' || type === 'building') && Boolean(boxOfArea(place));
}

// The bot's own flag for an interrupt (`!stop`, a reflex): the survey stops between its slices.
function interrupted(bot) {
    return bot?.interrupt_code === true;
}

// --- the places of the underground, named and checked against the stores (2.3, 2.4) ---------------------------------------

// The owner's area that holds a find (its box inside or overlapping by half or more; a point inside), or null.
function ownerAround(place, ownerAreas) {
    const box = boxOfArea(place);
    if (box) {
        return ownerAreas.find(a => {
            const o = overlap(box, a.box);
            return o === volume(box) || o * 2 >= volume(box);
        }) ?? null;
    }
    const at = posOf(place?.at);
    return at ? ownerAreas.find(a => containsPos(a.box, at)) ?? null : null;
}

// The name of a former survey's find that this one replaces: an area whose box overlaps by half of the smaller, a point of
// the same base name within pointReach; null for a new find.
function formerNameOf(place, surveyAreas, surveyPoints) {
    const box = boxOfArea(place);
    if (box) {
        const former = surveyAreas.find(a => baseOfName(a.name) === baseOfName(place.name) && overlap(box, a.box) * 2 >= Math.min(volume(box), volume(a.box)));
        return former ? former.name : null;
    }
    const at = posOf(place?.at);
    if (!at) {
        return null;
    }
    const former = surveyPoints.find(p => baseOfName(p.name) === baseOfName(place.name) && distance(p, at) <= SURVEY_RULES.pointReach);
    return former ? former.name : null;
}

// --- the saves (2.4) -----------------------------------------------------------------------------------------------------

function saveArea(ctx, place, dimension, base) {
    const box = boxOfArea(place);
    if (!box || typeof ctx?.areas?.set !== 'function') {
        return null;
    }
    const area = {
        name: place.name, kind: place.kind, type: typeOfKind(place.kind) ?? place.type, min: box.min, max: box.max, dimension,
        entrances: Array.isArray(place.entrances) ? place.entrances : [], source: 'survey', contents: place.contents ?? null, border: place.border ?? undefined,
        base,
    };
    if (place.flags && typeof place.flags === 'object') {
        area.flags = place.flags;
    }
    if (typeof place.under === 'string') {
        area.under = place.under;
    }
    // v0.1.4.15 (Q-1): how the edge of the box lies, for the interior the home pack reads: the box of the floor scan has the
    // walls as its edge (`wall`), the box of scanBuilding without floors a margin of air (`margin`); farms and pens say nothing
    if (place.edge === 'wall' || place.edge === 'margin') {
        area.edge = place.edge;
    } else if (typeof place.detail?.floor === 'boolean' && (place.type === 'home' || place.type === 'building')) {
        area.edge = place.detail.floor ? 'wall' : 'margin';
    }
    try {
        return ctx.areas.set(area);
    } catch (err) {
        console.warn(`Survey pack: could not save the area "${place.name}":`, err?.message ?? err);
        return null;
    }
}

function savePoint(ctx, place, dimension, base) {
    const at = posOf(place?.at);
    const places = ctx?.places;
    if (!at || !places) {
        return false;
    }
    try {
        if (typeof places.rememberPlace === 'function') {
            return places.rememberPlace(place.name, at.x, at.y, at.z, dimension, base) !== false;
        }
        if (typeof places.remember === 'function') {
            return Boolean(places.remember(place.name, at.x, at.y, at.z, dimension, base));
        }
    } catch (err) {
        console.warn(`Survey pack: could not save the place "${place.name}":`, err?.message ?? err);
    }
    return false;
}

// A route is saved only when no route of that name exists (2.3.4).
function saveRoute(ctx, route, dimension) {
    const store = ctx?.routes?.store;
    if (typeof store?.set !== 'function' || !route) {
        return false;
    }
    try {
        if (typeof store.get === 'function' && store.get(route.name, dimension)) {
            return false;
        }
        return Boolean(store.set({ ...route, dimension }));
    } catch (err) {
        console.warn(`Survey pack: could not save the route "${route?.name}":`, err?.message ?? err);
        return false;
    }
}

function removeArea(ctx, name) {
    try {
        return ctx?.areas?.remove?.(name) === true;
    } catch {
        return false;
    }
}

function removePoint(ctx, name) {
    try {
        const places = ctx?.places;
        if (typeof places?.forgetPlace === 'function') {
            return places.forgetPlace(name) === true;
        }
        return places?.forget?.(name) === true;
    } catch {
        return false;
    }
}

// The base of the found places (2.4): the centre of the found boxes (the points when there is no box, the bot without
// either), the door of the home, else of the first building.
function baseOf(name, found, dimension, botAt) {
    const boxes = found.map(boxOfArea).filter(Boolean);
    const points = found.map(p => posOf(p.at)).filter(Boolean);
    let centre = botAt ? posOf(botAt) : null;
    const list = boxes.length > 0 ? boxes.map(centreOf) : points;
    if (list.length > 0) {
        centre = {
            x: Math.floor(list.reduce((s, p) => s + p.x, 0) / list.length),
            y: Math.floor(list.reduce((s, p) => s + p.y, 0) / list.length),
            z: Math.floor(list.reduce((s, p) => s + p.z, 0) / list.length),
        };
    }
    const doorOf = (place) => posOf((Array.isArray(place?.entrances) ? place.entrances : []).find(e => e?.kind === 'door') ?? null);
    const home = found.find(p => p.kind === 'home' && doorOf(p));
    const building = found.find(p => isBuildingPlace(p) && doorOf(p));
    return { name, centre: centre ?? { x: 0, y: 0, z: 0 }, dimension, door: doorOf(home ?? building), places: found.map(p => p.name) };
}

// --- the difference of a second survey (2.4) --------------------------------------------------------------------------------

function animalsOf(place) {
    const animals = place?.contents?.animals;
    return animals && typeof animals === 'object' ? animals : {};
}

// A seed of a saved survey place still stands: an entrance block (a gate, a door, a trapdoor), a crop, farmland or cane in
// its box, the block of a point. Unloaded counts as standing (nothing is forgotten for a chunk that is not loaded).
function seedsRemain(read, place) {
    const box = boxOfArea(place);
    if (box) {
        for (const e of Array.isArray(place.entrances) ? place.entrances : []) {
            const name = read(e.x, e.y, e.z);
            if (name === null || name.endsWith('_fence_gate') || name.endsWith('_door') || name.endsWith('_trapdoor')) {
                return true;
            }
        }
        if (volume(box) > 64 * 48 * 64) {
            return true;
        }
        let loaded = false;
        for (let x = box.min.x; x <= box.max.x; x++) {
            for (let y = box.min.y; y <= box.max.y; y++) {
                for (let z = box.min.z; z <= box.max.z; z++) {
                    const name = read(x, y, z);
                    if (name === null) {
                        continue;
                    }
                    loaded = true;
                    if (SEED_NAMES.farmland.includes(name) || name === 'sugar_cane' || name.endsWith('_fence_gate') || name.endsWith('_door')
                        || name.endsWith('_trapdoor') || name.endsWith('_bed') || SEED_NAMES.rooms.includes(name)) {
                        return true;
                    }
                }
            }
        }
        return !loaded;
    }
    const at = posOf(place?.at ?? place);
    return at ? read(at.x, at.y, at.z) === null : true;
}

// The difference between the saved survey places of a base and the places found again (2.4).
function differenceOf(before, found, read) {
    const diff = { more: [], changed: [], added: [], gone: [] };
    const byName = new Map(before.map(p => [p.name, p]));
    const seen = new Set();
    for (const place of found) {
        const old = byName.get(place.name);
        if (!old) {
            diff.added.push(place.name);
            continue;
        }
        seen.add(place.name);
        const was = animalsOf(old);
        const now = animalsOf(place);
        for (const animal of new Set([...Object.keys(was), ...Object.keys(now)])) {
            const count = (now[animal] ?? 0) - (was[animal] ?? 0);
            if (count !== 0) {
                diff.more.push({ name: place.name, animal, count });
            }
        }
        const oldBox = boxOfArea(old);
        const newBox = boxOfArea(place);
        if (oldBox && newBox && !sameBox(oldBox, newBox)) {
            diff.changed.push(place.name);
        } else if (!oldBox && !newBox) {
            const a = posOf(old.at ?? old);
            const b = posOf(place.at);
            if (a && b && (a.x !== b.x || a.y !== b.y || a.z !== b.z)) {
                diff.changed.push(place.name);
            }
        }
    }
    for (const old of before) {
        if (!seen.has(old.name) && !seedsRemain(read, old)) {
            diff.gone.push(old.name);
        }
    }
    return diff;
}

// --- the survey (2.4) ------------------------------------------------------------------------------------------------------

// The name of the base: the given one, `base` when empty, `base_2` when `base` is taken and none was given.
function baseNameOf(ctx, name) {
    const given = normalizeAreaName(name) ?? '';
    if (given !== '') {
        return given;
    }
    const taken = new Set((ctx?.bases?.list?.() ?? []).map(b => b.name));
    return uniqueName(SURVEY_RULES.defaultName, taken);
}

/**
 * !surveyBase (SPEC 2.4): the seeds of 2.1 read with bot.findBlocks per category within min(survey_radius, 128) blocks, the
 * entities, the places of findPlaces (2.2) through the ore-blind reader, the underground of each building (2.3), everything
 * saved at once (areas through ctx.areas.set with source survey and the base, points through ctx.places.rememberPlace with
 * the base, routes through ctx.routes.store when no route of the name exists, the base through ctx.bases), then one report
 * line (2.5), with the sentence about a tied animal after it once. The bot keeps moving: the survey yields (clock.wait(0))
 * after every seed category and every building's underground, and stops at bot.interrupt_code. A survey with a saved base
 * of that name reports the difference only (2.4: more or fewer animals, a changed box, new, gone when the seeds are gone;
 * a gone place of the survey's own is forgotten). The owner's areas are never touched (kept). Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {string} [name] the name of the base; empty: `base`, then `base_2`
 * @param {{now?: Function, wait?: Function}} [options] the clock, for tests
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, base: object|null, places: object[], kept: object[], skipped: object[],
 *   changed: object|null, radius: number}>}
 */
export async function surveyBase(bot, ctx, name = '', options = {}) {
    const clock = clockOf(ctx, options);
    const radius = surveyRadius(ctx?.settings);
    const empty = { base: null, places: [], kept: [], skipped: [], changed: null, radius };
    try {
        if (!bot || typeof bot.blockAt !== 'function') {
            return result(false, 'no_bot', 'I cannot see the blocks around me.', empty);
        }
        if (typeof ctx?.areas?.set !== 'function') {
            return result(false, 'no_areas', 'Protected areas are off.', empty);
        }
        const baseName = baseNameOf(ctx, name);
        const dimension = dimensionOf(bot) ?? 'overworld';
        const former = ctx?.bases?.get?.(baseName) ?? null;
        const read = oreBlind(blockNames(bot));
        const faceAt = facings(bot);

        // 1. the seeds, in slices
        const blocks = {};
        for (const category of SEED_CATEGORIES) {
            blocks[category] = findSeeds(bot, SEED_NAMES[category], radius);
            await clock.wait(0);
            if (interrupted(bot)) {
                return result(false, 'interrupted', '', empty);
            }
        }
        const seeds = seedsOf(blocks, entitiesOf(bot, ctx));

        // 2. the places
        const areas = listAreas(ctx, dimension);
        const savedPlaces = savedPlacesOf(ctx).filter(p => sameDimension(p.dimension, dimension));
        const found = findPlaces(read, seeds, { areas, places: savedPlaces }, { dimension, now: () => clock.now() });
        await clock.wait(0);
        if (interrupted(bot)) {
            return result(false, 'interrupted', '', empty);
        }
        const places = [...found.places];
        const kept = [...found.kept];
        const skipped = [...found.skipped];

        // 3. the underground of each found building and each saved home or building of the owner's
        const ownerAreas = areas.filter(a => a.source !== 'survey').map(a => ({ ...a, box: boxOfArea(a) })).filter(a => a.box);
        const surveyAreas = areas.filter(a => a.source === 'survey').map(a => ({ ...a, box: boxOfArea(a) })).filter(a => a.box);
        const surveyPoints = savedPlaces.filter(p => p.source === 'survey');
        const taken = new Set([...areas.map(a => a.name), ...savedPlaces.map(p => p.name), ...places.map(p => p.name)]);
        const buildings = [...places.filter(isBuildingPlace), ...ownerAreas.filter(a => a.type === 'home' || a.type === 'building')];
        const seen = new Set();
        for (const building of buildings) {
            const box = boxOfArea(building);
            const down = seeds.down.filter(p => containsPos(box, p));
            if (down.length === 0) {
                continue;
            }
            const under = undergroundOf(read, building, down, { faceAt, animals: seeds.animals, now: () => clock.now() });
            const names = new Map(); // the plain name of a place of the underground -> its name in the stores
            for (const place of under.places) {
                if (seen.has(`${place.name}:${JSON.stringify(place.at ?? place.box)}`)) {
                    continue;
                }
                seen.add(`${place.name}:${JSON.stringify(place.at ?? place.box)}`);
                const owner = ownerAround(place, ownerAreas);
                if (owner) {
                    kept.push({ name: place.name, inside: owner.name, kind: place.kind, at: posOf(place.at) ?? centreOf(boxOfArea(place)), place });
                    continue;
                }
                const formerName = formerNameOf(place, surveyAreas, surveyPoints);
                const plain = place.name;
                if (formerName) {
                    place.detail.replaces = formerName;
                    place.name = formerName;
                } else {
                    place.name = uniqueName(place.name, taken);
                }
                if (typeof place.under === 'string') {
                    place.under = building.name;
                    place.detail.under = building.name;
                }
                taken.add(place.name);
                names.set(plain, place.name);
                places.push(place);
            }
            for (const route of under.routes) {
                const to = names.get(route.to.name);
                if (!to) {
                    continue; // the place was kept as the owner's: no route of the survey to it
                }
                const toName = to;
                route.to = { ...route.to, name: toName };
                route.name = `${building.name}_to_${toName}`;
                route.from = { ...route.from, name: building.name };
                saveRoute(ctx, route, dimension);
            }
            await clock.wait(0);
            if (interrupted(bot)) {
                return result(false, 'interrupted', '', empty);
            }
        }

        // 4. the saves: everything at once
        const before = former ? [...(ctx.areas.ofBase?.(baseName) ?? areas.filter(a => a.source === 'survey' && a.base === baseName)),
            ...savedPlaces.filter(p => p.base === baseName).map(p => ({ ...p, at: { x: p.x, y: p.y, z: p.z } }))] : [];
        const saved = [];
        for (const place of places) {
            if (boxOfArea(place)) {
                if (saveArea(ctx, place, dimension, baseName)) {
                    saved.push(place);
                } else {
                    skipped.push({ reason: 'error', at: centreOf(boxOfArea(place)), name: place.name });
                }
            } else if (savePoint(ctx, place, dimension, baseName)) {
                saved.push(place);
            } else {
                skipped.push({ reason: 'error', at: posOf(place.at), name: place.name });
            }
        }
        let changed = null;
        if (former) {
            changed = differenceOf(before, saved, read);
            for (const gone of changed.gone) {
                if (!removeArea(ctx, gone)) {
                    removePoint(ctx, gone);
                }
            }
        }
        let base = null;
        if (saved.length > 0 || former) {
            const all = former ? [...saved.map(p => p.name), ...before.map(p => p.name).filter(n => !changed.gone.includes(n))] : saved.map(p => p.name);
            base = ctx?.bases?.set?.({ ...baseOf(baseName, saved, dimension, botPos(bot)), places: [...new Set(all)], surveyed: new Date(clock.now()).toISOString() }) ?? null;
        }
        logTo(ctx, `Survey: ${saved.length} saved, ${kept.length} kept, ${skipped.length} skipped within ${radius} blocks.`);

        // 5. the report
        if (former) {
            // the kept finds go along for the day againText takes them (W126 C); an extra argument is ignored today
            return result(true, null, againText(baseName, changed, kept), { base, places: saved, kept, skipped, changed, radius });
        }
        if (saved.length === 0 && kept.length === 0) {
            return result(true, 'nothing', nothingText(radius), { base, places: saved, kept, skipped, changed, radius });
        }
        const report = reportText(saved, kept, saved.filter(p => p.detail?.replaces).map(p => p.name));
        const tied = tiedRuleText(saved);
        return result(true, null, tied ? `${report} ${tied}` : report, { base, places: saved, kept, skipped, changed, radius });
    } catch (err) {
        console.warn('Survey pack: the survey failed:', err?.message ?? err);
        return result(false, 'error', `I could not survey the base: ${err?.message ?? err}`, empty);
    }
}

// --- !renameArea, !forgetArea, !goToBase (2.5) -----------------------------------------------------------------------------

// A renamed place keeps its slot in the list of its base, so !forgetArea of the base still counts it. Never throws.
function renameInBases(ctx, oldName, newName) {
    try {
        for (const base of ctx?.bases?.list?.() ?? []) {
            if (Array.isArray(base.places) && base.places.includes(oldName)) {
                ctx.bases.set({ ...base, places: base.places.map(n => (n === oldName ? newName : n)) });
            }
        }
    } catch {
        // the list of a base is a help, not the truth: the stores carry the base of each place
    }
}

function placeInfo(ctx, name) {
    const places = ctx?.places;
    try {
        if (typeof places?.recallPlaceInfo === 'function') {
            return places.recallPlaceInfo(name) ?? null;
        }
        if (typeof places?.recall === 'function') {
            return places.recall(name) ?? null;
        }
    } catch {
        return null;
    }
    return null;
}

/**
 * !renameArea (SPEC 2.5): an area or a place (areas first) gets the new name; nothing else changes. Texts word for word:
 * `I renamed "X" to "Y".`, `I know no place "X".`, `There is a place "Y" already.` Never throws.
 * @param {object} ctx
 * @param {string} oldName
 * @param {string} newName
 * @returns {{ok: boolean, reason: string|null, text: string, kind: 'area'|'place'|null}}
 */
export function renameArea(ctx, oldName, newName) {
    try {
        const areas = ctx?.areas;
        const oldArea = normalizeAreaName(oldName) ?? '';
        const newArea = normalizeAreaName(newName) ?? '';
        const oldPlace = typeof oldName === 'string' ? oldName.trim() : '';
        const newPlace = typeof newName === 'string' ? newName.trim() : '';
        const area = oldArea !== '' ? areas?.get?.(oldArea) ?? null : null;
        const place = !area && oldPlace !== '' ? placeInfo(ctx, oldPlace) : null;
        if (!area && !place) {
            return result(false, 'unknown', unknownPlaceText(oldPlace !== '' ? oldPlace : oldArea), { kind: null });
        }
        const target = area ? newArea : newPlace;
        if (target === '') {
            return result(false, 'no_name', unknownPlaceText(''), { kind: area ? 'area' : 'place' });
        }
        if ((newArea !== '' && areas?.get?.(newArea)) || (newPlace !== '' && placeInfo(ctx, newPlace))) {
            return result(false, 'exists', placeExistsText(target), { kind: area ? 'area' : 'place' });
        }
        if (area) {
            const renamed = typeof areas.rename === 'function' ? areas.rename(oldArea, newArea) : null;
            if (!renamed) {
                return result(false, 'error', placeExistsText(newArea), { kind: 'area' });
            }
            renameInBases(ctx, area.name, renamed.name);
            return result(true, null, renamedText(area.name, renamed.name), { kind: 'area' });
        }
        const places = ctx.places;
        const ok = typeof places.rename === 'function' ? places.rename(oldPlace, newPlace) : false;
        if (!ok && ok !== null) {
            return result(false, 'error', placeExistsText(newPlace), { kind: 'place' });
        }
        renameInBases(ctx, oldPlace, newPlace);
        return result(true, null, renamedText(oldPlace, newPlace), { kind: 'place' });
    } catch (err) {
        console.warn('Survey pack: the rename failed:', err?.message ?? err);
        return result(false, 'error', unknownPlaceText(String(oldName ?? '')), { kind: null });
    }
}

/**
 * !forgetArea with the survey (SPEC 2.5), after the areas: a base of that name is forgotten with its places (its areas, its
 * points and the survey's routes to them), else a place of that name. `I forgot the base "X" and its 12 places.`; a place:
 * `Forgot the place "X".`; neither: ok false with an empty text (the command answers as today). Never throws.
 * @param {object} ctx
 * @param {string} name
 * @returns {{ok: boolean, reason: string|null, text: string, kind: 'base'|'place'|null, count: number}}
 */
export function forgetSurveyed(ctx, name) {
    try {
        const baseName = normalizeAreaName(name) ?? '';
        const base = baseName !== '' ? ctx?.bases?.get?.(baseName) ?? null : null;
        if (base) {
            let count = 0;
            const names = new Set(base.places ?? []);
            for (const area of ctx?.areas?.ofBase?.(baseName) ?? []) {
                names.add(area.name);
            }
            for (const place of ctx?.places?.placesOfBase?.(baseName) ?? ctx?.places?.ofBase?.(baseName) ?? []) {
                names.add(place.name);
            }
            for (const n of names) {
                if (removeArea(ctx, n) || removePoint(ctx, n)) {
                    count++;
                }
            }
            const store = ctx?.routes?.store;
            if (typeof store?.list === 'function' && typeof store.remove === 'function') {
                for (const route of store.list(base.dimension) ?? []) {
                    if (route.source === 'survey' && (names.has(route.to?.name) || names.has(route.from?.name))) {
                        store.remove(route.name, route.dimension);
                    }
                }
            }
            ctx.bases.remove(baseName);
            return result(true, null, forgotBaseText(baseName, count), { kind: 'base', count });
        }
        const placeName = typeof name === 'string' ? name.trim() : '';
        if (placeName !== '' && removePoint(ctx, placeName)) {
            return result(true, null, forgotPlaceText(placeName), { kind: 'place', count: 1 });
        }
        return result(false, 'unknown', '', { kind: null, count: 0 });
    } catch (err) {
        console.warn('Survey pack: forgetting failed:', err?.message ?? err);
        return result(false, 'error', '', { kind: null, count: 0 });
    }
}

/**
 * !goToBase (SPEC 2.5): walks to the base's door (else its centre) with ctx.routes.walkTo first (a learned route), then the
 * path search (walkNear of the home pack, doors allowed, no digging). `I am at the base "X".`, `I know no base "X".`, the
 * walk's own failure text. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {string} name
 * @param {{now?: Function, wait?: Function, walk?: Function, timeoutMs?: number}} [options] walk(bot, target, range, options) for tests
 * @returns {Promise<{ok: boolean, reason: string|null, text: string, base: object|null}>}
 */
export async function goToBase(bot, ctx, name, options = {}) {
    const clock = clockOf(ctx, options);
    try {
        const baseName = normalizeAreaName(name) ?? '';
        const base = baseName !== '' ? ctx?.bases?.get?.(baseName) ?? null : null;
        if (!base) {
            return result(false, 'unknown', noBaseText(baseName !== '' ? baseName : String(name ?? '')), { base: null });
        }
        const target = posOf(base.door) ?? posOf(base.centre);
        if (!target) {
            return result(false, 'unknown', noBaseText(baseName), { base });
        }
        const here = dimensionOf(bot);
        if (here && !sameDimension(here, base.dimension)) {
            return result(false, 'dimension', `The base "${baseName}" is in the dimension ${base.dimension}, but I am in ${here}.`, { base });
        }
        const walkTo = ctx?.routes?.walkTo;
        if (typeof walkTo === 'function' && !interrupted(bot)) {
            const byRoute = await walkTo(bot, target, { clock });
            if (byRoute?.ok) {
                return result(true, null, atBaseText(baseName), { base });
            }
            if (byRoute && byRoute.reason !== 'no_route') {
                return result(false, byRoute.reason === 'interrupted' ? 'interrupted' : 'no_path', byRoute.text ?? '', { base });
            }
        }
        if (interrupted(bot)) {
            return result(false, 'interrupted', '', { base });
        }
        const walk = typeof options?.walk === 'function' ? options.walk : walkNear;
        const direct = await walk(bot, target, SURVEY_RULES.walkNear, { clock, timeoutMs: options?.timeoutMs ?? SURVEY_RULES.walkMs, allowDig: false, allowDoors: true });
        if (direct?.ok) {
            return result(true, null, atBaseText(baseName), { base });
        }
        if (direct?.reason === 'interrupted') {
            return result(false, 'interrupted', '', { base });
        }
        return result(false, 'no_path', noWayToBaseText(baseName), { base });
    } catch (err) {
        console.warn('Survey pack: the walk to the base failed:', err?.message ?? err);
        return result(false, 'error', `I could not walk to the base: ${err?.message ?? err}`, { base: null });
    }
}
