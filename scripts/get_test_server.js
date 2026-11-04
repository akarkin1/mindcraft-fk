// Gets the server of the world tests (release v0.1.4.9, spec section 9; v0.1.4.14, spec section 4.4):
// the official Minecraft 26.1 server, through Mojang's version manifest, into the folder of the test
// server, and with --jdk the Eclipse Temurin 25 JRE that the 26.1 server needs.
//
//   node scripts/get_test_server.js [--accept-eula] [--jdk] [--dir <folder>]
//
// 1. Reads the version manifest, finds 26.1, reads its version file, takes downloads.server.
// 2. Refuses a server whose SHA-1 (or size) is not the one the tests were made with (exit code 3).
// 3. Downloads to <dir>/server-26.1.jar.part, checks SHA-1 and size, renames it to
//    server-26.1.jar. A jar that is there already with the right SHA-1 is kept.
// 4. With --accept-eula writes eula.txt with eula=true; without it says how to accept the EULA.
// 5. With --jdk (Linux x64 and Windows x64): asks the Adoptium API for the newest Temurin 25 JRE, its
//    archive and its SHA-256, downloads it from the binary URL to <dir>/jdk/<archive>.part, checks the
//    SHA-256 and the size, unpacks it with the tar of the system into <dir>/jdk/ and deletes the archive.
//    A JRE of Java 25 or later that is there already (<dir>/jdk/*/bin/java) is kept.
// The folder is --dir, else MC_TEST_SERVER_DIR, else the default of get_test_server_logic.js.
// Uses the global fetch of Node, no dependency. Exit codes: 0 done, 1 network or file error,
// 2 bad arguments, 3 wrong checksum. Node's fetch uses HTTPS_PROXY only with NODE_USE_ENV_PROXY=1
// (Node 22.21 and later).
/* global process */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
    MANIFEST_URL, VERSION, JAR_NAME, JAR_SHA1, JAR_SIZE, MIN_JAVA, EULA_URL, EXIT, USAGE,
    parseArgs, pickVersion, serverDownload, defaultDir, eulaText, eulaAccepted,
    jdkTarget, jdkBinaryUrl, jdkAssetsUrl, jdkPackage, jdkDir, javaInJdk, jdkExtractCommand, javaMajor,
} from './get_test_server_logic.js';

// An error whose text is shown as it is, with the exit code of the script.
class Failure extends Error {
    constructor(message, code = EXIT.ERROR) {
        super(message);
        this.code = code;
    }
}

async function readJson(fetchFn, url) {
    let response;
    try {
        response = await fetchFn(url);
    } catch (error) {
        throw new Failure(`Could not read ${url}: ${error?.cause?.message ?? error?.message ?? error}.`);
    }
    if (!response.ok) throw new Failure(`Could not read ${url}: HTTP ${response.status}.`);
    try {
        return await response.json();
    } catch (error) {
        throw new Failure(`Could not read ${url}: the answer is no JSON (${error?.message ?? error}).`);
    }
}

// SHA-1 and size of a file, or null when it does not exist.
async function fileSha1(file) {
    if (!fs.existsSync(file)) return null;
    const hash = crypto.createHash('sha1');
    let size = 0;
    for await (const chunk of fs.createReadStream(file)) {
        hash.update(chunk);
        size += chunk.length;
    }
    return { sha1: hash.digest('hex'), size };
}

// Downloads url to file while it counts the bytes and computes the hash (SHA-1 by default).
async function download(fetchFn, url, file, algorithm = 'sha1') {
    let response;
    try {
        response = await fetchFn(url);
    } catch (error) {
        throw new Failure(`Could not download ${url}: ${error?.cause?.message ?? error?.message ?? error}.`);
    }
    if (!response.ok || !response.body) throw new Failure(`Could not download ${url}: HTTP ${response.status}.`);
    const hash = crypto.createHash(algorithm);
    let size = 0;
    const counter = new Transform({
        transform(chunk, _encoding, done) {
            hash.update(chunk);
            size += chunk.length;
            done(null, chunk);
        },
    });
    try {
        await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(file));
    } catch (error) {
        fs.rmSync(file, { force: true });
        throw new Failure(`Could not download ${url} to ${file}: ${error?.message ?? error}. The part was deleted.`);
    }
    const digest = hash.digest('hex');
    return { sha1: digest, digest, size };
}

// The version text of a java (java -version prints to standard error), without JAVA_TOOL_OPTIONS.
function javaVersionText(java) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'JAVA_TOOL_OPTIONS') delete env[key];
    const r = spawnSync(java, ['-version'], { encoding: 'utf8', env, timeout: 30000, windowsHide: true });
    return `${r.stderr ?? ''}${r.stdout ?? ''}`;
}

// The javas of the unpacked JREs in the jdk folder: <jdk>/*/bin/java, sorted by name, newest last.
function jdkJavas(jdk, platform) {
    let entries = [];
    try { entries = fs.readdirSync(jdk, { withFileTypes: true }); } catch { return []; }
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => javaInJdk(path.join(jdk, e.name), platform))
        .filter((java) => fs.existsSync(java))
        .sort();
}

// Step 5: the Temurin JRE into <dir>/jdk/. Throws a Failure.
async function getJdk(fetchFn, dir, deps, log) {
    const platform = deps.platform ?? process.platform;
    const arch = deps.arch ?? process.arch;
    const run = deps.run ?? spawnSync;
    const versionOf = deps.javaVersion ?? javaVersionText;
    const target = jdkTarget(platform, arch);
    if (target === null) {
        throw new Failure(`The option --jdk knows Linux x64 and Windows x64 only; this machine is ${platform} ${arch}. Install Java ${MIN_JAVA} and set MC_TEST_JAVA.`);
    }
    const jdk = jdkDir(dir, platform);
    for (const java of jdkJavas(jdk, platform).reverse()) {
        const major = javaMajor(versionOf(java));
        if (major !== null && major >= MIN_JAVA) {
            log(`Java ${major} is already there: ${java}.`);
            return;
        }
    }
    const pkg = jdkPackage(await readJson(fetchFn, jdkAssetsUrl(target)), target);
    if (pkg === null) throw new Failure(`The answer of ${jdkAssetsUrl(target)} names no JRE archive with a SHA-256.`);
    log(`Read the Adoptium API: ${pkg.name} (${pkg.release ?? 'no release name'}) has ${pkg.size} bytes and the SHA-256 ${pkg.sha256}.`);
    fs.mkdirSync(jdk, { recursive: true });
    const archive = path.join(jdk, pkg.name);
    const part = archive + '.part';
    const url = jdkBinaryUrl(target);
    const got = await download(fetchFn, url, part, 'sha256');
    if (got.digest !== pkg.sha256 || got.size !== pkg.size) {
        fs.rmSync(part, { force: true });
        throw new Failure(`The download of ${url} has ${got.size} bytes and the SHA-256 ${got.digest}, not ${pkg.size} bytes and ${pkg.sha256}. It was deleted.`, EXIT.CHECKSUM);
    }
    fs.renameSync(part, archive);
    log(`Downloaded ${got.size} bytes, checked the SHA-256 and the size: ${archive}.`);
    const before = new Set(jdkJavas(jdk, platform));
    const { command, args } = jdkExtractCommand(archive, jdk, target);
    const r = run(command, args, { encoding: 'utf8', windowsHide: true });
    fs.rmSync(archive, { force: true });
    if (r?.error || r?.status !== 0) {
        throw new Failure(`Could not unpack ${pkg.name} with ${command}: ${r?.error?.message ?? (String(r?.stderr ?? '').trim() || `exit code ${r?.status}`)}.`);
    }
    const java = jdkJavas(jdk, platform).find((j) => !before.has(j));
    if (!java) throw new Failure(`${pkg.name} was unpacked into ${jdk}, but no ${javaInJdk('<folder>', platform)} is there.`);
    log(`Unpacked the JRE: ${java}. The runner of the world tests takes it when MC_TEST_JAVA is not set.`);
}

/**
 * Runs the script. Every dependency can be replaced for the tests; by default the real ones.
 * @param {string[]} argv the arguments after the script name
 * @param {{fetch?: Function, env?: object, platform?: string, arch?: string, now?: () => Date,
 *          log?: (line: string) => void, expectedSha1?: string, expectedSize?: number,
 *          run?: Function, javaVersion?: (java: string) => string}} deps
 *        run replaces spawnSync for the unpacking of --jdk, javaVersion the reading of java -version
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, deps = {}) {
    const fetchFn = deps.fetch ?? globalThis.fetch;
    const env = deps.env ?? process.env;
    const platform = deps.platform ?? process.platform;
    const now = deps.now ?? (() => new Date());
    const log = deps.log ?? ((line) => process.stdout.write(line + '\n'));
    const expectedSha1 = deps.expectedSha1 ?? JAR_SHA1;
    // The size of the real jar is checked as well; a test that serves another file names its own.
    const expectedSize = deps.expectedSize ?? (expectedSha1 === JAR_SHA1 ? JAR_SIZE : null);

    const args = parseArgs(argv);
    if (args.help) {
        log(USAGE);
        return EXIT.DONE;
    }
    if (args.errors.length > 0) {
        for (const error of args.errors) log(error);
        log(USAGE);
        return EXIT.ARGUMENTS;
    }
    if (typeof fetchFn !== 'function') {
        log('This Node has no global fetch. Use Node 20 or later.');
        return EXIT.ERROR;
    }

    const dir = path.resolve(args.dir ?? defaultDir(platform, env));
    const jar = path.join(dir, JAR_NAME);
    const part = jar + '.part';
    try {
        log(`Folder of the test server: ${dir}`);
        const manifest = await readJson(fetchFn, MANIFEST_URL);
        const version = pickVersion(manifest, VERSION);
        if (version === null) throw new Failure(`The version manifest has no version ${VERSION}.`);
        log(`Read the version manifest: ${VERSION} is in it.`);

        const server = serverDownload(await readJson(fetchFn, version.url));
        if (server === null) throw new Failure(`The version file of ${VERSION} names no server download.`);
        log(`Read the version file of ${VERSION}: the server has ${server.size} bytes and the SHA-1 ${server.sha1}.`);
        if (server.sha1 !== expectedSha1) {
            throw new Failure(`The SHA-1 is not ${expectedSha1}: it is not the file the tests were made with. Nothing was downloaded.`, EXIT.CHECKSUM);
        }
        if (expectedSize !== null && server.size !== expectedSize) {
            throw new Failure(`The size is not ${expectedSize} bytes: it is not the file the tests were made with. Nothing was downloaded.`, EXIT.CHECKSUM);
        }

        fs.mkdirSync(dir, { recursive: true });
        const existing = await fileSha1(jar);
        if (existing !== null && existing.sha1 === expectedSha1) {
            log('The server jar is already there.');
        } else {
            if (existing !== null) log(`The ${JAR_NAME} in the folder has the SHA-1 ${existing.sha1}. It is replaced.`);
            const got = await download(fetchFn, server.url, part);
            if (got.sha1 !== expectedSha1 || got.size !== server.size) {
                fs.rmSync(part, { force: true });
                throw new Failure(`The download has ${got.size} bytes and the SHA-1 ${got.sha1}, not ${server.size} bytes and ${expectedSha1}. It was deleted.`, EXIT.CHECKSUM);
            }
            fs.renameSync(part, jar);
            log(`Downloaded ${server.size} bytes, checked the SHA-1 and the size, saved as ${jar}.`);
        }

        const eula = path.join(dir, 'eula.txt');
        if (args.acceptEula) {
            fs.writeFileSync(eula, eulaText(now()));
            log(`Wrote ${eula} with eula=true.`);
        } else if (fs.existsSync(eula) && eulaAccepted(fs.readFileSync(eula, 'utf8'))) {
            log(`${eula} accepts the EULA already.`);
        } else {
            log(`The EULA of Minecraft (${EULA_URL}) must be accepted before the server runs: start this script again with --accept-eula, or write eula=true into ${eula} by hand.`);
        }
        if (args.jdk) await getJdk(fetchFn, dir, { ...deps, platform }, log);
        return EXIT.DONE;
    } catch (error) {
        if (error instanceof Failure) {
            log(error.message);
            return error.code;
        }
        log(`File error: ${error?.message ?? error}.`);
        return EXIT.ERROR;
    }
}

function isMainModule() {
    if (!process.argv[1]) return false;
    const self = fileURLToPath(import.meta.url);
    const started = path.resolve(process.argv[1]);
    return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

if (isMainModule()) {
    main(process.argv.slice(2)).then(
        (code) => { process.exitCode = code; },
        (error) => {
            console.error('get_test_server failed:', error);
            process.exitCode = EXIT.ERROR;
        },
    );
}
