// v0.1.4.13 part M3 (SPEC 4.7, PLAN 5.2): the cost meter counts OpenAI's cache writes. price_table.js gives gpt-6-luna
// cache_write 0.125 dollars per million (the owner's bill of 2026-10-03); gpt.js reports as cache_write_tokens the prompt
// tokens that were not cached when the prompt is 1,024 tokens or longer (OpenAI caches such a prompt by itself); the
// session line and the scorecard show the writes.
//
// No key and no network: gpt.js gets a fake client; the import runs in an empty temp folder, so keys.json is never read.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importGptWithoutKeys() {
    const cwd = process.cwd();
    const empty = makeTmpDir();
    const cap = captureConsole();
    process.chdir(empty);
    try {
        return await loadSrc('src/models/gpt.js');
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
}

const G = await importGptWithoutKeys();
const U = await loadSrc('src/agent/cost/usage_context.js');
const P = await loadSrc('src/agent/cost/price_table.js');
const C = await loadSrc('src/agent/cost/cost_meter.js');
const S = await loadSrc('scripts/scorecard_logic.js');

const LUNA = 'gpt-6-luna';
const TURNS = [{ role: 'user', content: 'steve: hello' }];
const counts = (r) => [r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens];

function fakeClient({ responses, chat, embeddings } = {}) {
    return {
        responses: { create: async () => responses() },
        chat: { completions: { create: async () => chat() } },
        embeddings: { create: async () => embeddings() },
    };
}
const responseOf = (usage) => ({ output_text: 'Sure! !stats', usage });
const completionOf = (usage) => ({ choices: [{ finish_reason: 'stop', message: { content: 'Sure! !stats' } }], usage });

let reports;
let cap;
let dir;
beforeEach(() => {
    reports = [];
    U.setUsageSink((report) => reports.push(report));
    cap = captureConsole();
    dir = makeTmpDir();
});
afterEach(() => {
    cap.restore();
    U.setUsageSink(null);
    removeTmpDir(dir);
});

describe('the price of gpt-6-luna', () => {
    test('cache_write 0.125 dollars per million, beside input 0.10, output 0.50 and cache_read 0.01', () => {
        assert.deepEqual({ ...P.DEFAULT_PRICES[LUNA] }, { input: 0.10, output: 0.50, cache_read: 0.01, cache_write: 0.125 });
        assert.deepEqual(P.priceFor(LUNA), { input: 0.10, output: 0.50, cache_read: 0.01, cache_write: 0.125 });
    });

    test('the bill of 2026-10-03: 997k writes, 79k reads and 55k plain prompt tokens cost $0.130915', () => {
        const usage = { input_tokens: 55_000, output_tokens: 0, cache_read_tokens: 79_000, cache_write_tokens: 997_000 };
        assert.equal(P.costOf(usage, P.priceFor(LUNA)), 0.130915);
        // the meter of v0.1.4.12 counted the same tokens as 1,052k of plain input and 79k reads
        assert.equal(P.costOf({ input_tokens: 1_052_000, cache_read_tokens: 79_000 }, P.priceFor(LUNA)), 0.10599);
    });
});

describe('gpt.js reports the cache writes', () => {
    test('the threshold is 1,024 prompt tokens', () => {
        assert.equal(G.CACHE_MIN_PROMPT_TOKENS, 1024);
    });

    test('responses, a prompt over 1,024 tokens: the tokens not read from the cache are writes, none is plain input', async () => {
        const client = fakeClient({ responses: () => responseOf({ input_tokens: 1200, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 300 }) });
        await new G.GPT(LUNA, null, {}, { client }).sendRequest(TURNS, 'sys');
        assert.deepEqual(reports.map(counts), [[0, 300, 1000, 200]]);
        assert.equal(reports[0].model, LUNA);
    });

    test('responses, a prompt under 1,024 tokens: no writes, the tokens are plain input', async () => {
        const client = fakeClient({ responses: () => responseOf({ input_tokens: 900, output_tokens: 7 }) });
        await new G.GPT(LUNA, null, {}, { client }).sendRequest(TURNS, 'sys');
        assert.deepEqual(reports.map(counts), [[900, 7, 0, 0]]);
    });

    test('exactly 1,024 tokens writes; 1,023 does not', async () => {
        for (const [prompt, expected] of [[1024, [0, 1, 0, 1024]], [1023, [1023, 1, 0, 0]]]) {
            reports = [];
            const client = fakeClient({ responses: () => responseOf({ input_tokens: prompt, output_tokens: 1 }) });
            await new G.GPT(LUNA, null, {}, { client }).sendRequest(TURNS, 'sys');
            assert.deepEqual(reports.map(counts), [expected], String(prompt));
        }
    });

    test('a prompt read whole from the cache writes nothing', async () => {
        const client = fakeClient({ responses: () => responseOf({ input_tokens: 4096, input_tokens_details: { cached_tokens: 4096 }, output_tokens: 5 }) });
        await new G.GPT(LUNA, null, {}, { client }).sendRequest(TURNS, 'sys');
        assert.deepEqual(reports.map(counts), [[0, 5, 4096, 0]]);
    });

    test('chat completions (a custom url): the same rule over prompt_tokens', async () => {
        for (const [usage, expected] of [
            [{ prompt_tokens: 2000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1024 } }, [0, 40, 1024, 976]],
            [{ prompt_tokens: 500, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 128 } }, [372, 40, 128, 0]],
        ]) {
            reports = [];
            const client = fakeClient({ chat: () => completionOf(usage) });
            await new G.GPT(LUNA, 'http://127.0.0.1:9/v1', {}, { client }).sendRequest(TURNS, 'sys');
            assert.deepEqual(reports.map(counts), [expected], JSON.stringify(usage));
        }
    });

    test('an embedding never writes the cache, however long', async () => {
        const client = fakeClient({ embeddings: () => ({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 5000, total_tokens: 5000 } }) });
        await new G.GPT('text-embedding-3-small', null, {}, { client }).embed('text');
        assert.deepEqual(reports.map(counts), [[5000, 0, 0, 0]]);
    });
});

describe('the session line shows the writes', () => {
    const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);
    const meterOf = (options = {}) => new C.CostMeter({ settings: {}, now: () => T0, launchId: null, ...options });
    const luna = (fields) => ({ model: LUNA, purpose: 'chat', input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, ...fields });

    test('tokensText: below 1,000 the number, else thousands with a k', () => {
        assert.equal(C.tokensText(0), '0');
        assert.equal(C.tokensText(512), '512');
        assert.equal(C.tokensText(79_020), '79k');
        assert.equal(C.tokensText(997_412), '997k');
        assert.equal(C.tokensText(1_131_400), '1,131k');
    });

    test('with cache tokens: the prompt tokens with the writes and the reads', () => {
        const meter = meterOf();
        meter.record(luna({ input_tokens: 55_000, cache_read_tokens: 79_000, cache_write_tokens: 997_000 }));
        assert.equal(meter.reportLine(), 'Cost: session $0.13 (chat $0.13), 1 calls. Prompt tokens: 1,131k, of them 997k cache writes and 79k cache reads.');
    });

    test('without cache tokens the line is as before', () => {
        const meter = meterOf();
        meter.record(luna({ input_tokens: 900, output_tokens: 10 }));
        assert.equal(meter.reportLine(), 'Cost: session $0.00 (chat $0.00), 1 calls.');
    });

    test('after the sentence of the unpriced calls, before the one of the earlier processes', () => {
        const file = path.join(dir, 'usage.json');
        const first = meterOf({ filePath: file, launchId: 'L1' });
        first.record(luna({ input_tokens: 500, cache_write_tokens: 2000 }));
        assert.equal(first.flush(), true);
        const session = JSON.parse(fs.readFileSync(file, 'utf8')).sessions[0];
        assert.equal(session.cache_write_tokens, 2000);
        assert.equal(session.cache_read_tokens, 0);
        const second = meterOf({ filePath: file, launchId: 'L1' });
        second.record(luna({ cache_read_tokens: 2000 }));
        second.record({ model: 'mystery-model-1', purpose: 'chat', input_tokens: 10 });
        // 500 + 2,000 + 2,000 + the 10 of the unpriced call = 4,510 prompt tokens of the launch
        assert.equal(second.reportLine(), 'Cost: session $0.00 (chat $0.00), 3 calls. 1 calls of models without a price are not included.'
            + ' Prompt tokens: 5k, of them 2k cache writes and 2k cache reads. It includes 1 earlier process since the start of the bot.');
    });

    test('usage.json: a session without cache tokens keeps the keys of before', () => {
        const file = path.join(dir, 'usage.json');
        const meter = meterOf({ filePath: file });
        meter.record(luna({ input_tokens: 900 }));
        meter.flush();
        const session = JSON.parse(fs.readFileSync(file, 'utf8')).sessions[0];
        assert.ok(!('cache_write_tokens' in session) && !('cache_read_tokens' in session));
    });
});

describe('the scorecard shows the writes', () => {
    const LOG = [
        'Initializing agent gpt...',
        'Awaiting openai api response from model gpt-6-luna',
        'Cost: session $0.10 (chat $0.10), 200 calls. Prompt tokens: 900k, of them 800k cache writes and 60k cache reads.',
        'Initializing agent gpt...',
        'Cost: session $0.04 (chat $0.04), 56 calls. Prompt tokens: 231k, of them 197k cache writes and 19k cache reads.',
    ].join('\n');

    test('the cost lines of two processes are summed; the cell names the writes and the reads', () => {
        const [row] = S.scorecard(S.parseLog(LOG).events, { name: 'luna.log' });
        assert.deepEqual(row.cache, { prompt: 1_131_000, writes: 997_000, reads: 79_000 });
        assert.equal(S.cells(row)[S.COLUMNS.indexOf('Cost')], '$0.14 (cache writes 997k, reads 79k of 1,131k)');
    });

    test('a cumulative line (earlier processes) replaces the sums, as for the dollars', () => {
        const log = `${LOG}\nInitializing agent gpt...\nCost: session $0.20 (chat $0.20), 300 calls. Prompt tokens: 1,500k, of them 1,200k cache writes and 100k cache reads. It includes 2 earlier processes since the start of the bot.`;
        const [row] = S.scorecard(S.parseLog(log).events);
        assert.deepEqual(row.cache, { prompt: 1_500_000, writes: 1_200_000, reads: 100_000 });
    });

    test('without the sentence: no cache, the cell as before', () => {
        const [row] = S.scorecard(S.parseLog('Initializing agent claude...\nCost: session $0.60 (chat $0.60), 2 calls.').events);
        assert.equal(row.cache, null);
        assert.equal(S.cells(row)[S.COLUMNS.indexOf('Cost')], '$0.60');
    });

    test('the total row sums the cache of the logs', () => {
        const a = S.scorecard(S.parseLog(LOG).events, { name: 'a' })[0];
        const b = S.scorecard(S.parseLog('Initializing agent claude...\nCost: session $0.60 (chat $0.60), 2 calls.').events, { name: 'b' })[0];
        assert.deepEqual(S.totalRow([a, b, a]).cache, { prompt: 2_262_000, writes: 1_994_000, reads: 158_000 });
    });
});
