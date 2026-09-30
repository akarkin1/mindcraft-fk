// W22 tall tree (spec v0.1.4.7 section 8 "Tall tree", T1 chopPlan, T2): wood_pack on, protected_areas
// on, world_memory on. A natural oak tree with a trunk of 9 logs 5 blocks from the bot, which has an
// empty inventory. From the ground the bot reaches the lowest logs only; for the rest it builds a
// pillar under itself (of logs it has cut, it has no dirt) and takes it away at the end.
// !chopTrees(9): all 9 logs are gone, no pillar is left (no log, dirt or cobblestone stands in the
// column of the trunk or beside it above the ground), the bot stands on the ground unhurt and carries
// the 9 logs, the text of T2.
// v0.1.4.8 (W30): the modes of the owner are on (MODES_PROFILE, with the home reflexes) and !chopTrees is typed
// by the player in the chat (the real path of a typed command), as in play.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    entityPos, fmt, startTrace, printTrace, waitFor, withModes, orderChannel,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, treePlan, buildTree, blockNames, findBlocks, stableInventory, itemsText, entityNumber,
    itemsOnGround, inventoryOf,
} from './world.js';

const NAME = 'w_tall';

await scenarioMain({
    async main() {
        const r = region(32);
        const g = r.g;
        await prepareRegion(r, 24);
        const tree = treePlan(r.ox + 5, r.oz, g, 9);
        await buildTree(tree, { natural: true });

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true, wood_pack: true }));
            agent = s.agent;
            orders = await orderChannel(s, { at: { x: r.ox - 16, y: g + 1, z: r.oz + 16 } });
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, -90);
            check((await blockNames(tree.logs, ['oak_log'])).every(Boolean), 'precondition: a trunk of 9 oak logs stands 5 blocks from the bot');

            const trace = startTrace(async () => ({ pos: await entityPos(NAME), hp: await entityNumber(NAME, 'Health') }), 400);
            const reply = await orders.order('!chopTrees(9)', 300000);
            const rows = await trace.stop();
            printTrace('!chopTrees(9) on a tree of 9 logs', rows, { pos: (x) => fmt(x.pos), hp: (x) => String(x.hp) });
            note(`!chopTrees(9) answered ${JSON.stringify(reply)}`);

            const trunk = await blockNames(tree.logs, ['oak_log']);
            const around = { min: { x: tree.x - 1, y: g + 1, z: tree.z - 1 }, max: { x: tree.x + 1, y: g + 14, z: tree.z + 1 } };
            const pillar = await findBlocks(around, ['oak_log', 'dirt', 'cobblestone', 'oak_planks', 'grass_block']);
            const inv = await stableInventory(NAME);
            const end = await entityPos(NAME);
            const hp = await entityNumber(NAME, 'Health');
            const top = Math.max(...rows.map((x) => x.pos?.y ?? -999));
            const ground = await itemsOnGround({ min: { x: tree.x - 16, y: g - 2, z: tree.z - 16 }, max: { x: tree.x + 16, y: g + 20, z: tree.z + 16 } });
            note(`the bot carries ${itemsText(inv.items)}; its highest feet y was ${top.toFixed(1)} (ground ${g + 1}); blocks left beside the trunk: ${JSON.stringify(pillar)}`);
            note(`items on the ground within 16 blocks of the tree: ${ground.length ? ground.map((x) => `${x.count} ${x.name} at ${fmt(x.pos)}`).join('; ') : 'none'}`);
            check(!ground.some((x) => x.name === 'oak_log'), 'no log of the tree lies on the ground (the bot picked up the drops)', ground.filter((x) => x.name === 'oak_log').map((x) => fmt(x.pos)).join('; '));
            if ((inv.items.oak_log || 0) < 9) {
                // seen on the test server: the last log reached the inventory after the command had answered
                const late = await waitFor(async () => ((await inventoryOf(NAME)).oak_log || 0) >= 9, { ms: 5000, every: 250 });
                note(`after the answer: ${late.ok ? `the 9th log reached the inventory ${late.ms} ms after the first read` : 'still fewer than 9 logs 5 s later'}`);
            }
            check(trunk.every((x) => x === null), 'all 9 logs of the trunk are gone', JSON.stringify(tree.logs.filter((p, i) => trunk[i]).map((p) => p.y - g)));
            check(pillar.length === 0, 'no pillar is left: no log, dirt, cobblestone or planks above the ground in the column of the trunk and beside it', JSON.stringify(pillar));
            check((inv.items.oak_log || 0) === 9, 'the bot carries the 9 logs (the pillar of logs was taken away and picked up)', `oak_log ${inv.items.oak_log || 0}`);
            check(end && Math.abs(end.y - (g + 1)) < 0.6, 'the bot stands on the ground at the end', fmt(end));
            check(hp === 20, 'the bot is unhurt (no fall)', `health ${hp}`);
            check(top >= g + 3, 'the bot climbed on a pillar for the high logs', `highest feet y ${top.toFixed(1)}`);
            check(/^I cut 1 oak tree and got 9 oak_log\./.test(reply) && !/too high/.test(reply), 'the text of T2 "I cut 1 oak tree and got 9 oak_log." without logs that were too high', JSON.stringify(reply));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
