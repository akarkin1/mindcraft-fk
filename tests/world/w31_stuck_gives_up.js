// W31 stuck gives up (v0.1.4.8 spec A2, setting stuck_restart_after; findings S1 and S2).
// Defect of the play test: 11 of the 20 ends of the process were "Got stuck and couldn't get unstuck": the
// mode unstuck ran moveAway(5) under a kill timer of 10 s and ended the process after ONE failed escape (for
// example at the bottom of the owner's shaft, where the escape could not get out in time). Against v0.1.4.7
// this scenario fails in round 1: in this room the escape returns at once without moving (seen on the test
// server: "Moved away from (x, y, z) to (x, y, z)."), v0.1.4.7 says "I'm free." and starts over every 20 s;
// it never gives up and nothing tells the model where the bot is stuck. (Where the escape did not return
// within 10 s, as in the owner's shaft, the timer ended the process.)
//
// Flat world, the modes of the owner (MODES_PROFILE), stuck_restart_after 3. The bot stands in a closed
// room of 1 x 1 x 2 blocks of obsidian (the path search finds no way out: "Path not found, but attempting to
// navigate anyway using destructive movements."). The player stands 10 blocks away.
//   round 1  The player types !followPlayer("w_player", 2); the bot cannot move. unstuck says "I'm stuck!",
//            the escape fails, the reflex gives up: the behaviour log gets "I am stuck at (x, y, z) and could
//            not walk away." with the position of the bot. The process lives. The player asks "where are
//            you?": the request to the model holds that line (the model is told the position).
//   round 2  A new order (!followPlayer again) ends the pause of the reflex; the second failed escape gives
//            up again. The process lives (2 failed escapes of 3).
//   round 3  The third failed escape in a row ends the process with "Got stuck and couldn't get unstuck"
//            (the meaning of the setting: failed escapes in a row before the restart).
// The rounds run in a phase process that must end with exit code 1 after round 3 (the kill), and must have
// passed rounds 1 and 2 before it (DATA rounds), so that a kill in round 1 cannot pass.
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, commands, orderChannel, runPhase, emitData, STUCK_SAID, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_stuck';
const PLAYER = 'w_player';
const GIVE_UP = /I am stuck at \((-?\d+), (-?\d+), (-?\d+)\) and could not walk away\./;
const KILL_TEXT = "Got stuck and couldn't get unstuck";

const r = region(24);
const g = r.g;
const CELL = { x: r.ox, y: g + 1, z: r.oz }; // the air of the room: CELL and the block above it

// A box of obsidian from g to g+3 around the column of CELL, with air at g+1 and g+2 in the middle.
async function buildRoom() {
    const out = await commands([
        `fill ${CELL.x - 1} ${g} ${CELL.z - 1} ${CELL.x + 1} ${g + 3} ${CELL.z + 1} minecraft:obsidian`,
        `fill ${CELL.x} ${g + 1} ${CELL.z} ${CELL.x} ${g + 2} ${CELL.z} minecraft:air`,
    ]);
    if (out.flat().some((l) => /not loaded|Incorrect|Unknown|Invalid/.test(l))) throw new Error('building the room failed: ' + out.flat().join(' | '));
}

// Waits for the next line of the give-up after index `from` of the behaviour log; returns { line, m } or null.
async function nextGiveUp(s, from, ms) {
    const got = await waitFor(() => s.behavior.slice(from).find((x) => GIVE_UP.test(x.text)), { ms, every: 250 });
    return got.ok ? { line: got.value.text, m: GIVE_UP.exec(got.value.text), t: got.value.t } : null;
}

await scenarioMain({
    async rounds() {
        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, ...FLAGS_0148_OFF, world_memory: true, stuck_restart_after: 3 }));
            agent = s.agent;
            await resetBot(NAME);
            const at = await placeBot(agent, CELL, 0);
            check(at && Math.floor(at.x) === CELL.x && Math.floor(at.z) === CELL.z, 'precondition: the bot stands in the closed room of obsidian', fmt(at));
            orders = await orderChannel(s, { name: PLAYER, at: { x: CELL.x + 10, y: g + 1, z: CELL.z } });

            // ---------------------------------------------------------- round 1
            let from = s.behavior.length;
            const t1 = Date.now();
            const o1 = orders.orderInfo(`!followPlayer("${PLAYER}", 2)`, 5000); // endless: it runs on
            const g1 = await nextGiveUp(s, from, 120000);
            await o1;
            const stuck1 = s.behavior.slice(from).filter((x) => x.text.includes(STUCK_SAID)).length;
            const pos1 = await entityPos(NAME);
            note(`round 1: ${((Date.now() - t1) / 1000).toFixed(1)} s after the order; behaviour log ${JSON.stringify(s.behavior.slice(from).map((x) => x.text))}`);
            check(stuck1 >= 1, `round 1: the mode unstuck found the bot stuck ("${STUCK_SAID}")`, `${stuck1} times`);
            check(Boolean(g1), 'round 1: the reflex gave up: "I am stuck at (x, y, z) and could not walk away." is in the behaviour log (A2)', g1 ? g1.line : 'no such line within 120 s');
            if (g1) {
                const said = { x: Number(g1.m[1]), y: Number(g1.m[2]), z: Number(g1.m[3]) };
                check(pos1 && Math.abs(said.x - Math.floor(pos1.x)) <= 1 && Math.abs(said.y - Math.floor(pos1.y)) <= 1 && Math.abs(said.z - Math.floor(pos1.z)) <= 1,
                    'round 1: the line names the position of the bot', `${JSON.stringify(said)} and the bot at ${fmt(pos1)}`);
            }
            check(s.killed === null, 'round 1: the process lives after the failed escape (stuck_restart_after 3)', String(s.killed));

            // the model is told the position: the next request to the model holds the line
            const before = s.chat.requests.length;
            orders.say('where are you?');
            const asked = await waitFor(() => s.chat.requests.slice(before).find((q) => q.turns.some((t) => GIVE_UP.test(String(t.content)))), { ms: 20000, every: 200 });
            const told = s.chat.requests.slice(before).map((q) => q.turns.map((t) => String(t.content)).filter((c) => /stuck/i.test(c)).join(' | ')).join(' || ');
            note(`round 1: what the model got about being stuck: ${JSON.stringify(told.slice(0, 400))}`);
            check(asked.ok, 'round 1: the model is told the position: a request to the model holds "I am stuck at (x, y, z) and could not walk away."', told.slice(0, 200));

            // ---------------------------------------------------------- round 2
            from = s.behavior.length;
            await waitFor(() => !agent.actions.executing || agent.actions.currentActionLabel === 'action:followPlayer', { ms: 10000 });
            const o2 = orders.orderInfo(`!followPlayer("${PLAYER}", 2)`, 5000);
            const g2 = await nextGiveUp(s, from, 120000);
            await o2;
            note(`round 2: behaviour log ${JSON.stringify(s.behavior.slice(from).map((x) => x.text))}`);
            check(Boolean(g2), 'round 2: after a new order the reflex found the bot stuck again and gave up again', g2 ? g2.line : 'no such line within 120 s');
            check(s.killed === null, 'round 2: the process lives after the second failed escape in a row', String(s.killed));
            emitData('rounds', 2);

            // ---------------------------------------------------------- round 3: the kill
            s.killExpected = true;
            from = s.behavior.length;
            orders.orderInfo(`!followPlayer("${PLAYER}", 2)`, 5000);
            const killed = await waitFor(() => s.killed !== null, { ms: 120000, every: 250 });
            // the process ends in cleanKill; this line is reached only when it did not
            check(false, 'round 3: the third failed escape in a row ends the process', killed.ok ? String(s.killed) : 'the process still runs 120 s after the third order');
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
        }
    },

    async main() {
        await prepareRegion(r);
        try {
            await buildRoom();
            const res = await runPhase(SELF, 'rounds', {}, 560000, 1);
            check(res.data.rounds === 2, 'rounds 1 and 2 passed before the process ended (it did not end at the first or second failed escape)', JSON.stringify(res.data));
            const killLine = res.lines.find((l) => l.includes('Agent process ends with exit code')) ?? '';
            check(killLine.includes(KILL_TEXT), `round 3: the process ended with "${KILL_TEXT}"`, killLine || '(no line)');
            note(`the phase ended with exit code ${res.code}; world ${env.world}`);
        } finally {
            await releaseRegion(r);
        }
    },
});
exitSoon();
