// Spec v0.1.4.13, 4.4 P6 (part P, engineer E3): a command the model picks while a skill of a job runs is not
// executed; it is answered to the model as `The mining runs, 7 of 28 diamond. Say !stop first.` (a system line),
// unless it is !stop, !stats, !inventory or a query. The owner's typed command keeps today's behaviour, and so
// does a system order of the job.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeJobWorld } from '../helpers/xp_job_world.js';

const L = await loadSrc('src/agent/job/job_logic.js');
const X = await loadSrc('src/agent/job/job_texts.js');

let log;
let warn;
before(() => {
    log = console.log;
    warn = console.warn;
    console.log = () => {};
    console.warn = () => {};
});
after(() => {
    console.log = log;
    console.warn = warn;
});

describe('P6: the rule, pure', () => {
    test('refusedWhileRunning: the model while a skill of the job runs, but never !stop, !stats, !inventory or a query', () => {
        for (const running of ['job', 'resume', 'step', true]) {
            assert.equal(L.refusedWhileRunning('!goToPlayer', { by: 'model', running }), true, `${running}`);
            assert.equal(L.refusedWhileRunning('!mineOre', { by: 'model', running }), true);
            assert.equal(L.refusedWhileRunning('!stop', { by: 'model', running }), false);
            assert.equal(L.refusedWhileRunning('!stats', { by: 'model', running }), false);
            assert.equal(L.refusedWhileRunning('!inventory', { by: 'model', running }), false);
            assert.equal(L.refusedWhileRunning('!craftable', { by: 'model', running, query: true }), false, 'a query');
        }
        assert.equal(L.refusedWhileRunning('!goToPlayer', { by: 'Steve', running: 'job' }), false, 'the owner typed it');
        assert.equal(L.refusedWhileRunning('!goToPlayer', { by: 'player', running: 'job' }), false);
        assert.equal(L.refusedWhileRunning('!goToPlayer', { by: 'system', running: 'job' }), false, 'a system order of the job');
        assert.equal(L.refusedWhileRunning('!goToPlayer', { by: 'model', running: false }), false, 'nothing of the job runs');
        assert.equal(L.refusedWhileRunning('!goToPlayer', { by: 'model', running: 'other' }), false, 'an errand runs, not the job');
        assert.equal(L.refusedWhileRunning('goToPlayer', { by: 'model', running: 'job' }), true, 'without the !');
        assert.equal(L.refusedWhileRunning('', { by: 'model', running: 'job' }), false);
        assert.deepEqual([...L.MODEL_FREE_COMMANDS], ['!stop', '!stats', '!inventory']);
        assert.deepEqual([...L.JOB_SKILL_ROLES], ['job', 'resume', 'step']);
    });

    test('busyText, word for word', () => {
        const job = { kind: 'mineOre', args: ['diamond', 28, false], wanted: 28, got: 7, words: 'the mining', state: 'running' };
        assert.equal(X.busyText(job), 'The mining runs, 7 of 28 diamond. Say !stop first.');
        assert.equal(X.busyText({ kind: 'farmCycle', args: ['farm'], wanted: null, got: null, words: 'the farming', state: 'running' }), 'The farming runs. Say !stop first.');
    });
});

describe('P6: job.refusal on the job', () => {
    // A mining pack whose skill runs until the test releases it; the model's follow-up comes while it runs.
    function longMining() {
        let release;
        const running = new Promise((resolve) => { release = resolve; });
        const handler = async (args, w) => {
            w.job.progress(7);
            await running;
            return { result: { ok: false, reason: 'interrupted', text: 'I mined 7 diamond of 28. I am still in the mine.' }, gain: { diamond: 7 } };
        };
        return { handler, release: () => release() };
    }

    test('while the skill of the job runs: the model is refused with the count, the owner and the system are not', async () => {
        const mining = longMining();
        const w = makeJobWorld({ handlers: { '!mineOre': mining.handler } });
        const run = w.run('!mineOre("diamond", 28)', 'Steve');
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(w.job.refusal('!goToPlayer', 'model', false), 'The mining runs, 7 of 28 diamond. Say !stop first.');
        assert.equal(w.job.refusal('!mineOre', 'model', false), 'The mining runs, 7 of 28 diamond. Say !stop first.');
        assert.equal(w.job.refusal('!stop', 'model', false), null);
        assert.equal(w.job.refusal('!stats', 'model', false), null);
        assert.equal(w.job.refusal('!inventory', 'model', false), null);
        assert.equal(w.job.refusal('!craftable', 'model', true), null, 'a query');
        assert.equal(w.job.refusal('!goToPlayer', 'Steve', false), null, 'typed by the owner');
        assert.equal(w.job.refusal('!goToPlayer', 'system', false), null, 'an order of the job');
        mining.release();
        await run;
        assert.equal(w.job.refusal('!goToPlayer', 'model', false), null, 'nothing runs after the skill ended');
    });

    test('a step of the plan running is a skill of the job too; an errand running is not', async () => {
        let release;
        const w = makeJobWorld({
            answers: ['!craftSupplies("torch", 16)'],
            handlers: {
                '!mineOre': () => ({ result: { ok: false, reason: 'no_supplies', text: 'I have no torches.' } }),
                '!craftSupplies': async () => {
                    await new Promise((resolve) => { release = resolve; });
                    return { result: { ok: true, reason: null, text: 'I made 16 torches.' }, gain: { torch: 16 } };
                },
            },
        });
        const run = w.run('!mineOre("iron", 4)', 'Steve');
        for (let i = 0; i < 10 && !release; i++) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        assert.ok(release, 'the first step runs');
        assert.equal(w.job.refusal('!goToPlayer', 'model', false), 'The mining runs, 0 of 4 iron. Say !stop first.');
        release();
        await run;
        w.job.onCommand('!followPlayer', ['Steve', 4], 'model');
        assert.equal(w.job.refusal('!goToPlayer', 'model', false), null, 'an errand is no skill of the job');
    });

    test('without a running job nothing is refused', async () => {
        const w = makeJobWorld();
        assert.equal(w.job.refusal('!goToPlayer', 'model', false), null);
        w.job.onCommand('!farmCycle', ['farm'], 'Steve');
        await w.job.onResult('!farmCycle', { ok: false, reason: 'interrupted', text: '' }, {});
        assert.equal(w.job.refusal('!goToPlayer', 'model', false), null, 'the job is paused between runs');
    });
});

describe('P6: executeCommand of the commands answers the model and does not run the command', () => {
    test('a fake agent with a job that refuses: the text comes back, nothing ran; the owner and a free command run', async () => {
        const C = await loadSrc('src/agent/commands/index.js');
        const refusals = [];
        const performed = [];
        const agent = {
            name: 'andy', bot: { username: 'andy', inventory: { items: () => [] } }, running_commands: [], last_order: null, repeat_guard: null,
            actions: { executing: true, currentActionLabel: 'action:mineOre' },
            job: {
                refusal: (name, by, query) => {
                    refusals.push([name, by, query]);
                    return by === 'model' && !query && name !== '!stop' ? 'The mining runs, 7 of 28 diamond. Say !stop first.' : null;
                },
                onCommand: (name) => performed.push(['onCommand', name]),
                onResult: async (name) => performed.push(['onResult', name]),
            },
        };
        assert.equal(await C.executeCommand(agent, '!stay(5)', { typed: false }), 'The mining runs, 7 of 28 diamond. Say !stop first.');
        assert.deepEqual(refusals.at(-1), ['!stay', 'model', false]);
        assert.deepEqual(performed, [], 'the command did not run and the job did not note it');
        assert.equal(agent.running_commands.length, 0);
        // a query of the model passes (the refusal is asked with query true); the fake bot cannot answer it, so the
        // perform may throw: what counts is that the job was asked with query true and the command reached the hooks
        await C.executeCommand(agent, '!inventory', { typed: false }).catch(() => {});
        assert.deepEqual(refusals.at(-1), ['!inventory', 'model', true]);
        assert.ok(performed.some(p => p[0] === 'onCommand' && p[1] === '!inventory'), 'the query ran');
        // the owner's typed command passes to the job as before
        const typedRefusals = refusals.length;
        await C.executeCommand(agent, '!stay(5)', { typed: true, by: 'Steve' }).catch(() => {});
        assert.deepEqual(refusals[typedRefusals], ['!stay', 'Steve', false]);
        assert.ok(performed.some(p => p[0] === 'onCommand' && p[1] === '!stay'), 'the typed command ran through the job hooks');
        // a system order of the job passes
        const systemRefusals = refusals.length;
        await C.executeCommand(agent, '!stay(5)', { by: 'system', typed: false }).catch(() => {});
        assert.deepEqual(refusals[systemRefusals], ['!stay', 'system', false]);
    });

    test('a job without the method, or one that throws: the command runs as before', async () => {
        const C = await loadSrc('src/agent/commands/index.js');
        for (const job of [{ onCommand() {}, async onResult() {} }, { refusal() { throw new Error('x'); }, onCommand() {}, async onResult() {} }]) {
            const noted = [];
            job.onCommand = (name) => noted.push(name);
            const agent = { name: 'andy', bot: { username: 'andy', inventory: { items: () => [] } }, running_commands: [], last_order: null, repeat_guard: null, job };
            const out = await C.executeCommand(agent, '!stay(5)', { typed: false }).catch(() => 'threw');
            assert.notEqual(out, 'The mining runs, 7 of 28 diamond. Say !stop first.');
            assert.deepEqual(noted, ['!stay'], 'the command reached the job hooks');
        }
    });
});
