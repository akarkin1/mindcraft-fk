// Engineer E1 of v0.1.4.11, part W: the argument text built from the params of a command (W5,
// src/agent/commands/index.js), the two lines of the prompt in both profiles (W6), the descriptions of the commands
// of part W (W4 and the shorter ones), and the failure texts of the scorecard (W8).
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, index, actions, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const SC = await loadSrc('scripts/scorecard_logic.js');
const SCRIPT = await loadSrc('scripts/scorecard.js');

let cap;
before(() => M.mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => M.mcdata.__setMcdataForTests(null));
beforeEach(() => {
    cap = captureConsole();
    M.settingsModule.setSettings({ language: 'en', blocked_actions: [] });
});
afterEach(() => cap.restore());

const command = (name) => {
    const cmd = M.actions.actionsList.find((c) => c.name === name);
    assert.ok(cmd, `${name} exists`);
    return cmd;
};

describe('W5: a wrong number of arguments is answered with the form of the command', () => {
    test('the two texts of the spec, word for word, from the parser of the real commands', () => {
        assert.equal(M.index.parseCommandMessage('!rememberRoute("a", "b")'), '!rememberRoute takes 1 argument (name): !rememberRoute("name").');
        assert.equal(M.index.parseCommandMessage('!goToCoordinates(1, 2)'), '!goToCoordinates takes 3 or 4 arguments (x, y, z, closeness): !goToCoordinates(x, y, z).');
    });

    test('built from params: the names in order, the defaults counted in the range, the required ones in the example', () => {
        const p = (type, extra = {}) => ({ type, description: 'x', ...extra });
        const text = (params) => M.index.argumentsText({ name: '!x', params });
        assert.equal(text({ a: p('string') }), '!x takes 1 argument (a): !x("a").');
        assert.equal(text({ a: p('ItemName'), b: p('int') }), '!x takes 2 arguments (a, b): !x("a", b).', 'an item name is a string');
        assert.equal(text({ a: p('string'), b: p('int', { default: 1 }), c: p('boolean', { default: false }) }),
            '!x takes 1 to 3 arguments (a, b, c): !x("a").');
        assert.equal(text({ a: p('int', { default: 1 }) }), '!x takes 0 or 1 arguments (a): !x.');
        assert.equal(text({ a: p('string'), b: p('int', { default: 5 }), c: p('int') }), '!x takes 3 arguments (a, b, c): !x("a", b, c).',
            'a default before a required parameter cannot be left out');
        assert.equal(M.index.argumentsText({ name: '!stop' }), '!stop takes no arguments: !stop.');
    });

    test('executeCommand gives the same text and runs nothing', async () => {
        const agent = { running_commands: [] };
        assert.equal(await M.index.executeCommand(agent, '!rememberRoute("a", "b")', { typed: false }), '!rememberRoute takes 1 argument (name): !rememberRoute("name").');
        assert.deepEqual(agent.running_commands, []);
    });

    test('the text of v0.1.4.10 is gone', () => {
        const source = fs.readFileSync(repoPath('src/agent/commands/index.js'), 'utf8');
        assert.ok(!source.includes('but requires'), 'no "was given N args, but requires M args"');
    });
});

describe('W4 and the descriptions of part W', () => {
    test('!goToSurface, word for word', () => {
        assert.equal(command('!goToSurface').description,
            'Go out under the open sky: out of a building through its door, up from a mine. Use this when the player says "get to the surface" or "get out".');
    });

    test('the other descriptions of part W got shorter, not longer (the prompt stays at 17,000)', () => {
        const old = {
            '!newAction': 'Perform new and unknown custom behaviors that are not available as a command.',
            '!leaveMine': 'Come up from the mine to the surface.',
            '!rememberTunnel': 'Measure the tunnel you stand in, to dig on at its end later. Use this when the player says "dig here".',
            '!goToMine': 'Go down into your mine.',
        };
        for (const [name, before] of Object.entries(old)) assert.ok(command(name).description.length <= before.length, name);
        assert.match(command('!rememberTunnel').description, /"dig here"/, 'the words of the player stay');
    });
});

// ------------------------------------------------------------------ W6: the two lines of the prompt

const W6 = [
    'Answer a question with words, not with a command, and never stop a running command for a question.',
    'A rule about a place names a place you saved; say "this is the aviary" first when it is not saved.',
];
const SENTENCE = 'take a deep breath and have fun :)';

describe('W6: the two lines in both profiles', () => {
    for (const file of ['profiles/claude.json', 'profiles/gpt.json']) {
        test(`${file}: right after "${SENTENCE}", each on its own line`, () => {
            const conversing = JSON.parse(fs.readFileSync(repoPath(file), 'utf8')).conversing;
            assert.ok(conversing.includes(`${SENTENCE}\n${W6[0]}\n${W6[1]}\n`), conversing);
            for (const line of W6) assert.equal(conversing.split(line).length, 2, `${line} once`);
        });
    }

    test('profiles/claude.json: nothing else changed, the text is the one of the default profile with the two lines', () => {
        const claude = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
        const fallback = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
        const marker = '\nSummarized memory:';
        const withLines = fallback.conversing.slice(0, fallback.conversing.indexOf(marker)).replace(SENTENCE, `${SENTENCE}\n${W6.join('\n')}`);
        assert.equal(claude.conversing.slice(0, claude.conversing.indexOf(marker)), withLines);
        assert.equal(claude.conversing.slice(claude.conversing.indexOf(marker)), "\nSummarized memory:'$MEMORY'\n$STATS\n$INVENTORY\n$COMMAND_DOCS\n$EXAMPLES\nConversation Begin:");
        assert.ok(!claude.conversing.includes('command alone'), 'the rule of the gpt profile does not go into the profile of Haiku');
    });

    test('about 150 to 200 characters', () => {
        const n = W6.join('\n').length + 2;
        assert.ok(n <= 210, `${n} characters`);
    });
});

// ------------------------------------------------------------------ W8: the scorecard

describe('W8: the failure texts of the scorecard', () => {
    test('failureTexts: the sentences that begin with a failure start, cut at the first colon or period', () => {
        assert.deepEqual([...SC.FAILURE_STARTS], ['I could not', 'I find no', 'I stand in no', 'I am underground', 'I cannot']);
        assert.deepEqual(SC.failureTexts('Action output:\nI could not follow the route "mine" at step 6 of 12: the door at (9, 41, 43) is closed. '
            + 'Hello. I cannot go. I find no way to the open sky from (10, 48, -26).'),
        ['I could not follow the route "mine" at step 6 of 12', 'I cannot go', 'I find no way to the open sky from (10, 48, -26)']);
        assert.deepEqual(SC.failureTexts('I am underground, not in a mine I know. A new mine starts from the surface'), ['I am underground, not in a mine I know']);
        assert.deepEqual(SC.failureTexts('Gave 4 wheat to w_player. I cannotx'), []);
        assert.deepEqual(SC.failureTexts(null), []);
    });

    const LOG = [
        '[10:00:00] Initializing agent bot...',
        '[10:00:01] Agent executed: !goToMine and got: Action output:',
        'I could not follow the route "mine" at step 6 of 12: the door at (9, 41, 43) is closed and I could not open it.',
        '[10:00:02] Agent executed: !rememberTunnel and got: I stand in no tunnel: it is open on 3 sides at (10, 30, 6).',
        '[10:00:03] Agent executed: !goToMine and got: I could not follow the route "mine" at step 6 of 12: the gate at (1, 2, 3) is blocked.',
        '[10:00:04] I cannot see this: no result of a command',
        'I could not count this either: no result before it',
        '[10:00:05] Agent executed: !mineOre and got: I mined 8 raw_iron.',
    ].join('\n');

    test('counted per log, from the results of commands only, the most frequent first', () => {
        const [row] = SC.scorecard(SC.parseLog(LOG).events, { name: 'a.log' });
        assert.deepEqual(row.failures, { 'I could not follow the route "mine" at step 6 of 12': 2, 'I stand in no tunnel': 1 });
        assert.equal(SC.formatFailures([row]), 'Failure texts, a.log: I could not follow the route "mine" at step 6 of 12 2, I stand in no tunnel 1');
        assert.equal(SC.formatFailures([{ log: 'b.log', failures: {} }]), 'Failure texts, b.log: none');
    });

    test('at most 10, the total sums them', () => {
        const failures = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`I cannot do ${String(i).padStart(2, '0')}`, i + 1]));
        const line = SC.formatFailures([{ log: 'x', failures }]);
        assert.equal(line.slice(line.indexOf(': ') + 2).split(', ').length, 10);
        assert.ok(line.startsWith('Failure texts, x: I cannot do 11 12, I cannot do 10 11'), line);
        const total = SC.totalRow([{ failures: { a: 1 } }, { failures: { a: 2, b: 1 } }]);
        assert.deepEqual(total.failures, { a: 3, b: 1 });
    });

    test('the script prints them after the table and the commands chosen', () => {
        const out = [];
        const code = SCRIPT.main(['a.log'], { read: () => Buffer.from(LOG), log: (t) => out.push(t) });
        assert.equal(code, 0);
        const text = out.join('\n');
        assert.ok(text.indexOf('Commands chosen, a.log') < text.indexOf('Failure texts, a.log: '), text);
        assert.match(text, /\nFailure texts, a\.log: I could not follow the route "mine" at step 6 of 12 2, I stand in no tunnel 1$/);
    });
});
