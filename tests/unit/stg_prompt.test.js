// Part G of v0.1.4.8 (E6): the prompt.
//   - $KNOWLEDGE in the conversing prompt of _default.json; the block of knowledgeText reaches the prompt
//     word for word with knowledge_in_prompt, also for a profile without the placeholder (the profile of
//     the owner), the same way as the rules of the players (insertSection); without the switch the
//     prompt is the one of v0.1.4.7;
//   - the size: with every switch of the fork on and a block of knowledge_max_chars, the conversing prompt
//     without conversation stays at 17,000 characters or less (the sizes are printed);
//   - profiles/claude.json: HOUSE RULES holds one rule, "Never dig straight down.";
//   - the examples: the commands that had none, the new commands and types; "let's get some sleep" and
//     "go to bed please" lead to !goToBed; no example switches a safety reflex off.
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
const F = await loadSrc('src/agent/rules/example_filter.js');
const DEFAULT = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
const CLAUDE = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));

const LIMIT_ALL_ON = 17000;
const PLAYER = 'steve';
// every switch of the fork that changes the conversing prompt
const PARTS = ['cost_meter', 'protected_areas', 'player_rules', 'home_pack', 'storage_pack', 'farming_pack', 'wood_pack', 'mining_pack'];
const NEW_SWITCHES = { knowledge_in_prompt: true, knowledge_max_chars: 600, protect_built_blocks: true, repeat_guard: 3, restart_context: true,
    say_results: true, flee_below_health: 8, stuck_restart_after: 3, log_timestamps: true };

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

// The prompt that promptConvo sends, from a Prompter made with Object.create (no model is built).
async function promptOf(conversing, agentFields = {}, settings = {}) {
    M.settingsModule.setSettings({ language: 'en', blocked_actions: [], ...settings });
    let sent = null;
    const model = { async sendRequest(turns, prompt) { sent = prompt; return ''; } };
    const fake = Object.create(M.prompter.Prompter.prototype);
    Object.assign(fake, {
        agent: { name: 'andy', blocked_actions: [], self_prompter: { isStopped: () => true }, ...agentFields },
        profile: { conversing }, cooldown: 0, last_prompt_time: 0, awaiting_coding: false, convo_examples: null, chat_model: model,
    });
    const cap = captureConsole();
    try {
        await fake.promptConvo([{ role: 'user', content: 'bob: hi' }]);
    } finally {
        cap.restore();
    }
    return sent;
}

const BLOCK = 'WHAT YOU KNOW (from memory, no need to check):\nChest (11, 67, 53): wheat 28.\nAreas: farm (farm, 1 gate).';

describe('$KNOWLEDGE and the block of what the bot knows (C1, I9)', () => {
    test('_default.json: $KNOWLEDGE between $INVENTORY and $COMMAND_DOCS, once, in the conversing prompt only', () => {
        assert.ok(DEFAULT.conversing.includes('$INVENTORY\n$KNOWLEDGE$COMMAND_DOCS\n'));
        assert.equal(DEFAULT.conversing.split('$KNOWLEDGE').length, 2);
        for (const key of ['coding', 'saving_memory', 'bot_responder', 'image_analysis']) assert.ok(!DEFAULT[key].includes('$KNOWLEDGE'), key);
    });

    test('with the placeholder: the block word for word in its place; the line break of $COMMAND_DOCS follows', async () => {
        const conversing = 'You are $NAME.\nINV\n$KNOWLEDGE\n*DOCS\nConversation Begin:';
        const prompt = await promptOf(conversing, { knowledgeBlock: () => BLOCK }, { knowledge_in_prompt: true });
        assert.equal(prompt, `You are andy.\nINV\n${BLOCK}\n*DOCS\nConversation Begin:`);
    });

    test('without the placeholder (profiles/claude.json): before the line "Conversation Begin:", after the rules of the players', async () => {
        const conversing = 'You are $NAME.\n$SELF_PROMPT\nConversation Begin:';
        const rule_store = { list: () => [{ id: 1, text: 'Never attack the cows.' }] };
        const prompt = await promptOf(conversing, { knowledgeBlock: () => BLOCK, rule_store }, { knowledge_in_prompt: true });
        assert.equal(prompt, `You are andy.\n\nRULES FROM THE PLAYER (always follow them, they are more important than your own ideas):\n1. Never attack the cows.\n${BLOCK}\nConversation Begin:`);
    });

    test('a block with $ and placeholder words arrives unchanged', async () => {
        const odd = 'WHAT YOU KNOW (from memory, no need to check):\nAreas: $NAME $& (building).';
        assert.equal(await promptOf('A $KNOWLEDGE B', { knowledgeBlock: () => odd }, { knowledge_in_prompt: true }), `A ${odd} B`);
    });

    test('off: the block is never asked for, the placeholder is removed, a prompt without it is unchanged (v0.1.4.7)', async () => {
        const agentFields = { knowledgeBlock() { throw new Error('must not be asked'); } };
        assert.equal(await promptOf('A\n$KNOWLEDGE*DOCS\nConversation Begin:', agentFields), 'A\n*DOCS\nConversation Begin:');
        assert.equal(await promptOf('You are $NAME.\nConversation Begin:', agentFields), 'You are andy.\nConversation Begin:');
    });

    test('on, but an empty block or an agent without it: no change, and a block that throws gives a warning', async () => {
        assert.equal(await promptOf('You are $NAME.\nConversation Begin:', { knowledgeBlock: () => '' }, { knowledge_in_prompt: true }), 'You are andy.\nConversation Begin:');
        assert.equal(await promptOf('A $KNOWLEDGE B', {}, { knowledge_in_prompt: true }), 'A  B');
        assert.equal(await promptOf('You are $NAME.\nConversation Begin:', { knowledgeBlock() { throw new Error('broken'); } }, { knowledge_in_prompt: true }), 'You are andy.\nConversation Begin:');
    });
});

describe('the size of the conversing prompt (section 11, item 12)', () => {
    // As tests/unit/glue2_prompt_size.test.js: the real Prompter with profiles/claude.json, the settings of
    // settings.js with the switches set, the blocked commands of blockedFor, the fixed fake state.
    const pad = (text) => '\n' + text + '\n';
    const FAKE_INVENTORY = pad(['INVENTORY', '- oak_log: 12', '- oak_planks: 8', '- cobblestone: 34', '- bread: 6', '- apple: 3',
        '- wheat_seeds: 14', '- torch: 9', '- raw_iron: 5', '- stone_sword: 1', '- stone_pickaxe: 1', 'In the off-hand: bread 6', 'WEARING: Nothing'].join('\n'));
    // the state of a bot in play: the world, the area, the reflexes of the home pack when it is on
    function fakeStats(modes, home) {
        const homeModes = home ? { hunger: true, creeper_safety: true, night_shelter: true, door_closing: true } : {};
        const modeLines = Object.entries({ ...(modes ?? {}), ...homeModes }).map(([name, on]) => `- ${name}(${on ? 'ON' : 'OFF'})`);
        const stats = ['STATS', '- Position: x: 12.50, y: 64.00, z: -3.30', '- World: seed-ce66bf80acdefa75', '- Dimension: overworld',
            ...(home ? ['- Area: farm (farm, protected)'] : []), '- Gamemode: survival', '- Health: 20 / 20', '- Hunger: 17 / 20', '- Biome: plains', '- Weather: Clear',
            '- Time: Afternoon', '- Current Action: Idle', `- Nearby Human Players: ${PLAYER}`, '- Nearby Bot Players: None.',
            ['Agent Modes:', ...modeLines].join('\n')].join('\n') + '\n';
        const entities = ['NEARBY_ENTITIES', `- Human player: ${PLAYER}`, '- entities: 2 cow(s)', '- entities: 1 chicken(s)'].join('\n');
        const blocks = ['NEARBY_BLOCKS', '- grass_block', '- dirt', '- oak_log', '- oak_leaves', '- stone', '- oak_planks', '- oak_door',
            '- Block Below: grass_block', '- Block at Legs: air', '- Block at Head: air', '- First Solid Block Above Head: none'].join('\n');
        return pad(stats) + '\n' + pad(entities) + '\n' + pad(blocks);
    }

    async function conversingPrompt(switches, knowledge) {
        const profile = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
        const settings = { ...S.runSettings(M.fileSettings, profile, false), ...switches };
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

    // a block of exactly knowledge_max_chars characters, as knowledgeText can give at most
    const fullBlock = (max) => {
        const lines = ['WHAT YOU KNOW (from memory, no need to check):', 'You are in the area "farm" (farm), on the surface.'];
        let i = 0;
        while (lines.join('\n').length < max) lines.push(`Chest (${i}, 67, ${i++}): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52.`);
        return lines.join('\n').slice(0, max);
    };

    test('every switch off: the size for the report, no new command of v0.1.4.8 but !pickUpItems', async (t) => {
        const off = Object.fromEntries(PARTS.map((p) => [p, false]));
        const prompt = await conversingPrompt({ ...off, world_memory: true, knowledge_in_prompt: false }, fullBlock(600));
        t.diagnostic(`all switches off: ${prompt.length} characters`);
        assert.ok(!prompt.includes('WHAT YOU KNOW'));
        assert.ok(prompt.includes('\n!pickUpItems: '), 'always offered');
        assert.ok(!prompt.includes('\n!closeDoor: '));
        assert.ok(prompt.length <= 11000, `${prompt.length} characters`);
    });

    test('every switch on, with a block of 600 characters: at most 17,000 characters', async (t) => {
        const on = Object.fromEntries(PARTS.map((p) => [p, true]));
        const block = fullBlock(600);
        assert.equal(block.length, 600);
        const prompt = await conversingPrompt({ ...on, ...NEW_SWITCHES, world_memory: true }, block);
        t.diagnostic(`all switches on: ${prompt.length} characters (the block of knowledge ${block.length})`);
        assert.ok(prompt.includes(`${block}\nConversation Begin:`), 'the block before the conversation');
        for (const name of ['!pickUpItems', '!closeDoor', '!chests', '!mineOre', '!rememberArea']) assert.ok(prompt.includes(`\n${name}: `), name);
        assert.ok(prompt.length <= LIMIT_ALL_ON, `${prompt.length} characters`);
    });
});

describe('profiles/claude.json (section 11, item 12 of the task)', () => {
    test('HOUSE RULES holds only "Never dig straight down."; the text around it is the one of the default profile', () => {
        const rules = 'HOUSE RULES (always follow these, they override casual chat):\n- Never dig straight down.\nSummarized memory:';
        assert.ok(CLAUDE.conversing.includes(rules), CLAUDE.conversing);
        assert.equal(CLAUDE.conversing.split('HOUSE RULES').length, 2);
        assert.ok(!/night|shelter|door|health/i.test(CLAUDE.conversing.slice(CLAUDE.conversing.indexOf('HOUSE RULES'), CLAUDE.conversing.indexOf('Summarized memory'))));
        const [before, after] = CLAUDE.conversing.split(`\n${rules}`);
        assert.equal(before, DEFAULT.conversing.slice(0, DEFAULT.conversing.indexOf('\nSummarized memory:')), 'the text before the rules');
        assert.equal(after, "'$MEMORY'\n$STATS\n$INVENTORY\n$COMMAND_DOCS\n$EXAMPLES\nConversation Begin:");
        assert.deepEqual(Object.keys(CLAUDE), ['name', 'model', 'speak_model', 'conversing', 'code_model']);
    });

    test('the file keeps its CRLF line endings', () => {
        const text = fs.readFileSync(repoPath('profiles/claude.json'), 'utf8');
        assert.equal(text.split('\r\n').length, text.split('\n').length);
    });
});

describe('the examples (section 11, item 11)', () => {
    const EXAMPLES = DEFAULT.conversation_examples;
    const userSays = (example, sentence) => example.some((t) => t.role === 'user' && t.content.endsWith(`: ${sentence}`));
    const exampleOf = (sentence) => EXAMPLES.find((e) => userSays(e, sentence));

    test('every command that had no example has one now', () => {
        const NONE_BEFORE = ['!goToBed', '!rules', '!forgetRule', '!areas', '!forgetArea', '!setArea', '!allowChanges', '!givePlayer',
            '!goToCoordinates', '!stay', '!searchForEntity', '!equip', '!placeHere', '!smeltItem'];
        const used = new Set(EXAMPLES.flatMap((e) => F.exampleCommands(e)));
        for (const name of NONE_BEFORE) assert.ok(used.has(name), name);
    });

    test('the new commands and types have their examples', () => {
        const CASES = [
            ['this is the mine', '!rememberArea("mine", "mine")'], ['this is the pen for the animals', '!rememberArea("pen", "pen")'],
            ['pick up what I dropped', '!pickUpItems'], ['close the door', '!closeDoor'], ['do you remember what is in the chest', '!chests'],
            ['do we have wheat', '!chests("wheat")'], ['yes, dig a new mine', '!mineOre("iron", 8, true)'],
        ];
        for (const [sentence, call] of CASES) {
            const example = exampleOf(sentence);
            assert.ok(example, sentence);
            assert.ok(example.some((t) => t.role === 'assistant' && t.content.includes(call)), `${sentence}: ${call}`);
        }
    });

    test('"let\'s get some sleep" and "go to bed please" lead to !goToBed, never to a walk home; the wheat to !givePlayer', () => {
        for (const sentence of ["let's get some sleep", 'go to bed please']) {
            const names = F.exampleCommands(exampleOf(sentence));
            assert.deepEqual(names, ['!goToBed'], sentence);
        }
        assert.deepEqual(F.exampleCommands(exampleOf("give me all the wheat you've got")), ['!givePlayer']);
    });

    test('no example switches a safety reflex off', () => {
        const SAFETY = ['self_preservation', 'creeper_safety', 'night_shelter', 'door_closing', 'hunger'];
        for (const example of [...EXAMPLES, ...DEFAULT.coding_examples]) {
            for (const turn of example) {
                for (const name of SAFETY) assert.ok(!new RegExp(`!setMode\\(\\s*["']${name}["']\\s*,\\s*(false|"off"|'off'|0)`).test(turn.content), `${name}: ${turn.content}`);
            }
        }
    });

    test('the sentences of the new examples are in the routing list with the command of the example', () => {
        const sentences = JSON.parse(fs.readFileSync(repoPath('tests/routing/sentences.json'), 'utf8'));
        for (const [say, name] of [['pick up what I dropped', '!pickUpItems'], ['close the door', '!closeDoor'], ['do we have wheat', '!chests'],
            ['this is the mine', '!rememberArea'], ['go to bed please', '!goToBed'], ["give me all the wheat you've got", '!givePlayer'], ['yes, dig a new mine', '!mineOre']]) {
            const entry = sentences.find((e) => e.say === say);
            assert.ok(entry?.expect.includes(name), say);
        }
        assert.ok(T.ALL_COMMAND_NAMES.includes('!pickUpItems') && T.ALL_COMMAND_NAMES.includes('!closeDoor'));
    });
});
