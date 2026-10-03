// The wood and tools pack of v0.1.4.7 (spec section 5, part T): natural trees, cutting them,
// tools and supplies. Everything the glue needs is exported here. Importing this file has no side
// effects.
//
// Pure modules (no mineflayer, no src/agent/library): tree_logic, tool_logic, texts, inventory.
// Executing modules (they move the bot): wood (chopTrees), tools (ensureTool, craftSupplies),
// actions. Their ctx is the home context { areas, log, now } and for tools also
// skills.craftRecipe, and optionally wood.chopTrees, storage.fetchItem and chests.
import { chopTrees } from './wood.js';
import { craftSupplies, ensureTool } from './tools.js';

export { DEFAULT_REACH, EYE_HEIGHT, GROUND_NAMES, MAX_PILLAR, MIN_LEAVES, TREE_DEFAULTS, WOOD_KINDS, chopPlan, eyeOf, findTrees,
    inReach, inspectTrees, isGround, isLeaves, isTrunkLog, isWorkedWood, logItemOf, normaliseWoodKind, pickTree, planksOf, saplingOf,
    treeKey, treeNearAreas, woodKind } from './tree_logic.js';
export { GOLDEN, MATERIALS, OPEN_MATERIAL_MAX, RECIPES, SUPPLY_NAMES, TOOL_KINDS, TOOL_USES, bestTool, chooseMaterial, craftSteps,
    isWoodItem, materialLevel, missingIngredient, normaliseSupply, normaliseToolRequest, parseTool, stepIngredients, supplySteps, toolName,
    toolsOf, usesLeft, woodOfInventory } from './tool_logic.js';
export { TREE_RANGE, chopStoppedText, chopText, countList, craftFailedText, craftedSupplyText, craftedToolsText, haveToolText, needText,
    noIronText, noTreeText, notCraftableText, unknownMaterialText, unknownSupplyText, unknownToolText, unknownWoodText, withArticle } from './texts.js';
export { countItems, findItem, inventoryOf, itemCounts, itemUsesLeft } from './inventory.js';
export { CHOP_LIMIT_MS, DROP_PICKUP_MS, DROP_RADIUS, NO_DIG_NEAR_AREA, SAPLING_WAIT_MS, TREE_LIMIT_MS, chopArgs, chopTrees } from './wood.js';
export { NO_STONE_TEXT, STONE_LIMIT_MS, STONE_RANGE, chestCounts, collectCobblestone, craftSupplies, ensureTool, smeltIronFor, tableNear } from './tools.js';

/** `ctx.tools` of packContext (spec section 2). */
export const TOOLS_API = Object.freeze({ ensureTool, craftSupplies });
/** `ctx.wood` of packContext (spec section 2). */
export const WOOD_API = Object.freeze({ chopTrees });
