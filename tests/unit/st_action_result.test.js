// T1, spec v0.1.4.8 section 5 (part A) and the interface I5, tested from the spec and the handoff:
//   I5 / A4 a stopped action returns its output so far and `stopped_by` (the reflex <mode>, the command
//      !<name>, !stop, a new message); the first stopper counts (handoff);
//   A5 a newer command ends an older resume; an action of a mode does not;
//   A6 the wait for the code model ends on bot.interrupt_code (polled every 200 ms), the late answer is
//      dropped and no code of it runs; the action reports interrupted.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const am = await loadSrc('src/agent/action_manager.js');

// coder.js is imported in an empty folder, quietly (it has no side effect we want here)
async function loadCoder() {
    const cwd = process.cwd();
    const empty = makeTmpDir();
    const cap = captureConsole();
    process.chdir(empty);
    try {
        return await loadSrc('src/agent/coder.js');
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
}
const coderMod = await loadCoder();
await import('ses'); // the global assert of the agent process, for resume actions

const LIMIT = { timeout: 20000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeAgent() {
    const bot = { output: '', interrupt_code: false, emit() {} };
    const agent = {
        bot,
        kills: [],
        interrupts: [],
        requestInterrupt(by) { agent.interrupts.push(by); bot.interrupt_code = true; },
        clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
        cleanKill(msg) { agent.kills.push(msg); },
        isIdle: () => !agent.actions.executing,
        self_prompter: { isActive: () => false },
        history: { add() {} },
    };
    agent.actions = new am.ActionManager(agent);
    return agent;
}

// A command that writes some output and then runs until it is interrupted.
function longCommand(agent, label, lines = ['I cut 3 oak_log.']) {
    return agent.actions.runAction(label, async () => {
        for (const line of lines) agent.bot.output += line + '\n';
        while (!agent.bot.interrupt_code) await sleep(5);
    });
}

async function quiet(fn) {
    const cap = captureConsole();
    try {
        return await fn();
    } finally {
        cap.restore();
    }
}

describe('I5, A4: the result of a stopped action', () => {
    test('stopped by a newer command: { success, message, interrupted: true, timedout, stopped_by: "the command !<name>" }, with the output so far', LIMIT, () => quiet(async () => {
        const agent = fakeAgent();
        const running = longCommand(agent, 'action:chopTrees');
        await sleep(20);
        const next = agent.actions.runAction('action:mineOre', async () => {});
        const r = await running;
        await next;
        assert.equal(r.interrupted, true);
        assert.equal(r.stopped_by, 'the command !mineOre');
        assert.equal(r.timedout, false);
        assert.equal(typeof r.success, 'boolean');
        assert.equal(r.message, 'Action output:\nI cut 3 oak_log.\n', 'not empty: the output so far');
        assert.deepEqual(agent.kills, []);
    }));

    test('stopped by a reflex: "the reflex <mode name>"', LIMIT, () => quiet(async () => {
        const agent = fakeAgent();
        const running = longCommand(agent, 'action:mineOre', ['I dug 2 blocks.']);
        await sleep(20);
        const mode = agent.actions.runAction('mode:unstuck', async () => {});
        const r = await running;
        await mode;
        assert.equal(r.stopped_by, 'the reflex unstuck');
        assert.equal(r.message, 'Action output:\nI dug 2 blocks.\n');
    }));

    test('stopped by !stop and by a new message', LIMIT, () => quiet(async () => {
        for (const by of ['!stop', 'a new message']) {
            const agent = fakeAgent();
            const running = longCommand(agent, 'action:goToCoordinates');
            await sleep(20);
            await agent.actions.stop(by);
            const r = await running;
            assert.equal(r.interrupted, true);
            assert.equal(r.stopped_by, by);
            assert.ok(r.message.includes('I cut 3 oak_log.'));
            assert.ok(agent.interrupts.includes(by), 'requestInterrupt(by) gets who stops');
        }
    }));

    test('the first stopper counts (handoff)', LIMIT, () => quiet(async () => {
        const agent = fakeAgent();
        const running = longCommand(agent, 'action:mineOre');
        await sleep(20);
        agent.actions.noteStop('a new message');
        await agent.actions.stop('!stop');
        const r = await running;
        assert.equal(r.stopped_by, 'a new message');
    }));

    test('an action that was not stopped has no stopped_by', LIMIT, () => quiet(async () => {
        const agent = fakeAgent();
        const r = await agent.actions.runAction('action:stats', async () => { agent.bot.output += 'ok\n'; });
        assert.equal(r.interrupted, false);
        assert.equal(r.stopped_by, undefined);
        assert.equal(r.message, 'Action output:\nok\n');
    }));

    test('a stopped action with a long output: whole lines from the start and the end, at most 1500 characters of them', LIMIT, () => quiet(async () => {
        const agent = fakeAgent();
        const lines = Array.from({ length: 100 }, (_, i) => `Step ${i}: I dug a block at (${i}, 40, 12) and it dropped cobblestone.`);
        const running = longCommand(agent, 'action:mineOre', lines);
        await sleep(20);
        await agent.actions.stop('!stop');
        const r = await running;
        const kept = r.message.split('\n').filter((l) => l.startsWith('Step '));
        for (const line of kept) assert.ok(lines.includes(line), `whole: ${line}`);
        assert.ok(kept.includes(lines[0]) && kept.includes(lines[99]));
        assert.ok(kept.reduce((n, l) => n + l.length + 1, 0) <= 1500);
    }));
});

describe('A5: a newer command ends an older resume', () => {
    test('a command with resume false cancels the resume function', LIMIT, () => quiet(async () => {
        const agent = fakeAgent();
        const follow = agent.actions.runAction('action:followPlayer', async () => {
            while (!agent.bot.interrupt_code) await sleep(5);
        }, { resume: true });
        await sleep(20);
        assert.ok(agent.actions.resume_func, 'the follow is a resume');
        await agent.actions.runAction('action:storeItems', async () => {});
        await follow;
        assert.equal(agent.actions.resume_func, null);
    }));

    test('an action that a mode starts does not cancel it', LIMIT, () => quiet(async () => {
        const agent = fakeAgent();
        const follow = agent.actions.runAction('action:followPlayer', async () => {
            while (!agent.bot.interrupt_code) await sleep(5);
        }, { resume: true });
        await sleep(20);
        await agent.actions.runAction('mode:self_defense', async () => {});
        await follow;
        assert.ok(agent.actions.resume_func, 'the follow resumes after the reflex');
    }));
});

describe('A6: code generation can be stopped', () => {
    function coderThis(answer) {
        const bot = { output: '', interrupt_code: false, modes: { pause() {} } };
        const staged = [];
        const that = {
            agent: {
                bot,
                prompter: { promptCoding: () => answer() },
                actions: { getBotOutputSummary: () => 'Action output:\n' + bot.output },
            },
            file_counter: 0,
            last_run: null,
            _sanitizeCode: (c) => c,
            async _stageCode(code) {
                staged.push(code);
                return { func: { main: async () => { bot.output += 'the code ran\n'; } }, src_lint_copy: code };
            },
            async _lintCode() { return null; },
        };
        const history = { getHistory: () => [{ role: 'user', content: 'steve: dig a tunnel' }] };
        return { bot, staged, generate: () => coderMod.Coder.prototype.generateCode.call(that, history) };
    }

    test('an interrupt during the wait for the model ends it within about 200 ms; the late answer is dropped, no code runs', LIMIT, () => quiet(async () => {
        let deliver;
        const c = coderThis(() => new Promise((resolve) => { deliver = resolve; }));
        const running = c.generate();
        await sleep(50);
        const t0 = Date.now();
        c.bot.interrupt_code = true;
        const result = await running;
        const took = Date.now() - t0;
        assert.ok(took < 600, `${took} ms`);
        assert.equal(result, null);
        deliver('```js\nawait skills.digDown(bot, 20);\n```');
        await sleep(50);
        assert.deepEqual(c.staged, [], 'no code of the dropped answer is staged');
        assert.ok(!c.bot.output.includes('the code ran'));
    }));

    test('in the action manager the stopped code generation reports interrupted', LIMIT, () => quiet(async () => {
        const agent = fakeAgent();
        const c = coderThis(() => new Promise(() => {}));
        c.bot.modes = { pause() {} };
        // the coder and the action share the bot, as in the agent
        const shared = agent.bot;
        Object.defineProperty(c.bot, 'interrupt_code', { get: () => shared.interrupt_code, set: (v) => { shared.interrupt_code = v; } });
        const running = agent.actions.runAction('action:newAction', async () => {
            const code = await c.generate();
            if (code) agent.bot.output += code;
        });
        await sleep(50);
        const t0 = Date.now();
        await agent.actions.stop('!stop');
        const r = await running;
        assert.ok(Date.now() - t0 < 1500, 'no refused stop');
        assert.equal(r.interrupted, true);
        assert.equal(r.stopped_by, '!stop');
        assert.deepEqual(agent.kills, []);
    }));
});
