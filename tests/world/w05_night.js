// W05 night (spec section 8 "Night", H5 shouldShelter, G3 last_order, G4 night_shelter): home_pack and
// protected_areas on, world_memory on, the daylight cycle stopped, peaceful.
//   1. At 11000 (day) the player asks for dirt; the fake model answers !collectBlocks("dirt", 30).
//      While the bot collects, the time is set to 12000. Without any message and without any reply
//      of the model that names the shelter, the bot goes into the house and the door is closed.
//   2. At night the player asks for dirt again; the model answers !collectBlocks("dirt", 8). The
//      order given at night is obeyed: the bot collects the 8 dirt, the night reflex does not
//      interrupt it.
//   3. At 11000 the player says "follow me"; the model answers !followPlayer. The time is set to
//      12000 and the player walks away from the house: the bot keeps following.
// Every step is traced: time, position, action, door.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    waitFor, waitIdle, entityPos, fmt, connectPlayer, quitPlayer, heardFrom, startTrace, printTrace, sleep, tp, command, commands,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, isOpen, inBox, hdist, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot,
} from './world.js';

const NAME = 'w_night';
const PLAYER = 'w_player';
const DARK = 'It is getting dark. I go to the shelter.';

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        const h = housePlan(r.ox - 3, r.oz + 10, g);
        await buildHouse(h);
        const work = { x: h.door.x, y: g + 1, z: h.door.z - 20 };
        await commands(['time set 11000', 'gamerule doDaylightCycle false']);

        let agent = null, player = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, home_pack: true, protected_areas: true, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            check(agent.bot.modes.exists('night_shelter') && agent.bot.modes.isOn('night_shelter'), 'home_pack on: the mode night_shelter exists and is on');
            await placeBot(agent, h.inside, 0);
            const saved = await command_(agent, '!rememberArea("home", "home")', 30000); // v0.1.4.8: a shelter is an area of type home (C4)
            check(/Area "home" \(home\) saved: .*\b1 door\b/.test(saved), 'precondition: !rememberArea saved the house as "home" with its door', JSON.stringify(saved.slice(0, 200)));
            player = await connectPlayer(PLAYER);
            await command(`gamemode creative ${PLAYER}`);
            await placeBot(agent, work, 180);
            await tp(PLAYER, { x: work.x + 3, y: g + 1, z: work.z });
            await sleep(1000);

            const sample = async () => ({
                time: agent.bot.time?.timeOfDay, pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-',
                open: await isOpen(h.door), dirt: countDirt(agent),
            });
            const cols = {
                time: (x) => x.time, pos: (x) => fmt(x.pos), inside: (x) => (inBox(x.pos, h.interior) ? 'yes' : 'no'),
                action: (x) => x.action, door: (x) => (x.open ? 'open' : 'closed'), dirt: (x) => x.dirt,
            };

            // ---------------------------------------------------------- 1. ordered at day, then night
            s.route(/w_player: please collect some dirt/, '!collectBlocks("dirt", 30)');
            const t1 = Date.now();
            let trace = startTrace(sample, 300);
            player.chat('please collect some dirt');
            const working = await waitFor(() => agent.actions.currentActionLabel === 'action:collectBlocks' && countDirt(agent) >= 2, { ms: 30000, every: 200 });
            check(working.ok, '1: at day (11000) the bot collects dirt on the order of the player', `action ${agent.actions.currentActionLabel}, dirt ${countDirt(agent)}`);
            const requestsBeforeNight = s.chat.requests.length;
            await command('time set 12000');
            const tNight = Date.now();
            const sheltered = await waitFor(async () => inBox(await entityPos(NAME), h.interior) && (await isOpen(h.door)) === false && !String(agent.actions.currentActionLabel).startsWith('mode:night'),
                { ms: 90000, every: 500 });
            await sleep(1000);
            let rows = await trace.stop();
            printTrace('1: collecting dirt at day, then the time is set to 12000', rows, cols);
            note(`1: the bot was in the shelter with the door closed ${sheltered.ok ? ((Date.now() - tNight) / 1000).toFixed(1) + ' s after the time was set to 12000' : 'never'}`);
            check(sheltered.ok, '1: without any message the bot went into the house and the door is closed');
            check(countDirt(agent) < 30, '1: the collection of 30 dirt was interrupted for the shelter', `dirt ${countDirt(agent)}`);
            const replies = s.chat.requests.length;
            note(`1: the fake model got ${requestsBeforeNight} request(s) before the night and ${replies - requestsBeforeNight} after it`);
            const afterNight = s.sent.filter((x) => x.t >= tNight);
            check(afterNight.every((x) => x.reply.trim() === ''), '1: no reply of the model after nightfall contained a command (the reflex acted alone)',
                JSON.stringify(afterNight.map((x) => x.reply)));
            check(replies - requestsBeforeNight <= 2, '1: at most 2 requests reached the model after nightfall (the answer after the interrupted command and the AUTO MESSAGE of the reflex, G4)',
                `${replies - requestsBeforeNight} request(s)`);
            const said = heardFrom(player, NAME, t1);
            check(said.some((t) => t.includes(DARK)), `1: the bot said in the chat: ${DARK}`, JSON.stringify(said.slice(-6)));

            // ---------------------------------------------------------- 2. ordered at night: obeyed
            await waitIdle(agent, 20000);
            // Amendment 2 F4: the ground under the floor of the house is no candidate
            const under = { min: { x: h.box.min.x, y: g - 3, z: h.box.min.z }, max: { x: h.box.max.x, y: g - 1, z: h.box.max.z } };
            const underSnap = await snapshotBox(under);
            const dirtBefore = countDirt(agent);
            s.route(/w_player: collect 8 dirt for me please/, '!collectBlocks("dirt", 8)');
            const t2 = Date.now();
            trace = startTrace(sample, 300);
            player.chat('collect 8 dirt for me please');
            const started2 = await waitFor(() => agent.actions.currentActionLabel === 'action:collectBlocks', { ms: 20000, every: 100 });
            const done2 = await waitFor(() => countDirt(agent) >= dirtBefore + 8 || (started2.ok && agent.actions.currentActionLabel !== 'action:collectBlocks'),
                { ms: 90000, every: 250 });
            const tDone2 = Date.now();
            await sleep(1000);
            rows = await trace.stop();
            printTrace('2: at night the player orders 8 dirt', rows, cols);
            // the rows while the order ran: up to the first row whose action is no longer the order (the reflex may
            // start right after the order ended, in the same sample as the last dirt; seen in the fix round)
            const firstStart = rows.findIndex((x) => x.action === 'action:collectBlocks');
            const firstAfter = rows.findIndex((x, i) => i > firstStart && x.action !== 'action:collectBlocks');
            const during = firstStart < 0 ? [] : rows.slice(firstStart, firstAfter < 0 ? rows.length : firstAfter);
            const stoppedByNight = s.added.filter((a) => a.t >= t2 && /^Command !collectBlocks was stopped by the reflex night_shelter/.test(a.content)).map((a) => a.content);
            check(started2.ok, '2: at night the bot starts the ordered !collectBlocks("dirt", 8)');
            check(countDirt(agent) >= dirtBefore + 8, '2: the order given at night is obeyed: the bot collected 8 dirt', `dirt ${dirtBefore} -> ${countDirt(agent)}`);
            check(!during.some((x) => String(x.action).startsWith('mode:night_shelter')) && stoppedByNight.length === 0,
                '2: the night reflex did not interrupt the order given at night (no "Command !collectBlocks was stopped by the reflex night_shelter")',
                `${during.length} rows of the order; ${JSON.stringify(stoppedByNight.map((x) => x.slice(0, 120)))}`);
            const saidWhileWorking = player.heard.filter((x) => x.from === NAME && x.t >= t2 && x.t <= tDone2).map((x) => x.text);
            check(!saidWhileWorking.some((t) => t.includes(DARK)), '2: the bot did not announce the shelter while it worked on the order',
                JSON.stringify(saidWhileWorking.slice(-4)));
            // Amendment 2 F4: out through the door, the door closed again, nothing dug under the house
            check(rows.some((x) => x.open === true) && rows[rows.length - 1].open === false,
                '2: the bot left the house through the door and the door is closed again (F4)', `door at the end: ${rows[rows.length - 1].open ? 'open' : 'closed'}`);
            const underCmp = await compareSnapshot(underSnap, agent.bot);
            await dropSnapshot(underSnap).catch(() => {});
            check(underCmp.same, '2: no block under the floor of the house was taken (F4)', describeDifferences(underCmp.differences));

            // ---------------------------------------------------------- 3. following at night
            await command('time set 11000');
            await sleep(1000);
            if (agent.actions.executing) await waitIdle(agent, 60000);
            await tp(PLAYER, work);
            s.route(/w_player: follow me/, `!followPlayer("${PLAYER}", 3)`);
            player.chat('follow me');
            const following = await waitFor(async () => agent.actions.currentActionLabel === 'action:followPlayer'
                && hdist(await entityPos(NAME), await entityPos(PLAYER)) <= 5, { ms: 60000, every: 300 });
            check(following.ok, '3: at day the bot follows the player (!followPlayer ordered)', `action ${agent.actions.currentActionLabel}`);
            await command('time set 12000');
            trace = startTrace(async () => ({ ...(await sample()), player: await entityPos(PLAYER) }), 300);
            let p = { ...work };
            for (let i = 0; i < 8; i++) {
                p = { x: p.x - 2, y: g + 1, z: p.z - 2 };
                await tp(PLAYER, p);
                await sleep(1500);
            }
            await sleep(2500);
            rows = await trace.stop();
            printTrace('3: following the player at night', rows, { ...cols, player: (x) => fmt(x.player), gap: (x) => hdist(x.pos, x.player).toFixed(1) });
            const end = await entityPos(NAME);
            const gap = hdist(end, await entityPos(PLAYER));
            check(rows.every((x) => x.action === 'action:followPlayer'), '3: at night the bot keeps following (the action stays action:followPlayer)',
                JSON.stringify([...new Set(rows.map((x) => x.action))]));
            check(gap <= 6 && !inBox(end, h.interior), '3: at the end the bot is near the player, not in the house', `gap ${gap.toFixed(1)}, bot ${fmt(end)}`);
            player.chat('!stop');
            await sleep(1500);

            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await quitPlayer(player);
            await stopRealAgent(agent);
            await commands(['time set 6000']);
            await releaseRegion(r);
        }
    },
});
exitSoon();

function countDirt(agent) {
    try {
        return agent.bot.inventory.items().filter((i) => i.name === 'dirt').reduce((n, i) => n + i.count, 0);
    } catch { return 0; }
}
