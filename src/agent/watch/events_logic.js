// v0.1.4.12 (part C): the events of the watch server from facts (spec 4.1, the table of the events). Pure: the
// facts and the clock come in, an event or null goes out; the small watchers keep their own state. events.js
// feeds them from the bot. Each event is { t: ISO, kind, text, data }. Nothing here throws.
import { TEXTS } from './texts.js';

export const EVENT_KINDS = Object.freeze(['explosion', 'health', 'animals_missing', 'night_awake', 'job_stalled',
    'failure_repeated', 'far_from_home', 'death', 'restart', 'report', 'help']);

// v0.1.4.13 (part S): a text of the bot that asks the player something: it ends with "?", or holds `Say "` or
// `Tell me`. With settings.supervisor_name set, such a text becomes an event of kind help.
export const HELP_PATTERNS = Object.freeze([/\?\s*$/, /Say "/, /Tell me/]);

export const EVENT_RULES = Object.freeze({
    ringSize: 200,         // the events kept in memory
    lastDefault: 20,       // the events tool without since
    explosionRange: 16,    // blocks from a saved area
    healthDrop: 4,         // health points ...
    healthWindowMs: 5000,  // ... within this time
    penRange: 32,          // the bot within this many blocks of a pen
    animalsEveryMs: 60000, // the pens are counted once a minute
    nightAt: 23000,        // the time of day when the night has passed
    nightStart: 12000,     // a new night starts here: the sleep of the last one is forgotten
    jobStallMs: 10 * 60 * 1000,
    failureTimes: 5,
    failureChars: 80,      // a longer failure text is cut, with ' ...'
    homeRange: 100,
    chatSize: 100,         // the chat lines kept in memory
});

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

/** `(12, 67, 52)`: the block of a position. */
export function posText(p) {
    if (!isPoint(p))
        return '(unknown)';
    return `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`;
}

/** The dimension without `minecraft:`, `overworld` when unknown. */
export function plainDimension(dimension) {
    return typeof dimension === 'string' && dimension !== '' ? dimension.replace(/^minecraft:/, '') : 'overworld';
}

/** A number of health points as it is shown: whole, or with one decimal. */
export function pointsText(value) {
    if (!isFiniteNumber(value))
        return '?';
    return String(Math.round(value * 10) / 10);
}

function isoOf(now) {
    try {
        const ms = now instanceof Date ? now.getTime() : (isFiniteNumber(now) ? now : Date.now());
        return new Date(ms).toISOString();
    } catch {
        return new Date().toISOString();
    }
}

/**
 * An event.
 * @param {string} kind one of EVENT_KINDS
 * @param {string} text
 * @param {object} [data]
 * @param {number|Date} [now] ms
 * @returns {{t: string, kind: string, text: string, data: object}}
 */
export function makeEvent(kind, text, data = {}, now = Date.now()) {
    return { t: isoOf(now), kind, text, data: data !== null && typeof data === 'object' ? data : {} };
}

/** `13:45:02`: the local time of the process. */
export function clockText(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime()))
        return '--:--:--';
    const two = (n) => String(n).padStart(2, '0');
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** The line of an event for the events tool and the client: `[13:45:02] explosion: Explosion 6 blocks ...`. */
export function eventLine(event) {
    return `[${clockText(event?.t)}] ${event?.kind ?? 'event'}: ${event?.text ?? ''}`;
}

/**
 * A ring of the newest `size` entries, oldest first. v0.1.4.13 (part S): `total` counts every entry ever
 * pushed, so the digest can ask for the entries since an index (`since(index)`).
 */
export class Ring {
    constructor(size = EVENT_RULES.ringSize) {
        this.size = Number.isInteger(size) && size > 0 ? size : EVENT_RULES.ringSize;
        this.items = [];
        this.total = 0;
    }

    push(item) {
        this.items.push(item);
        this.total++;
        if (this.items.length > this.size)
            this.items.splice(0, this.items.length - this.size);
        return item;
    }

    /** The last n, oldest first. */
    last(n) {
        const count = Number.isInteger(n) && n > 0 ? n : 0;
        return count === 0 ? [] : this.items.slice(-count);
    }

    /** The entries pushed after the first `index` ones (index: a `total` seen earlier), oldest first. */
    since(index) {
        const seen = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
        const fresh = Math.max(0, this.total - seen);
        return fresh === 0 ? [] : this.items.slice(-Math.min(fresh, this.items.length));
    }

    get length() {
        return this.items.length;
    }
}

/**
 * A time for `since`: the ms of an ISO time, null when it is not one.
 * @param {*} since
 * @returns {number|null}
 */
export function sinceMs(since) {
    if (typeof since !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(since.trim()))
        return null;
    const ms = Date.parse(since.trim());
    return Number.isFinite(ms) ? ms : null;
}

/**
 * The events after since (ms), oldest first; without since the last EVENT_RULES.lastDefault.
 * @param {Array} events oldest first
 * @param {number|null} since
 */
export function eventsSince(events, since) {
    const list = Array.isArray(events) ? events : [];
    if (since === null || since === undefined)
        return list.slice(-EVENT_RULES.lastDefault);
    return list.filter((event) => Date.parse(event?.t) > since);
}

// ---- explosion ----

/** Blocks from a point to the box of an area (0 inside). The box holds the blocks min..max. */
export function distanceToBox(p, area) {
    if (!isPoint(p) || !isPoint(area?.min) || !isPoint(area?.max))
        return Infinity;
    const axis = (v, lo, hi) => (v < lo ? lo - v : (v > hi + 1 ? v - hi - 1 : 0));
    const dx = axis(p.x, Math.min(area.min.x, area.max.x), Math.max(area.min.x, area.max.x));
    const dy = axis(p.y, Math.min(area.min.y, area.max.y), Math.max(area.min.y, area.max.y));
    const dz = axis(p.z, Math.min(area.min.z, area.max.z), Math.max(area.min.z, area.max.z));
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function sameDimension(area, dimension) {
    return plainDimension(area?.dimension) === plainDimension(dimension);
}

/**
 * The event of an explosion within 16 blocks of a saved area (any kind), naming the nearest; null else.
 * @param {{x, y, z}} at the position of the packet
 * @param {object[]} areas the saved areas
 * @param {string} dimension of the bot
 * @param {number} [now]
 */
export function explosionEvent(at, areas, dimension, now = Date.now()) {
    if (!isPoint(at) || !Array.isArray(areas))
        return null;
    let best = null;
    for (const area of areas) {
        if (!sameDimension(area, dimension))
            continue;
        const d = distanceToBox(at, area);
        if (d <= EVENT_RULES.explosionRange && (best === null || d < best.d))
            best = { area, d };
    }
    if (!best)
        return null;
    const blocks = Math.round(best.d);
    const pos = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
    return makeEvent('explosion', TEXTS.explosion(blocks, best.area.name, posText(at)), { area: best.area.name, blocks, pos }, now);
}

// ---- health ----

/** Watches the health: an event when it fell by 4 or more within 5 s. */
export function createHealthWatch() {
    let samples = []; // { t, h }
    return {
        /**
         * @param {number} health
         * @param {{x, y, z}} pos
         * @param {number} [now]
         * @returns {object|null}
         */
        update(health, pos, now = Date.now()) {
            if (!isFiniteNumber(health))
                return null;
            samples = samples.filter((s) => now - s.t <= EVENT_RULES.healthWindowMs);
            const peak = samples.reduce((max, s) => Math.max(max, s.h), -Infinity);
            samples.push({ t: now, h: health });
            if (peak === -Infinity || peak - health < EVENT_RULES.healthDrop)
                return null;
            samples = [{ t: now, h: health }]; // one event per fall
            return makeEvent('health', TEXTS.health(pointsText(peak), pointsText(health), posText(pos)),
                { from: peak, to: health, pos: isPoint(pos) ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null }, now);
        },
    };
}

// ---- animals_missing ----

/** True for a saved pen with a record of animals. */
export function isPenWithAnimals(area) {
    if (!area || (area.type !== 'pen' && area.kind !== 'pen'))
        return false;
    const animals = area.contents?.animals;
    return animals !== null && typeof animals === 'object' && Object.values(animals).some((n) => isFiniteNumber(n) && n > 0);
}

/** True when an entity position lies inside the box of an area (the blocks min..max). */
export function insideBox(p, area) {
    return isPoint(p) && distanceToBox(p, area) === 0;
}

/**
 * Counts the animals of the record inside the box of a pen.
 * @param {object} pen
 * @param {Array<{name: string, position: {x, y, z}}>} entities
 * @returns {Object<string, number>} name -> count, for every kind of the record
 */
export function countAnimals(pen, entities) {
    const counts = {};
    for (const name of Object.keys(pen?.contents?.animals ?? {}))
        counts[name] = 0;
    for (const entity of Array.isArray(entities) ? entities : []) {
        const name = entity?.name;
        if (typeof name === 'string' && Object.prototype.hasOwnProperty.call(counts, name) && insideBox(entity.position, pen))
            counts[name]++;
    }
    return counts;
}

/**
 * Watches the pens: once per pen an event while a kind of its record is short, again after the count was back.
 * check() is called once a minute by events.js.
 */
export function createAnimalsWatch() {
    const reported = new Set();
    return {
        /**
         * @param {object[]} areas the saved areas
         * @param {Array} entities { name, position } of the entities the bot sees
         * @param {{x, y, z}} botPos
         * @param {string} dimension
         * @param {number} [now]
         * @returns {object[]} the new events
         */
        check(areas, entities, botPos, dimension, now = Date.now()) {
            const events = [];
            if (!Array.isArray(areas) || !isPoint(botPos))
                return events;
            for (const pen of areas) {
                if (!isPenWithAnimals(pen) || !sameDimension(pen, dimension))
                    continue;
                if (distanceToBox(botPos, pen) > EVENT_RULES.penRange)
                    continue; // too far to count: the state stays
                const counts = countAnimals(pen, entities);
                const missing = Object.entries(pen.contents.animals)
                    .filter(([name, record]) => isFiniteNumber(record) && counts[name] < record)
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
                if (missing.length === 0) {
                    reported.delete(pen.name);
                    continue;
                }
                if (reported.has(pen.name))
                    continue;
                reported.add(pen.name);
                const parts = missing.map(([name, record]) => TEXTS.animalsPart(counts[name], name, record));
                const data = { area: pen.name, animals: Object.fromEntries(missing.map(([name, record]) => [name, { count: counts[name], record }])) };
                events.push(makeEvent('animals_missing', TEXTS.animalsMissing(pen.name, parts), data, now));
            }
            return events;
        },
    };
}

// ---- night_awake ----

/** Watches the nights: an event when the time passes 23000 and the bot did not sleep since 12000. */
export function createNightWatch() {
    let prev = null;
    let slept = false;
    return {
        /** The bot slept (the sleep event of the bot, or isSleeping seen). */
        slept() {
            slept = true;
        },
        /**
         * @param {number} timeOfDay 0 to 23999
         * @param {boolean} sleeping
         * @param {number} [now]
         * @returns {object|null}
         */
        update(timeOfDay, sleeping, now = Date.now()) {
            if (!isFiniteNumber(timeOfDay))
                return null;
            const before = prev;
            prev = timeOfDay;
            if (before !== null && before < EVENT_RULES.nightStart && timeOfDay >= EVENT_RULES.nightStart)
                slept = false; // a new night
            if (sleeping === true)
                slept = true;
            // the time passed 23000 by itself (not by a jump of a command or of the sleep of all players)
            const passed = before !== null && before < EVENT_RULES.nightAt && timeOfDay >= EVENT_RULES.nightAt && timeOfDay - before < 2000;
            if (!passed)
                return null;
            const awake = !slept;
            slept = false;
            return awake ? makeEvent('night_awake', TEXTS.nightAwake, { timeOfDay }, now) : null;
        },
    };
}

// ---- job_stalled ----

/** `the mining, 4 of 8 iron` from the status line `Job: the mining, 4 of 8 iron.` */
export function jobWords(line) {
    if (typeof line !== 'string')
        return 'the job';
    const words = line.trim().replace(/^(Last )?Job:\s*/i, '').replace(/\.$/, '').trim();
    return words === '' ? 'the job' : words;
}

/** Watches the job: once per job an event when it runs and `updated` is older than 10 minutes. */
export function createJobWatch() {
    const reported = new Set();
    return {
        /**
         * @param {object|null} job the record of the job store ({ state, updated, started, command })
         * @param {string} statusLine job.status()
         * @param {number} [now]
         * @returns {object|null}
         */
        check(job, statusLine, now = Date.now()) {
            if (!job || job.state !== 'running')
                return null;
            const updated = Date.parse(job.updated);
            if (!Number.isFinite(updated) || now - updated < EVENT_RULES.jobStallMs)
                return null;
            const key = `${job.started ?? ''}|${job.command ?? job.kind ?? ''}`;
            if (reported.has(key))
                return null;
            reported.add(key);
            const minutes = Math.floor((now - updated) / 60000);
            const words = jobWords(statusLine);
            return makeEvent('job_stalled', TEXTS.jobStalled(words, minutes), { job: words, minutes, updated: job.updated }, now);
        },
    };
}

// ---- failure_repeated ----

/** The text of a failure for the event: one line, cut at 80 characters with ' ...'. */
export function shortFailure(text) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length <= EVENT_RULES.failureChars)
        return clean;
    return `${clean.slice(0, EVENT_RULES.failureChars).trimEnd()} ...`;
}

/** Watches the failures: an event when the same failure text came 5 times in a row (a success ends the row). */
export function createFailureWatch() {
    let row = null; // { text, times }
    return {
        /**
         * @param {string} text the result text
         * @param {boolean} failed
         * @param {number} [now]
         * @returns {object|null}
         */
        record(text, failed, now = Date.now()) {
            const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
            if (clean === '')
                return null;
            if (failed !== true) {
                row = null;
                return null;
            }
            if (row && row.text === clean)
                row.times++;
            else
                row = { text: clean, times: 1 };
            if (row.times !== EVENT_RULES.failureTimes)
                return null;
            return makeEvent('failure_repeated', TEXTS.failureRepeated(row.times, shortFailure(clean)), { text: clean, times: row.times }, now);
        },
    };
}

// ---- far_from_home ----

/** Blocks between two points. */
export function distance(a, b) {
    if (!isPoint(a) || !isPoint(b))
        return Infinity;
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** Watches the distance to the place home: once an event beyond 100 blocks, again after the bot was back within. */
export function createHomeWatch() {
    let away = false;
    return {
        /**
         * @param {string} name of the bot
         * @param {{x, y, z}} pos of the bot
         * @param {string} dimension of the bot
         * @param {{x, y, z, dimension}|null} home
         * @param {number} [now]
         * @returns {object|null}
         */
        check(name, pos, dimension, home, now = Date.now()) {
            if (!isPoint(pos) || !isPoint(home))
                return null;
            if (home.dimension && plainDimension(home.dimension) !== plainDimension(dimension))
                return null;
            const d = distance(pos, home);
            if (d <= EVENT_RULES.homeRange) {
                away = false;
                return null;
            }
            if (away)
                return null;
            away = true;
            const blocks = Math.round(d);
            return makeEvent('far_from_home', TEXTS.farFromHome(name, blocks, posText(pos)), { blocks, pos: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } }, now);
        },
    };
}

// ---- death, restart ----

export function deathEvent(name, pos, now = Date.now()) {
    return makeEvent('death', TEXTS.death(name, posText(pos)), { pos: isPoint(pos) ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } : null }, now);
}

export function restartEvent(name, now = Date.now()) {
    return makeEvent('restart', TEXTS.restart(name), {}, now);
}

// ---- help, report (v0.1.4.13, part S) ----

/** True for a text of the bot that asks the player something (HELP_PATTERNS). */
export function asksThePlayer(text) {
    if (typeof text !== 'string' || text.trim() === '')
        return false;
    const clean = text.replace(/\s+/g, ' ').trim();
    return HELP_PATTERNS.some((pattern) => pattern.test(clean));
}

/**
 * The event of kind help for a text that asks the player, null for any other text and without a supervisor.
 * @param {string} text the line of the bot
 * @param {string} supervisorName settings.supervisor_name; '' or anything that is no name: no event
 * @param {number} [now]
 */
export function helpEvent(text, supervisorName, now = Date.now()) {
    if (typeof supervisorName !== 'string' || supervisorName.trim() === '' || !asksThePlayer(text))
        return null;
    const clean = text.replace(/\s+/g, ' ').trim();
    return makeEvent('help', TEXTS.help(clean), { text: clean }, now);
}

/**
 * The event of kind report: the lines of the digest since the last report, one line joined with `; `, or
 * `Nothing changed.`
 * @param {string[]} lines the lines of digestLines without the Cursor line
 * @param {number} [now]
 */
export function reportEvent(lines, now = Date.now()) {
    const list = (Array.isArray(lines) ? lines : []).filter((line) => typeof line === 'string' && line !== '' && !line.startsWith('Cursor: '));
    const text = list.length === 0 ? TEXTS.nothingChanged : list.join('; ');
    return makeEvent('report', text, { lines: list.length }, now);
}

/**
 * Watches the tick lag: the server sends the time every 20 ticks, one second; what the time packet comes
 * later than one second after the last one is the lag. update() with the clock at each time packet; lag()
 * is the lag of the last packet in ms, 0 while on time or before the second packet.
 */
export function createTickLagWatch() {
    let last = null;
    let lag = 0;
    return {
        update(now = Date.now()) {
            if (!isFiniteNumber(now))
                return lag;
            if (last !== null)
                lag = Math.max(0, Math.round(now - last - 1000));
            last = now;
            return lag;
        },
        lag() {
            return lag;
        },
    };
}
