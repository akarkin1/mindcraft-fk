// T1, spec v0.1.4.9 part D: I9 and D1 (the usage of the OpenAI models, reported to the cost meter after every
// successful request, with a fake client through `new GPT(model, url, params, { client })`), D2 (the prices), D3
// (the routing check: --profile, --model, the summary line). No real model is ever called: the fake client answers
// with fixtures; the module is imported in an empty working folder (no keys.json is read), and the keys of the
// OpenAI api are removed from the environment of this test process, so that a client made with a key cannot exist.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_ORG_ID;

let GPT;
let U;
let P;
let RC;
{
    const cwd = process.cwd();
    const empty = makeTmpDir();
    const cap = captureConsole();
    process.chdir(empty);
    try {
        GPT = (await loadSrc('src/models/gpt.js')).GPT;
        U = await loadSrc('src/agent/cost/usage_context.js');
        P = await loadSrc('src/agent/cost/price_table.js');
        RC = await loadSrc('scripts/routing_check.js');
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
}

// the fake OpenAI client: records the requests, answers with the fixtures; `fail` makes a call throw
function fakeClient({ responses, chat, embeddings, fail = false } = {}) {
    const calls = [];
    const answer = (kind, fixture) => async (request) => {
        calls.push([kind, request]);
        if (fail) throw new Error('network down');
        return fixture;
    };
    return {
        calls,
        responses: { create: answer('responses', responses) },
        chat: { completions: { create: answer('chat', chat) } },
        embeddings: { create: answer('embeddings', embeddings) },
    };
}

const RESPONSES = { output_text: 'Hello there!', model: 'gpt-6-luna',
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 300 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 50 }, total_tokens: 1200 } };
const CHAT = { choices: [{ message: { role: 'assistant', content: 'Hi!' }, finish_reason: 'stop' }], model: 'gpt-6-luna',
    usage: { prompt_tokens: 900, completion_tokens: 150, prompt_tokens_details: { cached_tokens: 100 }, total_tokens: 1050 } };
const EMBEDDINGS = { data: [{ embedding: [0.1, 0.2, 0.3] }], model: 'text-embedding-3-small', usage: { prompt_tokens: 12, total_tokens: 12 } };
const withoutUsage = (fixture) => {
    const { usage, ...rest } = fixture;
    void usage;
    return rest;
};

let reports;
let cap;
beforeEach(() => {
    reports = [];
    U.setUsageSink((r) => reports.push(r));
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    U.setUsageSink(null);
});
const numbers = (r) => ({ model: r.model, input_tokens: r.input_tokens, output_tokens: r.output_tokens, cache_read_tokens: r.cache_read_tokens, cache_write_tokens: r.cache_write_tokens });

describe('I9, D1: the usage of the three calls', () => {
    test('the responses API: input without the cached tokens, cache_read the cached tokens, output with the reasoning', async () => {
        const client = fakeClient({ responses: RESPONSES });
        const model = new GPT('gpt-6-luna', undefined, { reasoning: { effort: 'low' } }, { client });
        const text = await model.sendRequest([{ role: 'user', content: 'hi' }], 'You are a bot.');
        assert.equal(text, 'Hello there!');
        assert.deepEqual(client.calls.map((c) => c[0]), ['responses']);
        assert.equal(reports.length, 1);
        assert.deepEqual(numbers(reports[0]), { model: 'gpt-6-luna', input_tokens: 700, output_tokens: 200, cache_read_tokens: 300, cache_write_tokens: 0 });
    });

    test('chat completions (a custom url): prompt_tokens without the cached ones, completion_tokens, the cached tokens', async () => {
        const client = fakeClient({ chat: CHAT });
        const model = new GPT('gpt-6-luna', 'http://127.0.0.1:9/v1', undefined, { client });
        const text = await model.sendRequest([{ role: 'user', content: 'hi' }], 'You are a bot.');
        assert.equal(text, 'Hi!');
        assert.deepEqual(client.calls.map((c) => c[0]), ['chat']);
        assert.equal(reports.length, 1);
        assert.deepEqual(numbers(reports[0]), { model: 'gpt-6-luna', input_tokens: 800, output_tokens: 150, cache_read_tokens: 100, cache_write_tokens: 0 });
    });

    test('embeddings: input the prompt tokens, output 0, the model text-embedding-3-small', async () => {
        const client = fakeClient({ embeddings: EMBEDDINGS });
        const model = new GPT('text-embedding-3-small', undefined, undefined, { client });
        assert.deepEqual(await model.embed('a text to embed'), [0.1, 0.2, 0.3]);
        assert.equal(reports.length, 1);
        assert.deepEqual(numbers(reports[0]), { model: 'text-embedding-3-small', input_tokens: 12, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
    });

    test('embeddings without a model name: the model used, text-embedding-3-small', async () => {
        const client = fakeClient({ embeddings: EMBEDDINGS });
        const model = new GPT(undefined, undefined, undefined, { client });
        await model.embed('a text');
        assert.equal(client.calls[0][1].model, 'text-embedding-3-small');
        assert.equal(reports[0]?.model, 'text-embedding-3-small');
    });

    test('without a usage object nothing is reported, for each of the three calls', async () => {
        const client = fakeClient({ responses: withoutUsage(RESPONSES), chat: withoutUsage(CHAT), embeddings: withoutUsage(EMBEDDINGS) });
        await new GPT('gpt-6-luna', undefined, undefined, { client }).sendRequest([{ role: 'user', content: 'hi' }], 'sys');
        await new GPT('gpt-6-luna', 'http://127.0.0.1:9/v1', undefined, { client }).sendRequest([{ role: 'user', content: 'hi' }], 'sys');
        await new GPT('text-embedding-3-small', undefined, undefined, { client }).embed('x');
        assert.equal(client.calls.length, 3);
        assert.deepEqual(reports, []);
    });

    test('a failed request reports nothing', async () => {
        const client = fakeClient({ fail: true });
        await new GPT('gpt-6-luna', undefined, undefined, { client }).sendRequest([{ role: 'user', content: 'hi' }], 'sys');
        await new GPT('gpt-6-luna', 'http://127.0.0.1:9/v1', undefined, { client }).sendRequest([{ role: 'user', content: 'hi' }], 'sys');
        try {
            await new GPT('text-embedding-3-small', undefined, undefined, { client }).embed('x');
        } catch {
            // an embedding that fails may throw; the caller falls back
        }
        assert.deepEqual(reports, []);
    });

    test('the constructor with a client needs no key', () => {
        assert.doesNotThrow(() => new GPT('gpt-6-luna', undefined, undefined, { client: fakeClient() }));
    });
});

describe('I9, D2: the prices', () => {
    test('gpt-6-luna: input 0.10, output 0.50, cache_read 0.01', () => {
        const p = P.priceFor('gpt-6-luna');
        assert.ok(p);
        assert.equal(p.input, 0.10);
        assert.equal(p.output, 0.50);
        assert.equal(p.cache_read, 0.01);
    });

    test('text-embedding-3-small: input 0.02, output 0', () => {
        const p = P.priceFor('text-embedding-3-small');
        assert.ok(p);
        assert.equal(p.input, 0.02);
        assert.equal(p.output, 0);
    });

    test('in DEFAULT_PRICES', () => {
        assert.deepEqual({ ...P.DEFAULT_PRICES['gpt-6-luna'] }, { input: 0.10, output: 0.50, cache_read: 0.01, cache_write: 0.125 }); // v0.1.4.13 (M3)
        assert.equal(P.DEFAULT_PRICES['text-embedding-3-small'].input, 0.02);
    });

    test('no price for the speech model', () => {
        assert.equal(P.priceFor('tts-1'), null);
        assert.equal(P.priceFor('gpt-4o-mini-tts'), null);
    });

    test('the cost of the responses call of D1 at the price of Luna', () => {
        const dollars = P.costOf({ input_tokens: 700, output_tokens: 200, cache_read_tokens: 300, cache_write_tokens: 0 }, P.priceFor('gpt-6-luna'));
        assert.equal(dollars, (700 * 0.10 + 200 * 0.50 + 300 * 0.01) / 1e6);
    });
});

describe('D3: the routing check (pure parts)', () => {
    test('--profile <path> and --model <id>; the default profile is profiles/claude.json', () => {
        const a = RC.parseArgs(['--dry-run', '--profile', 'profiles/gpt.json', '--model', 'gpt-6-luna']);
        assert.equal(a.dryRun, true);
        assert.equal(a.profile, 'profiles/gpt.json');
        assert.equal(a.model, 'gpt-6-luna');
        const b = RC.parseArgs([]);
        assert.equal(b.profile ?? RC.DEFAULT_PROFILE, 'profiles/claude.json');
        assert.equal(b.model ?? null, null);
    });

    test('--model replaces the chat model and keeps the params of the profile; gpt- sets api openai', () => {
        const profile = { name: 'claude', model: { model: 'claude-haiku-4-5', params: { max_tokens: 1000 } }, code_model: { model: 'claude-sonnet-5' } };
        const luna = RC.withModel(profile, 'gpt-6-luna');
        assert.deepEqual(luna.model, { model: 'gpt-6-luna', params: { max_tokens: 1000 }, api: 'openai' });
        assert.deepEqual(luna.code_model, profile.code_model);
        const haiku = RC.withModel(profile, 'claude-haiku-4-5-20251001');
        assert.equal(haiku.model.model, 'claude-haiku-4-5-20251001');
        assert.notEqual(haiku.model.api, 'openai');
        assert.deepEqual(profile.model, { model: 'claude-haiku-4-5', params: { max_tokens: 1000 } }, 'the profile is not changed');
    });

    test('the key of the real run is the one of the api of the chat model', () => {
        assert.equal(RC.keyFor({ model: { model: 'gpt-6-luna', api: 'openai' } }), 'OPENAI_API_KEY');
        assert.equal(RC.keyFor({ model: { model: 'claude-haiku-4-5' } }), 'ANTHROPIC_API_KEY');
    });

    test('the summary: `Accuracy: 118 of 136 (87%). Time per answer: median 1.0 s, mean 1.2 s. Cost: 0.93 dollars, measured.`', () => {
        const times = [800, 1000, 1000, 1000, 2200]; // median 1000 ms, mean 1200 ms
        assert.equal(RC.summaryLine(118, 136, { times, cost: { dollars: 0.93, unpriced_calls: 0 } }),
            'Accuracy: 118 of 136 (87%). Time per answer: median 1.0 s, mean 1.2 s. Cost: 0.93 dollars, measured.');
    });
});

after(() => U?.setUsageSink?.(null));
