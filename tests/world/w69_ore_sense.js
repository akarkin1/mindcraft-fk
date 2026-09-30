// W69 ore_sense_range (v0.1.4.9 spec B7, section 2, 11 TW 3).
// New in v0.1.4.9: with ore_sense_range 3 the bot looks 3 blocks into the walls, the floor and the ceiling at every
// step of a tunnel and fetches an ore it senses there with a side cut; with 0 (the default) only the ore that
// touches the tunnel counts, as in v0.1.4.8.
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner; the house is
// the place "home". The bot learns the mine as in W65. The range is set through the settings of the agent (HANDOFF
// part C: W69 and W70 set it there). The bot starts each trip in the room of the mine with the kit of a trip.
//   A  ore_sense_range 0: an iron ore 2 blocks inside the east wall beside the second step beyond the end of the
//      tunnel (one block of stone between), an iron ore in the line of the tunnel 4 steps beyond its end.
//      !mineOre("iron", 1): the ore ahead is taken, the one in the wall stays, the stone between it and the tunnel
//      too.
//   B  ore_sense_range 3: the same, 2 and 4 steps beyond the new end of the tunnel (mines.json). !mineOre("iron", 1):
//      the ore in the wall is taken, the side cut to it is open.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    walkIntoMine, minesInFile, placeBot, giveItems, MINING_KIT, entityPos,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rsense';
const PLAYER = 'w_player';
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

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, settings0149({ ore_sense_range: 0 }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });

            const walk = await walkIntoMine(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked into the mine to the end of the tunnel', fmt(walk.at));
            const said = await orders.order('!rememberMine("mine")', 30000);
            note(`!rememberMine("mine") answered ${JSON.stringify(said)}`);
            check(/^I remember the mine "mine":.* one tunnel at level 25/.test(said), 'precondition: the mine "mine" is known with its tunnel', JSON.stringify(said));
            await giveItems(NAME, MINING_KIT, agent.bot);

            async function trip(label, range) {
                s.settings.ore_sense_range = range;
                const end = minesInFile(agent).find((x) => x.name === 'mine')?.tunnels?.[0]?.end ?? t.end;
                const hidden = { x: end.x + 2, y: end.y, z: end.z + 2 };
                const between = [{ x: end.x + 1, y: end.y, z: end.z + 2 }, { x: end.x + 1, y: end.y + 1, z: end.z + 2 }];
                const ahead = { x: end.x, y: end.y, z: end.z + 4 };
                await commands([`setblock ${hidden.x} ${hidden.y} ${hidden.z} minecraft:iron_ore`, `setblock ${ahead.x} ${ahead.y} ${ahead.z} minecraft:iron_ore`]);
                note(`${label}: ore_sense_range ${s.settings.ore_sense_range}; the end of the tunnel (${end.x}, ${end.y}, ${end.z}); the ore in the wall (${hidden.x}, ${hidden.y}, ${hidden.z}), the ore ahead (${ahead.x}, ${ahead.y}, ${ahead.z})`);
                await placeBot(agent, b.room.middle, 90);
                const t0 = Date.now();
                const info = await orders.orderInfo('!mineOre("iron", 1)', 600000);
                note(`${label}: !mineOre("iron", 1) answered after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply)}; the bot is at ${fmt(await entityPos(NAME))}`);
                const got = await blockNames([hidden, ahead, ...between], ['iron_ore', 'stone', ...OPEN]);
                note(`${label}: the ore in the wall is ${got[0]}, the ore ahead is ${got[1]}, the blocks between the wall ore and the tunnel are ${got[2]} and ${got[3]}`);
                check(/I mined \d+ raw_iron\./.test(info.reply), `${label}: the trip mined iron (the text of M4)`, JSON.stringify(info.reply));
                return got;
            }

            // ---------------------------------------------------------- A: range 0
            const a = await trip('A', 0);
            check(a[0] === 'iron_ore', 'A: ore_sense_range 0: the ore 2 blocks inside the wall stays', String(a[0]));
            check(a[1] !== 'iron_ore', 'A: the ore placed ahead in the line of the tunnel is taken instead', String(a[1]));
            check(a[2] === 'stone' && a[3] === 'stone', 'A: the stone between the wall ore and the tunnel is not dug', `${a[2]}, ${a[3]}`);

            // ---------------------------------------------------------- B: range 3
            const bb = await trip('B', 3);
            check(bb[0] !== 'iron_ore', 'B: ore_sense_range 3: the ore 2 blocks inside the wall is taken', String(bb[0]));
            check(OPEN.includes(bb[2]), 'B: the side cut to it is open (1 wide, left open)', `${bb[2]}, ${bb[3]}`);
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
