// W70 ore in sight (v0.1.4.9 spec C1, section 11 TW 3).
// New in v0.1.4.9: !collectBlocks takes only ore that has a face in the open (ore_sense_range 0; 3 would reach 3
// blocks into the rock); for ore inside the rock it says so and points to !mineOre. Against v0.1.4.8: collectBlocks
// dug a way through the rock to every ore within its range (finding of the play test: holes in the walls).
//
// Base world, the owner's switches and settings (the mining pack on: the long text of C1, HANDOFF part C), the
// switches of v0.1.4.9 on, ore_sense_range 0 set in the settings of the agent, the modes of the owner. In the
// tunnel of the base one iron ore sits in the east wall (a face to the tunnel), one 5 blocks inside the rock east of
// it. The bot stands beside the first one, looking at it. The player types !collectBlocks("iron_ore", 2):
//   - the answer has the text of C1 "I see no iron_ore. I know that there is some within 16 blocks, but it is
//     inside the rock. Tell me to mine iron and I get it from a mine." and then the line of the ore it broke;
//   - the ore in the wall is gone, the bot carries 1 raw_iron; the ore in the rock and the 4 blocks of stone
//     between it and the tunnel are as they were (server).
// Finding of T2 (2026-09-30, left failing): the answer comes at once and is "I am underground. I start a new mine
// only from the surface."; nothing is taken. With the mining pack on, !collectBlocks for an ore first asks whether
// the ore is in sight (oreInSight of actions.js, M5 of v0.1.4.7: bot.canSeeBlock from the eyes to the middle of the
// block); for an ore at the height of the feet in the wall the ray from the eyes meets the wall block above it, so
// the command goes to !mineOre, which starts no mine underground. The collecting of C1 never runs. The note at the
// end shows the same order with the ore one block higher.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    placeBot, giveItems, entityPos,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, stableInventory, itemsText } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rsight';
const PLAYER = 'w_player';
const C1 = 'I see no iron_ore. I know that there is some within 16 blocks, but it is inside the rock. Tell me to mine iron and I get it from a mine.';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const cell = b.tunnel.cells[6];
        const exposed = { x: cell.x + 1, y: cell.y, z: cell.z };
        const hidden = { x: cell.x + 5, y: cell.y, z: cell.z };
        const between = [2, 3, 4].map((k) => ({ x: cell.x + k, y: cell.y, z: cell.z }));

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, settings0149({ ore_sense_range: 0 }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });
            await commands([`setblock ${exposed.x} ${exposed.y} ${exposed.z} minecraft:iron_ore`, `setblock ${hidden.x} ${hidden.y} ${hidden.z} minecraft:iron_ore`]);
            await placeBot(agent, cell, -90); // looking east at the ore in the wall
            await giveItems(NAME, [['stone_pickaxe', 1]], agent.bot);
            note(`ore_sense_range of the agent: ${s.settings.ore_sense_range}; the ore in the wall (${exposed.x}, ${exposed.y}, ${exposed.z}), in the rock (${hidden.x}, ${hidden.y}, ${hidden.z})`);

            const t0 = Date.now();
            const info = await orders.orderInfo('!collectBlocks("iron_ore", 2)', 180000);
            note(`!collectBlocks("iron_ore", 2) answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply)}; the bot is at ${fmt(await entityPos(NAME))}`);
            check(info.reply.includes(C1), 'the answer has the text of C1 (mining pack on: the long text)', JSON.stringify(info.reply));
            const i = info.reply.indexOf(C1);
            check(i >= 0 && /iron_ore/.test(info.reply.slice(i + C1.length)), 'after the text of C1 comes the line of the ore that was broken', JSON.stringify(info.reply.slice(i + C1.length)));
            const got = await blockNames([exposed, hidden, ...between], ['iron_ore', 'stone']);
            check(got[0] === null, 'the ore in the wall is gone (server)', String(got[0]));
            check(got[1] === 'iron_ore', 'the ore inside the rock is still there (server)', String(got[1]));
            check(got.slice(2).every((x) => x === 'stone'), 'the stone between the ore in the rock and the tunnel is not dug (server)', JSON.stringify(got.slice(2)));
            const inv = await stableInventory(NAME);
            note(`the bot carries ${itemsText(inv.items)}`);
            check((inv.items.raw_iron || 0) === 1, 'the bot carries 1 raw_iron', `raw_iron ${inv.items.raw_iron || 0}`);
            // for the report (no check of the spec): the ore in the wall one block higher, at the height of the eyes of the
            // bot (!collectBlocks with the mining pack asks bot.canSeeBlock first, M5 of v0.1.4.7)
            if (got[0] !== null) {
                const high = { x: exposed.x, y: exposed.y + 1, z: exposed.z };
                await commands([`setblock ${exposed.x} ${exposed.y} ${exposed.z} minecraft:stone`, `setblock ${high.x} ${high.y} ${high.z} minecraft:iron_ore`]);
                await placeBot(agent, cell, -90);
                const again = await orders.orderInfo('!collectBlocks("iron_ore", 2)', 180000);
                const got2 = await blockNames([high, hidden], ['iron_ore']);
                note(`with the ore in the wall at the height of the eyes (${high.x}, ${high.y}, ${high.z}): !collectBlocks("iron_ore", 2) answered ${JSON.stringify(again.reply)}; the ore in the wall is ${got2[0]}, the one in the rock ${got2[1]}`);
            }
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
