// Gets the server of the world tests (release v0.1.4.9, spec section 9): the official Minecraft
// 1.21.8 server, through Mojang's version manifest, into the folder of the test server.
//
//   node scripts/get_test_server.js [--accept-eula] [--dir <folder>]
//
// 1. Reads the version manifest, finds 1.21.8, reads its version file, takes downloads.server.
// 2. Refuses a server whose SHA-1 is not the one the tests were made with (exit code 3).
// 3. Downloads to <dir>/server-1.21.8.jar.part, checks SHA-1 and size, renames it to
//    server-1.21.8.jar. A jar that is there already with the right SHA-1 is kept.
// 4. With --accept-eula writes eula.txt with eula=true; without it says how to accept the EULA.
// The folder is --dir, else MC_TEST_SERVER_DIR, else the default of get_test_server_logic.js.
// Uses the global fetch of Node, no dependency. Exit codes: 0 done, 1 network or file error,
// 2 bad arguments, 3 wrong checksum. Node's fetch uses HTTPS_PROXY only with NODE_USE_ENV_PROXY=1
// (Node 22.21 and later).
/* global process */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
    MANIFEST_URL, VERSION, JAR_NAME, JAR_SHA1, EULA_URL, EXIT, USAGE,
    parseArgs, pickVersion, serverDownload, defaultDir, eulaText, eulaAccepted,
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

// Downloads url to file while it counts the bytes and computes the SHA-1.
async function download(fetchFn, url, file) {
    let response;
    try {
        response = await fetchFn(url);
    } catch (error) {
        throw new Failure(`Could not download ${url}: ${error?.cause?.message ?? error?.message ?? error}.`);
    }
    if (!response.ok || !response.body) throw new Failure(`Could not download ${url}: HTTP ${response.status}.`);
    const hash = crypto.createHash('sha1');
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
    return { sha1: hash.digest('hex'), size };
}

/**
 * Runs the script. Every dependency can be replaced for the tests; by default the real ones.
 * @param {string[]} argv the arguments after the script name
 * @param {{fetch?: Function, env?: object, platform?: string, now?: () => Date, log?: (line: string) => void,
 *          expectedSha1?: string}} deps
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, deps = {}) {
    const fetchFn = deps.fetch ?? globalThis.fetch;
    const env = deps.env ?? process.env;
    const platform = deps.platform ?? process.platform;
    const now = deps.now ?? (() => new Date());
    const log = deps.log ?? ((line) => process.stdout.write(line + '\n'));
    const expectedSha1 = deps.expectedSha1 ?? JAR_SHA1;

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
