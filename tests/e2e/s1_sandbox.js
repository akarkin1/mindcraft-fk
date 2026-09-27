// S1 sandbox: the coder cases of v0.1.4.2 with the SES lockdown ON. A real mineflayer bot on
// the simulated server, the real Coder, canned model replies.
import fs from 'node:fs';
import {
    scenarioMain, check, note, startServer, setupSettings, lockdown, connectBot, waitSpawn,
    quitBot, importProject, withTimeout, sleep, errText,
} from './helpers.js';

const NAME = 'e2e_coder';
const FENCE = '`'.repeat(3);
const reply = (code) => 'Here is the code.\n' + FENCE + 'javascript\n' + code + '\n' + FENCE;
const CASE1 = 'const pos = world.getPosition(bot);\nlog(bot, "pos " + Math.round(pos.y));\nawait skills.wait(bot, 50);';

await scenarioMain({
    async main() {
        const server = await startServer({ seedHigh: 1, seedLow: 2, motd: 'Sandbox World' });
        let bot = null;
        try {
            const settings = await setupSettings(NAME, server.port, { sandbox_lockdown: true, allow_insecure_coding: true });
            await importProject('src/agent/agent.js'); // whole module graph, as the agent process has it
            const { Coder } = await importProject('src/agent/coder.js');
            const { ActionManager } = await importProject('src/agent/action_manager.js');
            const { SkillLibrary } = await importProject('src/agent/library/skill_library.js');
            const lk = await lockdown(settings);
            check(lk.ret === true && lk.locked === true && Object.isFrozen(Object.prototype), 'lockdown ON: initSandbox true, Object.prototype frozen',
                JSON.stringify(lk));
            bot = await connectBot(NAME);
            await waitSpawn(bot);
            check(bot.game.dimension === 'overworld' && bot.entity.position.y === 64, 'bot logged in and spawned', `${bot.game.dimension} ${bot.entity.position}`);

            let queue = [];
            let calls = [];
            const skillLib = new SkillLibrary(null, null);
            await skillLib.initSkillLibrary();
            const history = { getHistory: () => [{ role: 'user', content: 'e2e_tester: run the e2e code' }] };
            const agent = {
                name: NAME,
                bot,
                history,
                prompter: {
                    skill_libary: skillLib,
                    async promptCoding(messages) {
                        calls.push(messages);
                        const next = queue.shift();
                        return next === undefined ? 'e2e stub: no more canned replies' : next;
                    },
                },
                clearBotLogs() { bot.output = ''; bot.interrupt_code = false; },
                requestInterrupt() { bot.interrupt_code = true; },
            };
            agent.actions = new ActionManager(agent);
            bot.modes = { pause() {}, unpause() {}, isOn: () => false };
            bot.output = '';
            bot.interrupt_code = false;
            const coder = new Coder(agent);
            agent.coder = coder;
            const tw = Date.now();
            while (!(coder.code_template && coder.code_lint_template)) {
                if (Date.now() - tw > 10000) throw new Error('coder templates not loaded within 10 s');
                await sleep(20);
            }

            async function runCase(replies) {
                queue = replies.slice();
                calls = [];
                bot.output = '';
                bot.interrupt_code = false;
                let ret = '';
                let threw = null;
                try {
                    ret = String(await withTimeout(coder.generateCode(history), 20000, 'generateCode'));
                } catch (e) { threw = e; }
                const feedback = calls.slice(1).map((m) => String(m[m.length - 1]?.content));
                return { ret, threw, calls: calls.length, feedback };
            }
            const finished = (r) => !r.threw && r.ret.includes('Code finished.');

            let r = await runCase([reply(CASE1)]);
            check(finished(r) && r.ret.includes('pos 64') && r.calls === 1, 'harmless code runs', `calls=${r.calls} ${r.threw ? errText(r.threw) : ''}`);

            r = await runCase([reply('await skills.flyToTheMoon(bot);'), reply(CASE1)]);
            const rejected = r.feedback[0]?.includes('These functions do not exist') && r.feedback[0]?.includes('skills.flyToTheMoon');
            check(rejected && finished(r) && r.calls === 2, 'unknown function is rejected, the second attempt succeeds', `calls=${r.calls} rejected=${rejected}`);

            const escapes = [
                ['escape via [].constructor.constructor', 'const p = [].constructor.constructor("return process")();\nlog(bot, "escaped: " + typeof p.exit);\nawait skills.wait(bot, 10);', /escaped: function/],
                ['escape via log.constructor', 'const lg = log;\nconst F = lg.constructor;\nconst p = F("return process")();\nlog(bot, "escaped2: " + typeof p);\nawait skills.wait(bot, 10);', /escaped2: object/],
                ['escape via bot.chat.constructor', 'const F = bot.chat.constructor;\nconst p = F("return typeof process")();\nlog(bot, "escaped3: " + p);\nawait skills.wait(bot, 10);', /escaped3: object/],
            ];
            for (const [label, code, reachedRe] of escapes) {
                r = await runCase([reply(code), reply(CASE1), reply(CASE1), reply(CASE1)]);
                const all = r.ret + '\n' + r.feedback.join('\n');
                const reached = reachedRe.test(all);
                check(!reached && !r.threw && r.ret.length > 0, `${label} does not reach the host process`, `reached=${reached} calls=${r.calls}`);
            }

            r = await runCase([reply('await skills.wait(bot, 10);\nthrow new Error("boom 100%done");'), reply(CASE1)]);
            const fed = r.feedback[0]?.includes('boom 100%done');
            check(fed && finished(r) && r.calls === 2, 'code that throws feeds the error text back', `calls=${r.calls} fed=${fed}`);
            check(typeof process.exit === 'function', 'host process object intact after the escapes');
            note(`staged code files: ${fs.readdirSync(`./bots/${NAME}/action-code/`).length}`);
        } finally {
            await quitBot(bot);
            await server.stop();
        }
    },
});
