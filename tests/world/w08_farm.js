// W08 farm (spec section 8 "Farm", A4 canBreak/canPlace inside a farm, section 6 !setArea):
// protected_areas on, world_memory on. A fenced field with farmland, water, ripe wheat (age 7) and
// young wheat (age 2) is saved as the farm "wheat_farm" with !setArea (so this scenario does not
// depend on the scan). The bot stands inside on the farmland. Through the guarded bot:
//   ripe wheat can be broken, the fence cannot, seeds can be planted, dirt cannot be placed.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    waitFor, sleep, command,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, farmPlan, buildFarm, blockIs } from './world.js';

const NAME = 'w_farm';

async function attempt(fn) {
    try { await fn(); return null; } catch (e) { return e; }
}

await scenarioMain({
    async main() {
        const r = region(32);
        const g = r.g;
        await prepareRegion(r);
        const f = farmPlan(r.ox - 5, r.oz - 5, g);
        await buildFarm(f);

        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, f.inside, 0);
            const { min, max } = f.box;
            const set = await command_(agent, `!setArea("wheat_farm", "farm", ${min.x}, ${g - 1}, ${min.z}, ${max.x}, ${g + 3}, ${max.z})`, 20000);
            note(`!setArea: ${JSON.stringify(set)}`);
            check(set.includes('Area "wheat_farm" (farm) saved:'), 'precondition: !setArea saved the field as the farm "wheat_farm"', JSON.stringify(set.slice(0, 200)));
            const bot = agent.bot;
            const at = (p) => bot.blockAt(new Vec3(p.x, p.y, p.z));
            const explain = (p) => `The block at (${p.x}, ${p.y}, ${p.z}) belongs to the protected area "wheat_farm". I do not break or place blocks there.`;

            // ripe wheat can be broken
            const ripe = f.ripe[2];
            check(at(ripe)?.name === 'wheat' && await blockIs(ripe, 'wheat[age=7]'), 'ripe wheat (age 7) stands in the farm');
            const e1 = await attempt(() => bot.dig(at(ripe), true));
            const broken = await waitFor(async () => !(await blockIs(ripe, 'wheat')), { ms: 5000 });
            check(!e1 && broken.ok, 'inside the farm: ripe wheat can be broken (server: the wheat is gone)', e1 ? `${e1.name}: ${e1.message}` : '');

            // the fence cannot
            const fence = at(f.fence);
            check(fence?.name === 'oak_fence', 'a fence post of the farm is in reach', String(fence?.name));
            const e2 = await attempt(() => bot.dig(fence, true));
            await sleep(800);
            check(e2 && e2.name === 'ProtectedAreaError', 'inside the farm: breaking the fence is refused with a ProtectedAreaError', e2 ? `${e2.name}: ${e2.message}` : 'no error, the dig went through');
            check(e2 && e2.message === explain(f.fence), 'the error text names the block and the farm (A4 explain)', e2 ? JSON.stringify(e2.message) : '');
            check(await blockIs(f.fence, 'oak_fence'), 'the fence is still there (server)');

            // seeds can be planted
            const soil = f.empty[0]; // farmland without a crop, x+1 of the row of the bot
            const above = { x: soil.x, y: soil.y + 1, z: soil.z };
            await command(`give ${NAME} minecraft:wheat_seeds 4`);
            await waitFor(() => bot.inventory.items().some((i) => i.name === 'wheat_seeds'), { ms: 5000 });
            await bot.equip(bot.inventory.items().find((i) => i.name === 'wheat_seeds'), 'hand');
            const e3 = await attempt(() => bot.placeBlock(at(soil), new Vec3(0, 1, 0)));
            const planted = await waitFor(() => blockIs(above, 'wheat'), { ms: 5000 });
            check(!e3 || e3.name !== 'ProtectedAreaError', 'inside the farm: planting seeds is not refused', e3 ? `${e3.name}: ${e3.message}` : '');
            check(planted.ok, 'inside the farm: the seeds are planted (server: wheat on the farmland)', e3 ? `${e3.name}: ${e3.message}` : '');

            // dirt cannot be placed
            const soil2 = f.empty[3];
            const above2 = { x: soil2.x, y: soil2.y + 1, z: soil2.z };
            await command(`give ${NAME} minecraft:dirt 4`);
            await waitFor(() => bot.inventory.items().some((i) => i.name === 'dirt'), { ms: 5000 });
            await bot.equip(bot.inventory.items().find((i) => i.name === 'dirt'), 'hand');
            const e4 = await attempt(() => bot.placeBlock(at(soil2), new Vec3(0, 1, 0)));
            await sleep(800);
            check(e4 && e4.name === 'ProtectedAreaError', 'inside the farm: placing dirt is refused with a ProtectedAreaError', e4 ? `${e4.name}: ${e4.message}` : 'no error');
            check(e4 && e4.message === explain(above2), 'the error text names the target block (reference block plus face)', e4 ? JSON.stringify(e4.message) : '');
            check(await blockIs(above2, 'air'), 'no dirt was placed (server: air above the farmland)');

            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
