// S10 skill_reuse (v0.1.4.4, plan items 3, 4 and part of 9): three processes on the same temp
// directory, each with the real Agent.start (skill_learning on, lockdown on), the real !newAction,
// the real Coder with its lint, and a real bot on the simulated server. Only the model is canned.
//
// learn   captures announceCount, then announceTwice, whose code calls customSkills.announceCount.
// reuse   a NEW process: the real agent start creates the manager and loads both skills from disk;
//         new code that calls customSkills.announceCount passes the lint, runs, its output is in the
//         result and `uses` in index.json went up; a saved skill calls another saved skill through
//         customSkills; customSkills.doesNotExist is rejected by the lint with the feedback of the
//         spec and the next attempt succeeds. Update: code that defines announceCount again with
//         another body is saved as version 2, the old source is in .history/, the reply ends with
//         the update message, and code in the same process (and the other skill) gets the new body.
// after   a NEW process loads version 2 from disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand, runPhase,
    codeReply, readJson, listFiles, withTimeout, emitData,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'e2e_reuse';
const SKILLS = path.join('bots', NAME, 'skills');
const INDEX = path.join(SKILLS, 'index.json');
const reviewYes = (description) => JSON.stringify({ achieved: true, reusable: true, description, reason: 'e2e canned review' });
const sha = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const readIndex = () => { try { return readJson(INDEX); } catch { return null; } };

const COUNT_V1 = [
    'async function announceCount(bot, word, times) {',
    '    /**',
    '     * Writes the word the given number of times into the action output.',
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {string} word, the word to write.',
    '     * @param {number} times, how often to write it.',
    '     * @returns {Promise<boolean>} true when done.',
    '     **/',
    '    for (let i = 0; i < times; i++) {',
    "        log(bot, 'announce ' + word + ' #' + (i + 1));",
    '    }',
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
].join('\n');
const TWICE = [
    'async function announceTwice(bot, word) {',
    '    /**',
    '     * Writes the word twice by calling the saved skill announceCount.',
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {string} word, the word to write.',
    '     * @returns {Promise<boolean>} the result of announceCount.',
    '     **/',
    "    log(bot, 'twice start ' + word);",
    '    const ok = await customSkills.announceCount(bot, word, 2);',
    "    log(bot, 'twice end ' + word);",
    '    return ok;',
    '}',
].join('\n');
const COUNT_V2 = [
    'async function announceCount(bot, word, times) {',
    '    /**',
    '     * Writes the word and the count in one line.',
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {string} word, the word to write.',
    '     * @param {number} times, the count to write.',
    '     * @returns {Promise<boolean>} true when done.',
    '     **/',
    "    log(bot, 'ANNOUNCE v2 ' + word + ' x' + times);",
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
].join('\n');

// Starts the fake server and the real agent, runs steps, stops both.
async function visit(steps) {
    const server = await startServer({ seedHigh: 10, seedLow: 2, motd: 'Skill Reuse World' });
    let agent = null;
    try {
        const s = await startRealAgent(NAME, server.port, { sandbox_lockdown: true, allow_insecure_coding: true, skill_learning: true });
        agent = s.agent;
        const { code } = s;
        const newAction = async (task, replies, reviews = []) => {
            code.reset();
            code.replies.push(...replies);
            code.reviews.push(...reviews);
            agent.history.turns = [];
            await agent.history.add('e2e_player', 'please: ' + task);
            await agent.history.add(agent.name, `!newAction("${task}")`);
            const ret = await withTimeout(runCommand(agent, `!newAction("${task}")`), 30000, '!newAction ' + task);
            const coding = code.of('coding');
            return {
                ret, coding, reviews: code.of('review'),
                feedback: coding.slice(1).map((r) => String(r.turns[r.turns.length - 1]?.content)),
            };
        };
        await steps({ agent, code, chat: s.chat, newAction, server });
        check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
    } finally {
        await stopRealAgent(agent);
        await server.stop();
    }
}

await scenarioMain({
    async learn() {
        await visit(async ({ agent, code, chat, newAction }) => {
            // the whole conversation path: a player asks, the chat model answers with !newAction,
            // Agent.handleMessage runs the command and puts its result into the history
            const SAVED = 'Saved this code as the skill customSkills.announceCount. You can call it in later code.';
            code.reset();
            chat.reset();
            agent.history.turns = [];
            chat.replies.push('Sure! !newAction("Announce dirt two times")');
            code.replies.push(codeReply(COUNT_V1 + "\nawait announceCount(bot, 'dirt', 2);"));
            code.reviews.push(reviewYes('Writes a word several times.'));
            const used = await withTimeout(agent.handleMessage('e2e_player', 'Please announce dirt two times'), 30000, 'handleMessage');
            const result = agent.history.turns.find((t) => t.role === 'system' && t.content.includes('announce dirt #2'));
            check(used === true && result?.content.endsWith('\n' + SAVED),
                'learn: through Agent.handleMessage, the result of !newAction in the history ends with the save message', JSON.stringify(result?.content.slice(-140)));
            check(readIndex()?.skills?.announceCount?.source_task === 'Announce dirt two times',
                'learn: source_task is the task the chat model wrote in !newAction', JSON.stringify(readIndex()?.skills?.announceCount?.source_task));
            check(chat.of('chat').length === 2 && chat.of('chat')[1].turns.some((t) => t.role === 'system' && t.content.endsWith(SAVED)),
                'learn: the next conversation request shows the model the save message');
            let r;
            r = await newAction('Announce sand twice', [codeReply(TWICE + "\nawait announceTwice(bot, 'sand');")],
                [reviewYes('Writes a word twice.')]);
            check(/twice start sand\nannounce sand #1\nannounce sand #2\ntwice end sand/.test(r.ret),
                'learn: new code whose function calls customSkills.announceCount passes the lint and runs the saved skill', JSON.stringify(r.ret.slice(-300)));
            check(r.ret.endsWith('\nSaved this code as the skill customSkills.announceTwice. You can call it in later code.'),
                'learn: announceTwice was saved', JSON.stringify(r.ret.slice(-120)));
            check(r.reviews[0]?.prompt.includes('SKILLS SAVED SO FAR: announceCount(bot, word, times)\n'),
                'learn: the second review prompt lists the skill saved before', JSON.stringify(/SKILLS SAVED SO FAR: .*/.exec(r.reviews[0]?.prompt || '')?.[0]));
            const index = readIndex();
            check(index?.skills?.announceCount?.uses === 1 && index?.skills?.announceTwice?.uses === 0,
                'learn: the call of customSkills.announceCount inside the second run was counted (uses 1)',
                JSON.stringify({ count: index?.skills?.announceCount?.uses, twice: index?.skills?.announceTwice?.uses }));
            emitData('index', index);
        });
    },
    async reuse() {
        await visit(async ({ agent, code, newAction }) => {
            const before = readIndex();
            check(agent.skill_manager && JSON.stringify(agent.skill_manager.knownNames()) === JSON.stringify(['customSkills.announceCount', 'customSkills.announceTwice']),
                'agent start in a new process: the manager exists and loaded both skills from disk', JSON.stringify(agent.skill_manager?.knownNames()));

            let r = await newAction('Announce stone three times',
                [codeReply("const ok = await customSkills.announceCount(bot, 'stone', 3);\nlog(bot, 'skill returned ' + ok);")]);
            check(r.coding.length === 1 && r.feedback.length === 0, 'reuse: code that calls customSkills.announceCount passes the lint on the first attempt',
                `coding=${r.coding.length}`);
            check(r.ret.includes('announce stone #1\nannounce stone #2\nannounce stone #3') && r.ret.includes('skill returned true'),
                'reuse: the output of the saved skill is in the result of !newAction', JSON.stringify(r.ret.slice(-200)));
            check(r.coding[0]?.prompt.includes('### customSkills.announceCount') && r.coding[0]?.prompt.includes('### customSkills.announceTwice'),
                'reuse: the coding prompt of the new process shows the skills loaded from disk');
            let idx = readIndex();
            const countUses0 = before?.skills?.announceCount?.uses;
            check(idx?.skills?.announceCount?.uses === countUses0 + 1 && typeof idx.skills.announceCount.last_used === 'string'
                && idx.skills.announceCount.consecutive_failures === 0,
            'reuse: uses of announceCount in index.json went up by 1 and last_used is set', `${countUses0} -> ${idx?.skills?.announceCount?.uses}, ${idx?.skills?.announceCount?.last_used}`);

            r = await newAction('Announce moss twice', [codeReply("await customSkills.announceTwice(bot, 'moss');")]);
            check(/twice start moss\nannounce moss #1\nannounce moss #2\ntwice end moss/.test(r.ret),
                'reuse: a saved skill (announceTwice) calls another saved skill (announceCount) through customSkills', JSON.stringify(r.ret.slice(-200)));
            idx = readIndex();
            check(idx?.skills?.announceTwice?.uses === (before?.skills?.announceTwice?.uses ?? NaN) + 1 && idx?.skills?.announceCount?.uses === countUses0 + 2,
                'reuse: both skills were counted', JSON.stringify({ count: idx?.skills?.announceCount?.uses, twice: idx?.skills?.announceTwice?.uses }));

            r = await newAction('Call a skill that does not exist',
                [codeReply('await customSkills.doesNotExist(bot);'), codeReply("await customSkills.announceCount(bot, 'gravel', 1);")]);
            check(r.feedback[0]?.includes('These functions do not exist') && r.feedback[0]?.includes('customSkills.doesNotExist'),
                'reuse: customSkills.doesNotExist is rejected by the lint with the feedback that the function does not exist', JSON.stringify(r.feedback[0]?.slice(0, 200)));
            check(r.coding.length === 2 && r.ret.includes('announce gravel #1'), 'reuse: the next attempt succeeds', `coding=${r.coding.length}`);

            // cost of the use counter: every call writes index.json (atomic write with fsync)
            const LOOP = 50;
            const tLoop = Date.now();
            r = await newAction('Call a skill in a loop',
                [codeReply(`for (let i = 0; i < ${LOOP}; i++) {\n    await customSkills.announceCount(bot, 'loop', 0);\n}\nlog(bot, 'loop done');`)]);
            const loopMs = Date.now() - tLoop;
            check(r.ret.includes('loop done') && readIndex()?.skills?.announceCount?.uses === countUses0 + 3 + LOOP,
                `reuse: ${LOOP} calls in a loop are all counted`, `uses=${readIndex()?.skills?.announceCount?.uses}`);
            note(`${LOOP} calls of a skill that waits 10 ms took ${loopMs} ms in total (${(loopMs / LOOP).toFixed(1)} ms per call, of which 10 ms wait)`);

            // update: announceCount with another body
            const usesBeforeUpdate = readIndex()?.skills?.announceCount?.uses;
            const oldSource = fs.readFileSync(path.join(SKILLS, 'announceCount.js'), 'utf8');
            r = await newAction('Announce clay with the count', [codeReply(COUNT_V2 + "\nawait announceCount(bot, 'clay', 4);")],
                [reviewYes('Writes the word and the count.')]);
            check(r.ret.includes('ANNOUNCE v2 clay x4'), 'update: the new function ran', JSON.stringify(r.ret.slice(-160)));
            check(r.ret.endsWith('\nUpdated the saved skill customSkills.announceCount.'), 'update: the reply ends with the update message',
                JSON.stringify(r.ret.slice(-100)));
            check(r.reviews[0]?.prompt.includes('SKILLS SAVED SO FAR: announceCount(bot, word, times), announceTwice(bot, word)\n'),
                'update: the review prompt lists both saved skills', JSON.stringify(/SKILLS SAVED SO FAR: .*/.exec(r.reviews[0]?.prompt || '')?.[0]));
            idx = readIndex();
            const e = idx?.skills?.announceCount;
            const newSource = fs.readFileSync(path.join(SKILLS, 'announceCount.js'), 'utf8');
            check(e?.version === 2 && e.status === 'active', 'update: the skill has version 2', JSON.stringify(e));
            check(newSource === COUNT_V2 + '\n' && e?.hash === sha(newSource), 'update: announceCount.js holds the new body and the hash matches it');
            check(e?.description === 'Writes the word and the count in one line.', 'update: the description is replaced', JSON.stringify(e?.description));
            check(e?.uses === usesBeforeUpdate && e.updated !== e.created, 'update: uses are kept, updated is set', JSON.stringify(e));
            const hist = listFiles(path.join(SKILLS, '.history'));
            const v1 = path.join(SKILLS, '.history', 'announceCount.v1.js');
            check(hist.includes('announceCount.v1.js') && fs.readFileSync(v1, 'utf8') === oldSource && oldSource === COUNT_V1 + '\n',
                'update: the old source is in .history/announceCount.v1.js', JSON.stringify(hist));

            r = await newAction('Announce loam', [codeReply("await customSkills.announceCount(bot, 'loam', 2);")]);
            check(r.ret.includes('ANNOUNCE v2 loam x2') && !r.ret.includes('announce loam #1'),
                'update: code in the same process that calls customSkills.announceCount gets the new behaviour', JSON.stringify(r.ret.slice(-160)));
            r = await newAction('Announce silt twice', [codeReply("await customSkills.announceTwice(bot, 'silt');")]);
            check(r.ret.includes('ANNOUNCE v2 silt x2') && !r.ret.includes('announce silt #1'),
                'update: the other saved skill that calls announceCount gets the new behaviour as well', JSON.stringify(r.ret.slice(-200)));
            note(`code requests in the last run: ${code.requests.length}`);
        });
    },
    async after() {
        await visit(async ({ agent, newAction }) => {
            check(agent.skill_manager?.knownNames().length === 2, 'after: both skills loaded from disk again', JSON.stringify(agent.skill_manager?.knownNames()));
            const r = await newAction('Announce peat', [codeReply("await customSkills.announceCount(bot, 'peat', 1);")]);
            check(r.ret.includes('ANNOUNCE v2 peat x1'), 'after: a new process runs version 2 of the updated skill', JSON.stringify(r.ret.slice(-160)));
            check(readIndex()?.skills?.announceCount?.version === 2, 'after: index.json still says version 2');
        });
    },
    async main() {
        const learn = await runPhase(SELF, 'learn');
        check(fs.existsSync(path.join(SKILLS, 'announceCount.js')) && fs.existsSync(path.join(SKILLS, 'announceTwice.js')),
            'after the first process: both skill files are on disk', JSON.stringify(listFiles(SKILLS)));
        check(learn.data.index?.skills && Object.keys(learn.data.index.skills).length === 2, 'the first process reported an index with two skills');
        await runPhase(SELF, 'reuse');
        await runPhase(SELF, 'after');
        note(`files at the end: ${JSON.stringify(listFiles(SKILLS))}`);
    },
});
exitSoon();
