// The mining pack of v0.1.4.7 (spec section 6, part M): down to the level of the ore on ladders, a
// room with a chest, one straight tunnel, lava, water and caves closed with cobblestone, the ore
// collected, stored at the base, and back up. Everything the glue needs is exported here.
// Importing this file has no side effects.
//
// v0.1.4.9 (part B, with the setting mine_routes): the mine of the player (rememberMine,
// rememberTunnel), the work in a known mine along its route, side branches, the ore list
// (collectPassedOre), and mineAt for where the bot is (I6, I7).
//
// v0.1.4.11 (part M): the tunnel at a cell with its checks (tunnelAt, corridorWidth, addTunnel; I3) and the
// shaft of a second level from inside a known mine behind mine_from_inside (insideShaft, mineId, parentMine,
// fromInsideOn; I4).
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
    usablePickaxes, veinOrder, addTunnel, corridorWidth, insideShaft, shaftCellFree, tunnelAt, wayCells } from './mine_logic.js';
export { BRANCH_EVERY, BRANCH_FROM, BRANCH_LENGTH, CORRIDOR_LIMIT, MAX_PASSED, MAX_SENSE_RANGE, PASSED_REASONS, addPassedEntry, branchCells,
    branchPlan, cleanPassedEntry, corridorDirections, isCorridor, legCells, legEnd, measureTunnel, mineAt, mineDistance, nearestLeg,
    removePassedAt, roomBox, senseCut, NATURAL_NAMES, WAY_BACK_HOP, WAY_BACK_REACH, isNaturalBlock, knownCells, wayBack, wayBackHops, TORCH_NAMES, torchDue, senseOres, tunnelCells, tunnelDirection, tunnelFor, tunnelsOf, veinParts } from './mine_logic.js';
export { NO_TORCHES_TEXT, STOP_REASONS, TEXTS, TRAIL_MAX_STEPS, article, askMineText, cannotMineText, collectPassedText, descendText, mineLabel, mineOreText, mineText,
    noEntranceText, noTunnelText, passedText, rememberMineText, rememberTunnelText, suppliesStoppedText, suppliesText, tunnelText,
    unknownOreText, wayBlockedText, wayWords, wornMadeText, wornSpareText, wornStopText } from './texts.js';
// v0.1.4.13 (part P): the supply order and the spare pickaxe (P1), the wear rule (P2)
export { SPARE_PICKAXE_USES, SUPPLY_NEAR_RANGE, applySpareRule, supplyPlan } from './supply_logic.js';
export { DOOR_KINDS, MINE_FILE, MineStore, NEAREST_RANGE, SHAFT_KINDS, cleanMineName, mineId, mineKey } from './mine_store.js';
export { FALL_TRIES, FILLERS, REACH, WEAR_LIMIT, blockAt, collectDrops, countOf, digBlock, digClear, equipPickaxe, fillerCount, fillerOf, fitsBlock, freeSlots,
    inventoryList, isDroppedItem, isFree, isSolid, logicName, nameReader, patchAll, placeInto, placeTorch, race, referenceFor, usesLeftOf,
    walkTo, wornTool } from './dig.js';
export { climbUp, followDown, followUp, placeLadder, slideDown, waitStanding, yawOf } from './ladder.js';
export { BRANCH_BLOCKED, DEFAULT_MAX_MINUTES, MAX_SHAFT_MOVES, PROPOSAL_MS, TUNNEL_CHUNK, climbToSurface, currentMine, depositAtBase,
    descendToLevel, digTunnel, extendTunnel, goToMine, leaveMine, mineOre, prepareMiningTrip, replaceWornPickaxe, setupMineBase, takePassedOre,
    TRIP_FILLER_KEEP, TRIP_FOOD_KEEP, tripKeep } from './mining.js';
export { MINE_RANGE, chooseMine, fromInsideOn, hasDoorLeg, mineRoutesOn, parentMine, routeEndOf, senseRangeOf, walkBack, walksRoute, wayIn, wayOut } from './mine_way.js';
export { MIN_TUNNEL_AHEAD, MIN_TUNNEL_CELLS, ROOM_RANGE, SAME_TUNNEL, collectPassedOre, findRoom, forgetMine, minesText, rememberMine, rememberTunnel,
    mineHere } from './mine_player.js';
// v0.1.4.13 (part Q): the mine made where the bot stands (Q1), the full bag (Q4), the other ores (Q9)
export { HERE_ROOM_RANGE, madeMineText, nextMineName, noWayOutText, wayInUnknown } from './here_logic.js';
export { WIDENED_TUNNEL_WIDTH } from './mine_logic.js';
