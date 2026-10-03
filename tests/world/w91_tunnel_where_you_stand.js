// W91 the tunnel where you stand (journey of v0.1.4.11 "Navigation and words", tester T3; PLAN.md 2.2 and 2.3, SPEC
// section 7): "dig here" is accepted where the owner and the bot stand. Today (v0.1.4.10) both models needed two or
// three tries of !rememberTunnel, and a bot outside the tunnel answered "I stand in no tunnel" (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists) with the
// room tunnel of base_world.js (1 wide, 2 high, 8 blocks straight out of the west wall of the room), the owner's
// switches with the three of v0.1.4.11 on, the modes of his profile, an empty memory, the kit of the owner's chest (8
// ladders, 16 torches, a stone pickaxe). The bot is never moved by the control.
//   0. The bot and the player outside in front of the house door. "follow me" !followPlayer("w_player", 3): the player
//      walks into the house, down ladder 1, down ladder 2 into the room; the bot follows. "this is the mine"
//      !rememberMine("mine") in the room (no tunnel yet), then !stop.
//   1. The bot stays in the room; the player walks into the room tunnel to its rock face and looks along it (west).
//      "dig here" !rememberTunnel: the bot's cell is no tunnel, the player's is (PLAN 2.2, I3: "from your position and
//      facing"): `I measured the tunnel from where you stand: it starts at <first cell>, goes west, and ends at <rock
//      face> after 8 blocks, at level 41. ...` (W2).
//   2. "follow me" !followPlayer("w_player", 3): the bot comes into the tunnel, 3 behind the player at the rock face.
//      "dig here": `I measured the tunnel...` with the same start, end and direction.
//   3. !stop; the player walks back into the room; "go to the end of the tunnel" !goToCoordinates to the rock face;
//      "dig here" with the bot at the rock face: the same.
//   4. 2 iron ore 2 blocks past the rock face, in the line of the tunnel. "find some iron" !mineOre("iron", 2): the
//      tunnel is 2 blocks longer after the order (feet and head of both cells open) and the bot carries 2 raw_iron.
// Throughout: no answer holds "I stand in no tunnel"; mines.json keeps the tunnel with the start, the end and west;
// the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, tp, walkTyped, minesInFile, commands } from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, blockNames, inBox, dist } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, JOURNEY_SETTINGS, spots, PLAYER, playerIntoHouse, playerDownToBasement, playerDownToRoom, waitBot, inBasement, inside,
    walkPlayer, line, saidLines, journeyTrace, printJourney,
} from './journey.js';

const NAME = 'w_tunhere';
const KIT = [['ladder', 8], ['torch', 16], ['stone_pickaxe', 1]];
// the owner's switches of PLAYTEST.md section 2 (v0.1.4.10: job_memory and area_floors on) and the three of v0.1.4.11
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true });
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NO_TUNNEL = /I stand in no tunnel/;
const WEST = 90; // the yaw of the server: 90 looks west

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
        const t = await buildRoomTunnel(b);
        const sp = spots(b);
        const tunnelBox = { min: { x: t.end.x, y: t.level, z: t.start.z }, max: { x: t.start.x, y: t.level + 1, z: t.start.z } };
        const measured = (from) => new RegExp(`I measured the tunnel${from}: it starts at ${esc(P(t.start))}, goes west, and ends at ${esc(P(t.end))} after 8 blocks, at level ${t.level}\\. I dig on at its end when you ask for ore\\.`);
        note(`the room tunnel: from ${P(t.start)} west to the rock face at ${P(t.end)}, 8 blocks, level ${t.level}`);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const answers = [];

            // ---------------------------------------------------------- 0. the mine
            const taught = await teachMineInRoom(j, b);
            if (!taught.ok) {
                check(false, 'the bot learned the mine (precondition of "dig here"); the rest is not run');
                return;
            }
            note(`0: mines.json: ${JSON.stringify(minesInFile(agent).map((m) => ({ name: m.name, tunnels: m.tunnels, room: m.room?.center })))}`);

            // ---------------------------------------------------------- 1. the bot in the room, the owner at the rock face
            const bot1 = await entityPos(NAME);
            check(inBox(bot1, b.room.box), '1: precondition: the bot stands in the room, not in the tunnel', fmt(bot1));
            await walkPlayer(line(sp.roomWait, t.end), 350);
            await tp(PLAYER, t.end, WEST, 0);
            await sleep(1500);
            const one = await orders.order('!rememberTunnel', 30000);
            answers.push(one);
            note(`1: the bot at ${fmt(await entityPos(NAME))}, the player at the rock face ${fmt(await entityPos(PLAYER))}: !rememberTunnel answered ${JSON.stringify(one)}`);
            check(measured(' from where you stand').test(one),
                `1: "dig here" with the bot in the room and the owner at the rock face: \`I measured the tunnel from where you stand: it starts at ${P(t.start)}, goes west, and ends at ${P(t.end)} after 8 blocks, at level ${t.level}.\` (PLAN 2.2)`,
                JSON.stringify(one));

            // ---------------------------------------------------------- 2. the owner at the rock face, the bot 3 behind
            const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 3)`, 5000);
            note(`2: !followPlayer answered ${JSON.stringify(follow.reply)}`);
            const behind = await waitBot(agent, '2: the bot is in the tunnel behind the player', (a, p) => inBox(a, tunnelBox) && dist(a, p) <= 4.5, 60000);
            check(behind.ok, '2: precondition: "follow me" brings the bot into the tunnel, 3 behind the player at the rock face', fmt(behind.bot));
            await tp(PLAYER, t.end, WEST, 0);
            await sleep(1500);
            const two = await orders.order('!rememberTunnel', 30000);
            answers.push(two);
            note(`2: the bot at ${fmt(await entityPos(NAME))}: !rememberTunnel answered ${JSON.stringify(two)}`);
            check(measured('( from where you stand)?').test(two),
                `2: "dig here" with the owner at the rock face and the bot 3 behind: \`I measured the tunnel...\`, from ${P(t.start)} west to ${P(t.end)}, 8 blocks`, JSON.stringify(two));

            // ---------------------------------------------------------- 3. the bot at the rock face
            note(`3: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await tp(PLAYER, t.start, -WEST, 0);
            await sleep(300);
            await walkPlayer(line(t.start, sp.roomWait), 300);
            await tp(PLAYER, sp.roomWait, WEST, 0);
            const walk = await walkTyped(orders, agent, t.end);
            check(walk.arrived, '3: precondition: "go to the end of the tunnel" brings the bot to the rock face', fmt(walk.pos));
            await sleep(1000);
            const three = await orders.order('!rememberTunnel', 30000);
            answers.push(three);
            note(`3: the bot at ${fmt(await entityPos(NAME))}, the player in the room: !rememberTunnel answered ${JSON.stringify(three)}`);
            check(measured('( from where you stand)?').test(three),
                `3: "dig here" with the bot at the rock face: \`I measured the tunnel...\`, from ${P(t.start)} west to ${P(t.end)}, 8 blocks`, JSON.stringify(three));
            check(answers.every((x) => !NO_TUNNEL.test(x)), 'no answer of "dig here" holds "I stand in no tunnel"', JSON.stringify(answers));
            const mine = minesInFile(agent).find((m) => m.name === 'mine');
            const kept = (mine?.tunnels ?? []).find((x) => x.start?.x === t.start.x && x.start?.z === t.start.z && x.end?.x === t.end.x && x.dir === 'west');
            note(`3: the tunnels of the mine "mine": ${JSON.stringify(mine?.tunnels ?? null)}`);
            check(Boolean(kept), `3: mines.json: the mine "mine" keeps the tunnel from ${P(t.start)} west to ${P(t.end)}`, JSON.stringify(mine?.tunnels ?? null));

            // ---------------------------------------------------------- 4. dig on at its end
            const ores = [t.beyond(2), { ...t.beyond(2), y: t.level + 1 }];
            await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
            const iron0 = (await inventoryOf(NAME)).raw_iron || 0;
            const trace = journeyTrace(agent, b);
            const t0 = Date.now();
            const info = await orders.orderInfo('!mineOre("iron", 2)', 300000);
            printJourney('the iron at the end of the tunnel', await trace.stop());
            note(`4: !mineOre("iron", 2) answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 400))}`);
            const past = [t.beyond(1), t.beyond(2)].flatMap((p) => [p, { ...p, y: p.y + 1 }]);
            const open = await blockNames(past, ['air', 'cave_air', 'torch', 'wall_torch']);
            const iron = ((await inventoryOf(NAME)).raw_iron || 0) - iron0;
            note(`4: the cells past the rock face ${past.map(P).join(' ')} are ${JSON.stringify(open)}; the bot carries ${iron} raw_iron more; it is at ${fmt(await entityPos(NAME))}`);
            check(info.done, '4: !mineOre("iron", 2) ended within 5 minutes', info.reply.slice(0, 200));
            check(open.every(Boolean), '4: the bot dug on at the end: the tunnel is 2 blocks longer (feet and head of both cells open)', JSON.stringify(open));
            check(iron >= 2, '4: the bot carries the 2 raw_iron from past the rock face', `${iron} raw_iron`);
            check(!NO_TUNNEL.test(info.reply), '4: the answer of !mineOre holds no "I stand in no tunnel"', info.reply.slice(0, 200));

            note(`the bot said ${JSON.stringify(saidLines(s).slice(0, 40))}`);
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
