// Spec v0.1.4.14 section 4.4 (part T, engineer E3): the test setup on Minecraft 26.1.
//   - the version constants of the test helpers are '26.1';
//   - the jar, the SHA-1 and the size of scripts/get_test_server_logic.js, the usage text (26.1, Java 25, --jdk);
//   - the pure part of --jdk: the Adoptium URLs, the package in the answer of the API, the folder, the unpacking;
//     and main() with --jdk against a fake fetch and a fake tar;
//   - the Java rule of tests/world/mc_server.js with a fake `java -version` output: 21 refused, 25 accepted,
//     MC_TEST_JAVA first, else the default, else <dir>/jdk/*/bin/java;
//   - server.properties keeps the white list off.
// No network, no Java, no Minecraft server.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const L = await loadSrc('scripts/get_test_server_logic.js');
const S = await loadSrc('scripts/get_test_server.js');
const W = await loadSrc('tests/world/mc_server.js');
const DUMP = await loadSrc('scripts/dump_region_logic.js');
const XT = await loadSrc('tests/helpers/xt_bot.js');
const ST = await loadSrc('tests/helpers/st_modes_env.js');

const source = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const JAVA_21 = 'openjdk version "21.0.8" 2025-07-15\nOpenJDK Runtime Environment (build 21.0.8+9-Ubuntu)\n';
const JAVA_25 = 'openjdk version "25.0.5" 2026-10-20 LTS\nOpenJDK Runtime Environment Temurin-25.0.5+8 (build 25.0.5+8-LTS)\n';
const PICKED_UP = 'Picked up JAVA_TOOL_OPTIONS: -Dx="1"\n';

describe('the version constants of the helpers are 26.1', () => {
    test('xt_bot VERSION and its registry', () => {
        assert.equal(XT.VERSION, '26.1');
        assert.equal(XT.MC.version.minecraftVersion, '26.1');
    });

    test('st_modes_env REGISTRY (and st_glue_env, which re-exports it)', () => {
        assert.equal(ST.REGISTRY.version.minecraftVersion, '26.1');
        assert.match(source('tests/helpers/st_glue_env.js'), /import \{ makeFakeBot, REGISTRY \} from '\.\/st_modes_env\.js'/);
    });

    test('the bots and servers of the e2e, world and play tests, the dump script', () => {
        assert.match(source('tests/e2e/helpers.js'), /minecraft_version: '26\.1',/);
        assert.match(source('tests/e2e/fake_server.js'), /^const VERSION = '26\.1';$/m);
        assert.match(source('tests/world/helpers.js'), /auth: 'offline', version: '26\.1',/);
        assert.equal(DUMP.MC_VERSION, '26.1');
        for (const rel of ['tests/e2e/helpers.js', 'tests/e2e/fake_server.js', 'tests/world/helpers.js', 'tests/helpers/xt_bot.js',
            'tests/helpers/st_modes_env.js', 'tests/helpers/st_glue_env.js', 'scripts/dump_region_logic.js']) {
            assert.doesNotMatch(source(rel), /'1\.21\.8'/, `${rel} names no 1.21.8 version`);
        }
    });
});

describe('the server of the tests: 26.1', () => {
    test('the jar, its SHA-1 and size, Java 25', () => {
        assert.equal(L.VERSION, '26.1');
        assert.equal(L.JAR_NAME, 'server-26.1.jar');
        assert.equal(L.JAR_SHA1, '3872a7f07a1a595e651aef8b058dfc2bb3772f46');
        assert.equal(L.JAR_SIZE, 60417588);
        assert.equal(L.MIN_JAVA, 25);
        assert.equal(W.JAR_NAME, L.JAR_NAME, 'the runner looks for the jar the script saves');
        assert.equal(W.MIN_JAVA, 25);
    });

    test('the usage text names 26.1, Java 25 and --jdk', () => {
        assert.match(L.USAGE, /Minecraft 26\.1 server/);
        assert.match(L.USAGE, /server-26\.1\.jar/);
        assert.match(L.USAGE, /Java 25/);
        assert.match(L.USAGE, /--jdk/);
        assert.match(L.USAGE, /\[--accept-eula\] \[--jdk\] \[--dir <folder>\]/);
    });

    test('parseArgs knows --jdk', () => {
        assert.equal(L.parseArgs(['--jdk']).jdk, true);
        assert.equal(L.parseArgs([]).jdk, false);
        assert.deepEqual(L.parseArgs(['--accept-eula', '--jdk', '--dir', '/srv/mc']), { acceptEula: true, jdk: true, dir: '/srv/mc', help: false, errors: [] });
    });

    test('the default Java of the launcher is java-runtime-epsilon (Java 25)', () => {
        assert.match(W.DEFAULT_JAVA, /java-runtime-epsilon/);
        assert.doesNotMatch(W.DEFAULT_JAVA, /java-runtime-delta/);
    });

    test('server.properties keeps the white list off', () => {
        const text = W.serverProperties(25599);
        assert.match(text, /^white-list=false$/m);
        assert.match(text, /^enforce-whitelist=false$/m);
        assert.match(text, /^server-port=25599$/m);
    });
});

describe('the console of 26.1: the old game rule names and the daytime query', () => {
    test('the world defaults of the runner and the play test use the names of 26.1', () => {
        for (const rel of ['tests/world/run.js', 'tests/play/run.js']) {
            const text = source(rel);
            for (const name of ['advance_time false', 'advance_weather false', 'spawn_mobs false', 'random_tick_speed 0', 'fire_spread_radius_around_player 0']) {
                assert.ok(text.includes(`'gamerule ${name}'`), `${rel}: gamerule ${name}`);
            }
            assert.doesNotMatch(text, /'gamerule do[A-Z]/, `${rel}: no old name`);
        }
    });

    test('consoleCommand26 rewrites the names of 1.21.8, other commands stay', () => {
        assert.equal(W.consoleCommand26('gamerule doDaylightCycle false'), 'gamerule advance_time false');
        assert.equal(W.consoleCommand26('gamerule doDaylightCycle true'), 'gamerule advance_time true');
        assert.equal(W.consoleCommand26('gamerule randomTickSpeed 3'), 'gamerule random_tick_speed 3');
        assert.equal(W.consoleCommand26('gamerule doFireTick false'), 'gamerule fire_spread_radius_around_player 0');
        assert.equal(W.consoleCommand26('gamerule doFireTick true'), 'gamerule fire_spread_radius_around_player 128');
        assert.equal(W.consoleCommand26('gamerule doMobSpawning'), 'gamerule spawn_mobs');
        assert.equal(W.consoleCommand26('time query daytime'), 'time query minecraft:day');
        for (const same of ['gamerule advance_time false', 'time set 12500', 'setblock 1 2 3 minecraft:stone', 'gamerule someUnknownRule 1']) {
            assert.equal(W.consoleCommand26(same), same);
        }
    });

    test('answerLine26 gives the daytime in the words of 1.21.8', () => {
        assert.equal(W.answerLine26('Timeline minecraft:day is at 12500 tick(s)'), 'The time is 12500');
        assert.equal(W.answerLine26('Set minecraft:overworld to 6000 tick(s)'), 'Set minecraft:overworld to 6000 tick(s)');
    });

    test('answerLine26 gives the count of execute if/unless in the words of 1.21.8 (W101, countEntities of journey.js)', () => {
        assert.equal(W.answerLine26('Test passed. Count: 6'), 'Test passed, count: 6');
        assert.equal(W.answerLine26('Test failed. Count: 2'), 'Test failed, count: 2');
        assert.equal(W.answerLine26('Test passed. Count: 16'), 'Test passed, count: 16', 'execute if blocks');
        const read = (line) => Number((/count: (\d+)/.exec(W.answerLine26(line)) ?? [0, 0])[1]);
        assert.equal(read('Test passed. Count: 6'), 6, 'the regex of W101 reads it');
        for (const same of ['Test passed', 'Test failed', 'Killed 2 entities', 'Killed Chicken', 'No entity was found', 'Changed the block at 2, -60, 2',
            'Could not set the block', 'Summoned new Chicken', 'Successfully filled 16 block(s)', 'Teleported Chicken to 7.500000, -60.000000, 7.500000',
            'Chicken has the following entity data: 4.0f', '2, -60, 2 has the following block data: [{count: 5, Slot: 0b, id: "minecraft:bread"}]']) {
            assert.equal(W.answerLine26(same), same);
        }
    });

    test('the server counts what it translated; the summary line only when something was', async () => {
        const s = new W.McServer({ java: 'java', jar: 'x.jar', eula: 'eula.txt', dir: '.', port: 25599 });
        const written = [];
        // A fake server process: it echoes every marker as the console does and answers the daytime query.
        s.child = {
            stdin: {
                write(text) {
                    written.push(text);
                    setImmediate(() => {
                        for (const line of text.split('\n').filter(Boolean)) {
                            if (line === 'time query minecraft:day') s._onLine('Timeline minecraft:day is at 12500 tick(s)');
                            if (/^mcw_mark_\d+$/.test(line)) s._onLine(`${line}<--[HERE]`);
                        }
                    });
                },
            },
        };
        assert.equal(s.translated, 0);
        const out = await s.commands(['gamerule doDaylightCycle false', '/time query daytime', 'gamerule advance_time true', 'time set 6000']);
        assert.equal(s.translated, 2, 'the old game rule and the daytime query');
        assert.match(written.join(''), /^gamerule advance_time false\nmcw_mark_1\ntime query minecraft:day\nmcw_mark_2\n/);
        assert.deepEqual(out[1], ['The time is 12500']);
        assert.equal(W.translationLine(s.translated), 'console: 2 commands of 1.21.8 translated');
        assert.equal(W.translationLine(1), 'console: 1 command of 1.21.8 translated');
        assert.equal(W.translationLine(0), '', 'no line when nothing was translated');
        assert.equal(W.translationLine(undefined), '');
        assert.equal(s.answersTranslated, 1, 'the answer of the daytime query');
        assert.equal(W.translationLine(2, 1), 'console: 2 commands and 1 answer of 1.21.8 translated');
        assert.equal(W.translationLine(0, 3), 'console: 3 answers of 1.21.8 translated');
        assert.match(source('tests/world/run.js'), /const consoleLine = translationLine\(servers\.reduce\(\(n, s\) => n \+ \(s\.translated \?\? 0\), 0\), servers\.reduce\(\(n, s\) => n \+ \(s\.answersTranslated \?\? 0\), 0\)\);\nif \(consoleLine\) console\.log\(consoleLine\);/);
    });
});

describe('--jdk, the pure part', () => {
    const LINUX = { os: 'linux', arch: 'x64', archive: 'tar.gz' };
    const WINDOWS = { os: 'windows', arch: 'x64', archive: 'zip' };

    test('the machines: Linux x64 and Windows x64, nothing else', () => {
        assert.deepEqual(L.jdkTarget('linux', 'x64'), LINUX);
        assert.deepEqual(L.jdkTarget('win32', 'x64'), WINDOWS);
        assert.equal(L.jdkTarget('darwin', 'x64'), null);
        assert.equal(L.jdkTarget('linux', 'arm64'), null);
        assert.equal(L.jdkTarget('win32', 'ia32'), null);
    });

    test('the URLs of the Adoptium API', () => {
        assert.equal(L.jdkBinaryUrl(LINUX), 'https://api.adoptium.net/v3/binary/latest/25/ga/linux/x64/jre/hotspot/normal/eclipse');
        assert.equal(L.jdkBinaryUrl(WINDOWS), 'https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jre/hotspot/normal/eclipse');
        assert.equal(L.jdkAssetsUrl(LINUX), 'https://api.adoptium.net/v3/assets/latest/25/hotspot?os=linux&architecture=x64&image_type=jre');
        assert.equal(L.jdkAssetsUrl(WINDOWS), 'https://api.adoptium.net/v3/assets/latest/25/hotspot?os=windows&architecture=x64&image_type=jre');
    });

    test('the folder: <dir>/jdk, the java in it: <jdk>/<folder>/bin/java (java.exe on Windows)', () => {
        assert.equal(L.jdkDir('/home/u/.local/share/mindcraft/test-server', 'linux'), '/home/u/.local/share/mindcraft/test-server/jdk');
        assert.equal(L.jdkDir('C:\\L\\Mindcraft\\test-server', 'win32'), 'C:\\L\\Mindcraft\\test-server\\jdk');
        assert.equal(L.javaInJdk('/s/jdk/jdk-25.0.5+8-jre', 'linux'), '/s/jdk/jdk-25.0.5+8-jre/bin/java');
        assert.equal(L.javaInJdk('C:\\s\\jdk\\jdk-25.0.5+8-jre', 'win32'), 'C:\\s\\jdk\\jdk-25.0.5+8-jre\\bin\\java.exe');
    });

    test('the unpacking: tar -xzf for the tar.gz, tar -xf for the zip', () => {
        assert.deepEqual(L.jdkExtractCommand('/s/jdk/a.tar.gz', '/s/jdk', LINUX), { command: 'tar', args: ['-xzf', '/s/jdk/a.tar.gz', '-C', '/s/jdk'] });
        assert.deepEqual(L.jdkExtractCommand('C:\\s\\jdk\\a.zip', 'C:\\s\\jdk', WINDOWS), { command: 'tar', args: ['-xf', 'C:\\s\\jdk\\a.zip', '-C', 'C:\\s\\jdk'] });
    });

    test('jdkPackage reads binary.package of the answer (the shape of the API of 2026-11-04)', () => {
        const sha = '6fac98f0c8202efc3135a9e9e42aa61963ec42d1c5cbb40caf231e7b14a24ef6';
        const answer = [assetOf({ checksum: sha.toUpperCase() })];
        assert.deepEqual(L.jdkPackage(answer, LINUX), {
            name: 'OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz',
            link: 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz',
            sha256: sha,
            size: 61736206,
            release: 'jdk-25.0.5+8',
        });
    });

    test('jdkPackage refuses another machine, a JDK, a bad checksum or size, a name with a folder', () => {
        assert.equal(L.jdkPackage([assetOf({})], { os: 'windows', arch: 'x64', archive: 'zip' }), null);
        assert.equal(L.jdkPackage([assetOf({ image_type: 'jdk' })], LINUX), null);
        assert.equal(L.jdkPackage([assetOf({ checksum: 'abc' })], LINUX), null);
        assert.equal(L.jdkPackage([assetOf({ size: 0 })], LINUX), null);
        assert.equal(L.jdkPackage([assetOf({ name: '../x.tar.gz' })], LINUX), null);
        assert.equal(L.jdkPackage([assetOf({ name: 'x.zip' })], LINUX), null);
        assert.equal(L.jdkPackage({}, LINUX), null);
        assert.equal(L.jdkPackage(null, LINUX), null);
    });
});

describe('the Java rule', () => {
    test('javaMajor reads java -version', () => {
        assert.equal(L.javaMajor(JAVA_25), 25);
        assert.equal(L.javaMajor(JAVA_21), 21);
        assert.equal(L.javaMajor(PICKED_UP + JAVA_25), 25);
        assert.equal(L.javaMajor('java version "1.8.0_202"\n'), 8);
        assert.equal(L.javaMajor('openjdk version "25" 2025-09-16\n'), 25);
        assert.equal(L.javaMajor(''), null);
        assert.equal(L.javaMajor(undefined), null);
    });

    test('the refusal is one line: what was found and what is needed', () => {
        const line = L.javaRefusal('/usr/bin/java', 21);
        assert.equal(line, 'World tests refused: Java 21 at /usr/bin/java; the Minecraft 26.1 server needs Java 25 or later (set MC_TEST_JAVA, or run node scripts/get_test_server.js --jdk).');
        assert.ok(!line.includes('\n'));
        assert.match(L.javaRefusal('/x/java', null), /a java without a readable version at \/x\/java/);
    });

    test('MC_TEST_JAVA: 21 refused, 25 accepted, missing is missing', () => {
        withServerDir((dir) => {
            const java = touch(path.join(dir, 'fake-java'));
            const env = (text) => ({ env: { MC_TEST_SERVER_DIR: dir, MC_TEST_JAVA: java }, versionOf: () => text });
            const old = W.locateServer(env(JAVA_21).env, 'linux', env(JAVA_21).versionOf);
            assert.deepEqual(old, { refused: L.javaRefusal(java, 21) });
            const ok = W.locateServer(env(JAVA_25).env, 'linux', env(JAVA_25).versionOf);
            assert.deepEqual(ok, { serverDir: dir, jar: path.join(dir, 'server-26.1.jar'), java, eula: path.join(dir, 'eula.txt') });
            assert.deepEqual(W.locateServer({ MC_TEST_SERVER_DIR: dir, MC_TEST_JAVA: java }, 'linux', () => 'no version'),
                { refused: L.javaRefusal(java, null) });
            const gone = path.join(dir, 'no-java');
            assert.deepEqual(W.locateServer({ MC_TEST_SERVER_DIR: dir, MC_TEST_JAVA: gone }, 'linux', () => JAVA_25), { missing: `java ${gone}` });
        });
    });

    test('MC_TEST_JAVA set: no fallback to <dir>/jdk', () => {
        withServerDir((dir) => {
            const java = touch(path.join(dir, 'fake-java'));
            const jdkJava = touch(path.join(dir, 'jdk', 'jdk-25.0.5+8-jre', 'bin', 'java'));
            const versionOf = (j) => (j === jdkJava ? JAVA_25 : JAVA_21);
            assert.deepEqual(W.locateServer({ MC_TEST_SERVER_DIR: dir, MC_TEST_JAVA: java }, 'linux', versionOf), { refused: L.javaRefusal(java, 21) });
        });
    });

    test('MC_TEST_JAVA not set: the default when it is 25, else <dir>/jdk/*/bin/java', () => {
        withServerDir((dir) => {
            const env = {};
            const def = touch(path.join(dir, 'launcher', 'java'));
            const jdkJava = touch(path.join(dir, 'jdk', 'jdk-25.0.5+8-jre', 'bin', 'java'));
            assert.deepEqual(W.chooseJava(env, 'linux', dir, () => JAVA_25, def), { java: def, major: 25 }, 'the default of Java 25 first');
            const versionOf = (j) => (j === jdkJava ? JAVA_25 : JAVA_21);
            assert.deepEqual(W.chooseJava(env, 'linux', dir, versionOf, def), { java: jdkJava, major: 25 }, 'a default of Java 21: the jdk folder');
            assert.deepEqual(W.chooseJava(env, 'linux', dir, versionOf, path.join(dir, 'none')), { java: jdkJava, major: 25 }, 'no default: the jdk folder');
            assert.deepEqual(W.chooseJava({ MC_TEST_JAVA: '' }, 'linux', dir, versionOf, path.join(dir, 'none')), { java: jdkJava, major: 25 }, 'an empty MC_TEST_JAVA is not set');
        });
    });

    test('MC_TEST_JAVA not set: only old javas are refused, none at all is missing', () => {
        withServerDir((dir) => {
            const def = touch(path.join(dir, 'launcher', 'java'));
            assert.deepEqual(W.chooseJava({}, 'linux', dir, () => JAVA_21, def), { refused: L.javaRefusal(def, 21) });
            const jdkJava = touch(path.join(dir, 'jdk', 'jdk-21-jre', 'bin', 'java'));
            assert.deepEqual(W.chooseJava({}, 'linux', dir, () => JAVA_21, path.join(dir, 'none')), { refused: L.javaRefusal(jdkJava, 21) });
            fs.rmSync(path.join(dir, 'jdk'), { recursive: true });
            const none = W.chooseJava({}, 'linux', dir, () => JAVA_25, path.join(dir, 'none'));
            assert.ok(none.missing?.includes(path.join(dir, 'jdk', '*', 'bin', 'java')), JSON.stringify(none));
        });
    });

    test('the runner and the play test stop on a refusal', () => {
        assert.match(source('tests/world/run.js'), /if \(loc\.refused\) \{\s*console\.log\(loc\.refused\);\s*process\.exit\(1\);/);
        assert.match(source('tests/play/run.js'), /if \(loc\.refused\) stop\(/);
    });
});

describe('main() with --jdk (fake fetch, fake tar)', () => {
    test('downloads, checks the SHA-256 and the size, unpacks into <dir>/jdk and deletes the archive', async () => {
        await withDownload(async ({ dir, fetch, routes, archive }) => {
            const runs = [];
            const run = (command, args) => {
                runs.push([command, ...args]);
                touch(path.join(dir, 'jdk', 'jdk-25.0.5+8-jre', 'bin', 'java'));
                return { status: 0, stdout: '', stderr: '' };
            };
            const lines = [];
            const code = await S.main(['--jdk', '--dir', dir], { ...deps(fetch, lines), run, javaVersion: () => JAVA_25 });
            assert.equal(code, 0, lines.join('\n'));
            assert.ok(routes.asked.includes(L.jdkBinaryUrl({ os: 'linux', arch: 'x64' })), 'the binary URL');
            assert.ok(routes.asked.includes(L.jdkAssetsUrl({ os: 'linux', arch: 'x64' })), 'the API for the SHA-256');
            const file = path.join(dir, 'jdk', archive.name);
            assert.deepEqual(runs, [['tar', '-xzf', file, '-C', path.join(dir, 'jdk')]]);
            assert.ok(!fs.existsSync(file) && !fs.existsSync(file + '.part'), 'the archive is deleted');
            assert.ok(lines.some((l) => l.includes(path.join(dir, 'jdk', 'jdk-25.0.5+8-jre', 'bin', 'java'))), lines.join('\n'));
        });
    });

    test('a wrong SHA-256 is refused with exit code 3, nothing is unpacked or left', async () => {
        await withDownload(async ({ dir, fetch }) => {
            let ran = false;
            const lines = [];
            const code = await S.main(['--jdk', '--dir', dir], { ...deps(fetch, lines), run: () => { ran = true; return { status: 0 }; }, javaVersion: () => JAVA_25 });
            assert.equal(code, 3, lines.join('\n'));
            assert.equal(ran, false);
            assert.deepEqual(fs.readdirSync(path.join(dir, 'jdk')), []);
        }, { badSha: true });
    });

    test('a Java 25 already in <dir>/jdk is kept: no download', async () => {
        await withDownload(async ({ dir, fetch, routes }) => {
            touch(path.join(dir, 'jdk', 'jdk-25.0.5+8-jre', 'bin', 'java'));
            const lines = [];
            const code = await S.main(['--jdk', '--dir', dir], { ...deps(fetch, lines), run: () => assert.fail('no tar'), javaVersion: () => JAVA_25 });
            assert.equal(code, 0, lines.join('\n'));
            assert.ok(!routes.asked.some((u) => u.includes('adoptium')), routes.asked.join(' '));
            assert.ok(lines.some((l) => l.startsWith('Java 25 is already there:')), lines.join('\n'));
        });
    });

    test('another machine: one line, exit code 1', async () => {
        await withDownload(async ({ dir, fetch }) => {
            const lines = [];
            const code = await S.main(['--jdk', '--dir', dir], { ...deps(fetch, lines), arch: 'arm64' });
            assert.equal(code, 1);
            assert.match(lines.at(-1), /^The option --jdk knows Linux x64 and Windows x64 only; this machine is linux arm64\./);
        });
    });
});

// ---------------------------------------------------------------- helpers

function assetOf({ checksum = '6fac98f0c8202efc3135a9e9e42aa61963ec42d1c5cbb40caf231e7b14a24ef6', size = 61736206,
    name = 'OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz', image_type = 'jre', os = 'linux' }) {
    return {
        binary: {
            architecture: 'x64', heap_size: 'normal', image_type, jvm_impl: 'hotspot', os,
            package: {
                checksum, size, name,
                link: 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz',
            },
        },
        release_name: 'jdk-25.0.5+8',
        version: { major: 25 },
    };
}

function touch(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    return file;
}

// A folder of the test server with the jar and an accepted eula.txt.
function withServerDir(fn) {
    const dir = makeTmpDir();
    try {
        fs.writeFileSync(path.join(dir, 'server-26.1.jar'), 'jar');
        fs.writeFileSync(path.join(dir, 'eula.txt'), L.eulaText(new Date('2026-09-28T00:00:00Z')));
        return fn(dir);
    } finally {
        removeTmpDir(dir);
    }
}

const deps = (fetch, lines) => ({ fetch, env: {}, platform: 'linux', arch: 'x64', log: (l) => lines.push(l), expectedSha1: JAR.sha1, now: () => new Date('2026-11-04T00:00:00Z') });

const JAR_BYTES = Buffer.from('a small jar for the test\n'.repeat(50));
const JAR = { sha1: crypto.createHash('sha1').update(JAR_BYTES).digest('hex'), size: JAR_BYTES.length };

// A folder with the jar there already, and a fake fetch for the manifest, the version file, the API and the archive.
async function withDownload(fn, { badSha = false } = {}) {
    const dir = makeTmpDir();
    try {
        fs.writeFileSync(path.join(dir, 'server-26.1.jar'), JAR_BYTES);
        const bytes = Buffer.from('the bytes of a JRE archive\n'.repeat(300));
        const sha256 = badSha ? 'f'.repeat(64) : crypto.createHash('sha256').update(bytes).digest('hex');
        const archive = { name: 'OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz', bytes };
        const versionUrl = 'https://piston-meta.mojang.com/v1/packages/abc/26.1.json';
        const table = {
            [L.MANIFEST_URL]: () => Response.json({ versions: [{ id: '26.1', type: 'release', url: versionUrl, sha1: 'abc' }] }),
            [versionUrl]: () => Response.json({ id: '26.1', downloads: { server: { url: 'https://piston-data.mojang.com/x/server.jar', sha1: JAR.sha1, size: JAR.size } } }),
            [L.jdkAssetsUrl({ os: 'linux', arch: 'x64' })]: () => Response.json([assetOf({ checksum: sha256, size: bytes.length, name: archive.name })]),
            [L.jdkBinaryUrl({ os: 'linux', arch: 'x64' })]: () => new Response(bytes),
        };
        const routes = { asked: [] };
        const fetch = async (url) => {
            routes.asked.push(String(url));
            const r = table[String(url)];
            if (!r) return new Response('not found', { status: 404 });
            return r();
        };
        await fn({ dir, fetch, routes, archive });
    } finally {
        removeTmpDir(dir);
    }
}
