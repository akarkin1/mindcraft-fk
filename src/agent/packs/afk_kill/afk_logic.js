// The pure logic of the AFK creeper kill pack (spec v0.1.4.16, section 8.4, E8): the room check on a grid of
// block names, the until of the order, the target rule, the weapon choice and the arithmetic of the kill check.
// No mineflayer, no src/agent/library. Every function here never throws on bad input.
//
// The facts it rests on (the probe of 2026-11-13 on the 26.1 test server, lead/creeper-farm-facts.md): the
// server lands bot.attack when the bot's eyes are within 6 blocks of the target's hitbox, a stone sword does 5
// damage once per 600 ms (a faster second hit is swallowed by the 10-tick invulnerability), the slab over the
// first hopper row and the hopper's rim break the creeper's line of sight to the sneaking bot, a kill shows as
// the entityDead event and the body goes about 1 s later.

/** The reach of a hit: from the bot's eyes to the target's position, in blocks (the server allows 6 to the hitbox). */
export const KILL_REACH = 3.0;
/** At most one hit per this many ms (the sword's cooldown and the target's 10-tick invulnerability). */
export const HIT_GAP_MS = 600;
/** The tick of the kill loop. */
export const LOOP_MS = 250;
/** A target gone within this long after a hit is a kill (the death animation takes about 1 s; measured 1006 to 1029 ms). */
export const KILL_WINDOW_MS = 1500;
/** The window of the kill check (K-3): 2 minutes. */
export const CHECK_WINDOW_MS = 120000;
/** Hits with no hurt event at all in a window that make the window bad. */
export const CHECK_HITS = 20;
/** The hoppers must be within this many blocks of the spot (block distance). */
export const HOPPER_RANGE = 3;
/** The blocks around the spot the room check reads. */
export const ROOM_RANGE = 4;
/** The kill chest: the nearest chest within this many blocks of the spot. */
export const CHEST_RANGE = 6;
/** The bed: within this many blocks of the spot. */
export const BED_RANGE = 16;
/** A spare weapon is fetched from the kill chest or a chest within this many blocks. */
export const WEAPON_CHEST_RANGE = 16;
/** The step forward under the slab (K-3): the forward control held this long while sneaking, about 0.3 blocks. */
export const STEP_MS = 250;
/** The second step of the kill check, about 0.2 blocks more. */
export const STEP_MORE_MS = 170;
/** The bag goes to the chest when it has this many free slots or fewer. */
export const STORE_FREE_SLOTS = 4;
/** The bot eats at this food level or lower. */
export const EAT_AT_FOOD = 14;
/** The bot leaves the room under this health. */
export const LOW_HEALTH = 10;
/** One progress line every this many kills. */
export const PROGRESS_EVERY = 50;
/** A weapon with this many uses or fewer is worn (K-6; the mining pack's WEAR_LIMIT). */
export const WEAPON_WEAR = 10;
/** The eye heights of the bot. */
export const EYE_STAND = 1.62;
export const EYE_SNEAK = 1.27;
/** A creeper's health: the hits a weapon needs to kill one at full health come from it. */
export const CREEPER_HEALTH = 20;

/** The drops the farm stores: gunpowder and the drops of the mobs that fall with the creepers (never food or tools). */
export const KILL_DROPS = Object.freeze(['gunpowder', 'bone', 'arrow', 'bow', 'rotten_flesh', 'string', 'spider_eye', 'glowstone_dust',
    'redstone', 'sugar', 'glass_bottle', 'stick']);

/** The modes paused while the farm runs (K-2, map16-packs 4.4); creeper_safety is switched off instead. */
export const PAUSED_MODES = Object.freeze(['cowardice', 'self_defense', 'self_preservation', 'night_shelter', 'hunger', 'item_collecting']);
export const CREEPER_MODE = 'creeper_safety';

/** The weapons by rank: swords first (the spec), then axes; the damage decides the hits a creeper needs. */
export const WEAPONS = Object.freeze({
    netherite_sword: { rank: 12, damage: 8 }, diamond_sword: { rank: 11, damage: 7 }, iron_sword: { rank: 10, damage: 6 },
    stone_sword: { rank: 9, damage: 5 }, golden_sword: { rank: 8, damage: 4 }, wooden_sword: { rank: 7, damage: 4 },
    netherite_axe: { rank: 6, damage: 10 }, diamond_axe: { rank: 5, damage: 9 }, iron_axe: { rank: 4, damage: 9 },
    stone_axe: { rank: 3, damage: 9 }, golden_axe: { rank: 2, damage: 7 }, wooden_axe: { rank: 1, damage: 7 },
});
/** The names of the weapons the bot fetches from a chest, the best first. */
export const WEAPON_NAMES = Object.freeze(Object.keys(WEAPONS).sort((a, b) => WEAPONS[b].rank - WEAPONS[a].rank));

const GOLEMS = new Set(['iron_golem', 'snow_golem', 'copper_golem']);

function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cell(p) {
    return p && num(p.x) !== null && num(p.y) !== null && num(p.z) !== null
        ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
        : null;
}

/**
 * The block distance between two cells: the largest of |dx|, |dy|, |dz| ("within 3 blocks").
 * @param {{x,y,z}} a
 * @param {{x,y,z}} b
 * @returns {number}
 */
export function blockDistance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
}

/**
 * True for the name of a slab block (`oak_slab`, `stone_slab`, ...).
 * @param {string|null} name
 * @returns {boolean}
 */
export function isSlabName(name) {
    return typeof name === 'string' && name.endsWith('_slab');
}

/**
 * The hopper cells within `range` blocks of the spot (block distance), from the names `getName(x, y, z)` gives.
 * Never throws; a reader that throws gives no hopper.
 * @param {(x: number, y: number, z: number) => string|null} getName
 * @param {{x,y,z}} spot
 * @param {number} [range] ROOM_RANGE
 * @returns {{x: number, y: number, z: number}[]}
 */
export function hopperCells(getName, spot, range = ROOM_RANGE) {
    const s = cell(spot);
    if (!s || typeof getName !== 'function') {
        return [];
    }
    const r = Math.max(0, Math.floor(num(range) ?? ROOM_RANGE));
    const out = [];
    for (let x = s.x - r; x <= s.x + r; x++) {
        for (let y = s.y - r; y <= s.y + r; y++) {
            for (let z = s.z - r; z <= s.z + r; z++) {
                let name = null;
                try {
                    name = getName(x, y, z);
                } catch {
                    name = null;
                }
                if (name === 'hopper') {
                    out.push({ x, y, z });
                }
            }
        }
    }
    return out.sort((a, b) => blockDistance(a, s) - blockDistance(b, s) || a.y - b.y || a.z - b.z || a.x - b.x);
}

/**
 * The cells of the row between the spot and the hoppers: every x/z column inside the rectangle spanned by the
 * spot's column and the hoppers' columns, the spot's own column left out, the hoppers' columns included (the
 * owner's slab lies over the first hopper row).
 * @param {{x,y,z}} spot
 * @param {{x,y,z}[]} hoppers
 * @returns {{x: number, z: number}[]}
 */
export function rowBetween(spot, hoppers) {
    const s = cell(spot);
    if (!s || !Array.isArray(hoppers) || hoppers.length === 0) {
        return [];
    }
    const xs = [s.x, ...hoppers.map(h => h.x)];
    const zs = [s.z, ...hoppers.map(h => h.z)];
    const out = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        for (let z = Math.min(...zs); z <= Math.max(...zs); z++) {
            if (x !== s.x || z !== s.z) {
                out.push({ x, z });
            }
        }
    }
    return out;
}

/**
 * The room check at the spot (8.4): the hoppers within HOPPER_RANGE blocks, and a slab in the row between the
 * spot and the hoppers at a hopper's y + 1 or + 2. The names come from `getName(x, y, z)` (the mining pack's
 * nameReader, null for an unloaded block). Never throws.
 * @param {(x: number, y: number, z: number) => string|null} getName
 * @param {{x,y,z}} spot the kill spot (the bot's feet)
 * @returns {{ok: boolean, reason: null|'no_spot'|'no_hopper'|'no_slab', hoppers: object[], slab: {x,y,z}|null, hopperY: number|null, towards: {x: number, z: number}|null}}
 *   towards: the unit step from the spot towards the hoppers along the dominant axis
 */
export function checkRoom(getName, spot) {
    const s = cell(spot);
    if (!s) {
        return { ok: false, reason: 'no_spot', hoppers: [], slab: null, hopperY: null, towards: null };
    }
    const all = hopperCells(getName, s, ROOM_RANGE);
    const near = all.filter(h => blockDistance(h, s) <= HOPPER_RANGE);
    if (near.length === 0) {
        return { ok: false, reason: 'no_hopper', hoppers: all, slab: null, hopperY: null, towards: null };
    }
    const towards = directionTo(s, near);
    const hopperY = Math.min(...near.map(h => h.y));
    let slab = null;
    for (const c of rowBetween(s, near)) {
        for (const h of near) {
            for (const dy of [1, 2]) {
                let name = null;
                try {
                    name = getName(c.x, h.y + dy, c.z);
                } catch {
                    name = null;
                }
                if (isSlabName(name)) {
                    const found = { x: c.x, y: h.y + dy, z: c.z };
                    if (!slab || blockDistance(found, s) < blockDistance(slab, s)) {
                        slab = found;
                    }
                }
            }
        }
    }
    if (!slab) {
        return { ok: false, reason: 'no_slab', hoppers: all, slab: null, hopperY, towards };
    }
    return { ok: true, reason: null, hoppers: all, slab, hopperY, towards };
}

/**
 * The unit step from the spot towards the hoppers along the dominant axis of their mean offset: one of
 * {x: 1|-1, z: 0} or {x: 0, z: 1|-1}; null without hoppers or when they surround the spot.
 * @param {{x,y,z}} spot
 * @param {{x,y,z}[]} hoppers
 * @returns {{x: number, z: number}|null}
 */
export function directionTo(spot, hoppers) {
    const s = cell(spot);
    if (!s || !Array.isArray(hoppers) || hoppers.length === 0) {
        return null;
    }
    let dx = 0;
    let dz = 0;
    for (const h of hoppers) {
        dx += h.x - s.x;
        dz += h.z - s.z;
    }
    if (dx === 0 && dz === 0) {
        return null;
    }
    return Math.abs(dx) >= Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
}

/**
 * The hostile rule of the kill room: a creeper, or any other hostile of mcdata.isHostile's rule (type `hostile` or
 * `mob`, never a golem); never a player, a villager, a pet or an animal (their types are `player`, `passive`, `animal`).
 * @param {object} entity
 * @returns {boolean}
 */
export function isHostileEntity(entity) {
    if (!entity || typeof entity.name !== 'string') {
        return false;
    }
    if (entity.name === 'creeper') {
        return true;
    }
    if (entity.type === 'player' || entity.name === 'player' || entity.name === 'villager' || GOLEMS.has(entity.name)) {
        return false;
    }
    return entity.type === 'hostile' || entity.type === 'mob';
}

/**
 * Straight distance between two points.
 * @param {{x,y,z}} a
 * @param {{x,y,z}} b
 * @returns {number}
 */
export function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * True when the feet of an entity stand within 1 block above a hopper cell: its column is a hopper's column and its
 * y is between the hopper's top (y + 1) and one block above it, with a small tolerance for the physics.
 * @param {{x,y,z}} feet
 * @param {{x,y,z}[]} hoppers
 * @returns {boolean}
 */
export function onHopper(feet, hoppers) {
    if (!feet || num(feet.x) === null || num(feet.y) === null || num(feet.z) === null || !Array.isArray(hoppers)) {
        return false;
    }
    const cx = Math.floor(feet.x);
    const cz = Math.floor(feet.z);
    return hoppers.some(h => h.x === cx && h.z === cz && feet.y >= h.y + 0.9 && feet.y <= h.y + 2.1);
}

/**
 * The target rule (8.4): a hostile entity (isHostileEntity) within `reach` of the bot's eyes whose feet stand on a
 * hopper cell. Never throws.
 * @param {object} entity a mineflayer entity: { name, type, position }
 * @param {{x,y,z}} eye the bot's eye position
 * @param {{x,y,z}[]} hoppers the hopper cells of the room
 * @param {{reach?: number}} [options]
 * @returns {boolean}
 */
export function isKillTarget(entity, eye, hoppers, options = {}) {
    try {
        if (!isHostileEntity(entity) || !entity.position || !eye) {
            return false;
        }
        const reach = num(options?.reach) ?? KILL_REACH;
        return distance(eye, entity.position) <= reach && onHopper(entity.position, hoppers);
    } catch {
        return false;
    }
}

/**
 * The nearest target among the entities, or null. `skip` names the ids to leave out (the dying ones).
 * @param {object[]} entities
 * @param {{x,y,z}} eye
 * @param {{x,y,z}[]} hoppers
 * @param {{reach?: number, skip?: Set<number>|number[]}} [options]
 * @returns {object|null}
 */
export function pickTarget(entities, eye, hoppers, options = {}) {
    const list = Array.isArray(entities) ? entities : Object.values(entities ?? {});
    const skip = options?.skip instanceof Set ? options.skip : new Set(Array.isArray(options?.skip) ? options.skip : []);
    let best = null;
    let bestDistance = Infinity;
    for (const e of list) {
        if (!e || skip.has(e.id) || !isKillTarget(e, eye, hoppers, options)) {
            continue;
        }
        const d = distance(eye, e.position);
        if (d < bestDistance) {
            best = e;
            bestDistance = d;
        }
    }
    return best;
}

/**
 * The eye position of the bot from its feet position and whether it sneaks.
 * @param {{x,y,z}} feet
 * @param {boolean} sneaking
 * @returns {{x: number, y: number, z: number}|null}
 */
export function eyeOf(feet, sneaking) {
    if (!feet || num(feet.x) === null || num(feet.y) === null || num(feet.z) === null) {
        return null;
    }
    return { x: feet.x, y: feet.y + (sneaking ? EYE_SNEAK : EYE_STAND), z: feet.z };
}

/**
 * The `until` of the order (8.4): '' (or nothing) farms until "stop", health or no weapon; `level N` stops at
 * experience level N; `N minutes` (also `N min`, `N hours` as 60 N minutes) stops after that time; anything else
 * is not understood.
 * @param {string} until
 * @returns {{kind: 'open'}|{kind: 'level', level: number}|{kind: 'minutes', minutes: number}|{kind: 'bad', until: string}}
 */
export function parseUntil(until) {
    if (until === undefined || until === null) {
        return { kind: 'open' };
    }
    const text = String(until).trim();
    if (text === '') {
        return { kind: 'open' };
    }
    const level = /^(?:to\s+|until\s+)?level\s*(\d{1,3})$/i.exec(text);
    if (level) {
        const n = Number(level[1]);
        return n >= 1 ? { kind: 'level', level: n } : { kind: 'bad', until: text };
    }
    const time = /^(?:for\s+)?(\d{1,5})\s*(min|mins|minute|minutes|h|hour|hours)$/i.exec(text);
    if (time) {
        const n = Number(time[1]);
        const hours = /^h/i.test(time[2]);
        return n >= 1 ? { kind: 'minutes', minutes: hours ? n * 60 : n } : { kind: 'bad', until: text };
    }
    return { kind: 'bad', until: text };
}

/**
 * Why the farm stops now, by the until and the state: 'level' (the level reached), 'minutes' (the time over),
 * 'health' (under LOW_HEALTH), or null to go on. The owner's stop and the weapons are judged by the caller.
 * @param {{kind: string, level?: number, minutes?: number}} parsed from parseUntil
 * @param {{level?: number, elapsedMs?: number, health?: number}} state
 * @returns {'level'|'minutes'|'health'|null}
 */
export function stopReason(parsed, state = {}) {
    const health = num(state?.health);
    if (health !== null && health < LOW_HEALTH) {
        return 'health';
    }
    if (parsed?.kind === 'level' && (num(state?.level) ?? 0) >= parsed.level) {
        return 'level';
    }
    if (parsed?.kind === 'minutes' && (num(state?.elapsedMs) ?? 0) >= parsed.minutes * 60000) {
        return 'minutes';
    }
    return null;
}

/**
 * The hits a weapon needs for a creeper at full health; 4 for an unknown weapon (a stone sword's).
 * @param {string|null} weaponName
 * @returns {number}
 */
export function hitsToKill(weaponName) {
    const w = WEAPONS[weaponName];
    return w ? Math.ceil(CREEPER_HEALTH / w.damage) : 4;
}

/**
 * True for the name of a weapon the farm uses (a sword or an axe).
 * @param {string|null} name
 * @returns {boolean}
 */
export function isWeaponName(name) {
    return typeof name === 'string' && Object.hasOwn(WEAPONS, name);
}

/**
 * The best weapon among the items: a sword before an axe, the better material first, a worn one (uses left at
 * most `wear`, when known) only when nothing else is there; among equals the one with more uses. Items are
 * { name, usesLeft? } (usesLeft null or undefined: unknown, counts as fresh). null without a weapon.
 * @param {{name: string, usesLeft?: number|null}[]} items
 * @param {{wear?: number}} [options]
 * @returns {object|null} the item given
 */
export function chooseWeapon(items, options = {}) {
    const wear = num(options?.wear) ?? WEAPON_WEAR;
    const list = (Array.isArray(items) ? items : []).filter(i => isWeaponName(i?.name));
    if (list.length === 0) {
        return null;
    }
    const worn = (i) => num(i.usesLeft) !== null && i.usesLeft <= wear;
    const fresh = list.filter(i => !worn(i));
    const pool = fresh.length > 0 ? fresh : list;
    return pool.sort((a, b) => WEAPONS[b.name].rank - WEAPONS[a.name].rank || (num(b.usesLeft) ?? Infinity) - (num(a.usesLeft) ?? Infinity))[0];
}

/**
 * A fresh window of the kill check.
 * @param {number} now
 * @param {number} [xp] the experience points at the start
 * @returns {{since: number, hits: number, landed: number, kills: number, stuck: number, xpAt: number}}
 */
export function newWindow(now, xp = 0) {
    return { since: num(now) ?? 0, hits: 0, landed: 0, kills: 0, stuck: 0, xpAt: num(xp) ?? 0 };
}

/**
 * Whether a window of the kill check is bad (the lead's rule of 2026-11-13 on 8.4): no kill and no XP gained, and
 * either a target that took its hits to kill without dying (`stuck`), or `CHECK_HITS` hits with no hurt event at all.
 * @param {{hits: number, landed: number, kills: number, stuck: number, xpAt: number}} w
 * @param {number} [xpNow] the experience points now (xpAt when not given)
 * @returns {boolean}
 */
export function windowIsBad(w, xpNow = null) {
    if (!w) {
        return false;
    }
    const xpGained = (num(xpNow) ?? w.xpAt) - w.xpAt;
    if (w.kills > 0 || xpGained > 0) {
        return false;
    }
    return w.stuck > 0 || (w.hits >= CHECK_HITS && w.landed === 0);
}

/**
 * True when the window is over (CHECK_WINDOW_MS since its start).
 * @param {{since: number}} w
 * @param {number} now
 * @returns {boolean}
 */
export function windowOver(w, now) {
    return Boolean(w) && (num(now) ?? 0) - w.since >= CHECK_WINDOW_MS;
}

/**
 * The verdict at the end of a bad window: the first bad window says `closer`, the second `give_up`.
 * @param {number} badWindows bad windows before this one
 * @returns {'closer'|'give_up'}
 */
export function badWindowVerdict(badWindows) {
    return (num(badWindows) ?? 0) >= 1 ? 'give_up' : 'closer';
}

/**
 * The stored count for the lines: the kill chest's gunpowder when the index knows the chest, else what the bot
 * stored itself this run.
 * @param {{items?: Object<string, number>}|null} chest the chest of the index, or null
 * @param {number} storedByMe
 * @returns {number}
 */
export function storedCount(chest, storedByMe) {
    const inChest = num(chest?.items?.gunpowder);
    return inChest !== null ? inChest : Math.max(0, num(storedByMe) ?? 0);
}
