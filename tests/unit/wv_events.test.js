// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.1 (part C, the table of the events): each kind
// from staged facts with its text, the rule of when it comes (and when not), and the shape { t: ISO, kind, text, data }.
// The pure watchers of events_logic.js (names from HANDOFF), then the listeners of the real server with a fake bot: the
// packet explosion, the health, the death, the restart, as the events tool shows them. Every server is closed.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { loadSrc } from '../helpers/load.js';

const E = await loadSrc('src/agent/watch/events_logic.js');
const S = await loadSrc('src/agent/watch/server.js');

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const PEN = {
    name: 'pen', type: 'pen', kind: 'pen', dimension: 'overworld',
    min: { x: 0, y: 64, z: 0 }, max: { x: 6, y: 66, z: 6 },
    contents: { animals: { chicken: 6 } },
};
const HOME_AREA = { name: 'home', type: 'home', kind: 'home', dimension: 'overworld', min: { x: 40, y: 64, z: 0 }, max: { x: 46, y: 68, z: 6 } };

function isEvent(e, kind) {
    assert.ok(e, `an event ${kind}`);
    assert.equal(e.kind, kind);
    assert.equal(typeof e.text, 'string');
    assert.equal(typeof e.t, 'string');
    assert.equal(new Date(e.t).toISOString(), e.t, 't is an ISO time');
    assert.equal(typeof e.data, 'object');
}

describe('4.1 the kinds', () => {
    test('the nine kinds of the table, and report and help of v0.1.4.13 (part S)', () => {
        assert.deepEqual([...E.EVENT_KINDS].sort(), ['animals_missing', 'death', 'explosion', 'failure_repeated', 'far_from_home',
            'health', 'job_stalled', 'night_awake', 'restart', 'report', 'help'].sort());
    });

    test('a ring of 200 in memory: the oldest goes', () => {
        const ring = new E.Ring(200);
        for (let i = 0; i < 205; i++) ring.push({ i });
        assert.equal(ring.items.length, 200);
        assert.equal(ring.items[0].i, 5);
        assert.equal(ring.items[199].i, 204);
    });
});

describe('4.1 explosion: within 16 blocks of a saved area (any kind)', () => {
    test('6 blocks from the pen: the text names the area and the place', () => {
        const e = E.explosionEvent({ x: 13, y: 65, z: 3 }, [PEN], 'overworld', T0);
        isEvent(e, 'explosion');
        const m = /^Explosion (\d+) blocks from the area "pen" at \(13, 65, 3\)\.$/.exec(e.text);
        assert.ok(m, e.text);
        assert.ok(['6', '7'].includes(m[1]), `the pen ends at x 6, the explosion is at x 13: ${m[1]}`);
    });

    test('the example of the spec word for word: 6 blocks', () => {
        const e = E.explosionEvent({ x: 12.5, y: 65, z: 3.5 }, [PEN], 'overworld', T0);
        assert.match(e.text, /^Explosion 6 blocks from the area "pen" at \(12, 65, 3\)\.$/);
    });

    test('a home area counts too (any kind); the nearest is named', () => {
        const e = E.explosionEvent({ x: 36, y: 65, z: 3 }, [PEN, HOME_AREA], 'overworld', T0);
        assert.match(e.text, /from the area "home"/);
    });

    test('more than 16 blocks from every area: no event', () => {
        assert.equal(E.explosionEvent({ x: 30, y: 65, z: 3 }, [PEN], 'overworld', T0), null);
        assert.equal(E.explosionEvent({ x: 3, y: 65, z: 40 }, [PEN], 'overworld', T0), null);
    });

    test('no area: no event', () => {
        assert.equal(E.explosionEvent({ x: 3, y: 65, z: 3 }, [], 'overworld', T0), null);
    });
});

describe('4.1 health: fell by 4 or more within 5 s', () => {
    test('20 to 14 within 2 s: "Health fell from 20 to 14 at (x, y, z)."', () => {
        const w = E.createHealthWatch();
        const at = { x: 12.5, y: 67, z: 52.5 };
        assert.equal(w.update(20, at, T0), null);
        const e = w.update(14, at, T0 + 2000);
        isEvent(e, 'health');
        assert.equal(e.text, 'Health fell from 20 to 14 at (12, 67, 52).');
    });

    test('exactly 4 within 5 s: an event', () => {
        const w = E.createHealthWatch();
        w.update(20, { x: 0, y: 64, z: 0 }, T0);
        isEvent(w.update(16, { x: 0, y: 64, z: 0 }, T0 + 4900), 'health');
    });

    test('3 points: no event', () => {
        const w = E.createHealthWatch();
        w.update(20, { x: 0, y: 64, z: 0 }, T0);
        assert.equal(w.update(17, { x: 0, y: 64, z: 0 }, T0 + 1000), null);
    });

    test('4 points slowly, over 8 s: no event', () => {
        const w = E.createHealthWatch();
        const at = { x: 0, y: 64, z: 0 };
        assert.equal(w.update(20, at, T0), null);
        assert.equal(w.update(18, at, T0 + 4000), null);
        assert.equal(w.update(16, at, T0 + 8000), null);
    });
});

describe('4.1 animals_missing: the count in the box below the record', () => {
    const chickens = (n, inside = true) => Array.from({ length: n }, (_, i) => ({ name: 'chicken', position: inside ? { x: 1 + i % 4, y: 64, z: 2 } : { x: 20 + i, y: 64, z: 2 } }));
    const near = { x: 3, y: 64, z: 10 };

    test('2 of 6: "The pen "pen" has 2 chickens, the record says 6."', () => {
        const w = E.createAnimalsWatch();
        const events = w.check([PEN], chickens(2), near, 'overworld', T0);
        assert.equal(events.length, 1);
        isEvent(events[0], 'animals_missing');
        assert.equal(events[0].text, 'The pen "pen" has 2 chickens, the record says 6.');
    });

    test('chickens outside the box do not count', () => {
        const w = E.createAnimalsWatch();
        const events = w.check([PEN], [...chickens(2), ...chickens(4, false)], near, 'overworld', T0);
        assert.equal(events[0].text, 'The pen "pen" has 2 chickens, the record says 6.');
    });

    test('once per pen until the count is back, then again', () => {
        const w = E.createAnimalsWatch();
        assert.equal(w.check([PEN], chickens(2), near, 'overworld', T0).length, 1);
        assert.equal(w.check([PEN], chickens(2), near, 'overworld', T0 + 60000).length, 0, 'not twice');
        assert.equal(w.check([PEN], chickens(6), near, 'overworld', T0 + 120000).length, 0, 'back');
        assert.equal(w.check([PEN], chickens(3), near, 'overworld', T0 + 180000).length, 1, 'short again');
    });

    test('the full count: no event', () => {
        assert.equal(E.createAnimalsWatch().check([PEN], chickens(6), near, 'overworld', T0).length, 0);
    });

    test('the bot more than 32 blocks from the pen: no count', () => {
        assert.equal(E.createAnimalsWatch().check([PEN], chickens(2), { x: 3, y: 64, z: 60 }, 'overworld', T0).length, 0);
    });

    test('a pen without contents.animals: no event', () => {
        const bare = { ...PEN, contents: { animals: {} } };
        assert.equal(E.createAnimalsWatch().check([bare], [], near, 'overworld', T0).length, 0);
    });
});

describe('4.1 night_awake: the time passed 23000 and the bot did not sleep this night', () => {
    const night = (w, sleptAt = null) => {
        let last = null;
        for (let t = 11000; t <= 23100; t += 100) {
            const e = w.update(t, sleptAt !== null && t >= sleptAt && t < sleptAt + 500, T0 + t);
            if (e) last = e;
        }
        return last;
    };

    test('awake all night: "The night passed without sleep."', () => {
        const e = night(E.createNightWatch());
        isEvent(e, 'night_awake');
        assert.equal(e.text, 'The night passed without sleep.');
    });

    test('slept this night: no event', () => {
        assert.equal(night(E.createNightWatch(), 18000), null);
    });

    test('slept the night before: the next night still counts', () => {
        const w = E.createNightWatch();
        night(w, 18000);
        // the day after
        for (let t = 0; t <= 10000; t += 500) w.update(t, false, T0);
        isEvent(night(w), 'night_awake');
    });
});

describe('4.1 job_stalled: running and updated older than 10 minutes, once per job', () => {
    const job = (minutes) => ({ state: 'running', started: new Date(T0 - 3600000).toISOString(), command: '!mineOre("iron", 8)', updated: new Date(T0 - minutes * 60000).toISOString() });

    test('10 minutes: "The job (the mining, 4 of 8 iron) made no progress for 10 minutes."', () => {
        const e = E.createJobWatch().check(job(10), 'Job: the mining, 4 of 8 iron.', T0);
        isEvent(e, 'job_stalled');
        assert.equal(e.text, 'The job (the mining, 4 of 8 iron) made no progress for 10 minutes.');
    });

    test('9 minutes: nothing; once per job', () => {
        const w = E.createJobWatch();
        assert.equal(w.check(job(9), 'Job: the mining, 4 of 8 iron.', T0), null);
        assert.ok(w.check(job(10), 'Job: the mining, 4 of 8 iron.', T0));
        assert.equal(w.check(job(11), 'Job: the mining, 4 of 8 iron.', T0 + 60000), null);
    });

    test('a job that is not running: nothing', () => {
        assert.equal(E.createJobWatch().check({ ...job(30), state: 'done' }, 'Job: the mining.', T0), null);
    });
});

describe('4.1 failure_repeated: the same failure text 5 times', () => {
    test('the 5th: "The same failure 5 times: "...".", not before', () => {
        const w = E.createFailureWatch();
        const text = 'I find no way to you.';
        for (let i = 1; i <= 4; i++) assert.equal(w.record(text, true, T0 + i), null, `${i}`);
        const e = w.record(text, true, T0 + 5);
        isEvent(e, 'failure_repeated');
        assert.equal(e.text, 'The same failure 5 times: "I find no way to you.".');
    });

    test('another failure in between: the count starts again', () => {
        const w = E.createFailureWatch();
        for (let i = 0; i < 3; i++) w.record('I find no way to you.', true, T0);
        w.record('I have no pickaxe.', true, T0);
        for (let i = 0; i < 4; i++) assert.equal(w.record('I find no way to you.', true, T0), null);
    });

    test('a long text is cut with " ..."', () => {
        const w = E.createFailureWatch();
        const long = `I find no way to you ${'and the path is blocked '.repeat(10)}.`;
        let e = null;
        for (let i = 0; i < 5; i++) e = w.record(long, true, T0) ?? e;
        assert.match(e.text, /^The same failure 5 times: "I find no way to you .* \.\.\."\.$/);
    });
});

describe('4.1 far_from_home: passed 100 blocks, once until back within 100', () => {
    const home = { x: 10, y: 67, z: 52, dimension: 'overworld' };

    test('104 blocks: "Luna is 104 blocks from home at (114, 67, 52)."', () => {
        const e = E.createHomeWatch().check('Luna', { x: 114, y: 67, z: 52 }, 'overworld', home, T0);
        isEvent(e, 'far_from_home');
        assert.equal(e.text, 'Luna is 104 blocks from home at (114, 67, 52).');
    });

    test('100 blocks: nothing; once until back', () => {
        const w = E.createHomeWatch();
        assert.equal(w.check('Luna', { x: 110, y: 67, z: 52 }, 'overworld', home, T0), null);
        assert.ok(w.check('Luna', { x: 114, y: 67, z: 52 }, 'overworld', home, T0));
        assert.equal(w.check('Luna', { x: 150, y: 67, z: 52 }, 'overworld', home, T0), null, 'still away');
        assert.equal(w.check('Luna', { x: 20, y: 67, z: 52 }, 'overworld', home, T0), null, 'back');
        assert.ok(w.check('Luna', { x: 120, y: 67, z: 52 }, 'overworld', home, T0), 'away again');
    });
});

describe('4.1 death and restart', () => {
    test('death: "Luna died at (x, y, z)."', () => {
        const e = E.deathEvent('Luna', { x: 12.5, y: 67, z: 52.5 }, T0);
        isEvent(e, 'death');
        assert.equal(e.text, 'Luna died at (12, 67, 52).');
    });

    test('restart: "Luna started."', () => {
        const e = E.restartEvent('Luna', T0);
        isEvent(e, 'restart');
        assert.equal(e.text, 'Luna started.');
    });
});

// ------------------------------------------------------------------------------------------------ the listeners

const TOKEN = `wv-events-${process.pid}-${Date.now()}`;

function eventsOf(port, args = {}) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'events', arguments: args } });
        const req = http.request({
            host: '127.0.0.1', port, path: '/mcp', method: 'POST', agent: false,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'Content-Length': Buffer.byteLength(data) },
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')).result.content[0].text));
        });
        req.on('error', reject);
        req.end(data);
    });
}

describe('4.1 the listeners of the server: facts of a fake bot become events', () => {
    let server;
    let bot;
    before(async () => {
        bot = new EventEmitter();
        bot.username = 'Luna';
        bot.entity = { position: { x: 12.5, y: 67, z: 52.5 } };
        bot.health = 20;
        bot.food = 20;
        bot.time = { timeOfDay: 1000 };
        bot.game = { dimension: 'overworld' };
        bot.blockAt = () => ({ name: 'grass_block' });
        bot.inventory = { items: () => [], slots: [] };
        bot.entities = {};
        bot._client = new EventEmitter();
        const agent = { name: 'Luna', bot, area_store: { list: () => [PEN] }, async handleMessage() {}, async openChat() {} };
        server = await S.startWatchServer(agent, { port: 0, token: TOKEN });
    });
    after(async () => {
        await server?.close?.();
    });

    test('the start: "Luna started."', async () => {
        assert.match(await eventsOf(server.port), /Luna started\./);
    });

    test('the packet explosion 6 blocks from the pen', async () => {
        bot._client.emit('explosion', { x: 12.5, y: 65, z: 3.5 });
        assert.match(await eventsOf(server.port), /Explosion 6 blocks from the area "pen" at \(12, 65, 3\)\./);
    });

    test('the health falls from 20 to 14', async () => {
        bot.health = 14;
        bot.emit('health');
        assert.match(await eventsOf(server.port), /Health fell from 20 to 14 at \(12, 67, 52\)\./);
    });

    test('the death', async () => {
        bot.emit('death');
        assert.match(await eventsOf(server.port), /Luna died at \(12, 67, 52\)\./);
    });

    test('the events oldest first', async () => {
        const lines = (await eventsOf(server.port)).split('\n');
        const order = ['started', 'Explosion', 'Health fell', 'died'].map((w) => lines.findIndex((l) => l.includes(w)));
        assert.deepEqual([...order].sort((a, b) => a - b), order, lines.join('\n'));
    });
});
