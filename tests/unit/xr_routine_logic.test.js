// Spec v0.1.4.15 part R (engineer E2): the pure decisions of the routines, src/agent/routines/routine_logic.js (SPEC 3.1,
// 3.2, 3.4): the two things code reads from the text, the commands a plan may use, the plan prompt word for word, the
// answer read and checked, which routine runs next, and what a round's end does to the routine.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/routines/routine_logic.js');
const P = await loadSrc('src/agent/job/plan_logic.js');

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const ISO = (ms) => new Date(ms).toISOString();
const ITEMS = new Set(['torch', 'bread', 'iron_ingot', 'wheat_seeds', 'wheat', 'glass', 'oak_log', 'cobblestone', 'potato']);
const isItem = (name) => ITEMS.has(name);
const FARM_TEXT = 'harvest the wheat and the carrots and plant them again, then put the harvest in the chest by the door';

describe('SPEC 3.1: the name and the two things code reads from the text', () => {
    test('a name as an area name, with its spaces, 1 to 64 characters', () => {
        assert.equal(L.normalizeRoutineName(' The  Farm '), 'the farm');
        assert.equal(L.normalizeRoutineName('the_farm'), 'the farm');
        assert.equal(L.normalizeRoutineName(''), null);
        assert.equal(L.normalizeRoutineName('x'.repeat(65)), null);
        assert.equal(L.normalizeRoutineName(7), null);
    });

    test('every N minutes, every minute, every hour, every N hours; 15 when the text names none', () => {
        assert.equal(L.everyOf('keep the farm going every 15 minutes'), 15);
        assert.equal(L.everyOf('Every 5 Minutes, tidy the chests'), 5);
        assert.equal(L.everyOf('walk to the post, every minute'), 1);
        assert.equal(L.everyOf('every hour, store the loot'), 60);
        assert.equal(L.everyOf('every 2 hours'), 120);
        assert.equal(L.everyOf('every 0 minutes'), null);
        assert.equal(L.everyOf('keep the farm going'), null);
        assert.equal(L.parseRoutineText('keep the farm going', isItem).every, 15);
        assert.equal(L.ROUTINE_RULES.every, 15);
    });

    test('when fewer than N <item>: the item a name of the registry, its singular, or a generic name; null else', () => {
        assert.deepEqual(L.conditionOf('make torches when fewer than 32 torches', isItem), { item: 'torch', fewerThan: 32 });
        assert.deepEqual(L.conditionOf('smelt when fewer than 8 iron ingots in the chest', isItem), { item: 'iron_ingot', fewerThan: 8 });
        assert.deepEqual(L.conditionOf('bake when less than 5 bread', isItem), { item: 'bread', fewerThan: 5 });
        assert.deepEqual(L.conditionOf('plant when fewer than 16 wheat seeds', isItem), { item: 'wheat_seeds', fewerThan: 16 });
        assert.deepEqual(L.conditionOf('when fewer than 10 potatoes', isItem), { item: 'potato', fewerThan: 10 });
        assert.deepEqual(L.conditionOf('when fewer than 4 glass', isItem), { item: 'glass', fewerThan: 4 });
        assert.deepEqual(L.conditionOf('cut wood when fewer than 20 logs', isItem), { item: 'log', fewerThan: 20 }, 'a generic name the inventory check knows');
        assert.equal(L.conditionOf('when fewer than 3 unicorns', isItem), null);
        assert.equal(L.conditionOf('when fewer than 0 torches', isItem), null);
        assert.equal(L.conditionOf('keep the farm going', isItem), null);
        assert.deepEqual(L.conditionOf('when fewer than 32 torches'), { item: 'torch', fewerThan: 32 }, 'without a registry the singular is taken');
    });

    test('parseRoutineText reads both and nothing else; routineOf gives the record of 3.1', () => {
        assert.deepEqual(L.parseRoutineText('make torches when fewer than 32 torches, every 5 minutes', isItem), { every: 5, condition: { item: 'torch', fewerThan: 32 } });
        const r = L.routineOf('The Farm', `${FARM_TEXT}  `, { now: ISO(T0), isItem });
        assert.deepEqual(r, {
            name: 'the farm', text: FARM_TEXT, steps: null, every: 15, condition: null, state: 'active', rounds: 0, fails: 0, lastRound: null,
            created: ISO(T0), updated: ISO(T0),
        });
        assert.equal(L.routineOf('', 'x'), null);
        assert.equal(L.routineOf('x', ''), null);
        assert.equal(L.routineOf('x', 'y'.repeat(401)), null);
        assert.equal(L.ROUTINE_RULES.textMax, 400);
        assert.equal(L.ROUTINE_RULES.max, 12);
        assert.deepEqual([...L.ROUTINE_STATES], ['active', 'paused']);
    });
});

describe('SPEC 3.2: the commands a plan may use', () => {
    test('ROUTINE_COMMANDS: PLAN_COMMANDS and the commands of the base, never a routine command, !newAction or !stop', () => {
        const names = L.ROUTINE_COMMANDS.map(c => c.name);
        for (const c of P.PLAN_COMMANDS) assert.ok(names.includes(c.name), c.name);
        for (const n of ['!harvest', '!plant', '!farmCycle', '!storeItems', '!putInChest', '!fetchItem', '!goToRememberedPlace', '!goToBase', '!collectBlocks', '!craftRecipe']) {
            assert.ok(names.includes(n), n);
        }
        for (const n of ['!rememberRoutine', '!routines', '!forgetRoutine', '!doRoutine', '!newAction', '!stop']) assert.ok(!names.includes(n), n);
        assert.deepEqual([...L.ROUTINE_PLAN_NAMES], names);
        assert.deepEqual([...L.ROUTINE_COMMAND_NAMES], ['!rememberRoutine', '!routines', '!forgetRoutine', '!doRoutine']);
        for (const c of L.ROUTINE_COMMANDS) {
            assert.equal(typeof c.usage, 'string', c.name);
            assert.equal(typeof c.description, 'string', c.name);
            assert.ok(Array.isArray(c.params), c.name);
        }
        assert.deepEqual(L.ROUTINE_COMMANDS.find(c => c.name === '!plant').params.map(p => p.default), ['wheat_seeds', ''], 'the real !plant takes (seed, farm)');
    });

    test('routineCommands: !goToBase only with base_survey, !mineOre only with a known mine', () => {
        const plain = L.routineCommands().map(c => c.name);
        assert.ok(!plain.includes('!goToBase') && !plain.includes('!mineOre'));
        const both = L.routineCommands({ mining: true, baseSurvey: true }).map(c => c.name);
        assert.ok(both.includes('!goToBase') && both.includes('!mineOre'));
        assert.ok(L.routineCommands({ baseSurvey: true }).map(c => c.name).includes('!goToBase'));
    });

    test('routinePlanPrompt, word for word for the example of 3.6', () => {
        const r = L.routineOf('the farm', FARM_TEXT, { now: ISO(T0), isItem });
        const prompt = L.routinePlanPrompt(r, { wheat_seeds: 12, iron_hoe: 1 }, [{ name: 'farm', kind: 'farm' }, { name: 'home', kind: 'home', type: 'home' }],
            [{ x: 12, y: 64, z: -3, items: { wheat: 40, carrot: 12 } }, { x: 1, y: 1, z: 1, items: {} }], L.routineCommands(),
            { rules: [{ id: 1, text: 'never open the pens' }], places: ['post', 'spot'] });
        const lines = prompt.split('\n');
        assert.equal(lines[0], 'You plan the steps of a Minecraft bot for a standing task the player described in his words.');
        assert.equal(lines[1], `The task: ${FARM_TEXT}.`);
        assert.equal(lines[2], 'RULES FROM THE PLAYER (always follow them, they are more important than your own ideas):');
        assert.equal(lines[3], '1. never open the pens');
        assert.equal(lines[4], 'The places the bot knows: the areas farm (farm), home (home); the places post, spot.');
        assert.equal(lines[5], 'The chests the bot knows and what they hold:');
        assert.equal(lines[6], 'the chest at (12, 64, -3): 40 wheat, 12 carrot');
        assert.equal(lines[7], 'What the bot carries: 1 iron_hoe, 12 wheat_seeds.');
        assert.equal(lines[8], 'The commands you may use:');
        const commands = L.routineCommands();
        for (let i = 0; i < commands.length; i++) {
            assert.equal(lines[9 + i], `${commands[i].usage}: ${commands[i].description}`);
        }
        const tail = lines.slice(9 + commands.length);
        assert.deepEqual(tail, [
            'Answer with the steps of one round of the task, one command per line, in the order the bot runs them; the first command runs first; at most 8 lines.',
            'Write the commands with their arguments, strings in double quotes, for example !harvest("farm"). Use no other command and write nothing else.',
            'When the task cannot be done with these commands, answer NONE.',
        ]);
        assert.ok(!prompt.includes('!goToBase') && !prompt.includes('!mineOre') && !prompt.includes('!newAction'));
    });

    test('the prompt without rules, places or chests says so; chests null leaves the chest lines out', () => {
        const r = L.routineOf('x', 'tidy the chests', { now: ISO(T0) });
        const lines = L.routinePlanPrompt(r, {}, [], [], L.routineCommands(), {}).split('\n');
        assert.equal(lines[1], 'The task: tidy the chests.');
        assert.equal(lines[2], 'The places the bot knows: none.');
        assert.equal(lines[3], 'The chests the bot knows: none with items.');
        assert.equal(lines[4], 'What the bot carries: nothing.');
        const none = L.routinePlanPrompt(r, {}, [], null, L.routineCommands()).split('\n');
        assert.equal(none[3], 'What the bot carries: nothing.');
        assert.ok(!none.some(l => l.startsWith('The chests')));
    });

    test('the places line: the remembered places by name (the places the model may walk to), with or without areas', () => {
        const r = L.routineOf('the walk', 'walk to the post and back to the spot', { now: ISO(T0) });
        const line = (areas, places) => L.routinePlanPrompt(r, {}, areas, null, L.routineCommands(), { places }).split('\n')[2];
        assert.equal(line([], ['post', 'spot']), 'The places the bot knows: the places post, spot.');
        assert.equal(line([{ name: 'farm', kind: 'farm' }], [{ name: 'post' }]), 'The places the bot knows: the areas farm (farm); the places post.');
        assert.equal(line([{ name: 'farm', kind: 'farm' }], []), 'The places the bot knows: the areas farm (farm).');
        assert.equal(line([], []), 'The places the bot knows: none.');
        assert.equal(line([], [7, '', null]), 'The places the bot knows: none.', 'only names count');
    });

    test('readPlan: the commands as written; NONE or no command is none', () => {
        assert.deepEqual(L.readPlan('NONE'), { none: true, commands: [] });
        assert.deepEqual(L.readPlan('I would rather not.'), { none: true, commands: [] });
        assert.deepEqual(L.readPlan(null), { none: true, commands: [] });
        const read = L.readPlan('!harvest("farm")\n!putInChest("wheat", 64)\n!storeItems\n!plant(bad arg)');
        assert.equal(read.none, false);
        assert.deepEqual(read.commands.map(c => [c.name, c.args]), [['!harvest', ['farm']], ['!putInChest', ['wheat', 64]], ['!storeItems', []], ['!plant', null]]);
        assert.equal(read.commands[1].text, '!putInChest("wheat", 64)');
    });

    test('checkPlan: a command outside the list, a wrong type, 9 steps, a blocked command, a routine command', () => {
        const commands = L.routineCommands();
        const outside = L.checkPlan(L.readPlan('!harvest("farm")\n!newAction("dig")').commands, commands, []);
        assert.deepEqual(outside, { ok: false, reason: 'the command !newAction is not one I may use', step: '!newAction("dig")', steps: null });
        const type = L.checkPlan(['!putInChest("wheat", "many")'], commands, []);
        assert.equal(type.reason, '!putInChest takes a number');
        assert.equal(type.step, '!putInChest("wheat", "many")');
        assert.equal(L.checkPlan(['!putInChest("wheat", 0)'], commands, []).reason, '!putInChest takes a number');
        assert.equal(L.checkPlan(['!putInChest("wheat")'], commands, []).reason, '!putInChest takes a number', 'a missing number');
        assert.equal(L.checkPlan(['!harvest(5)'], commands, []).reason, '!harvest takes a text');
        assert.equal(L.checkPlan(['!goToRememberedPlace'], commands, []).reason, '!goToRememberedPlace takes a text', 'a missing text');
        assert.equal(L.checkPlan(['!harvest("a", "b")'], commands, []).reason, '!harvest takes at most 1 argument');
        const many = L.checkPlan(Array.from({ length: 9 }, () => '!storeItems'), commands, []);
        assert.deepEqual(many, { ok: false, reason: 'too many steps', step: null, steps: null });
        assert.equal(L.checkPlan(Array.from({ length: 8 }, () => '!storeItems'), commands, []).ok, true, '8 steps are fine');
        assert.equal(L.checkPlan([], commands, []).reason, 'no steps');
        const blocked = L.checkPlan(['!harvest("farm")'], commands, ['!harvest']);
        assert.equal(blocked.reason, 'the command !harvest is not one I may use');
        assert.equal(L.checkPlan(['!doRoutine("x")'], commands, []).reason, 'the command !doRoutine is not one I may use');
        assert.equal(L.checkPlan(['!goToBase("east")'], L.routineCommands(), []).reason, 'the command !goToBase is not one I may use', 'without base_survey');
        assert.equal(L.checkPlan(['!goToBase("east")'], L.routineCommands({ baseSurvey: true }), []).ok, true);
    });

    test('checkPlan ok: the steps to save, with the checks of the job for the plan commands and none for the others', () => {
        const out = L.checkPlan(L.readPlan('!harvest("farm")\n!plant("wheat_seeds", "farm")\n!fetchItem("wheat", 8)\n!chopTrees("oak", 4)\n!storeItems()').commands, L.routineCommands(), []);
        assert.equal(out.ok, true);
        assert.equal(out.reason, null);
        assert.deepEqual(out.steps, [
            { command: '!harvest("farm")', check: { item: null, count: null } },
            { command: '!plant("wheat_seeds", "farm")', check: { item: null, count: null } },
            { command: '!fetchItem("wheat", 8)', check: { item: 'wheat', count: 8 } },
            { command: '!chopTrees(4, "oak")', check: { item: 'oak_log', count: 4 } },
            { command: '!storeItems', check: { item: null, count: null } },
        ]);
        assert.deepEqual(L.checkPlan([{ name: 'harvest', args: ['farm'] }, { command: '!storeItems' }]).steps.map(s => s.command), ['!harvest("farm")', '!storeItems'], 'steps as { name, args } or { command } too');
        assert.deepEqual(L.routineCheckOf('!craftRecipe', ['torch', 2]), { item: 'torch', count: null });
        assert.deepEqual(L.routineCheckOf('!putInChest', ['wheat', 64]), { item: null, count: null });
    });
});

describe('SPEC 3.4: which routine runs next', () => {
    const active = (name, lastRound, extra = {}) => ({ ...L.routineOf(name, 'x', { now: ISO(T0 - 3600000) }), lastRound, ...extra });

    test('isDue: never ran, or every minutes or more ago', () => {
        assert.equal(L.isDue(active('a', null), T0), true);
        assert.equal(L.isDue(active('a', ISO(T0 - 15 * 60000)), T0), true);
        assert.equal(L.isDue(active('a', ISO(T0 - 14 * 60000)), T0), false);
        assert.equal(L.isDue(active('a', ISO(T0 - 60000), { every: 1 }), T0), true);
        assert.equal(L.isDue(active('a', ISO(T0 - 59000), { every: 1 }), T0), false);
        assert.equal(L.isDue(null, T0), false);
    });

    test('conditionHolds: fewer than N of the item in the bag; no condition always holds', () => {
        const torches = active('torches', null, { condition: { item: 'torch', fewerThan: 32 } });
        assert.equal(L.conditionHolds(torches, { torch: 40 }), false);
        assert.equal(L.conditionHolds(torches, { torch: 31 }), true);
        assert.equal(L.conditionHolds(torches, {}), true);
        assert.equal(L.conditionHolds(active('logs', null, { condition: { item: 'log', fewerThan: 8 } }), { oak_log: 5, birch_log: 4 }), false, 'any log counts for log');
        assert.equal(L.conditionHolds(active('a', null), { torch: 100 }), true);
    });

    test('nextRoutine: the active routine that is due with the oldest last round, never ran first, in the order given on a tie', () => {
        const list = [
            active('b', ISO(T0 - 20 * 60000)),
            active('a', ISO(T0 - 30 * 60000)),
            active('fresh', ISO(T0 - 5 * 60000)),
            active('paused', null, { state: 'paused' }),
        ];
        assert.equal(L.nextRoutine(list, T0).name, 'a', 'the oldest due');
        assert.equal(L.nextRoutine([...list, active('new', null)], T0).name, 'new', 'never ran comes first');
        assert.equal(L.nextRoutine([active('x', null), active('y', null)], T0).name, 'x', 'the order given on a tie');
        assert.equal(L.nextRoutine([active('fresh', ISO(T0 - 5 * 60000)), active('paused', null, { state: 'paused' })], T0), null);
        assert.equal(L.nextRoutine([], T0), null);
        assert.equal(L.nextRoutine(list, NaN), null);
    });

    test('nextRoutine with the bag: a routine whose condition does not hold is skipped', () => {
        const torches = active('torches', null, { condition: { item: 'torch', fewerThan: 32 } });
        const farm = active('farm', ISO(T0 - 16 * 60000));
        assert.equal(L.nextRoutine([torches, farm], T0, { torch: 40 }).name, 'farm');
        assert.equal(L.nextRoutine([torches, farm], T0, { torch: 10 }).name, 'torches');
        assert.equal(L.nextRoutine([torches], T0, { torch: 40 }), null);
        assert.equal(L.nextRoutine([torches], T0).name, 'torches', 'without a bag the bag counts as empty');
    });
});

describe('SPEC 3.3: what a round does to the routine', () => {
    const r = L.routineOf('the farm', 'x', { now: ISO(T0 - 3600000) });
    const planned = { ...r, steps: [{ command: '!harvest("farm")', check: { item: null, count: null } }] };

    test('done counts a round, clears the failures and sets the last round', () => {
        const { routine, paused } = L.noteRound({ ...planned, rounds: 4, fails: 2 }, { reason: 'done' }, T0);
        assert.equal(paused, false);
        assert.equal(routine.rounds, 5);
        assert.equal(routine.fails, 0);
        assert.equal(routine.lastRound, ISO(T0));
        assert.equal(routine.updated, ISO(T0));
        assert.equal(routine.state, 'active');
        assert.deepEqual(routine.steps, planned.steps, 'the plan is kept');
        assert.equal(planned.rounds, 0, 'a copy');
    });

    test('failed counts a failure; the third in a row pauses the routine and drops its plan', () => {
        const once = L.noteRound(planned, 'failed', T0);
        assert.equal(once.paused, false);
        assert.equal(once.routine.fails, 1);
        assert.equal(once.routine.state, 'active');
        const twice = L.noteRound(once.routine, { reason: 'failed', step: '!harvest("farm")' }, T0 + 60000);
        assert.equal(twice.paused, false);
        const thrice = L.noteRound(twice.routine, 'failed', T0 + 120000);
        assert.equal(thrice.paused, true);
        assert.equal(thrice.routine.fails, 3);
        assert.equal(thrice.routine.state, 'paused');
        assert.equal(thrice.routine.steps, null, 'one replan when it runs again');
        assert.equal(L.ROUTINE_RULES.maxFails, 3);
        const broken = L.noteRound({ ...planned, fails: 2 }, 'done', T0);
        assert.equal(broken.routine.fails, 0, 'a done round breaks the row');
    });

    test('left sets the last round and nothing else', () => {
        const { routine, paused } = L.noteRound({ ...planned, rounds: 2, fails: 1 }, 'left', ISO(T0));
        assert.equal(paused, false);
        assert.equal(routine.rounds, 2);
        assert.equal(routine.fails, 1);
        assert.equal(routine.lastRound, ISO(T0));
        assert.deepEqual(L.noteRound(null, 'done', T0), { routine: null, paused: false });
    });

    test('routinesJson: the shape of the watch tool', () => {
        const json = JSON.parse(L.routinesJson([{ ...planned, rounds: 4, lastRound: ISO(T0) }, { ...r, name: 'torches', condition: { item: 'torch', fewerThan: 32 }, state: 'paused' }]));
        assert.deepEqual(json, { routines: [
            { name: 'the farm', text: 'x', every: 15, condition: null, state: 'active', rounds: 4, fails: 0, lastRound: ISO(T0), steps: ['!harvest("farm")'] },
            { name: 'torches', text: 'x', every: 15, condition: { item: 'torch', fewerThan: 32 }, state: 'paused', rounds: 0, fails: 0, lastRound: null, steps: null },
        ] });
        assert.deepEqual(JSON.parse(L.routinesJson(null)), { routines: [] });
    });
});
