// Spec v0.1.4.7, sections 2 and 7 (part G), in src/agent/agent.js:
//   - _loadWorkPacks imports a pack only while a switch needs it: storage for any of the four
//     switches, farming for farming_pack, wood for wood_pack and mining_pack, mining for mining_pack.
//     A pack that cannot be loaded gives one warning and stays out;
//   - the chest index and the mine store follow the world directory like the area store, live in
//     memory only without world_memory, and are null before the world is known;
//   - packContext() is the home context with chests, mines, storage (bound to the bot), tools, wood
//     and the functions of the home pack.
// Agent.prototype methods are called on fake agents made with Object.create(Agent.prototype).
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
        const agent = await loadSrc('src/agent/agent.js');
        return { settingsModule, index, agent };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const HOME = await loadSrc('src/agent/packs/home/index.js');
const STORAGE = await loadSrc('src/agent/packs/storage/index.js');
const FARMING = await loadSrc('src/agent/packs/farming/index.js');
const WOOD = await loadSrc('src/agent/packs/wood/index.js');
const MINING_READY = fs.existsSync(repoPath('src/agent/packs/mining/index.js'));

const OFF = { world_memory: true, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false };

let cap;
let dir;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    M.settingsModule.setSettings({ ...OFF });
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const fakeAgent = (fields = {}) => Object.assign(Object.create(M.agent.Agent.prototype), { name: 'andy', bot: { username: 'andy' }, ...fields });
const warnings = () => cap.of('warn').map((r) => r.text);

describe('_loadWorkPacks: a pack is imported only while a switch needs it', () => {
    const CASES = [
        [{}, []],
        [{ storage_pack: true }, ['storage']],
        [{ farming_pack: true }, ['storage', 'farming']],
        [{ wood_pack: true }, ['storage', 'wood']],
        [{ mining_pack: true }, ['storage', 'wood', 'mining']],
        [{ storage_pack: true, farming_pack: true, wood_pack: true, mining_pack: true }, ['storage', 'farming', 'wood', 'mining']],
    ];
    for (const [switches, wanted] of CASES) {
        test(`${JSON.stringify(switches)} -> ${wanted.join(', ') || 'nothing'}`, async () => {
            M.settingsModule.setSettings({ ...OFF, ...switches });
            const packs = await fakeAgent()._loadWorkPacks();
            const expected = MINING_READY ? wanted : wanted.filter((name) => name !== 'mining');
            assert.deepEqual(Object.keys(packs).sort(), [...expected].sort());
            if (packs.storage) assert.equal(packs.storage.ChestIndex, STORAGE.ChestIndex, 'the real storage pack');
            if (packs.farming) assert.equal(packs.farming.farmCycle, FARMING.farmCycle, 'the real farming pack');
            if (packs.wood) assert.equal(packs.wood.chopTrees, WOOD.chopTrees, 'the real wood pack');
        });
    }

    test('a pack that cannot be loaded: one warning with its name, the others are loaded', async () => {
        // the loader of the test fails for the mining pack, the others are loaded for real
        const loaders = { mining: () => Promise.reject(new Error('the mining pack is broken')) };
        M.settingsModule.setSettings({ ...OFF, mining_pack: true });
        const packs = await fakeAgent()._loadWorkPacks(loaders);
        assert.deepEqual(Object.keys(packs).sort(), ['storage', 'wood']);
        assert.equal(warnings().length, 1, warnings().join('\n'));
        assert.match(warnings()[0], /^Could not load the mining pack, its commands stay hidden:/);
    });
});

describe('_workStores: the chest index and the mine store follow the world', () => {
    class FakeMineStore {
        constructor(filePath) {
            this.filePath = filePath;
            this.loaded = 0;
        }
        load() {
            this.loaded++;
            return 0;
        }
    }
    const packs = () => ({ storage: { ChestIndex: STORAGE.ChestIndex }, mining: { MineStore: FakeMineStore } });

    test('without work_packs: nothing is made', () => {
        const agent = fakeAgent({ world_memory: { worldDir: dir } });
        assert.deepEqual(agent._workStores(), { chests: null, mines: null });
        assert.equal(agent.work_stores, undefined);
    });

    test('with world_memory: null before the world is known, then one per world directory, again when it changes', () => {
        M.settingsModule.setSettings({ ...OFF, storage_pack: true, mining_pack: true });
        const agent = fakeAgent({ work_packs: packs(), world_memory: { worldDir: null } });
        assert.deepEqual(agent._workStores(), { chests: null, mines: null });
        agent.world_memory.worldDir = path.join(dir, 'w1');
        fs.mkdirSync(agent.world_memory.worldDir);
        const first = agent._workStores();
        assert.ok(first.chests instanceof STORAGE.ChestIndex);
        assert.equal(first.chests.filePath, `${agent.world_memory.worldDir}/chests.json`);
        assert.equal(first.mines.filePath, `${agent.world_memory.worldDir}/mines.json`);
        assert.equal(first.mines.loaded, 1);
        const again = agent._workStores();
        assert.equal(again.chests, first.chests, 'the same world: the same index');
        assert.equal(again.mines, first.mines);
        assert.equal(first.mines.loaded, 1, 'loaded once');
        agent.world_memory.worldDir = path.join(dir, 'w2');
        const other = agent._workStores();
        assert.notEqual(other.chests, first.chests, 'another world: another index');
        assert.equal(other.chests.filePath, `${agent.world_memory.worldDir}/chests.json`);
    });

    test('the index keeps its chests in the file of its world', () => {
        M.settingsModule.setSettings({ ...OFF, storage_pack: true });
        const agent = fakeAgent({ work_packs: packs(), world_memory: { worldDir: dir } });
        const { chests } = agent._workStores();
        chests.update({ x: 1, y: 64, z: 2, dimension: 'overworld', kind: 'chest', items: { bread: 5 }, free_slots: 20, seen: '2026-09-28T00:00:00.000Z' });
        const reopened = fakeAgent({ work_packs: packs(), world_memory: { worldDir: dir } })._workStores().chests;
        assert.equal(reopened.size, 1);
        assert.equal(reopened.find('bread', 'overworld').length, 1);
    });

    test('without world_memory: in memory only', () => {
        M.settingsModule.setSettings({ ...OFF, world_memory: false, storage_pack: true, mining_pack: true });
        const agent = fakeAgent({ work_packs: packs() });
        const stores = agent._workStores();
        assert.equal(stores.chests.filePath, null);
        assert.equal(stores.mines.filePath, null);
        assert.equal(agent._workStores().chests, stores.chests);
    });

    test('a pack without its store, a store that cannot be made: null and a warning', () => {
        M.settingsModule.setSettings({ ...OFF, storage_pack: true });
        assert.deepEqual(fakeAgent({ work_packs: { storage: {} }, world_memory: { worldDir: dir } })._workStores(), { chests: null, mines: null });
        class Broken {
            constructor() {
                throw new Error('disk full');
            }
        }
        assert.equal(fakeAgent({ work_packs: { storage: { ChestIndex: Broken } }, world_memory: { worldDir: dir } })._workStores().chests, null);
        assert.match(warnings().join('\n'), /Could not open chests\.json of this world/);
    });
});

describe('packContext (spec section 2)', () => {
    test('the home context and the new fields; without packs they are null', () => {
        const agent = fakeAgent({ area_store: { areas: true }, memory_bank: { places: true } });
        const ctx = agent.packContext();
        const home = agent.homeContext();
        for (const key of Object.keys(home)) assert.ok(Object.hasOwn(ctx, key), key);
        assert.equal(ctx.areas, agent.area_store);
        assert.equal(ctx.places, agent.memory_bank);
        for (const key of ['chests', 'mines', 'storage', 'tools', 'wood']) assert.equal(ctx[key], null, key);
        assert.equal(ctx.home.passThrough, HOME.passThrough);
        assert.equal(ctx.home.enterBuilding, HOME.enterBuilding);
        assert.equal(ctx.home.doorIsSafe, HOME.doorIsSafe);
    });

    test('with packs: storage bound to the bot and this context, tools and wood of the wood pack, the stores of the world', () => {
        M.settingsModule.setSettings({ ...OFF, storage_pack: true, wood_pack: true });
        const bound = [];
        const wood = { TOOLS_API: { ensureTool() {}, craftSupplies() {} }, WOOD_API: { chopTrees() {} } };
        const agent = fakeAgent({
            work_packs: { storage: { ChestIndex: STORAGE.ChestIndex, bindStorage: (bot, ctx) => { bound.push({ bot, ctx }); return { storeItems() {}, fetchItem() {} }; } }, wood },
            world_memory: { worldDir: dir },
        });
        const ctx = agent.packContext();
        assert.ok(ctx.chests instanceof STORAGE.ChestIndex);
        assert.equal(ctx.mines, null);
        assert.equal(bound.length, 1);
        assert.equal(bound[0].bot, agent.bot);
        assert.equal(bound[0].ctx, ctx);
        assert.equal(typeof ctx.storage.fetchItem, 'function');
        assert.equal(ctx.tools, wood.TOOLS_API);
        assert.equal(ctx.wood, wood.WOOD_API);
        assert.equal(agent.packContext().chests, ctx.chests, 'the same index for the next context');
    });

    test('with the real packs: ctx.storage has storeItems and fetchItem; tools and wood are TOOLS_API and WOOD_API, not bound', () => {
        M.settingsModule.setSettings({ ...OFF, storage_pack: true });
        const storageOnly = fakeAgent({ work_packs: { storage: STORAGE }, world_memory: { worldDir: dir } }).packContext();
        assert.equal(typeof storageOnly.storage.storeItems, 'function');
        assert.equal(typeof storageOnly.storage.fetchItem, 'function');
        assert.equal(storageOnly.tools, null);
        M.settingsModule.setSettings({ ...OFF, wood_pack: true });
        const ctx = fakeAgent({ work_packs: { storage: STORAGE, wood: WOOD }, world_memory: { worldDir: dir } }).packContext();
        assert.equal(ctx.tools, WOOD.TOOLS_API);
        assert.equal(ctx.tools.ensureTool, WOOD.ensureTool);
        assert.equal(ctx.tools.craftSupplies, WOOD.craftSupplies);
        assert.equal(ctx.wood, WOOD.WOOD_API);
        assert.equal(ctx.wood.chopTrees, WOOD.chopTrees);
    });

    test('the finished packs export every name the glue calls', () => {
        for (const name of ['ChestIndex', 'bindStorage', 'storeItems', 'fetchItem', 'chestsText', 'lookIntoChest']) assert.equal(typeof STORAGE[name], 'function', `storage ${name}`);
        for (const name of ['harvestCrops', 'plantField', 'makeBoneMeal', 'fertilize', 'farmCycle', 'harvestTarget']) assert.equal(typeof FARMING[name], 'function', `farming ${name}`);
        for (const name of ['chopTrees', 'ensureTool', 'craftSupplies', 'woodKind']) assert.equal(typeof WOOD[name], 'function', `wood ${name}`);
        assert.equal(typeof WOOD.TOOLS_API, 'object');
        assert.equal(typeof WOOD.WOOD_API, 'object');
    });

    test('the mining pack, once it exists, exports every name the glue calls', async (t) => {
        if (!MINING_READY) {
            t.skip('the mining pack is in work');
            return;
        }
        const MINING = await loadSrc('src/agent/packs/mining/index.js');
        for (const name of ['MineStore', 'mineOre', 'descendToLevel', 'climbToSurface', 'oreOf']) assert.equal(typeof MINING[name], 'function', `mining ${name}`);
    });
});
