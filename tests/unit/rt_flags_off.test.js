// T1, spec v0.1.4.9 section 0 rule 6 and W74: every new switch off gives the behaviour of v0.1.4.8. Two cases for
// the glue: the settings at the defaults of section 2 (read from settings_spec.json), and a settings object without
// the new keys at all (a settings.js of v0.1.4.8). The pure functions are compared with the code of the tag
// v0.1.4.8 (tests/helpers/rt_old_source.js) where they take the switch as an argument or as a missing field.
// Also tested elsewhere: sleepInBed without ctx.routes (rt_routes_pack), mineOre without mine_routes and without
// ctx.routes (rt_mine_player), tunnelView/tunnelStep with senseRange 0 (rt_mine_logic), mineOreText without extra
// (rt_mine_texts), the six commands hidden, !newAction and !goToRememberedPlace with the switches off (rt_glue).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { loadOld } from '../helpers/rt_old_source.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue, makeGlueAgent } from '../helpers/st_glue_env.js';

const G = await loadGlue();
await import('ses');
const K = await loadSrc('src/agent/knowledge/knowledge_text.js');
const OLD_K = await loadOld('src/agent/knowledge/knowledge_text.js');
const WAY = await loadSrc('src/agent/packs/mining/mine_way.js');
const MINING = await loadSrc('src/agent/packs/mining/index.js');

const SPEC = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
const NEW_KEYS = ['routes_pack', 'trail_max_steps', 'mine_routes', 'ore_sense_range', 'skills_over_code'];
const OLD = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: true, protected_areas: false,
    home_pack: true, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: true, narrate_behavior: false, allow_insecure_coding: true };
const DEFAULTS = { ...OLD, ...Object.fromEntries(NEW_KEYS.map((k) => [k, SPEC[k]?.default])) };
const LIMIT = { timeout: 30000 };

let cap;
let dir;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

for (const [label, settings] of [['the defaults of section 2', DEFAULTS], ['a settings.js without the new keys (v0.1.4.8)', OLD]]) {
    describe(`every new switch off: ${label}`, () => {
        beforeEach(() => G.settingsModule.setSettings({ ...settings }));

        test('the routes pack is not imported', LIMIT, async () => {
            const agent = makeGlueAgent(G);
            const loaded = [];
            const loaders = Object.fromEntries(['storage', 'farming', 'wood', 'mining', 'routes'].map((n) => [n, async () => { loaded.push(n); return {}; }]));
            const packs = await agent._loadWorkPacks(loaders);
            assert.ok(!loaded.includes('routes'), JSON.stringify(loaded));
            assert.equal(packs.routes, undefined);
        });

        test('no routes on the context, no trail, no trail.json', () => {
            const agent = makeGlueAgent(G, { fields: { work_packs: { mining: MINING }, world_memory: { worldDir: dir } } });
            assert.equal(agent.homeContext().routes ?? null, null);
            assert.equal(agent._trail?.() ?? null, null);
            assert.equal(fs.existsSync(path.join(dir, 'trail.json')), false);
        });

        test('the mine routes are off: whereAmI gives mine null', () => {
            const agent = makeGlueAgent(G, { fields: { work_packs: { mining: MINING } } });
            assert.equal(agent._mineRoutesOn(), false);
            assert.equal(agent.whereAmI().mine, null);
        });

        test('!newAction about digging reaches the code model (no refusal)', LIMIT, async () => {
            const coder = { calls: 0, last_run: null, async generateCode() { this.calls++; return 'Code ran.'; } };
            const agent = makeGlueAgent(G, { fields: { coder } });
            await G.index.executeCommand(agent, '!newAction("dig a tunnel to the east")', { typed: false });
            assert.equal(coder.calls, 1);
        });

        test('the mining pack reads the switches as off', () => {
            const ctx = { settings: { ...settings } };
            assert.equal(WAY.mineRoutesOn(ctx), false);
            assert.equal(WAY.senseRangeOf(ctx), 0);
            assert.equal(WAY.mineRoutesOn({ settings: { ...settings }, routes: null }), false);
        });
    });
}

describe('the pure functions without the new fields are those of v0.1.4.8', () => {
    const INPUTS = [
        { where: { area: { name: 'farm', type: 'farm' }, depth: 0, underground: false } },
        { where: { area: null, depth: 26, underground: true }, areas: [{ name: 'home', type: 'home' }, { name: 'farm', type: 'farm', entrances: [{ kind: 'gate' }] }] },
        { mines: [{ ore: 'iron', ores: ['iron', 'gold'], entrance: { x: 9, y: 67, z: 58 }, level: 16 }], places: [{ name: 'home', x: 12, y: 67, z: 52 }] },
        { chests: [{ x: 11, y: 67, z: 53, items: { wheat: 28, cobblestone: 81 } }, { x: 11, y: 41, z: 44, items: {} }],
            where: { area: { name: 'mine', type: 'mine' }, depth: 35, underground: true, pos: { x: 10, y: 40, z: 44 } } },
    ];

    INPUTS.forEach((input, i) => {
        test(`knowledgeText, input ${i + 1}`, (t) => {
            if (!OLD_K) return t.skip('the tag v0.1.4.8 is not in this checkout');
            assert.equal(K.knowledgeText(input), OLD_K.knowledgeText(input));
            assert.equal(K.knowledgeText(input, 200), OLD_K.knowledgeText(input, 200));
        });
    });

    test('whereLine without where.mine', (t) => {
        if (!OLD_K) return t.skip('the tag v0.1.4.8 is not in this checkout');
        for (const where of [{ area: null, depth: 0, underground: false }, { area: { name: 'x', type: null }, depth: 1, underground: true },
            { area: null, depth: 12, underground: true, mine: null }]) {
            assert.equal(K.whereLine(where), OLD_K.whereLine(where), JSON.stringify(where));
        }
    });

    test('a mine without passed: no line of the ore left behind', () => {
        assert.ok(!K.knowledgeText({ mines: [{ ore: 'iron', entrance: { x: 1, y: 2, z: 3 }, level: 16 }] }).includes('Ore left behind'));
    });
});
