// W68 the ore left behind (v0.1.4.9 spec B6, section 1 "The ore left behind is known and fetched", 11 TW 3).
// New in v0.1.4.9: every ore block the bot sees on a trip and does not take gets an entry in the ore list of the
// mine (`passed`, with the reason), the text of the trip names it, and !collectPassedOre fetches it later when the
// reason is gone. Against v0.1.4.8: ore beside the tunnel that the pickaxe could not harvest was broken for
// nothing or forgotten; nothing could fetch it later.
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner; the house is
// the place "home". The bot learns the mine as in W65. 2 blocks of gold ore are put into the walls beside the end of
// the tunnel (west at the feet, east at the head), 2 blocks of iron ore into the rock 2 blocks ahead of the end.
//   1. The bot, outside in front of the door with a trip kit whose pickaxes are of stone, gets !mineOre("iron", 2):
//      the answer has "I left 2 gold_ore behind: I need an iron pickaxe."; mines.json lists the 2 gold blocks in
//      `passed` with reason pickaxe; both gold blocks are still there (server).
//   2. The bot gets an iron pickaxe; !collectPassedOre("gold") answers "I collected 2 gold_ore that I had passed.";
//      both gold blocks are gone, the bot has 2 raw_gold (inventory and the chest of the room), `passed` is empty.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    walkIntoMine, minesInFile, placeBot, giveItems, entityPos, startTrace, printTrace,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, stableInventory, chestItems, itemsText } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rpassed';
const PLAYER = 'w_player';
const STONE_KIT = [['stone_pickaxe', 2], ['ladder', 64], ['torch', 32], ['cobblestone', 64], ['bread', 16], ['chest', 2]];

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const t = b.tunnel;
        const gold = [{ x: t.end.x - 1, y: t.end.y, z: t.end.z }, { x: t.end.x + 1, y: t.end.y + 1, z: t.end.z }];
        const iron = [0, 1].map((dy) => ({ x: t.end.x, y: t.end.y + dy, z: t.end.z + 2 }));
        const key = (p) => `${p.x},${p.y},${p.z}`;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });

            const walk = await walkIntoMine(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked into the mine to the end of the tunnel', fmt(walk.at));
            const said = await orders.order('!rememberMine("mine")', 30000);
            note(`!rememberMine("mine") answered ${JSON.stringify(said)}`);
            check(/^I remember the mine "mine":.* one tunnel at level 25/.test(said), 'precondition: the mine "mine" is known with its tunnel', JSON.stringify(said));

            // ---------------------------------------------------------- 1. the trip with stone pickaxes
            await commands([...gold.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:gold_ore`), ...iron.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`)]);
            await placeBot(agent, { x: b.house.door.x, y: g + 1, z: b.house.door.z - 4 }, 180);
            await giveItems(NAME, STONE_KIT, agent.bot);
            const t1 = Date.now();
            const trace1 = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);
            const trip = await orders.orderInfo('!mineOre("iron", 2)', 780000);
            printTrace('1: !mineOre("iron", 2) with stone pickaxes', await trace1.stop(), { pos: (x) => fmt(x.pos), action: (x) => x.action }, 50);
            note(`1: !mineOre("iron", 2) answered after ${((Date.now() - t1) / 1000).toFixed(1)} s: ${JSON.stringify(trip.reply)}`);
            check(/I mined \d+ raw_iron\./.test(trip.reply), '1: the trip mined iron (the text of M4)', JSON.stringify(trip.reply));
            check(trip.reply.includes('I left 2 gold_ore behind: I need an iron pickaxe.'), '1: the answer has "I left 2 gold_ore behind: I need an iron pickaxe."', JSON.stringify(trip.reply));
            const mine1 = minesInFile(agent).find((x) => x.name === 'mine');
            const passed1 = mine1?.passed ?? [];
            note(`1: mines.json passed: ${JSON.stringify(passed1)}`);
            const goldEntries = passed1.filter((e) => e.ore === 'gold' && e.reason === 'pickaxe' && gold.some((p) => key(p) === key(e)));
            check(goldEntries.length === 2, '1: mines.json lists the 2 gold blocks in `passed` with reason pickaxe', JSON.stringify(passed1));
            const still = await blockNames(gold, ['gold_ore']);
            check(still.every((x) => x === 'gold_ore'), '1: both gold blocks are still in the wall (server)', JSON.stringify(still));

            // ---------------------------------------------------------- 2. !collectPassedOre("gold") with an iron pickaxe
            await placeBot(agent, { x: b.house.door.x, y: g + 1, z: b.house.door.z - 4 }, 180);
            await giveItems(NAME, [['iron_pickaxe', 1]], agent.bot);
            const before = await stableInventory(NAME);
            const roomBefore = await chestItems(b.room.chest);
            const t2 = Date.now();
            const trace2 = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);
            const fetch = await orders.orderInfo('!collectPassedOre("gold")', 600000);
            printTrace('2: !collectPassedOre("gold")', await trace2.stop(), { pos: (x) => fmt(x.pos), action: (x) => x.action }, 50);
            note(`2: !collectPassedOre("gold") answered after ${((Date.now() - t2) / 1000).toFixed(1)} s: ${JSON.stringify(fetch.reply)}`);
            check(fetch.reply.includes('I collected 2 gold_ore that I had passed.'), '2: the answer is "I collected 2 gold_ore that I had passed."', JSON.stringify(fetch.reply));
            const gone = await blockNames(gold, ['gold_ore']);
            check(gone.every((x) => x === null), '2: both gold blocks are gone (server)', JSON.stringify(gone));
            const after = await stableInventory(NAME);
            const roomAfter = await chestItems(b.room.chest);
            const gotGold = (after.items.raw_gold || 0) - (before.items.raw_gold || 0) + (roomAfter?.raw_gold || 0) - (roomBefore?.raw_gold || 0);
            note(`2: the bot carries ${itemsText(after.items)}; the chest of the room holds ${itemsText(roomAfter)}`);
            check(gotGold >= 2, '2: the bot got 2 raw_gold (inventory and the chest of the room)', `${gotGold}`);
            const mine2 = minesInFile(agent).find((x) => x.name === 'mine');
            check(Array.isArray(mine2?.passed) && mine2.passed.length === 0, '2: `passed` is empty (mines.json)', JSON.stringify(mine2?.passed));
            const end = await entityPos(NAME);
            note(`2: the bot is at ${fmt(end)}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
