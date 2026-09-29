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

/**
 * Where the bot is: { area: { name, type } | null, depth, underground }. underground is true when the
 * bot is more than 8 blocks under the ground around it, or inside an area of type mine. Never throws.
 * @param {object} bot
 * @param {number} [now]
 * @returns {{area: {name: string, type: string|null}|null, depth: number, underground: boolean}}
 */
export function whereAmI(bot, now = Date.now()) {
    try {
        const pos = bot?.entity?.position;
        if (!pos)
            return { area: null, depth: 0, underground: false };
        const area = areaAt(bot, pos);
        const depth = depthOfBot(bot, now);
        return { area, depth, underground: isUnderground(depth) || area?.type === 'mine' };
    } catch {
        return { area: null, depth: 0, underground: false };
    }
}
