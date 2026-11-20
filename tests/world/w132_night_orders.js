// W132 the night and the orders (entry `night_orders`; v0.1.4.16 "Stability, and three packs", tester T3; PLAN.md section 4 F8 and F9,
// section 7; SPEC section 3 F8 and F9, section 7): one clock for the prompt's time line, no work command on the model's own initiative,
// the supervisor's orders are orders the model cannot stop, and a run is quiet in the chat. Findings R-11, Q-3, R-12: the model said
// night by day, started `!collectBlocks` by itself, stopped the supervisor's commands. Against 9a28d07 (v0.1.4.15) `!stats` says Night at
// 12500 and 23500, the model's `!collectBlocks` after an AUTO MESSAGE runs (the bot digs), and the model's `!stop` ends the
// supervisor's command; on the release every check passes.
//
// The base world, nothing built: the bot on the grass with a stone pickaxe and 4 bread, the player 3 blocks east. The owner's switches
// (SUPERVISION_SETTINGS) with the watch server on, the modes of his profile, an empty memory. The fake model answers an AUTO MESSAGE
// of a mode with `!collectBlocks("stone", 2)` (a work command of its own: the model of R-11) and the owner's question "how is it
// going?" with `!stop` (the model that stopped the supervisor's commands). Console names of 26.1.
//   A. `time set` 1000, 7000, 12500, 18000, 23500, each followed by a typed `!stats`: the `Time:` line says Morning, Afternoon, Evening,
//      Night, Dawn (F8: dayPhase of clock_logic.js; v0.1.4.15 says Night from 12000 on and at 23500).
//   B. The bot alone for 3 minutes: a typed walk of 40 blocks is interrupted by the creeper reflex (a creeper that stands, NoAI, 6
//      blocks south of the bot, in sight at its level; difficulty normal for the moment) and the mode's AUTO MESSAGE goes to the model,
//      which answers with the work command. B1 (precondition) the AUTO MESSAGE reached the model and the fake answered
//      `!collectBlocks("stone", 2)`; B2 no work command ran in the 3 minutes after it: the bot dug no block (bot.dig counted), carries no
//      cobblestone (server), the chat has no `*used collectBlocks*` line; B3 the model got `I do not start work without an order from
//      the player or the supervisor.` (the history).
//   C. The supervisor runs `!collectBlocks("stone", 2)`; 1.5 s later the owner asks "how is it going?" and the model answers `!stop`:
//      C1 the run's command goes on to its end: 2 cobblestone in the bag (server); C2 the model got `That is the player's order; I do not
//      stop it.`; C3 the player heard no echo of the run (`*Opus used ...*`, `*used collectBlocks*`, a `!collectBlocks` line): the run
//      is quiet in the chat.
// Throughout: the process lives, no request reached a real model, the token is in no console line.
import crypto from 'node:crypto';
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, heardFrom,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, itemsText, entityNumber } from './world.js';
import { BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER, freePort } from './journey.js';
import { Supervisor } from './supervisor.js';

const NAME = 'w_night';
const SUPERVISOR = 'Opus';
const TAG = 'mcw_night';
const WORK = '!collectBlocks("stone", 2)';
const NO_OWN_WORK = 'I do not start work without an order from the player or the supervisor.';
const PLAYERS_ORDER = "That is the player's order; I do not stop it.";
const TIMES = [[1000, 'Morning'], [7000, 'Afternoon'], [12500, 'Evening'], [18000, 'Night'], [23500, 'Dawn']];
const lastTurn = (q) => String(q?.turns?.[q.turns.length - 1]?.content ?? '');

// Counts every bot.dig since start (nothing is changed: the wrapper calls the original).
function countDigs(agent) {
    const bot = agent.bot;
    const orig = bot.dig;
    const state = { count: 0, blocks: [] };
    bot.dig = function countedDig(block, ...rest) {
        state.count++;
        if (block?.position) state.blocks.push(`${block.name} (${block.position.x}, ${block.position.y}, ${block.position.z})`);
        return orig.call(this, block, ...rest);
    };
    state.stop = () => { bot.dig = orig; return state; };
    state.reset = () => { state.count = 0; state.blocks.length = 0; };
    return state;
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const { ox, oz, g } = r;
        const start = { x: ox, y: g + 1, z: oz };
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the environment of the agent, which runs in this process; never printed
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server', String(port));
        const sup = new Supervisor({ url: `http://127.0.0.1:${port}/mcp`, token: TOKEN, name: SUPERVISOR });
        const sel = `@e[type=minecraft:creeper,tag=${TAG}]`;
        let agent = null, orders = null, digs = null;
        try {
            const j = await startJourney(NAME, null, {
                botAt: start, botYaw: -90, playerAt: { x: start.x + 3, y: g + 1, z: start.z }, kit: [['stone_pickaxe', 1], ['bread', 4]],
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port, supervisor_name: SUPERVISOR }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            digs = countDigs(agent);
            const t0 = Date.now();
            const heard = (t) => heardFrom(orders.player, NAME, t);
            const cobble = async () => { const inv = await inventoryOf(NAME); return (inv.cobblestone || 0) + (inv.stone || 0); };

            // ---------------------------------------------------------- A. the clock line of !stats
            const labels = [];
            for (const [time, label] of TIMES) {
                await commands([`time set ${time}`]);
                const synced = await waitFor(() => Math.abs((agent.bot.time?.timeOfDay ?? -1000) - time) <= 200, { ms: 6000, every: 100 });
                const stats = await orders.order('!stats', 20000);
                const got = /- Time: (\w+)/.exec(stats)?.[1] ?? null;
                labels.push({ time, label, got });
                note(`A: time set ${time} (the bot's clock ${agent.bot.time?.timeOfDay}${synced.ok ? '' : ', NOT within 200 ticks after 6 s'}): !stats says Time: ${got}`);
                check(got === label, `A: at ${time} the typed !stats says \`Time: ${label}\` (F8: one clock, dayPhase)`, `Time: ${got}`);
            }
            await commands(['time set 6000']);
            await sleep(1500);

            // ---------------------------------------------------------- B. the bot alone: no work command of its own
            s.route(/AUTO MESSAGE/, WORK);
            await commands(['difficulty normal']);
            const tB = Date.now();
            const walk = orders.orderInfo(`!goToCoordinates(${start.x + 40}, ${g + 1}, ${start.z}, 1)`, 120000);
            await sleep(2500);
            const atB = await entityPos(NAME);
            const creeperAt = { x: Math.floor(atB.x) + 0.5, y: g + 1, z: Math.floor(atB.z) + 6.5 };
            const out = await command(`summon minecraft:creeper ${creeperAt.x} ${creeperAt.y} ${creeperAt.z} {NoAI:1b,PersistenceRequired:1b,Tags:["${TAG}"]}`);
            check(out.some((l) => /Summoned new Creeper/.test(l)), 'B0: a creeper that stands is summoned 6 blocks south of the walking bot, in sight at its level', out.join(' | '));
            const auto = await waitFor(() => s.chat.requests.find((q) => /AUTO MESSAGE/.test(lastTurn(q))) ?? null, { ms: 60000, every: 250 });
            const answered = await waitFor(() => s.sent.find((x) => x.label === 'chat' && x.reply === WORK && x.t >= tB) ?? null, { ms: 5000, every: 100 });
            const tWork = answered.value?.t ?? Date.now();
            await sleep(1500);
            digs.reset(); // the digs from the moment the model gave its own order
            const cobble0 = await cobble();
            await command(`kill ${sel}`);
            await commands(['difficulty peaceful']);
            const walkInfo = await Promise.race([walk, sleep(5000).then(() => null)]);
            note(`B0: the walk ${walkInfo ? `answered ${JSON.stringify(String(walkInfo.reply).slice(0, 160))}` : 'still runs'}; the AUTO MESSAGE ${auto.ok ? `reached the model after ${(auto.ms / 1000).toFixed(1)} s: ${JSON.stringify(lastTurn(auto.value).slice(0, 160))}` : 'did NOT reach the model within 60 s'}; the fake answered ${JSON.stringify(answered.value?.reply ?? null)}; the bot said ${JSON.stringify(saidLines(s, tB).slice(0, 6))}`);
            check(auto.ok && answered.ok, `B1: precondition: a mode's AUTO MESSAGE reached the model and the fake model answered the work command \`${WORK}\` (the model of R-11)`, `auto ${auto.ok}, answered ${answered.ok}`);
            note('B: the bot is left alone for 180 s');
            await sleep(180000);
            if (agent.actions.executing) note(`B: something still runs (${agent.actions.currentActionLabel}); !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            const cobbleB = await cobble();
            const usedLines = s.chats.filter((x) => x.t >= tWork && /\*(?:\S+ )?used collectBlocks\*/.test(x.text)).map((x) => x.text);
            const refused = s.added.filter((x) => x.t >= tWork && x.content.includes(NO_OWN_WORK)).length;
            note(`B: in the 3 minutes after the model's own order: ${digs.count} digs ${JSON.stringify(digs.blocks.slice(0, 4))}, cobblestone ${cobble0} -> ${cobbleB} (server), used lines ${JSON.stringify(usedLines)}, the refusal in the history ${refused} time(s); the model got ${s.chat.requests.length} requests in all; the bot said ${JSON.stringify(saidLines(s, tWork).slice(0, 8))}; the bot at ${fmt(await entityPos(NAME))}`);
            check(digs.count === 0 && cobbleB === cobble0 && usedLines.length === 0, 'B2: no work command ran on the model\'s own initiative in 3 minutes: no block dug, no cobblestone, no `*used collectBlocks*` line (F8)', `${digs.count} digs, cobblestone ${cobble0} -> ${cobbleB}, used lines ${usedLines.length}`);
            check(refused >= 1, `B3: the model got \`${NO_OWN_WORK}\` (returned, not said)`, `${refused} in the history`);

            // ---------------------------------------------------------- C. the supervisor's run and the model's !stop
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            const cobbleC0 = await cobble();
            s.route(/how is it going/, '!stop');
            const tC = Date.now();
            const run = sup.run([WORK]);
            const running = await waitFor(() => agent.actions.executing, { ms: 10000, every: 100 });
            await sleep(1500);
            orders.say('how is it going?');
            const stopSent = await waitFor(() => s.sent.find((x) => x.label === 'chat' && x.reply === '!stop' && x.t >= tC) ?? null, { ms: 20000, every: 100 });
            const stillRunning = agent.actions.executing;
            const answer = await run;
            await waitFor(() => !agent.actions.executing, { ms: 60000, every: 200 });
            await sleep(1000);
            const cobbleC = await cobble();
            const heardC = heard(tC);
            const refusedStop = s.added.filter((x) => x.t >= tC && x.content.includes(PLAYERS_ORDER)).length;
            const stoppedLines = s.added.filter((x) => x.t >= tC && /was stopped by/.test(x.content)).map((x) => x.content);
            note(`C: the run ${answer.ok ? `answered after ${answer.ms} ms` : 'was REFUSED'}: ${JSON.stringify(answer.text.slice(0, 300))}; the command ran: ${running.ok}; the model's !stop ${stopSent.ok ? `was sent ${(stopSent.value.t - tC) / 1000} s after the run` : 'was NOT sent within 20 s'}; the action still ran right after it: ${stillRunning}; cobblestone ${cobbleC0} -> ${cobbleC}; the refusal ${refusedStop} time(s) in the history; stopped lines ${JSON.stringify(stoppedLines)}; the player heard ${JSON.stringify(heardC)}`);
            check(running.ok && stopSent.ok, 'C0: precondition: the supervisor\'s command ran and the model answered the owner\'s question with !stop while it ran', `ran ${running.ok}, stop sent ${stopSent.ok}`);
            check(cobbleC - cobbleC0 >= 2, 'C1: the supervisor\'s command went on to its end: 2 cobblestone more in the bag (server); the model\'s !stop did not end it (F8)', `cobblestone ${cobbleC0} -> ${cobbleC}`);
            check(refusedStop >= 1, `C2: the model got \`${PLAYERS_ORDER}\``, `${refusedStop} in the history`);
            const echoes = heardC.filter((l) => /\*\S* ?used \w+\*|!collectBlocks|^\*/.test(l));
            check(echoes.length === 0, 'C3: the run is quiet in the chat: the player heard no echo of the supervisor\'s command (F9)', JSON.stringify(echoes));

            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            check(!inLogs, 'the token is in no console line of the agent', inLogs ? 'HAS it' : 'no');
            const health = await entityNumber(NAME, 'Health');
            check(health > 0, 'the bot lives', `health ${health}`);
            note(`the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 30))}; the bot carries ${itemsText(await inventoryOf(NAME))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (digs) digs.stop();
            await commands([`kill @e[type=minecraft:creeper,x=${r.ox - 150},y=-64,z=${r.oz - 150},dx=300,dy=400,dz=300]`, 'difficulty peaceful', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
