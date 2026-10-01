// W88 the ladders inside the path search (journey of v0.1.4.10 "Goals", tester T3; PLAN.md 2.2 and 2.6, CHANGELOG
// "The path search climbs and descends ladders itself"): the walks of W80, W82 and W75 again, with the ladder step of
// v0.1.4.9 (now the fallback) counted. The ladder step prints "I go down the ladder at ..." / "I climb up the ladder
// at ..."; the path search of v0.1.4.10 climbs by itself, so none of these lines may come from a follow or a walk.
// The route replay (!goToRememberedPlace, A5 of W80) keeps its own ladder lines: its window is left out of the count.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with job_memory on, the modes of his profile, an empty memory. The bot is never moved by the control.
//   A  part A of journey.js (W80): "this is home", "follow me" to the basement, the trapdoor closed behind the bot,
//      "remember the path here", "come here" from the house, "go to the basement" (the route replay).
//   B  W82: "come here" from the basement (the bot in the house), from the house (the bot in the basement, the trapdoor
//      closed by the player), from the mine room (two ladders, the second ending 2 blocks above the floor).
//   C  W75 in the owner variant: the bot in the house, "follow me"; the player opens the trapdoor, climbs down and
//      closes it over himself before the bot comes, and waits in the basement: the bot is there within 60 s; then the
//      player climbs up into the house: the bot is in the house within 60 s; !stop.
// Checks: every leg as in its journey; no fallback ladder line outside the route replay; every climb of the bot on a
// ladder is smooth (journey.js checkClimbs: no step back over 0.1 block, at most one stall over 1 s, under 0.8 s per
// block); the process lives; no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, tp, sleep, setTrapdoor } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, partFirstMinutes, spots, inBasement, PLAYER, GOALS_SETTINGS, ladderFallbackLines, climbSampler, checkClimbs,
    playerUpToHouse, walkPlayer, line, saidLines, journeyTrace, printJourney, waitBot,
} from './journey.js';

const NAME = 'w_ladnat';

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
        const s1 = b.shaft.column;
        let agent = null, orders = null, sampler = null, trace = null;
        try {
            const j = await startJourney(NAME, b, { botAt: { x: sp.houseMiddle.x - 1, y: g + 1, z: sp.houseMiddle.z + 1 }, playerAt: sp.besideTrapdoor, settings: GOALS_SETTINGS() });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            sampler = climbSampler(agent);
            const tStart = Date.now();

            // the route replay window: from the order !goToRememberedPlace to its answer (A5)
            const replay = [];
            const orderInfo = orders.orderInfo;
            orders.orderInfo = async (text, ms) => {
                const isReplay = /^!goToRememberedPlace/.test(text);
                const before = ladderFallbackLines(s).length;
                const info = await orderInfo(text, ms);
                if (isReplay) {
                    await sleep(1000);
                    replay.push({ from: before, to: ladderFallbackLines(s).length });
                }
                return info;
            };
            orders.order = async (text, ms) => (await orders.orderInfo(text, ms)).reply;

            // ---------------------------------------------------------- A
            const a = await partFirstMinutes({ ...j, b });
            note(`A ${a.ok ? 'passed' : 'FAILED'}; fallback lines so far ${ladderFallbackLines(s).length}, of them in the route replay ${replay.reduce((n, w) => n + w.to - w.from, 0)}`);

            // ---------------------------------------------------------- B
            trace = journeyTrace(agent, b);
            const come = async (label, box, ms) => {
                const t0 = Date.now();
                const info = await orders.orderInfo(`!goToPlayer("${PLAYER}", 3)`, ms);
                const at = await entityPos(NAME);
                const p = await entityPos(PLAYER);
                note(`${label}: !goToPlayer answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 200))}; the bot at ${fmt(at)}`);
                check(info.done && (box ? inBox(at, box) : inBasement(b, at)) && dist(at, p) <= 4, `${label} within ${ms / 1000} s, within 4 blocks of the player`, `${fmt(at)}, ${dist(at, p).toFixed(1)} blocks`);
            };
            // the bot is in the basement after A5: the player goes up into the house first
            const here = await entityPos(PLAYER);
            const pCell = { x: Math.floor(here.x), y: Math.floor(here.y + 0.01), z: Math.floor(here.z) };
            if (pCell.y >= g + 1) {
                await walkPlayer(line(pCell, sp.besideTrapdoor));
            }
            const botNow = await entityPos(NAME);
            if (!inBasement(b, botNow)) note(`B: the bot is not in the basement at the start of B: ${fmt(botNow)}`);
            await come('B1: "come here" from the house brings the bot up from the basement', b.house.interior, 60000);
            // the player goes down into the basement and closes the trapdoor over himself
            await setTrapdoor(b, true);
            await walkPlayer([{ x: s1.x, y: g, z: s1.z }, { x: s1.x, y: g - 1, z: s1.z }], 300);
            await setTrapdoor(b, false);
            await walkPlayer([{ x: s1.x, y: g - 2, z: s1.z }, { x: s1.x, y: g - 3, z: s1.z }, { x: s1.x, y: g - 4, z: s1.z }, { x: s1.x, y: g - 5, z: s1.z }, { x: s1.x, y: g - 6, z: s1.z }, sp.basementFoot, ...line(sp.basementFoot, sp.basementWait)], 300);
            await come('B2: "come here" from the basement brings the bot down through the closed trapdoor', null, 60000);
            await tp(PLAYER, sp.roomWait);
            await sleep(1500);
            await come('B3: "come here" from the mine room brings the bot down two ladders to y 41', b.room.box, 120000);

            // ---------------------------------------------------------- C
            // the player leads the bot up again with "come here" from the house, then "follow me" down
            await tp(PLAYER, sp.besideTrapdoor);
            await sleep(1000);
            await come('C0: "come here" from the house brings the bot up from the mine room', b.house.interior, 120000);
            await setTrapdoor(b, false);
            const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 4)`, 5000);
            note(`C1: !followPlayer answered ${JSON.stringify(follow.reply.slice(0, 120))}`);
            await sleep(2000);
            await setTrapdoor(b, true);
            await walkPlayer([{ x: s1.x, y: g, z: s1.z }, { x: s1.x, y: g - 1, z: s1.z }], 250);
            await setTrapdoor(b, false); // closed over the player: the bot has to open it
            await walkPlayer([{ x: s1.x, y: g - 2, z: s1.z }, { x: s1.x, y: g - 3, z: s1.z }, { x: s1.x, y: g - 4, z: s1.z }, { x: s1.x, y: g - 5, z: s1.z }, { x: s1.x, y: g - 6, z: s1.z }, sp.basementFoot, ...line(sp.basementFoot, sp.basementWait)], 250);
            const down = await waitBot(agent, 'C1: the bot followed down through the closed trapdoor into the basement', (x) => inBasement(b, x), 60000);
            check(down.ok, 'C1: within 60 s the bot followed the player down the ladder into the basement', fmt(down.bot));
            await playerUpToHouse(b, sp.basementWait);
            await setTrapdoor(b, false);
            await walkPlayer(line(sp.besideTrapdoor, { x: sp.houseMiddle.x, y: g + 1, z: sp.besideTrapdoor.z }));
            const up = await waitBot(agent, 'C2: the bot followed up into the house', (x, p) => inBox(x, b.house.interior) && dist(x, p) <= 5, 60000);
            check(up.ok, 'C2: within 60 s the bot followed the player up into the house', fmt(up.bot));
            note(`C: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);

            // ---------------------------------------------------------- the fallback and the climbs
            const lines = ladderFallbackLines(s);
            const inReplay = new Set();
            for (const w of replay) for (let k = w.from; k < w.to; k++) inReplay.add(k);
            const outside = lines.filter((_, k) => !inReplay.has(k));
            note(`fallback ladder lines: ${lines.length} in all, ${inReplay.size} in the route replay: ${JSON.stringify(lines.slice(0, 12))}`);
            check(outside.length === 0, 'no "I go down the ladder" and no "I climb up the ladder" line in the follows and the walks (the route replay left out)', JSON.stringify(outside.slice(0, 6)));
            const rows = await sampler.stop();
            sampler = null;
            checkClimbs('the climbs of the run', rows, b, { expect: 4 });
            note(`the bot said ${JSON.stringify(saidLines(s, tStart).slice(0, 40))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (sampler) await sampler.stop();
            if (trace) printJourney('come here and follow', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
