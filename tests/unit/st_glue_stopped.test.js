// T1 round 2, spec v0.1.4.8 I5 and section 11, items 3 and 13, in the loop of the agent (handleMessage of
// the real Agent prototype, the real commands, executeCommand and ActionManager):
//   item 3 / I5 a stopped command starts no turn of the model; its text goes into the history as a system
//          message, word for word: `Command !mineOre was stopped by the reflex unstuck. Done so far: <text>`;
//          the same for a stopped !newAction (S4); an action that comes back by itself (!followPlayer stopped
//          by a reflex) writes no line;
//   item 13 repeat_guard in executeCommand: failures only (decision after round 1), a command typed by the
//          player is never refused, a refused command does not run, the text of F5; 0 is off;
//          say_results: only texts of pack commands, only when the answer of the model is empty or a tab.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Vec3 } from 'vec3';
import { repoPath } from '../helpers/paths.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue, makeGlueAgent, settle } from '../helpers/st_glue_env.js';

const G = await loadGlue();
await import('ses'); // the global assert of the agent process, for resume actions

const LIMIT = { timeout: 30000 };
const BASE = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: false, protected_areas: false,
    home_pack: false, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false, allow_insecure_coding: false,
    say_results: false, repeat_guard: 0, narrate_behavior: false, code_timeout_mins: -1, max_command_result_chars: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cap;
beforeEach(() => {
    cap = captureConsole();
    G.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
});

const set = (extra) => G.settingsModule.setSettings({ ...BASE, ...extra });
const systemTurns = (agent) => agent.turns.filter(([name]) => name === 'system').map(([, text]) => text);

// Starts a message to the agent without waiting; resolves when the action `label` runs.
async function startMessage(agent, from, text, label) {
    const done = agent.handleMessage(from, text);
    const end = Date.now() + 5000;
    while (agent.actions.currentActionLabel !== label && Date.now() < end) await sleep(5);
    assert.equal(agent.actions.currentActionLabel, label, 'the command runs');
    return { done }; // not the promise itself: an async function would wait for it
}

// Records the labels of the actions that start.
function recordLabels(agent) {
    const labels = [];
    const runAction = agent.actions.runAction.bind(agent.actions);
    agent.actions.runAction = (label, fn, options) => { labels.push(label); return runAction(label, fn, options); };
    return labels;
}

// ------------------------------------------------------------------------------ I5, item 3

describe('item 3, I5: a stopped command', () => {
    function miningAgent(replies) {
        set({ mining_pack: true });
        const mining = {
            async mineOre(bot) {
                while (!bot.interrupt_code) await sleep(5);
                return { ok: false, reason: 'interrupted', text: 'I dug 3 blocks and found 2 raw_iron. I was stopped.' };
            },
        };
        return makeGlueAgent(G, { replies, fields: { work_packs: { mining } } });
    }

    test('stopped by a reflex: the text of the spec in the history, word for word; no second turn of the model', LIMIT, async () => {
        const agent = miningAgent(['!mineOre("iron", 8)', 'A SECOND TURN']);
        const { done } = await startMessage(agent, 'MartyByrde2', 'get me some iron', 'action:mineOre');
        await agent.actions.runAction('mode:unstuck', async () => {});
        await done;
        assert.ok(systemTurns(agent).includes('Command !mineOre was stopped by the reflex unstuck. Done so far: I dug 3 blocks and found 2 raw_iron. I was stopped.'),
            JSON.stringify(agent.turns));
        assert.equal(agent.prompter.calls, 1, 'no second turn');
        assert.ok(!agent.chats.includes('A SECOND TURN'));
    });

    test('stopped by !stop and by a new message', LIMIT, async () => {
        for (const by of ['!stop', 'a new message']) {
            const agent = miningAgent(['!mineOre("iron", 8)', 'A SECOND TURN']);
            const { done } = await startMessage(agent, 'MartyByrde2', 'get me some iron', 'action:mineOre');
            await agent.actions.stop(by);
            await done;
            assert.ok(systemTurns(agent).includes(`Command !mineOre was stopped by ${by}. Done so far: I dug 3 blocks and found 2 raw_iron. I was stopped.`),
                JSON.stringify(agent.turns));
            assert.equal(agent.prompter.calls, 1);
        }
    });

    test('a command of upstream without output: only the first sentence', LIMIT, async () => {
        const agent = makeGlueAgent(G, { replies: ['!stay(60)', 'A SECOND TURN'] });
        const { done } = await startMessage(agent, 'MartyByrde2', 'wait here', 'action:stay');
        agent.bot.output = '';
        await agent.actions.stop('!stop');
        await done;
        const lines = systemTurns(agent).filter((t) => t.startsWith('Command !stay'));
        assert.equal(lines.length, 1, JSON.stringify(agent.turns));
        assert.ok(lines[0] === 'Command !stay was stopped by !stop.' || lines[0].startsWith('Command !stay was stopped by !stop. Done so far: '), lines[0]);
        assert.equal(agent.prompter.calls, 1);
    });

    test('a stopped !newAction: the late answer starts no second turn; the line in the history (S4)', LIMIT, async () => {
        set({ allow_insecure_coding: true });
        const agent = makeGlueAgent(G, { replies: ['!newAction("dig a tunnel to the east")', 'A SECOND TURN'] });
        agent.coder = {
            last_run: null,
            async generateCode() {
                while (!agent.bot.interrupt_code) await sleep(5);
                return 'Agent wrote this code: ... Code Output: I dug 1 block.'; // a late answer
            },
        };
        const { done } = await startMessage(agent, 'MartyByrde2', 'dig a tunnel', 'action:newAction');
        await agent.actions.stop('!stop');
        await done;
        assert.equal(agent.prompter.calls, 1, 'no second turn');
        assert.ok(systemTurns(agent).some((t) => t.startsWith('Command !newAction was stopped by !stop.')), JSON.stringify(agent.turns));
    });

    test('!followPlayer stopped by a reflex comes back by itself: no line in the history', LIMIT, async () => {
        const agent = makeGlueAgent(G, { replies: ['!followPlayer("MartyByrde2", 3)', 'A SECOND TURN'] });
        const player = { id: 7, name: 'player', type: 'player', username: 'MartyByrde2', position: new Vec3(5, 64, 5), height: 1.8, metadata: {} };
        agent.bot.players.MartyByrde2 = { username: 'MartyByrde2', entity: player };
        agent.bot.entities[7] = player;
        const { done } = await startMessage(agent, 'MartyByrde2', 'follow me', 'action:followPlayer');
        await agent.actions.runAction('mode:self_defense', async () => {});
        await done;
        assert.deepEqual(systemTurns(agent).filter((t) => t.includes('was stopped')), [], JSON.stringify(agent.turns));
        assert.equal(agent.prompter.calls, 1);
        agent.actions.cancelResume();
    });

    test('!followPlayer stopped by !stop: the line is written (it does not come back)', LIMIT, async () => {
        const agent = makeGlueAgent(G, { replies: ['!followPlayer("MartyByrde2", 3)', 'A SECOND TURN'] });
        const player = { id: 7, name: 'player', type: 'player', username: 'MartyByrde2', position: new Vec3(5, 64, 5), height: 1.8, metadata: {} };
        agent.bot.players.MartyByrde2 = { username: 'MartyByrde2', entity: player };
        agent.bot.entities[7] = player;
        const { done } = await startMessage(agent, 'MartyByrde2', 'follow me', 'action:followPlayer');
        await G.index.executeCommand(agent, '!stop', { typed: true });
        await done;
        assert.ok(systemTurns(agent).some((t) => t.startsWith('Command !followPlayer was stopped by !stop.')), JSON.stringify(agent.turns));
    });
});

// ----------------------------------------------------------------------- item 13: repeat_guard

describe('item 13: repeat_guard in executeCommand', () => {
    const FAIL = 'You do not have any bread to eat.';

    function guarded(replies) {
        const agent = makeGlueAgent(G, { replies });
        agent.repeat_guard = new G.repeat.RepeatGuard({ limit: 3 });
        return agent;
    }

    test('the third identical failure of the model is refused and does not run', LIMIT, async () => {
        const agent = guarded(['!consume("bread")', '!consume("bread")', '!consume("bread")', '']);
        const labels = recordLabels(agent);
        await agent.handleMessage('MartyByrde2', 'eat something');
        assert.equal(labels.filter((l) => l === 'action:consume').length, 2, 'the third try does not run');
        const refusal = systemTurns(agent).find((t) => t.startsWith('I tried !consume("bread")'));
        assert.ok(refusal, JSON.stringify(agent.turns));
    });

    // FINDING T1-3 (kind 1, code wrong): the refusal reads "... with the same result: Action output: You do
    // not have any bread to eat. ..."; the spec (F5) gives the result without the heading of the action
    // output. executeCommand (src/agent/commands/index.js, recordRepeat, line 275) gives the guard the
    // whole result of runAsAction, heading included. Left failing on purpose.
    test('the refusal is the text of F5, word for word', LIMIT, async () => {
        const agent = guarded(['!consume("bread")', '!consume("bread")', '!consume("bread")', '']);
        await agent.handleMessage('MartyByrde2', 'eat something');
        const refusal = systemTurns(agent).find((t) => t.startsWith('I tried !consume("bread")'));
        assert.equal(refusal, `I tried !consume("bread") 2 times with the same result: ${FAIL} I do not try a third time. Ask the player what to do.`);
    });

    test('a command typed by the player is never refused', LIMIT, async () => {
        const agent = guarded([]);
        const labels = recordLabels(agent);
        for (let i = 0; i < 4; i++) await agent.handleMessage('MartyByrde2', '!consume("bread")');
        assert.equal(labels.filter((l) => l === 'action:consume').length, 4);
    });

    test('a command typed by the player is recorded: after two typed failures the model is refused', LIMIT, async () => {
        const agent = guarded(['!consume("bread")', '']);
        const labels = recordLabels(agent);
        await agent.handleMessage('MartyByrde2', '!consume("bread")');
        await agent.handleMessage('MartyByrde2', '!consume("bread")');
        await agent.handleMessage('MartyByrde2', 'try again');
        assert.equal(labels.filter((l) => l === 'action:consume').length, 2);
    });

    test('only failures count: a command that succeeds again and again is never refused', LIMIT, async () => {
        const agent = guarded(['!equip("dirt")', '!equip("dirt")', '!equip("dirt")', '!equip("dirt")', '']);
        agent.bot.inventory.put('dirt', 3, 9);
        const labels = recordLabels(agent);
        await agent.handleMessage('MartyByrde2', 'hold the dirt');
        assert.equal(labels.filter((l) => l === 'action:equip').length, 4);
    });

    test('repeat_guard 0: the agent makes no guard (v0.1.4.7); the model may try as often as it wants', LIMIT, async () => {
        const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        assert.match(source, /if \(numberSetting\(settings\.repeat_guard, 0\) > 0\) \{\s*try \{\s*this\.repeat_guard = new RepeatGuard\(\{ limit: settings\.repeat_guard \}\);/);
        const agent = makeGlueAgent(G, { replies: ['!consume("bread")', '!consume("bread")', '!consume("bread")', '!consume("bread")', ''] });
        const labels = recordLabels(agent);
        await agent.handleMessage('MartyByrde2', 'eat something');
        assert.equal(labels.filter((l) => l === 'action:consume').length, 4);
    });
});

// ----------------------------------------------------------------------- item 13: say_results

describe('item 13: say_results', () => {
    const TEXT = 'I cut 2 oak trees and got 9 oak_log. I planted 2 saplings.';

    function woodAgent(replies, extra = {}) {
        set({ wood_pack: true, say_results: true, ...extra });
        const wood = { async chopTrees() { return { ok: true, reason: null, text: TEXT }; } };
        return makeGlueAgent(G, { replies, fields: { work_packs: { wood } } });
    }

    test('the model answers nothing after a pack command: the text of the pack goes to the chat', LIMIT, async () => {
        const agent = woodAgent(['!chopTrees(8)', '']);
        await agent.handleMessage('MartyByrde2', 'get wood');
        assert.ok(agent.chats.includes(TEXT), JSON.stringify(agent.chats));
    });

    test('the model answers with a tab: the text of the pack goes to the chat', LIMIT, async () => {
        const agent = woodAgent(['!chopTrees(8)', '\t']);
        await agent.handleMessage('MartyByrde2', 'get wood');
        assert.ok(agent.chats.includes(TEXT), JSON.stringify(agent.chats));
    });

    test('the model answers with words: only its words go to the chat', LIMIT, async () => {
        const agent = woodAgent(['!chopTrees(8)', 'Got the wood!']);
        await agent.handleMessage('MartyByrde2', 'get wood');
        assert.ok(agent.chats.includes('Got the wood!'));
        assert.ok(!agent.chats.includes(TEXT));
    });

    test('a command that is not of a pack: its text is not said', LIMIT, async () => {
        set({ say_results: true });
        const agent = makeGlueAgent(G, { replies: ['!equip("dirt")', ''] });
        agent.bot.inventory.put('dirt', 3, 9);
        await agent.handleMessage('MartyByrde2', 'hold the dirt');
        assert.ok(!agent.chats.some((c) => c.includes('Equipped dirt.')), JSON.stringify(agent.chats));
    });

    test('say_results off: the text of the pack is not said (v0.1.4.7)', LIMIT, async () => {
        const agent = woodAgent(['!chopTrees(8)', ''], { say_results: false });
        await agent.handleMessage('MartyByrde2', 'get wood');
        assert.ok(!agent.chats.includes(TEXT));
    });

    test('the text of a home pack command counts as a pack text', LIMIT, async () => {
        set({ home_pack: true, say_results: true });
        const agent = makeGlueAgent(G, { replies: ['!closeDoor', ''] });
        agent.door_service = { tick() {}, stop() {}, async closeNear() { return { ok: true, reason: null, text: 'I closed oak_door at (1, 64, 2).' }; } };
        await agent.handleMessage('MartyByrde2', 'close the door');
        await settle(agent);
        assert.ok(agent.chats.includes('I closed oak_door at (1, 64, 2).'), JSON.stringify(agent.chats));
    });
});
