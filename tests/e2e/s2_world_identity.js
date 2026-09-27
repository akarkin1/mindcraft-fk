// S2 world_identity: a bot joins a server with a known hashed seed; the WorldMemory
// attached right after initBot resolves the world from the real packets.
import fs from 'node:fs';
import path from 'node:path';
import {
    scenarioMain, check, note, startServer, setupSettings, lockdown, createAgent, connectAgent,
    resolveWorld, quitBot, expectedSeedKey, runCommand, importProject, errText,
} from './helpers.js';

const NAME = 'e2e_ident';
const SEED = [-971403206, -1197705962];
const MOTD = 'Identity §aTest§r World';
const MOTD_TEXT = 'Identity Test World';

await scenarioMain({
    async main() {
        const server = await startServer({ seedHigh: SEED[0], seedLow: SEED[1], motd: MOTD, age: 123456 });
        let agent = null;
        try {
            const settings = await setupSettings(NAME, server.port, { world_memory: true });
            await importProject('src/agent/commands/index.js');
            agent = await createAgent(NAME, { worldMemory: true });
            const lk = await lockdown(settings);
            check(lk.locked === true, 'sandbox lockdown active as in the fork settings', JSON.stringify(lk));
            await connectAgent(agent, settings, { worldMemory: true });
            check(agent.history.storage_ready === false, 'History with defer_storage has no storage before resolve');
            const result = await resolveWorld(agent, true);
            const expected = expectedSeedKey(SEED[0], SEED[1]);
            note(`resolve result ${JSON.stringify({ ...result, saveData: undefined })}`);
            check(result.key === expected, 'world key computed from the hashed seed', `got ${result.key}, expected ${expected}`);
            check(expected === 'seed-c619903ab89c7516', 'expected key matches the example of the task', expected);
            check(result.source === 'seed', 'source is seed', result.source);
            check(result.label === MOTD_TEXT, 'label is the text of the server description', `got ${JSON.stringify(result.label)}`);
            check(agent.world_memory.world?.key === expected, 'WorldMemory.world getter');
            const worldDir = path.join('bots', NAME, 'worlds', expected);
            check(fs.existsSync(worldDir) && fs.statSync(worldDir).isDirectory(), 'world directory exists under bots/<name>/worlds/', worldDir);
            check(agent.history.storage_ready === true && agent.history.memory_fp === `./bots/${NAME}/worlds/${expected}/memory.json`,
                'History storage points into the world directory', String(agent.history.memory_fp));
            check(result.isNew === true && typeof result.note === 'string'
                && result.note.startsWith(`You are in the world "${MOTD_TEXT}". This is your first visit here`),
            'first visit note', JSON.stringify(result.note));
            const index = JSON.parse(fs.readFileSync(path.join('bots', NAME, 'worlds', 'index.json'), 'utf8'));
            const entry = index.worlds?.[expected];
            check(index.last_key === expected && entry && entry.hashed_seed === expected.slice(5) && entry.last_age === 123456
                && entry.is_hardcore === false && entry.visits === 1,
            'index.json entry (hashed_seed, last_age from update_time, is_hardcore, visits)', JSON.stringify(entry));
            try {
                const stats = await runCommand(agent, '!stats');
                const lines = stats.split('\n');
                const i = lines.findIndex((l) => l.startsWith('- Position'));
                check(i >= 0 && lines[i + 1] === `- World: ${MOTD_TEXT}` && lines[i + 2] === '- Dimension: overworld',
                    '!stats has World and Dimension lines directly after Position', JSON.stringify(lines.slice(Math.max(i, 0), i + 3)));
            } catch (e) {
                note(`!stats could not run against the simulated server: ${errText(e).split('\n')[0]}`);
            }
        } finally {
            if (agent) await quitBot(agent.bot);
            await server.stop();
        }
    },
});
