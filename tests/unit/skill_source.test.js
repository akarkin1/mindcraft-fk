// Spec v0.1.4.4 K1: src/agent/skills/skill_source.js -- pure helpers for generated code and
// skill sources: normalizeSource, parseGeneratedCode, pickSkillCandidate, getDocBlock,
// firstDocLine, buildDocBlock, ensureDocBlock, signatureOf, instrument.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertSkillModuleImports } from '../helpers/source_ast.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/skills/skill_source.js';
const S = await loadSrc(MODULE);

const HOSTILE = [
    ['undefined', undefined], ['null', null], ['a number', 42], ['an object', { code: 'x' }],
    ['an array', ['async function f(bot) {}']], ['a boolean', true],
];
const DOLLARS = 'log(bot, "$& $1 $$ $` $\'");';
const INTERRUPT = 'if(bot.interrupt_code) {log(bot, "Code interrupted.");return;}';

// The four keys the spec names for an entry of `functions`.
const fnView = (fn) => ({ name: fn.name, async: fn.async, params: fn.params, source: fn.source });
const lines = (...l) => l.join('\n');

describe('normalizeSource(text)', () => {
    test('\\r\\n becomes \\n', () => {
        assert.equal(S.normalizeSource('a();\r\nb();\r\n'), 'a();\nb();\n');
    });

    test('trailing whitespace at the end is removed and the result ends with exactly one \\n', () => {
        assert.equal(S.normalizeSource('a();'), 'a();\n');
        assert.equal(S.normalizeSource('a();\n'), 'a();\n');
        assert.equal(S.normalizeSource('a();  \n\n\t \n'), 'a();\n');
        assert.equal(S.normalizeSource('a();\r\n\r\n   '), 'a();\n');
    });

    test('leading whitespace and spaces at the end of inner lines are kept', () => {
        assert.equal(S.normalizeSource('  a();   \n  b();'), '  a();   \n  b();\n');
    });

    test('$ characters are kept', () => {
        assert.equal(S.normalizeSource(DOLLARS), DOLLARS + '\n');
    });

    for (const [label, value] of HOSTILE) {
        test(`not a string (${label}): ''`, () => {
            assert.equal(S.normalizeSource(value), '');
        });
    }

    test('very long text', () => {
        const text = 'await skills.wait(bot, 1);\r\n'.repeat(20000);
        const result = S.normalizeSource(text);
        assert.equal(result, 'await skills.wait(bot, 1);\n'.repeat(20000));
    });
});

describe('parseGeneratedCode(code)', () => {
    test('one function and a call: ok, the function entry and the top level call', () => {
        const fnText = lines('async function buildWall(bot, length) {', '    await skills.wait(bot, 1);', '    return true;', '}');
        const code = lines('// plan: build a wall', 'const size = 3;', fnText, 'await buildWall(bot, size);');
        const parsed = S.parseGeneratedCode(code);
        assert.equal(parsed.ok, true);
        assert.ok(!parsed.error, 'no error on success');
        assert.equal(parsed.functions.length, 1);
        assert.deepEqual(fnView(parsed.functions[0]), { name: 'buildWall', async: true, params: ['bot', 'length'], source: fnText });
        assert.deepEqual(parsed.topLevelCalls, ['buildWall']);
    });

    test('params: a default value counts with its name; destructured and rest parameters give null', () => {
        const parsed = S.parseGeneratedCode('async function f(bot, n = 3, {a, b}, [c], ...rest) {\n}\nawait f(bot);');
        assert.equal(parsed.ok, true);
        assert.deepEqual(parsed.functions[0].params, ['bot', 'n', null, null, null]);
    });

    test('a function without params has params []', () => {
        const parsed = S.parseGeneratedCode('async function noParams() {\n}\nawait noParams();');
        assert.deepEqual(parsed.functions[0].params, []);
    });

    test('async is false for a plain function', () => {
        const parsed = S.parseGeneratedCode('function plain(bot) {\n    return 1;\n}\nplain(bot);');
        assert.equal(parsed.ok, true);
        assert.equal(parsed.functions[0].async, false);
        assert.equal(parsed.functions[0].name, 'plain');
    });

    test('several declarations are listed in source order', () => {
        const parsed = S.parseGeneratedCode('async function zeta(bot) {}\nfunction alpha(bot) {}\nasync function mid(bot) {}\nawait zeta(bot);');
        assert.deepEqual(parsed.functions.map((f) => f.name), ['zeta', 'alpha', 'mid']);
    });

    test('only DIRECT function declarations are listed: not nested ones, not expressions, not arrows, not in blocks', () => {
        const code = lines(
            'async function outer(bot) {',
            '    function inner() { return 1; }',
            '    return inner();',
            '}',
            'const expr = async function named(bot) {};',
            'const arrow = async (bot) => {};',
            'if (true) { function inBlock() {} }',
            'await outer(bot);',
        );
        const parsed = S.parseGeneratedCode(code);
        assert.equal(parsed.ok, true);
        assert.deepEqual(parsed.functions.map((f) => f.name), ['outer']);
    });

    test('topLevelCalls: plain identifier callees anywhere in the non-declaration statements, no duplicates, first appearance order', () => {
        const code = lines(
            'const n = count(bot);',
            'if (n > 0) {',
            '    await place(bot, n);',
            '} else {',
            '    log(bot, "none");',
            '}',
            'for (let i = 0; i < 2; i++) { await place(bot, i); }',
            '[1, 2].forEach((x) => helper(x));',
            'skills.wait(bot, 1);',
            'bot.chat("hi");',
            'await place(bot, 1);',
            'return finish(bot);',
        );
        const parsed = S.parseGeneratedCode(code);
        assert.equal(parsed.ok, true);
        assert.deepEqual(parsed.topLevelCalls, ['count', 'place', 'log', 'helper', 'finish']);
    });

    test('calls inside function declarations do not count as top level calls', () => {
        const parsed = S.parseGeneratedCode('async function a1(bot) { await b1(bot); }\nasync function b1(bot) { return c1(); }');
        assert.equal(parsed.ok, true);
        assert.deepEqual(parsed.topLevelCalls, []);
    });

    test('a call before the declaration and a top level return are fine', () => {
        const parsed = S.parseGeneratedCode('return await later(bot);\nasync function later(bot) { return 1; }');
        assert.equal(parsed.ok, true);
        assert.deepEqual(parsed.functions.map((f) => f.name), ['later']);
        assert.deepEqual(parsed.topLevelCalls, ['later']);
    });

    test('source is the exact text of the declaration in code, also with CRLF and $ characters', () => {
        const fnText = 'async function f(bot) {\r\n    ' + DOLLARS + '\r\n    return true;\r\n}';
        const code = 'const x = 1;\r\n' + fnText + '\r\nawait f(bot);';
        const parsed = S.parseGeneratedCode(code);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.functions[0].source, fnText);
    });

    test('source includes a doc block inside the body', () => {
        const fnText = lines('async function f(bot) {', '    /**', '     * Does it.', '     **/', '    return true;', '}');
        const parsed = S.parseGeneratedCode('/* before */\n' + fnText + '\nawait f(bot);');
        assert.equal(parsed.functions[0].source, fnText);
    });

    for (const [label, code] of [
        ['a missing brace', 'async function f(bot) {\n    await skills.wait(bot, 1);\n'],
        ['a broken statement', 'const = 5;'],
        ['a stray closing brace', 'await f(bot);\n}}'],
    ]) {
        test(`syntax error (${label}): ok false, error is a message, both arrays empty`, () => {
            const parsed = S.parseGeneratedCode(code);
            assert.equal(parsed.ok, false);
            assert.equal(typeof parsed.error, 'string');
            assert.ok(parsed.error.length > 0);
            assert.deepEqual(parsed.functions, []);
            assert.deepEqual(parsed.topLevelCalls, []);
        });
    }

    test("empty code: ok, no functions, no calls", () => {
        const parsed = S.parseGeneratedCode('');
        assert.equal(parsed.ok, true);
        assert.deepEqual(parsed.functions, []);
        assert.deepEqual(parsed.topLevelCalls, []);
    });

    for (const [label, value] of HOSTILE) {
        test(`never throws: ${label}`, () => {
            let parsed;
            assert.doesNotThrow(() => {
                parsed = S.parseGeneratedCode(value);
            });
            assert.equal(typeof parsed.ok, 'boolean');
            assert.ok(Array.isArray(parsed.functions));
            assert.ok(Array.isArray(parsed.topLevelCalls));
        });
    }

    test('never throws: very long code', () => {
        const code = 'async function big(bot) {\n    return 1;\n}\n' + 'await skills.wait(bot, 1);\n'.repeat(5000) + 'await big(bot);';
        const parsed = S.parseGeneratedCode(code);
        assert.equal(parsed.ok, true);
        assert.deepEqual(parsed.topLevelCalls, ['big']);
    });
});

describe('pickSkillCandidate(parsed)', () => {
    const pick = (code) => S.pickSkillCandidate(S.parseGeneratedCode(code));

    test('one async function with bot first that is called: the entry, reason null', () => {
        const parsed = S.parseGeneratedCode('async function buildWall(bot, n) {\n    return true;\n}\nawait buildWall(bot, 3);');
        const result = S.pickSkillCandidate(parsed);
        assert.equal(result.reason, null);
        assert.deepEqual(result.candidate, parsed.functions[0]);
    });

    const CASES = [
        ['parse_error', 'async function buildWall(bot) {'],
        ['no_function', 'await skills.wait(bot, 1);'],
        ['several_functions', 'async function one(bot) {}\nasync function two(bot) {}\nawait one(bot);\nawait two(bot);'],
        ['not_async', 'function buildWall(bot) {}\nbuildWall(bot);'],
        ['first_parameter_not_bot', 'async function buildWall(b) {}\nawait buildWall(bot);'],
        ['first_parameter_not_bot', 'async function buildWall() {}\nawait buildWall();'],
        ['first_parameter_not_bot', 'async function buildWall({ bot }) {}\nawait buildWall({ bot });'],
        ['not_called', 'async function buildWall(bot) {}'],
        ['not_called', 'async function buildWall(bot) {}\n// await buildWall(bot);'],
        ['not_called', 'async function buildWall(bot) {}\nawait skills.buildWall(bot);'],
    ];
    for (const [reason, code] of CASES) {
        test(`${reason}: ${JSON.stringify(code).slice(0, 70)}`, () => {
            assert.deepEqual(pick(code), { candidate: null, reason });
        });
    }

    test('the FIRST failing reason in the order of the spec wins', () => {
        assert.equal(pick('async function one(bot) {}\nfunction two(x) {}').reason, 'several_functions');
        assert.equal(pick('function buildWall(b) {}').reason, 'not_async');
        assert.equal(pick('async function buildWall(b) {}').reason, 'first_parameter_not_bot');
    });

    test('works on a hand-made parsed object', () => {
        const fn = { name: 'handMade', async: true, params: ['bot', 'n'], source: 'async function handMade(bot, n) {}' };
        assert.deepEqual(S.pickSkillCandidate({ ok: true, error: null, functions: [fn], topLevelCalls: ['other', 'handMade'] }), { candidate: fn, reason: null });
        assert.equal(S.pickSkillCandidate({ ok: false, error: 'x', functions: [], topLevelCalls: [] }).reason, 'parse_error');
    });
});

describe('getDocBlock(functionSource)', () => {
    test('doc closing with **/: raw with delimiters, text without the extra *, trimmed', () => {
        const raw = '/**\n     * Builds a wall.\n     **/';
        const source = lines('async function f(bot) {', '    ' + raw, '    return true;', '}');
        assert.deepEqual(S.getDocBlock(source), { text: '* Builds a wall.', raw });
    });

    test('doc closing with */', () => {
        const raw = '/**\n * Line one.\n * Line two.\n */';
        const source = 'async function f(bot) {\n' + raw + '\n}';
        assert.deepEqual(S.getDocBlock(source), { text: '* Line one.\n * Line two.', raw });
    });

    test('one-line doc', () => {
        assert.deepEqual(S.getDocBlock('async function f(bot) { /** Does it. */ return 1; }'), { text: 'Does it.', raw: '/** Does it. */' });
    });

    test('a doc block BEFORE the opening brace of the body does not count', () => {
        assert.equal(S.getDocBlock('/** Outside. */\nasync function f(bot) {\n    return 1;\n}'), null);
    });

    test('plain block comments and line comments are skipped; the first /** block is used', () => {
        const source = lines('async function f(bot) {', '    // line comment', '    /* plain block */', '    /** The doc. */', '    /** Second doc. */', '}');
        assert.deepEqual(S.getDocBlock(source), { text: 'The doc.', raw: '/** The doc. */' });
    });

    test('a doc block after some statements is found too', () => {
        const source = lines('async function f(bot) {', '    const a = 1;', '    /** Late doc. */', '    return a;', '}');
        assert.deepEqual(S.getDocBlock(source), { text: 'Late doc.', raw: '/** Late doc. */' });
    });

    test('CRLF source', () => {
        const raw = '/**\r\n     * Does it.\r\n     **/';
        const source = 'async function f(bot) {\r\n    ' + raw + '\r\n}';
        assert.deepEqual(S.getDocBlock(source), { text: '* Does it.', raw });
    });

    test('no doc block: null', () => {
        assert.equal(S.getDocBlock('async function f(bot) {\n    return 1;\n}'), null);
        assert.equal(S.getDocBlock('async function f(bot) {\n    /* plain */\n}'), null);
        assert.equal(S.getDocBlock(''), null);
    });
});

describe('firstDocLine(docText)', () => {
    const CASES = [
        ['* Builds a wall.\n     * @param {number} n', 'Builds a wall.'],
        ['*\n * 123 456\n * Real line.', 'Real line.'],
        ['Plain first line.\nSecond.', 'Plain first line.'],
        ['   *   Indented text.', 'Indented text.'],
        ['* @param {MinecraftBot} bot', '@param {MinecraftBot} bot'],
        ['', ''],
        ['*\n*\n', ''],
        ['123\n* 456', ''],
    ];
    for (const [input, expected] of CASES) {
        test(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
            assert.equal(S.firstDocLine(input), expected);
        });
    }
});

describe('buildDocBlock({ name, params, description })', () => {
    test('style of the built-in skills, one @param {*} line per parameter after bot', () => {
        const block = S.buildDocBlock({ name: 'buildWall', params: ['bot', 'length', 'block'], description: 'Builds a wall.' });
        assert.equal(block, [
            '/**',
            ' * Builds a wall.',
            ' * @param {MinecraftBot} bot, reference to the minecraft bot.',
            ' * @param {*} length',
            ' * @param {*} block',
            ' * @returns {Promise<boolean>} true if the skill succeeded, false otherwise.',
            ' * @example',
            ' * await customSkills.buildWall(bot, length, block);',
            ' **/',
        ].join('\n'));
    });

    test('only bot: no @param {*} lines, example with bot only', () => {
        const block = S.buildDocBlock({ name: 'wave', params: ['bot'], description: 'Waves.' });
        assert.equal(block, [
            '/**',
            ' * Waves.',
            ' * @param {MinecraftBot} bot, reference to the minecraft bot.',
            ' * @returns {Promise<boolean>} true if the skill succeeded, false otherwise.',
            ' * @example',
            ' * await customSkills.wave(bot);',
            ' **/',
        ].join('\n'));
    });

    test('$ characters in the description are kept', () => {
        const block = S.buildDocBlock({ name: 'payUp', params: ['bot'], description: 'Costs $& and $1.' });
        assert.equal(block.split('\n')[1], ' * Costs $& and $1.');
    });
});

describe('ensureDocBlock(functionSource, info)', () => {
    const INFO = { name: 'buildWall', params: ['bot', 'length'], description: 'Builds a wall of the given length.' };
    const NO_DOC = lines('async function buildWall(bot, length) {', '    await skills.wait(bot, 1);', '    return true;', '}');

    test('a source with a doc block is returned unchanged', () => {
        const source = lines('async function buildWall(bot, length) {', '    /** Own doc. */', '    return true;', '}');
        assert.equal(S.ensureDocBlock(source, INFO), source);
    });

    test('without a doc block: the built block is inserted directly after the opening brace, lines indented by 4, then a line break', () => {
        const result = S.ensureDocBlock(NO_DOC, INFO);
        const brace = NO_DOC.indexOf('{');
        assert.ok(result.startsWith(NO_DOC.slice(0, brace + 1)), 'text up to the brace unchanged');
        assert.ok(result.endsWith(NO_DOC.slice(brace + 1)), 'rest of the body unchanged');
        assert.ok(result.slice(brace + 1).trimStart().startsWith('/**'), 'the block follows the brace');
        for (const line of S.buildDocBlock(INFO).split('\n')) {
            assert.ok(result.includes('    ' + line), `indented line ${JSON.stringify(line)}`);
        }
        const closeAt = result.indexOf(' **/');
        assert.equal(result[closeAt + 4], '\n', 'a line break follows the block');
        const doc = S.getDocBlock(result);
        assert.ok(doc, 'the result has a doc block');
        assert.equal(S.firstDocLine(doc.text), INFO.description);
    });

    test('the result still parses as the same function', () => {
        const parsed = S.parseGeneratedCode(S.ensureDocBlock(NO_DOC, INFO));
        assert.equal(parsed.ok, true);
        assert.deepEqual(parsed.functions.map((f) => [f.name, f.async, f.params]), [['buildWall', true, ['bot', 'length']]]);
    });

    test('the brace of the BODY is used, not a brace in the parameters', () => {
        const source = lines('async function withOptions(bot, opts = {}) {', '    return opts;', '}');
        const info = { name: 'withOptions', params: ['bot', 'opts'], description: 'Uses options.' };
        const result = S.ensureDocBlock(source, info);
        assert.ok(result.startsWith('async function withOptions(bot, opts = {}) {'), result);
        const parsed = S.parseGeneratedCode(result);
        assert.equal(parsed.ok, true, parsed.error);
        assert.equal(S.firstDocLine(S.getDocBlock(result).text), 'Uses options.');
    });

    test('idempotent', () => {
        const once = S.ensureDocBlock(NO_DOC, INFO);
        assert.equal(S.ensureDocBlock(once, INFO), once);
    });
});

describe('signatureOf(fn)', () => {
    test('name(bot, a, b)', () => {
        assert.equal(S.signatureOf({ name: 'buildWall', async: true, params: ['bot', 'length', 'block'], source: '' }), 'buildWall(bot, length, block)');
    });

    test('bot only', () => {
        assert.equal(S.signatureOf({ name: 'wave', async: true, params: ['bot'], source: '' }), 'wave(bot)');
    });

    test('a null parameter is written arg<position>, counted from 1', () => {
        assert.equal(S.signatureOf({ name: 'f', async: true, params: ['bot', null, 'n', null], source: '' }), 'f(bot, arg2, n, arg4)');
    });

    test('from parseGeneratedCode', () => {
        const parsed = S.parseGeneratedCode('async function g(bot, n = 1, {a}) {}\nawait g(bot);');
        assert.equal(S.signatureOf(parsed.functions[0]), 'g(bot, n, arg3)');
    });
});

describe('instrument(source)', () => {
    test('like Coder._stageCode after normalizeSource: console.log(, log(", ;\\n', () => {
        const source = 'async function f(bot) {\r\n    console.log("start");\r\n    log("mid");\r\n    await skills.wait(bot, 1);\r\n    return true;\r\n}\r\n\r\n';
        const expected = 'async function f(bot) {\n'
            + '    log(bot,"start"); ' + INTERRUPT + '\n'
            + '    log(bot,"mid"); ' + INTERRUPT + '\n'
            + '    await skills.wait(bot, 1); ' + INTERRUPT + '\n'
            + '    return true; ' + INTERRUPT + '\n'
            + '}\n';
        assert.equal(S.instrument(source), expected);
    });

    test('a ; that is not followed by a line break is not changed', () => {
        assert.equal(S.instrument('for (let i = 0; i < 3; i++) { a(); }'), 'for (let i = 0; i < 3; i++) { a(); }\n');
    });

    test('the last statement gets the check too, because the normalized source ends with \\n', () => {
        assert.equal(S.instrument('a();'), 'a(); ' + INTERRUPT + '\n');
    });

    test('$ characters in the source are kept', () => {
        assert.equal(S.instrument(DOLLARS), DOLLARS + ' ' + INTERRUPT + '\n');
    });

    test('not a string: \'\' (normalizeSource first)', () => {
        assert.equal(S.instrument(undefined), '');
        assert.equal(S.instrument(null), '');
    });
});

// Amendment 2, B2: the loader evaluates '(' + text + ')'; this check makes sure the text is one
// async function declaration and nothing else, so no code runs while the skills are loaded.
describe('isSingleFunction(name, text)', () => {
    const one = lines('async function buildWall(bot, length) {', '    /** Builds a wall. */', '    return length > 0;', '}', '');
    const TRUE = [
        ['one async function declaration', one],
        ['after instrument', S.instrument(lines('async function buildWall(bot) {', '    console.log("x");', '    await skills.wait(bot, 1);', '    return true;', '}'))],
        ['with comments around it', '// saved skill\n/* v2 */\n' + one + '// end\n'],
        ['CRLF line endings', one.replace(/\n/g, '\r\n')],
        ['without a line break at the end', one.trimEnd()],
        ['a nested function and a class inside', lines('async function buildWall(bot) {', '    class A {}', '    function inner() { return new A(); }', '    return inner();', '}')],
    ];
    for (const [label, text] of TRUE) {
        test(`true: ${label}`, () => {
            assert.equal(S.isSingleFunction('buildWall', text), true);
        });
    }

    const ESCAPE = 'async function buildWall(bot) { return 1; }) && (customSkills.other = 1, true) && (async function buildWall(bot) { return 1; }';
    const FALSE = [
        ['another name', one, 'buildRoof'],
        ['not async', one.replace('async function', 'function'), 'buildWall'],
        ['an async generator', one.replace('async function buildWall', 'async function* buildWall'), 'buildWall'],
        ['two statements', one + 'buildWall(bot);\n', 'buildWall'],
        ['a function and an empty statement', one.trimEnd() + ';\n', 'buildWall'],
        ['two functions', one + one.replace('buildWall', 'buildRoof'), 'buildWall'],
        ['the text closes the parenthesis of the loader and runs code', ESCAPE, 'buildWall'],
        ['a function expression in parentheses', '(' + one.trimEnd() + ')', 'buildWall'],
        ['an arrow function in a const', 'const buildWall = async (bot) => true;\n', 'buildWall'],
        ['an expression statement that calls code', '(() => { globalThis.x = 1; })()\n', 'buildWall'],
        ['a syntax error', 'async function buildWall(bot) {\n    return (;\n}\n', 'buildWall'],
        ['an empty text', '', 'buildWall'],
        ['only a comment', '/** Builds a wall. */\n', 'buildWall'],
        ['a class', 'class buildWall {}\n', 'buildWall'],
        ['an import', 'import x from "fs";\n', 'buildWall'],
    ];
    for (const [label, text, name] of FALSE) {
        test(`false: ${label}`, () => {
            assert.equal(S.isSingleFunction(name, text), false);
        });
    }

    test('never throws: false for hostile arguments', () => {
        for (const [name, text] of [[undefined, undefined], [null, null], ['buildWall', 42], [42, one], [{}, {}], ['buildWall', { toString: () => one }], ['', one]]) {
            let result;
            assert.doesNotThrow(() => {
                result = S.isSingleFunction(name, text);
            });
            assert.equal(result, false, `${String(name)}`);
        }
    });
});

// Spec v0.1.4.5, G3: a function is trivial when its body contains no loop (for, for...of, for...in,
// while, do) and at most ONE call whose callee starts with skills., world. or customSkills. Calls
// inside nested functions count. A source that does not parse: false. Never throws.
describe('isTrivialFunction(functionSource) (v0.1.4.5, G3)', () => {
    const fn = (...body) => lines('async function collectLogs(bot, count) {', '    /**', '     * Collects logs.', '     **/', ...body.map((l) => '    ' + l), '}', '');
    const TRUE = [
        ['no call at all', fn('return count > 0;')],
        ['an empty body', 'async function f(bot) {}'],
        ['one call of skills.', fn("await skills.collectBlock(bot, 'oak_log', count);", 'return true;')],
        ['one call of world.', fn("const block = world.getNearestBlock(bot, 'oak_log', 16);", 'return block !== null;')],
        ['one call of customSkills.', fn('return await customSkills.buildWall(bot, count);')],
        ['one sandbox call and calls of bot, log, Math, JSON and a local helper',
            fn("await skills.goToPosition(bot, 1, 2, 3);", "log(bot, 'done');", "bot.chat('hi');", 'const n = Math.max(1, count);', 'JSON.stringify({ n });', 'const helper = (x) => x + 1;', 'return helper(n) > 0;')],
        ['names that only look like the sandbox objects', fn('mySkills.a(); skillsX.b(); worldly.c(); this_world(); customSkillsList.d();', 'await skills.wait(bot, 1);')],
        ['a member of another object named skills', fn('bot.skills.a(); bot.world.b(); await skills.wait(bot, 1);')],
        ['if, else, try, catch and switch are no loops', fn('if (count > 1) { await skills.wait(bot, 1); } else { log(bot, "x"); }', 'try { JSON.parse("1"); } catch (e) { return false; }', 'switch (count) { case 1: break; default: return true; }')],
        ['array methods are no loops', fn('[1, 2].forEach((x) => log(bot, x));', '[1].map((x) => x * 2);', "await skills.wait(bot, 1);")],
        ['loops and sandbox calls in comments and strings do not count', fn("// for (;;) skills.a(); world.b();", "log(bot, 'while (true) { skills.a(); world.b(); }');", '/* do { customSkills.x(); } while (1) */', 'return true;')],
        ['a sandbox function passed as a value is no call', fn('const f = skills.wait;', 'const g = world.getNearestBlock;', 'return typeof f === typeof g;')],
        ['new of a sandbox member is no call', fn('const v = new world.Thing();', 'await skills.wait(bot, 1);')],
        ['a loop in the parameters is not in the body', 'async function f(bot, n = [1].map((x) => { for (;;) { break; } return x; })) {\n    return n;\n}\n'],
    ];
    for (const [label, source] of TRUE) {
        test(`true: ${label}`, () => {
            assert.equal(S.isTrivialFunction(source), true, source);
        });
    }

    const FALSE = [
        ['a for loop', fn('for (let i = 0; i < count; i++) { log(bot, i); }')],
        ['a for...of loop', fn('for (const x of [1, 2]) { log(bot, x); }')],
        ['a for...in loop', fn('for (const k in bot) { log(bot, k); }')],
        ['a for await loop', fn('for await (const x of []) { log(bot, x); }')],
        ['a while loop', fn('while (count-- > 0) { log(bot, count); }')],
        ['a do...while loop', fn('do { count--; } while (count > 0);')],
        ['a loop without a block', fn('while (count-- > 0) log(bot, count);')],
        ['a loop inside a nested function', fn('const repeat = () => { for (let i = 0; i < 2; i++) log(bot, i); };', 'repeat();')],
        ['two calls of skills.', fn("await skills.collectBlock(bot, 'oak_log', count);", "await skills.craftRecipe(bot, 'oak_planks', 1);")],
        ['a skills. and a world. call', fn("const b = world.getNearestBlock(bot, 'x', 16);", 'await skills.breakBlockAt(bot, b.position.x, b.position.y, b.position.z);')],
        ['a world. and a customSkills. call', fn('world.getInventoryCounts(bot);', 'await customSkills.buildWall(bot, 1);')],
        ['two customSkills. calls', fn('await customSkills.buildWall(bot, 1);', 'await customSkills.buildWall(bot, 2);')],
        ['the same call twice', fn('await skills.wait(bot, 1);', 'await skills.wait(bot, 1);')],
        ['a call inside a nested function counts', fn('const go = async () => skills.goToPosition(bot, 1, 2, 3);', "await skills.collectBlock(bot, 'oak_log', 1);")],
        ['a call inside a nested function declaration counts', fn('async function inner() { await world.getNearestBlock(bot, "x", 1); }', 'await inner();', 'await skills.wait(bot, 1);')],
        ['a computed member counts', fn("await skills['collectBlock'](bot, 'oak_log', 1);", 'await skills.wait(bot, 1);')],
        ['an optional call counts', fn('await skills.wait?.(bot, 1);', 'await world.getNearestBlock?.(bot, "x", 1);')],
        ['optional member access counts', fn('await skills?.wait(bot, 1);', 'await world?.getNearestBlock(bot, "x", 1);')],
        ['an optional chain in parentheses as callee counts', fn('await (skills?.wait)(bot, 1);', 'await (world?.a.b)(bot);')],
        ['a deeper member chain counts', fn('skills.wait.call(null, bot, 1);', 'world.a.b.c(bot);')],
        ['calls in arguments of another call count', fn('log(bot, world.getInventoryCounts(bot), world.getPosition(bot));')],
    ];
    for (const [label, source] of FALSE) {
        test(`false: ${label}`, () => {
            assert.equal(S.isTrivialFunction(source), false, source);
        });
    }

    for (const [label, source] of [
        ['a syntax error', 'async function f(bot) {\n    return (;\n}\n'],
        ['an empty text', ''],
        ['no function at all', 'const x = 1;\n'],
        ['only a comment', '/** Collects logs. */\n'],
    ]) {
        test(`false: ${label}`, () => {
            assert.equal(S.isTrivialFunction(source), false);
        });
    }

    test('never throws: false for values that are not a string', () => {
        for (const value of [undefined, null, 42, {}, [], { toString: () => 'async function f(bot) {}' }, Symbol('x')]) {
            let result;
            assert.doesNotThrow(() => {
                result = S.isTrivialFunction(value);
            });
            assert.equal(result, false, String(typeof value));
        }
    });

    test('CRLF line endings and the instrumented form give the same answer', () => {
        const one = fn("await skills.collectBlock(bot, 'oak_log', count);", 'return true;');
        assert.equal(S.isTrivialFunction(one.replace(/\n/g, '\r\n')), true);
        assert.equal(S.isTrivialFunction(S.instrument(one)), true);
    });
});

describe('module rules', () => {
    test('pure: imports only espree, sibling skill modules and built-ins without I/O; no mineflayer, no model SDK, not skills.js or world.js', () => {
        assertSkillModuleImports(MODULE, { pure: true, allowPackages: ['espree'] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
