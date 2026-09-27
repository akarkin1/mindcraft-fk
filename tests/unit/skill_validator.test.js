// Spec v0.1.4.4 K2: src/agent/skills/skill_validator.js -- validateSkill({ name, source, builtinNames, maxLength }).
// All rules are checked, so several errors can come back. Never throws.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertSkillModuleImports } from '../helpers/source_ast.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/skills/skill_validator.js';
const V = await loadSrc(MODULE);

// A valid skill source. Extra body lines go before the loop. Ends with '}\n' (already normalized).
function good(name = 'buildWall', body = []) {
    return [
        `async function ${name}(bot, length) {`,
        '    /**',
        '     * Builds a wall of the given length.',
        '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
        '     * @param {number} length, number of blocks.',
        '     **/',
        '    const pos = bot.entity.position;',
        ...body.map((l) => '    ' + l),
        '    for (let i = 0; i < length; i++) {',
        "        await skills.placeBlock(bot, 'dirt', pos.x + i, pos.y, pos.z);",
        '    }',
        '    return true;',
        '}',
        '',
    ].join('\n');
}

const validate = (args) => V.validateSkill(args);
const codes = (result) => result.errors.map((e) => e.code);

function assertShape(result) {
    assert.equal(typeof result.ok, 'boolean');
    assert.ok(Array.isArray(result.errors));
    for (const e of result.errors) {
        assert.equal(typeof e.code, 'string');
        assert.equal(typeof e.message, 'string');
        assert.ok(e.message.length > 0, `message of ${e.code}`);
    }
    assert.equal(result.ok, result.errors.length === 0, 'ok exactly when there are no errors');
}

describe('a valid skill', () => {
    test('ok true, errors []', () => {
        const result = validate({ name: 'buildWall', source: good() });
        assertShape(result);
        assert.deepEqual(result, { ok: true, errors: [] });
    });

    test('also with CRLF line endings', () => {
        const result = validate({ name: 'buildWall', source: good().replace(/\n/g, '\r\n') });
        assert.deepEqual(result, { ok: true, errors: [] });
    });

    test('builtinNames defaults to [] and maxLength to 8000', () => {
        assert.equal(validate({ name: 'placeBlock', source: good('placeBlock') }).ok, true);
    });
});

describe('name_format: ^[a-z][A-Za-z0-9]{2,39}$', () => {
    for (const name of ['abc', 'a1B2c3', 'a' + 'B'.repeat(39)]) {
        test(`${JSON.stringify(name)} (${name.length} characters) is accepted`, () => {
            assert.deepEqual(validate({ name, source: good(name) }), { ok: true, errors: [] });
        });
    }

    for (const [label, name] of [['2 characters', 'ab'], ['upper case first', 'Bad'], ['underscore', 'a_bc'], ['41 characters', 'a' + 'b'.repeat(40)], ['dollar', 'ab$c']]) {
        test(`${label} (${JSON.stringify(name)}): only name_format`, () => {
            assert.deepEqual(codes(validate({ name, source: good(name) })), ['name_format']);
        });
    }

    for (const [label, name] of [['a path', '../evil'], ['empty', ''], ['one letter', 'a'], ['digit first', '1abc'], ['a space', 'ab cd']]) {
        test(`${label} (${JSON.stringify(name)}): name_format among the errors`, () => {
            const result = validate({ name, source: good() });
            assertShape(result);
            assert.ok(codes(result).includes('name_format'), JSON.stringify(result.errors));
        });
    }
});

describe('name_reserved', () => {
    const LISTED = ['bot', 'log', 'skills', 'world', 'customSkills', 'main', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'];
    for (const name of LISTED) {
        test(`${name}`, () => {
            const result = validate({ name, source: good(name) });
            assertShape(result);
            assert.ok(codes(result).includes('name_reserved'), JSON.stringify(result.errors));
            assert.ok(!codes(result).includes('name_format'), 'the name itself has a valid format');
        });
    }

    const KEYWORDS = ['await', 'async', 'function', 'return', 'class', 'delete', 'import', 'export', 'default', 'new', 'this', 'typeof', 'void', 'yield'];
    for (const name of KEYWORDS) {
        test(`reserved word named in the spec: ${name}`, () => {
            const result = validate({ name, source: good(name) });
            assertShape(result);
            assert.ok(codes(result).includes('name_reserved'), JSON.stringify(result.errors));
        });
    }

    // The other ReservedWord entries of ECMAScript that match the name format.
    const OTHER_RESERVED = ['break', 'case', 'catch', 'const', 'continue', 'debugger', 'else', 'enum', 'extends', 'false', 'finally', 'for', 'instanceof', 'null', 'super', 'switch', 'throw', 'true', 'try', 'var', 'while', 'with'];
    test('the other reserved words of ECMAScript', () => {
        const missing = OTHER_RESERVED.filter((name) => !codes(validate({ name, source: good(name) })).includes('name_reserved'));
        assert.deepEqual(missing, []);
    });
});

describe('name_builtin', () => {
    test('a name in builtinNames: only name_builtin', () => {
        const result = validate({ name: 'placeBlock', source: good('placeBlock'), builtinNames: ['goToPosition', 'placeBlock'] });
        assert.deepEqual(codes(result), ['name_builtin']);
        assert.equal(result.ok, false);
    });

    test('a name not in builtinNames is fine', () => {
        assert.equal(validate({ name: 'buildWall', source: good(), builtinNames: ['placeBlock'] }).ok, true);
    });
});

describe('too_long', () => {
    test('exactly maxLength characters is fine, one more is too_long', () => {
        const source = good();
        assert.equal(validate({ name: 'buildWall', source, maxLength: source.length }).ok, true);
        assert.deepEqual(codes(validate({ name: 'buildWall', source, maxLength: source.length - 1 })), ['too_long']);
    });

    test('default maxLength is 8000', () => {
        const base = good('buildWall', ['// ']).length;
        const at = good('buildWall', ['// ' + 'x'.repeat(8000 - base)]);
        const over = good('buildWall', ['// ' + 'x'.repeat(8001 - base)]);
        assert.equal(at.length, 8000);
        assert.equal(over.length, 8001);
        assert.equal(validate({ name: 'buildWall', source: at }).ok, true);
        assert.deepEqual(codes(validate({ name: 'buildWall', source: over })), ['too_long']);
    });
});

describe('not_one_function', () => {
    const NOT_ASYNC = 'function buildWall(bot, length) {\n    /**\n     * Builds a wall.\n     **/\n    return true;\n}\n';
    const CASES = [
        ['two functions', good() + 'async function other(bot) {\n    /** Other. */\n    return true;\n}\n'],
        ['a function and a call', good() + 'buildWall(bot, 3);\n'],
        ['not async', NOT_ASYNC],
        ['another name', good('buildRoof')],
        ['first parameter not bot', good().replace('(bot, length)', '(b, length)')],
        ['no parameters', good().replace('(bot, length)', '()')],
        ['an arrow function in a const', 'const buildWall = async (bot) => {\n    /** Builds. */\n    return true;\n};\n'],
        ['a function expression statement', '(async function buildWall(bot) {\n    /** Builds. */\n    return true;\n});\n'],
        ['empty source', ''],
        ['only a comment', '/** Builds a wall. */\n'],
    ];
    for (const [label, source] of CASES) {
        test(label, () => {
            const result = validate({ name: 'buildWall', source });
            assertShape(result);
            assert.ok(codes(result).includes('not_one_function'), JSON.stringify(result.errors));
        });
    }

    test('a source that does not parse: not_one_function, and hard_coded_coordinates is skipped', () => {
        const source = 'async function buildWall(bot) {\n    /** Builds. */\n    const p = new Vec3(120, 64, -30);\n';
        const result = validate({ name: 'buildWall', source });
        assertShape(result);
        assert.ok(codes(result).includes('not_one_function'));
        assert.ok(!codes(result).includes('hard_coded_coordinates'));
    });
});

describe('no_doc', () => {
    const noDoc = (docLines) => [
        'async function buildWall(bot, length) {',
        ...docLines,
        '    return true;',
        '}',
        '',
    ].join('\n');

    test('no doc block: only no_doc', () => {
        assert.deepEqual(codes(validate({ name: 'buildWall', source: noDoc([]) })), ['no_doc']);
    });

    test('a doc block without a letter: no_doc', () => {
        assert.deepEqual(codes(validate({ name: 'buildWall', source: noDoc(['    /** 123 */']) })), ['no_doc']);
    });

    test('a plain block comment is no doc block', () => {
        assert.deepEqual(codes(validate({ name: 'buildWall', source: noDoc(['    /* Builds a wall. */']) })), ['no_doc']);
    });

    test('a doc block before the function (outside the body) does not count', () => {
        const source = '/**\n * Builds a wall.\n **/\n' + noDoc([]);
        assert.deepEqual(codes(validate({ name: 'buildWall', source })), ['no_doc']);
    });

    test('a doc block whose first lines have no letter but a later one has: fine', () => {
        assert.equal(validate({ name: 'buildWall', source: noDoc(['    /**', '     * 42', '     * Builds a wall.', '     **/']) }).ok, true);
    });
});

describe('forbidden_token (text including comments and strings)', () => {
    const TOKENS = ['import(', 'eval(', '<!--', '-->', 'require(', 'globalThis', 'process.', '.constructor', 'Function(', '__proto__', 'setTimeout(', 'setInterval('];
    for (const token of TOKENS) {
        test(`${token} in a string: one forbidden_token error that names the token`, () => {
            const result = validate({ name: 'buildWall', source: good('buildWall', [`log(bot, "${token}");`]) });
            assertShape(result);
            assert.deepEqual(codes(result), ['forbidden_token']);
            assert.ok(result.errors[0].message.includes(token), result.errors[0].message);
        });
    }

    test('a token in a comment counts', () => {
        assert.deepEqual(codes(validate({ name: 'buildWall', source: good('buildWall', ['// never call eval( here']) })), ['forbidden_token']);
    });

    test('two different tokens: two errors, each message names its token', () => {
        const result = validate({ name: 'buildWall', source: good('buildWall', ['log(bot, "eval(");', 'log(bot, "require(");']) });
        const forbidden = result.errors.filter((e) => e.code === 'forbidden_token');
        assert.equal(forbidden.length, 2);
        assert.ok(forbidden.some((e) => e.message.includes('eval(')));
        assert.ok(forbidden.some((e) => e.message.includes('require(')));
    });

    test('lower case function( is not the token Function(', () => {
        assert.equal(validate({ name: 'buildWall', source: good('buildWall', ['const f = [1].map(function(x) { return x; });']) }).ok, true);
    });
});

// Amendment 1, A1: a token matches a whole name, not a part of a longer name. Still applied to
// the whole source text, including comments and strings.
describe('forbidden_token matches whole names (Amendment 1, A1)', () => {
    const PASS = [
        // the examples of the amendment
        ['retrieval(bot)', 'const r = retrieval(bot);'],
        ['buildFunction(1)', 'const f = buildFunction(1);'],
        ['item.constructorName', 'const c = item.constructorName;'],
        ['subprocess.x', 'const s = subprocess.x;'],
        ['myglobalThisValue', 'const g = myglobalThisValue;'],
        // import( eval( require( Function( setTimeout( setInterval(: preceded by a name character, or no ( after the name
        ['reimport(1)', 'const a = reimport(1);'],
        ['$eval(1)', 'const b = $eval(1);'],
        ['medieval (1)', 'const m = medieval (1);'],
        ['eval2(1)', 'const e = eval2(1);'],
        ['_require(1)', 'const q = _require(1);'],
        ['required(1)', 'const d = required(1);'],
        ['isFunction(x)', 'const h = isFunction(pos);'],
        ['resetTimeout(1)', 'const t = resetTimeout(1);'],
        ['clear9setInterval(1)', 'const u = clear9setInterval(1);'],
        // globalThis, __proto__: a name character before or after
        ['globalThis_(1)', 'const v = globalThis_(1);'],
        ['globalThis$', 'const w = globalThis$;'],
        ['my__proto__', 'const p1 = my__proto__;'],
        ['__proto__2', 'const p2 = __proto__2;'],
        // process.: a name character before, or another name
        ['$process.x', 'const k = $process.x;'],
        ['processes.x', 'const l = processes.x;'],
        // .constructor: a name character after
        ['x.constructor_', 'const n = pos.constructor_;'],
        ['x.constructor$', 'const o = pos.constructor$;'],
        ['x.constructor2', 'const z = pos.constructor2;'],
    ];
    // The names these lines read from outside; since Amendment 2, B3 they must be allowed explicitly.
    const OUTSIDE = ['retrieval', 'buildFunction', 'item', 'subprocess', 'myglobalThisValue', 'reimport', '$eval', 'medieval', 'eval2', '_require',
        'required', 'isFunction', 'resetTimeout', 'clear9setInterval', 'globalThis_', 'globalThis$', 'my__proto__', '__proto__2', '$process', 'processes'];
    for (const [label, line] of PASS) {
        test(`passes: ${label}`, () => {
            assert.deepEqual(validate({ name: 'buildWall', source: good('buildWall', [line]), extraGlobals: OUTSIDE }), { ok: true, errors: [] });
        });
    }

    const FAIL = [
        // the examples of the amendment
        ['eval (x)', 'eval (x);', 'eval('],
        ['new Function("a")', 'const f = new Function("a");', 'Function('],
        ['x.constructor', 'const c = x.constructor;', '.constructor'],
        ['x.constructor.constructor', 'const c = x.constructor.constructor;', '.constructor'],
        ['process .exit', 'process .exit(0);', 'process.'],
        ['globalThis.x', 'globalThis.x = 1;', 'globalThis'],
        ['x-->0', 'while (x-->0) { x = 0; }', '-->'],
        // whitespace, line breaks and other characters around the name
        ['eval with a line break before (', 'eval\n(x);', 'eval('],
        ['import (x)', 'const mod = await import ("x");', 'import('],
        ['x.eval(1): a dot is no name character', 'x.eval(1);', 'eval('],
        ['require\t(', "const fs = require\t('fs');", 'require('],
        ['setTimeout (', 'setTimeout (() => {}, 1);', 'setTimeout('],
        ['setInterval(', 'setInterval(() => {}, 1);', 'setInterval('],
        ['globalThis at the end of a statement', 'const g = globalThis;', 'globalThis'],
        ['x.__proto__', 'const p = x.__proto__;', '__proto__'],
        ["x['__proto__']", "const p = x['__proto__'];", '__proto__'],
        ['process\n.env', 'const env = process\n.env;', 'process.'],
        ['x?.constructor', 'const c = x?.constructor;', '.constructor'],
        ['<!--', 'const lt = x <!--y;', '<!--'],
        ['a token in a comment', '// call eval (x) here', 'eval('],
        ['a token in a string', 'log(bot, "new Function(a)");', 'Function('],
    ];
    for (const [label, line, token] of FAIL) {
        test(`fails: ${label} -> one forbidden_token error that names ${token}`, () => {
            const result = validate({ name: 'buildWall', source: good('buildWall', line.split('\n')) });
            assertShape(result);
            const forbidden = result.errors.filter((e) => e.code === 'forbidden_token');
            assert.equal(forbidden.length, 1, JSON.stringify(result.errors));
            assert.ok(forbidden[0].message.includes(`"${token}"`), forbidden[0].message);
        });
    }

    test('a token at the very start or the very end of the source counts', () => {
        assert.ok(codes(validate({ name: 'buildWall', source: 'eval(1)' })).includes('forbidden_token'));
        assert.ok(codes(validate({ name: 'buildWall', source: 'x = globalThis' })).includes('forbidden_token'));
        assert.ok(codes(validate({ name: 'buildWall', source: 'x.constructor' })).includes('forbidden_token'));
    });

    test('every token of the spec is still reported, each once', () => {
        const all = ['import(1)', 'eval(1)', '<!--', '-->', 'require(1)', 'globalThis', 'process.x', 'x.constructor', 'Function(1)', 'x.__proto__', 'setTimeout(1)', 'setInterval(1)'];
        const result = validate({ name: 'buildWall', source: good('buildWall', all.map((text) => `// ${text}`)) });
        const named = result.errors.filter((e) => e.code === 'forbidden_token').map((e) => e.message.match(/"([^"]+)"/)[1]).sort();
        assert.deepEqual(named, ['-->', '.constructor', '<!--', 'Function(', '__proto__', 'eval(', 'globalThis', 'import(', 'process.', 'require(', 'setInterval(', 'setTimeout('].sort());
    });
});

// Amendment 2, B3: the function uses only names it declares itself, its parameters, the names of
// the sandbox (skills, world, Vec3, log, customSkills), console and the standard objects of
// JavaScript. Implemented with the rule no-undef of ESLint. One error; the message lists the
// unknown names in order of first use, each once.
describe('undefined_name (Amendment 2, B3)', () => {
    // A valid skill with the given parameters and body lines (indented by 4 spaces).
    const skill = (bodyLines, params = 'bot, length') => [
        `async function buildWall(${params}) {`,
        '    /**',
        '     * Builds a wall of the given length.',
        '     **/',
        ...bodyLines.map((l) => '    ' + l),
        '}',
        '',
    ].join('\n');
    const namesIn = (message) => message.slice(message.indexOf(':') + 1).split('.')[0].split(',').map((n) => n.trim());
    const undefinedError = (result) => {
        const found = result.errors.filter((e) => e.code === 'undefined_name');
        assert.equal(found.length, 1, JSON.stringify(result.errors));
        return found[0];
    };

    const FAIL = [
        ['a constant from outside', ['return SIZE * length;'], ['SIZE']],
        ['a helper function from outside', ['await buildRow(bot, length);', 'return true;'], ['buildRow']],
        ['a typo in a local name', ['const count = length + 1;', 'return cuont > 0;'], ['cuont']],
        ['writing to an unknown name', ['total = length;', 'return true;'], ['total']],
        ['writing to a property of an unknown name', ['state.done = true;', 'return true;'], ['state']],
        ['process', ['const p = process;', 'return Boolean(p);'], ['process']],
        ['setTimeout', ['const later = setTimeout;', 'return Boolean(later);'], ['setTimeout']],
        ['require', ['const r = require;', 'return Boolean(r);'], ['require']],
        ['names of a browser', ['return [window, document].length;'], ['window', 'document']],
        ['a name used inside a nested function', ['const f = () => HEIGHT;', 'return f();'], ['HEIGHT']],
        ['a name inside a template literal', ['log(bot, `size ${SIZE}`);', 'return true;'], ['SIZE']],
    ];
    for (const [label, body, names] of FAIL) {
        test(`fails: ${label} -> only undefined_name, naming ${names.join(', ')}`, () => {
            const result = validate({ name: 'buildWall', source: skill(body) });
            assertShape(result);
            assert.deepEqual(codes(result), ['undefined_name']);
            assert.deepEqual(namesIn(undefinedError(result).message), names);
        });
    }

    test('several names: one error, in order of first use, each name once', () => {
        const result = validate({ name: 'buildWall', source: skill(['const a = FOO + BAR;', 'const b = FOO + BAZ + BAR;', 'QUX = a + b;', 'return true;']) });
        assert.deepEqual(namesIn(undefinedError(result).message), ['FOO', 'BAR', 'BAZ', 'QUX']);
    });

    test('the calls of process, setTimeout and require are reported as unknown names too (besides forbidden_token for the tokens)', () => {
        const result = validate({ name: 'buildWall', source: skill(['setTimeout(() => {}, 1);', 'const fs = require("fs");', 'process.exit(0);', 'return true;']) });
        assert.deepEqual(namesIn(undefinedError(result).message), ['setTimeout', 'require', 'process']);
        assert.ok(codes(result).includes('forbidden_token'));
    });

    test('the message tells what to do', () => {
        const { message } = undefinedError(validate({ name: 'buildWall', source: skill(['return SIZE;']) }));
        assert.match(message, /SIZE/);
        assert.match(message, /parameter/);
    });

    const PASS = [
        ['parameters with default values and a rest parameter', ['return [count, size, rest.length];'], 'bot, count = 3, size = count * 2, ...rest'],
        ['destructured parameters', ['return x + y + first;'], 'bot, { x, y } = { x: 1, y: 2 }, [first] = [0]'],
        ['destructuring', ['const { x, y, z } = bot.entity.position;', 'const [a, , c] = [x, y, z];', 'const { p: { q } = {} } = {};', 'return a + c + (q ?? 0);']],
        ['nested functions and closures', ['function inner(n) { return n + length; }', 'const add = (k) => inner(k) + offset;', 'let offset = 1;', 'const make = function named() { return named; };', 'return add(1) + (make() ? 1 : 0);']],
        ['recursion: the function calls itself', ['if (length <= 0) return true;', 'return await buildWall(bot, length - 1);']],
        ['catch (error)', ['try {', '    await skills.wait(bot, 1);', '} catch (error) {', '    log(bot, String(error));', '    return false;', '}', 'return true;']],
        ['catch without a binding', ['try { await skills.wait(bot, 1); } catch { return false; }', 'return true;']],
        ['loop variables', ['for (let i = 0; i < length; i++) { log(bot, String(i)); }', 'for (const item of [1, 2]) { log(bot, String(item)); }', 'for (const key in { a: 1 }) { log(bot, key); }', 'return true;']],
        ['labels', ['outer: for (let i = 0; i < 3; i++) {', '    for (let j = 0; j < 3; j++) {', '        if (j === 1) continue outer;', '        if (i === 2) break outer;', '    }', '}', 'return true;']],
        ['arguments', ['return arguments.length > 0;']],
        ['a class and new', ['class Row { constructor(n) { this.n = n; } }', 'return new Row(length).n;']],
        ['the standard objects', ['const m = new Map([[1, Math.max(1, 2)]]);', 'const s = new Set(JSON.parse("[1]"));', 'const d = new Date(0);', 'await Promise.all([Promise.resolve(1)]);',
            'const n = Number.isFinite(1) && !Number.isNaN(NaN) && Infinity > 0 && undefined === void 0;', 'const e = new Error(String(parseInt("3", 10)));',
            'const o = Object.keys({}).concat(Array.from("ab"));', 'return [m, s, d, n, e, o, Symbol("x"), BigInt(1), isNaN(1), parseFloat("1"), encodeURIComponent("a")].length > 0;']],
        ['the names of the sandbox and console', ['await customSkills.other(bot);', 'const up = new Vec3(0, 1, 0);', 'console.log("up", up);', 'log(bot, "ok");', 'await skills.wait(bot, 1);',
            'const b = world.getNearestBlock(bot, "dirt", 8);', 'return Boolean(b);']],
        ['typeof of an unknown name is no use (the default of no-undef)', ["return typeof window === 'undefined';"]],
        ['CRLF line endings', ['const up = new Vec3(0, 1, 0);', 'return up.y === 1;']],
    ];
    for (const [label, body, params] of PASS) {
        test(`passes: ${label}`, () => {
            let source = skill(body, params);
            if (label === 'CRLF line endings') source = source.replace(/\n/g, '\r\n');
            assert.deepEqual(validate({ name: 'buildWall', source }), { ok: true, errors: [] });
        });
    }

    test('extraGlobals allows further names', () => {
        const source = skill(['return SIZE * length + OFFSET;']);
        assert.deepEqual(namesIn(undefinedError(validate({ name: 'buildWall', source, extraGlobals: ['SIZE'] })).message), ['OFFSET']);
        assert.deepEqual(validate({ name: 'buildWall', source, extraGlobals: ['SIZE', 'OFFSET'] }), { ok: true, errors: [] });
    });

    test('extraGlobals that is not a list of names is ignored, never a throw', () => {
        const source = skill(['return SIZE;']);
        for (const extraGlobals of [null, 'SIZE', 42, {}, [42, null, {}], [''], ['a b']]) {
            let result;
            assert.doesNotThrow(() => {
                result = validate({ name: 'buildWall', source, extraGlobals });
            });
            assert.deepEqual(codes(result), ['undefined_name'], JSON.stringify(extraGlobals));
        }
    });

    test('extraGlobals such as __proto__ or constructor do not break the check', () => {
        const result = validate({ name: 'buildWall', source: skill(['return SIZE;']), extraGlobals: ['__proto__', 'constructor', 'toString'] });
        assert.deepEqual(namesIn(undefinedError(result).message), ['SIZE']);
    });

    test('comments of ESLint in the source have no effect: /* global */, /* eslint-disable */, eslint-disable-line', () => {
        const sources = [
            '/* global SIZE */\n' + skill(['return SIZE;']),
            skill(['/* global SIZE */', 'return SIZE;']),
            '/* eslint-disable */\n' + skill(['return SIZE;']),
            skill(['return SIZE; // eslint-disable-line no-undef']),
            skill(['// eslint-disable-next-line', 'return SIZE;']),
        ];
        for (const source of sources) {
            assert.deepEqual(namesIn(undefinedError(validate({ name: 'buildWall', source })).message), ['SIZE'], source);
        }
    });

    test('a source that does not parse: undefined_name is skipped', () => {
        const result = validate({ name: 'buildWall', source: 'async function buildWall(bot) {\n    /** Builds. */\n    return SIZE +;\n}\n' });
        assert.ok(codes(result).includes('not_one_function'));
        assert.ok(!codes(result).includes('undefined_name'));
    });

    test('a source that parses but is no single function is still checked', () => {
        const result = validate({ name: 'buildWall', source: skill(['return SIZE;']) + 'buildWall(bot, 3);\n' });
        assert.ok(codes(result).includes('not_one_function'));
        assert.deepEqual(namesIn(undefinedError(result).message), ['SIZE', 'bot']);
    });

    test('fail closed: if ESLint throws, undefined_name says the names could not be checked; no throw', async () => {
        const { Linter } = await import('eslint');
        const original = Linter.prototype.verify;
        Linter.prototype.verify = () => {
            throw new Error('linter broke');
        };
        let result;
        try {
            assert.doesNotThrow(() => {
                result = validate({ name: 'buildWall', source: skill(['return length > 0;']) });
            });
        } finally {
            Linter.prototype.verify = original;
        }
        assert.equal(result.ok, false);
        assert.deepEqual(codes(result), ['undefined_name']);
        assert.match(result.errors[0].message, /could not be checked: .*linter broke/);
        assert.deepEqual(validate({ name: 'buildWall', source: skill(['return length > 0;']) }), { ok: true, errors: [] }, 'works again after the restore');
    });
});

describe('hard_coded_coordinates', () => {
    const FAIL = [
        ['new Vec3(120, 64, -30)', 'const p = new Vec3(120, 64, -30);'],
        ['a call with three numbers', 'await skills.goToPosition(bot, 100, 64, 200);'],
        ['an array literal', 'const target = [10, 70, 5];'],
        ['three consecutive of four arguments', 'const r = Math.max(1, 2, 3, 400);'],
        ['a leading minus', 'const d = Math.hypot(-20, 0, 0);'],
        ['exactly 16', 'const e = Math.hypot(16, 0, 0);'],
        ['exactly -16', 'const g = Math.hypot(0, 0, -16);'],
        ['deep inside blocks', 'if (length > 0) { for (const s of [1]) { await skills.goToPosition(bot, 300, 70, 300); } }'],
    ];
    for (const [label, line] of FAIL) {
        test(`fails: ${label}`, () => {
            assert.deepEqual(codes(validate({ name: 'buildWall', source: good('buildWall', [line]) })), ['hard_coded_coordinates']);
        });
    }

    const PASS = [
        ['new Vec3(0, 1, 0)', 'const up = new Vec3(0, 1, 0);'],
        ["placeBlock(bot, 'dirt', x, y, z)", "await skills.placeBlock(bot, 'dirt', pos.x, pos.y, pos.z);"],
        ['small numbers only', 'const small = [1, 2, 3];'],
        ['all below 16 with minus', 'const e = Math.hypot(15, -15, 15);'],
        ['not three in a row', "const q = Math.max(5, 'x', 100, 200);"],
        ['an expression is no literal', 'const h = Math.hypot(pos.x + 100, 64, 20);'],
        ['two numbers', 'const two = [100, 200];'],
        ['numbers in a string', "log(bot, '120, 64, -30');"],
    ];
    for (const [label, line] of PASS) {
        test(`passes: ${label}`, () => {
            assert.deepEqual(validate({ name: 'buildWall', source: good('buildWall', [line]) }), { ok: true, errors: [] });
        });
    }
});

describe('all rules are checked', () => {
    test('several errors at once', () => {
        const result = validate({ name: 'Bad', source: 'async function other(bot) {\n    eval("1");\n    const p = [100, 64, 100];\n}\n' });
        assertShape(result);
        for (const code of ['name_format', 'not_one_function', 'no_doc', 'forbidden_token', 'hard_coded_coordinates']) {
            assert.ok(codes(result).includes(code), `${code} in ${JSON.stringify(codes(result))}`);
        }
    });

    test('a builtin name that is also too long and has no doc', () => {
        const source = 'async function placeBlock(bot) {\n    return true;\n}\n';
        const result = validate({ name: 'placeBlock', source, builtinNames: ['placeBlock'], maxLength: 10 });
        assert.deepEqual([...codes(result)].sort(), ['name_builtin', 'no_doc', 'too_long']);
    });
});

describe('never throws', () => {
    const HOSTILE = [
        ['no argument', undefined],
        ['null', null],
        ['an empty object', {}],
        ['numbers', { name: 42, source: 42 }],
        ['objects', { name: {}, source: [] }],
        ['null values', { name: null, source: null, builtinNames: null, maxLength: null }],
        ['builtinNames not an array', { name: 'buildWall', source: good(), builtinNames: 'placeBlock' }],
        ['$ characters', { name: 'abc', source: '$&$1 $` $\'' }],
        ['very long text', { name: 'buildWall', source: 'x'.repeat(200000) }],
    ];
    for (const [label, args] of HOSTILE) {
        test(label, () => {
            let result;
            assert.doesNotThrow(() => {
                result = V.validateSkill(args);
            });
            assertShape(result);
        });
    }

    test('invalid input is not ok', () => {
        for (const args of [undefined, null, {}, { name: 42, source: 42 }]) {
            assert.equal(V.validateSkill(args).ok, false, JSON.stringify(args));
        }
    });

    test('very long text reports too_long', () => {
        assert.ok(codes(V.validateSkill({ name: 'buildWall', source: 'x'.repeat(200000) })).includes('too_long'));
    });
});

describe('module rules', () => {
    test('pure: imports only espree, eslint (Amendment 2, B3), sibling skill modules and built-ins without I/O; no mineflayer, no model SDK, not skills.js or world.js', () => {
        assertSkillModuleImports(MODULE, { pure: true, allowPackages: ['espree', 'eslint'] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
