// v0.1.4.11 (part W, spec W4 and W5): the texts of goToSurface and giveToPlayer of skills.js, word for word, so that
// unit tests read them. skills.js exports only functions with their docs (the code model reads them), so the texts
// live here. Pure: no imports.

// `(10, 67, 52)` with block coordinates.
function cellText(p) {
    return `(${Math.floor(p?.x)}, ${Math.floor(p?.y)}, ${Math.floor(p?.z)})`;
}

/** The texts of goToSurface (W4). */
export const SURFACE_TEXTS = Object.freeze({
    already: () => 'I am under the open sky already.',
    door: (kind, door, at) => `I went out through the ${kind === 'gate' ? 'gate' : 'door'} at ${cellText(door)} and stand under the open sky at ${cellText(at)}.`,
    climbed: (at) => `I climbed to the open sky at ${cellText(at)}.`,
    noWay: (from) => `I find no way to the open sky from ${cellText(from)}.`,
});

/** The texts of giveToPlayer (W5). */
export const GIVE_TEXTS = Object.freeze({
    given: (count, item, username) => `Gave ${count} ${item} to ${username}.`,
    partly: (username, taken, count, item, at) =>
        `${username} took ${taken} of ${count} ${item}; ${count - taken} ${count - taken === 1 ? 'lies' : 'lie'} on the ground at ${cellText(at)}.`,
});
