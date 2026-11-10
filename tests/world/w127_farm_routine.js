// W127 the farm routine (v0.1.4.15 "The base survey and Routines", tester T3; PLAN.md section 5, SPEC sections 3 and 7.2): a
// paragraph in the owner's words becomes a standing job the bot works when it has nothing else to do, planned once with the model,
// checked and run by code, round after round until the owner says stop. Against a857593 (v0.1.4.14 plus the spec) the first command
// answers `Command '!rememberRoutine' does not exist.` and the scenario fails there; on the release every check passes.
//
// The base world (base_world.js) with the fenced wheat farm of the base ripe in two of its rows (14 ripe wheat; the rest young, so
// that a round ends within the 70 s of 7.2) and a chest by the house door; the owner's switches (SUPERVISION_SETTINGS, job_memory
// among them), the two switches of this release on, `job_resume_seconds` 10, the modes of his profile, an empty memory. The bot
// stands outside the house door, the player beside it. The owner saves the farm as "farm" by hand (typed !setArea: the base's
// farm is no saved area; the plan names the farm by that name). The fake model answers the plan prompt of the routine (purpose
// `plan`, the first line `You plan the steps of a Minecraft bot for a standing task the player described in his words.`, SPEC 3.2)
// with `!harvest("farm")`, `!plant("wheat_seeds", "farm")`, `!putInChest("wheat", 64)`: the real !plant takes (seed, area), so the
// plan gives it both, as a model that reads the command docs would (SPEC 3.2 writes `!plant(farm)`; the lead is told). Between the
// rounds the control ripens the two rows again (the sun of a played world: the random tick speed is 0 here). The console commands
// use the names of 26.1.
//   1. Typed `!rememberRoutine("the farm", "harvest the wheat farm and plant it again, then put the wheat in the chest by the door,
//      every minute")`: `I remember the routine "the farm": <the text>. I do it when I have nothing else to do, every minute.`
//      (SPEC 3.6; the tail is read for its words).
//   2. Within 70 s (the resume wait of 10 s and the first round): one plan prompt to the fake model, the plan line `My plan for
//      "the farm": !harvest("farm"), !plant(...), !putInChest("wheat", 64). I start.` with !harvest, !plant (or !farmCycle) and
//      !putInChest in it, `I start the routine "the farm", round 1.` and `Round 1 of "the farm" is done.`; the 14 ripe cells hold
//      young wheat again (server), the wheat of the harvest lies in a chest (the farm chest, the chest by the door or the house
//      chest: `!putInChest` takes the nearest, noted which) and none in the bag (server).
//   3. A second round within the next 90 s (`I start the routine "the farm", round 2.`, then its done line) with no new plan line
//      and no second plan prompt (zero model calls in a round, SPEC rule 30); typed `!routines` lists it with 2 rounds
//      (`My routines: the farm (every minute, 2 rounds, last HH:MM).`).
//   4. A typed `!stop` during the third round ends the round (no action runs within 5 s, no done line of round 3) and `!routines`
//      still lists the routine, not paused.
//   5. `!forgetRoutine("the farm")`: `I forgot the routine "the farm".`; no fourth round within 120 s; `!routines`: `I have no
//      routines.`
// Throughout: the process lives, no request reached a real model, the only request of the chat model from the remember to the
// forget is the plan prompt.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, cropAges, chestItems, inventoryOf, itemsText, buildChest, stableInventory } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS } from './journey.js';

const NAME = 'w_routine';
const ROUTINE = 'the farm';
const TEXT = 'harvest the wheat farm and plant it again, then put the wheat in the chest by the door, every minute';
const STEPS = ['!harvest("farm")', '!plant("wheat_seeds", "farm")', '!putInChest("wheat", 64)'];
const PLAN_PROMPT = /^You plan the steps of a Minecraft bot for a standing task the player described in his words\./;
const REMEMBERED = new RegExp(`^I remember the routine "${ROUTINE}": ${TEXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. I do it when I have nothing else to do, every (minute|1 minutes?)\\.$`);
const PLAN_LINE = /^My plan for "the farm": (.*)\. I start\.$/;
const START = (n) => new RegExp(`^I start the routine "the farm", round ${n}\\.$`);
const DONE = (n) => new RegExp(`^Round ${n} of "the farm" is done\\.$`);
const ANY_START = /^I start the routine "the farm", round (\d+)\.$/;
const LISTED = /^My routines: the farm \(every [^,()]+, (\d+) rounds?, last \d\d:\d\d\)\.$/;
const NO_ROUTINES = /^I have no routines\.$/;
const FORGOT = /^I forgot the routine "the farm"\.$/;
const HARVESTED = /I harvested (\d+) wheat and planted (\d+) again\./;
const NOT_EXIST = /^Command '!rememberRoutine' does not exist\.$/;
const P = (p) => `${p.x} ${p.y} ${p.z}`;

// The lines the bot said since t (its chat and the behaviour log) that match re, in order.
const linesOf = (s, t, re) => saidLines(s, t).filter((l) => re.test(l));
const firstLine = (s, t, re) => linesOf(s, t, re)[0] ?? null;

// Waits for a line of the bot since t that matches re; resolves with { ok, value, ms }.
const waitLine = (s, t, re, ms) => waitFor(() => firstLine(s, t, re), { ms, every: 250 });

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        // two rows ripe (j 2 and 5), the rest young: a round that ends within the 70 s of 7.2
        const b = basePlan(r, { crops: (i, j) => ({ crop: 'wheat', age: j === 2 || j === 5 ? 7 : 3 }) });
        await buildBase(b);
        const g = b.g;
        const h = b.house;
        const doorChest = { x: h.door.x + 2, y: g + 1, z: h.door.z - 1 }; // outside the north wall, beside the door
        await buildChest(doorChest, {}, { facing: 'north' });
        const ripeCells = b.farm.crops.filter((c) => c.spec.age === 7).map((c) => c.above);
        const youngCells = b.farm.crops.filter((c) => c.spec.age !== 7).map((c) => c.above);
        const chests = { farm: b.farm.chest, door: doorChest, house: h.chest };
        const wheatInChests = async () => {
            const out = {};
            for (const [k, p] of Object.entries(chests)) out[k] = (await chestItems(p))?.wheat ?? 0;
            return out;
        };
        const ripen = async (label) => {
            await commands(ripeCells.map((c) => `setblock ${P(c)} minecraft:wheat[age=7]`));
            const ages = await cropAges(ripeCells);
            note(`${label}: the control ripened the two rows again (the sun of a played world): ${ages.filter((a) => a === 7).length} of ${ripeCells.length} ripe`);
        };
        const fb = b.farm.box;
        let agent = null, orders = null, s = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: h.outsideDoor, botYaw: 0, playerAt: { x: h.outsideDoor.x + 2, y: g + 1, z: h.outsideDoor.z }, kit: [],
                settings: SUPERVISION_SETTINGS({ routines: true, base_survey: true, job_resume_seconds: 10 }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            // the fake model answers the plan prompt of the routine (and nothing else answers it); every prompt is kept
            const plans = [];
            const chat = s.chat;
            const send = chat.sendRequest;
            chat.sendRequest = async function planned(turns, systemMessage) {
                const prompt = String(systemMessage ?? '');
                if (!PLAN_PROMPT.test(prompt)) return send.call(this, turns, systemMessage);
                plans.push({ prompt, t: Date.now() });
                chat.requests.push({ kind: 'chat', prompt, turns: JSON.parse(JSON.stringify(turns ?? [])), routed: true });
                console.log(`PLAN prompt ${plans.length} (${prompt.length} chars) -> ${JSON.stringify(STEPS)}`);
                return STEPS.join('\n');
            };
            const ages0 = await cropAges(ripeCells);
            const chests0 = await wheatInChests();
            check(ages0.every((a) => a === 7), 'precondition: the two rows of the farm are ripe (14 wheat, server)', JSON.stringify(ages0));
            const saved = await orders.order(`!setArea("farm", "farm", ${fb.min.x}, ${fb.min.y}, ${fb.min.z}, ${fb.max.x}, ${fb.max.y}, ${fb.max.z})`, 30000);
            note(`0: the owner saves the farm: !setArea("farm", "farm", ...) answered ${JSON.stringify(saved.slice(0, 200))}; the chests hold wheat ${JSON.stringify(chests0)}; the bot at ${fmt(await entityPos(NAME))} carries ${itemsText(await inventoryOf(NAME))}`);
            check(/^Area "farm" \(farm\) saved:/.test(saved), 'precondition: the base\'s farm is saved as the area "farm" (the owner\'s hand)', JSON.stringify(saved.slice(0, 120)));

            // ====================================================== 1. the routine is remembered
            const requests0 = chat.requests.length;
            const t1 = Date.now();
            const remembered = await orders.order(`!rememberRoutine("${ROUTINE}", "${TEXT}")`, 30000);
            note(`1: !rememberRoutine answered ${JSON.stringify(remembered)}`);
            check(REMEMBERED.test(remembered), '1: `I remember the routine "the farm": <the text>. I do it when I have nothing else to do, every minute.` (SPEC 3.6)', JSON.stringify(remembered));
            if (NOT_EXIST.test(remembered)) {
                note('the command does not exist on this code (v0.1.4.14): the rounds of parts 2 to 5 cannot run and are not waited for');
                check(false, '2 to 5: the routine runs its rounds (not run: no !rememberRoutine on this code)', JSON.stringify(remembered));
                return;
            }

            // ====================================================== 2. the first round within 70 s
            const done1 = await waitLine(s, t1, DONE(1), 180000);
            const secs1 = ((done1.ok ? done1.ms : Date.now() - t1) / 1000).toFixed(0);
            const planLine = firstLine(s, t1, PLAN_LINE);
            const start1 = firstLine(s, t1, START(1));
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            const ages1 = await cropAges(ripeCells);
            const young1 = await cropAges(youngCells);
            const chests1 = await wheatInChests();
            const inv1 = await stableInventory(NAME);
            const harvestLine = firstLine(s, t1, HARVESTED);
            const got = harvestLine ? Number(HARVESTED.exec(harvestLine)[1]) : null;
            const gained = Object.keys(chests).reduce((n, k) => n + (chests1[k] - chests0[k]), 0);
            const where = Object.keys(chests).filter((k) => chests1[k] > chests0[k]);
            note(`2: ${secs1} s after the remember: ${plans.length} plan prompt(s); the plan line ${JSON.stringify(planLine)}; the start ${JSON.stringify(start1)}; the done line ${JSON.stringify(done1.value)}; the bot said ${JSON.stringify(saidLines(s, t1).slice(0, 14))}`);
            note(`2: the ripe cells ${JSON.stringify(ages1)}; the young rows ${JSON.stringify([...new Set(young1)])}; wheat in the chests ${JSON.stringify(chests0)} -> ${JSON.stringify(chests1)} (${gained} more, in ${JSON.stringify(where)}); the bag ${itemsText(inv1.items)}; the bot at ${fmt(await entityPos(NAME))}`);
            check(plans.length === 1 && PLAN_PROMPT.test(plans[0]?.prompt ?? ''), '2: the model was asked once for the plan, with the prompt of SPEC 3.2 (its first line fixed)', `${plans.length} plan prompts`);
            const m = planLine ? PLAN_LINE.exec(planLine) : null;
            check(Boolean(m) && /!harvest\(/.test(m[1]) && (/!plant\(/.test(m[1]) || /!farmCycle\(/.test(m[1])) && /!putInChest\(/.test(m[1]), '2: the plan line `My plan for "the farm": !harvest("farm"), !plant(...), !putInChest("wheat", 64). I start.` names the three steps', JSON.stringify(planLine));
            check(Boolean(start1), '2: `I start the routine "the farm", round 1.` was said', JSON.stringify(start1));
            check(done1.ok && done1.ms <= 70000, '2: `Round 1 of "the farm" is done.` within 70 s of the remember (the resume wait of 10 s and the first round)', done1.ok ? `${secs1} s` : `not within 180 s; said ${JSON.stringify(saidLines(s, t1).slice(0, 6))}`);
            check(ages1.every((a) => a !== null && a < 7), '2: the ripe cells of the farm hold young wheat again (replanted, server)', JSON.stringify(ages1));
            check(gained >= 10 && (got === null || gained >= got - 2), '2: the wheat of the harvest lies in a chest (server)', `${gained} wheat more in ${JSON.stringify(where)} (harvested ${got ?? '?'})`);
            check((inv1.items.wheat ?? 0) === 0, '2: none of the wheat stays in the bag (server)', itemsText(inv1.items));

            // ====================================================== 3. the second round, no new plan
            await ripen('3');
            const t2 = Date.now();
            const start2 = await waitLine(s, t2, START(2), 90000);
            const done2 = start2.ok ? await waitLine(s, t2, DONE(2), 150000) : { ok: false, ms: 0 };
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            const planLines = linesOf(s, t1, PLAN_LINE);
            note(`3: round 2 ${start2.ok ? `started ${(start2.ms / 1000).toFixed(0)} s after round 1 was done` : 'did NOT start within 90 s'}${done2.ok ? ` and was done after ${(done2.ms / 1000).toFixed(0)} s` : ', not done within 150 s'}; plan prompts ${plans.length}, plan lines ${planLines.length}; the bot said ${JSON.stringify(saidLines(s, t2).slice(0, 12))}`);
            check(start2.ok && done2.ok, '3: a second round runs within the next 90 s (`I start the routine "the farm", round 2.`) and ends (`Round 2 of "the farm" is done.`)', `start ${start2.ok ? (start2.ms / 1000).toFixed(0) + ' s' : 'no'}, done ${done2.ok ? 'yes' : 'no'}`);
            check(plans.length === 1 && planLines.length === 1, '3: no new plan: one plan prompt and one plan line in all (the saved plan is kept, zero model calls in a round)', `${plans.length} prompts, ${planLines.length} lines`);
            const list2 = await orders.order('!routines', 20000);
            const lm = LISTED.exec(list2);
            note(`3: !routines answered ${JSON.stringify(list2)}`);
            check(Boolean(lm) && Number(lm[1]) === 2, '3: `!routines` lists the routine with 2 rounds: `My routines: the farm (every minute, 2 rounds, last HH:MM).`', JSON.stringify(list2));

            // ====================================================== 4. a stop during the third round
            await ripen('4');
            const t3 = Date.now();
            const start3 = await waitLine(s, t3, START(3), 150000);
            const running = await waitFor(() => agent.actions.executing, { ms: 20000, every: 100 });
            const label = agent.actions.currentActionLabel || '-';
            const tStop = Date.now();
            const stop = await orders.order('!stop', 20000);
            const idle = await waitFor(() => !agent.actions.executing, { ms: 5000, every: 100 });
            await sleep(10000);
            const done3 = firstLine(s, t3, DONE(3));
            const job = agent.job?.get?.() ?? null;
            const list3 = await orders.order('!routines', 20000);
            note(`4: round 3 ${start3.ok ? `started ${(start3.ms / 1000).toFixed(0)} s after round 2` : 'did NOT start within 150 s'}; a step ran: ${running.ok} (${label}); !stop answered ${JSON.stringify(stop.slice(0, 120))}; idle ${idle.ok ? `after ${idle.ms} ms` : 'NOT within 5 s'}; the job ${JSON.stringify(job ? { kind: job.kind, state: job.state, routine: job.routine, round: job.round } : null)}; done line of round 3 ${JSON.stringify(done3)}; !routines ${JSON.stringify(list3)}`);
            check(start3.ok && running.ok, '4: precondition: a third round started and a step of it was running when the owner typed !stop', `start ${start3.ok}, running ${running.ok} (${label})`);
            check(idle.ok && done3 === null, '4: !stop ends the round: nothing runs within 5 s and round 3 is not reported done', `idle ${idle.ok}, done line ${JSON.stringify(done3)}`);
            check(LISTED.test(list3) && !/paused/.test(list3), '4: after the stop `!routines` still lists the routine, active (not paused)', JSON.stringify(list3));

            // ====================================================== 5. forgotten: no fourth round
            const forgot = await orders.order(`!forgetRoutine("${ROUTINE}")`, 20000);
            const t5 = Date.now();
            note(`5: !forgetRoutine("the farm") answered ${JSON.stringify(forgot)}; waiting 120 s for a round that must not come`);
            check(FORGOT.test(forgot), '5: `I forgot the routine "the farm".`', JSON.stringify(forgot));
            await sleep(120000);
            const starts5 = linesOf(s, t5, ANY_START);
            const list5 = await orders.order('!routines', 20000);
            note(`5: in the 120 s after the forget the bot said ${JSON.stringify(saidLines(s, t5).slice(0, 8))}; !routines ${JSON.stringify(list5)}`);
            check(starts5.length === 0, '5: no fourth round within 120 s of the forget', JSON.stringify(starts5));
            check(NO_ROUTINES.test(list5), '5: `!routines` answers `I have no routines.`', JSON.stringify(list5));

            const requests = chat.requests.slice(requests0);
            const others = requests.filter((q) => !PLAN_PROMPT.test(String(q.prompt ?? '')));
            check(others.length === 0, 'the only request of the chat model from the remember to the forget is the plan prompt (SPEC rule 30: zero model calls in a round)', `${requests.length} requests, ${others.length} other: ${JSON.stringify(others.slice(0, 2).map((q) => String(q.prompt ?? '').slice(0, 80)))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (agent?.actions?.executing) await orders?.order('!stop', 10000).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
