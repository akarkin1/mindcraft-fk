// Texts of the home pack that the player or the model reads. The spec v0.1.4.6 gives them word
// for word, tests compare them. Pure.

/** Fixed texts. */
export const TEXTS = Object.freeze({
    inShelterAlready: 'I am in the shelter already.',
    monstersAtDoor: 'I cannot get into the shelter. Monsters are at the door.',
    slept: 'I slept. It is morning.',
    notNight: 'I cannot sleep now, it is not night.',
    noBed: 'I found no bed nearby.',
    monstersNearBed: 'I cannot sleep, monsters are nearby.',
    bedsTaken: 'All beds nearby are taken.',
    notHungry: 'I am not hungry.',
    noFood: 'I have no food.',
    creeperHelp: 'A creeper keeps following me near the base. I stay away from the buildings. Can you help?',
    backedOff: 'I backed off from a creeper.',
    gettingDark: 'It is getting dark. I go to the shelter.',
});

function blockCoord(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : value;
}

function errorText(err) {
    if (typeof err === 'string') {
        return err;
    }
    return typeof err?.message === 'string' ? err.message : String(err);
}

/**
 * `I am in the shelter "<name>". The door is closed.`
 * @param {string} name
 * @returns {string}
 */
export function shelterText(name) {
    return `I am in the shelter "${name}". The door is closed.`;
}

/**
 * `I have no shelter. I dug in at (x, y, z) and closed the hole.` with block coordinates.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function dugInText(pos) {
    return `I have no shelter. I dug in at (${blockCoord(pos.x)}, ${blockCoord(pos.y)}, ${blockCoord(pos.z)}) and closed the hole.`;
}

/**
 * `I could not sleep: <error text>`
 * @param {Error|string} err
 * @returns {string}
 */
export function couldNotSleepText(err) {
    return `I could not sleep: ${errorText(err)}`;
}

/**
 * `A creeper stands near "<area>" and does not follow me. I keep away from it.` (Amendment 2, F3)
 * @param {string} area
 * @returns {string}
 */
export function standingCreeperText(area) {
    return `A creeper stands near "${area}" and does not follow me. I keep away from it.`;
}

/**
 * `A creeper stands near the shelter "<name>". I do not go in while it is there.` (Amendment 2, F3)
 * @param {string} name
 * @returns {string}
 */
export function creeperAtShelterText(name) {
    return `A creeper stands near the shelter "${name}". I do not go in while it is there.`;
}

/**
 * `I led a creeper away from "<area>" and lost it.`
 * @param {string} area
 * @returns {string}
 */
export function luredText(area) {
    return `I led a creeper away from "${area}" and lost it.`;
}

/**
 * `I ate 2 bread.`, several kinds joined with commas and "and".
 * @param {Object<string, number>} counts eaten items by name, in the order they were eaten
 * @returns {string}
 */
export function ateText(counts) {
    const parts = Object.entries(counts ?? {}).map(([name, n]) => `${n} ${name}`);
    if (parts.length === 0) {
        return 'I ate nothing.';
    }
    if (parts.length === 1) {
        return `I ate ${parts[0]}.`;
    }
    return `I ate ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}
