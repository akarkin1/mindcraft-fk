// W71 dusk on the way into the mine (v0.1.4.9 spec I7, B8, G9, section 1 "On the mine route the bot is
// underground", 11 TW 3).
// New in v0.1.4.9: with mine_routes the bot is underground wherever it is in a known mine, also on the way in (the
// cells of the legs of its route: the ladder column), so the night reflex leaves it alone there. Against v0.1.4.8:
// on the ladder under the trapdoor of the house the column above is the trapdoor, the floor of the house and its
// roof, and whether the bot counts as underground depends on the depth rule alone (findings R1 and M8: the reflex
// fired in the shaft at dusk).
//
// Base world, the owner's switches and settings, the switches of v0.1.4.9 on, the modes of the owner; the house is
// the place "home". The bot learns the mine as in W65. Then:
//   1. The bot is put on the ladder of the shaft (the ladder leg of the route), half way up, and holds there
//      (sneak; it is put back up when it slides below the middle). whereAmI says underground, in the mine "mine",
//      on its way in. The time is set to dusk (12500): for 60 s the mode night_shelter does not run and the text of
//      the night is not said; the bot stays on the ladder run.
//   2. Control: the bot on the surface at the farm at dusk: within 20 s the mode night_shelter runs (the reflex is
//      on, so part 1 did not pass because it was off).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, settings0149, resetBot, fmt, env, orderChannel, commands,
    walkIntoMine, placeBot, entityPos, waitFor, saidSince, sleep, tp,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, hdist } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_rdusk';
const PLAYER = 'w_player';
const DARK = 'It is getting dark. I go to the shelter.';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const col = b.shaft.column;
        const mid = Math.round((b.room.box.min.y + g) / 2); // y 51 in the base

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, settings0149());
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.door.x + 8, y: g + 1, z: b.house.door.z - 8 } });

            const walk = await walkIntoMine(agent, orders, b);
            check(walk.ok, 'precondition: the bot walked into the mine to the end of the tunnel', fmt(walk.at));
            const said = await orders.order('!rememberMine("mine")', 30000);
            note(`!rememberMine("mine") answered ${JSON.stringify(said)}`);
            check(/^I remember the mine "mine":.* 1 ladder/.test(said), 'precondition: the mine "mine" is known with the ladder on its way in', JSON.stringify(said));

            // ---------------------------------------------------------- 1. on the ladder at dusk
            const spot = { x: col.x, y: mid + 3, z: col.z };
            await tp(NAME, spot, 180, 0);
            agent.bot.setControlState('sneak', true);
            await sleep(1500);
            const where = agent.whereAmI();
            note(`on the ladder at ${fmt(await entityPos(NAME))}: whereAmI ${JSON.stringify(where)}`);
            check(where?.underground === true && where?.mine?.name === 'mine' && where.mine.onRoute === true, '1: whereAmI on the ladder: underground, in the mine "mine", on its way in (I7)', JSON.stringify(where));
            const t0 = Date.now();
            await commands(['time set 12500']);
            const rows = [];
            let putBack = 0;
            while (Date.now() - t0 < 60000) {
                const pos = await entityPos(NAME);
                rows.push({ t: (Date.now() - t0) / 1000, pos, action: agent.actions.currentActionLabel || '-' });
                if (pos && pos.y < mid && !String(agent.actions.currentActionLabel).startsWith('mode:night_shelter')) {
                    putBack++;
                    await tp(NAME, spot, 180, 0);
                    agent.bot.setControlState('sneak', true);
                }
                await sleep(500);
            }
            agent.bot.setControlState('sneak', false);
            await commands(['time set 6000']);
            const ran = rows.filter((x) => String(x.action).startsWith('mode:night_shelter'));
            const onRun = rows.filter((x) => x.pos && Math.floor(x.pos.x) === col.x && Math.floor(x.pos.z) === col.z && x.pos.y > b.room.box.min.y + 1 && x.pos.y < g);
            note(`1: 60 s at dusk: actions ${JSON.stringify([...new Set(rows.map((x) => x.action))])}; put back up ${putBack} times; ${onRun.length} of ${rows.length} samples on the ladder run; said ${JSON.stringify(saidSince(s, '', t0))}`);
            check(ran.length === 0, '1: the mode night_shelter did not run in 60 s at dusk on the ladder', `${ran.length} samples`);
            check(saidSince(s, DARK, t0).length === 0, `1: the bot did not say "${DARK}"`);
            check(onRun.length >= rows.length - 2, '1: the bot stayed on the ladder run of the mine route', `${onRun.length} of ${rows.length}`);

            // ---------------------------------------------------------- 2. control on the surface
            await sleep(2000);
            const top = { x: b.farm.outsideChest.x, y: g + 1, z: b.farm.outsideChest.z };
            await placeBot(agent, top, 90);
            const t2 = Date.now();
            await commands(['time set 12500']);
            const went = await waitFor(() => String(agent.actions.currentActionLabel).startsWith('mode:night_shelter') || saidSince(s, DARK, t2).length > 0, { ms: 20000, every: 200 });
            check(went.ok, '2: control: on the surface at dusk the mode night_shelter runs (the reflex is on)', `${(went.ms / 1000).toFixed(1)} s`);
            await waitFor(() => !String(agent.actions.currentActionLabel).startsWith('mode:night_shelter'), { ms: 90000, every: 500 });
            note(`2: the bot is at ${fmt(await entityPos(NAME))}, ${hdist(await entityPos(NAME), b.house.home).toFixed(1)} blocks from the place home`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['gamerule doDaylightCycle false', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
