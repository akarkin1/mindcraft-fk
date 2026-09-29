// Part G of v0.1.4.8 (E6): the commands in src/agent/commands/actions.js and queries.js.
//   - a stopped command (I5, S3, S4): runAsAction, runForText, runPack and !newAction put
//     `Command !<name> was stopped by <who>. Done so far: <text>` into the history as a system message
//     and return nothing; the text of a pack (I6) wins over the output of the action;
//   - the commands of the packs pause unstuck at their start (I1);
//   - !stop passes '!stop'; !setMode refuses the model for the five safety reflexes (R4);
//   - the new and changed commands of section 11: !pickUpItems, !closeDoor, !chests(item),
//     !mineOre(new_mine), !chopTrees in both orders, !rememberArea and !setArea with five types,
//     findFencedGroundNear from outside the gate, replaceRefusal, !givePlayer fetches first, !discard,
//     !inventory with the off-hand, !eat with the pack context;
//   - the descriptions say what the commands do now.
// Fake agents and fake packs; the area commands use the real area store and a block world.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
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
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, index, actions, queries, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const AS = await loadSrc('src/agent/areas/area_store.js');
const AG = await loadSrc('src/agent/areas/area_guard.js');
const STORAGE = await loadSrc('src/agent/packs/storage/index.js');

const BASE = { language: 'en', world_memory: true, protected_areas: true, home_pack: false, storage_pack: false, farming_pack: false,
    wood_pack: false, mining_pack: false, blocked_actions: [] };

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

const command = (name) => {
    const cmd = M.actions.actionsList.find((c) => c.name === name) ?? M.queries.queryList.find((c) => c.name === name);
    assert.ok(cmd, `${name} exists`);
    return cmd;
};

// A fake agent. runAction runs fn (by default only without `result`) and returns the result that
// `result(label, output)` gives, by default a finished action with the output of the bot. The history
// records its turns; bot.modes records pauses.
function makeAgent({ result = null, bot = {}, fields = {}, run = result === null } = {}) {
    const turns = [];
    const pauses = [];
    const agent = {
        name: 'andy',
        turns,
        pauses,
        runs: [],
        bot: {
            username: 'andy', output: '', interrupt_code: false, entity: { position: vec(0.5, 64, 0.5) }, game: { dimension: 'overworld' },
            entities: {}, inventory: { slots: [], items: () => [] },
            modes: { pause: (name) => pauses.push({ name, during: agent.running }) },
            ...bot,
        },
        running: null,
        history: { add: async (name, content) => { turns.push([name, content]); } },
        actions: {
            async runAction(label, fn, options) {
                agent.runs.push({ label, options });
                agent.running = label;
                try {
                    if (run)
                        await fn();
                } finally {
                    agent.running = null;
                }
                const output = 'Action output:\n' + agent.bot.output;
                agent.bot.output = '';
                return result ? result(label, output) : { success: true, message: output, interrupted: false, timedout: false };
            },
        },
        ...fields,
    };
    return agent;
}

const stopped = (by, message = 'Action output:\n') => () => ({ success: true, message, interrupted: true, timedout: false, stopped_by: by });

function fakePack(names) {
    const pack = { calls: [] };
    for (const name of names) {
        pack[name] = async (...args) => {
            pack.calls.push({ name, args });
            return { ok: true, reason: null, text: `${name} text` };
        };
    }
    return pack;
}

describe('a stopped command starts no turn of the model (I5, S3, S4)', () => {
    test('runAsAction: the output so far into the history, nothing returned', async () => {
        const agent = makeAgent({ result: stopped('the reflex unstuck', 'Action output:\nI see no items on the ground within 16 blocks.\n'), run: true });
        assert.equal(await command('!pickUpItems').perform(agent, '', 16), undefined);
        assert.deepEqual(agent.turns, [['system', 'Command !pickUpItems was stopped by the reflex unstuck. Done so far: I see no items on the ground within 16 blocks.']]);
    });

    test('without any output: only the first sentence', async () => {
        const agent = makeAgent({ result: stopped('!stop') });
        assert.equal(await command('!goToCoordinates').perform(agent, 1, 64, 1, 1), undefined);
        assert.deepEqual(agent.turns, [['system', 'Command !goToCoordinates was stopped by !stop.']]);
    });

    test('runPack: the text of the pack (I6) wins over the output of the action', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const mining = fakePack(['mineOre']);
        mining.mineOre = async () => ({ ok: false, reason: 'interrupted', text: 'I mined 3 raw_iron. I was stopped before I mined the rest.' });
        const agent = makeAgent({ result: stopped('the reflex unstuck', 'Action output:\nlog line\n'), fields: { work_packs: { mining }, packContext: () => ({}) }, run: true });
        assert.equal(await command('!mineOre').perform(agent, 'iron', 8, false), undefined);
        assert.deepEqual(agent.turns, [['system', 'Command !mineOre was stopped by the reflex unstuck. Done so far: I mined 3 raw_iron. I was stopped before I mined the rest.']]);
    });

    test('runForText of the old commands: the output of the action', async () => {
        const agent = makeAgent({ result: stopped('the command !goToPlayer', 'Action output:\nCollected 3 oak_log.\n') });
        assert.equal(await command('!collectBlocks').perform(agent, 'oak_log', 8), undefined);
        assert.deepEqual(agent.turns, [['system', 'Command !collectBlocks was stopped by the command !goToPlayer. Done so far: Collected 3 oak_log.']]);
    });

    test('a stopper that is not known: "an interrupt"', async () => {
        const agent = makeAgent({ result: () => ({ success: true, message: 'Action output:\n', interrupted: true, timedout: false }) });
        await command('!goToSurface').perform(agent);
        assert.deepEqual(agent.turns, [['system', 'Command !goToSurface was stopped by an interrupt.']]);
    });

    test('a time limit is no stop: the output is returned as before', async () => {
        const agent = makeAgent({ result: () => ({ success: true, message: 'Action output:\nslow', interrupted: true, timedout: true }) });
        assert.equal(await command('!goToSurface').perform(agent), 'Action output:\nslow');
        assert.deepEqual(agent.turns, []);
    });

    test('a history that fails does not break the command', async () => {
        const agent = makeAgent({ result: stopped('!stop') });
        agent.history = { add: async () => { throw new Error('disk full'); } };
        assert.equal(await command('!goToSurface').perform(agent), undefined);
        agent.history = null;
        assert.equal(await command('!goToSurface').perform(agent), undefined);
    });

    test('!newAction stopped (S4): its late result goes into the history, nothing returned', async () => {
        M.settingsModule.setSettings({ ...BASE, allow_insecure_coding: true });
        const agent = makeAgent({ result: stopped('the command !getTool'), run: true });
        agent.coder ={ last_run: null, generateCode: async () => 'Agent wrote this code: ...\nCode Output:\nI dug 2 blocks.' };
        agent.openChat = () => {};
        assert.equal(await command('!newAction').perform(agent, 'dig'), undefined);
        assert.deepEqual(agent.turns, [['system', 'Command !newAction was stopped by the command !getTool. Done so far: Agent wrote this code: ...\nCode Output:\nI dug 2 blocks.']]);
    });

    test('!newAction not stopped: its result as before', async () => {
        M.settingsModule.setSettings({ ...BASE, allow_insecure_coding: true });
        const agent = makeAgent();
        agent.coder = { last_run: null, generateCode: async () => 'done' };
        assert.equal(await command('!newAction').perform(agent, 'dig'), 'done');
        assert.deepEqual(agent.turns, []);
    });
});

describe('the pack commands pause unstuck at their start (I1)', () => {
    test('runPack: bot.modes.pause("unstuck") inside the action, before the pack runs', async () => {
        M.settingsModule.setSettings({ ...BASE, storage_pack: true });
        const storage = fakePack(['storeItems']);
        const agent = makeAgent({ fields: { work_packs: { storage }, packContext: () => ({}) } });
        assert.equal(await command('!storeItems').perform(agent), 'storeItems text');
        assert.deepEqual(agent.pauses, [{ name: 'unstuck', during: 'action:storeItems' }]);
        assert.equal(agent.last_pack_text, 'storeItems text', 'noted for say_results');
    });

    test('the commands of the home pack: !closeDoor, !eat, !goToShelter, !goToBed', async () => {
        M.settingsModule.setSettings({ ...BASE, home_pack: true });
        const agent = makeAgent({ fields: { door_service: { closeNear: async (range) => ({ text: `closed within ${range}` }) } } });
        assert.equal(await command('!closeDoor').perform(agent), 'closed within 6');
        assert.deepEqual(agent.pauses, [{ name: 'unstuck', during: 'action:closeDoor' }]);
        assert.equal(agent.last_pack_text, 'closed within 6');
        // the other three run the real home pack against a bot without a world; each pauses first
        agent.homeContext = () => ({ areas: null, places: null, settings: M.settingsModule.default, log() {}, now: () => Date.now() });
        for (const name of ['!eat', '!goToShelter', '!goToBed']) {
            agent.pauses.length = 0;
            await command(name).perform(agent);
            assert.deepEqual(agent.pauses[0], { name: 'unstuck', during: `action:${name.slice(1)}` }, name);
        }
    });

    test('a bot without modes, or modes that throw: the command runs', async () => {
        M.settingsModule.setSettings({ ...BASE, home_pack: true });
        const service = { closeNear: async () => ({ text: 'All doors near me are closed.' }) };
        for (const modes of [undefined, { pause() { throw new Error('no mode unstuck'); } }]) {
            const agent = makeAgent({ bot: { modes }, fields: { door_service: service } });
            assert.equal(await command('!closeDoor').perform(agent), 'All doors near me are closed.');
        }
    });

    test('the old commands do not pause it', async () => {
        const agent = makeAgent({ run: false });
        await command('!goToSurface').perform(agent).catch(() => {});
        await command('!collectBlocks').perform(agent, 'stone', 1).catch(() => {});
        assert.deepEqual(agent.pauses, []);
    });
});

describe('!stop and !setMode', () => {
    test('!stop tells the action manager who stops', async () => {
        const stops = [];
        const agent = {
            actions: { stop: async (by) => stops.push(by), cancelResume() {} },
            clearBotLogs() {}, bot: { emit() {} }, self_prompter: { isActive: () => false }, last_order: { by: 'bob' },
        };
        assert.equal(await command('!stop').perform(agent), 'Agent stopped.');
        assert.deepEqual(stops, ['!stop']);
        assert.equal(agent.last_order, null);
    });

    function modesAgent(fields = {}) {
        const state = { self_preservation: true, creeper_safety: true, night_shelter: true, door_closing: true, hunger: true, hunting: true, unstuck: true };
        return {
            state,
            bot: { modes: { exists: (n) => n in state, isOn: (n) => state[n], setOn: (n, on) => { state[n] = on; }, getDocs: () => '' } },
            ...fields,
        };
    }
    const SAFETY = ['self_preservation', 'creeper_safety', 'night_shelter', 'door_closing', 'hunger'];

    test('a call of the model may not switch a safety reflex off: the text of the spec', async () => {
        for (const name of SAFETY) {
            const agent = modesAgent();
            assert.equal(await command('!setMode').perform(agent, name, false),
                `Only the player switches the reflex ${name}. The player can type !setMode("${name}", false) in the chat.`);
            assert.equal(agent.state[name], true, name);
        }
    });

    test('through executeCommand of the model (typed: false) it is refused too', async () => {
        const agent = modesAgent();
        assert.match(await M.index.executeCommand(agent, '!setMode("creeper_safety", false)', { typed: false }), /^Only the player switches the reflex creeper_safety\./);
        assert.equal(agent.state.creeper_safety, true);
    });

    test('a command typed by the player runs', async () => {
        const agent = modesAgent();
        assert.equal(await M.index.executeCommand(agent, '!setMode("creeper_safety", false)', { typed: true }), 'Mode creeper_safety is now off.');
        assert.equal(agent.state.creeper_safety, false);
        // the order of handleMessage alone (typed: true and this command) counts as typed too
        const other = modesAgent({ last_order: { by: 'bob', command: '!setMode', typed: true } });
        assert.equal(await M.index.executeCommand(other, '!setMode("hunger", false)'), 'Mode hunger is now off.');
        const answered = modesAgent({ last_order: { by: 'bob', command: '!setMode', typed: false } });
        assert.match(await M.index.executeCommand(answered, '!setMode("hunger", false)'), /^Only the player/);
    });

    test('switching a safety reflex on is always allowed; other modes as before', async () => {
        const agent = modesAgent();
        agent.state.night_shelter = false;
        assert.equal(await command('!setMode').perform(agent, 'night_shelter', true), 'Mode night_shelter is now on.');
        assert.equal(await command('!setMode').perform(agent, 'hunting', false), 'Mode hunting is now off.');
        assert.equal(await command('!setMode').perform(agent, 'unstuck', false), 'Mode unstuck is now off.');
    });
});

describe('!pickUpItems (B4)', () => {
    test('an action that calls skills.pickUpItems with the item and the range; defaults "" and 16', async () => {
        const agent = makeAgent();
        assert.equal(await command('!pickUpItems').perform(agent, '', 16), 'Action output:\nI see no items on the ground within 16 blocks.\n');
        assert.equal(await command('!pickUpItems').perform(agent, 'oak_fence', 8), 'Action output:\nI see no oak_fence on the ground within 8 blocks.\n');
        assert.deepEqual(agent.runs.map((r) => r.label), ['action:pickUpItems', 'action:pickUpItems']);
        assert.deepEqual(M.index.parseCommandMessage('!pickUpItems').args, ['', 16]);
        assert.deepEqual(M.index.parseCommandMessage('!pickUpItems("oak_fence")').args, ['oak_fence', 16]);
        assert.equal(M.index.isAction('!pickUpItems'), true);
    });
});

describe('!closeDoor (C5, R7)', () => {
    test('the door service of the agent: closeNear(6), its text', async () => {
        M.settingsModule.setSettings({ ...BASE, home_pack: true });
        const calls = [];
        const agent = makeAgent({ fields: { door_service: { closeNear: async (range) => { calls.push(range); return { text: 'I closed oak_door at (1, 64, 2).' }; } } } });
        assert.equal(await command('!closeDoor').perform(agent), 'I closed oak_door at (1, 64, 2).');
        assert.deepEqual(calls, [6]);
        assert.deepEqual(agent.runs, [{ label: 'action:closeDoor', options: { timeout: -1, resume: false } }]);
    });

    test('without a door service: closeNear of the home pack', async () => {
        M.settingsModule.setSettings({ ...BASE, home_pack: true });
        const agent = makeAgent({ bot: { blockAt: () => null, findBlocks: () => [] }, fields: { door_service: null, homeContext: () => ({ settings: M.settingsModule.default }) } });
        assert.equal(await command('!closeDoor').perform(agent), 'All doors near me are closed.');
    });

    test('home_pack off: the command says so and runs nothing', async () => {
        const agent = makeAgent({ fields: { door_service: { closeNear() { throw new Error('must not run'); } } } });
        assert.equal(await command('!closeDoor').perform(agent), 'The home pack is off.');
        assert.deepEqual(agent.runs, []);
    });
});

describe('the work commands of section 11', () => {
    test('!chests(item): the chests that hold the item, from the real storage pack', () => {
        M.settingsModule.setSettings({ ...BASE, storage_pack: true });
        const index = new STORAGE.ChestIndex(null);
        const agent = makeAgent({ fields: { work_packs: { storage: STORAGE }, packContext: () => ({ chests: index }) } });
        assert.equal(command('!chests').perform(agent, 'wheat'), 'I know no chest with wheat.');
        index.update({ x: 11, y: 67, z: 53, dimension: 'overworld', kind: 'chest', items: { wheat: 28, cobblestone: 81 }, free_slots: 4, seen: '2026-09-29T00:00:00.000Z' });
        assert.equal(command('!chests').perform(agent, 'wheat'), 'wheat: 28 in the chest at (11, 67, 53). Total 28.');
        assert.match(command('!chests').perform(agent, ''), /^Chests I know in this world:\n- \(11, 67, 53\): 81 cobblestone, 28 wheat, 4 free slots$/);
    });

    test('!mineOre: new_mine reaches the pack as options.newMine', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const mining = fakePack(['mineOre']);
        const agent = makeAgent({ fields: { work_packs: { mining }, packContext: () => ({}) } });
        await M.index.executeCommand(agent, '!mineOre("iron", 8, true)');
        await M.index.executeCommand(agent, '!mineOre("coal")');
        assert.deepEqual(mining.calls.map((c) => c.args.slice(2)), [['iron', 8, { newMine: true }], ['coal', 8, { newMine: false }]]);
    });

    test('!chopTrees: both orders of the arguments, num is the number of logs (T5)', async () => {
        M.settingsModule.setSettings({ ...BASE, wood_pack: true });
        const wood = fakePack(['chopTrees']);
        const agent = makeAgent({ fields: { work_packs: { wood }, packContext: () => ({}) } });
        for (const message of ['!chopTrees(8, "oak")', '!chopTrees("oak", 8)', '!chopTrees("", 8)', '!chopTrees(8)', '!chopTrees', '!chopTrees("8", "oak")']) {
            const reply = await M.index.executeCommand(agent, message);
            assert.equal(reply, 'chopTrees text', message);
        }
        assert.deepEqual(wood.calls.map((c) => c.args.slice(2)), [[8, 'oak'], [8, 'oak'], [8, ''], [8, ''], [8, ''], [8, 'oak']]);
        assert.match(M.index.parseCommandMessage('!chopTrees(0)'), /^Error: Param 'num' must be an element of/);
    });

    test('!givePlayer: with the storage pack it first fetches what the bot does not carry', async () => {
        M.settingsModule.setSettings({ ...BASE, storage_pack: true });
        const fetched = [];
        const storage = { fetchItem: async (name, n) => { fetched.push([name, n]); return { ok: true, text: `I took ${n} ${name} from the chest at (11, 67, 53).` }; } };
        const bot = { players: { steve: { entity: null } }, inventory: { slots: [null, { name: 'wheat', count: 2 }], items: () => [] } };
        const agent = makeAgent({ bot, fields: { work_packs: { storage: {} }, packContext: () => ({ storage }) } });
        const reply = await command('!givePlayer').perform(agent, 'steve', 'wheat', 5);
        assert.deepEqual(fetched, [['wheat', 3]], 'only what it does not carry');
        assert.match(reply, /^Action output:\nI took 3 wheat from the chest at \(11, 67, 53\)\.\nCould not find steve\.\n$/);
        assert.equal(agent.pauses[0]?.name, 'unstuck', 'the walk to the chest pauses unstuck');
        // it carries enough: no fetch
        fetched.length = 0;
        await command('!givePlayer').perform(agent, 'steve', 'wheat', 2);
        assert.deepEqual(fetched, []);
    });

    test('!givePlayer without the storage pack: as before, no fetch, the old description', async () => {
        const agent = makeAgent({ bot: { players: { steve: { entity: null } }, inventory: { slots: [], items: () => [] } } });
        Object.defineProperty(agent, 'work_packs', { get() { throw new Error('the packs must not be used'); } });
        agent.packContext = () => { throw new Error('no pack context'); };
        assert.equal(await command('!givePlayer').perform(agent, 'steve', 'wheat', 5), 'Action output:\nCould not find steve.\n');
        assert.equal(command('!givePlayer').description, 'Give the specified item to the given player.');
        M.settingsModule.setSettings({ ...BASE, storage_pack: true });
        assert.equal(command('!givePlayer').description, 'Give an item to a player. What you do not carry you first fetch from a chest you know.');
    });

    test('!eat: the pack context with the storage pack (it can name a chest with food), else the home context', async () => {
        M.settingsModule.setSettings({ ...BASE, home_pack: true, storage_pack: true });
        const made = [];
        const context = (kind) => () => { made.push(kind); return { settings: M.settingsModule.default, log() {}, now: () => Date.now() }; };
        const agent = makeAgent({ bot: { food: 20, health: 20 }, fields: { packContext: context('pack'), homeContext: context('home') } });
        await command('!eat').perform(agent);
        M.settingsModule.setSettings({ ...BASE, home_pack: true, storage_pack: false });
        await command('!eat').perform(agent);
        assert.deepEqual(made, ['pack', 'home']);
    });

    test('!discard walks away through skills.discard with 5 blocks, and back only when the bot moved (source, S14)', () => {
        const text = fs.readFileSync(repoPath('src/agent/commands/actions.js'), 'utf8').replace(/\r\n/g, '\n');
        const start = text.indexOf("name: '!discard'");
        const block = text.slice(start, text.indexOf("name: '!collectBlocks'"));
        assert.ok(block.includes('await skills.discard(agent.bot, item_name, num, 5);'), block);
        assert.ok(!block.includes('moveAway'), 'no moveAway before the toss');
        assert.ok(block.includes('>= 1)\n                await skills.goToPosition(agent.bot, start.x, start.y, start.z, 0);'), 'back only when it moved');
    });
});

describe('!inventory: the line of the off-hand (B2, E1)', () => {
    const inventoryOf = (slots) => command('!inventory').perform({ bot: { inventory: { slots }, game: { gameMode: 'survival' } } });

    test('after the list of items and before WEARING; counted once in the list', () => {
        const slots = [];
        slots[36] = { name: 'stone', count: 3 };
        slots[45] = { name: 'bread', count: 6 };
        assert.equal(inventoryOf(slots), '\nINVENTORY\n- stone: 3\n- bread: 6\nIn the off-hand: bread 6\nWEARING: Nothing\n');
    });

    test('an empty off-hand: no line, as before', () => {
        const slots = [];
        slots[36] = { name: 'stone', count: 3 };
        assert.equal(inventoryOf(slots), '\nINVENTORY\n- stone: 3\nWEARING: Nothing\n');
    });
});

describe('!rememberArea and !setArea with the five types (I4, D5, D7)', () => {
    function makeWorld() {
        const world = createBlockWorld().flatGround(63);
        const house = world.house({ x: 0, y: 63, z: 0 });
        const field = world.field({ x: 20, y: 63, z: 0 });
        const pen = world.field({ x: 40, y: 63, z: 0, ground: 'grass_block', crop: null });
        return { world, house, field, pen };
    }

    function areaAgent({ at, world, fields = {} }) {
        const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: () => new Date(Date.UTC(2026, 0, 1)) });
        store.load();
        const agent = makeAgent({ bot: { entity: { position: vec(at.x, at.y, at.z) }, blockAt: (pos) => world.blockAt(pos) }, fields });
        agent.area_store = store;
        agent.homeContext = () => ({ areas: store, places: null, settings: M.settingsModule.default, log() {}, now: () => Date.now() });
        return agent;
    }

    test('the types come from area_store.js; an unknown type gets the text with all five', async () => {
        assert.deepEqual([...AS.AREA_TYPES], ['home', 'building', 'farm', 'pen', 'mine']);
        const { world } = makeWorld();
        const agent = areaAgent({ at: { x: 100.5, y: 64, z: 100.5 }, world });
        assert.equal(await command('!rememberArea').perform(agent, 'x', 'house'), 'The type of an area is "home", "building", "farm", "pen" or "mine".');
        assert.equal(await command('!setArea').perform(agent, 'x', 'barn', 0, 60, 0, 5, 65, 5), 'The type of an area is "home", "building", "farm", "pen" or "mine".');
    });

    test('home and mine: the building around the bot, else a box; the mine has its own text', async () => {
        const { world, house } = makeWorld();
        const agent = areaAgent({ at: { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 }, world });
        assert.match(await command('!rememberArea').perform(agent, 'home', 'home'), /^Area "home" \(home\) saved: \d+ x \d+ x \d+ blocks, from \(.+\) to \(.+\), 1 door\. Tell me if that is wrong\.$/);
        const far = areaAgent({ at: { x: 100.5, y: 64, z: 100.5 }, world });
        assert.equal(await command('!rememberArea').perform(far, 'mine', 'mine'), 'I saved a box of 25 x 13 x 25 blocks around this place as the mine "mine". Use !setArea to correct it.');
        assert.equal(far.area_store.get('mine').type, 'mine');
    });

    test('a farm with the bot inside: saved with its gate', async () => {
        const { world, field } = makeWorld();
        const agent = areaAgent({ at: { x: field.inside.x + 0.5, y: field.inside.y, z: field.inside.z + 0.5 }, world });
        assert.match(await command('!rememberArea').perform(agent, 'farm', 'farm'), /^Area "farm" \(farm\) saved: 7 x \d+ x 7 blocks, from \(19, \d+, -1\) to \(25, \d+, 5\), 1 gate\. Tell me if that is wrong\.$/);
        assert.deepEqual(agent.runs, [], 'no walk');
    });

    test('a farm from outside the gate, home_pack off: the ground behind the gate is saved, no walk (P5)', async () => {
        const { world, field } = makeWorld();
        const agent = areaAgent({ at: { x: field.gate.x + 0.5, y: 64, z: field.gate.z + 2.5 }, world });
        const reply = await command('!rememberArea').perform(agent, 'farm', 'farm');
        assert.match(reply, /^I stand outside the fence\. The gate is at \(22, 64, 5\)\. Area "farm" \(farm\) saved: 7 x \d+ x 7 blocks, .*, 1 gate\. Tell me if that is wrong\.$/);
        assert.equal(agent.area_store.get('farm').type, 'farm');
        assert.deepEqual(agent.runs, []);
    });

    test('a farm from outside the gate, home_pack on: saved, then in through the gate with passThrough as an action', async () => {
        M.settingsModule.setSettings({ ...BASE, home_pack: true });
        const { world, field } = makeWorld();
        const agent = areaAgent({ at: { x: field.gate.x + 0.5, y: 64, z: field.gate.z + 2.5 }, world });
        const reply = await command('!rememberArea').perform(agent, 'farm', 'farm');
        assert.equal(agent.area_store.get('farm').type, 'farm', 'saved before the walk');
        assert.deepEqual(agent.runs.map((r) => r.label), ['action:rememberArea']);
        assert.equal(agent.pauses[0]?.name, 'unstuck');
        // the fake bot cannot walk: the text says so, and that the area is saved
        assert.match(reply, /^I stand outside the fence\. The gate is at \(22, 64, 5\)\. Area "farm" \(farm\) saved: .* Tell me if that is wrong\. I could not go in: /);
    });

    test('a pen: fenced ground without farmland; a farm is refused as a pen and the other way round', async () => {
        const { world, field, pen } = makeWorld();
        const inPen = areaAgent({ at: { x: pen.inside.x + 0.5, y: pen.inside.y, z: pen.inside.z + 0.5 }, world });
        assert.match(await command('!rememberArea').perform(inPen, 'pen', 'pen'), /^Area "pen" \(pen\) saved: .*, 1 gate\. Tell me if that is wrong\.$/);
        assert.equal(await command('!rememberArea').perform(inPen, 'pasture', 'farm'), 'The fenced ground has no farmland and no crop, so it is no farm. Till one block of it, or save it as a pen.');
        const inField = areaAgent({ at: { x: field.inside.x + 0.5, y: field.inside.y, z: field.inside.z + 0.5 }, world });
        assert.equal(await command('!rememberArea').perform(inField, 'pen', 'pen'), 'The fenced ground has farmland, so it is a farm, not a pen. Save it as a farm.');
    });

    test('!setArea from the model: a thin box or a much smaller one is refused (D7); typed by the player it is saved', async () => {
        const { world } = makeWorld();
        const agent = areaAgent({ at: { x: 100.5, y: 64, z: 100.5 }, world });
        assert.match(await command('!setArea').perform(agent, 'pen', 'pen', 10, 63, 10, 20, 66, 20), /^Area "pen" \(pen\) saved: 11 x 4 x 11 blocks/);
        assert.equal(await command('!setArea').perform(agent, 'pen', 'pen', 10, 63, 10, 10, 65, 10),
            'The new box is only 1 block wide. An area needs at least 2 blocks in x and z. The player can type !setArea in the chat to do it.');
        assert.equal(await command('!setArea').perform(agent, 'pen', 'pen', 10, 63, 10, 13, 65, 13),
            'The new box is much smaller than the area "pen" that I know. The player can type !setArea in the chat to do it.');
        assert.equal(agent.area_store.get('pen').max.x, 20, 'unchanged');
        const reply = await M.index.executeCommand(agent, '!setArea("pen", "pen", 10, 63, 10, 13, 65, 13)', { typed: true });
        assert.match(reply, /^Area "pen" \(pen\) saved: 4 x 3 x 4 blocks/);
    });

    test('!areas and the saved text count the gates of a pen first', async () => {
        const { world } = makeWorld();
        const agent = areaAgent({ at: { x: 100.5, y: 64, z: 100.5 }, world });
        agent.area_store.set({ name: 'pen', type: 'pen', min: { x: 0, y: 60, z: 0 }, max: { x: 5, y: 65, z: 5 }, entrances: [{ x: 2, y: 61, z: 5, kind: 'gate' }], source: 'scan' });
        assert.equal(command('!areas').perform(agent), 'Protected areas in this world:\n- pen (pen): from (0, 60, 0) to (5, 65, 5), 1 gate');
    });
});

describe('the descriptions: what each command does now (section 11, item 9)', () => {
    // the sentences before "Use this ..." (the hint for the choice of the model)
    const sentences = (text) => text.split(/ Use this /)[0].split(/(?<=[.!?])\s+(?=[A-Z])/).length;
    const CHANGED = ['!pickUpItems', '!closeDoor', '!chests', '!mineOre', '!chopTrees', '!rememberArea', '!setArea', '!givePlayer', '!eat',
        '!goToShelter', '!farmCycle', '!makeBoneMeal', '!getTool', '!setMode'];

    test('one or two short sentences, and the words of the new behaviour', () => {
        M.settingsModule.setSettings({ ...BASE, storage_pack: true, home_pack: true });
        for (const name of CHANGED) {
            const description = command(name).description;
            assert.ok(typeof description === 'string' && description.length <= 260, `${name}: ${description}`);
            assert.ok(sentences(description) <= 3, `${name}: ${description}`);
        }
        const words = {
            '!mineOre': /ask the player/, '!chopTrees': /logs/, '!chests': /hold an item/, '!rememberArea': /home.*building.*farm.*pen.*mine/,
            '!eat': /full/, '!goToShelter': /home/, '!farmCycle': /bone meal in the composter/, '!givePlayer': /fetch from a chest/,
            '!setMode': /Only the player switches a safety reflex off/,
        };
        for (const [name, pattern] of Object.entries(words)) assert.match(command(name).description, pattern, name);
        for (const name of ['!makeBoneMeal', '!getTool']) assert.ok(!/shears/.test(command(name).description), `${name}: no shears`);
        assert.match(command('!getTool').params.material.description, /Empty: the best you can make, up to stone\./);
        assert.match(command('!mineOre').params.new_mine.description, /player said yes/);
    });

    test('the parameters of the new commands and their defaults', () => {
        assert.deepEqual(Object.entries(command('!pickUpItems').params).map(([n, p]) => [n, p.type, p.default]), [['item', 'string', ''], ['range', 'int', 16]]);
        assert.deepEqual(Object.entries(command('!chests').params).map(([n, p]) => [n, p.type, p.default]), [['item', 'string', '']]);
        assert.deepEqual(Object.entries(command('!mineOre').params).map(([n, p]) => [n, p.type, p.default]), [['ore', 'string', undefined], ['num', 'int', 8], ['new_mine', 'boolean', false]]);
        assert.deepEqual(Object.entries(command('!chopTrees').params).map(([n, p]) => [n, p.type, p.default]), [['num', 'IntOrString', 8], ['kind', 'string', '']]);
        assert.equal(command('!closeDoor').params, undefined);
    });
});
