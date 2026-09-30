// W46 creeper above (v0.1.4.8 spec C3, D2, I2; finding R3, owner's point 3).
// Defect of the play test: the creeper reflex used 3D distances only (24 blocks to see a creeper, 16 to count
// it from the bot or from an area), with no height and no line of sight. The box of the owner's mine (saved as
// a building) ended 5 to 9 blocks under the surface, so creepers walking on the surface counted as "near the
// area" and interrupted the bot deep in the mine (6 interrupts). Against v0.1.4.7: in part 1 the mode
// creeper_safety runs within seconds (the creeper is 22 blocks from the bot and 7 from the box of the mine).
//
// Base world, the modes of the owner, the owner's packs, difficulty normal. The player saves the mine as an
// area of type mine with !setArea (the box of the room, the descent, the landing and the tunnel, up to 6 blocks
// under the surface, as the owner's box). A mine is not defended against creepers (D2).
//   1. The bot in the room at y 41 under the house; a creeper on the surface 20 blocks above it and about 9
//      blocks to the side (22 blocks away, 7 above the box of the mine), with no way down.
//   2. The bot at y 25 in the tunnel (spec row W46); a creeper on the surface right above it (36 blocks).
//   Each: for 30 s the mode creeper_safety does not run, the bot says nothing about the creeper and stays
//   where it is (within 2 blocks). The creeper is killed after each part.
// (Part 2 is the row of the spec; with the surface 35 blocks above the tunnel v0.1.4.7 would not have seen that
// creeper either, so part 1, at the height of the owner's landing, is the one that fails against v0.1.4.7.)
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, entityPos, fmt, command, commands, orderChannel, startTrace, printTrace, sleep, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, dist, entityNumber } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_above';
const PLAYER = 'w_player';
const TAG = 'mcw_above';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const box = { min: b.mineBox.min, max: { ...b.mineBox.max, y: g - 6 } };
        const selector = `@e[type=minecraft:creeper,tag=${TAG},limit=1]`;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await placeBot(agent, b.room.middle, 0);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.outsideDoor.x - 10, y: g + 1, z: b.house.outsideDoor.z - 10 } });
            const set = await orders.order(`!setArea("mine", "mine", ${box.min.x}, ${box.min.y}, ${box.min.z}, ${box.max.x}, ${box.max.y}, ${box.max.z})`, 20000);
            note(`!setArea answered ${JSON.stringify(set)}`);
            check(/Area "mine" \(mine\) saved:/.test(set), 'precondition: the mine is saved as an area of type mine', JSON.stringify(set.slice(0, 200)));
            await commands(['difficulty normal', `gamemode survival ${NAME}`]);

            async function part(label, spot, creeperAt) {
                await placeBot(agent, spot, 0);
                const out = await command(`summon minecraft:creeper ${creeperAt.x + 0.5} ${creeperAt.y} ${creeperAt.z + 0.5} {PersistenceRequired:1b,Tags:["${TAG}"]}`);
                check(out.some((l) => /Summoned new Creeper/.test(l)), `${label}: a creeper is summoned at ${fmt(creeperAt)}`, out.join(' | '));
                const t0 = Date.now();
                const trace = startTrace(async () => ({ bot: await entityPos(NAME), creeper: await entityPos(selector), action: agent.actions.currentActionLabel || '-' }), 500);
                await sleep(30000);
                const rows = await trace.stop();
                await command(`kill ${selector}`);
                printTrace(label, rows, { bot: (x) => fmt(x.bot), creeper: (x) => fmt(x.creeper), toBot: (x) => dist(x.bot, x.creeper).toFixed(1), action: (x) => x.action }, 30);
                const said = [...s.behavior, ...s.chats].filter((x) => x.t >= t0 && /creeper/i.test(x.text)).map((x) => x.text);
                const moved = Math.max(...rows.filter((x) => x.bot).map((x) => dist(x.bot, { x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5 })));
                const near = Math.min(...rows.filter((x) => x.bot && x.creeper).map((x) => dist(x.bot, x.creeper)));
                note(`${label}: the creeper was at least ${near.toFixed(1)} blocks from the bot`);
                check(!rows.some((x) => String(x.action).startsWith('mode:creeper_safety')), `${label}: the mode creeper_safety did not run in 30 s`);
                check(said.length === 0, `${label}: the bot said nothing about the creeper`, JSON.stringify(said));
                check(moved < 2, `${label}: the bot stayed where it was`, `moved up to ${moved.toFixed(1)} blocks`);
            }

            // 1: 20 blocks above the room, 8 blocks east and 3 north of it, between the house and the pen
            await part('1 (room at y 41)', b.room.middle, { x: b.room.middle.x + 8, y: g + 1, z: b.room.middle.z - 3 });
            // 2: right above the bot in the tunnel
            const inTunnel = b.tunnel.cells[4];
            await part('2 (tunnel at y 25)', inTunnel, { x: inTunnel.x, y: g + 1, z: inTunnel.z });

            const health = await entityNumber(NAME, 'Health');
            check(health > 0, 'the bot lives', `health ${health}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[type=minecraft:creeper,x=${r.ox - 150},y=-64,z=${r.oz - 150},dx=300,dy=400,dz=300]`, 'difficulty peaceful']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
