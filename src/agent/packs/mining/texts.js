// Texts of the mining pack that the player or the model reads. The spec v0.1.4.7 M4 gives the
// texts of mineOre word for word, tests compare them; v0.1.4.9 (B2, B3, B4, B6) the texts of the
// mine of the player and of the ore list. Pure.
import { countsText, posText } from '../storage/texts.js';
import { ORES, ORE_NAMES, PICKAXE_LEVELS, oreOf } from './ore_table.js';

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
    underground: 'I am underground and start a new mine only from the surface',
    error: 'something went wrong',
});

/** Fixed texts. */
export const TEXTS = Object.freeze({
    noMine: 'I know no mine here.',
    noEntrance: 'I found no place for a mine within 48 blocks that is at least 16 blocks from your house and the areas I protect.',
    onSurface: 'I am on the surface already.',
    noStorage: 'I cannot store things: I have no storage skills.',
    noTools: 'I cannot craft: I have no tool skills.',
    carryOnly: 'I know no chests and cannot craft, so I go with what I carry.',
    underground: 'I am underground. I start a new mine only from the surface.',
    noTrail: 'I have no trail. The routes pack is off.',
    noMineHere: 'I know no mine here. Tell me "this is the mine" first.',
    noCorridor: 'I stand in no tunnel. A tunnel is 1 wide and 2 high and open ahead of me.',
    noRouteWalk: 'I cannot walk the way of the mine: the routes pack is off.',
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
 * The question of mineOre when it knows no mine for the ore (spec v0.1.4.8 E4):
 * `I know no mine for iron. I can dig a new one at (x, y, z), N blocks from your house. Tell me to do it, or show me your mine.`
 * Without a house the part `, N blocks from your house` is left out. Without a place for a new
 * mine: `I know no mine for iron. <TEXTS.noEntrance> Show me your mine.`
 * @param {string} ore
 * @param {{x,y,z}|null} entrance the place of a new mine, null when there is none
 * @param {number|null} [houseDistance] blocks from the house, null without a house
 * @returns {string}
 */
export function askMineText(ore, entrance, houseDistance = null) {
    if (!entrance) {
        return `I know no mine for ${ore}. ${TEXTS.noEntrance} Show me your mine.`;
    }
    const house = Number.isFinite(houseDistance) ? `, ${Math.round(houseDistance)} blocks from your house` : '';
    return `I know no mine for ${ore}. I can dig a new one at ${posText(entrance)}${house}. Tell me to do it, or show me your mine.`;
}

// One missing supply of tripNeeds as words: `16 ladders`, `1 torch`, `a chest`, `a stone pickaxe`.
function supplyWords(m) {
    const n = Number.isFinite(m?.count) && m.count > 0 ? Math.ceil(m.count) : 1;
    switch (m?.name) {
    case 'pickaxe':
        return `${m.spare ? 'a second' : article(m.material ?? 'stone')} ${m.material ?? 'stone'} pickaxe`;
    case 'ladder':
        return n === 1 ? '1 ladder' : `${n} ladders`;
    case 'torch':
        return n === 1 ? '1 torch' : `${n} torches`;
    case 'chest':
        return n === 1 ? 'a chest' : `${n} chests`;
    case 'food':
        return `${n} food`;
    default:
        return typeof m?.name === 'string' ? `${n} ${m.name}` : '';
    }
}

/**
 * What the bot gets before a trip (spec v0.1.4.8 E4), from the missing list of tripNeeds:
 * `I get my supplies: 16 ladders, 8 torches, a chest.` Cobblestone is left out (the way down
 * gives it). '' when nothing is missing.
 * @param {{name: string, count: number, material?: string, spare?: boolean}[]} missing
 * @returns {string}
 */
export function suppliesText(missing) {
    const order = ['pickaxe', 'ladder', 'torch', 'food', 'chest'];
    const words = (Array.isArray(missing) ? missing : []).filter(m => order.includes(m?.name))
        .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)).map(supplyWords).filter(w => w.length > 0);
    return words.length > 0 ? `I get my supplies: ${words.join(', ')}.` : '';
}

/**
 * The text of a trip stopped while the bot got its supplies (spec v0.1.4.8 I6):
 * `I was stopped while I got my supplies. I still lack 16 ladders, a chest.` or
 * `I was stopped while I got my supplies. I have all of them.`
 * @param {object[]} missing the missing list of tripNeeds at the stop
 * @returns {string}
 */
export function suppliesStoppedText(missing) {
    const lack = suppliesText(missing).replace(/^I get my supplies: /, '');
    return `I was stopped while I got my supplies. ${lack ? `I still lack ${lack}` : 'I have all of them.'}`;
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

// ------------------------------------------------------------------ the mine of the player (v0.1.4.9)

function plural(n, word) {
    return `${n} ${n === 1 ? word : `${word}s`}`;
}

/**
 * `the mine "mine"` for a mine with a name, else `the mine at (20, 64, -14)`.
 * @param {object} mine
 * @returns {string}
 */
export function mineLabel(mine) {
    if (typeof mine?.name === 'string' && mine.name.length > 0) {
        return `the mine "${mine.name}"`;
    }
    return mine?.entrance ? `the mine at ${posText(mine.entrance)}` : 'the mine';
}

/**
 * The text of rememberMine without an entrance (spec B2):
 * `I was not under open sky in my last 40 steps. Walk with me from the entrance of the mine and tell me again.`
 * @param {number} steps the steps of the trail
 * @returns {string}
 */
export function noEntranceText(steps) {
    const n = Number.isFinite(steps) ? steps : 0;
    return `I was not under open sky in my last ${n} steps. Walk with me from the entrance of the mine and tell me again.`;
}

/**
 * The way in of a mine in words (spec B2, like A2): `6 steps with 1 ladder and 1 trapdoor`; the
 * ladders, doors, gates and trapdoors in that order, when there are any.
 * @param {object[]} legs
 * @returns {string}
 */
export function wayWords(legs) {
    const list = Array.isArray(legs) ? legs : [];
    const n = kind => list.filter(l => (kind === 'ladder' ? l?.kind === 'ladder' : l?.kind === 'door' && l.kind2 === kind)).length;
    const things = [['ladder', n('ladder')], ['door', n('door')], ['gate', n('gate')], ['trapdoor', n('trapdoor')]]
        .filter(([, k]) => k > 0).map(([word, k]) => plural(k, word));
    return `${plural(list.length, 'step')}${things.length > 0 ? ` with ${listWords(things)}` : ''}`;
}

/**
 * The text of rememberMine (spec B2):
 * `I remember the mine "mine": the entrance at (30, 60, 4), the way in has 6 steps with 1 ladder and 1 trapdoor, the room at level 41 with a chest and a crafting table, one tunnel at level 25, 12 blocks long, going north.`
 * Without a room `no chest`, a room without a chest `with a crafting table and no chest`, without a
 * tunnel `no tunnel yet: stand in a tunnel and say "dig here"`. `I know a mine "mine" already. I replace it.`
 * in front when the name existed. With the area of type mine that holds the bot: `It is in the area "mining_area".` at the end.
 * @param {{name: string, entrance: object, route: object[], room: object|null, tunnel: object|null, replaced?: boolean, area?: string|null}} r
 * @returns {string}
 */
export function rememberMineText(r) {
    const parts = [`the entrance at ${posText(r?.entrance)}`, `the way in has ${wayWords(r?.route)}`];
    const room = r?.room;
    if (room?.center) {
        const things = [room.chest ? 'a chest' : null, room.table ? 'a crafting table' : null, room.furnace ? 'a furnace' : null].filter(Boolean);
        if (!room.chest) {
            things.push('no chest');
        }
        parts.push(`the room at level ${room.center.y} with ${listWords(things)}`);
    } else {
        parts.push('no chest');
    }
    const t = r?.tunnel;
    parts.push(t ? `one tunnel at level ${t.level}, ${plural(t.length, 'block')} long, going ${t.dir}` : 'no tunnel yet: stand in a tunnel and say "dig here"');
    const front = r?.replaced ? `I know a mine "${r.name}" already. I replace it. ` : '';
    const area = typeof r?.area === 'string' && r.area.length > 0 ? ` It is in the area "${r.area}".` : '';
    return `${front}I remember the mine "${r?.name}": ${parts.join(', ')}.${area}`;
}

/**
 * The text of rememberTunnel (spec B3):
 * `I measured the tunnel: it starts at (22, 25, 2), goes north, and ends at (22, 25, 13) after 12 blocks, at level 25. I dig on at its end when you ask for ore.`
 * @param {{start: object, dir: string, end: object, length: number, level: number}} t
 * @returns {string}
 */
export function rememberTunnelText(t) {
    return `I measured the tunnel: it starts at ${posText(t?.start)}, goes ${t?.dir}, and ends at ${posText(t?.end)} after ${plural(t?.length ?? 0, 'block')}, at level ${t?.level}. I dig on at its end when you ask for ore.`;
}

/**
 * The text of mineOre for a mine of the player without a tunnel for the ore (spec B4):
 * `Your mine "mine" has no tunnel where diamond is found (from -64 to 16). Its tunnels are at level 25. Show me a tunnel at that depth, or tell me to dig a new mine.`
 * One tunnel: `Its tunnel is at level 25.`; tunnels at several levels: `Its tunnels are at levels 40 and 25.`;
 * none: `It has no tunnel yet.`
 * @param {object} mine
 * @param {string|object} ore
 * @param {object[]} tunnels tunnelsOf(mine)
 * @returns {string}
 */
export function noTunnelText(mine, ore, tunnels) {
    const row = oreOf(ore);
    const list = Array.isArray(tunnels) ? tunnels : [];
    const levels = [...new Set(list.map(t => t?.level).filter(Number.isFinite))].sort((a, b) => b - a);
    let where = 'It has no tunnel yet.';
    if (list.length === 1) {
        where = `Its tunnel is at level ${levels[0]}.`;
    } else if (list.length > 1) {
        where = levels.length === 1 ? `Its tunnels are at level ${levels[0]}.` : `Its tunnels are at levels ${listWords(levels.map(String))}.`;
    }
    const name = row ? row.ore : String(ore ?? '');
    const range = row ? ` (from ${row.min} to ${row.max})` : '';
    return `Your mine "${mine?.name ?? 'mine'}" has no tunnel where ${name} is found${range}. ${where} Show me a tunnel at that depth, or tell me to dig a new mine.`;
}

// the words of a reason of the ore list (spec B6); pickaxe names the strongest material the ores need
function passedWhy(reason, ores) {
    switch (reason) {
    case 'pickaxe': {
        const need = ores.map(o => oreOf(o)?.pickaxe).filter(Boolean)
            .sort((a, b) => (PICKAXE_LEVELS[b] ?? 0) - (PICKAXE_LEVELS[a] ?? 0))[0] ?? 'iron';
        return `I need ${article(need)} ${need} pickaxe`;
    }
    case 'lava':
        return 'lava beside it';
    case 'inventory':
        return 'my inventory was full';
    case 'vein':
        return 'the vein was bigger than 12';
    default:
        return 'I was stopped';
    }
}

// the entries of one reason as `2 gold_ore and 1 diamond_ore`, in the order of the ore table
function passedKinds(entries) {
    const counts = new Map();
    for (const e of entries) {
        const row = oreOf(e?.ore);
        if (row) {
            counts.set(row.ore, (counts.get(row.ore) ?? 0) + 1);
        }
    }
    const kinds = ORES.filter(row => counts.has(row.ore));
    return { words: listWords(kinds.map(row => `${counts.get(row.ore)} ${row.ore}_ore`)), ores: kinds.map(row => row.ore) };
}

const PASSED_ORDER = Object.freeze(['pickaxe', 'lava', 'inventory', 'vein', 'stopped']);

function byReason(entries, sentence) {
    const out = [];
    for (const reason of PASSED_ORDER) {
        const mine = (Array.isArray(entries) ? entries : []).filter(e => e?.reason === reason);
        const { words, ores } = passedKinds(mine);
        if (words) {
            out.push(sentence(words, passedWhy(reason, ores)));
        }
    }
    return out.join(' ');
}

/**
 * The ore left behind on a trip (spec B6), one sentence per reason, the ores summed by kind:
 * `I left 2 gold_ore behind: I need an iron pickaxe. I left 3 coal_ore behind: my inventory was full.`
 * The reasons: pickaxe, lava (`lava beside it`), inventory (`my inventory was full`), vein (`the vein
 * was bigger than 12`), stopped (`I was stopped`). '' without entries.
 * @param {{ore: string, reason: string}[]} entries
 * @returns {string}
 */
export function passedText(entries) {
    return byReason(entries, (words, why) => `I left ${words} behind: ${why}.`);
}

/**
 * The text of collectPassedOre (spec B6):
 * `I collected 4 coal_ore that I had passed. 2 gold_ore stay: I need an iron pickaxe.`, without an
 * entry of the ore `I passed no coal in the mine "mine".`, stopped `I was stopped after 2 of 6 coal_ore.`
 * @param {{ore?: string|null, mine?: object, collected?: object, stay?: object[], none?: boolean, stopped?: boolean, done?: number, total?: number}} r
 *   collected: blocks taken by ore; stay: entries that stay
 * @returns {string}
 */
export function collectPassedText(r) {
    const row = oreOf(r?.ore);
    if (r?.none) {
        return `I passed no ${row ? row.ore : 'ore'} in ${mineLabel(r?.mine)}.`;
    }
    const kind = row ? `${row.ore}_ore` : 'ore blocks';
    if (r?.stopped) {
        return `I was stopped after ${r?.done ?? 0} of ${r?.total ?? 0} ${kind}.`;
    }
    const got = Object.entries(r?.collected ?? {}).filter(([, n]) => n > 0);
    const words = got.length > 0 ? listWords(got.map(([ore, n]) => `${n} ${ore}_ore`)) : `0 ${kind}`;
    const stay = byReason(r?.stay, (w, why) => `${w} stay: ${why}.`);
    return `I collected ${words} that I had passed.${stay ? ` ${stay}` : ''}`;
}
