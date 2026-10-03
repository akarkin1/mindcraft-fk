// Release v0.1.4.11, fix round F28 (engineer E6): "this is the mine" came as !rememberArea("mine", "mine"), and no mine
// of the player was recorded, so "find some iron" knew no mine. Decision: with the mine routes on (mining_pack,
// routes_pack, mine_routes) a saved area of type mine also records the mine of the player at the bot's position as
// !rememberMine(name) does, when no mine of the player holds the bot yet, and the answer gets its sentence. Otherwise,
// or when that record fails, the answer of the area stands alone. src/agent/commands/actions.js.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        await loadSrc('src/agent/commands/index.js'); // first, as the agent loads them
        const actions = await loadSrc('src/agent/commands/actions.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, actions, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const AS = await loadSrc('src/agent/areas/area_store.js');

const BASE = { language: 'en', world_memory: true, protected_areas: true, player_rules: true, area_floors: false, home_pack: false,
    blocked_actions: [], mining_pack: true, routes_pack: true, mine_routes: true };
const NOW = () => new Date('2026-10-01T10:00:00Z');
const AREA_TEXT = /^I saved a box of .* as the mine "mine"\. Use !setArea to correct it\.$/;
const MINE_TEXT = 'I remember the mine "mine".';

let cap;
let dir;
before(() => M.mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => M.mcdata.__setMcdataForTests(null));
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    M.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const rememberArea = M.actions.actionsList.find((c) => c.name === '!rememberArea');

// An agent on open ground (no building: the area is the box around the bot) with a mining pack that records calls.
function mineAgent({ mines = [], result = { ok: true, reason: null, text: MINE_TEXT, mine: {} }, here = null } = {}) {
    const world = createBlockWorld().flatGround(63);
    const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: NOW });
    store.load();
    const calls = [];
    const mining = {
        mineAt: (list, pos) => { calls.push(['mineAt', list.length, pos]); return here; },
        rememberMine: async (bot, ctx, name) => {
            calls.push(['rememberMine', name]);
            if (result instanceof Error)
                throw result;
            return result;
        },
    };
    const agent = {
        name: 'andy', area_store: store, running_commands: [], work_packs: { mining }, calls,
        packContext: () => ({ mines: { list: () => mines, set: () => null } }),
        memory_bank: { rememberPlace: () => true },
        bot: { username: 'andy', entity: { position: vec(10.5, 64, 10.5) }, game: { dimension: 'overworld' }, blockAt: (pos) => world.blockAt(pos) },
    };
    return agent;
}

describe('F28: !rememberArea(name, "mine") records the mine too', () => {
    test('no mine here: the mine is recorded and its sentence follows the area', async () => {
        const agent = mineAgent({ mines: [{ name: 'old', source: 'player' }, { name: 'auto', source: 'bot' }] });
        const reply = await rememberArea.perform(agent, 'mine', 'mine');
        assert.ok(reply.endsWith(` ${MINE_TEXT}`), reply);
        assert.match(reply.slice(0, -MINE_TEXT.length - 1), AREA_TEXT);
        assert.equal(agent.area_store.get('mine').type, 'mine');
        assert.deepEqual(agent.calls, [['mineAt', 1, { x: 10, y: 64, z: 10 }], ['rememberMine', 'mine']], 'only the mines of the player count');
    });

    test('a mine of the player holds the bot already: nothing is appended, nothing recorded', async () => {
        const agent = mineAgent({ mines: [{ name: 'mine', source: 'player' }], here: { mine: { name: 'mine' }, tunnel: 0, onRoute: false } });
        const reply = await rememberArea.perform(agent, 'mine', 'mine');
        assert.match(reply, AREA_TEXT);
        assert.ok(!agent.calls.some(c => c[0] === 'rememberMine'));
    });

    test('the record fails or throws: the answer of the area stands alone', async () => {
        const failed = mineAgent({ result: { ok: false, reason: 'no_trail', text: 'I have no trail.', mine: null } });
        assert.match(await rememberArea.perform(failed, 'mine', 'mine'), AREA_TEXT);
        const thrown = mineAgent({ result: new Error('boom') });
        assert.match(await rememberArea.perform(thrown, 'mine', 'mine'), AREA_TEXT);
        assert.ok(thrown.calls.some(c => c[0] === 'rememberMine'));
    });

    test('mining_pack, routes_pack or mine_routes off, or no pack: as before', async () => {
        for (const off of [{ mining_pack: false }, { routes_pack: false }, { mine_routes: false }]) {
            M.settingsModule.setSettings({ ...BASE, ...off });
            const agent = mineAgent();
            assert.match(await rememberArea.perform(agent, 'mine', 'mine'), AREA_TEXT);
            assert.deepEqual(agent.calls, [], JSON.stringify(off));
        }
        M.settingsModule.setSettings({ ...BASE });
        const agent = mineAgent();
        agent.work_packs = {};
        assert.match(await rememberArea.perform(agent, 'mine', 'mine'), AREA_TEXT);
    });

    test('another type records no mine', async () => {
        const agent = mineAgent();
        await rememberArea.perform(agent, 'house', 'home');
        assert.deepEqual(agent.calls, []);
    });
});
