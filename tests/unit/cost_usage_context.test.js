// Spec v0.1.4.6 C1: src/agent/cost/usage_context.js -- withPurpose, currentPurpose, setUsageSink
// and reportUsage, built on AsyncLocalStorage.
import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/cost/usage_context.js';
const U = await loadSrc(MODULE);

const SPEC_PURPOSES = ['chat', 'coding', 'memory', 'skill_review', 'bot_responder', 'vision', 'goal_setting', 'other'];
const REPORT_KEYS = ['cache_read_tokens', 'cache_write_tokens', 'input_tokens', 'model', 'output_tokens', 'purpose', 'time'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Installs a sink that collects every report. afterEach removes it again.
function collect() {
    const reports = [];
    U.setUsageSink((report) => reports.push(report));
    return reports;
}

afterEach(() => {
    U.setUsageSink(null);
});

describe('module', () => {
    test('imports only node:async_hooks', () => {
        assertImportRules(MODULE, { allowBuiltins: ['async_hooks'], allowedRelative: [] });
    });

    test('imports without output and without creating files', () => {
        assertCleanImport(MODULE);
    });

    test('exports the four functions of the spec and the frozen list of purposes', () => {
        for (const name of ['withPurpose', 'currentPurpose', 'setUsageSink', 'reportUsage']) {
            assert.equal(typeof U[name], 'function', name);
        }
        assert.deepEqual([...U.PURPOSES], SPEC_PURPOSES);
        assert.ok(Object.isFrozen(U.PURPOSES));
    });
});

describe('withPurpose and currentPurpose', () => {
    test('outside of withPurpose the purpose is "other"', () => {
        assert.equal(U.currentPurpose(), 'other');
    });

    test('sets the purpose inside, and it is "other" again after the call', () => {
        const seen = U.withPurpose('chat', () => U.currentPurpose());
        assert.equal(seen, 'chat');
        assert.equal(U.currentPurpose(), 'other');
    });

    test('every purpose of the spec is kept as it is', () => {
        for (const purpose of SPEC_PURPOSES) {
            assert.equal(U.withPurpose(purpose, () => U.currentPurpose()), purpose);
        }
    });

    test('returns what fn returns, also a promise', async () => {
        const token = { value: 1 };
        assert.equal(U.withPurpose('memory', () => token), token);
        const promise = U.withPurpose('memory', async () => {
            await sleep(1);
            return 'done';
        });
        assert.ok(promise instanceof Promise);
        assert.equal(await promise, 'done');
    });

    test('a synchronous throw and a rejection of fn reach the caller unchanged', async () => {
        const error = new Error('boom');
        assert.throws(() => U.withPurpose('chat', () => { throw error; }), (e) => e === error);
        await assert.rejects(U.withPurpose('chat', async () => {
            await sleep(1);
            throw error;
        }), (e) => e === error);
        assert.equal(U.currentPurpose(), 'other');
    });

    test('nested calls: the inner purpose wins, the outer one comes back after it', async () => {
        const seen = await U.withPurpose('chat', async () => {
            const list = [U.currentPurpose()];
            await U.withPurpose('memory', async () => {
                list.push(U.currentPurpose());
                await sleep(1);
                list.push(U.currentPurpose());
            });
            list.push(U.currentPurpose());
            await sleep(1);
            list.push(U.currentPurpose());
            return list;
        });
        assert.deepEqual(seen, ['chat', 'memory', 'memory', 'chat', 'chat']);
    });

    test('a purpose that is not a non-empty string counts as "other"', () => {
        for (const bad of ['', '   ', null, undefined, 42, {}, ['chat']]) {
            assert.equal(U.withPurpose(bad, () => U.currentPurpose()), 'other', String(bad));
        }
    });

    test('work scheduled inside keeps the purpose after withPurpose has returned', async () => {
        const reports = collect();
        let fired;
        const done = new Promise((resolve) => { fired = resolve; });
        U.withPurpose('vision', () => {
            setTimeout(() => {
                U.reportUsage({ model: 'late' });
                fired();
            }, 5);
        });
        U.reportUsage({ model: 'outside' });
        await done;
        assert.deepEqual(reports.map((r) => [r.model, r.purpose]), [['outside', 'other'], ['late', 'vision']]);
    });
});

describe('two calls at the same time with different purposes', () => {
    // Each worker reports after an await, from a timer, at the end of a promise chain, from
    // setImmediate, from process.nextTick and from queueMicrotask. The delays make the workers
    // overtake each other, so the reports of all three are interleaved.
    async function worker(tag, purpose, delays) {
        return U.withPurpose(purpose, async () => {
            U.reportUsage({ model: `${tag}:start` });
            await sleep(delays[0]);
            U.reportUsage({ model: `${tag}:await` });
            await new Promise((resolve) => setTimeout(() => {
                U.reportUsage({ model: `${tag}:timer` });
                resolve();
            }, delays[1]));
            await Promise.resolve(tag)
                .then((t) => sleep(delays[2]).then(() => t))
                .then((t) => U.reportUsage({ model: `${t}:chain` }));
            await new Promise((resolve) => setImmediate(() => {
                U.reportUsage({ model: `${tag}:immediate` });
                resolve();
            }));
            await new Promise((resolve) => process.nextTick(() => {
                U.reportUsage({ model: `${tag}:tick` });
                resolve();
            }));
            await new Promise((resolve) => queueMicrotask(() => {
                U.reportUsage({ model: `${tag}:microtask` });
                resolve();
            }));
            await sleep(delays[0]);
            return U.currentPurpose();
        });
    }

    test('each call reports its own purpose across await, timers and promise chains', async () => {
        const reports = collect();
        const purposeOf = { A: 'chat', B: 'coding', C: 'skill_review' };
        const results = await Promise.all([
            worker('A', purposeOf.A, [15, 1, 12]),
            worker('B', purposeOf.B, [1, 18, 2]),
            worker('C', purposeOf.C, [7, 7, 7]),
        ]);
        assert.deepEqual(results, ['chat', 'coding', 'skill_review']);
        assert.equal(U.currentPurpose(), 'other');

        assert.equal(reports.length, 3 * 7);
        for (const report of reports) {
            const tag = report.model.split(':')[0];
            assert.equal(report.purpose, purposeOf[tag], `${report.model} reported ${report.purpose}`);
        }
        // precondition of the proof: the workers really ran at the same time
        const tags = reports.map((r) => r.model.split(':')[0]);
        const switches = tags.filter((t, i) => i > 0 && t !== tags[i - 1]).length;
        assert.ok(switches >= 6, `reports were not interleaved: ${tags.join('')}`);
    });

    test('a report made outside while the workers run is "other"', async () => {
        const reports = collect();
        const running = Promise.all([worker('A', 'chat', [5, 5, 5]), worker('B', 'memory', [3, 3, 3])]);
        await sleep(2);
        U.reportUsage({ model: 'X:outside' });
        await running;
        const outside = reports.filter((r) => r.model === 'X:outside');
        assert.equal(outside.length, 1);
        assert.equal(outside[0].purpose, 'other');
    });
});

describe('setUsageSink and reportUsage', () => {
    test('without a sink nothing happens and nothing is thrown', () => {
        U.setUsageSink(null);
        assert.equal(U.reportUsage({ model: 'm', input_tokens: 5 }), undefined);
    });

    test('the sink receives model, the four token counts, purpose and time', () => {
        const reports = collect();
        const before = Date.now();
        U.withPurpose('coding', () => U.reportUsage({
            model: 'claude-sonnet-5',
            input_tokens: 1200,
            output_tokens: 300,
            cache_read_tokens: 50,
            cache_write_tokens: 7,
            extra: 'not copied',
        }));
        const after = Date.now();
        assert.equal(reports.length, 1);
        const [report] = reports;
        assert.deepEqual(Object.keys(report).sort(), REPORT_KEYS);
        assert.equal(report.model, 'claude-sonnet-5');
        assert.equal(report.input_tokens, 1200);
        assert.equal(report.output_tokens, 300);
        assert.equal(report.cache_read_tokens, 50);
        assert.equal(report.cache_write_tokens, 7);
        assert.equal(report.purpose, 'coding');
        assert.equal(typeof report.time, 'number');
        assert.ok(report.time >= before && report.time <= after);
    });

    test('missing and invalid numbers count as 0', () => {
        const reports = collect();
        U.reportUsage({ model: 'm' });
        U.reportUsage({ model: 'm', input_tokens: NaN, output_tokens: -3, cache_read_tokens: '12', cache_write_tokens: Infinity });
        U.reportUsage({ model: 'm', input_tokens: null, output_tokens: undefined, cache_read_tokens: {}, cache_write_tokens: true });
        for (const r of reports) {
            assert.deepEqual(
                [r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens],
                [0, 0, 0, 0],
            );
        }
        assert.equal(reports.length, 3);
    });

    test('a usage that is not an object, or has no model, is reported with model "unknown" and zeros', () => {
        const reports = collect();
        for (const bad of [undefined, null, 'text', 7, { input_tokens: 3 }, { model: '' }, { model: 42 }]) {
            U.reportUsage(bad);
        }
        assert.equal(reports.length, 7);
        for (const r of reports) {
            assert.equal(r.model, 'unknown');
            assert.equal(r.purpose, 'other');
        }
        assert.equal(reports[4].input_tokens, 3);
    });

    test('one sink per process: a new sink replaces the old one, null removes it', () => {
        const first = collect();
        const second = [];
        U.setUsageSink((r) => second.push(r));
        U.reportUsage({ model: 'a' });
        U.setUsageSink(null);
        U.reportUsage({ model: 'b' });
        assert.deepEqual(first, []);
        assert.deepEqual(second.map((r) => r.model), ['a']);
    });

    test('a value that is not a function removes the sink', () => {
        const reports = collect();
        U.setUsageSink('not a function');
        U.reportUsage({ model: 'a' });
        assert.deepEqual(reports, []);
    });

    test('never throws when the sink throws, and warns', () => {
        const cap = captureConsole();
        try {
            U.setUsageSink(() => { throw new Error('sink broke'); });
            assert.doesNotThrow(() => U.reportUsage({ model: 'm', input_tokens: 1 }));
            assert.match(cap.allText(), /sink broke/);
            assert.equal(cap.of('warn').length, 1);
        } finally {
            cap.restore();
        }
    });

    test('never throws when the sink throws and console.warn throws too', () => {
        const original = console.warn;
        console.warn = () => { throw new Error('console is gone'); };
        try {
            U.setUsageSink(() => { throw new Error('sink broke'); });
            assert.doesNotThrow(() => U.reportUsage({ model: 'm' }));
        } finally {
            console.warn = original;
        }
    });

    test('a sink that returns a rejected promise causes no unhandled rejection', async () => {
        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        const cap = captureConsole();
        try {
            U.setUsageSink(async () => { throw new Error('async sink broke'); });
            assert.doesNotThrow(() => U.reportUsage({ model: 'm' }));
            await sleep(20);
            assert.deepEqual(unhandled, []);
            assert.match(cap.allText(), /async sink broke/);
        } finally {
            cap.restore();
            process.off('unhandledRejection', onUnhandled);
        }
    });
});
