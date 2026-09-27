// Child-process fixture for tests/unit/sandbox.test.js (spec S5, Amendment 1, A1 to A3, and
// Amendment 2, B1).
//
// SES lockdown is global and permanent, so every scenario runs in its own Node process:
//     node tests/fixtures/sandbox_scenario.js <scenario>
// The script only gathers FACTS and prints them as one line "RESULT <json>" on stdout;
// all assertions live in the test file. Exit code 0 when the scenario ran to the end,
// 2 for an unknown scenario, 3 when the fixture itself crashed.
//
// Scenarios whose name starts with "exit-" print their RESULT line first and then end the
// process on purpose (uncaught exception, unhandled rejection, process.exit(0)). The test
// asserts on the exit code and on standard error of those runs.
//
// Output is observed at the stream level (process.stdout.write / process.stderr.write) and
// never by swapping console methods around a call: since Amendment 1, lockdown() installs
// console wrappers (A2), and a temporary console replacement would remove them again.
import path from 'node:path';
import util from 'node:util';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const LOCKDOWN_URL = pathToFileURL(path.join(repoRoot, 'src', 'agent', 'library', 'lockdown.js')).href;

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'];
const ON = Object.freeze({ allow_insecure_coding: true, sandbox_lockdown: true });
const OFF = Object.freeze({ allow_insecure_coding: true, sandbox_lockdown: false });
const INSECURE_OFF = Object.freeze({ allow_insecure_coding: false, sandbox_lockdown: true });

// Scenarios that replace the console methods by recording stubs BEFORE anything is imported,
// so the wrappers of A2 wrap the stubs: every call that reaches "the original method" is
// recorded with its exact arguments, and the stub returns a known value.
const STUB_CONSOLE_SCENARIOS = new Set(['wrappers', 'b1-rows']);
// Scenarios in which the SES global lockdown throws instead of locking down (A3 fail path).
const FAILING_LOCKDOWN_SCENARIOS = new Set(['lockdown-throws']);

// Amendment 2, B1 acceptance: marker lines around the output of the calls under test on the
// real stdout and stderr. tests/unit/sandbox.test.js uses the same two strings.
const B1_BEGIN = 'B1-OUTPUT-BEGIN';
const B1_END = 'B1-OUTPUT-END';

// "Error detection" of A2: value instanceof Error, or Object.prototype.toString gives "[object Error]".
function isErrorLike(value) {
    return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
}

function emit(result) {
    process.stdout.write(`\nRESULT ${JSON.stringify(result)}\n`);
}

function describeError(err) {
    if (err instanceof Error) return { name: err.name, message: err.message, code: err.code ?? null };
    return { name: typeof err, message: String(err), code: null };
}

function countLines(text) {
    if (text === '') return 0;
    return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

// Temporarily replaces write() of one stream; returns a function that restores it.
function interceptWrite(stream, sink) {
    const hadOwn = Object.prototype.hasOwnProperty.call(stream, 'write');
    const previous = stream.write;
    stream.write = function interceptedWrite(chunk) {
        sink.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
    };
    return () => {
        if (hadOwn) stream.write = previous;
        else delete stream.write;
    };
}

// Calls fn (synchronously) while recording everything written to stdout and stderr.
// Returns { value, threw, error, stdout, stderr, logLines }.
function captureOutput(fn) {
    const out = [];
    const err = [];
    const restoreOut = interceptWrite(process.stdout, out);
    const restoreErr = interceptWrite(process.stderr, err);
    let value = null;
    let threw = false;
    let error = null;
    try {
        value = fn();
    } catch (e) {
        threw = true;
        error = describeError(e);
    } finally {
        restoreErr();
        restoreOut();
    }
    const stdout = out.join('');
    const stderr = err.join('');
    return { value: value === undefined ? null : value, threw, error, stdout, stderr, logLines: countLines(stdout) + countLines(stderr) };
}

function consoleSnapshot() {
    return Object.fromEntries(CONSOLE_METHODS.map((m) => [m, console[m]]));
}

// Per console method: true when the function is the same object (===) in both snapshots.
function sameConsole(a, b) {
    return Object.fromEntries(CONSOLE_METHODS.map((m) => [m, a[m] === b[m]]));
}

function listenerCounts() {
    return {
        uncaughtException: process.listenerCount('uncaughtException'),
        unhandledRejection: process.listenerCount('unhandledRejection'),
    };
}

function tryEval(compartment, source) {
    try {
        return { threw: false, value: compartment.evaluate(source), error: null };
    } catch (err) {
        return { threw: true, value: null, error: describeError(err) };
    }
}

// Exit scenarios: keeps the event loop busy, so the process ends early only when something
// ENDS it (A2: the listener "ends the process with exit code 1"). A listener that only
// reports, or only sets process.exitCode, lets this timer fire: exit code 99 and a marker on
// stderr. The 0 ms timer and the rejected promise of a scenario always come before it.
const NOT_ENDED_EXIT_CODE = 99;
function keepAliveUntilEnded() {
    setTimeout(() => {
        process.stderr.write('\nFIXTURE: the process was not ended by a listener\n');
        process.exit(NOT_ENDED_EXIT_CODE);
    }, 5000);
}

function isFrozenRealm() {
    return Object.isFrozen(Array.prototype) && Object.isFrozen(Object.prototype) && Object.isFrozen(Function.prototype);
}

function installConsoleStubs(stubCalls) {
    for (const m of CONSOLE_METHODS) {
        console[m] = function recordingStub(...args) {
            stubCalls.push({ method: m, args });
            return `returned-by-${m}`;
        };
    }
}

async function main() {
    const scenario = process.argv[2];

    const stubCalls = [];
    if (STUB_CONSOLE_SCENARIOS.has(scenario)) installConsoleStubs(stubCalls);

    // Load SES first and wrap its global lockdown with a spy BEFORE lockdown.js is imported,
    // so the spy sees every call however lockdown.js reaches globalThis.lockdown.
    await import('ses');
    const lockdownCalls = [];
    const lockdownOptionKeys = [];
    const simulatedFailure = FAILING_LOCKDOWN_SCENARIOS.has(scenario) ? new Error('simulated SES lockdown failure') : null;
    const installSpy = () => {
        const real = globalThis.lockdown;
        // An arrow function on purpose: it has no `prototype` property. SES checks the global
        // `lockdown` against its permits and prints "Removing unpermitted intrinsics" warnings
        // to stderr for a spy with a prototype, which would count as log lines.
        const spy = (...args) => {
            lockdownCalls.push(JSON.parse(JSON.stringify(args)));
            // JSON drops keys whose value is undefined; the key list shows every own key.
            lockdownOptionKeys.push(args[0] !== null && typeof args[0] === 'object' ? Object.keys(args[0]) : null);
            if (simulatedFailure) throw simulatedFailure;
            return real(...args);
        };
        globalThis.lockdown = spy;
        return spy;
    };
    const spyBeforeImport = installSpy();

    const consoleBeforeImport = consoleSnapshot();
    const listenersBeforeImport = listenerCounts();
    const mod = await import(LOCKDOWN_URL);
    // If importing lockdown.js re-installed the SES global, wrap the new one as well.
    if (globalThis.lockdown !== spyBeforeImport && typeof globalThis.lockdown === 'function') installSpy();
    const exportsInfo = {
        exports: Object.keys(mod).sort(),
        lockdownType: typeof mod.lockdown,
        isLockedDownType: typeof mod.isLockedDown,
        initSandboxType: typeof mod.initSandbox,
        makeCompartmentType: typeof mod.makeCompartment,
        formatErrorType: typeof mod.formatError,
        installErrorReportingType: typeof mod.installErrorReporting,
    };
    const lockedNow = () => (typeof mod.isLockedDown === 'function' ? mod.isLockedDown() : 'isLockedDown is not a function');
    const initSandbox = (settings) => captureOutput(() => mod.initSandbox(settings));
    const formatError = (value) => (typeof mod.formatError === 'function' ? mod.formatError(value) : 'formatError is not a function');

    // Wrapper scenario: how each argument that reached the original relates to what was sent.
    const describeArgs = (received, sent) => ({
        length: received.length,
        items: received.map((r, i) => ({
            type: typeof r,
            sameRef: Object.is(r, sent[i]),
            formatted: typeof r === 'string' && r === formatError(sent[i]),
            text: typeof r === 'string' ? r : null,
        })),
    });

    // Amendment 2, B1: describes the arguments that reached the original method independently of
    // their positions, because B1 inserts '%s' in front. One token per received argument:
    //   { sent: i }           the very value that was sent at position i (Object.is)
    //   { formatErrorOf: i }  exactly the string formatError(sent[i]) of the error sent at position i
    //   { string: text }      any other string, for example the inserted '%s'
    //   { other: type }       anything else
    const argumentTokens = (received, sent) => received.map((r) => {
        const same = sent.findIndex((s) => Object.is(r, s));
        if (same >= 0) return { sent: same };
        if (typeof r === 'string') {
            const of = sent.findIndex((s) => isErrorLike(s) && r === formatError(s));
            return of >= 0 ? { formatErrorOf: of } : { string: r };
        }
        return { other: typeof r };
    });
    // Stub scenarios: calls console[method](...sent) once and describes what reached the stub.
    const recordCall = (method, sent) => {
        stubCalls.length = 0;
        const returned = console[method](...sent);
        const args = stubCalls.length === 1 ? stubCalls[0].args : null;
        return {
            calls: stubCalls.map((c) => c.method),
            returned: returned === undefined ? null : returned,
            received: args === null ? null : argumentTokens(args, sent),
            texts: args === null ? null : args.map((a) => (typeof a === 'string' ? a : null)),
        };
    };

    const facts = { scenario, ...exportsInfo };
    facts.frozenAtStart = isFrozenRealm();
    facts.lockedAtStart = lockedNow();
    facts.importChangedConsole = CONSOLE_METHODS.filter((m) => consoleBeforeImport[m] !== console[m]);
    facts.listenersBeforeImport = listenersBeforeImport;
    facts.listenersAfterImport = listenerCounts();

    switch (scenario) {
        // S5.1 Lockdown on: compartment code cannot reach the host process object.
        case 'escape': {
            facts.init = initSandbox(ON);
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            facts.lockdownOptionKeys = lockdownOptionKeys;
            const c = mod.makeCompartment({});
            facts.functionConstructorEscape = tryEval(c, '[].constructor.constructor("return typeof process")()');
            facts.typeofProcess = tryEval(c, 'typeof process');
            facts.typeofGlobalProcess = tryEval(c, 'typeof globalThis.process');
            break;
        }

        // S5.2 Lockdown on: async arrow with a host promise, Math and Date.
        case 'async': {
            facts.init = initSandbox(ON);
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            const c = mod.makeCompartment({ fetchHostValue: () => Promise.resolve(41) });
            const fn = c.evaluate('(async () => { const v = await fetchHostValue(); return v + Math.max(0, 1) + new Date(0).getTime(); })');
            facts.awaited = await fn();
            facts.mathAndDate = tryEval(c, 'typeof Math.max === "function" && typeof Date.now === "function"');
            break;
        }

        // S5.3 Flag off: no lockdown, compartments still evaluate code.
        case 'flag-off': {
            facts.init = initSandbox(OFF);
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            const c = mod.makeCompartment({ fetchHostValue: () => Promise.resolve(41) });
            facts.simpleEval = tryEval(c, '1 + 2');
            const fn = c.evaluate('(async () => (await fetchHostValue()) + Math.max(0, 1))');
            facts.awaited = await fn();
            break;
        }

        // S5.4 allow_insecure_coding falsy: no lockdown, initSandbox returns false.
        case 'insecure-falsy': {
            const variants = [
                { allow_insecure_coding: false, sandbox_lockdown: true },
                { allow_insecure_coding: false },
                {},
                { allow_insecure_coding: 0, sandbox_lockdown: true },
                { allow_insecure_coding: '', sandbox_lockdown: true },
                { allow_insecure_coding: null, sandbox_lockdown: true },
                { allow_insecure_coding: undefined, sandbox_lockdown: true },
            ];
            facts.inits = variants.map((v) => ({ settings: JSON.stringify(v), ...initSandbox(v) }));
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            facts.simpleEval = tryEval(mod.makeCompartment(), '2 * 21');
            break;
        }

        // S5.5 initSandbox three times with lockdown on, then lockdown() again. Also A2 "Doing it
        // twice has no additional effect" and A3 / acceptance 8 (one log line in total).
        case 'twice': {
            const before = consoleSnapshot();
            facts.listenersBefore = listenerCounts();
            facts.first = initSandbox(ON);
            const afterFirst = consoleSnapshot();
            facts.listenersAfterFirst = listenerCounts();
            facts.second = initSandbox(ON);
            facts.third = initSandbox({ allow_insecure_coding: true });
            facts.lockdownAgain = captureOutput(() => mod.lockdown());
            facts.consoleUnchangedByFirst = sameConsole(before, afterFirst);
            facts.consoleUnchangedByLaterCalls = sameConsole(afterFirst, consoleSnapshot());
            facts.listenersAfterAll = listenerCounts();
            facts.oneErrorCall = captureOutput(() => console.error(new Error('appears-once')));
            if (typeof mod.installErrorReporting === 'function') {
                const beforeDirect = consoleSnapshot();
                facts.directInstall = captureOutput(() => mod.installErrorReporting());
                facts.consoleUnchangedByDirectInstall = sameConsole(beforeDirect, consoleSnapshot());
                facts.listenersAfterDirectInstall = listenerCounts();
            }
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            break;
        }

        // "An undefined flag counts as on."
        case 'undefined-flag': {
            facts.init = initSandbox({ allow_insecure_coding: true });
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            break;
        }

        // "settings.sandbox_lockdown !== false": only the boolean false switches it off.
        case 'flag-not-strictly-false': {
            facts.inits = [
                { allow_insecure_coding: true, sandbox_lockdown: null },
                { allow_insecure_coding: true, sandbox_lockdown: 0 },
                { allow_insecure_coding: 'yes', sandbox_lockdown: 'false' },
            ].map((v) => ({ settings: JSON.stringify(v), ...initSandbox(v) }));
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            break;
        }

        // lockdown(): the first call runs globalThis.lockdown with the A1 options and installs
        // the error reporting (A2); later calls do nothing.
        case 'lockdown-direct': {
            const before = consoleSnapshot();
            facts.listenersBefore = listenerCounts();
            facts.first = captureOutput(() => mod.lockdown());
            const afterFirst = consoleSnapshot();
            facts.listenersAfterFirst = listenerCounts();
            facts.second = captureOutput(() => mod.lockdown());
            facts.consoleUnchangedByFirst = sameConsole(before, afterFirst);
            facts.consoleUnchangedBySecond = sameConsole(afterFirst, consoleSnapshot());
            facts.listenersAfterSecond = listenerCounts();
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.afterwardsInit = initSandbox(ON);
            facts.lockdownCalls = lockdownCalls;
            facts.lockdownOptionKeys = lockdownOptionKeys;
            break;
        }

        // Importing lockdown.js alone must not lock anything down.
        case 'import-only': {
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            break;
        }

        // A2.1 console wrappers, observed through recording stubs that act as "the original".
        case 'wrappers': {
            const stubs = consoleSnapshot();
            facts.init = initSandbox(ON);
            facts.locked = lockedNow();
            facts.replaced = Object.fromEntries(CONSOLE_METHODS.map((m) => [m, typeof console[m] === 'function' && console[m] !== stubs[m]]));

            facts.returns = {};
            for (const m of CONSOLE_METHODS) {
                stubCalls.length = 0;
                facts.returns[m] = { returned: console[m]('return-check'), calls: stubCalls.map((c) => c.method) };
            }

            facts.perMethod = {};
            for (const m of CONSOLE_METHODS) {
                stubCalls.length = 0;
                const sent = ['lead', new Error(`error-for-${m}`)];
                console[m](...sent);
                facts.perMethod[m] = {
                    calls: stubCalls.map((c) => c.method),
                    received: describeArgs(stubCalls[0] ? stubCalls[0].args : [], sent),
                };
            }

            const e1 = new Error('first-error');
            const e2 = new TypeError('second-error');
            const nestedObject = { nested: e1 };
            const nestedArray = [e2];
            const duck = { name: 'Error', message: 'duck-typed', stack: 'Error: duck-typed\n    at nowhere (duck.js:1:1)' };
            const mixed = ['text-arg', e1, 42, nestedObject, e2, nestedArray, null, undefined, Symbol('sym-arg'), duck];
            stubCalls.length = 0;
            console.error(...mixed);
            const got = stubCalls[0] ? stubCalls[0].args : [];
            facts.mixed = {
                calls: stubCalls.map((c) => c.method),
                received: describeArgs(got, mixed),
                nestedObjectIntact: got[3] === nestedObject && nestedObject.nested === e1 && Object.keys(nestedObject).length === 1,
                nestedArrayIntact: got[5] === nestedArray && nestedArray.length === 1 && nestedArray[0] === e2,
            };

            const foreign = vm.runInNewContext('new RangeError("foreign-realm-error")');
            const tagged = { [Symbol.toStringTag]: 'Error', message: 'tagged', stack: 'TaggedError: tagged\n    at tagged (tagged.js:1:1)' };
            const errorLike = [foreign, tagged];
            // Amendment 2, B1: the first argument is an error, so '%s' is inserted in front and the
            // positions shift; described with position-independent tokens.
            facts.errorLike = { ...recordCall('warn', errorLike), foreignIsInstanceOfError: foreign instanceof Error };

            stubCalls.length = 0;
            console.log();
            facts.noArgs = { calls: stubCalls.map((c) => c.method), length: stubCalls[0] ? stubCalls[0].args.length : null };
            break;
        }

        // Amendment 2, B1: when the FIRST argument is an error the original method receives '%s' in
        // front of the arguments of A2; in every other case exactly the arguments of A2. The rows
        // of the B1 table, observed through the recording stubs.
        case 'b1-rows': {
            const stubs = consoleSnapshot();
            facts.init = initSandbox(ON);
            facts.locked = lockedNow();
            facts.replaced = Object.fromEntries(CONSOLE_METHODS.map((m) => [m, typeof console[m] === 'function' && console[m] !== stubs[m]]));
            // '%' in the messages: the formatted text must reach the original as it is.
            const err = new Error('b1 row err 100%done %s %d');
            const err1 = new Error('b1 row err1 50%off');
            const err2 = new TypeError('b1 row err2 %o');
            const failure = new Error('b1 row failed 10%d');
            facts.rows = {
                err: recordCall('log', [err]),
                errExtra: recordCall('log', [err, 'extra', 5]),
                twoErrors: recordCall('log', [err1, err2]),
                failed: recordCall('log', ['Failed:', failure]),
                formatD: recordCall('log', ['%d items', 3]),
                object: recordCall('log', [{ a: 1 }]),
                none: recordCall('log', []),
            };
            // The same rule in all five wrappers.
            facts.perMethod = Object.fromEntries(CONSOLE_METHODS.map((m) => [m, recordCall(m, [new Error(`b1 first ${m} 5%x`), 'tail-arg'])]));
            break;
        }

        // Amendment 2, B1 acceptance: the real console after the real lockdown, output piped to the
        // parent process (not intercepted here). The test reads the text between the markers.
        case 'accept-b1-percent': {
            facts.init = initSandbox(ON);
            const logged = new Error('disk 100%done');
            const errored = new Error('disk 100%done');
            facts.formatted = { log: formatError(logged), error: formatError(errored) };
            process.stdout.write(`\n${B1_BEGIN}\n`);
            console.log(logged, 'extra-arg');
            process.stdout.write(`${B1_END}\n`);
            process.stderr.write(`\n${B1_BEGIN}\n`);
            console.error(errored, 'extra-arg');
            process.stderr.write(`${B1_END}\n`);
            break;
        }

        // A3: a later call can never undo a lockdown.
        case 'later-off': {
            facts.first = initSandbox(ON);
            const afterFirst = consoleSnapshot();
            facts.listenersAfterFirst = listenerCounts();
            facts.laterOff = initSandbox(OFF);
            facts.laterInsecureOff = initSandbox(INSECURE_OFF);
            facts.consoleUnchangedByLaterCalls = sameConsole(afterFirst, consoleSnapshot());
            facts.listenersAfterAll = listenerCounts();
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            break;
        }

        // A3 fail path: the SES global lockdown throws.
        case 'lockdown-throws': {
            const before = consoleSnapshot();
            facts.listenersBefore = listenerCounts();
            let caught;
            facts.init = captureOutput(() => {
                try {
                    return mod.initSandbox(ON);
                } catch (err) {
                    caught = err;
                    throw err;
                }
            });
            facts.propagatedSameError = caught === simulatedFailure;
            facts.consoleUnchanged = sameConsole(before, consoleSnapshot());
            facts.listenersAfter = listenerCounts();
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            facts.lockdownCalls = lockdownCalls;
            break;
        }

        // Acceptance 1: console.error('x', new Error('boom')) with lockdown on.
        case 'accept-1-console-error': {
            facts.init = initSandbox(ON);
            facts.output = captureOutput(() => console.error('x', new Error('boom')));
            break;
        }

        // Acceptance 2: every console method, for an Error, a TypeError, a subclass of Error with
        // its own name and an error thrown inside a compartment.
        case 'accept-2-methods-and-kinds': {
            facts.init = initSandbox(ON);
            class CustomBoom extends Error {
                constructor(message) {
                    super(message);
                    this.name = 'CustomBoomError';
                }
            }
            const compartment = mod.makeCompartment({});
            const kinds = {
                Error: () => new Error('boom-plain'),
                TypeError: () => new TypeError('boom-type'),
                subclass: () => new CustomBoom('boom-subclass'),
                compartment: () => {
                    try {
                        compartment.evaluate('throw new Error("boom-compartment")');
                    } catch (err) {
                        return err;
                    }
                    return new Error('compartment did not throw');
                },
            };
            facts.outputs = {};
            for (const m of CONSOLE_METHODS) {
                facts.outputs[m] = {};
                for (const [kind, make] of Object.entries(kinds)) {
                    const err = make();
                    facts.outputs[m][kind] = captureOutput(() => console[m]('x', err));
                }
            }
            break;
        }

        // Acceptance 3: an error with a cause prints both messages and "Caused by: ".
        case 'accept-3-cause': {
            facts.init = initSandbox(ON);
            facts.output = captureOutput(() => console.error('x', new Error('outer-msg', { cause: new Error('inner-msg') })));
            break;
        }

        // Acceptance 4: non-error arguments are passed through unchanged.
        case 'accept-4-non-error': {
            facts.init = initSandbox(ON);
            const obj = { alpha: 1, nested: { beta: 'two' } };
            facts.object = { output: captureOutput(() => console.log('x', obj)), expected: `${util.format('x', obj)}\n` };
            facts.formatString = { output: captureOutput(() => console.log('%s and %d', 'str', 7)), expected: 'str and 7\n' };
            facts.array = { output: captureOutput(() => console.log([1, 2, 3])), expected: `${util.format([1, 2, 3])}\n` };
            facts.primitives = { output: captureOutput(() => console.info('x', null, undefined, 42, true)), expected: 'x null undefined 42 true\n' };
            break;
        }

        // Acceptance 7: lockdown off installs nothing.
        case 'accept-7-lockdown-off': {
            const before = consoleSnapshot();
            facts.listenersBefore = listenerCounts();
            facts.inits = [OFF, INSECURE_OFF, {}].map((v) => ({ settings: JSON.stringify(v), ...initSandbox(v) }));
            facts.consoleUnchanged = sameConsole(before, consoleSnapshot());
            facts.listenersAfter = listenerCounts();
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            break;
        }

        // Acceptance 8 / A3 logging, with arguments that differ between the three calls.
        case 'log-three-off': {
            facts.inits = [OFF, OFF, OFF].map((v) => ({ settings: JSON.stringify(v), ...initSandbox(v) }));
            facts.locked = lockedNow();
            break;
        }
        case 'log-off-then-on': {
            facts.inits = [OFF, ON, ON].map((v) => ({ settings: JSON.stringify(v), ...initSandbox(v) }));
            facts.locked = lockedNow();
            facts.frozen = isFrozenRealm();
            break;
        }
        case 'log-on-then-off': {
            facts.inits = [ON, OFF, INSECURE_OFF].map((v) => ({ settings: JSON.stringify(v), ...initSandbox(v) }));
            facts.locked = lockedNow();
            break;
        }

        // formatError after a real lockdown (the environment it is written for).
        case 'format-after-lockdown': {
            facts.init = initSandbox(ON);
            const withStack = new Error('after-lockdown');
            facts.withStack = { stack: withStack.stack, formatted: formatError(withStack) };
            const noStack = new Error('no-stack-after-lockdown');
            delete noStack.stack;
            facts.noStack = { stackType: typeof noStack.stack, string: String(noStack), formatted: formatError(noStack) };
            const chain = new Error('c0', { cause: new Error('c1', { cause: new Error('c2', { cause: new Error('c3', { cause: new Error('c4') }) }) }) });
            facts.chain = formatError(chain);
            facts.nullPrototype = formatError(Object.create(null));
            break;
        }

        // Acceptance 5, 6 and further exit codes: RESULT first, then the process ends.
        case 'exit-uncaught-timer': {
            facts.init = initSandbox(ON);
            facts.listenersAfterInit = listenerCounts();
            emit(facts);
            keepAliveUntilEnded();
            setTimeout(() => {
                throw new Error('boom-timer');
            }, 0);
            return;
        }
        case 'exit-unhandled-rejection': {
            facts.init = initSandbox(ON);
            facts.listenersAfterInit = listenerCounts();
            emit(facts);
            keepAliveUntilEnded();
            Promise.reject(new Error('boom-rejection'));
            return;
        }
        case 'exit-uncaught-non-error': {
            facts.init = initSandbox(ON);
            emit(facts);
            keepAliveUntilEnded();
            setTimeout(() => {
                throw 'thrown-plain-string';
            }, 0);
            return;
        }
        case 'exit-rejection-non-error': {
            facts.init = initSandbox(ON);
            emit(facts);
            keepAliveUntilEnded();
            Promise.reject('rejected-plain-string');
            return;
        }
        case 'exit-normal': {
            facts.init = initSandbox(ON);
            emit(facts);
            process.exit(0);
            return;
        }
        case 'exit-off-uncaught-timer': {
            facts.init = initSandbox(OFF);
            facts.listenersAfterInit = listenerCounts();
            emit(facts);
            keepAliveUntilEnded();
            setTimeout(() => {
                throw new Error('boom-timer-off');
            }, 0);
            return;
        }

        default:
            emit({ scenario, fixtureError: `unknown scenario ${scenario}` });
            process.exitCode = 2;
            return;
    }
    emit(facts);
}

main().catch((err) => {
    emit({ fixtureError: describeError(err), stack: err && err.stack ? String(err.stack) : null });
    process.exitCode = 3;
});
