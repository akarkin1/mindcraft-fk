// W72 no dig code from the model (v0.1.4.9 spec I8, G5, section 1 "No dig code from the model where a skill
// exists", 11 TW 3).
// New in v0.1.4.9: with skills_over_code, a !newAction of the model whose prompt (or the last message of the player)
// asks for digging is refused with a text that names the digging commands that are on, and the code model is never
// called; a !newAction that the player types runs. Against v0.1.4.8: the model wrote its own digging code (finding
// of the play test: code that dug without the rules of the mining pack).
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on with skills_over_code, the modes of the
// owner. The bot stands in the tunnel of the base.
//   1. The player writes "dig a tunnel to the east"; the fake model answers !newAction("dig a tunnel to the east").
//      The result in the history is the text of I8 with the three digging commands that are on: "I do not write
//      code for digging. I have skills for it: !mineOre for an ore, !rememberTunnel and then !mineOre to dig on in
//      a tunnel, !collectBlocks for blocks in sight."; the fake code model got no request; nothing around the bot
//      was dug.
//   2. The player types !newAction("dig a tunnel to the east") himself: it runs, the code model is asked (G5: a
//      command typed by the player runs).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    placeBot, waitFor, waitIdle, entityPos, sleep,
} from './helpers.js';
import { codeReply } from '../e2e/helpers.js';
import { region, prepareRegion, releaseRegion, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rcode';
const PLAYER = 'w_player';
const REFUSAL = 'I do not write code for digging. I have skills for it: !mineOre for an ore, !rememberTunnel and then !mineOre to dig on in a tunnel, !collectBlocks for blocks in sight.';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const cell = b.tunnel.cells[6];

        let agent = null, orders = null, snap = null;
        try {
            const s = await startAgent(NAME, settings0149({ skills_over_code: true, allow_insecure_coding: true }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });
            await placeBot(agent, cell, -90);
            snap = await snapshotBox({ min: { x: cell.x - 4, y: cell.y - 2, z: cell.z - 4 }, max: { x: cell.x + 8, y: cell.y + 3, z: cell.z + 4 } });

            // ---------------------------------------------------------- 1. the model asks for dig code
            const t1 = Date.now();
            s.route(/w_player: dig a tunnel to the east/, '!newAction("dig a tunnel to the east")');
            orders.say('dig a tunnel to the east');
            const back = await waitFor(() => s.added.find((a) => a.t >= t1 && a.name === 'system' && a.content.includes('I do not write code')), { ms: 60000, every: 250 });
            await waitIdle(agent, 30000);
            await sleep(2000);
            const results = s.added.filter((a) => a.t >= t1 && a.name === 'system').map((a) => a.content);
            note(`1: the system lines of the history: ${JSON.stringify(results.map((x) => x.slice(0, 300)))}`);
            check(back.ok, '1: the result of the !newAction of the model came back into the history');
            check(Boolean(back.value?.content?.includes(REFUSAL)), '1: the result is the text of I8 with !mineOre, !rememberTunnel and !collectBlocks', JSON.stringify(back.value?.content));
            check(s.code.requests.length === 0, '1: the fake code model got no request', `${s.code.requests.length} requests`);
            const cmp = await compareSnapshot(snap);
            check(cmp.same, '1: nothing around the bot was dug or placed', describeDifferences(cmp.differences));
            note(`1: the bot is at ${fmt(await entityPos(NAME))}`);

            // ---------------------------------------------------------- 2. the player types it
            s.code.replies.push(codeReply("log(bot, 'I only looked around.');"));
            const typed = await orders.orderInfo('!newAction("dig a tunnel to the east")', 120000);
            note(`2: the typed !newAction answered ${JSON.stringify(typed.reply.slice(0, 300))}; the code model got ${s.code.requests.length} request(s)`);
            check(s.code.requests.length >= 1, '2: a !newAction typed by the player runs: the code model is asked (G5)', `${s.code.requests.length} requests`);
            check(!typed.reply.includes('I do not write code for digging'), '2: the typed !newAction is not refused', JSON.stringify(typed.reply.slice(0, 200)));
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
