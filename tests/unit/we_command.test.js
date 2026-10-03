// Spec v0.1.4.12, section 2 and 4.2 (part E): the setting `smelting` in settings.js and settings_spec.json,
// and the command !smeltItem: the same name, description and params; with smelting on and the storage pack
// loaded it runs smeltItem of the pack through runPack, off it is the !smeltItem of the original project.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue, makeGlueAgent } from '../helpers/st_glue_env.js';

const G = await loadGlue();
const settings = (await loadSrc('settings.js')).default;
const SPEC = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));

const LIMIT = { timeout: 30000 };
const BASE = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: false, protected_areas: false,
    home_pack: false, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false, protect_built_blocks: false,
    allow_insecure_coding: false, narrate_behavior: false };

let cap;
beforeEach(() => {
    cap = captureConsole();
    G.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
});

const set = (extra) => G.settingsModule.setSettings({ ...BASE, ...extra });
const run = (agent, message) => G.index.executeCommand(agent, message, { typed: false });

describe('the setting smelting', () => {
    test('settings_spec.json: a boolean, off by default, after area_sense', () => {
        assert.deepEqual([SPEC.smelting?.type, SPEC.smelting?.default], ['boolean', false]);
        assert.ok(SPEC.smelting.description.length > 0);
        const keys = Object.keys(SPEC);
        assert.ok(keys.indexOf('smelting') > keys.indexOf('area_sense'));
    });

    test('settings.js has the key with a boolean value (the value of the owner is not asserted)', () => {
        assert.ok(Object.hasOwn(settings, 'smelting'));
        assert.equal(typeof settings.smelting, 'boolean');
    });
});

describe('!smeltItem', () => {
    test('name, description and params as in the original project', () => {
        const c = G.actions.actionsList.find(x => x.name === '!smeltItem');
        assert.equal(c.description, 'Smelt the given item the given number of times.');
        assert.deepEqual(Object.keys(c.params), ['item_name', 'num']);
        assert.equal(c.params.num.type, 'int');
        assert.equal(c.params.item_name.type, 'ItemName');
    });

    test('smelting on and the storage pack loaded: the skill of the pack, its text word for word', LIMIT, async () => {
        set({ smelting: true, storage_pack: true });
        const calls = [];
        const storage = {
            bindStorage: () => ({}),
            async smeltItem(bot, ctx, item, n) {
                calls.push([bot === agent.bot, typeof ctx, item, n]);
                return { ok: true, reason: null, text: 'I smelted 3 raw_iron into 3 iron_ingot in the furnace at (2, 64, 0) with 1 coal.', smelted: 3, fuel: null };
            },
        };
        const agent = makeGlueAgent(G, { fields: { work_packs: { storage } } });
        const out = await run(agent, '!smeltItem("raw_iron", 3)');
        assert.deepEqual(calls, [[true, 'object', 'raw_iron', 3]]);
        assert.match(String(out), /I smelted 3 raw_iron into 3 iron_ingot in the furnace at \(2, 64, 0\) with 1 coal\./);
        assert.deepEqual(agent.kills, [], 'no restart');
    });

    test('smelting off: the pack is not called (the original command runs)', LIMIT, async () => {
        set({ smelting: false, storage_pack: true });
        const calls = [];
        const storage = { bindStorage: () => ({}), async smeltItem(...a) { calls.push(a); return { ok: true, text: 'x' }; } };
        const agent = makeGlueAgent(G, { fields: { work_packs: { storage } } });
        const out = await run(agent, '!smeltItem("dirt", 1)');
        assert.deepEqual(calls, []);
        assert.match(String(out), /Cannot smelt dirt/);
    });

    test('smelting on but no storage pack: the original command', LIMIT, async () => {
        set({ smelting: true });
        const agent = makeGlueAgent(G, { fields: { work_packs: {} } });
        const out = await run(agent, '!smeltItem("dirt", 1)');
        assert.match(String(out), /Cannot smelt dirt/);
    });
});
