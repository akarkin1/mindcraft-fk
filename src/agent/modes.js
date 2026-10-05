import * as skills from './library/skills.js';
import { holdOnLadder } from './library/ladder_pass.js';
import * as world from './library/world.js';
import * as mc from '../utils/mcdata.js';
import settings from './settings.js'
import convoManager from './conversation.js';
import { withKillTimer, withTimeLimit } from '../utils/kill_timer.js';
import { DoorTracker, closeDoorsBehind, isInShelter, isNight, shouldShelter, nightShelterRoutine, creeperCheck, runCreeperProcedure, findShelter } from './packs/home/index.js';
// v0.1.4.8: functions of the home pack that come with part C (createDoorService, hungerStep); always called with ?.
import * as home from './packs/home/index.js';
import { STUCK_RULES, STUCK_TEXT, FREE_TEXT, KILL_TEXT, newStuckState, stuckStep, inventoryKey, distance, escapeOutcome, restartAfter,
    failureStep, giveUpEnds, nearestOpenable, stuckText, isLegacyEscape, escapeLimitMs, legacyOutcome } from './reflex/stuck_logic.js';
import { whereAmI, areaAt, blockNameReader } from './reflex/where_am_i.js';
import { mayTryItem, afterItemTry, isOwnDropSpawn, isRecentOwnDrop } from './reflex/item_logic.js';
import { STARVING_TEXT, STARVING_LOG_MS, HOSTILE_RANGE, PLAYER_RANGE, isHungerDamage, shouldRetreat, hurtText, retreatTarget } from './reflex/health_logic.js';
import { HOLE_RULES, holeAt, escapeSides, walkControls, leftHole } from './reflex/hole_logic.js';
import { sleepIsProgress } from './reflex/wake_logic.js';
import { keepOutAreas, keptOutBy, itemNameOf, leaveText, mayLeaveText } from './areas/keep_out_logic.js';
import { collectItems } from './areas/keep_out.js';
// v0.1.4.13 (part Q): the drops the item reflex leaves (Q5 the bot's own tosses, Q6 death drops and the armour rule) and
// the pens before anyone saves them (Q8)
import { watchDrops, leftAlone, takeLeaveText, deathDropAtFeet, stepAwayFromAll, deathDropsNear, deathNearBot } from './reflex/drop_watch.js';
import { leaveThingsText } from './reflex/drop_logic.js';
import { installPenGuard, pensNear } from './areas/pen_gate.js';
import { newSenseState, senseTick } from './areas/area_sense.js';

async function say(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    if (agent.shut_up || !settings.narrate_behavior) return;
    agent.openChat(message);
}

// v0.1.4.8: a line only for the behaviour log (the model reads it with the next message) and the console.
function note(agent, message) {
    agent.bot.modes.behavior_log += message + '\n';
    console.log(message);
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
        starving_noted_at: 0, // v0.1.4.8, A9: when 'I am starving.' went into the behaviour log
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
                if (isStarving(bot, block, blockAbove)) {
                    // v0.1.4.8, A9: running away does not help against hunger; the hunger reflex feeds the bot
                    if (Date.now() - this.starving_noted_at >= STARVING_LOG_MS) {
                        this.starving_noted_at = Date.now();
                        note(agent, STARVING_TEXT);
                    }
                    return;
                }
                say(agent, 'I\'m dying!');
                execute(this, agent, async () => {
                    await skills.moveAway(bot, 20);
                });
            }
            else if (agent.isIdle() && !holdOnLadder(bot)) {
                // clear jump if not in danger or doing anything else. F36 of the journeys: a bot that hangs on a
                // ladder between two orders holds on with sneak instead (holdOnLadder), else it slid in the gap
                bot.clearControlStates();
            }
        }
    },
    {
        name: 'unstuck',
        description: 'Attempt to get unstuck when in the same place for a while. Interrupts some actions.',
        interrupts: ['all'],
        on: true,
        active: false,
        state: newStuckState(), // v0.1.4.8, A1: see stuckStep of reflex/stuck_logic.js
        failed_escapes: 0, // A2: failed escapes in a row
        failed_at: null, // where the last escape failed; 2 blocks away from it the row ends
        given_up: null, // { pos, serial }: the reflex gave up there, while the command number serial ran
        action_serial: null, // v0.1.4.8, X3: the action (ActionManager.action_serial) the stuck time belongs to
        update: async function (agent) {
            const bot = agent.bot;
            const pos = bot.entity.position;
            if (this.failed_at && distance(pos, this.failed_at) >= STUCK_RULES.moveBlocks) {
                this.failed_escapes = 0; // the bot got away by another way
                this.failed_at = null;
            }
            if (this.given_up) {
                if (!giveUpEnds(this.given_up, { pos, serial: commandSerial(agent) }))
                    return; // paused until a new command starts or the bot moved 2 blocks
                this.given_up = null;
                this.state = newStuckState();
            }
            if (agent.isIdle()) {
                this.state = newStuckState();
                return; // don't get stuck when idle
            }
            // v0.1.4.8, X3: the stuck time starts from zero when a new action starts, so a new command always
            // has its full 20 s (also after the reflex gave up)
            const serial = actionSerial(agent);
            if (serial !== this.action_serial) {
                this.action_serial = serial;
                this.state = newStuckState();
            }
            const step = stuckStep(this.state, stuckSample(bot, agent.actions?.currentActionLabel), Date.now());
            this.state = step.state;
            if (step.stuck) {
                say(agent, STUCK_TEXT);
                const from = pos.clone();
                execute(this, agent, async () => {
                    await escape(this, agent, from);
                });
            }
        },
        unpause: function () {
            this.state = newStuckState();
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
                if (shouldRetreat(agent.bot.health, settings.flee_below_health ?? 0)) {
                    // v0.1.4.8, A10: too hurt to fight
                    note(agent, hurtText(agent.bot.health));
                    execute(this, agent, async () => {
                        await retreat(agent);
                    });
                    return;
                }
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
        noticed_at: -1,
        tries: new Map(), // v0.1.4.8, A8: entity id -> { tries, nextAt, done } (see reflex/item_logic.js)
        own_drops: new Map(), // entity id -> when the bot dropped it
        left_said_at: null, // v0.1.4.10, R1: when the text about an item left in a pen was said
        left_items: new Set(), // the item entities that text was said for
        stepped: new Set(), // v0.1.4.13 (Q6): the death drops the bot stepped away from
        update: async function (agent) {
            const now = Date.now();
            forgetItems(this, agent.bot, now);
            if (ownDropNear(this, agent.bot, 8)) {
                this.noticed_at = -1;
                return; // the walk takes every item within 8 blocks: nothing while the bot's own drop lies there
            }
            // v0.1.4.13 (Q6): a player's death drop at the bot's feet: it steps away before the server gives it the item
            if (stepFromDeathDrop(this, agent)) {
                this.noticed_at = -1;
                return;
            }
            // v0.1.4.13 (Q6, the lead after W115): near a fresh death the reflex picks up nothing, so no walk passes
            // over the drops; the leave text is said once for the drops it sees
            if (deathNearBot(agent.bot, 8)) {
                for (const entity of Object.values(agent.bot.entities ?? {})) {
                    if (entity?.name === 'item' && entity.position && agent.bot.entity?.position?.distanceTo?.(entity.position) <= 8)
                        leftByRule(agent, entity); // the leave text, once per death
                }
                this.noticed_at = -1;
                return;
            }
            // v0.1.4.10, R1: an item in a pen, a farm or a no_enter area that the bot is outside of is left
            const keepOut = keepOutOf(agent);
            noteLeftItem(this, agent, keepOut, now);
            // v0.1.4.13 (Q5, Q6): an item the bot tossed in the last 30 s and a player's death drops are left
            let item = world.getNearestEntityWhere(agent.bot, entity => entity.name === 'item' && mayTryItem(this.tries.get(entity.id), now)
                && !keptOutBy(keepOut, entity.position) && !leftByRule(agent, entity), 8);
            let empty_inv_slots = agent.bot.inventory.emptySlotCount();
            if (item && await world.isClearPath(agent.bot, item) && empty_inv_slots > 1) {
                if (this.tries.has(item.id)) {
                    pickUpItem(this, agent, item); // a try again: the 3 s after the last try are over
                    this.noticed_at = -1;
                    return;
                }
                if (this.noticed_at === -1) {
                    this.noticed_at = now;
                }
                if (now - this.noticed_at > this.wait * 1000) {
                    say(agent, `Picking up item!`);
                    pickUpItem(this, agent, item);
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

// v0.1.4.8, A1: what the mode unstuck sees of the bot in one tick (see stuckStep of reflex/stuck_logic.js).
// X5: sleeping is progress only while !goToBed (or the night reflex) runs; a command that runs while the
// bot still lies in bed is stuck (label: the running action).
function stuckSample(bot, label = '') {
    const dig = bot.targetDigBlock;
    return {
        pos: bot.entity.position,
        digTarget: dig ? { name: dig.name, position: dig.position } : null,
        inventoryKey: inventoryKey(bot.inventory?.slots),
        windowOpen: Boolean(bot.currentWindow),
        sleeping: Boolean(bot.isSleeping) && sleepIsProgress(label),
        usingItem: Boolean(bot.usingHeldItem),
        notedAt: bot.modes?.progress_at ?? 0,
        searching: bot.searching === true, // v0.1.4.11 (F15): the walk to the player thinks, it is not stuck
    };
}

// The number of the last command that started (ActionManager.command_serial).
function commandSerial(agent) {
    return agent.actions?.command_serial ?? 0;
}

// v0.1.4.8, X3: the number of the last action that really started (ActionManager.action_serial), else the
// label of the running action.
function actionSerial(agent) {
    const serial = agent.actions?.action_serial;
    return Number.isFinite(serial) ? serial : (agent.actions?.currentActionLabel ?? '');
}

// The hard stop of the path search (a goto rejects at once). Never throws.
function stopWalking(bot) {
    try {
        bot.pathfinder?.setGoal?.(null);
    } catch (error) {
        console.warn('Could not stop the path search:', error);
    }
}

// Waits up to ms for the bot to be 2 blocks from `from` (a teleport of the cheat mode arrives a little later).
async function waitForMove(bot, from, ms) {
    const end = Date.now() + ms;
    while (distance(bot.entity.position, from) < STUCK_RULES.moveBlocks && Date.now() < end && !bot.interrupt_code)
        await new Promise(resolve => setTimeout(resolve, 100));
}

// v0.1.4.8, A2: the escape of the mode unstuck, moveAway(5); an interrupt (!stop, a newer action) ends it
// at once. With stuck_restart_after 1 it is judged as in v0.1.4.7 (legacyEscape). Otherwise: a time
// limit of 20 s; free: 'I'm free.' and the row of failed escapes ends; a failure (time over, an error,
// still within 2 blocks) first gets the last step of X1 (out of a hole or a hollow block by hand, see
// holeEscape), then either ends the process (stuck_restart_after reached, 0 never) or the reflex
// gives up: it stops the path search, writes where the bot is stuck into the behaviour log (execute
// tells the model) and pauses itself until a new command starts or the bot moved 2 blocks.
async function escape(mode, agent, from) {
    const bot = agent.bot;
    const limit = restartAfter(settings.stuck_restart_after ?? 1);
    if (isLegacyEscape(limit)) {
        await legacyEscape(mode, agent);
        return;
    }
    let walk = null; // the walk of moveAway, kept for the last step (X1): it may still run when the time is over
    const result = await withTimeLimit(escapeLimitMs(limit), () => (walk = skills.moveAway(bot, STUCK_RULES.escapeDistance)),
        { until: () => bot.interrupt_code, pollMs: 250 });
    const threw = result.done && 'error' in result;
    if (!result.done)
        stopWalking(bot); // the time is over or a stop came: the walk must not go on
    if (threw)
        console.warn('The escape of unstuck failed:', result.error?.message ?? result.error);
    if (result.done && !threw && !bot.interrupt_code)
        await waitForMove(bot, from, 1000);
    const outcome = escapeOutcome({ done: result.done, error: threw, interrupted: Boolean(bot.interrupt_code), from, to: bot.entity.position });
    if (outcome === 'stopped')
        return;
    if (outcome === 'free') {
        mode.failed_escapes = 0;
        mode.failed_at = null;
        say(agent, FREE_TEXT);
        return;
    }
    // v0.1.4.8, X1: the last step before the reflex gives up, for a bot in a hole or a hollow block
    if (await holeEscape(agent, result.done ? null : walk)) {
        mode.failed_escapes = 0;
        mode.failed_at = null;
        say(agent, FREE_TEXT);
        return;
    }
    if (bot.interrupt_code)
        return; // a stop came during the last step: no failure
    const failure = failureStep(mode.failed_escapes, limit);
    const pos = bot.entity.position.clone();
    mode.failed_escapes = failure.count;
    mode.failed_at = pos;
    if (failure.kill) {
        agent.cleanKill(KILL_TEXT);
        return;
    }
    stopWalking(bot);
    mode.given_up = { pos, serial: commandSerial(agent) };
    note(agent, stuckText({ pos, area: areaAt(bot, pos), door: nearestOpenable(blockNameReader(bot), pos, STUCK_RULES.doorRange) }));
}

const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// True when somebody asked the action manager to stop the running action (the escape): someone noted
// who stops it, or a new action or a stop from outside took a ticket since `ticket` (X3).
function stopAsked(agent, ticket) {
    const actions = agent.actions;
    return (typeof actions?.stopped_by === 'string' && actions.stopped_by !== '') || actions?.start_ticket !== ticket;
}

// v0.1.4.8, X1: one try towards a side: look there, jump and walk forward about 1 s by the controls
// (walkControls), then wait until the bot stands on the ground again. stopped() ends it at once.
async function jumpTowards(bot, hole, side, stopped) {
    try {
        await bot.look(side.yaw, 0, true);
    } catch (error) {
        console.warn('Could not turn to the side:', error?.message ?? error);
    }
    const start = Date.now();
    while (!stopped()) {
        const controls = walkControls({ hole, pos: bot.entity.position, onGround: bot.entity.onGround, elapsedMs: Date.now() - start });
        bot.setControlState('forward', controls.forward);
        bot.setControlState('jump', controls.jump);
        if (controls.done)
            break;
        await pause(HOLE_RULES.tickMs);
    }
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    const landing = Date.now();
    while (!stopped() && bot.entity.onGround === false && Date.now() - landing < HOLE_RULES.landMs)
        await pause(HOLE_RULES.tickMs);
}

// v0.1.4.8, X1: the last step of the escape before the reflex gives up. A bot in a hole of one block or
// inside a hollow block (a composter, a cauldron: the path search cannot plan from there) jumps and walks
// towards each side in turn whose column is safe (no lava, fire, or drop of more than 3 blocks; see
// escapeSides of reflex/hole_logic.js), and after each try looks whether it got out (leftHole). walk: the
// walk of moveAway when it may still run (its time was over): the interrupt flag stays set during the
// whole step, so that walk and its door help end and start no new walk while the bot is steered by hand;
// the flag is given back afterwards, unless a real stop came. true when the bot got out. A stop (a new
// action, !stop) ends it at once.
async function holeEscape(agent, walk) {
    const bot = agent.bot;
    const read = blockNameReader(bot);
    const from = bot.entity.position.clone();
    const hole = holeAt(read, from);
    if (!hole)
        return false;
    const sides = escapeSides(read, from);
    console.log(`The escape: I am in ${hole.kind === 'hollow' ? `a ${hole.block}` : 'a hole'} at (${hole.x}, ${hole.y}, ${hole.z}); ${sides.length} safe sides to jump to.`);
    if (sides.length === 0)
        return false;
    const was = Boolean(bot.interrupt_code);
    const ticket = agent.actions?.start_ticket;
    const stopped = () => stopAsked(agent, ticket) || (!walk && Boolean(bot.interrupt_code));
    try {
        if (walk) {
            bot.interrupt_code = true; // goToGoal and the door help of moveAway end at once
            stopWalking(bot);
            await withTimeLimit(HOLE_RULES.endWalkMs, () => walk, { until: stopped, pollMs: 100 });
            stopWalking(bot);
        }
        for (const side of sides) {
            if (stopped())
                return false;
            await jumpTowards(bot, hole, side, stopped);
            if (leftHole(read, hole, from, bot.entity.position, bot.entity.onGround)) {
                console.log(`The escape: I jumped out towards (${side.x}, ${side.landY}, ${side.z}).`);
                return true;
            }
        }
    } catch (error) {
        console.warn('The last step of the escape failed:', error?.message ?? error);
    } finally {
        try {
            bot.clearControlStates();
        } catch (error) {
            // nothing to release
        }
        if (walk)
            bot.interrupt_code = was || stopped();
    }
    return false;
}

// The escape of v0.1.4.7, for stuck_restart_after 1 (decision of the tech lead: "1: as today"). The
// timer of 10 s ends the process; an error of moveAway is passed on to the action manager; a moveAway
// that returns says "I'm free.", wherever the bot stands. New in v0.1.4.8 only: an interrupt ends the
// wait at once and stops the path search, so !stop during the escape ends no process.
async function legacyEscape(mode, agent) {
    const bot = agent.bot;
    const result = await withKillTimer(() => { agent.cleanKill(KILL_TEXT) }, STUCK_RULES.escapeMs,
        () => withTimeLimit(0, () => skills.moveAway(bot, STUCK_RULES.escapeDistance), { until: () => bot.interrupt_code, pollMs: 250 }));
    const outcome = legacyOutcome({ ...result, error: result.done && 'error' in result, interrupted: Boolean(bot.interrupt_code) });
    if (outcome === 'stopped') {
        stopWalking(bot);
        return;
    }
    if (outcome === 'throw')
        throw result.error;
    mode.failed_escapes = 0;
    mode.failed_at = null;
    say(agent, FREE_TEXT);
}

// v0.1.4.8, A9: the damage is hunger (food 0, no lava, fire or water over the head, no hostile mob within 16).
function isStarving(bot, block, blockAbove) {
    const names = [block?.name, blockAbove?.name];
    const flags = bot.entity?.metadata?.[0];
    return isHungerDamage({
        food: bot.food,
        inLava: names.includes('lava'),
        inFire: names.includes('fire') || names.includes('soul_fire'),
        burning: typeof flags === 'number' && (flags & 0x01) === 0x01,
        waterOverHead: blockAbove?.name === 'water',
        hostileNear: Boolean(world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), HOSTILE_RANGE)),
    });
}

// Where the bot is (I2): agent.whereAmI() of the glue when it exists, else the same functions here.
function whereOf(agent) {
    try {
        if (typeof agent.whereAmI === 'function')
            return agent.whereAmI() ?? whereAmI(agent.bot);
    } catch (error) {
        console.warn('Could not ask where the bot is:', error);
    }
    return whereAmI(agent.bot);
}

// v0.1.4.8, A10: the retreat of self_defense at low health: to the nearest player within 32 blocks, else
// into the shelter of the home pack (only while home_pack is on and it knows one), else moveAway(10).
async function retreat(agent) {
    const bot = agent.bot;
    const player = world.getNearestEntityWhere(bot, entity => entity.type === 'player' && entity.username !== bot.username, PLAYER_RANGE);
    let shelter = false;
    if (!player && settings.home_pack && typeof home.goToShelter === 'function') {
        const choice = home.findShelter?.(bot, agent.homeContext());
        shelter = choice?.kind === 'area' || choice?.kind === 'place';
    }
    const target = retreatTarget({ player: Boolean(player?.username), shelter });
    if (target === 'player') {
        await skills.goToPlayer(bot, player.username, 3);
    }
    else if (target === 'shelter') {
        const result = await home.goToShelter(bot, agent.homeContext());
        if (result?.text)
            skills.log(bot, result.text);
    }
    else {
        await skills.moveAway(bot, 10);
    }
}

// All items of the inventory, the off-hand included.
function itemCount(bot) {
    const slots = bot.inventory?.slots;
    if (Array.isArray(slots))
        return slots.reduce((sum, item) => sum + (item && Number.isFinite(item.count) ? item.count : 0), 0);
    return (bot.inventory?.items?.() ?? []).reduce((sum, item) => sum + (item?.count ?? 0), 0);
}

// v0.1.4.8, A8: picks up the items near the bot as the mode item_collecting. A pick-up that gained
// nothing is tried again after 3 s, at most 3 times (see reflex/item_logic.js).
// v0.1.4.10, R1: every walk, a try again too, keeps out of the fence gates and of the pens, farms and
// no_enter areas that the bot is outside of when it starts (areas/keep_out.js).
function pickUpItem(mode, agent, item) {
    const bot = agent.bot;
    const id = item.id;
    const record = mode.tries.get(id);
    const before = itemCount(bot);
    mode.tries.set(id, { tries: record?.tries ?? 0, nextAt: Infinity, done: false }); // no candidate while it runs
    execute(mode, agent, async () => {
        try {
            await collectItems(bot, { areas: keepOutOf(agent), first: item, log: (text) => skills.log(bot, text), allow: (entity) => leftAlone(bot, entity) === null });
        } finally {
            mode.tries.set(id, afterItemTry(record, itemCount(bot) > before, Date.now()));
        }
    });
}

// v0.1.4.10, R1: the pens, farms and no_enter areas of the bot's dimension that it is outside of. [] without areas.
// v0.1.4.13 (Q8): and the pens with animals the scan finds behind a gate within 8 blocks of the bot, saved or not (at most
// every 2 s; the scan behind a gate is kept 10 s).
const PEN_LOOK_MS = 2000;
const pens_seen = new WeakMap(); // bot -> { at, list }
function keepOutOf(agent) {
    try {
        const bot = agent.bot;
        const areas = agent.area_store?.list?.() ?? [];
        const now = Date.now();
        let seen = pens_seen.get(bot);
        if (!seen || now - seen.at >= PEN_LOOK_MS) {
            seen = { at: now, list: pensNear(bot) };
            pens_seen.set(bot, seen);
        }
        return keepOutAreas([...areas, ...seen.list], bot.entity.position, bot.game?.dimension);
    } catch (error) {
        return [];
    }
}

// v0.1.4.13 (Q5, Q6): true for an item the reflex leaves (tossed by the bot in the last 30 s, a player's death drop); for
// a death the text is said once, into the chat and the behaviour log. Never throws.
function leftByRule(agent, entity) {
    try {
        const why = leftAlone(agent.bot, entity);
        if (why?.why === 'death' && takeLeaveText(why.death)) {
            const text = leaveThingsText(why.death.name, why.death.at);
            if (typeof agent.sayText === 'function') {
                agent.bot.modes.behavior_log += text + '\n';
                agent.sayText(text);
            }
            else {
                say(agent, text);
            }
        }
        return why !== null;
    } catch (error) {
        return false;
    }
}

// v0.1.4.13 (Q6): a death drop within 2 blocks of the bot: the bot steps 4 blocks away from it, once per item, so that the
// server does not give it the item when its pickup delay is over. true when it steps.
function stepFromDeathDrop(mode, agent) {
    try {
        const bot = agent.bot;
        const drop = deathDropAtFeet(bot, mode.stepped);
        if (!drop)
            return false;
        mode.stepped.add(drop.id);
        leftByRule(agent, drop); // the text of the death, once
        // v0.1.4.13 fix 1 (W115): away from all the death's drops near, not from this one only: a step to its other side
        // passed over the other drops and the server gave them to the bot
        const points = [{ x: drop.position.x, y: drop.position.y, z: drop.position.z }, ...deathDropsNear(bot, 6)];
        execute(mode, agent, async () => {
            await stepAwayFromAll(bot, points, 4, 2000);
        });
        return true;
    } catch (error) {
        return false;
    }
}

// v0.1.4.10, R1: an item within 8 blocks that lies in such an area gets the text, once per item and at
// most once a minute; it goes into the chat and the behaviour log.
function noteLeftItem(mode, agent, keepOut, now) {
    if (keepOut.length === 0)
        return;
    try {
        const bot = agent.bot;
        const item = world.getNearestEntityWhere(bot, entity => entity.name === 'item' && keptOutBy(keepOut, entity.position) !== null, 8);
        if (!item || mode.left_items.has(item.id) || !mayLeaveText(mode.left_said_at, now))
            return;
        mode.left_items.add(item.id);
        mode.left_said_at = now;
        const text = leaveText(itemNameOf(item), keptOutBy(keepOut, item.position));
        if (typeof agent.sayText === 'function') {
            bot.modes.behavior_log += text + '\n';
            agent.sayText(text);
        }
        else {
            say(agent, text);
        }
    } catch (error) {
        // the text is a help, never a reason to stop the mode
    }
}

// Forgets the tries of items that are gone and the drops of the bot that are older than 10 s.
function forgetItems(mode, bot, now) {
    if (bot.entities && typeof bot.entities === 'object') {
        for (const id of mode.stepped ?? []) {
            if (!bot.entities[id])
                mode.stepped.delete(id);
        }
    }
    for (const [id, at] of mode.own_drops) {
        if (!isRecentOwnDrop(at, now))
            mode.own_drops.delete(id);
    }
    if (bot.entities && typeof bot.entities === 'object') {
        for (const id of mode.tries.keys()) {
            if (!bot.entities[id])
                mode.tries.delete(id);
        }
        for (const id of mode.left_items ?? []) {
            if (!bot.entities[id])
                mode.left_items.delete(id);
        }
    }
}

// True while an item that the bot dropped in the last 10 s lies within range (forgetItems left only those).
function ownDropNear(mode, bot, range) {
    for (const id of mode.own_drops.keys()) {
        const entity = bot.entities?.[id];
        if (entity?.position && entity.position.distanceTo(bot.entity.position) < range)
            return true;
    }
    return false;
}

// v0.1.4.8, A8: notes the items that the bot throws, when they appear. Once per bot.
const watched_bots = new WeakSet();
function watchOwnDrops(bot) {
    if (!bot || typeof bot.on !== 'function' || watched_bots.has(bot))
        return;
    watched_bots.add(bot);
    bot.on('entitySpawn', (entity) => {
        try {
            if (entity?.name === 'item' && isOwnDropSpawn(entity.position, bot.entity?.position))
                modes_map.item_collecting?.own_drops?.set(entity.id, Date.now());
        } catch (error) {
            // the item is collected as before
        }
    });
}

// True while a mode before `mode` in the list (a higher priority) runs an action.
function modeBeforeActive(mode) {
    for (const other of modes_list) {
        if (other === mode)
            return false;
        if (other.active)
            return true;
    }
    return false;
}

// v0.1.4.8, C4: said once per night when night_shelter finds no home
const NO_HOME_TEXT = 'I know no home. Tell me where home is.';

// v0.1.4.8, A3 and I8: the door service of the home pack, one per agent: the one of the glue
// (agent.door_service) when it exists, else one made here once and given to the glue in the same field.
// null with the home pack of v0.1.4.7.
function doorService(agent) {
    if (agent.door_service === undefined && typeof home.createDoorService === 'function') {
        const ctx = { ...agent.homeContext(), log: (text) => console.log(text) }; // not into the output of the action
        agent.door_service = home.createDoorService(agent.bot, ctx) ?? null;
    }
    return agent.door_service ?? null;
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
        // v0.1.4.8, A11: every 2 s hungerStep of the home pack (C2) decides: eat, fetch food from a known
        // chest, or say that there is no food. Eating runs beside the action; only the walk to a chest is
        // a mode action: hungerStep gets it as state.walk(fn), which runs fn through execute and resolves
        // true, or false without running fn while a mode before this one is active.
        name: 'hunger',
        description: 'Eat when hungry, fetch food from a known chest.',
        interrupts: ['all'],
        on: true,
        active: false,
        interval: 2000,
        last_step: 0,
        busy: false, // a step of hungerStep runs
        state: {}, // kept between the steps; hungerStep keeps its own notes in it
        update: function (agent) {
            try {
                const now = Date.now();
                if (this.busy || now - this.last_step < this.interval || typeof home.hungerStep !== 'function')
                    return;
                this.last_step = now;
                const bot = agent.bot;
                const ctx = typeof agent.packContext === 'function' ? agent.packContext() : agent.homeContext();
                Object.assign(this.state, {
                    now,
                    idle: agent.isIdle(),
                    playerOrder: Boolean(agent.last_order),
                    walk: async (fn) => {
                        if (modeBeforeActive(this))
                            return false; // a mode of higher priority runs (unstuck, self_defense ...): no walk now
                        await execute(this, agent, fn);
                        return true;
                    },
                });
                this.busy = true;
                Promise.resolve()
                    .then(() => home.hungerStep(bot, ctx, this.state))
                    .catch(error => console.warn('Mode hunger failed:', error))
                    .finally(() => { this.busy = false; });
            } catch (error) {
                this.busy = false;
                console.warn('Mode hunger failed:', error);
            }
        }
    },
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
        no_home_said: false, // v0.1.4.8: 'I know no home.' was said this night
        update: async function (agent) {
            try {
                const bot = agent.bot;
                const ctx = agent.homeContext();
                if (!isNight(bot.time.timeOfDay)) {
                    this.sheltered_at = null;
                    this.no_home_said = false;
                }
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
                if (whereOf(agent).underground)
                    return; // v0.1.4.8, A7: underground or in a mine the night reflex waits, with or without mining_pack
                const shelter = findShelter(bot, ctx);
                if (shelter?.kind !== 'area' && shelter?.kind !== 'place') {
                    // v0.1.4.8, A7 and C4: no home, nothing to do; the text once per night
                    if (!this.no_home_said) {
                        this.no_home_said = true;
                        say(agent, NO_HOME_TEXT);
                    }
                    return;
                }
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
        background: true, // v0.1.4.8, A3: updated on every tick, also while an action or another mode runs
        tracker: null,
        // without execute, so the running action goes on. With the door service of the home pack (I8) its
        // tick() does the work. Without it (v0.1.4.7), closeDoorsBehind feeds the DoorTracker and closes
        // the doors it returns; it does nothing while passThrough runs or while it still closes. It is
        // not awaited, so the update loop does not wait for the doors.
        update: function (agent) {
            try {
                const service = doorService(agent);
                if (typeof service?.tick === 'function') {
                    service.tick();
                    return;
                }
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

// v0.1.4.11 (P2): the area sense, added by initModes only with the setting area_sense (off by default). While the bot
// is idle it scans the enclosure it stands in and, once per enclosure per start, says what it seems to be when no
// saved area holds it (areas/area_sense.js). It never calls execute, so it interrupts nothing.
const area_sense_mode = {
    name: 'area_sense',
    description: 'Say what an unsaved enclosure you stand in seems to be. Does not interrupt actions.',
    interrupts: [],
    on: true,
    active: false,
    state: newSenseState(),
    update: function (agent) {
        try {
            const bot = agent.bot;
            const text = senseTick(this.state, bot, {
                now: Date.now(),
                idle: agent.isIdle(),
                areas: agent.area_store?.list?.() ?? [],
                floors: settings.area_floors === true,
                whereAmI: typeof agent.whereAmI === 'function' ? () => agent.whereAmI() : undefined, // v0.1.4.12 (F3): the mine
                tunnelAt: agent.work_packs?.mining?.tunnelAt, // v0.1.4.12 (F1): the measure of a tunnel, when the pack is loaded
            });
            if (!text)
                return;
            if (typeof agent.sayText === 'function') {
                bot.modes.behavior_log += text + '\n';
                agent.sayText(text);
            }
            else {
                say(agent, text);
            }
        } catch (error) {
            console.warn('Mode area_sense failed:', error);
        }
    }
};

function addSenseMode() {
    if (settings.area_sense !== true || !settings.protected_areas || modes_map.area_sense)
        return;
    const cheat = modes_list.findIndex(mode => mode.name === 'cheat');
    modes_list.splice(cheat >= 0 ? cheat : modes_list.length, 0, area_sense_mode);
    modes_map.area_sense = area_sense_mode;
}

function addHomeModes() {
    if (!settings.home_pack)
        return;
    const reflexes = settings.home_reflexes !== null && typeof settings.home_reflexes === 'object' ? settings.home_reflexes : {};
    const wanted = home_modes.filter(mode => reflexes[mode.name] !== false && !modes_map[mode.name]);
    // creeper_safety and night_shelter directly after self_preservation, hunger (v0.1.4.8) directly after
    // self_defense (decision of the tech lead: the modes before it may interrupt its walk to a chest, and
    // unstuck watches the walk), door_closing at the end
    const after = modes_list.findIndex(mode => mode.name === 'self_preservation') + 1;
    modes_list.splice(after, 0, ...wanted.filter(mode => mode.name === 'creeper_safety' || mode.name === 'night_shelter'));
    const hunger = wanted.filter(mode => mode.name === 'hunger');
    modes_list.splice(modes_list.findIndex(mode => mode.name === 'self_defense') + 1, 0, ...hunger);
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
        this.progress_at = 0; // v0.1.4.8, I1: the time of the last noteProgress
        this.progress_reason = '';
    }

    // v0.1.4.8, I1: a skill made progress (a chest opened, the path search moved ...). unstuck does not
    // count the time before it.
    noteProgress(reason) {
        this.progress_at = Date.now();
        this.progress_reason = typeof reason === 'string' ? reason : '';
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
        // v0.1.4.8, A3: a background mode is updated on every tick, also while another mode is active and
        // while an action runs. It never calls execute. The other modes keep the exclusive chain below.
        for (let mode of modes_list) {
            if (mode.background && mode.on && !mode.paused)
                await mode.update(_agent);
        }
        for (let mode of modes_list) {
            if (mode.background) continue;
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
    addSenseMode(); // v0.1.4.11 (P2)
    watchOwnDrops(agent.bot); // v0.1.4.8, A8
    // v0.1.4.13 (Q5, Q6, Q8): the deaths of players, the tosses of a give and the armour rule; the gates of the pens
    watchDrops(agent.bot);
    installPenGuard(agent.bot, {
        areas: () => agent.area_store?.list?.() ?? [],
        permits: () => agent.area_guard?.permits?.() ?? [],
        say: (text) => {
            agent.bot.modes.behavior_log += text + '\n';
            if (typeof agent.sayText === 'function')
                agent.sayText(text);
        },
    });
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
