// W13 cost (spec section 8 "Cost", C1 to C3, G1, amendment 1): cost_meter on with a session limit of
// $1 (no warning level, no hourly limit), world_memory on. The fake model reports usage through
// reportUsage of src/agent/cost/usage_context.js, as the Claude adapter does: every priced request
// is claude-haiku-4-5-20251001 with 150000 input and 30000 output tokens ($0.15 + $0.15 = $0.30), the
// fifth request is a model without a price. The prompter sets the purpose (chat).
//   meter   (an agent process) two messages of the player: !cost shows $0.60, 2 calls, state normal.
//           Two more: $1.20 reaches the session limit, the bot says the text of C3 in the chat.
//           !newAction and !goal are refused with the texts of G1 without a request to the model.
//           Chat still works (the fifth message reaches the model). !cost shows the totals with the
//           unpriced call and the state saving. The server kicks the bot: the disconnect handler
//           prints the report line, writes usage.json and ends the process (exit code 1).
//   main    reads bots/<name>/usage.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    waitFor, connectPlayer, quitPlayer, heardFrom, runPhase, sleep, command, MODEL,
} from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_cost';
const PLAYER = 'w_player';
const UNPRICED = 'mystery-model-1';
const LIMIT_TEXT = 'I reached the cost limit ($1.20 in this session). I stop working on goals by myself and writing new code. Chat and commands still work.';
const LINE_A = 'Cost: session $0.60 (chat $0.60), 2 calls.';
const LINE_B = 'Cost: session $1.20 (chat $1.20), 5 calls. 1 calls of models without a price are not included.';

await scenarioMain({
    async meter() {
        const r = region(16);
        let agent = null, player = null;
        let n = 0;
        const s = await startAgent(NAME, {
            ...NEW_FLAGS_OFF, cost_meter: true, cost_report_minutes: 10, cost_warn_per_hour: 0, cost_limit_per_hour: 0,
            cost_limit_per_session: 1, model_prices: {}, world_memory: true,
        }, {
            usage: () => {
                n++;
                return n === 5 ? { model: UNPRICED, input_tokens: 1000, output_tokens: 1000 } : { model: MODEL, input_tokens: 150000, output_tokens: 30000 };
            },
        });
        agent = s.agent;
        await resetBot(NAME);
        await placeBot(agent, { x: r.ox, y: r.g + 1, z: r.oz }, 0);
        player = await connectPlayer(PLAYER);
        const t0 = Date.now();
        const say = async (i) => {
            s.route(new RegExp(`w_player: hello number ${i}$`), `Hi ${i}!`);
            const before = s.chat.requests.length;
            player.chat(`hello number ${i}`);
            return (await waitFor(() => s.chat.requests.length > before && agent.isIdle(), { ms: 20000, every: 100 })).ok;
        };

        check(await say(1) && await say(2), 'meter: two messages of the player reached the fake model');
        await sleep(300);
        const costA = await command_(agent, '!cost', 10000);
        note(`meter: !cost after 2 calls: ${JSON.stringify(costA)}`);
        check(costA.includes(LINE_A), `meter: !cost shows "${LINE_A}"`, JSON.stringify(costA));
        check(costA.includes('Budget: limit $1 per session. State: normal.'), 'meter: !cost shows "Budget: limit $1 per session. State: normal."', JSON.stringify(costA));

        check(await say(3) && await say(4), 'meter: two more messages reached the fake model ($1.20 in total)');
        const warned = await waitFor(() => heardFrom(player, NAME, t0).some((t) => t.includes(LIMIT_TEXT)), { ms: 5000 });
        check(warned.ok, `meter: the bot says in the chat: ${LIMIT_TEXT}`, JSON.stringify(heardFrom(player, NAME, t0).slice(-4)));

        const codeBefore = s.code.requests.length;
        const na = await command_(agent, '!newAction("build a small house")', 20000);
        check(na.includes('I reached my cost limit and do not write new code now. Use the commands I have.') && s.code.requests.length === codeBefore,
            'meter: in the state saving !newAction is refused with the text of G1, without a request to the code model', JSON.stringify(na));
        const goal = await command_(agent, '!goal("collect wood")', 20000);
        await sleep(500);
        check(goal.includes('I reached my cost limit and do not work on goals by myself now.') && !agent.self_prompter.isActive(),
            'meter: in the state saving !goal is refused with the text of G1 and the self prompter does not run', JSON.stringify(goal));

        check(await say(5), 'meter: in the state saving chat still works (the fifth message reached the model)');
        await sleep(300);
        const costB = await command_(agent, '!cost', 10000);
        note(`meter: !cost after 5 calls: ${JSON.stringify(costB)}`);
        check(costB.includes(LINE_B), `meter: !cost shows "${LINE_B}"`, JSON.stringify(costB));
        check(costB.includes('Budget: limit $1 per session. State: saving.'), 'meter: !cost shows "Budget: limit $1 per session. State: saving."', JSON.stringify(costB));
        check(s.realCalls.length === 0, 'meter: no request reached a real model class', JSON.stringify(s.realCalls));
        await quitPlayer(player);

        note('meter: the server kicks the bot now; the disconnect handler has to print the report line, write usage.json and exit');
        await command(`kick ${NAME} world test ends the session`);
        await sleep(10000);
        check(false, 'meter: the agent process ended within 10 s after the kick');
        await stopRealAgent(agent);
        process.exit(3);
    },
    async main() {
        const r = region(16);
        await prepareRegion(r);
        try {
            const ph = await runPhase(SELF, 'meter', {}, 120000, 1);
            const reportLines = ph.lines.filter((l) => l.includes('Cost: session $'));
            note(`report lines printed by the agent process: ${JSON.stringify(reportLines.slice(-3))}`);
            check(ph.lines.some((l) => l.includes(LINE_B) && !l.includes('CHECK') && !l.includes('NOTE')),
                'the disconnect handler printed the report line before the exit', JSON.stringify(reportLines.slice(-2)));
            const file = path.join('bots', NAME, 'usage.json');
            let json = null;
            try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { note('usage.json: ' + e.message); }
            note(`usage.json: ${JSON.stringify(json)}`);
            const ses = json?.sessions?.[json.sessions.length - 1];
            check(json?.version === 1 && Array.isArray(json.sessions) && json.sessions.length === 1, 'usage.json has version 1 and one session', JSON.stringify(json && Object.keys(json)));
            check(ses && ses.calls === 5 && Math.abs(ses.dollars - 1.2) < 1e-9 && ses.unpriced_calls === 1,
                'the session: 5 calls, $1.20, 1 unpriced call', JSON.stringify(ses && { calls: ses.calls, dollars: ses.dollars, unpriced_calls: ses.unpriced_calls }));
            const chat = ses?.by_purpose?.chat;
            check(chat && chat.calls === 5 && Math.abs(chat.dollars - 1.2) < 1e-9 && Object.keys(ses.by_purpose).length === 1,
                'by_purpose has only chat: 5 calls, $1.20 (the prompter set the purpose)', JSON.stringify(ses?.by_purpose));
            check(ses?.by_model && MODEL in ses.by_model && UNPRICED in ses.by_model, 'by_model names both models', JSON.stringify(ses?.by_model));
            check(ses && !Number.isNaN(Date.parse(ses.started)) && !Number.isNaN(Date.parse(ses.ended)) && typeof ses.minutes === 'number'
                && Math.round(ses.minutes * 10) === ses.minutes * 10, 'started and ended are ISO times, minutes has one decimal', JSON.stringify(ses && { started: ses.started, ended: ses.ended, minutes: ses.minutes }));
        } finally {
            await releaseRegion(r);
        }
    },
});
exitSoon();
