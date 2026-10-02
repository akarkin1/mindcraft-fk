import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { getCommandDocs } from './index.js';
import convoManager from '../conversation.js';
import { checkLevelBlueprint, checkBlueprint } from '../tasks/construction_tasks.js';
import { load } from 'cheerio';
import settings from '../settings.js';
import { isNight } from '../packs/home/index.js';
import { rulesReply } from '../rules/rule_commands.js';

const pad = (str) => {
    return '\n' + str + '\n';
}

// queries are commands that just return strings and don't affect anything in the world
export const queryList = [
    {
        name: "!stats",
        description: "Get your bot's location, health, hunger, and time of day.", 
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'STATS';
            let pos = bot.entity.position;
            // display position to 2 decimal places
            res += `\n- Position: x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}`;
            if (agent.world_memory?.world) {
                res += `\n- World: ${agent.world_memory.world.label}`;
                res += `\n- Dimension: ${bot.game.dimension}`;
            }
            if (agent.area_store) { // v0.1.4.6, G5
                try {
                    const area = agent.area_store.areasAt(pos, bot.game.dimension)[0];
                    if (area)
                        res += `\n- Area: ${area.name} (${area.type}, protected)`;
                } catch (error) {
                    console.warn('Could not read the protected areas:', error);
                }
            }
            // Gameplay
            res += `\n- Gamemode: ${bot.game.gameMode}`;
            res += `\n- Health: ${Math.round(bot.health)} / 20`;
            res += `\n- Hunger: ${Math.round(bot.food)} / 20`;
            res += `\n- Biome: ${world.getBiomeName(bot)}`;
            let weather = "Clear";
            if (bot.rainState > 0)
                weather = "Rain";
            if (bot.thunderState > 0)
                weather = "Thunderstorm";
            res += `\n- Weather: ${weather}`;
            // let block = bot.blockAt(pos);
            // res += `\n- Artficial light: ${block.skyLight}`;
            // res += `\n- Sky light: ${block.light}`;
            // light properties are bugged, they are not accurate


            if (bot.time.timeOfDay < 6000) {
                res += '\n- Time: Morning';
            } else if (bot.time.timeOfDay < 12000) {
                res += '\n- Time: Afternoon';
            } else {
                res += '\n- Time: Night';
            }
            if (settings.home_pack && isNight(bot.time.timeOfDay)) // v0.1.4.6, G5
                res += '\n- It is night. Stay in the shelter until the morning unless a player tells you otherwise.';

            // get the bot's current action
            let action = agent.actions.currentActionLabel;
            if (agent.isIdle())
                action = 'Idle';
            res += `\n- Current Action: ${action}`;


            let players = world.getNearbyPlayerNames(bot);
            let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
            players = players.filter(p => !bots.includes(p));

            res += '\n- Nearby Human Players: ' + (players.length > 0 ? players.join(', ') : 'None.');
            res += '\n- Nearby Bot Players: ' + (bots.length > 0 ? bots.join(', ') : 'None.');

            res += '\n' + agent.bot.modes.getMiniDocs() + '\n';
            return pad(res);
        }
    },
    {
        name: "!inventory",
        description: "Get your bot's inventory.",
        perform: function (agent) {
            let bot = agent.bot;
            let inventory = world.getInventoryCounts(bot);
            let res = 'INVENTORY';
            for (const item in inventory) {
                if (inventory[item] && inventory[item] > 0)
                    res += `\n- ${item}: ${inventory[item]}`;
            }
            if (res === 'INVENTORY') {
                res += ': Nothing';
            }
            else if (agent.bot.game.gameMode === 'creative') {
                res += '\n(You have infinite items in creative mode. You do not need to gather resources!!)';
            }
            // v0.1.4.8 (E1, B2): what the off-hand holds, it is counted in the list above once
            const offhand = world.getOffhandText(bot);
            if (offhand)
                res += `\n${offhand}`;

            let helmet = bot.inventory.slots[5];
            let chestplate = bot.inventory.slots[6];
            let leggings = bot.inventory.slots[7];
            let boots = bot.inventory.slots[8];
            res += '\nWEARING: ';
            if (helmet)
                res += `\nHead: ${helmet.name}`;
            if (chestplate)
                res += `\nTorso: ${chestplate.name}`;
            if (leggings)
                res += `\nLegs: ${leggings.name}`;
            if (boots)
                res += `\nFeet: ${boots.name}`;
            if (!helmet && !chestplate && !leggings && !boots)
                res += 'Nothing';

            return pad(res);
        }
    },
    {
        name: "!nearbyBlocks",
        description: "Get the blocks near the bot.",
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'NEARBY_BLOCKS';
            let blocks = world.getNearestBlocks(bot);
            let block_details = new Set();
            
            for (let block of blocks) {
                let details = block.name;
                if (block.name === 'water' || block.name === 'lava') {
                    details += block.metadata === 0 ? ' (source)' : ' (flowing)';
                }
                block_details.add(details);
            }
            for (let details of block_details) {
                res += `\n- ${details}`;
            }
            if (block_details.size === 0) {
                res += ': none';
            } 
            else {
                res += '\n- ' + world.getSurroundingBlocks(bot).join('\n- ');
                res += `\n- First Solid Block Above Head: ${world.getFirstBlockAboveHead(bot, null, 32)}`;
            }
            return pad(res);
        }
    },
    {
        name: "!craftable",
        description: "List what could be crafted now; crafts nothing.",
        perform: function (agent) {
            let craftable = world.getCraftableItems(agent.bot);
            let res = 'CRAFTABLE_ITEMS';
            for (const item of craftable) {
                res += `\n- ${item}`;
            }
            if (res == 'CRAFTABLE_ITEMS') {
                res += ': none';
            }
            return pad(res);
        }
    },
    {
        name: "!entities",
        description: "Get the nearby players and entities.",
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'NEARBY_ENTITIES';
            let players = world.getNearbyPlayerNames(bot);
            let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
            players = players.filter(p => !bots.includes(p));

            for (const player of players) {
                res += `\n- Human player: ${player}`;
            }
            for (const bot of bots) {
                res += `\n- Bot player: ${bot}`;
            }

            let nearbyEntities = world.getNearbyEntities(bot);
            let entityCounts = {};
            let villagerIds = [];
            let babyVillagerIds = [];
            let villagerDetails = []; // Store detailed villager info including profession
            
            for (const entity of nearbyEntities) {
                if (entity.type === 'player' || entity.name === 'item')
                    continue;
                    
                if (!entityCounts[entity.name]) {
                    entityCounts[entity.name] = 0;
                }
                entityCounts[entity.name]++;
                
                if (entity.name === 'villager') {
                    if (entity.metadata && entity.metadata[16] === 1) {
                        babyVillagerIds.push(entity.id);
                    } else {
                        const profession = world.getVillagerProfession(entity);
                        villagerIds.push(entity.id);
                        villagerDetails.push({
                            id: entity.id,
                            profession: profession
                        });
                    }
                }
            }
            
            for (const [entityType, count] of Object.entries(entityCounts)) {
                if (entityType === 'villager') {
                    let villagerInfo = `${count} ${entityType}(s)`;
                    if (villagerDetails.length > 0) {
                        const detailStrings = villagerDetails.map(v => `(${v.id}:${v.profession})`);
                        villagerInfo += ` - Adults: ${detailStrings.join(', ')}`;
                    }
                    if (babyVillagerIds.length > 0) {
                        villagerInfo += ` - Baby IDs: ${babyVillagerIds.join(', ')} (babies cannot trade)`;
                    }
                    res += `\n- entities: ${villagerInfo}`;
                } else {
                    res += `\n- entities: ${count} ${entityType}(s)`;
                }
            }
            
            if (res == 'NEARBY_ENTITIES') {
                res += ': none';
            }
            return pad(res);
        }
    },
    {
        name: "!modes",
        description: "List the modes, what they do and which are on or off.",
        perform: function (agent) {
            return agent.bot.modes.getDocs();
        }
    },
    {
        name: '!savedPlaces',
        description: 'List all saved locations.',
        perform: async function (agent) {
            if (agent.memory_bank.hasStore)
                return "Saved places: " + agent.memory_bank.describePlaces();
            return "Saved place names: " + agent.memory_bank.getKeys();
        }
    }, 
    {
        name: '!skills',
        description: 'List your saved skills.',
        perform: function (agent) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            try {
                return agent.skill_manager.listText();
            } catch (error) {
                console.warn('Could not list the saved skills:', error);
                return 'Could not list the saved skills.';
            }
        }
    },
    {
        name: '!areas',
        description: 'List the protected areas of this world.',
        perform: function (agent) {
            const store = agent.area_store;
            if (!store)
                return 'Protected areas are off.';
            try {
                const areas = store.list();
                if (areas.length === 0)
                    return 'No areas are saved in this world.';
                const point = (p) => `(${p.x}, ${p.y}, ${p.z})`;
                const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
                const lines = ['Protected areas in this world:'];
                for (const area of areas) {
                    const entrances = Array.isArray(area.entrances) ? area.entrances : [];
                    const doors = entrances.filter(e => e.kind !== 'gate').length;
                    const gates = entrances.length - doors;
                    // "1 door" for a house, "1 gate" for a farm or a pen (v0.1.4.8); the other kind only when there is one
                    const gated = area.type === 'farm' || area.type === 'pen';
                    const parts = gated ? [count(gates, 'gate')] : [count(doors, 'door')];
                    if (gated && doors > 0)
                        parts.push(count(doors, 'door'));
                    if (!gated && gates > 0)
                        parts.push(count(gates, 'gate'));
                    lines.push(`- ${area.name} (${area.type}): from ${point(area.min)} to ${point(area.max)}, ${parts.join(', ')}`);
                }
                return lines.join('\n');
            } catch (error) {
                console.warn('Could not list the protected areas:', error);
                return 'Could not list the protected areas.';
            }
        }
    },
    {
        name: '!rules',
        description: 'List the rules that the players asked you to remember.',
        perform: function (agent) {
            return rulesReply(agent.rule_store); // never throws, also without a store
        }
    },
    {
        name: '!cost',
        description: 'Get what you cost in this session, in dollars, and the budget.',
        perform: function (agent) {
            if (!agent.cost_meter)
                return 'The cost meter is off.';
            try {
                return agent.cost_meter.summaryText();
            } catch (error) {
                console.warn('Could not read the cost meter:', error);
                return 'Could not read the cost meter.';
            }
        }
    },
    {
        name: '!chests',
        description: 'List the chests you know and what is in them, or which ones hold an item. From memory, no walk.',
        params: {
            'item': { type: 'string', description: 'An item to look for, empty for all chests.', default: '' }
        },
        perform: function (agent, item) {
            // v0.1.4.7, S4: the text of chestsText of the storage pack, for the dimension of the bot
            // v0.1.4.8 (C2): with an item, the chests that hold it
            if (!settings.storage_pack)
                return 'The storage pack is off.';
            const storage = agent.work_packs?.storage;
            if (!storage)
                return 'The storage pack could not be loaded.';
            try {
                return storage.chestsText(agent.packContext(), item ?? '', agent.bot.game?.dimension);
            } catch (error) {
                console.warn('Could not list the chests:', error);
                return 'Could not list the chests.';
            }
        }
    },
    {
        name: '!checkBlueprintLevel',
        description: 'Check if the level is complete and what blocks still need to be placed for the blueprint',
        params: {
            'levelNum': { type: 'int', description: 'The level number to check.', domain: [0, Number.MAX_SAFE_INTEGER] }
        },
        perform: function (agent, levelNum) {
            let res = checkLevelBlueprint(agent, levelNum);
            console.log(res);
            return pad(res);
        }
    }, 
    {
        name: '!checkBlueprint',
        description: 'Check what blocks still need to be placed for the blueprint',
        perform: function (agent) {
            let res = checkBlueprint(agent);
            return pad(res);
        }
    }, 
    {
        name: '!getBlueprint',
        description: 'Get the blueprint for the building',
        perform: function (agent) {
            let res = agent.task.blueprint.explain();
            return pad(res);
        }
    }, 
    {
        name: '!getBlueprintLevel',
        description: 'Get the blueprint for the building',
        params: {
            'levelNum': { type: 'int', description: 'The level number to check.', domain: [0, Number.MAX_SAFE_INTEGER] }
        },
        perform: function (agent, levelNum) {
            let res = agent.task.blueprint.explainLevel(levelNum);
            console.log(res);
            return pad(res);
        }
    },
    {
        name: '!getCraftingPlan',
        description: 'Get a crafting plan for an item: the ingredients, how many of each, and what your inventory lacks.',
        params: {
            targetItem: { 
                type: 'string', 
                description: 'The item to craft.' 
            },
            quantity: { 
                type: 'int',
                description: 'The quantity of the item that we are trying to craft',
                optional: true,
                domain: [1, Infinity, '[)'], // Quantity must be at least 1,
                default: 1
            }
        },
        perform: function (agent, targetItem, quantity = 1) {
            let bot = agent.bot;

            // Fetch the bot's inventory
            const curr_inventory = world.getInventoryCounts(bot); 
            const target_item = targetItem;
            let existingCount = curr_inventory[target_item] || 0;
            let prefixMessage = '';
            if (existingCount > 0) {
                curr_inventory[target_item] -= existingCount;
                prefixMessage = `You already have ${existingCount} ${target_item} in your inventory. If you need to craft more,\n`;
            }

            // Generate crafting plan
            try {
                let craftingPlan = mc.getDetailedCraftingPlan(target_item, quantity, curr_inventory);
                craftingPlan = prefixMessage + craftingPlan;
                return pad(craftingPlan);
            } catch (error) {
                console.error("Error generating crafting plan:", error);
                return `An error occurred while generating the crafting plan: ${error.message}`;
            }
            
            
        },
    },
    {
        name: '!searchWiki',
        description: 'Search the Minecraft Wiki for the given query.',
        params: {
            'query': { type: 'string', description: 'The query to search for.' }
        },
        perform: async function (agent, query) {
            const url = `https://minecraft.wiki/w/${query}`
            try {
                const response = await fetch(url);
                if (response.status === 404) {
                  return `${query} was not found on the Minecraft Wiki. Try adjusting your search term.`;
                }
                const html = await response.text();
                const $ = load(html);
            
                const parserOutput = $("div.mw-parser-output");
                
                parserOutput.find("table.navbox").remove();

                const divContent = parserOutput.text();
            
                return divContent.trim();
              } catch (error) {
                console.error("Error fetching or parsing HTML:", error);
                return `The following error occurred: ${error}`
              }
        }
    },
    {
        name: '!help',
        description: 'Lists all available commands and their descriptions.',
        perform: async function (agent) {
            return getCommandDocs(agent);
        }
    },
];
