// Spec v0.1.4.6 G1 (and Amendment 1, part C): the glue of the cost meter.
//   - prompter.js runs every call of a model inside withPurpose with its purpose, while the agent
//     has a cost meter; a report of the model then reaches the meter under that purpose;
//   - the state saving: !newAction and !goal answer without a call, the self prompter stops its
//     loop and does not start it, the skill review is skipped with the reason cost_limit;
//   - !cost; the report line and flush() in cleanKill; Agent._costAllows never throws.
//
// Modules that read ./keys.json or ./bots at import are imported with an empty temp directory as
// working directory. process.exit is replaced by a recorder where cleanKill is called.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeEndowments, inventoryOf } from '../helpers/skill_env.js';
import { readRepoFile } from '../helpers/source_ast.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        const prompter = await loadSrc('src/models/prompter.js');
        const agent = await loadSrc('src/agent/agent.js');
        const selfPrompter = await loadSrc('src/agent/self_prompter.js');
        return { settingsModule, index, actions, queries, prompter, agent, selfPrompter };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const U = await loadSrc('src/agent/cost/usage_context.js');
const COST = await loadSrc('src/agent/cost/cost_meter.js');
const SM = await loadSrc('src/agent/skills/skill_manager.js');
const LOCK = await loadSrc('src/agent/library/lockdown.js');

M.settingsModule.setSettings({ language: 'en', allow_insecure_coding: true, code_timeout_mins: -1, cost_meter: true });

const action = (name) => M.actions.actionsList.find((c) => c.name === name);
const query = (name) => M.queries.queryList.find((c) => c.name === name);

// A cost meter stand-in in the given state.
const meterIn = (state) => ({
    state,
    allows: (what) => !(state === 'saving' && ['coding', 'skill_review', 'self_prompt'].includes(what)),
    summaryText: () => `Cost: session $0.00, 0 calls.\nBudget: no limits set. State: ${state}.`,
});

let cap;
beforeEach(() => {
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    U.setUsageSink(null);
});

describe('prompter.js: every call of a model runs inside withPurpose while the agent has a cost meter', () => {
    const CASES = [
        ['promptConvo', 'chat', (p) => p.promptConvo([{ role: 'user', content: 'bob: hi' }])],
        ['promptCoding', 'coding', (p) => p.promptCoding([{ role: 'user', content: 'bob: build' }])],
        ['promptMemSaving', 'memory', (p) => p.promptMemSaving([{ role: 'user', content: 'bob: hi' }])],
        ['promptSkillReview', 'skill_review', (p) => p.promptSkillReview('review this')],
        ['promptShouldRespondToBot', 'bot_responder', (p) => p.promptShouldRespondToBot('hello')],
        ['promptVision', 'vision', (p) => p.promptVision([{ role: 'user', content: 'look' }], Buffer.from('png'))],
        ['promptGoalSetting', 'goal_setting', (p) => p.promptGoalSetting([{ role: 'user', content: 'x' }], {})],
    ];

    function fakePrompter(agent, seen) {
        const model = {
            async sendRequest() {
                seen.push(U.currentPurpose());
                U.reportUsage({ model: 'claude-haiku-4-5', input_tokens: 1000, output_tokens: 100 });
                return '```json\n{"name": "oak_log", "quantity": 1}\n```';
            },
            async sendVisionRequest() {
                seen.push(U.currentPurpose());
                U.reportUsage({ model: 'claude-haiku-4-5', input_tokens: 1000, output_tokens: 100 });
                return 'I see a tree.';
            },
        };
        const fake = Object.create(M.prompter.Prompter.prototype);
        return Object.assign(fake, {
            agent,
            profile: { conversing: 'C', coding: 'D', saving_memory: 'S', bot_responder: 'B', image_analysis: 'I', goal_setting: 'G' },
            cooldown: 0, last_prompt_time: 0, awaiting_coding: false, convo_examples: null, coding_examples: null,
            chat_model: model, code_model: model, vision_model: model,
            // the placeholders are not under test
            async replaceStrings(prompt) {
                return prompt;
            },
        });
    }

    for (const [method, purpose, call] of CASES) {
        test(`${method}: purpose ${purpose}, the report reaches the meter under it`, async () => {
            const meter = new COST.CostMeter({ settings: {} });
            U.setUsageSink((report) => meter.record(report));
            const seen = [];
            const agent = { name: 'andy', cost_meter: meter, history: { getHistory: () => [] }, task: {} };
            await call(fakePrompter(agent, seen));
            assert.deepEqual(seen, [purpose]);
            assert.deepEqual(Object.keys(meter.totals().by_purpose), [purpose]);
            assert.equal(meter.totals().calls, 1);
        });
    }

    test('without a cost meter the calls are not wrapped: the purpose is other', async () => {
        const seen = [];
        const agent = { name: 'andy', history: { getHistory: () => [] }, task: {} };
        for (const [, , call] of CASES) await call(fakePrompter(agent, seen));
        assert.deepEqual(seen, CASES.map(() => 'other'));
    });
});

describe('the state saving', () => {
    test('!newAction: the text of the spec, the coder is not called; in other states it is', async () => {
        let calls = 0;
        const agent = {
            cost_meter: meterIn('saving'),
            coder: { async generateCode() { calls++; return 'code ran'; }, last_run: null },
            actions: { async runAction(label, fn) { await fn(); return { success: true, message: '', interrupted: false, timedout: false }; } },
            history: {},
        };
        assert.equal(await action('!newAction').perform(agent, 'build a house'),
            'I reached my cost limit and do not write new code now. Use the commands I have.');
        assert.equal(calls, 0);
        agent.cost_meter = meterIn('warned');
        assert.equal(await action('!newAction').perform(agent, 'build a house'), 'code ran');
        assert.equal(calls, 1);
    });

    test('!goal: the text of the spec, the self prompter does not start; in other states it does', async () => {
        const started = [];
        const agent = { cost_meter: meterIn('saving'), self_prompter: { start: (p) => started.push(p), setPromptPaused() {} } };
        assert.equal(await action('!goal').perform(agent, 'collect wood'), 'I reached my cost limit and do not work on goals by myself now.');
        assert.deepEqual(started, []);
        agent.cost_meter = meterIn('normal');
        await action('!goal').perform(agent, 'collect wood');
        assert.deepEqual(started, ['collect wood']);
        delete agent.cost_meter;
        await action('!goal').perform(agent, 'collect stone');
        assert.deepEqual(started, ['collect wood', 'collect stone'], 'without a meter as before');
    });

    test('a meter whose allows() throws counts as allowing, with a warning', async () => {
        const started = [];
        const agent = { cost_meter: { allows() { throw new Error('boom'); } }, self_prompter: { start: (p) => started.push(p), setPromptPaused() {} } };
        await action('!goal').perform(agent, 'collect wood');
        assert.deepEqual(started, ['collect wood']);
        assert.ok(cap.of('warn').length >= 1);
    });

    function selfPrompterWith(meter) {
        const agent = {
            cost_meter: meter,
            messages: [],
            async handleMessage(source, message) {
                agent.messages.push(message);
                await new Promise((r) => setTimeout(r, 5));
                return true; // a command was used, so the loop goes on
            },
            isIdle: () => true,
            openChat() {},
            actions: { async stop() {} },
        };
        const sp = new M.selfPrompter.SelfPrompter(agent);
        sp.cooldown = 10;
        return { agent, sp };
    }

    test('self prompter: in the state saving the loop does not start, and it starts when the state is back', async () => {
        const meter = meterIn('saving');
        const { agent, sp } = selfPrompterWith(meter);
        await sp.start('collect wood');
        assert.equal(sp.isActive(), true, 'the goal stays');
        assert.equal(sp.loop_active, false);
        assert.deepEqual(agent.messages, []);
        sp.update(5000);
        assert.equal(sp.loop_active, false, 'update() does not start it while saving');
        agent.cost_meter = meterIn('normal');
        sp.update(5000);
        assert.equal(sp.loop_active, true, 'update() starts it again');
        await sp.stop(false);
        await new Promise((r) => setTimeout(r, 600));
        assert.ok(agent.messages.length >= 1);
    });

    test('self prompter: a running loop stops when the state becomes saving', async () => {
        const state = { value: 'normal' };
        const meter = { allows: (what) => !(state.value === 'saving' && what === 'self_prompt') };
        const { agent, sp } = selfPrompterWith(meter);
        sp.start('collect wood');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(sp.loop_active, true);
        state.value = 'saving';
        sp.update(300);
        await new Promise((r) => setTimeout(r, 700));
        assert.equal(sp.loop_active, false, 'the loop stopped');
        assert.equal(sp.isActive(), true, 'the goal stays for later');
        const count = agent.messages.length;
        sp.update(5000);
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(agent.messages.length, count, 'no new round while saving');
    });

    test('skill manager: the review is skipped with the reason cost_limit, no model call', async () => {
        const root = makeTmpDir();
        try {
            const calls = [];
            let allowed = false;
            const manager = new SM.SkillManager({
                name: 'andy', botsDir: root, settings: { allow_insecure_coding: true, skill_learning: true },
                prompter: { async promptSkillReview(text) { calls.push(text); return 'no json'; } },
                makeCompartment: LOCK.makeCompartment, endowments: makeEndowments(), getInventoryCounts: inventoryOf,
                builtinNames: [], reviewTemplate: '$CODE', allowReview: () => allowed,
            });
            await manager.init();
            const code = 'async function buildDirtWall(bot, length) {\n    /**\n     * Builds a wall.\n     **/\n    for (let i = 0; i < length; i++) {\n        await skills.wait(bot, 1);\n    }\n    return true;\n}\nawait buildDirtWall(bot, 3);';
            const run = { code, output: 'ok', task: 'build a wall', before: {}, after: {}, interrupted: false, threw: false };
            const refused = await manager.captureFromRun(run);
            assert.equal(refused.saved, false);
            assert.equal(refused.reason, 'cost_limit');
            assert.equal(refused.name, 'buildDirtWall');
            assert.deepEqual(calls, []);
            allowed = true;
            const reviewed = await manager.captureFromRun(run);
            assert.equal(reviewed.reason, 'review_failed', 'with the meter allowing, the review is called');
            assert.equal(calls.length, 1);
        } finally {
            removeTmpDir(root);
        }
    });

    test('skill manager: without allowReview, or when it throws, the review is called as before', async () => {
        const root = makeTmpDir();
        try {
            for (const allowReview of [undefined, () => { throw new Error('boom'); }]) {
                const calls = [];
                const manager = new SM.SkillManager({
                    name: 'andy', botsDir: root, settings: { allow_insecure_coding: true, skill_learning: true },
                    prompter: { async promptSkillReview(text) { calls.push(text); return 'no json'; } },
                    makeCompartment: LOCK.makeCompartment, endowments: makeEndowments(), getInventoryCounts: inventoryOf,
                    builtinNames: [], reviewTemplate: '$CODE', allowReview,
                });
                await manager.init();
                const code = 'async function digHole(bot, depth) {\n    /**\n     * Digs.\n     **/\n    for (let i = 0; i < depth; i++) {\n        await skills.wait(bot, 1);\n    }\n    return true;\n}\nawait digHole(bot, 3);';
                const result = await manager.captureFromRun({ code, output: 'ok', task: 'dig', before: {}, after: {}, interrupted: false, threw: false });
                assert.equal(result.reason, 'review_failed');
                assert.equal(calls.length, 1);
            }
        } finally {
            removeTmpDir(root);
        }
    });
});

describe('!cost', () => {
    test('with a meter: summaryText()', () => {
        const meter = new COST.CostMeter({ settings: { cost_warn_per_hour: 3, cost_limit_per_hour: 8, cost_limit_per_session: 10 } });
        assert.equal(query('!cost').perform({ cost_meter: meter }), meter.summaryText());
        assert.match(query('!cost').perform({ cost_meter: meter }), /^Cost: session \$0\.00, 0 calls\.\nBudget: warn at \$3 per hour, limit \$8 per hour, limit \$10 per session\. State: normal\.$/);
    });

    test('without a meter: The cost meter is off.', () => {
        assert.equal(query('!cost').perform({}), 'The cost meter is off.');
    });

    test('a meter that throws: a short text and a warning', () => {
        assert.equal(query('!cost').perform({ cost_meter: { summaryText() { throw new Error('boom'); } } }), 'Could not read the cost meter.');
        assert.ok(cap.of('warn').length >= 1);
    });
});

describe('the agent', () => {
    const Agent = () => M.agent.Agent;

    test('_costAllows: true without a meter and when allows() throws, false while saving', () => {
        const call = (agent, what) => Agent().prototype._costAllows.call(agent, what);
        assert.equal(call({}, 'coding'), true);
        assert.equal(call({ cost_meter: meterIn('saving') }, 'coding'), false);
        assert.equal(call({ cost_meter: meterIn('saving') }, 'chat'), true);
        assert.equal(call({ cost_meter: meterIn('normal') }, 'skill_review'), true);
        assert.equal(call({ cost_meter: { allows() { throw new Error('boom'); } } }, 'coding'), true);
    });

    describe('cleanKill prints the report line and calls flush() before the exit', () => {
        let exits;
        let realExit;
        beforeEach(() => {
            exits = [];
            realExit = process.exit;
            process.exit = (code) => exits.push({ code, text: cap.allText() });
        });
        afterEach(() => {
            process.exit = realExit;
        });

        test('with a real meter: the line, then flush() writes usage.json, then the exit', () => {
            const dir = makeTmpDir();
            try {
                const file = path.join(dir, 'usage.json');
                const meter = new COST.CostMeter({ settings: {}, filePath: file });
                const agent = { name: 'andy', cost_meter: meter, history: { add() {}, save() {} }, bot: { chat() {} } };
                Agent().prototype.cleanKill.call(agent, 'bye', 1);
                assert.equal(exits.length, 1);
                assert.ok(exits[0].text.includes('Agent process ends with exit code 1: bye'));
                assert.ok(exits[0].text.includes('Cost: session $0.00, 0 calls.'), exits[0].text);
                assert.ok(fs.existsSync(file), 'flush() wrote the file before the exit');
                assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.length, 1);
            } finally {
                removeTmpDir(dir);
            }
        });

        test('a meter that throws does not stop the exit, flush() is still called', () => {
            const events = [];
            const meter = { reportLine() { throw new Error('boom'); }, flush() { events.push('flush'); throw new Error('boom'); } };
            const agent = { name: 'andy', cost_meter: meter };
            assert.doesNotThrow(() => Agent().prototype.cleanKill.call(agent, 'bye', 2));
            assert.deepEqual(events, ['flush']);
            assert.deepEqual(exits.map((e) => e.code), [2]);
        });

        test('without a meter: no cost line', () => {
            Agent().prototype.cleanKill.call({ name: 'andy' }, 'bye', 1);
            assert.ok(!exits[0].text.includes('Cost:'));
        });
    });

    test('agent.js: the disconnect handler reports the cost before its process.exit(1)', () => {
        const text = readRepoFile('src/agent/agent.js');
        const at = text.indexOf('const onDisconnect');
        assert.ok(at > 0);
        const body = text.slice(at, text.indexOf('};', at));
        const report = body.indexOf('reportCostAtExit(this.cost_meter)');
        assert.ok(report > 0, 'the handler reports the cost');
        assert.ok(report < body.indexOf('process.exit(1)'), 'before the exit');
    });
});
