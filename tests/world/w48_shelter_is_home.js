// W48 the shelter is home (v0.1.4.8 spec C4, D2; findings R2 and M5).
// Defect of the play test: the shelter was the nearest saved "building". The house was never saved (it was a
// place only), so at dusk the shelter became the mine ("mining area", 0 doors) and later the pen (1 x 3 x 1):
// "I cannot get into the shelter" five times. Against v0.1.4.7 (where the mine and the pen are saved as
// buildings, the only type there was): at dusk the bot heads for the mine or the pen, not for the house.
//
// Base world, the modes of the owner, the owner's packs. The house is the place "home" only (no area). The
// player saves the mine (type mine) and the pen (type pen) with !setArea; both are nearer to the bot than the
// house. The bot stands east of the pen, 3 blocks from it, 15 from the house. The time is set to 12500 (dusk,
// the daylight cycle stopped).
//   - the mode night_shelter runs and says "It is getting dark. I go to the shelter.";
//   - within 120 s the bot is inside the house (server), the door is closed at the end;
//   - it never went into the pen or under the ground on the way.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, commands, orderChannel, startTrace, printTrace, sleep, env, saidSince,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen, distToBox } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_home';
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
        const mine = { min: b.mineBox.min, max: { ...b.mineBox.max, y: g - 6 } };
        const pen = { min: { ...b.pen.box.min }, max: { ...b.pen.box.max, y: g + 3 } };

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            const spot = { x: b.pen.box.max.x + 3, y: g + 1, z: b.pen.box.min.z + 4 };
            await placeBot(agent, spot, 90);
            orders = await orderChannel(s, { name: PLAYER, at: { x: spot.x + 6, y: g + 1, z: spot.z - 14 } });
            const m = await orders.order(`!setArea("mine", "mine", ${mine.min.x}, ${mine.min.y}, ${mine.min.z}, ${mine.max.x}, ${mine.max.y}, ${mine.max.z})`, 20000);
            const p = await orders.order(`!setArea("pen", "pen", ${pen.min.x}, ${pen.min.y}, ${pen.min.z}, ${pen.max.x}, ${pen.max.y}, ${pen.max.z})`, 20000);
            note(`!setArea answered ${JSON.stringify(m)} and ${JSON.stringify(p)}`);
            check(/Area "mine" \(mine\) saved:/.test(m) && /Area "pen" \(pen\) saved:/.test(p), 'precondition: the mine (type mine) and the pen (type pen) are saved');
            const at = await entityPos(NAME);
            note(`the bot stands ${distToBox(at, pen).toFixed(1)} blocks from the pen, ${distToBox(at, mine).toFixed(1)} from the mine, ${distToBox(at, b.house.box).toFixed(1)} from the house`);
            check(distToBox(at, pen) < distToBox(at, b.house.box) && distToBox(at, mine) < distToBox(at, b.house.box), 'precondition: the mine and the pen are nearer to the bot than the house');
            check(!agent.area_store?.list().some((a) => a.type === 'home'), 'precondition: no area of type home exists (the house is a place)');

            const t0 = Date.now();
            await commands(['time set 12500']);
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), open: await isOpen(b.house.door), action: agent.actions.currentActionLabel || '-' }), 400);
            const inside = await waitFor(async () => inBox(await entityPos(NAME), b.house.interior) && !agent.actions.currentActionLabel.startsWith('mode:night_shelter'), { ms: 120000, every: 500 });
            await sleep(3000);
            const rows = await trace.stop();
            const doorEnd = await isOpen(b.house.door);
            printTrace('dusk: the bot goes to the shelter', rows, { pos: (x) => fmt(x.pos), inHouse: (x) => (inBox(x.pos, b.house.interior) ? 'yes' : 'no'), door: (x) => (x.open ? 'open' : 'closed'), action: (x) => x.action }, 60);
            note(`the bot said ${JSON.stringify(saidSince(s, '', t0))}`);
            check(saidSince(s, DARK, t0).length >= 1, `the reflex said "${DARK}"`);
            check(rows.some((x) => String(x.action).startsWith('mode:night_shelter')), 'the mode night_shelter ran');
            check(inside.ok, 'the bot is inside the house (server), the place "home" is the shelter (C4)', fmt(await entityPos(NAME)));
            check(doorEnd === false, 'the door of the house is closed at the end (server)');
            check(!rows.some((x) => x.pos && inBox(x.pos, b.pen.inner)), 'the bot never went into the pen');
            check(!rows.some((x) => x.pos && x.pos.y < g), 'the bot never went under the ground (into the mine)');
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
