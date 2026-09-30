// W62 the route to the bed (v0.1.4.9 spec A2, I3, I5, section 11 TW 3).
// New in v0.1.4.9: the player shows the bot a way the path search cannot find (up a ladder, through a trapdoor)
// and says "remember this way to the bed"; !rememberRoute("bed") makes a route of the trail from the last place
// it knows, and !goToBed walks that route when the path search finds no way to the bed (the hook of I5 in
// sleepInBed). Against v0.1.4.8: !rememberRoute is no command, and from the room under the house !goToBed says
// "I found no way to the bed." (or digs its own way up).
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner.
//   1. The place "storage" is saved in the room at y 41 (in the memory of the bot, as !rememberHere would, but
//      without the building area that !rememberHere also saves with protected_areas on). The bot walks from the
//      middle of the room to the foot of the ladder (typed !goToCoordinates), is moved up the ladder cell by cell
//      (200 ms per cell, spec 11 TW 2), through the open trapdoor into the house, and walks to the bed (typed).
//   2. The player types !rememberRoute("bed"): the answer is the text of A2 with 1 ladder and 1 trapdoor,
//      `I remember the way "bed": from the place "storage" to here, N steps, 1 ladder, 1 trapdoor. I walk it in
//      both directions.`; routes.json holds the route with its ladder leg and its trapdoor leg.
//   3. The bot is put back into the room with an iron pickaxe in its hand (the owner's bot always holds a tool; F11 of
//      T2: a click while sneaking with an item in the hand does not open the trapdoor). At night the player types
//      !goToBed: the bot climbs the ladder (server positions in the shaft), sleeps in the bed (the server says so),
//      and after the morning comes the answer is "I slept. It is morning."; nothing in the house, the shaft and the
//      room was dug or placed.
// The place "home" of the base is not saved here: the walk from the trapdoor to the bed passes within 2 blocks of
// it, and by A2 the way would then start at "home" (see the report of T2).
// Findings F1, F3, F8 of T2 (the first run, 2026-09-30; corrected in the fix round, DECISIONS.md):
//   - the route cannot be walked up out of the shaft: the open trapdoor over the ladder is not climbable for the
//     bot's own physics (prismarine-physics lists its feature climbableTrapdoor for 1.9 to 1.20 only), the bot bobs
//     between y 60.0 and 60.1 in the cell of the trapdoor, climbUp of ladder.js and the path search after it give
//     up, and !goToBed answers "I could not follow the route "bed" at step 2 of 4, at (x, 54, z). ...";
//   - the walk leg to the foot of the ladder puts the bot into the ladder column and the path search climbs it: the
//     route alone from the room fails at step 1, "at (x, 44, z)" (the probe at the end);
//   - with 200 ms per cell (spec 11 TW 2) the trail of 250 ms sometimes skips the cell under the trapdoor, and
//     viaOf (trail_logic.js) looks at one cell between two steps only: the route has no trapdoor leg ("3 steps,
//     1 ladder").
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, placeBot, resetBot, waitFor, entityPos,
    fmt, env, orderChannel, commands, startTrace, printTrace, serverSleeping, routesInFile, walkUpToBed, sleep, recordMoves, runSkill,
    giveItems,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rbed';
const PLAYER = 'w_player';
const REMEMBERED = /^I remember the way "bed": from the place "storage" to here, (\d+) steps?, 1 ladder, 1 trapdoor\. I walk it in both directions\.$/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const col = b.shaft.column;
        // the house, the shaft and the room: nothing may be dug or placed there
        const box = { min: { x: b.house.box.min.x, y: b.room.floorY, z: b.house.box.min.z }, max: { x: b.house.box.max.x, y: b.house.box.max.y, z: b.house.box.max.z } };

        let agent = null, orders = null, snap = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            const store = b.room.middle;
            agent.memory_bank.rememberPlace('storage', store.x + 0.5, store.y, store.z + 0.5, agent.bot.game?.dimension);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });
            snap = await snapshotBox(box);

            // ---------------------------------------------------------- 1. the walk up
            const walk = await walkUpToBed(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked to the foot of the ladder and, after the climb, to the bed (typed !goToCoordinates)', fmt(walk.at));

            // ---------------------------------------------------------- 2. !rememberRoute("bed")
            const said = await orders.order('!rememberRoute("bed")', 20000);
            note(`!rememberRoute("bed") answered ${JSON.stringify(said)}`);
            check(REMEMBERED.test(said), 'the answer is the text of A2: "I remember the way "bed": from the place "storage" to here, N steps, 1 ladder, 1 trapdoor. I walk it in both directions."', JSON.stringify(said));
            const route = routesInFile(agent).find((x) => x.name === 'bed');
            note(`routes.json: the route "bed": ${JSON.stringify(route)}`);
            const ladder = route?.legs?.find((l) => l.kind === 'ladder');
            const trap = route?.legs?.find((l) => l.kind === 'door' && l.kind2 === 'trapdoor');
            check(Boolean(ladder) && ladder.x === col.x && ladder.z === col.z && ladder.top >= g - 2 && ladder.bottom <= b.room.box.min.y + 1,
                'routes.json: the route "bed" has a ladder leg on the column of the shaft, from the room up to the trapdoor', JSON.stringify(ladder));
            check(Boolean(trap) && trap.x === b.trapdoor.x && trap.y === b.trapdoor.y && trap.z === b.trapdoor.z, 'routes.json: the route "bed" has a trapdoor leg at the trapdoor of the house', JSON.stringify(trap));
            check(route?.from?.name === 'storage', 'routes.json: the route starts at the place "storage"', JSON.stringify(route?.from));

            // ---------------------------------------------------------- 3. !goToBed from the room at night
            await placeBot(agent, b.room.middle, 0);
            await giveItems(NAME, [['iron_pickaxe', 1]], agent.bot);
            const pick = agent.bot.inventory.items().find((i) => i.name === 'iron_pickaxe');
            if (pick) await agent.bot.equip(pick, 'hand').catch((e) => note(`equip: ${e.message}`));
            check(agent.bot.heldItem?.name === 'iron_pickaxe', 'precondition: the bot holds an iron pickaxe in its hand before !goToBed', String(agent.bot.heldItem?.name));
            await commands(['time set 13000']);
            await sleep(1000);
            const t0 = Date.now();
            const trace = startTrace(async () => ({
                pos: await entityPos(NAME), sleeping: agent.bot.isSleeping, action: agent.actions.currentActionLabel || '-',
                trap: await isOpen(b.trapdoor, 'oak_trapdoor'), ctl: Object.entries(agent.bot.controlState ?? {}).filter(([, v]) => v).map(([k]) => k).join('+') || '-',
            }), 400);
            const moves = recordMoves(agent);
            const bedOrder = orders.orderInfo('!goToBed', 240000);
            const slept = await waitFor(async () => agent.bot.isSleeping === true && (await serverSleeping(NAME)), { ms: 180000, every: 500 });
            note(`the bot ${slept.ok ? 'sleeps' : 'does not sleep'} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
            if (slept.ok) await commands(['time set 1000']); // the morning: the server wakes the sleeper (the player of the test is awake)
            const info = await bedOrder;
            const rows = await trace.stop();
            moves.stop();
            printTrace('!goToBed from the room at y 41', rows, {
                pos: (x) => fmt(x.pos), sleeping: (x) => x.sleeping, trapdoor: (x) => (x.trap ? 'open' : 'closed'), controls: (x) => x.ctl, action: (x) => x.action,
            }, 120);
            note(`the trapdoor was open in ${rows.filter((x) => x.trap === true).length} of ${rows.length} samples`);
            note(`!goToBed answered ${JSON.stringify(info.reply)} after ${(info.ms / 1000).toFixed(1)} s; the bot said ${JSON.stringify(s.chats.filter((c) => c.t >= t0).map((c) => c.text))}`);
            const inShaft = rows.filter((x) => x.pos && Math.floor(x.pos.x) === col.x && Math.floor(x.pos.z) === col.z && x.pos.y > b.room.box.min.y + 2 && x.pos.y < g - 1);
            check(inShaft.length > 0, 'the bot climbed the ladder of the shaft (server positions in the column above the room)', `${inShaft.length} samples`);
            check(slept.ok, 'at night !goToBed puts the bot to sleep in the bed (its own view and the server)');
            check(/I slept\. It is morning\./.test(info.reply), 'the answer of !goToBed is "I slept. It is morning."', JSON.stringify(info.reply));
            const end = await entityPos(NAME);
            check(inBox(end, b.house.interior), 'the bot is in the house at the end', fmt(end));
            await commands(['time set 6000']);
            await sleep(1500);
            const cmp = await compareSnapshot(snap);
            check(cmp.same, 'nothing in the house, the shaft and the room was dug or placed (the trapdoor and the door may be open or closed)', describeDifferences(cmp.differences));
            // for the report (no check of the spec): the route walked alone, without the path search before it, from the
            // room by day (walkRoute of I3 through the context of the packs, as the mining pack calls it)
            if (!slept.ok && route) {
                await placeBot(agent, b.room.middle, 0);
                await sleep(1000);
                const moves2 = recordMoves(agent);
                const trace2 = startTrace(async () => ({ pos: await entityPos(NAME), trap: await isOpen(b.trapdoor, 'oak_trapdoor') }), 400);
                const alone = await runSkill(agent, 'walkRoute', (bot, ctx) => ctx.routes.walkRoute(bot, { ...route, legs: route.legs }), 180000);
                const rows2 = await trace2.stop();
                moves2.stop();
                printTrace('walkRoute("bed") alone from the room', rows2, { pos: (x) => fmt(x.pos), trapdoor: (x) => (x.trap ? 'open' : 'closed') }, 60);
                note(`walkRoute("bed") alone from the room: ${JSON.stringify(alone.result)} after ${(alone.ms / 1000).toFixed(1)} s; the bot is at ${fmt(await entityPos(NAME))}; the trapdoor was open in ${rows2.filter((x) => x.trap).length} of ${rows2.length} samples`);
            }
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['gamerule doDaylightCycle false', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
