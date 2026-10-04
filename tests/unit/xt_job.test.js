// Tests from the spec (v0.1.4.13, section 6, T1): the job corrections P5 and P6 of part P (SPEC 4.4).
// P5: the job's `got` is set from the skill's own count each time the skill reports progress (the pack calls
// ctx.job?.progress?.(got)), and the stop text and the job line say the same number; a fake pack that reports 7.
// The handoff: `got` is the count of this run, the job adds its base; on !stop the leave text waits for the skill's
// last count and is said once (`I leave the mining at 2 of 6 iron.`).
// P6: a command the model picks while a skill of a job runs is not executed; it is answered to the model as
// `The mining runs, 7 of 28 diamond. Say !stop first.` unless it is !stop, !stats, !inventory, a query; the owner's
// typed !command keeps today's behaviour. A failing test is a finding.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { wornStopText } from '../../src/agent/packs/mining/texts.js';

const OWNER = 'MartyByrde2';
const MINE = '!mineOre("diamond", 28)';
const REFUSAL = 'The mining runs, 7 of 28 diamond. Say !stop first.';

let J;
let C;
let workDir;
let originalCwd;
before(async () => {
    // the commands load the library of the agent; nothing may read a keys.json, so the import runs in an empty folder
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir);
    const cap = captureConsole();
    try {
        J = await loadSrc('src/agent/job/index.js');
        C = await loadSrc('src/agent/commands/index.js');
    } finally {
        cap.restore();
        process.chdir(originalCwd);
    }
});
after(() => removeTmpDir(workDir));

/** A job over a store in memory, with a fake agent: what it says is recorded; the skill runs while `state.running`. */
function makeJob(settings = {}) {
    const said = [];
    const orders = [];
    const state = { running: false, now: Date.UTC(2026, 9, 4, 6, 45, 12) };
    // running_commands as executeCommand documents it: { name, args, text, typed, by }, the newest last
    const agent = { name: 'claude', sayText: (t) => said.push(t), openChat: (t) => said.push(t), bot: null, actions: { currentActionLabel: '' }, running_commands: [] };
    const job = J.createJob(agent, new J.JobStore(null), {
        settings: { job_memory: true, job_resume_seconds: 0, idle_jobs: [], ...settings },
        now: () => state.now,
        say: (t) => said.push(t),
        inventory: () => ({}),
        actionRunning: () => state.running,
        sleeping: () => false,
        night: () => false,
        nightShelter: () => false,
        underground: () => true,
        where: () => null,
        position: () => null,
        chests: () => null,
        // the agent runs an order of the job as executeCommand(this, text, { by: 'system', typed: false }), which
        // calls onCommand of the job before the command runs
        executeCommand: async (text, options) => {
            orders.push({ text, options });
            const m = text.match(/^(![A-Za-z]+)\((.*)\)$/) ?? text.match(/^(![A-Za-z]+)$/);
            const args = m?.[2] ? JSON.parse(`[${m[2]}]`) : [];
            job.onCommand(m[1], args, 'system', text);
            agent.running_commands.push({ name: m[1], args, text, typed: false, by: 'system' });
            state.running = true;
            // the real executeCommand returns when the command ended (the lead, round 2: T1-P5-base was this fixture
            // returning at once); a test that needs the command to run calls hold() first and release() after
            if (state.hold)
                await state.hold;
        },
        askModel: async () => '',
    });
    return { job, said, state, agent, orders };
}

/** The owner orders the mining; the skill starts. */
function startMining(j) {
    j.job.onCommand('!mineOre', ['diamond', 28], OWNER, MINE);
    j.agent.running_commands.push({ name: '!mineOre', args: ['diamond', 28], text: MINE, typed: true, by: OWNER });
    j.state.running = true;
}

/** The skill ended: its entry leaves running_commands. */
function ended(j) {
    j.agent.running_commands.pop();
    j.state.running = false;
}

describe('SPEC 4.4 P5: the counter', () => {
    test('a fake pack reports 7: the job line says 7 of 28 diamond', () => {
        const j = makeJob();
        startMining(j);
        j.job.progress(7);
        assert.match(j.job.status(), /^Job: the mining, 7 of 28 diamond\b/, j.job.status());
    });

    test('the stop text of the pack and the job line say the same number, whatever the bag gained', async () => {
        const j = makeJob();
        startMining(j);
        j.job.progress(7);
        const stop = wornStopText('iron_pickaxe', 8, 7, 28, 'diamond');
        ended(j);
        await j.job.onResult('!mineOre', { ok: false, reason: 'worn', text: stop }, { diamond: 9 });
        assert.match(stop, /at 7 of 28 diamond/);
        assert.match(j.job.status(), /\b7 of 28 diamond\b/, `the job line after the stop: ${j.job.status()}`);
        assert.ok(!j.said.some((t) => /\b(9|16) of 28\b/.test(t)), `no text says another number: ${JSON.stringify(j.said)}`);
    });

    // The handoff: `got` is the count of this run and the job adds its base. (T1-P5-base was a fixture whose
    // executeCommand returned before the command ended; the lead, round 2.)
    test('got is the count of this run; the job adds its base (the handoff)', async () => {
        const j = makeJob({ job_resume_seconds: 5 });
        startMining(j);
        j.job.progress(7);
        // a reflex stops the skill; the job resumes its own command after job_resume_seconds (a new order of the
        // owner would start a new job); the skill of the new run counts from 0 again
        ended(j);
        await j.job.onResult('!mineOre', { ok: false, reason: 'interrupted', text: 'I mined 7 diamond of 28. I was interrupted.' }, { diamond: 7 });
        j.state.now += 60000;
        let release;
        j.state.hold = new Promise((resolve) => { release = resolve; });
        const ticked = j.job.tick();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(j.orders.length, 1, `the job resumed its command: ${JSON.stringify(j.orders)} ${j.job.status()}`);
        j.job.progress(3); // while the resumed command runs, as the mining pack reports
        assert.match(j.job.status(), /\b10 of 28 diamond\b/, j.job.status());
        j.state.hold = null;
        release();
        await ticked;
    });

    test('!stop: the leave text says the skill\'s last count, once', async () => {
        const j = makeJob();
        startMining(j);
        j.job.progress(2);
        j.job.onCommand('!stop', [], OWNER, '!stop');
        j.job.progress(7);
        ended(j);
        await j.job.onResult('!mineOre', { ok: false, reason: 'interrupted', text: 'I mined 7 diamond of 28. I was stopped.' }, { diamond: 9 });
        const leave = j.said.filter((t) => t.startsWith('I leave the mining'));
        assert.deepEqual(leave, ['I leave the mining at 7 of 28 diamond.'], JSON.stringify(j.said));
    });
});

describe('SPEC 4.4 P6: no cancel by the model, the rule', () => {
    test('a command of the model while the skill of the job runs: the answer of the spec', () => {
        const j = makeJob();
        startMining(j);
        j.job.progress(7);
        assert.equal(j.job.refusal('!goToSurface', 'model'), REFUSAL);
        assert.equal(j.job.refusal('!collectBlocks', 'model'), REFUSAL);
    });

    test('!stop, !stats, !inventory and a query pass', () => {
        const j = makeJob();
        startMining(j);
        j.job.progress(7);
        assert.equal(j.job.refusal('!stop', 'model'), null);
        assert.equal(j.job.refusal('!stats', 'model'), null);
        assert.equal(j.job.refusal('!inventory', 'model'), null);
        assert.equal(j.job.refusal('!nearbyBlocks', 'model', true), null);
    });

    test('the owner\'s typed command passes (today\'s behaviour), and a system order', () => {
        const j = makeJob();
        startMining(j);
        j.job.progress(7);
        assert.equal(j.job.refusal('!goToSurface', OWNER), null);
        assert.equal(j.job.refusal('!goToSurface', 'system'), null);
    });

    test('no skill of the job runs: the command of the model runs', async () => {
        const j = makeJob();
        assert.equal(j.job.refusal('!goToSurface', 'model'), null, 'no job');
        startMining(j);
        j.job.progress(7);
        ended(j);
        await j.job.onResult('!mineOre', { ok: true, reason: null, text: 'I mined 28 diamond.' }, { diamond: 28 });
        assert.equal(j.job.refusal('!goToSurface', 'model'), null, 'the job is done');
    });
});

describe('SPEC 4.4 P6: executeCommand does not run the model\'s command', () => {
    function agentWith(job) {
        const ran = [];
        const chat = [];
        const agent = {
            name: 'claude',
            job,
            running_commands: [],
            last_order: null,
            blocked_actions: [],
            bot: { username: 'claude', interrupt_code: false, modes: { isOn: () => false }, entity: { position: { x: 0, y: 64, z: 0 } } },
            actions: {
                executing: true,
                currentActionLabel: 'action:mineOre',
                async runAction(label, fn) { ran.push(label); return { success: true, message: 'ran', interrupted: false, timedout: false }; },
                async stop() { ran.push('stop'); },
            },
            openChat: (t) => chat.push(t),
            sayText: (t) => chat.push(t),
            history: { add: () => {} },
            isIdle: () => false,
        };
        return { agent, ran, chat };
    }

    test('the model picks !goToPlayer while the mining runs: not run, answered with the refusal, no chat', async () => {
        const j = makeJob();
        startMining(j);
        j.job.progress(7);
        const { agent, ran, chat } = agentWith(j.job);
        const cap = captureConsole();
        let answer;
        try {
            // the agent hands the model's command on as executeCommand(this, res, { typed: false })
            answer = await C.executeCommand(agent, `!goToPlayer("${OWNER}", 3)`, { typed: false });
        } finally {
            cap.restore();
        }
        assert.deepEqual(ran, [], 'the command did not run');
        assert.equal(answer, REFUSAL);
        assert.ok(!chat.includes(REFUSAL), 'a system line, no chat');
    });
});
