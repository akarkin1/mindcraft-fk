import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import { initSandbox, makeCompartment } from './library/lockdown.js';
import { WorldMemory } from './world/world_memory.js';
import { shouldResumeGoal, ResumeGuard } from './world/resume_policy.js';
import { SkillManager, skillFlags } from './skills/skill_manager.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import { setUsageSink } from './cost/usage_context.js';
import { CostMeter } from './cost/cost_meter.js';
import { AreaStore } from './areas/area_store.js';
import { installAreaGuard } from './areas/area_guard.js';
import { RuleStore } from './rules/rule_store.js';
import { autoEatOptions } from './packs/home/index.js';

// A number setting of v0.1.4.6: a value that is not finite or is below 0 counts as the default.
export function numberSetting(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

// v0.1.4.6, G2: a command result for the history, cut to max characters (0 for no limit). The first
// 70 and the last 20 percent of max are kept, with a line between them that says how much is left out.
export function shortenCommandResult(text, max) {
    if (typeof text !== 'string' || !(max > 0) || text.length <= max)
        return text;
    const head = text.slice(0, Math.floor(max * 0.7));
    const tail = text.slice(text.length - Math.floor(max * 0.2));
    return `${head}\n... (shortened, ${text.length - head.length - tail.length} characters left out) ...\n${tail}`;
}

// v0.1.4.6, G1: prints the cost of the session and saves it, right before the process exits. Never throws.
function reportCostAtExit(meter) {
    if (!meter)
        return;
    try {
        console.log(meter.reportLine());
    } catch (error) {
        console.warn('Could not print the cost of the session:', error);
    }
    try {
        meter.flush();
    } catch (error) {
        console.warn('Could not save the cost of the session:', error);
    }
}

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0, is_restart=false) {
        // lock down the realm before any component or the bot is created
        initSandbox(settings);
        this.last_sender = null;
        this.last_order = null; // the command that a player ordered and that still runs (v0.1.4.6, G3)
        this.count_id = count_id;
        this.is_restart = is_restart;
        this._disconnectHandled = false;

        // Initialize components
        this.actions = new ActionManager(this);
        // check the name before the prompter creates the bot folder
        const profile_name = typeof settings.profile?.name === 'string' ? settings.profile.name.trim() : '';
        const profileNameCheck = validateNameFormat(profile_name);
        if (!profileNameCheck.success) {
            log(profile_name, profileNameCheck.msg);
            process.exit(1);
            return;
        }
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);
        
        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }
        if (settings.cost_meter !== false) {
            try {
                // v0.1.4.6, G1: every call to a model is counted
                this.cost_meter = new CostMeter({
                    settings,
                    filePath: `./bots/${this.name}/usage.json`,
                    say: (text) => {
                        if (this.bot)
                            this.openChat(text).catch((error) => console.warn('Could not tell the cost:', error));
                    },
                    log: (text) => console.log(text),
                });
                setUsageSink((report) => this.cost_meter?.record(report));
                this._startCostTimers();
            } catch (error) {
                this.cost_meter = undefined;
                console.warn('Could not start the cost meter:', error);
            }
        }
        
        if (settings.world_memory)
            this.history = new History(this, { defer_storage: true }); // storage is set when the world is known
        else
            this.history = new History(this);
        this.coder = new Coder(this);
        const skill_flags = skillFlags(settings);
        if (skill_flags.capture || skill_flags.reuse || skill_flags.command) {
            try {
                initSandbox(settings); // saved skills are compiled in the sandbox
                this.skill_manager = new SkillManager({
                    name: this.name,
                    settings,
                    prompter: this.prompter,
                    makeCompartment,
                    endowments: { skills, world, Vec3, log: skills.log },
                    getInventoryCounts: world.getInventoryCounts,
                    builtinNames: Object.keys(skills).concat(Object.keys(world)),
                    reviewTemplate: this.prompter.profile.skill_review,
                    allowReview: () => this._costAllows('skill_review'),
                });
                await this.skill_manager.init();
            } catch (error) {
                this.skill_manager = undefined;
                console.warn('Could not start skill learning:', error);
            }
        }
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // load mem first before doing task
        // (with world memory it is loaded after the spawn, when the world is known)
        let save_data = null;
        if (load_mem && !settings.world_memory) {
            save_data = this.history.load();
        }
        else if (!settings.world_memory) {
            // keep the previous memory in the archive instead of overwriting it
            this._archiveMemory();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        if (!settings.world_memory)
            this.blocked_actions.push('!forgetPlace', '!nameWorld');
        // the skill commands need a running skill manager
        const skill_commands = this.skill_manager ? this.skill_manager.flags : {};
        if (!skill_commands.capture && !skill_commands.reuse)
            this.blocked_actions.push('!skills', '!forgetSkill', '!disableSkill', '!enableSkill');
        if (!skill_commands.command)
            this.blocked_actions.push('!useSkill');
        // the parts of v0.1.4.6: the commands of a part that is off are hidden
        if (settings.player_rules) {
            try {
                this.rule_store = new RuleStore(`./bots/${this.name}/rules.json`, { max: numberSetting(settings.rules_max, 20) });
                this.rule_store.load();
            } catch (error) {
                this.rule_store = undefined;
                console.warn('Could not load the rules of the players:', error);
            }
        }
        const areas_on = Boolean(settings.protected_areas) && Boolean(settings.world_memory); // areas belong to a world
        if (settings.protected_areas && !settings.world_memory)
            console.warn('protected_areas needs world_memory, so the protected areas stay off.');
        if (!this.cost_meter)
            this.blocked_actions.push('!cost');
        if (!this.rule_store)
            this.blocked_actions.push('!rememberRule', '!forgetRule', '!rules');
        if (!areas_on)
            this.blocked_actions.push('!rememberArea', '!setArea', '!forgetArea', '!areas', '!allowChanges');
        if (!settings.home_pack)
            this.blocked_actions.push('!goToShelter', '!eat');
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        if (settings.world_memory) {
            try {
                this.world_memory = new WorldMemory({ name: this.name, settings, history: this.history, memoryBank: this.memory_bank });
                this.world_memory.attach(this.bot);
            } catch (error) {
                console.warn('Could not start world memory:', error);
            }
        }
        if (areas_on)
            this._startAreaGuard(); // once, on the bot; it reads the areas of the current world
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            const { type, msg } = handleDisconnection(this.name, reason);
     
            console.log(`Agent process ends with exit code 1: ${msg}`);
            reportCostAtExit(this.cost_meter);
            process.exit(1);
        };
        
        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                 onDisconnect('Error', err);
            } else {
                 log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in!');
            serverProxy.login();
            
            // Set skin for profile, requires Fabric Tailor. (https://modrinth.com/mod/fabrictailor)
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });
		const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            process.exit(1);
        }, spawnTimeoutDuration * 1000);
        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));
                
                console.log(`${this.name} spawned.`);
                this.clearBotLogs();
                if (settings.world_memory) {
                    save_data = await this._resolveWorld(load_mem);
                }
                if (areas_on)
                    this._areaStore(); // the protected areas of this world
              
                this._setupEventHandlers(save_data, init_message);
                this.startEvents();
              
                if (!load_mem) {
                    if (settings.task) {
                        this.task.initBotTask();
                        this.task.setAgentGoal();
                    }
                } else {
                    // set the goal without initializing the rest of the task
                    if (settings.task) {
                        this.task.setAgentGoal();
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

            } catch (error) {
                console.error('Error in spawn event:', error);
                process.exit(0);
            }
        });
    }

    _archiveMemory() {
        // never throws: on failure the memory file is overwritten as before
        try {
            const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
            const archived = this.history.archiveExisting(`./bots/_archive/${this.name}-${stamp}`);
            if (archived)
                console.log('Previous memory archived to', archived);
        } catch (error) {
            console.warn('Could not archive the previous memory:', error);
        }
    }

    _startCostTimers() {
        // v0.1.4.6, G1: the budget is checked every minute, the cost is printed every cost_report_minutes
        const meter = this.cost_meter;
        if (!meter)
            return;
        const every = (minutes, fn) => setInterval(() => {
            try {
                fn();
            } catch (error) {
                console.warn('Cost meter:', error);
            }
        }, Math.min(Math.max(minutes * 60 * 1000, 1000), 2 ** 31 - 1)).unref();
        every(1, () => meter.check());
        const report_minutes = numberSetting(settings.cost_report_minutes, 10);
        if (report_minutes > 0)
            every(report_minutes, () => console.log(meter.reportLine()));
    }

    _costAllows(what) {
        // false only while the cost meter is in the state saving (v0.1.4.6, G1). Never throws.
        if (!this.cost_meter)
            return true;
        try {
            return this.cost_meter.allows(what) !== false;
        } catch (error) {
            console.warn('Could not ask the cost meter:', error);
            return true;
        }
    }

    _startAreaGuard() {
        // v0.1.4.6, G5: installed once; the guard asks for the store of the current world. Never throws.
        if (!settings.protected_areas || !settings.world_memory)
            return;
        try {
            // the full guard with permit and revoke stays here; bot.areaGuard has no permits (Amendment 2, F2)
            this.area_guard = installAreaGuard(this.bot, {
                store: () => this._areaStore(),
                getDimension: () => this.bot.game?.dimension,
                log: (text) => console.log(text),
            });
        } catch (error) {
            console.warn('Could not protect the saved areas:', error);
        }
    }

    _areaStore() {
        // The area store of the current world, created when the world is known and again when it
        // changes. null before that or when the file cannot be used. Never throws.
        if (!settings.protected_areas || !settings.world_memory)
            return null;
        const dir = this.world_memory?.worldDir ?? null;
        if (dir !== this._area_dir) {
            this._area_dir = dir;
            this.area_store = undefined;
            if (dir) {
                try {
                    const store = new AreaStore(`${dir}/areas.json`);
                    store.load();
                    this.area_store = store;
                } catch (error) {
                    console.warn('Could not open the protected areas of this world:', error);
                }
            }
        }
        return this.area_store ?? null;
    }

    homeContext() {
        // what the modules of the home pack get (spec v0.1.4.6, section 5)
        return {
            areas: this.area_store ?? null,
            places: this.memory_bank,
            settings,
            log: (text) => skills.log(this.bot, text),
            now: () => Date.now(),
            skills,
            world,
        };
    }

    async _resolveWorld(load_mem) {
        // world memory: find out which world this is and load its memory. Never throws.
        let save_data = null;
        try {
            const result = await this.world_memory.resolve({ loadMemory: load_mem, getDimension: () => this.bot.game.dimension });
            save_data = result.saveData ?? null;
            if (result.note !== null && result.note !== undefined)
                await this.history.add('system', result.note);
        } catch (error) {
            console.warn('World memory failed:', error);
            try {
                if (!this.history.storage_ready) {
                    // fall back to the memory file of the bot folder, as without world memory
                    this.history.setStorageDir(`./bots/${this.name}`);
                    if (load_mem)
                        save_data = this.history.load();
                    else
                        this._archiveMemory();
                }
            } catch (fallback_error) {
                console.warn('Could not use the memory of the bot folder:', fallback_error);
            }
        }
        if (typeof save_data?.taskStart === 'number')
            this.task.taskStartTime = save_data.taskStart;
        return save_data;
    }

    async _resumeGoal(save_data) {
        // resume policy and restart guard for a goal loaded from memory
        const goal = save_data.self_prompt;
        let history_message = null;
        let chat_message = null;
        try {
            if (!shouldResumeGoal(settings.resume_goal, this.is_restart)) {
                history_message = `Your previous goal was not resumed: "${goal}". Start it again with !goal only if a player asks for it.`;
            }
            else {
                const guard = new ResumeGuard(`./bots/${this.name}/resume_guard.json`, { limit: settings.goal_resume_limit ?? 0 });
                guard.load();
                const { allowed, count } = guard.check(goal);
                if (allowed) {
                    guard.record(goal);
                }
                else {
                    history_message = `Your goal "${goal}" was stopped because you restarted ${count} times while working on it. Do not start it again by yourself.`;
                    chat_message = `I stopped my goal "${goal}" because I restarted ${count} times while working on it.`;
                }
            }
        } catch (error) {
            console.warn('Could not apply the goal resume policy, resuming the goal:', error);
            history_message = null;
            chat_message = null;
        }
        if (history_message === null) {
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
            return;
        }
        console.log(history_message);
        try {
            await this.history.add('system', history_message);
            if (chat_message)
                await this.openChat(chat_message);
        } catch (error) {
            console.warn('Could not report the goal that was not resumed:', error);
        }
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

		this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);
        
        this.bot.on('chat', (username, message) => {
            if (serverProxy.getNumOtherAgents() > 0) return;
            // only respond to open chat messages when there are no other agents
            respondFunc(username, message);
        });

        // Set up auto-eat (with the home pack the defaults of the plugin are kept, v0.1.4.6 H4)
        let eat_options = null;
        if (settings.home_pack) {
            try {
                eat_options = autoEatOptions(this.bot.autoEat.options);
            } catch (error) {
                console.warn('Could not set the options of auto-eat:', error);
            }
        }
        this.bot.autoEat.options = eat_options ?? {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
        };

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this._resumeGoal(save_data);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am "+this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        this.bot.stopDigging();
        this.bot.collectBlock.cancelTask();
        this.bot.pathfinder.stop();
        this.bot.pvp.stop();
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);
        // v0.1.4.6, G3: a command that a player types or that answers a player is an order, from the time of the message
        const from_player = !self_prompt && !from_other_bot;
        const order_time = { at: Date.now(), atTimeOfDay: this.bot?.time?.timeOfDay ?? null };

        if (!self_prompt && !from_other_bot) { // from user, check for forced commands
            const user_command_name = containsCommand(message);
            if (user_command_name) {
                if (!commandExists(user_command_name)) {
                    this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                    return false;
                }
                this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                if (user_command_name === '!newAction') {
                    // all user-initiated commands are ignored by the bot except for this one
                    // add the preceding message to the history to give context for newAction
                    this.history.add(source, message);
                }
                const order = { by: source, ...order_time, command: user_command_name };
                this.last_order = order;
                let execute_res = await executeCommand(this, message);
                if (this.last_order === order)
                    this.last_order = null; // the ordered command ended
                if (execute_res) 
                    this.routeResponse(source, execute_res);
                return true;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages
        await this.history.add(source, message);
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

                const order = from_player ? { by: source, ...order_time, command: command_name } : null;
                if (order)
                    this.last_order = order;
                let execute_res = await executeCommand(this, res);
                if (order && this.last_order === order)
                    this.last_order = null; // the ordered command ended

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;

                if (execute_res)
                    this.history.add('system', shortenCommandResult(execute_res, numberSetting(settings.max_command_result_chars, 0)));
                else
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) {this.bot.chat(message);}
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
            }
            prev_health = this.bot.health;
        });
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('death', () => {
            this.actions.cancelResume();
            this.actions.stop();
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                let death_pos = this.bot.entity.position;
                this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z, this.bot.game.dimension);
                let death_pos_text = null;
                if (death_pos) {
                    death_pos_text = `x: ${death_pos.x.toFixed(2)}, y: ${death_pos.y.toFixed(2)}, z: ${death_pos.z.toFixed(2)}`;
                }
                let dimention = this.bot.game.dimension;
                this.handleMessage('system', `You died at position ${death_pos_text || "unknown"} in the ${dimention} dimension with the final message: '${message}'. Your place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned.`);
            }
        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            this.bot.modes.unPauseAll();
            setTimeout(() => {
                if (this.isIdle()) {
                    this.actions.resumeAction();
                }
            }, 1000);
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        await this.checkTaskDone();
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    cleanKill(msg='Killing agent process...', code=1) {
        console.log(`Agent process ends with exit code ${code}: ${msg}`);
        // the history or the bot may not exist yet: the exit must happen in every case
        try { this.history.add('system', msg); } catch (_) { /* no history */ }
        try { this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.'); } catch (_) { /* no bot */ }
        try { this.history.save(); } catch (_) { /* no history */ }
        reportCostAtExit(this.cost_meter);
        process.exit(code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}
