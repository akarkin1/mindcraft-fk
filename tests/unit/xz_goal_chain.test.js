// v0.1.4.16, review 16 V-1 / V-13 (the lead) and review 16b findings 4 and 5: a goal (!goal) is a standing order of whoever set
// it. !goal reads who set it from its own command's chain (executeCommand's running entry: the player who typed it, else the
// order behind the model's chain), never from the shared agent.order_chain; the self prompter keeps it on a resume and after a
// conversation's pause; a goal loaded after a restart counts as a player's. agent.js gives the goal's self prompts that chain
// with the mark goal: true: a player's goal may start work commands, but the model stops no command the player typed meanwhile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const { SelfPrompter } = await loadSrc('src/agent/self_prompter.js');
        const C = await loadSrc('src/agent/commands/index.js');
        const A = await loadSrc('src/agent/commands/actions.js');
        return { SelfPrompter, C, A };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { SelfPrompter, C, A } = await importQuietly();

function prompter(agent = {}) {
    const sp = new SelfPrompter(agent);
    sp.startLoop = () => {};
    return sp;
}

test('a goal set by a player carries the player; one the model set stays the model\'s', () => {
    const sp = prompter();
    sp.start('build a house', 'MartyByrde2');
    assert.equal(sp.started_by, 'MartyByrde2');
    sp.start('mine iron', 'model');
    assert.equal(sp.started_by, 'model');
});

test('a goal loaded after a restart (no setter) counts as a player\'s standing order', async () => {
    const sp = prompter();
    await sp.handleLoad('build a house', 1);
    assert.equal(sp.started_by, 'player');
});

test('finding 5: the shared order chain is not read: a system line between the words and the !goal changes nothing', () => {
    const agent = { order_chain: { by: 'model', at: 1 } };
    const sp = prompter(agent);
    sp.start('build a house', 'Owner');
    assert.equal(sp.started_by, 'Owner');
});

test('finding 5: a resume (no prompt) keeps who set the goal, whatever the chain is then', () => {
    const agent = { order_chain: { by: 'Owner', at: 1 } };
    const sp = prompter(agent);
    sp.start('build a house', 'Owner');
    agent.order_chain = { by: 'model', at: 2 };
    sp.start();
    assert.equal(sp.started_by, 'Owner');
    assert.equal(sp.prompt, 'build a house');
});

test('finding 5: a goal set during a conversation (paused) keeps its setter for the resume', () => {
    const agent = { order_chain: { by: 'model', at: 2 } };
    const sp = prompter(agent);
    sp.setPromptPaused('build a house', 'Owner');
    assert.equal(sp.isPaused(), true);
    sp.start();
    assert.equal(sp.started_by, 'Owner');
});

test('finding 5: goalSetterOf reads the running !goal: typed by the player, or the chain of the model\'s command', () => {
    assert.equal(A.goalSetterOf({ running_commands: [{ name: '!goal', typed: true, by: 'Owner' }] }), 'Owner');
    assert.equal(A.goalSetterOf({ running_commands: [{ name: '!goal', typed: true }] }), 'player');
    assert.equal(A.goalSetterOf({ running_commands: [{ name: '!goal', typed: false, chain: { by: 'Owner', at: 1 } }] }), 'Owner');
    assert.equal(A.goalSetterOf({ running_commands: [{ name: '!goal', typed: false, chain: { by: 'model', at: 1 } }] }), 'model');
    assert.equal(A.goalSetterOf({ running_commands: [{ name: '!goal', typed: false, chain: { by: 'supervisor', at: 1 } }] }), 'supervisor');
    assert.equal(A.goalSetterOf({ running_commands: [{ name: '!mineOre', typed: true, by: 'Owner' }] }), undefined);
    assert.equal(A.goalSetterOf({}), undefined);
    assert.equal(A.goalSetterOf(null), undefined);
});

test('finding 5: executeCommand puts the chain of the model\'s command on its running entry, !goal starts with it', async () => {
    const started = [];
    const agent = {
        name: 'andy', running_commands: [], last_order: null, job: null, repeat_guard: null, cost_meter: null,
        self_prompter: { start: (p, by) => started.push([p, by]), setPromptPaused: (p, by) => started.push(['paused', p, by]) },
    };
    const cap = captureConsole();
    try {
        await C.executeCommand(agent, '!goal("build a house")', { typed: false, chain: { by: 'Owner', at: 1 } });
        await C.executeCommand(agent, '!goal("mine iron")', { typed: false, chain: { by: 'model', at: 2 } });
    } finally {
        cap.restore();
    }
    assert.deepEqual(started.map(s => s.at(-1)), ['Owner', 'model']);
    assert.equal(agent.running_commands.length, 0, 'the entries leave the list');
});

test('finding 4: in a player\'s goal the model may start work, but stops no command the player typed', () => {
    const goal = { by: 'Owner', at: 1, goal: true };
    const typed = [{ name: '!mineOre', args: ['iron', 8], text: '!mineOre("iron", 8)', typed: true, by: 'Owner' }];
    assert.equal(C.orderRefusal({ running_commands: [] }, '!mineOre', 'model', goal), null, 'work in the goal');
    assert.equal(C.orderRefusal({ running_commands: typed }, '!stop', 'model', goal), C.ORDER_TEXTS.playersOrder);
    assert.equal(C.orderRefusal({ running_commands: typed }, '!setMode', 'model', goal), C.ORDER_TEXTS.playersOrder);
    assert.equal(C.orderRefusal({ running_commands: [] }, '!stop', 'model', goal), null, 'nothing typed runs: the goal stops its own work');
    // the owner's spoken "stop" (his chain, no goal mark) still stops his typed command
    assert.equal(C.orderRefusal({ running_commands: typed }, '!stop', 'model', C.orderChainOf('Owner', 'stop', { self: 'andy' })), null);
});
