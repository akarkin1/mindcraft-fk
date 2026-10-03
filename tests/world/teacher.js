// The teacher of the journeys W102 to W104 (tester T3, v0.1.4.12 "Understanding and watching", PLAN.md 2.4, SPEC section
// 5): the player of the order channel (orderChannel of helpers.js) places and digs blocks himself, as the owner does, so
// that the bot under test can watch him. The teacher IS the player who gives the orders: the bot watches the player who
// said "watch me", and "continue like this" and "yes" come from the same player.
//
// The real mechanics of the game: the teacher stands within 4 blocks of the cell it works on (the control teleports the
// teacher, never the bot under test), holds the block in its hand (the console puts it into its main hand: the teacher is
// in creative mode), looks at the face and places it with bot.placeBlock against the block below, or digs it with
// bot.dig. Every action is read back from the server.
//
//   const t = makeTeacher(orders);
//   await t.place('oak_planks', cell, { facing: 'north' });   // stands 2 blocks behind the cell, looking `facing`
//   await t.place('oak_fence_gate', cell, { facing: 'east' }); // a gate faces the way the teacher looks
//   await t.dig(cell, { stand });                              // digs the block at cell from `stand`
//   t.say('!watchMe');                                         // a chat line of the player
// place and dig resolve with { ok, detail } and never throw.
import { Vec3 } from 'vec3';
import { command, tp, waitFor, sleep, note, errText } from './helpers.js';
import { DIRS, blockIs, dist } from './world.js';

// The yaw of the console's /tp for a direction (Minecraft degrees: 0 south, 90 west, 180 north, -90 east).
const YAW = { south: 0, west: 90, north: 180, east: -90 };
const REACH = 4;

const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const centre = (c) => ({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 });

export function makeTeacher(orders) {
    const player = orders.player;
    const name = orders.name;
    const t = { player, name, log: [] };
    // The 1.21.8 server ignores every action of a client for 60 ticks after its spawn until it sends player_loaded,
    // which the plain mineflayer player never sends (README, game mechanics): the teacher acts 4 s after it was made
    // (made right after the order channel connected its player) at the earliest.
    const born = Date.now();
    const loaded = () => sleep(Math.max(0, 4000 - (Date.now() - born)));
    const record = (line) => { t.log.push(line); note(`teacher: ${line}`); };

    t.say = (text) => player.chat(text);

    // Teleports the teacher (the player, not the bot under test) to stand at `cell`, looking `facing`.
    t.goTo = async (cell, facing = 'north') => {
        await tp(name, cell, YAW[facing] ?? 0, 30);
        const there = await waitFor(() => {
            const p = player.entity?.position;
            return p && Math.hypot(p.x - (cell.x + 0.5), p.z - (cell.z + 0.5)) < 0.5 && Math.abs(p.y - cell.y) < 1.1;
        }, { ms: 5000, every: 50 });
        await sleep(250);
        return there.ok;
    };

    // Puts `item` into the main hand through the console and waits until the teacher's client sees it.
    t.hold = async (item) => {
        if (player.heldItem?.name === item) return true;
        await command(`item replace entity ${name} weapon.mainhand with minecraft:${item} 64`);
        return (await waitFor(() => player.heldItem?.name === item, { ms: 5000, every: 50 })).ok;
    };

    // Places `item` at `cell` against the block below it. The teacher stands at `stand`, by default 2 blocks behind the
    // cell against `facing` (so it looks `facing` when it places: a gate or a door faces that way).
    t.place = async (item, cell, { facing = 'north', stand = null, tries = 3 } = {}) => {
        await loaded();
        const d = DIRS[facing];
        const at = stand ?? { x: cell.x - 2 * d.x, y: cell.y, z: cell.z - 2 * d.z };
        if (dist(centre(at), centre(cell)) > REACH) return { ok: false, detail: `the stand ${P(at)} is more than ${REACH} blocks from ${P(cell)}` };
        let detail = '';
        for (let k = 1; k <= tries; k++) {
            try {
                if (!(await t.goTo(at, facing))) { detail = `the teacher did not arrive at ${P(at)}`; continue; }
                if (!(await t.hold(item))) { detail = `the teacher does not hold ${item}`; continue; }
                const below = player.blockAt(new Vec3(cell.x, cell.y - 1, cell.z));
                if (!below || below.boundingBox !== 'block') { detail = `no solid block under ${P(cell)} (${below?.name ?? 'not loaded'})`; break; }
                await player.placeBlock(below, new Vec3(0, 1, 0));
            } catch (e) {
                detail = errText(e).split('\n')[0];
            }
            await sleep(300);
            if (await blockIs(cell, item)) {
                record(`placed ${item} at ${P(cell)} from ${P(at)} looking ${facing}${k > 1 ? ` (try ${k})` : ''}`);
                return { ok: true, detail: '' };
            }
            if (!detail) detail = `the server has no ${item} at ${P(cell)}`;
            await sleep(1000); // the bot may stand in the cell: it moves on
        }
        record(`could NOT place ${item} at ${P(cell)}: ${detail}`);
        return { ok: false, detail };
    };

    // Digs the block at `cell`, standing at `stand` (within 4 blocks), looking `facing`.
    t.dig = async (cell, { stand, facing = 'north', tries = 3 } = {}) => {
        await loaded();
        if (!stand) return { ok: false, detail: 'no stand given' };
        if (dist(centre(stand), centre(cell)) > REACH) return { ok: false, detail: `the stand ${P(stand)} is more than ${REACH} blocks from ${P(cell)}` };
        let detail = '';
        for (let k = 1; k <= tries; k++) {
            try {
                if (!(await t.goTo(stand, facing))) { detail = `the teacher did not arrive at ${P(stand)}`; continue; }
                const block = player.blockAt(new Vec3(cell.x, cell.y, cell.z));
                if (!block) { detail = `${P(cell)} is not loaded for the teacher`; continue; }
                if (block.name !== 'air' && block.name !== 'cave_air') await player.dig(block, true);
            } catch (e) {
                detail = errText(e).split('\n')[0];
            }
            await sleep(300);
            if ((await blockIs(cell, 'air')) || (await blockIs(cell, 'cave_air'))) {
                record(`dug ${P(cell)} from ${P(stand)}${k > 1 ? ` (try ${k})` : ''}`);
                return { ok: true, detail: '' };
            }
            if (!detail) detail = `the block at ${P(cell)} is still there`;
            await sleep(1000);
        }
        record(`could NOT dig ${P(cell)}: ${detail}`);
        return { ok: false, detail };
    };

    return t;
}
