// Part G of v0.1.4.10 (E5), section 9 item 4: what the model sees.
//   - the command docs of !mines and !forgetMine, word for word, as getCommandDocs writes them, right after
//     !leaveMine;
//   - the size of the conversing prompt as tests/unit/rtg_prompt.test.js measures it: every switch on, the five
//     new ones too, with a block of knowledge of 600 characters (the line of the job is inside it): at most
//     17,000 characters; every switch off: the two commands hidden, at most 11,000; the sizes are printed;
//   - no new example (the job needs none): no example names !mines or !forgetMine;
//   - the routing list: 6 sentences for the two commands, part mining_pack, each command at least twice.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { blockedPushes } from '../helpers/st_glue_env.js';

const S = await loadSrc('scripts/routing_check.js');
const F = await loadSrc('src/agent/rules/example_filter.js');
const DEFAULT = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
const SENTENCES = JSON.parse(fs.readFileSync(repoPath('tests/routing/sentences.json'), 'utf8'));

const NEW_COMMANDS = ['!mines', '!forgetMine'];
const LIMIT_ALL_ON = 17000;

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
        process.env.ANTHROPIC_API_KEY = 'dry-run-placeholder-not-a-key'; // no model is called: the fake model below answers
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

describe('the command docs of !mines and !forgetMine', () => {
    test('word for word, right after !leaveMine', () => {
        M.settingsModule.setSettings({ language: 'en', blocked_actions: [] });
        const docs = M.commands.getCommandDocs({ blocked_actions: [] });
        const at = docs.indexOf('\n!leaveMine: ');
        assert.ok(at > 0);
        assert.equal(docs.slice(at + 1, docs.indexOf('\n!rememberRoute: ') + 1), [
            '!leaveMine: Climb out of the mine.', // v0.1.4.11, W (engineer E1): shorter, the prompt stays at 17,000
            '!mines: List your mines.',
            '!forgetMine: Forget a mine.',
            'Params:',
            'name: (string) The name of the mine.',
        ].join('\n') + '\n');
    });
});

describe('the size of the conversing prompt (section 9, item 4)', () => {
    // As tests/unit/rtg_prompt.test.js: the real Prompter with profiles/claude.json, the settings of settings.js with
    // the switches set, the blocked commands of blockedFor and of the pushes of agent.js, the fixed fake state.
    const pad = (text) => '\n' + text + '\n';
    const FAKE_INVENTORY = pad(['INVENTORY', '- oak_log: 12', '- oak_planks: 8', '- cobblestone: 34', '- bread: 6', '- apple: 3',
        '- wheat_seeds: 14', '- torch: 9', '- raw_iron: 5', '- stone_sword: 1', '- stone_pickaxe: 1', 'In the off-hand: bread 6', 'WEARING: Nothing'].join('\n'));
    function fakeStats(modes, home) {
        const homeModes = home ? { hunger: true, creeper_safety: true, night_shelter: true, door_closing: true } : {};
        const modeLines = Object.entries({ ...(modes ?? {}), ...homeModes }).map(([name, on]) => `- ${name}(${on ? 'ON' : 'OFF'})`);
        const stats = ['STATS', '- Position: x: 12.50, y: 64.00, z: -3.30', '- World: seed-ce66bf80acdefa75', '- Dimension: overworld',
            ...(home ? ['- Area: farm (farm, protected)'] : []), '- Gamemode: survival', '- Health: 20 / 20', '- Hunger: 17 / 20', '- Biome: plains',
            '- Weather: Clear', '- Time: Afternoon', '- Current Action: Idle', '- Nearby Human Players: steve', '- Nearby Bot Players: None.',
            ['Agent Modes:', ...modeLines].join('\n')].join('\n') + '\n';
        const entities = ['NEARBY_ENTITIES', '- Human player: steve', '- entities: 2 cow(s)', '- entities: 1 chicken(s)'].join('\n');
        const blocks = ['NEARBY_BLOCKS', '- grass_block', '- dirt', '- oak_log', '- oak_leaves', '- stone', '- oak_planks', '- oak_door',
            '- Block Below: grass_block', '- Block at Legs: air', '- Block at Head: air', '- First Solid Block Above Head: none'].join('\n');
        return pad(stats) + '\n' + pad(entities) + '\n' + pad(blocks);
    }
    // the block of 600 characters with the line of the job after the where line
    const fullBlock = (max) => {
        const lines = ['WHAT YOU KNOW (from memory, no need to check):', 'You are in the area "farm" (farm), on the surface.',
            'Job: the mining, 6 of 16 iron, step 2 of 4.'];
        for (let i = 0; lines.join('\n').length < max; i++) lines.push(`Chest (${i}, 67, ${i}): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52.`);
        return lines.join('\n').slice(0, max);
    };
    const PARTS = ['cost_meter', 'protected_areas', 'player_rules', 'home_pack', 'storage_pack', 'farming_pack', 'wood_pack', 'mining_pack', 'routes_pack', 'mine_routes'];
    const SWITCHES_ON = { knowledge_in_prompt: true, knowledge_max_chars: 600, protect_built_blocks: true, repeat_guard: 3, restart_context: true,
        say_results: true, flee_below_health: 8, stuck_restart_after: 3, log_timestamps: true, trail_max_steps: 500, ore_sense_range: 3, skills_over_code: true,
        // v0.1.4.10
        job_memory: true, job_resume_seconds: 60, idle_jobs: ['!farmCycle("farm")', '!craftSupplies("torch", 32)'], idle_jobs_minutes: 15, area_floors: true };
    const SWITCHES_OFF = { job_memory: false, idle_jobs: [], area_floors: false };

    async function conversingPrompt(switches, hidden, knowledge) {
        const profile = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
        // skill learning is pinned off, never read from settings.js (as in rtg_prompt.test.js)
        const settings = { ...S.runSettings(M.fileSettings, profile, false), ...switches, skill_learning: false, skill_command: false };
        M.settingsModule.setSettings(settings);
        const blocked = [...new Set([...S.blockedFor(settings, M.skills.skillFlags(settings)), ...hidden])];
        const agent = {
            name: profile.name, blocked_actions: blocked, history: { memory: '' },
            self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
            actions: { currentActionLabel: '' }, task: { task_id: null }, npc: {}, knowledgeBlock: () => knowledge,
        };
        const cap = captureConsole();
        try {
            const prompter = new M.prompter.Prompter(agent, settings.profile);
            agent.prompter = prompter;
            prompter.profile.conversing = prompter.profile.conversing.replaceAll('$STATS', fakeStats(prompter.profile.modes, settings.home_pack === true))
                .replaceAll('$INVENTORY', FAKE_INVENTORY);
            let last = null;
            const model = { async sendRequest(turns, systemMessage) { last = String(systemMessage ?? ''); return ''; },
                sendVisionRequest: () => Promise.reject(new Error('no vision')), embed: () => Promise.reject(new Error('no embeddings')) };
            Object.assign(prompter, { chat_model: model, code_model: model, vision_model: model, embedding_model: model, cooldown: 0 });
            await prompter.initExamples();
            await prompter.promptConvo([]);
            return last;
        } finally {
            cap.restore();
        }
    }

    test('every switch on, the five new ones too, a block of 600 characters with the job line: at most 17,000 characters', async (t) => {
        const prompt = await conversingPrompt({ ...Object.fromEntries(PARTS.map((p) => [p, true])), ...SWITCHES_ON, world_memory: true }, [], fullBlock(600));
        t.diagnostic(`v0.1.4.10, every switch on: ${prompt.length} characters`);
        for (const name of NEW_COMMANDS) assert.ok(prompt.includes(`\n${name}: `), name);
        assert.ok(prompt.includes(`${fullBlock(600)}\nConversation Begin:`));
        assert.ok(prompt.length <= LIMIT_ALL_ON, `${prompt.length} characters`);
    });

    test('every switch off, the commands that agent.js hides hidden: neither command; the size for the report', async (t) => {
        const hidden = blockedPushes().flatMap((p) => p.names);
        for (const name of NEW_COMMANDS) assert.ok(hidden.includes(name), `agent.js hides ${name}`);
        const prompt = await conversingPrompt({ ...Object.fromEntries(PARTS.map((p) => [p, false])), ...SWITCHES_OFF, world_memory: true, knowledge_in_prompt: false },
            hidden, fullBlock(600));
        t.diagnostic(`v0.1.4.10, every switch off: ${prompt.length} characters`);
        for (const name of NEW_COMMANDS) assert.ok(!prompt.includes(`\n${name}: `), name);
        assert.ok(!prompt.includes('WHAT YOU KNOW'));
        assert.ok(prompt.length <= 11000, `${prompt.length} characters`);
    });
});

describe('no new examples (section 9, item 4)', () => {
    test('no example names !mines or !forgetMine; the job adds no example', () => {
        for (const example of [...DEFAULT.conversation_examples, ...DEFAULT.coding_examples]) {
            for (const name of NEW_COMMANDS) assert.ok(!F.exampleCommands(example).includes(name), name);
        }
    });
});

describe('the routing list (section 9, item 5)', () => {
    test('6 sentences for !mines and !forgetMine in the part mining_pack, each command at least twice', () => {
        const own = SENTENCES.filter((e) => e.expect.some((name) => NEW_COMMANDS.includes(name)));
        assert.equal(own.length, 6);
        for (const e of own) {
            assert.equal(e.part, 'mining_pack', e.say);
            assert.deepEqual(Object.keys(e).sort(), ['expect', 'part', 'say']);
            assert.ok(NEW_COMMANDS.includes(e.expect[0]), `the command of the release first: ${e.say}`);
        }
        for (const name of NEW_COMMANDS) assert.ok(own.filter((e) => e.expect[0] === name).length >= 2, name);
        assert.equal(new Set(SENTENCES.map((e) => e.say.toLowerCase())).size, SENTENCES.length, 'no sentence twice');
    });
});
