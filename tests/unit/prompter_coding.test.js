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

// Spec v0.1.4.4, Amendment 1, A6: the placeholder $CUSTOM_SKILLS in promptCoding, promptConvo
// and replaceStrings. Without a manager a prompt WITHOUT the placeholder is not touched at all
// (flag rule: the default prompts stay byte for byte as in v0.1.4.3); a prompt WITH it gets it
// removed. With a manager the section of the manager is inserted.
describe('A6: the placeholder $CUSTOM_SKILLS', () => {
    const promptConvo = (fake, messages) => prompterModule.Prompter.prototype.promptConvo.call(fake, messages);
    const replaceStrings = (fake, ...args) => prompterModule.Prompter.prototype.replaceStrings.call(fake, ...args);
    const WITH_PLACEHOLDER = 'Intro\n$CUSTOM_SKILLS\nConversation Begin:';
    const WITHOUT_PLACEHOLDER = 'Intro $& $1 $$\nConversation Begin:';
    const REPLY = 'Hello there.';

    // A fake Prompter for promptCoding and promptConvo; replaceStrings returns `replaced`.
    function makePromptFake(replaced, agent) {
        const fake = makeFake();
        fake.replaceStrings = async (...args) => {
            fake.calls.push({ name: 'replaceStrings', args });
            return replaced;
        };
        fake.profile.conversing = 'CONVERSING PROMPT';
        fake.convo_examples = { name: 'convo examples object' };
        fake.most_recent_msg_time = 0;
        fake.chat_model = {
            async sendRequest(...args) {
                fake.calls.push({ name: 'chatRequest', args });
                return REPLY;
            },
        };
        if (agent !== undefined) fake.agent = agent;
        return fake;
    }
    const sentPrompt = (fake, name) => fake.calls.find((c) => c.name === name).args[1];
    const loggedPrompt = (fake) => fake.calls.find((c) => c.name === '_saveLog').args[0];

    const PROMPTS = [
        ['promptCoding', (fake) => promptCoding(fake, MESSAGES), 'sendRequest', RESPONSE],
        ['promptConvo', (fake) => promptConvo(fake, MESSAGES), 'chatRequest', REPLY],
    ];
    const NO_MANAGER = [['no agent', undefined], ['an agent without skill_manager', { name: 'andy' }], ['skill_manager undefined', { name: 'andy', skill_manager: undefined }]];

    for (const [method, call, request, reply] of PROMPTS) {
        for (const [label, agent] of NO_MANAGER) {
            test(`${method}, ${label}: a prompt without the placeholder is sent exactly as replaceStrings returned it`, async () => {
                const fake = makePromptFake(WITHOUT_PLACEHOLDER, agent);
                assert.equal(await quiet(() => call(fake)), reply);
                assert.equal(sentPrompt(fake, request), WITHOUT_PLACEHOLDER);
                assert.equal(loggedPrompt(fake), WITHOUT_PLACEHOLDER);
            });

            test(`${method}, ${label}: a prompt with the placeholder gets it removed`, async () => {
                const fake = makePromptFake(WITH_PLACEHOLDER + ' $CUSTOM_SKILLS', agent);
                await quiet(() => call(fake));
                assert.equal(sentPrompt(fake, request), 'Intro\n\nConversation Begin: ');
                assert.equal(loggedPrompt(fake), 'Intro\n\nConversation Begin: ');
            });
        }
    }

    test('promptCoding with a manager: the coding section of the task replaces the placeholder', async () => {
        const tasks = [];
        const manager = {
            codingSection: (task) => {
                tasks.push(task);
                return 'SECTION $& $1';
            },
        };
        const fake = makePromptFake(WITH_PLACEHOLDER, { name: 'andy', skill_manager: manager });
        const messages = [{ role: 'user', content: 'steve: build a wall' }, { role: 'assistant', content: '!newAction("Build a wall of 3 blocks")' }];
        await quiet(() => promptCoding(fake, messages));
        assert.deepEqual(tasks, ['Build a wall of 3 blocks']);
        assert.equal(sentPrompt(fake, 'sendRequest'), 'Intro\nSECTION $& $1\nConversation Begin:');
    });

    test('promptConvo with a manager: the conversing section replaces the placeholder, or goes before the Conversation line', async () => {
        const manager = { conversingSection: () => 'SECTION' };
        const withPlaceholder = makePromptFake(WITH_PLACEHOLDER, { name: 'andy', skill_manager: manager });
        await quiet(() => promptConvo(withPlaceholder, MESSAGES));
        assert.equal(sentPrompt(withPlaceholder, 'chatRequest'), 'Intro\nSECTION\nConversation Begin:');
        const without = makePromptFake('Intro\nConversation Begin:', { name: 'andy', skill_manager: manager });
        await quiet(() => promptConvo(without, MESSAGES));
        assert.equal(sentPrompt(without, 'chatRequest'), 'Intro\nSECTION\nConversation Begin:');
    });

    test('a manager with an empty section: the placeholder is removed, a prompt without it is unchanged', async () => {
        const manager = { codingSection: () => '', conversingSection: () => '' };
        for (const [method, call, request] of PROMPTS) {
            const fake = makePromptFake(WITH_PLACEHOLDER, { name: 'andy', skill_manager: manager });
            await quiet(() => call(fake));
            assert.equal(sentPrompt(fake, request), 'Intro\n\nConversation Begin:', method);
            const plain = makePromptFake(WITHOUT_PLACEHOLDER, { name: 'andy', skill_manager: manager });
            await quiet(() => call(plain));
            assert.equal(sentPrompt(plain, request), WITHOUT_PLACEHOLDER, method);
        }
    });

    test('a manager that throws: a warning, and the prompt of v0.1.4.3 is used', async () => {
        const broken = () => {
            throw new Error('broken manager');
        };
        const manager = { codingSection: broken, conversingSection: broken };
        for (const [method, call, request, reply] of PROMPTS) {
            const fake = makePromptFake(WITHOUT_PLACEHOLDER, { name: 'andy', skill_manager: manager });
            const cap = captureConsole();
            let result;
            try {
                result = await call(fake);
            } finally {
                cap.restore();
            }
            assert.equal(result, reply, method);
            assert.equal(sentPrompt(fake, request), WITHOUT_PLACEHOLDER, method);
            assert.ok(cap.of('warn').some((r) => r.text.includes('broken manager')), method);
        }
    });

    describe('replaceStrings', () => {
        const replaceWarnings = async (prompt) => {
            const cap = captureConsole();
            try {
                const result = await replaceStrings({ agent: { name: 'andy' } }, prompt, MESSAGES);
                return { result, warnings: cap.of('warn').map((r) => r.text) };
            } finally {
                cap.restore();
            }
        };

        test('$CUSTOM_SKILLS is not reported as an unknown placeholder and stays in the prompt for the caller', async () => {
            const { result, warnings } = await replaceWarnings('I am $NAME.\n$CUSTOM_SKILLS\n$CUSTOM_SKILLS');
            assert.equal(result, 'I am andy.\n$CUSTOM_SKILLS\n$CUSTOM_SKILLS');
            assert.deepEqual(warnings, []);
        });

        test('other unknown placeholders are still reported, also names that only start with CUSTOM_SKILLS', async () => {
            const { warnings } = await replaceWarnings('$CUSTOM_SKILLS $FOO $CUSTOM_SKILLSX $CUSTOM_SKILLS_2');
            assert.equal(warnings.length, 1, JSON.stringify(warnings));
            assert.ok(warnings[0].includes('$FOO, $CUSTOM_SKILLSX, $CUSTOM_SKILLS_'), warnings[0]);
            assert.ok(!/\$CUSTOM_SKILLS(,|$)/.test(warnings[0]), warnings[0]);
        });

        test('a prompt without unknown placeholders gives no warning (unchanged behaviour)', async () => {
            assert.deepEqual((await replaceWarnings('Plain prompt of $NAME.')).warnings, []);
        });
    });
});
