// Engineer E1 of v0.1.4.11, part W, spec W1 and I1: the failure texts of a route name the cause and the next
// step, word for word; "Show me the way again." is in no texts.js of a pack; walkRoute and walkByRoute of
// replay.js fill `cause` on failure from what the replay of v0.1.4.10 knows (door, ladder, no_path, stuck,
// interrupted). The fake bot of the mining pack walks the shaft of the base of the world tests, as in
// rta_replay.test.js: the room at y 41, ladders from y 41 to 59 at (2, -2), a trapdoor at (2, 60, -2).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeWorld, makeMiningBot, makeClock } from './mining_fake_bot.test.js';

const X = await loadSrc('src/agent/packs/routes/texts.js');
const P = await loadSrc('src/agent/packs/routes/index.js');
const R = await loadSrc('src/agent/packs/routes/replay.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const MINE = { name: 'mine' };

describe('W1: routeFailedText for each cause, word for word', () => {
    test('a door that is closed, a gate that is blocked', () => {
        assert.equal(X.routeFailedText(MINE, 6, 12, { x: 9, y: 41, z: 42 }, { kind: 'door', name: 'door', x: 9, y: 41, z: 43, state: 'closed' }),
            'I could not follow the route "mine" at step 6 of 12: the door at (9, 41, 43) is closed and I could not open it.');
        assert.equal(X.routeFailedText(MINE, 6, 12, null, { kind: 'door', name: 'gate', x: -6, y: 63, z: 28, state: 'blocked' }),
            'I could not follow the route "mine" at step 6 of 12: the gate at (-6, 63, 28) is blocked.');
        assert.equal(X.routeFailedText(MINE, 2, 4, null, { kind: 'door', name: 'trapdoor', x: 2, y: 60, z: -2, state: 'closed' }),
            'I could not follow the route "mine" at step 2 of 4: the trapdoor at (2, 60, -2) is closed and I could not open it.');
    });

    test('a gap in a ladder', () => {
        assert.equal(X.routeFailedText(MINE, 4, 12, null, { kind: 'ladder', x: 13, z: 51, y: 61, gap: 2 }),
            'I could not follow the route "mine" at step 4 of 12: the ladder at (13, 51) has a gap of 2 at y 61. I need 2 ladders to go on.');
        assert.equal(X.routeFailedText(MINE, 4, 12, null, { kind: 'ladder', x: 13, z: 51, y: 61, gap: 1 }),
            'I could not follow the route "mine" at step 4 of 12: the ladder at (13, 51) has a gap of 1 at y 61. I need 1 ladder to go on.');
    });

    test('no way for a walk leg, stuck', () => {
        assert.equal(X.routeFailedText(MINE, 2, 12, null, { kind: 'no_path', from: { x: 11, y: 67, z: 52 }, to: { x: 13, y: 68, z: 51 } }),
            'I could not follow the route "mine" at step 2 of 12: I found no way from (11, 67, 52) to (13, 68, 51).');
        assert.equal(X.routeFailedText(MINE, 7, 12, { x: 8, y: 41, z: 46 }, { kind: 'stuck', at: { x: 8.7, y: 41, z: 46.2 } }),
            'I could not follow the route "mine" at step 7 of 12: I got stuck at (8, 41, 46).');
    });

    test('without a cause it knows: the position, no "Show me the way again."', () => {
        assert.equal(X.routeFailedText(MINE, 3, 7, { x: 12, y: 45, z: 8 }), 'I could not follow the route "mine" at step 3 of 7, at (12, 45, 8).');
        assert.equal(X.routeFailedText(MINE, 3, 7, null, { kind: 'interrupted' }), 'I could not follow the route "mine" at step 3 of 7.');
    });

    test('noWayToStartText', () => {
        assert.equal(X.noWayToStartText(MINE, { x: 9, y: 67, z: 52 }, { x: 11.5, y: 67, z: 52.5 }),
            'I find no way from (11, 67, 52) to the start of the route "mine" at (9, 67, 52).');
    });

    test('"Show me the way again" is in no texts.js of a pack', () => {
        const dir = repoPath('src/agent/packs');
        const files = fs.readdirSync(dir).map((pack) => `${dir}/${pack}/texts.js`).filter((f) => fs.existsSync(f));
        assert.ok(files.length >= 5, files.join(', '));
        for (const file of files) assert.ok(!fs.readFileSync(file, 'utf8').includes('Show me the way again'), file);
    });
});

// ------------------------------------------------------------------ I1 on the fake bot

const T = { kind: 'trapdoor', name: 'oak_trapdoor', x: 2, y: 60, z: -2 };
const st = (x, y, z, extra = {}) => ({ x, y, z, on: 'stone', at: 'air', sky: false, t: 0, via: null, ...extra });
const UP = [st(2, 41, 1), st(2, 41, 0), st(2, 41, -1)];
for (let y = 41; y <= 59; y++) UP.push(st(2, y, -2, { at: 'ladder', via: y === 59 ? T : null }));
UP.push(st(2, 61, -3), st(1, 61, -2), st(0, 61, -1), st(-1, 61, 0), st(-2, 61, 1), st(-3, 61, 2));

function scene({ pos = [2.5, 41, 1.5], ladders = true } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    if (ladders) world.fill(2, 41, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open: false });
    const solid = world.solid;
    world.solid = (x, y, z) => {
        if (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true) return false;
        return solid(x, y, z);
    };
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    bot.modes = { noteProgress() {} };
    bot.failActivations = 0;
    bot.activateBlock = async (block) => {
        const p = block.position;
        if (bot.failActivations > 0) {
            bot.failActivations--;
            return;
        }
        world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    const ctx = { now: clock.now, log() {} };
    const faceAt = (x, y, z) => (world.nameAt(x, y, z) === 'ladder' ? world.propsAt(x, y, z).facing : null);
    const route = { name: 'bed', dimension: 'overworld', from: { name: 'storage', kind: 'place', x: 2, y: 41, z: 1 }, to: { name: 'bed', x: -3, y: 61, z: 2 },
        legs: P.routeFromSteps(UP, { faceAt }).legs, steps: UP.length, source: 'trail' };
    return { world, bot, clock, ctx, route, opts: { clock } };
}

describe('I1: walkRoute fills cause, step, total and the route on failure', () => {
    test('success: cause null, the fields of I1 there', async () => {
        const s = scene();
        const r = await P.walkRoute(s.bot, s.ctx, s.route, s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.cause, null);
        assert.equal(r.route, 'bed');
        assert.equal(r.total, 4);
    });

    test('a walk leg without a way: no_path from the feet to the end of the leg', async () => {
        const s = scene();
        s.bot.noPath = true;
        const r = await P.walkRoute(s.bot, s.ctx, s.route, s.opts);
        assert.deepEqual({ ok: r.ok, reason: r.reason, step: r.step, total: r.total, route: r.route }, { ok: false, reason: 'no_path', step: 1, total: 4, route: 'bed' });
        assert.deepEqual(r.cause, { kind: 'no_path', from: { x: 2, y: 41, z: 1 }, to: { x: 2, y: 41, z: -1 } });
        assert.equal(r.text, X.routeFailedText(s.route, 1, 4, r.at, r.cause));
        assert.ok(!r.text.includes('Show me the way again'));
    });

    test('a ladder leg with a gap: ladder with the column, the lowest cell of the gap and its size', async () => {
        const s = scene();
        s.world.set(2, 50, -2, 'air');
        s.world.set(2, 51, -2, 'air');
        const r = await P.walkRoute(s.bot, s.ctx, s.route, s.opts);
        assert.equal(r.step, 2);
        assert.deepEqual(r.cause, { kind: 'ladder', x: 2, z: -2, y: 50, gap: 2 });
        assert.equal(r.text, 'I could not follow the route "bed" at step 2 of 4: the ladder at (2, -2) has a gap of 2 at y 50. I need 2 ladders to go on.');
    });

    test('a trapdoor that does not open: door, its kind, closed', async () => {
        const s = scene({ pos: [-2.5, 61, 2.5] });
        s.bot.failActivations = 99;
        const r = await P.walkRoute(s.bot, s.ctx, s.route, { ...s.opts, reverse: true });
        assert.equal(r.reason, 'blocked_door');
        assert.deepEqual(r.cause, { kind: 'door', name: 'trapdoor', x: 2, y: 60, z: -2, state: 'closed' });
    });

    test('stopped: interrupted, and the text of a stop', async () => {
        const s = scene();
        s.bot.interrupt_code = true;
        const r = await P.walkRoute(s.bot, s.ctx, s.route, s.opts);
        assert.equal(r.reason, 'interrupted');
        assert.deepEqual(r.cause, { kind: 'interrupted' });
        assert.equal(r.text, 'I was stopped on the route "bed" at step 1 of 4.');
    });

    test('walkByRoute: no way to the start names where the bot stands, cause no_path', async () => {
        const s = scene({ pos: [-4.5, 61, 4.5] });
        s.bot.noPath = true;
        const r = await P.walkByRoute(s.bot, s.ctx, [s.route], { x: 2, y: 41, z: 1 }, s.opts);
        assert.equal(r.text, 'I find no way from (-5, 61, 4) to the start of the route "bed" at (-3, 61, 2).');
        assert.deepEqual(r.cause, { kind: 'no_path', from: { x: -5, y: 61, z: 4 }, to: { x: -3, y: 61, z: 2 } });
    });

    test('legCause: a door leg gives door, a stairs leg no_path, an unknown leg stuck; never throws', () => {
        const s = scene();
        s.world.set(5, 41, 0, 'oak_door', { facing: 'south', half: 'lower', open: false });
        s.world.set(5, 42, 0, 'oak_door', { facing: 'south', half: 'upper', open: false });
        const door = { kind: 'door', kind2: 'door', x: 5, y: 41, z: 0, from: { x: 5, y: 41, z: -1 }, to: { x: 5, y: 41, z: 1 } };
        assert.deepEqual(R.legCause(s.bot, door, { reason: 'no_path' }), { kind: 'door', name: 'door', x: 5, y: 41, z: 0, state: 'closed' });
        s.world.set(5, 41, 0, 'oak_door', { facing: 'south', half: 'lower', open: true });
        assert.equal(R.legCause(s.bot, door, { reason: 'no_path' }).state, 'blocked', 'open and not passed: blocked');
        assert.deepEqual(R.legCause(s.bot, { kind: 'stairs', from: { x: 2, y: 41, z: 1 }, to: { x: 4, y: 43, z: 1 } }, { reason: 'no_path' }),
            { kind: 'no_path', from: { x: 2, y: 41, z: 1 }, to: { x: 4, y: 43, z: 1 } });
        assert.deepEqual(R.legCause(s.bot, { kind: 'fly' }, { reason: 'error' }), { kind: 'stuck', at: { x: 2, y: 41, z: 1 } });
        assert.equal(R.legCause(null, null, null).kind, 'stuck');
    });
});
