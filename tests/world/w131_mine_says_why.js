// W131 the mine says why (entry `mine_says_why`; v0.1.4.16 "Stability, and three packs", tester T3; PLAN.md section 4 F5 and 7, SPEC
// section 3 F5 and 7): every stop of a mining run names its reason, `new_mine` true starts a new mine where the bot stands, a
// forgotten mine's tunnel the bot stands in becomes a mine again, the way-down check names the block that stopped it. Findings R-7,
// Q-6, Q-7: three runs "I stopped because I got stuck" after a store trip with no reason in the log, `new_mine` true walked to the old
// mine, "A new mine starts from the surface" underground in a forgotten mine, "lava, water or caves block the way down" where the rock
// was solid. Against 9a28d07 (v0.1.4.15) A's stop line has no detail and no `Mining stop:` line, C answers `I am underground, not in a
// mine I know ...`, B walks to the known mine and says no `I start a new mine here`, E says `my way is blocked by lava, water or caves`
// for a bedrock; on the release every check passes.
//
// The W118 layout: the owner variant of the base with the room tunnel of base_world.js (8 blocks west out of the room at y 41), the
// chest of the room full but 20 slots; the owner's switches (SUPERVISION_SETTINGS), the modes of his profile, an empty memory; the
// kit of W118 (an iron pickaxe, 16 torches, 8 ladders, 4 bread). The line of the tunnel beyond its rock face is seeded with gravel (1
// block in), iron ore at 2, 4, ... 14 and cobblestone at 3, 5, ... 13, feet and head. The bot is never moved by the control; between
// the parts it walks by itself (typed orders). Console names of 26.1.
//   0. The player teaches the mine in the room with its tunnel (journey.js partTeachMineInRoom).
//   A. The blocked way back: the bag is filled to 2 free slots (torches, a kind the trip keeps); typed `!mineOre("iron", 6)`; once the
//      bot digs beyond the rock face the control closes the tunnel behind it where it leaves the room (2 bedrock, the whole cross
//      section): the bag fills, the store trip finds no way to the chest. A1 the stop line names the reason with its detail: `I mined N
//      raw_iron of 6. I stopped because <reason>: <text>`; A2 the log has `Mining stop: <reason> at (x, y, z), step <step>: <text>`
//      (the bot's action output, through logTo, or the console). The plug is removed afterwards.
//   C. Typed `!forgetMine("mine")`; the bot stands in the tunnel; typed `!mineOre("iron", 2)`: C1 `This tunnel is a mine now: "<name>"
//      at (x, y, z).`; C2 the trip runs: 2 raw_iron more in the bag within 180 s (server); C3 mines.json holds a mine again.
//      Then the player stands outside the house and says "come here" (typed !goToPlayer): the bot climbs out by itself (W82).
//   B. On the surface, 30 blocks from the house (typed walk): typed `!mineOre("iron", 2, true)` with the mine of C known: B1 `I start a
//      new mine here, as you said.` within 45 s; B2 mines.json gains a mine whose entrance lies within 3 blocks of where the bot stood;
//      B3 (D of the spec row) the shaft under that spot is dug 4 blocks or deeper within 90 s and no `block the way down` or `blocked
//      by lava, water or caves` line is said (the rock is solid). Typed `!stop`, then `!leaveMine`.
//   E. At another spot (typed walk) the control lays a plate of bedrock 3 blocks under the grass; typed `!mineOre("iron", 2, true)`:
//      E1 the answer names the block: `I could not dig the bedrock at (x, y, z)` with the bedrock's position; E2 the log has
//      `Mining stop: dig_failed at ...`.
// Throughout: the process lives, no request reached a real model.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, giveItems, tp, readWorldFile, minesInFile,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, buildFullChest, inventoryOf, itemsText, blockNames, hdist } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMineInRoom, spots, saidLines, SUPERVISION_SETTINGS, PLAYER, journeyTrace, printJourney, recordOutput, onSurface } from './journey.js';

const NAME = 'w_why';
const KIT = [['iron_pickaxe', 1], ['torch', 16], ['ladder', 8], ['bread', 4]];
const NEW_MINE_LINE = 'I start a new mine here, as you said.';
const TUNNEL_MINE = /^This tunnel is a mine now: "([^"]+)" at \((-?\d+), (-?\d+), (-?\d+)\)\.$/;
const STOP_DETAIL = /I stopped because [^.:]+: \S/;
const MINING_STOP = /Mining stop: (\w+) at \((-?\d+), (-?\d+), (-?\d+)\), step \w+: /;
const WAY_DOWN_BLOCKED = /block the way down|blocked by lava, water or caves/;
const UNDERGROUND_NO_MINE = /^I am underground, not in a mine I know\./;
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const cellText = (p) => `(${p.x}, ${p.y}, ${p.z})`;

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
        const g = b.g;
        const { ox, oz } = b;
        await buildFullChest(b.room.chest, 'cobblestone', { free: 20 });
        // the line beyond the rock face: gravel at 1, iron at 2, 4, ... 14, cobblestone at 3, 5, ... 13 (feet and head)
        const seedCmds = [];
        for (let k = 1; k <= 14; k++) {
            const block = k === 1 ? 'gravel' : k % 2 === 0 ? 'iron_ore' : 'cobblestone';
            for (const dy of [0, 1]) { const c = { ...t.beyond(k), y: t.level + dy }; seedCmds.push(`setblock ${P(c)} minecraft:${block}`); }
        }
        await commands(seedCmds);
        const plug = [t.cells[0], { ...t.cells[0], y: t.cells[0].y + 1 }]; // the tunnel's first cell, in the west wall of the room
        const spotB = { x: ox + 30, y: g + 1, z: oz - 20 };
        const spotE = { x: ox + 30, y: g + 1, z: oz + 24 };
        const bedrockAt = { x: spotE.x, y: g - 3, z: spotE.z };
        let agent = null, orders = null, trace = null, output = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: SUPERVISION_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            output = recordOutput(agent);
            const t0 = Date.now();
            const ironOf = async () => (await inventoryOf(NAME)).raw_iron || 0;
            const stopLines = (from) => [...(s.logs ?? []).map((l) => ({ text: String(l), t: null })), ...output.lines.filter((l) => l.t >= from)].map((l) => l.text).filter((l) => /Mining stop:/.test(l));

            // ---------------------------------------------------------- 0. the mine
            const taught = await partTeachMineInRoom({ ...j, b }, { tunnel: t });
            if (!taught.ok) {
                check(false, '0: the bot learned the mine and its tunnel (precondition); the rest is not run');
                return;
            }
            trace = journeyTrace(agent, b);

            // ---------------------------------------------------------- A. the blocked way back
            const free0 = 36 - agent.bot.inventory.items().length;
            if (free0 > 2) await giveItems(NAME, [['torch', (free0 - 2) * 64]], agent.bot);
            await sleep(500);
            const free = 36 - agent.bot.inventory.items().length;
            note(`A0: the bag has ${free} free slots (${itemsText(await inventoryOf(NAME))}); the plug goes at ${plug.map(cellText).join(' and ')} once the bot digs beyond ${cellText(t.end)}`);
            check(free === 2, 'A0: precondition: the bag is full but 2 slots', `${free} free`);
            const tA = Date.now();
            const orderA = orders.orderInfo('!mineOre("iron", 6)', 300000);
            const digging = await waitFor(async () => { const at = await entityPos(NAME); return at && at.x < t.end.x + 1.5 && Math.abs(at.y - t.level) < 1.5 ? at : null; }, { ms: 120000, every: 500 });
            if (digging.ok) {
                await commands(plug.map((c) => `setblock ${P(c)} minecraft:bedrock`));
                note(`A0: the bot digs at ${fmt(digging.value)} after ${(digging.ms / 1000).toFixed(0)} s; the control closed the tunnel behind it with bedrock at ${plug.map(cellText).join(' and ')}`);
            } else {
                note(`A0: the bot did not reach the rock face within 120 s (at ${fmt(await entityPos(NAME))}); the plug is not placed`);
            }
            const infoA = await orderA;
            const replyA = String(infoA.reply);
            const saidA = saidLines(s, tA);
            const stopA = stopLines(tA);
            const atA = await entityPos(NAME);
            note(`A: !mineOre("iron", 6) ${infoA.done ? `ended after ${(infoA.ms / 1000).toFixed(0)} s` : 'did NOT end within 300 s'}: ${JSON.stringify(replyA.slice(0, 400))}; the bot at ${fmt(atA)} with ${itemsText(await inventoryOf(NAME))}; the bot said ${JSON.stringify(saidA.slice(0, 10))}; Mining stop lines ${JSON.stringify(stopA.slice(0, 3))}`);
            check(digging.ok && infoA.done && /I stopped because/.test(replyA), 'A0: precondition: the trip stopped (the store trip found no way back to the chest)', JSON.stringify(replyA.slice(0, 200)));
            check(STOP_DETAIL.test(replyA) || saidA.some((l) => STOP_DETAIL.test(l)), 'A1: the stop line names the reason with its detail: `I mined N raw_iron of 6. I stopped because <reason>: <text>` (F5)', JSON.stringify(replyA.slice(0, 300)));
            check(stopA.some((l) => MINING_STOP.test(l)), 'A2: the log has `Mining stop: <reason> at (x, y, z), step <step>: <text>` (F5, rule 8: the owner\'s log answers "why")', JSON.stringify(stopA.slice(0, 2)));
            if (!infoA.done && agent.actions.executing) note(`A: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await commands(plug.map((c) => `setblock ${P(c)} minecraft:air`));
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });

            // ---------------------------------------------------------- C. the forgotten tunnel
            const forgot = await orders.order('!forgetMine("mine")', 20000);
            const atC0 = await entityPos(NAME);
            const inTunnel = Boolean(atC0) && Math.abs(atC0.y - t.level) < 1.5 && Math.abs(atC0.z - (oz + 0.5)) < 1 && atC0.x < t.start.x + 1;
            note(`C0: !forgetMine("mine") answered ${JSON.stringify(forgot)}; mines.json ${JSON.stringify(minesInFile(agent).map((m) => m.name ?? m.key ?? '?'))}; the bot at ${fmt(atC0)} (${inTunnel ? 'in the tunnel' : 'NOT in the tunnel'})`);
            check(/^Forgot the mine "mine"\.$/.test(forgot) && minesInFile(agent).length === 0, 'C0: precondition: the mine is forgotten (`Forgot the mine "mine".`, mines.json empty)', `${JSON.stringify(forgot)}, ${minesInFile(agent).length} mines`);
            if (!inTunnel) {
                const back = await orders.orderInfo(`!goToCoordinates(${t.cells[3].x}, ${t.level}, ${t.cells[3].z}, 0)`, 60000);
                note(`C0: the bot walks into the tunnel: ${JSON.stringify(String(back.reply).slice(0, 120))}; at ${fmt(await entityPos(NAME))}`);
            }
            const iron0 = await ironOf();
            const tC = Date.now();
            const orderC = orders.orderInfo('!mineOre("iron", 2)', 240000);
            const mined = await waitFor(async () => (await ironOf()) - iron0 >= 2, { ms: 180000, every: 2000 });
            const line = await waitFor(() => saidLines(s, tC).find((l) => TUNNEL_MINE.test(l)) ?? null, { ms: 2000, every: 250 });
            const saidC = saidLines(s, tC);
            const minesC = minesInFile(agent);
            note(`C: ${((Date.now() - tC) / 1000).toFixed(0)} s after the order the bot has ${(await ironOf()) - iron0} raw_iron more; the bot said ${JSON.stringify(saidC.slice(0, 10))}; mines.json ${JSON.stringify(minesC.map((m) => ({ name: m.name, entrance: m.entrance, tunnels: (m.tunnels ?? []).length })))}`);
            check(line.ok, 'C1: `This tunnel is a mine now: "<name>" at (x, y, z).` (F5: a forgotten mine\'s tunnel the bot stands in becomes a mine again)', JSON.stringify(line.value ?? saidC.filter((l) => UNDERGROUND_NO_MINE.test(l) || /mine/i.test(l)).slice(0, 3)));
            check(mined.ok, 'C2: the trip runs in the tunnel: 2 raw_iron more within 180 s (server)', `${(await ironOf()) - iron0} raw_iron more`);
            check(minesC.length >= 1, 'C3: mines.json holds a mine again', `${minesC.length} mines`);
            const infoC = await Promise.race([orderC, sleep(90000).then(() => null)]);
            note(`C: the order ${infoC ? `answered ${JSON.stringify(String(infoC.reply).slice(0, 300))}` : 'did not end within 90 s after the ore'}`);
            if (!infoC && agent.actions.executing) note(`C: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });

            // the way out: the player stands outside and says "come here" (W82: the bot climbs the ladders by itself)
            await tp(PLAYER, sp.outside);
            await sleep(500);
            const up = await orders.orderInfo(`!goToPlayer("${PLAYER}", 3)`, 150000);
            const upAt = await entityPos(NAME);
            note(`up: !goToPlayer answered after ${(up.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(up.reply).slice(0, 160))}; the bot at ${fmt(upAt)} (${onSurface(b, upAt) ? 'on the surface' : 'NOT on the surface'})`);
            check(onSurface(b, upAt), 'up: precondition of B and E: the bot came up to the player under the open sky by itself (W82)', fmt(upAt));
            if (!up.done && agent.actions.executing) note(`up: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);

            // ---------------------------------------------------------- B. new_mine true: a new mine where the bot stands
            const walkB = await orders.orderInfo(`!goToCoordinates(${spotB.x}, ${spotB.y}, ${spotB.z}, 1)`, 90000);
            const atB = await entityPos(NAME);
            const thereB = Boolean(atB) && hdist(atB, { x: spotB.x + 0.5, z: spotB.z + 0.5 }) <= 2 && atB.y >= g;
            note(`B0: the walk to ${cellText(spotB)} answered ${JSON.stringify(String(walkB.reply).slice(0, 120))}; the bot at ${fmt(atB)} (${thereB ? 'there' : 'NOT there'}); known mines ${JSON.stringify(minesInFile(agent).map((m) => m.name ?? m.key))}`);
            check(thereB && minesInFile(agent).length >= 1, 'B0: precondition: the bot stands on the surface 30 blocks from the house and a mine is known', `${fmt(atB)}, ${minesInFile(agent).length} mines`);
            const minesBefore = minesInFile(agent).length;
            const column = [1, 2, 3, 4].map((d) => ({ x: spotB.x, y: g + 1 - d, z: spotB.z }));
            const tB = Date.now();
            const orderB = orders.orderInfo('!mineOre("iron", 2, true)', 200000);
            const lineB = await waitFor(() => saidLines(s, tB).find((l) => l === NEW_MINE_LINE) ?? null, { ms: 45000, every: 250 });
            const dug = await waitFor(async () => { const names = await blockNames(column, ['air', 'ladder', 'cave_air']); return names.every(Boolean) ? names : null; }, { ms: 90000, every: 2000 });
            const minesB = minesInFile(agent);
            const newMine = minesB.find((m) => m?.entrance && hdist({ x: m.entrance.x + 0.5, z: m.entrance.z + 0.5 }, { x: spotB.x + 0.5, z: spotB.z + 0.5 }) <= 3) ?? null;
            const saidB = saidLines(s, tB);
            note(`B: ${((Date.now() - tB) / 1000).toFixed(0)} s after the order: the line ${lineB.ok ? `came after ${(lineB.ms / 1000).toFixed(1)} s` : 'did NOT come within 45 s'}; the column under the spot ${JSON.stringify(dug.value ?? await blockNames(column, ['air', 'ladder', 'cave_air', 'grass_block', 'dirt', 'stone']))}; mines ${minesBefore} -> ${minesB.length}, the new one ${JSON.stringify(newMine ? { name: newMine.name, entrance: newMine.entrance } : null)}; the bot at ${fmt(await entityPos(NAME))}; the bot said ${JSON.stringify(saidB.slice(0, 8))}`);
            check(lineB.ok, `B1: \`${NEW_MINE_LINE}\` (F5: new_mine true starts a new mine where the bot stands, with a mine known)`, JSON.stringify(saidB.slice(0, 4)));
            check(newMine !== null, 'B2: mines.json gains a mine whose entrance lies within 3 blocks of where the bot stood', JSON.stringify(minesB.map((m) => m.entrance)));
            check(dug.ok, 'B3: the shaft under the spot is dug 4 blocks or deeper within 90 s (the way down over solid rock is dug)', JSON.stringify(dug.value ?? 'not dug'));
            check(!saidB.some((l) => WAY_DOWN_BLOCKED.test(l)), 'B3: no `block the way down` or `blocked by lava, water or caves` line where the rock is solid', JSON.stringify(saidB.filter((l) => WAY_DOWN_BLOCKED.test(l))));
            note(`B: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            const infoB = await Promise.race([orderB, sleep(30000).then(() => null)]);
            note(`B: the order ${infoB ? `answered ${JSON.stringify(String(infoB.reply).slice(0, 200))}` : 'did not answer within 30 s of the stop'}`);
            const leave = await orders.orderInfo('!leaveMine', 120000);
            const afterLeave = await entityPos(NAME);
            note(`B: !leaveMine answered after ${(leave.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(leave.reply).slice(0, 160))}; the bot at ${fmt(afterLeave)} (${onSurface(b, afterLeave) ? 'on the surface' : 'NOT on the surface'})`);
            if (!leave.done && agent.actions.executing) note(`B: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);

            // ---------------------------------------------------------- E. a bedrock in the way down
            const walkE = await orders.orderInfo(`!goToCoordinates(${spotE.x}, ${spotE.y}, ${spotE.z}, 1)`, 120000);
            const atE = await entityPos(NAME);
            const thereE = Boolean(atE) && hdist(atE, { x: spotE.x + 0.5, z: spotE.z + 0.5 }) <= 2 && atE.y >= g;
            note(`E0: the walk to ${cellText(spotE)} answered ${JSON.stringify(String(walkE.reply).slice(0, 120))}; the bot at ${fmt(atE)} (${thereE ? 'there' : 'NOT there'})`);
            check(thereE, 'E0: precondition: the bot stands on the surface at the spot of E', fmt(atE));
            await commands([`fill ${bedrockAt.x - 1} ${bedrockAt.y} ${bedrockAt.z - 1} ${bedrockAt.x + 1} ${bedrockAt.y} ${bedrockAt.z + 1} minecraft:bedrock`]);
            const tE = Date.now();
            const infoE = await orders.orderInfo('!mineOre("iron", 2, true)', 150000);
            const replyE = String(infoE.reply);
            const saidE = saidLines(s, tE);
            const stopE = stopLines(tE);
            const couldNot = new RegExp(String.raw`I could not dig the bedrock at \(${bedrockAt.x}, ${bedrockAt.y}, ${bedrockAt.z}\)`);
            note(`E: !mineOre("iron", 2, true) over bedrock at ${cellText(bedrockAt)} ${infoE.done ? `answered after ${(infoE.ms / 1000).toFixed(0)} s` : 'did NOT end within 150 s'}: ${JSON.stringify(replyE.slice(0, 300))}; the bot at ${fmt(await entityPos(NAME))}; the bot said ${JSON.stringify(saidE.slice(0, 8))}; Mining stop lines ${JSON.stringify(stopE.slice(0, 3))}`);
            check(infoE.done && (couldNot.test(replyE) || saidE.some((l) => couldNot.test(l))), `E1: the stop names the block and its position: \`I could not dig the bedrock at ${cellText(bedrockAt)}\` (F5: a failed dig is dig_failed, not "lava, water or caves")`, JSON.stringify(replyE.slice(0, 300)));
            check(stopE.some((l) => /Mining stop: dig_failed at /.test(l)), 'E2: the log has `Mining stop: dig_failed at (x, y, z), step <step>: <text>`', JSON.stringify(stopE.slice(0, 2)));
            if (!infoE.done && agent.actions.executing) note(`E: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);

            note(`the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 40))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (output) output.stop();
            if (trace) printJourney('the mine says why', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
