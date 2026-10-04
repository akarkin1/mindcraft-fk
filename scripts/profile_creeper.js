// The watchdog of the creeper loop (release v0.1.4.13, part K, F10 of v0.1.4.12): finds the process of a
// world scenario that eats memory and asks it, from outside, where it is.
//
//   node scripts/profile_creeper.js [--match <text>] [--rss-mb <n>] [--out <folder>] [--port <n>] [--keep]
//
// Every 500 ms it reads the node processes whose command line contains --match (default
// `tests/world/w47`) and their resident memory (/proc/<pid>/status, so Linux only). Each process that
// ends gets a line in <out>/rss.log: its pid, its peak memory and how long it ran. A process above
// --rss-mb (default 1500) is paused through its inspector (SIGUSR1 opens it on --port, default 9229;
// Debugger.pause works while the event loop is blocked by a loop) and <out>/stack_<pid>.txt gets the
// stack with the local variables of its first frames and the memory of the heap. Then the process is
// killed, so that the runner goes on (--keep leaves it paused instead). Nothing of this runs in play;
// the script only reads /proc and talks to the inspector of the process it found.
/* global process */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const match = opt('--match', 'tests/world/w47');
const rssMb = Number(opt('--rss-mb', '1500'));
const out = path.resolve(opt('--out', 'profile'));
const port = Number(opt('--port', '9229'));
const keep = args.includes('--keep');
fs.mkdirSync(out, { recursive: true });

const seen = new Map(); // pid -> { since, peak }
let pausing = null;

function stamp() {
    return new Date().toISOString().slice(11, 19);
}

function logLine(file, text) {
    fs.appendFileSync(path.join(out, file), `[${stamp()}] ${text}\n`);
    console.log(`[${stamp()}] ${text}`);
}

function readProcesses() {
    const found = [];
    for (const name of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        let cmd;
        try { cmd = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').join(' '); } catch { continue; }
        if (!cmd.includes(match) || !/(^|\/)node /.test(cmd)) continue;
        let rss = 0;
        try {
            const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${name}/status`, 'utf8'));
            rss = m ? Number(m[1]) / 1024 : 0;
        } catch { continue; }
        found.push({ pid: Number(name), rss });
    }
    return found;
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

// Pauses the process through its inspector and writes its stack. Resolves when the file is written.
async function pauseAndDump(pid) {
    const file = `stack_${pid}.txt`;
    logLine('watch.log', `pid ${pid} is above ${rssMb} MB: opening its inspector`);
    try {
        process._debugProcess(pid);
    } catch (e) {
        logLine('watch.log', `pid ${pid}: SIGUSR1 failed: ${e.message}`);
        return;
    }
    await new Promise((r) => setTimeout(r, 1500));
    let targets;
    try {
        targets = await getJson(`http://127.0.0.1:${port}/json/list`);
    } catch (e) {
        logLine('watch.log', `pid ${pid}: no inspector on port ${port}: ${e.message}`);
        return;
    }
    const url = targets?.[0]?.webSocketDebuggerUrl;
    if (!url) {
        logLine('watch.log', `pid ${pid}: the inspector lists no target`);
        return;
    }
    await new Promise((resolve) => {
        const ws = new WebSocket(url);
        let id = 0;
        const pending = new Map();
        const call = (method, params = {}) => new Promise((res) => {
            const n = ++id;
            pending.set(n, res);
            ws.send(JSON.stringify({ id: n, method, params }));
        });
        const lines = [];
        const done = () => {
            fs.writeFileSync(path.join(out, file), lines.join('\n') + '\n');
            logLine('watch.log', `pid ${pid}: the stack is in ${file} (${lines.length} lines)`);
            try { ws.close(); } catch { /* closed */ }
            resolve();
        };
        const timer = setTimeout(() => { lines.push('(no pause within 20 s)'); done(); }, 20000);
        ws.onopen = async () => {
            await call('Debugger.enable');
            await call('Runtime.enable');
            call('Debugger.pause');
        };
        ws.onerror = (e) => { lines.push(`websocket error: ${e?.message ?? e}`); clearTimeout(timer); done(); };
        ws.onmessage = async (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) {
                pending.get(m.id)(m);
                pending.delete(m.id);
                return;
            }
            if (m.method !== 'Debugger.paused') return;
            clearTimeout(timer);
            const frames = m.params.callFrames;
            lines.push(`paused pid ${pid} at ${new Date().toISOString()}, reason ${m.params.reason}, ${frames.length} frames`);
            for (const f of frames) {
                lines.push(`  at ${f.functionName || '(anonymous)'} ${f.url}:${f.location.lineNumber + 1}:${f.location.columnNumber + 1}`);
            }
            for (const f of frames.slice(0, 8)) {
                lines.push(`locals of ${f.functionName || '(anonymous)'} ${f.url}:${f.location.lineNumber + 1}:`);
                for (const scope of f.scopeChain) {
                    if (scope.type !== 'local' && scope.type !== 'closure' && scope.type !== 'block') continue;
                    const r = await call('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true });
                    for (const p of r.result?.result ?? []) {
                        const v = p.value ?? {};
                        const text = v.description ?? (v.value !== undefined ? JSON.stringify(v.value) : v.type);
                        lines.push(`    ${scope.type} ${p.name} = ${String(text).slice(0, 160)}`);
                    }
                }
            }
            const mem = await call('Runtime.evaluate', { expression: 'JSON.stringify(process.memoryUsage())', returnByValue: true });
            lines.push(`memory ${mem.result?.result?.value ?? JSON.stringify(mem)}`);
            if (keep) {
                lines.push('left paused (--keep)');
            } else {
                await call('Debugger.resume');
            }
            done();
        };
    });
}

logLine('watch.log', `watching node processes with "${match}", pause above ${rssMb} MB, output ${out}`);
setInterval(() => {
    const now = Date.now();
    const alive = new Set();
    for (const { pid, rss } of readProcesses()) {
        alive.add(pid);
        const s = seen.get(pid) ?? { since: now, peak: 0 };
        s.peak = Math.max(s.peak, rss);
        seen.set(pid, s);
        if (rss > rssMb && !pausing && !s.dumped) {
            s.dumped = true;
            pausing = pauseAndDump(pid).catch((e) => logLine('watch.log', `pid ${pid}: ${e?.stack ?? e}`)).then(() => {
                pausing = null;
                if (!keep) {
                    try { process.kill(pid, 'SIGKILL'); logLine('watch.log', `pid ${pid} killed after the dump`); } catch { /* gone */ }
                }
            });
        }
    }
    for (const [pid, s] of seen) {
        if (alive.has(pid)) continue;
        seen.delete(pid);
        logLine('rss.log', `pid ${pid} ended: peak ${s.peak.toFixed(0)} MB after ${((now - s.since) / 1000).toFixed(0)} s${s.dumped ? ' (dumped)' : ''}`);
    }
}, 500);
