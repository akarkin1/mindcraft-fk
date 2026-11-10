// S20 routine_round (v0.1.4.15 "The base survey and Routines", tester T3; SPEC 3 and 3.7): a routine on the fake server: the
// remember line, the one plan prompt answered by the fake model with two commands the fake world can satisfy, the plan line, the
// round as a job (its start and done lines), and the second round after `every minute` with no new plan. Against a857593
// (v0.1.4.14 plus the spec) the first command answers `Command '!rememberRoutine' does not exist.` and the scenario fails there.
//
// The fake server with a stone floor at y 63 (the bot has physics and walks; the clock stands at 6000, rate 0). What the fake world
// can satisfy (probed on 2026-11-10): a walk of the path finder to a cell of the floor; crafting waits for an `updateSlot` the fake
// server never sends and digging is refused for want of a tool, so `!craftRecipe` and `!collectBlocks` of SPEC 3.7 cannot be the
// steps here. The steps are two walks between remembered places, `!goToRememberedPlace` being a command of ROUTINE_COMMANDS
// (SPEC 3.2): the owner saves "spot" where the bot stands (0, 64, 0) and "post" 3 blocks east, both typed. The real agent
// (Agent.start, the fake models) with world_memory, job_memory, routines and job_resume_seconds 10; every command typed by a
// player through Agent.handleMessage (the reply is what routeResponse sends to the player).
//   1. Typed `!rememberRoutine("the walk", "walk to the post and back to the spot, every minute")`: `I remember the routine
//      "the walk": walk to the post and back to the spot, every minute. I do it when I have nothing else to do, every minute.`
//   2. Within 60 s (the resume wait of 10 s, the tick of 5 s and two short walks): exactly one request to the chat model, the plan
//      prompt of SPEC 3.2 (its first line `You plan the steps of a Minecraft bot for a standing task the player described in his
//      words.`, then the task, the places, the commands, `When the task cannot be done with these commands, answer NONE.`),
//      answered with `!goToRememberedPlace("post")` and `!goToRememberedPlace("spot")`; the plan line `My plan for "the walk":
//      !goToRememberedPlace("post"), !goToRememberedPlace("spot"). I start.`, `I start the routine "the walk", round 1.`,
//      `Round 1 of "the walk" is done.`; the bot walked: its position reached x 2.5 or more and came back to within 1 block of
//      the spot (the bot's own position, sampled every 200 ms); routines.json of the world holds the routine with its two steps.
//   3. The second round after `every minute`: `I start the routine "the walk", round 2.` comes 55 to 100 s after round 1 was
//      done and `Round 2 ... is done.` follows; no second plan prompt and no second plan line; `!routines` lists the routine with
//      2 rounds.
//   4. `!forgetRoutine("the walk")`: `I forgot the routine "the walk".` and `!routines`: `I have no routines.`
// Throughout: the process lives, no request reached a real model; the chat model got the one plan prompt and nothing else.
import fs from 'node:fs';
import path from 'node:path';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, withTimeout, sleep,
} from './helpers.js';

const NAME = 'e2e_routine';
const PLAYER = 'e2e_player';
const ROUTINE = 'the walk';
const TEXT = 'walk to the post and back to the spot, every minute';
const STEPS = ['!goToRememberedPlace("post")', '!goToRememberedPlace("spot")'];
const PLAN_PROMPT = /^You plan the steps of a Minecraft bot for a standing task the player described in his words\./;
const NONE_LINE = /When the task cannot be done with these commands, answer NONE\./;
const REMEMBERED = new RegExp(`^I remember the routine "${ROUTINE}": ${TEXT}\\. I do it when I have nothing else to do, every (minute|1 minutes?)\\.$`);
const PLAN_LINE = /^My plan for "the walk": (.*)\. I start\.$/;
const START = (n) => new RegExp(`^I start the routine "the walk", round ${n}\\.$`);
const DONE = (n) => new RegExp(`^Round ${n} of "the walk" is done\\.$`);
const LISTED = /^My routines: the walk \(every [^,()]+, (\d+) rounds?, last \d\d:\d\d\)\.$/;
const FORGOT = /^I forgot the routine "the walk"\.$/;
const NO_ROUTINES = /^I have no routines\.$/;
const NOT_EXIST = /^Command '!rememberRoutine' does not exist\.$/;
const USED = /^\*\S+ used \S+\*$/;

// Polls fn until it returns a truthy value: { ok, value, ms }.
async function waitFor(fn, ms, every = 200) {
    const t0 = Date.now();
    for (;;) {
        const value = await fn();
        if (value) return { ok: true, value, ms: Date.now() - t0 };
        if (Date.now() - t0 >= ms) return { ok: false, value, ms: Date.now() - t0 };
        await sleep(every);
    }
}

await scenarioMain({
    async main() {
        const server = await startServer({ seedHigh: 21, seedLow: 20, motd: 'Routine World', floor: '63', time: 6000, rate: 0 });
        let agent = null;
        try {
            const s = await startRealAgent(NAME, server.port, { world_memory: true, job_memory: true, job_resume_seconds: 10, routines: true, base_survey: false });
            agent = s.agent;
            const bot = agent.bot;
            // what the bot says (sayText and the replies to the player go through openChat), with the time
            const said = [];
            const open = agent.openChat;
            agent.openChat = function recordedChat(message) { said.push({ text: String(message), t: Date.now() }); return open.call(this, message); };
            const replies = [];
            const route = agent.routeResponse;
            agent.routeResponse = function recordedRoute(to, message) { replies.push(String(message)); return route.call(this, to, message); };
            const saidSince = (t, re) => said.filter((x) => x.t >= t && re.test(x.text)).map((x) => x.text);
            const typed = async (text, ms = 30000) => {
                const from = replies.length;
                await withTimeout(agent.handleMessage(PLAYER, text), ms, text);
                const mine = replies.slice(from).filter((m) => !USED.test(m));
                return mine[mine.length - 1] ?? '';
            };
            // the fake model: the plan prompt of the routine gets the two walks, nothing else is answered
            const plans = [];
            const chat = s.chat;
            const send = chat.sendRequest;
            chat.sendRequest = async function planned(turns, systemMessage) {
                const prompt = String(systemMessage ?? '');
                if (!PLAN_PROMPT.test(prompt)) return send.call(this, turns, systemMessage);
                plans.push({ prompt, t: Date.now() });
                chat.requests.push({ kind: 'chat', prompt, turns: JSON.parse(JSON.stringify(turns ?? [])), routed: true });
                console.log(`PLAN prompt ${plans.length} (${prompt.length} chars) -> ${JSON.stringify(STEPS)}`);
                return STEPS.join('\n');
            };
            const pos = () => ({ x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z });
            const fmt = (p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
            check(typeof agent.job === 'object' && agent.job !== null, 'precondition: the job of job_memory exists on the agent', typeof agent.job);
            const spot = await typed('!rememberHere("spot")');
            const walk = await typed('!goToCoordinates(3, 64, 0, 0)', 30000);
            const post = await typed('!rememberHere("post")');
            const back = await typed('!goToCoordinates(0, 64, 0, 0)', 30000);
            note(`0: !rememberHere("spot") ${JSON.stringify(spot)}; the walk east ${JSON.stringify(walk.slice(-60))}; !rememberHere("post") ${JSON.stringify(post)} at ${fmt(pos())}; back ${JSON.stringify(back.slice(-60))}; the bot at ${fmt(pos())}`);
            check(spot === 'Location saved as "spot".' && post === 'Location saved as "post".' && Math.abs(pos().x - 0.5) < 1.2, 'precondition: the places "spot" (where the bot stands) and "post" (3 blocks east) are saved and the bot stands at the spot', `${spot} / ${post}; the bot at ${fmt(pos())}`);
            const requests0 = chat.requests.length;

            // ---------------------------------------------------------- 1. the routine is remembered
            const t1 = Date.now();
            const remembered = await typed(`!rememberRoutine("${ROUTINE}", "${TEXT}")`);
            note(`1: !rememberRoutine answered ${JSON.stringify(remembered)}`);
            check(REMEMBERED.test(remembered), '1: `I remember the routine "the walk": walk to the post and back to the spot, every minute. I do it when I have nothing else to do, every minute.` (SPEC 3.6)', JSON.stringify(remembered));
            if (NOT_EXIST.test(remembered)) {
                note('the command does not exist on this code (v0.1.4.14): the rounds of parts 2 to 4 cannot run and are not waited for');
                check(false, '2 to 4: the routine runs its rounds (not run: no !rememberRoutine on this code)', JSON.stringify(remembered));
                return;
            }

            // ---------------------------------------------------------- 2. the first round
            const samples = [];
            const sampler = setInterval(() => { try { samples.push({ t: Date.now(), ...pos() }); } catch { /* no entity */ } }, 200);
            const done1 = await waitFor(() => saidSince(t1, DONE(1))[0] ?? null, 60000);
            const farthest = samples.reduce((m, p) => Math.max(m, p.x), -Infinity);
            const nowAt = pos();
            const planLine = saidSince(t1, PLAN_LINE)[0] ?? null;
            const start1 = saidSince(t1, START(1))[0] ?? null;
            const worldDir = agent.world_memory?.worldDir ?? null;
            const file = worldDir ? path.join(worldDir, 'routines.json') : null;
            let fileText = null;
            try { fileText = file ? fs.readFileSync(file, 'utf8') : null; } catch { fileText = null; }
            // the steps of the saved plan: the file holds { routines: { <name>: { steps: [{ command, check }] } } } (JSON escapes the quotes
            // of a command, so the raw text is not searched); every routine's steps are gathered, whatever the name is normalised to
            let savedSteps = [];
            try {
                const json = fileText ? JSON.parse(fileText) : null;
                const routines = json?.routines && typeof json.routines === 'object' ? Object.values(json.routines) : [];
                savedSteps = routines.flatMap((r) => (Array.isArray(r?.steps) ? r.steps : []).map((st) => String(st?.command ?? '')));
            } catch { savedSteps = []; }
            note(`2: ${((done1.ms) / 1000).toFixed(1)} s after the remember: ${plans.length} plan prompt(s); the plan line ${JSON.stringify(planLine)}; start ${JSON.stringify(start1)}; done ${JSON.stringify(done1.value)}; the bot went as far as x ${farthest.toFixed(1)} and stands at ${fmt(nowAt)}; the bot said ${JSON.stringify(said.filter((x) => x.t >= t1).map((x) => x.text).slice(0, 12))}`);
            note(`2: the plan prompt ${plans[0] ? JSON.stringify(plans[0].prompt.split('\n').slice(0, 3)) + ' ... ' + JSON.stringify(plans[0].prompt.split('\n').slice(-2)) : '(none)'}; routines.json ${file ?? '(no world dir)'}: ${fileText ? fileText.slice(0, 300) : 'MISSING'}`);
            check(plans.length === 1 && PLAN_PROMPT.test(plans[0]?.prompt ?? '') && NONE_LINE.test(plans[0]?.prompt ?? ''), '2: exactly one plan prompt went to the chat model, with the first line of SPEC 3.2 and its closing NONE line', `${plans.length} prompts`);
            const m = planLine ? PLAN_LINE.exec(planLine) : null;
            check(Boolean(m) && m[1] === STEPS.join(', '), '2: the plan line `My plan for "the walk": !goToRememberedPlace("post"), !goToRememberedPlace("spot"). I start.`', JSON.stringify(planLine));
            check(Boolean(start1), '2: `I start the routine "the walk", round 1.` was said', JSON.stringify(start1));
            check(done1.ok, '2: `Round 1 of "the walk" is done.` within 60 s of the remember (the resume wait of 10 s and the two walks)', done1.ok ? `${(done1.ms / 1000).toFixed(1)} s` : 'not within 60 s');
            // !goToRememberedPlace walks with a closeness of 1 and stops about 1 block short of the post at x 3.5: x 2.0 is the walk
            check(farthest >= 2.0 && Math.abs(nowAt.x - 0.5) < 1.2 && Math.abs(nowAt.z - 0.5) < 1.2, '2: the round walked the bot to the post (x 2.0 or more; the walk stops 1 block short) and back to the spot (the bot\'s own position)', `as far as x ${farthest.toFixed(1)}, now ${fmt(nowAt)}`);
            check(savedSteps.includes(STEPS[0]) && savedSteps.includes(STEPS[1]), '2: routines.json of the world holds the routine with its two steps (the plan is saved with the routine)', fileText ? `steps ${JSON.stringify(savedSteps)}` : 'missing');

            // ---------------------------------------------------------- 3. the second round after every minute
            const t2 = Date.now();
            const start2 = await waitFor(() => saidSince(t2, START(2))[0] ?? null, 100000, 250);
            const done2 = start2.ok ? await waitFor(() => saidSince(t2, DONE(2))[0] ?? null, 40000) : { ok: false, ms: 0 };
            clearInterval(sampler);
            const planLines = saidSince(t1, PLAN_LINE);
            note(`3: round 2 ${start2.ok ? `started ${(start2.ms / 1000).toFixed(0)} s after round 1 was done` : 'did NOT start within 100 s'}${done2.ok ? ` and was done ${(done2.ms / 1000).toFixed(0)} s later` : ''}; plan prompts ${plans.length}, plan lines ${planLines.length}; said ${JSON.stringify(said.filter((x) => x.t >= t2).map((x) => x.text).slice(0, 8))}`);
            check(start2.ok && start2.ms >= 55000 && start2.ms <= 100000 && done2.ok, '3: the second round comes after `every minute` (55 to 100 s after round 1 was done) and ends', `start ${start2.ok ? (start2.ms / 1000).toFixed(0) + ' s' : 'no'}, done ${done2.ok}`);
            check(plans.length === 1 && planLines.length === 1, '3: no new plan: one plan prompt and one plan line in all (zero model calls in a round, SPEC rule 30)', `${plans.length} prompts, ${planLines.length} lines`);
            const list = await typed('!routines');
            const lm = LISTED.exec(list);
            note(`3: !routines answered ${JSON.stringify(list)}`);
            check(Boolean(lm) && Number(lm[1]) === 2, '3: `!routines` lists the routine with 2 rounds: `My routines: the walk (every minute, 2 rounds, last HH:MM).`', JSON.stringify(list));

            // ---------------------------------------------------------- 4. forgotten
            const forgot = await typed(`!forgetRoutine("${ROUTINE}")`);
            const none = await typed('!routines');
            note(`4: !forgetRoutine answered ${JSON.stringify(forgot)}; !routines ${JSON.stringify(none)}`);
            check(FORGOT.test(forgot), '4: `I forgot the routine "the walk".`', JSON.stringify(forgot));
            check(NO_ROUTINES.test(none), '4: `!routines` answers `I have no routines.`', JSON.stringify(none));

            const others = chat.requests.slice(requests0).filter((q) => !PLAN_PROMPT.test(String(q.prompt ?? '')));
            check(others.length === 0, 'the chat model got the one plan prompt and nothing else from the remember on', `${others.length} other requests: ${JSON.stringify(others.slice(0, 2).map((q) => String(q.prompt ?? '').slice(0, 80)))}`);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await server.stop();
        }
    },
});
exitSoon();
