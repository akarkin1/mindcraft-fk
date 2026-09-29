// T1 round 2, spec v0.1.4.8 section 0 rule 7 and the task of round 2 (item 11): every new switch off gives
// the behaviour of v0.1.4.7, in the glue. Two cases: the settings at the defaults of section 2 (read from
// settings_spec.json), and a settings object without the new keys at all (a settings.js of v0.1.4.7).
// The switches one by one are also tested in st_glue_commands (protect_built_blocks), st_glue_stopped
// (repeat_guard, say_results), st_glue_start (restart_context, the steps at spawn), st_glue_prompt
// (knowledge_in_prompt), and in round 1 (stuck_restart_after, flee_below_health, log_timestamps,
// home_reflexes.hunger).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { loadGlue, makeGlueAgent, makeFakeBot, settle } from '../helpers/st_glue_env.js';

const G = await loadGlue();
await import('ses');
const SPEC = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
const NEW_KEYS = ['stuck_restart_after', 'protect_built_blocks', 'knowledge_in_prompt', 'knowledge_max_chars', 'repeat_guard', 'restart_context',
    'say_results', 'flee_below_health', 'log_timestamps'];
const OLD = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: true, protected_areas: false,
    home_pack: false, storage_pack: false, farming_pack: false, wood_pack: true, mining_pack: false, narrate_behavior: false };
const DEFAULTS = { ...OLD, ...Object.fromEntries(NEW_KEYS.map((k) => [k, SPEC[k].default])) };
const LIMIT = { timeout: 30000 };

let cap;
let dir;
let cwd;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    cwd = process.cwd();
    process.chdir(dir);
});
afterEach(() => {
    process.chdir(cwd);
    cap.restore();
    removeTmpDir(dir);
});

for (const [label, settings] of [['the defaults of section 2', DEFAULTS], ['a settings.js without the new keys (v0.1.4.7)', OLD]]) {
    describe(`every new switch off: ${label}`, () => {
        beforeEach(() => G.settingsModule.setSettings({ ...settings }));

        test('the model may try the same failing command as often as it wants; a pack text is not said', LIMIT, async () => {
            const wood = { async chopTrees() { return { ok: true, reason: null, text: 'I cut 1 oak tree and got 5 oak_log.' }; } };
            const agent = makeGlueAgent(G, { replies: ['!consume("bread")', '!consume("bread")', '!consume("bread")', '!chopTrees(8)', ''],
                fields: { work_packs: { wood } } });
            const labels = [];
            const run = agent.actions.runAction.bind(agent.actions);
            agent.actions.runAction = (l, f, o) => { labels.push(l); return run(l, f, o); };
            await agent.handleMessage('MartyByrde2', 'eat and get wood');
            assert.equal(labels.filter((l) => l === 'action:consume').length, 3);
            assert.ok(!agent.chats.includes('I cut 1 oak tree and got 5 oak_log.'));
        });

        test('no guard of built blocks: the model takes fences outside the areas', LIMIT, async () => {
            const w = createBlockWorld().flatGround(63);
            for (const x of [3, 4]) w.set(x, 64, 0, 'oak_fence');
            const bot = makeFakeBot({ world: w, realBlocks: true });
            bot.collectBlock = { async collect(b) { w.set(b.position.x, b.position.y, b.position.z, 'air'); bot.inventory.add('oak_fence', 1); }, cancelTask() {} };
            const agent = makeGlueAgent(G, { bot, replies: ['!collectBlocks("oak_fence", 2)', ''], fields: { world_memory: { worldDir: dir } } });
            agent._startAreaGuard();
            assert.equal(bot.areaGuard, undefined, 'no guard is installed');
            await agent.handleMessage('MartyByrde2', 'take the fences');
            await settle(agent);
            assert.equal(w.get(3, 64, 0), 'air');
            assert.equal(w.get(4, 64, 0), 'air');
        });

        test('no exit file at the end and none read at the start; nothing new at spawn', LIMIT, async () => {
            const agent = makeGlueAgent(G);
            const exit = process.exit;
            process.exit = () => {};
            try {
                delete agent.cleanKill;
                agent.cleanKill("Got stuck and couldn't get unstuck");
            } finally {
                process.exit = exit;
            }
            assert.equal(fs.existsSync(path.join(dir, 'bots', 'andy', 'last_exit.json')), false);
            assert.equal(await makeGlueAgent(G)._atSpawn(), '');
        });

        test('no block of what the bot knows', () => {
            const agent = makeGlueAgent(G);
            agent._workStores = () => { throw new Error('must not be read'); };
            assert.equal(agent.knowledgeBlock(), '');
        });
    });
}
