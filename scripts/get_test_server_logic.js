// The pure part of scripts/get_test_server.js (release v0.1.4.9, spec section 9): the arguments,
// the version in Mojang's version manifest, the server download of its version file, the default
// folder of the test server and the text of eula.txt. No network, no files, no output.
import os from 'node:os';
import path from 'node:path';

export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const VERSION = '1.21.8';
export const JAR_NAME = 'server-1.21.8.jar';
// The server jar the tests were made with. Another file is refused.
export const JAR_SHA1 = '6bce4ef400e4efaa63a13d5e6f6b500be969ef81';
export const EULA_URL = 'https://aka.ms/MinecraftEULA';
export const EXIT = Object.freeze({ DONE: 0, ERROR: 1, ARGUMENTS: 2, CHECKSUM: 3 });

export const USAGE = [
    'Usage: node scripts/get_test_server.js [--accept-eula] [--dir <folder>]',
    `  --accept-eula   write eula.txt with eula=true: you accept the EULA of Minecraft (${EULA_URL})`,
    '  --dir <folder>  the folder of the test server (default: MC_TEST_SERVER_DIR, else',
    '                  %LOCALAPPDATA%\\Mindcraft\\test-server on Windows, ~/.local/share/mindcraft/test-server elsewhere)',
    `Downloads the official Minecraft ${VERSION} server through Mojang's version manifest into the folder`,
    `as ${JAR_NAME} and checks its SHA-1. Exit codes: 0 done, 1 network or file error, 2 bad arguments,`,
    '3 wrong checksum.',
].join('\n');

/**
 * The arguments of the script. `dir` is null without --dir; `errors` holds a text for every
 * argument that is wrong (then the script ends with exit code 2).
 * @param {string[]} argv the arguments after the script name
 * @returns {{acceptEula: boolean, dir: string|null, help: boolean, errors: string[]}}
 */
export function parseArgs(argv) {
    const result = { acceptEula: false, dir: null, help: false, errors: [] };
    const list = Array.isArray(argv) ? argv : [];
    for (let i = 0; i < list.length; i++) {
        const arg = String(list[i]);
        if (arg === '--accept-eula') result.acceptEula = true;
        else if (arg === '--help' || arg === '-h') result.help = true;
        else if (arg === '--dir' || arg.startsWith('--dir=')) {
            let value = arg === '--dir' ? undefined : arg.slice('--dir='.length);
            if (value === undefined && i + 1 < list.length && !String(list[i + 1]).startsWith('--')) value = String(list[++i]);
            if (value === undefined || value.trim() === '') result.errors.push('The option --dir needs a folder.');
            else result.dir = value;
        }
        else result.errors.push(`Unknown argument: ${arg}`);
    }
    return result;
}

const isText = (value) => typeof value === 'string' && value.length > 0;

/**
 * The entry of a version in the version manifest (v2): `{ id, url, sha1 }`, `sha1` the checksum
 * of the version file or null. null when the manifest has no such version or its entry has no url.
 * @param {object} manifest the parsed version_manifest_v2.json
 * @param {string} id the version, for example '1.21.8'
 * @returns {{id: string, url: string, sha1: string|null}|null}
 */
export function pickVersion(manifest, id) {
    const versions = manifest !== null && typeof manifest === 'object' && Array.isArray(manifest.versions) ? manifest.versions : [];
    const entry = versions.find((v) => v !== null && typeof v === 'object' && v.id === id);
    if (!entry || !isText(entry.url)) return null;
    return { id: entry.id, url: entry.url, sha1: isText(entry.sha1) ? entry.sha1 : null };
}

/**
 * The server download of a version file: `{ url, sha1, size }` from `downloads.server`, the SHA-1
 * in lower case. null when it is missing or not complete (a url, a SHA-1 of 40 hex digits, a size
 * that is a positive whole number).
 * @param {object} versionJson the parsed version file
 * @returns {{url: string, sha1: string, size: number}|null}
 */
export function serverDownload(versionJson) {
    const server = versionJson?.downloads?.server;
    if (server === null || typeof server !== 'object') return null;
    const { url, sha1, size } = server;
    if (!isText(url) || typeof sha1 !== 'string' || !/^[0-9a-fA-F]{40}$/.test(sha1)) return null;
    if (!Number.isInteger(size) || size <= 0) return null;
    return { url, sha1: sha1.toLowerCase(), size };
}

/**
 * The folder of the test server when --dir is not given: MC_TEST_SERVER_DIR, else
 * %LOCALAPPDATA%\Mindcraft\test-server on Windows, else ~/.local/share/mindcraft/test-server.
 * tests/world/mc_server.js uses the same default.
 * @param {string} platform process.platform
 * @param {object} env the environment
 * @param {string} [home] the home folder; default USERPROFILE (Windows) or HOME, else os.homedir()
 * @returns {string}
 */
export function defaultDir(platform, env = {}, home) {
    const vars = env !== null && typeof env === 'object' ? env : {};
    if (isText(vars.MC_TEST_SERVER_DIR)) return vars.MC_TEST_SERVER_DIR;
    const windows = platform === 'win32';
    const homeDir = isText(home) ? home : (windows ? vars.USERPROFILE : vars.HOME) || os.homedir();
    if (windows) {
        const localAppData = isText(vars.LOCALAPPDATA) ? vars.LOCALAPPDATA : path.win32.join(homeDir, 'AppData', 'Local');
        return path.win32.join(localAppData, 'Mindcraft', 'test-server');
    }
    return path.posix.join(homeDir, '.local', 'share', 'mindcraft', 'test-server');
}

/**
 * The text of eula.txt with --accept-eula: a comment line with the date (YYYY-MM-DD, UTC) and
 * `eula=true`.
 * @param {Date|string|number} date
 * @returns {string}
 */
export function eulaText(date) {
    const when = new Date(date);
    const day = Number.isNaN(when.getTime()) ? 'an unknown date' : when.toISOString().slice(0, 10);
    return `#The EULA of Minecraft (${EULA_URL}) was accepted with scripts/get_test_server.js --accept-eula on ${day}.\neula=true\n`;
}

/**
 * Whether the text of an eula.txt accepts the EULA: a line `eula=true`, as the runner of the
 * world tests reads it (tests/world/mc_server.js).
 * @param {string} text
 * @returns {boolean}
 */
export function eulaAccepted(text) {
    return typeof text === 'string' && /^\s*eula\s*=\s*true\s*$/m.test(text);
}
