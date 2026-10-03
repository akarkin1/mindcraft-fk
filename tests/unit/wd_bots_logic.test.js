// Spec v0.1.4.12, 4.6 (part D, engineer E6): src/agent/bots_logic.js, pure.
//   - D1: shouldAnswer for every row of the table, each with a case that drops and a case that answers;
//   - isOtherBot: the names of other_bots, case-insensitive;
//   - D3: the role line word for word, the placeholder replaced or removed, the line for a prompt without it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';

const B = await loadSrc('src/agent/bots_logic.js');

const SELF = 'w_farmer';
const OWNER = 'MartyByrde2';
const line = (from, text, extra = {}) => B.shouldAnswer({ from, text, self: SELF, otherBots: ['w_Miner'], onlyChatWith: [], ...extra });

describe('bots_logic.js', () => {
    test('pure: no imports', () => {
        assert.deepEqual(importsOf('src/agent/bots_logic.js').static, []);
    });
});

describe('D1: shouldAnswer', () => {
    test('a line of a player: answered, why null', () => {
        assert.deepEqual(line(OWNER, 'where are you?'), { answer: true, why: null });
    });

    test('from === self: dropped; another name with the same letters in another case is not self', () => {
        assert.deepEqual(line(SELF, 'where are you?'), { answer: false, why: 'self' });
        assert.deepEqual(line('W_FARMER', 'where are you?', { otherBots: [] }), { answer: true, why: null });
    });

    test('from in otherBots, case-insensitive: dropped; a name not in the list: answered', () => {
        assert.deepEqual(line('w_miner', 'I am in the mine.'), { answer: false, why: 'other_bot' });
        assert.deepEqual(line('W_MINER', 'I am in the mine.'), { answer: false, why: 'other_bot' });
        assert.deepEqual(line('w_miner2', 'I am in the mine.'), { answer: true, why: null });
        assert.deepEqual(line('w_miner', 'I am in the mine.', { otherBots: [] }), { answer: true, why: null });
        assert.deepEqual(line('w_miner', 'I am in the mine.', { otherBots: undefined }), { answer: true, why: null });
    });

    test('a command echo from anyone: dropped; a line that only looks like one: answered', () => {
        assert.deepEqual(line(OWNER, '*MartyByrde2 used stop*'), { answer: false, why: 'command_echo' });
        assert.deepEqual(line('Steve', '*w_miner used mineOre*'), { answer: false, why: 'command_echo' });
        assert.deepEqual(line(OWNER, '*MartyByrde2 used stop*  '), { answer: false, why: 'command_echo' }, 'trailing blanks of the chat');
        assert.deepEqual(line(OWNER, 'I used stop'), { answer: true, why: null });
        assert.deepEqual(line(OWNER, '*Marty Byrde used stop*'), { answer: true, why: null }, 'a blank in the name is no echo');
        assert.deepEqual(line(OWNER, 'look: *MartyByrde2 used stop*'), { answer: true, why: null });
    });

    test('a result of a bot from anyone: dropped; the words inside a line: answered', () => {
        for (const text of ['Action output: Collected 4 oak_log.', 'Found destructive path.', 'Found non-destructive path.', 'You have reached at 12, 64, -3.']) {
            assert.deepEqual(line(OWNER, text), { answer: false, why: 'bot_result' }, text);
            assert.deepEqual(line('Steve', text), { answer: false, why: 'bot_result' }, text);
        }
        assert.deepEqual(line(OWNER, 'did you get the Action output: ?'), { answer: true, why: null });
        assert.deepEqual(line(OWNER, 'Found a path'), { answer: true, why: null });
        assert.deepEqual(line(OWNER, 'Found destructive path'), { answer: true, why: null }, 'without the period');
    });

    test('only_chat_with not empty: a name outside it dropped, a name in it answered (exact, as before)', () => {
        assert.deepEqual(line('Steve', 'hi', { onlyChatWith: [OWNER] }), { answer: false, why: 'not_listened' });
        assert.deepEqual(line(OWNER, 'hi', { onlyChatWith: [OWNER] }), { answer: true, why: null });
        assert.deepEqual(line('martybyrde2', 'hi', { onlyChatWith: [OWNER] }), { answer: false, why: 'not_listened' });
        assert.deepEqual(line('Steve', 'hi', { onlyChatWith: [] }), { answer: true, why: null });
    });

    test('the order of the rows: self, other bot, echo, result, only_chat_with', () => {
        assert.equal(B.shouldAnswer({ from: SELF, text: '*x used y*', self: SELF, otherBots: [SELF], onlyChatWith: [OWNER] }).why, 'self');
        assert.equal(line('w_miner', '*x used y*', { onlyChatWith: [OWNER] }).why, 'other_bot');
        assert.equal(line('Steve', '*x used y*', { onlyChatWith: [OWNER] }).why, 'command_echo');
        assert.equal(line('Steve', 'Action output: done', { onlyChatWith: [OWNER] }).why, 'bot_result');
    });

    test('never throws: no argument, odd values', () => {
        assert.equal(typeof B.shouldAnswer().answer, 'boolean');
        assert.deepEqual(B.shouldAnswer({ from: OWNER, text: null, self: SELF, otherBots: [null, 3], onlyChatWith: 'x' }), { answer: true, why: null });
    });
});

describe('isOtherBot', () => {
    test('case-insensitive; not a string or no list: false', () => {
        assert.equal(B.isOtherBot('W_MINER', ['w_miner']), true);
        assert.equal(B.isOtherBot('w_miner', ['W_Miner', 'gpt']), true);
        assert.equal(B.isOtherBot('steve', ['w_miner']), false);
        assert.equal(B.isOtherBot('w_miner', []), false);
        assert.equal(B.isOtherBot('w_miner', undefined), false);
        assert.equal(B.isOtherBot(undefined, ['w_miner']), false);
    });
});

describe('D3: the role line', () => {
    const ROLE = 'You are the farmer. gpt is the miner.';
    const LINE = 'You are the farmer. gpt is the miner. A question to all of us gets one line from you.';
    const PROMPT = 'Intro.\nA rule about a place names a place you saved.\n$BOT_ROLE\nSummarized memory:\'$MEMORY\'\nConversation Begin:';

    test('roleLine word for word; empty, blanks or not a string: ""', () => {
        assert.equal(B.roleLine(ROLE), LINE);
        assert.equal(B.roleLine(`  ${ROLE} `), LINE);
        for (const role of ['', '   ', undefined, null, 3]) assert.equal(B.roleLine(role), '', String(role));
    });

    test('withBotRole: the placeholder becomes the line on its own line', () => {
        assert.equal(B.withBotRole(PROMPT, ROLE), `Intro.\nA rule about a place names a place you saved.\n${LINE}\nSummarized memory:'$MEMORY'\nConversation Begin:`);
    });

    test('withBotRole with an empty role: the placeholder and its line break are gone, the prompt as without a role', () => {
        assert.equal(B.withBotRole(PROMPT, ''), "Intro.\nA rule about a place names a place you saved.\nSummarized memory:'$MEMORY'\nConversation Begin:");
        assert.equal(B.withBotRole('a $BOT_ROLE b', undefined), 'a  b');
    });

    test('withBotRole: a $ in the role is no replacement pattern; a prompt without the placeholder unchanged', () => {
        assert.equal(B.withBotRole('$BOT_ROLE', "I farm. $& and $' stay."), "I farm. $& and $' stay. A question to all of us gets one line from you.");
        assert.equal(B.withBotRole('no placeholder', ROLE), 'no placeholder');
    });

    test('insertRoleLine: before "Summarized memory:" on its own line; without the marker first; empty role or the line there: unchanged', () => {
        const plain = "Intro.\nSummarized memory:'m'\nConversation Begin:";
        assert.equal(B.insertRoleLine(plain, ROLE), `Intro.\n${LINE}\nSummarized memory:'m'\nConversation Begin:`);
        assert.equal(B.insertRoleLine('Intro.', ROLE), `${LINE}\nIntro.`);
        assert.equal(B.insertRoleLine(plain, ''), plain);
        const once = B.insertRoleLine(plain, ROLE);
        assert.equal(B.insertRoleLine(once, ROLE), once);
    });
});
