// W41 off-hand food (v0.1.4.8 spec B2, C1, I7; finding E1).
// Defect of the play test: auto-eat (with offhand: true) moved the whole stack of food into slot 45, the off-
// hand, and left it there. !eat, !consume and the mining pack saw only the slots 9 to 44, so "apple: 1" stood
// beside "I have no food." and the bot starved with food in its hand. Against v0.1.4.7: !eat answers "I have
// no food." with 6 bread in the off-hand, and !inventory does not say where the bread is.
//
// Flat world, the modes of the owner (home_pack on), difficulty easy (in peaceful the food fills up by
// itself). The food level is brought to 16 with the effect hunger: above 14, so neither the plugin nor the
// hunger reflex eats by itself (C2), and !eat still eats (up to 18). 6 bread are put into the off-hand
// (slot 45) through the console, nothing else in the inventory.
//   1. The auto-eat options have offhand false (C1).
//   2. !inventory names the off-hand: "In the off-hand: bread 6" (B2).
//   3. !eat eats from it: "I ate 1 bread. Food 20 of 20, health 20 of 20." (C1), the food level is 20 and 5
//      bread are left (server, inventory and equipment together).
//   4. !inventory counts the 5 bread once.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, sleep, command, commands, orderChannel,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, entityNumber, inventoryOf, itemsText } from './world.js';

const NAME = 'w_offhand';
const PLAYER = 'w_player';

const food = () => entityNumber(NAME, 'foodLevel');

// Lowers the food level with hunger until it is at most `to`, then removes the effect.
async function starve(to) {
    await command(`effect give ${NAME} minecraft:hunger 120 120 true`);
    const done = await waitFor(async () => (await food()) <= to, { ms: 60000, every: 150 });
    await command(`effect clear ${NAME} minecraft:hunger`);
    await sleep(300);
    return { ok: done.ok, level: await food() };
}

await scenarioMain({
    async main() {
        const r = region(24);
        const g = r.g;
        await prepareRegion(r);
        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, ...FLAGS_0148_OFF, world_memory: true }));
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, 0);
            orders = await orderChannel(s, { name: PLAYER, at: { x: r.ox + 8, y: g + 1, z: r.oz } });
            await commands(['difficulty easy', `gamemode survival ${NAME}`]);

            // ---------------------------------------------------------- 1. the options of auto-eat
            const o = agent.bot.autoEat?.options || {};
            note(`1: bot.autoEat.options ${JSON.stringify(o)}`);
            check(o.offhand === false, '1: the auto-eat options have offhand false (C1)', String(o.offhand));

            // ---------------------------------------------------------- the food level 16, bread in the off-hand
            const st = await starve(16);
            check(st.ok && st.level >= 15 && st.level <= 16, 'precondition: the food level is 15 or 16 (above 14: nothing eats by itself)', String(st.level));
            const out = await command(`item replace entity ${NAME} weapon.offhand with minecraft:bread 6`);
            check(out.some((l) => /Replaced a slot/.test(l)), 'precondition: 6 bread are put into the off-hand (console)', out.join(' | '));
            const inOff = await waitFor(() => agent.bot.inventory.slots[45]?.name === 'bread' && agent.bot.inventory.slots[45]?.count === 6, { ms: 5000, every: 50 });
            check(inOff.ok, 'precondition: the bot sees 6 bread in slot 45 (the off-hand)', JSON.stringify(agent.bot.inventory.slots[45] && { name: agent.bot.inventory.slots[45].name, count: agent.bot.inventory.slots[45].count }));
            await sleep(2500); // the reflexes look every 2 s: nothing may eat at 16
            check((await inventoryOf(NAME)).bread === 6, 'precondition: at food 16 nothing ate by itself (6 bread)', itemsText(await inventoryOf(NAME)));

            // ---------------------------------------------------------- 2. !inventory names the off-hand
            const inv1 = await orders.order('!inventory', 20000);
            note(`2: !inventory answered ${JSON.stringify(inv1)}`);
            check(inv1.includes('In the off-hand: bread 6'), '2: !inventory names the off-hand: "In the off-hand: bread 6" (B2)', JSON.stringify(inv1.slice(0, 300)));
            check(/- bread: 6\b/.test(inv1), '2: the list of !inventory counts the 6 bread of the off-hand once ("- bread: 6")', JSON.stringify(inv1.slice(0, 300)));

            // ---------------------------------------------------------- 3. !eat eats from the off-hand
            const before = await food();
            const ate = await orders.order('!eat', 45000);
            await waitFor(async () => (await food()) >= 20, { ms: 5000, every: 200 });
            const after = await food();
            const invAfter = await inventoryOf(NAME);
            note(`3: food ${before} -> ${after}; !eat answered ${JSON.stringify(ate)}; the bot carries ${itemsText(invAfter)}`);
            check(ate.includes('I ate 1 bread. Food 20 of 20, health 20 of 20.'), '3: !eat answers "I ate 1 bread. Food 20 of 20, health 20 of 20." (C1)', JSON.stringify(ate));
            check(after === 20, '3: the food level is 20 (server)', `${before} -> ${after}`);
            check((invAfter.bread || 0) === 5, '3: 5 bread are left (server, main inventory and off-hand)', itemsText(invAfter));

            // ---------------------------------------------------------- 4. the count after it
            const inv2 = await orders.order('!inventory', 20000);
            note(`4: !inventory answered ${JSON.stringify(inv2)}`);
            // the list line counts the off-hand once; the extra line only names what the off-hand holds
            const counts = [...inv2.matchAll(/- bread: (\d+)/g)].map((m) => Number(m[1]));
            check(counts.length === 1 && counts[0] === 5, '4: !inventory counts the 5 bread once ("- bread: 5")', JSON.stringify(inv2.slice(0, 300)));
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
