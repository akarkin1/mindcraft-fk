// The AFK creeper kill pack of v0.1.4.16 (spec sections 8.4 and 8.4a, E8): !killFarm stands at the owner's saved kill
// spot, sneaking and stepped under the slab, and kills the hostile mobs within reach. Everything the glue needs is
// exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library, no other pack): afk_logic, texts.
// Executing module (moves the bot, gets `ctx` = { places, chests, storage, tools, routes?, log, say, now }): afk_kill.
// It imports only the home pack (motion, sleep, food, the clock), never the storage, farming, wood or mining pack
// (the switch-guard rule of glue2_flags_off): those come through ctx.
export { BED_RANGE, CHECK_HITS, CHECK_WINDOW_MS, CHEST_RANGE, CREEPER_HEALTH, CREEPER_MODE, DEFAULT_HEIGHT, EAT_AT_FOOD, EYE_SNEAK, EYE_STAND,
    FORBIDDEN_MATERIALS, HIT_GAP_MS, HOPPER_RANGE, KILL_DROPS, KILL_REACH, KILL_WINDOW_MS, LOOP_MS, LOW_HEALTH, PAUSED_MODES, PROGRESS_EVERY,
    ROOM_RANGE, SPARE_AT, STEP_MORE_MS, STEP_MS, STORE_FREE_SLOTS, STUCK_HITS, WEAPONS, WEAPON_CHEST_RANGE, WEAPON_NAMES, WEAPON_WEAR,
    badWindowVerdict, blockDistance, centreOf, checkRoom, chooseWeapon, directionTo, distance, eyeOf, hitsToKill, hopperCells, isForbiddenItem,
    isHostileEntity, isKillTarget, isSlabName, isWeaponName, isWorn, needsSpare, newWindow, parseUntil, pickTarget, rowBetween, stopReason,
    storedCount, stuckHits, usesLeft, windowIsBad, windowOver } from './afk_logic.js';
export { TEXTS, badUntilText, countList, creepersText, durationText, lowHealthText, noWeaponText, progressText, stepCloserText,
    stopLevelText, stopMinutesText, stoppedText, storedLineText, storedText, wornWeaponText } from './texts.js';
export { KILL_SPOT, KILL_CHEST, KILL_BED, KILL_EXIT, START_LINE_EVERY_MS, killFarm } from './afk_kill.js';
