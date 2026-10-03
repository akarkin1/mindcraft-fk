// T1 round 2, spec v0.1.4.8 section 11 (part G) and the parts "For part G" of the handoff notes:
//   item 8 !setMode and the five safety reflexes: refused for the model with the exact text, allowed
//          when typed by the player, switching on always allowed;
//   item 9 / I3 the guard and orders typed by the player: a typed !collectBlocks("oak_fence", 20) breaks
//          fences outside the areas with protect_built_blocks, the same command of the model does not,
//          inside an area even a typed command does not;
//   item 10 the commands of the table: parameters, defaults, what they call, and each only there while
//          its pack or switch is on; !chopTrees("", 8) and !chopTrees(8, "") reach the pack with 8 logs;
//          !rememberArea with the five types and from outside the gate; !setArea from the model that
//          shrinks an area is refused with the exact text;
//   handoff part B: !inventory names the off-hand; !discard walks away with a limit.
// The real commands, executeCommand, ActionManager, area store and guard; fake packs and a fake bot.
import { describe, test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { spawnSync } from 'node:child_process';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { loadGlue, makeGlueAgent, makeFakeBot, settle, blockedPushes } from '../helpers/st_glue_env.js';

const G = await loadGlue();
await import('ses'); // the global assert of the agent process, for resume actions
const AS = await loadSrc('src/agent/areas/area_store.js');

const LIMIT = { timeout: 30000 };
const BASE = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: true, protected_areas: true,
    home_pack: false, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false, protect_built_blocks: false,
    allow_insecure_coding: false, narrate_behavior: false };
const SAFETY = ['self_preservation', 'creeper_safety', 'night_shelter', 'door_closing', 'hunger'];

let cap;
let dir;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    G.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const set = (extra) => G.settingsModule.setSettings({ ...BASE, ...extra });
const run = (agent, message, typed) => G.index.executeCommand(agent, message, { typed });

// ------------------------------------------------------------------------------ !setMode (R4)

describe('item 8: !setMode and the safety reflexes', () => {
    const allOn = () => Object.fromEntries([...SAFETY, 'unstuck', 'idle_staring', 'cowardice'].map((n) => [n, true]));

    for (const name of SAFETY) {
        test(`${name}: switched off by the model: refused with the text of the spec; the mode stays on`, LIMIT, async () => {
            const agent = makeGlueAgent(G, { modes: allOn() });
            const r = await run(agent, `!setMode("${name}", false)`, false);
            assert.equal(r, `Only the player switches the reflex ${name}. The player can type !setMode("${name}", false) in the chat.`);
            assert.equal(agent.bot.modes.isOn(name), true);
        });

        test(`${name}: typed by the player: it runs`, LIMIT, async () => {
            const agent = makeGlueAgent(G, { modes: allOn() });
            await run(agent, `!setMode("${name}", false)`, true);
            assert.equal(agent.bot.modes.isOn(name), false);
        });

        test(`${name}: switched on by the model: allowed`, LIMIT, async () => {
            const agent = makeGlueAgent(G, { modes: { ...allOn(), [name]: false } });
            await run(agent, `!setMode("${name}", true)`, false);
            assert.equal(agent.bot.modes.isOn(name), true);
        });
    }

    test('the other modes: the model may switch them off, as in v0.1.4.7', LIMIT, async () => {
        const agent = makeGlueAgent(G, { modes: allOn() });
        await run(agent, '!setMode("idle_staring", false)', false);
        await run(agent, '!setMode("unstuck", false)', false);
        assert.equal(agent.bot.modes.isOn('idle_staring'), false);
        assert.equal(agent.bot.modes.isOn('unstuck'), false);
    });

    test('through the loop of the agent: the answer of the model is refused; the same command typed in the chat runs', LIMIT, async () => {
        const agent = makeGlueAgent(G, { modes: allOn(), replies: ['!setMode("creeper_safety", false)', ''] });
        await agent.handleMessage('MartyByrde2', 'the creeper reflex is annoying, turn it off');
        assert.equal(agent.bot.modes.isOn('creeper_safety'), true);
        assert.ok(agent.turns.some(([n, t]) => n === 'system' && t.includes('Only the player switches the reflex creeper_safety.')), JSON.stringify(agent.turns));
        await agent.handleMessage('MartyByrde2', '!setMode("creeper_safety", false)');
        assert.equal(agent.bot.modes.isOn('creeper_safety'), false);
    });
});

// ------------------------------------------------------------------ the guard and typed orders

describe('item 9, I3: the guard and orders typed by the player', () => {
    const OUTSIDE = [[3, 64, 0], [4, 64, 0], [5, 64, 0], [6, 64, 0]];
    const PEN = { name: 'pen', type: 'pen', min: { x: -12, y: 62, z: -12 }, max: { x: -8, y: 66, z: -8 }, dimension: 'overworld' };
    const IN_PEN = [[-12, 64, -10], [-12, 64, -11], [-12, 64, -9]];

    function scene(extra = {}) {
        set({ protect_built_blocks: true, ...extra });
        const w = createBlockWorld().flatGround(63);
        for (const [x, y, z] of [...OUTSIDE, ...IN_PEN]) w.set(x, y, z, 'oak_fence');
        fs.writeFileSync(path.join(dir, 'areas.json'), JSON.stringify({ version: 1, migrated: 1, areas: { pen: PEN } }));
        const bot = makeFakeBot({ world: w, pos: [0.5, 64, 0.5], realBlocks: true });
        bot.gotoImpl = async (goal) => { if (Number.isFinite(goal?.x)) bot.entity.position = new Vec3(goal.x + 0.5, 64, goal.z + 0.5); };
        bot.collectBlock = {
            async collect(block) { w.set(block.position.x, block.position.y, block.position.z, 'air'); bot.inventory.add('oak_fence', 1); },
            cancelTask() {},
        };
        const agent = makeGlueAgent(G, { bot, fields: { world_memory: { worldDir: dir } } });
        agent._startAreaGuard();
        return { w, bot, agent };
    }
    const standing = (w, list) => list.filter(([x, y, z]) => w.get(x, y, z) === 'oak_fence').length;

    test('typed in the chat: the fences outside the areas are broken', LIMIT, async () => {
        const { w, agent } = scene();
        await agent.handleMessage('MartyByrde2', '!collectBlocks("oak_fence", 20)');
        await settle(agent);
        assert.equal(standing(w, OUTSIDE), 0, 'the fences outside the areas');
        assert.equal(standing(w, IN_PEN), IN_PEN.length, 'inside the pen even a typed command does not break');
    });

    test('the same command from the model: no fence is broken, a refusal goes back to the model', LIMIT, async () => {
        const { w, agent } = scene();
        agent.prompter.promptConvo = (() => { const r = ['!collectBlocks("oak_fence", 20)', '']; return async () => r.shift() ?? ''; })();
        await agent.handleMessage('MartyByrde2', 'we need fences, take them');
        await settle(agent);
        assert.equal(standing(w, OUTSIDE), OUTSIDE.length);
        assert.equal(standing(w, IN_PEN), IN_PEN.length);
        assert.ok(agent.turns.some(([n, t]) => n === 'system' && /I do not break/.test(t)), JSON.stringify(agent.turns));
    });

    test('the model and fences outside every area only: the refusal of the spec, with the command', LIMIT, async () => {
        const { w, agent } = scene();
        for (const [x, y, z] of IN_PEN) w.set(x, y, z, 'air');
        agent.prompter.promptConvo = (() => { const r = ['!collectBlocks("oak_fence", 20)', '']; return async () => r.shift() ?? ''; })();
        await agent.handleMessage('MartyByrde2', 'we need fences, take them');
        await settle(agent);
        assert.equal(standing(w, OUTSIDE), OUTSIDE.length);
        const text = 'oak_fence is a block that players build with. I do not break it. The player can type the command !collectBlocks("oak_fence", 20) in the chat to do it.';
        assert.ok(agent.turns.some(([n, t]) => n === 'system' && t.includes(text)), JSON.stringify(agent.turns));
    });

    test('protect_built_blocks with protected_areas off: the guard is installed too (store null)', LIMIT, async () => {
        const { w, agent } = scene({ protected_areas: false });
        agent.prompter.promptConvo = (() => { const r = ['!collectBlocks("oak_fence", 20)', '']; return async () => r.shift() ?? ''; })();
        await agent.handleMessage('MartyByrde2', 'take the fences');
        await settle(agent);
        assert.ok(agent.bot.areaGuard, 'bot.areaGuard exists');
        assert.equal(standing(w, OUTSIDE), OUTSIDE.length);
    });

    test('protect_built_blocks off: the model takes the fences outside the areas, as in v0.1.4.7', LIMIT, async () => {
        const { w, agent } = scene({ protect_built_blocks: false });
        agent.prompter.promptConvo = (() => { const r = ['!collectBlocks("oak_fence", 4)', '']; return async () => r.shift() ?? ''; })();
        await agent.handleMessage('MartyByrde2', 'take the fences');
        await settle(agent);
        assert.equal(standing(w, OUTSIDE), 0);
        assert.equal(standing(w, IN_PEN), IN_PEN.length, 'the area stays protected');
    });
});

// --------------------------------------------------------------------- the table of section 11

describe('item 10: the commands of the table', () => {
    const parse = (text) => G.index.parseCommandMessage(text);

    test('the parameters and their defaults', () => {
        assert.deepEqual(parse('!pickUpItems').args, ['', 16]);
        assert.deepEqual(parse('!pickUpItems("oak_fence")').args, ['oak_fence', 16]);
        assert.deepEqual(parse('!closeDoor').args, []);
        assert.deepEqual(parse('!chests').args, ['']);
        assert.deepEqual(parse('!chests("wheat")').args, ['wheat']);
        assert.deepEqual(parse('!mineOre("iron", 8)').args, ['iron', 8, false]);
        assert.deepEqual(parse('!mineOre("iron", 8, true)').args, ['iron', 8, true]);
        assert.equal(typeof parse('!chopTrees("", 8)'), 'object', 'both orders get through the parser');
        assert.equal(typeof parse('!chopTrees(8, "")'), 'object');
        assert.equal(typeof parse('!chopTrees("oak", 8)'), 'object');
        assert.deepEqual(parse('!givePlayer("steve", "bread", 3)').args, ['steve', 'bread', 3]);
    });

    test('!pickUpItems calls pickUpItems with the item and the range', LIMIT, async () => {
        const agent = makeGlueAgent(G);
        assert.match(await run(agent, '!pickUpItems', false), /I see no items on the ground within 16 blocks\./);
        assert.match(await run(agent, '!pickUpItems("oak_fence", 5)', false), /I see no oak_fence on the ground within 5 blocks\./);
    });

    test('!closeDoor: closeNear(6) of the door service of the agent; its text', LIMIT, async () => {
        set({ home_pack: true });
        const agent = makeGlueAgent(G);
        const ranges = [];
        agent.door_service = { tick() {}, stop() {}, async closeNear(range) { ranges.push(range); return { ok: true, reason: null, text: 'All doors near me are closed.' }; } };
        assert.equal(await run(agent, '!closeDoor', false), 'All doors near me are closed.');
        assert.deepEqual(ranges, [6]);
        assert.ok(agent.bot.modes.paused.includes('unstuck'), 'it pauses unstuck (handoff part C, item 4)');
    });

    test('!chests(item): chestsText of the storage pack with the item and the dimension', LIMIT, async () => {
        set({ storage_pack: true });
        const calls = [];
        const agent = makeGlueAgent(G, { fields: { work_packs: { storage: { chestsText: (...a) => { calls.push(a); return 'wheat: 28 in the chest at (11, 67, 53). Total 28.'; } } } } });
        assert.equal(await run(agent, '!chests("wheat")', false), 'wheat: 28 in the chest at (11, 67, 53). Total 28.');
        assert.equal(calls[0][1], 'wheat');
        assert.equal(calls[0][2], 'overworld');
        await run(agent, '!chests', false);
        assert.equal(calls[1][1], '');
    });

    test('!mineOre(ore, num, new_mine): new_mine false by default, true passed on as { newMine: true }', LIMIT, async () => {
        set({ mining_pack: true });
        const calls = [];
        const mining = { async mineOre(bot, ctx, ore, num, options) { calls.push([ore, num, options]); return { ok: false, reason: 'ask', text: 'I know no mine for iron.' }; } };
        const agent = makeGlueAgent(G, { fields: { work_packs: { mining } } });
        assert.equal(await run(agent, '!mineOre("iron", 8)', false), 'I know no mine for iron.');
        await run(agent, '!mineOre("iron", 8, true)', false);
        assert.deepEqual(calls, [['iron', 8, { newMine: false }], ['iron', 8, { newMine: true }]]);
    });

    test('!chopTrees("", 8), !chopTrees(8, "") and !chopTrees("oak", 8) reach the pack with 8 logs', LIMIT, async () => {
        set({ wood_pack: true });
        const calls = [];
        const wood = { async chopTrees(bot, ctx, num, kind) { calls.push([num, kind]); return { ok: true, reason: null, text: `I cut ${num}.` }; } };
        const agent = makeGlueAgent(G, { fields: { work_packs: { wood } } });
        await run(agent, '!chopTrees("", 8)', false);
        await run(agent, '!chopTrees(8, "")', false);
        await run(agent, '!chopTrees("oak", 8)', false);
        await run(agent, '!chopTrees', false);
        assert.deepEqual(calls, [[8, ''], [8, ''], [8, 'oak'], [8, '']]);
    });

    test('!givePlayer fetches the item from a known chest first when the bot does not carry it (storage_pack)', LIMIT, async () => {
        set({ storage_pack: true });
        const fetched = [];
        const storage = { bindStorage: () => ({ fetchItem: async (name, n) => { fetched.push([name, n]); return { ok: false, taken: 0, text: 'I know no chest with bread.' }; }, storeItems: async () => ({}) }) };
        const agent = makeGlueAgent(G, { fields: { work_packs: { storage } } });
        agent.bot.inventory.put('bread', 1);
        await run(agent, '!givePlayer("steve", "bread", 3)', false);
        assert.deepEqual(fetched, [['bread', 2]], 'only what it lacks');
        agent.bot.inventory.put('apple', 5);
        await run(agent, '!givePlayer("steve", "apple", 3)', false);
        assert.equal(fetched.length, 1, 'it carries enough apples');
    });

    test('!givePlayer without storage_pack: no fetch, as in v0.1.4.7', LIMIT, async () => {
        const fetched = [];
        const storage = { bindStorage: () => ({ fetchItem: async (...a) => { fetched.push(a); return {}; } }) };
        const agent = makeGlueAgent(G, { fields: { work_packs: { storage } } });
        await run(agent, '!givePlayer("steve", "bread", 3)', false);
        assert.deepEqual(fetched, []);
    });

    test('the commands of a switch that is off answer that it is off', LIMIT, async () => {
        const agent = makeGlueAgent(G, { fields: { area_store: null } });
        assert.equal(await run(agent, '!closeDoor', false), 'The home pack is off.');
        assert.equal(await run(agent, '!chests("wheat")', false), 'The storage pack is off.');
        assert.equal(await run(agent, '!mineOre("iron", 8)', false), 'The mining pack is off.');
        assert.equal(await run(agent, '!chopTrees(8)', false), 'The wood pack is off.');
        assert.equal(await run(agent, '!rememberArea("farm", "farm")', false), 'Protected areas are off.');
    });
});

describe('item 10: each command is only there while its pack or switch is on (the blocked commands of agent.js)', () => {
    // the statements `if (<test>) this.blocked_actions.push(...names)` of Agent.start
    let pushes;
    before(() => {
        pushes = blockedPushes();
    });
    const hiddenBy = (name) => pushes.filter((p) => p.names.includes(name)).map((p) => p.test);

    test('!closeDoor: hidden without home_pack', () => {
        assert.deepEqual(hiddenBy('!closeDoor'), ['!settings.home_pack']);
    });

    test('!chests: hidden without storage_pack', () => {
        assert.ok(hiddenBy('!chests').some((t) => t.includes('!settings.storage_pack')), JSON.stringify(hiddenBy('!chests')));
    });

    test('!mineOre: hidden without mining_pack', () => {
        assert.ok(hiddenBy('!mineOre').some((t) => t.includes('!settings.mining_pack')));
    });

    test('!chopTrees: hidden without wood_pack', () => {
        assert.ok(hiddenBy('!chopTrees').some((t) => t.includes('!settings.wood_pack')));
    });

    test('!rememberArea and !setArea: hidden without the protected areas', () => {
        assert.deepEqual(hiddenBy('!rememberArea'), ['!areas_on']);
        assert.deepEqual(hiddenBy('!setArea'), ['!areas_on']);
    });

    test('!pickUpItems and !givePlayer: always there', () => {
        assert.deepEqual(hiddenBy('!pickUpItems'), []);
        assert.deepEqual(hiddenBy('!givePlayer'), []);
    });
});

// ------------------------------------------------------------------------ the area commands

describe('item 10: !rememberArea with the five types, !setArea', () => {
    function areaScene(build, pos) {
        const w = createBlockWorld().flatGround(63);
        build(w);
        const bot = makeFakeBot({ world: w, pos });
        const store = new AS.AreaStore(path.join(dir, 'areas.json'));
        const agent = makeGlueAgent(G, { bot, fields: { area_store: store } });
        return { w, bot, store, agent };
    }
    const house = (w) => w.house({ x: 0, y: 63, z: 0, width: 7, depth: 7 });

    // v0.1.4.11 (P1): the answer names the kind; "building" is the default of the parser and counts as no type, so the
    // kind is concluded: a house with a roof, a door and a bed is a home
    for (const type of ['home', 'building']) {
        test(`${type}: the house the bot stands in`, LIMIT, async () => {
            const { store, agent } = areaScene(house, [3.5, 64, 3.5]);
            const r = await run(agent, `!rememberArea("my_${type}", "${type}")`, false);
            assert.equal(store.get(`my_${type}`)?.type, 'home', r);
            assert.match(r, /^I saved "my_\w+": a home, walled, .* I shelter there at night\.$/);
        });
    }

    test('farm: the fenced farm the bot stands in', LIMIT, async () => {
        const { store, agent } = areaScene((w) => w.field({ x: 0, y: 63, z: 0, width: 5, depth: 5 }), [2.5, 64, 2.5]);
        const r = await run(agent, '!rememberArea("farm", "farm")', false);
        assert.equal(store.get('farm')?.type, 'farm', r);
    });

    test('farm from outside the gate (P5): the ground behind the gate is saved, the text names the gate', LIMIT, async () => {
        const { store, agent } = areaScene((w) => w.field({ x: 0, y: 63, z: 0, width: 5, depth: 5 }), [2.5, 64, 7.5]);
        const r = await run(agent, '!rememberArea("farm", "farm")', false);
        assert.equal(store.get('farm')?.type, 'farm', r);
        assert.ok(r.startsWith('I stand outside the fence. The gate is at (2, 64, 5).'), r);
    });

    test('pen: fenced grass', LIMIT, async () => {
        const { store, agent } = areaScene((w) => w.field({ x: 0, y: 63, z: 0, width: 5, depth: 5, ground: 'grass_block', crop: null }), [2.5, 64, 2.5]);
        const r = await run(agent, '!rememberArea("pen", "pen")', false);
        assert.equal(store.get('pen')?.type, 'pen', r);
    });

    test('pen at a farm: refused with the text of the scan', LIMIT, async () => {
        const { store, agent } = areaScene((w) => w.field({ x: 0, y: 63, z: 0, width: 5, depth: 5 }), [2.5, 64, 2.5]);
        const r = await run(agent, '!rememberArea("pen", "pen")', false);
        assert.equal(store.get('pen'), undefined);
        assert.ok(r.length > 20, r);
    });

    test('mine: saved as type mine', LIMIT, async () => {
        const { store, agent } = areaScene(() => {}, [0.5, 40, 0.5]);
        const r = await run(agent, '!rememberArea("mine", "mine")', false);
        assert.equal(store.get('mine')?.type, 'mine', r);
    });

    test('an unknown type: the five types are named', LIMIT, async () => {
        const { agent } = areaScene(() => {}, [0.5, 64, 0.5]);
        assert.equal(await run(agent, '!rememberArea("x", "castle")', false), 'The type of an area is "home", "building", "farm", "pen" or "mine".');
    });

    test('!setArea from the model that shrinks an area is refused with the text of the spec; typed by the player it is saved', LIMIT, async () => {
        const { store, agent } = areaScene(() => {}, [0.5, 64, 0.5]);
        store.set({ name: 'cow_chicken_pen', type: 'pen', min: { x: -22, y: 62, z: 35 }, max: { x: 2, y: 74, z: 59 } });
        const r = await run(agent, '!setArea("cow_chicken_pen", "pen", -10, 62, 47, -8, 64, 49)', false);
        assert.equal(r, 'The new box is much smaller than the area "cow_chicken_pen" that I know. The player can type !setArea in the chat to do it.');
        assert.deepEqual(store.get('cow_chicken_pen').min, { x: -22, y: 62, z: 35 });
        await run(agent, '!setArea("cow_chicken_pen", "pen", -10, 62, 47, -8, 64, 49)', true);
        assert.deepEqual(store.get('cow_chicken_pen').min, { x: -10, y: 62, z: 47 });
    });

    test('!setArea from the model with a box of 1 x 3 x 1 is refused (P4)', LIMIT, async () => {
        const { store, agent } = areaScene(() => {}, [0.5, 64, 0.5]);
        const r = await run(agent, '!setArea("pen2", "pen", -10, 62, 47, -10, 64, 47)', false);
        assert.equal(store.get('pen2'), undefined);
        assert.match(r, /The player can type !setArea in the chat to do it\.$/);
    });
});

// ------------------------------------------------------------------------ handoff, part B

describe('handoff part B for part G: !inventory, !discard', () => {
    test('!inventory: one line for the off-hand after the list of items and before WEARING', LIMIT, async () => {
        const agent = makeGlueAgent(G);
        agent.bot.inventory.put('bread', 6, 45);
        agent.bot.inventory.put('dirt', 3, 9);
        const r = await run(agent, '!inventory', false);
        const at = r.indexOf('In the off-hand: bread 6');
        assert.ok(at > r.indexOf('dirt'), r);
        const wearing = r.indexOf('WEARING');
        assert.ok(wearing === -1 || at < wearing, r);
    });

    test('!inventory without an off-hand: no such line (v0.1.4.7)', LIMIT, async () => {
        const agent = makeGlueAgent(G);
        agent.bot.inventory.put('dirt', 3, 9);
        assert.ok(!(await run(agent, '!inventory', false)).includes('off-hand'));
    });

    test('!discard: the walk away ends after about 3 s and the item is tossed where the bot stands (S14)', LIMIT, async () => {
        const agent = makeGlueAgent(G);
        agent.bot.gotoImpl = () => new Promise(() => {});
        agent.bot.inventory.put('dirt', 5, 9);
        const t0 = Date.now();
        const r = await run(agent, '!discard("dirt", 5)', false);
        assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
        assert.match(r, /Discarded 5 dirt\./);
        await settle(agent);
    });
});

// ------------------------------------------------------------- the other items for part G

describe('section 11, item 2: a pack command pauses unstuck at its start', () => {
    test('runPack (!mineOre): unstuck is paused before the pack runs', LIMIT, async () => {
        set({ mining_pack: true });
        let pausedWhenRun = null;
        const agent = makeGlueAgent(G);
        agent.work_packs = { mining: { async mineOre() { pausedWhenRun = [...agent.bot.modes.paused]; return { ok: true, reason: null, text: 'done' }; } } };
        await run(agent, '!mineOre("iron", 8)', false);
        assert.ok(pausedWhenRun?.includes('unstuck'), JSON.stringify(pausedWhenRun));
    });

    test('a command of the home pack (!goToShelter): unstuck is paused', LIMIT, async () => {
        set({ home_pack: true });
        const agent = makeGlueAgent(G);
        agent.bot.time.timeOfDay = 13000;
        await run(agent, '!goToShelter', false);
        assert.ok(agent.bot.modes.paused.includes('unstuck'));
    });
});

describe('handoff part D for part G: the gates of a pen, the placed blocks, the world that changes', () => {
    test('!areas counts the gates of a pen', LIMIT, async () => {
        const store = new AS.AreaStore(path.join(dir, 'areas.json'));
        store.set({ name: 'pen', type: 'pen', min: { x: 0, y: 62, z: 0 }, max: { x: 6, y: 66, z: 6 }, entrances: [{ x: 3, y: 64, z: 6, kind: 'gate' }] });
        const agent = makeGlueAgent(G, { fields: { area_store: store } });
        const r = await run(agent, '!areas', false);
        assert.match(r, /- pen \(pen\): .*1 gate/);
    });

    test('the blocks the bot placed: one store per world in placed.json, written at the end', LIMIT, () => {
        set({ protect_built_blocks: true, world_memory: true });
        const agent = makeGlueAgent(G, { fields: { world_memory: { worldDir: dir } } });
        const placed = agent._placedStore();
        assert.ok(placed);
        placed.add({ x: 1, y: 64, z: 1 }, 'overworld');
        const exit = process.exit;
        process.exit = () => {};
        try {
            delete agent.cleanKill;
            agent.cleanKill('bye');
        } finally {
            process.exit = exit;
        }
        assert.ok(fs.existsSync(path.join(dir, 'placed.json')), 'written at the end');
    });

    test('another world: the door service of the old one stops', LIMIT, () => {
        const agent = makeGlueAgent(G, { fields: { world_memory: { worldDir: dir } } });
        agent._areaStore();
        let stopped = 0;
        agent.door_service = { tick() {}, stop() { stopped++; } };
        const other = makeTmpDir();
        try {
            agent.world_memory = { worldDir: other };
            agent._areaStore();
        } finally {
            removeTmpDir(other);
        }
        assert.equal(stopped, 1);
    });
});

describe('handoff part E for part G: the descriptions', () => {
    const describe_ = (name) => (G.actions.actionsList.find((c) => c.name === name) ?? G.queries.queryList.find((c) => c.name === name));

    test('!farmCycle: the whole round, with bone meal from the composter', () => {
        const d = describe_('!farmCycle').description;
        assert.match(d, /bone meal/i);
        assert.match(d, /composter/i);
    });

    test('!makeBoneMeal and !getTool: no shears', () => {
        for (const name of ['!makeBoneMeal', '!getTool']) {
            const cmd = describe_(name);
            const all = cmd.description + JSON.stringify(cmd.params ?? {});
            assert.ok(!/shears/i.test(all), name);
        }
    });

    test('!getTool: an empty material is the best up to stone, the known chests count', () => {
        const cmd = describe_('!getTool');
        const all = cmd.description + ' ' + cmd.params.material.description;
        assert.match(all, /up to stone/);
        assert.match(all, /chest/);
    });

    test('!mineOre: without a known mine the bot asks first', () => {
        assert.match(describe_('!mineOre').description, /ask/);
    });
});

describe('section 11, item 14: the routing list', () => {
    test('at least 20 sentences for the new commands and types (against v0.1.4.7, tag b4bf9b8)', (t) => {
        const now = JSON.parse(fs.readFileSync(repoPath('tests/routing/sentences.json'), 'utf8'));
        const git = spawnSync('git', ['show', 'b4bf9b8:tests/routing/sentences.json'], { cwd: repoPath(''), encoding: 'utf8', windowsHide: true });
        if (git.status !== 0) {
            t.skip('no git history of v0.1.4.7 here');
            return;
        }
        const before = new Set(JSON.parse(git.stdout).map((e) => e.say));
        const added = now.filter((e) => !before.has(e.say));
        const NEW = ['!pickUpItems', '!closeDoor', '!chests', '!mineOre', '!chopTrees', '!rememberArea', '!setArea', '!givePlayer', '!goToBed'];
        const forNew = added.filter((e) => e.expect.some((name) => NEW.includes(name)));
        assert.ok(forNew.length >= 20, `${forNew.length}: ${JSON.stringify(added.map((e) => e.say))}`);
        for (const name of ['!pickUpItems', '!closeDoor']) assert.ok(forNew.some((e) => e.expect.includes(name)), name);
        for (const type of ['mine', 'pen']) assert.ok(forNew.some((e) => e.expect.includes('!rememberArea') && e.say.includes(type)), type);
    });
});
