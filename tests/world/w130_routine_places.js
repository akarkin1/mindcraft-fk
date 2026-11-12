// W130 the routine with places (entry `routine_places`; v0.1.4.16 "Stability, and three packs", tester T3; PLAN.md section 4 F3 and 7;
// SPEC section 3 F3 and 7): a routine keeps the places the owner named, skips a failed step and goes on, counts its rounds, and
// starts no round under the supervisor's work. Finding R-5: the plan dropped "the west forest chest at (-2383, 65, 832)", one failed
// step ended the round, the round number was always 1, a round started under the supervisor's work. Against 9a28d07 (v0.1.4.15) the
// plan prompt has no rule for places, a plan without the walk step is accepted and one with `!goToCoordinates` is refused ("not one I
// may use"), a failed step pauses the routine instead of being skipped, and routines.json has no `runs`; on the release every check
// passes.
//
// The base world with the base of base_world.js (its fenced wheat farm is NOT saved: "the wheat farm" of the text is a place that
// does not exist, the wrong second place) and a chest with 8 wheat 10 blocks north of the house door, named in the routine's text by
// its coordinates. The owner's switches (SUPERVISION_SETTINGS, job_memory among them) with routines and base_survey on, the watch server
// on for part 5, `job_resume_seconds` 10, the modes of his profile, an empty memory. The bot stands outside the house door, the player
// beside it. The fake model answers the plan prompt of the routine (its first line `You plan the steps of a Minecraft bot for a standing
// task ...`): the first time without the walk step (the model of R-5), every later time with `!goToCoordinates(x, y, z, 2)` first. The
// console commands use the names of 26.1.
//   1. Typed `!rememberRoutine("chest run", "go to the chest at (x, y, z), take 4 wheat, then harvest the wheat farm and store the
//      wheat, every minute")`: the remember line of 3.6.
//   2. Within 60 s the first round plans: 2a the plan prompt carries the rule `Every place the player names and every coordinate (x, y,
//      z) in the task is a step of its own before the work there: !goToRememberedPlace("name") for a saved place, !goToCoordinates(x,
//      y, z, 2) for a coordinate. Keep the player's numbers.`; 2b the plan that lost the coordinate is refused: `I could not plan the
//      routine "chest run": the plan lost the place (x, y, z) you named. Say it differently.` and no plan line, no round.
//   3. Typed `!doRoutine("chest run")`: the model plans again, with the walk step: 3a `My plan for "chest run": !goToCoordinates(x, y,
//      z, 2), !fetchItem("wheat", 4), !harvest("wheat_farm"), !putInChest("wheat", 64). I start.` and `I start the routine "chest run",
//      round 1.`; 3b the failed step is skipped with the quiet line `Step 3 of "chest run" failed: <text>; I go on.` and the round is done
//      (`Round 1 of "chest run" is done.`) within 150 s; 3c the world: the chest gave 4 wheat during the round (server, sampled) and
//      the wheat lies in a chest again at the end (the bag has none), the farm's ripe row stands (the wrong place harvested nothing).
//   4. Typed `!doRoutine("chest run")` once more: `I start the routine "chest run", round 2.`, `Round 2 of "chest run" is done.`, and the
//      routine in routines.json has `runs` 2 (the counter kept in the store).
//   5. The supervisor runs `!followPlayer("w_player", 3)` (a long skill: `started.`) for 75 s while the routine is due again (every
//      minute, the resume wait 10 s), then `!stop`: no round starts under the run, and one starts within 40 s after the stop.
// Throughout: the process lives, no request reached a real model, the only requests of the chat model are the two plan prompts.
import crypto from 'node:crypto';
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, readWorldFile,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, cropAges, chestItems, inventoryOf, itemsText, buildChest } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER, freePort } from './journey.js';
import { Supervisor } from './supervisor.js';

const NAME = 'w_places';
const SUPERVISOR = 'Opus';
const ROUTINE = 'chest run';
const PLAN_PROMPT = /^You plan the steps of a Minecraft bot for a standing task the player described in his words\./;
const PLACES_RULE = 'Every place the player names and every coordinate (x, y, z) in the task is a step of its own before the work there: !goToRememberedPlace("name") for a saved place, !goToCoordinates(x, y, z, 2) for a coordinate. Keep the player\'s numbers.';
const PLAN_LINE = /^My plan for "chest run": (.*)\. I start\.$/;
const START = (n) => new RegExp(`^I start the routine "chest run", round ${n}\\.$`);
const DONE = (n) => new RegExp(`^Round ${n} of "chest run" is done\\.$`);
const ANY_START = /^I start the routine "chest run", round (\d+)\.$/;
const SKIPPED = /^Step (\d) of "chest run" failed: (.+); I go on\.$/;
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const cellText = (p) => `(${p.x}, ${p.y}, ${p.z})`;

const linesOf = (s, t, re) => saidLines(s, t).filter((l) => re.test(l));
const firstLine = (s, t, re) => linesOf(s, t, re)[0] ?? null;
const waitLine = (s, t, re, ms) => waitFor(() => firstLine(s, t, re), { ms, every: 250 });

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const h = b.house;
        const chest = { x: h.door.x + 6, y: g + 1, z: h.door.z - 10 };
        await buildChest(chest, { wheat: 8 }, { facing: 'north' });
        const TEXT = `go to the chest at ${cellText(chest)}, take 4 wheat, then harvest the wheat farm and store the wheat, every minute`;
        const REMEMBERED = new RegExp(`^I remember the routine "chest run": ${TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. I do it when I have nothing else to do, every (minute|1 minutes?)\\.$`);
        const LOST = `I could not plan the routine "chest run": the plan lost the place ${cellText(chest)} you named. Say it differently.`;
        const WALK = `!goToCoordinates(${chest.x}, ${chest.y}, ${chest.z}, 2)`;
        const REST = ['!fetchItem("wheat", 4)', '!harvest("wheat_farm")', '!putInChest("wheat", 64)'];
        const ripeCells = b.farm.crops.filter((c) => c.spec.age === 7).map((c) => c.above);
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the environment of the agent, which runs in this process; never printed
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server', String(port));
        const sup = new Supervisor({ url: `http://127.0.0.1:${port}/mcp`, token: TOKEN, name: SUPERVISOR });
        let agent = null, orders = null, s = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: h.outsideDoor, botYaw: 0, playerAt: { x: h.outsideDoor.x + 2, y: g + 1, z: h.outsideDoor.z }, kit: [],
                settings: SUPERVISION_SETTINGS({ routines: true, base_survey: true, job_resume_seconds: 10, watch_server: true, watch_port: port, supervisor_name: SUPERVISOR }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            // the fake model answers the plan prompt: the first time without the walk step (R-5), then with it; every prompt is kept
            const plans = [];
            const chat = s.chat;
            const send = chat.sendRequest;
            chat.sendRequest = async function planned(turns, systemMessage) {
                const prompt = String(systemMessage ?? '');
                if (!PLAN_PROMPT.test(prompt)) return send.call(this, turns, systemMessage);
                const steps = plans.length === 0 ? REST : [WALK, ...REST];
                plans.push({ prompt, t: Date.now(), steps });
                chat.requests.push({ kind: 'chat', prompt, turns: JSON.parse(JSON.stringify(turns ?? [])), routed: true });
                console.log(`PLAN prompt ${plans.length} (${prompt.length} chars) -> ${JSON.stringify(steps)}`);
                return steps.join('\n');
            };
            const routineFile = () => {
                const json = readWorldFile(agent, 'routines.json').json;
                const list = Array.isArray(json?.routines) ? json.routines : (json?.routines && typeof json.routines === 'object' ? Object.values(json.routines) : []);
                return list.find((x) => x?.name === ROUTINE) ?? null;
            };
            const requests0 = chat.requests.length;
            const chest0 = (await chestItems(chest))?.wheat ?? 0;
            const ages0 = await cropAges(ripeCells);
            note(`0: the chest at ${cellText(chest)} holds ${chest0} wheat; the farm's ripe row ${JSON.stringify(ages0)}; the bot at ${fmt(await entityPos(NAME))}`);
            check(chest0 === 8 && ages0.every((a) => a === 7), 'precondition: the chest holds 8 wheat and the farm\'s ripe row is ripe (server)', `${chest0} wheat, ages ${JSON.stringify(ages0)}`);

            // ====================================================== 1. the routine is remembered
            const t1 = Date.now();
            const remembered = await orders.order(`!rememberRoutine("${ROUTINE}", "${TEXT}")`, 30000);
            note(`1: !rememberRoutine answered ${JSON.stringify(remembered)}`);
            check(REMEMBERED.test(remembered), '1: `I remember the routine "chest run": <the text>. I do it when I have nothing else to do, every minute.` (SPEC 3.6 of v0.1.4.15)', JSON.stringify(remembered));

            // ====================================================== 2. the first plan loses the coordinate: refused
            const planned1 = await waitFor(() => plans.length >= 1, { ms: 60000, every: 250 });
            const lost = planned1.ok ? await waitLine(s, t1, new RegExp(`^${LOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), 20000) : { ok: false };
            await sleep(3000);
            const planLines2 = linesOf(s, t1, PLAN_LINE);
            const starts2 = linesOf(s, t1, ANY_START);
            const routine2 = routineFile();
            note(`2: ${planned1.ok ? `the first plan prompt came ${(planned1.ms / 1000).toFixed(0)} s after the remember` : 'NO plan prompt within 60 s'}; the prompt ${plans[0] ? (plans[0].prompt.includes(PLACES_RULE) ? 'has the places rule' : 'has NO places rule') : '-'}; the refusal ${lost.ok ? 'was said' : 'was NOT said'}; plan lines ${JSON.stringify(planLines2)}; starts ${JSON.stringify(starts2)}; the routine in the store ${JSON.stringify(routine2 ? { state: routine2.state, steps: routine2.steps?.map((x) => x.command), runs: routine2.runs, rounds: routine2.rounds } : null)}; the bot said ${JSON.stringify(saidLines(s, t1).slice(0, 8))}`);
            check(planned1.ok && plans[0].prompt.includes(PLACES_RULE), '2a: the plan prompt carries the rule for places and coordinates word for word (F3)', JSON.stringify(plans[0]?.prompt.split('\n').filter((l) => /place|coordinate/.test(l)).slice(0, 3) ?? null));
            check(lost.ok && planLines2.length === 0 && starts2.length === 0, `2b: a plan that lost the coordinate is refused: \`${LOST}\`, no plan line, no round (F3: the check refuses a plan that lost a place)`, `refusal ${lost.ok}, plan lines ${planLines2.length}, starts ${starts2.length}`);

            // ====================================================== 3. !doRoutine: the plan with the walk step, the skipped step, the round done
            const t3 = Date.now();
            const chestMin = { wheat: chest0 };
            const sampler = (async () => {
                while (Date.now() - t3 < 150000 && !firstLine(s, t3, DONE(1))) {
                    const n = (await chestItems(chest))?.wheat ?? 0;
                    chestMin.wheat = Math.min(chestMin.wheat, n);
                    await sleep(500);
                }
            })();
            const doNow = await orders.order(`!doRoutine("${ROUTINE}")`, 60000);
            const planLine3 = await waitLine(s, t3, PLAN_LINE, 30000);
            const start1 = await waitLine(s, t3, START(1), 30000);
            const done1 = await waitLine(s, t3, DONE(1), 150000);
            await sampler;
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            const skipped = firstLine(s, t3, SKIPPED);
            const inv3 = await inventoryOf(NAME);
            const chest3 = (await chestItems(chest))?.wheat ?? 0;
            const ages3 = await cropAges(ripeCells);
            const m = planLine3.value ? PLAN_LINE.exec(planLine3.value) : null;
            note(`3: !doRoutine answered ${JSON.stringify(doNow)}; ${plans.length} plan prompts; the plan line ${JSON.stringify(planLine3.value)}; the start ${JSON.stringify(start1.value)}; the skipped step ${JSON.stringify(skipped)}; the done line ${done1.ok ? `after ${(done1.ms / 1000).toFixed(0)} s` : 'NOT within 150 s'}; the chest went down to ${chestMin.wheat} wheat and holds ${chest3} now; the bag ${itemsText(inv3)}; the ripe row ${JSON.stringify(ages3)}; the bot said ${JSON.stringify(saidLines(s, t3).slice(0, 14))}`);
            check(plans.length === 2 && Boolean(m) && m[1].startsWith(WALK), `3a: the second plan is accepted and the plan line names the walk step first: \`My plan for "chest run": ${WALK}, ...\``, JSON.stringify(planLine3.value ?? saidLines(s, t3).slice(0, 3)));
            check(start1.ok, '3a: `I start the routine "chest run", round 1.`', JSON.stringify(start1.value));
            check(skipped !== null && Number(SKIPPED.exec(skipped)[1]) === 3, '3b: the failed step (`!harvest("wheat_farm")`, no such farm) is skipped with the quiet line `Step 3 of "chest run" failed: <text>; I go on.` (F3)', JSON.stringify(skipped ?? saidLines(s, t3).filter((l) => /fail|pause|stop/i.test(l)).slice(0, 3)));
            check(done1.ok, '3b: the round goes on and is done: `Round 1 of "chest run" is done.` within 150 s (F3: failed only when every step failed)', done1.ok ? `${(done1.ms / 1000).toFixed(0)} s` : JSON.stringify(saidLines(s, t3).slice(0, 6)));
            check(chestMin.wheat <= chest0 - 4 && (inv3.wheat ?? 0) === 0 && chest3 >= chest0 - 1, '3c: the walk and the fetch ran at the chest named by its coordinates (the chest gave 4 wheat, server) and the wheat was stored again (none in the bag)', `chest ${chest0} -> ${chestMin.wheat} -> ${chest3}, bag wheat ${inv3.wheat ?? 0}`);
            check(ages3.every((a) => a === 7), '3c: the wrong place harvested nothing: the farm\'s ripe row still stands (server)', JSON.stringify(ages3));

            // ====================================================== 4. a second round: the counter grows
            const t4 = Date.now();
            const doAgain = await orders.order(`!doRoutine("${ROUTINE}")`, 60000);
            const start2 = await waitLine(s, t4, START(2), 30000);
            const done2 = await waitLine(s, t4, DONE(2), 150000);
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            const routine4 = routineFile();
            note(`4: !doRoutine answered ${JSON.stringify(doAgain)}; the start ${JSON.stringify(start2.value)}; the done line ${done2.ok ? `after ${(done2.ms / 1000).toFixed(0)} s` : 'NOT within 150 s'}; the routine in the store ${JSON.stringify(routine4 ? { state: routine4.state, runs: routine4.runs, rounds: routine4.rounds, lastRound: routine4.lastRound } : null)}; the bot said ${JSON.stringify(saidLines(s, t4).slice(0, 10))}`);
            check(start2.ok && done2.ok, '4: `I start the routine "chest run", round 2.` and `Round 2 of "chest run" is done.` (the round number counts on)', `start ${start2.ok}, done ${done2.ok}`);
            check(routine4?.runs === 2, '4: routines.json keeps the counter: the routine has `runs` 2 after two rounds (F3)', JSON.stringify(routine4 ? { runs: routine4.runs, rounds: routine4.rounds } : null));

            // ====================================================== 5. no round under the supervisor's run
            const t5 = Date.now();
            const follow = await sup.run([`!followPlayer("${PLAYER}", 3)`]);
            note(`5: run [!followPlayer] answered after ${follow.ms} ms: ${JSON.stringify(follow.text.slice(0, 200))}`);
            check(follow.ok && follow.text.includes('started.'), '5: precondition: the supervisor\'s long skill counts as started', JSON.stringify(follow.text.slice(0, 200)));
            await sleep(75000);
            const startsUnder = linesOf(s, t5, ANY_START);
            const stop = await sup.run(['!stop']);
            const tStop = Date.now();
            note(`5: 75 s under the run the bot said ${JSON.stringify(saidLines(s, t5).slice(0, 8))}; !stop through run answered ${JSON.stringify(stop.text.slice(0, 120))}`);
            check(startsUnder.length === 0, '5: no round of the routine starts while the supervisor\'s run works (F3: a round waits while the queue has work or a command runs)', JSON.stringify(startsUnder));
            const start3 = await waitLine(s, tStop, ANY_START, 40000);
            note(`5: after the stop a round ${start3.ok ? `started after ${(start3.ms / 1000).toFixed(0)} s: ${JSON.stringify(start3.value)}` : 'did NOT start within 40 s'}`);
            check(start3.ok, '5: the routine was due and held back: a round starts within 40 s after the supervisor\'s stop', JSON.stringify(start3.value ?? saidLines(s, tStop).slice(0, 4)));

            const requests = chat.requests.slice(requests0);
            const others = requests.filter((q) => !PLAN_PROMPT.test(String(q.prompt ?? '')));
            check(others.length === 0, 'the only requests of the chat model are the plan prompts (zero model calls in a round)', `${requests.length} requests, ${others.length} other: ${JSON.stringify(others.slice(0, 2).map((q) => String(q.prompt ?? '').slice(0, 80)))}`);
            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            check(!inLogs, 'the token is in no console line of the agent', inLogs ? 'HAS it' : 'no');
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (agent?.actions?.executing) await orders?.order('!stop', 10000).catch(() => {});
            if (orders) await orders.order(`!forgetRoutine("${ROUTINE}")`, 10000).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
