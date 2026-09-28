// Spec v0.1.4.6 C3: src/agent/cost/cost_meter.js -- CostMeter (totals, rate, budget states,
// report texts, usage.json) and the money formatter formatDollars.
//
// Time comes from the injected `now`, so every rate and every state change is exact. The price
// of claude-haiku-4-5 is 1 dollar per million input tokens: spend(d) records a call of d dollars.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { patchFs, fsError } from '../helpers/fs_patch.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/cost/cost_meter.js';
const M = await loadSrc(MODULE);

const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;
const HAIKU = 'claude-haiku-4-5-20251001';
const LIMITS = Object.freeze({ cost_warn_per_hour: 3, cost_limit_per_hour: 8, cost_limit_per_session: 10 });

const WARN_TEXT = (rate, warn) => `I am costing about $${rate} per hour. That is above the warning level of $${warn}.`;
const LIMIT_TEXT = (reason) => `I reached the cost limit (${reason}). I stop working on goals by myself and writing new code. Chat and commands still work.`;
const BACK_TEXT = 'My cost is back below the limit. I can write code and work on goals again.';
const SESSION_KEYS = ['by_model', 'by_purpose', 'calls', 'dollars', 'ended', 'minutes', 'started', 'unpriced_calls'];

let clock;
let dir;
let file;
let cap;
beforeEach(() => {
    clock = T0;
    dir = makeTmpDir();
    file = path.join(dir, 'bots', 'andy', 'usage.json');
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

// A meter on the test clock. `said` and `logged` collect the texts for the player and the console.
function newMeter({ settings = {}, filePath = file, ...rest } = {}) {
    assert.equal(typeof M.CostMeter, 'function', 'CostMeter must be an exported class');
    const said = [];
    const logged = [];
    const meter = new M.CostMeter({
        settings,
        now: () => clock,
        filePath,
        say: (text) => said.push(text),
        log: (text) => logged.push(text),
        ...rest,
    });
    return { meter, said, logged };
}

function report(fields = {}) {
    return { model: HAIKU, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, purpose: 'chat', time: clock, ...fields };
}

// One call that costs `dollars` (1 dollar per million input tokens).
function spend(meter, dollars, purpose = 'chat') {
    meter.record(report({ input_tokens: Math.round(dollars * 1e6), purpose }));
}

const at = (ms) => { clock = T0 + ms; };
const readFile = () => JSON.parse(fs.readFileSync(file, 'utf8'));

describe('module', () => {
    test('imports only safe_json.js and price_table.js', () => {
        assertImportRules(MODULE, { allowBuiltins: [], allowedRelative: ['safe_json.js', 'price_table.js'] });
    });

    test('imports without output and without creating files', () => {
        assertCleanImport(MODULE);
    });

    test('exports CostMeter and formatDollars', () => {
        assert.equal(typeof M.CostMeter, 'function');
        assert.equal(typeof M.formatDollars, 'function');
    });
});

describe('formatDollars', () => {
    test('two decimals, halves round up, no rounding noise', () => {
        const cases = [
            [0, '0.00'], [0.005, '0.01'], [1.005, '1.01'], [1.004, '1.00'], [0.0049, '0.00'],
            [0.1 + 0.2, '0.30'], [2.675, '2.68'], [1.015, '1.02'], [8.345, '8.35'], [1.23, '1.23'],
            [10, '10.00'], [1234.5, '1234.50'], [0.999, '1.00'], [19.995, '20.00'],
        ];
        for (const [value, text] of cases) assert.equal(M.formatDollars(value), text, String(value));
    });

    test('a value that is not a finite number is 0.00', () => {
        for (const value of [NaN, Infinity, undefined, null, '3']) assert.equal(M.formatDollars(value), '0.00');
    });
});

describe('record and totals', () => {
    test('a new meter: all zero, started is the creation time', () => {
        const { meter } = newMeter();
        assert.deepEqual(meter.totals(), {
            calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
            dollars: 0, unpriced_calls: 0, by_purpose: {}, by_model: {},
            started: new Date(T0).toISOString(), minutes: 0,
        });
        assert.equal(meter.state, 'normal');
    });

    test('adds up calls, tokens and dollars, by purpose and by model', () => {
        const { meter } = newMeter();
        meter.record(report({ input_tokens: 1000, output_tokens: 200, purpose: 'chat' }));
        meter.record(report({ input_tokens: 3000, output_tokens: 100, cache_read_tokens: 10_000, purpose: 'chat' }));
        meter.record(report({ model: 'claude-sonnet-5', input_tokens: 2000, output_tokens: 1000, cache_write_tokens: 4000, purpose: 'coding' }));
        const t = meter.totals();
        assert.equal(t.calls, 3);
        assert.equal(t.input_tokens, 6000);
        assert.equal(t.output_tokens, 1300);
        assert.equal(t.cache_read_tokens, 10_000);
        assert.equal(t.cache_write_tokens, 4000);
        // chat: (1000 + 200*5) + (3000 + 100*5 + 10000*0.1) per million = 2000 + 4500 = 6500
        // coding: 2000*2 + 1000*10 + 4000*2.5 = 4000 + 10000 + 10000 = 24000
        assert.equal(t.dollars, 0.0305);
        assert.equal(t.unpriced_calls, 0);
        assert.deepEqual(t.by_purpose, {
            chat: { calls: 2, dollars: 0.0065, input_tokens: 4000, output_tokens: 300 },
            coding: { calls: 1, dollars: 0.024, input_tokens: 2000, output_tokens: 1000 },
        });
        assert.deepEqual(t.by_model, {
            [HAIKU]: { calls: 2, dollars: 0.0065, input_tokens: 4000, output_tokens: 300 },
            'claude-sonnet-5': { calls: 1, dollars: 0.024, input_tokens: 2000, output_tokens: 1000 },
        });
    });

    test('calls of a model without a price: counted as calls and tokens, not in dollars', () => {
        const { meter } = newMeter();
        spend(meter, 0.5);
        meter.record(report({ model: 'gpt-4o', input_tokens: 5000, purpose: 'chat' }));
        meter.record(report({ model: 'gpt-4o', input_tokens: 5000, purpose: 'memory' }));
        const t = meter.totals();
        assert.equal(t.calls, 3);
        assert.equal(t.unpriced_calls, 2);
        assert.equal(t.dollars, 0.5);
        assert.equal(t.input_tokens, 510_000);
        assert.deepEqual(t.by_model['gpt-4o'], { calls: 2, dollars: 0, input_tokens: 10_000, output_tokens: 0 });
        assert.deepEqual(t.by_purpose.memory, { calls: 1, dollars: 0, input_tokens: 5000, output_tokens: 0 });
    });

    test('settings.model_prices overrides the price table, also when it changes later', () => {
        const settings = { model_prices: { 'gpt-4o': { input: 2.5, output: 10 } } };
        const { meter } = newMeter({ settings });
        meter.record(report({ model: 'gpt-4o', input_tokens: 1_000_000 }));
        settings.model_prices = { 'gpt-4o': { input: 5, output: 10 } };
        meter.record(report({ model: 'gpt-4o', input_tokens: 1_000_000 }));
        settings.model_prices = {};
        meter.record(report({ model: 'gpt-4o', input_tokens: 1_000_000 }));
        const t = meter.totals();
        assert.equal(t.dollars, 7.5);
        assert.equal(t.unpriced_calls, 1);
    });

    test('missing purpose is "other", missing model is "unknown" (no price), invalid numbers are 0', () => {
        const { meter } = newMeter();
        meter.record({ model: HAIKU, input_tokens: 1000 });
        meter.record({ input_tokens: NaN, output_tokens: -1, cache_read_tokens: '5', purpose: '' });
        const t = meter.totals();
        assert.equal(t.calls, 2);
        assert.deepEqual(Object.keys(t.by_purpose), ['other']);
        assert.equal(t.by_purpose.other.calls, 2);
        assert.equal(t.by_model.unknown.calls, 1);
        assert.equal(t.unpriced_calls, 1);
        assert.equal(t.input_tokens, 1000);
        assert.equal(t.output_tokens, 0);
        assert.equal(t.cache_read_tokens, 0);
    });

    test('never throws; a report that is not an object is ignored', () => {
        const settings = { get model_prices() { throw new Error('bad settings'); } };
        const { meter } = newMeter({ settings });
        for (const bad of [undefined, null, 'text', 5, true]) assert.doesNotThrow(() => meter.record(bad));
        assert.equal(meter.totals().calls, 0);
        assert.doesNotThrow(() => spend(meter, 1));
        assert.equal(meter.totals().calls, 1);
        assert.equal(meter.totals().dollars, 1, 'default price when the overrides cannot be read');
    });

    test('never throws for a report whose fields throw, or when console.warn throws too', () => {
        const { meter } = newMeter();
        const hostile = { get model() { throw new Error('hostile report'); } };
        assert.doesNotThrow(() => meter.record(hostile));
        assert.match(cap.allText(), /hostile report/);
        const captured = console.warn;
        console.warn = () => { throw new Error('console is gone'); };
        try {
            assert.doesNotThrow(() => meter.record(hostile));
        } finally {
            console.warn = captured;
        }
        assert.equal(meter.totals().calls, 0);
    });

    test('a clock that throws or returns no valid time falls back to the real clock', () => {
        for (const now of [() => { throw new Error('clock broke'); }, () => NaN, () => 'noon', () => 1e20, () => new Date('x')]) {
            const before = Date.now();
            const meter = new M.CostMeter({ now });
            const started = Date.parse(meter.totals().started);
            assert.ok(started >= before && started <= Date.now(), String(now));
        }
    });

    test('model and purpose names such as __proto__ are plain keys', () => {
        const { meter } = newMeter();
        meter.record(report({ model: '__proto__', purpose: '__proto__', input_tokens: 10 }));
        const t = meter.totals();
        assert.ok(Object.prototype.hasOwnProperty.call(t.by_model, '__proto__'));
        assert.equal(t.by_model['__proto__'].calls, 1);
        assert.equal(t.by_purpose['__proto__'].calls, 1);
        assert.equal(Object.getPrototypeOf(t.by_model), Object.prototype);
    });

    test('no rounding noise in dollars', () => {
        const { meter } = newMeter();
        for (let i = 0; i < 3; i++) spend(meter, 0.1);
        assert.equal(meter.totals().dollars, 0.3);
        for (let i = 0; i < 7; i++) spend(meter, 0.1, 'memory');
        const t = meter.totals();
        assert.equal(t.dollars, 1);
        assert.equal(t.by_purpose.chat.dollars, 0.3);
        assert.equal(t.by_purpose.memory.dollars, 0.7);
    });

    test('minutes since the start, one decimal; `now` may also return a Date', () => {
        const { meter } = newMeter({ now: () => new Date(clock) });
        at(150 * SEC);
        assert.equal(meter.totals().minutes, 2.5);
        at(100 * SEC);
        assert.equal(meter.totals().minutes, 1.7);
        assert.equal(meter.totals().started, new Date(T0).toISOString());
    });

    test('without options the meter uses the real clock and has no limits', () => {
        const before = Date.now();
        const meter = new M.CostMeter();
        const started = Date.parse(meter.totals().started);
        assert.ok(started >= before && started <= Date.now());
        meter.record(report({ input_tokens: 50_000_000 }));
        assert.equal(meter.check(), 'normal');
        assert.equal(meter.flush(), false, 'no file path: nothing is written');
    });

    test('totals() returns a copy', () => {
        const { meter } = newMeter();
        spend(meter, 1);
        const t = meter.totals();
        t.calls = 99;
        t.by_purpose.chat.calls = 99;
        assert.equal(meter.totals().calls, 1);
        assert.equal(meter.totals().by_purpose.chat.calls, 1);
    });

    test('record writes and reads no file', () => {
        const counts = { openSync: 0, writeFileSync: 0, renameSync: 0, readFileSync: 0 };
        const restores = Object.keys(counts).map((name) => patchFs(name, (original) => function counted(...args) {
            counts[name]++;
            return original.apply(this, args);
        }));
        try {
            const { meter } = newMeter({ settings: LIMITS });
            for (let i = 0; i < 1000; i++) {
                clock += SEC;
                spend(meter, 0.001, i % 2 ? 'chat' : 'coding');
            }
        } finally {
            for (const restore of restores) restore();
        }
        assert.deepEqual(counts, { openSync: 0, writeFileSync: 0, renameSync: 0, readFileSync: 0 });
        assert.deepEqual(listDir(dir), []);
    });

    test('record and check are cheap: 50000 of each take well under 2 seconds', () => {
        const { meter } = newMeter({ settings: LIMITS, filePath: null });
        const started = process.hrtime.bigint();
        for (let i = 0; i < 50_000; i++) {
            clock += 100;
            meter.record(report({ input_tokens: 10, output_tokens: 5, purpose: i % 3 ? 'chat' : 'memory' }));
            meter.check();
        }
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        assert.equal(meter.totals().calls, 50_000);
        assert.ok(ms < 2000, `50000 record + check took ${ms} ms`);
    });
});

describe('ratePerHour', () => {
    test('null without calls and during the first 5 minutes after the first call', () => {
        const { meter } = newMeter();
        assert.equal(meter.ratePerHour(), null);
        at(10 * MIN);
        spend(meter, 1);
        assert.equal(meter.ratePerHour(), null);
        at(14 * MIN + 59_999);
        assert.equal(meter.ratePerHour(), null);
        at(15 * MIN);
        assert.equal(meter.ratePerHour(), 4);
    });

    test('dollars of the last 15 minutes times 4', () => {
        const { meter } = newMeter();
        spend(meter, 1);
        at(10 * MIN);
        spend(meter, 2);
        at(14 * MIN + 59 * SEC);
        assert.equal(meter.ratePerHour(), 12);
        at(15 * MIN);
        assert.equal(meter.ratePerHour(), 8, 'a call exactly 15 minutes old is out of the window');
        at(26 * MIN);
        assert.equal(meter.ratePerHour(), 0);
    });

    test('calls of models without a price do not count, no rounding noise', () => {
        const { meter } = newMeter();
        spend(meter, 0.1);
        spend(meter, 0.2);
        meter.record(report({ model: 'gpt-4o', input_tokens: 1_000_000 }));
        at(5 * MIN);
        assert.equal(meter.ratePerHour(), 1.2);
    });
});

describe('check(): the budget rules', () => {
    test('rate at the warning level, state normal: warned, one message to log and chat', () => {
        const { meter, said, logged } = newMeter({ settings: LIMITS });
        spend(meter, 0.75);
        assert.equal(meter.check(), 'normal');
        at(5 * MIN - 1);
        assert.equal(meter.check(), 'normal', 'no rate yet');
        at(5 * MIN);
        assert.equal(meter.ratePerHour(), 3);
        assert.equal(meter.check(), 'warned');
        assert.equal(meter.state, 'warned');
        assert.deepEqual(said, [WARN_TEXT('3.00', '3.00')]);
        assert.deepEqual(logged, said);
        assert.equal(meter.check(), 'warned');
        assert.equal(said.length, 1, 'said once');
    });

    test('rate just below the warning level stays normal', () => {
        const { meter, said } = newMeter({ settings: LIMITS });
        spend(meter, 0.7475);
        at(5 * MIN);
        assert.equal(meter.ratePerHour(), 2.99);
        assert.equal(meter.check(), 'normal');
        assert.deepEqual(said, []);
    });

    test('the rate is null in the first five minutes: no hourly rule applies yet', () => {
        const { meter, said } = newMeter({ settings: { cost_warn_per_hour: 3, cost_limit_per_hour: 8 } });
        spend(meter, 5);
        at(1 * MIN);
        assert.equal(meter.check(), 'normal');
        at(4 * MIN + 59 * SEC);
        assert.equal(meter.check(), 'normal');
        assert.deepEqual(said, []);
        at(5 * MIN);
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [LIMIT_TEXT('$20.00 per hour')]);
    });

    test('rate at the hourly limit, state normal: saving, with the rate as reason', () => {
        const { meter, said, logged } = newMeter({ settings: LIMITS });
        spend(meter, 2);
        at(5 * MIN);
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [LIMIT_TEXT('$8.00 per hour')]);
        assert.deepEqual(logged, said);
        assert.equal(meter.check(), 'saving');
        assert.equal(said.length, 1);
    });

    test('state warned, rate reaches the hourly limit: saving', () => {
        const { meter, said } = newMeter({ settings: LIMITS });
        spend(meter, 0.75);
        at(5 * MIN);
        assert.equal(meter.check(), 'warned');
        spend(meter, 1.25);
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [WARN_TEXT('3.00', '3.00'), LIMIT_TEXT('$8.00 per hour')]);
    });

    test('record alone applies the rules, check() finds the state unchanged', () => {
        const { meter, said } = newMeter({ settings: LIMITS });
        spend(meter, 0.75);
        at(5 * MIN);
        spend(meter, 0);
        assert.equal(meter.state, 'warned');
        assert.equal(meter.check(), 'warned');
        assert.equal(said.length, 1);
    });

    test('session dollars at the session limit: saving at once, with the dollars as reason', () => {
        const { meter, said } = newMeter({ settings: LIMITS });
        spend(meter, 9.99);
        assert.equal(meter.check(), 'normal');
        spend(meter, 0.01);
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [LIMIT_TEXT('$10.00 in this session')]);
    });

    test('both limits at the same time: the session limit is the reason', () => {
        const { meter, said } = newMeter({ settings: LIMITS });
        spend(meter, 9);
        at(5 * MIN);
        spend(meter, 1);
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [LIMIT_TEXT('$10.00 in this session')]);
    });

    test('saving by the hourly limit: back to normal only below the warning level (hysteresis)', () => {
        const { meter, said, logged } = newMeter({ settings: LIMITS });
        spend(meter, 2);
        at(5 * MIN);
        assert.equal(meter.check(), 'saving');
        at(15 * MIN);
        spend(meter, 1.25);
        assert.equal(meter.ratePerHour(), 5);
        assert.equal(meter.check(), 'saving', 'between warning level and limit');
        at(30 * MIN);
        spend(meter, 0.75);
        assert.equal(meter.ratePerHour(), 3);
        assert.equal(meter.check(), 'saving', 'at the warning level is not below it');
        at(45 * MIN);
        spend(meter, 0.7475);
        assert.equal(meter.ratePerHour(), 2.99);
        assert.equal(meter.check(), 'normal');
        assert.deepEqual(said, [LIMIT_TEXT('$8.00 per hour'), BACK_TEXT]);
        assert.deepEqual(logged, said);
    });

    test('saving by the hourly limit without a warning level: back to normal below the hourly limit', () => {
        const { meter, said } = newMeter({ settings: { cost_limit_per_hour: 8 } });
        spend(meter, 2);
        at(5 * MIN);
        assert.equal(meter.check(), 'saving');
        at(15 * MIN);
        spend(meter, 2);
        assert.equal(meter.check(), 'saving');
        at(30 * MIN);
        spend(meter, 1.9975);
        assert.equal(meter.ratePerHour(), 7.99);
        assert.equal(meter.check(), 'normal');
        assert.deepEqual(said, [LIMIT_TEXT('$8.00 per hour'), BACK_TEXT]);
    });

    test('saving by the session limit stays until the process ends', () => {
        const settings = { ...LIMITS };
        const { meter, said } = newMeter({ settings });
        spend(meter, 10);
        assert.equal(meter.check(), 'saving');
        at(10 * 60 * MIN);
        assert.equal(meter.ratePerHour(), 0);
        assert.equal(meter.check(), 'saving');
        settings.cost_limit_per_session = 0;
        settings.cost_limit_per_hour = 0;
        settings.cost_warn_per_hour = 0;
        assert.equal(meter.check(), 'saving');
        assert.equal(meter.allows('coding'), false);
        assert.deepEqual(said, [LIMIT_TEXT('$10.00 in this session')]);
    });

    test('saving by the hourly limit, then the session limit is reached: it stays', () => {
        const { meter, said } = newMeter({ settings: LIMITS });
        spend(meter, 2);
        at(5 * MIN);
        assert.equal(meter.check(), 'saving');
        spend(meter, 8);
        assert.equal(meter.check(), 'saving');
        at(3 * 60 * MIN);
        assert.equal(meter.ratePerHour(), 0);
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [LIMIT_TEXT('$8.00 per hour')]);
    });

    test('state warned: back to normal below 80 percent of the warning level, nothing is said', () => {
        const { meter, said, logged } = newMeter({ settings: LIMITS });
        spend(meter, 0.75);
        at(5 * MIN);
        assert.equal(meter.check(), 'warned');
        at(15 * MIN);
        spend(meter, 0.65);
        assert.equal(meter.ratePerHour(), 2.6);
        assert.equal(meter.check(), 'warned', 'below the warning level, above 80 percent');
        at(30 * MIN);
        spend(meter, 0.6);
        assert.equal(meter.ratePerHour(), 2.4);
        assert.equal(meter.check(), 'warned', 'exactly 80 percent is not below it');
        at(45 * MIN);
        spend(meter, 0.5975);
        assert.equal(meter.ratePerHour(), 2.39);
        assert.equal(meter.check(), 'normal');
        assert.deepEqual(said, [WARN_TEXT('3.00', '3.00')]);
        assert.deepEqual(logged, said);
        at(60 * MIN);
        spend(meter, 0.75);
        assert.equal(meter.check(), 'warned', 'a new warning after the state was normal again');
        assert.equal(said.length, 2);
    });

    test('limits that are 0, absent or invalid switch the rules off', () => {
        const variants = [
            {},
            { cost_warn_per_hour: 0, cost_limit_per_hour: 0, cost_limit_per_session: 0 },
            { cost_warn_per_hour: -1, cost_limit_per_hour: NaN, cost_limit_per_session: Infinity },
            { cost_warn_per_hour: '3', cost_limit_per_hour: null, cost_limit_per_session: [10] },
        ];
        for (const settings of variants) {
            clock = T0;
            const { meter, said } = newMeter({ settings, filePath: null });
            spend(meter, 1000);
            at(5 * MIN);
            assert.equal(meter.ratePerHour(), 4000);
            assert.equal(meter.check(), 'normal', JSON.stringify(settings));
            assert.deepEqual(said, []);
            assert.equal(meter.allows('coding'), true);
        }
    });

    test('settings missing entirely: no limits', () => {
        const meter = new M.CostMeter({ now: () => clock });
        spend(meter, 1000);
        at(5 * MIN);
        assert.equal(meter.check(), 'normal');
    });

    test('only the warning level off: no warning, the hourly limit still works', () => {
        const { meter, said } = newMeter({ settings: { cost_warn_per_hour: 0, cost_limit_per_hour: 8 } });
        spend(meter, 1.75);
        at(5 * MIN);
        assert.equal(meter.check(), 'normal');
        spend(meter, 0.25);
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [LIMIT_TEXT('$8.00 per hour')]);
    });

    test('only the hourly limit off: a high rate warns, the session limit still works', () => {
        const { meter, said } = newMeter({ settings: { cost_warn_per_hour: 3, cost_limit_per_hour: 0, cost_limit_per_session: 10 } });
        spend(meter, 5);
        at(5 * MIN);
        assert.equal(meter.check(), 'warned');
        spend(meter, 5);
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(said, [WARN_TEXT('20.00', '3.00'), LIMIT_TEXT('$10.00 in this session')]);
    });

    test('a warning level above the hourly limit does not make the state flip', () => {
        const { meter, said } = newMeter({ settings: { cost_warn_per_hour: 10, cost_limit_per_hour: 8 } });
        spend(meter, 2.25);
        at(5 * MIN);
        assert.equal(meter.check(), 'saving');
        assert.equal(meter.check(), 'saving');
        at(6 * MIN);
        assert.equal(meter.check(), 'saving');
        at(15 * MIN);
        spend(meter, 1.75);
        assert.equal(meter.check(), 'normal');
        assert.deepEqual(said, [LIMIT_TEXT('$9.00 per hour'), BACK_TEXT]);
    });

    test('say and log are optional; one that throws does not stop the other or the state change', () => {
        const quiet = new M.CostMeter({ settings: LIMITS, now: () => clock });
        spend(quiet, 10);
        assert.equal(quiet.check(), 'saving');

        const logged = [];
        const meter = new M.CostMeter({
            settings: LIMITS,
            now: () => clock,
            say: () => { throw new Error('chat is down'); },
            log: (text) => logged.push(text),
        });
        assert.doesNotThrow(() => spend(meter, 10));
        assert.equal(meter.check(), 'saving');
        assert.deepEqual(logged, [LIMIT_TEXT('$10.00 in this session')]);
    });

    test('check() never throws, also with settings that throw', () => {
        const settings = { get cost_limit_per_session() { throw new Error('bad'); } };
        const { meter } = newMeter({ settings });
        spend(meter, 100);
        assert.doesNotThrow(() => meter.check());
        assert.equal(meter.check(), 'normal');
    });

    test('state is read-only', () => {
        const { meter } = newMeter();
        assert.throws(() => { meter.state = 'saving'; }, TypeError);
        assert.equal(meter.state, 'normal');
    });
});

describe('allows', () => {
    test('everything is allowed in the states normal and warned', () => {
        const { meter } = newMeter({ settings: LIMITS });
        for (const what of ['coding', 'skill_review', 'self_prompt', 'chat', 'memory']) assert.equal(meter.allows(what), true, what);
        spend(meter, 0.75);
        at(5 * MIN);
        assert.equal(meter.check(), 'warned');
        for (const what of ['coding', 'skill_review', 'self_prompt', 'chat', 'memory']) assert.equal(meter.allows(what), true, what);
    });

    test('in the state saving: coding, skill_review and self_prompt are refused, chat and memory allowed', () => {
        const { meter } = newMeter({ settings: LIMITS });
        spend(meter, 10);
        assert.equal(meter.check(), 'saving');
        assert.equal(meter.allows('coding'), false);
        assert.equal(meter.allows('skill_review'), false);
        assert.equal(meter.allows('self_prompt'), false);
        assert.equal(meter.allows('chat'), true);
        assert.equal(meter.allows('memory'), true);
        assert.equal(meter.allows('vision'), true, 'not in the list of the spec');
        assert.equal(meter.allows(undefined), true);
    });
});

describe('reportLine', () => {
    test('the example of the spec', () => {
        const { meter } = newMeter();
        spend(meter, 0.5, 'chat');
        spend(meter, 0.2, 'memory');
        spend(meter, 0.13, 'coding');
        for (let i = 0; i < 178; i++) spend(meter, 0, 'chat');
        at(20 * MIN);
        spend(meter, 0.4, 'chat');
        assert.equal(meter.reportLine(), 'Cost: session $1.23 (chat $0.90, memory $0.20, coding $0.13), rate $1.60 per hour, 182 calls.');
    });

    test('without a rate the rate part is left out', () => {
        const { meter } = newMeter();
        spend(meter, 0.5);
        assert.equal(meter.reportLine(), 'Cost: session $0.50 (chat $0.50), 1 calls.');
    });

    test('without calls', () => {
        const { meter } = newMeter();
        assert.equal(meter.reportLine(), 'Cost: session $0.00, 0 calls.');
    });

    test('purposes ordered by dollars, highest first; equal dollars by calls, then by name', () => {
        const { meter } = newMeter();
        spend(meter, 1, 'chat');
        spend(meter, 2, 'coding');
        spend(meter, 0, 'memory');
        spend(meter, 0, 'bot_responder');
        spend(meter, 0, 'vision');
        spend(meter, 0, 'vision');
        assert.equal(meter.reportLine(), 'Cost: session $3.00 (coding $2.00, chat $1.00, vision $0.00, bot_responder $0.00, memory $0.00), 6 calls.');
    });

    test('with calls of models without a price the line ends with their number', () => {
        const { meter } = newMeter();
        spend(meter, 0.5);
        for (let i = 0; i < 12; i++) meter.record(report({ model: 'gpt-4o', input_tokens: 100, purpose: i < 10 ? 'chat' : 'memory' }));
        at(5 * MIN);
        assert.equal(
            meter.reportLine(),
            'Cost: session $0.50 (chat $0.50, memory $0.00), rate $2.00 per hour, 13 calls. 12 calls of models without a price are not included.',
        );
    });

    test('amounts are rounded half up to cents: 0.005 and 1.005', () => {
        const { meter } = newMeter();
        spend(meter, 0.005, 'memory');
        assert.equal(meter.reportLine(), 'Cost: session $0.01 (memory $0.01), 1 calls.');
        spend(meter, 1, 'chat');
        assert.equal(meter.reportLine(), 'Cost: session $1.01 (chat $1.00, memory $0.01), 2 calls.');
    });
});

describe('summaryText', () => {
    test('the report line and the budget line of the spec', () => {
        const { meter } = newMeter({ settings: LIMITS });
        spend(meter, 0.5);
        const lines = meter.summaryText().split('\n');
        assert.deepEqual(lines, [
            meter.reportLine(),
            'Budget: warn at $3 per hour, limit $8 per hour, limit $10 per session. State: normal.',
        ]);
    });

    test('limits that are 0 are left out', () => {
        const { meter } = newMeter({ settings: { cost_warn_per_hour: 0, cost_limit_per_hour: 0, cost_limit_per_session: 10 } });
        assert.equal(meter.summaryText().split('\n')[1], 'Budget: limit $10 per session. State: normal.');
        const { meter: m2 } = newMeter({ settings: { cost_warn_per_hour: 3, cost_limit_per_hour: 0, cost_limit_per_session: 0 } });
        assert.equal(m2.summaryText().split('\n')[1], 'Budget: warn at $3 per hour. State: normal.');
    });

    test('without any limit', () => {
        const { meter } = newMeter({ settings: {} });
        assert.equal(meter.summaryText(), 'Cost: session $0.00, 0 calls.\nBudget: no limits set. State: normal.');
    });

    test('a limit that is not a whole number has two decimals', () => {
        const { meter } = newMeter({ settings: { cost_warn_per_hour: 2.5, cost_limit_per_hour: 7.25 } });
        assert.equal(meter.summaryText().split('\n')[1], 'Budget: warn at $2.50 per hour, limit $7.25 per hour. State: normal.');
    });

    test('shows the current state', () => {
        const { meter } = newMeter({ settings: LIMITS });
        spend(meter, 10);
        meter.check();
        assert.match(meter.summaryText(), /State: saving\.$/);
        const { meter: warned } = newMeter({ settings: LIMITS });
        spend(warned, 1);
        at(5 * MIN);
        warned.check();
        assert.match(warned.summaryText(), /State: warned\.$/);
    });
});

describe('flush and usage.json', () => {
    test('writes { version: 1, sessions: [session] } synchronously, creating the folder', () => {
        const { meter } = newMeter();
        spend(meter, 0.5, 'chat');
        meter.record(report({ model: 'gpt-4o', purpose: 'memory', input_tokens: 10 }));
        at(150 * SEC);
        assert.equal(meter.flush(), true);
        const data = readFile();
        assert.equal(data.version, 1);
        assert.equal(data.sessions.length, 1);
        const [session] = data.sessions;
        assert.deepEqual(Object.keys(session).sort(), SESSION_KEYS);
        const t = meter.totals();
        assert.equal(session.started, new Date(T0).toISOString());
        assert.equal(session.ended, new Date(T0 + 150 * SEC).toISOString());
        assert.equal(session.minutes, 2.5);
        assert.equal(session.calls, 2);
        assert.equal(session.dollars, 0.5);
        assert.equal(session.unpriced_calls, 1);
        assert.deepEqual(session.by_purpose, t.by_purpose);
        assert.deepEqual(session.by_model, t.by_model);
        assert.deepEqual(listDir(path.dirname(file)), ['usage.json'], 'no temp file left');
    });

    test('a session without calls is written too', () => {
        const { meter } = newMeter();
        assert.equal(meter.flush(), true);
        assert.equal(readFile().sessions[0].calls, 0);
    });

    test('flush twice: the session is replaced, not added again', () => {
        const { meter } = newMeter();
        spend(meter, 1);
        meter.flush();
        at(MIN);
        spend(meter, 1);
        meter.flush();
        const data = readFile();
        assert.equal(data.sessions.length, 1);
        assert.equal(data.sessions[0].calls, 2);
        assert.equal(data.sessions[0].ended, new Date(T0 + MIN).toISOString());
    });

    test('earlier sessions are kept, the new one is last; entries that are not objects are dropped', () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const old = [{ started: 'a', calls: 1 }, null, 'x', { started: 'b', calls: 2 }];
        fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: old }));
        const { meter } = newMeter();
        spend(meter, 1);
        meter.flush();
        meter.flush();
        const data = readFile();
        assert.deepEqual(data.sessions.slice(0, 2), [{ started: 'a', calls: 1 }, { started: 'b', calls: 2 }]);
        assert.equal(data.sessions.length, 3);
        assert.equal(data.sessions[2].started, new Date(T0).toISOString());
    });

    test('at most 200 sessions: the oldest are dropped', () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const old = Array.from({ length: 250 }, (_, i) => ({ started: `s${i}` }));
        fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: old }));
        const { meter } = newMeter();
        meter.flush();
        const { sessions } = readFile();
        assert.equal(sessions.length, 200);
        assert.equal(sessions[0].started, 's51');
        assert.equal(sessions[198].started, 's249');
        assert.equal(sessions[199].started, new Date(T0).toISOString());
    });

    test('a corrupt file is set aside and a new one starts', () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '{ not json');
        const { meter } = newMeter();
        spend(meter, 1);
        assert.equal(meter.flush(), true);
        assert.equal(readFile().sessions.length, 1);
        const names = listDir(path.dirname(file));
        assert.equal(names.length, 2);
        assert.ok(names.some((n) => /^usage\.corrupt\..+\.json$/.test(n)), names.join(', '));
        assert.equal(fs.readFileSync(path.join(path.dirname(file), names.find((n) => n !== 'usage.json')), 'utf8'), '{ not json');
        assert.match(cap.of('warn').map((r) => r.text).join('\n'), /usage\.json/);
    });

    test('a file without a sessions list starts a new list', () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: 'many' }));
        const { meter } = newMeter();
        meter.flush();
        assert.equal(readFile().sessions.length, 1);
    });

    test('a failing write: flush returns false, warns, does not throw', () => {
        const { meter } = newMeter();
        spend(meter, 1);
        const restore = patchFs('renameSync', () => () => { throw fsError('EIO'); });
        try {
            assert.equal(meter.flush(), false);
        } finally {
            restore();
        }
        assert.match(cap.of('warn').map((r) => r.text).join('\n'), /EIO/);
        assert.equal(meter.flush(), true);
        assert.equal(readFile().sessions[0].calls, 1);
    });

    test('a file that cannot be read is not overwritten', () => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: [{ started: 'keep' }] }));
        const { meter } = newMeter();
        const restore = patchFs('readFileSync', (original) => function failing(target, ...rest) {
            if (String(target) === file) throw fsError('EACCES');
            return original.call(this, target, ...rest);
        });
        try {
            assert.equal(meter.flush(), false);
        } finally {
            restore();
        }
        assert.deepEqual(readFile().sessions, [{ started: 'keep' }]);
        assert.equal(meter.flush(), true);
        assert.equal(readFile().sessions.length, 2);
    });

    test('without a file path flush writes nothing and returns false', () => {
        const { meter } = newMeter({ filePath: null });
        spend(meter, 1);
        assert.equal(meter.flush(), false);
        assert.deepEqual(listDir(dir), []);
    });
});

describe('check() writes the file at most once per minute', () => {
    function countWrites() {
        const writes = [];
        const restore = patchFs('renameSync', (original) => function counted(from, to, ...rest) {
            if (String(to) === file) writes.push(clock - T0);
            return original.call(this, from, to, ...rest);
        });
        return { writes, restore };
    }

    test('first check with new calls writes, then at most once per minute and only with new calls', () => {
        const { meter } = newMeter();
        const { writes, restore } = countWrites();
        try {
            spend(meter, 1);
            assert.deepEqual(writes, [], 'record does not write');
            meter.check();
            assert.deepEqual(writes, [0]);
            assert.equal(readFile().sessions[0].calls, 1);
            at(30 * SEC);
            spend(meter, 1);
            meter.check();
            at(MIN - 1);
            meter.check();
            assert.deepEqual(writes, [0]);
            assert.equal(readFile().sessions[0].calls, 1);
            at(MIN);
            meter.check();
            assert.deepEqual(writes, [0, MIN]);
            assert.equal(readFile().sessions[0].calls, 2);
            at(5 * MIN);
            meter.check();
            assert.deepEqual(writes, [0, MIN], 'nothing new, nothing written');
        } finally {
            restore();
        }
    });

    test('a check without any call writes nothing', () => {
        const { meter } = newMeter();
        meter.check();
        at(10 * MIN);
        meter.check();
        assert.deepEqual(listDir(dir), []);
    });

    test('a failing periodic write does not throw and is retried a minute later', () => {
        const { meter } = newMeter();
        spend(meter, 1);
        const restore = patchFs('renameSync', () => () => { throw fsError('EIO'); });
        try {
            assert.equal(meter.check(), 'normal');
        } finally {
            restore();
        }
        at(30 * SEC);
        meter.check();
        assert.equal(fs.existsSync(file), false);
        at(MIN);
        meter.check();
        assert.equal(readFile().sessions[0].calls, 1);
    });
});
