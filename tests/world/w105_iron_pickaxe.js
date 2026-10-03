// W105 "make me an iron pickaxe" (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md package 3, SPEC
// section 5): ore in the tunnel, coal in the chest of the room, a furnace in the room: the bot mines, smelts and crafts.
// Today (v0.1.4.11) !smeltItem of the original project puts one coal into the nearest furnace or places one anywhere, and
// no plan was ever tested on ore: the bot ends without an iron pickaxe.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists): the furnace of
// the room; the chest of the room holds 8 coal besides its cobblestone and torches. The owner's switches of v0.1.4.11
// with smelting on, the modes of his profile, an empty memory, a kit of a stone pickaxe, 4 oak_planks (the wood of the
// sticks and the fuel; the spec names only the pickaxe) and 8 ladders (as W84 and W86: the owner's bot carries them; ladder
// 2 of the base ends 2 blocks above the room floor and the climb out needs one). The bot is never moved by the control.
//   0. The player teaches the mine (journey.js partTeachMine: "follow me" into the house, down both ladders to the end of
//      the tunnel, "this is the mine"): a mine to take the ore from (as W86). 6 iron ore in the line of the tunnel beyond
//      its end (at 2, 4 and 6 blocks, feet and head).
//   1. The player says "make me an iron pickaxe"; the fake model answers !getTool("pickaxe", "iron"). A plan prompt of the
//      job is answered with the steps the prompt proposes: !mineOre("iron", 3), !smeltItem("raw_iron", 3),
//      !getTool("pickaxe", "iron").
//   2. Within 8 minutes the bot carries an iron_pickaxe (server); the furnace of the room stands where it was; no furnace
//      stands in the pen or the farm; the bot said (or its history holds) `I smelted N raw_iron into N iron_ingot in the
//      furnace at (x, y, z) with M <fuel>.` with N 3 or more.
//   B. (phase "off") smelting off, a fresh bot w_iron_off in the room with the same kit, the same sentence: the old
//      behaviour; the only checks are that its process lives and that no request reached a real model.
// Throughout: the process lives, no request reached a real model.
import { fileURLToPath } from 'node:url';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, waitFor, runPhase, sleep } from './helpers.js';
import { region, prepareRegion, releaseRegion, buildChest, chestItems, inventoryOf, itemsText, findBlocks, blockIs } from './world.js';
import { basePlan, buildBase, BASE_RADIUS, ROOM_CHEST_ITEMS, FARM } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMine, PLAYER, spots, oreBeyondTunnel, saidLines, RELEASE_SETTINGS, actionRuns } from './journey.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_iron';
const NAME_OFF = 'w_iron_off';
const KIT = [['stone_pickaxe', 1], ['oak_planks', 4], ['ladder', 8]];
const SENTENCE = 'make me an iron pickaxe';
const PLAN_PROMPT = /You plan the steps/;
const SMELTED = /I smelted (\d+) raw_iron into (\d+) iron_ingot in the furnace at \((-?\d+), (-?\d+), (-?\d+)\) with (\d+) (\w+)\./;
// the steps the plan prompt itself proposes (the bot carries planks as fuel); no !fetchItem: the chest index knows no chest
// in this scenario (nobody looked into the room chest), so a fetch of coal answers `I know no chest with coal.`
const STEPS = ['!mineOre("iron", 3)', '!smeltItem("raw_iron", 3)', '!getTool("pickaxe", "iron")'];

// The base of the scenario (both phases): the owner variant, coal in the chest of the room.
function plan() {
    const r = region(BASE_RADIUS);
    return { r, b: basePlan(r, { owner: true, dump: loadDump() }) };
}

// The fake model: the sentence gets !getTool("pickaxe", "iron"); a plan prompt of the job gets STEPS.
function fakeOwnerModel(s) {
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
    return plans;
}

// Part A: the mine taught, the ore, the sentence, the facts (smelting on).
async function partA(b, penBox, farmBox, sp) {
    let agent = null, orders = null, runs = null;
    try {
        const j = await startJourney(NAME, b, {
            botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: RELEASE_SETTINGS({ smelting: true }),
        });
        agent = j.agent;
        orders = j.orders;
        const s = j.s;
        const plans = fakeOwnerModel(s);
        note(`the chest of the room holds ${itemsText(await chestItems(b.room.chest))}; the furnace of the room at (${b.room.furnace.x}, ${b.room.furnace.y}, ${b.room.furnace.z})`);

        // ---------------------------------------------------------- 0. the mine, the ore
        const taught = await partTeachMine({ ...j, b });
        if (!taught.ok) {
            check(false, '0: the bot learned the mine (precondition of the mining); the rest is not run');
            return;
        }
        const ores = await oreBeyondTunnel(b, 3);
        note(`0: 6 iron ore at ${ores.map(fmt).join(' ')}`);

        // ---------------------------------------------------------- 1. the sentence
        runs = actionRuns(agent, 1000);
        const t1 = Date.now();
        orders.say(SENTENCE);
        const got = await waitFor(async () => {
            const inv = await inventoryOf(NAME);
            return (inv.iron_pickaxe || 0) > 0 ? inv : null;
        }, { ms: 8 * 60000, every: 5000 });
        const inv = got.value ?? await inventoryOf(NAME);
        const secs = ((Date.now() - t1) / 1000).toFixed(0);
        const said = saidLines(s, t1);
        const history = s.added.filter((a) => a.t >= t1).map((a) => a.content);
        const smelt = [...said, ...history].map((l) => SMELTED.exec(l)).find(Boolean) ?? null;
        note(`1: ${secs} s after "${SENTENCE}" the bot carries ${itemsText(inv)}; it is at ${fmt(await entityPos(NAME))}; plan prompts ${plans.length}`);
        note(`1: the bot said ${JSON.stringify(said.slice(0, 30))}`);
        note(`1: the actions: ${JSON.stringify(runs.stop().filter((x) => x.label !== '-').map((x) => `${x.label} ${((x.from - t1) / 1000).toFixed(0)}..${((x.to - t1) / 1000).toFixed(0)} s`).slice(0, 30))}`);

        // ---------------------------------------------------------- 2. the facts
        check(got.ok, '2: within 8 minutes of "make me an iron pickaxe" the bot carries an iron_pickaxe (server)', itemsText(inv));
        check(await blockIs(b.room.furnace, 'furnace'), '2: the furnace of the room stands where it was', `(${b.room.furnace.x}, ${b.room.furnace.y}, ${b.room.furnace.z})`);
        const strayPen = await findBlocks(penBox, ['furnace']);
        const strayFarm = await findBlocks(farmBox, ['furnace']);
        check(strayPen.length === 0 && strayFarm.length === 0, '2: no furnace was placed in the pen or the farm', JSON.stringify([...strayPen, ...strayFarm].map((x) => x.pos)));
        check(Boolean(smelt) && Number(smelt[1]) >= 3 && smelt[1] === smelt[2], '2: the bot says the smelt text with the count: `I smelted N raw_iron into N iron_ingot in the furnace at (x, y, z) with M <fuel>.` (N 3 or more)',
            smelt ? smelt[0] : JSON.stringify([...said, ...history].filter((l) => /smelt/i.test(l)).slice(0, 4)));
        if (smelt) note(`2: the furnace of the smelt at (${smelt[3]}, ${smelt[4]}, ${smelt[5]}); the room's at (${b.room.furnace.x}, ${b.room.furnace.y}, ${b.room.furnace.z})`);
        check(s.killed === null, 'the process lives', String(s.killed));
        check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
    } finally {
        if (runs) runs.stop();
        if (orders) await orders.quit();
        await stopRealAgent(agent);
    }
}

await scenarioMain({
    async main() {
        const { r, b } = plan();
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        note(`the base: ${b.dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        await buildBase(b);
        await buildChest(b.room.chest, { ...ROOM_CHEST_ITEMS, coal: 8 }, { facing: 'east' });
        const g = b.g;
        const sp = spots(b);
        const pen = b.pen;
        const penBox = { min: { ...pen.box.min }, max: { ...pen.box.max, y: g + 3 } };
        const farmBox = { min: { x: b.ox + FARM.x, y: g, z: b.oz + FARM.z }, max: { x: b.ox + FARM.x + FARM.size - 1, y: g + 3, z: b.oz + FARM.z + FARM.size - 1 } };
        try {
            await partA(b, penBox, farmBox, sp);
            // ------------------------------------------------------ B. smelting off (a phase: a fresh process)
            note('B: smelting off, a fresh bot in the room, the same sentence (phase "off")');
            await runPhase(SELF, 'off', {}, 300000);
        } finally {
            await releaseRegion(r);
        }
    },

    async off() {
        const { b } = plan();
        let agent = null, orders = null;
        try {
            const room = b.room.box;
            const j = await startJourney(NAME_OFF, b, {
                botAt: { x: room.min.x + 2, y: room.min.y, z: b.oz + 1 }, playerAt: { x: room.min.x + 1, y: room.min.y, z: b.oz },
                kit: KIT, settings: RELEASE_SETTINGS({ smelting: false }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const plans = fakeOwnerModel(s);
            const t1 = Date.now();
            orders.say(SENTENCE);
            const started = await waitFor(() => s.messages.some((m) => m.source === PLAYER && m.message === SENTENCE), { ms: 15000, every: 200 });
            await sleep(5000);
            const ended = await waitFor(() => !agent.actions.executing, { ms: 150000, every: 1000 });
            note(`B: the sentence ${started.ok ? 'arrived' : 'did NOT arrive'}; the action ${ended.ok ? 'ended' : 'still runs'} after ${((Date.now() - t1) / 1000).toFixed(0)} s; plan prompts ${plans.length}; the bot carries ${itemsText(await inventoryOf(NAME_OFF))}`);
            note(`B: the bot said ${JSON.stringify(saidLines(s, t1).slice(0, 20))}`);
            check(s.killed === null, 'B: with smelting off the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'B: no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
        }
    },
});
exitSoon();
