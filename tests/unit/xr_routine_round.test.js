// Spec v0.1.4.15 part R (engineer E2): a round as a job (SPEC 3.3, 3.4, 3.6): the job module's tenth kind through the
// validator, createJob with the routines wired in, driven as the glue drives it (onCommand before and onResult after every
// command, tick every 5 s, a fake clock, a fake model that answers the plan prompt): the plan once, the round's lines, the
// second round after `every`, idle_jobs after the routines, a round's failure and the pause after three, the stop, the
// forget, the condition, the restart and the model's refusal while a step runs.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const J = await loadSrc('src/agent/job/index.js');
const JL = await loadSrc('src/agent/job/job_logic.js');
const JT = await loadSrc('src/agent/job/job_texts.js');
const R = await loadSrc('src/agent/routines/routines.js');

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const FARM_TEXT = 'harvest the wheat farm and plant it again, then put the wheat in the chest by the door, every minute';
const PLAN = '!harvest("farm")\n!plant("wheat_seeds", "farm")\n!putInChest("wheat", 64)';
const PLAN_LINE = 'My plan for "the farm": !harvest("farm"), !plant("wheat_seeds", "farm"), !putInChest("wheat", 64). I start.';

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

function parse(text) {
    const m = text.match(/^!(\w+)(?:\((.*)\))?$/);
    const args = m[2] ? m[2].split(/\s*,\s*/).map(a => (/^-?\d+$/.test(a) ? Number(a) : a === 'true' || a === 'false' ? a === 'true' : a.replace(/^"|"$/g, ''))) : [];
    return { name: `!${m[1]}`, args };
}

/**
 * A world: a fake agent and clock, the job and the routines wired as agent.js wires them, and the glue. handlers:
 * command name -> (args, world) -> { result, gain }; answers: the answers of the fake model, in order.
 */
function makeWorld({ handlers = {}, answers = [], settings = {}, inventory = {} } = {}) {
    const w = { t: T0, said: [], history: [], ran: [], prompts: [], stopped: 0, inventory: { ...inventory }, handlers, answers: [...answers] };
    w.agent = {
        // sayText notes the line in the history and says it; openChat only says it (the lines of a round, SPEC rule 30)
        sayText: (text) => { w.said.push(text); w.history.push(text); },
        openChat: (text) => w.said.push(text),
        actions: { executing: false, currentActionLabel: '' },
        bot: { inventory: { items: () => Object.entries(w.inventory).map(([name, count]) => ({ name, count })) }, time: { timeOfDay: 1000 }, isSleeping: false,
            registry: { itemsByName: { torch: {}, wheat: {}, wheat_seeds: {}, bread: {} } } },
        whereAmI: () => ({ underground: false }),
        _workStores: () => ({ chests: null, mines: null }),
        area_store: { list: () => [{ name: 'farm', kind: 'farm' }] },
        memory_bank: { store: { names: () => ['spot'] } },
        rule_store: { list: () => [{ id: 1, text: 'never open the pens' }] },
        blocked_actions: [],
    };
    w.run = async (text, options) => {
        const { name, args } = parse(text);
        const by = options?.by ?? 'system';
        w.ran.push({ text, by });
        w.job.onCommand(name, args, by, text);
        const handler = w.handlers[name];
        const out = handler ? await handler(args, w) : { result: { ok: true, reason: null, text: 'Done.' } };
        for (const [item, n] of Object.entries(out.gain ?? {})) {
            w.inventory[item] = (w.inventory[item] ?? 0) + n;
        }
        await w.job.onResult(name, out.result, out.gain ?? {});
        return typeof out.result === 'object' && out.result !== null ? out.result.text : out.result;
    };
    const all = { job_resume_seconds: 60, idle_jobs: [], idle_jobs_minutes: 15, ...settings };
    w.jobStore = new J.JobStore(null, { now: () => new Date(w.t) });
    w.job = J.createJob(w.agent, w.jobStore, {
        settings: all,
        now: () => w.t,
        executeCommand: (text, options) => w.run(text, options),
        askModel: async () => { throw new Error('the job never plans here'); },
        routines: () => w.routines,
    });
    w.agent.job = w.job;
    w.store = new R.RoutineStore(null, { now: () => new Date(w.t) });
    w.routines = R.createRoutines(w.agent, w.store, {
        settings: all,
        now: () => w.t,
        askModel: async (prompt) => {
            w.prompts.push(prompt);
            const answer = w.answers.shift();
            return answer === undefined ? 'NONE' : answer;
        },
        stopAction: async () => { w.stopped++; },
    });
    w.agent.routines = w.routines;
    // !stop as the owner types it
    w.stop = async () => {
        w.job.onCommand('!stop', [], 'player', '!stop');
        w.stopped++;
        await w.job.onResult('!stop', 'Agent stopped.', {});
    };
    return w;
}

// Ticks until the round ends (the job is no longer running) or n ticks passed.
async function runRound(w, n = 12) {
    for (let i = 0; i < n; i++) {
        await w.job.tick();
        if (w.job.get()?.state !== 'running') {
            return;
        }
    }
}

describe('SPEC 3.3: the tenth kind through the validator', () => {
    test('JobStore accepts kind routine with its routine and round; without the routine it is no job; the nine kinds stay', () => {
        const store = new J.JobStore(null, { now: () => new Date(T0) });
        assert.equal(JL.ROUTINE_KIND, 'routine');
        assert.equal(JL.JOB_KINDS.length, 9, 'JOB_KINDS keeps the nine command kinds');
        const saved = store.set({ kind: 'routine', command: '!doRoutine("the farm")', routine: 'the farm', round: 5, words: 'the routine "the farm"',
            steps: [{ command: '!harvest("farm")', check: { item: null, count: null }, state: 'todo' }] });
        assert.equal(saved.kind, 'routine');
        assert.equal(saved.routine, 'the farm');
        assert.equal(saved.round, 5);
        assert.equal(saved.wanted, null);
        assert.equal(saved.state, 'running');
        assert.equal(store.set({ kind: 'routine', command: '!doRoutine("x")' }), null, 'no routine name: no job');
        assert.equal(store.set({ kind: 'routine', command: '!doRoutine("x")', routine: 'x' }).round, 1, 'round 1 without one');
        assert.equal(store.set({ kind: 'dance', command: '!dance' }), null);
        assert.equal('routine' in store.set(JL.jobOf('!mineOre', ['iron', 8])), false, 'another kind carries no routine');
    });

    test('isDone and resumeCommand for the kind: every step done; the next step', () => {
        const step = (command, state) => ({ command, check: { item: null, count: null }, state });
        const job = { kind: 'routine', routine: 'x', steps: [step('!a', 'done'), step('!b', 'todo'), step('!c', 'todo')] };
        assert.equal(JL.isDone(job), false);
        assert.equal(JL.resumeCommand(job), '!b');
        assert.equal(JL.isDone({ ...job, steps: job.steps.map(s => ({ ...s, state: 'done' })) }), true);
        assert.equal(JL.resumeCommand({ ...job, steps: job.steps.map(s => ({ ...s, state: 'done' })) }), null);
        assert.equal(JL.isDone({ ...job, steps: [] }), false);
        // v0.1.4.16 (F3): a step that failed after its runs is skipped; the round is done when every step is done or
        // skipped and at least one is done, failed when every step was skipped
        assert.equal(JL.isDone({ ...job, steps: [step('!a', 'done'), step('!b', 'skipped')] }), true);
        assert.equal(JL.isDone({ ...job, steps: [step('!a', 'skipped'), step('!b', 'skipped')] }), false);
        assert.equal(JL.isDone({ ...job, steps: [step('!a', 'skipped'), step('!b', 'todo')] }), false);
        assert.equal(JL.isDone({ ...job, steps: [step('!a', 'done'), step('!b', 'failed')] }), false, 'failed is no state of a round\'s step');
        const store = new J.JobStore(null, { now: () => new Date(T0) });
        assert.equal(store.set({ kind: 'routine', command: '!doRoutine("x")', routine: 'x', steps: [step('!a', 'skipped')] }).steps[0].state, 'skipped', 'the store keeps skipped');
    });

    test('the texts of the job for the kind: the status line, busy, leave, the restart', () => {
        const job = { kind: 'routine', routine: 'the farm', round: 5, words: 'the routine "the farm"', state: 'running', wanted: null, args: ['the farm'],
            steps: [{ command: '!a', check: {}, state: 'done' }, { command: '!b', check: {}, state: 'todo' }, { command: '!c', check: {}, state: 'todo' }] };
        assert.equal(JT.statusText(job), 'Job: the routine "the farm", step 2 of 3.');
        assert.equal(JT.busyText(job), 'The routine "the farm" runs. Say !stop first.');
        assert.equal(JT.leaveText(job), 'I leave the routine "the farm".');
        assert.equal(JT.restartText(job), 'I was doing the routine "the farm", round 5. I go on.');
        assert.equal(JT.lastJobText({ ...job, state: 'left' }), 'Last job: the routine "the farm", left.');
    });
});

describe('SPEC 3.3 and 3.4: a round as a job, from the tick', () => {
    test('a remembered routine runs when nothing runs: the plan once, the plan line, the start, the steps, the done line', async () => {
        const w = makeWorld({ answers: [PLAN] });
        const remembered = w.routines.remember('the farm', FARM_TEXT);
        assert.equal(remembered.text, `I remember the routine "the farm": ${FARM_TEXT}. I do it when I have nothing else to do, every minute.`);
        assert.deepEqual(await w.job.tick(), { ok: true, reason: 'wait', text: '' }, 'the start counts as an order: the bot waits job_resume_seconds first');
        assert.equal(w.prompts.length, 0);
        w.t += 61000;
        await runRound(w);
        assert.equal(w.prompts.length, 1, 'one plan prompt');
        assert.match(w.prompts[0], /^You plan the steps of a Minecraft bot for a standing task the player described in his words\.\n/);
        assert.ok(w.prompts[0].includes('RULES FROM THE PLAYER'), 'the rules of the player are in the prompt');
        assert.ok(w.prompts[0].includes('\nThe places the bot knows: the areas farm (farm); the places spot.\n'), 'the areas and the remembered places');
        assert.deepEqual(w.said, [
            PLAN_LINE,
            'I start the routine "the farm", round 1.',
            'Step 1 of 3: !harvest("farm").',
            'Step 1 of 3 done: done.',
            'Step 2 of 3: !plant("wheat_seeds", "farm").',
            'Step 2 of 3 done: done.',
            'Step 3 of 3: !putInChest("wheat", 64).',
            'Step 3 of 3 done: done.',
            'Round 1 of "the farm" is done.',
        ]);
        assert.deepEqual(w.ran.map(r => [r.text, r.by]), [['!harvest("farm")', 'system'], ['!plant("wheat_seeds", "farm")', 'system'], ['!putInChest("wheat", 64)', 'system']], 'the steps are system orders');
        assert.deepEqual(w.history, [PLAN_LINE], 'the plan line is noted once; the lines of the round stay out of the history (rule 30: no memory summary from a round)');
        const job = w.job.get();
        assert.equal(job.kind, 'routine');
        assert.equal(job.state, 'done');
        assert.equal(job.routine, 'the farm');
        assert.equal(job.round, 1);
        assert.equal(job.by, 'player');
        assert.equal(job.command, '!doRoutine("the farm")');
        const r = w.routines.get('the farm');
        assert.equal(r.rounds, 1);
        assert.equal(r.fails, 0);
        assert.equal(r.lastRound, new Date(w.t).toISOString());
        assert.deepEqual(r.steps.map(s => s.command), PLAN.split('\n'), 'the plan is saved with the routine');
        assert.equal(w.routines.list().text, `My routines: the farm (every minute, 1 round, last ${new Date(w.t).getHours().toString().padStart(2, '0')}:${new Date(w.t).getMinutes().toString().padStart(2, '0')}).`);
    });

    test('the second round after `every` minutes, with no plan call; before that the bot waits', async () => {
        const w = makeWorld({ answers: [PLAN] });
        w.routines.remember('the farm', FARM_TEXT);
        w.t += 61000;
        await runRound(w);
        const t1 = w.t;
        w.said.length = 0;
        w.t = t1 + 59000;
        assert.deepEqual(await w.job.tick(), { ok: true, reason: 'wait', text: '' });
        w.t = t1 + 61000;
        await runRound(w);
        assert.equal(w.prompts.length, 1, 'no second plan prompt');
        assert.equal(w.said[0], 'I start the routine "the farm", round 2.');
        assert.equal(w.said[w.said.length - 1], 'Round 2 of "the farm" is done.');
        assert.ok(!w.said.some(l => l.startsWith('My plan')), 'no second plan line');
        assert.equal(w.routines.get('the farm').rounds, 2);
        assert.equal(w.job.get().round, 2);
    });

    test('the standing list runs only when no routine is due; a routine that is due goes first', async () => {
        const w = makeWorld({ answers: [PLAN], settings: { idle_jobs: ['!farmCycle("farm")'], idle_jobs_minutes: 1 } });
        w.routines.remember('the farm', FARM_TEXT);
        w.t += 61000;
        await runRound(w);
        assert.equal(w.said[0], PLAN_LINE, 'the routine ran first');
        assert.ok(!w.ran.some(r => r.text === '!farmCycle("farm")'));
        w.said.length = 0;
        w.t += 30000;
        await w.job.tick();
        assert.deepEqual(w.said, ['I take the next of my list: !farmCycle("farm").'], 'no routine due: the standing list');
        assert.equal(w.ran[w.ran.length - 1].text, '!farmCycle("farm")');
    });

    test('a round of another routine is refused while a job runs; `!doRoutine` answers the busy text', async () => {
        const w = makeWorld({ answers: [PLAN] });
        w.routines.remember('the farm', FARM_TEXT);
        w.job.onCommand('!mineOre', ['iron', 16], 'player', '!mineOre("iron", 16)');
        const out = await w.routines.doNow('the farm');
        assert.deepEqual(out, { ok: false, reason: 'busy', text: 'The mining runs, 0 of 16 iron. Say !stop first.' });
        w.t += 61000;
        await w.job.tick();
        assert.equal(w.prompts.length, 0, 'the tick never starts a round while a job runs');
    });
});

describe('SPEC 3.3 and 3.6: the failures, the pause, the stop, the forget', () => {
    const failing = { '!harvest': () => ({ result: { ok: false, reason: 'no_farm', text: 'I found no farm "farm".' } }) };

    // v0.1.4.16 (F3): a step that failed after its runs is skipped with the quiet line and the round goes on; the round is
    // done when every step is done or skipped and at least one is done (before: one failed step ended the round)
    test('a failed step runs once more, then is skipped with the quiet line; the round goes on and is done', async () => {
        const w = makeWorld({ answers: [PLAN], handlers: failing });
        w.routines.remember('the farm', FARM_TEXT);
        w.t += 61000;
        await runRound(w);
        assert.deepEqual(w.said, [
            PLAN_LINE,
            'I start the routine "the farm", round 1.',
            'Step 1 of 3: !harvest("farm").',
            'Step 1 of 3: !harvest("farm").',
            'Step 1 of "the farm" failed: I found no farm "farm"; I go on.',
            'Step 2 of 3: !plant("wheat_seeds", "farm").',
            'Step 2 of 3 done: done.',
            'Step 3 of 3: !putInChest("wheat", 64).',
            'Step 3 of 3 done: done.',
            'Round 1 of "the farm" is done.',
        ]);
        assert.equal(w.ran.filter(r => r.text === '!harvest("farm")').length, 2, 'stepRuns 2');
        assert.deepEqual(w.history, [PLAN_LINE], 'the quiet line stays out of the history');
        const job = w.job.get();
        assert.equal(job.state, 'done');
        assert.equal(job.steps[0].state, 'skipped');
        const r = w.routines.get('the farm');
        assert.equal(r.fails, 0);
        assert.equal(r.rounds, 1);
        assert.equal(r.runs, 1);
        assert.equal(r.state, 'active');
        assert.ok(Array.isArray(r.steps), 'the plan is kept');
        assert.equal(w.prompts.length, 1, 'no plan call for the failed step');
    });

    // v0.1.4.16 (F3): a round fails only when every step was skipped; `runs` counts every round started, so the round after
    // three failed ones is round 4
    const allFailing = {
        '!harvest': () => ({ result: { ok: false, reason: 'no_farm', text: 'I found no farm "farm".' } }),
        '!plant': () => ({ result: { ok: false, reason: 'no_farm', text: 'I found no farm "farm".' } }),
        '!putInChest': () => ({ result: { ok: false, reason: 'no_chest', text: 'I know no chest.' } }),
    };

    test('three rounds with every step skipped pause the routine with the pause text; `!doRoutine` unpauses and replans', async () => {
        const w = makeWorld({ answers: [PLAN, PLAN], handlers: { ...allFailing } });
        w.routines.remember('the farm', FARM_TEXT);
        for (let round = 1; round <= 3; round++) {
            w.t += 61000;
            w.said.length = 0;
            await runRound(w);
            assert.ok(w.said.includes(`I start the routine "the farm", round ${round}.`), `round ${round}: ${w.said.join(' | ')}`);
            assert.equal(w.said[w.said.length - 2], 'Step 3 of "the farm" failed: I know no chest; I go on.', `round ${round}`);
            if (round < 3) {
                assert.equal(w.said[w.said.length - 1], 'I stop the routine "the farm": I know no chest.', `round ${round}: every step skipped is a failed round`);
            }
        }
        assert.equal(w.said[w.said.length - 1], 'I pause the routine "the farm": !putInChest("wheat", 64) failed three times. Say "do the routine the farm" to try again.');
        assert.ok(!w.said.includes('I stop the routine "the farm": I know no chest.'), 'the third round says the pause line, not the stop line');
        const paused = w.routines.get('the farm');
        assert.equal(paused.state, 'paused');
        assert.equal(paused.fails, 3);
        assert.equal(paused.runs, 3);
        assert.equal(paused.steps, null);
        assert.equal(w.routines.list().text, 'My routines: the farm (every minute, paused).'.replace('paused)', `last ${hhmm(w.t)}, paused)`));
        w.t += 3600000;
        w.said.length = 0;
        assert.deepEqual(await w.job.tick(), { ok: true, reason: 'wait', text: '' }, 'a paused routine never runs by itself');
        w.handlers['!harvest'] = () => ({ result: { ok: true, reason: null, text: 'I harvested 14 wheat and planted 14 again.' } });
        const out = await w.routines.doNow('the farm');
        assert.deepEqual(out, { ok: true, reason: 'round', text: 'I start the routine "the farm", round 4.', job: w.job.get() });
        assert.equal(w.prompts.length, 2, 'one replan');
        assert.deepEqual(w.said, [PLAN_LINE], 'the plan line is said; the start line is the answer of the command');
        const r = w.routines.get('the farm');
        assert.equal(r.state, 'active');
        assert.equal(r.fails, 0);
        await runRound(w);
        assert.equal(w.said[w.said.length - 1], 'Round 4 of "the farm" is done.', 'one step done, two skipped: the round is done');
        assert.equal(w.routines.get('the farm').rounds, 1);
        assert.equal(w.routines.get('the farm').runs, 4);
    });

    test('a plan the check refuses, and NONE, pause the routine with the texts of 3.6', async () => {
        const w = makeWorld({ answers: ['!harvest("farm")\n!newAction("dig a hole")', 'NONE'] });
        w.routines.remember('the farm', FARM_TEXT);
        w.routines.remember('the hole', 'dig a hole in the garden');
        w.t += 61000;
        assert.deepEqual(await w.job.tick(), { ok: false, reason: 'bad_plan', text: 'I could not plan the routine "the farm": the command !newAction is not one I may use. Say it differently.' });
        assert.equal(w.said[w.said.length - 1], 'I could not plan the routine "the farm": the command !newAction is not one I may use. Say it differently.');
        assert.equal(w.routines.get('the farm').state, 'paused');
        assert.equal(w.routines.get('the farm').steps, null);
        assert.equal(w.job.get(), null, 'no job was made');
        assert.deepEqual(await w.job.tick(), { ok: false, reason: 'no_plan', text: 'I cannot do the routine "the hole" with my commands. Say it differently.' });
        assert.equal(w.routines.get('the hole').state, 'paused');
        assert.equal(w.prompts.length, 2);
        w.t += 61000;
        assert.deepEqual(await w.job.tick(), { ok: true, reason: 'wait', text: '' }, 'both paused: nothing runs, the model is not asked again');
        assert.equal(w.prompts.length, 2);
    });

    test('"stop" ends the round as any job (left, the leave line); the routine stays active and lists the round left', async () => {
        const w = makeWorld({ answers: [PLAN] });
        w.routines.remember('the farm', FARM_TEXT);
        const out = await w.routines.doNow('the farm');
        assert.equal(out.text, 'I start the routine "the farm", round 1.');
        assert.equal(w.job.get().state, 'running');
        w.handlers['!harvest'] = async (args, world) => {
            // the owner types !stop while the step runs; the model is refused meanwhile (as for any job)
            assert.equal(world.job.refusal('!goToPlayer', 'model'), 'The routine "the farm" runs. Say !stop first.');
            assert.equal(world.job.refusal('!stop', 'model'), null);
            await world.stop();
            return { result: undefined };
        };
        await w.job.tick();
        assert.deepEqual(w.said, [PLAN_LINE, 'Step 1 of 3: !harvest("farm").', 'I leave the routine "the farm".']);
        assert.equal(w.job.get().state, 'left');
        const r = w.routines.get('the farm');
        assert.equal(r.state, 'active');
        assert.equal(r.rounds, 0);
        assert.equal(r.fails, 0);
        assert.equal(r.lastRound, new Date(w.t).toISOString());
        assert.match(w.routines.list().text, /^My routines: the farm \(every minute, last \d\d:\d\d\)\.$/);
        assert.equal(w.job.status(), 'Last job: the routine "the farm", left.');
    });

    test('`!forgetRoutine` during a round ends it (left), stops the running step and removes the routine', async () => {
        const w = makeWorld({ answers: [PLAN] });
        w.routines.remember('the farm', FARM_TEXT);
        await w.routines.doNow('the farm');
        let forgot = null;
        w.handlers['!harvest'] = async (args, world) => {
            forgot = await world.routines.forget('the farm');
            return { result: undefined };
        };
        await w.job.tick();
        assert.deepEqual(forgot, { ok: true, reason: 'forgot', text: 'I forgot the routine "the farm".' });
        assert.equal(w.stopped, 1, 'the running step was stopped');
        assert.equal(w.job.get().state, 'left');
        assert.equal(w.routines.get('the farm'), null);
        assert.deepEqual(w.routines.list(), { ok: true, reason: 'list', text: 'I have no routines.' });
        assert.deepEqual(await w.routines.forget('the farm'), { ok: false, reason: 'unknown', text: 'I know no routine "the farm".' });
        assert.equal(w.stopped, 1, 'nothing more to stop');
    });

    test('a new job of the owner replaces a running round: the leave line, the routine notes the round as left', async () => {
        const w = makeWorld({ answers: [PLAN] });
        w.routines.remember('the farm', FARM_TEXT);
        await w.routines.doNow('the farm');
        w.job.onCommand('!mineOre', ['iron', 8], 'player', '!mineOre("iron", 8)');
        assert.equal(w.said[w.said.length - 1], 'I leave the routine "the farm".');
        assert.equal(w.job.get().kind, 'mineOre');
        assert.equal(w.routines.get('the farm').lastRound, new Date(w.t).toISOString());
    });
});

describe('SPEC 3.4 and 3.6: the condition, the texts of the commands, the restart', () => {
    test('a routine with a condition runs only while the bag holds fewer than N; `!doRoutine` says it waits', async () => {
        const w = makeWorld({ answers: ['!craftSupplies("torch", 32)'], inventory: { torch: 40 } });
        const remembered = w.routines.remember('torches', 'make torches when fewer than 32 torches');
        assert.equal(remembered.text, 'I remember the routine "torches": make torches when fewer than 32 torches. I do it when I have nothing else to do, every 15 minutes, when fewer than 32 torch.');
        assert.deepEqual(await w.routines.doNow('torches'), { ok: false, reason: 'waits', text: 'The routine "torches" waits: I have 40 torch.' });
        w.t += 61000;
        assert.deepEqual(await w.job.tick(), { ok: true, reason: 'wait', text: '' });
        assert.equal(w.prompts.length, 0);
        w.inventory.torch = 10;
        w.handlers['!craftSupplies'] = () => ({ result: { ok: true, reason: null, text: 'Made 32 torches.' }, gain: { torch: 32 } });
        await runRound(w);
        assert.equal(w.prompts.length, 1);
        assert.equal(w.said[w.said.length - 1], 'Round 1 of "torches" is done.');
        assert.equal(w.routines.list().text, `My routines: torches (when fewer than 32 torch, 1 round, last ${hhmm(w.t)}).`);
    });

    test('the texts of remember: known, full, the limits of the name and the text', async () => {
        const w = makeWorld();
        w.routines.remember('the farm', FARM_TEXT);
        assert.deepEqual(w.routines.remember('The Farm', 'again'), { ok: false, reason: 'known', text: 'I know that routine already as "the farm".' });
        for (let i = 2; i <= 12; i++) w.routines.remember(`r${i}`, 'x');
        assert.deepEqual(w.routines.remember('r13', 'x'), { ok: false, reason: 'full', text: 'I have 12 routines already; forget one first.' });
        assert.equal(w.routines.remember('', 'x').reason, 'bad_name');
        assert.equal(w.routines.remember('x', 'y'.repeat(401)).reason, 'bad_text');
        assert.deepEqual(await w.routines.doNow('nope'), { ok: false, reason: 'unknown', text: 'I know no routine "nope".' });
    });

    test('at a restart a running round says that it goes on; its steps run on from the next todo one', async () => {
        const w = makeWorld({ answers: [PLAN] });
        w.routines.remember('the farm', FARM_TEXT);
        await w.routines.doNow('the farm');
        await w.job.tick(); // step 1 done
        assert.equal(w.job.get().steps[0].state, 'done');
        // the process restarts: a new job on the same store
        const again = J.createJob(w.agent, w.jobStore, { settings: { job_resume_seconds: 60 }, now: () => w.t, executeCommand: (text, options) => w.run(text, options), routines: () => w.routines });
        w.job = again;
        assert.deepEqual(again.onRestart(), { ok: true, reason: 'running', text: 'I was doing the routine "the farm", round 1. I go on.' });
        assert.equal(again.describe(), 'Job: the routine "the farm", step 2 of 3.');
        w.t += 61000;
        w.said.length = 0;
        await runRound(w);
        assert.deepEqual(w.said, ['Step 2 of 3: !plant("wheat_seeds", "farm").', 'Step 2 of 3 done: done.', 'Step 3 of 3: !putInChest("wheat", 64).', 'Step 3 of 3 done: done.', 'Round 1 of "the farm" is done.']);
        assert.equal(w.routines.get('the farm').rounds, 1);
    });

    test('the watch tool\'s JSON and the bind of the store', () => {
        const w = makeWorld();
        w.routines.remember('the farm', FARM_TEXT);
        const json = JSON.parse(w.routines.json());
        assert.equal(json.routines.length, 1);
        assert.equal(json.routines[0].name, 'the farm');
        assert.equal(json.routines[0].steps, null);
        assert.equal(w.routines.bind(null), 0, 'bound to no file: the memory routines belonged to no world');
        assert.deepEqual(w.routines.all(), []);
    });
});

function hhmm(ms) {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
