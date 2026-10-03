// W103 learning a fence by watching (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md 2.1 to 2.4,
// SPEC section 5): "watch me", the owner places three fences and the gate, "continue like this, 7 by 10", "yes": the bot
// builds the rest of the pen and fetches the fences it lacks from the chest. Today (v0.1.4.11) !watchMe is no command.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists); the chest of
// the house holds 64 oak_fence besides its bread and leaf litter. The owner's switches of v0.1.4.11 with watch_and_learn
// on, the modes of his profile, an empty memory, a kit of 12 oak_fence. The player is the teacher (teacher.js). The open
// grass north-east of the house; the bot is never moved by the control.
//   1. "watch me" !watchMe: the order runs.
//   2. The teacher places 3 oak_fence northwards and an oak_fence_gate as the 4th, facing east (he stands west of the
//      line and looks east).
//   3. "continue like this, 7 by 10" !continueLike("7 by 10"): the bot said `I watched you: 4 blocks placed, 0 broken.`;
//      the answer starts `I understood: a fence 7 x 10 from`, names `the gate where you placed it`, 26 oak_fence more,
//      `I carry 12 oak_fence`, and ends `Say yes to build it.`
//   4. "yes" !buildWatched: within 240 s the rectangle stands, 7 long northwards and 10 wide eastwards (the side the gate
//      faces): every border cell is an oak_fence or the one gate; the gate is the teacher's (facing east, where he put
//      it) and no other gate stands; the inside (the grass and the 2 cells of air above it) is untouched; the chest of
//      the house holds fewer oak_fence than 64 (the material was fetched).
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep } from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, buildChest, chestItems, itemsText } from './world.js';
import { basePlan, buildBase, BASE_RADIUS, HOUSE_CHEST_ITEMS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, saidLines, RELEASE_SETTINGS } from './journey.js';
import { makeTeacher } from './teacher.js';

const NAME = 'w_fence';
const KIT = [['oak_fence', 12]];
const A = 7; // northwards, the direction of the placed fences
const B = 10; // eastwards, the side the gate faces
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        await buildChest(b.house.chest, { ...HOUSE_CHEST_ITEMS, oak_fence: 64 }, { facing: 'west' });
        const g = b.g;
        const x0 = b.ox + 7, z0 = b.oz - 8; // the first fence: the south-west corner of the rectangle
        const at = (i, jj) => ({ x: x0 + i, y: g + 1, z: z0 - jj }); // i east 0..B-1, jj north 0..A-1
        const border = [];
        const inner = [];
        for (let i = 0; i < B; i++) {
            for (let jj = 0; jj < A; jj++) {
                if (i === 0 || jj === 0 || i === B - 1 || jj === A - 1) border.push(at(i, jj));
                else inner.push(at(i, jj));
            }
        }
        const gate = at(0, 3);
        const isGate = (p) => p.x === gate.x && p.z === gate.z;
        const fences = [at(0, 0), at(0, 1), at(0, 2)];
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { x: x0 - 4, y: g + 1, z: z0 - 1 }, playerAt: { x: x0 - 2, y: g + 1, z: z0 }, kit: KIT,
                settings: RELEASE_SETTINGS({ watch_and_learn: true }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();
            const teacher = makeTeacher(orders);
            const chest0 = await chestItems(b.house.chest);
            note(`the chest of the house holds ${itemsText(chest0)}`);

            // ---------------------------------------------------------- 1. watch me
            const watch = await orders.orderInfo('!watchMe', 4000);
            note(`1: !watchMe: ${watch.reply === '(timeout)' ? 'still running after 4 s (the bot watches)' : `answered ${JSON.stringify(watch.reply.slice(0, 300))}`}`);
            const watching = watch.arrived && watch.reply === '(timeout)';
            check(watching, '1: "watch me" !watchMe runs: the bot watches until the next order', JSON.stringify(watch.reply.slice(0, 200)));

            // ---------------------------------------------------------- 2. the teacher
            const placed = [];
            for (const c of fences) placed.push(await teacher.place('oak_fence', c, { facing: 'east' }));
            placed.push(await teacher.place('oak_fence_gate', gate, { facing: 'east' }));
            const got = await blockNames([...fences, gate], ['oak_fence', 'oak_fence_gate[facing=east]']);
            check(got.slice(0, 3).every((x) => x === 'oak_fence') && got[3] === 'oak_fence_gate[facing=east]',
                'precondition: the teacher placed 3 oak_fence northwards and an oak_fence_gate facing east as the 4th (server)', `${JSON.stringify(got)}; ${placed.map((x) => x.detail).filter(Boolean).join('; ')}`);
            await teacher.goTo({ x: x0 - 3, y: g + 1, z: z0 - 3 }, 'east');
            await sleep(1000);
            if (!watching) {
                note('the bot does not watch: the rest is not run');
                return;
            }

            // ---------------------------------------------------------- 3. continue like this
            const cont = await orders.order('!continueLike("7 by 10")', 30000);
            note(`3: !continueLike("7 by 10") answered ${JSON.stringify(cont.slice(0, 400))}`);
            const watched = saidLines(s, t0).find((l) => l.includes('I watched you:'));
            check(saidLines(s, t0).some((l) => l.includes('I watched you: 4 blocks placed, 0 broken.')), '3: the watching ended with `I watched you: 4 blocks placed, 0 broken.`', JSON.stringify(watched ?? saidLines(s, t0).slice(0, 6)));
            const understood = cont.slice(cont.indexOf('I understood:'));
            check(cont.includes('I understood: a fence 7 x 10 from') && understood.includes('the gate where you placed it') && /\b26 oak_fence\b/.test(understood)
                && understood.includes('I carry 12 oak_fence') && /Say yes to build it\.\s*$/.test(understood),
            '3: the answer is the understood text: `a fence 7 x 10`, `the gate where you placed it`, 26 oak_fence more, `I carry 12 oak_fence`, `Say yes to build it.`', JSON.stringify(cont.slice(0, 300)));

            // ---------------------------------------------------------- 4. yes
            const tBuild = Date.now();
            const build = await orders.orderInfo('!buildWatched', 240000);
            const names = await blockNames(border, ['oak_fence', 'oak_fence_gate[facing=east]', 'oak_fence_gate']);
            const wrong = border.filter((p, i) => (isGate(p) ? names[i] !== 'oak_fence_gate[facing=east]' : names[i] !== 'oak_fence'));
            const ground = await blockNames(inner.map((p) => ({ ...p, y: g })), ['grass_block']);
            const airIn = await blockNames(inner.flatMap((p) => [p, { ...p, y: g + 2 }]), ['air']);
            const changed = [...inner.filter((p, i) => !ground[i]).map((p) => ({ ...p, y: g })), ...inner.flatMap((p) => [p, { ...p, y: g + 2 }]).filter((p, i) => !airIn[i])];
            const chest1 = await chestItems(b.house.chest);
            const said = saidLines(s, tBuild);
            note(`4: !buildWatched answered after ${((Date.now() - tBuild) / 1000).toFixed(1)} s: ${JSON.stringify(build.reply.slice(0, 300))}; the bot at ${fmt(await entityPos(NAME))}; it said ${JSON.stringify(said.slice(0, 10))}; the chest of the house holds ${itemsText(chest1)}`);
            check(build.done && wrong.length === 0, `4: within 240 s the rectangle ${A} x ${B} stands: every border cell an oak_fence, the gate where the teacher put it`, `${wrong.length} of ${border.length} wrong: ${wrong.slice(0, 10).map((p) => `${P(p)} ${names[border.indexOf(p)] ?? 'other'}`).join(' ')}; done ${build.done}`);
            check(names.filter((n) => n && n.startsWith('oak_fence_gate')).length === 1 && names[border.findIndex(isGate)] === 'oak_fence_gate[facing=east]',
                '4: the gate is the one the teacher placed (facing east) and the only gate of the rectangle', JSON.stringify(names.filter((n) => n && n.startsWith('oak_fence_gate'))));
            check(changed.length === 0, '4: the inside is untouched (the grass and the air above it)', changed.slice(0, 10).map(P).join(' '));
            check((chest1?.oak_fence ?? 0) < 64, '4: the material was fetched from the chest of the house (the kit of 12 was short)', `the chest holds ${chest1?.oak_fence ?? 0} oak_fence`);

            note(`the teacher: ${JSON.stringify(teacher.log)}`);
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
