// The area sense (spec v0.1.4.11, I5, I6, P2): what an enclosure around the bot holds, and the reflex that says what
// an unsaved enclosure seems to be. countContents and the scans read the world of the bot; senseStep is pure.
// Nothing here throws: a failed read is a place without an enclosure.
import { Vec3 } from 'vec3';
import { scanEnclosure } from './area_scan.js';
import { kindOf, senseText } from './area_kind.js';

/** The timing of the area sense (P2). */
export const SENSE_RULES = Object.freeze({
    standMs: 3000, // the bot has stood inside the enclosure this long
    quietMs: 60000, // not within this long of the last line of the sense
    scanMs: 2000, // a new scan at most this often while the bot is outside every enclosure it found
});

/** The knowledge line (I6) is built at most this often. */
export const ENCLOSURE_KNOWLEDGE_MS = 10000;

/** The largest box whose blocks countContents reads (the largest area, 64 x 48 x 64). */
const MAX_COUNT_VOLUME = 64 * 48 * 64;

// Passive animals a player keeps behind a fence. Any entity of the type 'animal' counts too.
const ANIMALS = new Set(['chicken', 'cow', 'pig', 'sheep', 'rabbit', 'horse', 'donkey', 'mule', 'llama', 'trader_llama', 'goat',
    'mooshroom', 'turtle', 'cat', 'wolf', 'fox', 'bee', 'camel', 'armadillo', 'sniffer', 'frog', 'axolotl', 'panda',
    'polar_bear', 'ocelot', 'parrot', 'strider', 'hoglin']);

// Crop blocks by name; an attached stem counts as its stem.
const CROPS = new Map([['wheat', 'wheat'], ['carrots', 'carrots'], ['potatoes', 'potatoes'], ['beetroots', 'beetroots'],
    ['melon_stem', 'melon_stem'], ['attached_melon_stem', 'melon_stem'], ['pumpkin_stem', 'pumpkin_stem'],
    ['attached_pumpkin_stem', 'pumpkin_stem'], ['sweet_berry_bush', 'sweet_berry_bush'], ['nether_wart', 'nether_wart'],
    ['torchflower_crop', 'torchflower_crop'], ['pitcher_crop', 'pitcher_crop']]);

const CHESTS = new Set(['chest', 'trapped_chest', 'barrel']);
const FURNACES = new Set(['furnace', 'blast_furnace', 'smoker']);

function plainName(name) {
    return typeof name === 'string' ? name.replace(/^minecraft:/, '') : '';
}

function inBox(box, pos) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
        return false;
    }
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    return x >= box.min.x && x <= box.max.x && y >= box.min.y && y <= box.max.y && z >= box.min.z && z <= box.max.z;
}

function isBox(box) {
    return box && box.min && box.max && ['x', 'y', 'z'].every(k => Number.isFinite(box.min[k]) && Number.isFinite(box.max[k]));
}

function orderedBox(box) {
    return {
        min: { x: Math.floor(Math.min(box.min.x, box.max.x)), y: Math.floor(Math.min(box.min.y, box.max.y)), z: Math.floor(Math.min(box.min.z, box.max.z)) },
        max: { x: Math.floor(Math.max(box.min.x, box.max.x)), y: Math.floor(Math.max(box.min.y, box.max.y)), z: Math.floor(Math.max(box.min.z, box.max.z)) },
    };
}

function propertiesOf(block) {
    try {
        const props = typeof block.getProperties === 'function' ? block.getProperties() : block._properties;
        return props && typeof props === 'object' ? props : {};
    } catch {
        return {};
    }
}

/** Empty contents: every count 0. */
export function emptyContents() {
    return { animals: {}, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0 };
}

/**
 * What a box holds (I5): `{ animals: { chicken: 6, cow: 1 }, crops: { wheat: 40 }, beds: 1, chests: 2, furnaces: 0,
 * tables: 1, ladders: 0, water: 0 }`. Animals: the entities of the bot that stand in the box (passive animals by
 * name, and any entity of the type 'animal'). Blocks: crops by kind (an attached stem is a stem), beds (the head
 * block; a bed without its parts counts as half), chests and barrels (a double chest once), furnaces, blast
 * furnaces and smokers, crafting tables, ladders, water sources. Never throws: what cannot be read is not counted.
 * @param {object} bot a mineflayer bot (entities, blockAt)
 * @param {{min: {x, y, z}, max: {x, y, z}}} box
 * @returns {object}
 */
export function countContents(bot, box) {
    const contents = emptyContents();
    if (!isBox(box)) {
        return contents;
    }
    const b = orderedBox(box);
    try {
        for (const entity of Object.values(bot?.entities ?? {})) {
            const name = plainName(entity?.name);
            if (!name || entity === bot.entity || entity.type === 'player' || !(ANIMALS.has(name) || entity.type === 'animal')) {
                continue;
            }
            if (inBox(b, entity.position)) {
                contents.animals[name] = (contents.animals[name] ?? 0) + 1;
            }
        }
    } catch {
        // the animals are a help
    }
    const volume = (b.max.x - b.min.x + 1) * (b.max.y - b.min.y + 1) * (b.max.z - b.min.z + 1);
    if (typeof bot?.blockAt !== 'function' || volume > MAX_COUNT_VOLUME) {
        return contents;
    }
    let bedHalves = 0;
    try {
        for (let x = b.min.x; x <= b.max.x; x++) {
            for (let y = b.min.y; y <= b.max.y; y++) {
                for (let z = b.min.z; z <= b.max.z; z++) {
                    const block = bot.blockAt(new Vec3(x, y, z), false);
                    const name = plainName(block?.name);
                    if (!name || name === 'air') {
                        continue;
                    }
                    if (CROPS.has(name)) {
                        const crop = CROPS.get(name);
                        contents.crops[crop] = (contents.crops[crop] ?? 0) + 1;
                    } else if (name.endsWith('_bed')) {
                        const part = propertiesOf(block).part;
                        if (part === 'head') contents.beds++;
                        else if (part !== 'foot') bedHalves++;
                    } else if (CHESTS.has(name)) {
                        if (propertiesOf(block).type !== 'right') contents.chests++;
                    } else if (FURNACES.has(name)) {
                        contents.furnaces++;
                    } else if (name === 'crafting_table') {
                        contents.tables++;
                    } else if (name === 'ladder') {
                        contents.ladders++;
                    } else if (name === 'water') {
                        const level = Number(propertiesOf(block).level ?? 0);
                        if (!(level > 0)) contents.water++;
                    }
                }
            }
        }
    } catch {
        // what was counted so far
    }
    contents.beds += Math.ceil(bedHalves / 2);
    return contents;
}

/**
 * The name of the block at x, y, z for the scans, null when it is not loaded. Never throws.
 * @param {object} bot
 * @returns {(x: number, y: number, z: number) => string|null}
 */
export function blockNamesOf(bot) {
    return (x, y, z) => {
        try {
            return bot.blockAt(new Vec3(x, y, z))?.name ?? null;
        } catch {
            return null;
        }
    };
}

/**
 * True when a saved area holds the enclosure (I6): an area of the dimension whose box holds the middle of the
 * enclosure at the height of `pos` (the bot). Never throws.
 * @param {object[]} areas the saved areas
 * @param {{min: object, max: object}} box the box of the enclosure
 * @param {{x: number, y: number, z: number}} pos
 * @param {string} [dimension]
 * @returns {boolean}
 */
export function heldBySaved(areas, box, pos, dimension) {
    try {
        if (!Array.isArray(areas) || !isBox(box)) {
            return false;
        }
        const plain = (d) => (typeof d === 'string' && d !== '' ? d.replace(/^minecraft:/, '') : 'overworld');
        const middle = { x: Math.floor((box.min.x + box.max.x) / 2), y: Math.floor(pos?.y ?? box.min.y + 1), z: Math.floor((box.min.z + box.max.z) / 2) };
        return areas.some(area => isBox(area) && plain(area.dimension) === plain(dimension) && inBox(orderedBox(area), middle));
    } catch {
        return false;
    }
}

/**
 * The enclosure the bot stands in when no saved area holds it, else null (I6). Never throws.
 * @param {object} bot
 * @param {object[]} areas the saved areas
 * @param {{floors?: boolean}} [options] floors: the setting area_floors
 * @returns {{enclosure: object, contents: object, kind: string, box: {min: object, max: object}}|null}
 */
export function unsavedEnclosure(bot, areas, options = {}) {
    try {
        const pos = bot?.entity?.position;
        if (!pos) {
            return null;
        }
        const enclosure = scanEnclosure(blockNamesOf(bot), pos, { floors: options?.floors === true });
        if (!enclosure.found || !inBox(enclosure.box, pos) || heldBySaved(areas, enclosure.box, pos, bot.game?.dimension)) {
            return null;
        }
        const contents = countContents(bot, enclosure.box);
        return { enclosure, contents, kind: kindOf(enclosure, contents), box: enclosure.box };
    } catch {
        return null;
    }
}

/**
 * The input of the knowledge line (I6) for whereLine: `{ saved: false, border, size: { x, z }, contents, openings,
 * roof }`, or null.
 * @param {{enclosure: object, contents: object, box: object}|null} found the result of unsavedEnclosure
 * @returns {object|null}
 */
export function enclosureKnowledge(found) {
    if (!found?.enclosure || !isBox(found.box)) {
        return null;
    }
    const box = orderedBox(found.box);
    return {
        saved: false,
        border: found.enclosure.border ?? null,
        size: { x: box.max.x - box.min.x + 1, z: box.max.z - box.min.z + 1 },
        contents: found.contents,
        openings: (found.enclosure.openings ?? []).map(o => ({ ...o })),
        roof: found.enclosure.roof === true,
    };
}

/** The key of a box, the same for the same blocks. */
export function boxKey(box) {
    const b = orderedBox(box);
    return `${b.min.x},${b.min.y},${b.min.z}:${b.max.x},${b.max.y},${b.max.z}`;
}

/** A new state of the area sense, one per start of the bot. */
export function newSenseState() {
    return { said: new Set(), saidAt: null, key: null, since: null };
}

/**
 * One step of the rules of P2, pure: true when the line may be said now. The bot stands in the enclosure `key` (null:
 * in none or in a saved one); the line is said once per key, not while a command runs (`idle` false), not within 60 s
 * of the last line, and only after the bot has stood in the same enclosure for 3 s. A call that says yes notes the
 * line as said.
 * @param {{said: Set<string>, saidAt: number|null, key: string|null, since: number|null}} state
 * @param {{now: number, idle: boolean, key: string|null}} input
 * @returns {boolean}
 */
export function senseStep(state, input) {
    const now = input.now;
    if (!input.idle || input.key === null) {
        state.key = null;
        state.since = null;
        return false;
    }
    if (state.key !== input.key) {
        state.key = input.key;
        state.since = now;
    }
    if (state.said.has(input.key) || now - state.since < SENSE_RULES.standMs
        || (state.saidAt !== null && now - state.saidAt < SENSE_RULES.quietMs)) {
        return false;
    }
    state.said.add(input.key);
    state.saidAt = now;
    return true;
}

/**
 * One tick of the reflex area_sense (P2): scans at most every 2 s while the bot is outside the last enclosure it
 * found (the same enclosure is not scanned again while the bot stays in its box), applies senseStep, and returns the
 * line to say or null. Never throws.
 * @param {object} state newSenseState() with the fields this function adds
 * @param {object} bot
 * @param {{now: number, idle: boolean, areas: object[], floors?: boolean}} input
 * @returns {string|null}
 */
export function senseTick(state, bot, input) {
    try {
        const pos = bot?.entity?.position;
        const now = input.now;
        if (!input.idle || !pos) {
            senseStep(state, { now, idle: false, key: null });
            return null;
        }
        if (!(state.found && inBox(state.found.box, pos))) {
            if (state.scannedAt != null && now - state.scannedAt < SENSE_RULES.scanMs) {
                senseStep(state, { now, idle: true, key: null }); // outside: the 3 s start again
                return null;
            }
            state.scannedAt = now;
            state.found = null;
            const enclosure = scanEnclosure(blockNamesOf(bot), pos, { floors: input.floors === true });
            if (enclosure.found && inBox(enclosure.box, pos)) {
                state.found = { enclosure, box: enclosure.box };
            }
        }
        const found = state.found;
        const held = found ? heldBySaved(input.areas, found.box, pos, bot.game?.dimension) : false;
        const key = found && !held ? boxKey(found.box) : null;
        if (!senseStep(state, { now, idle: true, key })) {
            return null;
        }
        const contents = countContents(bot, found.box);
        return senseText(kindOf(found.enclosure, contents), found.enclosure, contents, found.box);
    } catch {
        return null;
    }
}
