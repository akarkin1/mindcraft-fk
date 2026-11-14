// The texts of the base survey (v0.1.4.15, SPEC 2.5; engineer E1), word for word: the report of !surveyBase, its kept finds
// and cave mouths, the "again" line of a survey with a saved base, the line when nothing is found, and the texts of
// !renameArea, !forgetArea (a base) and !goToBase. Pure: no imports, nothing here throws, every number comes from the
// contents the survey counted (nothing is said that the code did not check).
//
// The report's items, in this order (2.5): the home, the basement, the hall, the other buildings, the farms with their size,
// the pens with their count, the cane, the tied animals, the portal, the mine entrance, the cave mouths (within a role in the
// order found, as the example of 2.5); a kept find after the items of its kind. A name is written with spaces (`potato_farm`
// → `potato farm`); the owner renames by the name with or without them (normalizeAreaName).

/** The order of the report's items by their role (2.5). */
export const REPORT_ORDER = Object.freeze(['home', 'basement', 'hall', 'building', 'farm', 'pen', 'cane', 'tied', 'portal', 'mine', 'cave']);

// Animals whose name is the same for one and for more.
const SAME_PLURAL = new Set(['sheep']);
// Pets, never the animals of a pen (PETS of area_kind.js, a copy: this module imports nothing).
const PETS = new Set(['cat', 'wolf', 'parrot']);

function words(name) {
    return typeof name === 'string' ? name.replace(/^minecraft:/, '').replace(/_/g, ' ') : '';
}

function count(n) {
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function plural(word) {
    if (SAME_PLURAL.has(word)) {
        return word;
    }
    return /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}

function countWords(n, one) {
    return `${n} ${n === 1 ? one : plural(one)}`;
}

function pointText(p) {
    if (!p || ![p.x, p.y, p.z].every(v => typeof v === 'number' && Number.isFinite(v))) {
        return '(?, ?, ?)';
    }
    return `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}

function baseName(name) {
    return typeof name === 'string' ? name.replace(/_\d+$/, '') : '';
}

function sizeOf(box) {
    if (!box?.min || !box?.max) {
        return '';
    }
    return `${Math.abs(box.max.x - box.min.x) + 1} x ${Math.abs(box.max.z - box.min.z) + 1}`;
}

// The animals of a pen (pets excluded), the most first, then by name: `5 cows, 2 pigs`.
function animalsWords(contents) {
    const list = Object.entries(contents?.animals ?? {}).filter(([name, n]) => !PETS.has(words(name).replace(/ /g, '_')) && count(n) > 0)
        .map(([name, n]) => [words(name), count(n)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return list.map(([name, n]) => countWords(n, name)).join(', ');
}

// The counted things of a building: beds, chests, furnaces.
function roomWords(contents) {
    const parts = [];
    for (const [key, one] of [['beds', 'bed'], ['chests', 'chest'], ['furnaces', 'furnace']]) {
        const n = count(contents?.[key]);
        if (n > 0) {
            parts.push(countWords(n, one));
        }
    }
    return parts.join(', ');
}

/**
 * The role of a place in the report (REPORT_ORDER): by what the survey saved about it (its kind, its detail, its name).
 * @param {object} place a place of findPlaces or of the underground (E4), or a saved area
 * @returns {string} one of REPORT_ORDER
 */
export function roleOf(place) {
    const base = baseName(place?.name);
    const kind = place?.kind ?? place?.type ?? '';
    const detail = place?.detail ?? {};
    const what = typeof detail.what === 'string' ? detail.what : '';
    if (base === 'cave_mouth' || kind === 'cave_mouth' || what === 'cave_mouth' || place?.flags?.no_enter === true || detail.no_enter === true) {
        return 'cave';
    }
    if (base === 'mine_entrance' || kind === 'mine_entrance' || what === 'mine_entrance') {
        return 'mine';
    }
    if (base === 'basement' || what === 'basement' || typeof detail.under === 'string') {
        return 'basement';
    }
    if (base === 'trading_hall' || kind === 'trading_hall' || Array.isArray(detail.professions) && count(detail.villagers) >= 2) {
        return 'hall';
    }
    if (base === 'cane' || what === 'cane') {
        return 'cane';
    }
    if (kind === 'tied' || base.startsWith('tied_')) {
        return 'tied';
    }
    if (kind === 'portal' || base === 'portal') {
        return 'portal';
    }
    if (kind === 'home') {
        return 'home';
    }
    if (kind === 'farm') {
        return 'farm';
    }
    if (kind === 'pen') {
        return 'pen';
    }
    return 'building';
}

/**
 * One item of the report (2.5): `house (2 beds)`, `basement (9 chests, 5 furnaces)`, `trading hall (7 villagers)`,
 * `potato farm 14 x 9` (the field's size), `cow pen (5 cows)` (the animals, pets excluded), `cane by the water (22)`,
 * `a tied happy ghast at (x, y, z)`, `a portal at (x, y, z)`, `a mine entrance at (x, y, z)`, `a cave mouth at (x, y, z)
 * that I keep out of`. A count of 0 is left out.
 * @param {object} place
 * @returns {string}
 */
export function itemText(place) {
    const name = words(place?.name);
    const role = roleOf(place);
    const at = place?.at ?? place?.detail?.at ?? null;
    switch (role) {
        case 'home':
        case 'basement':
        case 'building': {
            const inside = roomWords(place?.contents);
            return inside ? `${name} (${inside})` : name;
        }
        case 'hall': {
            const n = count(place?.detail?.villagers);
            return n > 0 ? `${name} (${countWords(n, 'villager')})` : name;
        }
        case 'farm': {
            const size = sizeOf(place?.detail?.field ?? place?.box);
            return size ? `${name} ${size}` : name;
        }
        case 'pen': {
            const inside = animalsWords(place?.contents);
            return inside ? `${name} (${inside})` : name;
        }
        case 'cane': {
            const n = count(place?.detail?.count);
            return n > 0 ? `${name} by the water (${n})` : `${name} by the water`;
        }
        case 'cave':
            return `a ${name} at ${pointText(at ?? centre(place?.box))} that I keep out of`;
        default: // tied, portal, mine
            return `a ${name} at ${pointText(at ?? centre(place?.box))}`;
    }
}

function centre(box) {
    if (!box?.min || !box?.max) {
        return null;
    }
    return { x: Math.floor((box.min.x + box.max.x + 1) / 2), y: Math.floor((box.min.y + box.max.y + 1) / 2), z: Math.floor((box.min.z + box.max.z + 1) / 2) };
}

// The words of a kept find: `a field`, `a pen`, `a house`, `a tied happy ghast` ...
function keptWords(kept) {
    const place = kept?.place ?? kept;
    const role = roleOf(place);
    switch (role) {
        case 'farm':
            return 'a field';
        case 'cane':
            return 'cane';
        case 'pen':
            return 'a pen';
        case 'home':
            return 'a house';
        case 'basement':
            return 'a basement';
        case 'hall':
            return 'a trading hall';
        case 'building':
            return place?.kind === 'storage' ? 'a storage' : 'a building';
        default:
            return `a ${words(place?.name)}`;
    }
}

/**
 * The words of a find the survey kept out of the owner's area (2.5): `a field at (x, y, z) inside your "wheat farm" (kept as
 * yours)`.
 * @param {{name: string, inside: string, at?: object, place?: object}} kept an entry of findPlaces' `kept`
 * @returns {string}
 */
export function keptText(kept) {
    const at = kept?.at ?? kept?.place?.at ?? centre(kept?.place?.box);
    return `${keptWords(kept)} at ${pointText(at)} inside your "${words(kept?.inside)}" (kept as yours)`;
}

// The items of one role in the order they were found (the example of 2.5 lists the farms and the pens as found: "by size"
// and "by count" say what they are given with, the field's size and the animals' count).
function itemsOf(places, role) {
    return places.filter(p => roleOf(p) === role);
}

/**
 * The report of !surveyBase (2.5), word for word: `I found 12 places: house (2 beds), basement (9 chests, 5 furnaces),
 * trading hall (7 villagers), potato farm 14 x 9, carrot farm 12 x 9, wheat farm 16 x 10, cow pen (5 cows), pig pen
 * (4 pigs), chicken pen (9 chickens), cane by the water (22), a tied happy ghast at (x, y, z), a mine entrance at (x, y, z).
 * All saved. Say "rename X to Y" or "forget X" to correct.` The items in the order of REPORT_ORDER, within a role as found,
 * the farms with the size of their field and the pens with the count of their animals; a kept find (`a field at (x, y, z)
 * inside your "wheat farm" (kept as yours)`) after the items of its kind; a cave mouth `a cave mouth at (x, y, z) that I keep
 * out of`. The count is that of the places saved.
 * @param {object[]} found the places saved (findPlaces' `places` and the places of the underground)
 * @param {object[]} [kept] findPlaces' `kept`
 * @param {string[]} [changed] the names of the found places that replaced a former survey's (reported like the rest)
 * @returns {string} '' when nothing was found and nothing kept (the caller says nothingFoundText)
 */
export function reportText(found, kept = [], changed = [], leftOut = []) {
    const places = Array.isArray(found) ? found.filter(p => p && typeof p === 'object') : [];
    const keptList = Array.isArray(kept) ? kept.filter(k => k && typeof k === 'object') : [];
    void changed;
    if (places.length === 0 && keptList.length === 0) {
        return '';
    }
    const items = [];
    for (const role of REPORT_ORDER) {
        items.push(...itemsOf(places, role).map(itemText));
        items.push(...keptList.filter(k => roleOf(k.place ?? k) === role).map(keptText));
    }
    const n = places.length;
    const left = leftOutText(leftOut);
    return `I found ${n} ${n === 1 ? 'place' : 'places'}: ${items.join(', ')}. All saved.${left ? ` ${left}` : ''} Say "rename X to Y" or "forget X" to correct.`;
}

/**
 * One cluster the survey left out (v0.1.4.16, F2), word for word: `N places about D blocks <dir> (another base or a
 * village): not saved; survey it from there for its own name`, N its count, D the distance from the start to its nearest
 * find rounded to 10, `<dir>` one of north, south, east, west, north-east, north-west, south-east, south-west.
 * @param {{count: number, distance: number, dir: string}} cluster of leftOutOf (survey_logic.js)
 * @returns {string}
 */
export function leftOutItem(cluster) {
    const n = count(cluster?.count);
    const d = typeof cluster?.distance === 'number' && Number.isFinite(cluster.distance) ? Math.max(0, Math.round(cluster.distance)) : 0;
    const dir = typeof cluster?.dir === 'string' && cluster.dir !== '' ? cluster.dir : 'north';
    return `${n} places about ${d} blocks ${dir} (another base or a village): not saved; survey it from there for its own name`;
}

/**
 * The sentence of the clusters the survey left out (F2), after `All saved.` of the report: `I left out <item>; <item>.`
 * (one item per cluster, joined with `; `); '' without a cluster.
 * @param {{count: number, distance: number, dir: string}[]} clusters
 * @returns {string}
 */
export function leftOutText(clusters) {
    const list = Array.isArray(clusters) ? clusters.filter(c => c && typeof c === 'object') : [];
    return list.length === 0 ? '' : `I left out ${list.map(leftOutItem).join('; ')}.`;
}

/**
 * The one sentence about a tied animal (2.2: the report says it once): `Never untie, never break that post.`; '' when no tied
 * animal is among the places.
 * @param {object[]} found
 * @returns {string}
 */
export function tiedRuleText(found) {
    const list = Array.isArray(found) ? found : [];
    return list.some(p => roleOf(p) === 'tied') ? 'Never untie, never break that post.' : '';
}

/**
 * The answer of !surveyBase when nothing is found (2.5): `I found no place of a base within 128 blocks. Stand in the base and
 * say it again.`
 * @param {number} radius
 * @returns {string}
 */
export function nothingText(radius) {
    const n = typeof radius === 'number' && Number.isFinite(radius) ? Math.floor(radius) : 0;
    return `I found no place of a base within ${n} blocks. Stand in the base and say it again.`;
}

/** The same text under the name of the lead's brief. */
export { nothingText as nothingFoundText };

/**
 * The line of a survey with a saved base of that name (2.4, 2.5), from the differences E4 computed (2.4: same name, the
 * animal counts or the box changed; new; gone when a saved survey place is not found and its seeds are gone): `I surveyed
 * "east" again: 2 more cows in the cow pen, the wheat farm is new, the pig pen is gone. The rest as saved.`; without a
 * difference, or with null, `I surveyed "east" again: nothing changed.` The parts: the animals (`2 more cows in the cow pen`,
 * `1 fewer cow in the cow pen` for a count below 0), then the places whose box changed (`the potato farm changed`), the new
 * ones (`the wheat farm is new`), the gone ones (`the pig pen is gone`), then the finds kept out of the owner's areas (W126
 * part C, with keptText: `a field at (x, y, z) inside your "wheat farm" (kept as yours)`); a kept find alone is a difference too.
 * @param {string} base the base's name
 * @param {{more?: {name: string, animal: string, count: number}[], changed?: string[], added?: string[], gone?: string[]}|null} changed
 *   more: the pens whose animals changed (count: the difference, below 0 for fewer); changed: the names whose box changed;
 *   added: the new names; gone: the names not found any more
 * @param {object[]} [kept] findPlaces' `kept` of this survey
 * @returns {string}
 */
export function againText(base, changed, kept = []) {
    const nameOf = (item) => words(typeof item === 'string' ? item : item?.name);
    const parts = [];
    for (const more of Array.isArray(changed?.more) ? changed.more : []) {
        const c = typeof more?.count === 'number' && Number.isFinite(more.count) ? Math.round(more.count) : 0;
        const n = Math.abs(c);
        if (n === 0 || typeof more?.animal !== 'string') {
            continue;
        }
        const animal = words(more.animal);
        parts.push(`${n} ${c > 0 ? 'more' : 'fewer'} ${n === 1 ? animal : plural(animal)} in the ${nameOf(more)}`);
    }
    for (const item of Array.isArray(changed?.changed) ? changed.changed : []) {
        parts.push(`the ${nameOf(item)} changed`);
    }
    for (const item of Array.isArray(changed?.added) ? changed.added : []) {
        parts.push(`the ${nameOf(item)} is new`);
    }
    for (const item of Array.isArray(changed?.gone) ? changed.gone : []) {
        parts.push(`the ${nameOf(item)} is gone`);
    }
    for (const k of Array.isArray(kept) ? kept.filter(k => k && typeof k === 'object') : []) {
        parts.push(keptText(k));
    }
    if (parts.length === 0) {
        return `I surveyed "${base}" again: nothing changed.`;
    }
    return `I surveyed "${base}" again: ${parts.join(', ')}. The rest as saved.`;
}

/** !renameArea (2.5): `I renamed "X" to "Y".` */
export function renamedText(oldName, newName) {
    return `I renamed "${oldName}" to "${newName}".`;
}

/** !renameArea (2.5): `I know no place "X".` */
export function unknownPlaceText(name) {
    return `I know no place "${name}".`;
}

/** !renameArea (2.5): `There is a place "Y" already.` */
export function placeExistsText(name) {
    return `There is a place "${name}" already.`;
}

/** !forgetArea of a base (2.5): `I forgot the base "X" and its 12 places.` */
export function forgotBaseText(name, count_) {
    const n = count(count_);
    return `I forgot the base "${name}" and its ${n} ${n === 1 ? 'place' : 'places'}.`;
}

/** !goToBase (2.5): `I am at the base "X".` */
export function atBaseText(name) {
    return `I am at the base "${name}".`;
}

/** !goToBase (2.5): `I know no base "X".` */
export function noBaseText(name) {
    return `I know no base "${name}".`;
}
