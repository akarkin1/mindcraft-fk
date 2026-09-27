// Spec v0.1.4.3 W12: commands in src/agent/commands/actions.js and queries.js --
// !rememberHere, !goToRememberedPlace, !savedPlaces, !forgetPlace, !nameWorld, !stats.
//
// The real command lists are imported and perform() is called with a fake agent.
// Import notes (v0.1.4.2):
//   * actions.js -> conversation.js -> commands/index.js -> actions.js is an import cycle.
//     Importing actions.js first fails with "Cannot access 'actionsList' before initialization";
//     importing commands/index.js first (as agent.js does) works.
//   * The import runs with the working directory set to an empty temp directory, so no
//     keys.json or ./bots path of the repository can be touched.
//   * !stats calls world.getBiomeName(), which needs the minecraft-data object that
//     src/utils/mcdata.js only sets on a real login. The hook in helpers/mcdata_hooks.js adds a
//     test-only setter export to that module so a fake biome table can be installed.
// Wrapped actions (runAsAction) call agent.actions.runAction(label, fn, options); the fake runs
// fn and returns { success: true, message: bot.output }. goToPosition runs in 'cheat' mode, which
// sends "/tp @s x y z" through bot.chat; the fake bot applies that to its position.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importCommands() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { actions, queries, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { actions, queries, mcdata } = await importCommands();
const MB = await loadSrc('src/agent/memory_bank.js');
const P = await loadSrc('src/agent/world/place_store.js');

function action(name) {
    const cmd = actions.actionsList.find((c) => c.name === name);
    assert.ok(cmd, `${name} is in actionsList`);
    return cmd;
}
function query(name) {
    const cmd = queries.queryList.find((c) => c.name === name);
    assert.ok(cmd, `${name} is in queryList`);
    return cmd;
}

const OVERWORLD = 'minecraft:overworld';
const NETHER = 'minecraft:the_nether';

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
    assert.equal(typeof P.PlaceStore, 'function', 'PlaceStore must be an exported class');
    const store = new P.PlaceStore(path.join(dir, 'places.json'), { now: () => new Date(Date.UTC(2026, 0, 1)) });
    store.load();
    const bank = new MB.MemoryBank();
    bank.attachStore(store);
    return bank;
}

function makeAgent({ dimension = OVERWORLD, position = { x: 1.5, y: 64, z: -3.25 }, memoryBank = new MB.MemoryBank(), worldMemory } = {}) {
    const chats = [];
    const bot = {
        username: 'andy',
        entity: { position: { ...position } },
        game: { dimension, gameMode: 'survival' },
        output: '',
        interrupt_code: false,
        health: 20,
        food: 18,
        rainState: 0,
        thunderState: 0,
        time: { timeOfDay: 1000 },
        entities: {},
        world: { getBiome: () => 1 },
        modes: { isOn: (mode) => mode === 'cheat', getMiniDocs: () => 'MODES' },
        chat(message) {
            chats.push(message);
            const m = /^\/tp @s (\S+) (\S+) (\S+)$/.exec(message);
            if (m) bot.entity.position = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
        },
    };
    const agent = {
        name: 'andy',
        bot,
        chats,
        memory_bank: memoryBank,
        actions: {
            currentActionLabel: '',
            calls: [],
            async runAction(label, fn, options) {
                this.calls.push({ label, options });
                bot.output = '';
                await fn();
                return { success: true, message: bot.output };
            },
        },
        isIdle: () => true,
        openChat(message) {
            chats.push(message);
        },
    };
    if (worldMemory !== undefined) agent.world_memory = worldMemory;
    return agent;
}

// Text visible to the model: the returned message plus anything left in bot.output.
const seen = (agent, returned) => `${returned ?? ''}\n${agent.bot.output}`;

describe('!rememberHere(name)', () => {
    test('flag off (no store): saves the position, reply unchanged', async () => {
        const agent = makeAgent();
        const reply = await action('!rememberHere').perform(agent, 'home');
        assert.equal(reply, 'Location saved as "home".');
        assert.deepEqual(agent.memory_bank.recallPlace('home'), [1.5, 64, -3.25]);
    });

    test('with a store: stores the current dimension of agent.bot.game.dimension', async () => {
        const agent = makeAgent({ dimension: NETHER, memoryBank: storeBank() });
        const reply = await action('!rememberHere').perform(agent, 'portal');
        assert.equal(reply, 'Location saved as "portal".');
        assert.deepEqual(agent.memory_bank.recallPlaceInfo('portal'), { x: 1.5, y: 64, z: -3.25, dimension: NETHER });
    });
});

describe('!rememberHere(name) when saving fails (Amendment 1, M2)', () => {
    test('the store refuses a 65-character name: "Could not save the location ..."', async () => {
        const agent = makeAgent({ memoryBank: storeBank() });
        const name = 'n'.repeat(65);
        const reply = await action('!rememberHere').perform(agent, name);
        assert.equal(reply, `Could not save the location "${name}".`);
        assert.equal(agent.memory_bank.getKeys(), '');
    });

    test('the store refuses an empty name: "Could not save the location \"\"."', async () => {
        const agent = makeAgent({ memoryBank: storeBank() });
        const reply = await action('!rememberHere').perform(agent, '');
        assert.equal(reply, 'Could not save the location "".');
    });
});

describe('!goToRememberedPlace(name)', () => {
    test('unknown name: as today, "No location named ... saved.", no movement', async () => {
        const agent = makeAgent();
        const returned = await action('!goToRememberedPlace').perform(agent, 'nowhere');
        assert.ok(seen(agent, returned).includes('No location named "nowhere" saved.'), seen(agent, returned));
        assert.deepEqual(agent.bot.entity.position, { x: 1.5, y: 64, z: -3.25 });
        assert.deepEqual(agent.chats, []);
    });

    test('place without dimension (no store): travels as today, whatever the current dimension', async () => {
        const agent = makeAgent({ dimension: NETHER });
        agent.memory_bank.rememberPlace('farm', 10, 70, 20);
        await action('!goToRememberedPlace').perform(agent, 'farm');
        assert.deepEqual(agent.chats, ['/tp @s 10 70 20']);
        assert.deepEqual(agent.bot.entity.position, { x: 10, y: 70, z: 20 });
    });

    test('place in the current dimension: travels as today', async () => {
        const agent = makeAgent({ dimension: OVERWORLD, memoryBank: storeBank() });
        agent.memory_bank.rememberPlace('base', -5, 63, 8, OVERWORLD);
        const returned = await action('!goToRememberedPlace').perform(agent, 'base');
        assert.deepEqual(agent.chats, ['/tp @s -5 63 8']);
        assert.deepEqual(agent.bot.entity.position, { x: -5, y: 63, z: 8 });
        assert.ok(seen(agent, returned).includes('Teleported to -5, 63, 8.'));
    });

    test('place in another dimension: refuses, bot does not move, exact refusal text', async () => {
        const agent = makeAgent({ dimension: NETHER, memoryBank: storeBank() });
        agent.memory_bank.rememberPlace('base', -5, 63, 8, OVERWORLD);
        const returned = await action('!goToRememberedPlace').perform(agent, 'base');
        const expected = `"base" is in the dimension ${OVERWORLD}, but you are in ${NETHER}. You cannot travel between dimensions by yourself.`;
        assert.ok(seen(agent, returned).includes(expected), seen(agent, returned));
        assert.deepEqual(agent.bot.entity.position, { x: 1.5, y: 64, z: -3.25 });
        assert.deepEqual(agent.chats, [], 'no teleport, no chat');
    });
});

describe('!goToRememberedPlace(name): current dimension unknown (Amendment 1, M7)', () => {
    for (const [label, dimension] of [['empty string', ''], ['undefined', undefined], ['null', null]]) {
        test(`current dimension ${label}: the bot moves as before`, async () => {
            const agent = makeAgent({ memoryBank: storeBank() });
            agent.memory_bank.rememberPlace('base', -5, 63, 8, OVERWORLD);
            agent.bot.game.dimension = dimension;
            await action('!goToRememberedPlace').perform(agent, 'base');
            assert.deepEqual(agent.chats, ['/tp @s -5 63 8']);
            assert.deepEqual(agent.bot.entity.position, { x: -5, y: 63, z: 8 });
        });
    }
});

describe('!savedPlaces', () => {
    test('without a store: unchanged, "Saved place names: " + getKeys()', async () => {
        const agent = makeAgent();
        agent.memory_bank.rememberPlace('zeta', 1, 2, 3);
        agent.memory_bank.rememberPlace('alpha', 4, 5, 6);
        assert.equal(await query('!savedPlaces').perform(agent), 'Saved place names: zeta, alpha');
    });

    test('with a store: "Saved places: " + describePlaces()', async () => {
        const agent = makeAgent({ memoryBank: storeBank() });
        agent.memory_bank.rememberPlace('alpha', 1, 2, 3, OVERWORLD);
        agent.memory_bank.rememberPlace('beta', 4, 5, 6, null);
        assert.equal(await query('!savedPlaces').perform(agent), `Saved places: alpha (${OVERWORLD}), beta`);
    });

    test('with an empty store: "Saved places: none"', async () => {
        const agent = makeAgent({ memoryBank: storeBank() });
        assert.equal(await query('!savedPlaces').perform(agent), 'Saved places: none');
    });
});

describe('!forgetPlace(name)', () => {
    test('is a new action with a string parameter "name"', () => {
        const cmd = action('!forgetPlace');
        assert.equal(cmd.params?.name?.type, 'string');
        assert.equal(typeof cmd.description, 'string');
        assert.equal(queries.queryList.some((c) => c.name === '!forgetPlace'), false);
    });

    for (const [label, bankFactory] of [['without a store', () => new MB.MemoryBank()], ['with a store', () => storeBank()]]) {
        test(`${label}: forgets an existing place, reply "Forgot the place ..."`, async () => {
            const agent = makeAgent({ memoryBank: bankFactory() });
            agent.memory_bank.rememberPlace('home', 1, 2, 3);
            const returned = await action('!forgetPlace').perform(agent, 'home');
            assert.ok(seen(agent, returned).includes('Forgot the place "home".'), seen(agent, returned));
            assert.equal(agent.memory_bank.recallPlace('home'), undefined);
        });

        test(`${label}: unknown place, reply "No location named ... saved."`, async () => {
            const agent = makeAgent({ memoryBank: bankFactory() });
            const returned = await action('!forgetPlace').perform(agent, 'home');
            assert.ok(seen(agent, returned).includes('No location named "home" saved.'), seen(agent, returned));
        });
    }
});

describe('!nameWorld(name)', () => {
    test('is a new action with a string parameter "name"', () => {
        const cmd = action('!nameWorld');
        assert.equal(cmd.params?.name?.type, 'string');
        assert.equal(typeof cmd.description, 'string');
    });

    test('world memory off (agent.world_memory undefined): "World memory is off."', async () => {
        const agent = makeAgent();
        const returned = await action('!nameWorld').perform(agent, 'Home');
        assert.ok(seen(agent, returned).includes('World memory is off.'), seen(agent, returned));
    });

    test('world memory on: sets the manual label, reply "This world is now called ..."', async () => {
        const labels = [];
        const worldMemory = { world: { key: 'seed-00000000000000aa', label: 'Alpha' }, setLabel(label) { labels.push(label); return true; } };
        const agent = makeAgent({ worldMemory });
        const returned = await action('!nameWorld').perform(agent, 'Home');
        assert.deepEqual(labels, ['Home']);
        assert.ok(seen(agent, returned).includes('This world is now called "Home".'), seen(agent, returned));
    });

    test('world memory on, setLabel fails: "Could not name the world."', async () => {
        const worldMemory = { world: null, setLabel: () => false };
        const agent = makeAgent({ worldMemory });
        const returned = await action('!nameWorld').perform(agent, 'Home');
        assert.ok(seen(agent, returned).includes('Could not name the world.'), seen(agent, returned));
        assert.ok(!seen(agent, returned).includes('This world is now called'));
    });
});

describe('!stats', () => {
    function statsLines(agent) {
        assert.equal(typeof mcdata.__setMcdataForTests, 'function', 'test hook for mcdata.js is active');
        mcdata.__setMcdataForTests({ biomes: { 1: { name: 'plains' } } });
        const text = query('!stats').perform(agent);
        return text.split('\n');
    }
    const positionIndex = (lines) => lines.findIndex((l) => l.startsWith('- Position:'));

    test('world memory off: unchanged, Gamemode follows Position, no World / Dimension lines', () => {
        const lines = statsLines(makeAgent());
        const i = positionIndex(lines);
        assert.equal(lines[i], '- Position: x: 1.50, y: 64.00, z: -3.25');
        assert.equal(lines[i + 1], '- Gamemode: survival');
        assert.ok(!lines.some((l) => l.startsWith('- World:') || l.startsWith('- Dimension:')));
    });

    test('world memory on but no resolved world: unchanged', () => {
        const lines = statsLines(makeAgent({ worldMemory: { world: null, setLabel: () => false } }));
        const i = positionIndex(lines);
        assert.equal(lines[i + 1], '- Gamemode: survival');
    });

    test('world memory on with a resolved world: "- World: <label>" and "- Dimension: <dimension>" directly after Position', () => {
        const worldMemory = { world: { key: 'seed-00000000000000aa', label: 'Alpha Server' }, setLabel: () => true };
        const lines = statsLines(makeAgent({ dimension: NETHER, worldMemory }));
        const i = positionIndex(lines);
        assert.ok(i >= 0);
        assert.deepEqual(lines.slice(i + 1, i + 4), ['- World: Alpha Server', `- Dimension: ${NETHER}`, '- Gamemode: survival']);
    });
});
