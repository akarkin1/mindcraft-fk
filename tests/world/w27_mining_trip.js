// W27 mining trip (spec v0.1.4.7 section 8 "Mining trip", M1 targetLevel, M4 mineOre, M5), deep world:
// mining_pack on, protected_areas on, world_memory on, mining_max_minutes 12.
// Iron ore beside the way: the bot chooses its entrance and its direction itself, so single blocks
// of iron_ore stand in a grid (every 3 blocks in x and z, not touching each other) at y 16 and 17,
// the level of iron (M1: best level 16, 44 blocks under the surface of y 60), within 36 blocks of the
// bot. Any tunnel at that level passes one every 3 steps. The bot carries the kit of a trip.
//   1. !mineOre("iron", 6): the bot comes back to the surface with at least 6 raw_iron, the chest of
//      the mine holds cobblestone, the mine is in the store (level 16), the text of M4.
//   2. !mineOre("iron", 6) again: the same mine (one mine, the same entrance), the bot goes down the
//      same shaft, the tunnel goes on at its end (it is longer), the bot comes back with 6 more.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, placeBot, resetBot, command_, giveItems, entityPos,
    fmt, startTrace, printTrace, MINING_SETTINGS, MINING_KIT, watchHealth, env, commands,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, chestItems, stableInventory, itemsText, hdist } from './world.js';

const NAME = 'w_trip';
const LEVEL = 16;

function firstUnderground(rows, g) {
    const r = rows.find((x) => x.pos && x.pos.y <= g - 1 + 0.01);
    return r ? { x: Math.floor(r.pos.x), z: Math.floor(r.pos.z) } : null;
}

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        check(env.world === 'deep', 'precondition: the scenario runs in the deep world', env.world);
        const ore = [];
        for (let dx = -36; dx <= 36; dx += 3) {
            for (let dz = -36; dz <= 36; dz += 3) {
                for (const y of [LEVEL, LEVEL + 1]) ore.push(`setblock ${r.ox + dx} ${y} ${r.oz + dz} minecraft:iron_ore`);
            }
        }
        await commands(ore, 120000);
        note(`${ore.length} blocks of iron_ore in a grid at y ${LEVEL} and ${LEVEL + 1}`);

        let agent = null;
        try {
            const s = await startAgent(NAME, MINING_SETTINGS);
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox + 1, y: g + 1, z: r.oz + 1 }, 0);
            await giveItems(NAME, MINING_KIT, agent.bot);
            const health = watchHealth(agent.bot);

            // ---------------------------------------------------------- 1. the first trip
            const trace1 = startTrace(async () => ({ pos: await entityPos(NAME) }), 500);
            const t1 = Date.now();
            const reply1 = await command_(agent, '!mineOre("iron", 6)', 900000);
            const rows1 = await trace1.stop();
            printTrace('1: !mineOre("iron", 6)', rows1, { pos: (x) => fmt(x.pos) }, 50);
            note(`1: !mineOre("iron", 6) answered after ${((Date.now() - t1) / 1000).toFixed(1)} s: ${JSON.stringify(reply1)}`);
            const mine1 = agent.packContext().mines?.get('iron') ?? null;
            note(`1: the mine in the store: ${JSON.stringify(mine1 && { entrance: mine1.entrance, level: mine1.level, chest: mine1.chest, direction: mine1.direction, length: mine1.length, end: mine1.end })}`);
            const end1 = await entityPos(NAME);
            const inv1 = await stableInventory(NAME);
            const chest1 = mine1?.chest ? await chestItems(mine1.chest) : null;
            note(`1: the bot is at ${fmt(end1)} and carries ${itemsText(inv1.items)}; the chest of the mine holds ${itemsText(chest1)}`);
            const m1 = /^I mined (\d+) raw_iron\. The mine is at \((-?\d+), (-?\d+), (-?\d+)\), its tunnel is (\d+) blocks long at level (-?\d+)\./.exec(reply1);
            check(Boolean(m1) && Number(m1[1]) >= 6 && Number(m1[6]) === LEVEL, `1: the text of M4 "I mined <n> raw_iron. The mine is at (x, y, z), its tunnel is <n> blocks long at level ${LEVEL}." with at least 6`, JSON.stringify(reply1));
            check(end1 && end1.y >= g + 0.9, '1: the bot came back to the surface', fmt(end1));
            check((inv1.items.raw_iron || 0) >= 6, '1: the bot carries at least 6 raw_iron', `raw_iron ${inv1.items.raw_iron || 0}`);
            check(Boolean(mine1) && mine1.level === LEVEL, `1: the mine is in the store, at level ${LEVEL}`, JSON.stringify(mine1?.level));
            check((chest1?.cobblestone || 0) > 0, '1: the chest of the mine holds the cobblestone', itemsText(chest1));
            // the spec's example stores cobblestone only; a list of several kinds follows the list rule of section 0.1
            const stored1 = /I also stored ((?:\d+ \w+)(?:, \d+ \w+)*(?: and \d+ more kinds)?) in the chest of the mine\./.exec(reply1);
            check(Boolean(stored1) && new RegExp(`\\b${chest1?.cobblestone ?? 'x'} cobblestone\\b`).test(stored1[1]), '1: the text says how much cobblestone was stored in the chest of the mine ("I also stored <n> cobblestone... in the chest of the mine.")', JSON.stringify(reply1));
            const col1 = firstUnderground(rows1, g);
            if (!mine1) return;

            // ---------------------------------------------------------- 2. the second trip
            const ironBefore = (inv1.items.raw_iron || 0) + (chest1?.raw_iron || 0);
            const trace2 = startTrace(async () => ({ pos: await entityPos(NAME) }), 500);
            const t2 = Date.now();
            const reply2 = await command_(agent, '!mineOre("iron", 6)', 900000);
            const rows2 = await trace2.stop();
            printTrace('2: !mineOre("iron", 6) again', rows2, { pos: (x) => fmt(x.pos) }, 50);
            note(`2: !mineOre("iron", 6) answered after ${((Date.now() - t2) / 1000).toFixed(1)} s: ${JSON.stringify(reply2)}`);
            const mines = agent.packContext().mines?.list() ?? [];
            const mine2 = agent.packContext().mines?.get('iron') ?? null;
            note(`2: the mine: ${JSON.stringify(mine2 && { entrance: mine2.entrance, length: mine2.length, end: mine2.end })}; mines in the store: ${mines.length}`);
            const end2 = await entityPos(NAME);
            const inv2 = await stableInventory(NAME);
            const chest2 = mine2?.chest ? await chestItems(mine2.chest) : null;
            const col2 = firstUnderground(rows2, g);
            note(`2: the bot is at ${fmt(end2)} and carries ${itemsText(inv2.items)}; the chest holds ${itemsText(chest2)}; it went under the surface at ${JSON.stringify(col2)} (first trip ${JSON.stringify(col1)})`);
            check(mines.length === 1 && mine2 && JSON.stringify(mine2.entrance) === JSON.stringify(mine1.entrance), '2: the second trip used the same mine (one mine in the store, the same entrance)', `${mines.length} mines`);
            check(col2 && col1 && col2.x === col1.x && col2.z === col1.z, '2: the bot went down the same shaft', `${JSON.stringify(col1)} and ${JSON.stringify(col2)}`);
            check(mine2 && mine2.length > mine1.length, '2: the tunnel went on at its end: it is longer than after the first trip', `${mine1.length} -> ${mine2?.length}`);
            check(mine2?.end && mine1.end && hdist(mine2.end, mine1.base) > hdist(mine1.end, mine1.base), '2: the end of the tunnel is farther from the base than before', `${JSON.stringify(mine1.end)} -> ${JSON.stringify(mine2?.end)}`);
            const ironAfter = (inv2.items.raw_iron || 0) + (chest2?.raw_iron || 0);
            check(ironAfter - ironBefore >= 6, '2: the second trip brought 6 raw_iron more (inventory and chest)', `${ironBefore} -> ${ironAfter}`);
            check(end2 && end2.y >= g + 0.9, '2: the bot came back to the surface', fmt(end2));
            const hp = health.stop();
            check(hp.min >= 20, 'the bot was never hurt on both trips', JSON.stringify(hp.hurt.slice(0, 5)));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
