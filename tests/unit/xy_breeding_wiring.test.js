// Spec v0.1.4.16, 8.0 to 8.2 (E6): the wiring of the breeding pack and of the stock permits in src/agent/agent.js and
// src/agent/commands/actions.js: _loadWorkPacks loads the breeding pack behind breeding (and the storage pack for the chests
// of all three packs of round two); !breed and !allowTaking are hidden while their switches are off; ctx.permits (the
// StockPermits of the world) with any of the three switches; ctx.stock.takeOrAsk while the breeding pack is loaded; !breed
// through runPack; !allowTaking through runPlain, only on a player's word (O-3), the line said through agent.sayText.
// Agent.prototype methods are called on fake agents made with Object.create(Agent.prototype).
import { describe, test, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { blockedPushes } from '../helpers/st_glue_env.js'; // registers the mcdata hook (once per process)

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const agent = await loadSrc('src/agent/agent.js');
        return { settingsModule, mcdata, index, agent };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const { Agent } = M.agent;
const BREEDING = await loadSrc('src/agent/packs/breeding/index.js');
const P = await loadSrc('src/agent/world/stock_permits.js');
const SOURCE = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8').replace(/\r\n/g, '\n');

const OFF = { language: 'en', world_memory: true, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false, routes_pack: false,
    mine_routes: false, watch_and_learn: false, base_survey: false, routines: false, breeding: false, enchanting: false, afk_kill: false,
    knowledge_in_prompt: false, blocked_actions: [] };

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
before(() => M.mcdata.__setMcdataForTests(minecraftData(TEST_MC_VERSION)));
after(() => M.mcdata.__setMcdataForTests(null));

const fakeAgent = (fields = {}) => Object.assign(Object.create(Agent.prototype), { name: 'andy', bot: { username: 'andy' }, ...fields });
const warnings = () => cap.of('warn').map((r) => r.text);
const command = (name) => {
    const cmd = M.index.getCommand(name);
    assert.ok(cmd, `${name} exists`);
    return cmd;
};

describe('agent.js: the loading, the hidden commands, the stores (8.0, 8.1)', () => {
    test('_loadWorkPacks: the breeding pack behind breeding, with the storage pack for the chests; the other two switches load the storage pack', async () => {
        M.settingsModule.setSettings({ ...OFF, breeding: true });
        const packs = await fakeAgent()._loadWorkPacks();
        assert.ok(packs.storage && packs.breeding, Object.keys(packs).join(', '));
        assert.equal(packs.breeding.takeOrAsk, BREEDING.takeOrAsk, 'the real breeding pack');
        for (const key of ['enchanting', 'afk_kill']) {
            M.settingsModule.setSettings({ ...OFF, [key]: true });
            const other = await fakeAgent()._loadWorkPacks();
            assert.ok(other.storage, `${key}: the storage pack (the chest index, fetchItem, storeItems)`);
            assert.equal(other.breeding, undefined, `${key}: no breeding pack`);
        }
    });

    test('a breeding pack that cannot be loaded: one warning with its name', async () => {
        M.settingsModule.setSettings({ ...OFF, breeding: true });
        const packs = await fakeAgent()._loadWorkPacks({ breeding: () => Promise.reject(new Error('broken')), storage: async () => ({}) });
        assert.equal(packs.breeding, undefined);
        assert.ok(warnings().some((w) => /^Could not load the breeding pack, its commands stay hidden:/.test(w)), warnings().join('\n'));
    });

    test('source: import() of ./packs/breeding/index.js behind breeding and inside try', () => {
        const at = SOURCE.indexOf("import('./packs/breeding/index.js')");
        assert.ok(at > 0);
        const before = SOURCE.slice(SOURCE.lastIndexOf('if (settings.breeding) {', at), at);
        assert.match(before, /^if \(settings\.breeding\) \{\n\s+try \{\n\s+packs\.breeding = await \(loaders\.breeding \? loaders\.breeding\(\) : $/);
    });

    test('the hidden commands: !breed without breeding or its pack; !allowTaking while all three switches are off; before the blacklist', () => {
        const pushes = blockedPushes();
        const of = (name) => pushes.filter((p) => p.names.includes(name));
        assert.deepEqual(of('!breed'), [{ test: '!settings.breeding || !this.work_packs?.breeding', names: ['!breed'] }]);
        assert.deepEqual(of('!allowTaking'), [{ test: '!settings.breeding && !settings.enchanting && !settings.afk_kill', names: ['!allowTaking'] }]);
        const end = SOURCE.indexOf('blacklistCommands(this.blocked_actions);');
        assert.ok(SOURCE.indexOf("push('!breed')") < end && SOURCE.indexOf("push('!allowTaking')") < end);
    });

    test('ctx.permits: the StockPermits of the world (<world>/permits.json) with any of the three switches, none without', () => {
        for (const key of ['breeding', 'enchanting', 'afk_kill']) {
            M.settingsModule.setSettings({ ...OFF, [key]: true });
            const stores = fakeAgent({ work_packs: {}, world_memory: { worldDir: dir } })._workStores();
            assert.ok(stores.permits instanceof P.StockPermits, key);
            assert.equal(stores.permits.filePath, `${dir}/permits.json`, key);
        }
        M.settingsModule.setSettings({ ...OFF });
        assert.equal('permits' in fakeAgent({ work_packs: {}, world_memory: { worldDir: dir } })._workStores(), false);
    });

    test('a permit is kept in the file of the world: a new agent of the same world reads it', () => {
        M.settingsModule.setSettings({ ...OFF, breeding: true });
        fakeAgent({ work_packs: {}, world_memory: { worldDir: dir } })._workStores().permits.set('wheat', true);
        assert.equal(fakeAgent({ work_packs: {}, world_memory: { worldDir: dir } })._workStores().permits.may('wheat'), true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'permits.json'), 'utf8')).items.wheat.allowed, true);
    });

    test('packContext: ctx.stock.takeOrAsk while the breeding pack is loaded, not bound; absent without it', () => {
        M.settingsModule.setSettings({ ...OFF, breeding: true });
        const ctx = fakeAgent({ work_packs: { breeding: BREEDING }, world_memory: { worldDir: dir } }).packContext();
        assert.equal(ctx.stock.takeOrAsk, BREEDING.takeOrAsk);
        assert.ok(ctx.permits instanceof P.StockPermits);
        M.settingsModule.setSettings({ ...OFF, enchanting: true });
        const other = fakeAgent({ work_packs: {}, world_memory: { worldDir: dir } }).packContext();
        assert.equal(other.stock, undefined, 'the enchanting pack asks with its own copy of the texts then (8.1)');
        assert.ok(other.permits instanceof P.StockPermits);
    });
});

// A fake agent for the commands: runAction runs the action; packContext gives the permits of a test.
function commandAgent({ packs = {}, permits = new P.StockPermits(null), order = null, typedBy = null } = {}) {
    const agent = {
        name: 'andy',
        bot: { username: 'andy', modes: { pause() {} } },
        work_packs: packs,
        runs: [],
        said: [],
        last_order: order,
        running_commands: typedBy ? [{ name: '!allowTaking', typed: true, by: typedBy }] : [{ name: '!allowTaking', typed: false }],
        packContext: () => ({ marker: 'ctx', permits }),
        sayText: (text) => agent.said.push(text),
        actions: {
            async runAction(label, fn) {
                agent.runs.push(label);
                await fn();
                return { success: true, message: 'Action output:\n', interrupted: false, timedout: false };
            },
        },
    };
    return agent;
}

describe('actions.js: !breed (8.2)', () => {
    test('the docs and the parameters: one line of docs word for word, count 2 by default, 1 to 12', () => {
        const cmd = command('!breed');
        assert.equal(cmd.description, 'Breed the animals of a saved pen from outside its fence: feed pairs until count new animals, never opening a gate.');
        assert.deepEqual(Object.keys(cmd.params), ['pen', 'count']);
        assert.equal(cmd.params.count.type, 'int');
        assert.equal(cmd.params.count.default, 2);
        assert.deepEqual(M.index.parseCommandMessage('!breed("cow_pen")'), { commandName: '!breed', args: ['cow_pen', 2] });
        assert.equal(typeof M.index.parseCommandMessage('!breed("cow_pen", 20)'), 'string', 'more than the cap is refused by the parser');
    });

    test('off: the pack-off line; on without the pack: it could not be loaded; on: runPack with bot, ctx, pen and count', async () => {
        assert.equal(await command('!breed').perform(commandAgent(), 'cow_pen', 2), 'The breeding pack is off.');
        M.settingsModule.setSettings({ ...OFF, breeding: true });
        assert.equal(await command('!breed').perform(commandAgent(), 'cow_pen', 2), 'The breeding pack could not be loaded.');
        const calls = [];
        const pack = { breed: async (...args) => { calls.push(args); return { ok: true, reason: null, text: 'I fed 4 cows in the cow pen; 2 calves.' }; } };
        const agent = commandAgent({ packs: { breeding: pack } });
        assert.equal(await command('!breed').perform(agent, 'cow_pen', 2), 'I fed 4 cows in the cow pen; 2 calves.');
        assert.deepEqual(agent.runs, ['action:breed']);
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], agent.bot);
        assert.equal(calls[0][1].marker, 'ctx');
        assert.deepEqual(calls[0].slice(2), ['cow_pen', 2]);
    });
});

describe('actions.js: !allowTaking (8.1)', () => {
    test('the docs and the parameters: one line of docs word for word, an item name and a boolean', () => {
        const cmd = command('!allowTaking');
        assert.equal(cmd.description, 'Allow (true) or forbid (false) the bot to take an item from the chests it knows for its work, for example wheat or lapis_lazuli.');
        assert.deepEqual(Object.keys(cmd.params), ['item', 'allowed']);
        assert.equal(cmd.params.item.type, 'ItemName');
        assert.equal(cmd.params.allowed.type, 'boolean');
        assert.deepEqual(M.index.parseCommandMessage('!allowTaking("lapis_lazuli", true)'), { commandName: '!allowTaking', args: ['lapis_lazuli', true] });
        assert.equal(M.index.parseCommandMessage('!allowTaking("lapis", true)'), 'Invalid item type: lapis.', 'the model must give the item name');
    });

    test('all three switches off: the pack-off line, nothing set', async () => {
        const permits = new P.StockPermits(null);
        assert.equal(await command('!allowTaking').perform(commandAgent({ permits, typedBy: 'steve' }), 'wheat', true), 'The breeding pack is off.');
        assert.equal(permits.size, 0);
    });

    test('the model answers the owner\'s "yes": the permit is set, the line said through sayText, the model gets the short answer; no action', async () => {
        M.settingsModule.setSettings({ ...OFF, breeding: true });
        const permits = new P.StockPermits(null);
        const agent = commandAgent({ permits, order: { by: 'steve', command: '!allowTaking', typed: false } });
        assert.equal(await command('!allowTaking').perform(agent, 'carrot', true), 'Done; I said it in the chat.');
        assert.deepEqual(agent.said, ['I may take carrot from the chests now.']);
        assert.equal(permits.may('carrot'), true);
        assert.deepEqual(agent.runs, [], 'a plain command: the running feeding goes on');
        assert.equal(await command('!allowTaking').perform(agent, 'carrot', false), 'Done; I said it in the chat.');
        assert.deepEqual(agent.said[1], 'I take no carrot from the chests.');
        assert.equal(permits.may('carrot'), false);
    });

    test('typed by the owner: the line is the answer itself (said once); with enchanting or afk_kill alone too', async () => {
        for (const key of ['enchanting', 'afk_kill']) {
            M.settingsModule.setSettings({ ...OFF, [key]: true });
            const permits = new P.StockPermits(null);
            const agent = commandAgent({ permits, typedBy: 'steve' });
            assert.equal(await command('!allowTaking').perform(agent, 'lapis_lazuli', true), 'I may take lapis_lazuli from the chests now.', key);
            assert.deepEqual(agent.said, [], key);
            assert.equal(permits.may('lapis_lazuli'), true, key);
        }
    });

    test('no player\'s word (the model on its own, a routine, the bot itself): the no-permit line, the permit unchanged, a log line', async () => {
        M.settingsModule.setSettings({ ...OFF, breeding: true });
        const permits = new P.StockPermits(null);
        for (const order of [null, { by: 'steve', command: '!breed', typed: false }, { by: 'system', command: '!allowTaking' }, { by: 'andy', command: '!allowTaking' }]) {
            const agent = commandAgent({ permits, order });
            assert.equal(await command('!allowTaking').perform(agent, 'wheat', true),
                'I take no wheat without your word; say "you may take wheat" when you want.', JSON.stringify(order));
            assert.deepEqual(agent.said, []);
        }
        assert.equal(permits.size, 0);
        assert.ok(cap.of('log').some((r) => /!allowTaking\("wheat", true\): no player's word/.test(r.text)));
    });

    test('no store of permits yet (the world is not known): the line of runPlain', async () => {
        M.settingsModule.setSettings({ ...OFF, breeding: true });
        const agent = commandAgent({ permits: null, typedBy: 'steve' });
        assert.equal(await command('!allowTaking').perform(agent, 'wheat', true), 'The stock permits pack could not be loaded.');
    });
});
