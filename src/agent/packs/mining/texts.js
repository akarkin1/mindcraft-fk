// Texts of the mining pack that the player or the model reads. The spec v0.1.4.7 M4 gives the
// texts of mineOre word for word, tests compare them. Pure.
import { countsText, posText } from '../storage/texts.js';
import { ORE_NAMES, oreOf } from './ore_table.js';

export { countsText, posText };

/** Why a trip ended early, as the text of M4 says it. */
export const STOP_REASONS = Object.freeze({
    pickaxe: 'my pickaxe is nearly broken',
    health: 'my health is low',
    hungry: 'I am hungry and have no food',
    time: 'the time for one trip is over',
    interrupted: 'you stopped me',
    inventory_full: 'my inventory is full and I could not store my things',
    blocked: 'my way is blocked by lava, water or caves',
    area: 'my way would lead into a protected area',
    unknown: 'I cannot see the blocks ahead of me',
    no_pickaxe: 'I have no pickaxe left',
    bottom: 'I reached the bottom of the world',
    stuck: 'I got stuck',
    no_path: 'I found no way there',
    ladder: 'I could not place a ladder',
    no_entrance: 'I found no place for a mine',
    error: 'something went wrong',
});

/** Fixed texts. */
export const TEXTS = Object.freeze({
    noMine: 'I know no mine here.',
    noEntrance: 'I found no place for a mine within 48 blocks that is at least 8 blocks from every protected area.',
    onSurface: 'I am on the surface already.',
    noStorage: 'I cannot store things: I have no storage skills.',
    noTools: 'I cannot craft: I have no tool skills.',
    carryOnly: 'I know no chests and cannot craft, so I go with what I carry.',
});

function listWords(words) {
    if (words.length <= 1) {
        return words.join('');
    }
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * `a` or `an` for a word.
 * @param {string} word
 * @returns {string}
 */
export function article(word) {
    return /^[aeiou]/i.test(String(word)) ? 'an' : 'a';
}

/**
 * `I do not know the ore "mithril". I know coal, copper, iron, lapis, gold, redstone and diamond.`
 * @param {string} name
 * @returns {string}
 */
export function unknownOreText(name) {
    return `I do not know the ore "${String(name ?? '').trim()}". I know ${listWords([...ORE_NAMES])}.`;
}

/**
 * `I cannot mine diamond. I need an iron pickaxe and have a stone_pickaxe.` Without a pickaxe:
 * `... and have no pickaxe.`
 * @param {string} ore
 * @param {string} material the material needed
 * @param {string|null} have the item name of the best pickaxe the bot has
 * @returns {string}
 */
export function cannotMineText(ore, material, have) {
    const row = oreOf(ore);
    const haveText = typeof have === 'string' && have.length > 0 ? `${article(have)} ${have}` : 'no pickaxe';
    return `I cannot mine ${row ? row.ore : ore}. I need ${article(material)} ${material} pickaxe and have ${haveText}.`;
}

/**
 * `The mine is at (20, 64, -14), its tunnel is 37 blocks long at level 16.`
 * @param {{entrance: object, length: number, level: number}} mine
 * @returns {string}
 */
export function mineText(mine) {
    if (!mine || !mine.entrance) {
        return '';
    }
    const length = Number.isFinite(mine.length) ? mine.length : 0;
    return `The mine is at ${posText(mine.entrance)}, its tunnel is ${length} ${length === 1 ? 'block' : 'blocks'} long at level ${mine.level}.`;
}

/**
 * The text of mineOre (spec M4):
 * `I mined 8 raw_iron. The mine is at (20, 64, -14), its tunnel is 37 blocks long at level 16. I also stored 96 cobblestone in the chest of the mine.`
 * or with less than asked `I mined 5 raw_iron of 8. I stopped because my pickaxe is nearly broken. The mine is at ...`
 * @param {{item: string, mined: number, wanted: number, reason?: string|null, mine?: object, stored?: object, extra?: string}} r
 * @returns {string}
 */
export function mineOreText(r) {
    const mined = Number.isFinite(r?.mined) ? r.mined : 0;
    const wanted = Number.isFinite(r?.wanted) ? r.wanted : mined;
    const parts = [];
    if (mined >= wanted) {
        parts.push(`I mined ${mined} ${r.item}.`);
    } else {
        parts.push(`I mined ${mined} ${r.item} of ${wanted}.`);
        const why = STOP_REASONS[r?.reason] ?? STOP_REASONS.error;
        parts.push(`I stopped because ${why}.`);
    }
    const where = mineText(r?.mine);
    if (where) {
        parts.push(where);
    }
    const stored = countsText(r?.stored ?? {});
    if (stored) {
        parts.push(`I also stored ${stored} in the chest of the mine.`);
    }
    if (typeof r?.extra === 'string' && r.extra.length > 0) {
        parts.push(r.extra);
    }
    return parts.join(' ');
}

/**
 * The text of descendToLevel.
 * @param {{level: number, mine?: object, dug?: number, ladders?: number, patches?: number, stairs?: number, climbed?: boolean}} r
 * @returns {string}
 */
export function descendText(r) {
    const at = r?.mine?.entrance ? ` in the mine at ${posText(r.mine.entrance)}` : '';
    if (r?.climbed) {
        return `I went down to level ${r.level}${at}.`;
    }
    const done = [`dug ${r?.dug ?? 0} blocks`, `placed ${r?.ladders ?? 0} ladders`];
    if ((r?.stairs ?? 0) > 0) {
        done.push(`made ${r.stairs} steps of a staircase`);
    }
    done.push(`closed ${r?.patches ?? 0} holes`);
    return `I went down to level ${r?.level}${at}: I ${listWords(done)}.`;
}

/**
 * The text of digTunnel.
 * @param {{steps: number, length: number, collected?: object, torches?: number, patches?: number, reason?: string|null}} r
 * @returns {string}
 */
export function tunnelText(r) {
    const parts = [`I dug ${r?.steps ?? 0} steps of the tunnel, it is ${r?.length ?? 0} blocks long now.`];
    const got = countsText(r?.collected ?? {});
    parts.push(`I collected ${got || 'no ore'}, placed ${r?.torches ?? 0} torches and closed ${r?.patches ?? 0} holes.`);
    if (r?.reason && STOP_REASONS[r.reason]) {
        parts.push(`I stopped because ${STOP_REASONS[r.reason]}.`);
    }
    return parts.join(' ');
}
