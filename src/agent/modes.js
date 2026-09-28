import * as skills from './library/skills.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';
import { withKillTimer } from '../utils/kill_timer.js';
import { DoorTracker, closeDoorsBehind, isInShelter, isNight, shouldShelter, nightShelterRoutine, creeperCheck, runCreeperProcedure } from './packs/home/index.js';
import { isBuiltBlock, isLogBlock } from './areas/area_scan.js';
import { Vec3 } from 'vec3';

async function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

// a mode is a function that is called every tick to respond immediately to the world
// it has the following fields:
// on: whether 'update' is called every tick
// active: whether an action has been triggered by the mode and hasn't yet finished
// paused: whether the mode is paused by another action that overrides the behavior (eg followplayer implements its own self defense)
// update: the function that is called every tick (if on is true)
// when a mode is active, it will trigger an action to be performed but won't wait for it to return output

// the order of this list matters! first modes will be prioritized
// while update functions are async, they should *not* be awaited longer than ~100ms as it will block the update loop
// to perform longer actions, use the execute function which won't block the update loop
const modes_list = [
    {
        name: 'self_preservation',
        description: 'Respond to drowning, burning, and damage at low health. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        fall_blocks: ['sand', 'gravel', 'concrete_powder'], // includes matching substrings like 'sandstone' and 'red_sand'
        update: async function (agent) {
            const bot = agent.bot;
            let block = bot.blockAt(bot.entity.position);
            let blockAbove = bot.blockAt(bot.entity.position.offset(0, 1, 0));
            if (!block) block = {name: 'air'}; // hacky fix when blocks are not loaded
            if (!blockAbove) blockAbove = {name: 'air'};
            if (blockAbove.name === 'water') {
                // does not call execute so does not interrupt other actions
                if (!bot.pathfinder.goal) {
                    bot.setControlState('jump', true);
                }
            }
            else if (this.fall_blocks.some(name => blockAbove.name.includes(name))) {
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 2);
                });
            }
            else if (block.name === 'lava' || block.name === 'fire' ||
                blockAbove.name === 'lava' || blockAbove.name === 'fire') {
                say(agent, 'I\'m on fire!');
                // if you have a water bucket, use it
                let waterBucket = bot.inventory.findInventoryItem('water_bucket');
                if (waterBucket) {
                    execute(this, agent, async () => {
                        let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                        if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                    });
                }
                else {
                    execute(this, agent, async () => {
                        let waterBucket = bot.inventory.findInventoryItem('water_bucket');
                        if (waterBucket) {
                            let success = await skills.placeBlock(bot, 'water_bucket', block.position.x, block.position.y, block.position.z);
                            if (success) say(agent, 'Placed some water, ahhhh that\'s better!');
                            return;
                        }
                        let nearestWater = world.getNearestBlock(bot, 'water', 20);
                        if (nearestWater) {
                            const pos = nearestWater.position;
                            let success = await skills.goToPosition(bot, pos.x, pos.y, pos.z, 0.2);
                            if (success) say(agent, 'Found some water, ahhhh that\'s better!');
                            return;
                        }
                        await skills.moveAway(bot, 5);
                    });
                }
            }
            else if (Date.now() - bot.lastDamageTime < 3000 && (bot.health < 5 || bot.lastDamageTaken >= bot.health)) {
                say(agent, 'I\'m dying!');
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 20);
                });
            }
            else if (agent.isIdle()) {
                bot.clearControlStates(); // clear jump if not in danger or doing anything else
            }
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        prev_location: null,
        distance: 2,
        stuck_time: 0,
        last_time: Date.now(),
        max_stuck_time: 20,
        prev_dig_block: null,
        update: async function (agent) {
            if (agent.isIdle()) { 
                this.prev_location = null;
                this.stuck_time = 0;
                return; // don't get stuck when idle
            }
            const bot = agent.bot;
            const cur_dig_block = bot.targetDigBlock;
            if (cur_dig_block && !this.prev_dig_block) {
                this.prev_dig_block = cur_dig_block;
            }
            if (this.prev_location && this.prev_location.distanceTo(bot.entity.position) < this.distance && cur_dig_block == this.prev_dig_block) {
                this.stuck_time += (Date.now() - this.last_time) / 1000;
            }
            else {
                this.prev_location = bot.entity.position.clone();
                this.stuck_time = 0;
                this.prev_dig_block = null;
            }
            const max_stuck_time = cur_dig_block?.name === 'obsidian' ? this.max_stuck_time * 2 : this.max_stuck_time;
            if (this.stuck_time > max_stuck_time) {
                say(agent, 'I\'m stuck!');
                this.stuck_time = 0;
                execute(this, agent, async () => {
                    // the timer is cleared also when moveAway throws (e.g. PathStopped after !stop)
                    await withKillTimer(() => { agent.cleanKill("Got stuck and couldn't get unstuck") }, 10000, () => skills.moveAway(bot, 5));
                    say(agent, 'I\'m free.');
                });
            }
            this.last_time = Date.now();
        },
        unpause: function () {
            this.prev_location = null;
            this.stuck_time = 0;
            this.prev_dig_block = null;
        }
    },
    {
        name: 'cowardice',
        description: 'Run away from enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity) && !leftToCreeperSafety(entity), 16);
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Aaa! A ${enemy.name.replace("_", " ")}!`);
                execute(this, agent, async () => {
                    await skills.avoidEnemies(agent.bot, 24);
                });
            }
        }
    },
    {
        name: 'self_defense',
        description: 'Attack nearby enemies. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity) && !leftToCreeperSafety(entity), 8);
            if (enemy && await world.isClearPath(agent.bot, enemy)) {
                say(agent, `Fighting ${enemy.name}!`);
                execute(this, agent, async () => {
                    await skills.defendSelf(agent.bot, 8, entity => !leftToCreeperSafety(entity));
                });
            }
        }
    },
    {
        name: 'hunting',
        description: 'Hunt nearby animals when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        update: async function (agent) {
            const huntable = world.getNearestEntityWhere(agent.bot, entity => mc.isHuntable(entity), 8);
            if (huntable && await world.isClearPath(agent.bot, huntable)) {
                execute(this, agent, async () => {
                    say(agent, `Hunting ${huntable.name}!`);
                    await skills.attackEntity(agent.bot, huntable);
                });
            }
        }
    },
    {
        name: 'item_collecting',
        description: 'Collect nearby items when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,

        wait: 2, // number of seconds to wait after noticing an item to pick it up
        prev_item: null,
        noticed_at: -1,
        update: async function (agent) {
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item', 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && item !== this.prev_item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.noticed_at === -1) {
                    this.noticed_at = Date.now();
                }
                if (Date.now() - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    this.prev_item = item;
                    execute(this, agent, async () => {
                        await skills.pickupNearbyItems(agent.bot);
                    });
                    this.noticed_at = -1;
                }
            }
            else {
                this.noticed_at = -1;
            }
        }
    },
    {
        name: 'torch_placing',
        description: 'Place torches when idle and there are no torches nearby.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        cooldown: 5,
        last_place: Date.now(),
        update: function (agent) {
            if (world.shouldPlaceTorch(agent.bot)) {
                if (Date.now() - this.last_place < this.cooldown * 1000) return;
                if (!torchAllowed(agent.bot)) return; // a protected area (v0.1.4.6): no torch and no log line
                execute(this, agent, async () => {
                    const pos = agent.bot.entity.position;
                    await skills.placeBlock(agent.bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
                });
                this.last_place = Date.now();
            }
        }
    },
    {
        name: 'elbow_room',
        description: 'Move away from nearby players when idle.',
        interrupts: ['action:followPlayer'],
        on: true,
        active: false,
        distance: 0.5,
        update: async function (agent) {
            const player = world.getNearestEntityWhere(agent.bot, entity => entity.type === 'player', this.distance);
            if (player) {
                execute(this, agent, async () => {
                    // wait a random amount of time to avoid identical movements with other bots
                    const wait_time = Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, wait_time));
                    if (player.position.distanceTo(agent.bot.entity.position) < this.distance) {
                        await skills.moveAwayFromEntity(agent.bot, player, this.distance);
                    }
                });
            }
        }
    },
    {
        name: 'idle_staring',
        description: 'Animation to look around at entities when idle.',
        interrupts: [],
        on: true,
        active: false,

        staring: false,
        last_entity: null,
        next_change: 0,
        update: function (agent) {
            const entity = agent.bot.nearestEntity();
            let entity_in_view = entity && entity.position.distanceTo(agent.bot.entity.position) < 10 && entity.name !== 'enderman';
            if (entity_in_view && entity !== this.last_entity) {
                this.staring = true;
                this.last_entity = entity;
                this.next_change = Date.now() + Math.random() * 1000 + 4000;
            }
            if (entity_in_view && this.staring) {
                let isbaby = entity.type !== 'player' && entity.metadata[16];
                let height = isbaby ? entity.height/2 : entity.height;
                agent.bot.lookAt(entity.position.offset(0, height, 0));
            }
            if (!entity_in_view)
                this.last_entity = null;
            if (Date.now() > this.next_change) {
                // look in random direction
                this.staring = Math.random() < 0.3;
                if (!this.staring) {
                    const yaw = Math.random() * Math.PI * 2;
                    const pitch = (Math.random() * Math.PI/2) - Math.PI/4;
                    agent.bot.look(yaw, pitch, false);
                }
                this.next_change = Date.now() + Math.random() * 10000 + 2000;
            }
        }
    },
    {
        name: 'cheat',
        description: 'Use cheats to instantly place blocks and teleport.',
        interrupts: [],
        on: false,
        active: false,
        update: function (agent) { /* do nothing */ }
    }
];

// v0.1.4.6 (Amendment 1): while bot.areaGuard exists, a torch goes only where the guard allows it. Never throws.
function torchAllowed(bot) {
    try {
        return !bot.areaGuard || bot.areaGuard.canPlace(bot.entity.position, 'torch') !== false;
    } catch (error) {
        return true;
    }
}

const AIR_NAMES = ['air', 'cave_air', 'void_air'];

// v0.1.4.7 Amendment 2, I4: a tree or a roof above the bot is no surface.
function isNoSurface(name) {
    return AIR_NAMES.includes(name) || name.endsWith('_leaves') || isLogBlock(name) || isBuiltBlock(name);
}

// v0.1.4.7, part G: how many blocks the bot stands under the surface of its column. The surface is the
// highest block above the head that is not air, leaves, a log or a built block (Amendment 2, I4), below
// the height limit `top` of the world; the depth is its y minus the y of the feet, 0 when there is no
// such block. getBlockName(x, y, z) returns a name, or null for a block that is not loaded, which counts
// as air. Pure.
export function depthUnderSurface(getBlockName, pos, top) {
    const x = Math.floor(pos.x), feet = Math.floor(pos.y), z = Math.floor(pos.z);
    for (let y = Math.floor(top) - 1; y > feet + 1; y--) {
        const name = getBlockName(x, y, z);
        if (typeof name === 'string' && !isNoSurface(name))
            return y - feet;
    }
    return 0;
}

// v0.1.4.7, part G: while the bot is more than 8 blocks under the surface, night_shelter waits. Pure.
export function nightShelterWaits(depth) {
    return depth > 8;
}

// The depth of the bot under the surface, from bot.world; 0 when it cannot be read. Never throws.
function depthOfBot(bot) {
    try {
        const top = (bot.game?.minY ?? -64) + (bot.game?.height ?? 384);
        return depthUnderSurface((x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null, bot.entity.position, top);
    } catch (error) {
        return 0;
    }
}

// v0.1.4.6, G4: while the mode creeper_safety is on, a creeper is no target for self_defense and cowardice.
function leftToCreeperSafety(entity) {
    return entity?.name === 'creeper' && modes_map.creeper_safety?.on === true;
}

// The reflexes of the home pack (v0.1.4.6, G4). initModes adds them to modes_list only while
// settings.home_pack is on and their entry in settings.home_reflexes is not false. Their updates never
// throw into the update loop.
const home_modes = [
    {
        name: 'creeper_safety',
        description: 'Back off from creepers and lead them away from the base. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        update: async function (agent) {
            try {
                // decide() on the creepers within 24 blocks and the areas within 48
                if (creeperCheck(agent.bot, agent.homeContext()).step === 'none')
                    return;
                execute(this, agent, async () => {
                    const result = await runCreeperProcedure(agent.bot, agent.homeContext());
                    if (result?.text)
                        say(agent, result.text);
                });
            } catch (error) {
                console.warn('Mode creeper_safety failed:', error);
            }
        }
    },
    {
        name: 'night_shelter',
        description: 'Go to the shelter when night comes and sleep there. Interrupts all actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        last_attempt: null,
        sheltered_at: null, // where the last shelter of this night succeeded (a place or a hole without an area)
        update: async function (agent) {
            try {
                const bot = agent.bot;
                const ctx = agent.homeContext();
                if (!isNight(bot.time.timeOfDay))
                    this.sheltered_at = null;
                const stayed = this.sheltered_at !== null && bot.entity.position.distanceTo(this.sheltered_at) < 2;
                const decision = shouldShelter({
                    timeOfDay: bot.time.timeOfDay,
                    inShelter: isInShelter(bot, ctx) || stayed,
                    action: agent.actions.currentActionLabel,
                    order: agent.last_order ?? null,
                    selfPrompting: agent.self_prompter.isActive(),
                    lastAttempt: this.last_attempt,
                    now: Date.now(),
                });
                if (!decision?.go)
                    return;
                if (settings.mining_pack && nightShelterWaits(depthOfBot(bot)))
                    return; // v0.1.4.7: deep under the surface, in the mine, the night reflex waits
                this.last_attempt = Date.now();
                say(agent, 'It is getting dark. I go to the shelter.');
                execute(this, agent, async () => {
                    // goToShelter, then sleepInBed when a bed is in the shelter
                    const result = await nightShelterRoutine(bot, ctx);
                    if (result?.ok)
                        this.sheltered_at = bot.entity.position.clone();
                    if (result?.text)
                        skills.log(bot, result.text);
                });
            } catch (error) {
                console.warn('Mode night_shelter failed:', error);
            }
        }
    },
    {
        name: 'door_closing',
        description: 'Close the doors and gates you walked through. Does not interrupt actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        tracker: null,
        // without execute, so the running action goes on. closeDoorsBehind feeds the DoorTracker and
        // closes the doors it returns; it does nothing while passThrough runs or while it still closes.
        // It is not awaited, so the update loop does not wait for the doors.
        update: function (agent) {
            try {
                if (this.tracker === null)
                    this.tracker = new DoorTracker({ now: () => Date.now() });
                const ctx = { ...agent.homeContext(), log: (text) => console.log(text) }; // not into the output of the action
                closeDoorsBehind(agent.bot, this.tracker, ctx).catch(error => console.warn('Could not close a door:', error));
            } catch (error) {
                console.warn('Mode door_closing failed:', error);
            }
        }
    }
];

function addHomeModes() {
    if (!settings.home_pack)
        return;
    const reflexes = settings.home_reflexes !== null && typeof settings.home_reflexes === 'object' ? settings.home_reflexes : {};
    const wanted = home_modes.filter(mode => reflexes[mode.name] !== false && !modes_map[mode.name]);
    // creeper_safety and night_shelter directly after self_preservation, door_closing at the end
    const after = modes_list.findIndex(mode => mode.name === 'self_preservation') + 1;
    modes_list.splice(after, 0, ...wanted.filter(mode => mode.name !== 'door_closing'));
    modes_list.push(...wanted.filter(mode => mode.name === 'door_closing'));
    for (const mode of wanted)
        modes_map[mode.name] = mode;
}

async function execute(mode, agent, func, timeout=-1) {
    if (agent.self_prompter.isActive())
        agent.self_prompter.stopLoop();
    let interrupted_action = agent.actions.currentActionLabel;
    mode.active = true;
    let code_return = await agent.actions.runAction(`mode:${mode.name}`, async () => {
        await func();
    }, { timeout });
    mode.active = false;
    console.log(`Mode ${mode.name} finished executing, code_return: ${code_return.message}`);

    let should_reprompt = 
        interrupted_action && // it interrupted a previous action
        !agent.actions.resume_func && // there is no resume function
        !agent.self_prompter.isActive() && // self prompting is not on
        !code_return.interrupted; // this mode action was not interrupted by something else

    if (should_reprompt) {
        // auto prompt to respond to the interruption
        let role = convoManager.inConversation() ? agent.last_sender : 'system';
        let logs = agent.bot.modes.flushBehaviorLog();
        agent.handleMessage(role, `(AUTO MESSAGE)Your previous action '${interrupted_action}' was interrupted by ${mode.name}.
        Your behavior log: ${logs}\nRespond accordingly.`);
    }
}

let _agent = null;
const modes_map = {};
for (let mode of modes_list) {
    modes_map[mode.name] = mode;
}

class ModeController {
    /*
    SECURITY WARNING:
    ModesController must be reference isolated. Do not store references to external objects like `agent`.
    This object is accessible by LLM generated code, so any stored references are also accessible.
    This can be used to expose sensitive information by malicious prompters.
    */
    constructor() {
        this.behavior_log = '';
    }

    exists(mode_name) {
        return modes_map[mode_name] != null;
    }

    setOn(mode_name, on) {
        modes_map[mode_name].on = on;
    }

    isOn(mode_name) {
        return modes_map[mode_name].on;
    }

    pause(mode_name) {
        modes_map[mode_name].paused = true;
    }

    unpause(mode_name) {
        const mode = modes_map[mode_name];
        //if  unpause func is defined and mode is currently paused
        if (mode.unpause && mode.paused) {
            mode.unpause();
        }
        mode.paused = false;
    }

    unPauseAll() {
        for (let mode of modes_list) {
            if (mode.paused) console.log(`Unpausing mode ${mode.name}`);
            this.unpause(mode.name);
        }
    }

    getMiniDocs() { // no descriptions
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on})`;
        }
        return res;
    }

    getDocs() {
        let res = 'Agent Modes:';
        for (let mode of modes_list) {
            let on = mode.on ? 'ON' : 'OFF';
            res += `\n- ${mode.name}(${on}): ${mode.description}`;
        }
        return res;
    }

    async update() {
        if (_agent.isIdle()) {
            this.unPauseAll();
        }
        for (let mode of modes_list) {
            let interruptible = mode.interrupts.some(i => i === 'all') || mode.interrupts.some(i => i === _agent.actions.currentActionLabel);
            if (mode.on && !mode.paused && !mode.active && (_agent.isIdle() || interruptible)) {
                await mode.update(_agent);
            }
            if (mode.active) break;
        }
    }

    flushBehaviorLog() {
        const log = this.behavior_log;
        this.behavior_log = '';
        return log;
    }

    getJson() {
        let res = {};
        for (let mode of modes_list) {
            res[mode.name] = mode.on;
        }
        return res;
    }

    loadJson(json) {
        for (let mode of modes_list) {
            if (json[mode.name] != undefined) {
                mode.on = json[mode.name];
            }
        }
    }
}

export function initModes(agent) {
    _agent = agent;
    addHomeModes(); // v0.1.4.6: before the profile sets which modes are on
    // the mode controller is added to the bot object so it is accessible from anywhere the bot is used
    agent.bot.modes = new ModeController();
    if (agent.task) {
        agent.bot.restrict_to_inventory = agent.task.restrict_to_inventory;
    }
    let modes_json = agent.prompter.getInitModes();
    if (modes_json) {
        agent.bot.modes.loadJson(modes_json);
    }
}
