// T1, spec v0.1.4.9 section 13 (part L, the follow down a ladder): the scene of the tests of
// tests/unit/rt_ladder_follow.test.js and of its child process tests/helpers/rt_ladder_off_child.js, on the fake
// bot of the mining pack (tests/unit/mining_fake_bot.test.js).
//
// The base of the world tests: grass at y 60; a room at y 41 (air y 41..43, x 0..4, z -2..2); a shaft of 1 x 1 at
// (2, 44..59, -2); ladders facing south (on the north wall, z -3) at (2, 41..59, -2); an oak trapdoor at
// (2, 60, -2), closed, facing south, half top. The bot stands on the grass beside the trapdoor at (2.5, 61, -0.5);
// the player MartyByrde2 stands in the room at the foot of the ladder, (2.5, 41, -0.5), 20 blocks below.
import { makeWorld, makeMiningBot, tick, v } from '../unit/mining_fake_bot.test.js';

export const PLAYER = 'MartyByrde2';
export const COLUMN = Object.freeze({ x: 2, z: -2, top: 59, bottom: 41, facing: 'south',
    trapdoor: Object.freeze({ x: 2, y: 60, z: -2, name: 'oak_trapdoor' }) });

export function ladderWorld({ trapdoor = true, open = false, ladders = true } = {}) {
    const world = makeWorld({ groundY: 60 });
    world.fill(0, 41, -2, 4, 43, 2, 'air');
    world.fill(2, 44, -2, 2, 59, -2, 'air');
    if (ladders) world.fill(2, 41, -2, 2, 59, -2, 'ladder', { facing: 'south' });
    if (trapdoor) world.set(2, 60, -2, 'oak_trapdoor', { facing: 'south', half: 'top', open });
    else world.set(2, 60, -2, 'air');
    const solid = world.solid;
    world.solid = (x, y, z) => {
        if (world.nameAt(x, y, z).endsWith('_trapdoor') && world.propsAt(x, y, z).open === true) return false;
        return solid(x, y, z);
    };
    return world;
}

/**
 * The fake bot in the scene: records the clicks (with the sneak state), the goals of the path search, the pauses
 * and noteProgress; bot.output is the log of skills.log.
 */
export function ladderBot({ world = ladderWorld(), pos = [2.5, 61, -0.5], player = [2.5, 41, -0.5], opens = true } = {}) {
    const bot = makeMiningBot({ world, pos });
    bot.output = '';
    bot.clicks = [];
    bot.goals = [];
    bot.progress = [];
    bot.activateBlock = async (block) => {
        const p = block.position;
        bot.clicks.push({ x: p.x, y: p.y, z: p.z, sneak: bot.controls.sneak });
        if (!opens) return;
        world.set(p.x, p.y, p.z, world.nameAt(p.x, p.y, p.z), { ...world.propsAt(p.x, p.y, p.z), open: world.propsAt(p.x, p.y, p.z).open !== true });
    };
    const on = {};
    bot.modes = {
        exists: (name) => Object.hasOwn(on, name),
        isOn: (name) => on[name] === true,
        pause() {},
        unpause() {},
        noteProgress: (why) => bot.progress.push(why),
    };
    const setGoal = bot.pathfinder.setGoal.bind(bot.pathfinder);
    bot.pathfinder.setGoal = (goal, dynamic) => {
        bot.goals.push(goal === null || goal === undefined ? null : goal.constructor?.name ?? 'goal');
        return setGoal(goal, dynamic);
    };
    bot.pathfinder.getPathTo = () => ({ status: 'success', path: [] });
    bot.pathfinder.isMoving = () => false;
    bot.players = { [PLAYER]: { username: PLAYER, entity: { position: v(...player), height: 1.8, id: 7, type: 'player', username: PLAYER } } };
    bot.entities[7] = bot.players[PLAYER].entity;
    return bot;
}

/** Moves the physics of the fake bot on in real time, one tick per 50 ms; returns the function that stops it. */
export function runPhysics(bot) {
    const timer = setInterval(() => tick(bot), 50);
    return () => clearInterval(timer);
}

/** Waits in real time until test() holds or ms passed. */
export async function until(test, ms) {
    const end = Date.now() + ms;
    while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    return test();
}
