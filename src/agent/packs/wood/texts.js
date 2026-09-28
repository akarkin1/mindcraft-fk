// Texts of the wood pack that the player or the model reads (spec v0.1.4.7 T2, T4). The spec
// gives some of them word for word, tests compare them. Pure.
import { WOOD_KINDS } from './tree_logic.js';

/** How far chopTrees looks for trees; the texts name it. */
export const TREE_RANGE = 48;

const LIST_MAX = 6;

function plural(n, one, many) {
    return n === 1 ? one : many;
}

function joinAnd(parts) {
    if (parts.length <= 1) {
        return parts.join('');
    }
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Counts as a list: sorted by count, highest first, then by name; at most 6 entries, then
 * ` and <n> more kinds` (spec 0.1). Entries with a count of 0 or less are left out.
 * @param {Object<string, number>} counts
 * @returns {string} for example `11 oak_log, 4 birch_log`; empty for no entries
 */
export function countList(counts) {
    const entries = Object.entries(counts ?? {})
        .filter(([, n]) => typeof n === 'number' && n > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const shown = entries.slice(0, LIST_MAX).map(([name, n]) => `${n} ${name}`).join(', ');
    const more = entries.length - LIST_MAX;
    return more > 0 ? `${shown} and ${more} more kinds` : shown;
}

/**
 * The name with `a` or `an`: `a stone_pickaxe`, `an iron_pickaxe`.
 * @param {string} name
 * @returns {string}
 */
export function withArticle(name) {
    return `${/^[aeiou]/i.test(String(name)) ? 'an' : 'a'} ${name}`;
}

/**
 * `I found no tree within 48 blocks. Logs of buildings are not mine to take.` With a kind:
 * `I found no birch tree within ...`.
 * @param {string|null} [kind]
 * @param {number} [range]
 * @returns {string}
 */
export function noTreeText(kind = null, range = TREE_RANGE) {
    return `I found no ${kind ? `${kind} ` : ''}tree within ${range} blocks. Logs of buildings are not mine to take.`;
}

/**
 * The text of chopTrees (spec T2): `I cut 2 oak trees and got 11 oak_log. I planted 2 saplings.`,
 * with ` 3 logs were too high for me.` for leftovers. Trees of several kinds: `I cut 3 trees and
 * got ...`. No sapling planted: `I had no sapling to plant.` Fewer logs than wanted and no more
 * trees: ` I found no more trees within 48 blocks.` Stopped: ` I was interrupted.` or
 * ` The time for cutting trees was over.` No tree cut: the text for no tree, `I could not reach
 * the trees I found.` or `I stopped before I cut a tree.`
 * @param {{trees: string[], logs?: Object<string, number>, planted?: number, leftover?: number,
 *   noMore?: boolean, stopped?: 'interrupted'|'time'|null, found?: number, kind?: string|null, range?: number}} s
 *   trees: the kind of every tree cut; logs: logs gained by name; found: trees found (when none was cut)
 * @returns {string}
 */
export function chopText(s) {
    const range = s.range ?? TREE_RANGE;
    const trees = Array.isArray(s.trees) ? s.trees : [];
    if (trees.length === 0) {
        if (s.stopped === 'interrupted') {
            return 'I stopped before I cut a tree.';
        }
        return (s.found ?? 0) > 0 ? 'I could not reach the trees I found.' : noTreeText(s.kind ?? null, range);
    }
    const kinds = new Set(trees);
    const kindWord = kinds.size === 1 ? `${trees[0]} ` : '';
    const list = countList(s.logs);
    const parts = [`I cut ${trees.length} ${kindWord}${plural(trees.length, 'tree', 'trees')} and got ${list || 'no logs'}.`];
    const planted = s.planted ?? 0;
    parts.push(planted > 0 ? `I planted ${planted} ${plural(planted, 'sapling', 'saplings')}.` : 'I had no sapling to plant.');
    const leftover = s.leftover ?? 0;
    if (leftover > 0) {
        parts.push(`${leftover} ${plural(leftover, 'log was', 'logs were')} too high for me.`);
    }
    if (s.noMore) {
        parts.push(`I found no more trees within ${range} blocks.`);
    }
    if (s.stopped === 'interrupted') {
        parts.push('I was interrupted.');
    } else if (s.stopped === 'time') {
        parts.push('The time for cutting trees was over.');
    }
    return parts.join(' ');
}

/**
 * `I do not know the wood "x". I know oak, spruce, ...`
 * @param {string} kind
 * @returns {string}
 */
export function unknownWoodText(kind) {
    return `I do not know the wood "${kind}". I know ${joinAnd([...WOOD_KINDS])}.`;
}

/**
 * `I have a stone_pickaxe.`
 * @param {string} name
 * @returns {string}
 */
export function haveToolText(name) {
    return `I have ${withArticle(name)}.`;
}

/**
 * `I crafted a stone_pickaxe.` or `I crafted a wooden_pickaxe and a stone_pickaxe.`
 * @param {string[]} names in the order they were crafted
 * @returns {string}
 */
export function craftedToolsText(names) {
    return `I crafted ${joinAnd(names.map(withArticle))}.`;
}

/**
 * `I need 3 iron_ingot for an iron_pickaxe and have 1.`, `... and have none.`
 * @param {string} name the item that is missing
 * @param {number} need how many the recipe needs in all
 * @param {number} have how many the bot has
 * @param {string} target for example `an iron_pickaxe` or `8 torch`
 * @returns {string}
 */
export function needText(name, need, have, target) {
    return `I need ${need} ${name} for ${target} and have ${have > 0 ? have : 'none'}.`;
}

/**
 * `I crafted 9 ladder.`
 * @param {number} count
 * @param {string} item
 * @returns {string}
 */
export function craftedSupplyText(count, item) {
    return `I crafted ${count} ${item}.`;
}

/**
 * `I do not know the tool "spoon". I know pickaxe, axe, shovel, hoe and sword.`
 * @param {string} kind
 * @returns {string}
 */
export function unknownToolText(kind) {
    return `I do not know the tool "${kind}". I know pickaxe, axe, shovel, hoe and sword.`;
}

/**
 * `I do not know the material "x". I know wooden, stone, iron, diamond and netherite.`
 * @param {string} material
 * @returns {string}
 */
export function unknownMaterialText(material) {
    return `I do not know the material "${material}". I know wooden, stone, iron, diamond and netherite.`;
}

/**
 * `I cannot craft "x" with this command. I craft torch, ladder, chest, crafting_table, stick and planks.`
 * @param {string} item
 * @returns {string}
 */
export function unknownSupplyText(item) {
    return `I cannot craft "${item}" with this command. I craft torch, ladder, chest, crafting_table, stick and planks.`;
}

/**
 * `I cannot craft a netherite_pickaxe. It is made at a smithing table, which I do not use.`
 * @param {string} name
 * @returns {string}
 */
export function notCraftableText(name) {
    return `I cannot craft ${withArticle(name)}. It is made at a smithing table, which I do not use.`;
}
