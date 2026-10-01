// W80 the first minutes (journey, tester T3): the owner's first minutes in his house with a bot that knows nothing,
// from the player's side (PLAYTEST.md of v0.1.4.9, sections 2, 3 and 5; the owner's play log of 2026-10-01 04:12:
// "you're exactly at home, buddy" -> !rememberArea("home", "home"); "follow me, down the basement" ->
// !followPlayer("MartyByrde2", 3); "Remember the path here from the house" -> !rememberRoute("basement"), answered
// "The way "basement" is too short: I stand where it starts." five times; "now, go the basement" ->
// !goToRememberedPlace("basement")).
//
// The owner variant of the base (the basement under the house, the trapdoor closed), the owner's switches, the modes of
// his profile, an empty memory. The bot is never moved by the control. The bot and the player stand in the house.
// Part A of journey.js:
//   A0 !rememberArea("home", "home"); A1 !followPlayer("w_player", 3), the player goes down ladder 1 and waits in the
//   basement: within 60 s the bot is there; A2 the trapdoor is closed within 10 s after the bot passed it; A3
//   !rememberRoute("basement") names 1 ladder and 1 trapdoor; A4 the player climbs back up, !goToPlayer: the bot is in
//   the house within 60 s; A5 !goToRememberedPlace("basement"): the bot is in the basement within 60 s.
// And: nothing in the house, the shafts and the basement was dug or placed (the trapdoor may be open or closed); the
// process lives; no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env } from './helpers.js';
import { region, prepareRegion, releaseRegion, snapshotBox, compareSnapshot, describeDifferences, dropSnapshot } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { startJourney, partFirstMinutes, spots } from './journey.js';

const NAME = 'w_first';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r, { owner: true });
        await buildBase(b);
        const sp = spots(b);
        let agent = null, orders = null, snap = null;
        try {
            const j = await startJourney(NAME, b, { botAt: { x: sp.houseMiddle.x - 1, y: b.g + 1, z: sp.houseMiddle.z + 1 }, playerAt: sp.besideTrapdoor });
            agent = j.agent;
            orders = j.orders;
            snap = await snapshotBox(b.owner.homeBox);
            const a = await partFirstMinutes({ ...j, b });
            note(`part A ${a.ok ? 'passed' : 'FAILED'}`);
            const cmp = await compareSnapshot(snap);
            check(cmp.same, 'nothing in the house, the ladder shafts and the basement was dug or placed (doors and the trapdoor may be open or closed)', describeDifferences(cmp.differences));
            check(j.s.killed === null, 'the process lives', String(j.s.killed));
            check(j.s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(j.s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
