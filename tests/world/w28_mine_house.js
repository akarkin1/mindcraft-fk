// W28 protected house and mine (spec v0.1.4.7 section 8 "Protected house and mine", M4 rules, A of
// v0.1.4.6), deep world: mining_pack on, protected_areas on, world_memory on. A house of planks is
// saved as the protected area "home". The bot stands 5 blocks west of it; single blocks of coal_ore
// stand every 3 blocks at y 50 to 55 around it (the level of coal is 8 under the surface).
// !mineOre("coal", 1, true): the bot chooses the entrance of its mine itself.
//   - the entrance of the mine is at least 16 blocks from the house (on the ground, from the middle of
//     the block to the box of the house; v0.1.4.8 E4, it was 8 in v0.1.4.7, Amendment 1 part M), and so
//     is the place where the bot went under the surface;
//   - no block of the house changed, and nothing under the house and within 7 blocks of it changed
//     from the level of the mine up to the ground (no shaft, no staircase, no tunnel there);
//   - the trip ended: the bot is on the surface with the coal, the mine is in the store.
// v0.1.4.8 (W30): the modes of the owner are on (MODES_PROFILE, with the home reflexes) and the order is typed by
// the player in the chat, with new_mine true: without it the bot asks and digs nothing (E4, see W54).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, placeBot, resetBot, command_, giveItems, entityPos,
    fmt, startTrace, MINING_SETTINGS, MINING_KIT, env, commands, withModes, orderChannel,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, snapshotBox, compareSnapshot, describeDifferences,
    dropSnapshot, stableInventory, itemsText,
} from './world.js';

const NAME = 'w_minehouse';

// Horizontal distance from the middle of a block to a box of blocks.
function groundDistance(p, box) {
    const x = p.x + 0.5, z = p.z + 0.5;
    const dx = Math.max(box.min.x - x, 0, x - (box.max.x + 1));
    const dz = Math.max(box.min.z - z, 0, z - (box.max.z + 1));
    return Math.hypot(dx, dz);
}

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        check(env.world === 'deep', 'precondition: the scenario runs in the deep world', env.world);
        const h = housePlan(r.ox, r.oz - 3, g);
        await buildHouse(h);
        const ore = [];
        for (let dx = -30; dx <= 30; dx += 3) {
            for (let dz = -30; dz <= 30; dz += 3) for (let y = 50; y <= 55; y += 5) ore.push(`setblock ${r.ox + dx} ${y} ${r.oz + dz} minecraft:coal_ore`);
        }
        await commands(ore, 120000);
        const under = { min: { x: h.box.min.x - 7, y: 48, z: h.box.min.z - 7 }, max: { x: h.box.max.x + 7, y: g - 1, z: h.box.max.z + 7 } };

        let agent = null, orders = null;
        const snaps = [];
        try {
            const s = await startAgent(NAME, withModes(MINING_SETTINGS));
            agent = s.agent;
            orders = await orderChannel(s, { at: { x: r.ox - 30, y: g + 1, z: r.oz + 30 } });
            await resetBot(NAME);
            await placeBot(agent, h.inside, 0);
            const { min, max } = h.box;
            const set = await command_(agent, `!setArea("home", "building", ${min.x}, ${min.y}, ${min.z}, ${max.x}, ${max.y}, ${max.z})`, 20000);
            check(set.includes('Area "home" (building) saved:'), 'precondition: the house is saved as the protected area "home"', JSON.stringify(set.slice(0, 200)));
            const start = { x: h.box.min.x - 5, y: g + 1, z: h.box.min.z + 3 };
            await placeBot(agent, start, 90);
            note(`the bot stands at ${fmt(start)}, ${groundDistance(start, h.box).toFixed(1)} blocks from the house`);
            await giveItems(NAME, MINING_KIT, agent.bot);
            snaps.push(await snapshotBox(h.box));
            snaps.push(await snapshotBox(under)); // a copy of its own, south of the region (world.js)

            const trace = startTrace(async () => ({ pos: await entityPos(NAME) }), 300);
            const reply = await orders.order('!mineOre("coal", 1, true)', 600000);
            const rows = await trace.stop();
            note(`!mineOre("coal", 1, true) answered ${JSON.stringify(reply)}`);
            const mine = agent.packContext().mines?.get('coal') ?? null;
            note(`the mine: ${JSON.stringify(mine && { entrance: mine.entrance, level: mine.level, base: mine.base, direction: mine.direction, route: mine.route })}`);
            const firstDown = rows.find((x) => x.pos && x.pos.y <= g - 1 + 0.01);
            const col = firstDown ? { x: Math.floor(firstDown.pos.x), z: Math.floor(firstDown.pos.z) } : null;
            check(Boolean(mine), 'the mine is in the store');
            if (mine) check(groundDistance(mine.entrance, h.box) >= 16, 'the entrance of the mine is at least 16 blocks from the house (E4)', `${groundDistance(mine.entrance, h.box).toFixed(1)} blocks, entrance ${JSON.stringify(mine.entrance)}`);
            check(col && groundDistance(col, h.box) >= 16, 'the bot went under the surface at least 16 blocks from the house (E4)', `${col ? groundDistance(col, h.box).toFixed(1) : '?'} blocks at ${JSON.stringify(col)}`);
            const cmpHouse = await compareSnapshot(snaps[0], agent.bot);
            check(cmpHouse.same, 'every block of the house is there', describeDifferences(cmpHouse.differences));
            const cmpUnder = await compareSnapshot(snaps[1], agent.bot);
            check(cmpUnder.identical, 'nothing under the house and within 7 blocks of it changed, from y 48 up to the ground (no shaft, no stairs, no tunnel there)', describeDifferences(cmpUnder.differences));
            const end = await entityPos(NAME);
            const inv = await stableInventory(NAME);
            note(`the bot is at ${fmt(end)} and carries ${itemsText(inv.items)}`);
            check(/^I mined \d+ coal\./.test(reply) && (inv.items.coal || 0) >= 1, 'the trip ended with coal: "I mined <n> coal." and coal in the inventory', JSON.stringify(reply.slice(0, 120)));
            check(end && end.y >= g + 0.9, 'the bot came back to the surface', fmt(end));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            for (const sn of snaps) await dropSnapshot(sn).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
