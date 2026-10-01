// Which doors the bot should close behind itself (spec v0.1.4.6 H1), and the geometry of doors.
// Pure: positions and a clock go in, decisions come out.

/** Numbers of the door rule of the spec. */
export const DOOR_RULES = Object.freeze({
    nearDistance: 1.5,     // the bot was this close to the door ...
    nearWindowMs: 10000,   // ... during this time
    minDistance: 1.2,      // it is now more than this away ...
    maxDistance: 4,        // ... and at most this
    playerClearance: 2,    // no other player this close to the door
    awayMs: 500,           // it has been away for at least this long ...
    clearDistance: 2,      // ... or it is at least this far away (see below)
    repeatMs: 2000,        // a door is not returned twice within this time
});

// Why clearDistance: the path finder sprints, about 5.6 blocks per second. From 1.2 to 4 blocks the
// bot needs 0.5 s, so "away for 0.5 s and at most 4 blocks" almost never holds at the same moment,
// and the reflex looks only every 300 ms. On the real server the door stayed open behind a bot that
// walked on (v0.1.4.6 world test "doors", B). A bot 2 blocks from the door has surely left the
// doorway: the door is closed then without waiting.

const FACING_AXIS = Object.freeze({
    north: Object.freeze({ x: 0, z: 1 }),
    south: Object.freeze({ x: 0, z: 1 }),
    east: Object.freeze({ x: 1, z: 0 }),
    west: Object.freeze({ x: 1, z: 0 }),
});

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function toMs(value) {
    if (value instanceof Date) {
        return value.getTime();
    }
    return isFiniteNumber(value) ? value : Date.now();
}

/**
 * True for the names of iron doors and iron trapdoors, which a hand cannot open.
 * @param {string} name
 * @returns {boolean}
 */
export function isIronOpenable(name) {
    return typeof name === 'string' && name.startsWith('iron_') && (name.endsWith('_door') || name.endsWith('_trapdoor'));
}

/**
 * The kind of a block that a hand can open.
 * @param {string} name block name
 * @returns {'door'|'gate'|'trapdoor'|null} null for anything else, iron included
 */
export function openableKind(name) {
    if (typeof name !== 'string' || isIronOpenable(name)) {
        return null;
    }
    if (name.endsWith('_trapdoor')) {
        return 'trapdoor';
    }
    if (name.endsWith('_door')) {
        return 'door';
    }
    if (name.endsWith('_fence_gate')) {
        return 'gate';
    }
    return null;
}

/**
 * Key of a door position, "x,y,z".
 * @param {{x: number, y: number, z: number}} door
 * @returns {string}
 */
export function doorKey(door) {
    return `${door.x},${door.y},${door.z}`;
}

/**
 * The centre of the door block at feet level, where distances are measured from.
 * @param {{x: number, y: number, z: number}} door
 * @returns {{x: number, y: number, z: number}}
 */
export function doorCenter(door) {
    return { x: door.x + 0.5, y: door.y, z: door.z + 0.5 };
}

/**
 * The axis along which one walks through a door or gate with this facing.
 * @param {string} facing north, south, east or west
 * @returns {{x: number, z: number}|null}
 */
export function doorAxis(facing) {
    const axis = FACING_AXIS[facing];
    return axis ? { x: axis.x, z: axis.z } : null;
}

/**
 * The two cells in front of and behind a door or fence gate: first the one on the negative
 * side of the axis, then the one on the positive side. Trapdoors have none.
 * @param {{x: number, y: number, z: number, kind?: string, facing?: string}} door
 * @returns {{x: number, y: number, z: number}[]|null}
 */
export function doorSides(door) {
    if (!isPoint(door) || door.kind === 'trapdoor') {
        return null;
    }
    const axis = doorAxis(door.facing);
    if (!axis) {
        return null;
    }
    return [
        { x: door.x - axis.x, y: door.y, z: door.z - axis.z },
        { x: door.x + axis.x, y: door.y, z: door.z + axis.z },
    ];
}

/**
 * On which side of the door a position is: -1 or 1 like doorSides, 0 in the doorway or when
 * the door has no facing.
 * @param {object} door
 * @param {{x: number, y: number, z: number}} pos
 * @returns {-1|0|1}
 */
export function sideOf(door, pos) {
    if (!isPoint(door) || !isPoint(pos)) {
        return 0;
    }
    const axis = doorAxis(door.facing);
    if (!axis) {
        return 0;
    }
    const c = doorCenter(door);
    const along = (pos.x - c.x) * axis.x + (pos.z - c.z) * axis.z;
    if (along > 0.3) {
        return 1;
    }
    return along < -0.3 ? -1 : 0;
}

function isIronDoorRecord(door) {
    return isIronOpenable(door.name) || (typeof door.kind === 'string' && door.kind.startsWith('iron'));
}

function dist3(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * Remembers where the bot was relative to the doors around it and returns the doors it should
 * close now. Rules of the spec H1: the door is open, the bot was within 1.5 blocks of it during
 * the last 10 s, the bot is now more than 1.2 and at most 4 blocks away and has been away for
 * at least 0.5 s or is at least 2 blocks away (clearDistance, see DOOR_RULES), no other player
 * is within 2 blocks of the door, the door was not returned
 * during the last 2 s, and it is not made of iron.
 */
export class DoorTracker {
    /**
     * @param {{now?: () => (number|Date)}} options clock in milliseconds
     */
    constructor(options = {}) {
        const now = options?.now;
        this.now = typeof now === 'function' ? () => toMs(now()) : () => Date.now();
        this._doors = new Map();
    }

    /** Number of doors the tracker remembers. */
    get size() {
        return this._doors.size;
    }

    /** Forgets everything. */
    reset() {
        this._doors = new Map();
    }

    /**
     * Called a few times per second.
     * @param {{botPos: {x,y,z}, doors: {x,y,z,kind,open,name?}[], players: {x,y,z}[]}} input
     *   doors within 6 blocks (lower block of a door), positions of the other players
     * @returns {object[]} copies of the doors to close now
     */
    observe(input = {}) {
        const t = this.now();
        const botPos = input?.botPos;
        const doors = Array.isArray(input?.doors) ? input.doors : [];
        const players = Array.isArray(input?.players) ? input.players.filter(isPoint) : [];
        const out = [];
        if (isPoint(botPos)) {
            for (const door of doors) {
                if (!isPoint(door)) {
                    continue;
                }
                if (this._update(door, botPos, players, t)) {
                    out.push({ ...door });
                }
            }
        }
        this._forget(t);
        return out;
    }

    _update(door, botPos, players, t) {
        const key = doorKey(door);
        let entry = this._doors.get(key);
        if (!entry) {
            entry = { lastNear: null, awaySince: null, lastReturned: null, lastSeen: t };
            this._doors.set(key, entry);
        }
        entry.lastSeen = t;
        const center = doorCenter(door);
        const d = dist3(botPos, center);
        if (d <= DOOR_RULES.nearDistance) {
            entry.lastNear = t;
        }
        if (d > DOOR_RULES.minDistance) {
            if (entry.awaySince === null && entry.lastNear !== null) {
                entry.awaySince = t;
            }
        } else {
            entry.awaySince = null;
        }
        if (door.open !== true || isIronDoorRecord(door)) {
            return false;
        }
        if (entry.lastNear === null || t - entry.lastNear > DOOR_RULES.nearWindowMs) {
            return false;
        }
        if (d <= DOOR_RULES.minDistance || d > DOOR_RULES.maxDistance) {
            return false;
        }
        if (entry.awaySince === null || (t - entry.awaySince < DOOR_RULES.awayMs && d < DOOR_RULES.clearDistance)) {
            return false;
        }
        if (players.some(pl => dist3(pl, center) <= DOOR_RULES.playerClearance)) {
            return false;
        }
        if (entry.lastReturned !== null && t - entry.lastReturned < DOOR_RULES.repeatMs) {
            return false;
        }
        entry.lastReturned = t;
        return true;
    }

    _forget(t) {
        for (const [key, entry] of this._doors) {
            if (t - entry.lastSeen > DOOR_RULES.nearWindowMs) {
                this._doors.delete(key);
            }
        }
    }
}

/** Numbers of the door service of v0.1.4.8 (spec C5). */
export const DOOR_SERVICE_RULES = Object.freeze({
    scanRange: 6,         // the openables within this distance are read on each look
    noteRange: 3,         // an openable that opens within this distance of the bot is noted
    playerOpenRange: 3,   // ... unless the bot stands still and a player is this close to it (the player opened it)
    movedWithinMs: 1500,  // the bot moves when it moved during this time
    nearDistance: 1.5,    // the bot passed an openable when it came this close to its centre
    pastDistance: 2,      // a passed openable is closed when the bot is this far from it
    leftDistance: 4,      // (v0.1.4.8: one the bot opened and did not pass; since v0.1.4.9 F21 never closed)
    sideRange: 3,         // v0.1.4.9 F21: the bot is on a side of a door or gate within this distance of it
    reach: 5,             // farther away the bot cannot click it
    playerClearance: 2,   // no other player this close to it when it is closed
    tries: 3,             // attempts per openable
    retryMs: 1000,        // between two attempts
    forgetMs: 60000,      // a noted openable is forgotten after this time ...
    forgetDistance: 16,   // ... or when the bot is this far from it
    startMs: 5000,        // the look at the start lasts this long (chunks arrive late) ...
    startPlayerRange: 3,  // ... and closes open openables of saved areas with no player this close
});

/**
 * Which openables the door service closes (spec v0.1.4.8 C5). Pure: the executing part reads the
 * world and passes it in, with the time.
 * - Noted: a door, gate or trapdoor that goes from closed to open within 3 blocks of the bot while the
 *   bot moves, or while no other player is within 3 blocks of it (then the bot opened it itself).
 * - Noted: an open gate of an area of type pen or farm (`gated`) when the bot passes it (within 1.5
 *   blocks), also when it was open before.
 * - Noted: during the first 5 s, an open openable of a saved area (`inArea`) with no player within 3
 *   blocks.
 * - A noted openable is returned to close when it is open, nobody stands in it or is within 1 block of
 *   it (`occupied`), no other player is within 2 blocks, it is within 5 blocks of the bot, and the bot
 *   passed it and is now 2 blocks or more from it. A noted one of the start is returned without passing,
 *   when the bot does not stand in it.
 * - v0.1.4.9, F21: the bot passed an openable when its own feet were on one side of it and then on the
 *   other (passSide; a trapdoor: above it, then below it, or the reverse). Every open openable the bot
 *   passed is noted, whoever opened it; one the bot did not pass is never closed (the player who opened a
 *   trapdoor and went down it keeps it open), except a gate of a pen or a farm (the bot came within 1.5)
 *   and the openables of the start.
 * - Up to 3 attempts, 1 s apart; forgotten after 60 s, 16 blocks away, or when seen closed.
 */
/**
 * On which side of an openable the feet of the bot are (v0.1.4.9, F21): -1 or 1, 0 in the openable, null
 * when the bot is not near enough to count. A door or gate: the side along its axis (sideOf), within 3
 * blocks sideways and 1.5 up or down. A trapdoor: with the feet at most 1 block sideways of its cell, 1 above
 * it (higher, or at its height beside its cell, at most 2 up) and -1 below it (at most 3 down); 0 in its cell.
 * @param {{x,y,z,kind,facing}} door
 * @param {{x,y,z}} pos the bot
 * @returns {-1|0|1|null}
 */
export function passSide(door, pos) {
    if (!isPoint(door) || !isPoint(pos)) {
        return null;
    }
    if (door.kind === 'trapdoor') {
        const fx = Math.floor(pos.x);
        const fy = Math.floor(pos.y + 0.01);
        const fz = Math.floor(pos.z);
        if (Math.max(Math.abs(fx - door.x), Math.abs(fz - door.z)) > 1) {
            return null;
        }
        if (fy < door.y) {
            return fy >= door.y - 3 ? -1 : null;
        }
        if (fy > door.y) {
            return fy <= door.y + 2 ? 1 : null;
        }
        return fx === door.x && fz === door.z ? 0 : 1;
    }
    const c = doorCenter(door);
    if (Math.hypot(pos.x - c.x, pos.z - c.z) > DOOR_SERVICE_RULES.sideRange || Math.abs(pos.y - door.y) > 1.5) {
        return null;
    }
    return sideOf(door, pos);
}

export class DoorWatch {
    constructor() {
        this.reset();
    }

    /** Forgets everything; the next observe starts the look at the start again. */
    reset() {
        this._seen = new Map();   // key -> open, as read last
        this._noted = new Map();  // key -> { door, why, notedAt, passed, near, tries, nextTryAt }
        this._sides = new Map();  // key -> { side, passed }: the side of the bot, and whether it passed (F21)
        this._startUntil = null;
        this._startDone = new Set();
        this._late = [];
    }

    /**
     * The openables that were seen closed after an attempt that did not see it (the block update came
     * late). The list is emptied.
     * @returns {object[]}
     */
    takeClosedLate() {
        const out = this._late;
        this._late = [];
        return out;
    }

    /** Number of noted openables. */
    get size() {
        return this._noted.size;
    }

    /**
     * The noted openable of a key, as a copy, or null.
     * @param {{x,y,z}} door
     * @returns {object|null}
     */
    noted(door) {
        const entry = isPoint(door) ? this._noted.get(doorKey(door)) : null;
        return entry ? { ...entry, door: { ...entry.door } } : null;
    }

    /**
     * Called on each look.
     * @param {{now: number, botPos: {x,y,z}, moving: boolean, doors: object[], players: {x,y,z}[]}} input
     *   doors: the openables within 6 blocks as { x, y, z, kind, open, name, facing, inArea, gated, occupied }
     * @returns {object[]} copies of the openables to close now, nearest first, each with `why`
     */
    observe(input = {}) {
        const now = isFiniteNumber(input?.now) ? input.now : Date.now();
        const botPos = input?.botPos;
        if (!isPoint(botPos)) {
            return [];
        }
        if (this._startUntil === null) {
            this._startUntil = now + DOOR_SERVICE_RULES.startMs;
        }
        const doors = (Array.isArray(input.doors) ? input.doors : []).filter(isPoint);
        const players = (Array.isArray(input.players) ? input.players : []).filter(isPoint);
        const playerWithin = (door, range) => players.some(p => dist3(p, doorCenter(door)) <= range);
        const visible = new Map();
        for (const door of doors) {
            const key = doorKey(door);
            visible.set(key, door);
            const before = this._seen.get(key);
            this._seen.set(key, door.open === true);
            if (isIronDoorRecord(door)) {
                continue;
            }
            const d = dist3(botPos, doorCenter(door));
            // F21: the side of the bot, also while it is closed (the bot stands above a trapdoor it opens); a
            // change from one side to the other while it is open is a pass
            const track = this._sides.get(key) ?? { side: 0, passed: false };
            const side = passSide(door, botPos);
            if (side === 1 || side === -1) {
                if (door.open === true && track.side !== 0 && track.side !== side) {
                    track.passed = true;
                }
                track.side = side;
            }
            this._sides.set(key, track);
            if (door.open !== true) {
                const entry = this._noted.get(key);
                if (entry && entry.tries > 0) {
                    this._late.push({ ...door }); // the block update of an attempt came late
                }
                this._noted.delete(key); // closed by anybody: nothing to do
                track.passed = false;
                continue;
            }
            if (!this._noted.has(key)) {
                if (before === false && d <= DOOR_SERVICE_RULES.noteRange
                    && (input.moving === true || !playerWithin(door, DOOR_SERVICE_RULES.playerOpenRange))) {
                    this._note(key, door, 'opened', now);
                } else if (door.gated === true && d <= DOOR_SERVICE_RULES.nearDistance) {
                    this._note(key, door, 'gate', now);
                } else if (now <= this._startUntil && door.inArea === true && !this._startDone.has(key)
                    && !playerWithin(door, DOOR_SERVICE_RULES.startPlayerRange)) {
                    this._note(key, door, 'start', now);
                } else if (track.passed) {
                    this._note(key, door, 'passed', now);
                }
                this._startDone.add(key);
            }
            const entry = this._noted.get(key);
            if (entry) {
                entry.door = { ...door };
                entry.passed = entry.passed || track.passed;
                if (d <= DOOR_SERVICE_RULES.nearDistance) {
                    entry.near = true;
                }
            }
        }
        for (const key of [...this._sides.keys()]) {
            if (!visible.has(key)) {
                this._sides.delete(key); // out of sight: a pass starts again
            }
        }
        const out = [];
        for (const [key, entry] of this._noted) {
            const d = dist3(botPos, doorCenter(entry.door));
            if (now - entry.notedAt > DOOR_SERVICE_RULES.forgetMs || d > DOOR_SERVICE_RULES.forgetDistance) {
                this._noted.delete(key);
                this._sides.delete(key);
                continue;
            }
            const door = visible.get(key);
            if (!door || entry.tries >= DOOR_SERVICE_RULES.tries || now < entry.nextTryAt) {
                continue;
            }
            if (door.occupied === true || playerWithin(door, DOOR_SERVICE_RULES.playerClearance) || d > DOOR_SERVICE_RULES.reach) {
                continue;
            }
            // F21: only an openable the bot passed (a gate of a pen or farm: came near), 2 blocks past it
            const passed = entry.why === 'gate' ? entry.near || entry.passed : entry.passed;
            const away = entry.why === 'start' ? d > 0.8 : passed && d >= DOOR_SERVICE_RULES.pastDistance;
            if (away) {
                out.push({ ...door, why: entry.why, distance: d });
            }
        }
        return out.sort((a, b) => a.distance - b.distance);
    }

    /**
     * The outcome of an attempt to close an openable. Closed: it is forgotten. Not closed: one more
     * attempt counted; after 3 it is forgotten.
     * @param {{x,y,z}} door
     * @param {boolean} closed
     * @param {number} now
     * @returns {'closed'|'retry'|'gave_up'|'unknown'}
     */
    attempt(door, closed, now) {
        const key = isPoint(door) ? doorKey(door) : null;
        const entry = key === null ? null : this._noted.get(key);
        if (!entry) {
            return 'unknown';
        }
        if (closed === true) {
            this._noted.delete(key);
            this._sides.delete(key);
            return 'closed';
        }
        entry.tries += 1;
        entry.nextTryAt = (isFiniteNumber(now) ? now : Date.now()) + DOOR_SERVICE_RULES.retryMs;
        if (entry.tries >= DOOR_SERVICE_RULES.tries) {
            this._noted.delete(key);
            this._sides.delete(key);
            return 'gave_up';
        }
        return 'retry';
    }

    /**
     * Forgets a noted openable (it was found closed).
     * @param {{x,y,z}} door
     */
    forget(door) {
        if (isPoint(door)) {
            this._noted.delete(doorKey(door));
            this._sides.delete(doorKey(door));
        }
    }

    _note(key, door, why, now) {
        this._noted.set(key, { door: { ...door }, why, notedAt: now, passed: false, near: false, tries: 0, nextTryAt: now });
    }
}
