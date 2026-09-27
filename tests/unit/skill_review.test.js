// Spec v0.1.4.4 K5: src/agent/skills/skill_review.js -- snapshotState, diffState, extractTask,
// buildReviewPrompt, parseReview. Plus K8: the review template `skill_review` in
// profiles/defaults/_default.json.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { assertSkillModuleImports } from '../helpers/source_ast.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/skills/skill_review.js';
const R = await loadSrc(MODULE);

const REVIEW_TEMPLATE = [
    'You are reviewing code that the Minecraft bot $NAME wrote and ran. Decide whether it should be saved as a reusable skill.',
    'TASK: $TASK',
    'CODE:',
    '$CODE',
    'OUTPUT OF THE RUN:',
    '$OUTPUT',
    'CHANGE OF THE BOT: $STATE_CHANGE',
    'SKILLS SAVED SO FAR: $SKILL_LIST',
    'Answer with one JSON object and nothing else. Keys: "achieved": true only if the output and the change show that the task was done. "reusable": true only if the function is general, which means it has parameters for what varies, does not depend on coordinates of this world, and is more than a call of one existing function. "description": one sentence that says what the function does, written for someone who decides later whether to call it. "reason": one short sentence.',
].join('\n');

const snapshot = (inventory, position) => ({ inventory, position, health: 20, food: 20 });

describe('snapshotState(bot, getInventoryCounts)', () => {
    test('inventory from getInventoryCounts(bot), position copied as { x, y, z }, health and food', () => {
        const position = { x: 1.5, y: 64, z: -3, extra: 'not copied', offset() { return this; } };
        const bot = { entity: { position }, health: 17, food: 12 };
        const calls = [];
        const counts = (b) => {
            calls.push(b);
            return { oak_log: 3, dirt: 1 };
        };
        const state = R.snapshotState(bot, counts);
        assert.deepEqual(state, { inventory: { oak_log: 3, dirt: 1 }, position: { x: 1.5, y: 64, z: -3 }, health: 17, food: 12 });
        assert.equal(calls[0], bot);
        position.x = 999;
        assert.equal(state.position.x, 1.5, 'a copy, not the live position');
    });

    test('health 0 and food 0 are kept', () => {
        const state = R.snapshotState({ entity: { position: { x: 0, y: 0, z: 0 } }, health: 0, food: 0 }, () => ({}));
        assert.equal(state.health, 0);
        assert.equal(state.food, 0);
    });

    test('getInventoryCounts throws or is missing: inventory {}', () => {
        const bot = { entity: { position: { x: 0, y: 0, z: 0 } }, health: 20, food: 20 };
        assert.deepEqual(R.snapshotState(bot, () => { throw new Error('no inventory'); }).inventory, {});
        assert.deepEqual(R.snapshotState(bot, undefined).inventory, {});
    });

    test('missing values: position, health, food null', () => {
        const state = R.snapshotState({}, () => ({}));
        assert.deepEqual(state, { inventory: {}, position: null, health: null, food: null });
        assert.equal(R.snapshotState({ entity: {} }, () => ({})).position, null);
        assert.equal(R.snapshotState({ entity: { position: null } }, () => ({})).position, null);
    });

    const HOSTILE = [
        ['undefined', undefined], ['null', null], ['a number', 42], ['a string', 'bot'],
        ['a throwing getter', { get entity() { throw new Error('gone'); }, get health() { throw new Error('gone'); } }],
    ];
    for (const [label, bot] of HOSTILE) {
        test(`never throws: bot ${label}`, () => {
            let state;
            assert.doesNotThrow(() => {
                state = R.snapshotState(bot, () => { throw new Error('x'); });
            });
            assert.deepEqual(state.inventory, {});
            assert.equal(state.position, null);
        });
    }
});

describe('diffState(before, after)', () => {
    test('gained and lost, gained first, each group sorted by name; moved rounded to 1 decimal', () => {
        const before = snapshot({ oak_log: 1, dirt: 5, stone: 2, cobblestone: 4 }, { x: 0, y: 64, z: 0 });
        const after = snapshot({ oak_log: 4, dirt: 4, stone: 2, apple: 1, cobblestone: 2 }, { x: 1, y: 65, z: 1 });
        const diff = R.diffState(before, after);
        assert.deepEqual(diff.gained, { apple: 1, oak_log: 3 });
        assert.deepEqual(diff.lost, { cobblestone: 2, dirt: 1 });
        assert.equal(diff.moved, 1.7);
        assert.equal(diff.text, 'Inventory: +1 apple, +3 oak_log, -2 cobblestone, -1 dirt. Moved 1.7 blocks.');
    });

    test('an item that is gone completely is lost', () => {
        const diff = R.diffState(snapshot({ torch: 3 }, null), snapshot({}, null));
        assert.deepEqual(diff.lost, { torch: 3 });
        assert.deepEqual(diff.gained, {});
        assert.equal(diff.text, 'Inventory: -3 torch. Did not move.');
    });

    test('nothing changed: "Inventory unchanged. Did not move."', () => {
        const s = snapshot({ dirt: 1 }, { x: 5, y: 64, z: 5 });
        const diff = R.diffState(s, snapshot({ dirt: 1 }, { x: 5, y: 64, z: 5 }));
        assert.deepEqual(diff.gained, {});
        assert.deepEqual(diff.lost, {});
        assert.equal(diff.moved, 0);
        assert.equal(diff.text, 'Inventory unchanged. Did not move.');
    });

    test('moved distance (Euclidean, 3D)', () => {
        const diff = R.diffState(snapshot({}, { x: 0, y: 64, z: 0 }), snapshot({}, { x: 3, y: 64, z: 4 }));
        assert.equal(diff.moved, 5);
        const far = R.diffState(snapshot({}, { x: 0, y: 0, z: 0 }), snapshot({}, { x: 10, y: 5, z: 5 }));
        assert.equal(far.moved, 12.2);
        assert.equal(far.text, 'Inventory unchanged. Moved 12.2 blocks.');
    });

    test('below 0.5: "Did not move."; 0.5: moved', () => {
        const small = R.diffState(snapshot({}, { x: 0, y: 0, z: 0 }), snapshot({}, { x: 0.3, y: 0, z: 0 }));
        assert.equal(small.moved, 0.3);
        assert.equal(small.text, 'Inventory unchanged. Did not move.');
        const half = R.diffState(snapshot({}, { x: 0, y: 0, z: 0 }), snapshot({}, { x: 0.5, y: 0, z: 0 }));
        assert.equal(half.moved, 0.5);
        assert.equal(half.text, 'Inventory unchanged. Moved 0.5 blocks.');
    });

    test('a position is missing: moved 0', () => {
        assert.equal(R.diffState(snapshot({}, null), snapshot({}, { x: 100, y: 0, z: 0 })).moved, 0);
        assert.equal(R.diffState(snapshot({}, { x: 100, y: 0, z: 0 }), snapshot({}, null)).moved, 0);
    });

    test('works on the output of snapshotState', () => {
        const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, health: 20, food: 20, inv: { dirt: 0 } };
        const counts = (b) => ({ ...b.inv });
        const before = R.snapshotState(bot, counts);
        bot.inv = { dirt: 3 };
        const after = R.snapshotState(bot, counts);
        assert.equal(R.diffState(before, after).text, 'Inventory: +3 dirt. Did not move.');
    });
});

describe('extractTask(messages)', () => {
    const user = (content) => ({ role: 'user', content });
    const assistant = (content) => ({ role: 'assistant', content });
    const system = (content) => ({ role: 'system', content });

    test('the text between the quotes of the last !newAction( command', () => {
        const messages = [
            system('You are a bot.'),
            user('steve: build a wall please'),
            assistant('On it. !newAction("Build a 5 block dirt wall in front of you")'),
            system('Code generation started. Write code in codeblock in your response:'),
        ];
        assert.equal(R.extractTask(messages), 'Build a 5 block dirt wall in front of you');
    });

    test('the LAST message with !newAction( wins', () => {
        const messages = [assistant('!newAction("First task")'), user('steve: now something else'), assistant('Sure! !newAction("Second task")')];
        assert.equal(R.extractTask(messages), 'Second task');
    });

    test('system messages are ignored', () => {
        const messages = [assistant('!newAction("Real task")'), system('Example: !newAction("Not this one")')];
        assert.equal(R.extractTask(messages), 'Real task');
    });

    test('a user message with !newAction( counts', () => {
        const messages = [assistant('!newAction("Old")'), user('steve: !newAction("Dig a hole")')];
        assert.equal(R.extractTask(messages), 'Dig a hole');
    });

    test('quotes inside the task: from the first " to the last " before the closing )', () => {
        const messages = [assistant('Ok. !newAction("Build a wall called "north" today") Doing it now.')];
        assert.equal(R.extractTask(messages), 'Build a wall called "north" today');
    });

    test('no !newAction: the content of the last user message', () => {
        const messages = [user('steve: first'), assistant('hi'), user('steve: collect 5 oak logs'), assistant('ok')];
        assert.equal(R.extractTask(messages), 'steve: collect 5 oak logs');
    });

    test('cut to 300 characters', () => {
        assert.equal(R.extractTask([assistant('!newAction("' + 'x'.repeat(400) + '")')]), 'x'.repeat(300));
        assert.equal(R.extractTask([user('y'.repeat(400))]), 'y'.repeat(300));
    });

    test("no messages: ''", () => {
        assert.equal(R.extractTask([]), '');
        assert.equal(R.extractTask(undefined), '');
        assert.equal(R.extractTask(null), '');
    });

    test("neither !newAction nor a user message: ''", () => {
        assert.equal(R.extractTask([assistant('hello'), system('x')]), '');
    });

    test('$ characters are kept', () => {
        assert.equal(R.extractTask([assistant('!newAction("Pay $& and $1")')]), 'Pay $& and $1');
    });
});

describe('buildReviewPrompt(template, values)', () => {
    const T = 'N=$NAME|T=$TASK|C=$CODE|O=$OUTPUT|S=$STATE_CHANGE|L=$SKILL_LIST';
    const VALUES = { name: 'andy', task: 'build', code: 'await f(bot);', output: 'done', stateChange: 'Inventory unchanged. Did not move.', skillList: 'a(bot), b(bot, n)' };

    test('replaces the six placeholders', () => {
        assert.equal(R.buildReviewPrompt(T, VALUES), 'N=andy|T=build|C=await f(bot);|O=done|S=Inventory unchanged. Did not move.|L=a(bot), b(bot, n)');
    });

    test('a missing value becomes (none)', () => {
        assert.equal(R.buildReviewPrompt(T, { name: 'andy' }), 'N=andy|T=(none)|C=(none)|O=(none)|S=(none)|L=(none)');
        assert.equal(R.buildReviewPrompt(T, {}), 'N=(none)|T=(none)|C=(none)|O=(none)|S=(none)|L=(none)');
    });

    test('every occurrence is replaced', () => {
        assert.equal(R.buildReviewPrompt('$NAME and $NAME', { name: 'andy' }), 'andy and andy');
    });

    test('$ characters in the values are inserted literally', () => {
        const values = { ...VALUES, code: 'log(bot, "$& $1 $$ $` $\'");', output: 'cost $&' };
        assert.equal(R.buildReviewPrompt('C=$CODE|O=$OUTPUT', values), 'C=log(bot, "$& $1 $$ $` $\'");|O=cost $&');
    });

    test('the real template of K8: no placeholder is left', () => {
        const text = R.buildReviewPrompt(REVIEW_TEMPLATE, VALUES);
        for (const p of ['$NAME', '$TASK', '$CODE', '$OUTPUT', '$STATE_CHANGE', '$SKILL_LIST']) assert.ok(!text.includes(p), p);
        assert.ok(text.includes('the Minecraft bot andy wrote'));
        assert.ok(text.includes('SKILLS SAVED SO FAR: a(bot), b(bot, n)'));
    });
});

describe('parseReview(text)', () => {
    const REVIEW = { achieved: true, reusable: true, description: 'Builds a wall of dirt.', reason: 'It has parameters.' };
    const json = (obj) => JSON.stringify(obj);

    test('a plain JSON object', () => {
        assert.deepEqual(R.parseReview(json(REVIEW)), { ok: true, ...REVIEW });
    });

    test('code fences and text around the object are tolerated', () => {
        assert.deepEqual(R.parseReview('```json\n' + json(REVIEW) + '\n```'), { ok: true, ...REVIEW });
        assert.deepEqual(R.parseReview('Here is my review:\n' + json(REVIEW) + '\nThanks.'), { ok: true, ...REVIEW });
    });

    test('nested objects and braces in strings: from the first { to the matching last }', () => {
        const text = json({ ...REVIEW, description: 'Uses {x} braces.', extra: { a: { b: 1 } } });
        const result = R.parseReview(text);
        assert.equal(result.ok, true);
        assert.equal(result.description, 'Uses {x} braces.');
    });

    test('achieved false and reusable false are ok answers', () => {
        const result = R.parseReview(json({ ...REVIEW, achieved: false, reusable: false }));
        assert.equal(result.ok, true);
        assert.equal(result.achieved, false);
        assert.equal(result.reusable, false);
    });

    test('description: line breaks become spaces, trimmed, cut to 200; missing gives \'\'', () => {
        assert.equal(R.parseReview(json({ ...REVIEW, description: '  Line one.\nLine two.  ' })).description, 'Line one. Line two.');
        assert.equal(R.parseReview(json({ ...REVIEW, description: 'd'.repeat(300) })).description, 'd'.repeat(200));
        const noDescription = { achieved: true, reusable: true, reason: 'r' };
        const result = R.parseReview(json(noDescription));
        assert.equal(result.ok, true);
        assert.equal(result.description, '');
    });

    const NOT_OK = [
        ['a model error text', 'My brain disconnected, try again.'],
        ['another model error text', 'No response from Claude.'],
        ['empty', ''],
        ['whitespace', '   \n '],
        ['no JSON object', 'I think this is fine.'],
        ['invalid JSON', '{achieved: true, reusable: true}'],
        ['achieved is a string', json({ ...REVIEW, achieved: 'true' })],
        ['reusable is a number', json({ ...REVIEW, reusable: 1 })],
        ['achieved missing', json({ reusable: true, description: 'd' })],
        ['reusable missing', json({ achieved: true, description: 'd' })],
        ['a JSON array', '[true, true]'],
    ];
    for (const [label, text] of NOT_OK) {
        test(`not ok: ${label}`, () => {
            assert.equal(R.parseReview(text).ok, false);
        });
    }

    const HOSTILE = [
        ['undefined', undefined], ['null', null], ['a number', 42], ['an object', { achieved: true, reusable: true }], ['an array', []],
        ['only {', '{'], ['only }', '}'], ['}{', '}{'], ['cut JSON', '{"achieved": tru'], ['$ characters', '$&$1{"achieved":true}'],
        ['very long text', '{'.repeat(50000) + 'x' + '}'.repeat(50000)],
    ];
    for (const [label, text] of HOSTILE) {
        test(`never throws: ${label}`, () => {
            let result;
            assert.doesNotThrow(() => {
                result = R.parseReview(text);
            });
            assert.equal(result.ok, false);
        });
    }
});

describe('K8: profiles/defaults/_default.json', () => {
    test('has the key skill_review with the review template of the spec', () => {
        const profile = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
        assert.equal(typeof profile.skill_review, 'string');
        assert.equal(profile.skill_review.replace(/\s+$/, ''), REVIEW_TEMPLATE);
    });
});

describe('module rules', () => {
    test('pure: imports only model_errors.js, sibling skill modules and built-ins without I/O', () => {
        assertSkillModuleImports(MODULE, { pure: true, allowProjectFiles: ['src/utils/model_errors.js'] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
