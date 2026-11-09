// v0.1.4.14 (engineer E1, P-17, spec 8.1.3): the marks of the day and which of them the clock crossed since the last
// time event. The clock of 26.1 runs between packets (patches/mineflayer+4.39.0.patch, time.js) and the time event comes
// every 20 ticks, so a listener that compared the exact values (`== 0`, `6000`, `12000`, `18000`) would miss a sunrise
// or double it. Pure.

export const DAY_TICKS = 24000;

/** The marks of the day, by the event the agent emits for them. */
export const DAY_MARKS = Object.freeze({ sunrise: 0, noon: 6000, sunset: 12000, midnight: 18000 });

/** A step of half a day or more forward is a jump (`time set`), not the clock running. */
export const JUMP_TICKS = DAY_TICKS / 2;

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
