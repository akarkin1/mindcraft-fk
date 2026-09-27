// S5 flag_off: with world_memory off nothing of the world memory happens. The agent objects
// are built as agent.js builds them with the flag off: new History(agent), new MemoryBank(),
// no WorldMemory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, startServer, setupSettings, lockdown, createAgent, connectAgent,
    quitBot, runCommand, importProject, runPhase, listFiles, readJson,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'e2e_off';
const SEED = [-971403206, -1197705962];
const MEMORY = 'MEMORY-OFF: flag off memory text.';

async function visit(steps) {
    const server = await startServer({ seedHigh: SEED[0], seedLow: SEED[1], motd: 'Flag Off World', pos: '3.5,66,4.5' });
    let agent = null;
    try {
        const settings = await setupSettings(NAME, server.port, { world_memory: false });
        await importProject('src/agent/commands/index.js');
        agent = await createAgent(NAME, { worldMemory: false });
        await lockdown(settings);
        await connectAgent(agent, settings, { worldMemory: false });
        await steps(agent, server);
    } finally {
        if (agent) await quitBot(agent.bot);
        await server.stop();
    }
}

await scenarioMain({
    async first() {
        await visit(async (agent) => {
            check(agent.world_memory === undefined && agent.memory_bank.hasStore === false, 'no WorldMemory, MemoryBank without store');
            check(agent.history.storage_ready === true && agent.history.memory_fp === `./bots/${NAME}/memory.json`,
                'History uses bots/<name>/memory.json as in v0.1.4.2', String(agent.history.memory_fp));
            const r = await runCommand(agent, '!rememberHere("offplace")');
            check(r === 'Location saved as "offplace".', '!rememberHere reply unchanged', JSON.stringify(r));
            const list = await runCommand(agent, '!savedPlaces');
            check(list === 'Saved place names: offplace', '!savedPlaces gives the old text', JSON.stringify(list));
            const nw = await runCommand(agent, '!nameWorld("Something")');
            check(nw === 'World memory is off.', '!nameWorld with the flag off', JSON.stringify(nw));
            await agent.history.add('e2e_player', 'hello with the flag off');
            agent.history.memory = MEMORY;
            check(await agent.history.save() === true, 'history.save() resolves true');
            check(fs.existsSync(path.join('bots', NAME, 'memory.json')), 'bots/<name>/memory.json written');
        });
    },
    async second() {
        await visit(async (agent) => {
            const data = agent.history.load();
            check(data && agent.history.memory === MEMORY, 'the memory of the first process loads from bots/<name>/memory.json',
                JSON.stringify(agent.history.memory));
            const list = await runCommand(agent, '!savedPlaces');
            check(list === 'Saved place names: ', 'the place of the first process is gone (RAM only, as in v0.1.4.2)', JSON.stringify(list));
        });
    },
    async main() {
        await runPhase(SELF, 'first');
        const files = listFiles('bots');
        check(!fs.existsSync(path.join('bots', NAME, 'worlds')), 'no worlds directory is created', JSON.stringify(files));
        check(!files.some((f) => f.endsWith('places.json') || f.endsWith('index.json') || f.endsWith('resume_guard.json')),
            'no places.json, index.json or resume_guard.json anywhere under bots/', JSON.stringify(files));
        const grep = files.filter((f) => fs.readFileSync(path.join('bots', f), 'utf8').includes('offplace'));
        check(grep.length === 0, 'the place is not on disk after the process ended', JSON.stringify(grep));
        const mem = readJson(path.join('bots', NAME, 'memory.json'));
        check(mem.memory === MEMORY && Array.isArray(mem.turns), 'memory.json has the v0.1.4.2 layout', JSON.stringify(Object.keys(mem)));
        await runPhase(SELF, 'second');
    },
});
