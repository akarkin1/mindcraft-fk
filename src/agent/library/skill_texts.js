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
    // v0.1.4.14 (the owner's play of 2026-11-07): the count the bot gave, to the player who asked
    given: (count, item, username) => `I gave you ${count} ${item}.`,
    partly: (username, taken, count, item, at) =>
        `${username} took ${taken} of ${count} ${item}; ${count - taken} ${count - taken === 1 ? 'lies' : 'lie'} on the ground at ${cellText(at)}.`,
});

/** v0.1.4.14 (P-28, SPEC 8.4.5): the texts of boardBoat and leaveBoat, word for word. */
export const BOAT_TEXTS = Object.freeze({
    boarded: 'I boarded the boat.',
    none: 'I see no boat within 6 blocks.',
    left: 'I left the boat.',
    notIn: 'I am not in a boat.',
    // not in the spec: the boat was there, the server did not seat the bot (or let it out)
    notBoarded: (at) => `I could not board the boat at ${cellText(at)}.`,
    notLeft: 'I could not leave the boat.',
});

/** P-28, word for word: `I leave the game: you asked me to.` */
export function leaveGameText(reason) {
    return `I leave the game: ${reason}.`;
}

/** P-28: the exit note of !leaveGame (restart_context.js); the next process reads `The process ended because: left on request.` */
export const LEAVE_GAME_NOTE = 'left on request';
