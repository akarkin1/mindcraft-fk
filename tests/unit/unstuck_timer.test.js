// Play test fix F2: the unstuck mode ended the process after it was interrupted.
//
// The mode starts a timer that calls agent.cleanKill("Got stuck and couldn't get unstuck") after
// 10 seconds and awaits skills.moveAway(bot, 5). The timer was cleared only after a successful
// moveAway, so a moveAway that threw (PathStopped after !stop) left it running and the process
// ended 10 seconds later.
//
// Seam: src/utils/kill_timer.js, withKillTimer(onTimeout, ms, fn). Its own tests use a manual
// fake clock. The second part drives the real unstuck mode of src/agent/modes.js through
// ModeController.update() with a fake agent: the real skills.moveAway runs in cheat mode, the
// fake pathfinder decides whether it succeeds, throws or never returns.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

async function importModules() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const killTimer = await loadSrc('src/utils/kill_timer.js');
        const modes = await loadSrc('src/agent/modes.js');
        return { killTimer, modes };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { killTimer, modes } = await importModules();

// Replaces the global setTimeout/clearTimeout: timers only fire in advance(ms).
function installFakeTimers() {
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    const timers = new Map();
    let now = 0;
    let nextId = 1;
    globalThis.setTimeout = (fn, ms = 0, ...args) => {
        const id = { fakeTimer: nextId++ };
        timers.set(id, { at: now + ms, fn, args, ms });
        return id;
    };
    globalThis.clearTimeout = (id) => {
        timers.delete(id);
    };
    return {
        pending: () => [...timers.values()].map((t) => t.ms),
        advance(ms) {
            now += ms;
            const due = [...timers.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
            for (const [id, t] of due) {
                timers.delete(id);
                t.fn(...t.args);
            }
        },
        restore() {
            globalThis.setTimeout = realSetTimeout;
            globalThis.clearTimeout = realClearTimeout;
        },
    };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function pathStopped() {
    const err = new Error('Path was stopped before it could be completed! Thus, the desired goal was not reached.');
    err.name = 'PathStopped';
    return err;
}

let clock;
let cap;
beforeEach(() => {
    cap = captureConsole();
    clock = installFakeTimers();
});
afterEach(() => {
    clock.restore();
    cap.restore();
});

describe('withKillTimer(onTimeout, ms, fn)', () => {
    test('fn resolves: its value is returned and the timer is cleared', async () => {
        const kills = [];
        const result = await killTimer.withKillTimer(() => kills.push('kill'), 10000, async () => 'moved');
        assert.equal(result, 'moved');
        assert.deepEqual(clock.pending(), []);
        clock.advance(20000);
        assert.deepEqual(kills, []);
    });

    test('fn returns a plain value: returned, the timer is cleared', async () => {
        const kills = [];
        assert.equal(await killTimer.withKillTimer(() => kills.push('kill'), 10000, () => 7), 7);
        clock.advance(20000);
        assert.deepEqual(kills, []);
    });

    test('fn rejects (PathStopped): the same error is thrown on and the timer is cleared', async () => {
        const kills = [];
        const error = pathStopped();
        await assert.rejects(killTimer.withKillTimer(() => kills.push('kill'), 10000, async () => {
            throw error;
        }), (err) => err === error);
        assert.deepEqual(clock.pending(), []);
        clock.advance(20000);
        assert.deepEqual(kills, []);
    });

    test('fn throws synchronously: the same error is thrown on and the timer is cleared', async () => {
        const kills = [];
        const error = new TypeError('boom');
        await assert.rejects(killTimer.withKillTimer(() => kills.push('kill'), 10000, () => {
            throw error;
        }), (err) => err === error);
        clock.advance(20000);
        assert.deepEqual(kills, []);
    });

    test('fn does not settle within ms: onTimeout is called once, at ms and not before', async () => {
        const kills = [];
        let finish;
        const run = killTimer.withKillTimer(() => kills.push('kill'), 10000, () => new Promise((resolve) => { finish = resolve; }));
        assert.deepEqual(clock.pending(), [10000]);
        clock.advance(9999);
        assert.deepEqual(kills, []);
        clock.advance(1);
        assert.deepEqual(kills, ['kill']);
        finish('late');
        assert.equal(await run, 'late', 'the late result is still returned');
        clock.advance(20000);
        assert.deepEqual(kills, ['kill']);
    });

    test('with the real setTimeout: a short timer fires, a cleared one does not', async () => {
        clock.restore();
        let fired;
        const firedOnce = new Promise((resolve) => { fired = resolve; });
        const hanging = killTimer.withKillTimer(() => fired('timeout'), 20, () => new Promise(() => {}));
        assert.equal(await firedOnce, 'timeout');
        void hanging;
        let lateKills = 0;
        await killTimer.withKillTimer(() => { lateKills++; }, 20, async () => 'done');
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(lateKills, 0);
    });

    test('module rules: no imports, importable without output or files', () => {
        assertImportRules('src/utils/kill_timer.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/utils/kill_timer.js');
    });
});

describe('unstuck mode of src/agent/modes.js', () => {
    const REGISTRY = minecraftData('1.21.8');
    const ONLY_UNSTUCK = {
        self_preservation: false, unstuck: true, cowardice: false, self_defense: false, hunting: false,
        item_collecting: false, torch_placing: false, elbow_room: false, idle_staring: false,
        cheat: true, // moveAway asks the pathfinder for a path and teleports
    };

    let realDateNow;
    let now;
    beforeEach(() => {
        realDateNow = Date.now;
        now = 1_700_000_000_000;
        Date.now = () => now;
    });
    afterEach(() => {
        Date.now = realDateNow;
    });

    // getPathTo: the fake pathfinder's answer, it decides how moveAway ends.
    function makeAgent(getPathTo) {
        const bot = {
            username: 'andy',
            output: '',
            interrupt_code: false,
            entity: { position: new Vec3(0, 64, 0) },
            targetDigBlock: null,
            registry: REGISTRY,
            pathfinder: { setMovements() {}, getPathTo },
            chats: [],
            chat(message) {
                bot.chats.push(message);
            },
        };
        const agent = {
            name: 'andy',
            bot,
            shut_up: false,
            idle: true,
            kills: [],
            isIdle() {
                return agent.idle;
            },
            cleanKill(msg, code) {
                agent.kills.push({ msg, code });
            },
            openChat() {},
            handleMessage() {},
            self_prompter: { isActive: () => false, stopLoop() {} },
            prompter: { getInitModes: () => ONLY_UNSTUCK },
            actions: {
                currentActionLabel: '',
                resume_func: null,
                runs: [],
                // Like ActionManager: the action's error is caught and reported, not thrown.
                runAction(label, fn) {
                    const run = { label, error: null };
                    run.done = (async () => {
                        try {
                            await fn();
                        } catch (err) {
                            run.error = err;
                            return { success: false, message: String(err), interrupted: false, timedout: false };
                        }
                        return { success: true, message: bot.output, interrupted: false, timedout: false };
                    })();
                    agent.actions.runs.push(run);
                    return run.done;
                },
            },
        };
        modes.initModes(agent);
        return agent;
    }

    // Idle (the mode resets), busy at the same place, then 21 seconds later: stuck.
    async function getStuck(agent) {
        agent.idle = true;
        await agent.bot.modes.update();
        agent.idle = false;
        await agent.bot.modes.update();
        now += 21_000;
        await agent.bot.modes.update();
        assert.equal(agent.actions.runs.length, 1, 'the unstuck mode started moveAway');
        assert.equal(agent.actions.runs[0].label, 'mode:unstuck');
        return agent.actions.runs[0];
    }

    async function finished(run) {
        await run.done;
        await flush();
    }

    test('moveAway throws (PathStopped after !stop): the timer is cleared, no cleanKill, the error is passed on', async () => {
        const error = pathStopped();
        const agent = makeAgent(async () => {
            throw error;
        });
        const run = await getStuck(agent);
        await finished(run);
        assert.equal(run.error, error, 'the error of moveAway reaches the action manager');
        assert.deepEqual(clock.pending(), [], 'no timer left');
        clock.advance(60_000);
        assert.deepEqual(agent.kills, []);
        assert.ok(agent.bot.modes.behavior_log.includes("I'm stuck!"));
        assert.ok(!agent.bot.modes.behavior_log.includes("I'm free."), agent.bot.modes.behavior_log);
    });

    test('moveAway succeeds: the timer is cleared, no cleanKill, "I\'m free." is said', async () => {
        const agent = makeAgent(async () => ({ path: [{ x: 5.5, y: 64, z: -3.5 }] }));
        const run = await getStuck(agent);
        await finished(run);
        assert.equal(run.error, null);
        assert.deepEqual(agent.bot.chats, ['/tp @s 5 64 -4']);
        assert.deepEqual(clock.pending(), []);
        clock.advance(60_000);
        assert.deepEqual(agent.kills, []);
        assert.ok(agent.bot.modes.behavior_log.includes("I'm free."), agent.bot.modes.behavior_log);
    });

    test('moveAway does not return within 10 seconds: cleanKill("Got stuck and couldn\'t get unstuck")', async () => {
        let answer;
        const agent = makeAgent(() => new Promise((resolve) => { answer = resolve; }));
        const run = await getStuck(agent);
        await flush();
        assert.deepEqual(clock.pending(), [10000]);
        clock.advance(9_999);
        assert.deepEqual(agent.kills, []);
        clock.advance(1);
        assert.deepEqual(agent.kills, [{ msg: "Got stuck and couldn't get unstuck", code: undefined }]);
        // let the mode finish so it is not left active
        answer({ path: [{ x: 5, y: 64, z: 5 }] });
        await finished(run);
        assert.equal(agent.kills.length, 1);
    });
});
