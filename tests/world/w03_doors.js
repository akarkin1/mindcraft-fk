// W03 doors (spec section 8 "Doors", H1, H2, G4 door_closing): home_pack on with its default reflexes,
// world_memory on. The bot is sent with !goToCoordinates (the path finder opens what is in the way);
// no model reply is involved, the door_closing reflex has to close the door by itself.
//   A. through the door of a house, from 2 blocks in front of it to the middle of the room
//      (3 blocks past the door): afterwards the door is closed;
//   B. out of the house to a place 8 blocks in front of the door (the bot walks on past the
//      4-block window of H1): afterwards the door is closed;
//   C. through the gate of a fenced pen, 3 blocks past the gate: afterwards the gate is closed;
//   D. a player stands in the open doorway while the bot walks out: the door stays open; when the
//      player has left (within the 10 s of H1) the door is closed.
// Every walk is traced: position of the bot and state of the door from the server every 250 ms.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    waitFor, entityPos, fmt, connectPlayer, quitPlayer, sleep, startTrace, printTrace, tp, command,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, farmPlan, buildFarm, isOpen, inBox, hdist, setOpen,
} from './world.js';

const NAME = 'w_doors';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(40);
        const g = r.g;
        await prepareRegion(r);
        const h = housePlan(r.ox, r.oz, g);
        const pen = farmPlan(r.ox + 16, r.oz, g);
        await buildHouse(h);
        await buildFarm(pen, { crops: false });

        let agent = null, player = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, home_pack: true, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            check(agent.bot.modes.exists('door_closing') && agent.bot.modes.isOn('door_closing'),
                'home_pack on: the mode door_closing exists and is on (home_reflexes default)',
                `exists ${agent.bot.modes.exists('door_closing')}`);

            // Walks from `from` to `to` with !goToCoordinates; returns the trace and how long after the
            // arrival the opening was closed (null: still open after `wait` ms).
            async function walk(label, from, to, opening, kind, yaw, wait = 6000) {
                await placeBot(agent, from, yaw);
                const before = await isOpen(opening, kind);
                const trace = startTrace(async () => ({ pos: await entityPos(NAME), open: await isOpen(opening, kind) }), 250);
                const reply = await command_(agent, `!goToCoordinates(${to.x + 0.5}, ${to.y}, ${to.z + 0.5}, 0.5)`, 40000);
                if (reply === '(timeout)') {
                    note(`${label}: the walk did not end within 40 s, the bot is stopped`);
                    await command_(agent, '!stop', 10000);
                }
                const arrived = await entityPos(NAME);
                const tArrive = Date.now();
                const closed = await waitFor(async () => (await isOpen(opening, kind)) === false, { ms: wait, every: 200 });
                await sleep(500);
                const rows = await trace.stop();
                printTrace(label, rows, {
                    pos: (x) => fmt(x.pos), dist: (x) => hdist(x.pos, { x: opening.x + 0.5, z: opening.z + 0.5 }).toFixed(1),
                    [kind]: (x) => (x.open === null ? '?' : x.open ? 'open' : 'closed'),
                });
                note(`${label}: reply ${JSON.stringify(reply.slice(0, 200))}`);
                return { before, arrived, rows, reply, closedAfter: closed.ok ? Date.now() - tArrive : null, opened: rows.some((x) => x.open === true) };
            }

            // ---------------------------------------------------------- A: into the house
            const a = await walk('A: into the house, 3 blocks past the door', h.outsideDoor, h.inside, h.door, 'oak_door', 180);
            check(a.before === false, 'A: before the walk the door is closed');
            check(inBox(a.arrived, h.interior), 'A: the bot walked through the door into the house', fmt(a.arrived));
            check(a.opened, 'A: the door was opened on the way (it is the only way in)');
            check(a.closedAfter !== null, 'A: afterwards the door is closed (within 6 s of the arrival, without any command)',
                a.closedAfter === null ? 'still open' : `closed ${a.closedAfter} ms after the arrival`);

            // ---------------------------------------------------------- B: out, 8 blocks past the door
            const far = { x: h.door.x, y: g + 1, z: h.door.z - 8 };
            const b = await walk('B: out of the house, 8 blocks past the door', h.inside, far, h.door, 'oak_door', 0);
            check(b.arrived && hdist(b.arrived, { x: far.x + 0.5, z: far.z + 0.5 }) < 1.5, 'B: the bot walked out through the door to the place 8 blocks in front', fmt(b.arrived));
            check(b.opened, 'B: the door was opened on the way out');
            check(b.closedAfter !== null, 'B: afterwards the door is closed although the bot walked on beyond 4 blocks',
                b.closedAfter === null ? 'still open 6 s after the arrival' : `closed ${b.closedAfter} ms after the arrival`);
            if (b.closedAfter === null) await setOpen(h.door, false);

            // ---------------------------------------------------------- C: through the gate of a pen
            const penInside = { x: pen.gate.x, y: g + 1, z: pen.gate.z + 3 };
            const penOutside = { x: pen.gate.x, y: g + 1, z: pen.gate.z - 3 };
            const c = await walk('C: through the fence gate, 3 blocks past it', penOutside, penInside, pen.gate, 'oak_fence_gate', 180);
            check(c.before === false, 'C: before the walk the gate is closed');
            check(c.arrived && hdist(c.arrived, { x: penInside.x + 0.5, z: penInside.z + 0.5 }) < 1.5, 'C: the bot walked through the gate into the pen', fmt(c.arrived));
            check(c.opened, 'C: the gate was opened on the way');
            check(c.closedAfter !== null, 'C: afterwards the gate is closed',
                c.closedAfter === null ? 'still open' : `closed ${c.closedAfter} ms after the arrival`);

            // ---------------------------------------------------------- D: a player in the doorway
            player = await connectPlayer(PLAYER);
            await command(`gamemode creative ${PLAYER}`);
            await setOpen(h.door, true);
            await placeBot(agent, h.inside, 180);
            await tp(PLAYER, h.door, 0);
            await waitFor(() => player.entity && hdist(player.entity.position, { x: h.door.x + 0.5, z: h.door.z + 0.5 }) < 0.5, { ms: 5000 });
            const out3 = { x: h.door.x, y: g + 1, z: h.door.z - 3 };
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), player: await entityPos(PLAYER), open: await isOpen(h.door) }), 250);
            const replyD = await command_(agent, `!goToCoordinates(${out3.x + 0.5}, ${out3.y}, ${out3.z + 0.5}, 0.5)`, 60000);
            const arrivedD = await entityPos(NAME);
            await sleep(4000);
            const openWhilePlayer = await isOpen(h.door);
            await tp(PLAYER, { x: h.door.x + 12, y: g + 1, z: h.door.z - 6 });
            const tLeft = Date.now();
            const closedD = await waitFor(async () => (await isOpen(h.door)) === false, { ms: 6000, every: 200 });
            const rowsD = await trace.stop();
            printTrace('D: the bot walks out while a player stands in the doorway', rowsD, {
                bot: (x) => fmt(x.pos), player: (x) => fmt(x.player), door: (x) => (x.open ? 'open' : 'closed'),
            });
            note(`D: reply ${JSON.stringify(replyD.slice(0, 200))}`);
            check(arrivedD && hdist(arrivedD, { x: out3.x + 0.5, z: out3.z + 0.5 }) < 1.5, 'D: the bot walked out past the player', fmt(arrivedD));
            const closedWhilePlayer = rowsD.some((x) => x.open === false && x.player && hdist(x.player, { x: h.door.x + 0.5, z: h.door.z + 0.5 }) < 2);
            check(openWhilePlayer === true && !closedWhilePlayer, 'D: while the player stands in the doorway the door stays open (4 s after the bot arrived)');
            check(closedD.ok, 'D: after the player left the doorway the door is closed (the bot passed it less than 10 s before)',
                closedD.ok ? `closed ${Date.now() - tLeft} ms after the player left` : 'still open');

            note(`the fake chat model got ${s.chat.requests.length} request(s)`);
            check(s.chat.requests.length === 0, 'no request to the model was needed to close doors and gates');
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await quitPlayer(player);
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
