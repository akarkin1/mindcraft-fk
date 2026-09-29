// W42 hunger reflex (v0.1.4.8 spec C2, A11, I7; finding E3).
// Defect of the play test: nothing managed hunger. The bot carried no food, and nothing fetched food from a
// chest or told the player: the food level went from 19 to 0 in the first session and from 9 to 2 in the
// second, while the chests held food. Against v0.1.4.7: the food level stays at 6, nobody goes to the chest.
//
// Base world, the modes of the owner (with the hunger reflex) and the owner's packs, difficulty easy (in
// peaceful the food fills up by itself). The bot learns the chest of the house (the player types !viewChest
// next to it: 12 bread and 64 leaf_litter). Then it stands at the farm, 25 blocks from the chest, without
// food, and its food level is brought to 6 with the effect hunger. No order follows.
//   Within 120 s: the bot walks to the chest of the house and takes bread (the chest holds less bread, server),
//   it eats (its food level is 14 or more, server), no request to the model was needed for it, and the
//   process lives. The text of C2 "I am hungry and carry no food. Food N of 20." may come first; the text
//   "I am starving." must not (it is for food 3 and less).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, sleep, command, commands, orderChannel, entityPos, fmt, startTrace, printTrace, env, saidSince,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, entityNumber, inventoryOf, itemsText, chestItems, hdist } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_hunger';
const PLAYER = 'w_player';

const food = () => entityNumber(NAME, 'foodLevel');

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await placeBot(agent, { x: b.house.chest.x - 1, y: g + 1, z: b.house.chest.z }, -90);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.outsideDoor.x + 10, y: g + 1, z: b.house.outsideDoor.z - 8 } });
            const seen = await orders.order('!viewChest', 30000);
            note(`!viewChest answered ${JSON.stringify(seen.slice(0, 200))}`);
            const known = agent.packContext().chests?.get(b.house.chest);
            check(Boolean(known) && (known.items?.bread || 0) === 12, 'precondition: the bot knows the chest of the house with 12 bread (chest index)', JSON.stringify(known?.items));

            await placeBot(agent, b.farm.outsideChest, 90);
            await commands(['difficulty easy', `gamemode survival ${NAME}`]);
            await command(`effect give ${NAME} minecraft:hunger 120 120 true`);
            const low = await waitFor(async () => (await food()) <= 6, { ms: 60000, every: 150 });
            await command(`effect clear ${NAME} minecraft:hunger`);
            const level0 = await food();
            const inv0 = await inventoryOf(NAME);
            check(low.ok && level0 <= 6, 'precondition: the food level is 6 or lower (hunger effect)', String(level0));
            check(!inv0.bread && Object.keys(inv0).length === 0, 'precondition: the bot carries nothing, no food', itemsText(inv0));
            const t0 = Date.now();
            const requests0 = s.chat.requests.length;
            note(`the bot waits at ${fmt(await entityPos(NAME))}, ${hdist(await entityPos(NAME), b.house.chest).toFixed(0)} blocks from the chest of the house, food ${level0}`);

            const trace = startTrace(async () => ({ pos: await entityPos(NAME), food: await food(), action: agent.actions.currentActionLabel || '-' }), 1000);
            const fed = await waitFor(async () => (await food()) >= 14, { ms: 120000, every: 500 });
            const rows = await trace.stop();
            printTrace('the bot is hungry, no order', rows, { pos: (x) => fmt(x.pos), toChest: (x) => hdist(x.pos, b.house.chest).toFixed(1), food: (x) => x.food, action: (x) => x.action }, 60);
            const chest = await chestItems(b.house.chest);
            const level1 = await food();
            note(`after ${((Date.now() - t0) / 1000).toFixed(1)} s: food ${level0} -> ${level1}; the chest holds ${itemsText(chest)}; the bot carries ${itemsText(await inventoryOf(NAME))}`);
            note(`the bot said: ${JSON.stringify([...s.behavior, ...s.chats].filter((x) => x.t >= t0).map((x) => x.text))}`);
            check((chest?.bread || 0) < 12, 'the bot took bread from the chest of the house (server)', itemsText(chest));
            check(rows.some((x) => x.pos && hdist(x.pos, b.house.chest) <= 5), 'the bot went to the chest of the house by itself');
            check(fed.ok && level1 >= 14, 'the bot ate: its food level is 14 or more (server)', `${level0} -> ${level1}`);
            check(saidSince(s, 'I am starving.', t0).length === 0, 'it did not say "I am starving." (that is for food 3 and less)');
            const requests = s.chat.requests.slice(requests0);
            check(requests.length === 0, 'no request to the model was needed (C2: without a call of the model)', `${requests.length} requests: ${JSON.stringify(requests.map((q) => String(q.turns[q.turns.length - 1]?.content).slice(0, 80)))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`effect clear ${NAME}`, 'difficulty peaceful']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
