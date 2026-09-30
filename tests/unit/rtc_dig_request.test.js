// Spec v0.1.4.9 C2 and I8 (part C, engineer E3): src/agent/dig_request_logic.js, the guard of !newAction
// against dig code (setting skills_over_code, bound by the glue). isDiggingRequest(text) looks for whole
// words, any case; "strip mine" and "branch mine" also with a hyphen. An ore of the mining pack counts
// followed by "ore", or with find, get, collect, gather, search, look, bring, fetch, need, want, hunt or
// mine within the 3 words before it (decision of the tech lead: "craft an iron pickaxe" is no digging
// request). digRefusalText(commands) names only the digging commands that are on.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertCleanImport } from '../helpers/module_rules.js';
import { importsOf } from '../helpers/hygiene.js';

const D = await loadSrc('src/agent/dig_request_logic.js');

const FULL = 'I do not write code for digging. I have skills for it: !mineOre for an ore, !rememberTunnel and then !mineOre to dig on in a tunnel, !collectBlocks for blocks in sight.';
const NONE = 'I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.';

describe('isDiggingRequest', () => {
    test('every word of I8 alone is a digging request', () => {
        for (const word of ['dig', 'digs', 'digging', 'dug', 'tunnel', 'tunnels', 'shaft', 'mine', 'mining', 'strip mine', 'branch mine', 'quarry', 'excavate']) {
            assert.deepEqual(D.isDiggingRequest(word), { digging: true, words: [word] }, word);
            assert.equal(D.isDiggingRequest(`please ${word} here`).digging, true, word);
        }
    });

    test('an ore of the mining pack followed by "ore" counts alone', () => {
        for (const ore of ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond']) {
            assert.deepEqual(D.isDiggingRequest(`${ore} ore`), { digging: true, words: [`${ore} ore`] }, `${ore} ore`);
            assert.deepEqual(D.isDiggingRequest(`the ${ore}_ore here`), { digging: true, words: [`${ore} ore`] }, `${ore}_ore`);
        }
        assert.deepEqual(D.isDiggingRequest('deepslate_iron_ore').words, ['deepslate iron ore']);
        assert.deepEqual(D.isDiggingRequest('Iron-Ore and diamond ores').words, ['iron ore', 'diamond ores']);
    });

    test('an ore name without "ore" counts with a word of the list within the 3 words before it', () => {
        assert.deepEqual([...D.ORE_VERBS], ['find', 'get', 'collect', 'gather', 'search', 'look', 'bring', 'fetch', 'need', 'want', 'hunt', 'mine']);
        for (const verb of D.ORE_VERBS) {
            assert.equal(D.isDiggingRequest(`${verb} iron`).digging, true, verb);
            assert.ok(D.isDiggingRequest(`${verb} iron`).words.includes('iron'), verb);
        }
        for (const ore of ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond'])
            assert.deepEqual(D.isDiggingRequest(`get me ${ore}`), { digging: true, words: [ore] }, ore);
        assert.deepEqual(D.isDiggingRequest('get me some iron'), { digging: true, words: ['iron'] }, '3 words before');
        assert.deepEqual(D.isDiggingRequest('find diamonds'), { digging: true, words: ['diamonds'] }, 'the plural');
        assert.deepEqual(D.isDiggingRequest('Please LOOK for some Gold'), { digging: true, words: ['gold'] }, 'any case');
        assert.deepEqual(D.isDiggingRequest('I need 5 coal'), { digging: true, words: ['coal'] });
        assert.deepEqual(D.isDiggingRequest('mine some iron'), { digging: true, words: ['mine', 'iron'] }, 'mine counts anyway');
        assert.deepEqual(D.isDiggingRequest('search for some more gold'), { digging: false, words: [] }, 'the verb is 4 words before');
    });

    test('an ore name alone names a material: no digging request', () => {
        for (const text of ['craft an iron pickaxe', 'make an iron golem', 'smelt the iron', 'iron', 'Diamonds!', 'build a gold block',
            'place the redstone torch', 'an iron door, then get the bread']) {
            assert.deepEqual(D.isDiggingRequest(text), { digging: false, words: [] }, text);
        }
    });

    test('any case; a hyphen in strip mine and branch mine', () => {
        assert.deepEqual(D.isDiggingRequest('DIG A TUNNEL to the East'), { digging: true, words: ['dig', 'tunnel'] });
        assert.deepEqual(D.isDiggingRequest('Strip-mine for Diamond ore'), { digging: true, words: ['strip mine', 'diamond ore'] });
        assert.deepEqual(D.isDiggingRequest('make a branch-mine').words, ['branch mine']);
        assert.deepEqual(D.isDiggingRequest('a Branch Mine at y -59').words, ['branch mine'], 'one word, not "mine" alone');
    });

    test('the example of W72 and "mine" as a pronoun (the spec accepts that)', () => {
        assert.deepEqual(D.isDiggingRequest('dig a tunnel to the east'), { digging: true, words: ['dig', 'tunnel'] });
        assert.deepEqual(D.isDiggingRequest('give me mine'), { digging: true, words: ['mine'] });
    });

    test('whole words only', () => {
        for (const text of ['build a house', 'craft a golden apple', 'smelt the iron_ingot', 'the miner mined', 'undig', 'digger',
            'use !mineOre', 'tunneling', 'goldfish', 'shafts', 'ironic', '']) {
            assert.deepEqual(D.isDiggingRequest(text), { digging: false, words: [] }, text);
        }
    });

    test('each word once, in the order of the text', () => {
        assert.deepEqual(D.isDiggingRequest('dig, dig and DIG a shaft, then dig').words, ['dig', 'shaft']);
    });

    test('never throws: no text', () => {
        for (const bad of [undefined, null, 5, {}, ['dig']]) assert.deepEqual(D.isDiggingRequest(bad), { digging: false, words: [] });
    });
});

describe('digRefusalText: the texts of I8, word for word', () => {
    test('all three commands on', () => {
        assert.equal(D.digRefusalText(['!mineOre', '!rememberTunnel', '!collectBlocks']), FULL);
        assert.equal(D.digRefusalText(['!collectBlocks', '!rememberTunnel', '!mineOre']), FULL, 'the order of the text, not of the list');
        assert.equal(D.digRefusalText(['mineOre', 'rememberTunnel', 'collectBlocks']), FULL, 'without "!"');
    });

    test('only the commands that are on', () => {
        assert.equal(D.digRefusalText(['!mineOre', '!collectBlocks']),
            'I do not write code for digging. I have skills for it: !mineOre for an ore, !collectBlocks for blocks in sight.');
        assert.equal(D.digRefusalText(['!collectBlocks']), 'I do not write code for digging. I have skills for it: !collectBlocks for blocks in sight.');
        assert.equal(D.digRefusalText(['!mineOre']), 'I do not write code for digging. I have skills for it: !mineOre for an ore.');
    });

    test('!rememberTunnel is named only with !mineOre (its phrase names both)', () => {
        assert.equal(D.digRefusalText(['!rememberTunnel', '!collectBlocks']),
            'I do not write code for digging. I have skills for it: !collectBlocks for blocks in sight.');
        assert.equal(D.digRefusalText(['!rememberTunnel']), NONE);
    });

    test('without any digging command: the second text', () => {
        assert.equal(D.digRefusalText([]), NONE);
        assert.equal(D.digRefusalText(['!newAction', '!goToBed']), NONE, 'other commands are not named');
        for (const bad of [undefined, null, 'x', {}]) assert.equal(D.digRefusalText(bad), NONE);
    });

    test('the digging commands in the order of the text', () => {
        assert.deepEqual([...D.DIGGING_COMMANDS], ['!mineOre', '!rememberTunnel', '!collectBlocks']);
    });
});

describe('the module', () => {
    test('is pure: no imports, no side effects', () => {
        assert.deepEqual(importsOf('src/agent/dig_request_logic.js').static, []);
        assert.equal(importsOf('src/agent/dig_request_logic.js').dynamic, 0);
        assertCleanImport('src/agent/dig_request_logic.js');
    });
});
