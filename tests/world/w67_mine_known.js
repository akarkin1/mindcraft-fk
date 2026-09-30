// W67 ore from the mine of the player (v0.1.4.9 spec B4, section 1 "!mineOre works in a known mine", 11 TW 3).
// New in v0.1.4.9: with mine_routes !mineOre chooses the nearest known mine with a tunnel for the ore, walks in
// along the route of the mine of the player (door, trapdoor, ladder), digs on at the end of the tunnel, stores in
// the chest of the room, and comes back up the same way. Against v0.1.4.8: the owner's mine is unknown to the
// bot, !mineOre asks for a new mine and, with new_mine, digs a new shaft (W54, finding M3).
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner; the house is
// the place "home". The bot learns the mine as in W65 (the walk in, !rememberMine("mine") at the end of the
// tunnel). 4 blocks of iron ore are put into the rock ahead of the end of the tunnel (2 and 4 blocks beyond it,
// each at the feet and at the head). The bot is put outside in front of the door of the house with the kit of a
// trip. The player types !mineOre("iron", 4):
//   - the answer is the text of M4 "I mined N raw_iron. ..." with N at least 4;
//   - the bot went in and out by the ladder of the shaft (server positions in its column, down and up) and is on
//     the surface at the end, with at least 4 raw_iron (inventory and the chest of the room);
//   - the 4 ore blocks are gone; the tunnel in mines.json is longer than 12 and ends farther south;
//   - no new mine: mines.json holds one mine with the same entrance; nothing around the house on the surface and
//     down to 10 blocks under it was dug or placed (no new shaft).
// Finding of T2 (2026-09-30, left failing): the way in, the digging, the storing and the ore work; the way out does
// not: the ladder leg up through the trapdoor fails as in W62 and the bot stays in the room at y 41, "I could not
// follow the route "mine" at step 5 of 6, at (x, 41, z). Show me the way again." (the same in W68, W69 and W73,
// whose rows of the spec do not ask for the way up).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    walkIntoMine, minesInFile, placeBot, giveItems, MINING_KIT, entityPos, startTrace, printTrace, watchHealth, sleep,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, blockNames, stableInventory, chestItems, itemsText, snapshotBox, compareSnapshot, describeDifferences,
    dropSnapshot,
} from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rknown';
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
        const t = b.tunnel;
        const ores = [2, 4].flatMap((k) => [0, 1].map((dy) => ({ x: t.end.x, y: t.end.y + dy, z: t.end.z + k })));

        let agent = null, orders = null, snap = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });

            const walk = await walkIntoMine(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked into the mine to the end of the tunnel', fmt(walk.at));
            const said = await orders.order('!rememberMine("mine")', 30000);
            note(`!rememberMine("mine") answered ${JSON.stringify(said)}`);
            check(/^I remember the mine "mine":.* one tunnel at level 25, 12 blocks long/.test(said), 'precondition: the mine "mine" is known with its tunnel of 12', JSON.stringify(said));
            const mine0 = minesInFile(agent).find((x) => x.name === 'mine');

            // ---------------------------------------------------------- the trip
            await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
            const start = { x: b.house.door.x, y: g + 1, z: b.house.door.z - 4 };
            await placeBot(agent, start, 180);
            await giveItems(NAME, MINING_KIT, agent.bot);
            // around the house, from 10 blocks under the ground to 3 above it, outside the house and its mine
            snap = await snapshotBox({ min: { x: b.house.box.min.x - 8, y: g - 10, z: b.house.box.min.z - 10 }, max: { x: b.house.box.max.x + 4, y: g + 3, z: b.house.box.min.z - 1 } });
            const health = watchHealth(agent.bot);
            const t0 = Date.now();
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);
            const info = await orders.orderInfo('!mineOre("iron", 4)', 780000);
            const rows = await trace.stop();
            const hp = health.stop();
            printTrace('!mineOre("iron", 4) in the mine of the player', rows, { pos: (x) => fmt(x.pos), action: (x) => x.action }, 80);
            note(`!mineOre("iron", 4) answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply)}`);
            const m = /I mined (\d+) raw_iron\./.exec(info.reply);
            check(Boolean(m) && Number(m[1]) >= 4, 'the answer is the text of M4 "I mined N raw_iron. ..." with at least 4', JSON.stringify(info.reply));
            const firstDown = rows.findIndex((x) => x.pos && Math.floor(x.pos.x) === col.x && Math.floor(x.pos.z) === col.z && x.pos.y < g - 3 && x.pos.y > b.room.box.min.y + 2);
            const deepest = rows.findIndex((x) => x.pos && x.pos.y < t.end.y + 1.5);
            const upAgain = rows.findIndex((x, i) => i > deepest && deepest >= 0 && x.pos && Math.floor(x.pos.x) === col.x && Math.floor(x.pos.z) === col.z && x.pos.y < g - 3 && x.pos.y > b.room.box.min.y + 2);
            check(firstDown >= 0 && deepest > firstDown && upAgain > deepest, 'the bot went down the ladder of the shaft, to the tunnel, and up the same ladder (server)', `down at ${firstDown}, tunnel at ${deepest}, up at ${upAgain}`);
            const end = await entityPos(NAME);
            check(end && end.y >= g + 0.9, 'the bot is on the surface at the end (server)', fmt(end));
            const inv = await stableInventory(NAME);
            const room = await chestItems(b.room.chest);
            note(`the bot carries ${itemsText(inv.items)}; the chest of the room holds ${itemsText(room)}`);
            check((inv.items.raw_iron || 0) + (room?.raw_iron || 0) >= 4, 'at least 4 raw_iron in the inventory and the chest of the room', `inventory ${inv.items.raw_iron || 0}, chest ${room?.raw_iron || 0}`);
            const left = await blockNames(ores, ['iron_ore']);
            check(left.every((x) => x === null), 'the 4 blocks of iron ore are gone (server)', JSON.stringify(left));
            const mines = minesInFile(agent);
            const mine = mines.find((x) => x.name === 'mine');
            const tun = mine?.tunnels?.[0];
            note(`mines.json: ${mines.length} mine(s); the tunnel of "mine": ${JSON.stringify(tun)}`);
            check(Boolean(tun) && tun.length > 12 && tun.end?.z > t.end.z, 'mines.json: the tunnel is longer than 12 and ends farther south', JSON.stringify(tun));
            check(mines.length === 1 && JSON.stringify(mine?.entrance) === JSON.stringify(mine0?.entrance), 'no new mine: one mine in mines.json, the same entrance', `${mines.length} mines, entrance ${JSON.stringify(mine?.entrance)} was ${JSON.stringify(mine0?.entrance)}`);
            const cmp = await compareSnapshot(snap);
            // a torch at the feet of the idle bot is the mode torch_placing (the bot carries torches), not a shaft
            const dug = cmp.differences.filter((d) => !d.stateOnly && !(d.was === 'air' && ['torch', 'wall_torch'].includes(d.now)));
            check(dug.length === 0, 'no new shaft: nothing north of the house, on the surface and down to 10 blocks under it, was dug (torches of the mode torch_placing aside)', describeDifferences(cmp.differences));
            check(hp.min >= 14, 'the bot was not hurt badly on the trip', JSON.stringify(hp.hurt.slice(0, 5)));
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
