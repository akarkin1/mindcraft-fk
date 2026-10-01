// v0.1.4.9, C2 (interface I8): the guard of !newAction against dig code. In the play test the model
// wrote tunnel code six times, each version different, one dug in the wrong direction. With the setting
// skills_over_code the glue asks isDiggingRequest() for the prompt of !newAction and for the last
// message of a player; a digging request gets digRefusalText() with the digging commands that are on,
// and the code model is not called. Pure: no imports, no world, no clock; never throws.
//
// A request is about digging when it holds one of the words, whole words, any case: dig, digs,
// digging, dug, tunnel, tunnels, shaft, mine, mining, strip mine, branch mine (also with a hyphen),
// quarry, excavate. "mine" as a pronoun ("give me mine") counts too; the spec accepts that.
// An ore of the mining pack (also in the plural) counts only (a) followed by "ore" (iron ore, iron_ore,
// deepslate_iron_ore), or (b) with one of find, get, collect, gather, search, look, bring, fetch, need,
// want, hunt, mine within the 3 words before it ("get me some iron", "find diamonds"). An ore name alone
// names a material: "craft an iron pickaxe" is no digging request (decision of the tech lead).
// A word within 3 words after a negation (not, no, never, don't, dont, without, avoid; "no need to") in the
// same clause does not count: "do not dig straight down" is no digging request, "dig a tunnel, do not dig
// straight down" is one (the first dig counts).

/** The ores of the mining pack (packs/mining/ore_table.js, not imported). */
export const DIG_ORES = Object.freeze(['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond']);

/** The single words of a digging request. */
export const DIG_WORDS = Object.freeze(['dig', 'digs', 'digging', 'dug', 'tunnel', 'tunnels', 'shaft', 'mine', 'mining', 'quarry', 'excavate']);

/** The words that make an ore name without "ore" a digging request, within the 3 words before it. */
export const ORE_VERBS = Object.freeze(['find', 'get', 'collect', 'gather', 'search', 'look', 'bring', 'fetch', 'need', 'want', 'hunt', 'mine']);
const VERBS = new Set(ORE_VERBS);
const VERB_REACH = 3; // words before the ore name

/** The digging commands in the order of the text, each with its phrase. */
export const DIGGING_COMMANDS = Object.freeze(['!mineOre', '!rememberTunnel', '!collectBlocks']);

const PHRASES = Object.freeze({
    '!mineore': '!mineOre for an ore',
    '!remembertunnel': '!rememberTunnel and then !mineOre to dig on in a tunnel',
    '!collectblocks': '!collectBlocks for blocks in sight',
});

const REFUSAL_START = 'I do not write code for digging.';
const NO_SKILL_TEXT = `${REFUSAL_START} Switch on the mining pack, or type the command !newAction in the chat yourself.`;

// The longer forms first, so that "strip mine" is one word and not "mine", and "iron ore" one word and
// not "iron". The group `bare` is an ore name without "ore": it counts only after a word of ORE_VERBS.
const ORE_NAME = `(?:deepslate[\\s_-]+)?(?:${DIG_ORES.join('|')})s?`;
const WORD_PATTERN = new RegExp(
    '(?<![\\p{L}\\p{N}_])(?:'
    + '(?:strip|branch)[\\s-]+mine'
    + `|${ORE_NAME}[\\s_-]+ores?`
    + `|(?<bare>${ORE_NAME})`
    + `|${[...DIG_WORDS].sort((a, b) => b.length - a.length).join('|')}`
    + ')(?![\\p{L}\\p{N}_])',
    'giu');

/** The words of a negation: a digging word within 3 words after one of them does not count. */
export const NEGATIONS = Object.freeze(['not', 'no', 'never', "don't", 'dont', 'without', 'avoid']);
const NEGATION_SET = new Set(NEGATIONS);
const NEGATION_REACH = 3; // words after the negation ("no need to dig": dig is the third word after "no")

// True when one of the 3 words before `index`, in the same clause (after the last . , ; : ! ?), is a negation:
// "do not dig straight down", "without digging" (the owner's Luna session: !newAction("... do not dig") was refused).
function negatedBefore(text, index) {
    const before = text.slice(0, index);
    const clause = before.slice(before.search(/[^.,;:!?]*$/));
    const words = (clause.replace(/\u2019/g, "'").match(/[\p{L}\p{N}_']+/gu) ?? []).map((word) => word.toLowerCase());
    return words.slice(-NEGATION_REACH).some((word) => NEGATION_SET.has(word));
}

// True when one of the 3 words before `index` is a word of ORE_VERBS.
function verbBefore(text, index) {
    const before = text.slice(0, index).match(/[\p{L}\p{N}_']+/gu) ?? [];
    return before.slice(-VERB_REACH).some((word) => VERBS.has(word.toLowerCase()));
}

/**
 * Whether a text asks for digging, and the words that made it one: lower case, a hyphen or an
 * underscore as a space ("strip mine", "iron ore"), each once, in the order of the text. An ore name
 * without "ore" counts only with find, get, collect, gather, search, look, bring, fetch, need, want,
 * hunt or mine within the 3 words before it.
 * @param {string} text
 * @returns {{digging: boolean, words: string[]}}
 */
export function isDiggingRequest(text) {
    try {
        if (typeof text !== 'string' || text === '')
            return { digging: false, words: [] };
        const words = [];
        for (const match of text.matchAll(WORD_PATTERN)) {
            if (match.groups?.bare !== undefined && !verbBefore(text, match.index))
                continue; // a material: "an iron pickaxe"
            if (negatedBefore(text, match.index))
                continue; // "do not dig", "without digging"
            const word = match[0].toLowerCase().replace(/[\s_-]+/g, ' ');
            if (!words.includes(word))
                words.push(word);
        }
        return { digging: words.length > 0, words };
    } catch {
        return { digging: false, words: [] };
    }
}

/**
 * The answer of !newAction to a digging request. commands: the digging commands that are on (the
 * glue gives them, with or without "!"). With !mineOre on:
 * `I do not write code for digging. I have skills for it: !mineOre for an ore, !rememberTunnel and then !mineOre to dig on in a tunnel, !collectBlocks for blocks in sight.`
 * with only the commands that are on, in that order; !rememberTunnel is named only together with
 * !mineOre, since its phrase names both. Without any of them:
 * `I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.`
 * @param {string[]} commands
 * @returns {string}
 */
export function digRefusalText(commands) {
    try {
        const on = new Set();
        for (const c of Array.isArray(commands) ? commands : []) {
            if (typeof c !== 'string' || c.trim() === '')
                continue;
            const name = c.trim().toLowerCase();
            on.add(name.startsWith('!') ? name : `!${name}`);
        }
        const phrases = [];
        for (const command of DIGGING_COMMANDS) {
            const key = command.toLowerCase();
            if (!on.has(key))
                continue;
            if (key === '!remembertunnel' && !on.has('!mineore'))
                continue; // its phrase names !mineOre
            phrases.push(PHRASES[key]);
        }
        return phrases.length > 0 ? `${REFUSAL_START} I have skills for it: ${phrases.join(', ')}.` : NO_SKILL_TEXT;
    } catch {
        return NO_SKILL_TEXT;
    }
}
