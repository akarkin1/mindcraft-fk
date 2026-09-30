// Spec v0.1.4.9 D1 and I9: src/models/gpt.js reports the usage of every successful request of the
// three kinds (responses, chat completions, embeddings) through reportUsage of
// src/agent/cost/usage_context.js; a response without `usage` reports nothing.
//
// No key and no network: the adapter is made with `new GPT(model, url, params, { client })` and a fake
// client whose three methods return fixtures. Importing gpt.js loads src/utils/keys.js, which reads
// './keys.json' relative to the working directory at import time. The import therefore runs with the
// working directory set to an empty temp directory, so the real keys.json is never read.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importGptWithoutKeys() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/models/gpt.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const G = await importGptWithoutKeys();
const U = await loadSrc('src/agent/cost/usage_context.js');
const P = await loadSrc('src/agent/cost/price_table.js');

const TURNS = [{ role: 'user', content: 'steve: hello' }];

// The usage objects of the three APIs, as OpenAI sends them.
const RESPONSES_USAGE = {
    input_tokens: 1200, input_tokens_details: { cached_tokens: 1000 },
    output_tokens: 300, output_tokens_details: { reasoning_tokens: 200 }, total_tokens: 1500,
};
const CHAT_USAGE = { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540, prompt_tokens_details: { cached_tokens: 128 } };
const EMBED_USAGE = { prompt_tokens: 12, total_tokens: 12 };

// A fake OpenAI client. `answers` gives the result (or throws) per method; the requests are recorded.
function fakeClient(answers = {}) {
    const requests = { responses: [], chat: [], embeddings: [] };
    const call = async (kind, request) => {
        requests[kind].push(request);
        return answers[kind](request);
    };
    return {
        requests,
        responses: { create: (request) => call('responses', request) },
        chat: { completions: { create: (request) => call('chat', request) } },
        embeddings: { create: (request) => call('embeddings', request) },
    };
}

const responseOf = (usage, text = 'Sure! !stats') => ({ output_text: text, ...(usage === undefined ? {} : { usage }) });
const completionOf = (usage, finish = 'stop', text = 'Sure! !stats') => ({
    choices: [{ finish_reason: finish, message: { content: text } }], ...(usage === undefined ? {} : { usage }),
});
const embeddingOf = (usage) => ({ data: [{ embedding: [0.1, 0.2, 0.3] }], ...(usage === undefined ? {} : { usage }) });

const counts = (r) => [r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens];

let reports;
let cap;
beforeEach(() => {
    reports = [];
    U.setUsageSink((report) => reports.push(report));
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    U.setUsageSink(null);
});

describe('gpt.js and the cost meter', () => {
    test('gpt.js imports reportUsage from src/agent/cost/usage_context.js', () => {
        const source = fs.readFileSync(repoPath('src/models/gpt.js'), 'utf8');
        assert.match(source, /^import \{ reportUsage \} from '\.\.\/agent\/cost\/usage_context\.js';\r?$/m);
    });

    test('the constructor takes a client and needs no key then', () => {
        const had = Object.hasOwn(process.env, 'OPENAI_API_KEY');
        const saved = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        try {
            const client = fakeClient();
            const gpt = new G.GPT('gpt-6-luna', null, { reasoning: { effort: 'low' } }, { client });
            assert.equal(gpt.openai, client);
            assert.equal(gpt.model_name, 'gpt-6-luna');
            assert.deepEqual(gpt.params, { reasoning: { effort: 'low' } });
        } finally {
            if (had) process.env.OPENAI_API_KEY = saved;
        }
    });
});

describe('responses API (no url)', () => {
    test('input is input_tokens minus the cached ones, cache_read the cached ones, output with the reasoning tokens', async () => {
        const client = fakeClient({ responses: () => responseOf(RESPONSES_USAGE) });
        const gpt = new G.GPT('gpt-6-luna', null, { reasoning: { effort: 'low' } }, { client });
        const text = await U.withPurpose('chat', () => gpt.sendRequest(TURNS, 'system prompt'));
        assert.equal(text, 'Sure! !stats');
        assert.equal(client.requests.responses.length, 1);
        assert.equal(client.requests.responses[0].model, 'gpt-6-luna');
        assert.equal(client.requests.responses[0].instructions, 'system prompt');
        assert.deepEqual(client.requests.responses[0].reasoning, { effort: 'low' });
        assert.deepEqual(reports.map(counts), [['gpt-6-luna', 200, 300, 1000, 0]]);
        assert.equal(reports[0].purpose, 'chat');
    });

    test('without cached tokens the input is input_tokens', async () => {
        const client = fakeClient({ responses: () => responseOf({ input_tokens: 90, output_tokens: 7 }) });
        await new G.GPT('gpt-6-luna', null, {}, { client }).sendRequest(TURNS, 'sys');
        assert.deepEqual(reports.map(counts), [['gpt-6-luna', 90, 7, 0, 0]]);
        assert.equal(reports[0].purpose, 'other', 'outside of withPurpose');
    });

    test('a response without usage reports nothing', async () => {
        const client = fakeClient({ responses: () => responseOf(undefined) });
        assert.equal(await new G.GPT('gpt-6-luna', null, {}, { client }).sendRequest(TURNS, 'sys'), 'Sure! !stats');
        assert.deepEqual(reports, []);
    });

    test('a failed request reports nothing', async () => {
        const client = fakeClient({ responses: () => { throw new Error('500 server error'); } });
        assert.equal(await new G.GPT('gpt-6-luna', null, {}, { client }).sendRequest(TURNS, 'sys'), 'My brain disconnected, try again.');
        assert.deepEqual(reports, []);
    });

    test('without a model name the default model is asked and reported', async () => {
        const client = fakeClient({ responses: () => responseOf({ input_tokens: 1, output_tokens: 1 }) });
        await new G.GPT(null, null, {}, { client }).sendRequest(TURNS, 'sys');
        assert.equal(client.requests.responses[0].model, 'gpt-4o-mini');
        assert.equal(reports[0].model, 'gpt-4o-mini');
    });

    test('a vision request is reported once, with the purpose vision', async () => {
        const client = fakeClient({ responses: () => responseOf({ input_tokens: 1500, output_tokens: 40 }) });
        const gpt = new G.GPT('gpt-6-luna', null, {}, { client });
        await U.withPurpose('vision', () => gpt.sendVisionRequest(TURNS, 'describe', Buffer.from('jpeg')));
        assert.equal(client.requests.responses.length, 1);
        assert.deepEqual(reports.map((r) => [r.input_tokens, r.purpose]), [[1500, 'vision']]);
    });
});

describe('chat completions (a custom url)', () => {
    test('prompt_tokens minus the cached ones, completion_tokens, the cached ones', async () => {
        const client = fakeClient({ chat: () => completionOf(CHAT_USAGE) });
        const gpt = new G.GPT('gpt-6-luna', 'http://127.0.0.1:9/v1', {}, { client });
        const text = await U.withPurpose('coding', () => gpt.sendRequest(TURNS, 'system prompt'));
        assert.equal(text, 'Sure! !stats');
        assert.equal(client.requests.chat.length, 1);
        assert.equal(client.requests.responses.length, 0);
        assert.deepEqual(reports.map(counts), [['gpt-6-luna', 372, 40, 128, 0]]);
        assert.equal(reports[0].purpose, 'coding');
    });

    test('a completion without usage reports nothing', async () => {
        const client = fakeClient({ chat: () => completionOf(undefined) });
        assert.equal(await new G.GPT('gpt-6-luna', 'http://127.0.0.1:9/v1', {}, { client }).sendRequest(TURNS, 'sys'), 'Sure! !stats');
        assert.deepEqual(reports, []);
    });

    test('an answer cut at the length is paid for: it is reported, then the shorter request too', async () => {
        let n = 0;
        const client = fakeClient({ chat: () => (++n === 1 ? completionOf({ prompt_tokens: 100, completion_tokens: 50 }, 'length') : completionOf({ prompt_tokens: 60, completion_tokens: 5 })) });
        const turns = [{ role: 'user', content: 'steve: a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'steve: c' }];
        assert.equal(await new G.GPT('gpt-6-luna', 'http://127.0.0.1:9/v1', {}, { client }).sendRequest(turns, 'sys'), 'Sure! !stats');
        assert.equal(client.requests.chat.length, 2);
        assert.deepEqual(reports.map(counts), [['gpt-6-luna', 100, 50, 0, 0], ['gpt-6-luna', 60, 5, 0, 0]]);
    });

    test('a failed request reports nothing', async () => {
        const client = fakeClient({ chat: () => { throw new Error('connection refused'); } });
        assert.equal(await new G.GPT('gpt-6-luna', 'http://127.0.0.1:9/v1', {}, { client }).sendRequest(TURNS, 'sys'), 'My brain disconnected, try again.');
        assert.deepEqual(reports, []);
    });
});

describe('embeddings', () => {
    test('input is prompt_tokens, output 0, the model text-embedding-3-small', async () => {
        const client = fakeClient({ embeddings: () => embeddingOf(EMBED_USAGE) });
        const embedding = await new G.GPT(null, null, {}, { client }).embed('find the chest');
        assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
        assert.equal(client.requests.embeddings[0].model, 'text-embedding-3-small');
        assert.deepEqual(reports.map(counts), [['text-embedding-3-small', 12, 0, 0, 0]]);
    });

    test('the model that is used is reported', async () => {
        const client = fakeClient({ embeddings: () => embeddingOf(EMBED_USAGE) });
        await new G.GPT('text-embedding-3-large', null, {}, { client }).embed('x');
        assert.deepEqual(reports.map(counts), [['text-embedding-3-large', 12, 0, 0, 0]]);
    });

    test('the purpose is the one of the caller: usage_context has no purpose for embeddings', async () => {
        assert.ok(!U.PURPOSES.some((p) => /embed/.test(p)), 'no embedding purpose');
        const client = fakeClient({ embeddings: () => embeddingOf(EMBED_USAGE) });
        const gpt = new G.GPT(null, null, {}, { client });
        await gpt.embed('outside');
        await U.withPurpose('chat', () => gpt.embed('inside'));
        assert.deepEqual(reports.map((r) => r.purpose), ['other', 'chat']);
    });

    test('an embedding without usage reports nothing; a failed one throws as before and reports nothing', async () => {
        const client = fakeClient({ embeddings: () => embeddingOf(undefined) });
        await new G.GPT(null, null, {}, { client }).embed('x');
        const failing = fakeClient({ embeddings: () => { throw new Error('401'); } });
        await assert.rejects(new G.GPT(null, null, {}, { client: failing }).embed('x'), /401/);
        assert.deepEqual(reports, []);
    });
});

describe('the reports have prices', () => {
    test('a report of gpt-6-luna and of text-embedding-3-small has a price and a cost', () => {
        // 200 * 0.10 + 300 * 0.50 + 1000 * 0.01 = 180 dollars per million tokens
        assert.equal(P.costOf({ input_tokens: 200, output_tokens: 300, cache_read_tokens: 1000, cache_write_tokens: 0 }, P.priceFor('gpt-6-luna')), 0.00018);
        assert.equal(P.costOf({ input_tokens: 1_000_000, output_tokens: 0 }, P.priceFor('text-embedding-3-small')), 0.02);
    });
});

// The constructor without a client reads the key with getKey, as before (D3: a placeholder is enough
// to construct it; the client is made and sends nothing while it is created).
describe('GPT constructor without a client', () => {
    const KEY = 'OPENAI_API_KEY';
    function withKeyEnv(value, fn) {
        const had = Object.hasOwn(process.env, KEY);
        const saved = process.env[KEY];
        if (value === undefined) delete process.env[KEY];
        else process.env[KEY] = value;
        try {
            return fn();
        } finally {
            if (had) process.env[KEY] = saved;
            else delete process.env[KEY];
        }
    }

    test('without a key it throws, as before', () => {
        withKeyEnv(undefined, () => {
            assert.throws(() => new G.GPT('gpt-6-luna', null, {}), /API key "OPENAI_API_KEY" not found/);
        });
    });

    test('with a placeholder key it is made, with the SDK client', () => {
        const gpt = withKeyEnv('dry-run-placeholder-not-a-key', () => new G.GPT('gpt-6-luna', null, { reasoning: { effort: 'low' } }));
        assert.equal(gpt.model_name, 'gpt-6-luna');
        assert.equal(typeof gpt.openai.responses.create, 'function');
        assert.equal(typeof gpt.openai.embeddings.create, 'function');
    });
});
