// W133 a cave in the way (entry `cave_in_the_way`; v0.1.4.16 "Stability, and three packs", tester T3; PLAN.md section 4 F10, section
// 7; SPEC section 3 F10 and 7, as the owner changed it on 2026-11-12: `!collectBlocks` never refuses a block for a cave; it takes the
// surface ones first and says once that it goes carefully into a cave; the mining walls off a cave it breaks into; `!sealOpening`
// closes an opening). Finding R-13 and the caves row: two deaths in caves under the old mine from `!collectBlocks` orders. Against
// 9a28d07 (v0.1.4.15) B says no `The stone is in a cave; I go carefully.`, C patches nothing beyond the tunnel's end and D answers
// `Command '!sealOpening' does not exist.`; on the release every check passes (A holds before and after: it guards the order).
//
// The base world with the W118 layout at the origin (the owner variant of the base with the room tunnel, 8 blocks west out of the
// room at y 41) and a collect spot 70 blocks east of the house: within 16 blocks of it the natural stone (y 40 to 56) is replaced by
// dirt, a cave 9 x 3 x 9 is carved 8 blocks under the grass (air y g-9..g-7, under 7 blocks of dirt and grass: natural rock above, no
// sky) with 6 stone blocks in it (4 in its floor, 2 in its west wall), the only stone within 16 blocks; 4 stone blocks lie on the grass
// 3 to 6 blocks from the spot. Beyond the rock face of the room tunnel a cave of 5 x 3 x 5 begins one block behind the face (the
// `beyond` cells of the tunnel's view). The owner's switches (SUPERVISION_SETTINGS), the modes of his profile, an empty memory; the
// kit of W118 plus 32 cobblestone (the filler). The bot is never moved by the control; it walks between the parts (typed).
//   A. At the spot, typed `!collectBlocks("stone", 4)`: within 120 s the 4 surface stones are gone (server) and the bag has 4
//      cobblestone more; the 6 cave stones still stand; the bot's feet never went below the grass (the surface ones first, the
//      command ends with 4 collected); no death.
//   B. Typed `!collectBlocks("stone", 2)`: the only stone within 16 blocks lies in the cave. Within 180 s: B1 the bot said `The stone is
//      in a cave; I go carefully.` exactly once; B2 two of the cave's stones are air (server) and the bag has 2 cobblestone more; B3
//      the bot lives (no death; up again or alive underground).
//   The bot walks back to the house (typed, 70 blocks; the pathfinder climbs out of its hole) and the player teaches the mine in the
//   room with its tunnel (journey.js partTeachMineInRoom).
//   C. Typed `!mineOre("iron", 2)`: within 120 s the two beyond cells (feet and head, one block behind the rock face) hold a filler
//      block (cobblestone or another stone of FILLERS): the mining walled off the cave it would have broken into. Then typed `!stop`.
//   D. The bot walks into the room (typed); the control opens the room's south wall with a 3 x 3 hole into a cave behind it; typed
//      `!sealOpening(x, y, z)` of its middle cell: `I sealed the opening at (x, y, z) with 9 cobblestone.` and the 9 cells hold
//      cobblestone (server).
// Throughout: the process lives, no request reached a real model.
// T4 2026-11-14 (the first server run): A and B collect granite, not stone. collectBlock searches 64 blocks and F10 takes every block
// outside a cave first, at any distance; the deep base world has natural stone within 64 blocks everywhere (y 56 and below, also
// under the dirt), so "the only stone within 16 blocks lies in the cave" could not hold: B took the buried stone at x+17, 11 blocks
// from the bot, and said no cave line. Granite is nowhere else in the base world: 4 on the grass, 6 in the cave, and the line is
// `The granite is in a cave; I go carefully.` (`The <type> is in a cave; ...`). The walk back is two typed legs, the grass beside
// the spot first (a short way, the digging fallback allowed): from 89 blocks the bot in its own 1 x 1 hole, torches in both its
// cells, answered `I found no way to (400, 61, -13) without digging; ...` at once (P-19, a finding of its own).
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, startTrace, printTrace,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, inventoryOf, itemsText, hdist, entityNumber } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMineInRoom, spots, saidLines, SUPERVISION_SETTINGS } from './journey.js';
import { Vec3 } from 'vec3';

const NAME = 'w_cave';
const KIT = [['iron_pickaxe', 1], ['torch', 16], ['ladder', 8], ['bread', 4], ['cobblestone', 32]];
const KIND = 'granite'; // T4: the kind of A and B, found nowhere else in the base world
const CAREFUL = `The ${KIND} is in a cave; I go carefully.`;
const FILLERS = ['cobblestone', 'cobbled_deepslate', 'stone', 'deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'dirt'];
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
        const { ox, oz, g } = b;
        // the cave one block beyond the tunnel's end: the rock face (beyond 1) stands, the air begins at beyond 2
        const beyond = [{ ...t.beyond(2), y: t.level }, { ...t.beyond(2), y: t.level + 1 }];
        const caveC = { min: { x: t.end.x - 6, y: t.level, z: oz - 2 }, max: { x: t.end.x - 2, y: t.level + 2, z: oz + 2 } };
        await commands([`fill ${P(caveC.min)} ${P(caveC.max)} minecraft:air`]);
        // the collect spot 70 blocks east: a patch prepared, the natural stone within 16 blocks replaced by dirt, a cave under rock
        const spot = { x: ox + 70, y: g + 1, z: oz };
        const patch = { ox: spot.x, oz: spot.z, g, radius: 20 };
        await prepareRegion(patch, 24);
        const fills = [];
        for (let y = 40; y <= g - 4; y++) fills.push(`fill ${spot.x - 16} ${y} ${spot.z - 16} ${spot.x + 16} ${y} ${spot.z + 16} minecraft:dirt replace minecraft:stone`);
        await commands(fills, 60000);
        const caveB = { min: { x: spot.x - 4, y: g - 9, z: spot.z - 4 }, max: { x: spot.x + 4, y: g - 7, z: spot.z + 4 } };
        const caveStones = [
            { x: spot.x - 1, y: g - 10, z: spot.z }, { x: spot.x, y: g - 10, z: spot.z }, { x: spot.x + 1, y: g - 10, z: spot.z }, { x: spot.x + 2, y: g - 10, z: spot.z },
            { x: spot.x - 5, y: g - 9, z: spot.z - 1 }, { x: spot.x - 5, y: g - 9, z: spot.z + 1 },
        ];
        const surfaceStones = [3, 4, 5, 6].map((d) => ({ x: spot.x + d, y: g + 1, z: spot.z + 3 }));
        await commands([`fill ${P(caveB.min)} ${P(caveB.max)} minecraft:air`, ...caveStones.map((c) => `setblock ${P(c)} minecraft:${KIND}`), ...surfaceStones.map((c) => `setblock ${P(c)} minecraft:${KIND}`)]);
        const column = [];
        for (let y = g - 6; y <= g; y++) column.push({ x: spot.x, y, z: spot.z });
        const stoneAround = await blockNames([{ x: spot.x, y: g - 4, z: spot.z }, { x: spot.x + 12, y: g - 5, z: spot.z + 12 }, { x: spot.x, y: g - 11, z: spot.z }, ...column], ['dirt', 'grass_block', 'stone']);
        note(`build: the collect spot ${cellText(spot)}; the cave under it ${cellText(caveB.min)} to ${cellText(caveB.max)} with ${caveStones.length} stones, ${surfaceStones.length} stones on the grass at ${surfaceStones.map(cellText).join(' ')}; the ground around is ${JSON.stringify(stoneAround)} (dirt within 16, the cave's floor dirt, the column over the cave dirt and grass)`);
        check(stoneAround.slice(0, 3).every((n) => n === 'dirt') && stoneAround.slice(3).every((n) => n === 'dirt' || n === 'grass_block'), 'precondition: no natural stone within 16 blocks of the spot (dirt), the cave under 7 blocks of dirt and grass', JSON.stringify(stoneAround));
        // the opening of D: carved after the teach (a hole in the room's wall would change the room the mine remembers)
        const opening = { min: { x: ox + 1, y: b.room.box.min.y, z: b.room.box.max.z + 1 }, max: { x: ox + 3, y: b.room.box.min.y + 2, z: b.room.box.max.z + 1 } };
        const caveD = { min: { x: ox, y: b.room.box.min.y, z: opening.min.z + 1 }, max: { x: ox + 4, y: b.room.box.min.y + 2, z: opening.min.z + 5 } };
        const openingCells = [];
        for (let x = opening.min.x; x <= opening.max.x; x++) for (let y = opening.min.y; y <= opening.max.y; y++) openingCells.push({ x, y, z: opening.min.z });
        const middle = { x: ox + 2, y: b.room.box.min.y + 1, z: opening.min.z };
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...spot, z: spot.z - 1 }, botYaw: 0, playerAt: { x: spot.x - 3, y: g + 1, z: spot.z - 3 }, kit: KIT, settings: SUPERVISION_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();
            let deaths = 0;
            agent.bot.on('death', () => { deaths++; });
            const cobble = async () => (await inventoryOf(NAME)).cobblestone || 0;
            const kindCount = async () => (await inventoryOf(NAME))[KIND] || 0;

            // ---------------------------------------------------------- A. the surface stones first
            const cobbleA0 = await kindCount();
            const traceA = startTrace(async () => ({ bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 250);
            const tA = Date.now();
            const infoA = await orders.orderInfo(`!collectBlocks("${KIND}", 4)`, 120000);
            await sleep(1500);
            const rowsA = await traceA.stop();
            const surfaceA = await blockNames(surfaceStones, [KIND]);
            const caveA = await blockNames(caveStones, [KIND]);
            const cobbleA = await kindCount();
            const lowestA = Math.min(...rowsA.filter((x) => x.bot).map((x) => x.bot.y));
            printTrace(`A: !collectBlocks("${KIND}", 4) with ${KIND} on the grass and in the cave`, rowsA, { bot: (x) => fmt(x.bot), action: (x) => x.action }, 40);
            note(`A: the order ${infoA.done ? `answered after ${(infoA.ms / 1000).toFixed(0)} s` : 'did NOT end within 120 s'}: ${JSON.stringify(String(infoA.reply).slice(0, 200))}; the surface ${KIND} ${JSON.stringify(surfaceA)}, the cave ${KIND} ${JSON.stringify(caveA)}; ${KIND} in the bag ${cobbleA0} -> ${cobbleA}; lowest feet y ${lowestA.toFixed(2)}; the bot said ${JSON.stringify(saidLines(s, tA).slice(0, 6))}`);
            check(infoA.done && surfaceA.every((n) => n === null) && cobbleA - cobbleA0 >= 4, `A1: the 4 ${KIND} on the grass are gone and the bag has 4 ${KIND} more: the command ends with 4 collected (server)`, `surface ${JSON.stringify(surfaceA)}, ${KIND} ${cobbleA0} -> ${cobbleA}`);
            check(caveA.every((n) => n === KIND) && lowestA >= g + 0.5, `A2: the surface ${KIND} was taken first: the cave's 6 ${KIND} still stand and the bot's feet never went below the grass`, `cave ${caveA.filter(Boolean).length} of 6, lowest y ${lowestA.toFixed(2)}`);
            if (!infoA.done && agent.actions.executing) note(`A: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });

            // ---------------------------------------------------------- B. the only stone within 16 blocks lies in the cave
            const cobbleB0 = await kindCount();
            const tB = Date.now();
            const infoB = await orders.orderInfo(`!collectBlocks("${KIND}", 2)`, 180000);
            await sleep(1500);
            const caveB2 = await blockNames(caveStones, [KIND]);
            const cobbleB = await kindCount();
            const saidB = saidLines(s, tB);
            const careful = saidB.filter((l) => l === CAREFUL).length;
            const atB = await entityPos(NAME);
            const health = await entityNumber(NAME, 'Health');
            note(`B: the order ${infoB.done ? `answered after ${(infoB.ms / 1000).toFixed(0)} s` : 'did NOT end within 180 s'}: ${JSON.stringify(String(infoB.reply).slice(0, 200))}; the cave ${KIND} ${JSON.stringify(caveB2)}; ${KIND} in the bag ${cobbleB0} -> ${cobbleB}; the bot at ${fmt(atB)}, health ${health}, deaths ${deaths}; the bot said ${JSON.stringify(saidB.slice(0, 8))}`);
            check(careful === 1, `B1: the bot said \`${CAREFUL}\` exactly once (F10 as the owner changed it: no refusal, one line)`, `${careful} time(s); said ${JSON.stringify(saidB.filter((l) => /cave/i.test(l)).slice(0, 3))}`);
            check(infoB.done && caveB2.filter((n) => n === null).length >= 2 && cobbleB - cobbleB0 >= 2, `B2: two of the cave's ${KIND} are air and the bag has 2 ${KIND} more (server): the ${KIND} in the cave is collected`, `cave ${KIND} left ${caveB2.filter(Boolean).length} of 6, ${KIND} ${cobbleB0} -> ${cobbleB}`);
            check(deaths === 0 && health > 0, 'B3: the bot lives (up again or alive underground, no death)', `deaths ${deaths}, health ${health}, at ${fmt(atB)}`);
            if (!infoB.done && agent.actions.executing) note(`B: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });

            // ---------------------------------------------------------- back to the house, the mine taught
            // T4: first a short way out of the hole to the grass beside the spot (the digging fallback holds for 32 blocks or less)
            const out = await orders.orderInfo(`!goToCoordinates(${spot.x}, ${g + 1}, ${spot.z - 6}, 1)`, 120000);
            const atOut = await entityPos(NAME);
            note(`back: the short way out of the hole to ${cellText({ x: spot.x, y: g + 1, z: spot.z - 6 })} answered after ${(out.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(out.reply).slice(0, 160))}; the bot at ${fmt(atOut)} (${atOut && atOut.y >= g + 0.5 ? 'on the grass' : 'NOT on the grass'})`);
            if (!out.done && agent.actions.executing) note(`back: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            const back = await orders.orderInfo(`!goToCoordinates(${sp.outside.x}, ${sp.outside.y}, ${sp.outside.z - 2}, 1)`, 240000);
            const atBack = await entityPos(NAME);
            const thereBack = Boolean(atBack) && hdist(atBack, { x: sp.outside.x + 0.5, z: sp.outside.z - 1.5 }) <= 3 && atBack.y >= g;
            note(`back: the walk to the house answered after ${(back.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(back.reply).slice(0, 160))}; the bot at ${fmt(atBack)} (${thereBack ? 'there' : 'NOT there'})`);
            check(thereBack, 'precondition of C and D: the bot walked back to the house by itself (out of its hole, 70 blocks west)', fmt(atBack));
            if (!back.done && agent.actions.executing) note(`back: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            const taught = await partTeachMineInRoom({ ...j, b }, { tunnel: t });
            if (!taught.ok) {
                check(false, 'C0: the bot learned the mine and its tunnel (precondition of C and D); the rest is not run');
                return;
            }

            // ---------------------------------------------------------- C. the cave beyond the tunnel's end is walled off
            const beyond0 = await blockNames(beyond, FILLERS);
            const tC = Date.now();
            const orderC = orders.orderInfo('!mineOre("iron", 2)', 300000);
            const patched = await waitFor(async () => { const names = await blockNames(beyond, FILLERS); return names.every(Boolean) ? names : null; }, { ms: 120000, every: 2000 });
            const beyondC = patched.value ?? await blockNames(beyond, [...FILLERS, 'air', 'cave_air']);
            const faceC = await blockNames([{ ...t.beyond(1), y: t.level }, { ...t.beyond(1), y: t.level + 1 }], [...FILLERS, 'air', 'cave_air']);
            const saidC = saidLines(s, tC);
            note(`C: ${((Date.now() - tC) / 1000).toFixed(0)} s after the order: the beyond cells ${beyond.map(cellText).join(' and ')} were ${JSON.stringify(beyond0)} and are ${JSON.stringify(beyondC)}; the rock face ${JSON.stringify(faceC)}; the bot at ${fmt(await entityPos(NAME))}; the bot said ${JSON.stringify(saidC.slice(0, 10))}`);
            check(patched.ok, 'C1: the two cells one block behind the rock face (the `beyond` cells) hold a filler block within 120 s: the mining walled off the cave (F10; v0.1.4.15 turned and patched nothing)', JSON.stringify(beyondC));
            note(`C: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            const infoC = await Promise.race([orderC, sleep(30000).then(() => null)]);
            note(`C: the order ${infoC ? `answered ${JSON.stringify(String(infoC.reply).slice(0, 200))}` : 'did not answer within 30 s of the stop'}`);
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });

            // ---------------------------------------------------------- D. !sealOpening closes a 3 x 3 opening
            const toRoom = await orders.orderInfo(`!goToCoordinates(${sp.roomWait.x}, ${sp.roomWait.y}, ${sp.roomWait.z}, 1)`, 120000);
            const atD = await entityPos(NAME);
            const inRoom = Boolean(atD) && hdist(atD, { x: sp.roomWait.x + 0.5, z: sp.roomWait.z + 0.5 }) <= 2.5 && Math.abs(atD.y - b.room.box.min.y) < 1.5;
            note(`D0: the walk into the room answered ${JSON.stringify(String(toRoom.reply).slice(0, 120))}; the bot at ${fmt(atD)} (${inRoom ? 'in the room' : 'NOT in the room'})`);
            check(inRoom, 'D0: precondition: the bot stands in the room, within reach of its south wall', fmt(atD));
            await commands([`fill ${P(caveD.min)} ${P(caveD.max)} minecraft:air`, `fill ${P(opening.min)} ${P(opening.max)} minecraft:air`]);
            const open0 = await blockNames(openingCells, ['air', 'cave_air']);
            check(open0.every(Boolean), 'D0: precondition: the room\'s south wall has a 3 x 3 opening into a cave', JSON.stringify(open0));
            const cobbleD0 = await cobble();
            const tD = Date.now();
            const sealed = await orders.orderInfo(`!sealOpening(${middle.x}, ${middle.y}, ${middle.z})`, 90000);
            await sleep(1000);
            const cells = await blockNames(openingCells, ['cobblestone']);
            const cobbleD = await cobble();
            const replyD = String(sealed.reply);
            const saidD = saidLines(s, tD);
            const sealedText = `I sealed the opening at ${cellText(middle)} with 9 cobblestone.`;
            note(`D: !sealOpening(${middle.x}, ${middle.y}, ${middle.z}) answered after ${(sealed.ms / 1000).toFixed(0)} s: ${JSON.stringify(replyD.slice(0, 200))}; the 9 cells ${JSON.stringify(cells)}; cobblestone ${cobbleD0} -> ${cobbleD}; the bot said ${JSON.stringify(saidD.slice(0, 4))}`);
            // T4 2026-11-14 (read only, for the report): where the cobblestone went when the 9 cells do not all hold it (the first rerun:
            // only the middle column, 9 out of the bag). The cells x then y (x ox+1..ox+3, y 41..43), on the server and in the bot's
            // view, and the cells in front (the room, z-1) and behind (the cave, z+1) on the server.
            if (!cells.every((n) => n === 'cobblestone')) {
                const NAMES = ['cobblestone', 'air', 'cave_air', 'stone', 'granite', 'dirt', 'torch'];
                const viewOf = (c) => { try { return agent.bot.blockAt(new Vec3(c.x, c.y, c.z))?.name ?? null; } catch { return null; } };
                const serverCells = await blockNames(openingCells, NAMES);
                const front = await blockNames(openingCells.map((c) => ({ ...c, z: c.z - 1 })), NAMES);
                const behind = await blockNames(openingCells.map((c) => ({ ...c, z: c.z + 1 })), NAMES);
                note(`D: the 9 cells on the server ${JSON.stringify(serverCells)}, in the bot's view ${JSON.stringify(openingCells.map(viewOf))}; in front (z ${opening.min.z - 1}) on the server ${JSON.stringify(front)}; behind (z ${opening.min.z + 1}) on the server ${JSON.stringify(behind)}; the bot at ${fmt(await entityPos(NAME))}`);
            }
            check(sealed.done && (replyD === sealedText || saidD.includes(sealedText)), `D1: \`${sealedText}\``, JSON.stringify(replyD.slice(0, 200)));
            check(cells.every((n) => n === 'cobblestone') && cobbleD0 - cobbleD === 9, 'D2: the 9 cells of the opening hold cobblestone and 9 cobblestone left the bag (server)', `${cells.filter(Boolean).length} of 9 cobblestone, bag ${cobbleD0} -> ${cobbleD}`);

            note(`the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 40))}; the bot carries ${itemsText(await inventoryOf(NAME))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(patch).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
