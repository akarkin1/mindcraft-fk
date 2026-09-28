// W17 plant (spec v0.1.4.7 section 8 "Plant", F1 cellPlan, F2 plantField): farming_pack on,
// protected_areas on, world_memory on. Two fenced fields of 9 x 9, 16 blocks apart, saved as the farms
// "field_a" and "field_b". Each has 27 cells of farmland (the three northern rows and the middle row
// beside the water), 14 cells of grass_block and 7 of dirt (the southern rows), nothing planted.
//   A  the bot has 64 wheat_seeds and an iron_hoe. !plant("wheat_seeds", "field_a"): all 48 cells
//      are farmland with wheat of age 0, the text of F2.
//   B  the bot has 64 wheat_seeds and no hoe. !plant("wheat_seeds", "field_b"): the 27 cells of
//      farmland are planted, the grass and the dirt stay as they were, the text of F2 with the
//      sentence about the missing hoe.
// In both: nothing was dug. Everything around the field, down to 2 blocks under the ground, is as it
// was, except the cells of the field (tilled, planted).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    giveItems,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, fieldPlan, buildField, cropAges, blockNames, isOpen, stableInventory, itemsText,
    snapshotBox, compareSnapshot, describeDifferences, dropSnapshot,
} from './world.js';

const NAME = 'w_plant';

const layout = (i, j) => (j <= 4 ? {} : j <= 6 ? { ground: 'grass_block' } : { ground: 'dirt' });

// Differences of the snapshot that are not a cell of the field (its ground block or the block above).
function strayChanges(cmp, f) {
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const cells = new Set(f.cells.flatMap((c) => [key(c.ground), key(c.above)]));
    return cmp.differences.filter((d) => !d.stateOnly && !cells.has(key(d.pos)));
}

async function plantPart(agent, label, f, name, hoe) {
    const { min, max } = f.box;
    const g = min.y;
    await resetBot(NAME);
    await placeBot(agent, f.inside, 0);
    const set = await command_(agent, `!setArea("${name}", "farm", ${min.x}, ${g - 1}, ${min.z}, ${max.x}, ${g + 3}, ${max.z})`, 20000);
    check(set.includes(`Area "${name}" (farm) saved:`), `${label}: precondition: the field is saved as the farm "${name}"`, JSON.stringify(set.slice(0, 200)));
    await placeBot(agent, f.outsideGate, 0);
    await giveItems(NAME, hoe ? [['wheat_seeds', 64], ['iron_hoe', 1]] : [['wheat_seeds', 64]], agent.bot);
    const snap = await snapshotBox({ min: { x: min.x - 3, y: g - 2, z: min.z - 3 }, max: { x: max.x + 3, y: g + 2, z: max.z + 3 } });
    try {
        const reply = await command_(agent, `!plant("wheat_seeds", "${name}")`, 240000);
        note(`${label}: !plant answered ${JSON.stringify(reply)}`);
        const ground = await blockNames(f.cells.map((c) => c.ground), ['farmland', 'grass_block', 'dirt', 'air']);
        const ages = await cropAges(f.cells.map((c) => c.above));
        const cmp = await compareSnapshot(snap, agent.bot);
        const stray = strayChanges(cmp, f);
        const inv = await stableInventory(NAME);
        note(`${label}: the bot carries ${itemsText(inv.items)}; changes outside the cells: ${describeDifferences(stray)}`);
        const planted = f.cells.filter((c, i) => ground[i] === 'farmland' && ages[i] === 0);
        const soil = f.cells.filter((c) => c.spec.ground === 'farmland');
        const other = f.cells.filter((c) => c.spec.ground !== 'farmland');
        if (hoe) {
            check(reply === 'I planted 48 wheat_seeds.', `${label}: the text of F2 "I planted 48 wheat_seeds."`, JSON.stringify(reply));
            check(planted.length === 48, `${label}: with a hoe all 48 cells are planted (farmland with wheat of age 0), the grass and the dirt were tilled first`,
                `${planted.length} planted; not planted: ${JSON.stringify(f.cells.filter((c, i) => !(ground[i] === 'farmland' && ages[i] === 0)).map((c) => [c.i, c.j, c.spec.ground]))}`);
            check((inv.items.wheat_seeds || 0) === 16, `${label}: the bot used 48 of its 64 seeds`, `wheat_seeds ${inv.items.wheat_seeds || 0}`);
            check((inv.items.iron_hoe || 0) === 1, `${label}: the bot still has its hoe`);
        } else {
            check(reply === 'I planted 27 wheat_seeds. I have no hoe, so I planted only where the ground was farmland.',
                `${label}: the text of F2 "I planted 27 wheat_seeds." with "I have no hoe, so I planted only where the ground was farmland."`, JSON.stringify(reply));
            check(soil.every((c) => planted.includes(c)), `${label}: without a hoe every cell of farmland is planted (27)`, `${planted.length} planted`);
            const otherIdx = other.map((c) => f.cells.indexOf(c));
            check(otherIdx.every((i) => ground[i] === f.cells[i].spec.ground && ages[i] === null),
                `${label}: without a hoe the grass and the dirt stay as they were, nothing planted on them`,
                JSON.stringify(otherIdx.filter((i) => !(ground[i] === f.cells[i].spec.ground && ages[i] === null)).map((i) => [f.cells[i].i, f.cells[i].j, ground[i], ages[i]])));
            check((inv.items.wheat_seeds || 0) === 37, `${label}: the bot used 27 of its 64 seeds`, `wheat_seeds ${inv.items.wheat_seeds || 0}`);
        }
        check(ground.every((x) => x !== 'air'), `${label}: nothing was dug: every cell still has its ground block`, JSON.stringify(f.cells.filter((c, i) => ground[i] === 'air').map((c) => c.ground)));
        check(stray.length === 0, `${label}: nothing was dug or placed around the field (fence, water, the ground under the field and beside it are as they were)`, describeDifferences(stray));
        check(await isOpen(f.gate, 'oak_fence_gate') === false, `${label}: the gate is closed at the end`);
    } finally {
        await dropSnapshot(snap).catch(() => {});
    }
}

await scenarioMain({
    async main() {
        const r = region(32);
        const g = r.g;
        await prepareRegion(r);
        const fa = fieldPlan(r.ox - 14, r.oz - 4, g, layout);
        const fb = fieldPlan(r.ox + 5, r.oz - 4, g, layout);
        await buildField(fa);
        await buildField(fb);
        check(fa.cells.filter((c) => c.spec.ground === 'farmland').length === 27 && fa.cells.length === 48,
            'precondition: each field has 48 cells, 27 of them farmland, 14 grass and 7 dirt');

        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true, farming_pack: true });
            agent = s.agent;
            await plantPart(agent, 'A (hoe)', fa, 'field_a', true);
            await plantPart(agent, 'B (no hoe)', fb, 'field_b', false);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
