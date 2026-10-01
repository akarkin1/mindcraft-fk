// Spec v0.1.4.9 section 13, part L (engineer E3): passLadder of src/agent/library/ladder_pass.js on the fake bot of
// the mining pack (its physics slides down ladders and climbs them against the wall; a fake clock moves it on).
// The shaft of the base: ladders facing south at (2, 41..59, -2) on the stone wall at z -3, an oak trapdoor at
// (2, 60, -2), grass at y 60, the room at y 41. Down through a closed trapdoor: one click without sneak, then the
// slide. Up: into the column from the foot, the closed trapdoor opened from below, the climb. Stopped half way.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { makeWorld, makeMiningBot, makeClock } from './mining_fake_bot.test.js';

const P = await loadSrc('src/agent/library/ladder_pass.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const COLUMN = Object.freeze({ x: 2, z: -2, top: 59, bottom: 41, facing: 'south', trapdoor: Object.freeze({ x: 2, y: 60, z: -2, name: 'oak_trapdoor' }) });

function scene(pos, { open = false, opens = true, ladders = [41, 59], floor = true } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    world.fill(2, ladders[0], -2, 2, ladders[1], -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open });
    if (!floor) world.fill(2, 30, -2, 2, 40, -2, 'air');
    const solid = world.solid;
    world.solid = (x, y, z) => (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true ? false : solid(x, y, z));
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    bot.clicks = [];
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.clicks.push({ x: p.x, y: p.y, z: p.z, sneak: bot.controls.sneak });
        if (opens) world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    const feet = () => ({ x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y + 0.01), z: Math.floor(bot.entity.position.z) });
    return { world, bot, clock, feet };
}

describe('passLadder: down', () => {
    test('through a closed trapdoor: one click without sneak, then the slide to the foot', async () => {
        const s = scene([2.5, 61, -0.5]);
        s.bot.controls.sneak = true; // a sneaking click would use the item in the hand (F11)
        const r = await P.passLadder(s.bot, COLUMN, 'down', { clock: s.clock });
        assert.deepEqual(r, { ok: true, reason: null, text: 'I went down the ladder at (2, 60, -2).' });
        assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }]);
        assert.deepEqual(s.feet(), { x: 2, y: 41, z: -2 });
        assert.equal(s.world.propsAt(2, 60, -2).open, true, 'nothing is closed: the door service does that');
    });

    test('an open trapdoor: no click', async () => {
        const s = scene([2.5, 61, -0.5], { open: true });
        const r = await P.passLadder(s.bot, COLUMN, 'down', { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual(s.bot.clicks, []);
        assert.deepEqual(s.feet(), { x: 2, y: 41, z: -2 });
    });

    test('a trapdoor that does not open: the text, no slide', async () => {
        const s = scene([2.5, 61, -0.5], { opens: false });
        const r = await P.passLadder(s.bot, COLUMN, 'down', { clock: s.clock });
        assert.deepEqual(r, { ok: false, reason: 'blocked_door', text: 'I could not go down the ladder at (2, 60, -2): the trapdoor did not open.' });
        assert.equal(s.feet().y, 61);
    });

    test('no floor under the column: refused before the trapdoor is opened', async () => {
        const s = scene([2.5, 61, -0.5], { floor: false });
        const r = await P.passLadder(s.bot, COLUMN, 'down', { clock: s.clock });
        assert.equal(r.reason, 'no_floor');
        assert.equal(r.text, 'I could not go down the ladder at (2, 60, -2): there is no floor under it.');
        assert.deepEqual(s.bot.clicks, []);
    });

    test('stopped half way: reason interrupted, the text says so, the controls are released', async () => {
        const s = scene([2.5, 61, -0.5]);
        s.clock.onTick = () => {
            if (s.bot.entity.position.y < 52) s.bot.interrupt_code = true;
        };
        const r = await P.passLadder(s.bot, COLUMN, 'down', { clock: s.clock });
        assert.deepEqual(r, { ok: false, reason: 'interrupted', text: 'I could not go down the ladder at (2, 60, -2): I was stopped.' });
        assert.ok(Object.values(s.bot.controls).every((on) => on === false), JSON.stringify(s.bot.controls));
    });
});

describe('passLadder from inside the column (W75, L3)', () => {
    test('half way down under a closed trapdoor: the slide starts where the bot is, no click', async () => {
        const s = scene([2.5, 48, -1.5]);
        s.bot.controls.sneak = true; // what held the bot on the ladder is released first
        const r = await P.passLadder(s.bot, P.columnNear(s.bot), 'down', { clock: s.clock });
        assert.deepEqual(r, { ok: true, reason: null, text: 'I went down the ladder at (2, 60, -2).' });
        assert.deepEqual(s.bot.clicks, []);
        assert.deepEqual(s.feet(), { x: 2, y: 41, z: -2 });
        assert.equal(s.bot.calls.filter((c) => c[0] === 'goto').length, 0, 'no walk out of the column');
    });

    test('half way up under a closed trapdoor: the climb starts where the bot is, the trapdoor opened from below', async () => {
        const s = scene([2.5, 50, -1.5]);
        s.bot.controls.sneak = true;
        const r = await P.passLadder(s.bot, P.columnNear(s.bot), 'up', { clock: s.clock });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }, { x: 2, y: 60, z: -2, sneak: false }], 'F35: opened from below, closed from beside');
        assert.ok(s.feet().y >= 61, JSON.stringify(s.feet()));
    });
});

describe('passLadder: up', () => {
    test('from the foot through the closed trapdoor: into the column, one click without sneak from below, out at the top', async () => {
        const s = scene([2.5, 41, -0.5]);
        const r = await P.passLadder(s.bot, COLUMN, 'up', { clock: s.clock });
        assert.deepEqual(r, { ok: true, reason: null, text: 'I climbed up the ladder at (2, 60, -2).' });
        assert.deepEqual(s.bot.clicks, [{ x: 2, y: 60, z: -2, sneak: false }, { x: 2, y: 60, z: -2, sneak: false }], 'F35: opened from below, closed again from beside it');
        assert.equal(s.world.propsAt(2, 60, -2).open, false, 'F35: the trapdoor is closed behind the bot');
        assert.ok(s.feet().y >= 61, JSON.stringify(s.feet()));
    });

    test('no way to the foot (the path search fails): a refusal with its text', async () => {
        const s = scene([2.5, 61, -0.5], { open: true });
        s.bot.noPath = true;
        const r = await P.passLadder(s.bot, COLUMN, 'up', { clock: s.clock });
        assert.equal(r.ok, false);
        assert.match(r.text, /^I could not climb up the ladder at \(2, 60, -2\): /);
    });
});

describe('ladderStepTowards (L4)', () => {
    test('a point 20 below, the column 3 blocks away: the log line with "to", one pass, the progress for unstuck', async () => {
        const s = scene([5.5, 61, -0.5]);
        const lines = [];
        const progress = [];
        s.bot.modes = { noteProgress: (why) => progress.push(why) };
        const passes = [];
        const r = await P.ladderStepTowards(s.bot, { x: 2, y: 41, z: 0 }, { passes, log: (t) => lines.push(t), clock: s.clock, now: s.clock.now });
        assert.deepEqual(r, { tried: true, ok: true, reason: null, text: 'I went down the ladder at (2, 60, -2).', way: 'down' });
        assert.deepEqual(lines, ['I go down the ladder at (2, 60, -2) to (2, 41, 0).']);
        assert.deepEqual(progress, ['ladder']);
        assert.equal(passes.length, 1);
    });

    test('"after <player>", at most 3 passes a minute, no pass towards a pit 2 below beside the ladder', async () => {
        const s = scene([5.5, 61, -0.5], { open: true });
        const lines = [];
        const now = () => 1000;
        const limited = await P.ladderStepTowards(s.bot, { x: 2, y: 41, z: 0 }, { passes: [10, 20, 30], now, log: (t) => lines.push(t), clock: s.clock });
        assert.equal(limited.tried, false);
        assert.equal(limited.reason, 'limit');
        assert.deepEqual(lines, []);
        const pit = await P.ladderStepTowards(s.bot, { x: 6, y: 59, z: 0 }, { clock: s.clock });
        assert.deepEqual([pit.tried, pit.reason], [false, 'no_way'], 'the pit at y 59 is not below the top ladder');
        const far = await P.ladderStepTowards(s.bot, { x: 2, y: 41, z: 0 }, { reach: 2, clock: s.clock });
        assert.equal(far.reason, 'no_column', 'reach 2: the column 3 blocks away is not seen');
        const r = await P.ladderStepTowards(s.bot, { x: 2, y: 41, z: 0 }, { after: 'MartyByrde2', log: (t) => lines.push(t), clock: s.clock });
        assert.equal(r.ok, true);
        assert.deepEqual(lines, ['I go down the ladder at (2, 60, -2) after MartyByrde2.']);
    });
});

describe('passLadder: bad input, and the module', () => {
    test('no column or no way: no_column, never throws', async () => {
        const s = scene([2.5, 61, -0.5]);
        assert.equal((await P.passLadder(s.bot, null, 'down', { clock: s.clock })).reason, 'no_column');
        assert.equal((await P.passLadder(s.bot, COLUMN, 'sideways', { clock: s.clock })).reason, 'no_column');
        const broken = { ...s.bot, blockAt() { throw new Error('no world'); }, clearControlStates() {} };
        const r = await P.passLadder(broken, COLUMN, 'down', { clock: s.clock });
        assert.equal(r.ok, false);
    });

    test('the texts of the reasons', () => {
        assert.equal(P.passText(COLUMN, 'down', null), 'I went down the ladder at (2, 60, -2).');
        assert.equal(P.passText(COLUMN, 'up', 'stuck'), 'I could not climb up the ladder at (2, 60, -2): I got stuck on it.');
        assert.equal(P.passText(COLUMN, 'down', 'no_path'), 'I could not go down the ladder at (2, 60, -2): I found no way to it.');
    });

    test('columnNear reads the world of the bot', () => {
        const s = scene([2.5, 61, -0.5]);
        assert.deepEqual(P.columnNear(s.bot), COLUMN);
    });

    test('the mining pack is not imported statically (the library loads without it)', () => {
        const imports = importsOf('src/agent/library/ladder_pass.js');
        assert.ok(imports.static.every((spec) => !/packs\/mining\//.test(spec)), JSON.stringify(imports.static));
        assert.equal(imports.dynamic, 2, 'ladder.js and dig.js with import()');
    });
});
