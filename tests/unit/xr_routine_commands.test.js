// Spec v0.1.4.15 part R (engineer E2): the four commands of the routines (SPEC 3.5) in src/agent/commands/actions.js,
// run through executeCommand as the glue runs them: their texts (3.6), the guard without agent.routines, their docs
// of one line each and their hiding through blocked_actions (SPEC 1 and 4).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importCommands() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        settingsModule.setSettings({ blocked_actions: [] });
        const index = await loadSrc('src/agent/commands/index.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { index, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { index, mcdata } = await importCommands();
const R = await loadSrc('src/agent/routines/routines.js');
const T = await loadSrc('src/agent/routines/routine_texts.js');

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const NAMES = ['!rememberRoutine', '!routines', '!forgetRoutine', '!doRoutine'];

let log;
before(() => {
    mcdata.__setMcdataForTests(minecraftData(TEST_MC_VERSION));
    log = console.log;
    console.log = () => {};
});
after(() => {
    mcdata.__setMcdataForTests(null);
    console.log = log;
});

// A fake agent with the routines of createRoutines on a store in memory and a job that may be running.
function fakeAgent({ job = null, routines = true } = {}) {
    const agent = {
        name: 'Luna', blocked_actions: [], running_commands: [], last_order: null, repeat_guard: null, job: null,
        bot: { inventory: { items: () => [] }, registry: { itemsByName: { torch: {}, wheat: {} } } },
        actions: { executing: false, stop: async () => { agent.stopped = (agent.stopped ?? 0) + 1; } },
        sayText: (text) => agent.said.push(text), said: [],
    };
    const jobApi = job ? { get: () => job, startRoutineRound: () => ({ ok: false, reason: 'busy', text: '' }), leaveRound: () => ({ ok: true }) } : null;
    agent.routines = routines ? R.createRoutines(agent, new R.RoutineStore(null, { now: () => new Date(T0) }), {
        settings: {}, now: () => T0, askModel: async () => 'NONE', job: () => jobApi,
    }) : null;
    return agent;
}

const typed = (agent, text) => index.executeCommand(agent, text, { typed: true, by: 'steve' });

describe('SPEC 3.5 and 3.6: the four commands and their texts', () => {
    test('the commands exist with their params: (name, text), (), (name), (name)', () => {
        for (const name of NAMES) assert.ok(index.commandExists(name), name);
        assert.deepEqual(Object.keys(index.getCommand('!rememberRoutine').params), ['name', 'text']);
        assert.equal(index.getCommand('!routines').params, undefined);
        assert.deepEqual(Object.keys(index.getCommand('!forgetRoutine').params), ['name']);
        assert.deepEqual(Object.keys(index.getCommand('!doRoutine').params), ['name']);
        assert.equal(index.argumentsText(index.getCommand('!rememberRoutine')), '!rememberRoutine takes 2 arguments (name, text): !rememberRoutine("name", "text").');
    });

    test('!rememberRoutine, !routines, !forgetRoutine: the texts of 3.6 word for word', async () => {
        const agent = fakeAgent();
        const text = 'harvest the wheat and the carrots and plant them again, then put the harvest in the chest by the door';
        assert.equal(await typed(agent, `!rememberRoutine("the farm", "${text}")`),
            `I remember the routine "the farm": ${text}. I do it when I have nothing else to do, every 15 minutes.`);
        assert.equal(await typed(agent, '!rememberRoutine("the farm", "again")'), 'I know that routine already as "the farm".');
        assert.equal(await typed(agent, '!rememberRoutine("torches", "make torches when fewer than 32 torches")'),
            'I remember the routine "torches": make torches when fewer than 32 torches. I do it when I have nothing else to do, every 15 minutes, when fewer than 32 torch.');
        assert.equal(await typed(agent, '!routines'), 'My routines: the farm (every 15 minutes); torches (when fewer than 32 torch).');
        assert.equal(await typed(agent, '!forgetRoutine("torches")'), 'I forgot the routine "torches".');
        assert.equal(await typed(agent, '!forgetRoutine("torches")'), 'I know no routine "torches".');
        assert.equal(await typed(agent, '!forgetRoutine("the farm")'), 'I forgot the routine "the farm".');
        assert.equal(await typed(agent, '!routines'), 'I have no routines.');
        for (let i = 1; i <= 12; i++) await typed(agent, `!rememberRoutine("r${i}", "x")`);
        assert.equal(await typed(agent, '!rememberRoutine("r13", "x")'), 'I have 12 routines already; forget one first.');
    });

    test('!doRoutine: unknown, the busy text while a job runs, the plan that fails pauses the routine', async () => {
        const agent = fakeAgent();
        assert.equal(await typed(agent, '!doRoutine("x")'), 'I know no routine "x".');
        await typed(agent, '!rememberRoutine("the farm", "keep the farm going")');
        assert.equal(await typed(agent, '!doRoutine("the farm")'), 'I cannot do the routine "the farm" with my commands. Say it differently.');
        assert.equal(await typed(agent, '!routines'), 'My routines: the farm (every 15 minutes, paused).');
        const busy = fakeAgent({ job: { kind: 'mineOre', words: 'the mining', state: 'running', wanted: 16, got: 7, args: ['iron', 16] } });
        await typed(busy, '!rememberRoutine("the farm", "keep the farm going")');
        assert.equal(await typed(busy, '!doRoutine("the farm")'), 'The mining runs, 7 of 16 iron. Say !stop first.');
    });

    test('without agent.routines (the switch off) the commands answer the guard text', async () => {
        const agent = fakeAgent({ routines: false });
        assert.equal(T.ROUTINES_OFF, 'Routines are off.');
        for (const text of ['!rememberRoutine("a", "b")', '!routines', '!forgetRoutine("a")', '!doRoutine("a")']) {
            assert.equal(await typed(agent, text), 'Routines are off.', text);
        }
    });
});

describe('SPEC 1 and 4: the docs are one line each and hidden with the switch', () => {
    test('each command has a one-line description and one-line params in the docs; blocked, none of them is there', () => {
        const docs = index.getCommandDocs({ blocked_actions: [] });
        for (const name of NAMES) {
            const def = index.getCommand(name);
            assert.ok(docs.includes(`\n${name}: ${def.description}\n`), name);
            assert.ok(!def.description.includes('\n'), `${name}: one line`);
            for (const [param, spec] of Object.entries(def.params ?? {})) assert.ok(!spec.description.includes('\n'), `${name} ${param}: one line`);
        }
        const hidden = index.getCommandDocs({ blocked_actions: [...NAMES] });
        for (const name of NAMES) assert.ok(!hidden.includes(`${name}:`), name);
        assert.ok(docs.length - hidden.length <= 600, `the four docs add ${docs.length - hidden.length} characters (SPEC 4: short)`);
    });

    test('the routine commands are the four of ROUTINE_COMMAND_NAMES, as agent.js blocks them', () => {
        assert.deepEqual([...R.ROUTINE_COMMAND_NAMES], NAMES);
    });
});
