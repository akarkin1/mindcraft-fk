// v0.1.4.14 (engineer E1, P-17, spec 8.1.3): the marks of the day and which of them the clock crossed since the last
// time event. The clock of 26.1 runs between packets (patches/mineflayer+4.39.0.patch, time.js) and the time event comes
// every 20 ticks, so a listener that compared the exact values (`== 0`, `6000`, `12000`, `18000`) would miss a sunrise
// or double it. Pure.

export const DAY_TICKS = 24000;

/** The marks of the day, by the event the agent emits for them. */
export const DAY_MARKS = Object.freeze({ sunrise: 0, noon: 6000, sunset: 12000, midnight: 18000 });

/** A step of half a day or more forward is a jump (`time set`), not the clock running. */
export const JUMP_TICKS = DAY_TICKS / 2;

/**
 * v0.1.4.16 (F8, the play of 2026-11-11: the model said night by day): the one clock of the prompt's line, the full
 * state, the watch and isNight. The parts of the day and the first tick of each.
 */
export const DAY_PHASES = Object.freeze({ morning: 0, afternoon: 6000, evening: 12000, night: 13000, dawn: 23000 });

/** F8: the labels of the parts of the day, as !stats, the full state and the watch say them. */
export const PHASE_LABELS = Object.freeze({ morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night', dawn: 'Dawn' });

/**
 * F8: the part of the day: `morning` 0 to 5999, `afternoon` 6000 to 11999, `evening` 12000 to 12999, `night` 13000 to
 * 22999, `dawn` 23000 to 23999; null without a finite time.
 * @param {number} timeOfDay bot.time.timeOfDay
 * @returns {'morning'|'afternoon'|'evening'|'night'|'dawn'|null}
 */
export function dayPhase(timeOfDay) {
    const t = tickOfDay(timeOfDay);
    if (t === null)
        return null;
    if (t < DAY_PHASES.afternoon)
        return 'morning';
    if (t < DAY_PHASES.evening)
        return 'afternoon';
    if (t < DAY_PHASES.night)
        return 'evening';
    if (t < DAY_PHASES.dawn)
        return 'night';
    return 'dawn';
}

/**
 * F8: the label of the part of the day (PHASE_LABELS), `unknown` without a finite time.
 * @param {number} timeOfDay
 * @param {string} [unknown]
 * @returns {string}
 */
export function dayPhaseLabel(timeOfDay, unknown = 'Unknown') {
    const phase = dayPhase(timeOfDay);
    return phase === null ? unknown : PHASE_LABELS[phase];
}

function tickOfDay(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    return ((Math.floor(value) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
}

/**
 * The events for the marks crossed from `prev` to `now` (ticks of the day), in the order crossed: the marks in
 * (prev, now], with the wrap at 24000 (23990 to 10 crosses 0). Without `prev` (the first event), on a jump (a step
 * of JUMP_TICKS or more forward, as `time set` makes) or when the clock did not move: the mark `now` stands on
 * exactly, as the old rule said, else nothing.
 * @param {number|null} prev the time of day at the last event, or null
 * @param {number} now the time of day now
 * @returns {string[]} 'sunrise', 'noon', 'sunset' or 'midnight'
 */
export function crossedMarks(prev, now) {
    const to = tickOfDay(now);
    if (to === null)
        return [];
    const from = tickOfDay(prev);
    const exact = Object.entries(DAY_MARKS).filter(([, tick]) => tick === to).map(([name]) => name);
    if (from === null || from === to)
        return exact;
    const forward = (to - from + DAY_TICKS) % DAY_TICKS;
    if (forward >= JUMP_TICKS)
        return exact;
    const out = [];
    for (const [name, tick] of Object.entries(DAY_MARKS)) {
        const ahead = (tick - from + DAY_TICKS) % DAY_TICKS; // how far the mark lies ahead of `from`
        if (ahead > 0 && ahead <= forward)
            out.push([ahead, name]);
    }
    return out.sort((a, b) => a[0] - b[0]).map(([, name]) => name);
}
