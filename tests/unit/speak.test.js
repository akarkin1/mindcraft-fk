// Play test fix F5: system text-to-speech (src/agent/speak.js).
//
// The text of the language model was put into a command line that exec() hands to a shell; only
// ' was escaped. A line break broke the PowerShell command (TerminatorExpectedAtEndOfString), and
// a double quote, &, |, a backtick or $(...) could run commands. Now no shell is used and the
// text is never part of a command line: on Windows PowerShell runs a constant script that reads
// the text from the environment variable MINDCRAFT_TTS_TEXT of the child process; say and espeak
// get the text as one argument after "--". Control characters become spaces.
//
// Seam: systemSpeechCommand(text, platform) -> { command, args, env }, a pure function.
// The queue is tested with exec, execFile and spawn of node:child_process replaced by recorders,
// so no process is started and no sound is played. speak.js is imported with an empty temp
// directory as working directory (it imports the model modules, which look for ./keys.json).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { readRepoFile, parseModule } from '../helpers/source_ast.js';

async function importSpeak() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/agent/speak.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const S = await importSpeak();

const ENV_NAME = 'MINDCRAFT_TTS_TEXT';
const PLATFORMS = ['win32', 'darwin', 'linux'];
const HOSTILE = [
    ['single quotes', "it's a 'test'"],
    ['double quotes', 'say "hi" now'],
    ['ampersand', 'a & calc.exe & b'],
    ['pipe', 'a | calc'],
    ['semicolon', 'a; Remove-Item C:/x; b'],
    ['backticks', 'a `n `$x b'],
    ['subexpression', '$(calc)'],
    ['environment variables', '%PATH% and $env:PATH'],
    ['line breaks', "Got it!\nI'll build\r\na house\ttoday"],
    ['leading dash', '-v evil --output-file=/tmp/x'],
    ['5000 characters', 'x'.repeat(4999) + '!'],
    ['emoji', 'Hello \u{1F44B} world \u{1F30D}'],
    ['all together', `'"; & | ; \` $(calc) %PATH% \n -x`],
];

// Control characters and line/paragraph separators become one space each.
const cleaned = (text) => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');

describe('systemSpeechCommand(text, platform)', () => {
    for (const platform of PLATFORMS) {
        for (const [label, text] of HOSTILE) {
            test(`${platform}, ${label}: the text is only in ${platform === 'win32' ? 'env' : 'one separate argument'}`, () => {
                const reference = S.systemSpeechCommand('reference text', platform);
                const built = S.systemSpeechCommand(text, platform);
                assert.equal(built.command, reference.command, 'the command is the same for every text');
                if (platform === 'win32') {
                    assert.deepEqual(built.args, reference.args, 'the arguments (and the script) are the same for every text');
                    assert.deepEqual(built.env, { [ENV_NAME]: cleaned(text) });
                } else {
                    assert.equal(built.args.length, reference.args.length);
                    const last = built.args.length - 1;
                    assert.deepEqual(built.args.slice(0, last), reference.args.slice(0, last), 'options are the same for every text');
                    assert.equal(built.args[last], cleaned(text), 'the text is the last argument, whole');
                    assert.equal(built.args[last - 1], '--', 'after "--", so a leading "-" is not an option');
                    assert.deepEqual(built.env, {});
                }
            });
        }
    }

    test('win32: powershell with a constant script that speaks $env:MINDCRAFT_TTS_TEXT at rate 2', () => {
        const built = S.systemSpeechCommand('hello', 'win32');
        assert.equal(built.command, 'powershell');
        assert.deepEqual(built.args.slice(0, -1), ['-NoProfile', '-NonInteractive', '-Command']);
        const script = built.args.at(-1);
        assert.ok(script.includes('Add-Type -AssemblyName System.Speech'), script);
        assert.ok(script.includes('$s.Rate=2'), script);
        assert.ok(script.includes(`$s.Speak($env:${ENV_NAME})`), script);
        assert.equal((script.match(/\$env:/g) || []).length, 1, 'no other environment variable is read');
        assert.ok(!script.includes('hello'));
    });

    test('darwin: say, linux: espeak, no other options (as before)', () => {
        assert.deepEqual(S.systemSpeechCommand('hello', 'darwin'), { command: 'say', args: ['--', 'hello'], env: {} });
        assert.deepEqual(S.systemSpeechCommand('hello', 'linux'), { command: 'espeak', args: ['--', 'hello'], env: {} });
    });

    test('line breaks, tabs and other control characters become spaces; emoji and length are kept', () => {
        const text = 'a\nb\r\nc\td\u0000e\u0085f\u2028g\u001bh';
        assert.equal(S.systemSpeechCommand(text, 'linux').args.at(-1), 'a b  c d e f g h');
        assert.equal(S.systemSpeechCommand(text, 'win32').env[ENV_NAME], 'a b  c d e f g h');
        const emoji = 'Hi \u{1F44B}\u{1F3FD} \u00e9\u00e8 \u4f60\u597d';
        assert.equal(S.systemSpeechCommand(emoji, 'win32').env[ENV_NAME], emoji);
        assert.equal(S.systemSpeechCommand('y'.repeat(5000), 'darwin').args.at(-1).length, 5000);
    });

    test('the platform defaults to process.platform', () => {
        assert.deepEqual(S.systemSpeechCommand('hello'), S.systemSpeechCommand('hello', process.platform));
    });
});

describe('speak.js source', () => {
    test('child_process: only execFile and spawn are imported, no shell option', () => {
        const text = readRepoFile('src/agent/speak.js');
        const ast = parseModule(text);
        const imported = [];
        for (const node of ast.body) {
            if (node.type === 'ImportDeclaration' && /^(node:)?child_process$/.test(node.source.value)) {
                for (const s of node.specifiers) imported.push(s.type === 'ImportSpecifier' ? s.imported.name : s.type);
            }
        }
        assert.ok(imported.length > 0, 'imports from child_process');
        for (const name of imported) assert.ok(['execFile', 'spawn'].includes(name), `imports ${name}`);
        assert.doesNotMatch(text, /shell\s*:/);
    });
});

describe('speak(text, "system"): the queue', () => {
    let calls;
    let restore;
    let cap;

    // Replaces exec, execFile and spawn. finish(err) ends a recorded call like the real one would.
    beforeEach(() => {
        cap = captureConsole();
        calls = [];
        const originals = { exec: childProcess.exec, execFile: childProcess.execFile, spawn: childProcess.spawn };
        let throwNext = null;
        const record = (api, command, args, options, callback) => {
            if (throwNext) {
                const err = throwNext;
                throwNext = null;
                throw err;
            }
            const child = new EventEmitter();
            const call = { api, command, args, options: options || {}, child, finished: false };
            call.finish = (err = null) => {
                call.finished = true;
                if (callback) callback(err, '', '');
                if (api === 'spawn') {
                    if (err) child.emit('error', err);
                    else {
                        child.emit('exit', 0, null);
                        child.emit('close', 0, null);
                    }
                }
            };
            calls.push(call);
            return child;
        };
        childProcess.exec = (command, options, callback) => {
            if (typeof options === 'function') [options, callback] = [{}, options];
            return record('exec', command, [], options, callback);
        };
        childProcess.execFile = (file, args, options, callback) => {
            if (typeof args === 'function') [args, options, callback] = [[], {}, args];
            if (typeof options === 'function') [options, callback] = [{}, options];
            return record('execFile', file, args, options, callback);
        };
        childProcess.spawn = (command, args, options) => record('spawn', command, args, options, null);
        syncBuiltinESMExports();
        calls.throwNext = (err) => { throwNext = err; };
        restore = () => {
            Object.assign(childProcess, originals);
            syncBuiltinESMExports();
        };
    });
    afterEach(() => {
        restore();
        cap.restore();
    });

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    function assertStarted(call, text) {
        const expected = S.systemSpeechCommand(text, process.platform);
        assert.notEqual(call.api, 'exec', 'no shell');
        assert.ok(!call.options.shell, 'no shell option');
        assert.equal(call.command, expected.command);
        assert.deepEqual(call.args, expected.args);
        for (const [key, value] of Object.entries(expected.env)) assert.equal(call.options.env?.[key], value, `env ${key}`);
        if (Object.keys(expected.env).length > 0) {
            for (const key of Object.keys(process.env)) assert.ok(key in call.options.env, `the child keeps ${key}`);
        }
    }

    test('two texts: one at a time, the next starts when the current one has ended', async () => {
        S.speak('first reply', 'system');
        S.speak('second reply', 'system');
        await flush();
        assert.equal(calls.length, 1);
        assertStarted(calls[0], 'first reply');
        calls[0].finish();
        await flush();
        assert.equal(calls.length, 2);
        assertStarted(calls[1], 'second reply');
        calls[1].finish();
        await flush();
        assert.equal(calls.length, 2);
    });

    test('a failing text: "TTS error" is logged, the next one still starts', async () => {
        S.speak('bad one', 'system');
        S.speak('good one', 'system');
        await flush();
        assert.equal(calls.length, 1);
        const error = new Error('Command failed');
        calls[0].finish(error);
        await flush();
        const logged = cap.of('error').filter((r) => r.args[0] === 'TTS error');
        assert.equal(logged.length, 1, cap.allText());
        assert.equal(logged[0].args[1], error);
        assert.equal(calls.length, 2);
        assertStarted(calls[1], 'good one');
        calls[1].finish();
        await flush();
    });

    test('starting the process throws: "TTS error" is logged, the queue goes on', async () => {
        calls.throwNext(new Error('spawn failed'));
        S.speak('cannot start', 'system');
        S.speak('after that', 'system');
        await flush();
        assert.equal(cap.of('error').filter((r) => r.args[0] === 'TTS error').length, 1, cap.allText());
        assert.equal(calls.length, 1);
        assertStarted(calls[0], 'after that');
        calls[0].finish();
        await flush();
    });

    test('text that is empty after the cleaning is skipped', async () => {
        S.speak('  \n\t\u0001\r\n ', 'system');
        S.speak('', 'system');
        S.speak('real text', 'system');
        await flush();
        assert.equal(calls.length, 1);
        assertStarted(calls[0], 'real text');
        calls[0].finish();
        await flush();
    });

    test('a reply with a line break is spoken as one line (the play test case)', async () => {
        const reply = "Got it! I'll gather some wood.\n!collectBlocks(\"oak_log\", 10)";
        S.speak(reply, 'system');
        await flush();
        assert.equal(calls.length, 1);
        assertStarted(calls[0], reply);
        const spoken = process.platform === 'win32' ? calls[0].options.env[ENV_NAME] : calls[0].args.at(-1);
        assert.equal(spoken, 'Got it! I\'ll gather some wood. !collectBlocks("oak_log", 10)');
        calls[0].finish();
        await flush();
    });

    test('hostile texts never reach a shell', async () => {
        for (const [, text] of HOSTILE) S.speak(text, 'system');
        for (let i = 0; i < HOSTILE.length; i++) {
            await flush();
            assert.equal(calls.length, i + 1);
            assertStarted(calls[i], HOSTILE[i][1]);
            calls[i].finish();
        }
        await flush();
        assert.equal(calls.filter((c) => c.api === 'exec').length, 0);
    });
});
