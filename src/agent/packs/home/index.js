// The home pack of v0.1.4.6 (spec section 5, part H): doors, shelter, night, sleep, food, creepers.
// v0.1.4.8 (spec section 8, part C): the food of the off-hand and of the chests, the hunger reflex, the
// door service, creepers by height and sight, only a home as shelter, sleep without unstuck.
// Everything the glue needs is exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library): box_math, door_logic, night_logic,
// creeper_logic, shelter_logic, sleep_logic, food_logic, texts, home_settings, context, area_kinds, stand_logic
// (the one module that reads the table of the area types of src/agent/areas/area_store.js).
// Executing modules (they move the bot and get `ctx` = { areas, places, settings, log, now, skills,
// world }, and from v0.1.4.8 optionally say, whereAmI, chests, storage): doors, shelter, sleep, food,
// creeper, motion, and the small eat_lock and wake (the library imports them too).
import { shelterAndSleep } from './shelter.js';
import { sleepInBed } from './sleep.js';

export { DOOR_RULES, DOOR_SERVICE_RULES, DoorTracker, DoorWatch, doorAxis, doorCenter, doorKey, doorSides, isIronOpenable, openableKind,
    sideOf } from './door_logic.js';
export { DAY_TICKS, NIGHT_END, NIGHT_START, NOT_HOSTILE_FOR_SHELTER, SHELTER_BUSY_ACTIONS, SHELTER_COOLDOWN_MS,
    isHostileForShelter, isNight, normalizeTimeOfDay, orderedThisNight, shouldShelter } from './night_logic.js';
export { CREEPER_RULES, countsForArea, countsForBot, decide, fuseIsBurning, lineOfSight } from './creeper_logic.js';
export { SHELTER_RANGE, STANDING_RANGE, chooseCoverBlock, chooseShelter, chooseStandingPlace, isBuildingArea,
    isFallingBlockName, isInsideArea, isShelterArea, orderEntrances, roomCenter, sameDimension } from './shelter_logic.js';
export { SLEEP_WINDOW, TICKS_PER_MINUTE, isBedName, minutesUntilNight, orderBeds, sleepErrorKind, sleepTimeState } from './sleep_logic.js';
export { AUTO_EAT_DEFAULTS, BANNED_FOOD, EAT_UNTIL, FULL_FOOD, FULL_HEALTH, HUNGER_RULES, VANILLA_FOODS, autoEatOptions, chooseFood,
    chooseKnownFood, eatTarget, hungerDecision, isEdibleFood, listKnownFood, wantsFood } from './food_logic.js';
export { TEXTS, ateStatusText, ateText, closeNearText, couldNotSleepText, dayText, doorClosedLog, dugInText, hungryText, inShelterText,
    joinAnd, luredText, noFoodText, notHungryText, shelterText, statusText } from './texts.js';
export { HOME_REFLEX_DEFAULTS, readHomeSettings, reflexOn } from './home_settings.js';
export { areaType, hasWalls, isDefendedArea, isGatedArea } from './area_kinds.js';
export { boxCenter, containsPos, distanceToBox, expandBox, horizontalDistanceToBox, interiorBox, isBox } from './box_math.js';

export { DOOR_SAFETY, canOpen, closeDoor, closeDoorsBehind, closeNear, createDoorService, doorDanger, doorIsSafe, doorState, findOpenables,
    isPassingThrough, openDoor, passThrough, releaseDoor, reserveDoor, somebodyInDoor } from './doors.js';
export { bedInShelter, emergencyShelter, enterBuilding, findShelter, goToShelter, isInShelter, standingTest } from './shelter.js';
export { MAX_SLEEP_MS, findBeds, sleepInBed } from './sleep.js';
export { OFFHAND_SLOT, eatBestFood, foodItems, hungerStep, knownFood, moveOffhandBack } from './food.js';
// v0.1.4.8, fix round: one lock for eating (X10) and getting out of bed (X5, the glue calls wakeUp before a
// command that moves the bot)
export { EAT_LOCK_WAIT_MS, acquireEatLock, eatLockOwner, pauseAutoEat, tryEatLock } from './eat_lock.js';
export { WAKE_TRIES, WAKE_WAIT_MS, wakeUp } from './wake.js';
export { FIGHT_SWORDS, TRIES_RESET_MS, canFightCreeper, creeperCheck, creeperMemory, inSight, readCreepers, runCreeperProcedure } from './creeper.js';
export { blockReader, gotoGoal, makeMovements, safeGoal, stopMoving, walkNear } from './motion.js';
// fix round, X1: the blocks the bot never stands in or on
export { NO_STAND_NAMES, goalAvoiding, isNoStandBlock, isNoStandCell } from './stand_logic.js';
export { FARMLAND_BEHIND, farmBehind, freeFarCell, stepMovements } from './doors.js';

/**
 * The night routine of the mode night_shelter: goToShelter, then sleepInBed when a bed is inside
 * the shelter. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, where: string|null, reason: string|null, text: string, slept: boolean}>}
 */
export async function nightShelterRoutine(bot, ctx, options = {}) {
    try {
        return await shelterAndSleep(bot, ctx, options, sleepInBed);
    } catch (err) {
        console.warn('Home pack: the night routine failed:', err?.message ?? err);
        return { ok: false, where: null, reason: 'error', text: `I could not get to the shelter: ${err?.message ?? err}`, slept: false };
    }
}
