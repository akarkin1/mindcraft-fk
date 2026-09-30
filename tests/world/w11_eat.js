// W11 eat (spec section 8 "Eat", H4 eatBestFood and autoEatOptions, G5): home_pack on, world_memory on,
// difficulty easy (in peaceful the food level fills up by itself), the bot in survival. The food level
// is lowered with the effect hunger (a console command) and read from the server.
//   1. The auto-eat options of the real agent keep the defaults of the plugin (eatingTimeout) and have
//      priority foodPoints, startAt 14 and the banned list of H4.
//   2. Food level 6 or lower and no food: !eat answers "I carry no food and know no chest with food."
//      (v0.1.4.8, C1; the storage pack is off, so the bot knows no chest).
//   3. Food level 6 or lower, 5 bread arrive: the bot eats (by the reflex of the plugin or by !eat):
//      the food level reaches 18 or more, bread is used, the reply of !eat is a text of H4.
//   4. Food level 15 or 16 (above startAt 14, so the plugin does not eat), 3 bread:
//      !eat answers "I ate 1 bread. Food 20 of 20, health 20 of 20." and the food level is 20 (v0.1.4.8, C1:
//      the texts of !eat end with the food level and the health).
//   v0.1.4.8, X10: in 3 the number of the text of !eat is the bread that left the inventory while it ran (the
//      hunger reflex eats beside it: before X10 the text was "I could not eat: Consuming cancelled ...").
//   5. v0.1.4.8, X12: !consume("bread") with full food answers "I am not hungry. Food 20 of 20.", no exception.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    waitFor, sleep, command, commands,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, entityNumber, inventoryOf, stableInventory } from './world.js';

const NAME = 'w_eat';
const BANNED = ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chicken', 'golden_apple', 'enchanted_golden_apple', 'chorus_fruit', 'suspicious_stew'];

const food = () => entityNumber(NAME, 'foodLevel');
const bread = (agent) => agent.bot.inventory.items().filter((i) => i.name === 'bread').reduce((n, i) => n + i.count, 0);

// Lowers the food level with hunger until it is at most `to`, then removes the effect.
async function starve(to) {
    await command(`effect give ${NAME} minecraft:hunger 120 120 true`);
    const done = await waitFor(async () => (await food()) <= to, { ms: 60000, every: 150 });
    await command(`effect clear ${NAME} minecraft:hunger`);
    await sleep(300);
    return { ok: done.ok, level: await food(), ms: done.ms };
}

await scenarioMain({
    async main() {
        const r = region(24);
        const g = r.g;
        await prepareRegion(r);
        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, home_pack: true, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, 0);
            await commands(['difficulty easy', `gamemode survival ${NAME}`]);

            // ---------------------------------------------------------- 1. auto-eat options
            const o = agent.bot.autoEat?.options || {};
            note(`1: bot.autoEat.options ${JSON.stringify(o)}`);
            check(typeof o.eatingTimeout === 'number' && o.eatingTimeout > 0, '1: the auto-eat options keep eatingTimeout of the plugin', String(o.eatingTimeout));
            check(o.priority === 'foodPoints' && o.startAt === 14, '1: the auto-eat options have priority foodPoints and startAt 14');
            check(Array.isArray(o.bannedFood) && BANNED.every((b) => o.bannedFood.includes(b)), '1: the auto-eat options ban the foods of H4', JSON.stringify(o.bannedFood));

            // ---------------------------------------------------------- 2. no food
            const st = await starve(6);
            note(`2: the food level is ${st.level} after ${st.ms} ms of hunger`);
            check(st.ok, '2: precondition: the food level is 6 or lower (hunger effect)', String(st.level));
            const r2 = await command_(agent, '!eat', 30000);
            note(`2: ${JSON.stringify(r2)}`);
            check(r2.includes('I carry no food and know no chest with food.'), '2: without food !eat answers "I carry no food and know no chest with food." (C1)', JSON.stringify(r2.slice(0, 200)));

            // ---------------------------------------------------------- 3. low food level and bread
            const before = await food();
            await command(`give ${NAME} minecraft:bread 5`);
            await waitFor(() => bread(agent) > 0, { ms: 5000 });
            await sleep(500);
            const b0 = (await inventoryOf(NAME)).bread || 0; // the hunger reflex may have eaten some already
            const r3 = await command_(agent, '!eat', 45000);
            const b1 = (await stableInventory(NAME)).items.bread || 0;
            const full = await waitFor(async () => (await food()) >= 18, { ms: 20000, every: 300 });
            const after = await food();
            note(`3: food ${before} -> ${after}, bread ${b0} before !eat, ${b1} after it (5 given), !eat answered ${JSON.stringify(r3)}`);
            check(full.ok, '3: with bread and a low food level the bot eats: the food level reaches 18 or more (server)', `${before} -> ${after}`);
            check(bread(agent) < 5, '3: bread was eaten', `${bread(agent)} left`);
            check(/(I ate \d+ bread|I am not hungry)\. Food \d+ of 20, health \d+ of 20\./.test(r3),
                '3: the reply of !eat is "I ate <n> bread. Food N of 20, health M of 20." (or "I am not hungry. ..." when a reflex was faster; C1)', JSON.stringify(r3.slice(0, 200)));
            // v0.1.4.8, X10: one lock for eating; the text of !eat counts what left the inventory while it ran
            const ate = /I ate (\d+) bread\./.exec(r3);
            check(ate ? Number(ate[1]) === b0 - b1 : b0 - b1 === 0, '3: the number in the text of !eat is the bread that left the inventory while it ran (X10)',
                `text ${ate ? ate[1] : '(not hungry)'}, bread ${b0} -> ${b1}`);

            // ---------------------------------------------------------- 4. above startAt: only !eat eats
            await command(`clear ${NAME} minecraft:bread`);
            const st4 = await starve(16);
            check(st4.level >= 15 && st4.level <= 16, '4: precondition: the food level is 15 or 16, above startAt 14', String(st4.level));
            await command(`give ${NAME} minecraft:bread 3`);
            await waitFor(() => bread(agent) === 3, { ms: 5000 });
            await sleep(1500);
            const untouched = bread(agent) === 3;
            const r4 = await command_(agent, '!eat', 30000);
            const after4 = await food();
            note(`4: food ${st4.level} -> ${after4}, bread ${bread(agent)} of 3, !eat answered ${JSON.stringify(r4)}`);
            check(untouched, '4: above startAt the plugin did not eat by itself');
            check(r4.includes('I ate 1 bread. Food 20 of 20, health 20 of 20.'), '4: !eat answers "I ate 1 bread. Food 20 of 20, health 20 of 20." (C1)', JSON.stringify(r4.slice(0, 200)));
            check(after4 === 20 && bread(agent) === 2, '4: the food level is 20 and 2 bread are left', `food ${after4}, bread ${bread(agent)}`);

            // ---------------------------------------------------------- 5. !consume with full food (X12)
            const r5 = await command_(agent, '!consume("bread")', 30000);
            note(`5: !consume("bread") at food ${await food()} answered ${JSON.stringify(r5)}`);
            check(r5.includes('I am not hungry. Food 20 of 20.') && !/exception|Error/i.test(r5), '5: !consume with full food answers "I am not hungry. Food 20 of 20." and no exception (X12)', JSON.stringify(r5.slice(0, 200)));
            check(bread(agent) === 2, '5: no bread was used', `bread ${bread(agent)}`);

            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`effect clear ${NAME}`, 'difficulty peaceful']).catch(() => {});
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
