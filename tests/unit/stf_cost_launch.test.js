// Spec v0.1.4.8, part F: F2 (cost per launch, S7) -- the launch id of main.js, inherited by the agent
// processes, in src/agent/cost/cost_meter.js: each session of usage.json carries it, and the limit
// per session and !cost count all sessions of the same launch. Without it: v0.1.4.7.
//
// Time comes from the injected `now`. The price of claude-haiku-4-5 is 1 dollar per million input
// tokens: spend(d) records a call of d dollars.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { patchFs } from '../helpers/fs_patch.js';

const M = await loadSrc('src/agent/cost/cost_meter.js');

const T0 = Date.UTC(2026, 8, 29, 1, 0, 0);
const MIN = 60 * 1000;
const HAIKU = 'claude-haiku-4-5-20251001';
const LAUNCH = '2026-09-29T01:32:00.000Z';
const OTHER = '2026-09-28T20:00:00.000Z';
const LIMITS = Object.freeze({ cost_warn_per_hour: 0, cost_limit_per_hour: 0, cost_limit_per_session: 10 });
const LIMIT_TEXT = (reason) => `I reached the cost limit (${reason}). I stop working on goals by myself and writing new code. Chat and commands still work.`;

let clock;
let dir;
let file;
let cap;
let savedEnv;
beforeEach(() => {
    clock = T0;
    dir = makeTmpDir();
    file = path.join(dir, 'bots', 'claude', 'usage.json');
    cap = captureConsole();
    savedEnv = process.env.MINDCRAFT_LAUNCH_ID;
    delete process.env.MINDCRAFT_LAUNCH_ID;
});
afterEach(() => {
    if (savedEnv === undefined) delete process.env.MINDCRAFT_LAUNCH_ID;
    else process.env.MINDCRAFT_LAUNCH_ID = savedEnv;
    cap.restore();
    removeTmpDir(dir);
});

function newMeter({ settings = LIMITS, ...rest } = {}) {
    const said = [];
    const meter = new M.CostMeter({ settings, now: () => clock, filePath: file, say: (text) => said.push(text), ...rest });
    return { meter, said };
}

function spend(meter, dollars, purpose = 'chat') {
    meter.record({ model: HAIKU, input_tokens: Math.round(dollars * 1e6), output_tokens: 0, purpose, time: clock });
}

// A session as v0.1.4.7 and v0.1.4.8 write it.
function session(dollars, { launch, calls = 10, purposes = { chat: dollars }, unpriced = 0 } = {}) {
    const byPurpose = Object.fromEntries(Object.entries(purposes).map(([name, d]) => [name, { calls: calls / Object.keys(purposes).length, dollars: d, input_tokens: 1, output_tokens: 1 }]));
    const s = {
        started: '2026-09-29T00:00:00.000Z', ended: '2026-09-29T00:10:00.000Z', minutes: 10, calls, dollars,
        unpriced_calls: unpriced, by_purpose: byPurpose, by_model: { [HAIKU]: { calls, dollars, input_tokens: 1, output_tokens: 1 } },
    };
    if (launch !== undefined) s.launch_id = launch;
    return s;
}

function writeSessions(sessions) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, sessions }));
}

const readSessions = () => JSON.parse(fs.readFileSync(file, 'utf8')).sessions;

describe('the launch id', () => {
    test('from the option launchId, else from MINDCRAFT_LAUNCH_ID, else none', () => {
        assert.equal(newMeter({ launchId: LAUNCH }).meter.launchId, LAUNCH);
        assert.equal(newMeter().meter.launchId, null);
        process.env.MINDCRAFT_LAUNCH_ID = LAUNCH;
        assert.equal(newMeter().meter.launchId, LAUNCH);
        assert.equal(newMeter({ launchId: null }).meter.launchId, null, 'null switches it off');
        assert.equal(newMeter({ launchId: '  ' }).meter.launchId, null);
    });

    test('every written session carries it', () => {
        const { meter } = newMeter({ launchId: LAUNCH });
        spend(meter, 1);
        assert.equal(meter.flush(), true);
        const [s] = readSessions();
        assert.equal(s.launch_id, LAUNCH);
        assert.equal(s.dollars, 1, 'the session holds the dollars of this process only');
    });

    test('without it the session is written as in v0.1.4.7, with no launch_id key', () => {
        const { meter } = newMeter();
        spend(meter, 1);
        meter.flush();
        assert.deepEqual(Object.keys(readSessions()[0]).sort(),
            ['by_model', 'by_purpose', 'calls', 'dollars', 'ended', 'minutes', 'started', 'unpriced_calls']);
    });
});

describe('the sessions of the same launch count together', () => {
    test('!cost and the report: dollars, purposes and calls of the earlier processes of the launch', () => {
        writeSessions([
            session(5, { calls: 40 }), // v0.1.4.7, no launch id
            session(3, { launch: OTHER, calls: 30 }),
            session(0.5, { launch: LAUNCH, calls: 4, purposes: { chat: 0.3, memory: 0.2 } }),
            session(0.25, { launch: LAUNCH, calls: 2, purposes: { chat: 0.25 }, unpriced: 1 }),
        ]);
        const { meter } = newMeter({ launchId: LAUNCH });
        spend(meter, 0.1, 'coding');
        assert.equal(meter.reportLine(),
            'Cost: session $0.85 (chat $0.55, memory $0.20, coding $0.10), 7 calls. '
            + '1 calls of models without a price are not included. It includes 2 earlier processes since the start of the bot.');
        assert.equal(meter.summaryText(),
            `${meter.reportLine()}\nBudget: limit $10 per session. State: normal.`);
    });

    test('one earlier process: singular', () => {
        writeSessions([session(0.5, { launch: LAUNCH, calls: 3 })]);
        const { meter } = newMeter({ launchId: LAUNCH });
        assert.equal(meter.reportLine(), 'Cost: session $0.50 (chat $0.50), 3 calls. It includes 1 earlier process since the start of the bot.');
    });

    test('totals() and the written session stay those of this process', () => {
        writeSessions([session(2, { launch: LAUNCH })]);
        const { meter } = newMeter({ launchId: LAUNCH });
        spend(meter, 1);
        assert.equal(meter.totals().dollars, 1);
        meter.flush();
        const sessions = readSessions();
        assert.equal(sessions.length, 2);
        assert.equal(sessions[1].dollars, 1);
        assert.deepEqual(sessions[0], session(2, { launch: LAUNCH }), 'the earlier session is kept as it was');
    });

    test('the limit per session counts the launch: $9.50 before the restart, $0.60 after it', () => {
        writeSessions([session(9.5, { launch: LAUNCH })]);
        const { meter, said } = newMeter({ launchId: LAUNCH });
        spend(meter, 0.4);
        assert.equal(meter.state, 'normal');
        spend(meter, 0.2);
        assert.equal(meter.state, 'saving');
        assert.deepEqual(said, [LIMIT_TEXT('$10.10 in this session')]);
        assert.equal(meter.allows('coding'), false);
    });

    test('earlier processes over the limit: saving at the first call of the new process', () => {
        writeSessions([session(6, { launch: LAUNCH }), session(4.5, { launch: LAUNCH })]);
        const { meter, said } = newMeter({ launchId: LAUNCH });
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [LIMIT_TEXT('$10.50 in this session')]);
    });

    test('sessions of another launch or of v0.1.4.7 do not count: the limit starts at zero as before', () => {
        writeSessions([session(9.5, { launch: OTHER }), session(9.5)]);
        const { meter } = newMeter({ launchId: LAUNCH });
        spend(meter, 0.6);
        assert.equal(meter.state, 'normal');
        assert.equal(meter.reportLine(), 'Cost: session $0.60 (chat $0.60), 1 calls.');
    });

    test('without a launch id the earlier sessions never count (v0.1.4.7)', () => {
        writeSessions([session(9.5, { launch: LAUNCH })]);
        const { meter } = newMeter();
        spend(meter, 0.6);
        assert.equal(meter.state, 'normal');
        assert.equal(meter.reportLine(), 'Cost: session $0.60 (chat $0.60), 1 calls.');
    });

    test('the earlier sessions are read once, when the meter is made; record reads no file', () => {
        writeSessions([session(1, { launch: LAUNCH })]);
        let reads = 0;
        const restore = patchFs('readFileSync', (original) => function counted(...args) {
            reads++;
            return original.apply(this, args);
        });
        let meter;
        try {
            meter = newMeter({ launchId: LAUNCH }).meter;
            assert.equal(reads, 1, 'read when made');
            for (let i = 0; i < 100; i++)
                spend(meter, 0.001);
            meter.reportLine();
            assert.equal(reads, 1, 'no read after that');
        } finally {
            restore();
        }
        assert.match(meter.reportLine(), /It includes 1 earlier process/);
    });

    test('no file yet: nothing earlier, no error', () => {
        const { meter } = newMeter({ launchId: LAUNCH });
        spend(meter, 0.5);
        assert.equal(meter.reportLine(), 'Cost: session $0.50 (chat $0.50), 1 calls.');
    });

    test('odd earlier sessions: values that are not numbers count as 0, entries that are not objects are dropped', () => {
        writeSessions([
            'text', null,
            { launch_id: LAUNCH, dollars: 'much', calls: -3, by_purpose: { chat: 'x', memory: { calls: 1, dollars: 0.2 } } },
            { launch_id: LAUNCH, dollars: 0.3, calls: 2, by_purpose: null },
        ]);
        const { meter } = newMeter({ launchId: LAUNCH });
        assert.equal(meter.reportLine(), 'Cost: session $0.30 (memory $0.20), 2 calls. It includes 2 earlier processes since the start of the bot.');
    });

    test('a file that cannot be read: nothing earlier counts, it is not overwritten, no throw', () => {
        fs.mkdirSync(file, { recursive: true }); // a folder where the file should be
        const { meter } = newMeter({ launchId: LAUNCH });
        spend(meter, 0.5);
        assert.equal(meter.reportLine(), 'Cost: session $0.50 (chat $0.50), 1 calls.');
        assert.equal(meter.flush(), false);
        assert.ok(fs.statSync(file).isDirectory());
    });

    test('a corrupt file is moved aside as before and a new one is started', () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{ broken');
        const { meter } = newMeter({ launchId: LAUNCH });
        spend(meter, 0.5);
        assert.equal(meter.flush(), true);
        assert.equal(readSessions().length, 1);
        assert.equal(readSessions()[0].launch_id, LAUNCH);
    });
});

describe('main.js sets the launch id once (source text)', () => {
    const main = fs.readFileSync(repoPath('main.js'), 'utf8');

    test('MINDCRAFT_LAUNCH_ID is set to the time of the start, once, before any agent starts', () => {
        const sets = [...main.matchAll(/process\.env\.MINDCRAFT_LAUNCH_ID\s*=(?!=)/g)];
        assert.equal(sets.length, 1);
        assert.match(main, /process\.env\.MINDCRAFT_LAUNCH_ID\s*=\s*new Date\(\)\.toISOString\(\);/);
        assert.ok(sets[0].index < main.indexOf('Mindcraft.createAgent('));
        assert.ok(sets[0].index < main.indexOf('Mindcraft.init('));
    });
});

describe('the agent processes inherit it', () => {
    let spawned;
    let restoreSpawn;

    async function importAgentProcess() {
        const originalCwd = process.cwd();
        const emptyDir = makeTmpDir();
        process.chdir(emptyDir);
        try {
            return await loadSrc('src/process/agent_process.js');
        } finally {
            process.chdir(originalCwd);
            removeTmpDir(emptyDir);
        }
    }

    beforeEach(() => {
        spawned = [];
        const original = childProcess.spawn;
        childProcess.spawn = (command, args, options) => {
            const child = new EventEmitter();
            child.kill = () => true;
            spawned.push({ command, args, options, child });
            return child;
        };
        syncBuiltinESMExports();
        restoreSpawn = () => {
            childProcess.spawn = original;
            syncBuiltinESMExports();
        };
    });
    afterEach(() => restoreSpawn());

    test('start and restart pass the environment of the main process on', async () => {
        const AP = await importAgentProcess();
        process.env.MINDCRAFT_LAUNCH_ID = LAUNCH;
        const realNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            const ap = new AP.AgentProcess('claude', 8080);
            ap.start(false, null, 0);
            now += 20_000;
            spawned[0].child.emit('exit', 1, null);
        } finally {
            Date.now = realNow;
        }
        assert.equal(spawned.length, 2, 'restarted once');
        for (const { options } of spawned) {
            const env = options?.env ?? process.env; // no env option: the child gets process.env
            assert.equal(env.MINDCRAFT_LAUNCH_ID, LAUNCH);
        }
    });
});
