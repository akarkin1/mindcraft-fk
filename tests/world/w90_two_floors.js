// W90 the house and the basement are two places (journey of v0.1.4.10 "Goals", tester T3; PLAN.md 3.2 and 3.3,
// CHANGELOG "Floors"): the owner's area "home" spanned both floors (y 55 to 71), so the basement was the house.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with job_memory and area_floors on, the modes of his profile, an empty memory. The bed of the house is
// moved to the basement (the owner sleeps there: "the shelter is the floor with the bed"). The bot is never moved by
// the control.
//   1. The bot and the player in the house: typed !rememberArea("home") ("this is home") gives an area of the house
//      floor only: y 60 to 65 (the floor g to the roof g+5), nothing of the basement (y 52 to 56).
//   2. The player in the basement: typed !goToPlayer brings the bot down; typed !rememberArea("basement") ("this is the
//      basement") gives a second area, inside y 52 to 56, not "That is the area "home" already.".
//   3. The player in the house: !goToPlayer brings the bot up; typed !rememberArea("basement") from the house answers
//      `That is the area "home" already.` and no area changes.
//   4. Night: typed !goToBed ("let's sleep") from the house: the bot sleeps (its view and the server) in the bed of
//      the basement within 120 s, and answers "I slept. It is morning." after the morning.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, serverSleeping, tp } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, GOALS_SETTINGS, spots, PLAYER, inBasement, playerDownToBasement, playerUpToHouse, walkPlayer, line, saidLines } from './journey.js';

const NAME = 'w_floors';
const areaText = (a) => (a ? `${a.name} (${a.type}) (${a.min.x}, ${a.min.y}, ${a.min.z}) to (${a.max.x}, ${a.max.y}, ${a.max.z})` : 'none');

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const sp = spots(b);
        const g = b.g;
        const bm = b.owner.basement.box;
        // the bed moves to the basement: foot (-1, 53, 1), head (-1, 53, 2) from the origin, facing south
        const bed = { foot: { x: b.ox - 1, y: bm.min.y, z: b.oz + 1 }, head: { x: b.ox - 1, y: bm.min.y, z: b.oz + 2 } };
        await commands([
            `fill ${b.house.bedFoot.x} ${b.house.bedFoot.y} ${b.house.bedFoot.z} ${b.house.bedHead.x} ${b.house.bedHead.y} ${b.house.bedHead.z} minecraft:air`,
            `setblock ${bed.foot.x} ${bed.foot.y} ${bed.foot.z} minecraft:red_bed[facing=south,part=foot]`,
            `setblock ${bed.head.x} ${bed.head.y} ${bed.head.z} minecraft:red_bed[facing=south,part=head]`,
        ]);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { x: sp.houseMiddle.x - 1, y: g + 1, z: sp.houseMiddle.z + 1 }, playerAt: sp.besideTrapdoor, settings: GOALS_SETTINGS({ area_floors: true }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const areas = () => agent.area_store?.list?.() ?? [];
            const come = async (label, pred, ms) => {
                const info = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, ms);
                const at = await entityPos(NAME);
                note(`${label}: !goToPlayer answered ${JSON.stringify(info.reply.slice(0, 200))}; the bot at ${fmt(at)}`);
                check(info.done && pred(at) && dist(at, await entityPos(PLAYER)) <= 4, label, fmt(at));
            };

            // ---------------------------------------------------------- 1. home upstairs
            const home = await orders.order('!rememberArea("home")', 90000);
            const h = agent.area_store?.get?.('home') ?? null;
            note(`1: !rememberArea("home") answered ${JSON.stringify(home.slice(0, 300))}; the area ${areaText(h)}`);
            check(Boolean(h), '1: "this is home" upstairs saves the area "home"', JSON.stringify(home.slice(0, 200)));
            check(h && h.min.y >= g && h.max.y <= g + 5 && h.max.y >= g + 2, `1: the area "home" is the house floor only: y ${g} to ${g + 5}, nothing of the basement (y ${bm.min.y - 1} to ${bm.max.y + 1})`, areaText(h));
            const homeBox = h ? JSON.stringify({ min: h.min, max: h.max }) : null;

            // ---------------------------------------------------------- 2. the basement
            await playerDownToBasement(b);
            await come('2: "come here" from the basement brings the bot down within 60 s', (a) => inBasement(b, a), 60000);
            const base = await orders.order('!rememberArea("basement")', 90000);
            const bsm = agent.area_store?.get?.('basement') ?? null;
            note(`2: !rememberArea("basement") answered ${JSON.stringify(base.slice(0, 300))}; the area ${areaText(bsm)}; all ${JSON.stringify(areas().map(areaText))}`);
            check(!/That is the area "home" already\./.test(base), '2: in the basement the scan is not taken for the area "home"', JSON.stringify(base.slice(0, 200)));
            check(bsm && bsm.min.y >= bm.min.y - 1 && bsm.max.y <= bm.max.y + 1, `2: "this is the basement" gives a second area inside y ${bm.min.y - 1} to ${bm.max.y + 1}`, areaText(bsm));
            const basementBox = bsm ? JSON.stringify({ min: bsm.min, max: bsm.max }) : null;

            // ---------------------------------------------------------- 3. "this is the basement" from the house
            await playerUpToHouse(b, sp.basementWait);
            await walkPlayer(line(sp.besideTrapdoor, { x: sp.houseMiddle.x, y: g + 1, z: sp.besideTrapdoor.z }));
            await come('3: "come here" from the house brings the bot up within 60 s', (a) => inBox(a, b.house.interior), 60000);
            const again = await orders.order('!rememberArea("basement")', 90000);
            const h2 = agent.area_store?.get?.('home') ?? null;
            const b2 = agent.area_store?.get?.('basement') ?? null;
            note(`3: !rememberArea("basement") from the house answered ${JSON.stringify(again.slice(0, 300))}; home ${areaText(h2)}, basement ${areaText(b2)}`);
            check(/That is the area "home" already\./.test(again), '3: "this is the basement" from the house answers `That is the area "home" already.`', JSON.stringify(again.slice(0, 200)));
            check(areas().length === 2 && JSON.stringify(h2 ? { min: h2.min, max: h2.max } : null) === homeBox && JSON.stringify(b2 ? { min: b2.min, max: b2.max } : null) === basementBox,
                '3: no area changed (2 areas, home and basement as saved)', JSON.stringify(areas().map(areaText)));

            // ---------------------------------------------------------- 4. the bed of the basement
            await tp(PLAYER, { x: sp.houseMiddle.x + 2, y: g + 1, z: sp.houseMiddle.z });
            await commands(['time set 13000']);
            await sleep(1500);
            const tBed = Date.now();
            const sleepOrder = orders.orderInfo('!goToBed', 240000);
            const slept = await waitFor(async () => agent.bot.isSleeping === true && (await serverSleeping(NAME)), { ms: 120000, every: 500 });
            const at = await entityPos(NAME);
            note(`4: the bot ${slept.ok ? `sleeps after ${((Date.now() - tBed) / 1000).toFixed(1)} s` : 'does not sleep within 120 s'} at ${fmt(at)}; the bed of the basement at ${fmt(bed.foot)}`);
            if (slept.ok) await commands(['time set 1000']);
            const bedInfo = await sleepOrder;
            note(`4: !goToBed answered ${JSON.stringify(bedInfo.reply.slice(0, 300))}`);
            check(slept.ok && at && dist(at, { x: bed.foot.x + 0.5, y: bed.foot.y, z: bed.foot.z + 1 }) <= 2.5, '4: "let\'s sleep" at night: the bot sleeps in the bed of the basement within 120 s', fmt(at));
            check(/I slept\. It is morning\./.test(bedInfo.reply), '4: the answer of !goToBed is "I slept. It is morning."', JSON.stringify(bedInfo.reply.slice(0, 200)));

            note(`the bot said ${JSON.stringify(saidLines(s).slice(0, 30))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['gamerule doDaylightCycle false', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
