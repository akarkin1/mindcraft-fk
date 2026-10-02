// Spec v0.1.4.10 part J (engineer E1): the pure decisions of the job, src/agent/job/job_logic.js (I1, I2,
// section 5), with a fake clock.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/job/job_logic.js');

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const running = (extra = {}) => ({ ...L.jobOf('!mineOre', ['iron', 16]), ...extra });

describe('jobOf', () => {
    test('every command of JOB_COMMANDS is a job, running, with its words', () => {
        const args = {
            mineOre: ['iron', 16, false], farmCycle: ['farm'], chopTrees: [8, ''], getTool: ['pickaxe', 'stone'],
            craftSupplies: ['torch', 32], collectBlocks: ['stone', 10], collectPassedOre: ['coal', 8], harvest: [''], plant: ['wheat_seeds', ''],
        };
        assert.deepEqual([...L.JOB_KINDS].sort(), Object.keys(args).sort());
        for (const kind of L.JOB_KINDS) {
            const job = L.jobOf(`!${kind}`, args[kind]);
            assert.ok(job, kind);
            assert.equal(job.kind, kind);
            assert.equal(job.state, 'running');
            assert.equal(job.version, 1);
            assert.equal(job.words, L.JOB_COMMANDS[kind].words);
            assert.deepEqual(job.steps, []);
            assert.equal(job.plans, 0);
        }
    });

    test('a job with a count has wanted and got 0; without one both are null', () => {
        const mine = L.jobOf('!mineOre', ['iron', 16, false]);
        assert.equal(mine.wanted, 16);
        assert.equal(mine.got, 0);
        assert.equal(mine.command, '!mineOre("iron", 16)');
        const farm = L.jobOf('farmCycle', ['farm']);
        assert.equal(farm.wanted, null);
        assert.equal(farm.got, null);
    });

    test('the text of the order and who gave it are kept', () => {
        const job = L.jobOf('!mineOre', ['iron', 8], { by: 'model', text: '!mineOre("iron", 8)', now: '2026-10-01T12:00:00.000Z' });
        assert.equal(job.by, 'model');
        assert.equal(job.command, '!mineOre("iron", 8)');
        assert.equal(job.started, '2026-10-01T12:00:00.000Z');
        assert.equal(L.jobOf('!mineOre', ['iron', 8], { by: 'Steve' }).by, 'player');
    });

    test('!chopTrees takes its args in either order', () => {
        assert.deepEqual(L.jobOf('!chopTrees', ['oak', 4]).args, [4, 'oak']);
        assert.equal(L.jobOf('!chopTrees', ['oak', 4]).wanted, 4);
    });

    test('every errand, !stop and any other command are no job', () => {
        for (const name of L.ERRAND_COMMANDS) {
            assert.equal(L.jobOf(name, []), null, name);
            assert.equal(L.isErrand(name), true, name);
        }
        assert.equal(L.jobOf('!stop', []), null);
        assert.equal(L.jobOf('!goToMine', ['iron']), null);
        assert.equal(L.jobOf('', []), null);
        assert.equal(L.jobOf(null, []), null);
    });
});

test('endsJob is true for !stop and !endGoal only', () => {
    assert.equal(L.endsJob('!stop'), true);
    assert.equal(L.endsJob('endGoal'), true);
    assert.equal(L.endsJob('!followPlayer'), false);
    assert.equal(L.endsJob('!mineOre'), false);
    assert.equal(L.endsJob(undefined), false);
});

describe('shouldResume', () => {
    const base = { now: T0 + 60000, lastOrderAt: T0, actionRunning: false, sleeping: false, night: false, resumeSeconds: 60 };

    test('true after resumeSeconds without an order and nothing running', () => {
        assert.equal(L.shouldResume({ ...base, job: running() }), true);
        assert.equal(L.shouldResume({ ...base, job: running(), lastOrderAt: null }), true);
    });

    test('false before resumeSeconds', () => {
        assert.equal(L.shouldResume({ ...base, job: running(), now: T0 + 59999 }), false);
        assert.equal(L.shouldResume({ ...base, job: running(), now: T0 + 30000, resumeSeconds: 30 }), true);
        assert.equal(L.shouldResume({ ...base, job: running(), now: T0 + 29000, resumeSeconds: 30 }), false);
    });

    test('false without a running job', () => {
        assert.equal(L.shouldResume({ ...base, job: null }), false);
        for (const state of ['paused', 'done', 'left']) {
            assert.equal(L.shouldResume({ ...base, job: running({ state }) }), false, state);
        }
    });

    test('false while an action runs or the bot sleeps', () => {
        assert.equal(L.shouldResume({ ...base, job: running(), actionRunning: true }), false);
        assert.equal(L.shouldResume({ ...base, job: running(), sleeping: true }), false);
    });

    test('at night the shelter reflex wins; without it only the mining waits on the surface', () => {
        const farm = L.jobOf('!farmCycle', ['farm']);
        assert.equal(L.shouldResume({ ...base, job: farm, night: true }), false);
        assert.equal(L.shouldResume({ ...base, job: farm, night: true, nightShelter: true }), false);
        assert.equal(L.shouldResume({ ...base, job: farm, night: true, nightShelter: false }), true);
        assert.equal(L.shouldResume({ ...base, job: running(), night: true, nightShelter: false, underground: false }), false);
        assert.equal(L.shouldResume({ ...base, job: running(), night: true, nightShelter: false, underground: true }), true);
        assert.equal(L.shouldResume({ ...base, job: running(), night: false, underground: false }), true);
    });
});

describe('resumeCommand', () => {
    test('the remaining count', () => {
        assert.equal(L.resumeCommand(running({ got: 6 })), '!mineOre("iron", 10)');
        assert.equal(L.resumeCommand(running({ got: 15 })), '!mineOre("iron", 1)');
        assert.equal(L.resumeCommand({ ...L.jobOf('!craftSupplies', ['torch', 32]), got: 8 }), '!craftSupplies("torch", 24)');
        assert.equal(L.resumeCommand({ ...L.jobOf('!chopTrees', ['oak', 8]), got: 3 }), '!chopTrees(5, "oak")');
    });

    test('a resumed mining never digs a new mine', () => {
        assert.equal(L.resumeCommand({ ...L.jobOf('!mineOre', ['iron', 8, true]), got: 2 }), '!mineOre("iron", 6)');
    });

    test('a job without a count runs its command again', () => {
        assert.equal(L.resumeCommand(L.jobOf('!farmCycle', ['farm'], { text: '!farmCycle("farm")' })), '!farmCycle("farm")');
        assert.equal(L.resumeCommand(L.jobOf('!getTool', ['pickaxe', 'stone'])), '!getTool("pickaxe", "stone")');
    });

    test('null for no job', () => {
        assert.equal(L.resumeCommand(null), null);
    });
});

describe('progress and isDone', () => {
    test('got grows by the gain of the item of the job', () => {
        const job = running({ got: 6 });
        assert.equal(L.progress(job, { raw_iron: 4, cobblestone: 30 }).got, 10);
        assert.equal(L.progress(job, (item) => (item === 'raw_iron' ? 3 : 0)).got, 9);
        assert.equal(L.progress(job, 2).got, 8);
        assert.equal(L.progress(job, { raw_iron: -5 }).got, 6);
        assert.equal(L.progress(job, null).got, 6);
        assert.equal(job.got, 6, 'a copy');
    });

    test('any log counts for a job of logs of any kind', () => {
        const job = L.jobOf('!chopTrees', [8]);
        assert.equal(L.progress(job, { oak_log: 3, birch_log: 2, oak_sapling: 4 }).got, 5);
        assert.equal(L.progress(L.jobOf('!chopTrees', [8, 'oak']), { oak_log: 3, birch_log: 2 }).got, 3);
    });

    test('a job without a count keeps got null', () => {
        assert.equal(L.progress(L.jobOf('!farmCycle', ['']), { wheat: 10 }).got, null);
    });

    test('done at the count or when the skill said done', () => {
        assert.equal(L.isDone(running({ got: 16 })), true);
        assert.equal(L.isDone(running({ got: 15 })), false);
        assert.equal(L.isDone(running({ got: 2, skillDone: true })), true);
        assert.equal(L.isDone(L.jobOf('!farmCycle', [''])), false);
        assert.equal(L.isDone(null), false);
    });
});

describe('blockerOf', () => {
    test('the reasons of the spec', () => {
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'no_pickaxe', text: 'I have no pickaxe left.' }), { kind: 'no_pickaxe', item: 'pickaxe' });
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'no_tool', text: 'I have no axe.' }), { kind: 'no_tool', item: 'axe' });
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'no_item', text: 'I have no ladder.' }), { kind: 'no_item', item: 'ladder' });
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'no_supplies', text: 'Something is missing.' }), { kind: 'no_item', item: null });
    });

    test('the texts of the spec', () => {
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'error', text: 'I have no torches.' }), { kind: 'no_torches', item: 'torch' });
        assert.deepEqual(L.blockerOf('I have no torches, so the tunnel stays dark.'), { kind: 'no_torches', item: 'torch' });
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'missing', text: 'I need 2 stick for a wooden_pickaxe and have none.' }), { kind: 'no_wood', item: 'stick' });
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'missing', text: 'I need 3 iron_ingot for an iron_pickaxe and have none.' }), { kind: 'no_item', item: 'iron_ingot' });
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'missing', text: 'I need 4 oak_planks for 8 torch and have 1.' }), { kind: 'no_wood', item: 'oak_planks' });
        assert.deepEqual(L.blockerOf({ ok: false, reason: 'no_food', text: 'I carry no food and know no chest with food.' }), { kind: 'no_item', item: 'food' });
    });

    test('the mining pack without a good pickaxe', () => {
        const r = { ok: false, reason: 'pickaxe', text: 'I cannot mine iron. I need a stone pickaxe and have no pickaxe.' };
        assert.deepEqual(L.blockerOf(r), { kind: 'no_pickaxe', item: 'stone_pickaxe' });
    });

    test('null for a success, a stop and other failures', () => {
        assert.equal(L.blockerOf({ ok: true, reason: null, text: 'I have no torches left over.' }), null);
        assert.equal(L.blockerOf({ ok: false, reason: 'interrupted', text: 'I have no torches.' }), null);
        assert.equal(L.blockerOf({ ok: false, reason: 'no_path', text: 'I found no way there.' }), null);
        assert.equal(L.blockerOf(undefined), null);
        assert.equal(L.blockerOf('You have reached the chest.'), null);
    });
});

describe('nextIdleJob', () => {
    const idleJobs = ['!farmCycle("farm")', '!craftSupplies("torch", 32)'];

    test('the entries in order, each at most once per minutes', () => {
        assert.equal(L.nextIdleJob({ idleJobs, lastRun: {}, now: T0, minutes: 15 }), '!farmCycle("farm")');
        const lastRun = { '!farmCycle("farm")': T0 };
        assert.equal(L.nextIdleJob({ idleJobs, lastRun, now: T0 + 1000, minutes: 15 }), '!craftSupplies("torch", 32)');
        lastRun['!craftSupplies("torch", 32)'] = T0 + 1000;
        assert.equal(L.nextIdleJob({ idleJobs, lastRun, now: T0 + 14 * 60000, minutes: 15 }), null);
        assert.equal(L.nextIdleJob({ idleJobs, lastRun, now: T0 + 15 * 60000, minutes: 15 }), '!farmCycle("farm")');
    });

    test('the short form of the plan is a command too', () => {
        assert.equal(L.idleCommandText('farmCycle farm'), '!farmCycle("farm")');
        assert.equal(L.idleCommandText('craftSupplies torch 32'), '!craftSupplies("torch", 32)');
        assert.equal(L.nextIdleJob({ idleJobs: ['', 'farmCycle farm'], lastRun: {}, now: T0, minutes: 15 }), '!farmCycle("farm")');
    });

    test('null without entries', () => {
        assert.equal(L.nextIdleJob({ idleJobs: [], lastRun: {}, now: T0, minutes: 15 }), null);
        assert.equal(L.nextIdleJob({}), null);
    });
});

describe('readJobSettings and sameWork', () => {
    test('the defaults for missing or invalid values', () => {
        assert.deepEqual(L.readJobSettings({}), { resumeSeconds: 60, idleJobs: [], idleMinutes: 15 });
        assert.deepEqual(L.readJobSettings({ job_resume_seconds: 5, idle_jobs: 'x', idle_jobs_minutes: 0 }), { resumeSeconds: 60, idleJobs: [], idleMinutes: 15 });
        assert.deepEqual(L.readJobSettings({ job_resume_seconds: 30, idle_jobs: [' !harvest ', 3, ''], idle_jobs_minutes: 2 }), { resumeSeconds: 30, idleJobs: ['!harvest'], idleMinutes: 2 });
    });

    test('the same kind and thing is the same work', () => {
        assert.equal(L.sameWork(running(), L.jobOf('!mineOre', ['iron', 10])), true);
        assert.equal(L.sameWork(running(), L.jobOf('!mineOre', ['coal', 10])), false);
        assert.equal(L.sameWork(running(), L.jobOf('!farmCycle', [''])), false);
    });
});

test('oreOf: the table of ore items inside job_logic.js (no import of the mining pack)', () => {
    assert.deepEqual(L.oreOf('iron'), { ore: 'iron', item: 'raw_iron', block: false });
    assert.deepEqual(L.oreOf('deepslate_iron_ore'), { ore: 'iron', item: 'raw_iron', block: true });
    assert.equal(L.oreOf('lapis').item, 'lapis_lazuli');
    assert.equal(L.oreOf('iron_ingot').ore, 'iron');
    assert.equal(L.oreOf('diamonds').item, 'diamond');
    assert.equal(L.oreOf('ancient_debris').item, 'ancient_debris');
    assert.equal(L.oreOf('mithril'), null);
    assert.equal(L.dropOf('coal_ore'), 'coal');
    assert.equal(L.dropOf('stone'), 'cobblestone');
    assert.equal(L.dropOf('raw_iron'), 'raw_iron');
});

test('resultOf reads a pack result, a text and a stop', () => {
    assert.deepEqual(L.resultOf({ ok: true, reason: null, text: 'I mined 8 iron.' }), { ok: true, reason: null, text: 'I mined 8 iron.' });
    assert.equal(L.resultOf('Could not find a path.').ok, false);
    assert.equal(L.resultOf('I tried !mineOre("iron", 8) 3 times with the same result: x ').ok, false);
    assert.equal(L.resultOf('Collected 8 oak_log.').ok, undefined);
    assert.equal(L.resultOf(undefined).reason, 'interrupted');
});
