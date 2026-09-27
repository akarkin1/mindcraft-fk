// S4 dimension: a place saved in the overworld; in a new process the same world (same
// seed) reports the_nether. The world key stays, travel to the place is refused.
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, setupSettings, lockdown, createAgent, connectAgent,
    resolveWorld, quitBot, expectedSeedKey, runCommand, importProject, runPhase, emitData,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'e2e_dim';
const SEED = [-971403206, -1197705962];
const KEY = expectedSeedKey(...SEED);

async function visit(serverOpts, steps) {
    const server = await startServer({ seedHigh: SEED[0], seedLow: SEED[1], motd: 'Dimension World', ...serverOpts });
    let agent = null;
    try {
        const settings = await setupSettings(NAME, server.port, { world_memory: true });
        await importProject('src/agent/commands/index.js');
        agent = await createAgent(NAME, { worldMemory: true });
        await lockdown(settings);
        await connectAgent(agent, settings, { worldMemory: true });
        const result = await resolveWorld(agent, true);
        note(`resolve ${JSON.stringify({ ...result, saveData: undefined })}`);
        await steps(agent, result, server);
    } finally {
        if (agent) await quitBot(agent.bot);
        await server.stop();
    }
}

await scenarioMain({
    async overworld() {
        await visit({ dimension: 'overworld', pos: '100.5,65,200.5' }, async (agent, result) => {
            emitData('key', result.key);
            check(agent.bot.game.dimension === 'overworld', 'overworld: bot.game.dimension from the login packet', agent.bot.game.dimension);
            check(result.key === KEY, 'overworld: world key', result.key);
            const r = await runCommand(agent, '!rememberHere("base")');
            check(r === 'Location saved as "base".', 'overworld: !rememberHere("base")', JSON.stringify(r));
        });
    },
    async nether() {
        await visit({ dimension: 'the_nether', pos: '1.5,80,2.5' }, async (agent, result, server) => {
            check(agent.bot.game.dimension === 'the_nether', 'nether: bot.game.dimension from the login packet', agent.bot.game.dimension);
            check(result.key === KEY && result.isNew === false, 'nether: same world key as in the overworld, known world',
                `${result.key} isNew=${result.isNew}`);
            const before = agent.bot.entity.position.clone();
            const out = await runCommand(agent, '!goToRememberedPlace("base")');
            await new Promise((r) => setTimeout(r, 300));
            const after = agent.bot.entity.position.clone();
            const chats = await server.chats();
            const refusal = '"base" is in the dimension overworld, but you are in the_nether. You cannot travel between dimensions by yourself.';
            check(out.includes(refusal), '!goToRememberedPlace refuses with the text of the spec', JSON.stringify(out));
            check(before.equals(after) && !chats.some((c) => c.startsWith('/tp')), 'the bot position does not change and no move is sent',
                `before ${before} after ${after}, server got ${JSON.stringify(chats)}`);
            const saved = await runCommand(agent, '!rememberHere("fortress")');
            check(saved === 'Location saved as "fortress".', 'nether: !rememberHere("fortress")', JSON.stringify(saved));
            const list = await runCommand(agent, '!savedPlaces');
            check(list === 'Saved places: base (overworld), fortress (the_nether)', '!savedPlaces shows the dimension of each place', JSON.stringify(list));
            const go = await runCommand(agent, '!goToRememberedPlace("fortress")');
            const chats2 = await server.chats();
            check(go.includes('Teleported to 1.5, 80, 2.5') && chats2.includes('/tp @s 1.5 80 2.5'),
                'a place in the current dimension is reachable', `${JSON.stringify(go)} ${JSON.stringify(chats2)}`);
        });
    },
    async main() {
        await runPhase(SELF, 'overworld');
        await runPhase(SELF, 'nether');
    },
});
