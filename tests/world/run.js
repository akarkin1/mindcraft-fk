// World test runner of release v0.1.4.6 (`npm run test:world`): tests on a REAL Minecraft server.
//
// One server process per run: the official Minecraft 1.21.8 server from MC_TEST_SERVER_DIR (default
// %LOCALAPPDATA%\Mindcraft\test-server) with the Java of MC_TEST_JAVA (default: the Java 21 of the
// Minecraft launcher). It runs on 127.0.0.1, port 25599 or the next free one, offline mode, a flat
// world, in a fresh temp directory (os.tmpdir()/mc-world-*) that is removed at the end. The server
// folder is only read. Without server or Java: "World tests skipped: no test server found.", exit 0.
//
// Every scenario runs in its own node process with its own temp directory as working directory
// (bots/ lands there), in its own region of the world (200 blocks from the others). It sends
// console commands to the server through this runner (a small HTTP service on 127.0.0.1 with a
// random token, see control.js). A scenario that depends on monsters runs up to 3 times and passes
// with 2 passing runs.
//
// Usage:
//   node tests/world/run.js                  all scenarios
//   node tests/world/run.js doors shelter    only scenarios whose name contains one of the words
//   node tests/world/run.js --verbose        print the whole output of every scenario
//   node tests/world/run.js --server-log     also print the server lines of every scenario
// Environment: MC_TEST_SERVER_DIR, MC_TEST_JAVA, MCW_LOG_DIR (a folder where the runner copies the
// output of every scenario and the server log; nothing is copied without it).
//
// Exit code: 0 only if every selected scenario passed and nothing was left behind.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locateServer, McServer, findFreePort, killPid, pidAlive, OWNER_PORT } from './mc_server.js';

const WORLD_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WORLD_DIR, '..', '..');
const TMP_PREFIX = 'mc-world-';

// name, file, timeout in seconds, depends on monsters
const SCENARIOS = [
    ['baseline', 'w01_baseline.js', 180, false],
    ['flags_off', 'w02_flags_off.js', 240, false],
    ['doors', 'w03_doors.js', 240, false],
    ['shelter', 'w04_shelter.js', 180, false],
    ['night', 'w05_night.js', 300, false],
    ['protected_house', 'w06_protected_house.js', 240, false],
    ['scan', 'w07_scan.js', 180, false],
    ['farm', 'w08_farm.js', 150, false],
    ['creeper', 'w09_creeper.js', 240, true],
    ['sleep', 'w10_sleep.js', 200, false],
    ['eat', 'w11_eat.js', 180, false],
    ['rules', 'w12_rules.js', 200, false],
    ['cost', 'w13_cost.js', 200, false],
    ['creeper_standing', 'w14_creeper_standing.js', 240, false], // NoAI: the creeper does not move (F3)
];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const showServer = args.includes('--server-log');
const words = args.filter((a) => !a.startsWith('-'));
const selected = SCENARIOS.filter(([name]) => words.length === 0 || words.some((w) => name.includes(w)));
const logDir = process.env.MCW_LOG_DIR ? path.resolve(process.env.MCW_LOG_DIR) : null;

const loc = locateServer();
if (loc.missing) {
    console.log('World tests skipped: no test server found.');
    console.log(`  (missing: ${loc.missing}; set MC_TEST_SERVER_DIR and MC_TEST_JAVA)`);
    process.exit(0);
}

// ------------------------------------------------------------------ hygiene snapshots

function listTree(dir, skipTop = []) {
    const out = [];
    const walk = (d, rel) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (!rel && skipTop.includes(e.name)) continue;
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full, r);
            else {
                let st = null;
                try { st = fs.statSync(full); } catch { /* gone */ }
                out.push(`${r}|${st ? st.size : '?'}|${st ? st.mtimeMs : '?'}`);
            }
        }
    };
    walk(dir, '');
    return out.sort();
}

const repoBots = () => { try { return fs.readdirSync(path.join(ROOT, 'bots')).sort().join(','); } catch { return '(missing)'; } };
const leftoverTemps = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(TMP_PREFIX));

const botsBefore = repoBots();
const serverFolderBefore = listTree(loc.serverDir, ['logs']);
const tempsBefore = new Set(leftoverTemps());

// ------------------------------------------------------------------ the server

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX + 'run-'));
const serverDir = path.join(runDir, 'server');
const port = await findFreePort();
if (port === OWNER_PORT) throw new Error('refusing the port of the owner');
const server = new McServer({ ...loc, dir: serverDir, port, echo: null });
server.prepare();

let exiting = false;
process.on('exit', () => { if (server.pid && server.running) killPid(server.pid); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(sig, () => {
        if (exiting) return;
        exiting = true;
        console.log(`\n${sig}: stopping the server and the scenario`);
        for (const c of children) killPid(c.pid);
        killPid(server.pid);
        try { fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* reported below */ }
        process.exit(130);
    });
}

const children = new Set();
const token = crypto.randomBytes(16).toString('hex');

// ------------------------------------------------------------------ the control service

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
    const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
    };
    try {
        if (req.headers['x-mcw-token'] !== token) return send(403, { ok: false, error: 'bad token' });
        const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
        if (req.url === '/commands') {
            const out = await server.commands(body.commands || [], body.ms || 30000);
            return send(200, { ok: true, out });
        }
        if (req.url === '/log') {
            const from = Number(body.from) || 0;
            return send(200, { ok: true, lines: server.lines.slice(from).map((l) => l.text), next: server.lines.length });
        }
        if (req.url === '/wait') {
            const re = new RegExp(body.re, body.flags || '');
            const line = await server.waitLine(re, body.ms || 10000, Number(body.from) || 0);
            return send(200, { ok: true, line: line.text, n: line.n });
        }
        return send(404, { ok: false, error: 'unknown path ' + req.url });
    } catch (e) {
        return send(200, { ok: false, error: String(e && e.message || e) });
    }
});
await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
const controlUrl = `http://127.0.0.1:${control.address().port}`;

// ------------------------------------------------------------------ world defaults

// The world state every scenario starts from; a scenario changes what it needs in its region.
const WORLD_DEFAULTS = [
    'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'weather clear',
    'gamerule doMobSpawning false', 'gamerule doInsomnia false', 'gamerule doPatrolSpawning false',
    'gamerule doTraderSpawning false', 'gamerule randomTickSpeed 0', 'gamerule announceAdvancements false',
    'gamerule doImmediateRespawn true', 'gamerule playersSleepingPercentage 100',
    'gamerule doFireTick false', 'gamerule mobGriefing true',
    'difficulty peaceful', 'time set 6000',
];

async function findGround() {
    // the lowest y at 0,0 where the block is air and the block below is not air (the spawn chunk)
    const ys = [];
    for (let y = -64; y <= 100; y++) ys.push(y);
    const out = (await server.commands(['forceload add 0 0', ...ys.map((y) => `execute if block 0 ${y} 0 minecraft:air`), 'forceload remove 0 0'])).slice(1, -1);
    for (let i = 1; i < ys.length; i++) {
        if (out[i].some((l) => l.startsWith('Test passed')) && out[i - 1].some((l) => l.startsWith('Test failed'))) return ys[i] - 1;
    }
    throw new Error('could not find the ground at 0,0');
}

// ------------------------------------------------------------------ scenarios

function makeScenarioDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX + 'scn-'));
    fs.mkdirSync(path.join(dir, 'bots'));
    for (const f of ['execTemplate.js', 'lintTemplate.js']) {
        fs.copyFileSync(path.join(ROOT, 'bots', f), path.join(dir, 'bots', f));
    }
    fs.writeFileSync(path.join(dir, 'eslint.config.mjs'),
        `export { default } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'eslint.config.js')).href)};\n`);
    return dir;
}

let regionIndex = 0;
let groundY = null;

function runScenarioOnce(name, file, timeoutS, run) {
    return new Promise((resolve) => {
        const tmp = makeScenarioDir();
        const region = regionIndex++;
        const ox = 400 + region * 200;
        const oz = 0;
        const t0 = Date.now();
        const lines = [];
        const serverFrom = server.lines.length;
        const child = spawn(process.execPath, [path.join(WORLD_DIR, file)], {
            cwd: tmp,
            env: {
                ...process.env,
                ANTHROPIC_API_KEY: 'placeholder-not-a-key',
                MCW_CONTROL: controlUrl, MCW_TOKEN: token, MCW_SERVER_PORT: String(port),
                MCW_REGION_X: String(ox), MCW_REGION_Z: String(oz), MCW_GROUND_Y: String(groundY),
                MCW_RUN: String(run), MCW_REGION: String(region), MCW_TMP: tmp,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        children.add(child);
        const onLine = (line) => {
            lines.push(line);
            if (verbose) console.log(`  | ${line}`);
        };
        readline.createInterface({ input: child.stdout }).on('line', onLine);
        readline.createInterface({ input: child.stderr }).on('line', (l) => onLine('[stderr] ' + l));
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; killPid(child.pid); }, timeoutS * 1000);
        child.on('exit', async (code, signal) => {
            clearTimeout(timer);
            children.delete(child);
            await new Promise((r) => setTimeout(r, 150));
            // the scenario cleans its region; this is the safety net for a scenario that died
            let cleanup = [];
            try {
                cleanup = await server.commands([
                    `kill @e[type=!minecraft:player,x=${ox - 120},y=-64,z=${oz - 120},dx=240,dy=400,dz=240]`,
                    `forceload remove ${ox - 120} ${oz - 120} ${ox + 120} ${oz + 120}`,
                    ...WORLD_DEFAULTS,
                ]);
            } catch (e) { lines.push('runner cleanup error: ' + e.message); }
            const serverLines = server.lines.slice(serverFrom).map((l) => l.raw);
            const ms = Date.now() - t0;
            let removed = false;
            try {
                fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
                removed = !fs.existsSync(tmp);
            } catch (e) { lines.push('temp dir cleanup error: ' + e.message); }
            const killedMobs = (cleanup[0] || []).join(' ');
            resolve({ name, run, code, signal, timedOut, ms, lines, serverLines, removed, tmp, region, ox, oz, killedMobs });
        });
    });
}

function judge(r, timeoutS) {
    const failedChecks = r.lines.filter((l) => /^(\s*\[\w+\] )?CHECK FAIL /.test(l));
    const pass = !r.timedOut && r.code === 0 && failedChecks.length === 0 && r.removed;
    let reason = '';
    if (r.timedOut) reason = `timeout after ${timeoutS} s, process killed`;
    else if (!r.removed) reason = `temp directory ${r.tmp} could not be removed`;
    else if (failedChecks.length) reason = failedChecks.map((l) => l.trim()).join('\n    ');
    else if (r.code !== 0) reason = `exit code ${r.code} ${r.signal || ''}`;
    return { pass, reason, failedChecks };
}

function report(r, timeoutS, label) {
    const j = judge(r, timeoutS);
    const checkLines = r.lines.filter((l) => /^(\s*\[\w+\] )?(CHECK|NOTE) /.test(l));
    if (!verbose) for (const l of checkLines) console.log(`    ${l}`);
    if (!j.pass && !verbose) {
        console.log('    --- last output lines of the scenario ---');
        for (const l of r.lines.slice(-40)) console.log(`    | ${l}`);
    }
    if (showServer || !j.pass) {
        const interesting = r.serverLines.filter((l) => !/mcw_mark_\d+<--\[HERE\]|Unknown or incomplete command|^\S+ \S+ Test (passed|failed)|has the following entity data|Changed the block|Successfully filled|Test passed|Test failed/.test(l));
        console.log(`    --- server lines of this run (${interesting.length} of ${r.serverLines.length}, command answers left out) ---`);
        for (const l of interesting.slice(-40)) console.log(`    S ${l}`);
    }
    if (logDir) {
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(path.join(logDir, `${r.name}_run${r.run}.log`), r.lines.join('\n') + '\n');
        fs.writeFileSync(path.join(logDir, `${r.name}_run${r.run}_server.log`), r.serverLines.join('\n') + '\n');
    }
    console.log(`${j.pass ? 'PASS' : 'FAIL'} ${label} (${(r.ms / 1000).toFixed(1)} s, region x=${r.ox})${j.pass ? '' : '\n    reason: ' + j.reason}`);
    return j.pass;
}

// ------------------------------------------------------------------ main

const tStart = Date.now();
const outcomes = [];
let hygieneProblems = [];
console.log(`world tests v0.1.4.6: node ${process.version}, repository ${ROOT}, ${selected.length} scenario(s)`);
console.log(`server ${loc.jar}\njava ${loc.java}`);
try {
    await server.start();
    console.log(`server ready on 127.0.0.1:${port} after ${(server.startMs / 1000).toFixed(1)} s (pid ${server.pid})`);
    await server.commands(WORLD_DEFAULTS);
    groundY = await findGround();
    console.log(`ground at 0,0: the top block is at y ${groundY}, a bot stands at y ${groundY + 1}`);

    for (const [name, file, timeoutS, monsters] of selected) {
        if (!monsters) {
            const r = await runScenarioOnce(name, file, timeoutS, 1);
            const pass = report(r, timeoutS, name);
            outcomes.push({ name, pass, ms: r.ms, runs: [pass] });
            continue;
        }
        const runs = [];
        let totalMs = 0;
        for (let run = 1; run <= 3; run++) {
            const r = await runScenarioOnce(name, file, timeoutS, run);
            totalMs += r.ms;
            runs.push(report(r, timeoutS, `${name} run ${run}`));
            const passes = runs.filter(Boolean).length;
            const fails = runs.length - passes;
            if (passes >= 2 || fails >= 2) break;
        }
        const pass = runs.filter(Boolean).length >= 2;
        console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${runs.filter(Boolean).length} of ${runs.length} runs passed (${runs.map((p) => (p ? 'pass' : 'fail')).join(', ')})`);
        outcomes.push({ name, pass, ms: totalMs, runs });
    }
} catch (e) {
    console.log('RUNNER ERROR ' + (e && e.stack || e));
    hygieneProblems.push('runner error: ' + (e && e.message));
    const tail = server.lines.slice(-30).map((l) => l.raw);
    for (const l of tail) console.log(`    S ${l}`);
} finally {
    for (const c of children) killPid(c.pid);
    const st = await server.stop(20000);
    console.log(`server stopped: ${st.killed ? 'KILLED after 20 s' : 'with "stop"'}, exit ${JSON.stringify(st.exit)}`);
    if (st.killed) hygieneProblems.push('the server did not stop within 20 s and was killed');
    if (logDir) {
        try { fs.copyFileSync(path.join(serverDir, 'logs', 'latest.log'), path.join(logDir, 'server_latest.log')); } catch { /* none */ }
    }
    await new Promise((resolve) => control.close(resolve));
    if (pidAlive(server.pid)) {
        killPid(server.pid);
        hygieneProblems.push(`server process ${server.pid} was still alive after the stop and was killed`);
    }
    try { fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch (e) { hygieneProblems.push('run dir: ' + e.message); }
}

// ------------------------------------------------------------------ hygiene

if (pidAlive(server.pid)) hygieneProblems.push(`server process ${server.pid} is alive`);
const newTemps = leftoverTemps().filter((n) => !tempsBefore.has(n));
if (newTemps.length) hygieneProblems.push(`temp directories left: ${newTemps.join(', ')}`);
const botsAfter = repoBots();
if (botsAfter !== botsBefore) hygieneProblems.push(`repository bots/ changed: before [${botsBefore}] after [${botsAfter}]`);
const serverFolderAfter = listTree(loc.serverDir, ['logs']);
if (JSON.stringify(serverFolderAfter) !== JSON.stringify(serverFolderBefore)) {
    const added = serverFolderAfter.filter((x) => !serverFolderBefore.includes(x));
    const gone = serverFolderBefore.filter((x) => !serverFolderAfter.includes(x));
    hygieneProblems.push(`the server folder changed: new or changed ${JSON.stringify(added.slice(0, 5))}, gone ${JSON.stringify(gone.slice(0, 5))}`);
}
for (const p of hygieneProblems) console.log(`FAIL hygiene: ${p}`);
if (!hygieneProblems.length) console.log(`hygiene: no server process left (pid ${server.pid} ended), no ${TMP_PREFIX}* temp directory left, repository bots/ unchanged, server folder unchanged (logs not compared)`);

const failed = outcomes.filter((o) => !o.pass);
const total = ((Date.now() - tStart) / 1000).toFixed(1);
console.log('RESULTS');
for (const o of outcomes) console.log(`  ${o.pass ? 'PASS' : 'FAIL'} ${o.name.padEnd(16)} ${(o.ms / 1000).toFixed(1).padStart(6)} s${o.runs.length > 1 ? `  runs: ${o.runs.map((p) => (p ? 'pass' : 'fail')).join(', ')}` : ''}`);
console.log(`SUMMARY ${outcomes.length - failed.length} passed, ${failed.length} failed` +
    `${failed.length ? ' (' + failed.map((f) => f.name).join(', ') + ')' : ''} in ${total} s`);
process.exitCode = failed.length === 0 && hygieneProblems.length === 0 && outcomes.length === selected.length ? 0 : 1;
