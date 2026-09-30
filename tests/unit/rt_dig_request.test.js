// T1, spec v0.1.4.9 I8 and C2: isDiggingRequest(text) -> { digging, words } and digRefusalText(commands) of
// src/agent/dig_request_logic.js. The words (whole words, any case): dig, digs, digging, dug, tunnel, tunnels,
// shaft, mine, mining, strip mine, branch mine (also with a hyphen), quarry, excavate, and the ore names of the
// mining pack with or without `ore`. Handoff: an ore name without `ore` counts only within 3 words after find,
// get, collect, gather, search, look, bring, fetch, need, want, hunt, mine; the words come back in lower case,
// a hyphen or underscore read as a space. Section 11: "give me mine" is a digging request too (accepted).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const D = await loadSrc('src/agent/dig_request_logic.js');

const ALL = 'I do not write code for digging. I have skills for it: !mineOre for an ore, !rememberTunnel and then !mineOre to dig on in a tunnel, !collectBlocks for blocks in sight.';
const NONE = 'I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.';

describe('I8: isDiggingRequest', () => {
    const yes = [
        ['dig a tunnel', ['dig', 'tunnel']],
        ['dig a tunnel to the east', ['dig', 'tunnel']],
        ['get me some iron', ['iron']],
        ['iron ore', ['iron ore']],
        ['Please MINE some coal', ['mine']],
        ['he digs', ['digs']],
        ['keep digging', ['digging']],
        ['we dug it yesterday', ['dug']],
        ['make two tunnels', ['tunnels']],
        ['go down the shaft', ['shaft']],
        ['go mining', ['mining']],
        ['a strip mine at y 11', ['strip mine']],
        ['strip-mine this hill', ['strip mine']],
        ['a branch mine please', ['branch mine']],
        ['branch-mine at -59', ['branch mine']],
        ['build a quarry', ['quarry']],
        ['excavate the hill', ['excavate']],
        ['find diamonds? find diamond', ['diamond']],
        ['bring me gold', ['gold']],
        ['collect some redstone', ['redstone']],
        ['I need lapis', ['lapis']],
        ['deepslate_iron_ore', []],
        ['give me mine', ['mine']],
    ];
    for (const [text, words] of yes) {
        test(`"${text}": a digging request${words.length ? `, with ${words.join(', ')}` : ''}`, () => {
            const r = D.isDiggingRequest(text);
            assert.equal(r.digging, true, JSON.stringify(r));
            assert.ok(Array.isArray(r.words));
            for (const w of words) assert.ok(r.words.includes(w), `${w} in ${JSON.stringify(r.words)}`);
        });
    }

    const no = [
        'craft an iron pickaxe',
        'build a house',
        'make a crafting table and a chest',
        'a mineshaft',
        'the digger is here',
        'smelt the iron ingots',
        'hello there',
        '',
    ];
    for (const text of no) {
        test(`"${text}": no digging request`, () => {
            const r = D.isDiggingRequest(text);
            assert.equal(r.digging, false, JSON.stringify(r));
            assert.deepEqual(r.words, []);
        });
    }

    test('never throws: not a string', () => {
        for (const odd of [null, undefined, 42, {}, []]) {
            const r = D.isDiggingRequest(odd);
            assert.equal(r.digging, false);
        }
    });
});

describe('I8: digRefusalText', () => {
    test('all three commands on: the text of I8', () => {
        assert.equal(D.digRefusalText(['!mineOre', '!rememberTunnel', '!collectBlocks']), ALL);
    });

    test('in any order, with or without "!" (handoff): the same text', () => {
        assert.equal(D.digRefusalText(['!collectBlocks', '!rememberTunnel', '!mineOre']), ALL);
        assert.equal(D.digRefusalText(['collectBlocks', 'mineOre', 'rememberTunnel']), ALL);
    });

    test('only the commands that are on', () => {
        assert.equal(D.digRefusalText(['!mineOre', '!collectBlocks']),
            'I do not write code for digging. I have skills for it: !mineOre for an ore, !collectBlocks for blocks in sight.');
        assert.equal(D.digRefusalText(['!collectBlocks']), 'I do not write code for digging. I have skills for it: !collectBlocks for blocks in sight.');
        assert.equal(D.digRefusalText(['!mineOre']), 'I do not write code for digging. I have skills for it: !mineOre for an ore.');
    });

    test('none: the text without commands', () => {
        assert.equal(D.digRefusalText([]), NONE);
        assert.equal(D.digRefusalText(null), NONE);
    });
});
