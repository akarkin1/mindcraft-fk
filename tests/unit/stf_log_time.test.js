// Spec v0.1.4.8, part F: F4 (time in the log, S8) -- src/utils/log_time.js, installLogTime (I10),
// and its calls in main.js and src/process/init_agent.js.
//
// The console objects of the tests are fakes, so the console of the test runner is never wrapped;
// one test wraps the real console in a child process.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { format } from 'node:util';
import { loadSrc } from '../helpers/load.js';
import { repoPath, repoUrl } from '../helpers/paths.js';
import { runNodeModuleSource, describeRun } from '../helpers/child.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/utils/log_time.js';
const L = await loadSrc(MODULE);

const AT = new Date(2026, 8, 29, 9, 5, 7); // local time
const STAMP = '[09:05:07]';

// A console with recorders for every method. `lines` holds what each call would print.
function fakeConsole() {
    const calls = [];
    const target = {};
    for (const method of ['log', 'info', 'warn', 'error', 'debug'])
        target[method] = (...args) => calls.push({ method, args, line: format(...args) });
    return { target, calls, lines: () => calls.map((c) => c.line) };
}

describe('module', () => {
    test('imports nothing but node:util (v0.1.4.9: util.format)', () => {
        assertImportRules(MODULE, { allowBuiltins: ['util'], allowedRelative: [] });
    });

    test('imports without output, without files and without touching the console', () => {
        assertCleanImport(MODULE);
    });

    test('exports installLogTime and timeStamp', () => {
        assert.equal(typeof L.installLogTime, 'function');
        assert.equal(typeof L.timeStamp, 'function');
    });
});

describe('timeStamp', () => {
    test('[HH:MM:SS] in local time, two digits each', () => {
        assert.equal(L.timeStamp(AT), STAMP);
        assert.equal(L.timeStamp(new Date(2026, 0, 1, 23, 59, 0)), '[23:59:00]');
        assert.equal(L.timeStamp(AT.getTime()), STAMP);
    });

    test('a value that is not a time gives [--:--:--]', () => {
        assert.equal(L.timeStamp(NaN), '[--:--:--]');
        assert.equal(L.timeStamp(new Date('nope')), '[--:--:--]');
    });
});

describe('installLogTime', () => {
    test('log, warn and error get the stamp before the line', () => {
        const c = fakeConsole();
        assert.equal(L.installLogTime(true, () => AT, c.target), true);
        c.target.log('Starting agent');
        c.target.warn('careful');
        c.target.error('broken');
        assert.deepEqual(c.lines(), [`${STAMP} Starting agent`, `${STAMP} careful`, `${STAMP} broken`]);
    });

    test('info and debug are left as they are', () => {
        const c = fakeConsole();
        const { info, debug } = c.target;
        L.installLogTime(true, () => AT, c.target);
        assert.equal(c.target.info, info);
        assert.equal(c.target.debug, debug);
    });

    test('format strings keep working: the stamp goes into the first string', () => {
        const c = fakeConsole();
        L.installLogTime(true, () => AT, c.target);
        c.target.log('%s has %d logs', 'claude', 3);
        c.target.log('Agent executed:', '!stats', 'and got:', 'ok');
        assert.deepEqual(c.lines(), [`${STAMP} claude has 3 logs`, `${STAMP} Agent executed: !stats and got: ok`]);
    });

    // v0.1.4.9 (the owner's Luna session): the arguments are formatted as console does, the stamp goes before the line
    test('a first argument that is no string: formatted as console does, the stamp before the line', () => {
        const c = fakeConsole();
        L.installLogTime(true, () => AT, c.target);
        const error = new Error('boom');
        c.target.error(error);
        c.target.log({ a: 1 });
        c.target.log();
        assert.equal(c.calls[0].args.length, 1);
        assert.equal(c.calls[0].line, `${STAMP} ${format(error)}`);
        assert.equal(c.calls[1].line, `${STAMP} { a: 1 }`);
        assert.equal(c.calls[2].line, STAMP);
    });

    test('console.warn(new Error(\'x\')) prints "x" and the stack; an object prints its keys, never [object Object]', () => {
        const c = fakeConsole();
        L.installLogTime(true, () => AT, c.target);
        const error = new Error('x');
        c.target.warn(error);
        c.target.warn({ name: 'Trace', message: 'entity.mobType is deprecated' });
        c.target.warn('%s', { depth: { of: 2 } });
        const [first, second, third] = c.lines();
        assert.ok(first.startsWith(`${STAMP} Error: x\n`), first);
        assert.ok(first.includes(error.stack.split('\n')[1].trim()), 'the stack');
        assert.equal(second, `${STAMP} { name: 'Trace', message: 'entity.mobType is deprecated' }`);
        assert.ok(!c.lines().some((l) => l.includes('[object Object]')), c.lines().join(' | '));
        assert.match(third, /depth/);
    });

    test('console.trace (the warning of prismarine-entity): "Trace: <message>" and the stack, through the stamped error', () => {
        const c = fakeConsole();
        let traced = 0;
        c.target.trace = () => { traced++; };
        L.installLogTime(true, () => AT, c.target);
        c.target.trace('Warning: entity.mobType is deprecated. Use %s instead', 'entity.displayName');
        assert.equal(traced, 0, 'the original trace is not used while the stamps are on');
        const line = c.lines()[0];
        assert.ok(line.startsWith(`${STAMP} Trace: Warning: entity.mobType is deprecated. Use entity.displayName instead\n`), line);
        assert.match(line, /\n\s+at /, 'the stack');
        assert.equal(c.calls[0].method, 'error');
        L.installLogTime(false, () => AT, c.target);
        c.target.trace('off');
        assert.equal(traced, 1, 'stamps off: the original trace');
    });

    test('under the SES lockdown of the agent process, console.trace prints its message, not [object Object]', () => {
        const source = `
            import 'ses';
            const L = await import(${JSON.stringify(repoUrl('src/agent/library/lockdown.js'))});
            L.lockdown();
            const { installLogTime } = await import(${JSON.stringify(repoUrl(MODULE))});
            installLogTime(true);
            console.trace('Warning: entity.mobType is deprecated.');
            console.warn({ a: 1 });
        `;
        const run = runNodeModuleSource(source);
        assert.equal(run.status, 0, describeRun(run));
        assert.match(run.stderr, /^\[\d\d:\d\d:\d\d\] Trace: Warning: entity\.mobType is deprecated\.\n/, describeRun(run));
        assert.match(run.stderr, /\[\d\d:\d\d:\d\d\] \{ a: 1 \}/, describeRun(run));
        assert.ok(!run.stderr.includes('[object Object]'), describeRun(run));
    });

    test('off on a console that was never wrapped: nothing changes', () => {
        const c = fakeConsole();
        const before = { ...c.target };
        assert.equal(L.installLogTime(false, () => AT, c.target), false);
        assert.deepEqual({ ...c.target }, before);
        c.target.log('plain');
        assert.deepEqual(c.lines(), ['plain']);
    });

    test('safe to call twice: one stamp, not two; the last call decides on and off and the clock', () => {
        const c = fakeConsole();
        L.installLogTime(true, () => AT, c.target);
        const wrapped = c.target.log;
        L.installLogTime(true, () => AT, c.target);
        assert.equal(c.target.log, wrapped, 'not wrapped a second time');
        c.target.log('once');
        L.installLogTime(false, () => AT, c.target);
        c.target.log('off');
        L.installLogTime(true, () => new Date(2026, 8, 29, 10, 0, 0), c.target);
        c.target.log('on again');
        assert.deepEqual(c.lines(), [`${STAMP} once`, 'off', '[10:00:00] on again']);
    });

    test('the clock is read at each line', () => {
        const c = fakeConsole();
        let t = AT.getTime();
        L.installLogTime(true, () => new Date(t), c.target);
        c.target.log('a');
        t += 61_000;
        c.target.log('b');
        assert.deepEqual(c.lines(), [`${STAMP} a`, '[09:06:08] b']);
    });

    test('a broken clock falls back to the real time; the line is printed', () => {
        const c = fakeConsole();
        L.installLogTime(true, () => { throw new Error('no clock'); }, c.target);
        c.target.log('still here');
        assert.match(c.lines()[0], /^\[\d\d:\d\d:\d\d\] still here$/);
    });

    test('never throws, also without a console', () => {
        assert.equal(L.installLogTime(true, () => AT, null), false);
        assert.equal(L.installLogTime(true, 'not a clock', fakeConsole().target), true);
    });

    test('the real console of a process: stdout and stderr lines get the stamp, the rest is unchanged', () => {
        const source = `
            import { installLogTime } from ${JSON.stringify(repoUrl(MODULE))};
            installLogTime(true);
            installLogTime(true);
            console.log('first %s', 'line');
            console.error('second');
            process.stdout.write('raw\\n');
        `;
        const run = runNodeModuleSource(source);
        assert.equal(run.status, 0, describeRun(run));
        const out = run.stdout.split(/\r?\n/).filter(Boolean);
        assert.match(out[0], /^\[\d\d:\d\d:\d\d\] first line$/, describeRun(run));
        assert.equal(out[1], 'raw');
        assert.match(run.stderr.trim(), /^\[\d\d:\d\d:\d\d\] second$/, describeRun(run));
    });
});

describe('the calls (source text)', () => {
    const text = (rel) => fs.readFileSync(repoPath(rel), 'utf8');

    test('main.js installs it with the setting, before the mind server and the agents start', () => {
        const main = text('main.js');
        const call = main.indexOf('installLogTime(settings.log_timestamps ?? false)');
        assert.ok(call > 0, 'installLogTime(settings.log_timestamps ?? false) is called');
        assert.ok(call < main.indexOf('Mindcraft.init('), 'before Mindcraft.init');
        assert.ok(call > main.lastIndexOf('SETTINGS_JSON'), 'after the settings of the environment are applied');
    });

    test('init_agent.js installs it with the setting of the agent, before the agent starts', () => {
        const init = text('src/process/init_agent.js');
        const call = init.indexOf('installLogTime(settings.log_timestamps ?? false)');
        assert.ok(call > 0, 'installLogTime(settings.log_timestamps ?? false) is called');
        assert.ok(call > init.indexOf('await serverProxy.connect('), 'after the settings arrived');
        assert.ok(call < init.indexOf('new Agent('), 'before the agent starts');
        assert.match(init, /import settings from '\.\.\/agent\/settings\.js';/);
    });
});
