// Spec v0.1.4.3 W8: src/agent/world/world_memory.js -- WorldMemory, the coordinator between the
// bot connection, the world registry, History and MemoryBank.
//
// Fake connection: an EventEmitter as bot._client that receives raw packets. Real History
// (defer_storage: true, bots_dir in a temp directory, fake agent) and real MemoryBank.
// The clock is injected; the working directory is an empty temp directory during every test.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeFakeAgent } from '../helpers/fake_agent.js';
import { listFiles, samePath } from '../helpers/tree.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/world/world_memory.js';
const WM = await loadSrc(MODULE);
const H = await loadSrc('src/agent/history.js');
const MB = await loadSrc('src/agent/memory_bank.js');

const NAME = 'zz_test_andy';
const hex64 = (value) => BigInt.asUintN(64, BigInt(value)).toString(16).padStart(16, '0');
const words = (high, low) => hex64((BigInt.asUintN(32, BigInt(high)) << 32n) | BigInt.asUintN(32, BigInt(low)));
const sha16 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

// Seeds as the protocol library delivers them: [high, low] with a valueOf method.
function i64(high, low) {
    const arr = [high, low];
    arr.valueOf = () => 123;
    return arr;
}
const SEED_A = i64(0x12345678, 0x9abcdef0 | 0);
const SEED_B = i64(-1, 7);
const KEY_A = `seed-${words(0x12345678, 0x9abcdef0)}`;
const KEY_B = `seed-${words(-1, 7)}`;

const T1 = Date.UTC(2026, 8, 20, 12, 0, 0);
const T2 = Date.UTC(2026, 8, 24, 12, 0, 0);
const T3 = Date.UTC(2026, 8, 27, 13, 4, 5);
const STAMP_T3 = '20260927-130405';

const ADOPTED = 'Your earlier memory was carried over into this world.';
const firstVisitAdoptedNote = (label) => `You are in the world "${label}". This is your first visit here. Your earlier memory was carried over into this world.`;
const firstVisitNote = (label) => `You are in the world "${label}". This is your first visit here: you have no memories and no saved places in this world.`;
const knownNote = (label, date, places) => `You are in the world "${label}". Your last visit was on ${date}. Saved places here: ${places}.`;

let originalCwd;
let fakeCwd;
let botsDir;
let cap;
let clock;

before(() => {
    originalCwd = process.cwd();
});
after(() => {
    process.chdir(originalCwd);
});
beforeEach(() => {
    fakeCwd = makeTmpDir();
    process.chdir(fakeCwd);
    botsDir = makeTmpDir();
    cap = captureConsole();
    clock = T1;
});
afterEach(() => {
    cap.restore();
    process.chdir(originalCwd);
    removeTmpDir(botsDir);
    removeTmpDir(fakeCwd);
});

const botDir = () => path.join(botsDir, NAME);
const worldDir = (key) => path.join(botsDir, NAME, 'worlds', key);
const readIndex = () => JSON.parse(fs.readFileSync(path.join(botDir(), 'worlds', 'index.json'), 'utf8'));

function makeBot(dimension = 'minecraft:overworld') {
    return { _client: new EventEmitter(), game: { dimension } };
}

function loginPacket(hashedSeed, { isHardcore = false, isFlat = false, name = 'minecraft:overworld' } = {}) {
    return { entityId: 1, isHardcore, worldNames: [name], worldState: { dimension: 0, name, hashedSeed, gamemode: 'survival', isDebug: false, isFlat } };
}

// A fresh bot session: History, MemoryBank, WorldMemory attached to a fake connection.
function session({ seed = SEED_A, motd = null, age = undefined, settings = {}, login = true, packets = null } = {}) {
    assert.equal(typeof WM.WorldMemory, 'function', 'WorldMemory must be an exported class');
    const agent = makeFakeAgent(NAME);
    const history = new H.History(agent, { bots_dir: botsDir, defer_storage: true });
    const memoryBank = new MB.MemoryBank();
    const wm = new WM.WorldMemory({ name: NAME, botsDir, settings, history, memoryBank, now: () => new Date(clock) });
    const bot = makeBot();
    wm.attach(bot);
    const client = bot._client;
    if (packets) {
        for (const [event, data] of packets) client.emit(event, data);
    } else {
        if (login) client.emit('login', loginPacket(seed));
        if (motd !== null) client.emit('server_data', { motd, enforcesSecureChat: false });
        if (age !== undefined) client.emit('update_time', { age, time: [0, 6000], tickDayTime: true });
    }
    return { agent, history, memoryBank, wm, bot, client };
}

async function resolved(options = {}, resolveOptions = {}) {
    const s = session(options);
    s.result = await s.wm.resolve(resolveOptions);
    return s;
}

describe('attach(bot)', () => {
    test('without bot or bot._client it does nothing and does not throw', () => {
        const wm = new WM.WorldMemory({ name: NAME, botsDir, settings: {}, history: new H.History(makeFakeAgent(NAME), { bots_dir: botsDir, defer_storage: true }), memoryBank: new MB.MemoryBank(), now: () => new Date(clock) });
        for (const bot of [undefined, null, {}, { _client: null }]) {
            assert.doesNotThrow(() => wm.attach(bot));
        }
    });

    test('login packet: the key comes from worldState.hashedSeed', async () => {
        const { result, wm } = await resolved({ seed: SEED_A });
        assert.equal(result.key, KEY_A);
        assert.equal(result.source, 'seed');
        assert.equal(wm.world.key, KEY_A);
    });

    test('every login counts, the latest wins', async () => {
        const { result } = await resolved({ packets: [['login', loginPacket(SEED_A)], ['login', loginPacket(SEED_B)]] });
        assert.equal(result.key, KEY_B);
    });

    test('malformed packets are ignored and do not throw', async () => {
        const s = session({ seed: SEED_A, motd: 'Good Server', age: [0, 500] });
        for (const event of ['login', 'server_data', 'update_time']) {
            for (const bad of [null, undefined, 42, 'text']) {
                assert.doesNotThrow(() => s.client.emit(event, bad), `${event} ${String(bad)}`);
            }
        }
        const result = await s.wm.resolve();
        assert.equal(result.key, KEY_A);
        assert.equal(result.label, 'Good Server');
    });

    test('server_data: the latest motd is kept and becomes the label', async () => {
        const { result } = await resolved({ packets: [['login', loginPacket(SEED_A)], ['server_data', { motd: 'First' }], ['server_data', { motd: { text: 'Second', extra: [' Server'] } }]] });
        assert.equal(result.key, KEY_A);
        assert.equal(result.label, 'Second Server');
    });

    test('all-zero seed: fallback key from the motd', async () => {
        const { result } = await resolved({ seed: i64(0, 0), motd: 'Lobby' });
        assert.equal(result.key, `motd-${sha16('Lobby')}`);
        assert.equal(result.source, 'fallback');
    });

    test('isHardcore from the top level and worldState.isFlat reach the registry', async () => {
        const { result } = await resolved({ packets: [['login', loginPacket(SEED_A, { isHardcore: true, isFlat: true })]] });
        assert.equal(result.key, KEY_A);
        const entry = readIndex().worlds[KEY_A];
        assert.equal(entry.is_hardcore, true);
        assert.equal(entry.is_flat, true);
    });

    for (const [label, age, expected] of [['[high, low] words', [0, 5000], 5000], ['[1, 0]', [1, 0], 4294967296], ['a bigint', 7000n, 7000], ['a number', 1234, 1234], ['not convertible', 'garbage', null]]) {
        test(`update_time age as ${label} -> last_age ${expected}`, async () => {
            await resolved({ seed: SEED_A, age });
            assert.equal(readIndex().worlds[KEY_A].last_age, expected);
        });
    }
});

describe('resolve(): world directory, history, places', () => {
    test('before resolve: world and worldDir are null', () => {
        const { wm } = session();
        assert.equal(wm.world, null);
        assert.equal(wm.worldDir, null);
    });

    test('creates the world directory and the registry, sets the history storage there', async () => {
        const { result, history, wm } = await resolved({ seed: SEED_A, motd: 'Test Server' });
        assert.ok(fs.statSync(worldDir(KEY_A)).isDirectory());
        assert.ok(samePath(wm.worldDir, worldDir(KEY_A)), String(wm.worldDir));
        assert.equal(history.storage_ready, true);
        assert.ok(samePath(history.memory_fp, path.join(worldDir(KEY_A), 'memory.json')), String(history.memory_fp));
        assert.equal(readIndex().last_key, KEY_A);
        assert.deepEqual(Object.keys(result).sort(), ['adoptedLegacy', 'changedWorld', 'isNew', 'key', 'label', 'note', 'saveData', 'source', 'warnings']);
        assert.equal(result.label, 'Test Server');
        assert.equal(result.isNew, true);
        assert.equal(result.changedWorld, true);
        assert.deepEqual(result.warnings, []);
        assert.equal(result.saveData, null);
        assert.equal(result.adoptedLegacy, false);
        assert.equal(fs.existsSync(path.join(fakeCwd, 'bots')), false, 'nothing under ./bots');
    });

    test('history.save() after resolve writes into the world directory', async () => {
        const { history } = await resolved({ seed: SEED_A });
        history.memory = 'I live in world A';
        assert.equal(await history.save(), true);
        assert.equal(JSON.parse(fs.readFileSync(path.join(worldDir(KEY_A), 'memory.json'), 'utf8')).memory, 'I live in world A');
        assert.equal(fs.existsSync(path.join(botDir(), 'memory.json')), false);
    });

    test('attaches a PlaceStore at `${worldDir}/places.json` to the memory bank', async () => {
        const { memoryBank } = await resolved({ seed: SEED_A });
        assert.equal(memoryBank.hasStore, true);
        memoryBank.rememberPlace('base', 1, 64, 2, 'minecraft:overworld');
        const file = JSON.parse(fs.readFileSync(path.join(worldDir(KEY_A), 'places.json'), 'utf8'));
        assert.deepEqual(Object.keys(file.places), ['base']);
    });

    test('getDimension is passed to attachStore', async () => {
        const { memoryBank } = await resolved({ seed: SEED_A }, { getDimension: () => 'minecraft:the_nether' });
        memoryBank.rememberPlace('portal', 1, 2, 3);
        assert.equal(memoryBank.recallPlaceInfo('portal').dimension, 'minecraft:the_nether');
    });

    test('places of world A are absent in world B and present again after returning to A', async () => {
        clock = T1;
        const a1 = await resolved({ seed: SEED_A });
        a1.memoryBank.rememberPlace('base', 10, 64, 20, 'minecraft:overworld');

        clock = T2;
        const b = await resolved({ seed: SEED_B });
        assert.equal(b.result.key, KEY_B);
        assert.equal(b.memoryBank.recallPlace('base'), undefined);
        assert.equal(b.memoryBank.getKeys(), '');
        b.memoryBank.rememberPlace('camp', 1, 2, 3);

        clock = T3;
        const a2 = await resolved({ seed: SEED_A });
        assert.equal(a2.result.key, KEY_A);
        assert.deepEqual(a2.memoryBank.recallPlace('base'), [10, 64, 20]);
        assert.equal(a2.memoryBank.recallPlace('camp'), undefined);
    });

    test('loadMemory true: the world memory is loaded into the history and returned as saveData', async () => {
        clock = T1;
        const first = await resolved({ seed: SEED_A });
        first.history.memory = 'memory of A';
        first.history.turns = [{ role: 'user', content: 'steve: hi' }];
        assert.equal(await first.history.save(), true);

        clock = T2;
        const second = await resolved({ seed: SEED_A }, { loadMemory: true });
        assert.equal(second.result.saveData.memory, 'memory of A');
        assert.equal(second.history.memory, 'memory of A');
        assert.deepEqual(second.history.turns, [{ role: 'user', content: 'steve: hi' }]);
    });

    test('loadMemory true in another world: memory of A is not loaded', async () => {
        const first = await resolved({ seed: SEED_A });
        first.history.memory = 'memory of A';
        await first.history.save();
        const other = await resolved({ seed: SEED_B }, { loadMemory: true });
        assert.equal(other.result.saveData, null);
        assert.equal(other.history.memory, '');
    });

    test('loadMemory false: an existing world memory is archived to _archive/<name>-<stamp>/worlds/<key>/memory.json', async () => {
        clock = T1;
        const first = await resolved({ seed: SEED_A });
        first.history.memory = 'old memory';
        await first.history.save();
        const saved = fs.readFileSync(path.join(worldDir(KEY_A), 'memory.json'), 'utf8');

        clock = T3;
        const second = await resolved({ seed: SEED_A }, { loadMemory: false });
        assert.equal(second.result.saveData, null);
        assert.equal(fs.existsSync(path.join(worldDir(KEY_A), 'memory.json')), false);
        const archived = path.join(botsDir, '_archive', `${NAME}-${STAMP_T3}`, 'worlds', KEY_A, 'memory.json');
        assert.equal(fs.readFileSync(archived, 'utf8'), saved);
    });
});

describe('resolve(): legacy adoption', () => {
    const LEGACY = JSON.stringify({ memory: 'legacy memory', turns: [], self_prompting_state: 0, self_prompt: null, taskStart: 5, last_sender: 'steve' }, null, 2);

    function writeLegacy() {
        fs.mkdirSync(botDir(), { recursive: true });
        fs.writeFileSync(path.join(botDir(), 'memory.json'), LEGACY);
    }

    test('first world ever and a legacy memory.json: copied into the world directory, original untouched', async () => {
        writeLegacy();
        const mtime = fs.statSync(path.join(botDir(), 'memory.json')).mtimeMs;
        const { result, history } = await resolved({ seed: SEED_A, motd: 'Srv' }, { loadMemory: true });
        assert.equal(result.adoptedLegacy, true);
        assert.equal(fs.readFileSync(path.join(worldDir(KEY_A), 'memory.json'), 'utf8'), LEGACY);
        assert.equal(fs.readFileSync(path.join(botDir(), 'memory.json'), 'utf8'), LEGACY);
        assert.equal(fs.statSync(path.join(botDir(), 'memory.json')).mtimeMs, mtime);
        assert.equal(result.saveData.memory, 'legacy memory');
        assert.equal(history.memory, 'legacy memory');
        assert.equal(result.note, firstVisitAdoptedNote('Srv'), 'Amendment 1, M1');
    });

    test('loadMemory false (Amendment 1, M1): no adoption, nothing copied or archived, original untouched, plain first-visit note', async () => {
        writeLegacy();
        const { result } = await resolved({ seed: SEED_A, motd: 'Srv' }, { loadMemory: false });
        assert.equal(result.adoptedLegacy, false);
        assert.equal(fs.existsSync(path.join(worldDir(KEY_A), 'memory.json')), false);
        assert.deepEqual(listFiles(path.join(botsDir, '_archive')), [], 'nothing archived');
        assert.equal(fs.readFileSync(path.join(botDir(), 'memory.json'), 'utf8'), LEGACY);
        assert.equal(result.saveData, null);
        assert.equal(result.note, firstVisitNote('Srv'));
    });

    test('no adoption when the registry already knew a world', async () => {
        await resolved({ seed: SEED_A });
        writeLegacy();
        const { result } = await resolved({ seed: SEED_B }, { loadMemory: true });
        assert.equal(result.adoptedLegacy, false);
        assert.equal(fs.existsSync(path.join(worldDir(KEY_B), 'memory.json')), false);
        assert.equal(result.saveData, null);
        assert.ok(!String(result.note).includes(ADOPTED));
        assert.equal(fs.readFileSync(path.join(botDir(), 'memory.json'), 'utf8'), LEGACY);
    });

    test('no adoption when the world directory already has a memory.json', async () => {
        writeLegacy();
        fs.mkdirSync(worldDir(KEY_A), { recursive: true });
        const own = JSON.stringify({ memory: 'own world memory', turns: [] });
        fs.writeFileSync(path.join(worldDir(KEY_A), 'memory.json'), own);
        const { result } = await resolved({ seed: SEED_A }, { loadMemory: true });
        assert.equal(result.adoptedLegacy, false);
        assert.equal(result.saveData.memory, 'own world memory');
    });

    test('no legacy file: adoptedLegacy false', async () => {
        const { result } = await resolved({ seed: SEED_A }, { loadMemory: true });
        assert.equal(result.adoptedLegacy, false);
    });
});

describe('resolve(): note', () => {
    test('first visit: exact sentence with the label', async () => {
        const { result } = await resolved({ seed: SEED_A, motd: 'Test Server' });
        assert.equal(result.note, firstVisitNote('Test Server'));
    });

    test('first visit without motd: the label is the key', async () => {
        const { result } = await resolved({ seed: SEED_A });
        assert.equal(result.note, firstVisitNote(KEY_A));
    });

    test('known world after another world: last visit date (before this visit) and saved places', async () => {
        clock = T1;
        const a = await resolved({ seed: SEED_A, motd: 'Alpha' });
        a.memoryBank.rememberPlace('base', 1, 2, 3, 'minecraft:overworld');
        a.memoryBank.rememberPlace('cave', 4, 5, 6, null);
        clock = T2;
        await resolved({ seed: SEED_B, motd: 'Beta' });
        clock = T3;
        const back = await resolved({ seed: SEED_A, motd: 'Alpha' });
        assert.equal(back.result.isNew, false);
        assert.equal(back.result.changedWorld, true);
        assert.equal(back.result.note, knownNote('Alpha', '2026-09-20', back.memoryBank.describePlaces()));
        assert.equal(back.result.note, knownNote('Alpha', '2026-09-20', 'base (minecraft:overworld), cave'));
    });

    test('known world without places: "none"', async () => {
        clock = T1;
        await resolved({ seed: SEED_A, motd: 'Alpha' });
        clock = T2;
        await resolved({ seed: SEED_B, motd: 'Beta' });
        clock = T3;
        const back = await resolved({ seed: SEED_A, motd: 'Alpha' });
        assert.equal(back.result.note, knownNote('Alpha', '2026-09-20', 'none'));
    });

    test('same world as last time, no warnings: note is null', async () => {
        clock = T1;
        await resolved({ seed: SEED_A, motd: 'Alpha' });
        clock = T2;
        const again = await resolved({ seed: SEED_A, motd: 'Alpha' });
        assert.equal(again.result.isNew, false);
        assert.equal(again.result.changedWorld, false);
        assert.deepEqual(again.result.warnings, []);
        assert.equal(again.result.note, null);
    });

    test('same world with a warning (motd changed): note is not null and contains the warning', async () => {
        clock = T1;
        await resolved({ seed: SEED_A, motd: 'Alpha' });
        clock = T2;
        const again = await resolved({ seed: SEED_A, motd: 'Alpha Reloaded' });
        assert.equal(again.result.warnings.length, 1);
        assert.equal(typeof again.result.note, 'string');
        assert.ok(again.result.note.startsWith('You are in the world "Alpha Reloaded".'), again.result.note);
        assert.ok(again.result.note.includes(again.result.warnings[0]), again.result.note);
    });

    test('known world with a warning: known-world sentence followed by the warning', async () => {
        clock = T1;
        await resolved({ seed: SEED_A, motd: 'Alpha', age: [0, 9000] });
        clock = T2;
        await resolved({ seed: SEED_B, motd: 'Beta' });
        clock = T3;
        const back = await resolved({ seed: SEED_A, motd: 'Alpha', age: [0, 10] });
        assert.equal(back.result.warnings.length, 1);
        assert.ok(back.result.note.startsWith(knownNote('Alpha', '2026-09-20', 'none')), back.result.note);
        assert.ok(back.result.note.includes(back.result.warnings[0]), back.result.note);
    });
});

describe('resolve(): world_id override', () => {
    test('settings.world_id gives key id-<sanitized id> and its own directory', async () => {
        const { result, history } = await resolved({ seed: SEED_A, settings: { world_id: 'My Realm' } });
        assert.equal(result.key, 'id-My_Realm');
        assert.equal(result.source, 'override');
        assert.ok(fs.statSync(worldDir('id-My_Realm')).isDirectory());
        assert.ok(samePath(history.memory_fp, path.join(worldDir('id-My_Realm'), 'memory.json')));
    });

    test('blank world_id is ignored: the seed decides', async () => {
        const { result } = await resolved({ seed: SEED_A, settings: { world_id: '   ' } });
        assert.equal(result.key, KEY_A);
    });
});

describe('resolve(): never rejects, falls back to unknown', () => {
    test('no packets at all: world unknown in worlds/unknown, storage ready', async () => {
        const { result, history, memoryBank } = await resolved({ login: false });
        assert.equal(result.key, 'unknown');
        assert.equal(result.source, 'unknown');
        assert.ok(fs.statSync(worldDir('unknown')).isDirectory());
        assert.equal(history.storage_ready, true);
        assert.equal(memoryBank.hasStore, true);
    });

    test('resolve without attach: resolves, key unknown', async () => {
        const wm = new WM.WorldMemory({ name: NAME, botsDir, settings: {}, history: new H.History(makeFakeAgent(NAME), { bots_dir: botsDir, defer_storage: true }), memoryBank: new MB.MemoryBank(), now: () => new Date(clock) });
        const result = await wm.resolve();
        assert.equal(result.key, 'unknown');
    });

    test('the world directory cannot be created (a file is in the way): falls back to worlds/unknown, storage ready, console.warn', async () => {
        fs.mkdirSync(path.join(botDir(), 'worlds'), { recursive: true });
        fs.writeFileSync(worldDir(KEY_A), 'I am a file');
        const { result, history, wm } = await resolved({ seed: SEED_A });
        assert.equal(result.key, 'unknown');
        assert.equal(history.storage_ready, true);
        assert.ok(samePath(history.memory_fp, path.join(worldDir('unknown'), 'memory.json')), String(history.memory_fp));
        assert.ok(samePath(wm.worldDir, worldDir('unknown')));
        assert.ok(cap.of('warn').length >= 1, 'a console.warn is logged');
        assert.equal(fs.readFileSync(worldDir(KEY_A), 'utf8'), 'I am a file');
    });

    test('`worlds` is a FILE: resolve does not reject, key unknown, storage_ready stays false', async () => {
        fs.mkdirSync(botDir(), { recursive: true });
        fs.writeFileSync(path.join(botDir(), 'worlds'), 'I am a file');
        const s = session({ seed: SEED_A });
        let result;
        await assert.doesNotReject(async () => {
            result = await s.wm.resolve({ loadMemory: true });
        });
        assert.equal(result.key, 'unknown');
        assert.equal(s.history.storage_ready, false);
        assert.ok(cap.of('warn').length >= 1, 'a console.warn is logged');
        assert.equal(fs.readFileSync(path.join(botDir(), 'worlds'), 'utf8'), 'I am a file');
    });

    test('memoryBank.attachStore throws: resolve does not reject, key unknown, storage ready', async () => {
        const history = new H.History(makeFakeAgent(NAME), { bots_dir: botsDir, defer_storage: true });
        const memoryBank = { attachStore() { throw new Error('broken bank'); }, describePlaces: () => 'none', getKeys: () => '' };
        const wm = new WM.WorldMemory({ name: NAME, botsDir, settings: {}, history, memoryBank, now: () => new Date(clock) });
        const bot = makeBot();
        wm.attach(bot);
        bot._client.emit('login', loginPacket(SEED_A));
        let result;
        await assert.doesNotReject(async () => {
            result = await wm.resolve();
        });
        assert.equal(result.key, 'unknown');
        assert.equal(history.storage_ready, true);
    });
});

describe('setLabel(label)', () => {
    test('before resolve: false', () => {
        const { wm } = session();
        assert.equal(wm.setLabel('Home'), false);
    });

    test('empty label: false, label unchanged', async () => {
        const { wm } = await resolved({ seed: SEED_A, motd: 'Alpha' });
        assert.equal(wm.setLabel(''), false);
        assert.equal(wm.world.label, 'Alpha');
    });

    test('sets a manual label in the registry and updates world.label', async () => {
        const { wm } = await resolved({ seed: SEED_A, motd: 'Alpha' });
        assert.equal(wm.setLabel('Home Base'), true);
        assert.equal(wm.world.label, 'Home Base');
        const entry = readIndex().worlds[KEY_A];
        assert.equal(entry.label, 'Home Base');
        assert.equal(entry.label_source, 'manual');
    });

    test('a manual label survives the next visit without a label warning', async () => {
        clock = T1;
        const a = await resolved({ seed: SEED_A, motd: 'Alpha' });
        a.wm.setLabel('Home Base');
        clock = T2;
        await resolved({ seed: SEED_B });
        clock = T3;
        const back = await resolved({ seed: SEED_A, motd: 'Alpha' });
        assert.deepEqual(back.result.warnings, []);
        assert.equal(readIndex().worlds[KEY_A].label, 'Home Base');
    });
});

describe('module rules', () => {
    test('imports only world_identity, world_registry, place_store, safe_json and node built-ins', () => {
        assertImportRules(MODULE, { allowedRelative: ['world_identity.js', 'world_registry.js', 'place_store.js', 'safe_json.js'] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });

    test('resolve leaves no files outside the bots directory', async () => {
        await resolved({ seed: SEED_A });
        assert.deepEqual(listFiles(fakeCwd), []);
        assert.deepEqual(listDir(botsDir), [NAME]);
    });
});
