// The routes of one world (spec v0.1.4.9 I2), persisted as { version: 1, routes: { "<name>" | "<dim>:<name>": route } }
// in <worldDir>/routes.json. One route per name and dimension; a name is kept like the name of an area
// (trimmed, lower case, spaces to `_`).
//
// A route is { name, dimension, from: { name, kind, x, y, z }, to: { name, x, y, z }, legs, steps, source,
// created, updated }; the legs are those of route_logic.js.
import { readJsonSafe, writeJsonAtomic } from '../../../utils/safe_json.js';
import { ROUTE_RULES, cleanLeg, normalizeRouteName } from './route_logic.js';

/** The name of the file in the world folder. */
export const ROUTE_FILE = 'routes.json';
/** Where a route comes from. */
export const ROUTE_SOURCES = Object.freeze(['trail', 'mine']);
/** The kinds of the start of a route. */
export const START_KINDS = Object.freeze(['place', 'area', 'mine']);

const FILE_VERSION = 1;

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizeDimension(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim().replace(/^minecraft:/, '') : 'overworld';
}

function end(p, withKind) {
    if (!isPlainObject(p) || !isFiniteNumber(p.x) || !isFiniteNumber(p.y) || !isFiniteNumber(p.z)) {
        return null;
    }
    const out = { name: typeof p.name === 'string' && p.name.length > 0 ? p.name : null, x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    if (withKind) {
        out.kind = START_KINDS.includes(p.kind) ? p.kind : null;
    }
    return out;
}

function copyRoute(route) {
    return JSON.parse(JSON.stringify(route));
}

/**
 * The clean entry to store, or null when the route is not valid: a name of 1 to 64 characters, both ends
 * with finite x, y and z, at least one valid leg. Invalid legs are left out.
 * @param {object} route
 * @param {string|null} now ISO time for created and updated
 * @returns {object|null}
 */
function validateRoute(route, now) {
    if (!isPlainObject(route)) {
        return null;
    }
    const name = normalizeRouteName(route.name);
    if (!name || name.length > ROUTE_RULES.nameMax) {
        return null;
    }
    const from = end(route.from, true);
    const to = end(route.to, false);
    const legs = (Array.isArray(route.legs) ? route.legs : []).map(cleanLeg).filter(Boolean);
    if (!from || !to || legs.length === 0) {
        return null;
    }
    return {
        name,
        dimension: normalizeDimension(route.dimension),
        from,
        to,
        legs,
        steps: isFiniteNumber(route.steps) && route.steps >= 0 ? Math.floor(route.steps) : 0,
        source: ROUTE_SOURCES.includes(route.source) ? route.source : 'trail',
        created: typeof route.created === 'string' ? route.created : now,
        updated: now,
    };
}

function routeKey(name, dimension) {
    const dim = normalizeDimension(dimension);
    return dim === 'overworld' ? name : `${dim}:${name}`;
}

export class RouteStore {
    /**
     * @param {string|null} filePath usually <worldDir>/routes.json; without it the store lives in memory only
     * @param {{now?: () => Date}} [options]
     */
    constructor(filePath, options = {}) {
        this.filePath = typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
        const now = options?.now;
        this.now = typeof now === 'function' ? now : () => new Date();
        this._routes = new Map();
    }

    _nowIso() {
        try {
            const value = this.now();
            return (value instanceof Date ? value : new Date(value)).toISOString();
        } catch {
            return new Date().toISOString();
        }
    }

    /**
     * Reads the file. Missing: empty. Corrupt: set aside by readJsonSafe, empty. Invalid entries are
     * skipped. Never throws.
     * @returns {number} number of routes
     */
    load() {
        this._routes = new Map();
        if (this.filePath === null) {
            return 0;
        }
        try {
            const result = readJsonSafe(this.filePath, { expect: 'object', now: this.now });
            if (result.status === 'ok') {
                const routes = result.data.routes;
                if (isPlainObject(routes)) {
                    for (const entry of Object.values(routes)) {
                        const clean = validateRoute(entry, null);
                        if (clean) {
                            clean.created = typeof entry.created === 'string' ? entry.created : null;
                            clean.updated = typeof entry.updated === 'string' ? entry.updated : null;
                            this._routes.set(routeKey(clean.name, clean.dimension), clean);
                        }
                    }
                }
            } else if (result.status !== 'missing') {
                let warning = `Route file ${this.filePath} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting with no known routes.`);
            }
        } catch (err) {
            console.warn(`Route file ${this.filePath} could not be read:`, err?.message ?? err);
            this._routes = new Map();
        }
        return this._routes.size;
    }

    /**
     * Creates or replaces the route of its name and dimension and writes the file. A route that exists
     * keeps its `created` time. Never throws.
     * @param {object} route
     * @returns {object|null} a copy of the saved route, null when the route is not valid
     */
    set(route) {
        try {
            const clean = validateRoute(route, this._nowIso());
            if (!clean) {
                return null;
            }
            const key = routeKey(clean.name, clean.dimension);
            const old = this._routes.get(key);
            if (old) {
                clean.created = typeof route.created === 'string' ? route.created : old.created ?? clean.created;
            }
            this._routes.set(key, clean);
            this._save();
            return copyRoute(clean);
        } catch (err) {
            console.warn('Could not save the route:', err?.message ?? err);
            return null;
        }
    }

    /**
     * The route of a name, or null.
     * @param {string} name
     * @param {string} [dimension] overworld without one
     * @returns {object|null} a copy
     */
    get(name, dimension) {
        const clean = normalizeRouteName(name);
        if (!clean) {
            return null;
        }
        const route = this._routes.get(routeKey(clean, dimension));
        return route ? copyRoute(route) : null;
    }

    /**
     * The routes of a dimension (all without one), by name.
     * @param {string} [dimension]
     * @returns {object[]} copies
     */
    list(dimension) {
        const wanted = dimension === undefined || dimension === null ? null : normalizeDimension(dimension);
        return [...this._routes.values()].filter(r => wanted === null || r.dimension === wanted)
            .sort((a, b) => a.name.localeCompare(b.name) || a.dimension.localeCompare(b.dimension)).map(copyRoute);
    }

    /**
     * Removes the route of a name and writes the file.
     * @param {string} name
     * @param {string} [dimension] overworld without one
     * @returns {boolean} true if it existed
     */
    remove(name, dimension) {
        const clean = normalizeRouteName(name);
        const key = clean ? routeKey(clean, dimension) : null;
        if (key === null || !this._routes.has(key)) {
            return false;
        }
        this._routes.delete(key);
        this._save();
        return true;
    }

    /** Number of routes. */
    get size() {
        return this._routes.size;
    }

    _toJson() {
        const routes = {};
        for (const route of this.list()) {
            routes[routeKey(route.name, route.dimension)] = route;
        }
        return { version: FILE_VERSION, routes };
    }

    _save() {
        if (this.filePath === null) {
            return true;
        }
        try {
            writeJsonAtomic(this.filePath, this._toJson(), { indent: 2 });
            return true;
        } catch (err) {
            console.warn(`Could not write the route file ${this.filePath}:`, err?.message ?? err);
            return false;
        }
    }
}
