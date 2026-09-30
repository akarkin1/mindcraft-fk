// Fix round 2 of v0.1.4.9 (engineer E1), findings F1 and F3 in src/agent/packs/mining/ladder.js and the replay of
// the routes pack, on the fake bot of the mining pack. The shaft of the base: ladders facing south at
// (2, 41..59, -2) on a stone wall at z -3, an open oak trapdoor at (2, 60, -2), the grass at y 60, the room at y 41.
// F1: at the top, when the bot does not rise for 1.5 s and above it is an open trapdoor (the fake physics, like
// prismarine-physics before the patch, does not climb it), climbUp jumps and walks towards the entry for 1 s, up to
// 3 times, before the path search. F3: a bot outside the column walks to the foot and steps in; no goal of the path
// search lies in the column.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, v } from './mining_fake_bot.test.js';

const LAD = await loadSrc('src/agent/packs/mining/ladder.js');
const P = await loadSrc('src/agent/packs/routes/index.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const LEG = { kind: 'ladder', x: 2, z: -2, top: 59, bottom: 41, face: 'south', entry: { x: 2, y: 61, z: -1 }, foot: { x: 2, y: 41, z: -1 } };

function scene(pos) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    world.fill(2, 41, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: true });
    const solid = world.solid;
    world.solid = (x, y, z) => (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true ? false : solid(x, y, z));
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    bot.modes = { noteProgress() {} };
    // the attempts of the second way: a tick with jump and forward held while the bot looks south (to the entry)
    const jumps = [];
    let holding = false;
    const onTick = [];
    clock.onTick = (t) => {
        const south = Math.abs(Math.abs(bot.yaw) - Math.PI) < 0.3;
        const now = bot.controls.jump && bot.controls.forward && south && bot.entity.position.y > 55;
        if (now && !holding) jumps.push(t);
        holding = now;
        for (const f of onTick) f(t);
    };
    const gotos = () => bot.calls.filter(c => c[0] === 'goto');
    return { world, bot, clock, jumps, onTick, gotos };
}

describe('F1: the second way out at the top of the ladder', () => {
    test('the physics does not climb the trapdoor: 3 jumps towards the entry, then the path search as before', async () => {
        const s = scene([2.5, 41, -1.5]);
        const r = await LAD.climbUp(s.bot, LEG, { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(s.jumps.length, 3, `jumps at ${JSON.stringify(s.jumps)}`);
        const first = s.gotos()[0];
        assert.deepEqual(first?.slice(1), [2, 61, -1], 'the path search to the entry comes after the jumps');
        assert.ok(s.jumps.every(t => t < (s.clock.now())), 'the jumps come first');
    });

    test('a jump that gets the bot out ends the climb: no second jump, no path search', async () => {
        const s = scene([2.5, 41, -1.5]);
        s.onTick.push(() => {
            // what a jump from the top of the ladder does on the server: onto the floor at the entry
            if (s.jumps.length > 0 && s.bot.controls.jump && s.bot.entity.position.y > 59) {
                s.bot.entity.position = v(2.5, 61, -0.5);
                s.bot.entity.velocity = v(0, 0, 0);
                s.bot.entity.onGround = true;
                s.bot.clearControlStates();
            }
        });
        const r = await LAD.climbUp(s.bot, LEG, { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(s.jumps.length, 1);
        assert.deepEqual(s.gotos(), []);
    });

    test('with a climbable way out the bot climbs out without jumping', async () => {
        const s = scene([2.5, 41, -1.5]);
        // a ladder up to the floor of the house instead of the trapdoor: the fake climbs it
        s.world.set(2, 60, -2, 'ladder', { facing: 'south' });
        const r = await LAD.climbUp(s.bot, { ...LEG, top: 60 }, { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(s.jumps.length, 0);
    });
});

describe('F3: into the column from its foot, no goal of the path search in the column', () => {
    const inColumn = c => c[1] === 2 && c[3] === -2;

    test('climbUp from the room: to the foot, a step into the column, up; every goal outside the column', async () => {
        const s = scene([3.5, 41, 1.5]);
        const r = await LAD.climbUp(s.bot, LEG, { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual(s.gotos()[0]?.slice(1), [2, 41, -1], 'the first goal is the foot');
        assert.deepEqual(s.gotos().filter(inColumn), []);
    });

    test('footOf: the foot of the leg, else the cell the ladders face when the bot can stand there', () => {
        const s = scene([3.5, 41, 1.5]);
        assert.deepEqual(LAD.footOf(s.bot, LEG), { x: 2, y: 41, z: -1 });
        const { foot, ...noFoot } = LEG;
        void foot;
        assert.deepEqual(LAD.footOf(s.bot, noFoot), { x: 2, y: 41, z: -1 });
        assert.equal(LAD.footOf(s.bot, { ...noFoot, face: 'north' }), null, 'the stone wall to the north');
    });

    test('the walk of a route to the foot of the ladder and up: no goal in the column', async () => {
        const s = scene([2.5, 41, 1.5]);
        const route = { name: 'bed', legs: [{ kind: 'walk', from: { x: 2, y: 41, z: 1 }, to: { x: 2, y: 41, z: -2 } }, LEG] };
        const r = await P.walkRoute(s.bot, {}, route, { clock: s.clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(s.gotos().filter(inColumn), [], 'a walk leg that ends in the column walks to the cell beside it');
    });
});
