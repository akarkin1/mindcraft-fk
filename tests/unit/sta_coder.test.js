// Spec v0.1.4.8, part A, A6 (S10): the wait of Coder.generateCode for the code model can be stopped. The
// wait ends when bot.interrupt_code is set (read every 200 ms); the late answer is dropped and no code of
// it runs; generateCode returns null, so !newAction reports interrupted as for other interrupts.
//
// Coder.prototype.generateCode runs with a fake `this`, as in sandbox.test.js: a fake prompter, the real
// _stageCode and _sanitizeCode (the real makeCompartment WITHOUT lockdown), _lintCode that finds nothing.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function loadCoder() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/agent/coder.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { Coder } = await loadCoder();
const EXEC_TEMPLATE = fs.readFileSync(repoPath('bots/execTemplate.js'), 'utf8');
const LINT_TEMPLATE = fs.readFileSync(repoPath('bots/lintTemplate.js'), 'utf8');
const GOOD = '```js\nlog(bot, "done");\n```';
const LIMIT = { timeout: 30000 }; // a test that waits in vain fails instead of holding the run
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// promptCoding(messages) of the fake prompter is `answer`; the fake records staged code.
function makeCoder(answer) {
    const bot = { output: '', interrupt_code: false, modes: { pause() {} } };
    const staged = [];
    const prompts = [];
    const fake = {
        agent: {
            bot,
            skill_manager: undefined,
            prompter: {
                promptCoding(messages) {
                    prompts.push(messages);
                    return answer(prompts.length);
                },
            },
            actions: { getBotOutputSummary: () => 'Action output:\n' + bot.output },
        },
        code_template: EXEC_TEMPLATE,
        code_lint_template: LINT_TEMPLATE,
        file_counter: 0,
        fp: '/bots/andy/action-code/',
        last_run: null,
        _sanitizeCode: Coder.prototype._sanitizeCode,
        async _stageCode(code) {
            staged.push(code);
            return Coder.prototype._stageCode.call(this, code);
        },
        async _lintCode() {
            return null;
        },
        async _writeFilePromise() {},
    };
    const history = { getHistory: () => [{ role: 'user', content: 'steve: say done' }] };
    return { fake, bot, staged, prompts, generate: () => Coder.prototype.generateCode.call(fake, history) };
}

describe('generateCode: the wait for the code model (A6)', () => {
    test('an interrupt during the wait ends it within about 200 ms; the late answer is dropped, no code runs', LIMIT, async () => {
        let deliver;
        const c = makeCoder(() => new Promise((resolve) => { deliver = resolve; }));
        const cap = captureConsole();
        try {
            const started = Date.now();
            const running = c.generate();
            await sleep(50);
            c.bot.interrupt_code = true; // requestInterrupt of !stop or a newer action
            const result = await running;
            const took = Date.now() - started;
            assert.equal(result, null, 'as for other interrupts');
            assert.ok(took < 800, `${took} ms`);
            deliver(GOOD); // the model answers late
            await sleep(30);
            assert.deepEqual(c.staged, [], 'no code of the dropped answer is staged');
            assert.equal(c.bot.output, '', 'no code ran');
            assert.equal(c.prompts.length, 1, 'no second call of the model');
        } finally {
            cap.restore();
        }
    });

    test('a late rejection of the model is no unhandled rejection', LIMIT, async () => {
        let fail;
        const c = makeCoder(() => new Promise((_, reject) => { fail = reject; }));
        const unhandled = [];
        const onUnhandled = (reason) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        const cap = captureConsole();
        try {
            const running = c.generate();
            await sleep(20);
            c.bot.interrupt_code = true;
            assert.equal(await running, null);
            fail(new Error('network'));
            await sleep(30);
            assert.deepEqual(unhandled, []);
        } finally {
            process.off('unhandledRejection', onUnhandled);
            cap.restore();
        }
    });

    test('interrupted before the call: the model is not asked', LIMIT, async () => {
        const c = makeCoder(async () => GOOD);
        c.bot.interrupt_code = true;
        assert.equal(await c.generate(), null);
        assert.equal(c.prompts.length, 0);
    });

    test('no interrupt: the answer is used as before, one call of the model', LIMIT, async () => {
        const c = makeCoder(async () => {
            await sleep(250); // longer than one poll
            return GOOD;
        });
        const cap = captureConsole();
        try {
            const result = await c.generate();
            assert.equal(c.prompts.length, 1);
            assert.equal(c.staged.length, 1);
            assert.ok(result.startsWith('Agent wrote this code: \n```'), result);
            assert.ok(result.includes('done'), result);
        } finally {
            cap.restore();
        }
    });

    test('an error of the model is thrown on as before (!newAction reports it)', LIMIT, async () => {
        const error = new Error('model down');
        const c = makeCoder(async () => { throw error; });
        await assert.rejects(c.generate(), (err) => err === error);
    });

    test('source: the wait uses withTimeLimit with the interrupt of the bot, every 200 ms', LIMIT, () => {
        const src = fs.readFileSync(repoPath('src/agent/coder.js'), 'utf8');
        assert.match(src, /import \{ withTimeLimit \} from '\.\.\/utils\/kill_timer\.js';/);
        assert.match(src, /const MODEL_POLL_MS = 200;/);
        assert.match(src, /until: \(\) => this\.agent\.bot\.interrupt_code, pollMs: MODEL_POLL_MS/);
    });
});
