// Spec v0.1.4.16, F3 (engineer E2): a failed step of a round is skipped. On the job fake of xr_routine_round: step 2 of 3
// fails after its runs, the quiet line `Step 2 of "<name>" failed: <text>; I go on.` (sayQuiet, out of the history), the
// round goes on and is done; `runs` is 2 after two rounds (the round texts count the rounds started); when every step
// fails the round is failed (the routine counts a failure, the pause after three as today).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const J = await loadSrc('src/agent/job/index.js');
const R = await loadSrc('src/agent/routines/routines.js');
const T = await loadSrc('src/agent/routines/routine_texts.js');

const T0 = Date.UTC(2026, 11, 1, 12, 0, 0);
const TEXT = 'go to the chest, take 4 wheat, then harvest the wheat farm and store the wheat, every minute';
const PLAN = '!goToRememberedPlace("chest")\n!fetchItem("wheat", 4)\n!harvest("wheat_farm")';

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
    const args = m[2] ? m[2].split(/\s*,\s*/).map(a => (/^-?\d+$/.test(a) ? Number(a) : a.replace(/^"|"$/g, ''))) : [];
    return { name: `!${m[1]}`, args };
}

// The job and the routines wired as agent.js wires them; handlers: command -> { result, gain }.
function makeWorld({ handlers = {}, answers = [PLAN], busy = () => false } = {}) {
    const w = { t: T0, said: [], history: [], ran: [], prompts: [], handlers, answers: [...answers], inventory: {} };
    w.agent = {
        sayText: (text) => { w.said.push(text); w.history.push(text); },
        openChat: (text) => w.said.push(text),
        actions: { executing: false, currentActionLabel: '' },
        bot: { inventory: { items: () => Object.entries(w.inventory).map(([name, count]) => ({ name, count })) }, time: { timeOfDay: 1000 }, isSleeping: false, registry: { itemsByName: { wheat: {} } } },
        whereAmI: () => ({ underground: false }),
        _workStores: () => ({ chests: null, mines: null }),
        area_store: { list: () => [{ name: 'wheat_farm', kind: 'farm' }] },
        memory_bank: { store: { names: () => ['chest', 'my_bed'] } },
        rule_store: { list: () => [] },
        blocked_actions: [],
    };
    w.run = async (text, options) => {
        const { name, args } = parse(text);
        w.ran.push({ text, by: options?.by ?? 'system', history: options?.history });
        w.job.onCommand(name, args, options?.by ?? 'system', text);
        const handler = w.handlers[name];
        const out = handler ? await handler(args, w) : { result: { ok: true, reason: null, text: 'Done.' } };
        for (const [item, n] of Object.entries(out.gain ?? {})) {
            w.inventory[item] = (w.inventory[item] ?? 0) + n;
        }
        await w.job.onResult(name, out.result, out.gain ?? {});
        return out.result?.text;
    };
    const settings = { job_resume_seconds: 60, idle_jobs: [], idle_jobs_minutes: 15 };
    w.jobStore = new J.JobStore(null, { now: () => new Date(w.t) });
    w.job = J.createJob(w.agent, w.jobStore, {
        settings, now: () => w.t, executeCommand: (text, options) => w.run(text, options), askModel: async () => { throw new Error('never'); },
        routines: () => w.routines, isBusy: busy,
    });
    w.agent.job = w.job;
    w.routines = R.createRoutines(w.agent, new R.RoutineStore(null, { now: () => new Date(w.t) }), {
        settings, now: () => w.t, askModel: async (prompt) => { w.prompts.push(prompt); return w.answers.shift() ?? 'NONE'; },
    });
    w.agent.routines = w.routines;
    return w;
}

async function runRound(w, n = 16) {
    for (let i = 0; i < n; i++) {
        await w.job.tick();
        if (w.job.get()?.state !== 'running') {
            return;
        }
    }
}

const noChest = { '!fetchItem': () => ({ result: { ok: false, reason: 'no_chest', text: 'I know no chest with wheat.' } }) };

describe('a failed step is skipped (F3)', () => {
    test('step 2 of 3 fails twice, the quiet line, the round goes on and is done; nothing of it in the history', async () => {
        const w = makeWorld({ handlers: noChest });
        w.routines.remember('the chest run', TEXT);
        w.t += 61000;
        await runRound(w);
        assert.deepEqual(w.said, [
            'My plan for "the chest run": !goToRememberedPlace("chest"), !fetchItem("wheat", 4), !harvest("wheat_farm"). I start.',
            'I start the routine "the chest run", round 1.',
            'Step 1 of 3: !goToRememberedPlace("chest").',
            'Step 1 of 3 done: done.',
            'Step 2 of 3: !fetchItem("wheat", 4).',
            'Step 2 of 3: !fetchItem("wheat", 4).',
            'Step 2 of "the chest run" failed: I know no chest with wheat; I go on.',
            'Step 3 of 3: !harvest("wheat_farm").',
            'Step 3 of 3 done: done.',
            'Round 1 of "the chest run" is done.',
        ]);
        assert.equal(w.ran.filter(r => r.text === '!fetchItem("wheat", 4)').length, 2, 'the step ran its two runs');
        assert.ok(w.ran.every(r => r.by === 'system' && r.history === false), 'the steps are system orders out of the history');
        assert.deepEqual(w.history, [w.said[0]], 'only the plan line is noted; the quiet line is not');
        const job = w.job.get();
        assert.equal(job.state, 'done');
        assert.deepEqual(job.steps.map(s => s.state), ['done', 'skipped', 'done']);
        const r = w.routines.get('the chest run');
        assert.equal(r.rounds, 1);
        assert.equal(r.runs, 1);
        assert.equal(r.fails, 0);
        assert.equal(T.stepSkippedText(2, 'the chest run', 'I know no chest with wheat.'), 'Step 2 of "the chest run" failed: I know no chest with wheat; I go on.');
        assert.equal(T.stepSkippedText(1, 'x', 'no text'), 'Step 1 of "x" failed: no text; I go on.');
    });

    test('runs is 2 after two rounds and the texts say round 2; the step the chest run skipped runs again in round 2', async () => {
        const w = makeWorld({ handlers: noChest });
        w.routines.remember('the chest run', TEXT);
        w.t += 61000;
        await runRound(w);
        w.said.length = 0;
        w.t += 61000;
        await runRound(w);
        assert.equal(w.said[0], 'I start the routine "the chest run", round 2.');
        assert.equal(w.said[w.said.length - 1], 'Round 2 of "the chest run" is done.');
        assert.ok(w.said.includes('Step 2 of "the chest run" failed: I know no chest with wheat; I go on.'));
        const r = w.routines.get('the chest run');
        assert.equal(r.runs, 2);
        assert.equal(r.rounds, 2);
        assert.equal(JSON.parse(w.routines.json()).routines[0].runs, 2, 'the watch tool shows runs');
        assert.equal(w.job.get().round, 2);
    });

    test('every step fails: the round is failed, the routine counts the failure; the third in a row pauses it', async () => {
        const fail = (text) => () => ({ result: { ok: false, reason: 'x', text } });
        const w = makeWorld({ handlers: { '!goToRememberedPlace': fail('I know no place "chest".'), '!fetchItem': fail('I know no chest with wheat.'), '!harvest': fail('I know no farm "wheat_farm".') } });
        w.routines.remember('the chest run', TEXT);
        w.t += 61000;
        await runRound(w);
        assert.deepEqual(w.said.slice(2), [
            'Step 1 of 3: !goToRememberedPlace("chest").',
            'Step 1 of 3: !goToRememberedPlace("chest").',
            'Step 1 of "the chest run" failed: I know no place "chest"; I go on.',
            'Step 2 of 3: !fetchItem("wheat", 4).',
            'Step 2 of 3: !fetchItem("wheat", 4).',
            'Step 2 of "the chest run" failed: I know no chest with wheat; I go on.',
            'Step 3 of 3: !harvest("wheat_farm").',
            'Step 3 of 3: !harvest("wheat_farm").',
            'Step 3 of "the chest run" failed: I know no farm "wheat_farm"; I go on.',
            'I stop the routine "the chest run": I know no farm "wheat_farm".',
        ]);
        assert.equal(w.job.get().state, 'paused');
        let r = w.routines.get('the chest run');
        assert.equal(r.fails, 1);
        assert.equal(r.rounds, 0);
        assert.equal(r.runs, 1);
        for (let round = 2; round <= 3; round++) {
            w.t += 61000;
            await runRound(w);
        }
        r = w.routines.get('the chest run');
        assert.equal(r.state, 'paused');
        assert.equal(r.fails, 3);
        assert.equal(r.runs, 3);
        assert.equal(w.said[w.said.length - 1], 'I pause the routine "the chest run": !harvest("wheat_farm") failed three times. Say "do the routine the chest run" to try again.');
    });
});
