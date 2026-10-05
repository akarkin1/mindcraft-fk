// Spec v0.1.4.12 4.1 (part C): each kind of event from staged facts, the ring, the lines.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    EVENT_KINDS, EVENT_RULES, Ring, clockText, countAnimals, createAnimalsWatch, createFailureWatch, createHealthWatch,
    createHomeWatch, createJobWatch, createNightWatch, deathEvent, distanceToBox, eventLine, eventsSince, explosionEvent,
    jobWords, makeEvent, restartEvent, shortFailure, sinceMs,
} from '../../src/agent/watch/events_logic.js';

const T0 = Date.parse('2026-10-03T12:00:00.000Z');
const pen = { name: 'pen', type: 'pen', dimension: 'overworld', min: { x: 0, y: 64, z: 0 }, max: { x: 6, y: 66, z: 6 }, contents: { animals: { chicken: 6 } } };
const home = { name: 'home', type: 'home', dimension: 'overworld', min: { x: 20, y: 64, z: 0 }, max: { x: 26, y: 70, z: 6 } };

describe('the kinds', () => {
    test('the nine kinds of the table, and report and help of v0.1.4.13', () => {
        assert.deepEqual(EVENT_KINDS.slice(0, 9), ['explosion', 'health', 'animals_missing', 'night_awake', 'job_stalled', 'failure_repeated', 'far_from_home', 'death', 'restart']);
        assert.deepEqual(EVENT_KINDS.slice(9), ['report', 'help']); // v0.1.4.13 (S): the two kinds of spec 4.1
    });

    test('an event is { t: ISO, kind, text, data }', () => {
        assert.deepEqual(makeEvent('restart', 'Luna started.', {}, T0), { t: '2026-10-03T12:00:00.000Z', kind: 'restart', text: 'Luna started.', data: {} });
    });
});

describe('explosion', () => {
    test('within 16 blocks of a saved area: the nearest area, the distance, the place', () => {
        const event = explosionEvent({ x: 12.5, y: 64, z: 3.2 }, [pen, home], 'minecraft:overworld', T0);
        assert.equal(event.kind, 'explosion');
        assert.equal(event.text, 'Explosion 6 blocks from the area "pen" at (12, 64, 3).');
        assert.deepEqual(event.data, { area: 'pen', blocks: 6, pos: { x: 12, y: 64, z: 3 } });
    });

    test('the nearest of two', () => {
        assert.equal(explosionEvent({ x: 18, y: 65, z: 3 }, [pen, home], 'overworld', T0).text, 'Explosion 2 blocks from the area "home" at (18, 65, 3).');
    });

    test('farther than 16 blocks, or in another dimension: no event', () => {
        assert.equal(explosionEvent({ x: 60, y: 64, z: 3 }, [pen, home], 'overworld', T0), null);
        assert.equal(explosionEvent({ x: 8, y: 64, z: 3 }, [pen], 'the_nether', T0), null);
        assert.equal(explosionEvent({ x: 8, y: 64, z: 3 }, [], 'overworld', T0), null);
    });

    test('distanceToBox: 0 inside, the box holds the blocks min..max', () => {
        assert.equal(distanceToBox({ x: 3, y: 65, z: 3 }, pen), 0);
        assert.equal(distanceToBox({ x: 6.9, y: 65, z: 3 }, pen), 0);
        assert.equal(distanceToBox({ x: 10, y: 65, z: 3 }, pen), 3);
    });
});

describe('health', () => {
    test('a fall of 4 or more within 5 s', () => {
        const watch = createHealthWatch();
        assert.equal(watch.update(20, { x: 1, y: 64, z: 2 }, T0), null);
        assert.equal(watch.update(18, { x: 1, y: 64, z: 2 }, T0 + 1000), null);
        const event = watch.update(14, { x: 1.5, y: 64, z: 2 }, T0 + 3000);
        assert.equal(event.kind, 'health');
        assert.equal(event.text, 'Health fell from 20 to 14 at (1, 64, 2).');
    });

    test('one event per fall', () => {
        const watch = createHealthWatch();
        watch.update(20, null, T0);
        assert.ok(watch.update(15, null, T0 + 500));
        assert.equal(watch.update(14, null, T0 + 1000), null);
    });

    test('a slow fall over more than 5 s: no event', () => {
        const watch = createHealthWatch();
        watch.update(20, null, T0);
        watch.update(18, null, T0 + 3000);
        assert.equal(watch.update(16, null, T0 + 6000), null);
        assert.equal(watch.update(15, null, T0 + 9000), null);
    });

    test('half points', () => {
        const watch = createHealthWatch();
        watch.update(19.5, null, T0);
        assert.equal(watch.update(15, { x: 0, y: 0, z: 0 }, T0 + 100).text, 'Health fell from 19.5 to 15 at (0, 0, 0).');
    });
});

describe('animals_missing', () => {
    const chickens = (n, x = 3) => Array.from({ length: n }, (_, i) => ({ name: 'chicken', position: { x: x + 0.5, y: 64, z: i % 6 + 0.5 } }));

    test('fewer than the record inside the box, the bot within 32 blocks: once per pen', () => {
        const watch = createAnimalsWatch();
        const events = watch.check([pen, home], chickens(2), { x: 10, y: 64, z: 3 }, 'overworld', T0);
        assert.equal(events.length, 1);
        assert.equal(events[0].kind, 'animals_missing');
        assert.equal(events[0].text, 'The pen "pen" has 2 chickens, the record says 6.');
        assert.deepEqual(events[0].data, { area: 'pen', animals: { chicken: { count: 2, record: 6 } } });
        assert.deepEqual(watch.check([pen], chickens(2), { x: 10, y: 64, z: 3 }, 'overworld', T0 + 60000), []);
    });

    test('again after the count was back', () => {
        const watch = createAnimalsWatch();
        assert.equal(watch.check([pen], chickens(1), { x: 10, y: 64, z: 3 }, 'overworld', T0).length, 1);
        assert.deepEqual(watch.check([pen], chickens(6), { x: 10, y: 64, z: 3 }, 'overworld', T0 + 60000), []);
        assert.equal(watch.check([pen], chickens(1), { x: 10, y: 64, z: 3 }, 'overworld', T0 + 120000)[0].text, 'The pen "pen" has 1 chicken, the record says 6.');
    });

    test('animals outside the box do not count; the bot farther than 32 blocks: no check', () => {
        const watch = createAnimalsWatch();
        assert.equal(watch.check([pen], chickens(6, 40), { x: 10, y: 64, z: 3 }, 'overworld', T0).length, 1);
        assert.deepEqual(createAnimalsWatch().check([pen], [], { x: 100, y: 64, z: 3 }, 'overworld', T0), []);
    });

    test('several kinds, a pen without a record', () => {
        const big = { ...pen, contents: { animals: { chicken: 6, cow: 3, sheep: 2 } } };
        const events = createAnimalsWatch().check([big, { ...pen, name: 'empty', contents: { animals: {} } }],
            [...chickens(6), { name: 'cow', position: { x: 1, y: 64, z: 1 } }], { x: 3, y: 64, z: 3 }, 'overworld', T0);
        assert.equal(events.length, 1);
        assert.equal(events[0].text, 'The pen "pen" has 1 cow, the record says 3; 0 sheep, the record says 2.');
    });

    test('countAnimals', () => {
        assert.deepEqual(countAnimals(pen, [...chickens(3), { name: 'zombie', position: { x: 1, y: 64, z: 1 } }]), { chicken: 3 });
    });
});

describe('night_awake', () => {
    test('the time passed 23000 and the bot did not sleep', () => {
        const watch = createNightWatch();
        assert.equal(watch.update(11980, false, T0), null);
        assert.equal(watch.update(18000, false, T0), null);
        assert.equal(watch.update(22990, false, T0), null);
        const event = watch.update(23010, false, T0);
        assert.equal(event.kind, 'night_awake');
        assert.equal(event.text, 'The night passed without sleep.');
        assert.equal(watch.update(23030, false, T0), null);
    });

    test('the bot slept: no event', () => {
        const watch = createNightWatch();
        watch.update(12500, false, T0);
        watch.update(13000, true, T0);
        watch.update(22990, false, T0);
        assert.equal(watch.update(23010, false, T0), null);
        const other = createNightWatch();
        other.update(13000, false, T0);
        other.slept();
        other.update(22990, false, T0);
        assert.equal(other.update(23010, false, T0), null);
    });

    test('a jump of the time (a command, the sleep of all players) is not a passed night', () => {
        const watch = createNightWatch();
        watch.update(14000, false, T0);
        assert.equal(watch.update(23500, false, T0), null);
        assert.equal(createNightWatch().update(23500, false, T0), null);
    });

    test('a sleep of the last night does not count for the next', () => {
        const watch = createNightWatch();
        watch.update(13000, true, T0);
        watch.update(22990, false, T0);
        assert.equal(watch.update(23010, false, T0), null);
        watch.update(11990, false, T0);
        watch.update(12010, false, T0);
        watch.update(22990, false, T0);
        assert.ok(watch.update(23010, false, T0));
    });
});

describe('job_stalled', () => {
    const job = { state: 'running', kind: 'mineOre', command: '!mineOre("iron", 8)', started: '2026-10-03T11:00:00.000Z', updated: '2026-10-03T11:50:00.000Z' };

    test('running and updated older than 10 minutes: once per job', () => {
        const watch = createJobWatch();
        assert.equal(watch.check(job, 'Job: the mining, 4 of 8 iron.', Date.parse('2026-10-03T11:59:00.000Z')), null);
        const event = watch.check(job, 'Job: the mining, 4 of 8 iron.', T0);
        assert.equal(event.kind, 'job_stalled');
        assert.equal(event.text, 'The job (the mining, 4 of 8 iron) made no progress for 10 minutes.');
        assert.equal(watch.check(job, 'Job: the mining, 4 of 8 iron.', T0 + 60000), null);
        assert.ok(watch.check({ ...job, started: '2026-10-03T11:30:00.000Z' }, '', T0));
    });

    test('a paused or done job: no event', () => {
        assert.equal(createJobWatch().check({ ...job, state: 'paused' }, '', T0), null);
        assert.equal(createJobWatch().check(null, '', T0), null);
    });

    test('jobWords', () => {
        assert.equal(jobWords('Job: the farming.'), 'the farming');
        assert.equal(jobWords(''), 'the job');
    });
});

describe('failure_repeated', () => {
    test('the same failure text 5 times in a row', () => {
        const watch = createFailureWatch();
        for (let i = 0; i < 4; i++)
            assert.equal(watch.record('I find no way to you.', true, T0), null);
        const event = watch.record('I find no way to you.', true, T0);
        assert.equal(event.kind, 'failure_repeated');
        assert.equal(event.text, 'The same failure 5 times: "I find no way to you.".');
        assert.equal(watch.record('I find no way to you.', true, T0), null);
    });

    test('a success or another failure ends the row', () => {
        const watch = createFailureWatch();
        for (let i = 0; i < 4; i++)
            watch.record('I find no way to you.', true, T0);
        watch.record('You have reached MartyByrde2.', false, T0);
        assert.equal(watch.record('I find no way to you.', true, T0), null);
        for (let i = 0; i < 3; i++)
            watch.record('I find no way to you.', true, T0);
        watch.record('Could not find a chest.', true, T0);
        assert.equal(watch.record('I find no way to you.', true, T0), null);
    });

    test('a long text is cut with " ..."', () => {
        const long = `I find no way to you ${'x'.repeat(100)}`;
        assert.equal(shortFailure(long).length, EVENT_RULES.failureChars + 4);
        assert.ok(shortFailure(long).endsWith(' ...'));
    });
});

describe('far_from_home', () => {
    test('beyond 100 blocks from home: once until it is back within 100', () => {
        const watch = createHomeWatch();
        const at = { x: 10, y: 67, z: 52 };
        assert.equal(watch.check('Luna', { x: 50, y: 67, z: 52 }, 'overworld', at, T0), null);
        const event = watch.check('Luna', { x: 114.2, y: 67, z: 52 }, 'overworld', at, T0);
        assert.equal(event.kind, 'far_from_home');
        assert.equal(event.text, 'Luna is 104 blocks from home at (114, 67, 52).');
        assert.equal(watch.check('Luna', { x: 120, y: 67, z: 52 }, 'overworld', at, T0), null);
        watch.check('Luna', { x: 20, y: 67, z: 52 }, 'overworld', at, T0);
        assert.ok(watch.check('Luna', { x: 120, y: 67, z: 52 }, 'overworld', at, T0));
    });

    test('no home, or home in another dimension: no event', () => {
        assert.equal(createHomeWatch().check('Luna', { x: 500, y: 67, z: 0 }, 'overworld', null, T0), null);
        assert.equal(createHomeWatch().check('Luna', { x: 500, y: 67, z: 0 }, 'the_nether', { x: 0, y: 64, z: 0, dimension: 'overworld' }, T0), null);
    });
});

describe('death and restart', () => {
    test('the texts', () => {
        assert.equal(deathEvent('Luna', { x: 3.7, y: 12, z: -4.2 }, T0).text, 'Luna died at (3, 12, -5).');
        assert.equal(deathEvent('Luna', { x: 3.7, y: 12, z: -4.2 }, T0).kind, 'death');
        assert.equal(restartEvent('Luna', T0).text, 'Luna started.');
        assert.equal(restartEvent('Luna', T0).kind, 'restart');
    });
});

describe('the ring and the lines', () => {
    test('a ring of 200 keeps the newest', () => {
        const ring = new Ring(EVENT_RULES.ringSize);
        for (let i = 0; i < 250; i++)
            ring.push(i);
        assert.equal(ring.length, 200);
        assert.equal(ring.items[0], 50);
        assert.deepEqual(ring.last(2), [248, 249]);
    });

    test('eventsSince: after the time, oldest first; without one the last 20', () => {
        const events = Array.from({ length: 30 }, (_, i) => makeEvent('restart', `n${i}`, {}, T0 + i * 1000));
        assert.equal(eventsSince(events, null).length, 20);
        assert.equal(eventsSince(events, null)[0].text, 'n10');
        assert.deepEqual(eventsSince(events, T0 + 27000).map((e) => e.text), ['n28', 'n29']);
        assert.equal(sinceMs('2026-10-03T12:00:00Z'), T0);
        assert.equal(sinceMs('yesterday'), null);
    });

    test('the line: [hh:mm:ss] kind: text in the local time', () => {
        const t = new Date(2026, 9, 3, 13, 45, 2);
        assert.equal(clockText(t), '13:45:02');
        const event = makeEvent('explosion', 'Explosion 6 blocks from the area "pen" at (1, 2, 3).', {}, t.getTime());
        assert.equal(eventLine(event), '[13:45:02] explosion: Explosion 6 blocks from the area "pen" at (1, 2, 3).');
    });
});
