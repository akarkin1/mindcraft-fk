// W95 the route joined where the bot is (journey of v0.1.4.11 "Navigation and words", tester T3; PLAN.md 4.1, 4.2 and
// 4.4, SPEC section 7 and I7, I8): with routes_by_search the way into the mine is walked by the path search from the
// nearest waypoint, in the direction of the goal. Today (v0.1.4.10) the route is a replay of legs that fails on a ladder
// from mid-ladder and at doors the door service closes (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with the three of v0.1.4.11 on (routes_by_search among them), the modes of his profile with the door service
// (door_closing), an empty memory, the kit of the owner's chest (8 ladders, 16 torches, a stone pickaxe). The bot is
// never moved by the control.
//   0. The bot and the player outside in front of the house door; the player teaches the mine (journey.js
//      partTeachMine: "follow me" down both ladders to the end of the tunnel, "this is the mine").
//   1. "get out" !leaveMine: the bot is on the surface (precondition).
//   2. "follow me" !followPlayer("w_player", 3); the player walks into the house, opens the trapdoor and climbs down
//      ladder 1 and on into the room. While the bot is on ladder 1 between the floors (its own view), the player types
//      "go to the mine" !goToMine.
//   3. The bot reaches the room within 120 s without going back up: after the order its feet never rise more than 1
//      block above where the order found them, nor to the trapdoor (y g) (the replay of v0.1.4.10 starts the ladder leg
//      again from its top); the answer holds no `I could not follow`; the bot ends in the mine.
//   4. "get out" !leaveMine from the tunnel: the bot reaches the surface; the answer holds no `I could not follow`.
//   5. 10 s later every door is closed: the trapdoor, both doors of the room, the door of the house.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, tp, waitFor } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, JOURNEY_SETTINGS, spots, PLAYER, partTeachMine, playerIntoHouse, playerDownToBasement, playerDownToRoom, waitBot, inside,
    onSurface, doubleDoorState, saidLines, journeyTrace, printJourney,
} from './journey.js';

const NAME = 'w_routejoin';
const KIT = [['ladder', 8], ['torch', 16], ['stone_pickaxe', 1]];
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true });
const NOT_FOLLOWED = /I could not follow/;

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
        const bm = b.owner.basement.box;
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;

            // ---------------------------------------------------------- 0. the mine
            const taught = await partTeachMine({ ...j, b });
            if (!taught.ok) {
                check(false, 'the bot learned the mine (precondition of the route); the rest is not run');
                return;
            }

            // ---------------------------------------------------------- 1. out
            const out = await orders.orderInfo('!leaveMine', 300000);
            await sleep(1000);
            const a1 = await entityPos(NAME);
            note(`1: !leaveMine answered ${JSON.stringify(out.reply.slice(0, 300))}; the bot at ${fmt(a1)}`);
            check(onSurface(b, a1), '1: precondition: "get out" brings the bot to the surface', fmt(a1));
            if (!onSurface(b, a1)) return;

            // ---------------------------------------------------------- 2. on the ladder
            await tp(PLAYER, sp.outside);
            await sleep(1000);
            const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 3)`, 5000);
            note(`2: !followPlayer answered ${JSON.stringify(follow.reply)}`);
            await sleep(2000);
            const onLadder = () => {
                const p = agent.bot?.entity?.position;
                // the middle of the ladder: 1.5 blocks or more from either floor
                return p && Math.floor(p.x) === s1.x && Math.floor(p.z) === s1.z && p.y > bm.min.y + 1.5 && p.y < g - 2.5 ? { x: p.x, y: p.y, z: p.z } : null;
            };
            // the player walks on without waiting; the order comes while the bot is on ladder 1
            const walking = (async () => {
                await playerIntoHouse(b, sp.outside);
                await sleep(1500);
                await playerDownToBasement(b);
                await playerDownToRoom(b, sp.basementWait);
            })();
            const mid = await waitFor(onLadder, { ms: 90000, every: 50 });
            const trace = journeyTrace(agent, b);
            const tGo = Date.now();
            const go = orders.orderInfo('!goToMine', 300000);
            note(`2: the order !goToMine came with the bot ${mid.ok ? `on ladder 1 at ${fmt(mid.value)}` : `NOT on ladder 1 within 90 s, at ${fmt(await entityPos(NAME))}`}`);
            check(mid.ok, '2: precondition: the bot followed onto ladder 1 and was on it, between the floors, when the order came', mid.ok ? fmt(mid.value) : 'never seen on the ladder');

            // ---------------------------------------------------------- 3. joined where it is
            const room = await waitBot(agent, '3: the bot is in the room', inside(b.room.box), 120000);
            const info = await go;
            await walking;
            await sleep(1000);
            const rows = await trace.stop();
            printJourney('the way into the mine from the ladder', rows);
            const end3 = await entityPos(NAME);
            const ys = rows.filter((x) => x.bot && x.t * 1000 <= info.ms).map((x) => x.bot.y);
            const highest = ys.length ? Math.max(...ys) : null;
            note(`3: !goToMine answered after ${((Date.now() - tGo) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 300))}; the highest feet of the bot during the walk y ${highest?.toFixed(2)}; it ends at ${fmt(end3)}`);
            const limit = mid.ok ? Math.min(g, mid.value.y + 1) : g;
            check(highest !== null && highest < limit, `3: the bot joined where it was and did not go back up: its feet stayed below y ${limit.toFixed(1)} (1 block above where the order found it, and below the trapdoor) during the walk`, highest?.toFixed(2));
            check(room.ok, '3: "go to the mine" from the ladder brings the bot into the room within 120 s', fmt(room.bot));
            check(info.done && !NOT_FOLLOWED.test(info.reply), '3: the answer holds no `I could not follow`', JSON.stringify(info.reply.slice(0, 200)));
            check(Boolean(end3) && end3.y < b.room.box.max.y + 1 && inBox(end3, b.mineBox), '3: the bot ends in the mine', fmt(end3));

            // ---------------------------------------------------------- 4. out from the tunnel
            const t4 = Date.now();
            const leave = await orders.orderInfo('!leaveMine', 300000);
            await sleep(1000);
            const a4 = await entityPos(NAME);
            note(`4: !leaveMine answered after ${((Date.now() - t4) / 1000).toFixed(1)} s: ${JSON.stringify(leave.reply.slice(0, 300))}; the bot at ${fmt(a4)}`);
            check(onSurface(b, a4), '4: "get out" from the mine: the bot reaches the surface', fmt(a4));
            check(leave.done && !NOT_FOLLOWED.test(leave.reply), '4: the answer holds no `I could not follow`', JSON.stringify(leave.reply.slice(0, 200)));

            // ---------------------------------------------------------- 5. the doors
            await sleep(10000);
            const trap = await isOpen(b.trapdoor, 'oak_trapdoor');
            const room2 = await doubleDoorState(b);
            const house = await isOpen(b.house.door);
            note(`5: the trapdoor ${trap ? 'open' : 'closed'}, the doors of the room ${JSON.stringify(room2)} (open), the door of the house ${house ? 'open' : 'closed'}`);
            check(trap === false && room2.every((x) => x === false) && house === false, '5: 10 s after the way out every door the bot passed is closed: the trapdoor, both doors of the room, the door of the house', JSON.stringify({ trap, room: room2, house }));

            note(`the bot said ${JSON.stringify(saidLines(s, tGo).slice(0, 40))}`);
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
