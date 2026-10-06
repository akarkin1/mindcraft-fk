// What the bot leaves on the ground, per bot (v0.1.4.13, part Q, SPEC 4.6 Q5 and Q6): the items it tossed itself for a
// give, the drops of a player's death, and the armour rule: armour the bot picked up from the ground is never put on
// by itself. The rules are pure in drop_logic.js; this file keeps the state of each bot and its listeners. Nothing here
// throws into the bot.
//
// The death of a player (Q6, E4 picks and documents): mineflayer has no playerDeath event. The death message of the
// server is a system message whose translation key starts with `death.` (`death.attack.genericKill` for /kill,
// `death.fell.accident.generic` for a fall ...) with the player in its first argument; the position is that player's
// entity at the time of the message (the server sends the message before it drops the items and before the player
// respawns). The `entityDead` event of mineflayer (entity status 3) for a player entity is noted too. A death of a player
// the bot does not see (no entity) is not noted: there are no drops near the bot.
import pf from 'mineflayer-pathfinder';
import { DROP_RULES, armourRank, armourSlot, deathNear, deathOf, forgetDeaths, forgetTosses, isArmourName, isTossed, mayWear,
    noteDeath, awayPoint } from './drop_logic.js';
import { isOwnDropSpawn } from './item_logic.js';

const states = new WeakMap();

function stateOf(bot) {
    let state = states.get(bot);
    if (!state) {
        state = { deaths: [], tossed: new Map(), tossing: 0, ground: new Set(), watched: false };
        states.set(bot, state);
    }
    return state;
}

function now() {
    return Date.now();
}

function positionOf(entity) {
    const p = entity?.position;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? { x: p.x, y: p.y, z: p.z } : null;
}

/**
 * Notes a death of a player at a position (also for the tests and the glue). Never throws.
 * @param {object} bot
 * @param {string} name
 * @param {{x, y, z}} at
 * @param {number} [time]
 */
export function noteDeathOf(bot, name, at, time = now()) {
    try {
        const state = stateOf(bot);
        state.deaths = noteDeath(state.deaths, name, at, time);
    } catch {
        // the drops are picked up as before
    }
}

/**
 * The deaths of the last 5 minutes of this bot.
 * @param {object} bot
 * @returns {{name: string, at: object, time: number, said: boolean}[]}
 */
export function deathsOf(bot) {
    try {
        const state = stateOf(bot);
        state.deaths = forgetDeaths(state.deaths, now());
        return state.deaths;
    } catch {
        return [];
    }
}

/**
 * Why an item on the ground is left alone (Q5, Q6): `{ why: 'tossed' }` for an item the bot tossed in the last 30 s,
 * `{ why: 'death', death }` for an item within 4 blocks of a player's death of the last 5 minutes; null otherwise.
 * Never throws.
 * @param {object} bot
 * @param {object} entity an item entity
 * @returns {{why: 'tossed'|'death', death?: object}|null}
 */
/**
 * True while a player died in the last 5 minutes within `range` blocks of the bot (the lead, after W115): the item
 * reflex then picks up nothing at all, because a walk to any item near the death passes over its drops and the
 * server gives them to the bot. Never throws.
 * @param {object} bot
 * @param {number} [range]
 * @returns {boolean}
 */
export function deathNearBot(bot, range = 8) {
    try {
        const state = states.get(bot);
        const at = positionOf(bot?.entity);
        if (!state || !at) {
            return false;
        }
        return forgetDeaths(state.deaths, now()).some(d => Math.hypot(d.at.x - at.x, d.at.y - at.y, d.at.z - at.z) <= range);
    } catch {
        return false;
    }
}

export function leftAlone(bot, entity) {
    try {
        const state = states.get(bot);
        if (!state || !entity) {
            return null;
        }
        const t = now();
        if (isTossed(forgetTosses(state.tossed, t), entity.id, t)) {
            return { why: 'tossed' };
        }
        const death = deathNear(state.deaths, positionOf(entity), t);
        return death ? { why: 'death', death } : null;
    } catch {
        return null;
    }
}

/**
 * True once per death: the text that the bot leaves the things of that death may be said now (Q6: exactly once).
 * @param {object} death a death of leftAlone
 * @returns {boolean}
 */
export function takeLeaveText(death) {
    if (!death || death.said === true) {
        return false;
    }
    death.said = true;
    return true;
}

/**
 * Q5: the items the bot tosses until `stop()` is called (and 500 ms after, for a late spawn) are noted as tossed; the
 * item reflex and pickupNearbyItems leave them for 30 s. Never throws.
 * @param {object} bot
 * @returns {() => void} stop
 */
export function startTossing(bot) {
    try {
        const state = stateOf(bot); // the tosses are noted by the watch of the bot (watchDrops), when it runs
        state.tossing++;
        let stopped = false;
        return () => {
            if (stopped) {
                return;
            }
            stopped = true;
            setTimeout(() => {
                state.tossing = Math.max(0, state.tossing - 1);
            }, 500);
        };
    } catch {
        return () => {};
    }
}

/**
 * Q6: the names of the armour the bot picked up from the ground and still carries: never put on by itself.
 * @param {object} bot
 * @returns {Set<string>}
 */
export function armourFromGround(bot) {
    const state = stateOf(bot);
    try {
        const carried = new Set((bot.inventory?.items?.() ?? []).map(i => i?.name));
        for (const name of [...state.ground]) {
            if (!carried.has(name)) {
                state.ground.delete(name);
            }
        }
    } catch {
        // the set as it is
    }
    return state.ground;
}

// Q6: the auto-equip of mineflayer-armor-manager puts on every piece of armour the bot picks up (its listener of
// playerCollect) and craftRecipe of skills.js calls its equipAll after every craft. Its listener is replaced by one
// that only notes armour picked up from the ground, and equipAll puts on only armour the bot may wear (mayWear): what it
// crafted or took from a chest, never what it picked up from the ground. Once per bot.
function armourRule(bot) {
    // the plugins are injected after the bot is made: the plugin's listener and equipAll are taken over now when they
    // exist, and at the spawn
    takeOverArmour(bot);
    if (typeof bot.once === 'function') {
        bot.once('spawn', () => takeOverArmour(bot));
    }
    bot.on('playerCollect', (collector, collected) => {
        try {
            if (!collector || (collector !== bot.entity && collector.username !== bot.username)) {
                return;
            }
            const item = typeof collected?.getDroppedItem === 'function' ? collected.getDroppedItem() : null;
            if (item && isArmourName(item.name)) {
                stateOf(bot).ground.add(item.name);
            }
        } catch {
            // nothing noted
        }
    });
}

// The plugin's listener of playerCollect leaves (it puts on what the bot picks up); its equipAll puts on only what the
// bot may wear. Again and again without harm. Never throws.
function takeOverArmour(bot) {
    try {
        for (const fn of bot.listeners?.('playerCollect') ?? []) {
            if (String(fn).includes('isArmor')) {
                bot.removeListener('playerCollect', fn);
            }
        }
    } catch {
        // the plugin's listener stays
    }
    const manager = bot.armorManager;
    if (manager && typeof manager === 'object' && manager.equipAll?.armourRule !== true) {
        manager.equipAll = async () => {
            const ground = armourFromGround(bot);
            for (const item of bot.inventory?.items?.() ?? []) {
                const slot = armourSlot(item?.name);
                if (!slot || !mayWear(item.name, ground)) {
                    continue;
                }
                try {
                    const index = { head: 5, torso: 6, legs: 7, feet: 8 }[slot];
                    const worn = bot.inventory.slots?.[index] ?? null;
                    if (!worn || armourRank(item.name) > armourRank(worn.name)) {
                        await bot.equip(item, slot);
                    }
                } catch {
                    // the next piece
                }
            }
        };
        manager.equipAll.armourRule = true;
    }
}

/**
 * Starts the watch of one bot, once (Q5, Q6): the death messages and the entityDead of players, the items the bot tosses
 * while startTossing runs, and the armour rule. Never throws.
 * @param {object} bot
 */
export function watchDrops(bot) {
    try {
        if (!bot || typeof bot.on !== 'function') {
            return;
        }
        const state = stateOf(bot);
        if (state.watched) {
            return;
        }
        state.watched = true;
        bot.on('message', (message) => {
            try {
                const name = deathOf(message, bot.username);
                const at = name ? positionOf(bot.players?.[name]?.entity) : null;
                if (at) {
                    noteDeathOf(bot, name, at);
                }
            } catch {
                // the next message
            }
        });
        bot.on('entityDead', (entity) => {
            try {
                if (entity?.type === 'player' && typeof entity.username === 'string' && entity.username !== bot.username) {
                    const at = positionOf(entity);
                    if (at) {
                        noteDeathOf(bot, entity.username, at);
                    }
                }
            } catch {
                // nothing noted
            }
        });
        bot.on('entitySpawn', (entity) => {
            try {
                if (state.tossing > 0 && entity?.name === 'item' && isOwnDropSpawn(entity.position, bot.entity?.position)) {
                    state.tossed.set(entity.id, now());
                }
            } catch {
                // the item is picked up as before
            }
        });
        armourRule(bot);
    } catch {
        // the bot works as before
    }
}

/**
 * The death drop that lies within 2 blocks (in x and z, 2 in y) of the bot and that it did not step away from yet, or null
 * (Q6: the server gives an item to whoever stands on it once its pickup delay of 2 s is over). Never throws.
 * @param {object} bot
 * @param {Set<number>} stepped the items the bot stepped away from
 * @returns {object|null} the item entity
 */
export function deathDropAtFeet(bot, stepped) {
    try {
        const me = bot.entity?.position;
        if (!me) {
            return null;
        }
        for (const entity of Object.values(bot.entities ?? {})) {
            if (entity?.name !== 'item' || !entity.position || stepped?.has(entity.id)) {
                continue;
            }
            const p = entity.position;
            if (Math.hypot(p.x - me.x, p.z - me.z) <= DROP_RULES.stepRange && Math.abs(p.y - me.y) <= 2 && leftAlone(bot, entity)?.why === 'death') {
                return entity;
            }
        }
    } catch {
        // none
    }
    return null;
}

/**
 * v0.1.4.13 fix 1: the positions of the death drops within `range` blocks of the bot. Never throws.
 * @param {object} bot
 * @param {number} [range]
 * @returns {Array<{x, y, z}>}
 */
export function deathDropsNear(bot, range = 6) {
    const out = [];
    try {
        const me = bot.entity?.position;
        if (!me)
            return out;
        for (const entity of Object.values(bot.entities ?? {})) {
            if (entity?.name !== 'item' || !entity.position)
                continue;
            const p = entity.position;
            if (Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) <= range && leftAlone(bot, entity)?.why === 'death')
                out.push({ x: p.x, y: p.y, z: p.z });
        }
    } catch {
        // none
    }
    return out;
}

/**
 * v0.1.4.13 fix 1 (W115): steps the bot `blocks` away from the middle of the death drops, without digging, at most
 * `ms`. Never throws.
 * @param {object} bot
 * @param {Array<{x, y, z}>} points
 * @param {number} [blocks]
 * @param {number} [ms]
 * @returns {Promise<void>}
 */
export async function stepAwayFromAll(bot, points, blocks = 4, ms = 2000) {
    const me = bot?.entity?.position;
    const to = awayPoint(me, points, blocks);
    if (!to)
        return;
    let timer = null;
    try {
        const movements = new pf.Movements(bot);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
        const goal = new pf.goals.GoalNear(Math.floor(to.x), Math.floor(to.y), Math.floor(to.z), 1);
        await Promise.race([
            Promise.resolve(bot.pathfinder.goto(goal)).catch(() => {}),
            new Promise(resolve => {
                timer = setTimeout(resolve, ms);
            }),
        ]);
    } catch {
        // the bot stays
    } finally {
        clearTimeout(timer);
        try {
            bot.pathfinder.setGoal(null);
        } catch {
            // nothing to stop
        }
    }
}

/**
 * Q6: steps the bot away from a point until it is `blocks` away, without digging, at most `ms`. Never throws.
 * @param {object} bot
 * @param {{x, y, z}} from
 * @param {number} [blocks]
 * @param {number} [ms]
 * @returns {Promise<void>}
 */
export async function stepAwayFrom(bot, from, blocks = 4, ms = 2000) {
    let timer = null;
    try {
        const movements = new pf.Movements(bot);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
        const goal = new pf.goals.GoalInvert(new pf.goals.GoalNear(from.x, from.y, from.z, blocks));
        await Promise.race([
            Promise.resolve(bot.pathfinder.goto(goal)).catch(() => {}),
            new Promise(resolve => {
                timer = setTimeout(resolve, ms);
            }),
        ]);
    } catch {
        // the bot stays
    } finally {
        clearTimeout(timer);
        try {
            bot.pathfinder.setGoal(null);
        } catch {
            // nothing to stop
        }
    }
}

/** The numbers of the rules, for the glue. */
export { DROP_RULES };
