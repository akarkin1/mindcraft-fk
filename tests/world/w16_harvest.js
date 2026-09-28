// W16 harvest (spec v0.1.4.7 section 8 "Harvest", F1, F2): farming_pack on, protected_areas on,
// world_memory on. A fenced field of 9 x 9 with a closed gate: 7 wheat of age 7 on one row, 7 wheat of
// age 2 on another, the rest empty farmland around a water source, saved as the farm "wheat_farm".
// The bot starts outside the gate with 8 wheat_seeds (a ripe wheat drops 0 to 3 seeds; with none to
// start with, planting again at once would depend on luck). !harvest without a name:
//   every ripe plant was taken and planted again (wheat of age 0 where the ripe wheat stood), every
//   unripe plant stands (age 2), no block of farmland became dirt, the fence is whole, the gate is
//   closed at the end, the bot carries the 7 wheat, and the text of F2.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    giveItems, startTrace, printTrace, entityPos, fmt,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, fieldPlan, buildField, cropAges, blockNames, isOpen, stableInventory, itemsText,
    inBox,
} from './world.js';

const NAME = 'w_harvest';

await scenarioMain({
    async main() {
        const r = region(32);
        const g = r.g;
        await prepareRegion(r);
        const f = fieldPlan(r.ox - 4, r.oz - 4, g, (i, j) => (j === 2 ? { crop: 'wheat', age: 7 } : j === 6 ? { crop: 'wheat', age: 2 } : {}));
        await buildField(f);
        const ripe = f.cells.filter((c) => c.spec.age === 7);
        const young = f.cells.filter((c) => c.spec.age === 2);
        const empty = f.cells.filter((c) => !c.spec.crop);

        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true, farming_pack: true });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, f.inside, 0);
            const { min, max } = f.box;
            const set = await command_(agent, `!setArea("wheat_farm", "farm", ${min.x}, ${g - 1}, ${min.z}, ${max.x}, ${g + 3}, ${max.z})`, 20000);
            check(set.includes('Area "wheat_farm" (farm) saved:'), 'precondition: the field is saved as the farm "wheat_farm"', JSON.stringify(set.slice(0, 200)));
            await placeBot(agent, f.outsideGate, 0);
            await giveItems(NAME, [['wheat_seeds', 8]], agent.bot);
            check(await isOpen(f.gate, 'oak_fence_gate') === false, 'precondition: the gate is closed');
            check((await cropAges(ripe.map((c) => c.above))).every((a) => a === 7), 'precondition: 7 wheat of age 7 stand in the field');

            const inField = { min: { x: min.x + 1, y: g, z: min.z + 1 }, max: { x: max.x - 1, y: g + 3, z: max.z - 1 } };
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), gate: await isOpen(f.gate, 'oak_fence_gate') }), 250);
            const reply = await command_(agent, '!harvest', 180000);
            const rows = await trace.stop();
            printTrace('!harvest', rows, { pos: (x) => fmt(x.pos), inField: (x) => (inBox(x.pos, inField) ? 'yes' : 'no'), gate: (x) => (x.gate ? 'open' : 'closed') });
            note(`!harvest answered ${JSON.stringify(reply)}`);

            const ripeNow = await cropAges(ripe.map((c) => c.above));
            const youngNow = await cropAges(young.map((c) => c.above));
            const emptyNow = await blockNames(empty.map((c) => c.above), ['air', 'wheat']);
            const ground = await blockNames(f.cells.map((c) => c.ground), ['farmland', 'dirt', 'grass_block', 'air']);
            const ring = await blockNames(f.fenceRing, ['oak_fence', 'oak_fence_gate']);
            const inv = await stableInventory(NAME);
            note(`ages where the ripe wheat stood: ${JSON.stringify(ripeNow)}; ages of the young wheat: ${JSON.stringify(youngNow)}`);
            note(`ground of the field: ${ground.filter((x) => x !== 'farmland').length} cells are not farmland ${JSON.stringify(f.cells.filter((c, i) => ground[i] !== 'farmland').map((c, i) => c.ground))}`);
            note(`the bot carries ${itemsText(inv.items)}`);

            check(reply === 'I harvested 7 wheat and planted 7 again. 7 plants are not ripe yet.', 'the text of F2: "I harvested 7 wheat and planted 7 again. 7 plants are not ripe yet."', JSON.stringify(reply));
            check(ripeNow.every((a) => a === 0), 'every ripe plant was taken and planted again (wheat of age 0 on each of the 7 cells)', JSON.stringify(ripeNow));
            check(youngNow.every((a) => a === 2), 'every unripe plant stands (7 wheat of age 2)', JSON.stringify(youngNow));
            check(emptyNow.every((x) => x === 'air'), 'the empty farmland was left as it was (the harvest plants only where it harvested)', JSON.stringify(emptyNow));
            check(ground.every((x) => x === 'farmland'), 'no block of farmland became dirt (the bot did not jump in the field) and nothing was dug', JSON.stringify(ground.filter((x) => x !== 'farmland')));
            const ringOk = ring.every((x, i) => x === (f.fenceRing[i].x === f.gate.x && f.fenceRing[i].z === f.gate.z ? 'oak_fence_gate' : 'oak_fence'));
            check(ringOk, 'the fence is whole (every post and the gate are there)', JSON.stringify(f.fenceRing.filter((p, i) => !ring[i])));
            check(await isOpen(f.gate, 'oak_fence_gate') === false, 'the gate is closed at the end');
            check(rows.some((x) => x.gate === true), 'the bot opened the gate on its way (it entered through the gate)');
            const end = await entityPos(NAME);
            check(!inBox(end, f.box), 'the bot left the field at the end (it stands outside the fence)', fmt(end));
            check((inv.items.wheat || 0) === 7, 'the bot carries the 7 wheat of the harvest', `wheat ${inv.items.wheat || 0}`);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
