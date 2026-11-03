// W120 the worn pickaxe and a block only it breaks (v0.1.4.13 fix 2; the play of 2026-10-06: the bot hung twice in the
// deep mine). Mining iron, the bot carried an iron pickaxe worn to 9 uses and a fresh stone one; the next block needed
// iron (deepslate diamond ore). The dig answered worn, the replacement put the worn iron one back in hand ("I take my
// spare one.") and that repeated 55 times a second until the process was restarted. Before fix 2 the scenario hangs
// (the runner's time limit) or fails at the checks of the spare text and the iron.
//
// The owner variant of the base with the room tunnel of base_world.js, the owner's switches of v0.1.4.12 and of this
// release (SUPERVISION_SETTINGS), the modes of his profile, an empty memory. The kit: 16 torches, 8 ladders, 4 bread,
// 8 cobblestone, 2 sticks, a fresh stone pickaxe and an iron pickaxe worn to 9 uses (given with damage 241 of 250).
// The bot is never moved by the control.
//   0. The player teaches the mine in the room with its tunnel (journey.js partTeachMineInRoom). Beyond the rock face:
//      deepslate diamond ore at 1 block (feet and head), iron ore at 3, 5 and 7 (feet and head).
//   1. Typed !mineOre("iron", 6): within 3 minutes the bag holds 6 raw_iron (server); the two diamond ore blocks are
//      gone and the bag holds 2 diamonds; `I take my spare one.` was said at most once; the iron pickaxe is not broken
//      (it is still in the bag); the stone pickaxe dug the rest.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, itemDamages } from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, itemsText, blockNames } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMineInRoom, spots, saidLines, SUPERVISION_SETTINGS, journeyTrace, printJourney, countItem } from './journey.js';

const NAME = 'w_wornblk';
const KIT = [['torch', 16], ['ladder', 8], ['bread', 4], ['cobblestone', 8], ['stick', 2], ['stone_pickaxe', 1]];
const DURABILITY = 250; // of an iron pickaxe
const USES = 9;
const SPARE = /I take my spare one\./;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
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
            await commands([`give ${NAME} minecraft:iron_pickaxe[minecraft:damage=${DURABILITY - USES}] 1`]);
            await waitFor(() => countItem(agent, 'iron_pickaxe') >= 1, { ms: 8000, every: 100 });
            await sleep(300);
            const damages0 = await itemDamages(NAME, 'iron_pickaxe');
            note(`the bot carries ${itemsText(await inventoryOf(NAME))}; the damage of its iron_pickaxe ${JSON.stringify(damages0)} (${USES} uses left of ${DURABILITY})`);
            check(damages0.length === 1 && damages0[0] === DURABILITY - USES, `precondition: the bot carries one iron_pickaxe worn to ${USES} uses and a stone pickaxe`, JSON.stringify(damages0));

            // ---------------------------------------------------------- 0. the mine, the ore
            const taught = await partTeachMineInRoom({ ...j, b }, { tunnel: t });
            if (!taught.ok) {
                check(false, '0: the bot learned the mine and its tunnel (precondition of the job); the rest is not run');
                return;
            }
            const diamonds = [0, 1].map((dy) => ({ ...t.beyond(1), y: t.level + dy }));
            const ores = [3, 5, 7].flatMap((k) => [0, 1].map((dy) => ({ ...t.beyond(k), y: t.level + dy })));
            await commands([
                ...diamonds.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:deepslate_diamond_ore`),
                ...ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`),
            ]);
            note(`0: deepslate diamond ore at ${diamonds.map(fmt).join(' ')}, iron ore at ${ores.map(fmt).join(' ')}`);

            // ---------------------------------------------------------- 1. the order
            trace = journeyTrace(agent, b);
            const tOrder = Date.now();
            const order = orders.orderInfo('!mineOre("iron", 6)', 240000);
            const mined = await waitFor(async () => ((await inventoryOf(NAME)).raw_iron || 0) >= 6, { ms: 180000, every: 2000 });
            await sleep(1000);
            const inv = await inventoryOf(NAME);
            const damages = await itemDamages(NAME, 'iron_pickaxe');
            const left = await blockNames(diamonds, ['deepslate_diamond_ore']).catch(() => []);
            const said = saidLines(s, tOrder);
            const spares = said.filter((l) => SPARE.test(l));
            note(`1: ${((Date.now() - tOrder) / 1000).toFixed(0)} s after the order the bot carries ${itemsText(inv)} at ${fmt(await entityPos(NAME))}; the damage of its iron_pickaxe ${JSON.stringify(damages)}; the diamond cells ${JSON.stringify(left)}`);
            note(`1: the bot said ${JSON.stringify(said.slice(0, 30))}`);
            check(mined.ok && (inv.raw_iron || 0) >= 6, '1: the mining ends with 6 raw_iron in the bag (server) within 3 minutes', `${inv.raw_iron || 0} raw_iron`);
            check(!left.some((n) => /diamond_ore/.test(n ?? '')) && (inv.diamond || 0) >= 2, '1: the two diamond ore blocks were dug with the iron pickaxe: gone, 2 diamonds in the bag (server)', `${JSON.stringify(left)}, ${inv.diamond || 0} diamond`);
            check(spares.length <= 1, '1: `I take my spare one.` was said at most once (no loop)', `${spares.length} times`);
            check(damages.length === 1, '1: the iron pickaxe is not broken: it is still in the bag (server)', JSON.stringify(damages));
            check((inv.stone_pickaxe || 0) >= 1, '1: the stone pickaxe is still in the bag (server)', itemsText(inv));
            const info = await Promise.race([order, sleep(1000).then(() => null)]);
            note(`1: the order ${info ? `answered ${JSON.stringify(info.reply.slice(0, 300))}` : 'still runs (the way back up)'}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (trace) printJourney('the worn pickaxe and a block only it breaks', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
