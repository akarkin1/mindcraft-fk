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
    // v0.1.4.8 (spec section 8)
    noHome: 'I know no home. Tell me where home is.',
    starving: 'I am starving. I have no food and know no chest with food.',
    noFoodNoChest: 'I carry no food and know no chest with food.',
    doorsClosed: 'All doors near me are closed.',
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
    return `I ate ${joinAnd(parts)}.`;
}

/**
 * Joins parts with commas and "and": `a`, `a and b`, `a, b and c`.
 * @param {string[]} parts
 * @returns {string}
 */
export function joinAnd(parts) {
    const list = Array.isArray(parts) ? parts.filter(p => typeof p === 'string' && p.length > 0) : [];
    if (list.length <= 1) {
        return list[0] ?? '';
    }
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// Health and food as whole numbers for a text. Health is a fraction in mineflayer: it is rounded
// down, so a hurt bot never reads "20 of 20", and a living bot never reads 0.
function wholeHealth(health) {
    if (health >= 20) {
        return 20;
    }
    return health > 0 ? Math.max(1, Math.floor(health)) : 0;
}

/**
 * `Food 19 of 20, health 12 of 20.` (v0.1.4.8, C1). Without a known health: `Food 19 of 20.`
 * @param {number} food
 * @param {number} health
 * @returns {string}
 */
export function statusText(food, health) {
    const f = typeof food === 'number' && Number.isFinite(food) ? Math.round(food) : null;
    const h = typeof health === 'number' && Number.isFinite(health) ? wholeHealth(health) : null;
    if (f === null && h === null) {
        return '';
    }
    if (h === null) {
        return `Food ${f} of 20.`;
    }
    if (f === null) {
        return `Health ${h} of 20.`;
    }
    return `Food ${f} of 20, health ${h} of 20.`;
}

function withStatus(text, food, health) {
    const status = statusText(food, health);
    return status ? `${text} ${status}` : text;
}

/**
 * `I ate 2 bread. Food 19 of 20, health 12 of 20.` (v0.1.4.8, C1)
 * @param {Object<string, number>} counts
 * @param {number} food
 * @param {number} health
 * @returns {string}
 */
export function ateStatusText(counts, food, health) {
    return withStatus(ateText(counts), food, health);
}

/**
 * `I am not hungry. Food 19 of 20, health 20 of 20.` (v0.1.4.8, C1)
 * @param {number} food
 * @param {number} health
 * @returns {string}
 */
export function notHungryText(food, health) {
    return withStatus(TEXTS.notHungry, food, health);
}

/**
 * `I carry no food. The chest at (11, 67, 53) has 5 apple.` for the first entry of knownFood and
 * the other food of the same chest, or `I carry no food and know no chest with food.` (v0.1.4.8, C1)
 * @param {{name: string, count: number, chest: {x,y,z}}[]} known
 * @returns {string}
 */
export function noFoodText(known) {
    const list = Array.isArray(known) ? known.filter(k => k && k.chest && typeof k.name === 'string') : [];
    if (list.length === 0) {
        return TEXTS.noFoodNoChest;
    }
    const chest = list[0].chest;
    const same = list.filter(k => k.chest.x === chest.x && k.chest.y === chest.y && k.chest.z === chest.z);
    const parts = same.map(k => `${k.count} ${k.name}`);
    return `I carry no food. The chest at (${blockCoord(chest.x)}, ${blockCoord(chest.y)}, ${blockCoord(chest.z)}) has ${joinAnd(parts)}.`;
}

/**
 * `I am hungry and carry no food. Food 6 of 20.` (v0.1.4.8, C2)
 * @param {number} food
 * @returns {string}
 */
export function hungryText(food) {
    return `I am hungry and carry no food. Food ${Math.round(food)} of 20.`;
}

/**
 * `I cannot sleep now, it is day. The night starts in about 5 minutes.` (v0.1.4.8, C6)
 * @param {number} minutes whole minutes, at least 1
 * @returns {string}
 */
export function dayText(minutes) {
    const n = Math.max(1, Math.round(minutes));
    return `I cannot sleep now, it is day. The night starts in about ${n} ${n === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * `I am in the shelter "<name>".` when no door of the shelter was checked (v0.1.4.8, C4).
 * @param {string} name
 * @returns {string}
 */
export function inShelterText(name) {
    return `I am in the shelter "${name}".`;
}

/**
 * `Door service: closed <name> at (x, y, z).` for the console (v0.1.4.8, C5).
 * @param {{name: string, x: number, y: number, z: number}} door
 * @returns {string}
 */
export function doorClosedLog(door) {
    return `Door service: closed ${door.name} at (${door.x}, ${door.y}, ${door.z}).`;
}

/**
 * The reply of closeNear (v0.1.4.8, C5): `I closed oak_door at (x, y, z) and oak_fence_gate at
 * (x, y, z).`, `All doors near me are closed.`, and a sentence for the doors it could not close or
 * left open because somebody stood in them.
 * @param {{closed: object[], failed?: object[], occupied?: object[]}} result doors as {name, x, y, z}
 * @returns {string}
 */
export function closeNearText({ closed = [], failed = [], occupied = [] } = {}) {
    const at = d => `${d.name} at (${d.x}, ${d.y}, ${d.z})`;
    const out = [];
    if (closed.length > 0) {
        out.push(`I closed ${joinAnd(closed.map(at))}.`);
    }
    if (failed.length > 0) {
        out.push(`I could not close ${joinAnd(failed.map(at))}.`);
    }
    if (occupied.length > 0) {
        out.push(`I left ${joinAnd(occupied.map(at))} open, because somebody stands in ${occupied.length === 1 ? 'it' : 'them'}.`);
    }
    return out.length > 0 ? out.join(' ') : TEXTS.doorsClosed;
}
