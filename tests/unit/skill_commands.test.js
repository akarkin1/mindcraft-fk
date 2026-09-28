// Spec v0.1.4.4 K8: the commands of src/agent/commands/actions.js and queries.js --
// !skills, !forgetSkill, !disableSkill, !enableSkill, !useSkill, and the capture step of !newAction.
//
// The real command lists are imported and perform() is called with a fake agent that carries a
// fake skill_manager. Import notes as in commands_places.test.js: commands/index.js is imported
// first (actions.js alone hits an import cycle), with the working directory set to an empty
// temp directory. The fake agent.actions.runAction runs the function and returns
// { success: true, message: bot.output }, like the real one does for a finished action.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeEndowments } from '../helpers/skill_env.js';

async function importCommands() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        const settingsModule = await loadSrc('src/agent/settings.js');
        return { actions, queries, settings: settingsModule.default };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { actions, queries, settings } = await importCommands();

function action(name) {
    const cmd = actions.actionsList.find((c) => c.name === name);
    assert.ok(cmd, `${name} is in actionsList`);
    return cmd;
}
function query(name) {
    const cmd = queries.queryList.find((c) => c.name === name);
    assert.ok(cmd, `${name} is in queryList`);
    return cmd;
}

const OFF_TEXT = 'Skill learning is off.';
const LIST_TEXT = 'Saved skills:\n- buildWall(bot, length): Builds a wall. (used 2 times, 0 failed)';
const COULD_NOT_READ = `Could not read the arguments. Write them as a list, for example "[3, 'oak_log']".`;
const noSkill = (name) => `No skill named "${name}" is saved.`;
const CAPTURE_MESSAGE = 'Saved this code as the skill customSkills.buildWall. You can call it in later code.';
const SUMMARY = 'Agent wrote this code: \n```await buildWall(bot, 3);```\nCode Output:\nWall built.';

let cap;
let savedSettings;
beforeEach(() => {
    cap = captureConsole();
    savedSettings = { ...settings };
});
afterEach(() => {
    cap.restore();
    for (const key of Object.keys(settings)) delete settings[key];
    Object.assign(settings, savedSettings);
});

// A fake manager with the members the commands use. Skills: buildWall logs output, quietSkill
// logs nothing, breaker fails with an error text; anything else is unknown. `notices` are what
// takeNotices() returns once (v0.1.4.5, G1); `notices` an Error makes takeNotices() throw it.
function makeManager({ capture, notices = [], reuse = true } = {}) {
    const calls = [];
    const known = new Set(['buildWall', 'quietSkill', 'breaker']);
    let queued = notices;
    const manager = {
        calls,
        flags: { capture: true, reuse, command: reuse },
        takeNotices() {
            calls.push(['takeNotices']);
            if (queued instanceof Error) throw queued;
            const taken = queued;
            queued = [];
            return taken;
        },
        customSkills: Object.freeze({ buildWall: async () => true, quietSkill: async () => true, breaker: async () => { throw new Error('boom'); } }),
        knownNames: () => [...known].sort().map((n) => `customSkills.${n}`),
        has(name) {
            calls.push(['has', name]);
            return known.has(name);
        },
        listText() {
            calls.push(['listText']);
            return LIST_TEXT;
        },
        forget(name) {
            calls.push(['forget', name]);
            return known.has(name);
        },
        setStatus(name, status) {
            calls.push(['setStatus', name, status]);
            return known.has(name) && (status === 'active' || status === 'disabled');
        },
        async run(name, args, bot) {
            calls.push(['run', name, args, bot]);
            if (!known.has(name)) return { ok: false, result: undefined, error: 'unknown_skill' };
            if (name === 'breaker') return { ok: false, result: undefined, error: 'Error: boom' };
            if (name === 'buildWall') bot.output += `Placed ${args[0]} blocks.\n`;
            return { ok: true, result: true, error: null };
        },
        async captureFromRun(run) {
            calls.push(['captureFromRun', run]);
            if (capture instanceof Error) throw capture;
            return capture ?? { saved: false, action: null, name: null, reason: 'not_reusable', errors: [], message: '' };
        },
    };
    return manager;
}

function makeAgent({ manager, lastRun = null } = {}) {
    const bot = { username: 'andy', output: '', interrupt_code: false, entity: { position: { x: 0, y: 64, z: 0 } } };
    const agent = {
        name: 'andy',
        bot,
        history: { name: 'fake history' },
        chats: [],
        actions: {
            calls: [],
            async runAction(label, fn, options) {
                this.calls.push({ label, options });
                bot.output = '';
                await fn();
                return { success: true, message: bot.output };
            },
        },
        coder: {
            last_run: null,
            generateCalls: [],
            // Like the real coder: last_run is set during generateCode.
            async generateCode(history) {
                this.generateCalls.push(history);
                this.last_run = lastRun;
                return SUMMARY;
            },
        },
        openChat(message) {
            agent.chats.push(message);
        },
        isIdle: () => true,
    };
    if (manager !== undefined) agent.skill_manager = manager;
    return agent;
}

// Text visible to the model: the returned message plus anything left in bot.output.
const seen = (agent, returned) => `${returned ?? ''}\n${agent.bot.output}`;

describe('the command list', () => {
    test('!skills is a query without parameters', () => {
        const cmd = query('!skills');
        assert.equal(typeof cmd.description, 'string');
        assert.ok(cmd.description.length > 0);
        assert.deepEqual(Object.keys(cmd.params ?? {}), []);
        assert.equal(actions.actionsList.some((c) => c.name === '!skills'), false);
    });

    for (const name of ['!forgetSkill', '!disableSkill', '!enableSkill']) {
        test(`${name} is an action with one string parameter "name"`, () => {
            const cmd = action(name);
            assert.deepEqual(Object.keys(cmd.params ?? {}), ['name']);
            assert.equal(cmd.params.name.type, 'string');
            assert.equal(typeof cmd.description, 'string');
            assert.ok(cmd.description.length > 0);
        });
    }

    test('!useSkill is an action with the string parameters "name" and "args"', () => {
        const cmd = action('!useSkill');
        assert.deepEqual(Object.keys(cmd.params ?? {}), ['name', 'args']);
        assert.equal(cmd.params.name.type, 'string');
        assert.equal(cmd.params.args.type, 'string');
        assert.equal(typeof cmd.description, 'string');
        assert.ok(cmd.description.length > 0);
    });
});

describe('!skills', () => {
    test('returns listText() of the manager', async () => {
        const manager = makeManager();
        assert.equal(await query('!skills').perform(makeAgent({ manager })), LIST_TEXT);
        assert.deepEqual(manager.calls, [['listText']]);
    });

    test(`without a manager: "${OFF_TEXT}"`, async () => {
        assert.equal(await query('!skills').perform(makeAgent()), OFF_TEXT);
    });
});

describe('!forgetSkill, !disableSkill, !enableSkill', () => {
    const CASES = [
        ['!forgetSkill', ['forget', 'buildWall'], 'Forgot the skill "buildWall".'],
        ['!disableSkill', ['setStatus', 'buildWall', 'disabled'], 'Disabled the skill "buildWall".'],
        ['!enableSkill', ['setStatus', 'buildWall', 'active'], 'Enabled the skill "buildWall".'],
    ];
    for (const [name, expectedCall, reply] of CASES) {
        test(`${name}: calls the manager and replies "${reply}"`, async () => {
            const manager = makeManager();
            const agent = makeAgent({ manager });
            assert.equal(await action(name).perform(agent, 'buildWall'), reply);
            assert.deepEqual(manager.calls, [expectedCall]);
        });

        test(`${name}: unknown skill replies "No skill named ... is saved."`, async () => {
            const agent = makeAgent({ manager: makeManager() });
            assert.equal(await action(name).perform(agent, 'nothingHere'), noSkill('nothingHere'));
        });

        test(`${name}: without a manager replies "${OFF_TEXT}"`, async () => {
            assert.equal(await action(name).perform(makeAgent(), 'buildWall'), OFF_TEXT);
        });

        test(`${name}: an error of the manager does not throw out of perform`, async () => {
            const manager = makeManager();
            manager.forget = () => {
                throw new Error('store broken');
            };
            manager.setStatus = () => {
                throw new Error('store broken');
            };
            await assert.doesNotReject(async () => {
                await action(name).perform(makeAgent({ manager }), 'buildWall');
            });
        });
    }
});

describe('!useSkill(name, args)', () => {
    async function useSkill(agent, name, args) {
        const returned = await action('!useSkill').perform(agent, name, args);
        return seen(agent, returned);
    }

    test('runs through agent.actions.runAction("action:useSkill", ...) and passes bot and the parsed arguments', async () => {
        const manager = makeManager();
        const agent = makeAgent({ manager });
        const text = await useSkill(agent, 'buildWall', '[3, "oak_log"]');
        assert.deepEqual(agent.actions.calls.map((c) => c.label), ['action:useSkill']);
        const runs = manager.calls.filter((c) => c[0] === 'run');
        assert.equal(runs.length, 1);
        assert.deepEqual(runs[0].slice(1, 3), ['buildWall', [3, 'oak_log']]);
        assert.equal(runs[0][3], agent.bot);
        assert.ok(text.includes('Placed 3 blocks.'), text);
    });

    test("single quotes are accepted in place of double quotes", async () => {
        const manager = makeManager();
        await useSkill(makeAgent({ manager }), 'buildWall', "[3, 'oak_log']");
        assert.deepEqual(manager.calls.find((c) => c[0] === 'run').slice(1, 3), ['buildWall', [3, 'oak_log']]);
    });

    test('an empty text means no arguments', async () => {
        const manager = makeManager();
        await useSkill(makeAgent({ manager }), 'quietSkill', '');
        assert.deepEqual(manager.calls.find((c) => c[0] === 'run').slice(1, 3), ['quietSkill', []]);
    });

    for (const [label, args] of [['not JSON', 'three and oak'], ['an object', '{"a": 1}'], ['a number', '3'], ['a string', '"oak_log"'], ['cut JSON', '[3, ']]) {
        test(`arguments that are not a list (${label}): "Could not read the arguments ..."; the skill does not run`, async () => {
            const manager = makeManager();
            const agent = makeAgent({ manager });
            const text = await useSkill(agent, 'buildWall', args);
            assert.ok(text.includes(COULD_NOT_READ), text);
            assert.equal(manager.calls.some((c) => c[0] === 'run'), false);
        });
    }

    test('unknown skill: "No skill named ... is saved."', async () => {
        const text = await useSkill(makeAgent({ manager: makeManager() }), 'nothingHere', '[]');
        assert.ok(text.includes(noSkill('nothingHere')), text);
    });

    test('a throw of the skill: "The skill ... failed: <error>"', async () => {
        const text = await useSkill(makeAgent({ manager: makeManager() }), 'breaker', '[]');
        assert.ok(text.includes('The skill "breaker" failed: Error: boom'), text);
    });

    test('otherwise the action output of the run', async () => {
        const text = await useSkill(makeAgent({ manager: makeManager() }), 'buildWall', '[5]');
        assert.ok(text.includes('Placed 5 blocks.'), text);
        assert.ok(!text.includes('finished.'), text);
    });

    test('a skill that logged nothing: "The skill ... finished."', async () => {
        const text = await useSkill(makeAgent({ manager: makeManager() }), 'quietSkill', '[]');
        assert.ok(text.includes('The skill "quietSkill" finished.'), text);
    });

    test(`without a manager: does not throw out of perform and replies "${OFF_TEXT}"`, async () => {
        let returned;
        await assert.doesNotReject(async () => {
            returned = await action('!useSkill').perform(makeAgent(), 'buildWall', '[]');
        });
        assert.equal(returned, OFF_TEXT);
    });
});

describe('!useSkill checks the name first (Amendment 1, A5)', () => {
    test('a name that is not a loaded skill: "No skill named ..." WITHOUT runAction, so the running action is not stopped', async () => {
        const manager = makeManager();
        const agent = makeAgent({ manager });
        const returned = await action('!useSkill').perform(agent, 'nothingHere', '[3]');
        assert.equal(returned, noSkill('nothingHere'));
        assert.deepEqual(agent.actions.calls, [], 'runAction is not called');
        assert.deepEqual(manager.calls, [['has', 'nothingHere']]);
    });

    test('the name is checked before the arguments', async () => {
        const manager = makeManager();
        const agent = makeAgent({ manager });
        assert.equal(await action('!useSkill').perform(agent, 'nothingHere', 'three and oak'), noSkill('nothingHere'));
        assert.deepEqual(agent.actions.calls, []);
    });

    test('a known name still runs through runAction', async () => {
        const manager = makeManager();
        const agent = makeAgent({ manager });
        await action('!useSkill').perform(agent, 'buildWall', '[2]');
        // v0.1.4.5, G1: the notices are taken after the run
        assert.deepEqual(manager.calls.map((c) => c[0]), ['has', 'run', 'takeNotices']);
        assert.deepEqual(agent.actions.calls.map((c) => c.label), ['action:useSkill']);
    });

    test('has() throws: no throw out of perform, "No skill named ...", runAction is not called', async () => {
        const manager = makeManager();
        manager.has = () => {
            throw new Error('store broken');
        };
        const agent = makeAgent({ manager });
        let returned;
        await assert.doesNotReject(async () => {
            returned = await action('!useSkill').perform(agent, 'buildWall', '[]');
        });
        assert.equal(returned, noSkill('buildWall'));
        assert.deepEqual(agent.actions.calls, []);
    });

    test('with a real SkillManager: names of Object.prototype are no skills, a saved skill runs', async () => {
        const MANAGER = await loadSrc('src/agent/skills/skill_manager.js');
        const STORE = await loadSrc('src/agent/skills/skill_store.js');
        const LOCK = await loadSrc('src/agent/library/lockdown.js');
        const root = makeTmpDir();
        try {
            const store = new STORE.SkillStore(`${root}/andy/skills`);
            store.load();
            store.save({ name: 'addUp', source: 'async function addUp(bot, a, b) {\n    /** Adds two numbers. */\n    return a + b;\n}\n', description: 'Adds two numbers.', signature: 'addUp(bot, a, b)' });
            const manager = new MANAGER.SkillManager({
                name: 'andy', botsDir: root, settings: { allow_insecure_coding: true, skill_learning: true, skill_command: true },
                prompter: {}, makeCompartment: LOCK.makeCompartment, endowments: makeEndowments(), getInventoryCounts: () => ({}),
                builtinNames: [], reviewTemplate: '',
            });
            assert.equal(manager.init(), 1);
            const agent = makeAgent({ manager });
            for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
                assert.equal(await action('!useSkill').perform(agent, name, '[]'), noSkill(name), name);
            }
            assert.deepEqual(agent.actions.calls, [], 'runAction is not called for any of them');
            assert.equal(await action('!useSkill').perform(agent, 'addUp', '[2, 3]'), 'The skill "addUp" finished.');
            assert.equal(agent.actions.calls.length, 1);
            assert.equal(store.get('addUp').uses, 0, 'the other store instance is not the one that counts');
            assert.equal(manager.store.get('addUp').uses, 1);
        } finally {
            removeTmpDir(root);
        }
    });
});

describe('!newAction: the capture step', () => {
    const LAST_RUN = Object.freeze({ code: 'await buildWall(bot, 3);', output: 'Wall built.', task: 'build a wall', before: {}, after: {}, interrupted: false, threw: false });

    beforeEach(() => {
        settings.allow_insecure_coding = true;
        settings.code_timeout_mins = -1;
    });

    test('saved: the returned text is followed by a line break and the capture message', async () => {
        const manager = makeManager({ capture: { saved: true, action: 'created', name: 'buildWall', reason: null, errors: [], message: CAPTURE_MESSAGE } });
        const agent = makeAgent({ manager, lastRun: LAST_RUN });
        const reply = await action('!newAction').perform(agent, 'build a wall');
        assert.equal(reply, SUMMARY + '\n' + CAPTURE_MESSAGE);
        const captures = manager.calls.filter((c) => c[0] === 'captureFromRun');
        assert.equal(captures.length, 1);
        assert.equal(captures[0][1], LAST_RUN, 'captureFromRun gets agent.coder.last_run');
    });

    test('not saved: the text is unchanged', async () => {
        const manager = makeManager();
        const reply = await action('!newAction').perform(makeAgent({ manager, lastRun: LAST_RUN }), 'build a wall');
        assert.equal(reply, SUMMARY);
        assert.equal(manager.calls.filter((c) => c[0] === 'captureFromRun').length, 1);
    });

    test('last_run is null: no capture, the text is unchanged', async () => {
        const manager = makeManager({ capture: { saved: true, action: 'created', name: 'buildWall', reason: null, errors: [], message: CAPTURE_MESSAGE } });
        const reply = await action('!newAction').perform(makeAgent({ manager, lastRun: null }), 'build a wall');
        assert.equal(reply, SUMMARY);
        assert.equal(manager.calls.some((c) => c[0] === 'captureFromRun'), false);
    });

    test('no manager: the text is unchanged', async () => {
        const reply = await action('!newAction').perform(makeAgent({ lastRun: LAST_RUN }), 'build a wall');
        assert.equal(reply, SUMMARY);
    });

    test('captureFromRun rejects: no throw, the text is unchanged', async () => {
        const manager = makeManager({ capture: new Error('capture failed') });
        let reply;
        await assert.doesNotReject(async () => {
            reply = await action('!newAction').perform(makeAgent({ manager, lastRun: LAST_RUN }), 'build a wall');
        });
        assert.equal(reply, SUMMARY);
    });

    // v0.1.4.5, G2: the message is appended whenever it is not empty, not only when saved.
    test('not saved, but with a message (the library is full): the message is appended', async () => {
        const FULL = 'The skill library is full (100 skills), so this code was not saved as a skill. Use !forgetSkill to remove a skill that is no longer needed.';
        const manager = makeManager({ capture: { saved: false, action: null, name: 'buildWall', reason: 'library_full', errors: [], message: FULL } });
        const reply = await action('!newAction').perform(makeAgent({ manager, lastRun: LAST_RUN }), 'build a wall');
        assert.equal(reply, SUMMARY + '\n' + FULL);
    });

    test('a message that is not a string is not appended', async () => {
        const manager = makeManager({ capture: { saved: false, action: null, name: null, reason: 'error', errors: [], message: undefined } });
        const reply = await action('!newAction').perform(makeAgent({ manager, lastRun: LAST_RUN }), 'build a wall');
        assert.equal(reply, SUMMARY);
    });
});

// v0.1.4.5, G1: !newAction and !useSkill call takeNotices() after the run and after the capture and
// append every notice to their result text, each on its own line. With flags.reuse only, in try/catch.
describe('the notices of the skill manager (v0.1.4.5, G1)', () => {
    const LAST_RUN = Object.freeze({ code: 'await buildWall(bot, 3);', output: 'Wall built.', task: 'build a wall', before: {}, after: {}, interrupted: false, threw: false });
    const N1 = 'The skill customSkills.breaker was switched off after 3 errors in a row. Last error: Error: boom. Write a corrected version of the function under the same name to switch it on again.';
    const N2 = 'Second notice.';

    beforeEach(() => {
        settings.allow_insecure_coding = true;
        settings.code_timeout_mins = -1;
    });

    test('!newAction: after the capture message, each notice on its own line; takeNotices comes after the capture', async () => {
        const manager = makeManager({ notices: [N1, N2], capture: { saved: true, action: 'created', name: 'buildWall', reason: null, errors: [], message: CAPTURE_MESSAGE } });
        const reply = await action('!newAction').perform(makeAgent({ manager, lastRun: LAST_RUN }), 'build a wall');
        assert.equal(reply, SUMMARY + '\n' + CAPTURE_MESSAGE + '\n' + N1 + '\n' + N2);
        assert.deepEqual(manager.calls.map((c) => c[0]), ['captureFromRun', 'takeNotices']);
    });

    test('!newAction: the notices come also when there is nothing to capture (the code threw, last_run is null)', async () => {
        const manager = makeManager({ notices: [N1] });
        const reply = await action('!newAction').perform(makeAgent({ manager, lastRun: null }), 'build a wall');
        assert.equal(reply, SUMMARY + '\n' + N1);
        assert.deepEqual(manager.calls.map((c) => c[0]), ['takeNotices']);
    });

    test('!newAction: the notices come also when the capture fails', async () => {
        const manager = makeManager({ notices: [N1], capture: new Error('capture failed') });
        const reply = await action('!newAction').perform(makeAgent({ manager, lastRun: LAST_RUN }), 'build a wall');
        assert.equal(reply, SUMMARY + '\n' + N1);
    });

    test('!newAction: reuse off: takeNotices is not called', async () => {
        const manager = makeManager({ notices: [N1], reuse: false });
        const reply = await action('!newAction').perform(makeAgent({ manager, lastRun: LAST_RUN }), 'build a wall');
        assert.equal(reply, SUMMARY);
        assert.equal(manager.calls.some((c) => c[0] === 'takeNotices'), false);
    });

    test('!newAction: takeNotices throws: no throw, the text is unchanged, a warning', async () => {
        const manager = makeManager({ notices: new Error('notices broke') });
        let reply;
        await assert.doesNotReject(async () => {
            reply = await action('!newAction').perform(makeAgent({ manager, lastRun: LAST_RUN }), 'build a wall');
        });
        assert.equal(reply, SUMMARY);
        assert.ok(cap.of('warn').some((r) => r.text.includes('notices broke')));
    });

    test('!newAction: no manager: nothing is taken, the text is unchanged', async () => {
        assert.equal(await action('!newAction').perform(makeAgent({ lastRun: LAST_RUN }), 'build a wall'), SUMMARY);
    });

    // Decision of the tech lead for v0.1.4.5: the line break at the end of the action output is
    // removed before a notice is appended, so exactly one line break separates them.
    const USE_CASES = [
        ['a throw of the skill', 'breaker', '[]', 'The skill "breaker" failed: Error: boom'],
        ['the action output', 'buildWall', '[5]', 'Placed 5 blocks.'],
        ['a skill that logged nothing', 'quietSkill', '[]', 'The skill "quietSkill" finished.'],
    ];
    for (const [label, name, args, text] of USE_CASES) {
        test(`!useSkill, ${label}: the notices follow the reply, each on its own line`, async () => {
            const manager = makeManager({ notices: [N1, N2] });
            const reply = await action('!useSkill').perform(makeAgent({ manager }), name, args);
            assert.equal(reply, text + '\n' + N1 + '\n' + N2);
            assert.deepEqual(manager.calls.map((c) => c[0]), ['has', 'run', 'takeNotices']);
        });
    }

    // Decision of the tech lead for v0.1.4.5: trailing whitespace and line breaks of the text before
    // an appended notice or capture message are removed first; with nothing appended the text is unchanged.
    describe('exactly one line break before an appended line', () => {
        const withCode = (agent, text) => {
            agent.coder.generateCode = async function () {
                this.last_run = LAST_RUN;
                return text;
            };
            return agent;
        };
        const MESSY = SUMMARY + '\n\n  \t\r\n';

        test('!newAction: before the capture message', async () => {
            const manager = makeManager({ capture: { saved: true, action: 'created', name: 'buildWall', reason: null, errors: [], message: CAPTURE_MESSAGE } });
            const reply = await action('!newAction').perform(withCode(makeAgent({ manager }), MESSY), 'build a wall');
            assert.equal(reply, SUMMARY + '\n' + CAPTURE_MESSAGE);
        });

        test('!newAction: before the notices, also after a capture message', async () => {
            const manager = makeManager({ notices: [N1, N2] });
            const reply = await action('!newAction').perform(withCode(makeAgent({ manager }), MESSY), 'build a wall');
            assert.equal(reply, SUMMARY + '\n' + N1 + '\n' + N2);
        });

        test('!newAction: nothing appended: the text is unchanged, trailing line breaks included', async () => {
            const manager = makeManager();
            const reply = await action('!newAction').perform(withCode(makeAgent({ manager }), MESSY), 'build a wall');
            assert.equal(reply, MESSY);
            assert.equal(await action('!newAction').perform(withCode(makeAgent(), MESSY), 'build a wall'), MESSY, 'no manager');
        });

        test('!useSkill: the action output ending with line breaks and nothing appended is unchanged', async () => {
            const reply = await action('!useSkill').perform(makeAgent({ manager: makeManager() }), 'buildWall', '[5]');
            assert.equal(reply, 'Placed 5 blocks.\n');
        });

        test('!useSkill: an action output with several trailing line breaks and spaces before a notice', async () => {
            const manager = makeManager({ notices: [N1] });
            manager.run = async (name, args, bot) => {
                bot.output += 'Placed 2 blocks.\n\n   \n';
                return { ok: true, result: true, error: null };
            };
            const reply = await action('!useSkill').perform(makeAgent({ manager }), 'buildWall', '[2]');
            assert.equal(reply, 'Placed 2 blocks.\n' + N1);
        });
    });

    test('!useSkill: the skill was switched off before it ran: "No skill named ..." and the notices', async () => {
        const manager = makeManager({ notices: [N1] });
        manager.run = async () => ({ ok: false, result: null, error: 'unknown_skill' });
        const reply = await action('!useSkill').perform(makeAgent({ manager }), 'breaker', '[]');
        assert.equal(reply, noSkill('breaker') + '\n' + N1);
    });

    test('!useSkill: an interrupted run returns nothing and leaves the notices queued', async () => {
        const manager = makeManager({ notices: [N1] });
        const agent = makeAgent({ manager });
        agent.actions.runAction = async (label, fn) => {
            await fn();
            return { success: false, interrupted: true, timedout: false, message: '' };
        };
        assert.equal(await action('!useSkill').perform(agent, 'buildWall', '[1]'), undefined);
        assert.equal(manager.calls.some((c) => c[0] === 'takeNotices'), false);
    });

    test('!useSkill: an unknown name does not take the notices (nothing ran)', async () => {
        const manager = makeManager({ notices: [N1] });
        assert.equal(await action('!useSkill').perform(makeAgent({ manager }), 'nothingHere', '[]'), noSkill('nothingHere'));
        assert.equal(manager.calls.some((c) => c[0] === 'takeNotices'), false);
    });

    test('!useSkill: reuse off: takeNotices is not called', async () => {
        const manager = makeManager({ notices: [N1], reuse: false });
        const reply = await action('!useSkill').perform(makeAgent({ manager }), 'quietSkill', '[]');
        assert.equal(reply, 'The skill "quietSkill" finished.');
        assert.equal(manager.calls.some((c) => c[0] === 'takeNotices'), false);
    });

    test('!useSkill: takeNotices throws: no throw, the reply is unchanged', async () => {
        const manager = makeManager({ notices: new Error('notices broke') });
        let reply;
        await assert.doesNotReject(async () => {
            reply = await action('!useSkill').perform(makeAgent({ manager }), 'breaker', '[]');
        });
        assert.equal(reply, 'The skill "breaker" failed: Error: boom');
    });

    test('with a real SkillManager: the third throw in a row brings the notice, then the skill is gone', async () => {
        const MANAGER = await loadSrc('src/agent/skills/skill_manager.js');
        const STORE = await loadSrc('src/agent/skills/skill_store.js');
        const LOCK = await loadSrc('src/agent/library/lockdown.js');
        const root = makeTmpDir();
        try {
            const store = new STORE.SkillStore(`${root}/andy/skills`);
            store.load();
            store.save({ name: 'thrower', source: 'async function thrower(bot) {\n    /** Always throws. */\n    throw new Error("no path");\n}\n', description: 'Always throws.', signature: 'thrower(bot)' });
            const manager = new MANAGER.SkillManager({
                name: 'andy', botsDir: root, settings: { allow_insecure_coding: true, skill_learning: true, skill_command: true },
                prompter: {}, makeCompartment: LOCK.makeCompartment, endowments: makeEndowments(), getInventoryCounts: () => ({}),
                builtinNames: [], reviewTemplate: '',
            });
            assert.equal(manager.init(), 1);
            const agent = makeAgent({ manager });
            const failed = 'The skill "thrower" failed: Error: no path';
            assert.equal(await action('!useSkill').perform(agent, 'thrower', '[]'), failed);
            assert.equal(await action('!useSkill').perform(agent, 'thrower', '[]'), failed);
            assert.equal(await action('!useSkill').perform(agent, 'thrower', '[]'), failed + '\n'
                + 'The skill customSkills.thrower was switched off after 3 errors in a row. Last error: Error: no path. '
                + 'Write a corrected version of the function under the same name to switch it on again.');
            assert.equal(manager.has('thrower'), false, 'reloaded by takeNotices()');
            assert.equal(await action('!useSkill').perform(agent, 'thrower', '[]'), noSkill('thrower'));
            assert.equal(agent.actions.calls.length, 3, 'the fourth call does not reach runAction');
        } finally {
            removeTmpDir(root);
        }
    });
});
