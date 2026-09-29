// T1, spec v0.1.4.8 section 5 (part A), the pure modules, tested from the spec and the handoff notes:
//   A1 what counts as stuck (reflex/stuck_logic.js), A2 the rule of failed escapes and the text of a
//   reflex that gives up, withTimeLimit of src/utils/kill_timer.js;
//   I2 / A7 the ground around the bot (reflex/ground_logic.js) and whereAmI (reflex/where_am_i.js),
//   with the cases of the play test: the shaft under the house at y 41, the house on the surface, the
//   foot of a cliff with 4 high and 4 low columns;
//   A4 / I5 the output of an action and who stopped it (reflex/output_logic.js);
//   A8 the tries of item_collecting (reflex/item_logic.js);
//   A9 / A10 hunger damage and the retreat at low health (reflex/health_logic.js).
// Defaults of the settings of section 2 that these modules read: stuck_restart_after 1, flee_below_health 0.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';

const stuck = await loadSrc('src/agent/reflex/stuck_logic.js');
const ground = await loadSrc('src/agent/reflex/ground_logic.js');
const where = await loadSrc('src/agent/reflex/where_am_i.js');
const output = await loadSrc('src/agent/reflex/output_logic.js');
const items = await loadSrc('src/agent/reflex/item_logic.js');
const health = await loadSrc('src/agent/reflex/health_logic.js');
const timer = await loadSrc('src/utils/kill_timer.js');

const LIMIT = { timeout: 20000 };
const TOP = 320; // minY -64 + height 384
const BOTTOM = -64;

// ------------------------------------------------------------------------------------------ A1

describe('A1: what counts as stuck', () => {
    const at = (x, y, z) => ({ x, y, z });
    const sample = (over = {}) => ({ pos: at(0.5, 64, 0.5), digTarget: null, inventoryKey: '36:1', windowOpen: false,
        sleeping: false, usingItem: false, notedAt: 0, ...over });

    // runs the samples at the given times (ms); returns the last step
    function run(samples) {
        let state = stuck.newStuckState();
        let last = null;
        for (const [t, s] of samples) {
            last = stuck.stuckStep(state, s, t);
            state = last.state;
        }
        return last;
    }

    test('the limit is 20 s, 40 s while the bot digs obsidian', () => {
        assert.equal(stuck.stuckLimitMs(sample()), 20000);
        assert.equal(stuck.stuckLimitMs(sample({ digTarget: { name: 'obsidian', position: at(1, 64, 0) } })), 40000);
        assert.equal(stuck.stuckLimitMs(sample({ digTarget: { name: 'stone', position: at(1, 64, 0) } })), 20000);
    });

    test('19 s at the same place: not stuck; 21 s: stuck', () => {
        assert.equal(run([[0, sample()], [19000, sample()]]).stuck, false);
        assert.equal(run([[0, sample()], [10000, sample()], [21000, sample()]]).stuck, true);
    });

    test('digging obsidian: 21 s is not stuck, 41 s is', () => {
        const dig = { name: 'obsidian', position: at(1, 64, 0) };
        assert.equal(run([[0, sample({ digTarget: dig })], [21000, sample({ digTarget: dig })]]).stuck, false);
        assert.equal(run([[0, sample({ digTarget: dig })], [41000, sample({ digTarget: dig })]]).stuck, true);
    });

    const resets = [
        ['the position moved 2 blocks', sample({ pos: at(2.5, 64, 0.5) })],
        ['the dig target changed', sample({ digTarget: { name: 'stone', position: at(1, 64, 0) } })],
        ['inventoryKey changed', sample({ inventoryKey: '36:2' })],
        ['a window is open', sample({ windowOpen: true })],
        ['the bot sleeps', sample({ sleeping: true })],
        ['the bot uses an item', sample({ usingItem: true })],
        ['notedAt is newer than the start of the stuck time', sample({ notedAt: 15000 })],
    ];
    for (const [what, s] of resets) {
        test(`the stuck time starts again when ${what}`, () => {
            // 15 s, then the signal, then 10 s more: 25 s since the start, but only 10 s since the signal
            const last = run([[0, sample()], [15000, s], [25000, s.pos.x === 2.5 ? s : sample({ ...s })]]);
            assert.equal(last.stuck, false, what);
        });
    }

    test('a move of 1.9 blocks is no progress', () => {
        assert.equal(run([[0, sample()], [10000, sample({ pos: at(2.4, 64, 0.5) })], [21000, sample({ pos: at(2.4, 64, 0.5) })]]).stuck, true);
    });

    test('a note of progress older than the start of the stuck time does not help', () => {
        assert.equal(run([[1000, sample({ notedAt: 500 })], [22000, sample({ notedAt: 500 })]]).stuck, true);
    });

    test('inventoryKey: counts of all slots, the off-hand (slot 45) included', () => {
        const slots = new Array(46).fill(null);
        slots[36] = { name: 'bread', count: 3 };
        const before = stuck.inventoryKey(slots);
        slots[45] = { name: 'apple', count: 1 };
        const after = stuck.inventoryKey(slots);
        assert.notEqual(before, after, 'a change in the off-hand changes the key');
        assert.equal(typeof before, 'string');
        assert.ok(before.length < 40, 'a short text');
    });

    test('the texts of the reflex', () => {
        assert.equal(stuck.STUCK_TEXT, "I'm stuck!");
        assert.equal(stuck.FREE_TEXT, "I'm free.");
        assert.equal(stuck.KILL_TEXT, "Got stuck and couldn't get unstuck");
        assert.equal(stuck.STUCK_RULES.escapeDistance, 5, 'moveAway(bot, 5)');
    });
});

// ------------------------------------------------------------------------------------------ A2

describe('A2: a failed escape does not kill', () => {
    test('the setting stuck_restart_after: default 1, whole numbers >= 0', () => {
        assert.equal(stuck.restartAfter(undefined), 1, 'default of section 2');
        assert.equal(stuck.restartAfter(0), 0);
        assert.equal(stuck.restartAfter(3), 3);
        assert.equal(stuck.restartAfter(-1), 1);
        assert.equal(stuck.restartAfter(2.5), 1);
    });

    test('the escape has a limit of 10 s with stuck_restart_after 1 (v0.1.4.7), 20 s with the others (handoff)', () => {
        assert.equal(stuck.escapeLimitMs(1), 10000);
        assert.equal(stuck.escapeLimitMs(undefined), 10000);
        assert.equal(stuck.escapeLimitMs(0), 20000);
        assert.equal(stuck.escapeLimitMs(3), 20000);
        assert.equal(stuck.isLegacyEscape(1), true);
        assert.equal(stuck.isLegacyEscape(3), false);
    });

    test('failure: time over, or the bot is still within 2 blocks of where it stood; success: 2 blocks or more away', () => {
        const from = { x: 0.5, y: 41, z: 0.5 };
        assert.equal(stuck.escapeOutcome({ done: false, interrupted: false, from, to: { x: 9, y: 41, z: 0.5 } }), 'failed', 'time over');
        assert.equal(stuck.escapeOutcome({ done: true, interrupted: false, from, to: { x: 1.5, y: 41, z: 0.5 } }), 'failed', 'within 2 blocks');
        assert.equal(stuck.escapeOutcome({ done: true, interrupted: false, from, to: { x: 2.5, y: 41, z: 0.5 } }), 'free');
    });

    test('stuck_restart_after 1: the first failure ends the process (as v0.1.4.7)', () => {
        assert.deepEqual(stuck.failureStep(0, 1), { count: 1, kill: true });
    });

    test('stuck_restart_after 3: gives up twice, the third failure in a row ends the process', () => {
        const first = stuck.failureStep(0, 3);
        const second = stuck.failureStep(first.count, 3);
        const third = stuck.failureStep(second.count, 3);
        assert.deepEqual([first.kill, second.kill, third.kill], [false, false, true]);
        assert.equal(third.count, 3);
    });

    test('stuck_restart_after 0: never ends the process', () => {
        let count = 0;
        for (let i = 0; i < 50; i++) {
            const step = stuck.failureStep(count, 0);
            assert.equal(step.kill, false);
            count = step.count;
        }
    });

    test('the pause after giving up ends when a new command starts or the bot moved 2 blocks', () => {
        const gaveUp = { pos: { x: 8.5, y: 41, z: 48.5 }, serial: 4 };
        assert.equal(stuck.giveUpEnds(gaveUp, { pos: { x: 8.5, y: 41, z: 48.5 }, serial: 4 }), false);
        assert.equal(stuck.giveUpEnds(gaveUp, { pos: { x: 9.9, y: 41, z: 48.5 }, serial: 4 }), false);
        assert.equal(stuck.giveUpEnds(gaveUp, { pos: { x: 8.5, y: 41, z: 48.5 }, serial: 5 }), true, 'a new command');
        assert.equal(stuck.giveUpEnds(gaveUp, { pos: { x: 10.5, y: 41, z: 48.5 }, serial: 4 }), true, 'moved 2 blocks');
    });

    test('the line of the behaviour log, word for word (the kill spot of the play test at y 41)', () => {
        const pos = { x: 8.51, y: 41, z: 48.37 };
        assert.equal(stuck.stuckText({ pos }), 'I am stuck at (8, 41, 48) and could not walk away.');
        assert.equal(stuck.stuckText({ pos, area: { name: 'mining_area', type: 'mine' } }),
            'I am stuck at (8, 41, 48) and could not walk away. I am in the area "mining_area" (mine).');
        assert.equal(stuck.stuckText({ pos, area: { name: 'mining_area', type: 'mine' }, door: { name: 'oak_trapdoor', x: 8, y: 43, z: 48 } }),
            'I am stuck at (8, 41, 48) and could not walk away. I am in the area "mining_area" (mine). A oak_trapdoor is at (8, 43, 48).');
    });

    test('the nearest door, gate or trapdoor within 3 blocks', () => {
        const world = createBlockWorld().flatGround(63);
        world.set(2, 64, 0, 'oak_door');
        world.set(0, 64, 1, 'oak_fence_gate');
        const pos = { x: 0.5, y: 64, z: 0.5 };
        assert.deepEqual(stuck.nearestOpenable(world.getBlockName, pos), { name: 'oak_fence_gate', x: 0, y: 64, z: 1 });
        world.set(0, 64, 1, 'air');
        assert.deepEqual(stuck.nearestOpenable(world.getBlockName, pos), { name: 'oak_door', x: 2, y: 64, z: 0 });
        world.set(2, 64, 0, 'air');
        world.set(0, 66, 0, 'spruce_trapdoor');
        assert.equal(stuck.nearestOpenable(world.getBlockName, pos)?.name, 'spruce_trapdoor');
        world.set(0, 66, 0, 'air');
        world.set(5, 64, 0, 'oak_door');
        assert.equal(stuck.nearestOpenable(world.getBlockName, pos), null, 'a door 4.5 blocks away is not named');
    });
});

describe('A2: withTimeLimit resolves { done, value, error } and never kills', () => {
    test('a value in time', LIMIT, async () => {
        const r = await timer.withTimeLimit(1000, async () => 7);
        assert.equal(r.done, true);
        assert.equal(r.value, 7);
    });

    test('an error in time is returned, not thrown', LIMIT, async () => {
        const r = await timer.withTimeLimit(1000, async () => { throw new Error('No path to the goal!'); });
        assert.equal(r.done, true);
        assert.equal(r.error?.message, 'No path to the goal!');
    });

    test('a synchronous throw is returned too', LIMIT, async () => {
        const r = await timer.withTimeLimit(1000, () => { throw new Error('boom'); });
        assert.equal(r.done, true);
        assert.equal(r.error?.message, 'boom');
    });

    test('the time is over: { done: false }, the late result is dropped', LIMIT, async () => {
        let finishLate;
        const started = Date.now();
        const r = await timer.withTimeLimit(100, () => new Promise((resolve) => { finishLate = resolve; }));
        assert.equal(r.done, false);
        assert.ok(Date.now() - started < 1000);
        finishLate('late'); // nothing happens
    });

    test('withKillTimer stays for other callers and calls onTimeout when the time is over', LIMIT, async () => {
        let killed = 0;
        const value = await timer.withKillTimer(() => { killed++; }, 50, () => new Promise((resolve) => setTimeout(() => resolve('x'), 150)));
        assert.equal(value, 'x');
        assert.equal(killed, 1);
    });
});

// ------------------------------------------------------------------------------------ I2, A7

describe('I2: the ground around the bot', () => {
    test('the 8 columns at the offsets of the spec', () => {
        const spec = [[4, 0], [-4, 0], [0, 4], [0, -4], [3, 3], [3, -3], [-3, 3], [-3, -3]];
        assert.deepEqual(ground.GROUND_OFFSETS.map((o) => [...o]).sort(), spec.sort());
    });

    test('isUnderground: depth > 8', () => {
        assert.equal(ground.isUnderground(8), false);
        assert.equal(ground.isUnderground(9), true);
        assert.equal(ground.isUnderground(0), false);
    });

    test('flat ground: the ground level is the top block, the depth of a bot on it is 0', () => {
        const world = createBlockWorld().flatGround(63);
        const pos = { x: 0.5, y: 64, z: 0.5 };
        assert.equal(ground.groundLevelAround(world.getBlockName, pos, TOP), 63);
        assert.equal(ground.depthUnderGround(world.getBlockName, pos, TOP), 0);
    });

    test('air, leaves, logs, built blocks and plants without collision are no ground', () => {
        const world = createBlockWorld().flatGround(63);
        // every column gets something on top of the grass
        const tops = ['oak_leaves', 'oak_log', 'oak_planks', 'tall_grass', 'poppy', 'wheat', 'cobblestone', 'glass'];
        ground.GROUND_OFFSETS.forEach(([dx, dz], i) => {
            world.set(dx, 64, dz, tops[i]);
            world.set(dx, 65, dz, tops[i]);
        });
        assert.equal(ground.groundLevelAround(world.getBlockName, { x: 0.5, y: 64, z: 0.5 }, TOP), 63);
    });

    test('columns that are not loaded are left out; with fewer than 3 known columns the ground is unknown (null, depth 0)', () => {
        const world = createBlockWorld().flatGround(63);
        // only the columns x >= 3 are loaded: (4,0) (3,3) (3,-3)
        world.setLoaded({ min: { x: 3, y: -64, z: -10 }, max: { x: 10, y: 319, z: 10 } });
        assert.equal(ground.groundLevelAround(world.getBlockName, { x: 0.5, y: 30, z: 0.5 }, TOP), 63, '3 known columns are enough');
        world.setLoaded({ min: { x: 4, y: -64, z: -10 }, max: { x: 10, y: 319, z: 10 } });
        assert.equal(ground.groundLevelAround(world.getBlockName, { x: 0.5, y: 30, z: 0.5 }, TOP), null, 'only (4,0) is loaded');
        assert.equal(ground.depthUnderGround(world.getBlockName, { x: 0.5, y: 30, z: 0.5 }, TOP), 0);
    });

    // The owner's base: the surface at y 66 (feet at 67), a house of planks around the place home,
    // under it a shaft with ladders down to a room at y 41 (the kill spots of the play test).
    function ownerBase() {
        const world = createBlockWorld().flatGround(66, 'grass_block', 'stone');
        world.house({ x: 4, y: 66, z: 44, width: 9, depth: 11 });
        for (let y = 42; y <= 66; y++) {
            world.set(8, y, 48, 'air');
            world.set(9, y, 48, 'ladder');
        }
        world.fill(7, 41, 47, 9, 42, 49, 'air');
        return world;
    }

    test('play test: the bot at y 41 in the ladder shaft under the house is underground', () => {
        const world = ownerBase();
        const pos = { x: 8.51, y: 41, z: 48.37 };
        const depth = ground.depthUnderGround(world.getBlockName, pos, TOP, BOTTOM);
        assert.ok(depth > 8, `depth ${depth}`);
        assert.equal(ground.isUnderground(depth), true);
    });

    test('play test: the bot in the house on the surface is not underground', () => {
        const world = ownerBase();
        const pos = { x: 6.5, y: 67, z: 50.5 };
        const depth = ground.depthUnderGround(world.getBlockName, pos, TOP, BOTTOM);
        assert.equal(ground.isUnderground(depth), false, `depth ${depth}`);
    });

    test('a bot in the open under a roof of one block is not underground (its own column is not read)', () => {
        const world = createBlockWorld().flatGround(63);
        world.fill(0, 66, 0, 0, 80, 0, 'stone');
        assert.equal(ground.depthUnderGround(world.getBlockName, { x: 0.5, y: 64, z: 0.5 }, TOP), 0);
    });

    test('play test: the foot of a cliff with 4 high and 4 low columns is not underground', () => {
        const world = createBlockWorld().flatGround(63);
        const high = [[4, 0], [3, 3], [3, -3], [0, 4]];
        for (const [dx, dz] of high) world.fill(dx, 64, dz, dx, 83, dz, 'stone');
        const pos = { x: 0.5, y: 64, z: 0.5 };
        const depth = ground.depthUnderGround(world.getBlockName, pos, TOP);
        assert.equal(ground.isUnderground(depth), false, `depth ${depth}`);
        assert.equal(ground.groundLevelAround(world.getBlockName, pos, TOP), 63, 'the lower of the two middle values (tech lead)');
    });

    test('a cave under a mountain: every column 20 blocks higher, underground', () => {
        const world = createBlockWorld().flatGround(63);
        for (const [dx, dz] of ground.GROUND_OFFSETS) world.fill(dx, 64, dz, dx, 83, dz, 'stone');
        assert.equal(ground.isUnderground(ground.depthUnderGround(world.getBlockName, { x: 0.5, y: 64, z: 0.5 }, TOP)), true);
    });
});

describe('I2: whereAmI', () => {
    function fakeBot(world, pos, areaAt = null) {
        return {
            entity: { position: pos },
            game: { minY: -64, height: 384 },
            blockAt: (p) => {
                const name = world.get(p.x, p.y, p.z);
                return name === null ? null : { name };
            },
            areaGuard: areaAt ? { areaAt } : undefined,
        };
    }

    test('returns { area, depth, underground }; on the surface outside of areas', () => {
        const world = createBlockWorld().flatGround(63);
        const r = where.whereAmI(fakeBot(world, { x: 0.5, y: 64, z: 0.5 }));
        assert.deepEqual(r, { area: null, depth: 0, underground: false });
    });

    test('underground when deeper than 8', () => {
        const world = createBlockWorld().flatGround(63);
        const r = where.whereAmI(fakeBot(world, { x: 0.5, y: 40, z: 0.5 }));
        assert.equal(r.underground, true);
        assert.equal(r.depth, 24);
    });

    test('inside an area of type mine: underground, also on the surface', () => {
        const world = createBlockWorld().flatGround(63);
        const r = where.whereAmI(fakeBot(world, { x: 0.5, y: 64, z: 0.5 }, () => ({ name: 'mining_area', type: 'mine' })));
        assert.deepEqual(r.area, { name: 'mining_area', type: 'mine' });
        assert.equal(r.underground, true);
    });

    test('inside an area of another type on the surface: not underground', () => {
        const world = createBlockWorld().flatGround(63);
        const r = where.whereAmI(fakeBot(world, { x: 0.5, y: 64, z: 0.5 }, () => ({ name: 'farm', type: 'farm' })));
        assert.deepEqual(r.area, { name: 'farm', type: 'farm' });
        assert.equal(r.underground, false);
    });
});

// ------------------------------------------------------------------------------------ A4, I5

describe('A4: the output of an action', () => {
    test('MAX_OUT is 1500', () => {
        assert.equal(output.MAX_OUT, 1500);
    });

    test('a short output is given whole', () => {
        assert.equal(output.outputSummary('I dug 2 blocks.\n'), 'Action output:\nI dug 2 blocks.\n');
    });

    test('a long output: whole lines from the start and from the end, never a split line', () => {
        const lines = Array.from({ length: 120 }, (_, i) => `Line ${String(i).padStart(3, '0')}: ${'x'.repeat(30)}`);
        const text = lines.join('\n') + '\n';
        const summary = output.outputSummary(text);
        const kept = summary.split('\n').filter((l) => l.startsWith('Line '));
        assert.ok(kept.length > 10, 'lines are kept');
        for (const line of kept) assert.ok(lines.includes(line), `a whole line: ${line}`);
        assert.ok(kept.includes(lines[0]), 'the first line');
        assert.ok(kept.includes(lines[lines.length - 1]), 'the last line');
        const keptChars = kept.reduce((n, l) => n + l.length + 1, 0);
        assert.ok(keptChars <= 1500, `${keptChars} characters of output`);
        assert.ok(keptChars > 1200, `the limit is used: ${keptChars}`);
    });

    test('the chest line of 1100 characters is not cut (C3 of the play test)', () => {
        const line = 'The chest at (11, 67, 53) contains: ' + Array.from({ length: 60 }, (_, i) => `item_${i} ${100 - i}`).join(', ') + '.';
        assert.ok(line.length > 700 && line.length < 1500);
        assert.equal(output.outputSummary(line + '\n'), 'Action output:\n' + line + '\n');
    });
});

describe('I5: who stopped', () => {
    test('the texts of stopped_by', () => {
        assert.equal(output.stopperText('mode:unstuck'), 'the reflex unstuck');
        assert.equal(output.stopperText('action:mineOre'), 'the command !mineOre');
        assert.equal(output.stopperText('!stop'), '!stop');
        assert.equal(output.stopperText('a new message'), 'a new message');
    });
});

// ------------------------------------------------------------------------------------------ A8

describe('A8: items on the ground', () => {
    test('a pick-up that gained nothing: tried again after 3 s', () => {
        assert.equal(items.mayTryItem(undefined, 0), true, 'never tried');
        const after = items.afterItemTry(undefined, false, 1000);
        assert.equal(items.mayTryItem(after, 3999), false);
        assert.equal(items.mayTryItem(after, 4000), true);
    });

    test('at most 3 tries again after the first', () => {
        let record;
        let now = 0;
        let tries = 0;
        while (items.mayTryItem(record, now) && tries < 20) {
            tries++;
            record = items.afterItemTry(record, false, now);
            now += 3000;
        }
        assert.equal(tries, 4, 'the first try and 3 more');
    });

    test('a pick-up that gained something ends the tries', () => {
        const r = items.afterItemTry(undefined, true, 0);
        assert.equal(items.mayTryItem(r, 100000), false);
    });

    test('an item that the bot itself dropped is left for 10 s', () => {
        assert.equal(items.isRecentOwnDrop(1000, 10999), true);
        assert.equal(items.isRecentOwnDrop(1000, 11000), false);
        assert.equal(items.isRecentOwnDrop(undefined, 0), false);
    });
});

// ------------------------------------------------------------------------------------- A9, A10

describe('A9: hunger damage', () => {
    const base = { food: 0, inLava: false, inFire: false, waterOverHead: false, hostileNear: false };

    test('food 0, no lava, fire, water over the head or hostile mob within 16: hunger', () => {
        assert.equal(health.isHungerDamage(base), true);
    });

    for (const [what, over] of [['food 1', { food: 1 }], ['in lava', { inLava: true }], ['in fire', { inFire: true }],
        ['water over the head', { waterOverHead: true }], ['a hostile mob within 16 blocks', { hostileNear: true }]]) {
        test(`${what}: no hunger damage, self_preservation may run`, () => {
            assert.equal(health.isHungerDamage({ ...base, ...over }), false);
        });
    }

    test('the text and its rate', () => {
        assert.equal(health.STARVING_TEXT, 'I am starving.');
        assert.equal(health.STARVING_LOG_MS, 60000);
        assert.equal(health.HOSTILE_RANGE, 16);
    });
});

describe('A10: retreat at low health', () => {
    test('flee_below_health 0 (the default) is off', () => {
        assert.equal(health.shouldRetreat(1, 0), false);
        assert.equal(health.shouldRetreat(1, undefined), false);
    });

    test('below the setting: retreat; at it or above: fight', () => {
        assert.equal(health.shouldRetreat(7, 8), true);
        assert.equal(health.shouldRetreat(8, 8), false);
        assert.equal(health.shouldRetreat(20, 20), false);
    });

    test('the target: the nearest player within 32, else the shelter, else away', () => {
        assert.equal(health.PLAYER_RANGE, 32);
        assert.equal(health.retreatTarget({ player: true, shelter: true }), 'player');
        assert.equal(health.retreatTarget({ player: false, shelter: true }), 'shelter');
        assert.equal(health.retreatTarget({ player: false, shelter: false }), 'away');
    });

    test('the line of the behaviour log', () => {
        assert.equal(health.hurtText(6), 'I am hurt (health 6 of 20). I retreat.');
    });
});
