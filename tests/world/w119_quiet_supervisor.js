// W119 the quiet supervisor (v0.1.4.13 fix1; the play of 2026-10-05: 811 lines of the bot in the owner's chat in under
// two hours, 236 of them echoes of the supervisor's commands, 155 their results, 24 dumps of code; three kicks
// `chat_validation_failed` while generated code called bot.chat in a row; the process killed by the loop guard under a
// run of quick failures; `!stop` through run that answered `Ran 0 of 1`).
//
// The owner variant of the base, the switches of this release with watch_server on, supervisor_name "Opus", coding
// allowed, the modes of his profile, an empty memory. The scripted supervisor (tests/world/supervisor.js) runs in this
// process; the fake model answers the player's question with one line; the fake code model writes code that calls
// bot.chat three times. The bot stands in the house.
//   1. The supervisor runs 8 quick failures (`!craftRecipe("oak_planks", 1)` with no log) without the stop rule: the
//      answer has 8 lines; the player hears no line of the bot within 10 s; the process lives (no loop guard).
//   2. The supervisor runs `!newAction("tell me where you are")`; the code calls bot.chat three times: the answer
//      holds the code's lines; the player hears nothing within 10 s; the bot is still on the server (no kick).
//   3. The supervisor runs `!followPlayer` (a long skill: `started`), then `!stop`: the stop answers within 5 s with
//      `!stop: stopped`, the bot's action ends within 5 s; the player hears nothing.
//   4. The player asks "where are you?": the player hears the bot's answer within 15 s. The player types `!stats`: he
//      hears its result (his own command is said as before).
// Throughout: the process lives; no request reached a real model.
import crypto from 'node:crypto';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, fmt, sleep, waitFor, heardFrom, entityPos } from './helpers.js';
import { codeReply } from '../e2e/helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, PLAYER, SUPERVISION_SETTINGS, freePort } from './journey.js';
import { Supervisor } from './supervisor.js';

const NAME = 'w_quietbot';
const SUPERVISOR = 'Opus';
const BOT_LINE = 'I am here.';
const CODE = "await skills.wait(bot, 50); bot.chat('Position: in the house.'); bot.chat('Line 2 of the code.'); bot.chat('Line 3 of the code.'); log(bot, 'The code is done.');";

// The fake model: one line for every line of the player that is not a command.
function oneLineModel(s) {
    const chat = s.chat;
    const send = chat.sendRequest;
    chat.sendRequest = async function oneLine(turns, systemMessage) {
        const last = Array.isArray(turns) && turns.length ? String(turns[turns.length - 1].content) : '';
        if (new RegExp(`^${PLAYER}: (?!!)`).test(last)) {
            chat.requests.push({ kind: 'chat', prompt: String(systemMessage ?? ''), turns: [] });
            return BOT_LINE;
        }
        return send.call(this, turns, systemMessage);
    };
    return chat;
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const g = b.g;
        const h = b.house;
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN;
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server', String(port));
        const sup = new Supervisor({ url: `http://127.0.0.1:${port}/mcp`, token: TOKEN, name: SUPERVISOR });
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: h.home, playerAt: { x: h.home.x + 2, y: g + 1, z: h.home.z }, kit: [['bread', 4]],
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port, supervisor_name: SUPERVISOR, allow_insecure_coding: true }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            oneLineModel(s);
            note(`the watch port ${port}; the bot at ${fmt(await entityPos(NAME))}`);
            await sleep(12000); // the agent is quiet after its start
            const heard = (t) => heardFrom(orders.player, NAME, t);
            const onServer = () => Boolean(agent.bot?.entity) && agent.bot?._client?.ended !== true;

            // ---------------------------------------------------------- 1. 8 quick failures
            const t1 = Date.now();
            const quick = await sup.run(Array(8).fill('!craftRecipe("oak_planks", 1)'), false);
            await sleep(Math.max(0, 10000 - (Date.now() - t1)));
            note(`1: the run answered ${quick.ok ? 'ok' : 'REFUSED'} after ${quick.ms} ms: ${JSON.stringify(quick.text.slice(0, 400))}; the player heard ${JSON.stringify(heard(t1))}`);
            check(quick.ok && quick.text.split('\n').filter((l) => /^\d+\. !craftRecipe/.test(l)).length === 8, '1: the answer of the run has the 8 results', JSON.stringify(quick.text.slice(0, 200)));
            check(heard(t1).length === 0, '1: the player hears no line of the bot within 10 s (no echo, no result)', JSON.stringify(heard(t1)));
            check(s.killed === null, '1: the process lives: 8 quick failures of a run are no action loop', String(s.killed));

            // ---------------------------------------------------------- 2. code that calls bot.chat
            const t2 = Date.now();
            s.code.replies.push(codeReply(CODE));
            const coded = await sup.run(['!newAction("tell me where you are")']);
            await sleep(Math.max(0, 10000 - (Date.now() - t2)));
            note(`2: the run answered ${coded.ok ? 'ok' : 'REFUSED'} after ${coded.ms} ms: ${JSON.stringify(coded.text.slice(0, 400))}; the code model got ${s.code.requests.length} request(s); the player heard ${JSON.stringify(heard(t2))}`);
            check(s.code.requests.length >= 1, '2: precondition: the code model was asked', `${s.code.requests.length} requests`);
            check(coded.ok && coded.text.includes('Position: in the house.') && coded.text.includes('Line 3 of the code.'), '2: the lines of the code\'s bot.chat are in the answer of the run (its output)', JSON.stringify(coded.text.slice(0, 300)));
            check(heard(t2).length === 0, '2: the player hears nothing within 10 s: no code, no line of the code', JSON.stringify(heard(t2)));
            check(onServer() && s.killed === null, '2: the bot is still on the server (no kick for the chat)', `${onServer() ? 'on the server' : 'GONE'}, killed ${s.killed}`);

            // ---------------------------------------------------------- 3. a long skill, then !stop
            const t3 = Date.now();
            const follow = await sup.run([`!followPlayer("${PLAYER}", 3)`]);
            note(`3: !followPlayer answered after ${follow.ms} ms: ${JSON.stringify(follow.text.slice(0, 200))}`);
            check(follow.ok && follow.text.includes('started.'), '3: precondition: the long skill counts as started', JSON.stringify(follow.text.slice(0, 200)));
            const stop = await sup.run(['!stop']);
            const ended = await waitFor(() => !agent.actions.executing, { ms: 5000, every: 100 });
            await sleep(Math.max(0, 10000 - (Date.now() - t3)));
            note(`3: !stop answered after ${stop.ms} ms: ${JSON.stringify(stop.text.slice(0, 200))}; the action ${ended.ok ? `ended after ${ended.ms} ms` : 'still runs'}; the player heard ${JSON.stringify(heard(t3))}`);
            check(stop.ok && stop.ms <= 5000 && stop.text.includes('!stop: stopped'), '3: !stop through run answers within 5 s: `!stop: stopped`', `${stop.ms} ms: ${JSON.stringify(stop.text.slice(0, 200))}`);
            check(ended.ok, '3: the running skill ended within 5 s', `${ended.ms} ms`);
            check(heard(t3).length === 0, '3: the player hears nothing of it', JSON.stringify(heard(t3)));

            // ---------------------------------------------------------- 4. the owner is still answered
            const t4 = Date.now();
            orders.say('where are you?');
            const answered = await waitFor(() => heard(t4).some((l) => l.trim() === BOT_LINE), { ms: 15000, every: 250 });
            note(`4: "where are you?": the player heard ${JSON.stringify(heard(t4))}`);
            check(answered.ok, `4: the player's question is answered in the chat (\`${BOT_LINE}\`)`, JSON.stringify(heard(t4)));
            const t5 = Date.now();
            orders.say('!stats');
            const stats = await waitFor(() => heard(t5).length > 0, { ms: 15000, every: 250 });
            note(`4: the typed !stats: the player heard ${JSON.stringify(heard(t5).map((l) => l.slice(0, 120)))}`);
            check(stats.ok, '4: a command the player types is said in the chat as before', JSON.stringify(heard(t5).map((l) => l.slice(0, 120))));

            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            check(!inLogs, 'the token is in no console line of the agent', inLogs ? 'HAS it' : 'no');
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
