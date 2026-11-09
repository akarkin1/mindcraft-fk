// Tests from the spec v0.1.4.14 (tester T1, round 2): SPEC 4.9, the chat model Claude Haiku 5.5 (part H, HANDOFF part H).
//   describe 'SPEC 4.9 the profile and the price' : profiles/claude.json `model` deep-equals the object of the handoff;
//                                                   price_table.js has the row 0.1 / 0.5 for claude-haiku-5-5.
//   describe 'SPEC 4.9 claude.js'                 : the adapter made from that profile (selectAPI, createModel) passes its
//                                                   params through to messages.create (output_config, max_tokens 4096) and
//                                                   reads the answer by block type: a thinking block is skipped, the text
//                                                   block is the answer.
// No key and no network: the modules are imported with the working directory set to an empty temp directory (keys.js reads
// ./keys.json at import time, which must never be the real one); the key is a placeholder for the constructor only, and
// messages.create is a fake.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const MODEL = { model: 'claude-haiku-5-5', params: { max_tokens: 4096, output_config: { effort: 'low' } } };
const profile = () => JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));

let MM;
let U;
let P;
let savedKey;
let hadKey;

before(async () => {
    const cwd = process.cwd();
    const empty = makeTmpDir();
    const cap = captureConsole();
    process.chdir(empty);
    try {
        MM = await loadSrc('src/models/_model_map.js');
        U = await loadSrc('src/agent/cost/usage_context.js');
        P = await loadSrc('src/agent/cost/price_table.js');
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
    hadKey = Object.prototype.hasOwnProperty.call(process.env, 'ANTHROPIC_API_KEY');
    savedKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'placeholder-not-a-key'; // the constructor only; no request leaves the process
});

after(() => {
    if (hadKey) process.env.ANTHROPIC_API_KEY = savedKey;
    else delete process.env.ANTHROPIC_API_KEY;
    U?.setUsageSink?.(null);
});

describe('SPEC 4.9 the profile and the price', () => {
    test('profiles/claude.json: model is the object of the handoff', () => {
        assert.deepEqual(profile().model, MODEL);
    });

    test('price_table.js: claude-haiku-5-5 at 0.1 input and 0.5 output', () => {
        assert.deepEqual({ ...P.DEFAULT_PRICES['claude-haiku-5-5'] }, { input: 0.1, output: 0.5 });
        const price = P.priceFor('claude-haiku-5-5');
        assert.deepEqual({ input: price.input, output: price.output }, { input: 0.1, output: 0.5 }, 'priceFor (it adds the cache rates)');
    });
});

describe('SPEC 4.9 claude.js', () => {
    function adapter(content) {
        const cap = captureConsole();
        try {
            const model = MM.createModel(MM.selectAPI(structuredClone(profile().model)));
            const requests = [];
            model.anthropic = { messages: { async create(request) { requests.push(structuredClone(request)); return { content, usage: { input_tokens: 10, output_tokens: 20 } }; } } };
            return { model, requests };
        } finally {
            cap.restore();
        }
    }

    async function ask(model) {
        U.setUsageSink(() => {});
        const cap = captureConsole();
        try {
            return await model.sendRequest([{ role: 'user', content: 'steve: hi' }], 'You are a bot.');
        } finally {
            cap.restore();
            U.setUsageSink(null);
        }
    }

    test('the profile makes an anthropic adapter for claude-haiku-5-5 with the params of the profile', () => {
        const { model } = adapter([]);
        assert.equal(model.constructor.prefix, 'anthropic');
        assert.equal(model.model_name, 'claude-haiku-5-5');
        assert.deepEqual(model.params, MODEL.params);
    });

    test('the params reach messages.create as they are: output_config and max_tokens 4096', async () => {
        const { model, requests } = adapter([{ type: 'text', text: 'Hello!' }]);
        assert.equal(await ask(model), 'Hello!');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].model, 'claude-haiku-5-5');
        assert.deepEqual(requests[0].output_config, { effort: 'low' });
        assert.equal(requests[0].max_tokens, 4096);
        assert.equal(requests[0].system, 'You are a bot.');
    });

    test('a thinking block before the text is skipped: the answer is the text block', async () => {
        const { model } = adapter([
            { type: 'thinking', thinking: 'The player greets me. !stats would be wrong.', signature: 'sig' },
            { type: 'text', text: 'Hi steve!' },
        ]);
        assert.equal(await ask(model), 'Hi steve!');
    });

    test('a redacted thinking block too; only thinking: no text is invented from it', async () => {
        const redacted = adapter([{ type: 'redacted_thinking', data: 'xyz' }, { type: 'text', text: 'On my way.' }]);
        assert.equal(await ask(redacted.model), 'On my way.');
        const only = adapter([{ type: 'thinking', thinking: '!goToPlayer("steve")', signature: 's' }]);
        const answer = await ask(only.model);
        assert.ok(!answer.includes('!goToPlayer'), answer);
    });
});
