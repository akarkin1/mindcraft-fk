// W73 side branches (v0.1.4.9 spec B5, section 11 TW 3).
// New in v0.1.4.9: once a tunnel of a known mine is 32 blocks long, a trip digs side branches before the tunnel
// goes on: at 4, 8, 12, ... blocks from its start, first to the left, then to the right, 8 blocks each, 1 wide and
// 2 high. Against v0.1.4.8: one straight tunnel only.
//
// Base world with the tunnel of the base dug on to 32 blocks (z 2 to 33), the owner's switches and settings, the
// switches of v0.1.4.9 on, the modes of the owner; the house is the place "home". The bot learns the mine as in W65,
// walking to the end of the long tunnel: mines.json holds a tunnel of 32 going south. The left of south is east:
// 2 blocks of iron ore are put at the far end of the first branch to the left (6 and 7 blocks east of the tunnel at
// 4 blocks from its start). The bot starts in the room of the mine with the kit of a trip; the player types
// !mineOre("iron", 2):
//   - the answer is the text of M4 with at least 2 raw_iron;
//   - the first branch is dug to the left (east) at 4 blocks from the start of the tunnel: its cells are open, 1 wide
//     (the stone north and south of it stands) and 2 high (the stone above and below it stands); nothing was dug to
//     the right (west) there; mines.json has the branch at 4 on the left; the tunnel itself is still 32 long.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    walkIntoMine, minesInFile, placeBot, giveItems, MINING_KIT, entityPos, startTrace, printTrace,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rbranch';
const PLAYER = 'w_player';
const LONG = 32;
const OPEN = ['air', 'cave_air', 'torch', 'wall_torch'];

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const t = b.tunnel;
        const end = { x: t.start.x, y: t.start.y, z: t.start.z + LONG - 1 };
        await commands([`fill ${t.end.x} ${t.end.y} ${t.end.z + 1} ${end.x} ${end.y + 1} ${end.z} minecraft:air`]);
        const junction = { x: t.start.x, y: t.start.y, z: t.start.z + 4 };
        const branch = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ x: junction.x + k, y: junction.y, z: junction.z }));
        const ores = [branch[6], branch[7]];

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });

            const walk = await walkIntoMine(agent, orders, b, { end });
            check(walk.ok, 'precondition: the bot walked into the mine to the end of the long tunnel', fmt(walk.at));
            const said = await orders.order('!rememberMine("mine")', 30000);
            note(`!rememberMine("mine") answered ${JSON.stringify(said)}`);
            const tun0 = minesInFile(agent).find((x) => x.name === 'mine')?.tunnels?.[0];
            check(tun0?.length === LONG && tun0.dir === 'south', `precondition: mines.json holds the tunnel of ${LONG} going south`, JSON.stringify(tun0));

            await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
            await placeBot(agent, b.room.middle, 90);
            await giveItems(NAME, MINING_KIT, agent.bot);
            const t0 = Date.now();
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);
            const info = await orders.orderInfo('!mineOre("iron", 2)', 780000);
            printTrace('!mineOre("iron", 2) with a tunnel of 32', await trace.stop(), { pos: (x) => fmt(x.pos), action: (x) => x.action }, 60);
            note(`!mineOre("iron", 2) answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply)}`);
            const m = /I mined (\d+) raw_iron\./.exec(info.reply);
            check(Boolean(m) && Number(m[1]) >= 2, 'the answer is the text of M4 with at least 2 raw_iron', JSON.stringify(info.reply));

            const cells = await blockNames(branch.flatMap((p) => [p, { ...p, y: p.y + 1 }]), ['iron_ore', 'stone', 'cobblestone', ...OPEN]);
            note(`the cells of the first branch to the left (east), feet and head: ${JSON.stringify(cells)}`);
            const dug = branch.filter((p, i) => OPEN.includes(cells[2 * i]) && OPEN.includes(cells[2 * i + 1])).length;
            check(OPEN.includes(cells[0]) && OPEN.includes(cells[1]) && dug >= 4, 'the first branch is dug to the left (east) at 4 blocks from the start of the tunnel (its cells open, feet and head)', `${dug} of 8 cells open`);
            const open = branch.filter((p, i) => OPEN.includes(cells[2 * i]));
            const sides = open.flatMap((p) => [0, 1].flatMap((dy) => [{ x: p.x, y: p.y + dy, z: p.z - 1 }, { x: p.x, y: p.y + dy, z: p.z + 1 }]));
            const floorCeil = open.flatMap((p) => [{ x: p.x, y: p.y - 1, z: p.z }, { x: p.x, y: p.y + 2, z: p.z }]);
            const sideNames = await blockNames(sides, ['stone', 'cobblestone', 'iron_ore', ...OPEN]);
            const fcNames = await blockNames(floorCeil, ['stone', 'cobblestone', 'iron_ore', ...OPEN]);
            check(sideNames.every((x) => !['air', 'cave_air'].includes(x)), 'the branch is 1 wide: the blocks north and south of it stand (torches aside)', JSON.stringify(sideNames));
            check(fcNames.every((x) => !['air', 'cave_air'].includes(x)), 'the branch is 2 high: the blocks under and above it stand', JSON.stringify(fcNames));
            const right = await blockNames([{ x: junction.x - 1, y: junction.y, z: junction.z }, { x: junction.x - 1, y: junction.y + 1, z: junction.z }], ['stone', ...OPEN]);
            check(right.every((x) => x === 'stone'), 'nothing was dug to the right (west) at the junction', JSON.stringify(right));
            const tun = minesInFile(agent).find((x) => x.name === 'mine')?.tunnels?.[0];
            note(`mines.json: the tunnel ${JSON.stringify(tun)}`);
            const left = (tun?.branches ?? []).find((x) => x.at === 4 && x.side === 'left');
            check(Boolean(left), 'mines.json: the tunnel has the branch at 4 on the left', JSON.stringify(tun?.branches));
            check(tun?.length === LONG, `mines.json: the tunnel itself is still ${LONG} long (the branch comes first)`, JSON.stringify(tun?.length));
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
