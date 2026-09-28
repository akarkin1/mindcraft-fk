// S14 skill_agent_start (v0.1.4.4, plan item 9 and Amendment 2 B1): the real Agent.start with
// skill_learning on, in three processes.
// garbage     a skills folder with a corrupt index.json, a file with a syntax error, a directory
//             named like a skill file, a file with an invalid skill name, a text file, one good
//             skill. Proves: the start creates the manager and loads the good skill; the garbage
//             does not stop the agent: it spawns, runs generated code that calls the good skill,
//             saves a new skill next to the garbage and lists the skills; the corrupt index is set
//             aside (not deleted) and rebuilt from the skill files; the directory and the other
//             files stay as they were. B1: a skill whose file is written but cannot be loaded
//             (SES refuses "$import(" anywhere in a text, also in the doc block built from the
//             review description, and the validator does not match it) is saved with the message
//             "..., but it could not be loaded." for created and for updated, and is listed as
//             [broken]. (v0.1.4.5: "import //" is refused by the validator now, G5.)
// v0.1.4.5: the saved functions call world.getPosition and skills.wait, so they are not trivial
// (G3); save messages follow the text before after exactly one line break.
// notADir     bots/<name>/skills is a FILE. B1: the skill file cannot be written, so nothing is
//             announced as saved, the store knows no skill that is not on disk, no command
//             throws, the next coding prompt offers nothing and the bot keeps working.
// indexIsDir  bots/<name>/skills/index.json is a DIRECTORY. B1: only the index cannot be written,
//             so the skill counts as saved, is loaded and runs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand, runPhase,
    codeReply, listFiles, readJson, withTimeout, endsWithLine,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const GOOD = [
    'async function goodSkill(bot, word) {',
    '    /**',
    '     * Writes good and the word.',
    '     **/',
    "    log(bot, 'good ' + word);",
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
].join('\n') + '\n';
const CORRUPT_INDEX = '{ "version": 1, "skills": { "goodSkill": { "name": "goodSkill", ';
const NEW_FN = [
    'async function writeNewThing(bot, n) {',
    '    /**',
    '     * Writes a new thing with a number.',
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {number} n, the number.',
    '     **/',
    '    const start = world.getPosition(bot);',
    "    log(bot, 'new thing ' + n + ' at y' + Math.round(start.y));",
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
    'await writeNewThing(bot, 5);',
].join('\n');
const REVIEW = JSON.stringify({ achieved: true, reusable: true, description: 'Writes a new thing.', reason: 'e2e' });
// no own doc block: the block is built from the review description, which SES refuses to
// evaluate ("$import(" matches the import pattern of SES, not the forbidden token of the validator)
const IMPORT_FN = (v) => [
    'async function noteImportCount(bot, n) {',
    '    const start = world.getPosition(bot);',
    `    log(bot, 'import note ' + n + ' v${v} at y' + Math.round(start.y));`,
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
    'await noteImportCount(bot, 2);',
].join('\n');
const IMPORT_REVIEW = JSON.stringify({ achieved: true, reusable: true, description: 'Notes the $import( of n items.', reason: 'e2e' });

async function withAgent(name, steps) {
    const server = await startServer({ seedHigh: 14, seedLow: 6, motd: 'Skill Start World' });
    let agent = null;
    try {
        const s = await startRealAgent(name, server.port, { sandbox_lockdown: true, allow_insecure_coding: true, skill_learning: true });
        agent = s.agent;
        check(agent.bot?.entity?.position?.y === 64 && typeof agent.respondFunc === 'function',
            `${name}: the agent started, spawned and set up its event handlers`);
        const newAction = async (task, replies, reviews = []) => {
            s.code.reset();
            s.code.replies.push(...replies);
            s.code.reviews.push(...reviews);
            agent.history.turns = [];
            await agent.history.add(agent.name, `!newAction("${task}")`);
            return withTimeout(runCommand(agent, `!newAction("${task}")`), 30000, task);
        };
        await steps({ agent, newAction, code: s.code });
        check(s.realCalls.length === 0, `${name}: no request reached a real model class`, JSON.stringify(s.realCalls));
    } finally {
        await stopRealAgent(agent);
        await server.stop();
    }
}

await scenarioMain({
    async garbage() {
        const dir = path.join('bots', 'e2e_skstart', 'skills');
        await withAgent('e2e_skstart', async ({ agent, newAction }) => {
            check(agent.skill_manager !== undefined, 'garbage: the real Agent.start created the skill manager');
            check(JSON.stringify(agent.skill_manager?.knownNames()) === JSON.stringify(['customSkills.goodSkill']),
                'garbage: only the good skill is loaded', JSON.stringify(agent.skill_manager?.knownNames()));
            const files = listFiles(dir);
            note(`files after the start: ${JSON.stringify(files)}`);
            const aside = files.filter((f) => f !== 'index.json' && f.startsWith('index.'));
            check(aside.length === 1 && fs.readFileSync(path.join(dir, aside[0]), 'utf8') === CORRUPT_INDEX,
                'garbage: the corrupt index.json was set aside with its content, not deleted', JSON.stringify(aside));
            let index = null;
            try { index = readJson(path.join(dir, 'index.json')); } catch (e) { note('index.json: ' + e.message); }
            check(index?.version === 1 && index.skills?.goodSkill?.status === 'active' && index.skills.goodSkill.description === 'Writes good and the word.',
                'garbage: index.json was rebuilt from the skill files', JSON.stringify(index));
            check(!Object.keys(index?.skills || {}).some((n) => n === 'dirSkill' || n.includes('Bad')),
                'garbage: the directory and the file with an invalid name are not taken as skills', JSON.stringify(Object.keys(index?.skills || {})));
            check(fs.statSync(path.join(dir, 'dirSkill.js')).isDirectory() && fs.readFileSync(path.join(dir, 'dirSkill.js', 'inner.txt'), 'utf8') === 'inner'
                && fs.readFileSync(path.join(dir, 'Bad-Name.js'), 'utf8') === 'garbage' && fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8') === 'notes',
            'garbage: the directory named like a skill file and the other files are untouched');

            let r = await newAction('Use the good skill', [codeReply("await customSkills.goodSkill(bot, 'morning');")]);
            check(r.includes('good morning'), 'garbage: generated code calls the good skill', JSON.stringify(r.slice(-100)));
            r = await newAction('Write a new thing', [codeReply(NEW_FN)], [REVIEW]);
            check(endsWithLine(r, 'Saved this code as the skill customSkills.writeNewThing. You can call it in later code.')
                && fs.readFileSync(path.join(dir, 'writeNewThing.js'), 'utf8') === NEW_FN.slice(0, NEW_FN.lastIndexOf('\nawait')) + '\n',
            'garbage: a new skill is saved next to the garbage', JSON.stringify(r.slice(-120)));
            // B1: the skill file is written but cannot be loaded; the message says so
            r = await newAction('Note the import of two items', [codeReply(IMPORT_FN(1))], [IMPORT_REVIEW]);
            const importFile = path.join(dir, 'noteImportCount.js');
            check(r.includes('import note 2 v1'), 'garbage: the code of the skill that cannot be loaded ran', JSON.stringify(r.slice(-200)));
            check(fs.existsSync(importFile) && fs.readFileSync(importFile, 'utf8').includes('Notes the $import( of n items.'),
                '[B1] the skill file was written, with the doc block built from the review description');
            check(!agent.skill_manager.knownNames().includes('customSkills.noteImportCount'), '[B1] the written skill is not among the loaded skills',
                JSON.stringify(agent.skill_manager.knownNames()));
            check(endsWithLine(r, 'Saved this code as the skill noteImportCount, but it could not be loaded.'),
                '[B1] created: the reply says that the saved skill could not be loaded', JSON.stringify(r.slice(-120)));
            r = await newAction('Note the import of two items again', [codeReply(IMPORT_FN(2))], [IMPORT_REVIEW]);
            check(r.includes('import note 2 v2') && readJson(path.join(dir, 'index.json')).skills?.noteImportCount?.version === 2,
                'garbage: the changed function was saved as version 2', JSON.stringify(r.slice(-160)));
            check(endsWithLine(r, 'Updated the saved skill noteImportCount, but it could not be loaded.'),
                '[B1] updated: the reply says that the saved skill could not be loaded', JSON.stringify(r.slice(-120)));
            r = await newAction('Use the good skill again', [codeReply("await customSkills.goodSkill(bot, 'evening');")]);
            check(r.includes('good evening'), 'garbage: the bot keeps working after the skill that cannot be loaded', JSON.stringify(r.slice(-100)));

            r = await runCommand(agent, '!skills');
            check(r.includes('- goodSkill(bot, word): Writes good and the word.') && r.includes('- writeNewThing(bot, n): '),
                'garbage: !skills lists the skills', JSON.stringify(r));
            check(/- brokenSyntax\(bot\): [^\n]*\[broken\]/.test(r), 'garbage: [A2] the file with the syntax error is listed as [broken]', JSON.stringify(r));
            check(/- noteImportCount\(bot, n\): [^\n]*\[broken\]/.test(r), 'garbage: the skill that cannot be loaded is listed as [broken]', JSON.stringify(r));
        });
    },
    async notADir() {
        const file = path.join('bots', 'e2e_skfile', 'skills');
        await withAgent('e2e_skfile', async ({ agent, newAction, code }) => {
            check(agent.skill_manager !== undefined && agent.skill_manager.knownNames().length === 0,
                'skills is a file: the agent starts with a manager and no skills', JSON.stringify(agent.skill_manager?.knownNames()));
            let r = await runCommand(agent, '!skills');
            check(r === 'No skills are saved yet.', 'skills is a file: !skills answers', JSON.stringify(r));
            r = await newAction('Write a new thing', [codeReply(NEW_FN)], [REVIEW]);
            check(r.includes('new thing 5'), 'skills is a file: generated code still runs', JSON.stringify(r.slice(-160)));
            // B1: the skill file cannot be written, so the save failed (reason save_failed)
            check(!/Saved this code|Updated the saved skill|could not be loaded/.test(r),
                '[B1] skills is a file: the reply of !newAction has no save message',
                JSON.stringify(r.slice(r.lastIndexOf('```') + 3).trim().split('\n').slice(-1)[0]));
            const listAfter = await runCommand(agent, '!skills');
            check(agent.skill_manager.knownNames().length === 0 && listAfter === 'No skills are saved yet.',
                '[B1] skills is a file: nothing is announced as saved (no skill loaded, !skills: No skills are saved yet.)',
                `knownNames=${JSON.stringify(agent.skill_manager.knownNames())} !skills=${JSON.stringify(listAfter)}`);
            // no command throws, and the store knows no skill that is not on disk
            const replies = [];
            for (const cmd of ['!disableSkill("writeNewThing")', '!enableSkill("writeNewThing")', '!forgetSkill("writeNewThing")']) {
                try { replies.push(await runCommand(agent, cmd)); } catch (e) { replies.push('THREW ' + e.message); }
            }
            check(replies.every((x) => !x.startsWith('THREW')), 'skills is a file: the skill commands do not throw', JSON.stringify(replies));
            check(replies.every((x) => x === 'No skill named "writeNewThing" is saved.'),
                '[B1] skills is a file: the commands know no skill writeNewThing (the store shows what is on disk)', JSON.stringify(replies));
            r = await newAction('Plain code', [codeReply("log(bot, 'still working');\nawait skills.wait(bot, 10);")]);
            check(r.includes('still working'), 'skills is a file: the bot keeps working');
            const nextPrompt = code.of('coding')[0]?.prompt ?? '';
            check(nextPrompt.includes('No skills are saved yet.') && !nextPrompt.includes('writeNewThing'),
                '[B1] skills is a file: the next coding prompt offers no skill', JSON.stringify(/#### SAVED SKILLS[^]*?(?=\nConversation:)/.exec(nextPrompt)?.[0]?.slice(-160)));
            check(fs.statSync(file).isFile() && fs.readFileSync(file, 'utf8') === 'not a directory', 'skills is a file: the file is untouched');
        });
    },
    async indexIsDir() {
        const dir = path.join('bots', 'e2e_skidx', 'skills');
        await withAgent('e2e_skidx', async ({ agent, newAction }) => {
            check(JSON.stringify(agent.skill_manager?.knownNames()) === JSON.stringify(['customSkills.goodSkill']),
                'index.json is a directory: the start loads the skill from the skill files', JSON.stringify(agent.skill_manager?.knownNames()));
            let r = await newAction('Write a new thing', [codeReply(NEW_FN)], [REVIEW]);
            check(endsWithLine(r, 'Saved this code as the skill customSkills.writeNewThing. You can call it in later code.')
                && fs.existsSync(path.join(dir, 'writeNewThing.js')),
            '[B1] only index.json could not be written: the skill counts as saved', JSON.stringify(r.slice(-120)));
            r = await newAction('Use the new thing', [codeReply('await customSkills.writeNewThing(bot, 6);')]);
            check(r.includes('new thing 6'), 'index.json is a directory: the new skill is loaded and runs', JSON.stringify(r.slice(-100)));
            check(fs.statSync(path.join(dir, 'index.json')).isDirectory() && fs.readFileSync(path.join(dir, 'index.json', 'keep.txt'), 'utf8') === 'keep',
                'index.json is a directory: the directory and its content are untouched');
        });
    },
    async main() {
        const dir = path.join('bots', 'e2e_skstart', 'skills');
        fs.mkdirSync(path.join(dir, 'dirSkill.js'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'dirSkill.js', 'inner.txt'), 'inner');
        fs.writeFileSync(path.join(dir, 'index.json'), CORRUPT_INDEX);
        fs.writeFileSync(path.join(dir, 'goodSkill.js'), GOOD);
        fs.writeFileSync(path.join(dir, 'brokenSyntax.js'), "async function brokenSyntax(bot) {\n    /**\n     * Broken.\n     **/\n    log(bot, 'x' ;\n}\n");
        fs.writeFileSync(path.join(dir, 'Bad-Name.js'), 'garbage');
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'notes');
        await runPhase(SELF, 'garbage');
        fs.mkdirSync(path.join('bots', 'e2e_skfile'), { recursive: true });
        fs.writeFileSync(path.join('bots', 'e2e_skfile', 'skills'), 'not a directory');
        await runPhase(SELF, 'notADir');
        const idxDir = path.join('bots', 'e2e_skidx', 'skills');
        fs.mkdirSync(path.join(idxDir, 'index.json'), { recursive: true });
        fs.writeFileSync(path.join(idxDir, 'index.json', 'keep.txt'), 'keep');
        fs.writeFileSync(path.join(idxDir, 'goodSkill.js'), GOOD);
        await runPhase(SELF, 'indexIsDir');
    },
});
exitSoon();
