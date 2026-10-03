import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands, commandCallText } from './commands/index.js';
import { mineRoutesOn } from './commands/actions.js'; // v0.1.4.9: after index.js, which loads actions.js first
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
import { log, validateNameFormat, handleDisconnection, createDisconnectWatcher } from './connection_handler.js';
import { initSandbox, makeCompartment } from './library/lockdown.js';
import { WorldMemory } from './world/world_memory.js';
import { shouldResumeGoal, ResumeGuard } from './world/resume_policy.js';
import { SkillManager, skillFlags } from './skills/skill_manager.js';
import * as skills from './library/skills.js';
import { holdOnLadder } from './library/ladder_pass.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import { setUsageSink } from './cost/usage_context.js';
import { CostMeter } from './cost/cost_meter.js';
import { AreaStore } from './areas/area_store.js';
import { installAreaGuard } from './areas/area_guard.js';
import { PlacedStore } from './areas/placed_store.js';
import { autoHome } from './areas/auto_home.js';
import { RuleStore } from './rules/rule_store.js';
import { autoEatOptions, passThrough, enterBuilding, doorIsSafe, foodItems, moveOffhandBack, createDoorService } from './packs/home/index.js';
// v0.1.4.8 (X5): wakeUp of the home pack may not exist yet; always called with ?.
import * as homePack from './packs/home/index.js';
import { whereAmI as whereAmIOf } from './reflex/where_am_i.js';
import { installChatLimit } from './reflex/chat_limit.js';
import { WAKE_RULES, shouldWakeFor } from './reflex/wake_logic.js';
import { knowledgeText, whereLine, KNOWLEDGE_HEADER } from './knowledge/knowledge_text.js';
import { unsavedEnclosure, enclosureKnowledge, ENCLOSURE_KNOWLEDGE_MS } from './areas/area_sense.js';
import { writeExit, readExit, restartNote } from './restart_context.js';
import { RepeatGuard } from './repeat_guard.js';
import { withTimeLimit } from '../utils/kill_timer.js';
import { createJob, JobStore, JOB_FILE } from './job/index.js'; // v0.1.4.10: no pack; createJob runs only with job_memory

// v0.1.4.8: the longest wait of a step at spawn that talks to the server (the move out of the off-hand)
const SPAWN_STEP_MS = 5000;
// v0.1.4.8 (X9): after the socket closed, the packet of a kick with its reason may still come this long
const KICK_WAIT_MS = 1000;

// A number setting of v0.1.4.6: a value that is not finite or is below 0 counts as the default.
export function numberSetting(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

// v0.1.4.9 (section 2): the steps of the trail that are kept, trail_max_steps: a whole number of 50 or more;
// any other value counts as the default 500.
export const TRAIL_MAX_STEPS = 500;
export function trailMaxSteps(value) {
    return Number.isInteger(value) && value >= 50 ? value : TRAIL_MAX_STEPS;
}

// v0.1.4.9: the warning at the start when mine_routes is on without routes_pack
export const MINE_ROUTES_WARNING = 'mine_routes needs routes_pack. The mine routes are off.';

// v0.1.4.10 (I4): the job of the bot is looked at every this many milliseconds, with job_memory
export const JOB_TICK_MS = 5000;
// v0.1.4.10: the warning at the start when idle_jobs has entries without job_memory
export const IDLE_JOBS_WARNING = 'idle_jobs needs job_memory. The list does not run.';

// v0.1.4.10 (I4, G 2): the knowledge block with the line of the job right after the where line (after the
// header when the block has no where line); the block alone without a line; the header and the line without a
// block. where: the where line of the block, '' without one.
export function withJobLine(block, where, line) {
    if (typeof line !== 'string' || line.trim() === '')
        return block;
    if (typeof block !== 'string' || block === '')
        return `${KNOWLEDGE_HEADER}\n${line}`;
    const lines = block.split('\n');
    const at = typeof where === 'string' && where !== '' && lines[1] === where ? 2 : 1;
    lines.splice(at, 0, line);
    return lines.join('\n');
}

// v0.1.4.9 (I6, C for G 2): a mine without its list of the ore left behind, for the knowledge block while
// mine_routes is off, so that old entries do not show
function withoutPassed(mine) {
    if (!mine || typeof mine !== 'object' || !('passed' in mine))
        return mine;
    const { passed, ...rest } = mine;
    return rest;
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

// v0.1.4.8 (F3): the init message with the note about the restart after it; the note alone without one.
export function withRestartNote(init_message, note) {
    if (typeof note !== 'string' || note === '')
        return init_message;
    if (typeof init_message !== 'string' || init_message.trim() === '')
        return note;
    return `${init_message}\n${note}`;
}

// v0.1.4.8 (F3): the running action as the restart note names it: '!mineOre' for a command, 'the reflex
// unstuck' for a mode, null when nothing runs.
function actionName(label) {
    if (typeof label !== 'string' || label === '')
        return null;
    if (label.startsWith('action:'))
        return `!${label.slice('action:'.length)}`;
    if (label.startsWith('mode:'))
        return `the reflex ${label.slice('mode:'.length)}`;
    return label;
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

/**
 * v0.1.4.12 (G2): tells the server that the client has loaded the world (packet player_loaded, new in
 * 1.21.4), so the server takes the bot's actions from the first second after a spawn. mineflayer 4.33
 * never sends it. Written only when the protocol of the bot's version has the packet. One console line.
 * Never throws. Returns true when the packet was written.
 */
export function sendPlayerLoaded(bot) {
    try {
        const has = Boolean(bot?.registry?.protocol?.play?.toServer?.types?.packet_player_loaded);
        if (!has || typeof bot?._client?.write !== 'function')
            return false;
        bot._client.write('player_loaded', {});
        console.log('Sent player_loaded after the spawn.');
        return true;
    } catch (error) {
        console.warn('Could not send player_loaded:', error?.message ?? error);
        return false;
    }
}

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0, is_restart=false) {
        // lock down the realm before any component or the bot is created
        initSandbox(settings);
        this.last_sender = null;
        this.last_order = null; // the command that a player ordered and that still runs (v0.1.4.6, G3)
        this.running_commands = []; // v0.1.4.8: the commands that run now, see executeCommand
        this.last_pack_text = null; // v0.1.4.8: the text of the last pack command, for say_results
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
        
        // v0.1.4.8 (F5): with repeat_guard, a command of the model that keeps giving the same result is refused
        this.repeat_guard = null;
        if (numberSetting(settings.repeat_guard, 0) > 0) {
            try {
                this.repeat_guard = new RepeatGuard({ limit: settings.repeat_guard });
            } catch (error) {
                console.warn('Could not start the repeat guard:', error);
            }
        }

        // v0.1.4.10 (I4): with job_memory, the job of the bot in bots/<name>/job.json; null without it (no object,
        // no tick). The orders it runs itself are system orders; the model is asked only for the steps of a plan.
        this.job = null;
        if (settings.job_memory === true) {
            try {
                this.job = createJob(this, new JobStore(`./bots/${this.name}/${JOB_FILE}`), {
                    settings,
                    executeCommand: (text, options) => this._runJobOrder(text, options),
                    askModel: (prompt) => this.prompter.promptPlan(prompt),
                });
            } catch (error) {
                this.job = null;
                console.warn('Could not start the job memory:', error);
            }
        } else if (Array.isArray(settings.idle_jobs) && settings.idle_jobs.length > 0) {
            console.warn(IDLE_JOBS_WARNING);
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
        if (settings.mine_routes && !settings.routes_pack)
            console.warn(MINE_ROUTES_WARNING); // v0.1.4.9: once, the mine routes stay off
        if (!this.cost_meter)
            this.blocked_actions.push('!cost');
        if (!this.rule_store)
            this.blocked_actions.push('!rememberRule', '!forgetRule', '!rules');
        if (!areas_on)
            this.blocked_actions.push('!rememberArea', '!setArea', '!forgetArea', '!areas', '!allowChanges');
        if (!settings.home_pack)
            this.blocked_actions.push('!goToShelter', '!eat', '!closeDoor');
        // the parts of v0.1.4.7: a pack is imported only while a switch needs it; the commands of a part
        // that is off, or whose pack could not be loaded, are hidden (v0.1.4.9: also the routes pack)
        if (settings.storage_pack || settings.farming_pack || settings.wood_pack || settings.mining_pack || settings.routes_pack) {
            this.work_packs = await this._loadWorkPacks();
            if (!settings.world_memory && (this.work_packs.storage || this.work_packs.mining))
                console.warn('Without world_memory the chest index and the mine store live in memory only and are lost when the bot stops.');
        }
        if (!settings.storage_pack || !this.work_packs?.storage)
            this.blocked_actions.push('!storeItems', '!fetchItem', '!chests');
        if (!settings.farming_pack || !this.work_packs?.farming)
            this.blocked_actions.push('!farmCycle', '!harvest', '!plant', '!makeBoneMeal', '!fertilize');
        if (!settings.wood_pack || !this.work_packs?.wood)
            this.blocked_actions.push('!chopTrees', '!getTool', '!craftSupplies');
        if (!settings.mining_pack || !this.work_packs?.mining)
            this.blocked_actions.push('!mineOre', '!goToMine', '!leaveMine');
        if (!settings.mining_pack || !this.work_packs?.mining)
            this.blocked_actions.push('!mines', '!forgetMine'); // v0.1.4.10 (R4): the mines the bot knows
        // the parts of v0.1.4.9: the ways of the player (routes_pack), the mine of the player (mine_routes as it
        // takes effect, with mining_pack and routes_pack, both packs loaded)
        if (!settings.routes_pack || !this.work_packs?.routes)
            this.blocked_actions.push('!rememberRoute', '!routes', '!forgetRoute');
        if (!this._mineRoutesOn())
            this.blocked_actions.push('!rememberMine', '!rememberTunnel', '!collectPassedOre');
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        this._limitChat(); // v0.1.4.8 (X9): every chat line of the bot through one queue
        if (settings.world_memory) {
            try {
                this.world_memory = new WorldMemory({ name: this.name, settings, history: this.history, memoryBank: this.memory_bank });
                this.world_memory.attach(this.bot);
            } catch (error) {
                console.warn('Could not start world memory:', error);
            }
        }
        if (areas_on || settings.protect_built_blocks)
            this._startAreaGuard(); // once, on the bot; it reads the areas of the current world (v0.1.4.8: also for built blocks)
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            // v0.1.4.8 (X9): with the words of the game for the reason of a kick
            const { type, msg } = handleDisconnection(this.name, reason, { language: this.bot?.registry?.language ?? null, kicked: event === 'Kicked' });

            console.log(`Agent process ends with exit code 1: ${msg}`);
            this._atExit(msg); // v0.1.4.8: the exit file, the door service, the placed blocks
            reportCostAtExit(this.cost_meter);
            process.exit(1);
        };
        // v0.1.4.8 (X9): the socket can close before the packet of a kick is read; after an end the reason of
        // a kick may still come for a moment, so a kick for spamming is not printed as a closed socket
        this._disconnect = createDisconnectWatcher({ onFinal: onDisconnect, waitMs: KICK_WAIT_MS });

        // Bind events
        this.bot.once('kicked', (reason) => this._disconnect.kicked(reason));
        this.bot.once('end', (reason) => this._disconnect.ended(reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                 this._disconnect.error(err);
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
        // v0.1.4.12 (G2): player_loaded at every spawn, first of the listeners; mineflayer emits 'spawn' again
        // after a death and a change of dimension (the respawn packet), and the server waits for it again then.
        this.bot.on('spawn', () => sendPlayerLoaded(this.bot));
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
                if (this.work_packs)
                    this._workStores(); // the chest index and the mine store of this world (v0.1.4.7)
                if (settings.routes_pack && this.work_packs)
                    this._trail(); // v0.1.4.9 (I1): the trail of this world starts
                const restart_note = await this._atSpawn(); // v0.1.4.8: off-hand, house, doors, restart note
                this._jobAtSpawn(); // v0.1.4.10 (I4): a running job says that it goes on
              
                this._setupEventHandlers(save_data, withRestartNote(init_message, restart_note));
                this.startEvents();
                this._startJobTimer(); // v0.1.4.10 (I4): the job is looked at every 5 s
              
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

        // v0.1.4.12 (C): the watch server with watch_server, on 127.0.0.1:watch_port; the token is read once here and
        // never printed. Without it the text says so once and the agent goes on.
        try {
            const watch = settings.watch_server ? await import('./watch/server.js') : null;
            this.watch = watch ? await watch.startWatchServer(this, { port: settings.watch_port, token: process.env.MC_WATCH_TOKEN }) : null;
            if (this.watch?.text)
                console.log(this.watch.text);
        } catch (error) {
            this.watch = null;
            console.warn('Could not start the watch server:', error?.message ?? error);
        }
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

    _guardWanted() {
        // v0.1.4.6: the saved areas (protected_areas with world_memory); v0.1.4.8 (D3): or the built blocks
        return (Boolean(settings.protected_areas) && Boolean(settings.world_memory)) || Boolean(settings.protect_built_blocks);
    }

    _startAreaGuard() {
        // v0.1.4.6, G5: installed once; the guard asks for the store of the current world. Never throws.
        // v0.1.4.8 (D3, D4, I3): also for protect_built_blocks alone (then the store is null); it knows the
        // blocks that the bot placed and whether the running command was typed by the player.
        if (!this._guardWanted())
            return;
        try {
            // the full guard with permit and revoke stays here; bot.areaGuard has no permits (Amendment 2, F2)
            this.area_guard = installAreaGuard(this.bot, {
                store: () => this._areaStore(),
                getDimension: () => this.bot.game?.dimension,
                log: (text) => console.log(text),
                protectBuiltBlocks: () => settings.protect_built_blocks === true,
                placed: () => this._placedStore(),
                getCommand: () => this._runningCommandText(),
            });
            this.area_guard.setPlayerOrder?.(() => this._typedOrderRuns(), () => this._runningCommandText());
        } catch (error) {
            console.warn('Could not protect the saved areas:', error);
        }
    }

    _typedOrderRuns() {
        // v0.1.4.8 (I3): true while the running action is the command that a player typed in the chat
        // (agent.last_order with typed: true, and its action runs). Never throws.
        try {
            const order = this.last_order;
            if (!order || order.typed !== true || typeof order.command !== 'string')
                return false;
            return this.actions?.executing === true && this.actions.currentActionLabel === `action:${order.command.slice(1)}`;
        } catch (error) {
            return false;
        }
    }

    _runningCommandText() {
        // v0.1.4.8: the text of the newest running command, for example '!collectBlocks("oak_fence", 20)', or null
        const list = Array.isArray(this.running_commands) ? this.running_commands : [];
        const text = list[list.length - 1]?.text;
        return typeof text === 'string' && text !== '' ? text : null;
    }

    _placedStore() {
        // v0.1.4.8 (D4): the blocks that the bot placed, per world in <world folder>/placed.json, in memory
        // only without world_memory. null before the world is known. The store of the world that is left
        // is written first. Never throws.
        const dir = settings.world_memory ? (this.world_memory?.worldDir ?? null) : ''; // '': in memory only
        if (!this._placed || this._placed.dir !== dir) {
            try {
                this._placed?.store?.flush?.();
            } catch (error) {
                console.warn('Could not save the blocks that the bot placed:', error);
            }
            let store = null;
            if (dir !== null) {
                try {
                    store = new PlacedStore(dir ? `${dir}/placed.json` : null);
                    store.load();
                } catch (error) {
                    store = null;
                    console.warn('Could not open placed.json of this world:', error);
                }
            }
            this._placed = { dir, store };
        }
        return this._placed.store;
    }

    _areaStore() {
        // The area store of the current world, created when the world is known and again when it
        // changes. null before that or when the file cannot be used. Never throws.
        if (!settings.protected_areas || !settings.world_memory)
            return null;
        const dir = this.world_memory?.worldDir ?? null;
        if (dir !== this._area_dir) {
            // v0.1.4.8: another world: the door service of the old one stops, the mode makes a new one
            if (this._area_dir && this.door_service) {
                try {
                    this.door_service.stop?.();
                } catch (error) {
                    console.warn('Could not stop the door service:', error);
                }
                this.door_service = undefined;
            }
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
        // what the modules of the home pack get (spec v0.1.4.6, section 5); v0.1.4.8: say (C2) and whereAmI (I2);
        // v0.1.4.9: routes (I4), null without routes_pack
        const ctx = {
            areas: this.area_store ?? null,
            places: this.memory_bank,
            settings,
            log: (text) => skills.log(this.bot, text),
            now: () => Date.now(),
            skills,
            world,
            say: (text) => this.sayText(text),
            whereAmI: () => this.whereAmI(),
            routes: null,
            // v0.1.4.11 (I8): a walk reserves the openable it is about to pass; the door service leaves it alone
            doors: {
                reserve: (door, ms) => this.door_service?.reserve?.(door, ms) ?? false,
                release: (door, options) => this.door_service?.release?.(door, options), // F12: { passed: true } counts as a pass
            },
        };
        ctx.routes = this._routes(ctx);
        return ctx;
    }

    whereAmI() {
        // v0.1.4.8 (I2): { area: { name, type } | null, depth, underground } of reflex/where_am_i.js; v0.1.4.9 (I7):
        // and mine, the mine of the store the bot is in, with mine_routes (else null; the bot counts as
        // underground in a mine). The modes and the packs ask this. Never throws.
        return whereAmIOf(this.bot, Date.now(), { mine: this._mineHere() });
    }

    _mineRoutesOn() {
        // v0.1.4.9: mine_routes as it takes effect (mineRoutesOn of the commands: with mining_pack and routes_pack),
        // with both packs loaded
        const packs = this.work_packs;
        if (!packs)
            return false;
        return mineRoutesOn() && Boolean(packs.mining) && Boolean(packs.routes);
    }

    _mineHere() {
        // v0.1.4.9 (I7, B for G 2): with mine_routes, the mine that holds the bot (mineAt of the mining pack over
        // the mines of its dimension: the room, a tunnel, a branch or the way in) as { name, tunnel, level, onRoute };
        // tunnel is an index from 0 or null on the way in, level that of the tunnel, else of the mine. null
        // without mine_routes, outside every mine, or when it cannot be read. Never throws.
        if (!this._mineRoutesOn())
            return null;
        try {
            const pack = this.work_packs.mining;
            const mines = this._workStores().mines;
            const pos = this.bot?.entity?.position;
            if (typeof pack.mineAt !== 'function' || !mines || !pos)
                return null;
            const at = pack.mineAt(mines.list(this.bot.game?.dimension), { x: pos.x, y: pos.y, z: pos.z });
            if (!at?.mine)
                return null;
            const tunnel = Number.isInteger(at.tunnel) ? at.tunnel : null;
            const level = tunnel !== null ? (pack.tunnelsOf?.(at.mine)?.[tunnel]?.level ?? at.mine.level) : at.mine.level;
            return { name: at.mine.name ?? null, tunnel, level, onRoute: at.onRoute === true };
        } catch (error) {
            console.warn('Could not find the mine the bot is in:', error);
            return null;
        }
    }

    sayText(text) {
        // v0.1.4.8 (C2): a text of a pack or a reflex into the chat and into the history, without a call of
        // the model. Never throws.
        if (typeof text !== 'string' || text.trim() === '')
            return;
        try {
            Promise.resolve(this.history?.add(this.name, text)).catch((error) => console.warn('Could not note what the bot said:', error));
        } catch (error) {
            console.warn('Could not note what the bot said:', error);
        }
        if (this.shut_up)
            return;
        try {
            Promise.resolve(this.openChat(text)).catch((error) => console.warn('Could not say a text:', error));
        } catch (error) {
            console.warn('Could not say a text:', error);
        }
    }

    _limitChat() {
        // v0.1.4.8 (X9): bot.chat and bot.whisper behind one queue, 6 lines at once, then 1 line per 1.2 s. The
        // chat plugin of mineflayer defines them when the plugins are injected (after the version is known);
        // this runs right after. Never throws.
        const bot = this.bot;
        const install = () => {
            try {
                this.chat_limiter = installChatLimit(bot, { log: (...args) => console.warn(...args) });
            } catch (error) {
                console.warn('Could not limit the chat of the bot:', error);
            }
        };
        try {
            if (typeof bot?.chat === 'function')
                install();
            else
                bot?.once?.('inject_allowed', install);
        } catch (error) {
            console.warn('Could not limit the chat of the bot:', error);
        }
    }

    async wakeForAction(label) {
        // v0.1.4.8 (X5): a command that is not !goToBed gets the bot out of bed first: with the wake function
        // of the home pack when it has one (a correction for every setting, so also with home_pack off), else
        // bot.wake(); then it waits until the bot is up, at most 3 s. The action manager calls it when an
        // action starts. Returns true when the bot got up. Never throws.
        const bot = this.bot;
        if (!shouldWakeFor(label, bot?.isSleeping === true))
            return false;
        const start = Date.now();
        try {
            const wake = typeof homePack.wakeUp === 'function'
                ? () => homePack.wakeUp(bot, this.homeContext())
                : () => bot.wake();
            await withTimeLimit(WAKE_RULES.waitMs, wake, { until: () => bot.interrupt_code || bot.isSleeping !== true });
        } catch (error) {
            console.warn('Could not get out of bed:', error?.message ?? error);
        }
        while (bot.isSleeping === true && !bot.interrupt_code && Date.now() - start < WAKE_RULES.waitMs)
            await new Promise((resolve) => setTimeout(resolve, WAKE_RULES.pollMs));
        if (bot.isSleeping === true) {
            console.warn(`I am still in bed after ${WAKE_RULES.waitMs / 1000} s; ${label} starts all the same.`);
            return false;
        }
        console.log(`I got out of bed for ${label}.`);
        return true;
    }

    knowledgeBlock() {
        // v0.1.4.8 (C1, I9): what the bot knows, for the chat prompt, with knowledge_in_prompt; '' without it
        // or before the bot is in a world. The chests and the mines of this dimension, the saved areas and
        // places, where the bot is. Never throws.
        if (!settings.knowledge_in_prompt)
            return '';
        try {
            const bot = this.bot;
            const pos = bot?.entity?.position;
            if (!pos)
                return '';
            const dimension = bot.game?.dimension;
            const plain = (d) => (typeof d === 'string' && d !== '' ? d.replace(/^minecraft:/, '') : 'overworld');
            const stores = this._workStores();
            const areas = (this.area_store?.list?.() ?? []).filter((area) => plain(area?.dimension) === plain(dimension));
            const mines = stores.mines?.list?.(dimension) ?? [];
            const where = { ...this.whereAmI(), pos: { x: pos.x, y: pos.y, z: pos.z } };
            const enclosure = this._enclosureHere(areas); // v0.1.4.11 (I6): an enclosure that no saved area holds
            if (enclosure)
                where.enclosure = enclosure;
            const max = numberSetting(settings.knowledge_max_chars, 600);
            // v0.1.4.10 (I4): the line of the job after the where line, within knowledge_max_chars
            const job = this._jobStatus();
            const block = knowledgeText({
                chests: stores.chests?.list?.(dimension) ?? [],
                areas,
                mines: this._mineRoutesOn() ? mines : mines.map(withoutPassed), // v0.1.4.9: the ore left behind only with mine_routes
                places: this.memory_bank ?? null,
                where,
            }, job ? Math.max(max - job.length - 1, 1) : max);
            return job ? withJobLine(block, whereLine(where), job) : block;
        } catch (error) {
            console.warn('Could not tell what the bot knows:', error);
            return '';
        }
    }

    _enclosureHere(areas) {
        // v0.1.4.11 (I6): the enclosure the bot stands in when no saved area holds it, for the line of where the bot is,
        // as { saved: false, border, size, contents, openings, roof }; null without one or without protected areas. The
        // scan runs at most once per 10 s; in between the last answer stands. Never throws.
        if (!this.area_store || !this.bot?.entity?.position)
            return null;
        const now = Date.now();
        if (this._enclosure && now - this._enclosure.at < ENCLOSURE_KNOWLEDGE_MS)
            return this._enclosure.value;
        let value = null;
        try {
            value = enclosureKnowledge(unsavedEnclosure(this.bot, areas, { floors: settings.area_floors === true }));
        } catch (error) {
            console.warn('Could not scan the enclosure around the bot:', error);
        }
        this._enclosure = { at: now, value };
        return value;
    }

    _jobStatus() {
        // v0.1.4.10 (I4): the line of the job for the knowledge block, '' without job_memory or a job. Never throws.
        if (!this.job)
            return '';
        try {
            const line = this.job.status();
            return typeof line === 'string' ? line.trim() : '';
        } catch (error) {
            console.warn('Could not tell the job:', error);
            return '';
        }
    }

    async _runJobOrder(text, options = {}) {
        // v0.1.4.10 (I4): an order of the job (the resumed command, a step, an entry of idle_jobs) as a system
        // order: through executeCommand, not through the model. Its result goes into the history, so the model
        // knows it later. Never throws.
        let result;
        try {
            result = await executeCommand(this, text, { ...options, by: 'system', typed: false });
        } catch (error) {
            console.warn('The order of the job failed:', error);
            return { ok: false, reason: 'error', text: `${error?.message ?? error}` };
        }
        console.log(...(result === undefined ? ['Job order:', text, 'was stopped.'] : ['Job order:', text, 'got:', result]));
        if (typeof result === 'string' && result !== '') {
            try {
                Promise.resolve(this.history?.add('system', shortenCommandResult(result, numberSetting(settings.max_command_result_chars, 0))))
                    .catch((error) => console.warn('Could not note the result of the job order:', error));
            } catch (error) {
                console.warn('Could not note the result of the job order:', error);
            }
        }
        return result;
    }

    _jobAtSpawn() {
        // v0.1.4.10 (I4): at spawn, after the note about the restart: a running job says that it goes on. Never throws.
        if (!this.job)
            return;
        try {
            this.job.onRestart();
        } catch (error) {
            console.warn('Could not go on with the job:', error);
        }
    }

    _startJobTimer() {
        // v0.1.4.10 (I4): tick() of the job every JOB_TICK_MS, not awaited (it answers busy while one runs); once,
        // only with job_memory. The timer does not keep the process alive. Never throws.
        if (!this.job || this._job_timer)
            return;
        try {
            this._job_timer = setInterval(() => {
                try {
                    Promise.resolve(this.job?.tick()).catch((error) => console.warn('The job failed:', error));
                } catch (error) {
                    console.warn('The job failed:', error);
                }
            }, JOB_TICK_MS);
            this._job_timer.unref?.();
        } catch (error) {
            console.warn('Could not start the timer of the job:', error);
        }
    }

    async _loadWorkPacks(loaders = {}) {
        // v0.1.4.7: the packs of the work skills, each imported only while a switch needs it. A pack may be
        // called by another pack whatever its own switch says (spec section 1): the storage pack serves the
        // other three, the wood pack serves mining. A pack that cannot be loaded logs one warning, and its
        // commands stay hidden. Never throws. loaders is for tests: a function per pack that replaces its import.
        const packs = {};
        const failed = (name, error) => console.warn(`Could not load the ${name} pack, its commands stay hidden:`, error?.message ?? error);
        if (settings.storage_pack || settings.farming_pack || settings.wood_pack || settings.mining_pack) {
            try {
                packs.storage = await (loaders.storage ? loaders.storage() : import('./packs/storage/index.js'));
            } catch (error) {
                failed('storage', error);
            }
        }
        if (settings.farming_pack) {
            try {
                packs.farming = await (loaders.farming ? loaders.farming() : import('./packs/farming/index.js'));
            } catch (error) {
                failed('farming', error);
            }
        }
        if (settings.wood_pack || settings.mining_pack) {
            try {
                packs.wood = await (loaders.wood ? loaders.wood() : import('./packs/wood/index.js'));
            } catch (error) {
                failed('wood', error);
            }
        }
        if (settings.mining_pack) {
            try {
                packs.mining = await (loaders.mining ? loaders.mining() : import('./packs/mining/index.js'));
            } catch (error) {
                failed('mining', error);
            }
        }
        // v0.1.4.9: the routes pack (the trail, the ways of the player), with routes_pack
        if (settings.routes_pack) {
            try {
                packs.routes = await (loaders.routes ? loaders.routes() : import('./packs/routes/index.js'));
            } catch (error) {
                failed('routes', error);
            }
        }
        // v0.1.4.12 (part B): the watching pack (learning by watching), with watch_and_learn; start() loads the work
        // packs while one of their switches is on, so the test names them too
        if (settings.watch_and_learn && (settings.storage_pack || settings.farming_pack || settings.wood_pack || settings.mining_pack || settings.routes_pack)) {
            try {
                packs.watch = await (loaders.watch ? loaders.watch() : import('./packs/watch/index.js'));
            } catch (error) {
                failed('watch', error);
            }
        }
        return packs;
    }

    _workStore(key, Store, file) {
        // v0.1.4.7: the chest index (key chests) or the mine store (key mines) of the current world, made
        // when the world is known and again when it changes, like the area store. Without world_memory it
        // lives in memory only. null before the world is known or when it cannot be made. Never throws.
        if (typeof Store !== 'function')
            return null;
        const dir = settings.world_memory ? (this.world_memory?.worldDir ?? null) : ''; // '': in memory only
        const stores = this.work_stores ?? (this.work_stores = {});
        if (stores[key]?.dir !== dir) {
            stores[key] = { dir, store: null };
            if (dir !== null) {
                try {
                    const store = new Store(dir ? `${dir}/${file}` : null);
                    store.load();
                    stores[key].store = store;
                } catch (error) {
                    console.warn(`Could not open ${file} of this world:`, error);
                }
            }
        }
        return stores[key].store;
    }

    _workStores() {
        // v0.1.4.7: the chest index and the mine store of the current world, when their packs are loaded
        const packs = this.work_packs;
        if (!packs)
            return { chests: null, mines: null };
        return {
            chests: this._workStore('chests', packs.storage?.ChestIndex, 'chests.json'),
            mines: this._workStore('mines', packs.mining?.MineStore, 'mines.json'),
        };
    }

    _trail() {
        // v0.1.4.9 (I1): the trail of the current world with routes_pack (createTrail of the routes pack, file
        // <world folder>/trail.json, in memory only without world_memory, trail_max_steps steps), made and started
        // when the world is known (at spawn) and again when it changes; the trail of the world that is left
        // stops first and is written. null before the world is known or when it cannot be made. Never throws.
        if (!settings.routes_pack || !this.work_packs)
            return null;
        const dir = settings.world_memory ? (this.world_memory?.worldDir ?? null) : ''; // '': in memory only
        if (this._trail_of && this._trail_of.dir === dir)
            return this._trail_of.trail;
        this._stopTrail();
        let trail = null;
        const createTrail = this.work_packs.routes?.createTrail;
        if (dir !== null && typeof createTrail === 'function') {
            try {
                trail = createTrail(this.bot, { settings, now: () => Date.now(), log: (text) => console.log(text) },
                    { file: dir ? `${dir}/trail.json` : null, maxSteps: trailMaxSteps(settings.trail_max_steps) });
                trail.start();
            } catch (error) {
                trail = null;
                console.warn('Could not start the trail of this world:', error);
            }
        }
        this._trail_of = { dir, trail };
        return trail;
    }

    _stopTrail() {
        // v0.1.4.9 (I1): the trail stops and writes its file (a world change, the exit). Never throws.
        try {
            this._trail_of?.trail?.stop?.();
        } catch (error) {
            console.warn('Could not stop the trail:', error);
        }
    }

    _routes(ctx) {
        // v0.1.4.9 (I4): ctx.routes of the home context with routes_pack: bindRoutes of the routes pack with the route
        // store of this world (routes.json) and its trail, made once per world (bindRoutes never reads ctx.routes;
        // it uses the clock and the log of the first context). null without routes_pack, before the world is
        // known or when the pack could not be loaded. Never throws.
        if (!settings.routes_pack || !this.work_packs)
            return null;
        try {
            const pack = this.work_packs.routes;
            if (typeof pack?.bindRoutes !== 'function')
                return null;
            const store = this._workStore('routes', pack.RouteStore, 'routes.json');
            const trail = this._trail();
            if (!store && !trail)
                return null;
            const bound = this._routes_of;
            if (bound && bound.store === store && bound.trail === trail)
                return bound.routes;
            const routes = pack.bindRoutes(this.bot, ctx, store, trail) ?? null;
            this._routes_of = { store, trail, routes };
            return routes;
        } catch (error) {
            console.warn('Could not give the routes of this world to the packs:', error);
            return null;
        }
    }

    packContext() {
        // what the packs of v0.1.4.7 get (spec section 2): the home context, the chest index and the mine
        // store of this world, and the functions of the other packs. Only the parts of v0.1.4.7 call it.
        const ctx = {
            ...this.homeContext(),
            ...this._workStores(),
            storage: null,
            tools: null,
            wood: null,
            home: { passThrough, enterBuilding, doorIsSafe, foodItems }, // as they are, not bound (Amendment 1, part F; v0.1.4.8, I7)
        };
        const packs = this.work_packs;
        if (!packs)
            return ctx;
        if (typeof packs.storage?.bindStorage === 'function')
            ctx.storage = packs.storage.bindStorage(this.bot, ctx); // storeItems and fetchItem bound to the bot
        if (packs.wood) {
            ctx.tools = packs.wood.TOOLS_API ?? null; // ensureTool and craftSupplies, not bound (Amendment 1, part T)
            ctx.wood = packs.wood.WOOD_API ?? null; // chopTrees, not bound
        }
        return ctx;
    }

    async _atSpawn() {
        // v0.1.4.8 (part G, 6): at spawn, in this order, each step in its own try so that one failure does not
        // stop the others: the food of the off-hand back into the inventory (home_pack, E1); the house as the
        // area "home" (protected_areas, D6), its text is said; the door service (home_pack, I8); the note
        // about the restart (restart_context, F3). Returns the note, '' without one. Never throws.
        const bot = this.bot;
        if (settings.home_pack) {
            try {
                // a click in the inventory that the server never answers must not stop the start
                const moved = await withTimeLimit(SPAWN_STEP_MS, () => moveOffhandBack(bot));
                if (!moved.done)
                    console.warn('Could not move the food out of the off-hand:', moved.error ?? 'no answer in time');
            } catch (error) {
                console.warn('Could not move the food out of the off-hand:', error);
            }
        }
        if (settings.protected_areas && settings.world_memory) {
            try {
                const getBlock = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null;
                const result = autoHome(getBlock, this.memory_bank, this._areaStore(), bot.entity?.position ?? null, { dimension: bot.game?.dimension });
                if (result?.text)
                    this.sayText(result.text);
            } catch (error) {
                console.warn('Could not save the house as the area "home":', error);
            }
        }
        if (settings.home_pack) {
            try {
                this.door_service = createDoorService(bot, { ...this.homeContext(), log: (text) => console.log(text) }) ?? null;
            } catch (error) {
                this.door_service = null;
                console.warn('Could not start the door service:', error);
            }
        }
        let note = '';
        if (settings.restart_context) {
            try {
                note = restartNote(readExit(`./bots/${this.name}`));
                if (note)
                    console.log(note);
            } catch (error) {
                note = '';
                console.warn('Could not read why the last process ended:', error);
            }
        }
        return note;
    }

    _atExit(reason) {
        // v0.1.4.8: right before the process exits (cleanKill, a disconnect): the exit file with restart_context
        // (F3), the door service stops, the blocks that the bot placed are written (D4); v0.1.4.9: the trail
        // stops and is written (I1). Never throws.
        if (settings.restart_context) {
            try {
                writeExit(`./bots/${this.name}`, {
                    reason: typeof reason === 'string' ? reason : null,
                    order: this.last_order ?? null,
                    action: actionName(this.actions?.currentActionLabel),
                    position: this.bot?.entity?.position ?? null,
                    time: Date.now(),
                });
            } catch (error) {
                console.warn('Could not save why the process ends:', error);
            }
        }
        try {
            this.door_service?.stop?.();
        } catch (error) {
            console.warn('Could not stop the door service:', error);
        }
        try {
            this._placed?.store?.flush?.();
        } catch (error) {
            console.warn('Could not save the blocks that the bot placed:', error);
        }
        this._stopTrail(); // v0.1.4.9 (I1): the trail is written; never throws
        if (this._job_timer) {
            clearInterval(this._job_timer); // v0.1.4.10: the job is looked at no more
            this._job_timer = null;
        }
        try {
            this.bot?.chatLimiter?.drop?.(); // v0.1.4.8 (X9): the chat lines that still wait are dropped
        } catch (error) {
            console.warn('Could not drop the waiting chat lines:', error);
        }
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

    requestInterrupt(by = null) {
        // v0.1.4.8 (I5): who stops, for the result of the action (the first one counts)
        this.actions?.noteStop?.(by);
        this.bot.interrupt_code = true; // first, so a walk that gets GoalChanged sees the interrupt and ends quietly
        // v0.1.4.8 (S9): stop() alone is read only when the bot arrives at a node; setGoal(null) after it ends
        // the walk now and clears the flag of stop()
        try {
            this.bot.pathfinder.stop();
            this.bot.pathfinder.setGoal(null); // this clears every control of the bot
            holdOnLadder(this.bot); // F36: a bot stopped on a ladder holds on until the next order takes the ladder
        } catch (error) {
            console.warn('Could not end the path search:', error);
        }
        this.bot.stopDigging();
        this.bot.collectBlock.cancelTask();
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
                // v0.1.4.8: text is the whole command (for the restart context and the guard), typed marks an
                // order that the player typed in the chat (the guard, !setMode, the repeat guard)
                const order = { by: source, ...order_time, command: user_command_name, text: commandCallText(message), typed: true };
                this.last_order = order;
                let execute_res = await executeCommand(this, message, { typed: true, by: source });
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
        let pack_text = null; // v0.1.4.8: the text of the pack command that ran last, for say_results
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            if (res.trim().length === 0) {
                console.warn('no response')
                // v0.1.4.8: the model said nothing (or a tab) after a work skill; with say_results its text goes to the chat
                if (settings.say_results && pack_text !== null)
                    this.routeResponse(source, pack_text);
                break; // empty response ends loop
            }
            pack_text = null;

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

                const order = from_player ? { by: source, ...order_time, command: command_name, text: commandCallText(res), typed: false } : null;
                if (order)
                    this.last_order = order;
                this.last_pack_text = null;
                let execute_res = await executeCommand(this, res, { typed: false });
                if (order && this.last_order === order)
                    this.last_order = null; // the ordered command ended
                if (typeof execute_res === 'string' && execute_res !== '' && execute_res === this.last_pack_text)
                    pack_text = execute_res; // the text of a work skill (runPack, the home pack)

                console.log(...(execute_res === undefined ? ['Agent executed:', command_name, 'and was stopped.'] : ['Agent executed:', command_name, 'and got:', execute_res]));
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
        // v0.1.4.8 (X9): not while the watcher of the start waits for the reason of a kick
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled && !this._disconnect?.pending && !this._disconnect?.settled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('death', () => {
            this.actions.cancelResume();
            this.actions.stop();
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled && !this._disconnect?.pending && !this._disconnect?.settled) {
                const { msg } = handleDisconnection(this.name, reason, { language: this.bot?.registry?.language ?? null, kicked: true });
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
        try { this._atExit(msg); } catch (_) { /* a fake agent of a test */ }
        try { this.watch?.close?.(); } catch (_) { /* v0.1.4.12 (C): no watch server */ }
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
