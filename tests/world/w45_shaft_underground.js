// W45 the shaft is underground (v0.1.4.8 spec I2, A7; findings R1 and M8, owner's point 7).
// Defect of the play test: the depth under the surface was taken from the column above the bot and skipped
// built blocks; a ladder is a built block, so in a shaft the column was "air and ladders": depth 0, and the
// night reflex fired in the shaft at dusk ("shelter at dusk while in the shaft"; it also cut the shaft of the
// second session short at y 25). Against v0.1.4.7: at dusk, in the room under the house, the mode
// night_shelter runs and says "It is getting dark. I go to the shelter."
//
// Base world, the modes of the owner, the owner's packs; the house is the place "home" (a shelter by C4). The
// daylight cycle stands still at 12500 (dusk).
//   1. The bot in the room at y 41 under the house (the shaft with ladders above it): for 30 s the mode
//      night_shelter does not run, the text of the night is not said, the bot stays in the room. whereAmI
//      says underground (I2).
//   2. The same at the landing at y 25, under open ground.
//   3. Control: the bot on the surface at the farm: within 20 s the mode night_shelter runs (so parts 1 and 2
//      did not pass because the reflex was off). It comes last: the reflex waits 60 s after an attempt.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, commands, startTrace, importProject, env, saidSince, sleep,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, hdist, dist } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_shaft0148';
const DARK = 'It is getting dark. I go to the shelter.';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const { whereAmI } = await importProject('src/agent/reflex/where_am_i.js');

        let agent = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);

            async function stay(label, spot) {
                await placeBot(agent, spot, 0);
                const where = typeof agent.whereAmI === 'function' ? agent.whereAmI() : whereAmI(agent.bot);
                note(`${label}: where the bot is: ${JSON.stringify(where)}${typeof agent.whereAmI === 'function' ? '' : ' (agent.whereAmI of the glue is missing: the function of part A)'}`);
                check(where?.underground === true, `${label}: whereAmI says underground (I2)`, JSON.stringify(where));
                const t0 = Date.now();
                await commands(['time set 12500']);
                const trace = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);
                await sleep(30000);
                const rows = await trace.stop();
                await commands(['time set 6000']);
                const ran = rows.filter((x) => String(x.action).startsWith('mode:night_shelter'));
                const moved = Math.max(...rows.filter((x) => x.pos).map((x) => dist(x.pos, { x: spot.x + 0.5, y: spot.y, z: spot.z + 0.5 })));
                note(`${label}: 30 s at dusk; actions ${JSON.stringify([...new Set(rows.map((x) => x.action))])}; said ${JSON.stringify(saidSince(s, '', t0))}`);
                check(ran.length === 0, `${label}: the mode night_shelter did not run in 30 s at dusk`, `${ran.length} samples`);
                check(saidSince(s, DARK, t0).length === 0, `${label}: the bot did not say "${DARK}"`);
                check(moved < 2, `${label}: the bot stayed where it was`, `moved up to ${moved.toFixed(1)} blocks`);
            }

            await stay('1 (room at y 41)', b.room.middle);
            await stay('2 (landing at y 25)', b.landing.middle);

            // ---------------------------------------------------------- 3. control on the surface
            const top = { x: b.farm.outsideChest.x, y: g + 1, z: b.farm.outsideChest.z };
            await placeBot(agent, top, 90);
            const where = typeof agent.whereAmI === 'function' ? agent.whereAmI() : whereAmI(agent.bot);
            check(where?.underground === false, '3: on the surface whereAmI says not underground', JSON.stringify(where));
            const t3 = Date.now();
            await commands(['time set 12500']);
            const went = await waitFor(() => agent.actions.currentActionLabel.startsWith('mode:night_shelter') || saidSince(s, DARK, t3).length > 0, { ms: 20000, every: 200 });
            check(went.ok, '3: control: on the surface at dusk the mode night_shelter runs (the reflex is on)', `${(went.ms / 1000).toFixed(1)} s`);
            await waitFor(() => !agent.actions.currentActionLabel.startsWith('mode:night_shelter'), { ms: 90000, every: 500 });
            note(`3: the bot is at ${fmt(await entityPos(NAME))}, ${hdist(await entityPos(NAME), b.house.home).toFixed(1)} blocks from the place home`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['gamerule doDaylightCycle false', 'time set 6000']).catch(() => {});
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
