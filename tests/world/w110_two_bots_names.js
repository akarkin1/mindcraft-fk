// W110 two bots, one name (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 1.10, SPEC section 1 and 4.2): a line
// that starts with a bot's name is for that bot only; the other stays quiet and does nothing; a line without a name is
// for both. Today (v0.1.4.12) both bots answer every line (the owner's play of 2026-10-04): "claude, come here" moves
// gpt too, and the scenario fails at the check that gpt did not move.
//
// Two agents in one region of the base, named as the owner's bots: claude in this process, gpt in a phase of this file
// (a second node process). Both with the owner's switches of v0.1.4.12 and the switches of this release
// (SUPERVISION_SETTINGS), other_bots the other's name, only_chat_with the player, the modes of his profile, an empty
// memory. The bots stand 6 blocks from the player, one to the west, one to the east; they are never moved by the
// control. The fake model of each bot answers like the owner's model: a line that asks it to come (with or without a
// name) with !goToPlayer("w_player", 2); so a bot that is asked when it is not meant comes, as today.
//   1. "claude, come here": within 20 s claude is within 2 blocks of the player (between the cells, as the path search
//      measures it); gpt did not move more than 1 block (server positions, sampled) and said nothing (and its model was
//      not asked: the name is matched by code).
//   2. The player steps 6 blocks away; "come here": both bots are within 2 blocks within 20 s.
// Throughout: the process of each lives, no request reached a real model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, fmt, sleep, waitFor, startAgent, resetBot, placeBot, runPhase, entityPos, tp, startTrace } from './helpers.js';
import { region, prepareRegion, releaseRegion, dist } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, PLAYER, SUPERVISION_SETTINGS } from './journey.js';

const SELF = fileURLToPath(import.meta.url);
const CLAUDE = 'claude';
const GPT = 'gpt';
const STATUS = () => path.join(process.cwd(), 'w110_gpt.json');
const STOP = () => path.join(process.cwd(), 'w110_stop');
const cell = (p) => (p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null);
const cellDist = (a, b) => dist(cell(a), cell(b));

const settingsOf = (name) => SUPERVISION_SETTINGS({
    only_chat_with: [PLAYER], other_bots: [name === CLAUDE ? GPT : CLAUDE],
});

// The fake model of a bot: every line of the player that asks it to come gets !goToPlayer (as the owner's model would
// answer whichever bot is asked). Records { last turn, reply, t }.
function fakeBotModel(s, name) {
    const asked = [];
    const chat = s.chat;
    chat.sendRequest = async function botModel(turns, systemMessage) {
        const prompt = String(systemMessage ?? '');
        const last = Array.isArray(turns) && turns.length ? String(turns[turns.length - 1].content) : '';
        const reply = /come here/i.test(last) ? `!goToPlayer("${PLAYER}", 2)` : '';
        chat.requests.push({ kind: 'chat', prompt, turns: [] });
        asked.push({ last: last.slice(0, 120), reply, t: Date.now() });
        console.log(`MODEL ${name} request ${asked.length}: last turn ${JSON.stringify(last.slice(0, 120))} -> reply ${JSON.stringify(reply)}`);
        return reply;
    };
    return asked;
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
        const playerAt = { x: b.ox - 2, y: g + 1, z: b.oz - 12 }; // north of the house, open grass
        const claudeAt = { x: playerAt.x - 6, y: g + 1, z: playerAt.z };
        for (const f of [STATUS(), STOP()]) fs.rmSync(f, { force: true });
        let agent = null, orders = null, phase = null;
        try {
            // ---------------------------------------------------------- gpt (a second process)
            phase = runPhase(SELF, 'gpt', {}, 300000);
            const ready = await waitFor(() => { try { return JSON.parse(fs.readFileSync(STATUS(), 'utf8')).ready; } catch { return false; } }, { ms: 90000, every: 500 });
            check(ready.ok, 'precondition: the second bot gpt is in the world (its phase reports ready)', '');
            if (!ready.ok) return;

            // ---------------------------------------------------------- claude and the player
            const j = await startJourney(CLAUDE, b, { botAt: claudeAt, playerAt, settings: settingsOf(CLAUDE) });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const asked = fakeBotModel(s, CLAUDE);
            const gpt = () => { try { return JSON.parse(fs.readFileSync(STATUS(), 'utf8')); } catch { return null; } };
            await sleep(12000); // the agents are quiet after their start (checkAllPlayersPresent runs 10 s after a spawn)
            const p0 = await entityPos(PLAYER);
            const c0 = await entityPos(CLAUDE);
            const g0 = await entityPos(GPT);
            note(`the player at ${fmt(p0)}, claude at ${fmt(c0)} (${dist(c0, p0).toFixed(1)} blocks), gpt at ${fmt(g0)} (${dist(g0, p0).toFixed(1)} blocks)`);
            check(c0 && g0 && Math.abs(dist(c0, p0) - 6) < 1.5 && Math.abs(dist(g0, p0) - 6) < 1.5, 'precondition: both bots stand 6 blocks from the player', `claude ${dist(c0, p0).toFixed(1)}, gpt ${dist(g0, p0).toFixed(1)}`);

            // ---------------------------------------------------------- 1. "claude, come here"
            const t1 = Date.now();
            const trace = startTrace(async () => ({ claude: await entityPos(CLAUDE), gpt: await entityPos(GPT) }), 500);
            orders.say('claude, come here');
            const came = await waitFor(async () => {
                const [a, p] = [await entityPos(CLAUDE), await entityPos(PLAYER)];
                return a && p && cellDist(a, p) <= 2 ? a : null;
            }, { ms: 20000, every: 500 });
            await sleep(Math.max(0, 20000 - (Date.now() - t1)));
            const rows = await trace.stop();
            const gptMoved = rows.reduce((m, x) => Math.max(m, x.gpt ? dist(x.gpt, g0) : 0), 0);
            const gptLines = (gpt()?.chats ?? []).filter((c) => c.t >= t1);
            const gptAsked = (gpt()?.asked ?? []).filter((a) => a.t >= t1);
            note(`1: claude ${came.ok ? `came within 2 blocks after ${(came.ms / 1000).toFixed(1)} s` : 'did NOT come within 20 s'}, at ${fmt(await entityPos(CLAUDE))}; gpt moved at most ${gptMoved.toFixed(2)} blocks, said ${JSON.stringify(gptLines.map((c) => c.text))}, its model was asked ${gptAsked.length} time(s) ${JSON.stringify(gptAsked.map((a) => a.last))}; claude's model was asked ${asked.filter((a) => a.t >= t1).length} time(s)`);
            check(came.ok, '1: "claude, come here": within 20 s claude is within 2 blocks of the player', fmt(await entityPos(CLAUDE)));
            check(gptMoved <= 1, '1: gpt did not move more than 1 block (server positions, sampled for 20 s)', `${gptMoved.toFixed(2)} blocks`);
            check(gptLines.length === 0, '1: gpt said nothing', JSON.stringify(gptLines.map((c) => c.text)));
            check(gptAsked.length === 0, '1: the model of gpt was not asked (the name is matched by code, PLAN 1.10)', JSON.stringify(gptAsked.map((a) => a.last)));

            // ---------------------------------------------------------- 2. "come here"
            const away = { x: playerAt.x, y: g + 1, z: playerAt.z - 6 };
            await tp(PLAYER, away, 180, 0);
            await sleep(1500);
            const p2 = await entityPos(PLAYER);
            note(`2: the player stepped to ${fmt(p2)}: claude ${dist(await entityPos(CLAUDE), p2).toFixed(1)} blocks away, gpt ${dist(await entityPos(GPT), p2).toFixed(1)}`);
            const t2 = Date.now();
            orders.say('come here');
            const both = await waitFor(async () => {
                const p = await entityPos(PLAYER);
                const [a, c] = [await entityPos(CLAUDE), await entityPos(GPT)];
                return a && c && p && cellDist(a, p) <= 2 && cellDist(c, p) <= 2 ? { a, c } : null;
            }, { ms: 20000, every: 500 });
            const pEnd = await entityPos(PLAYER);
            const [aEnd, cEnd] = [await entityPos(CLAUDE), await entityPos(GPT)];
            note(`2: after ${((Date.now() - t2) / 1000).toFixed(1)} s claude at ${fmt(aEnd)} (${cellDist(aEnd, pEnd).toFixed(1)} between the cells), gpt at ${fmt(cEnd)} (${cellDist(cEnd, pEnd).toFixed(1)})`);
            check(both.ok, '2: "come here" without a name: both bots are within 2 blocks of the player within 20 s', `claude ${cellDist(aEnd, pEnd).toFixed(1)}, gpt ${cellDist(cEnd, pEnd).toFixed(1)}`);

            const m = gpt();
            check(s.killed === null, 'the process of claude lives', String(s.killed));
            check(m && m.killed === null, 'the process of gpt lives', String(m?.killed));
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

    // The second bot gpt: started, placed 6 blocks east of the player, its fake model; it reports into STATUS every
    // 500 ms until STOP exists.
    async gpt() {
        const r = region(BASE_RADIUS);
        const b = basePlan(r, { owner: true, dump: loadDump() });
        const g = b.g;
        const playerAt = { x: b.ox - 2, y: g + 1, z: b.oz - 12 };
        let agent = null;
        const t0 = Date.now();
        try {
            const s = await startAgent(GPT, settingsOf(GPT));
            agent = s.agent;
            const asked = fakeBotModel(s, GPT);
            await resetBot(GPT);
            await placeBot(agent, { x: playerAt.x + 6, y: g + 1, z: playerAt.z }, 90);
            const write = (ready) => fs.writeFileSync(STATUS(), JSON.stringify({ ready, chats: s.chats, asked, killed: s.killed, realCalls: s.realCalls }));
            write(true);
            note(`gpt at ${fmt(agent.bot.entity?.position)} is ready`);
            while (!fs.existsSync(STOP()) && Date.now() - t0 < 280000) {
                write(true);
                await sleep(500);
            }
            write(true);
            check(s.killed === null, 'the process of gpt lives (phase)', String(s.killed));
            check(s.realCalls.length === 0, 'no request of gpt reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
        }
    },
});
exitSoon();
