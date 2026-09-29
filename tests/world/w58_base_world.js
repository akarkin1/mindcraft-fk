// W58 base world (v0.1.4.8, spec section 12, T2.2): proves the harness of the world type `base`, like w01 for
// the flat world. No defect of the play test: every scenario of the base world stands on this one.
//   1. The base is built in the region and read back from the server block by block (verifyBase): house,
//      trapdoor and ladders, the room at y 41 with chest and crafting table, 16 steps of loose blocks down
//      to y 25, the landing, the tunnel of 1 x 2 and 12 blocks, the farm with gate, composter and the chest
//      in the fence line, the pen with gate, cow and chicken inside.
//   2. The real agent with the modes of the owner (MODES_PROFILE) joins; the place "home" is saved as a
//      place only; the bot stands in the house, in the room at y 41 and at the end of the tunnel (server
//      positions) and sees there what the server has (its chunks are loaded).
//   3. No area was saved, the process of the agent lives, no request reached a real model.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, withModes, placeBot, resetBot,
    entityPos, fmt, env, orderChannel, STUCK_SAID, saidSince,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist } from './world.js';
import { basePlan, buildBase, verifyBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_basew';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        const t0 = Date.now();
        await buildBase(b);
        note(`the base was built in ${Date.now() - t0} ms in the region x=${r.ox} z=${r.oz}, ground y ${r.g}`);
        const v = await verifyBase(b);
        for (const l of v.lines) note(`base: ${l}`);
        check(v.ok, 'the base is built as planned (every part read back from the server)', v.failed.join(' || '));

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true }));
            agent = s.agent;
            await resetBot(NAME);
            const tStart = Date.now();
            const inHouse = await placeBot(agent, b.house.home, 180);
            check(inBox(inHouse, b.house.interior), 'the bot stands in the house (server)', fmt(inHouse));
            saveHomePlace(agent, b);
            const place = agent.memory_bank.recallPlace('home');
            check(Array.isArray(place) && dist({ x: place[0], y: place[1], z: place[2] }, { x: b.house.home.x + 0.5, y: b.house.home.y, z: b.house.home.z + 0.5 }) < 0.1,
                'the place "home" is saved in the memory of the bot (the middle of the house)', JSON.stringify(place));
            const seen = (p) => agent.bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? null;
            check(seen(b.house.door) === 'oak_door' && seen(b.trapdoor) === 'oak_trapdoor' && seen(b.shaft.ladders[0]) === 'ladder',
                'the bot sees the door, the trapdoor and the ladders', `${seen(b.house.door)}, ${seen(b.trapdoor)}, ${seen(b.shaft.ladders[0])}`);

            orders = await orderChannel(s, { at: { x: b.house.outsideDoor.x + 6, y: b.g + 1, z: b.house.outsideDoor.z - 4 } });
            const reply = await orders.order('!stats', 20000);
            note(`!stats typed by the player answered ${JSON.stringify(reply.slice(0, 300))}`);
            check(/Position/i.test(reply), 'a command typed by the player in the chat runs and answers in the chat (the order channel of the tests)', JSON.stringify(reply.slice(0, 120)));

            const inRoom = await placeBot(agent, b.room.middle, 0);
            check(Math.floor(inRoom.y + 0.01) === b.room.box.min.y && inBox(inRoom, b.room.box), `the bot stands in the room at y ${b.room.box.min.y} under the house (server)`, fmt(inRoom));
            check(seen(b.room.chest) === 'chest' && seen(b.room.table) === 'crafting_table', 'in the room the bot sees the chest and the crafting table', `${seen(b.room.chest)}, ${seen(b.room.table)}`);
            const inTunnel = await placeBot(agent, b.tunnel.end, 180);
            check(Math.floor(inTunnel.y + 0.01) === b.tunnel.end.y && Math.floor(inTunnel.z) === b.tunnel.end.z, `the bot stands at the end of the tunnel at y ${b.tunnel.end.y} (server)`, fmt(inTunnel));
            check(seen({ ...b.tunnel.end, y: b.tunnel.end.y + 2 }) === 'stone', 'in the tunnel the bot sees the stone above its head');
            const onFarm = await placeBot(agent, b.farm.outsideGate, 180);
            check(dist(onFarm, { x: b.farm.outsideGate.x + 0.5, y: b.farm.outsideGate.y, z: b.farm.outsideGate.z + 0.5 }) < 1, 'the bot stands at the gate of the farm', fmt(onFarm));

            check(agent.area_store ? agent.area_store.list().length === 0 : true, 'no area is saved: the house is a place only', JSON.stringify(agent.area_store?.list?.().map((a) => a.name)));
            check(saidSince(s, STUCK_SAID, tStart).length === 0, `the mode unstuck did not say "${STUCK_SAID}"`);
            check(s.killed === null, 'the process of the agent lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
            note(`the position at the end: ${fmt(await entityPos(NAME))}`);
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
