// v0.1.4.13 part M1 (SPEC 4.7): shared_memory. src/agent/memory_paths.js gives the folder of the stores of areas,
// places, routes, mines, chests and rules: bots/shared/worlds/<seed>/ with the switch on, else bots/<name>/worlds/<seed>/;
// the chat memory, the histories and the job stay per bot. Two processes write the same files: each store writes
// atomically (a temp file and a rename) and re-reads the file before a write when it changed. A bot that finds a file of
// the shared folder missing and its own present copies its own once and says "I share the memory of this world now."
// Everything runs in temp folders; nothing is written under bots/ of the repository.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeFakeAgent } from '../helpers/fake_agent.js';
import { assertImportRules } from '../helpers/module_rules.js';

const MP = await loadSrc('src/agent/memory_paths.js');
const AREAS = await loadSrc('src/agent/areas/area_store.js');
const PLACES = await loadSrc('src/agent/world/place_store.js');
const MINES = await loadSrc('src/agent/packs/mining/mine_store.js');
const ROUTES = await loadSrc('src/agent/packs/routes/route_store.js');
const CHESTS = await loadSrc('src/agent/packs/storage/chest_index.js');
const RULES = await loadSrc('src/agent/rules/rule_store.js');
const WM = await loadSrc('src/agent/world/world_memory.js');
const H = await loadSrc('src/agent/history.js');
const MB = await loadSrc('src/agent/memory_bank.js');

const SEED = 'seed-0123456789abcdef';
const ON = Object.freeze({ shared_memory: true });
const OFF = Object.freeze({ shared_memory: false });
const NOW = () => new Date(Date.UTC(2026, 9, 4, 12, 0, 0));

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const botsDir = () => path.join(dir, 'bots');
const sharedDir = () => path.join(botsDir(), 'shared', 'worlds', SEED);
const ownDir = (name) => path.join(botsDir(), name, 'worlds', SEED);
const writeJson = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};
const tempFiles = (folder) => listDir(folder).filter((f) => f.endsWith('.tmp'));

describe('module', () => {
    test('memory_paths.js imports only node:fs and node:path', () => {
        assertImportRules('src/agent/memory_paths.js', { allowBuiltins: ['fs', 'path'], allowedRelative: [] });
    });

    test('the text of the one-time copy, word for word', () => {
        assert.equal(MP.SHARED_TEXT, 'I share the memory of this world now.');
    });

    test('the shared files are those of areas, places, routes, mines, chests and rules', () => {
        assert.deepEqual([...MP.SHARED_FILES].sort(), ['areas.json', 'chests.json', 'mines.json', 'places.json', 'routes.json', 'rules.json']);
    });
});

describe('worldDir(agentName, seed, settings)', () => {
    test('off: bots/<name>/worlds/<seed>', () => {
        assert.equal(MP.worldDir('claude', SEED, OFF), `./bots/claude/worlds/${SEED}`);
        assert.equal(MP.worldDir('gpt', SEED, OFF), `./bots/gpt/worlds/${SEED}`);
    });

    test('on: bots/shared/worlds/<seed>, the same folder for every bot', () => {
        assert.equal(MP.worldDir('claude', SEED, ON), `./bots/shared/worlds/${SEED}`);
        assert.equal(MP.worldDir('gpt', SEED, ON), MP.worldDir('claude', SEED, ON));
    });

    test('without settings, or with a value that is not true: the own folder', () => {
        for (const settings of [undefined, null, {}, { shared_memory: 'yes' }, { shared_memory: 1 }]) {
            assert.equal(MP.worldDir('claude', SEED, settings), `./bots/claude/worlds/${SEED}`, JSON.stringify(settings));
        }
    });

    test('another folder of the bots', () => {
        assert.equal(MP.worldDir('claude', SEED, ON, '/x/bots'), `/x/bots/shared/worlds/${SEED}`);
        assert.equal(MP.worldDir('claude', SEED, OFF, '/x/bots'), `/x/bots/claude/worlds/${SEED}`);
    });

    test('memoryPathsFor reads the switch live', () => {
        const settings = { shared_memory: false };
        const paths = MP.memoryPathsFor('claude', settings, '/b');
        assert.equal(paths.storeDir(SEED), `/b/claude/worlds/${SEED}`);
        assert.equal(paths.sharedFile('/b/claude/worlds/x/areas.json'), null, 'off: a store reads its file once, as before');
        settings.shared_memory = true;
        assert.equal(paths.storeDir(SEED), `/b/shared/worlds/${SEED}`);
        assert.ok(paths.sharedFile('/b/shared/worlds/x/areas.json') instanceof MP.SharedFile);
        assert.equal(paths.shared(), true);
    });
});

describe('SharedFile', () => {
    test('changed before the first mark, not after it; a rename onto the file is a change', () => {
        const file = path.join(dir, 'a.json');
        fs.writeFileSync(file, '{"a":1}');
        const f = new MP.SharedFile(file, { readCheckMs: 0 });
        assert.equal(f.changed(), true);
        f.mark();
        assert.equal(f.changed(), false);
        fs.writeFileSync(`${file}.tmp`, '{"a":2}');
        fs.renameSync(`${file}.tmp`, file); // the same size, maybe the same mtime: a new inode
        assert.equal(f.changed(), true);
    });

    test('a missing file is a state: it changes when the file appears', () => {
        const file = path.join(dir, 'b.json');
        const f = new MP.SharedFile(file, { readCheckMs: 0 });
        assert.equal(f.stamp(), null);
        f.mark();
        assert.equal(f.changed(), false);
        fs.writeFileSync(file, '{}');
        assert.equal(f.changed(), true);
    });

    test('mark(stamp) with the stamp taken before a read: a write during the read is seen at the next look', () => {
        const file = path.join(dir, 'c.json');
        fs.writeFileSync(file, '{"a":1}');
        const f = new MP.SharedFile(file, { readCheckMs: 0 });
        const before = f.stamp();
        fs.writeFileSync(`${file}.tmp`, '{"a":22}');
        fs.renameSync(`${file}.tmp`, file); // another bot writes while this one reads
        f.mark(before);
        assert.equal(f.changed(), true);
    });

    test('a read looks at most once per readCheckMs; a write (fresh) always looks', () => {
        const file = path.join(dir, 'd.json');
        fs.writeFileSync(file, '{"a":1}');
        let t = 1000;
        const f = new MP.SharedFile(file, { readCheckMs: 1000, now: () => t });
        f.mark();
        fs.writeFileSync(`${file}.tmp`, '{"a":2}');
        fs.renameSync(`${file}.tmp`, file);
        t += 999;
        assert.equal(f.changed(), false, 'a read within the second trusts the last look');
        assert.equal(f.changed(true), true, 'a write looks');
        f.mark();
        fs.writeFileSync(`${file}.tmp`, '{"a":3}');
        fs.renameSync(`${file}.tmp`, file);
        t += 1000;
        assert.equal(f.changed(), true, 'a read after the second looks');
    });

    test('the default is one look per second', () => {
        assert.equal(MP.READ_CHECK_MS, 1000);
    });
});

// The stores of a world, each with a way to add an entry and to list the names of its entries.
const route = (i) => ({ name: `way${i}`, dimension: 'overworld', from: { name: 'yard', kind: 'place', x: i, y: 64, z: 0 }, to: { name: 'house', x: i + 10, y: 64, z: 0 },
    legs: [{ kind: 'walk', from: { x: i, y: 64, z: 0 }, to: { x: i + 10, y: 64, z: 0 } }], steps: 11, source: 'trail' });
const KINDS = [
    { label: 'areas', file: 'areas.json', make: (f, o) => new AREAS.AreaStore(f, o),
        add: (s, i) => s.set({ name: `pen${i}`, type: 'pen', min: { x: i * 10, y: 60, z: 0 }, max: { x: i * 10 + 4, y: 64, z: 4 } }),
        names: (s) => s.list().map((a) => a.name) },
    { label: 'places', file: 'places.json', make: (f, o) => new PLACES.PlaceStore(f, o),
        add: (s, i) => s.remember(`spot${i}`, i, 64, 0, 'overworld'), names: (s) => s.names() },
    { label: 'mines', file: 'mines.json', make: (f, o) => new MINES.MineStore(f, o),
        add: (s, i) => s.set({ name: `deep${i}`, ore: 'iron', entrance: { x: i, y: 64, z: 0 }, level: 16 }), names: (s) => s.list().map((m) => m.name) },
    { label: 'routes', file: 'routes.json', make: (f, o) => new ROUTES.RouteStore(f, o),
        add: (s, i) => s.set(route(i)), names: (s) => s.list().map((r) => r.name) },
    { label: 'chests', file: 'chests.json', make: (f, o) => new CHESTS.ChestIndex(f, o),
        add: (s, i) => s.update({ x: i, y: 64, z: 0, kind: 'chest', items: { bread: i }, free_slots: 20 }), names: (s) => s.list().map((c) => `chest${c.x}`) },
    { label: 'rules', file: 'rules.json', make: (f, o) => new RULES.RuleStore(f, o),
        add: (s, i) => s.add(`Keep gate ${i} closed.`), names: (s) => s.list().map((r) => r.text) },
];
const nameOf = { areas: (i) => `pen${i}`, places: (i) => `spot${i}`, mines: (i) => `deep${i}`, routes: (i) => `way${i}`, chests: (i) => `chest${i}`, rules: (i) => `Keep gate ${i} closed.` };

for (const kind of KINDS) {
    describe(`the ${kind.label} of two bots in one file`, () => {
        // Two stores of the same file, as two bot processes hold them, each with its SharedFile and its clock.
        function twoBots() {
            const file = path.join(sharedDir(), kind.file);
            let t = 0;
            const clock = { tick: (ms) => { t += ms; } };
            const open = () => {
                const s = kind.make(file, { now: NOW, shared: new MP.SharedFile(file, { now: () => t }) });
                s.load();
                return s;
            };
            return { file, clock, a: open(), b: open() };
        }

        test('the write of one bot is read by the other within a second', () => {
            const { a, b, clock } = twoBots();
            kind.add(a, 1);
            assert.deepEqual(kind.names(a), [nameOf[kind.label](1)]);
            clock.tick(1000);
            assert.deepEqual(kind.names(b), [nameOf[kind.label](1)], 'bot B lists what bot A saved');
        });

        test('a write re-reads the changed file first: nothing of the other bot is lost', () => {
            const { a, b, file } = twoBots();
            assert.deepEqual(kind.names(b), []);
            kind.add(a, 1);
            kind.add(b, 2); // at once, without a read in between
            const fresh = kind.make(file, { now: NOW });
            fresh.load();
            assert.deepEqual(kind.names(fresh).sort(), [nameOf[kind.label](1), nameOf[kind.label](2)].sort());
        });

        test('the write is atomic: a whole JSON file, no temp file left', () => {
            const { a, b, file } = twoBots();
            for (let i = 1; i <= 3; i++) {
                kind.add(a, i);
                kind.add(b, i + 10);
            }
            assert.deepEqual(tempFiles(path.dirname(file)), []);
            assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
        });

        test('without a SharedFile (shared_memory off) the store reads its file once, as before', () => {
            const file = path.join(ownDir('claude'), kind.file);
            const a = kind.make(file, { now: NOW });
            const b = kind.make(file, { now: NOW });
            a.load();
            b.load();
            kind.add(a, 1);
            assert.deepEqual(kind.names(b), [], 'bot B keeps what it read at the start');
        });
    });
}

describe('shareOnce: the one-time copy into the shared folder', () => {
    test('off: nothing is copied and nothing said', () => {
        writeJson(path.join(ownDir('claude'), 'mines.json'), { version: 1, mines: {} });
        assert.deepEqual(MP.shareOnce('claude', SEED, OFF, botsDir()), { copied: [], text: null });
        assert.deepEqual(listDir(sharedDir()), []);
    });

    test('on: every own file the shared folder lacks is copied, once, with the text', () => {
        writeJson(path.join(ownDir('claude'), 'mines.json'), { version: 1, mines: { deep: { name: 'deep' } } });
        writeJson(path.join(ownDir('claude'), 'areas.json'), { version: 1, areas: {} });
        writeJson(path.join(botsDir(), 'claude', 'rules.json'), { version: 1, rules: [{ id: 1, text: 'Keep the gate closed.' }] });
        writeJson(path.join(ownDir('claude'), 'memory.json'), { memory: 'mine' }); // the chat memory stays per bot
        const first = MP.shareOnce('claude', SEED, ON, botsDir());
        assert.deepEqual(first.copied.sort(), ['areas.json', 'mines.json', 'rules.json']);
        assert.equal(first.text, 'I share the memory of this world now.');
        assert.deepEqual(listDir(sharedDir()), ['areas.json', 'mines.json', 'rules.json']);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sharedDir(), 'rules.json'), 'utf8')).rules[0].text, 'Keep the gate closed.');
        assert.deepEqual(MP.shareOnce('claude', SEED, ON, botsDir()), { copied: [], text: null }, 'the second time: nothing');
    });

    test('a file another bot shared first stays; the second bot copies only what is missing', () => {
        writeJson(path.join(sharedDir(), 'mines.json'), { version: 1, mines: { deep: { name: 'deep' } } });
        writeJson(path.join(ownDir('gpt'), 'mines.json'), { version: 1, mines: { other: { name: 'other' } } });
        writeJson(path.join(ownDir('gpt'), 'chests.json'), { version: 1, chests: {} });
        const result = MP.shareOnce('gpt', SEED, ON, botsDir());
        assert.deepEqual(result.copied, ['chests.json']);
        assert.equal(result.text, MP.SHARED_TEXT);
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(sharedDir(), 'mines.json'), 'utf8')).mines), ['deep']);
    });

    test('a bot without own files copies nothing and says nothing', () => {
        assert.deepEqual(MP.shareOnce('fresh', SEED, ON, botsDir()), { copied: [], text: null });
    });
});

describe('WorldMemory with the paths of memory_paths.js', () => {
    const NAME = 'zz_test_claude';
    let cwd;
    before(() => { cwd = process.cwd(); });
    after(() => { process.chdir(cwd); });

    async function resolveWith(settings) {
        process.chdir(dir); // nothing relative lands in the repository
        try {
            const agent = makeFakeAgent(NAME);
            const history = new H.History(agent, { bots_dir: botsDir(), defer_storage: true });
            const memoryBank = new MB.MemoryBank();
            const paths = MP.memoryPathsFor(NAME, settings, botsDir());
            const wm = new WM.WorldMemory({ name: NAME, botsDir: botsDir(), settings, history, memoryBank, now: NOW, paths });
            const bot = { _client: new EventEmitter(), game: { dimension: 'minecraft:overworld' } };
            wm.attach(bot);
            bot._client.emit('login', { entityId: 1, isHardcore: false, worldNames: ['minecraft:overworld'],
                worldState: { dimension: 0, name: 'minecraft:overworld', hashedSeed: [0x01234567, 0x89abcdef | 0], gamemode: 'survival', isDebug: false, isFlat: false } });
            const result = await wm.resolve({ loadMemory: true, getDimension: () => 'overworld' });
            return { wm, result, memoryBank };
        } finally {
            process.chdir(cwd);
        }
    }

    test('on: the stores live in the shared folder, the chat memory in the own world folder', async () => {
        const { wm, result, memoryBank } = await resolveWith({ ...ON });
        assert.equal(path.resolve(wm.storeDir), path.resolve(botsDir(), 'shared', 'worlds', result.key));
        assert.equal(path.resolve(wm.worldDir), path.resolve(botsDir(), NAME, 'worlds', result.key));
        memoryBank.rememberPlace('home', 1, 64, 2);
        assert.ok(fs.existsSync(path.join(botsDir(), 'shared', 'worlds', result.key, 'places.json')), 'the places are shared');
        assert.ok(!fs.existsSync(path.join(botsDir(), NAME, 'worlds', result.key, 'places.json')));
        assert.deepEqual(wm.sharedCopied, []);
    });

    test('on, with own places of an earlier play: they are copied once (sharedCopied names the file)', async () => {
        const off = await resolveWith({ ...OFF });
        off.memoryBank.rememberPlace('home', 1, 64, 2);
        const key = off.result.key;
        assert.ok(fs.existsSync(path.join(botsDir(), NAME, 'worlds', key, 'places.json')));
        const on = await resolveWith({ ...ON });
        assert.deepEqual(on.wm.sharedCopied, ['places.json']);
        assert.deepEqual(on.memoryBank.recallPlace('home'), [1, 64, 2]);
        const again = await resolveWith({ ...ON });
        assert.deepEqual(again.wm.sharedCopied, [], 'once');
    });

    test('off: the folder of the stores is the world folder, as before', async () => {
        const { wm } = await resolveWith({ ...OFF });
        assert.equal(wm.storeDir, wm.worldDir);
        assert.deepEqual(listDir(path.join(botsDir(), 'shared')), []);
    });
});
