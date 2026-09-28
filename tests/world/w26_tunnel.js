// W26 tunnel (spec v0.1.4.7 section 8 "Tunnel", M2 tunnelStep and veinOrder, M4 setupMineBase and
// digTunnel), deep world: mining_pack on, protected_areas on, world_memory on.
// The bot digs its own shaft 12 blocks down and sets up the base; the mine in the store gives the
// base and the direction of the tunnel (setupMineBase: a room of 3 by 3 in front of the shaft, the
// tunnel starts at its far row, base + 2 in the direction, with the feet at the level). On the line
// of the tunnel the scenario then puts, counted in steps from the room:
//   step 6   a vein of 5 iron_ore beside the tunnel (right side, going away and down);
//   step 12  a source of lava beside the tunnel (left side, at the height of the head);
//   step 19  a cave of 3 x 3 x 3 ahead, on the line.
// digTunnel(24): the tunnel is straight up to the cave, 1 wide and 2 high, with a torch every 8
// steps; the whole vein of 5 is in the inventory; the lava is closed and the bot was never hurt; the
// cave is closed where the tunnel met it and the tunnel turned to the side and went on.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, placeBot, resetBot, giveItems, entityPos, fmt,
    startTrace, printTrace, runSkill, MINING_SETTINGS, MINING_KIT, watchHealth, largestDrop, env,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, blockNames, findBlocks, lavaPocket, carve, placeVein, veinBeside, stableInventory,
    itemsText, add, rightOf, leftOf, DIRS,
} from './world.js';

const NAME = 'w_tunnel';
const OPEN = ['air', 'cave_air', 'torch', 'wall_torch'];

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        check(env.world === 'deep', 'precondition: the scenario runs in the deep world', env.world);

        let agent = null;
        try {
            const s = await startAgent(NAME, MINING_SETTINGS);
            agent = s.agent;
            const mining = agent.work_packs?.mining;
            check(Boolean(mining), 'precondition: the mining pack is loaded');
            if (!mining) return;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, 0);
            await giveItems(NAME, MINING_KIT, agent.bot);
            const level = g + 1 - 12;
            const down = await runSkill(agent, 'test_descend', (bot, ctx) => mining.descendToLevel(bot, ctx, level), 480000);
            const base = await runSkill(agent, 'test_base', (bot, ctx) => mining.setupMineBase(bot, ctx), 300000);
            const mine = agent.packContext().mines?.list().find((m) => m.level === level) ?? null;
            note(`descendToLevel: ${JSON.stringify(down.result?.text)}; setupMineBase: ${JSON.stringify(base.result?.text)}`);
            note(`the mine: base ${JSON.stringify(mine?.base)}, direction ${mine?.direction}, end ${JSON.stringify(mine?.end)}`);
            check(down.result?.ok === true && base.result?.ok === true && mine?.base && DIRS[mine.direction], 'precondition: the bot went 12 blocks down, set up the base, and the mine has a base and a direction');
            if (!mine?.base || !DIRS[mine.direction]) return;

            // ---------------------------------------------------------- the line of the tunnel and what lies on it
            const d = mine.direction, right = rightOf(d), left = leftOf(d);
            const cell = (k, dy = 0) => ({ ...add(mine.base, d, 2 + k), y: level + dy });
            const vein = veinBeside(add(cell(6), right), right, 5);
            const lava = add(cell(12, 1), left);
            const caveMin = add(cell(19, -1), left), caveMax = add(cell(21, 1), right);
            const cave = {
                min: { x: Math.min(caveMin.x, caveMax.x), y: level - 1, z: Math.min(caveMin.z, caveMax.z) },
                max: { x: Math.max(caveMin.x, caveMax.x), y: level + 1, z: Math.max(caveMin.z, caveMax.z) },
            };
            await placeVein(vein, 'iron_ore');
            await lavaPocket(lava);
            await carve(cave);
            note(`on the line: vein ${JSON.stringify(vein)}; lava ${fmt(lava)}; cave ${fmt(cave.min)} to ${fmt(cave.max)}`);

            const health = watchHealth(agent.bot);
            const trace = startTrace(async () => ({ pos: await entityPos(NAME) }), 300);
            const dig = await runSkill(agent, 'test_tunnel', (bot, ctx) => mining.digTunnel(bot, ctx, 24), 600000);
            const rows = await trace.stop();
            const hp = health.stop();
            printTrace('digTunnel(24)', rows, { pos: (x) => fmt(x.pos) }, 60);
            note(`digTunnel(24) after ${(dig.ms / 1000).toFixed(1)} s: ${JSON.stringify(dig.result?.text)}`);
            const after = agent.packContext().mines?.list().find((m) => m.level === level) ?? null;
            note(`the mine after the tunnel: length ${after?.length}, end ${JSON.stringify(after?.end)}`);
            check(dig.result?.ok === true, 'digTunnel(24) ended with ok', JSON.stringify(dig.result?.text));

            // ---------------------------------------------------------- straight, 1 wide, 2 high up to the cave
            // (steps 1 to 16: where the tunnel turns at the cave, a wall of step 17 or 18 may open)
            const ks = [];
            for (let k = 1; k <= 16; k++) ks.push(k);
            const inside = ks.flatMap((k) => [cell(k), cell(k, 1)]);
            const insideNames = await blockNames(inside, OPEN);
            const closedIn = inside.filter((p, i) => !insideNames[i]);
            check(closedIn.length === 0, 'the tunnel is straight: every cell of steps 1 to 16 on the line is open at the feet and the head', JSON.stringify(closedIn.slice(0, 6)));
            // the holes of the vein are left open (M4): the vein and the blocks beside it the bot dug to reach it
            const key = (p) => `${p.x},${p.y},${p.z}`;
            const nearVein = new Set(vein.flatMap((p) => [p, ...[[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([a, b, c]) => ({ x: p.x + a, y: p.y + b, z: p.z + c }))]).map(key));
            const shell = ks.flatMap((k) => [add(cell(k), left), add(cell(k), right), add(cell(k, 1), left), add(cell(k, 1), right), cell(k, 2), cell(k, -1)])
                .filter((p) => !nearVein.has(key(p)));
            const shellNames = await blockNames(shell, ['air', 'cave_air', 'lava', 'water']);
            const holes = shell.map((p, i) => (shellNames[i] ? { ...p, name: shellNames[i] } : null)).filter(Boolean);
            check(holes.length === 0, 'the tunnel is 1 wide and 2 high: walls, floor and ceiling of steps 1 to 16 are solid (the holes of the vein aside)', JSON.stringify(holes.slice(0, 6)));

            // ---------------------------------------------------------- torches
            const along = { min: { x: Math.min(cell(0).x, cell(24).x) - 4, y: level - 1, z: Math.min(cell(0).z, cell(24).z) - 4 }, max: { x: Math.max(cell(0).x, cell(24).x) + 4, y: level + 2, z: Math.max(cell(0).z, cell(24).z) + 4 } };
            const torches = await findBlocks(along, ['torch', 'wall_torch']);
            const stepOf = (p) => (p.x - mine.base.x) * DIRS[d].x + (p.z - mine.base.z) * DIRS[d].z - 2;
            const steps = torches.map((t) => stepOf(t.pos)).sort((a, b) => a - b);
            note(`torches along the tunnel at steps ${JSON.stringify(steps)} (0 is the far row of the room)`);
            check(steps.some((k) => k >= 6 && k <= 10) && steps.some((k) => k >= 14 && k <= 18), 'a torch every 8 steps: one near step 8 and one near step 16', JSON.stringify(steps));

            // ---------------------------------------------------------- the vein
            const veinNow = await blockNames(vein, ['iron_ore']);
            const inv = await stableInventory(NAME);
            note(`the bot carries ${itemsText(inv.items)}`);
            check(veinNow.every((x) => x === null), 'the whole vein of 5 was taken (no iron_ore left of it)', JSON.stringify(vein.filter((p, i) => veinNow[i])));
            check((inv.items.raw_iron || 0) >= 5, 'the ore of the vein is in the inventory (5 raw_iron)', `raw_iron ${inv.items.raw_iron || 0}`);

            // ---------------------------------------------------------- the lava
            const lavaBox = { min: { x: Math.min(cell(10).x, cell(14).x) - 2, y: level - 1, z: Math.min(cell(10).z, cell(14).z) - 2 }, max: { x: Math.max(cell(10).x, cell(14).x) + 2, y: level + 2, z: Math.max(cell(10).z, cell(14).z) + 2 } };
            const lavaLeft = await findBlocks(lavaBox, ['lava']);
            check(lavaLeft.length === 0, 'the lava beside the tunnel is closed (no lava left within 2 blocks of the tunnel)', JSON.stringify(lavaLeft.map((x) => x.pos)));
            check(hp.min === 20, 'the bot was never hurt', JSON.stringify(hp.hurt.slice(0, 5)));
            check(largestDrop(rows).drop <= 1.6, 'the bot did not fall', `${largestDrop(rows).drop.toFixed(2)} blocks`);

            // ---------------------------------------------------------- the cave
            const opening = await blockNames([cell(19), cell(19, 1), cell(18), cell(18, 1)], OPEN);
            const caveOpen = await findBlocks(cave, ['air', 'cave_air']);
            const caveAir = caveOpen.length;
            const inCave = (p) => p.x >= cave.min.x && p.x <= cave.max.x && p.y >= cave.min.y && p.y <= cave.max.y && p.z >= cave.min.z && p.z <= cave.max.z;
            const caveAirKeys = new Set(caveOpen.map((x) => key(x.pos)));
            const region2 = {
                min: { x: Math.min(cell(-1).x, cell(25).x) - 4, y: level, z: Math.min(cell(-1).z, cell(25).z) - 4 },
                max: { x: Math.max(cell(-1).x, cell(25).x) + 4, y: level + 1, z: Math.max(cell(-1).z, cell(25).z) + 4 },
            };
            const tunnelCells = (await findBlocks(region2, OPEN)).map((x) => x.pos).filter((p) => !inCave(p));
            const touching = tunnelCells.filter((p) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
                .some(([a, b, c]) => caveAirKeys.has(key({ x: p.x + a, y: p.y + b, z: p.z + c }))));
            const side = [];
            for (const dir of [left, right]) for (let k = 16; k <= 24; k++) side.push({ dir, k, p: add(cell(k), dir, 3) });
            const sideOpen = await blockNames(side.map((x) => x.p), OPEN);
            const turned = side.filter((x, i) => sideOpen[i]);
            note(`at the cave: the line at step 19 ${JSON.stringify(opening.slice(0, 2))}, at step 18 ${JSON.stringify(opening.slice(2))} (null: solid); the cave has ${caveAir} of 27 blocks of air; open cells 3 blocks to the side: ${JSON.stringify(turned.map((x) => `${x.dir} ${x.k}`))}`);
            check(touching.length === 0, 'the cave is closed off: no open cell of the tunnel touches the air of the cave with a face', JSON.stringify(touching.slice(0, 6)));
            check(caveAir >= 9, 'the cave is still there (it was closed off, not filled)', `${caveAir} of 27`);
            check(turned.length >= 3, 'the tunnel turned: it goes on 3 blocks to the side of the line, past the cave', `${turned.length} open cells`);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
