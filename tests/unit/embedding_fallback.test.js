// v0.1.4.8: an embedding model that cannot be created must not stop the start of the bot. A profile
// with "embedding": "openai" and no key for OpenAI made the constructor of the prompter throw.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Examples } from '../../src/utils/examples.js';

const SOURCE = readFileSync(new URL('../../src/models/prompter.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('the embedding model of the prompter', () => {
    test('its creation is guarded: a failure gives no model and a warning', () => {
        const start = SOURCE.indexOf('let embedding_model_profile = null;');
        const end = SOURCE.indexOf('this.skill_libary = new SkillLibrary(', start);
        assert.ok(start >= 0 && end > start, 'the block of the embedding model is there');
        const block = SOURCE.slice(start, end);
        const guarded = block.indexOf('try {', block.indexOf('this.profile.embedding') + 1);
        const created = block.lastIndexOf('createModel(');
        const caught = block.lastIndexOf('} catch (error) {');
        assert.ok(block.lastIndexOf('try {') < block.indexOf('? createModel(embedding_model_profile)'), 'createModel runs inside a try');
        assert.ok(guarded >= 0 && created > 0 && caught > created, 'the catch comes after every createModel');
        assert.ok(block.slice(caught).includes('this.embedding_model = null;'));
        assert.ok(block.slice(caught).includes('console.warn('));
    });

    test('no createModel for the embedding model stands outside the try', () => {
        const start = SOURCE.indexOf('let embedding_model_profile = null;');
        const end = SOURCE.indexOf('this.skill_libary = new SkillLibrary(', start);
        const block = SOURCE.slice(start, end);
        const lastTry = block.lastIndexOf('try {');
        assert.equal(block.slice(0, lastTry).includes('createModel('), false);
    });

    test('without a model the examples are chosen by word overlap', async () => {
        const examples = new Examples(null, 1);
        await examples.load([
            [{ role: 'user', content: 'someone: get to shelter' }, { role: 'assistant', content: '!goToShelter' }],
            [{ role: 'user', content: 'someone: whats in the chests?' }, { role: 'assistant', content: '!chests' }],
        ]);
        const selected = await examples.getRelevant([{ role: 'user', content: 'MartyByrde2: whats in the chests' }]);
        assert.equal(selected.length, 1);
        assert.equal(selected[0][1].content, '!chests');
    });
});
