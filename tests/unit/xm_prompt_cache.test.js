// v0.1.4.13 part M2 (SPEC 4.7): prompt_cache. With the switch on, the conversing prompt is built in two parts: the
// fixed part (the template up to and including $COMMAND_DOCS, $NAME and $SELF_PROMPT filled, $MEMORY, $STATS,
// $INVENTORY, $KNOWLEDGE, $EXAMPLES removed) and the changing part (those placeholders in the order of the template).
// The system message is the fixed part, then the changing part; claude.js sends system as two blocks with
// cache_control ephemeral on the first; every other model gets the joined string. The role line and the note stay in
// the changing part. The fixed part of two calls is byte-identical while memory and inventory differ.
//
// Prompter.promptConvo runs on an object made with Object.create(Prompter.prototype): no model is made and no key is
// read. $STATS is filled by stubs of the three stats commands; $INVENTORY by the real !inventory of a fake bot.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules } from '../helpers/module_rules.js';

const DEFAULT = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
const CLAUDE = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
const GPT = JSON.parse(fs.readFileSync(repoPath('profiles/gpt.json'), 'utf8'));
const CHANGING = ['$MEMORY', '$STATS', '$INVENTORY', '$KNOWLEDGE', '$EXAMPLES'];

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
            parts: await loadSrc('src/models/prompt_parts.js'),
            claude: await loadSrc('src/models/claude.js'),
            commands: await loadSrc('src/agent/commands/index.js'),
            examples: await loadSrc('src/utils/examples.js'),
        };
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
});
after(() => M.settingsModule.setSettings({}));

describe('module', () => {
    test('prompt_parts.js imports nothing', () => {
        assertImportRules('src/models/prompt_parts.js', { allowBuiltins: [], allowedRelative: [] });
    });
});

describe('splitTemplate', () => {
    for (const [label, template] of [['_default.json', DEFAULT.conversing], ['claude.json', CLAUDE.conversing], ['gpt.json', GPT.conversing]]) {
        test(`${label}: the fixed part ends with $COMMAND_DOCS and holds none of the changing placeholders`, () => {
            const { fixed, changing } = M.parts.splitTemplate(template);
            assert.ok(fixed.endsWith('$COMMAND_DOCS\n'), JSON.stringify(fixed.slice(-40)));
            assert.ok(fixed.includes('$NAME'));
            assert.ok(fixed.includes('$SELF_PROMPT'));
            for (const p of CHANGING) assert.ok(!fixed.includes(p), `${p} is not in the fixed part`);
            assert.ok(!changing.includes('$COMMAND_DOCS'));
            const order = CHANGING.filter((p) => template.includes(p));
            const at = order.map((p) => changing.indexOf(p));
            assert.ok(at.every((i) => i >= 0), 'every changing placeholder of the template is in the changing part');
            assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the order of the template');
            assert.ok(changing.startsWith("Summarized memory:'$MEMORY'"), 'a line keeps its label');
            assert.ok(changing.endsWith('Conversation Begin:'));
        });
    }

    test('a line with both kinds: only the changing placeholder moves ($KNOWLEDGE$COMMAND_DOCS of the default profile)', () => {
        const { fixed, changing } = M.parts.splitTemplate('Hi $NAME.\nA:$MEMORY\n$KNOWLEDGE$COMMAND_DOCS\n$EXAMPLES\nEnd');
        assert.equal(fixed, 'Hi $NAME.\n$COMMAND_DOCS\n');
        assert.equal(changing, 'A:$MEMORY\n$KNOWLEDGE\n$EXAMPLES\nEnd');
    });

    test('a template without $COMMAND_DOCS is not split', () => {
        assert.equal(M.parts.splitTemplate('You are $NAME. $MEMORY'), null);
        assert.equal(M.parts.splitTemplate(DEFAULT.coding), null);
        assert.equal(M.parts.splitTemplate(undefined), null);
    });
});

describe('systemBlocks and joinParts', () => {
    test('two text blocks, the cache mark on the first only', () => {
        assert.deepEqual(M.parts.systemBlocks(['FIXED', 'CHANGING']), [
            { type: 'text', text: 'FIXED', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'CHANGING' },
        ]);
    });

    test('an empty part is left out; the changing part never carries the mark', () => {
        assert.deepEqual(M.parts.systemBlocks(['', 'CHANGING']), [{ type: 'text', text: 'CHANGING' }]);
        assert.deepEqual(M.parts.systemBlocks(['FIXED', '']), [{ type: 'text', text: 'FIXED', cache_control: { type: 'ephemeral' } }]);
        assert.deepEqual(M.parts.systemBlocks(null), []);
    });

    test('joinParts: the fixed part, then the changing part', () => {
        assert.equal(M.parts.joinParts('a\n', 'b'), 'a\nb');
    });

    test('withLeadingLines: a missing line goes in front, a present one stays where it is', () => {
        assert.equal(M.parts.withLeadingLines('x\ny', ['R', '', 'N']), 'R\nN\nx\ny');
        assert.equal(M.parts.withLeadingLines('R\nN\nx', ['R', 'N']), 'R\nN\nx');
    });
});

describe('claude.js sends the parts as two system blocks', () => {
    function fakeClaude() {
        const requests = [];
        const adapter = Object.create(M.claude.Claude.prototype);
        adapter.model_name = 'claude-haiku-4-5-20251001';
        adapter.params = {};
        adapter.anthropic = { messages: { async create(request) {
            requests.push(request);
            return { content: [{ type: 'text', text: 'Hi! !stats' }], usage: { input_tokens: 1, output_tokens: 1 } };
        } } };
        return { adapter, requests };
    }

    test('[fixed, changing]: system is two blocks, cache_control ephemeral on the first', async () => {
        const { adapter, requests } = fakeClaude();
        const cap = captureConsole();
        try {
            assert.equal(await adapter.sendRequest([{ role: 'user', content: 'hi' }], ['FIXED PART', 'CHANGING PART']), 'Hi! !stats');
        } finally {
            cap.restore();
        }
        assert.deepEqual(requests[0].system, [
            { type: 'text', text: 'FIXED PART', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'CHANGING PART' },
        ]);
    });

    test('a string is sent as before, and the adapter says it takes the parts', async () => {
        const { adapter, requests } = fakeClaude();
        const cap = captureConsole();
        try {
            await adapter.sendRequest([{ role: 'user', content: 'hi' }], 'ONE STRING');
        } finally {
            cap.restore();
        }
        assert.equal(requests[0].system, 'ONE STRING');
        assert.equal(adapter.acceptsSystemParts, true);
    });
});

describe('promptConvo with prompt_cache', () => {
    const STATS = 'STATS\n- Position: x: 12.50, y: 64.00, z: -3.30\n- Health: 20 / 20';
    const STUBBED = ['!stats', '!entities', '!nearbyBlocks'];
    let saved;
    before(() => {
        saved = STUBBED.map((name) => [name, M.commands.getCommand(name).perform]);
        for (const name of STUBBED) M.commands.getCommand(name).perform = async () => (name === '!stats' ? STATS : `${name.slice(1).toUpperCase()}: none`);
    });
    after(() => {
        for (const [name, perform] of saved) M.commands.getCommand(name).perform = perform;
    });

    // The bot of a call: its memory and the items in its bag (the slots of mineflayer, 9 to 44 the bag).
    function agentOf({ memory, items, note = null }) {
        const slots = new Array(46).fill(null);
        items.forEach(([name, count], i) => { slots[9 + i] = { name, count, type: i + 1 }; });
        return {
            name: 'claude', blocked_actions: ['!checkBlueprint'], history: { memory }, task: { task_id: null }, npc: {},
            self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
            actions: { currentActionLabel: '' },
            bot: { inventory: { slots }, game: { gameMode: 'survival' } },
            ...(note ? { supervisor_note: note } : {}),
        };
    }

    // What promptConvo hands the model: { system } of one call.
    async function call(conversing, agent, { settings = {}, model = {} } = {}) {
        M.settingsModule.setSettings({ language: 'en', num_examples: 2, log_all_prompts: false, blocked_actions: [], ...settings });
        let sent = null;
        const prompter = Object.create(M.prompter.Prompter.prototype);
        const examples = new M.examples.Examples(null, 2);
        const cap = captureConsole();
        try {
            await examples.load(DEFAULT.conversation_examples);
            Object.assign(prompter, {
                agent, cooldown: 0, last_prompt_time: 0, awaiting_coding: false, convo_examples: examples, profile: { conversing },
                chat_model: { ...model, async sendRequest(turns, system) { sent = system; return ''; } },
            });
            await prompter.promptConvo([{ role: 'user', content: 'MartyByrde2: hi' }]);
        } finally {
            cap.restore();
        }
        return sent;
    }

    const PARTS = { acceptsSystemParts: true };
    const ROLE = 'You are the miner.';
    const NOTE = { text: 'the chest at (15, -59, -99) has bread', until: Date.now() + 600000 };

    test('the fixed part of two calls is byte-identical while memory and inventory differ', async () => {
        const one = await call(CLAUDE.conversing, agentOf({ memory: 'We built a house.', items: [['bread', 6], ['torch', 9]] }), { settings: { prompt_cache: true }, model: PARTS });
        const two = await call(CLAUDE.conversing, agentOf({ memory: 'We found diamonds at level -59.', items: [['diamond', 7], ['iron_pickaxe', 1]] }), { settings: { prompt_cache: true }, model: PARTS });
        assert.ok(Array.isArray(one) && one.length === 2 && Array.isArray(two) && two.length === 2, 'the model that takes the parts gets [fixed, changing]');
        assert.equal(one[0], two[0], 'the fixed part is the same, byte for byte');
        assert.ok(Buffer.from(one[0]).equals(Buffer.from(two[0])));
        assert.notEqual(one[1], two[1]);
        assert.ok(one[1].includes("Summarized memory:'We built a house.'") && one[1].includes('- bread: 6'));
        assert.ok(two[1].includes("Summarized memory:'We found diamonds at level -59.'") && two[1].includes('- diamond: 7'));
        for (const text of ['We built a house.', 'bread: 6', 'INVENTORY', 'STATS', 'Conversation Begin:', 'Examples of how to respond']) {
            assert.ok(!one[0].includes(text), `"${text}" is not in the fixed part`);
        }
        assert.ok(one[0].startsWith('You are an AI Minecraft bot named claude'), '$NAME is filled');
        assert.ok(one[0].includes('*COMMAND DOCS'), 'the command list is in the fixed part');
        assert.ok(!/\$[A-Z_]+/.test(one[0]), 'no placeholder is left in the fixed part');
    });

    test('the role line and the note of the supervisor are in the changing part, not in the fixed part', async () => {
        const sent = await call(CLAUDE.conversing, agentOf({ memory: 'm', items: [], note: NOTE }), { settings: { prompt_cache: true, bot_role: ROLE }, model: PARTS });
        const [fixed, changing] = sent;
        assert.ok(!fixed.includes(ROLE) && !fixed.includes('Supervisor:'));
        const lines = changing.split('\n');
        assert.equal(lines[0], `${ROLE} A question to all of us gets one line from you.`);
        assert.equal(lines[1], `Supervisor: ${NOTE.text}`);
        assert.ok(lines[2].startsWith('Summarized memory:'));
    });

    test('a template without "Summarized memory:" still gets the role line and the note in the changing part', async () => {
        const template = 'You are $NAME.\nA rule about a place names a place you saved.\n$COMMAND_DOCS\n$INVENTORY\nConversation Begin:';
        const [fixed, changing] = await call(template, agentOf({ memory: 'm', items: [], note: NOTE }), { settings: { prompt_cache: true, bot_role: ROLE }, model: PARTS });
        assert.ok(!fixed.includes(ROLE));
        assert.ok(changing.startsWith(`${ROLE} A question to all of us gets one line from you.\nSupervisor: ${NOTE.text}\n`), JSON.stringify(changing.slice(0, 160)));
        assert.ok(changing.includes('INVENTORY'));
    });

    test('a model without the parts (every other model) gets the joined string: the fixed part, then the changing part', async () => {
        const agent = agentOf({ memory: 'We built a house.', items: [['bread', 6]] });
        const parts = await call(CLAUDE.conversing, agent, { settings: { prompt_cache: true }, model: PARTS });
        const joined = await call(CLAUDE.conversing, agent, { settings: { prompt_cache: true } });
        assert.equal(typeof joined, 'string');
        assert.equal(joined, parts[0] + parts[1]);
        assert.ok(joined.indexOf('*COMMAND DOCS') < joined.indexOf('Summarized memory:'), 'the command list comes first');
    });

    test('the saved skills, the rules and what the bot knows go into the changing part', async () => {
        const agent = agentOf({ memory: 'm', items: [] });
        agent.rule_store = { list: () => [{ id: 1, text: 'Never attack the cows.' }] };
        agent.knowledgeBlock = () => 'WHAT YOU KNOW (from memory, no need to check):\nChest (1, 2, 3): bread 5.';
        const [fixed, changing] = await call(CLAUDE.conversing, agent, { settings: { prompt_cache: true, knowledge_in_prompt: true }, model: PARTS });
        assert.ok(!fixed.includes('Never attack the cows.') && changing.includes('Never attack the cows.'));
        assert.ok(!fixed.includes('WHAT YOU KNOW') && changing.includes('WHAT YOU KNOW'));
        assert.ok(changing.indexOf('WHAT YOU KNOW') < changing.lastIndexOf('Conversation Begin:'));
    });

    test('off: one string, as before, with the memory before the command list', async () => {
        const agent = agentOf({ memory: 'We built a house.', items: [['bread', 6]] });
        const off = await call(CLAUDE.conversing, agent, { settings: { prompt_cache: false }, model: PARTS });
        assert.equal(typeof off, 'string', 'even a model that takes the parts gets the string');
        assert.ok(off.indexOf('Summarized memory:') < off.indexOf('*COMMAND DOCS'));
        assert.equal(off, await call(CLAUDE.conversing, agent, { settings: {}, model: PARTS }), 'the same prompt as without the setting');
    });
});
