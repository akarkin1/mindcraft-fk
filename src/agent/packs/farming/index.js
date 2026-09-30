// The farming pack of v0.1.4.7 (spec section 4, part F): harvest, plant, bone meal, fertilize and
// the farm cycle. Everything the glue needs is exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library): crop_logic, field_logic, texts.
// Executing module (moves the bot, gets `ctx` = { areas, log, now, home?, storage?, chests?, tools? }): farming.
export { BONE_MEAL_PER_PLANT, BONE_MEAL_WANT_MAX, COMPOSTABLE, CROPS, FLOWERS, TILLABLE, bestHoe, boneMealWant, cellPlan, chestsHold,
    chooseCompostItem, compostInChests, compostSource, compostSources, cropOf, harvestTarget, isAirName, isCompostable, isCropBlock, isRipe,
    seedFor, visitOrder } from './crop_logic.js';
export { COMPOSTER_NEAR_FARM, COMPOSTER_RANGE, FARM_RANGE, PICK_RANGE, chooseComposter, chooseFarmArea, farmMiddle, fieldBox, fieldCells,
    findGates, goalAvoiding, insideBox, isInField, isNoStandBlock, isNoStandCell, itemPlace, noStandBlocks, noStandPenalty, standSpots,
    stepPenalty } from './field_logic.js';
export { TEXTS, boneMealStepText, boneMealText, compostedText, countList, cycleText, fertilizeText, gateOpenText, growingText, harvestText,
    lostCropText, noPlantsToFertilizeText, noSeedsText, notRipeText, nothingGrowsText, nothingRipeText, nothingToPlantText, plantText, ripenedText,
    unknownFarmText, unknownSeedText, unreachedText, whereText } from './texts.js';
export { FARM_LIMITS, farmCycle, fertilize, fieldMovements, findFarm, harvestCrops, makeBoneMeal, plantField } from './farming.js';
