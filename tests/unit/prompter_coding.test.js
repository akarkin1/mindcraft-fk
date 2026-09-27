// Spec S6: src/models/prompter.js, Prompter.prototype.promptCoding(messages).
//
// No real Prompter is constructed. promptCoding is called with a fake `this` that provides
// awaiting_coding, checkCooldown, profile.coding, coding_examples, replaceStrings,
// code_model.sendRequest and _saveLog.
//
// Importing prompter.js loads src/utils/keys.js, which reads './keys.json' relative to the
// working directory at import time. The import therefore runs with the working directory
// set to an empty temp directory, so the real keys.json is never read.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importPrompterWithoutKeys() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/models/prompter.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const prompterModule = await importPrompterWithoutKeys();
const promptCoding = (fake, messages) => prompterModule.Prompter.prototype.promptCoding.call(fake, messages);

const STUB = '```//no response```';
const RESPONSE = '```js\nawait skills.wait(bot, 1);\n```';
const REPLACED = 'REPLACED CODING PROMPT';
const MESSAGES = [{ role: 'user', content: 'steve: build a wall' }];

function makeFake() {
    const calls = [];
    const fake = {
        awaiting_coding: false,
        profile: { coding: 'CODING PROMPT $CODE_DOCS $EXAMPLES' },
        coding_examples: { name: 'coding examples object' },
        calls,
        async checkCooldown() {
            calls.push({ name: 'checkCooldown', awaiting: fake.awaiting_coding, args: [] });
        },
        async replaceStrings(...args) {
            calls.push({ name: 'replaceStrings', awaiting: fake.awaiting_coding, args });
            return REPLACED;
        },
        code_model: {
            async sendRequest(...args) {
                calls.push({ name: 'sendRequest', awaiting: fake.awaiting_coding, args });
                return RESPONSE;
            },
        },
        async _saveLog(...args) {
            calls.push({ name: '_saveLog', awaiting: fake.awaiting_coding, args });
        },
    };
    return fake;
}

const quiet = async (fn) => {
    const cap = captureConsole();
    try {
        return await fn();
    } finally {
        cap.restore();
    }
};

describe('promptCoding: normal call (unchanged behaviour)', () => {
    test('returns the model response and calls the collaborators in order with the same arguments as today', async () => {
        const fake = makeFake();
        const result = await quiet(() => promptCoding(fake, MESSAGES));
        assert.equal(result, RESPONSE);
        assert.deepEqual(fake.calls.map((c) => c.name), ['checkCooldown', 'replaceStrings', 'sendRequest', '_saveLog']);

        const [, replace, send, save] = fake.calls;
        assert.equal(replace.args[0], fake.profile.coding);
        assert.equal(replace.args[1], MESSAGES);
        assert.equal(replace.args[2], fake.coding_examples);
        assert.equal(send.args[0], MESSAGES);
        assert.equal(send.args[1], REPLACED);
        assert.deepEqual(save.args, [REPLACED, MESSAGES, RESPONSE, 'coding']);
    });

    test('awaiting_coding is true while waiting for cooldown, prompt and model, and false afterwards', async () => {
        const fake = makeFake();
        await quiet(() => promptCoding(fake, MESSAGES));
        for (const c of fake.calls.filter((x) => x.name !== '_saveLog')) assert.equal(c.awaiting, true, c.name);
        assert.equal(fake.awaiting_coding, false);
    });
});

describe('promptCoding: re-entrancy', () => {
    test('already awaiting_coding: returns "```//no response```" and calls nothing', async () => {
        const fake = makeFake();
        fake.awaiting_coding = true;
        const result = await quiet(() => promptCoding(fake, MESSAGES));
        assert.equal(result, STUB);
        assert.deepEqual(fake.calls, []);
        assert.equal(fake.awaiting_coding, true, 'the running call still owns the flag');
    });

    test('a second call while the first one waits for the model gets the stub; the first one then completes', async () => {
        const fake = makeFake();
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        fake.code_model.sendRequest = async (...args) => {
            fake.calls.push({ name: 'sendRequest', awaiting: fake.awaiting_coding, args });
            await gate;
            return RESPONSE;
        };
        const cap = captureConsole();
        try {
            const first = promptCoding(fake, MESSAGES);
            // Let the first call reach sendRequest.
            await new Promise((resolve) => setImmediate(resolve)); // all pending microtasks have run
            assert.ok(fake.calls.some((c) => c.name === 'sendRequest'), 'first call is waiting for the model');
            assert.equal(await promptCoding(fake, MESSAGES), STUB);
            release();
            assert.equal(await first, RESPONSE);
        } finally {
            cap.restore();
        }
        assert.equal(fake.awaiting_coding, false);
        assert.equal(fake.calls.filter((c) => c.name === 'sendRequest').length, 1);
    });
});

describe('promptCoding: awaiting_coding is ALWAYS false afterwards and the error is rethrown unchanged', () => {
    const COLLABORATORS = ['checkCooldown', 'replaceStrings', 'sendRequest', '_saveLog'];
    const ORDER = ['checkCooldown', 'replaceStrings', 'sendRequest', '_saveLog'];

    function breakCollaborator(fake, name, error, mode) {
        const failing = mode === 'rejects'
            ? async (...args) => {
                fake.calls.push({ name, awaiting: fake.awaiting_coding, args });
                throw error;
            }
            : (...args) => {
                fake.calls.push({ name, awaiting: fake.awaiting_coding, args });
                throw error;
            };
        if (name === 'sendRequest') fake.code_model.sendRequest = failing;
        else fake[name] = failing;
    }

    for (const name of COLLABORATORS) {
        for (const mode of ['rejects', 'throws synchronously']) {
            test(`${name} ${mode}: same error object rethrown, awaiting_coding false, next call works`, async () => {
                const fake = makeFake();
                const error = new Error(`${name} failed`);
                breakCollaborator(fake, name, error, mode);
                await quiet(() => assert.rejects(promptCoding(fake, MESSAGES), (e) => e === error));
                assert.equal(fake.awaiting_coding, false);

                // Nothing after the failing step runs (as today).
                const expectedNames = ORDER.slice(0, ORDER.indexOf(name) + 1);
                assert.deepEqual(fake.calls.map((c) => c.name), expectedNames);

                // The flag is not stuck: a following call does real work again.
                const healthy = makeFake();
                fake.checkCooldown = healthy.checkCooldown;
                fake.replaceStrings = healthy.replaceStrings;
                fake.code_model = healthy.code_model;
                fake._saveLog = healthy._saveLog;
                assert.equal(await quiet(() => promptCoding(fake, MESSAGES)), RESPONSE);
                assert.equal(fake.awaiting_coding, false);
            });
        }
    }

    test('a non-Error value thrown by sendRequest is rethrown unchanged too', async () => {
        const fake = makeFake();
        const thrown = { reason: 'plain object, not an Error' };
        fake.code_model.sendRequest = async () => {
            throw thrown;
        };
        await quiet(() => assert.rejects(promptCoding(fake, MESSAGES), (e) => e === thrown));
        assert.equal(fake.awaiting_coding, false);
    });
});
