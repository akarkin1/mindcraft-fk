// Spec v0.1.4.8, part A: the modes of src/agent/modes.js with the real ModeController and the real
// ActionManager of a fake agent.
//   - I1: noteProgress; A1: the progress signals as the mode unstuck sees them;
//   - A2: a failed escape gives up (stuck_restart_after > 1) or ends the process (1, the default);
//     the line of the behaviour log reaches the model through the automatic message; the pause ends with
//     a new command or 2 blocks away; !stop during the escape is no failure;
//   - A3: door_closing is a background mode and ticks the door service;
//   - A8: item_collecting tries again after 3 s, at most 3 times, and leaves what the bot threw;
//   - A9: self_preservation does not run from hunger; A10: self_defense retreats at low health;
//   - A11: the mode hunger calls hungerStep every 2 s and walks only through state.walk;
//   - A7: night_shelter without a home, and agent.whereAmI.
//
// Seams: a module hook (node:module register) gives modes.js, and only modes.js, fakes of three modules:
// the home pack, skills.js and world.js. Each fake re-exports the real module and replaces a few
// functions by the ones in globalThis.__staFakes (else the real ones; world.isClearPath is true). So the
// tests do not depend on the work of parts B and C in those files.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { repoUrl } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

// ---------------------------------------------------------------- the fakes for modes.js

function fakeSource(rel, key, names, fallback) {
    const real = JSON.stringify(repoUrl(rel));
    let src = `import * as real from ${real};\nexport * from ${real};\nconst h = () => globalThis.__staFakes?.${key} ?? {};\n`;
    for (const name of names)
        src += `export function ${name}(...a) { const f = h().${name}; return f ? f(...a) : ${fallback(name)}; }\n`;
    return 'data:text/javascript,' + encodeURIComponent(src);
}
const FAKES = {
    './packs/home/index.js': fakeSource('src/agent/packs/home/index.js', 'home', ['hungerStep', 'createDoorService', 'findShelter', 'goToShelter'],
        (name) => (['findShelter', 'goToShelter'].includes(name) ? `real.${name}(...a)` : 'undefined')),
    './library/skills.js': fakeSource('src/agent/library/skills.js', 'skills', ['moveAway', 'pickupNearbyItems', 'goToPlayer', 'defendSelf'],
        (name) => `real.${name}(...a)`),
    './library/world.js': fakeSource('src/agent/library/world.js', 'world', ['isClearPath'], () => 'Promise.resolve(true)'),
};
const HOOK = `const FAKES = ${JSON.stringify(FAKES)};
export async function resolve(specifier, context, next) {
    const parent = (context.parentURL ?? '').replace(/\\\\/g, '/');
    if (parent.endsWith('/src/agent/modes.js') && FAKES[specifier])
        return { url: FAKES[specifier], shortCircuit: true };
    return next(specifier, context);
}`;
register('data:text/javascript,' + encodeURIComponent(HOOK), import.meta.url);

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const modes = await loadSrc('src/agent/modes.js');
        const am = await loadSrc('src/agent/action_manager.js');
        return { settingsModule, modes, am };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

await import('ses'); // the global assert of the real agent process, for resume actions
const M = await importQuietly();
const settings = M.settingsModule.default;
const BASE_SETTINGS = { language: 'en', home_pack: true, narrate_behavior: false };
M.settingsModule.setSettings({ ...BASE_SETTINGS }); // home_pack on before the first initModes: the home modes exist
const REGISTRY = minecraftData('1.21.8');

// ---------------------------------------------------------------- the fake agent

const LIMIT = { timeout: 30000 }; // a test that waits in vain fails instead of holding the run
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realNow = Date.now;
let offset = 0; // Date.now runs on, with jumps of the tests
const PLACES = { recall: (name) => (name === 'home' ? { x: 0, y: 64, z: 0, dimension: 'overworld' } : null) };

const OFF = { self_preservation: false, hunger: false, creeper_safety: false, night_shelter: false, unstuck: false, cowardice: false,
    self_defense: false, hunting: false, item_collecting: false, torch_placing: false, elbow_room: false, idle_staring: false,
    cheat: false, door_closing: false };

let base = 0; // the mode objects are shared by the agents of this process: each agent stands elsewhere
function makeAgent({ on = [], blockName = () => 'air', places = PLACES } = {}) {
    base += 1000;
    const listeners = {};
    const bot = {
        username: 'andy',
        registry: REGISTRY,
        entity: { position: new Vec3(base + 0.5, 64, 0.5), height: 1.8, metadata: {} },
        entities: {},
        players: {},
        game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 },
        time: { timeOfDay: 1000 },
        health: 20,
        food: 20,
        lastDamageTime: 0,
        lastDamageTaken: 0,
        output: '',
        interrupt_code: false,
        targetDigBlock: null,
        currentWindow: null,
        isSleeping: false,
        usingHeldItem: false,
        inventory: {
            slots: new Array(46).fill(null),
            items: () => bot.inventory.slots.filter(Boolean),
            findInventoryItem: () => null,
            emptySlotCount: () => 30,
        },
        blockAt: (p) => ({ name: blockName(p), position: p }),
        nearestEntity(filter) {
            let best = null;
            let bestDistance = Infinity;
            for (const entity of Object.values(bot.entities)) {
                const d = entity.position.distanceTo(bot.entity.position);
                if (filter(entity) && d < bestDistance) {
                    best = entity;
                    bestDistance = d;
                }
            }
            return best;
        },
        goals: [],
        pathfinder: { goal: null, setGoal(goal) { bot.goals.push(goal); }, stop() {} },
        on(event, fn) { (listeners[event] ??= []).push(fn); },
        emit(event, ...args) { for (const fn of listeners[event] ?? []) fn(...args); },
        chat() {},
        clearControlStates() {},
        setControlState() {},
    };
    const agent = {
        name: 'andy',
        bot,
        shut_up: true,
        last_order: null,
        last_sender: null,
        kills: [],
        messages: [],
        cleanKill(msg) { agent.kills.push(msg); },
        requestInterrupt() { bot.interrupt_code = true; },
        clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
        isIdle: () => !agent.actions.executing,
        openChat() {},
        handleMessage(role, message) { agent.messages.push(message); },
        self_prompter: { isActive: () => false, stopLoop() {} },
        history: { add() {} },
        prompter: { getInitModes: () => ({ ...OFF, ...Object.fromEntries(on.map((name) => [name, true])) }) },
        homeContext: () => ({ areas: null, places, settings, log() {}, now: () => Date.now(), skills: {}, world: {} }),
    };
    agent.actions = new M.am.ActionManager(agent);
    M.modes.initModes(agent);
    return agent;
}

// A command that runs until it is interrupted, at the same place.
function command(agent, label = 'action:mineOre') {
    return agent.actions.runAction(label, async () => {
        agent.bot.output += 'I dug 2 blocks.\n';
        while (!agent.bot.interrupt_code) await sleep(10);
    });
}

// Waits until no action runs (a mode action ended), then a little for execute to finish. A new action
// waits up to 300 ms in ActionManager.stop() for the one before, so the first look comes after 350 ms.
async function settle(agent, ms = 5000) {
    await sleep(350);
    const end = realNow() + ms;
    while (agent.actions.executing && realNow() < end) await sleep(10);
    await sleep(30);
}

let cap;
let fakes;
before(() => {
    Date.now = () => realNow() + offset;
});
after(() => {
    Date.now = realNow;
});
beforeEach(() => {
    cap = captureConsole();
    M.settingsModule.setSettings({ ...BASE_SETTINGS });
    fakes = { home: {}, skills: {}, world: {} };
    globalThis.__staFakes = fakes;
    offset += 10 * 60 * 1000;
});
afterEach(() => {
    cap.restore();
    delete globalThis.__staFakes;
});

// ---------------------------------------------------------------- tests

describe('the list of modes (A11)', () => {
    test('hunger directly after self_defense (decision of the tech lead), door_closing at the end', LIMIT, () => {
        const agent = makeAgent();
        const names = agent.bot.modes.getMiniDocs().split('\n').slice(1).map((l) => l.replace(/^- /, '').replace(/\((ON|OFF)\)$/, ''));
        assert.deepEqual(names.slice(0, 7), ['self_preservation', 'creeper_safety', 'night_shelter', 'unstuck', 'cowardice', 'self_defense', 'hunger']);
        assert.equal(names[names.length - 1], 'door_closing');
    });
});

describe('noteProgress (I1)', () => {
    test('sets the time and the reason of the last progress', LIMIT, () => {
        const agent = makeAgent();
        assert.equal(agent.bot.modes.progress_at, 0);
        agent.bot.modes.noteProgress('chest');
        assert.ok(Math.abs(agent.bot.modes.progress_at - Date.now()) < 50);
        assert.equal(agent.bot.modes.progress_reason, 'chest');
        agent.bot.modes.noteProgress();
        assert.equal(agent.bot.modes.progress_reason, '');
    });
});

describe('unstuck: what counts as stuck (A1)', () => {
    async function watch(agent, between) {
        const running = command(agent);
        await sleep(30);
        await agent.bot.modes.update(); // the stuck time starts
        await between(agent);
        return { running }; // not the promise itself: an async function would wait for it
    }

    test('21 s at the same place while a command runs: stuck', LIMIT, async () => {
        const moves = [];
        fakes.skills.moveAway = async (bot) => { moves.push(bot); bot.entity.position = bot.entity.position.offset(5, 0, 0); return true; };
        const agent = makeAgent({ on: ['unstuck'] });
        const { running } = await watch(agent, async () => { offset += 21000; await agent.bot.modes.update(); });
        await running;
        await settle(agent);
        assert.equal(moves.length, 1);
    });

    test('an open window, a note of progress: not stuck', LIMIT, async () => {
        const moves = [];
        fakes.skills.moveAway = async () => { moves.push(1); return true; };
        const agent = makeAgent({ on: ['unstuck'] });
        const { running } = await watch(agent, async () => {
            offset += 15000;
            agent.bot.modes.noteProgress('chest');
            await agent.bot.modes.update();
            offset += 10000; // 25 s since the start, 10 s since the note
            await agent.bot.modes.update();
            agent.bot.currentWindow = { type: 'minecraft:generic_9x3' };
            offset += 30000;
            await agent.bot.modes.update();
            agent.bot.currentWindow = null;
            offset += 10000;
            await agent.bot.modes.update();
        });
        assert.equal(moves.length, 0);
        await agent.actions.stop('!stop');
        await running;
    });

    test('the inventory changes, the bot sleeps or uses an item: not stuck', LIMIT, async () => {
        const moves = [];
        fakes.skills.moveAway = async () => { moves.push(1); return true; };
        const agent = makeAgent({ on: ['unstuck'] });
        const { running } = await watch(agent, async () => {
            offset += 15000;
            agent.bot.inventory.slots[36] = { name: 'bread', count: 3 };
            await agent.bot.modes.update();
            offset += 15000;
            agent.bot.isSleeping = true;
            await agent.bot.modes.update();
            offset += 15000;
            agent.bot.isSleeping = false;
            agent.bot.usingHeldItem = true;
            await agent.bot.modes.update();
        });
        assert.equal(moves.length, 0);
        await agent.actions.stop('!stop');
        await running;
    });
});

describe('unstuck: the escape (A2)', () => {
    // stuck while a command runs: returns the command's promise (it ends when the mode interrupts it)
    async function getStuck(agent, label) {
        const running = command(agent, label);
        await sleep(30);
        await agent.bot.modes.update();
        offset += 21000;
        await agent.bot.modes.update();
        return running;
    }

    test('free: "I\'m free.", no kill, the command reports who stopped it', LIMIT, async () => {
        fakes.skills.moveAway = async (bot, distance) => {
            assert.equal(distance, 5);
            bot.entity.position = bot.entity.position.offset(0, 0, 6);
            return true;
        };
        const agent = makeAgent({ on: ['unstuck'] });
        const result = await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.equal(result.stopped_by, 'the reflex unstuck');
        assert.equal(result.message, 'Action output:\nI dug 2 blocks.\n');
        assert.match(agent.messages[0], /I'm stuck!\nI'm free\./);
    });

    // Decision of the tech lead: with stuck_restart_after 1 (the default) the escape is judged as in v0.1.4.7.
    test('stuck_restart_after 1: moveAway returns without moving 2 blocks: "I\'m free." as in v0.1.4.7, no kill', LIMIT, async () => {
        fakes.skills.moveAway = async () => true; // returns, but the bot did not move
        const agent = makeAgent({ on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.match(agent.messages[0], /I'm stuck!\nI'm free\.\n/);
        assert.ok(!agent.messages[0].includes('could not walk away'));
    });

    test('stuck_restart_after 1: an error of moveAway is passed on to the action manager as in v0.1.4.7, no kill', LIMIT, async () => {
        fakes.skills.moveAway = async () => { throw new Error('No path to the goal!'); };
        const agent = makeAgent({ on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        const finished = cap.allText().split('\n').find((l) => l.startsWith('Mode unstuck finished executing'));
        assert.ok(cap.allText().includes('!!Code threw exception!!\nError: Error: No path to the goal!'), cap.allText().slice(-1500));
        assert.ok(finished, 'the mode action ended');
        assert.ok(!agent.messages.some((m) => m.includes("I'm free.")));
    });

    test('stuck_restart_after 3: moveAway returns without moving 2 blocks: a failure, never "I\'m free."; later free', LIMIT, async () => {
        M.settingsModule.setSettings({ ...BASE_SETTINGS, stuck_restart_after: 3 });
        let move = 0;
        fakes.skills.moveAway = async (bot) => {
            bot.entity.position = bot.entity.position.offset(move, 0, 0);
            return true;
        };
        const agent = makeAgent({ on: ['unstuck'] });
        await getStuck(agent); // waits 1 s for the move of a teleport
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.match(agent.messages[0], /I'm stuck!\nI am stuck at \(\d+, 64, 0\) and could not walk away\.\n/);
        assert.ok(!agent.messages[0].includes("I'm free."));
        move = 6;
        await getStuck(agent); // a new command ends the pause
        await settle(agent);
        assert.match(agent.messages[1], /I'm stuck!\nI'm free\.\n/);
    });

    test('stuck_restart_after 2: an error of moveAway is a failure, also when the bot moved', LIMIT, async () => {
        M.settingsModule.setSettings({ ...BASE_SETTINGS, stuck_restart_after: 2 });
        fakes.skills.moveAway = async (bot) => {
            bot.entity.position = bot.entity.position.offset(5, 0, 0);
            throw new Error('GoalChanged');
        };
        const agent = makeAgent({ on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.match(agent.messages[0], /could not walk away/);
        assert.ok(!agent.messages[0].includes("I'm free."));
    });

    test('stuck_restart_after 3: the reflex gives up, stops the path search and tells the model where the bot is', LIMIT, async () => {
        M.settingsModule.setSettings({ ...BASE_SETTINGS, stuck_restart_after: 3 });
        const calls = [];
        fakes.skills.moveAway = async () => { calls.push(Date.now()); throw new Error('No path to the goal!'); };
        const agent = makeAgent({ on: ['unstuck'], blockName: (p) => (p.x === base + 1 && p.y === 66 && p.z === 0 ? 'oak_trapdoor' : 'stone') });
        agent.bot.areaGuard = { areaAt: () => ({ name: 'mining_area', type: 'mine' }) };
        await getStuck(agent);
        await settle(agent);
        assert.deepEqual(agent.kills, []);
        assert.equal(calls.length, 1);
        assert.ok(agent.bot.goals.includes(null), 'setGoal(null)');
        const line = `I am stuck at (${base}, 64, 0) and could not walk away. I am in the area "mining_area" (mine). A oak_trapdoor is at (${base + 1}, 66, 0).`;
        assert.equal(agent.messages.length, 1, 'the automatic message of execute');
        assert.ok(agent.messages[0].includes(`I'm stuck!\n${line}\n`), agent.messages[0]);
        assert.ok(agent.messages[0].includes("Your previous action 'action:mineOre' was interrupted by unstuck."));
        assert.ok(!agent.messages[0].includes("I'm free."));

        // paused: the next command at the same place is not watched until it is a new one
        const again = command(agent, 'action:mineOre'); // a new command: the pause ends
        await sleep(30);
        await agent.bot.modes.update();
        offset += 21000;
        await agent.bot.modes.update();
        await again;
        await settle(agent);
        assert.equal(calls.length, 2, 'a new command: watched again');
        assert.deepEqual(agent.kills, []);

        // without a new command, 21 s more at the same place: nothing
        agent.bot.interrupt_code = false;
        const resume = agent.actions._executeAction('action:followPlayer', async () => { while (!agent.bot.interrupt_code) await sleep(10); }); // no new command (a resume)
        await sleep(30);
        await agent.bot.modes.update();
        offset += 21000;
        await agent.bot.modes.update();
        await sleep(50);
        assert.equal(calls.length, 2, 'still paused');
        await agent.actions.stop('!stop');
        await resume;

        // the third failure in a row ends the process
        const third = command(agent);
        await sleep(30);
        await agent.bot.modes.update();
        offset += 21000;
        await agent.bot.modes.update();
        await third;
        await settle(agent);
        assert.equal(calls.length, 3);
        assert.deepEqual(agent.kills, ["Got stuck and couldn't get unstuck"]);
    });

    test('stuck_restart_after 0: never ends the process', LIMIT, async () => {
        M.settingsModule.setSettings({ ...BASE_SETTINGS, stuck_restart_after: 0 });
        fakes.skills.moveAway = async () => { throw new Error('No path to the goal!'); };
        const agent = makeAgent({ on: ['unstuck'] });
        for (let i = 0; i < 3; i++) {
            await getStuck(agent);
            await settle(agent);
        }
        assert.deepEqual(agent.kills, []);
        assert.equal(agent.messages.length, 3);
    });

    test('2 blocks away from where it gave up: watched again, and the row of failures starts again', LIMIT, async () => {
        M.settingsModule.setSettings({ ...BASE_SETTINGS, stuck_restart_after: 2 });
        let fail = true;
        fakes.skills.moveAway = async (bot) => {
            if (fail) throw new Error('No path to the goal!');
            bot.entity.position = bot.entity.position.offset(6, 0, 0);
            return true;
        };
        const agent = makeAgent({ on: ['unstuck'] });
        await getStuck(agent);
        await settle(agent);
        assert.equal(agent.messages.length, 1);
        // the player helps: the bot is 3 blocks away now; a resume (no new command) runs
        agent.bot.entity.position = agent.bot.entity.position.offset(3, 0, 0);
        const resume = agent.actions._executeAction('action:followPlayer', async () => { while (!agent.bot.interrupt_code) await sleep(10); });
        await sleep(30);
        await agent.bot.modes.update(); // the pause ends
        await agent.bot.modes.update(); // the stuck time starts
        offset += 21000;
        await agent.bot.modes.update();
        await resume;
        await settle(agent);
        assert.deepEqual(agent.kills, [], 'the count started again: 1 of 2');
        assert.equal(agent.messages.length, 2);
    });

    for (const value of [1, 3]) {
        test(`!stop during the escape (stuck_restart_after ${value}): it ends within a second, no failure, no kill, no "I'm free."`, LIMIT, async () => {
            M.settingsModule.setSettings({ ...BASE_SETTINGS, stuck_restart_after: value });
            let started = false;
            fakes.skills.moveAway = () => { started = true; return new Promise(() => {}); }; // the path search hangs
            const agent = makeAgent({ on: ['unstuck'] });
            await getStuck(agent);
            for (let i = 0; i < 100 && !started; i++) await sleep(10);
            assert.ok(started);
            const t0 = realNow();
            await agent.actions.stop('!stop');
            const took = realNow() - t0;
            assert.ok(took < 1000, `${took} ms`);
            await settle(agent);
            assert.deepEqual(agent.kills, []);
            assert.ok(agent.bot.goals.includes(null), 'the path search is stopped hard');
            assert.ok(!agent.bot.modes.behavior_log.includes("I'm free."));
            assert.ok(!agent.messages.some((m) => m.includes("I'm free.") || m.includes('could not walk away')));
        });
    }
});

describe('unstuck: the time of the escape is over (A2, fake timers)', () => {
    // The escape hangs; setTimeout and clearTimeout are fakes; a minimal action manager runs the mode
    // function at once (as in unstuck_timer.test.js). Returns the timers, the run and a restore function.
    async function hangingEscape(value) {
        M.settingsModule.setSettings({ ...BASE_SETTINGS, stuck_restart_after: value });
        let answer;
        fakes.skills.moveAway = () => new Promise((resolve) => { answer = resolve; });
        const agent = makeAgent({ on: ['unstuck'] });
        const runs = [];
        agent.actions = {
            currentActionLabel: 'action:mineOre', resume_func: null, executing: true, command_serial: 1,
            runAction(label, fn) {
                const run = { label, done: fn().then(() => ({ success: true, message: '', interrupted: false, timedout: false })) };
                runs.push(run);
                return run.done;
            },
        };
        const realSetTimeout = globalThis.setTimeout;
        const realClearTimeout = globalThis.clearTimeout;
        const timers = [];
        globalThis.setTimeout = (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; };
        globalThis.clearTimeout = (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); };
        const restore = () => {
            globalThis.setTimeout = realSetTimeout;
            globalThis.clearTimeout = realClearTimeout;
        };
        try {
            await agent.bot.modes.update();
            offset += 21000;
            await agent.bot.modes.update();
            assert.equal(runs.length, 1);
            await new Promise((resolve) => setImmediate(resolve));
        } catch (error) {
            restore();
            throw error;
        }
        return { agent, timers, runs, restore, answer: (value) => answer(value) };
    }

    test('stuck_restart_after 1: the timer of 10 s ends the process, as in v0.1.4.7', LIMIT, async () => {
        const h = await hangingEscape(1);
        try {
            assert.deepEqual(h.timers.map((t) => t.ms), [10000]);
            const limit = h.timers.shift();
            limit.fn();
            assert.deepEqual(h.agent.kills, ["Got stuck and couldn't get unstuck"], 'at once, from the timer');
            h.answer(true); // the late end of moveAway
            await h.runs[0].done;
        } finally {
            h.restore();
        }
        assert.equal(h.agent.kills.length, 1);
    });

    test('stuck_restart_after 3: the time limit is 20 s; then the reflex gives up and stops the walk', LIMIT, async () => {
        const h = await hangingEscape(3);
        try {
            assert.deepEqual(h.timers.map((t) => t.ms), [20000]);
            const limit = h.timers.shift();
            limit.fn();
            await h.runs[0].done;
            await new Promise((resolve) => setImmediate(resolve));
        } finally {
            h.restore();
        }
        assert.deepEqual(h.agent.kills, []);
        assert.ok(h.agent.bot.goals.includes(null));
        assert.equal(h.agent.messages.length, 1, 'the automatic message of execute');
        assert.match(h.agent.messages[0], /I'm stuck!\nI am stuck at \(\d+, 64, 0\) and could not walk away\.\n/);
    });
});

describe('door_closing is a background mode (A3)', () => {
    test('the door service of the glue ticks on every update, also while an action runs; no action of its own', LIMIT, async () => {
        const agent = makeAgent({ on: ['door_closing'] });
        const service = { ticks: 0, tick() { this.ticks++; }, stop() {}, closeNear() {} };
        agent.door_service = service;
        await agent.bot.modes.update();
        const running = command(agent);
        await sleep(30);
        await agent.bot.modes.update();
        await agent.bot.modes.update();
        assert.equal(service.ticks, 3);
        assert.equal(agent.actions.currentActionLabel, 'action:mineOre', 'the command goes on');
        await agent.actions.stop('!stop');
        await running;
    });

    test('also while another mode is active', LIMIT, async () => {
        const agent = makeAgent({ on: ['door_closing', 'hunger'] });
        const service = { ticks: 0, tick() { this.ticks++; } };
        agent.door_service = service;
        let release;
        fakes.home.hungerStep = (bot, ctx, state) => state.walk(() => new Promise((resolve) => { release = resolve; }));
        await agent.bot.modes.update(); // hunger starts its walk: an active mode
        await sleep(50);
        assert.equal(agent.actions.currentActionLabel, 'mode:hunger');
        const before = service.ticks;
        await agent.bot.modes.update();
        await agent.bot.modes.update();
        assert.equal(service.ticks, before + 2);
        release();
        await settle(agent);
    });

    test('without the service of the glue: createDoorService of the home pack, once, given to the glue', LIMIT, async () => {
        const made = [];
        fakes.home.createDoorService = (bot, ctx) => {
            made.push({ bot, ctx });
            return { ticks: 0, tick() { this.ticks++; } };
        };
        const agent = makeAgent({ on: ['door_closing'] });
        await agent.bot.modes.update();
        await agent.bot.modes.update();
        assert.equal(made.length, 1);
        assert.equal(made[0].bot, agent.bot);
        assert.equal(typeof made[0].ctx.log, 'function');
        assert.equal(agent.door_service.ticks, 2);
    });

    test('a switched off door_closing does not tick', LIMIT, async () => {
        const agent = makeAgent({ on: [] });
        const service = { ticks: 0, tick() { this.ticks++; } };
        agent.door_service = service;
        await agent.bot.modes.update();
        assert.equal(service.ticks, 0);
    });
});

describe('item_collecting (A8)', () => {
    let nextId = 5000;
    function dropItem(agent, dx = 3) {
        const id = nextId++;
        agent.bot.entities[id] = { id, name: 'item', type: 'object', position: agent.bot.entity.position.offset(dx, 0, 0) };
        return id;
    }

    test('a pick-up that gained nothing: again after 3 s, not before, at most 3 times again', LIMIT, async () => {
        const tries = [];
        fakes.skills.pickupNearbyItems = async () => { tries.push(Date.now()); return true; };
        const agent = makeAgent({ on: ['item_collecting'] });
        dropItem(agent);
        await agent.bot.modes.update(); // noticed
        offset += 2100;
        await agent.bot.modes.update(); // the first try
        await settle(agent);
        assert.equal(tries.length, 1);
        await agent.bot.modes.update();
        offset += 2000;
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(tries.length, 1, 'not before 3 s');
        for (let i = 2; i <= 4; i++) {
            offset += 3000;
            await agent.bot.modes.update();
            await settle(agent);
            assert.equal(tries.length, i);
        }
        offset += 3000;
        await agent.bot.modes.update();
        await settle(agent);
        offset += 30000;
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(tries.length, 4, 'the first try and 3 more');
    });

    test('a pick-up that gained something: no second try of that item', LIMIT, async () => {
        let tries = 0;
        let agent = null;
        fakes.skills.pickupNearbyItems = async () => { tries++; agent.bot.inventory.slots[36] = { name: 'oak_fence', count: 8 }; return true; };
        agent = makeAgent({ on: ['item_collecting'] });
        dropItem(agent);
        await agent.bot.modes.update();
        offset += 2100;
        await agent.bot.modes.update();
        await settle(agent);
        offset += 3000;
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(tries, 1);
    });

    test('an item that the bot threw is left for 10 s', LIMIT, async () => {
        let tries = 0;
        fakes.skills.pickupNearbyItems = async () => { tries++; return true; };
        const agent = makeAgent({ on: ['item_collecting'] });
        const id = nextId++;
        const item = { id, name: 'item', type: 'object', position: agent.bot.entity.position.offset(0, 1.32, 0) };
        agent.bot.emit('entitySpawn', item); // it appears at the eyes of the bot
        item.position = agent.bot.entity.position.offset(2, 0, 0); // and flies 2 blocks
        agent.bot.entities[id] = item;
        await agent.bot.modes.update();
        offset += 2100;
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(tries, 0);
        offset += 8000;
        await agent.bot.modes.update(); // 10.1 s: noticed
        offset += 2100;
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(tries, 1);
    });

    test('another item beside the bot\'s own drop: nothing is picked up while the drop is younger than 10 s', LIMIT, async () => {
        let tries = 0;
        fakes.skills.pickupNearbyItems = async () => { tries++; return true; };
        const agent = makeAgent({ on: ['item_collecting'] });
        const own = { id: nextId++, name: 'item', type: 'object', position: agent.bot.entity.position.offset(0, 1.32, 0) };
        agent.bot.emit('entitySpawn', own);
        own.position = agent.bot.entity.position.offset(1, 0, 0);
        agent.bot.entities[own.id] = own;
        dropItem(agent, 5); // an item of someone else
        await agent.bot.modes.update();
        offset += 2100;
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(tries, 0, 'pickupNearbyItems would take the own drop too');
        offset += 8000;
        await agent.bot.modes.update();
        offset += 2100;
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(tries, 1);
    });

    test('an item of another player appears 3 blocks away: collected as before', LIMIT, async () => {
        let tries = 0;
        fakes.skills.pickupNearbyItems = async () => { tries++; return true; };
        const agent = makeAgent({ on: ['item_collecting'] });
        const id = nextId++;
        const item = { id, name: 'item', type: 'object', position: agent.bot.entity.position.offset(3, 1.32, 0) };
        agent.bot.emit('entitySpawn', item);
        agent.bot.entities[id] = item;
        await agent.bot.modes.update();
        offset += 2100;
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(tries, 1);
    });
});

describe('self_preservation and hunger damage (A9)', () => {
    function starving(agent) {
        agent.bot.food = 0;
        agent.bot.health = 3;
        agent.bot.lastDamageTime = Date.now();
        agent.bot.lastDamageTaken = 1;
    }

    test('food 0, no hostile mob: no running away, "I am starving." once per 60 s', LIMIT, async () => {
        const moves = [];
        fakes.skills.moveAway = async (bot, d) => { moves.push(d); return true; };
        const agent = makeAgent({ on: ['self_preservation'] });
        starving(agent);
        await agent.bot.modes.update();
        offset += 1000;
        agent.bot.lastDamageTime = Date.now();
        await agent.bot.modes.update();
        await settle(agent);
        assert.deepEqual(moves, []);
        assert.equal(agent.bot.modes.behavior_log, 'I am starving.\n');
        offset += 60000;
        agent.bot.lastDamageTime = Date.now();
        await agent.bot.modes.update();
        assert.equal(agent.bot.modes.behavior_log, 'I am starving.\nI am starving.\n');
        assert.equal(agent.actions.executing, false);
    });

    test('food 0 with a zombie within 16 blocks: "I\'m dying!" and moveAway(20) as before', LIMIT, async () => {
        const moves = [];
        fakes.skills.moveAway = async (bot, d) => { moves.push(d); return true; };
        const agent = makeAgent({ on: ['self_preservation'] });
        starving(agent);
        agent.bot.entities[1] = { id: 1, name: 'zombie', type: 'hostile', position: agent.bot.entity.position.offset(10, 0, 0) };
        await agent.bot.modes.update();
        await settle(agent);
        assert.deepEqual(moves, [20]);
        assert.ok(agent.bot.modes.behavior_log.includes("I'm dying!"));
    });

    test('food above 0 at low health: "I\'m dying!" as before', LIMIT, async () => {
        const moves = [];
        fakes.skills.moveAway = async (bot, d) => { moves.push(d); return true; };
        const agent = makeAgent({ on: ['self_preservation'] });
        starving(agent);
        agent.bot.food = 2;
        await agent.bot.modes.update();
        await settle(agent);
        assert.deepEqual(moves, [20]);
    });
});

describe('self_defense at low health (A10)', () => {
    function withZombie(agent) {
        agent.bot.entities[1] = { id: 1, name: 'zombie', type: 'hostile', position: agent.bot.entity.position.offset(4, 0, 0) };
    }

    test('flee_below_health 0 (the default): it fights as before', LIMIT, async () => {
        const fights = [];
        fakes.skills.defendSelf = async (bot, range) => { fights.push(range); return true; };
        const agent = makeAgent({ on: ['self_defense'] });
        agent.bot.health = 2;
        withZombie(agent);
        await agent.bot.modes.update();
        await settle(agent);
        assert.deepEqual(fights, [8]);
        assert.ok(agent.bot.modes.behavior_log.includes('Fighting zombie!'));
    });

    test('below flee_below_health: no attack, the line, to the nearest player within 32 blocks', LIMIT, async () => {
        M.settingsModule.setSettings({ ...BASE_SETTINGS, flee_below_health: 8 });
        const fights = [];
        const goes = [];
        fakes.skills.defendSelf = async () => { fights.push(1); };
        fakes.skills.goToPlayer = async (bot, name, distance) => { goes.push([name, distance]); return true; };
        const agent = makeAgent({ on: ['self_defense'] });
        agent.bot.health = 6;
        withZombie(agent);
        agent.bot.entities[2] = { id: 2, name: 'player', type: 'player', username: 'bob', position: agent.bot.entity.position.offset(-20, 0, 0) };
        agent.bot.entities[3] = { id: 3, name: 'player', type: 'player', username: 'andy', position: agent.bot.entity.position.offset(0, 0, 1) };
        await agent.bot.modes.update();
        await settle(agent);
        assert.deepEqual(fights, []);
        assert.deepEqual(goes, [['bob', 3]]);
        assert.equal(agent.bot.modes.behavior_log, 'I am hurt (health 6 of 20). I retreat.\n');
    });

    test('no player: into the shelter of the home pack; without a shelter: moveAway(10)', LIMIT, async () => {
        M.settingsModule.setSettings({ ...BASE_SETTINGS, flee_below_health: 8 });
        const shelters = [];
        const moves = [];
        fakes.home.findShelter = () => ({ kind: 'area', area: { name: 'home' } });
        fakes.home.goToShelter = async (bot, ctx) => { shelters.push(ctx); return { ok: true, text: 'I am in the shelter.' }; };
        fakes.skills.moveAway = async (bot, d) => { moves.push(d); return true; };
        const agent = makeAgent({ on: ['self_defense'] });
        agent.bot.health = 5;
        withZombie(agent);
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(shelters.length, 1);
        assert.deepEqual(moves, []);

        fakes.home.findShelter = () => ({ kind: 'emergency' });
        await agent.bot.modes.update();
        await settle(agent);
        assert.deepEqual(moves, [10]);

        M.settingsModule.setSettings({ ...BASE_SETTINGS, home_pack: false, flee_below_health: 8 });
        fakes.home.findShelter = () => ({ kind: 'area', area: { name: 'home' } });
        await agent.bot.modes.update();
        await settle(agent);
        assert.equal(shelters.length, 1, 'home_pack off: no shelter of the home pack');
        assert.deepEqual(moves, [10, 10]);
    });
});

describe('the mode hunger (A11)', () => {
    test('hungerStep every 2 s with the state of the mode; one step at a time', LIMIT, async () => {
        const steps = [];
        let finish = null;
        fakes.home.hungerStep = (bot, ctx, state) => {
            steps.push({ bot, ctx, state: { ...state } });
            return finish ? new Promise((resolve) => { finish = resolve; }) : undefined;
        };
        const agent = makeAgent({ on: ['hunger'] });
        agent.packContext = () => ({ storage: 'the storage pack' });
        await agent.bot.modes.update();
        await sleep(10);
        assert.equal(steps.length, 1);
        assert.equal(steps[0].bot, agent.bot);
        assert.equal(steps[0].ctx.storage, 'the storage pack', 'the context of the packs: ctx.storage.fetchItem');
        assert.equal(steps[0].state.idle, true);
        assert.equal(steps[0].state.playerOrder, false);
        assert.equal(typeof steps[0].state.walk, 'function');
        assert.ok(Math.abs(steps[0].state.now - Date.now()) < 1000);
        await agent.bot.modes.update();
        offset += 1900;
        await agent.bot.modes.update();
        await sleep(10);
        assert.equal(steps.length, 1, 'not before 2 s');
        offset += 100;
        finish = () => {}; // this step does not end yet
        await agent.bot.modes.update();
        await sleep(10);
        assert.equal(steps.length, 2);
        offset += 5000;
        await agent.bot.modes.update();
        await sleep(10);
        assert.equal(steps.length, 2, 'the step before runs');
        finish();
        await sleep(10);
        finish = null;
        await agent.bot.modes.update();
        await sleep(10);
        assert.equal(steps.length, 3);
    });

    test('an order of the player runs: playerOrder; eating runs beside the command', LIMIT, async () => {
        const steps = [];
        fakes.home.hungerStep = (bot, ctx, state) => { steps.push({ ...state }); };
        const agent = makeAgent({ on: ['hunger'] });
        agent.last_order = { by: 'bob', command: '!mineOre' };
        const running = command(agent);
        await sleep(30);
        await agent.bot.modes.update();
        await sleep(10);
        assert.equal(steps[0].idle, false);
        assert.equal(steps[0].playerOrder, true);
        assert.equal(agent.actions.currentActionLabel, 'action:mineOre');
        await agent.actions.stop('!stop');
        await running;
    });

    test('state.walk(fn): the walk to a chest is the mode action mode:hunger; it stops the command', LIMIT, async () => {
        let inside = null;
        let walked = null;
        fakes.home.hungerStep = async (bot, ctx, state) => {
            walked = await state.walk(async () => { inside = agent.actions.currentActionLabel; });
        };
        const agent = makeAgent({ on: ['hunger'] });
        const running = command(agent);
        await sleep(30);
        await agent.bot.modes.update();
        const result = await running;
        await settle(agent);
        assert.equal(inside, 'mode:hunger');
        assert.equal(walked, true);
        assert.equal(result.stopped_by, 'the reflex hunger');
    });

    test('state.walk(fn) while self_preservation runs: false, fn does not run', LIMIT, async () => {
        let gate;
        let walked = null;
        let ran = false;
        fakes.home.hungerStep = async (bot, ctx, state) => {
            await new Promise((resolve) => { gate = resolve; });
            walked = await state.walk(async () => { ran = true; });
        };
        let agent = null;
        fakes.skills.moveAway = () => new Promise((resolve) => {
            const t = setInterval(() => {
                if (agent.bot.interrupt_code) {
                    clearInterval(t);
                    resolve(true);
                }
            }, 10);
        });
        agent = makeAgent({ on: ['self_preservation', 'hunger'], blockName: (p) => (p.y === 65 ? 'sand' : 'air') });
        agent.bot.blockAt = (p) => ({ name: 'air', position: p }); // no sand yet
        await agent.bot.modes.update(); // the step of hunger starts and waits at the gate
        agent.bot.blockAt = (p) => ({ name: p.y === 65 ? 'sand' : 'air', position: p }); // sand falls on the head
        await agent.bot.modes.update(); // self_preservation: moveAway(2), an active mode
        await sleep(50);
        assert.equal(agent.actions.currentActionLabel, 'mode:self_preservation');
        gate();
        await sleep(30);
        assert.equal(walked, false);
        assert.equal(ran, false);
        assert.equal(agent.actions.currentActionLabel, 'mode:self_preservation');
        await agent.actions.stop('!stop');
        await settle(agent);
    });

    test('an error of hungerStep does not reach the update loop', LIMIT, async () => {
        fakes.home.hungerStep = () => { throw new Error('broken'); };
        const agent = makeAgent({ on: ['hunger'] });
        await agent.bot.modes.update();
        await sleep(10);
        offset += 2000;
        await agent.bot.modes.update();
        await sleep(10);
        assert.ok(cap.of('warn').some((r) => r.text.includes('Mode hunger failed')));
    });
});

describe('night_shelter (A7)', () => {
    test('no home: no action, and once per night "I know no home. Tell me where home is."', LIMIT, async () => {
        const agent = makeAgent({ on: ['night_shelter'], places: null });
        agent.bot.time.timeOfDay = 13000;
        await agent.bot.modes.update();
        offset += 120000;
        await agent.bot.modes.update();
        assert.equal(agent.actions.executing, false);
        assert.equal(agent.bot.modes.behavior_log, 'I know no home. Tell me where home is.\n');
        agent.bot.time.timeOfDay = 1000; // the day
        await agent.bot.modes.update();
        agent.bot.time.timeOfDay = 13500; // the next night
        await agent.bot.modes.update();
        assert.equal(agent.bot.modes.behavior_log, 'I know no home. Tell me where home is.\nI know no home. Tell me where home is.\n');
    });

    test('agent.whereAmI of the glue decides when it exists: underground, the reflex waits', LIMIT, async () => {
        const agent = makeAgent({ on: ['night_shelter'] });
        agent.bot.time.timeOfDay = 13000;
        let asked = 0;
        agent.whereAmI = () => { asked++; return { area: { name: 'mine', type: 'mine' }, depth: 0, underground: true }; };
        await agent.bot.modes.update();
        assert.equal(asked, 1);
        assert.equal(agent.actions.executing, false);
        assert.equal(agent.bot.modes.behavior_log, '');
    });
});
