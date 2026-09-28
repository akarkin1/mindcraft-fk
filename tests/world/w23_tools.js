// W23 tools (spec v0.1.4.7 section 8 "Tools", T3, T4 ensureTool): wood_pack on, storage_pack off (the
// storage code is not loaded, ensureTool goes on without chests), protected_areas on, world_memory on.
// A bot with an empty inventory, a natural oak tree of 5 logs 6 blocks east, 6 blocks of stone lying
// open in the ground 5 blocks west (no stone anywhere else: the flat world is grass on dirt).
// !getTool("pickaxe", "stone"): the bot cuts the tree, crafts a wooden pickaxe, breaks stone and
// crafts a stone pickaxe. It ends with a stone_pickaxe (server), the text of T4.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    entityPos, fmt, startTrace, printTrace, commands,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, treePlan, buildTree, blockNames, stableInventory, itemsText, inventoryOf,
} from './world.js';

const NAME = 'w_tools';

await scenarioMain({
    async main() {
        const r = region(32);
        const g = r.g;
        await prepareRegion(r, 24);
        const tree = treePlan(r.ox + 6, r.oz, g, 5);
        await buildTree(tree, { natural: true });
        const stone = [];
        for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 2; dz++) stone.push({ x: r.ox - 5 - dx, y: g, z: r.oz + 2 + dz });
        await commands(stone.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:stone`));

        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true, wood_pack: true });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, -90);
            const empty = await inventoryOf(NAME);
            check(Object.keys(empty).length === 0, 'precondition: the inventory of the bot is empty', itemsText(empty));
            check((await blockNames(stone, ['stone'])).every(Boolean), 'precondition: 6 blocks of stone lie open 5 blocks from the bot');

            const trace = startTrace(async () => ({ pos: await entityPos(NAME) }), 1000);
            const t0 = Date.now();
            const reply = await command_(agent, '!getTool("pickaxe", "stone")', 360000);
            const rows = await trace.stop();
            printTrace('!getTool("pickaxe", "stone")', rows, { pos: (x) => fmt(x.pos) }, 40);
            note(`!getTool answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(reply)}`);
            const inv = await stableInventory(NAME);
            const trunk = await blockNames(tree.logs, ['oak_log']);
            const stoneLeft = await blockNames(stone, ['stone']);
            note(`the bot carries ${itemsText(inv.items)}; tree logs left ${trunk.filter(Boolean).length} of 5; stone left ${stoneLeft.filter(Boolean).length} of 6`);
            check((inv.items.stone_pickaxe || 0) >= 1, 'the bot ends with a stone pickaxe (server inventory)', itemsText(inv.items));
            check(reply === 'I crafted a wooden_pickaxe and a stone_pickaxe.', 'the text of T4 "I crafted a wooden_pickaxe and a stone_pickaxe."', JSON.stringify(reply));
            check(trunk.every((x) => x === null), 'the logs came from the tree, which is cut whole', `${trunk.filter(Boolean).length} logs left`);
            check(stoneLeft.filter((x) => x === null).length >= 3, 'the bot broke at least 3 of the stone blocks for cobblestone', `${stoneLeft.filter((x) => x === null).length} broken`);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
