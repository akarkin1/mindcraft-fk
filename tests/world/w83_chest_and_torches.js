// W83 the chest and the torches (journey, tester T3): "check the chest", then "make 32 torches" with the logs and the
// coal in the chest of the house, from the player's side (the owner's play log of 2026-10-01 04:13: "check the chest"
// -> !viewChest; the Luna session 03:50 to 04:01: "so here you have a chest, check it" -> !viewChest; "you need 32" ->
// !craftSupplies("torch", 32), answered "I could not craft oak_planks: I need 1 oak_log and have none." while the chest
// beside the bot held logs, then "I need 1 oak_log for 16 torch and have none. I found no tree within 48 blocks.").
//
// The owner variant of the base, the owner's switches, the modes of his profile, an empty memory, an empty inventory.
// The chest of the house holds 20 oak_log and 9 coal (and its bread and leaf litter). The bot stands in the house,
// 2 blocks from the chest; the player beside it. The bot is never moved by the control.
//   1. !viewChest: the answer names oak_log and coal.
//   2. !craftSupplies("torch", 32): within 60 s the bot has 32 torches or more (server inventory), and the answer
//      does not say that it lacks logs.
//   3. Nothing of the house was taken (its oak_log posts, its planks): the house is as built (the chest may differ).
// And: the process lives; no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, fmt, entityPos } from './helpers.js';
import {
    region, prepareRegion, releaseRegion, buildChest, chestItems, inventoryOf, itemsText, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot,
} from './world.js';
import { basePlan, buildBase, BASE_RADIUS, HOUSE_CHEST_ITEMS } from './base_world.js';
import { startJourney, saidLines } from './journey.js';

const NAME = 'w_torch';
const CHEST = { ...HOUSE_CHEST_ITEMS, oak_log: 20, coal: 9 };
const LACKS_LOGS = /(need \d+ \w*_log|_log and have none|no tree|not mine to take)/i;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r, { owner: true });
        await buildBase(b);
        await buildChest(b.house.chest, CHEST, { facing: 'west' });
        const c = b.house.chest;
        let agent = null, orders = null, snap = null;
        try {
            const j = await startJourney(NAME, b, { botAt: { x: c.x - 2, y: c.y, z: c.z - 1 }, playerAt: { x: c.x - 3, y: c.y, z: c.z - 3 } });
            agent = j.agent;
            orders = j.orders;
            snap = await snapshotBox(b.house.box);
            const tStart = Date.now();
            note(`the chest of the house holds ${itemsText(await chestItems(c))}; the bot carries ${itemsText(await inventoryOf(NAME))}`);

            const view = await orders.order('!viewChest', 30000);
            note(`1: !viewChest answered ${JSON.stringify(view.slice(0, 400))}`);
            check(/oak_log/.test(view) && /coal/.test(view), '1: "check the chest": the answer names the oak_log and the coal of the chest', JSON.stringify(view.slice(0, 200)));

            const t0 = Date.now();
            const info = await orders.orderInfo('!craftSupplies("torch", 32)', 60000);
            const secs = (Date.now() - t0) / 1000;
            const inv = await inventoryOf(NAME);
            note(`2: !craftSupplies("torch", 32) answered after ${secs.toFixed(1)} s: ${JSON.stringify(info.reply)}; the bot carries ${itemsText(inv)}; the chest holds ${itemsText(await chestItems(c))}; the bot is at ${fmt(await entityPos(NAME))}`);
            check(info.done && (inv.torch || 0) >= 32, '2: "make 32 torches": within 60 s the bot has 32 torches or more', `${inv.torch || 0} torches, ${secs.toFixed(1)} s`);
            check(!LACKS_LOGS.test(info.reply), '2: the answer does not say that the bot lacks logs (the chest beside it holds 20 oak_log)', JSON.stringify(info.reply));

            const cmp = await compareSnapshot(snap);
            check(cmp.same, '3: nothing of the house was taken or placed (the chest may differ)', describeDifferences(cmp.differences));
            note(`the bot said ${JSON.stringify(saidLines(j.s, tStart).slice(0, 20))}`);
            check(j.s.killed === null, 'the process lives', String(j.s.killed));
            check(j.s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(j.s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
