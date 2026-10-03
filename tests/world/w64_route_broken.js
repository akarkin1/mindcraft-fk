// W64 a broken route (v0.1.4.9 spec I3, section 1 "A broken route is reported, nothing is dug", 11 TW 3).
// New in v0.1.4.9: when a leg of a learned route cannot be walked, the bot says where and asks to be shown the
// way again, and digs nothing; a column of ladders with a gap is not entered, so the bot does not fall.
// Against v0.1.4.8: there are no routes; the path search digs its own way or gives up without saying why.
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner. The bot
// learns the route "bed" as in W62 (the place "storage" in the room at y 41, the walk up the ladder, through the
// trapdoor to the bed, !rememberRoute("bed")). Then 7 ladders in the middle of the shaft are taken away (y 46 to
// 52). From the bed the player types !goToRememberedPlace("storage"):
//   - the answer holds the text of W1 of v0.1.4.11 (the cause of the failed leg; "Show me the way again." is gone),
//     "I could not follow the route "bed" at step S of T: the ladder at (x, z) has a gap of 7 at y 46. I need 7
//     ladders to go on.", with S the ladder leg of the route walked backwards (routes.json), T its legs, (x, z) the
//     column of the shaft;
//   - nothing in the house, the shaft and the room was dug or placed (the trapdoor may be open);
//   - the bot lives: it is in the house, not in the shaft, never hurt, the process did not end.
// The place "home" is not saved, as in W62.
// F2 of T2 (the first run, 2026-09-30; corrected in the fix round): as in W63, the reflex unstuck stops !goToRememberedPlace while its path
// search stands on the closed trapdoor, so the route is never tried and the answer has no text of I3. Nothing is dug
// (protect_built_blocks keeps the floor). The route alone (the probe at the end) answers the text of I3 as the spec
// wants: "I could not follow the route "bed" at step 3 of 4, at (x, 61, z). Show me the way again."
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, entityPos, fmt, env, orderChannel,
    commands, startTrace, printTrace, walkUpToBed, watchHealth, routesInFile, sleep, placeBot, runSkill,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot, entityNumber } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rbroken';
const PLAYER = 'w_player';
const GAP = { from: 46, to: 52 };
// v0.1.4.11 (W1): the cause of the failed leg, here the ladder with its gap; "Show me the way again." is gone
const FAILED = /I could not follow the route "bed" at step (\d+) of (\d+): the ladder at \((-?\d+), (-?\d+)\) has a gap of (\d+) at y (-?\d+)\. I need (\d+) ladders? to go on\./;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const col = b.shaft.column;
        const box = { min: { x: b.house.box.min.x, y: b.room.floorY, z: b.house.box.min.z }, max: { x: b.house.box.max.x, y: b.house.box.max.y, z: b.house.box.max.z } };

        let agent = null, orders = null, snap = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            let deaths = 0;
            agent.bot.on('death', () => { deaths++; });
            await resetBot(NAME);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            const store = b.room.middle;
            agent.memory_bank.rememberPlace('storage', store.x + 0.5, store.y, store.z + 0.5, agent.bot.game?.dimension);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });

            const walk = await walkUpToBed(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked to the foot of the ladder and, after the climb, to the bed', fmt(walk.at));
            const said = await orders.order('!rememberRoute("bed")', 20000);
            note(`!rememberRoute("bed") answered ${JSON.stringify(said)}`);
            check(/^I remember the way "bed": from the place "storage" to here, \d+ steps?, 1 ladder, 1 trapdoor\./.test(said), 'precondition: the route "bed" is learned with 1 ladder and 1 trapdoor', JSON.stringify(said));
            const route = routesInFile(agent).find((x) => x.name === 'bed');
            const back = [...(route?.legs ?? [])].reverse();
            const ladderStep = back.findIndex((l) => l.kind === 'ladder') + 1;
            note(`the route "bed" walked backwards: ${back.map((l, i) => `${i + 1} ${l.kind}${l.kind2 ? ' ' + l.kind2 : ''}`).join(', ')}; the ladder is step ${ladderStep} of ${back.length}`);

            // ---------------------------------------------------------- the ladder taken away
            await commands([`fill ${col.x} ${GAP.from} ${col.z} ${col.x} ${GAP.to} ${col.z} minecraft:air`]);
            snap = await snapshotBox(box);
            await sleep(1000);
            const health = watchHealth(agent.bot);
            const t0 = Date.now();
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 400);
            const info = await orders.orderInfo('!goToRememberedPlace("storage")', 240000);
            const rows = await trace.stop();
            const hp = health.stop();
            printTrace('!goToRememberedPlace("storage") with the ladder broken', rows, { pos: (x) => fmt(x.pos), action: (x) => x.action }, 60);
            note(`!goToRememberedPlace("storage") answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply)}`);
            const end = await entityPos(NAME);
            const m = FAILED.exec(info.reply);
            check(Boolean(m), 'the answer holds the text of W1 (v0.1.4.11) with the ladder: "I could not follow the route "bed" at step S of T: the ladder at (x, z) has a gap of N at y Y. I need N ladders to go on."', JSON.stringify(info.reply));
            check(!/Show me the way again/.test(info.reply), 'the answer holds no "Show me the way again" (W1)', JSON.stringify(info.reply));
            if (m) {
                check(Number(m[1]) === ladderStep && Number(m[2]) === back.length, 'the step is the ladder of the route walked backwards, of all its legs', `step ${m[1]} of ${m[2]}, expected ${ladderStep} of ${back.length}`);
                const gap = GAP.to - GAP.from + 1;
                check(Number(m[3]) === col.x && Number(m[4]) === col.z && Number(m[5]) === gap && Number(m[6]) === GAP.from && Number(m[7]) === gap,
                    `the text names the column of the shaft (${col.x}, ${col.z}), the gap of ${gap} ladders at y ${GAP.from} and the ${gap} ladders it needs`, JSON.stringify(m.slice(3)));
            }
            const cmp = await compareSnapshot(snap);
            check(cmp.same, 'nothing in the house, the shaft and the room was dug or placed (the trapdoor and the door may be open or closed)', describeDifferences(cmp.differences));
            check(!rows.some((x) => x.pos && Math.floor(x.pos.x) === col.x && Math.floor(x.pos.z) === col.z && x.pos.y < g - 1), 'the bot never went into the shaft');
            check(inBox(end, b.house.interior), 'the bot is in the house at the end (server)', fmt(end));
            const hpNow = await entityNumber(NAME, 'Health');
            check(hp.min >= 20 && deaths === 0 && hpNow > 0, 'the bot lives and was never hurt', `min health ${hp.min}, deaths ${deaths}, health now ${hpNow}`);
            // for the report (no check of the spec): the route walked alone backwards from the bed, without the path search
            // before it (walkRoute of I3 through the context of the packs): its text with the broken ladder
            if (!m) {
                await placeBot(agent, walk.bedside, 0);
                await sleep(1000);
                const alone = await runSkill(agent, 'walkRoute', (bot, ctx) => ctx.routes.walkRoute(bot, route, { reverse: true }), 180000);
                note(`walkRoute("bed", reverse) alone from the bed with the ladder broken: ${JSON.stringify(alone.result)} after ${(alone.ms / 1000).toFixed(1)} s; the bot is at ${fmt(await entityPos(NAME))}`);
            }
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
