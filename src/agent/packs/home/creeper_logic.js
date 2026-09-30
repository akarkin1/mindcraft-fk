// The creeper procedure as pure geometry (spec v0.1.4.6 H6): decide(state) says what the bot
// does next when a creeper is near it or near a protected area. The owner's rule: the bot is slow
// at doors, so it never goes for the shelter with a creeper near. It first lures the creeper to a
// safe distance from the buildings, then runs, and enters only when the creeper is gone.
// v0.1.4.8 (C3): a creeper counts only at the height of the bot or of an area that the reflex defends.
import { hasWalls, isDefendedArea } from './area_kinds.js';
import { boxCenter, containsPos, distanceToBox, expandBox, horizontalDistanceToBox, interiorBox, isBox, nearestPointOnBox,
    segmentCrossesBox } from './box_math.js';
import { standingCreeperText } from './texts.js';

/** Numbers of the creeper procedure. */
export const CREEPER_RULES = Object.freeze({
    // Amendment 2, F3: a creeper that does not follow
    followWindowMs: 3000,  // a creeper follows when it came closer to the bot during this time ...
    followMin: 1,          // ... by at least this much
    attentionMin: 8,       // the walk towards a creeper ends 10 blocks from it, never closer than this
    attentionTries: 2,     // after this many walks towards it without the creeper following, it stands
    attentionMaxMs: 10000, // a walk towards the creeper that takes longer counts as a new try
    standingMs: 60000,     // a creeper that stands does not start the procedure again for this long ...
    standingNear: 10,      // ... unless it comes this close to the bot
    fuseDistance: 3,       // a creeper starts its fuse within 3 blocks of its target ...
    giveUpDistance: 7,     // ... and stops it beyond 7
    noticeDistance: 16,    // creepers within this distance of the bot count
    areaDanger: 16,        // a creeper this close to an area must be led away
    areaRelevance: 32,     // areas within this distance of the bot count for 'none'
    areaRange: 48,         // areas within this distance of the bot are avoided
    backOffDistance: 5,    // a creeper this close: back off
    backOffRun: 12,        // back off this far
    lureMin: 5,            // keep the creeper 5 ...
    lureMax: 10,           // ... to 10 blocks behind
    lureStep: 6,           // one lure step
    runDistance: 32,       // run this far
    helpTries: 3,          // lure attempts before asking for help
    // v0.1.4.8, C3
    botHeight: 4,          // a creeper counts for the bot only within this height difference ...
    botClose: 6,           // ... and within this distance or in sight of the bot
    areaHeight: 3,         // a creeper counts for an area only between min.y - 3 and max.y + 3
});

const HELP_TEXT = 'A creeper keeps following me near the base. I stay away from the buildings. Can you help?';
const ANGLES = [0, 20, -20, 40, -40, 60, -60, 80, -80, 90, -90];
const EPS = 1e-9;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

/**
 * True while the fuse of the creeper burns: `fuse` is true or a positive number (metadata[16]
 * of the entity is 1 while it burns and -1 otherwise).
 * @param {{fuse?: boolean|number}} creeper
 * @returns {boolean}
 */
export function fuseIsBurning(creeper) {
    const fuse = creeper?.fuse;
    return fuse === true || (isFiniteNumber(fuse) && fuse > 0);
}

// ---- small vector helpers, in the x-z plane ----

function unit2(x, z) {
    const len = Math.hypot(x, z);
    return len > EPS ? { x: x / len, z: z / len } : null;
}

function rotate2(v, degrees) {
    const r = degrees * Math.PI / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

function dist3(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function awayFrom(bot, pos) {
    return unit2(bot.x - pos.x, bot.z - pos.z);
}

function pointAt(bot, dir, step) {
    return { x: bot.x + dir.x * step, y: bot.y, z: bot.z + dir.z * step };
}

// ---- areas ----

// The walls and the room of an area, the part nobody walks through.
function hardBox(area) {
    return expandBox(interiorBox(area), 1) ?? area;
}

// Inside the walls of a building (home, building): the walls protect the bot.
function botIsSheltered(area, pos) {
    return hasWalls(area) && containsPos(interiorBox(area), pos);
}

// ---- which creepers count (v0.1.4.8, C3) ----

/**
 * True when a creeper counts for the bot: at most 4 blocks higher or lower (`dy` = creeper y minus bot
 * y), and within 6 blocks or in sight (`sight`: no solid block on the line from the eyes of the bot to
 * the middle of the creeper). Also within the notice distance of 16. A creeper without `sight` (not
 * measured) counts as in sight.
 * @param {{dBot: number, dy: number, sight?: boolean}} c
 * @returns {boolean}
 */
export function countsForBot(c) {
    if (!c || !isFiniteNumber(c.dBot) || !isFiniteNumber(c.dy)) {
        return false;
    }
    return c.dBot <= CREEPER_RULES.noticeDistance && Math.abs(c.dy) <= CREEPER_RULES.botHeight
        && (c.dBot <= CREEPER_RULES.botClose || c.sight !== false);
}

/**
 * True when a creeper at `pos` counts for the area: the type is defended (all but mine), the
 * horizontal distance to the box is 16 or less, and its y is between min.y - 3 and max.y + 3.
 * @param {object} area
 * @param {{x,y,z}} pos
 * @returns {boolean}
 */
export function countsForArea(area, pos) {
    if (!isDefendedArea(area) || !isPoint(pos)) {
        return false;
    }
    return horizontalDistanceToBox(area, pos) <= CREEPER_RULES.areaDanger
        && pos.y >= area.min.y - CREEPER_RULES.areaHeight && pos.y <= area.max.y + CREEPER_RULES.areaHeight;
}

/**
 * True when no solid block lies on the line from `from` to `to` (the blocks of both ends left out).
 * Visits every block the line crosses. A block that is not loaded (null) blocks the sight.
 * @param {{x,y,z}} from the eyes of the bot
 * @param {{x,y,z}} to the middle of the creeper
 * @param {(x: number, y: number, z: number) => boolean|null} isSolidAt true for a solid block, null when not loaded
 * @returns {boolean}
 */
export function lineOfSight(from, to, isSolidAt) {
    if (!isPoint(from) || !isPoint(to) || typeof isSolidAt !== 'function') {
        return false;
    }
    let x = Math.floor(from.x);
    let y = Math.floor(from.y);
    let z = Math.floor(from.z);
    const end = { x: Math.floor(to.x), y: Math.floor(to.y), z: Math.floor(to.z) };
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const step = { x: Math.sign(d.x), y: Math.sign(d.y), z: Math.sign(d.z) };
    const tDelta = { x: d.x !== 0 ? Math.abs(1 / d.x) : Infinity, y: d.y !== 0 ? Math.abs(1 / d.y) : Infinity, z: d.z !== 0 ? Math.abs(1 / d.z) : Infinity };
    const first = (p, v, s) => (s > 0 ? (Math.floor(p) + 1 - p) / v : s < 0 ? (p - Math.floor(p)) / -v : Infinity);
    const tMax = { x: first(from.x, d.x, step.x), y: first(from.y, d.y, step.y), z: first(from.z, d.z, step.z) };
    for (let i = 0; i < 512; i++) {
        let axis = 'x';
        if (tMax.y < tMax[axis]) {
            axis = 'y';
        }
        if (tMax.z < tMax[axis]) {
            axis = 'z';
        }
        if (tMax[axis] > 1) {
            return true; // the end of the line
        }
        if (axis === 'x') {
            x += step.x;
        } else if (axis === 'y') {
            y += step.y;
        } else {
            z += step.z;
        }
        tMax[axis] += tDelta[axis];
        if (x === end.x && y === end.y && z === end.z) {
            return true;
        }
        let solid;
        try {
            solid = isSolidAt(x, y, z);
        } catch {
            solid = null;
        }
        if (solid !== false) {
            return false;
        }
    }
    return false;
}

// Unit vector pointing away from the areas, the nearest weighing most. null without areas.
function awayFromAreas(bot, areas) {
    let x = 0;
    let z = 0;
    for (const area of areas) {
        const near = nearestPointOnBox(area, bot);
        let dir = unit2(bot.x - near.x, bot.z - near.z);
        let weight;
        if (dir) {
            weight = 1 / Math.max(Math.hypot(bot.x - near.x, bot.z - near.z), 1);
        } else {
            const c = boxCenter(area);
            dir = unit2(bot.x - c.x, bot.z - c.z) ?? { x: 1, z: 0 };
            weight = 1;
        }
        x += dir.x * weight;
        z += dir.z * weight;
    }
    return unit2(x, z);
}

function minAreaDistance(areas, pos) {
    let best = Infinity;
    for (const area of areas) {
        best = Math.min(best, distanceToBox(area, pos));
    }
    return best;
}

function endpointClear(areas, p, margin) {
    return !areas.some(area => containsPos(margin ? expandBox(area, 1) : area, p));
}

function pathClear(areas, bot, p) {
    for (const area of areas) {
        if (!containsPos(area, bot)) {
            if (segmentCrossesBox(bot, p, area)) {
                return false;
            }
            continue;
        }
        const hard = hardBox(area);
        if (!containsPos(hard, bot) && segmentCrossesBox(bot, p, hard)) {
            return false;
        }
    }
    return true;
}

// First point along base (turned by up to 90 degrees) and one of the step lengths that is valid.
function search(bot, base, steps, valid) {
    for (const step of steps) {
        for (const angle of ANGLES) {
            const dir = rotate2(base, angle);
            const p = pointAt(bot, dir, step);
            if (valid(p, dir)) {
                return p;
            }
        }
    }
    return null;
}

// Of the two directions at right angles to v, the one that ends farther from the areas.
function sideways(bot, v, areas, step) {
    const left = { x: -v.z, z: v.x };
    const right = { x: v.z, z: -v.x };
    if (areas.length === 0) {
        return left;
    }
    const dl = minAreaDistance(areas, pointAt(bot, left, step));
    const dr = minAreaDistance(areas, pointAt(bot, right, step));
    return dr > dl + EPS ? right : left;
}

function result(step, extra = {}) {
    return {
        step,
        moveTo: extra.moveTo ?? null,
        sprint: extra.sprint ?? false,
        creeper: extra.creeper ?? null,
        text: extra.text ?? null,
        area: extra.area ?? null,
        reason: extra.reason ?? null,
    };
}

// ---- the steps ----

function backOffPoint(bot, threats, named, areas) {
    let x = 0;
    let z = 0;
    let total = 0;
    for (const t of threats) {
        const u = awayFrom(bot, t.pos);
        if (!u) {
            continue;
        }
        const w = 1 / Math.max(t.dBot, 0.5) ** 2;
        x += u.x * w;
        z += u.z * w;
        total += w;
    }
    const namedAway = awayFrom(bot, named.pos) ?? awayFromAreas(bot, areas) ?? { x: 1, z: 0 };
    let base = unit2(x, z);
    if (!base || Math.hypot(x, z) < 0.25 * total) {
        base = sideways(bot, namedAway, areas, CREEPER_RULES.backOffRun);
    }
    const fartherFromAll = p => threats.every(t => dist3(p, t.pos) > t.dBot + EPS);
    const fartherFromNamed = p => dist3(p, named.pos) > named.dBot + EPS;
    const steps = [CREEPER_RULES.backOffRun, 8, 5, 3];
    return search(bot, base, steps, p => fartherFromAll(p) && endpointClear(areas, p, true) && pathClear(areas, bot, p))
        ?? search(bot, namedAway, steps, p => fartherFromNamed(p) && endpointClear(areas, p, false) && pathClear(areas, bot, p))
        ?? pointAt(bot, namedAway, CREEPER_RULES.backOffRun);
}

function lurePoint(bot, target, areas) {
    const uc = awayFrom(bot, target.pos) ?? awayFromAreas(bot, areas) ?? { x: 1, z: 0 };
    const ua = awayFromAreas(bot, areas) ?? { x: 0, z: 0 };
    let base = unit2(ua.x + uc.x, ua.z + uc.z);
    if (!base || Math.hypot(ua.x + uc.x, ua.z + uc.z) < 0.3) {
        base = sideways(bot, uc, areas, CREEPER_RULES.lureStep);
    }
    const here = minAreaDistance(areas, bot);
    const notCloser = p => dist3(p, target.pos) >= target.dBot - EPS;
    const steps = [CREEPER_RULES.lureStep, 4, 2];
    return search(bot, base, steps, p => notCloser(p) && endpointClear(areas, p, true) && pathClear(areas, bot, p)
        && minAreaDistance(areas, p) >= here - EPS)
        ?? search(bot, base, steps, p => notCloser(p) && endpointClear(areas, p, true) && pathClear(areas, bot, p));
}

function runPoint(bot, target, areas) {
    const uc = awayFrom(bot, target.pos) ?? awayFromAreas(bot, areas) ?? { x: 1, z: 0 };
    const farther = p => dist3(p, target.pos) > target.dBot + EPS;
    const notTowardsAreas = p => areas.every(area => distanceToBox(area, p) >= distanceToBox(area, bot) - EPS);
    const run = CREEPER_RULES.runDistance;
    return search(bot, uc, [run, run / 2], p => farther(p) && endpointClear(areas, p, true) && pathClear(areas, bot, p) && notTowardsAreas(p))
        ?? search(bot, uc, [run, run / 2, run / 4], p => farther(p) && endpointClear(areas, p, true) && pathClear(areas, bot, p))
        ?? search(bot, uc, [run, 16, 8, 4, 2, 0.9], p => farther(p) && endpointClear(areas, p, false) && pathClear(areas, bot, p))
        ?? pointAt(bot, uc, run);
}

// F3: where the bot walks to be seen by a creeper that does not follow: 9 blocks from it (10 at most,
// never closer than 8), on the side of the bot if that is free, otherwise around the creeper, never
// in an area or next to one. null when there is no such place. The path finder walks around walls.
function attentionPoint(bot, target, areas) {
    const toBot = unit2(bot.x - target.pos.x, bot.z - target.pos.z) ?? { x: 1, z: 0 };
    const radius = (CREEPER_RULES.lureMax + CREEPER_RULES.attentionMin) / 2;
    for (let angle = 0; angle <= 180; angle += 20) {
        for (const sign of angle === 0 || angle === 180 ? [1] : [1, -1]) {
            const dir = rotate2(toBot, angle * sign);
            const p = { x: target.pos.x + dir.x * radius, y: bot.y, z: target.pos.z + dir.z * radius };
            if (endpointClear(areas, p, true)) {
                return p;
            }
        }
    }
    return null;
}

function idList(value) {
    return new Set(Array.isArray(value) ? value : []);
}

/**
 * What the creeper procedure remembers between two calls of decide (Amendment 2, F3): where every
 * creeper was during the last seconds, the walks towards a creeper that does not follow (attention
 * tries) of the current run, and the creepers that stand. Pure: the time is passed in.
 */
export class CreeperWatch {
    constructor() {
        this.seen = new Map(); // id -> [{ t, pos }], oldest first
        this.standingUntil = new Map(); // id -> ms
        this.tries = 0;
        this.attentionSince = null;
        this.target = null;
    }

    /** A new run of the procedure: the attention tries start again. */
    startRun() {
        this.tries = 0;
        this.attentionSince = null;
        this.target = null;
    }

    /**
     * Records the creepers the bot sees now and returns facts() for decide. Never throws.
     * @param {{id: *, pos: {x,y,z}}[]} creepers
     * @param {{x,y,z}} botPos
     * @param {number} now ms
     * @returns {{following: *[], attention: number, standing: *[]}}
     */
    observe(creepers, botPos, now) {
        try {
            if (isFiniteNumber(now)) {
                for (const c of Array.isArray(creepers) ? creepers : []) {
                    if (c && typeof c === 'object' && c.id !== undefined && c.id !== null && isPoint(c.pos)) {
                        const list = this.seen.get(c.id) ?? [];
                        list.push({ t: now, pos: { x: c.pos.x, y: c.pos.y, z: c.pos.z } });
                        this.seen.set(c.id, list);
                    }
                }
                const keep = CREEPER_RULES.followWindowMs + 1000;
                for (const [id, list] of this.seen) {
                    const recent = list.filter(s => now - s.t <= keep);
                    if (recent.length === 0) {
                        this.seen.delete(id);
                    } else {
                        this.seen.set(id, recent);
                    }
                }
                for (const [id, until] of this.standingUntil) {
                    const list = this.seen.get(id);
                    const last = list ? list[list.length - 1] : null;
                    const near = isPoint(botPos) && last && last.t === now
                        && dist3(last.pos, botPos) <= CREEPER_RULES.standingNear;
                    if (now >= until || near) {
                        this.standingUntil.delete(id);
                    }
                }
                if (this.target !== null && this.isFollowing(this.target, botPos, now)) {
                    this.tries = 0;
                }
            }
        } catch {
            // an odd sample is ignored
        }
        return this.facts(botPos, now);
    }

    /**
     * True when the creeper came at least 1 block closer to where the bot is now during the last 3 s.
     * Only the move of the creeper counts, not the move of the bot.
     */
    isFollowing(id, botPos, now) {
        const list = this.seen.get(id);
        if (!list || list.length < 2 || !isPoint(botPos)) {
            return false;
        }
        const from = list.find(s => now - s.t <= CREEPER_RULES.followWindowMs);
        const last = list[list.length - 1];
        if (!from || from === last) {
            return false;
        }
        return dist3(from.pos, botPos) - dist3(last.pos, botPos) >= CREEPER_RULES.followMin;
    }

    /** The ids that stand now. */
    standingIds(now) {
        return [...this.standingUntil].filter(([, until]) => now < until).map(([id]) => id);
    }

    /**
     * The facts decide needs: the ids of the creepers that follow, the attention tries of this run,
     * whether a walk towards the creeper is still going on (attending: it is finished before the
     * creeper counts as standing, but not after 10 s) and the ids of the creepers that stand.
     */
    facts(botPos, now) {
        const following = [];
        for (const id of this.seen.keys()) {
            if (this.isFollowing(id, botPos, now)) {
                following.push(id);
            }
        }
        const attending = this.attentionSince !== null && isFiniteNumber(now) && now - this.attentionSince < CREEPER_RULES.attentionMaxMs;
        return { following, attention: this.tries, attending, standing: this.standingIds(now) };
    }

    /**
     * Called with every result of decide: counts the walks towards a creeper (one try per walk, a new
     * one after 10 s) and remembers a creeper that stands (leave_it) for 60 s. Never throws.
     */
    note(decision, now) {
        if (!decision || typeof decision !== 'object' || !isFiniteNumber(now)) {
            return;
        }
        if (decision.step === 'leave_it') {
            this.standingUntil.set(decision.creeper, now + CREEPER_RULES.standingMs);
            this.startRun();
            return;
        }
        if (decision.reason === 'attention') {
            if (this.attentionSince === null || now - this.attentionSince >= CREEPER_RULES.attentionMaxMs) {
                this.tries += 1;
                this.attentionSince = now;
                this.target = decision.creeper;
            }
        } else {
            this.attentionSince = null;
        }
    }
}

/**
 * Decides the next step of the creeper procedure. A creeper counts (v0.1.4.8, C3) when it counts for
 * the bot (countsForBot: within 16, at most 4 blocks higher or lower, within 6 or in sight) or for a
 * defended area within 32 blocks of the bot (countsForArea: horizontally within 16 of the box, between
 * min.y - 3 and max.y + 3). With `underground` only the creepers that count for the bot count. Steps,
 * first match wins:
 * - none: no creeper counts (reason 'no_creeper', underground 'underground'). Also none when the bot
 *   is inside a building (within its walls) and no such creeper is inside it: the walls protect the
 *   bot, and going out would mean opening the door with a creeper near (reason 'in_shelter').
 * - back_off: a creeper within 5 blocks, or a burning fuse. 12 blocks away, sprinting.
 * - help: `tries` is 3 or more. Moves away like run, with the text for the player.
 * - lure: a creeper that counts for an area (not underground). The bot walks away from the area and from the
 *   creeper, keeping it 5 to 10 blocks behind (reason lead). Beyond 10 it waits (moveTo is its own
 *   position, reason wait) while the creeper follows, that is came at least 1 block closer during the
 *   last 3 s. Otherwise it walks towards the creeper to 9 blocks from it (reason attention, F3).
 * - leave_it (F3): beyond 10 blocks, not following, and 2 attention tries done (or no place for one):
 *   the creeper stands. The procedure ends; the text says so.
 * - fight: the lure is done, `fighting` and `canFight` are true. `creeper` names the target.
 * - run: the lure is done, no fight. 32 blocks away from the creeper, not towards an area.
 * A creeper in `standing` counts only within 10 blocks of the bot.
 * @param {{botPos: {x,y,z}, creepers: {id, pos: {x,y,z}, fuse, sight?: boolean}[], areas: object[], fighting: boolean,
 *   canFight: boolean, tries: number, fuseBurning: boolean, now: number, following?: *[],
 *   attention?: number, attending?: boolean, standing?: *[], underground?: boolean}} state
 *   areas are the boxes of the areas within 48 blocks ({min, max}, optional name and type);
 *   following, attention and standing come from CreeperWatch.facts (F3); sight and underground from
 *   the context (C3), a creeper without sight counts as in sight
 * @returns {{step: string, moveTo: {x,y,z}|null, sprint: boolean, creeper: *, text: string|null,
 *   area: string|null, reason: string|null}}
 */
export function decide(state) {
    const s = state && typeof state === 'object' ? state : {};
    if (!isPoint(s.botPos)) {
        return result('none', { reason: 'no_bot' });
    }
    const bot = { x: s.botPos.x, y: s.botPos.y, z: s.botPos.z };
    const underground = s.underground === true;
    const areas = (Array.isArray(s.areas) ? s.areas : []).filter(isBox)
        .filter(area => distanceToBox(area, bot) <= CREEPER_RULES.areaRange);
    const nearAreas = areas.filter(area => distanceToBox(area, bot) <= CREEPER_RULES.areaRelevance);
    const creepers = (Array.isArray(s.creepers) ? s.creepers : [])
        .filter(c => c && typeof c === 'object' && isPoint(c.pos))
        .map(c => {
            const dBot = dist3(bot, c.pos);
            const forBot = countsForBot({ dBot, dy: c.pos.y - bot.y, sight: c.sight });
            // C3: only an area that the creeper counts for; underground no area counts
            let nearest = null;
            let dArea = Infinity;
            for (const area of underground ? [] : areas) {
                if (countsForArea(area, c.pos)) {
                    const d = horizontalDistanceToBox(area, c.pos);
                    if (d < dArea) {
                        dArea = d;
                        nearest = area;
                    }
                }
            }
            const forArea = !underground && nearAreas.some(area => countsForArea(area, c.pos));
            return { id: c.id ?? null, pos: c.pos, burning: fuseIsBurning(c), dBot, dArea, nearest, forBot, forArea };
        });
    // F3: a creeper that stands counts only when it is within 10 blocks of the bot
    const standing = idList(s.standing);
    const following = idList(s.following);
    const attention = isFiniteNumber(s.attention) ? s.attention : 0;
    const relevant = creepers.filter(c => (c.forBot || c.forArea)
        && !(standing.has(c.id) && c.dBot > CREEPER_RULES.standingNear));
    if (relevant.length === 0) {
        // C3: underground with no creeper that counts for the bot: nothing happens and nothing is said
        return result('none', { reason: underground ? 'underground' : 'no_creeper' });
    }

    const shelter = areas.find(area => botIsSheltered(area, bot));
    if (shelter) {
        const room = expandBox(interiorBox(shelter), 1);
        if (!relevant.some(c => containsPos(room, c.pos))) {
            return result('none', { reason: 'in_shelter', area: shelter.name ?? null });
        }
    }

    const byBot = (a, b) => a.dBot - b.dBot;
    let threats = relevant.filter(c => c.dBot <= CREEPER_RULES.backOffDistance || c.burning).sort(byBot);
    let reason = threats.some(c => c.burning) ? 'fuse' : 'close';
    if (threats.length === 0 && s.fuseBurning === true) {
        threats = [[...relevant].sort(byBot)[0]];
        reason = 'fuse';
    }
    if (threats.length > 0) {
        const named = threats[0];
        return result('back_off', { moveTo: backOffPoint(bot, threats, named, areas), sprint: true, creeper: named.id, reason });
    }

    const nearest = [...relevant].sort(byBot)[0];
    const tries = isFiniteNumber(s.tries) ? s.tries : 0;
    if (tries >= CREEPER_RULES.helpTries) {
        return result('help', { moveTo: runPoint(bot, nearest, areas), sprint: true, creeper: nearest.id, text: HELP_TEXT, reason: 'tries' });
    }

    const nearArea = relevant.filter(c => c.dArea <= CREEPER_RULES.areaDanger)
        .sort((a, b) => (a.dArea - b.dArea) || (a.dBot - b.dBot));
    if (nearArea.length > 0) {
        const target = nearArea[0];
        const areaName = target.nearest?.name ?? null;
        if (target.dBot > CREEPER_RULES.lureMax) {
            // F3: wait only for a creeper that comes closer; otherwise walk back towards it to be seen
            // (an attention try); after 2 tries it stands and is left alone
            if (following.has(target.id)) {
                return result('lure', { moveTo: { ...bot }, creeper: target.id, area: areaName, reason: 'wait' });
            }
            // a walk that is going on (attending) is finished first, so the second try is a whole walk too
            const p = attention < CREEPER_RULES.attentionTries || s.attending === true ? attentionPoint(bot, target, areas) : null;
            if (!p) {
                return result('leave_it', { creeper: target.id, area: areaName, text: standingCreeperText(areaName ?? 'the base'), reason: 'standing' });
            }
            return result('lure', { moveTo: p, creeper: target.id, area: areaName, reason: 'attention' });
        }
        const p = lurePoint(bot, target, areas);
        if (!p) {
            return result('lure', { moveTo: { ...bot }, creeper: target.id, area: areaName, reason: 'no_way' });
        }
        return result('lure', { moveTo: p, creeper: target.id, area: areaName, reason: 'lead' });
    }

    if (s.fighting === true && s.canFight === true) {
        return result('fight', { moveTo: { ...nearest.pos }, creeper: nearest.id, reason: 'fight' });
    }
    return result('run', { moveTo: runPoint(bot, nearest, areas), sprint: true, creeper: nearest.id, reason: 'run' });
}
