// The breeding pack of v0.1.4.16 (SPEC 8.2, E6): !breed(pen, count) feeds the animals of a saved pen from outside its fence,
// never opening a gate, until new animals are born; and the asking rule of the stock permits (SPEC 8.1): takeOrAsk, which
// the enchanting and kill packs reach as ctx.stock.takeOrAsk while this pack is loaded. Behind the switch breeding. Zero
// model calls. Everything the glue needs is exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library, no other pack): breeding_logic (the feed, the species, the cap, the
// stand ring, the adults in reach, the young), texts (the texts, word for word).
// Executing modules: stock_logic (takeOrAsk: the chests, the question, the permits), breeding (the walk, the clicks).
// The store of the permits: src/agent/world/stock_permits.js (permits.json per world, ctx.permits), re-exported for the glue.
import { breed } from './breeding.js';
import { takeOrAsk } from './stock_logic.js';

export { FEED, PEN_CAP, FEED_REACH, BREED_COOLDOWN_MS, COOLDOWN_CHECK_MS, COME_WAIT_MS, EXTRA_ROUNDS, EYE_HEIGHT, FENCE_ENDINGS, feedOf, speciesOf,
    animalCount, cleanCount, feedNeeded, lowMark, isBaby, eyesOf, insideBox, insideBoxXZ, isFenceName, fenceBoxOf, standRing, withoutGateCells,
    ringFrom, gatesOf, animalsIn, adultsInReach, newBabies } from './breeding_logic.js';
export { PURPOSES, BRED_SPECIES, whereText, speciesWords, youngWords, penWords, unknownPenText, unknownSpeciesText, noAnimalsText, penFullText,
    noFeedText, fedText, endText, stoppedText, noWayText, tookText, askText, askLowText, noPermitText, noStockText } from './texts.js';
export { STOCK_RULES, bagCount, chestsWith, takeOrAsk } from './stock_logic.js';
export { BREED_RULES, breed } from './breeding.js';
export { PERMITS_FILE, ALLOW_SAID_TEXT, StockPermits, normalizeItemName, allowTakingText } from '../../world/stock_permits.js';

/** The work of the command and the asking rule, not bound (the glue gives bot and ctx). */
export const BREEDING_API = Object.freeze({ breed, takeOrAsk });
