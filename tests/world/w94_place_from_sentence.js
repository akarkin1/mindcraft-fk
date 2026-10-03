// W94 a place from one sentence (journey of v0.1.4.11 "Navigation and words", tester T3; PLAN.md 3.1 to 3.5, SPEC
// section 7, I5 and P1): "we are in the aviary" saves the area with the kind the bot concludes from what it finds.
// Today (v0.1.4.10) nothing was saved, or a rule attached to no area (PLAN.md section 1), and !rememberArea without a
// type answered "I stand inside a fence, so I saved the pen." with no kind and no contents.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with the three of v0.1.4.11 on, the modes of his profile (item_collecting on), an empty memory. The pen of
// the base holds its cow and its chicken and 5 more chickens (6 chickens, as the owner's aviary). The bot is never
// moved by the control.
//   1. The bot and the player in the pen. "we are in the aviary" !rememberArea("aviary"): `I saved "aviary": a pen,
//      fenced, 9 x 9, 1 gate, 6 chickens, 1 cow. I keep its gate closed and pick nothing up inside it.` (P1; 7 x 7 for
//      the inner size is accepted); the area holds the pen.
//   2. The player in the farm, "come here" !goToPlayer("w_player", 2); "this is the farmland"
//      !rememberArea("farmland"): `I saved "farmland": a farm, fenced, 9 x 9, 1 gate, 47 wheat... I only plant and
//      harvest there.`; the area holds the farm.
//   3. The player in the house, "come here"; "this is home" !rememberArea("home"): `I saved "home": a home, walled,
//      9 x 11 with a roof, 1 door, 1 bed, 1 chest. I shelter there at night.` (a trapdoor of the floor may be named
//      after the door); the area holds the house floor.
//   4. The player outside in front of the gate of the pen, "come here"; the gate the bot walked out of in step 2 is
//      closed (the door service), and the owner closes it himself anyway; 8 oak_fence dropped as items inside the pen.
//      Within 60 s: the gate is closed all the time (sampled), the items lie there still, the bot never entered the
//      pen, and it said `I leave the oak_fence in the pen "aviary"`.
//   5. "No, it is a farm" !rememberArea("aviary", "farm"): `"aviary" is a farm now.`; the area "aviary" is a farm.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, startTrace, waitFor } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen, setOpen, itemsOnGround } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, JOURNEY_SETTINGS, PLAYER, playerIntoHouse, saidLines, walkPlayer, line } from './journey.js';

const NAME = 'w_places';
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true });
const EXTRA_CHICKENS = 5;
const AVIARY = /I saved "aviary": a pen, fenced, (9 x 9|7 x 7), 1 gate, 6 chickens, 1 cow\. I keep its gate closed and pick nothing up inside it\./;
const FARMLAND = /I saved "farmland": a farm, fenced, (9 x 9|7 x 7), 1 gate, (\d+) wheat\b[^.]*\. I only plant and harvest there\./;
const HOME = /I saved "home": a home, walled, (9 x 11|7 x 9) with a roof, 1 door(, 1 trapdoor)?, 1 bed, 1 chest\. I shelter there at night\./;
const areaText = (a) => (a ? `${a.name} (type ${a.type}, kind ${a.kind}) (${a.min.x}, ${a.min.y}, ${a.min.z}) to (${a.max.x}, ${a.max.y}, ${a.max.z})` : 'none');

// The area holds `inner` and lies within `box` grown by 1 block in x and z.
function holds(area, box, inner) {
    if (!area?.min || !area?.max) return false;
    const c = { x: inner.x + 0.5, y: inner.y, z: inner.z + 0.5 };
    const within = area.min.x >= box.min.x - 1 && area.max.x <= box.max.x + 1 && area.min.z >= box.min.z - 1 && area.max.z <= box.max.z + 1;
    return within && inBox(c, area);
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const g = b.g;
        const pen = b.pen;
        const f = b.farm;
        const h = b.house;
        const extra = [];
        for (let k = 0; k < EXTRA_CHICKENS; k++) {
            const p = { x: pen.inner.min.x + 1 + k, y: g + 1, z: pen.inner.max.z - 1 };
            extra.push(`summon minecraft:chicken ${p.x + 0.5} ${p.y} ${p.z + 0.5} {PersistenceRequired:1b,Tags:["${pen.tag}","${pen.tag}_extra"]}`);
        }
        await commands(extra);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: pen.inside, playerAt: { x: pen.inside.x, y: g + 1, z: pen.inside.z - 2 }, settings: SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const area = (name) => agent.area_store?.get?.(name) ?? null;
            const come = async (label, box) => {
                const info = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 90000);
                await sleep(1500);
                const at = await entityPos(NAME);
                note(`${label}: "come here" answered ${JSON.stringify(info.reply.slice(0, 200))}; the bot at ${fmt(at)}`);
                check(inBox(at, box), `${label}: precondition: "come here" brings the bot there`, fmt(at));
            };

            // ---------------------------------------------------------- 1. the aviary
            const one = await orders.order('!rememberArea("aviary")', 90000);
            note(`1: !rememberArea("aviary") answered ${JSON.stringify(one)}; the area ${areaText(area('aviary'))}`);
            check(AVIARY.test(one), '1: "we are in the aviary": `I saved "aviary": a pen, fenced, 9 x 9, 1 gate, 6 chickens, 1 cow. I keep its gate closed and pick nothing up inside it.`', JSON.stringify(one));
            check(holds(area('aviary'), pen.box, pen.inside), '1: the area "aviary" holds the pen', areaText(area('aviary')));

            // ---------------------------------------------------------- 2. the farmland
            // around the house (north of it) to the gate of the farm
            const north = { x: pen.inside.x, y: g + 1, z: h.box.min.z - 3 };
            await walkPlayer([...line(pen.inside, north), ...line(north, f.outsideGate), f.gate, f.inside], 150);
            await come('2: in the farm', { min: { x: f.box.min.x + 1, y: g, z: f.box.min.z + 1 }, max: { x: f.box.max.x - 1, y: g + 2, z: f.box.max.z - 1 } });
            const two = await orders.order('!rememberArea("farmland")', 90000);
            const wheat = FARMLAND.exec(two);
            note(`2: !rememberArea("farmland") answered ${JSON.stringify(two)}; the area ${areaText(area('farmland'))}; the farm has ${f.crops.length} wheat`);
            check(Boolean(wheat) && Number(wheat[2]) === f.crops.length, `2: "this is the farmland": \`I saved "farmland": a farm, fenced, 9 x 9, 1 gate, ${f.crops.length} wheat... I only plant and harvest there.\``, JSON.stringify(two));
            check(holds(area('farmland'), f.box, f.inside), '2: the area "farmland" holds the farm', areaText(area('farmland')));

            // ---------------------------------------------------------- 3. home
            const pAt = await entityPos(PLAYER);
            await playerIntoHouse(b, { x: Math.floor(pAt.x), y: g + 1, z: Math.floor(pAt.z) });
            await come('3: in the house', h.interior);
            const three = await orders.order('!rememberArea("home")', 90000);
            note(`3: !rememberArea("home") answered ${JSON.stringify(three)}; the area ${areaText(area('home'))}`);
            check(HOME.test(three), '3: "this is home": `I saved "home": a home, walled, 9 x 11 with a roof, 1 door, 1 bed, 1 chest. I shelter there at night.`', JSON.stringify(three));
            check(holds(area('home'), h.box, h.home), '3: the area "home" holds the house', areaText(area('home')));

            // ---------------------------------------------------------- 4. items in the aviary
            await walkPlayer([{ x: h.door.x, y: g + 1, z: h.door.z + 1 }], 300);
            if (!(await isOpen(h.door))) await setOpen(h.door, true);
            await walkPlayer([h.door, ...line(h.door, { x: h.door.x, y: g + 1, z: pen.outsideGate.z }), ...line({ x: h.door.x, y: g + 1, z: pen.outsideGate.z }, pen.outsideGate)], 200);
            await come('4: outside the pen', { min: { x: pen.box.min.x - 8, y: g + 1, z: pen.box.min.z - 8 }, max: { x: pen.box.max.x + 8, y: g + 3, z: pen.box.min.z - 1 } });
            const shut = await waitFor(async () => (await isOpen(pen.gate, 'oak_fence_gate')) === false, { ms: 10000, every: 500 });
            check(shut.ok, '4: the gate of the pen is closed (the bot walked out of it on its way to the farm: the door service closed it)', String(await isOpen(pen.gate, 'oak_fence_gate')));
            // the owner closes the gate himself before the items lie there (as in W89)
            await setOpen(pen.gate, false, 'oak_fence_gate');
            await sleep(500);
            // near the gate, within the 8 blocks of the item reflex from the bot outside it
            const drop = { x: pen.gate.x - 1, y: g + 1, z: pen.inner.min.z + 1 };
            const penItems = async () => (await itemsOnGround({ min: { x: pen.inner.min.x, y: g, z: pen.inner.min.z }, max: { x: pen.inner.max.x, y: g + 3, z: pen.inner.max.z } }))
                .filter((x) => x.name === 'oak_fence').reduce((n, x) => n + (x.count || 0), 0);
            const t4 = Date.now();
            await commands([`summon minecraft:item ${drop.x + 0.5} ${drop.y + 0.2} ${drop.z + 0.5} {Item:{id:"minecraft:oak_fence",count:8},PickupDelay:10}`]);
            await sleep(500);
            note(`4: 8 oak_fence dropped at ${fmt(drop)}; ${await penItems()} lie in the pen; the bot at ${fmt(await entityPos(NAME))}`);
            const trace = startTrace(async () => ({ gate: await isOpen(pen.gate, 'oak_fence_gate'), bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);
            await sleep(60000);
            const rows = await trace.stop();
            const opened = rows.filter((x) => x.gate === true);
            const entered = rows.filter((x) => x.bot && inBox(x.bot, pen.inner));
            const lying = await penItems();
            const said = saidLines(s, t4);
            note(`4: in 60 s the gate was open in ${opened.length} of ${rows.length} samples, the bot in the pen in ${entered.length}; ${lying} oak_fence lie in the pen; the bot said ${JSON.stringify(said.slice(0, 10))}`);
            check(opened.length === 0, '4: the gate of the aviary stayed closed for 60 s', `${opened.length} open samples`);
            check(entered.length === 0, '4: the bot never entered the aviary', entered.slice(0, 3).map((x) => fmt(x.bot)).join(' '));
            check(lying >= 8, '4: the 8 oak_fence still lie in the aviary', `${lying}`);
            check(said.some((l) => /I leave the oak_fence in the pen "aviary"/.test(l)), '4: the bot says `I leave the oak_fence in the pen "aviary"`', JSON.stringify(said.slice(0, 6)));

            // ---------------------------------------------------------- 5. "no, it is a farm"
            const five = await orders.order('!rememberArea("aviary", "farm")', 60000);
            const av = area('aviary');
            note(`5: !rememberArea("aviary", "farm") answered ${JSON.stringify(five)}; the area ${areaText(av)}; all ${JSON.stringify((agent.area_store?.list?.() ?? []).map(areaText))}`);
            check(/"aviary" is a farm now\./.test(five), '5: "no, it is a farm": `"aviary" is a farm now.`', JSON.stringify(five));
            check(av && (av.kind === 'farm' || av.type === 'farm'), '5: the area "aviary" is a farm', areaText(av));

            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
