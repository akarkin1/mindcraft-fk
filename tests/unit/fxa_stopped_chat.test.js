// Fix round of v0.1.4.8, X4: a typed order that was stopped answered nothing in the chat; its line went only
// into the history. For an order that a player typed, `Command !x was stopped by ... Done so far: ...` now
// also goes to the chat of that player, the way the agent answers a typed command (routeResponse). For a
// command of the model it stays in the history only. The real Agent prototype (handleMessage, routeResponse),
// the real commands and the real ActionManager (tests/helpers/st_glue_env.js).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue, makeGlueAgent } from '../helpers/st_glue_env.js';

const G = await loadGlue();
await import('ses'); // the global assert of the agent process, for resume actions

const LIMIT = { timeout: 30000 };
const BASE = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: false, protected_areas: false,
    home_pack: false, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: true, allow_insecure_coding: false,
    say_results: false, repeat_guard: 0, narrate_behavior: false, code_timeout_mins: -1, max_command_result_chars: 0, only_chat_with: [] };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LINE = 'Command !mineOre was stopped by the reflex unstuck. Done so far: I dug 3 blocks and found 2 raw_iron. I was stopped.';

let cap;
beforeEach(() => {
    cap = captureConsole();
    G.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
});

// An agent with a mining pack whose mineOre runs until it is interrupted; routeResponse is recorded.
function miningAgent(replies = []) {
    const mining = {
        async mineOre(bot) {
            while (!bot.interrupt_code) await sleep(5);
            return { ok: false, reason: 'interrupted', text: 'I dug 3 blocks and found 2 raw_iron. I was stopped.' };
        },
    };
    const agent = makeGlueAgent(G, { replies, fields: { work_packs: { mining } } });
    agent.routed = [];
    const route = agent.routeResponse.bind(agent);
    agent.routeResponse = (to, message) => { agent.routed.push([to, message]); return route(to, message); };
    return agent;
}

async function whenRunning(agent, label) {
    const end = Date.now() + 5000;
    while (agent.actions.currentActionLabel !== label && Date.now() < end) await sleep(5);
    assert.equal(agent.actions.currentActionLabel, label, 'the command runs');
}

const systemTurns = (agent) => agent.turns.filter(([name]) => name === 'system').map(([, text]) => text);

describe('X4: a stopped command that a player typed tells that player', () => {
    test('typed by the player, stopped by a reflex: the line goes to his chat and into the history', LIMIT, async () => {
        const agent = miningAgent();
        const done = agent.handleMessage('MartyByrde2', '!mineOre("iron", 8)');
        await whenRunning(agent, 'action:mineOre');
        await agent.actions.runAction('mode:unstuck', async () => {});
        await done;
        assert.ok(agent.routed.some(([to, m]) => to === 'MartyByrde2' && m === LINE), JSON.stringify(agent.routed));
        assert.ok(agent.chats.includes(LINE), JSON.stringify(agent.chats));
        assert.ok(systemTurns(agent).includes(LINE), 'the history keeps it too');
        assert.equal(agent.prompter.calls, 0, 'no turn of the model');
    });

    test('typed by the player, stopped by !stop that he typed: his chat gets the line and "Agent stopped."', LIMIT, async () => {
        const agent = miningAgent();
        const done = agent.handleMessage('MartyByrde2', '!mineOre("iron", 8)');
        await whenRunning(agent, 'action:mineOre');
        await agent.handleMessage('MartyByrde2', '!stop');
        await done;
        const stopLine = 'Command !mineOre was stopped by !stop. Done so far: I dug 3 blocks and found 2 raw_iron. I was stopped.';
        assert.ok(agent.chats.includes(stopLine), JSON.stringify(agent.chats));
        assert.ok(agent.chats.includes('Agent stopped.'), JSON.stringify(agent.chats));
    });

    test('a command of the model that is stopped: the history only, nothing in the chat', LIMIT, async () => {
        const agent = miningAgent(['!mineOre("iron", 8)', 'A SECOND TURN']);
        const done = agent.handleMessage('MartyByrde2', 'get me some iron');
        await whenRunning(agent, 'action:mineOre');
        await agent.actions.runAction('mode:unstuck', async () => {});
        await done;
        assert.ok(systemTurns(agent).includes(LINE), JSON.stringify(agent.turns));
        assert.ok(!agent.chats.some((c) => c.includes('was stopped by')), JSON.stringify(agent.chats));
        assert.ok(!agent.routed.some(([, m]) => m.includes('was stopped by')));
    });

    test('an order typed by one player and replaced by a command of the model: the line of the typed one goes to its player', LIMIT, async () => {
        const agent = miningAgent();
        const done = agent.handleMessage('MartyByrde2', '!mineOre("iron", 8)');
        await whenRunning(agent, 'action:mineOre');
        // the model runs another command meanwhile (for another message): it stops the typed order
        agent.last_order = { by: 'someone', command: '!stay', typed: false };
        const other = G.index.executeCommand(agent, '!stay(1)', { typed: false });
        await done;
        await other;
        const line = agent.routed.find(([, m]) => m.startsWith('Command !mineOre was stopped by the command !stay.'));
        assert.ok(line, JSON.stringify(agent.routed));
        assert.equal(line[0], 'MartyByrde2');
    });
});
