// The pure part of scripts/get_test_server.js (release v0.1.4.9, spec section 9): the arguments,
// the version in Mojang's version manifest, the server download of its version file, the default
// folder of the test server and the text of eula.txt. No network, no files, no output.
// v0.1.4.14 (spec section 4.4): Minecraft 26.1, which needs Java 25; the Eclipse Temurin 25 JRE of
// the option --jdk (its URLs, the package in the answer of the Adoptium API, the folder and the
// command that unpacks it) and the rule of the Java version that tests/world/mc_server.js applies.
import os from 'node:os';
import path from 'node:path';

export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const VERSION = '26.1';
export const JAR_NAME = 'server-26.1.jar';
// The server jar the tests were made with (Mojang's version file of 26.1). Another file is refused.
export const JAR_SHA1 = '3872a7f07a1a595e651aef8b058dfc2bb3772f46';
export const JAR_SIZE = 60417588;
// The 26.1 server needs Java 25: javaVersion.majorVersion 25 in Mojang's version file.
export const MIN_JAVA = 25;
export const EULA_URL = 'https://aka.ms/MinecraftEULA';
export const EXIT = Object.freeze({ DONE: 0, ERROR: 1, ARGUMENTS: 2, CHECKSUM: 3 });
// The Eclipse Temurin JRE of --jdk: the API of Adoptium, the folder in the folder of the test server.
export const ADOPTIUM_API = 'https://api.adoptium.net/v3';
export const JDK_FOLDER = 'jdk';

export const USAGE = [
    'Usage: node scripts/get_test_server.js [--accept-eula] [--jdk] [--dir <folder>]',
    `  --accept-eula   write eula.txt with eula=true: you accept the EULA of Minecraft (${EULA_URL})`,
    `  --jdk           also download the Eclipse Temurin ${MIN_JAVA} JRE (Linux x64 or Windows x64) into <folder>/${JDK_FOLDER}/,`,
    '                  checked by the SHA-256 of the Adoptium API; the runner of the world tests takes it when',
    `                  MC_TEST_JAVA is not set and the default Java is missing or older than ${MIN_JAVA}`,
    '  --dir <folder>  the folder of the test server (default: MC_TEST_SERVER_DIR, else',
    '                  %LOCALAPPDATA%\\Mindcraft\\test-server on Windows, ~/.local/share/mindcraft/test-server elsewhere)',
    `Downloads the official Minecraft ${VERSION} server through Mojang's version manifest into the folder`,
    `as ${JAR_NAME} and checks its SHA-1 and size. The server needs Java ${MIN_JAVA}.`,
    'Exit codes: 0 done, 1 network or file error, 2 bad arguments, 3 wrong checksum.',
].join('\n');

/**
 * The arguments of the script. `dir` is null without --dir; `errors` holds a text for every
 * argument that is wrong (then the script ends with exit code 2).
 * @param {string[]} argv the arguments after the script name
 * @returns {{acceptEula: boolean, jdk: boolean, dir: string|null, help: boolean, errors: string[]}}
 */
export function parseArgs(argv) {
    const result = { acceptEula: false, jdk: false, dir: null, help: false, errors: [] };
    const list = Array.isArray(argv) ? argv : [];
    for (let i = 0; i < list.length; i++) {
        const arg = String(list[i]);
        if (arg === '--accept-eula') result.acceptEula = true;
        else if (arg === '--jdk') result.jdk = true;
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
 * @param {string} id the version, for example '26.1'
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

/**
 * The JRE that --jdk downloads for a machine: `{ os, arch, archive }` for Linux x64 (a tar.gz) and
 * Windows x64 (a zip), null for every other machine (the spec names these two).
 * @param {string} platform process.platform
 * @param {string} arch process.arch
 * @returns {{os: string, arch: string, archive: string}|null}
 */
export function jdkTarget(platform, arch) {
    if (arch !== 'x64') return null;
    if (platform === 'linux') return { os: 'linux', arch: 'x64', archive: 'tar.gz' };
    if (platform === 'win32') return { os: 'windows', arch: 'x64', archive: 'zip' };
    return null;
}

/**
 * The download of the newest Temurin JRE of MIN_JAVA for a target (it redirects to the archive).
 * @param {{os: string, arch: string}} target from jdkTarget
 * @returns {string}
 */
export function jdkBinaryUrl(target) {
    return `${ADOPTIUM_API}/binary/latest/${MIN_JAVA}/ga/${target.os}/${target.arch}/jre/hotspot/normal/eclipse`;
}

/**
 * The question to the Adoptium API for the same JRE: its answer names the archive, its size and its
 * SHA-256 (`binary.package`).
 * @param {{os: string, arch: string}} target from jdkTarget
 * @returns {string}
 */
export function jdkAssetsUrl(target) {
    return `${ADOPTIUM_API}/assets/latest/${MIN_JAVA}/hotspot?os=${target.os}&architecture=${target.arch}&image_type=jre`;
}

/**
 * The package of the JRE in the answer of jdkAssetsUrl: `{ name, link, sha256, size, release }`, the
 * SHA-256 in lower case. null when no entry is a hotspot JRE of the target with a name that ends in
 * the target's archive, a SHA-256 of 64 hex digits and a size.
 * @param {Array} assets the parsed answer of the API
 * @param {{os: string, arch: string, archive: string}} target from jdkTarget
 * @returns {{name: string, link: string, sha256: string, size: number, release: string|null}|null}
 */
export function jdkPackage(assets, target) {
    const list = Array.isArray(assets) ? assets : [];
    for (const entry of list) {
        const binary = entry?.binary;
        const pkg = binary?.package;
        if (pkg === null || typeof pkg !== 'object') continue;
        if (binary.os !== target?.os || binary.architecture !== target?.arch) continue;
        if (binary.image_type !== 'jre' || binary.jvm_impl !== 'hotspot') continue;
        const { name, link, checksum, size } = pkg;
        if (!isText(name) || !name.endsWith('.' + target.archive) || /[\\/]/.test(name) || name.startsWith('.')) continue;
        if (typeof checksum !== 'string' || !/^[0-9a-fA-F]{64}$/.test(checksum)) continue;
        if (!Number.isInteger(size) || size <= 0) continue;
        return { name, link: isText(link) ? link : null, sha256: checksum.toLowerCase(), size, release: isText(entry.release_name) ? entry.release_name : null };
    }
    return null;
}

const joinFor = (platform) => (platform === 'win32' ? path.win32.join : path.posix.join);

/**
 * The folder of the JRE in the folder of the test server: `<dir>/jdk`.
 * @param {string} serverDir
 * @param {string} platform process.platform
 * @returns {string}
 */
export function jdkDir(serverDir, platform) {
    return joinFor(platform)(serverDir, JDK_FOLDER);
}

/**
 * The java of an unpacked JRE folder: `<jdk dir>/<folder>/bin/java` (java.exe on Windows).
 * @param {string} folder the folder of one JRE, for example <dir>/jdk/jdk-25.0.5+8-jre
 * @param {string} platform process.platform
 * @returns {string}
 */
export function javaInJdk(folder, platform) {
    return joinFor(platform)(folder, 'bin', platform === 'win32' ? 'java.exe' : 'java');
}

/**
 * The command that unpacks the archive into the jdk folder: the tar of the system (GNU tar on Linux,
 * the bsdtar of Windows 10 and later, which also reads a zip).
 * @param {string} archive the downloaded file
 * @param {string} dest the jdk folder
 * @param {{archive: string}} target from jdkTarget
 * @returns {{command: string, args: string[]}}
 */
export function jdkExtractCommand(archive, dest, target) {
    return { command: 'tar', args: [target?.archive === 'zip' ? '-xf' : '-xzf', archive, '-C', dest] };
}

/**
 * The major version in the output of `java -version`: `openjdk version "25.0.5" 2025-10-21` gives 25,
 * `java version "1.8.0_202"` gives 8, `openjdk version "21" 2023-09-19` gives 21. null without a version.
 * @param {string} text what java -version printed (it prints to standard error)
 * @returns {number|null}
 */
export function javaMajor(text) {
    if (typeof text !== 'string') return null;
    const m = /\bversion "(\d+)(?:\.(\d+))?[^"]*"/.exec(text);
    if (!m) return null;
    const first = Number(m[1]);
    if (first === 1 && m[2] !== undefined) return Number(m[2]);
    return Number.isInteger(first) && first > 0 ? first : null;
}

/**
 * The line with which the runner refuses a Java that is too old (or whose version it cannot read).
 * @param {string} java the path of the java
 * @param {number|null} major from javaMajor
 * @returns {string}
 */
export function javaRefusal(java, major) {
    const found = major === null ? 'a java without a readable version' : `Java ${major}`;
    return `World tests refused: ${found} at ${java}; the Minecraft ${VERSION} server needs Java ${MIN_JAVA} or later (set MC_TEST_JAVA, or run node scripts/get_test_server.js --jdk).`;
}
