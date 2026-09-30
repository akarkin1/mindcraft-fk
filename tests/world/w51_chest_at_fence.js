// W51 the chest at the fence (v0.1.4.8 spec E1; finding C4).
// Defect of the play test: the chest of the owner's farm, which stands in the line of the fence, was never
// indexed, and !storeItems could not open it (probably the test for a blocked chest counted the blocks around
// it as solid). Against v0.1.4.7: !storeItems does not store into that chest (it walks to another chest or
// answers that it found no chest with room), and the index does not have it.
//
// Base world, the modes of the owner, the owner's packs. The farm has its chest in the west fence line (a
// fence post replaced by the chest, 4 wheat in it) with a fence post on it: the game opens a chest under a
// fence, the old test for a blocked chest took the fence above for solid (C4). The chest of the house is about
// 30 blocks away. The bot stands outside the fence, 2 blocks west of the chest, and carries 64 dirt and 20 wheat. The
// player types !storeItems. Then:
//   - the chest at the fence opened: items were stored into it (its content grew, server);
//   - the chest index has the chest at the fence with exactly what the server has in it (E1);
//   - the text accounts for all of it: "I stored 64 dirt, 20 wheat in ..." (S3), the bot carries nothing.
// (Which items go into which chest the spec does not say; where they went is noted.)
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, orderChannel, giveItems, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, chestItems, itemsText, inventoryOf } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS, FARM_CHEST_ITEMS, HOUSE_CHEST_ITEMS } from './base_world.js';

const NAME = 'w_fencechest';
const PLAYER = 'w_player';
const at = (p) => `(${p.x}, ${p.y}, ${p.z})`;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const chest = b.farm.chest;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await placeBot(agent, b.farm.outsideChest, 90);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.farm.outsideChest.x + 6, y: g + 1, z: b.farm.outsideChest.z - 10 } });
            await giveItems(NAME, [['dirt', 64], ['wheat', 20]], agent.bot);
            check(JSON.stringify(await chestItems(chest)) === JSON.stringify(FARM_CHEST_ITEMS), 'precondition: the chest at the fence holds 4 wheat', itemsText(await chestItems(chest)));

            const reply = await orders.order('!storeItems', 180000);
            const inChest = await chestItems(chest);
            const inHouse = await chestItems(b.house.chest);
            const inv = await inventoryOf(NAME);
            const entry = agent.packContext().chests?.get(chest) ?? null;
            note(`!storeItems answered ${JSON.stringify(reply)}; the chest at the fence holds ${itemsText(inChest)}; the chest of the house ${itemsText(inHouse)}; the bot carries ${itemsText(inv)}`);
            note(`the index has for the chest at the fence: ${JSON.stringify(entry)}`);
            const grew = Object.entries(inChest ?? {}).reduce((n, [, c]) => n + c, 0) > Object.values(FARM_CHEST_ITEMS).reduce((n, c) => n + c, 0);
            note(`the chest of the house holds ${itemsText(inHouse)} (before ${itemsText(HOUSE_CHEST_ITEMS)}); the text names ${reply.includes(at(chest)) ? 'the chest at the fence' : 'no single chest'}`);
            check(grew, `the chest at the fence ${at(chest)} opened: items were stored into it (server)`, itemsText(inChest));
            check(Boolean(entry) && JSON.stringify(Object.entries(entry.items ?? {}).sort()) === JSON.stringify(Object.entries(inChest ?? {}).sort()),
                'the chest index has the chest at the fence with what the server has in it (E1)', `index ${JSON.stringify(entry?.items)}, server ${JSON.stringify(inChest)}`);
            check(/^I stored 64 dirt, 20 wheat in /.test(reply), 'the text accounts for everything: "I stored 64 dirt, 20 wheat in ..." (S3)', JSON.stringify(reply));
            check(!inv.dirt && !inv.wheat, 'the bot carries no dirt and no wheat', itemsText(inv));
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
