// The pure part of scripts/scorecard.js (release v0.1.4.10, spec I7 T1): a play log of the bot read into
// events, the numbers of one log as a row, and the table. No files, no output.
//
// The lines it reads (a line may start with "[HH:MM:SS] " with log_timestamps on, and with "[stderr] " in the
// output of the world runner):
//   Initializing agent <name>...                         a process starts
//   Agent process ends with exit code <n>: <text>        the reason a process ended (agent.js)
//   Agent process exited with code <n> and signal <s>    the process is gone (agent_process.js)
//   <bot> received message from <player> : <text>        an order of a player (respondFunc); handleMessage
//   received message from <player> : <text>             prints the same message again: counted once
//   Agent executed: !x and got: ... | and was stopped.   a result of a command the model chose
//   <bot> full response to <player>: ""..""              a chat answer of the model
//   parsed command: { commandName: '!x', ... }           a command that runs (typed or chosen by the model)
//   Awaiting <api> api response from model <name>        a call of a model (the line of each model class)
//   Cost: session $0.13 (...), ... 674 calls.            the cost meter (cumulative per launch)
//   I'm stuck!                                           the mode unstuck (also inside an AUTO MESSAGE)
//   Door service: closed <name> at (x, y, z).            a door the bot left open, closed by the service
//   Door service: could not close <name> at ...          a door that stayed open
/* global Buffer */
export const RESULT_WINDOW_S = 60;

export const COLUMNS = Object.freeze(['Log', 'Minutes', 'Processes', 'Ends', 'Orders', 'Without result', 'Calls', 'Cost', 'Stuck', 'Doors open']);

const STREAM = /^\[(?:stderr|stdout)\] /;
const TIME = /^\[(\d\d):(\d\d):(\d\d)\] /;
const DAY = 24 * 3600;

const RE = Object.freeze({
    start: /^Initializing agent (\S+?)\.\.\.\s*$/,
    end: /^Agent process ends with exit code (-?\d+): (.*)$/,
    exit: /^Agent process exited with code (\S+) and signal (\S+)/,
    restart: /^Restarting agent/,
    order: /^(\S+) received message from (\S+) : (.*)$/,
    orderBare: /^received message from (\S+) : (.*)$/,
    executed: /^Agent executed: (!\w+) and (?:got:|was stopped)/,
    answer: /^(\S+) full response to (\S+): /,
    command: /^parsed command: \{ commandName: '(!\w+)'/,
    cost: /^Cost: session \$(\d+(?:\.\d+)?)\b.*?\b(\d+) calls\./,
    earlier: /It includes (\d+) earlier process/,
    door: /Door service: closed (\S+) at \((-?\d+), (-?\d+), (-?\d+)\)/,
    doorFailed: /Door service: could not close (\S+)/,
});

// The model of an "Awaiting ..." line: the name after "from model", "from" or "(model: ...)", else the api.
const AWAIT_FROM = /^Awaiting (.+?) (?:api |API )?response(?: from)?(?: model)? (\S+?)(?:\.\.\.)?\s*$/;
const AWAIT_PAREN = /^Awaiting (.+?) (?:api |API )?response\.\.\. \(model: ([^,)]+)/;
const AWAIT_PLAIN = /^Awaiting (.+?) (?:api |API )?response/;

/**
 * The text of a log file: UTF-16 with its byte order mark (a redirect of Windows PowerShell 5) or UTF-8.
 * @param {Buffer|Uint8Array|string} data
 * @returns {string}
 */
export function decodeLog(data) {
    if (typeof data === 'string') return data;
    const buf = Buffer.from(data);
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        const swapped = Buffer.from(buf.subarray(2));
        swapped.swap16();
        return swapped.toString('utf16le');
    }
    const text = buf.toString('utf8');
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * The model of a line "Awaiting ... response ...", or null for another line.
 * @param {string} text the line without time
 * @returns {string|null}
 */
export function modelOfAwait(text) {
    if (!text.startsWith('Awaiting ')) return null;
    let m = AWAIT_PAREN.exec(text);
    if (m) return m[2].trim();
    m = AWAIT_FROM.exec(text);
    if (m) return m[2];
    m = AWAIT_PLAIN.exec(text);
    return m ? m[1].replace(/\.+$/, '').trim() : null;
}

/**
 * The kind of end of a process from the text of "Agent process ends with exit code N: <text>".
 * @param {string} message
 * @returns {string} stuck, kicked, socket, restart, mindserver, code, players or other
 */
export function endReason(message) {
    const m = String(message ?? '').toLowerCase();
    if (/stuck/.test(m)) return 'stuck';
    if (/kicked/.test(m)) return 'kicked';
    if (/socket|connection|network|timed out|econn|disconnected:/.test(m)) return 'socket';
    if (/restart/.test(m)) return 'restart';
    if (/mindserver/.test(m)) return 'mindserver';
    if (/code execution|action loop/.test(m)) return 'code';
    if (/required players/.test(m)) return 'players';
    return 'other';
}

/**
 * Reads a log into its lines and its events.
 * lines: [{ n, t, text }], n from 1, t in seconds since the first midnight of the log or null (no time);
 * events: [{ type, n, t, ... }] in the order of the lines; first a { type: 'span', from, to } when the log has times.
 * Types: start, end (code, message, reason), exit (code), restart, order (player, text, typed), executed (command),
 * answer (to), command (command), call (model), cost (dollars, calls, earlier), stuck, door (name, x, y, z),
 * door_failed (name).
 * @param {string} text
 * @returns {{lines: object[], events: object[]}}
 */
export function parseLog(text) {
    const raw = String(text ?? '').split(/\r?\n/);
    const lines = [];
    const events = [];
    let offset = 0;
    let lastT = null;
    let first = null;
    let pendingDup = null; // the order printed by respondFunc, which handleMessage prints again
    for (let i = 0; i < raw.length; i++) {
        let s = raw[i].replace(STREAM, '');
        let t = null;
        const tm = TIME.exec(s);
        if (tm) {
            s = s.slice(tm[0].length).replace(STREAM, '');
            t = Number(tm[1]) * 3600 + Number(tm[2]) * 60 + Number(tm[3]) + offset;
            if (lastT !== null && t < lastT - 3600) { offset += DAY; t += DAY; }
            lastT = t;
            if (first === null) first = t;
        }
        const n = i + 1;
        lines.push({ n, t, text: s });
        const ev = (type, extra = {}) => events.push({ type, n, t, ...extra });
        let m;
        if ((m = RE.start.exec(s))) ev('start', { name: m[1] });
        else if ((m = RE.end.exec(s))) ev('end', { code: Number(m[1]), message: m[2], reason: endReason(m[2]) });
        else if ((m = RE.exit.exec(s))) ev('exit', { code: m[1] });
        else if (RE.restart.test(s)) ev('restart');
        else if ((m = RE.order.exec(s))) {
            pendingDup = null;
            if (m[2] !== 'system') {
                ev('order', { player: m[2], text: m[3], typed: m[3].trim().startsWith('!') });
                pendingDup = { player: m[2], text: m[3] };
            }
        } else if ((m = RE.orderBare.exec(s))) {
            const dup = pendingDup && pendingDup.player === m[1] && pendingDup.text === m[2];
            pendingDup = null;
            if (!dup && m[1] !== 'system') ev('order', { player: m[1], text: m[2], typed: m[2].trim().startsWith('!') });
        } else if ((m = RE.executed.exec(s))) ev('executed', { command: m[1] });
        else if ((m = RE.answer.exec(s))) ev('answer', { to: m[2] });
        else if ((m = RE.command.exec(s))) ev('command', { command: m[1] });
        else if ((m = RE.cost.exec(s))) {
            const e = RE.earlier.exec(s);
            ev('cost', { dollars: Number(m[1]), calls: Number(m[2]), earlier: e ? Number(e[1]) : 0 });
        } else {
            const model = modelOfAwait(s);
            if (model !== null) ev('call', { model });
        }
        // these can stand in a line of another kind (the behaviour log inside an AUTO MESSAGE)
        if (s.includes("I'm stuck!")) ev('stuck');
        if ((m = RE.door.exec(s))) ev('door', { name: m[1], x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) });
        else if ((m = RE.doorFailed.exec(s))) ev('door_failed', { name: m[1] });
    }
    if (first !== null) events.unshift({ type: 'span', n: 0, t: first, from: first, to: lastT });
    return { lines, events };
}

const add = (map, key, k = 1) => { map[key] = (map[key] ?? 0) + k; return map; };

// An order has a result when an `Agent executed` line or a chat answer to its player came within 60 s; a typed
// command also by its `parsed command` line (a typed command runs without the model, and its answer is not
// printed). Without times: before the next order.
function withoutResult(events) {
    const orders = events.filter((e) => e.type === 'order');
    const results = events.filter((e) => e.type === 'executed' || e.type === 'answer' || e.type === 'command');
    let count = 0;
    orders.forEach((o, i) => {
        const next = orders[i + 1];
        const fits = (r) => r.n > o.n && (r.type === 'executed' || (r.type === 'answer' && r.to === o.player) || (r.type === 'command' && o.typed));
        const inTime = (r) => (o.t !== null && r.t !== null ? r.t - o.t <= RESULT_WINDOW_S : !next || r.n < next.n);
        if (!results.some((r) => fits(r) && inTime(r))) count++;
    });
    return count;
}

/**
 * The numbers of one log.
 * @param {object[]} events of parseLog
 * @param {{name?: string}} [options]
 * @returns {object[]} one row: { log, minutes, timed, processes, ends, orders, withoutResult, calls, callsFrom,
 *   models, cost, stuck, doors, doorsFailed, commands }
 */
export function scorecard(events, { name = 'log' } = {}) {
    const list = Array.isArray(events) ? events : [];
    const span = list.find((e) => e.type === 'span');
    const ends = {};
    const models = {};
    const commands = {};
    const segments = []; // the last cost line of each process
    let processes = 0;
    let ended = false;
    let current = 0;
    for (const e of list) {
        if (e.type === 'start') { processes++; current = processes; ended = false; }
        else if (e.type === 'end' && !ended) { add(ends, e.reason); ended = true; }
        else if (e.type === 'exit' && !ended) { add(ends, `exit ${e.code}`); ended = true; }
        else if (e.type === 'call') add(models, e.model);
        else if (e.type === 'command') add(commands, e.command);
        else if (e.type === 'cost') segments[current] = e;
    }
    let cost = null;
    let costCalls = null;
    for (const s of segments) {
        if (!s) continue;
        if (s.earlier > 0 || cost === null) { cost = s.dollars; costCalls = s.calls; }
        else { cost += s.dollars; costCalls += s.calls; }
    }
    const awaited = Object.values(models).reduce((a, b) => a + b, 0);
    return [{
        log: name,
        minutes: span ? Math.round(((span.to - span.from) / 60) * 10) / 10 : null,
        timed: Boolean(span),
        processes,
        ends,
        orders: list.filter((e) => e.type === 'order').length,
        withoutResult: withoutResult(list),
        calls: costCalls ?? awaited,
        callsFrom: costCalls !== null ? 'cost' : 'log',
        models,
        cost: cost === null ? null : Math.round(cost * 100) / 100,
        stuck: list.filter((e) => e.type === 'stuck').length,
        doors: list.filter((e) => e.type === 'door').length,
        doorsFailed: list.filter((e) => e.type === 'door_failed').length,
        commands,
    }];
}

/**
 * The sum of several rows, named "Total".
 * @param {object[]} rows
 * @returns {object}
 */
export function totalRow(rows) {
    const merge = (key) => rows.reduce((acc, r) => { for (const [k, v] of Object.entries(r[key] ?? {})) add(acc, k, v); return acc; }, {});
    const sum = (key) => rows.reduce((a, r) => a + (r[key] ?? 0), 0);
    const minutes = rows.filter((r) => r.minutes !== null);
    const costs = rows.filter((r) => r.cost !== null);
    return {
        log: 'Total',
        minutes: minutes.length ? Math.round(minutes.reduce((a, r) => a + r.minutes, 0) * 10) / 10 : null,
        timed: rows.every((r) => r.timed),
        processes: sum('processes'),
        ends: merge('ends'),
        orders: sum('orders'),
        withoutResult: sum('withoutResult'),
        calls: sum('calls'),
        callsFrom: rows.every((r) => r.callsFrom === 'cost') ? 'cost' : 'log',
        models: merge('models'),
        cost: costs.length ? Math.round(costs.reduce((a, r) => a + r.cost, 0) * 100) / 100 : null,
        stuck: sum('stuck'),
        doors: sum('doors'),
        doorsFailed: sum('doorsFailed'),
        commands: merge('commands'),
    };
}

// "a 3, b 1": most first, then by name.
export function countsText(map) {
    const list = Object.entries(map ?? {}).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return list.map(([k, v]) => `${k} ${v}`).join(', ');
}

/**
 * The cells of a row, in the order of COLUMNS.
 * @param {object} r
 * @returns {string[]}
 */
export function cells(r) {
    const models = countsText(r.models);
    return [
        r.log,
        r.minutes === null ? '-' : r.minutes.toFixed(1),
        String(r.processes),
        countsText(r.ends) || '-',
        String(r.orders),
        String(r.withoutResult),
        models ? `${r.calls} (${models})` : String(r.calls),
        r.cost === null ? '-' : `$${r.cost.toFixed(2)}`,
        String(r.stuck),
        r.doorsFailed ? `${r.doors}, ${r.doorsFailed} not closed` : String(r.doors),
    ];
}

/**
 * The table (Markdown) and under it the commands chosen per row, most first, and a line for a log without times.
 * @param {object[]} rows
 * @returns {string}
 */
export function formatTable(rows) {
    const out = [`| ${COLUMNS.join(' | ')} |`, `|${COLUMNS.map(() => '---').join('|')}|`];
    for (const r of rows) out.push(`| ${cells(r).map((c) => c.replace(/\|/g, '/')).join(' | ')} |`);
    out.push('');
    for (const r of rows) out.push(`Commands chosen, ${r.log}: ${countsText(r.commands) || 'none'}`);
    const untimed = rows.filter((r) => !r.timed && r.log !== 'Total');
    for (const r of untimed) {
        out.push(`${r.log} has no times: an order counts as without result when no result came before the next order.`);
    }
    return out.join('\n');
}

export const USAGE = 'Usage: node scripts/scorecard.js <log> [<log>...]';
