// T1 round 2, spec v0.1.4.8 section 11, items 11 and 12 (the prompt), and the task of round 2 (items 7, 8):
//   - with knowledge_in_prompt the block of what the bot knows is in the prompt of the default profile
//     ($KNOWLEDGE) AND of a profile with its own conversing text without the placeholder (profiles/claude.json);
//   - with the switch off the prompt is the same as without the feature;
//   - with every switch on the conversing prompt without conversation stays at 17,000 characters or less
//     (the sizes all off and all on are printed as diagnostics);
//   - no example shows a safety reflex being switched off; each of the 14 commands that had no example has
//     one; "let's get some sleep" has an example that leads to !goToBed; the examples of section 11, item 11;
//   - profiles/claude.json: no HOUSE RULES block since 2026-10-02 (the owner: digging down is conditional, so
//     no rule), and code_model is still there.
// Prompter.promptConvo runs on an object made with Object.create(Prompter.prototype): no model is made and
// no key is read. $STATS and $INVENTORY are replaced by fixed texts of the size of a bot in play.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { blockedPushes } from '../helpers/st_glue_env.js';

const DEFAULT = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
const CLAUDE_TEXT = fs.readFileSync(repoPath('profiles/claude.json'), 'utf8');
const CLAUDE = JSON.parse(CLAUDE_TEXT);
const SPEC = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
const SAFETY = ['self_preservation', 'creeper_safety', 'night_shelter', 'door_closing', 'hunger'];

let M;
before(async () => {
    const cwd = process.cwd();
    const empty = makeTmpDir();
    const cap = captureConsole();
    process.chdir(empty); // no keys.json, no bots/ folder of the work folder
    try {
        M = {
            settingsModule: await loadSrc('src/agent/settings.js'),
            prompter: await loadSrc('src/models/prompter.js'),
            examples: await loadSrc('src/utils/examples.js'),
        };
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
});
after(() => M.settingsModule.setSettings({}));

// The texts a bot in play puts in the place of $STATS and $INVENTORY (about 1,500 characters).
const STATS = ['STATS', '- Position: x: 12.50, y: 64.00, z: -3.30', '- Dimension: overworld', '- Gamemode: survival', '- Health: 20 / 20',
    '- Hunger: 17 / 20', '- Biome: plains', '- Weather: Clear', '- Time: Afternoon', '- Current Action: Idle', '- Nearby Human Players: MartyByrde2',
    '- Nearby Bot Players: None.', 'Agent Modes:', ...['self_preservation', 'unstuck', 'cowardice', 'self_defense', 'hunting', 'item_collecting',
        'torch_placing', 'elbow_room', 'idle_staring', 'cheat', 'hunger', 'creeper_safety', 'night_shelter', 'door_closing'].map((m) => `- ${m}(ON)`),
    '', 'NEARBY_ENTITIES', '- Human player: MartyByrde2', '- entities: 2 cow(s)', '', 'NEARBY_BLOCKS', '- grass_block', '- dirt', '- oak_log',
    '- oak_leaves', '- stone', '- oak_planks', '- oak_door', '- Block Below: grass_block', '- Block at Legs: air', '- Block at Head: air',
    '- First Solid Block Above Head: none'].join('\n');
const INVENTORY = ['INVENTORY', '- oak_log: 12', '- oak_planks: 8', '- cobblestone: 34', '- bread: 6', '- apple: 3', '- wheat_seeds: 14',
    '- torch: 9', '- raw_iron: 5', '- stone_sword: 1', '- stone_pickaxe: 1', 'WEARING: Nothing'].join('\n');

const BLOCK = 'WHAT YOU KNOW (from memory, no need to check):\nYou are in the area "farm" (farm), on the surface.\nChest (11, 67, 53): wheat 28.\nAreas: farm (farm, 1 gate).';
// v0.1.4.14 (part K, SPEC 4.7): the lead's decision, since the budget of v0.1.4.13 had 13 characters left: with every
// switch on, new_things_in_prompt among them, a block of 600 and the three longest lines of the new things present, the
// prompt may hold 17,400 characters; without the block of the new things the old 17,000 hold. Fix round, part 8 (P-28): the
// three commands !boardBoat, !leaveBoat and !leaveGame add 173 characters of docs; the lead raised both limits by 200
// (17,000 to 17,200 and 17,400 to 17,600), as R1-7 did once in this release. v0.1.4.15 (SPEC 4): the eight commands of the
// base survey (552 characters) and the routines (533) add 1,085 characters of one-line docs (18,596 measured with every switch
// on, 17,511 before); both limits rise by that growth rounded up to the next 100 (1,100): 18,300 and 18,700. v0.1.4.16 (SPEC 5,
// E1): the one line of docs of !sealOpening adds 195 characters; both limits rise by that growth only: 18,495 and 18,895.
// v0.1.4.16 round two (SPEC 8.0, E6, the lead's decision): the docs of !breed, !allowTaking, !enchant, !enchantTake, !killFarm
// (1,180) and the longer enchanting example chosen in place of a !newAction one (90), measured 1,270; every limit rises by that
// growth rounded up to the next 100 (1,300): 19,795 and 20,195.
const LIMIT_NEW_THINGS = 20195;
const NEW_THINGS_HEADER = 'NEW SINCE 1.21.8 (true, even if you do not know it):';
// a bot with the things of the three longest lines of the new things: a copper golem statue and a copper pickaxe in the
// bag, a nautilus 3 blocks away; the block holds what fits in its 360 characters
const NEW_THINGS_BOT = {
    inventory: { items: () => [{ name: 'copper_golem_statue', count: 1 }, { name: 'copper_pickaxe', count: 1 }], slots: [] },
    entity: { position: { x: 0.5, y: 64, z: 0.5 } }, blockAt: () => null,
    entities: { 7: { name: 'nautilus', position: { x: 3.5, y: 64, z: 0.5 } } },
};
// the block those give: the copper tools line and the nautilus line (354 characters); the copper golem line does not fit
const NEW_THINGS_BLOCK = [NEW_THINGS_HEADER,
    'Copper tools and armour exist since 1.21.9: like stone but faster, 190 uses, from copper ingots; a copper pickaxe mines iron, copper and lapis, not diamond or gold.',
    'A nautilus is a neutral ocean mob that dashes when hit and is tamed with pufferfish; a zombie nautilus carries a drowned with a trident.'].join('\n');

// The prompt that promptConvo sends to the model.
async function promptOf(conversing, { settings = {}, blocked = [], knowledge = null, rules = null } = {}) {
    M.settingsModule.setSettings({ language: 'en', num_examples: 2, log_all_prompts: false, blocked_actions: [], ...settings });
    let sent = null;
    const agent = {
        name: 'claude', blocked_actions: blocked, history: { memory: '' }, task: { task_id: null }, npc: {},
        self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
        actions: { currentActionLabel: '' },
    };
    if (knowledge !== null) agent.knowledgeBlock = () => knowledge;
    if (settings.new_things_in_prompt === true) agent.bot = NEW_THINGS_BOT; // v0.1.4.14 (part K)
    if (rules) agent.rule_store = { list: () => rules.map((text, i) => ({ id: i + 1, text })) };
    const prompter = Object.create(M.prompter.Prompter.prototype);
    const examples = new M.examples.Examples(null, 2);
    const cap = captureConsole();
    try {
        await examples.load(DEFAULT.conversation_examples);
        Object.assign(prompter, {
            agent, cooldown: 0, last_prompt_time: 0, awaiting_coding: false, convo_examples: examples,
            profile: { conversing: conversing.replaceAll('$STATS', STATS).replaceAll('$INVENTORY', INVENTORY) },
            chat_model: { async sendRequest(turns, prompt) { sent = prompt; return ''; } },
        });
        await prompter.promptConvo([]);
    } finally {
        cap.restore();
    }
    return sent;
}

describe('item 7: the block of what the bot knows', () => {
    test('the default profile ($KNOWLEDGE): the block is in the prompt, once', async () => {
        const prompt = await promptOf(DEFAULT.conversing, { settings: { knowledge_in_prompt: true }, knowledge: BLOCK });
        assert.equal(prompt.split(BLOCK).length, 2, 'once');
    });

    test('profiles/claude.json (its own conversing, no placeholder): the block is in the prompt, once, before the conversation', async () => {
        assert.ok(!CLAUDE.conversing.includes('$KNOWLEDGE'));
        const prompt = await promptOf(CLAUDE.conversing, { settings: { knowledge_in_prompt: true }, knowledge: BLOCK });
        assert.equal(prompt.split(BLOCK).length, 2, 'once');
        assert.ok(prompt.indexOf(BLOCK) < prompt.lastIndexOf('Conversation Begin:'));
    });

    test('off: the default profile gives the prompt of the text without the feature (v0.1.4.7)', async () => {
        const off = await promptOf(DEFAULT.conversing, { knowledge: BLOCK });
        const without = await promptOf(DEFAULT.conversing.replace('$KNOWLEDGE', ''), { knowledge: BLOCK });
        assert.equal(off, without);
        assert.ok(!off.includes('WHAT YOU KNOW'));
    });

    test('off: the profile of the owner gives the prompt without the feature', async () => {
        const off = await promptOf(CLAUDE.conversing, { knowledge: BLOCK });
        const without = await promptOf(CLAUDE.conversing, {});
        assert.equal(off, without);
        assert.ok(!off.includes('WHAT YOU KNOW'));
    });

    test('on with nothing known: the prompt of the text without the feature', async () => {
        const on = await promptOf(DEFAULT.conversing, { settings: { knowledge_in_prompt: true }, knowledge: '' });
        assert.equal(on, await promptOf(DEFAULT.conversing.replace('$KNOWLEDGE', ''), {}));
    });
});

describe('item 7: the size of the conversing prompt', () => {
    // a block of exactly knowledge_max_chars characters (600), the most knowledgeText gives
    function fullBlock(max = 600) {
        const lines = ['WHAT YOU KNOW (from memory, no need to check):', 'You are in the area "farm" (farm), on the surface.'];
        for (let i = 0; lines.join('\n').length < max; i++) lines.push(`Chest (${i}, 67, ${i}): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52.`);
        return lines.join('\n').slice(0, max);
    }
    const ALL_ON = { cost_meter: true, protected_areas: true, world_memory: true, player_rules: true, home_pack: true, storage_pack: true,
        farming_pack: true, wood_pack: true, mining_pack: true, skill_learning: true, allow_insecure_coding: true, knowledge_in_prompt: true,
        knowledge_max_chars: 600, protect_built_blocks: true, repeat_guard: 3, restart_context: true, say_results: true, flee_below_health: 8,
        stuck_restart_after: 3, log_timestamps: true,
        routes_pack: true, mine_routes: true, watch_and_learn: true, base_survey: true, routines: true,
        breeding: true, enchanting: true, afk_kill: true }; // v0.1.4.15: every switch that hides commands; v0.1.4.16 (8.0): the three packs
    const RULES = ['Never attack the cows.', 'Keep the farm gate closed.', 'Store the wheat in the chest at the farm.'];

    const SKILL_COMMANDS = ['!skills', '!forgetSkill', '!disableSkill', '!enableSkill', '!useSkill'];

    test('the switches of the packs and of this release on, a block of 600 characters: 17,600 characters or less with the new things (17,200 without)', async (t) => {
        const block = fullBlock();
        assert.equal(block.length, 600);
        // v0.1.4.14 (part K): new_things_in_prompt on with the three longest lines present: 17,400; without its block 17,000;
        // part 8 (P-28): 17,600 and 17,200 for the three commands' docs
        const prompt = await promptOf(CLAUDE.conversing, { settings: { ...ALL_ON, new_things_in_prompt: true },
            blocked: [...SPEC.blocked_actions.default, ...SKILL_COMMANDS], knowledge: block });
        t.diagnostic(`packs and v0.1.4.8 on, skill commands hidden, no rule saved, the new things: ${prompt.length} characters`);
        assert.ok(prompt.includes(`${block}\n${NEW_THINGS_BLOCK}`));
        for (const name of ['!pickUpItems', '!closeDoor', '!chests', '!mineOre', '!chopTrees', '!rememberArea']) assert.ok(prompt.includes(`\n${name}: `), name);
        assert.ok(prompt.length <= LIMIT_NEW_THINGS, `${prompt.length} characters`);
        assert.ok(prompt.replace(`\n${NEW_THINGS_BLOCK}`, '').length <= 19795, 'without the block of the new things'); // v0.1.4.16: 18,300 + 195; round two + 1,300
    });

    // T1-Q5, decided by the tech lead: the limit of 17,000 holds for the packs and the switches of v0.1.4.8
    // (the test above). With the switches of skill learning on too (5 more commands, 548 characters of docs) and
    // three rules of the player saved, the prompt is about 17,470 characters; for that case the limit is 18,000.
    // v0.1.4.15 (SPEC 4): the eight commands of the survey and the routines add 1,085 characters (18,906 measured here); the
    // limit rises by the same 1,100 as the others, to 19,100.
    // v0.1.4.16 (SPEC 5, E1): the one line of docs of !sealOpening adds 195 characters (19,101 measured here); the limit rises
    // by the same 195 as the others, to 19,295.
    // v0.1.4.16 round two (SPEC 8.0, E6, the lead's decision): the five commands of the three packs and the longer enchanting
    // example, measured 1,270 (20,371 measured here); the limit rises by the same 1,300 as the others, to 20,595.
    test('every switch on, the skill commands and three saved rules included: 20,595 characters or less', async (t) => {
        const prompt = await promptOf(CLAUDE.conversing, { settings: ALL_ON, blocked: SPEC.blocked_actions.default, knowledge: fullBlock(), rules: RULES });
        t.diagnostic(`every switch on, skill commands shown, 3 rules: ${prompt.length} characters`);
        assert.ok(prompt.length <= 20595, `${prompt.length} characters`);
    });

    test('every switch off: the size, for the report', async (t) => {
        const hidden = [...new Set(blockedPushes().flatMap((p) => p.names))];
        const prompt = await promptOf(CLAUDE.conversing, { blocked: [...SPEC.blocked_actions.default, ...hidden], knowledge: fullBlock() });
        t.diagnostic(`every switch off: ${prompt.length} characters`);
        assert.ok(!prompt.includes('WHAT YOU KNOW'));
        assert.ok(prompt.includes('\n!pickUpItems: '), 'always there');
        assert.ok(!prompt.includes('\n!closeDoor: '));
    });
});

describe('item 7: the examples', () => {
    const EXAMPLES = DEFAULT.conversation_examples;
    const commandsOf = (example) => example.filter((t) => t.role === 'assistant').flatMap((t) => (t.content.match(/!\w+/g) ?? []));
    const userSays = (example, words) => example.some((t) => t.role === 'user' && t.content.toLowerCase().includes(words));

    test('no example shows a safety reflex being switched off', () => {
        const all = [...EXAMPLES, ...(DEFAULT.coding_examples ?? []), ...(CLAUDE.conversation_examples ?? [])];
        for (const example of all) {
            for (const turn of example) {
                for (const name of SAFETY) {
                    assert.ok(!new RegExp(`!setMode\\(\\s*["']${name}["']\\s*,\\s*(false|0|["']off["'])`, 'i').test(turn.content), `${name}: ${turn.content}`);
                }
            }
        }
    });

    test('each of the 14 commands that had no example has one now', () => {
        const used = new Set(EXAMPLES.flatMap(commandsOf));
        const NONE_BEFORE = ['!goToBed', '!rules', '!forgetRule', '!areas', '!forgetArea', '!setArea', '!allowChanges', '!givePlayer',
            '!goToCoordinates', '!stay', '!searchForEntity', '!equip', '!placeHere', '!smeltItem'];
        assert.deepEqual(NONE_BEFORE.filter((name) => !used.has(name)), []);
    });

    test('"let\'s get some sleep" has an example that leads to !goToBed', () => {
        const example = EXAMPLES.find((e) => userSays(e, "let's get some sleep"));
        assert.ok(example, 'an example with the sentence');
        assert.ok(commandsOf(example).includes('!goToBed'), JSON.stringify(example));
    });

    const ITEM_11 = [
        ['this is the mine', '!rememberArea("mine", "mine")'],
        ['pen', '!rememberArea('],
        ['pick up what i dropped', '!pickUpItems'],
        ['close the door', '!closeDoor'],
        ['do you remember what is in the chest', '!chests'],
        ['do we have wheat', '!chests("wheat")'],
        ['yes, dig a new mine', '!mineOre("iron", 8, true)'],
    ];
    for (const [words, call] of ITEM_11) {
        test(`section 11, item 11: "${words}" leads to ${call}`, () => {
            const example = EXAMPLES.find((e) => userSays(e, words) && e.some((t) => t.role === 'assistant' && t.content.includes(call)));
            assert.ok(example, `${words} -> ${call}`);
        });
    }
});

describe('item 8: profiles/claude.json', () => {
    test('no HOUSE RULES block and no rule about digging down (the owner, 2026-10-02: it is conditional)', () => {
        const text = CLAUDE.conversing;
        assert.equal(text.indexOf('HOUSE RULES'), -1);
        assert.ok(!/dig straight down/i.test(text));
        assert.ok(!text.split('\n').some((line) => line.startsWith('- ')), 'no rule lines');
    });

    test('code_model is still there', () => {
        assert.ok(CLAUDE.code_model && typeof CLAUDE.code_model === 'object');
        assert.equal(typeof CLAUDE.code_model.model, 'string');
        assert.ok(CLAUDE.code_model.model.length > 0);
    });

    test('the file is valid JSON with the name and the model of the owner', () => {
        assert.equal(CLAUDE.name, 'claude');
        // v0.1.4.14 (part H, SPEC 4.9): the model may be an object with its params ({ model, params: { output_config } })
        assert.equal(typeof (typeof CLAUDE.model === 'object' && CLAUDE.model !== null ? CLAUDE.model.model : CLAUDE.model), 'string');
        assert.ok(CLAUDE_TEXT.length > 0);
    });
});
