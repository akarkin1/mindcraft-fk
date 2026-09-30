// Spec v0.1.4.9 D3: scripts/routing_check.js with --profile and --model, the key of the api of the
// chat model, the placeholders of the dry run, the column ms and the summary line.
//
// The pure helpers are imported without running the script (it runs only as the main module). The
// script itself runs as a child process only where it sends nothing: without a key (it stops before
// any model is made), with bad arguments, and as a dry run. No test calls a model.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { runNodeScript } from '../helpers/child.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';

const S = await loadSrc('scripts/routing_check.js');
const SCRIPT = repoPath('scripts/routing_check.js');

// The environment of a child without any key of a model.
function envWithoutKeys(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    return env;
}

describe('parseArgs: --profile and --model', () => {
    test('both with a value, in both forms', () => {
        const a = S.parseArgs(['--dry-run', '--profile', 'profiles/gpt.json', '--model', 'gpt-6-luna']);
        assert.equal(a.profile, 'profiles/gpt.json');
        assert.equal(a.model, 'gpt-6-luna');
        assert.equal(a.dryRun, true);
        assert.deepEqual([a.unknown, a.missing], [[], []]);
        const b = S.parseArgs(['--profile=profiles/x.json', '--model=claude-opus-5-5', '--all-parts']);
        assert.deepEqual([b.profile, b.model, b.allParts], ['profiles/x.json', 'claude-opus-5-5', true]);
    });

    test('an option without a value is missing, not unknown', () => {
        assert.deepEqual(S.parseArgs(['--model']).missing, ['--model']);
        assert.deepEqual(S.parseArgs(['--profile', '--dry-run']).missing, ['--profile']);
        assert.equal(S.parseArgs(['--profile', '--dry-run']).dryRun, true);
        assert.deepEqual(S.parseArgs(['--model=', '--profile=  ']).missing, ['--model', '--profile']);
        assert.deepEqual(S.parseArgs(['--model']).unknown, []);
    });

    test('the default profile is profiles/claude.json', () => {
        assert.equal(S.DEFAULT_PROFILE, 'profiles/claude.json');
        assert.equal(S.parseArgs([]).profile, null);
    });
});

describe('apiOf, withModel, keyFor', () => {
    test('apiOf: the two apis of the check by the rules of selectAPI, null for any other', () => {
        const cases = [
            ['gpt-6-luna', 'openai'], ['gpt-5.4', 'openai'], ['openai/gpt-4o', 'openai'], ['o3-mini', 'openai'],
            ['claude-haiku-4-5-20251001', 'anthropic'], ['claude-sonnet-5', 'anthropic'], ['anthropic/claude-opus-5-5', 'anthropic'],
            [{ model: 'my-model', api: 'openai' }, 'openai'], [{ model: 'gpt-6-luna', params: {} }, 'openai'],
            ['gemini-2.5-pro', null], ['openrouter/anthropic/claude-3', null], ['azure/gpt-4o', null], ['ollama/gpt-oss', null],
            [{ model: 'gpt-4o', api: 'azure' }, null], [undefined, null], [null, null], [42, null],
        ];
        for (const [entry, api] of cases) assert.equal(S.apiOf(entry), api, JSON.stringify(entry));
    });

    test('withModel: { model: id, params } with the params of the profile, api openai for gpt-', () => {
        const claude = { name: 'claude', model: 'claude-haiku-4-5-20251001', code_model: { model: 'claude-sonnet-5' } };
        assert.deepEqual(S.withModel(claude, 'gpt-6-luna').model, { model: 'gpt-6-luna', api: 'openai' });
        assert.equal(S.withModel(claude, 'gpt-6-luna').code_model, claude.code_model, 'the rest of the profile stays');
        assert.equal(claude.model, 'claude-haiku-4-5-20251001', 'the profile is not changed');
        const gpt = { name: 'gpt', model: { model: 'gpt-6-luna', params: { reasoning: { effort: 'low' } } } };
        assert.deepEqual(S.withModel(gpt, 'gpt-6-sol').model, { model: 'gpt-6-sol', params: { reasoning: { effort: 'low' } }, api: 'openai' });
        assert.deepEqual(S.withModel(gpt, 'claude-opus-5-5').model, { model: 'claude-opus-5-5', params: { reasoning: { effort: 'low' } } });
        assert.equal(S.withModel(gpt, null), gpt);
        assert.equal(S.withModel(gpt, ''), gpt);
    });

    test('keyFor: the key of the api of the chat model', () => {
        assert.equal(S.keyFor({ model: 'claude-haiku-4-5-20251001' }), 'ANTHROPIC_API_KEY');
        assert.equal(S.keyFor({ model: { model: 'gpt-6-luna', params: {} } }), 'OPENAI_API_KEY');
        assert.equal(S.keyFor(S.withModel({ model: 'claude-haiku-4-5' }, 'gpt-6-luna')), 'OPENAI_API_KEY');
        assert.equal(S.keyFor({ model: 'gemini-2.5-pro' }), null);
        assert.deepEqual(S.API_KEYS, { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' });
    });

    test('placeholderKeys: every missing key in a dry run; in a real run not the key of the chat model', () => {
        const gptProfile = { model: { model: 'gpt-6-luna' }, code_model: { model: 'claude-sonnet-5' } };
        assert.deepEqual(S.placeholderKeys(gptProfile, {}, true), ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
        assert.deepEqual(S.placeholderKeys(gptProfile, { OPENAI_API_KEY: 'k' }, false), ['ANTHROPIC_API_KEY']);
        assert.deepEqual(S.placeholderKeys(gptProfile, { OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }, false), []);
        assert.deepEqual(S.placeholderKeys(gptProfile, { OPENAI_API_KEY: 'k' }, true), ['ANTHROPIC_API_KEY']);
        const claudeProfile = { model: 'claude-haiku-4-5', code_model: { model: 'claude-sonnet-5' }, embedding: 'openai' };
        assert.deepEqual(S.placeholderKeys(claudeProfile, {}, true), ['ANTHROPIC_API_KEY'], 'the embedding model is left out');
        assert.deepEqual(S.placeholderKeys(claudeProfile, { ANTHROPIC_API_KEY: 'k' }, false), []);
        assert.deepEqual(S.placeholderKeys({ model: 'claude-haiku-4-5', vision_model: 'gpt-6-luna' }, { ANTHROPIC_API_KEY: 'k' }, false), ['OPENAI_API_KEY']);
    });
});

describe('the summary of a real run', () => {
    test('the line of the spec, word for word', () => {
        // 136 answers: a median of 1.0 s and a mean of 1.2 s
        const times = [...Array(68).fill(1000), ...Array(68).fill(1400)];
        assert.equal(S.summaryLine(118, 136, { times, cost: { dollars: 0.93, unpriced_calls: 0 } }),
            'Accuracy: 118 of 136 (87%). Time per answer: median 1.2 s, mean 1.2 s. Cost: 0.93 dollars, measured.');
        const skewed = [...Array(70).fill(1000), ...Array(66).fill(1425)];
        assert.equal(S.summaryLine(118, 136, { times: skewed, cost: { dollars: 0.93, unpriced_calls: 0 } }),
            'Accuracy: 118 of 136 (87%). Time per answer: median 1.0 s, mean 1.2 s. Cost: 0.93 dollars, measured.');
    });

    test('timeStats: the median of an odd and an even list, the mean; null without numbers', () => {
        assert.deepEqual(S.timeStats([3000, 1000, 2000]), { median: 2000, mean: 2000 });
        assert.deepEqual(S.timeStats([4000, 1000, 2000, 3000]), { median: 2500, mean: 2500 });
        assert.deepEqual(S.timeStats([1000, NaN, 'x', 3000]), { median: 2000, mean: 2000 });
        assert.equal(S.timeStats([]), null);
    });

    test('the cost: two decimals, calls without a price, no meter', () => {
        assert.match(S.summaryLine(1, 1, { times: [900], cost: { dollars: 0.005, unpriced_calls: 0 } }), /Cost: 0\.01 dollars, measured\.$/);
        assert.match(S.summaryLine(1, 1, { times: [900], cost: { dollars: 1.2, unpriced_calls: 3 } }),
            /Cost: 1\.20 dollars, measured; 3 calls of models without a price are not included\.$/);
        assert.match(S.summaryLine(1, 1, { times: [900], cost: { dollars: 0, unpriced_calls: 1 } }),
            /measured; 1 call of models without a price is not included\.$/);
        assert.match(S.summaryLine(1, 1, { times: [900], cost: null }), /Cost: unknown, the cost meter is not available\.$/);
    });

    test('no answer: the time says so', () => {
        assert.equal(S.summaryLine(0, 2, { times: [], cost: { dollars: 0, unpriced_calls: 0 } }),
            'Accuracy: 0 of 2 (0%). Time per answer: no answer. Cost: 0.00 dollars, measured.');
    });

    test('the table of the real run has the column ms after the result', () => {
        const source = fs.readFileSync(SCRIPT, 'utf8');
        assert.ok(source.includes("[['#', 'result', 'ms', 'got', 'expected', 'sentence']]"));
    });
});

describe('the script: keys and arguments', () => {
    test('a gpt- model without OPENAI_API_KEY: refused with the name of the key, nothing written', () => {
        const cwd = makeTmpDir();
        try {
            const run = runNodeScript(SCRIPT, ['--model', 'gpt-6-luna'], { cwd, env: envWithoutKeys() });
            assert.equal(run.status, 1, run.stdout + run.stderr);
            assert.match(run.stdout, /environment variable OPENAI_API_KEY/);
            assert.doesNotMatch(run.stdout, /ANTHROPIC_API_KEY/);
            assert.deepEqual(listDir(cwd), []);
        } finally {
            removeTmpDir(cwd);
        }
    });

    test('the gpt profile without OPENAI_API_KEY: refused with the name of the key', () => {
        const run = runNodeScript(SCRIPT, ['--profile', repoPath('profiles/gpt.json')], { env: envWithoutKeys({ ANTHROPIC_API_KEY: 'placeholder-not-a-key' }) });
        assert.equal(run.status, 1, run.stdout + run.stderr);
        assert.match(run.stdout, /OPENAI_API_KEY/);
    });

    test('a Claude model without ANTHROPIC_API_KEY: refused with its name, also when the OpenAI key is there', () => {
        const run = runNodeScript(SCRIPT, ['--model', 'claude-opus-5-5'], { env: envWithoutKeys({ OPENAI_API_KEY: 'placeholder-not-a-key' }) });
        assert.equal(run.status, 1, run.stdout + run.stderr);
        assert.match(run.stdout, /environment variable ANTHROPIC_API_KEY/);
    });

    test('bad arguments end with 2: an option without a value, a profile that cannot be read, a model of another api', () => {
        const noValue = runNodeScript(SCRIPT, ['--dry-run', '--model'], { env: envWithoutKeys() });
        assert.equal(noValue.status, 2);
        assert.match(noValue.stdout, /The option --model needs a value\./);
        const dir = makeTmpDir();
        try {
            const noFile = runNodeScript(SCRIPT, ['--dry-run', '--profile', path.join(dir, 'none.json')], { env: envWithoutKeys() });
            assert.equal(noFile.status, 2);
            assert.match(noFile.stdout, /Could not read the profile /);
        } finally {
            removeTmpDir(dir);
        }
        const other = runNodeScript(SCRIPT, ['--dry-run', '--model', 'gemini-2.5-pro'], { env: envWithoutKeys() });
        assert.equal(other.status, 2);
        assert.match(other.stdout, /Anthropic and OpenAI models only/);
    });

    test('--help names the new options and both keys', () => {
        const run = runNodeScript(SCRIPT, ['--help']);
        assert.equal(run.status, 0);
        for (const word of ['--profile <path>', '--model <id>', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) assert.ok(run.stdout.includes(word), word);
    });
});

describe('the dry run with an OpenAI model', () => {
    test('--dry-run --model gpt-6-luna --all-parts: no key, the GPT class is made with the placeholder, no socket is opened', () => {
        const dir = makeTmpDir();
        // counts every socket and every fetch of the child; prints the number when it ends
        const preload = path.join(dir, 'count_sockets.cjs');
        fs.writeFileSync(preload, [
            "const net = require('node:net');",
            'let n = 0;',
            'const connect = net.Socket.prototype.connect;',
            'net.Socket.prototype.connect = function (...a) { n++; return connect.apply(this, a); };',
            'const f = globalThis.fetch;',
            'if (f) globalThis.fetch = (...a) => { n++; return f(...a); };',
            "process.on('exit', () => { process.stdout.write('SOCKETS ' + n + '\\n'); });",
        ].join('\n'));
        const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(preload)}`.trim();
        try {
            const run = runNodeScript(SCRIPT, ['--dry-run', '--model', 'gpt-6-luna', '--all-parts'], { env: envWithoutKeys({ NODE_OPTIONS: nodeOptions }) });
            assert.equal(run.status, 0, run.stdout + run.stderr);
            assert.match(run.stdout, /^Routing check with profiles\/claude\.json, chat model gpt-6-luna, dry run: nothing is sent\.$/m);
            assert.match(run.stdout, /routes_pack, mine_routes\.$/m, 'every part is on');
            assert.match(run.stdout, /^Prompts: \d+\. Average size: \d+ characters\./m);
            assert.match(run.stdout, /^Estimated cost of a real run at the prices of gpt-6-luna: \$\d+\.\d\d /m);
            assert.match(run.stdout, /^SOCKETS 0$/m);
        } finally {
            removeTmpDir(dir);
        }
    });
});
