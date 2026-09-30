// The mining pack of v0.1.4.7 (spec section 6, part M): down to the level of the ore on ladders, a
// room with a chest, one straight tunnel, lava, water and caves closed with cobblestone, the ore
// collected, stored at the base, and back up. Everything the glue needs is exported here.
// Importing this file has no side effects.
//
// v0.1.4.9 (part B, with the setting mine_routes): the mine of the player (rememberMine,
// rememberTunnel), the work in a known mine along its route, side branches, the ore list
// (collectPassedOre), and mineAt for where the bot is (I6, I7).
//
// Pure modules (no mineflayer, no src/agent/library): ore_table, mine_logic, texts.
// The store: mine_store (one file per world, <worldDir>/mines.json).
// Executing modules (they move the bot and get the pack context `ctx`): dig, ladder, mining, mine_way, mine_player.
export { ORES, ORE_NAMES, PICKAXE_LEVELS, PICKAXE_USES, TRIP_MIN_PICKAXE, cleanOreName, isOreBlock, oreOf, pickaxeFor, pickaxeIsEnough,
    pickaxeMaterial, targetLevel, tripPickaxe } from './ore_table.js';
export { AIR_NAMES, AREA_DISTANCE, DEFAULT_TUNNEL_LENGTH, DIRECTIONS, ENTRANCE_AREA_TYPES, ENTRANCE_DISTANCE, ENTRANCE_RANGE, FALLING_NAMES,
    MIN_LADDERS, OPEN_NAMES, RETURN_LIMITS, ROOM_BLOCKS, SIDE_STEP, TORCH_EVERY, TRIP_SUPPLIES, UNBREAKABLE_NAMES, UNDER_AREA_DEPTH, WATER_NAMES,
    backOf, cellOf, chooseDirection, chooseEntrance, classify, dirVector, directionOf, entranceAllowed, faceNeighbours, isDirection, isFalling,
    leftOf, mineDirections, offset, pickaxeUses, posKey, returnTimeMs, rightOf, roomPlan, sameCell, shaftAllowed, shaftStep, shaftView,
    shouldReturn, staircaseSlots, staircaseStep, staircaseView, tripNeeds, tripStart, tunnelAllowed, tunnelSlots, tunnelStep, tunnelView,
    usablePickaxes, veinOrder } from './mine_logic.js';
export { BRANCH_EVERY, BRANCH_FROM, BRANCH_LENGTH, CORRIDOR_LIMIT, MAX_PASSED, MAX_SENSE_RANGE, PASSED_REASONS, addPassedEntry, branchCells,
    branchPlan, cleanPassedEntry, corridorDirections, isCorridor, legCells, legEnd, measureTunnel, mineAt, mineDistance, nearestLeg,
    removePassedAt, roomBox, senseCut, senseOres, tunnelCells, tunnelDirection, tunnelFor, tunnelsOf, veinParts } from './mine_logic.js';
export { STOP_REASONS, TEXTS, article, askMineText, cannotMineText, collectPassedText, descendText, mineLabel, mineOreText, mineText,
    noEntranceText, noTunnelText, passedText, rememberMineText, rememberTunnelText, suppliesStoppedText, suppliesText, tunnelText,
    unknownOreText, wayWords } from './texts.js';
export { DOOR_KINDS, MINE_FILE, MineStore, NEAREST_RANGE, SHAFT_KINDS, cleanMineName, mineKey } from './mine_store.js';
export { FALL_TRIES, FILLERS, REACH, blockAt, collectDrops, countOf, digBlock, digClear, equipPickaxe, fillerCount, fillerOf, freeSlots,
    inventoryList, isFree, isSolid, logicName, nameReader, patchAll, placeInto, placeTorch, race, referenceFor, usesLeftOf,
    walkTo } from './dig.js';
export { climbUp, followDown, followUp, placeLadder, slideDown, waitStanding, yawOf } from './ladder.js';
export { BRANCH_BLOCKED, DEFAULT_MAX_MINUTES, MAX_SHAFT_MOVES, PROPOSAL_MS, TUNNEL_CHUNK, climbToSurface, currentMine, depositAtBase,
    descendToLevel, digTunnel, extendTunnel, goToMine, leaveMine, mineOre, prepareMiningTrip, setupMineBase, takePassedOre } from './mining.js';
export { MINE_RANGE, chooseMine, hasDoorLeg, mineRoutesOn, routeEndOf, senseRangeOf, walksRoute, wayIn, wayOut } from './mine_way.js';
export { MIN_TUNNEL_AHEAD, MIN_TUNNEL_CELLS, ROOM_RANGE, SAME_TUNNEL, collectPassedOre, findRoom, rememberMine, rememberTunnel } from './mine_player.js';
