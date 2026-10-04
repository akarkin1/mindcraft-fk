// W112 bread beside the tunnel (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 3.1, SPEC section 1 and 4.4 P1):
// out of food in the mine, the bot takes bread from the chest beside the tunnel and mines on. Today (v0.1.4.12) the
// supply step of the job looks nowhere near: the owner's bot climbed to the basement for bread that lay 3 blocks away
// (the play of 2026-10-04), and the scenario fails at the check that the chest's bread fell.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists) with the room
// tunnel of base_world.js, a chest with 20 bread in the room 4 blocks from the start of the tunnel, the owner's switches
// of v0.1.4.12 and of this release (SUPERVISION_SETTINGS), the modes of his profile, an empty memory, a kit of an iron
// pickaxe, 16 torches and 8 ladders: no food. The bot is never moved by the control.
//   0. The bot stands beside the chest of the house (12 bread): "check the chest", typed !viewChest, so that the bot
//      knows that chest, 20 blocks above the mine (the owner's case of 2026-10-04: the known chest far away, the chest
//      beside the tunnel unknown; v0.1.4.12 walks to the known one, and takes from a chest it sees only when it knows
//      none). The player walks out, "come here" (!goToPlayer), and teaches the mine in the room with its tunnel
//      (journey.js partTeachMineInRoom). 6 iron ore beyond the rock face. "go to the end of the tunnel" (typed
//      !goToCoordinates): the job starts at the rock face, 11 blocks from the bread chest (within the 16 of P1; from 3
//      blocks v0.1.4.12 took from the chest it saw, known far chest or not: the second baseline run). Then difficulty
//      easy and the hunger effect: the food level 12 of 20 (or just under), no food item.
//   1. Typed !mineOre("iron", 6): within 60 s the bot took bread from the chest beside the tunnel (its count fell, the
//      bag's rose; server), its feet never went above the room's level + 3 (no climb to the surface; sampled every
//      500 ms), and it said the supply text `I get my supplies: N bread from the chest at (x, y, z).` with that chest.
//   2. The mining goes on: 6 raw_iron in the bag within 3 minutes of the order.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, foodTo, startTrace, walkTyped } from './helpers.js';
import { region, prepareRegion, releaseRegion, buildChest, chestItems, inventoryOf, itemsText, entityNumber } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMineInRoom, spots, saidLines, SUPERVISION_SETTINGS, journeyTrace, printJourney, playerOutOfHouse, PLAYER, waitBot, near } from './journey.js';

const NAME = 'w_bread';
const KIT = [['iron_pickaxe', 1], ['torch', 16], ['ladder', 8]];
const BREAD = 20;
const FOOD = 12;
const PLAN_PROMPT = /You plan the steps/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const t = await buildRoomTunnel(b);
        const sp = spots(b);
        const roomY = b.room.box.min.y;
        // the bread chest in the room, 4 blocks from the start of the tunnel (the room chest of the base is 2 from it)
        const chest = { x: b.ox + 3, y: roomY, z: b.oz + 2 };
        await buildChest(chest, { bread: BREAD }, { facing: 'west' });
        const toTunnel = Math.hypot(chest.x - t.start.x, chest.z - t.start.z);
        note(`the bread chest at (${chest.x}, ${chest.y}, ${chest.z}) with ${BREAD} bread, ${toTunnel.toFixed(1)} blocks from the start of the tunnel at (${t.start.x}, ${t.start.y}, ${t.start.z})`);
        const SUPPLY = new RegExp(`^I get my supplies: (\\d+) bread from the chest at \\(${chest.x}, ${chest.y}, ${chest.z}\\)\\.$`);
        let agent = null, orders = null, trace = null;
        try {
            const c = b.house.chest;
            const j = await startJourney(NAME, b, {
                botAt: { x: c.x - 2, y: c.y, z: c.z - 1 }, playerAt: { x: c.x - 3, y: c.y, z: c.z - 3 }, kit: KIT, settings: SUPERVISION_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            // the fake model answers a plan prompt of the job as the owner's model would when bread is missing
            const plans = [];
            const chat = s.chat;
            const send = chat.sendRequest;
            chat.sendRequest = async function planned(turns, systemMessage) {
                const prompt = String(systemMessage ?? '');
                if (!PLAN_PROMPT.test(prompt)) return send.call(this, turns, systemMessage);
                plans.push({ missing: (/What is missing: ([^\n]*)/.exec(prompt) ?? [])[1] ?? '', t: Date.now() });
                console.log(`PLAN prompt ${plans.length}: missing ${JSON.stringify(plans[plans.length - 1].missing)} -> !fetchItem("bread", 8)`);
                return '!fetchItem("bread", 8)';
            };

            // ---------------------------------------------------------- 0. the known chest, the mine, the ore, the hunger
            const view = await orders.order('!viewChest', 30000);
            const known = agent.packContext().chests?.get(c);
            note(`0: "check the chest" (!viewChest) answered ${JSON.stringify(view.slice(0, 200))}; the chest index knows ${JSON.stringify(known?.items ?? null)}`);
            check(Boolean(known) && (known.items?.bread || 0) === 12, '0: precondition: the bot knows the chest of the house with 12 bread (chest index), 20 blocks above the mine', JSON.stringify(known?.items ?? null));
            await playerOutOfHouse(b, { x: c.x - 3, y: c.y, z: c.z - 3 });
            const out = orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 60000);
            const came = await waitBot(agent, '0: "come here" from outside: the bot is beside the player', near(3), 60000);
            note(`0: "come here" answered ${JSON.stringify((await out).reply.slice(0, 200))}`);
            check(came.ok, '0: precondition: the bot came out of the house to the player', fmt(came.bot));
            const taught = await partTeachMineInRoom({ ...j, b }, { tunnel: t });
            if (!taught.ok) {
                check(false, '0: the bot learned the mine and its tunnel (precondition of the job); the rest is not run');
                return;
            }
            const ores = [2, 4, 6].flatMap((k) => [0, 1].map((dy) => ({ ...t.beyond(k), y: t.level + dy })));
            await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
            // "go to the end of the tunnel": the bot starts the job at the rock face, as the owner's bot was deep in the
            // tunnel; the bread chest is then 11 blocks away, within the 16 of P1 and out of a glance
            const walk = await walkTyped(orders, agent, t.end);
            check(walk.arrived, '0: precondition: "go to the end of the tunnel" brings the bot to the rock face', fmt(walk.pos));
            await commands(['difficulty easy', `gamemode survival ${NAME}`]);
            const food0 = await foodTo(NAME, FOOD);
            const inv0 = await inventoryOf(NAME);
            const chest0 = await chestItems(chest);
            note(`0: 6 iron ore beyond the rock face; the food level ${food0} of 20; the bot carries ${itemsText(inv0)} at ${fmt(await entityPos(NAME))}; the chest holds ${itemsText(chest0)}`);
            check(food0 <= FOOD && food0 >= FOOD - 3 && !inv0.bread && !Object.keys(inv0).some((k) => /bread|apple|beef|pork|carrot|potato|cod|salmon|chicken|mutton/.test(k)),
                `0: precondition: the food level is ${FOOD} of 20 (or just under) and the bot carries no food`, `food ${food0}, carries ${itemsText(inv0)}`);
            check((chest0?.bread || 0) === BREAD, `0: precondition: the chest beside the tunnel holds ${BREAD} bread`, itemsText(chest0));

            // ---------------------------------------------------------- 1. the order, the bread
            trace = journeyTrace(agent, b);
            const ys = startTrace(async () => ({ pos: await entityPos(NAME) }), 500);
            const tOrder = Date.now();
            const order = orders.orderInfo('!mineOre("iron", 6)', 240000);
            const took = await waitFor(async () => {
                const c = await chestItems(chest);
                const inv = await inventoryOf(NAME);
                return (c?.bread ?? BREAD) < BREAD && (inv.bread || 0) > 0 ? { chest: c, inv } : null;
            }, { ms: 60000, every: 1000 });
            const rows = await ys.stop();
            const chest1 = took.value?.chest ?? await chestItems(chest);
            const inv1 = took.value?.inv ?? await inventoryOf(NAME);
            const maxY = rows.reduce((m, x) => Math.max(m, x.pos ? x.pos.y : -Infinity), -Infinity);
            const supply = saidLines(s, tOrder).find((l) => SUPPLY.test(l)) ?? null;
            note(`1: ${((Date.now() - tOrder) / 1000).toFixed(1)} s after the order: the chest holds ${itemsText(chest1)}, the bot carries ${itemsText(inv1)}, its highest feet y ${maxY.toFixed(1)} (the room's level ${roomY}); plan prompts ${plans.length} ${JSON.stringify(plans.map((p) => p.missing))}`);
            note(`1: the bot said ${JSON.stringify(saidLines(s, tOrder).slice(0, 20))}`);
            check(took.ok, `1: within 60 s the bot took bread from the chest beside the tunnel (the chest's count fell below ${BREAD}, the bag holds bread; server)`, `chest ${chest1?.bread ?? '?'} bread, bag ${inv1.bread || 0} bread`);
            check(maxY <= roomY + 3, `1: the bot did not climb to the surface for it (its feet never above y ${roomY + 3} while it fetched the bread)`, `highest y ${maxY.toFixed(1)}`);
            check(Boolean(supply), `1: the supply text names the chest: \`I get my supplies: N bread from the chest at (${chest.x}, ${chest.y}, ${chest.z}).\``, JSON.stringify(saidLines(s, tOrder).filter((l) => /suppl|bread|chest/i.test(l)).slice(0, 5)));

            // ---------------------------------------------------------- 2. the mining goes on
            const mined = await waitFor(async () => ((await inventoryOf(NAME)).raw_iron || 0) >= 6, { ms: Math.max(1000, 180000 - (Date.now() - tOrder)), every: 2000 });
            const inv2 = await inventoryOf(NAME);
            note(`2: ${((Date.now() - tOrder) / 1000).toFixed(0)} s after the order the bot carries ${itemsText(inv2)} at ${fmt(await entityPos(NAME))}; food ${await entityNumber(NAME, 'foodLevel')} of 20`);
            check(mined.ok && (inv2.raw_iron || 0) >= 6, '2: the mining went on: 6 raw_iron in the bag within 3 minutes of the order (server)', `${inv2.raw_iron || 0} raw_iron`);
            const info = await Promise.race([order, sleep(1000).then(() => null)]);
            note(`2: the order ${info ? `answered ${JSON.stringify(info.reply.slice(0, 300))}` : 'still runs (the way back up)'}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`effect clear ${NAME}`, 'difficulty peaceful']).catch(() => {});
            if (trace) printJourney('the bread beside the tunnel', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
