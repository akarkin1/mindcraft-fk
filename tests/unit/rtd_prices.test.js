// Spec v0.1.4.9 D2 and I9: the prices of the OpenAI models in DEFAULT_PRICES of
// src/agent/cost/price_table.js, and none for the speech model.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const P = await loadSrc('src/agent/cost/price_table.js');

describe('prices of OpenAI models', () => {
    test('gpt-6-luna: input 0.10, output 0.50, cache_read 0.01 dollars per million tokens', () => {
        const price = P.priceFor('gpt-6-luna');
        assert.equal(price.input, 0.10);
        assert.equal(price.output, 0.50);
        assert.equal(price.cache_read, 0.01);
        assert.deepEqual(P.DEFAULT_PRICES['gpt-6-luna'], { input: 0.10, output: 0.50, cache_read: 0.01 });
    });

    test('a dated id of gpt-6-luna finds its price', () => {
        assert.deepEqual(P.priceFor('gpt-6-luna-2026-09-01'), P.priceFor('gpt-6-luna'));
    });

    test('text-embedding-3-small: input 0.02, output 0', () => {
        const price = P.priceFor('text-embedding-3-small');
        assert.equal(price.input, 0.02);
        assert.equal(price.output, 0);
        assert.deepEqual(P.DEFAULT_PRICES['text-embedding-3-small'], { input: 0.02, output: 0 });
    });

    test('no price for the speech model, nor for other OpenAI models', () => {
        for (const model of ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts', 'gpt-4o', 'gpt-6', 'text-embedding-3-large']) {
            assert.equal(P.priceFor(model), null, model);
        }
    });

    test('the new entries are frozen, and an override still comes first', () => {
        assert.ok(Object.isFrozen(P.DEFAULT_PRICES['gpt-6-luna']));
        assert.ok(Object.isFrozen(P.DEFAULT_PRICES['text-embedding-3-small']));
        assert.deepEqual(P.priceFor('gpt-6-luna', { 'gpt-6-luna': { input: 1, output: 2 } }), { input: 1, output: 2, cache_read: 0.1, cache_write: 1.25 });
    });

    test('costs without rounding noise', () => {
        assert.equal(P.costOf({ input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_tokens: 1_000_000 }, P.priceFor('gpt-6-luna')), 0.61);
        assert.equal(P.costOf({ input_tokens: 3000 }, P.priceFor('gpt-6-luna')), 0.0003);
        assert.equal(P.costOf({ input_tokens: 5000, output_tokens: 0 }, P.priceFor('text-embedding-3-small')), 0.0001);
    });
});
