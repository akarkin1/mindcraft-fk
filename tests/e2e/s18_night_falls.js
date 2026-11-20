// S18 night_falls (v0.1.4.14 fix round, part 8, T3 with E1; SPEC 8.1.5, DECISIONS P-17): on a server that sends the
// clock of 26.1 once, the bot's clock runs between the packets with the clock's rate. 26.1 sends `update_time` with the
// clocks of the dimensions (totalTicks, partialTick, rate); mineflayer 4.39.0 advanced the clocks every physics tick but
// recomputed bot.time.timeOfDay only in the packet handler, so a bot that gets the packet rarely (the owner's bot, P-17)
// saw day in the night and refused its bed. Before the fix (9e4ff1f) the checks of 2 and 3 fail: the clock stands at 12700.
//
// The fake server (--time=12700 --rate=1, a stone floor at y 63 so that the physics ticks run: without a loaded chunk
// mineflayer runs no physics) sends one update_time at login and no later packet. The real agent (Agent.start, the fake
// models) with the watch server on a free port (watch_port 0) and a random token.
//   1. Right after the spawn: bot.time.timeOfDay is 12700 (within 40 ticks: the physics may have ticked), doDaylightCycle
//      is true (rate 1), the watch `state` says `Time 127xx (Evening)` (v0.1.4.16, F8: the labels of the one clock, dayPhase
//      of clock_logic.js; before: dusk).
//   2. 30 s later, no packet in between: the typed `!stats` says `Time: Night`; bot.time.timeOfDay is within 100 ticks of
//      12700 + 20 x the seconds since the packet (about 13300) and 13000 or more (the night of the game: beds open at
//      12541, monsters come at 13000); the `time` event fired 20 to 60 times (8.1.2: between packets at most once per 20
//      ticks, only when the fields changed); the watch `state` says `(Night)` with `Time N` within 100 of the expected (F8;
//      before: night).
//   3. The night event of the watch: from 12700 at rate 1 the time passes 23000 (night_awake) only after 515 s, beyond
//      the budget of a scenario, so the server sends one more update_time with 22900 (a time change, as `time set` makes a
//      server send one): within 20 s the watch `events` lists `night_awake: The night passed without sleep.` (the clock
//      passed 23000 by itself between packets, no sleep since 12000). Before the fix the clock stands at 22900: no event.
// Throughout: the process lives, no request reached a real model, the token is in no console line of the agent.
import http from 'node:http';
import crypto from 'node:crypto';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand, withTimeout, sleep, recordConsole,
} from './helpers.js';

const NAME = 'e2e_night';
const LOGIN_TICKS = 12700;
const LATER_TICKS = 22900;
const WATCH_MS = 30000;
const TOLERANCE = 100; // ticks
const EVENTS_MIN = 20; // the `time` events of 30 s at the cadence of 8.1.2 (about 30); before the fix 0
const EVENTS_MAX = 60;
const NIGHT_AWAKE = /night_awake: The night passed without sleep\./;
const STATE_TIME = /\bTime (\d+|\?) \((\w+)\)/;

// One tools/call of the watch server over JSON-RPC (node:http: fetch is not for the process after the lockdown).
function rpc(port, token, tool, args = {}) {
    return new Promise((resolve) => {
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
        const req = http.request({
            host: '127.0.0.1', port, path: '/mcp', method: 'POST', agent: false,
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(body), authorization: `Bearer ${token}` },
        }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(text); } catch {
                    const m = /^data: (.*)$/m.exec(text);
                    if (m) { try { json = JSON.parse(m[1]); } catch { /* not JSON */ } }
                }
                const content = Array.isArray(json?.result?.content) ? json.result.content : [];
                resolve({ status: res.statusCode, ok: res.statusCode === 200 && !json?.error && json?.result?.isError !== true, text: content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') || text });
            });
        });
        req.setTimeout(10000, () => req.destroy(new Error('no answer')));
        req.on('error', (e) => resolve({ status: null, ok: false, text: String(e?.message ?? e) }));
        req.end(body);
    });
}

const expectedAt = (tPacket, now) => LOGIN_TICKS + Math.round((now - tPacket) / 50);

await scenarioMain({
    async main() {
        const logs = recordConsole('log');
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the agent runs in this process and reads it at its start; never printed
        const server = await startServer({ seedHigh: 17, seedLow: 23, motd: 'Night World', floor: '63', time: LOGIN_TICKS, rate: 1 });
        let agent = null;
        try {
            const s = await startRealAgent(NAME, server.port, { watch_server: true, watch_port: 0 });
            agent = s.agent;
            const bot = agent.bot;
            // the login packet came before the spawn: the time since the spawn is the time since the packet, within a second
            const tPacket = Date.now();
            const counts = { time: 0, sunset: 0, midnight: 0 };
            for (const name of Object.keys(counts)) bot.on(name, () => { counts[name]++; });
            const port = agent.watch?.port ?? null;
            const stateOf = async () => {
                const res = await rpc(port, TOKEN, 'state');
                const m = STATE_TIME.exec(res.text);
                return { ...res, time: m && m[1] !== '?' ? Number(m[1]) : null, phase: m ? m[2] : null };
            };

            // ---------------------------------------------------------- 1. right after the spawn
            const t1 = bot.time?.timeOfDay;
            note(`1: after the spawn bot.time ${JSON.stringify({ timeOfDay: bot.time?.timeOfDay, doDaylightCycle: bot.time?.doDaylightCycle, clocks: bot.time?.clocks })}; the watch server ${agent.watch?.ok ? `on port ${port}` : `NOT started: ${agent.watch?.text ?? 'no watch'}`}`);
            check(Number.isFinite(t1) && Math.abs(t1 - LOGIN_TICKS) <= 40, `1: right after the spawn bot.time.timeOfDay is ${LOGIN_TICKS} (the one update_time of the login, within 40 ticks)`, String(t1));
            check(bot.time?.doDaylightCycle === true, '1: bot.time.doDaylightCycle is true (the clock has rate 1)', String(bot.time?.doDaylightCycle));
            check(agent.watch?.ok === true && Number.isInteger(port) && port > 0, '1: precondition: the watch server runs on a free port (watch_port 0)', String(port));
            const st1 = await stateOf();
            note(`1: the watch state ${JSON.stringify(st1.text.split('\n')[0] ?? st1.text)}`);
            check(st1.ok && st1.time !== null && Math.abs(st1.time - LOGIN_TICKS) <= 60 && st1.phase === 'Evening', `1: the watch \`state\` says \`Time ${LOGIN_TICKS} (Evening)\` (within 60 ticks)`, `${st1.time} (${st1.phase})`);

            // ---------------------------------------------------------- 2. 30 s later, no packet in between
            while (Date.now() - tPacket < WATCH_MS) {
                console.log(`TRACE t=${((Date.now() - tPacket) / 1000).toFixed(1)}s bot ${bot.time?.timeOfDay} expected ${expectedAt(tPacket, Date.now())} time-events ${counts.time}`);
                await sleep(Math.min(5000, Math.max(0, WATCH_MS - (Date.now() - tPacket))));
            }
            const stats = await withTimeout(runCommand(agent, '!stats'), 15000, '!stats');
            const now2 = Date.now();
            const t2 = bot.time?.timeOfDay;
            const want2 = expectedAt(tPacket, now2);
            const n2 = counts.time;
            const st2 = await stateOf();
            note(`2: ${((now2 - tPacket) / 1000).toFixed(1)} s after the packet bot.time.timeOfDay is ${t2} (expected about ${want2}), ${n2} time events, ${counts.sunset} sunset and ${counts.midnight} midnight events; !stats ${JSON.stringify(stats.split('\n').filter((l) => /Time/.test(l)))}; the watch state ${JSON.stringify(st2.text.split('\n')[0] ?? st2.text)}`);
            check(/- Time: Night/.test(stats), '2: 30 s later the typed `!stats` says `Time: Night`', JSON.stringify(stats.slice(0, 200)));
            check(Number.isFinite(t2) && Math.abs(t2 - want2) <= TOLERANCE, `2: bot.time.timeOfDay is within ${TOLERANCE} ticks of ${LOGIN_TICKS} + 20 x the seconds since the packet (the clock ran at rate 1 between packets)`, `${t2}, expected ${want2}`);
            check(Number.isFinite(t2) && t2 >= 13000, '2: the bot\'s clock reached 13000 (the night of the game, past the dusk of 12700)', String(t2));
            check(n2 >= EVENTS_MIN && n2 <= EVENTS_MAX, `2: the \`time\` event fired ${EVENTS_MIN} to ${EVENTS_MAX} times in 30 s without a packet (8.1.2: at most once per 20 ticks, only when the fields changed)`, `${n2} events`);
            check(st2.ok && st2.time !== null && Math.abs(st2.time - want2) <= TOLERANCE + 20 && st2.phase === 'Night', `2: the watch \`state\` says \`(Night)\` with \`Time N\` within ${TOLERANCE} of the expected`, `${st2.time} (${st2.phase}), expected ${want2}`);

            // ---------------------------------------------------------- 3. the night event of the watch
            const before3 = await rpc(port, TOKEN, 'events');
            await server.time(LATER_TICKS, 1);
            const tLater = Date.now();
            const t3a = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 2000) { const t = bot.time?.timeOfDay; if (Number.isFinite(t) && Math.abs(t - LATER_TICKS) <= 40) return t; await sleep(20); } return bot.time?.timeOfDay; })();
            note(`3: the server sent update_time ${LATER_TICKS}; the bot's clock ${t3a} ${((Date.now() - tLater) / 1000).toFixed(2)} s later; the events before ${JSON.stringify(before3.text.slice(-200))}`);
            check(Number.isFinite(t3a) && Math.abs(t3a - LATER_TICKS) <= 40, `3: the second packet set the bot's clock to ${LATER_TICKS} (within 40 ticks)`, String(t3a));
            let eventsText = '';
            const t0 = Date.now();
            let fired = false;
            while (Date.now() - t0 < 20000) {
                const res = await rpc(port, TOKEN, 'events');
                eventsText = res.text;
                if (NIGHT_AWAKE.test(eventsText)) { fired = true; break; }
                await sleep(1000);
            }
            const t3 = bot.time?.timeOfDay;
            note(`3: ${((Date.now() - tLater) / 1000).toFixed(1)} s after the second packet the bot's clock is ${t3}; the watch events ${JSON.stringify(eventsText.split('\n').slice(-4))}`);
            check(fired, '3: within 20 s of a packet with 22900 the watch `events` lists `night_awake: The night passed without sleep.` (the clock passed 23000 by itself, between packets)', JSON.stringify(eventsText.slice(-300)));

            const inLogs = logs.some((l) => String(l).includes(TOKEN));
            check(!inLogs, 'the watch token is in no console line of the agent', inLogs ? 'HAS it' : 'no');
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await server.stop();
        }
    },
});
exitSoon();
