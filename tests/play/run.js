// The play test (`npm run test:play`, release v0.1.4.10, spec I7 T4): the first ten minutes of the owner with the
// chat model of his profile, on the test server. The only test in which the model talks; it costs money (about 10
// cents with Luna) and runs only on the owner's machine, never in `npm test`.
//
//   npm run test:play                              the chat model of profiles/claude.json
//   npm run test:play -- --profile profiles/x.json another profile
//   npm run test:play -- --fake                    the fake model of the world tests (no key, no cost): proves the run
//
// It refuses to run without the key of the chat model in the environment (ANTHROPIC_API_KEY for a Claude model,
// OPENAI_API_KEY for gpt and Luna, ...; see KEY_OF_API in play_logic.js); keys.json is not read. Like the world
// runner it starts the 1.21.8 server of MC_TEST_SERVER_DIR with MC_TEST_JAVA on 127.0.0.1, port 25599 or the next
// free one (never 55916), in a fresh temp directory, as a world of the type `base`; tests/play/play.js builds the
// owner variant of the base in a region of it, starts the bot and the player and plays. Then one table: the sentence,
// the command the model chose, the command of the journeys, the world fact, pass or fail, the cost; and the line of
// the cost meter. Exit codes: 0 every fact holds, 1 otherwise or when it cannot run (one line says why).
/* global process */
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locateServer, McServer, findFreePort, killPid, pidAlive, OWNER_PORT, worldProperties, worldProbes } from '../world/mc_server.js';
import { parseArgs, keyCheck, modelName, formatTable } from './play_logic.js';

const PLAY_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(PLAY_DIR, '..', '..');
const TMP_PREFIX = 'mc-play-';
const TIMEOUT_MS = 30 * 60 * 1000;

// The world state of the run, as the world runner sets it.
const WORLD_DEFAULTS = [
    'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'weather clear',
    'gamerule doMobSpawning false', 'gamerule doInsomnia false', 'gamerule doPatrolSpawning false',
    'gamerule doTraderSpawning false', 'gamerule randomTickSpeed 0', 'gamerule announceAdvancements false',
    'gamerule doImmediateRespawn true', 'gamerule playersSleepingPercentage 100',
    'gamerule doFireTick false', 'gamerule mobGriefing true',
    'difficulty peaceful', 'time set 6000',
];

const stop = (text) => { console.log(text); process.exit(1); };

const args = parseArgs(process.argv.slice(2));
if (!args.ok) {
    console.log(args.help ? args.reason : `${args.reason}. Run with --help for the usage.`);
    process.exit(args.help ? 0 : 1);
}
const profileFile = path.resolve(ROOT, args.profile);
let profile;
try {
    profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
} catch (e) {
    stop(`Play test not run: cannot read the profile ${args.profile}: ${e.code ?? e.message}.`);
}
if (!args.fake) {
    const k = keyCheck(profile, process.env);
    if (!k.ok) stop(`Play test refused: ${k.reason}. Set it, or run with --fake.`);
}
const loc = locateServer();
if (loc.missing) stop(`Play test not run: no test server found (missing: ${loc.missing}; set MC_TEST_SERVER_DIR and MC_TEST_JAVA).`);

// ------------------------------------------------------------------ the server and its control

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX + 'run-'));
const port = await findFreePort();
if (port === OWNER_PORT) stop('Play test not run: refusing the port of the owner.');
const server = new McServer({ ...loc, dir: path.join(runDir, 'server-base'), port, echo: null });
server.prepare(worldProperties('base'));
const token = crypto.randomBytes(16).toString('hex');
let child = null;
let scnDir = null;

function cleanup() {
    if (child?.pid) killPid(child.pid);
    if (server.pid && server.running) killPid(server.pid);
    for (const d of [scnDir, runDir]) {
        if (d) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* reported by the next run */ } }
    }
}
process.on('exit', () => { if (server.pid && server.running) killPid(server.pid); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => { cleanup(); process.exit(130); });

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('body too large')); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

const control = http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
        if (req.headers['x-mcw-token'] !== token) return send(403, { ok: false, error: 'bad token' });
        const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
        if (req.url === '/commands') return send(200, { ok: true, out: await server.commands(body.commands || [], body.ms || 30000) });
        if (req.url === '/log') {
            const from = Number(body.from) || 0;
            return send(200, { ok: true, lines: server.lines.slice(from).map((l) => l.text), next: server.lines.length });
        }
        if (req.url === '/wait') {
            const line = await server.waitLine(new RegExp(body.re, body.flags || ''), body.ms || 10000, Number(body.from) || 0);
            return send(200, { ok: true, line: line.text, n: line.n });
        }
        return send(404, { ok: false, error: 'unknown path ' + req.url });
    } catch (e) {
        return send(200, { ok: false, error: String(e && e.message || e) });
    }
});

// ------------------------------------------------------------------ the play

function makeScenarioDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX + 'scn-'));
    fs.mkdirSync(path.join(dir, 'bots'));
    for (const f of ['execTemplate.js', 'lintTemplate.js']) fs.copyFileSync(path.join(ROOT, 'bots', f), path.join(dir, 'bots', f));
    fs.writeFileSync(path.join(dir, 'eslint.config.mjs'),
        `export { default } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'eslint.config.js')).href)};\n`);
    return dir;
}

function play(groundY, controlUrl) {
    return new Promise((resolve) => {
        scnDir = makeScenarioDir();
        const env = {
            ...process.env,
            MCW_CONTROL: controlUrl, MCW_TOKEN: token, MCW_SERVER_PORT: String(port),
            MCW_REGION_X: '400', MCW_REGION_Z: '0', MCW_GROUND_Y: String(groundY), MCW_RUN: '1', MCW_REGION: '0',
            MCW_TMP: scnDir, MCW_WORLD: 'base', PLAY_FAKE: args.fake ? '1' : '', PLAY_PROFILE: profileFile,
        };
        // the fake model stands in for a Claude model, whose class wants a key when it is made
        if (args.fake) env.ANTHROPIC_API_KEY = 'placeholder-not-a-key';
        child = spawn(process.execPath, [path.join(PLAY_DIR, 'play.js')], { cwd: scnDir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const lines = [];
        const onLine = (l) => { lines.push(l); if (args.verbose) console.log(`  | ${l}`); };
        readline.createInterface({ input: child.stdout }).on('line', onLine);
        readline.createInterface({ input: child.stderr }).on('line', (l) => onLine('[stderr] ' + l));
        const timer = setTimeout(() => killPid(child.pid), TIMEOUT_MS);
        child.on('exit', (code) => { clearTimeout(timer); resolve({ code, lines }); });
    });
}

let exitCode = 1;
try {
    await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
    await server.start();
    await server.commands(WORLD_DEFAULTS);
    const { probes, ground } = worldProbes('base');
    const out = (await server.commands(['forceload add 0 0', ...probes.map((p) => `execute if block 0 ${p.y} 0 ${p.block}`), 'forceload remove 0 0'])).slice(1, -1);
    if (!out.every((lines) => lines.some((l) => l.startsWith('Test passed')))) throw new Error('the base world does not have its layers');
    console.log(`Play test: server on 127.0.0.1:${port}; the bot plays with ${args.fake ? 'the fake model' : `the model ${modelName(profile)}`} (about 10 minutes).`);
    const { code, lines } = await play(ground, `http://127.0.0.1:${control.address().port}`);
    const rows = lines.filter((l) => l.startsWith('PLAY_ROW ')).map((l) => JSON.parse(l.slice('PLAY_ROW '.length)));
    const costLine = lines.find((l) => l.startsWith('PLAY_COST '))?.slice('PLAY_COST '.length).trim() || null;
    const error = lines.find((l) => l.startsWith('PLAY_ERROR '));
    console.log(formatTable(rows, { fake: args.fake, model: modelName(profile), costLine }));
    if (error || !lines.some((l) => l.startsWith('PLAY_END '))) {
        console.log(`The play ended early (exit ${code}): ${error ? error.slice('PLAY_ERROR '.length).split('\n')[0] : 'no end line'}. Its last lines:`);
        for (const l of lines.slice(-30)) console.log(`  | ${l}`);
    } else if (rows.length > 0 && rows.every((r) => r.pass === true)) {
        exitCode = 0;
    }
} catch (e) {
    console.log(`Play test error: ${e?.message ?? e}`);
} finally {
    if (child?.pid && pidAlive(child.pid)) killPid(child.pid);
    await server.stop(20000).catch(() => {});
    if (pidAlive(server.pid)) killPid(server.pid);
    await new Promise((resolve) => control.close(resolve));
    cleanup();
}
process.exit(exitCode);
