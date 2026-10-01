// W84 the first ten minutes (journey, tester T3): W80 and W81 as one run, then the night and "come here" from the
// mine, with the fake model, from the player's side (PLAYTEST.md of v0.1.4.9, sections 2 to 5; the owner's play logs
// of 2026-10-01: "let's sleep" -> !goToBed, "come here" -> !goToPlayer("MartyByrde2", 3)).
//
// The owner variant of the base, the owner's switches, the modes of his profile, an empty memory, the kit of the
// owner's chest (8 ladders, 16 torches, a stone pickaxe). The bot is never moved by the control: it is put in the
// house at the start; after that only the player moves.
//   A  part A of journey.js (W80): "this is home", "follow me" down to the basement, the trapdoor closed behind the
//      bot, "remember the path here", "come here" from the house, "go to the basement".
//   B  the player goes down into the basement to the bot; part B of journey.js (W81) from the basement: "follow me" up,
//      out of the house under the open sky, back in and down both ladders, through the double door to the end of the
//      tunnel; "this is the mine"; "find some iron" (12 iron ore ahead of the end): 12 raw_iron and back on the
//      surface within 5 minutes, the trapdoor closed, torches kept, a torch in the new part of the tunnel.
//   C  night (time 13000), the player in the house: !goToBed ("let's sleep"): the bot sleeps within 120 s (its own view
//      and the server), and the answer after the morning is "I slept. It is morning."
//   D  the player stands in the mine room (y 41): !goToPlayer("w_player", 3) ("come here") brings the bot to y 41
//      within 120 s, within 4 blocks of the player.
// Throughout: the process never ends (no cleanKill), the bot is alive at the end, no request reached a real model.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, tp, sleep, commands, waitFor, serverSleeping,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist, entityNumber } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import {
    startJourney, partFirstMinutes, partFirstMine, spots, PLAYER, walkPlayer, line, playerDownToBasement, saidLines,
} from './journey.js';

const NAME = 'w_tenmin';
const KIT = [['ladder', 8], ['torch', 16], ['stone_pickaxe', 1]];

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r, { owner: true });
        await buildBase(b);
        const sp = spots(b);
        const g = b.g;
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, { botAt: { x: sp.houseMiddle.x - 1, y: g + 1, z: sp.houseMiddle.z + 1 }, playerAt: sp.besideTrapdoor, kit: KIT });
            agent = j.agent;
            orders = j.orders;
            let deaths = 0;
            agent.bot.on('death', () => { deaths++; });
            const t0 = Date.now();
            const minutes = () => ((Date.now() - t0) / 60000).toFixed(1);

            // ---------------------------------------------------------- A
            const a = await partFirstMinutes({ ...j, b });
            note(`A ended at minute ${minutes()}: ${a.ok ? 'passed' : 'FAILED'}`);

            // ---------------------------------------------------------- B
            const here = await entityPos(PLAYER);
            await walkPlayer(line({ x: Math.floor(here.x), y: g + 1, z: Math.floor(here.z) }, sp.besideTrapdoor));
            await playerDownToBasement(b);
            await sleep(2000);
            const m = await partFirstMine({ ...j, b }, { from: 'basement' });
            note(`B ended at minute ${minutes()}: ${m.ok ? 'passed' : 'FAILED'}`);

            // ---------------------------------------------------------- C
            const bedside = { x: b.house.bedFoot.x + 1, y: g + 1, z: b.house.bedFoot.z - 1 };
            await tp(PLAYER, bedside);
            await commands(['time set 13000']);
            await sleep(1500);
            const tC = Date.now();
            note(`C: night; the bot is at ${fmt(await entityPos(NAME))}`);
            const bed = orders.orderInfo('!goToBed', 240000);
            const slept = await waitFor(async () => agent.bot.isSleeping === true && (await serverSleeping(NAME)), { ms: 120000, every: 500 });
            note(`C: the bot ${slept.ok ? `sleeps after ${((Date.now() - tC) / 1000).toFixed(1)} s` : 'does not sleep within 120 s'} at ${fmt(await entityPos(NAME))}`);
            if (slept.ok) await commands(['time set 1000']);
            const bedInfo = await bed;
            note(`C: !goToBed answered ${JSON.stringify(bedInfo.reply.slice(0, 300))}`);
            check(slept.ok, 'C: "let\'s sleep" at night: the bot sleeps in the bed within 120 s (its own view and the server)');
            check(/I slept\. It is morning\./.test(bedInfo.reply), 'C: the answer of !goToBed is "I slept. It is morning."', JSON.stringify(bedInfo.reply.slice(0, 200)));
            await commands(['time set 6000']);
            await sleep(2000);

            // ---------------------------------------------------------- D
            await tp(PLAYER, sp.roomWait);
            await sleep(1500);
            const tD = Date.now();
            const come = await orders.orderInfo(`!goToPlayer("${PLAYER}", 3)`, 120000);
            const at = await entityPos(NAME);
            const p = await entityPos(PLAYER);
            note(`D: !goToPlayer from the mine room answered after ${((Date.now() - tD) / 1000).toFixed(1)} s: ${JSON.stringify(come.reply.slice(0, 300))}; the bot at ${fmt(at)}`);
            check(come.done && inBox(at, b.room.box) && dist(at, p) <= 4, 'D: "come here" from the mine room brings the bot to y 41 within 120 s, within 4 blocks of the player', `${fmt(at)}, ${dist(at, p).toFixed(1)} blocks`);

            // ---------------------------------------------------------- throughout
            note(`the run took ${minutes()} minutes; deaths ${deaths}; the bot said ${saidLines(j.s, t0).length} lines`);
            check(j.s.killed === null, 'the process never ended (no cleanKill)', String(j.s.killed));
            const health = await entityNumber(NAME, 'Health');
            check(health > 0 && deaths === 0, 'the bot is alive at the end and never died', `health ${health}, deaths ${deaths}`);
            check(j.s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(j.s.realCalls));
        } finally {
            await commands(['gamerule doDaylightCycle false', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
