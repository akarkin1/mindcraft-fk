// Spec v0.1.4.6 R3: src/agent/rules/rule_commands.js -- the replies of !rememberRule, !forgetRule
// and !rules, and the description of !rememberRule, word for word. The commands themselves are
// defined in actions.js and queries.js by the glue engineer; these helpers give them their texts.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/rules/rule_commands.js';
const C = await loadSrc(MODULE);
const R = await loadSrc('src/agent/rules/rule_store.js');

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function store(max) {
    const s = new R.RuleStore(path.join(dir, 'rules.json'), { now: () => new Date(Date.UTC(2026, 0, 1)), max });
    s.load();
    return s;
}

describe('module', () => {
    test('pure: imports only rule_prompt.js', () => {
        assertImportRules(MODULE, { allowBuiltins: [], allowedRelative: ['rule_prompt.js'] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });

    test('the description of !rememberRule, word for word', () => {
        assert.equal(C.REMEMBER_RULE_DESCRIPTION, 'Save a lasting rule from the player. Use this when the player tells you to always or never do something, or says "remember", "do not forget" or "from now on". Write the rule as one short sentence.');
    });
});

describe('rememberRuleReply(store, text)', () => {
    test('saved: Rule <id> saved: "<text>" with the text as it was saved', () => {
        const s = store();
        assert.equal(C.rememberRuleReply(s, 'Close the door behind you.'), 'Rule 1 saved: "Close the door behind you."');
        assert.equal(C.rememberRuleReply(s, '  Seeds are for\nplanting.  '), 'Rule 2 saved: "Seeds are for planting."');
        assert.equal(s.size, 2);
    });

    test('the id in the reply is the lowest free one', () => {
        const s = store();
        C.rememberRuleReply(s, 'One.');
        C.rememberRuleReply(s, 'Two.');
        C.rememberRuleReply(s, 'Three.');
        s.remove(2);
        assert.equal(C.rememberRuleReply(s, 'Four.'), 'Rule 2 saved: "Four."');
    });

    test('duplicate', () => {
        const s = store();
        C.rememberRuleReply(s, 'Close the door.');
        assert.equal(C.rememberRuleReply(s, 'close the door'), 'That rule is already saved.');
    });

    test('too long', () => {
        assert.equal(C.rememberRuleReply(store(), 'x'.repeat(201)), 'A rule has at most 200 characters.');
    });

    test('full, with the limit of the store', () => {
        const s = store();
        for (let i = 1; i <= 20; i++) C.rememberRuleReply(s, `Rule ${i}.`);
        assert.equal(C.rememberRuleReply(s, 'One more.'), 'I already have 20 rules. Forget one first with !forgetRule.');
        const small = store(3);
        for (let i = 1; i <= 3; i++) C.rememberRuleReply(small, `Rule ${i}.`);
        assert.equal(C.rememberRuleReply(small, 'One more.'), 'I already have 3 rules. Forget one first with !forgetRule.');
    });

    test('empty', () => {
        assert.equal(C.rememberRuleReply(store(), '   '), 'A rule needs a text.');
        assert.equal(C.rememberRuleReply(store(), undefined), 'A rule needs a text.');
    });

    test('never throws: a missing or broken store gives a short text and a warning', () => {
        assert.equal(C.rememberRuleReply(null, 'x'), 'The rules are not available.');
        const broken = { add() { throw new Error('boom'); }, list: () => [] };
        assert.equal(C.rememberRuleReply(broken, 'x'), 'The rules are not available.');
        assert.ok(cap.of('warn').length >= 1);
    });

    test('an unknown reason of the store is reported as not available', () => {
        const odd = { add: () => ({ ok: false, id: null, reason: 'strange' }), list: () => [] };
        assert.equal(C.rememberRuleReply(odd, 'x'), 'The rules are not available.');
    });
});

describe('forgetRuleReply(store, number)', () => {
    test('existing rule: Forgot rule <n>.', () => {
        const s = store();
        C.rememberRuleReply(s, 'One.');
        C.rememberRuleReply(s, 'Two.');
        assert.equal(C.forgetRuleReply(s, 2), 'Forgot rule 2.');
        assert.deepEqual(s.list().map((r) => r.id), [1]);
    });

    test('unknown rule: There is no rule <n>.', () => {
        assert.equal(C.forgetRuleReply(store(), 3), 'There is no rule 3.');
    });

    test('never throws', () => {
        assert.equal(C.forgetRuleReply(null, 1), 'The rules are not available.');
        assert.equal(C.forgetRuleReply({ remove() { throw new Error('boom'); } }, 1), 'The rules are not available.');
    });
});

describe('rulesReply(store)', () => {
    test('no rules: No rules are saved yet.', () => {
        assert.equal(C.rulesReply(store()), 'No rules are saved yet.');
    });

    test('the numbered list, one rule per line, numbered by id', () => {
        const s = store();
        C.rememberRuleReply(s, 'Close the door behind you.');
        C.rememberRuleReply(s, 'Seeds are for planting, never compost them.');
        C.rememberRuleReply(s, 'Never dig straight down.');
        s.remove(2);
        assert.equal(C.rulesReply(s), '1. Close the door behind you.\n3. Never dig straight down.');
    });

    test('never throws', () => {
        assert.equal(C.rulesReply(null), 'The rules are not available.');
        assert.equal(C.rulesReply({ list() { throw new Error('boom'); } }), 'The rules are not available.');
    });
});
