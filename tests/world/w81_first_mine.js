// W81 the first mine (journey, tester T3): the owner teaches the bot his mine by walking it, then asks for iron, from
// the player's side (PLAYTEST.md of v0.1.4.9, sections 3 and 4, steps 1 to 3 and 7; the Luna session of 2026-10-01
// 03:17: "follow me, I'll show you the mine" -> !followPlayer("MartyByrde2", 4); "remember this mine" ->
// !rememberMine("mine"), answered "... the way in has 10 steps with 2 ladders and 2 doors, the room at level 41 ...";
// "collect some iron ores for me" -> !mineOre("iron", 16), which ended "I could not get to the way out").
//
// The owner variant of the base (ladder 2 ends 2 blocks above the floor of the room, the double door), the owner's
// switches, the modes of his profile, an empty memory, and the kit the owner's chest would give: 8 ladders, 16
// torches, a stone pickaxe. The bot is never moved by the control. The bot and the player stand outside in front of
// the house door (PLAYTEST step 1: under the open sky). Part B of journey.js:
//   B1 !followPlayer("w_player", 4): the player walks into the house, down ladder 1, down ladder 2, through the double
//   door and down to the end of the tunnel, waiting for the bot after every leg (60 s each);
//   B2 !rememberMine("mine") names 2 ladders and the room;
//   B3 4 iron ore beyond the end of the tunnel, !mineOre("iron", 4): within 5 minutes the bot has 4 raw_iron in its
//   inventory, is back on the surface, the trapdoor is closed, a torch stands in the dug part of the tunnel.
// And: the process lives; no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env } from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { startJourney, partFirstMine, spots } from './journey.js';

const NAME = 'w_fmine';
export const KIT = [['ladder', 8], ['torch', 16], ['stone_pickaxe', 1]];

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r, { owner: true });
        await buildBase(b);
        const sp = spots(b);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, { botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT });
            agent = j.agent;
            orders = j.orders;
            const m = await partFirstMine({ ...j, b }, { from: 'outside' });
            note(`part B ${m.ok ? 'passed' : 'FAILED'}`);
            check(j.s.killed === null, 'the process lives', String(j.s.killed));
            check(j.s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(j.s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
