// Reads the blocks of a box of a world into a dump file (release v0.1.4.10, spec I7 T2), so that the world tests
// can build the owner's base from it (tests/world/owner_region.js).
//
//   node scripts/dump_region.js --host <h> --port <p> --name <bot name> --center <x> <y> <z> --radius <r>
//                               --out tests/world/owner_region.json
//
// Connects with mineflayer as a second player in offline mode, waits until every chunk of the box is loaded
// (at most --wait seconds), reads every block of the box (bot.blockAt: the name and the properties of
// KEPT_PROPS), writes { version: 1, center, radius, blocks: [[x, y, z, name, props]] } without air, disconnects
// and prints one table. It reads only: it sends no chat, no command, and digs or places nothing. The contents of
// chests are not read. The owner runs it once against his own world; the tests never connect to that world.
// Exit codes: 0 written, 1 a bad argument, no connection, chunks not loaded or the file not written (one line
// says why).
/* global process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MC_VERSION, parseArgs, boxOf, chunksOf, dumpOf, dumpText, formatTable } from './dump_region_logic.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The default connection: mineflayer, imported only when the script runs.
async function defaultCreateBot(options) {
    const { default: mineflayer } = await import('mineflayer');
    return mineflayer.createBot(options);
}

async function defaultVec3() {
    const { default: vec3 } = await import('vec3');
    return vec3;
}

// Resolves when the bot spawned; rejects with a text on a kick, an error or an end before.
function spawned(bot, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => done(new Error(`no spawn within ${ms / 1000} s`)), ms);
        const done = (err) => {
            clearTimeout(t);
            bot.removeListener('spawn', onSpawn);
            bot.removeListener('kicked', onKick);
            bot.removeListener('error', onError);
            bot.removeListener('end', onEnd);
            if (err) reject(err); else resolve();
        };
        const onSpawn = () => done(null);
        const onKick = (reason) => done(new Error(`kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
        const onError = (e) => done(new Error(e?.message ?? String(e)));
        const onEnd = (reason) => done(new Error(`the connection ended: ${reason ?? 'no reason'}`));
        bot.once('spawn', onSpawn);
        bot.once('kicked', onKick);
        bot.once('error', onError);
        bot.once('end', onEnd);
    });
}

async function quit(bot) {
    if (!bot) return;
    let timer = null;
    const ended = new Promise((r) => { bot.once('end', r); timer = setTimeout(r, 5000); });
    try { bot.quit(); } catch { /* gone */ }
    await ended;
    clearTimeout(timer);
}

/**
 * @param {string[]} argv the arguments after the script name
 * @param {object} [deps] createBot(options) -> bot, vec3(x, y, z), writeFile(file, text), log(text), pollMs
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, deps = {}) {
    const log = deps.log ?? ((text) => console.log(text));
    const args = parseArgs(argv);
    if (!args.ok) {
        log(args.help ? args.reason : `${args.reason}. Run with --help for the usage.`);
        return args.help ? 0 : 1;
    }
    const createBot = deps.createBot ?? defaultCreateBot;
    const v3 = deps.vec3 ?? (await defaultVec3());
    const writeFile = deps.writeFile ?? ((file, text) => {
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, text);
    });
    const pollMs = deps.pollMs ?? 500;
    let bot = null;
    try {
        bot = await createBot({
            host: args.host, port: args.port, username: args.name, auth: 'offline', version: MC_VERSION,
            hideErrors: true, checkTimeoutInterval: 60000,
        });
        bot.on('error', () => { /* a late error ends in 'end'; without a listener it would throw */ });
        await spawned(bot, 30000);
    } catch (error) {
        await quit(bot);
        log(`Could not connect to ${args.host}:${args.port} as ${args.name}: ${error?.message ?? error}.`);
        return 1;
    }
    try {
        const box = boxOf(args.center, args.radius);
        // one cell per chunk column: blockAt gives null while its chunk is not loaded
        const probes = chunksOf(box).map(([cx, cz]) => v3(Math.min(Math.max(cx * 16, box.min.x), box.max.x), box.min.y, Math.min(Math.max(cz * 16, box.min.z), box.max.z)));
        const t0 = Date.now();
        let missingChunks = probes.filter((p) => !bot.blockAt(p)).length;
        while (missingChunks > 0 && Date.now() - t0 < args.wait * 1000) {
            await sleep(pollMs);
            missingChunks = probes.filter((p) => !bot.blockAt(p)).length;
        }
        if (missingChunks > 0) {
            const at = bot.entity?.position;
            log(`${missingChunks} of ${probes.length} chunks of the box are not loaded after ${args.wait} s; the bot stands at ` +
                `${at ? `(${Math.floor(at.x)}, ${Math.floor(at.y)}, ${Math.floor(at.z)})` : 'an unknown place'}: stand it near (${args.center.x}, ${args.center.y}, ${args.center.z}) and run again.`);
            return 1;
        }
        const blocks = [];
        let cells = 0;
        let missing = 0;
        for (let y = box.min.y; y <= box.max.y; y++) {
            for (let x = box.min.x; x <= box.max.x; x++) {
                for (let z = box.min.z; z <= box.max.z; z++) {
                    cells++;
                    const b = bot.blockAt(v3(x, y, z));
                    if (!b) { missing++; continue; }
                    blocks.push({ x, y, z, name: b.name, props: typeof b.getProperties === 'function' ? b.getProperties() : {} });
                }
            }
        }
        const dump = dumpOf({ center: args.center, radius: args.radius, blocks });
        try {
            writeFile(args.out, dumpText(dump));
        } catch (error) {
            log(`Could not write ${args.out}: ${error?.code ?? error?.message ?? error}.`);
            return 1;
        }
        await quit(bot);
        bot = null;
        log(formatTable({ dump, cells, missing, out: args.out }));
        return 0;
    } finally {
        await quit(bot);
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
        (code) => { process.exitCode = code; setTimeout(() => process.exit(code), 200).unref(); },
        (error) => {
            console.log(`dump_region failed: ${error?.message ?? error}`);
            process.exitCode = 1;
        },
    );
}
