// W53 trees with an axe (v0.1.4.8 spec E3; findings T4 and T1).
// Defect of the play test: chopTrees never crafted, fetched or equipped an axe; without an axe the pickaxe
// stayed in the hand while the bot cut trees. And the number of chopTrees counted trees, not logs. Against
// v0.1.4.7: the bot cuts with the stone pickaxe in its hand (no axe is made), and the text counts trees.
//
// Base world (trees 12 to 16 blocks north of the house, which is a place only), the modes of the owner, the
// owner's packs. The bot holds a stone_pickaxe and carries 4 oak_log (enough for a wooden axe) and nothing
// else. The player types !chopTrees(6). While the bot breaks a log of a tree, the item in its hand is traced
// every 200 ms (its own view, the held item).
//   - an axe was made before the first log of a tree was broken, and every log was broken with an axe in the
//     hand, never with the pickaxe (E3: "never with a pickaxe");
//   - at the end the bot carries 6 oak_log or more beyond what went into the axe, and the axe (server);
//   - the text says what was cut, in logs: "I cut N oak tree(s) and got M oak_log." with M >= 6;
//   - no block of the house changed.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, orderChannel, giveItems, startTrace, env,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, treePlan, buildTree, blockNames, stableInventory, itemsText, snapshotBox, compareSnapshot,
    describeDifferences, dropSnapshot,
} from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_axe';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const trees = [[-8, -18], [-2, -21], [4, -18], [10, -21]].map(([dx, dz]) => treePlan(r.ox + dx, r.oz + dz, g, 6));
        for (const t of trees) await buildTree(t, { natural: true });
        const logs = trees.flatMap((t) => t.logs);
        const key = (p) => `${p.x},${p.y},${p.z}`;
        const treeLogs = new Set(logs.map(key));

        let agent = null, orders = null, snap = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            snap = await snapshotBox(b.house.box);
            await placeBot(agent, { x: r.ox + 1, y: g + 1, z: r.oz - 12 }, 180);
            orders = await orderChannel(s, { name: PLAYER, at: { x: r.ox - 14, y: g + 1, z: r.oz - 10 } });
            await giveItems(NAME, [['stone_pickaxe', 1], ['oak_log', 4]], agent.bot);
            await agent.bot.equip(agent.bot.inventory.items().find((i) => i.name === 'stone_pickaxe'), 'hand');
            check(agent.bot.heldItem?.name === 'stone_pickaxe', 'precondition: the bot holds a stone_pickaxe', String(agent.bot.heldItem?.name));

            // the item in the hand whenever the bot digs a log of a tree
            const trace = startTrace(async () => {
                const dig = agent.bot.targetDigBlock;
                return { dig: dig && treeLogs.has(key(dig.position)) ? key(dig.position) : null, held: agent.bot.heldItem?.name ?? 'hand' };
            }, 200);
            const info = await orders.orderInfo('!chopTrees(6)', 480000);
            const rows = await trace.stop();
            const digs = rows.filter((x) => x.dig);
            const heldWhileCutting = [...new Set(digs.map((x) => x.held))];
            const gone = (await blockNames(logs, ['oak_log'])).filter((x) => x === null).length;
            const inv = await stableInventory(NAME);
            const axes = Object.keys(inv.items).filter((n) => n.endsWith('_axe'));
            note(`!chopTrees(6) answered after ${(info.ms / 1000).toFixed(1)} s: ${JSON.stringify(info.reply)}`);
            note(`held while cutting a log: ${JSON.stringify(heldWhileCutting)} (${digs.length} samples); ${gone} logs of the trees are gone; the bot carries ${itemsText(inv.items)}`);
            check(digs.length > 0, 'precondition: the bot cut logs of the trees (samples while it broke a log)');
            check(heldWhileCutting.length > 0 && heldWhileCutting.every((n) => n.endsWith('_axe')), 'every log was broken with an axe in the hand, never with the pickaxe (E3)', JSON.stringify(heldWhileCutting));
            check(axes.length >= 1, 'the bot carries an axe at the end (server)', itemsText(inv.items));
            check((inv.items.oak_log || 0) >= 6, 'the bot carries 6 oak_log or more (server)', `oak_log ${inv.items.oak_log || 0}`);
            const m = /I cut (\d+) oak trees? and got (\d+) oak_log\./.exec(info.reply);
            check(Boolean(m) && Number(m[2]) >= 6, 'the text of T2/E3 counts the logs: "I cut N oak tree(s) and got M oak_log." with M >= 6', JSON.stringify(info.reply));
            const cmp = await compareSnapshot(snap, agent.bot);
            check(cmp.same, 'every block of the house is there', describeDifferences(cmp.differences));
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
