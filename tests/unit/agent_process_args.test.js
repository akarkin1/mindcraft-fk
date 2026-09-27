// Spec v0.1.4.3 W7 (process plumbing) and the cheap, stable source-text parts of W9 (agent.js).
//
// src/process/agent_process.js is imported for real; child_process.spawn is replaced for the
// duration of each test (live ESM bindings are synced with syncBuiltinESMExports), so no agent
// process is ever started. Date.now is replaced during the crash-restart test because the
// module only restarts an agent that ran for at least 10 seconds.
//
// src/process/init_agent.js starts an agent when imported, and src/agent/agent.js cannot run
// without a server: both are checked by reading their source text only.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importAgentProcess() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/process/agent_process.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const AP = await importAgentProcess();

let spawned;
let restoreSpawn;
let cap;
let realDateNow;

beforeEach(() => {
    spawned = [];
    const original = childProcess.spawn;
    childProcess.spawn = (command, args, options) => {
        const child = new EventEmitter();
        child.killed = false;
        child.kills = [];
        child.kill = (signal) => {
            child.kills.push(signal);
            return true;
        };
        spawned.push({ command, args: [...args], options, child });
        return child;
    };
    syncBuiltinESMExports();
    restoreSpawn = () => {
        childProcess.spawn = original;
        syncBuiltinESMExports();
    };
    cap = captureConsole();
    realDateNow = Date.now;
});
afterEach(() => {
    Date.now = realDateNow;
    cap.restore();
    restoreSpawn();
});

function newProcess() {
    assert.equal(typeof AP.AgentProcess, 'function', 'AgentProcess must be an exported class');
    return new AP.AgentProcess('andy', 8080);
}

// true when the argument list contains '-r' directly followed by true / 'true'
function hasRestartFlag(args) {
    const i = args.indexOf('-r');
    return i >= 0 && String(args[i + 1]) === 'true';
}

describe('AgentProcess.start (W7)', () => {
    test('the spawn replacement is effective (sanity check)', () => {
        newProcess().start();
        assert.equal(spawned.length, 1);
        assert.equal(spawned[0].args[0], 'src/process/init_agent.js');
    });

    test('first start without arguments: no "-r true"; the other arguments as in v0.1.4.2', () => {
        newProcess().start();
        const args = spawned[0].args;
        assert.equal(hasRestartFlag(args), false, args.join(' '));
        assert.deepEqual(args.slice(0, 6).map(String), ['src/process/init_agent.js', 'andy', '-n', 'andy', '-c', '0']);
        assert.ok(args.includes('-p'));
    });

    test('start(true, msg, 0, false): no "-r true"', () => {
        newProcess().start(true, 'hello', 0, false);
        assert.equal(hasRestartFlag(spawned[0].args), false, spawned[0].args.join(' '));
    });

    test('start(false, null, 0, true): arguments contain "-r" followed by true', () => {
        newProcess().start(false, null, 0, true);
        assert.equal(hasRestartFlag(spawned[0].args), true, spawned[0].args.join(' '));
    });

    test('automatic restart after a crash passes -r true (and -l true as before)', () => {
        let now = 1_000_000;
        Date.now = () => now;
        const ap = newProcess();
        ap.start(false, null, 0);
        assert.equal(hasRestartFlag(spawned[0].args), false);
        now += 20_000;
        spawned[0].child.emit('exit', 1, null);
        assert.equal(spawned.length, 2, 'restarted once');
        const args = spawned[1].args;
        assert.equal(hasRestartFlag(args), true, args.join(' '));
        const l = args.indexOf('-l');
        assert.ok(l >= 0 && String(args[l + 1]) === 'true', args.join(' '));
    });

    test('forceRestart while running: the new process gets -r true', () => {
        const ap = newProcess();
        ap.start(false, null, 0);
        ap.forceRestart();
        assert.deepEqual(spawned[0].child.kills, ['SIGINT']);
        spawned[0].child.emit('exit', null, 'SIGINT');
        assert.equal(spawned.length, 2);
        assert.equal(hasRestartFlag(spawned[1].args), true, spawned[1].args.join(' '));
    });

    test('forceRestart when not running: the new process gets -r true', () => {
        const ap = newProcess();
        ap.start(false, null, 0);
        spawned[0].child.emit('exit', 0, null);
        assert.equal(spawned.length, 1, 'a clean exit does not restart');
        ap.forceRestart();
        assert.equal(spawned.length, 2);
        assert.equal(hasRestartFlag(spawned[1].args), true, spawned[1].args.join(' '));
    });
});

// ---- source text checks -------------------------------------------------------------------

function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
const source = (rel) => stripComments(fs.readFileSync(repoPath(rel), 'utf8'));

describe('init_agent.js option restart (W7, source text)', () => {
    test('declares option restart: alias r, type boolean, default false', () => {
        const text = source('src/process/init_agent.js');
        const m = /\.option\(\s*['"]restart['"]\s*,\s*\{([^}]*)\}/.exec(text);
        assert.ok(m, 'option("restart", {...}) is declared');
        const body = m[1];
        assert.match(body, /alias\s*:\s*(['"]r['"]|\[\s*['"]r['"]\s*\])/);
        assert.match(body, /type\s*:\s*['"]boolean['"]/);
        assert.match(body, /default\s*:\s*false\b/);
    });

    test('passes the option as the fourth argument of agent.start', () => {
        const text = source('src/process/init_agent.js');
        const m = /\bagent\.start\(([^)]*)\)/.exec(text);
        assert.ok(m, 'agent.start(...) is called');
        const args = m[1].split(',').map((a) => a.trim());
        assert.equal(args.length, 4, m[0]);
        assert.match(args[3], /^argv(\.restart|\.r|\[\s*['"](restart|r)['"]\s*\])$/, m[0]);
    });
});

describe('agent.js glue (W9, source text)', () => {
    const text = source('src/agent/agent.js');

    test('start(load_mem = false, init_message = null, count_id = 0, is_restart = false) and this.is_restart', () => {
        assert.match(text, /async\s+start\s*\(\s*load_mem\s*=\s*false\s*,\s*init_message\s*=\s*null\s*,\s*count_id\s*=\s*0\s*,\s*is_restart\s*=\s*false\s*\)/);
        assert.match(text, /this\.is_restart\s*=(?!=)[^;\n]*\bis_restart\b/);
    });

    test('the name is validated (from settings.profile.name) before the Prompter is constructed', () => {
        const start = text.search(/async\s+start\s*\(/);
        const prompter = text.indexOf('new Prompter(', start);
        assert.ok(start >= 0 && prompter > start, 'new Prompter( inside start');
        const validate = text.indexOf('validateNameFormat(', start);
        assert.ok(validate > start && validate < prompter, 'validateNameFormat( comes before new Prompter(');
        const profileName = text.slice(start, prompter).search(/settings\.profile\??\.name/);
        assert.ok(profileName >= 0, 'settings.profile.name is read before new Prompter(');
    });

    test('!forgetPlace and !nameWorld are named in agent.js (blocked when world_memory is off)', () => {
        assert.match(text, /['"`]!forgetPlace['"`]/);
        assert.match(text, /['"`]!nameWorld['"`]/);
    });
});
