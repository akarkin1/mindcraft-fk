// The farming pack of v0.1.4.7 (spec section 4, part F): harvest, plant, bone meal, fertilize and
// the farm cycle. Everything the glue needs is exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library): crop_logic, field_logic, texts.
// Executing module (moves the bot, gets `ctx` = { areas, log, now, home?, storage? }): farming.
export { COMPOSTABLE, CROPS, FLOWERS, TILLABLE, bestHoe, cellPlan, chooseCompostItem, compostSource, cropOf, harvestTarget, isAirName,
    isCompostable, isCropBlock, isRipe, seedFor, visitOrder } from './crop_logic.js';
export { FARM_RANGE, chooseFarmArea, fieldBox, fieldCells, findGates, insideBox, isInField, stepPenalty } from './field_logic.js';
export { TEXTS, boneMealText, countList, cycleText, fertilizeText, gateOpenText, harvestText, noPlantsToFertilizeText, noSeedsText,
    nothingGrowsText, nothingRipeText, nothingToPlantText, plantText, unknownFarmText, unknownSeedText, unreachedText, whereText } from './texts.js';
export { FARM_LIMITS, farmCycle, fertilize, fieldMovements, findFarm, harvestCrops, makeBoneMeal, plantField } from './farming.js';
