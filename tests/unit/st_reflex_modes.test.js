// T1, spec v0.1.4.8 section 5 (part A): the modes of src/agent/modes.js with the real ModeController,
// the real ActionManager and the real skills.js (moveAway, goToPlayer, pickupNearbyItems) on a fake bot
// whose path finder the test drives (tests/helpers/st_modes_env.js). Tested from the spec and the handoff:
//   A2 stuck_restart_after 1 behaves as v0.1.4.7 (only the time limit of 10 s ends the process), 3 gives up
//      twice and ends the process the third time, 0 never ends it; giving up stops the path search,
//      writes the line into the behaviour log (the automatic message tells the model) and pauses until
//      a new command starts or the bot moved 2 blocks; a success sets the count back to 0;
//   I1 noteProgress; A3 door_closing is a background mode; A7 night_shelter waits underground and does
//   nothing without a home; A8 item_collecting tries again; A9 starvation; A10 retreat at low health;
//   A11 the mode hunger (placed after self_defense, handoff), every 2 s, execute only for the walk;
//   the switches off (home_pack, home_reflexes.hunger, flee_below_health 0, stuck_restart_after 1).
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { loadModes, makeFakeBot, makeFakeAgent, freshPos, hang, noPath, itemEntity, mobEntity } from '../helpers/st_modes_env.js';

const M = await loadModes();
await import('ses'); // the global assert of the agent process, for resume actions

const BASE = { language: 'en', narrate_behavior: false };
const LIMIT = { timeout: 30000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realNow = Date.now;
let offset = 0;

let cap;
before(() => { Date.now = () => realNow() + offset; });
after(() => { Date.now = realNow; });
beforeEach(() => {
    cap = captureConsole();
    offset += 10 * 60 * 1000; // a new night for night_shelter, no cool-downs of the last test
});
afterEach(() => {
    cap.restore();
});

function setSettings(extra = {}) {
    M.settingsModule.setSettings({ ...BASE, home_pack: true, ...extra });
}

function modeNames(agent) {
    return agent.bot.modes.getMiniDocs().split('\n').slice(1).map((l) => l.replace(/^- /, '').replace(/\((ON|OFF)\)$/, ''));
}

// A command that writes output and runs at the same place until it is interrupted.
function command(agent, label = 'action:mineOre') {
    return agent.actions.runAction(label, async () => {
        agent.bot.output += 'I dug 2 blocks.\n';
        while (!agent.bot.interrupt_code) await sleep(10);
    });
}

// Waits until no action runs any more (a new action waits up to 300 ms for the one before).
async function settle(agent, ms = 15000) {
    await sleep(350);
    const end = realNow() + ms;
    while (agent.actions.executing && realNow() < end) await sleep(10);
    await sleep(50);
}

// A command at the same place for 21 s: the mode unstuck escapes. Returns the promise of the command.
async function getStuck(agent, label = 'action:mineOre') {
    const running = command(agent, label);
    await sleep(30);
    await agent.bot.modes.update(); // the stuck time starts
    offset += 21000;
    await agent.bot.modes.update();
    return running;
}

// ------------------------------------------------------------------------ the list of modes

describe('the switches of the home pack and the list of modes (A11, section 2)', () => {
    test('home_pack off: no home reflex, no mode hunger (v0.1.4.7)', LIMIT, () => {
        M.settingsModule.setSettings({ ...BASE, home_pack: false });
        const agent = makeFakeAgent(M, makeFakeBot({ pos: freshPos() }));
        const names = modeNames(agent);
        for (const name of ['hunger', 'creeper_safety', 'night_shelter', 'door_closing']) assert.ok(!names.includes(name), name);
    });

    test('home_reflexes.hunger false: the other home reflexes, no mode hunger', LIMIT, () => {
        setSettings({ home_reflexes: { hunger: false } });
        const agent = makeFakeAgent(M, makeFakeBot({ pos: freshPos() }));
        const names = modeNames(agent);
        assert.ok(!names.includes('hunger'));
        assert.ok(names.includes('night_shelter') && names.includes('door_closing'));
    });

    test('home_pack on, home_reflexes.hunger by default: the mode hunger, directly after self_defense (handoff)', LIMIT, () => {
        setSettings();
        const agent = makeFakeAgent(M, makeFakeBot({ pos: freshPos() }));
        const names = modeNames(agent);
        assert.equal(names[names.indexOf('self_defense') + 1], 'hunger');
        assert.ok(names.indexOf('hunger') > names.indexOf('self_preservation'));
        assert.equal(names.at(-1), 'door_closing');
        assert.match(agent.bot.modes.getDocs(), /- hunger\((ON|OFF)\): \S/);
    });
});

// ------------------------------------------------------------------------------------ I1, A1

describe('I1: noteProgress', () => {
    test('bot.modes.noteProgress(reason) exists; unstuck does not count the time before it', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = noPath;
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        const running = command(agent);
        await sleep(30);
        await bot.modes.update();
        offset += 15000;
        bot.modes.noteProgress('chest');
        await bot.modes.update();
        offset += 10000; // 25 s since the start, 10 s since the note
        await bot.modes.update();
        await sleep(50);
        assert.deepEqual(agent.labels, ['action:mineOre'], 'no escape');
        offset += 11000; // 21 s since the note
        await bot.modes.update();
        await running;
        await settle(agent);
        assert.ok(agent.labels.includes('mode:unstuck'), 'now it escapes');
    });
});

// ------------------------------------------------------------------------------------------ A2

describe('A2: stuck_restart_after 1 (the default) behaves as v0.1.4.7', () => {
    test('moveAway finds no way: no kill; the error goes to the action, no "I\'m free."', LIMIT, async () => {
        setSettings(); // stuck_restart_after not set: 1
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = noPath;
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.ok(agent.messages.length >= 1, 'the model is told');
        assert.ok(agent.messages[0].includes("I'm stuck!"));
        assert.ok(!agent.messages.some((m) => m.includes("I'm free.")));
    });

    test('moveAway returns: "I\'m free.", no kill', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = async () => {}; // returns without moving, as v0.1.4.7 did not look
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.match(agent.messages[0], /I'm stuck!\nI'm free\./);
    });

    test('moveAway hangs: the time limit of 10 s ends the process', { timeout: 40000 }, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = hang;
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        const t0 = realNow();
        await getStuck(agent);
        const end = realNow() + 15000;
        while (agent.kills.length === 0 && realNow() < end) await sleep(50);
        const took = realNow() - t0;
        assert.deepEqual(agent.kills, ["Got stuck and couldn't get unstuck"]);
        assert.ok(took >= 9500 && took < 13000, `${took} ms`);
        await settle(agent);
    });
});

describe('A2: stuck_restart_after 3 and 0', () => {
    test('3: the reflex gives up twice, the third failure in a row ends the process', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos(41) });
        bot.gotoImpl = noPath;
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        agent.bot.areaGuard = { areaAt: () => ({ name: 'mining_area', type: 'mine' }) };
        const p = bot.entity.position;
        const line = `I am stuck at (${Math.floor(p.x)}, 41, ${Math.floor(p.z)}) and could not walk away. I am in the area "mining_area" (mine).`;

        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, [], 'the first failure gives up');
        assert.ok(bot.pathfinder.goals.includes(null), 'the path search is stopped: setGoal(null)');
        assert.equal(agent.messages.length, 1, 'the existing automatic message');
        assert.ok(agent.messages[0].includes(`I'm stuck!\n${line}\n`), agent.messages[0]);

        await getStuck(agent); // a new command ends the pause
        await settle(agent);
        assert.deepEqual(agent.kills, [], 'the second failure gives up');
        assert.equal(agent.messages.length, 2);

        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, ["Got stuck and couldn't get unstuck"], 'the third ends the process');
    });

    test('3: after giving up the reflex pauses while the same command goes on at the same place', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos() });
        let escapes = 0;
        bot.gotoImpl = async (goal) => { if (goal?.constructor?.name === 'GoalInvert') escapes++; return noPath(); };
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.equal(escapes, 1);
        // the order goes on (a resume, no new command), at the same place, 3 times 21 s
        const again = agent.actions._executeAction('action:followPlayer', async () => { while (!bot.interrupt_code) await sleep(10); });
        await sleep(30);
        for (let i = 0; i < 3; i++) {
            await bot.modes.update();
            offset += 21000;
            await bot.modes.update();
        }
        await sleep(100);
        assert.equal(escapes, 1, 'paused');
        // the bot moved 2 blocks: watched again
        bot.entity.position = bot.entity.position.offset(3, 0, 0);
        await bot.modes.update();
        await bot.modes.update();
        offset += 21000;
        await bot.modes.update();
        await again;
        await settle(agent);
        assert.equal(escapes, 2, 'moved 2 blocks: watched again');
        assert.deepEqual(agent.kills, []);
    });

    test('3: a success says "I\'m free." and sets the count of failed escapes to 0', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos() });
        let free = false;
        bot.gotoImpl = async () => {
            if (!free) return noPath();
            bot.entity.position = bot.entity.position.offset(0, 0, 6);
        };
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        await getStuck(agent); // failure 1
        await settle(agent);
        await getStuck(agent); // failure 2
        await settle(agent);
        free = true;
        await getStuck(agent); // free: the row ends
        await settle(agent);
        assert.match(agent.messages.at(-1), /I'm stuck!\nI'm free\./);
        free = false;
        await getStuck(agent); // failure 1 of a new row
        await settle(agent);
        await getStuck(agent); // failure 2
        await settle(agent);
        assert.deepEqual(agent.kills, [], 'two failures in a row after the success');
    });

    test('0: never ends the process', LIMIT, async () => {
        setSettings({ stuck_restart_after: 0 });
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = noPath;
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        for (let i = 0; i < 4; i++) {
            await getStuck(agent);
            await settle(agent);
        }
        assert.deepEqual(agent.kills, []);
        assert.equal(agent.messages.length, 4);
        assert.ok(agent.messages.every((m) => m.includes('could not walk away')));
    });
});

// ------------------------------------------------------------------------------------------ A3

describe('A3: door_closing is a background mode', () => {
    test('updated on every tick while an action runs and while another mode is active; never an action of its own', LIMIT, async () => {
        setSettings({ stuck_restart_after: 3 });
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = hang;
        const agent = makeFakeAgent(M, bot, { on: ['unstuck', 'door_closing'] });
        let ticks = 0;
        agent.door_service = { tick() { ticks++; }, stop() {}, async closeNear() { return { text: '' }; } };
        const running = command(agent);
        await sleep(30);
        await bot.modes.update();
        await bot.modes.update();
        assert.equal(ticks, 2, 'while a command runs');
        offset += 21000;
        await bot.modes.update(); // unstuck starts its escape (it hangs)
        await sleep(400);
        assert.ok(agent.labels.includes('mode:unstuck'));
        const before = ticks;
        await bot.modes.update();
        await bot.modes.update();
        assert.equal(ticks, before + 2, 'while the mode unstuck is active');
        await agent.actions.stop('!stop');
        await running;
        await settle(agent);
        assert.ok(!agent.labels.includes('mode:door_closing'));
    });
});

// ------------------------------------------------------------------------------------------ A7

describe('A7: night_shelter', () => {
    const night = 12500;

    test('underground (agent.whereAmI): it waits and says nothing', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        const agent = makeFakeAgent(M, bot, { on: ['night_shelter'], homeContext: () => ({ areas: [], places: null, settings: M.settings, log() {} }) });
        agent.whereAmI = () => ({ area: null, depth: 26, underground: true });
        bot.time.timeOfDay = 1000;
        await bot.modes.update(); // a day: a new night follows
        bot.time.timeOfDay = night;
        await bot.modes.update();
        await sleep(30);
        assert.deepEqual(agent.labels, []);
        assert.equal(bot.modes.behavior_log, '');
    });

    test('in the shaft at y 41 without agent.whereAmI: the depth of ground_logic makes it wait', LIMIT, async () => {
        setSettings();
        const world = createBlockWorld().flatGround(66, 'grass_block', 'stone');
        const pos = freshPos(41);
        world.fill(Math.floor(pos[0]) - 1, 41, -1, Math.floor(pos[0]) + 1, 42, 1, 'air');
        const bot = makeFakeBot({ world, pos });
        const agent = makeFakeAgent(M, bot, { on: ['night_shelter'], homeContext: () => ({ areas: [], places: null, settings: M.settings, log() {} }) });
        bot.time.timeOfDay = 1000;
        await bot.modes.update();
        bot.time.timeOfDay = night;
        await bot.modes.update();
        await sleep(30);
        assert.deepEqual(agent.labels, []);
        assert.equal(bot.modes.behavior_log, '');
    });

    test('in a mine area on the surface: it waits (mining_pack off)', LIMIT, async () => {
        setSettings({ mining_pack: false });
        const bot = makeFakeBot({ pos: freshPos() });
        bot.areaGuard = { areaAt: () => ({ name: 'mining_area', type: 'mine' }) };
        const agent = makeFakeAgent(M, bot, { on: ['night_shelter'], homeContext: () => ({ areas: [], places: null, settings: M.settings, log() {} }) });
        bot.time.timeOfDay = 1000;
        await bot.modes.update();
        bot.time.timeOfDay = night;
        await bot.modes.update();
        await sleep(30);
        assert.deepEqual(agent.labels, []);
    });

    test('on the surface with no home: nothing happens, and once per night "I know no home. Tell me where home is."', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        const agent = makeFakeAgent(M, bot, { on: ['night_shelter'], homeContext: () => ({ areas: [], places: null, settings: M.settings, log() {} }) });
        agent.whereAmI = () => ({ area: null, depth: 0, underground: false });
        bot.time.timeOfDay = 1000;
        await bot.modes.update();
        bot.time.timeOfDay = night;
        await bot.modes.update();
        offset += 61000;
        await bot.modes.update();
        await sleep(30);
        assert.deepEqual(agent.labels, []);
        assert.equal(bot.modes.behavior_log, 'I know no home. Tell me where home is.\n');
    });

    test('on the surface with a home: it goes to the shelter', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        const home = { x: bot.entity.position.x + 20, y: 64, z: 0, dimension: 'overworld' };
        const agent = makeFakeAgent(M, bot, { on: ['night_shelter'],
            homeContext: () => ({ areas: [], places: { recall: (n) => (n === 'home' ? home : null) }, settings: M.settings, log() {}, now: () => Date.now() }) });
        agent.whereAmI = () => ({ area: null, depth: 0, underground: false });
        bot.time.timeOfDay = 1000;
        await bot.modes.update();
        bot.time.timeOfDay = night;
        await bot.modes.update();
        await sleep(100);
        assert.ok(agent.labels.includes('mode:night_shelter'));
        assert.ok(bot.modes.behavior_log.includes('It is getting dark. I go to the shelter.'));
        await agent.actions.stop('!stop');
        await settle(agent);
    });
});

// ------------------------------------------------------------------------------------------ A8

describe('A8: item_collecting', () => {
    test('a pick-up that gained nothing is tried again after 3 s, at most 3 times', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        const agent = makeFakeAgent(M, bot, { on: ['item_collecting'] });
        const item = itemEntity('oak_fence', [bot.entity.position.x + 2, 64, 0.5]);
        bot.entities[item.id] = item;
        const follows = () => bot.calls.filter((c) => c[0] === 'goto' && c[1] === 'GoalFollow').length;
        await bot.modes.update(); // noticed
        offset += 2100;
        await bot.modes.update(); // first try
        await settle(agent);
        assert.equal(follows(), 1);
        offset += 2000;
        await bot.modes.update();
        await settle(agent, 3000);
        assert.equal(follows(), 1, 'not again within 3 s');
        offset += 1100;
        await bot.modes.update();
        await settle(agent, 3000);
        assert.equal(follows(), 2, 'tried again 3 s later');
        for (let i = 0; i < 6; i++) {
            offset += 3100;
            await bot.modes.update();
            await settle(agent, 3000);
        }
        assert.equal(follows(), 4, 'the first try and 3 more');
    });

    test('an item that the bot itself dropped in the last 10 s is left', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        const agent = makeFakeAgent(M, bot, { on: ['item_collecting'] });
        const p = bot.entity.position;
        const item = itemEntity('dirt', [p.x, p.y + 1.32, p.z]);
        bot.entities[item.id] = item;
        bot.emit('entitySpawn', item); // thrown by the bot: it starts 0.3 below its eyes
        item.position = new Vec3(p.x + 1.5, p.y, p.z); // it lands
        await bot.modes.update();
        offset += 2100;
        await bot.modes.update();
        offset += 5000;
        await bot.modes.update();
        await settle(agent, 2000);
        assert.deepEqual(agent.labels, [], 'left');
        offset += 6000; // 13 s after the drop
        await bot.modes.update();
        offset += 2100;
        await bot.modes.update();
        await settle(agent);
        assert.deepEqual(agent.labels, ['mode:item_collecting'], 'after 10 s it is picked up');
    });
});

// ------------------------------------------------------------------------------------------ A9

describe('A9: self_preservation and hunger', () => {
    test('starving (food 0, nothing else hurts): no running away; "I am starving." into the behaviour log once per 60 s', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        const agent = makeFakeAgent(M, bot, { on: ['self_preservation'] });
        bot.food = 0;
        bot.health = 3;
        bot.lastDamageTime = Date.now();
        bot.lastDamageTaken = 1;
        await bot.modes.update();
        offset += 1000;
        bot.lastDamageTime = Date.now();
        await bot.modes.update();
        await sleep(30);
        assert.deepEqual(agent.labels, [], 'no moveAway');
        assert.equal(bot.modes.behavior_log.match(/I am starving\./g)?.length, 1);
        offset += 60000;
        bot.lastDamageTime = Date.now();
        await bot.modes.update();
        assert.equal(bot.modes.behavior_log.match(/I am starving\./g)?.length, 2);
    });

    test('low health with food: "I\'m dying!" and it runs away, as v0.1.4.7', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = async () => { bot.entity.position = bot.entity.position.offset(25, 0, 0); };
        const agent = makeFakeAgent(M, bot, { on: ['self_preservation'] });
        bot.food = 5;
        bot.health = 3;
        bot.lastDamageTime = Date.now();
        bot.lastDamageTaken = 1;
        await bot.modes.update();
        await settle(agent);
        assert.ok(agent.labels.includes('mode:self_preservation'));
        assert.ok(bot.modes.behavior_log.includes("I'm dying!"), bot.modes.behavior_log);
        assert.ok(!bot.modes.behavior_log.includes('I am starving.'));
    });

    test('food 0 with a hostile mob within 16 blocks: it runs away', LIMIT, async () => {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        bot.gotoImpl = async () => { bot.entity.position = bot.entity.position.offset(25, 0, 0); };
        const agent = makeFakeAgent(M, bot, { on: ['self_preservation'] });
        const zombie = mobEntity('zombie', [bot.entity.position.x + 10, 64, 0.5]);
        bot.entities[zombie.id] = zombie;
        bot.food = 0;
        bot.health = 3;
        bot.lastDamageTime = Date.now();
        bot.lastDamageTaken = 1;
        await bot.modes.update();
        await settle(agent);
        assert.ok(agent.labels.includes('mode:self_preservation'));
    });
});

// ----------------------------------------------------------------------------------------- A10

describe('A10: retreat at low health', () => {
    function scene(settingsExtra, { player = true } = {}) {
        setSettings(settingsExtra);
        const bot = makeFakeBot({ pos: freshPos() });
        const agent = makeFakeAgent(M, bot, { on: ['self_defense'] });
        const zombie = mobEntity('zombie', [bot.entity.position.x + 5, 64, 0.5]);
        bot.entities[zombie.id] = zombie;
        bot.pvp.attack = (e) => { bot.calls.push(['attack', e.name]); delete bot.entities[e.id]; };
        if (player) {
            const steve = { id: 77, name: 'player', type: 'player', username: 'steve', position: new Vec3(bot.entity.position.x - 20, 64, 0.5), height: 1.8, metadata: {} };
            bot.entities[steve.id] = steve;
            bot.players.steve = { username: 'steve', entity: steve };
        }
        bot.health = 6;
        return { bot, agent };
    }

    test('flee_below_health 10, health 6: no attack; one line in the behaviour log; it goes to the nearest player within 32', LIMIT, async () => {
        const { bot, agent } = scene({ flee_below_health: 10 });
        await bot.modes.update();
        await settle(agent);
        assert.ok(!bot.calls.some((c) => c[0] === 'attack'), 'no attack');
        assert.equal(bot.modes.behavior_log.match(/I am hurt \(health 6 of 20\)\. I retreat\./g)?.length ?? 0, 1, bot.modes.behavior_log);
        assert.ok(bot.calls.some((c) => c[0] === 'goto' && c[1] === 'GoalFollow'), 'to the player');
    });

    test('no player within 32 and no shelter: moveAway', LIMIT, async () => {
        const { bot, agent } = scene({ flee_below_health: 10 }, { player: false });
        bot.gotoImpl = async () => { bot.entity.position = bot.entity.position.offset(12, 0, 0); };
        await bot.modes.update();
        await settle(agent);
        assert.ok(!bot.calls.some((c) => c[0] === 'attack'));
        assert.ok(bot.calls.some((c) => c[0] === 'goto' && c[1] === 'GoalInvert'), 'away');
    });

    test('no player within 32, a home known: into the shelter of the home pack, not away', LIMIT, async () => {
        setSettings({ flee_below_health: 10 });
        const bot = makeFakeBot({ pos: freshPos() });
        const homePlace = { x: bot.entity.position.x + 20, y: 64, z: 0.5, dimension: 'overworld' };
        const agent = makeFakeAgent(M, bot, { on: ['self_defense'],
            homeContext: () => ({ areas: [], places: { recall: (n) => (n === 'home' ? homePlace : null) }, settings: M.settings, log() {}, now: () => Date.now() }) });
        const zombie = mobEntity('zombie', [bot.entity.position.x + 5, 64, 0.5]);
        bot.entities[zombie.id] = zombie;
        bot.pvp.attack = (e) => { bot.calls.push(['attack', e.name]); delete bot.entities[e.id]; };
        bot.health = 6;
        bot.gotoImpl = async (goal) => { if (Number.isFinite(goal?.x)) bot.entity.position = new Vec3(goal.x + 0.5, 64, goal.z + 0.5); };
        await bot.modes.update();
        await settle(agent);
        assert.ok(!bot.calls.some((c) => c[0] === 'attack'));
        assert.ok(bot.calls.some((c) => c[0] === 'goto' && c[1] === 'GoalNear'), 'to the place home');
        assert.ok(!bot.calls.some((c) => c[0] === 'goto' && c[1] === 'GoalInvert'), 'not away');
    });

    test('flee_below_health 0 (the default): it fights, as v0.1.4.7', LIMIT, async () => {
        const { bot, agent } = scene({});
        await bot.modes.update();
        await settle(agent);
        assert.ok(bot.calls.some((c) => c[0] === 'attack'));
        assert.ok(!bot.modes.behavior_log.includes('I retreat.'));
    });

    test('health at the setting or above: it fights', LIMIT, async () => {
        const { bot, agent } = scene({ flee_below_health: 6 });
        await bot.modes.update();
        await settle(agent);
        assert.ok(bot.calls.some((c) => c[0] === 'attack'));
    });
});

// ----------------------------------------------------------------------------------------- A11

describe('A11: the mode hunger', () => {
    function hungerScene({ food = 6, chests = [], fetch = null } = {}) {
        setSettings();
        const bot = makeFakeBot({ pos: freshPos() });
        const said = [];
        let lists = 0;
        const ctx = {
            settings: M.settings,
            chests: { list() { lists++; return chests; } },
            storage: { fetchItem: fetch ?? (async () => ({ ok: false, taken: 0, reason: 'not_found', text: 'I know no chest with bread.' })) },
            say: (t) => said.push(t),
            log() {},
            now: () => Date.now(),
        };
        const agent = makeFakeAgent(M, bot, { on: ['hunger'], packContext: () => ctx });
        bot.food = food;
        return { bot, agent, said, steps: () => lists };
    }

    test('hungerStep every 2 s', LIMIT, async () => {
        const { bot, steps } = hungerScene();
        await bot.modes.update();
        await sleep(20);
        assert.equal(steps(), 1);
        offset += 1000;
        await bot.modes.update();
        await sleep(20);
        assert.equal(steps(), 1, '1 s later: no step');
        offset += 1000;
        await bot.modes.update();
        await sleep(20);
        assert.equal(steps(), 2, '2 s later');
    });

    test('the text goes out without an action: "I am hungry and carry no food. Food 6 of 20."', LIMIT, async () => {
        const { bot, agent, said } = hungerScene();
        await bot.modes.update();
        await sleep(20);
        assert.deepEqual(said, ['I am hungry and carry no food. Food 6 of 20.']);
        assert.deepEqual(agent.labels, []);
    });

    test('eating runs beside a running command: the command is not interrupted', LIMIT, async () => {
        const { bot, agent } = hungerScene({ food: 10 });
        bot.inventory.put('bread', 4);
        const running = command(agent, 'action:storeItems');
        await sleep(30);
        await bot.modes.update();
        const end = realNow() + 3000;
        while (bot.food < 18 && realNow() < end) await sleep(20);
        assert.ok(bot.calls.some((c) => c[0] === 'consume' && c[1] === 'bread'), 'it ate');
        assert.ok(bot.food >= 18);
        assert.deepEqual(agent.labels, ['action:storeItems'], 'no mode action');
        assert.equal(agent.actions.executing, true, 'the command still runs');
        await agent.actions.stop('!stop');
        await running;
    });

    test('C2 row 4: food 3, a command of the model runs, bread known: the reflex fetches, also when busy', LIMIT, async () => {
        const chest = { x: 0, y: 64, z: 5, dimension: 'overworld', items: { bread: 5 } };
        let fetched = 0;
        const scene = hungerScene({ food: 3, chests: [chest], fetch: async (name, n) => {
            fetched++;
            scene.bot.inventory.put(name, 5);
            return { ok: true, taken: 5, reason: null, text: '' };
        } });
        chest.x = Math.floor(scene.bot.entity.position.x) + 3;
        const running = command(scene.agent, 'action:collectBlocks');
        await sleep(30);
        await scene.bot.modes.update();
        await running;
        await settle(scene.agent);
        assert.ok(scene.agent.labels.includes('mode:hunger'));
        assert.equal(fetched, 1);
    });

    test('C2 row 4: food 3 while an order of the player runs: no fetch, the text instead', LIMIT, async () => {
        const chest = { x: 0, y: 64, z: 5, dimension: 'overworld', items: { bread: 5 } };
        let fetched = 0;
        const scene = hungerScene({ food: 3, chests: [chest], fetch: async () => { fetched++; return { ok: false, taken: 0 }; } });
        scene.agent.last_order = { by: 'MartyByrde2', command: '!collectBlocks', time: Date.now() };
        const running = command(scene.agent, 'action:collectBlocks');
        await sleep(30);
        await scene.bot.modes.update();
        await sleep(50);
        assert.equal(fetched, 0);
        assert.ok(!scene.agent.labels.includes('mode:hunger'));
        assert.deepEqual(scene.said, ['I am hungry and carry no food. Food 3 of 20.']);
        await scene.agent.actions.stop('!stop');
        await running;
    });

    test('the walk to a chest runs as a mode action (execute), then it eats', LIMIT, async () => {
        const chest = { x: 0, y: 64, z: 5, dimension: 'overworld', items: { bread: 5 } };
        let fetched = null;
        const scene = hungerScene({ food: 6, chests: [chest], fetch: async (name, n) => {
            fetched = [name, n];
            scene.bot.inventory.put(name, Math.min(n, 5));
            return { ok: true, taken: Math.min(n, 5), reason: null, text: `I took ${Math.min(n, 5)} ${name} from the chest at (0, 64, 5).` };
        } });
        chest.x = Math.floor(scene.bot.entity.position.x) + 3;
        await scene.bot.modes.update();
        await settle(scene.agent);
        assert.deepEqual(scene.agent.labels, ['mode:hunger']);
        assert.equal(fetched?.[0], 'bread');
        assert.ok(scene.bot.calls.some((c) => c[0] === 'consume'), 'it ate after the fetch');
        assert.deepEqual(scene.said, [], 'no text to the chat');
    });
});
