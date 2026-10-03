// W38 order after stuck (v0.1.4.8 fix round, X3; spec A2).
// Defect found on the real server in stage 2: once unstuck had fired, it stopped the next orders of the player
// 0.2 to 20 s after they started ("Command !goToSurface was stopped by the reflex unstuck" 0.2 s after the
// order; the same for !storeItems; long run orders 30, 37, 39, 40): the time without progress was not started
// from zero for a new action. W31 did not see it: its second order may be stopped at once and still pass.
// Against the build before the fix round: in step 2 "I'm stuck!" comes within a second of the order, in step 3
// orders are stopped by the reflex unstuck.
// The correction: the stuck time starts from zero when a new action starts; a reflex that gave up does not fire
// again before the new command had its 20 s.
//
// Flat world, the modes of the owner (MODES_PROFILE), stuck_restart_after 3. A closed room of 1 x 1 x 2 blocks
// of obsidian (as in W31), the player 10 blocks away.
// v0.1.4.11: in place of the typed follow, steps 1 and 2 start an action of the agent that walks toward the player again
// and again (walkOut below: a follow that finds no way now says so and ends, N2 and W97; this tests the reflex).
//   1. The bot in the room, the walk toward the player starts: "I'm stuck!", the escape fails, the reflex gives
//      up ("I am stuck at (x, y, z) and could not walk away.").
//   2. At once (within a second of that line) the walk starts again (a new command for the reflex). The bot still cannot move,
//      so unstuck fires again, but not before the new command had its 20 s: the first "I'm stuck!" after the
//      order comes 18 s after it or later.
//   3. !stop; the bot is put on open ground and at once the player types three !goToCoordinates in a row, each
//      8 to 12 blocks: every one reaches its goal and none is stopped by the reflex unstuck.
// The process lives (2 failed escapes of 3).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, commands, orderChannel, sleep, tp, STUCK_SAID, importProject,
} from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';

const NAME = 'w_afterstuck';
const PLAYER = 'w_player';
const GIVE_UP = /I am stuck at \(-?\d+, -?\d+, -?\d+\) and could not walk away\./;

// v0.1.4.11 (N2, W97): no typed order keeps the bot trying in the closed room any more: a follow that finds no way to
// the player says so and ends, a walk without a way ends within a second (and every new action starts the stuck time
// from zero), !newAction pauses the reflex, and a follow with the player in reach is no being stuck. So in place of the
// order the scenario starts an action of the agent, as a typed command starts one (the label action:walkOut counts as a
// new command for the reflex), that walks toward the player 10 blocks away again and again until it is stopped. It is
// not awaited: the reflex stops it.
let skillsLib = null;
async function walkOut(agent, to) {
    skillsLib ??= await importProject('src/agent/library/skills.js');
    agent.actions.runAction('action:walkOut', async () => {
        for (let i = 0; i < 600 && !agent.bot.interrupt_code; i++) {
            await skillsLib.goToPosition(agent.bot, to.x, to.y, to.z, 1);
            await sleep(500);
        }
    }, { timeout: 15 }).catch(() => {});
}

const r = region(30);
const g = r.g;
const CELL = { x: r.ox - 10, y: g + 1, z: r.oz - 10 };

await scenarioMain({
    async main() {
        await prepareRegion(r);
        let agent = null, orders = null;
        try {
            await commands([
                `fill ${CELL.x - 1} ${g} ${CELL.z - 1} ${CELL.x + 1} ${g + 3} ${CELL.z + 1} minecraft:obsidian`,
                `fill ${CELL.x} ${g + 1} ${CELL.z} ${CELL.x} ${g + 2} ${CELL.z} minecraft:air`,
            ]);
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, ...FLAGS_0148_OFF, world_memory: true, stuck_restart_after: 3 }));
            agent = s.agent;
            await resetBot(NAME);
            const at = await placeBot(agent, CELL, 0);
            check(at && Math.floor(at.x) === CELL.x && Math.floor(at.z) === CELL.z, 'precondition: the bot stands in the closed room of obsidian', fmt(at));
            orders = await orderChannel(s, { name: PLAYER, at: { x: CELL.x + 10, y: g + 1, z: CELL.z } });
            const to = { x: CELL.x + 10, y: g + 1, z: CELL.z }; // the player, 10 blocks away

            // ---------------------------------------------------------- 1. the reflex gives up
            let from = s.behavior.length;
            await walkOut(agent, to);
            const g1 = await waitFor(() => s.behavior.slice(from).find((x) => GIVE_UP.test(x.text)), { ms: 120000, every: 100 });
            note(`1: the behaviour log ${JSON.stringify(s.behavior.slice(from).map((x) => x.text))}`);
            check(g1.ok, '1: precondition: the reflex gave up in the closed room', g1.ok ? g1.value.text : 'no give-up within 120 s');

            // ---------------------------------------------------------- 2. a new order right after
            from = s.behavior.length;
            const t2 = Date.now();
            await walkOut(agent, to);
            const stuck2 = await waitFor(() => s.behavior.slice(from).find((x) => x.text.includes(STUCK_SAID)), { ms: 60000, every: 100 });
            const after = stuck2.ok ? (stuck2.value.t - t2) / 1000 : null;
            note(`2: the order was typed ${g1.ok ? ((t2 - g1.value.t) / 1000).toFixed(1) : '?'} s after the give-up; the first "${STUCK_SAID}" after it came ${after === null ? 'never (60 s)' : after.toFixed(1) + ' s'} after the order`);
            check(after === null || after >= 18, `2: the new command had its 20 s: the first "${STUCK_SAID}" came 18 s after the order or later (X3)`, after === null ? 'none' : `${after.toFixed(1)} s`);
            await waitFor(() => s.behavior.slice(from).some((x) => GIVE_UP.test(x.text)), { ms: 40000, every: 250 });
            note(`2: the behaviour log ${JSON.stringify(s.behavior.slice(from).map((x) => x.text))}`);
            check(s.killed === null, '2: the process lives', String(s.killed));

            // ---------------------------------------------------------- 3. orders on open ground
            await orders.order('!stop', 20000);
            const goals = [
                { x: r.ox + 2, y: g + 1, z: r.oz - 2 },
                { x: r.ox + 12, y: g + 1, z: r.oz + 4 },
                { x: r.ox + 4, y: g + 1, z: r.oz + 12 },
            ];
            await placeBot(agent, { x: r.ox - 6, y: g + 1, z: r.oz - 6 }, 0);
            await tp(PLAYER, { x: r.ox + 18, y: g + 1, z: r.oz + 18 });
            for (let k = 0; k < goals.length; k++) {
                const p = goals[k];
                const info = await orders.orderInfo(`!goToCoordinates(${p.x}, ${p.y}, ${p.z}, 1)`, 90000);
                const end = await entityPos(NAME);
                const byUnstuck = info.stopped.filter((l) => /stopped by the reflex unstuck/.test(l));
                note(`3.${k + 1}: ${(info.ms / 1000).toFixed(1)} s, ${JSON.stringify(info.reply.slice(0, 160))}, stopped ${JSON.stringify(info.stopped.map((x) => x.slice(0, 120)))}, the bot at ${fmt(end)}`);
                check(byUnstuck.length === 0, `3.${k + 1}: the order was not stopped by the reflex unstuck (X3)`, JSON.stringify(byUnstuck));
                check(/You have reached/.test(info.reply) && end && Math.hypot(end.x - (p.x + 0.5), end.z - (p.z + 0.5)) < 2,
                    `3.${k + 1}: the order reached its goal (server)`, `${JSON.stringify(info.reply.slice(0, 120))}, bot at ${fmt(end)}`);
            }
            await sleep(1000);
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
