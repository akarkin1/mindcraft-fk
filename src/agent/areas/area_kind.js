// The kind of a place, concluded from its enclosure and what it holds (spec v0.1.4.11, I5, P1, P2). Pure: it
// reads the plain data it is given, never the world, and never throws on bad input. The enclosure comes from
// scanEnclosure of area_scan.js, the contents from countContents of area_sense.js.

/** The kinds of a place, in the order of the rules of kindOf. */
export const PLACE_KINDS = Object.freeze(['pen', 'farm', 'home', 'storage', 'building', 'yard']);

/**
 * The type of the area store for each kind (I5): a storage and a yard are saved as a building, so every reflex of
 * v0.1.4.10 that reads the type keeps working.
 */
export const KIND_TYPES = Object.freeze({ pen: 'pen', farm: 'farm', home: 'home', storage: 'building', building: 'building', yard: 'building' });

/** The sentence of what the bot does in a place of the kind (P1). */
export const KIND_SENTENCES = Object.freeze({
    pen: 'I keep its gate closed and pick nothing up inside it.',
    farm: 'I only plant and harvest there.',
    home: 'I shelter there at night.',
    storage: 'I use its chests.',
    building: 'I change nothing in it.',
    yard: 'I change nothing in it.',
});

/** The keys of the contents after the animals and the crops, in the order of the texts. */
export const CONTENT_KEYS = Object.freeze(['beds', 'chests', 'furnaces', 'tables', 'ladders', 'water']);

// The word of a border in front of a noun ("a fenced pen") and after a kind ("a pen, fenced").
const BORDER_WORDS = Object.freeze({ fence: 'fenced', wall: 'walled', glass: 'glass-walled', hedge: 'hedged', water: 'water-bound', mixed: 'enclosed' });

// One and more of the counted things that are not animals.
const COUNT_WORDS = Object.freeze({
    beds: ['bed', 'beds'], chests: ['chest', 'chests'], furnaces: ['furnace', 'furnaces'], tables: ['crafting table', 'crafting tables'],
    ladders: ['ladder', 'ladders'], water: ['water block', 'water blocks'],
});

// The crops by their block names; a name not here is written with spaces and an "s".
const CROP_WORDS = Object.freeze({
    wheat: ['wheat', 'wheat'], carrots: ['carrot', 'carrots'], potatoes: ['potato', 'potatoes'], beetroots: ['beetroot', 'beetroots'],
    melon_stem: ['melon stem', 'melon stems'], pumpkin_stem: ['pumpkin stem', 'pumpkin stems'],
    sweet_berry_bush: ['sweet berry bush', 'sweet berry bushes'], nether_wart: ['nether wart', 'nether wart'],
    torchflower_crop: ['torchflower', 'torchflowers'], pitcher_crop: ['pitcher plant', 'pitcher plants'],
});

const OPENING_WORDS = Object.freeze({ door: ['door', 'doors'], gate: ['gate', 'gates'], trapdoor: ['trapdoor', 'trapdoors'], gap: ['gap', 'gaps'] });
const OPENING_ORDER = ['door', 'gate', 'trapdoor', 'gap'];

// Animals whose name is the same for one and for more.
const SAME_PLURAL = new Set(['sheep']);

function isCount(n) {
    return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function countsOf(map) {
    if (map === null || typeof map !== 'object' || Array.isArray(map)) {
        return [];
    }
    return Object.entries(map).filter(([name, n]) => typeof name === 'string' && name !== '' && isCount(n))
        .map(([name, n]) => [name, Math.floor(n)]).filter(([, n]) => n > 0);
}

function byCount(a, b) {
    return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
}

function plural(word) {
    if (SAME_PLURAL.has(word)) {
        return word;
    }
    return /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}

function animalText(name, n) {
    const word = name.replace(/^minecraft:/, '').replace(/_/g, ' ');
    return `${n} ${n === 1 ? word : plural(word)}`;
}

function cropText(name, n) {
    const words = CROP_WORDS[name];
    if (words) {
        return `${n} ${n === 1 ? words[0] : words[1]}`;
    }
    const word = name.replace(/_/g, ' ');
    return `${n} ${n === 1 ? word : plural(word)}`;
}

function countText(n, [one, more]) {
    return `${n} ${n === 1 ? one : more}`;
}

/**
 * The sum of the animals of the contents.
 * @param {{animals?: Object<string, number>}|null} contents
 * @returns {number}
 */
export function animalCount(contents) {
    return countsOf(contents?.animals).reduce((sum, [, n]) => sum + n, 0);
}

function cropCount(contents) {
    return countsOf(contents?.crops).reduce((sum, [, n]) => sum + n, 0);
}

function numberOf(contents, key) {
    const n = contents?.[key];
    return isCount(n) ? Math.floor(n) : 0;
}

function openingsOf(enclosure) {
    return Array.isArray(enclosure?.openings) ? enclosure.openings.filter(o => o && typeof o.kind === 'string') : [];
}

function hasOpening(enclosure, kinds) {
    return openingsOf(enclosure).some(o => kinds.includes(o.kind));
}

/**
 * The kind of a place (I5), the first rule that fits: animals of 1 kind or more and an opening of kind gate or door:
 * `pen`; crops on a tilled floor: `farm`; a roof, a door and a bed: `home`; a roof and chests or furnaces: `storage`;
 * a roof and a door, or a roof and a trapdoor (a cellar entered from above, v0.1.4.11, F25): `building`; else `yard`.
 * scanEnclosure gives the opening kinds door, gate, trapdoor and gap (OPENING_KINDS of area_scan.js); a ladder is no
 * opening of its own, the trapdoor over its column is.
 * @param {{roof?: boolean, floor?: string, openings?: {kind: string}[]}|null} enclosure the result of scanEnclosure
 * @param {object|null} contents the result of countContents
 * @returns {'pen'|'farm'|'home'|'storage'|'building'|'yard'}
 */
export function kindOf(enclosure, contents) {
    const roof = enclosure?.roof === true;
    const door = hasOpening(enclosure, ['door']);
    if (animalCount(contents) > 0 && hasOpening(enclosure, ['gate', 'door'])) {
        return 'pen';
    }
    if (cropCount(contents) > 0 && enclosure?.floor === 'tilled') {
        return 'farm';
    }
    if (roof && door && numberOf(contents, 'beds') > 0) {
        return 'home';
    }
    if (roof && (numberOf(contents, 'chests') > 0 || numberOf(contents, 'furnaces') > 0)) {
        return 'storage';
    }
    if (roof && (door || hasOpening(enclosure, ['trapdoor']))) {
        return 'building';
    }
    return 'yard';
}

/**
 * The type of the area store for a kind (KIND_TYPES); an unknown kind gives null.
 * @param {string} kind
 * @returns {'pen'|'farm'|'home'|'building'|null}
 */
export function typeOfKind(kind) {
    return Object.hasOwn(KIND_TYPES, kind) ? KIND_TYPES[kind] : null;
}

/**
 * The counted contents as words, the counts that are not 0 in the order of P1: the animals by kind (the most first),
 * the crops (the most first), beds, chests, furnaces, crafting tables, ladders, water blocks.
 * `['6 chickens', '1 cow', '40 wheat', '1 bed']`
 * @param {object|null} contents
 * @returns {string[]}
 */
export function contentsParts(contents) {
    const parts = countsOf(contents?.animals).sort(byCount).map(([name, n]) => animalText(name, n));
    parts.push(...countsOf(contents?.crops).sort(byCount).map(([name, n]) => cropText(name, n)));
    for (const key of CONTENT_KEYS) {
        const n = numberOf(contents, key);
        if (n > 0) {
            parts.push(countText(n, COUNT_WORDS[key]));
        }
    }
    return parts;
}

/**
 * The openings as words, by kind in the order doors, gates, trapdoors, gaps: `['1 door', '1 trapdoor']`.
 * @param {{openings?: {kind: string}[]}|{kind: string}[]|null} enclosure an enclosure or its openings
 * @returns {string[]}
 */
export function openingsParts(enclosure) {
    const list = Array.isArray(enclosure) ? enclosure.filter(o => o && typeof o.kind === 'string') : openingsOf(enclosure);
    const parts = [];
    for (const kind of OPENING_ORDER) {
        const n = list.filter(o => o.kind === kind).length;
        if (n > 0) {
            parts.push(countText(n, OPENING_WORDS[kind]));
        }
    }
    return parts;
}

/**
 * The word of a border: fenced, walled, glass-walled, hedged, water-bound; enclosed for mixed or none.
 * @param {string|null} border
 * @returns {string}
 */
export function borderWord(border) {
    return Object.hasOwn(BORDER_WORDS, border) ? BORDER_WORDS[border] : 'enclosed';
}

/**
 * The size of the box in x and z: `9 x 7`. '' without a box.
 * @param {{min: object, max: object}|{x: number, z: number}|null} box a box, or a size {x, z}
 * @returns {string}
 */
export function sizeWords(box) {
    if (box && Number.isFinite(box.x) && Number.isFinite(box.z)) {
        return `${box.x} x ${box.z}`;
    }
    if (!box?.min || !box?.max) {
        return '';
    }
    const x = Math.abs(box.max.x - box.min.x) + 1;
    const z = Math.abs(box.max.z - box.min.z) + 1;
    return `${x} x ${z}`;
}

function listWords(parts) {
    if (parts.length <= 1) {
        return parts.join('');
    }
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The words after the size in P2 and P3: ` with a roof, 2 chests and 1 door` (the roof, the contents, the openings);
 * '' when there is nothing to name.
 * @param {{roof?: boolean, openings?: object[]}|null} enclosure
 * @param {object|null} contents
 * @returns {string}
 */
export function withWords(enclosure, contents) {
    const parts = [...(enclosure?.roof === true ? ['a roof'] : []), ...contentsParts(contents), ...openingsParts(enclosure)];
    return parts.length > 0 ? ` with ${listWords(parts)}` : '';
}

/**
 * The answer of !rememberArea (P1): `I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate
 * closed and pick nothing up inside it.` The name as saved, the kind, the border, the size of the box in x and z,
 * `with a roof` when it has one, the openings, the contents, the sentence of the kind.
 * @param {string} name
 * @param {string} kind
 * @param {{border?: string|null, roof?: boolean, openings?: object[]}|null} enclosure
 * @param {object|null} contents
 * @param {{min: object, max: object}} box
 * @returns {string}
 */
export function savedText(name, kind, enclosure, contents, box) {
    const size = sizeWords(box);
    const head = `a ${kind}, ${borderWord(enclosure?.border ?? null)}${size ? `, ${size}` : ''}${enclosure?.roof === true ? ' with a roof' : ''}`;
    const parts = [head, ...openingsParts(enclosure), ...contentsParts(contents)];
    return `I saved "${name}": ${parts.join(', ')}. ${KIND_SENTENCES[kind] ?? KIND_SENTENCES.building}`;
}

/**
 * The answer of !rememberArea when a type changes the kind of a saved area (P1):
 * `"aviary" is a farm now. I only plant and harvest there.`
 * @param {string} name
 * @param {string} kind
 * @returns {string}
 */
export function kindChangedText(name, kind) {
    return `"${name}" is a ${kind} now. ${KIND_SENTENCES[kind] ?? KIND_SENTENCES.building}`;
}

/**
 * The line of the area sense (P2): `I am in a fenced pen 9 x 7 with 6 chickens and 1 gate that I have not saved. Tell
 * me its name and I keep it.`
 * @param {string} kind
 * @param {{border?: string|null, roof?: boolean, openings?: object[]}|null} enclosure
 * @param {object|null} contents
 * @param {{min: object, max: object}} box
 * @returns {string}
 */
export function senseText(kind, enclosure, contents, box) {
    const word = borderWord(enclosure?.border ?? null);
    const article = /^[aeiou]/.test(word) ? 'an' : 'a';
    const size = sizeWords(box);
    return `I am in ${article} ${word} ${kind}${size ? ` ${size}` : ''}${withWords(enclosure, contents)} that I have not saved. `
        + 'Tell me its name and I keep it.';
}
