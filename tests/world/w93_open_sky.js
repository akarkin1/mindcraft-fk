// W93 the open sky (journey of v0.1.4.11 "Navigation and words", tester T3; PLAN.md 1.4, SPEC section 7 and W4):
// "get to the surface" means the open sky. Today (v0.1.4.10) !goToSurface aims at the highest block above the bot,
// inside the house its roof (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with the three of v0.1.4.11 on, the modes of his profile, an empty memory, 8 ladders (the second shaft of
// the owner's base ends 2 blocks above the floor of the room: the way up places the missing ones). The bot is never
// moved by the control.
//   1. The bot and the player in the house, the door closed. "get out" !goToSurface: the answer is `I went out through
//      the door at <the house door> and stand under the open sky at (x, y, z).` (W4); the bot ends outside the house,
//      its feet at the ground (y g+1, never on the roof), no block above it; nothing of the house was dug or placed
//      (so it went through the door); the door is closed within 10 s after.
//   2. "follow me" !followPlayer("w_player", 3) from outside down both ladders into the room; "this is the mine"
//      !rememberMine("mine"); !stop. "get to the surface" !goToSurface from the room: the answer is one of the texts of
//      W4 for a way out (`I climbed to the open sky at (x, y, z).` or the one of the door); the bot ends at the
//      ground under the open sky, outside the house and the mine.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, waitFor } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen, blockNames, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, JOURNEY_SETTINGS, spots, PLAYER, playerIntoHouse, playerOutOfHouse, playerDownToBasement, playerDownToRoom, waitBot, inBasement, inside,
    saidLines, journeyTrace, printJourney,
} from './journey.js';

const NAME = 'w_opensky';
const KIT = [['ladder', 8]];
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true });
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const XYZ = '\\(-?\\d+, -?\\d+, -?\\d+\\)';
const SKY_HEIGHT = 30; // the region is cleared to g+30; above it the flat world has nothing

// The owner shows the bot the mine and says "this is the mine" in the room (the way of W81, without the last leg).
// Resolves with { ok, said }.
async function teachMineInRoom(j, b) {
    const { agent, orders } = j;
    const sp = spots(b);
    const trace = journeyTrace(agent, b);
    let ok = true;
    let said = '';
    const leg = async (label, pred) => {
        if (!ok) return;
        const w = await waitBot(agent, label, pred, 60000);
        check(w.ok, `${label} within 60 s, by itself (precondition)`, fmt(w.bot));
        ok = w.ok;
    };
    try {
        const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 3)`, 5000);
        note(`2: !followPlayer answered ${JSON.stringify(follow.reply)}`);
        await sleep(2000);
        await playerIntoHouse(b, sp.outside);
        await sleep(2000);
        await playerDownToBasement(b);
        await leg('2: the bot followed down ladder 1 into the basement', (a) => inBasement(b, a));
        if (ok) await playerDownToRoom(b, sp.basementWait);
        await leg('2: the bot followed down ladder 2 into the room', inside(b.room.box));
        if (!ok) return { ok, said };
        await sleep(1500);
        said = await orders.order('!rememberMine("mine")', 30000);
        note(`2: !rememberMine("mine") in the room answered ${JSON.stringify(said)}`);
        ok = /I remember the mine "mine":/.test(said) && /\b2 ladders\b/.test(said);
        check(ok, '2: "this is the mine" in the room remembers the mine with 2 ladders (precondition)', JSON.stringify(said));
        note(`2: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
    } finally {
        printJourney('the player shows the mine', await trace.stop());
    }
    return { ok, said };
}

// The cells above the head of the bot up to g+SKY_HEIGHT that hold a block (not air): [] means the open sky.
async function blocksAbove(b, a) {
    const x = Math.floor(a.x), z = Math.floor(a.z);
    const cells = [];
    for (let y = Math.floor(a.y + 0.01) + 1; y <= b.g + SKY_HEIGHT; y++) cells.push({ x, y, z });
    const got = await blockNames(cells, ['air', 'cave_air', 'void_air']);
    return cells.filter((c, i) => !got[i]);
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, SKY_HEIGHT);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const sp = spots(b);
        const g = b.g;
        const h = b.house;
        let agent = null, orders = null, snap = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { x: sp.houseMiddle.x - 1, y: g + 1, z: sp.houseMiddle.z + 1 }, playerAt: { x: sp.houseMiddle.x + 2, y: g + 1, z: sp.houseMiddle.z }, kit: KIT, settings: SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;

            // ---------------------------------------------------------- 1. from inside the house
            check((await isOpen(h.door)) === false, '1: precondition: the door of the house is closed', String(await isOpen(h.door)));
            snap = await snapshotBox(h.box);
            const trace1 = journeyTrace(agent, b);
            const t1 = Date.now();
            const one = await orders.orderInfo('!goToSurface', 120000);
            const rows1 = await trace1.stop();
            printJourney('the way out of the house', rows1);
            await sleep(1000);
            const a1 = await entityPos(NAME);
            note(`1: !goToSurface answered after ${((Date.now() - t1) / 1000).toFixed(1)} s: ${JSON.stringify(one.reply.slice(0, 300))}; the bot at ${fmt(a1)}`);
            const doorText = new RegExp(`I went out through the door at ${esc(P(h.door))} and stand under the open sky at ${XYZ}\\.`);
            check(doorText.test(one.reply), `1: the answer is \`I went out through the door at ${P(h.door)} and stand under the open sky at (x, y, z).\` (W4)`, JSON.stringify(one.reply.slice(0, 200)));
            check(Boolean(a1) && !inBox(a1, h.box), '1: the bot ends outside the house', fmt(a1));
            check(Boolean(a1) && a1.y >= g + 1 - 0.01 && a1.y < g + 1.6, `1: the bot stands at the ground (feet at y ${g + 1}), never on the roof (y ${g + 6})`, fmt(a1));
            const roofed = a1 ? await blocksAbove(b, a1) : [{}];
            check(roofed.length === 0, '1: no block above the bot (the open sky)', roofed.slice(0, 4).map(P).join(' '));
            const maxY = Math.max(...rows1.filter((x) => x.bot).map((x) => x.bot.y));
            check(maxY < g + 2.5, `1: the bot never climbed onto the roof on its way (highest feet below y ${g + 2.5})`, maxY.toFixed(2));
            const cmp = await compareSnapshot(snap);
            check(cmp.same, '1: nothing of the house was dug or placed (the bot went out through the door)', describeDifferences(cmp.differences));
            const shut = await waitFor(async () => (await isOpen(h.door)) === false, { ms: 10000, every: 500 });
            check(shut.ok, '1: the door of the house is closed within 10 s after the bot went out', String(await isOpen(h.door)));
            await dropSnapshot(snap).catch(() => {});
            snap = null;

            // ---------------------------------------------------------- 2. from the mine room
            // the player walks out to the bot, then shows it the mine
            await playerOutOfHouse(b, { x: sp.houseMiddle.x + 2, y: g + 1, z: sp.houseMiddle.z });
            const taught = await teachMineInRoom(j, b);
            if (!taught.ok) {
                check(false, 'the bot learned the mine (precondition of part 2); the rest is not run');
                return;
            }
            const a2 = await entityPos(NAME);
            check(inBox(a2, b.room.box), '2: precondition: the bot stands in the room of the mine', fmt(a2));
            const trace2 = journeyTrace(agent, b);
            const t2 = Date.now();
            const two = await orders.orderInfo('!goToSurface', 300000);
            printJourney('the way out of the mine', await trace2.stop());
            await sleep(1000);
            const e2 = await entityPos(NAME);
            note(`2: !goToSurface from the room answered after ${((Date.now() - t2) / 1000).toFixed(1)} s: ${JSON.stringify(two.reply.slice(0, 300))}; the bot at ${fmt(e2)}`);
            const outText = new RegExp(`I climbed to the open sky at ${XYZ}\\.|I went out through the door at ${XYZ} and stand under the open sky at ${XYZ}\\.`);
            check(outText.test(two.reply), '2: the answer is a text of W4 for the way out (`I climbed to the open sky at (x, y, z).`)', JSON.stringify(two.reply.slice(0, 200)));
            check(Boolean(e2) && e2.y >= g + 1 - 0.01 && e2.y < g + 1.6 && !inBox(e2, h.box) && !inBox(e2, b.mineBox), `2: the bot stands at the ground (feet at y ${g + 1}), outside the house and the mine`, fmt(e2));
            const above2 = e2 ? await blocksAbove(b, e2) : [{}];
            check(above2.length === 0, '2: no block above the bot (the open sky)', above2.slice(0, 4).map(P).join(' '));

            note(`the bot said ${JSON.stringify(saidLines(s).slice(0, 40))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (snap) await dropSnapshot(snap).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
