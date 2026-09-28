// Spec v0.1.4.6 R2: src/agent/rules/rule_prompt.js -- buildRulesSection(rules), the section with the
// rules of the player for the conversing and the coding prompt. Pure module.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { captureConsole } from '../helpers/console_capture.js';

const MODULE = 'src/agent/rules/rule_prompt.js';
const P = await loadSrc(MODULE);
const SP = await loadSrc('src/agent/skills/skill_prompt.js');

const HEADER = 'RULES FROM THE PLAYER (always follow them, they are more important than your own ideas):';

const rule = (id, text) => ({ id, text, created: '2026-01-01T00:00:00.000Z' });

describe('module', () => {
    test('exports buildRulesSection and the header', () => {
        assert.equal(typeof P.buildRulesSection, 'function');
        assert.equal(P.RULES_HEADER, HEADER);
    });

    test('pure: imports nothing', () => {
        assertImportRules(MODULE, { allowBuiltins: [], allowedRelative: [] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});

describe('buildRulesSection(rules)', () => {
    test('the example of the spec, word for word', () => {
        const section = P.buildRulesSection([
            rule(1, 'Close the door behind you.'),
            rule(2, 'Seeds are for planting, never compost them.'),
        ]);
        assert.equal(section, [
            HEADER,
            '1. Close the door behind you.',
            '2. Seeds are for planting, never compost them.',
        ].join('\n'));
    });

    test('without rules: empty text', () => {
        for (const rules of [[], undefined, null, 'rules', 42, {}]) {
            assert.equal(P.buildRulesSection(rules), '', String(rules));
        }
    });

    test('the number of a rule is its id, so it matches !rules and !forgetRule', () => {
        const section = P.buildRulesSection([rule(2, 'Two.'), rule(5, 'Five.')]);
        assert.equal(section, `${HEADER}\n2. Two.\n5. Five.`);
    });

    test('rules are listed in the order given', () => {
        const section = P.buildRulesSection([rule(3, 'Three.'), rule(1, 'One.')]);
        assert.equal(section, `${HEADER}\n3. Three.\n1. One.`);
    });

    test('plain strings are numbered by their position', () => {
        assert.equal(P.buildRulesSection(['One.', 'Two.']), `${HEADER}\n1. One.\n2. Two.`);
    });

    test('an entry without a whole number id is numbered by its position', () => {
        assert.equal(P.buildRulesSection([{ text: 'One.' }, { id: 'x', text: 'Two.' }, { id: 0, text: 'Three.' }]),
            `${HEADER}\n1. One.\n2. Two.\n3. Three.`);
    });

    test('entries without text are left out; with none left the section is empty', () => {
        assert.equal(P.buildRulesSection([null, rule(1, ''), rule(2, '  '), { id: 3 }, 7, rule(4, 'Four.')]), `${HEADER}\n4. Four.`);
        assert.equal(P.buildRulesSection([null, rule(1, ''), { id: 3 }]), '');
    });

    test('line breaks inside a text become spaces, so every rule stays on one line', () => {
        assert.equal(P.buildRulesSection([rule(1, ' Close\r\nthe door.\n')]), `${HEADER}\n1. Close the door.`);
    });

    test('a $ in a text arrives unchanged', () => {
        assert.equal(P.buildRulesSection([rule(1, 'Never spend $5 or $NAME.')]), `${HEADER}\n1. Never spend $5 or $NAME.`);
    });

    test('never throws, also for an entry whose text cannot be read', () => {
        const cap = captureConsole();
        try {
            const evil = { id: 1, get text() { throw new Error('boom'); } };
            let section;
            assert.doesNotThrow(() => {
                section = P.buildRulesSection([evil, rule(2, 'Two.')]);
            });
            assert.equal(section, `${HEADER}\n2. Two.`);
        } finally {
            cap.restore();
        }
    });

    test('never throws for a list whose items cannot be read', () => {
        const cap = captureConsole();
        try {
            const list = new Proxy([rule(1, 'One.')], {
                get(target, prop) {
                    if (prop === 'length') return 1;
                    if (prop === '0') throw new Error('boom');
                    return Reflect.get(target, prop);
                },
            });
            assert.equal(P.buildRulesSection(list), '');
        } finally {
            cap.restore();
        }
    });
});

describe('the section in a prompt with insertSection of skill_prompt.js', () => {
    test('without the placeholder it goes directly before "Conversation Begin:"', () => {
        const prompt = 'You are a bot.\n$EXAMPLES\nConversation Begin:';
        const section = P.buildRulesSection([rule(1, 'Close the door behind you.')]);
        assert.equal(SP.insertSection(prompt, section),
            `You are a bot.\n$EXAMPLES\n${HEADER}\n1. Close the door behind you.\nConversation Begin:`);
    });

    test('after the skill section when both are inserted in that order', () => {
        const prompt = 'You are a bot.\nConversation Begin:';
        const withSkills = SP.insertSection(prompt, 'SAVED SKILLS: something');
        const withRules = SP.insertSection(withSkills, P.buildRulesSection(['Close the door.']));
        assert.equal(withRules, `You are a bot.\nSAVED SKILLS: something\n${HEADER}\n1. Close the door.\nConversation Begin:`);
    });

    test('an empty section leaves the prompt unchanged', () => {
        const prompt = 'You are a bot.\nConversation Begin:';
        assert.equal(SP.insertSection(prompt, P.buildRulesSection([])), prompt);
    });
});
