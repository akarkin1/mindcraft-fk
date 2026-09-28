// W01 baseline: proves the harness on the code as it is, with every flag of this release off.
// The real agent joins the real server; through the real command parser it walks 20 blocks on
// flat ground; with the real skills it breaks a block and places a block; it opens an oak door.
// Every result is read from the server through the console, not from the bot's own view.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, importProject, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot,
    resetBot, command_, waitFor, entityPos, fmt, command, commands, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockIs, isOpen, dist } from './world.js';

const NAME = 'w_base';

await scenarioMain({
    async main() {
        const r = region(40);
        const g = r.g;
        const t0 = Date.now();
        await prepareRegion(r);
        note(`region x=${r.ox} z=${r.oz}, ground y ${g}, prepared in ${Date.now() - t0} ms`);
        const start = { x: r.ox, y: g + 1, z: r.oz };
        const plank = { x: r.ox + 22, y: g + 1, z: r.oz };
        const place = { x: r.ox + 22, y: g + 1, z: r.oz + 2 };
        const door = { x: r.ox + 24, y: g + 1, z: r.oz - 2 };
        await commands([
            `setblock ${plank.x} ${plank.y} ${plank.z} minecraft:oak_planks`,
            `setblock ${door.x} ${door.y} ${door.z} minecraft:oak_door[facing=west,half=lower,open=false]`,
            `setblock ${door.x} ${door.y + 1} ${door.z} minecraft:oak_door[facing=west,half=upper,open=false]`,
        ]);

        let agent = null;
        try {
            const tA = Date.now();
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF });
            agent = s.agent;
            note(`agent started and spawned in ${Date.now() - tA} ms`);
            await resetBot(NAME);
            const at = await placeBot(agent, start, -90);
            check(at && dist(at, { x: start.x + 0.5, y: start.y, z: start.z + 0.5 }) < 0.6,
                'the bot stands at the start of the region (server position)', fmt(at));

            // walk 20 blocks east through the real command parser and the real path finder
            const target = { x: r.ox + 20, y: g + 1, z: r.oz };
            const tW = Date.now();
            const walk = await command_(agent, `!goToCoordinates(${target.x + 0.5}, ${target.y}, ${target.z + 0.5}, 1)`, 60000);
            const after = await entityPos(NAME);
            note(`!goToCoordinates took ${Date.now() - tW} ms and answered ${JSON.stringify(walk.slice(0, 200))}`);
            check(dist(after, { x: target.x + 0.5, y: target.y, z: target.z + 0.5 }) <= 2,
                'the bot walked 20 blocks: it is within 2 blocks of the target (server position)', `at ${fmt(after)}`);

            // break a block with the real skill
            const skills = await importProject('src/agent/library/skills.js');
            check(await blockIs(plank, 'oak_planks'), 'before breaking: the plank is there (server)');
            const broke = await skills.breakBlockAt(agent.bot, plank.x, plank.y, plank.z);
            const gone = await waitFor(() => blockIs(plank, 'air'), { ms: 5000 });
            check(broke === true && gone.ok, 'the bot broke the plank: the server has air there', `breakBlockAt returned ${broke}`);

            // place a block with the real skill
            await command(`give ${NAME} minecraft:cobblestone 4`);
            await waitFor(() => agent.bot.inventory.items().some((i) => i.name === 'cobblestone'), { ms: 5000 });
            const placed = await skills.placeBlock(agent.bot, 'cobblestone', place.x, place.y, place.z);
            const there = await waitFor(() => blockIs(place, 'cobblestone'), { ms: 5000 });
            check(placed === true && there.ok, 'the bot placed cobblestone: the server has it there', `placeBlock returned ${placed}`);

            // open a door
            check(await isOpen(door) === false, 'before opening: the door is closed (server)');
            await skills.goToPosition(agent.bot, door.x - 2, door.y, door.z, 1);
            const doorBlock = agent.bot.blockAt(new Vec3(door.x, door.y, door.z));
            check(doorBlock?.name === 'oak_door', 'the bot sees the oak door', String(doorBlock?.name));
            await agent.bot.activateBlock(doorBlock);
            const opened = await waitFor(async () => (await isOpen(door)) === true, { ms: 5000 });
            check(opened.ok, 'the bot opened the door: the server has the door open');

            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
            note(`the fake chat model got ${s.chat.requests.length} request(s), the fake code model ${s.code.requests.length}`);
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
