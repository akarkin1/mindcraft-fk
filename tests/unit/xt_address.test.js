// Tests from the spec (v0.1.4.13, section 6, T1): addressing by name of part N1 (SPEC 4.2) and the supervisor's row
// of part N2 (SPEC 4.5). addressedTo(text, names) for every row of 4.2: own name first, own name after "hey", another
// bot first, the supervisor first, no name, a name inside a sentence, both names with "and"; the punctuation and the
// case of the first word; the address words in any order within the first three words. shouldAnswer gets the row:
// `addressed_other` not answered, the supervisor not answered, the own name answered with `rest` as the text.
// The handoff (N1): `rest` is '' when the line is the address alone. Written from the spec, not from the code.
// A failing test is a finding.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ADDRESS_WORDS, addressedTo, shouldAnswer } from '../../src/agent/bots_logic.js';

const NAMES = ['claude', 'gpt', 'Opus'];
const OWNER = 'MartyByrde2';

/** The line as claude gets it from the owner, with gpt the other bot and Opus the supervisor. */
function verdict(text, self = 'claude', supervisor = 'Opus') {
    const otherBots = ['claude', 'gpt'].filter((n) => n !== self);
    return shouldAnswer({ from: OWNER, text, self, otherBots, names: ['claude', 'gpt'], supervisor });
}

describe('SPEC 4.2 addressedTo: the rows of the spec', () => {
    test('own name first: "claude, come here"', () => {
        assert.deepEqual(addressedTo('claude, come here', NAMES), { name: 'claude', rest: 'come here' });
    });

    test('own name after "hey": "hey claude, come"', () => {
        assert.deepEqual(addressedTo('hey claude, come', NAMES), { name: 'claude', rest: 'come' });
    });

    test('another bot first: "gpt, wait here"', () => {
        assert.deepEqual(addressedTo('gpt, wait here', NAMES), { name: 'gpt', rest: 'wait here' });
    });

    test('the supervisor first: "Opus, where is it?"', () => {
        assert.deepEqual(addressedTo('Opus, where is it?', NAMES), { name: 'Opus', rest: 'where is it?' });
    });

    test('no name: "come here"', () => {
        assert.equal(addressedTo('come here', NAMES), null);
    });

    test('a name inside a sentence is no address: "tell gpt to wait"', () => {
        assert.equal(addressedTo('tell gpt to wait', NAMES), null);
        assert.equal(addressedTo('where is claude going', NAMES), null);
    });

    test('both names with "and" address none: "claude and gpt, come here"', () => {
        assert.equal(addressedTo('claude and gpt, come here', NAMES), null);
    });
});

describe('SPEC 4.2 addressedTo: the first word', () => {
    test('trailing , : ! ? . are stripped', () => {
        for (const mark of [',', ':', '!', '?', '.'])
            assert.deepEqual(addressedTo(`claude${mark} come here`, NAMES), { name: 'claude', rest: 'come here' }, mark);
    });

    test('compared without case; the name is the spelling of names', () => {
        assert.deepEqual(addressedTo('CLAUDE, come here', NAMES), { name: 'claude', rest: 'come here' });
        assert.deepEqual(addressedTo('opus: why is it going to the surface?', NAMES), { name: 'Opus', rest: 'why is it going to the surface?' });
    });

    test('the address alone: rest is empty (the handoff)', () => {
        assert.deepEqual(addressedTo('claude?', NAMES), { name: 'claude', rest: '' });
    });

    test('a name of no bot is no address', () => {
        assert.equal(addressedTo('steve, come here', NAMES), null);
    });
});

describe('SPEC 4.2 addressedTo: the address words', () => {
    test('the list of the spec', () => {
        assert.deepEqual([...ADDRESS_WORDS].sort(), ['and', 'hey', 'hi', 'now', 'ok', 'okay', 'please', 'so'].sort());
    });

    test('each word before the name in the first three words', () => {
        for (const word of ['hey', 'hi', 'ok', 'okay', 'so', 'now', 'please', 'and'])
            assert.deepEqual(addressedTo(`${word} gpt, wait`, NAMES), { name: 'gpt', rest: 'wait' }, word);
    });

    test('any of them in any order: "ok so gpt wait", "now please claude come"', () => {
        assert.deepEqual(addressedTo('ok so gpt wait', NAMES), { name: 'gpt', rest: 'wait' });
        assert.deepEqual(addressedTo('now please claude come', NAMES), { name: 'claude', rest: 'come' });
    });

    test('the name must be one of the first three words', () => {
        assert.equal(addressedTo('hey ok so claude come', NAMES), null);
    });

    test('a word that is no address word before the name: no address', () => {
        assert.equal(addressedTo('yes claude, come', NAMES), null);
        assert.equal(addressedTo('ask gpt now', NAMES), null);
    });
});

describe('SPEC 4.2 shouldAnswer: the row of the address', () => {
    test('own name first: answered with rest as the text', () => {
        const v = verdict('claude, come here');
        assert.equal(v.answer, true);
        assert.equal(v.why, 'addressed_self');
        assert.equal(v.text, 'come here');
    });

    test('own name after "hey": answered with rest as the text', () => {
        const v = verdict('hey claude, come here');
        assert.equal(v.answer, true);
        assert.equal(v.text, 'come here');
    });

    test('another bot first: not answered, why addressed_other', () => {
        const v = verdict('gpt, wait here');
        assert.equal(v.answer, false);
        assert.equal(v.why, 'addressed_other');
        const w = verdict('claude, come here', 'gpt');
        assert.equal(w.answer, false);
        assert.equal(w.why, 'addressed_other');
    });

    test('the supervisor first: not answered by any bot', () => {
        for (const self of ['claude', 'gpt']) {
            const v = verdict('Opus, where is it?', self);
            assert.equal(v.answer, false, self);
        }
    });

    test('no name: answered, the line unchanged', () => {
        const v = verdict('come here');
        assert.equal(v.answer, true);
        assert.ok(v.text === undefined || v.text === 'come here', JSON.stringify(v));
    });

    test('a name inside a sentence: answered by both', () => {
        assert.equal(verdict('tell gpt to wait', 'claude').answer, true);
        assert.equal(verdict('tell gpt to wait', 'gpt').answer, true);
    });

    test('both names: both answer', () => {
        assert.equal(verdict('claude and gpt, come here', 'claude').answer, true);
        assert.equal(verdict('claude and gpt, come here', 'gpt').answer, true);
    });

    test('without a supervisor name, "Opus, ..." is a line like any other', () => {
        assert.equal(verdict('Opus, where is it?', 'claude', '').answer, true);
    });
});

describe('SPEC 4.5 shouldAnswer: the relayed line of the supervisor (part N2)', () => {
    test('[Opus] <text> is answered by no bot, why supervisor', () => {
        const v = shouldAnswer({ from: 'gpt', text: '[Opus] It is in the tunnel.', self: 'claude', otherBots: [], names: ['claude', 'gpt'], supervisor: 'Opus' });
        assert.equal(v.answer, false);
        assert.equal(v.why, 'supervisor');
    });
});
