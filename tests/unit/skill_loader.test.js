// Spec v0.1.4.4 K4: src/agent/skills/skill_loader.js -- loadSkills({ store, makeCompartment,
// endowments, instrument, onUse }) -> { customSkills, loaded, skipped }. Never throws.
//
// Uses the real makeCompartment of src/agent/library/lockdown.js WITHOUT calling the lockdown
// (importing lockdown.js only installs the SES globals), the real instrument of skill_source.js,
// and the fake endowments of spec K9 (tests/helpers/skill_env.js). Most tests use a small fake
// store (list, read); one test uses the real SkillStore in a temp directory.
// loadSkills is awaited: awaiting a plain return value changes nothing.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeEndowments, makeBot, fnSource } from '../helpers/skill_env.js';
import { assertSkillModuleImports } from '../helpers/source_ast.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/skills/skill_loader.js';
const L = await loadSrc(MODULE);
const SRC = await loadSrc('src/agent/skills/skill_source.js');
const STORE = await loadSrc('src/agent/skills/skill_store.js');
const LOCK = await loadSrc('src/agent/library/lockdown.js');

let cap;
beforeEach(() => {
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
});

// skills: [{ name, source, status }] in the order list() returns them.
function fakeStore(skills) {
    return {
        reads: [],
        list() {
            return skills.map((s) => ({ name: s.name, status: s.status ?? 'active', signature: `${s.name}(bot)`, description: '' }));
        },
        read(name) {
            this.reads.push(name);
            const s = skills.find((x) => x.name === name);
            return s && typeof s.source === 'string' ? s.source : null;
        },
    };
}

async function load(skills, options = {}) {
    const uses = [];
    const endowments = options.endowments ?? makeEndowments();
    const result = await L.loadSkills({
        store: options.store ?? fakeStore(skills),
        makeCompartment: options.makeCompartment ?? LOCK.makeCompartment,
        endowments,
        instrument: options.instrument ?? SRC.instrument,
        onUse: 'onUse' in options ? options.onUse : (name, info) => uses.push([name, info]),
        ...('check' in options ? { check: options.check } : {}),
    });
    return { ...result, uses, endowments };
}

const RETURNS_VALUE = fnSource('returnsValue', ['return value;'], 'bot, value');
const ECHO_ARGS = fnSource('echoArgs', ['return [bot.username, a, b].join("|");'], 'bot, a, b');
const THROWER = fnSource('thrower', ['throw err;'], 'bot, err');
const STOPPER = fnSource('stopper', ['bot.interrupt_code = true;', 'return false;']);
const INNER = fnSource('innerSkill', ['return 41;']);
const OUTER = fnSource('outerSkill', ['const inner = await customSkills.innerSkill(bot);', 'return inner + 1;']);

describe('loading', () => {
    test('every ACTIVE skill is loaded; loaded is the sorted list of names; disabled skills are left out', async () => {
        const { customSkills, loaded, skipped } = await load([
            { name: 'zetaSkill', source: fnSource('zetaSkill', ['return "z";']) },
            { name: 'returnsValue', source: RETURNS_VALUE },
            { name: 'offSkill', source: fnSource('offSkill', ['return "off";']), status: 'disabled' },
            { name: 'echoArgs', source: ECHO_ARGS },
        ]);
        assert.deepEqual(loaded, ['echoArgs', 'returnsValue', 'zetaSkill']);
        assert.deepEqual(skipped, []);
        assert.deepEqual(Object.keys(customSkills).sort(), ['echoArgs', 'returnsValue', 'zetaSkill']);
        for (const name of loaded) assert.equal(typeof customSkills[name], 'function', name);
        assert.equal(customSkills.offSkill, undefined);
    });

    test('customSkills is frozen', async () => {
        const { customSkills } = await load([{ name: 'returnsValue', source: RETURNS_VALUE }]);
        assert.equal(Object.isFrozen(customSkills), true);
        assert.throws(() => {
            customSkills.extra = () => 1;
        }, TypeError);
        assert.throws(() => {
            customSkills.returnsValue = null;
        }, TypeError);
    });

    test('a skill cannot replace another skill from inside the sandbox', async () => {
        const vandal = fnSource('vandal', ['try { customSkills.victim = null; } catch (e) { }', 'return typeof customSkills.victim;']);
        const victim = fnSource('victim', ['return true;']);
        const { customSkills } = await load([{ name: 'vandal', source: vandal }, { name: 'victim', source: victim }]);
        assert.equal(await customSkills.vandal(makeBot()), 'function');
        assert.equal(typeof customSkills.victim, 'function');
    });

    test('ONE compartment for all skills, with the endowments plus customSkills (the returned object)', async () => {
        const calls = [];
        const spy = (endowments) => {
            calls.push(endowments);
            return LOCK.makeCompartment(endowments);
        };
        const { customSkills, endowments } = await load([
            { name: 'returnsValue', source: RETURNS_VALUE },
            { name: 'echoArgs', source: ECHO_ARGS },
        ], { makeCompartment: spy });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].customSkills, customSkills);
        for (const key of ['skills', 'world', 'Vec3', 'log']) assert.equal(calls[0][key], endowments[key], key);
    });

    test('instrument is applied to store.read(name)', async () => {
        const seen = [];
        const instrument = (source) => {
            seen.push(source);
            return SRC.instrument(source);
        };
        const chatty = fnSource('chatty', ['console.log("hello from the skill");', 'return true;']);
        const { customSkills } = await load([{ name: 'chatty', source: chatty }], { instrument });
        assert.deepEqual(seen, [chatty]);
        const bot = makeBot();
        assert.equal(await customSkills.chatty(bot), true);
        assert.equal(bot.output, 'hello from the skill\n', 'console.log( became log(bot, ...)');
    });

    test('the endowments are reachable from a skill', async () => {
        const source = fnSource('useEndowments', [
            'await skills.wait(bot, 1);',
            'const v = new Vec3(1, 2, 3);',
            'log(bot, "vec " + v.x + v.y + v.z);',
            'return typeof world;',
        ]);
        const { customSkills } = await load([{ name: 'useEndowments', source }]);
        const bot = makeBot();
        assert.equal(await customSkills.useEndowments(bot), 'object');
        assert.equal(bot.output, 'vec 123\n');
    });

    test('skills can call each other through customSkills.<other>', async () => {
        const { customSkills, uses } = await load([{ name: 'outerSkill', source: OUTER }, { name: 'innerSkill', source: INNER }]);
        assert.equal(await customSkills.outerSkill(makeBot()), 42);
        assert.deepEqual(uses.map(([name, info]) => [name, info.ok]).sort(), [['innerSkill', true], ['outerSkill', true]]);
    });

    test('a skill cannot reach process, require or globalThis.process', async () => {
        const probe = fnSource('probe', ['return [typeof process, typeof require, typeof globalThis.process].join(",");']);
        const { customSkills } = await load([{ name: 'probe', source: probe }]);
        assert.equal(await customSkills.probe(makeBot()), 'undefined,undefined,undefined');
    });

    test('works with the real SkillStore in a temp directory', async () => {
        const root = makeTmpDir();
        try {
            const store = new STORE.SkillStore(path.join(root, 'skills'), { now: () => new Date(Date.UTC(2026, 8, 28)) });
            store.load();
            store.save({ name: 'innerSkill', source: INNER, description: 'Inner.', signature: 'innerSkill(bot)', sourceTask: 't' });
            store.save({ name: 'outerSkill', source: OUTER, description: 'Outer.', signature: 'outerSkill(bot)', sourceTask: 't' });
            const { customSkills, loaded, skipped } = await load(null, { store });
            assert.deepEqual(loaded, ['innerSkill', 'outerSkill']);
            assert.deepEqual(skipped, []);
            assert.equal(await customSkills.outerSkill(makeBot()), 42);
        } finally {
            removeTmpDir(root);
        }
    });
});

describe('the wrapper in customSkills', () => {
    test('calls the skill with the same arguments and returns its result', async () => {
        const { customSkills } = await load([{ name: 'echoArgs', source: ECHO_ARGS }]);
        assert.equal(await customSkills.echoArgs(makeBot(), 1, 'x'), 'andy|1|x');
    });

    test('is an async function: returns a promise', async () => {
        const { customSkills } = await load([{ name: 'returnsValue', source: RETURNS_VALUE }]);
        const pending = customSkills.returnsValue(makeBot(), 1);
        assert.equal(typeof pending?.then, 'function');
        assert.equal(await pending, 1);
    });

    const OK_CASES = [['true', true, true], ['undefined', undefined, true], ['0', 0, true], ['null', null, true], ["'false'", 'false', true], ['exactly false', false, false]];
    for (const [label, value, ok] of OK_CASES) {
        test(`result ${label}: onUse(name, { ok: ${ok} })`, async () => {
            const { customSkills, uses } = await load([{ name: 'returnsValue', source: RETURNS_VALUE }]);
            assert.equal(await customSkills.returnsValue(makeBot(), value), value);
            assert.equal(uses.length, 1);
            assert.equal(uses[0][0], 'returnsValue');
            assert.equal(uses[0][1].ok, ok);
            assert.equal(uses[0][1].error, undefined);
        });
    }

    test('a throw: onUse(name, { ok: false, error: String(error) }) and the SAME error is thrown on', async () => {
        const { customSkills, uses } = await load([{ name: 'thrower', source: THROWER }]);
        const err = new Error('boom');
        await assert.rejects(customSkills.thrower(makeBot(), err), (e) => e === err);
        assert.deepEqual(uses, [['thrower', { ok: false, error: String(err) }]]);
    });

    test('a thrown non-Error value is thrown on as well', async () => {
        const { customSkills, uses } = await load([{ name: 'thrower', source: THROWER }]);
        await assert.rejects(customSkills.thrower(makeBot(), 'plain text $&'), (e) => e === 'plain text $&');
        assert.deepEqual(uses, [['thrower', { ok: false, error: 'plain text $&' }]]);
    });

    test('an error thrown by the skill code itself', async () => {
        const source = fnSource('breaks', ['throw new Error("inner boom");']);
        const { customSkills, uses } = await load([{ name: 'breaks', source }]);
        await assert.rejects(customSkills.breaks(makeBot()), /inner boom/);
        assert.deepEqual(uses, [['breaks', { ok: false, error: 'Error: inner boom' }]]);
    });

    test('interrupted (the skill sets bot.interrupt_code): nothing is recorded; the instrumentation stops the skill', async () => {
        const { customSkills, uses } = await load([{ name: 'stopper', source: STOPPER }]);
        const bot = makeBot();
        await customSkills.stopper(bot);
        assert.deepEqual(uses, []);
        assert.ok(bot.output.includes('Code interrupted.'), bot.output);
    });

    test('interrupted (interrupt_code already set): nothing is recorded, even for result false', async () => {
        const { customSkills, uses } = await load([{ name: 'returnsValue', source: RETURNS_VALUE }]);
        await customSkills.returnsValue(makeBot({ interrupt_code: true }), false);
        assert.deepEqual(uses, []);
    });

    test('an error inside onUse is swallowed: the result still comes back', async () => {
        const onUse = () => {
            throw new Error('onUse broke');
        };
        const { customSkills } = await load([{ name: 'returnsValue', source: RETURNS_VALUE }], { onUse });
        assert.equal(await customSkills.returnsValue(makeBot(), 7), 7);
        assert.equal(await customSkills.returnsValue(makeBot(), false), false);
    });

    test('an error inside onUse is swallowed: a throwing skill still throws ITS error', async () => {
        const onUse = () => {
            throw new Error('onUse broke');
        };
        const { customSkills } = await load([{ name: 'thrower', source: THROWER }], { onUse });
        const err = new Error('skill error');
        await assert.rejects(customSkills.thrower(makeBot(), err), (e) => e === err);
    });

    test('no onUse given: the wrapper still works', async () => {
        const { customSkills } = await load([{ name: 'returnsValue', source: RETURNS_VALUE }], { onUse: undefined });
        assert.equal(await customSkills.returnsValue(makeBot(), 5), 5);
    });
});

describe('a broken skill is skipped, the others still load', () => {
    test('syntax error, wrong name, anonymous, not a function, sandbox rejection, missing source, throwing evaluation', async () => {
        const broken = [
            { name: 'syntaxError', source: 'async function syntaxError(bot) {\n    return (;\n}\n' },
            { name: 'wrongName', source: fnSource('otherName', ['return 1;']) },
            { name: 'anonymous', source: 'async function (bot) {\n    return 1;\n}\n' },
            { name: 'notFunction', source: '42\n' },
            { name: 'usesImport', source: fnSource('usesImport', ['return import("fs");']) },
            { name: 'htmlComment', source: fnSource('htmlComment', ['return 1; <!-- hidden']) },
            { name: 'missingSource' },
            { name: 'throwsOnEval', source: '(() => { throw new Error("evaluation failed"); })()\n' },
        ];
        const good = [
            { name: 'goodOne', source: fnSource('goodOne', ['return "one";']) },
            { name: 'goodTwo', source: fnSource('goodTwo', ['return "two";']) },
        ];
        let result;
        await assert.doesNotReject(async () => {
            result = await load([good[0], ...broken, good[1]]);
        });
        assert.deepEqual(result.loaded, ['goodOne', 'goodTwo']);
        assert.deepEqual(result.skipped.map((s) => s.name).sort(), broken.map((s) => s.name).sort());
        for (const s of result.skipped) assert.ok(s.error, `skipped ${s.name} has an error`);
        assert.equal(await result.customSkills.goodTwo(makeBot()), 'two');
        assert.equal(Object.isFrozen(result.customSkills), true);
    });

    test('instrument throwing for one skill skips only that skill', async () => {
        const instrument = (source) => {
            if (source.includes('badOne')) throw new Error('instrument failed');
            return SRC.instrument(source);
        };
        const result = await load([
            { name: 'badOne', source: fnSource('badOne', ['return 1;']) },
            { name: 'goodOne', source: fnSource('goodOne', ['return 2;']) },
        ], { instrument });
        assert.deepEqual(result.loaded, ['goodOne']);
        assert.deepEqual(result.skipped.map((s) => s.name), ['badOne']);
    });
});

// Amendment 2, B2: loading a skill runs no code. Two protections, tested separately:
//   1. the option `check` (the manager passes isSingleFunction): a text that is not one async
//      function declaration is skipped BEFORE it is evaluated;
//   2. without `check`: after evaluating all skills, the loader gives up if customSkills was changed.
// The hostile file is the reproduction of the end-to-end engineer (scratchpad/repro_loader.mjs):
// it closes the parenthesis of '(' + source + ')', runs code that adds and replaces members of
// customSkills, and still evaluates to a function with its own name.
describe('loading runs no code (Amendment 2, B2)', () => {
    const CHANGED = 'the skill library was changed while loading';
    const escape = (code) => `async function aaaSkill(bot) { return 1; }) && (${code}, true) && (async function aaaSkill(bot) { return 1; }`;
    const REPRO = escape('probe.ran = true, customSkills.bbbSkill = async function bbbSkill() { return "replaced"; }, customSkills.extra = async function extra() { return "extra"; }');
    const BBB = 'async function bbbSkill(bot) { return "original"; }';
    const CCC = fnSource('cccSkill', ['return "c";']);
    const hostile = (source) => [{ name: 'aaaSkill', source }, { name: 'bbbSkill', source: BBB }, { name: 'cccSkill', source: CCC }];
    const withProbe = () => {
        const probe = { ran: false };
        return { probe, endowments: { ...makeEndowments(), probe } };
    };

    test('precondition: without any protection the reproduction runs code at load time', async () => {
        // the loader of round 1 as the reproduction ran it: no check, identity instrument
        const { probe, endowments } = withProbe();
        await load(hostile(REPRO), { endowments, instrument: (s) => s });
        assert.equal(probe.ran, true, 'the hostile code ran while loading');
    });

    describe('protection 1: the option check', () => {
        test('the hostile file is skipped with "not a single function" before it runs; the other skills load', async () => {
            const { probe, endowments } = withProbe();
            const result = await load(hostile(REPRO), { endowments, check: SRC.isSingleFunction });
            assert.equal(probe.ran, false, 'no code of the hostile file ran');
            assert.deepEqual(result.loaded, ['bbbSkill', 'cccSkill']);
            assert.deepEqual(result.skipped, [{ name: 'aaaSkill', error: 'not a single function' }]);
            assert.equal(await result.customSkills.bbbSkill(makeBot()), 'original');
            assert.equal(result.customSkills.extra, undefined);
            assert.ok(Object.isFrozen(result.customSkills));
        });

        test('check gets the name and the text after instrument, the text that is evaluated', async () => {
            const calls = [];
            const check = (name, text) => {
                calls.push([name, text]);
                return SRC.isSingleFunction(name, text);
            };
            const chatty = fnSource('chatty', ['console.log("hi");', 'return true;']);
            const result = await load([{ name: 'chatty', source: chatty }], { check });
            assert.deepEqual(calls, [['chatty', SRC.instrument(chatty)]]);
            assert.deepEqual(result.loaded, ['chatty']);
        });

        for (const [label, check] of [
            ['returns false', () => false],
            ['throws', () => { throw new Error('check broke'); }],
            ['returns something other than true', () => 'yes'],
        ]) {
            test(`check ${label}: the skill is skipped with "not a single function" and not evaluated`, async () => {
                let evaluated = 0;
                const makeCompartment = (e) => {
                    const c = LOCK.makeCompartment(e);
                    // v0.1.4.5, G4: the fake passes the global object through, so the library can be protected
                    return { evaluate: (src) => { evaluated++; return c.evaluate(src); }, globalThis: c.globalThis };
                };
                const result = await load([{ name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }], { check, makeCompartment });
                assert.deepEqual(result.loaded, []);
                assert.deepEqual(result.skipped, [{ name: 'goodOne', error: 'not a single function' }]);
                assert.equal(evaluated, 0);
            });
        }
    });

    describe('protection 2: without check, a changed library makes the loader give up', () => {
        const CASES = [
            ['the reproduction adds and replaces members', REPRO],
            ['it freezes customSkills', escape('Object.freeze(customSkills)')],
            ['it makes customSkills non-extensible', escape('Object.preventExtensions(customSkills)')],
            ['it adds a symbol member', escape('customSkills[Symbol.iterator] = 1')],
            ['it adds a member that is not enumerable', escape('Object.defineProperty(customSkills, "hidden", { value: 1 })')],
            ['it replaces the prototype of customSkills', escape('Object.setPrototypeOf(customSkills, { extra: async function extra() { return "extra"; } })')],
            // v0.1.4.5, G4: replacing, deleting or redefining the binding customSkills now throws while
            // the hostile file is evaluated; those three cases moved to the tests of G4 below.
        ];
        for (const [label, source] of CASES) {
            test(`${label}: a NEW frozen empty customSkills, loaded [], every active skill skipped, a warning`, async () => {
                const given = [];
                const makeCompartment = (e) => {
                    given.push(e.customSkills);
                    return LOCK.makeCompartment(e);
                };
                const skills = [...hostile(source), { name: 'offSkill', source: fnSource('offSkill', ['return 0;']), status: 'disabled' }];
                let result;
                await assert.doesNotReject(async () => {
                    result = await load(skills, { makeCompartment, endowments: withProbe().endowments });
                });
                assert.deepEqual(result.loaded, []);
                assert.deepEqual(result.skipped, ['aaaSkill', 'bbbSkill', 'cccSkill'].map((name) => ({ name, error: CHANGED })));
                assert.ok(Object.isFrozen(result.customSkills));
                assert.deepEqual(Reflect.ownKeys(result.customSkills), []);
                assert.equal(Object.getPrototypeOf(result.customSkills), Object.prototype);
                assert.notEqual(result.customSkills, given[0], 'not the object the compartment saw');
                assert.equal(result.customSkills.extra, undefined);
                assert.ok(cap.of('warn').some((r) => r.text.includes(CHANGED)), 'a warning is logged');
            });
        }

        // v0.1.4.5, G4: a global object that cannot be read or is missing now fails earlier, when the
        // library is protected (see the tests of G4). These two fakes pass the protection and then
        // change the global object, so the check after loading still has to catch it.
        test('fail closed: a global object that cannot be read after loading counts as changed', async () => {
            const makeCompartment = (e) => {
                const c = LOCK.makeCompartment(e);
                let reads = 0;
                return {
                    evaluate: (src) => c.evaluate(src),
                    get globalThis() {
                        reads++;
                        if (reads > 1) throw new Error('no access');
                        return c.globalThis;
                    },
                };
            };
            const result = await load([{ name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }], { makeCompartment });
            assert.deepEqual(result.loaded, []);
            assert.deepEqual(result.skipped, [{ name: 'goodOne', error: CHANGED }]);
        });

        test('fail closed: a global object that is gone after loading counts as changed', async () => {
            const makeCompartment = (e) => {
                const c = LOCK.makeCompartment(e);
                let reads = 0;
                return {
                    evaluate: (src) => c.evaluate(src),
                    get globalThis() {
                        reads++;
                        return reads > 1 ? undefined : c.globalThis;
                    },
                };
            };
            const result = await load([{ name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }], { makeCompartment });
            assert.deepEqual(result.skipped, [{ name: 'goodOne', error: CHANGED }]);
        });

        test('a global object that is another object after loading, without the binding, counts as changed', async () => {
            const makeCompartment = (e) => {
                const c = LOCK.makeCompartment(e);
                let reads = 0;
                return {
                    evaluate: (src) => c.evaluate(src),
                    get globalThis() {
                        reads++;
                        return reads > 1 ? {} : c.globalThis;
                    },
                };
            };
            const result = await load([{ name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }], { makeCompartment });
            assert.deepEqual(result.skipped, [{ name: 'goodOne', error: CHANGED }]);
        });

        test('a skill that was already skipped for another reason is listed once, with the text of the give-up', async () => {
            const result = await load([...hostile(REPRO), { name: 'syntaxError', source: 'async function syntaxError(bot) {\n    return (;\n}\n' }], { endowments: withProbe().endowments });
            assert.deepEqual(result.skipped.map((s) => s.name), ['aaaSkill', 'bbbSkill', 'cccSkill', 'syntaxError']);
            assert.ok(result.skipped.every((s) => s.error === CHANGED));
        });

        test('code that runs at load time but leaves customSkills alone is not detected by this protection: the skills load', async () => {
            // documents the limit of protection 2; protection 1 (check) refuses this text
            const { probe, endowments } = withProbe();
            const result = await load(hostile(escape('probe.ran = true')), { endowments });
            assert.equal(probe.ran, true);
            assert.deepEqual(result.loaded, ['aaaSkill', 'bbbSkill', 'cccSkill']);
            assert.equal(await result.customSkills.bbbSkill(makeBot()), 'original');
        });
    });

    test('with check the same hostile texts are all skipped and the library stays intact', async () => {
        for (const source of [REPRO, escape('Object.freeze(customSkills)'), escape('customSkills = {}')]) {
            const result = await load(hostile(source), { check: SRC.isSingleFunction });
            assert.deepEqual(result.loaded, ['bbbSkill', 'cccSkill']);
            assert.deepEqual(result.skipped, [{ name: 'aaaSkill', error: 'not a single function' }]);
            assert.equal(await result.customSkills.bbbSkill(makeBot()), 'original');
        }
    });

    test('a name appears in loaded or in skipped, never in both: a name listed twice is handled once', async () => {
        const store = fakeStore([{ name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }]);
        const list = store.list.bind(store);
        store.list = () => [...list(), ...list()];
        const result = await load(null, { store, check: SRC.isSingleFunction });
        assert.deepEqual(result.loaded, ['goodOne']);
        assert.deepEqual(result.skipped, []);
    });

    test('the skills of a normal load are evaluated before anything is put into customSkills', async () => {
        // a skill evaluated later must not see an earlier one in customSkills while loading
        const peek = 'async function peekSkill(bot) { return 1; }) && (probe.seen = Object.keys(customSkills).length, true) && (async function peekSkill(bot) { return 1; }';
        const { probe, endowments } = withProbe();
        await load([{ name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }, { name: 'peekSkill', source: peek }], { endowments });
        assert.equal(probe.seen, 0);
    });
});

// Spec v0.1.4.5, G4: directly after the compartment is made and before any skill is evaluated, the
// loader defines customSkills on the compartment's global object as not writable and not
// configurable, with the library object as value. Load-time code and a microtask it starts can no
// longer replace the name, also WITHOUT the option check. If that is not possible, all active
// skills are skipped with 'the skill library could not be protected' and an empty frozen library
// is returned. The checks of Amendment 2, B2 stay (see above).
describe('the name customSkills cannot be replaced in the sandbox (v0.1.4.5, G4)', () => {
    const UNPROTECTED = 'the skill library could not be protected';
    const escape = (code) => `async function aaaSkill(bot) { return 1; }) && (${code}, true) && (async function aaaSkill(bot) { return 1; }`;
    // makeCompartment that keeps the compartment, so the test can look at its global object
    const spy = () => {
        const made = [];
        return { made, makeCompartment: (e) => { const c = LOCK.makeCompartment(e); made.push(c); return c; } };
    };
    const withProbe = () => {
        const probe = {};
        return { probe, endowments: { ...makeEndowments(), probe } };
    };
    const binding = (compartment) => Object.getOwnPropertyDescriptor(compartment.globalThis, 'customSkills');

    test('the binding is a constant with the library as value, already before the first skill is evaluated', async () => {
        const seen = [];
        const makeCompartment = (e) => {
            const c = LOCK.makeCompartment(e);
            return {
                get globalThis() {
                    return c.globalThis;
                },
                evaluate: (src) => {
                    seen.push(Object.getOwnPropertyDescriptor(c.globalThis, 'customSkills'));
                    return c.evaluate(src);
                },
            };
        };
        const { customSkills } = await load([{ name: 'innerSkill', source: INNER }, { name: 'outerSkill', source: OUTER }], { makeCompartment });
        assert.equal(seen.length, 2);
        for (const d of seen) {
            assert.equal(d.value, customSkills);
            assert.equal(d.writable, false);
            assert.equal(d.configurable, false);
        }
    });

    test('skills still call each other through customSkills', async () => {
        const { made, makeCompartment } = spy();
        const { customSkills, loaded } = await load([{ name: 'outerSkill', source: OUTER }, { name: 'innerSkill', source: INNER }], { makeCompartment, check: SRC.isSingleFunction });
        assert.deepEqual(loaded, ['innerSkill', 'outerSkill']);
        assert.equal(await customSkills.outerSkill(makeBot()), 42);
        assert.equal(binding(made[0]).value, customSkills);
    });

    const LOAD_TIME = [
        ['assigns a new object to the name', 'customSkills = { innerSkill: async function innerSkill() { return 0; } }'],
        ['deletes the name', 'delete globalThis.customSkills'],
        ['turns the name into a getter', '(() => { const real = customSkills; Object.defineProperty(globalThis, "customSkills", { get: () => real, configurable: true }); })()'],
        ['makes the name writable again', 'Object.defineProperty(globalThis, "customSkills", { writable: true })'],
    ];
    for (const [label, code] of LOAD_TIME) {
        test(`load-time code that ${label}, without check: it throws, that skill is skipped, the others load and call each other`, async () => {
            const { made, makeCompartment } = spy();
            const { probe, endowments } = withProbe();
            const result = await load([
                { name: 'aaaSkill', source: escape(`${code}, probe.ran = true`) },
                { name: 'innerSkill', source: INNER },
                { name: 'outerSkill', source: OUTER },
            ], { makeCompartment, endowments });
            assert.equal(probe.ran, undefined, 'the code after the attempt did not run');
            assert.deepEqual(result.loaded, ['innerSkill', 'outerSkill']);
            assert.equal(result.skipped.length, 1);
            assert.equal(result.skipped[0].name, 'aaaSkill');
            assert.match(result.skipped[0].error, /TypeError/);
            assert.equal(await result.customSkills.outerSkill(makeBot()), 42);
            const d = binding(made[0]);
            assert.equal(d.value, result.customSkills);
            assert.equal(d.writable, false);
            assert.equal(d.configurable, false);
        });
    }

    test('load-time code that catches its failed attempt: the name stays, all skills load (this protection does not need check)', async () => {
        const { made, makeCompartment } = spy();
        const { probe, endowments } = withProbe();
        const result = await load([
            { name: 'aaaSkill', source: escape('(() => { try { customSkills = {}; probe.replaced = true; } catch (e) { probe.error = String(e); } })()') },
            { name: 'innerSkill', source: INNER },
            { name: 'outerSkill', source: OUTER },
        ], { makeCompartment, endowments });
        assert.match(probe.error, /TypeError/);
        assert.equal(probe.replaced, undefined);
        assert.deepEqual(result.loaded, ['aaaSkill', 'innerSkill', 'outerSkill']);
        assert.equal(binding(made[0]).value, result.customSkills);
        assert.equal(await result.customSkills.outerSkill(makeBot()), 42);
    });

    test('a microtask started at load time cannot replace the name or add a member, without check', async () => {
        const { made, makeCompartment } = spy();
        const { probe, endowments } = withProbe();
        const later = [
            'Promise.resolve().then(() => {',
            '  try { customSkills = { innerSkill: async function innerSkill() { return 0; } }; probe.replaced = true; } catch (e) { probe.assign = String(e); }',
            '  try { customSkills.extra = async function extra() { return "extra"; }; probe.added = true; } catch (e) { probe.add = String(e); }',
            '  probe.done = true;',
            '})',
        ].join(' ');
        // called directly, not through the awaiting helper, so no microtask runs before the first checks
        const result = L.loadSkills({
            store: fakeStore([{ name: 'aaaSkill', source: escape(later) }, { name: 'innerSkill', source: INNER }, { name: 'outerSkill', source: OUTER }]),
            makeCompartment, endowments, instrument: SRC.instrument, onUse: () => {},
        });
        assert.equal(probe.done, undefined, 'the microtask has not run while loading');
        assert.deepEqual(result.loaded, ['aaaSkill', 'innerSkill', 'outerSkill'], 'the load-time code left the library alone, so all load');
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(probe.done, true, 'the microtask ran after loading');
        assert.match(probe.assign, /TypeError/);
        assert.match(probe.add, /TypeError/, 'the library is frozen by then');
        assert.equal(probe.replaced, undefined);
        assert.equal(probe.added, undefined);
        assert.equal(binding(made[0]).value, result.customSkills);
        assert.equal(result.customSkills.extra, undefined);
        assert.equal(await result.customSkills.outerSkill(makeBot()), 42, 'skills still call the real innerSkill');
    });

    test('a microtask that adds a member to the library before it is frozen cannot happen: loading is synchronous', async () => {
        // the loader evaluates, checks and freezes in one synchronous run, so no microtask runs in between
        const { probe, endowments } = withProbe();
        const result = await load([
            { name: 'aaaSkill', source: escape('Promise.resolve().then(() => { try { customSkills.extra = 1; } catch (e) { probe.add = String(e); } })') },
            { name: 'innerSkill', source: INNER },
        ], { endowments });
        assert.ok(Object.isFrozen(result.customSkills));
        await new Promise((resolve) => setImmediate(resolve));
        assert.match(probe.add, /TypeError/);
        assert.equal(result.customSkills.extra, undefined);
    });

    const UNPROTECTABLE = [
        ['the compartment has no global object (a fake)', (c) => ({ evaluate: (src) => c.evaluate(src) })],
        ['the global object cannot be read', (c) => ({ evaluate: (src) => c.evaluate(src), get globalThis() { throw new Error('no access'); } })],
        ['the global object is not extensible and has no binding', (c) => ({ evaluate: (src) => c.evaluate(src), globalThis: Object.preventExtensions({}) })],
        ['the binding is already a constant with another value', (c) => ({ evaluate: (src) => c.evaluate(src), globalThis: Object.defineProperty({}, 'customSkills', { value: {}, writable: false, configurable: false }) })],
        ['the global object refuses the definition', (c) => ({ evaluate: (src) => c.evaluate(src), globalThis: new Proxy({}, { defineProperty: () => false }) })],
        ['the global object reports a writable binding after the definition', (c) => ({
            evaluate: (src) => c.evaluate(src),
            globalThis: new Proxy({}, { defineProperty: () => true, getOwnPropertyDescriptor: () => ({ value: 1, writable: true, configurable: true, enumerable: true }) }),
        })],
    ];
    for (const [label, fake] of UNPROTECTABLE) {
        test(`not possible because ${label}: every active skill is skipped with "${UNPROTECTED}", nothing is evaluated, an empty frozen library`, async () => {
            let evaluated = 0;
            const given = [];
            const makeCompartment = (e) => {
                given.push(e.customSkills);
                const c = LOCK.makeCompartment(e);
                return fake({ evaluate: (src) => { evaluated++; return c.evaluate(src); } });
            };
            const skills = [
                { name: 'innerSkill', source: INNER },
                { name: 'outerSkill', source: OUTER },
                { name: 'offSkill', source: fnSource('offSkill', ['return 0;']), status: 'disabled' },
            ];
            let result;
            await assert.doesNotReject(async () => {
                result = await load(skills, { makeCompartment, check: SRC.isSingleFunction });
            });
            assert.equal(evaluated, 0, 'no skill was evaluated');
            assert.deepEqual(result.loaded, []);
            assert.deepEqual(result.skipped, [{ name: 'innerSkill', error: UNPROTECTED }, { name: 'outerSkill', error: UNPROTECTED }]);
            assert.ok(Object.isFrozen(result.customSkills));
            assert.deepEqual(Reflect.ownKeys(result.customSkills), []);
            assert.notEqual(result.customSkills, given[0], 'not the object the compartment got');
            assert.ok(cap.of('warn').some((r) => r.text.includes(UNPROTECTED)), 'a warning is logged');
        });
    }

    test('not possible and no active skill: an empty result without a warning', async () => {
        const makeCompartment = (e) => ({ evaluate: (src) => LOCK.makeCompartment(e).evaluate(src) });
        const result = await load([{ name: 'offSkill', source: fnSource('offSkill', ['return 0;']), status: 'disabled' }], { makeCompartment });
        assert.deepEqual(result.loaded, []);
        assert.deepEqual(result.skipped, []);
        assert.equal(cap.of('warn').length, 0);
    });

    test('with the real SkillStore and the manager\'s check: the binding is protected as well', async () => {
        const root = makeTmpDir();
        try {
            const store = new STORE.SkillStore(path.join(root, 'skills'), { now: () => new Date(Date.UTC(2026, 8, 28)) });
            store.load();
            store.save({ name: 'innerSkill', source: INNER, description: 'Inner.', signature: 'innerSkill(bot)', sourceTask: 't' });
            const { made, makeCompartment } = spy();
            const { customSkills } = await load(null, { store, makeCompartment, check: SRC.isSingleFunction });
            assert.equal(binding(made[0]).value, customSkills);
            assert.equal(binding(made[0]).writable, false);
            assert.throws(() => made[0].evaluate('customSkills = {}'), TypeError);
        } finally {
            removeTmpDir(root);
        }
    });
});

describe('never throws', () => {
    const shapeOk = (result) => {
        assert.ok(result && typeof result === 'object');
        assert.ok(Array.isArray(result.loaded));
        assert.ok(Array.isArray(result.skipped));
    };

    test('store.list throws: empty, frozen customSkills', async () => {
        const store = { list() { throw new Error('list failed'); }, read() { return null; } };
        let result;
        await assert.doesNotReject(async () => {
            result = await load(null, { store });
        });
        shapeOk(result);
        assert.deepEqual(result.loaded, []);
        assert.equal(Object.isFrozen(result.customSkills), true);
    });

    test('entries of the list that cannot be read or have no usable name are left out; the others load', async () => {
        const good = fakeStore([{ name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }]);
        const store = {
            list: () => [
                null, 42, 'goodOne',
                { get status() { throw new Error('status getter'); }, name: 'badStatus' },
                { status: 'active', get name() { throw new Error('name getter'); } },
                { status: 'active', name: '' },
                { status: 'active', name: 7 },
                ...good.list(),
            ],
            read: (name) => good.read(name),
        };
        let result;
        await assert.doesNotReject(async () => {
            result = await load(null, { store, check: SRC.isSingleFunction });
        });
        assert.deepEqual(result.loaded, ['goodOne']);
        assert.deepEqual(result.skipped, []);
    });

    test('store.read throws for one skill: that skill is skipped', async () => {
        const store = fakeStore([{ name: 'readFails', source: 'x' }, { name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }]);
        const read = store.read.bind(store);
        store.read = (name) => {
            if (name === 'readFails') throw new Error('read failed');
            return read(name);
        };
        const result = await load(null, { store });
        assert.deepEqual(result.loaded, ['goodOne']);
        assert.deepEqual(result.skipped.map((s) => s.name), ['readFails']);
    });

    test('makeCompartment throws', async () => {
        const makeCompartment = () => {
            throw new Error('no compartment');
        };
        let result;
        await assert.doesNotReject(async () => {
            result = await load([{ name: 'goodOne', source: fnSource('goodOne', ['return 1;']) }], { makeCompartment });
        });
        shapeOk(result);
        assert.deepEqual(result.loaded, []);
    });

    for (const [label, args] of [['no argument', undefined], ['null', null], ['an empty object', {}], ['store null', { store: null, makeCompartment: () => null, endowments: null, instrument: null }]]) {
        test(`hostile arguments: ${label}`, async () => {
            let result;
            await assert.doesNotReject(async () => {
                result = await L.loadSkills(args);
            });
            shapeOk(result);
        });
    }
});

describe('module rules', () => {
    test('no mineflayer, no model SDK, not skills.js or world.js, no require()', () => {
        assertSkillModuleImports(MODULE);
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
