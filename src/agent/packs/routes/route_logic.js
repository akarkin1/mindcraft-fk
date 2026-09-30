// Routes from the trail (spec v0.1.4.9 I2, A2, A4): the legs of a way, where it starts, which way to
// take to a target, the way back. Pure: steps, routes and positions go in, legs and choices come out.
//
// A route is { name, dimension, from: { name, kind, x, y, z }, to: { name, x, y, z }, legs, steps, source,
// created, updated }. The legs are the kinds of mines.json of v0.1.4.7 plus one:
//   { kind: 'walk', from, to }                                    path search, at most 12 blocks apart
//   { kind: 'ladder', x, z, top, bottom, face, entry }            face: the `facing` of the ladder blocks,
//                                                                 the wall is behind it (as ladder.js reads it)
//   { kind: 'stairs', from, to, dir }                             made only by the mining pack, from the top down
//   { kind: 'door', kind2, name, x, y, z, from, to }              kind2: door, gate or trapdoor
import { containsPos, distanceToBox, isBox } from '../home/box_math.js';

/** The numbers of the routes. */
export const ROUTE_RULES = Object.freeze({
    maxHop: 12,        // a walk leg: at most this far from its start ...
    maxHopPath: 24,    // ... and at most this many blocks of trail
    range: 4,          // a route serves a target when one of its ends is this near to it ...
    reach: 32,         // ... and the other end this near to the bot
    placeRange: 2,     // a step is at a saved place within this distance
    roomRange: 2,      // a step is in the room of a mine within this distance of its chest, table, furnace or middle
    nameMax: 64,
});

/** The directions of the legs. */
export const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);

const VECTORS = Object.freeze({
    north: Object.freeze({ x: 0, z: -1 }),
    east: Object.freeze({ x: 1, z: 0 }),
    south: Object.freeze({ x: 0, z: 1 }),
    west: Object.freeze({ x: -1, z: 0 }),
});

/** The kinds of openables of a door leg. */
export const OPENABLE_KINDS = Object.freeze(['door', 'gate', 'trapdoor']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPoint(p) {
    return isPlainObject(p) && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function cell(p) {
    return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

function sameCell(a, b) {
    return isPoint(a) && isPoint(b) && Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y)
        && Math.floor(a.z) === Math.floor(b.z);
}

function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * A route name as the store keeps it: trimmed, lower case, spaces to `_` (like the names of areas).
 * @param {string} name
 * @returns {string|null} null for a name that is no string
 */
export function normalizeRouteName(name) {
    return typeof name === 'string' ? name.trim().toLowerCase().replace(/\s+/g, '_') : null;
}

/**
 * True for north, east, south and west.
 * @param {string} dir
 * @returns {boolean}
 */
export function isDirection(dir) {
    return typeof dir === 'string' && DIRECTIONS.includes(dir);
}

/**
 * The unit vector of a direction (north for anything else).
 * @param {string} dir
 * @returns {{x: number, z: number}}
 */
export function dirVector(dir) {
    return VECTORS[isDirection(dir) ? dir : 'north'];
}

/**
 * The opposite direction.
 * @param {string} dir
 * @returns {string}
 */
export function backOf(dir) {
    return DIRECTIONS[(DIRECTIONS.indexOf(isDirection(dir) ? dir : 'north') + 2) % 4];
}

/**
 * The direction of a horizontal step to a neighbour cell, or null when it is no step to one of the four
 * neighbours.
 * @param {number} dx
 * @param {number} dz
 * @returns {string|null}
 */
export function directionTo(dx, dz) {
    if (Math.abs(dx) + Math.abs(dz) !== 1) {
        return null;
    }
    return DIRECTIONS.find(d => VECTORS[d].x === dx && VECTORS[d].z === dz) ?? null;
}

/**
 * True when the feet at `pos` are within `range` blocks of the cell (per axis, the feet cell).
 * @param {{x,y,z}} pos
 * @param {{x,y,z}} target a cell
 * @param {number} [range]
 * @returns {boolean}
 */
export function nearCell(pos, target, range = 1) {
    if (!isPoint(pos) || !isPoint(target)) {
        return false;
    }
    return Math.abs(Math.floor(pos.x) - Math.floor(target.x)) <= range && Math.abs(Math.floor(pos.y + 0.01) - Math.floor(target.y)) <= range
        && Math.abs(Math.floor(pos.z) - Math.floor(target.z)) <= range;
}

// ---- the legs from the steps ----

function cleanVia(via) {
    if (!isPoint(via) || !OPENABLE_KINDS.includes(via.kind)) {
        return null;
    }
    return { kind: via.kind, name: typeof via.name === 'string' ? via.name : null, x: Math.floor(via.x), y: Math.floor(via.y), z: Math.floor(via.z) };
}

// The steps as cells with `at` and `via`; a step in the cell of the one before is left out.
function stepCells(steps) {
    const out = [];
    for (const step of Array.isArray(steps) ? steps : []) {
        if (!isPoint(step)) {
            continue;
        }
        const c = { ...cell(step), at: typeof step.at === 'string' ? step.at : null, via: cleanVia(step.via) };
        const last = out[out.length - 1];
        if (last && sameCell(last, c)) {
            last.via = last.via ?? c.via;
            continue;
        }
        out.push(c);
    }
    return out;
}

// Before `index` (going back at most 3 steps), the step outside the column at the top: within 2 blocks
// sideways of the column and not lower than the top. The index or null.
function topSideIndex(s, index, x, z, top, step) {
    for (let k = index + step, n = 0; k >= 0 && k < s.length && n < 3; k += step, n++) {
        const st = s[k];
        if (st.x === x && st.z === z) {
            continue;
        }
        return Math.max(Math.abs(st.x - x), Math.abs(st.z - z)) <= 2 && st.y >= top ? k : null;
    }
    return null;
}

// A run of ladder steps in one column, a..b, as a ladder leg with the steps it covers, or null when the
// bot did not climb (one height only).
function ladderRun(s, a, b, faceAt) {
    const x = s[a].x;
    const z = s[a].z;
    const inColumn = st => Boolean(st) && st.x === x && st.z === z;
    const ys = s.slice(a, b + 1).map(st => st.y);
    const top = Math.max(...ys);
    const low = Math.min(...ys);
    const prev = s[a - 1];
    const next = s[b + 1];
    let down;
    if (s[b].y !== s[a].y) {
        down = s[b].y < s[a].y;
    } else if (inColumn(next) && next.y < low) {
        down = true;
    } else if (inColumn(prev) && prev.y < low) {
        down = false;
    } else {
        return null;
    }
    let start = a;
    let end = b;
    let bottom = low;
    // the floor under a column that ends above it
    if (down && inColumn(next) && next.y < low) {
        bottom = next.y;
        end = b + 1;
    } else if (!down && inColumn(prev) && prev.y < low) {
        bottom = prev.y;
        start = a - 1;
    }
    if (top <= bottom) {
        return null;
    }
    let face = null;
    if (typeof faceAt === 'function') {
        for (let y = top; y >= bottom && !face; y--) {
            try {
                const f = faceAt(x, y, z);
                face = isDirection(f) ? f : null;
            } catch {
                face = null;
            }
        }
    }
    const entryIndex = down ? topSideIndex(s, start, x, z, top, -1) : topSideIndex(s, end, x, z, top, 1);
    const entryStep = entryIndex === null ? null : s[entryIndex];
    if (!face && entryStep) {
        // the step at the top beside the column stands on the wall: the ladders face away from it
        const d = directionTo(Math.sign(entryStep.x - x), Math.sign(entryStep.z - z));
        face = d ? backOf(d) : null;
    }
    if (!face) {
        // the step at the bottom beside the column: the bot left the ladder away from the wall
        const foot = down ? s[end + 1] : s[start - 1];
        const d = foot && !inColumn(foot) ? directionTo(Math.sign(foot.x - x), Math.sign(foot.z - z)) : null;
        face = d ?? 'north';
    }
    let entry;
    if (entryStep) {
        entry = cell(entryStep);
        if (down) {
            start = entryIndex;
        } else {
            end = entryIndex;
        }
    } else {
        const back = dirVector(backOf(face));
        entry = { x: x + back.x, y: top + 1, z: z + back.z };
    }
    return { start, end, order: 1, leg: { kind: 'ladder', x, z, top, bottom, face, entry } };
}

function ladderLegs(s, faceAt) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        if (s[i].at !== 'ladder') {
            continue;
        }
        let j = i;
        while (j + 1 < s.length && s[j + 1].at === 'ladder' && s[j + 1].x === s[i].x && s[j + 1].z === s[i].z) {
            j++;
        }
        const run = ladderRun(s, i, j, faceAt);
        if (run) {
            out.push(run);
        }
        i = j;
    }
    return out;
}

// The passage of a group of steps i0..i1 that passed the same openable, or null. A trapdoor counts only
// when the trail crosses its level beside it (walking over a closed trapdoor is no passage).
function doorPassage(s, i0, i1, via) {
    const make = (f, t) => ({
        start: f,
        end: t,
        order: 0,
        leg: { kind: 'door', kind2: via.kind, name: via.name, x: via.x, y: via.y, z: via.z, from: cell(s[f]), to: cell(s[t]) },
    });
    if (via.kind === 'trapdoor') {
        const side = st => (st.y < via.y ? -1 : 1);
        const near = st => Math.max(Math.abs(st.x - via.x), Math.abs(st.z - via.z)) <= 2;
        for (let k = Math.max(0, i0 - 1); k <= i1 && k + 1 < s.length; k++) {
            if (side(s[k]) !== side(s[k + 1]) && near(s[k]) && near(s[k + 1])) {
                return make(k, k + 1);
            }
        }
        return null;
    }
    let from = null;
    for (let k = i0 - 1; k >= Math.max(0, i0 - 3); k--) {
        if (!sameCell(s[k], via)) {
            from = k;
            break;
        }
    }
    if (from === null && !sameCell(s[i0], via) && i0 < i1) {
        from = i0;
    }
    let to = null;
    for (let k = i1; k < Math.min(s.length, i1 + 3); k++) {
        if (!sameCell(s[k], via) && (from === null || k > from)) {
            to = k;
            break;
        }
    }
    return from === null || to === null || from >= to ? null : make(from, to);
}

function doorLegs(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        const via = s[i].via;
        if (!via) {
            continue;
        }
        let j = i;
        while (j + 1 < s.length && sameCell(s[j + 1].via, via)) {
            j++;
        }
        const passage = doorPassage(s, i, j, via);
        if (passage) {
            out.push(passage);
        }
        i = j;
    }
    return out;
}

// The walk legs of the steps i..j: hops at most maxHop from their start and at most maxHopPath of trail.
function walkLegs(s, i, j, maxHop, maxPath, legs) {
    let anchor = i;
    while (anchor < j) {
        let e = anchor + 1;
        let path = dist(s[anchor], s[e]);
        while (e < j && dist(s[anchor], s[e + 1]) <= maxHop && path + dist(s[e], s[e + 1]) <= maxPath) {
            path += dist(s[e], s[e + 1]);
            e++;
        }
        if (!sameCell(s[anchor], s[e])) {
            legs.push({ kind: 'walk', from: cell(s[anchor]), to: cell(s[e]) });
        }
        anchor = e;
    }
}

/**
 * The legs of a way from the steps of the trail, in the order walked: walk legs of at most 12 blocks
 * (`maxHop`), a ladder leg for every climb on a column of ladders, a door leg for every door, gate and
 * trapdoor passed (a trapdoor only when the trail crosses its level). `faceAt(x, y, z)` may give the
 * `facing` of a ladder block; without it the face comes from the steps beside the column.
 * @param {object[]} steps
 * @param {{maxHop?: number, faceAt?: (x: number, y: number, z: number) => string|null}} [options]
 * @returns {{legs: object[], from: {x,y,z}|null, to: {x,y,z}|null}}
 */
export function routeFromSteps(steps, options = {}) {
    const maxHop = isFiniteNumber(options?.maxHop) && options.maxHop > 0 ? options.maxHop : ROUTE_RULES.maxHop;
    const maxPath = Math.max(maxHop, ROUTE_RULES.maxHopPath * maxHop / ROUTE_RULES.maxHop);
    const s = stepCells(steps);
    if (s.length === 0) {
        return { legs: [], from: null, to: null };
    }
    const special = [...ladderLegs(s, options?.faceAt), ...doorLegs(s)].sort((a, b) => a.start - b.start || a.order - b.order);
    const legs = [];
    let cursor = 0;
    for (const sp of special) {
        if (sp.start > cursor) {
            walkLegs(s, cursor, sp.start, maxHop, maxPath, legs);
        }
        legs.push(sp.leg);
        cursor = Math.max(cursor, sp.end);
    }
    if (cursor < s.length - 1) {
        walkLegs(s, cursor, s.length - 1, maxHop, maxPath, legs);
    }
    return { legs, from: cell(s[0]), to: cell(s[s.length - 1]) };
}

// ---- where a way starts ----

function thingKey(thing) {
    return `${thing?.kind}:${thing?.name}`;
}

/**
 * Where the way of the trail starts (A2): walking back from the last step, the first step at a known
 * thing that is not a thing of the last step.
 * @param {object[]} steps
 * @param {{name: string, kind: 'place'|'area'|'mine', test: (step: object) => boolean}[]} known
 * @returns {{index: number, known: object}|null}
 */
export function routeStart(steps, known) {
    const list = Array.isArray(steps) ? steps : [];
    const things = (Array.isArray(known) ? known : []).filter(k => k && typeof k.test === 'function');
    if (list.length === 0 || things.length === 0) {
        return null;
    }
    const hits = (thing, step) => {
        try {
            return thing.test(step) === true;
        } catch {
            return false;
        }
    };
    const last = list[list.length - 1];
    const ofLast = new Set(things.filter(k => hits(k, last)).map(thingKey));
    for (let i = list.length - 1; i >= 0; i--) {
        const found = things.find(k => !ofLast.has(thingKey(k)) && hits(k, list[i]));
        if (found) {
            return { index: i, known: found };
        }
    }
    return null;
}

/**
 * The start of a way moved back to the start of the run of ladder steps it lies in (and to the floor under
 * the column): a way never starts half way up a ladder, where a leg of the ladder would have no floor at
 * its bottom. The box of an area can hold the lower part of a shaft.
 * @param {object[]} steps
 * @param {number} index the start of routeStart
 * @returns {number}
 */
export function startOffLadder(steps, index) {
    const list = Array.isArray(steps) ? steps : [];
    let i = Number.isInteger(index) ? index : 0;
    const sameColumn = (a, b) => isPoint(a) && isPoint(b) && a.x === b.x && a.z === b.z;
    while (i > 0 && list[i]?.at === 'ladder' && sameColumn(list[i - 1], list[i]) && (list[i - 1].at === 'ladder' || list[i - 1].y < list[i].y)) {
        i--;
    }
    return i;
}

/**
 * The index of the last step under open sky, or -1.
 * @param {object[]} steps
 * @returns {number}
 */
export function skyStart(steps) {
    const list = Array.isArray(steps) ? steps : [];
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]?.sky === true) {
            return i;
        }
    }
    return -1;
}

function roomPoints(mine) {
    const room = isPlainObject(mine?.room) ? mine.room : {};
    return [room.center, room.chest, room.table, room.furnace, mine?.base].filter(isPoint).map(cell);
}

/**
 * The saved places, areas and mines as known things for routeStart: a place within 2 blocks, inside the
 * box of an area, in the room of a mine (within 2 blocks of its middle, chest, table or furnace) or on
 * the route of a mine (within 1 block of a cell of a leg). Places come first, then areas, then mines.
 * @param {{places?: {name: string, x: number, y: number, z: number}[], areas?: object[], mines?: object[]}} input
 * @returns {{name: string, kind: 'place'|'area'|'mine', test: (step: object) => boolean}[]}
 */
export function knownThings(input = {}) {
    const out = [];
    for (const place of Array.isArray(input?.places) ? input.places : []) {
        if (isPoint(place) && typeof place.name === 'string') {
            const c = cell(place);
            out.push({ name: place.name, kind: 'place', test: step => isPoint(step) && dist(cell(step), c) <= ROUTE_RULES.placeRange });
        }
    }
    for (const area of Array.isArray(input?.areas) ? input.areas : []) {
        if (isBox(area) && typeof area.name === 'string') {
            out.push({ name: area.name, kind: 'area', test: step => containsPos(area, step) });
        }
    }
    for (const mine of Array.isArray(input?.mines) ? input.mines : []) {
        if (!isPlainObject(mine)) {
            continue;
        }
        const room = roomPoints(mine);
        const cells = (Array.isArray(mine.route) ? mine.route : []).flatMap(legCells);
        const name = typeof mine.name === 'string' && mine.name.length > 0 ? mine.name : `level ${mine.level}`;
        out.push({
            name,
            kind: 'mine',
            test: step => isPoint(step) && (room.some(p => Math.max(Math.abs(p.x - Math.floor(step.x)), Math.abs(p.z - Math.floor(step.z))) <= ROUTE_RULES.roomRange
                && Math.abs(p.y - Math.floor(step.y)) <= ROUTE_RULES.roomRange) || cells.some(c => nearCell(step, c, 1))),
        });
    }
    return out;
}

// ---- routes ----

function reverseLeg(leg) {
    if (!isPlainObject(leg)) {
        return leg;
    }
    const copy = JSON.parse(JSON.stringify(leg));
    if (leg.kind === 'walk' || leg.kind === 'door') {
        copy.from = leg.to ? { ...leg.to } : leg.to;
        copy.to = leg.from ? { ...leg.from } : leg.from;
    }
    // a ladder has no direction, and a staircase stays from its top to its bottom (the walker decides the way)
    return copy;
}

/**
 * The route walked the other way: the legs in the reverse order, `from` and `to` of the walk and door legs
 * and of the route swapped. A copy; the route is not changed.
 * @param {object} route
 * @returns {object}
 */
export function reverseRoute(route) {
    if (!isPlainObject(route)) {
        return route;
    }
    const out = JSON.parse(JSON.stringify(route));
    out.legs = (Array.isArray(route.legs) ? route.legs : []).slice().reverse().map(reverseLeg);
    out.from = route.to === undefined ? null : JSON.parse(JSON.stringify(route.to));
    out.to = route.from === undefined ? null : JSON.parse(JSON.stringify(route.from));
    return out;
}

function legStart(leg) {
    if (!isPlainObject(leg)) {
        return null;
    }
    if (leg.kind === 'ladder') {
        return isPoint(leg.entry) ? cell(leg.entry) : (isFiniteNumber(leg.x) ? { x: leg.x, y: leg.top + 1, z: leg.z } : null);
    }
    return isPoint(leg.from) ? cell(leg.from) : null;
}

function legEnd(leg) {
    if (!isPlainObject(leg)) {
        return null;
    }
    if (leg.kind === 'ladder') {
        return isFiniteNumber(leg.x) && isFiniteNumber(leg.bottom) && isFiniteNumber(leg.z) ? { x: leg.x, y: leg.bottom, z: leg.z } : null;
    }
    return isPoint(leg.to) ? cell(leg.to) : null;
}

/**
 * The two ends of a route as cells: its `from` and `to`, or, for a route of legs only (a mine), the start
 * of the first leg and the end of the last.
 * @param {object} route
 * @returns {{from: {x,y,z}|null, to: {x,y,z}|null}}
 */
export function routeEnds(route) {
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    const from = isPoint(route?.from) ? cell(route.from) : legStart(legs[0]);
    const to = isPoint(route?.to) ? cell(route.to) : legEnd(legs[legs.length - 1]);
    return { from: from ?? null, to: to ?? null };
}

function line(a, b) {
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z));
    const out = [];
    for (let k = 0; k <= n; k++) {
        const t = n === 0 ? 0 : k / n;
        out.push({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t), z: Math.round(a.z + (b.z - a.z) * t) });
    }
    return out;
}

/**
 * The cells a leg covers: a walk the straight line from `from` to `to`, a ladder its column from the top
 * to the bottom, a staircase its steps, a door leg `from`, the openable and `to`.
 * @param {object} leg
 * @returns {{x: number, y: number, z: number}[]}
 */
export function legCells(leg) {
    if (!isPlainObject(leg)) {
        return [];
    }
    if (leg.kind === 'ladder') {
        if (![leg.x, leg.z, leg.top, leg.bottom].every(isFiniteNumber)) {
            return [];
        }
        const out = [];
        for (let y = Math.floor(leg.top); y >= Math.floor(leg.bottom); y--) {
            out.push({ x: Math.floor(leg.x), y, z: Math.floor(leg.z) });
        }
        return out;
    }
    if (!isPoint(leg.from) || !isPoint(leg.to)) {
        return [];
    }
    const from = cell(leg.from);
    const to = cell(leg.to);
    if (leg.kind === 'walk') {
        return line(from, to);
    }
    if (leg.kind === 'stairs') {
        if (!isDirection(leg.dir) || from.y < to.y) {
            return line(from, to);
        }
        const v = dirVector(leg.dir);
        const out = [];
        for (let k = 0; k <= from.y - to.y; k++) {
            out.push({ x: from.x + v.x * k, y: from.y - k, z: from.z + v.z * k });
        }
        return out;
    }
    if (leg.kind === 'door') {
        const out = [from];
        if (isPoint(leg)) {
            out.push(cell(leg));
        }
        out.push(to);
        return out.filter((c, i) => out.findIndex(o => sameCell(o, c)) === i);
    }
    return [];
}

function distanceToTarget(target, p) {
    return isBox(target) ? distanceToBox(target, p) : dist(target, p);
}

/**
 * The route to take to a target (A4): one end within `range` of the target (a point, or a box such as an
 * area), the other end within `reach` of the bot; the one whose start is nearest to the bot wins.
 * `reverse` is true when the bot starts at the `to` of the route.
 * @param {object[]} routes
 * @param {{x,y,z}|{min, max}} target
 * @param {{x,y,z}} botPos
 * @param {{range?: number, reach?: number}} [options]
 * @returns {{route: object, reverse: boolean, distance: number}|null}
 */
export function nearestRoute(routes, target, botPos, options = {}) {
    if (!isPoint(botPos) || !(isPoint(target) || isBox(target))) {
        return null;
    }
    const range = isFiniteNumber(options?.range) ? options.range : ROUTE_RULES.range;
    const reach = isFiniteNumber(options?.reach) ? options.reach : ROUTE_RULES.reach;
    let best = null;
    const consider = (route, reverse, start, end) => {
        if (!start || !end || distanceToTarget(target, end) > range) {
            return;
        }
        const d = dist(botPos, start);
        if (d <= reach && (!best || d < best.distance)) {
            best = { route, reverse, distance: d };
        }
    };
    for (const route of Array.isArray(routes) ? routes : []) {
        if (!isPlainObject(route) || !Array.isArray(route.legs) || route.legs.length === 0) {
            continue;
        }
        const { from, to } = routeEnds(route);
        consider(route, false, from, to);
        consider(route, true, to, from);
    }
    return best;
}

/**
 * True when the door leg is a trapdoor above the column of the ladder leg (at most 2 blocks above its top).
 * @param {object} doorLeg
 * @param {object} ladderLeg
 * @returns {boolean}
 */
export function trapdoorOverLadder(doorLeg, ladderLeg) {
    return isPlainObject(doorLeg) && isPlainObject(ladderLeg) && doorLeg.kind === 'door' && doorLeg.kind2 === 'trapdoor'
        && ladderLeg.kind === 'ladder' && doorLeg.x === ladderLeg.x && doorLeg.z === ladderLeg.z
        && doorLeg.y > ladderLeg.top && doorLeg.y <= ladderLeg.top + 2;
}

/**
 * What a route holds, for its texts: the number of legs, of ladders, doors, gates and trapdoors.
 * @param {object[]} legs
 * @returns {{legs: number, ladder: number, door: number, gate: number, trapdoor: number}}
 */
export function legCounts(legs) {
    const list = Array.isArray(legs) ? legs : [];
    const out = { legs: list.length, ladder: 0, door: 0, gate: 0, trapdoor: 0 };
    for (const leg of list) {
        if (leg?.kind === 'ladder') {
            out.ladder++;
        } else if (leg?.kind === 'door' && OPENABLE_KINDS.includes(leg.kind2)) {
            out[leg.kind2]++;
        }
    }
    return out;
}

/**
 * A leg as a route keeps it, or null when it is not valid.
 * @param {object} leg
 * @returns {object|null}
 */
export function cleanLeg(leg) {
    if (!isPlainObject(leg)) {
        return null;
    }
    if (leg.kind === 'ladder' && [leg.x, leg.z, leg.top, leg.bottom].every(isFiniteNumber)) {
        return {
            kind: 'ladder', x: Math.floor(leg.x), z: Math.floor(leg.z), top: Math.floor(leg.top), bottom: Math.floor(leg.bottom),
            face: isDirection(leg.face) ? leg.face : 'north', entry: isPoint(leg.entry) ? cell(leg.entry) : null,
        };
    }
    if ((leg.kind === 'walk' || leg.kind === 'stairs') && isPoint(leg.from) && isPoint(leg.to)) {
        const out = { kind: leg.kind, from: cell(leg.from), to: cell(leg.to) };
        if (leg.kind === 'stairs') {
            out.dir = isDirection(leg.dir) ? leg.dir : 'north';
        }
        return out;
    }
    if (leg.kind === 'door' && OPENABLE_KINDS.includes(leg.kind2) && isPoint(leg) && isPoint(leg.from) && isPoint(leg.to)) {
        return {
            kind: 'door', kind2: leg.kind2, name: typeof leg.name === 'string' ? leg.name : null,
            x: Math.floor(leg.x), y: Math.floor(leg.y), z: Math.floor(leg.z), from: cell(leg.from), to: cell(leg.to),
        };
    }
    return null;
}
