// W66 "dig here" (v0.1.4.9 spec B3, section 11 TW 3).
// New in v0.1.4.9: standing in a tunnel of his mine the player says "dig here"; !rememberTunnel measures the
// corridor the bot stands in (its start where it leaves the room, its end before the rock, its direction by the
// look of the player) and keeps it as a tunnel of the mine, where the bot digs on when it is asked for ore.
// Against v0.1.4.8: there is no such command; the pack knows only the tunnel it dug itself.
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner; the house is
// the place "home". The bot learns the mine as in W65 (the walk in, !rememberMine("mine") at the end of the
// tunnel). Then it stands in the middle of the tunnel, and the player, on the surface, looks south along it:
//   1. !rememberTunnel answers the text of B3: "I measured the tunnel: it starts at (22, 25, 2), goes south, and
//      ends at (22, 25, 13) after 12 blocks, at level 25. I dig on at its end when you ask for ore." (the
//      coordinates of the region; the tunnel of the base runs south, HANDOFF part B); mines.json keeps one tunnel.
//   2. The player digs the tunnel 4 blocks further (the console); !rememberTunnel again measures 16 blocks and
//      replaces the tunnel (the same start): mines.json keeps one tunnel of 16 with the new end.
// Seen by T2 (2026-09-30): with the player only teleported to look south (no look of its own client), the agent saw
// its yaw as 0 (north) in 2 of 4 runs while the server had south, and measured "goes north" from the end of the
// tunnel into the landing (15 blocks), a second tunnel in mines.json. The player now turns by itself, as a player
// does; the note of the yaw stays. In the re-run after the fix round the agent still saw 0 once after the turn, and
// the answer was right: a yaw that points towards the room is ignored (F6, DECISIONS.md).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    walkIntoMine, minesInFile, placeBot, tp, sleep,
} from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rtunnel';
const PLAYER = 'w_player';
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const measured = (start, end, n) => `I measured the tunnel: it starts at ${P(start)}, goes south, and ends at ${P(end)} after ${n} blocks, at level 25. I dig on at its end when you ask for ore.`;

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
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            const playerAt = { x: t.cells[6].x, y: g + 1, z: t.cells[6].z };
            orders = await orderChannel(s, { name: PLAYER, at: playerAt });

            const walk = await walkIntoMine(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked into the mine to the end of the tunnel', fmt(walk.at));
            const said = await orders.order('!rememberMine("mine")', 30000);
            note(`!rememberMine("mine") answered ${JSON.stringify(said)}`);
            check(/^I remember the mine "mine":/.test(said), 'precondition: the mine "mine" is known', JSON.stringify(said));

            // ---------------------------------------------------------- 1. in the tunnel, the player looks south
            await placeBot(agent, t.cells[5], 180);
            await tp(PLAYER, playerAt, 0, 0); // yaw 0 of the server: the player looks south, along the tunnel
            // and turns there as a player does (a look of its own client): a player that stands still after a teleport
            // is seen by the agent with the yaw of before (seen on the test server: 0, north, while the server had south)
            await orders.player.look(Math.PI / 2, 0, true);
            await sleep(300);
            await orders.player.look(Math.PI, 0, true);
            await sleep(1000);
            const rot = (await commands([`data get entity ${PLAYER} Rotation`]))[0].find((l) => /entity data/.test(l)) ?? '?';
            note(`the yaw of the player: the server ${rot.replace(/^.*entity data: /, '')}; its own view ${orders.player.entity?.yaw}; the agent sees ${agent.bot.players?.[PLAYER]?.entity?.yaw} (mineflayer: 0 is north, pi south)`);
            const one = await orders.order('!rememberTunnel', 30000);
            note(`!rememberTunnel answered ${JSON.stringify(one)}`);
            check(one === measured(t.start, t.end, 12), 'the answer is the text of B3 with the start, south, the end, 12 blocks, level 25', `${JSON.stringify(one)}, expected ${JSON.stringify(measured(t.start, t.end, 12))}`);
            const mine1 = minesInFile(agent).find((x) => x.name === 'mine');
            note(`mines.json: the tunnels of the mine "mine": ${JSON.stringify(mine1?.tunnels)}`);
            check((mine1?.tunnels ?? []).length === 1 && mine1.tunnels[0].length === 12 && mine1.tunnels[0].dir === 'south', 'mines.json: the mine keeps one tunnel of 12 going south', JSON.stringify(mine1?.tunnels));

            // ---------------------------------------------------------- 2. the tunnel 4 blocks longer
            const end2 = { x: t.end.x, y: t.end.y, z: t.end.z + 4 };
            await commands([`fill ${t.end.x} ${t.end.y} ${t.end.z + 1} ${end2.x} ${end2.y + 1} ${end2.z} minecraft:air`]);
            await sleep(1000);
            const two = await orders.order('!rememberTunnel', 30000);
            note(`!rememberTunnel after the tunnel was dug 4 blocks further answered ${JSON.stringify(two)}`);
            check(two === measured(t.start, end2, 16), 'the tunnel is measured again: 16 blocks, the new end', `${JSON.stringify(two)}, expected ${JSON.stringify(measured(t.start, end2, 16))}`);
            const mine2 = minesInFile(agent).find((x) => x.name === 'mine');
            const tun = mine2?.tunnels ?? [];
            check(tun.length === 1 && tun[0].length === 16 && tun[0].end?.z === end2.z, 'mines.json: the tunnel with the same start is replaced: one tunnel of 16 with the new end', JSON.stringify(tun));
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
