// S15 skill_partial_flags (v0.1.4.4, skillFlags, A3, flag rule): the real Agent.start, a real bot
// and the real !newAction with the flag combinations that the other scenarios do not use, one
// process each.
// captureOnly  skill_reuse false: code is still captured with the messages of amendment A3
//              ("Saved this code as the skill <name>." without customSkills); generated code does
//              not get customSkills; the coding prompt has the header and the rules for new code
//              but no saved skills; no conversing section; !skills works without marking the not
//              loaded skills [broken]; !useSkill stays blocked although skill_command is true.
// reuseOnly    skill_capture false: a saved skill is offered and runs, a function plus its call is
//              not reviewed and not saved, the coding prompt has no rules for new code.
// bothOff      skill_learning true, skill_capture and skill_reuse false: behaves as v0.1.4.3 (no
//              manager, commands blocked, prompts byte for byte, no skills folder).
// noLockdown   sandbox_lockdown false: skills load, run and are captured in the compartment
//              without the SES lockdown.
// v0.1.4.5: the functions call world.getPosition and skills.wait, so they are not trivial (G3);
// save messages follow the text before after exactly one line break.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand, runPhase,
    codeReply, readJson, listFiles, withTimeout, importProject, endsWithLine,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const fnCode = (word, name = 'writeTheWord') => [
    `async function ${name}(bot, n) {`,
    '    /**',
    `     * Writes the word ${word} with a number.`,
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {number} n, the number.',
    '     **/',
    '    const start = world.getPosition(bot);',
    `    log(bot, '${word} ' + n + ' at y' + Math.round(start.y));`,
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
    `await ${name}(bot, 3);`,
].join('\n');
const REVIEW = JSON.stringify({ achieved: true, reusable: true, description: 'Writes a word.', reason: 'e2e' });
const SKILL_COMMANDS = ['!skills', '!forgetSkill', '!disableSkill', '!enableSkill', '!useSkill'];

function seedOld(name) {
    const dir = path.join('bots', name, 'skills');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'oldSkill.js'), fnCode('old', 'oldSkill').split('\nawait ')[0] + '\n');
}

async function withAgent(name, overrides, steps) {
    const server = await startServer({ seedHigh: 15, seedLow: 7, motd: 'Skill Flags World' });
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
            return { ret, coding: s.code.of('coding'), reviews: s.code.of('review') };
        };
        const convoPrompt = async () => {
            s.chat.reset();
            s.chat.replies.push('Sure.');
            const messages = [{ role: 'user', content: 'e2e_player: hello' }];
            await agent.prompter.promptConvo(JSON.parse(JSON.stringify(messages)));
            const base = await agent.prompter.replaceStrings(agent.prompter.profile.conversing, JSON.parse(JSON.stringify(messages)), agent.prompter.convo_examples);
            return { prompt: s.chat.of('chat')[0]?.prompt ?? '', base };
        };
        await steps({ agent, newAction, convoPrompt, code: s.code });
        check(s.realCalls.length === 0, `${name}: no request reached a real model class`, JSON.stringify(s.realCalls));
    } finally {
        await stopRealAgent(agent);
        await server.stop();
    }
}

await scenarioMain({
    async captureOnly() {
        const NAME = 'e2e_caponly';
        const SKILLS = path.join('bots', NAME, 'skills');
        await withAgent(NAME, { skill_reuse: false, skill_command: true }, async ({ agent, newAction, convoPrompt }) => {
            const f = agent.skill_manager?.flags;
            check(f && f.capture === true && f.reuse === false && f.command === false, 'captureOnly: capture on, reuse and command off', JSON.stringify(f));
            let r = await newAction('Write alpha three', [codeReply(fnCode('alpha'))], [REVIEW]);
            check(r.ret.includes('alpha 3') && r.reviews.length === 1 && fs.existsSync(path.join(SKILLS, 'writeTheWord.js')),
                'captureOnly: the function is reviewed and saved', JSON.stringify(listFiles(SKILLS)));
            check(endsWithLine(r.ret, 'Saved this code as the skill writeTheWord.'), '[A3] captureOnly: the message for created names the skill without customSkills',
                JSON.stringify(r.ret.slice(-80)));
            const cp = r.coding[0]?.prompt ?? '';
            check(cp.includes('#### SAVED SKILLS ###\nRULES FOR NEW CODE:') && !cp.includes('RULES FOR SAVED SKILLS') && !cp.includes('No skills are saved yet.'),
                'captureOnly: the coding prompt has the header and the rules for new code, nothing about saved skills');
            r = await newAction('Write beta three', [codeReply(fnCode('beta'))], [REVIEW]);
            check(endsWithLine(r.ret, 'Updated the saved skill writeTheWord.'), '[A3] captureOnly: the message for updated names the skill without customSkills',
                JSON.stringify(r.ret.slice(-80)));
            check(readJson(path.join(SKILLS, 'index.json')).skills?.writeTheWord?.version === 2, 'captureOnly: the update is version 2');
            const cp2 = r.coding[0]?.prompt ?? '';
            check(!cp2.includes('customSkills.writeTheWord') && !cp2.includes('RULES FOR SAVED SKILLS'), 'captureOnly: a saved skill is not offered in the coding prompt');
            r = await newAction('Check customSkills', [codeReply("log(bot, 'typeof customSkills: ' + typeof customSkills);\nawait skills.wait(bot, 10);")]);
            check(r.ret.includes('typeof customSkills: undefined'), 'captureOnly: generated code does not get customSkills', JSON.stringify(r.ret.slice(-100)));
            const { prompt, base } = await convoPrompt();
            check(prompt === base && !prompt.includes('SAVED SKILLS'), 'captureOnly: the conversing prompt has no skills section (byte for byte without it)');
            const list = await runCommand(agent, '!skills');
            check(list === 'Saved skills:\n- writeTheWord(bot, n): Writes the word beta with a number. (used 0 times, 0 failed)',
                'captureOnly: !skills lists the skill without [broken] although nothing is loaded', JSON.stringify(list));
            const { getCommandDocs } = await importProject('src/agent/commands/index.js');
            check(!getCommandDocs(agent).includes('!useSkill') && (await runCommand(agent, '!useSkill("writeTheWord", "[1]")')) === '!useSkill is not a command.',
                'captureOnly: !useSkill is blocked although skill_command is true (command needs reuse)');
        });
    },
    async reuseOnly() {
        const NAME = 'e2e_reuseonly';
        const SKILLS = path.join('bots', NAME, 'skills');
        await withAgent(NAME, { skill_capture: false }, async ({ agent, newAction, convoPrompt }) => {
            const f = agent.skill_manager?.flags;
            check(f && f.capture === false && f.reuse === true, 'reuseOnly: capture off, reuse on', JSON.stringify(f));
            let r = await newAction('Use the old skill', [codeReply('await customSkills.oldSkill(bot, 9);')]);
            check(r.ret.includes('old 9'), 'reuseOnly: a saved skill is loaded and runs', JSON.stringify(r.ret.slice(-100)));
            const cp = r.coding[0]?.prompt ?? '';
            check(cp.includes('#### SAVED SKILLS ###\nRULES FOR SAVED SKILLS:') && cp.includes('### customSkills.oldSkill') && !cp.includes('RULES FOR NEW CODE'),
                'reuseOnly: the coding prompt offers the saved skill and has no rules for new code');
            const before = JSON.stringify(listFiles(SKILLS));
            r = await newAction('Write gamma three', [codeReply(fnCode('gamma'))], [REVIEW]);
            check(r.ret.includes('gamma 3') && r.reviews.length === 0 && !/Saved this code|Updated the saved skill/.test(r.ret)
                && JSON.stringify(listFiles(SKILLS)) === before, 'reuseOnly: a function plus its call is not reviewed and not saved', `reviews=${r.reviews.length}`);
            const { prompt } = await convoPrompt();
            check(prompt.includes('\n- oldSkill(bot, n): Writes the word old with a number.\n'), 'reuseOnly: the conversing prompt lists the saved skill');
            check((await runCommand(agent, '!skills')).includes('- oldSkill(bot, n)'), 'reuseOnly: !skills works');
        });
    },
    async bothOff() {
        const NAME = 'e2e_bothoff';
        await withAgent(NAME, { skill_capture: false, skill_reuse: false, skill_command: true }, async ({ agent, newAction, convoPrompt }) => {
            check(agent.skill_manager === undefined, 'bothOff: all three flags false, so no manager is created');
            const { getCommandDocs } = await importProject('src/agent/commands/index.js');
            const docs = getCommandDocs(agent);
            check(SKILL_COMMANDS.every((c) => !docs.includes(c + ':')), 'bothOff: the skill commands are not in the command docs');
            check((await runCommand(agent, '!skills')) === '!skills is not a command.', 'bothOff: !skills is refused');
            const r = await newAction('Write delta three', [codeReply(fnCode('delta'))], [REVIEW]);
            const cp = r.coding[0]?.prompt ?? '';
            check(r.ret.includes('delta 3') && r.reviews.length === 0 && !cp.includes('SAVED SKILLS') && !cp.includes('customSkills'),
                'bothOff: code runs, nothing is reviewed, the coding prompt has no skills section');
            const { prompt, base } = await convoPrompt();
            check(prompt === base, 'bothOff: conversing prompt byte for byte as in v0.1.4.3');
            check(!fs.existsSync(path.join('bots', NAME, 'skills')), 'bothOff: no skills folder was created');
        });
    },
    async noLockdown() {
        const NAME = 'e2e_nolock';
        const SKILLS = path.join('bots', NAME, 'skills');
        await withAgent(NAME, { sandbox_lockdown: false }, async ({ agent, newAction }) => {
            const lk = await importProject('src/agent/library/lockdown.js');
            check(lk.isLockedDown() === false && agent.skill_manager?.flags.reuse === true, 'noLockdown: no SES lockdown, the manager started');
            check(agent.skill_manager?.knownNames().includes('customSkills.oldSkill'), 'noLockdown: the saved skill is loaded into a compartment without lockdown',
                JSON.stringify(agent.skill_manager?.knownNames()));
            let r = await newAction('Use the old skill', [codeReply('await customSkills.oldSkill(bot, 8);')]);
            check(r.ret.includes('old 8'), 'noLockdown: the saved skill runs', JSON.stringify(r.ret.slice(-100)));
            r = await newAction('Write eps three', [codeReply(fnCode('eps', 'writeEps'))], [REVIEW]);
            check(endsWithLine(r.ret, 'Saved this code as the skill customSkills.writeEps. You can call it in later code.') && fs.existsSync(path.join(SKILLS, 'writeEps.js')),
                'noLockdown: a new skill is captured', JSON.stringify(r.ret.slice(-100)));
            r = await newAction('Use eps', [codeReply('await customSkills.writeEps(bot, 2);')]);
            check(r.ret.includes('eps 2'), 'noLockdown: the new skill runs at once', JSON.stringify(r.ret.slice(-100)));
        });
    },
    async main() {
        seedOld('e2e_reuseonly');
        seedOld('e2e_nolock');
        for (const phase of ['captureOnly', 'reuseOnly', 'bothOff', 'noLockdown']) await runPhase(SELF, phase);
        note(`skill files: ${JSON.stringify(listFiles('bots').filter((f) => f.includes('/skills/')))}`);
    },
});
exitSoon();
