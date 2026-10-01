// Release v0.1.4.10, spec I7 T4 (part T): the play test `npm run test:play` (tests/play). Its pure logic
// (tests/play/play_logic.js) and the refusal of the runner without the key of the model. The play itself needs the
// test server and runs only by hand: here with --fake once, on the owner's machine with his model. No test here
// starts a server or calls a model.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const LOGIC = 'tests/play/play_logic.js';
const P = await loadSrc(LOGIC);

describe('the module and the script of package.json', () => {
    test('the logic imports nothing and runs nothing when imported', () => {
        assertImportRules(LOGIC, { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport(LOGIC);
    });

    test('test:play runs tests/play/run.js; npm test runs tests/run.js, which collects tests/unit only', () => {
        const pkg = JSON.parse(fs.readFileSync(repoPath('package.json'), 'utf8'));
        assert.equal(pkg.scripts['test:play'], 'node tests/play/run.js');
        assert.equal(pkg.scripts.test, 'node tests/run.js');
        assert.match(fs.readFileSync(repoPath('tests/run.js'), 'utf8'), /const unitDir = path\.join\(testsDir, 'unit'\);/);
    });
});

describe('parseArgs', () => {
    test('the defaults and the flags', () => {
        assert.deepEqual(P.parseArgs([]), { ok: true, fake: false, profile: 'profiles/claude.json', verbose: false });
        assert.deepEqual(P.parseArgs(['--fake', '--profile', 'profiles/gpt.json', '--verbose']), { ok: true, fake: true, profile: 'profiles/gpt.json', verbose: true });
        assert.deepEqual(P.parseArgs(['--profile']), { ok: false, reason: '--profile needs a file' });
        assert.deepEqual(P.parseArgs(['--real']), { ok: false, reason: 'unknown argument --real' });
        assert.equal(P.parseArgs(['-h']).help, true);
    });
});

describe('the api of the model and its key', () => {
    test('apiOf as selectAPI chooses it', () => {
        assert.equal(P.apiOf({ model: 'claude-haiku-4-5-20251001' }), 'anthropic');
        assert.equal(P.apiOf({ model: 'gpt-6-luna' }), 'openai');
        assert.equal(P.apiOf({ model: 'openrouter/anthropic/claude-x' }), 'openrouter');
        assert.equal(P.apiOf({ model: { api: 'google', model: 'gemini-2.5' } }), 'google');
        assert.equal(P.apiOf({ model: 'ollama/llama3' }), 'ollama');
        assert.equal(P.apiOf({ model: 'local/llama3' }), 'ollama');
        assert.equal(P.apiOf({ model: 'grok-4' }), 'xai');
        assert.equal(P.apiOf({ model: 'something' }), null);
        assert.equal(P.apiOf({}), null);
    });

    test('keyCheck: the variable must be set and not empty; a local model needs none', () => {
        const claude = { model: 'claude-haiku-4-5-20251001' };
        assert.deepEqual(P.keyCheck(claude, {}), { ok: false, reason: 'ANTHROPIC_API_KEY is not set in the environment: the chat model claude-haiku-4-5-20251001 (anthropic) needs it' });
        assert.equal(P.keyCheck(claude, { ANTHROPIC_API_KEY: '  ' }).ok, false);
        assert.deepEqual(P.keyCheck(claude, { ANTHROPIC_API_KEY: 'x' }), { ok: true, key: 'ANTHROPIC_API_KEY', api: 'anthropic' });
        assert.equal(P.keyCheck({ model: 'gpt-6-luna' }, { ANTHROPIC_API_KEY: 'x' }).ok, false);
        assert.deepEqual(P.keyCheck({ model: 'gpt-6-luna' }, { OPENAI_API_KEY: 'x' }), { ok: true, key: 'OPENAI_API_KEY', api: 'openai' });
        assert.deepEqual(P.keyCheck({ model: 'ollama/llama3' }, {}), { ok: true, key: null, api: 'ollama' });
        assert.deepEqual(P.keyCheck({ model: 'something' }, {}), { ok: false, reason: 'the api of the model something is not known' });
    });

    test('the key of every api of src/models that needs one', () => {
        for (const file of fs.readdirSync(repoPath('src/models'))) {
            const text = fs.readFileSync(repoPath(`src/models/${file}`), 'utf8');
            const prefix = /static prefix = '([^']+)'/.exec(text)?.[1];
            if (!prefix) continue;
            assert.ok(prefix in P.KEY_OF_API, `KEY_OF_API has the api ${prefix}`);
            const key = P.KEY_OF_API[prefix];
            if (key !== null) assert.ok(text.includes(key), `${file} reads ${key}`);
        }
    });
});

describe('the steps', () => {
    test('the sentences of W80 and W84 in plain words, in the order of the journeys', () => {
        assert.deepEqual(P.STEPS.map((s) => s.say), ['this is home', 'follow me', 'remember the path here', 'come here', 'go to the basement', 'follow me', 'this is the mine', 'find some iron']);
        assert.deepEqual(P.STEPS.map((s) => s.expect), ['!rememberArea', '!followPlayer', '!rememberRoute', '!goToPlayer', '!goToRememberedPlace', '!followPlayer', '!rememberMine', '!mineOre']);
        for (const s of P.STEPS) {
            assert.equal(P.commandIn(s.fake), s.expect, `the fake answer of "${s.say}" is its command`);
            assert.ok(s.ms >= 30000 && s.fact.length > 0);
        }
    });

    test('commandIn: the first command of a text of the model', () => {
        assert.equal(P.commandIn('Following you! !followPlayer("w_player", 3)'), '!followPlayer');
        assert.equal(P.commandIn('Sure.'), null);
        assert.equal(P.commandIn(null), null);
    });
});

describe('the table', () => {
    test('rows, a step not run, the cost line', () => {
        const rows = [
            P.rowOf(P.STEPS[0], { chose: '!rememberArea', pass: true, detail: '"home"', dollars: 0.0123, calls: 2 }),
            P.rowOf(P.STEPS[1], { chose: null, pass: false, detail: '(1.0, 2.0, 3.0)', dollars: 0.001, calls: 1 }),
            P.rowOf(P.STEPS[6], { skipped: true, detail: 'the bot did not follow into the mine' }),
        ];
        assert.equal(P.formatTable(rows, { model: 'gpt-6-luna', costLine: 'Cost: session $0.01, 3 calls.' }), [
            '| Sentence | Command chosen | Journeys | Fact | Result | Cost |',
            '|---|---|---|---|---|---|',
            '| "this is home" | !rememberArea | !rememberArea | an area holds the middle of the house: "home" | pass | $0.012, 2 calls |',
            '| "follow me" | none | !followPlayer | the bot followed down the ladder into the basement: (1.0, 2.0, 3.0) | FAIL | $0.001, 1 call |',
            '| "this is the mine" | none | !rememberMine | mines.json has a mine of the player: the bot did not follow into the mine | not run | $0.000, 0 calls |',
            '',
            '1 of 3 facts hold. The model: gpt-6-luna.',
            'Cost: session $0.01, 3 calls.',
        ].join('\n'));
    });

    test('with --fake the line says that the cost is of a made-up usage', () => {
        const text = P.formatTable([], { fake: true });
        assert.match(text, /The model: a fake that answers with the commands of the journeys; its cost is of a made-up usage of 3000 tokens in and 40 out per call\./);
        assert.match(text, /No cost line: the cost meter is off\.$/);
    });
});

describe('the runner refuses without the key', () => {
    test('no key of the model in the environment: one line, exit 1, no server started', () => {
        const env = { ...process.env };
        for (const key of Object.values(P.KEY_OF_API)) if (key) delete env[key];
        env.MC_TEST_SERVER_DIR = repoPath('tests/fixtures/no-such-server');
        // a profile of its own: the owner edits profiles/claude.json
        const dir = makeTmpDir();
        try {
            const profile = `${dir}/p.json`;
            fs.writeFileSync(profile, JSON.stringify({ name: 'p', model: 'claude-haiku-4-5-20251001' }));
            const run = spawnSync(process.execPath, [repoPath('tests/play/run.js'), '--profile', profile], { cwd: repoPath(''), env, encoding: 'utf8', timeout: 30000 });
            assert.equal(run.status, 1);
            assert.equal(run.stdout.trim(), 'Play test refused: ANTHROPIC_API_KEY is not set in the environment: the chat model claude-haiku-4-5-20251001 (anthropic) needs it. Set it, or run with --fake.');
        } finally {
            removeTmpDir(dir);
        }
    });
});
