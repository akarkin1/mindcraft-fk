// v0.1.4.14, gate G-1 (engineer E4): the climb out at the top of ladder 2 of the base (job_comes_back, "I could not
// follow the route "mine" at step 6 of 11: I got stuck at (2003, 53, 0)"). The route learned from the trail held the
// entry of the ladder leg one cell above the floor of the basement ((403, 54, -1) over the floor at 53, a cell in the
// air); climbUp jumped out of the hole onto the floor three times, but counted the bot as arrived only with its feet at
// the height of the entry, and the path search to that cell in the air found no path. standingEntry lowers the entry
// onto the floor under it. On the fake bot of the mining pack: the basement floor at y 52 (feet 53), the column of
// ladders facing south at (3, 42..52, -2) through it, the stone wall at z -3, the room at y 41 under it.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock } from './mining_fake_bot.test.js';

const LAD = await loadSrc('src/agent/packs/mining/ladder.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

// the leg as job_comes_back learned it (bottom 43: the bot placed the missing ladder at 42 itself)
const LEG = { kind: 'ladder', x: 3, z: -2, top: 52, bottom: 43, face: 'south', entry: { x: 3, y: 54, z: -1 }, foot: { x: 3, y: 41, z: -2 } };

function scene(pos) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air'); // the room
    world.fill(-3, 53, -2, 3, 55, 3, 'air'); // the basement, its floor of stone at y 52
    world.fill(3, 44, -2, 3, 52, -2, 'air'); // the column through the rock and the floor
    world.fill(3, 42, -2, 3, 52, -2, 'ladder', { facing: 'south' });
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    bot.modes = { noteProgress() {} };
    const gotos = () => bot.calls.filter(c => c[0] === 'goto');
    return { world, bot, clock, gotos };
}

describe('standingEntry: the entry of a ladder leg on the floor', () => {
    test('an entry one cell above the floor beside the hole is lowered onto the floor', () => {
        const s = scene([3.5, 41, -1.5]);
        assert.deepEqual(LAD.standingEntry(s.bot, LEG.entry, LEG), { x: 3, y: 53, z: -1 });
    });

    test('an entry on the floor stays as it is', () => {
        const s = scene([3.5, 41, -1.5]);
        const entry = { x: 2, y: 53, z: -2 };
        assert.equal(LAD.standingEntry(s.bot, entry, LEG), entry);
    });

    test('never below the cell above the top ladder, never more than 2 cells, never through a ladder', () => {
        const s = scene([3.5, 41, -1.5]);
        // a hole beside the column: the cells under the entry are free down to y 50
        s.world.fill(3, 50, -1, 3, 52, -1, 'air');
        assert.deepEqual(LAD.standingEntry(s.bot, { x: 3, y: 55, z: -1 }, LEG), { x: 3, y: 53, z: -1 }, 'stops at top + 1');
        assert.deepEqual(LAD.standingEntry(s.bot, { x: 3, y: 55, z: -1 }, { ...LEG, top: 40 }), { x: 3, y: 53, z: -1 }, 'at most 2 cells');
        s.world.set(3, 53, -1, 'ladder', { facing: 'south' });
        assert.deepEqual(LAD.standingEntry(s.bot, { x: 3, y: 54, z: -1 }, LEG), { x: 3, y: 54, z: -1 }, 'a ladder under it is no floor to drop to');
    });

    test('the entry of a trapdoor shaft (the floor of the house under it) stays as it is', () => {
        const world = makeWorld({ groundY: 60 });
        const bot = makeMiningBot({ world, pos: [0.5, 61, 0.5] });
        const entry = { x: -1, y: 61, z: -4 };
        assert.equal(LAD.standingEntry(bot, entry, { x: -2, z: -3, top: 59 }), entry);
    });

    test('a bot without blocks gets the entry back', () => {
        const entry = { x: 3, y: 54, z: -1 };
        assert.equal(LAD.standingEntry({ blockAt() { throw new Error('no world'); } }, entry, LEG), entry);
    });
});

describe('climbUp with the learned entry in the air (job_comes_back, step 6 of 11)', () => {
    test('from the room under the column up into the basement: ok, the bot on the floor beside the hole', async () => {
        const s = scene([3.5, 41, -1.5]);
        const r = await LAD.climbUp(s.bot, LEG, { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        const p = s.bot.entity.position;
        assert.equal(Math.floor(p.y + 0.01), 53, `the feet on the basement floor, at ${p.x}, ${p.y}, ${p.z}`);
        assert.ok(!(Math.floor(p.x) === 3 && Math.floor(p.z) === -2), 'out of the column');
        assert.deepEqual(s.gotos().filter(c => c[2] === 54), [], 'no path search to the cell in the air');
    });
});
