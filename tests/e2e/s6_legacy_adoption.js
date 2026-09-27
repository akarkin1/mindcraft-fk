// S6 legacy_adoption: a bots/<name>/memory.json of the old layout exists before the first
// start with world memory on. It is carried over into the first world only (with
// loadMemory true, amendment M1) and the original file stays byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, setupSettings, lockdown, createAgent, connectAgent,
    resolveWorld, quitBot, expectedSeedKey, importProject, runPhase,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'e2e_legacy';
const NAME_NOLOAD = 'e2e_legacy2';
const SEED_A = [-971403206, -1197705962];
const SEED_B = [55555, 77777];
const KEY_A = expectedSeedKey(...SEED_A);
const KEY_B = expectedSeedKey(...SEED_B);
const LEGACY_MEMORY = 'LEGACY-MEMORY: I built a wooden hut near spawn.';
const CARRIED = 'Your earlier memory was carried over into this world.';

function writeLegacy(name) {
    const dir = path.join('bots', name);
    fs.mkdirSync(path.join(dir, 'histories'), { recursive: true });
    const data = {
        memory: LEGACY_MEMORY,
        turns: [{ role: 'user', content: 'old_player: remember the hut' }, { role: 'assistant', content: 'I will.' }],
        self_prompting_state: 0,
        self_prompt: null,
        taskStart: 1700000000000,
        last_sender: null,
    };
    fs.writeFileSync(path.join(dir, 'memory.json'), JSON.stringify(data, null, 2) + '\r\n');
    return fs.readFileSync(path.join(dir, 'memory.json'));
}

async function visit(name, seed, motd, loadMemory, steps) {
    const server = await startServer({ seedHigh: seed[0], seedLow: seed[1], motd });
    let agent = null;
    try {
        const settings = await setupSettings(name, server.port, { world_memory: true });
        await importProject('src/agent/commands/index.js');
        agent = await createAgent(name, { worldMemory: true });
        await lockdown(settings);
        await connectAgent(agent, settings, { worldMemory: true });
        const result = await resolveWorld(agent, loadMemory);
        note(`resolve ${JSON.stringify({ ...result, saveData: result.saveData ? '(object)' : null })}`);
        await steps(agent, result);
    } finally {
        if (agent) await quitBot(agent.bot);
        await server.stop();
    }
}

await scenarioMain({
    async firstWorld() {
        await visit(NAME, SEED_A, 'Legacy A', true, async (agent, result) => {
            check(result.key === KEY_A && result.isNew === true, 'first world is new', result.key);
            check(result.adoptedLegacy === true, 'adoptedLegacy is true');
            check(agent.history.memory === LEGACY_MEMORY && result.saveData?.memory === LEGACY_MEMORY,
                'the legacy memory text is available in the first world', JSON.stringify(agent.history.memory));
            check(agent.history.turns.some((t) => t.content === 'old_player: remember the hut'), 'the legacy turns are loaded');
            check(typeof result.note === 'string' && result.note.includes(CARRIED), 'the note contains the carried-over sentence',
                JSON.stringify(result.note));
            const m1 = `You are in the world "Legacy A". This is your first visit here. ${CARRIED}`;
            check(result.note === m1, '[M1] first visit note with adoption has the amended wording', `got ${JSON.stringify(result.note)}`);
            check(result.saveData?.taskStart === 1700000000000, 'saveData.taskStart from the legacy file');
            check(agent.task.taskStartTime === 1700000000000, 'the spawn glue sets task.taskStartTime from saveData.taskStart',
                String(agent.task.taskStartTime));
            check(agent.history.turns.some((t) => t.role === 'system' && t.content === result.note), 'the note is a system turn in the history');
        });
    },
    async secondWorld() {
        await visit(NAME, SEED_B, 'Legacy B', true, async (agent, result) => {
            check(result.key === KEY_B && result.isNew === true, 'second world is new', result.key);
            check(result.adoptedLegacy === false, 'no adoption in the second world');
            check(agent.history.memory === '' && result.saveData === null, 'the second world does not get the legacy memory',
                JSON.stringify(agent.history.memory));
            check(result.note === 'You are in the world "Legacy B". This is your first visit here: you have no memories and no saved places in this world.',
                'second world note has no carried-over sentence', JSON.stringify(result.note));
        });
    },
    async noLoad() {
        await visit(NAME_NOLOAD, SEED_A, 'Legacy A', false, async (agent, result) => {
            check(result.adoptedLegacy === false, '[M1] loadMemory false: adoptedLegacy is false', String(result.adoptedLegacy));
            check(result.note === 'You are in the world "Legacy A". This is your first visit here: you have no memories and no saved places in this world.',
                '[M1] loadMemory false: note without the carried-over sentence', JSON.stringify(result.note));
            check(agent.history.memory === '', 'loadMemory false: memory is empty', JSON.stringify(agent.history.memory));
        });
    },
    async main() {
        const original = writeLegacy(NAME);
        await runPhase(SELF, 'firstWorld');
        const legacyPath = path.join('bots', NAME, 'memory.json');
        const worldA = path.join('bots', NAME, 'worlds', KEY_A, 'memory.json');
        check(fs.existsSync(legacyPath) && fs.readFileSync(legacyPath).equals(original), 'the original file is byte-identical after the first world');
        check(fs.existsSync(worldA) && fs.readFileSync(worldA).equals(original), 'the first world holds a copy of the legacy file');
        await runPhase(SELF, 'secondWorld');
        check(fs.readFileSync(legacyPath).equals(original), 'the original file is byte-identical after the second world');
        const worldB = path.join('bots', NAME, 'worlds', KEY_B, 'memory.json');
        check(!fs.existsSync(worldB), 'the second world has no copy of the legacy file');

        const original2 = writeLegacy(NAME_NOLOAD);
        await runPhase(SELF, 'noLoad');
        const legacy2 = path.join('bots', NAME_NOLOAD, 'memory.json');
        check(fs.existsSync(legacy2) && fs.readFileSync(legacy2).equals(original2), 'loadMemory false: the original file is byte-identical');
        const copied = path.join('bots', NAME_NOLOAD, 'worlds', KEY_A, 'memory.json');
        const archived = fs.existsSync(path.join('bots', '_archive'));
        check(!fs.existsSync(copied) && !archived, '[M1] loadMemory false: nothing copied into the world (and nothing archived from it)',
            `copy exists ${fs.existsSync(copied)}, bots/_archive exists ${archived}`);
    },
});
