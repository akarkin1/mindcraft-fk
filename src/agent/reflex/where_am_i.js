// Where the bot is: the saved area that holds it and its depth under the ground (spec v0.1.4.8, I2).
// The modes use it directly; part G binds it as agent.whereAmI(). Never throws.
import { Vec3 } from 'vec3';
import { depthUnderGround, isUnderground } from './ground_logic.js';

const CACHE_MS = 1000; // the depth of the same block position is read again after this time
const depths = new WeakMap(); // bot -> { key, at, depth }

/**
 * The smallest saved area that holds pos, as { name, type }, from bot.areaGuard.areaAt; null when there
 * is none or no guard. Never throws.
 * @param {object} bot
 * @param {{x,y,z}} pos
 * @returns {{name: string, type: string|null}|null}
 */
export function areaAt(bot, pos) {
    try {
        const area = bot?.areaGuard?.areaAt?.(pos);
        if (!area || typeof area.name !== 'string')
            return null;
        return { name: area.name, type: typeof area.type === 'string' ? area.type : null };
    } catch {
        return null;
    }
}

/**
 * A reader of block names for the pure modules: (x, y, z) => name, or null for a block that is not
 * loaded or cannot be read.
 * @param {object} bot
 * @returns {Function}
 */
export function blockNameReader(bot) {
    return (x, y, z) => {
        try {
            const name = bot.blockAt(new Vec3(x, y, z))?.name;
            return typeof name === 'string' ? name : null;
        } catch {
            return null;
        }
    };
}

/**
 * The depth of the feet of the bot under the ground around it (depthUnderGround), read from the world
 * of the bot. The same block position is read at most once per second. 0 when it cannot be read.
 * @param {object} bot
 * @param {number} [now]
 * @returns {number}
 */
export function depthOfBot(bot, now = Date.now()) {
    try {
        const pos = bot.entity.position;
        const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
        const cached = depths.get(bot);
        if (cached && cached.key === key && now - cached.at >= 0 && now - cached.at < CACHE_MS)
            return cached.depth;
        const minY = Number.isFinite(bot.game?.minY) ? bot.game.minY : -64;
        const height = Number.isFinite(bot.game?.height) ? bot.game.height : 384;
        const depth = depthUnderGround(blockNameReader(bot), pos, minY + height, minY);
        depths.set(bot, { key, at: now, depth });
        return depth;
    } catch {
        return 0;
    }
}

// v0.1.4.9, I7: the mine the glue found for the position of the bot (mineAt of the mining pack), or null.
function mineOf(extra) {
    try {
        const mine = extra && typeof extra === 'object' ? extra.mine : null;
        return mine && typeof mine === 'object' ? mine : null;
    } catch {
        return null;
    }
}

/**
 * Where the bot is: { area: { name, type } | null, depth, underground, mine }. underground is true when
 * the bot is more than 8 blocks under the ground around it, inside an area of type mine, or in a mine
 * (v0.1.4.9, I7: extra.mine, which the glue computes from mineAt with mine_routes; its room, its
 * tunnels and its route). mine is extra.mine, { name, tunnel, level }, or null; a caller without extra
 * gets mine null and the rest as in v0.1.4.8. Never throws.
 * @param {object} bot
 * @param {number} [now]
 * @param {{mine?: {name: string|null, tunnel: number|null, level: number}|null}} [extra]
 * @returns {{area: {name: string, type: string|null}|null, depth: number, underground: boolean,
 *   mine: {name: string|null, tunnel: number|null, level: number}|null}}
 */
export function whereAmI(bot, now = Date.now(), extra = {}) {
    const mine = mineOf(extra);
    try {
        const pos = bot?.entity?.position;
        if (!pos)
            return { area: null, depth: 0, underground: mine !== null, mine };
        const area = areaAt(bot, pos);
        const depth = depthOfBot(bot, now);
        return { area, depth, underground: isUnderground(depth) || area?.type === 'mine' || mine !== null, mine };
    } catch {
        return { area: null, depth: 0, underground: mine !== null, mine };
    }
}
