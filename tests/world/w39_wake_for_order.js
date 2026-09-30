// W39 wake for an order (v0.1.4.8 fix round, X5; spec C, the sleep skill, and A, unstuck).
// Defect found on the real server in stage 2: after "I got up before the morning." the bot still lay in the bed
// (sleeping, its position the bed + 0.6875). The next orders !searchForEntity and !goToCoordinates timed out,
// !chopTrees ran 394 s until the morning; no "I'm stuck!", because sleeping counted as progress (long run
// orders 22 to 24, first full run). Against the build before the fix round: the bot stays in the bed while the
// typed command runs, and the command does not reach its goal.
// The correction: the sleep skill really gets up; every command that is not !goToBed wakes a sleeping bot
// first; sleeping counts as progress for unstuck only while !goToBed runs or no action runs.
//
// Base world, the modes of the owner, the owner's packs, the place "home" saved.
//   A  At 18000 the bot stands in the house, the player types !goToBed: the bot sleeps (its own view and the
//      server). 3 s later the player types !goToCoordinates to the north-west corner of the room (7 blocks):
//      within 10 s the bot is out of the bed (its own view and the server), the order reaches its goal
//      ("You have reached", the server sees the bot there), the order of !goToBed ended.
//   B  Day, the bot outside the door; at 13000 the reflex night_shelter takes it into the house. If the bot
//      is not asleep 60 s later, the player types !goToBed. When it sleeps, the player types
//      !searchForEntity("cow", 64): within 10 s the bot is out of the bed, within 20 s it is 8 blocks from the bed
//      (server), the command answers "You have reached" with the bot within 5.5 blocks of where the cow was
//      (the cow stands in the pen, behind its gate).
//   The process lives. The console has time stamps (log_timestamps), for the analysis of a failure.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, waitIdle, entityPos, fmt, commands, command, orderChannel, sleep, env, STUCK_SAID,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, hdist } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_wake';
const PLAYER = 'w_player';

// The server says whether the player sleeps: the entity has sleeping_pos (1.21.5 and later; SleepingX before)
// only while it lies in a bed.
async function serverSleeping() {
    const out = await commands([`data get entity ${NAME} sleeping_pos`, `data get entity ${NAME} SleepingX`]);
    return out.flat().some((l) => /has the following entity data/.test(l));
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const h = b.house;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF, log_timestamps: true }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            orders = await orderChannel(s, { name: PLAYER, at: { x: h.outsideDoor.x + 6, y: g + 1, z: h.outsideDoor.z - 6 } });

            // ------------------------------------------------ A: !goToBed, then !goToCoordinates
            await command('time set 18000');
            await placeBot(agent, { x: h.bedFoot.x + 1, y: g + 1, z: h.bedFoot.z - 1 }, 0);
            const bedOrder = orders.orderInfo('!goToBed', 180000);
            const sleptA = await waitFor(async () => agent.bot.isSleeping === true && (await serverSleeping()), { ms: 40000, every: 300 });
            if (!sleptA.ok) {
                const data = (await commands([`data get entity ${NAME}`])).flat().join(' ');
                const i = data.search(/leep/i);
                note(`A: the server data of the bot near "leep": ${i < 0 ? '(none)' : data.slice(Math.max(0, i - 40), i + 80)}`);
            }
            check(sleptA.ok, 'A: precondition: the bot sleeps after !goToBed (its own view and the server)', `isSleeping ${agent.bot.isSleeping}`);
            if (sleptA.ok) {
                await sleep(3000);
                const goal = { x: h.interior.min.x + 1, y: g + 1, z: h.interior.min.z + 1 };
                const tA = Date.now();
                const walk = orders.orderInfo(`!goToCoordinates(${goal.x}, ${goal.y}, ${goal.z}, 1)`, 60000);
                const up = await waitFor(async () => agent.bot.isSleeping === false && !(await serverSleeping()), { ms: 10000, every: 200 });
                const upAfter = (Date.now() - tA) / 1000;
                const rWalk = await walk;
                const rBed = await bedOrder;
                const end = await entityPos(NAME);
                note(`A: out of the bed ${up.ok ? upAfter.toFixed(1) + ' s' : 'not within 10 s'} after the order; the walk answered after ${(rWalk.ms / 1000).toFixed(1)} s ${JSON.stringify(rWalk.reply.slice(0, 160))}`);
                note(`A: !goToBed ended (${rBed.done}) with ${JSON.stringify(rBed.reply.slice(0, 200))}, stopped ${JSON.stringify(rBed.stopped.map((x) => x.slice(0, 160)))}`);
                check(up.ok, 'A: within 10 s of the typed command the bot got out of the bed (its own view and the server) (X5)', `isSleeping ${agent.bot.isSleeping}`);
                check(/You have reached/.test(rWalk.reply) && end && hdist(end, { x: goal.x + 0.5, z: goal.z + 0.5 }) < 2,
                    'A: the command reached its goal ("You have reached"; the server sees the bot there)', `${JSON.stringify(rWalk.reply.slice(0, 120))}, bot at ${fmt(end)}`);
                check(rBed.done, 'A: the order !goToBed ended');
            }

            // ------------------------------------------------ B: asleep by the reflex (or !goToBed), then !searchForEntity
            await command('time set 6000');
            await waitFor(async () => !agent.bot.isSleeping && !(await serverSleeping()), { ms: 10000, every: 250 });
            await waitIdle(agent, 30000);
            await placeBot(agent, h.outsideDoor, 180);
            await sleep(1000);
            await command('time set 13000');
            const sleptB = await waitFor(async () => agent.bot.isSleeping === true && (await serverSleeping()), { ms: 60000, every: 500 });
            let how = 'the reflex night_shelter';
            if (!sleptB.ok) {
                how = '!goToBed (the reflex did not put the bot to bed within 60 s)';
                await waitIdle(agent, 20000);
                orders.orderInfo('!goToBed', 180000);
                await waitFor(async () => agent.bot.isSleeping === true && (await serverSleeping()), { ms: 40000, every: 300 });
            }
            const asleep = agent.bot.isSleeping === true && (await serverSleeping());
            note(`B: asleep by ${how}: ${asleep}`);
            check(asleep, 'B: precondition: the bot sleeps', how);
            if (asleep) {
                await sleep(3000);
                const from = s.behavior.length;
                const bed = await entityPos(NAME);
                const cow0 = await entityPos('@e[tag=mcw_pen_cow,limit=1]');
                const tB = Date.now();
                const search = orders.orderInfo('!searchForEntity("cow", 64)', 90000);
                const up = await waitFor(async () => agent.bot.isSleeping === false && !(await serverSleeping()), { ms: 10000, every: 200 });
                const upAfter = (Date.now() - tB) / 1000;
                const walked = await waitFor(async () => { const p = await entityPos(NAME); return p && bed && hdist(p, bed) >= 8; }, { ms: 20000, every: 250 });
                const rSearch = await search;
                await sleep(1000);
                const cow = await entityPos('@e[tag=mcw_pen_cow,limit=1]');
                const end = await entityPos(NAME);
                const lines = s.behavior.slice(from).map((x) => x.text);
                note(`B: out of the bed ${up.ok ? upAfter.toFixed(1) + ' s' : 'not within 10 s'} after the order; 8 blocks from the bed ${walked.ok ? (walked.ms / 1000).toFixed(1) + ' s' : 'not within 20 s'} after it`);
                note(`B: !searchForEntity answered after ${(rSearch.ms / 1000).toFixed(1)} s ${JSON.stringify(rSearch.reply)}; the bot at ${fmt(end)}, the cow at ${fmt(cow0)} at the order and at ${fmt(cow)} at the end; behaviour ${JSON.stringify(lines)}`);
                check(up.ok, 'B: within 10 s of the typed command the bot got out of the bed (its own view and the server) (X5)', `isSleeping ${agent.bot.isSleeping}`);
                check(walked.ok, 'B: the command walked: within 20 s of the order the bot was 8 blocks from the bed (server)', fmt(await entityPos(NAME)));
                check(rSearch.done && /You have reached/.test(rSearch.reply) && end && cow0 && hdist(end, cow0) <= 5.5,
                    'B: !searchForEntity reached the cow ("You have reached"; the server sees the bot within 5.5 blocks of where the cow was at the order)',
                    `bot ${fmt(end)}, cow at the order ${fmt(cow0)}, ${JSON.stringify(rSearch.reply.slice(0, 160))}`);
                // an "I'm stuck!" after the bot had reached the cow is not about sleeping: noted (seen once: the command did
                // not end for 20 s after "You have reached" behind the gate of the pen, and unstuck stopped it)
                if (lines.includes(STUCK_SAID)) note(`B: "${STUCK_SAID}" while the command ran; stopped ${JSON.stringify(rSearch.stopped.map((x) => x.slice(0, 200)))}`);
            }
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
