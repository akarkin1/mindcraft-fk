// W82 "come here" across the floors (journey, tester T3): the owner calls the bot from another floor, from the
// player's side (the owner's play log of 2026-10-01 02:54: "come here" -> !goToPlayer("MartyByrde2", 3), stopped by
// unstuck, process ended; the Luna session 03:50: "c'mon. come here, to me. I am in the house" ->
// !goToPlayer("MartyByrde2", 0) from the basement).
//
// The owner variant of the base (the trapdoor closed), the owner's switches, the modes of his profile, an empty
// memory. The bot is never moved by the control: it is put in the house at the start, then only the player moves.
//   1. The bot in the house, the player in the basement: the typed !goToPlayer("w_player", 3) brings the bot into the
//      basement within 60 s, within 4 blocks of the player.
//   2. The player goes up into the house (through the trapdoor, closing it behind him), the bot is in the basement:
//      !goToPlayer brings the bot into the house within 60 s, within 4 blocks of the player.
//   3. The player stands in the mine room (y 41: down ladder 1, the basement, ladder 2 that ends 2 blocks above the
//      floor), the bot in the house: !goToPlayer brings the bot to y 41 within 120 s, within 4 blocks of the player.
// And: the process lives; no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, tp, sleep, setTrapdoor } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { startJourney, spots, inBasement, PLAYER, journeyTrace, printJourney, playerUpToHouse, saidLines, walkPlayer, line } from './journey.js';

const NAME = 'w_comeh';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r, { owner: true });
        await buildBase(b);
        const sp = spots(b);
        const g = b.g;
        let agent = null, orders = null, trace = null;
        try {
            const j = await startJourney(NAME, b, { botAt: sp.houseMiddle, playerAt: sp.basementWait });
            agent = j.agent;
            orders = j.orders;
            trace = journeyTrace(agent, b);
            const tStart = Date.now();
            const come = async (label, box, ms) => {
                const t0 = Date.now();
                const info = await orders.orderInfo(`!goToPlayer("${PLAYER}", 3)`, ms);
                const a = await entityPos(NAME);
                const p = await entityPos(PLAYER);
                const secs = (Date.now() - t0) / 1000;
                note(`${label}: !goToPlayer answered after ${secs.toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 300))}; the bot at ${fmt(a)}, the player at ${fmt(p)}`);
                check(info.done && (box ? inBox(a, box) : inBasement(b, a)) && dist(a, p) <= 4, `${label} within ${ms / 1000} s, within 4 blocks of the player`, `${fmt(a)}, ${dist(a, p).toFixed(1)} blocks, ${secs.toFixed(1)} s`);
            };

            // 1. down: the player in the basement
            await come('1: "come here" from the basement brings the bot down into the basement', null, 60000);

            // 2. up: the player climbs into the house and closes the trapdoor behind him
            await playerUpToHouse(b, sp.basementWait);
            await setTrapdoor(b, false);
            await walkPlayer(line(sp.besideTrapdoor, { x: sp.houseMiddle.x, y: g + 1, z: sp.besideTrapdoor.z }));
            await sleep(1000);
            await come('2: "come here" from the house brings the bot up into the house', b.house.interior, 60000);

            // 3. the player in the mine room, the bot in the house
            await tp(PLAYER, sp.roomWait);
            await sleep(1500);
            await come('3: "come here" from the mine room brings the bot down two ladders to y 41', b.room.box, 120000);

            note(`the bot said ${JSON.stringify(saidLines(j.s, tStart).slice(0, 30))}`);
            check(j.s.killed === null, 'the process lives', String(j.s.killed));
            check(j.s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(j.s.realCalls));
        } finally {
            if (trace) printJourney('come here across the floors', await trace.stop());
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
