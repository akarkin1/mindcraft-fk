// Spec v0.1.4.7, section 7 "Size of the prompt": the conversing prompt is built the way
// scripts/routing_check.js builds it with --dry-run (a real Prompter with profiles/claude.json, the
// settings of settings.js with the part switches set, the blocked commands of blockedFor, the fixed
// fake state for $STATS and $INVENTORY), with an empty memory and no conversation.
//   - every part of v0.1.4.6 and v0.1.4.7 on: at most 17,000 characters;
//   - every part off: at most 11,000 characters, and none of the commands of v0.1.4.7 in it;
//   - v0.1.4.8 (part G): every switch of the fork on, with a block "what you know" of knowledge_max_chars
//     (600) characters: at most 17,000 characters.
// The sizes are printed with the test names. Nothing is sent: the chat model is a stand-in, and the
// Claude adapter gets a placeholder key when the environment has none. The Prompter reads
// ./profiles/defaults and writes ./bots/<name>, so it runs in a temp directory with a copy of the
// default profiles.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const T = await loadSrc('tests/routing/commands.js');
const S = await loadSrc('scripts/routing_check.js');

const LIMIT_ALL_ON = 17000;
const LIMIT_ALL_OFF = 11000;
const PARTS_0146 = ['cost_meter', 'protected_areas', 'player_rules', 'home_pack'];
const PARTS_0147 = ['storage_pack', 'farming_pack', 'wood_pack', 'mining_pack'];
const NEW_COMMANDS = PARTS_0147.flatMap((part) => T.PART_COMMANDS[part]);
const PLAYER = 'steve';

// The fixed fake state of scripts/routing_check.js (fakeStats and FAKE_INVENTORY there), as text.
const pad = (text) => '\n' + text + '\n';
function fakeStats(modes) {
    const modeLines = Object.entries(modes ?? {}).map(([name, on]) => `- ${name}(${on ? 'ON' : 'OFF'})`);
    const stats = ['STATS', '- Position: x: 12.50, y: 64.00, z: -3.30', '- Gamemode: survival', '- Health: 20 / 20', '- Hunger: 17 / 20',
        '- Biome: plains', '- Weather: Clear', '- Time: Afternoon', '- Current Action: Idle', `- Nearby Human Players: ${PLAYER}`,
        '- Nearby Bot Players: None.', ['Agent Modes:', ...modeLines].join('\n')].join('\n') + '\n';
    const entities = ['NEARBY_ENTITIES', `- Human player: ${PLAYER}`, '- entities: 2 cow(s)', '- entities: 1 chicken(s)'].join('\n');
    const blocks = ['NEARBY_BLOCKS', '- grass_block', '- dirt', '- oak_log', '- oak_leaves', '- stone', '- oak_planks', '- oak_door',
        '- Block Below: grass_block', '- Block at Legs: air', '- Block at Head: air', '- First Solid Block Above Head: none'].join('\n');
    return pad(stats) + '\n' + pad(entities) + '\n' + pad(blocks);
}
const FAKE_INVENTORY = pad(['INVENTORY', '- oak_log: 12', '- oak_planks: 8', '- cobblestone: 34', '- bread: 6', '- apple: 3',
    '- wheat_seeds: 14', '- torch: 9', '- raw_iron: 5', '- stone_sword: 1', '- stone_pickaxe: 1', 'WEARING: Nothing'].join('\n'));

let workDir;
let originalCwd;
let placeholderKey = false;
let M;

before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    const to = path.join(workDir, 'profiles', 'defaults');
    fs.mkdirSync(to, { recursive: true });
    for (const file of fs.readdirSync(repoPath('profiles/defaults'))) {
        if (file.endsWith('.json')) fs.copyFileSync(repoPath(`profiles/defaults/${file}`), path.join(to, file));
    }
    process.chdir(workDir);
    if (!process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = 'dry-run-placeholder-not-a-key';
        placeholderKey = true;
    }
    const cap = captureConsole();
    try {
        M = {
            fileSettings: (await loadSrc('settings.js')).default,
            settingsModule: await loadSrc('src/agent/settings.js'),
            commands: await loadSrc('src/agent/commands/index.js'),
            prompter: await loadSrc('src/models/prompter.js'),
            skills: await loadSrc('src/agent/skills/skill_manager.js'),
        };
    } finally {
        cap.restore();
    }
});

after(() => {
    if (placeholderKey) delete process.env.ANTHROPIC_API_KEY;
    process.chdir(originalCwd);
    removeTmpDir(workDir);
});

// The conversing prompt for the settings of settings.js with the given switches. knowledge: the block
// that agent.knowledgeBlock() gives (v0.1.4.8), used only with knowledge_in_prompt.
async function conversingPrompt(switches, knowledge = '') {
    const profile = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
    // the 17,000 limit counts the switches of the fork's parts; skill learning is pinned off, never read from
        // settings.js (CLAUDE.md: unit tests never assert the values of settings; decision of the tech lead)
        const settings = { ...S.runSettings(M.fileSettings, profile, false), ...switches, skill_learning: false, skill_command: false };
    M.settingsModule.setSettings(settings);
    const blocked = S.blockedFor(settings, M.skills.skillFlags(settings));
    const agent = {
        name: profile.name, blocked_actions: blocked, history: { memory: '' },
        self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
        actions: { currentActionLabel: '' }, task: { task_id: null }, npc: {},
        knowledgeBlock: () => knowledge,
    };
    const cap = captureConsole();
    try {
        const prompter = new M.prompter.Prompter(agent, settings.profile);
        agent.prompter = prompter;
        agent.name = prompter.getName();
        prompter.profile.conversing = prompter.profile.conversing
            .replaceAll('$STATS', fakeStats(prompter.profile.modes))
            .replaceAll('$INVENTORY', FAKE_INVENTORY);
        let last = null;
        const model = {
            async sendRequest(turns, systemMessage) {
                last = String(systemMessage ?? '');
                return '';
            },
            sendVisionRequest: () => Promise.reject(new Error('no vision')),
            embed: () => Promise.reject(new Error('no embeddings')),
        };
        prompter.chat_model = model;
        prompter.code_model = model;
        prompter.vision_model = model;
        prompter.embedding_model = model;
        prompter.cooldown = 0;
        await prompter.initExamples();
        await prompter.promptConvo([]);
        assert.equal(typeof last, 'string');
        return last;
    } finally {
        cap.restore();
    }
}

const switchesOf = (on0146, on0147) => Object.fromEntries([
    ...PARTS_0146.map((part) => [part, on0146]),
    ...PARTS_0147.map((part) => [part, on0147]),
    ['world_memory', true],
]);

describe('the size of the conversing prompt (spec v0.1.4.7, section 7)', () => {
    test('every part off: at most 11,000 characters, no command of v0.1.4.7', async (t) => {
        const prompt = await conversingPrompt(switchesOf(false, false));
        t.diagnostic(`all parts off: ${prompt.length} characters`);
        assert.ok(prompt.includes('*COMMAND DOCS'), 'the prompt has the command docs');
        for (const name of NEW_COMMANDS) assert.ok(!prompt.includes(`${name}:`) && !prompt.includes(`${name}(`) && !prompt.includes(`${name}\n`), name);
        assert.ok(prompt.length <= LIMIT_ALL_OFF, `${prompt.length} characters`);
    });

    test('the parts of v0.1.4.6 on, those of v0.1.4.7 off: the size for the report', async (t) => {
        const prompt = await conversingPrompt(switchesOf(true, false));
        t.diagnostic(`parts of v0.1.4.6 on: ${prompt.length} characters`);
        for (const name of NEW_COMMANDS) assert.ok(!prompt.includes(`${name}:`), name);
        assert.ok(prompt.length <= LIMIT_ALL_ON, `${prompt.length} characters`);
    });

    // v0.1.4.8: the switches of section 2 that change the prompt; the others are on too
    const SWITCHES_0148 = { knowledge_in_prompt: true, knowledge_max_chars: 600, protect_built_blocks: true, repeat_guard: 3,
        restart_context: true, say_results: true, flee_below_health: 8, stuck_restart_after: 3, log_timestamps: true };
    const block = (max) => {
        const lines = ['WHAT YOU KNOW (from memory, no need to check):', 'You are in the area "farm" (farm), on the surface.'];
        for (let i = 0; lines.join('\n').length < max; i++) lines.push(`Chest (${i}, 67, ${i}): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52.`);
        return lines.join('\n').slice(0, max);
    };

    test('every switch of the fork on (v0.1.4.8), with a block of 600 characters: at most 17,000 characters', async (t) => {
        const knowledge = block(600);
        const prompt = await conversingPrompt({ ...switchesOf(true, true), ...SWITCHES_0148 }, knowledge);
        t.diagnostic(`every switch on (v0.1.4.8): ${prompt.length} characters`);
        assert.ok(prompt.includes(`${knowledge}\nConversation Begin:`), 'the block is in the prompt');
        for (const name of ['!pickUpItems', '!closeDoor', ...NEW_COMMANDS]) assert.ok(prompt.includes(`\n${name}: `), name);
        assert.ok(prompt.length <= LIMIT_ALL_ON, `${prompt.length} characters`);
    });

    test('every part of v0.1.4.6 and v0.1.4.7 on: at most 17,000 characters, every new command offered', async (t) => {
        const prompt = await conversingPrompt(switchesOf(true, true));
        t.diagnostic(`all parts on: ${prompt.length} characters`);
        for (const name of NEW_COMMANDS) assert.ok(prompt.includes(`\n${name}: `), name);
        assert.ok(prompt.length <= LIMIT_ALL_ON, `${prompt.length} characters`);
    });
});
