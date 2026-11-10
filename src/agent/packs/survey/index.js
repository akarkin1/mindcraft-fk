// The survey pack of v0.1.4.15 "The base survey and Routines" (PLAN section 4, SPEC section 2): "here is the base, scan
// it". The bot finds every place of a base from the loaded blocks around it (the one exception to the no-x-ray rule of
// v0.1.4.13, with the ore guard), saves them all at once with the base's name and reports in one line; the owner corrects
// by name (!renameArea, !forgetArea) and walks to a base (!goToBase). Zero model calls. Behind the switch base_survey.
// Everything the glue needs is exported here. Importing this file has no side effects.
//
// Pure modules (no mineflayer, no src/agent/library, no other pack): survey_logic (E1: the seed names, the ore-blind
// reader, the seeds, the places), underground_logic (E4: the ladder, the basement, the openings of its rock walls, the
// route), texts (E1: the texts, word for word).
// Executing modules: survey (E4: the reads of the bot, the saves through ctx, the commands' work).
// The store of the bases: src/agent/world/base_store.js (bases.json per world), re-exported for the glue (_workStore).
import { surveyBase, renameArea, forgetSurveyed, goToBase } from './survey.js';

export { SEED_NAMES, SEED_CATEGORIES, ANIMAL_NAMES, CROP_FARMS, LEASH_RANGE, HALL_REACH, CANE_MIN, POINT_REACH, oreBlind, isOreName, seedsOf,
    findPlaces, farmName, penName, uniqueName } from './survey_logic.js';
export { UNDERGROUND_RULES, UNDERGROUND_NAMES, followLadder, basementOf, wallOpenings, undergroundOf, routeOfSurvey, caveMouthArea,
    mineEntrancePlace, basementPlace } from './underground_logic.js';
export { REPORT_ORDER, roleOf, itemText, keptText, reportText, tiedRuleText, nothingText, nothingFoundText, againText, renamedText,
    unknownPlaceText, placeExistsText, forgotBaseText, atBaseText, noBaseText } from './texts.js';
export { SURVEY_RULES, surveyRadius, surveyBase, renameArea, forgetSurveyed, goToBase, forgotPlaceText, noWayToBaseText } from './survey.js';
export { BASE_FILE, BaseStore, normalizeBaseName } from '../../world/base_store.js';

/** The work of the four commands, not bound (the glue gives bot and ctx). */
export const SURVEY_API = Object.freeze({ surveyBase, renameArea, forgetSurveyed, goToBase });
