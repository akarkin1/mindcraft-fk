// Spec S3: src/agent/history.js -- bots_dir option, save(), load(), summarizeMemories(), add().
//
// Every test runs with the process working directory set to its own empty temp directory,
// so nothing (not even the default './bots' path) is ever written into the repository, and
// an implementation that ignores bots_dir cannot leak state from one test into the next.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeFakeAgent, setMemSaving } from '../helpers/fake_agent.js';

const H = await loadSrc('src/agent/history.js');
const agentSettings = await loadSrc('src/agent/settings.js');

const NAME = 'zz_test_andy';
const OTHER = 'steve';
const SUMMARY = 'summary of the conversation';
const TRUNCATION_SUFFIX = '...(Memory truncated to 500 chars. Compress it more next time)';
const SAVE_KEYS = ['memory', 'turns', 'self_prompting_state', 'self_prompt', 'taskStart', 'last_sender'];

let originalCwd;
let fakeCwd;
let botsDir;
let cap;

before(() => {
    originalCwd = process.cwd();
});
after(() => {
    process.chdir(originalCwd);
});
beforeEach(() => {
    fakeCwd = makeTmpDir();
    process.chdir(fakeCwd);
    botsDir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    process.chdir(originalCwd);
    removeTmpDir(botsDir);
    removeTmpDir(fakeCwd);
});

function newHistory(name = NAME, agentOverrides = {}) {
    const agent = makeFakeAgent(name, agentOverrides);
    const history = new H.History(agent, { bots_dir: botsDir });
    return { agent, history };
}

const memoryPath = (name = NAME) => path.join(botsDir, name, 'memory.json');
const historiesDir = (name = NAME) => path.join(botsDir, name, 'histories');

// All turns appended to full history files, in file-name order.
function readFullHistory(name = NAME) {
    const dir = historiesDir(name);
    let turns = [];
    for (const file of listDir(dir)) {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        assert.ok(Array.isArray(parsed), `${file} holds an array`);
        turns = turns.concat(parsed);
    }
    return turns;
}

const warnings = () => cap.of('warn', 'error');
const user = (content, from = OTHER) => ({ role: 'user', content: `${from}: ${content}` });
const assistant = (content) => ({ role: 'assistant', content });

describe('constructor', () => {
    test('option bots_dir: memory_fp is ${bots_dir}/${name}/memory.json and histories/ is created there', () => {
        const { history } = newHistory('zz_test_ctor');
        assert.equal(path.resolve(history.memory_fp), path.resolve(memoryPath('zz_test_ctor')));
        assert.ok(fs.statSync(historiesDir('zz_test_ctor')).isDirectory());
        assert.equal(fs.existsSync(path.join(fakeCwd, 'bots', 'zz_test_ctor')), false, 'nothing under ./bots');
    });

    test('default bots_dir is ./bots: memory_fp is exactly "./bots/<name>/memory.json" as today', () => {
        const history = new H.History(makeFakeAgent('zz_test_default'));
        assert.equal(history.memory_fp, './bots/zz_test_default/memory.json');
        assert.ok(fs.statSync(path.join(fakeCwd, 'bots', 'zz_test_default', 'histories')).isDirectory());
    });

    test('max_messages is read from the settings object, summary_chunk_size stays 5', () => {
        agentSettings.setSettings({ max_messages: 7 });
        try {
            const { history } = newHistory();
            assert.equal(history.max_messages, 7);
            assert.equal(history.summary_chunk_size, 5);
            assert.equal(history.memory, '');
            assert.deepEqual(history.turns, []);
        } finally {
            agentSettings.setSettings({});
        }
    });
});

describe('save()', () => {
    function fill(history) {
        history.memory = 'I built a house near the river.';
        history.turns = [user('hi'), assistant('Hello ✓')];
    }

    test('writes the same schema, key order and indent as today (exact file content)', async () => {
        const { agent, history } = newHistory();
        fill(history);
        assert.equal(await history.save(), true);
        const expected = {
            memory: history.memory,
            turns: history.turns,
            self_prompting_state: agent.self_prompter.state,
            self_prompt: agent.self_prompter.prompt,
            taskStart: agent.task.taskStartTime,
            last_sender: agent.last_sender,
        };
        const raw = fs.readFileSync(memoryPath(), 'utf8');
        assert.equal(raw, JSON.stringify(expected, null, 2));
        assert.deepEqual(Object.keys(JSON.parse(raw)), SAVE_KEYS);
    });

    test('self_prompt is null when the self prompter is stopped', async () => {
        const { agent, history } = newHistory();
        agent.self_prompter.stopped = true;
        await history.save();
        assert.equal(JSON.parse(fs.readFileSync(memoryPath(), 'utf8')).self_prompt, null);
    });

    test('resolves to true on success', async () => {
        const { history } = newHistory();
        assert.equal(await history.save(), true);
    });

    test('the write is complete when save() returns, before it is awaited', async () => {
        const { history } = newHistory();
        fill(history);
        const pending = history.save();
        // No await yet: callers call save() and then process.exit().
        const onDisk = JSON.parse(fs.readFileSync(memoryPath(), 'utf8'));
        assert.equal(onDisk.memory, 'I built a house near the river.');
        assert.deepEqual(onDisk.turns, history.turns);
        assert.equal(await pending, true);
    });

    test('replaces an existing memory.json and leaves no *.tmp behind', async () => {
        const { history } = newHistory();
        fs.writeFileSync(memoryPath(), JSON.stringify({ memory: 'old', turns: [] }) + 'x'.repeat(1000));
        fill(history);
        assert.equal(await history.save(), true);
        assert.equal(JSON.parse(fs.readFileSync(memoryPath(), 'utf8')).memory, 'I built a house near the river.');
        assert.deepEqual(listDir(path.join(botsDir, NAME)), ['histories', 'memory.json']);
    });

    test('data that cannot be serialised: resolves false (no rejection), logs console.error, old file byte-identical', async () => {
        const { history } = newHistory();
        const old = Buffer.from('{\n  "memory": "keep me"\n}', 'utf8');
        fs.writeFileSync(memoryPath(), old);
        const circular = { role: 'user' };
        circular.self = circular;
        history.turns = [circular];
        const result = await history.save();
        assert.equal(result, false);
        assert.ok(cap.of('error').length >= 1, 'error is logged with console.error');
        assert.deepEqual(fs.readFileSync(memoryPath()), old);
        assert.deepEqual(listDir(path.join(botsDir, NAME)), ['histories', 'memory.json'], 'no temp file');
    });

    test('target cannot be written (memory.json is a directory): resolves false, logs console.error', async () => {
        const { history } = newHistory();
        fs.mkdirSync(memoryPath());
        fs.writeFileSync(path.join(memoryPath(), 'inner.txt'), 'keep');
        const result = await history.save();
        assert.equal(result, false);
        assert.ok(cap.of('error').length >= 1);
        assert.equal(fs.readFileSync(path.join(memoryPath(), 'inner.txt'), 'utf8'), 'keep');
    });

    test('never rejects, even when collecting the data throws (self_prompter missing)', async () => {
        const { agent, history } = newHistory();
        agent.self_prompter = null;
        assert.equal(await history.save(), false);
    });
});

describe('load()', () => {
    const SAVED = {
        memory: 'I remember the river.',
        turns: [{ role: 'user', content: 'steve: hi' }, { role: 'assistant', content: 'hello' }],
        self_prompting_state: 1,
        self_prompt: 'build a small house',
        taskStart: 1_700_000_000_000,
        last_sender: 'steve',
    };

    test('missing file: returns null, memory stays "" and turns []', () => {
        const { history } = newHistory();
        assert.equal(history.load(), null);
        assert.equal(history.memory, '');
        assert.deepEqual(history.turns, []);
    });

    test('valid file: returns the parsed object and sets memory and turns', () => {
        const { history } = newHistory();
        fs.writeFileSync(memoryPath(), JSON.stringify(SAVED, null, 2));
        const result = history.load();
        assert.deepEqual(result, SAVED);
        assert.equal(history.memory, SAVED.memory);
        assert.deepEqual(history.turns, SAVED.turns);
    });

    test('round trip: save() then load() in a new History restores memory and turns', async () => {
        const first = newHistory();
        first.history.memory = 'round trip memory';
        first.history.turns = [user('one'), assistant('two')];
        assert.equal(await first.history.save(), true);

        const second = newHistory();
        const data = second.history.load();
        assert.equal(second.history.memory, 'round trip memory');
        assert.deepEqual(second.history.turns, [user('one'), assistant('two')]);
        assert.deepEqual(Object.keys(data), SAVE_KEYS);
        assert.equal(data.last_sender, 'steve');
        assert.equal(data.taskStart, 1_700_000_000_000);
    });

    for (const [label, content] of [['invalid JSON', '{"memory": "abc", "turns": ['], ['an empty file', ''], ['an array', '[1, 2]'], ['null', 'null']]) {
        test(`corrupt file (${label}): returns null, memory "", turns [], file quarantined, warning names the quarantine file`, () => {
            const { history } = newHistory();
            fs.writeFileSync(memoryPath(), content);
            let result;
            assert.doesNotThrow(() => {
                result = history.load();
            });
            assert.equal(result, null);
            assert.equal(history.memory, '');
            assert.deepEqual(history.turns, []);
            assert.equal(fs.existsSync(memoryPath()), false, 'memory.json moved out of the way');
            const quarantined = listDir(path.join(botsDir, NAME)).filter((f) => f !== 'histories');
            assert.equal(quarantined.length, 1, `files: ${quarantined}`);
            assert.match(quarantined[0], /^memory\.corrupt\.\d{8}-\d{6}(-\d+)?\.json$/);
            assert.equal(fs.readFileSync(path.join(botsDir, NAME, quarantined[0]), 'utf8'), content);
            assert.ok(warnings().some((r) => r.text.includes(quarantined[0])), `a warning names ${quarantined[0]}:\n${cap.allText()}`);
        });
    }

    test('read error (memory.json is a directory): returns null, does not throw, memory "" and turns []', () => {
        const { history } = newHistory();
        fs.mkdirSync(memoryPath());
        let result;
        assert.doesNotThrow(() => {
            result = history.load();
        });
        assert.equal(result, null);
        assert.equal(history.memory, '');
        assert.deepEqual(history.turns, []);
        assert.ok(fs.statSync(memoryPath()).isDirectory());
        assert.ok(warnings().length >= 1, 'a warning is logged');
    });

    const WRONG_TYPES = [
        [{ memory: 42, turns: 'abc' }, 'number memory, string turns'],
        [{ memory: null, turns: {} }, 'null memory, object turns'],
        [{ memory: ['x'], turns: null }, 'array memory, null turns'],
        [{ memory: { text: 'x' }, turns: 5 }, 'object memory, number turns'],
        [{ memory: true, turns: false }, 'boolean memory and turns'],
        [{}, 'both fields missing'],
    ];
    for (const [data, label] of WRONG_TYPES) {
        test(`wrong field types (${label}): memory becomes "", turns becomes [], the parsed object is returned`, () => {
            const { history } = newHistory();
            fs.writeFileSync(memoryPath(), JSON.stringify(data));
            const result = history.load();
            assert.deepEqual(result, data);
            assert.equal(history.memory, '');
            assert.deepEqual(history.turns, []);
        });
    }

    test('valid memory with invalid turns keeps the memory string', () => {
        const { history } = newHistory();
        fs.writeFileSync(memoryPath(), JSON.stringify({ memory: 'kept', turns: 'nope' }));
        history.load();
        assert.equal(history.memory, 'kept');
        assert.deepEqual(history.turns, []);
    });

    test('load() is synchronous (returns the value, not a Promise)', () => {
        const { history } = newHistory();
        fs.writeFileSync(memoryPath(), JSON.stringify(SAVED));
        const result = history.load();
        assert.ok(!(result instanceof Promise));
        assert.deepEqual(result, SAVED);
    });
});

describe('summarizeMemories(turns)', () => {
    const TURNS = [user('collect wood'), assistant('On it!')];

    test('success: calls prompter.promptMemSaving(turns), sets memory to the result, returns true', async () => {
        const { agent, history } = newHistory();
        const result = await history.summarizeMemories(TURNS);
        assert.equal(result, true);
        assert.equal(history.memory, SUMMARY);
        assert.deepEqual(agent.prompter.calls, [TURNS]);
    });

    test('a result of exactly 500 characters is kept as is', async () => {
        const { agent, history } = newHistory();
        const text = 'm'.repeat(500);
        setMemSaving(agent, () => text);
        assert.equal(await history.summarizeMemories(TURNS), true);
        assert.equal(history.memory, text);
    });

    test('a result longer than 500 characters is cut to 500 and the truncation note appended', async () => {
        const { agent, history } = newHistory();
        setMemSaving(agent, () => 'a'.repeat(499) + 'bc' + 'z'.repeat(100));
        assert.equal(await history.summarizeMemories(TURNS), true);
        assert.equal(history.memory, 'a'.repeat(499) + 'b' + TRUNCATION_SUFFIX);
    });

    const ERROR_RESULTS = [
        ['the exact sentence', 'My brain disconnected, try again.'],
        ['a sentence with details after it', 'No response from Claude. (overloaded)'],
        ['a sentence after a <think> block', '<think>api failed</think>No response data.'],
        ['upper case with whitespace', '  AN UNEXPECTED ERROR OCCURRED, PLEASE TRY AGAIN.  '],
        ['a long text that starts with a sentence', 'No response received.' + ' x'.repeat(400)],
        ['an empty string', ''],
        ['whitespace only', '  \n '],
        ['undefined', undefined],
        ['null', null],
        ['a number', 42],
    ];
    for (const [label, value] of ERROR_RESULTS) {
        test(`model error response (${label}): memory unchanged, returns false, warning logged`, async () => {
            const { agent, history } = newHistory();
            history.memory = 'old memory';
            setMemSaving(agent, () => value);
            const result = await history.summarizeMemories(TURNS);
            assert.equal(result, false);
            assert.equal(history.memory, 'old memory');
            assert.ok(warnings().length >= 1, 'a warning is logged');
        });
    }

    test('promptMemSaving rejects: memory unchanged, returns false, does not throw', async () => {
        const { agent, history } = newHistory();
        history.memory = 'old memory';
        setMemSaving(agent, () => {
            throw new Error('network down');
        });
        assert.equal(await history.summarizeMemories(TURNS), false);
        assert.equal(history.memory, 'old memory');
        assert.ok(warnings().length >= 1);
    });

    test('promptMemSaving throws synchronously: memory unchanged, returns false', async () => {
        const { agent, history } = newHistory();
        history.memory = 'old memory';
        agent.prompter.promptMemSaving = () => {
            throw new Error('sync failure');
        };
        assert.equal(await history.summarizeMemories(TURNS), false);
        assert.equal(history.memory, 'old memory');
    });
});

describe('add(name, content)', () => {
    test('role assignment: "system" -> system, own name -> assistant, anyone else -> user with "name: " prefix', async () => {
        const { history } = newHistory();
        history.max_messages = 100;
        await history.add('system', 'You are a bot.');
        await history.add(NAME, 'Hello!');
        await history.add(OTHER, 'hi there');
        assert.deepEqual(history.turns, [
            { role: 'system', content: 'You are a bot.' },
            { role: 'assistant', content: 'Hello!' },
            { role: 'user', content: 'steve: hi there' },
        ]);
    });

    // Sequence used below with max_messages = 8 and summary_chunk_size = 5:
    //   u1 a1 u2 a2 u3 a3 a4 u4  -> at 8 turns the chunk is u1 a1 u2 a2 u3 + a3 a4
    //   (the first 5 turns plus the assistant turns that directly follow them).
    const SEQUENCE = [
        [OTHER, 'u1'], [NAME, 'a1'], [OTHER, 'u2'], [NAME, 'a2'], [OTHER, 'u3'], [NAME, 'a3'], [NAME, 'a4'], [OTHER, 'u4'],
    ];
    const ALL8 = [user('u1'), assistant('a1'), user('u2'), assistant('a2'), user('u3'), assistant('a3'), assistant('a4'), user('u4')];
    const CHUNK = ALL8.slice(0, 7);

    async function addAll(history, pairs) {
        for (const [name, content] of pairs) await history.add(name, content);
    }

    test('no summary while turns.length < max_messages', async () => {
        const { agent, history } = newHistory();
        history.max_messages = 8;
        await addAll(history, SEQUENCE.slice(0, 7));
        assert.equal(agent.prompter.calls.length, 0);
        assert.equal(history.turns.length, 7);
        assert.deepEqual(readFullHistory(), []);
    });

    test('summary succeeded: chunk (first 5 + following assistant turns) removed, appended to full history, memory set', async () => {
        const { agent, history } = newHistory();
        history.max_messages = 8;
        await addAll(history, SEQUENCE);
        assert.deepEqual(agent.prompter.calls, [CHUNK]);
        assert.deepEqual(history.turns, [user('u4')]);
        assert.equal(history.memory, SUMMARY);
        assert.deepEqual(readFullHistory(), CHUNK);
    });

    test('summary failed (error sentence): chunk back at the FRONT in original order, nothing appended, memory unchanged', async () => {
        const { agent, history } = newHistory();
        history.max_messages = 8;
        history.memory = 'old memory';
        setMemSaving(agent, () => 'My brain disconnected, try again.');
        await addAll(history, SEQUENCE);
        assert.deepEqual(agent.prompter.calls, [CHUNK]);
        assert.deepEqual(history.turns, ALL8);
        assert.equal(history.memory, 'old memory');
        assert.deepEqual(readFullHistory(), []);
    });

    test('summary failed (promptMemSaving rejects): add() resolves, chunk put back, nothing appended', async () => {
        const { agent, history } = newHistory();
        history.max_messages = 8;
        setMemSaving(agent, () => {
            throw new Error('network down');
        });
        await addAll(history, SEQUENCE);
        assert.deepEqual(history.turns, ALL8);
        assert.equal(history.memory, '');
        assert.deepEqual(readFullHistory(), []);
    });

    test('after a failed summary the next add tries again and recovers when the summary succeeds', async () => {
        const { agent, history } = newHistory();
        history.max_messages = 8;
        history.memory = 'old memory';
        setMemSaving(agent, () => 'No response data.');
        await addAll(history, SEQUENCE);
        assert.equal(history.memory, 'old memory');

        setMemSaving(agent, () => 'fresh summary');
        await history.add(OTHER, 'u5');
        assert.deepEqual(agent.prompter.calls, [CHUNK], 'retried with the same chunk');
        assert.deepEqual(history.turns, [user('u4'), user('u5')]);
        assert.equal(history.memory, 'fresh summary');
        assert.deepEqual(readFullHistory(), CHUNK);
    });

    describe('growth bound 2 * max_messages while summaries keep failing (max_messages = 6, all user turns)', () => {
        const t = (i) => user(`t${i}`);
        const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => t(from + k));

        async function addUserTurns(history, from, to) {
            for (let i = from; i <= to; i++) await history.add(OTHER, `t${i}`);
        }

        test('every add with turns.length >= max_messages retries the summary', async () => {
            const { agent, history } = newHistory();
            history.max_messages = 6;
            setMemSaving(agent, () => '');
            await addUserTurns(history, 1, 9);
            assert.equal(agent.prompter.calls.length, 4, 'adds 6, 7, 8 and 9');
            for (const call of agent.prompter.calls) assert.deepEqual(call, range(1, 5));
        });

        test('putting back gives 2 * max_messages - 1 = 11: the chunk is still kept', async () => {
            const { agent, history } = newHistory();
            history.max_messages = 6;
            history.memory = 'old memory';
            setMemSaving(agent, () => 'My brain disconnected, try again.');
            await addUserTurns(history, 1, 11);
            assert.deepEqual(history.turns, range(1, 11));
            assert.deepEqual(readFullHistory(), []);
            assert.equal(history.memory, 'old memory');
        });

        test('putting back would give 2 * max_messages = 12: chunk dropped from turns, appended to full history, memory kept, warning', async () => {
            const { agent, history } = newHistory();
            history.max_messages = 6;
            history.memory = 'old memory';
            setMemSaving(agent, () => 'My brain disconnected, try again.');
            await addUserTurns(history, 1, 11);
            const warningsBefore = warnings().length;
            await history.add(OTHER, 't12');
            assert.deepEqual(history.turns, range(6, 12));
            assert.deepEqual(readFullHistory(), range(1, 5));
            assert.equal(history.memory, 'old memory');
            assert.ok(warnings().length > warningsBefore, 'a warning is logged');
        });

        test('after a drop the bound keeps working and a later successful summary recovers', async () => {
            const { agent, history } = newHistory();
            history.max_messages = 6;
            setMemSaving(agent, () => 'No response received.');
            await addUserTurns(history, 1, 13);
            // t12 dropped t1..t5; t13: 8 turns -> chunk t6..t10 fails -> put back (8 < 12)
            assert.deepEqual(history.turns, range(6, 13));
            assert.deepEqual(readFullHistory(), range(1, 5));

            setMemSaving(agent, () => 'recovered summary');
            await history.add(OTHER, 't14');
            assert.deepEqual(history.turns, range(11, 14));
            assert.deepEqual(readFullHistory(), range(1, 10));
            assert.equal(history.memory, 'recovered summary');
        });
    });
});
