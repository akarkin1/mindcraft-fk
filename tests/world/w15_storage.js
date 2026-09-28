// W15 storage (spec v0.1.4.7 section 8 "Storage", S2 to S4): storage_pack on, world_memory on.
//   first   A chest 3 blocks from the bot, the inventory of the bot full (36 stacks). !storeItems:
//           the chest holds exactly what the keep plan of S2 stores, the bot still has its tools,
//           food up to 16, torches and the other things it keeps. The text of S3.
//   main    bots/<name>/.../chests.json has the chest with its items (S1).
//   second  After a restart of the agent, 40 blocks from the chest (no chest within 32 blocks, so
//           only the index can know it): !chests lists the chest, !fetchItem("bread", 5) walks to it
//           and takes 5 bread. Then three chests near the bot: one full, one with 2 free slots, one
//           empty. !storeItems with 5 stacks of oak_log: the full chest is skipped, the logs go into
//           the second chest until it is full and the rest into the third.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    waitFor, runPhase, listFiles, giveItems,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, buildChest, buildFullChest, chestItems, stableInventory, itemsText, hdist,
    entityPos, fmt,
} from './world.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_store';
const SETTINGS = { ...NEW_FLAGS_OFF, storage_pack: true, world_memory: true, keep_items: {} };

const r = region(48);
const g = r.g;
const CHEST_A = { x: r.ox + 3, y: g + 1, z: r.oz };
const START = { x: r.ox, y: g + 1, z: r.oz };
const FAR = { x: r.ox - 37, y: g + 1, z: r.oz }; // 40 blocks from chest A
const CHEST_B = { x: r.ox - 35, y: g + 1, z: r.oz + 5 }; // full
const CHEST_C = { x: r.ox - 35, y: g + 1, z: r.oz + 8 }; // 2 free slots
const CHEST_D = { x: r.ox - 35, y: g + 1, z: r.oz + 11 }; // empty
const NEAR_BCD = { x: r.ox - 38, y: g + 1, z: r.oz + 5 };
const at = (p) => `(${p.x}, ${p.y}, ${p.z})`;

// What the bot keeps by S2 (keep_items {}), and what it stores.
const KEEP = {
    iron_pickaxe: 1, stone_pickaxe: 1, iron_axe: 1, iron_shovel: 1, iron_hoe: 1, iron_sword: 1, bow: 1, arrow: 64,
    bread: 16, torch: 64, cobblestone: 32, ladder: 20, crafting_table: 1, red_bed: 1, water_bucket: 1,
};
const STORE = { dirt: 1152, cobblestone: 32, wheat: 30, wheat_seeds: 12, bread: 8, wooden_pickaxe: 1 };
// 36 stacks: 15 stacks of things it keeps (bread 24 and cobblestone 64 are kept in part), 21 stored.
const GIVE = [
    ['iron_pickaxe', 1], ['stone_pickaxe', 1], ['wooden_pickaxe', 1], ['iron_axe', 1], ['iron_shovel', 1], ['iron_hoe', 1],
    ['iron_sword', 1], ['bow', 1], ['arrow', 64], ['bread', 24], ['torch', 64], ['cobblestone', 64], ['ladder', 20],
    ['crafting_table', 1], ['red_bed', 1], ['water_bucket', 1], ['wheat_seeds', 12], ['wheat', 30], ['dirt', 1152],
];

function sameItems(a, b) {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    return [...keys].every((k) => (a?.[k] || 0) === (b?.[k] || 0));
}

await scenarioMain({
    async first() {
        let agent = null;
        try {
            const s = await startAgent(NAME, SETTINGS);
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, START, -90);
            await giveItems(NAME, GIVE, agent.bot);
            const full = await waitFor(() => agent.bot.inventory.items().length >= 36, { ms: 8000 });
            const before = await stableInventory(NAME);
            note(`first: the bot carries ${itemsText(before.items)}`);
            check(full.ok && agent.bot.inventory.emptySlotCount() === 0, 'precondition: the inventory of the bot is full (36 stacks)', `${agent.bot.inventory.items().length} stacks`);
            check(sameItems(await chestItems(CHEST_A), {}), 'precondition: the chest is empty');

            const reply = await command_(agent, '!storeItems', 120000);
            note(`first: !storeItems answered ${JSON.stringify(reply)}`);
            const inChest = await chestItems(CHEST_A);
            const after = await stableInventory(NAME);
            note(`first: the chest holds ${itemsText(inChest)}; the bot carries ${itemsText(after.items)}`);
            const expected = `I stored 1152 dirt, 32 cobblestone, 30 wheat, 12 wheat_seeds, 8 bread, 1 wooden_pickaxe in the chest at ${at(CHEST_A)}.`;
            check(reply === expected, 'first: the text of S3 names what was stored, sorted by count, and the chest', JSON.stringify(reply));
            check(sameItems(inChest, STORE), 'first: the chest holds exactly what the keep plan stores (dirt, 32 of 64 cobblestone, wheat, seeds, 8 of 24 bread, the wooden pickaxe)',
                `chest: ${itemsText(inChest)}; expected ${itemsText(STORE)}`);
            const tools = ['iron_pickaxe', 'stone_pickaxe', 'iron_axe', 'iron_shovel', 'iron_hoe', 'iron_sword'];
            check(tools.every((t) => after.items[t] === 1), 'first: the bot keeps the best pickaxe and one more, and its axe, shovel, hoe and sword',
                tools.map((t) => `${t} ${after.items[t] || 0}`).join(', '));
            check(!after.items.wooden_pickaxe, 'first: the third pickaxe (wooden) was stored');
            check(after.items.bread === 16, 'first: the bot keeps 16 bread (food up to 16)', `bread ${after.items.bread || 0}`);
            check(after.items.torch === 64, 'first: the bot keeps its 64 torches', `torch ${after.items.torch || 0}`);
            check(after.items.cobblestone === 32, 'first: the bot keeps 32 cobblestone', `cobblestone ${after.items.cobblestone || 0}`);
            const other = ['bow', 'arrow', 'ladder', 'crafting_table', 'red_bed', 'water_bucket'];
            check(other.every((t) => after.items[t] === KEEP[t]), 'first: the bot keeps bow, 64 arrows, 20 ladders, the crafting table, the bed and the water bucket',
                other.map((t) => `${t} ${after.items[t] || 0}`).join(', '));
            check(sameItems(after.items, KEEP), 'first: the bot carries exactly what the plan keeps', `carries ${itemsText(after.items)}`);
            check(s.realCalls.length === 0, 'first: no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
        }
    },

    async second() {
        let agent = null;
        try {
            const s = await startAgent(NAME, SETTINGS);
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, FAR, -90);
            note(`second: the bot stands at ${fmt(await entityPos(NAME))}, ${hdist(FAR, CHEST_A).toFixed(0)} blocks from the chest`);

            const list = await command_(agent, '!chests', 20000);
            note(`second: !chests answered ${JSON.stringify(list)}`);
            const line = `- ${at(CHEST_A)}: 1152 dirt, 32 cobblestone, 30 wheat, 12 wheat_seeds, 8 bread, 1 wooden_pickaxe, 4 free slots`;
            check(list.startsWith('Chests I know in this world:'), 'second: after the restart !chests starts with "Chests I know in this world:"', JSON.stringify(list.slice(0, 120)));
            check(list.split('\n').includes(line), 'second: after the restart the index still knows the chest and its items (the line of S3)', `expected ${JSON.stringify(line)}`);

            const fetched = await command_(agent, '!fetchItem("bread", 5)', 120000);
            note(`second: !fetchItem answered ${JSON.stringify(fetched)}`);
            const inv = await stableInventory(NAME);
            const inChest = await chestItems(CHEST_A);
            note(`second: the bot carries ${itemsText(inv.items)}; the chest holds ${itemsText(inChest)}`);
            check(fetched === `I took 5 bread from the chest at ${at(CHEST_A)}.`, 'second: the text of S3 "I took 5 bread from the chest at ..."', JSON.stringify(fetched));
            check(inv.items.bread === 5, 'second: 5 bread are in the inventory, fetched from a chest 40 blocks away that only the index knew', `bread ${inv.items.bread || 0}`);
            check((inChest?.bread || 0) === 3, 'second: 3 bread are left in the chest', `bread ${inChest?.bread || 0}`);

            // ------------------------------------------------------ a full chest is skipped, a chest that fills up is left for the next
            await buildFullChest(CHEST_B, 'stone');
            await buildFullChest(CHEST_C, 'stone', { free: 2 });
            await buildChest(CHEST_D, {});
            await resetBot(NAME);
            await placeBot(agent, NEAR_BCD, -90);
            await giveItems(NAME, [['oak_log', 320]], agent.bot);
            await waitFor(() => agent.bot.inventory.items().filter((i) => i.name === 'oak_log').length === 5, { ms: 5000 });
            const stored = await command_(agent, '!storeItems', 120000);
            note(`second: !storeItems answered ${JSON.stringify(stored)}`);
            const b = await chestItems(CHEST_B), c = await chestItems(CHEST_C), d = await chestItems(CHEST_D);
            const inv2 = await stableInventory(NAME);
            note(`second: full chest ${itemsText(b)}; chest with 2 free slots ${itemsText(c)}; empty chest ${itemsText(d)}; the bot carries ${itemsText(inv2.items)}`);
            check(stored === 'I stored 320 oak_log in 2 chests.', 'second: the text of S3 for several chests "I stored 320 oak_log in 2 chests."', JSON.stringify(stored));
            check(sameItems(b, { stone: 1728 }), 'second: the full chest was skipped (it holds its 27 stacks of stone and nothing else)', itemsText(b));
            check(sameItems(c, { stone: 1600, oak_log: 128 }), 'second: the nearest chest with space got 2 stacks of oak_log until it was full', itemsText(c));
            check(sameItems(d, { oak_log: 192 }), 'second: the rest went into the next chest (192 oak_log)', itemsText(d));
            check(!inv2.items.oak_log, 'second: the bot carries no oak_log', `oak_log ${inv2.items.oak_log || 0}`);
            check(s.realCalls.length === 0, 'second: no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
        }
    },

    async main() {
        await prepareRegion(r);
        try {
            await buildChest(CHEST_A, {});
            await runPhase(SELF, 'first', {}, 200000);
            const files = listFiles(path.join('bots', NAME)).filter((f) => /(^|\/)chests\.json$/.test(f));
            note(`chests.json files: ${JSON.stringify(files)}`);
            let json = null;
            try { json = JSON.parse(fs.readFileSync(path.join('bots', NAME, files[0] || 'none'), 'utf8')); } catch (e) { note('chests.json: ' + e.message); }
            const key = `${CHEST_A.x},${CHEST_A.y},${CHEST_A.z}`;
            const entry = json?.chests?.[key];
            note(`chests.json entry ${key}: ${JSON.stringify(entry)}`);
            check(files.length === 1 && json?.version === 1, 'the chest index is saved in the folder of the world as chests.json { version: 1, chests }', JSON.stringify(files));
            check(entry && entry.kind === 'chest' && sameItems(entry.items, STORE) && entry.free_slots === 4,
                'chests.json has the chest under "x,y,z" with kind chest, its items and 4 free slots (S1)', JSON.stringify(entry));
            await runPhase(SELF, 'second', {}, 300000);
        } finally {
            await releaseRegion(r);
        }
    },
});
exitSoon();
