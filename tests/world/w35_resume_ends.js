// W35 resume ends (v0.1.4.8 spec A5; finding S5).
// Defect of the play test: an older !followPlayer came back after a newer command: its resume function stayed
// and ran on when the pack command had ended (or was interrupted); the bot walked after the player again and
// unstuck moved it three times, with no message to the model (L2 735-811). Against v0.1.4.7: after !storeItems
// the bot follows the player again, without an order.
//
// Base world, the modes of the owner and the owner's packs. The bot knows the chest of the house (!viewChest).
//   1. The player types !followPlayer("w_player", 3) and walks away (teleports 12 blocks): the bot follows.
//   2. The bot gets 3 stacks of dirt; the player types !storeItems: the bot stores them in the chest of the
//      house.
//   3. After the answer of !storeItems the player teleports 20 blocks away. For 12 s the bot does not follow:
//      no action followPlayer runs, the bot does not come nearer to the player, it keeps no resume function.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, orderChannel, giveItems, startTrace, printTrace, tp, sleep, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, hdist, chestItems, itemsText, stableInventory } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_resume';
const PLAYER = 'w_player';

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
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.outsideDoor.x, y: g + 1, z: b.house.outsideDoor.z - 3 } });
            const seen = await orders.order('!viewChest', 30000);
            note(`!viewChest answered ${JSON.stringify(seen.slice(0, 200))}`);
            const chestBefore = await chestItems(b.house.chest);

            // ---------------------------------------------------------- 1. follow
            await placeBot(agent, b.house.outsideDoor, 180);
            const follow = orders.orderInfo(`!followPlayer("${PLAYER}", 3)`, 3000);
            await follow;
            const away = { x: b.house.outsideDoor.x + 12, y: g + 1, z: b.house.outsideDoor.z - 6 };
            await tp(PLAYER, away);
            const followed = await waitFor(async () => hdist(await entityPos(NAME), { x: away.x + 0.5, z: away.z + 0.5 }) <= 5, { ms: 30000, every: 250 });
            check(followed.ok, '1: the bot follows the player (it came within 5 blocks of the new place)', fmt(await entityPos(NAME)));
            check(agent.actions.currentActionLabel === 'action:followPlayer', '1: the action followPlayer runs', agent.actions.currentActionLabel);

            // ---------------------------------------------------------- 2. store
            await giveItems(NAME, [['dirt', 192]], agent.bot);
            const store = await orders.orderInfo('!storeItems', 180000);
            // the spec does not say which chest the pack chooses: the one the text names is read
            const named = /in the chest at \((-?\d+), (-?\d+), (-?\d+)\)/.exec(store.reply);
            const chestAfter = named ? await chestItems({ x: Number(named[1]), y: Number(named[2]), z: Number(named[3]) }) : null;
            note(`2: !storeItems answered after ${(store.ms / 1000).toFixed(1)} s: ${JSON.stringify(store.reply)}; the chest it names holds ${itemsText(chestAfter)} (the chest of the house before: ${itemsText(chestBefore)})`);
            check(store.done && /I stored 192 dirt/.test(store.reply), '2: !storeItems stored the 192 dirt ("I stored 192 dirt ...")', JSON.stringify(store.reply));
            check((chestAfter?.dirt || 0) >= 192, '2: the chest that the text names holds the 192 dirt (server)', itemsText(chestAfter));

            // ---------------------------------------------------------- 3. no follow afterwards
            const far = { x: away.x - 20, y: g + 1, z: away.z - 14 };
            await tp(PLAYER, far);
            const t3 = Date.now();
            const bot0 = await entityPos(NAME);
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-', resume: agent.actions.resume_name || '-' }), 400);
            await sleep(12000);
            const rows = await trace.stop();
            printTrace('3: 12 s after !storeItems, the player 20 blocks away', rows, { pos: (x) => fmt(x.pos), toPlayer: (x) => hdist(x.pos, far).toFixed(1), action: (x) => x.action, resume: (x) => x.resume }, 30);
            const nearest = Math.min(...rows.filter((x) => x.pos).map((x) => hdist(x.pos, far)));
            check(!rows.some((x) => x.action === 'action:followPlayer'), '3: no action followPlayer ran after !storeItems (the newer command ended the resume)', `${rows.filter((x) => x.action === 'action:followPlayer').length} samples`);
            check(nearest >= hdist(bot0, far) - 2, '3: the bot did not walk towards the player', `from ${hdist(bot0, far).toFixed(1)} to at least ${nearest.toFixed(1)} blocks`);
            check(!agent.actions.resume_func, '3: the agent keeps no resume function', String(agent.actions.resume_name));
            const inv = await stableInventory(NAME);
            note(`the bot carries ${itemsText(inv.items)}; ${((Date.now() - t3) / 1000).toFixed(1)} s watched`);
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
