// Part G of v0.1.4.8 (E6): every new switch of section 2 off, or missing in an older settings.js, gives
// the behaviour of v0.1.4.7 in the glue (the rule of section 0, 7). The corrections without a switch
// (a stopped command reports, !setMode, the hard stop of requestInterrupt, !discard, !inventory, the
// examples) are tested in stg_commands, stg_agent and stg_prompt.
//   - protect_built_blocks: no guard without protected_areas; knowledge_in_prompt: the block is never
//     asked for; repeat_guard: every try runs; restart_context: no exit file is written or read;
//     say_results: nothing more is said; the home pack off: no !closeDoor, no door service at spawn;
//   - the settings of an older settings.js (without the new keys) give the same.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const agent = await loadSrc('src/agent/agent.js');
        const prompter = await loadSrc('src/models/prompter.js');
        return { settingsModule, index, actions, agent, prompter };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const { Agent } = M.agent;
const RC = await loadSrc('src/agent/restart_context.js');

const NEW_KEYS = ['stuck_restart_after', 'protect_built_blocks', 'knowledge_in_prompt', 'knowledge_max_chars', 'repeat_guard', 'restart_context',
    'say_results', 'flee_below_health', 'log_timestamps'];
const OFF_0148 = { protect_built_blocks: false, knowledge_in_prompt: false, repeat_guard: 0, restart_context: false, say_results: false };
// the switches of v0.1.4.7 as the owner may have them, without any key of v0.1.4.8
const OLD = { language: 'en', world_memory: true, protected_areas: false, home_pack: false, storage_pack: true, farming_pack: false,
    wood_pack: false, mining_pack: false, show_command_syntax: 'none', max_commands: -1, only_chat_with: [], blocked_actions: [] };

let cap;
let dir;
let cwd;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    cwd = process.cwd();
});
afterEach(() => {
    process.chdir(cwd);
    cap.restore();
    removeTmpDir(dir);
});

const fakeAgent = (fields = {}) => Object.assign(Object.create(Agent.prototype), { name: 'andy', bot: { username: 'andy' }, ...fields });

for (const [label, settings] of [['switched off', { ...OLD, ...OFF_0148 }], ['missing (an older settings.js)', { ...OLD }]]) {
    describe(`the new switches ${label}`, () => {
        beforeEach(() => {
            M.settingsModule.setSettings({ ...settings });
            for (const key of NEW_KEYS) {
                if (!(key in settings)) assert.equal(M.settingsModule.default[key], undefined, key);
            }
        });

        test('protect_built_blocks: no guard without protected_areas', () => {
            const bot = { game: { dimension: 'overworld' }, dig: async () => 'dug', on() {}, once() {} };
            const agent = fakeAgent({ bot });
            agent._startAreaGuard();
            assert.equal(bot.areaGuard, undefined);
            assert.equal(agent.area_guard, undefined);
        });

        test('knowledge_in_prompt: the prompt is the one of v0.1.4.7, the block is never asked for', async () => {
            let sent = null;
            const fake = Object.create(M.prompter.Prompter.prototype);
            Object.assign(fake, {
                agent: { name: 'andy', blocked_actions: [], self_prompter: { isStopped: () => true }, knowledgeBlock() { throw new Error('asked'); } },
                profile: { conversing: 'You are $NAME.\nConversation Begin:' }, cooldown: 0, last_prompt_time: 0, convo_examples: null,
                chat_model: { async sendRequest(turns, prompt) { sent = prompt; return ''; } },
            });
            await fake.promptConvo([]);
            assert.equal(sent, 'You are andy.\nConversation Begin:');
            assert.equal(fakeAgent({ bot: { entity: { position: { x: 0, y: 64, z: 0 } } } }).knowledgeBlock(), '');
        });

        test('repeat_guard: no guard, every try of the model runs', async () => {
            const text = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
            assert.ok(text.includes('this.repeat_guard = null;\r\n') || text.includes('this.repeat_guard = null;\n'));
            const runs = [];
            const agent = { cost_meter: { summaryText: () => { runs.push(1); return 'Cost.'; } }, repeat_guard: null };
            for (let i = 0; i < 5; i++) assert.equal(await M.index.executeCommand(agent, '!cost'), 'Cost.');
            assert.equal(runs.length, 5);
        });

        test('restart_context: no exit file at the end, none read at spawn', async () => {
            process.chdir(dir);
            const agent = fakeAgent({ bot: { entity: { position: { x: 1, y: 2, z: 3 } } }, last_order: { by: 'bob', command: '!stay' } });
            agent._atExit('bye');
            assert.equal(fs.existsSync(path.join(dir, 'bots')), false);
            RC.writeExit('./bots/andy', { reason: 'earlier' });
            assert.equal(await agent._atSpawn(), '');
            assert.ok(fs.existsSync(path.join(dir, 'bots', 'andy', 'last_exit.json')), 'left alone');
        });

        test('say_results: after a pack command and an empty answer, nothing more is said', async () => {
            const agent = Object.create(Agent.prototype);
            const replies = ['!storeItems', ''];
            Object.assign(agent, {
                name: 'andy', shut_up: false, last_sender: null, last_order: null, task: { data: null },
                bot: { time: { timeOfDay: 1000 }, modes: { flushBehaviorLog: () => '', pause() {} } },
                history: { async add() {}, save() {}, getHistory: () => [] },
                self_prompter: { shouldInterrupt: () => false, isActive: () => false, handleUserPromptedCmd() {} },
                prompter: { async promptConvo() { return replies.shift() ?? ''; } },
                actions: { async runAction(label, fn) { await fn(); return { success: true, message: '', interrupted: false, timedout: false }; } },
                work_packs: { storage: { storeItems: async () => ({ ok: true, text: 'I stored 3 wheat.' }) } }, packContext: () => ({}),
                routed: [],
            });
            agent.routeResponse = (to, message) => agent.routed.push(message);
            await agent.handleMessage('bob', 'put it in the chest');
            assert.deepEqual(agent.routed, []);
        });

        test('the home pack off: !closeDoor says so and runs nothing; no door service at spawn', async () => {
            const agent = { actions: { runAction() { throw new Error('ran'); } }, door_service: { closeNear() { throw new Error('ran'); } } };
            assert.equal(await M.actions.actionsList.find((c) => c.name === '!closeDoor').perform(agent), 'The home pack is off.');
            const spawned = fakeAgent({ bot: { inventory: { slots: [] } } });
            await spawned._atSpawn();
            assert.equal(spawned.door_service, undefined);
        });
    });
}

describe('the settings in code', () => {
    test('every new key has the default of the spec in settings_spec.json, a switch is off by default', () => {
        const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
        const DEFAULTS = { stuck_restart_after: 1, protect_built_blocks: false, knowledge_in_prompt: false, knowledge_max_chars: 600, repeat_guard: 0,
            restart_context: false, say_results: false, flee_below_health: 0, log_timestamps: false };
        for (const [key, value] of Object.entries(DEFAULTS)) assert.deepEqual(spec[key]?.default, value, key);
    });
});
