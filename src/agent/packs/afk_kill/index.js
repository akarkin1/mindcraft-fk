// The AFK creeper kill pack of v0.1.4.16 (spec section 8.4, E8): !killFarm stands at the owner's saved kill spot,
// sneaking and stepped under the slab, and kills what lands on the hoppers. Everything the glue needs is exported
// here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library): afk_logic, texts.
// Executing module (moves the bot, gets `ctx` = { places, chests, storage, tools, routes?, log, say, now }): afk_kill.
export { BED_RANGE, CHECK_HITS, CHECK_WINDOW_MS, CHEST_RANGE, CREEPER_HEALTH, CREEPER_MODE, EAT_AT_FOOD, EYE_SNEAK, EYE_STAND, HIT_GAP_MS,
    HOPPER_RANGE, KILL_DROPS, KILL_REACH, KILL_WINDOW_MS, LOOP_MS, LOW_HEALTH, PAUSED_MODES, PROGRESS_EVERY, ROOM_RANGE, STEP_MORE_MS,
    STEP_MS, STORE_FREE_SLOTS, WEAPONS, WEAPON_CHEST_RANGE, WEAPON_NAMES, WEAPON_WEAR, badWindowVerdict, blockDistance, checkRoom,
    chooseWeapon, directionTo, distance, eyeOf, hitsToKill, hopperCells, isHostileEntity, isKillTarget, isSlabName, isWeaponName,
    newWindow, onHopper, parseUntil, pickTarget, rowBetween, stopReason, storedCount, windowIsBad, windowOver } from './afk_logic.js';
export { TEXTS, badUntilText, countList, creepersText, durationText, lowHealthText, noWeaponText, progressText, stepCloserText,
    stopLevelText, stopMinutesText, stoppedText, storedLineText, storedText, wornWeaponText } from './texts.js';
export { KILL_SPOT, KILL_CHEST, KILL_BED, KILL_EXIT, killFarm } from './afk_kill.js';
