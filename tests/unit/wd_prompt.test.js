// Spec v0.1.4.12, 4.6 (part D, engineer E6), D3: the role line of bot_role in the conversing prompt.
//   - both profiles carry the placeholder $BOT_ROLE on its own line right after the two lines of W6 of v0.1.4.11;
//   - through the real Prompter (promptConvo with a fake model) and profiles/claude.json: an empty role leaves no line
//     and no placeholder (the prompt as without the placeholder); a role puts `${bot_role} A question to all of us gets
//     one line from you.` right after the two lines of W6; the size of the prompt with a role of 60 characters is printed;
//   - a profile without the placeholder (the default profile, as the scenarios run it): the line before the memory.
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

describe('D3: the placeholder in both profiles', () => {
    for (const file of ['profiles/claude.json', 'profiles/gpt.json']) {
        test(`${file}: $BOT_ROLE once, on its own line right after the two lines of W6`, () => {
            const conversing = JSON.parse(fs.readFileSync(repoPath(file), 'utf8')).conversing;
            assert.ok(conversing.includes(`${W6[0]}\n${W6[1]}\n$BOT_ROLE\nSummarized memory:`), conversing);
            assert.equal(conversing.split('$BOT_ROLE').length, 2);
        });
    }

    test('the default profile has no placeholder (the prompter puts the line before the memory)', () => {
        const fallback = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
        assert.ok(!fallback.conversing.includes('$BOT_ROLE'));
    });
});

describe('D3: through the prompter, profiles/claude.json', () => {
    test('an empty role: no role line, no placeholder, no warning; the prompt is the one of the profile without the placeholder', async (t) => {
        const empty = await conversingPrompt(CLAUDE(), '');
        assert.ok(!empty.prompt.includes('$BOT_ROLE'));
        assert.ok(!empty.prompt.includes('A question to all of us'));
        assert.deepEqual(empty.unknown, []);
        assert.ok(empty.prompt.includes(`${W6[1]}\nSummarized memory:`), 'the memory right after the two lines, as in v0.1.4.11');
        const without = CLAUDE();
        without.conversing = without.conversing.replace('$BOT_ROLE\n', '');
        const old = await conversingPrompt(without, '');
        assert.equal(empty.prompt, old.prompt);
        t.diagnostic(`v0.1.4.12, claude.json, no role: ${empty.prompt.length} characters`);
    });

    test('a role of 60 characters: the line word for word right after the two lines of W6; the size printed', async (t) => {
        assert.equal(ROLE_60.length, 60);
        const empty = await conversingPrompt(CLAUDE(), '');
        const role = await conversingPrompt(CLAUDE(), ROLE_60);
        assert.ok(role.prompt.includes(`${W6[1]}\n${LINE_60}\nSummarized memory:`), role.prompt.slice(0, 1400));
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

describe('D3: a profile without the placeholder (the default conversing prompt)', () => {
    const plain = () => ({ name: 'w_farmer', model: CLAUDE().model });

    test('a role: the line on its own line before "Summarized memory:", once', async () => {
        const { prompt } = await conversingPrompt(plain(), ROLE_60);
        assert.ok(prompt.includes(`take a deep breath and have fun :)\n${LINE_60}\nSummarized memory:`), prompt.slice(0, 1200));
        assert.equal(prompt.split(LINE_60).length, 2);
    });

    test('no role: the prompt as before', async () => {
        const { prompt } = await conversingPrompt(plain(), '');
        assert.ok(prompt.includes('take a deep breath and have fun :)\nSummarized memory:'));
        assert.ok(!prompt.includes('A question to all of us'));
    });
});
