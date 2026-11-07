// What the chat model does not know (spec v0.1.4.14, part K, SPEC 4.7): the things of Minecraft 1.21.9 to 26.1 that
// the bot may meet, one plain sentence each, and the pure choice of the sentences for the prompt. The chat model was
// trained before 1.21.9: it does not know a copper pickaxe or a spear, and calls `iron_chain` `chain`. The data of
// 26.1 knows them, so every command works once the model names the thing.
//
// A thing is chosen when it is in the bag (`inventory`), in view (`near`: the blocks within 8 blocks and the entities
// within 16, nearThingNames), or named by one of the last lines (`lines`: the last chat lines and the last command
// text). A name of the table matches a line as a whole word, with spaces or underscores, singular or plural:
// "copper pickaxe", "copper_pickaxe", "spears", "shelf". "copper" alone matches nothing. Nothing here throws.
import { scanBox } from '../watch/look_logic.js';

/** The most sentences of the prompt (SPEC 4.7). */
export const NEW_THINGS_LIMIT = 3;
/** Blocks within this many blocks of the bot are in view. */
export const NEW_THINGS_BLOCK_RANGE = 8;
/** Entities within this many blocks of the bot are in view. */
export const NEW_THINGS_ENTITY_RANGE = 16;

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
const OXIDATION = ['', 'exposed_', 'weathered_', 'oxidized_'];
// a copper block in its four stages of oxidation, and each of them waxed
const copperVariants = (name) => [...OXIDATION.map((o) => `${o}${name}`), ...OXIDATION.map((o) => `waxed_${o}${name}`)];
const SPEAR_MATERIALS = ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite'];

function entry(names, since, line) {
    return Object.freeze({ names: Object.freeze(names), since, line });
}

/**
 * The table of SPEC 4.7, in its order: `{ names, since, line }`, the names as the registry of 26.1 spells them (items,
 * blocks, entities; the effect as minecraft-data names it, `BreathOfTheNautilus`), every variant listed.
 */
export const NEW_THINGS = Object.freeze([
    entry(['copper_pickaxe', 'copper_axe', 'copper_shovel', 'copper_hoe', 'copper_sword', 'copper_nugget', 'copper_helmet', 'copper_chestplate',
        'copper_leggings', 'copper_boots'], '1.21.9',
    'Copper tools and armour exist since 1.21.9: like stone but faster, 190 uses, from copper ingots; a copper pickaxe mines iron, copper and lapis, not diamond or gold.'),
    entry(copperVariants('copper_chest'), '1.21.9',
        'A copper chest is a chest with 27 slots; it oxidizes unless waxed; a copper golem takes items out of it.'),
    entry(['copper_golem', ...copperVariants('copper_golem_statue')], '1.21.9',
        'A copper golem sorts items: it carries up to 16 from a copper chest into a chest that is empty or holds that kind, within 32 blocks; a pumpkin on a copper block spawns one.'),
    entry(WOODS.map((wood) => `${wood}_shelf`), '1.21.9',
        'A shelf holds 3 item stacks; using a slot swaps it with the item in hand. It is not a chest.'),
    entry(['copper_torch', 'copper_wall_torch', ...copperVariants('copper_lantern'), ...copperVariants('copper_bars'), ...copperVariants('copper_chain'),
        'iron_chain'], '1.21.9',
    'Copper torches, lanterns, bars and chains work like the iron ones; the chain is called iron_chain now.'),
    entry(SPEAR_MATERIALS.map((material) => `${material}_spear`), '1.21.11',
        'A spear is a weapon with long reach since 1.21.11: a quick jab or a charge while running; wood to netherite; it breaks no blocks.'),
    entry(['parched'], '1.21.11',
        'A parched is a desert skeleton that does not burn in sunlight and shoots arrows of weakness.'),
    entry(['camel_husk'], '1.21.11',
        'A camel husk is an undead camel; with its husk and parched riders it is hostile, without them harmless.'),
    entry(['nautilus', 'zombie_nautilus'], '1.21.11',
        'A nautilus is a neutral ocean mob that dashes when hit and is tamed with pufferfish; a zombie nautilus carries a drowned with a trident.'),
    entry(['zombie_horse'], '1.21.11',
        'Zombie horses spawn at night with a zombie rider that holds a spear.'),
    entry(['golden_dandelion', 'potted_golden_dandelion'], '26.1',
        'A golden dandelion, used on a baby animal, stops it from growing; used again, it grows.'),
    entry(['name_tag'], '26.1',
        'A name tag is crafted from 1 paper and 1 nugget of any metal since 26.1.'),
    entry(['mannequin'], '1.21.9',
        'A mannequin is a player-shaped figure placed by command, not a mob.'),
    entry(['BreathOfTheNautilus'], '1.21.11',
        'Breath of the nautilus pauses the use of air under water.'),
]);

/**
 * A name as the table compares it: lower case, without `minecraft:`, words joined by underscores (`BreathOfTheNautilus`
 * is `breath_of_the_nautilus`, `Copper Pickaxe` is `copper_pickaxe`). '' for anything that is no string.
 * @param {*} name
 * @returns {string}
 */
export function thingKey(name) {
    if (typeof name !== 'string') {
        return '';
    }
    return name.trim().replace(/^minecraft:/i, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function words(name) {
    const key = thingKey(name);
    return key === '' ? [] : key.split('_');
}

// The words a name of the table is written with in a line. A family of names that end in the same words gets those
// words as a name too: the shelves `shelf`, the spears `spear` (the copper chests `copper_chest`, already a name).
function commonEnding(names) {
    const lists = names.map(words).filter((w) => w.length > 0);
    if (lists.length < 2) {
        return [];
    }
    const out = [];
    for (let i = 1; ; i++) {
        const word = lists[0][lists[0].length - i];
        if (word === undefined || !lists.every((w) => w[w.length - i] === word)) {
            break;
        }
        out.unshift(word);
    }
    return out;
}

// The plural forms of a last word: `spears`, `torches`, `shelves`, `nautiluses`.
function wordForms(word) {
    const forms = new Set([word, `${word}s`, `${word}es`]);
    if (word.endsWith('f')) {
        forms.add(`${word.slice(0, -1)}ves`);
    }
    if (word.endsWith('fe')) {
        forms.add(`${word.slice(0, -2)}ves`);
    }
    return forms;
}

// Per entry: the keys (exact names, for the bag and the view) and the word lists (for the lines).
const MATCHERS = NEW_THINGS.map((thing) => {
    const keys = new Set(thing.names.map(thingKey).filter(Boolean));
    const phrases = thing.names.map(words).filter((w) => w.length > 0);
    const ending = commonEnding(thing.names);
    if (ending.length > 0 && !phrases.some((p) => p.join('_') === ending.join('_'))) {
        phrases.push(ending);
    }
    return { thing, keys, phrases };
});

function phraseIn(tokens, phrase) {
    const last = wordForms(phrase[phrase.length - 1]);
    for (let i = 0; i + phrase.length <= tokens.length; i++) {
        let ok = true;
        for (let j = 0; j < phrase.length - 1 && ok; j++) {
            ok = tokens[i + j] === phrase[j];
        }
        if (ok && last.has(tokens[i + phrase.length - 1])) {
            return true;
        }
    }
    return false;
}

function tokensOf(line) {
    if (typeof line !== 'string' || line === '') {
        return [];
    }
    return line.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function namesOf(list) {
    const out = new Set();
    for (const item of Array.isArray(list) ? list : []) {
        const name = typeof item === 'string' ? item : item?.name;
        const key = thingKey(name);
        if (key !== '') {
            out.add(key);
        }
    }
    return out;
}

/**
 * The sentences of the new things that are present (SPEC 4.7), each once, at most `limit` (3): first the things in the
 * bag, then the things in view, then the things a line names, each group in the order of the table. A name matches a
 * line as a whole word, with spaces or underscores, singular or plural. [] when nothing matches. Pure; never throws.
 * @param {{inventory?: (string|{name: string})[], near?: (string|{name: string})[], lines?: string[], limit?: number}} input
 *   inventory: the names of the bag; near: the names of the blocks within 8 blocks and the entities within 16; lines: the
 *   last chat lines and the last command text
 * @returns {string[]}
 */
export function newThingLines({ inventory, near, lines, limit = NEW_THINGS_LIMIT } = {}) {
    try {
        const max = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : NEW_THINGS_LIMIT;
        const out = [];
        const add = (m) => {
            if (out.length < max && !out.includes(m.thing.line)) {
                out.push(m.thing.line);
            }
        };
        const bag = namesOf(inventory);
        const view = namesOf(near);
        for (const m of MATCHERS) {
            if ([...m.keys].some((k) => bag.has(k))) {
                add(m);
            }
        }
        for (const m of MATCHERS) {
            if ([...m.keys].some((k) => view.has(k))) {
                add(m);
            }
        }
        const tokenLists = (Array.isArray(lines) ? lines : typeof lines === 'string' ? [lines] : []).map(tokensOf).filter((t) => t.length > 0);
        for (const m of MATCHERS) {
            if (tokenLists.some((tokens) => m.phrases.some((p) => phraseIn(tokens, p)))) {
                add(m);
            }
        }
        return out;
    } catch {
        return [];
    }
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

/**
 * The names in view for newThingLines: the blocks within 8 blocks of the bot, read with the scan of the look tool
 * (scanBox of watch/look_logic.js: the layers nearest the bot first, at most 65,536 blocks), and the entities within 16
 * blocks. Only the names of the table are kept, each once. Pure over the reader; never throws.
 * @param {{reader?: {blockAt: (x: number, y: number, z: number) => object|null}, center?: {x, y, z},
 *   entities?: {name: string, position: {x, y, z}}[]}} input center: the cell of the bot; entities: an item on the
 *   ground by the name of its item
 * @returns {string[]}
 */
export function nearThingNames({ reader, center, entities } = {}) {
    const wanted = new Set(MATCHERS.flatMap((m) => [...m.keys]));
    const found = new Set();
    try {
        if (isPoint(center) && typeof reader?.blockAt === 'function') {
            const cell = { x: Math.floor(center.x), y: Math.floor(center.y), z: Math.floor(center.z) };
            scanBox(reader, cell, NEW_THINGS_BLOCK_RANGE, (block) => {
                const key = thingKey(block?.name);
                if (wanted.has(key)) {
                    found.add(key);
                }
            });
        }
        if (isPoint(center)) {
            for (const e of Array.isArray(entities) ? entities : []) {
                const key = thingKey(e?.name);
                if (!wanted.has(key) || !isPoint(e.position)) {
                    continue;
                }
                const d = Math.hypot(e.position.x - center.x, e.position.y - center.y, e.position.z - center.z);
                if (d <= NEW_THINGS_ENTITY_RANGE) {
                    found.add(key);
                }
            }
        }
    } catch {
        // what was found so far stands
    }
    return [...found];
}
