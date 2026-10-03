// W108 two bots (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md package 6, SPEC section 5 and 4.6):
// two of the owner's bots in one world each answer him once and never each other; a job of the other bot is left to it.
// Today (v0.1.4.11) other_bots and bot_role do not exist: the role line is in no prompt, and the farmer takes the mining.
//
// Two agents in one region of the base: w_farmer in this process, w_miner in a phase of this file (a second node
// process: the settings of an agent are one module per process). Both with the owner's switches of v0.1.4.11, the modes of
// his profile, an empty memory, only_chat_with the player; w_farmer with bot_role "You are the farmer. w_miner is the
// miner." and other_bots ["w_miner"], w_miner the reverse. The two processes share the working directory of the scenario
// (bots/w_farmer and bots/w_miner); the phase reports through a file there (w108_miner.json) and stops when the main
// process writes w108_stop. The bots are never moved by the control after their start.
// The fake model of each bot answers like the owner's model with the role line in its prompt: "where are you?" with one
// line ("I am at the farm." / "I am in the mine."), "mine 4 iron" with "That is w_miner's job. I farm." when the prompt holds
// the farmer's role line (else !mineOre("iron", 4), as a model without the role would) and with !mineOre("iron", 4) for the
// miner; a line of the other bot with "I heard <name>." (an answer to a bot, which must never come).
//   1. The player says "where are you?": within 20 s each bot said exactly one line, and none said a further line in the
//      10 s after (neither answered the other); the player heard both whispers.
//   2. The player says "mine 4 iron": the farmer's answer names the miner's job (`That is w_miner's job.`), the farmer ran
//      no !mineOre; the miner ran !mineOre. The prompt of each holds its role line (`<bot_role> A question to all of us gets
//      one line from you.`).
// Throughout: the process of each lives, no request reached a real model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, fmt, sleep, waitFor, startAgent, resetBot, placeBot, runPhase } from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, PLAYER, RELEASE_SETTINGS } from './journey.js';

const SELF = fileURLToPath(import.meta.url);
const FARMER = 'w_farmer';
const MINER = 'w_miner';
const ROLE = { [FARMER]: `You are the farmer. ${MINER} is the miner.`, [MINER]: `You are the miner. ${FARMER} is the farmer.` };
const ROLE_LINE = (name) => `${ROLE[name]} A question to all of us gets one line from you.`;
const WHERE = { [FARMER]: 'I am at the farm.', [MINER]: 'I am in the mine.' };
const JOB = `That is ${MINER}'s job. I farm.`;
const STATUS = () => path.join(process.cwd(), 'w108_miner.json');
const STOP = () => path.join(process.cwd(), 'w108_stop');

const settingsOf = (name) => RELEASE_SETTINGS({
    only_chat_with: [PLAYER], other_bots: [name === FARMER ? MINER : FARMER], bot_role: ROLE[name],
});

// The fake model of a bot (see the head of the file). Records { prompt has the role line, last turn, reply }.
function fakeBotModel(s, name) {
    const asked = [];
    const chat = s.chat;
    chat.sendRequest = async function botModel(turns, systemMessage) {
        const prompt = String(systemMessage ?? '');
        const last = Array.isArray(turns) && turns.length ? String(turns[turns.length - 1].content) : '';
        const other = name === FARMER ? MINER : FARMER;
        let reply = '';
        if (/where are you/i.test(last)) reply = WHERE[name];
        else if (/mine 4 iron/i.test(last)) reply = name === FARMER && prompt.includes(ROLE_LINE(FARMER)) ? JOB : '!mineOre("iron", 4)';
        else if (last.includes(other)) reply = `I heard ${other}.`;
        chat.requests.push({ kind: 'chat', prompt, turns: [] });
        asked.push({ role: prompt.includes(ROLE_LINE(name)), last: last.slice(0, 120), reply, t: Date.now() });
        console.log(`MODEL ${name} request ${asked.length}: last turn ${JSON.stringify(last.slice(0, 120))} -> reply ${JSON.stringify(reply)} (role line in the prompt: ${asked[asked.length - 1].role})`);
        return reply;
    };
    return asked;
}

// Every action label the agent runs (the wrapper calls the original).
function recordActions(agent) {
    const labels = [];
    const run = agent.actions.runAction;
    agent.actions.runAction = function recordedRun(label, ...rest) {
        labels.push({ label: String(label), t: Date.now() });
        return run.call(this, label, ...rest);
    };
    return labels;
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
        for (const f of [STATUS(), STOP()]) fs.rmSync(f, { force: true });
        let agent = null, orders = null, phase = null;
        try {
            // ---------------------------------------------------------- the miner (a second process)
            phase = runPhase(SELF, 'miner', {}, 420000);
            const ready = await waitFor(() => { try { return JSON.parse(fs.readFileSync(STATUS(), 'utf8')).ready; } catch { return false; } }, { ms: 90000, every: 500 });
            check(ready.ok, 'precondition: the second bot w_miner is in the world (its phase reports ready)', '');
            if (!ready.ok) return;

            // ---------------------------------------------------------- the farmer and the player
            const j = await startJourney(FARMER, b, {
                botAt: { x: b.ox - 8, y: g + 1, z: b.oz - 12 }, playerAt: { x: b.ox - 4, y: g + 1, z: b.oz - 12 }, settings: settingsOf(FARMER),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const asked = fakeBotModel(s, FARMER);
            const labels = recordActions(agent);
            const whispers = [];
            const onWhisper = (text) => {
                const w = /^(\w+) whispers(?: to you)?:? (.*)$/.exec(String(text));
                if (w) whispers.push({ from: w[1], text: w[2], t: Date.now() });
            };
            orders.player.on('messagestr', onWhisper);
            const miner = () => { try { return JSON.parse(fs.readFileSync(STATUS(), 'utf8')); } catch { return null; } };
            await sleep(12000); // the agents are quiet after their start (checkAllPlayersPresent runs 10 s after a spawn)

            // ---------------------------------------------------------- 1. where are you?
            const t1 = Date.now();
            orders.say('where are you?');
            await sleep(20000);
            const in20 = { [FARMER]: s.chats.filter((c) => c.t >= t1).length, [MINER]: (miner()?.chats ?? []).filter((c) => c.t >= t1).length };
            await sleep(10000);
            const farmerLines = s.chats.filter((c) => c.t >= t1);
            const minerLines = (miner()?.chats ?? []).filter((c) => c.t >= t1);
            note(`1: within 20 s the farmer said ${in20[FARMER]} line(s), the miner ${in20[MINER]}; within 30 s: the farmer ${JSON.stringify(farmerLines.map((c) => c.text))}, the miner ${JSON.stringify(minerLines.map((c) => c.text))}; the player heard ${JSON.stringify(whispers.filter((w) => w.t >= t1).map((w) => `${w.from}: ${w.text}`))}`);
            check(in20[FARMER] === 1 && in20[MINER] === 1, '1: "where are you?": within 20 s each bot said exactly one line', `farmer ${in20[FARMER]}, miner ${in20[MINER]}`);
            check(farmerLines.length === 1 && minerLines.length === 1, '1: neither bot said a line in the 10 s after (no bot answered the other)', `farmer ${farmerLines.length}, miner ${minerLines.length}`);
            const heard = whispers.filter((w) => w.t >= t1);
            check(heard.some((w) => w.from === FARMER) && heard.some((w) => w.from === MINER), '1: the player heard the line of each bot', JSON.stringify(heard.map((w) => w.from)));

            // ---------------------------------------------------------- 2. mine 4 iron
            const t2 = Date.now();
            orders.say('mine 4 iron');
            const job = await waitFor(() => s.chats.find((c) => c.t >= t2 && c.text.includes(JOB)) ?? null, { ms: 30000, every: 500 });
            const minerRan = await waitFor(() => (miner()?.labels ?? []).some((x) => x.t >= t2 && /mineOre/.test(x.label)), { ms: 30000, every: 500 });
            await sleep(3000);
            const farmerRan = labels.filter((x) => x.t >= t2 && /mineOre/.test(x.label));
            const m = miner();
            note(`2: the farmer said ${JSON.stringify(s.chats.filter((c) => c.t >= t2).map((c) => c.text).slice(0, 6))}, ran ${JSON.stringify(labels.filter((x) => x.t >= t2).map((x) => x.label))}; the miner said ${JSON.stringify((m?.chats ?? []).filter((c) => c.t >= t2).map((c) => c.text).slice(0, 6))}, ran ${JSON.stringify((m?.labels ?? []).filter((x) => x.t >= t2).map((x) => x.label))}`);
            check(job.ok, `2: "mine 4 iron": the farmer's answer names the miner's job (\`${JOB}\`)`, JSON.stringify(s.chats.filter((c) => c.t >= t2).map((c) => c.text).slice(0, 4)));
            check(farmerRan.length === 0, '2: the farmer ran no !mineOre', JSON.stringify(farmerRan.map((x) => x.label)));
            check(minerRan.ok, '2: the miner answered with !mineOre (it ran the command)', JSON.stringify((m?.labels ?? []).map((x) => x.label)));
            const farmerRole = asked.filter((a) => a.t >= t1);
            check(farmerRole.length > 0 && farmerRole.every((a) => a.role), `2: every prompt of the farmer holds its role line \`${ROLE_LINE(FARMER)}\``, `${farmerRole.filter((a) => a.role).length} of ${farmerRole.length}`);
            const minerRole = (m?.asked ?? []).filter((a) => a.t >= t1);
            check(minerRole.length > 0 && minerRole.every((a) => a.role), `2: every prompt of the miner holds its role line \`${ROLE_LINE(MINER)}\``, `${minerRole.filter((a) => a.role).length} of ${minerRole.length}`);
            const toBot = [...asked, ...(m?.asked ?? [])].filter((a) => /^I heard /.test(a.reply));
            check(toBot.length === 0, 'neither bot asked its model about a line of the other bot', JSON.stringify(toBot.map((a) => a.last)));

            orders.player.removeListener('messagestr', onWhisper);
            check(s.killed === null, 'the process of the farmer lives', String(s.killed));
            check(m && m.killed === null, 'the process of the miner lives', String(m?.killed));
            check(s.realCalls.length === 0 && (m?.realCalls ?? []).length === 0, 'no request reached a real model class', JSON.stringify([s.realCalls, m?.realCalls]));
        } finally {
            fs.writeFileSync(STOP(), 'stop');
            if (phase) await phase;
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            for (const f of [STATUS(), STOP()]) fs.rmSync(f, { force: true });
            await releaseRegion(r);
        }
    },

    // The second bot: started, placed, its fake model; it reports into STATUS every 500 ms until STOP exists.
    async miner() {
        const r = region(BASE_RADIUS);
        const b = basePlan(r, { owner: true, dump: loadDump() });
        const g = b.g;
        let agent = null;
        const t0 = Date.now();
        try {
            const s = await startAgent(MINER, settingsOf(MINER));
            agent = s.agent;
            const asked = fakeBotModel(s, MINER);
            const labels = recordActions(agent);
            await resetBot(MINER);
            await placeBot(agent, { x: b.ox - 8, y: g + 1, z: b.oz - 15 }, 180);
            const areas = agent.area_store?.list?.() ?? [];
            check(areas.length === 0, 'precondition: the memory of w_miner is empty (no area)', JSON.stringify(areas.map((a) => a.name)));
            const write = (ready) => fs.writeFileSync(STATUS(), JSON.stringify({
                ready, chats: s.chats, asked, labels: labels.map((x) => ({ label: x.label, t: x.t })), killed: s.killed, realCalls: s.realCalls,
            }));
            write(true);
            note(`w_miner at ${fmt(agent.bot.entity?.position)} is ready`);
            while (!fs.existsSync(STOP()) && Date.now() - t0 < 400000) {
                write(true);
                await sleep(500);
            }
            write(true);
            check(s.killed === null, 'the process of w_miner lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request of w_miner reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
        }
    },
});
exitSoon();
