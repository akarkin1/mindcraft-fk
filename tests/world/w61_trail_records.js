// W61 the trail records (v0.1.4.9 spec I1, A1, section 11 TW 3).
// New in v0.1.4.9: with routes_pack the bot records its trail, a step for every new feet cell, in
// <worldDir>/trail.json ({ version: 1, steps }), written at most every 5 s. A step holds the cell, the blocks at
// and under the feet, whether the cell is under open sky, the time, and the door, gate or trapdoor it passed.
// Against v0.1.4.8: there is no trail and no trail.json.
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner. The bot
// stands 30 blocks north of the door of the house; the player types !goToCoordinates to the middle of the house
// (the path search opens the door). Then:
//   - trail.json holds the steps in order: the time never goes back, each step is at most 2 blocks from the one
//     before, the first is at the start of the walk, the last inside the house;
//   - one step has `via` the door of the house (kind door, the lower half of the door);
//   - every step inside the house has sky false, every step outside the house has sky true;
//   - the walk of about 36 blocks gave at least 25 steps.
// Finding of T2 (2026-09-30, left failing): where the house lies across a chunk border (the regions at x = 400,
// 800, 1200, ...: the origin is the first column of a chunk) the steps inside the house have sky true. The notes
// show why: the bot reads sky light 15 under the roof and at the roof block itself where the server has a
// brightness of 9, block light 0 beside a torch where the server has 13, and a block changed near it does not
// change what it reads. trail_logic.js isOpenSky takes a sky light of 15 for open sky. In the region at x = 600 the
// bot reads 10 inside and the scenario passes.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, placeBot, resetBot, waitFor, entityPos,
    fmt, env, orderChannel, readWorldFile, walkTyped, sleep, commands,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_trail';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            const start = { x: b.house.door.x, y: g + 1, z: b.house.door.z - 30 };
            await placeBot(agent, start, 180);
            orders = await orderChannel(s, { name: PLAYER, at: { x: start.x + 12, y: g + 1, z: start.z - 4 } });
            await sleep(1500);
            check(typeof agent.homeContext().routes?.trail?.list === 'function', 'precondition: the trail of the routes pack runs (ctx.routes.trail)');

            const walk = await walkTyped(orders, agent, b.house.home, 120000);
            check(walk.arrived && inBox(walk.pos, b.house.interior), 'the bot walked into the house (server)', fmt(walk.pos));
            // the file is written at most every 5 s
            const file = await waitFor(() => {
                const f = readWorldFile(agent, 'trail.json');
                const steps = f.json?.steps;
                const last = Array.isArray(steps) && steps.length > 0 ? steps[steps.length - 1] : null;
                return last && inBox(last, b.house.interior) && Math.abs(last.x - b.house.home.x) <= 1 && Math.abs(last.z - b.house.home.z) <= 1 ? f : null;
            }, { ms: 20000, every: 500 });
            const f = file.value ?? readWorldFile(agent, 'trail.json');
            note(`trail.json: ${f.file}; ${f.error ?? 'read'}; ${f.json?.steps?.length ?? 0} steps; version ${f.json?.version}; dimension ${f.json?.dimension}`);
            check(file.ok && f.json?.version === 1 && Array.isArray(f.json.steps), 'trail.json exists in the folder of the world, { version: 1, steps }, and its last step is inside the house', f.error ?? '');
            const steps = f.json?.steps ?? [];
            for (const st of steps) note(`step (${st.x}, ${st.y}, ${st.z}) on ${st.on} at ${st.at} sky ${st.sky} via ${st.via ? `${st.via.kind} ${st.via.name} (${st.via.x}, ${st.via.y}, ${st.via.z})` : 'null'}`);

            // in order
            const backInTime = steps.filter((st, i) => i > 0 && st.t < steps[i - 1].t);
            const far = steps.filter((st, i) => i > 0 && Math.hypot(st.x - steps[i - 1].x, st.y - steps[i - 1].y, st.z - steps[i - 1].z) > 2);
            check(steps.length >= 25, 'the walk of about 36 blocks gave at least 25 steps', `${steps.length} steps`);
            check(backInTime.length === 0 && far.length === 0, 'the steps are in order: the time never goes back, each step is at most 2 blocks from the one before',
                `${backInTime.length} back in time, ${far.length} jumps: ${JSON.stringify(far.slice(0, 3))}`);
            const first = steps[0];
            check(first && Math.hypot(first.x - start.x, first.z - start.z) <= 3, 'the first step is where the walk started', JSON.stringify(first));
            // the door
            const door = b.house.door;
            const viaDoor = steps.filter((st) => st.via && st.via.kind === 'door');
            check(viaDoor.length >= 1 && viaDoor.every((st) => st.via.x === door.x && st.via.y === door.y && st.via.z === door.z && /_door$/.test(st.via.name)),
                'a step has `via` the door of the house (kind door, its lower half)', JSON.stringify(viaDoor.map((st) => st.via)));
            // the sky
            const inside = steps.filter((st) => inBox(st, b.house.interior));
            const outside = steps.filter((st) => !inBox(st, b.house.box));
            check(inside.length >= 3 && inside.every((st) => st.sky === false), 'every step inside the house has sky false',
                `${inside.length} inside: ${JSON.stringify(inside.filter((st) => st.sky !== false).slice(0, 3))}`);
            check(outside.length >= 15 && outside.every((st) => st.sky === true), 'every step outside the house has sky true',
                `${outside.length} outside: ${JSON.stringify(outside.filter((st) => st.sky !== true).slice(0, 3))}`);
            check(steps.every((st) => typeof st.on === 'string' && typeof st.at === 'string' && Number.isFinite(st.t)), 'every step has the blocks under and at the feet and a time');
            // what the bot reads where it decides "open sky" (trail_logic isOpenSky: the sky light of the cell at the
            // feet, 15 is open sky; 0 or none: the column above decides), for the report of a failure
            const probe = (p) => {
                const bl = agent.bot.blockAt(new Vec3(p.x, p.y, p.z));
                return `${bl?.name} skyLight ${bl?.skyLight} light ${bl?.light}`;
            };
            const home = b.house.home;
            for (const [label, p] of [['inside the house, feet', home], ['inside the house, head', { ...home, y: g + 2 }], ['inside, under the roof', { ...home, y: g + 4 }],
                ['the roof', { ...home, y: g + 5 }], ['above the roof', { ...home, y: g + 6 }], ['outside, 3 north of the door', { x: door.x, y: g + 1, z: door.z - 3 }],
                ['the room at y 41', b.room.middle], ['the tunnel at y 25', b.tunnel.cells[6]]]) {
                note(`the bot reads at ${label} (${p.x}, ${p.y}, ${p.z}): ${probe(p)}`);
            }
            // the roof block over the middle of the house taken away and put back while the bot is there: the server
            // sends new light for that column (is the light the bot reads only old?)
            await commands([`setblock ${home.x} ${g + 5} ${home.z} minecraft:air`]);
            await sleep(1500);
            await commands([`setblock ${home.x} ${g + 5} ${home.z} minecraft:oak_planks`]);
            await sleep(2500);
            note(`after the roof block over (${home.x}, ${home.z}) was taken away and put back: the bot reads at the feet ${probe(home)}, under the roof ${probe({ ...home, y: g + 4 })}; beside the torch of the house ${probe({ ...b.house.torches[1], z: b.house.torches[1].z + 1 })}`);
            // the light as the server has it (the brightness of the location predicate, noon: the larger of sky and block light)
            const serverLight = async (p) => {
                const out = await commands(Array.from({ length: 16 }, (x, n) => `execute positioned ${p.x} ${p.y} ${p.z} if predicate {condition:"minecraft:location_check",predicate:{light:{light:{min:${n}}}}}`));
                const ok = out.map((lines) => lines.some((l) => /^Test passed/.test(l)));
                return ok.some(Boolean) ? ok.lastIndexOf(true) : `unknown (${out[0].join(' | ').slice(0, 120)})`;
            };
            for (const [label, p] of [['inside the house, feet', home], ['beside the torch of the house', { ...b.house.torches[1], z: b.house.torches[1].z + 1 }],
                ['outside', { x: door.x, y: g + 1, z: door.z - 3 }], ['the room at y 41', b.room.middle]]) {
                note(`the server has at ${label} (${p.x}, ${p.y}, ${p.z}) the brightness ${await serverLight(p)}; the bot reads ${probe(p)}`);
            }
            note(`the bot is at ${fmt(await entityPos(NAME))}`);
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
