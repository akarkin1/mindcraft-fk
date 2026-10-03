// The area sense (spec v0.1.4.11, I5, I6, P2): what an enclosure around the bot holds, and the reflex that says what
// an unsaved enclosure seems to be. countContents and the scans read the world of the bot; senseStep is pure.
// Nothing here throws: a failed read is a place without an enclosure.
// v0.1.4.12 (F1 to F4): underground the sense names only a tunnel of a known mine (rockText), says nothing in a tunnel
// of no mine, in a cave or in any other place, and never asks for a name; the bot stands still while it scans.
import { Vec3 } from 'vec3';
import { scanEnclosure, useTunnelMeasure } from './area_scan.js';
import { kindOf, senseText, rockText } from './area_kind.js';
import { whereAmI as whereAmIOf } from '../reflex/where_am_i.js';

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

/** F3: the bot is underground at this depth or more, or when whereAmI says so. */
export const UNDERGROUND_SENSE_DEPTH = 8;

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
 * v0.1.4.12 (F1): with `options.border` 'rock' the water is not counted (the pockets of water of the rock).
 * @param {object} bot a mineflayer bot (entities, blockAt)
 * @param {{min: {x, y, z}, max: {x, y, z}}} box
 * @param {{border?: string|null}} [options] border: the border of the enclosure of the box
 * @returns {object}
 */
export function countContents(bot, box, options = {}) {
    const contents = emptyContents();
    const water = options?.border !== 'rock';
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
                    } else if (name === 'water' && water) {
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
 * F4: the bot stands still from the start of a scan to its end: its controls are cleared before the scan (the scan
 * itself never walks). A walk of the path finder is left alone when `keepWalk` is true. Never throws.
 * @param {object} bot
 * @param {{keepWalk?: boolean}} [options]
 */
export function standStill(bot, options = {}) {
    try {
        if (options?.keepWalk === true && bot?.pathfinder?.isMoving?.() === true) {
            return;
        }
        if (typeof bot?.clearControlStates === 'function') {
            bot.clearControlStates();
        }
    } catch {
        // a bot that cannot stop is scanned all the same
    }
}

/**
 * A place in rock (F1) that the bot stands in: the result of scanEnclosure with border 'rock' and a box that holds pos.
 * @param {object} enclosure
 * @param {{x: number, y: number, z: number}} pos
 * @returns {boolean}
 */
function isRockHere(enclosure, pos) {
    return enclosure?.border === 'rock' && isBox(enclosure.box) && inBox(enclosure.box, pos);
}

/**
 * The enclosure the bot stands in when no saved area holds it, else null (I6). Never throws.
 * v0.1.4.12 (F1): also a tunnel or a cave in rock (kind 'tunnel' or 'cave', the water not counted), whatever area holds
 * it; the bot stands still while it scans unless the path finder walks (F4).
 * @param {object} bot
 * @param {object[]} areas the saved areas
 * @param {{floors?: boolean, tunnelAt?: Function}} [options] floors: the setting area_floors; tunnelAt: the measure of
 *   a tunnel (tunnelAt of the mining pack), else the one registered with useTunnelMeasure
 * @returns {{enclosure: object, contents: object, kind: string, box: {min: object, max: object}}|null}
 */
export function unsavedEnclosure(bot, areas, options = {}) {
    try {
        const pos = bot?.entity?.position;
        if (!pos) {
            return null;
        }
        standStill(bot, { keepWalk: true });
        const scanOptions = { floors: options?.floors === true };
        if (typeof options?.tunnelAt === 'function') {
            scanOptions.tunnelAt = options.tunnelAt; // else the measure the sense registered (useTunnelMeasure)
        }
        const enclosure = scanEnclosure(blockNamesOf(bot), pos, scanOptions);
        if (isRockHere(enclosure, pos)) {
            const contents = countContents(bot, enclosure.box, { border: 'rock' });
            return { enclosure, contents, kind: kindOf(enclosure, contents), box: enclosure.box };
        }
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
 * roof }`, or null. v0.1.4.12 (F3): a place in rock is `{ saved: false, border: 'rock', kind: 'tunnel'|'cave', size,
 * tunnel: { width, length, dir }|null }`.
 * @param {{enclosure: object, contents: object, box: object}|null} found the result of unsavedEnclosure
 * @returns {object|null}
 */
export function enclosureKnowledge(found) {
    if (!found?.enclosure || !isBox(found.box)) {
        return null;
    }
    const box = orderedBox(found.box);
    if (found.enclosure.border === 'rock') {
        // v0.1.4.12 (F3): a tunnel or a cave; the knowledge line names only a tunnel of a known mine
        const tunnel = found.enclosure.tunnel;
        return {
            saved: false,
            border: 'rock',
            kind: tunnel ? 'tunnel' : 'cave',
            size: { x: box.max.x - box.min.x + 1, z: box.max.z - box.min.z + 1 },
            tunnel: tunnel ? { width: tunnel.width, length: tunnel.length, dir: tunnel.dir } : null,
        };
    }
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
 * Where the bot is for the sense (F3): `input.whereAmI()` (agent.whereAmI of the glue: the area, the depth, underground
 * and the mine), else whereAmI of reflex/where_am_i.js for the bot (without the mine). null when it cannot be read.
 * @param {object} bot
 * @param {{whereAmI?: Function, now?: number}} input
 * @returns {{depth?: number, underground?: boolean, mine?: object|null}|null}
 */
function whereOf(bot, input) {
    try {
        const where = typeof input?.whereAmI === 'function' ? input.whereAmI() : whereAmIOf(bot, input?.now ?? Date.now());
        return where && typeof where === 'object' ? where : null;
    } catch {
        return null;
    }
}

/**
 * True when the bot is underground for the sense (F3): whereAmI().underground, or a depth of 8 or more.
 * @param {{depth?: number, underground?: boolean}|null} where
 * @returns {boolean}
 */
export function isUndergroundHere(where) {
    return where?.underground === true || (Number.isFinite(where?.depth) && where.depth >= UNDERGROUND_SENSE_DEPTH);
}

/**
 * The mine of a tunnel for the sense (F3): whereAmI().mine when the bot is in a known mine, else null.
 * @param {{mine?: object|null}|null} where
 * @returns {object|null}
 */
function knownMine(where) {
    const mine = where?.mine;
    return mine && typeof mine === 'object' ? mine : null;
}

/**
 * One tick of the reflex area_sense (P2): scans at most every 2 s while the bot is outside the last enclosure it
 * found (the same enclosure is not scanned again while the bot stays in its box), applies senseStep, and returns the
 * line to say or null. Never throws.
 * v0.1.4.12 (F1 to F4): the bot stands still while it scans. A tunnel in rock of a known mine (whereAmI().mine) gets
 * the sentence of F2 once per tunnel per start; a tunnel of no mine and a cave get nothing. Underground (whereAmI()
 * .underground or a depth of 8 or more) the sense never asks for a name: it says nothing but that sentence. A scan
 * over 2 s adds `The scan took 3 s.` to the line it found.
 * @param {object} state newSenseState() with the fields this function adds
 * @param {object} bot
 * @param {{now: number, idle: boolean, areas: object[], floors?: boolean, whereAmI?: Function, tunnelAt?: Function}} input
 *   whereAmI: agent.whereAmI of the glue (optional); tunnelAt: tunnelAt of the mining pack when it is loaded (optional,
 *   registered with useTunnelMeasure for every scan; without it a tunnel is a cave)
 * @returns {string|null}
 */
export function senseTick(state, bot, input) {
    try {
        // F1: the measure of a tunnel is tunnelAt of the mining pack, given by the glue (never imported: packs are
        // reached at run time); kept by area_scan.js for every scan of a place
        if (typeof input?.tunnelAt === 'function') {
            useTunnelMeasure(input.tunnelAt);
        }
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
            standStill(bot); // F4: idle, so nothing walks that a scan could stop
            const enclosure = scanEnclosure(blockNamesOf(bot), pos, { floors: input.floors === true });
            if ((enclosure.found && inBox(enclosure.box, pos)) || isRockHere(enclosure, pos)) {
                state.found = { enclosure, box: enclosure.box, rock: enclosure.border === 'rock' };
            }
        }
        const found = state.found;
        let key = null;
        let line = null;
        if (found) {
            const where = whereOf(bot, input);
            if (found.rock) {
                const mine = found.enclosure.tunnel ? knownMine(where) : null;
                if (mine) {
                    key = `tunnel:${boxKey(found.box)}`;
                    line = () => rockText(found.enclosure, mine);
                }
            } else if (!isUndergroundHere(where) && !heldBySaved(input.areas, found.box, pos, bot.game?.dimension)) {
                key = boxKey(found.box);
                line = () => {
                    const contents = countContents(bot, found.box);
                    return senseText(kindOf(found.enclosure, contents), found.enclosure, contents, found.box);
                };
            }
        }
        if (!senseStep(state, { now, idle: true, key })) {
            return null;
        }
        const text = line();
        if (!text) {
            return null;
        }
        return found.enclosure.took ? `${text} ${found.enclosure.took}` : text;
    } catch {
        return null;
    }
}
