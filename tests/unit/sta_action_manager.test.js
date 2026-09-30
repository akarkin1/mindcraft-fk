// Spec v0.1.4.8, part A, A4, A5 and I5: the action manager.
//   - outputSummary and stopperText of src/agent/reflex/output_logic.js (pure): MAX_OUT 1500, whole lines
//     from the start and from the end; who stopped, as a text;
//   - ActionManager: a stopped action returns its output so far and stopped_by ('the reflex <mode>',
//     'the command !<name>', '!stop', 'a new message'); stop(by) passes `by` to requestInterrupt; the
//     first stopper counts; a newer command (action:* with resume false) cancels the resume function, a
//     mode does not; command_serial counts the commands.
// The action manager runs with a fake agent, like in glue_agent.test.js. The real agent imports SES,
// which gives the global `assert` that _executeResume uses; this file imports it too.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

await import('ses'); // the global assert of the real agent process (lockdown.js imports ses)
const O = await loadSrc('src/agent/reflex/output_logic.js');
const { ActionManager } = await loadSrc('src/agent/action_manager.js');

const LIMIT = { timeout: 30000 }; // a test that waits in vain fails instead of holding the run
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('stopperText(by)', () => {
    test('the label of a mode, of a command, and the texts of the agent', LIMIT, () => {
        assert.equal(O.stopperText('mode:unstuck'), 'the reflex unstuck');
        assert.equal(O.stopperText('mode:self_preservation'), 'the reflex self_preservation');
        assert.equal(O.stopperText('action:mineOre'), 'the command !mineOre');
        assert.equal(O.stopperText('!stop'), '!stop');
        assert.equal(O.stopperText('a new message'), 'a new message');
        assert.equal(O.stopperText(''), null);
        assert.equal(O.stopperText(null), null);
        assert.equal(O.stopperText(undefined), null);
    });
});

describe('outputSummary(output, max)', () => {
    test('MAX_OUT is 1500', LIMIT, () => {
        assert.equal(O.MAX_OUT, 1500);
    });

    test('up to max characters: "Action output:" and the whole output', LIMIT, () => {
        assert.equal(O.outputSummary('Collected 3 oak_log.\n'), 'Action output:\nCollected 3 oak_log.\n');
        assert.equal(O.outputSummary(''), 'Action output:\n');
        assert.equal(O.outputSummary(undefined), 'Action output:\n');
        const exactly = 'x'.repeat(1500);
        assert.equal(O.outputSummary(exactly), 'Action output:\n' + exactly);
    });

    test('longer: whole lines from the start and from the end, never a cut line', LIMIT, () => {
        const lines = [];
        for (let i = 0; i < 100; i++) lines.push(`Line ${String(i).padStart(3, '0')} ${'.'.repeat(30)}`); // 39 characters
        const text = lines.join('\n') + '\n';
        const out = O.outputSummary(text);
        const [intro, rest] = out.split('\nFirst outputs:\n');
        assert.equal(intro, `Action output is very long (${text.length} chars) and has been shortened.`);
        const [first, last] = rest.split('\n...skipping many lines.\nFinal outputs:\n');
        const head = first.split('\n');
        const tail = last.split('\n');
        for (const line of [...head, ...tail]) assert.ok(lines.includes(line), `a whole line: "${line}"`);
        assert.equal(head[0], lines[0], 'from the first line');
        assert.equal(tail[tail.length - 1], lines[99], 'to the last line');
        assert.deepEqual(head, lines.slice(0, head.length), 'lines in order from the start');
        assert.deepEqual(tail, lines.slice(100 - tail.length), 'lines in order to the end');
        assert.ok(first.length <= 750, 'half of the budget for the start');
        assert.ok(first.length + last.length + 2 <= 1500, 'the budget');
        assert.ok(first.length + last.length > 1400, 'the budget is used');
    });

    test('C3: one long line of a chest in the middle of short lines is whole or left out, never cut', LIMIT, () => {
        const chest = 'The chest at (11, 67, 53) contains: ' + Array.from({ length: 30 }, (_, i) => `item_${i} ${100 - i}`).join(', ');
        const text = ['a'.repeat(700), chest, 'b'.repeat(700)].join('\n');
        const out = O.outputSummary(text);
        assert.ok(!out.includes('The chest at') || out.includes(chest));
    });

    test('a first line longer than half the budget is left out whole; the end part gets the rest of the budget', LIMIT, () => {
        const text = ['x'.repeat(1000), 'short', 'y'.repeat(600)].join('\n');
        const out = O.outputSummary(text);
        assert.ok(!out.includes('x'), 'not a piece of the long line');
        assert.ok(out.endsWith('Final outputs:\nshort\n' + 'y'.repeat(600)), out);
    });

    test('one long line of the chest view (1,100 characters) stays whole, also with a few more lines under 1500', LIMIT, () => {
        const chest = 'The chest at (11, 67, 53) contains: ' + Array.from({ length: 80 }, (_, i) => `item_${i} ${200 - i}`).join(', ') + '.';
        assert.ok(chest.length > 1000 && chest.length < 1500, String(chest.length));
        assert.equal(O.outputSummary(chest + '\n'), 'Action output:\n' + chest + '\n');
        const withMore = 'Walked to the chest.\n' + chest + '\nDone.\n';
        assert.equal(O.outputSummary(withMore), 'Action output:\n' + withMore);
    });

    test('one line longer than max: never an empty text; the line is cut at max characters', LIMIT, () => {
        const text = 'A'.repeat(1000) + 'M'.repeat(3000) + 'Z'.repeat(1000);
        const out = O.outputSummary(text);
        assert.equal(out, `Action output is very long (5000 chars) and has been shortened.\nFirst outputs:\n${'A'.repeat(1000)}${'M'.repeat(500)}\n...the rest is cut.`);
        assert.equal(O.outputSummary('B'.repeat(1600) + '\n').split('\n')[2], 'B'.repeat(1500));
    });

    test('a smaller max', LIMIT, () => {
        assert.equal(O.outputSummary('one\ntwo\nthree\nfour\n', 10),
            'Action output is very long (19 chars) and has been shortened.\nFirst outputs:\none\n...skipping many lines.\nFinal outputs:\nfour');
    });
});

// A fake agent as the one of the bot: requestInterrupt sets interrupt_code, clearBotLogs resets it.
function makeAgent() {
    const agent = {
        bot: { output: '', interrupt_code: false, emitted: [], emit(name) { agent.bot.emitted.push(name); } },
        interrupts: [],
        kills: [],
        clearBotLogs() { agent.bot.output = ''; agent.bot.interrupt_code = false; },
        requestInterrupt(...args) { agent.interrupts.push(args); agent.bot.interrupt_code = true; },
        isIdle: () => !agent.actions.executing,
        self_prompter: { isActive: () => false },
        history: { add() {} },
        cleanKill(msg) { agent.kills.push(msg); },
    };
    agent.actions = new ActionManager(agent);
    return agent;
}

// An action that logs a line and waits until it is interrupted.
function waiting(agent, line = 'I cut 3 oak_log.') {
    return async () => {
        agent.bot.output += line + '\n';
        while (!agent.bot.interrupt_code) await sleep(10);
    };
}

let cap;
beforeEach(() => {
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
});

describe('ActionManager: a stopped action reports (A4, I5)', () => {
    test('stopped by a mode: the output so far and "the reflex unstuck"; requestInterrupt gets the label', LIMIT, async () => {
        const agent = makeAgent();
        const first = agent.actions.runAction('action:chopTrees', waiting(agent));
        await sleep(30);
        const mode = await agent.actions.runAction('mode:unstuck', async () => { agent.bot.output += "I'm free.\n"; });
        const result = await first;
        assert.deepEqual(result, { success: true, message: 'Action output:\nI cut 3 oak_log.\n', interrupted: true, timedout: false, stopped_by: 'the reflex unstuck' });
        assert.deepEqual(agent.interrupts[0], ['mode:unstuck']);
        assert.deepEqual(mode, { success: true, message: "Action output:\nI'm free.\n", interrupted: false, timedout: false }, 'no stopped_by when not stopped');
    });

    test('stopped by a newer command: "the command !<name>"', LIMIT, async () => {
        const agent = makeAgent();
        const first = agent.actions.runAction('action:goToCoordinates', waiting(agent, 'Walking.'));
        await sleep(30);
        await agent.actions.runAction('action:mineOre', async () => {});
        const result = await first;
        assert.equal(result.stopped_by, 'the command !mineOre');
        assert.equal(result.message, 'Action output:\nWalking.\n');
    });

    test('!stop and a new message: the texts of the agent', LIMIT, async () => {
        for (const by of ['!stop', 'a new message']) {
            const agent = makeAgent();
            const first = agent.actions.runAction('action:storeItems', waiting(agent));
            await sleep(30);
            await agent.actions.stop(by);
            const result = await first;
            assert.equal(result.interrupted, true);
            assert.equal(result.stopped_by, by);
            assert.deepEqual(agent.interrupts[0], [by]);
        }
    });

    test('the first stopper counts; noteStop before the stop', LIMIT, async () => {
        const agent = makeAgent();
        const first = agent.actions.runAction('action:storeItems', waiting(agent));
        await sleep(30);
        agent.actions.noteStop('!stop');
        agent.actions.noteStop('a new message');
        await agent.actions.stop('mode:unstuck');
        assert.equal((await first).stopped_by, '!stop');
    });

    test('noteStop does nothing while no action runs; the next action starts without a stopper', LIMIT, async () => {
        const agent = makeAgent();
        agent.actions.noteStop('!stop');
        assert.equal(agent.actions.stopped_by, null);
        const first = agent.actions.runAction('action:a', waiting(agent));
        await sleep(30);
        await agent.actions.stop('!stop');
        await first;
        const second = agent.actions.runAction('action:b', waiting(agent));
        await sleep(30);
        agent.bot.interrupt_code = true; // someone set it without saying who
        const result = await second;
        assert.equal(result.stopped_by, 'an interrupt', 'unknown, not the stopper of the action before');
    });

    test('an interrupted action that throws: the output so far and stopped_by', LIMIT, async () => {
        const agent = makeAgent();
        const first = agent.actions.runAction('action:chopTrees', async () => {
            agent.bot.output += 'I cut 2 oak_log.\n';
            while (!agent.bot.interrupt_code) await sleep(10);
            throw new Error('Path was stopped before it could be completed!');
        });
        await sleep(30);
        await agent.actions.stop('!stop');
        const result = await first;
        assert.equal(result.success, false);
        assert.equal(result.interrupted, true);
        assert.equal(result.stopped_by, '!stop');
        assert.ok(result.message.startsWith('Action output:\nI cut 2 oak_log.\n!!Code threw exception!!'), result.message);
    });

    test('an action that ends by itself: no stopped_by, the output, the idle event', LIMIT, async () => {
        const agent = makeAgent();
        const result = await agent.actions.runAction('action:eat', async () => { agent.bot.output += 'I ate 2 bread.\n'; });
        assert.deepEqual(result, { success: true, message: 'Action output:\nI ate 2 bread.\n', interrupted: false, timedout: false });
        assert.deepEqual(agent.bot.emitted, ['idle']);
    });

    test('the time limit of the action: timedout, and the time limit as the stopper', LIMIT, async () => {
        const agent = makeAgent();
        const result = await agent.actions.runAction('action:slow', waiting(agent), { timeout: 0.001 }); // 60 ms
        assert.equal(result.interrupted, true);
        assert.equal(result.timedout, true);
        assert.equal(result.stopped_by, 'the time limit');
        assert.equal(result.message, 'Action output:\nI cut 3 oak_log.\n');
    });

    test('getBotOutputSummary: also while the action is interrupted; whole lines; the output is emptied', LIMIT, () => {
        const agent = makeAgent();
        agent.bot.interrupt_code = true;
        agent.bot.output = 'Collected 3 oak_log.\n';
        assert.equal(agent.actions.getBotOutputSummary(), 'Action output:\nCollected 3 oak_log.\n');
        assert.equal(agent.bot.output, '');
        agent.bot.output = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
        const long = agent.actions.getBotOutputSummary();
        assert.ok(long.startsWith('Action output is very long ('));
        assert.ok(long.length < 1700);
    });
});

describe('ActionManager: a newer command ends an older resume (A5)', () => {
    function withResume(agent) {
        agent.actions.resume_func = async () => {};
        agent.actions.resume_name = 'action:followPlayer';
    }

    test('an action action:* with resume false cancels the resume function', LIMIT, async () => {
        const agent = makeAgent();
        withResume(agent);
        await agent.actions.runAction('action:storeItems', async () => {});
        assert.equal(agent.actions.resume_func, null);
        assert.equal(agent.actions.resume_name, null);
    });

    test('an action of a mode does not cancel it', LIMIT, async () => {
        const agent = makeAgent();
        withResume(agent);
        await agent.actions.runAction('mode:item_collecting', async () => {});
        assert.equal(typeof agent.actions.resume_func, 'function');
        assert.equal(agent.actions.resume_name, 'action:followPlayer');
    });

    test('a new resume replaces it (resume true)', LIMIT, async () => {
        const agent = makeAgent();
        withResume(agent);
        const follow = async () => {};
        await agent.actions.runAction('action:goToPlayer', follow, { resume: true });
        assert.equal(agent.actions.resume_func, follow);
        assert.equal(agent.actions.resume_name, 'action:goToPlayer');
    });

    test('the resume that runs after the idle event is no new command and cancels nothing', LIMIT, async () => {
        const agent = makeAgent();
        let runs = 0;
        agent.actions.resume_func = async () => { runs++; };
        agent.actions.resume_name = 'action:followPlayer';
        const serial = agent.actions.command_serial;
        await agent.actions.resumeAction();
        assert.equal(runs, 1);
        assert.equal(typeof agent.actions.resume_func, 'function');
        assert.equal(agent.actions.command_serial, serial);
    });

    test('command_serial counts the commands, not the modes', LIMIT, async () => {
        const agent = makeAgent();
        assert.equal(agent.actions.command_serial, 0);
        await agent.actions.runAction('action:a', async () => {});
        await agent.actions.runAction('mode:unstuck', async () => {});
        await agent.actions.runAction('action:b', async () => {}, { resume: true });
        assert.equal(agent.actions.command_serial, 2);
    });
});

describe('module rules', () => {
    test('output_logic.js imports nothing and is importable without output or files', LIMIT, () => {
        assertImportRules('src/agent/reflex/output_logic.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/reflex/output_logic.js');
    });
});
