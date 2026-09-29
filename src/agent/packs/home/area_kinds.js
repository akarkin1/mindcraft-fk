// What the types of the saved areas mean for the home pack (spec v0.1.4.8, D2 and C3, C4). Pure.
// The table of the types lives in src/agent/areas/area_store.js (part D); this is the one module of
// the pack that reads it, so the other modules stay free of src/agent/areas.
import { isDefendedType, isShelterType } from '../../areas/area_store.js';
import { isBox } from './box_math.js';

// Types whose area is a building with walls and a roof. An area without a type is a building of
// an areas file older than v0.1.4.6.
const WALLED = Object.freeze(['home', 'building']);

/**
 * The type of an area; an area without a type counts as `building` (files of v0.1.4.5 and older).
 * @param {object} area
 * @returns {string|null} null for no area
 */
export function areaType(area) {
    if (area === null || typeof area !== 'object') {
        return null;
    }
    return typeof area.type === 'string' && area.type.length > 0 ? area.type : 'building';
}

/**
 * True for an area with a valid box of type `home`: the only type that is a shelter (C4).
 * @param {object} area
 * @returns {boolean}
 */
export function isShelterArea(area) {
    return isBox(area) && isShelterType(areaType(area));
}

/**
 * True for an area with a valid box whose type the creeper reflex defends (D2): all but `mine`.
 * @param {object} area
 * @returns {boolean}
 */
export function isDefendedArea(area) {
    return isBox(area) && isDefendedType(areaType(area));
}

/**
 * True for an area with a valid box that is a building with walls: `home`, `building`, or no type.
 * @param {object} area
 * @returns {boolean}
 */
export function hasWalls(area) {
    return isBox(area) && WALLED.includes(areaType(area));
}

/**
 * True for an area with a valid box of type `pen` or `farm`: the door service closes every open gate
 * of it that the bot passed (C5).
 * @param {object} area
 * @returns {boolean}
 */
export function isGatedArea(area) {
    const type = areaType(area);
    return isBox(area) && (type === 'pen' || type === 'farm');
}
