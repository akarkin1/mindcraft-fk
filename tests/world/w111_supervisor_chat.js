// W111 the supervisor in the chat (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 1.11 and 1.12, SPEC section 1
// and 4.5): one channel, two names. A line that names the supervisor is a `message` event for the supervisor and
// nothing a bot answers; the supervisor's `reply` is relayed into the chat as `[Opus] ...`; an unprompted `update` is
// relayed only with supervisor_updates on and never between the owner's line and the bot's answer; without a supervisor
// the bot says so. Today (v0.1.4.12) there is no supervisor_name, no `wait`, no `reply`: the scenario fails at the
// check that the supervisor's `wait event` got the message.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches of v0.1.4.12 with watch_server on and a free port, the switches of this release with supervisor_name "Opus"
// and supervisor_updates on (SUPERVISION_SETTINGS; the phase `updates_off` has it off), the modes of his profile, an
// empty memory. The random token of the harness is in the environment of the agent (never printed); the supervisor
// (tests/world/supervisor.js) runs in this process. The bot stands in the house; it is never moved by the control. The
// fake model answers every line of the player with one line (`I am here.`), 1.5 s after it is asked (a model takes its
// time), so a bot that is asked about a line meant for the supervisor would show it.
//   1. The supervisor calls `wait event` (it is connected). The player says "Opus, where is it?": no bot line within
//      10 s (and no request to the bot's model); the `wait` woke with the event (`Woke: event.`) and its text holds
//      `Message: "where is it?"`.
//   2. The supervisor calls `reply "It is in the tunnel."`: the player hears `[Opus] It is in the tunnel.` from the bot
//      within 10 s, and no bot answered it (no further bot line, no request to the model, in the 10 s after).
//   3. The player says "where are you?" and 300 ms later, while the bot is answering, the supervisor sends an update
//      (`reply` of kind `update`, "The mining is at 2 of 6."): the player hears the bot's answer and then the update,
//      in that order, within 20 s; the update never comes between the order and the answer.
//   4. No call of the supervisor for 60 s (the presence lapses). The player says "Opus, hello": within 10 s exactly one
//      line of the bot, `The supervisor is not here.`, and no other line in the 10 s after.
//   5. Phase `updates_off`: a fresh bot with supervisor_updates off (the default): the same update answers `Updates are
//      off.` and nothing appears in the chat within 5 s.
// Throughout: the token is in no console line and in no text of the supervisor; the process lives; no request
// reached a real model.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, fmt, sleep, waitFor, heardFrom, entityPos, runPhase } from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, PLAYER, saidLines, SUPERVISION_SETTINGS, freePort } from './journey.js';
import { Supervisor } from './supervisor.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_opusbot';
const NAME_OFF = 'w_opusoff';
const SUPERVISOR = 'Opus';
const QUESTION = 'Opus, where is it?';
const MESSAGE = 'Message: "where is it?"';
const REPLY = 'It is in the tunnel.';
const RELAYED = `[${SUPERVISOR}] ${REPLY}`;
const UPDATE = 'The mining is at 2 of 6.';
const RELAYED_UPDATE = `[${SUPERVISOR}] ${UPDATE}`;
const UPDATES_OFF = 'Updates are off.';
const NOT_HERE = 'The supervisor is not here.';
const BOT_LINE = 'I am here.';
const MODEL_MS = 1500;

// The fake model of the bot: one line for every line of the player, after MODEL_MS (see the head of the file).
function slowOneLineModel(s) {
    const chat = s.chat;
    const send = chat.sendRequest;
    chat.sendRequest = async function oneLine(turns, systemMessage) {
        const last = Array.isArray(turns) && turns.length ? String(turns[turns.length - 1].content) : '';
        if (new RegExp(`^${PLAYER}: `).test(last) || last.includes(PLAYER)) {
            chat.requests.push({ kind: 'chat', prompt: String(systemMessage ?? ''), turns: [] });
            console.log(`MODEL chat: last turn ${JSON.stringify(last.slice(0, 120))} -> reply ${JSON.stringify(BOT_LINE)} after ${MODEL_MS} ms`);
            await sleep(MODEL_MS);
            return BOT_LINE;
        }
        return send.call(this, turns, systemMessage);
    };
    return chat;
}

// The watch server of a bot: a random token in the environment of the agent (never printed), a free port, the supervisor.
async function watchSetup(name) {
    const TOKEN = crypto.randomBytes(16).toString('hex');
    process.env.MC_WATCH_TOKEN = TOKEN;
    const port = await freePort();
    check(port !== null, 'precondition: a free port for the watch server in 8090..8190', String(port));
    const url = `http://127.0.0.1:${port}/mcp`;
    return { TOKEN, port, url, sup: new Supervisor({ url, token: TOKEN, name: SUPERVISOR }) };
}

function tokenChecks(s, sup, TOKEN) {
    const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
    const inSup = sup.calls.some((c) => c.text.includes(TOKEN));
    check(!inLogs && !inSup, 'the token is in no console line of the agent and in no text of the supervisor', `console ${inLogs ? 'HAS it' : 'no'}, supervisor ${inSup ? 'HAS it' : 'no'}`);
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const g = b.g;
        const h = b.house;
        const { TOKEN, port, sup } = await watchSetup(NAME);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: h.home, playerAt: { x: h.home.x + 2, y: g + 1, z: h.home.z }, kit: [['bread', 4]],
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port, supervisor_name: SUPERVISOR, supervisor_updates: true }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();
            note(`the watch port ${port}; the token is set in the environment of the agent (not printed); the bot at ${fmt(await entityPos(NAME))}`);
            const chat = slowOneLineModel(s);
            const requestsSince = (n) => chat.requests.length - n;
            await sleep(12000); // the agent is quiet after its start (checkAllPlayersPresent runs 10 s after a spawn)
            const botLines = (t) => s.chats.filter((c) => c.t >= t).map((c) => c.text);

            // ---------------------------------------------------------- 1. "Opus, where is it?"
            const n1 = chat.requests.length;
            const waiting = sup.wait({ for: 'event', timeout: 30 });
            await sleep(1500); // the wait is open before the line
            const t1 = Date.now();
            orders.say(QUESTION);
            const woke = await Promise.race([waiting, sleep(12000).then(() => null)]);
            await sleep(Math.max(0, 10000 - (Date.now() - t1)));
            const lines1 = botLines(t1);
            note(`1: "${QUESTION}": the wait ${woke ? `${woke.ok ? 'answered' : 'was REFUSED'} after ${woke.ms} ms: ${JSON.stringify(woke.text.slice(0, 300))}` : 'did not answer within 12 s'}; the bot said ${JSON.stringify(lines1)}; its model was asked ${requestsSince(n1)} time(s)`);
            check(lines1.length === 0, `1: no bot answers "${QUESTION}" (no bot line within 10 s)`, JSON.stringify(lines1));
            check(requestsSince(n1) === 0, '1: the line was not handed to the bot\'s model (the name is matched by code)', `${requestsSince(n1)} requests`);
            check(Boolean(woke) && woke.ok && woke.woke === 'event' && woke.text.includes(MESSAGE),
                `1: the supervisor's \`wait event\` got the message: \`Woke: event.\` and \`${MESSAGE}\``, woke ? JSON.stringify(woke.text.slice(0, 200)) : 'no answer');
            if (!woke) { const late = await waiting; note(`1: the wait answered later: ${JSON.stringify(late.text.slice(0, 200))}`); }

            // ---------------------------------------------------------- 2. reply
            const n2 = chat.requests.length;
            const t2 = Date.now();
            const rep = await sup.reply(REPLY);
            note(`2: reply ${JSON.stringify(REPLY)} answered ${rep.ok ? 'ok' : 'REFUSED'} after ${rep.ms} ms: ${JSON.stringify(rep.text.slice(0, 200))}`);
            const heard = await waitFor(() => heardFrom(orders.player, NAME, t2).find((l) => l.includes(RELAYED)) ?? null, { ms: 10000, every: 250 });
            await sleep(Math.max(0, 10000 - (Date.now() - t2)));
            const lines2 = botLines(t2);
            const others = lines2.filter((l) => !l.includes(RELAYED));
            note(`2: the player heard ${JSON.stringify(heardFrom(orders.player, NAME, t2))}; the bot's lines ${JSON.stringify(lines2)}; its model was asked ${requestsSince(n2)} time(s)`);
            check(rep.ok && heard.ok, `2: the bot relays the reply into the chat as \`${RELAYED}\` (the player hears it within 10 s)`, JSON.stringify(heardFrom(orders.player, NAME, t2)));
            check(others.length === 0 && requestsSince(n2) === 0, '2: no bot answered the supervisor\'s line (no further bot line and no request to the model in the 10 s after)', `${JSON.stringify(others)}, ${requestsSince(n2)} requests`);

            // ---------------------------------------------------------- 3. an update while the bot answers
            const t3 = Date.now();
            orders.say('where are you?');
            await sleep(300);
            const upd = await sup.update(UPDATE);
            note(`3: update ${JSON.stringify(UPDATE)} sent 300 ms after "where are you?" answered ${upd.ok ? 'ok' : 'REFUSED'} after ${upd.ms} ms: ${JSON.stringify(upd.text.slice(0, 200))}`);
            const both = await waitFor(() => {
                const h3 = orders.player.heard.filter((x) => x.from === NAME && x.t >= t3);
                return h3.some((x) => x.text.trim() === BOT_LINE) && h3.some((x) => x.text.includes(RELAYED_UPDATE)) ? h3 : null;
            }, { ms: 20000, every: 250 });
            // the chat of the server carries the bot's line with a trailing space: compared trimmed
            const h3 = orders.player.heard.filter((x) => x.from === NAME && x.t >= t3).map((x) => ({ text: x.text.trim(), at: ((x.t - t3) / 1000).toFixed(2) }));
            const iAnswer = h3.findIndex((x) => x.text === BOT_LINE);
            const iUpdate = h3.findIndex((x) => x.text.includes(RELAYED_UPDATE));
            note(`3: the player heard, in order: ${JSON.stringify(h3)}`);
            check(upd.ok && both.ok, `3: with supervisor_updates on the update is relayed as \`${RELAYED_UPDATE}\` and the bot's answer comes too, within 20 s`, JSON.stringify(h3));
            check(iAnswer >= 0 && iUpdate > iAnswer, '3: the update appears after the bot\'s answer, never between the order and the answer (nobody speaks over anybody)', `answer at ${iAnswer}, update at ${iUpdate}`);

            // ---------------------------------------------------------- 4. without a supervisor
            note('4: no call of the supervisor for 61 s');
            await sleep(61000);
            const t4 = Date.now();
            const n4 = chat.requests.length;
            orders.say('Opus, hello');
            const said = await waitFor(() => botLines(t4).find((l) => l === NOT_HERE) ?? null, { ms: 10000, every: 250 });
            await sleep(Math.max(0, 10000 - (Date.now() - t4)) + 10000);
            const lines4 = botLines(t4);
            note(`4: "Opus, hello" without a supervisor: the bot said ${JSON.stringify(lines4)} (${said.ok ? `the line after ${(said.ms / 1000).toFixed(1)} s` : 'not the line'}); the player heard ${JSON.stringify(heardFrom(orders.player, NAME, t4))}; the model was asked ${requestsSince(n4)} time(s)`);
            check(said.ok && lines4.length === 1 && lines4[0] === NOT_HERE, `4: "Opus, hello" with nobody connected gets exactly one line, \`${NOT_HERE}\`, from the bot, and no other line in the 10 s after`, JSON.stringify(lines4));
            check(heardFrom(orders.player, NAME, t4).some((l) => l.includes(NOT_HERE)), '4: the player heard it', JSON.stringify(heardFrom(orders.player, NAME, t4)));

            tokenChecks(s, sup, TOKEN);
            note(`the supervisor: ${sup.summary()}; the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 20))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
        }
        try {
            // ------------------------------------------------------ 5. supervisor_updates off (a phase: a fresh process)
            note('5: supervisor_updates off, a fresh bot in the house, the same update (phase "updates_off")');
            await runPhase(SELF, 'updates_off', {}, 120000);
        } finally {
            await releaseRegion(r);
        }
    },

    async updates_off() {
        const r = region(BASE_RADIUS);
        const b = basePlan(r, { owner: true, dump: loadDump() });
        const g = b.g;
        const h = b.house;
        const { TOKEN, port, sup } = await watchSetup(NAME_OFF);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME_OFF, b, {
                botAt: h.home, playerAt: { x: h.home.x + 2, y: g + 1, z: h.home.z }, kit: [['bread', 4]],
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port, supervisor_name: SUPERVISOR, supervisor_updates: false }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            slowOneLineModel(s);
            await sleep(12000);
            const t5 = Date.now();
            const upd = await sup.update(UPDATE);
            await sleep(5000);
            const lines5 = s.chats.filter((c) => c.t >= t5).map((c) => c.text);
            note(`5: the update answered ${upd.ok ? 'ok' : 'REFUSED'} after ${upd.ms} ms: ${JSON.stringify(upd.text.slice(0, 200))}; the bot said ${JSON.stringify(lines5)}; the player heard ${JSON.stringify(heardFrom(orders.player, NAME_OFF, t5))}`);
            check(upd.text.includes(UPDATES_OFF), `5: with supervisor_updates off the update answers \`${UPDATES_OFF}\``, JSON.stringify(upd.text.slice(0, 200)));
            check(lines5.length === 0 && heardFrom(orders.player, NAME_OFF, t5).length === 0, '5: nothing appears in the chat within 5 s', JSON.stringify(lines5));
            tokenChecks(s, sup, TOKEN);
            check(s.killed === null, '5: the process lives', String(s.killed));
            check(s.realCalls.length === 0, '5: no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
        }
    },
});
exitSoon();
