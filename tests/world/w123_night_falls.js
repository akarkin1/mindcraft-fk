// W123 the night falls (v0.1.4.14 fix round, part 8, tester T3; SPEC 8.1 and 8.10, DECISIONS P-17, the play of 2026-11-09):
// the bot's clock runs with the server's on 26.1. The server of 26.1 sends `update_time` rarely (login, sleep, a time
// change), with the clock of the dimension (totalTicks, rate); mineflayer 4.39.0 advances the clocks every physics tick
// but recomputes `bot.time.timeOfDay` only in the packet handler, so between packets the bot's clock stands still: the
// owner's bot showed "Time 6490 (day)" at 03:30 and refused `!goToBed` four times ("Still daytime").
//
// This scenario cannot fail "before" on the dedicated jar: the dedicated 26.1 test server sends `update_time` every 20
// ticks when the cycle runs, as 1.21.8 did (the run against 2c368e7: 62 packets in 60 s, the bot's clock stepped 12000,
// 12100, 12199, ..., 8 to 20 ticks behind the server), so with the packets flowing the unpatched clock follows the server
// and parts A to D pass; the owner's integrated server is the one that sends the packet rarely (P-17), and the end-to-end
// scenario night_falls (tests/e2e, one packet at login) is the one that fails before the fix and passes after. W123 is the
// proof on a real server that the bot's clock is not frozen: it follows the server within the 100 ticks of 8.10 (the fix
// gives 0 to 1 on a quiet machine) and `time set` lands within 1 s. Under load (another world runner on the same machine,
// 4 runs of the fix) the packets arrive late and each sets the clock back by its lag, which is the server's truth at the
// time it was sent, not a defect: one run ended 64 ticks behind after 60 s while the quiet part of the same run was 1 tick
// off; hence 100, not tighter. Part E plays the owner's quiet server all the same, by dropping the packets at the client
// for 30 s: against 2c368e7 it fails (the bot's clock stands at 12000 while the server's runs), with the fix it passes.
//
// The base world (the house with its red bed), the owner's switches (SUPERVISION_SETTINGS) with the watch server on, the
// modes of his profile, an empty memory. The bot stands in the house 3 blocks from the bed, the player beside it; the
// bot is never moved by the control after the start, except to the pool of part F. The console commands keep the names
// of 1.21.8, which the harness translates (`gamerule doDaylightCycle true` is `advance_time`, `time query daytime` the
// timeline of the day).
//   A. The daylight cycle on, `time set 12000`, nobody sleeps. For 60 s the clocks are sampled every 5 s (TRACE: the
//      server's `time query daytime`, the bot's `bot.time.timeOfDay`, the `time` events counted). After 60 s: the
//      server's clock advanced (the cycle runs: 1000 ticks or more); the bot's clock is within 100 ticks of the server's;
//      the watch `state` says `Time N` within 100 of the server's; the `time` event fired 20 to 130 times (8.1.2: on
//      every packet and, between packets, at most once per 20 ticks when the fields changed: the test server sends a
//      packet every 20 ticks, so about 60 of each, 111 seen); the typed `!stats` says `Time: Night` and `It is night.`.
//   B. At 13000 and more: the player asks "is it night?", the fake model answers `!stats` (as the owner's model does):
//      the result in the history says `Time: Night`. Then the typed `!goToBed` is not refused as daytime: within 60 s the
//      bot lies in the bed (server, `sleeping_pos`); before the fix the bot's clock stands at 12000 ("soon"), it waits
//      40 s at the bed and answers `I cannot sleep now, it is not night.`. The night cannot pass (the player is awake,
//      players_sleeping_percentage 100), so `!stop` gets the bot up (as W107) and the answer of `!goToBed` is read: it
//      holds neither "it is day" nor "it is not night".
//   C. `time set 1000` sets the bot's clock within 1 s: within 100 ticks of the server's (the packet of a time change).
//   E. A quiet server (the owner's, P-17): `time set 12000` once more, its packet reaches the bot; then the harness drops
//      every `update_time` at the client for 30 s while the cycle runs. After 30 s the bot's clock is within 100 ticks of
//      the server's (about 12600: it ran with the rate of the clock, 8.1.1) and the `time` event fired 20 to 45 times
//      (8.1.2). Then the packets flow again and the clock is within 100 ticks of the server's 3 s later.
//   F. The boat (the owner's exact case, found by E1): on 26.1 the per-second `update_time` carries only the age, the clock
//      state comes with the login and a `time set`, and mineflayer advanced the clock on physicsTick, which stops while the
//      bot rides. The control makes a pool of 3 x 3 water beside the house, stands the bot at its edge and summons an oak
//      boat on it; the bot boards it (typed `!boardBoat()` of this round; `!useOn("hand", "oak_boat")` when that is not a
//      command yet; bot.mount through the harness as the last resort); the cycle on, `time set 12000` (the last clock
//      packet), 30 s: the bot's clock is within 100 ticks of the server's (before the fix it froze at the value of the set:
//      E1 measured 613 ticks behind after 30 s) and the watch `state` says so too; then the bot leaves the boat
//      (`!leaveBoat()`, else bot.dismount).
//   D. The cycle off again (`gamerule doDaylightCycle false`): 3 s later the bot's clock stands still with the server's.
// Throughout: the process lives, no request reached a real model, the token is in no console line.
import crypto from 'node:crypto';
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, serverSleeping, placeBot,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER, freePort } from './journey.js';
import { Supervisor } from './supervisor.js';

const NAME = 'w_night';
const SUPERVISOR = 'Opus';
const TAG = 'mcw';
const S = (p) => `${p.x} ${p.y} ${p.z}`;
const CLOCK_TOLERANCE = 100; // ticks (5 s of the game, SPEC 8.10): "not frozen"; the fix gives 0 to 1 on a quiet machine, late packets under load up to 64
const WATCH_MS = 60000;
const EVENTS_MIN = 20; // the `time` events of 60 s with the cadence of 8.1.2: one per packet (every 20 ticks on the test
const EVENTS_MAX = 130; // server) and at most one per 20 ticks between them, so up to about 120; a quiet server gives 60
const REFUSED_AS_DAY = /I cannot sleep now, it is day|it is not night|Still daytime/;
const STATE_TIME = /\bTime (\d+|\?) \((\w+)\)/;

// The server's time of day: `time query daytime` (the harness gives the answer of 26.1 in the old words, `The time is N`).
async function dayTime() {
    const out = await command('time query daytime');
    const m = /The time is (-?\d+)/.exec(out.join(' '));
    return m ? ((Number(m[1]) % 24000) + 24000) % 24000 : null;
}

// The server's and the bot's clock, read as close together as the console allows: { server, bot, diff }.
async function clocks(agent) {
    const server = await dayTime();
    const bot = agent.bot.time?.timeOfDay ?? null;
    const diff = server === null || !Number.isFinite(bot) ? null : Math.abs(((bot - server) % 24000 + 24000) % 24000);
    return { server, bot, diff: diff === null ? null : Math.min(diff, 24000 - diff) };
}

// Counts the `time` events of the bot and the custom events of agent.js (sunrise, noon, sunset, midnight).
function countTimeEvents(bot) {
    const counts = { time: 0, sunrise: 0, noon: 0, sunset: 0, midnight: 0 };
    const listeners = Object.keys(counts).map((name) => {
        const fn = () => { counts[name]++; };
        bot.on(name, fn);
        return [name, fn];
    });
    return { counts, stop() { for (const [name, fn] of listeners) bot.removeListener(name, fn); return counts; } };
}

const within = (d) => d !== null && d <= CLOCK_TOLERANCE;

// The harness plays the owner's quiet server (P-17): the `update_time` packets of the client are passed to the listeners
// of mineflayer while the gate is open and dropped while it is closed. restore() puts the listeners back as they were.
function packetGate(bot) {
    const client = bot._client;
    const listeners = client.listeners('update_time');
    client.removeAllListeners('update_time');
    let open = true;
    let dropped = 0;
    const gate = (...args) => { if (open) { for (const l of listeners) l(...args); } else { dropped++; } };
    client.on('update_time', gate);
    return {
        close() { open = false; },
        openUp() { open = true; },
        get dropped() { return dropped; },
        restore() { client.removeListener('update_time', gate); for (const l of listeners) client.on('update_time', l); },
    };
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const h = b.house;
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the environment of the agent, which runs in this process; never printed
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server', String(port));
        const sup = new Supervisor({ url: `http://127.0.0.1:${port}/mcp`, token: TOKEN, name: SUPERVISOR });
        let agent = null, orders = null, s = null, events = null, gate = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: h.home, playerAt: { x: h.home.x + 2, y: g + 1, z: h.home.z }, kit: [],
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            check(agent.bot.registry.version.minecraftVersion === '26.1', 'precondition: the bot plays Minecraft 26.1', agent.bot.registry.version.minecraftVersion);
            const at0 = await entityPos(NAME);
            check(inBox(at0, h.interior), 'precondition: the bot stands in the house beside its bed', fmt(at0));
            events = countTimeEvents(agent.bot);
            const stateOf = async () => {
                const res = await sup.call('state');
                const m = STATE_TIME.exec(res.text);
                return { ok: res.ok, text: res.text, time: m && m[1] !== '?' ? Number(m[1]) : null, phase: m ? m[2] : null };
            };

            // ====================================================== A. the cycle on, nobody sleeps
            const set = await commands(['gamerule doDaylightCycle true', 'time set 12000']);
            const t0 = Date.now();
            const c0 = await clocks(agent);
            note(`A0: the console answered ${JSON.stringify(set.flat())}; right after: the server ${c0.server}, the bot ${c0.bot}, the bot's doDaylightCycle ${agent.bot.time?.doDaylightCycle}, its clocks ${JSON.stringify(agent.bot.time?.clocks ?? null)}`);
            check(c0.server !== null && c0.server >= 12000 && c0.server < 12200 && within(c0.diff), 'A0: precondition: `time set 12000` set both clocks (the packet of a time change)', `server ${c0.server}, bot ${c0.bot}`);
            const samples = [];
            while (Date.now() - t0 < WATCH_MS) {
                const c = await clocks(agent);
                samples.push({ t: (Date.now() - t0) / 1000, ...c, events: events.counts.time, sleeping: agent.bot.isSleeping === true });
                console.log(`TRACE t=${samples[samples.length - 1].t.toFixed(1)}s server ${c.server} bot ${c.bot} diff ${c.diff} time-events ${events.counts.time} sleeping ${agent.bot.isSleeping === true}`);
                await sleep(Math.min(5000, Math.max(0, WATCH_MS - (Date.now() - t0))));
            }
            const cA = await clocks(agent);
            const st = await stateOf();
            const nA = { ...events.counts };
            note(`A: after ${((Date.now() - t0) / 1000).toFixed(1)} s the server's clock is ${cA.server} (from ${c0.server}), the bot's ${cA.bot}, ${cA.diff} ticks apart; the watch state ${JSON.stringify(st.text.split('\n')[0])}; the events ${JSON.stringify(nA)}; nobody slept: ${samples.every((x) => !x.sleeping)}`);
            check(cA.server !== null && c0.server !== null && cA.server - c0.server >= 1000, 'A1: precondition: the daylight cycle runs on the server (1000 ticks or more in 60 s)', `${c0.server} -> ${cA.server}`);
            check(within(cA.diff), `A2: after 60 s the bot's clock (bot.time.timeOfDay, what !stats and the sleep read) is within ${CLOCK_TOLERANCE} ticks of the server's \`time query daytime\``, `server ${cA.server}, bot ${cA.bot}, ${cA.diff} ticks apart`);
            check(st.ok && st.time !== null && cA.server !== null && Math.abs(st.time - cA.server) <= CLOCK_TOLERANCE + 40, `A3: the watch \`state\` says \`Time N\` within ${CLOCK_TOLERANCE} ticks of the server's (40 more for the second round trip)`, `state ${st.time} (${st.phase}), server ${cA.server}`);
            check(nA.time >= EVENTS_MIN && nA.time <= EVENTS_MAX, `A4: the \`time\` event fired ${EVENTS_MIN} to ${EVENTS_MAX} times in 60 s (8.1.2: on every packet, here one every 20 ticks, and between packets at most once per 20 ticks, only when the fields changed)`, `${nA.time} events`);
            const stats = await orders.order('!stats', 20000);
            note(`A5: the typed !stats answered ${JSON.stringify(stats.split('\n').filter((l) => /Time|night/i.test(l)))}`);
            check(/- Time: Night/.test(stats) && /It is night\./.test(stats), 'A5: the typed `!stats` says `Time: Night` and `It is night.` (the label of the server\'s time, 12000 and more)', JSON.stringify(stats.slice(0, 300)));

            // ====================================================== B. "is it night?" and the bed at 13000 and more
            const night = await waitFor(async () => ((await dayTime()) ?? 0) >= 13000, { ms: 60000, every: 1000 });
            const cB = await clocks(agent);
            note(`B0: the server's clock ${cB.server} (${night.ok ? 'night' : 'NOT yet 13000'}), the bot's ${cB.bot}`);
            check(night.ok, 'B0: precondition: the server\'s clock reached 13000 (the night of the game)', String(cB.server));
            const addedFrom = s.added.length;
            const tB = Date.now();
            s.route(new RegExp(`^${PLAYER}: is it night\\?$`), '!stats');
            orders.say('is it night?');
            const answered = await waitFor(() => s.added.slice(addedFrom).find((a) => a.name === 'system' && /- Time: (Morning|Afternoon|Night)/.test(a.content)) ?? null, { ms: 30000, every: 200 });
            const statsB = answered.value?.content ?? '';
            const cB1 = await clocks(agent);
            note(`B1: "is it night?" -> the fake model's !stats; its result in the history ${answered.ok ? `after ${(answered.ms / 1000).toFixed(1)} s: ${JSON.stringify(statsB.split('\n').filter((l) => /Time|night/i.test(l)))}` : 'did NOT come within 30 s'}; the server ${cB1.server}, the bot ${cB1.bot}`);
            check(answered.ok && /- Time: Night/.test(statsB) && /It is night\./.test(statsB), 'B1: at 13000 and more "is it night?" is answered with the night: the `!stats` result says `Time: Night` and `It is night.`', answered.ok ? JSON.stringify(statsB.slice(0, 200)) : 'no result');
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            const tBed = Date.now();
            const bed = orders.orderInfo('!goToBed', 150000);
            const asleep = await waitFor(() => serverSleeping(NAME), { ms: 60000, every: 500 });
            const cBed = await clocks(agent);
            const saidBed = saidLines(s, tBed);
            note(`B2: !goToBed typed at server ${cB1.server}: the bot ${asleep.ok ? `lies in the bed after ${(asleep.ms / 1000).toFixed(1)} s` : 'does NOT lie in the bed within 60 s'} at ${fmt(await entityPos(NAME))}; the clocks now: server ${cBed.server}, bot ${cBed.bot}; the bot said ${JSON.stringify(saidBed.slice(0, 8))}`);
            check(asleep.ok, 'B2: at 13000 and more the typed `!goToBed` is not refused as daytime: within 60 s the bot lies in the bed (server)', asleep.ok ? `${(asleep.ms / 1000).toFixed(1)} s` : `not in bed; said ${JSON.stringify(saidBed.slice(0, 4))}`);
            // the night cannot pass with the player awake (players_sleeping_percentage 100): !stop gets the bot up, as W107
            let bedInfo = null;
            if (asleep.ok) {
                await sleep(2000);
                const stop = await orders.order('!stop', 10000);
                const up = await waitFor(async () => !(await serverSleeping(NAME)), { ms: 10000, every: 250 });
                bedInfo = await Promise.race([bed, sleep(20000).then(() => null)]);
                note(`B2: !stop answered ${JSON.stringify(stop.slice(0, 120))}; out of the bed ${up.ok ? `after ${(up.ms / 1000).toFixed(1)} s` : 'NOT within 10 s'}; !goToBed answered ${bedInfo ? JSON.stringify(bedInfo.reply.slice(0, 200)) : '(no answer within 20 s of the stop)'}`);
            } else {
                bedInfo = await Promise.race([bed, sleep(60000).then(() => null)]);
                note(`B2: !goToBed answered ${bedInfo ? `after ${((Date.now() - tBed) / 1000).toFixed(0)} s: ${JSON.stringify(bedInfo.reply.slice(0, 200))}` : '(still running 120 s after the order)'}`);
                if (!bedInfo) note(`B2: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            }
            const replyB = String(bedInfo?.reply ?? '');
            check(!REFUSED_AS_DAY.test(replyB) && !saidBed.some((l) => REFUSED_AS_DAY.test(l)), 'B2: the answer of `!goToBed` (and nothing the bot said) refuses the bed as daytime: no "it is day", no "it is not night"', JSON.stringify([replyB.slice(0, 120), ...saidBed.filter((l) => REFUSED_AS_DAY.test(l)).slice(0, 2)]));
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });

            // ====================================================== C. time set 1000
            const nC0 = events.counts.time;
            const setC = await command('time set 1000');
            const tC = Date.now();
            const got = await waitFor(() => { const t = agent.bot.time?.timeOfDay; return Number.isFinite(t) && t >= 900 && t <= 1200 ? t : null; }, { ms: 1000, every: 25 });
            const cC = await clocks(agent);
            note(`C: \`time set 1000\` answered ${JSON.stringify(setC)}; the bot's clock ${got.ok ? `was ${got.value} after ${got.ms} ms` : `is ${agent.bot.time?.timeOfDay} after 1 s (NOT set)`}; now server ${cC.server}, bot ${cC.bot}; ${events.counts.time - nC0} time events since`);
            check(got.ok && within(cC.diff), `C1: \`time set 1000\` sets the bot's clock within 1 s (within ${CLOCK_TOLERANCE} ticks of the server's)`, `${got.ok ? `${got.value} after ${got.ms} ms` : 'not within 1 s'}; server ${cC.server}, bot ${cC.bot}`);
            const stC = await stateOf();
            check(stC.ok && stC.time !== null && Math.abs(stC.time - (cC.server ?? -1e9)) <= CLOCK_TOLERANCE + 40, 'C2: the watch `state` follows the time change', `state ${stC.time} (${stC.phase}), server ${cC.server}`);

            // ====================================================== E. a quiet server: the packets dropped for 30 s
            gate = packetGate(agent.bot);
            const setE = await command('time set 12000');
            const gotE = await waitFor(() => { const t = agent.bot.time?.timeOfDay; return Number.isFinite(t) && t >= 11990 && t <= 12100 ? t : null; }, { ms: 2000, every: 25 });
            gate.close();
            const tE = Date.now();
            const nE0 = events.counts.time;
            const e0 = await clocks(agent);
            note(`E0: \`time set 12000\` answered ${JSON.stringify(setE)}; the packet reached the bot (${gotE.ok ? `${gotE.value} after ${gotE.ms} ms` : 'NOT within 2 s'}); from now every update_time is dropped at the client; server ${e0.server}, bot ${e0.bot}`);
            check(gotE.ok && within(e0.diff), 'E0: precondition: the packet of `time set 12000` reached the bot before the gate closed', `server ${e0.server}, bot ${e0.bot}`);
            while (Date.now() - tE < 30000) {
                const c = await clocks(agent);
                console.log(`TRACE quiet t=${((Date.now() - tE) / 1000).toFixed(1)}s server ${c.server} bot ${c.bot} diff ${c.diff} time-events ${events.counts.time - nE0} dropped ${gate.dropped}`);
                await sleep(Math.min(5000, Math.max(0, 30000 - (Date.now() - tE))));
            }
            const e1 = await clocks(agent);
            const nE = events.counts.time - nE0;
            const stE = await stateOf();
            note(`E1: after 30 s without a packet (${gate.dropped} dropped) the server's clock is ${e1.server}, the bot's ${e1.bot}, ${e1.diff} ticks apart; ${nE} time events; the watch state ${JSON.stringify(stE.text.split('\n')[0])}`);
            check(gate.dropped >= 20, 'E1: precondition: the server sent packets meanwhile that the harness dropped (20 or more in 30 s)', `${gate.dropped} dropped`);
            check(within(e1.diff), `E2: with no packet for 30 s the bot's clock ran with the rate of the clock (8.1.1): within ${CLOCK_TOLERANCE} ticks of the server's`, `server ${e1.server}, bot ${e1.bot}, ${e1.diff} ticks apart`);
            check(nE >= EVENTS_MIN && nE <= 45, `E3: the \`time\` event fired ${EVENTS_MIN} to 45 times in the 30 s without a packet (8.1.2: at most once per 20 ticks, only when the fields changed)`, `${nE} events`);
            check(stE.ok && stE.time !== null && e1.server !== null && Math.abs(stE.time - e1.server) <= CLOCK_TOLERANCE + 40, 'E4: the watch `state` follows the running clock without packets', `state ${stE.time} (${stE.phase}), server ${e1.server}`);
            gate.restore();
            gate = null;
            await sleep(3000);
            const e2 = await clocks(agent);
            note(`E5: 3 s after the packets flow again: server ${e2.server}, bot ${e2.bot}, ${e2.diff} ticks apart`);
            check(within(e2.diff), `E5: with the packets flowing again the bot's clock is within ${CLOCK_TOLERANCE} ticks of the server's`, `server ${e2.server}, bot ${e2.bot}`);

            // ====================================================== F. the boat (the owner's case)
            await commands(['gamerule doDaylightCycle false']);
            const pool = { min: { x: h.box.max.x + 4, y: g, z: h.box.min.z - 10 }, max: { x: h.box.max.x + 6, y: g, z: h.box.min.z - 8 } };
            const poolEdge = { x: pool.min.x - 1, y: g + 1, z: pool.min.z + 1 };
            await commands([`fill ${S(pool.min)} ${S(pool.max)} minecraft:water`, `kill @e[tag=${TAG}_boat]`]);
            await placeBot(agent, poolEdge, -90); // the control stands the bot at the west edge of the pool, looking east over it
            const boatAt = { x: pool.min.x + 1.5, y: g + 1, z: pool.min.z + 1.5 };
            const summoned = await command(`summon minecraft:oak_boat ${boatAt.x} ${boatAt.y} ${boatAt.z} {Tags:["${TAG}","${TAG}_boat"]}`);
            const seenBoat = await waitFor(() => Object.values(agent.bot.entities).find((e) => e?.name === 'oak_boat') ?? null, { ms: 8000, every: 100 });
            const isWater = await commands([`execute if block ${S({ x: pool.min.x + 1, y: g, z: pool.min.z + 1 })} minecraft:water`]);
            note(`F0: the pool ${S(pool.min)} to ${S(pool.max)} (${isWater.flat().join(' ')}); ${JSON.stringify(summoned)}; the bot sees the boat: ${seenBoat.ok}; the bot at ${fmt(await entityPos(NAME))}`);
            check(seenBoat.ok, 'F0: precondition: an oak boat floats on the pool beside the bot (seen by it)', JSON.stringify(summoned));
            // boarding: !boardBoat() of this round when it is a command, else !useOn("hand", "oak_boat"), else bot.mount by the harness
            let board = await orders.order('!boardBoat()', 30000);
            if (/is not a command|does not exist/.test(board)) board = `${board} -> !useOn: ${await orders.order('!useOn("hand", "oak_boat")', 30000)}`;
            let mounted = await waitFor(() => Boolean(agent.bot.vehicle), { ms: 10000, every: 100 });
            if (!mounted.ok && seenBoat.value) {
                try { await agent.bot.mount(seenBoat.value); } catch (e) { board += ` -> bot.mount threw ${e?.message ?? e}`; }
                mounted = await waitFor(() => Boolean(agent.bot.vehicle), { ms: 5000, every: 100 });
                board += ' -> bot.mount by the harness';
            }
            const riding = await command(`data get entity ${NAME} RootVehicle`);
            const inBoat = riding.some((l) => /has the following entity data/.test(l));
            note(`F0: boarding answered ${JSON.stringify(board.slice(0, 240))}; bot.vehicle ${agent.bot.vehicle?.name ?? 'none'}; the server's RootVehicle of the bot: ${JSON.stringify(riding.join(' ').slice(0, 120))}`);
            check(mounted.ok && inBoat, 'F0: precondition: the bot sits in the boat (bot.vehicle, and RootVehicle on the server)', `vehicle ${agent.bot.vehicle?.name ?? 'none'}, server ${inBoat}`);
            if (mounted.ok && inBoat) {
                const nF0 = events.counts.time;
                const setF = await commands(['gamerule doDaylightCycle true', 'time set 12000']);
                const tF = Date.now();
                const f0 = await clocks(agent);
                note(`F1: in the boat, the cycle on: ${JSON.stringify(setF.flat())}; server ${f0.server}, bot ${f0.bot}`);
                check(f0.server !== null && f0.server >= 12000 && f0.server < 12200 && within(f0.diff), 'F1: precondition: `time set 12000` reached the bot in the boat (the last clock packet)', `server ${f0.server}, bot ${f0.bot}`);
                while (Date.now() - tF < 30000) {
                    const c = await clocks(agent);
                    console.log(`TRACE boat t=${((Date.now() - tF) / 1000).toFixed(1)}s server ${c.server} bot ${c.bot} diff ${c.diff} time-events ${events.counts.time - nF0} vehicle ${agent.bot.vehicle?.name ?? 'none'}`);
                    await sleep(Math.min(5000, Math.max(0, 30000 - (Date.now() - tF))));
                }
                const f1 = await clocks(agent);
                const nF = events.counts.time - nF0;
                const stF = await stateOf();
                const stillIn = Boolean(agent.bot.vehicle);
                note(`F2: after 30 s in the boat the server's clock is ${f1.server}, the bot's ${f1.bot}, ${f1.diff} ticks apart; ${nF} time events; still in the boat ${stillIn}; the watch state ${JSON.stringify(stF.text.split('\n')[0])}`);
                check(stillIn, 'F2: precondition: the bot still sits in the boat after 30 s', String(agent.bot.vehicle?.name ?? 'none'));
                check(within(f1.diff), `F2: in the boat for 30 s with the cycle on, the bot's clock is within ${CLOCK_TOLERANCE} ticks of the server's (before the fix it froze at the value of the set: physicsTick stops while the bot rides)`, `server ${f1.server}, bot ${f1.bot}, ${f1.diff} ticks apart`);
                check(nF >= EVENTS_MIN, `F3: the \`time\` event fired ${EVENTS_MIN} times or more in the 30 s in the boat`, `${nF} events`);
                check(stF.ok && stF.time !== null && f1.server !== null && Math.abs(stF.time - f1.server) <= CLOCK_TOLERANCE + 40, 'F4: the watch `state` follows the clock in the boat', `state ${stF.time} (${stF.phase}), server ${f1.server}`);
                let leave = await orders.order('!leaveBoat()', 20000);
                if (/is not a command|does not exist/.test(leave)) { try { agent.bot.dismount(); } catch (e) { leave += ` (dismount threw ${e?.message ?? e})`; } leave += ' -> bot.dismount by the harness'; }
                const out = await waitFor(() => !agent.bot.vehicle, { ms: 10000, every: 100 });
                const ridingAfter = await command(`data get entity ${NAME} RootVehicle`);
                const stillRiding = ridingAfter.some((l) => /has the following entity data/.test(l));
                note(`F5: leaving the boat answered ${JSON.stringify(leave.slice(0, 200))}; out of the boat ${out.ok ? `after ${(out.ms / 1000).toFixed(1)} s` : 'NOT within 10 s'} (bot.vehicle ${agent.bot.vehicle?.name ?? 'none'}; the server: ${stillRiding ? 'still riding' : 'out'}); the bot at ${fmt(await entityPos(NAME))}`);
                check(/I left the boat\./.test(leave) && out.ok && !stillRiding, 'F5: `!leaveBoat()` answers `I left the boat.` (8.4, P-28) and the bot is out of the boat within 10 s (bot.vehicle and the server\'s RootVehicle)', `${JSON.stringify(leave.slice(0, 100))}; vehicle ${agent.bot.vehicle?.name ?? 'none'}, server riding ${stillRiding}`);
                if (stillRiding) {
                    await commands([`kill @e[tag=${TAG}_boat]`]);
                    await waitFor(() => !agent.bot.vehicle, { ms: 5000, every: 100 });
                    note(`F5: the harness took the boat away (the bot could not leave it); bot.vehicle ${agent.bot.vehicle?.name ?? 'none'}`);
                }
            }
            await commands([`kill @e[tag=${TAG}_boat]`]);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });

            // ====================================================== D. the cycle off again
            await commands(['gamerule doDaylightCycle false']);
            await sleep(1500);
            const d0 = await clocks(agent);
            await sleep(3000);
            const d1 = await clocks(agent);
            note(`D: the cycle off: the server ${d0.server} -> ${d1.server} in 3 s, the bot ${d0.bot} -> ${d1.bot}; the bot's doDaylightCycle ${agent.bot.time?.doDaylightCycle}; the events ${JSON.stringify(events.counts)}`);
            check(d1.server === d0.server && d1.bot === d0.bot && within(d1.diff), 'D1: with the cycle off the bot\'s clock stands still with the server\'s (rate 0)', `server ${d0.server} -> ${d1.server}, bot ${d0.bot} -> ${d1.bot}`);
            check(agent.bot.time?.doDaylightCycle === false, 'D2: bot.time.doDaylightCycle is false with the cycle off (the rate of the clock is 0)', String(agent.bot.time?.doDaylightCycle));

            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            check(!inLogs, 'the watch token is in no console line of the agent', inLogs ? 'HAS it' : 'no');
            note(`the supervisor made ${sup.summary()}; the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 12))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (gate) gate.restore();
            if (events) events.stop();
            await commands(['gamerule doDaylightCycle false', 'time set 6000', `kill @e[tag=${TAG}_boat]`]).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
