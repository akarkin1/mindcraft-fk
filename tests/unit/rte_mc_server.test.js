// Spec v0.1.4.9 section 9, point 5 and the README note (part E): tests/world/mc_server.js finds the
// test server in the default folder of scripts/get_test_server.js also on Linux and macOS, and starts
// the server without JAVA_TOOL_OPTIONS.
//
// No Minecraft server and no Java: the start is tested with a small shell script in the place of
// java that prints what it got and the line the runner waits for (not on Windows, where a shell
// script is no program).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const W = await loadSrc('tests/world/mc_server.js');
const L = await loadSrc('scripts/get_test_server_logic.js');

describe('locateServer: the default folder', () => {
    test('Linux and macOS: ~/.local/share/mindcraft/test-server, as the script', () => {
        for (const platform of ['linux', 'darwin']) {
            const found = W.locateServer({ HOME: '/home/alex' }, platform);
            const jar = path.join('/home/alex/.local/share/mindcraft/test-server', 'server-1.21.8.jar');
            assert.equal(found.missing, `server jar ${jar}`, platform);
            assert.equal(L.defaultDir(platform, { HOME: '/home/alex' }), '/home/alex/.local/share/mindcraft/test-server');
        }
    });

    test('Windows: %LOCALAPPDATA%\\Mindcraft\\test-server as before', () => {
        const found = W.locateServer({ LOCALAPPDATA: 'C:\\Users\\alex\\AppData\\Local' }, 'win32');
        assert.ok(found.missing.startsWith('server jar C:\\Users\\alex\\AppData\\Local\\Mindcraft\\test-server'), found.missing);
    });

    test('MC_TEST_SERVER_DIR first; a complete folder is found with its jar, eula.txt and java', () => {
        const dir = makeTmpDir();
        try {
            const java = path.join(dir, 'java');
            fs.writeFileSync(path.join(dir, 'server-1.21.8.jar'), 'jar');
            fs.writeFileSync(java, '');
            fs.writeFileSync(path.join(dir, 'eula.txt'), L.eulaText(new Date('2026-09-30T00:00:00Z')));
            const found = W.locateServer({ MC_TEST_SERVER_DIR: dir, MC_TEST_JAVA: java, HOME: '/nowhere' }, 'linux');
            assert.deepEqual(found, { serverDir: dir, jar: path.join(dir, 'server-1.21.8.jar'), java, eula: path.join(dir, 'eula.txt') });
            fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=false\n');
            assert.equal(W.locateServer({ MC_TEST_SERVER_DIR: dir, MC_TEST_JAVA: java }, 'linux').missing, `accepted eula.txt in ${dir}`);
        } finally {
            removeTmpDir(dir);
        }
    });
});

describe('serverEnv: the environment of the server process', () => {
    test('the environment of the runner without JAVA_TOOL_OPTIONS, in any case of its name', () => {
        const env = { PATH: '/usr/bin', JAVA_TOOL_OPTIONS: '-Djavax.net.ssl.trustStore=/x', HOME: '/root' };
        assert.deepEqual(W.serverEnv(env), { PATH: '/usr/bin', HOME: '/root' });
        assert.equal(env.JAVA_TOOL_OPTIONS, '-Djavax.net.ssl.trustStore=/x', 'the given environment is not changed');
        assert.deepEqual(W.serverEnv({ Java_Tool_Options: 'x', A: '1' }), { A: '1' });
        assert.deepEqual(W.serverEnv({ A: '1' }), { A: '1' });
    });
});

describe('McServer.start without JAVA_TOOL_OPTIONS', { skip: process.platform === 'win32' ? 'a shell script is no program on Windows' : false }, () => {
    test('the server process does not get JAVA_TOOL_OPTIONS, the runner keeps it', async () => {
        const dir = makeTmpDir();
        const had = Object.hasOwn(process.env, 'JAVA_TOOL_OPTIONS');
        const saved = process.env.JAVA_TOOL_OPTIONS;
        process.env.JAVA_TOOL_OPTIONS = '-Dmcw.test=1';
        let server = null;
        try {
            const java = path.join(dir, 'fake-java.sh');
            fs.writeFileSync(java, [
                '#!/bin/sh',
                'echo "[12:00:00] [Server thread/INFO]: JTO=${JAVA_TOOL_OPTIONS-unset} OTHER=${MCW_FAKE_OTHER-unset}"',
                'echo \'[12:00:00] [Server thread/INFO]: Done (0.1s)! For help, type "help"\'',
                'while read line; do :; done',
                '',
            ].join('\n'));
            fs.chmodSync(java, 0o755);
            process.env.MCW_FAKE_OTHER = 'kept';
            server = new W.McServer({ java, jar: path.join(dir, 'server.jar'), eula: null, dir, port: 25599 });
            await server.start(10000);
            const line = server.lines.find((l) => l.text.startsWith('JTO='));
            assert.ok(line, server.lines.map((l) => l.raw).join('\n'));
            assert.equal(line.text, 'JTO=unset OTHER=kept');
            assert.equal(process.env.JAVA_TOOL_OPTIONS, '-Dmcw.test=1', 'the environment of the runner is not changed');
        } finally {
            if (server?.child) {
                server.child.stdin.end();
                await server.exited;
            }
            delete process.env.MCW_FAKE_OTHER;
            if (had) process.env.JAVA_TOOL_OPTIONS = saved;
            else delete process.env.JAVA_TOOL_OPTIONS;
            removeTmpDir(dir);
        }
    });
});
