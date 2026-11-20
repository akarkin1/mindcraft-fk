// Spec v0.1.4.16, F3 (engineer E2): the caps with the count. `The text of a routine is 1 to 400 characters; yours has <n>.`
// (textText of routine_texts.js, the answer of !rememberRoutine) and `A rule has at most 200 characters; yours has <n>.`
// (rule_commands.js, the answer of !rememberRule); both are said by the bot (agent.sayText) and returned to the model.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importCommands() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        settingsModule.setSettings({ language: 'en', player_rules: true, routines: true, job_memory: true });
        await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        return { actions };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { actions } = await importCommands();
const T = await loadSrc('src/agent/routines/routine_texts.js');
const R = await loadSrc('src/agent/routines/routines.js');
const C = await loadSrc('src/agent/rules/rule_commands.js');
const RS = await loadSrc('src/agent/rules/rule_store.js');

const command = (name) => actions.actionsList.find((c) => c.name === name);
const T0 = Date.UTC(2026, 11, 1, 12, 0, 0);

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

describe('the cap of a routine\'s text (F3)', () => {
    test('textText word for word; TEXT_TEXT is the same function', () => {
        assert.equal(T.textText(412), 'The text of a routine is 1 to 400 characters; yours has 412.');
        assert.equal(T.textText(0), 'The text of a routine is 1 to 400 characters; yours has 0.');
        assert.equal(T.textText('x'), 'The text of a routine is 1 to 400 characters; yours has 0.');
        assert.equal(T.TEXT_TEXT, T.textText);
    });

    test('remember answers the line with the count of the text given (trimmed); 400 is fine', () => {
        const agent = { bot: { registry: { itemsByName: {} }, inventory: { items: () => [] } } };
        const routines = R.createRoutines(agent, new R.RoutineStore(null, { now: () => new Date(T0) }), { settings: {}, now: () => T0 });
        assert.deepEqual(routines.remember('long', 'x'.repeat(412)), { ok: false, reason: 'bad_text', text: 'The text of a routine is 1 to 400 characters; yours has 412.' });
        assert.deepEqual(routines.remember('long', `  ${'y'.repeat(401)}  `), { ok: false, reason: 'bad_text', text: 'The text of a routine is 1 to 400 characters; yours has 401.' });
        assert.deepEqual(routines.remember('empty', '   '), { ok: false, reason: 'bad_text', text: 'The text of a routine is 1 to 400 characters; yours has 0.' });
        assert.equal(routines.remember('fine', 'z'.repeat(400)).ok, true);
    });

    test('!rememberRoutine: the bot says the line and the model gets it; a saved routine is not said', async () => {
        const said = [];
        const agent = { name: 'andy', said, sayText: (t) => said.push(t), bot: { registry: { itemsByName: {} }, inventory: { items: () => [] } }, running_commands: [] };
        agent.routines = R.createRoutines(agent, new R.RoutineStore(null, { now: () => new Date(T0) }), { settings: {}, now: () => T0 });
        const reply = await command('!rememberRoutine').perform(agent, 'long', 'x'.repeat(450));
        assert.equal(reply, 'The text of a routine is 1 to 400 characters; yours has 450.');
        assert.deepEqual(said, ['The text of a routine is 1 to 400 characters; yours has 450.']);
        const ok = await command('!rememberRoutine').perform(agent, 'the farm', 'harvest the wheat farm');
        assert.match(ok, /^I remember the routine "the farm"/);
        assert.equal(said.length, 1, 'only the cap line is said');
        assert.equal(await command('!rememberRoutine').perform(agent, '', 'x'), 'The name of a routine is 1 to 64 characters.');
        assert.equal(said.length, 1);
    });
});

describe('the cap of a rule (F3)', () => {
    test('ruleTooLongText word for word; the count is the store\'s (trimmed, line breaks as spaces)', () => {
        assert.equal(C.ruleTooLongText(231), 'A rule has at most 200 characters; yours has 231.');
        const store = new RS.RuleStore(path.join(dir, 'rules.json'), { now: () => new Date(T0) });
        store.load();
        assert.equal(C.rememberRuleReply(store, `${'x'.repeat(230)}\n${'y'.repeat(10)}`), 'A rule has at most 200 characters; yours has 241.');
        assert.equal(C.rememberRuleReply(store, 'x'.repeat(200)).startsWith('Rule 1 saved'), true, '200 is fine');
    });

    test('!rememberRule: the bot says the line and the model gets it; a saved rule is not said', async () => {
        const said = [];
        const store = new RS.RuleStore(path.join(dir, 'rules.json'), { now: () => new Date(T0) });
        store.load();
        const agent = { name: 'andy', rule_store: store, sayText: (t) => said.push(t), running_commands: [] };
        const reply = await command('!rememberRule').perform(agent, 'x'.repeat(231));
        assert.equal(reply, 'A rule has at most 200 characters; yours has 231.');
        assert.deepEqual(said, ['A rule has at most 200 characters; yours has 231.']);
        assert.equal(await command('!rememberRule').perform(agent, 'Close the door behind you.'), 'Rule 1 saved: "Close the door behind you."');
        assert.equal(said.length, 1, 'a saved rule is the model\'s to relay, as today');
        const noSay = { rule_store: store, running_commands: [] };
        assert.equal(await command('!rememberRule').perform(noSay, 'z'.repeat(201)), 'A rule has at most 200 characters; yours has 201.', 'an agent without sayText still answers');
    });
});
