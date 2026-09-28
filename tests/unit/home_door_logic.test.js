// Spec v0.1.4.6 H1: src/agent/packs/home/door_logic.js -- DoorTracker decides which doors to close.
// Pure module: the tests drive it with positions and a fake clock.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const D = await loadSrc('src/agent/packs/home/door_logic.js');

// A door at (0, 64, 0). Its centre at feet level is (0.5, 64, 0.5).
const DOOR = Object.freeze({ x: 0, y: 64, z: 0, kind: 'door', open: true, name: 'oak_door', facing: 'north' });
const at = (dz, dx = 0) => ({ x: 0.5 + dx, y: 64, z: 0.5 + dz });

function makeTracker(start = 0) {
    const clock = { t: start };
    const tracker = new D.DoorTracker({ now: () => clock.t });
    const step = (t, botPos, { doors = [DOOR], players = [] } = {}) => {
        clock.t = t;
        return tracker.observe({ botPos, doors, players });
    };
    return { tracker, clock, step };
}

describe('DoorTracker: the bot walks through a door and away', () => {
    // Distances are measured from the centre of the door, (0.5, 64, 0.5): at(z) is z blocks away.
    // Between 1.2 and 2 blocks the bot must have been away for 0.5 s; from 2 blocks on the door is
    // returned at once (DOOR_RULES.clearDistance, found on the real server: the bot sprints).
    test('the door is returned once the bot is 1.2 to 2 blocks away for 0.5 s', () => {
        const { step } = makeTracker();
        assert.deepEqual(step(0, at(0)), [], 'in the doorway');
        assert.deepEqual(step(300, at(1)), [], 'next to the door');
        assert.deepEqual(step(600, at(1.5)), [], 'just moved away');
        assert.deepEqual(step(900, at(1.9)), [], 'away for 0.3 s');
        const out = step(1100, at(1.9));
        assert.equal(out.length, 1, 'away for 0.5 s');
        assert.deepEqual({ x: out[0].x, y: out[0].y, z: out[0].z }, { x: 0, y: 64, z: 0 });
    });

    test('a bot that walks on quickly: the door is returned as soon as it is 2 blocks away', () => {
        // the path finder sprints about 5.6 blocks per second; the reflex looks every 300 ms
        const { step } = makeTracker();
        assert.deepEqual(step(0, at(0.2)), [], 'in the doorway');
        assert.deepEqual(step(300, at(1.4)), [], 'just past the door, not yet 2 blocks');
        assert.equal(step(600, at(3.1)).length, 1, '3.1 blocks away after 0.3 s');
        assert.deepEqual(step(900, at(4.8)), [], 'out of reach, and returned already');
        const t2 = makeTracker();
        t2.step(0, at(0.5));
        assert.equal(t2.step(300, at(2)).length, 1, 'exactly 2 blocks');
        const t3 = makeTracker();
        t3.step(0, at(0.5));
        assert.deepEqual(t3.step(300, at(1.99)), [], 'just below 2 blocks it waits for the 0.5 s');
    });

    test('a returned door is not returned again within 2 s, but after that if still open', () => {
        const { step } = makeTracker();
        step(0, at(0));
        step(100, at(1.5));
        assert.equal(step(600, at(1.5)).length, 1);
        assert.deepEqual(step(1000, at(1.5)), []);
        assert.deepEqual(step(2500, at(1.5)), []);
        assert.equal(step(2600, at(1.5)).length, 1, '2 s after the first return');
    });

    test('the bot must have been within 1.5 blocks during the last 10 s', () => {
        const { step } = makeTracker();
        step(0, at(1.4));
        step(100, at(1.9));
        assert.equal(step(700, at(1.9)).length, 1, 'near 0.7 s ago');
        const t2 = makeTracker();
        t2.step(0, at(1.6));
        t2.step(100, at(3));
        assert.deepEqual(t2.step(700, at(3)), [], 'never within 1.5');
    });

    test('more than 10 s after the bot was near, the door is left alone', () => {
        const { step } = makeTracker();
        step(0, at(0));
        step(9000, at(1.9));
        assert.deepEqual(step(10001, at(3.5)), []);
    });

    test('distance limits: more than 1.2 and at most 4 blocks', () => {
        const near = makeTracker();
        near.step(0, at(0));
        near.step(100, at(1.2));
        assert.deepEqual(near.step(1000, at(1.2)), [], 'exactly 1.2 is not more than 1.2');
        const far = makeTracker();
        far.step(0, at(0));
        far.step(100, at(4.01));
        assert.deepEqual(far.step(1000, at(4.01)), [], 'beyond 4 blocks the door is out of reach');
        const edge = makeTracker();
        edge.step(0, at(0));
        edge.step(100, at(1.5));
        assert.equal(edge.step(1000, at(4)).length, 1, 'exactly 4 is allowed');
    });

    test('coming back near resets the time away', () => {
        const { step } = makeTracker();
        step(0, at(0));
        step(100, at(1.5));
        step(500, at(0.5));
        assert.deepEqual(step(700, at(1.5)), [], 'away again only since 0.7 s');
        assert.deepEqual(step(1100, at(1.5)), []);
        assert.equal(step(1200, at(1.5)).length, 1);
    });

    test('the time away counts while the bot is out of reach, too', () => {
        const { step } = makeTracker();
        step(0, at(0));
        step(100, at(6));
        assert.equal(step(700, at(1.9)).length, 1);
    });
});

describe('DoorTracker: doors that stay open', () => {
    test('a closed door is never returned', () => {
        const { step } = makeTracker();
        const closed = { ...DOOR, open: false };
        step(0, at(0), { doors: [closed] });
        step(100, at(2), { doors: [closed] });
        assert.deepEqual(step(900, at(2), { doors: [closed] }), []);
    });

    test('another player within 2 blocks of the door keeps it open', () => {
        const { step } = makeTracker();
        const players = [{ x: 0.5, y: 64, z: 0.5 }];
        step(0, at(0), { players });
        step(100, at(2.5), { players });
        assert.deepEqual(step(900, at(2.5), { players }), [], 'player in the doorway');
        const t2 = makeTracker();
        const beside = [{ x: 2.4, y: 64, z: 0.5 }];
        t2.step(0, at(0), { players: beside });
        t2.step(100, at(-2.5), { players: beside });
        assert.deepEqual(t2.step(900, at(-2.5), { players: beside }), [], 'player 1.9 blocks away');
        const t3 = makeTracker();
        const away = [{ x: 3, y: 64, z: 0.5 }];
        t3.step(0, at(0), { players: away });
        t3.step(100, at(-1.5), { players: away });
        assert.equal(t3.step(900, at(-1.5), { players: away }).length, 1, 'player 2.5 blocks away');
    });

    test('doors of iron are never returned', () => {
        for (const name of ['iron_door', 'iron_trapdoor']) {
            const { step } = makeTracker();
            const iron = { ...DOOR, name };
            step(0, at(0), { doors: [iron] });
            step(100, at(2), { doors: [iron] });
            assert.deepEqual(step(900, at(2), { doors: [iron] }), [], name);
        }
        const { step } = makeTracker();
        const ironKind = { ...DOOR, name: undefined, kind: 'iron_door' };
        step(0, at(0), { doors: [ironKind] });
        step(100, at(2), { doors: [ironKind] });
        assert.deepEqual(step(900, at(2), { doors: [ironKind] }), [], 'kind iron_door');
    });
});

describe('DoorTracker: several doors and bad input', () => {
    test('only the door the bot was near is returned', () => {
        const { step } = makeTracker();
        const other = { ...DOOR, x: 3, z: 0 };
        const doors = [DOOR, other];
        step(0, at(0), { doors });
        step(100, at(0, -1.5), { doors });
        const out = step(700, at(0, -1.5), { doors });
        assert.deepEqual(out.map(d => d.x), [0]);
    });

    test('returned doors are copies', () => {
        const { step } = makeTracker();
        step(0, at(0));
        step(100, at(1.5));
        const out = step(700, at(1.5));
        out[0].x = 99;
        assert.equal(DOOR.x, 0);
    });

    test('garbage input returns an empty list and does not throw', () => {
        const { tracker, clock } = makeTracker();
        assert.deepEqual(tracker.observe(), []);
        assert.deepEqual(tracker.observe(null), []);
        assert.deepEqual(tracker.observe({ botPos: null, doors: [DOOR] }), []);
        assert.deepEqual(tracker.observe({ botPos: at(0), doors: 'x' }), []);
        clock.t = 10;
        assert.deepEqual(tracker.observe({ botPos: at(0), doors: [null, { x: NaN, y: 0, z: 0, open: true }, 5] }), []);
        assert.deepEqual(tracker.observe({ botPos: at(0), doors: [DOOR], players: 'nobody' }), []);
    });

    test('a clock that returns a Date works', () => {
        let t = 0;
        const tracker = new D.DoorTracker({ now: () => new Date(Date.UTC(2026, 0, 1) + t) });
        tracker.observe({ botPos: at(0), doors: [DOOR], players: [] });
        t = 100;
        tracker.observe({ botPos: at(1.5), doors: [DOOR], players: [] });
        t = 700;
        assert.equal(tracker.observe({ botPos: at(1.5), doors: [DOOR], players: [] }).length, 1);
    });

    test('without a clock option it uses the real time', () => {
        const tracker = new D.DoorTracker();
        assert.deepEqual(tracker.observe({ botPos: at(0), doors: [DOOR], players: [] }), []);
    });

    test('doors that were not seen for long are forgotten, reset() forgets all', () => {
        const { tracker, step } = makeTracker();
        step(0, at(0));
        assert.equal(tracker.size, 1);
        step(20000, at(0), { doors: [] });
        assert.equal(tracker.size, 0);
        step(20100, at(0));
        tracker.reset();
        assert.equal(tracker.size, 0);
    });
});

describe('openableKind and iron', () => {
    test('doors, gates and trapdoors, not iron, not fences', () => {
        assert.equal(D.openableKind('oak_door'), 'door');
        assert.equal(D.openableKind('bamboo_door'), 'door');
        assert.equal(D.openableKind('exposed_copper_door'), 'door');
        assert.equal(D.openableKind('birch_fence_gate'), 'gate');
        assert.equal(D.openableKind('spruce_trapdoor'), 'trapdoor');
        assert.equal(D.openableKind('iron_door'), null);
        assert.equal(D.openableKind('iron_trapdoor'), null);
        assert.equal(D.openableKind('oak_fence'), null);
        assert.equal(D.openableKind('cobblestone_wall'), null);
        assert.equal(D.openableKind(null), null);
        assert.equal(D.openableKind(42), null);
    });

    test('isIronOpenable', () => {
        assert.equal(D.isIronOpenable('iron_door'), true);
        assert.equal(D.isIronOpenable('iron_trapdoor'), true);
        assert.equal(D.isIronOpenable('oak_door'), false);
        assert.equal(D.isIronOpenable(undefined), false);
    });
});

describe('door geometry', () => {
    test('doorAxis follows the facing', () => {
        assert.deepEqual(D.doorAxis('north'), { x: 0, z: 1 });
        assert.deepEqual(D.doorAxis('south'), { x: 0, z: 1 });
        assert.deepEqual(D.doorAxis('east'), { x: 1, z: 0 });
        assert.deepEqual(D.doorAxis('west'), { x: 1, z: 0 });
        assert.equal(D.doorAxis('up'), null);
        assert.equal(D.doorAxis(undefined), null);
    });

    test('doorSides gives the two cells in front of and behind a door or gate', () => {
        assert.deepEqual(D.doorSides(DOOR), [{ x: 0, y: 64, z: -1 }, { x: 0, y: 64, z: 1 }]);
        assert.deepEqual(D.doorSides({ x: 5, y: 70, z: 5, kind: 'gate', facing: 'east' }), [{ x: 4, y: 70, z: 5 }, { x: 6, y: 70, z: 5 }]);
        assert.equal(D.doorSides({ ...DOOR, kind: 'trapdoor' }), null, 'a trapdoor has no sides to walk to');
        assert.equal(D.doorSides({ x: 0, y: 64, z: 0, kind: 'door' }), null, 'no facing');
        assert.equal(D.doorSides(null), null);
    });

    test('sideOf tells on which side of the door a position is', () => {
        assert.equal(D.sideOf(DOOR, { x: 0.5, y: 64, z: 2.5 }), 1);
        assert.equal(D.sideOf(DOOR, { x: 0.5, y: 64, z: -1.5 }), -1);
        assert.equal(D.sideOf(DOOR, { x: 0.5, y: 64, z: 0.6 }), 0, 'in the doorway');
        assert.equal(D.sideOf({ ...DOOR, facing: 'west' }, { x: 3, y: 64, z: 0.5 }), 1);
        assert.equal(D.sideOf({ ...DOOR, facing: undefined }, { x: 3, y: 64, z: 0.5 }), 0);
        assert.equal(D.sideOf(DOOR, null), 0);
    });

    test('doorKey and doorCenter', () => {
        assert.equal(D.doorKey(DOOR), '0,64,0');
        assert.deepEqual(D.doorCenter(DOOR), { x: 0.5, y: 64, z: 0.5 });
    });
});
