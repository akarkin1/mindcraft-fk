// W86 a blocker becomes steps (journey of v0.1.4.10 "Goals", tester T3; PLAN.md 1.3, CHANGELOG "A blocker becomes
// steps"): the owner asks for iron while the bot has no torches and no pickaxe. Today (v0.1.4.9) "no torches" ended the
// mining and 20 minutes of guided crafting followed (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with job_memory on, the modes of his profile, an empty memory. The bot carries 8 ladders and nothing else:
// no torch, no pickaxe. The chest of the house holds 20 oak_log and 9 coal (and its bread and leaf litter); the chest
// of the mine room holds only cobblestone. The bot is never moved by the control.
//   0. The bot beside the chest of the house: typed !viewChest (the owner: "check the chest"), the answer names the
//      logs and the coal. The player walks out of the house and types !goToPlayer ("come here"); outside he teaches
//      the mine (journey.js partTeachMine).
//   1. 4 iron ore beyond the end of the tunnel. Typed !mineOre("iron", 4) at the end of the tunnel.
//   2. The skill lacks a supply: the job asks the model for steps once. The fake model answers a prompt that names the
//      missing torches or pickaxe with the steps the owner's model would give: !craftSupplies("torch", 16) and
//      !getTool("pickaxe", "stone") (only the pickaxe when the prompt names no torch). Checks: the bot says the plan
//      text ("I have no torches. I get ..." or the same for the pickaxe), at most 3 plan prompts.
//   3. Within 15 minutes: the bot made torches (carried or placed) and has a pickaxe (server inventory), and has 4
//      raw_iron.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, waitFor } from './helpers.js';
import { region, prepareRegion, releaseRegion, buildChest, chestItems, inventoryOf, itemsText, findBlocks } from './world.js';
import { basePlan, buildBase, BASE_RADIUS, HOUSE_CHEST_ITEMS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMine, PLAYER, playerOutOfHouse, GOALS_SETTINGS, oreBeyondTunnel, saidLines, journeyTrace, printJourney, actionRuns } from './journey.js';

const NAME = 'w_blocker';
const CHEST = { ...HOUSE_CHEST_ITEMS, oak_log: 20, coal: 9 };
const PLAN_PROMPT = /You plan the steps/;
const PLAN_SAID = /^I have no (torch(es)?|pickaxe|[\w ]+)\. I get .+, then I go on\.$/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        await buildChest(b.house.chest, CHEST, { facing: 'west' });
        await buildChest(b.room.chest, { cobblestone: 64 }, { facing: 'east' });
        const c = b.house.chest;
        let agent = null, orders = null, trace = null, runs = null;
        try {
            const j = await startJourney(NAME, b, { botAt: { x: c.x - 2, y: c.y, z: c.z - 1 }, playerAt: { x: c.x - 3, y: c.y, z: c.z - 3 }, kit: [['ladder', 8]], settings: GOALS_SETTINGS() });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;

            // the fake model answers the plan prompt with the steps of the owner's model
            const plans = [];
            const chat = s.chat;
            const send = chat.sendRequest;
            chat.sendRequest = async function planned(turns, systemMessage) {
                const prompt = String(systemMessage ?? '');
                if (!PLAN_PROMPT.test(prompt)) return send.call(this, turns, systemMessage);
                const missing = (/What is missing: ([^\n]*)/.exec(prompt) ?? [])[1] ?? '';
                // as the owner's model would: logs and coal fetched first when the prompt shows a chest that holds them
                const fetch = [];
                if (/chest/i.test(prompt) && /oak_log/.test(prompt)) fetch.push('!fetchItem("oak_log", 8)');
                if (/chest/i.test(prompt) && /\bcoal\b/.test(prompt) && /torch/i.test(missing)) fetch.push('!fetchItem("coal", 4)');
                const steps = [...fetch, ...(/torch/i.test(missing) ? ['!craftSupplies("torch", 16)', '!getTool("pickaxe", "stone")'] : ['!getTool("pickaxe", "stone")'])];
                plans.push({ missing, steps, t: Date.now() });
                console.log(`PLAN prompt ${plans.length}: missing ${JSON.stringify(missing)} -> ${JSON.stringify(steps)}`);
                if (plans.length === 1) console.log(`PLAN prompt 1 in full: ${JSON.stringify(prompt)}`);
                return steps.join('\n');
            };

            // ---------------------------------------------------------- 0. the chest, the mine
            const inv0 = await inventoryOf(NAME);
            note(`the bot carries ${itemsText(inv0)}; the chest of the house holds ${itemsText(await chestItems(c))}`);
            check(!inv0.torch && !Object.keys(inv0).some((k) => k.endsWith('_pickaxe')), 'precondition: the bot has no torch and no pickaxe', itemsText(inv0));
            const view = await orders.order('!viewChest', 30000);
            note(`0: !viewChest answered ${JSON.stringify(view.slice(0, 300))}`);
            check(/oak_log/.test(view) && /coal/.test(view), '0: "check the chest": the answer names the oak_log and the coal', JSON.stringify(view.slice(0, 200)));
            // the player goes to the trapdoor (the control moves the player only)
            // the player walks out under the open sky and calls the bot ("come here"): the mine is taught from outside
            await playerOutOfHouse(b, { x: c.x - 3, y: c.y, z: c.z - 3 });
            const out = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 60000);
            note(`0: "come here" from outside answered ${JSON.stringify(out.reply.slice(0, 200))}; the bot at ${fmt(await entityPos(NAME))}`);
            const taught = await partTeachMine({ ...j, b });
            if (!taught.ok) {
                check(false, 'the bot learned the mine (precondition of the job); the rest is not run');
                return;
            }

            // ---------------------------------------------------------- 1. the job
            const ores = await oreBeyondTunnel(b, 2);
            note(`4 iron ore at ${ores.map(fmt).join(' ')}`);
            const tunnelBox = { min: { x: b.tunnel.end.x - 1, y: b.tunnel.end.y - 1, z: b.tunnel.start.z }, max: { x: b.tunnel.end.x + 1, y: b.tunnel.end.y + 2, z: b.tunnel.end.z + 14 } };
            const torchesBefore = (await findBlocks(tunnelBox, ['torch', 'wall_torch']).catch(() => [])).length;
            trace = journeyTrace(agent, b);
            runs = actionRuns(agent, 1000);
            const tJob = Date.now();
            const first = await orders.orderInfo('!mineOre("iron", 4)', 300000);
            note(`1: !mineOre("iron", 4) answered after ${((Date.now() - tJob) / 1000).toFixed(1)} s: ${JSON.stringify(first.reply.slice(0, 400))}`);

            // ---------------------------------------------------------- 2. the plan
            const planned = await waitFor(() => saidLines(s, tJob).find((l) => PLAN_SAID.test(l)) ?? null, { ms: 60000, every: 500 });
            note(`2: plan prompts ${plans.length}: ${JSON.stringify(plans.map((p) => p.missing))}; the bot said ${planned.ok ? JSON.stringify(planned.value) : 'no plan text'}`);
            check(plans.length >= 1, '2: the missing supply made the job ask the model for steps', `${plans.length} plan prompts`);
            check(planned.ok, '2: the bot says the plan text ("I have no torches. I get ..., then I go on.")', JSON.stringify(saidLines(s, tJob).slice(0, 8)));

            // ---------------------------------------------------------- 3. the steps and the job
            const facts = async () => {
                const inv = await inventoryOf(NAME);
                const placed = await findBlocks(tunnelBox, ['torch', 'wall_torch']).catch(() => []);
                return { inv, placed: placed.length - torchesBefore, pick: Object.keys(inv).filter((k) => k.endsWith('_pickaxe')) };
            };
            const got = await waitFor(async () => {
                const f = await facts();
                if (saidLines(s, tJob).some((l) => /I could not plan the steps/.test(l))) return f; // the job gave up: no use waiting
                return (f.inv.raw_iron || 0) >= 4 && f.pick.length > 0 && ((f.inv.torch || 0) > 0 || f.placed > 0) ? f : null;
            }, { ms: 15 * 60000, every: 3000 });
            const f = got.value ?? await facts();
            note(`3: ${((Date.now() - tJob) / 1000).toFixed(0)} s after the order the bot carries ${itemsText(f.inv)}, ${f.placed} torches stand in the tunnel; it is at ${fmt(await entityPos(NAME))}; the chest of the house holds ${itemsText(await chestItems(c))}`);
            note(`3: the bot said ${JSON.stringify(saidLines(s, tJob).slice(0, 30))}`);
            note(`3: the actions: ${JSON.stringify(runs.stop().filter((x) => x.label !== '-').map((x) => `${x.label} ${((x.from - tJob) / 1000).toFixed(0)}..${((x.to - tJob) / 1000).toFixed(0)} s`).slice(0, 30))}`);
            check((f.inv.torch || 0) > 0 || f.placed > 0, '3: the bot made torches (in its inventory or standing in the tunnel)', `${f.inv.torch || 0} carried, ${f.placed} placed`);
            check(f.pick.length > 0, '3: the bot has a pickaxe (server inventory)', itemsText(f.inv));
            check((f.inv.raw_iron || 0) >= 4, '3: the bot mined the iron: 4 raw_iron within 15 minutes', `${f.inv.raw_iron || 0} raw_iron`);
            check(plans.length <= 3, '3: at most 3 plans for the job', `${plans.length}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (runs) runs.stop();
            if (trace) printJourney('the job with a blocker', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
