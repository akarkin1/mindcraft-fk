// The house of the player as the area "home" (spec v0.1.4.8, D6). In the play test of v0.1.4.7 the
// house was saved as a place only, so nothing protected it and the shelter was another area (M5, R2).
// The world is read through getBlock(x, y, z), which returns the name of a block or null for a block
// that is not loaded, as for the scans.
import { scanBuilding } from './area_scan.js';
import { boxSize } from './area_geometry.js';
import { normalizeDimension } from './area_store.js';

/** The place "home" is scanned only when the bot is at most this far from it, in blocks. */
export const AUTO_HOME_RANGE = 48;

const HOME = 'home';
const NO_WALLS_TEXT = `I know the place "${HOME}" but I find no walls there. Stand in your house and tell me that this is home.`;

// Stores whose house was scanned: at most one try per start (a new start opens a new store).
const tried = new WeakSet();

function isPoint(value) {
    return value !== null && typeof value === 'object'
        && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function toPlace(value) {
    const point = Array.isArray(value) ? { x: value[0], y: value[1], z: value[2] } : value;
    if (!isPoint(point)) {
        return null;
    }
    return { x: point.x, y: point.y, z: point.z, dimension: typeof point.dimension === 'string' ? point.dimension : null };
}

// The place of that name from a MemoryBank (recallPlaceInfo, recallPlace), a PlaceStore (recall),
// a Map or a plain object of places ({x, y, z} or [x, y, z]).
function placeOf(places, name) {
    if (places === null || typeof places !== 'object') {
        return null;
    }
    for (const fn of ['recallPlaceInfo', 'recall', 'recallPlace']) {
        if (typeof places[fn] === 'function') {
            const place = toPlace(places[fn](name));
            if (place) {
                return place;
            }
        }
    }
    if (places instanceof Map) {
        return toPlace(places.get(name));
    }
    return Object.hasOwn(places, name) ? toPlace(places[name]) : null;
}

function savedText(area) {
    const size = boxSize(area);
    const doors = (Array.isArray(area.entrances) ? area.entrances : []).filter(e => e?.kind === 'door').length;
    return `I saved your house as the area "${HOME}": ${size.x} x ${size.y} x ${size.z} blocks, `
        + `${doors} door${doors === 1 ? '' : 's'}. Tell me if that is wrong.`;
}

function loaded(getBlock, place) {
    try {
        return getBlock(Math.floor(place.x), Math.floor(place.y), Math.floor(place.z)) !== null;
    } catch {
        return false;
    }
}

/**
 * Saves the house as the area "home" of type home (v0.1.4.8, D6). When no area of type home exists
 * and the place "home" exists, is loaded and lies within 48 blocks of the bot, the building at the
 * place is scanned (scanBuilding) and saved with the source "auto". At most one scan per store, so
 * one per start. An area named "home" of type building (as v0.1.4.7 saved the house) becomes of type
 * home without a scan. Never throws.
 *
 * Reasons: 'saved' (saved is true); 'no_walls' (the scan found no building; the text asks the player);
 * and, with an empty text, 'no_store', 'has_home', 'name_taken' (an area "home" of another type),
 * 'no_place', 'other_dimension', 'too_far', 'not_loaded', 'tried', 'error'.
 *
 * @param {(x: number, y: number, z: number) => string|null} getBlock the name of a block, null when not loaded
 * @param {object|null} places the places: a MemoryBank, a PlaceStore, a Map or an object of places
 * @param {object|null} store the AreaStore of the world
 * @param {{x: number, y: number, z: number}|null} botPos the position of the bot
 * @param {{dimension?: string}} [options] dimension: of the bot; a place in another one is not scanned
 * @returns {{saved: boolean, reason: string, text: string}}
 *   text: `I saved your house as the area "home": 9 x 6 x 11 blocks, 2 doors. Tell me if that is wrong.`
 *   or `I know the place "home" but I find no walls there. Stand in your house and tell me that this is home.`
 */
export function autoHome(getBlock, places, store, botPos, options = {}) {
    const result = (saved, reason, text = '') => ({ saved, reason, text });
    try {
        if (typeof getBlock !== 'function' || !store || typeof store.list !== 'function'
            || typeof store.set !== 'function' || typeof store.get !== 'function') {
            return result(false, 'no_store');
        }
        if (store.list().some(area => area?.type === HOME)) {
            return result(false, 'has_home');
        }
        const named = store.get(HOME);
        if (named && named.type === 'building') {
            const area = store.set({ ...named, type: HOME });
            return result(true, 'saved', savedText(area));
        }
        if (named) {
            return result(false, 'name_taken');
        }
        const place = placeOf(places, HOME);
        if (!place) {
            return result(false, 'no_place');
        }
        const dimension = options?.dimension;
        if (place.dimension && typeof dimension === 'string' && dimension !== ''
            && normalizeDimension(place.dimension) !== normalizeDimension(dimension)) {
            return result(false, 'other_dimension');
        }
        if (isPoint(botPos) && Math.hypot(place.x - botPos.x, place.y - botPos.y, place.z - botPos.z) > AUTO_HOME_RANGE) {
            return result(false, 'too_far');
        }
        if (!loaded(getBlock, place)) {
            return result(false, 'not_loaded');
        }
        if (tried.has(store)) {
            return result(false, 'tried');
        }
        tried.add(store);
        const scan = scanBuilding(getBlock, place);
        if (!scan.found) {
            return result(false, 'no_walls', NO_WALLS_TEXT);
        }
        const area = store.set({ name: HOME, type: HOME, min: scan.min, max: scan.max,
            dimension: place.dimension ?? dimension, entrances: scan.entrances, source: 'auto' });
        return result(true, 'saved', savedText(area));
    } catch (err) {
        console.warn('Could not save the house as the area "home":', err?.message ?? err);
        return result(false, 'error');
    }
}
