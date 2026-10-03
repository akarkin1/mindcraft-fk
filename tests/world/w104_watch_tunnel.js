// W104 learning a tunnel by watching (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md 2.1 to 2.4,
// SPEC section 5): "watch me", the owner digs the first steps of a tunnel out of the mine room, "continue like this, 12
// long", "yes": the bot digs the rest. Today (v0.1.4.11) !watchMe is no command.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists): the mine room
// at y 41 with the rock of its west wall. The owner's switches of v0.1.4.11 with watch_and_learn on, the modes of his
// profile, an empty memory, a kit of a stone pickaxe. The player is the teacher (teacher.js). The bot stands in the room;
// it is never moved by the control.
//   1. "watch me" !watchMe: the order runs.
//   2. The teacher digs 3 cells deep and 2 high westwards into the rock of the west wall (the feet and the head of the row
//      z 0 of the room), from the room and then from the cells he dug.
//   3. "continue like this, 12 long" !continueLike("12 long"): the bot said `I watched you: 0 blocks placed, 6 broken.`;
//      the answer is `I understood: a tunnel 12 long from (x, y, z) westwards, 2 high; 9 blocks more to dig. Say yes to
//      dig it.` with the first cell of the teacher.
//   4. "yes" !buildWatched: within 240 s the 12 cells (feet and head) are air (a torch of the bot counts as dug), the
//      ceiling and the floor of the 12 cells stand, nothing is dug beside them (north and south) or beyond the 12th; no
//      block of the room changed (a snapshot of the room and its walls; a door only opened is no change).
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep } from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, snapshotBox, compareSnapshot, dropSnapshot, describeDifferences } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, saidLines, RELEASE_SETTINGS } from './journey.js';
import { makeTeacher } from './teacher.js';

const NAME = 'w_tunnel';
const KIT = [['stone_pickaxe', 1]];
const LENGTH = 12;
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const DUG = ['air', 'cave_air', 'torch', 'wall_torch'];

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const room = b.room.box;
        const y = room.min.y;
        const z = b.oz;
        const xw = room.min.x - 1; // the west wall of the room
        const feet = Array.from({ length: LENGTH }, (_, k) => ({ x: xw - k, y, z }));
        const cells = feet.flatMap((c) => [c, { ...c, y: y + 1 }]);
        const shell = feet.flatMap((c) => [{ ...c, y: y - 1 }, { ...c, y: y + 2 }]); // the floor and the ceiling
        const beside = feet.flatMap((c) => [0, 1].flatMap((dy) => [{ x: c.x, y: y + dy, z: z - 1 }, { x: c.x, y: y + dy, z: z + 1 }]));
        const beyond = [{ x: xw - LENGTH, y, z }, { x: xw - LENGTH, y: y + 1, z }];
        const roomBox = { min: { x: room.min.x - 1, y: room.min.y - 1, z: room.min.z - 1 }, max: { x: room.max.x + 1, y: room.max.y + 1, z: room.max.z + 1 } };
        const inTunnel = (p) => p.z === z && p.x <= xw && (p.y === y || p.y === y + 1);
        let agent = null, orders = null, snap = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { x: room.min.x + 3, y, z: z + 1 }, playerAt: { x: room.min.x + 1, y, z }, kit: KIT,
                settings: RELEASE_SETTINGS({ watch_and_learn: true }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();
            const teacher = makeTeacher(orders);
            const rock = await blockNames([...cells, ...shell, ...beside, ...beyond], ['air', 'cave_air']);
            check(rock.every((x) => !x), 'precondition: the rock west of the room is whole (the tunnel cells, their floor, ceiling and sides)', `${rock.filter(Boolean).length} cells of air`);
            snap = await snapshotBox(roomBox);

            // ---------------------------------------------------------- 1. watch me
            const watch = await orders.orderInfo('!watchMe', 4000);
            note(`1: !watchMe: ${watch.reply === '(timeout)' ? 'still running after 4 s (the bot watches)' : `answered ${JSON.stringify(watch.reply.slice(0, 300))}`}`);
            const watching = watch.arrived && watch.reply === '(timeout)';
            check(watching, '1: "watch me" !watchMe runs: the bot watches until the next order', JSON.stringify(watch.reply.slice(0, 200)));

            // ---------------------------------------------------------- 2. the teacher digs 3 deep, 2 high
            const dug = [];
            const stands = [{ x: room.min.x + 1, y, z }, { x: xw, y, z }, { x: xw - 1, y, z }];
            for (let k = 0; k < 3; k++) {
                for (const c of [{ ...feet[k], y: y + 1 }, feet[k]]) dug.push(await teacher.dig(c, { stand: stands[k], facing: 'west' }));
            }
            const first = await blockNames(cells.slice(0, 6), ['air', 'cave_air']);
            check(first.every(Boolean), 'precondition: the teacher dug 3 cells deep and 2 high westwards (server)', dug.map((x) => x.detail).filter(Boolean).join('; '));
            await teacher.goTo({ x: room.min.x + 1, y, z: z - 1 }, 'west');
            await sleep(1000);
            if (!watching) {
                note('the bot does not watch: the rest is not run');
                return;
            }

            // ---------------------------------------------------------- 3. continue like this
            const want = `I understood: a tunnel 12 long from ${P(feet[0])} westwards, 2 high; 9 blocks more to dig. Say yes to dig it.`;
            const cont = await orders.order('!continueLike("12 long")', 30000);
            note(`3: !continueLike("12 long") answered ${JSON.stringify(cont.slice(0, 400))}`);
            const watched = saidLines(s, t0).find((l) => l.includes('I watched you:'));
            check(saidLines(s, t0).some((l) => l.includes('I watched you: 0 blocks placed, 6 broken.')), '3: the watching ended with `I watched you: 0 blocks placed, 6 broken.`', JSON.stringify(watched ?? saidLines(s, t0).slice(0, 6)));
            check(cont.includes(want), `3: the answer is \`${want}\``, JSON.stringify(cont.slice(0, 300)));

            // ---------------------------------------------------------- 4. yes
            const tBuild = Date.now();
            const build = await orders.orderInfo('!buildWatched', 240000);
            const open = await blockNames(cells, DUG);
            const notDug = cells.filter((c, i) => !open[i]);
            const shellAir = (await blockNames(shell, ['air', 'cave_air'])).map((x, i) => (x ? shell[i] : null)).filter(Boolean);
            const sideAir = (await blockNames(beside, ['air', 'cave_air'])).map((x, i) => (x ? beside[i] : null)).filter(Boolean);
            const pastAir = (await blockNames(beyond, ['air', 'cave_air'])).map((x, i) => (x ? beyond[i] : null)).filter(Boolean);
            const cmp = await compareSnapshot(snap);
            const roomChanged = cmp.differences.filter((d) => !d.stateOnly && !inTunnel(d.pos));
            const said = saidLines(s, tBuild);
            note(`4: !buildWatched answered after ${((Date.now() - tBuild) / 1000).toFixed(1)} s: ${JSON.stringify(build.reply.slice(0, 300))}; the bot at ${fmt(await entityPos(NAME))}; it said ${JSON.stringify(said.slice(0, 10))}`);
            check(build.done && notDug.length === 0, `4: within 240 s the ${LENGTH} cells of the tunnel are dug, 2 high (server)`, `not dug ${notDug.map(P).join(' ')}; done ${build.done}`);
            check(shellAir.length === 0, '4: the ceiling and the floor of the tunnel stand', shellAir.map(P).join(' '));
            check(sideAir.length === 0 && pastAir.length === 0, '4: nothing is dug beside the tunnel or beyond its 12th cell', `beside ${sideAir.map(P).join(' ')}; beyond ${pastAir.map(P).join(' ')}`);
            check(roomChanged.length === 0, '4: no block of the room was broken or changed', describeDifferences(roomChanged));

            note(`the teacher: ${JSON.stringify(teacher.log)}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (snap) await dropSnapshot(snap).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
