import {
    getPosition,
    getBiomeName,
    getNearbyPlayerNames,
    getNearbyEntityTypes,
    getBlockAtPosition,
    getFirstBlockAboveHead
} from "./world.js";
import convoManager from '../conversation.js';
import { bagItems } from '../watch/digest_logic.js'; // v0.1.4.14 (P-30): the bag as an open window shows it
import { dayPhaseLabel } from '../clock_logic.js'; // v0.1.4.16 (F8): the one clock

// v0.1.4.14 (P-30, E1's finding): while a window is open (a craft, a chest, a furnace) mineflayer copies the inventory
// section into bot.inventory only at close, so the bag the model saw in the prompt lagged by the window's lifetime (a bed
// looked lost twice). The counts come from bagItems (the open window's inventory section, else bot.inventory.items()); the
// slots no container window carries (the armour, the off-hand, the crafting grid) from bot.inventory.slots, as
// getInventoryCounts counted them, so without a window the counts are the same as before. Never throws.
function bagCounts(bot) {
    const counts = {};
    const add = (item) => {
        if (item && typeof item.name === 'string' && Number.isFinite(item.count))
            counts[item.name] = (counts[item.name] ?? 0) + item.count;
    };
    try {
        for (const item of bagItems(bot))
            add(item);
        const inventory = bot?.inventory;
        const start = Number.isFinite(inventory?.inventoryStart) ? inventory.inventoryStart : 9;
        const end = Number.isFinite(inventory?.inventoryEnd) ? inventory.inventoryEnd : 45;
        (Array.isArray(inventory?.slots) ? inventory.slots : []).forEach((item, i) => {
            if (i < start || i >= end)
                add(item);
        });
    } catch {
        // what was counted stands
    }
    return counts;
}

export function getFullState(agent) {
    const bot = agent.bot;

    const pos = getPosition(bot);
    const position = {
        x: Number(pos.x.toFixed(2)),
        y: Number(pos.y.toFixed(2)),
        z: Number(pos.z.toFixed(2))
    };

    let weather = 'Clear';
    if (bot.thunderState > 0) weather = 'Thunderstorm';
    else if (bot.rainState > 0) weather = 'Rain';

    const timeLabel = dayPhaseLabel(bot.time.timeOfDay); // v0.1.4.16 (F8): Morning, Afternoon, Evening, Night or Dawn

    const below = getBlockAtPosition(bot, 0, -1, 0).name;
    const legs = getBlockAtPosition(bot, 0, 0, 0).name;
    const head = getBlockAtPosition(bot, 0, 1, 0).name;

    let players = getNearbyPlayerNames(bot);
    let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
    players = players.filter(p => !bots.includes(p));

    const helmet = bot.inventory.slots[5];
    const chestplate = bot.inventory.slots[6];
    const leggings = bot.inventory.slots[7];
    const boots = bot.inventory.slots[8];

    const state = {
        name: agent.name,
        gameplay: {
            position,
            dimension: bot.game.dimension,
            gamemode: bot.game.gameMode,
            health: Math.round(bot.health),
            hunger: Math.round(bot.food),
            biome: getBiomeName(bot),
            weather,
            timeOfDay: bot.time.timeOfDay,
            timeLabel
        },
        action: {
            current: agent.isIdle() ? 'Idle' : agent.actions.currentActionLabel,
            isIdle: agent.isIdle()
        },
        surroundings: {
            below,
            legs,
            head,
            firstBlockAboveHead: getFirstBlockAboveHead(bot, null, 32)
        },
        inventory: {
            counts: bagCounts(bot), // P-30: live while a window is open; getInventoryCounts of world.js is the same without one
            stacksUsed: bagItems(bot).length,
            totalSlots: bot.inventory.slots.length,
            equipment: {
                helmet: helmet ? helmet.name : null,
                chestplate: chestplate ? chestplate.name : null,
                leggings: leggings ? leggings.name : null,
                boots: boots ? boots.name : null,
                mainHand: bot.heldItem ? bot.heldItem.name : null
            }
        },
        nearby: {
            humanPlayers: players,
            botPlayers: bots,
            entityTypes: getNearbyEntityTypes(bot).filter(t => t !== 'player' && t !== 'item'),
        },
        modes: {
            summary: bot.modes.getMiniDocs()
        }
    };

    return state;
}