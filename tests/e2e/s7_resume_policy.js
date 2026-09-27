// S7 resume_policy: drives the real Agent.prototype._setupEventHandlers, which calls the real
// Agent.prototype._resumeGoal, without the MindServer. The agent is built with
// Object.create(Agent.prototype); the real SelfPrompter is used and agent.handleMessage is
// stubbed so that a resumed self-prompt loop ends after its first round. Every case is a new
// agent object, as after a restart; the resume guard file on disk carries over between them.
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import {
    scenarioMain, check, note, setupSettings, importProject, sleep,
} from './helpers.js';

const NAME = 'e2e_resume';
const NAME_DEFAULTS = 'e2e_resume2';
const ACTIVE = 1;
const PAUSED = 2;
const STOPPED = 0;

await scenarioMain({
    async main() {
        const settings = await setupSettings(NAME, 0, { world_memory: false });
        const { Agent } = await importProject('src/agent/agent.js');
        const { History } = await importProject('src/agent/history.js');
        const { MemoryBank } = await importProject('src/agent/memory_bank.js');
        const { SelfPrompter } = await importProject('src/agent/self_prompter.js');
        check(typeof Agent.prototype._resumeGoal === 'function' && typeof Agent.prototype._setupEventHandlers === 'function',
            'Agent.prototype has _resumeGoal and _setupEventHandlers');

        function makeAgent(name, isRestart) {
            const agent = Object.create(Agent.prototype);
            agent.name = name;
            agent.is_restart = isRestart;
            agent.last_sender = null;
            agent._disconnectHandled = false;
            agent.chats = [];
            agent.prompted = [];
            agent.openChat = async (message) => { agent.chats.push(message); };
            agent.handleMessage = async (source, message) => {
                agent.prompted.push({ source, message });
                agent.self_prompter.interrupt = true; // the loop ends after this round
                return true;
            };
            agent.history = new History(agent);
            agent.memory_bank = new MemoryBank();
            agent.self_prompter = new SelfPrompter(agent);
            agent.self_prompter.cooldown = 0;
            agent.task = { taskStartTime: Date.now() };
            agent.actions = { cancelResume() {}, async stop() {} };
            const bot = new EventEmitter();
            bot.autoEat = {};
            bot.entity = { position: { x: 0, y: 64, z: 0 } };
            bot.game = { dimension: 'overworld' };
            agent.bot = bot;
            return agent;
        }

        const saveData = (goal, state = ACTIVE) => ({
            memory: '', turns: [], self_prompting_state: state, self_prompt: goal, taskStart: 1, last_sender: null,
        });

        async function restart(name, isRestart, data) {
            const agent = makeAgent(name, isRestart);
            await agent._setupEventHandlers(data, null);
            for (let i = 0; i < 100 && agent.self_prompter.loop_active; i++) await sleep(20);
            const system = agent.history.turns.filter((t) => t.role === 'system').map((t) => t.content);
            return { agent, system, state: agent.self_prompter.state, prompted: agent.prompted, chats: agent.chats };
        }
        const notResumed = (goal) => `Your previous goal was not resumed: "${goal}". Start it again with !goal only if a player asks for it.`;
        const guardFile = `./bots/${NAME}/resume_guard.json`;

        // after_crash, first start
        settings.resume_goal = 'after_crash';
        settings.goal_resume_limit = 3;
        let r = await restart(NAME, false, saveData('build a house'));
        check(r.state === STOPPED && r.prompted.length === 0, 'after_crash, is_restart false: goal not resumed, self prompter stopped',
            `state=${r.state} prompts=${r.prompted.length}`);
        check(r.system.includes(notResumed('build a house')), 'after_crash, is_restart false: system turn of the spec', JSON.stringify(r.system));
        check(r.chats.every((c) => !c.includes('build a house')), 'after_crash, is_restart false: nothing about the goal in the chat', JSON.stringify(r.chats));

        // after_crash, automatic restart
        r = await restart(NAME, true, saveData('build a house'));
        check(r.state === ACTIVE && r.prompted.length === 1 && r.prompted[0].message.includes("goal: 'build a house'"),
            'after_crash, is_restart true: goal resumed (self-prompt loop ran)', `state=${r.state} prompts=${JSON.stringify(r.prompted)}`);
        check(!r.system.some((s) => s.includes('was not resumed')), 'after_crash, is_restart true: no not-resumed turn');
        let guard = fs.existsSync(guardFile) ? JSON.parse(fs.readFileSync(guardFile, 'utf8')) : null;
        check(guard && guard.prompt === 'build a house' && guard.resumes?.length === 1, 'the resume is recorded in bots/<name>/resume_guard.json',
            JSON.stringify(guard));

        // never
        settings.resume_goal = 'never';
        r = await restart(NAME, true, saveData('build a tower'));
        check(r.state === STOPPED && r.prompted.length === 0 && r.system.includes(notResumed('build a tower')),
            'never: goal not resumed, system turn of the spec', `state=${r.state} ${JSON.stringify(r.system)}`);

        // [M6] a paused goal falls under the policy as well
        r = await restart(NAME, true, saveData('collect wool', PAUSED));
        check(r.state === STOPPED && r.system.includes(notResumed('collect wool')),
            'never: a paused goal is not resumed either and the self prompter stays stopped', `state=${r.state} ${JSON.stringify(r.system)}`);

        // goal_resume_limit 2: the third resume within the window is blocked
        settings.resume_goal = 'after_crash';
        settings.goal_resume_limit = 2;
        const goal = 'mine diamonds';
        const runs = [];
        for (let i = 0; i < 3; i++) runs.push(await restart(NAME, true, saveData(goal)));
        check(runs[0].state === ACTIVE && runs[1].state === ACTIVE, 'limit 2: first and second resume allowed',
            `states ${runs.map((x) => x.state).join(',')}`);
        const third = runs[2];
        const stoppedTurn = `Your goal "${goal}" was stopped because you restarted 2 times while working on it. Do not start it again by yourself.`;
        const stoppedChat = `I stopped my goal "${goal}" because I restarted 2 times while working on it.`;
        check(third.state === STOPPED && third.prompted.length === 0, 'limit 2: third resume blocked', `state=${third.state}`);
        check(third.system.includes(stoppedTurn), 'limit 2: system turn of the spec', JSON.stringify(third.system));
        check(third.chats.includes(stoppedChat), 'limit 2: chat text of the spec sent with openChat', JSON.stringify(third.chats));
        guard = JSON.parse(fs.readFileSync(guardFile, 'utf8'));
        note(`guard file after the limit case: ${JSON.stringify(guard)}`);

        // flag rule: resume_goal and goal_resume_limit absent behave as v0.1.4.2 (always resume, no guard file)
        delete settings.resume_goal;
        delete settings.goal_resume_limit;
        r = await restart(NAME_DEFAULTS, false, saveData('plant wheat'));
        check(r.state === ACTIVE && r.prompted.length === 1, 'settings absent: goal resumed on a first start as in v0.1.4.2', `state=${r.state}`);
        check(!fs.existsSync(`./bots/${NAME_DEFAULTS}/resume_guard.json`), 'settings absent: no resume_guard.json written');
        check(r.chats.length === 1 && r.chats[0] === `Hello world! I am ${NAME_DEFAULTS}`,
            'rest of _setupEventHandlers unchanged: greeting sent', JSON.stringify(r.chats));
    },
});
