// The scripted supervisor of the journeys of v0.1.4.13 "Supervision" (tester T3; PLAN.md 1.16, SPEC section 5): a
// client of the watch server that runs in the test process and plays the Claude session of the owner. It speaks the
// protocol of scripts/watch.js (JSON-RPC 2.0 over POST /mcp with the bearer token, the text of `result.content`), and
// nothing else: it knows no code of the server. Every call is counted (`calls`, `count(tool)`), every `wait` that
// did not time out is a wake (`wakes`), and the digests it reads are folded into `state` (what runs, the job line,
// the inventory changes summed, the chat lines and the events seen), so that a scenario decides on facts the
// supervisor got through the tools. The token is never printed: `redact` strips it from every text that leaves.
//
//   const sup = new Supervisor({ url, token });
//   await sup.run(['!mineOre("iron", 6)']);                 // { ok, text, ran, of, results: [{ n, command, result }] }
//   const w = await sup.wait({ for: 'done', timeout: 55 }); // { ok, text, woke, ...digest }
//   await sup.digest(); await sup.look(16); await sup.reply('It is in the tunnel.'); await sup.server();
import http from 'node:http';
import { Buffer } from 'node:buffer';

export const WAIT_MAX_S = 55; // the longest wait the spec allows (the tunnel's limit is 60 s)

const HEADS = /^(Cursor: |At \(|Health |Running: |Job: |Inventory: |Hand: |Chat: |Events: |Hazards: |Chest: |Woke: |Nothing changed\.)/;

/** The text of a tools/call answer as the client prints it: { ok, text } (ok false: a refusal or an error). */
export function answerText(status, body) {
    let message = null;
    try {
        message = JSON.parse(body);
    } catch {
        const m = /^data: (.*)$/m.exec(String(body ?? '')); // an answer as server-sent events
        if (m) {
            try { message = JSON.parse(m[1]); } catch { message = null; }
        }
    }
    if (!message || typeof message !== 'object') return { ok: false, text: status === 401 ? 'unauthorized' : `HTTP ${status}: ${String(body ?? '').slice(0, 200)}` };
    if (message.error) return { ok: false, text: String(message.error.message ?? `error ${message.error.code}`) };
    const content = Array.isArray(message.result?.content) ? message.result.content : [];
    const text = content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
    if (message.result?.isError === true) return { ok: false, text };
    if (status >= 400) return { ok: false, text: `HTTP ${status}: ${text}` };
    return { ok: true, text };
}

/**
 * Reads a digest (or the answer of `wait`, which is a digest headed by `Woke: ...`): the cursor, the wake, the lines
 * by their kind. Chat and event lines follow their headers (`Chat: 3 new lines.`, `Events: 1 new.`) until the next
 * header. Pure; a text that is no digest gives empty parts.
 */
export function parseDigest(text) {
    const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l !== '');
    const out = { woke: null, cursor: null, at: null, health: null, running: undefined, job: null, inventory: {}, hand: null, chat: [], events: [], hazards: null, chest: null, nothing: false, lines };
    let section = null;
    for (const line of lines) {
        if (HEADS.test(line)) section = null;
        let m;
        if ((m = /^Woke: (\w+)\.$/.exec(line))) out.woke = m[1];
        else if ((m = /^Cursor: (\d+)\.$/.exec(line))) out.cursor = m[1];
        else if (/^At \(/.test(line)) out.at = line;
        else if (/^Health /.test(line)) out.health = line;
        else if ((m = /^Running: (.*)$/.exec(line))) out.running = /^nothing\.?$/.test(m[1]) ? null : m[1];
        else if ((m = /^Job: (.*)$/.exec(line))) out.job = m[1];
        else if ((m = /^Inventory: (.*)$/.exec(line))) {
            for (const part of m[1].replace(/\.$/, '').split(/,\s*/)) {
                const d = /^([+-]\d+) (\w+)$/.exec(part.trim());
                if (d) out.inventory[d[2]] = (out.inventory[d[2]] ?? 0) + Number(d[1]);
            }
        } else if ((m = /^Hand: (.*)$/.exec(line))) out.hand = m[1];
        else if (/^Chat: /.test(line)) section = 'chat';
        else if (/^Events: /.test(line)) section = 'events';
        else if ((m = /^Hazards: (.*)$/.exec(line))) out.hazards = m[1];
        else if ((m = /^Chest: (.*)$/.exec(line))) out.chest = m[1];
        else if (/^Nothing changed\.$/.test(line)) out.nothing = true;
        else if (section === 'chat') {
            const c = /^\[([\d:]+)\] ([^:]+): (.*)$/.exec(line);
            out.chat.push(c ? { t: c[1], name: c[2], text: c[3], line } : { t: null, name: null, text: line, line });
        } else if (section === 'events') {
            const e = /^\[([\d:]+)\] (\w+): (.*)$/.exec(line);
            out.events.push(e ? { t: e[1], kind: e[2], text: e[3], line } : { t: null, kind: null, text: line, line });
        }
    }
    return out;
}

/** The answer of `run`: { ran, of, results: [{ n, command, result }] } (ran and of null when the text is no answer of run). */
export function parseRun(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    const head = /^Ran (\d+) of (\d+)\.$/.exec(lines[0] ?? '');
    const results = [];
    for (const line of lines.slice(1)) {
        const m = /^(\d+)\. (![^:]+?): (.*)$/.exec(line);
        if (m) results.push({ n: Number(m[1]), command: m[2], result: m[3] });
    }
    const still = /^Still running: (\d+) of (\d+)\.$/m.exec(text ?? '');
    return { ran: head ? Number(head[1]) : null, of: head ? Number(head[2]) : null, results, still: still ? Number(still[1]) : 0 };
}

export class Supervisor {
    constructor({ url, token, name = 'Opus' }) {
        this.url = url;
        this.token = token;
        this.name = name;
        this.calls = []; // { tool, args, ok, text, ms, status, t }
        this.wakes = 0; // the waits that ended for a reason other than the timeout
        this.timeouts = 0;
        this.cursor = null;
        this.state = { running: null, job: null, inventory: {}, chat: [], events: [], hazards: null, chest: null, at: null, health: null, hand: null };
    }

    /** The text without the token (the token never reaches a note or a check). */
    redact(text) {
        return this.token ? String(text ?? '').split(this.token).join('<token>') : String(text ?? '');
    }

    count(tool) {
        return this.calls.filter((c) => c.tool === tool).length;
    }

    /** One tools/call. Resolves with { ok, text, ms, status }; a server that does not answer within `ms` is a failure. */
    call(tool, args = {}, { ms = 15000 } = {}) {
        const id = this.calls.length + 1;
        const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args ?? {} } });
        const t0 = Date.now();
        return new Promise((resolve) => {
            const u = new URL(this.url);
            const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(body) };
            if (this.token) headers.authorization = `Bearer ${this.token}`;
            const finish = (status, text) => {
                const a = status === null ? { ok: false, text } : answerText(status, text);
                const rec = { tool, args, ok: a.ok, text: this.redact(a.text), ms: Date.now() - t0, status, t: t0 };
                this.calls.push(rec);
                resolve({ ...rec });
            };
            let req;
            try {
                req = http.request({ host: u.hostname, port: Number(u.port), path: u.pathname, method: 'POST', headers, agent: false }, (res) => {
                    let text = '';
                    res.setEncoding('utf8');
                    res.on('data', (c) => { text += c; });
                    res.on('end', () => finish(res.statusCode, text));
                });
            } catch (e) {
                finish(null, `no request: ${e?.message ?? e}`);
                return;
            }
            req.setTimeout(ms, () => req.destroy(new Error(`no answer within ${ms} ms`)));
            req.on('error', (e) => finish(null, `no answer: ${e?.message ?? e}`));
            req.end(body);
        });
    }

    /** Folds a digest into the state and the cursor. Returns the parsed digest. */
    read(text) {
        const d = parseDigest(text);
        if (d.cursor !== null) this.cursor = d.cursor;
        const s = this.state;
        if (d.running !== undefined) s.running = d.running;
        if (d.job !== null) s.job = d.job;
        for (const [k, v] of Object.entries(d.inventory)) s.inventory[k] = (s.inventory[k] ?? 0) + v;
        s.chat.push(...d.chat);
        s.events.push(...d.events);
        for (const k of ['hazards', 'chest', 'at', 'health', 'hand']) if (d[k] !== null) s[k] = d[k];
        return d;
    }

    /** `digest` since the last cursor. */
    async digest() {
        const res = await this.call('digest', this.cursor ? { since: this.cursor } : {});
        return { ...res, ...(res.ok ? this.read(res.text) : parseDigest('')) };
    }

    /**
     * `wait` for `event`, `idle`, `done` or `any` (at most `timeout` s, 1 to 55), since the last cursor. A wake that is
     * not the timeout counts in `wakes`. Resolves with the call and the parsed digest ({ woke, chat, events, ... }).
     */
    async wait({ for: kind = 'any', timeout = WAIT_MAX_S } = {}) {
        const args = { for: kind, timeout };
        if (this.cursor) args.since = this.cursor;
        const res = await this.call('wait', args, { ms: (timeout + 10) * 1000 });
        const d = res.ok ? this.read(res.text) : parseDigest('');
        if (res.ok && d.woke && d.woke !== 'timeout') this.wakes++;
        if (res.ok && d.woke === 'timeout') this.timeouts++;
        return { ...res, ...d };
    }

    /** `run` of 1 to 10 commands. Resolves with the call and { ran, of, results, still }. */
    async run(commands, stopOnFailure = true) {
        const res = await this.call('run', { commands, stop_on_failure: stopOnFailure }, { ms: 65000 });
        return { ...res, ...parseRun(res.ok ? res.text : '') };
    }

    look(radius = 16) {
        return this.call('look', { radius });
    }

    reply(text) {
        return this.call('reply', { text });
    }

    /** `reply` of kind `update`: an unprompted line of the supervisor (SPEC 4.5, `supervisor_updates`). */
    update(text) {
        return this.call('reply', { text, kind: 'update' });
    }

    note(text, minutes = 30) {
        return this.call('note', { text, minutes });
    }

    say(text) {
        return this.call('say', { text });
    }

    server() {
        return this.call('server', {});
    }

    /** The job's progress from the job line: { got, of } or null. */
    progress() {
        const m = /(\d+) of (\d+)/.exec(this.state.job ?? '');
        return m ? { got: Number(m[1]), of: Number(m[2]) } : null;
    }

    /** The events of a kind seen so far. */
    eventsOf(kind) {
        return this.state.events.filter((e) => e.kind === kind);
    }

    /** A short account of the calls, for a note. */
    summary() {
        const by = {};
        for (const c of this.calls) by[c.tool] = (by[c.tool] ?? 0) + 1;
        const slowest = this.calls.reduce((m, c) => Math.max(m, c.ms), 0);
        return `${this.calls.length} calls (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ')}), ${this.wakes} wakes, ${this.timeouts} timeouts, the slowest answer ${slowest} ms`;
    }
}
