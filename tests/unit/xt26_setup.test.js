// Tests from the spec v0.1.4.14 (tester T1, round 2): SPEC 4.4, the test setup on 26.1. xe_test_setup (round 1) proves the
// helpers, the --jdk step and the exact refusal of Java 21; this file adds the spec's numbers in one place and the edges.
//   describe 'SPEC 4.4 the server'     : VERSION, JAR_NAME, JAR_SHA1, JAR_SIZE (60,417,588) and MIN_JAVA (25) of
//                                        scripts/get_test_server_logic.js are the spec's; the runner's JAR_NAME is the same.
//   describe 'SPEC 4.4 the Java rule'  : every Java below 25 (8, 11, 17, 21, 24) is refused with one line that says what was
//                                        found (Java N, the path) and what is needed (Java 25, the 26.1 server); 25 and 26
//                                        are taken; DEFAULT_JAVA names java-runtime-epsilon.
//   describe 'SPEC 4.4 the bots of the tests' : the e2e, world and play files and the helpers name '26.1' (read as text).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const L = await loadSrc('scripts/get_test_server_logic.js');
const W = await loadSrc('tests/world/mc_server.js');
const text = (rel) => fs.readFileSync(repoPath(rel), 'utf8');

const javaVersion = (major) => (major === 8 ? 'java version "1.8.0_202"\n' : `openjdk version "${major}.0.1" 2026-01-20\nOpenJDK Runtime Environment (build ${major}.0.1+1)\n`);

describe('SPEC 4.4 the server', () => {
    test('the constants of get_test_server_logic.js are the spec\'s', () => {
        assert.equal(L.VERSION, '26.1');
        assert.equal(L.JAR_NAME, 'server-26.1.jar');
        assert.equal(L.JAR_SHA1, '3872a7f07a1a595e651aef8b058dfc2bb3772f46');
        assert.equal(L.JAR_SIZE, 60_417_588);
        assert.equal(L.MIN_JAVA, 25);
        assert.equal(W.JAR_NAME, 'server-26.1.jar');
    });

    test('the bot of the unit tests plays the version of the server', () => {
        assert.equal(TEST_MC_VERSION, L.VERSION);
    });
});

describe('SPEC 4.4 the Java rule', () => {
    function withJava(fn) {
        const dir = makeTmpDir();
        try {
            fs.writeFileSync(path.join(dir, 'server-26.1.jar'), 'jar');
            fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
            const java = path.join(dir, 'java');
            fs.writeFileSync(java, '');
            return fn(dir, java);
        } finally {
            removeTmpDir(dir);
        }
    }

    test('a Java below 25 is refused with one line: what was found, what is needed', () => {
        withJava((dir, java) => {
            for (const major of [8, 11, 17, 21, 24]) {
                const out = W.chooseJava({ MC_TEST_JAVA: java }, 'linux', dir, () => javaVersion(major), path.join(dir, 'none'));
                assert.ok(out.refused, `${major}: ${JSON.stringify(out)}`);
                const line = out.refused;
                assert.ok(!line.includes('\n'), `${major}: one line`);
                assert.ok(line.includes(`Java ${major} `), `${major}: what it found: ${line}`);
                assert.ok(line.includes(java), `${major}: where`);
                assert.ok(line.includes('Java 25'), `${major}: what it needs`);
                assert.ok(line.includes('26.1'), `${major}: the 26.1 server`);
                assert.ok(/refused/i.test(line), `${major}: says it refuses`);
            }
        });
    });

    test('Java 25 and 26 are taken', () => {
        withJava((dir, java) => {
            for (const major of [25, 26])
                assert.deepEqual(W.chooseJava({ MC_TEST_JAVA: java }, 'linux', dir, () => javaVersion(major), path.join(dir, 'none')), { java, major }, `${major}`);
        });
    });

    test('DEFAULT_JAVA is the launcher\'s java-runtime-epsilon', () => {
        assert.ok(W.DEFAULT_JAVA.split(/[\\/]/).includes('java-runtime-epsilon'), W.DEFAULT_JAVA);
    });
});

describe('SPEC 4.4 the bots of the tests', () => {
    test('the e2e, world and play files and the helpers use \'26.1\'', () => {
        assert.match(text('tests/e2e/helpers.js'), /minecraft_version: '26\.1'/);
        assert.match(text('tests/e2e/fake_server.js'), /VERSION = '26\.1'/);
        assert.match(text('tests/world/helpers.js'), /version: '26\.1'/);
        assert.match(text('scripts/dump_region_logic.js'), /MC_VERSION = '26\.1'/);
        assert.match(text('tests/e2e/run.js'), /Minecraft 26\.1 server/);
        assert.match(text('tests/play/run.js'), /26\.1 server/, 'the comment of the play test');
        for (const rel of ['tests/e2e/helpers.js', 'tests/e2e/fake_server.js', 'tests/world/helpers.js', 'tests/e2e/run.js'])
            assert.doesNotMatch(text(rel), /['"]1\.21\.8['"]/, rel);
    });
});
