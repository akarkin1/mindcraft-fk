// Spec v0.1.4.12, 4.6 (part D, engineer E6), D3 with DECISIONS F2: the role line of bot_role in the conversing prompt,
// without a placeholder.
//   - both profiles keep their text (no placeholder);
//   - through the real Prompter (promptConvo with a fake model) and profiles/claude.json: an empty role leaves the prompt
//     byte for byte as without the switch; a role puts `${bot_role} A question to all of us gets one line from you.` on
//     its own line right after the two lines of W6; the size of the prompt with a role of 60 characters is printed;
//   - F2b: without the W6 line (the default conversing prompt, as the scenarios run it) the line goes right before
//     "Summarized memory:"; without both, nowhere.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import '../helpers/st_glue_env.js'; // registers the mcdata hook (once per process)

const W6 = [
    'Answer a question with words, not with a command, and never stop a running command for a question.',
    'A rule about a place names a place you saved; say "this is the aviary" first when it is not saved.',
];
const ROLE_60 = 'You are the farmer. gpt is the miner. You keep the wheat in.';
const LINE_60 = `${ROLE_60} A question to all of us gets one line from you.`;

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
            settingsModule: await loadSrc('src/agent/settings.js'),
            prompter: await loadSrc('src/models/prompter.js'),
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

const CLAUDE = () => JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));

// The system message of one promptConvo with the given profile and bot_role.
async function conversingPrompt(profile, role) {
    M.settingsModule.setSettings({ language: 'en', base_profile: 'assistant', blocked_actions: [], bot_role: role, knowledge_in_prompt: false,
        skill_learning: false, skill_command: false });
    const agent = {
        name: profile.name, blocked_actions: [], history: { memory: '' },
        self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
        actions: { currentActionLabel: '' }, task: { task_id: null }, npc: {},
    };
    const cap = captureConsole();
    try {
        const prompter = new M.prompter.Prompter(agent, profile);
        agent.prompter = prompter;
        // the state of the game is not part of this test
        prompter.profile.conversing = prompter.profile.conversing.replaceAll('$STATS', 'STATS').replaceAll('$INVENTORY', 'INVENTORY');
        let last = null;
        const model = { async sendRequest(turns, systemMessage) { last = String(systemMessage ?? ''); return ''; },
            sendVisionRequest: () => Promise.reject(new Error('no vision')), embed: () => Promise.reject(new Error('no embeddings')) };
        Object.assign(prompter, { chat_model: model, code_model: model, vision_model: model, embedding_model: model, cooldown: 0 });
        await prompter.initExamples();
        await prompter.promptConvo([]);
        const unknown = cap.of('warn').map((r) => r.text).filter((t) => /Unknown prompt placeholders/.test(t));
        return { prompt: last, unknown };
    } finally {
        cap.restore();
    }
}

describe('D3: no placeholder in the profiles (DECISIONS F2)', () => {
    for (const file of ['profiles/claude.json', 'profiles/gpt.json', 'profiles/defaults/_default.json']) {
        test(`${file}: no $BOT_ROLE`, () => {
            assert.ok(!JSON.parse(fs.readFileSync(repoPath(file), 'utf8')).conversing.includes('$BOT_ROLE'));
        });
    }
});

describe('D3: through the prompter, profiles/claude.json', () => {
    test('an empty role: byte for byte the prompt without bot_role', async (t) => {
        const empty = await conversingPrompt(CLAUDE(), '');
        const unset = await conversingPrompt(CLAUDE(), undefined);
        assert.equal(empty.prompt, unset.prompt);
        assert.ok(!empty.prompt.includes('A question to all of us'));
        assert.ok(empty.prompt.includes(`${W6[0]}\n${W6[1]}\nSummarized memory:`), 'as in v0.1.4.11');
        assert.deepEqual(empty.unknown, []);
        t.diagnostic(`v0.1.4.12, claude.json, no role: ${empty.prompt.length} characters`);
    });

    test('a role of 60 characters: the line word for word right after the two lines of W6; the size printed', async (t) => {
        assert.equal(ROLE_60.length, 60);
        const empty = await conversingPrompt(CLAUDE(), '');
        const role = await conversingPrompt(CLAUDE(), ROLE_60);
        assert.ok(role.prompt.includes(`${W6[0]}\n${W6[1]}\n${LINE_60}\nSummarized memory:`), role.prompt.slice(0, 1400));
        assert.equal(role.prompt.split(LINE_60).length, 2, 'once');
        assert.deepEqual(role.unknown, []);
        assert.equal(role.prompt.length - empty.prompt.length, LINE_60.length + 1);
        t.diagnostic(`v0.1.4.12, claude.json, a role of 60 characters: ${role.prompt.length} characters (+${role.prompt.length - empty.prompt.length})`);
    });

    test('blanks only: no line', async () => {
        const blank = await conversingPrompt(CLAUDE(), '   ');
        assert.ok(!blank.prompt.includes('A question to all of us'));
    });
});

describe('D3 (F2b): a conversing prompt without the W6 line', () => {
    const plain = () => ({ name: 'w_farmer', model: CLAUDE().model }); // the default conversing prompt, as the scenarios run it

    test('the default profile: the role line on its own line right before "Summarized memory:", once', async () => {
        const { prompt, unknown } = await conversingPrompt(plain(), ROLE_60);
        assert.ok(prompt.includes(`take a deep breath and have fun :)\n${LINE_60}\nSummarized memory:`), prompt.slice(0, 1200));
        assert.equal(prompt.split(LINE_60).length, 2);
        assert.deepEqual(unknown, []);
    });

    test('the default profile with an empty role: byte for byte the prompt without bot_role', async () => {
        const empty = await conversingPrompt(plain(), '');
        const unset = await conversingPrompt(plain(), undefined);
        assert.equal(empty.prompt, unset.prompt);
        assert.ok(empty.prompt.includes('take a deep breath and have fun :)\nSummarized memory:'));
    });

    test('neither the W6 line nor "Summarized memory:": no role line, the prompt as without a role', async () => {
        const own = () => ({ ...plain(), conversing: 'You are $NAME, a bot.\n$STATS\n$INVENTORY\n$COMMAND_DOCS\n$EXAMPLES\nConversation Begin:' });
        const role = await conversingPrompt(own(), ROLE_60);
        const none = await conversingPrompt(own(), '');
        assert.ok(!role.prompt.includes('A question to all of us'));
        assert.equal(role.prompt, none.prompt);
    });
});
