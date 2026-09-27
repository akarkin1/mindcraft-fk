// S12 skill_prompts_commands (v0.1.4.4, plan items 6 and 7): the real Agent.start with
// skill_learning and skill_command on, the lockdown on, and skills saved in an earlier session
// (bots/<name>/skills with index.json: active skills, a disabled one, one with a syntax error).
//
// Prompts: the real Prompter builds the prompts; the fake model object records what it receives
// (the seam is prompter.code_model / chat_model). Proves: the coding prompt contains the section
// SAVED SKILLS with the rules and the doc of a saved skill, placed directly before the
// "Conversation:" line, and nothing else of the prompt changed; the conversing prompt lists the
// skills and mentions !useSkill; a disabled skill and a skill that failed to load are not listed;
// the placeholder $CUSTOM_SKILLS takes the section without a warning (A6).
//
// Commands through the real command parser: !skills, !disableSkill, !enableSkill, !forgetSkill,
// !useSkill with the replies of the spec and their effect on disk (forget moves the file to
// .history/, nothing is deleted); !useSkill with an unknown name replies that no such skill is
// saved and does not stop the action that is running at that moment (A5). Also: generated code
// that calls a disabled skill is rejected by the lint; names that are paths or members of
// Object.prototype are no skills for any command; a skill stopped with !stop is not counted.
import fs from 'node:fs';
import path from 'node:path';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand,
    readJson, listFiles, snapshotDir, withTimeout, sleep, importProject,
} from './helpers.js';

const NAME = 'e2e_prompts';
const SKILLS = path.join('bots', NAME, 'skills');
const INDEX = path.join(SKILLS, 'index.json');
const STAMP = '2026-09-01T10:00:00.000Z';

const SEED = {
    alphaSkill: {
        status: 'active', signature: 'alphaSkill(bot, count, label)', description: 'Writes alpha with a count and a label.',
        lines: [
            'async function alphaSkill(bot, count, label) {',
            '    /**',
            '     * Writes alpha with a count and a label.',
            '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
            '     * @param {number} count, a number.',
            '     * @param {string} label, a label.',
            '     **/',
            "    log(bot, 'alpha ' + count + ' ' + label);",
            '    await skills.wait(bot, 10);',
            '    return true;',
            '}',
        ],
    },
    betaSkill: {
        status: 'disabled', signature: 'betaSkill(bot)', description: 'Writes beta.',
        lines: ['async function betaSkill(bot) {', '    /**', '     * Writes beta.', '     **/', "    log(bot, 'beta');", '    return true;', '}'],
    },
    brokenSkill: {
        status: 'active', signature: 'brokenSkill(bot)', description: 'Is broken on purpose.',
        lines: ['async function brokenSkill(bot) {', '    /**', '     * Is broken on purpose.', '     **/', "    log(bot, 'broken' ;", '}'],
    },
    quietSkill: {
        status: 'active', signature: 'quietSkill(bot)', description: 'Waits without output.',
        lines: ['async function quietSkill(bot) {', '    /**', '     * Waits without output.', '     **/', '    await skills.wait(bot, 10);', '    return true;', '}'],
    },
    slowSkill: {
        status: 'active', signature: 'slowSkill(bot, ms)', description: 'Waits and reports.',
        lines: ['async function slowSkill(bot, ms) {', '    /**', '     * Waits and reports.', '     **/', "    log(bot, 'slow started');",
            '    await skills.wait(bot, ms);', "    log(bot, 'slow done');", '    return true;', '}'],
    },
    throwerSkill: {
        status: 'active', signature: 'throwerSkill(bot)', description: 'Throws on purpose.',
        lines: ['async function throwerSkill(bot) {', '    /**', '     * Throws on purpose.', '     **/', '    await skills.wait(bot, 10);',
            "    throw new Error('thrower failed on purpose');", '}'],
    },
};

function seed() {
    fs.mkdirSync(SKILLS, { recursive: true });
    const skills = {};
    for (const [name, s] of Object.entries(SEED)) {
        fs.writeFileSync(path.join(SKILLS, name + '.js'), s.lines.join('\n') + '\n');
        skills[name] = {
            name, signature: s.signature, description: s.description, status: s.status, version: 1, created: STAMP, updated: STAMP,
            uses: 0, failures: 0, consecutive_failures: 0, last_used: null, last_error: null, source_task: 'seeded', hash: '0'.repeat(64),
        };
    }
    fs.writeFileSync(INDEX, JSON.stringify({ version: 1, skills }, null, 2));
}

const readIndex = () => { try { return readJson(INDEX); } catch { return null; } };
const MESSAGES = [
    { role: 'user', content: 'e2e_player: write alpha with a label please' },
    { role: 'assistant', content: '!newAction("Write alpha with a count and a label")' },
];

await scenarioMain({
    async main() {
        seed();
        const server = await startServer({ seedHigh: 12, seedLow: 4, motd: 'Skill Prompt World' });
        let agent = null;
        try {
            const s = await startRealAgent(NAME, server.port, {
                sandbox_lockdown: true, allow_insecure_coding: true, skill_learning: true, skill_command: true,
            });
            agent = s.agent;
            const { chat, code } = s;
            const prompter = agent.prompter;
            check(agent.skill_manager?.flags.command === true, 'the manager started with capture, reuse and command', JSON.stringify(agent.skill_manager?.flags));
            note(`loaded: ${JSON.stringify(agent.skill_manager?.knownNames())}`);

            async function codingPrompt(messages = MESSAGES) {
                code.reset();
                code.replies.push('```//no code needed```');
                await prompter.promptCoding(JSON.parse(JSON.stringify(messages)));
                return code.of('coding')[0]?.prompt ?? '';
            }
            async function convoPrompt(messages = MESSAGES) {
                chat.reset();
                chat.replies.push('Sure.');
                await prompter.promptConvo(JSON.parse(JSON.stringify(messages)));
                return chat.of('chat')[0]?.prompt ?? '';
            }

            // ---------------------------------------------------------------- 6. prompts
            const cp = await codingPrompt();
            const at = cp.indexOf('#### SAVED SKILLS ###');
            check(at > 0, 'coding prompt contains the section #### SAVED SKILLS ###');
            check(cp.includes('RULES FOR NEW CODE:\n- If the task could be needed again, write it as ONE async function')
                && cp.includes('RULES FOR SAVED SKILLS:\n- Before you write new code, check the saved skills below.'),
            'coding prompt contains the rules for new code and for saved skills');
            check(/### customSkills\.alphaSkill\n[^#]*Writes alpha with a count and a label\.[^#]*@param \{string\} label, a label\./.test(cp),
                'coding prompt contains the doc of the saved skill alphaSkill under ### customSkills.alphaSkill');
            const section = at > 0 ? cp.slice(at, cp.lastIndexOf('\nConversation:')) : '';
            check(at > 0 && cp.endsWith(section + '\nConversation:') && cp.indexOf('Examples of how to respond') < at,
                'the section is placed directly before the last line "Conversation:" (after the examples)', JSON.stringify(cp.slice(-120)));
            const baseCoding = await prompter.replaceStrings(prompter.profile.coding, JSON.parse(JSON.stringify(MESSAGES)), prompter.coding_examples);
            check(cp.replace(section + '\n', '') === baseCoding, 'nothing else of the coding prompt changed (prompt minus the section = the prompt of v0.1.4.3)');
            check(!cp.includes('betaSkill'), 'a disabled skill is not in the coding prompt');
            check(!cp.includes('brokenSkill'), '[A2] a skill that failed to load is not in the coding prompt');

            const vp = await convoPrompt();
            const INTRO = 'SAVED SKILLS: code you wrote earlier and can run again. To run one, use !newAction and name the skill and its values. You can also run one directly with !useSkill.';
            check(vp.includes(INTRO + '\n'), 'conversing prompt contains the intro line with the !useSkill sentence (skill_command on)');
            check(vp.includes('\n- alphaSkill(bot, count, label): Writes alpha with a count and a label.'), 'conversing prompt lists the saved skill with signature and description');
            const vAt = vp.indexOf(INTRO);
            check(vAt > 0 && /\n- [^\n]*\nConversation Begin:$/.test(vp) && !vp.slice(vAt).includes('Examples of how to respond'),
                'the conversing section is placed directly before "Conversation Begin:"', JSON.stringify(vp.slice(-150)));
            check(!vp.includes('betaSkill'), 'a disabled skill is not in the conversing prompt');
            check(!vp.includes('brokenSkill'), '[A2] a skill that failed to load is not in the conversing prompt');

            // A6: the placeholder takes the section, without an "unknown placeholder" warning
            const warnings = [];
            const origWarn = console.warn;
            console.warn = (...a) => { warnings.push(a.map(String).join(' ')); return origWarn.apply(console, a); };
            const savedCoding = prompter.profile.coding;
            try {
                prompter.profile.coding = 'E2E CODING $NAME\n$CUSTOM_SKILLS\nEND';
                const pp = await codingPrompt();
                check(pp.startsWith(`E2E CODING ${NAME}\n#### SAVED SKILLS ###\n`) && pp.endsWith('\nEND') && !pp.includes('$CUSTOM_SKILLS'),
                    '[A6] a coding prompt with $CUSTOM_SKILLS gets the section in place of the placeholder', JSON.stringify(pp.slice(0, 80)));
            } finally {
                prompter.profile.coding = savedCoding;
                console.warn = origWarn;
            }
            check(!warnings.some((w) => w.includes('Unknown prompt placeholders')), '[A6] $CUSTOM_SKILLS is not reported as an unknown placeholder',
                JSON.stringify(warnings));

            // ---------------------------------------------------------------- 7. commands
            const { getCommandDocs } = await importProject('src/agent/commands/index.js');
            const docs = getCommandDocs(agent);
            check(['!skills:', '!forgetSkill:', '!disableSkill:', '!enableSkill:', '!useSkill:'].every((c) => docs.includes('\n' + c)),
                'the five skill commands are in the command docs for the model');

            let r = await runCommand(agent, '!skills');
            const LIST = [
                'Saved skills:',
                '- alphaSkill(bot, count, label): Writes alpha with a count and a label. (used 0 times, 0 failed)',
                '- betaSkill(bot): Writes beta. (used 0 times, 0 failed) [disabled]',
                '- brokenSkill(bot): Is broken on purpose. (used 0 times, 0 failed) [broken]',
                '- quietSkill(bot): Waits without output. (used 0 times, 0 failed)',
                '- slowSkill(bot, ms): Waits and reports. (used 0 times, 0 failed)',
                '- throwerSkill(bot): Throws on purpose. (used 0 times, 0 failed)',
            ].join('\n');
            check(r === LIST, '!skills lists every skill of the store, [disabled] and [A2] [broken] marked', JSON.stringify(r));

            r = await runCommand(agent, '!disableSkill("alphaSkill")');
            check(r === 'Disabled the skill "alphaSkill".', '!disableSkill reply', JSON.stringify(r));
            check(readIndex()?.skills?.alphaSkill?.status === 'disabled' && !agent.skill_manager.knownNames().includes('customSkills.alphaSkill'),
                '!disableSkill: status disabled in index.json and the skill is unloaded');
            check(!(await codingPrompt()).includes('alphaSkill'), '!disableSkill: the coding prompt no longer shows it');
            code.reset();
            code.replies.push('```js\nawait customSkills.alphaSkill(bot, 1, \'x\');\n```', '```js\nlog(bot, \'fallback\');\nawait skills.wait(bot, 10);\n```');
            agent.history.turns = [];
            await agent.history.add(agent.name, '!newAction("Call alpha")');
            r = await withTimeout(runCommand(agent, '!newAction("Call alpha")'), 30000, 'Call alpha');
            const fb = String(code.of('coding')[1]?.turns.at(-1)?.content ?? '');
            check(fb.includes('These functions do not exist') && fb.includes('customSkills.alphaSkill') && r.includes('fallback'),
                '!disableSkill: generated code that calls the disabled skill is rejected by the lint', JSON.stringify(fb.slice(0, 160)));
            r = await runCommand(agent, '!useSkill("alphaSkill", "[1, \'x\']")');
            check(r === 'No skill named "alphaSkill" is saved.', '!useSkill of a disabled skill: no skill with that name', JSON.stringify(r));
            r = await runCommand(agent, '!enableSkill("alphaSkill")');
            check(r === 'Enabled the skill "alphaSkill".', '!enableSkill reply', JSON.stringify(r));
            check(readIndex()?.skills?.alphaSkill?.status === 'active' && agent.skill_manager.knownNames().includes('customSkills.alphaSkill'),
                '!enableSkill: status active in index.json and the skill is loaded again');
            for (const cmd of ['disableSkill', 'enableSkill', 'forgetSkill']) {
                r = await runCommand(agent, `!${cmd}("nothingHere")`);
                check(r === 'No skill named "nothingHere" is saved.', `!${cmd} with an unknown name`, JSON.stringify(r));
            }
            // names that are paths or members of Object.prototype are no skills
            const filesBeforeOdd = JSON.stringify(listFiles(SKILLS));
            for (const odd of ['../alphaSkill', '..\\alphaSkill', 'toString', '__proto__', 'constructor']) {
                for (const cmd of ['forgetSkill', 'disableSkill']) {
                    r = await runCommand(agent, `!${cmd}("${odd}")`);
                    check(r === `No skill named "${odd}" is saved.`, `!${cmd}("${odd}") is no skill`, JSON.stringify(r));
                }
                r = await runCommand(agent, `!useSkill("${odd}", "")`);
                check(r === `No skill named "${odd}" is saved.`, `!useSkill("${odd}") is no skill`, JSON.stringify(r));
            }
            check(JSON.stringify(listFiles(SKILLS)) === filesBeforeOdd && readIndex()?.skills?.alphaSkill?.status === 'active',
                'the odd names changed no file and no skill');

            r = await runCommand(agent, '!useSkill("alphaSkill", "[2, \'oak_log\']")');
            check(r.includes('alpha 2 oak_log'), '!useSkill runs a saved skill with the arguments (single quotes accepted) and returns its output', JSON.stringify(r));
            check(readIndex()?.skills?.alphaSkill?.uses === 1, '!useSkill: the use is counted in index.json', JSON.stringify(readIndex()?.skills?.alphaSkill));
            r = await runCommand(agent, '!useSkill("alphaSkill", "not a list")');
            check(r === 'Could not read the arguments. Write them as a list, for example "[3, \'oak_log\']".', '!useSkill with arguments that are not a list', JSON.stringify(r));
            r = await runCommand(agent, '!useSkill("quietSkill", "")');
            check(r === 'The skill "quietSkill" finished.', '!useSkill of a skill that logs nothing, empty arguments', JSON.stringify(r));
            r = await runCommand(agent, '!useSkill("throwerSkill", "[]")');
            check(r.startsWith('The skill "throwerSkill" failed: ') && r.includes('thrower failed on purpose'), '!useSkill of a skill that throws', JSON.stringify(r));
            const te = readIndex()?.skills?.throwerSkill;
            check(te?.failures === 1 && te.consecutive_failures === 1 && String(te.last_error).includes('thrower failed on purpose'),
                '!useSkill: the failure is recorded in index.json', JSON.stringify(te));

            // A5: an unknown name does not stop the action that is running
            const slow = runCommand(agent, '!useSkill("slowSkill", "[1200]")');
            const t0 = Date.now();
            while (!String(agent.bot.output).includes('slow started') && Date.now() - t0 < 10000) await sleep(20);
            check(agent.actions.executing === true, 'a long !useSkill is running');
            r = await runCommand(agent, '!useSkill("doesNotExist", "")');
            check(r === 'No skill named "doesNotExist" is saved.', '!useSkill with an unknown name', JSON.stringify(r));
            check(agent.actions.executing === true && agent.actions.currentActionLabel === 'action:useSkill',
                '[A5] the unknown name did not stop the running action', `executing=${agent.actions.executing} label=${agent.actions.currentActionLabel}`);
            const slowRet = await withTimeout(slow, 15000, 'slow useSkill');
            check(String(slowRet).includes('slow done'), '[A5] the running action finished normally', JSON.stringify(slowRet));

            // a skill stopped with !stop while it runs: the interrupted call is not counted (K4)
            const usesBefore = readIndex()?.skills?.slowSkill?.uses;
            const stopped = runCommand(agent, '!useSkill("slowSkill", "[3000]")');
            const t1 = Date.now();
            while (!String(agent.bot.output).includes('slow started') && Date.now() - t1 < 10000) await sleep(20);
            r = await runCommand(agent, '!stop');
            check(r.startsWith('Agent stopped.'), '!stop stops the running skill', JSON.stringify(r));
            const stoppedRet = await withTimeout(stopped, 15000, 'stopped useSkill');
            check(!String(stoppedRet).includes('slow done'), 'the stopped skill did not finish', JSON.stringify(stoppedRet));
            const se = readIndex()?.skills?.slowSkill;
            check(se?.uses === usesBefore && se.failures === 0, 'an interrupted call of a skill is not recorded in index.json', `${usesBefore} -> ${se?.uses}`);

            // forget: the file moves to .history, nothing is deleted
            const before = snapshotDir(SKILLS);
            r = await runCommand(agent, '!forgetSkill("betaSkill")');
            check(r === 'Forgot the skill "betaSkill".', '!forgetSkill reply', JSON.stringify(r));
            const after = snapshotDir(SKILLS);
            const moved = Object.keys(after).filter((f) => /^\.history\/betaSkill\.removed-\d{8}-\d{6}\.js$/.test(f));
            check(!('betaSkill.js' in after) && moved.length === 1 && after[moved[0]] === before['betaSkill.js'],
                '!forgetSkill: betaSkill.js moved to .history/betaSkill.removed-<UTC stamp>.js with the same content', JSON.stringify(Object.keys(after)));
            const lost = Object.entries(before).filter(([f, text]) => f !== 'index.json' && !Object.values(after).includes(text)).map(([f]) => f);
            check(lost.length === 0 && Object.keys(after).length === Object.keys(before).length, '!forgetSkill: no file content was deleted', JSON.stringify(lost));
            check(readIndex()?.skills && !('betaSkill' in readIndex().skills), '!forgetSkill: the entry is gone from index.json');
            r = await runCommand(agent, '!skills');
            check(!r.includes('betaSkill') && r.includes('- alphaSkill('), '!skills after forget no longer lists it', JSON.stringify(r));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
            note(`files at the end: ${JSON.stringify(listFiles(SKILLS))}`);
        } finally {
            await stopRealAgent(agent);
            await server.stop();
        }
    },
});
exitSoon();
