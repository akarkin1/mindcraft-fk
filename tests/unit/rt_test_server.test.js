// T1, spec v0.1.4.9 section 9 (part E): the pure functions of scripts/get_test_server_logic.js (parseArgs,
// pickVersion, serverDownload, defaultDir, eulaText), the script itself through its main(argv, deps) with a fake
// fetch (no network: every request is answered in memory; the exit codes 0 done, 1 network or file error, 2 bad
// arguments, 3 wrong checksum), and the default folder and the environment of tests/world/mc_server.js.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const L = await loadSrc('scripts/get_test_server_logic.js');
const S = await loadSrc('scripts/get_test_server.js');
const W = await loadSrc('tests/world/mc_server.js');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RIGHT_SHA1 = '6bce4ef400e4efaa63a13d5e6f6b500be969ef81';
const VERSION_URL = 'https://piston-meta.mojang.com/v1/packages/0123456789abcdef0123456789abcdef01234567/1.21.8.json';
const SERVER_URL = 'https://piston-data.mojang.com/v1/objects/6bce4ef400e4efaa63a13d5e6f6b500be969ef81/server.jar';

const manifest = () => ({ latest: { release: '1.21.9', snapshot: '25w40a' }, versions: [
    { id: '1.21.9', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/aa/1.21.9.json', sha1: 'aa'.repeat(20) },
    { id: '1.21.8', type: 'release', url: VERSION_URL, sha1: '0123456789abcdef0123456789abcdef01234567' },
] });
const versionJson = (sha1 = RIGHT_SHA1, size = 57555044) => ({ id: '1.21.8', downloads: {
    client: { url: 'https://piston-data.mojang.com/v1/objects/cc/client.jar', sha1: 'cc'.repeat(20), size: 1 },
    server: { url: SERVER_URL, sha1, size },
} });

describe('section 9: parseArgs', () => {
    test('no arguments: no EULA, no folder, no error', () => {
        const a = L.parseArgs([]);
        assert.equal(a.acceptEula, false);
        assert.equal(a.dir ?? null, null);
        assert.deepEqual(a.errors ?? [], []);
    });

    test('--accept-eula --dir <folder>', () => {
        const a = L.parseArgs(['--accept-eula', '--dir', '/srv/mc']);
        assert.equal(a.acceptEula, true);
        assert.equal(a.dir, '/srv/mc');
        assert.deepEqual(a.errors ?? [], []);
    });

    test('an unknown argument and --dir without a folder are errors', () => {
        assert.ok(L.parseArgs(['--bogus']).errors.length > 0);
        assert.ok(L.parseArgs(['--dir']).errors.length > 0);
    });
});

describe('section 9: pickVersion, serverDownload', () => {
    test('pickVersion finds 1.21.8 and its version file', () => {
        const v = L.pickVersion(manifest(), '1.21.8');
        assert.equal(v?.url, VERSION_URL);
        assert.equal(v?.id, '1.21.8');
    });

    test('pickVersion: a version that is not in the manifest, or no manifest: null', () => {
        assert.equal(L.pickVersion(manifest(), '1.20.1'), null);
        assert.equal(L.pickVersion({}, '1.21.8'), null);
        assert.equal(L.pickVersion(null, '1.21.8'), null);
    });

    test('serverDownload takes downloads.server: url, sha1, size', () => {
        assert.deepEqual({ ...L.serverDownload(versionJson()) }, { url: SERVER_URL, sha1: RIGHT_SHA1, size: 57555044 });
    });

    test('serverDownload: no server download: null', () => {
        assert.equal(L.serverDownload({ downloads: {} }), null);
        assert.equal(L.serverDownload({}), null);
    });
});

describe('section 9: defaultDir(platform, env)', () => {
    test('Windows: %LOCALAPPDATA%\\Mindcraft\\test-server', () => {
        assert.equal(L.defaultDir('win32', { LOCALAPPDATA: 'C:\\Users\\max\\AppData\\Local' }), 'C:\\Users\\max\\AppData\\Local\\Mindcraft\\test-server');
    });

    test('Linux and macOS: ~/.local/share/mindcraft/test-server', () => {
        assert.equal(L.defaultDir('linux', { HOME: '/home/max' }), '/home/max/.local/share/mindcraft/test-server');
        assert.equal(L.defaultDir('darwin', { HOME: '/Users/max' }), '/Users/max/.local/share/mindcraft/test-server');
    });

    test('MC_TEST_SERVER_DIR comes before the default', () => {
        assert.equal(L.defaultDir('linux', { HOME: '/home/max', MC_TEST_SERVER_DIR: '/srv/mc' }), '/srv/mc');
        assert.equal(L.defaultDir('win32', { LOCALAPPDATA: 'C:\\x', MC_TEST_SERVER_DIR: 'D:\\mc' }), 'D:\\mc');
    });
});

describe('section 9: eulaText(date)', () => {
    test('a comment line with the date and eula=true', () => {
        const lines = L.eulaText(new Date('2026-09-30T10:00:00Z')).split(/\r?\n/);
        assert.ok(lines.includes('eula=true'), JSON.stringify(lines));
        const comment = lines.find((l) => l.startsWith('#'));
        assert.ok(comment, JSON.stringify(lines));
        assert.ok(comment.includes('2026-09-30'), comment);
    });
});

// ------------------------------------------------------------------------------ the script, exit codes

describe('section 9: the script and its exit codes', () => {
    let dir;
    before(() => {
        dir = makeTmpDir();
    });
    after(() => removeTmpDir(dir));

    // a fetch that answers the manifest, the version file and the server jar from memory
    function fakeFetch({ version = versionJson(), jar = null, fail = false } = {}) {
        const urls = [];
        const fetch = async (url) => {
            urls.push(String(url));
            if (fail) throw new TypeError('fetch failed');
            if (url === MANIFEST_URL) return new Response(JSON.stringify(manifest()), { status: 200 });
            if (url === VERSION_URL) return new Response(JSON.stringify(version), { status: 200 });
            if (url === SERVER_URL && jar) return new Response(jar, { status: 200 });
            return new Response('not found', { status: 404 });
        };
        return { fetch, urls };
    }
    const runIn = async (sub, argv, deps) => {
        const folder = path.join(dir, sub);
        const lines = [];
        const code = await S.main([...argv, '--dir', folder], { env: { HOME: dir }, platform: 'linux', now: () => new Date('2026-09-30T10:00:00Z'),
            log: (line) => lines.push(line), ...deps });
        return { code, lines, folder };
    };

    test('2: bad arguments; nothing is fetched', async () => {
        const f = fakeFetch();
        const lines = [];
        const code = await S.main(['--bogus'], { fetch: f.fetch, env: { HOME: dir }, platform: 'linux', log: (l) => lines.push(l) });
        assert.equal(code, 2);
        assert.deepEqual(f.urls, []);
    });

    test('the process ends with the exit code: 2 for a bad argument, 0 for --help (nothing is fetched)', () => {
        const run = (args) => spawnSync(process.execPath, [repoPath('scripts/get_test_server.js'), ...args], { encoding: 'utf8', timeout: 20000,
            env: { ...process.env, MC_TEST_SERVER_DIR: path.join(dir, 'never'), HOME: dir } });
        assert.equal(run(['--bogus']).status, 2);
        assert.equal(run(['--help']).status, 0);
        assert.equal(fs.existsSync(path.join(dir, 'never')), false);
    });

    test('1: a network error', async () => {
        const f = fakeFetch({ fail: true });
        const r = await runIn('net', [], { fetch: f.fetch });
        assert.equal(r.code, 1);
    });

    test('3: the version file names another SHA-1: refused, nothing is downloaded', async () => {
        const f = fakeFetch({ version: versionJson('ab'.repeat(20)) });
        const r = await runIn('wrong', [], { fetch: f.fetch });
        assert.equal(r.code, 3);
        assert.ok(!f.urls.includes(SERVER_URL), 'the jar is not fetched');
        assert.ok(!fs.existsSync(path.join(r.folder, 'server-1.21.8.jar')));
        assert.ok(!fs.existsSync(path.join(r.folder, 'server-1.21.8.jar.part')));
    });

    test('0: downloaded to .part, SHA-1 and size checked, renamed; without --accept-eula the way to accept it is said', async () => {
        const bytes = Buffer.from('a small stand-in for the server jar');
        const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
        const f = fakeFetch({ version: versionJson(sha1, bytes.length), jar: bytes });
        const r = await runIn('fresh', [], { fetch: f.fetch, expectedSha1: sha1 });
        assert.equal(r.code, 0, r.lines.join('\n'));
        assert.deepEqual(fs.readFileSync(path.join(r.folder, 'server-1.21.8.jar')), bytes);
        assert.ok(!fs.existsSync(path.join(r.folder, 'server-1.21.8.jar.part')));
        assert.ok(!fs.existsSync(path.join(r.folder, 'eula.txt')), 'no eula.txt without the flag');
        assert.ok(r.lines.some((l) => l.includes('--accept-eula')), r.lines.join('\n'));
        assert.ok(r.lines.length >= 4, 'one line per step');
    });

    test('3: a download with another SHA-1: deleted, no jar', async () => {
        const bytes = Buffer.from('a broken download');
        const f = fakeFetch({ version: versionJson('ab'.repeat(20), bytes.length), jar: bytes });
        const r = await runIn('broken', [], { fetch: f.fetch, expectedSha1: 'ab'.repeat(20) });
        assert.equal(r.code, 3);
        assert.ok(!fs.existsSync(path.join(r.folder, 'server-1.21.8.jar')));
        assert.ok(!fs.existsSync(path.join(r.folder, 'server-1.21.8.jar.part')));
    });

    test('0: a jar that is there with the right SHA-1 is kept: `The server jar is already there.`; --accept-eula writes eula.txt', async () => {
        const bytes = Buffer.from('the jar that is there');
        const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
        const folder = path.join(dir, 'there');
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'server-1.21.8.jar'), bytes);
        const f = fakeFetch({ version: versionJson(sha1, bytes.length) });
        const r = await runIn('there', ['--accept-eula'], { fetch: f.fetch, expectedSha1: sha1 });
        assert.equal(r.code, 0, r.lines.join('\n'));
        assert.ok(r.lines.includes('The server jar is already there.'), r.lines.join('\n'));
        assert.ok(!f.urls.includes(SERVER_URL), 'not downloaded again');
        const eula = fs.readFileSync(path.join(folder, 'eula.txt'), 'utf8');
        assert.ok(eula.split(/\r?\n/).includes('eula=true'), eula);
    });

    test('1: a file error (the folder is a file)', async () => {
        const bytes = Buffer.from('x');
        const sha1 = crypto.createHash('sha1').update(bytes).digest('hex');
        fs.writeFileSync(path.join(dir, 'afile'), 'not a folder');
        const f = fakeFetch({ version: versionJson(sha1, 1), jar: bytes });
        const r = await runIn('afile', [], { fetch: f.fetch, expectedSha1: sha1 });
        assert.equal(r.code, 1, r.lines.join('\n'));
    });

    test('the real jar, when this machine has it: kept with the SHA-1 of the spec', async (t) => {
        const candidates = [process.env.MC_TEST_SERVER_DIR, '/home/user/mc-test-server'].filter(Boolean).map((d) => path.join(d, 'server-1.21.8.jar'));
        const real = candidates.find((p) => fs.existsSync(p));
        if (!real) return t.skip('no server jar on this machine');
        const folder = path.join(dir, 'real');
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(real, path.join(folder, 'server-1.21.8.jar'));
        const f = fakeFetch({ version: versionJson(RIGHT_SHA1, fs.statSync(real).size) });
        const r = await runIn('real', [], { fetch: f.fetch });
        assert.equal(r.code, 0, r.lines.join('\n'));
        assert.ok(r.lines.includes('The server jar is already there.'));
    });
});

describe('section 9, item 5 and the README: tests/world/mc_server.js', () => {
    test('locateServer: the default folder of Linux and macOS, as defaultDir', () => {
        const home = '/nonexistent-home-of-t1';
        const linux = W.locateServer({ HOME: home }, 'linux');
        assert.ok(linux.missing?.includes(`${home}/.local/share/mindcraft/test-server`), JSON.stringify(linux));
        const mac = W.locateServer({ HOME: home }, 'darwin');
        assert.ok(mac.missing?.includes(`${home}/.local/share/mindcraft/test-server`), JSON.stringify(mac));
    });

    test('locateServer: MC_TEST_SERVER_DIR first', () => {
        const r = W.locateServer({ HOME: '/x', MC_TEST_SERVER_DIR: '/nonexistent-t1-server' }, 'linux');
        assert.ok(r.missing?.includes('/nonexistent-t1-server'), JSON.stringify(r));
    });

    test('the server process gets no JAVA_TOOL_OPTIONS', () => {
        const env = W.serverEnv({ PATH: '/bin', JAVA_TOOL_OPTIONS: '-Dx=y', HOME: '/h' });
        assert.equal(env.JAVA_TOOL_OPTIONS, undefined);
        assert.equal(env.PATH, '/bin');
        const source = fs.readFileSync(new URL('../world/mc_server.js', import.meta.url), 'utf8');
        assert.match(source, /spawn\([^)]*env:\s*serverEnv\(/s, 'the child process is spawned with serverEnv');
    });

    test('the README names the script, MC_TEST_SERVER_DIR, MC_TEST_JAVA and JAVA_TOOL_OPTIONS', () => {
        const readme = fs.readFileSync(new URL('../world/README.md', import.meta.url), 'utf8');
        for (const word of ['get_test_server.js', 'MC_TEST_SERVER_DIR', 'MC_TEST_JAVA', 'JAVA_TOOL_OPTIONS']) assert.ok(readme.includes(word), word);
    });
});
