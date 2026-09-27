// Spec S2: src/utils/model_errors.js -- MODEL_ERROR_RESPONSES and isModelErrorResponse.
// Amendment 1, A5 clarifies the <think> block and adds the two "I thought too hard"
// sentences to the list the array must contain.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf, importInCleanProcess } from '../helpers/hygiene.js';
import { describeRun } from '../helpers/child.js';

const MODULE = 'src/utils/model_errors.js';
const me = await loadSrc(MODULE);

// The sentences the spec lists explicitly: S2 "It must contain at least" plus the two of A5.
// The A5 sentences are fixed replies of src/models/*.js at v0.1.4.1:
//   glhf.js:        "I thought too hard, sorry, try again"      (no final period)
//   huggingface.js, hyperbolic.js, ollama.js: "I thought too hard, sorry, try again."
const REQUIRED = [
    'My brain disconnected, try again.',
    'No response from Claude.',
    'No response data.',
    'No response received.',
    'Vision is only supported by certain models.',
    'An unexpected error occurred, please try again.',
    'I thought too hard, sorry, try again.', // A5
    'I thought too hard, sorry, try again', // A5: the same sentence without the final period
];

describe('MODEL_ERROR_RESPONSES', () => {
    test('is an exported array of non-empty strings', () => {
        assert.ok(Array.isArray(me.MODEL_ERROR_RESPONSES));
        assert.ok(me.MODEL_ERROR_RESPONSES.length >= REQUIRED.length);
        for (const s of me.MODEL_ERROR_RESPONSES) {
            assert.equal(typeof s, 'string');
            assert.ok(s.trim().length > 0, 'an empty entry would make every text an error');
        }
    });

    test('is frozen', () => {
        assert.ok(Object.isFrozen(me.MODEL_ERROR_RESPONSES));
        assert.throws(() => me.MODEL_ERROR_RESPONSES.push('x'), TypeError);
    });

    for (const sentence of REQUIRED) {
        test(`contains at least: "${sentence}"`, () => {
            assert.ok(me.MODEL_ERROR_RESPONSES.includes(sentence));
        });
    }
});

describe('isModelErrorResponse', () => {
    for (const sentence of REQUIRED) {
        test(`exact sentence is an error: "${sentence}"`, () => {
            assert.equal(me.isModelErrorResponse(sentence), true);
        });
    }

    test('every entry of MODEL_ERROR_RESPONSES (also those added by grep) is detected', () => {
        for (const sentence of me.MODEL_ERROR_RESPONSES) {
            assert.equal(me.isModelErrorResponse(sentence), true, sentence);
        }
    });

    test('comparison is case-insensitive', () => {
        assert.equal(me.isModelErrorResponse('MY BRAIN DISCONNECTED, TRY AGAIN.'), true);
        assert.equal(me.isModelErrorResponse('no response from claude.'), true);
        assert.equal(me.isModelErrorResponse('vIsIoN iS oNlY sUpPoRtEd By CeRtAiN mOdElS.'), true);
    });

    test('surrounding whitespace is trimmed (spaces, tabs, CR, LF)', () => {
        assert.equal(me.isModelErrorResponse('   No response data.   '), true);
        assert.equal(me.isModelErrorResponse('\r\n\tNo response received.\r\n'), true);
    });

    test('text that STARTS with a sentence is an error (prefix match)', () => {
        assert.equal(me.isModelErrorResponse('My brain disconnected, try again. (status 529)'), true);
        assert.equal(me.isModelErrorResponse('No response from Claude.\nextra details'), true);
        assert.equal(me.isModelErrorResponse('  an unexpected error occurred, please try again. code=500'), true);
    });

    test('a sentence in the MIDDLE of normal text is NOT an error', () => {
        assert.equal(me.isModelErrorResponse('Okay. My brain disconnected, try again.'), false);
        assert.equal(me.isModelErrorResponse('I said "No response data." earlier'), false);
        assert.equal(me.isModelErrorResponse('Hello! No response from Claude.'), false);
    });

    test('a truncated sentence is NOT an error (the text must contain the whole sentence)', () => {
        assert.equal(me.isModelErrorResponse('My brain disconnected'), false);
        assert.equal(me.isModelErrorResponse('No response'), false);
    });

    test('normal model replies are NOT errors', () => {
        for (const text of [
            'Hello world',
            'Sure, collecting wood now! !collectBlocks("oak_log", 10)',
            'Steve and I built a house near the river.',
            'no',
            '.',
        ]) {
            assert.equal(me.isModelErrorResponse(text), false, text);
        }
    });

    test('non-strings are errors: undefined, null, number, object, array, boolean', () => {
        for (const value of [undefined, null, 0, 42, {}, [], ['My brain disconnected, try again.'], true, false]) {
            assert.equal(me.isModelErrorResponse(value), true, String(value));
        }
    });

    test('called without argument is an error', () => {
        assert.equal(me.isModelErrorResponse(), true);
    });

    test('empty and whitespace-only strings are errors', () => {
        assert.equal(me.isModelErrorResponse(''), true);
        assert.equal(me.isModelErrorResponse('   '), true);
        assert.equal(me.isModelErrorResponse('\r\n\t '), true);
    });

    test('a <think>...</think> block at the start is ignored: error sentence after it is detected', () => {
        assert.equal(me.isModelErrorResponse('<think>The API failed.</think>My brain disconnected, try again.'), true);
        assert.equal(me.isModelErrorResponse('<think>\nreasoning\n</think>\n\n  No response data.  '), true);
        assert.equal(me.isModelErrorResponse('<think>x</think>NO RESPONSE RECEIVED. retrying'), true);
    });

    test('a <think> block followed by normal text is NOT an error', () => {
        assert.equal(me.isModelErrorResponse('<think>Let me plan.</think>Sure, I will build a house.'), false);
        assert.equal(me.isModelErrorResponse('<think>My brain disconnected, try again.</think>I am fine, collecting wood.'), false);
    });

    test('only the FIRST </think> ends the stripped part', () => {
        // Everything up to and including the first </think> is removed; the rest is compared.
        assert.equal(me.isModelErrorResponse('<think>a</think>Hello</think>No response data.'), false);
        assert.equal(me.isModelErrorResponse('<think>a</think>No response data.</think>more'), true);
    });

    describe('A5: the <think> block', () => {
        test('text that is nothing but a <think> block counts as an error response', () => {
            assert.equal(me.isModelErrorResponse('<think>reasoning</think>'), true);
            assert.equal(me.isModelErrorResponse('<think></think>'), true);
            assert.equal(me.isModelErrorResponse('<think>\nline one\nline two\n</think>'), true);
            assert.equal(me.isModelErrorResponse('<think>I am fine, collecting wood.</think>'), true);
        });

        test('a lone <think> block with surrounding whitespace also counts as an error response', () => {
            assert.equal(me.isModelErrorResponse('  \r\n\t<think>reasoning</think>\r\n\t  '), true);
            assert.equal(me.isModelErrorResponse('<think>reasoning</think>   '), true);
            assert.equal(me.isModelErrorResponse('\n<think>reasoning</think>'), true);
        });

        test('leading whitespace before <think> is allowed: the block is still recognised and removed', () => {
            assert.equal(me.isModelErrorResponse('  \n\t<think>plan</think>No response data.'), true);
            assert.equal(me.isModelErrorResponse('\r\n<think>plan</think>  I thought too hard, sorry, try again'), true);
            assert.equal(me.isModelErrorResponse('  <think>plan</think>Hello there, building a house.'), false);
        });

        test('text before the <think> tag means there is no block at the start: nothing is removed', () => {
            assert.equal(me.isModelErrorResponse('Hello <think>x</think>No response data.'), false);
            assert.equal(me.isModelErrorResponse('My brain<think>x</think> disconnected, try again.'), false);
            assert.equal(me.isModelErrorResponse('Okay.<think>x</think>'), false);
            assert.equal(me.isModelErrorResponse('x<think>reasoning</think>'), false);
        });

        test('nothing removed when text comes first: an error sentence before a <think> block is still detected', () => {
            assert.equal(me.isModelErrorResponse('No response data. <think>x</think>'), true);
            assert.equal(me.isModelErrorResponse('My brain disconnected, try again.<think>why</think>more'), true);
        });

        test('<think> without a following </think> is not a block: nothing is removed', () => {
            assert.equal(me.isModelErrorResponse('<think>No response data.'), false);
            assert.equal(me.isModelErrorResponse('<think>unfinished reasoning'), false);
        });

        test('a </think> without <think> at the start removes nothing', () => {
            assert.equal(me.isModelErrorResponse('reasoning</think>No response data.'), false);
            assert.equal(me.isModelErrorResponse('</think>No response data.'), false);
        });

        test('only the first block is removed: a second <think> block stays in the compared text', () => {
            assert.equal(me.isModelErrorResponse('<think>a</think><think>b</think>No response data.'), false);
            assert.equal(me.isModelErrorResponse('<think>a</think> <think>b</think> My brain disconnected, try again.'), false);
        });
    });

    test('is a pure function: same input, same output; the array is not changed', () => {
        const before = [...me.MODEL_ERROR_RESPONSES];
        for (let i = 0; i < 3; i++) {
            assert.equal(me.isModelErrorResponse('No response data.'), true);
            assert.equal(me.isModelErrorResponse('fine'), false);
        }
        assert.deepEqual([...me.MODEL_ERROR_RESPONSES], before);
    });
});

describe('module rules (S2: no imports; S0: importable without side effects)', () => {
    test('has no imports at all', () => {
        const imports = importsOf(MODULE);
        assert.deepEqual(imports.static, []);
        assert.equal(imports.dynamic, 0);
        assert.equal(imports.require, 0);
    });

    test('importing the module prints nothing and creates no files', () => {
        const { run, filesCreated } = importInCleanProcess(MODULE);
        assert.equal(run.status, 0, describeRun(run));
        assert.equal(run.stdout, '', describeRun(run));
        assert.equal(run.stderr, '', describeRun(run));
        assert.deepEqual(filesCreated, []);
    });
});
