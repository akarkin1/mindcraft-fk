import * as mc from "../../utils/mcdata.js";
import * as world from "./world.js";
import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import settings from "../../../settings.js";
import agentSettings from "../settings.js";
import { isOreName, oreInSight, oreKind, outOfSightText, sightRange, SIGHT_TEXT_DISTANCE } from "./ore_sight_logic.js";
import { ladderStepTowards, ladderWayTowards, STEP_RULES } from "./ladder_pass.js";
import { findOpenables, openDoor, passThrough } from "../packs/home/doors.js";
import { walkNear } from "../packs/home/motion.js";
import { GIVE_TEXTS, SURFACE_TEXTS } from "./skill_texts.js";
import { sideOf } from "../packs/home/door_logic.js";
import { acquireEatLock } from "../packs/home/eat_lock.js";
import { wakeUp } from "../packs/home/wake.js";

const blockPlaceDelay = settings.block_place_delay == null ? 0 : settings.block_place_delay;
const useDelay = blockPlaceDelay > 0;

export function log(bot, message) {
    /**
     * Add a message to the bot's action output, which is reported back when the action finishes. Very long output is shortened.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} message, the message to log.
     * @returns {void}
     * @example
     * skills.log(bot, "Collected 10 oak logs.");
     **/
    bot.output += message + '\n';
}

async function autoLight(bot) {
    if (world.shouldPlaceTorch(bot)) {
        try {
            const pos = world.getPosition(bot);
            if (bot.areaGuard && bot.areaGuard.canPlace(pos, 'torch') === false)
                return false; // a protected area (v0.1.4.6): no torch and no log line
            return await placeBlock(bot, 'torch', pos.x, pos.y, pos.z, 'bottom', true);
        } catch (err) {return false;}
    }
    return false;
}

async function equipHighestAttack(bot) {
    let weapons = bot.inventory.items().filter(item => item.name.includes('sword') || (item.name.includes('axe') && !item.name.includes('pickaxe')));
    if (weapons.length === 0)
        weapons = bot.inventory.items().filter(item => item.name.includes('pickaxe') || item.name.includes('shovel'));
    if (weapons.length === 0)
        return;
    weapons.sort((a, b) => b.attackDamage - a.attackDamage);
    let weapon = weapons[0];
    if (weapon)
        await bot.equip(weapon, 'hand');
}

export async function craftRecipe(bot, itemName, num=1) {
    /**
     * Attempt to craft the given item name from a recipe. May craft many items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to craft.
     * @returns {Promise<boolean>} true if the recipe was crafted, false otherwise.
     * @example
     * await skills.craftRecipe(bot, "stick");
     **/
    let placedTable = false;

    if (!mc.getItemCraftingRecipes(itemName)?.length) { // null: no recipe, or not an item
        log(bot, `${itemName} is either not an item, or it does not have a crafting recipe!`);
        return false;
    }

    // get recipes that don't require a crafting table
    let recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, null); 
    let craftingTable = null;
    const craftingTableRange = 16;
    placeTable: if (!recipes || recipes.length === 0) {
        recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, true);
        if(!recipes || recipes.length === 0) break placeTable; //Don't bother going to the table if we don't have the required resources.

        // Look for crafting table
        craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
        if (craftingTable === null){

            // Try to place crafting table
            let hasTable = world.getInventoryCounts(bot)['crafting_table'] > 0;
            if (hasTable) {
                let pos = world.getNearestFreeSpace(bot, 1, 6);
                await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z);
                craftingTable = world.getNearestBlock(bot, 'crafting_table', craftingTableRange);
                if (craftingTable) {
                    recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, craftingTable);
                    placedTable = true;
                }
            }
            else {
                log(bot, `Crafting ${itemName} requires a crafting table.`)
                return false;
            }
        }
        else {
            recipes = bot.recipesFor(mc.getItemId(itemName), null, 1, craftingTable);
        }
    }
    if (!recipes || recipes.length === 0) {
        log(bot, `You do not have the resources to craft a ${itemName}. It requires: ${Object.entries(mc.getItemCraftingRecipes(itemName)[0][0]).map(([key, value]) => `${key}: ${value}`).join(', ')}.`);
        if (placedTable) {
            await collectBlock(bot, 'crafting_table', 1);
        }
        return false;
    }
    
    if (craftingTable && bot.entity.position.distanceTo(craftingTable.position) > 4) {
        await goToNearestBlock(bot, 'crafting_table', 4, craftingTableRange);
    }

    const recipe = recipes[0];
    console.log('crafting...');
    //Check that the agent has sufficient items to use the recipe `num` times.
    const inventory = world.getInventoryCounts(bot); //Items in the agents inventory
    const requiredIngredients = mc.ingredientsFromPrismarineRecipe(recipe); //Items required to use the recipe once.
    const craftLimit = mc.calculateLimitingResource(inventory, requiredIngredients);
    
    await bot.craft(recipe, Math.min(craftLimit.num, num), craftingTable);
    if(craftLimit.num<num) log(bot, `Not enough ${craftLimit.limitingResource} to craft ${num}, crafted ${craftLimit.num}. You now have ${world.getInventoryCounts(bot)[itemName]} ${itemName}.`);
    else log(bot, `Successfully crafted ${itemName}, you now have ${world.getInventoryCounts(bot)[itemName]} ${itemName}.`);
    if (placedTable) {
        await collectBlock(bot, 'crafting_table', 1);
    }

    //Equip any armor the bot may have crafted.
    //There is probablly a more efficient method than checking the entire inventory but this is all mineflayer-armor-manager provides. :P
    bot.armorManager.equipAll(); 

    return true;
}

export async function wait(bot, milliseconds) {
    /**
     * Waits for the given number of milliseconds.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} milliseconds, the number of milliseconds to wait.
     * @returns {Promise<boolean>} true if the wait was successful, false otherwise.
     * @example
     * await skills.wait(bot, 1000);
     **/
    // setTimeout is disabled to prevent unawaited code, so this is a safe alternative that enables interrupts
    let timeLeft = milliseconds;
    let startTime = Date.now();
    
    while (timeLeft > 0) {
        if (bot.interrupt_code) return false;
        
        let waitTime = Math.min(2000, timeLeft);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        let elapsed = Date.now() - startTime;
        timeLeft = milliseconds - elapsed;
    }
    return true;
}

export async function smeltItem(bot, itemName, num=1) {
    /**
     * Puts 1 coal in furnace and smelts the given item name, waits until the furnace runs out of fuel or input items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item name to smelt. Ores must contain "raw" like raw_iron.
     * @param {number} num, the number of items to smelt. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was smelted, false otherwise. Fail
     * @example
     * await skills.smeltItem(bot, "raw_iron");
     * await skills.smeltItem(bot, "beef");
     **/

    if (!mc.isSmeltable(itemName)) {
        log(bot, `Cannot smelt ${itemName}. Hint: make sure you are smelting the 'raw' item.`);
        return false;
    }

    let placedFurnace = false;
    let furnaceBlock = undefined;
    const furnaceRange = 16;
    furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
    if (!furnaceBlock){
        // Try to place furnace
        let hasFurnace = world.getInventoryCounts(bot)['furnace'] > 0;
        if (hasFurnace) {
            let pos = world.getNearestFreeSpace(bot, 1, furnaceRange);
            await placeBlock(bot, 'furnace', pos.x, pos.y, pos.z);
            furnaceBlock = world.getNearestBlock(bot, 'furnace', furnaceRange);
            placedFurnace = true;
        }
    }
    if (!furnaceBlock){
        log(bot, `There is no furnace nearby and you have no furnace.`)
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, 'furnace', 4, furnaceRange);
    }
    bot.modes.pause('unstuck');
    await bot.lookAt(furnaceBlock.position);

    console.log('smelting...');
    const furnace = await bot.openFurnace(furnaceBlock);
    // check if the furnace is already smelting something
    let input_item = furnace.inputItem();
    if (input_item && input_item.type !== mc.getItemId(itemName) && input_item.count > 0) {
        // TODO: check if furnace is currently burning fuel. furnace.fuel is always null, I think there is a bug.
        // This only checks if the furnace has an input item, but it may not be smelting it and should be cleared.
        log(bot, `The furnace is currently smelting ${mc.getItemName(input_item.type)}.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }
    // check if the bot has enough items to smelt
    let inv_counts = world.getInventoryCounts(bot);
    if (!inv_counts[itemName] || inv_counts[itemName] < num) {
        log(bot, `You do not have enough ${itemName} to smelt.`);
        if (placedFurnace)
            await collectBlock(bot, 'furnace', 1);
        return false;
    }

    // fuel the furnace
    if (!furnace.fuelItem()) {
        let fuel = mc.getSmeltingFuel(bot);
        if (!fuel) {
            log(bot, `You have no fuel to smelt ${itemName}, you need coal, charcoal, or wood.`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        log(bot, `Using ${fuel.name} as fuel.`);

        const put_fuel = Math.ceil(num / mc.getFuelSmeltOutput(fuel.name));

        if (fuel.count < put_fuel) {
            log(bot, `You don't have enough ${fuel.name} to smelt ${num} ${itemName}; you need ${put_fuel}.`);
            if (placedFurnace)
                await collectBlock(bot, 'furnace', 1);
            return false;
        }
        await furnace.putFuel(fuel.type, null, put_fuel);
        log(bot, `Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`);
        console.log(`Added ${put_fuel} ${mc.getItemName(fuel.type)} to furnace fuel.`)
    }
    // v0.1.4.8 (B6, T6): what lay in the output slot before is taken out first, so the count below is
    // what this smelt made (it said "got 4 charcoal" for charcoal of an earlier smelt)
    if (furnace.outputItem()) {
        const earlier = await furnace.takeOutput();
        if (earlier)
            log(bot, `Took ${earlier.count} ${mc.getItemName(earlier.type)} that was already in the furnace.`);
    }
    // put the items in the furnace
    await furnace.putInput(mc.getItemId(itemName), null, num);
    // wait for the items to smelt
    let total = 0;
    let smelted_item = null;
    await new Promise(resolve => setTimeout(resolve, 200));
    let last_collected = Date.now();
    while (total < num) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (furnace.outputItem()) {
            smelted_item = await furnace.takeOutput();
            if (smelted_item) {
                total += smelted_item.count;
                last_collected = Date.now();
            }
        }
        if (Date.now() - last_collected > 11000) {
            break; // if nothing has been collected in 11 seconds, stop
        }
        if (bot.interrupt_code) {
            break;
        }
    }
    // take all remaining in input/fuel slots
    if (furnace.inputItem()) {
        await furnace.takeInput();
    }
    if (furnace.fuelItem()) {
        await furnace.takeFuel();
    }

    await bot.closeWindow(furnace);

    if (placedFurnace) {
        await collectBlock(bot, 'furnace', 1);
    }
    if (total === 0) {
        log(bot, `Failed to smelt ${itemName}.`);
        return false;
    }
    if (total < num) {
        log(bot, `Only smelted ${total} ${mc.getItemName(smelted_item.type)}.`);
        return false;
    }
    log(bot, `Successfully smelted ${itemName}, got ${total} ${mc.getItemName(smelted_item.type)}.`);
    return true;
}

export async function clearNearestFurnace(bot) {
    /**
     * Clears the nearest furnace of all items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the furnace was cleared, false otherwise.
     * @example
     * await skills.clearNearestFurnace(bot);
     **/
    let furnaceBlock = world.getNearestBlock(bot, 'furnace', 32);
    if (!furnaceBlock) {
        log(bot, `No furnace nearby to clear.`);
        return false;
    }
    if (bot.entity.position.distanceTo(furnaceBlock.position) > 4) {
        await goToNearestBlock(bot, 'furnace', 4, 32);
    }

    console.log('clearing furnace...');
    const furnace = await bot.openFurnace(furnaceBlock);
    console.log('opened furnace...')
    // take the items out of the furnace
    let smelted_item, intput_item, fuel_item;
    if (furnace.outputItem())
        smelted_item = await furnace.takeOutput();
    if (furnace.inputItem())
        intput_item = await furnace.takeInput();
    if (furnace.fuelItem())
        fuel_item = await furnace.takeFuel();
    console.log(smelted_item, intput_item, fuel_item)
    let smelted_name = smelted_item ? `${smelted_item.count} ${smelted_item.name}` : `0 smelted items`;
    let input_name = intput_item ? `${intput_item.count} ${intput_item.name}` : `0 input items`;
    let fuel_name = fuel_item ? `${fuel_item.count} ${fuel_item.name}` : `0 fuel items`;
    log(bot, `Cleared furnace, received ${smelted_name}, ${input_name}, and ${fuel_name}.`);
    return true;

}


export async function attackNearest(bot, mobType, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} mobType, the type of mob to attack.
     * @param {boolean} kill, whether or not to continue attacking until the mob is dead. Defaults to true.
     * @returns {Promise<boolean>} true if the mob was attacked, false if the mob type was not found.
     * @example
     * await skills.attackNearest(bot, "zombie", true);
     **/
    bot.modes.pause('cowardice');
    if (mobType === 'drowned' || mobType === 'cod' || mobType === 'salmon' || mobType === 'tropical_fish' || mobType === 'squid')
        bot.modes.pause('self_preservation'); // so it can go underwater. TODO: have an drowning mode so we don't turn off all self_preservation
    const mob = world.getNearbyEntities(bot, 24).find(entity => entity.name === mobType);
    if (mob) {
        return await attackEntity(bot, mob, kill);
    }
    log(bot, 'Could not find any '+mobType+' to attack.');
    return false;
}

export async function attackEntity(bot, entity, kill=true) {
    /**
     * Attack mob of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to attack.
     * @returns {Promise<boolean>} true if the entity was attacked, false if interrupted
     * @example
     * await skills.attackEntity(bot, entity);
     **/

    let pos = entity.position;
    await equipHighestAttack(bot)

    if (!kill) {
        if (bot.entity.position.distanceTo(pos) > 5) {
            console.log('moving to mob...')
            await goToPosition(bot, pos.x, pos.y, pos.z);
        }
        console.log('attacking mob...')
        await bot.attack(entity);
    }
    else {
        bot.pvp.attack(entity);
        while (world.getNearbyEntities(bot, 24).includes(entity)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (bot.interrupt_code) {
                bot.pvp.stop();
                return false;
            }
        }
        log(bot, `Successfully killed ${entity.name}.`);
        await pickupNearbyItems(bot);
        return true;
    }
}

export async function defendSelf(bot, range=9, filter=null) {
    /**
     * Defend yourself from all nearby hostile mobs until there are no more.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} range, the range to look for mobs. Defaults to 8.
     * @returns {Promise<boolean>} true if the bot found any enemies and has killed them, false if no entities were found.
     * @example
     * await skills.defendSelf(bot);
     * **/
    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    let attacked = false;
    // filter: the mode self_defense leaves out mobs that another mode handles (creepers, v0.1.4.6)
    const isTarget = entity => mc.isHostile(entity) && (!filter || filter(entity));
    let enemy = world.getNearestEntityWhere(bot, isTarget, range);
    while (enemy) {
        await equipHighestAttack(bot);
        if (bot.entity.position.distanceTo(enemy.position) >= 4 && enemy.name !== 'creeper' && enemy.name !== 'phantom') {
            try {
                bot.pathfinder.setMovements(new pf.Movements(bot));
                await bot.pathfinder.goto(new pf.goals.GoalFollow(enemy, 3.5), true);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        if (bot.entity.position.distanceTo(enemy.position) <= 2) {
            try {
                bot.pathfinder.setMovements(new pf.Movements(bot));
                let inverted_goal = new pf.goals.GoalInvert(new pf.goals.GoalFollow(enemy, 2));
                await bot.pathfinder.goto(inverted_goal, true);
            } catch (err) {/* might error if entity dies, ignore */}
        }
        bot.pvp.attack(enemy);
        attacked = true;
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, isTarget, range);
        if (bot.interrupt_code) {
            bot.pvp.stop();
            return false;
        }
    }
    bot.pvp.stop();
    if (attacked)
        log(bot, `Successfully defended self.`);
    else
        log(bot, `No enemies nearby to defend self from.`);
    return attacked;
}



export async function collectBlock(bot, blockType, num=1, exclude=null) {
    /**
     * Collect one of the given block type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to collect.
     * @param {number} num, the number of blocks to collect. Defaults to 1.
     * @param {list} exclude, a list of positions to exclude from the search. Defaults to null.
     * @returns {Promise<boolean>} true if the block was collected, false if the block type was not found.
     * @example
     * await skills.collectBlock(bot, "oak_log");
     **/
    if (num < 1) {
        log(bot, `Invalid number of blocks to collect: ${num}.`);
        return false;
    }
    let blocktypes = [blockType];
    if (blockType === 'coal' || blockType === 'diamond' || blockType === 'emerald' || blockType === 'iron' || blockType === 'gold' || blockType === 'lapis_lazuli' || blockType === 'redstone')
        blocktypes.push(blockType+'_ore');
    if (blockType.endsWith('ore'))
        blocktypes.push('deepslate_'+blockType);
    if (blockType === 'dirt')
        blocktypes.push('grass_block');
    if (blockType === 'cobblestone')
        blocktypes.push('stone');

    // v0.1.4.8, fix round (X11): never more blocks than asked. !collectBlocks("oak_fence", 3) broke 4
    // posts: the path search of the collect plugin dug through a post on its way to a dropped item. The
    // blocks of the asked types that break are counted from the block updates, and once the block it
    // collects is broken, the path search of the collect plugin (the walk to the drops) may not break
    // another block of these types. On the way to the block it may, as before: dirt, stone and ore lie
    // behind blocks of their own kind (the rule for the whole walk made !collectBlocks("dirt") slow).
    const target = { pos: null, broken: false };
    const breaks = watchBreaks(bot, blocktypes, target);
    const releaseTargets = keepOtherTargets(bot, blocktypes, target);
    try {
        return await collectBlocks(bot, blockType, num, exclude, blocktypes, breaks, target);
    } finally {
        releaseTargets();
        breaks.stop();
    }
}

async function collectBlocks(bot, blockType, num, exclude, blocktypes, breaks, target) {
    const isLiquid = blockType === 'lava' || blockType === 'water';

    let collected = 0;
    const brokenNames = {}; // v0.1.4.8 (B1, F4): the broken blocks by name
    const invBefore = inventoryCounts(bot);

    // v0.1.4.9 (C1): an ore is a candidate only when it is in sight (ore_sight_logic.js): with
    // ore_sense_range 0 a face in the open, with 3 an open cell within 3 blocks. A cell dug in this call
    // is open. Also without the mining pack: it is a property of the setting.
    const sight = sightRange(currentSetting('ore_sense_range'));
    const dug = new Set(); // "x,y,z" of the blocks collected in this call
    const dugHere = { has: (key) => dug.has(key) || breaks.has(key) };
    let names = new Map(); // "x,y,z" -> name, read once per search
    let hidden = 0; // ores out of sight in the last search
    let hiddenNear = null; // the name of one of them within 16 blocks
    let outOfSight = false;
    const readName = (x, y, z) => {
        const key = `${x},${y},${z}`;
        if (names.has(key))
            return names.get(key);
        let name = null;
        try {
            const b = bot.blockAt(new Vec3(x, y, z));
            name = typeof b?.name === 'string' ? b.name : null;
        } catch (err) {
            name = null; // not loaded: rock
        }
        names.set(key, name);
        return name;
    };
    const isNear = (p) => {
        try {
            const me = bot.entity.position; // the distance of findBlocks: from the block of the bot
            return Math.hypot(p.x - Math.floor(me.x), p.y - Math.floor(me.y), p.z - Math.floor(me.z)) <= SIGHT_TEXT_DISTANCE;
        } catch (err) {
            return false;
        }
    };
    const inSight = (block) => {
        const p = block.position;
        if (!p)
            return true; // the palette of a section (findBlocks): any block of the type may be in sight
        if (oreInSight(readName, p, sight, dugHere))
            return true;
        hidden++;
        if (hiddenNear === null && isNear(p))
            hiddenNear = block.name;
        return false;
    };

    const movements = new pf.Movements(bot);
    movements.dontMineUnderFallingBlock = false;
    movements.dontCreateFlow = true;

    // Blocks to ignore safety for, usually next to lava/water
    const unsafeBlocks = ['obsidian'];

    // With protected areas (bot.areaGuard), a block the guard does not allow is no candidate.
    const guard = bot.areaGuard;
    let range = 64;
    let refused = 0;
    let refusedBuilt = 0;
    let refusal = null; // the first refusal of the last search: its text is the answer when every candidate is refused
    let refusedAll = false;
    const guardAllows = (block) => {
        let allowed = true;
        try {
            // v0.1.4.8 (B1, P1): the guard of v0.1.4.8 tells the reason, also for a block that players
            // build with outside of every area. The guard of v0.1.4.7 has canBreak only.
            if (guard && typeof guard.refusal === 'function') {
                const r = guard.refusal(block.position, 'break');
                if (r) {
                    allowed = false;
                    refusal = refusal ?? r;
                    if (r.reason === 'built_block')
                        refusedBuilt++;
                }
            }
            else
                allowed = !guard || guard.canBreak(block) !== false;
            // Nor is a block with a block of a building above it, such as the ground under the floor of
            // a house: the way to it leads through the floor (v0.1.4.6, Amendment 2 F4). Only blocks that
            // are not air and lie in an area of type building count (v0.1.4.7, Amendment 2 I5): the air
            // above a crop in a farm does not.
            if (allowed && guard && typeof guard.inBuilding === 'function') {
                for (let dy = 1; dy <= 8; dy++) {
                    const above = bot.blockAt(block.position.offset(0, dy, 0));
                    if (!above)
                        break;
                    if (!['air', 'cave_air', 'void_air'].includes(above.name) && guard.inBuilding(above.position)) {
                        allowed = false;
                        break;
                    }
                }
            }
        } catch (err) {
            allowed = true; // bot.dig is guarded as well
        }
        if (!allowed)
            refused++;
        return allowed;
    };

    for (let i=0; i<num; i++) {
        // X11: the loop ends when the gain reached the number or the number of broken blocks reached it
        if (Math.max(collected, breaks.count()) >= num || gainOf(invBefore, inventoryCounts(bot), [blockType, ...blocktypes]) >= num)
            break;
        refused = 0;
        refusedBuilt = 0;
        refusal = null;
        names = new Map();
        hidden = 0;
        hiddenNear = null;
        let blocks = world.getNearestBlocksWhere(bot, block => {
            if (!blocktypes.includes(block.name)) {
                return false;
            }
            if (exclude) {
                for (let position of exclude) {
                    if (block.position.x === position.x && block.position.y === position.y && block.position.z === position.z) {
                        return false;
                    }
                }
            }
            if (isLiquid) {
                // collect only source blocks
                return block.metadata === 0 && guardAllows(block);
            }
            if (isOreName(block.name) && !inSight(block)) {
                return false; // v0.1.4.9 (C1): inside the rock, no candidate
            }

            return (movements.safeToBreak(block) || unsafeBlocks.includes(block.name)) && guardAllows(block);
        }, range, 1);

        // Blocks that players build with are refused everywhere: a wider search does not help (v0.1.4.8)
        if (blocks.length === 0 && refused > 0 && refusedBuilt === 0 && range === 64) {
            log(bot, `All ${blockType} blocks nearby belong to a protected area. I look for others farther away.`);
            range *= 2; // once
            i--;
            continue;
        }
        if (blocks.length === 0) {
            if (refused > 0 && refusal) {
                // v0.1.4.8 (B1): every candidate was refused, the text of the guard says why
                log(bot, refusalText(refusal, `I may not break the ${blockType} nearby.`));
                refusedAll = true;
            }
            else if (hidden > 0) {
                // v0.1.4.9 (C1): every candidate is out of sight
                log(bot, outOfSightText(blockType, { ore: oreKind(hiddenNear), near: hiddenNear !== null, mining: currentSetting('mining_pack') === true }));
                outOfSight = true;
            }
            else if (collected === 0)
                log(bot, `No ${blockType} nearby to collect.`);
            else
                log(bot, `No more ${blockType} nearby to collect.`);
            break;
        }
        const block = blocks[0];
        target.pos = block.position; // X11: after this block broke, the walk to its drops breaks no block of these types
        target.broken = false;
        await bot.tool.equipForBlock(block);
        if (isLiquid) {
            const bucket = bot.inventory.findInventoryItem('bucket');
            if (!bucket) {
                log(bot, `Don't have bucket to harvest ${blockType}.`);
                return false;
            }
            await bot.equip(bucket, 'hand');
        }
        const itemId = bot.heldItem ? bot.heldItem.type : null
        if (!block.canHarvest(itemId)) {
            log(bot, `Don't have right tools to harvest ${blockType}.`);
            return false;
        }
        try {
            let success = false;
            if (isLiquid) {
                success = await useToolOnBlock(bot, 'bucket', block);
            }
            else if (mc.mustCollectManually(blockType)) {
                await goToPosition(bot, block.position.x, block.position.y, block.position.z, 2);
                if (bot.interrupt_code)
                    break; // v0.1.4.8 (B3): the walk was stopped, no dig from afar
                await bot.dig(block);
                await pickupNearbyItems(bot);
                success = true;
            }
            else {
                await bot.collectBlock.collect(block);
                success = true;
            }
            if (success) {
                collected++;
                brokenNames[block.name] = (brokenNames[block.name] ?? 0) + 1;
                dug.add(`${block.position.x},${block.position.y},${block.position.z}`);
            }
            await autoLight(bot);
        }
        catch (err) {
            if (err.name === 'NoChests') {
                log(bot, `Failed to collect ${blockType}: Inventory full, no place to deposit.`);
                break;
            }
            else {
                log(bot, `Failed to collect ${blockType}: ${err}.`);
                if (bot.interrupt_code)
                    break; // v0.1.4.8 (B3): a stopped action does not go on with the next block
                continue;
            }
        }
        
        if (bot.interrupt_code)
            break;  
    }
    if (refusedAll && collected === 0)
        return false; // v0.1.4.8 (B1): the text of the guard is the whole answer
    if (outOfSight && collected === 0 && breaks.count() === 0)
        return false; // v0.1.4.9 (C1): nothing broke, the text of the sight is the whole answer
    const result = await collectResult(bot, blockType, mostBroken(brokenNames, breaks.names()), collected, invBefore);
    log(bot, result.text);
    return result.got;
}

// v0.1.4.8, fix round (X11): the blocks of the given types that break within 8 blocks of the bot while
// collectBlock runs, seen in the block updates of mineflayer: the digs of collectBlock and those of the
// path search on its way. A block that comes back (the server refused the dig) is taken off again.
const BREAK_WATCH_RANGE = 8;

function watchBreaks(bot, blocktypes, target = {}) {
    const broken = new Map(); // "x,y,z" -> name
    const onUpdate = (oldBlock, newBlock) => {
        try {
            const p = newBlock?.position ?? oldBlock?.position;
            if (!p)
                return;
            const key = `${p.x},${p.y},${p.z}`;
            if (newBlock && blocktypes.includes(newBlock.name))
                broken.delete(key);
            else if (oldBlock && blocktypes.includes(oldBlock.name) && bot.entity.position.distanceTo(p) <= BREAK_WATCH_RANGE) {
                broken.set(key, oldBlock.name);
                const t = target.pos;
                if (t && t.x === p.x && t.y === p.y && t.z === p.z)
                    target.broken = true;
            }
        } catch (err) {
            // not counted
        }
    };
    let listening = false;
    try {
        if (typeof bot.on === 'function' && typeof bot.removeListener === 'function') {
            bot.on('blockUpdate', onUpdate);
            listening = true;
        }
    } catch (err) {
        listening = false; // the own count of collectBlock decides alone
    }
    return {
        count: () => broken.size,
        has: (key) => broken.has(key), // v0.1.4.9 (C1): a cell dug in this call is open for the sight of ore
        names: () => {
            const out = {};
            for (const name of broken.values())
                out[name] = (out[name] ?? 0) + 1;
            return out;
        },
        stop: () => {
            if (!listening)
                return;
            listening = false;
            try {
                bot.removeListener('blockUpdate', onUpdate);
            } catch (err) {
                // gone with the bot
            }
        },
    };
}

// X11: once the block in target.pos is broken, the path search of the collect plugin (its own Movements,
// the walk to the drops) gets cost 100 for every block of the asked types. Returns the function that takes
// the rule away again.
function keepOtherTargets(bot, blocktypes, target) {
    try {
        const list = bot.collectBlock?.movements?.exclusionAreasBreak;
        if (!Array.isArray(list))
            return () => {};
        const rule = (block) => (target.broken === true && block && blocktypes.includes(block.name) ? 100 : 0);
        list.push(rule);
        return () => {
            const at = list.indexOf(rule);
            if (at >= 0)
                list.splice(at, 1);
        };
    } catch (err) {
        return () => {};
    }
}

// v0.1.4.9 (C1): a setting as the agent runs with it. src/agent/settings.js holds the settings the mind
// server gave the agent (settings.js, the profile, SETTINGS_JSON, the tests); settings.js itself is read
// when that object lacks the key (a unit test, a script without the mind server).
function currentSetting(name) {
    try {
        if (agentSettings && Object.prototype.hasOwnProperty.call(agentSettings, name))
            return agentSettings[name];
    } catch (err) {
        // the value of the file
    }
    return settings[name];
}

// X11: what the inventory gained of the given item names.
function gainOf(before, after, names) {
    if (!before || !after)
        return 0;
    const gain = world.getInventoryGain(before, after);
    return [...new Set(names)].reduce((n, name) => n + (gain[name] ?? 0), 0);
}

// X11: per name the larger count of the own count and the watched count.
function mostBroken(own, watched) {
    const out = { ...own };
    for (const [name, n] of Object.entries(watched))
        out[name] = Math.max(out[name] ?? 0, n);
    return out;
}

// v0.1.4.8 (B1, F4): the result of collectBlock names what the inventory gained, not what was broken
// (tall_grass broken by hand drops nothing). Without a readable inventory the count is what was
// broken, as in v0.1.4.7.
const GAIN_SETTLE_MS = 500; // a picked up item reaches the inventory a moment after the block broke
const NEEDS_SHEARS = new Set(['short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'seagrass', 'tall_seagrass',
    'vine', 'glow_lichen', 'hanging_roots', 'nether_sprouts']);

// The counts of the inventory, the off-hand included, or null when the inventory cannot be read.
function inventoryCounts(bot) {
    try {
        return Array.isArray(bot.inventory?.slots) ? world.getInventoryCounts(bot) : null;
    } catch (err) {
        return null;
    }
}

function itemList(items) {
    return items.map(item => `${item.count} ${item.name}`).join(', ');
}

// The text of collectBlock. broken: {name: count} of the broken blocks; got: sumItemCounts of the gain.
function collectedText(blockType, broken, got, hasShears) {
    const brokenList = world.sumItemCounts(broken);
    const brokenCount = brokenList.reduce((n, b) => n + b.count, 0);
    if (got.length > 0) {
        const liquid = blockType === 'water' || blockType === 'lava'; // a bucket is filled, nothing breaks
        if (brokenCount === 0 || liquid || got.some(item => item.name === blockType))
            return `Collected ${itemList(got)}.`;
        return `I broke ${itemList(brokenList)} and got ${itemList(got)}.`;
    }
    if (brokenCount === 0)
        return `Collected 0 ${blockType}.`;
    let text = `I broke ${itemList(brokenList)} and got nothing.`;
    const names = brokenList.map(b => b.name);
    if (!hasShears && names.every(name => NEEDS_SHEARS.has(name)))
        text += ` ${names.join(' and ')} ${names.length === 1 ? 'drops' : 'drop'} nothing without shears.`;
    return text;
}

async function collectResult(bot, blockType, broken, collected, before) {
    if (!before)
        return { text: `Collected ${collected} ${blockType}.`, got: collected > 0 };
    let after = inventoryCounts(bot) ?? before;
    let gained = world.getInventoryGain(before, after);
    const total = () => Object.values(gained).reduce((n, count) => n + count, 0);
    for (let waited = 0; total() < collected && waited < GAIN_SETTLE_MS && !bot.interrupt_code; waited += 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        after = inventoryCounts(bot) ?? before;
        gained = world.getInventoryGain(before, after);
    }
    const got = world.sumItemCounts(gained);
    return { text: collectedText(blockType, broken, got, (after.shears ?? 0) > 0), got: got.length > 0 };
}

// v0.1.4.8 (B1): the refusal of the guard for a position, or null. Only the guard of v0.1.4.8 has
// refusal(); without it the wrapped bot.dig and bot.placeBlock refuse as in v0.1.4.7.
function guardRefusal(bot, pos, action, details) {
    const guard = bot.areaGuard;
    if (!guard || typeof guard.refusal !== 'function')
        return null;
    try {
        const refusal = details ? guard.refusal(pos, action, details) : guard.refusal(pos, action);
        return refusal && typeof refusal === 'object' ? refusal : null;
    } catch (err) {
        return null; // the wrapped bot.dig and bot.placeBlock still ask the guard
    }
}

function refusalText(refusal, fallback) {
    return typeof refusal?.text === 'string' && refusal.text.trim() !== '' ? refusal.text : fallback;
}

export async function pickupNearbyItems(bot) {
    /**
     * Pick up all nearby items.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were picked up, false otherwise.
     * @example
     * await skills.pickupNearbyItems(bot);
     **/
    const distance = 8;
    const getNearestItem = bot => bot.nearestEntity(entity => entity.name === 'item' && bot.entity.position.distanceTo(entity.position) < distance);
    let nearestItem = getNearestItem(bot);
    let pickedUp = 0;
    while (nearestItem) {
        let movements = new pf.Movements(bot);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
        await goToGoal(bot, new pf.goals.GoalFollow(nearestItem, 1));
        await new Promise(resolve => setTimeout(resolve, 200));
        let prev = nearestItem;
        nearestItem = getNearestItem(bot);
        if (prev === nearestItem) {
            break;
        }
        pickedUp++;
    }
    log(bot, `Picked up ${pickedUp} items.`);
    return true;
}

// v0.1.4.8 (B4, P2): pickUpItems
const PICK_UP_LIMIT_MS = 60000; // for all items together
const PICK_UP_WAIT_MS = 2500;   // a thrown item cannot be picked up for 2 s
const PICK_UP_REACH = 2;        // the bot waits for an item this near
const PICK_UP_TRIES = 2;        // per item

export async function pickUpItems(bot, name='', range=16) {
    /**
     * Walk to the items that lie on the ground within range, nearest first, and pick them up. Waits for the pick-up delay of thrown items and stops after 60 seconds. Never digs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} name, the name of the item to pick up. Defaults to '', which picks up every item.
     * @param {number} range, the distance to look for items. Defaults to 16.
     * @returns {Promise<boolean>} true if the inventory gained something, false otherwise.
     * @example
     * await skills.pickUpItems(bot, "oak_fence", 16);
     **/
    const start = Date.now();
    const before = inventoryCounts(bot);
    const targets = world.getNearbyItems(bot, name, range);
    if (targets.length === 0) {
        log(bot, `I see no ${name || 'items'} on the ground within ${range} blocks.`);
        return false;
    }
    const tries = new Map();
    while (!bot.interrupt_code && Date.now() - start < PICK_UP_LIMIT_MS) {
        const next = nextItemToPickUp(bot, targets, tries);
        if (!next)
            break;
        tries.set(next.id, (tries.get(next.id) ?? 0) + 1);
        if (next.position.distanceTo(bot.entity.position) > 1) {
            try {
                const movements = new pf.Movements(bot);
                movements.canDig = false;
                await walkWith(bot, new pf.goals.GoalFollow(next, 1), movements, Math.max(1, PICK_UP_LIMIT_MS - (Date.now() - start)));
            } catch (err) {
                // no way to this item now: it is tried again later
            }
        }
        if (!isGone(bot, next) && next.position.distanceTo(bot.entity.position) <= PICK_UP_REACH)
            await waitUntilGone(bot, next, Math.min(PICK_UP_WAIT_MS, PICK_UP_LIMIT_MS - (Date.now() - start)));
    }
    // the inventory can change a moment after the item left the ground
    const gone = targets.filter(item => isGone(bot, item)).map(droppedStack).reduce((n, stack) => n + stack.count, 0);
    let after = inventoryCounts(bot);
    const gainedCount = () => Object.values(world.getInventoryGain(before, after)).reduce((n, count) => n + count, 0);
    for (let waited = 0; before && after && gainedCount() < gone && waited < GAIN_SETTLE_MS && !bot.interrupt_code; waited += 100) {
        await new Promise(resolve => setTimeout(resolve, 100));
        after = inventoryCounts(bot);
    }
    const got = before && after ? world.sumItemCounts(world.getInventoryGain(before, after)) : [];
    const rest = targets.filter(item => !isGone(bot, item)).map(droppedStack);
    log(bot, pickUpText(got, rest, Boolean(bot.interrupt_code)));
    return got.length > 0;
}

function isGone(bot, entity) {
    return entity.isValid === false || bot.entities[entity.id] !== entity;
}

// The nearest item of the list that is still there and was not tried too often.
function nextItemToPickUp(bot, items, tries) {
    const me = bot.entity.position;
    let best = null;
    for (const item of items) {
        if (isGone(bot, item) || (tries.get(item.id) ?? 0) >= PICK_UP_TRIES)
            continue;
        if (!best || item.position.distanceTo(me) < best.position.distanceTo(me))
            best = item;
    }
    return best;
}

async function waitUntilGone(bot, entity, ms) {
    const start = Date.now();
    while (!isGone(bot, entity) && !bot.interrupt_code && Date.now() - start < ms)
        await new Promise(resolve => setTimeout(resolve, 100));
}

function droppedStack(entity) {
    try {
        const item = typeof entity.getDroppedItem === 'function' ? entity.getDroppedItem() : null;
        if (item && item.name)
            return { name: item.name, count: item.count > 0 ? item.count : 1 };
    } catch (err) {
        // the name is not known yet
    }
    return { name: 'item', count: 1 };
}

function pickUpText(got, rest, stopped) {
    const parts = [];
    if (got.length > 0)
        parts.push(`I picked up ${itemList(got)}.`);
    if (rest.length > 0) {
        const left = world.sumItemCounts(rest);
        const count = left.reduce((n, item) => n + item.count, 0);
        const what = `${count} ${count === 1 ? 'item' : 'items'}: ${left.map(item => item.name).join(', ')}.`;
        parts.push(stopped ? `I was stopped before I picked up ${what}` : `I could not pick up ${what}`);
    }
    if (parts.length === 0)
        parts.push('I picked up nothing. The items are no longer there.');
    return parts.join(' ');
}


export async function breakBlockAt(bot, x, y, z) {
    /**
     * Break the block at the given position. Will use the bot's equipped item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate of the block to break.
     * @param {number} y, the y coordinate of the block to break.
     * @param {number} z, the z coordinate of the block to break.
     * @returns {Promise<boolean>} true if the block was broken, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.breakBlockAt(bot, position.x, position.y - 1, position.x);
     **/
    if (x == null || y == null || z == null) throw new Error('Invalid position to break block at.');
    let block = bot.blockAt(Vec3(x, y, z));
    if (block.name !== 'air' && block.name !== 'water' && block.name !== 'lava') {
        if (bot.modes.isOn('cheat')) {
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' air';
            bot.chat(msg);
            log(bot, `Used /setblock to break block at ${x}, ${y}, ${z}.`);
            return true;
        }

        // v0.1.4.8 (B1): a refusal of the guard names its reason in the output
        const refusal = guardRefusal(bot, block.position, 'break');
        if (refusal) {
            log(bot, refusalText(refusal, `I may not break the ${block.name} at ${block.position}.`));
            return false;
        }

        if (bot.entity.position.distanceTo(block.position) > 4.5) {
            let pos = block.position;
            let movements = new pf.Movements(bot);
            movements.canPlaceOn = false;
            movements.allow1by1towers = false;
            bot.pathfinder.setMovements(movements);
            await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
            if (bot.interrupt_code)
                return false; // v0.1.4.8 (B3): the walk was stopped
        }
        if (bot.game.gameMode !== 'creative') {
            await bot.tool.equipForBlock(block);
            const itemId = bot.heldItem ? bot.heldItem.type : null
            if (!block.canHarvest(itemId)) {
                log(bot, `Don't have right tools to break ${block.name}.`);
                return false;
            }
        }
        try {
            await bot.dig(block, true);
        } catch (err) {
            if (err?.name !== 'ProtectedAreaError')
                throw err;
            log(bot, err.message); // v0.1.4.8 (B1): the text of the guard instead of an exception
            return false;
        }
        log(bot, `Broke ${block.name} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    else {
        log(bot, `Skipping block at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)} because it is ${block.name}.`);
        return false;
    }
    return true;
}


export async function placeBlock(bot, blockType, x, y, z, placeOn='bottom', dontCheat=false) {
    /**
     * Place the given block type at the given position. It will build off from any adjacent blocks. Will fail if there is a block in the way or nothing to build off of.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to place, which can be a block or item name.
     * @param {number} x, the x coordinate of the block to place.
     * @param {number} y, the y coordinate of the block to place.
     * @param {number} z, the z coordinate of the block to place.
     * @param {string} placeOn, the preferred side of the block to place on. Can be 'top', 'bottom', 'north', 'south', 'east', 'west', or 'side'. Defaults to bottom. Will place on first available side if not possible.
     * @param {boolean} dontCheat, overrides cheat mode to place the block normally. Defaults to false.
     * @returns {Promise<boolean>} true if the block was placed, false otherwise.
     * @example
     * let p = world.getPosition(bot);
     * await skills.placeBlock(bot, "oak_log", p.x + 2, p.y, p.x);
     * await skills.placeBlock(bot, "torch", p.x + 1, p.y, p.x, 'side');
     **/
    const target_dest = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));

    if (blockType === 'air') {
        log(bot, `Placing air (removing block) at ${target_dest}.`);
        return await breakBlockAt(bot, x, y, z);
    }

    if (bot.modes.isOn('cheat') && !dontCheat) {
        if (bot.restrict_to_inventory) {
            let block = bot.inventory.findInventoryItem(blockType);
            if (!block) {
                log(bot, `Cannot place ${blockType}, you are restricted to your current inventory.`);
                return false;
            }
        }

        // invert the facing direction
        let face = placeOn === 'north' ? 'south' : placeOn === 'south' ? 'north' : placeOn === 'east' ? 'west' : 'east';
        if (blockType.includes('torch') && placeOn !== 'bottom') {
            // insert wall_ before torch
            blockType = blockType.replace('torch', 'wall_torch');
            if (placeOn !== 'side' && placeOn !== 'top') {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType.includes('button') || blockType === 'lever') {
            if (placeOn === 'top') {
                blockType += `[face=ceiling]`;
            }
            else if (placeOn === 'bottom') {
                blockType += `[face=floor]`;
            }
            else {
                blockType += `[facing=${face}]`;
            }
        }
        if (blockType === 'ladder' || blockType === 'repeater' || blockType === 'comparator') {
            blockType += `[facing=${face}]`;
        }
        if (blockType.includes('stairs')) {
            blockType += `[facing=${face}]`;
        }
        if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
        let msg = '/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z) + ' ' + blockType;
        bot.chat(msg);
        if (blockType.includes('door'))
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y+1) + ' ' + Math.floor(z) + ' ' + blockType + '[half=upper]');
        if (blockType.includes('bed'))
            if (useDelay) { await new Promise(resolve => setTimeout(resolve, blockPlaceDelay)); }
            bot.chat('/setblock ' + Math.floor(x) + ' ' + Math.floor(y) + ' ' + Math.floor(z-1) + ' ' + blockType + '[part=head]');
        log(bot, `Used /setblock to place ${blockType} at ${target_dest}.`);
        return true;
    }

    let item_name = blockType;
    if (item_name == "redstone_wire")
        item_name = "redstone";
    else if (item_name === 'water') {
        item_name = 'water_bucket';
    }
    else if (item_name === 'lava') {
        item_name = 'lava_bucket';
    }
    let block_item = bot.inventory.findInventoryItem(item_name);
    if (!block_item && bot.game.gameMode === 'creative' && !bot.restrict_to_inventory) {
        await bot.creative.setInventorySlot(36, mc.makeItem(item_name, 1)); // 36 is first hotbar slot
        block_item = bot.inventory.findInventoryItem(item_name);
    }
    if (!block_item) {
        log(bot, `Don't have any ${item_name} to place.`);
        return false;
    }

    // v0.1.4.8 (B1): a refusal of the guard names its reason in the output. The guard judges the item
    // that will be placed, not the item in the hand: seeds in a farm are allowed while the hand holds a hoe.
    const refusal = guardRefusal(bot, target_dest, 'place', { item: item_name });
    if (refusal) {
        log(bot, refusalText(refusal, `I may not place ${blockType} at ${target_dest}.`));
        return false;
    }

    const targetBlock = bot.blockAt(target_dest);
    if (targetBlock.name === blockType || (targetBlock.name === 'grass_block' && blockType === 'dirt')) {
        log(bot, `${blockType} already at ${targetBlock.position}.`);
        return false;
    }
    const empty_blocks = ['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass', 'snow', 'dead_bush', 'fern'];
    if (!empty_blocks.includes(targetBlock.name)) {
        log(bot, `${targetBlock.name} in the way at ${targetBlock.position}.`);
        const removed = await breakBlockAt(bot, x, y, z);
        if (!removed) {
            log(bot, `Cannot place ${blockType} at ${targetBlock.position}: block in the way.`);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 200)); // wait for block to break
    }
    // get the buildoffblock and facevec based on whichever adjacent block is not empty
    let buildOffBlock = null;
    let faceVec = null;
    const dir_map = {
        'top': Vec3(0, 1, 0),
        'bottom': Vec3(0, -1, 0),
        'north': Vec3(0, 0, -1),
        'south': Vec3(0, 0, 1),
        'east': Vec3(1, 0, 0),
        'west': Vec3(-1, 0, 0),
    }
    let dirs = [];
    if (placeOn === 'side') {
        dirs.push(dir_map['north'], dir_map['south'], dir_map['east'], dir_map['west']);
    }
    else if (dir_map[placeOn] !== undefined) {
        dirs.push(dir_map[placeOn]);
    }
    else {
        dirs.push(dir_map['bottom']);
        log(bot, `Unknown placeOn value "${placeOn}". Defaulting to bottom.`);
    }
    dirs.push(...Object.values(dir_map).filter(d => !dirs.includes(d)));

    for (let d of dirs) {
        const block = bot.blockAt(target_dest.plus(d));
        if (!empty_blocks.includes(block.name)) {
            buildOffBlock = block;
            faceVec = new Vec3(-d.x, -d.y, -d.z); // invert
            break;
        }
    }
    if (!buildOffBlock) {
        log(bot, `Cannot place ${blockType} at ${targetBlock.position}: nothing to place on.`);
        return false;
    }

    const pos = bot.entity.position;
    const pos_above = pos.plus(Vec3(0,1,0));
    const dont_move_for = ['torch', 'redstone_torch', 'redstone', 'lever', 'button', 'rail', 'detector_rail', 
        'powered_rail', 'activator_rail', 'tripwire_hook', 'tripwire', 'water_bucket', 'string'];
    if (!dont_move_for.includes(item_name) && (pos.distanceTo(targetBlock.position) < 1.1 || pos_above.distanceTo(targetBlock.position) < 1.1)) {
        // too close
        let goal = new pf.goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
        let inverted_goal = new pf.goals.GoalInvert(goal);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await bot.pathfinder.goto(inverted_goal);
    }
    if (bot.entity.position.distanceTo(targetBlock.position) > 4.5) {
        // too far
        let pos = targetBlock.position;
        let movements = new pf.Movements(bot);
        bot.pathfinder.setMovements(movements);
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
        if (bot.interrupt_code)
            return false; // v0.1.4.8 (B3): the walk was stopped
    }

    // will throw error if an entity is in the way, and sometimes even if the block was placed
    try {
        if (item_name.includes('bucket')) {
            await useToolOnBlock(bot, item_name, buildOffBlock);
        }
        else {
            await bot.equip(block_item, 'hand');
            await bot.lookAt(buildOffBlock.position.offset(0.5, 0.5, 0.5));
            await bot.placeBlock(buildOffBlock, faceVec);
            log(bot, `Placed ${blockType} at ${target_dest}.`);
            await new Promise(resolve => setTimeout(resolve, 200));
            return true;
        }
    } catch (err) {
        if (err?.name === 'ProtectedAreaError')
            log(bot, err.message); // v0.1.4.8 (B1): the reason of the guard reaches the output
        log(bot, `Failed to place ${blockType} at ${target_dest}.`);
        return false;
    }
}

export async function equip(bot, itemName) {
    /**
     * Equip the given item to the proper body part, like tools or armor.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to equip.
     * @returns {Promise<boolean>} true if the item was equipped, false otherwise.
     * @example
     * await skills.equip(bot, "iron_pickaxe");
     **/
    if (itemName === 'hand') {
        await bot.unequip('hand');
        log(bot, `Unequipped hand.`);
        return true;
    }
    let item = bot.inventory.slots.find(slot => slot && slot.name === itemName);
    if (!item) {
        if (bot.game.gameMode === "creative") {
            await bot.creative.setInventorySlot(36, mc.makeItem(itemName, 1));
            item = bot.inventory.findInventoryItem(itemName);
        }
        else {
            log(bot, `You do not have any ${itemName} to equip.`);
            return false;
        }
    }
    if (itemName.includes('leggings')) {
        await bot.equip(item, 'legs');
    }
    else if (itemName.includes('boots')) {
        await bot.equip(item, 'feet');
    }
    else if (itemName.includes('helmet')) {
        await bot.equip(item, 'head');
    }
    else if (itemName.includes('chestplate') || itemName.includes('elytra')) {
        await bot.equip(item, 'torso');
    }
    else if (itemName.includes('shield')) {
        await bot.equip(item, 'off-hand');
    }
    else {
        await bot.equip(item, 'hand');
    }
    log(bot, `Equipped ${itemName}.`);
    return true;
}

export async function discard(bot, itemName, num=-1, walkAway=0) {
    /**
     * Discard the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to discard.
     * @param {number} num, the number of items to discard. Defaults to -1, which discards all items.
     * @param {number} walkAway, blocks to walk away before the items are tossed, for at most 3 seconds. Defaults to 0, which tosses where the bot stands.
     * @returns {Promise<boolean>} true if the item was discarded, false otherwise.
     * @example
     * await skills.discard(bot, "oak_log");
     **/
    // v0.1.4.8 (B6, S14): the walk away has a limit of 3 s; when it fails the items are tossed where the bot stands
    if (walkAway > 0 && world.getInventoryItem(bot, itemName))
        await walkAwayWithin(bot, walkAway, DISCARD_WALK_MS);
    let discarded = 0;
    let fromOffhand = false;
    while (true) {
        let item = bot.inventory.findInventoryItem(itemName);
        if (!item) {
            // v0.1.4.8 (B2, E1): toss() sees slots 9 to 44 only, a stack of the off-hand goes to the hand first
            const offhand = world.getOffhandItem(bot);
            if (fromOffhand || !offhand || offhand.name !== itemName)
                break;
            fromOffhand = true;
            await bot.equip(offhand, 'hand');
            continue;
        }
        let to_discard = num === -1 ? item.count : Math.min(num - discarded, item.count);
        await bot.toss(item.type, null, to_discard);
        discarded += to_discard;
        if (num !== -1 && discarded >= num) {
            break;
        }
    }
    if (discarded === 0) {
        log(bot, `You do not have any ${itemName} to discard.`);
        return false;
    }
    log(bot, `Discarded ${discarded} ${itemName}.`);
    return true;
}

export async function putInChest(bot, itemName, num=-1) {
    /**
     * Put the given item in the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to put in the chest.
     * @param {number} num, the number of items to put in the chest. Defaults to -1, which puts all items.
     * @returns {Promise<boolean>} true if the item was put in the chest, false otherwise.
     * @example
     * await skills.putInChest(bot, "oak_log");
     **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    let item = bot.inventory.findInventoryItem(itemName);
    if (!item) {
        log(bot, `You do not have any ${itemName} to put in the chest.`);
        return false;
    }
    let to_put = num === -1 ? item.count : Math.min(num, item.count);
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    await chestContainer.deposit(item.type, null, to_put);
    await chestContainer.close();
    log(bot, `Successfully put ${to_put} ${itemName} in the chest.`);
    return true;
}

export async function takeFromChest(bot, itemName, num=-1) {
    /**
     * Take the given item from the nearest chest, potentially from multiple slots.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item or block name to take from the chest.
     * @param {number} num, the number of items to take from the chest. Defaults to -1, which takes all items.
     * @returns {Promise<boolean>} true if the item was taken from the chest, false otherwise.
     * @example
     * await skills.takeFromChest(bot, "oak_log");
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    
    // Find all matching items in the chest
    let matchingItems = chestContainer.containerItems().filter(item => item.name === itemName);
    if (matchingItems.length === 0) {
        log(bot, `Could not find any ${itemName} in the chest.`);
        await chestContainer.close();
        return false;
    }
    
    let totalAvailable = matchingItems.reduce((sum, item) => sum + item.count, 0);
    let remaining = num === -1 ? totalAvailable : Math.min(num, totalAvailable);
    let totalTaken = 0;
    
    // Take items from each slot until we've taken enough or run out
    for (const item of matchingItems) {
        if (remaining <= 0) break;
        
        let toTakeFromSlot = Math.min(remaining, item.count);
        await chestContainer.withdraw(item.type, null, toTakeFromSlot);
        
        totalTaken += toTakeFromSlot;
        remaining -= toTakeFromSlot;
    }
    
    await chestContainer.close();
    log(bot, `Successfully took ${totalTaken} ${itemName} from the chest.`);
    return totalTaken > 0;
}

export async function viewChest(bot) {
    /**
     * View the contents of the nearest chest.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the chest was viewed, false otherwise.
     * @example
     * await skills.viewChest(bot);
     * **/
    let chest = world.getNearestBlock(bot, 'chest', 32);
    if (!chest) {
        log(bot, `Could not find a chest nearby.`);
        return false;
    }
    await goToPosition(bot, chest.position.x, chest.position.y, chest.position.z, 2);
    const chestContainer = await bot.openContainer(chest);
    let items = chestContainer.containerItems();
    log(bot, chestText(chest.position, items));
    await chestContainer.close();
    return true;
}

// v0.1.4.8 (B5, C3): one line, the same items added up, the largest count first. The output of an
// action is cut in the middle when it is long; a list of one line per stack lost its middle part.
function chestText(pos, items) {
    const at = `(${pos.x}, ${pos.y}, ${pos.z})`;
    const content = world.sumItemCounts(items);
    if (content.length === 0)
        return `The chest at ${at} is empty.`;
    return `The chest at ${at} contains: ${content.map(item => `${item.name} ${item.count}`).join(', ')}.`;
}

export async function consume(bot, itemName="") {
    /**
     * Eat/drink the given item.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemName, the item to eat/drink.
     * @returns {Promise<boolean>} true if the item was eaten, false otherwise.
     * @example
     * await skills.eat(bot, "apple");
     **/
    let item, name;
    if (itemName) {
        item = world.getInventoryItem(bot, itemName); // v0.1.4.8 (B2, E1): the off-hand too; equip below moves it to the hand
        name = itemName;
    }
    if (!item) {
        log(bot, `You do not have any ${name} to eat.`);
        return false;
    }
    // v0.1.4.8, fix round (X10): the lock for eating of the home pack; the hunger reflex and auto-eat do
    // not eat while it is held
    const lease = await acquireEatLock(bot, 'command');
    try {
        await bot.equip(item, 'hand');
        await bot.consume();
    } catch (err) {
        // X12: mineflayer refuses to eat with a full food level ("Food is full"): an answer, no exception
        if (/food is full/i.test(`${err?.message ?? err}`))
            log(bot, notHungryText(bot));
        else
            log(bot, `I could not eat the ${item.name}: ${err?.message ?? err}`);
        return false;
    } finally {
        lease.release();
    }
    log(bot, `Consumed ${item.name}.`);
    return true;
}

function notHungryText(bot) {
    return `I am not hungry. Food ${Math.round(bot.food ?? 20)} of 20.`;
}


export async function giveToPlayer(bot, itemType, username, num=1) {
    /**
     * Give one of the specified item to the specified player
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} itemType, the name of the item to give.
     * @param {string} username, the username of the player to give the item to.
     * @param {number} num, the number of items to give. Defaults to 1.
     * @returns {Promise<boolean>} true if the item was given, false otherwise.
     * @example
     * await skills.giveToPlayer(bot, "oak_log", "player1");
     **/
    if (bot.username === username) {
        log(bot, `You cannot give items to yourself.`);
        return false;
    }
    let player = bot.players[username].entity
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }
    await goToPlayer(bot, username, 3);
    // if we are 2 below the player
    if (bot.entity.position.y < player.position.y - 1) {
        await goToPlayer(bot, username, 1);
    }
    // if we are too close, make some distance
    if (bot.entity.position.distanceTo(player.position) < 2) {
        let too_close = true;
        let start_moving_away = Date.now();
        await moveAwayFromEntity(bot, player, 2);
        while (too_close && !bot.interrupt_code) {
            await new Promise(resolve => setTimeout(resolve, 500));
            too_close = bot.entity.position.distanceTo(player.position) < 5;
            if (too_close) {
                await moveAwayFromEntity(bot, player, 5);
            }
            if (Date.now() - start_moving_away > 3000) {
                break;
            }
        }
        if (too_close) {
            log(bot, `Failed to give ${itemType} to ${username}, too close.`);
            return false;
        }
    }

    await bot.lookAt(player.position);
    // v0.1.4.11, W5: the items the player picked up are counted; the text says how many he took and where the rest lie
    const before = world.getInventoryCounts(bot)[itemType] ?? 0;
    let taken = 0;
    let dropped = 0;
    const onCollect = (collector, collected) => {
        if (collector?.username !== username)
            return;
        const item = droppedItemOf(collected);
        if (item && item.name !== itemType)
            return;
        taken += Number.isFinite(item?.count) && item.count > 0 ? item.count : Math.max(1, dropped - taken);
    };
    bot.on('playerCollect', onCollect);
    try {
        if (await discard(bot, itemType, num)) {
            dropped = Math.max(0, before - (world.getInventoryCounts(bot)[itemType] ?? 0)) || num;
            let start = Date.now();
            while (taken < dropped && !bot.interrupt_code) {
                await new Promise(resolve => setTimeout(resolve, 500));
                if (Date.now() - start > 3000) {
                    break;
                }
            }
            if (taken >= dropped) {
                log(bot, GIVE_TEXTS.given(dropped, itemType, username));
                return true;
            }
            log(bot, GIVE_TEXTS.partly(username, taken, dropped, itemType, groundItemAt(bot, itemType) ?? bot.entity.position));
            return taken > 0;
        }
    } finally {
        bot.removeListener('playerCollect', onCollect);
    }
    log(bot, `Failed to give ${itemType} to ${username}, it was never received.`);
    return false;
}

// The item of a dropped item entity ({ name, count }), or null when it cannot be read.
function droppedItemOf(entity) {
    try {
        const item = typeof entity?.getDroppedItem === 'function' ? entity.getDroppedItem() : null;
        return item && typeof item.name === 'string' ? item : null;
    } catch (err) {
        return null;
    }
}

// The position of the dropped item of this name nearest to the bot, or null.
function groundItemAt(bot, itemType) {
    try {
        const me = bot.entity.position;
        let best = null;
        for (const entity of Object.values(bot.entities ?? {})) {
            if (entity?.name !== 'item' || !entity.position || droppedItemOf(entity)?.name !== itemType)
                continue;
            if (!best || entity.position.distanceTo(me) < best.position.distanceTo(me))
                best = entity;
        }
        return best ? best.position : null;
    } catch (err) {
        return null;
    }
}

export async function goToGoal(bot, goal) {
    /**
     * Navigate to the given goal. Use doors and attempt minimally destructive movements.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {pf.goals.Goal} goal, the goal to navigate to.
     * @returns {Promise<boolean>} true when the walk ended, false when it was interrupted.
     **/
    if (bot.interrupt_code)
        return false; // v0.1.4.8 (B3): a stopped action starts no walk

    const nonDestructiveMovements = new pf.Movements(bot);
    const dontBreakBlocks = ['glass', 'glass_pane'];
    for (let block of dontBreakBlocks) {
        nonDestructiveMovements.blocksCantBreak.add(mc.getBlockId(block));
    }
    nonDestructiveMovements.placeCost = 2;
    nonDestructiveMovements.digCost = 10;

    const destructiveMovements = new pf.Movements(bot);

    let final_movements = destructiveMovements;

    const pathfind_timeout = 1000;
    if (await bot.pathfinder.getPathTo(nonDestructiveMovements, goal, pathfind_timeout).status === 'success') {
        final_movements = nonDestructiveMovements;
        log(bot, `Found non-destructive path.`);
    }
    else if (await bot.pathfinder.getPathTo(destructiveMovements, goal, pathfind_timeout).status === 'success') {
        log(bot, `Found destructive path.`);
    }
    else {
        log(bot, `Path not found, but attempting to navigate anyway using destructive movements.`);
    }

    if (bot.interrupt_code)
        return false;

    return (await walkWith(bot, goal, final_movements)) === 'arrived';
}

// The walk of goToGoal with the chosen movements: with the old door timer, or through doors while the
// door reflex is on. Resolves as untilStopped; rejects with the error of the walk.
async function walkWith(bot, goal, movements, limitMs = 0) {
    const doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setMovements(movements);
    try {
        let walk;
        if (doorCheckInterval === null)
            walk = gotoThroughDoors(bot, goal, movements); // the door reflex is on (v0.1.4.6, F1)
        else
            walk = bot.pathfinder.goto(goal);
        return await untilStopped(bot, walk, limitMs);
    } finally {
        // also when the walk throws: the door check interval is cleaned up, the error goes on
        clearInterval(doorCheckInterval);
    }
}

// v0.1.4.8 (B3, S9): pathfinder.stop() is read only when the bot arrives at a node, so a walk went on
// after !stop. Like gotoGoal of the home pack, the interrupt is watched every 250 ms and the path
// search is ended with setGoal(null). Resolves 'arrived', 'interrupted' or (with limitMs) 'timeout';
// rejects with the error of the walk. A walk that fails because it was stopped counts as interrupted.
const WALK_WATCH_MS = 250;

function stopWalking(bot) {
    try {
        bot.pathfinder.setGoal(null);
    } catch (err) {
        // nothing to stop
    }
    try {
        if (typeof bot.clearControlStates === 'function')
            bot.clearControlStates();
    } catch (err) {
        // nothing to release
    }
}

function untilStopped(bot, walk, limitMs = 0) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        let done = false;
        let watch = null;
        const finish = (settle, value) => {
            if (done)
                return;
            done = true;
            clearInterval(watch);
            settle(value);
        };
        watch = setInterval(() => {
            const late = limitMs > 0 && Date.now() - start >= limitMs;
            if (!bot.interrupt_code && !late)
                return;
            stopWalking(bot);
            finish(resolve, bot.interrupt_code ? 'interrupted' : 'timeout');
        }, WALK_WATCH_MS);
        Promise.resolve(walk).then(
            () => finish(resolve, bot.interrupt_code ? 'interrupted' : 'arrived'),
            (err) => {
                if (bot.interrupt_code)
                    finish(resolve, 'interrupted');
                else
                    finish(reject, err);
            });
    });
}

// v0.1.4.6 (Amendment 2, F1): while the reflex door_closing of the home pack exists and is on, the
// pathfinder opens doors and gates and the reflex closes them. The toggle timer would fight it.
function doorReflexOn(bot) {
    try {
        return Boolean(bot.modes && bot.modes.exists && bot.modes.exists('door_closing') && bot.modes.isOn('door_closing'));
    } catch (err) {
        return false;
    }
}

// v0.1.4.6 (Amendment 2, F1): with the door reflex on, a walk that made no progress for 3 s within 2
// blocks of a door or gate between the bot and its goal goes through it with passThrough of the home
// pack (open, walk through, close), then the walk goes on. On the real server the path finder opened
// a fence gate and then stood at the corner of the gate for ever.
function goalPoint(goal) {
    if (goal && goal.entity && goal.entity.position)
        return goal.entity.position;
    if (goal && Number.isFinite(goal.x) && Number.isFinite(goal.z))
        return { x: goal.x + 0.5, y: Number.isFinite(goal.y) ? goal.y : 0, z: goal.z + 0.5 }; // sideOf uses x and z
    return null;
}

function doorInTheWay(bot, target) {
    // a door or fence gate within 2 blocks, the bot on one side of it and the target on the other
    if (!target)
        return null;
    for (const door of findOpenables(bot, 2)) {
        const there = sideOf(door, target);
        if (door.kind !== 'trapdoor' && there !== 0 && sideOf(door, bot.entity.position) !== there)
            return door;
    }
    return null;
}

async function passStuckDoor(bot, door) {
    // v0.1.4.8, fix round (X13): the text names what it is: door, gate or trapdoor
    const kind = door.kind === 'gate' || door.kind === 'trapdoor' ? door.kind : 'door';
    log(bot, `I am stuck at the ${kind} at (${door.x}, ${door.y}, ${door.z}). I walk through it.`);
    const result = await passThrough(bot, door, { log: (text) => log(bot, text) }, { allowDig: false });
    return result.ok === true;
}

// v0.1.4.8 (B3, S11): a goal away from a point (GoalInvert, as in moveAway) has no side to walk to,
// so goalPoint() is null for it. The door or gate next to the stuck bot is the way out.
function isAwayGoal(goal) {
    return goal instanceof pf.goals.GoalInvert;
}

function doorNextTo(bot) {
    return findOpenables(bot, 2).find(door => door.kind !== 'trapdoor') ?? null;
}

function isAway(bot, goal) {
    try {
        return goal.isEnd(bot.entity.position.floored());
    } catch (err) {
        return true; // no help without a position
    }
}

// The nearest two doors, gates or trapdoors within 3 blocks: a door or gate is passed with passThrough
// of the home pack (open, walk through, close); a closed trapdoor is opened, the door service closes
// it later. true when the way out changed.
async function openWayOut(bot) {
    const me = bot.entity.position;
    const doors = findOpenables(bot, 3)
        .map(door => ({ door, d: Math.hypot(door.x + 0.5 - me.x, door.y - me.y, door.z + 0.5 - me.z) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map(entry => entry.door);
    for (const door of doors) {
        if (bot.interrupt_code)
            return false;
        if (door.kind === 'trapdoor') {
            if (door.open || !(await openDoor(bot, door)))
                continue;
            log(bot, `I opened the ${door.name} at (${door.x}, ${door.y}, ${door.z}).`);
            return true;
        }
        if (await passStuckDoor(bot, door))
            return true;
    }
    return false;
}

async function gotoThroughDoors(bot, goal, movements) {
    for (let tries = 0; ; tries++) {
        let stuckAt = null;
        let last = bot.entity.position.clone();
        let since = Date.now();
        const watch = tries < 2 ? setInterval(() => {
            try {
                const pos = bot.entity.position;
                if (pos.distanceTo(last) >= 0.1) {
                    last = pos.clone();
                    since = Date.now();
                }
                else if (stuckAt === null && !bot.interrupt_code && Date.now() - since >= 3000) {
                    stuckAt = isAwayGoal(goal) ? doorNextTo(bot) : doorInTheWay(bot, goalPoint(goal));
                    if (stuckAt)
                        bot.pathfinder.setGoal(null); // goto rejects with GoalChanged
                }
            } catch (err) {
                // the walk goes on without help
            }
        }, 250) : null;
        try {
            await bot.pathfinder.goto(goal);
            return;
        } catch (err) {
            if (stuckAt === null || bot.interrupt_code)
                throw err;
        } finally {
            clearInterval(watch);
        }
        await passStuckDoor(bot, stuckAt);
        if (bot.interrupt_code)
            return;
        bot.pathfinder.setMovements(movements);
    }
}

// v0.1.4.8, fix round (X7): the timer only opens. The path search of mineflayer-pathfinder (patched)
// opens a closed door itself and then heads for the corner of the door block, because it does not
// centre the points of the path behind a door it opens; the bot stands still at the door frame. The
// timer toggled every door next to a bot that stood still for 1.2 s, so it closed the door that the path
// search had just opened; the next path went through a closed door again, and the two swung the door for
// 60 s in 1 of 4 runs of the world test flags_off (the timer and the path search are those of v0.1.4.7).
// A door that stays open lets the path search plan through the open door, and the bot walks through it.
function isOpenBlock(block) {
    try {
        const props = typeof block.getProperties === 'function' ? block.getProperties() : block._properties;
        return props?.open === true || props?.open === 'true';
    } catch (err) {
        return false;
    }
}

let _doorInterval = null;
function startDoorInterval(bot) {
    /**
     * Start helper interval that opens nearby doors if the bot is stuck.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {number} the interval id, or null while the door reflex of the home pack is on.
     **/
    if (_doorInterval) {
        clearInterval(_doorInterval);
        _doorInterval = null;
    }
    if (doorReflexOn(bot)) {
        return null;
    }
    let prev_pos = bot.entity.position.clone();
    let prev_check = Date.now();
    let stuck_time = 0;


    const doorCheckInterval = setInterval(() => {
        const now = Date.now();
        if (bot.entity.position.distanceTo(prev_pos) >= 0.1) {
            stuck_time = 0;
        } else {
            stuck_time += now - prev_check;
        }
        
        if (stuck_time > 1200) {
            // shuffle positions so we're not always opening the same door
            const positions = [
                bot.entity.position.clone(),
                bot.entity.position.offset(0, 0, 1),
                bot.entity.position.offset(0, 0, -1), 
                bot.entity.position.offset(1, 0, 0),
                bot.entity.position.offset(-1, 0, 0),
            ]
            let elevated_positions = positions.map(position => position.offset(0, 1, 0));
            positions.push(...elevated_positions);
            positions.push(bot.entity.position.offset(0, 2, 0)); // above head
            positions.push(bot.entity.position.offset(0, -1, 0)); // below feet
            
            let currentIndex = positions.length;
            while (currentIndex != 0) {
                let randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex--;
                [positions[currentIndex], positions[randomIndex]] = [
                positions[randomIndex], positions[currentIndex]];
            }
            
            for (let position of positions) {
                let block = bot.blockAt(position);
                if (block && block.name &&
                    !block.name.includes('iron') &&
                    (block.name.includes('door') ||
                     block.name.includes('fence_gate') ||
                     block.name.includes('trapdoor')) &&
                    !isOpenBlock(block))
                {
                    bot.activateBlock(block);
                    break;
                }
            }
            stuck_time = 0;
        }
        prev_pos = bot.entity.position.clone();
        prev_check = now;
    }, 200);
    _doorInterval = doorCheckInterval;
    return doorCheckInterval;
}

export async function goToPosition(bot, x, y, z, min_distance=2) {
    /**
     * Navigate to the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to navigate to. If null, the bot's current x coordinate will be used.
     * @param {number} y, the y coordinate to navigate to. If null, the bot's current y coordinate will be used.
     * @param {number} z, the z coordinate to navigate to. If null, the bot's current z coordinate will be used.
     * @param {number} distance, the distance to keep from the position. Defaults to 2.
     * @returns {Promise<boolean>} true if the position was reached, false otherwise.
     * @example
     * let position = world.world.getNearestBlock(bot, "oak_log", 64).position;
     * await skills.goToPosition(bot, position.x, position.y, position.x + 20);
     **/
    if (x == null || y == null || z == null) {
        log(bot, `Missing coordinates, given x:${x} y:${y} z:${z}`);
        return false;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
        log(bot, `Teleported to ${x}, ${y}, ${z}.`);
        return true;
    }
    
    const target = new Vec3(x, y, z);
    let nearest = bot.entity.position.distanceTo(target);
    const checkDigProgress = () => {
        if (bot.targetDigBlock) {
            const targetBlock = bot.targetDigBlock;
            const itemId = bot.heldItem ? bot.heldItem.type : null;
            if (!targetBlock.canHarvest(itemId)) {
                log(bot, `Pathfinding stopped: Cannot break ${targetBlock.name} with current tools.`);
                bot.pathfinder.stop();
                bot.stopDigging();
            }
        }
        noteWalkProgress();
    };
    // v0.1.4.8 (B3, I1): progress for the reflex unstuck while the path search walks the bot nearer to
    // the goal. A bot that the path search pushes against a wall comes no nearer and notes nothing.
    const noteWalkProgress = () => {
        try {
            const d = bot.entity.position.distanceTo(target);
            if (d <= nearest - WALK_PROGRESS_STEP) {
                nearest = d;
                if (bot.pathfinder.isMoving?.())
                    bot.modes?.noteProgress?.('path');
            }
        } catch (err) {
            // no progress noted
        }
    };
    
    const progressInterval = setInterval(checkDigProgress, 1000);

    try {
        // v0.1.4.9 (L4 of the play test, "no idea about up and down"; a correction of the path search, no switch):
        // the ladder step when the path search ends with the goal still 2 or more blocks above or below; then the
        // path search once more. The texts stay those of v0.1.4.8. v0.1.4.10 (P6): the path search climbs and
        // descends ladders itself, so the step before it is gone; the step is the fallback.
        const passes = [];
        let failure = null;
        const makeGoal = () => new pf.goals.GoalNear(x, y, z, min_distance);
        if (!bot.interrupt_code) {
            try {
                await walkWatchingLadders(bot, makeGoal, target, passes); // F33: the step mid-walk
            } catch (err) {
                failure = err;
            }
        }
        if (!bot.interrupt_code && ladderGap(bot, target) >= LADDER_GAP && bot.entity.position.distanceTo(target) > min_distance + 1
            && (await ladderTowards(bot, target, passes)).tried && !bot.interrupt_code) {
            failure = null;
            await walkWatchingLadders(bot, makeGoal, target, passes);
        }
        if (failure)
            throw failure;
        clearInterval(progressInterval);
        // v0.1.4.8 (B3, P5): the text names where the bot is, not the goal again
        const distance = bot.entity.position.distanceTo(target);
        if (distance <= min_distance+1) {
            log(bot, `You have reached ${positionText(bot)}.`);
            return true;
        }
        else {
            log(bot, `I stopped at ${positionText(bot)}, ${Math.round(distance)} blocks from the goal.`);
            return false;
        }
    } catch (err) {
        log(bot, `Pathfinding stopped: ${err.message}.`);
        clearInterval(progressInterval);
        log(bot, `I stopped at ${positionText(bot)}, ${Math.round(bot.entity.position.distanceTo(target))} blocks from the goal.`);
        return false;
    }
}

const WALK_PROGRESS_STEP = 0.5; // blocks nearer to the goal than before

function positionText(bot) {
    const p = bot.entity.position;
    return `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}

export async function goToNearestBlock(bot, blockType,  min_distance=2, range=64) {
    /**
     * Navigate to the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} blockType, the type of block to navigate to.
     * @param {number} min_distance, the distance to keep from the block. Defaults to 2.
     * @param {number} range, the range to look for the block. Defaults to 64.
     * @returns {Promise<boolean>} true if the block was reached, false otherwise.
     * @example
     * await skills.goToNearestBlock(bot, "oak_log", 64, 2);
     * **/
    const MAX_RANGE = 512;
    if (range > MAX_RANGE) {
        log(bot, `Maximum search range capped at ${MAX_RANGE}. `);
        range = MAX_RANGE;
    }
    let block = null;
    if (blockType === 'water' || blockType === 'lava') {
        let blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType && block.metadata === 0, range, 1);
        if (blocks.length === 0) {
            log(bot, `Could not find any source ${blockType} in ${range} blocks, looking for uncollectable flowing instead...`);
            blocks = world.getNearestBlocksWhere(bot, block => block.name === blockType, range, 1);
        }
        block = blocks[0];
    }
    else {
        block = world.getNearestBlock(bot, blockType, range);
    }
    if (!block) {
        log(bot, `Could not find any ${blockType} in ${range} blocks.`);
        return false;
    }
    log(bot, `Found ${blockType} at ${block.position}. Navigating...`);
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, min_distance);
    return true;
}

export async function goToNearestEntity(bot, entityType, min_distance=2, range=64) {
    /**
     * Navigate to the nearest entity of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} entityType, the type of entity to navigate to.
     * @param {number} min_distance, the distance to keep from the entity. Defaults to 2.
     * @param {number} range, the range to look for the entity. Defaults to 64.
     * @returns {Promise<boolean>} true if the entity was reached, false otherwise.
     **/
    let entity = world.getNearestEntityWhere(bot, entity => entity.name === entityType, range);
    if (!entity) {
        log(bot, `Could not find any ${entityType} in ${range} blocks.`);
        return false;
    }
    let distance = bot.entity.position.distanceTo(entity.position);
    log(bot, `Found ${entityType} ${distance} blocks away.`);
    await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z, min_distance);
    return true;
}

// v0.1.4.9 (section 13, part L, F14 of the play test; fixes of W75 and L4): the path search climbs a ladder
// but never descends one, and it stops in the cell of an open trapdoor above a ladder. goToPosition, goToPlayer
// and followPlayer go down or up a column of ladders within 6 blocks with ladderStepTowards (ladder_pass.js, the
// ladder walking of the mining pack, loaded with import() on the first pass): when the path search ends with the
// target still 2 or more blocks above or below (v0.1.4.10, P6: no longer before it, the path search climbs and
// descends ladders itself), and mid-walk when the bot stands still; followPlayer when it stands still. At most 3 passes
// a minute per call. Decision of the owner and the tech lead: a correction of a defect of the path search, so no
// switch (it ran behind routes_pack first); the routes pack keeps its switch for the trail and the routes.
const LADDER_GAP = 2; // blocks of height between the feet of the bot and the target

function ladderGap(bot, target) {
    try {
        return Math.abs(target.y - bot.entity.position.y);
    } catch (err) {
        return 0;
    }
}

function feetCellOf(bot) {
    const p = bot.entity.position;
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

// The ladder step of goToPosition and goToPlayer: the text of a pass that failed goes to the log. Never throws.
async function ladderTowards(bot, target, passes, after = null) {
    const step = await ladderStepTowards(bot, target, { after, passes, log: (text) => log(bot, text) });
    // v0.1.4.10: a pass that ran out of time while the bot still arrived (the path search finished the climb)
    // claims no failure: the text is logged only while the target is still 2 or more blocks above or below
    if (step.tried && !step.ok && step.reason !== 'interrupted' && ladderGap(bot, target) >= LADDER_GAP)
        log(bot, step.text);
    return step;
}

// F33 of the journeys (W84, D): the path search plans through the closed trapdoor over a ladder, walks the bot
// to the top of the column and holds it there until the reflex unstuck stops the command; the ladder step after
// the path search never came. The walk of goToPosition and goToPlayer is watched as followPlayer watches its
// own: the bot still in its cell for 3 s (bobbing does not count as moving), the target 2 or more blocks above
// or below and a column near that leads towards it, then the path search is stopped with setGoal(null) for the
// ladder step and started again. At most 3 passes a minute (`passes`); each stop is followed by a walk.
// Rejects with the error of the walk, as goToGoal; returns without a value when the command was stopped.
// v0.1.4.11 (N2): `walk(goal)` walks instead of goToGoal (goToPlayer: without digging, no destructive fallback).
const LADDER_STILL_MS = 3000;

async function walkWatchingLadders(bot, makeGoal, target, passes, after = null, walk = null) {
    let failure = null;
    for (let rounds = 0; rounds <= STEP_RULES.perMinute; rounds++) {
        let wanted = false;
        let cell = feetCellOf(bot);
        let gap = ladderGap(bot, target);
        let since = Date.now();
        const watch = setInterval(() => {
            try {
                const c = feetCellOf(bot);
                const g = ladderGap(bot, target);
                if (c.x !== cell.x || c.z !== cell.z || g < gap - 0.5) {
                    cell = c;
                    gap = g;
                    since = Date.now();
                }
                else if (!wanted && !bot.interrupt_code && Date.now() - since >= LADDER_STILL_MS && g >= LADDER_GAP
                    && ladderWayTowards(bot, target)) {
                    wanted = true;
                    bot.pathfinder.setGoal(null); // goto rejects with GoalChanged
                }
            } catch (err) {
                // the walk goes on without the step
            }
        }, 500);
        failure = null;
        try {
            if (walk)
                await walk(makeGoal());
            else
                await goToGoal(bot, makeGoal());
        } catch (err) {
            failure = err;
        } finally {
            clearInterval(watch);
        }
        if (bot.interrupt_code)
            return;
        if (!wanted)
            break;
        failure = null; // the walk was stopped for the step
        if (!(await ladderTowards(bot, target, passes, after)).tried || bot.interrupt_code)
            break;
    }
    if (failure)
        throw failure;
}


const PLAYER_WAIT_MS = 2000; // F38: how long goToPlayer waits for the entity of the player

// v0.1.4.11 (N2, a correction, no switch): goToPlayer and followPlayer never dig toward the player. Their path search
// has no digging and no destructive fallback; when the search proves within its range that no walk reaches the
// player, they say so and stop. A walk of these two that enters a cave (open air 3 wide and 3 high around the bot
// under a natural ceiling, in no saved area, no block the bot placed within 8 blocks), while the player is not under
// such a ceiling himself, stops once and says so. Other walks keep the fallback of goToGoal.
const NO_WAY_TO_PLAYER = 'I find no way to you from here without digging. Come closer or tell me to dig.';
const PLAYER_SEARCH = { radius: 48, timeoutMs: 3000, everyMs: 5000 }; // the search for a way without digging
const CAVE_RULES = { placedRange: 8, ceiling: 24, againRange: 16, againMs: 600000, everyMs: 500 };
const caveStops = new WeakMap(); // bot -> { x, y, z, at }: the last stop at a cave; "go on" walks past it

function caveText(at) {
    return `I stopped at (${at.x}, ${at.y}, ${at.z}): ahead is a cave. Tell me to go on if you want.`;
}

function noDigMovements(bot) {
    const movements = new pf.Movements(bot);
    movements.canDig = false;
    return movements;
}

// The walk of goToPlayer: without digging, as goToGoal walks once it has chosen its movements.
async function walkWithoutDigging(bot, goal) {
    if (bot.interrupt_code)
        return false;
    return (await walkWith(bot, goal, noDigMovements(bot))) === 'arrived';
}

// 'none' when the path search proves that no walk without digging reaches the goal within its range (48 blocks of
// cost beyond the straight way), 'way' when it finds one, 'unknown' when it ran out of time, was stopped or cannot be
// asked. Never throws.
async function wayWithoutDigging(bot, goal, movements = noDigMovements(bot)) {
    try {
        const finder = bot.pathfinder;
        let status = null;
        if (typeof finder?.getPathFromTo === 'function') {
            const search = finder.getPathFromTo(movements, bot.entity.position, goal,
                { timeout: PLAYER_SEARCH.timeoutMs, searchRadius: PLAYER_SEARCH.radius, optimizePath: false });
            for (;;) {
                const step = search.next();
                if (step.done)
                    break;
                status = step.value?.result?.status ?? null;
                if (status !== 'partial')
                    break;
                await new Promise(resolve => setImmediate(resolve));
                if (bot.interrupt_code)
                    return 'unknown';
            }
        }
        else if (typeof finder?.getPathTo === 'function') {
            status = (await finder.getPathTo(movements, goal, PLAYER_SEARCH.timeoutMs))?.status ?? null;
        }
        return status === 'noPath' ? 'none' : (status === 'success' ? 'way' : 'unknown');
    } catch (err) {
        return 'unknown';
    }
}

const BUILT_PREFIXES = ['smooth_', 'polished_', 'cut_', 'chiseled_', 'cobble', 'mossy_cobble', 'infested_'];
const NATURAL_CEILING = /(^stone|deepslate|^dirt|gravel|granite|diorite|andesite|tuff|calcite|_ore|^clay|sand$|sandstone|netherrack|basalt|bedrock|dripstone_block|^mud$|moss_block|^obsidian|coarse_dirt|rooted_dirt|amethyst_block|^grass_block)$/;

// A natural block of the rock around a cave (stone, deepslate, dirt, ores ...); no built block.
function isNaturalCeiling(bot, name) {
    if (typeof name !== 'string' || BUILT_PREFIXES.some(p => name.startsWith(p)) || !NATURAL_CEILING.test(name))
        return false;
    try {
        return bot.areaGuard?.isBuilt?.(name) !== true;
    } catch (err) {
        return true;
    }
}

function openForCave(bot, x, y, z) {
    const b = bot.blockAt(new Vec3(x, y, z));
    return Boolean(b) && b.boundingBox === 'empty' && b.name !== 'water' && b.name !== 'lava' && b.name !== 'bubble_column';
}

// True when the first block above (x, y, z) that is not open, within 24 blocks, is natural rock: under the ground.
function underRock(bot, x, y, z) {
    for (let dy = 0; dy <= CAVE_RULES.ceiling; dy++) {
        const b = bot.blockAt(new Vec3(x, y + dy, z));
        if (!b)
            return false;
        if (b.boundingBox === 'empty')
            continue;
        return isNaturalCeiling(bot, b.name);
    }
    return false;
}

// The cell of a cave at the feet (N2), or null: open air 3 wide and 3 high around the feet, natural rock above, in
// no saved area, and no block the bot placed (placed.json, through bot.areaGuard) within 8 blocks. Never throws.
function caveAt(bot, pos) {
    try {
        const x = Math.floor(pos.x);
        const y = Math.floor(pos.y + 0.01);
        const z = Math.floor(pos.z);
        for (let dx = -1; dx <= 1; dx++)
            for (let dz = -1; dz <= 1; dz++)
                for (let dy = 0; dy <= 2; dy++)
                    if (!openForCave(bot, x + dx, y + dy, z + dz))
                        return null;
        if (!underRock(bot, x, y + 3, z))
            return null;
        const guard = bot.areaGuard;
        if (guard?.areaAt?.({ x: x + 0.5, y, z: z + 0.5 }))
            return null;
        if (typeof guard?.placedByBot === 'function') {
            const r = CAVE_RULES.placedRange;
            for (let dx = -r; dx <= r; dx++)
                for (let dy = -r; dy <= r; dy++)
                    for (let dz = -r; dz <= r; dz++)
                        if (guard.placedByBot({ x: x + dx, y: y + dy, z: z + dz }))
                            return null;
        }
        return { x, y, z };
    } catch (err) {
        return null;
    }
}

// True when the player stands under natural rock: the goal is in the cave (or underground with it).
function playerUnderRock(bot, pos) {
    try {
        return underRock(bot, Math.floor(pos.x), Math.floor(pos.y + 0.01) + 2, Math.floor(pos.z));
    } catch (err) {
        return false;
    }
}

// The cave watch of one walk of goToPlayer or followPlayer (N2): every 500 ms, the first cave cell the bot enters
// while the player is not under rock ends the walk once (setGoal(null)); `at` is that cell. Not when the walk
// started in a cave, nor within 16 blocks of the last stop at a cave of the last 10 minutes (the player said go on).
// check() looks once (followPlayer); start() watches with a timer that stop() clears (goToPlayer).
function caveWatch(bot, playerPos) {
    const me = bot.entity.position;
    const last = caveStops.get(bot);
    const passed = last && Date.now() - last.at <= CAVE_RULES.againMs
        && Math.hypot(me.x - last.x, me.y - last.y, me.z - last.z) <= CAVE_RULES.againRange;
    const watch = { at: null, off: Boolean(passed) || caveAt(bot, me) !== null, timer: null };
    watch.check = () => {
        if (watch.off || watch.at || bot.interrupt_code)
            return watch.at;
        const cell = caveAt(bot, bot.entity.position);
        if (cell && !playerUnderRock(bot, playerPos())) {
            watch.at = cell;
            caveStops.set(bot, { ...cell, at: Date.now() });
            try {
                bot.pathfinder.setGoal(null); // goto rejects with GoalChanged
            } catch (err) {
                // the walk ends by itself
            }
        }
        return watch.at;
    };
    watch.start = () => {
        if (!watch.off)
            watch.timer = setInterval(watch.check, CAVE_RULES.everyMs);
        return watch;
    };
    watch.stop = () => clearInterval(watch.timer);
    return watch;
}

async function playerEntity(bot, username, waitMs) {
    const end = Date.now() + waitMs;
    for (;;) {
        const entity = bot.players?.[username]?.entity ?? null;
        if (entity || bot.interrupt_code || Date.now() >= end)
            return entity;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

export async function goToPlayer(bot, username, distance=3) {
    /**
     * Navigate to the given player.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to navigate to.
     * @param {number} distance, the goal distance to the player.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.goToPlayer(bot, "player");
     **/
    if (bot.username === username) {
        log(bot, `You are already at ${username}.`);
        return true;
    }
    if (bot.modes.isOn('cheat')) {
        bot.chat('/tp @s ' + username);
        log(bot, `Teleported to ${username}.`);
        return true;
    }

    bot.modes.pause('self_defense');
    bot.modes.pause('cowardice');
    // F38 of the journeys (W82): right after the player moved between floors their entity was not loaded for a
    // moment and "come here" answered "Could not find" at once. The entity is awaited for up to 2 s.
    let player = await playerEntity(bot, username, PLAYER_WAIT_MS);
    if (!player) {
        log(bot, `Could not find ${username}.`);
        return false;
    }

    distance = Math.max(distance, 0.5);
    const goal = new pf.goals.GoalFollow(player, distance);

    // v0.1.4.11 (N2): no digging toward the player; without a walk within the search range the bot says so and stops
    const way = await wayWithoutDigging(bot, goal);
    if (way === 'none') {
        log(bot, NO_WAY_TO_PLAYER);
        return false;
    }
    if (way === 'way')
        log(bot, `Found non-destructive path.`); // the line of goToGoal, which goToPlayer no longer calls
    if (bot.interrupt_code)
        return;
    const walk = (g) => walkWithoutDigging(bot, g);
    const cave = caveWatch(bot, () => player.position).start();

    // v0.1.4.9 (section 13, F14; W75, L1): the ladder step when the path search ends with the player still 2 or
    // more blocks above or below, then the path search once more. v0.1.4.10 (P6): no step before the path search,
    // which climbs and descends ladders itself; the step is the fallback.
    const passes = [];
    let failure = null;
    try {
        try {
            await walkWatchingLadders(bot, () => goal, player.position, passes, username, walk); // F33: the step mid-walk
        } catch (err) {
            failure = err;
        }
        if (!cave.at && !bot.interrupt_code && ladderGap(bot, player.position) >= LADDER_GAP
            && (await ladderTowards(bot, player.position, passes, username)).tried) {
            if (bot.interrupt_code)
                return;
            failure = null;
            try {
                await walkWatchingLadders(bot, () => goal, player.position, passes, username, walk);
            } catch (err) {
                failure = err;
            }
        }
    } finally {
        cave.stop();
    }
    if (cave.at && !bot.interrupt_code) {
        log(bot, caveText(cave.at));
        return false;
    }
    if (failure && !bot.interrupt_code && failure.name === 'NoPath') {
        log(bot, NO_WAY_TO_PLAYER); // N2: the walk found no way without digging
        return false;
    }
    if (failure)
        throw failure;
    if (bot.interrupt_code)
        return;

    // W75, L1: "reached" only within the asked distance, measured as the goal of the path search measures it
    const near = bot.entity.position.floored().distanceTo(player.position.floored());
    if (near <= distance)
        log(bot, `You have reached ${username}.`);
    else
        log(bot, `I stopped at ${positionText(bot)}, ${Math.round(bot.entity.position.distanceTo(player.position))} blocks from ${username}.`);
}

export async function followPlayer(bot, username, distance=4) {
    /**
     * Follow the given player endlessly. Will not return until the code is manually stopped.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} username, the username of the player to follow.
     * @returns {Promise<boolean>} true if the player was found, false otherwise.
     * @example
     * await skills.followPlayer(bot, "player");
     **/
    let player = bot.players[username].entity
    if (!player)
        return false;

    // v0.1.4.11 (N2): the follow never digs toward the player; without a walk within the search range it says so and stops
    const move = noDigMovements(bot);
    if (await wayWithoutDigging(bot, new pf.goals.GoalFollow(player, distance), move) === 'none') {
        log(bot, NO_WAY_TO_PLAYER);
        return false;
    }
    const cave = caveWatch(bot, () => player.position);
    let way_checked = Date.now();
    bot.pathfinder.setMovements(move);
    let doorCheckInterval = startDoorInterval(bot);

    bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
    log(bot, `You are now actively following player ${username}.`);

    // v0.1.4.6 (Amendment 2, F1): with the door reflex on, a door or gate the bot is stuck at is passed with passThrough
    let stuck_pos = bot.entity.position.clone();
    let stuck_since = Date.now();
    let door_helps = 0;
    // v0.1.4.9 (section 13, F14): the ladder step (a correction, no switch). Its own clock of standing still: the one
    // of the doors restarts near the player. W75, L2: the clock looks at the cell of the feet (x and z) and at the
    // progress towards the height of the player, so that bobbing under a closed trapdoor counts as standing still;
    // a player 2 or more blocks above or below with a column within 6 blocks is the trigger, at any distance.
    let still_cell = feetCellOf(bot);
    let still_gap = ladderGap(bot, player.position);
    let still_since = Date.now();
    let player_at = player.position.clone(); // v0.1.4.10 (P6): where the player was half a second ago
    const ladder_passes = []; // the times of the passes of the last minute
    const ladder_failures = new Set(); // the texts of failed passes, each written once

    while (!bot.interrupt_code) {
        await new Promise(resolve => setTimeout(resolve, 500));
        // in cheat mode, if the distance is too far, teleport to the player
        const distance_from_player = bot.entity.position.distanceTo(player.position);

        { // the ladder step
            const cell = feetCellOf(bot);
            const gap = ladderGap(bot, player.position);
            // still_gap is the smallest height difference since the clock started: bobbing does not beat it
            // v0.1.4.10 (P6): the clock runs only while the player is 2 or more blocks above or below and stands still, so
            // that the path search, which climbs and descends ladders itself, has its 3 s before the fallback step (a
            // player still on the ladder is followed by the path search once it is out)
            const player_moved = player.position.distanceTo(player_at) >= 0.3;
            player_at = player.position.clone();
            if (cell.x !== still_cell.x || cell.z !== still_cell.z || gap < still_gap - 0.5 || gap < LADDER_GAP || player_moved) {
                still_cell = cell;
                still_gap = gap;
                still_since = Date.now();
            }
            const idle = Date.now() - still_since >= 3000 || !bot.pathfinder.goal;
            // v0.1.4.10 (P6): a stop clears the goal of the path search; that is no reason for the step
            if (idle && gap >= LADDER_GAP && !bot.interrupt_code) {
                // the path search is stopped only when a pass begins
                const step = await ladderStepTowards(bot, player.position, { after: username, passes: ladder_passes,
                    log: (text) => log(bot, text), onPass: () => bot.pathfinder.setGoal(null) });
                if (bot.interrupt_code)
                    break;
                if (step.tried) {
                    if (!step.ok && !ladder_failures.has(step.text) && ladderGap(bot, player.position) >= LADDER_GAP) {
                        ladder_failures.add(step.text); // a pass that ran out of time while the bot arrived claims no failure
                        log(bot, step.text);
                    }
                    bot.pathfinder.setMovements(move);
                    bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
                    still_cell = feetCellOf(bot);
                    still_gap = ladderGap(bot, player.position);
                    still_since = Date.now();
                    stuck_pos = bot.entity.position.clone();
                    stuck_since = still_since;
                    continue;
                }
            }
        }

        const teleport_distance = 100;
        const ignore_modes_distance = 30;
        const nearby_distance = distance + 2;

        // v0.1.4.11 (N2): a follow that enters a cave stops once and says so
        if (cave.check()) {
            log(bot, caveText(cave.at));
            clearInterval(doorCheckInterval);
            return false;
        }
        // v0.1.4.11 (N2): a bot that stands still away from the player asks the path search, at most every 5 s,
        // whether a walk without digging is left; when none is, it says so and stops
        if (distance_from_player > nearby_distance && bot.entity.position.distanceTo(stuck_pos) < 0.1
            && Date.now() - stuck_since >= 3000 && Date.now() - way_checked >= PLAYER_SEARCH.everyMs) {
            way_checked = Date.now();
            if (await wayWithoutDigging(bot, new pf.goals.GoalFollow(player, distance), noDigMovements(bot)) === 'none') {
                if (bot.interrupt_code)
                    break;
                bot.pathfinder.setGoal(null);
                log(bot, NO_WAY_TO_PLAYER);
                clearInterval(doorCheckInterval);
                return false;
            }
            if (bot.interrupt_code)
                break;
        }

        if (bot.entity.position.distanceTo(stuck_pos) >= 0.1 || distance_from_player <= nearby_distance) {
            stuck_pos = bot.entity.position.clone();
            stuck_since = Date.now();
            if (distance_from_player <= nearby_distance)
                door_helps = 0;
        }
        else if (doorCheckInterval === null && door_helps < 3 && Date.now() - stuck_since >= 3000 && doorReflexOn(bot)) {
            const door = doorInTheWay(bot, player.position);
            if (door) {
                door_helps++;
                bot.pathfinder.setGoal(null);
                await passStuckDoor(bot, door);
                if (bot.interrupt_code)
                    break;
                bot.pathfinder.setMovements(move);
                bot.pathfinder.setGoal(new pf.goals.GoalFollow(player, distance), true);
                stuck_pos = bot.entity.position.clone();
                stuck_since = Date.now();
            }
        }

        if (distance_from_player > teleport_distance && bot.modes.isOn('cheat')) {
            // teleport with cheat mode
            await goToPlayer(bot, username);
        }
        else if (distance_from_player > ignore_modes_distance) {
            // these modes slow down the bot, and we want to catch up
            bot.modes.pause('item_collecting');
            bot.modes.pause('hunting');
            bot.modes.pause('torch_placing');
        }
        else if (distance_from_player <= ignore_modes_distance) {
            bot.modes.unpause('item_collecting');
            bot.modes.unpause('hunting');
            bot.modes.unpause('torch_placing');
        }

        if (distance_from_player <= nearby_distance) {
            clearInterval(doorCheckInterval);
            doorCheckInterval = null;
            bot.modes.pause('unstuck');
            bot.modes.pause('elbow_room');
        }
        else {
            if (!doorCheckInterval) {
                doorCheckInterval = startDoorInterval(bot);
            }
            bot.modes.unpause('unstuck');
            bot.modes.unpause('elbow_room');
        }
    }
    clearInterval(doorCheckInterval);
    return true;
}


export async function moveAway(bot, distance) {
    /**
     * Move away from current position in any direction.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.moveAway(bot, 8);
     **/
    const pos = bot.entity.position;
    let goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(new pf.Movements(bot));

    if (bot.modes.isOn('cheat')) {
        const move = new pf.Movements(bot);
        const path = await bot.pathfinder.getPathTo(move, inverted_goal, 10000);
        let last_move = path.path[path.path.length-1];
        if (last_move) {
            let x = Math.floor(last_move.x);
            let y = Math.floor(last_move.y);
            let z = Math.floor(last_move.z);
            bot.chat('/tp @s ' + x + ' ' + y + ' ' + z);
            return true;
        }
    }

    // v0.1.4.8 (B3, S11): with the door reflex on, the old door timer does not run, and in a closed
    // room the path search finds no way at all (NoPath). A bot that is not away yet opens the door,
    // gate or trapdoor next to it and walks again. The door service of the home pack closes it
    // afterwards. Without that help a failed walk throws as before.
    let failure = null;
    try {
        await goToGoal(bot, inverted_goal);
    } catch (err) {
        failure = err;
    }
    for (let tries = 0; tries < 2 && !bot.interrupt_code && doorReflexOn(bot) && !isAway(bot, inverted_goal); tries++) {
        if (!(await openWayOut(bot)))
            break;
        try {
            failure = null;
            await goToGoal(bot, inverted_goal);
        } catch (err) {
            failure = err;
        }
    }
    if (failure && !isAway(bot, inverted_goal))
        throw failure;
    let new_pos = bot.entity.position;
    log(bot, `Moved away from ${pos.floored()} to ${new_pos.floored()}.`);
    return true;
}

// v0.1.4.8 (B6, S14): the walk of discard. It never digs and ends after limitMs.
const DISCARD_WALK_MS = 3000;

async function walkAwayWithin(bot, distance, limitMs) {
    if (bot.interrupt_code)
        return false;
    try {
        const pos = bot.entity.position.clone();
        const goal = new pf.goals.GoalInvert(new pf.goals.GoalNear(pos.x, pos.y, pos.z, distance));
        const movements = new pf.Movements(bot);
        movements.canDig = false;
        movements.allow1by1towers = false;
        bot.pathfinder.setMovements(movements);
        return (await untilStopped(bot, bot.pathfinder.goto(goal), limitMs)) === 'arrived';
    } catch (err) {
        return false; // no way away: the items are tossed where the bot stands
    }
}

export async function moveAwayFromEntity(bot, entity, distance=16) {
    /**
     * Move away from the given entity.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Entity} entity, the entity to move away from.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     **/
    let goal = new pf.goals.GoalFollow(entity, distance);
    let inverted_goal = new pf.goals.GoalInvert(goal);
    bot.pathfinder.setMovements(new pf.Movements(bot));
    await bot.pathfinder.goto(inverted_goal);
    return true;
}

export async function avoidEnemies(bot, distance=16) {
    /**
     * Move a given distance away from all nearby enemy mobs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} distance, the distance to move away.
     * @returns {Promise<boolean>} true if the bot moved away, false otherwise.
     * @example
     * await skills.avoidEnemies(bot, 8);
     **/
    bot.modes.pause('self_preservation'); // prevents damage-on-low-health from interrupting the bot
    let enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);
    while (enemy) {
        const follow = new pf.goals.GoalFollow(enemy, distance+1); // move a little further away
        const inverted_goal = new pf.goals.GoalInvert(follow);
        bot.pathfinder.setMovements(new pf.Movements(bot));
        bot.pathfinder.setGoal(inverted_goal, true);
        await new Promise(resolve => setTimeout(resolve, 500));
        enemy = world.getNearestEntityWhere(bot, entity => mc.isHostile(entity), distance);
        if (bot.interrupt_code) {
            break;
        }
        if (enemy && bot.entity.position.distanceTo(enemy.position) < 3) {
            await attackEntity(bot, enemy, false);
        }
    }
    bot.pathfinder.stop();
    log(bot, `Moved ${distance} away from enemies.`);
    return true;
}

export async function stay(bot, seconds=30) {
    /**
     * Stay in the current position until interrupted. Disables all modes.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} seconds, the number of seconds to stay. Defaults to 30. -1 for indefinite.
     * @returns {Promise<boolean>} true if the bot stayed, false otherwise.
     * @example
     * await skills.stay(bot);
     **/
    bot.modes.pause('self_preservation');
    bot.modes.pause('unstuck');
    bot.modes.pause('cowardice');
    bot.modes.pause('self_defense');
    bot.modes.pause('hunting');
    bot.modes.pause('torch_placing');
    bot.modes.pause('item_collecting');
    let start = Date.now();
    while (!bot.interrupt_code && (seconds === -1 || Date.now() - start < seconds*1000)) {
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `Stayed for ${(Date.now() - start)/1000} seconds.`);
    return true;
}

export async function useDoor(bot, door_pos=null) {
    /**
     * Use the door at the given position.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {Vec3} door_pos, the position of the door to use. If null, the nearest door will be used.
     * @returns {Promise<boolean>} true if the door was used, false otherwise.
     * @example
     * let door = world.getNearestBlock(bot, "oak_door", 16).position;
     * await skills.useDoor(bot, door);
     **/
    if (!door_pos) {
        for (let door_type of ['oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door', 'dark_oak_door',
                               'mangrove_door', 'cherry_door', 'bamboo_door', 'crimson_door', 'warped_door']) {
            door_pos = world.getNearestBlock(bot, door_type, 16)?.position;
            if (door_pos) break;
        }
    } else {
        door_pos = Vec3(door_pos.x, door_pos.y, door_pos.z);
    }
    if (!door_pos) {
        log(bot, `Could not find a door to use.`);
        return false;
    }

    bot.pathfinder.setGoal(new pf.goals.GoalNear(door_pos.x, door_pos.y, door_pos.z, 1));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    while (bot.pathfinder.isMoving()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    
    let door_block = bot.blockAt(door_pos);
    await bot.lookAt(door_pos);
    if (!door_block._properties.open)
        await bot.activateBlock(door_block);
    
    bot.setControlState("forward", true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    bot.setControlState("forward", false);
    await bot.activateBlock(door_block);

    log(bot, `Used door at ${door_pos}.`);
    return true;
}

export async function goToBed(bot) {
    /**
     * Sleep in the nearest bed.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bed was found, false otherwise.
     * @example
     * await skills.goToBed(bot);
     **/
    const beds = bot.findBlocks({
        matching: (block) => {
            return block.name.endsWith('_bed'); // not bedrock
        },
        maxDistance: 32,
        count: 1
    });
    if (beds.length === 0) {
        log(bot, `Could not find a bed to sleep in.`);
        return false;
    }
    let loc = beds[0];
    await goToPosition(bot, loc.x, loc.y, loc.z);
    const bed = bot.blockAt(loc);
    await bot.sleep(bed);
    log(bot, `You are in bed.`);
    bot.modes.pause('unstuck');
    while (bot.isSleeping) {
        if (bot.interrupt_code) {
            // v0.1.4.8, fix round (X5): a stopped sleep gets up; bot.wake() of mineflayer does not on 1.21.8
            const up = await wakeUp(bot);
            log(bot, up.ok ? `You got up before the morning.` : up.text);
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    log(bot, `You have woken up.`);
    return true;
}

export async function tillAndSow(bot, x, y, z, seedType=null) {
    /**
     * Till the ground at the given position and plant the given seed type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} x, the x coordinate to till.
     * @param {number} y, the y coordinate to till.
     * @param {number} z, the z coordinate to till.
     * @param {string} plantType, the type of plant to plant. Defaults to none, which will only till the ground.
     * @returns {Promise<boolean>} true if the ground was tilled, false otherwise.
     * @example
     * let position = world.getPosition(bot);
     * await skills.tillAndSow(bot, position.x, position.y - 1, position.x, "wheat");
     **/
    let pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    let block = bot.blockAt(pos);
    log(bot, `Planting ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);

    if (bot.modes.isOn('cheat')) {
        let to_remove = ['_seed', '_seeds'];
        for (let remove of to_remove) {
            if (seedType.endsWith(remove)) {
                seedType = seedType.replace(remove, '');
            }
        }
        placeBlock(bot, 'farmland', x, y, z);
        placeBlock(bot, seedType, x, y+1, z);
        return true;
    }

    if (block.name !== 'grass_block' && block.name !== 'dirt' && block.name !== 'farmland') {
        log(bot, `Cannot till ${block.name}, must be grass_block or dirt.`);
        return false;
    }
    let above = bot.blockAt(new Vec3(x, y+1, z));
    if (above.name !== 'air') {
        if (block.name === 'farmland') {
            log(bot, `Land is already farmed with ${above.name}.`);
            return true;
        }
        let broken = await breakBlockAt(bot, x, y+1, z);
        if (!broken) {
            log(bot, `Cannot cannot break above block to till.`);
            return false;
        }
    }
    // if distance is too far, move to the block
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    if (block.name !== 'farmland') {
        let hoe = bot.inventory.items().find(item => item.name.includes('hoe'));
        let to_equip = hoe?.name || 'diamond_hoe';
        if (!await equip(bot, to_equip)) {
            log(bot, `Cannot till, no hoes.`);
            return false;
        }
        await bot.activateBlock(block);
        log(bot, `Tilled block x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    
    if (seedType) {
        if (seedType.endsWith('seed') && !seedType.endsWith('seeds'))
            seedType += 's'; // fixes common mistake
        let equipped_seeds = await equip(bot, seedType);
        if (!equipped_seeds) {
            log(bot, `No ${seedType} to plant.`);
            return false;
        }

        await bot.activateBlock(block);
        log(bot, `Planted ${seedType} at x:${x.toFixed(1)}, y:${y.toFixed(1)}, z:${z.toFixed(1)}.`);
    }
    return true;
}

export async function activateNearestBlock(bot, type) {
    /**
     * Activate the nearest block of the given type.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {string} type, the type of block to activate.
     * @returns {Promise<boolean>} true if the block was activated, false otherwise.
     * @example
     * await skills.activateNearestBlock(bot, "lever");
     * **/
    let block = world.getNearestBlock(bot, type, 16);
    if (!block) {
        log(bot, `Could not find any ${type} to activate.`);
        return false;
    }
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        let pos = block.position;
        bot.pathfinder.setMovements(new pf.Movements(bot));
        await goToGoal(bot, new pf.goals.GoalNear(pos.x, pos.y, pos.z, 4));
    }
    await bot.activateBlock(block);
    log(bot, `Activated ${type} at x:${block.position.x.toFixed(1)}, y:${block.position.y.toFixed(1)}, z:${block.position.z.toFixed(1)}.`);
    return true;
}

/**
 * Helper function to find and navigate to a villager for trading
 * @param {MinecraftBot} bot - reference to the minecraft bot
 * @param {number} id - the entity id of the villager
 * @returns {Promise<Object|null>} the villager entity if found and reachable, null otherwise
 */
async function findAndGoToVillager(bot, id) {
    id = id+"";
    const entity = bot.entities[id];
    
    if (!entity) {
        log(bot, `Cannot find villager with id ${id}`);
        let entities = world.getNearbyEntities(bot, 16);
        let villager_list = "Available villagers:\n";
        for (let entity of entities) {
            if (entity.name === 'villager') {
                if (entity.metadata && entity.metadata[16] === 1) {
                    villager_list += `${entity.id}: baby villager\n`;
                } else {
                    const profession = world.getVillagerProfession(entity);
                    villager_list += `${entity.id}: ${profession}\n`;
                }
            }
        }
        if (villager_list === "Available villagers:\n") {
            log(bot, "No villagers found nearby.");
            return null;
        }
        log(bot, villager_list);
        return null;
    }
    
    if (entity.entityType !== bot.registry.entitiesByName.villager.id) {
        log(bot, 'Entity is not a villager');
        return null;
    }
    
    if (entity.metadata && entity.metadata[16] === 1) {
        log(bot, 'This is either a baby villager or a villager with no job - neither can trade');
        return null;
    }
    
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance > 4) {
        log(bot, `Villager is ${distance.toFixed(1)} blocks away, moving closer...`);
        try {
            bot.modes.pause('unstuck');
            const goal = new pf.goals.GoalFollow(entity, 2);
            await goToGoal(bot, goal);
            
            
            log(bot, 'Successfully reached villager');
        } catch (err) {
            log(bot, 'Failed to reach villager - pathfinding error or villager moved');
            console.log(err);
            return null;
        } finally {
            bot.modes.unpause('unstuck');
        }
    }
    
    return entity;
}

export async function showVillagerTrades(bot, id) {
    /**
     * Go to the villager with the given entity id and log its available trades, numbered from 1. If there is no entity with that id, the ids of nearby villagers are logged instead.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} id, the entity id of the villager.
     * @returns {Promise<boolean>} true if the trades were shown, false otherwise.
     * @example
     * await skills.showVillagerTrades(bot, 123);
     **/
    const villagerEntity = await findAndGoToVillager(bot, id);
    if (!villagerEntity) {
        return false;
    }
    
    try {
        const villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            villager.close();
            return false;
        }
        
        log(bot, `Villager has ${villager.trades.length} available trades:`);
        stringifyTrades(bot, villager.trades).forEach((trade, i) => {
            const tradeInfo = `${i + 1}: ${trade}`;
            console.log(tradeInfo);
            log(bot, tradeInfo);
        });
        
        villager.close();
        return true;
    } catch (err) {
        log(bot, 'Failed to open villager trading interface - they might be sleeping, a baby, or jobless');
        console.log('Villager trading error:', err.message);
        return false;
    }
}

export async function tradeWithVillager(bot, id, index, count) {
    /**
     * Go to the villager with the given entity id and execute one of its trades. Use skills.showVillagerTrades first to see the trade numbers.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} id, the entity id of the villager.
     * @param {number} index, the number of the trade to execute, starting at 1.
     * @param {number} count, how many times to execute the trade. It is reduced to the uses the trade has left, and the bot must have the items for all of them.
     * @returns {Promise<boolean>} true if the trade was executed, false otherwise.
     * @example
     * await skills.tradeWithVillager(bot, 123, 1, 2);
     **/
    const villagerEntity = await findAndGoToVillager(bot, id);
    if (!villagerEntity) {
        return false;
    }
    
    try {
        const villager = await bot.openVillager(villagerEntity);
        
        if (!villager.trades || villager.trades.length === 0) {
            log(bot, 'This villager has no trades available - might be sleeping, a baby, or jobless');
            villager.close();
            return false;
        }
        
        const tradeIndex = parseInt(index) - 1; // Convert to 0-based index
        const trade = villager.trades[tradeIndex];
        
        if (!trade) {
            log(bot, `Trade ${index} not found. This villager has ${villager.trades.length} trades available.`);
            villager.close();
            return false;
        }
        
        if (trade.disabled) {
            log(bot, `Trade ${index} is currently disabled`);
            villager.close();
            return false;
        }

        const item_2 = trade.inputItem2 ? stringifyItem(bot, trade.inputItem2)+' ' : '';
        log(bot, `Trading ${stringifyItem(bot, trade.inputItem1)} ${item_2}for ${stringifyItem(bot, trade.outputItem)}...`);
        
        const maxPossibleTrades = trade.maximumNbTradeUses - trade.nbTradeUses;
        const requestedCount = count;
        const actualCount = Math.min(requestedCount, maxPossibleTrades);
        
        if (actualCount <= 0) {
            log(bot, `Trade ${index} has been used to its maximum limit`);
            villager.close();
            return false;
        }
        
        if (!hasResources(villager.slots, trade, actualCount)) {
            log(bot, `Don't have enough resources to execute trade ${index} ${actualCount} time(s)`);
            villager.close();
            return false;
        }
        
        log(bot, `Executing trade ${index} ${actualCount} time(s)...`);
        
        try {
            await bot.trade(villager, tradeIndex, actualCount);
            log(bot, `Successfully traded ${actualCount} time(s)`);
            villager.close();
            return true;
        } catch (tradeErr) {
            log(bot, 'An error occurred while trying to execute the trade');
            console.log('Trade execution error:', tradeErr.message);
            villager.close();
            return false;
        }
    } catch (err) {
        log(bot, 'Failed to open villager trading interface');
        console.log('Villager interface error:', err.message);
        return false;
    }
}

function hasResources(window, trade, count) {
    const first = enough(trade.inputItem1, count);
    const second = !trade.inputItem2 || enough(trade.inputItem2, count);
    return first && second;

    function enough(item, count) {
        let c = 0;
        window.forEach((element) => {
            if (element && element.type === item.type && element.metadata === item.metadata) {
                c += element.count;
            }
        });
        return c >= item.count * count;
    }
}

function stringifyTrades(bot, trades) {
    return trades.map((trade) => {
        let text = stringifyItem(bot, trade.inputItem1);
        if (trade.inputItem2) text += ` & ${stringifyItem(bot, trade.inputItem2)}`;
        if (trade.disabled) text += ' x '; else text += ' » ';
        text += stringifyItem(bot, trade.outputItem);
        return `(${trade.nbTradeUses}/${trade.maximumNbTradeUses}) ${text}`;
    });
}

function stringifyItem(bot, item) {
    if (!item) return 'nothing';
    let text = `${item.count} ${item.displayName}`;
    if (item.nbt && item.nbt.value) {
        const ench = item.nbt.value.ench;
        const StoredEnchantments = item.nbt.value.StoredEnchantments;
        const Potion = item.nbt.value.Potion;
        const display = item.nbt.value.display;

        if (Potion) text += ` of ${Potion.value.replace(/_/g, ' ').split(':')[1] || 'unknown type'}`;
        if (display) text += ` named ${display.value.Name.value}`;
        if (ench || StoredEnchantments) {
            text += ` enchanted with ${(ench || StoredEnchantments).value.value.map((e) => {
                const lvl = e.lvl.value;
                const id = e.id.value;
                return bot.registry.enchantments[id].displayName + ' ' + lvl;
            }).join(' ')}`;
        }
    }
    return text;
}

export async function digDown(bot, distance = 10) {
    /**
     * Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {int} distance, distance to dig down.
     * @returns {Promise<boolean>} true if successfully dug all the way down.
     * @example
     * await skills.digDown(bot, 10);
     **/

    let start_block_pos = bot.blockAt(bot.entity.position).position;
    for (let i = 1; i <= distance; i++) {
        const targetBlock = bot.blockAt(start_block_pos.offset(0, -i, 0));
        let belowBlock = bot.blockAt(start_block_pos.offset(0, -i-1, 0));

        if (!targetBlock || !belowBlock) {
            log(bot, `Dug down ${i-1} blocks, but reached the end of the world.`);
            return true;
        }

        // Check for lava, water
        if (targetBlock.name === 'lava' || targetBlock.name === 'water' || 
            belowBlock.name === 'lava' || belowBlock.name === 'water') {
            log(bot, `Dug down ${i-1} blocks, but reached ${belowBlock ? belowBlock.name : '(lava/water)'}`)
            return false;
        }

        const MAX_FALL_BLOCKS = 2;
        let num_fall_blocks = 0;
        for (let j = 0; j <= MAX_FALL_BLOCKS; j++) {
            if (!belowBlock || (belowBlock.name !== 'air' && belowBlock.name !== 'cave_air')) {
                break;
            }
            num_fall_blocks++;
            belowBlock = bot.blockAt(belowBlock.position.offset(0, -1, 0));
        }
        if (num_fall_blocks > MAX_FALL_BLOCKS) {
            log(bot, `Dug down ${i-1} blocks, but reached a drop below the next block.`);
            return false;
        }

        if (targetBlock.name === 'air' || targetBlock.name === 'cave_air') {
            log(bot, 'Skipping air block');
            console.log(targetBlock.position);
            continue;
        }

        let dug = await breakBlockAt(bot, targetBlock.position.x, targetBlock.position.y, targetBlock.position.z);
        if (!dug) {
            log(bot, 'Failed to dig block at position:' + targetBlock.position);
            return false;
        }
    }
    log(bot, `Dug down ${distance} blocks.`);
    return true;
}

// v0.1.4.11, W4: the numbers of goToSurface (its texts are in skill_texts.js).
const SURFACE_RULES = Object.freeze({
    roofReach: 6,    // a block this far above the head counts as a roof
    skyRange: 16,    // the open sky is looked for within this distance
    doorRange: 16,   // the entrance of a building within this distance
    doorHeight: 3,   // and at most this many blocks above or below the feet
    tries: 3,        // the nearest columns with open sky that are tried
    walkMs: 20000,   // one walk
});
const SKY_AIR = new Set(['air', 'cave_air', 'void_air']);
const BUILDING_KINDS = new Set(['home', 'building', 'storage']);

function feetCell(bot) {
    const p = bot?.entity?.position;
    return p ? { x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) } : null;
}

// The y below which nothing is built and the y of the top of the world.
function worldTop(bot) {
    const minY = Number.isFinite(bot?.game?.minY) ? bot.game.minY : -64;
    const height = Number.isFinite(bot?.game?.height) ? bot.game.height : 384;
    return minY + height;
}

// True when no block is above the cell of the feet up to the top of the world (W4: "open sky"); the cell of the
// head and everything above it is air. An unloaded block is no open sky. Never throws.
function underOpenSky(bot, feet) {
    try {
        const top = worldTop(bot);
        for (let y = Math.floor(feet.y) + 1; y < top; y++) {
            const block = bot.blockAt(new Vec3(Math.floor(feet.x), y, Math.floor(feet.z)));
            if (!block || !SKY_AIR.has(block.name))
                return false;
        }
        return true;
    } catch (err) {
        return false;
    }
}

// True when a block that is not air is within SURFACE_RULES.roofReach above the head.
function roofAbove(bot, feet) {
    for (let y = feet.y + 2; y <= feet.y + 1 + SURFACE_RULES.roofReach; y++) {
        const block = bot.blockAt(new Vec3(feet.x, y, feet.z));
        if (block && !SKY_AIR.has(block.name))
            return true;
    }
    return false;
}

// True inside a building: in an area of kind home, building or storage, or under a roof within 6 blocks.
function inBuildingHere(bot, feet) {
    try {
        const area = bot.areaGuard?.areaAt?.(feet) ?? null;
        if (area && (BUILDING_KINDS.has(area.kind) || BUILDING_KINDS.has(area.type)))
            return true;
        return roofAbove(bot, feet);
    } catch (err) {
        return false;
    }
}

// True when a cell under the open sky is ground, not a roof: the two blocks under it are not air, and it is in
// no building that the bot protects (W4: never on the roof).
function groundCell(bot, cell) {
    for (const dy of [1, 2]) {
        const below = bot.blockAt(new Vec3(cell.x, cell.y - dy, cell.z));
        if (!below || SKY_AIR.has(below.name))
            return false;
    }
    const area = bot.areaGuard?.areaAt?.(cell) ?? null;
    return !(area && (BUILDING_KINDS.has(area.kind) || BUILDING_KINDS.has(area.type)));
}

// The cells within SURFACE_RULES.skyRange where the bot can stand under the open sky, the nearest first (a
// block up counts twice): per column the highest block that is not air, solid, with ground under it. Never throws.
function openSkyCells(bot, feet) {
    const cells = [];
    try {
        const top = worldTop(bot);
        const r = SURFACE_RULES.skyRange;
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (dx * dx + dz * dz > r * r)
                    continue;
                const x = feet.x + dx;
                const z = feet.z + dz;
                for (let y = top - 1; y >= feet.y - r; y--) {
                    const block = bot.blockAt(new Vec3(x, y, z));
                    if (!block)
                        break; // not loaded
                    if (SKY_AIR.has(block.name))
                        continue;
                    if (block.boundingBox === 'block' && !['water', 'lava'].includes(block.name)) {
                        const cell = { x, y: y + 1, z };
                        const up = cell.y - feet.y;
                        if (Math.hypot(dx, up, dz) <= r && groundCell(bot, cell))
                            cells.push({ ...cell, d: Math.hypot(dx, dz) + Math.abs(up) + Math.max(0, up) });
                    }
                    break; // only the highest block of a column has the open sky above it
                }
            }
        }
    } catch (err) {
        // the cells found so far
    }
    return cells.sort((a, b) => a.d - b.d);
}

// Walks to the nearest cells with open sky, without digging; the cell reached, or null.
async function walkToOpenSky(bot, feet) {
    for (const cell of openSkyCells(bot, feet).slice(0, SURFACE_RULES.tries)) {
        if (bot.interrupt_code)
            return null;
        await walkNear(bot, cell, 0, { timeoutMs: SURFACE_RULES.walkMs, allowDoors: true, allowDig: false });
        const here = feetCell(bot);
        if (here && underOpenSky(bot, here))
            return here;
    }
    return null;
}

// The nearest door or gate within SURFACE_RULES.doorRange at about the height of the feet (no trapdoor).
function nearestEntrance(bot, feet) {
    try {
        const doors = findOpenables(bot, SURFACE_RULES.doorRange)
            .filter((d) => (d.kind === 'door' || d.kind === 'gate') && Math.abs(d.y - feet.y) <= SURFACE_RULES.doorHeight);
        doors.sort((a, b) => Math.hypot(a.x - feet.x, a.y - feet.y, a.z - feet.z) - Math.hypot(b.x - feet.x, b.y - feet.y, b.z - feet.z));
        return doors[0] ?? null;
    } catch (err) {
        return null;
    }
}

export async function goToSurface(bot, ctx = null) {
    /**
     * Go out under the open sky (no block above the bot up to the top of the world). Inside a building the bot
     * leaves through the nearest door first; elsewhere it walks to the nearest place with open sky within 16
     * blocks. It never digs.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the bot stands under the open sky, false otherwise.
     **/
    // v0.1.4.11, W4: ctx (optional, the glue of !goToSurface gives it): whereAmI() and, with the mining pack on,
    // mining.climbToSurface(bot, ctx), the way out of a mine. Without ctx the skill works without them.
    const start = feetCell(bot);
    if (!start)
        return false;
    try {
        if (underOpenSky(bot, start)) {
            log(bot, SURFACE_TEXTS.already());
            return true;
        }
        const where = typeof ctx?.whereAmI === 'function' ? ctx.whereAmI() : null;
        if (where?.mine && typeof ctx?.mining?.climbToSurface === 'function') {
            const out = await ctx.mining.climbToSurface(bot, ctx);
            if (bot.interrupt_code)
                return false;
            const here = feetCell(bot);
            if (here && underOpenSky(bot, here)) {
                log(bot, SURFACE_TEXTS.climbed(here));
                return true;
            }
            if (out && out.ok === false && typeof out.text === 'string' && out.text !== '')
                log(bot, out.text);
        }
        const from = feetCell(bot) ?? start;
        if (inBuildingHere(bot, from)) {
            const door = nearestEntrance(bot, from);
            if (door) {
                const walk = await passThrough(bot, door, ctx ?? {}, { allowDig: false });
                if (bot.interrupt_code)
                    return false;
                if (walk?.ok) {
                    const here = feetCell(bot);
                    const sky = here && underOpenSky(bot, here) ? here : await walkToOpenSky(bot, here ?? from);
                    if (sky) {
                        log(bot, SURFACE_TEXTS.door(door.kind, door, sky));
                        return true;
                    }
                }
            }
        }
        const sky = await walkToOpenSky(bot, feetCell(bot) ?? from);
        if (sky) {
            log(bot, SURFACE_TEXTS.climbed(sky));
            return true;
        }
        if (!bot.interrupt_code)
            log(bot, SURFACE_TEXTS.noWay(feetCell(bot) ?? start));
        return false;
    } catch (err) {
        log(bot, SURFACE_TEXTS.noWay(feetCell(bot) ?? start));
        return false;
    }
}

export async function useToolOn(bot, toolName, targetName) {
    /**
     * Equip a tool and use it on the nearest target.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {string} targetName - entity type, block type, or "nothing" for no target
     * @returns {Promise<boolean>} true if action succeeded
     */
    if (!bot.inventory.slots.find(slot => slot && slot.name === toolName) && !bot.game.gameMode === 'creative') {
        log(bot, `You do not have any ${toolName} to use.`);
        return false;
    }

    targetName = targetName.toLowerCase();
    if (targetName === 'nothing') {
        const equipped = await equip(bot, toolName);
        if (!equipped) {
            return false;
        }
        await bot.activateItem();
        log(bot, `Used ${toolName}.`);
    } else if (world.isEntityType(targetName)) {
        const entity = world.getNearestEntityWhere(bot, e => e.name === targetName, 64);
        if (!entity) {
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        await goToPosition(bot, entity.position.x, entity.position.y, entity.position.z);
        if (toolName === 'hand') {
            await bot.unequip('hand');
        }
        else {
            const equipped = await equip(bot, toolName);
            if (!equipped) return false;
        }
        await bot.useOn(entity);
        log(bot, `Used ${toolName} on ${targetName}.`);
    } else {
        let block = null;
        if (targetName === 'water' || targetName === 'lava') {
            // we want to get liquid source blocks, not flowing blocks
            // so search for blocks with metadata 0 (not flowing)
            let blocks = world.getNearestBlocksWhere(bot, block => block.name === targetName && block.metadata === 0, 64, 1);
            if (blocks.length === 0) {
                log(bot, `Could not find any source ${targetName}.`);
                return false;
            }
            block = blocks[0];
        }
        else {
            block = world.getNearestBlock(bot, targetName, 64);
        }
        if (!block) {
            log(bot, `Could not find any ${targetName}.`);
            return false;
        }
        return await useToolOnBlock(bot, toolName, block);
    }

    return true;
 }

 export async function useToolOnBlock(bot, toolName, block) {
    /**
     * Use a tool on a specific block.
     * @param {MinecraftBot} bot
     * @param {string} toolName - item name of the tool to equip, or "hand" for no tool.
     * @param {Block} block - the block reference to use the tool on.
     * @returns {Promise<boolean>} true if action succeeded
     */

    const distance = toolName === 'water_bucket' && block.name !== 'lava' ? 1.5 : 2;
    await goToPosition(bot, block.position.x, block.position.y, block.position.z, distance);
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));

    // if block in view is closer than the target block, it is in our way. try to move closer
    const viewBlocked = () => {
        const blockInView = bot.blockAtCursor(5);
        const headPos = bot.entity.position.offset(0, bot.entity.height, 0);
        return blockInView && 
            !blockInView.position.equals(block.position) && 
            blockInView.position.distanceTo(headPos) < block.position.distanceTo(headPos);
    }
    const blockInView = bot.blockAtCursor(5);
    if (viewBlocked()) {
        log(bot, `Block ${blockInView.name} is in the way, moving closer...`);
        // choose random block next to target block, go to it
        const nearbyPos = block.position.offset(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
        await goToPosition(bot, nearbyPos.x, nearbyPos.y, nearbyPos.z, 1);
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
        if (viewBlocked()) {
            const blockInView = bot.blockAtCursor(5);
            log(bot, `Block ${blockInView.name} is in the way, not using ${toolName}.`);
            return false;
        }
    }

    const equipped = await equip(bot, toolName);

    if (!equipped) {
        log(bot, `Could not equip ${toolName}.`);
        return false;
    }
    if (toolName.includes('bucket')) {
        await bot.activateItem();
    }
    else {
        await bot.activateBlock(block);
    }
    log(bot, `Used ${toolName} on ${block.name}.`);
    return true;
 }
