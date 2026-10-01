// W75 the follow down a ladder (v0.1.4.9 spec section 13, part L; F14 of the owner's play test of 2026-10-01).
// Defect of the play test: "follow me" from the house down the ladder through the closed trapdoor: the path search
// climbs a ladder but never descends one, the bot stood in the cell of the trapdoor, unstuck gave up and the process
// ended. With routes_pack, followPlayer and goToPlayer now go down or up a column of ladders near the bot
// (passLadder of src/agent/library/ladder_pass.js): a closed trapdoor is opened with a click without sneak.
//
// Base world, the owner's switches with routes_pack on (settings0149: stuck_restart_after 3 among the settings of
// v0.1.4.8), the modes of the owner. The player (a second bot, creative) stands in the house beside the trapdoor, the
// bot 7 blocks from it. The trapdoor is closed.
//   1. The player types !followPlayer("w_player", 4) and is moved down the ladder cell by cell with the test control
//      (200 ms per cell) to the room at y 41; the trapdoor is closed again as soon as the player is under it, before
//      the bot comes (the player opens nothing for the bot). Within 60 s the bot is within 4 blocks of the player at y 41; the move recorder
//      shows its click on the trapdoor without sneak; trail.json holds a run of ladder steps in the column.
//   2. The player is moved up the ladder into the house (it opens and closes the trapdoor for itself). Within 60 s
//      the bot is in the house within 4 blocks of it. !stop.
//   3. The player stands in the room, the bot in the house: the typed !goToPlayer("w_player", 2) brings the bot to
//      y 41 within 3 blocks of the player.
// Throughout: the process lives (no cleanKill), every "I'm stuck!" is noted.
// Findings of T2 (2026-10-01, left failing):
//   - part 3: from 3 blocks beside the column (beyond the reach of 2 of ladderColumnAt) !goToPlayer does no ladder
//     pass first; its path search stands on the closed trapdoor until unstuck stops it after 20 s, and the answer
//     says "Done so far: Found non-destructive path. You have reached w_player." with the bot at y 61 (3 of 3 runs);
//   - part 2 (1 of 3 runs): the bot climbs to y 59 under the closed trapdoor and bobs between 58 and 59 for 48 s:
//     followPlayer of skills.js passes a ladder only when the player is farther than the follow distance (the player
//     beside the trapdoor is 2.2 blocks away) and the bot stood still for 3 s;
//   - seen in the first run, with the trapdoor still open when the bot came: the path search took the bot into the
//     column, it hung at y 46 to 48 mid-ladder (no column within reach of its top or bottom) and "I'm stuck!" came.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    placeBot, waitFor, entityPos, sleep, tp, stepCells, columnCells, setTrapdoor, recordMoves, readWorldFile, startTrace, printTrace,
    saidSince, STUCK_SAID,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist, isOpen } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_follow';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const col = b.shaft.column;
        const roomY = b.room.box.min.y;
        const beside = { x: col.x, y: g + 1, z: col.z + 1 }; // in the house, beside the trapdoor
        const roomSpot = { x: col.x, y: roomY, z: col.z + 2 };

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            await placeBot(agent, { x: col.x - 5, y: g + 1, z: col.z + 5 }, 180);
            orders = await orderChannel(s, { name: PLAYER, at: beside });
            await setTrapdoor(b, false);
            const tStart = Date.now();
            const near = async (maxD, y) => {
                const [a, p] = [await entityPos(NAME), await entityPos(PLAYER)];
                return a && p && dist(a, p) <= maxD && (y === undefined || Math.floor(a.y + 0.01) === y) ? { a, p } : null;
            };
            const trace = startTrace(async () => ({ bot: await entityPos(NAME), player: await entityPos(PLAYER), trap: await isOpen(b.trapdoor, 'oak_trapdoor'), action: agent.actions.currentActionLabel || '-' }), 500);
            const moves = recordMoves(agent);

            // ---------------------------------------------------------- 1. down
            const follow = orders.orderInfo(`!followPlayer("${PLAYER}", 4)`, 5000);
            await follow;
            await sleep(2000);
            await setTrapdoor(b, true);
            await stepCells({ name: PLAYER }, [{ x: col.x, y: g, z: col.z }, { x: col.x, y: g - 1, z: col.z }]);
            await setTrapdoor(b, false); // closed again at once, as in the owner's house: the bot has to open it
            await stepCells({ name: PLAYER }, columnCells(col.x, col.z, g - 2, roomY));
            await stepCells({ name: PLAYER }, [{ x: col.x, y: roomY, z: col.z + 1 }, roomSpot], { ms: 300 });
            const t1 = Date.now();
            const down = await waitFor(() => near(4, roomY), { ms: 60000, every: 500 });
            note(`1: the bot ${down.ok ? `is within 4 blocks of the player at y ${roomY} after ${((Date.now() - t1) / 1000).toFixed(1)} s` : 'did not come down within 60 s'}: bot ${fmt(await entityPos(NAME))}, player ${fmt(await entityPos(PLAYER))}`);
            check(down.ok, `1: within 60 s the bot is within 4 blocks of the player at y ${roomY}`, fmt(await entityPos(NAME)));
            const clicks = moves.lines.filter((l) => /activateBlock oak_trapdoor/.test(l));
            note(`1: the clicks on the trapdoor: ${JSON.stringify(clicks)}`);
            check(clicks.some((l) => /open=false .*sneak false/.test(l)), '1: the bot opened the closed trapdoor with a click without sneak (move recorder)', JSON.stringify(clicks));
            await sleep(6000); // the trail file is written at most every 5 s
            const steps = readWorldFile(agent, 'trail.json').json?.steps ?? [];
            const ladderSteps = steps.filter((st) => st.at === 'ladder' && st.x === col.x && st.z === col.z);
            note(`1: trail.json has ${steps.length} steps, ${ladderSteps.length} on the ladder of the shaft (y ${ladderSteps.map((st) => st.y).join(', ')})`);
            check(ladderSteps.length >= 5, '1: trail.json holds a run of ladder steps in the column of the shaft', `${ladderSteps.length} ladder steps`);

            // ---------------------------------------------------------- 2. up
            await stepCells({ name: PLAYER }, [{ x: col.x, y: roomY, z: col.z + 1 }], { ms: 300 });
            await stepCells({ name: PLAYER }, columnCells(col.x, col.z, roomY, g - 1));
            await setTrapdoor(b, true);
            await stepCells({ name: PLAYER }, [{ x: col.x, y: g, z: col.z }, beside], { ms: 400 });
            await setTrapdoor(b, false);
            const t2 = Date.now();
            const up = await waitFor(async () => (await near(4)) && inBox(await entityPos(NAME), b.house.interior), { ms: 60000, every: 500 });
            note(`2: the bot ${up.ok ? `is in the house within 4 blocks of the player after ${((Date.now() - t2) / 1000).toFixed(1)} s` : 'did not come up within 60 s'}: bot ${fmt(await entityPos(NAME))}`);
            check(up.ok, '2: within 60 s the bot followed the player up into the house (within 4 blocks)', fmt(await entityPos(NAME)));
            if (!up.ok) {
                // for the report (no check of the spec): the player walks 6 blocks away from the trapdoor into the house
                const away = { x: b.house.home.x - 2, y: g + 1, z: b.house.home.z + 2 };
                await tp(PLAYER, away);
                const t2b = Date.now();
                const later = await waitFor(async () => inBox(await entityPos(NAME), b.house.interior), { ms: 60000, every: 500 });
                note(`2: with the player 6 blocks from the trapdoor the bot ${later.ok ? `came up into the house after ${((Date.now() - t2b) / 1000).toFixed(1)} s` : 'did not come up within 60 s'}: ${fmt(await entityPos(NAME))}; the ladder lines of the log: ${JSON.stringify(s.logs.filter((l) => /ladder at/.test(l)).slice(-4))}`);
            }
            const stop = await orders.order('!stop', 20000);
            note(`2: !stop answered ${JSON.stringify(stop)}`);

            // ---------------------------------------------------------- 3. !goToPlayer down
            await tp(PLAYER, roomSpot);
            await placeBot(agent, { x: col.x - 2, y: g + 1, z: col.z + 3 }, 180); // in the house
            await sleep(1500);
            const t3 = Date.now();
            const go = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 120000);
            const end = await entityPos(NAME);
            note(`3: !goToPlayer answered after ${((Date.now() - t3) / 1000).toFixed(1)} s: ${JSON.stringify(go.reply.slice(0, 300))}; the bot is at ${fmt(end)}`);
            check(end && Math.floor(end.y + 0.01) === roomY && dist(end, await entityPos(PLAYER)) <= 3, `3: the typed !goToPlayer brings the bot to y ${roomY}, within 3 blocks of the player`, fmt(end));

            moves.stop();
            const rows = await trace.stop();
            printTrace('the follow down and up the ladder', rows, { bot: (x) => fmt(x.bot), player: (x) => fmt(x.player), trapdoor: (x) => (x.trap ? 'open' : 'closed'), action: (x) => x.action }, 120);
            note(`"${STUCK_SAID}" said ${saidSince(s, STUCK_SAID, tStart).length} times; the behaviour log: ${JSON.stringify(s.behavior.filter((x) => x.t >= tStart).map((x) => x.text).slice(0, 20))}`);
            check(s.killed === null, 'the process lived throughout (no "I\'m stuck!" led to a kill)', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
