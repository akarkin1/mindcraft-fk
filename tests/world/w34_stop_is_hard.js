// W34 stop is hard (v0.1.4.8 spec B3, section 11.4 requestInterrupt; finding S9).
// Defect of the play test: the stop of the path search was soft (pathfinder.stop() sets a flag that is read
// only at the next node), so !stop did not stop a walk; !goToCoordinates did not stop within 10 s and the
// action manager ended the process: "Code execution refused stop after 10 seconds. Killing process." (end #10
// of the play test). Against v0.1.4.7 the bot walks on after !stop (up to the next node or longer), and a walk
// that does not reach a node within 10 s ends the process.
//
// Flat world, the modes of the owner. Three times: the player types !goToCoordinates to a place 70 blocks
// away; when the bot has walked 6, 14 and 22 blocks (so the stop falls on different moments of the walk) the
// player types !stop. Then: !stop answers "Agent stopped."; from the moment the agent received !stop the bot
// stands within 1 s (its server position changes by less than 0.3 blocks from 1 s after the stop on); it is
// not far past the place where it was stopped; the process lives. The positions are traced every 100 ms.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, orderChannel, startTrace, printTrace, sleep, waitIdle,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, hdist } from './world.js';

const NAME = 'w_hardstop';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, ...FLAGS_0148_OFF, world_memory: true }));
            agent = s.agent;
            orders = await orderChannel(s, { name: PLAYER, at: { x: r.ox, y: g + 1, z: r.oz + 20 } });
            for (const [k, walked] of [[1, 6], [2, 14], [3, 22]]) {
                await resetBot(NAME);
                const start = { x: r.ox - 35, y: g + 1, z: r.oz - 4 + 4 * k };
                const target = { x: r.ox + 35, y: g + 1, z: start.z };
                await placeBot(agent, start, -90);
                const trace = startTrace(async () => ({ pos: await entityPos(NAME), at: Date.now() }), 100);
                const walk = orders.orderInfo(`!goToCoordinates(${target.x + 0.5}, ${target.y}, ${target.z + 0.5}, 1)`, 90000);
                const far = await waitFor(async () => hdist(await entityPos(NAME), { x: start.x + 0.5, z: start.z + 0.5 }) >= walked, { ms: 30000, every: 100 });
                check(far.ok, `${k}: precondition: the bot walked ${walked} blocks towards the goal`);
                const stop = await orders.orderInfo('!stop', 20000);
                const tStop = stop.record?.t0 ?? Date.now(); // the moment the agent received !stop
                await sleep(3000);
                const rows = await trace.stop();
                const w = await walk;
                const at = (t) => rows.find((x) => x.pos && x.at >= t)?.pos ?? null;
                const posStop = at(tStop), pos1 = at(tStop + 1000), posEnd = rows[rows.length - 1]?.pos ?? null;
                const after1 = rows.filter((x) => x.pos && x.at >= tStop + 1000).map((x) => x.pos);
                const drift = after1.length ? Math.max(...after1.map((p) => hdist(p, pos1))) : Infinity;
                printTrace(`${k}: the walk and the stop`, rows.filter((x, i) => i % 3 === 0), { pos: (x) => fmt(x.pos) }, 40);
                note(`${k}: !stop answered ${JSON.stringify(stop.reply)} after ${stop.ms} ms; the walk answered ${JSON.stringify(w.reply.slice(0, 200))} (done ${w.done}); at the stop ${fmt(posStop)}, 1 s later ${fmt(pos1)}, at the end ${fmt(posEnd)}`);
                check(stop.reply.includes('Agent stopped.'), `${k}: !stop answers "Agent stopped."`, JSON.stringify(stop.reply));
                check(drift < 0.3, `${k}: the bot stands within 1 s of the stop (from 1 s after it on it moves less than 0.3 blocks)`, `moved ${drift.toFixed(2)} blocks after the first second`);
                check(posStop && pos1 && hdist(posStop, pos1) <= 4.5, `${k}: the bot did not walk on after the stop (at most the braking distance, 4.5 blocks, in the first second)`, `${hdist(posStop, pos1).toFixed(1)} blocks`);
                check(w.done, `${k}: the stopped !goToCoordinates ended`);
                check(s.killed === null, `${k}: the process lives (no "refused stop")`, String(s.killed));
                await waitIdle(agent, 10000);
            }
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
