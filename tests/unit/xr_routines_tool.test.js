// Spec v0.1.4.15 part R (engineer E2): the watch tool `routines` (SPEC 3.5): registered through registerTool of
// src/agent/watch/tools.js only with the switch routines, never in the pinned table TOOL_NAMES of mcp_logic; its answer
// is the routines as JSON ({ routines: [{ name, text, every, condition, state, rounds, fails, lastRound, steps }] }).
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const W = await loadSrc('src/agent/watch/tools.js');
const M = await loadSrc('src/agent/watch/mcp_logic.js');
const R = await loadSrc('src/agent/routines/routines.js');

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);

after(() => {
    W.unregisterTool('routines');
});

function agentWithRoutines() {
    const agent = { name: 'Luna', bot: { inventory: { items: () => [] }, registry: { itemsByName: {} } }, blocked_actions: [] };
    agent.routines = R.createRoutines(agent, new R.RoutineStore(null, { now: () => new Date(T0) }), { settings: {}, now: () => T0, job: () => null });
    agent.routines.remember('the farm', 'keep the farm going every 5 minutes');
    return agent;
}

describe('SPEC 3.5: the tool routines', () => {
    test('the pinned table of mcp_logic holds no tool routines; without the switch nothing is registered', () => {
        assert.ok(!M.TOOLS.some((tool) => tool.name === 'routines'));
        assert.ok(!Object.prototype.hasOwnProperty.call(W.TOOL_HANDLERS, 'routines'));
        W.unregisterTool('routines');
        assert.equal(R.registerRoutinesTool(W.registerTool, {}), false);
        assert.equal(R.registerRoutinesTool(W.registerTool, { routines: false }), false);
        assert.equal(R.registerRoutinesTool(null, { routines: true }), false);
        assert.ok(!W.toolList().some((tool) => tool.name === 'routines'));
    });

    test('with the switch the tool is registered, listed after the table, and answers the routines as JSON', async () => {
        assert.equal(R.registerRoutinesTool(W.registerTool, { routines: true }), true);
        const list = W.toolList();
        const tool = list.find((t) => t.name === 'routines');
        assert.ok(tool, 'listed');
        assert.equal(list.indexOf(tool), list.length - 1, 'after the table');
        assert.match(tool.description, /routines the owner saved/);
        assert.ok(tool.description.includes('!doRoutine'), 'the supervisor starts one with run');
        assert.deepEqual(tool.inputSchema, { type: 'object', properties: {}, additionalProperties: false });
        const out = await W.runTool(agentWithRoutines(), {}, 'routines', {});
        assert.equal(out.isError, false);
        assert.deepEqual(JSON.parse(out.text), { routines: [{
            name: 'the farm', text: 'keep the farm going every 5 minutes', every: 5, condition: null, state: 'active', rounds: 0, runs: 0, fails: 0, lastRound: null, steps: null,
        }] }); // v0.1.4.16 (F3): runs, the rounds started
        const none = await W.runTool({ name: 'Luna' }, {}, 'routines', {});
        assert.deepEqual(JSON.parse(none.text), { routines: [] }, 'an agent without routines: an empty list');
        assert.equal(W.unregisterTool('routines'), true);
        assert.ok(!W.toolList().some((t) => t.name === 'routines'));
    });

    test('ROUTINES_TOOL is the schema and the handler that tools.js registers', async () => {
        assert.equal(R.ROUTINES_TOOL.name, 'routines');
        assert.equal(typeof R.ROUTINES_TOOL.handler, 'function');
        assert.equal(await R.ROUTINES_TOOL.handler({ routines: { json: () => '{"routines":[]}' } }), '{"routines":[]}');
        assert.equal(await R.ROUTINES_TOOL.handler({ routines: { json: () => { throw new Error('x'); } } }), '{"routines":[]}');
    });
});
