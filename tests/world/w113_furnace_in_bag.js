// W113 the furnace in the bag (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 3.3 and 3.4, SPEC section 1 and
// 4.4 P3, P4): "make me an iron pickaxe" with a furnace in the bag and no furnace near: the furnace is placed, the iron
// smelted, the pickaxe crafted, and the plan started by itself, with no second order. Today (v0.1.4.12) the bot says it
// carries no furnace while it does, and a plan that was made waits for the next order (the play of 2026-10-04): the
// scenario fails at the check of the furnace or of the pickaxe.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists) with the
// furnace of the mine room removed: no furnace within 64 blocks. The owner's switches of v0.1.4.12 (smelting on) and of
// this release (SUPERVISION_SETTINGS), the modes of his profile, an empty memory. The bot stands in the mine room (its
// crafting table at hand) beside the chest of the room with a kit of 1 furnace, 4 oak_planks and 1 coal (the spec names 2
// planks: 2 planks cannot be both the fuel of 3 smelts and the 2 sticks of the pickaxe; see the report). The 3 raw_iron
// of the spec lie in the chest of the room, which the owner shows the bot ("check the chest", typed !viewChest): with the
// raw iron in the bag !getTool of v0.1.4.12 smelts and crafts in one go (seen on the first run) and no plan is made, so
// neither defect shows; with it in a known chest the job plans the steps the owner's model gives, and the plan step
// !smeltItem is the one that said it carried no furnace on 2026-10-04. The owner saves the mine as an area of kind mine
// (typed !setArea("mine", "mine", <the mine box>)): the bot places a furnace only in a saved area of kind storage,
// building or mine, or in a mine it knows (P4). The bot is never moved by the control.
//   1. The player says "make me an iron pickaxe"; the fake model answers !getTool("pickaxe", "iron"); a plan prompt of the
//      job is answered with the steps the owner's model gives: !fetchItem("raw_iron", 3), !smeltItem("raw_iron", 3),
//      !getTool("pickaxe", "iron"). No second order: the player types nothing more.
//   2. Within 3 minutes: a furnace stands within 3 blocks of where the bot stood (server), the bag holds an iron_pickaxe
//      (server), the plan text (`I have no iron ingot. I get ..., then I go on.`) and the step text (`Step 1 of N:
//      !...(...).`) were said, and `I placed my furnace at (x, y, z).` names the furnace that stands.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, waitFor, commands, sleep } from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, itemsText, findBlocks, blockIs, buildChest, chestItems } from './world.js';
import { basePlan, buildBase, BASE_RADIUS, ROOM_CHEST_ITEMS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, PLAYER, saidLines, SUPERVISION_SETTINGS, actionRuns } from './journey.js';

const NAME = 'w_furnace';
const KIT = [['furnace', 1], ['oak_planks', 4], ['coal', 1]];
const SENTENCE = 'make me an iron pickaxe';
const PLAN_PROMPT = /You plan the steps/;
const STEPS = ['!fetchItem("raw_iron", 3)', '!smeltItem("raw_iron", 3)', '!getTool("pickaxe", "iron")'];
const PLAN_SAID = /^I have no iron[ _]ingots?\. I get .+, then I go on\.$/;
const STEP_SAID = /^Step 1 of \d+: !\w+\(.*\)\.$/;
// The lead, round 1 (DECISIONS R1-2): the placement is said in front of the result of the command, in one line with the
// smelt text (`I placed my furnace at (x, y, z). I smelted ...`), so the sentence is found inside a line
const PLACED = /I placed my furnace at \((-?\d+), (-?\d+), (-?\d+)\)\./;
const NO_FURNACE = /I know no furnace within 64 blocks and carry none/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        await commands([`setblock ${b.room.furnace.x} ${b.room.furnace.y} ${b.room.furnace.z} minecraft:air`]);
        await buildChest(b.room.chest, { ...ROOM_CHEST_ITEMS, raw_iron: 3 }, { facing: 'east' });
        const room = b.room.box;
        const chest = b.room.chest;
        const far = { min: { x: b.ox - 64, y: room.min.y - 20, z: b.oz - 64 }, max: { x: b.ox + 64, y: b.g + 6, z: b.oz + 64 } };
        const botAt = { x: chest.x + 1, y: room.min.y, z: chest.z - 1 }; // beside the chest of the room
        let agent = null, orders = null, runs = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt, playerAt: { x: room.min.x + 3, y: room.min.y, z: b.oz - 1 }, kit: KIT, settings: SUPERVISION_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            s.route(new RegExp(SENTENCE), '!getTool("pickaxe", "iron")');
            const plans = [];
            const chat = s.chat;
            const send = chat.sendRequest;
            chat.sendRequest = async function planned(turns, systemMessage) {
                const prompt = String(systemMessage ?? '');
                if (!PLAN_PROMPT.test(prompt)) return send.call(this, turns, systemMessage);
                plans.push({ missing: (/What is missing: ([^\n]*)/.exec(prompt) ?? [])[1] ?? '', t: Date.now() });
                console.log(`PLAN prompt ${plans.length}: missing ${JSON.stringify(plans[plans.length - 1].missing)} -> ${JSON.stringify(STEPS)}`);
                return STEPS.join('\n');
            };

            // ---------------------------------------------------------- 0. no furnace near, the area
            const furnaces = await findBlocks({ min: { x: b.ox - 30, y: room.min.y - 2, z: b.oz - 30 }, max: { x: b.ox + 30, y: b.g + 6, z: b.oz + 30 } }, ['furnace', 'blast_furnace']).catch(() => []);
            check(furnaces.length === 0, '0: precondition: no furnace stands within the base (the room\'s was removed; none within 64 blocks)', JSON.stringify(furnaces.map((f) => f.pos)));
            const mb = b.mineBox;
            const area = await orders.order(`!setArea("mine", "mine", ${mb.min.x}, ${mb.min.y}, ${mb.min.z}, ${mb.max.x}, ${mb.max.y}, ${mb.max.z})`, 20000);
            note(`0: !setArea("mine", "mine", ...) answered ${JSON.stringify(area.slice(0, 200))}`);
            check(/^Area "mine" \(mine\) saved:/.test(area), '0: precondition: the mine is saved as an area of kind mine', JSON.stringify(area.slice(0, 200)));
            const view = await orders.order('!viewChest', 30000);
            const known = agent.packContext().chests?.get(chest);
            const inv0 = await inventoryOf(NAME);
            note(`0: "check the chest" (!viewChest) answered ${JSON.stringify(view.slice(0, 200))}; the chest index knows ${JSON.stringify(known?.items ?? null)}; the chest holds ${itemsText(await chestItems(chest))}; the bot carries ${itemsText(inv0)} at ${fmt(await entityPos(NAME))}`);
            check(Boolean(known) && (known.items?.raw_iron || 0) === 3, '0: precondition: the bot knows the chest of the room with 3 raw_iron (chest index)', JSON.stringify(known?.items ?? null));
            check((inv0.furnace || 0) === 1 && !inv0.raw_iron && !inv0.iron_ingot, '0: precondition: the bot carries a furnace and no iron', itemsText(inv0));

            // ---------------------------------------------------------- 1. the sentence
            runs = actionRuns(agent, 1000);
            const stood = await entityPos(NAME);
            const t1 = Date.now();
            const ordersBefore = s.messages.filter((m) => m.source === PLAYER).length;
            orders.say(SENTENCE);
            const near = { min: { x: Math.floor(stood.x) - 3, y: Math.floor(stood.y) - 3, z: Math.floor(stood.z) - 3 }, max: { x: Math.floor(stood.x) + 3, y: Math.floor(stood.y) + 3, z: Math.floor(stood.z) + 3 } };
            const facts = async () => ({ inv: await inventoryOf(NAME), furnaces: await findBlocks(near, ['furnace']).catch(() => []) });
            const got = await waitFor(async () => {
                const f = await facts();
                return (f.inv.iron_pickaxe || 0) > 0 && f.furnaces.length > 0 ? f : null;
            }, { ms: 180000, every: 3000 });
            const f = got.value ?? await facts();
            const secs = ((Date.now() - t1) / 1000).toFixed(0);
            const said = saidLines(s, t1);
            const history = s.added.filter((a) => a.t >= t1).map((a) => a.content);
            const lines = [...said, ...history];
            const placed = lines.map((l) => PLACED.exec(l)).find(Boolean) ?? null;
            const anywhere = await findBlocks(far, ['furnace']).catch(() => []);
            note(`1: ${secs} s after "${SENTENCE}" the bot carries ${itemsText(f.inv)} at ${fmt(await entityPos(NAME))}; furnaces within 3 blocks of where it stood ${JSON.stringify(f.furnaces.map((x) => x.pos))}, anywhere ${JSON.stringify(anywhere.map((x) => x.pos))}; plan prompts ${plans.length} ${JSON.stringify(plans.map((p) => p.missing))}`);
            note(`1: the bot said ${JSON.stringify(said.slice(0, 30))}`);
            note(`1: the actions: ${JSON.stringify(runs.stop().filter((x) => x.label !== '-').map((x) => `${x.label} ${((x.from - t1) / 1000).toFixed(0)}..${((x.to - t1) / 1000).toFixed(0)} s`).slice(0, 30))}`);
            const secondOrders = s.messages.filter((m) => m.source === PLAYER).length - ordersBefore - 1;

            // ---------------------------------------------------------- 2. the facts
            check(secondOrders === 0, '2: no second order was given (the plan started by itself, P3)', `${secondOrders} further lines of the player`);
            check(f.furnaces.length > 0, '2: within 3 minutes a furnace stands within 3 blocks of where the bot stood (server)', JSON.stringify(anywhere.map((x) => x.pos)));
            check((f.inv.iron_pickaxe || 0) > 0, '2: the bag holds an iron_pickaxe (server)', itemsText(f.inv));
            // The lead, round 1 (DECISIONS R1-2): !getTool of v0.1.4.12 already leads through the smelt in one call when the
            // raw iron lies in a known chest, so no plan is needed and none is made; the plan texts are asserted only
            // when the model was asked for a plan (P3 itself is proven by the unit tests xp_plan_starts and W109)
            if (plans.length > 0) {
                check(lines.some((l) => PLAN_SAID.test(l)), '2: the plan text was said: `I have no iron ingot. I get ..., then I go on.`', JSON.stringify(said.filter((l) => /^I have no/.test(l)).slice(0, 3)));
                check(lines.some((l) => STEP_SAID.test(l)), '2: the step text was said: `Step 1 of N: !...(...).`', JSON.stringify(said.filter((l) => /^Step \d/.test(l)).slice(0, 3)));
            } else {
                note('2: the order was done in one call without a plan; the plan and step texts are not asked for');
            }
            check(Boolean(placed) && await blockIs({ x: Number(placed[1]), y: Number(placed[2]), z: Number(placed[3]) }, 'furnace'),
                '2: `I placed my furnace at (x, y, z).` was said and names a furnace that stands', placed ? placed[0] : JSON.stringify(said.filter((l) => /furnace/i.test(l)).slice(0, 4)));
            check(!lines.some((l) => NO_FURNACE.test(l)), '2: `I know no furnace within 64 blocks and carry none` was not said (the bot carried one)', JSON.stringify(lines.filter((l) => NO_FURNACE.test(l)).slice(0, 2)));
            await sleep(500);
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
