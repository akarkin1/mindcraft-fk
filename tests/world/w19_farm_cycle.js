// W19 farm cycle (spec v0.1.4.7 section 8 "Farm cycle", F2 farmCycle, F3, Amendment 1 part F):
// farming_pack on, storage_pack on, protected_areas on, world_memory on. A fenced field of 9 x 9 saved
// as the farm "wheat_farm": 7 wheat of age 7 on one row, 6 cells of empty farmland on the row of the
// water, 35 wheat of age 2 on the other rows. An empty chest 2 blocks west of the fence. The bot
// stands outside the gate with 16 wheat_seeds.
// The player writes the owner's words "get back to farming"; the fake model answers !farmCycle. Then:
//   the wheat is in the chest (7 wheat), the ripe cells are planted again, the empty cells are planted,
//   the young wheat stands, no farmland became dirt, the fence is whole, the gate is closed, and the
//   text of F2 goes back to the model in the order harvest, store, plant, gate.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    giveItems, connectPlayer, quitPlayer, waitFor, waitIdle, historyTurn,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, fieldPlan, buildField, buildChest, chestItems, cropAges, blockNames, isOpen,
    stableInventory, itemsText,
} from './world.js';

const NAME = 'w_cycle';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(32);
        const g = r.g;
        await prepareRegion(r);
        const f = fieldPlan(r.ox - 4, r.oz - 4, g, (i, j) => (j === 2 ? { crop: 'wheat', age: 7 } : j === 4 ? {} : { crop: 'wheat', age: 2 }));
        await buildField(f);
        const chest = { x: f.box.min.x - 2, y: g + 1, z: f.box.min.z + 4 };
        await buildChest(chest, {});
        const ripe = f.cells.filter((c) => c.spec.age === 7);
        const young = f.cells.filter((c) => c.spec.age === 2);
        const empty = f.cells.filter((c) => !c.spec.crop);

        let agent = null, player = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true, farming_pack: true, storage_pack: true });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, f.inside, 0);
            const { min, max } = f.box;
            const set = await command_(agent, `!setArea("wheat_farm", "farm", ${min.x}, ${g - 1}, ${min.z}, ${max.x}, ${g + 3}, ${max.z})`, 20000);
            check(set.includes('Area "wheat_farm" (farm) saved:'), 'precondition: the field is saved as the farm "wheat_farm"', JSON.stringify(set.slice(0, 200)));
            await placeBot(agent, f.outsideGate, 0);
            await giveItems(NAME, [['wheat_seeds', 16]], agent.bot);
            check(ripe.length === 7 && empty.length === 6 && young.length === 35, 'precondition: 7 ripe plants, 6 empty cells, 35 young plants');

            player = await connectPlayer(PLAYER);
            s.route(/w_player: get back to farming/, '!farmCycle');
            player.chat('get back to farming');
            const done = await waitFor(() => historyTurn(agent, 'Farm "'), { ms: 240000, every: 500 });
            await waitIdle(agent, 30000);
            const turn = done.ok ? done.value : '';
            const text = turn.slice(turn.indexOf('Farm "'));
            note(`the result of !farmCycle in the history: ${JSON.stringify(turn)}`);
            const asked = s.chat.requests.find((q) => q.turns.some((t) => String(t.content).includes('get back to farming')));
            check(Boolean(asked) && s.routes.length === 0, 'the model got the owner\'s words "get back to farming" and answered !farmCycle');
            check(done.ok, 'the result of !farmCycle came back to the model', `${done.ms} ms`);

            const inChest = await chestItems(chest);
            const ripeNow = await cropAges(ripe.map((c) => c.above));
            const emptyNow = await cropAges(empty.map((c) => c.above));
            const youngNow = await cropAges(young.map((c) => c.above));
            const ground = await blockNames(f.cells.map((c) => c.ground), ['farmland', 'dirt', 'grass_block', 'air']);
            const ring = await blockNames(f.fenceRing, ['oak_fence', 'oak_fence_gate']);
            const inv = await stableInventory(NAME);
            note(`the chest holds ${itemsText(inChest)}; the bot carries ${itemsText(inv.items)}`);
            note(`ripe cells now ${JSON.stringify(ripeNow)}, empty cells now ${JSON.stringify(emptyNow)}`);

            check((inChest?.wheat || 0) === 7, 'the wheat is in the chest (7 wheat)', itemsText(inChest));
            check(!inv.items.wheat, 'the bot carries no wheat any more', `wheat ${inv.items.wheat || 0}`);
            check(!inChest?.wheat_seeds, 'no seeds were stored: the bot carries fewer than 32 (Amendment 1: keep 32 seeds)', itemsText(inChest));
            check(ripeNow.every((a) => a === 0), 'the ripe cells were harvested and planted again (age 0)', JSON.stringify(ripeNow));
            check(emptyNow.every((a) => a === 0), 'the empty cells were planted (age 0)', JSON.stringify(emptyNow));
            check(youngNow.every((a) => a === 2), 'the 35 young plants stand (age 2)', JSON.stringify(youngNow.filter((a) => a !== 2)));
            check(ground.every((x) => x === 'farmland'), 'no block of farmland became dirt', JSON.stringify(f.cells.filter((c, i) => ground[i] !== 'farmland').map((c) => c.ground)));
            const ringOk = ring.every((x, i) => x === (f.fenceRing[i].x === f.gate.x && f.fenceRing[i].z === f.gate.z ? 'oak_fence_gate' : 'oak_fence'));
            check(ringOk, 'the fence is whole');
            check(await isOpen(f.gate, 'oak_fence_gate') === false, 'the gate is closed at the end');

            const at = `(${chest.x}, ${chest.y}, ${chest.z})`;
            const parts = [
                'Farm "wheat_farm": I harvested 7 wheat and planted 7 again. 35 plants are not ripe yet.',
                `I stored 7 wheat in the chest at ${at}.`,
                'I planted 6 wheat_seeds.',
                'The gate is closed.',
            ];
            const idx = parts.map((p) => text.indexOf(p));
            check(idx.every((i) => i >= 0) && idx.every((i, k) => k === 0 || i > idx[k - 1]),
                'the text of F2 for the cycle: harvest, stored in the chest, planted, "The gate is closed." in this order', `${JSON.stringify(text)}; positions ${JSON.stringify(idx)}`);
            check(text.startsWith(parts[0]) && text.trimEnd().endsWith(parts[3]), 'the text starts with Farm "wheat_farm": and ends with "The gate is closed."', JSON.stringify(text));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await quitPlayer(player);
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
