import * as skills from '../library/skills.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { Vec3 } from 'vec3';
import { normalizeBox, contains, boxSize } from '../areas/area_geometry.js';
import { scanBuilding, scanFarm } from '../areas/area_scan.js';
import { goToShelter, sleepInBed, eatBestFood, enterBuilding } from '../packs/home/index.js';
import { REMEMBER_RULE_DESCRIPTION, rememberRuleReply, forgetRuleReply } from '../rules/rule_commands.js';


function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }

    return wrappedAction;
}

// The arguments of !useSkill: a JSON array as text, single quotes are accepted in place of
// double quotes, an empty text means no arguments. Returns null when the text is not an array.
function parseSkillArgs(text) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (trimmed === '')
        return [];
    for (const candidate of [trimmed, trimmed.replaceAll("'", '"')]) {
        try {
            const value = JSON.parse(candidate);
            if (Array.isArray(value))
                return value;
        } catch (error) {
            // not JSON in this form
        }
    }
    return null;
}

// Appends a line to a result text: trailing whitespace and line breaks of the text are removed
// first, so exactly one line break separates them.
function appendLine(text, line) {
    return String(text).trimEnd() + '\n' + line;
}

// Appends the notices of the skill manager to a result text, each on its own line, for example
// that a skill was switched off after errors in a row. With flags.reuse only.
function withSkillNotices(agent, text) {
    if (!agent.skill_manager)
        return text;
    try {
        if (agent.skill_manager.flags.reuse) {
            for (const notice of agent.skill_manager.takeNotices())
                text = appendLine(text, notice);
        }
    } catch (error) {
        console.warn('Could not read the notices of the skills:', error);
    }
    return text;
}

// false only while the cost meter is in the state saving (v0.1.4.6, G1). Never throws.
function costAllows(agent, what) {
    if (!agent.cost_meter)
        return true;
    try {
        return agent.cost_meter.allows(what) !== false;
    } catch (error) {
        console.warn('Could not ask the cost meter:', error);
        return true;
    }
}

// Runs fn as the action `action:<label>`, like runAsAction, and returns the text that fn returns
// (the replies of the home pack, v0.1.4.6). Without a text: the output of the action. Nothing when
// the action was interrupted.
async function runForText(agent, label, fn) {
    let text = null;
    const code_return = await agent.actions.runAction(`action:${label}`, async () => {
        text = await fn();
    }, { timeout: -1, resume: false });
    if (code_return.interrupted && !code_return.timedout)
        return;
    if (code_return.success && typeof text === 'string' && text !== '')
        return text;
    return code_return.message;
}

// The protected areas of v0.1.4.6 (section 6).
const AREAS_OFF = 'Protected areas are off.';
const AREA_TYPES = ['building', 'farm'];
const AREA_TYPE_TEXT = 'The type of an area is "building" or "farm".';
const pointText = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const countText = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "1 door" for a building, "1 gate" for a farm; the other kind only when there is one.
function entrancesText(area) {
    const entrances = Array.isArray(area.entrances) ? area.entrances : [];
    const doors = entrances.filter(e => e.kind !== 'gate').length;
    const gates = entrances.length - doors;
    const parts = area.type === 'farm' ? [countText(gates, 'gate')] : [countText(doors, 'door')];
    if (area.type === 'farm' && doors > 0)
        parts.push(countText(doors, 'door'));
    if (area.type !== 'farm' && gates > 0)
        parts.push(countText(gates, 'gate'));
    return parts.join(', ');
}

function sizeText(area) {
    const size = boxSize(area);
    return `${size.x} x ${size.y} x ${size.z} blocks`;
}

function areaSavedText(area) {
    return `Area "${area.name}" (${area.type}) saved: ${sizeText(area)}, from ${pointText(area.min)} to ${pointText(area.max)}, ${entrancesText(area)}.`;
}

function areaErrorText(error, name) {
    if (error instanceof RangeError)
        return 'That area is too big. An area has at most 64 x 48 x 64 blocks.';
    const length = typeof name === 'string' ? name.trim().length : 0;
    if (length < 1 || length > 64)
        return 'An area needs a name of 1 to 64 characters.';
    console.warn('Could not save the area:', error);
    return `Could not save the area "${name}".`;
}

// The name of the block at x, y, z for the scans, null when it is not loaded.
const blockNameOf = (bot) => (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null;

// v0.1.4.6, !rememberHere: the building around the bot as an area, when one is found and no area of
// that name exists. Returns the sentence for the reply, or null. Never throws.
function saveBuildingAround(agent, name) {
    try {
        const store = agent.area_store;
        if (!store || store.get(name))
            return null;
        const bot = agent.bot;
        const scan = scanBuilding(blockNameOf(bot), bot.entity.position);
        if (!scan?.found)
            return null;
        const area = store.set({ name, type: 'building', min: scan.min, max: scan.max, dimension: bot.game?.dimension,
            entrances: scan.entrances ?? [], source: 'scan' });
        return `I also saved the building around it as a protected area: ${sizeText(area)}, ${entrancesText(area)}.`;
    } catch (error) {
        console.warn('Could not save the building around the place:', error);
        return null;
    }
}

// v0.1.4.6, H7: with the home pack and protected areas, a place inside a building area is entered
// with enterBuilding of the home pack: through the entrance nearest to the bot with passThrough,
// which closes the door behind it. Never throws.
async function enterBuildingAround(agent, pos, dimension) {
    if (!settings.home_pack || !agent.area_store)
        return;
    try {
        const bot = agent.bot;
        const area = agent.area_store.areasAt({ x: pos[0], y: pos[1], z: pos[2] }, dimension).find(a => a.type === 'building');
        if (!area)
            return;
        const result = await enterBuilding(bot, area, agent.homeContext());
        if (!result?.ok && result?.text)
            skills.log(bot, result.text);
    } catch (error) {
        console.warn('Could not enter the building through the door:', error);
    }
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            if (!costAllows(agent, 'coding'))
                return 'I reached my cost limit and do not write new code now. Use the commands I have.';
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            if (agent.skill_manager && agent.coder.last_run != null) {
                try {
                    const capture = await agent.skill_manager.captureFromRun(agent.coder.last_run);
                    if (typeof capture.message === 'string' && capture.message !== '')
                        result = appendLine(result, capture.message);
                } catch (error) {
                    console.warn('Could not save the code as a skill:', error);
                }
            }
            return withSkillNotices(agent, result);
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.last_order = null; // v0.1.4.6, G3
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity], default: 3}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity], default: 4}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity], default: 1}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512], default: 64 }
        },
        perform: runAsAction(async (agent, block_type, range) => {
            if (range < 32) {
                skills.log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            await skills.goToNearestBlock(agent.bot, block_type, 4, range);
        })
    },
    {
        name: '!searchForEntity',
        description: 'Find and go to the nearest entity of a given type in a given range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512], default: 64 }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            const saved = agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z, agent.bot.game?.dimension);
            if (saved === false)
                return `Could not save the location "${name}".`;
            if (agent.area_store) {
                const building = saveBuildingAround(agent, name);
                if (building)
                    return `Location saved as "${name}". ${building}`;
            }
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            const place_dimension = agent.memory_bank.recallPlaceInfo?.(name)?.dimension;
            const current_dimension = agent.bot.game?.dimension;
            if (place_dimension && typeof current_dimension === 'string' && current_dimension !== '' && place_dimension !== current_dimension) {
                skills.log(agent.bot, `"${name}" is in the dimension ${place_dimension}, but you are in ${current_dimension}. You cannot travel between dimensions by yourself.`);
                return;
            }
            if (settings.home_pack && agent.area_store) {
                await enterBuildingAround(agent, pos, place_dimension ?? current_dimension);
                if (agent.bot.interrupt_code)
                    return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!forgetPlace',
        description: 'Delete a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to forget.' }},
        perform: async function (agent, name) {
            if (agent.memory_bank.forgetPlace(name))
                return `Forgot the place "${name}".`;
            return `No location named "${name}" saved.`;
        }
    },
    {
        name: '!nameWorld',
        description: 'Give the current world a name, so you recognize it when you come back.',
        params: {'name': { type: 'string', description: 'The name to give the world.' }},
        perform: async function (agent, name) {
            if (!agent.world_memory)
                return 'World memory is off.';
            try {
                if (agent.world_memory.setLabel(name))
                    return `This world is now called "${name}".`;
            } catch (error) {
                console.warn('Could not name the world:', error);
            }
            return 'Could not name the world.';
        }
    },
    {
        name: '!rememberArea',
        description: 'Remember the building or the fenced farm you are standing in as a protected area. In a building you will not break or place blocks. In a farm you will only plant and harvest. Use this when the player says "this is home", "this is our base", "this is the farm", or tells you not to damage a place.',
        params: {
            'name': { type: 'string', description: 'The name of the area, for example "home".' },
            'type': { type: 'string', description: 'The type of the area: "building" or "farm".', default: 'building' }
        },
        perform: async function (agent, name, type) {
            const store = agent.area_store;
            if (!store)
                return AREAS_OFF;
            if (!AREA_TYPES.includes(type))
                return AREA_TYPE_TEXT;
            try {
                const bot = agent.bot;
                const origin = bot.entity.position;
                const dimension = bot.game?.dimension;
                const scan = type === 'farm' ? scanFarm(blockNameOf(bot), origin) : scanBuilding(blockNameOf(bot), origin);
                if (scan?.found) {
                    const area = store.set({ name, type, min: scan.min, max: scan.max, dimension, entrances: scan.entrances ?? [], source: 'scan' });
                    return `${areaSavedText(area)} Tell me if that is wrong.`;
                }
                if (type === 'farm')
                    return 'I found no fenced ground here. Stand inside the fence and try again.';
                // no building found: a box around the bot, 12 blocks in x and z, 4 below and 8 above
                const x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
                const box = normalizeBox({ x: x - 12, y: y - 4, z: z - 12 }, { x: x + 12, y: y + 8, z: z + 12 });
                const area = store.set({ name, type, min: box.min, max: box.max, dimension, entrances: [], source: 'radius' });
                return `I found no building here. I saved a box of ${sizeText(area)} around this place as "${area.name}". Use !setArea to correct it.`;
            } catch (error) {
                return areaErrorText(error, name);
            }
        }
    },
    {
        name: '!setArea',
        description: 'Save a protected area with the given corners, or correct a saved one.',
        params: {
            'name': { type: 'string', description: 'The name of the area.' },
            'type': { type: 'string', description: 'The type of the area: "building" or "farm".' },
            'x1': { type: 'float', description: 'The x coordinate of one corner.', domain: [-Infinity, Infinity] },
            'y1': { type: 'float', description: 'The y coordinate of one corner.', domain: [-64, 320] },
            'z1': { type: 'float', description: 'The z coordinate of one corner.', domain: [-Infinity, Infinity] },
            'x2': { type: 'float', description: 'The x coordinate of the opposite corner.', domain: [-Infinity, Infinity] },
            'y2': { type: 'float', description: 'The y coordinate of the opposite corner.', domain: [-64, 320] },
            'z2': { type: 'float', description: 'The z coordinate of the opposite corner.', domain: [-Infinity, Infinity] }
        },
        perform: async function (agent, name, type, x1, y1, z1, x2, y2, z2) {
            const store = agent.area_store;
            if (!store)
                return AREAS_OFF;
            if (!AREA_TYPES.includes(type))
                return AREA_TYPE_TEXT;
            try {
                const box = normalizeBox({ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 });
                // the doors of a saved area of that name stay when they are inside the new box
                const entrances = (store.get(name)?.entrances ?? []).filter(e => contains(box, e));
                const area = store.set({ name, type, min: box.min, max: box.max, dimension: agent.bot.game?.dimension, entrances, source: 'manual' });
                return areaSavedText(area);
            } catch (error) {
                return areaErrorText(error, name);
            }
        }
    },
    {
        name: '!forgetArea',
        description: 'Delete a protected area.',
        params: {'name': { type: 'string', description: 'The name of the area to forget.' }},
        perform: async function (agent, name) {
            const store = agent.area_store;
            if (!store)
                return AREAS_OFF;
            try {
                if (store.remove(name))
                    return `Forgot the area "${name}".`;
            } catch (error) {
                console.warn('Could not forget the area:', error);
            }
            return `No area named "${name}" is saved.`;
        }
    },
    {
        name: '!allowChanges',
        description: 'Allow yourself to break and place blocks in a protected area for some minutes. Use this ONLY when the player tells you to build, repair or break something inside that area.',
        params: {
            'name': { type: 'string', description: 'The name of the area.' },
            'minutes': { type: 'int', description: 'For how many minutes, at most 60.', domain: [1, 60, '[]'], default: 10 }
        },
        perform: async function (agent, name, minutes) {
            const store = agent.area_store;
            const guard = agent.area_guard; // the full guard: bot.areaGuard has no permit (Amendment 2, F2)
            if (!store || !guard)
                return AREAS_OFF;
            try {
                if (!store.get(name))
                    return `No area named "${name}" is saved.`;
                guard.permit(name, minutes);
                return `You may change blocks in "${name}" for ${minutes} minutes.`;
            } catch (error) {
                console.warn('Could not allow changes in the area:', error);
                return `Could not allow changes in "${name}".`;
            }
        }
    },
    {
        name: '!rememberRule',
        description: REMEMBER_RULE_DESCRIPTION,
        params: {'text': { type: 'string', description: 'The rule as one short sentence.' }},
        perform: async function (agent, text) {
            return rememberRuleReply(agent.rule_store, text); // never throws, also without a store
        }
    },
    {
        name: '!forgetRule',
        description: 'Delete a saved rule by its number.',
        params: {'number': { type: 'int', description: 'The number of the rule, as !rules shows it.' }},
        perform: async function (agent, number) {
            return forgetRuleReply(agent.rule_store, number); // never throws, also without a store
        }
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }
        },
        perform: runAsAction(async (agent, type, num) => {
            await skills.collectBlock(agent.bot, type, num);
        }, false, 10) // 10 minute timeout
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            if (success) {
                setTimeout(() => {
                    agent.cleanKill('Safely restarting to update inventory.');
                }, 500);
            }
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            let pos = agent.bot.entity.position;
            await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        // v0.1.4.6, H7: with the home pack another description and sleepInBed
        get description() {
            if (settings.home_pack)
                return 'Go to the nearest bed and sleep. Use this at night, or when the player says "sleep" or "go to bed".';
            return 'Go to the nearest bed and sleep.';
        },
        perform: async function (agent) {
            if (settings.home_pack)
                return await runForText(agent, 'goToBed', async () => (await sleepInBed(agent.bot, agent.homeContext()))?.text);
            return await runForText(agent, 'goToBed', async () => {
                await skills.goToBed(agent.bot);
            });
        }
    },
    {
        name: '!goToShelter',
        description: 'Go to your shelter, get in through the door and close it. Use this when night comes, when monsters are near, when the player says "get to shelter", "go home" or "go inside".',
        perform: async function (agent) {
            if (!settings.home_pack)
                return 'The home pack is off.';
            return await runForText(agent, 'goToShelter', async () => (await goToShelter(agent.bot, agent.homeContext()))?.text);
        }
    },
    {
        name: '!eat',
        description: 'Eat the best food you have. Use this when you are hungry or hurt, or when the player tells you to eat.',
        perform: async function (agent) {
            if (!settings.home_pack)
                return 'The home pack is off.';
            return await runForText(agent, 'eat', async () => (await eatBestFood(agent.bot, agent.homeContext()))?.text);
        }
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER], default: 30 }},
        perform: runAsAction(async (agent, seconds) => {
            await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            if (!costAllows(agent, 'self_prompt'))
                return 'I reached my cost limit and do not work on goals by myself now.';
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) the given tool on the nearest target of the given type.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
    {
        name: '!forgetSkill',
        description: 'Delete a saved skill.',
        params: {'name': { type: 'string', description: 'The name of the skill to forget.' }},
        perform: function (agent, name) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            try {
                if (agent.skill_manager.forget(name))
                    return `Forgot the skill "${name}".`;
            } catch (error) {
                console.warn('Could not forget the skill:', error);
            }
            return `No skill named "${name}" is saved.`;
        }
    },
    {
        name: '!disableSkill',
        description: 'Stop offering a saved skill without deleting it.',
        params: {'name': { type: 'string', description: 'The name of the skill to disable.' }},
        perform: function (agent, name) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            try {
                if (agent.skill_manager.setStatus(name, 'disabled'))
                    return `Disabled the skill "${name}".`;
            } catch (error) {
                console.warn('Could not disable the skill:', error);
            }
            return `No skill named "${name}" is saved.`;
        }
    },
    {
        name: '!enableSkill',
        description: 'Offer a disabled skill again.',
        params: {'name': { type: 'string', description: 'The name of the skill to enable.' }},
        perform: function (agent, name) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            try {
                if (agent.skill_manager.setStatus(name, 'active'))
                    return `Enabled the skill "${name}".`;
            } catch (error) {
                console.warn('Could not enable the skill:', error);
            }
            return `No skill named "${name}" is saved.`;
        }
    },
    {
        name: '!useSkill',
        description: 'Run a saved skill with the given values.',
        params: {
            'name': { type: 'string', description: 'The name of the saved skill.' },
            'args': { type: 'string', description: 'The values after bot as a list, for example "[3, \'oak_log\']". Empty for no values.' }
        },
        perform: async function (agent, name, args) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            // checked before runAction, so an unknown name does not stop the running action
            let known = false;
            try {
                known = agent.skill_manager.has(name);
            } catch (error) {
                console.warn('Could not look up the skill:', error);
            }
            if (!known)
                return `No skill named "${name}" is saved.`;
            const values = parseSkillArgs(args);
            if (values === null)
                return `Could not read the arguments. Write them as a list, for example "[3, 'oak_log']".`;
            let run = null;
            const actionFn = async () => {
                run = await agent.skill_manager.run(name, values, agent.bot);
            };
            const code_return = await agent.actions.runAction('action:useSkill', actionFn, {timeout: settings.code_timeout_mins});
            if (run?.error === 'unknown_skill')
                return withSkillNotices(agent, `No skill named "${name}" is saved.`);
            if (code_return.interrupted && !code_return.timedout)
                return;
            if (run && !run.ok && run.error)
                return withSkillNotices(agent, `The skill "${name}" failed: ${run.error}`);
            const output = code_return.message;
            if (!output || output.trim() === 'Action output:')
                return withSkillNotices(agent, `The skill "${name}" finished.`);
            return withSkillNotices(agent, output);
        }
    },
];
