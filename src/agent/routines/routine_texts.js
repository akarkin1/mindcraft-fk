// Texts of the routines (spec v0.1.4.15, part R, 3.6), word for word where the spec gives them. Pure: no imports,
// no side effects. Nothing here throws.

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function quoted(name) {
    return `"${typeof name === 'string' ? name : ''}"`;
}

/**
 * A text as one sentence: whitespace one space, one full stop at the end. '' for no text.
 * @param {*} text
 * @returns {string}
 */
export function sentenceOf(text) {
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (clean.length === 0) {
        return '';
    }
    return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

/**
 * `every 15 minutes`; `every minute` for 1. A value that is no whole number of 1 or more reads as 15.
 * @param {number} every minutes
 * @returns {string}
 */
export function everyText(every) {
    const n = Number.isInteger(every) && every >= 1 ? every : 15;
    return n === 1 ? 'every minute' : `every ${n} minutes`;
}

/**
 * `when fewer than 32 torch`; '' without a condition.
 * @param {{item: string, fewerThan: number}|null} condition
 * @returns {string}
 */
export function conditionText(condition) {
    if (!isPlainObject(condition) || typeof condition.item !== 'string' || !Number.isInteger(condition.fewerThan)) {
        return '';
    }
    return `when fewer than ${condition.fewerThan} ${condition.item}`;
}

/**
 * `03:12`: the local time of an ISO stamp, hours and minutes; '' for a stamp that is no time.
 * @param {string} iso
 * @returns {string}
 */
export function clockText(iso) {
    const t = typeof iso === 'string' ? new Date(iso) : null;
    if (t === null || !Number.isFinite(t.getTime())) {
        return '';
    }
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/**
 * `I remember the routine "the farm": harvest the wheat and the carrots and plant them again, then put the harvest in
 * the chest by the door. I do it when I have nothing else to do, every 15 minutes.` With a condition the condition
 * follows the minutes: `..., every 15 minutes, when fewer than 32 torch.`
 * @param {{name: string, text: string, every: number, condition: object|null}} routine
 * @returns {string}
 */
export function rememberedText(routine) {
    const r = isPlainObject(routine) ? routine : {};
    const condition = conditionText(r.condition);
    return `I remember the routine ${quoted(r.name)}: ${sentenceOf(r.text)} I do it when I have nothing else to do, ${everyText(r.every)}${condition ? `, ${condition}` : ''}.`;
}

/** `I know that routine already as "the farm".` */
export function knownText(name) {
    return `I know that routine already as ${quoted(name)}.`;
}

/** `I have 12 routines already; forget one first.` */
export function fullText(max) {
    return `I have ${Number.isInteger(max) ? max : 12} routines already; forget one first.`;
}

/**
 * One routine of the list: `the farm (every 15 minutes, 4 rounds, last 03:12)`, `torches (when fewer than 32 torch,
 * paused)`. The condition stands in for the minutes when there is one; the rounds and the last round only when
 * there were any; `paused` for a paused routine.
 * @param {object} routine
 * @returns {string}
 */
export function routineLine(routine) {
    const r = isPlainObject(routine) ? routine : {};
    const parts = [conditionText(r.condition) || everyText(r.every)];
    if (Number.isInteger(r.rounds) && r.rounds > 0) {
        parts.push(`${r.rounds} ${r.rounds === 1 ? 'round' : 'rounds'}`);
    }
    const last = clockText(r.lastRound);
    if (last) {
        parts.push(`last ${last}`);
    }
    if (r.state === 'paused') {
        parts.push('paused');
    }
    return `${typeof r.name === 'string' ? r.name : ''} (${parts.join(', ')})`;
}

/**
 * `My routines: the farm (every 15 minutes, 4 rounds, last 03:12); torches (when fewer than 32 torch, paused).`
 * @param {object[]} routines
 * @returns {string}
 */
export function listText(routines) {
    const list = (Array.isArray(routines) ? routines : []).filter(isPlainObject);
    if (list.length === 0) {
        return noRoutinesText();
    }
    return `My routines: ${list.map(routineLine).join('; ')}.`;
}

/** `I have no routines.` */
export function noRoutinesText() {
    return 'I have no routines.';
}

/** `I forgot the routine "the farm".` */
export function forgotText(name) {
    return `I forgot the routine ${quoted(name)}.`;
}

/** `I know no routine "x".` */
export function unknownText(name) {
    return `I know no routine ${quoted(name)}.`;
}

/**
 * `My plan for "the farm": !harvest("farm"), !plant("farm"), !putInChest("wheat", 64). I start.`
 * @param {string} name
 * @param {({command: string}|string)[]} steps
 * @returns {string}
 */
export function planText(name, steps) {
    const commands = (Array.isArray(steps) ? steps : []).map(s => (typeof s === 'string' ? s : s?.command)).filter(c => typeof c === 'string' && c.length > 0);
    return `My plan for ${quoted(name)}: ${commands.join(', ')}. I start.`;
}

/**
 * `I could not plan the routine "the farm": the command !x is not one I may use. Say it differently.`
 * @param {string} name
 * @param {string} reason one of planReasons
 * @returns {string}
 */
export function badPlanText(name, reason) {
    const why = typeof reason === 'string' && reason.length > 0 ? reason : 'the plan does not fit my commands';
    return `I could not plan the routine ${quoted(name)}: ${why}. Say it differently.`;
}

/** `I cannot do the routine "the farm" with my commands. Say it differently.` */
export function noPlanText(name) {
    return `I cannot do the routine ${quoted(name)} with my commands. Say it differently.`;
}

/** `I start the routine "the farm", round 5.` */
export function roundStartText(name, round) {
    return `I start the routine ${quoted(name)}, round ${Number.isInteger(round) && round >= 1 ? round : 1}.`;
}

/** `Round 5 of "the farm" is done.` */
export function roundDoneText(name, round) {
    return `Round ${Number.isInteger(round) && round >= 1 ? round : 1} of ${quoted(name)} is done.`;
}

/**
 * `I pause the routine "the farm": !harvest("farm") failed three times. Say "do the routine the farm" to try again.`
 * @param {string} name
 * @param {string|null} step the command of the step that failed; `the round` when it is not known
 * @returns {string}
 */
export function pausedText(name, step) {
    const what = typeof step === 'string' && step.length > 0 ? step : 'the round';
    return `I pause the routine ${quoted(name)}: ${what} failed three times. Say "do the routine ${typeof name === 'string' ? name : ''}" to try again.`;
}

/** `The routine "torches" waits: I have 40 torch.` */
export function waitsText(name, count, item) {
    return `The routine ${quoted(name)} waits: I have ${Number.isFinite(count) ? count : 0} ${typeof item === 'string' ? item : 'of it'}.`;
}

/** The answer of a routine command while the switch is off (the commands are hidden then; a guard). */
export const ROUTINES_OFF = 'Routines are off.';

/** The answers to a name or a text that cannot be saved (3.1: a name like an area name, a text of at most 400 characters). */
export const NAME_TEXT = 'The name of a routine is 1 to 64 characters.';

/**
 * v0.1.4.16 (F3): the cap of the text with the count: `The text of a routine is 1 to 400 characters; yours has 412.`
 * @param {number} n the length of the text given
 * @returns {string}
 */
export function textText(n) {
    return `The text of a routine is 1 to 400 characters; yours has ${Number.isInteger(n) && n >= 0 ? n : 0}.`;
}

/** The same text under the name of v0.1.4.15 (a function since F3: the count is in the line). */
export { textText as TEXT_TEXT };

/**
 * v0.1.4.16 (F3): the quiet line of a step of a round that failed after its runs and is skipped: `Step 2 of "the farm"
 * failed: I found no chest; I go on.` The text of the failure loses its final full stop before the semicolon.
 * @param {number} n the number of the step, from 1
 * @param {string} name the routine
 * @param {string} text the text of the failure
 * @returns {string}
 */
export function stepSkippedText(n, name, text) {
    const why = (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
    return `Step ${Number.isInteger(n) && n >= 1 ? n : 1} of ${quoted(name)} failed: ${why}; I go on.`;
}

/**
 * v0.1.4.16 (F3): the words of a place the plan lost, for planReasons.places: `the place (x, y, z)` for a coordinate,
 * `the place "name"` for a saved place.
 * @param {{x: number, y: number, z: number}|string} place
 * @returns {string}
 */
export function lostPlaceWords(place) {
    if (isPlainObject(place)) {
        return `the place (${place.x}, ${place.y}, ${place.z})`;
    }
    return `the place ${quoted(place)}`;
}

/**
 * The reasons of a refused plan (3.6): `the command !x is not one I may use`, `!x takes a number`, `too many steps`;
 * v0.1.4.16 (F3): `the plan lost the place (x, y, z) you named` (places).
 */
export const planReasons = Object.freeze({
    notAllowed: (name) => `the command ${name} is not one I may use`,
    number: (name) => `${name} takes a number`,
    text: (name) => `${name} takes a text`,
    tooManyArgs: (name, n) => `${name} takes at most ${n} ${n === 1 ? 'argument' : 'arguments'}`,
    tooMany: 'too many steps',
    noSteps: 'no steps',
    places: (what) => `the plan lost ${what} you named`,
});
