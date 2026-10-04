// W114 the worn pickaxe (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 3.2, SPEC section 1 and 4.4 P2): the
// pickaxe at 10 uses is replaced before it breaks and the mining goes on. Today (v0.1.4.12) the bot mines with a pickaxe
// at 2 uses and stops with "I stopped because my pickaxe is nearly broken" (the play of 2026-10-04): the scenario fails
// at the check of the 6 raw_iron or of the new pickaxe.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists) with the room
// tunnel of base_world.js (the crafting table of the room is within 16 blocks of the dig), the owner's switches of
// v0.1.4.12 and of this release (SUPERVISION_SETTINGS), the modes of his profile, an empty memory. The kit: an iron
// pickaxe worn to 12 uses (given with damage 238 of 250), 16 torches, 8 ladders, 4 bread, 3 iron_ingot and 2 sticks.
// The bot is never moved by the control.
//   0. The player teaches the mine in the room with its tunnel (journey.js partTeachMineInRoom). 6 iron ore beyond the
//      rock face, feet and head at 2, 4 and 6 blocks: 12 blocks to dig or more, more than the pickaxe has.
//   1. Typed !mineOre("iron", 6): within 3 minutes the bag holds 6 raw_iron (server); it holds a new iron_pickaxe and the
//      old one (2 iron_pickaxe, one with damage 238 or more, one with little); the wear text was said: `My iron_pickaxe
//      is nearly worn: N uses left. I made a new one.`; no stop for the pickaxe (`I stopped because my pickaxe is nearly
//      broken` never said).
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, itemDamages } from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, itemsText } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMineInRoom, spots, saidLines, SUPERVISION_SETTINGS, journeyTrace, printJourney, countItem } from './journey.js';

const NAME = 'w_worn';
const KIT = [['torch', 16], ['ladder', 8], ['bread', 4], ['iron_ingot', 3], ['stick', 2]];
const DURABILITY = 250; // of an iron pickaxe
const USES = 12;
// The lead, 2026-10-04 (T3's point 6): the spare may have been made before the trip (P1, under 50 uses) and taken from the
// bag at the wear limit (P2's second text); both texts say a replacement happened, the facts above say which
const WEAR = /^My iron_pickaxe is nearly worn: (\d+) uses left\. I (made a new one|take my spare one)\.$/;
const BROKEN_STOP = /I stopped because my pickaxe is nearly broken/;

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
        let agent = null, orders = null, trace = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: SUPERVISION_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            // the worn pickaxe: given with its damage (the control gives it, as the owner's chest would)
            await commands([`give ${NAME} minecraft:iron_pickaxe[minecraft:damage=${DURABILITY - USES}] 1`]);
            await waitFor(() => countItem(agent, 'iron_pickaxe') >= 1, { ms: 8000, every: 100 });
            await sleep(300);
            const damages0 = await itemDamages(NAME, 'iron_pickaxe');
            note(`the bot carries ${itemsText(await inventoryOf(NAME))}; the damage of its iron_pickaxe ${JSON.stringify(damages0)} (${USES} uses left of ${DURABILITY})`);
            check(damages0.length === 1 && damages0[0] === DURABILITY - USES, `precondition: the bot carries one iron_pickaxe worn to ${USES} uses`, JSON.stringify(damages0));

            // ---------------------------------------------------------- 0. the mine, the ore
            const taught = await partTeachMineInRoom({ ...j, b }, { tunnel: t });
            if (!taught.ok) {
                check(false, '0: the bot learned the mine and its tunnel (precondition of the job); the rest is not run');
                return;
            }
            const ores = [2, 4, 6].flatMap((k) => [0, 1].map((dy) => ({ ...t.beyond(k), y: t.level + dy })));
            await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
            const damages1 = await itemDamages(NAME, 'iron_pickaxe');
            note(`0: 6 iron ore beyond the rock face at ${ores.map(fmt).join(' ')}; the pickaxe's damage ${JSON.stringify(damages1)} after the walk`);

            // ---------------------------------------------------------- 1. the order
            trace = journeyTrace(agent, b);
            const tOrder = Date.now();
            const order = orders.orderInfo('!mineOre("iron", 6)', 240000);
            const mined = await waitFor(async () => ((await inventoryOf(NAME)).raw_iron || 0) >= 6, { ms: 180000, every: 2000 });
            await sleep(1000);
            const inv = await inventoryOf(NAME);
            const damages = await itemDamages(NAME, 'iron_pickaxe');
            const said = saidLines(s, tOrder);
            const wear = said.find((l) => WEAR.test(l)) ?? null;
            note(`1: ${((Date.now() - tOrder) / 1000).toFixed(0)} s after the order the bot carries ${itemsText(inv)} at ${fmt(await entityPos(NAME))}; the damage of its iron_pickaxe ${JSON.stringify(damages)}`);
            note(`1: the bot said ${JSON.stringify(said.slice(0, 30))}`);
            check(mined.ok && (inv.raw_iron || 0) >= 6, '1: the mining ends with 6 raw_iron in the bag (server) within 3 minutes', `${inv.raw_iron || 0} raw_iron`);
            const oldOne = damages.filter((d) => d >= DURABILITY - USES).length;
            const newOne = damages.filter((d) => d < DURABILITY - USES - 20).length;
            check(damages.length >= 2 && oldOne >= 1 && newOne >= 1, '1: the bag holds a new iron_pickaxe and the old one (server: 2 iron_pickaxe, one worn, one new)', `damages ${JSON.stringify(damages)}, ${inv.iron_pickaxe || 0} iron_pickaxe`);
            check(Boolean(wear), '1: the wear text was said: `My iron_pickaxe is nearly worn: N uses left. I made a new one.` or `... I take my spare one.`', JSON.stringify(said.filter((l) => /worn|pickaxe/i.test(l)).slice(0, 4)));
            if (wear) check(Number(WEAR.exec(wear)[1]) <= 10, '1: the wear text names 10 uses or fewer (the rule of P2)', wear);
            check(!said.some((l) => BROKEN_STOP.test(l)), '1: no "nearly broken" stop', JSON.stringify(said.filter((l) => BROKEN_STOP.test(l))));
            const info = await Promise.race([order, sleep(1000).then(() => null)]);
            note(`1: the order ${info ? `answered ${JSON.stringify(info.reply.slice(0, 300))}` : 'still runs (the way back up)'}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (trace) printJourney('the worn pickaxe', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
