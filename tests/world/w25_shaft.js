// W25 shaft (spec v0.1.4.7 section 8 "Shaft", M2 shaftStep and staircaseStep, M4 descendToLevel,
// climbToSurface), deep world: mining_pack on, protected_areas on, world_memory on.
//   A  From the surface to a level 30 blocks below. As soon as the bot is 2 blocks down its shaft
//      (so its column is known, the bot chooses the entrance itself), the scenario puts a source of
//      lava beside the column 12 blocks under the surface and a cave of 3 x 3 x 3 under the column
//      20 to 22 blocks under the surface. Then: the bot is at the level, the shaft has ladders, the
//      lava is closed (no lava left beside the shaft), the bot was never hurt, it never fell into the
//      cave (the cave is still there), and climbToSurface brings it up the same shaft.
//   B  20 blocks away, with 10 ladders only, down to a level 25 blocks below: the first blocks have
//      the 10 ladders, the rest is a staircase (the way goes forward as it goes down), the bot is at
//      the level, and it comes up again.
// v0.1.4.8 (W30): the modes of the owner are on (MODES_PROFILE, with the home reflexes). descendToLevel and climbToSurface have
// no command and run through runSkill, which pauses unstuck as the glue does for a pack command (I1).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, placeBot, resetBot, giveItems, entityPos, fmt,
    startTrace, printTrace, runSkill, MINING_SETTINGS, MINING_KIT, watchHealth, largestDrop, env, waitFor, withModes,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, blockNames, findBlocks, hdist, lavaPocket, carve, caveBox, stableInventory,
    itemsText,
} from './world.js';

const NAME = 'w_shaft';

// The column of the shaft: where the bot is once its feet are 2 blocks under the surface.
async function columnOnceDown(g, ms) {
    const got = await waitFor(async () => {
        const p = await entityPos(NAME);
        return p && p.y <= g - 1 + 0.01 ? { x: Math.floor(p.x), z: Math.floor(p.z), y: p.y } : null;
    }, { ms, every: 100 });
    return got.ok ? got.value : null;
}

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        check(env.world === 'deep', 'precondition: the scenario runs in the deep world', env.world);

        let agent = null;
        try {
            const s = await startAgent(NAME, withModes(MINING_SETTINGS));
            agent = s.agent;
            const mining = agent.work_packs?.mining;
            check(Boolean(mining), 'precondition: the mining pack is loaded');
            if (!mining) return;

            // ---------------------------------------------------------- A: 30 blocks, lava and a cave on the way
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox - 20, y: g + 1, z: r.oz }, 0);
            await giveItems(NAME, MINING_KIT, agent.bot);
            const levelA = g + 1 - 30;
            const healthA = watchHealth(agent.bot);
            const traceA = startTrace(async () => ({ pos: await entityPos(NAME) }), 250);
            const runA = runSkill(agent, 'test_descend_a', (bot, ctx) => mining.descendToLevel(bot, ctx, levelA), 600000);
            const col = await columnOnceDown(g, 120000);
            let lava = null, cave = null;
            if (col) {
                lava = { x: col.x + 1, y: g - 12, z: col.z };
                cave = caveBox({ x: col.x, y: g - 20, z: col.z });
                await lavaPocket(lava);
                await carve(cave);
                note(`A: the shaft is at (${col.x}, ${col.z}); lava put at ${fmt(lava)}, a cave from ${fmt(cave.min)} to ${fmt(cave.max)}; the bot is at y ${col.y.toFixed(1)}`);
            }
            check(Boolean(col), 'A: precondition: the bot started a shaft (its feet went 2 blocks under the surface)');
            const a = await runA;
            const rowsA = await traceA.stop();
            const hpA = healthA.stop();
            printTrace('A: down 30 blocks', rowsA, { pos: (x) => fmt(x.pos) }, 60);
            note(`A: descendToLevel(${levelA}) after ${(a.ms / 1000).toFixed(1)} s: ${JSON.stringify(a.result?.text)}`);
            const endA = await entityPos(NAME);
            check(a.result?.ok === true && endA && Math.floor(endA.y + 0.01) === levelA, `A: the bot is at the level, 30 blocks under the surface (y ${levelA})`, `${fmt(endA)} ${JSON.stringify(a.result?.text)}`);
            if (col) {
                const shaft = [];
                for (let y = levelA; y <= g; y++) shaft.push({ x: col.x, y, z: col.z });
                const names = await blockNames(shaft, ['ladder']);
                const missing = shaft.filter((p, i) => !names[i]).map((p) => p.y);
                note(`A: ladders in the column: ${names.filter(Boolean).length} of ${shaft.length}; without a ladder at y ${JSON.stringify(missing)}`);
                check(names.filter(Boolean).length >= 25, 'A: the shaft has ladders (at least 25 of its 31 blocks)', `${names.filter(Boolean).length}`);
                const lavaLeft = await findBlocks({ min: { x: col.x - 2, y: g - 15, z: col.z - 2 }, max: { x: col.x + 2, y: g - 9, z: col.z + 2 } }, ['lava']);
                const lavaNow = (await blockNames([lava], ['lava', 'air', 'ladder']))[0];
                check(lavaLeft.length === 0 && lavaNow === null, 'A: the lava beside the shaft is closed (no lava within 2 blocks of the shaft, a solid block where it was)', `${JSON.stringify(lavaLeft.map((x) => x.pos))}, at the lava: ${lavaNow ?? 'solid'}`);
                const caveAir = (await findBlocks(cave, ['air', 'cave_air'])).length;
                const walls = [];
                for (let y = cave.min.y; y <= cave.max.y; y++) {
                    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) walls.push({ x: col.x + dx, y, z: col.z + dz });
                }
                const open = (await blockNames(walls, ['air', 'cave_air', 'lava', 'water'])).map((n, i) => (n ? walls[i] : null)).filter(Boolean);
                const inCave = shaft.filter((p) => p.y >= cave.min.y && p.y <= cave.max.y);
                const laddersInCave = (await blockNames(inCave, ['ladder'])).filter(Boolean).length;
                note(`A: the cave has ${caveAir} of 27 blocks of air left; around the shaft in the cave ${open.length} of 12 blocks are open`);
                check(laddersInCave === inCave.length && open.length === 0, 'A: the shaft passes through the cave closed off: ladders in the cave, every block beside the shaft there is solid',
                    `ladders ${laddersInCave} of ${inCave.length}, open beside: ${JSON.stringify(open)}`);
                check(caveAir >= 1, 'A: the cave was really there: part of it is still open beyond the wall of the shaft', `${caveAir} blocks of air`);
            }
            const dropA = largestDrop(rowsA);
            note(`A: largest drop between two samples 250 ms apart: ${dropA.drop.toFixed(2)} at t=${dropA.t.toFixed(1)} s ${fmt(dropA.from)} -> ${fmt(dropA.to)}; lowest health ${hpA.min}`);
            check(hpA.min === 20, 'A: the bot was never hurt (lava, fall)', JSON.stringify(hpA.hurt.slice(0, 5)));
            check(dropA.drop <= 1.6, 'A: the bot did not fall (into the cave or anywhere)', `${dropA.drop.toFixed(2)} blocks`);

            const upA = await runSkill(agent, 'test_up_a', (bot, ctx) => mining.climbToSurface(bot, ctx), 300000);
            const topA = await entityPos(NAME);
            note(`A: climbToSurface after ${(upA.ms / 1000).toFixed(1)} s: ${JSON.stringify(upA.result?.text)}; the bot is at ${fmt(topA)}`);
            check(upA.result?.ok === true && topA && topA.y >= g + 0.9 && col && hdist(topA, { x: col.x + 0.5, z: col.z + 0.5 }) <= 4, 'A: climbToSurface brings the bot up the same shaft, past the closed cave', fmt(topA));

            // ---------------------------------------------------------- B: 10 ladders only
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox + 20, y: g + 1, z: r.oz }, 0);
            await giveItems(NAME, MINING_KIT.map(([n, c]) => [n, n === 'ladder' ? 10 : c]), agent.bot);
            const levelB = g + 1 - 25;
            const healthB = watchHealth(agent.bot);
            const traceB = startTrace(async () => ({ pos: await entityPos(NAME) }), 250);
            const runB = runSkill(agent, 'test_descend_b', (bot, ctx) => mining.descendToLevel(bot, ctx, levelB), 600000);
            const colB = await columnOnceDown(g, 120000);
            const b = await runB;
            const rowsB = await traceB.stop();
            const hpB = healthB.stop();
            printTrace('B: down 25 blocks with 10 ladders', rowsB, { pos: (x) => fmt(x.pos) }, 60);
            note(`B: descendToLevel(${levelB}) after ${(b.ms / 1000).toFixed(1)} s: ${JSON.stringify(b.result?.text)}; the shaft started at ${JSON.stringify(colB)}`);
            const endB = await entityPos(NAME);
            const invB = await stableInventory(NAME);
            check(b.result?.ok === true && endB && Math.floor(endB.y + 0.01) === levelB, `B: with 10 ladders the bot still reached the level (y ${levelB})`, `${fmt(endB)} ${JSON.stringify(b.result?.text)}`);
            check(!invB.items.ladder, 'B: the bot used its 10 ladders', itemsText(invB.items));
            if (colB) {
                const shaft = [];
                for (let y = levelB; y <= g; y++) shaft.push({ x: colB.x, y, z: colB.z });
                const n = (await blockNames(shaft, ['ladder'])).filter(Boolean).length;
                check(n >= 8 && n <= 10, 'B: the shaft of the entrance has the 10 ladders (8 to 10 in its column)', `${n}`);
                const away = hdist(endB, { x: colB.x + 0.5, z: colB.z + 0.5 });
                check(away >= 10, 'B: the rest is a staircase: at the level the bot is at least 10 blocks from the column of the ladders (one forward for each step down)', `${away.toFixed(1)} blocks`);
            }
            const mineB = agent.packContext().mines?.list().find((m) => m.level === levelB);
            note(`B: the mine in the store: shaft ${mineB?.shaft}, route ${JSON.stringify(mineB?.route)}`);
            check(hpB.min === 20 && largestDrop(rowsB).drop <= 1.6, 'B: the bot was never hurt and did not fall', `health ${hpB.min}, drop ${largestDrop(rowsB).drop.toFixed(2)}`);
            const upB = await runSkill(agent, 'test_up_b', (bot, ctx) => mining.climbToSurface(bot, ctx), 300000);
            const topB = await entityPos(NAME);
            note(`B: climbToSurface after ${(upB.ms / 1000).toFixed(1)} s: ${JSON.stringify(upB.result?.text)}; the bot is at ${fmt(topB)}`);
            check(upB.result?.ok === true && topB && topB.y >= g + 0.9, 'B: the bot comes up again, the stairs and then the ladders', fmt(topB));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
