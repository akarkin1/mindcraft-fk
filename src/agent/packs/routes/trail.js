// The trail of the bot (spec v0.1.4.9 I1, A1): every 100 ms (fix round 2, F8) the recorder reads the bot (position, on the
// ground, the blocks at and under the feet, the sky, the openables around the feet) and keeps a step for
// every new feet cell, the last 500. The file is <worldDir>/trail.json, { version: 1, dimension, steps },
// written at most every 5 s and at stop(); without a file the trail lives in memory only. The rules of a
// step are in trail_logic.js; this module only reads the world.
//
// Beyond the spec: a move of more than 16 blocks sideways or up between two looks (a teleport, a respawn)
// or a change of the dimension starts the trail again, so that no way crosses it.
import { Vec3 } from 'vec3';
import { readJsonSafe, writeJsonAtomic } from '../../../utils/safe_json.js';
import { botPos, clockOf, dimensionOf } from '../home/context.js';
import { TRAIL_RULES, cleanStep, isJump, nextStep } from './trail_logic.js';

/** The name of the file in the world folder. */
export const TRAIL_FILE = 'trail.json';

const FILE_VERSION = 1;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * A block as the rules of the trail read it: { name, solid, skyLight, half, facing, open }, or null when it
 * is not loaded. The sky light is passed on, but the rules do not use it (fix round 2, F5). Never throws.
 * @param {object} bot
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {{name: string, solid: boolean, skyLight: number|undefined, half: string|null, facing: string|null, open: boolean}|null}
 */
export function readBlock(bot, x, y, z) {
    try {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (!b || typeof b.name !== 'string') {
            return null;
        }
        const props = (typeof b.getProperties === 'function' ? b.getProperties() : b._properties) ?? {};
        return {
            name: b.name,
            solid: b.boundingBox === 'block',
            skyLight: b.skyLight,
            half: props.half ?? null,
            facing: props.facing ?? null,
            open: props.open === true,
        };
    } catch {
        return null;
    }
}

/**
 * A reader of blocks for the rules of the trail.
 * @param {object} bot
 * @returns {(x: number, y: number, z: number) => object|null}
 */
export function blockGetter(bot) {
    return (x, y, z) => readBlock(bot, x, y, z);
}

/**
 * A reader of the `facing` of a ladder block, for routeFromSteps (the face of a ladder leg). null for a cell
 * without a ladder. Never throws.
 * @param {object} bot
 * @returns {(x: number, y: number, z: number) => string|null}
 */
export function ladderFacingReader(bot) {
    return (x, y, z) => {
        const b = readBlock(bot, x, y, z);
        return b?.name === 'ladder' && typeof b.facing === 'string' ? b.facing : null;
    };
}

function positiveInt(value, fallback) {
    return isFiniteNumber(value) && value >= 1 ? Math.floor(value) : fallback;
}

function copyStep(step) {
    return { ...step, via: step.via ? { ...step.via } : null };
}

/**
 * The trail of the bot. `start()` looks at the bot every `intervalMs` (the interval is unref()ed), `stop()`
 * ends it and writes the file. `tick()` is one look, synchronous; it never throws. The steps of the file
 * are read at once.
 * @param {object} bot
 * @param {object} ctx { now } (the clock)
 * @param {{file?: string|null, maxSteps?: number, intervalMs?: number, saveMs?: number, now?: Function, wait?: Function}} [options]
 * @returns {{start: () => void, stop: () => void, tick: () => void, list: () => object[], clear: () => void, size: number}}
 */
export function createTrail(bot, ctx, options = {}) {
    const clock = clockOf(ctx, options);
    const file = typeof options?.file === 'string' && options.file.length > 0 ? options.file : null;
    const maxSteps = positiveInt(options?.maxSteps, TRAIL_RULES.maxSteps);
    const intervalMs = positiveInt(options?.intervalMs, TRAIL_RULES.intervalMs);
    const saveMs = isFiniteNumber(options?.saveMs) && options.saveMs >= 0 ? options.saveMs : TRAIL_RULES.saveMs;
    const getBlock = blockGetter(bot);
    let steps = [];
    let dimension = null;
    let timer = null;
    let dirty = false;
    let lastSave = -Infinity;
    let lastPos = null;
    let warned = false;

    const warnOnce = (what, err) => {
        if (!warned) {
            warned = true;
            console.warn(`Routes pack: ${what}:`, err?.message ?? err);
        }
    };

    const save = (now) => {
        lastSave = now;
        if (file === null) {
            dirty = false;
            return true;
        }
        try {
            writeJsonAtomic(file, { version: FILE_VERSION, dimension, steps }, { indent: 0 });
            dirty = false;
            return true;
        } catch (err) {
            warnOnce(`could not write the trail file ${file}`, err);
            return false;
        }
    };

    if (file !== null) {
        try {
            const result = readJsonSafe(file, { expect: 'object' });
            if (result.status === 'ok') {
                const list = Array.isArray(result.data.steps) ? result.data.steps : [];
                steps = list.map(cleanStep).filter(Boolean).slice(-maxSteps);
                dimension = typeof result.data.dimension === 'string' ? result.data.dimension : null;
                const last = steps[steps.length - 1];
                lastPos = last ? { x: last.x + 0.5, y: last.y, z: last.z + 0.5 } : null;
            } else if (result.status !== 'missing') {
                let warning = `Trail file ${file} could not be read (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo) {
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                }
                console.warn(`${warning} Starting with an empty trail.`);
            }
        } catch (err) {
            console.warn(`Trail file ${file} could not be read:`, err?.message ?? err);
            steps = [];
        }
    }

    const tick = () => {
        try {
            const pos = botPos(bot);
            if (!pos) {
                return;
            }
            const now = clock.now();
            const dim = dimensionOf(bot);
            if ((dim && dimension && dim !== dimension) || (lastPos && isJump(lastPos, pos))) {
                if (steps.length > 0) {
                    steps = [];
                    dirty = true;
                }
            }
            if (dim) {
                dimension = dim;
            }
            lastPos = pos;
            const last = steps.length > 0 ? steps[steps.length - 1] : null;
            const input = { pos, onGround: bot.entity?.onGround === true, inWater: bot.entity?.isInWater === true, t: now };
            const step = nextStep(last, input, getBlock);
            if (step) {
                steps.push(step);
                if (steps.length > maxSteps) {
                    steps = steps.slice(steps.length - maxSteps);
                }
                dirty = true;
            }
            if (dirty && now - lastSave >= saveMs) {
                save(now);
            }
        } catch (err) {
            warnOnce('the trail could not read the bot', err);
        }
    };

    return {
        start() {
            if (timer !== null) {
                return;
            }
            timer = setInterval(tick, intervalMs);
            if (typeof timer?.unref === 'function') {
                timer.unref();
            }
        },
        stop() {
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
            if (dirty) {
                save(clock.now());
            }
        },
        tick,
        list() {
            return steps.map(copyStep);
        },
        clear() {
            steps = [];
            dirty = true;
            save(clock.now());
        },
        get size() {
            return steps.length;
        },
        get running() {
            return timer !== null;
        },
        file,
        maxSteps,
    };
}
