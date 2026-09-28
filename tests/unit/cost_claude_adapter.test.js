// Spec v0.1.4.6 C4: src/models/claude.js reports the usage of every successful messages.create
// through reportUsage of src/agent/cost/usage_context.js.
//
// No key and no network: the adapter object is made with Object.create(Claude.prototype), so the
// constructor (getKey, new Anthropic) never runs, and `anthropic.messages.create` is a fake.
// Importing claude.js loads src/utils/keys.js, which reads './keys.json' relative to the working
// directory at import time. The import therefore runs with the working directory set to an empty
// temp directory, so the real keys.json is never read.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importClaudeWithoutKeys() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/models/claude.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const claudeModule = await importClaudeWithoutKeys();
const U = await loadSrc('src/agent/cost/usage_context.js');

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const TURNS = [{ role: 'user', content: 'steve: hello' }];

// A Claude adapter without the constructor. `respond(request)` plays messages.create.
function fakeClaude(respond, modelName = 'claude-haiku-4-5-20251001') {
    const requests = [];
    const adapter = Object.create(claudeModule.Claude.prototype);
    adapter.model_name = modelName;
    adapter.params = {};
    adapter.anthropic = {
        messages: {
            async create(request) {
                requests.push(request);
                return respond(request);
            },
        },
    };
    return { adapter, requests };
}

const textResponse = (usage) => ({
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: 'Hi! !stats' }],
    ...(usage === undefined ? {} : { usage }),
});

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

describe('Claude adapter and the cost meter', () => {
    test('claude.js imports reportUsage from src/agent/cost/usage_context.js', () => {
        const source = fs.readFileSync(repoPath('src/models/claude.js'), 'utf8');
        assert.match(source, /^import \{ reportUsage \} from '\.\.\/agent\/cost\/usage_context\.js';\r?$/m);
    });

    test('a successful request reports the model, the four token counts and the purpose', async () => {
        const { adapter, requests } = fakeClaude(() => textResponse({
            input_tokens: 1234,
            output_tokens: 56,
            cache_read_input_tokens: 700,
            cache_creation_input_tokens: 80,
        }));
        const text = await U.withPurpose('chat', () => adapter.sendRequest(TURNS, 'system prompt'));
        assert.equal(text, 'Hi! !stats');
        assert.equal(requests.length, 1);
        assert.equal(reports.length, 1);
        const [r] = reports;
        assert.equal(r.model, 'claude-haiku-4-5-20251001');
        assert.equal(r.input_tokens, 1234);
        assert.equal(r.output_tokens, 56);
        assert.equal(r.cache_read_tokens, 700);
        assert.equal(r.cache_write_tokens, 80);
        assert.equal(r.purpose, 'chat');
        assert.equal(typeof r.time, 'number');
    });

    test('cache counts that the API sends as null count as 0', async () => {
        const { adapter } = fakeClaude(() => textResponse({
            input_tokens: 10, output_tokens: 2, cache_read_input_tokens: null, cache_creation_input_tokens: null,
        }));
        await adapter.sendRequest(TURNS, 'sys');
        assert.deepEqual(
            [reports[0].input_tokens, reports[0].output_tokens, reports[0].cache_read_tokens, reports[0].cache_write_tokens],
            [10, 2, 0, 0],
        );
        assert.equal(reports[0].purpose, 'other', 'outside of withPurpose');
    });

    test('a response without usage reports zeros', async () => {
        const { adapter } = fakeClaude(() => textResponse(undefined));
        assert.equal(await adapter.sendRequest(TURNS, 'sys'), 'Hi! !stats');
        assert.equal(reports.length, 1);
        assert.deepEqual(
            [reports[0].input_tokens, reports[0].output_tokens, reports[0].cache_read_tokens, reports[0].cache_write_tokens],
            [0, 0, 0, 0],
        );
        assert.equal(reports[0].model, 'claude-haiku-4-5-20251001');
    });

    test('a response without text content is still a successful request and is reported', async () => {
        const { adapter } = fakeClaude(() => ({ content: [], usage: { input_tokens: 5, output_tokens: 0 } }));
        assert.equal(await adapter.sendRequest(TURNS, 'sys'), 'No response from Claude.');
        assert.equal(reports.length, 1);
        assert.equal(reports[0].input_tokens, 5);
    });

    test('a failed request reports nothing', async () => {
        const { adapter } = fakeClaude(() => { throw new Error('529 overloaded'); });
        assert.equal(await U.withPurpose('coding', () => adapter.sendRequest(TURNS, 'sys')), 'My brain disconnected, try again.');
        assert.deepEqual(reports, []);
    });

    test('without a model name the model of the request is reported', async () => {
        const { adapter, requests } = fakeClaude(() => textResponse({ input_tokens: 1, output_tokens: 1 }), null);
        await adapter.sendRequest(TURNS, 'sys');
        assert.equal(requests[0].model, DEFAULT_MODEL);
        assert.equal(reports[0].model, DEFAULT_MODEL);
    });

    test('a vision request is reported once, with the purpose vision', async () => {
        const { adapter, requests } = fakeClaude(() => textResponse({ input_tokens: 1500, output_tokens: 40 }));
        await U.withPurpose('vision', () => adapter.sendVisionRequest(TURNS, 'describe', Buffer.from('jpeg')));
        assert.equal(requests.length, 1);
        assert.equal(reports.length, 1);
        assert.equal(reports[0].purpose, 'vision');
        assert.equal(reports[0].input_tokens, 1500);
    });

    test('an image error of the API reports nothing and gives the vision text', async () => {
        const { adapter } = fakeClaude(() => { throw new Error('This model does not support image input.'); });
        assert.equal(await adapter.sendVisionRequest(TURNS, 'describe', Buffer.from('jpeg')), 'Vision is only supported by certain models.');
        assert.deepEqual(reports, []);
    });

    test('with a thinking budget max_tokens is the budget plus 1000, and usage is still reported', async () => {
        const { adapter, requests } = fakeClaude(() => textResponse({ input_tokens: 3, output_tokens: 4 }));
        adapter.params = { thinking: { type: 'enabled', budget_tokens: 2000 } };
        await adapter.sendRequest(TURNS, 'sys');
        assert.equal(requests[0].max_tokens, 3000);
        assert.equal(reports.length, 1);
    });

    test('embed is not supported and reports nothing', async () => {
        const { adapter } = fakeClaude(() => textResponse({}));
        await assert.rejects(adapter.embed('text'), /not supported/);
        assert.deepEqual(reports, []);
    });

    test('two requests at the same time report their own purposes', async () => {
        // No timers (Amendment 2, I2): the slow request waits for a gate that opens only after the
        // fast one has ended, so the order does not depend on the load of the machine.
        let open;
        const gate = new Promise((resolve) => { open = resolve; });
        let slowStarted = false;
        const { adapter } = fakeClaude(async (request) => {
            if (request.system === 'slow') {
                slowStarted = true;
                await gate;
            }
            return textResponse({ input_tokens: request.system === 'slow' ? 1 : 2, output_tokens: 0 });
        });
        const slow = U.withPurpose('coding', () => adapter.sendRequest(TURNS, 'slow'));
        await U.withPurpose('memory', () => adapter.sendRequest(TURNS, 'fast'));
        assert.equal(slowStarted, true, 'the slow request was in flight while the fast one ended');
        open();
        await slow;
        assert.deepEqual(reports.map((r) => [r.input_tokens, r.purpose]), [[2, 'memory'], [1, 'coding']]);
    });
});

// The constructor reads the key with getKey. Without keys.json (the import ran in an empty
// directory) and without the environment variable it throws. With a placeholder in the
// environment it builds the SDK client, which sends nothing when it is created; its
// messages.create is replaced before any request, and its base URL points at 127.0.0.1.
describe('Claude constructor', () => {
    const KEY = 'ANTHROPIC_API_KEY';
    function withKeyEnv(value, fn) {
        const had = Object.prototype.hasOwnProperty.call(process.env, KEY);
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
            assert.throws(() => new claudeModule.Claude('claude-haiku-4-5', null, {}), /API key "ANTHROPIC_API_KEY" not found/);
        });
    });

    test('an adapter built by the constructor reports the usage of a successful request', async () => {
        const adapter = withKeyEnv('placeholder-not-a-key', () => new claudeModule.Claude('claude-opus-5-5', 'http://127.0.0.1:9', { max_tokens: 100 }));
        assert.equal(adapter.model_name, 'claude-opus-5-5');
        assert.deepEqual(adapter.params, { max_tokens: 100 });
        const requests = [];
        adapter.anthropic.messages.create = async (request) => {
            requests.push(request);
            return textResponse({ input_tokens: 9, output_tokens: 8, cache_read_input_tokens: 7, cache_creation_input_tokens: 6 });
        };
        assert.equal(await U.withPurpose('goal_setting', () => adapter.sendRequest(TURNS, 'sys')), 'Hi! !stats');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].max_tokens, 100);
        assert.deepEqual(reports.map((r) => [r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens, r.purpose]),
            [['claude-opus-5-5', 9, 8, 7, 6, 'goal_setting']]);
    });
});
