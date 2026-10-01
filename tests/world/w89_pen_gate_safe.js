// W89 the pen gate stays shut (journey of v0.1.4.10 "Goals", tester T3; PLAN.md 3.1, CHANGELOG "The item reflex never
// opens the gate of a pen or a farm"): the item reflex opened the gate of the owner's pen three times in his play of
// 2026-10-01 to pick up items that lay inside.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with job_memory on, the modes of his profile (item_collecting on), an empty memory. The bot stands outside
// in front of the gate of the pen; it is never moved by the control.
//   1. Typed !rememberArea("pen", "pen") ("this is the pen"). 8 oak_fence dropped as items inside the pen. Within 60 s:
//      the gate is closed all the time (sampled), the cow and the chicken are inside, the items lie there still, the
//      bot never entered the pen, and it said `I leave the oak_fence in the pen "pen". I do not open its gate.`
//   Before each drop the owner calls the bot out of the pen with a typed !goToPlayer (the scan of the pen walks it in).
//   2. The items removed; typed !forgetArea("pen"), !rememberArea("chicken pen", "pen") and
//      !rememberRule("never enter the chicken pen"): the answer of the rule marks the area keep out. 8 oak_fence
//      dropped inside again: within 60 s the same facts, and a line "I leave the oak_fence in ... chicken pen ...".
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, startTrace, waitFor } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen, setOpen, itemsOnGround } from './world.js';
import { basePlan, buildBase, BASE_RADIUS, penAnimalsWhere } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, GOALS_SETTINGS, saidLines, PLAYER } from './journey.js';

const NAME = 'w_pengate';

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
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, { botAt: pen.outsideGate, playerAt: { x: pen.gate.x - 2, y: g + 1, z: pen.gate.z - 2 }, settings: GOALS_SETTINGS() });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const drop = { x: pen.inside.x, y: g + 1, z: pen.inside.z };
            const penItems = async () => (await itemsOnGround({ min: { x: pen.inner.min.x, y: g, z: pen.inner.min.z }, max: { x: pen.inner.max.x, y: g + 3, z: pen.inner.max.z } }))
                .filter((x) => x.name === 'oak_fence').reduce((n, x) => n + (x.count || 0), 0);

            // the scan may leave the bot inside the pen (seen in the first run: "I went in through the gate"): the owner
            // calls it out ("come here") before the items lie there, so the bot stands outside as the journey needs
            const callOut = async (label) => {
                const info = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 60000);
                await sleep(3000);
                const at = await entityPos(NAME);
                note(`${label}: "come here" answered ${JSON.stringify(info.reply.slice(0, 200))}; the bot at ${fmt(at)}, the gate ${(await isOpen(pen.gate, 'oak_fence_gate')) ? 'open' : 'closed'}`);
                check(at && !inBox(at, pen.box), `${label}: precondition: the bot stands outside the pen`, fmt(at));
                // the bot walked out through the gate: its door service closes it (finding T3 of the second run: the
                // gate stayed open with the bot beside it and the animals walked out)
                const shut = await waitFor(async () => (await isOpen(pen.gate, 'oak_fence_gate')) === false, { ms: 10000, every: 500 });
                check(shut.ok, `${label}: the gate is closed within 10 s after the bot walked out of the pen`, `the bot at ${fmt(await entityPos(NAME))}`);
                // the owner closes the gate himself and brings his animals back before the items lie there
                await setOpen(pen.gate, false, 'oak_fence_gate');
                await commands([`tp @e[tag=${pen.tag}_cow,limit=1] ${pen.cow.x + 0.5} ${pen.cow.y} ${pen.cow.z + 0.5}`, `tp @e[tag=${pen.tag}_chicken,limit=1] ${pen.chicken.x + 0.5} ${pen.chicken.y} ${pen.chicken.z + 0.5}`]);
                await sleep(1000);
            };

            const watch = async (label, textRe) => {
                await callOut(label);
                const t0 = Date.now();
                await commands([`summon minecraft:item ${drop.x + 0.5} ${drop.y + 0.2} ${drop.z + 0.5} {Item:{id:"minecraft:oak_fence",count:8},PickupDelay:10}`]);
                await sleep(500);
                const before = await penItems();
                note(`${label}: 8 oak_fence dropped at ${fmt(drop)}; ${before} oak_fence lie in the pen; the bot at ${fmt(await entityPos(NAME))}`);
                const trace = startTrace(async () => ({ gate: await isOpen(pen.gate, 'oak_fence_gate'), bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);
                await sleep(60000);
                const rows = await trace.stop();
                const opened = rows.filter((x) => x.gate === true);
                const entered = rows.filter((x) => x.bot && inBox(x.bot, pen.inner));
                const animals = await penAnimalsWhere(b);
                const lying = await penItems();
                const said = saidLines(s, t0);
                note(`${label}: in 60 s the gate was open in ${opened.length} of ${rows.length} samples, the bot in the pen in ${entered.length}; actions ${JSON.stringify([...new Set(rows.map((x) => x.action))])}; the cow ${fmt(animals.cow.pos)} inside ${animals.cow.inside}, the chicken ${fmt(animals.chicken.pos)} inside ${animals.chicken.inside}; ${lying} oak_fence lie in the pen; the bot said ${JSON.stringify(said.slice(0, 10))}`);
                check(opened.length === 0 && (await isOpen(pen.gate, 'oak_fence_gate')) === false, `${label}: the gate of the pen stayed closed for 60 s`, `${opened.length} open samples`);
                check(entered.length === 0, `${label}: the bot never entered the pen`, entered.slice(0, 3).map((x) => fmt(x.bot)).join(' '));
                check(animals.cow.inside && animals.chicken.inside, `${label}: the cow and the chicken are inside the pen`, `cow ${fmt(animals.cow.pos)}, chicken ${fmt(animals.chicken.pos)}`);
                check(lying >= 8, `${label}: the 8 oak_fence still lie in the pen`, `${lying}`);
                check(said.some((l) => textRe.test(l)), `${label}: the bot says that it leaves the oak_fence in the pen`, JSON.stringify(said.slice(0, 6)));
                await commands([`kill @e[type=minecraft:item,x=${pen.box.min.x},y=${g - 1},z=${pen.box.min.z},dx=${pen.box.max.x - pen.box.min.x},dy=5,dz=${pen.box.max.z - pen.box.min.z}]`]);
            };

            // ---------------------------------------------------------- 1. the pen
            const saved = await orders.order('!rememberArea("pen", "pen")', 90000);
            note(`1: !rememberArea("pen", "pen") answered ${JSON.stringify(saved.slice(0, 300))}`);
            const area = agent.area_store?.get?.('pen') ?? null;
            check(area?.type === 'pen', '1: the pen is saved as the area "pen" of type pen (precondition)', JSON.stringify(saved.slice(0, 200)));
            await watch('1', /^I leave the oak_fence in the pen "pen"\. I do not open its gate\.$/);

            // ---------------------------------------------------------- 2. the rule
            const forgot = await orders.order('!forgetArea("pen")', 20000);
            note(`2: !forgetArea("pen") answered ${JSON.stringify(forgot.slice(0, 200))}`);
            // the owner stands at the gate of the pen; the area of the default type (building) saved the house in the
            // first run (finding T3), so the pen is named with its type, as the owner's model would for a chicken pen
            const saved2 = await orders.order('!rememberArea("chicken pen", "pen")', 90000);
            note(`2: !rememberArea("chicken pen", "pen") answered ${JSON.stringify(saved2.slice(0, 300))}; the areas ${JSON.stringify((agent.area_store?.list?.() ?? []).map((a) => [a.name, a.type]))}`);
            const rule = await orders.order('!rememberRule("never enter the chicken pen")', 30000);
            note(`2: !rememberRule answered ${JSON.stringify(rule.slice(0, 300))}`);
            check(/I marked the area "chicken[ _]pen" as keep out\./.test(rule), '2: the rule marks the area "chicken pen" keep out ("I marked the area "chicken_pen" as keep out.")', JSON.stringify(rule.slice(0, 200)));
            const cp = agent.area_store?.get?.('chicken_pen') ?? agent.area_store?.get?.('chicken pen') ?? null;
            check(cp && inBox(pen.inside, cp), '2: the area "chicken pen" holds the pen (precondition)', JSON.stringify(cp ? { min: cp.min, max: cp.max, type: cp.type } : null));
            await watch('2', /I leave the oak_fence in .*chicken[ _]pen/);

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
