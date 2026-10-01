// Texts of the routes pack that the player or the model reads. The spec v0.1.4.9 A2, A3 and I3 gives
// them word for word, tests compare them. Pure.
import { legCounts } from './route_logic.js';

/** Fixed texts. */
export const TEXTS = Object.freeze({
    noStart: 'I do not know where this way starts. Stand at a place I know first, then walk with me and tell me again.',
    noRoutes: 'I know no routes.',
    noTrail: 'I have no trail. The routes pack is off.',
    noStore: 'I cannot remember ways in this world.',
    noName: 'Tell me a name for the way.',
    noBody: 'I cannot see where I am.',
});

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * `(12, 45, 8)` with block coordinates.
 * @param {{x: number, y: number, z: number}} pos
 * @returns {string}
 */
export function posText(pos) {
    const c = v => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : v);
    return `(${c(pos?.x)}, ${c(pos?.y)}, ${c(pos?.z)})`;
}

/**
 * `the place "storage"`, `the area "home"`, `the mine "mine"`; a start without a name: `(30, 41, 4)`.
 * @param {{name?: string|null, kind?: string|null, x?: number, y?: number, z?: number}} from
 * @returns {string}
 */
export function startText(from) {
    const kinds = { place: 'the place', area: 'the area', mine: 'the mine' };
    if (typeof from?.name === 'string' && from.name.length > 0 && kinds[from.kind]) {
        // v0.1.4.9, F18: the start in an area names its level: `the area "home", level 67`
        const level = from.kind === 'area' ? from.name.match(/^(.*), level (-?\d+)$/) : null;
        return level ? `${kinds.area} "${level[1]}", level ${level[2]}` : `${kinds[from.kind]} "${from.name}"`;
    }
    return posText(from);
}

/**
 * `7 steps, 1 ladder, 1 trapdoor`: the number of legs, then ladders, doors, gates and trapdoors when present.
 * @param {object[]} legs
 * @returns {string}
 */
export function legsText(legs) {
    const n = legCounts(legs);
    const parts = [plural(n.legs, 'step')];
    for (const kind of ['ladder', 'door', 'gate', 'trapdoor']) {
        if (n[kind] > 0) {
            parts.push(plural(n[kind], kind));
        }
    }
    return parts.join(', ');
}

/**
 * `I remember the way "bed": from the place "storage" to here, 7 steps, 1 ladder, 1 trapdoor. I walk it in
 * both directions.` With `replaced`, `I know a way "bed" already. I replace it.` comes first.
 * @param {object} route
 * @param {boolean} [replaced]
 * @returns {string}
 */
export function rememberedText(route, replaced = false) {
    const text = `I remember the way "${route?.name}": from ${startText(route?.from)} to here, ${legsText(route?.legs)}. I walk it in both directions.`;
    return replaced ? `${replacedText(route?.name)} ${text}` : text;
}

/**
 * `I know a way "bed" already. I replace it.`
 * @param {string} name
 * @returns {string}
 */
export function replacedText(name) {
    return `I know a way "${name}" already. I replace it.`;
}

/**
 * `I need 1 ladder at (8, 42, 47) to climb out.`, `I need 2 ladders at (8, 41, 47) and (8, 42, 47) to climb out.`
 * (v0.1.4.9, F22b), the cells from the lowest.
 * @param {{x,y,z}[]} cells
 * @returns {string}
 */
export function needLaddersText(cells) {
    const list = (Array.isArray(cells) ? cells : []).slice().sort((a, b) => a.y - b.y).map(posText);
    const where = list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    return `I need ${plural(list.length, 'ladder')} at ${where} to climb out.`;
}

/**
 * `I saved the place "basement" there too.` (v0.1.4.9, F19)
 * @param {string} name
 * @returns {string}
 */
export function placeSavedText(name) {
    return `I saved the place "${name}" there too.`;
}

/**
 * `The way "bed" is too short: I stand where it starts.`
 * @param {string} name
 * @returns {string}
 */
export function tooShortText(name) {
    return `The way "${name}" is too short: I stand where it starts.`;
}

/**
 * `"bed" from the place "storage" to (12, 45, 8), 7 steps`
 * @param {object} route
 * @returns {string}
 */
export function routeLineText(route) {
    const n = Array.isArray(route?.legs) ? route.legs.length : 0;
    return `"${route?.name}" from ${startText(route?.from)} to ${posText(route?.to)}, ${plural(n, 'step')}`;
}

/**
 * `I know 2 routes: "bed" from the place "storage" to (12, 45, 8), 7 steps; "mine" from the area "home" to
 * (30, 41, 4), 12 steps.` or `I know no routes.`
 * @param {object[]} routes
 * @returns {string}
 */
export function routeListText(routes) {
    const list = Array.isArray(routes) ? routes : [];
    if (list.length === 0) {
        return TEXTS.noRoutes;
    }
    return `I know ${plural(list.length, 'route')}: ${list.map(routeLineText).join('; ')}.`;
}

/**
 * `Forgot the route "bed".`
 * @param {string} name
 * @returns {string}
 */
export function forgotText(name) {
    return `Forgot the route "${name}".`;
}

/**
 * `I know no route "bed".`
 * @param {string} name
 * @returns {string}
 */
export function noRouteText(name) {
    return `I know no route "${name}".`;
}

/**
 * `the route "bed"`, or `the route` for a route without a name.
 * @param {object} route
 * @returns {string}
 */
export function routeLabel(route) {
    return typeof route?.name === 'string' && route.name.length > 0 ? `the route "${route.name}"` : 'the route';
}

/**
 * `I could not follow the route "bed" at step 3 of 7, at (12, 45, 8). Show me the way again.`
 * @param {object} route
 * @param {number} step 1 for the first leg walked
 * @param {number} total
 * @param {{x,y,z}|null} at
 * @returns {string}
 */
export function routeFailedText(route, step, total, at) {
    const where = at ? `, at ${posText(at)}` : '';
    return `I could not follow ${routeLabel(route)} at step ${step} of ${total}${where}. Show me the way again.`;
}

/**
 * `I was stopped on the route "bed" at step 3 of 7.`
 * @param {object} route
 * @param {number} step
 * @param {number} total
 * @returns {string}
 */
export function routeStoppedText(route, step, total) {
    return `I was stopped on ${routeLabel(route)} at step ${step} of ${total}.`;
}

/**
 * `The time for the route "bed" ran out at step 3 of 7, at (12, 45, 8).`
 * @param {object} route
 * @param {number} step
 * @param {number} total
 * @param {{x,y,z}|null} at
 * @returns {string}
 */
export function routeTimeText(route, step, total, at) {
    const where = at ? `, at ${posText(at)}` : '';
    const label = routeLabel(route);
    return `The time for ${label} ran out at step ${step} of ${total}${where}.`;
}

/**
 * `I could not follow the route "bed" at step 3 of 7: <error>`
 * @param {object} route
 * @param {number} step
 * @param {number} total
 * @param {*} err
 * @returns {string}
 */
export function routeErrorText(route, step, total, err) {
    const message = typeof err === 'string' ? err : (typeof err?.message === 'string' ? err.message : 'unknown error');
    return `I could not follow ${routeLabel(route)} at step ${step} of ${total}: ${message}`;
}

/**
 * `I followed the route "bed", 7 steps.`
 * @param {object} route
 * @param {number} total
 * @returns {string}
 */
export function routeDoneText(route, total) {
    return `I followed ${routeLabel(route)}, ${plural(total, 'step')}.`;
}

/**
 * `The route "bed" has no steps.`
 * @param {object} route
 * @returns {string}
 */
export function emptyRouteText(route) {
    const label = routeLabel(route);
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} has no steps.`;
}

/**
 * `I found no way to the start of the route "bed" at (30, 41, 4).`
 * @param {object} route
 * @param {{x,y,z}} start
 * @returns {string}
 */
export function noWayToStartText(route, start) {
    return `I found no way to the start of ${routeLabel(route)} at ${posText(start)}.`;
}

/**
 * `I was stopped on my way to the route "bed".`
 * @param {object} route
 * @returns {string}
 */
export function stoppedBeforeRouteText(route) {
    return `I was stopped on my way to ${routeLabel(route)}.`;
}
