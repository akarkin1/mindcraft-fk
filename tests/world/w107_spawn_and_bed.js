// W107 the first second and the bed (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md 5.1 and 5.2,
// SPEC section 5 and 4.3 G1, G2): a dig in the first seconds after the spawn is done, and a bot that gets out of bed gets
// out. Today (v0.1.4.11) the 1.21.8 server ignores every action of the bot for 3 s after the spawn (mineflayer never sends
// player_loaded; the harness waits 3.5 s for that reason), and bot.wake() of mineflayer sends the old form of "leave bed"
// (the home pack works around it).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches of v0.1.4.11, the modes of his profile, an empty memory. The bot is never moved by the control while it plays:
// before its first login the control puts it at its place (a plain client with the bot's name logs in there and out, so
// the server spawns the bot there).
//   A. The bot spawns on the grass north of the house with an oak tree (4 logs) 2 blocks east of it. The agent is started without
//      the 3.5 s wait of the harness (startRealAgent of the end-to-end helpers, not startAgent), and the player types
//      !collectBlocks("oak_log", 1) 1 s after the spawn (or as soon as the agent listens, when that is later: noted). The
//      spawn is taken from the console line "<name> spawned." of the agent, which comes 1 s after it. Within 10 s of the
//      order a log of the tree is gone (server).
//   B. The player in the house types !goToPlayer ("come here"); night (time 13000): typed !goToBed, the bot sleeps
//      (server). Then typed !stop and !goToCoordinates to the cell 5 blocks east of the bed: the bot is out of the bed
//      within 4 s of the !stop (server, sampled every 250 ms) and at the coordinates within 30 s.
// Throughout: the process lives, no request reached a real model.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, tp, recordAgent, recordConsole,
    connectPlayer, quitPlayer, orderChannel, requireControl, serverSleeping,
} from './helpers.js';
import { startRealAgent } from '../e2e/helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, treePlan, buildTree } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { PLAYER, saidLines, RELEASE_SETTINGS } from './journey.js';

const NAME = 'w_spawn';
const ORDER = '!collectBlocks("oak_log", 1)';
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;

await scenarioMain({
    async main() {
        requireControl();
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const g = b.g;
        const spot = { x: b.ox + 10, y: g + 1, z: b.oz - 14 };
        // an oak tree 2 blocks east of the spawn (a lone log is a log of a building to the wood pack: never taken)
        const tree = treePlan(spot.x + 2, spot.z, g, 4);
        await buildTree(tree, { natural: true });
        const logsLeft = async () => (await blockNames(tree.logs, ['oak_log'])).filter(Boolean).length;
        const log = tree.logs[0];
        let started = null, player = null, orders = null;
        try {
            // ---------------------------------------------------------- the place of the first spawn
            const pre = await connectPlayer(NAME);
            await commands([`gamemode survival ${NAME}`, `clear ${NAME}`]);
            await tp(NAME, spot, -90, 0);
            await waitFor(() => pre.entity && Math.hypot(pre.entity.position.x - (spot.x + 0.5), pre.entity.position.z - (spot.z + 0.5)) < 0.5, { ms: 5000, every: 50 });
            await sleep(500);
            await quitPlayer(pre);
            player = await connectPlayer(PLAYER);
            await commands([`gamemode creative ${PLAYER}`]);
            await tp(PLAYER, { x: spot.x, y: g + 1, z: spot.z - 4 }, 0, 0);
            await sleep(1000);

            // ---------------------------------------------------------- A. the agent, without the wait of the harness
            let spawnedLine = null;
            const origLog = console.log;
            console.log = function spawnClock(...args) {
                if (spawnedLine === null && String(args[0]).includes(`${NAME} spawned.`)) spawnedLine = Date.now();
                return origLog.apply(this, args);
            };
            const logs = recordConsole('log');
            check((await logsLeft()) === tree.logs.length, 'precondition: the tree 2 blocks east of the spawn stands', `${await logsLeft()} of ${tree.logs.length} logs`);
            started = await startRealAgent(NAME, env.port, RELEASE_SETTINGS());
            started.logs = logs;
            recordAgent(started);
            const s = started;
            const agent = s.agent;
            const tSpawn = (spawnedLine ?? Date.now()) - 1000;
            const wait = 1000 - (Date.now() - tSpawn);
            if (wait > 0) await sleep(wait);
            const tOrder = Date.now();
            player.chat(ORDER);
            note(`A: the order ${ORDER} was typed ${((tOrder - tSpawn) / 1000).toFixed(2)} s after the spawn${spawnedLine === null ? ' (no "spawned." line seen: the spawn taken as 1 s before the agent listened)' : ''}; the bot at ${fmt(await entityPos(NAME))}, the log at ${P(log)}`);
            check(tOrder - tSpawn <= 2500, 'A: precondition: the order is typed within 2.5 s of the spawn (1 s, or when the agent first listens)', `${((tOrder - tSpawn) / 1000).toFixed(2)} s`);
            const gone = await waitFor(async () => (await logsLeft()) < tree.logs.length, { ms: 10000, every: 250 });
            const arrived = s.messages.some((m) => m.source === PLAYER && m.message === ORDER);
            note(`A: the log is ${gone.ok ? `gone after ${(gone.ms / 1000).toFixed(1)} s` : 'still there after 10 s'}; the order ${arrived ? 'arrived' : 'did NOT arrive'}; the bot said ${JSON.stringify(saidLines(s, tOrder).slice(0, 6))}`);
            check(gone.ok, 'A: a dig 1 s after the spawn is done: a log of the tree 2 blocks away is gone within 10 s of the order (server)', `${await logsLeft()} of ${tree.logs.length} logs stand; order arrived ${arrived}`);
            await waitFor(() => !agent.actions.executing, { ms: 30000, every: 250 });

            // ---------------------------------------------------------- B. the bed
            await quitPlayer(player);
            player = null;
            const bed = b.house.bedFoot;
            const target = { x: bed.x + 5, y: g + 1, z: bed.z };
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.home.x, y: g + 1, z: b.house.home.z - 2 } });
            // the owner calls the bot into the house first ("come here"): the bed is reached from inside (run 2: from the
            // spawn outside, !goToBed walked to the outside of the wall beside the bed and found no way in)
            const come = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 90000);
            note(`B: "come here" into the house answered ${JSON.stringify(come.reply.slice(0, 200))}; the bot at ${fmt(await entityPos(NAME))}`);
            await commands(['gamerule doDaylightCycle false', 'time set 13000']);
            const sleepOrder = await orders.orderInfo('!goToBed', 120000);
            const asleep = await waitFor(() => serverSleeping(NAME), { ms: 60000, every: 500 });
            note(`B: !goToBed answered ${JSON.stringify(sleepOrder.reply.slice(0, 200))}; the server says the bot ${asleep.ok ? 'sleeps' : 'does NOT sleep'}; the bot at ${fmt(await entityPos(NAME))}`);
            check(asleep.ok, 'B: precondition: at night !goToBed puts the bot into its bed (server)', fmt(await entityPos(NAME)));
            if (asleep.ok) {
                await sleep(2000);
                const tStop = Date.now();
                const stop = await orders.order('!stop', 10000);
                const go = orders.orderInfo(`!goToCoordinates(${target.x}, ${target.y}, ${target.z}, 0)`, 30000);
                const out = await waitFor(async () => !(await serverSleeping(NAME)), { ms: 4000, every: 250 });
                const outAfter = out.ok ? Date.now() - tStop : null;
                const there = await waitFor(async () => {
                    const a = await entityPos(NAME);
                    return a && Math.abs(Math.floor(a.x) - target.x) <= 1 && Math.abs(Math.floor(a.y + 0.01) - target.y) <= 1 && Math.abs(Math.floor(a.z) - target.z) <= 1 ? a : null;
                }, { ms: 30000 - (Date.now() - tStop), every: 250 });
                const goInfo = await go;
                const stillAsleep = await serverSleeping(NAME);
                note(`B: !stop answered ${JSON.stringify(stop.slice(0, 120))}; out of the bed ${outAfter === null ? `NOT within 4 s (asleep now: ${stillAsleep})` : `after ${(outAfter / 1000).toFixed(2)} s`}; !goToCoordinates answered ${JSON.stringify(goInfo.reply.slice(0, 200))}; the bot at ${fmt(await entityPos(NAME))}, the target ${P(target)}`);
                check(out.ok, 'B: after !stop and !goToCoordinates the bot is out of the bed within 4 s (server)', outAfter === null ? `still asleep ${stillAsleep}` : `${outAfter} ms`);
                check(there.ok, 'B: the bot is at the coordinates 5 blocks from the bed within 30 s', fmt(await entityPos(NAME)));
            }

            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (player) await quitPlayer(player);
            if (orders) await orders.quit();
            if (started) await stopRealAgent(started.agent);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
