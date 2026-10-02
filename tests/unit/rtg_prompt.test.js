// Part G of v0.1.4.9 (E5): what the model sees.
//   - the command docs of the six commands of I10, word for word, as getCommandDocs writes them;
//   - the size of the conversing prompt (section 10, item 7): with every switch on, the new ones too, and a
//     block of knowledge of 600 characters, at most 17,000 characters; every switch off, the six hidden, the
//     size for the report (the sizes are printed);
//   - the examples of section 10, item 6 in profiles/defaults/_default.json, hidden with their part; no example
//     switches a safety reflex off;
//   - the routing list: at least 15 sentences for the new commands, parts routes_pack and mine_routes.
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

const ROUTE_COMMANDS = ['!rememberRoute', '!routes', '!forgetRoute'];
const MINE_COMMANDS = ['!rememberMine', '!rememberTunnel', '!collectPassedOre'];
const NEW_COMMANDS = [...ROUTE_COMMANDS, ...MINE_COMMANDS];
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

describe('the command docs of the six commands (I10), as the model sees them', () => {
    test('word for word', () => {
        M.settingsModule.setSettings({ language: 'en', blocked_actions: [] });
        const docs = M.commands.getCommandDocs({ blocked_actions: [] });
        const at = docs.indexOf('\n!rememberRoute: ');
        assert.ok(at > 0);
        assert.equal(docs.slice(at + 1, docs.indexOf('\n!stay: ') + 1), [
            '!rememberRoute: Remember the way you walked here from a place you know. Use this when the player says "remember this way".',
            'Params:',
            'name: (string) The name of the way, for example "bed".',
            '!routes: List the ways you remember.',
            '!forgetRoute: Forget a way you remember.',
            'Params:',
            'name: (string) The name of the way.',
            '!rememberMine: Learn the mine you walked into: the way in, the room and a tunnel. Use this when the player says "remember this mine".',
            'Params:',
            'name: (string) The name of the mine. (optional, default "mine")',
            '!rememberTunnel: Measure the tunnel here. Use this when the player says "dig here".', // v0.1.4.11, W: shorter, the prompt stays at 17,000
            'Params:',
            'name: (string) The mine, empty for this one. (optional, default "")',
            '!collectPassedOre: Collect the ore you left behind in the mine, when the player asks for it.',
            'Params:',
            'ore: (string) The ore, for example "coal", empty for all.',
            'num: (number) The most ore blocks to take. (optional, default 8)',
        ].join('\n') + '\n');
    });
});

describe('the size of the conversing prompt (section 10, item 7)', () => {
    // As tests/unit/stg_prompt.test.js: the real Prompter with profiles/claude.json, the settings of settings.js with
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
    const fullBlock = (max) => {
        const lines = ['WHAT YOU KNOW (from memory, no need to check):', 'You are in the area "farm" (farm), on the surface.'];
        for (let i = 0; lines.join('\n').length < max; i++) lines.push(`Chest (${i}, 67, ${i}): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52.`);
        return lines.join('\n').slice(0, max);
    };
    const PARTS = ['cost_meter', 'protected_areas', 'player_rules', 'home_pack', 'storage_pack', 'farming_pack', 'wood_pack', 'mining_pack', 'routes_pack', 'mine_routes'];
    const SWITCHES_ON = { knowledge_in_prompt: true, knowledge_max_chars: 600, protect_built_blocks: true, repeat_guard: 3, restart_context: true,
        say_results: true, flee_below_health: 8, stuck_restart_after: 3, log_timestamps: true, trail_max_steps: 500, ore_sense_range: 3, skills_over_code: true };

    async function conversingPrompt(switches, hidden, knowledge) {
        const profile = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
        // the 17,000 limit counts the switches of the fork's parts; skill learning is pinned off, never read from
        // settings.js (CLAUDE.md: unit tests never assert the values of settings; decision of the tech lead)
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

    test('every switch on, the new ones too, a block of 600 characters: at most 17,000 characters, the six commands offered', async (t) => {
        const prompt = await conversingPrompt({ ...Object.fromEntries(PARTS.map((p) => [p, true])), ...SWITCHES_ON, world_memory: true }, [], fullBlock(600));
        t.diagnostic(`v0.1.4.9, every switch on: ${prompt.length} characters`);
        for (const name of NEW_COMMANDS) assert.ok(prompt.includes(`\n${name}: `), name);
        assert.ok(prompt.includes(`${fullBlock(600)}\nConversation Begin:`));
        assert.ok(prompt.length <= LIMIT_ALL_ON, `${prompt.length} characters`);
    });

    test('every switch off, the commands that agent.js hides hidden: none of the six; the size for the report', async (t) => {
        const hidden = blockedPushes().flatMap((p) => p.names);
        for (const name of NEW_COMMANDS) assert.ok(hidden.includes(name), `agent.js hides ${name}`);
        const prompt = await conversingPrompt({ ...Object.fromEntries(PARTS.map((p) => [p, false])), world_memory: true, knowledge_in_prompt: false }, hidden, fullBlock(600));
        t.diagnostic(`v0.1.4.9, every switch off: ${prompt.length} characters`);
        for (const name of NEW_COMMANDS) assert.ok(!prompt.includes(`\n${name}: `), name);
        assert.ok(!prompt.includes('WHAT YOU KNOW'));
        assert.ok(prompt.length <= 11000, `${prompt.length} characters`);
    });
});

describe('the examples of section 10, item 6', () => {
    const EXAMPLES = DEFAULT.conversation_examples;
    const exampleOf = (sentence) => EXAMPLES.find((e) => e.some((t) => t.role === 'user' && t.content.endsWith(`: ${sentence}`)));
    const CASES = [
        ['this is the mine, remember this', '!rememberMine("mine")'],
        ['dig here', '!rememberTunnel'],
        ['remember this way to the bed', '!rememberRoute("bed")'],
        ['collect the coal you passed', '!collectPassedOre("coal")'],
        ['which ways do you know', '!routes'],
        ['forget the way to the bed', '!forgetRoute("bed")'],
    ];

    test('each sentence leads to its call, the only command of the example', () => {
        for (const [sentence, call] of CASES) {
            const example = exampleOf(sentence);
            assert.ok(example, sentence);
            assert.ok(example.some((t) => t.role === 'assistant' && t.content.endsWith(call)), `${sentence}: ${call}`);
            assert.deepEqual(F.exampleCommands(example), [call.match(/^![a-zA-Z]+/)[0]], sentence);
        }
    });

    test('they come after the examples of v0.1.4.8, which keep their order', () => {
        const at = EXAMPLES.findIndex((e) => F.exampleCommands(e).some((n) => NEW_COMMANDS.includes(n)));
        assert.equal(at, EXAMPLES.length - CASES.length);
        assert.ok(EXAMPLES.slice(0, at).every((e) => !F.exampleCommands(e).some((n) => NEW_COMMANDS.includes(n))));
    });

    test('hidden with their part: routes_pack off hides the ways, mine_routes off hides the mine', () => {
        const visible = (hidden) => F.visibleExamples(EXAMPLES, (n) => hidden.includes(n));
        const namesOf = (list) => new Set(list.flatMap((e) => F.exampleCommands(e)));
        const off = namesOf(visible(NEW_COMMANDS));
        for (const name of NEW_COMMANDS) assert.ok(!off.has(name), name);
        const routesOnly = namesOf(visible(MINE_COMMANDS));
        for (const name of ROUTE_COMMANDS) assert.ok(routesOnly.has(name), name);
        for (const name of MINE_COMMANDS) assert.ok(!routesOnly.has(name), name);
        assert.equal(visible([]).length, EXAMPLES.length);
    });

    test('no example switches a safety reflex off; the texts of the packs in them are those of the spec', () => {
        const SAFETY = ['self_preservation', 'creeper_safety', 'night_shelter', 'door_closing', 'hunger'];
        for (const example of [...EXAMPLES, ...DEFAULT.coding_examples]) {
            for (const turn of example) {
                for (const name of SAFETY) assert.ok(!new RegExp(`!setMode\\(\\s*["']${name}["']\\s*,\\s*(false|"off"|'off'|0)`).test(turn.content), `${name}: ${turn.content}`);
            }
        }
        const system = (sentence) => exampleOf(sentence).find((t) => t.role === 'system').content;
        assert.equal(system('remember this way to the bed'), 'I remember the way "bed": from the place "storage" to here, 7 steps, 1 ladder, 1 trapdoor. I walk it in both directions.');
        assert.equal(system('which ways do you know'), 'I know 2 routes: "bed" from the place "storage" to (12, 45, 8), 7 steps; "mine" from the area "home" to (30, 41, 4), 12 steps.');
        assert.equal(system('forget the way to the bed'), 'Forgot the route "bed".');
        assert.equal(system('collect the coal you passed'), 'I collected 4 coal_ore that I had passed.');
        assert.match(system('dig here'), /^I measured the tunnel: it starts at \(22, 25, 2\), goes south, and ends at \(22, 25, 13\) after 12 blocks, at level 25\. I dig on at its end when you ask for ore\.$/);
    });
});

describe('the routing list (section 10, item 8)', () => {
    const forNew = SENTENCES.filter((e) => e.expect.some((name) => NEW_COMMANDS.includes(name)));

    test('at least 15 sentences for the new commands, in the parts routes_pack and mine_routes, each command at least twice', () => {
        const own = forNew.filter((e) => ['routes_pack', 'mine_routes'].includes(e.part));
        assert.ok(own.length >= 15, `${own.length}`);
        for (const name of NEW_COMMANDS) assert.ok(own.filter((e) => e.expect.includes(name)).length >= 2, name);
        for (const e of own) {
            const part = e.expect.every((n) => ROUTE_COMMANDS.includes(n)) ? 'routes_pack' : 'mine_routes';
            assert.equal(e.part, part, e.say);
            assert.deepEqual(Object.keys(e).sort(), ['expect', 'part', 'say']);
        }
    });

    test('the sentences of the examples are in the list with the command of the example; "this is the mine" may lead to either', () => {
        for (const [say, name] of [['this is the mine, remember this', '!rememberMine'], ['dig here', '!rememberTunnel'], ['remember this way to the bed', '!rememberRoute'],
            ['collect the coal you passed', '!collectPassedOre'], ['which ways do you know', '!routes'], ['forget the way to the bed', '!forgetRoute']]) {
            assert.ok(SENTENCES.find((e) => e.say === say)?.expect.includes(name), say);
        }
        assert.deepEqual(SENTENCES.find((e) => e.say === 'this is the mine').expect, ['!rememberArea', '!rememberMine']);
        assert.equal(new Set(SENTENCES.map((e) => e.say)).size, SENTENCES.length, 'no sentence twice');
    });
});
