// W21 trees (spec v0.1.4.7 section 8 "Trees", T1 findTrees, T2 chopTrees): wood_pack on,
// protected_areas on, world_memory on. The houses are NOT saved as areas, so only the tree logic of
// T1 keeps the bot away from them.
//   1. A house of planks with corner posts of oak logs, a natural oak tree of 5 logs 4 blocks east of
//      it (leaves that do not decay while the random tick speed is 0). The bot stands at the west
//      wall, where the posts are the nearest logs, with 1 oak_sapling (leaves do not decay in this
//      world, so no sapling can come from them). !chopTrees(4): the 5 logs come from the tree (a tree
//      that was started is finished), the whole trunk is gone, a sapling stands where it stood,
//      every block of the house is there, the text of T2.
//   2. A house of logs with leaves on its roof and no tree within 48 blocks. !chopTrees(4): the bot
//      takes nothing and says "I found no tree within 48 blocks. Logs of buildings are not mine to
//      take." Every block of the log house is there.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    giveItems, waitFor,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, treePlan, buildTree, treeBox, logHousePlan, buildLogHouse,
    blockIs, blockNames, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot, stableInventory, itemsText, carve,
    inventoryOf, itemsOnGround,
} from './world.js';

const NAME = 'w_trees';

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r, 24);
        const h = housePlan(r.ox - 20, r.oz - 5, g);
        const tree = treePlan(h.box.max.x + 4, h.box.min.z + 3, g, 5);
        await buildHouse(h);
        await buildTree(tree, { natural: true });
        // the log house 60 blocks east of the tree: out of the range of 48 blocks of a search from there
        const lh = logHousePlan(r.ox + 40, r.oz - 2, g);
        await buildLogHouse(lh);

        let agent = null;
        const snaps = [];
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true, wood_pack: true });
            agent = s.agent;
            const snapHouse = await snapshotBox(h.box);
            snaps.push(snapHouse);

            // ---------------------------------------------------------- 1. the tree, not the house
            await resetBot(NAME);
            await placeBot(agent, { x: h.box.min.x - 2, y: g + 1, z: h.box.min.z + 3 }, 90);
            await giveItems(NAME, [['oak_sapling', 1]], agent.bot);
            const reply = await command_(agent, '!chopTrees(4)', 240000);
            note(`1: !chopTrees(4) answered ${JSON.stringify(reply)}`);
            const trunk = await blockNames(tree.logs, ['oak_log']);
            const inv = await stableInventory(NAME);
            const cmp = await compareSnapshot(snapHouse, agent.bot);
            const houseLogs = await blockNames(h.logs, ['oak_log']);
            note(`1: the bot carries ${itemsText(inv.items)}; the house: ${describeDifferences(cmp.differences)}`);
            if ((inv.items.oak_log || 0) < 5) {
                // seen on the test server: the last log reached the inventory after the command had answered
                const late = await waitFor(async () => ((await inventoryOf(NAME)).oak_log || 0) >= 5, { ms: 5000, every: 250 });
                const lying = await itemsOnGround(treeBox(tree));
                note(`1: after the answer: ${late.ok ? `the 5th log reached the inventory ${late.ms} ms after the first read` : 'still fewer than 5 logs 5 s later'}; on the ground: ${lying.map((x) => `${x.count} ${x.name} at ${JSON.stringify(x.pos)}`).join('; ') || 'nothing'}`);
            }
            check(trunk.every((x) => x === null), '1: the whole trunk is gone (all 5 logs, none hangs in the air)', JSON.stringify(tree.logs.filter((p, i) => trunk[i])));
            check((inv.items.oak_log || 0) === 5, '1: the bot carries the 5 logs of the tree (a tree that was started is finished)', `oak_log ${inv.items.oak_log || 0}`);
            check(houseLogs.every((x) => x === 'oak_log'), '1: every corner post of the house is there (12 oak logs)', `${houseLogs.filter((x) => !x).length} missing`);
            check(cmp.same, '1: every block of the house is there', describeDifferences(cmp.differences));
            check(await blockIs({ x: tree.x, y: g + 1, z: tree.z }, 'oak_sapling'), '1: a sapling stands where the tree stood');
            check(reply === 'I cut 1 oak tree and got 5 oak_log. I planted 1 sapling.', '1: the text of T2 "I cut 1 oak tree and got 5 oak_log. I planted 1 sapling."', JSON.stringify(reply));

            // ---------------------------------------------------------- 2. a house of logs, no tree
            // the crown of the tree of part 1 floats without a trunk now; it is taken away
            const box = treeBox(tree);
            await carve({ min: { x: box.min.x, y: g + 2, z: box.min.z }, max: box.max });
            const snapLog = await snapshotBox(lh.box);
            snaps.push(snapLog);
            await resetBot(NAME);
            await placeBot(agent, { x: lh.door.x, y: g + 1, z: lh.door.z - 3 }, 0);
            const reply2 = await command_(agent, '!chopTrees(4)', 120000);
            note(`2: !chopTrees(4) answered ${JSON.stringify(reply2)}`);
            const inv2 = await stableInventory(NAME);
            const cmp2 = await compareSnapshot(snapLog, agent.bot);
            check(reply2 === 'I found no tree within 48 blocks. Logs of buildings are not mine to take.', '2: the bot says "I found no tree within 48 blocks. Logs of buildings are not mine to take."', JSON.stringify(reply2));
            check(!inv2.items.oak_log && !inv2.items.oak_leaves, '2: the bot took nothing', itemsText(inv2.items));
            check(cmp2.same, '2: every block of the log house and of the leaves on its roof is there', describeDifferences(cmp2.differences));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            for (const sn of snaps) await dropSnapshot(sn).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
