// Spec v0.1.4.16, F3 (engineer E2): the plan keeps the places and the coordinates the player named. The plan prompt gains
// two lines before "Answer with the steps"; !goToCoordinates joins ROUTINE_COMMANDS (signed ints, closeness default 2); the
// check refuses a plan that lost a coordinate `(x, y, z)` of the text or a saved place named in it with the reason
// `the plan lost the place (x, y, z) you named` and the line `I could not plan the routine "<name>": the plan lost <what>
// you named. Say it differently.`; a plan with the walk steps is accepted. The bot's own bed (`my_bed`, F6) is never in the
// places line nor among the places the check looks for.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const L = await loadSrc('src/agent/routines/routine_logic.js');
const T = await loadSrc('src/agent/routines/routine_texts.js');
const R = await loadSrc('src/agent/routines/routines.js');

const T0 = Date.UTC(2026, 11, 1, 12, 0, 0);
const TASK = 'go to the west forest chest at (-2383, 65, 832), take 4 wheat, then harvest the wheat farm and put the wheat in the chest';
const PLACES = ['west_forest_chest', 'spot', 'my_bed'];
const LINE_1 = 'Every place the player names and every coordinate (x, y, z) in the task is a step of its own before the work there: !goToRememberedPlace("name") for a saved place, !goToCoordinates(x, y, z, 2) for a coordinate.';
const LINE_2 = 'Keep the player\'s numbers.';

describe('the plan prompt (F3)', () => {
    test('the two lines before "Answer with the steps"; !goToCoordinates among the commands; my_bed never in the places line', () => {
        const r = L.routineOf('the chest run', TASK, { now: new Date(T0).toISOString() });
        const prompt = L.routinePlanPrompt(r, {}, [{ name: 'wheat_farm', kind: 'farm' }], null, L.routineCommands(), { places: PLACES });
        const lines = prompt.split('\n');
        const answer = lines.findIndex(l => l.startsWith('Answer with the steps of one round'));
        assert.ok(answer > 0);
        assert.equal(lines[answer - 2], LINE_1);
        assert.equal(lines[answer - 1], LINE_2);
        assert.deepEqual([...L.PLAN_PLACE_LINES], [LINE_1, LINE_2]);
        assert.ok(lines.includes('!goToCoordinates(x, y, z, closeness): Walk to a coordinate.'), 'the command line');
        assert.equal(lines[2], 'The places the bot knows: the areas wheat_farm (farm); the places west_forest_chest, spot.', 'my_bed is not listed');
        const def = L.ROUTINE_COMMANDS.find(c => c.name === '!goToCoordinates');
        assert.deepEqual(def.params.map(p => [p.type, p.signed === true, p.default]), [['int', true, undefined], ['int', true, undefined], ['int', true, undefined], ['int', false, 2]]);
        assert.ok(L.ROUTINE_PLAN_NAMES.includes('!goToCoordinates'));
        assert.deepEqual([...L.HIDDEN_PLACES], ['my_bed']);
        assert.deepEqual(L.placeNamesOf(PLACES), ['west_forest_chest', 'spot']);
        assert.deepEqual(L.placeNamesOf([{ name: 'my_bed' }, { name: 'post' }, 7, '']), ['post']);
    });

    test('coordinatesIn and placesIn read the task', () => {
        assert.deepEqual(L.coordinatesIn(TASK), [{ x: -2383, y: 65, z: 832 }]);
        assert.deepEqual(L.coordinatesIn('walk to (10, 64, -3) and (10,64,-3), then ( 1 , 2 , 3 )'), [{ x: 10, y: 64, z: -3 }, { x: 1, y: 2, z: 3 }]);
        assert.deepEqual(L.coordinatesIn('no numbers here, 10, 64, -3 without parentheses'), []);
        assert.deepEqual(L.coordinatesIn(null), []);
        assert.deepEqual(L.placesIn(TASK, PLACES), ['west_forest_chest'], 'the words of the name, with spaces for the underscores');
        assert.deepEqual(L.placesIn('go to the spot and back to my bed', PLACES), ['spot'], 'my_bed is never looked for');
        assert.deepEqual(L.placesIn('the spotlight is not the spot', ['spot']), ['spot'], 'whole words: the spot');
        assert.deepEqual(L.placesIn('the spotlight', ['spot']), [], 'spotlight is no spot');
        assert.deepEqual(L.placesIn('Go To The Post', [{ name: 'post' }]), ['post']);
        assert.deepEqual(L.placesIn('', PLACES), []);
    });
});

describe('checkPlan with the task (F3)', () => {
    const commands = L.routineCommands();
    const steps = (text) => L.readPlan(text).commands;

    test('a plan without the walk to the coordinate is refused with the reason and the text', () => {
        const out = L.checkPlan(steps('!fetchItem("wheat", 4)\n!harvest("wheat_farm")\n!putInChest("wheat", 64)'), commands, [], { text: TASK, places: PLACES });
        assert.deepEqual(out, { ok: false, reason: 'the plan lost the place (-2383, 65, 832) you named', step: null, steps: null });
        assert.equal(T.badPlanText('the chest run', out.reason), 'I could not plan the routine "the chest run": the plan lost the place (-2383, 65, 832) you named. Say it differently.');
        assert.equal(T.planReasons.places(T.lostPlaceWords({ x: 1, y: 2, z: 3 })), 'the plan lost the place (1, 2, 3) you named');
        assert.equal(T.lostPlaceWords('spot'), 'the place "spot"');
    });

    test('the walk with the same three numbers is accepted; other numbers are not', () => {
        const plan = '!goToCoordinates(-2383, 65, 832, 2)\n!fetchItem("wheat", 4)\n!goToRememberedPlace("west_forest_chest")\n!harvest("wheat_farm")\n!putInChest("wheat", 64)';
        const out = L.checkPlan(steps(plan), commands, [], { text: TASK, places: PLACES });
        assert.equal(out.ok, true, out.reason);
        assert.deepEqual(out.steps.map(s => s.command), ['!goToCoordinates(-2383, 65, 832, 2)', '!fetchItem("wheat", 4)', '!goToRememberedPlace("west_forest_chest")', '!harvest("wheat_farm")', '!putInChest("wheat", 64)']);
        assert.deepEqual(out.steps[0].check, { item: null, count: null }, 'a walk is done when it returns ok');
        const wrong = L.checkPlan(steps(plan.replace('-2383, 65, 832, 2', '-2383, 65, 833, 2')), commands, [], { text: TASK, places: PLACES });
        assert.equal(wrong.reason, 'the plan lost the place (-2383, 65, 832) you named', 'the numbers must be the player\'s');
        const noClose = L.checkPlan(steps('!goToCoordinates(-2383, 65, 832)'), commands, [], { text: 'walk to (-2383, 65, 832)' });
        assert.equal(noClose.ok, true, 'closeness defaults to 2');
        assert.equal(noClose.steps[0].command, '!goToCoordinates(-2383, 65, 832)');
    });

    test('a saved place named in the text needs its !goToRememberedPlace step; the name may be written with spaces', () => {
        const text = 'go to the west forest chest, take 4 wheat';
        const lost = L.checkPlan(steps('!fetchItem("wheat", 4)'), commands, [], { text, places: PLACES });
        assert.deepEqual(lost, { ok: false, reason: 'the plan lost the place "west_forest_chest" you named', step: null, steps: null });
        assert.equal(T.badPlanText('x', lost.reason), 'I could not plan the routine "x": the plan lost the place "west_forest_chest" you named. Say it differently.');
        assert.equal(L.checkPlan(steps('!goToRememberedPlace("west_forest_chest")\n!fetchItem("wheat", 4)'), commands, [], { text, places: PLACES }).ok, true);
        assert.equal(L.checkPlan(steps('!goToRememberedPlace("west forest chest")\n!fetchItem("wheat", 4)'), commands, [], { text, places: PLACES }).ok, true, 'the words of the name');
        assert.equal(L.checkPlan(steps('!fetchItem("wheat", 4)'), commands, [], { text: 'go to my bed', places: PLACES }).ok, true, 'my_bed is never required');
        assert.equal(L.checkPlan(steps('!harvest("wheat_farm")'), commands, [], { text: 'harvest the wheat farm', places: PLACES }).ok, true, 'an area is no saved place: the work command walks there');
    });

    test('without a task text the check is as before; the coordinate command takes signed numbers only as ints', () => {
        assert.equal(L.checkPlan(steps('!fetchItem("wheat", 4)'), commands, []).ok, true);
        assert.equal(L.checkPlan(steps('!fetchItem("wheat", 4)'), commands, [], {}).ok, true);
        assert.equal(L.checkPlan(steps('!goToCoordinates(0, -60, 0, 1)'), commands, []).ok, true, '0 and negative numbers');
        assert.equal(L.checkPlan(steps('!goToCoordinates(1.5, 64, 2)'), commands, []).reason, '!goToCoordinates takes a number');
        assert.equal(L.checkPlan(steps('!goToCoordinates("x", 64, 2)'), commands, []).reason, '!goToCoordinates takes a number');
        assert.equal(L.checkPlan(steps('!goToCoordinates(1, 64, 2, 0)'), commands, []).reason, '!goToCoordinates takes a number', 'closeness is 1 or more');
        assert.equal(L.checkPlan(steps('!putInChest("wheat", -1)'), commands, []).reason, '!putInChest takes a number', 'the other ints stay 1 or more');
    });
});

describe('the routines with a plan that lost a place (F3)', () => {
    function world(answer, places = PLACES) {
        const w = { said: [], prompts: [] };
        const agent = { sayText: (t) => w.said.push(t), bot: { inventory: { items: () => [] }, registry: { itemsByName: {} } }, area_store: { list: () => [{ name: 'wheat_farm', kind: 'farm' }] } };
        const store = new R.RoutineStore(null, { now: () => new Date(T0) });
        w.routines = R.createRoutines(agent, store, {
            settings: {}, now: () => T0, places: () => places, chests: () => null, rules: () => [], blocked: () => [],
            askModel: async (prompt) => { w.prompts.push(prompt); return answer; },
            job: () => ({ get: () => null, startRoutineRound: (r, round) => ({ ok: true, job: { routine: r.name, round } }) }),
        });
        return w;
    }

    test('refused with the line, the routine paused; accepted with the walk steps, the plan saved', async () => {
        const lost = world('!fetchItem("wheat", 4)\n!harvest("wheat_farm")');
        lost.routines.remember('the chest run', TASK);
        const out = await lost.routines.startRound(lost.routines.get('the chest run'));
        assert.deepEqual(out, { ok: false, reason: 'bad_plan', text: 'I could not plan the routine "the chest run": the plan lost the place (-2383, 65, 832) you named. Say it differently.' });
        assert.equal(lost.routines.get('the chest run').state, 'paused');
        assert.ok(lost.prompts[0].includes(`\n${LINE_1}\n${LINE_2}\n`), 'the prompt has the two lines');
        assert.ok(lost.prompts[0].includes('the places west_forest_chest, spot.'), 'my_bed is not in the prompt');
        const kept = world('!goToCoordinates(-2383, 65, 832, 2)\n!goToRememberedPlace("west_forest_chest")\n!fetchItem("wheat", 4)\n!harvest("wheat_farm")\n!putInChest("wheat", 64)');
        kept.routines.remember('the chest run', TASK);
        const started = await kept.routines.startRound(kept.routines.get('the chest run'));
        assert.equal(started.ok, true, started.text);
        assert.equal(started.text, 'I start the routine "the chest run", round 1.');
        assert.deepEqual(kept.routines.get('the chest run').steps.map(s => s.command)[0], '!goToCoordinates(-2383, 65, 832, 2)');
        assert.equal(kept.routines.get('the chest run').runs, 1);
    });
});
