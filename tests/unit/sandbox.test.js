// Spec S5: src/agent/library/lockdown.js (lockdown, isLockedDown, initSandbox, makeCompartment)
// and the call sites in agent.js and coder.js.
// Amendment 1: A1 (lockdown options), A2 (formatError, console wrappers, process listeners),
// A3 (initSandbox return value, logging, fail path) and the acceptance scenarios 1 to 8.
// Amendment 2: B1 (console wrappers put '%s' in front when the first argument is an error)
// and its acceptance sentence.
//
// SES lockdown is global and permanent, so every scenario runs in its own child process
// (tests/fixtures/sandbox_scenario.js). The child prints facts as JSON; this file asserts.
// formatError is a pure function and is tested in this process, without lockdown.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { FIXTURES_DIR, repoPath } from '../helpers/paths.js';
import { runNodeScript, describeRun } from '../helpers/child.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const FIXTURE = path.join(FIXTURES_DIR, 'sandbox_scenario.js');
// Importing lockdown.js only loads SES (new globals such as lockdown and Compartment); it does
// not lock down this process. Used for the pure formatError tests.
const lockdownModule = await loadSrc('src/agent/library/lockdown.js');

// The options passed to SES lockdown in lockdown.js at v0.1.4.1 ("exactly the options that
// are in the file today", S5).
const LOCKDOWN_OPTIONS_S5 = {
    localeTaming: 'unsafe',
    consoleTaming: 'unsafe',
    errorTaming: 'unsafe',
    stackFiltering: 'verbose',
    evalTaming: 'unsafeEval',
};
// A1: "the options of today PLUS two more"; overrideTaming is not set.
const LOCKDOWN_OPTIONS = {
    ...LOCKDOWN_OPTIONS_S5,
    errorTrapping: 'none',
    unhandledRejectionTrapping: 'none',
};

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'];
const ALL_TRUE = Object.fromEntries(CONSOLE_METHODS.map((m) => [m, true]));
const ALL_FALSE = Object.fromEntries(CONSOLE_METHODS.map((m) => [m, false]));

const childCwd = makeTmpDir();
after(() => removeTmpDir(childCwd));

// Each scenario is a pure function of its name: run it once, reuse the facts.
const cache = new Map();
function runOnce(name) {
    if (!cache.has(name)) cache.set(name, runNodeScript(FIXTURE, [name], { cwd: childCwd }));
    return cache.get(name);
}

// A scenario that runs to its end: exit code 0 and a RESULT line.
function runScenario(name) {
    const run = runOnce(name);
    assert.equal(run.status, 0, `fixture exit code\n${describeRun(run)}`);
    assert.ok(run.result, `no RESULT line\n${describeRun(run)}`);
    assert.equal(run.result.fixtureError, undefined, `fixture error\n${describeRun(run)}`);
    return run.result;
}

// A scenario that ends the process on purpose ("exit-..."): returns the whole run.
function runExitScenario(name) {
    const run = runOnce(name);
    assert.equal(run.error, undefined, `could not run the fixture\n${describeRun(run)}`);
    assert.equal(run.signal, null, `fixture killed by a signal\n${describeRun(run)}`);
    assert.ok(run.result, `no RESULT line before the exit\n${describeRun(run)}`);
    assert.equal(run.result.fixtureError, undefined, `fixture error\n${describeRun(run)}`);
    return run;
}

function assertCall(call, expectedValue, label) {
    assert.equal(call.threw, false, `${label} threw: ${JSON.stringify(call.error)}`);
    assert.equal(call.value, expectedValue, label);
}

// A scenario whose initSandbox call (facts[initKey]) must have locked down. Tests of the
// error reporting use it as a precondition: without a lockdown nothing is installed and
// a pass-through assertion would pass for the wrong reason.
function lockedScenario(name, initKey = 'init') {
    const facts = runScenario(name);
    assertCall(facts[initKey], true, `precondition: initSandbox locked down in "${name}"`);
    return facts;
}

// The console wrapper scenario, with the precondition that all five methods were replaced.
function wrappersScenario() {
    const facts = lockedScenario('wrappers');
    assert.deepEqual(facts.replaced, ALL_TRUE, 'precondition: all five console methods are wrappers');
    return facts;
}

// The B1 table scenario (recording stubs), with the same precondition.
function b1Scenario() {
    const facts = lockedScenario('b1-rows');
    assert.deepEqual(facts.replaced, ALL_TRUE, 'precondition: all five console methods are wrappers');
    return facts;
}

// B1 tokens reported by the fixture (argumentTokens): what reached the original method, in order.
const PERCENT_S = { string: '%s' };
const fmtOf = (i) => ({ formatErrorOf: i });
const sentAt = (i) => ({ sent: i });

const textLines = (text) => text.split(/\r?\n/);
// "at least one stack line that starts with `at ` after trimming"
const hasStackLine = (text) => textLines(text).some((l) => l.trim().startsWith('at '));
const linesStartingWith = (text, prefix) => textLines(text).filter((l) => l.startsWith(prefix));
const countOf = (text, needle) => text.split(needle).length - 1;
// "append a line break": accept LF and CRLF.
const norm = (text) => text.replace(/\r\n/g, '\n');
const plusOne = (counts) => ({
    uncaughtException: counts.uncaughtException + 1,
    unhandledRejection: counts.unhandledRejection + 1,
});
const outputOf = (capture) => capture.stdout + capture.stderr;

describe('lockdown.js exports', () => {
    test('lockdown, isLockedDown, initSandbox and makeCompartment are exported functions', () => {
        const facts = runScenario('import-only');
        assert.equal(facts.lockdownType, 'function');
        assert.equal(facts.isLockedDownType, 'function');
        assert.equal(facts.initSandboxType, 'function');
        assert.equal(facts.makeCompartmentType, 'function');
    });

    test('A2: formatError is a new exported function', () => {
        assert.equal(runScenario('import-only').formatErrorType, 'function');
    });

    test('importing lockdown.js does not lock down; isLockedDown() is false', () => {
        const facts = runScenario('import-only');
        assert.equal(facts.locked, false);
        assert.equal(facts.frozen, false, 'intrinsics not frozen');
        assert.deepEqual(facts.lockdownCalls, []);
    });

    test('A2: importing lockdown.js installs no console wrapper and no process listener', () => {
        const facts = runScenario('import-only');
        assert.deepEqual(facts.importChangedConsole, [], 'console methods replaced at import');
        assert.deepEqual(facts.listenersAfterImport, facts.listenersBeforeImport);
    });
});

describe('S5 acceptance scenarios (one child process each)', () => {
    test('1. lockdown on: [].constructor.constructor("return typeof process")() throws or returns "undefined", never "object"', () => {
        const facts = runScenario('escape');
        assertCall(facts.init, true, 'initSandbox({allow_insecure_coding: true, sandbox_lockdown: true})');
        assert.equal(facts.locked, true, 'isLockedDown()');
        assert.equal(facts.frozen, true, 'SES really ran: intrinsics are frozen');
        const escape = facts.functionConstructorEscape;
        assert.ok(escape.threw || escape.value === 'undefined', `escape returned ${JSON.stringify(escape)}`);
        assert.notEqual(escape.value, 'object');
        assert.deepEqual(facts.typeofProcess, { threw: false, value: 'undefined', error: null });
        assert.deepEqual(facts.typeofGlobalProcess, { threw: false, value: 'undefined', error: null });
    });

    test('2. lockdown on: async arrow in a compartment awaits a host promise, uses Math and Date, value comes back', () => {
        const facts = runScenario('async');
        assertCall(facts.init, true, 'initSandbox');
        assert.equal(facts.frozen, true);
        assert.equal(facts.awaited, 42);
        assertCall(facts.mathAndDate, true, 'Math and Date are available');
    });

    test('3. flag off (sandbox_lockdown: false): initSandbox returns false, isLockedDown() false, compartments still work', () => {
        const facts = runScenario('flag-off');
        assertCall(facts.init, false, 'initSandbox({allow_insecure_coding: true, sandbox_lockdown: false})');
        assert.equal(facts.locked, false);
        assert.equal(facts.frozen, false);
        assert.deepEqual(facts.lockdownCalls, []);
        assertCall(facts.simpleEval, 3, 'compartment.evaluate("1 + 2")');
        assert.equal(facts.awaited, 42);
    });

    test('4. allow_insecure_coding falsy (false, missing, 0, "", null, undefined): no lockdown, initSandbox returns false', () => {
        const facts = runScenario('insecure-falsy');
        for (const init of facts.inits) assertCall(init, false, `initSandbox(${init.settings})`);
        assert.equal(facts.locked, false);
        assert.equal(facts.frozen, false);
        assert.deepEqual(facts.lockdownCalls, []);
        assertCall(facts.simpleEval, 42, 'compartment still evaluates');
    });

    test('5. initSandbox twice (and a third time) with lockdown on: no throw, returns true, SES lockdown ran once', () => {
        const facts = runScenario('twice');
        assertCall(facts.first, true, 'first initSandbox');
        assertCall(facts.second, true, 'second initSandbox');
        assertCall(facts.third, true, 'third initSandbox');
        assert.equal(facts.locked, true);
        assert.equal(facts.frozen, true);
        assert.equal(facts.lockdownCalls.length, 1);
    });
});

describe('initSandbox(settings) rules', () => {
    test('A1: SES lockdown is called with exactly the five options of S5 plus errorTrapping: "none" and unhandledRejectionTrapping: "none"', () => {
        const facts = runScenario('escape');
        assert.deepEqual(facts.lockdownCalls, [[LOCKDOWN_OPTIONS]]);
    });

    test('A1: overrideTaming is not set (no such key in the options, so the SES default applies)', () => {
        const facts = runScenario('escape');
        assert.equal(facts.lockdownOptionKeys.length, 1);
        assert.deepEqual([...facts.lockdownOptionKeys[0]].sort(), Object.keys(LOCKDOWN_OPTIONS).sort());
        assert.ok(!facts.lockdownOptionKeys[0].includes('overrideTaming'));
    });

    test('an undefined sandbox_lockdown flag counts as on', () => {
        const facts = runScenario('undefined-flag');
        assertCall(facts.init, true, 'initSandbox({allow_insecure_coding: true})');
        assert.equal(facts.locked, true);
        assert.equal(facts.frozen, true);
        assert.equal(facts.lockdownCalls.length, 1);
    });

    test('only sandbox_lockdown === false switches it off (null, 0, "false" count as on; truthy "yes" enables)', () => {
        const facts = runScenario('flag-not-strictly-false');
        for (const init of facts.inits) assertCall(init, true, `initSandbox(${init.settings})`);
        assert.equal(facts.locked, true);
        assert.equal(facts.lockdownCalls.length, 1);
    });

    test('A3 logging: exactly one line on the first call of the process, nothing on later calls (lockdown not requested)', () => {
        const flagOff = runScenario('flag-off').init;
        assert.equal(flagOff.logLines, 1, JSON.stringify(outputOf(flagOff)));
        const inits = runScenario('insecure-falsy').inits;
        assert.deepEqual(inits.map((i) => i.logLines), [1, 0, 0, 0, 0, 0, 0], JSON.stringify(inits.map(outputOf)));
    });

    test('A3 logging: exactly one line when the first call of the process locks down', () => {
        const init = runScenario('escape').init;
        assert.equal(init.logLines, 1, JSON.stringify(outputOf(init)));
    });
});

describe('lockdown()', () => {
    test('first call runs globalThis.lockdown once with the A1 options; the second call does nothing and does not throw', () => {
        const facts = runScenario('lockdown-direct');
        assert.equal(facts.first.threw, false, JSON.stringify(facts.first.error));
        assert.equal(facts.second.threw, false, JSON.stringify(facts.second.error));
        assert.deepEqual(facts.lockdownCalls, [[LOCKDOWN_OPTIONS]]);
        assert.ok(!facts.lockdownOptionKeys[0].includes('overrideTaming'), 'overrideTaming is not set');
        assert.equal(facts.frozen, true, 'SES lockdown really ran (the old code only recursed into itself)');
    });

    test('isLockedDown() is true after lockdown(); initSandbox afterwards returns true without a second SES call', () => {
        const facts = runScenario('lockdown-direct');
        assert.equal(facts.locked, true);
        assertCall(facts.afterwardsInit, true, 'initSandbox after lockdown()');
        assert.equal(facts.lockdownCalls.length, 1);
    });

    test('A2: lockdown() itself installs the error reporting after SES succeeded; a second lockdown() changes nothing', () => {
        const facts = runScenario('lockdown-direct');
        assert.deepEqual(facts.consoleUnchangedByFirst, ALL_FALSE, 'the first lockdown() replaces all five console methods');
        assert.deepEqual(facts.listenersAfterFirst, plusOne(facts.listenersBefore), 'one listener each');
        assert.deepEqual(facts.consoleUnchangedBySecond, ALL_TRUE, 'the second lockdown() leaves the console alone');
        assert.deepEqual(facts.listenersAfterSecond, facts.listenersAfterFirst, 'the second lockdown() adds no listener');
    });
});

describe('A2 formatError(value): pure function (tested in this process, without lockdown)', () => {
    const formatError = (value) => lockdownModule.formatError(value);

    // Error with a short fake stack, so the expected text can be written out in full.
    const withStack = (error, stack) => {
        error.stack = stack;
        return error;
    };
    // Level 0 is the outer error; level i has the stack "STACK-i" and the cause level i + 1.
    const chainOfDepth = (depth) => {
        let inner;
        for (let level = depth; level >= 0; level--) {
            const options = level === depth ? undefined : { cause: inner };
            inner = withStack(new Error(`message-${level}`, options), `STACK-${level}`);
        }
        return inner;
    };
    const expectedChain = (levels) => ['STACK-0', ...Array.from({ length: levels }, (_, i) => `Caused by: STACK-${i + 1}`)].join('\n');

    describe('errors', () => {
        test('an error with a non-empty stack: the result starts with value.stack', () => {
            const err = new Error('boom-with-stack');
            assert.match(err.stack, /\n\s+at /, 'precondition: a real V8 stack');
            const result = formatError(err);
            assert.equal(typeof result, 'string');
            assert.ok(result.startsWith(err.stack), JSON.stringify(result));
        });

        test('the stack is used as it is, not rebuilt from name and message (custom stack string)', () => {
            const err = withStack(new Error('not-in-the-stack'), 'CustomStack: first line\n    at frame (file.js:1:1)');
            assert.ok(formatError(err).startsWith('CustomStack: first line\n    at frame (file.js:1:1)'));
        });

        test('a TypeError and a subclass of Error with its own name: the result starts with their stack', () => {
            class NamedError extends Error {
                constructor(message) {
                    super(message);
                    this.name = 'NamedError';
                }
            }
            for (const err of [new TypeError('type-boom'), new NamedError('named-boom')]) {
                assert.ok(formatError(err).startsWith(err.stack), err.name);
            }
        });

        test('an error without a stack (stack property deleted): the result starts with String(value)', () => {
            const err = new Error('no-stack');
            delete err.stack;
            assert.equal(err.stack, undefined, 'precondition');
            assert.ok(formatError(err).startsWith('Error: no-stack'), formatError(err));
        });

        test('an error with a blank stack (""): no usable stack, the result starts with String(value)', () => {
            const err = withStack(new Error('blank-stack'), '');
            assert.ok(formatError(err).startsWith('Error: blank-stack'), JSON.stringify(formatError(err)));
        });

        test('an error whose stack is not a string (number, object): the result starts with String(value)', () => {
            assert.ok(formatError(withStack(new Error('numeric-stack'), 42)).startsWith('Error: numeric-stack'));
            assert.ok(formatError(withStack(new Error('object-stack'), { at: 'x' })).startsWith('Error: object-stack'));
        });

        test('a subclass with its own name and no stack: the result starts with "Name: message"', () => {
            class NamedError extends Error {
                constructor(message) {
                    super(message);
                    this.name = 'NamedError';
                }
            }
            const err = new NamedError('named-no-stack');
            delete err.stack;
            assert.ok(formatError(err).startsWith('NamedError: named-no-stack'), formatError(err));
        });

        test('an error without a cause gets no "Caused by: "', () => {
            assert.equal(countOf(formatError(new Error('lonely')), 'Caused by: '), 0);
            assert.equal(countOf(formatError(withStack(new Error('lonely'), 'STACK-LONELY')), 'Caused by: '), 0);
        });
    });

    describe('cause', () => {
        test('cause chain of depth 1: stack, a line break, "Caused by: " and formatError(cause)', () => {
            const result = norm(formatError(chainOfDepth(1)));
            assert.ok(result.startsWith(expectedChain(1)), JSON.stringify(result));
            assert.equal(countOf(result, 'Caused by: '), 1);
        });

        test('cause chain of depth 3: all three causes are printed, in order', () => {
            const result = norm(formatError(chainOfDepth(3)));
            assert.ok(result.startsWith(expectedChain(3)), JSON.stringify(result));
            assert.equal(countOf(result, 'Caused by: '), 3);
        });

        test('cause chain of depth 5: at most 3 levels of cause are followed, levels 4 and 5 are ignored', () => {
            const result = norm(formatError(chainOfDepth(5)));
            assert.ok(result.startsWith(expectedChain(3)), JSON.stringify(result));
            assert.equal(countOf(result, 'Caused by: '), 3);
            assert.ok(!result.includes('STACK-4'), 'level 4 ignored');
            assert.ok(!result.includes('STACK-5'), 'level 5 ignored');
        });

        test('an error that is its own cause: still 3 levels, no endless recursion', () => {
            const err = withStack(new Error('loop'), 'STACK-LOOP');
            err.cause = err;
            const result = norm(formatError(err));
            assert.ok(result.startsWith('STACK-LOOP\nCaused by: STACK-LOOP\nCaused by: STACK-LOOP\nCaused by: STACK-LOOP'), JSON.stringify(result));
            assert.equal(countOf(result, 'Caused by: '), 3);
        });

        test('the cause is formatted with formatError: a cause without a stack prints String(cause)', () => {
            const inner = new Error('inner-no-stack');
            delete inner.stack;
            const result = norm(formatError(withStack(new Error('outer', { cause: inner }), 'STACK-OUTER')));
            assert.ok(result.startsWith('STACK-OUTER\nCaused by: Error: inner-no-stack'), JSON.stringify(result));
        });

        test('a non-error cause is printed with String(cause): a string, a number, a plain object', () => {
            for (const [cause, text] of [['plain reason', 'plain reason'], [404, '404'], [{ code: 7 }, '[object Object]']]) {
                const result = norm(formatError(withStack(new Error('outer', { cause }), 'STACK-OUTER')));
                assert.ok(result.startsWith(`STACK-OUTER\nCaused by: ${text}`), JSON.stringify(result));
                assert.equal(countOf(result, 'Caused by: '), 1);
            }
        });

        test('a null cause is "not undefined", so it is printed: "Caused by: null"', () => {
            const result = norm(formatError(withStack(new Error('outer', { cause: null }), 'STACK-OUTER')));
            assert.ok(result.startsWith('STACK-OUTER\nCaused by: null'), JSON.stringify(result));
        });

        test('a cause that cannot be printed gives "Caused by: [unprintable value]"', () => {
            const result = norm(formatError(withStack(new Error('outer', { cause: Object.create(null) }), 'STACK-OUTER')));
            assert.ok(result.startsWith('STACK-OUTER\nCaused by: [unprintable value]'), JSON.stringify(result));
        });

        test('a cause that is explicitly undefined ({ cause: undefined }) is not printed', () => {
            const err = withStack(new Error('outer', { cause: undefined }), 'STACK-OUTER');
            assert.ok('cause' in err, 'precondition: the property exists');
            const result = formatError(err);
            assert.ok(result.startsWith('STACK-OUTER'));
            assert.equal(countOf(result, 'Caused by: '), 0);
        });

        test('an error without a stack but with a cause: String(value) first, then the cause', () => {
            const err = new Error('outer-no-stack', { cause: withStack(new Error('inner'), 'STACK-INNER') });
            delete err.stack;
            const result = norm(formatError(err));
            assert.ok(result.startsWith('Error: outer-no-stack\nCaused by: STACK-INNER'), JSON.stringify(result));
        });
    });

    describe('non-error values: String(value), never a throw', () => {
        test('null, undefined, numbers, bigint and booleans', () => {
            const cases = [[null, 'null'], [undefined, 'undefined'], [0, '0'], [42, '42'], [-1.5, '-1.5'], [NaN, 'NaN'], [10n, '10'], [true, 'true'], [false, 'false']];
            for (const [value, expected] of cases) assert.equal(formatError(value), expected, String(value));
        });

        test('strings are returned unchanged (also "" and a string that looks like a stack)', () => {
            for (const value of ['', 'plain text', 'Error: looks like a stack\n    at frame (file.js:1:1)']) {
                assert.equal(formatError(value), value);
            }
        });

        test('a symbol gives String(symbol), e.g. "Symbol(desc)", and does not throw', () => {
            assert.equal(formatError(Symbol('desc')), 'Symbol(desc)');
            assert.equal(formatError(Symbol()), 'Symbol()');
        });

        test('a plain object gives "[object Object]", an array gives its String() form', () => {
            assert.equal(formatError({ a: 1 }), '[object Object]');
            assert.equal(formatError([1, 2, 3]), '1,2,3');
            assert.equal(formatError([]), '');
        });

        test('an object with its own toString gives that text', () => {
            assert.equal(formatError({ toString: () => 'custom text' }), 'custom text');
        });

        test('an object without a prototype does not throw: "[unprintable value]"', () => {
            assert.equal(formatError(Object.create(null)), '[unprintable value]');
        });

        test('an object whose toString throws gives "[unprintable value]"', () => {
            const hostile = {
                toString() {
                    throw new Error('toString exploded');
                },
            };
            assert.equal(formatError(hostile), '[unprintable value]');
        });

        test('an object whose Symbol.toPrimitive throws gives "[unprintable value]"', () => {
            const hostile = {
                [Symbol.toPrimitive]() {
                    throw new TypeError('no primitive');
                },
            };
            assert.equal(formatError(hostile), '[unprintable value]');
        });

        test('a duck-typed object with name, message and stack is NOT an error: String(value)', () => {
            const duck = { name: 'Error', message: 'duck', stack: 'Error: duck\n    at nowhere (duck.js:1:1)' };
            assert.equal(formatError(duck), '[object Object]');
        });

        test('a non-error with a cause property: no "Caused by: " (only errors follow cause)', () => {
            assert.equal(formatError({ cause: new Error('hidden') }), '[object Object]');
        });
    });

    describe('error detection: value instanceof Error, or Object.prototype.toString gives "[object Error]"', () => {
        test('an Error from another realm (vm) is not instanceof Error but is an error: its stack is used', () => {
            const foreign = vm.runInNewContext('new RangeError("foreign-realm")');
            assert.equal(foreign instanceof Error, false, 'precondition');
            assert.equal(Object.prototype.toString.call(foreign), '[object Error]', 'precondition');
            assert.ok(formatError(foreign).startsWith(foreign.stack), formatError(foreign));
        });

        test('an object whose Symbol.toStringTag is "Error" is an error: its stack is used', () => {
            const tagged = { [Symbol.toStringTag]: 'Error', stack: 'TaggedStack: tagged\n    at frame (tagged.js:1:1)' };
            assert.ok(formatError(tagged).startsWith('TaggedStack: tagged\n    at frame (tagged.js:1:1)'), formatError(tagged));
        });

        test('an object tagged "Error" without a stack: String(value), and its cause is followed', () => {
            const tagged = { [Symbol.toStringTag]: 'Error', cause: 'tagged cause' };
            const result = norm(formatError(tagged));
            assert.ok(result.startsWith('[object Error]\nCaused by: tagged cause'), JSON.stringify(result));
        });

        test('Object.create(Error.prototype) is instanceof Error, so its stack is used', () => {
            const protoError = Object.create(Error.prototype);
            protoError.stack = 'STACK-FROM-PROTOTYPE-ERROR';
            assert.equal(Object.prototype.toString.call(protoError), '[object Object]', 'precondition: detected by instanceof only');
            assert.ok(formatError(protoError).startsWith('STACK-FROM-PROTOTYPE-ERROR'), formatError(protoError));
        });
    });

    describe('pure function, no side effects', () => {
        test('prints nothing and does not change the error, its cause or its stack', () => {
            const cause = new Error('inner');
            const err = new Error('outer', { cause });
            const snapshot = (e) => ({ keys: Reflect.ownKeys(e), stack: e.stack, message: e.message, cause: e.cause, extensible: Object.isExtensible(e) });
            const before = [snapshot(err), snapshot(cause)];
            const capture = captureConsole();
            try {
                formatError(err);
                formatError(Object.create(null));
                formatError(Symbol('quiet'));
            } finally {
                capture.restore();
            }
            assert.deepEqual(capture.records, [], 'no console output');
            assert.deepEqual([snapshot(err), snapshot(cause)], before);
        });

        test('the same input gives the same result', () => {
            const err = new Error('stable', { cause: new Error('stable-cause') });
            assert.equal(formatError(err), formatError(err));
            assert.equal(formatError(chainOfDepth(5)), formatError(chainOfDepth(5)));
        });
    });
});

describe('A2 formatError after a real lockdown (child process)', () => {
    test('stack first, String(value) without a stack, 3 cause levels, "[unprintable value]"', () => {
        const facts = runScenario('format-after-lockdown');
        assertCall(facts.init, true, 'initSandbox');
        assert.ok(facts.withStack.formatted.startsWith(facts.withStack.stack), facts.withStack.formatted);
        assert.ok(hasStackLine(facts.withStack.formatted));
        assert.equal(facts.noStack.stackType, 'undefined', 'precondition: stack deleted');
        assert.ok(facts.noStack.formatted.startsWith(facts.noStack.string), facts.noStack.formatted);
        const chain = norm(facts.chain);
        assert.equal(countOf(chain, 'Caused by: '), 3, chain);
        assert.ok(chain.includes('Caused by: Error: c3'), chain);
        assert.ok(!chain.includes('Error: c4'), chain);
        assert.equal(facts.nullPrototype, '[unprintable value]');
    });
});

describe('A2 console wrappers (child process; recording stubs stand in for the original console methods)', () => {
    test('after lockdown, log, info, warn, error and debug are replaced by wrappers', () => {
        const facts = wrappersScenario();
        assertCall(facts.init, true, 'initSandbox');
        assert.deepEqual(facts.replaced, ALL_TRUE);
    });

    test('a wrapper returns what the original returns and calls the original exactly once', () => {
        const facts = wrappersScenario();
        for (const m of CONSOLE_METHODS) {
            assert.equal(facts.returns[m].returned, `returned-by-${m}`, `console.${m} return value`);
            assert.deepEqual(facts.returns[m].calls, [m], `console.${m} calls`);
        }
    });

    test('every method replaces a top-level error argument by formatError(argument)', () => {
        const facts = wrappersScenario();
        for (const m of CONSOLE_METHODS) {
            const { calls, received } = facts.perMethod[m];
            assert.deepEqual(calls, [m], `console.${m} calls`);
            assert.equal(received.length, 2, `console.${m} argument count`);
            assert.equal(received.items[0].sameRef, true, `console.${m}: first argument unchanged`);
            assert.equal(received.items[1].type, 'string', `console.${m}: the error became a string`);
            assert.equal(received.items[1].formatted, true, `console.${m}: the string is formatError(error)`);
            assert.ok(received.items[1].text.startsWith(`Error: error-for-${m}`), received.items[1].text);
        }
    });

    test('argument count and order are preserved; non-error arguments are passed through unchanged (same value or reference)', () => {
        const { calls, received } = wrappersScenario().mixed;
        assert.deepEqual(calls, ['error']);
        assert.equal(received.length, 10);
        // 'text-arg', 42, { nested }, [e2], null, undefined, Symbol, duck-typed object
        for (const i of [0, 2, 3, 5, 6, 7, 8, 9]) {
            assert.equal(received.items[i].sameRef, true, `argument ${i} passed through: ${JSON.stringify(received.items[i])}`);
        }
    });

    test('several errors in one call are all replaced, each at its own position', () => {
        const { received } = wrappersScenario().mixed;
        for (const i of [1, 4]) {
            assert.equal(received.items[i].type, 'string', `argument ${i}`);
            assert.equal(received.items[i].formatted, true, `argument ${i} is formatError of the error sent at position ${i}`);
        }
        assert.ok(received.items[1].text.startsWith('Error: first-error'), received.items[1].text);
        assert.ok(received.items[4].text.startsWith('TypeError: second-error'), received.items[4].text);
    });

    test('an error nested inside an object or an array is NOT replaced (same object, error still inside)', () => {
        const mixed = wrappersScenario().mixed;
        assert.equal(mixed.received.items[3].sameRef, true, 'object passed by reference');
        assert.equal(mixed.received.items[5].sameRef, true, 'array passed by reference');
        assert.equal(mixed.nestedObjectIntact, true, 'object still holds the Error instance');
        assert.equal(mixed.nestedArrayIntact, true, 'array still holds the Error instance');
    });

    test('a duck-typed object with name, message and stack is not an error and is passed through', () => {
        const { received } = wrappersScenario().mixed;
        assert.equal(received.items[9].sameRef, true);
        assert.equal(received.items[9].type, 'object');
    });

    test("\"an error\" as in the error detection of A2: an error from another realm and an object tagged \"Error\" are replaced (B1: the first argument is an error, so '%s' comes first)", () => {
        const { calls, received, texts, foreignIsInstanceOfError } = wrappersScenario().errorLike;
        assert.equal(foreignIsInstanceOfError, false, 'precondition');
        assert.deepEqual(calls, ['warn']);
        assert.deepEqual(received, [PERCENT_S, fmtOf(0), fmtOf(1)], JSON.stringify(texts));
        assert.ok(texts[1].startsWith('RangeError: foreign-realm-error'), texts[1]);
        assert.ok(texts[2].startsWith('TaggedError: tagged'), texts[2]);
    });

    test('a call without arguments reaches the original with no arguments', () => {
        const { calls, length } = wrappersScenario().noArgs;
        assert.deepEqual(calls, ['log']);
        assert.equal(length, 0);
    });
});

describe('B1 console wrappers and format strings (Amendment 2; child process, recording stubs stand in for the original methods)', () => {
    // [call, row key in the fixture, right column of the B1 table, expected tokens]
    const ROWS = [
        ['console.log(err)', 'err', "'%s', formatError(err)", [PERCENT_S, fmtOf(0)]],
        ["console.log(err, 'extra', 5)", 'errExtra', "'%s', formatError(err), 'extra', 5", [PERCENT_S, fmtOf(0), sentAt(1), sentAt(2)]],
        ['console.log(err1, err2)', 'twoErrors', "'%s', formatError(err1), formatError(err2)", [PERCENT_S, fmtOf(0), fmtOf(1)]],
        ["console.log('Failed:', err)", 'failed', "'Failed:', formatError(err)", [sentAt(0), fmtOf(1)]],
        ["console.log('%d items', 3)", 'formatD', "'%d items', 3", [sentAt(0), sentAt(1)]],
        ['console.log({ a: 1 })', 'object', 'the same object', [sentAt(0)]],
        ['console.log()', 'none', 'nothing', []],
    ];
    for (const [call, key, receives, expected] of ROWS) {
        test(`B1 table: ${call} -> the original console.log receives exactly ${receives}`, () => {
            const row = b1Scenario().rows[key];
            assert.deepEqual(row.calls, ['log'], 'the original is called exactly once');
            assert.deepEqual(row.received, expected, `texts received: ${JSON.stringify(row.texts)}`);
            assert.equal(row.returned, 'returned-by-log', 'the wrapper returns what the original returns');
        });
    }

    test("B1 in all five wrappers: log, info, warn, error and debug put '%s' in front when the first argument is an error", () => {
        const { perMethod } = b1Scenario();
        for (const m of CONSOLE_METHODS) {
            const call = perMethod[m];
            assert.deepEqual(call.calls, [m], `console.${m} calls`);
            assert.deepEqual(call.received, [PERCENT_S, fmtOf(0), sentAt(1)], `console.${m}: ${JSON.stringify(call.texts)}`);
            assert.equal(call.returned, `returned-by-${m}`, `console.${m} return value`);
        }
    });
});

describe('A2 error reporting is installed once ("doing it twice has no additional effect")', () => {
    test('the first initSandbox installs the wrappers; two more initSandbox calls and lockdown() keep the same functions', () => {
        const facts = lockedScenario('twice', 'first');
        assert.deepEqual(facts.consoleUnchangedByFirst, ALL_FALSE, 'first call installs wrappers');
        assert.deepEqual(facts.consoleUnchangedByLaterCalls, ALL_TRUE, 'later calls do not wrap again');
    });

    test('exactly one uncaughtException and one unhandledRejection listener, also after repeated calls', () => {
        const facts = lockedScenario('twice', 'first');
        assert.deepEqual(facts.listenersAfterFirst, plusOne(facts.listenersBefore));
        assert.deepEqual(facts.listenersAfterAll, plusOne(facts.listenersBefore));
    });

    test('the output of one console.error call appears once, not twice', () => {
        const text = outputOf(lockedScenario('twice', 'first').oneErrorCall);
        assert.equal(countOf(text, 'appears-once'), 1, text);
        assert.ok(hasStackLine(text), text);
    });

    test('installErrorReporting, if it is exported, called again directly has no additional effect', (t) => {
        const facts = lockedScenario('twice', 'first');
        if (facts.installErrorReportingType !== 'function') {
            t.skip('installErrorReporting is not exported (the amendment does not say it must be)');
            return;
        }
        assert.equal(facts.directInstall.threw, false, JSON.stringify(facts.directInstall.error));
        assert.deepEqual(facts.consoleUnchangedByDirectInstall, ALL_TRUE);
        assert.deepEqual(facts.listenersAfterDirectInstall, facts.listenersAfterAll);
    });
});

describe('A2 process listeners: exit codes seen by the parent (spawnSync)', () => {
    test('uncaught exception report: its first line is "Uncaught exception: " + the first line of formatError(error), the stack follows', () => {
        const run = runExitScenario('exit-uncaught-timer');
        assertCall(run.result.init, true, 'initSandbox (lockdown on)');
        assert.deepEqual(run.result.listenersAfterInit, plusOne(run.result.listenersBeforeImport));
        assert.deepEqual(linesStartingWith(run.stderr, 'Uncaught exception: '), ['Uncaught exception: Error: boom-timer'], describeRun(run));
        assert.ok(hasStackLine(run.stderr), describeRun(run));
    });

    test('unhandled rejection report: its first line is "Unhandled rejection: " + the first line of formatError(reason), the stack follows', () => {
        const run = runExitScenario('exit-unhandled-rejection');
        assertCall(run.result.init, true, 'initSandbox (lockdown on)');
        assert.deepEqual(linesStartingWith(run.stderr, 'Unhandled rejection: '), ['Unhandled rejection: Error: boom-rejection'], describeRun(run));
        assert.ok(hasStackLine(run.stderr), describeRun(run));
    });

    test('a thrown non-error value: exit code 1 and "Uncaught exception: " + String(value)', () => {
        const run = runExitScenario('exit-uncaught-non-error');
        assertCall(run.result.init, true, 'initSandbox (lockdown on)');
        assert.equal(run.status, 1, describeRun(run));
        assert.deepEqual(linesStartingWith(run.stderr, 'Uncaught exception: '), ['Uncaught exception: thrown-plain-string'], describeRun(run));
    });

    test('a rejection with a non-error reason: exit code 1 and "Unhandled rejection: " + String(reason)', () => {
        const run = runExitScenario('exit-rejection-non-error');
        assertCall(run.result.init, true, 'initSandbox (lockdown on)');
        assert.equal(run.status, 1, describeRun(run));
        assert.deepEqual(linesStartingWith(run.stderr, 'Unhandled rejection: '), ['Unhandled rejection: rejected-plain-string'], describeRun(run));
    });

    test('a normal process.exit(0) after lockdown: exit code 0 and no report', () => {
        const run = runExitScenario('exit-normal');
        assertCall(run.result.init, true, 'initSandbox (lockdown on)');
        assert.equal(run.status, 0, describeRun(run));
        assert.deepEqual(linesStartingWith(run.stderr, 'Uncaught exception: '), []);
        assert.deepEqual(linesStartingWith(run.stderr, 'Unhandled rejection: '), []);
    });

    test('lockdown off: no listener is added, an uncaught exception keeps Node\'s default (exit code 1, no "Uncaught exception: " report)', () => {
        const run = runExitScenario('exit-off-uncaught-timer');
        assertCall(run.result.init, false, 'initSandbox (lockdown off)');
        assert.deepEqual(run.result.listenersAfterInit, run.result.listenersBeforeImport);
        assert.equal(run.status, 1, describeRun(run));
        assert.match(run.stderr, /boom-timer-off/, 'Node printed the error itself');
        assert.deepEqual(linesStartingWith(run.stderr, 'Uncaught exception: '), [], describeRun(run));
    });
});

describe('Amendment 1 acceptance scenarios (one child process each)', () => {
    test('1. lockdown on: console.error("x", new Error("boom")) writes text that contains "boom" and a stack line starting with "at "', () => {
        const facts = runScenario('accept-1-console-error');
        assertCall(facts.init, true, 'initSandbox');
        const text = outputOf(facts.output);
        assert.match(text, /boom/);
        assert.ok(hasStackLine(text), JSON.stringify(text));
        assert.ok(facts.output.stderr.startsWith('x Error: boom'), `written to stderr as "x" + formatError(error): ${JSON.stringify(text)}`);
    });

    const KINDS = [
        ['an Error', 'Error', ['boom-plain']],
        ['a TypeError', 'TypeError', ['TypeError', 'boom-type']],
        ['a subclass of Error with its own name', 'subclass', ['CustomBoomError', 'boom-subclass']],
        ['an error thrown inside a compartment', 'compartment', ['boom-compartment']],
    ];
    for (const [label, kind, needles] of KINDS) {
        test(`2. lockdown on: console.log, info, warn, error and debug print message and stack of ${label}`, () => {
            const facts = runScenario('accept-2-methods-and-kinds');
            assertCall(facts.init, true, 'initSandbox');
            for (const m of CONSOLE_METHODS) {
                const text = outputOf(facts.outputs[m][kind]);
                for (const needle of needles) assert.ok(text.includes(needle), `console.${m}: "${needle}" missing in ${JSON.stringify(text)}`);
                assert.ok(hasStackLine(text), `console.${m}: no stack line in ${JSON.stringify(text)}`);
            }
        });
    }

    test('3. lockdown on: an error with a cause prints both messages and "Caused by: ", in that order', () => {
        const facts = runScenario('accept-3-cause');
        assertCall(facts.init, true, 'initSandbox');
        const text = outputOf(facts.output);
        const outer = text.indexOf('outer-msg');
        const causedBy = text.indexOf('Caused by: ');
        const inner = text.indexOf('inner-msg');
        assert.ok(outer >= 0 && causedBy >= 0 && inner >= 0, JSON.stringify(text));
        assert.ok(outer < causedBy && causedBy < inner, JSON.stringify(text));
    });

    test('4. lockdown on: a non-error argument is passed through unchanged (an object is still printed as an object)', () => {
        const facts = runScenario('accept-4-non-error');
        assertCall(facts.init, true, 'initSandbox');
        const printed = outputOf(facts.object.output);
        assert.equal(printed, facts.object.expected);
        assert.match(printed, /alpha: 1/);
        assert.ok(!printed.includes('[object Object]'), printed);
    });

    test('4. (more) format strings, arrays and primitives print exactly as Node prints them without the wrapper', () => {
        const facts = lockedScenario('accept-4-non-error');
        for (const key of ['formatString', 'array', 'primitives']) {
            assert.equal(outputOf(facts[key].output), facts[key].expected, key);
        }
    });

    test('5. lockdown on: an exception thrown from a timer callback ends the process with exit code 1; stderr contains "Uncaught exception: " and the message', () => {
        const run = runExitScenario('exit-uncaught-timer');
        assertCall(run.result.init, true, 'initSandbox (lockdown on)');
        assert.equal(run.status, 1, describeRun(run));
        const reports = linesStartingWith(run.stderr, 'Uncaught exception: ');
        assert.equal(reports.length, 1, `one report\n${describeRun(run)}`);
        assert.match(reports[0], /boom-timer/);
    });

    test('6. lockdown on: a rejected promise without a handler ends the process with exit code 1; stderr contains "Unhandled rejection: " and the message', () => {
        const run = runExitScenario('exit-unhandled-rejection');
        assertCall(run.result.init, true, 'initSandbox (lockdown on)');
        assert.equal(run.status, 1, describeRun(run));
        const reports = linesStartingWith(run.stderr, 'Unhandled rejection: ');
        assert.equal(reports.length, 1, `one report\n${describeRun(run)}`);
        assert.match(reports[0], /boom-rejection/);
    });

    test('7. lockdown off: console methods are identical (===) to those before initSandbox, listener counts unchanged', () => {
        const facts = runScenario('accept-7-lockdown-off');
        for (const init of facts.inits) assertCall(init, false, `initSandbox(${init.settings})`);
        assert.equal(facts.locked, false);
        assert.deepEqual(facts.consoleUnchanged, ALL_TRUE);
        assert.deepEqual(facts.listenersAfter, facts.listenersBefore);
    });

    test('8. initSandbox called three times: one log line in total (on the first call)', () => {
        const facts = runScenario('twice');
        const perCall = [facts.first, facts.second, facts.third].map((c) => c.logLines);
        assert.deepEqual(perCall, [1, 0, 0], JSON.stringify([facts.first, facts.second, facts.third].map(outputOf)));
        assert.equal(facts.lockdownAgain.logLines, 0, 'a later lockdown() logs nothing either');
    });
});

describe('Amendment 2 acceptance, B1 (child process, real lockdown, real console, output piped to the parent)', () => {
    // The same marker lines as in tests/fixtures/sandbox_scenario.js.
    const B1_BEGIN = 'B1-OUTPUT-BEGIN';
    const B1_END = 'B1-OUTPUT-END';
    // The text of one stream between the marker lines, line breaks normalised to LF.
    function betweenMarkers(streamText, label) {
        const text = norm(streamText);
        const begin = text.indexOf(`${B1_BEGIN}\n`);
        const end = begin < 0 ? -1 : text.indexOf(B1_END, begin);
        assert.ok(begin >= 0 && end > begin, `${label}: marker lines missing in ${JSON.stringify(text)}`);
        return text.slice(begin + B1_BEGIN.length + 1, end);
    }
    function acceptanceRun() {
        lockedScenario('accept-b1-percent');
        return runOnce('accept-b1-percent');
    }

    test('console.log(new Error("disk 100%done"), "extra-arg") writes text that contains "disk 100%done" and "extra-arg"', () => {
        const printed = betweenMarkers(acceptanceRun().stdout, 'stdout');
        assert.ok(printed.includes('disk 100%done'), JSON.stringify(printed));
        assert.ok(printed.includes('extra-arg'), JSON.stringify(printed));
        assert.ok(!printed.includes('NaN'), `no format directive was applied to the error text: ${JSON.stringify(printed)}`);
        assert.ok(hasStackLine(printed), `the stack is printed: ${JSON.stringify(printed)}`);
    });

    test("the printed line is formatError(error), a space and \"extra-arg\": what Node prints for the arguments '%s', formatError(err), 'extra-arg'", () => {
        const run = acceptanceRun();
        assert.equal(betweenMarkers(run.stdout, 'stdout'), `${norm(run.result.formatted.log)} extra-arg\n`);
    });

    test('the same for console.error(new Error("disk 100%done"), "extra-arg") on standard error', () => {
        const run = acceptanceRun();
        const printed = betweenMarkers(run.stderr, 'stderr');
        assert.ok(printed.includes('disk 100%done') && printed.includes('extra-arg'), JSON.stringify(printed));
        assert.equal(printed, `${norm(run.result.formatted.error)} extra-arg\n`);
    });
});

describe('A3 initSandbox(settings)', () => {
    test('return value: isLockedDown() after the attempt when lockdown was requested (true after success)', () => {
        const facts = runScenario('escape');
        assertCall(facts.init, true, 'initSandbox');
        assert.equal(facts.locked, true);
    });

    test('SES lockdown throws: the same error propagates to the caller and isLockedDown() stays false', () => {
        const facts = runScenario('lockdown-throws');
        assert.equal(facts.lockdownCalls.length, 1, 'the SES global was called');
        assert.equal(facts.init.threw, true, 'initSandbox threw');
        assert.equal(facts.init.error.message, 'simulated SES lockdown failure');
        assert.equal(facts.propagatedSameError, true, 'the very error thrown by SES reaches the caller');
        assert.equal(facts.locked, false);
        assert.equal(facts.frozen, false);
    });

    test('SES lockdown throws: no console wrapper and no process listener is installed', () => {
        const facts = runScenario('lockdown-throws');
        assert.equal(facts.lockdownCalls.length, 1, 'precondition: the (failing) SES global was called');
        assert.equal(facts.propagatedSameError, true, 'precondition: initSandbox threw the SES error');
        assert.deepEqual(facts.consoleUnchanged, ALL_TRUE);
        assert.deepEqual(facts.listenersAfter, facts.listenersBefore);
    });

    test('logging: one line on the first call, later calls log nothing whatever their arguments (off, off, off)', () => {
        const { inits } = runScenario('log-three-off');
        assert.deepEqual(inits.map((i) => [i.value, i.logLines]), [[false, 1], [false, 0], [false, 0]], JSON.stringify(inits.map(outputOf)));
    });

    test('logging: one line on the first call, later calls log nothing whatever their arguments (off, then on, on)', () => {
        const facts = runScenario('log-off-then-on');
        assert.deepEqual(facts.inits.map((i) => [i.value, i.logLines]), [[false, 1], [true, 0], [true, 0]], JSON.stringify(facts.inits.map(outputOf)));
        assert.equal(facts.locked, true);
        assert.equal(facts.frozen, true);
    });

    test('logging: one line on the first call, later calls log nothing whatever their arguments (on, then off, insecure off)', () => {
        const { inits } = runScenario('log-on-then-off');
        assert.deepEqual(inits.map((i) => [i.value, i.logLines]), [[true, 1], [false, 0], [false, 0]], JSON.stringify(inits.map(outputOf)));
    });

    test('after a successful lockdown, a call with sandbox_lockdown: false returns false but isLockedDown() remains true', () => {
        const facts = runScenario('later-off');
        assertCall(facts.first, true, 'first initSandbox (on)');
        assertCall(facts.laterOff, false, 'initSandbox({allow_insecure_coding: true, sandbox_lockdown: false})');
        assertCall(facts.laterInsecureOff, false, 'initSandbox({allow_insecure_coding: false})');
        assert.equal(facts.locked, true);
        assert.equal(facts.lockdownCalls.length, 1);
    });

    test('a later call can never undo a lockdown: intrinsics stay frozen, wrappers and listeners stay', () => {
        const facts = runScenario('later-off');
        assert.equal(facts.frozen, true);
        assert.deepEqual(facts.consoleUnchangedByLaterCalls, ALL_TRUE);
        assert.deepEqual(facts.listenersAfterFirst, plusOne(facts.listenersBeforeImport));
        assert.deepEqual(facts.listenersAfterAll, facts.listenersAfterFirst);
    });
});

describe('call sites (source inspection)', () => {
    // Body of a class method: from its signature to the next member at class indentation.
    function methodBody(relPath, signature) {
        const src = fs.readFileSync(repoPath(relPath), 'utf8').replace(/\r\n/g, '\n');
        const start = src.search(signature);
        assert.ok(start >= 0, `${signature} not found in ${relPath}`);
        const rest = src.slice(start);
        const firstNewline = rest.indexOf('\n');
        const next = rest.slice(firstNewline).search(/\n {4}(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{[ \t]*\n/);
        return next < 0 ? rest : rest.slice(0, firstNewline + next);
    }

    function importsInitSandbox(relPath) {
        const src = fs.readFileSync(repoPath(relPath), 'utf8');
        return /import\s*\{[^}]*\binitSandbox\b[^}]*\}\s*from\s*['"]\.\/library\/lockdown\.js['"]/.test(src);
    }

    test('agent.js imports initSandbox from ./library/lockdown.js', () => {
        assert.ok(importsInitSandbox('src/agent/agent.js'));
    });

    test('agent.js start(): initSandbox(settings) runs before any component is constructed and before initBot', () => {
        const body = methodBody('src/agent/agent.js', /async start\s*\(/);
        const call = body.indexOf('initSandbox(settings)');
        assert.ok(call >= 0, 'start() calls initSandbox(settings)');
        const firstNew = body.search(/\bnew\s+[A-Z]/);
        const initBot = body.indexOf('initBot(');
        assert.ok(firstNew < 0 || call < firstNew, 'before the first `new ...`');
        assert.ok(initBot < 0 || call < initBot, 'before initBot(');
        const firstAwait = body.search(/\bawait\b/);
        assert.ok(firstAwait < 0 || call < firstAwait, 'before the first await');
    });

    test('coder.js imports initSandbox from ./library/lockdown.js', () => {
        assert.ok(importsInitSandbox('src/agent/coder.js'));
    });

    test('coder.js generateCode(): the lockdown() call became initSandbox(settings)', () => {
        const body = methodBody('src/agent/coder.js', /async generateCode\s*\(/);
        assert.ok(body.includes('initSandbox(settings)'), 'generateCode calls initSandbox(settings)');
        assert.doesNotMatch(body, /(^|[^\w.$])lockdown\s*\(/, 'no direct lockdown() call left');
    });
});
