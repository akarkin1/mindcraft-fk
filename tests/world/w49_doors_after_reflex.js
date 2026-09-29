// W49 doors after a reflex (v0.1.4.8 spec A3, C5, I8; findings R5 and R9, owner's point 6).
// Defect of the play test: the mode door_closing never ran while another mode was active (the loop of the
// modes ended at the first active mode, and door_closing was last), and the night reflex walked with a path
// finder that opens gates and doors. So the doors and gates that a reflex walked through stayed open ("door
// rules do not work all the time"). Against v0.1.4.7: after the night reflex has walked the bot out of the
// farm and into the house, the gate of the farm stands open.
//
// Base world, the modes of the owner, the owner's packs; the house is the place "home" (the shelter, C4). The
// bot stands inside the fenced farm on the cell next to the gate, the gate closed. The time is set to 12500
// (dusk).
//   - the night reflex walks the bot out through the gate of the farm (the gate was open on the way) and into
//     the house through its door (the door was open on the way);
//   - afterwards the gate of the farm is closed and the door of the house is closed (server), within 10 s of
//     the arrival in the house;
//   - the console has "Door service: closed oak_fence_gate at (x, y, z)." for the gate (C5).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, commands, startTrace, printTrace, sleep, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_doors0148';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const gate = b.farm.gate;

        let agent = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            // on the cell right inside the gate: the gate is the shorter way home by far (a chest in the fence line
            // is a step the path search can jump over, seen on the test server)
            await placeBot(agent, { x: gate.x, y: g + 1, z: gate.z + 1 }, 180);
            check(inBox(await entityPos(NAME), b.farm.box), 'precondition: the bot stands inside the fenced farm, next to the gate');
            check(await isOpen(gate, 'oak_fence_gate') === false && await isOpen(b.house.door) === false, 'precondition: the gate of the farm and the door of the house are closed');

            const t0 = Date.now();
            await commands(['time set 12500']);
            const trace = startTrace(async () => ({
                pos: await entityPos(NAME), gate: await isOpen(gate, 'oak_fence_gate'), door: await isOpen(b.house.door), action: agent.actions.currentActionLabel || '-',
            }), 300);
            const arrived = await waitFor(async () => inBox(await entityPos(NAME), b.house.interior), { ms: 120000, every: 300 });
            const tIn = Date.now();
            const closed = await waitFor(async () => (await isOpen(gate, 'oak_fence_gate')) === false && (await isOpen(b.house.door)) === false, { ms: 10000, every: 250 });
            await sleep(1000);
            const rows = await trace.stop();
            printTrace('dusk: from the farm into the house', rows, {
                pos: (x) => fmt(x.pos), gate: (x) => (x.gate ? 'OPEN' : 'closed'), door: (x) => (x.door ? 'OPEN' : 'closed'), action: (x) => x.action,
            }, 80);
            const gateEnd = await isOpen(gate, 'oak_fence_gate');
            const doorEnd = await isOpen(b.house.door);
            const lines = s.logs.filter((l) => /^Door service: closed /.test(l));
            note(`${lines.length} lines of the door service: ${JSON.stringify(lines)}`);
            check(rows.some((x) => String(x.action).startsWith('mode:night_shelter')), 'the night reflex walked the bot (mode night_shelter)');
            check(arrived.ok, 'the bot is inside the house', fmt(await entityPos(NAME)));
            check(rows.some((x) => x.gate === true), 'the gate of the farm was opened on the way out');
            check(rows.some((x) => x.door === true), 'the door of the house was opened on the way in');
            check(closed.ok, 'the gate of the farm and the door of the house are closed within 10 s of the arrival', closed.ok ? `${Date.now() - tIn} ms` : `gate open ${gateEnd}, door open ${doorEnd}`);
            check(gateEnd === false && doorEnd === false, 'at the end the gate and the door are closed (server)', `gate open ${gateEnd}, door open ${doorEnd}`);
            check(lines.some((l) => l.startsWith(`Door service: closed oak_fence_gate at (${gate.x}, ${gate.y}, ${gate.z}).`)),
                'the console has "Door service: closed oak_fence_gate at (x, y, z)." for the gate of the farm (C5)', JSON.stringify(lines));
            note(`${((Date.now() - t0) / 1000).toFixed(1)} s from dusk to the end`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['gamerule doDaylightCycle false', 'time set 6000']).catch(() => {});
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
