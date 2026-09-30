// The routes pack of v0.1.4.9 (spec section 5, part A): the trail of the bot, the ways the player shows it
// (!rememberRoute, !routes, !forgetRoute), and the walk of a way where the path search finds none (the
// home pack calls ctx.routes.walkTo). Everything the glue needs is exported here. Importing this file has
// no side effects.
//
// Pure modules (no mineflayer, no src/agent/library): trail_logic, route_logic, texts.
// The store: route_store (one file per world, <worldDir>/routes.json).
// Executing modules (they read or move the bot): trail (the recorder, <worldDir>/trail.json), replay.
import { botPos, dimensionOf, listAreas } from '../home/context.js';
import { knownThings, legCells, nearestRoute, normalizeRouteName, reverseRoute, routeEnds, routeFromSteps, routeStart,
    ROUTE_RULES, skyStart, startOffLadder } from './route_logic.js';
import { TEXTS, forgotText, noRouteText, rememberedText, routeListText, tooShortText } from './texts.js';
import { feetCell } from './trail_logic.js';
import { ladderFacingReader } from './trail.js';
import { walkByRoute, walkRoute } from './replay.js';

export { TRAIL_RULES, WATER_NAMES, cellBetween, cleanStep, columnIsOpen, feetCell, inShaft, isJump, isOpenSky, mayStep, nextStep, openSides,
    sameCell, stepSky, viaOf } from './trail_logic.js';
export { DIRECTIONS, OPENABLE_KINDS, ROUTE_RULES, backOf, cleanLeg, dirVector, directionTo, isDirection, knownThings, legCells, legCounts,
    nearCell, nearestRoute, normalizeRouteName, reverseRoute, routeEnds, routeFromSteps, routeStart, skyStart, startOffLadder,
    trapdoorOverLadder } from './route_logic.js';
export { TEXTS, emptyRouteText, forgotText, legsText, noRouteText, noWayToStartText, posText, rememberedText, replacedText, routeDoneText,
    routeErrorText, routeFailedText, routeLabel, routeLineText, routeListText, routeStoppedText, routeTimeText, startText,
    stoppedBeforeRouteText, tooShortText } from './texts.js';
export { ROUTE_FILE, ROUTE_SOURCES, RouteStore, START_KINDS } from './route_store.js';
export { TRAIL_FILE, blockGetter, createTrail, ladderFacingReader, readBlock } from './trail.js';
export { REPLAY_RULES, ladderIntact, walkByRoute, walkRoute } from './replay.js';

function sameDimension(a, b) {
    const plain = d => (typeof d === 'string' && d.length > 0 ? d.replace(/^minecraft:/, '') : null);
    return plain(a) === null || plain(b) === null || plain(a) === plain(b);
}

/**
 * The saved places of ctx.places (a MemoryBank: getJson and recallPlaceInfo; or a PlaceStore: list) in a
 * dimension, as { name, x, y, z, dimension }. A place without a dimension counts in every one. Never throws.
 * @param {object} ctx
 * @param {string} dimension
 * @returns {{name: string, x: number, y: number, z: number, dimension: string|null}[]}
 */
export function savedPlaces(ctx, dimension) {
    const places = ctx?.places;
    const out = [];
    try {
        if (typeof places?.getJson === 'function') {
            for (const [name, pos] of Object.entries(places.getJson() ?? {})) {
                const info = typeof places.recallPlaceInfo === 'function' ? places.recallPlaceInfo(name) : null;
                const p = info ?? (Array.isArray(pos) ? { x: pos[0], y: pos[1], z: pos[2], dimension: null } : null);
                if (p) {
                    out.push({ name, x: p.x, y: p.y, z: p.z, dimension: p.dimension ?? null });
                }
            }
        } else if (typeof places?.list === 'function') {
            for (const p of places.list() ?? []) {
                out.push({ name: p.name, x: p.x, y: p.y, z: p.z, dimension: p.dimension ?? null });
            }
        }
    } catch (err) {
        console.warn('Routes pack: could not read the saved places:', err?.message ?? err);
    }
    return out.filter(p => typeof p.name === 'string' && [p.x, p.y, p.z].every(Number.isFinite) && sameDimension(p.dimension, dimension));
}

function knownMines(ctx, dimension) {
    try {
        const list = ctx?.mines?.list?.(dimension);
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function storeOf(source) {
    if (typeof source?.routes?.store?.list === 'function') {
        return source.routes.store;
    }
    return typeof source?.list === 'function' && typeof source?.remove === 'function' ? source : null;
}

/**
 * !rememberRoute (A2): the trail since the last known thing becomes the route `name`, from that thing to
 * where the bot stands. Known things: the saved places (within 2 blocks), the areas (inside the box), the
 * mines (in the room or on the route); the thing at the last step does not count; a start half way up a
 * ladder moves back to the foot of the ladder (startOffLadder). The trail and the store
 * are ctx.routes.trail and ctx.routes.store (or options.trail and options.store). Synchronous; never throws.
 * Texts: `I remember the way "bed": from the place "storage" to here, 7 steps, 1 ladder, 1 trapdoor. I walk
 * it in both directions.` (with `I know a way "bed" already. I replace it.` in front when it existed),
 * `I do not know where this way starts. ...` (no_start: no known thing where the way could start), `The way
 * "bed" is too short: I stand where it starts.` (too_short: fewer than 2 steps since the known thing, or the
 * only known thing is the one where the bot stands and the trail has fewer than 2 steps or never left it).
 * @param {object} bot
 * @param {object} ctx { routes, places, areas, mines }
 * @param {string} name
 * @param {{trail?: object, store?: object}} [options]
 * @returns {{ok: boolean, reason: string|null, text: string, route: object|null}}
 */
export function rememberRoute(bot, ctx, name, options = {}) {
    try {
        const clean = normalizeRouteName(name);
        if (!clean || clean.length > ROUTE_RULES.nameMax) {
            return { ok: false, reason: 'no_name', text: TEXTS.noName, route: null };
        }
        const trail = options?.trail ?? ctx?.routes?.trail ?? null;
        const store = options?.store ?? ctx?.routes?.store ?? null;
        if (typeof trail?.list !== 'function') {
            return { ok: false, reason: 'no_trail', text: TEXTS.noTrail, route: null };
        }
        if (typeof store?.set !== 'function') {
            return { ok: false, reason: 'no_store', text: TEXTS.noStore, route: null };
        }
        const pos = botPos(bot);
        if (!pos) {
            return { ok: false, reason: 'error', text: TEXTS.noBody, route: null };
        }
        try {
            trail.tick?.(); // the cell where the bot stands now
        } catch {
            // the steps as they are
        }
        const steps = trail.list();
        const dimension = dimensionOf(bot) ?? 'overworld';
        const known = knownThings({ places: savedPlaces(ctx, dimension), areas: listAreas(ctx, dimension), mines: knownMines(ctx, dimension) });
        const start = routeStart(steps, known);
        if (!start) {
            // fix round T1-2: the only known thing is the one where the bot stands: the way is the whole trail,
            // too short when it has fewer than 2 steps or never left that thing; no_start when no known thing is
            // at its end either
            const hits = (thing, step) => {
                try {
                    return thing.test(step) === true;
                } catch {
                    return false;
                }
            };
            const here = steps.length > 0 ? known.filter(k => hits(k, steps[steps.length - 1])) : [];
            if (here.length > 0 && (steps.length < 2 || steps.every(step => here.some(k => hits(k, step))))) {
                return { ok: false, reason: 'too_short', text: tooShortText(clean), route: null };
            }
            return { ok: false, reason: 'no_start', text: TEXTS.noStart, route: null };
        }
        const used = steps.slice(startOffLadder(steps, start.index));
        const legs = used.length < 2 ? [] : routeFromSteps(used, { faceAt: ladderFacingReader(bot) }).legs;
        if (legs.length === 0) {
            return { ok: false, reason: 'too_short', text: tooShortText(clean), route: null };
        }
        const first = feetCell(used[0]);
        const here = feetCell(pos);
        const route = {
            name: clean,
            dimension,
            from: { name: start.known.name, kind: start.known.kind, ...first },
            to: { name: clean, ...here },
            legs,
            steps: used.length,
            source: 'trail',
        };
        const existed = store.get?.(clean, dimension) != null;
        const saved = store.set(route);
        if (!saved) {
            return { ok: false, reason: 'error', text: `I could not save the way "${clean}".`, route: null };
        }
        return { ok: true, reason: null, text: rememberedText(saved, existed), route: saved };
    } catch (err) {
        console.warn('Routes pack: remembering the way failed:', err?.message ?? err);
        return { ok: false, reason: 'error', text: `I could not remember the way: ${err?.message ?? err}`, route: null };
    }
}

/**
 * The text of !routes (A3): `I know 2 routes: "bed" from the place "storage" to (12, 45, 8), 7 steps; ...`
 * or `I know no routes.` The first argument is ctx (with routes.store) or the RouteStore. Never throws.
 * @param {object} ctx
 * @param {string} [dimension] all routes without one
 * @returns {string}
 */
export function routesText(ctx, dimension) {
    try {
        const store = storeOf(ctx);
        return routeListText(store ? store.list(dimension ?? undefined) : []);
    } catch {
        return TEXTS.noRoutes;
    }
}

/**
 * !forgetRoute (A3): `Forgot the route "bed".` or `I know no route "bed".` (reason unknown). The first
 * argument is ctx (with routes.store) or the RouteStore. Never throws.
 * @param {object} ctx
 * @param {string} name
 * @param {string} [dimension] the overworld without one
 * @returns {{ok: boolean, reason: string|null, text: string}}
 */
export function forgetRoute(ctx, name, dimension) {
    const clean = normalizeRouteName(name) ?? '';
    try {
        const store = storeOf(ctx);
        if (clean && store?.remove(clean, dimension)) {
            return { ok: true, reason: null, text: forgotText(clean) };
        }
        return { ok: false, reason: 'unknown', text: noRouteText(clean) };
    } catch (err) {
        console.warn('Routes pack: forgetting the route failed:', err?.message ?? err);
        return { ok: false, reason: 'error', text: noRouteText(clean) };
    }
}

/**
 * The routes on the context (I4): { store, trail, walkRoute(bot, route, options), walkTo(bot, target,
 * options), routeFor(target, options), logic }. `logic` holds the pure functions for the mining pack
 * (skyStart, routeFromSteps with the faces of the ladders read from the world, routeStart, reverseRoute,
 * routeEnds, legCells, nearestRoute). ctx is used for its clock and log only; ctx.routes is never read.
 * No timer, no listener.
 * @param {object} bot
 * @param {object} ctx
 * @param {object} store the RouteStore of the world
 * @param {object} trail the trail of createTrail
 * @returns {object}
 */
export function bindRoutes(bot, ctx, store, trail) {
    const routesOf = (b) => {
        try {
            const list = store?.list?.(dimensionOf(b ?? bot) ?? 'overworld');
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    };
    return {
        store: store ?? null,
        trail: trail ?? null,
        walkRoute: (b, route, options = {}) => walkRoute(b ?? bot, ctx, route, options),
        walkTo: (b, target, options = {}) => walkByRoute(b ?? bot, ctx, routesOf(b), target, options),
        routeFor: (target, options = {}) => {
            const pos = botPos(bot);
            return pos ? nearestRoute(routesOf(bot), target, pos, options) : null;
        },
        logic: {
            skyStart,
            routeFromSteps: (steps, options = {}) => routeFromSteps(steps, { faceAt: ladderFacingReader(bot), ...options }),
            routeStart,
            reverseRoute,
            routeEnds,
            legCells,
            nearestRoute,
        },
    };
}
