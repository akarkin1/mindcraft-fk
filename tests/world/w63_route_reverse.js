// W63 the route backwards (v0.1.4.9 spec A2 "I walk it in both directions", A4, I3, I4, section 11 TW 3).
// New in v0.1.4.9: a route is walked in both directions; !goToRememberedPlace takes a learned route when the path
// search did not arrive (ctx.routes.walkTo, the glue of I4). Against v0.1.4.8: from the bed, the bot does not get
// down the ladder to the room (or digs its own way down through the floor of the house).
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner. The place
// "storage" is in the room at y 41; the bot learns the route "bed" as in W62 (the walk up the ladder, through the
// trapdoor to the bed, !rememberRoute("bed")). Then, from the bed, the player types
// !goToRememberedPlace("storage"):
//   - the bot goes down the ladder (server positions in the column of the shaft) and ends in the room at y 41,
//     within 2 blocks of the place "storage";
//   - nothing in the house, the shaft and the room was dug or placed; the bot was never hurt.
// The place "home" is not saved, as in W62.
// Finding of T2 (2026-09-30, left failing): the path search of !goToRememberedPlace ("Found non-destructive path")
// walks onto the closed trapdoor and stands there; after about 20 s the reflex unstuck stops the command ("Command
// !goToRememberedPlace was stopped by the reflex unstuck. ... I stopped at (x, 61, z), 20 blocks from the goal.")
// before the learned route is tried (walkRememberedWay in actions.js comes only after goToPosition returns). The
// route alone (the probe at the end) goes down the ladder into the room in 9 s: "I followed the route "bed", 4 steps."
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, entityPos, fmt, env, orderChannel,
    commands, startTrace, printTrace, walkUpToBed, watchHealth, sleep, routesInFile, recordMoves, runSkill, placeBot,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rback';
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

            const walk = await walkUpToBed(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked to the foot of the ladder and, after the climb, to the bed', fmt(walk.at));
            const said = await orders.order('!rememberRoute("bed")', 20000);
            note(`!rememberRoute("bed") answered ${JSON.stringify(said)}`);
            check(/^I remember the way "bed": from the place "storage" to here, \d+ steps?, 1 ladder, 1 trapdoor\./.test(said), 'precondition: the route "bed" is learned with 1 ladder and 1 trapdoor', JSON.stringify(said));

            // ---------------------------------------------------------- from the bed back to the room
            await sleep(1000);
            const health = watchHealth(agent.bot);
            const t0 = Date.now();
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 400);
            const info = await orders.orderInfo('!goToRememberedPlace("storage")', 240000);
            const rows = await trace.stop();
            const hp = health.stop();
            printTrace('!goToRememberedPlace("storage") from the bed', rows, { pos: (x) => fmt(x.pos), action: (x) => x.action }, 60);
            note(`!goToRememberedPlace("storage") answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply)}`);
            const end = await entityPos(NAME);
            const inShaft = rows.filter((x) => x.pos && Math.floor(x.pos.x) === col.x && Math.floor(x.pos.z) === col.z && x.pos.y > b.room.box.min.y + 2 && x.pos.y < g - 1);
            check(info.done, 'the order ended');
            check(inShaft.length > 0, 'the bot went down the ladder of the shaft (server positions in the column above the room)', `${inShaft.length} samples`);
            check(inBox(end, b.room.box) && Math.floor(end.y + 0.01) === b.room.box.min.y, `the bot is in the room at y ${b.room.box.min.y} (server)`, fmt(end));
            check(end && Math.hypot(end.x - (store.x + 0.5), end.z - (store.z + 0.5)) <= 2.5, 'the bot is within 2 blocks of the place "storage"', fmt(end));
            check(hp.min >= 20, 'the bot was never hurt', JSON.stringify(hp.hurt.slice(0, 5)));
            const cmp = await compareSnapshot(snap);
            check(cmp.same, 'nothing in the house, the shaft and the room was dug or placed (the trapdoor and the door may be open or closed)', describeDifferences(cmp.differences));
            // for the report (no check of the spec): the route walked alone backwards from the bed, without the path search
            // before it (walkRoute of I3 through the context of the packs)
            if (!inBox(end, b.room.box)) {
                const route = routesInFile(agent).find((x) => x.name === 'bed');
                await placeBot(agent, walk.bedside, 0);
                await sleep(1000);
                const moves = recordMoves(agent);
                const trace2 = startTrace(async () => ({ pos: await entityPos(NAME), trap: await isOpen(b.trapdoor, 'oak_trapdoor') }), 400);
                const alone = await runSkill(agent, 'walkRoute', (bot, ctx) => ctx.routes.walkRoute(bot, route, { reverse: true }), 180000);
                const rows2 = await trace2.stop();
                moves.stop();
                printTrace('walkRoute("bed", reverse) alone from the bed', rows2, { pos: (x) => fmt(x.pos), trapdoor: (x) => (x.trap ? 'open' : 'closed') }, 60);
                note(`walkRoute("bed", reverse) alone from the bed: ${JSON.stringify(alone.result)} after ${(alone.ms / 1000).toFixed(1)} s; the bot is at ${fmt(await entityPos(NAME))}`);
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
