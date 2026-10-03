// W06 protected house (spec section 8 "Protected house", A4, G5): protected_areas on, world_memory on,
// home_pack off. A house of planks with oak log corner posts, an oak tree with 5 logs 4 blocks east of
// it. The bot saves the house with !rememberArea("home", "building"). Then:
//   1. next to the west wall (the corner posts are the nearest logs, the tree is 12 blocks away)
//      !collectBlocks("oak_log", 4): the bot takes 4 logs of the tree, every block of the house is
//      still there;
//   2. bot.dig on a plank of the west wall, the bot standing next to it: refused with a
//      ProtectedAreaError and the text of A4, the plank is still there;
//   3. !goToCoordinates to a place 2 blocks behind the east wall, starting 3 blocks in front of the
//      west wall: the path goes around the house, not through it, and the house is untouched.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    entityPos, fmt, startTrace, printTrace, sleep,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, treePlan, buildTree, inBox, hdist, blockIs,
    snapshotBox, compareSnapshot, describeDifferences, dropSnapshot,
} from './world.js';

const NAME = 'w_guard';

await scenarioMain({
    async main() {
        const r = region(40);
        const g = r.g;
        await prepareRegion(r);
        const h = housePlan(r.ox - 10, r.oz - 5, g);
        const tree = treePlan(h.box.max.x + 4, h.box.min.z + 3, g, 5);
        await buildHouse(h);
        await buildTree(tree);

        let agent = null;
        let snap = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, h.inside, 0);
            const saved = await command_(agent, '!rememberArea("home", "building")', 30000);
            // v0.1.4.11 (P1): `I saved "home": a <kind>, ...`
            check(/I saved "home": an? \w+, /.test(saved), 'precondition: !rememberArea saved the house as "home" (the answer of P1)', JSON.stringify(saved.slice(0, 200)));
            snap = await snapshotBox(h.box);

            // ---------------------------------------------------------- 1. logs from the tree, not from the house
            await placeBot(agent, { x: h.box.min.x - 2, y: g + 1, z: h.box.min.z + 3 }, 90);
            const collect = await command_(agent, '!collectBlocks("oak_log", 4)', 120000);
            note(`1: !collectBlocks answered ${JSON.stringify(collect.slice(0, 300))}`);
            const logsInInventory = agent.bot.inventory.items().filter((i) => i.name === 'oak_log').reduce((n, i) => n + i.count, 0);
            const treeLeft = [];
            for (const p of tree.logs) if (await blockIs(p, 'oak_log')) treeLeft.push(p.y - g);
            const cmp1 = await compareSnapshot(snap, agent.bot);
            note(`1: logs in the inventory ${logsInInventory}, tree logs left at heights ${JSON.stringify(treeLeft)}; house: ${describeDifferences(cmp1.differences)}`);
            check(tree.logs.length - treeLeft.length >= 4, '1: the bot took 4 logs from the tree', `${tree.logs.length - treeLeft.length} tree logs gone`);
            check(logsInInventory >= 4, '1: the bot has 4 oak logs', String(logsInInventory));
            check(cmp1.same, '1: every block of the house is still there', describeDifferences(cmp1.differences));

            // ---------------------------------------------------------- 2. bot.dig on a wall block
            await placeBot(agent, { x: h.wallWest.x - 1, y: g + 1, z: h.wallWest.z }, -90);
            const wall = agent.bot.blockAt(new Vec3(h.wallWest.x, h.wallWest.y, h.wallWest.z));
            check(wall?.name === 'oak_planks', '2: the bot stands next to a plank of the west wall', String(wall?.name));
            let err = null;
            try {
                await agent.bot.dig(wall, true);
            } catch (e) { err = e; }
            await sleep(1000);
            const expected = `The block at (${h.wallWest.x}, ${h.wallWest.y}, ${h.wallWest.z}) belongs to the protected area "home". I do not break or place blocks there.`;
            check(err && err.name === 'ProtectedAreaError', '2: bot.dig on the wall is refused with a ProtectedAreaError', err ? `${err.name}: ${err.message}` : 'no error, the dig went through');
            check(err && err.message === expected, '2: the error text is the one of A4', err ? JSON.stringify(err.message) : '');
            check(await blockIs(h.wallWest, 'oak_planks'), '2: the plank is still there (server)');

            // ---------------------------------------------------------- 3. a path around the house
            const from = { x: h.box.min.x - 3, y: g + 1, z: h.box.min.z + 3 };
            const to = { x: h.box.max.x + 2, y: g + 1, z: h.box.min.z + 3 };
            await placeBot(agent, from, -90);
            const trace = startTrace(async () => ({ pos: await entityPos(NAME) }), 300);
            const reply = await command_(agent, `!goToCoordinates(${to.x + 0.5}, ${to.y}, ${to.z + 0.5}, 1)`, 60000);
            const end = await entityPos(NAME);
            const rows = await trace.stop();
            printTrace('3: from the west side of the house to 2 blocks behind the east wall', rows, {
                pos: (x) => fmt(x.pos), inHouse: (x) => (inBox(x.pos, h.box) ? 'YES' : 'no'),
            });
            note(`3: reply ${JSON.stringify(reply.slice(0, 200))}`);
            check(hdist(end, { x: to.x + 0.5, z: to.z + 0.5 }) <= 2, '3: the bot reached the place behind the house', fmt(end));
            check(!rows.some((x) => inBox(x.pos, h.box)), '3: the path went around the house (the bot was never inside its box)');
            const cmp3 = await compareSnapshot(snap, agent.bot);
            check(cmp3.same, '3: every block of the house is still there after the walk', describeDifferences(cmp3.differences));

            note(`the fake chat model got ${s.chat.requests.length} request(s)`);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
