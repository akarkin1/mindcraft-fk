// W56 the farm scan (v0.1.4.8 spec D5, section 11.10 !rememberArea; finding P5).
// Defect of the play test: !rememberArea("farm", "farm") failed 5 times: the scan started at the bot, which
// stood outside the fence or on the gate; the reason was thrown away and every failure got the same text ("I
// found no fenced ground here. Stand inside the fence and try again."). Against v0.1.4.7 the same text comes
// here and no area is saved.
//
// Base world, the modes of the owner, the owner's packs. The bot stands 3 blocks north of the closed gate of
// the farm, outside the fence. The player types !rememberArea("farm", "farm"). Then:
//   - the answer ends with "Area "farm" (farm) saved: X x Y x Z blocks, from (...) to (...), 1 gate. Tell me if
//     that is wrong." (a sentence about the walk in through the gate may come before it, 11.10);
//   - the area "farm" of type farm is in the store, its box holds the whole fence ring of the farm and nothing
//     of the house or the pen;
//   - the gate is closed at the end (the bot may have walked in through it, 11.10).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, orderChannel, waitFor, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, isOpen, inBox } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_farmscan';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const f = b.farm;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await placeBot(agent, f.outsideGate, 180);
            check(!inBox(await agent.bot.entity.position, f.box), 'precondition: the bot stands outside the fence');
            orders = await orderChannel(s, { name: PLAYER, at: { x: f.outsideGate.x + 8, y: g + 1, z: f.outsideGate.z - 6 } });

            const reply = await orders.order('!rememberArea("farm", "farm")', 90000);
            note(`!rememberArea("farm", "farm") answered ${JSON.stringify(reply)}`);
            const area = agent.area_store?.get('farm') ?? null;
            note(`the area in the store: ${JSON.stringify(area)}`);
            check(/(^|\. )Area "farm" \(farm\) saved: \d+ x \d+ x \d+ blocks, from \(-?\d+, -?\d+, -?\d+\) to \(-?\d+, -?\d+, -?\d+\), 1 gate\. Tell me if that is wrong\.$/.test(reply),
                'the answer ends with "Area "farm" (farm) saved: ..., 1 gate. Tell me if that is wrong."', JSON.stringify(reply));
            check(area?.type === 'farm', 'the area "farm" of type farm is saved', JSON.stringify(area?.type));
            const ring = f.fenceRing;
            check(area && ring.every((p) => p.x >= area.min.x && p.x <= area.max.x && p.z >= area.min.z && p.z <= area.max.z && p.y >= area.min.y && p.y <= area.max.y),
                'the box holds the whole fence ring of the farm', JSON.stringify(area && { min: area.min, max: area.max }));
            const overlaps = (box) => area && !(area.max.x < box.min.x || area.min.x > box.max.x || area.max.z < box.min.z || area.min.z > box.max.z);
            check(area && !overlaps(b.house.box) && !overlaps(b.pen.box), 'the box holds nothing of the house or the pen');
            const closed = await waitFor(async () => (await isOpen(f.gate, 'oak_fence_gate')) === false, { ms: 10000, every: 250 });
            check(closed.ok, 'the gate is closed at the end (server)');
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
