// The home pack of v0.1.4.6 (spec section 5, part H): doors, shelter, night, sleep, food, creepers.
// Everything the glue needs is exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library): box_math, door_logic, night_logic,
// creeper_logic, shelter_logic, sleep_logic, food_logic, texts, home_settings, context.
// Executing modules (they move the bot and get `ctx` = { areas, places, settings, log, now, skills,
// world }): doors, shelter, sleep, food, creeper, motion.
import { shelterAndSleep } from './shelter.js';
import { sleepInBed } from './sleep.js';

export { DOOR_RULES, DoorTracker, doorAxis, doorCenter, doorKey, doorSides, isIronOpenable, openableKind, sideOf } from './door_logic.js';
export { DAY_TICKS, NIGHT_END, NIGHT_START, NOT_HOSTILE_FOR_SHELTER, SHELTER_BUSY_ACTIONS, SHELTER_COOLDOWN_MS,
    isHostileForShelter, isNight, normalizeTimeOfDay, orderedThisNight, shouldShelter } from './night_logic.js';
export { CREEPER_RULES, decide, fuseIsBurning } from './creeper_logic.js';
export { SHELTER_RANGE, STANDING_RANGE, chooseCoverBlock, chooseShelter, chooseStandingPlace, isBuildingArea,
    isFallingBlockName, isInsideArea, orderEntrances, roomCenter, sameDimension } from './shelter_logic.js';
export { SLEEP_WINDOW, isBedName, orderBeds, sleepErrorKind, sleepTimeState } from './sleep_logic.js';
export { AUTO_EAT_DEFAULTS, BANNED_FOOD, EAT_UNTIL, FULL_FOOD, autoEatOptions, chooseFood, isEdibleFood } from './food_logic.js';
export { TEXTS, ateText, couldNotSleepText, dugInText, luredText, shelterText } from './texts.js';
export { HOME_REFLEX_DEFAULTS, readHomeSettings, reflexOn } from './home_settings.js';
export { boxCenter, containsPos, distanceToBox, expandBox, horizontalDistanceToBox, interiorBox, isBox } from './box_math.js';

export { DOOR_SAFETY, closeDoor, closeDoorsBehind, doorDanger, doorIsSafe, findOpenables, isPassingThrough, openDoor, passThrough } from './doors.js';
export { bedInShelter, emergencyShelter, enterBuilding, findShelter, goToShelter, isInShelter, standingTest } from './shelter.js';
export { MAX_SLEEP_MS, findBeds, sleepInBed } from './sleep.js';
export { eatBestFood } from './food.js';
export { FIGHT_SWORDS, TRIES_RESET_MS, canFightCreeper, creeperCheck, creeperMemory, readCreepers, runCreeperProcedure } from './creeper.js';
export { gotoGoal, makeMovements, stopMoving, walkNear } from './motion.js';

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
