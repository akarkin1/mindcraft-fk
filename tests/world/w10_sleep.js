// W10 sleep (spec section 8 "Sleep", H4 sleepInBed, G5 goToBed): home_pack and protected_areas on,
// world_memory on, peaceful. The house has a red bed; the bot saves it with !rememberArea.
//   1. At day (6000) inside the house: !goToBed answers "I cannot sleep now, it is not night.".
//   2. At night (13000), 60 blocks from the house, with blocks of bedrock around the bot (and the
//      bedrock floor of the flat world 4 blocks below it): !goToBed answers "I found no bed nearby."
//      and the bot does not walk to the bedrock.
//   3. At night (13000, daylight cycle on so that sleeping can end the night), the bot 6 blocks in
//      front of the door: !goToBed takes the bot through the door to the bed, it sleeps, the night
//      ends, the reply is "I slept. It is morning.", the door is closed.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    entityPos, fmt, startTrace, printTrace, sleep, command, commands,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, housePlan, buildHouse, isOpen, inBox, hdist } from './world.js';

const NAME = 'w_sleep';

async function dayTime() {
    const out = await command('time query daytime');
    const m = /The time is (\d+)/.exec(out.join(' '));
    return m ? Number(m[1]) % 24000 : null;
}

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        const h = housePlan(r.ox - 25, r.oz - 25, g);
        await buildHouse(h);
        await commands(['gamerule doDaylightCycle false', 'time set 6000']);

        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, home_pack: true, protected_areas: true, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, h.inside, 0);
            const saved = await command_(agent, '!rememberArea("home", "building")', 30000);
            check(/Area "home" \(building\) saved:/.test(saved), 'precondition: !rememberArea saved the house as "home"', JSON.stringify(saved.slice(0, 200)));

            // ---------------------------------------------------------- 1. day
            const r1 = await command_(agent, '!goToBed', 30000);
            note(`1: ${JSON.stringify(r1)}`);
            check(r1.includes('I cannot sleep now, it is not night.'), '1: at day !goToBed answers "I cannot sleep now, it is not night."', JSON.stringify(r1.slice(0, 200)));

            // ---------------------------------------------------------- 2. bedrock is no bed
            const lone = { x: r.ox + 30, y: g + 1, z: r.oz + 30 };
            await commands([
                `setblock ${lone.x + 3} ${g + 1} ${lone.z} minecraft:bedrock`, `setblock ${lone.x - 3} ${g + 1} ${lone.z} minecraft:bedrock`,
                `setblock ${lone.x} ${g + 1} ${lone.z + 3} minecraft:bedrock`, 'time set 13000',
            ]);
            const at2 = await placeBot(agent, lone, 0);
            const r2 = await command_(agent, '!goToBed', 30000);
            const end2 = await entityPos(NAME);
            note(`2: ${JSON.stringify(r2)}; the bot moved ${hdist(at2, end2).toFixed(1)} blocks`);
            check(r2.includes('I found no bed nearby.'), '2: with only bedrock near the bot, !goToBed answers "I found no bed nearby."', JSON.stringify(r2.slice(0, 200)));
            check(hdist(at2, end2) < 1.5, '2: the bot did not walk to the bedrock', `${fmt(at2)} -> ${fmt(end2)}`);

            // ---------------------------------------------------------- 3. night, the bed in the house
            const front = { x: h.door.x, y: g + 1, z: h.door.z - 6 };
            await placeBot(agent, front, 180);
            await commands(['time set 13000', 'gamerule doDaylightCycle true']);
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), open: await isOpen(h.door), sleeping: agent.bot.isSleeping, time: agent.bot.time?.timeOfDay }), 300);
            const t0 = Date.now();
            const r3 = await command_(agent, '!goToBed', 90000);
            const ms = Date.now() - t0;
            const time3 = await dayTime();
            await sleep(800);
            const door3 = await isOpen(h.door);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            const rows = await trace.stop();
            printTrace('3: !goToBed at night from 6 blocks in front of the door', rows, {
                pos: (x) => fmt(x.pos), inside: (x) => (inBox(x.pos, h.interior) ? 'yes' : 'no'), door: (x) => (x.open ? 'open' : 'closed'),
                sleeping: (x) => x.sleeping, time: (x) => x.time,
            });
            note(`3: !goToBed answered after ${ms} ms: ${JSON.stringify(r3)}; the time after it: ${time3}`);
            check(rows.some((x) => x.sleeping === true), '3: the bot slept in the bed');
            check(r3.includes('I slept. It is morning.'), '3: the reply is "I slept. It is morning."', JSON.stringify(r3.slice(0, 200)));
            check(time3 !== null && time3 < 12000, '3: the night ended (the server time is day)', String(time3));
            const firstInside = rows.findIndex((x) => inBox(x.pos, h.interior));
            check(firstInside >= 0 && rows.slice(0, firstInside + 1).some((x) => x.open === true), '3: the bot entered the house through the door');
            check(door3 === false, '3: the door is closed after the bot went to bed', `open: ${door3}`);

            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            await releaseRegion(r);
        }
    },
});
exitSoon();
