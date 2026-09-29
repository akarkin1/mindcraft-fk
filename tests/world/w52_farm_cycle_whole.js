// W52 the whole farm cycle (v0.1.4.8 spec E2; findings F1, F2, F3, owner's point 1).
// Defect of the play test: !farmCycle harvested, stored and planted, and used bone meal only if the bot
// carried it. It never made bone meal, never fetched compost items (the owner's chest held 104 leaf litter),
// and "Nothing is ripe yet" named no next step; the text about shears sent the model 40 to 64 blocks away for
// flowers. Against v0.1.4.7: with only unripe wheat the cycle ends without a harvest ("... not ripe ...") and
// the leaf litter stays in the chest.
//
// Base world, the modes of the owner, the owner's packs. Every wheat of the farm is unripe, at age 5: one bone
// meal (2 to 5 stages) ripens a plant, so the harvest does not depend on luck (at age 3 a bone meal ripens a
// plant only half of the time; seen on the test server: 64 leaf litter gave 1 or 2 bone meal). The player
// saves the farm with !setArea as "farm" (type farm). The chest of the house holds 64 leaf_litter and 12 bread;
// the bot knows it (!viewChest). The composter stands inside the farm. The bot carries nothing and stands
// outside the gate. The player types !farmCycle. Then, within the 10 minutes of E2:
//   - leaf litter left the chest of the house, bone meal was made in the composter and used;
//   - wheat was harvested: the wheat of the bot and of the chests together is more than before (4 in the chest
//     at the fence);
//   - the text of E2: starts with Farm "farm":, has "I made N bone_meal from M leaf_litter of the chest at
//     (x, y, z) and used them." and "K more plants got ripe and I harvested them.", ends with "The gate is
//     closed."; no sentence about shears;
//   - the gate is closed, the fence is whole, no farmland became dirt.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, orderChannel, env, startTrace, printTrace, entityPos, fmt,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, chestItems, itemsText, stableInventory, isOpen, blockNames, composterLevel, itemsOnGround, inBox,
} from './world.js';
import { basePlan, buildBase, saveHomePlace, farmFence, BASE_RADIUS } from './base_world.js';

const NAME = 'w_cycle0148';
const PLAYER = 'w_player';
const at = (p) => `(${p.x}, ${p.y}, ${p.z})`;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r, { crops: () => ({ crop: 'wheat', age: 5 }) });
        await buildBase(b);
        const g = b.g;
        const f = b.farm;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await placeBot(agent, { x: b.house.chest.x - 1, y: g + 1, z: b.house.chest.z }, -90);
            orders = await orderChannel(s, { name: PLAYER, at: { x: f.outsideGate.x + 4, y: g + 1, z: f.outsideGate.z - 8 } });
            const seen = await orders.order('!viewChest', 30000);
            note(`!viewChest answered ${JSON.stringify(seen.slice(0, 200))}`);
            await placeBot(agent, f.inside, 0);
            const { min, max } = f.box;
            const set = await orders.order(`!setArea("farm", "farm", ${min.x}, ${g - 1}, ${min.z}, ${max.x}, ${g + 3}, ${max.z})`, 20000);
            check(set.includes('Area "farm" (farm) saved:'), 'precondition: the field is saved as the farm "farm"', JSON.stringify(set.slice(0, 200)));
            await placeBot(agent, f.outsideGate, 180);
            const known = agent.packContext().chests?.get(b.house.chest);
            check((known?.items?.leaf_litter || 0) === 64, 'precondition: the bot knows the chest of the house with 64 leaf_litter', JSON.stringify(known?.items));
            const wheatBefore = ((await chestItems(f.chest))?.wheat || 0) + ((await chestItems(b.house.chest))?.wheat || 0);

            const trace = startTrace(async () => ({ pos: await entityPos(NAME), gate: await isOpen(f.gate, 'oak_fence_gate'), action: agent.actions.currentActionLabel || '-' }), 1000);
            const info = await orders.orderInfo('!farmCycle', 660000);
            const rows = await trace.stop();
            printTrace('!farmCycle', rows, { pos: (x) => fmt(x.pos), inFarm: (x) => (inBox(x.pos, f.box) ? 'yes' : 'no'), gate: (x) => (x.gate ? 'open' : 'closed'), action: (x) => x.action }, 60);
            const text = info.reply;
            note(`!farmCycle answered after ${(info.ms / 1000).toFixed(1)} s: ${JSON.stringify(text)}`);
            const lying = await itemsOnGround({ min: { x: f.box.min.x - 4, y: g - 1, z: f.box.min.z - 4 }, max: { x: f.box.max.x + 4, y: g + 4, z: f.box.max.z + 4 } });
            note(`items on the ground at the farm: ${lying.map((x) => `${x.count} ${x.name} at ${fmt(x.pos)}`).join('; ') || 'none'}; the bot ends at ${fmt(await entityPos(NAME))}`);
            const house = await chestItems(b.house.chest);
            const farmChest = await chestItems(f.chest);
            const inv = await stableInventory(NAME);
            const wheatAfter = (farmChest?.wheat || 0) + (house?.wheat || 0) + (inv.items.wheat || 0);
            note(`the chest of the house holds ${itemsText(house)}; the chest at the fence ${itemsText(farmChest)}; the bot carries ${itemsText(inv.items)}; the composter is at level ${await composterLevel(f.composter)}`);
            check(info.done && info.ms <= 600000 + 30000, 'the cycle ended within the 10 minutes of E2', `${(info.ms / 1000).toFixed(1)} s`);
            check((house?.leaf_litter || 0) < 64, 'leaf litter was taken from the chest of the house (server)', itemsText(house));
            check(wheatAfter > wheatBefore, 'wheat was harvested (the wheat of the bot and of the chests is more than before)', `${wheatBefore} -> ${wheatAfter}`);
            check(text.startsWith('Farm "farm":'), 'the text starts with Farm "farm":', JSON.stringify(text.slice(0, 120)));
            const made = new RegExp(`I made (\\d+) bone_meal from (\\d+) leaf_litter of the chest at ${at(b.house.chest).replace(/[()]/g, '\\$&')} and used (them|it)\\.`).exec(text);
            check(Boolean(made) && Number(made[1]) >= 1, `the text says "I made N bone_meal from M leaf_litter of the chest at ${at(b.house.chest)} and used them." (E2; "used it" for 1)`, JSON.stringify(text));
            // a bone meal that the composter drops lies on the ground until it is picked up: the text must not
            // say that it was used while it lies there (section 0.9)
            const bonemealLeft = lying.filter((x) => x.name === 'bone_meal').reduce((n, x) => n + (x.count || 0), 0);
            check(bonemealLeft === 0, 'no bone meal was left on the ground (the text says it was used)', `${bonemealLeft} bone_meal on the ground`);
            const ripe = /(\d+) more plants? got ripe and I harvested (them|it)\./.exec(text);
            check(Boolean(ripe) && Number(ripe[1]) >= 1, 'the text says "K more plants got ripe and I harvested them." (E2; "1 more plant ... it" in the singular)', JSON.stringify(text));
            check(text.trimEnd().endsWith('The gate is closed.'), 'the text ends with "The gate is closed."', JSON.stringify(text.slice(-80)));
            check(!/shears/i.test(text), 'the text has no sentence about shears (E2, F3)', JSON.stringify(text));
            check(await isOpen(f.gate, 'oak_fence_gate') === false, 'the gate is closed (server)');
            const fence = await farmFence(b);
            check(fence.whole, 'the fence of the farm is whole (the chest in the line too)', JSON.stringify(fence.missing));
            const soil = f.cells.filter((c) => c.spec.ground === 'farmland');
            const ground = await blockNames(soil.map((c) => c.ground), ['farmland', 'dirt', 'grass_block', 'air']);
            check(ground.every((x) => x === 'farmland'), 'no block of farmland became dirt', JSON.stringify(soil.filter((c, i) => ground[i] !== 'farmland').map((c) => c.ground)));
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
