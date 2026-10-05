// v0.1.4.13, the live voice (docs/releases/0.1.4.13/HANDOFF-voice.md, 2 and 6): src/mindcraft/public/chat_logic.js,
// shared by the page and the voice of the mindserver. The `!` rule: a command, its echo or a result of a bot is shown
// but not spoken; the owner's name: the first name of only_chat_with, else the name the page keeps.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const C = await loadSrc('src/mindcraft/public/chat_logic.js');
const B = await loadSrc('src/agent/bots_logic.js');

describe('the patterns are the ones of bots_logic.js', () => {
    test('COMMAND_ECHO and BOT_RESULT', () => {
        assert.equal(C.COMMAND_ECHO.source, B.COMMAND_ECHO.source);
        assert.equal(C.BOT_RESULT.source, B.BOT_RESULT.source);
    });

    test('chat_logic.js imports nothing (the page loads it as it is) and has no side effects', () => {
        assertCleanImport('src/mindcraft/public/chat_logic.js');
    });
});

describe('lineKind(line)', () => {
    const rows = [
        ['!collectBlocks("oak_log", 10)', 'command'],
        ['  !stop', 'command'],
        ['*MartyByrde2 used stop*', 'command'],
        ['*waves*', 'command'],
        ['Action output: Collected 4 oak_log.', 'command'],
        ['Found non-destructive path.', 'command'],
        ['Found destructive path.', 'command'],
        ['You have reached at 1, 2, 3.', 'command'],
        ['Sure, I will get wood.', 'say'],
        ['Hello! !stop', 'say'],
        ['', 'say'],
    ];
    for (const [line, kind] of rows) test(`${JSON.stringify(line)} -> ${kind}`, () => assert.equal(C.lineKind(line), kind));
});

describe('speechText(line): what the voice says', () => {
    const rows = [
        ['Sure, I will get wood.', 'Sure, I will get wood.'],
        ['!collectBlocks("oak_log", 10)', ''],
        ['*MartyByrde2 used stop*', ''],
        ['Action output: Collected 4 oak_log.', ''],
        ['Found non-destructive path.', ''],
        ['You have reached at 1, 2, 3.', ''],
        ['Sure! !collectBlocks("oak_log", 10)', 'Sure!'],
        ['On my way. !goToPlayer("MartyByrde2", 3)', 'On my way.'],
        ['Got it!!stop', 'Got it!'],
        ['Hello! How are you?', 'Hello! How are you?'],
        ['I have **12** `oak_log` and _3_ planks', 'I have 12 oak log and 3 planks'],
        ['Line one\nline two\ttab', 'Line one line two tab'],
        ['   ', ''],
        ['...', ''],
        [null, ''],
        [undefined, ''],
        [42, '42'],
    ];
    for (const [line, said] of rows) {
        test(`${JSON.stringify(line)} -> ${JSON.stringify(said)}`, () => assert.equal(C.speechText(line), said));
    }

    test('never throws on any value', () => {
        for (const v of [{}, [], true, NaN]) assert.equal(typeof C.speechText(v), 'string');
    });
});

describe('speakerName(onlyChatWith, stored)', () => {
    test('the first name of only_chat_with wins', () => {
        assert.equal(C.speakerName(['MartyByrde2', 'Other'], 'Stored'), 'MartyByrde2');
        assert.equal(C.speakerName(['', '  ', ' MartyByrde2 '], null), 'MartyByrde2');
    });

    test('an empty only_chat_with: the stored name', () => {
        assert.equal(C.speakerName([], 'Steve'), 'Steve');
        assert.equal(C.speakerName(undefined, ' Steve '), 'Steve');
        assert.equal(C.speakerName('MartyByrde2', 'Steve'), 'Steve', 'only an array counts');
    });

    test('no name at all: null, the page asks once', () => {
        assert.equal(C.speakerName([], null), null);
        assert.equal(C.speakerName([], '  '), null);
        assert.equal(C.speakerName([1, null], 7), null);
    });
});
