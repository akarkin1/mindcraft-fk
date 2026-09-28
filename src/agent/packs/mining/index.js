// The mining pack of v0.1.4.7 (spec section 6, part M): down to the level of the ore on ladders, a
// room with a chest, one straight tunnel, lava, water and caves closed with cobblestone, the ore
// collected, stored at the base, and back up. Everything the glue needs is exported here.
// Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library): ore_table, mine_logic, texts.
// The store: mine_store (one file per world, <worldDir>/mines.json).
// Executing modules (they move the bot and get the pack context `ctx`): dig, ladder, mining.
export { ORES, ORE_NAMES, PICKAXE_LEVELS, PICKAXE_USES, TRIP_MIN_PICKAXE, cleanOreName, isOreBlock, oreOf, pickaxeFor, pickaxeIsEnough,
    pickaxeMaterial, targetLevel, tripPickaxe } from './ore_table.js';
export { AIR_NAMES, AREA_DISTANCE, DEFAULT_TUNNEL_LENGTH, DIRECTIONS, ENTRANCE_RANGE, FALLING_NAMES, MIN_LADDERS, OPEN_NAMES, RETURN_LIMITS,
    ROOM_BLOCKS, SIDE_STEP, TORCH_EVERY, TRIP_SUPPLIES, UNBREAKABLE_NAMES, UNDER_AREA_DEPTH, WATER_NAMES, backOf, cellOf, chooseDirection,
    chooseEntrance, classify, dirVector, directionOf, faceNeighbours, isDirection, isFalling, leftOf, mineDirections, offset, pickaxeUses,
    posKey, returnTimeMs, rightOf, roomPlan, sameCell, shaftAllowed, shaftStep, shaftView, shouldReturn, staircaseSlots, staircaseStep,
    staircaseView, tripNeeds, tunnelAllowed, tunnelSlots, tunnelStep, tunnelView, usablePickaxes, veinOrder } from './mine_logic.js';
export { STOP_REASONS, TEXTS, article, cannotMineText, descendText, mineOreText, mineText, tunnelText, unknownOreText } from './texts.js';
export { MINE_FILE, MineStore, SHAFT_KINDS } from './mine_store.js';
export { FALL_TRIES, FILLERS, REACH, blockAt, collectDrops, countOf, digBlock, digClear, equipPickaxe, fillerCount, fillerOf, freeSlots,
    inventoryList, isFree, isSolid, logicName, nameReader, patchAll, placeInto, placeTorch, race, referenceFor, usesLeftOf,
    walkTo } from './dig.js';
export { climbUp, followDown, followUp, placeLadder, slideDown, waitStanding, yawOf } from './ladder.js';
export { DEFAULT_MAX_MINUTES, MAX_SHAFT_MOVES, TUNNEL_CHUNK, climbToSurface, currentMine, depositAtBase, descendToLevel, digTunnel,
    goToMine, leaveMine, mineOre, prepareMiningTrip, setupMineBase } from './mining.js';
