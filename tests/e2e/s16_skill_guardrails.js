// S16 skill_guardrails (v0.1.4.5, SPEC_v0.1.4.5_GUARDRAILS G1, G2, G3, G4, and the decisions of the
// tech lead: !enableSkill resets consecutive_errors, a notice follows the text before after exactly
// one line break, !restart is blocked in the fork's settings.js). The real Agent.start with
// skill_learning on and the lockdown ON, the real !newAction, !useSkill and command parser, a real
// bot on the simulated server; only the model is canned. Skills saved in an earlier session are
// put into bots/<name>/skills with an index.json of v0.1.4.4 (without consecutive_errors).
// errors     G1: a skill that throws three times in a row, called from generated code through
//            !newAction, is switched off: the reply of the third !newAction ends with the notice
//            of the spec with the last error; afterwards it is not offered in the coding prompt,
//            the lint refuses a call of it, !skills shows it as disabled, the index on disk has the
//            status. A run that returns false in between does not count and does not reset; a run
//            that returns anything else resets. A corrected version under the same name, and
//            !enableSkill, switch it on again with the counter at 0. The running code keeps
//            working: code that calls a failing skill four times in one run, catching the errors,
//            still reaches the skill each time and then calls another saved skill; one notice.
//            !useSkill gets the notice as well. G4: a skill that tries to replace the name
//            customSkills at run time and in a microtask it starts does not succeed, and the other
//            skills keep calling each other correctly. !restart is not offered and is refused.
// noDisable  skill_disable_after_errors 0: nothing is switched off.
// limit      skill_max_count 2 (one active, one disabled skill saved): a third function is not
//            saved, no review request reaches the model, the reply ends with the message of the
//            spec; a trivial new function gets no message at all (the trivial check comes first);
//            a new version of a saved skill is accepted, also a trivial one (G3); after
//            !forgetSkill a new skill is saved again.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand, runPhase,
    codeReply, readJson, listFiles, withTimeout, importProject, endsWithLine,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const STAMP = '2026-09-01T10:00:00.000Z';
const REVIEW = (description) => JSON.stringify({ achieved: true, reusable: true, description, reason: 'e2e canned review' });
const noticeOf = (name, n, lastError) => `The skill customSkills.${name} was switched off after ${n} errors in a row. `
    + `Last error: ${lastError}. Write a corrected version of the function under the same name to switch it on again.`;
const fullMessage = (count) => `The skill library is full (${count} skills), so this code was not saved as a skill. `
    + 'Use !forgetSkill to remove a skill that is no longer needed.';

// A skill that throws, returns false or works, depending on its mode.
const modeSkill = (name, word) => ({
    signature: `${name}(bot, mode, n)`,
    description: `Throws, returns false or works, depending on the mode (${word}).`,
    lines: [
        `async function ${name}(bot, mode, n) {`,
        '    /**',
        `     * Throws, returns false or works, depending on the mode (${word}).`,
        '     **/',
        '    await skills.wait(bot, 5);',
        "    if (mode === 'throw') {",
        `        throw new Error('${word} failure ' + n);`,
        '    }',
        "    if (mode === 'false') {",
        `        log(bot, '${word} returned false ' + n);`,
        '        return false;',
        '    }',
        `    log(bot, '${word} ok ' + n);`,
        '    return true;',
        '}',
    ],
});
const plainSkill = (name, signature, description, body) => ({
    signature, description,
    lines: [`async function ${signature.replace(name, name)} {`, '    /**', `     * ${description}`, '     **/', ...body, '}'],
});

const ERROR_SKILLS = {
    flakySkill: modeSkill('flakySkill', 'flaky'),
    wobblySkill: modeSkill('wobblySkill', 'wobbly'),
    cmdSkill: modeSkill('cmdSkill', 'cmd'),
    alwaysThrows: plainSkill('alwaysThrows', 'alwaysThrows(bot, n)', 'Always throws.',
        ['    await skills.wait(bot, 5);', "    throw new Error('always fails ' + n);"]),
    helperSkill: plainSkill('helperSkill', 'helperSkill(bot, word)', 'Writes helper and the word.',
        ['    await skills.wait(bot, 5);', "    log(bot, 'helper ' + word);", '    return true;']),
    // G4: tries to replace the name customSkills for the other skills, directly and in a microtask
    hijackLib: plainSkill('hijackLib', 'hijackLib(bot)', 'Tries to replace the name customSkills.', [
        '    const original = customSkills;',
        "    const fake = Object.freeze({ calleeSkill: async function calleeSkill(b) { log(b, 'HIJACKED callee'); return true; } });",
        '    const tried = [];',
        "    try { customSkills = fake; tried.push('assign done'); } catch (e) { tried.push('assign refused'); }",
        "    try { globalThis.customSkills = fake; tried.push('global assign done'); } catch (e) { tried.push('global assign refused'); }",
        "    try { Object.defineProperty(globalThis, 'customSkills', { value: fake }); tried.push('define done'); } catch (e) { tried.push('define refused'); }",
        "    try { delete globalThis.customSkills; tried.push('delete done'); } catch (e) { tried.push('delete refused'); }",
        '    Promise.resolve().then(() => {',
        "        try { globalThis.customSkills = fake; tried.push('microtask assign done'); } catch (e) { tried.push('microtask assign refused'); }",
        '    });',
        '    await skills.wait(bot, 20);',
        "    const d = Object.getOwnPropertyDescriptor(globalThis, 'customSkills');",
        "    log(bot, 'hijack: ' + tried.join(', ') + '; writable ' + d.writable + ', configurable ' + d.configurable + '; unchanged ' + (customSkills === original));",
        '    return true;',
    ]),
    callerSkill: plainSkill('callerSkill', 'callerSkill(bot)', 'Calls calleeSkill through customSkills.',
        ['    await skills.wait(bot, 5);', '    return customSkills.calleeSkill(bot);']),
    calleeSkill: plainSkill('calleeSkill', 'calleeSkill(bot)', 'Writes callee original.',
        ["    log(bot, 'callee original');", '    return true;']),
};

// Skills of an earlier session, with an index of v0.1.4.4 (no consecutive_errors).
function seed(name, skillMap, statuses = {}) {
    const dir = path.join('bots', name, 'skills');
    fs.mkdirSync(dir, { recursive: true });
    const skills = {};
    for (const [n, s] of Object.entries(skillMap)) {
        fs.writeFileSync(path.join(dir, n + '.js'), s.lines.join('\n') + '\n');
        skills[n] = {
            name: n, signature: s.signature, description: s.description, status: statuses[n] ?? 'active', version: 1,
            created: STAMP, updated: STAMP, uses: 0, failures: 0, consecutive_failures: 0, last_used: null, last_error: null,
            source_task: 'seeded', hash: '0'.repeat(64),
        };
    }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, skills }, null, 2));
}
const indexOf = (name) => { try { return readJson(path.join('bots', name, 'skills', 'index.json')).skills; } catch { return {}; } };

async function withAgent(name, overrides, steps) {
    const server = await startServer({ seedHigh: 16, seedLow: 8, motd: 'Skill Guardrails World' });
    let agent = null;
    try {
        const s = await startRealAgent(name, server.port, { sandbox_lockdown: true, allow_insecure_coding: true, skill_learning: true, ...overrides });
        agent = s.agent;
        const newAction = async (task, replies, reviews = []) => {
            s.code.reset();
            s.code.replies.push(...replies);
            s.code.reviews.push(...reviews);
            agent.history.turns = [];
            await agent.history.add(agent.name, `!newAction("${task}")`);
            const ret = await withTimeout(runCommand(agent, `!newAction("${task}")`), 30000, task);
            const coding = s.code.of('coding');
            return {
                ret, coding, reviews: s.code.of('review'),
                feedback: coding.slice(1).map((r) => String(r.turns[r.turns.length - 1]?.content)),
            };
        };
        await steps({ agent, newAction });
        check(s.realCalls.length === 0, `${name}: no request reached a real model class`, JSON.stringify(s.realCalls));
    } finally {
        await stopRealAgent(agent);
        await server.stop();
    }
}

// Generated code that calls a skill once and catches its error.
const callCatching = (skill, mode, n) => codeReply(
    `try {\n    await customSkills.${skill}(bot, '${mode}', ${n});\n} catch (e) {\n    log(bot, 'caught ' + e.message);\n}`);
// Generated code that calls alwaysThrows four times in one run, then another skill.
const LOOP_CODE = [
    'for (let i = 1; i <= 4; i++) {',
    '    try {',
    '        await customSkills.alwaysThrows(bot, i);',
    '    } catch (e) {',
    "        log(bot, 'caught ' + e.message);",
    '    }',
    '}',
    "await customSkills.helperSkill(bot, 'after');",
    "log(bot, 'run completed');",
].join('\n');
const notices = (text) => (String(text).match(/was switched off after/g) || []).length;

await scenarioMain({
    async errors() {
        const NAME = 'e2e_guard';
        await withAgent(NAME, { skill_command: true }, async ({ agent, newAction }) => {
            const m = agent.skill_manager;
            check(m?.limits?.maxCount === 100 && m.limits.disableAfterErrors === 3, 'the limits of the fork\'s settings.js are 100 and 3', JSON.stringify(m?.limits));

            // !restart with the fork's default settings
            const { getCommandDocs } = await importProject('src/agent/commands/index.js');
            const docs = getCommandDocs(agent);
            check(!docs.includes('!restart'), '!restart is not in the command docs for the model with the fork\'s default settings');
            if (!docs.includes('!restart')) {
                const rr = await runCommand(agent, '!restart');
                check(rr === '!restart is not a command.', '!restart is refused when called', JSON.stringify(rr));
            } else {
                note('!restart is offered: not called, it would end the process');
            }

            // G1, three thrown errors in a row
            let r = await newAction('Flaky one', [callCatching('flakySkill', 'throw', 1)]);
            let e = indexOf(NAME).flakySkill;
            check(r.ret.includes('caught flaky failure 1') && notices(r.ret) === 0, 'G1 first error: the code caught it, no notice', JSON.stringify(r.ret.slice(-120)));
            check(e?.consecutive_errors === 1 && e.status === 'active', 'G1 first error: consecutive_errors 1 (an index of v0.1.4.4 without the key counted from 0)', JSON.stringify(e));
            r = await newAction('Flaky two', [callCatching('flakySkill', 'throw', 2)]);
            check(notices(r.ret) === 0 && indexOf(NAME).flakySkill?.consecutive_errors === 2, 'G1 second error: no notice, consecutive_errors 2');
            r = await newAction('Flaky three', [callCatching('flakySkill', 'throw', 3)]);
            check(r.ret.includes('caught flaky failure 3') && endsWithLine(r.ret, noticeOf('flakySkill', 3, 'Error: flaky failure 3')),
                'G1 third error: the reply of the third !newAction ends with the notice of the spec with the last error, after one line break', JSON.stringify(r.ret.slice(-260)));
            e = indexOf(NAME).flakySkill;
            check(e?.status === 'disabled' && e.consecutive_errors === 3, 'G1: the index on disk has status disabled and consecutive_errors 3', JSON.stringify(e));
            check(!m.knownNames().includes('customSkills.flakySkill'), 'G1: the switched off skill is not loaded any more', JSON.stringify(m.knownNames()));
            r = await newAction('Call the switched off skill',
                [codeReply("await customSkills.flakySkill(bot, 'ok', 4);"), codeReply("log(bot, 'fallback after the lint');\nawait skills.wait(bot, 5);")]);
            check(r.coding[0] && !r.coding[0].prompt.includes('customSkills.flakySkill') && r.coding[0].prompt.includes('### customSkills.wobblySkill'),
                'G1: the switched off skill is not offered in the coding prompt (the others are)');
            check(r.feedback[0]?.includes('These functions do not exist') && r.feedback[0]?.includes('customSkills.flakySkill') && r.ret.includes('fallback after the lint'),
                'G1: the lint refuses a call of the switched off skill', JSON.stringify(r.feedback[0]?.slice(0, 160)));
            let list = await runCommand(agent, '!skills');
            check(/\n- flakySkill\(bot, mode, n\): [^\n]*\[disabled\]/.test(list), 'G1: !skills shows the switched off skill as disabled', JSON.stringify(list));

            // a corrected version under the same name switches it on again
            const FIXED = [
                'async function flakySkill(bot, mode, n) {',
                '    /**',
                '     * Works in every mode (corrected version).',
                '     **/',
                '    await skills.wait(bot, 5);',
                "    log(bot, 'flaky fixed ' + mode + ' ' + n);",
                '    return true;',
                '}',
            ].join('\n');
            r = await newAction('Correct the flaky skill', [codeReply(FIXED + "\nawait flakySkill(bot, 'throw', 5);")], [REVIEW('Works in every mode.')]);
            e = indexOf(NAME).flakySkill;
            check(r.ret.includes('flaky fixed throw 5') && endsWithLine(r.ret, 'Updated the saved skill customSkills.flakySkill.'),
                'G1: a corrected version under the same name is saved (a new version, so the trivial rule does not apply)', JSON.stringify(r.ret.slice(-120)));
            check(e?.status === 'active' && e.consecutive_errors === 0 && e.version === 2, 'G1: the corrected version is active, version 2, consecutive_errors 0', JSON.stringify(e));
            r = await newAction('Use the corrected skill', [callCatching('flakySkill', 'throw', 6)]);
            check(r.ret.includes('flaky fixed throw 6'), 'G1: generated code calls the corrected skill', JSON.stringify(r.ret.slice(-100)));

            // a run that returns false does not count and does not reset
            for (const [n, mode] of [[1, 'throw'], [2, 'throw'], [3, 'false']]) {
                r = await newAction('Wobbly ' + n, [callCatching('wobblySkill', mode, n)]);
                check(notices(r.ret) === 0, `G1 wobbly run ${n} (${mode}): no notice`);
            }
            e = indexOf(NAME).wobblySkill;
            check(e?.consecutive_errors === 2 && e.consecutive_failures === 3 && e.status === 'active',
                'G1: a run that returned false did not count as an error and did not reset the counter', JSON.stringify(e));
            r = await newAction('Wobbly 4', [callCatching('wobblySkill', 'throw', 4)]);
            check(endsWithLine(r.ret, noticeOf('wobblySkill', 3, 'Error: wobbly failure 4')), 'G1: the third thrown error after the false run switches it off',
                JSON.stringify(r.ret.slice(-240)));
            check(indexOf(NAME).wobblySkill?.status === 'disabled', 'G1: wobblySkill is disabled on disk');
            r = await runCommand(agent, '!enableSkill("wobblySkill")');
            e = indexOf(NAME).wobblySkill;
            check(r === 'Enabled the skill "wobblySkill".' && e?.status === 'active' && e.consecutive_errors === 0,
                '!enableSkill switches it on again with consecutive_errors back at 0', `${JSON.stringify(r)} ${JSON.stringify(e)}`);
            check(m.knownNames().includes('customSkills.wobblySkill'), '!enableSkill: the skill is loaded again');
            r = await newAction('Wobbly 5', [callCatching('wobblySkill', 'throw', 5)]);
            check(notices(r.ret) === 0 && indexOf(NAME).wobblySkill?.consecutive_errors === 1 && indexOf(NAME).wobblySkill?.status === 'active',
                'after !enableSkill one error is one error, not a switch-off');
            r = await newAction('Wobbly 6', [callCatching('wobblySkill', 'ok', 6)]);
            check(r.ret.includes('wobbly ok 6') && indexOf(NAME).wobblySkill?.consecutive_errors === 0, 'G1: a run that returned anything else reset the counter to 0');

            // the running code keeps working
            r = await newAction('Call a failing skill four times', [codeReply(LOOP_CODE)]);
            check(r.coding.length === 1 && [1, 2, 3, 4].every((i) => r.ret.includes('caught always fails ' + i)) && r.ret.includes('helper after')
                && r.ret.includes('run completed'),
            'the running code keeps working: four calls reach the failing skill (no reload during the run), then another saved skill runs', JSON.stringify(r.ret.slice(-300)));
            check(notices(r.ret) === 1 && endsWithLine(r.ret, noticeOf('alwaysThrows', 3, 'Error: always fails 3')),
                'one notice, with the error that switched it off (the third)', JSON.stringify(r.ret.slice(-240)));
            e = indexOf(NAME).alwaysThrows;
            check(e?.status === 'disabled' && e.consecutive_errors === 4 && e.uses === 4, 'the index counted all four runs and has status disabled', JSON.stringify(e));
            check(!m.knownNames().includes('customSkills.alwaysThrows') && m.knownNames().includes('customSkills.helperSkill'),
                'after the run the library was reloaded without the switched off skill');

            // !useSkill gets the notice as well
            let u = '';
            for (const n of [1, 2, 3]) u = await runCommand(agent, `!useSkill("cmdSkill", "['throw', ${n}]")`);
            check(u.startsWith('The skill "cmdSkill" failed: Error: cmd failure 3') && endsWithLine(u, noticeOf('cmdSkill', 3, 'Error: cmd failure 3')),
                'G1: the third failing !useSkill ends with the notice', JSON.stringify(u));

            // G4: the name customSkills cannot be replaced in the sandbox of the skills
            r = await newAction('Try to replace customSkills',
                [codeReply('await customSkills.hijackLib(bot);\nawait skills.wait(bot, 50);\nawait customSkills.callerSkill(bot);')]);
            const line = /hijack: .*/.exec(r.ret)?.[0] ?? '';
            note(line);
            check(/assign refused/.test(line) && /global assign refused/.test(line) && /define refused/.test(line) && /delete refused/.test(line)
                && /microtask assign refused/.test(line) && !/ done/.test(line) && /writable false, configurable false; unchanged true/.test(line),
            'G4: assigning, defining and deleting the name customSkills is refused inside the sandbox, also in a microtask (lockdown ON)', JSON.stringify(line));
            check(r.ret.includes('callee original') && !r.ret.includes('HIJACKED'), 'G4: the other skills keep calling each other correctly', JSON.stringify(r.ret.slice(-200)));
            r = await newAction('Call the caller again', [codeReply('await customSkills.callerSkill(bot);\nawait skills.wait(bot, 5);')]);
            check(r.ret.includes('callee original') && !r.ret.includes('HIJACKED'), 'G4: also in a later run', JSON.stringify(r.ret.slice(-120)));
            list = await runCommand(agent, '!skills');
            note(`skills at the end: ${JSON.stringify(list)}`);
        });
    },
    async noDisable() {
        const NAME = 'e2e_guard0';
        await withAgent(NAME, { skill_disable_after_errors: 0 }, async ({ agent, newAction }) => {
            check(agent.skill_manager?.limits?.disableAfterErrors === 0, 'skill_disable_after_errors 0 is read as 0');
            const r = await newAction('Call a failing skill four times', [codeReply(LOOP_CODE)]);
            const e = indexOf(NAME).alwaysThrows;
            check([1, 2, 3, 4].every((i) => r.ret.includes('caught always fails ' + i)) && r.ret.includes('run completed') && notices(r.ret) === 0,
                'skill_disable_after_errors 0: four errors in a row, no notice', JSON.stringify(r.ret.slice(-200)));
            check(e?.status === 'active' && e.consecutive_errors === 4 && agent.skill_manager.knownNames().includes('customSkills.alwaysThrows'),
                'skill_disable_after_errors 0: the skill stays active and loaded', JSON.stringify(e));
            const r2 = await newAction('Look at the skills', [codeReply("log(bot, 'looked');\nawait skills.wait(bot, 5);")]);
            check(r2.coding[0]?.prompt.includes('### customSkills.alwaysThrows'), 'skill_disable_after_errors 0: the skill is still offered in the coding prompt');
        });
    },
    async limit() {
        const NAME = 'e2e_guardmax';
        const DIR = path.join('bots', NAME, 'skills');
        const THIRD = [
            'async function thirdSkill(bot, n) {',
            '    /**',
            '     * Writes third with a number and the height.',
            '     **/',
            '    const start = world.getPosition(bot);',
            "    log(bot, 'third ' + n + ' at y' + Math.round(start.y));",
            '    await skills.wait(bot, 5);',
            '    return true;',
            '}',
            'await thirdSkill(bot, 2);',
        ].join('\n');
        const keptVersion = (word, extra) => [
            'async function keptSkill(bot, n) {',
            '    /**',
            `     * Writes kept ${word} with a number.`,
            '     **/',
            ...extra,
            `    log(bot, 'kept ${word} ' + n);`,
            '    await skills.wait(bot, 5);',
            '    return true;',
            '}',
            'await keptSkill(bot, 1);',
        ].join('\n');
        await withAgent(NAME, { skill_max_count: 2 }, async ({ agent, newAction }) => {
            check(agent.skill_manager?.limits?.maxCount === 2, 'skill_max_count 2 is read as 2');
            let r = await newAction('Write a third skill', [codeReply(THIRD)], [REVIEW('Writes a third thing.')]);
            check(r.ret.includes('third 2') && r.reviews.length === 0, 'G2: with 2 saved skills (one disabled) the third function gets NO review request', `reviews=${r.reviews.length}`);
            check(!fs.existsSync(path.join(DIR, 'thirdSkill.js')) && Object.keys(indexOf(NAME)).length === 2, 'G2: nothing was saved');
            check(endsWithLine(r.ret, fullMessage(2)), 'G2: the reply ends with the message of the spec after one line break', JSON.stringify(r.ret.slice(-200)));
            // decision of the tech lead: the trivial check comes before the size limit
            const TINY = [
                'async function tinySkill(bot, n) {',
                '    /**',
                '     * Writes tiny with a number.',
                '     **/',
                "    log(bot, 'tiny ' + n);",
                '    await skills.wait(bot, 5);',
                '    return true;',
                '}',
                'await tinySkill(bot, 1);',
            ].join('\n');
            r = await newAction('Write a tiny skill', [codeReply(TINY)], [REVIEW('Writes tiny.')]);
            check(r.ret.includes('tiny 1') && r.reviews.length === 0 && !r.ret.includes('library is full') && !/Saved this code|Updated the saved skill/.test(r.ret)
                && !fs.existsSync(path.join(DIR, 'tinySkill.js')),
            'G3 before G2: a trivial new function with a full library gets no review and no message at all', JSON.stringify(r.ret.slice(-120)));
            r = await newAction('Write kept two', [codeReply(keptVersion('two', ['    const start = world.getPosition(bot);', "    log(bot, 'y ' + Math.round(start.y));"]))],
                [REVIEW('Writes kept two.')]);
            check(r.reviews.length === 1 && endsWithLine(r.ret, 'Updated the saved skill customSkills.keptSkill.') && indexOf(NAME).keptSkill?.version === 2,
                'G2: a new version of a saved skill is still accepted when the library is full', JSON.stringify(r.ret.slice(-100)));
            r = await newAction('Write kept three', [codeReply(keptVersion('three', []))], [REVIEW('Writes kept three.')]);
            check(r.reviews.length === 1 && endsWithLine(r.ret, 'Updated the saved skill customSkills.keptSkill.') && indexOf(NAME).keptSkill?.version === 3,
                'G3: a trivial new version of a saved skill is reviewed and saved', JSON.stringify(r.ret.slice(-100)));
            r = await runCommand(agent, '!forgetSkill("sleepySkill")');
            check(r === 'Forgot the skill "sleepySkill".', '!forgetSkill of the disabled skill', JSON.stringify(r));
            r = await newAction('Write a third skill again', [codeReply(THIRD)], [REVIEW('Writes a third thing.')]);
            check(r.reviews.length === 1 && endsWithLine(r.ret, 'Saved this code as the skill customSkills.thirdSkill. You can call it in later code.')
                && fs.existsSync(path.join(DIR, 'thirdSkill.js')),
            'G2: after !forgetSkill a new skill is saved again', JSON.stringify(r.ret.slice(-120)));
            r = await newAction('Write a fourth skill', [codeReply(THIRD.replaceAll('thirdSkill', 'fourthSkill').replace("'third '", "'fourth '"))], [REVIEW('Writes a fourth thing.')]);
            check(r.reviews.length === 0 && endsWithLine(r.ret, fullMessage(2)) && !fs.existsSync(path.join(DIR, 'fourthSkill.js')),
                'G2: the library is full again at 2', JSON.stringify(r.ret.slice(-160)));
        });
    },
    async main() {
        seed('e2e_guard', ERROR_SKILLS);
        seed('e2e_guard0', { alwaysThrows: ERROR_SKILLS.alwaysThrows, helperSkill: ERROR_SKILLS.helperSkill });
        seed('e2e_guardmax', {
            keptSkill: plainSkill('keptSkill', 'keptSkill(bot, n)', 'Writes kept with a number.',
                ["    log(bot, 'kept ' + n);", '    await skills.wait(bot, 5);', '    return true;']),
            sleepySkill: plainSkill('sleepySkill', 'sleepySkill(bot)', 'Sleeps a little.', ['    await skills.wait(bot, 5);', '    return true;']),
        }, { sleepySkill: 'disabled' });
        await runPhase(SELF, 'errors');
        await runPhase(SELF, 'noDisable');
        await runPhase(SELF, 'limit');
        note(`skill files: ${JSON.stringify(listFiles('bots').filter((f) => f.includes('/skills/')))}`);
    },
});
exitSoon();
