// W85 the job comes back (journey of v0.1.4.10 "Goals", tester T3; PLAN.md 1.2, CHANGELOG "The job"): the owner gives
// the bot a mining job, calls it away with "follow me", stops, and says nothing. Today (v0.1.4.9) the bot idles after
// every "follow me" until the owner orders the job again (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with job_memory on (job_resume_seconds 60, the default), the modes of his profile, an empty memory, the kit
// of the owner's chest (8 ladders, 16 torches, a stone pickaxe). The bot is never moved by the control.
//   0. The bot and the player outside in front of the house door; the player teaches the mine (journey.js
//      partTeachMine: "follow me" into the house, down both ladders to the end of the tunnel, "this is the mine").
//   1. 8 iron ore beyond the end of the tunnel: 4 within 5 blocks of it, 4 at 14 and 16 blocks. Typed
//      !mineOre("iron", 8).
//   2. After 20 s typed !followPlayer("w_player", 4); the player stands beside the bot and walks 20 blocks out of the
//      mine (the tunnel, the landing, up the descent) and stops. The bot follows.
//   3. Nothing is said for 90 s: within them the bot says "I go back to the mining, N of 8 iron." (N a number).
//   4. The bot ends with 8 raw_iron in its inventory (server), on the surface (within 10 minutes of the line).
// Throughout: the process lives, no request reached a real model.
import fs from 'node:fs';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, waitFor, tp } from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, partTeachMine, spots, GOALS_SETTINGS, oreBeyondTunnel, wayOutOfMine, walkPlayer, onSurface, saidLines, PLAYER,
    journeyTrace, printJourney,
} from './journey.js';

const NAME = 'w_jobback';
const KIT = [['ladder', 8], ['torch', 16], ['stone_pickaxe', 1]];
const readJob = () => { try { return fs.readFileSync(`bots/${NAME}/job.json`, 'utf8').replace(/\s+/g, ' ').slice(0, 400); } catch { return 'missing'; } };
const RESUME = /I go back to the mining, (\d+) of 8 iron\./;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const sp = spots(b);
        const g = b.g;
        let agent = null, orders = null, trace = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: GOALS_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;

            // ---------------------------------------------------------- 0. the mine
            const taught = await partTeachMine({ ...j, b });
            if (!taught.ok) {
                check(false, 'the bot learned the mine (precondition of the job); the rest is not run');
                return;
            }

            // ---------------------------------------------------------- 1. the job
            // 4 ore in reach at the end of the tunnel, 4 more 14 and 16 blocks beyond it: the first run put all 8 within 8
            // blocks and the bot had them before the errand (it said "I go back to the mining, 8 of 8 iron.")
            const ores = await oreBeyondTunnel(b, 4, { at: [2, 4, 14, 16] });
            note(`8 iron ore at ${ores.map(fmt).join(' ')}`);
            const ironOf = async () => (await inventoryOf(NAME)).raw_iron || 0;
            const iron0 = await ironOf();
            trace = journeyTrace(agent, b);
            const tJob = Date.now();
            const mine = orders.orderInfo('!mineOre("iron", 8)', 30000);
            await sleep(20000);
            const m1 = await mine;
            note(`1: !mineOre("iron", 8) after 20 s: ${m1.done ? `answered ${JSON.stringify(m1.reply.slice(0, 300))}` : 'still running'}; the bot at ${fmt(await entityPos(NAME))}, ${await ironOf()} raw_iron`);

            // ---------------------------------------------------------- 2. the errand
            const botAt = await entityPos(NAME);
            const way = wayOutOfMine(b, botAt);
            await tp(PLAYER, way[0]);
            const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 4)`, 5000);
            note(`2: !followPlayer answered ${JSON.stringify(follow.reply.slice(0, 200))}; the stop lines of the job order: ${JSON.stringify(m1.stopped)}`);
            await sleep(1500);
            await walkPlayer(way.slice(1, 21), 450);
            const tStop = Date.now();
            note(`2: the player walked ${Math.min(20, way.length - 1)} blocks and stops at ${fmt(await entityPos(PLAYER))}; the bot at ${fmt(await entityPos(NAME))}`);

            // ---------------------------------------------------------- 3. silence, the bot comes back
            const back = await waitFor(() => saidLines(s, tStop).find((l) => RESUME.test(l)) ?? null, { ms: 90000, every: 500 });
            note(`3: ${back.ok ? `after ${((Date.now() - tStop) / 1000).toFixed(1)} s of silence the bot said ${JSON.stringify(back.value)}` : 'in 90 s of silence the bot did not say that it goes back to the mining'}; it said ${JSON.stringify(saidLines(s, tStop).slice(0, 12))}`);
            const n = back.ok ? Number(RESUME.exec(back.value)[1]) : null;
            check(n !== null && n < 8, '3: the job was not done before the errand (N of the line below 8)', String(n));
            check(back.ok, '3: within 90 s without an order the bot says "I go back to the mining, N of 8 iron."', JSON.stringify(saidLines(s, tStop).slice(0, 6)));
            check(s.messages.filter((m) => m.t0 >= tStop).length === 0, '3: no order was given after the player stopped');

            // ---------------------------------------------------------- 4. the result
            const done = await waitFor(async () => {
                const a = await entityPos(NAME);
                return (await ironOf()) - iron0 >= 8 && onSurface(b, a) && !agent.actions.executing ? a : null;
            }, { ms: back.ok ? 600000 : 30000, every: 2000 });
            const end = await entityPos(NAME);
            const iron = (await ironOf()) - iron0;
            note(`4: ${((Date.now() - tJob) / 1000).toFixed(0)} s after the order: the bot carries ${iron} raw_iron more than before, at ${fmt(end)}; the bot said ${JSON.stringify(saidLines(s, tJob).filter((l) => /mining|iron|job/i.test(l)).slice(0, 12))}`);
            check(iron >= 8, '4: the bot ends with 8 raw_iron in its inventory (server)', `${iron} raw_iron`);
            check(onSurface(b, end), `4: the bot ends on the surface (feet at y ${g + 1} or higher, not in the mine or the basement)`, fmt(end));
            note(`4: done waiting ${done.ok ? 'with every fact' : 'without every fact'}; bots/${NAME}/job.json: ${readJob()}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (trace) printJourney('the job and the errand', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
