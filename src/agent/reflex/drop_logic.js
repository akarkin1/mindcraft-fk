// What the bot leaves on the ground (v0.1.4.13, part Q, SPEC 4.6 Q5 and Q6): the items it tossed itself (a give) for
// 30 s, and a player's death drops: the items within 4 blocks of where a player died, for 5 minutes. The death is read
// from the death message of the server (a system message whose translation key starts with `death.`, the first
// argument the player who died); the position is that player's entity at the time of the message. Pure: no imports.

/** The numbers of Q5 and Q6. */
export const DROP_RULES = Object.freeze({
    tossMs: 30000,   // Q5: an item the bot tossed is left this long
    deathMs: 300000, // Q6: the drops of a death are left this long
    deathRange: 4,   // Q6: an item within this many blocks of the death is one of its drops
    nearMs: 10000,   // two notes of the same player's death within this long are one death
    stepRange: 2,    // Q6: a death drop this near the bot (in x and z) makes it step away, so the server gives it nothing
});

function isPoint(p) {
    return p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function textOf(part) {
    if (typeof part === 'string') {
        return part;
    }
    if (part === null || typeof part !== 'object') {
        return '';
    }
    try {
        if (typeof part.toString === 'function' && part.toString !== Object.prototype.toString) {
            const s = part.toString();
            if (typeof s === 'string' && s !== '[object Object]') {
                return s;
            }
        }
    } catch {
        // the fields below
    }
    if (typeof part.text === 'string' && part.text !== '') {
        return part.text;
    }
    if (typeof part.insertion === 'string') {
        return part.insertion;
    }
    return Array.isArray(part.extra) ? part.extra.map(textOf).join('') : '';
}

/**
 * The player who died, from a chat message of the server (Q6): a message whose `translate` starts with `death.` names
 * the player in its first argument (`with[0]`). null for any other message, and for the bot itself.
 * @param {{translate?: string, with?: object[]}|null} message the message as mineflayer gives it (a ChatMessage) or its json
 * @param {string} [self] the bot's name
 * @returns {string|null}
 */
export function deathOf(message, self = '') {
    try {
        const key = message?.translate ?? message?.json?.translate;
        const args = message?.with ?? message?.json?.with;
        if (typeof key !== 'string' || !key.startsWith('death.') || !Array.isArray(args) || args.length === 0) {
            return null;
        }
        const name = textOf(args[0]).trim();
        return name !== '' && name !== self ? name : null;
    } catch {
        return null;
    }
}

/**
 * A death to note (Q6): the list with the new death `{ name, at, time, said: false }`, the deaths older than 5 minutes
 * left out; a death of the same player within 10 s of a noted one is the same death (the list as it is).
 * @param {{name: string, at: object, time: number, said?: boolean}[]} deaths
 * @param {string} name
 * @param {{x, y, z}} at where the player died
 * @param {number} now
 * @returns {object[]}
 */
export function noteDeath(deaths, name, at, now) {
    const list = forgetDeaths(deaths, now);
    if (typeof name !== 'string' || name === '' || !isPoint(at)) {
        return list;
    }
    if (list.some(d => d.name === name && now - d.time < DROP_RULES.nearMs)) {
        return list;
    }
    return [...list, { name, at: { x: at.x, y: at.y, z: at.z }, time: now, said: false }];
}

/**
 * The deaths of the last 5 minutes.
 * @param {object[]} deaths
 * @param {number} now
 * @returns {object[]}
 */
export function forgetDeaths(deaths, now) {
    return (Array.isArray(deaths) ? deaths : []).filter(d => d && isPoint(d.at) && Number.isFinite(d.time) && now - d.time < DROP_RULES.deathMs);
}

/**
 * The death whose drops an item at `pos` is (Q6): the newest death of the last 5 minutes within 4 blocks of `pos`, or null.
 * @param {object[]} deaths
 * @param {{x, y, z}} pos the item
 * @param {number} now
 * @returns {object|null}
 */
export function deathNear(deaths, pos, now) {
    if (!isPoint(pos)) {
        return null;
    }
    const near = forgetDeaths(deaths, now).filter(d => Math.hypot(d.at.x - pos.x, d.at.y - pos.y, d.at.z - pos.z) <= DROP_RULES.deathRange);
    return near.length > 0 ? near.reduce((a, b) => (b.time > a.time ? b : a)) : null;
}

/**
 * True while an item the bot tossed is left alone (Q5): it was tossed less than 30 s ago.
 * @param {Map<number, number>|null} tossed entity id -> when it was tossed
 * @param {number} id
 * @param {number} now
 * @returns {boolean}
 */
export function isTossed(tossed, id, now) {
    const at = tossed instanceof Map ? tossed.get(id) : undefined;
    return Number.isFinite(at) && now - at < DROP_RULES.tossMs;
}

/**
 * The tosses of the last 30 s.
 * @param {Map<number, number>} tossed
 * @param {number} now
 * @returns {Map<number, number>} the same map
 */
export function forgetTosses(tossed, now) {
    if (tossed instanceof Map) {
        for (const [id, at] of tossed) {
            if (!Number.isFinite(at) || now - at >= DROP_RULES.tossMs) {
                tossed.delete(id);
            }
        }
    }
    return tossed;
}

/**
 * Q6, word for word: `I leave MartyByrde2's things at (13, -57, -99).`
 * @param {string} name the player who died
 * @param {{x, y, z}} at where he died
 * @returns {string}
 */
export function leaveThingsText(name, at) {
    return `I leave ${name}'s things at (${Math.floor(at?.x)}, ${Math.floor(at?.y)}, ${Math.floor(at?.z)}).`;
}

// --- the armour rule (Q6) ---

const ARMOUR_ENDINGS = Object.freeze(['_helmet', '_chestplate', '_leggings', '_boots']);

/**
 * True for a piece of armour a player wears: a helmet, chestplate, leggings, boots, the elytra, a turtle shell, a
 * carved pumpkin is no armour here.
 * @param {string} name
 * @returns {boolean}
 */
export function isArmourName(name) {
    return typeof name === 'string' && (ARMOUR_ENDINGS.some(e => name.endsWith(e)) || name === 'elytra');
}

/** The slot of a piece of armour for bot.equip: head, torso, legs, feet; null for no armour. */
export function armourSlot(name) {
    if (!isArmourName(name)) {
        return null;
    }
    if (name.endsWith('_helmet')) {
        return 'head';
    }
    if (name.endsWith('_chestplate') || name === 'elytra') {
        return 'torso';
    }
    return name.endsWith('_leggings') ? 'legs' : 'feet';
}

const MATERIAL_RANK = Object.freeze(['leather', 'golden', 'chainmail', 'iron', 'turtle', 'diamond', 'netherite']);

/**
 * The rank of a piece of armour by its material (leather lowest, netherite highest), -1 for none.
 * @param {string} name
 * @returns {number}
 */
export function armourRank(name) {
    if (!isArmourName(name)) {
        return -1;
    }
    return MATERIAL_RANK.findIndex(m => name.startsWith(`${m}_`));
}

/**
 * Q6: true when the bot may put on a piece of armour by itself: it is armour and the bot did not pick that kind up from
 * the ground (`fromGround`, the names it picked up and still carries).
 * @param {string} name
 * @param {Set<string>|null} fromGround
 * @returns {boolean}
 */
export function mayWear(name, fromGround) {
    return isArmourName(name) && !(fromGround instanceof Set && fromGround.has(name));
}
