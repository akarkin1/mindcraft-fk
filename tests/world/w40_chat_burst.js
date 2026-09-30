// W40 chat burst (v0.1.4.8 fix round, X9; spec G).
// Defect found on the real server in stage 1: the bot said 11 chat lines in 2 s (the echo of typed commands,
// answers and texts of the modes) and the server kicked it ("Kicked for spamming"); the process ended with a
// wrong reason ("Server is under maintenance or restarting"). Against the build before the fix round: in A the
// 12 lines go out at once and the server kicks the bot; the kick phase prints the wrong reason.
// The correction: the chat of the bot has a limit, at most 6 lines at once and then 1 line per 1.2 s; nothing is
// lost, lines wait. The reason of a kick is printed as the server gave it.
//
// Flat world, the modes of the owner (MODES_PROFILE).
//   A  The bot says 12 lines at once (openChat, the path of every text of the bot): all 12 reach the player,
//      in order; the last one 6 s or more after the first (6 at once, then 1 per 1.2 s); no kick.
//   B  The player types 6 query commands 300 ms apart (their answers are long, several chat lines each): every
//      command answers, the player sees the start of every answer, no kick. In no 10 s did the player see more
//      than 15 lines of the bot (6 + 10 / 1.2).
//   kick  (a phase process of its own) The bot sends 14 chat packets straight to the server, past the limit:
//      the server kicks it; the process ends with a line that has "The server said:" and the reason of the
//      server ("Kicked for spamming"), not "maintenance".
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, orderChannel, runPhase, sleep, heardFrom, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_burst';
const PLAYER = 'w_player';
const SETTINGS = withModes({ ...NEW_FLAGS_OFF, ...FLAGS_0148_OFF, world_memory: true });
const QUERIES = ['!inventory', '!stats', '!nearbyBlocks', '!craftable', '!entities', '!modes'];

const r = region(20);
const g = r.g;
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();

await scenarioMain({
    async kick() {
        const s = await startAgent(NAME, SETTINGS);
        s.killExpected = true;
        await resetBot(NAME);
        await sleep(1000);
        for (let i = 0; i < 14; i++) s.agent.bot._client.chat(`spam ${i}`);
        await waitFor(() => false, { ms: 20000 });
        check(false, 'kick: the process ends after the kick', 'it still runs 20 s later');
    },

    async main() {
        await prepareRegion(r);
        try {
            let agent = null, orders = null;
            try {
                const s = await startAgent(NAME, SETTINGS);
                agent = s.agent;
                await resetBot(NAME);
                await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, 0);
                orders = await orderChannel(s, { name: PLAYER, at: { x: r.ox + 4, y: g + 1, z: r.oz } });
                await sleep(2000);

                // ------------------------------------------------ A: 12 lines at once
                const tA = Date.now();
                for (let i = 1; i <= 12; i++) agent.openChat(`burst line ${i} of 12`);
                const want = Array.from({ length: 12 }, (_, i) => `burst line ${i + 1} of 12`);
                const all = await waitFor(() => heardFrom(orders.player, NAME, tA).filter((t) => /^burst line \d+ of 12$/.test(squash(t))).length >= 12, { ms: 30000, every: 100 });
                const heardA = orders.player.heard.filter((x) => x.from === NAME && x.t >= tA && /^burst line/.test(squash(x.text)));
                const times = heardA.map((x) => x.t - heardA[0].t);
                note(`A: heard ${heardA.length} lines, at ${JSON.stringify(times)} ms after the first`);
                check(all.ok, 'A: all 12 lines reached the player (nothing is lost)', String(heardA.length));
                check(JSON.stringify(heardA.map((x) => squash(x.text))) === JSON.stringify(want), 'A: in order', JSON.stringify(heardA.map((x) => squash(x.text))));
                check(times.length === 12 && times[11] >= 6000, 'A: the last line came 6 s or more after the first (6 at once, then 1 per 1.2 s) (X9)', JSON.stringify(times));
                await sleep(1500);
                check(s.killed === null, 'A: the bot was not kicked', String(s.killed));

                // ------------------------------------------------ B: typed queries fast
                const tB = Date.now();
                const pending = [];
                for (const q of QUERIES) {
                    pending.push(orders.orderInfo(q, 60000));
                    await sleep(300);
                }
                const infos = await Promise.all(pending);
                await sleep(15000); // the queue may still hold lines
                const heardB = orders.player.heard.filter((x) => x.from === NAME && x.t >= tB);
                const joined = squash(heardB.map((x) => x.text).join(' '));
                for (const info of infos) {
                    const start = squash(info.reply).slice(0, 24);
                    note(`B: ${info.text} answered after ${(info.ms / 1000).toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 120))}`);
                    check(info.done && start !== '' && joined.includes(start), `B: ${info.text} answered and the player saw the start of the answer`, JSON.stringify(start));
                }
                let most = 0;
                for (const x of heardB) most = Math.max(most, heardB.filter((y) => y.t >= x.t && y.t < x.t + 10000).length);
                note(`B: the player saw ${heardB.length} lines of the bot; at most ${most} in 10 s`);
                check(most <= 15, 'B: in no 10 s did the player see more than 15 lines of the bot (6 + 10 / 1.2) (X9)', String(most));
                check(s.killed === null, 'B: the bot was not kicked', String(s.killed));
                check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
            } finally {
                if (orders) await orders.quit();
                await stopRealAgent(agent);
            }

            // ------------------------------------------------ the kick
            const kick = await runPhase(SELF, 'kick', {}, 90000, 1);
            const line = kick.lines.find((l) => l.includes('Agent process ends with exit code')) ?? '';
            note(`kick: ${line}`);
            check(/The server said: .*Kicked for spamming/.test(line), 'kick: the process prints the reason as the server gave it ("The server said: Kicked for spamming") (X9)', line || '(no line)');
            check(!/maintenance/i.test(line), 'kick: not "Server is under maintenance or restarting"', line);
            note(`world ${env.world}`);
        } finally {
            await releaseRegion(r);
        }
    },
});
exitSoon();
