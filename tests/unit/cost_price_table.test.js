// Spec v0.1.4.6 C2: src/agent/cost/price_table.js -- DEFAULT_PRICES, priceFor and costOf.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/cost/price_table.js';
const P = await loadSrc(MODULE);

const HAIKU = { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 };
const SONNET = { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 };
const OPUS_5 = { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 };
const OPUS_5_5 = { input: 4, output: 20, cache_read: 0.4, cache_write: 5 };

describe('module', () => {
    test('imports nothing', () => {
        assertImportRules(MODULE, { allowBuiltins: [], allowedRelative: [] });
    });

    test('imports without output and without creating files', () => {
        assertCleanImport(MODULE);
    });
});

describe('DEFAULT_PRICES', () => {
    test('dollars per million tokens as in the spec', () => {
        assert.deepEqual(JSON.parse(JSON.stringify(P.DEFAULT_PRICES)), {
            'claude-haiku-4-5': { input: 1, output: 5 },
            'claude-sonnet-5': { input: 2, output: 10 },
            'claude-opus-5': { input: 5, output: 25 },
            'claude-opus-5-5': { input: 4, output: 20 },
            // v0.1.4.9 (I9)
            'gpt-6-luna': { input: 0.10, output: 0.50, cache_read: 0.01 },
            'text-embedding-3-small': { input: 0.02, output: 0 },
        });
    });

    test('is frozen, also its entries', () => {
        assert.ok(Object.isFrozen(P.DEFAULT_PRICES));
        for (const entry of Object.values(P.DEFAULT_PRICES)) assert.ok(Object.isFrozen(entry));
    });
});

describe('priceFor', () => {
    test('the exact model id, with cache prices derived from the input price', () => {
        assert.deepEqual(P.priceFor('claude-haiku-4-5'), HAIKU);
        assert.deepEqual(P.priceFor('claude-sonnet-5'), SONNET);
        assert.deepEqual(P.priceFor('claude-opus-5'), OPUS_5);
        assert.deepEqual(P.priceFor('claude-opus-5-5'), OPUS_5_5);
    });

    test('a dated model id finds the key it starts with', () => {
        assert.deepEqual(P.priceFor('claude-haiku-4-5-20251001'), HAIKU);
        assert.deepEqual(P.priceFor('claude-sonnet-5-20260101'), SONNET);
    });

    test('the longest key that the model id starts with wins', () => {
        assert.deepEqual(P.priceFor('claude-opus-5-5-20260901'), OPUS_5_5);
        assert.deepEqual(P.priceFor('claude-opus-5-20260101'), OPUS_5);
    });

    test('a model without an entry, or a model id that is not a string, gives null', () => {
        for (const model of ['claude-sonnet-4-20250514', 'gpt-4o', 'claude', 'claude-haiku-4', '', undefined, null, 42, {}]) {
            assert.equal(P.priceFor(model), null, String(model));
        }
    });

    test('overrides come first, also with a shorter key', () => {
        const overrides = { 'claude-haiku-4-5': { input: 0.8, output: 4 } };
        assert.deepEqual(P.priceFor('claude-haiku-4-5-20251001', overrides), { input: 0.8, output: 4, cache_read: 0.08, cache_write: 1 });
        assert.deepEqual(P.priceFor('claude-opus-5-5', { claude: { input: 9, output: 9 } }), { input: 9, output: 9, cache_read: 0.9, cache_write: 11.25 });
    });

    test('among the overrides the longest key wins', () => {
        const overrides = { 'claude-opus': { input: 1, output: 1 }, 'claude-opus-5': { input: 2, output: 2 } };
        assert.equal(P.priceFor('claude-opus-5-5', overrides).input, 2);
        assert.equal(P.priceFor('claude-opus-4', overrides).input, 1);
        const reversed = { 'claude-opus-5': { input: 2, output: 2 }, 'claude-opus': { input: 1, output: 1 } };
        assert.equal(P.priceFor('claude-opus-5-5', reversed).input, 2, 'the order of the keys does not matter');
    });

    test('an override prices a model that has no default entry, 0 is a valid price', () => {
        assert.deepEqual(P.priceFor('my-local-model', { 'my-local-model': { input: 0, output: 0 } }), { input: 0, output: 0, cache_read: 0, cache_write: 0 });
    });

    test('cache prices given in the entry are used, also 0', () => {
        const overrides = { 'claude-sonnet-5': { input: 3, output: 15, cache_read: 0.3, cache_write: 0 } };
        assert.deepEqual(P.priceFor('claude-sonnet-5', overrides), { input: 3, output: 15, cache_read: 0.3, cache_write: 0 });
    });

    test('derived cache prices show no rounding noise', () => {
        assert.deepEqual(P.priceFor('m', { m: { input: 3, output: 15 } }), { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 });
        assert.deepEqual(P.priceFor('m', { m: { input: 0.3, output: 1 } }), { input: 0.3, output: 1, cache_read: 0.03, cache_write: 0.375 });
        assert.deepEqual(P.priceFor('m', { m: { input: 0.7, output: 1 } }), { input: 0.7, output: 1, cache_read: 0.07, cache_write: 0.875 });
    });

    test('invalid override entries are skipped, the defaults apply', () => {
        const invalid = [
            { input: 'x', output: 5 },
            { input: -1, output: 5 },
            { input: 1 },
            { output: 5 },
            { input: 1, output: Infinity },
            { input: 1, output: 5, cache_read: -1 },
            null,
            'cheap',
            [1, 5],
        ];
        for (const entry of invalid) {
            assert.deepEqual(P.priceFor('claude-haiku-4-5', { 'claude-haiku-4-5': entry }), HAIKU, JSON.stringify(entry));
        }
    });

    test('an invalid cache price in an override falls back to the derived one', () => {
        assert.deepEqual(P.priceFor('m', { m: { input: 2, output: 4, cache_read: 'x', cache_write: NaN } }), { input: 2, output: 4, cache_read: 0.2, cache_write: 2.5 });
    });

    test('overrides that are not an object are ignored, an empty key matches nothing', () => {
        for (const overrides of [null, undefined, 'x', 5, [{ input: 1, output: 1 }]]) {
            assert.deepEqual(P.priceFor('claude-haiku-4-5', overrides), HAIKU);
        }
        assert.equal(P.priceFor('gpt-4o', { '': { input: 1, output: 1 } }), null);
    });

    test('returns a copy: changing it changes neither later results nor DEFAULT_PRICES', () => {
        const price = P.priceFor('claude-haiku-4-5');
        price.input = 999;
        assert.deepEqual(P.priceFor('claude-haiku-4-5'), HAIKU);
        assert.equal(P.DEFAULT_PRICES['claude-haiku-4-5'].input, 1);
    });
});

describe('costOf', () => {
    test('a null price gives null', () => {
        assert.equal(P.costOf({ input_tokens: 1000 }, null), null);
        assert.equal(P.costOf({ input_tokens: 1000 }, undefined), null);
    });

    test('dollars of one report: tokens times dollars per million tokens', () => {
        const usage = { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 2000, cache_write_tokens: 400 };
        // 1000 * 1 + 500 * 5 + 2000 * 0.1 + 400 * 1.25 = 1000 + 2500 + 200 + 500 = 4200 per million
        assert.equal(P.costOf(usage, P.priceFor('claude-haiku-4-5')), 0.0042);
        assert.equal(P.costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, P.priceFor('claude-opus-5-5')), 24);
    });

    test('missing and invalid numbers count as 0', () => {
        const price = P.priceFor('claude-haiku-4-5');
        assert.equal(P.costOf({}, price), 0);
        assert.equal(P.costOf(undefined, price), 0);
        assert.equal(P.costOf({ input_tokens: NaN, output_tokens: -5, cache_read_tokens: '9' }, price), 0);
    });

    test('no rounding noise', () => {
        // 0.1 + 0.2 would be 0.30000000000000004 in plain floating point
        assert.equal(P.costOf({ input_tokens: 100_000, output_tokens: 40_000 }, P.priceFor('claude-haiku-4-5')), 0.3);
        assert.equal(P.costOf({ input_tokens: 5000 }, P.priceFor('claude-haiku-4-5')), 0.005);
        assert.equal(P.costOf({ input_tokens: 1_005_000 }, P.priceFor('claude-haiku-4-5')), 1.005);
        assert.equal(P.costOf({ cache_read_tokens: 3_000_000 }, P.priceFor('claude-haiku-4-5')), 0.3);
        assert.equal(P.costOf({ input_tokens: 100_000 }, { input: 3, output: 15 }), 0.3);
    });

    test('a price without cache prices derives them from the input price', () => {
        assert.equal(P.costOf({ cache_read_tokens: 1_000_000, cache_write_tokens: 1_000_000 }, { input: 2, output: 10 }), 2.7);
    });
});
