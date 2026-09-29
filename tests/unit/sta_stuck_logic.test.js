// Spec v0.1.4.8, part A, A1 and A2: the pure rules of the mode unstuck in src/agent/reflex/stuck_logic.js.
//   - what counts as stuck: the stuck time starts again on each progress signal (moved 2 blocks, a new
//     dig target, a changed inventory, an open window, sleeping, using an item, noteProgress); 20 s,
//     40 s for obsidian;
//   - the outcome of an escape, the count of failed escapes and stuck_restart_after;
//   - the end of the pause after the reflex gave up;
//   - the line of the behaviour log, word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const L = await loadSrc('src/agent/reflex/stuck_logic.js');

const P = { x: 10.5, y: 64, z: -3.5 };
const at = (dx, dy = 0, dz = 0) => ({ x: P.x + dx, y: P.y + dy, z: P.z + dz });
const sample = (extra = {}) => ({ pos: P, digTarget: null, inventoryKey: '36:5', windowOpen: false, sleeping: false, usingItem: false, notedAt: 0, ...extra });

// Runs the samples at the given times; returns the last step.
function run(steps) {
    let state = L.newStuckState();
    let last = null;
    for (const [time, s] of steps) {
        last = L.stuckStep(state, s, time);
        state = last.state;
    }
    return last;
}

describe('stuckStep: the stuck time (A1)', () => {
    test('the first sample starts the stuck time; 20 s later the bot is not stuck, after 20 s it is', () => {
        const first = L.stuckStep(L.newStuckState(), sample(), 1000);
        assert.equal(first.reason, 'start');
        assert.equal(first.stuck, false);
        assert.equal(run([[0, sample()], [20000, sample()]]).stuck, false, 'exactly 20 s');
        const late = run([[0, sample()], [20001, sample()]]);
        assert.equal(late.stuck, true);
        assert.equal(late.elapsedMs, 20001);
    });

    test('after stuck the state starts again', () => {
        let state = L.newStuckState();
        state = L.stuckStep(state, sample(), 0).state;
        const stuck = L.stuckStep(state, sample(), 25000);
        assert.equal(stuck.stuck, true);
        const next = L.stuckStep(stuck.state, sample(), 25300);
        assert.equal(next.stuck, false);
        assert.equal(next.reason, 'start');
    });

    test('obsidian: 40 s', () => {
        const obsidian = { name: 'obsidian', position: { x: 11, y: 64, z: -3 } };
        assert.equal(run([[0, sample({ digTarget: obsidian })], [39000, sample({ digTarget: obsidian })]]).stuck, false);
        assert.equal(run([[0, sample({ digTarget: obsidian })], [40001, sample({ digTarget: obsidian })]]).stuck, true);
        assert.equal(L.stuckLimitMs(sample({ digTarget: { name: 'crying_obsidian' } })), 20000);
        assert.equal(L.stuckLimitMs(sample({ digTarget: obsidian })), 40000);
        assert.equal(L.stuckLimitMs({}), 20000);
    });

    test('moving 2 blocks or more from where the stuck time started is progress; less is not', () => {
        const moved = run([[0, sample()], [15000, sample({ pos: at(2, 0, 0) })]]);
        assert.equal(moved.reason, 'moved');
        assert.equal(run([[0, sample()], [15000, sample({ pos: at(2, 0, 0) })], [30000, sample({ pos: at(2, 0, 0) })]]).stuck, false);
        // small steps that stay within 2 blocks of the start do not count
        const small = run([[0, sample()], [7000, sample({ pos: at(1, 0, 0) })], [14000, sample({ pos: at(1.9, 0, 0) })], [21000, sample({ pos: at(1.5, 0, 0) })]]);
        assert.equal(small.stuck, true);
        assert.equal(run([[0, sample()], [15000, sample({ pos: at(0, 2, 0) })]]).reason, 'moved', 'up a ladder');
    });

    test('a new dig target is progress; the same one is not; digging stops: progress', () => {
        const a = { name: 'stone', position: { x: 11, y: 64, z: -3 } };
        const b = { name: 'stone', position: { x: 11, y: 65, z: -3 } };
        assert.equal(run([[0, sample({ digTarget: a })], [15000, sample({ digTarget: b })]]).reason, 'dig');
        assert.equal(run([[0, sample({ digTarget: a })], [21000, sample({ digTarget: { ...a, position: { x: 11.2, y: 64.7, z: -2.9 } } })]]).stuck, true, 'the same block');
        assert.equal(run([[0, sample()], [15000, sample({ digTarget: a })]]).reason, 'dig', 'starts to dig');
        assert.equal(run([[0, sample({ digTarget: a })], [15000, sample()]]).reason, 'dig', 'stops to dig');
        assert.equal(run([[0, sample({ digTarget: { name: 'stone', x: 1, y: 2, z: 3 } })], [21000, sample({ digTarget: { name: 'stone', x: 1, y: 2, z: 3 } })]]).stuck, true, 'x, y, z on the target itself');
    });

    test('a changed inventory is progress (compared with the last sample)', () => {
        assert.equal(run([[0, sample()], [15000, sample({ inventoryKey: '36:6' })]]).reason, 'inventory');
        const again = run([[0, sample()], [15000, sample({ inventoryKey: '36:6' })], [30000, sample({ inventoryKey: '36:6' })]]);
        assert.equal(again.stuck, false, '15 s since the change');
        assert.equal(run([[0, sample()], [15000, sample({ inventoryKey: '36:6' })], [35001, sample({ inventoryKey: '36:6' })]]).stuck, true);
        assert.equal(run([[0, sample({ inventoryKey: undefined })], [21000, sample({ inventoryKey: undefined })]]).stuck, true, 'no key');
    });

    test('an open window, sleeping and using an item are progress while they last', () => {
        for (const [field, reason] of [['windowOpen', 'window'], ['sleeping', 'sleeping'], ['usingItem', 'using_item']]) {
            const step = run([[0, sample()], [30000, sample({ [field]: true })]]);
            assert.equal(step.stuck, false, field);
            assert.equal(step.reason, reason);
            // a chest open for a minute: never stuck
            const long = run([[0, sample({ [field]: true })], [30000, sample({ [field]: true })], [60000, sample({ [field]: true })]]);
            assert.equal(long.stuck, false, field);
            // closed again: 20 s from then
            assert.equal(run([[0, sample({ [field]: true })], [10000, sample()], [30001, sample()]]).stuck, true, field);
        }
    });

    test('noteProgress: a note newer than the start of the stuck time starts it again; an older one does not', () => {
        const noted = run([[0, sample()], [15000, sample({ notedAt: 14000 })]]);
        assert.equal(noted.reason, 'noted');
        assert.equal(run([[0, sample()], [15000, sample({ notedAt: 14000 })], [30000, sample({ notedAt: 14000 })]]).stuck, false);
        assert.equal(run([[0, sample()], [15000, sample({ notedAt: 14000 })], [35001, sample({ notedAt: 14000 })]]).stuck, true, 'the same note does not count twice');
        assert.equal(run([[5000, sample({ notedAt: 4000 })], [25001, sample({ notedAt: 4000 })]]).stuck, true, 'a note before the start');
    });

    test('no position or no state: the stuck time starts', () => {
        assert.equal(L.stuckStep(null, sample(), 5).reason, 'start');
        assert.equal(L.stuckStep(L.newStuckState(), { pos: null }, 5).reason, 'start');
        assert.equal(L.stuckStep(L.newStuckState(), null, 5).stuck, false);
    });
});

describe('inventoryKey(slots)', () => {
    test('the counts of all slots, empty ones left out, the off-hand (45) included', () => {
        const slots = new Array(46).fill(null);
        slots[36] = { name: 'bread', count: 12 };
        slots[9] = { name: 'stone', count: 64 };
        slots[45] = { name: 'bread', count: 6 };
        assert.equal(L.inventoryKey(slots), '9:64,36:12,45:6');
        slots[45] = null;
        assert.equal(L.inventoryKey(slots), '9:64,36:12');
    });

    test('nothing or not an array: an empty text', () => {
        assert.equal(L.inventoryKey([]), '');
        assert.equal(L.inventoryKey(undefined), '');
        assert.equal(L.inventoryKey({ 36: { count: 1 } }), '');
        assert.equal(L.inventoryKey([{ count: 0 }, { name: 'x' }]), '');
    });
});

describe('escapeOutcome, restartAfter, failureStep (A2)', () => {
    test('free: ended in time and 2 blocks or more away', () => {
        assert.equal(L.escapeOutcome({ done: true, interrupted: false, from: P, to: at(5) }), 'free');
        assert.equal(L.escapeOutcome({ done: true, interrupted: false, from: P, to: at(0, 2) }), 'free');
    });

    test('failed: the time was over, moveAway threw, or the bot is still within 2 blocks', () => {
        assert.equal(L.escapeOutcome({ done: false, interrupted: false, from: P, to: at(5) }), 'failed');
        assert.equal(L.escapeOutcome({ done: true, interrupted: false, from: P, to: at(1.9) }), 'failed');
        assert.equal(L.escapeOutcome({ done: true, error: true, interrupted: false, from: P, to: at(5) }), 'failed', 'an error, also 5 blocks away');
        assert.equal(L.escapeOutcome({ done: true, interrupted: false, from: P, to: null }), 'failed');
        assert.equal(L.escapeOutcome(undefined), 'failed');
    });

    test('stopped: an interrupt is no failure, also when the time was over', () => {
        assert.equal(L.escapeOutcome({ done: false, interrupted: true, from: P, to: P }), 'stopped');
        assert.equal(L.escapeOutcome({ done: true, interrupted: true, from: P, to: at(5) }), 'stopped');
    });

    test('restartAfter: a whole number of 0 or more, else 1', () => {
        assert.equal(L.restartAfter(0), 0);
        assert.equal(L.restartAfter(3), 3);
        for (const bad of [undefined, null, -1, 1.5, '3', NaN, true]) assert.equal(L.restartAfter(bad), 1, String(bad));
    });

    test('failureStep: 1 (the default) kills at the first failure, as in v0.1.4.7', () => {
        assert.deepEqual(L.failureStep(0, 1), { count: 1, kill: true });
        assert.deepEqual(L.failureStep(0, undefined), { count: 1, kill: true });
    });

    test('failureStep: 3 gives up twice and kills the third time; 0 never kills', () => {
        assert.deepEqual(L.failureStep(0, 3), { count: 1, kill: false });
        assert.deepEqual(L.failureStep(1, 3), { count: 2, kill: false });
        assert.deepEqual(L.failureStep(2, 3), { count: 3, kill: true });
        assert.deepEqual(L.failureStep(7, 0), { count: 8, kill: false });
        assert.deepEqual(L.failureStep(-4, 2), { count: 1, kill: false }, 'a bad count counts as 0');
    });
});

describe('stuck_restart_after 1: the escape of v0.1.4.7 (decision of the tech lead)', () => {
    test('isLegacyEscape: only for 1, also for the default of a missing or bad value', () => {
        assert.equal(L.isLegacyEscape(1), true);
        assert.equal(L.isLegacyEscape(undefined), true);
        assert.equal(L.isLegacyEscape('x'), true);
        for (const value of [0, 2, 3, 10]) assert.equal(L.isLegacyEscape(value), false, String(value));
    });

    test('escapeLimitMs: 10 s with 1, 20 s with every other value', () => {
        assert.equal(L.escapeLimitMs(1), 10000);
        assert.equal(L.escapeLimitMs(undefined), 10000);
        for (const value of [0, 2, 3]) assert.equal(L.escapeLimitMs(value), 20000, String(value));
        assert.equal(L.STUCK_RULES.escapeLongMs, 20000);
    });

    test('legacyOutcome: a return is free wherever the bot stands; an error is passed on; an interrupt stops', () => {
        assert.equal(L.legacyOutcome({ done: true, value: true }), 'free');
        assert.equal(L.legacyOutcome({ done: true, value: false }), 'free', 'moveAway returned false: free as in v0.1.4.7');
        assert.equal(L.legacyOutcome({ done: true, error: true }), 'throw');
        assert.equal(L.legacyOutcome({ done: true, error: true, interrupted: true }), 'throw', 'PathStopped after !stop is passed on as in v0.1.4.7');
        assert.equal(L.legacyOutcome({ done: false, stopped: true }), 'stopped');
        assert.equal(L.legacyOutcome({ done: true, interrupted: true }), 'stopped', 'a return after an interrupt says nothing');
        assert.equal(L.legacyOutcome(undefined), 'stopped');
    });
});

describe('giveUpEnds: the pause after the reflex gave up', () => {
    const givenUp = { pos: P, serial: 4 };
    test('a new command ends it', () => {
        assert.equal(L.giveUpEnds(givenUp, { pos: P, serial: 5 }), true);
    });
    test('2 blocks away ends it; less does not', () => {
        assert.equal(L.giveUpEnds(givenUp, { pos: at(2), serial: 4 }), true);
        assert.equal(L.giveUpEnds(givenUp, { pos: at(1.5), serial: 4 }), false);
        assert.equal(L.giveUpEnds(givenUp, { pos: null, serial: 4 }), false);
    });
    test('no pause: ended', () => {
        assert.equal(L.giveUpEnds(null, { pos: P, serial: 4 }), true);
    });
});

describe('isOpenableName and nearestOpenable', () => {
    test('doors, fence gates and trapdoors of any material', () => {
        for (const name of ['oak_door', 'iron_door', 'spruce_trapdoor', 'iron_trapdoor', 'oak_fence_gate', 'minecraft:birch_door'])
            assert.equal(L.isOpenableName(name), true, name);
        for (const name of ['oak_fence', 'door', 'stone', 'oak_planks', null, 7])
            assert.equal(L.isOpenableName(name), false, String(name));
    });

    // blocks: { 'x,y,z': name }
    const reader = (blocks) => (x, y, z) => blocks[`${x},${y},${z}`] ?? 'stone';

    test('the nearest within 3 blocks of the bot (to the middle of the block)', () => {
        const pos = { x: 8.5, y: 41, z: 48.5 };
        const blocks = { '8,44,48': 'oak_trapdoor', '10,41,48': 'oak_door' };
        assert.deepEqual(L.nearestOpenable(reader(blocks), pos, 3), { name: 'oak_door', x: 10, y: 41, z: 48 });
        assert.deepEqual(L.nearestOpenable(reader({ '8,43,48': 'oak_trapdoor' }), pos), { name: 'oak_trapdoor', x: 8, y: 43, z: 48 });
    });

    test('farther than 3 blocks: none; unloaded blocks and errors are skipped', () => {
        const pos = { x: 8.5, y: 41, z: 48.5 };
        assert.equal(L.nearestOpenable(reader({ '12,41,48': 'oak_door' }), pos, 3), null);
        assert.equal(L.nearestOpenable(() => null, pos), null);
        assert.equal(L.nearestOpenable(() => { throw new Error('x'); }, pos), null);
        assert.equal(L.nearestOpenable(null, pos), null);
        assert.equal(L.nearestOpenable(reader({}), null), null);
    });
});

describe('stuckText: the line of the behaviour log (word for word)', () => {
    test('the position only', () => {
        assert.equal(L.stuckText({ pos: { x: 8.51, y: 41, z: 48.37 } }), 'I am stuck at (8, 41, 48) and could not walk away.');
    });

    test('with the area and the door', () => {
        const text = L.stuckText({ pos: { x: 8.51, y: 41, z: 48.37 }, area: { name: 'mining_area', type: 'mine' }, door: { name: 'oak_trapdoor', x: 8, y: 44, z: 48 } });
        assert.equal(text, 'I am stuck at (8, 41, 48) and could not walk away. I am in the area "mining_area" (mine). A oak_trapdoor is at (8, 44, 48).');
    });

    test('negative coordinates are floored; a door without an area', () => {
        assert.equal(L.stuckText({ pos: { x: -0.5, y: 59, z: -12.2 }, door: { name: 'oak_door', x: -1, y: 59, z: -13 } }),
            'I am stuck at (-1, 59, -13) and could not walk away. A oak_door is at (-1, 59, -13).');
    });

    test('an area without a type: the name only', () => {
        assert.equal(L.stuckText({ pos: P, area: { name: 'base' } }), 'I am stuck at (10, 64, -4) and could not walk away. I am in the area "base".');
    });

    test('the texts of the mode', () => {
        assert.equal(L.STUCK_TEXT, "I'm stuck!");
        assert.equal(L.FREE_TEXT, "I'm free.");
        assert.equal(L.KILL_TEXT, "Got stuck and couldn't get unstuck");
        assert.equal(L.STUCK_RULES.escapeMs, 10000);
        assert.equal(L.STUCK_RULES.escapeDistance, 5);
    });
});

describe('module rules', () => {
    test('stuck_logic.js imports nothing and is importable without output or files', () => {
        assertImportRules('src/agent/reflex/stuck_logic.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/reflex/stuck_logic.js');
    });
});
