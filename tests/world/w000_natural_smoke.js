// W000 the natural world (v0.1.4.14, fix round): the proof that the world type `natural` works, not a test of the
// bot. A generated world of the fixed seed (mc_server.js NATURAL_SEED, README "World types"): no base, no chest, no
// region; the runner gives the scenario the world spawn (env.spawn).
//   1. The player bot (creative) stands at the spawn, loads the chunks around it and reports the oak trees within
//      64 blocks (treesNear of helpers.js: trunks, fallen trunks on the ground, branches, leaves): the world offers
//      trees, at least one fallen trunk, and the ground rises and falls (the highest and the lowest top block).
//   2. The bot (the agent, every new switch off) spawns near the world spawn; `!stats` answers with its biome.
//   3. Throughout: the process lives, no request reached a real model.
// Nothing is built, dug or placed; the scenario leaves the world as it found it.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, env, sleep, commands, entityPos, fmt,
    connectPlayer, quitPlayer, command_, treesNear, chunksMissing, waitFor,
} from './helpers.js';
import { hdist } from './world.js';

const NAME = 'w_natural';
const PLAYER = 'w_player';
const RADIUS = 64;
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;

// The top solid block (no leaves, no log) of a column, from the player bot's view; null when none is loaded.
function topBlock(bot, x, z) {
    for (let y = 200; y > -64; y--) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (b && b.boundingBox === 'block' && !/leaves$|_log$/.test(b.name)) return y;
    }
    return null;
}

await scenarioMain({
    async main() {
        check(env.world === 'natural', 'precondition: the scenario runs in the natural world', env.world);
        const spawn = env.spawn;
        check(spawn !== null && spawn !== undefined, 'the runner gives the scenario the world spawn (MCW_SPAWN)', JSON.stringify(spawn));
        if (!spawn) return;
        let player = null;
        let agent = null;
        try {
            // ---------------------------------------------------------- 1. what the world offers
            player = await connectPlayer(PLAYER);
            await commands([`gamemode creative ${PLAYER}`, `tp ${PLAYER} ${spawn.x + 0.5} ${spawn.y} ${spawn.z + 0.5}`]);
            await sleep(1000);
            await player.waitForChunksToLoad();
            // the chunks keep coming for some seconds after the spawn: wait until every chunk within the radius is there
            const loaded = await waitFor(() => chunksMissing(player, spawn, RADIUS).length === 0, { ms: 30000, every: 250 });
            const missing = chunksMissing(player, spawn, RADIUS);
            note(`the chunks within ${RADIUS} blocks were all there after ${(loaded.ms / 1000).toFixed(1)} s`);
            check(missing.length === 0, `the player bot has every chunk within ${RADIUS} blocks of the spawn`, missing.length ? `${missing.length} missing: ${JSON.stringify(missing.slice(0, 5))}` : 'all loaded');
            const t = treesNear(player, spawn, RADIUS);
            const nearest = t.trunks.map((x) => ({ ...x, d: hdist(x.base, spawn) })).sort((a, b) => a.d - b.d)[0] ?? null;
            note(`within ${RADIUS} blocks of the spawn ${P(spawn)}: ${t.logs} oak logs, ${t.trunks.length} trunks (${t.trunks.filter((x) => x.height >= 3).length} of 3 logs or more), `
                + `${t.fallen.length} fallen trunks, ${t.branches.length} branches, ${t.leaves} oak leaves`);
            if (nearest) note(`the nearest trunk: ${P(nearest.base)}, ${nearest.height} logs high, ${nearest.d.toFixed(1)} blocks from the spawn`);
            for (const f of t.fallen) note(`a fallen trunk: ${f.length} logs along ${f.axis} from ${P(f.from)} to ${P(f.to)}, ${hdist(f.from, spawn).toFixed(1)} blocks from the spawn`);
            check(t.trunks.filter((x) => x.height >= 3).length >= 10, `the world offers oak trees within ${RADIUS} blocks of the spawn (10 trunks or more)`, `${t.trunks.length} trunks`);
            check(t.fallen.length >= 1, `the world offers a fallen trunk on the ground within ${RADIUS} blocks`, `${t.fallen.length} fallen trunks`);
            check(t.leaves > 0, 'the trees have leaves', String(t.leaves));
            const tops = [];
            for (let dx = -RADIUS; dx <= RADIUS; dx += 8) {
                for (let dz = -RADIUS; dz <= RADIUS; dz += 8) {
                    if (dx * dx + dz * dz <= RADIUS * RADIUS) tops.push(topBlock(player, spawn.x + dx, spawn.z + dz));
                }
            }
            const known = tops.filter((y) => y !== null);
            const low = Math.min(...known), high = Math.max(...known);
            note(`the ground within ${RADIUS} blocks (every 8 blocks, ${known.length} columns): from y ${low} to y ${high}`);
            check(known.length > 0 && high - low >= 8, 'the ground is not flat: a hill of 8 blocks or more', `y ${low} to ${high}`);

            // ---------------------------------------------------------- 2. the bot in the natural world
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF });
            agent = s.agent;
            const at = await entityPos(NAME);
            check(at !== null && hdist(at, spawn) <= 32, 'the bot spawned near the world spawn (server)', `${fmt(at)}, the spawn ${P(spawn)}`);
            const stats = await command_(agent, '!stats', 30000);
            const biome = /- Biome: (\S+)/.exec(stats)?.[1] ?? null;
            note(`!stats: ${JSON.stringify(stats.split('\n').filter((l) => /Position|Biome|Dimension/.test(l)))}`);
            check(biome !== null && biome !== 'undefined', '!stats answers with the biome', String(biome));

            // ---------------------------------------------------------- 3. throughout
            check(s.killed === null, 'the process of the agent lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await quitPlayer(player);
        }
    },
});
exitSoon();
