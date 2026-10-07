// W118 the full bag (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 3.10, SPEC section 1 and 4.6 Q4): a full bag
// during the mining is stored in the chest of the mine and the mining goes on. Today (v0.1.4.12) the mining stops when
// the bag is full (the play of 2026-10-04): the scenario fails at the check of the 6 raw_iron or of the store text.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists) with the room
// tunnel of base_world.js; the chest of the room holds cobblestone with 20 free slots. The owner's switches of v0.1.4.12
// and of this release (SUPERVISION_SETTINGS), the modes of his profile, an empty memory. The kit: an iron pickaxe, 16
// torches, 8 ladders, 4 bread, and after the mine is taught 30 stacks of torches more (a kind the trip keeps, see FILLER):
// the bag is full but 2 slots. The bot is never moved by the control.
//   0. The player teaches the mine in the room with its tunnel (journey.js partTeachMineInRoom). Beyond the rock face
//      the tunnel's line is seeded with gravel (1 block in), iron ore (2, 4, 6) and cobblestone (3, 5), feet and head:
//      the dig yields gravel, raw_iron, cobblestone (and flint): more kinds than the 2 free slots hold.
//   1. Typed !mineOre("iron", 6): within 3 minutes the bag holds 6 raw_iron (server); the chest of the room holds more
//      than before (server; since fix 2 of v0.1.4.13 the bag keeps 3 of each stone kind for a new pickaxe); the store text was said: `I stored ... in the chest at (x, y, z) and go on.`
//      with the room chest; no stop for the bag (`My bag is full` never said).
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, giveItems } from './helpers.js';
import { region, prepareRegion, releaseRegion, buildFullChest, chestItems, chestFreeSlots, inventoryOf, itemsText } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMineInRoom, spots, saidLines, SUPERVISION_SETTINGS, journeyTrace, printJourney } from './journey.js';

const NAME = 'w_fullbag';
const KIT = [['iron_pickaxe', 1], ['torch', 16], ['ladder', 8], ['bread', 4]];
// 30 stacks of torches on top of the kit's 16 (31 slots): with the pickaxe, the ladders and the bread 34 of 36 slots are
// taken. Torches, not cobblestone: the supply step of v0.1.4.12 stores what the trip does not need in the chest of the
// room before it digs (the first baseline run: 20 stacks of cobblestone went in, the bag had room again), while torches
// are kept by the trip and left out of Q4's store, so the bag fills during the mining, as the owner's did
const FILLER = 30 * 64;
const BAG_FULL = /My bag is full/;

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
        const chest = b.room.chest;
        await buildFullChest(chest, 'cobblestone', { free: 20 });
        const STORED = new RegExp(`^I stored .+ in the chest at \\(${chest.x}, ${chest.y}, ${chest.z}\\) and go on\\.$`);
        let agent = null, orders = null, trace = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: SUPERVISION_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;

            // ---------------------------------------------------------- 0. the mine, the seeded tunnel, the bag
            const taught = await partTeachMineInRoom({ ...j, b }, { tunnel: t });
            if (!taught.ok) {
                check(false, '0: the bot learned the mine and its tunnel (precondition of the job); the rest is not run');
                return;
            }
            const seed = { 1: 'gravel', 2: 'iron_ore', 3: 'cobblestone', 4: 'iron_ore', 5: 'cobblestone', 6: 'iron_ore' };
            const cmds = [];
            for (const [k, block] of Object.entries(seed)) for (const dy of [0, 1]) { const p = { ...t.beyond(Number(k)), y: t.level + dy }; cmds.push(`setblock ${p.x} ${p.y} ${p.z} minecraft:${block}`); }
            await commands(cmds);
            await giveItems(NAME, [['torch', FILLER]], agent.bot);
            await sleep(500);
            const inv0 = await inventoryOf(NAME);
            const slots0 = agent.bot.inventory.items().length;
            const free0 = 36 - slots0;
            const chest0 = await chestItems(chest);
            const chestFree0 = await chestFreeSlots(chest);
            note(`0: the tunnel beyond the rock face seeded ${JSON.stringify(seed)}; the bot carries ${itemsText(inv0)} in ${slots0} slots (${free0} free); the chest of the room holds ${itemsText(chest0)} with ${chestFree0} free slots`);
            check(free0 === 2, '0: precondition: the bag is full but 2 slots', `${free0} free slots`);
            check(chestFree0 === 20, '0: precondition: the chest of the room has 20 free slots', `${chestFree0}`);

            // ---------------------------------------------------------- 1. the order
            trace = journeyTrace(agent, b);
            const tOrder = Date.now();
            const order = orders.orderInfo('!mineOre("iron", 6)', 240000);
            const mined = await waitFor(async () => ((await inventoryOf(NAME)).raw_iron || 0) >= 6, { ms: 180000, every: 2000 });
            await sleep(1000);
            const inv = await inventoryOf(NAME);
            const chest1 = await chestItems(chest);
            const said = saidLines(s, tOrder);
            const stored = said.find((l) => STORED.test(l)) ?? null;
            note(`1: ${((Date.now() - tOrder) / 1000).toFixed(0)} s after the order the bot carries ${itemsText(inv)} at ${fmt(await entityPos(NAME))}; the chest of the room holds ${itemsText(chest1)} (${await chestFreeSlots(chest)} free)`);
            note(`1: the bot said ${JSON.stringify(said.slice(0, 30))}`);
            check(mined.ok && (inv.raw_iron || 0) >= 6, '1: the mining ends with 6 raw_iron in the bag (server) within 3 minutes', `${inv.raw_iron || 0} raw_iron`);
            // v0.1.4.13 fix 2: the store keeps 3 of each stone kind for a new pickaxe, so the chest gains what was stored,
            // cobblestone only beyond those 3
            const total = (c) => Object.values(c ?? {}).reduce((n, k) => n + (Number(k) || 0), 0);
            check(total(chest1) > total(chest0), '1: the chest of the room holds what the bot stored (more than before; server)', `${JSON.stringify(chest0)} -> ${JSON.stringify(chest1)}`);
            check((inv.cobblestone || 0) <= 3 + 6, '1: the bag keeps a few cobblestone for a new pickaxe, not a pile (server)', `${inv.cobblestone || 0} cobblestone`);
            check(Boolean(stored), `1: the store text was said: \`I stored ... in the chest at (${chest.x}, ${chest.y}, ${chest.z}) and go on.\``, JSON.stringify(said.filter((l) => /stored|chest|bag/i.test(l)).slice(0, 4)));
            check(!said.some((l) => BAG_FULL.test(l)), '1: no stop for the bag (`My bag is full` never said)', JSON.stringify(said.filter((l) => BAG_FULL.test(l))));
            const info = await Promise.race([order, sleep(1000).then(() => null)]);
            note(`1: the order ${info ? `answered ${JSON.stringify(info.reply.slice(0, 300))}` : 'still runs (the way back up)'}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (trace) printJourney('the full bag', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
