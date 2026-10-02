// W92 a shaft from the mine room (journey of v0.1.4.11 "Navigation and words", tester T3; PLAN.md 2.1, SPEC section 7,
// I4, W3): with mine_from_inside the bot digs a new shaft from the room of a known mine for a deeper ore. Today
// (v0.1.4.10) the order is refused underground ("I start a new mine only from the surface") and both of the owner's
// models went up the shaft (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with the three of v0.1.4.11 on (mine_from_inside among them), the modes of his profile, an empty memory, a
// kit for a deep trip (2 iron pickaxes, 192 ladders, 32 torches, 64 cobblestone, 16 bread, 2 chests). Diamond ore lies
// in two layers (y -59 and -58) of 9 x 9 blocks under the room. The bot is never moved by the control.
//   0. The bot and the player outside in front of the house door. "follow me" !followPlayer("w_player", 3) down both
//      ladders into the room; "this is the mine" !rememberMine("mine") in the room; !stop.
//   1. "find a diamond, dig a new shaft here" !mineOre("diamond", 1, true): the bot says `I dig a shaft down from here
//      to level <n> for diamond.`; after the trip a column of ladders goes down from the floor of the room (8 ladders
//      or more below its floor, in one column under the room); the bot came back up through the room (the trace);
//      it carries a diamond.
//   2. "your mines" !mines: the answer lists the child under the parent: `bot:<level> (from the mine "mine")`.
//   3. "go to the diamond mine" !goToMine("diamond"): the bot goes down to the bottom of the new shaft (feet 30 blocks
//      or more below the room floor).
//   4. "get out" !leaveMine from the bottom: the bot reaches the surface (feet at y g+1 or higher, not in the mine or
//      the basement).
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, minesInFile } from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, blockNames, inBox } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, JOURNEY_SETTINGS, spots, PLAYER, playerIntoHouse, playerDownToBasement, playerDownToRoom, waitBot, inBasement, inside,
    saidLines, journeyTrace, printJourney, onSurface,
} from './journey.js';

const NAME = 'w_shaftroom';
const KIT = [['iron_pickaxe', 2], ['ladder', 192], ['torch', 32], ['cobblestone', 64], ['bread', 16], ['chest', 2]];
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true });
const SHAFT_TEXT = /I dig a shaft down from here to level (-?\d+) for diamond\./;
const CHILD = /bot:(-?\d+) \(from the mine "mine"\)/;
const DIAMOND_Y = [-59, -58];

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
        note(`0: !followPlayer answered ${JSON.stringify(follow.reply)}`);
        await sleep(2000);
        await playerIntoHouse(b, sp.outside);
        await sleep(2000);
        await playerDownToBasement(b);
        await leg('0: the bot followed down ladder 1 into the basement', (a) => inBasement(b, a));
        if (ok) await playerDownToRoom(b, sp.basementWait);
        await leg('0: the bot followed down ladder 2 into the room', inside(b.room.box));
        if (!ok) return { ok, said };
        await sleep(1500);
        said = await orders.order('!rememberMine("mine")', 30000);
        note(`0: !rememberMine("mine") in the room answered ${JSON.stringify(said)}`);
        ok = /I remember the mine "mine":/.test(said) && /\b2 ladders\b/.test(said);
        check(ok, '0: "this is the mine" in the room remembers the mine with 2 ladders (precondition)', JSON.stringify(said));
        note(`0: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
    } finally {
        printJourney('the player shows the mine', await trace.stop());
    }
    return { ok, said };
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
        const room = b.room.box;
        const floorY = b.room.floorY;
        // the diamond layers under the room, 9 x 9 around its middle
        const m = b.room.middle;
        await commands(DIAMOND_Y.map((y) => `fill ${m.x - 4} ${y} ${m.z - 4} ${m.x + 4} ${y} ${m.z + 4} minecraft:diamond_ore`));
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;

            // ---------------------------------------------------------- 0. the mine
            const taught = await teachMineInRoom(j, b);
            if (!taught.ok) {
                check(false, 'the bot learned the mine (precondition of the shaft); the rest is not run');
                return;
            }
            const at0 = await entityPos(NAME);
            check(inBox(at0, room), '0: precondition: the bot stands in the room of the mine', fmt(at0));

            // ---------------------------------------------------------- 1. the shaft from the room
            const diamonds0 = (await inventoryOf(NAME)).diamond || 0;
            const trace = journeyTrace(agent, b);
            const t1 = Date.now();
            const info = await orders.orderInfo('!mineOre("diamond", 1, true)', 15 * 60000);
            const rows = await trace.stop();
            printJourney('the trip from the room', rows);
            const said1 = saidLines(s, t1);
            note(`1: !mineOre("diamond", 1, true) answered after ${((Date.now() - t1) / 1000).toFixed(0)} s: ${JSON.stringify(info.reply.slice(0, 500))}`);
            note(`1: the bot said ${JSON.stringify(said1.slice(0, 20))}`);
            const shaftLine = [info.reply, ...said1].find((l) => SHAFT_TEXT.test(l)) ?? null;
            check(Boolean(shaftLine), '1: the bot says `I dig a shaft down from here to level <n> for diamond.`', JSON.stringify([info.reply.slice(0, 200), ...said1.slice(0, 4)]));
            // where the bot went down: the lowest sample of the trace and its column
            const low = rows.filter((x) => x.bot).reduce((a, x) => (!a || x.bot.y < a.bot.y ? x : a), null);
            const col = low ? { x: Math.floor(low.bot.x), z: Math.floor(low.bot.z) } : null;
            note(`1: the lowest point of the bot: ${low ? `${fmt(low.bot)} at t=${low.t.toFixed(1)}s` : 'none'}`);
            let ladders = 0, top = null;
            if (col && low.bot.y < floorY - 2) {
                const cells = [];
                for (let y = floorY; y >= Math.floor(low.bot.y); y--) cells.push({ x: col.x, y, z: col.z });
                const got = await blockNames(cells, ['ladder']);
                ladders = got.filter(Boolean).length;
                top = cells.find((c, i) => got[i])?.y ?? null;
            }
            const underRoom = col && col.x >= room.min.x - 1 && col.x <= room.max.x + 1 && col.z >= room.min.z - 1 && col.z <= room.max.z + 1;
            note(`1: the column of the shaft ${col ? `(${col.x}, ${col.z})` : 'none'}: ${ladders} ladders from y ${floorY} down to the bottom, the highest at y ${top}`);
            check(Boolean(underRoom) && ladders >= 8 && top !== null && top >= floorY - 2,
                `1: a column of ladders goes down from the floor of the room (y ${floorY}): 8 ladders or more, the highest within 2 blocks of the floor, under the room`,
                `column ${col ? `(${col.x}, ${col.z})` : 'none'}, ${ladders} ladders, highest at y ${top}`);
            const wentDown = Boolean(low) && low.bot.y < floorY - 2;
            const iLow = wentDown ? rows.indexOf(low) : -1;
            const back = iLow >= 0 ? rows.slice(iLow).find((x) => x.bot && inBox(x.bot, room)) : null;
            const end1 = await entityPos(NAME);
            check(wentDown && (Boolean(back) || inBox(end1, room)), '1: the bot went down its shaft and came back up through the room',
                back ? `in the room at t=${back.t.toFixed(1)}s` : `lowest ${low ? fmt(low.bot) : 'none'}, at the end ${fmt(end1)}`);
            const diamonds = ((await inventoryOf(NAME)).diamond || 0) - diamonds0;
            note(`1: the bot carries ${diamonds} diamond more than before, at ${fmt(end1)}`);
            check(diamonds >= 1, '1: the bot carries a diamond after the trip', `${diamonds}`);

            // ---------------------------------------------------------- 2. the list of the mines
            const list = await orders.order('!mines', 20000);
            note(`2: !mines answered ${JSON.stringify(list)}; mines.json: ${JSON.stringify(minesInFile(agent).map((x) => ({ name: x.name, parent: x.parent, level: x.level, entrance: x.entrance, shaft: x.shaft })))}`);
            check(CHILD.test(list), '2: !mines lists the new shaft under the mine: `bot:<level> (from the mine "mine")`', JSON.stringify(list));
            const child = minesInFile(agent).find((x) => x.parent === 'mine');
            check(Boolean(child) && child.entrance && inBox({ x: child.entrance.x + 0.5, y: child.entrance.y, z: child.entrance.z + 0.5 }, { min: { ...room.min, y: floorY }, max: room.max }),
                '2: mines.json: the child mine has the parent "mine" and its entrance in the room', JSON.stringify(child ?? null));

            // ---------------------------------------------------------- 3. down to the bottom
            const t3 = Date.now();
            let answered = false;
            const go = orders.orderInfo('!goToMine("diamond")', 300000).then((x) => { answered = true; return x; });
            // the bot at the bottom, or the answer came (then the position at the answer decides)
            await waitBot(agent, '3: the bot is at the bottom of the new shaft, or the order answered', (a) => answered || a.y <= floorY - 30, 300000);
            const goInfo = await go;
            await sleep(1000);
            const at3 = await entityPos(NAME);
            const down = { ok: Boolean(at3) && at3.y <= floorY - 30, bot: at3 };
            note(`3: !goToMine("diamond") answered after ${((Date.now() - t3) / 1000).toFixed(0)} s: ${JSON.stringify(goInfo.reply.slice(0, 300))}`);
            check(down.ok, `3: "go to the diamond mine" brings the bot down the new shaft (feet at y ${floorY - 30} or lower)`, fmt(down.bot));

            // ---------------------------------------------------------- 4. out from the bottom
            const t4 = Date.now();
            const up = await orders.orderInfo('!leaveMine', 300000);
            await sleep(1000);
            const end = await entityPos(NAME);
            note(`4: !leaveMine answered after ${((Date.now() - t4) / 1000).toFixed(0)} s: ${JSON.stringify(up.reply.slice(0, 300))}; the bot at ${fmt(end)}`);
            check(down.ok && onSurface(b, end), `4: "get out" from the bottom: the bot reaches the surface (feet at y ${b.g + 1} or higher, not in the mine or the basement)`, fmt(end));

            note(`the bot said ${JSON.stringify(saidLines(s, t1).slice(0, 40))}`);
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
