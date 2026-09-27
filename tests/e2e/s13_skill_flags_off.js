// S13 skill_flags_off (v0.1.4.4, plan item 8): the flag rule with the real Agent.start, in four
// processes: skill_learning false, and skill_learning true with allow_insecure_coding false; each
// once for a bot that has skill files from an earlier session and once for a bot without them.
// Proves: no manager on the agent; no folder bots/<name>/skills is created; skill files on disk
// from an earlier session stay untouched; the five skill commands are not in the command docs for
// the model and are refused when called; the coding and conversing prompts contain neither
// SAVED SKILLS nor customSkills and are byte for byte the prompts of v0.1.4.3 (replaceStrings
// alone); a prompt with $CUSTOM_SKILLS loses the placeholder (A6); generated code sees
// typeof customSkills === "undefined", and a call of customSkills.x gets the lint result of
// v0.1.4.3; a function plus its call is not reviewed and not saved; $ sequences in generated code
// survive the staging (A7, active with the flag off too); code with a syntax error or with eval(
// is given back to the model and the next attempt succeeds (Amendment 2 B4, active with the flag off).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand, runPhase,
    codeReply, snapshotDir, sameSnapshot, listFiles, withTimeout, importProject,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const SKILL_COMMANDS = ['!skills', '!forgetSkill', '!disableSkill', '!enableSkill', '!useSkill'];
const CASES = {
    offSeeded: { name: 'e2e_skoff', seeded: true, overrides: { skill_learning: false, allow_insecure_coding: true, sandbox_lockdown: true } },
    offFresh: { name: 'e2e_skoff2', seeded: false, overrides: { skill_learning: false, allow_insecure_coding: true, sandbox_lockdown: true } },
    nocodeSeeded: { name: 'e2e_sknc', seeded: true, overrides: { skill_learning: true, skill_command: true, allow_insecure_coding: false } },
    nocodeFresh: { name: 'e2e_sknc2', seeded: false, overrides: { skill_learning: true, skill_command: true, allow_insecure_coding: false } },
};
const OLD_SKILL = [
    'async function oldSkill(bot, n) {',
    '    /**',
    '     * A skill saved in an earlier session.',
    '     **/',
    "    log(bot, 'old ' + n);",
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
].join('\n') + '\n';
const FN_CODE = [
    'async function writeTheNumber(bot, n) {',
    '    /**',
    '     * Writes the number.',
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {number} n, the number.',
    '     **/',
    "    log(bot, 'number ' + n);",
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
    'await writeTheNumber(bot, 42);',
].join('\n');
const DOLLAR_CODE = "const price = 5;\nlog(bot, 'Price: $' + price + \" / $& / $$ / $' / $` end\");\nawait skills.wait(bot, 10);";
const DOLLAR_OUT = "Price: $5 / $& / $$ / $' / $` end";

function seed(name) {
    const dir = path.join('bots', name, 'skills');
    fs.mkdirSync(path.join(dir, '.history'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'oldSkill.js'), OLD_SKILL);
    fs.writeFileSync(path.join(dir, '.history', 'oldSkill.v1.js'), OLD_SKILL.replace('earlier', 'much earlier'));
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, skills: { oldSkill: {
        name: 'oldSkill', signature: 'oldSkill(bot, n)', description: 'A skill saved in an earlier session.', status: 'active', version: 2,
        created: '2026-08-01T10:00:00.000Z', updated: '2026-08-02T10:00:00.000Z', uses: 4, failures: 1, consecutive_failures: 0,
        last_used: '2026-08-03T10:00:00.000Z', last_error: null, source_task: 'earlier', hash: '1'.repeat(64),
    } } }, null, 2));
}

function mtimes(dir) {
    return Object.fromEntries(listFiles(dir).map((f) => [f, fs.statSync(path.join(dir, f)).mtimeMs]));
}

async function runCase(key) {
    const { name, seeded, overrides } = CASES[key];
    const label = `${key}:`;
    const dir = path.join('bots', name, 'skills');
    const snapBefore = snapshotDir(dir);
    const timesBefore = mtimes(dir);
    const server = await startServer({ seedHigh: 13, seedLow: 5, motd: 'Skill Flag Off World' });
    let agent = null;
    try {
        const s = await startRealAgent(name, server.port, overrides);
        agent = s.agent;
        const { chat, code } = s;
        const prompter = agent.prompter;
        check(agent.skill_manager === undefined, `${label} the real Agent.start created no skill manager`);

        // commands
        const { getCommandDocs } = await importProject('src/agent/commands/index.js');
        const docs = getCommandDocs(agent);
        check(SKILL_COMMANDS.every((c) => !docs.includes(c + ':')), `${label} the five skill commands are not in the command docs for the model`);
        for (const c of SKILL_COMMANDS) {
            const call = c === '!skills' ? c : c === '!useSkill' ? `${c}("oldSkill", "[1]")` : `${c}("oldSkill")`;
            const r = await runCommand(agent, call);
            check(r === `${c} is not a command.`, `${label} ${c} is refused when called`, JSON.stringify(r));
        }

        // prompts: byte for byte what replaceStrings alone gives (v0.1.4.3)
        const messages = [
            { role: 'user', content: 'e2e_player: write the number' },
            { role: 'assistant', content: '!newAction("Write the number 42")' },
        ];
        code.reset();
        code.replies.push('```//nothing```');
        await prompter.promptCoding(JSON.parse(JSON.stringify(messages)));
        const cp = code.of('coding')[0]?.prompt ?? '';
        const baseCoding = await prompter.replaceStrings(prompter.profile.coding, JSON.parse(JSON.stringify(messages)), prompter.coding_examples);
        check(cp.length > 0 && !cp.includes('SAVED SKILLS') && !cp.includes('customSkills'), `${label} coding prompt without SAVED SKILLS and customSkills`);
        check(cp === baseCoding, `${label} coding prompt byte for byte the prompt of v0.1.4.3`);
        chat.reset();
        chat.replies.push('Sure.');
        await prompter.promptConvo(JSON.parse(JSON.stringify(messages)));
        const vp = chat.of('chat')[0]?.prompt ?? '';
        const baseConvo = await prompter.replaceStrings(prompter.profile.conversing, JSON.parse(JSON.stringify(messages)), prompter.convo_examples);
        check(vp.length > 0 && !vp.includes('SAVED SKILLS') && !vp.includes('customSkills'), `${label} conversing prompt without SAVED SKILLS and customSkills`);
        check(vp === baseConvo, `${label} conversing prompt byte for byte the prompt of v0.1.4.3`);
        const savedConvo = prompter.profile.conversing;
        try {
            prompter.profile.conversing = 'E2E CONVO $NAME\n$CUSTOM_SKILLS\nEND';
            chat.reset();
            chat.replies.push('Sure.');
            await prompter.promptConvo(JSON.parse(JSON.stringify(messages)));
            const pp = chat.of('chat')[0]?.prompt ?? '';
            check(pp === `E2E CONVO ${name}\n\nEND`, `${label} [A6] without a manager $CUSTOM_SKILLS is removed from a prompt`, JSON.stringify(pp));
        } finally {
            prompter.profile.conversing = savedConvo;
        }

        // generated code
        const newAction = async (task, replies, reviews = []) => {
            code.reset();
            code.replies.push(...replies);
            code.reviews.push(...reviews);
            agent.history.turns = [];
            await agent.history.add(agent.name, `!newAction("${task}")`);
            const ret = await withTimeout(runCommand(agent, `!newAction("${task}")`), 30000, task);
            const coding = code.of('coding');
            return { ret, coding, reviews: code.of('review'), feedback: coding.slice(1).map((r) => String(r.turns[r.turns.length - 1]?.content)).join('\n') };
        };
        const review = JSON.stringify({ achieved: true, reusable: true, description: 'Writes a number.', reason: 'e2e' });
        if (overrides.allow_insecure_coding) {
            let r = await newAction('Check customSkills', [codeReply("log(bot, 'typeof customSkills: ' + typeof customSkills);\nawait skills.wait(bot, 10);")]);
            check(r.ret.includes('typeof customSkills: undefined'), `${label} generated code sees typeof customSkills === "undefined"`, JSON.stringify(r.ret.slice(-120)));
            r = await newAction('Call a saved skill', [codeReply('await customSkills.oldSkill(bot, 1);'), codeReply("log(bot, 'second attempt');\nawait skills.wait(bot, 10);")]);
            check(r.feedback.includes("'customSkills' is not defined") && !r.feedback.includes('These functions do not exist') && r.ret.includes('second attempt'),
                `${label} a call of customSkills.x gets the lint result of v0.1.4.3 (ESLint no-undef, not the skill check)`, JSON.stringify(r.feedback.slice(0, 200)));
            r = await newAction('Write the number 42', [codeReply(FN_CODE)], [review]);
            check(r.ret.includes('number 42') && r.reviews.length === 0 && !/Saved this code|Updated the saved skill/.test(r.ret),
                `${label} a function plus its call runs and is neither reviewed nor saved`, `reviews=${r.reviews.length}`);
            check(agent.coder.last_run === null, `${label} Coder.last_run stays null without a manager`);
            r = await newAction('Write a price', [codeReply(DOLLAR_CODE)]);
            check(r.ret.includes('\n' + DOLLAR_OUT + '\n'), `${label} [A7] $ sequences in generated code survive the staging`, JSON.stringify(/Price: .*/.exec(r.ret)?.[0]));
            // B4 is active with the flag off too
            const PREP = 'Error: Code could not be prepared for execution:\n';
            for (const [what, bad, errRe] of [
                ['a syntax error', "log(bot, 'broken' ;", /SyntaxError/],
                ['eval(', "const two = eval('1 + 1');\nlog(bot, 'two ' + two);", /eval/i],
            ]) {
                r = await newAction('Stage code with ' + what.replace('(', ''),
                    [codeReply(bad), codeReply("log(bot, 'b4 good attempt');\nawait skills.wait(bot, 10);")]);
                const fb = (r.coding[1]?.turns ?? []).map((t) => String(t.content)).find((c) => c.startsWith(PREP)) ?? '';
                check(r.coding.length === 2 && r.ret.includes('b4 good attempt') && !r.ret.startsWith('Error generating code'),
                    `${label} [B4] code with ${what}, then a good attempt: !newAction ends successfully after two model calls`,
                    `calls=${r.coding.length} ${JSON.stringify(r.ret.slice(0, 160))}`);
                check(fb.endsWith('\nPlease try again.') && errRe.test(fb),
                    `${label} [B4] code with ${what}: the second request to the model contains the feedback that the code could not be prepared`,
                    JSON.stringify(fb.slice(0, 220)));
            }
        } else {
            const r = await newAction('Write the number 42', [codeReply(FN_CODE)], [review]);
            check(r.ret === 'newAction not allowed! Code writing is disabled in settings. Notify the user.' && r.coding.length === 0 && r.reviews.length === 0,
                `${label} !newAction is refused as in v0.1.4.3 and no model request is made`, JSON.stringify(r.ret));
        }
        check(s.realCalls.length === 0, `${label} no request reached a real model class`, JSON.stringify(s.realCalls));
    } finally {
        await stopRealAgent(agent);
        await server.stop();
    }
    if (seeded) {
        check(sameSnapshot(snapBefore, snapshotDir(dir)) && JSON.stringify(timesBefore) === JSON.stringify(mtimes(dir)),
            `${label} the skill files of an earlier session are untouched (content and modification time)`, JSON.stringify(listFiles(dir)));
    } else {
        check(!fs.existsSync(dir), `${label} no folder bots/<name>/skills was created`, JSON.stringify(listFiles(path.join('bots', name))));
    }
}

await scenarioMain({
    offSeeded: () => runCase('offSeeded'),
    offFresh: () => runCase('offFresh'),
    nocodeSeeded: () => runCase('nocodeSeeded'),
    nocodeFresh: () => runCase('nocodeFresh'),
    async main() {
        for (const [key, c] of Object.entries(CASES)) {
            if (c.seeded) seed(c.name);
            const dir = path.join('bots', c.name, 'skills');
            const before = snapshotDir(dir);
            await runPhase(SELF, key);
            if (c.seeded) check(sameSnapshot(before, snapshotDir(dir)), `${key}: seen from the parent process, the old skill files are unchanged`);
            else check(!fs.existsSync(dir), `${key}: seen from the parent process, no skills folder exists`);
        }
    },
});
exitSoon();
