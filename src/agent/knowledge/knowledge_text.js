// What the bot knows, as a short block for the chat prompt (spec v0.1.4.8 E5, I9, finding C1: the
// chest index was only behind !chests, so the model walked and looked every time). Pure: no imports,
// no world, no clock; it reads the plain data it is given and never throws.
//
// Format, one item per line:
//   WHAT YOU KNOW (from memory, no need to check):
//   You are in the area "farm" (farm), on the surface.
//   Chest (11, 67, 53): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52, lapis_lazuli 49, coal 39 and 32 more kinds.
//   Chest (11, 41, 44): empty.
//   Areas: home (home), farm (farm, 1 gate), mine (mine).
//   Mines: iron, entrance (9, 67, 58), level 16; "mine", entrance (30, 60, 4), level 25.
//   Ore left behind: gold 2, coal 6 in the mine "mine".
//   Places: home (12, 67, 52), mine (9, 67, 58).
// In a mine (spec v0.1.4.9 I7, where.mine) the line of where the bot is names it:
//   You are in the area "mine" (mine), in the mine "mine", tunnel 1 at level 25, 35 blocks under the ground.
//   You are in the mine "mine", on its way in, 12 blocks under the ground.
// The text is cut at whole lines to maxChars: the header, where the bot is, the areas, the mines and
// the ore left behind come first, then the chests, the nearest first, then the places.

/** The first line of the block. */
export const KNOWLEDGE_HEADER = 'WHAT YOU KNOW (from memory, no need to check):';
/** The default upper limit of the block in characters (setting knowledge_max_chars). */
export const KNOWLEDGE_MAX_CHARS = 600;
/** Kinds of items a line of a chest names before `and N more kinds`. */
export const KNOWLEDGE_KINDS = 6;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function posText(p) {
    return `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}

// A list from an array, or from a store with list() (the chest index, the area store, the mine store).
function listOf(source) {
    try {
        if (Array.isArray(source)) {
            return source;
        }
        if (source && typeof source.list === 'function') {
            const list = source.list();
            return Array.isArray(list) ? list : [];
        }
    } catch {
        return [];
    }
    return [];
}

// Places as [{ name, x, y, z }] from a list, a map { name: {x, y, z} | [x, y, z] }, a PlaceStore
// (list()) or a MemoryBank (getJson()).
function placesOf(source) {
    let raw = source;
    try {
        if (raw && !Array.isArray(raw) && typeof raw.list === 'function') {
            raw = raw.list();
        } else if (raw && typeof raw.getJson === 'function') {
            raw = raw.getJson();
        }
    } catch {
        return [];
    }
    const out = [];
    if (Array.isArray(raw)) {
        for (const p of raw) {
            if (p && typeof p.name === 'string' && isPoint(p)) {
                out.push({ name: p.name, x: p.x, y: p.y, z: p.z });
            }
        }
    } else if (raw && typeof raw === 'object') {
        for (const [name, p] of Object.entries(raw)) {
            if (Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(isFiniteNumber)) {
                out.push({ name, x: p[0], y: p[1], z: p[2] });
            } else if (isPoint(p)) {
                out.push({ name, x: p.x, y: p.y, z: p.z });
            }
        }
    }
    return out;
}

function distance(a, b) {
    return Math.sqrt((a.x - (Math.floor(b.x) + 0.5)) ** 2 + (a.y - (Math.floor(b.y) + 0.5)) ** 2 + (a.z - (Math.floor(b.z) + 0.5)) ** 2);
}

/**
 * The line of a chest: `Chest (11, 67, 53): leaf_litter 104, cobblestone 81 and 32 more kinds.` or
 * `Chest (11, 41, 44): empty.` Kinds by count, the most first, then by name; at most 6.
 * @param {{x: number, y: number, z: number, items?: Object<string, number>}} chest
 * @returns {string}
 */
export function chestKnowledgeLine(chest) {
    const items = Object.entries(chest?.items ?? {}).filter(([name, n]) => typeof name === 'string' && isFiniteNumber(n) && n > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (items.length === 0) {
        return `Chest ${posText(chest)}: empty.`;
    }
    const shown = items.slice(0, KNOWLEDGE_KINDS).map(([name, n]) => `${name} ${n}`).join(', ');
    const more = items.length > KNOWLEDGE_KINDS ? ` and ${items.length - KNOWLEDGE_KINDS} more kinds` : '';
    return `Chest ${posText(chest)}: ${shown}${more}.`;
}

// The part of the line of where the bot is for where.mine (v0.1.4.9, I7): `in the mine "mine", tunnel 1
// at level 25` or `in the mine "mine", on its way in`. The tunnel is an index from 0, shown from 1; null
// means the bot is on the route of the mine. A mine without a name (dug by the bot) is `a mine`.
function mineParts(mine) {
    const name = typeof mine.name === 'string' && mine.name !== '' ? `the mine "${mine.name}"` : 'a mine';
    if (isFiniteNumber(mine.tunnel) && mine.tunnel >= 0) {
        const level = isFiniteNumber(mine.level) ? ` at level ${Math.round(mine.level)}` : '';
        return [`in ${name}`, `tunnel ${Math.floor(mine.tunnel) + 1}${level}`];
    }
    return [`in ${name}`, 'on its way in'];
}

// v0.1.4.11 (I6, P3): the words of the enclosure line, as areas/area_kind.js writes them for the area sense (this
// module stays without imports).
const ENCLOSURE_BORDERS = { fence: 'fenced', wall: 'walled', glass: 'glass-walled', hedge: 'hedged', water: 'water-bound', mixed: 'enclosed' };
const ENCLOSURE_COUNTS = [['beds', 'bed', 'beds'], ['chests', 'chest', 'chests'], ['furnaces', 'furnace', 'furnaces'],
    ['tables', 'crafting table', 'crafting tables'], ['ladders', 'ladder', 'ladders'], ['water', 'water block', 'water blocks']];
const ENCLOSURE_CROPS = { wheat: ['wheat', 'wheat'], carrots: ['carrot', 'carrots'], potatoes: ['potato', 'potatoes'],
    beetroots: ['beetroot', 'beetroots'], melon_stem: ['melon stem', 'melon stems'], pumpkin_stem: ['pumpkin stem', 'pumpkin stems'],
    sweet_berry_bush: ['sweet berry bush', 'sweet berry bushes'], nether_wart: ['nether wart', 'nether wart'],
    torchflower_crop: ['torchflower', 'torchflowers'], pitcher_crop: ['pitcher plant', 'pitcher plants'] };
const ENCLOSURE_OPENINGS = [['door', 'door', 'doors'], ['gate', 'gate', 'gates'], ['trapdoor', 'trapdoor', 'trapdoors'], ['gap', 'gap', 'gaps']];

function namedCounts(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
        return [];
    }
    return Object.entries(map).filter(([name, n]) => typeof name === 'string' && name !== '' && isFiniteNumber(n) && Math.floor(n) > 0)
        .map(([name, n]) => [name, Math.floor(n)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

function pluralWord(word) {
    if (word === 'sheep') {
        return word;
    }
    return /(s|x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`;
}

/**
 * The sentence of an enclosure that is not saved (v0.1.4.11, I6, P3):
 * `You stand in a fenced enclosure 9 x 7 with 6 chickens and 1 gate that is not saved.` After the size: a roof when
 * it has one, the contents (animals and crops, the most first, then beds, chests, furnaces, crafting tables, ladders,
 * water blocks), the openings (doors, gates, trapdoors, gaps). '' without an enclosure, or for a saved one.
 * @param {{saved?: boolean, border?: string|null, size?: {x: number, z: number}, contents?: object,
 *   openings?: {kind: string}[], roof?: boolean}|null} enclosure
 * @returns {string}
 */
export function enclosureLine(enclosure) {
    if (!enclosure || typeof enclosure !== 'object' || enclosure.saved !== false) {
        return '';
    }
    const word = Object.hasOwn(ENCLOSURE_BORDERS, enclosure.border) ? ENCLOSURE_BORDERS[enclosure.border] : 'enclosed';
    const size = isFiniteNumber(enclosure.size?.x) && isFiniteNumber(enclosure.size?.z) ? ` ${enclosure.size.x} x ${enclosure.size.z}` : '';
    const c = enclosure.contents && typeof enclosure.contents === 'object' ? enclosure.contents : {};
    const parts = enclosure.roof === true ? ['a roof'] : [];
    for (const [name, n] of namedCounts(c.animals)) {
        const animal = name.replace(/^minecraft:/, '').replace(/_/g, ' ');
        parts.push(`${n} ${n === 1 ? animal : pluralWord(animal)}`);
    }
    for (const [name, n] of namedCounts(c.crops)) {
        const words = ENCLOSURE_CROPS[name] ?? [name.replace(/_/g, ' '), pluralWord(name.replace(/_/g, ' '))];
        parts.push(`${n} ${n === 1 ? words[0] : words[1]}`);
    }
    for (const [key, one, more] of ENCLOSURE_COUNTS) {
        const n = isFiniteNumber(c[key]) ? Math.floor(c[key]) : 0;
        if (n > 0) {
            parts.push(`${n} ${n === 1 ? one : more}`);
        }
    }
    const openings = Array.isArray(enclosure.openings) ? enclosure.openings : [];
    for (const [kind, one, more] of ENCLOSURE_OPENINGS) {
        const n = openings.filter(o => o?.kind === kind).length;
        if (n > 0) {
            parts.push(`${n} ${n === 1 ? one : more}`);
        }
    }
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join('');
    const article = /^[aeiou]/.test(word) ? 'an' : 'a';
    return `You stand in ${article} ${word} enclosure${size}${list ? ` with ${list}` : ''} that is not saved.`;
}

// v0.1.4.12 (F3): the knowledge line underground names the tunnel of a known mine, as the area sense says it (F2,
// areas/area_kind.js tunnelText): `You stand in a tunnel 2 wide and 23 long, heading west, of the mine "mine".`; ''
// for a tunnel of no mine, a cave, and any other place underground.
const HEADINGS = ['north', 'east', 'south', 'west'];

function undergroundLine(enclosure, mine) {
    const t = enclosure?.border === 'rock' && enclosure.saved === false ? enclosure.tunnel : null;
    if (!t || !mine || !isFiniteNumber(t.width) || !isFiniteNumber(t.length) || !HEADINGS.includes(t.dir)) {
        return '';
    }
    const of = typeof mine.name === 'string' && mine.name !== '' ? `the mine "${mine.name}"` : 'my mine';
    return `You stand in a tunnel ${Math.round(t.width)} wide and ${Math.round(t.length)} long, heading ${t.dir}, of ${of}.`;
}

/**
 * The line of where the bot is: `You are in the area "farm" (farm), on the surface.`, under the
 * ground `You are in the area "mine" (mine), 26 blocks under the ground.`; without an area
 * `You are on the surface.` or `You are 26 blocks under the ground.` '' without `where`.
 * With `where.mine` (v0.1.4.9, I7) the bot is under the ground, and the mine is named:
 * `You are in the area "mine" (mine), in the mine "mine", tunnel 1 at level 25, 35 blocks under the ground.`
 * or `You are in the mine "mine", on its way in, 12 blocks under the ground.`
 * v0.1.4.11 (I6): with `where.enclosure` (an enclosure that no saved area holds) the line goes on with enclosureLine:
 * `You are on the surface. You stand in a fenced enclosure 9 x 7 with 6 chickens and 1 gate that is not saved.`
 * v0.1.4.12 (F3): underground (where.underground, a depth of 8 or more, or a place in rock) the line names only the
 * tunnel of a known mine (where.mine): `... You stand in a tunnel 1 wide and 12 long, heading south, of the mine
 * "mine".`; nothing else of the enclosure.
 * @param {{area?: {name: string, type?: string|null}|null, depth?: number, underground?: boolean,
 *   mine?: {name: string|null, tunnel: number|null, level?: number}|null, enclosure?: object|null}|null} where
 * @returns {string}
 */
export function whereLine(where) {
    if (!where || typeof where !== 'object') {
        return '';
    }
    const mine = where.mine && typeof where.mine === 'object' ? where.mine : null;
    const depth = isFiniteNumber(where.depth) && where.depth > 0 ? Math.round(where.depth) : 0;
    const level = where.underground === true || mine
        ? (depth > 0 ? `${depth} ${depth === 1 ? 'block' : 'blocks'} under the ground` : 'under the ground')
        : 'on the surface';
    const area = where.area && typeof where.area.name === 'string' ? where.area : null;
    const parts = [];
    if (area) {
        parts.push(`in the area "${area.name}" (${typeof area.type === 'string' && area.type ? area.type : 'building'})`);
    }
    if (mine) {
        parts.push(...mineParts(mine));
    }
    parts.push(level);
    const rock = where.enclosure?.border === 'rock';
    const under = rock || where.underground === true || mine !== null || (isFiniteNumber(where.depth) && where.depth >= 8);
    const enclosure = under ? undergroundLine(where.enclosure, mine) : enclosureLine(where.enclosure);
    return `You are ${parts.join(', ')}.${enclosure ? ` ${enclosure}` : ''}`;
}

/**
 * The line of the areas: `Areas: home (home), farm (farm, 1 gate), mine (mine).` An area without a
 * type is a building. '' without areas.
 * @param {object[]} areas
 * @returns {string}
 */
export function areasLine(areas) {
    const parts = [];
    for (const a of Array.isArray(areas) ? areas : []) {
        if (!a || typeof a.name !== 'string' || a.name.length === 0) {
            continue;
        }
        const gates = (Array.isArray(a.entrances) ? a.entrances : []).filter(e => e?.kind === 'gate').length;
        const type = typeof a.type === 'string' && a.type ? a.type : 'building';
        parts.push(`${a.name} (${type}${gates > 0 ? `, ${gates} ${gates === 1 ? 'gate' : 'gates'}` : ''})`);
    }
    return parts.length > 0 ? `Areas: ${parts.join(', ')}.` : '';
}

// The name of a mine (v0.1.4.9, I6): a string when the player named it, null for a mine of the bot.
function mineName(m) {
    return typeof m?.name === 'string' && m.name !== '' ? m.name : null;
}

/**
 * The line of the mines: `Mines: iron, entrance (9, 67, 58), level 16.`, several joined by `; `.
 * A mine the player named (v0.1.4.9, I6) is shown by its name, not by the ore the store needs:
 * `"mine", entrance (30, 60, 4), level 25`. '' without mines.
 * @param {object[]} mines
 * @returns {string}
 */
export function minesLine(mines) {
    const parts = [];
    for (const m of Array.isArray(mines) ? mines : []) {
        if (!m || !isPoint(m.entrance) || (typeof m.ore !== 'string' && mineName(m) === null)) {
            continue;
        }
        const ores = [m.ore, ...(Array.isArray(m.ores) ? m.ores : [])].filter((o, i, all) => typeof o === 'string' && all.indexOf(o) === i);
        const what = mineName(m) !== null ? `"${mineName(m)}"` : ores.join(' and ');
        const level = isFiniteNumber(m.level) ? `, level ${m.level}` : '';
        parts.push(`${what}, entrance ${posText(m.entrance)}${level}`);
    }
    return parts.length > 0 ? `Mines: ${parts.join('; ')}.` : '';
}

// The kinds of ore left behind in the order of the line: the deeper ore of the mining pack first (its
// table from the bottom), then any other kind by name.
const PASSED_ORDER = ['diamond', 'redstone', 'gold', 'lapis', 'iron', 'copper', 'coal'];

// The kind of the ore of an entry of `passed`: `gold`, `gold_ore` and `deepslate_gold_ore` are `gold`.
function passedKind(ore) {
    if (typeof ore !== 'string') {
        return null;
    }
    const kind = ore.trim().toLowerCase().replace(/^minecraft:/, '').replace(/^deepslate_/, '').replace(/_ore$/, '');
    return kind.length > 0 ? kind : null;
}

function passedRank(kind) {
    const at = PASSED_ORDER.indexOf(kind);
    return at >= 0 ? at : PASSED_ORDER.length;
}

/**
 * The line of the ore left behind in the mines (v0.1.4.9, I6 `passed`, I7):
 * `Ore left behind: gold 2, coal 6 in the mine "mine".`, several mines joined by `; `:
 * `Ore left behind: gold 2 in the mine "mine"; coal 3 in the mine "deep".` The kinds are counted per
 * mine, the deeper ore of the mining pack first (diamond, redstone, gold, lapis, iron, copper, coal),
 * then other kinds by name. A mine without a name is named by its entrance: `in the mine at (9, 67, 58)`.
 * Entries without an ore or a position are left out. '' without entries.
 * @param {object[]} mines
 * @returns {string}
 */
export function passedOreLine(mines) {
    const parts = [];
    for (const m of Array.isArray(mines) ? mines : []) {
        if (!m || typeof m !== 'object' || !Array.isArray(m.passed)) {
            continue;
        }
        const counts = new Map();
        for (const entry of m.passed) {
            const kind = isPoint(entry) ? passedKind(entry.ore) : null;
            if (kind !== null) {
                counts.set(kind, (counts.get(kind) ?? 0) + 1);
            }
        }
        if (counts.size === 0) {
            continue;
        }
        const kinds = [...counts].sort((a, b) => passedRank(a[0]) - passedRank(b[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([kind, n]) => `${kind} ${n}`).join(', ');
        const where = mineName(m) !== null ? `the mine "${mineName(m)}"` : (isPoint(m.entrance) ? `the mine at ${posText(m.entrance)}` : 'a mine');
        parts.push(`${kinds} in ${where}`);
    }
    return parts.length > 0 ? `Ore left behind: ${parts.join('; ')}.` : '';
}

/**
 * The line of the saved places: `Places: home (12, 67, 52), mine (9, 67, 58).` '' without places.
 * @param {{name: string, x: number, y: number, z: number}[]} places
 * @returns {string}
 */
export function placesLine(places) {
    const parts = (Array.isArray(places) ? places : []).map(p => `${p.name} ${posText(p)}`);
    return parts.length > 0 ? `Places: ${parts.join(', ')}.` : '';
}

/**
 * What the bot knows, for the chat prompt (spec v0.1.4.8 I9, E5). Pure; never throws.
 * The chests are listed the nearest first when `where.pos` (or `where.position`) gives the position
 * of the bot, otherwise in the order given. The text is cut at whole lines to `maxChars`: the header,
 * where the bot is, the areas, the mines and the ore left behind (v0.1.4.9) come first, then as many
 * chests as fit, the nearest first, then the places; the lines keep the order of the format. '' when
 * nothing is known.
 * @param {{chests?: object[]|{list: Function}, areas?: object[]|{list: Function}, mines?: object[]|{list: Function},
 *   places?: object[]|object, where?: {area?: object|null, depth?: number, underground?: boolean, mine?: object|null, pos?: {x,y,z}}|null}} input
 *   chests: the chests of the chest index (of the dimension of the bot); areas: the saved areas;
 *   mines: the mines of the mine store (with `passed`); places: the saved places; where: agent.whereAmI()
 *   and the position
 * @param {number} [maxChars] 600
 * @returns {string}
 */
export function knowledgeText(input, maxChars = KNOWLEDGE_MAX_CHARS) {
    try {
        const k = input && typeof input === 'object' ? input : {};
        const limit = isFiniteNumber(maxChars) && maxChars > 0 ? Math.floor(maxChars) : KNOWLEDGE_MAX_CHARS;
        const where = k.where && typeof k.where === 'object' ? k.where : null;
        const pos = isPoint(where?.pos) ? where.pos : (isPoint(where?.position) ? where.position : null);
        const chests = listOf(k.chests).filter(isPoint);
        const ordered = pos ? chests.map((c, i) => ({ c, i, d: distance(pos, c) })).sort((a, b) => a.d - b.d || a.i - b.i).map(e => e.c) : chests;
        const head = [whereLine(where)].filter(Boolean);
        const mines = listOf(k.mines);
        const tail = [areasLine(listOf(k.areas)), minesLine(mines)].filter(Boolean);
        const ore = passedOreLine(mines);
        const chestLines = ordered.map(chestKnowledgeLine);
        const places = placesLine(placesOf(k.places));
        if (head.length + tail.length + (ore ? 1 : 0) + chestLines.length + (places ? 1 : 0) === 0) {
            return '';
        }
        // choose the lines by importance, then write them in the order of the format
        let used = KNOWLEDGE_HEADER.length;
        if (used > limit) {
            return '';
        }
        const take = line => {
            if (used + 1 + line.length > limit) {
                return false;
            }
            used += 1 + line.length;
            return true;
        };
        const keptHead = head.filter(take);
        const keptTail = tail.filter(take);
        const keptOre = ore && take(ore) ? [ore] : []; // v0.1.4.9: after the mines, before the chests
        const keptChests = [];
        for (const line of chestLines) {
            if (!take(line)) {
                break;
            }
            keptChests.push(line);
        }
        const keptPlaces = places && take(places) ? [places] : [];
        const lines = [...keptHead, ...keptChests, ...keptTail, ...keptOre, ...keptPlaces];
        return lines.length > 0 ? [KNOWLEDGE_HEADER, ...lines].join('\n') : '';
    } catch {
        return '';
    }
}
