// The real Minecraft server of the world tests: finds the server and Java, prepares a fresh
// temp directory, starts the server there, sends console commands through its standard input,
// reads their answers from its standard output, and stops it.
//
// The server folder (MC_TEST_SERVER_DIR) is only read: the server runs with the temp directory
// as working directory and the jar by its path, so the world, server.properties, eula.txt (a copy
// of the accepted one), the extracted libraries and the logs all land in the temp directory.
//
// v0.1.4.14 (spec section 4.4): the Minecraft 26.1 server, which needs Java 25. A Java below 25 is
// refused with one line; without MC_TEST_JAVA the runner takes the Java of the launcher
// (java-runtime-epsilon), else the JRE of `node scripts/get_test_server.js --jdk` in <dir>/jdk/.
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { defaultDir, jdkDir, javaInJdk, javaMajor, javaRefusal, MIN_JAVA } from '../../scripts/get_test_server_logic.js';

export const OWNER_PORT = 55916; // the owner's own world: never used
export const DEFAULT_PORT = 25599;
export const JAR_NAME = 'server-26.1.jar';
export { MIN_JAVA };

// The Java 25 of the Minecraft launcher (java-runtime-epsilon; 1.21.8 used java-runtime-delta, Java 21).
export const DEFAULT_JAVA = path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe',
    'LocalCache', 'Local', 'runtime', 'java-runtime-epsilon', 'windows-x64', 'java-runtime-epsilon', 'bin', 'java.exe');

// The output of `java -version` (standard error) of a java, run without JAVA_TOOL_OPTIONS, whose
// "Picked up ..." line would come first. '' when it cannot be run.
export function javaVersionText(java) {
    const r = spawnSync(java, ['-version'], { encoding: 'utf8', env: serverEnv(), timeout: 30000, windowsHide: true });
    return `${r.stderr ?? ''}${r.stdout ?? ''}`;
}

// The javas of the JREs of `get_test_server.js --jdk`: <dir>/jdk/*/bin/java (java.exe on Windows) that
// exist, sorted by the folder name, the newest first.
export function jdkJavas(serverDir, platform = process.platform) {
    const jdk = jdkDir(serverDir, platform);
    let entries = [];
    try { entries = fs.readdirSync(jdk, { withFileTypes: true }); } catch { return []; }
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => javaInJdk(path.join(jdk, e.name), platform))
        .filter((java) => fs.existsSync(java))
        .sort().reverse();
}

// The Java rule (v0.1.4.14): the server needs Java 25 or later.
//   MC_TEST_JAVA set: that java; missing: { missing }; below 25 or no readable version: { refused }.
//   MC_TEST_JAVA not set: the default Java (the launcher's) when it is there and 25 or later, else the
//   first java of <dir>/jdk/*/bin/ that is 25 or later; else { refused } naming the Java that was found,
//   or { missing } when none was found.
// `versionOf(java)` gives the output of java -version (a fake in the unit tests).
// Returns { java, major } or { missing: '<what>' } or { refused: '<one line>' }.
export function chooseJava(env, platform, serverDir, versionOf = javaVersionText, defaultJava = DEFAULT_JAVA) {
    const check = (java) => ({ java, major: javaMajor(versionOf(java)) });
    const ok = (c) => c.major !== null && c.major >= MIN_JAVA;
    if (env.MC_TEST_JAVA) {
        const java = env.MC_TEST_JAVA;
        if (!fs.existsSync(java)) return { missing: `java ${java}` };
        const c = check(java);
        return ok(c) ? c : { refused: javaRefusal(c.java, c.major) };
    }
    const found = [];
    if (fs.existsSync(defaultJava)) {
        const c = check(defaultJava);
        if (ok(c)) return c;
        found.push(c);
    }
    for (const java of jdkJavas(serverDir, platform)) {
        const c = check(java);
        if (ok(c)) return c;
        found.push(c);
    }
    if (found.length > 0) return { refused: javaRefusal(found[0].java, found[0].major) };
    return { missing: `java ${defaultJava} or ${javaInJdk(path.join(jdkDir(serverDir, platform), '*'), platform)}` };
}

// Where the server and Java are, from MC_TEST_SERVER_DIR and MC_TEST_JAVA or the defaults.
// The default folder is the one of scripts/get_test_server.js (v0.1.4.9): %LOCALAPPDATA%\Mindcraft\test-server
// on Windows, ~/.local/share/mindcraft/test-server on Linux and macOS. Java: see chooseJava.
// Returns { serverDir, jar, java, eula } or { missing: '<what>' } or { refused: '<one line>' }.
export function locateServer(env = process.env, platform = process.platform, versionOf = javaVersionText) {
    const serverDir = defaultDir(platform, env);
    const jar = path.join(serverDir, JAR_NAME);
    const eula = path.join(serverDir, 'eula.txt');
    if (!fs.existsSync(jar)) return { missing: `server jar ${jar}` };
    if (!fs.existsSync(eula) || !/^\s*eula\s*=\s*true\s*$/m.test(fs.readFileSync(eula, 'utf8'))) return { missing: `accepted eula.txt in ${serverDir}` };
    const chosen = chooseJava(env, platform, serverDir, versionOf);
    if (chosen.missing || chosen.refused) return chosen;
    return { serverDir, jar, java: chosen.java, eula };
}

// The environment of the server process: that of the runner without JAVA_TOOL_OPTIONS (v0.1.4.9),
// which the server must not get (the cloud container sets it for the Java tools of its proxy).
export function serverEnv(env = process.env) {
    const copy = { ...env };
    for (const key of Object.keys(copy)) {
        if (key.toUpperCase() === 'JAVA_TOOL_OPTIONS') delete copy[key];
    }
    return copy;
}

// True when nothing listens on 127.0.0.1:port.
export function portIsFree(port) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
}

export async function findFreePort(start = DEFAULT_PORT, tries = 20) {
    for (let p = start; p < start + tries; p++) {
        if (p === OWNER_PORT) continue;
        if (await portIsFree(p)) return p;
    }
    throw new Error(`no free port from ${start} to ${start + tries - 1}`);
}

// The world types of the test server (release v0.1.4.7, spec section 8).
//   flat  the default flat world of the server: bedrock at y -64, dirt at -63 and -62, grass at -61.
//         The scenarios of v0.1.4.6 and the work scenarios above ground run here.
//   deep  a flat world with depth for the mining scenarios: bedrock at y -64, 120 layers of stone
//         (y -63 to 56), 3 of dirt (57 to 59) and grass at y 60; no lakes, no features (so no ore,
//         no trees), no structures. Ore, lava and caves are put into the stone by the scenarios.
// The server (1.21.8 and 26.1) reads the layers of a flat world from the property `generator-settings`, a JSON
// text in the format of the flat generator: { layers: [{ block, height }], biome, lakes, features },
// layers from the bottom up. A text it cannot read gives the default flat world WITHOUT an error in
// the log, so the runner proves the layers after the start (see `worldProbes`).
export const DEEP_LAYERS = Object.freeze([
    { block: 'minecraft:bedrock', height: 1 },
    { block: 'minecraft:stone', height: 120 },
    { block: 'minecraft:dirt', height: 3 },
    { block: 'minecraft:grass_block', height: 1 },
]);
//   base  (v0.1.4.8) the layers of `deep`; the scenarios build a base like the owner's in their region
//         with console commands (base_world.js: a house, a mine under it, a farm, a pen). Its own server,
//         so that `env.world` tells a scenario that it runs there.
export const WORLD_TYPES = Object.freeze(['flat', 'deep', 'base']);
export const MIN_Y = -64;

// The extra server properties of a world type.
export function worldProperties(type = 'flat') {
    if (type === 'flat') return {};
    if (type === 'deep' || type === 'base') {
        return {
            'generator-settings': JSON.stringify({ layers: DEEP_LAYERS, biome: 'minecraft:plains', lakes: false, features: false }),
        };
    }
    throw new Error(`unknown world type ${type}`);
}

// What the layers of a world type put at a column: a list of { y, block } for the lowest and the
// highest block of every layer, and y 0 (deep in the stone of the deep world). The runner tests
// each with `execute if block`.
export function worldProbes(type = 'flat') {
    const layers = type === 'deep' || type === 'base' ? DEEP_LAYERS : [
        { block: 'minecraft:bedrock', height: 1 }, { block: 'minecraft:dirt', height: 2 }, { block: 'minecraft:grass_block', height: 1 },
    ];
    const probes = [];
    let y = MIN_Y;
    for (const l of layers) {
        probes.push({ y, block: l.block });
        if (l.height > 1) probes.push({ y: y + l.height - 1, block: l.block });
        if (y < 0 && y + l.height - 1 > 0) probes.push({ y: 0, block: l.block });
        y += l.height;
    }
    probes.push({ y, block: 'minecraft:air' });
    return { probes, ground: y - 1 };
}

export function serverProperties(port, extra = {}) {
    const props = {
        'server-ip': '127.0.0.1',
        'server-port': String(port),
        'online-mode': 'false',
        'enforce-secure-profile': 'false',
        'level-name': 'world',
        'level-type': 'minecraft\\:flat',
        'generate-structures': 'false',
        'difficulty': 'peaceful',
        'gamemode': 'survival',
        'spawn-protection': '0',
        'spawn-monsters': 'true',
        'view-distance': '6',
        'simulation-distance': '6',
        'max-players': '8',
        'pause-when-empty-seconds': '0',
        'enable-rcon': 'false',
        'enable-query': 'false',
        'enable-status': 'true',
        'motd': 'Mindcraft world test server',
        'sync-chunk-writes': 'false',
        'player-idle-timeout': '0',
        'allow-flight': 'true',
        // A fresh 26.x server may write white-list=true by itself; the bots of the tests are on no list.
        'white-list': 'false',
        'enforce-whitelist': 'false',
        ...extra,
    };
    return '#Mindcraft world tests\n' + Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
}

// Kills the process tree of one process id (the java process this module started).
export function killPid(pid) {
    if (!pid) return;
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
        try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    }
}

// Whether a process with this id is still alive.
export function pidAlive(pid) {
    if (!pid) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// The console of 26.1 (v0.1.4.14). 26.1 renamed the game rules (1.21.11: snake-case ids of the registry
// minecraft:game_rule; `gamerule doDaylightCycle false` is "Incorrect argument for command") and replaced
// `time query daytime` by the timelines (`time query minecraft:day` answers "Timeline minecraft:day is at N
// tick(s)"). The scenarios of the world tests were written for 1.21.8: `commands` rewrites their old names
// before it writes them (doFireTick false is a fire spread radius of 0, true the default 128), and gives the
// answer of the daytime query in the old words, "The time is N". Names taken from the registries report of
// the 26.1 server jar (`--reports`), checked on the server on 2026-11-04.
export const GAMERULES_26_1 = Object.freeze({
    doDaylightCycle: 'advance_time',
    doWeatherCycle: 'advance_weather',
    doMobSpawning: 'spawn_mobs',
    doInsomnia: 'spawn_phantoms',
    doPatrolSpawning: 'spawn_patrols',
    doTraderSpawning: 'spawn_wandering_traders',
    doWardenSpawning: 'spawn_wardens',
    randomTickSpeed: 'random_tick_speed',
    announceAdvancements: 'show_advancement_messages',
    doImmediateRespawn: 'immediate_respawn',
    playersSleepingPercentage: 'players_sleeping_percentage',
    mobGriefing: 'mob_griefing',
    doFireTick: 'fire_spread_radius_around_player',
    keepInventory: 'keep_inventory',
    naturalRegeneration: 'natural_health_regeneration',
    doTileDrops: 'block_drops',
    doEntityDrops: 'entity_drops',
    doMobLoot: 'mob_drops',
    fallDamage: 'fall_damage',
    fireDamage: 'fire_damage',
    drowningDamage: 'drowning_damage',
    freezeDamage: 'freeze_damage',
    sendCommandFeedback: 'send_command_feedback',
    showDeathMessages: 'show_death_messages',
    spawnMonsters: 'spawn_monsters',
});
const FIRE_SPREAD_DEFAULT = '128';

// A console command of the 1.21.8 scenarios in the words of 26.1; any other command as it is.
export function consoleCommand26(cmd) {
    const text = String(cmd);
    const rule = /^gamerule\s+(?:minecraft:)?([A-Za-z]+)(?:\s+(\S+))?\s*$/.exec(text);
    if (rule && Object.hasOwn(GAMERULES_26_1, rule[1])) {
        let value = rule[2];
        if (rule[1] === 'doFireTick' && value !== undefined) value = value === 'false' ? '0' : value === 'true' ? FIRE_SPREAD_DEFAULT : value;
        return `gamerule ${GAMERULES_26_1[rule[1]]}${value === undefined ? '' : ' ' + value}`;
    }
    if (/^time\s+query\s+daytime\s*$/.test(text)) return 'time query minecraft:day';
    return text;
}

// The line of the runner's summary that says the translation was in use: '' when nothing was rewritten.
// `answers` (round 3 of v0.1.4.14) counts the answer lines given back in the words of 1.21.8.
export function translationLine(count, answers = 0) {
    const n = (x) => (Number.isInteger(x) && x > 0 ? x : 0);
    const parts = [];
    if (n(count)) parts.push(`${n(count)} ${n(count) === 1 ? 'command' : 'commands'}`);
    if (n(answers)) parts.push(`${n(answers)} ${n(answers) === 1 ? 'answer' : 'answers'}`);
    return parts.length ? `console: ${parts.join(' and ')} of 1.21.8 translated` : '';
}

// An answer line of 26.1 in the words of 1.21.8, one to one; any other line as it is. Checked on the 26.1
// server on 2026-11-04 (answers that did not change: "Changed the block at x, y, z", "Could not set the block",
// "... has the following block data: ..." and "... entity data: ...", "Summoned new Chicken", "Successfully filled
// N block(s)", "No blocks were filled", "Successfully cloned N block(s)", "Teleported Chicken to x, y, z",
// "Killed N entities", "Killed Chicken", "No entity was found", "No player was found", "Test passed", "Test failed").
//   the daytime query: "Timeline minecraft:day is at N tick(s)"  -> "The time is N"
//   execute if/unless entity, if blocks: "Test passed. Count: N", "Test failed. Count: N"
//                                         -> "Test passed, count: N", "Test failed, count: N" (1.21.8)
export function answerLine26(line) {
    const day = /^Timeline minecraft:day is at (-?\d+) tick\(s\)$/.exec(line);
    if (day) return `The time is ${day[1]}`;
    const test = /^Test (passed|failed)\. Count: (\d+)$/.exec(line);
    if (test) return `Test ${test[1]}, count: ${test[2]}`;
    return line;
}

const LINE_RE = /^\[(\d\d:\d\d:\d\d)\] \[([^\]]+)\/(\w+)\]: (.*)$/;

export class McServer {
    constructor({ java, jar, eula, dir, port, memory = '1G', echo = null }) {
        this.java = java;
        this.jar = jar;
        this.eula = eula;
        this.dir = dir;
        this.port = port;
        this.memory = memory;
        this.echo = echo; // function(line) or null
        this.lines = []; // every line of the server output, in order: { n, time, thread, level, text, raw }
        this.child = null;
        this.pid = null;
        this.exited = null;
        this.exitInfo = null;
        this.waiters = [];
        this.queue = Promise.resolve();
        this.markerCount = 0;
        this.translated = 0; // console commands of 1.21.8 that consoleCommand26 rewrote (v0.1.4.14)
        this.answersTranslated = 0; // answer lines that answerLine26 gave back in the words of 1.21.8
        this.startMs = null;
    }

    prepare(extraProps = {}) {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.copyFileSync(this.eula, path.join(this.dir, 'eula.txt'));
        fs.writeFileSync(path.join(this.dir, 'server.properties'), serverProperties(this.port, extraProps));
    }

    _onLine(raw) {
        const m = LINE_RE.exec(raw);
        const line = m
            ? { n: this.lines.length, time: m[1], thread: m[2], level: m[3], text: m[4], raw }
            : { n: this.lines.length, time: '', thread: '', level: '', text: raw, raw };
        this.lines.push(line);
        if (this.echo) this.echo(raw);
        for (const w of this.waiters.slice()) {
            if (w.test(line)) {
                this.waiters.splice(this.waiters.indexOf(w), 1);
                w.resolve(line);
            }
        }
    }

    // Resolves with the first line from index `from` on that matches re (a RegExp on the text).
    waitLine(re, ms, from = 0, label = String(re)) {
        const found = this.lines.slice(from).find((l) => re.test(l.text));
        if (found) return Promise.resolve(found);
        return new Promise((resolve, reject) => {
            const w = { test: (l) => l.n >= from && re.test(l.text), resolve };
            this.waiters.push(w);
            const t = setTimeout(() => {
                const i = this.waiters.indexOf(w);
                if (i >= 0) this.waiters.splice(i, 1);
                reject(new Error(`timeout after ${ms} ms waiting for server line ${label}`));
            }, ms);
            const orig = w.resolve;
            w.resolve = (l) => { clearTimeout(t); orig(l); };
        });
    }

    async start(timeoutMs = 180000) {
        const t0 = Date.now();
        const args = [`-Xms512M`, `-Xmx${this.memory}`, '-jar', this.jar, 'nogui'];
        this.child = spawn(this.java, args, { cwd: this.dir, env: serverEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        this.pid = this.child.pid;
        this.exited = new Promise((resolve) => this.child.on('exit', (code, signal) => {
            this.exitInfo = { code, signal };
            resolve(this.exitInfo);
        }));
        this.child.on('error', (e) => this._onLine('[mc_server] spawn error: ' + e.message));
        readline.createInterface({ input: this.child.stdout }).on('line', (l) => this._onLine(l));
        readline.createInterface({ input: this.child.stderr }).on('line', (l) => this._onLine('[stderr] ' + l));
        this.child.stdin.on('error', () => { /* the server is gone */ });
        const done = await Promise.race([
            this.waitLine(/^Done \([\d.,]+s\)! For help, type "help"/, timeoutMs, 0, 'Done'),
            this.exited.then((x) => { throw new Error(`server exited during start: ${JSON.stringify(x)}`); }),
        ]);
        this.startMs = Date.now() - t0;
        return done;
    }

    get running() {
        return this.child !== null && this.exitInfo === null;
    }

    // Sends console commands (without the leading slash; a leading slash is removed) and resolves
    // with the output lines of each: an array of arrays of text. The commands of one call are
    // written at once; every command is followed by a marker (an unknown command whose echo is
    // unique), so the lines between two markers belong to the command before the second marker.
    // Lines of other sources (a player joined, a warning) may appear among them.
    commands(list, ms = 30000) {
        const run = async () => {
            if (!this.running) throw new Error('the server is not running');
            const cmds = list.map((c) => {
                const given = String(c).replace(/^\//, '');
                const sent = consoleCommand26(given);
                if (sent !== given) this.translated++;
                return sent;
            });
            for (const c of cmds) if (/[\r\n]/.test(c)) throw new Error('a console command must be one line: ' + JSON.stringify(c));
            const markers = cmds.map(() => `mcw_mark_${++this.markerCount}`);
            const from = this.lines.length;
            let text = '';
            for (let i = 0; i < cmds.length; i++) text += cmds[i] + '\n' + markers[i] + '\n';
            this.child.stdin.write(text);
            const markerLines = [];
            for (const m of markers) {
                const re = new RegExp('^' + m + '<--\\[HERE\\]$');
                markerLines.push(await this.waitLine(re, ms, from, m));
            }
            const out = [];
            let start = from;
            for (const ml of markerLines) {
                out.push(this.lines.slice(start, ml.n)
                    .filter((l) => !/^Unknown or incomplete command/.test(l.text) && !/^mcw_mark_\d+<--\[HERE\]$/.test(l.text))
                    .map((l) => {
                        const said = answerLine26(l.text);
                        if (said !== l.text) this.answersTranslated++;
                        return said;
                    }));
                start = ml.n + 1;
            }
            return out;
        };
        const p = this.queue.then(run, run);
        this.queue = p.catch(() => {});
        return p;
    }

    async command(cmd, ms) {
        return (await this.commands([cmd], ms))[0];
    }

    // Stops the server with "stop"; kills its process tree if it has not ended within ms.
    async stop(ms = 20000) {
        if (!this.child) return { stopped: true, killed: false };
        if (this.exitInfo) return { stopped: true, killed: false, exit: this.exitInfo };
        try { this.child.stdin.write('stop\n'); } catch { /* gone */ }
        let killed = false;
        const timer = new Promise((r) => setTimeout(() => r('timeout'), ms));
        const res = await Promise.race([this.exited, timer]);
        if (res === 'timeout') {
            killed = true;
            killPid(this.pid);
            await Promise.race([this.exited, new Promise((r) => setTimeout(r, 5000))]);
        }
        return { stopped: this.exitInfo !== null, killed, exit: this.exitInfo, alive: pidAlive(this.pid) };
    }
}
