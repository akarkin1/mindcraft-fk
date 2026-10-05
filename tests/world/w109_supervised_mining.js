// W109 supervised mining (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 1.16, SPEC section 1 and 5): a scripted
// supervisor drives a mining job through the watch tools `run` and `wait` and sleeps between the changes. Today
// (v0.1.4.12) the watch server has no `run` and no `wait`: the supervisor's first call is refused ("Unknown tool") and
// the scenario fails at its first check of the job.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists) with the room
// tunnel of base_world.js (8 blocks west out of the room), the owner's switches of v0.1.4.12 with watch_server on and a
// free port, the switches of this release (SUPERVISION_SETTINGS), the modes of his profile, an empty memory, a kit of an
// iron pickaxe, 16 torches, 8 ladders and 4 bread. The random token of the harness is in the environment of the agent
// (never printed); the supervisor (tests/world/supervisor.js) runs in this process. The bot is never moved by the
// control.
//   0. The player teaches the mine in the room (journey.js partTeachMineInRoom: "follow me" down both ladders, "this is
//      the mine", "dig here" at the rock face of the room tunnel): the mine is saved with its tunnel. 10 iron ore lie in
//      the line of the tunnel beyond its rock face (at 2, 4, ... 10 blocks, feet and head).
//   1. The supervisor: `run ['!mineOre("iron", 6)']` is accepted: `Ran 1 of 1.` and `1. !mineOre("iron", 6): started.`
//   2. The supervisor loops `wait` (for the running command to end: a help, a failure, a stop and the job's end all end
//      it; timeout 55 s, re-armed on a timeout) and acts by two rules only: a `help` event or a failure line of the bot
//      gets `run` of the fix (here: the job's command again, the bot carries everything); `idle` with the job unfinished
//      (nothing runs, fewer than 6 raw_iron came in) gets the job's command again. To make the second rule fire, the
//      owner types !stop 6 s after the start (as he does when he wants the bot for a moment); the supervisor must bring
//      the mining back.
//   3. Until the job is done: 6 raw_iron in the bag (server, within 200 s of the first `run`); the supervisor's wakes
//      (waits that did not time out) 6 or fewer; no `wait` answered later than 60 s; every `run` accepted.
// Throughout: the token is in no console line of the agent and in no text of the supervisor; the process lives; no
// request reached a real model.
import crypto from 'node:crypto';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands } from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, itemsText } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMineInRoom, spots, saidLines, SUPERVISION_SETTINGS, freePort, journeyTrace, printJourney } from './journey.js';
import { Supervisor, WAIT_MAX_S } from './supervisor.js';

const NAME = 'w_supervised';
const KIT = [['iron_pickaxe', 1], ['torch', 16], ['ladder', 8], ['bread', 4]];
const JOB = '!mineOre("iron", 6)';
const WANT = 6;
const FAILURE = /^(Failed|I could not|I cannot|Path not found|I stop)/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const t = await buildRoomTunnel(b);
        const sp = spots(b);
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the environment of the agent, which runs in this process
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server in 8090..8190', String(port));
        const url = `http://127.0.0.1:${port}/mcp`;
        const sup = new Supervisor({ url, token: TOKEN });
        let agent = null, orders = null, trace = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT,
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();
            note(`the watch port ${port}; the token is set in the environment of the agent (not printed)`);

            // ---------------------------------------------------------- 0. the mine and the ore
            const taught = await partTeachMineInRoom({ ...j, b }, { tunnel: t });
            if (!taught.ok) {
                check(false, '0: the bot learned the mine and its tunnel (precondition of the job); the rest is not run');
                return;
            }
            const ores = [2, 4, 6, 8, 10].flatMap((k) => [0, 1].map((dy) => ({ ...t.beyond(k), y: t.level + dy })));
            await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
            note(`0: 10 iron ore beyond the rock face at ${ores.map(fmt).join(' ')}`);
            const ironOf = async () => (await inventoryOf(NAME)).raw_iron || 0;
            const iron0 = await ironOf();

            // ---------------------------------------------------------- 1. run the job
            trace = journeyTrace(agent, b);
            const tRun = Date.now();
            const first = await sup.run([JOB]);
            note(`1: run [${JOB}] answered ${first.ok ? 'ok' : 'REFUSED'} after ${first.ms} ms: ${JSON.stringify(first.text.slice(0, 300))}`);
            check(first.ok && first.ran === 1 && first.of === 1 && first.results[0]?.result === 'started.',
                `1: \`run ['${JOB}']\` is accepted: \`Ran 1 of 1.\` and \`1. ${JOB}: started.\``, JSON.stringify(first.text.slice(0, 200)));
            const runs = [first];

            // ---------------------------------------------------------- 2. the loop
            // the owner wants the bot for a moment: !stop 6 s after the start (the first run mined 6 iron in 18 s)
            let stopTyped = false;
            const stopper = first.ok ? (async () => {
                await sleep(6000);
                const st = await orders.order('!stop', 20000);
                stopTyped = true;
                note(`2: the owner typed !stop ${((Date.now() - tRun) / 1000).toFixed(0)} s after the start: ${JSON.stringify(st.slice(0, 200))}; ${await ironOf() - iron0} raw_iron so far`);
            })() : Promise.resolve();
            let waitsOk = true;
            while (first.ok && Date.now() - tRun < 200000) {
                if ((await ironOf()) - iron0 >= WANT) break;
                const left = Math.max(5, Math.min(WAIT_MAX_S, Math.floor((200000 - (Date.now() - tRun)) / 1000)));
                const w = await sup.wait({ for: 'done', timeout: left });
                note(`2: wait done (${left} s) answered ${w.ok ? `after ${w.ms} ms, woke ${w.woke}` : `REFUSED after ${w.ms} ms`}: ${JSON.stringify(w.text.slice(0, 400))}`);
                if (!w.ok) { waitsOk = false; break; }
                const help = w.events.find((e) => e.kind === 'help');
                const failure = w.chat.find((c) => c.name === NAME && FAILURE.test(c.text));
                const got = (sup.state.inventory.raw_iron ?? 0);
                if (help || failure) {
                    note(`2: rule 1: ${help ? `help event ${JSON.stringify(help.line)}` : `failure line ${JSON.stringify(failure.line)}`}: run the fix (the job again)`);
                    runs.push(await sup.run([JOB]));
                    note(`2: run answered ${JSON.stringify(runs[runs.length - 1].text.slice(0, 200))}`);
                } else if (sup.state.running === null && got < WANT) {
                    note(`2: rule 2: nothing runs and the job is unfinished (${got} raw_iron came in, the job line ${JSON.stringify(sup.state.job)}): run the job again`);
                    runs.push(await sup.run([JOB]));
                    note(`2: run answered ${JSON.stringify(runs[runs.length - 1].text.slice(0, 200))}`);
                } else if (w.woke === 'timeout') {
                    note('2: the wait timed out; re-armed');
                }
            }

            // ---------------------------------------------------------- 3. the facts
            await stopper;
            const iron = (await ironOf()) - iron0;
            const secs = ((Date.now() - tRun) / 1000).toFixed(0);
            const slowest = sup.calls.filter((c) => c.tool === 'wait').reduce((m, c) => Math.max(m, c.ms), 0);
            note(`3: ${secs} s after the first run the bot carries ${itemsText(await inventoryOf(NAME))}, at ${fmt(await entityPos(NAME))}; the supervisor: ${sup.summary()}; the job line ${JSON.stringify(sup.state.job)}; running ${JSON.stringify(sup.state.running)}`);
            note(`3: the events the supervisor saw: ${JSON.stringify(sup.state.events.map((e) => e.line).slice(0, 12))}; the chat lines: ${JSON.stringify(sup.state.chat.map((c) => c.line).slice(0, 12))}`);
            check(iron >= WANT, `3: the job is done: ${WANT} raw_iron in the bag (server) within 200 s of the first run`, `${iron} raw_iron after ${secs} s`);
            check(sup.wakes <= 6, '3: the supervisor woke 6 times or fewer (waits that did not time out)', `${sup.wakes} wakes, ${sup.timeouts} timeouts, ${sup.count('wait')} waits`);
            check(waitsOk && sup.count('wait') > 0 && slowest <= 60000, '3: no `wait` was answered later than 60 s, none was refused', `${sup.count('wait')} waits, the slowest ${slowest} ms`);
            check(runs.every((x) => x.ok), '3: every `run` of the supervisor was accepted', JSON.stringify(runs.map((x) => x.text.slice(0, 80))));
            check(stopTyped, '3: the owner\'s !stop was typed during the job (the second rule had its chance)', String(stopTyped));

            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            const inSup = sup.calls.some((c) => c.text.includes(TOKEN));
            check(!inLogs && !inSup, 'the token is in no console line of the agent and in no text of the supervisor', `console ${inLogs ? 'HAS it' : 'no'}, supervisor ${inSup ? 'HAS it' : 'no'}`);
            note(`the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 30))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (trace) printJourney('the supervised mining', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
