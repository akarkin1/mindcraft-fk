// S9 skill_capture (v0.1.4.4, plan items 1 and 2): the real Agent.start with skill_learning on and
// the SES lockdown on, the real !newAction command from the command list, the real Coder,
// ActionManager, Prompter and SkillManager, and a real mineflayer bot on the simulated server
// (which answers /give and /tp). Only the language model is replaced by canned replies.
//
// Capture proves: generated code that is one async function with parameters and a doc block plus
// its call runs on the bot; the review prompt that the model receives contains the task, the code,
// the output and the change of the bot; bots/<name>/skills/<fn>.js and index.json are written in
// the temp directory with the content of the spec; the reply of !newAction ends with the save
// message; the new skill is loaded at once.
//
// No capture proves, one case each: nothing is written to the skills folder and the reply has no
// save message when the review says not achieved, the review says not reusable, the review reply
// is not JSON, the review call throws, the code is plain statements, the first attempt throws and
// the second works as plain statements, the function contains coordinates of the world, the
// function has the name of a built-in skill, or the run was interrupted while the code waited;
// also for the amendment cases: a doc block with only @ lines and no review description (A4),
// "Function (" in a string (A1), a name that differs from a saved one only in case (one file on
// Windows), a Windows device name (nul).
//
// Also: $ sequences survive the staging (A7), the review prompt, the skill file, the loaded skill
// and both prompt sections; a function without a doc block gets the block of the spec from the
// review description; retrieval( and .constructorName are no forbidden tokens (A1); with
// skill_command off !useSkill is blocked and not mentioned.
// Amendment 2: B3 a function that reads a constant declared above it, writes to a variable
// declared above it, or reads the browser global window is not saved and no file is written; the same
// function with the value as a parameter is saved and runs. B4 code with a syntax error or with
// eval( is given back to the model and the next attempt ends !newAction successfully.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand,
    snapshotDir, sameSnapshot, codeReply, readJson, listFiles, withTimeout, sleep, importProject,
} from './helpers.js';

const NAME = 'e2e_capture';
const SKILLS = path.join('bots', NAME, 'skills');
const SAVE_TEXT = /Saved this code as the skill|Updated the saved skill/;
const ENTRY_KEYS = ['name', 'signature', 'description', 'status', 'version', 'created', 'updated', 'uses',
    'failures', 'consecutive_failures', 'last_used', 'last_error', 'source_task', 'hash'];
const review = (achieved, reusable, description = 'Logs a marker and an amount.') =>
    JSON.stringify({ achieved, reusable, description, reason: 'e2e canned review' });

const TASK = 'Get 3 dirt and walk 5 blocks east';
const CAPTURE_FN = [
    'async function gatherDirtAndWalk(bot, count, step) {',
    '    /**',
    '     * Gets the given number of dirt blocks and walks the given number of blocks east.',
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {number} count, how many dirt blocks to get.',
    '     * @param {number} step, how many blocks to walk east.',
    '     * @returns {Promise<boolean>} true if the bot has the dirt.',
    '     **/',
    '    const start = world.getPosition(bot);',
    "    bot.chat('/give @s dirt ' + count);",
    "    bot.chat('/tp @s ' + (start.x + step) + ' ' + start.y + ' ' + start.z);",
    '    await skills.wait(bot, 500);',
    '    const have = world.getInventoryCounts(bot).dirt || 0;',
    "    log(bot, 'dirt in inventory: ' + have);",
    '    return have >= count;',
    '}',
].join('\n');
const CAPTURE_CODE = CAPTURE_FN + '\nawait gatherDirtAndWalk(bot, 3, 5);';

// One async function with a doc block that logs `marker amount`, and its call.
const markerFn = (name, marker, extraLines = []) => [
    `async function ${name}(bot, amount) {`,
    '    /**',
    `     * Logs the marker ${marker} and an amount.`,
    '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
    '     * @param {number} amount, the number to log.',
    '     * @returns {Promise<boolean>} true when done.',
    '     **/',
    ...extraLines,
    `    log(bot, '${marker} ' + amount);`,
    '    await skills.wait(bot, 10);',
    '    return true;',
    '}',
    `await ${name}(bot, 7);`,
].join('\n');

await scenarioMain({
    async main() {
        const tStart = Date.now();
        const server = await startServer({ seedHigh: 9, seedLow: 1, motd: 'Skill Capture World', commands: true });
        let agent = null;
        try {
            const started = await startRealAgent(NAME, server.port, {
                sandbox_lockdown: true, allow_insecure_coding: true, skill_learning: true,
            });
            agent = started.agent;
            note(`server and agent ready after ${Date.now() - tStart} ms`);
            const { code, realCalls } = started;
            const lk = await importProject('src/agent/library/lockdown.js');
            check(lk.isLockedDown() && Object.isFrozen(Object.prototype), 'lockdown ON after the real Agent.start');
            check(agent.skill_manager && agent.skill_manager.flags.capture === true && agent.skill_manager.flags.reuse === true,
                'the real Agent.start created the skill manager with capture and reuse on', JSON.stringify(agent.skill_manager?.flags));

            // Runs !newAction through the real command parser, with the task in the history as the
            // model would have written it.
            async function newAction(task, { replies, reviews = [], during = null }) {
                code.reset();
                code.replies.push(...replies);
                code.reviews.push(...reviews);
                agent.history.turns = [];
                await agent.history.add('e2e_player', 'please do this: ' + task);
                await agent.history.add(agent.name, `!newAction("${task}")`);
                const before = snapshotDir(SKILLS);
                const running = runCommand(agent, `!newAction("${task}")`);
                if (during) await during();
                const ret = await withTimeout(running, 30000, '!newAction ' + task);
                const after = snapshotDir(SKILLS);
                const coding = code.of('coding');
                const feedback = coding.slice(1).map((r) => String(r.turns[r.turns.length - 1]?.content));
                return { ret, before, after, coding, feedback, reviews: code.of('review') };
            }

            // ---------------------------------------------------------------- 1. capture
            const cap = await newAction(TASK, {
                replies: [codeReply(CAPTURE_CODE)],
                reviews: ['```json\n' + JSON.stringify({ achieved: true, reusable: true, description: 'Gets dirt and walks east.', reason: 'general' }) + '\n```'],
            });
            check(cap.ret.includes('dirt in inventory: 3') && cap.coding.length === 1, 'capture: the generated code ran on the bot (3 dirt arrived through /give)',
                JSON.stringify(cap.ret.slice(-300)));
            const chats = await server.chats();
            check(chats.includes('/give @s dirt 3') && chats.includes('/tp @s 5.5 64 0.5'), 'capture: the server received the /give and /tp of the code',
                JSON.stringify(chats));
            const files = listFiles(SKILLS);
            check(JSON.stringify(files) === JSON.stringify(['gatherDirtAndWalk.js', 'index.json']),
                'capture: bots/<name>/skills holds gatherDirtAndWalk.js and index.json', JSON.stringify(files));
            const source = fs.existsSync(path.join(SKILLS, 'gatherDirtAndWalk.js')) ? fs.readFileSync(path.join(SKILLS, 'gatherDirtAndWalk.js'), 'utf8') : null;
            check(source === CAPTURE_FN + '\n', 'capture: the skill file is the function exactly as written, with one final line break',
                JSON.stringify(source));
            let index = null;
            try { index = readJson(path.join(SKILLS, 'index.json')); } catch (e) { note('index.json: ' + e.message); }
            const entry = index?.skills?.gatherDirtAndWalk;
            check(index?.version === 1 && Object.keys(index?.skills || {}).length === 1, 'capture: index.json has version 1 and one skill', JSON.stringify(index));
            check(entry && JSON.stringify(Object.keys(entry)) === JSON.stringify(ENTRY_KEYS), 'capture: the index entry has exactly the keys of the spec',
                JSON.stringify(entry && Object.keys(entry)));
            check(entry?.name === 'gatherDirtAndWalk' && entry.signature === 'gatherDirtAndWalk(bot, count, step)'
                && entry.status === 'active' && entry.version === 1,
            'capture: name, signature, status active, version 1', JSON.stringify(entry));
            check(entry?.description === 'Gets the given number of dirt blocks and walks the given number of blocks east.',
                'capture: the first line of the own doc block is the description (it wins over the review)', JSON.stringify(entry?.description));
            check(entry?.source_task === TASK, 'capture: source_task is the task of the !newAction', JSON.stringify(entry?.source_task));
            check(entry?.uses === 0 && entry.failures === 0 && entry.consecutive_failures === 0 && entry.last_used === null && entry.last_error === null,
                'capture: counters 0, last_used and last_error null', JSON.stringify(entry));
            check(typeof entry?.created === 'string' && !Number.isNaN(Date.parse(entry.created)) && entry.updated === entry.created,
                'capture: created is an ISO time and updated equals it', `${entry?.created} ${entry?.updated}`);
            const hash = source === null ? null : crypto.createHash('sha256').update(source, 'utf8').digest('hex');
            check(entry?.hash === hash, 'capture: hash is the SHA-256 of the saved source', `${entry?.hash} vs ${hash}`);
            const SAVED = '\nSaved this code as the skill customSkills.gatherDirtAndWalk. You can call it in later code.';
            check(cap.ret.endsWith(SAVED), 'capture: the reply of !newAction ends with a line break and the save message', JSON.stringify(cap.ret.slice(-160)));
            check(cap.reviews.length === 1, 'capture: exactly one review request', `reviews=${cap.reviews.length}`);
            const rp = cap.reviews[0]?.prompt || '';
            check(rp.includes(`the Minecraft bot ${NAME} wrote`), 'review prompt names the bot', rp.slice(0, 120));
            check(rp.includes(`TASK: ${TASK}\n`), 'review prompt contains the task', rp.slice(0, 300));
            check(rp.includes('CODE:\n') && rp.includes(CAPTURE_CODE + '\nOUTPUT OF THE RUN:\n'), 'review prompt contains the code that ran');
            check(/OUTPUT OF THE RUN:\n[^]*dirt in inventory: 3[^]*\nCHANGE OF THE BOT:/.test(rp), 'review prompt contains the output of the run');
            check(rp.includes('CHANGE OF THE BOT: Inventory: +3 dirt. Moved 5 blocks.\n'), 'review prompt contains the state change of the real bot (+3 dirt, moved 5)',
                JSON.stringify(/CHANGE OF THE BOT: .*/.exec(rp)?.[0]));
            check(rp.includes('SKILLS SAVED SO FAR: (none)\n'), 'review prompt: no skills saved before', JSON.stringify(/SKILLS SAVED SO FAR: .*/.exec(rp)?.[0]));
            check(cap.reviews[0]?.turns.length === 0, 'review request is sent without conversation turns');
            check(agent.skill_manager.knownNames().includes('customSkills.gatherDirtAndWalk'), 'capture: the new skill is loaded into the sandbox at once',
                JSON.stringify(agent.skill_manager.knownNames()));

            // $ sequences: generated code (A7), the review prompt, the skill file, the loaded skill and
            // both prompt sections keep them as written (spec 0.1: no replacement strings)
            const PRICE_DOC = "Writes a price tag like $5, keeps $& and $' as they are.";
            const PRICE_OUT = (n) => `Price: $${n} / $& / $$ / $' / $\` end`;
            const PRICE_FN = [
                'async function writePriceTag(bot, price) {',
                '    /**',
                `     * ${PRICE_DOC}`,
                '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
                '     * @param {number} price, the price.',
                '     **/',
                "    log(bot, 'Price: $' + price + \" / $& / $$ / $' / $` end\");",
                '    await skills.wait(bot, 10);',
                '    return true;',
                '}',
            ].join('\n');
            const PRICE_CODE = PRICE_FN + '\nawait writePriceTag(bot, 5);';
            const pr = await newAction('Write a price tag of 5', { replies: [codeReply(PRICE_CODE)], reviews: [review(true, true, 'Writes a price tag.')] });
            check(pr.ret.includes('\n' + PRICE_OUT(5) + '\n'), '[A7] $ sequences in generated code survive the staging', JSON.stringify(/Price: .*/.exec(pr.ret)?.[0]));
            check((pr.reviews[0]?.prompt || '').includes(PRICE_CODE + '\nOUTPUT OF THE RUN:\n') && (pr.reviews[0]?.prompt || '').includes(PRICE_OUT(5)),
                'the review prompt holds code and output with $ sequences as written');
            const priceFile = path.join(SKILLS, 'writePriceTag.js');
            check(fs.existsSync(priceFile) && fs.readFileSync(priceFile, 'utf8') === PRICE_FN + '\n', 'the saved skill file holds the $ sequences as written');
            const pc = await newAction('Write a price tag of 7', { replies: [codeReply('await customSkills.writePriceTag(bot, 7);')] });
            check(pc.ret.includes('\n' + PRICE_OUT(7) + '\n'), 'the loaded skill writes the $ sequences as written', JSON.stringify(/Price: .*/.exec(pc.ret)?.[0]));
            check((pc.coding[0]?.prompt || '').includes('### customSkills.writePriceTag\n* ' + PRICE_DOC),
                'the coding prompt section shows a doc with $ sequences as written', JSON.stringify(/### customSkills\.writePriceTag\n.*/.exec(pc.coding[0]?.prompt || '')?.[0]));
            started.chat.reset();
            started.chat.replies.push('Sure.');
            await agent.prompter.promptConvo([{ role: 'user', content: 'e2e_player: hello' }]);
            const vp = started.chat.of('chat')[0]?.prompt || '';
            check(vp.includes('\n- writePriceTag(bot, price): ' + PRICE_DOC + '\n'), 'the conversing prompt section shows a description with $ sequences as written',
                JSON.stringify(/- writePriceTag.*/.exec(vp)?.[0]));

            // skill_command is false by default: no !useSkill, the other skill commands are there
            check(vp.includes('\nSAVED SKILLS: code you wrote earlier and can run again. To run one, use !newAction and name the skill and its values.\n'),
                'skill_command off: the conversing section has no !useSkill sentence', JSON.stringify(/SAVED SKILLS: .*/.exec(vp)?.[0]));
            const { getCommandDocs } = await importProject('src/agent/commands/index.js');
            const docs = getCommandDocs(agent);
            check(['!skills:', '!forgetSkill:', '!disableSkill:', '!enableSkill:'].every((c) => docs.includes('\n' + c)) && !docs.includes('!useSkill'),
                'skill_command off: !skills, !forgetSkill, !disableSkill, !enableSkill are in the command docs, !useSkill is not');
            const us = await runCommand(agent, '!useSkill("writePriceTag", "[1]")');
            check(us === '!useSkill is not a command.', 'skill_command off: !useSkill is refused', JSON.stringify(us));

            // ---------------------------------------------------------------- 2. no capture
            const unchanged = (r) => sameSnapshot(r.before, r.after);
            const noSave = (r) => !SAVE_TEXT.test(r.ret);
            async function noCapture(label, task, opts, expect) {
                const r = await newAction(task, opts);
                const ran = expect.marker.test(r.ret + '\n' + r.feedback.join('\n'));
                check(ran && r.reviews.length === expect.reviews && r.coding.length === (expect.coding ?? 1),
                    `no capture, ${label}: the case ran as intended`, `ran=${ran} reviews=${r.reviews.length} coding=${r.coding.length}`);
                check(unchanged(r), `no capture, ${label}: nothing was written to the skills folder`,
                    JSON.stringify(Object.keys(r.after).filter((k) => r.after[k] !== r.before[k])));
                check(noSave(r), `no capture, ${label}: the reply has no save message`, JSON.stringify(r.ret.slice(-160)));
                return r;
            }
            await noCapture('the review says not achieved', 'Log marker a',
                { replies: [codeReply(markerFn('logMarkerAlpha', 'marker-a'))], reviews: [review(false, true)] },
                { marker: /marker-a 7/, reviews: 1 });
            await noCapture('the review says not reusable', 'Log marker b',
                { replies: [codeReply(markerFn('logMarkerBravo', 'marker-b'))], reviews: [review(true, false)] },
                { marker: /marker-b 7/, reviews: 1 });
            await noCapture('the review reply is not JSON', 'Log marker c',
                { replies: [codeReply(markerFn('logMarkerCharlie', 'marker-c'))], reviews: ['I think this code is fine and should be saved.'] },
                { marker: /marker-c 7/, reviews: 1 });
            await noCapture('the review call throws', 'Log marker d',
                { replies: [codeReply(markerFn('logMarkerDelta', 'marker-d'))], reviews: [() => { throw new Error('e2e review model unavailable'); }] },
                { marker: /marker-d 7/, reviews: 1 });
            await noCapture('plain statements without a function', 'Log marker e',
                { replies: [codeReply("log(bot, 'marker-e plain');\nawait skills.wait(bot, 10);")], reviews: [review(true, true)] },
                { marker: /marker-e plain/, reviews: 0 });
            const flaky = [
                'async function flakyDirtCounter(bot, amount) {',
                '    /**',
                '     * Counts dirt and fails.',
                '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
                '     * @param {number} amount, the amount.',
                '     **/',
                '    await skills.wait(bot, 10);',
                "    throw new Error('first attempt fails ' + amount);",
                '}',
                'await flakyDirtCounter(bot, 2);',
            ].join('\n');
            const fr = await noCapture('the first attempt throws, the second works as plain statements', 'Log marker f',
                { replies: [codeReply(flaky), codeReply("log(bot, 'marker-f second attempt');\nawait skills.wait(bot, 10);")], reviews: [review(true, true)] },
                { marker: /marker-f second attempt/, reviews: 0, coding: 2 });
            check(fr.feedback[0]?.includes('first attempt fails 2'), 'no capture, first attempt throws: the error of the first attempt was fed back',
                JSON.stringify(fr.feedback[0]?.slice(0, 200)));
            await noCapture('the function contains coordinates of the world', 'Log marker g',
                {
                    replies: [codeReply(markerFn('distanceToSpot', 'marker-g', [
                        '    const target = new Vec3(120, 64, -30);',
                        "    log(bot, 'distance ' + Math.round(world.getPosition(bot).distanceTo(target)));",
                    ]))],
                    reviews: [review(true, true)],
                },
                { marker: /marker-g 7/, reviews: 1 });
            await noCapture('the function has the name of a built-in skill', 'Log marker h',
                { replies: [codeReply(markerFn('collectBlock', 'marker-h'))], reviews: [review(true, true)] },
                { marker: /marker-h 7/, reviews: 1 });

            // A4: the doc block of the function has only @ lines and the review gives no description
            const atOnly = (name, marker) => [
                `async function ${name}(bot, amount) {`,
                '    /**',
                '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
                '     * @param {number} amount, the number to log.',
                '     **/',
                `    log(bot, '${marker} ' + amount);`,
                '    await skills.wait(bot, 10);',
                '    return true;',
                '}',
                `await ${name}(bot, 7);`,
            ].join('\n');
            await noCapture('[A4] the doc block has only @ lines and the review gives no description', 'Log marker j',
                { replies: [codeReply(atOnly('logMarkerJuliet', 'marker-j'))], reviews: [review(true, true, '')] },
                { marker: /marker-j 7/, reviews: 1 });
            // Windows: gatherdirtandwalk.js and gatherDirtAndWalk.js are the same file (amendment K3)
            await noCapture('the name differs from a saved skill only in upper and lower case', 'Log marker l',
                { replies: [codeReply(markerFn('gatherdirtandwalk', 'marker-l'))], reviews: [review(true, true)] },
                { marker: /marker-l 7/, reviews: 1 });
            // A1: `Function (` with a space is a forbidden token, also inside a string (the sandbox
            // itself refuses any eval( text at staging, so eval cannot be used for this case)
            await noCapture('[A1] the function has "Function (" with a space in a string', 'Log marker n',
                { replies: [codeReply(markerFn('functionWithSpace', 'marker-n', ["    log(bot, 'never new Function (\"a\") here');"]))], reviews: [review(true, true)] },
                { marker: /marker-n 7/, reviews: 1 });
            // Windows: nul.js is a device, not a file (amendment K2)
            await noCapture('the function name is a Windows device name (nul)', 'Log marker m',
                { replies: [codeReply(markerFn('nul', 'marker-m'))], reviews: [review(true, true)] },
                { marker: /marker-m 7/, reviews: 1 });

            // interrupted: a timer calls the real agent.requestInterrupt while the code waits
            const waitFn = [
                'async function waitThenReport(bot, ms) {',
                '    /**',
                '     * Waits and reports.',
                '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
                '     * @param {number} ms, how long to wait.',
                '     **/',
                "    log(bot, 'marker-i started');",
                '    await skills.wait(bot, ms);',
                "    log(bot, 'marker-i waited');",
                '    return true;',
                '}',
                'await waitThenReport(bot, 1500);',
            ].join('\n');
            let interruptedAt = null;
            const ir = await newAction('Wait and report', {
                replies: [codeReply(waitFn)],
                reviews: [review(true, true)],
                during: async () => {
                    const t0 = Date.now();
                    while (!String(agent.bot.output).includes('marker-i started') && Date.now() - t0 < 15000) await sleep(20);
                    interruptedAt = Date.now() - t0;
                    agent.requestInterrupt();
                },
            });
            note(`interrupt requested ${interruptedAt} ms after the command started`);
            check(agent.coder.last_run?.interrupted === true && ir.coding.length === 1, 'no capture, interrupted: the run ended on the success path with interrupted true',
                JSON.stringify(agent.coder.last_run && { interrupted: agent.coder.last_run.interrupted }));
            check(ir.reviews.length === 0, 'no capture, interrupted: no review request', `reviews=${ir.reviews.length}`);
            check(unchanged(ir), 'no capture, interrupted: nothing was written to the skills folder');
            check(noSave(ir), 'no capture, interrupted: the reply has no save message', JSON.stringify(ir.ret.slice(-160)));

            // A4, the saving side: a doc block with only @ lines takes the description of the review
            const a4 = await newAction('Log marker k', {
                replies: [codeReply(atOnly('logMarkerKilo', 'marker-k'))],
                reviews: [review(true, true, 'Logs the kilo marker and an amount.')],
            });
            const a4Entry = fs.existsSync(path.join(SKILLS, 'index.json')) ? readJson(path.join(SKILLS, 'index.json')).skills?.logMarkerKilo : undefined;
            check(a4.ret.includes('marker-k 7') && a4.ret.endsWith('\nSaved this code as the skill customSkills.logMarkerKilo. You can call it in later code.'),
                '[A4] a function whose doc block has only @ lines is saved when the review gives a description', JSON.stringify(a4.ret.slice(-120)));
            check(a4Entry?.description === 'Logs the kilo marker and an amount.',
                '[A4] its index description is the description of the review, not the @ line', JSON.stringify(a4Entry?.description));

            // a function without a doc block gets the block of the spec, built from the review
            // description (line break and */ in it made harmless, K1 and amendment), and loads
            const NODOC_FN = [
                'async function writeNoDocCount(bot, count) {',
                "    log(bot, 'nodoc ' + count);",
                '    await skills.wait(bot, 10);',
                '    return true;',
                '}',
            ].join('\n');
            const nd = await newAction('Write nodoc three', {
                replies: [codeReply(NODOC_FN + '\nawait writeNoDocCount(bot, 3);')],
                reviews: [review(true, true, 'Writes nodoc */ and a count.\nSecond line.')],
            });
            const ndFile = path.join(SKILLS, 'writeNoDocCount.js');
            const ndSource = fs.existsSync(ndFile) ? fs.readFileSync(ndFile, 'utf8') : '';
            const BLOCK = [
                '    /**',
                '     * Writes nodoc * / and a count. Second line.',
                '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
                '     * @param {*} count',
                '     * @returns {Promise<boolean>} true if the skill succeeded, false otherwise.',
                '     * @example',
                '     * await customSkills.writeNoDocCount(bot, count);',
                '     **/',
            ].join('\n');
            check(nd.ret.endsWith('\nSaved this code as the skill customSkills.writeNoDocCount. You can call it in later code.')
                && ndSource.startsWith('async function writeNoDocCount(bot, count) {\n' + BLOCK + '\n') && ndSource.includes("    log(bot, 'nodoc ' + count);\n"),
            'a function without a doc block is saved with the doc block of the spec built from the review description', JSON.stringify(ndSource));
            const ndEntry = readJson(path.join(SKILLS, 'index.json')).skills?.writeNoDocCount;
            check(ndEntry?.description === 'Writes nodoc */ and a count. Second line.', 'its index description is the review description (line break made a space)',
                JSON.stringify(ndEntry?.description));
            const ndUse = await newAction('Use nodoc', { replies: [codeReply('await customSkills.writeNoDocCount(bot, 4);')] });
            check(ndUse.ret.includes('nodoc 4'), 'the skill with the generated doc block loads and runs', JSON.stringify(ndUse.ret.slice(-100)));

            // A1: names that only contain a forbidden token are fine
            const RETRIEVAL_FN = [
                'async function collectRetrieval(bot, n) {',
                '    /**',
                '     * Doubles a number with a helper named retrieval and writes it.',
                '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
                '     * @param {number} n, the number.',
                '     **/',
                '    async function retrieval(count) {',
                '        await skills.wait(bot, 10);',
                '        return count * 2;',
                '    }',
                '    const item = { constructorName: "box" };',
                "    log(bot, 'retrieval ' + (await retrieval(n)) + ' ' + item.constructorName);",
                '    return true;',
                '}',
            ].join('\n');
            const rt = await newAction('Retrieval of four', { replies: [codeReply(RETRIEVAL_FN + '\nawait collectRetrieval(bot, 4);')], reviews: [review(true, true)] });
            check(rt.ret.includes('retrieval 8 box') && rt.ret.endsWith('\nSaved this code as the skill customSkills.collectRetrieval. You can call it in later code.'),
                '[A1] a function with retrieval( and .constructorName is saved (no forbidden token)', JSON.stringify(rt.ret.slice(-140)));

            // B3: a skill must not use names from outside
            const SIZE_ABOVE = [
                'const SIZE = 3;',
                'async function buildRowOfSize(bot, blockName) {',
                '    /**',
                '     * Writes the plan for a row of SIZE blocks.',
                '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
                '     * @param {string} blockName, the block to use.',
                '     **/',
                "    log(bot, 'row of ' + SIZE + ' ' + blockName);",
                '    await skills.wait(bot, 10);',
                '    return true;',
                '}',
                "await buildRowOfSize(bot, 'stone');",
            ].join('\n');
            await noCapture('[B3] the function reads the constant SIZE declared above it', 'Plan a row of three stone',
                { replies: [codeReply(SIZE_ABOVE)], reviews: [review(true, true, 'Plans a row.')] },
                { marker: /row of 3 stone/, reviews: 1 });
            check(!fs.existsSync(path.join(SKILLS, 'buildRowOfSize.js')), '[B3] no file buildRowOfSize.js was written');
            // (a name declared nowhere is refused by the lint of the coder before the code runs;
            // here the name is declared by the code around the function, not by the function)
            await noCapture('[B3] the function writes to the variable lastAmount declared above it', 'Log marker p',
                { replies: [codeReply('let lastAmount = 0;\n' + markerFn('rememberLastAmount', 'marker-p', ['    lastAmount = amount;']))], reviews: [review(true, true)] },
                { marker: /marker-p 7/, reviews: 1 });
            // window passes the lint of the coder (browser globals) and reads as undefined in the sandbox
            await noCapture('[B3] the function reads the browser global window', 'Log marker q',
                { replies: [codeReply(markerFn('reportWindowMissing', 'marker-q', ["    log(bot, 'no window ' + (window === undefined));"]))], reviews: [review(true, true)] },
                { marker: /no window true[^]*marker-q 7/, reviews: 1 });
            const SIZE_PARAM = [
                'async function buildRowWithSize(bot, blockName, size) {',
                '    /**',
                '     * Writes the plan for a row of blocks of the given size.',
                '     * @param {MinecraftBot} bot, reference to the minecraft bot.',
                '     * @param {string} blockName, the block to use.',
                '     * @param {number} size, the length of the row.',
                '     **/',
                '    const up = new Vec3(0, 1, 0);',
                '    const plan = { block: blockName, size: Math.max(1, size), up: up.y };',
                "    console.log('row plan ' + JSON.stringify(plan));",
                '    await skills.wait(bot, 10);',
                '    return Number.isInteger(plan.size) && Array.isArray([plan]);',
                '}',
                "await buildRowWithSize(bot, 'stone', 3);",
            ].join('\n');
            const sp = await newAction('Plan a row of three stone with a parameter', { replies: [codeReply(SIZE_PARAM)], reviews: [review(true, true, 'Plans a row.')] });
            check(sp.ret.includes('row plan {"block":"stone","size":3,"up":1}')
                && sp.ret.endsWith('\nSaved this code as the skill customSkills.buildRowWithSize. You can call it in later code.')
                && fs.existsSync(path.join(SKILLS, 'buildRowWithSize.js')),
            '[B3] the same function with size as a parameter (and Vec3, Math, JSON, console, Number, Array) is saved', JSON.stringify(sp.ret.slice(-140)));
            const spUse = await newAction('Plan a row of two dirt', { replies: [codeReply("await customSkills.buildRowWithSize(bot, 'dirt', 2);")] });
            check(spUse.ret.includes('row plan {"block":"dirt","size":2,"up":1}'), '[B3] the saved skill runs with the value it gets', JSON.stringify(spUse.ret.slice(-120)));

            // B4: code that cannot be prepared for the sandbox is given back to the model
            const PREP = 'Error: Code could not be prepared for execution:\n';
            for (const [label, bad, errRe] of [
                ['a syntax error', "log(bot, 'broken' ;", /SyntaxError/],
                ['eval(', "const two = eval('1 + 1');\nlog(bot, 'two ' + two);", /eval/i],
            ]) {
                const b4 = await newAction('Stage code with ' + label.replace('(', ''), {
                    replies: [codeReply(bad), codeReply("log(bot, 'b4 good attempt');\nawait skills.wait(bot, 10);")],
                });
                const fb = (b4.coding[1]?.turns ?? []).map((t) => String(t.content)).find((c) => c.startsWith(PREP)) ?? '';
                check(b4.coding.length === 2 && b4.ret.includes('b4 good attempt') && !b4.ret.startsWith('Error generating code'),
                    `[B4] code with ${label}, then a good attempt: !newAction ends successfully after two model calls`,
                    `calls=${b4.coding.length} ${JSON.stringify(b4.ret.slice(0, 160))}`);
                check(fb.endsWith('\nPlease try again.') && errRe.test(fb),
                    `[B4] code with ${label}: the second request to the model contains the feedback that the code could not be prepared`,
                    JSON.stringify(fb.slice(0, 220) || b4.feedback[0]?.slice(0, 220)));
            }

            check(realCalls.length === 0, 'no request reached a real model class', JSON.stringify(realCalls));
            note(`skills folder at the end: ${JSON.stringify(listFiles(SKILLS))}`);
        } finally {
            await stopRealAgent(agent);
            await server.stop();
        }
    },
});
exitSoon();
