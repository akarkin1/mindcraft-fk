// W54 the mine asks (v0.1.4.8 spec E4; findings M1, M3, M5, decision of the owner "the bot asks before it
// digs a new shaft").
// Defect of the play test: !mineOre prepared a whole trip before it moved (57 ladders, torches, food, a chest:
// about 17 logs and 5 to 7 crafting calls, silent) and dug a new shaft wherever it chose, because the pack knew
// only mines it had dug itself (the shaft of the second session went in 6.5 blocks from home). Against
// v0.1.4.7: the bot starts to craft and dig, its inventory changes and the ground around it is dug.
//
// Base world (the owner's mine is dug but the bot's mine store is empty; the house is the place "home"), the
// modes of the owner, the owner's packs. The bot stands 6 blocks north of the house door with the kit of a
// trip without torches (so that "nothing crafted" can be read: the inventory must stay the same). The player types
// !mineOre("iron", 8). Then:
//   - the answer is "I know no mine for iron. I can dig a new one at (x, y, z), N blocks from your house.
//     Tell me to do it, or show me your mine." (E4);
//   - the proposed entrance is on the surface and at least 16 blocks from the place "home" (E4), and N is its
//     distance from the house;
//   - nothing was dug or placed around the bot (a box of 21 x 14 x 21 blocks down to 10 under the ground is as
//     it was), the inventory is the same (nothing crafted, nothing fetched), the bot did not walk away, the
//     mine store is still empty.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, orderChannel, giveItems, entityPos, fmt, MINING_KIT, env, importProject,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, stableInventory, itemsText, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot,
    hdist, distToBox,
} from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_asks';
const PLAYER = 'w_player';
const ASK = /^I know no mine for iron\. I can dig a new one at \((-?\d+), (-?\d+), (-?\d+)\), (\d+) blocks from your house\. Tell me to do it, or show me your mine\.$/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;

        let agent = null, orders = null, snap = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            const spot = { x: b.house.door.x, y: g + 1, z: b.house.door.z - 6 };
            await placeBot(agent, spot, 180);
            orders = await orderChannel(s, { name: PLAYER, at: { x: spot.x + 10, y: g + 1, z: spot.z - 6 } });
            // the kit without torches: the mode torch_placing puts a torch at the feet of an idle bot that carries
            // some (with no torch within 6 blocks, by day too), which would read as "something was placed"
            await giveItems(NAME, MINING_KIT.filter(([n]) => n !== 'torch'), agent.bot);
            const before = await stableInventory(NAME);
            const { whereAmI } = await importProject('src/agent/reflex/where_am_i.js');
            note(`where the bot is: agent.whereAmI() ${JSON.stringify(typeof agent.whereAmI === 'function' ? agent.whereAmI() : 'missing')}, whereAmI(bot) of part A ${JSON.stringify(whereAmI(agent.bot))}, ctx.whereAmI ${JSON.stringify(typeof agent.packContext().whereAmI === 'function' ? agent.packContext().whereAmI() : 'missing')}`);
            check((agent.packContext().mines?.list() ?? []).length === 0, 'precondition: the mine store of the bot is empty');
            snap = await snapshotBox({ min: { x: spot.x - 10, y: g - 10, z: spot.z - 10 }, max: { x: spot.x + 10, y: g + 3, z: spot.z + 10 } });

            const reply = await orders.order('!mineOre("iron", 8)', 120000);
            note(`!mineOre("iron", 8) answered ${JSON.stringify(reply)}`);
            const m = ASK.exec(reply);
            check(Boolean(m), 'the answer is "I know no mine for iron. I can dig a new one at (x, y, z), N blocks from your house. Tell me to do it, or show me your mine." (E4)', JSON.stringify(reply));
            if (m) {
                const entrance = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
                const home = { x: b.house.home.x + 0.5, y: b.house.home.y, z: b.house.home.z + 0.5 };
                note(`the proposed entrance ${fmt(entrance)} is ${hdist(entrance, home).toFixed(1)} blocks from the place home and ${distToBox(entrance, b.house.box).toFixed(1)} from the box of the house; the text says ${m[4]}`);
                check(entrance.y >= g && entrance.y <= g + 2, 'the proposed entrance is on the surface', fmt(entrance));
                check(hdist(entrance, home) >= 16, 'the proposed entrance is at least 16 blocks from the place "home" (E4)', `${hdist(entrance, home).toFixed(1)} blocks`);
                check(Math.abs(Number(m[4]) - hdist(entrance, home)) <= 3, 'N is the distance of the entrance from the house', `N ${m[4]}, distance ${hdist(entrance, home).toFixed(1)}`);
            }
            const after = await stableInventory(NAME);
            const cmp = await compareSnapshot(snap, agent.bot);
            const end = await entityPos(NAME);
            note(`the bot carries ${itemsText(after.items)} (before ${itemsText(before.items)}); it is at ${fmt(end)}`);
            check(JSON.stringify(after.items) === JSON.stringify(before.items), 'the inventory is the same: nothing crafted, nothing fetched', `${itemsText(before.items)} -> ${itemsText(after.items)}`);
            check(cmp.same, 'nothing was dug or placed around the bot (21 x 14 x 21 blocks, down to 10 under the ground)', describeDifferences(cmp.differences));
            check(hdist(end, spot) < 3, 'the bot did not walk away', fmt(end));
            check((agent.packContext().mines?.list() ?? []).length === 0, 'the mine store is still empty');
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
