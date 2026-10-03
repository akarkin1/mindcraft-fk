// v0.1.4.13, the live voice (docs/releases/0.1.4.13/HANDOFF-voice.md, 2 and 3): the mute rule and the bot's lines.
// With voice_ui the page speaks, so speak() of src/agent/speak.js returns at once (no line is spoken twice); with
// voice_ui off it speaks as before. The lines the bot whispers (only_chat_with) also reach the page as bot-output.
// child_process is replaced, so no process is started and no sound is played.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { readRepoFile } from '../helpers/source_ast.js';

// speak.js imports the model modules, which look for ./keys.json: import it from an empty folder
async function importQuietly(rel) {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc(rel);
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const S = await importQuietly('src/agent/speak.js');
const agentSettings = await loadSrc('src/agent/settings.js');

describe('systemVoiceMuted(settings)', () => {
    test('true only with voice_ui true', () => {
        assert.equal(S.systemVoiceMuted({ voice_ui: true }), true);
        assert.equal(S.systemVoiceMuted({ voice_ui: false }), false);
        assert.equal(S.systemVoiceMuted({}), false);
        assert.equal(S.systemVoiceMuted({ voice_ui: 'true' }), false);
        assert.equal(S.systemVoiceMuted(null), false);
    });
});

describe('speak(text, "system") with and without voice_ui', () => {
    let calls;
    let restore;
    let cap;

    beforeEach(() => {
        cap = captureConsole();
        calls = [];
        const originals = { exec: childProcess.exec, execFile: childProcess.execFile, spawn: childProcess.spawn };
        const record = (api, callback) => {
            const child = new EventEmitter();
            calls.push(api);
            setImmediate(() => {
                if (callback) callback(null, '', '');
                child.emit('exit', 0, null);
            });
            return child;
        };
        childProcess.exec = (command, options, callback) => record('exec', typeof options === 'function' ? options : callback);
        childProcess.execFile = (file, args, options, callback) => record('execFile', [args, options, callback].find((f) => typeof f === 'function'));
        childProcess.spawn = () => record('spawn', null);
        syncBuiltinESMExports();
        restore = () => {
            Object.assign(childProcess, originals);
            syncBuiltinESMExports();
        };
    });
    afterEach(() => {
        restore();
        cap.restore();
        agentSettings.setSettings({});
    });

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    test('voice_ui on: nothing is started', async () => {
        agentSettings.setSettings({ voice_ui: true, speak: true });
        S.speak('the page speaks this', 'system');
        await flush();
        await flush();
        assert.deepEqual(calls, []);
    });

    test('voice_ui off: the system voice speaks as before', async () => {
        agentSettings.setSettings({ voice_ui: false, speak: true });
        S.speak('the system voice speaks this', 'system');
        await flush();
        assert.deepEqual(calls, ['execFile']);
        await flush();
        await flush();
    });
});

describe('agent.js: the lines the bot whispers reach the page', () => {
    test('openChat: the only_chat_with branch sends the line to the mindserver after the whispers', () => {
        const source = readRepoFile('src/agent/agent.js').replace(/\r\n/g, '\n');
        const start = source.indexOf('    async openChat(message) {');
        assert.ok(start > 0, 'openChat exists');
        const body = source.slice(start, source.indexOf('\n    startEvents() {', start));
        const branch = body.slice(body.indexOf('if (settings.only_chat_with.length > 0) {'), body.indexOf('        else {'));
        assert.match(branch, /this\.bot\.whisper\(username, message\);[\s\S]*sendOutputToServer\(this\.name, message\)/);
        assert.match(branch, /try \{ sendOutputToServer\(this\.name, message\); \} catch/, 'never breaks the whisper');
    });
});
