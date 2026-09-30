// Spec v0.1.4.9 section 9 (part E): scripts/get_test_server.js and its pure logic,
// scripts/get_test_server_logic.js.
//
// No network: the logic is tested with fixtures, and main() of the script with a fake fetch that
// serves a manifest, a version file and a small file as the jar. The SHA-1 of the real jar cannot be
// served by a fake, so the tests of the download give main() the SHA-1 of the small file
// (deps.expectedSha1); the check of the real SHA-1 is tested with the refusal (exit code 3).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const LOGIC = 'scripts/get_test_server_logic.js';
const SCRIPT = 'scripts/get_test_server.js';
const L = await loadSrc(LOGIC);
const M = await loadSrc(SCRIPT);

const REAL_SHA1 = '6bce4ef400e4efaa63a13d5e6f6b500be969ef81';
const VERSION_URL = 'https://piston-meta.mojang.com/v1/packages/0123/1.21.8.json';
const JAR_URL = `https://piston-data.mojang.com/v1/objects/${REAL_SHA1}/server.jar`;

const manifestOf = (versions) => ({ latest: { release: '1.21.9', snapshot: '25w40a' }, versions });
const MANIFEST = manifestOf([
    { id: '1.21.9', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/9999/1.21.9.json', sha1: 'ffff' },
    { id: '1.21.8', type: 'release', url: VERSION_URL, sha1: '0123' },
    { id: '1.21.7', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/7777/1.21.7.json', sha1: '7777' },
]);
const versionOf = (server) => ({ id: '1.21.8', downloads: { client: { url: 'https://x/client.jar', sha1: 'a'.repeat(40), size: 1 }, server } });
const REAL_VERSION = versionOf({ url: JAR_URL, sha1: REAL_SHA1, size: 57555044 });

describe('the logic module', () => {
    test('imports only node:os and node:path, and imports without output or files', () => {
        assertImportRules(LOGIC, { allowBuiltins: ['os', 'path'], allowedRelative: [] });
        assertCleanImport(LOGIC);
    });

    test('the script imports node built-ins and its logic module only, and runs nothing when imported', () => {
        assertImportRules(SCRIPT, { allowedRelative: ['get_test_server_logic.js'] });
        assertCleanImport(SCRIPT);
    });

    test('the constants of the spec', () => {
        assert.equal(L.MANIFEST_URL, 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
        assert.equal(L.VERSION, '1.21.8');
        assert.equal(L.JAR_NAME, 'server-1.21.8.jar');
        assert.equal(L.JAR_SHA1, REAL_SHA1);
        assert.deepEqual({ ...L.EXIT }, { DONE: 0, ERROR: 1, ARGUMENTS: 2, CHECKSUM: 3 });
    });
});

describe('parseArgs', () => {
    test('no arguments', () => {
        assert.deepEqual(L.parseArgs([]), { acceptEula: false, dir: null, help: false, errors: [] });
    });

    test('--accept-eula and --dir in both forms', () => {
        assert.deepEqual(L.parseArgs(['--accept-eula', '--dir', '/srv/mc']), { acceptEula: true, dir: '/srv/mc', help: false, errors: [] });
        assert.equal(L.parseArgs(['--dir=C:\\mc server']).dir, 'C:\\mc server');
        assert.equal(L.parseArgs(['-h']).help, true);
        assert.equal(L.parseArgs(['--help']).help, true);
    });

    test('bad arguments are errors', () => {
        assert.deepEqual(L.parseArgs(['--dir']).errors, ['The option --dir needs a folder.']);
        assert.deepEqual(L.parseArgs(['--dir', '--accept-eula']).errors, ['The option --dir needs a folder.']);
        assert.equal(L.parseArgs(['--dir', '--accept-eula']).acceptEula, true);
        assert.deepEqual(L.parseArgs(['--dir=']).errors, ['The option --dir needs a folder.']);
        assert.deepEqual(L.parseArgs(['--eula', 'x']).errors, ['Unknown argument: --eula', 'Unknown argument: x']);
        assert.deepEqual(L.parseArgs(undefined).errors, []);
    });
});

describe('pickVersion and serverDownload', () => {
    test('pickVersion finds the version and gives its url', () => {
        assert.deepEqual(L.pickVersion(MANIFEST, '1.21.8'), { id: '1.21.8', url: VERSION_URL, sha1: '0123' });
    });

    test('pickVersion: null without the version, without a url, for a manifest that is no manifest', () => {
        assert.equal(L.pickVersion(MANIFEST, '1.20.1'), null);
        assert.equal(L.pickVersion(manifestOf([{ id: '1.21.8' }]), '1.21.8'), null);
        for (const bad of [null, undefined, 'x', {}, { versions: 'x' }, { versions: [null, 3] }]) assert.equal(L.pickVersion(bad, '1.21.8'), null, JSON.stringify(bad));
    });

    test('serverDownload takes downloads.server: url, sha1 in lower case, size', () => {
        assert.deepEqual(L.serverDownload(REAL_VERSION), { url: JAR_URL, sha1: REAL_SHA1, size: 57555044 });
        assert.equal(L.serverDownload(versionOf({ url: JAR_URL, sha1: REAL_SHA1.toUpperCase(), size: 5 })).sha1, REAL_SHA1);
    });

    test('serverDownload: null when a part is missing or wrong', () => {
        const bad = [
            null, {}, { downloads: {} }, versionOf(null), versionOf({ sha1: REAL_SHA1, size: 1 }), versionOf({ url: JAR_URL, size: 1 }),
            versionOf({ url: JAR_URL, sha1: 'xyz', size: 1 }), versionOf({ url: JAR_URL, sha1: REAL_SHA1, size: 0 }),
            versionOf({ url: JAR_URL, sha1: REAL_SHA1, size: 1.5 }), versionOf({ url: JAR_URL, sha1: REAL_SHA1, size: '57555044' }),
        ];
        for (const v of bad) assert.equal(L.serverDownload(v), null, JSON.stringify(v));
    });
});

describe('defaultDir', () => {
    test('MC_TEST_SERVER_DIR first, on every platform', () => {
        for (const platform of ['win32', 'linux', 'darwin']) {
            assert.equal(L.defaultDir(platform, { MC_TEST_SERVER_DIR: '/srv/mc', HOME: '/home/u', LOCALAPPDATA: 'C:\\L' }), '/srv/mc', platform);
        }
    });

    test('Windows: %LOCALAPPDATA%\\Mindcraft\\test-server, else under the home folder', () => {
        assert.equal(L.defaultDir('win32', { LOCALAPPDATA: 'C:\\Users\\alex\\AppData\\Local' }), 'C:\\Users\\alex\\AppData\\Local\\Mindcraft\\test-server');
        assert.equal(L.defaultDir('win32', { USERPROFILE: 'C:\\Users\\alex' }), 'C:\\Users\\alex\\AppData\\Local\\Mindcraft\\test-server');
        assert.equal(L.defaultDir('win32', {}, 'D:\\home'), 'D:\\home\\AppData\\Local\\Mindcraft\\test-server');
    });

    test('Linux and macOS: ~/.local/share/mindcraft/test-server', () => {
        assert.equal(L.defaultDir('linux', { HOME: '/home/alex' }), '/home/alex/.local/share/mindcraft/test-server');
        assert.equal(L.defaultDir('darwin', { HOME: '/Users/alex' }), '/Users/alex/.local/share/mindcraft/test-server');
        assert.equal(L.defaultDir('linux', { HOME: '/home/alex' }, '/root'), '/root/.local/share/mindcraft/test-server', 'a given home folder wins');
        assert.ok(L.defaultDir('linux', {}).endsWith('/.local/share/mindcraft/test-server'), 'without HOME the home folder of the user');
    });

    test('an empty MC_TEST_SERVER_DIR counts as not set', () => {
        assert.equal(L.defaultDir('linux', { MC_TEST_SERVER_DIR: '', HOME: '/home/alex' }), '/home/alex/.local/share/mindcraft/test-server');
    });
});

describe('eulaText and eulaAccepted', () => {
    test('eula=true and one comment line with the date', () => {
        const text = L.eulaText(new Date('2026-09-28T10:00:00Z'));
        const lines = text.split('\n').filter((l) => l !== '');
        assert.equal(lines.length, 2);
        assert.ok(lines[0].startsWith('#'));
        assert.match(lines[0], /2026-09-28/);
        assert.equal(lines[1], 'eula=true');
        assert.ok(text.endsWith('\n'));
    });

    test('the text is accepted by the rule of the runner (tests/world/mc_server.js)', () => {
        const text = L.eulaText(new Date('2026-09-30T00:00:00Z'));
        assert.equal(L.eulaAccepted(text), true);
        assert.match(text, /^\s*eula\s*=\s*true\s*$/m);
    });

    test('eulaAccepted: false for eula=false, an empty or no text', () => {
        assert.equal(L.eulaAccepted('#x\neula=false\n'), false);
        assert.equal(L.eulaAccepted(''), false);
        assert.equal(L.eulaAccepted(undefined), false);
        assert.equal(L.eulaAccepted('eula = true\r\n'), true);
    });
});

// ---------------------------------------------------------------- main() with a fake fetch

const sha1Of = (bytes) => crypto.createHash('sha1').update(bytes).digest('hex');
const JAR_BYTES = Buffer.from('not a real server jar, only bytes for the test\n'.repeat(200));
const JAR_SHA1 = sha1Of(JAR_BYTES);

// A fake fetch: a map from url to a function that gives a Response (or throws). The urls asked are recorded.
function fakeFetch(routes) {
    const asked = [];
    const fetch = async (url) => {
        asked.push(String(url));
        const route = routes[String(url)];
        if (!route) return new Response('not found', { status: 404 });
        return route();
    };
    return { fetch, asked };
}

function routesFor({ version = versionOf({ url: JAR_URL, sha1: JAR_SHA1, size: JAR_BYTES.length }), jar = () => new Response(JAR_BYTES) } = {}) {
    return {
        [L.MANIFEST_URL]: () => Response.json(MANIFEST),
        [VERSION_URL]: () => Response.json(version),
        [JAR_URL]: jar,
    };
}

async function runMain(argv, { routes, expectedSha1 = JAR_SHA1, env = {}, now = () => new Date('2026-09-30T08:00:00Z') } = {}) {
    const lines = [];
    const fake = fakeFetch(routes ?? routesFor());
    const code = await M.main(argv, { fetch: fake.fetch, env, platform: 'linux', now, log: (line) => lines.push(line), expectedSha1 });
    return { code, lines, text: lines.join('\n'), asked: fake.asked };
}

function withTmp(fn) {
    return async () => {
        const dir = makeTmpDir();
        try {
            await fn(dir);
        } finally {
            removeTmpDir(dir);
        }
    };
}

describe('main: the download', () => {
    test('downloads through the manifest, checks, renames the part, one line per step', withTmp(async (dir) => {
        const folder = path.join(dir, 'server');
        const r = await runMain(['--dir', folder]);
        assert.equal(r.code, 0, r.text);
        assert.deepEqual(r.asked, [L.MANIFEST_URL, VERSION_URL, JAR_URL]);
        assert.deepEqual(listDir(folder), ['server-1.21.8.jar']);
        assert.ok(fs.readFileSync(path.join(folder, 'server-1.21.8.jar')).equals(JAR_BYTES));
        assert.equal(r.lines[0], `Folder of the test server: ${folder}`);
        assert.match(r.text, /Read the version manifest: 1\.21\.8 is in it\./);
        assert.match(r.text, new RegExp(`Downloaded ${JAR_BYTES.length} bytes, checked the SHA-1 and the size`));
        assert.match(r.lines.at(-1), /EULA of Minecraft .* must be accepted .* --accept-eula, or write eula=true into .*eula\.txt by hand\./);
    }));

    test('a jar with the right SHA-1 is kept and not downloaded again', withTmp(async (dir) => {
        fs.writeFileSync(path.join(dir, 'server-1.21.8.jar'), JAR_BYTES);
        const r = await runMain(['--dir', dir]);
        assert.equal(r.code, 0, r.text);
        assert.ok(r.lines.includes('The server jar is already there.'));
        assert.ok(!r.asked.includes(JAR_URL));
    }));

    test('a jar with another SHA-1 is replaced', withTmp(async (dir) => {
        fs.writeFileSync(path.join(dir, 'server-1.21.8.jar'), 'old');
        const r = await runMain(['--dir', dir]);
        assert.equal(r.code, 0, r.text);
        assert.match(r.text, new RegExp(`has the SHA-1 ${sha1Of('old')}\\. It is replaced\\.`));
        assert.ok(fs.readFileSync(path.join(dir, 'server-1.21.8.jar')).equals(JAR_BYTES));
    }));

    test('the folder comes from MC_TEST_SERVER_DIR without --dir', withTmp(async (dir) => {
        const r = await runMain([], { env: { MC_TEST_SERVER_DIR: dir, HOME: '/nowhere' } });
        assert.equal(r.code, 0, r.text);
        assert.equal(r.lines[0], `Folder of the test server: ${dir}`);
        assert.deepEqual(listDir(dir), ['server-1.21.8.jar']);
    }));
});

describe('main: the EULA', () => {
    test('--accept-eula writes eula.txt with eula=true and the date', withTmp(async (dir) => {
        const r = await runMain(['--accept-eula', '--dir', dir]);
        assert.equal(r.code, 0, r.text);
        const text = fs.readFileSync(path.join(dir, 'eula.txt'), 'utf8');
        assert.equal(text, L.eulaText(new Date('2026-09-30T08:00:00Z')));
        assert.match(r.text, /Wrote .*eula\.txt with eula=true\./);
    }));

    test('without the flag no eula.txt is written; an accepted one is named as such', withTmp(async (dir) => {
        const first = await runMain(['--dir', dir]);
        assert.ok(!fs.existsSync(path.join(dir, 'eula.txt')));
        assert.match(first.text, /must be accepted/);
        fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
        const second = await runMain(['--dir', dir]);
        assert.match(second.lines.at(-1), /eula\.txt accepts the EULA already\.$/);
        assert.equal(fs.readFileSync(path.join(dir, 'eula.txt'), 'utf8'), 'eula=true\n', 'not changed');
    }));
});

describe('main: the exit codes', () => {
    test('3: the manifest names a server with another SHA-1; nothing is downloaded, no folder made', withTmp(async (dir) => {
        const folder = path.join(dir, 'server');
        const r = await runMain(['--dir', folder], { expectedSha1: REAL_SHA1 });
        assert.equal(r.code, 3, r.text);
        assert.match(r.lines.at(-1), /^The SHA-1 is not 6bce4ef400e4efaa63a13d5e6f6b500be969ef81: it is not the file the tests were made with\. Nothing was downloaded\.$/);
        assert.ok(!r.asked.includes(JAR_URL));
        assert.equal(fs.existsSync(folder), false);
    }));

    test('3: the download has another size; the part is deleted', withTmp(async (dir) => {
        const version = versionOf({ url: JAR_URL, sha1: JAR_SHA1, size: JAR_BYTES.length + 1 });
        const r = await runMain(['--dir', dir], { routes: routesFor({ version }) });
        assert.equal(r.code, 3, r.text);
        assert.match(r.text, /The download has \d+ bytes and the SHA-1 \w+, not \d+ bytes and \w+\. It was deleted\./);
        assert.deepEqual(listDir(dir), []);
    }));

    test('3: the download has another SHA-1; the part is deleted', withTmp(async (dir) => {
        const r = await runMain(['--dir', dir], { routes: routesFor({ jar: () => new Response(Buffer.from('x'.repeat(JAR_BYTES.length))) }) });
        assert.equal(r.code, 3, r.text);
        assert.deepEqual(listDir(dir), []);
    }));

    test('1: the network fails, an HTTP error, no version 1.21.8, no server download', withTmp(async (dir) => {
        const down = await runMain(['--dir', dir], { routes: { [L.MANIFEST_URL]: () => { throw new TypeError('fetch failed'); } } });
        assert.equal(down.code, 1);
        assert.match(down.lines.at(-1), /^Could not read https:\/\/piston-meta\.mojang\.com\/mc\/game\/version_manifest_v2\.json: fetch failed\.$/);
        const http = await runMain(['--dir', dir], { routes: {} });
        assert.equal(http.code, 1);
        assert.match(http.lines.at(-1), /HTTP 404\.$/);
        const noVersion = await runMain(['--dir', dir], { routes: { [L.MANIFEST_URL]: () => Response.json(manifestOf([])) } });
        assert.equal(noVersion.code, 1);
        assert.equal(noVersion.lines.at(-1), 'The version manifest has no version 1.21.8.');
        const noServer = await runMain(['--dir', dir], { routes: routesFor({ version: { id: '1.21.8', downloads: {} } }) });
        assert.equal(noServer.code, 1);
        assert.equal(noServer.lines.at(-1), 'The version file of 1.21.8 names no server download.');
        const notJson = await runMain(['--dir', dir], { routes: { [L.MANIFEST_URL]: () => new Response('<html>') } });
        assert.equal(notJson.code, 1);
        assert.match(notJson.lines.at(-1), /the answer is no JSON/);
        assert.deepEqual(listDir(dir), []);
    }));

    test('1: the download breaks off; the part is deleted', withTmp(async (dir) => {
        const broken = () => new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(JAR_BYTES.subarray(0, 100)));
                controller.error(new Error('connection reset'));
            },
        }));
        const r = await runMain(['--dir', dir], { routes: routesFor({ jar: broken }) });
        assert.equal(r.code, 1, r.text);
        assert.match(r.lines.at(-1), /^Could not download .*connection reset\. The part was deleted\.$/);
        assert.deepEqual(listDir(dir), []);
    }));

    test('1: the folder cannot be made', withTmp(async (dir) => {
        const file = path.join(dir, 'a-file');
        fs.writeFileSync(file, 'x');
        const r = await runMain(['--dir', path.join(file, 'server')]);
        assert.equal(r.code, 1, r.text);
        assert.match(r.lines.at(-1), /^File error: /);
    }));

    test('2: bad arguments, nothing asked; 0: --help', async () => {
        const bad = await runMain(['--dir'], { routes: {} });
        assert.equal(bad.code, 2);
        assert.equal(bad.lines[0], 'The option --dir needs a folder.');
        assert.match(bad.text, /Usage: node scripts\/get_test_server\.js \[--accept-eula\] \[--dir <folder>\]/);
        assert.deepEqual(bad.asked, []);
        const help = await runMain(['--help'], { routes: {} });
        assert.equal(help.code, 0);
        assert.match(help.text, /Exit codes: 0 done, 1 network or file error, 2 bad arguments,\n3 wrong checksum\./);
        assert.deepEqual(help.asked, []);
    });
});
