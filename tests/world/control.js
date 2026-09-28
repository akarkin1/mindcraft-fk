// Client of the runner's control service, used inside a scenario process (and its phases).
// The runner owns the server process; a scenario sends console commands through it and reads the
// server log. The service listens on 127.0.0.1 only and needs the token of the run.
//
// node:http is used instead of fetch: it keeps working after the SES lockdown of the agent.
import http from 'node:http';

const BASE = process.env.MCW_CONTROL || '';
const TOKEN = process.env.MCW_TOKEN || '';

export const env = {
    port: Number(process.env.MCW_SERVER_PORT),
    ox: Number(process.env.MCW_REGION_X),
    oz: Number(process.env.MCW_REGION_Z),
    groundY: Number(process.env.MCW_GROUND_Y),
    run: Number(process.env.MCW_RUN || 1),
    region: Number(process.env.MCW_REGION || 0),
    world: process.env.MCW_WORLD || 'flat', // the world type of the server (mc_server.js WORLD_TYPES)
};

export function haveControl() {
    return Boolean(BASE && TOKEN && Number.isFinite(env.port));
}

function post(pathName, body, ms) {
    return new Promise((resolve, reject) => {
        if (!BASE) return reject(new Error('MCW_CONTROL is not set: scenarios run only through tests/world/run.js'));
        const url = new URL(pathName, BASE);
        if (url.hostname !== '127.0.0.1') return reject(new Error('the control service must be on 127.0.0.1'));
        const data = JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1', port: Number(url.port), path: url.pathname, method: 'POST', agent: false,
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-mcw-token': TOKEN },
        }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(text);
                    if (!json.ok) reject(new Error(`control ${pathName}: ${json.error}`));
                    else resolve(json);
                } catch (e) { reject(new Error(`control ${pathName}: bad answer ${text.slice(0, 200)}`)); }
            });
        });
        req.setTimeout(ms + 5000, () => req.destroy(new Error(`control ${pathName}: no answer within ${ms + 5000} ms`)));
        req.on('error', reject);
        req.end(data);
    });
}

// Sends console commands (with or without a leading slash); resolves with the output lines of
// each command: an array of arrays of text.
export async function commands(list, ms = 30000) {
    if (!list.length) return [];
    return (await post('/commands', { commands: list, ms }, ms)).out;
}

export async function command(cmd, ms = 30000) {
    return (await commands([cmd], ms))[0];
}

// The server log from line index `from` on: { lines, next }.
export async function serverLog(from = 0) {
    const r = await post('/log', { from }, 5000);
    return { lines: r.lines, next: r.next };
}

// The index of the next server line: pass it to waitServerLine to see only new lines.
export async function serverMark() {
    return (await serverLog(1e12)).next;
}

// Resolves with the text of the first server line from `from` on that matches re.
export async function waitServerLine(re, ms = 10000, from = 0) {
    const r = await post('/wait', { re: re.source, flags: re.flags.replace('g', ''), from, ms }, ms);
    return r.line;
}
