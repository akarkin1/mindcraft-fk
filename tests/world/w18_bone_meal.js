// W18 bone meal (spec v0.1.4.7 section 8 "Bone meal", F1 COMPOSTABLE, F2 makeBoneMeal):
// farming_pack on, protected_areas on, world_memory on. An empty composter 3 blocks from the bot, flat
// grass around it with nothing that grows (no grass, flowers or leaves within 32 blocks).
//   1. The bot has 20 wheat_seeds and nothing else. !makeBoneMeal(1): "I found nothing to compost.
//      I do not use seeds for that." The composter is still empty, the bot has its 20 seeds.
//   2. The bot gets 64 oak_leaves (30 % each; 7 successes are needed for one bone meal, 64 leaves
//      miss that with a chance of about 1 in 2000). !makeBoneMeal(1): the bot has bone meal and
//      still every seed, the text of F2 names the bone meal and the items used.
// v0.1.4.8 (W30): the modes of the owner are on (MODES_PROFILE, with the home reflexes) and !makeBoneMeal is
// typed by the player in the chat.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    giveItems, withModes, orderChannel,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, buildComposter, composterLevel, stableInventory, itemsText } from './world.js';

const NAME = 'w_bonemeal';

await scenarioMain({
    async main() {
        const r = region(36);
        const g = r.g;
        await prepareRegion(r);
        const composter = { x: r.ox + 3, y: g + 1, z: r.oz };
        await buildComposter(composter, 0);

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true, farming_pack: true }));
            agent = s.agent;
            orders = await orderChannel(s, { at: { x: r.ox - 12, y: g + 1, z: r.oz + 12 } });
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, -90);
            check(await composterLevel(composter) === 0, 'precondition: an empty composter stands 3 blocks from the bot');

            // ---------------------------------------------------------- 1. only seeds
            await giveItems(NAME, [['wheat_seeds', 20]], agent.bot);
            const r1 = await orders.order('!makeBoneMeal(1)', 120000);
            note(`1: !makeBoneMeal answered ${JSON.stringify(r1)}`);
            const inv1 = await stableInventory(NAME);
            const level1 = await composterLevel(composter);
            note(`1: the bot carries ${itemsText(inv1.items)}; the composter is at level ${level1}`);
            check(r1.startsWith('I found nothing to compost. I do not use seeds for that.'), '1: with only seeds the text of F2 "I found nothing to compost. I do not use seeds for that."', JSON.stringify(r1));
            check((inv1.items.wheat_seeds || 0) === 20, '1: the bot still has its 20 seeds (seeds are for planting)', `wheat_seeds ${inv1.items.wheat_seeds || 0}`);
            check(level1 === 0, '1: nothing went into the composter (level 0)', `level ${level1}`);

            // ---------------------------------------------------------- 2. leaves and seeds
            await giveItems(NAME, [['oak_leaves', 64]], agent.bot);
            const r2 = await orders.order('!makeBoneMeal(1)', 180000);
            note(`2: !makeBoneMeal answered ${JSON.stringify(r2)}`);
            const inv2 = await stableInventory(NAME);
            const level2 = await composterLevel(composter);
            note(`2: the bot carries ${itemsText(inv2.items)}; the composter is at level ${level2}`);
            const m = /^I made (\d+) bone_meal from (\d+) items\./.exec(r2);
            check(Boolean(m) && Number(m[1]) >= 1, '2: the text of F2 "I made <n> bone_meal from <m> items."', JSON.stringify(r2));
            check((inv2.items.bone_meal || 0) >= 1, '2: the bot has bone meal', `bone_meal ${inv2.items.bone_meal || 0}`);
            check(m && Number(m[1]) === (inv2.items.bone_meal || 0), '2: the text counts the bone meal the bot has', `text ${m?.[1]}, inventory ${inv2.items.bone_meal || 0}`);
            check((inv2.items.wheat_seeds || 0) === 20, '2: the bot still has every seed (20 wheat_seeds)', `wheat_seeds ${inv2.items.wheat_seeds || 0}`);
            check(m && Number(m[2]) === 64 - (inv2.items.oak_leaves || 0), '2: the items used in the text are the leaves that left the inventory', `text ${m?.[2]}, leaves used ${64 - (inv2.items.oak_leaves || 0)}`);
            check(level2 !== null, '2: the composter is still there');
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
