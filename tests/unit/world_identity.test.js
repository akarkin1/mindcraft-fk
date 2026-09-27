// Spec v0.1.4.3 W1: src/agent/world/world_identity.js -- hashedSeedToKey, sanitizeWorldId,
// motdToText, resolveWorld. Pure functions, no disk access.
//
// Expected hex values are computed in the test with BigInt.asUintN(64, ...), never by hand.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/world/world_identity.js';
const W = await loadSrc(MODULE);

function api(name) {
    const fn = W[name];
    assert.equal(typeof fn, 'function', `${name} must be an exported function`);
    return fn;
}

const ZERO = '0'.repeat(16);
const hex64 = (value) => BigInt.asUintN(64, BigInt(value)).toString(16).padStart(16, '0');
// [high, low] words -> unsigned 64-bit hex, each word read as unsigned 32 bit.
const words = (high, low) => hex64((BigInt.asUintN(32, BigInt(high)) << 32n) | BigInt.asUintN(32, BigInt(low)));
const sha16 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
const SECTION = '§'; // the Minecraft colour code character

describe('hashedSeedToKey: bigint', () => {
    const CASES = [0n, 1n, -1n, 255n, 2n ** 63n - 1n, -(2n ** 63n), 2n ** 64n - 1n, 2n ** 64n + 5n, -(2n ** 64n) - 3n, 123456789012345678n, -987654321098765432n];
    for (const value of CASES) {
        test(`${value}n -> hex of BigInt.asUintN(64, value)`, () => {
            assert.equal(api('hashedSeedToKey')(value), hex64(value));
        });
    }

    test('spec example: -1n gives ffffffffffffffff; result is 16 lowercase hex characters', () => {
        assert.equal(api('hashedSeedToKey')(-1n), 'ffffffffffffffff');
        assert.match(api('hashedSeedToKey')(0xABCDEFn), /^[0-9a-f]{16}$/);
    });
});

describe('hashedSeedToKey: [high, low] arrays', () => {
    const CASES = [
        [[0, 1], '0000000000000001'],
        [[1, 0], '0000000100000000'],
        [[-1, -1], 'ffffffffffffffff'],
    ];
    for (const [input, expected] of CASES) {
        test(`spec example ${JSON.stringify(input)} -> ${expected}`, () => {
            assert.equal(expected, words(...input), 'self check of the test helper');
            assert.equal(api('hashedSeedToKey')(input), expected);
        });
    }

    const WORD_CASES = [
        [0x12345678, 0x9abcdef0], // low word with bit 31 set, unsigned form
        [0x12345678, 0x9abcdef0 | 0], // same low word in signed form (negative)
        [0x7fffffff, 0x80000000],
        [-2147483648, 2147483647], // signed range boundaries
        [4294967295, 0], // unsigned range maximum as high word
        [-2147483648, -2147483648],
        [0, 4294967295],
        [-1234567, 7654321],
    ];
    for (const [high, low] of WORD_CASES) {
        test(`[${high}, ${low}] -> high word then low word, each unsigned 32 bit`, () => {
            assert.equal(api('hashedSeedToKey')([high, low]), words(high, low));
        });
    }

    test('signed and unsigned forms of the same words give the same key', () => {
        const fn = api('hashedSeedToKey');
        assert.equal(fn([0x12345678, 0x9abcdef0]), fn([0x12345678, 0x9abcdef0 | 0]));
        assert.equal(fn([0xffffffff, 0x80000001]), fn([-1, -2147483647]));
    });

    test('an array carrying valueOf / toString methods: only elements 0 and 1 are read', () => {
        const arr = [0x0badcafe, 0xdeadbeef | 0];
        arr.valueOf = () => 42n;
        arr.toString = () => '42';
        assert.equal(api('hashedSeedToKey')(arr), words(0x0badcafe, 0xdeadbeef));
    });

    test('an array-like object (not an Array) with length 2 and a valueOf method', () => {
        const like = { 0: -5, 1: 0x80000000, length: 2, valueOf() { return 7; } };
        assert.equal(api('hashedSeedToKey')(like), words(-5, 0x80000000));
    });

    const BAD = [
        [[], 'empty array'],
        [[1], 'one element'],
        [[1, 2, 3], 'three elements'],
        [[1.5, 0], 'non-integer high word'],
        [[0, 0.25], 'non-integer low word'],
        [[NaN, 0], 'NaN word'],
        [[0, Infinity], 'Infinity word'],
        [['1', '2'], 'string elements'],
        [[null, 1], 'null element'],
        [[undefined, 1], 'undefined element'],
        [[4294967296, 0], 'high word 2^32 (above the unsigned 32-bit range)'],
        [[0, -2147483649], 'low word below the signed 32-bit range'],
        [[0, 2 ** 32], 'low word 2^32'],
    ];
    for (const [input, label] of BAD) {
        test(`${label}: null`, () => {
            assert.equal(api('hashedSeedToKey')(input), null);
        });
    }
});

describe('hashedSeedToKey: numbers and strings', () => {
    const NUMBERS = [0, 1, -1, 42, -42, 2 ** 32, -(2 ** 32) - 7, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, -0];
    for (const n of NUMBERS) {
        test(`safe integer ${Object.is(n, -0) ? '-0' : n} -> as bigint`, () => {
            assert.equal(api('hashedSeedToKey')(n), hex64(n));
        });
    }

    test('spec example: 0 gives sixteen zeros', () => {
        assert.equal(api('hashedSeedToKey')(0), ZERO);
    });

    for (const n of [0.5, -1.25, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53), 1e300]) {
        test(`number ${n} (not a safe integer): null`, () => {
            assert.equal(api('hashedSeedToKey')(n), null);
        });
    }

    const STRINGS = ['0', '1', '-1', '42', '-0', '000123', '9223372036854775807', '-9223372036854775808', '18446744073709551615', '18446744073709551617', '-123456789012345678901234567890'];
    for (const s of STRINGS) {
        test(`decimal string "${s}" -> as bigint`, () => {
            assert.equal(api('hashedSeedToKey')(s), hex64(BigInt(s)));
        });
    }

    for (const s of ['', '-', '+1', '--1', '1.5', '1e3', '0x10', 'abc', ' 12', '12 ', '1 2', '12n', '١٢']) {
        test(`string ${JSON.stringify(s)}: null`, () => {
            assert.equal(api('hashedSeedToKey')(s), null);
        });
    }
});

describe('hashedSeedToKey: anything else is null and it never throws', () => {
    const OTHERS = [
        ['undefined', undefined],
        ['null', null],
        ['true', true],
        ['an empty object', {}],
        ['an object with valueOf only', { valueOf: () => 5 }],
        ['a function', () => 1],
        ['a symbol', Symbol('seed')],
        ['a Date', new Date(0)],
        ['an array-like of length 3', { 0: 1, 1: 2, 2: 3, length: 3 }],
    ];
    for (const [label, value] of OTHERS) {
        test(`${label}: null`, () => {
            const fn = api('hashedSeedToKey');
            let result;
            assert.doesNotThrow(() => {
                result = fn(value);
            });
            assert.equal(result, null);
        });
    }

    test('an array whose elements throw on access: no throw, null', () => {
        const fn = api('hashedSeedToKey');
        const hostile = new Proxy([1, 2], {
            get(target, prop) {
                if (prop === '0' || prop === '1') throw new Error('boom');
                return Reflect.get(target, prop);
            },
        });
        let result;
        assert.doesNotThrow(() => {
            result = fn(hostile);
        });
        assert.equal(result, null);
    });
});

describe('sanitizeWorldId(text)', () => {
    const CASES = [
        ['abc', 'abc'],
        ['Az09_-', 'Az09_-'],
        ['  my world  ', 'my_world'],
        ['a.b/c\\d:e', 'a_b_c_d_e'],
        ['café', 'caf_'],
        ['a\tb', 'a_b'],
        ['!', '_'],
        ['a  b', 'a__b'],
        ['x'.repeat(48), 'x'.repeat(48)],
        ['x'.repeat(49), 'x'.repeat(48)],
        ['y'.repeat(100), 'y'.repeat(48)],
        ['   ' + 'z'.repeat(50) + '   ', 'z'.repeat(48)],
        ['a'.repeat(47) + 'é' + 'b', 'a'.repeat(47) + '_'],
    ];
    const show = (s) => JSON.stringify(s.length > 30 ? s.slice(0, 20) + '...' : s);
    for (const [input, expected] of CASES) {
        test(`${show(input)} (${input.length} chars) -> ${show(expected)} (${expected.length} chars)`, () => {
            assert.equal(api('sanitizeWorldId')(input), expected);
        });
    }

    for (const input of ['', '   ', '\t\n ']) {
        test(`${JSON.stringify(input)}: empty after trimming -> null`, () => {
            assert.equal(api('sanitizeWorldId')(input), null);
        });
    }

    for (const [label, value] of [['undefined', undefined], ['null', null], ['a number', 42], ['an object', { id: 'x' }], ['an array', ['x']], ['a boolean', true]]) {
        test(`not a string (${label}): null`, () => {
            assert.equal(api('sanitizeWorldId')(value), null);
        });
    }
});

describe('motdToText(motd)', () => {
    const CASES = [
        ['a string', 'A Minecraft Server', 'A Minecraft Server'],
        ['an object with text only', { text: 'Hello' }, 'Hello'],
        ['an object with extra only', { extra: [{ text: 'Only' }, { text: ' extra' }] }, 'Only extra'],
        ['text followed by extra, recursively, with string elements', { text: 'A', extra: [{ text: 'B' }, 'C', { text: 'D', extra: [{ text: 'E' }, { extra: ['F'] }] }] }, 'ABCDEF'],
        ['an NBT string { type, value }', { type: 'string', value: 'Nbt Server' }, 'Nbt Server'],
        ['an NBT compound whose value is a text object', { type: 'compound', value: { text: 'Hi ', extra: [{ type: 'string', value: 'there' }] } }, 'Hi there'],
        ['an array of mixed elements, joined without separator', ['A', { text: 'B' }, ['C', { type: 'string', value: 'D' }]], 'ABCD'],
        ['an empty string', '', ''],
        ['an empty object', {}, ''],
        ['a number', 42, ''],
        ['a boolean', true, ''],
        ['null', null, ''],
        ['undefined', undefined, ''],
    ];
    for (const [label, input, expected] of CASES) {
        test(`${label} -> ${JSON.stringify(expected)}`, () => {
            assert.equal(api('motdToText')(input), expected);
        });
    }

    const S = SECTION;
    const CLEAN = [
        ['colour codes are removed', `${S}aHello ${S}lWorld${S}r`, 'Hello World'],
        ['a trailing colour code character is removed', `abc${S}`, 'abc'],
        ['colour codes inside components', { text: `${S}6Gold`, extra: [{ text: ` ${S}kX${S}r!` }] }, 'Gold X!'],
        ['control characters are removed', 'a\u0000b\u0007c\u001bd', 'abcd'],
        ['line feed becomes a space (Amendment 1, M4)', 'A\nB', 'A B'],
        ['tab becomes a space (M4)', 'A\tB', 'A B'],
        ['vertical tab and form feed become spaces (M4)', 'A\u000bB\fC', 'A B C'],
        ['CR LF becomes one space after collapsing (M4)', 'A\r\nB', 'A B'],
        ['a line feed next to a removed control character (M4)', 'A\u0007\nB', 'A B'],
        ['multi-line motd from a component (M4)', { text: 'Line one\n', extra: ['\tLine two'] }, 'Line one Line two'],
        ['runs of spaces collapse to one space and the result is trimmed', '   a    b  c   ', 'a b c'],
        ['a gap left by a removed colour code collapses', `a ${S}r b`, 'a b'],
        ['cut to 80 characters', 'x'.repeat(100), 'x'.repeat(80)],
        ['cut after trimming and collapsing', '    ' + 'y'.repeat(85), 'y'.repeat(80)],
        ['cut after removing colour codes', `${S}a` + 'z'.repeat(80), 'z'.repeat(80)],
        ['exactly 80 characters stay', 'w'.repeat(80), 'w'.repeat(80)],
    ];
    for (const [label, input, expected] of CLEAN) {
        test(label, () => {
            assert.equal(api('motdToText')(input), expected);
        });
    }

    test('never throws: cyclic component, throwing getter, symbol, function', () => {
        const fn = api('motdToText');
        const cyclic = { text: 'loop' };
        cyclic.extra = [cyclic];
        const hostile = { get text() { throw new Error('boom'); } };
        for (const value of [cyclic, hostile, Symbol('m'), () => 'x']) {
            let result;
            assert.doesNotThrow(() => {
                result = fn(value);
            });
            assert.equal(typeof result, 'string');
            assert.ok(result.length <= 80);
        }
    });
});

describe('resolveWorld(input)', () => {
    const KEYS = ['hashedSeedHex', 'isFlat', 'isHardcore', 'key', 'label', 'source'];

    test('returns exactly the keys key, source, label, hashedSeedHex, isHardcore, isFlat', () => {
        assert.deepEqual(Object.keys(api('resolveWorld')({ hashedSeed: 1n })).sort(), KEYS);
    });

    test('1. override: sanitized world id wins over seed and motd, label is the motd text', () => {
        const world = api('resolveWorld')({ worldId: '  My Realm!  ', hashedSeed: [0, 1], motd: `${SECTION}aThe Server`, isHardcore: true, isFlat: false });
        assert.deepEqual(world, {
            key: 'id-My_Realm_',
            source: 'override',
            label: 'The Server',
            hashedSeedHex: '0000000000000001',
            isHardcore: true,
            isFlat: false,
        });
    });

    test('1. override without motd: label is the key', () => {
        const world = api('resolveWorld')({ worldId: 'home' });
        assert.equal(world.key, 'id-home');
        assert.equal(world.source, 'override');
        assert.equal(world.label, 'id-home');
        assert.equal(world.hashedSeedHex, null);
    });

    for (const [label, worldId] of [['empty', ''], ['blank', '   '], ['a number', 42], ['null', null]]) {
        test(`world id ${label} (sanitizes to null) is skipped: the seed decides`, () => {
            const world = api('resolveWorld')({ worldId, hashedSeed: [0x12345678, 0x9abcdef0 | 0] });
            assert.equal(world.key, `seed-${words(0x12345678, 0x9abcdef0)}`);
            assert.equal(world.source, 'seed');
        });
    }

    test('2. seed: key seed-<hex>, label is the key when there is no motd', () => {
        const world = api('resolveWorld')({ hashedSeed: -2n });
        assert.deepEqual(world, {
            key: `seed-${hex64(-2n)}`,
            source: 'seed',
            label: `seed-${hex64(-2n)}`,
            hashedSeedHex: hex64(-2n),
            isHardcore: null,
            isFlat: null,
        });
    });

    test('2. seed with motd: key from the seed, label from the motd', () => {
        const world = api('resolveWorld')({ hashedSeed: '12345', motd: { text: 'Lobby', extra: [' 1'] } });
        assert.equal(world.key, `seed-${hex64(12345n)}`);
        assert.equal(world.label, 'Lobby 1');
        assert.equal(world.source, 'seed');
    });

    test('3. all-zero seed with motd: fallback key motd-<first 16 hex of SHA-256 of the text>, hashedSeedHex still sixteen zeros', () => {
        const world = api('resolveWorld')({ hashedSeed: [0, 0], motd: `${SECTION}bMy Server` });
        assert.equal(world.key, `motd-${sha16('My Server')}`);
        assert.equal(world.source, 'fallback');
        assert.equal(world.label, 'My Server');
        assert.equal(world.hashedSeedHex, ZERO);
    });

    test('3. fallback hashes the UTF-8 bytes of the cleaned text', () => {
        const world = api('resolveWorld')({ motd: '  Café   ★  Welt  ' });
        assert.equal(world.key, `motd-${sha16('Café ★ Welt')}`);
        assert.equal(world.label, 'Café ★ Welt');
        assert.equal(world.hashedSeedHex, null);
    });

    test('3. an invalid seed falls back to the motd', () => {
        const world = api('resolveWorld')({ hashedSeed: [1, 2, 3], motd: 'Srv' });
        assert.equal(world.key, `motd-${sha16('Srv')}`);
        assert.equal(world.source, 'fallback');
        assert.equal(world.hashedSeedHex, null);
    });

    test('4. all-zero seed and a motd that cleans to nothing: unknown', () => {
        const world = api('resolveWorld')({ hashedSeed: 0n, motd: `${SECTION}r  ` });
        assert.deepEqual(world, { key: 'unknown', source: 'unknown', label: 'unknown', hashedSeedHex: ZERO, isHardcore: null, isFlat: null });
    });

    for (const [label, input] of [['undefined', undefined], ['null', null], ['an empty object', {}], ['a number', 7], ['a string', 'seed'], ['an array', [0, 1]]]) {
        test(`input ${label}: never throws, world unknown`, () => {
            const fn = api('resolveWorld');
            let world;
            assert.doesNotThrow(() => {
                world = fn(input);
            });
            assert.deepEqual(world, { key: 'unknown', source: 'unknown', label: 'unknown', hashedSeedHex: null, isHardcore: null, isFlat: null });
        });
    }

    for (const [label, value, expected] of [['true', true, true], ['false', false, false], ['1', 1, null], ['"true"', 'true', null], ['undefined', undefined, null], ['null', null, null]]) {
        test(`isHardcore / isFlat ${label} -> ${expected}`, () => {
            const world = api('resolveWorld')({ hashedSeed: 5n, isHardcore: value, isFlat: value });
            assert.equal(world.isHardcore, expected);
            assert.equal(world.isFlat, expected);
        });
    }

    test('does not throw for an input whose getter throws', () => {
        const fn = api('resolveWorld');
        const input = { get hashedSeed() { throw new Error('boom'); }, motd: 'x' };
        assert.doesNotThrow(() => fn(input));
    });
});

describe('module rules', () => {
    test('imports nothing but node:crypto (pure module)', () => {
        assertImportRules(MODULE, { allowBuiltins: ['crypto'], allowedRelative: [] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
