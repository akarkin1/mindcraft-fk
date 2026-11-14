// The enchanting pack of v0.1.4.16 (SPEC 8.3, E7): !enchant(item, choice) reads the three offers of an enchanting table
// within 32 blocks and says them, the owner (or the code, with the choice in the order) chooses; !enchantTake(n) is the
// owner's answer. The lapis from the bag, else from the chests the bot knows with the owner's permit (8.1). Behind the switch
// enchanting. Zero model calls. Everything the glue needs is exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library, no other pack): enchant_logic (the item, the choice, the offers of the
// window, the name matching, the level rule, the roman numerals, the words of the enchantments), texts (word for word).
// Executing module (gets `ctx`): enchanting (the walk, the window, the question, the lapis).
export { ENCHANT_RULES, ITEM_KINDS, MATERIAL_ORDER, roman, cleanItemRequest, kindOf, isOfKind, materialRank, chooseItem, parseChoice, parseTake,
    hasData, offersFrom, matchOffer, levelShort, enchantsOfItem, enchantmentWords, windowSlotOf } from './enchant_logic.js';
export { TEXTS, LAPIS, PURPOSE, whereText, itemWords, noItemText, noOfferText, offerWords, offersText, tookBackText, levelText, enchantedText,
    badChoiceText, unreachableText, failedText, takeText, logLine, tookText, askText, askLowText, noPermitText, noStockText } from './texts.js';
export { enchant, enchantTake, questionWaits } from './enchanting.js';
