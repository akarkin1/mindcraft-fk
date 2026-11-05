// v0.1.4.14 (W116 on 26.1, engineer E4): the reservations of the openables that the approach toward a player opened
// (openTowardPlayer of skills.js), handed back to the door service when the bot has passed them. Never throws.
import { releaseDoor } from '../packs/home/doors.js';
import { sideOf } from '../packs/home/door_logic.js';

// v0.1.4.14 (W116 on 26.1): the openables openTowardPlayer opened and reserved, per bot, with the side of the bot at
// the time. The reservation keeps the door service from closing them before the bot passes; the walk ends it (I8):
// the follow released none, so the gate of a pen it had opened stayed reserved for 20 s and, with the bot standing
// 1.1 blocks inside it, for as long as it stood there (the 1.5 blocks that hold a reservation on), and the chickens
// walked out. releasePassedToward hands each one back once the bot is on its other side (passed: the service closes
// it by its rules, a gate as soon as the feet are out of its cell), and all of them when the walk ends.
const towardReserved = new WeakMap();

/**
 * Notes an openable openTowardPlayer opened and reserved, with the side of the bot then (sideOf: -1, 0 or 1).
 * @param {object} bot
 * @param {{x,y,z,kind,facing}} door
 * @param {number} side
 */
export function noteTowardReserved(bot, door, side) {
    try {
        if (!towardReserved.has(bot))
            towardReserved.set(bot, new Map());
        towardReserved.get(bot).set(`${door.x},${door.y},${door.z}`, { door: { ...door }, side });
    } catch (err) {
        // the reservation runs out by itself
    }
}

/**
 * Hands back the reservations of openTowardPlayer the bot has passed: it stands on the other side of the door or gate
 * than when it opened it (releaseDoor with passed: the service closes it by its rules). With `all` every one (the walk
 * ended), each as passed or not by the same rule. Returns the number handed back.
 * @param {object} bot
 * @param {boolean} [all]
 * @returns {number}
 */
export function releasePassedToward(bot, all = false) {
    try {
        const list = towardReserved.get(bot);
        if (!list || list.size === 0)
            return 0;
        const me = bot.entity?.position;
        let released = 0;
        for (const [key, r] of [...list]) {
            const side = me ? sideOf(r.door, me) : 0;
            const passed = side !== 0 && r.side !== 0 && side !== r.side;
            if (passed || all) {
                releaseDoor(bot, r.door, { passed });
                list.delete(key);
                released++;
            }
        }
        return released;
    } catch (err) {
        return 0;
    }
}
