// v0.1.4.13 fix 1 (W115): the step away from a player's death drops goes away from all of them, never across one.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { awayPoint } from '../../src/agent/reflex/drop_logic.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

describe('awayPoint: away from the middle of the drops', () => {
    test('the play of the gate: the ingots beside the bot, the boots behind them: away from both', () => {
        const me = { x: 8030.5, y: 61, z: -19.5 };
        const to = awayPoint(me, [{ x: 8028.6, y: 61, z: -18.6 }, { x: 8030.2, y: 61, z: -21.4 }], 4);
        assert.ok(near(Math.hypot(to.x - me.x, to.z - me.z), 4));
        assert.equal(to.y, 61);
        for (const drop of [{ x: 8028.6, z: -18.6 }, { x: 8030.2, z: -21.4 }])
            assert.ok(Math.hypot(to.x - drop.x, to.z - drop.z) > Math.hypot(me.x - drop.x, me.z - drop.z), 'farther from every drop');
    });

    test('one drop: straight away from it', () => {
        const to = awayPoint({ x: 0, y: 64, z: 0 }, [{ x: 1, y: 64, z: 0 }], 4);
        assert.ok(near(to.x, -4) && near(to.z, 0));
    });

    test('the bot on the middle: away from the nearest; on the drop itself: a step in x', () => {
        const to = awayPoint({ x: 0, y: 64, z: 0 }, [{ x: 1, y: 64, z: 0 }, { x: -2, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }], 4);
        assert.ok(near(to.x, -4) && near(to.z, 0), JSON.stringify(to));
        assert.deepEqual(awayPoint({ x: 0, y: 64, z: 0 }, [{ x: 0, y: 64, z: 0 }], 4), { x: 4, y: 64, z: 0 });
    });

    test('no drop or no bot: null', () => {
        assert.equal(awayPoint({ x: 0, y: 64, z: 0 }, [], 4), null);
        assert.equal(awayPoint(null, [{ x: 1, y: 64, z: 0 }], 4), null);
    });
});
