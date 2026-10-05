// Spec v0.1.4.13, 4.2 (part N1, engineer E2): addressing by name in src/agent/bots_logic.js, pure.
//   - addressedTo(text, names): the first word with trailing , : ! ? . stripped, without case; or the name within
//     the first three words after hey, hi, ok, okay, so, now, please, and; "claude and gpt, come here" addresses
//     none; a name inside a sentence is no address; the answer { name, rest } or null;
//   - shouldAnswer: one row for each case of 4.2: own name first, own name after "hey", other bot first, supervisor
//     first, no name, name inside, both names; the old rows win over the address.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';

const B = await loadSrc('src/agent/bots_logic.js');

const NAMES = ['claude', 'gpt', 'Opus'];
const OWNER = 'MartyByrde2';
const line = (text, extra = {}) => B.shouldAnswer({ from: OWNER, text, self: 'claude', otherBots: ['gpt'], onlyChatWith: [], supervisor: 'Opus', ...extra });

describe('N1: the module stays pure', () => {
    test('no static imports', () => {
        assert.deepEqual(importsOf('src/agent/bots_logic.js').static, []);
    });
});

describe('N1: addressedTo', () => {
    test('the first word is the name, with trailing , : ! ? . stripped and without case', () => {
        assert.deepEqual(B.addressedTo('claude, come here', NAMES), { name: 'claude', rest: 'come here' });
        assert.deepEqual(B.addressedTo('Claude: come here', NAMES), { name: 'claude', rest: 'come here' });
        assert.deepEqual(B.addressedTo('CLAUDE! come here', NAMES), { name: 'claude', rest: 'come here' });
        assert.deepEqual(B.addressedTo('claude? where are you', NAMES), { name: 'claude', rest: 'where are you' });
        assert.deepEqual(B.addressedTo('claude. come', NAMES), { name: 'claude', rest: 'come' });
        assert.deepEqual(B.addressedTo('gpt come here', NAMES), { name: 'gpt', rest: 'come here' });
        assert.deepEqual(B.addressedTo('opus, why is it going up?', NAMES), { name: 'Opus', rest: 'why is it going up?' }, 'the name as it stands in names');
    });

    test('the name alone: rest is empty; blanks around the line do not count', () => {
        assert.deepEqual(B.addressedTo('claude', NAMES), { name: 'claude', rest: '' });
        assert.deepEqual(B.addressedTo('claude?', NAMES), { name: 'claude', rest: '' });
        assert.deepEqual(B.addressedTo('  claude,   come here  ', NAMES), { name: 'claude', rest: 'come here' });
    });

    test('the name within the first three words after hey, hi, ok, okay, so, now, please, and', () => {
        assert.deepEqual(B.addressedTo('hey claude, come', NAMES), { name: 'claude', rest: 'come' });
        assert.deepEqual(B.addressedTo('ok so gpt wait', NAMES), { name: 'gpt', rest: 'wait' });
        assert.deepEqual(B.addressedTo('Hi Claude! where are you?', NAMES), { name: 'claude', rest: 'where are you?' });
        assert.deepEqual(B.addressedTo('okay claude come', NAMES), { name: 'claude', rest: 'come' });
        assert.deepEqual(B.addressedTo('now gpt, stop', NAMES), { name: 'gpt', rest: 'stop' });
        assert.deepEqual(B.addressedTo('please claude come here', NAMES), { name: 'claude', rest: 'come here' });
        assert.deepEqual(B.addressedTo('and claude, you too', NAMES), { name: 'claude', rest: 'you too' });
        assert.deepEqual(B.addressedTo('hey, claude, come', NAMES), { name: 'claude', rest: 'come' }, 'punctuation after the word before');
        assert.deepEqual(B.addressedTo('gpt please wait here', NAMES), { name: 'gpt', rest: 'please wait here' }, 'the plan\'s example');
    });

    test('the name as the fourth word, or after another word: no address', () => {
        assert.equal(B.addressedTo('hey hi so claude come', NAMES), null);
        assert.equal(B.addressedTo('tell gpt to wait', NAMES), null);
        assert.equal(B.addressedTo('come here claude', NAMES), null);
        assert.equal(B.addressedTo('I think claude should come', NAMES), null);
        assert.equal(B.addressedTo('the claude, come', NAMES), null);
    });

    test('"claude and gpt, come here" addresses none: both come', () => {
        assert.equal(B.addressedTo('claude and gpt, come here', NAMES), null);
        assert.equal(B.addressedTo('hey claude and gpt, come here', NAMES), null);
        assert.equal(B.addressedTo('gpt and claude come', NAMES), null);
        assert.deepEqual(B.addressedTo('claude and the others, come', NAMES), { name: 'claude', rest: 'and the others, come' }, '"and" before a word that is no name is part of the line');
    });

    test('no name in the line, no names, odd values: null, never throws', () => {
        assert.equal(B.addressedTo('come here', NAMES), null);
        assert.equal(B.addressedTo('', NAMES), null);
        assert.equal(B.addressedTo('claude, come', []), null);
        assert.equal(B.addressedTo('claude, come', undefined), null);
        assert.equal(B.addressedTo(undefined, NAMES), null);
        assert.equal(B.addressedTo('claude, come', ['', null, 3]), null);
        assert.equal(B.addressedTo('claudette, come', NAMES), null, 'a longer word is not the name');
        assert.equal(B.addressedTo(',', NAMES), null);
    });
});

describe('N1: shouldAnswer with the address (one row for each case of 4.2)', () => {
    test('own name first: answered, the text without the address', () => {
        assert.deepEqual(line('claude, come here'), { answer: true, why: 'addressed_self', text: 'come here' });
        assert.deepEqual(line('Claude come here'), { answer: true, why: 'addressed_self', text: 'come here' });
    });

    test('own name after "hey": answered, the text without the address', () => {
        assert.deepEqual(line('hey claude, come here'), { answer: true, why: 'addressed_self', text: 'come here' });
        assert.deepEqual(line('ok so claude wait'), { answer: true, why: 'addressed_self', text: 'wait' });
    });

    test('other bot first: not answered, addressed_other', () => {
        assert.deepEqual(line('gpt, come here'), { answer: false, why: 'addressed_other' });
        assert.deepEqual(line('hey gpt please wait here'), { answer: false, why: 'addressed_other' });
    });

    test('the other agents of the mindserver count as names too', () => {
        assert.deepEqual(line('andy, come here', { otherBots: [], names: ['andy'] }), { answer: false, why: 'addressed_other' });
        assert.deepEqual(line('Andy come', { otherBots: [], names: ['andy'] }), { answer: false, why: 'addressed_other' });
    });

    test('supervisor first: not answered, addressed_supervisor; without a supervisor the name is a word of the line', () => {
        assert.deepEqual(line('Opus, why is it going up?'), { answer: false, why: 'addressed_supervisor' });
        assert.deepEqual(line('hey opus where is it'), { answer: false, why: 'addressed_supervisor' });
        assert.deepEqual(line('Opus, why is it going up?', { supervisor: '' }), { answer: true, why: null });
        assert.deepEqual(line('Opus, why is it going up?', { supervisor: undefined }), { answer: true, why: null });
    });

    test('no name: answered as before, why null, no text', () => {
        assert.deepEqual(line('come here'), { answer: true, why: null });
        assert.deepEqual(line('where are you?'), { answer: true, why: null });
    });

    test('name inside a sentence: answered as before', () => {
        assert.deepEqual(line('tell gpt to wait'), { answer: true, why: null });
        assert.deepEqual(line('I asked claude already'), { answer: true, why: null });
        assert.deepEqual(line('ask Opus about it'), { answer: true, why: null });
    });

    test('both names: answered as before (both come)', () => {
        assert.deepEqual(line('claude and gpt, come here'), { answer: true, why: null });
        assert.deepEqual(line('gpt and claude, come here'), { answer: true, why: null });
    });

    test('the own name alone: answered, the text is empty (the handler hands the line on as it is)', () => {
        assert.deepEqual(line('claude?'), { answer: true, why: 'addressed_self', text: '' });
    });

    test('the old rows win: a command echo or a result of a bot addressed to the bot stays dropped, a sender outside only_chat_with too', () => {
        assert.deepEqual(line('*claude used stop*'), { answer: false, why: 'command_echo' });
        assert.deepEqual(line('claude, come here', { from: 'claude' }), { answer: false, why: 'self' });
        assert.deepEqual(line('claude, come here', { from: 'gpt' }), { answer: false, why: 'other_bot' });
        assert.deepEqual(line('claude, come here', { from: 'Steve', onlyChatWith: [OWNER] }), { answer: false, why: 'not_listened' });
        assert.deepEqual(line('claude, come here', { onlyChatWith: [OWNER] }), { answer: true, why: 'addressed_self', text: 'come here' });
    });

    test('a command after the address keeps its form', () => {
        assert.deepEqual(line('claude, !stop'), { answer: true, why: 'addressed_self', text: '!stop' });
        assert.deepEqual(line('gpt !stop'), { answer: false, why: 'addressed_other' });
    });

    test('never throws: no argument, odd values', () => {
        assert.equal(typeof B.shouldAnswer().answer, 'boolean');
        assert.deepEqual(B.shouldAnswer({ from: OWNER, text: 'claude, hi', self: 'claude', otherBots: [null, 3], names: 'x', supervisor: 7 }),
            { answer: true, why: 'addressed_self', text: 'hi' });
    });
});
