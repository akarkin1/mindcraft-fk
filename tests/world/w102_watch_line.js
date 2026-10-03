// W102 learning a line by watching (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md 2.1 to 2.4,
// SPEC section 5): "watch me", the owner places a few blocks in a line, "continue like this, 12 long", "yes": the bot
// builds the rest. Today (v0.1.4.11) !watchMe is no command: the bot never watches and never learns.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches of v0.1.4.11 with watch_and_learn on, the modes of his profile, an empty memory, a kit of 20 oak_planks. The
// player is the teacher (teacher.js): he places the blocks himself with the real mechanics, in creative, the console
// putting the blocks into his hand. The open grass north of the house; the bot is never moved by the control.
//   1. "watch me" !watchMe: the order runs (the bot watches until the next order).
//   2. The teacher places 4 oak_planks in a line eastwards on the grass (feet level), each from 2 blocks south of it.
//   3. "continue like this, 12 long" !continueLike("12 long"): the bot said `I watched you: 4 blocks placed, 0 broken.`;
//      the answer is `I understood: a line of oak_planks 12 long from (x, y, z) eastwards; 8 oak_planks more, I carry 20.
//      Say yes to build it.` with the first block of the teacher.
//   4. "yes" !buildWatched: within 90 s the 12 cells hold oak_planks (server), the bot says `I built the line: 8
//      oak_planks.`, and nothing else was placed within 3 blocks of the line.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep } from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, boxPositions } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, saidLines, RELEASE_SETTINGS } from './journey.js';
import { makeTeacher } from './teacher.js';

const NAME = 'w_line';
const KIT = [['oak_planks', 20]];
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const key = (p) => `${p.x},${p.y},${p.z}`;

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
        const x0 = b.ox - 6, zl = b.oz - 14;
        const cells = Array.from({ length: 12 }, (_, k) => ({ x: x0 + k, y: g + 1, z: zl }));
        const near = boxPositions({ min: { x: x0 - 3, y: g + 1, z: zl - 3 }, max: { x: x0 + 14, y: g + 3, z: zl + 3 } });
        const lineKeys = new Set(cells.map(key));
        const notAir = async () => {
            const got = await blockNames(near, ['air']);
            return near.filter((p, i) => !got[i]);
        };
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { x: x0 + 1, y: g + 1, z: zl + 5 }, playerAt: { x: x0, y: g + 1, z: zl + 2 }, kit: KIT,
                settings: RELEASE_SETTINGS({ watch_and_learn: true }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();
            const teacher = makeTeacher(orders);
            const before0 = await notAir();
            check(before0.length === 0, 'precondition: the grass around the line is free (no block within 3 blocks)', before0.map(P).join(' '));

            // ---------------------------------------------------------- 1. watch me
            const watch = await orders.orderInfo('!watchMe', 4000);
            note(`1: !watchMe: ${watch.reply === '(timeout)' ? 'still running after 4 s (the bot watches)' : `answered ${JSON.stringify(watch.reply.slice(0, 300))}`}`);
            const watching = watch.arrived && watch.reply === '(timeout)';
            check(watching, '1: "watch me" !watchMe runs: the bot watches until the next order', JSON.stringify(watch.reply.slice(0, 200)));

            // ---------------------------------------------------------- 2. the teacher
            const placed = [];
            for (const c of cells.slice(0, 4)) placed.push(await teacher.place('oak_planks', c, { facing: 'north' }));
            const there = await blockNames(cells.slice(0, 4), ['oak_planks']);
            check(there.every(Boolean), 'precondition: the teacher placed 4 oak_planks in a line eastwards (server)', placed.map((x) => x.detail).filter(Boolean).join('; '));
            await teacher.goTo({ x: x0 + 1, y: g + 1, z: zl + 3 }, 'north');
            await sleep(1000);
            if (!watching) {
                note('the bot does not watch: the rest is not run');
                return;
            }

            // ---------------------------------------------------------- 3. continue like this
            const want = `I understood: a line of oak_planks 12 long from ${P(cells[0])} eastwards; 8 oak_planks more, I carry 20. Say yes to build it.`;
            const cont = await orders.order('!continueLike("12 long")', 30000);
            note(`3: !continueLike("12 long") answered ${JSON.stringify(cont.slice(0, 400))}`);
            const watched = saidLines(s, t0).find((l) => l.includes('I watched you:'));
            check(saidLines(s, t0).some((l) => l.includes('I watched you: 4 blocks placed, 0 broken.')), '3: the watching ended with `I watched you: 4 blocks placed, 0 broken.`', JSON.stringify(watched ?? saidLines(s, t0).slice(0, 6)));
            check(cont.includes(want), `3: the answer is \`${want}\``, JSON.stringify(cont.slice(0, 300)));

            // ---------------------------------------------------------- 4. yes
            const before = await notAir();
            note(`4: before "yes" the blocks within 3 blocks of the line: ${before.map(P).join(' ')}`);
            const tBuild = Date.now();
            const build = await orders.orderInfo('!buildWatched', 90000);
            const after = await blockNames(cells, ['oak_planks']);
            const missing = cells.filter((c, i) => !after[i]);
            const others = (await notAir()).filter((p) => !lineKeys.has(key(p)));
            const said = saidLines(s, tBuild);
            note(`4: !buildWatched answered after ${((Date.now() - tBuild) / 1000).toFixed(1)} s: ${JSON.stringify(build.reply.slice(0, 300))}; the bot at ${fmt(await entityPos(NAME))}; it said ${JSON.stringify(said.slice(0, 8))}`);
            check(build.done && missing.length === 0, '4: within 90 s the 12 cells of the line hold oak_planks (server)', `missing ${missing.map(P).join(' ')}; done ${build.done}`);
            check(build.reply.includes('I built the line: 8 oak_planks.') || said.some((l) => l.includes('I built the line: 8 oak_planks.')), '4: the bot says `I built the line: 8 oak_planks.`', JSON.stringify(build.reply.slice(0, 200)));
            check(others.length === 0, '4: nothing else was placed within 3 blocks of the line', others.map(P).join(' '));

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
