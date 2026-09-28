// The real Minecraft server of the world tests: finds the server and Java, prepares a fresh
// temp directory, starts the server there, sends console commands through its standard input,
// reads their answers from its standard output, and stops it.
//
// The server folder (MC_TEST_SERVER_DIR) is only read: the server runs with the temp directory
// as working directory and the jar by its path, so the world, server.properties, eula.txt (a copy
// of the accepted one), the extracted libraries and the logs all land in the temp directory.
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const OWNER_PORT = 55916; // the owner's own world: never used
export const DEFAULT_PORT = 25599;
export const JAR_NAME = 'server-1.21.8.jar';

const DEFAULT_JAVA = path.join(os.homedir(), 'AppData', 'Local', 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe',
    'LocalCache', 'Local', 'runtime', 'java-runtime-delta', 'windows-x64', 'java-runtime-delta', 'bin', 'java.exe');

// Where the server and Java are, from MC_TEST_SERVER_DIR and MC_TEST_JAVA or the defaults.
// Returns { serverDir, jar, java, eula } or { missing: '<what>' }.
export function locateServer(env = process.env) {
    const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const serverDir = env.MC_TEST_SERVER_DIR || path.join(localAppData, 'Mindcraft', 'test-server');
    const jar = path.join(serverDir, JAR_NAME);
    const eula = path.join(serverDir, 'eula.txt');
    const java = env.MC_TEST_JAVA || DEFAULT_JAVA;
    if (!fs.existsSync(jar)) return { missing: `server jar ${jar}` };
    if (!fs.existsSync(eula) || !/^\s*eula\s*=\s*true\s*$/m.test(fs.readFileSync(eula, 'utf8'))) return { missing: `accepted eula.txt in ${serverDir}` };
    if (!fs.existsSync(java)) return { missing: `java ${java}` };
    return { serverDir, jar, java, eula };
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
        this.child = spawn(this.java, args, { cwd: this.dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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
            const cmds = list.map((c) => String(c).replace(/^\//, ''));
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
                    .map((l) => l.text));
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
