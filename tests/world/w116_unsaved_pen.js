// W116 the unsaved pen (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 3.14, SPEC section 1 and 4.6 Q8): an
// enclosure the scan calls a pen (a fence with animals inside) is protected before anyone saves it: the path search
// never opens its gate, the bot says so, and after "open the pen" it passes and closes the gate behind it. Today
// (v0.1.4.12) the bot opens the gate of an unsaved pen to follow the owner (the two bots opened the pens together on
// 2026-10-04): the scenario fails at the check that the gate stayed closed.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists): the pen with
// 6 chickens (its chicken and 5 more; the cow is taken out so the count has one kind), not saved. The owner's switches
// of v0.1.4.12 and of this release (SUPERVISION_SETTINGS; area_sense is on since v0.1.4.11), the modes of his profile,
// an empty memory. The bot stands 3 blocks north of the gate; it is never moved by the control.
//   1. The player walks through the gate into the pen (the control opens and closes the gate for him) to its far side
//      and says "follow me" (!followPlayer("w_player", 3)). Within 60 s (sampled every 500 ms): the gate is closed all
//      the time and at the end (server), no chicken is outside the fence (6 inside), the bot never stood inside the
//      pen, and it said `That is a pen with 6 chickens; I do not open its gate. Say "open the pen" if you mean it.`
//   2. "open the pen" (the fake model answers !allowChanges("pen"), the rule of a saved pen; see the report) and "follow
//      me" again: within 60 s the bot is inside the pen, and the gate is closed within 10 s after it passed.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, startTrace, printTrace } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen, setOpen } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, PLAYER, saidLines, SUPERVISION_SETTINGS, walkPlayer, line, countEntities, penChickenSelector } from './journey.js';

const NAME = 'w_unsavedpen';
const CHICKENS = 6;
const PEN_TEXT = `That is a pen with ${CHICKENS} chickens; I do not open its gate. Say "open the pen" if you mean it.`;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const g = b.g;
        const pen = b.pen;
        const gate = pen.gate;
        const extra = [];
        for (let k = 0; k < CHICKENS - 1; k++) {
            const p = { x: pen.inner.min.x + 1 + k, y: g + 1, z: pen.inner.max.z - 1 };
            extra.push(`summon minecraft:chicken ${p.x + 0.5} ${p.y} ${p.z + 0.5} {PersistenceRequired:1b,Tags:["${pen.tag}","${pen.tag}_extra"]}`);
        }
        await commands([`kill @e[tag=${pen.tag}_cow]`, ...extra]);
        const chickens = () => countEntities(penChickenSelector(b));
        // the lead, round 2 (DECISIONS R2-2): the middle of the pen, so that following the player needs the gate; from the
        // far fence the bot was within 3 blocks outside the fence and never had to go in
        const farInside = { x: gate.x, y: g + 1, z: pen.inner.min.z + 3 };
        const justInside = { x: gate.x, y: g + 1, z: gate.z + 1 };
        const outsideGate = { x: gate.x, y: g + 1, z: gate.z - 1 };
        // the player walks through the gate (the control opens and closes it for him), to a cell inside
        const playerThroughGate = async (to) => {
            await walkPlayer(line(await entityPos(PLAYER).then((p) => ({ x: Math.floor(p.x), y: g + 1, z: Math.floor(p.z) })), outsideGate), 250);
            await setOpen(gate, true, 'oak_fence_gate');
            await sleep(200);
            await walkPlayer([gate, justInside], 200);
            await setOpen(gate, false, 'oak_fence_gate');
            await sleep(200);
            return walkPlayer(line(justInside, to), 250);
        };
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, { botAt: pen.outsideGate, playerAt: { x: gate.x - 2, y: g + 1, z: gate.z - 3 }, settings: SUPERVISION_SETTINGS() });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            s.route(/open the pen/, '!allowChanges("pen")');
            const n0 = await chickens();
            check(n0 === CHICKENS && (await isOpen(gate, 'oak_fence_gate')) === false, `precondition: ${CHICKENS} chickens in the pen, the gate closed, no area saved`, `${n0} chickens, gate ${await isOpen(gate, 'oak_fence_gate') ? 'open' : 'closed'}`);
            const sample = () => startTrace(async () => ({ gate: await isOpen(gate, 'oak_fence_gate'), bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);

            // ---------------------------------------------------------- 1. the player walks through, "follow me"
            await playerThroughGate(farInside);
            const p1 = await entityPos(PLAYER);
            note(`1: the player walked through the gate to ${fmt(p1)} (inside the pen: ${inBox(p1, pen.inner)}); the gate is ${(await isOpen(gate, 'oak_fence_gate')) ? 'open' : 'closed'}; the bot at ${fmt(await entityPos(NAME))}`);
            const t1 = Date.now();
            const trace1 = sample();
            const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 3)`, 5000);
            note(`1: !followPlayer answered ${JSON.stringify(follow.reply.slice(0, 200))}`);
            await sleep(Math.max(0, 60000 - (Date.now() - t1)));
            const rows1 = await trace1.stop();
            printTrace('1: follow me into the pen', rows1, { gate: (x) => (x.gate ? 'open' : 'closed'), bot: (x) => fmt(x.bot), inPen: (x) => (inBox(x.bot, pen.inner) ? 'yes' : 'no'), action: (x) => x.action }, 40);
            const opened = rows1.filter((x) => x.gate === true);
            const entered = rows1.filter((x) => inBox(x.bot, pen.inner));
            const n1 = await chickens();
            const said1 = saidLines(s, t1);
            note(`1: in 60 s the gate was open in ${opened.length} of ${rows1.length} samples, the bot inside the pen in ${entered.length}; ${n1} chickens inside; the bot at ${fmt(await entityPos(NAME))} said ${JSON.stringify(said1.slice(0, 8))}`);
            check(opened.length === 0 && (await isOpen(gate, 'oak_fence_gate')) === false, '1: the gate of the unsaved pen stayed closed for 60 s and is closed (server)', `${opened.length} open samples`);
            check(n1 === CHICKENS, `1: no chicken is outside the fence (${CHICKENS} inside)`, `${n1} inside`);
            check(entered.length === 0, '1: the bot never stood inside the pen (it walked round or waited)', entered.slice(0, 3).map((x) => fmt(x.bot)).join(' '));
            check(said1.some((l) => l === PEN_TEXT), `1: the bot said \`${PEN_TEXT}\``, JSON.stringify(said1.slice(0, 6)));

            // ---------------------------------------------------------- 2. "open the pen", "follow me"
            const t2 = Date.now();
            orders.say('open the pen');
            const asked = await waitFor(() => s.messages.some((m) => m.source === PLAYER && m.message === 'open the pen' && m.done), { ms: 20000, every: 200 });
            note(`2: "open the pen" ${asked.ok ? 'was handled' : 'was NOT handled within 20 s'}; the bot said ${JSON.stringify(saidLines(s, t2).slice(0, 4))}; the model was asked with ${JSON.stringify(s.chat.requests.slice(-1).map((q) => String(q.turns?.[q.turns.length - 1]?.content ?? '').slice(0, 80)))}`);
            await sleep(1000);
            const trace2 = sample();
            const tFollow = Date.now();
            const follow2 = await orders.orderInfo(`!followPlayer("${PLAYER}", 3)`, 5000);
            note(`2: !followPlayer answered ${JSON.stringify(follow2.reply.slice(0, 200))}`);
            const inPen = await waitFor(async () => { const a = await entityPos(NAME); return inBox(a, pen.inner) ? a : null; }, { ms: 60000, every: 500 });
            const tPass = Date.now();
            const shut = inPen.ok ? await waitFor(async () => (await isOpen(gate, 'oak_fence_gate')) === false, { ms: 10000, every: 250 }) : { ok: false, ms: 0 };
            await sleep(2000);
            const rows2 = await trace2.stop();
            printTrace('2: open the pen, follow me', rows2, { gate: (x) => (x.gate ? 'open' : 'closed'), bot: (x) => fmt(x.bot), inPen: (x) => (inBox(x.bot, pen.inner) ? 'yes' : 'no'), action: (x) => x.action }, 40);
            note(`2: the bot ${inPen.ok ? `is inside the pen after ${((tPass - tFollow) / 1000).toFixed(1)} s at ${fmt(inPen.value)}` : 'did NOT enter the pen within 60 s'}; the gate ${shut.ok ? `closed ${(shut.ms / 1000).toFixed(1)} s after` : 'NOT closed within 10 s after'}; ${await chickens()} chickens inside; the bot said ${JSON.stringify(saidLines(s, t2).slice(0, 8))}`);
            check(inPen.ok, '2: after "open the pen" and "follow me" the bot passes the gate into the pen within 60 s', fmt(await entityPos(NAME)));
            check(shut.ok, '2: the gate is closed within 10 s after the bot passed (server)', `${(await isOpen(gate, 'oak_fence_gate')) ? 'open' : 'closed'} now`);
            note(`2: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
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
