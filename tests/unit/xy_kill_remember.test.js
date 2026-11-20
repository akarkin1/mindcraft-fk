// v0.1.4.16, the fix round (the review's finding 2; SPEC 8.4 "the owner saves it standing at his spot"): !rememberHere of
// src/agent/commands/actions.js saves the places of the kill room (kill_spot, kill_chest, kill_bed, kill_exit) where the player
// who gave the order stands, when that player is within 8 blocks of the bot and seen (bot.players[name].entity); else, and for
// every other name, where the bot stands, as before. The answer says whose position: `Location saved as "kill_spot" where you
// stand.` The real command list is imported (commands/index.js first, as commands_places.test.js does: the import cycle) in an
// empty working directory, and perform() is called with a fake agent.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importActions() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        await loadSrc('src/agent/commands/index.js');
        return await loadSrc('src/agent/commands/actions.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const actions = await importActions();
const MB = await loadSrc('src/agent/memory_bank.js');
const P = await loadSrc('src/agent/world/place_store.js');

const rememberHere = () => {
    const cmd = actions.actionsList.find((c) => c.name === '!rememberHere');
    assert.ok(cmd, '!rememberHere is in actionsList');
    return cmd;
};

const OVERWORLD = 'minecraft:overworld';
const BOT_AT = { x: 10.5, y: 170, z: 20.5 };
const OWNER_AT = { x: 12.3, y: 170, z: 21.7 }; // 2.1 blocks from the bot: the owner on his spot, the bot beside him

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

function storeBank() {
    const store = new P.PlaceStore(path.join(dir, 'places.json'), { now: () => new Date(Date.UTC(2026, 10, 14)) });
    store.load();
    const bank = new MB.MemoryBank();
    bank.attachStore(store);
    return bank;
}

// The agent: the bot at BOT_AT; the owner `steve` at `owner` (null: not seen) and the order's sender `by` (null: no order).
function makeAgent({ owner = OWNER_AT, by = 'steve', memoryBank = storeBank() } = {}) {
    const bot = {
        username: 'andy',
        entity: { position: { ...BOT_AT } },
        game: { dimension: OVERWORLD },
        players: { andy: { username: 'andy', entity: null }, steve: { username: 'steve', entity: owner ? { position: { ...owner } } : null } },
    };
    bot.players.andy.entity = bot.entity;
    return { name: 'andy', bot, memory_bank: memoryBank, last_order: by ? { by, command: '!rememberHere', typed: true } : null };
}

const savedAt = (agent, name) => {
    const p = agent.memory_bank.recallPlaceInfo(name);
    return p ? { x: p.x, y: p.y, z: p.z } : null;
};

describe('!rememberHere for the places of the kill room (finding 2)', () => {
    for (const name of ['kill_spot', 'kill_chest', 'kill_bed', 'kill_exit']) {
        test(`${name}: the owner within 8 blocks and seen: saved where he stands, and the answer says so`, async () => {
            const agent = makeAgent();
            const reply = await rememberHere().perform(agent, name);
            assert.equal(reply, `Location saved as "${name}" where you stand.`);
            assert.deepEqual(savedAt(agent, name), OWNER_AT);
            assert.equal(agent.memory_bank.recallPlaceInfo(name).dimension, OVERWORLD);
        });
    }

    test('the owner exactly 8 blocks away counts; 8.1 blocks away: the bot\'s position, the answer as before', async () => {
        const at8 = { x: BOT_AT.x + 8, y: BOT_AT.y, z: BOT_AT.z };
        const near = makeAgent({ owner: at8 });
        assert.equal(await rememberHere().perform(near, 'kill_spot'), 'Location saved as "kill_spot" where you stand.');
        assert.deepEqual(savedAt(near, 'kill_spot'), at8);
        const far = makeAgent({ owner: { x: BOT_AT.x + 8.1, y: BOT_AT.y, z: BOT_AT.z } });
        assert.equal(await rememberHere().perform(far, 'kill_spot'), 'Location saved as "kill_spot".');
        assert.deepEqual(savedAt(far, 'kill_spot'), BOT_AT);
    });

    test('the owner not seen (no entity), or no order of a player behind the command: the bot\'s position', async () => {
        const unseen = makeAgent({ owner: null });
        assert.equal(await rememberHere().perform(unseen, 'kill_spot'), 'Location saved as "kill_spot".');
        assert.deepEqual(savedAt(unseen, 'kill_spot'), BOT_AT);
        const noOrder = makeAgent({ by: null });
        assert.equal(await rememberHere().perform(noOrder, 'kill_chest'), 'Location saved as "kill_chest".');
        assert.deepEqual(savedAt(noOrder, 'kill_chest'), BOT_AT);
        const unknown = makeAgent({ by: 'alex' });
        assert.equal(await rememberHere().perform(unknown, 'kill_bed'), 'Location saved as "kill_bed".');
        assert.deepEqual(savedAt(unknown, 'kill_bed'), BOT_AT);
    });

    test('every other name keeps the bot\'s position, the owner beside it or not', async () => {
        for (const name of ['home', 'kill_spot_2', 'my_kill_spot', 'farm']) {
            const agent = makeAgent();
            assert.equal(await rememberHere().perform(agent, name), `Location saved as "${name}".`);
            assert.deepEqual(savedAt(agent, name), BOT_AT, name);
        }
    });
});
