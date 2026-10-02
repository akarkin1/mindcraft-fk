// W96 the dry scan (journey of v0.1.4.11 "Navigation and words", tester T3; PLAN.md 4.3, SPEC section 7, I7 and N1):
// !goToMine says what blocks the way before the first step. Today (v0.1.4.10) the bot walks, fails at the block, and
// asks the owner to walk the way again (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with the three of v0.1.4.11 on, the modes of his profile, an empty memory, the kit of the owner's chest (8
// ladders, 16 torches, a stone pickaxe). The bot is never moved by the control.
//   0. The bot and the player outside in front of the house door; the player teaches the mine (journey.js
//      partTeachMine); "get out" !leaveMine brings the bot to the surface; the player in the house, "come here"
//      !goToPlayer("w_player", 2): the bot is in the house (preconditions).
//   1. The owner locks the room: both doors of the double door become iron doors (closed; no hand opens them).
//      "go to the mine" !goToMine from the house: the answer is the text of N1 for the door, `I find no way from
//      (x, y, z) to the door at <a door of the room>: it is closed and I cannot open it.`, and the bot did not move:
//      within 1 block of where it stood, at the answer and all the time while it ran (sampled).
//   2. The owner puts the oak doors back (closed). "go to the mine" !goToMine: the bot reaches the room within 180 s and
//      the answer names no failure.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, tp, commands, startTrace } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, JOURNEY_SETTINGS, spots, PLAYER, partTeachMine, playerIntoHouse, setDoubleDoor, waitBot, inside, onSurface, saidLines,
    journeyTrace, printJourney,
} from './journey.js';

const NAME = 'w_dryscan';
const KIT = [['ladder', 8], ['torch', 16], ['stone_pickaxe', 1]];
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true });
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const FAILED = /I could not|I find no way|Show me the way again/;

// The double door of the room as iron doors (closed): the owner locked it.
function ironDoors(b) {
    const cmds = [];
    for (const d of b.owner.doors) {
        // F8 (the lead): both halves to air in one fill (a second setblock of air fails once the first removed both
        // halves), then the lower half, then the upper
        cmds.push(`fill ${d.lower.x} ${d.lower.y} ${d.lower.z} ${d.upper.x} ${d.upper.y} ${d.upper.z} minecraft:air`);
        cmds.push(`setblock ${d.lower.x} ${d.lower.y} ${d.lower.z} minecraft:iron_door[facing=west,half=lower,hinge=${d.hinge},open=false]`);
        cmds.push(`setblock ${d.upper.x} ${d.upper.y} ${d.upper.z} minecraft:iron_door[facing=west,half=upper,hinge=${d.hinge},open=false]`);
    }
    return commands(cmds);
}

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
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;

            // ---------------------------------------------------------- 0. the mine, the bot in the house
            const taught = await partTeachMine({ ...j, b });
            if (!taught.ok) {
                check(false, 'the bot learned the mine (precondition of the dry scan); the rest is not run');
                return;
            }
            const out = await orders.orderInfo('!leaveMine', 300000);
            await sleep(1000);
            const a0 = await entityPos(NAME);
            note(`0: !leaveMine answered ${JSON.stringify(out.reply.slice(0, 300))}; the bot at ${fmt(a0)}`);
            check(onSurface(b, a0), '0: precondition: "get out" brings the bot to the surface', fmt(a0));
            await tp(PLAYER, sp.outside);
            await sleep(500);
            await playerIntoHouse(b, sp.outside);
            const come = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 90000);
            await sleep(1500);
            const inHouse = await entityPos(NAME);
            note(`0: "come here" answered ${JSON.stringify(come.reply.slice(0, 200))}; the bot at ${fmt(inHouse)}`);
            check(inBox(inHouse, b.house.interior), '0: precondition: "come here" brings the bot into the house', fmt(inHouse));
            if (!inBox(inHouse, b.house.interior)) return;

            // ---------------------------------------------------------- 1. the locked door
            await ironDoors(b);
            await sleep(500);
            const doors = b.owner.doors.map((d) => d.lower);
            const doorText = new RegExp(`I find no way from \\(-?\\d+, -?\\d+, -?\\d+\\) to the door at (${doors.map((d) => esc(P(d))).join('|')}): it is closed and I cannot open it\\.`);
            const before = await entityPos(NAME);
            const moved = startTrace(async () => ({ bot: await entityPos(NAME) }), 300);
            const t1 = Date.now();
            const one = await orders.orderInfo('!goToMine', 180000);
            await sleep(1000);
            const rows = await moved.stop();
            const after = await entityPos(NAME);
            const farthest = Math.max(0, ...rows.filter((x) => x.bot).map((x) => dist(x.bot, before)));
            note(`1: with the iron doors !goToMine answered after ${((Date.now() - t1) / 1000).toFixed(1)} s: ${JSON.stringify(one.reply.slice(0, 400))}; the bot stood at ${fmt(before)}, is at ${fmt(after)}, at most ${farthest.toFixed(1)} blocks away meanwhile`);
            check(doorText.test(one.reply), `1: the answer is the text of N1: \`I find no way from (x, y, z) to the door at ${P(doors[0])} (or ${P(doors[1])}): it is closed and I cannot open it.\``, JSON.stringify(one.reply.slice(0, 300)));
            check(dist(after, before) <= 1, '1: the bot did not move: within 1 block of where it stood, after the answer', `${dist(after, before).toFixed(2)} blocks`);
            check(farthest <= 1.5, '1: the bot did not walk while the scan ran (every sample within 1.5 blocks)', `${farthest.toFixed(2)} blocks`);

            // ---------------------------------------------------------- 2. the door open again
            await setDoubleDoor(b, false);
            await sleep(500);
            const trace = journeyTrace(agent, b);
            const t2 = Date.now();
            const go = orders.orderInfo('!goToMine', 300000);
            const there = await waitBot(agent, '2: the bot is in the room', inside(b.room.box), 180000);
            const two = await go;
            printJourney('the way into the mine', await trace.stop());
            note(`2: !goToMine answered after ${((Date.now() - t2) / 1000).toFixed(1)} s: ${JSON.stringify(two.reply.slice(0, 300))}; the bot at ${fmt(await entityPos(NAME))}`);
            check(there.ok, '2: with the oak doors back "go to the mine" brings the bot into the room within 180 s', fmt(there.bot));
            check(two.done && !FAILED.test(two.reply), '2: the answer names no failure', JSON.stringify(two.reply.slice(0, 200)));

            note(`the bot said ${JSON.stringify(saidLines(s, t1).slice(0, 30))}`);
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
