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
//   Mines: iron, entrance (9, 67, 58), level 16.
//   Places: home (12, 67, 52), mine (9, 67, 58).
// The text is cut at whole lines to maxChars: the header, where the bot is, the areas and the mines
// come first, then the chests, the nearest first, then the places.

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

/**
 * The line of where the bot is: `You are in the area "farm" (farm), on the surface.`, under the
 * ground `You are in the area "mine" (mine), 26 blocks under the ground.`; without an area
 * `You are on the surface.` or `You are 26 blocks under the ground.` '' without `where`.
 * @param {{area?: {name: string, type?: string|null}|null, depth?: number, underground?: boolean}|null} where
 * @returns {string}
 */
export function whereLine(where) {
    if (!where || typeof where !== 'object') {
        return '';
    }
    const depth = isFiniteNumber(where.depth) && where.depth > 0 ? Math.round(where.depth) : 0;
    const level = where.underground === true
        ? (depth > 0 ? `${depth} ${depth === 1 ? 'block' : 'blocks'} under the ground` : 'under the ground')
        : 'on the surface';
    const area = where.area && typeof where.area.name === 'string' ? where.area : null;
    if (area) {
        return `You are in the area "${area.name}" (${typeof area.type === 'string' && area.type ? area.type : 'building'}), ${level}.`;
    }
    return `You are ${level}.`;
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

/**
 * The line of the mines: `Mines: iron, entrance (9, 67, 58), level 16.`, several joined by `; `.
 * '' without mines.
 * @param {object[]} mines
 * @returns {string}
 */
export function minesLine(mines) {
    const parts = [];
    for (const m of Array.isArray(mines) ? mines : []) {
        if (!m || !isPoint(m.entrance) || typeof m.ore !== 'string') {
            continue;
        }
        const ores = [m.ore, ...(Array.isArray(m.ores) ? m.ores : [])].filter((o, i, all) => typeof o === 'string' && all.indexOf(o) === i);
        const level = isFiniteNumber(m.level) ? `, level ${m.level}` : '';
        parts.push(`${ores.join(' and ')}, entrance ${posText(m.entrance)}${level}`);
    }
    return parts.length > 0 ? `Mines: ${parts.join('; ')}.` : '';
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
 * where the bot is, the areas and the mines come first, then as many chests as fit, the nearest
 * first, then the places; the lines keep the order of the format. '' when nothing is known.
 * @param {{chests?: object[]|{list: Function}, areas?: object[]|{list: Function}, mines?: object[]|{list: Function},
 *   places?: object[]|object, where?: {area?: object|null, depth?: number, underground?: boolean, pos?: {x,y,z}}|null}} input
 *   chests: the chests of the chest index (of the dimension of the bot); areas: the saved areas;
 *   mines: the mines of the mine store; places: the saved places; where: agent.whereAmI() and the position
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
        const tail = [areasLine(listOf(k.areas)), minesLine(listOf(k.mines))].filter(Boolean);
        const chestLines = ordered.map(chestKnowledgeLine);
        const places = placesLine(placesOf(k.places));
        if (head.length + tail.length + chestLines.length + (places ? 1 : 0) === 0) {
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
        const keptChests = [];
        for (const line of chestLines) {
            if (!take(line)) {
                break;
            }
            keptChests.push(line);
        }
        const keptPlaces = places && take(places) ? [places] : [];
        const lines = [...keptHead, ...keptChests, ...keptTail, ...keptPlaces];
        return lines.length > 0 ? [KNOWLEDGE_HEADER, ...lines].join('\n') : '';
    } catch {
        return '';
    }
}
