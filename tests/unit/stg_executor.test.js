// Part G of v0.1.4.8 (E6): src/agent/commands/index.js.
//   - executeCommand with the repeat guard of F5 (agent.repeat_guard, the setting repeat_guard): a
//     command of the model that gave the same result limit - 1 times in a row is refused before it runs,
//     with the text of the guard; a command typed by the player is recorded and never refused;
//   - while a command runs it is on agent.running_commands with its text and whether it was typed;
//   - commandCallText: the text of the command in a message, for last_order.text and the guard;
//   - the parameter type IntOrString of !chopTrees: a whole number becomes a number, a word stays text;
//     the docs call it a number.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        return { settingsModule, index };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const RG = await loadSrc('src/agent/repeat_guard.js');

let cap;
beforeEach(() => {
    cap = captureConsole();
    M.settingsModule.setSettings({ language: 'en', blocked_actions: [] });
});
afterEach(() => cap.restore());

// A fake command !stgProbe(text) that records its runs and what executeCommand showed while it ran.
function withProbe(fn) {
    const name = '!stgProbe';
    const seen = [];
    const probe = {
        name,
        description: 'A probe of the test.',
        params: { text: { type: 'string', description: 'text' } },
        perform: async (agent, text) => {
            seen.push({ text, running: JSON.parse(JSON.stringify(agent.running_commands ?? null)) });
            return text === 'nothing' ? undefined : `Could not do ${text}.`; // a failure for the guard
        },
    };
    const original = M.index.getCommand(name);
    assert.equal(original, undefined, 'no such command in the list');
    return (async () => {
        // the command map is private: the probe goes in through a copy of the lookup of an existing command
        const host = M.index.getCommand('!searchWiki'); // not a command that only reads: the guard counts it
        const saved = { name: host.name, description: host.description, params: host.params, perform: host.perform };
        Object.assign(host, { description: probe.description, params: probe.params, perform: probe.perform });
        try {
            await fn(seen, '!searchWiki');
        } finally {
            Object.assign(host, saved);
        }
    })();
}

describe('executeCommand: the repeat guard (F5)', () => {
    test('without agent.repeat_guard: every try runs', () => withProbe(async (seen, name) => {
        const agent = {};
        for (let i = 0; i < 4; i++) assert.equal(await M.index.executeCommand(agent, `${name}("x")`), 'Could not do x.');
        assert.equal(seen.length, 4);
    }));

    test('limit 3: the third identical try of the model is refused with the text of the guard, before it runs', () => withProbe(async (seen, name) => {
        const agent = { repeat_guard: new RG.RepeatGuard({ limit: 3 }) };
        assert.equal(await M.index.executeCommand(agent, `${name}("x")`), 'Could not do x.');
        assert.equal(await M.index.executeCommand(agent, `${name}("x")`), 'Could not do x.');
        const refusal = await M.index.executeCommand(agent, `${name}("x")`);
        assert.equal(refusal, `I tried ${name}("x") 2 times with the same result: Could not do x. I do not try a third time. Ask the player what to do.`);
        assert.equal(seen.length, 2, 'the refused try did not run');
        // other arguments: a new row, it runs
        assert.equal(await M.index.executeCommand(agent, `${name}("y")`), 'Could not do y.');
    }));

    test('a command typed by the player is recorded and never refused', () => withProbe(async (seen, name) => {
        const agent = { repeat_guard: new RG.RepeatGuard({ limit: 2 }) };
        assert.equal(await M.index.executeCommand(agent, `${name}("x")`, { typed: true }), 'Could not do x.');
        assert.equal(await M.index.executeCommand(agent, `${name}("x")`, { typed: true }), 'Could not do x.', 'typed: runs again');
        assert.match(await M.index.executeCommand(agent, `${name}("x")`), /^I tried .* 2 times with the same result/, 'the model: refused, the typed runs were recorded');
        // the order of handleMessage (typed, the same command) counts as typed without the option
        agent.last_order = { by: 'bob', command: name, typed: true };
        assert.equal(await M.index.executeCommand(agent, `${name}("x")`), 'Could not do x.');
    }));

    test('a result of nothing (a stopped command) ends the row', () => withProbe(async (seen, name) => {
        const agent = { repeat_guard: new RG.RepeatGuard({ limit: 2 }) };
        await M.index.executeCommand(agent, `${name}("nothing")`);
        assert.equal(await M.index.executeCommand(agent, `${name}("nothing")`), undefined);
        assert.equal(seen.length, 2);
    }));

    test('a command of a pack: record(name, args, text, ok === false); a stopped one is not recorded; another command: record(name, args, text)', async () => {
        M.settingsModule.setSettings({ language: 'en', blocked_actions: [], storage_pack: true });
        const records = [];
        const guard = { check: () => null, record: (...args) => records.push(args) };
        let next = { ok: false, reason: 'no_chest', text: 'I know no chest with room.' };
        let interrupted = false;
        const agent = {
            repeat_guard: guard, bot: { modes: { pause() {} } }, history: { add: async () => {} }, last_order: null,
            work_packs: { storage: { storeItems: async () => next } }, packContext: () => ({}),
            actions: { runAction: async (label, fn) => { await fn(); return { success: true, message: 'Action output:\n', interrupted, timedout: false }; } },
        };
        await M.index.executeCommand(agent, '!storeItems');
        next = { ok: true, reason: null, text: 'I stored 3 wheat.' };
        await M.index.executeCommand(agent, '!storeItems');
        next = { ok: false, reason: 'interrupted', text: 'I stored 1 wheat. I was stopped before I stored the rest.' };
        assert.equal(await M.index.executeCommand(agent, '!storeItems'), undefined, 'a result "interrupted" is a stopped command (I6)');
        next = { ok: true, reason: null, text: 'I stored 3 wheat.' };
        interrupted = true;
        assert.equal(await M.index.executeCommand(agent, '!storeItems'), undefined, 'stopped by the action manager');
        agent.cost_meter = { summaryText: () => 'Cost: session $0.10.' };
        M.settingsModule.setSettings({ language: 'en', blocked_actions: [], storage_pack: true, cost_meter: true });
        await M.index.executeCommand(agent, '!cost');
        assert.deepEqual(records, [
            ['!storeItems', [], 'I know no chest with room.', true],
            ['!storeItems', [], 'I stored 3 wheat.', false],
            ['!cost', [], 'Cost: session $0.10.'],
        ]);
    });

    test('with the real guard: a pack that fails (ok: false) is refused the second time with limit 2; a pack that succeeds never', async () => {
        M.settingsModule.setSettings({ language: 'en', blocked_actions: [], storage_pack: true });
        let next = { ok: false, reason: 'no_room', text: 'All chests I know are full.' };
        const agent = {
            repeat_guard: new RG.RepeatGuard({ limit: 2 }), bot: { modes: { pause() {} } }, history: { add: async () => {} }, last_order: null,
            work_packs: { storage: { storeItems: async () => next } }, packContext: () => ({}),
            actions: { runAction: async (label, fn) => { await fn(); return { success: true, message: '', interrupted: false, timedout: false }; } },
        };
        assert.equal(await M.index.executeCommand(agent, '!storeItems'), 'All chests I know are full.');
        assert.equal(await M.index.executeCommand(agent, '!storeItems'), 'I tried !storeItems 1 time with the same result: All chests I know are full. I do not try a second time. Ask the player what to do.');
        next = { ok: true, reason: null, text: 'I stored 3 wheat.' };
        const fresh = { ...agent, repeat_guard: new RG.RepeatGuard({ limit: 2 }) };
        for (let i = 0; i < 3; i++) assert.equal(await M.index.executeCommand(fresh, '!storeItems'), 'I stored 3 wheat.');
    });

    test('a guard that throws never breaks the command', async () => {
        const agent = { repeat_guard: { check: () => null, record() { throw new Error('boom'); } }, cost_meter: { summaryText: () => 'Cost.' } };
        assert.equal(await M.index.executeCommand(agent, '!cost'), 'Cost.');
    });

    test('a message that does not parse is answered as before, the guard is not asked', async () => {
        const agent = { repeat_guard: { check() { throw new Error('must not be asked'); }, record() { throw new Error('must not record'); } } };
        assert.equal(await M.index.executeCommand(agent, '!noSuchCommand'), '!noSuchCommand is not a command.');
    });
});

describe('executeCommand: agent.running_commands', () => {
    test('the command with its text and whether it was typed, while it runs; gone afterwards', () => withProbe(async (seen, name) => {
        const agent = {};
        await M.index.executeCommand(agent, `${name}('x')`, { typed: true });
        await M.index.executeCommand(agent, `${name}("y")`);
        assert.deepEqual(seen.map((s) => s.running), [
            [{ name, args: ['x'], text: `${name}("x")`, typed: true }],
            [{ name, args: ['y'], text: `${name}("y")`, typed: false }],
        ]);
        assert.deepEqual(agent.running_commands, []);
    }));

    test('a command that throws leaves the list', () => withProbe(async (seen, name) => {
        const host = M.index.getCommand(name);
        host.perform = async () => { throw new Error('boom'); };
        const agent = {};
        await assert.rejects(M.index.executeCommand(agent, `${name}("x")`), /boom/);
        assert.deepEqual(agent.running_commands, []);
    }));
});

describe('commandCallText', () => {
    test('the command as the player could type it, with defaults and double quotes', () => {
        assert.equal(M.index.commandCallText('!stats'), '!stats');
        assert.equal(M.index.commandCallText("Sure! !goToPlayer('bob') now"), '!goToPlayer("bob", 3)');
        assert.equal(M.index.commandCallText('!setMode("hunger", false)'), '!setMode("hunger", false)');
    });

    test('a command that does not parse: as written; no command: null', () => {
        assert.equal(M.index.commandCallText('!noSuchCommand("x")'), '!noSuchCommand("x")');
        assert.equal(M.index.commandCallText('hello there'), null);
        assert.equal(M.index.commandCallText(null), null);
    });
});

describe('the parameter type IntOrString', () => {
    const lookup = (name) => (name === '!probe' ? { name, params: { num: { type: 'IntOrString', description: 'n', domain: [1, 100], default: 8 }, kind: { type: 'string', description: 'k', default: '' } } } : undefined);

    test('a whole number becomes a number (with its domain), a word stays text', () => {
        assert.deepEqual(M.index.parseCommandMessage('!probe(4, "oak")', lookup).args, [4, 'oak']);
        assert.deepEqual(M.index.parseCommandMessage('!probe("4", "oak")', lookup).args, [4, 'oak']);
        assert.deepEqual(M.index.parseCommandMessage('!probe("oak", 4)', lookup).args, ['oak', '4']);
        assert.deepEqual(M.index.parseCommandMessage('!probe("", 4)', lookup).args, ['', '4']);
        assert.deepEqual(M.index.parseCommandMessage('!probe', lookup).args, [8, '']);
        assert.match(M.index.parseCommandMessage('!probe(0)', lookup), /^Error: Param 'num' must be an element of \[1, 100\)\.$/);
    });

    test('the docs call it a number', () => {
        const docs = M.index.getCommandDocs({ blocked_actions: [] }, [lookup('!probe')]);
        assert.ok(docs.includes('num: (number) n (optional, default 8)\n'), docs);
    });
});
