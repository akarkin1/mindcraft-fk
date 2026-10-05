// WAITS FOR PART M (SPEC 4.7, engineer E6, round 2): written from the spec while the part is built; a test may fail
// until it lands. Tests from the spec (v0.1.4.13, section 6, T1):
// M2 `prompt_cache`: replaceStrings builds the system prompt as two parts: the fixed part (the template up to and
//    including `$COMMAND_DOCS`, with `$NAME` and `$SELF_PROMPT` filled, `$MEMORY`, `$STATS`, `$INVENTORY`,
//    `$KNOWLEDGE`, `$EXAMPLES` removed from it) and the changing part (those placeholders in their order of the
//    template). The model gets the fixed part, then the changing part; claude.js sends `system` as two blocks with
//    `cache_control: { type: 'ephemeral' }` on the first; every other model gets the joined string. The fixed part
//    of two calls is byte-identical while memory and inventory differ. Off: the prompt of v0.1.4.12.
// M3 the writes: price_table gets `cache_write` 0.125 for gpt-6-luna; gpt.js reports `cache_write_tokens` as the
//    prompt tokens that were not cached when the prompt is 1,024 tokens or longer.
// No key and no network: the modules are loaded from an empty folder (src/utils/keys.js reads ./keys.json at load),
// the models are fakes. A failing test is a finding.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeItem } from '../helpers/xt_bot.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const require = createRequire(import.meta.url);
const minecraftData = require('minecraft-data');

const TEMPLATE = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8')).conversing;
const MEMORY_A = 'The owner likes iron and keeps his tools in the cellar.';
const MEMORY_B = 'The mine "deep" is at (20, 64, -14).';
const TURNS = [{ role: 'user', content: 'MartyByrde2: where are you?' }];

let M;
let workDir;
let originalCwd;
before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir);
    const cap = captureConsole();
    try {
        M = {
            mcdata: await loadSrc('src/utils/mcdata.js'),
            settings: await loadSrc('src/agent/settings.js'),
            commands: await loadSrc('src/agent/commands/index.js'),
            prompter: await loadSrc('src/models/prompter.js'),
            claude: await loadSrc('src/models/claude.js'),
            gpt: await loadSrc('src/models/gpt.js'),
            usage: await loadSrc('src/agent/cost/usage_context.js'),
            prices: await loadSrc('src/agent/cost/price_table.js'),
        };
    } finally {
        cap.restore();
        process.chdir(originalCwd);
    }
    M.mcdata.__setMcdataForTests(minecraftData('1.21.8'));
});
after(() => {
    M.mcdata.__setMcdataForTests?.(null);
    removeTmpDir(workDir);
});

/** A fake agent of the prompter: the memory and the bag of the call; a bot that !stats and !inventory can read. */
function fakeAgent(memory, items) {
    const bot = {
        username: 'claude',
        entity: { position: { x: 1.5, y: 64, z: -3.25 } },
        game: { dimension: 'overworld', gameMode: 'survival' },
        health: 20, food: 18, rainState: 0, thunderState: 0, time: { timeOfDay: 6000 }, entities: {}, players: {},
        world: { getBiome: () => 1 },
        modes: { getMiniDocs: () => 'MODES', isOn: () => false },
        inventory: { items: () => items.map((i) => ({ ...i })), slots: Object.assign(new Array(46).fill(null), Object.fromEntries(items.map((i) => [i.slot, { ...i }]))) },
        heldItem: null,
        findBlocks: () => [],
        findBlock: () => null,
        nearestEntity: () => null,
        blockAt: () => null,
    };
    return {
        name: 'claude',
        bot,
        blocked_actions: [],
        history: { memory },
        self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
        actions: { currentActionLabel: '' },
        task: { task_id: null },
        npc: {},
        isIdle: () => true,
        knowledgeBlock: () => '',
    };
}

/** The system message the chat model gets for one conversing call. */
async function systemOf(memory, items, promptCache, chatModel = null) {
    M.settings.setSettings({ language: 'en', blocked_actions: [], prompt_cache: promptCache, only_chat_with: [] });
    let seen;
    const model = chatModel ?? {
        async sendRequest(turns, systemMessage) {
            seen = systemMessage;
            return 'I am at home.';
        },
    };
    const prompter = Object.create(M.prompter.Prompter.prototype);
    Object.assign(prompter, {
        agent: fakeAgent(memory, items),
        profile: { name: 'claude', conversing: TEMPLATE, coding: 'Write code.\nConversation:' },
        cooldown: 0, last_prompt_time: 0, awaiting_coding: false,
        convo_examples: { createExampleMessage: async () => 'Examples of how to respond:\nExample 1:\nUser input: hi\nYour output:\nHello!' },
        coding_examples: null,
        chat_model: model, code_model: model,
    });
    const cap = captureConsole();
    try {
        await prompter.promptConvo(TURNS);
    } finally {
        cap.restore();
    }
    return { system: seen, agent: prompter.agent };
}

/** The two parts of what the model got: an array or object of two parts, or a string split after the command docs. */
function partsOf(system, agent) {
    if (Array.isArray(system)) return { fixed: String(system[0]?.text ?? system[0]), changing: String(system[1]?.text ?? system[1]), shape: 'parts' };
    if (system && typeof system === 'object') return { fixed: String(system.fixed), changing: String(system.changing), shape: 'parts' };
    const docs = M.commands.getCommandDocs(agent);
    const at = String(system).indexOf(docs);
    return { fixed: at < 0 ? '' : system.slice(0, at + docs.length), changing: at < 0 ? String(system) : system.slice(at + docs.length), shape: 'string' };
}

const BAG_A = () => [makeItem('bread', 4, 36)];
const BAG_B = () => [makeItem('diamond', 7, 36), makeItem('iron_pickaxe', 1, 37)];

describe('SPEC 4.7 M2: the two-part prompt with prompt_cache on', () => {
    test('the fixed part of two calls is byte-identical while memory and inventory differ', async () => {
        const a = await systemOf(MEMORY_A, BAG_A(), true);
        const b = await systemOf(MEMORY_B, BAG_B(), true);
        const pa = partsOf(a.system, a.agent);
        const pb = partsOf(b.system, b.agent);
        assert.ok(pa.fixed.length > 1000, `a fixed part with the command docs: ${pa.fixed.length} characters`);
        assert.equal(pa.fixed, pb.fixed, 'byte-identical');
        assert.ok(pa.changing.includes(MEMORY_A) && pb.changing.includes(MEMORY_B), 'the memory is in the changing part');
        assert.ok(pa.changing.includes('bread') && pb.changing.includes('diamond'), 'the inventory is in the changing part');
    });

    test('the fixed part: $NAME and $SELF_PROMPT filled, the command docs, no placeholder and nothing that changes', async () => {
        const a = await systemOf(MEMORY_A, BAG_A(), true);
        const { fixed } = partsOf(a.system, a.agent);
        assert.ok(fixed.startsWith('You are an AI Minecraft bot named claude'), fixed.slice(0, 80));
        assert.ok(fixed.includes('*COMMAND DOCS'), 'the command docs end the fixed part');
        for (const p of ['$NAME', '$SELF_PROMPT', '$MEMORY', '$STATS', '$INVENTORY', '$KNOWLEDGE', '$EXAMPLES', '$COMMAND_DOCS'])
            assert.ok(!fixed.includes(p), `no ${p} in the fixed part`);
        assert.ok(!fixed.includes(MEMORY_A) && !fixed.includes('bread'), 'no memory, no inventory');
    });

    test('the changing part keeps the order of the template: memory, stats, inventory, examples', async () => {
        const a = await systemOf(MEMORY_A, BAG_A(), true);
        const { changing } = partsOf(a.system, a.agent);
        const at = (s) => changing.indexOf(s);
        assert.ok(at(MEMORY_A) >= 0 && at('STATS') > at(MEMORY_A), changing.slice(0, 300));
        assert.ok(at('INVENTORY') > at('STATS'), 'the inventory after the stats');
        assert.ok(at('Examples of how to respond') > at('INVENTORY'), 'the examples last');
    });

    test('claude.js: system as two blocks, the cache mark on the first (the prompter with a Claude model)', async () => {
        const a = await systemOf(MEMORY_A, BAG_A(), true);
        const { fixed, changing } = partsOf(a.system, a.agent);
        const requests = [];
        const adapter = Object.create(M.claude.Claude.prototype);
        Object.assign(adapter, { model_name: 'claude-haiku-4-5-20251001', params: {} });
        adapter.anthropic = { messages: { create: async (r) => { requests.push(r); return { content: [{ type: 'text', text: 'Hi!' }], usage: { input_tokens: 10, output_tokens: 2 } }; } } };
        await systemOf(MEMORY_A, BAG_A(), true, adapter);
        await systemOf(MEMORY_B, BAG_B(), true, adapter);
        const system = requests[0]?.system;
        assert.ok(Array.isArray(system), `system is a list of blocks: ${typeof system}`);
        assert.equal(system.length, 2);
        assert.deepEqual(system[0].cache_control, { type: 'ephemeral' });
        assert.equal(system[1].cache_control, undefined, 'the changing part has no mark');
        assert.equal(system[0].text.trimEnd(), fixed.trimEnd(), 'the first block is the fixed part');
        assert.equal(system[1].text.trim(), changing.trim(), 'the second block is the changing part');
        assert.equal(requests[1].system[0].text, system[0].text, 'the marked block of two calls is byte-identical');
        assert.ok(requests[1].system[1].text.includes(MEMORY_B), 'the second call\'s memory in its second block');
    });

    test('claude.js with prompt_cache off: system is one string, no mark', async () => {
        const requests = [];
        const adapter = Object.create(M.claude.Claude.prototype);
        Object.assign(adapter, { model_name: 'claude-haiku-4-5-20251001', params: {} });
        adapter.anthropic = { messages: { create: async (r) => { requests.push(r); return { content: [{ type: 'text', text: 'Hi!' }], usage: { input_tokens: 10, output_tokens: 2 } }; } } };
        await systemOf(MEMORY_A, BAG_A(), false, adapter);
        assert.equal(typeof requests[0]?.system, 'string');
    });

    test('every other model gets the joined string: the fixed part, then the changing part', async () => {
        const a = await systemOf(MEMORY_A, BAG_A(), true);
        const { fixed, changing } = partsOf(a.system, a.agent);
        const requests = [];
        const client = { responses: { create: async (r) => { requests.push(r); return { output_text: 'Hi!' }; } } };
        const gpt = new M.gpt.GPT('gpt-6-luna', null, {}, { client });
        const cap = captureConsole();
        try {
            await gpt.sendRequest(TURNS, a.system);
        } finally {
            cap.restore();
        }
        const instructions = requests[0]?.instructions;
        assert.equal(typeof instructions, 'string');
        assert.ok(instructions.startsWith(fixed), 'the fixed part first');
        assert.ok(instructions.includes(changing.trim()), 'then the changing part');
    });
});

describe('SPEC 4.7 M2: with prompt_cache off the prompt of v0.1.4.12', () => {
    test('one string, the memory before the command docs as in the template', async () => {
        const a = await systemOf(MEMORY_A, BAG_A(), false);
        assert.equal(typeof a.system, 'string');
        assert.ok(a.system.indexOf(MEMORY_A) >= 0 && a.system.indexOf(MEMORY_A) < a.system.indexOf('*COMMAND DOCS'), 'the order of the template');
    });
});

describe('SPEC 4.7 M3: the writes', () => {
    let reports;
    beforeEach(() => {
        reports = [];
        M.usage.setUsageSink((r) => reports.push(r));
    });
    afterEach(() => M.usage.setUsageSink(null));

    function gptWith(usage) {
        const client = {
            responses: { create: async () => ({ output_text: 'Hi!', usage }) },
            chat: { completions: { create: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Hi!' } }], usage }) } },
        };
        return new M.gpt.GPT('gpt-6-luna', null, {}, { client });
    }

    async function send(gpt) {
        const cap = captureConsole();
        try {
            await gpt.sendRequest(TURNS, 'system prompt');
        } finally {
            cap.restore();
        }
    }

    test('the price of the writes of gpt-6-luna: 0.125', () => {
        assert.equal(M.prices.priceFor('gpt-6-luna').cache_write, 0.125);
    });

    test('a prompt of 1,500 tokens with 1,000 cached: 500 written', async () => {
        await send(gptWith({ input_tokens: 1500, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 20 }));
        assert.equal(reports.length, 1);
        assert.equal(reports[0].cache_write_tokens, 500);
        assert.equal(reports[0].cache_read_tokens, 1000);
    });

    test('a prompt of 1,024 tokens, none cached: 1,024 written', async () => {
        await send(gptWith({ input_tokens: 1024, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20 }));
        assert.equal(reports[0].cache_write_tokens, 1024);
    });

    test('a prompt under 1,024 tokens: no writes', async () => {
        await send(gptWith({ input_tokens: 1023, input_tokens_details: { cached_tokens: 0 }, output_tokens: 20 }));
        assert.equal(reports[0].cache_write_tokens ?? 0, 0);
    });

    test('the chat completions API: 2,000 prompt tokens with 128 cached, 1,872 written', async () => {
        const client = { chat: { completions: { create: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'Hi!' } }], usage: { prompt_tokens: 2000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 128 } } }) } } };
        const gpt = new M.gpt.GPT('gpt-6-luna', 'https://example.invalid/v1', {}, { client });
        await send(gpt);
        assert.equal(reports.length, 1);
        assert.equal(reports[0].cache_write_tokens, 1872);
    });
});
