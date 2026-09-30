// W65 the mine of the player (v0.1.4.9 spec B2, I6, section 1 "The bot learns the mine of the player by walking
// it", 11 TW 3).
// New in v0.1.4.9: the player walks the bot into his mine and says "this is the mine"; !rememberMine("mine") makes
// the mine of the player from the trail (from the last step under open sky), with the room (chest, crafting table,
// furnace) and the tunnel the bot stands in. Against v0.1.4.8: the pack knows only the mines it dug itself; the
// owner's mine is unknown and !mineOre asks for a new one (W54).
//
// Base world with the furnace in the room (base_world.js), the owner's switches and settings, the switches of
// v0.1.4.9 on, the modes of the owner; the house is the place "home". The bot stands outside in front of the door,
// walks into the house (typed !goToCoordinates: the path search opens the door), is moved down the ladder cell by
// cell through the open trapdoor (spec 11 TW 2), and walks down the descent to the end of the tunnel (typed). The
// player types !rememberMine("mine"):
//   - the answer is the text of B2: "I remember the mine "mine": the entrance at (x, y, z), the way in has N steps
//     with 1 ladder, 1 door and 1 trapdoor, the room at level 41 with a chest, a crafting table and a furnace, one
//     tunnel at level 25, 12 blocks long, going south." (the tunnel of the base runs south, HANDOFF part B);
//   - mines.json holds the mine "mine" with source player, the entrance outside the house under open sky, a route
//     with a ladder leg on the shaft and a door leg for the door and for the trapdoor, a room with the chest, the
//     crafting table and the furnace of the base, one tunnel of 12 at level 25 going south from (22, 25, 2);
//   - the place "mine" is the entrance; whereAmI in the tunnel names the mine.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    walkIntoMine, minesInFile, readWorldFile,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rmine';
const PLAYER = 'w_player';
const REMEMBERED = /^I remember the mine "mine": the entrance at \((-?\d+), (-?\d+), (-?\d+)\), the way in has (\d+) steps? with 1 ladder, 1 door and 1 trapdoor, the room at level 41 with a chest, a crafting table and a furnace, one tunnel at level 25, 12 blocks long, going south\.$/;
const same = (a, b) => Boolean(a && b) && a.x === b.x && a.y === b.y && a.z === b.z;
const P = (p) => (p ? `(${p.x}, ${p.y}, ${p.z})` : 'none');

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const col = b.shaft.column;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });

            const walk = await walkIntoMine(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked into the house and, after the ladder, to the end of the tunnel (typed !goToCoordinates)', fmt(walk.at));
            const steps = readWorldFile(agent, 'trail.json').json?.steps ?? [];
            note(`the trail has ${steps.length} steps; the last under open sky: ${JSON.stringify([...steps].reverse().find((st) => st.sky))}`);

            const said = await orders.order('!rememberMine("mine")', 30000);
            note(`!rememberMine("mine") answered ${JSON.stringify(said)}`);
            const m = REMEMBERED.exec(said);
            check(Boolean(m), 'the answer is the text of B2 with 1 ladder, 1 door and 1 trapdoor, the room at level 41 with a chest, a crafting table and a furnace, one tunnel at level 25, 12 blocks long, going south', JSON.stringify(said));

            const mine = minesInFile(agent).find((x) => x.name === 'mine');
            note(`mines.json: ${JSON.stringify(mine)}`);
            check(Boolean(mine) && mine.source === 'player', 'mines.json holds the mine "mine" with source player', JSON.stringify(mine && { name: mine.name, source: mine.source }));
            const ent = mine?.entrance;
            check(ent && ent.y === g + 1 && !inBox(ent, b.house.box) && ent.z < b.house.box.min.z && Math.abs(ent.x - b.house.door.x) <= 3,
                'the entrance is outside the house in front of its door, under open sky', P(ent));
            const legs = mine?.route ?? [];
            note(`the route: ${legs.map((l) => `${l.kind}${l.kind2 ? ' ' + l.kind2 : ''}`).join(', ')}`);
            const ladder = legs.find((l) => l.kind === 'ladder');
            check(Boolean(ladder) && ladder.x === col.x && ladder.z === col.z && ladder.top >= g - 2 && ladder.bottom <= b.room.box.min.y + 1,
                'the route has a ladder leg on the column of the shaft, from the trapdoor down to the room', JSON.stringify(ladder));
            const door = legs.find((l) => l.kind === 'door' && l.kind2 === 'door');
            const trap = legs.find((l) => l.kind === 'door' && l.kind2 === 'trapdoor');
            check(Boolean(door) && same(door, b.house.door), 'the route has a door leg for the door of the house', JSON.stringify(door));
            check(Boolean(trap) && same(trap, b.trapdoor), 'the route has a door leg for the trapdoor', JSON.stringify(trap));
            const room = mine?.room;
            check(Boolean(room) && same(room.chest, b.room.chest) && same(room.table, b.room.table) && same(room.furnace, b.room.furnace) && room.center?.y === b.room.box.min.y,
                'the room has the chest, the crafting table and the furnace of the base, at level 41', JSON.stringify(room));
            const tunnels = mine?.tunnels ?? [];
            const t = tunnels[0];
            check(tunnels.length === 1 && t.length === 12 && t.level === 25 && t.dir === 'south' && same(t.start, b.tunnel.start) && same(t.end, b.tunnel.end),
                'one tunnel of 12 at level 25 going south, from the start of the tunnel of the base to its end', JSON.stringify(tunnels));
            const place = agent.memory_bank.recallPlace('mine');
            check(Array.isArray(place) && ent && Math.floor(place[0]) === ent.x && Math.floor(place[2]) === ent.z, 'the place "mine" is the entrance', JSON.stringify(place));
            const where = agent.whereAmI();
            note(`whereAmI at the end of the tunnel: ${JSON.stringify(where)}`);
            check(where?.underground === true && where?.mine?.name === 'mine' && where.mine.tunnel === 0, 'whereAmI at the end of the tunnel: underground, in the mine "mine", its first tunnel (I7)', JSON.stringify(where));
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
