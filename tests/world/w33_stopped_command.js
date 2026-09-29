// W33 stopped command reports (v0.1.4.8 spec I5, I6, A4, G3, E3; findings S3 and T1).
// Defect of the play test: an interrupted pack command returned nothing (runForText returned undefined when
// interrupted), its progress was lost and no turn of the model followed; chopTrees picked up the logs only
// after the whole tree and never when stopped (all 7 runs of the play test were interrupted, the logs stayed
// on the ground). Against v0.1.4.7: after !stop the history holds nothing about the cut logs, and the logs of
// the cut part of the tree lie on the ground.
//
// Base world (the house is a place only), the modes of the owner and the owner's packs. Four natural oak trees
// of 6 logs stand 12 to 16 blocks north of the house. The bot stands between the house and the trees.
//   The player types !chopTrees(20, "oak"). When at least 3 logs of the trees are gone (server), the player
//   types !stop. Then:
//   - !stop answers "Agent stopped." and the bot stands still within 2 s;
//   - the history holds "Command !chopTrees was stopped by !stop. Done so far: ..." (I5) with the text of I6
//     "I cut N oak_log and picked up M." where N is the number of logs that are gone from the trees (server)
//     and M is at most N and at most what the bot carried at the stop;
//   - no turn of the model started for the stopped command;
//   - the process lives.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, orderChannel, env, sleep,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, treePlan, buildTree, blockNames, hdist, itemsText, inventoryOf } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_stopped';
const PLAYER = 'w_player';
const STOPPED = /Command !chopTrees was stopped by !stop\. Done so far: ([\s\S]*)/;
const DONE = /I cut (\d+) oak_log and picked up (\d+)\./;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const trees = [[-8, -18], [-2, -21], [4, -18], [10, -21]].map(([dx, dz]) => treePlan(r.ox + dx, r.oz + dz, r.g, 6));
        for (const t of trees) await buildTree(t, { natural: true });
        const logs = trees.flatMap((t) => t.logs);
        const gone = async () => (await blockNames(logs, ['oak_log'])).filter((x) => x === null).length;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            const start = { x: r.ox + 1, y: r.g + 1, z: r.oz - 12 };
            await placeBot(agent, start, 180);
            orders = await orderChannel(s, { name: PLAYER, at: { x: r.ox - 14, y: r.g + 1, z: r.oz - 10 } });

            const requests0 = s.chat.requests.length;
            const chop = orders.orderInfo('!chopTrees(20, "oak")', 240000);
            const cut = await waitFor(async () => (await gone()) >= 3, { ms: 180000, every: 500 });
            check(cut.ok, 'precondition: the bot cut at least 3 logs of the trees before the stop', `${await gone()} logs gone`);
            const carried = (await inventoryOf(NAME)).oak_log || 0;
            const tStop = Date.now();
            const stop = await orders.orderInfo('!stop', 20000);
            const posStop = await entityPos(NAME);
            const c = await chop;
            await sleep(2000); // the bot is watched for 2 s after the stop
            const posAfter = await entityPos(NAME);
            const goneAtEnd = await gone();
            note(`!stop answered after ${((Date.now() - tStop) / 1000).toFixed(1)} s: ${JSON.stringify(stop.reply)}; !chopTrees answered ${JSON.stringify(c.reply.slice(0, 200))} (done ${c.done})`);
            note(`at the stop the bot carried ${carried} oak_log; ${goneAtEnd} logs are gone from the trees; the bot moved ${hdist(posStop, posAfter).toFixed(1)} blocks in the 2 s after the stop`);
            check(stop.reply.includes('Agent stopped.'), '!stop answers "Agent stopped."', JSON.stringify(stop.reply));
            check(c.done, 'the stopped !chopTrees ended (its order returned)');
            check(hdist(posStop, posAfter) < 2, 'the bot stands still after the stop', `${fmt(posStop)} -> ${fmt(posAfter)}`);

            const lines = s.added.filter((a) => a.name === 'system' && a.t >= tStop - 1000 && STOPPED.test(a.content)).map((a) => a.content);
            note(`the history after the stop: ${JSON.stringify(s.added.filter((a) => a.t >= tStop - 1000).map((a) => `${a.name}: ${a.content.slice(0, 200)}`))}`);
            check(lines.length === 1, 'the history holds "Command !chopTrees was stopped by !stop. Done so far: ..." once (I5)', JSON.stringify(lines));
            const done = lines.length ? DONE.exec(lines[0]) : null;
            check(Boolean(done), 'the text says what was cut and picked up: "I cut N oak_log and picked up M." (I6)', JSON.stringify(lines[0]?.slice(0, 300)));
            if (done) {
                const n = Number(done[1]), m = Number(done[2]);
                check(n === goneAtEnd, 'N is the number of logs that are gone from the trees (server)', `text ${n}, gone ${goneAtEnd}`);
                check(m <= n && m <= Math.max(carried, (await inventoryOf(NAME)).oak_log || 0), 'M is at most N and at most what the bot carries', `M ${m}, N ${n}, carried ${carried}`);
                if (m < n) check(/I was stopped before I picked up the rest\./.test(lines[0]), 'when not all were picked up the text says "I was stopped before I picked up the rest."', JSON.stringify(lines[0]));
            }
            const turns = s.chat.requests.slice(requests0).filter((q) => q.turns.some((t) => STOPPED.test(String(t.content))));
            check(turns.length === 0, 'no turn of the model started for the stopped command (G3)', `${turns.length} requests`);
            note(`the bot carries ${itemsText(await inventoryOf(NAME))}`);
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
