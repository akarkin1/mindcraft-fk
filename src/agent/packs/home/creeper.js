// The creeper procedure on the real bot (spec v0.1.4.6 H6). decide() of creeper_logic.js says what
// to do, this module reads the surroundings and moves the bot. It never uses bot.pvp for a
// creeper, because that walks up to the target and stays there.
import { Vec3 } from 'vec3';
import { distanceToBox } from './box_math.js';
import { botPos, clockOf, dimensionOf, entitiesWhere, isUnderground, listAreas, logTo, pauseMode } from './context.js';
import { CREEPER_RULES, CreeperWatch, decide, lineOfSight } from './creeper_logic.js';
import { readHomeSettings } from './home_settings.js';
import { goals, makeMovements, stopMoving } from './motion.js';
import { isHostileForShelter } from './night_logic.js';
import { TEXTS, luredText } from './texts.js';

/** Swords of stone or better, best first. */
export const FIGHT_SWORDS = Object.freeze(['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword']);
/** Lure attempts are forgotten after this long without a creeper. */
export const TRIES_RESET_MS = 120000;

const memories = new WeakMap();

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/**
 * What the procedure remembers per bot: `tries` (runs that had to lure a creeper away from an area),
 * `lastSeen` (ms of the last step other than none), `lastHelp` (ms the help text was given), `watch`
 * (a CreeperWatch: recent creeper positions, attention tries and creepers that stand, F3).
 * @param {object} bot
 * @returns {{tries: number, lastSeen: number, lastHelp: number, watch: CreeperWatch}}
 */
export function creeperMemory(bot) {
    let memory = memories.get(bot);
    if (!memory) {
        memory = { tries: 0, lastSeen: 0, lastHelp: 0, watch: new CreeperWatch() };
        memories.set(bot, memory);
    }
    return memory;
}

/** The eyes of the bot are this high above its feet. */
const EYE_HEIGHT = 1.62;

// true for a solid block, false for a free one, null for a block that is not loaded
function solidReader(bot) {
    return (x, y, z) => {
        const block = bot.blockAt(new Vec3(x, y, z));
        if (!block) {
            return null;
        }
        return block.boundingBox === 'block';
    };
}

/**
 * True when no solid block lies between the eyes of the bot and the middle of the entity (v0.1.4.8,
 * C3). A block that is not loaded blocks the sight. Never throws.
 * @param {object} bot
 * @param {object} entity
 * @returns {boolean}
 */
export function inSight(bot, entity) {
    try {
        const me = botPos(bot);
        const p = entity?.position;
        if (!me || !p) {
            return false;
        }
        const height = typeof entity.height === 'number' && Number.isFinite(entity.height) ? entity.height : 1.7;
        return lineOfSight({ x: me.x, y: me.y + EYE_HEIGHT, z: me.z }, { x: p.x, y: p.y + height / 2, z: p.z }, solidReader(bot));
    } catch {
        return false;
    }
}

/**
 * The creepers within range of the bot, nearest first, as { id, pos, fuse, dBot, dy, sight, entity }
 * (v0.1.4.8, C3: dBot the distance to the bot, dy the creeper y minus the bot y, sight see inSight).
 * The fuse burns while metadata[16] is 1. Never throws.
 * @param {object} bot
 * @param {number} [range]
 * @returns {{id: *, pos: {x,y,z}, fuse: boolean, dBot: number, dy: number, sight: boolean, entity: object}[]}
 */
export function readCreepers(bot, range = 24) {
    try {
        const me = botPos(bot);
        return entitiesWhere(bot, range, e => e.name === 'creeper').map(e => ({
            id: e.id,
            pos: { x: e.position.x, y: e.position.y, z: e.position.z },
            fuse: e.metadata?.[16] === 1 || e.metadata?.[16] === true,
            dBot: dist(me, e.position),
            dy: e.position.y - me.y,
            sight: inSight(bot, e),
            entity: e,
        }));
    } catch {
        return [];
    }
}

function bestSword(bot) {
    const items = bot?.inventory?.items?.() ?? [];
    for (const name of FIGHT_SWORDS) {
        const item = items.find(i => i?.name === name);
        if (item) {
            return item;
        }
    }
    return null;
}

/**
 * May the bot fight a creeper? A sword of stone or better, health at least 15, no other hostile
 * mob within 16 blocks, no area within 16 blocks. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @returns {boolean}
 */
export function canFightCreeper(bot, ctx) {
    try {
        const pos = botPos(bot);
        if (!pos || !bestSword(bot) || !(isFiniteNumber(bot.health) && bot.health >= 15)) {
            return false;
        }
        if (entitiesWhere(bot, 16, e => isHostileForShelter(e) && e.name !== 'creeper').length > 0) {
            return false;
        }
        return !listAreas(ctx, dimensionOf(bot)).some(area => distanceToBox(area, pos) <= 16);
    } catch {
        return false;
    }
}

function buildState(bot, ctx, now, memory) {
    const pos = botPos(bot);
    const creepers = readCreepers(bot, 24);
    const areas = pos ? listAreas(ctx, dimensionOf(bot)).filter(area => distanceToBox(area, pos) <= CREEPER_RULES.areaRange) : [];
    const fighting = readHomeSettings(ctx?.settings).creeper_fighting;
    const facts = memory.watch.observe(creepers, pos, now); // F3: following, attention tries, standing
    return {
        botPos: pos,
        creepers,
        areas,
        fighting,
        canFight: fighting && creepers.length > 0 ? canFightCreeper(bot, ctx) : false,
        tries: memory.tries,
        fuseBurning: false,
        now,
        following: facts.following,
        attention: facts.attention,
        attending: facts.attending,
        standing: facts.standing,
        underground: creepers.length > 0 && isUnderground(ctx), // C3: ctx.whereAmI of the glue; without it the surface
    };
}

/**
 * decide() on the real surroundings of the bot: creepers within 24 blocks with their height and sight,
 * areas within 48, whether the bot is underground (ctx.whereAmI), the setting creeper_fighting,
 * canFightCreeper and the lure attempts of creeperMemory. For the mode creeper_safety: a step other
 * than 'none' means runCreeperProcedure should run. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @returns {object} the result of decide
 */
export function creeperCheck(bot, ctx) {
    try {
        if (!bot) {
            return decide(null);
        }
        const now = clockOf(ctx).now();
        const memory = creeperMemory(bot);
        if (now - memory.lastSeen > TRIES_RESET_MS) {
            memory.tries = 0;
        }
        return decide(buildState(bot, ctx, now, memory));
    } catch (err) {
        console.warn('Home pack: the creeper check failed:', err?.message ?? err);
        return decide(null);
    }
}

function isAlive(bot, entity) {
    return entity && entity.isValid !== false && bot.entities?.[entity.id] === entity;
}

// One hit, then back beyond 6 blocks. Aborts the approach when the fuse burns.
async function hitAndRetreat(bot, entity, clock, sprint) {
    const sword = bestSword(bot);
    if (sword) {
        try {
            await bot.equip(sword, 'hand');
        } catch {
            // fight with what is in the hand
        }
    }
    bot.pathfinder.setMovements(sprint);
    bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
    let hit = false;
    let start = clock.now();
    while (clock.now() - start < 4000 && !bot.interrupt_code && isAlive(bot, entity)) {
        if (entity.metadata?.[16] === 1) {
            break;
        }
        if (dist(botPos(bot), entity.position) <= 3) {
            try {
                bot.attack(entity);
                hit = true;
            } catch (err) {
                console.warn('Home pack: the hit failed:', err?.message ?? err);
            }
            break;
        }
        await clock.wait(50);
    }
    if (isAlive(bot, entity)) {
        bot.pathfinder.setGoal(new goals.GoalInvert(new goals.GoalFollow(entity, 7)), true);
        start = clock.now();
        while (clock.now() - start < 4000 && !bot.interrupt_code && isAlive(bot, entity)
            && dist(botPos(bot), entity.position) <= 6) {
            await clock.wait(50);
        }
    }
    stopMoving(bot);
    return hit;
}

/**
 * Runs the creeper procedure: calls decide every 400 ms and sets the goal of the pathfinder (walking
 * while it lures, sprinting while it backs off or runs; never opening a door). Ends when decide says
 * none twice in a row, after 90 seconds, or when interrupted. Fighting: one hit with bot.attack,
 * then back beyond 6 blocks, again until the creeper is gone. The mode `unstuck` is paused, because
 * the bot stands still while it waits for the creeper.
 * @param {object} bot
 * @param {object} ctx { areas, settings, log, now }
 * @param {{tickMs?: number, maxMs?: number, now?: Function, wait?: Function}} [options]
 * A creeper that does not follow ends it with leave_it (ok, Amendment 2 F3).
 * @returns {Promise<{ok: boolean, steps: string[], text: string, reason: string}>}
 *   reason: none (the creeper is gone), leave_it (it stands), timeout, interrupted, error
 */
export async function runCreeperProcedure(bot, ctx = {}, options = {}) {
    if (!bot || typeof bot !== 'object') {
        return { ok: false, steps: [], text: 'I cannot move.', reason: 'error' };
    }
    const clock = clockOf(ctx, options);
    const tickMs = isFiniteNumber(options.tickMs) ? options.tickMs : 400;
    const maxMs = isFiniteNumber(options.maxMs) ? options.maxMs : 90000;
    const memory = creeperMemory(bot);
    const start = clock.now();
    if (start - memory.lastSeen > TRIES_RESET_MS) {
        memory.tries = 0;
    }
    const steps = [];
    let lured = null;
    let helped = false;
    let fought = false;
    let standingText = null;
    let noneCount = 0;
    let end = 'timeout';
    let current = null;
    let walk = null;
    let sprint = null;
    memory.watch.startRun();
    pauseMode(bot, 'unstuck');
    try {
        walk = makeMovements(bot, { dig: false, doors: false, sprint: false });
        sprint = makeMovements(bot, { dig: false, doors: false, sprint: true });
        for (;;) {
            if (bot.interrupt_code) {
                end = 'interrupted';
                break;
            }
            if (clock.now() - start >= maxMs) {
                end = 'timeout';
                break;
            }
            const state = buildState(bot, ctx, clock.now(), memory);
            const d = decide(state);
            memory.watch.note(d, clock.now());
            if (d.step === 'leave_it') {
                // F3: the creeper stands and does not follow; it is left alone for 60 s
                steps.push(d.step);
                memory.lastSeen = clock.now();
                standingText = d.text;
                end = 'leave_it';
                break;
            }
            if (d.step === 'none') {
                noneCount++;
                if (noneCount >= 2 || steps.length === 0) {
                    end = 'none';
                    break;
                }
                if (current !== 'none') {
                    stopMoving(bot);
                    current = 'none';
                }
                await clock.wait(tickMs);
                continue;
            }
            noneCount = 0;
            memory.lastSeen = clock.now();
            if (steps[steps.length - 1] !== d.step) {
                steps.push(d.step);
            }
            if (d.step === 'lure' && d.area) {
                lured = d.area;
            }
            if (d.step === 'help' && !helped) {
                helped = true;
                memory.lastHelp = clock.now();
                logTo(ctx, d.text);
            }
            if (d.step === 'fight') {
                const target = state.creepers.find(c => c.id === d.creeper)?.entity;
                if (target) {
                    fought = true;
                    await hitAndRetreat(bot, target, clock, sprint);
                    current = null;
                }
                await clock.wait(Math.min(tickMs, 100));
                continue;
            }
            current = applyMove(bot, d, current, walk, sprint);
            await clock.wait(tickMs);
        }
    } catch (err) {
        console.warn('Home pack: the creeper procedure failed:', err?.message ?? err);
        end = 'error';
    } finally {
        stopMoving(bot);
    }
    if (lured && end !== 'leave_it') {
        memory.tries += 1; // a creeper that stands is no lure try (F3)
    }
    if (end === 'leave_it') {
        logTo(ctx, standingText);
        return { ok: true, steps, text: standingText, reason: end };
    }
    return { ok: end === 'none', steps, text: resultText(end, steps, { lured, helped, fought }), reason: end };
}

function applyMove(bot, d, current, walk, sprint) {
    const me = botPos(bot);
    const target = d.moveTo;
    if (!target || !me || d.reason === 'wait' || Math.hypot(target.x - me.x, target.z - me.z) < 1) {
        if (current !== 'wait') {
            stopMoving(bot);
        }
        return 'wait';
    }
    const same = current && typeof current === 'object' && current.step === d.step && current.sprint === d.sprint
        && Math.hypot(current.target.x - target.x, current.target.z - target.z) <= 3;
    if (same) {
        return current;
    }
    if (!current || typeof current !== 'object' || current.sprint !== d.sprint) {
        bot.pathfinder.setMovements(d.sprint ? sprint : walk);
    }
    bot.pathfinder.setGoal(new goals.GoalNearXZ(target.x, target.z, 1));
    return { step: d.step, sprint: d.sprint, target };
}

function resultText(end, steps, { lured, helped, fought }) {
    if (helped) {
        return TEXTS.creeperHelp;
    }
    if (end === 'none') {
        if (steps.length === 0) {
            return 'No creeper is near me.';
        }
        if (lured) {
            return luredText(lured);
        }
        return fought ? 'I fought a creeper and it is gone.' : TEXTS.backedOff;
    }
    if (end === 'interrupted') {
        return 'I stopped keeping away from the creeper.';
    }
    if (end === 'timeout') {
        return 'A creeper is still near me after 90 seconds. I keep away from it and from the buildings.';
    }
    return 'Something went wrong while I kept away from a creeper.';
}
