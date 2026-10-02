// W87 the standing list (journey of v0.1.4.10 "Goals", tester T3; PLAN.md 1.6, CHANGELOG "The standing list"): the
// owner gave the bot a list once; with nothing to do, the bot works it. Today (v0.1.4.9) the bot stands still.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with job_memory on and idle_jobs ["!farmCycle(\"farm\")", "!craftSupplies(\"torch\", 8)"] (idle_jobs_minutes
// 15, the default), the modes of his profile, an empty memory. Every wheat of the farm is unripe (age 5); the chest
// of the house holds its 64 leaf_litter and 12 bread. The bot carries 4 oak_log and 4 coal. The bot is never moved by
// the control.
//   0. The bot beside the chest of the house: typed !viewChest ("check the chest"); typed !goToCoordinates to the
//      front of the farm gate; typed !rememberArea("farm", "farm") ("this is the farm"). None of them is a job.
//   1. Then no order at all. Within 60 to 150 s after the last answer the farm cycle runs (the action of the agent),
//      without a call of the model.
//   2. After it the torches are made: within 10 minutes of the last order the bot carries 8 torches or more (server),
//      and the farm cycle worked: leaf litter left the chest of the house or wheat was harvested.
// Throughout: no order after step 0, the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, waitFor, walkTyped } from './helpers.js';
import { region, prepareRegion, releaseRegion, chestItems, inventoryOf, itemsText, cropAges } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, GOALS_SETTINGS, saidLines, actionRuns } from './journey.js';

const NAME = 'w_idlelist';
const IDLE = ['!farmCycle("farm")', '!craftSupplies("torch", 8)'];

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump, crops: () => ({ crop: 'wheat', age: 5 }) });
        await buildBase(b);
        const g = b.g;
        const f = b.farm;
        const c = b.house.chest;
        let agent = null, orders = null, runs = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { x: c.x - 2, y: c.y, z: c.z - 1 }, playerAt: { x: f.outsideGate.x + 5, y: g + 1, z: f.outsideGate.z - 3 },
                kit: [['oak_log', 4], ['coal', 4]], settings: GOALS_SETTINGS({ idle_jobs: IDLE }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const crops = f.crops.map((x) => x.above);
            const wheatTotal = async () => ((await inventoryOf(NAME)).wheat || 0) + ((await chestItems(f.chest))?.wheat || 0) + ((await chestItems(c))?.wheat || 0);

            // ---------------------------------------------------------- 0. the orders
            const view = await orders.order('!viewChest', 30000);
            note(`0: !viewChest answered ${JSON.stringify(view.slice(0, 200))}`);
            const walk = await walkTyped(orders, agent, f.outsideGate);
            check(walk.arrived, '0: the typed walk brought the bot to the front of the farm gate', fmt(walk.pos));
            const area = await orders.order('!rememberArea("farm", "farm")', 90000);
            note(`0: !rememberArea("farm", "farm") answered ${JSON.stringify(area.slice(0, 300))}`);
            check(agent.area_store?.get?.('farm')?.type === 'farm', '0: the farm is saved as the area "farm" (precondition of the list)', JSON.stringify(area.slice(0, 200)));
            const tLast = Date.now();
            const orderCount = s.messages.length;
            const callsBefore = s.chat.requests.length;
            const wheat0 = await wheatTotal();
            const ages0 = await cropAges(crops);
            const litter0 = (await chestItems(c))?.leaf_litter || 0;
            note(`0: the last order answered; the bot carries ${itemsText(await inventoryOf(NAME))}; wheat ${wheat0}; the chest of the house holds ${litter0} leaf_litter; crop ages ${JSON.stringify(ages0.reduce((m, a) => ({ ...m, [a]: (m[a] || 0) + 1 }), {}))}`);
            runs = actionRuns(agent, 500);

            // ---------------------------------------------------------- 1. the farm cycle by itself
            const farm = await waitFor(() => runs.runs.find((x) => /farmCycle/.test(x.label)) ?? null, { ms: 150000, every: 500 });
            const farmAt = farm.ok ? (farm.value.from - tLast) / 1000 : null;
            note(`1: the farm cycle ${farm.ok ? `started ${farmAt.toFixed(1)} s after the last order` : 'did not start within 150 s'}; the bot at ${fmt(await entityPos(NAME))}`);
            check(farm.ok && farmAt >= 55, '1: after 60 s without an order the farm cycle runs by itself (within 150 s, not before 55 s)', farm.ok ? `${farmAt.toFixed(1)} s` : 'not started');

            // ---------------------------------------------------------- 2. then the torches
            const torches = await waitFor(async () => {
                const inv = await inventoryOf(NAME);
                return (inv.torch || 0) >= 8 && !runs.runs.some((x) => /farmCycle/.test(x.label) && x === runs.runs[runs.runs.length - 1]) ? inv : null;
            }, { ms: Math.max(10000, 600000 - (Date.now() - tLast)), every: 2000 });
            const inv = torches.value ?? await inventoryOf(NAME);
            const all = runs.stop();
            const labels = all.filter((x) => x.label !== '-').map((x) => `${x.label} ${((x.from - tLast) / 1000).toFixed(0)}..${((x.to - tLast) / 1000).toFixed(0)} s`);
            note(`2: the actions after the last order: ${JSON.stringify(labels.slice(0, 30))}`);
            const firstFarm = all.find((x) => /farmCycle/.test(x.label));
            const firstCraft = all.find((x) => /craftSupplies/.test(x.label));
            const wheat1 = await wheatTotal();
            const litter1 = (await chestItems(c))?.leaf_litter || 0;
            const ages1 = await cropAges(crops);
            note(`2: the bot carries ${itemsText(inv)}; wheat ${wheat0} -> ${wheat1}; leaf_litter in the chest ${litter0} -> ${litter1}; crop ages ${JSON.stringify(ages1.reduce((m, a) => ({ ...m, [a]: (m[a] || 0) + 1 }), {}))}`);
            note(`2: the bot said ${JSON.stringify(saidLines(s, tLast).slice(0, 20))}`);
            check(Boolean(firstCraft) && Boolean(firstFarm) && firstCraft.from > firstFarm.from, '2: the torches are made after the farm cycle (the order of the list)', JSON.stringify({ farm: firstFarm?.from - tLast, craft: firstCraft?.from - tLast }));
            check((inv.torch || 0) >= 8, '2: within 10 minutes without an order the bot carries 8 torches or more (server)', `${inv.torch || 0} torches`);
            check(litter1 < litter0 || wheat1 > wheat0, '2: the farm cycle worked: leaf litter left the chest of the house or wheat was harvested', `leaf_litter ${litter0} -> ${litter1}, wheat ${wheat0} -> ${wheat1}`);
            check(s.messages.length === orderCount, 'no order was given after step 0', `${s.messages.length - orderCount} messages`);
            const calls = s.chat.requests.slice(callsBefore);
            check(calls.length === 0, 'the list ran without a call of the model', JSON.stringify(calls.map((x) => String(x.turns?.at?.(-1)?.content ?? '').slice(0, 80))));
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (runs) runs.stop();
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
