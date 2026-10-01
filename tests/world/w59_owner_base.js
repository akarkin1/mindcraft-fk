// W59 the owner variant of the base (base_world.js, buildBase(plan, { owner: true })): proves the harness of the
// journey scenarios W80 to W84, like W58 for the default base. No defect of the play test.
//   1. The owner variant is built and read back block by block (verifyBase): the house with the closed trapdoor,
//      shaft 1 down to the basement at y 53, the basement, shaft 2 whose last ladder is 2 blocks above the floor of
//      the room, the double door in the wall of the room, the descent, the landing, the tunnel, the farm and the pen.
//   2. The real agent (no modes: nothing may move it) stands in the house, in the basement and in the room under the
//      last ladder, and sees the trapdoor, both ladders and the doors there.
//   3. The ladder of shaft 2 is out of reach from the floor of the room: the bot under it holds jump for 3 s and its
//      feet never reach the first ladder (y 43). This is the owner's world: the bot cannot climb out without a ladder
//      block of its own.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, entityPos, fmt, env, sleep,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox } from './world.js';
import { basePlan, buildBase, verifyBase, BASE_RADIUS } from './base_world.js';

const NAME = 'w_ownerb';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        const t0 = Date.now();
        await buildBase(b, { owner: true });
        note(`the owner variant was built in ${Date.now() - t0} ms in the region x=${r.ox} z=${r.oz}, ground y ${r.g}`);
        check(Boolean(b.owner), 'buildBase with owner: true made the plan the owner variant');
        const v = await verifyBase(b);
        for (const l of v.lines) note(`owner base: ${l}`);
        check(v.ok, 'the owner variant is built as planned (every part read back from the server)', v.failed.join(' || '));

        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            const o = b.owner;
            const seen = (p) => agent.bot.blockAt(new Vec3(p.x, p.y, p.z))?.name ?? null;
            const inHouse = await placeBot(agent, b.house.home, 180);
            check(inBox(inHouse, b.house.interior), 'the bot stands in the house (server)', fmt(inHouse));
            check(seen(b.trapdoor) === 'oak_trapdoor' && seen(b.shaft.ladders[b.shaft.ladders.length - 1]) === 'ladder', 'in the house the bot sees the trapdoor and the ladder under it', `${seen(b.trapdoor)}, ${seen(b.shaft.ladders[0])}`);
            const inBasement = await placeBot(agent, o.basement.middle, 180);
            check(inBox(inBasement, o.basement.box), `the bot stands in the basement at y ${o.basement.box.min.y} (server)`, fmt(inBasement));
            check(seen(o.shaft2.ladders[o.shaft2.ladders.length - 1]) === 'ladder', 'in the basement the bot sees the ladder of shaft 2 in the floor', String(seen(o.shaft2.ladders[o.shaft2.ladders.length - 1])));
            const under = await placeBot(agent, o.shaft2.gap[0], 0);
            check(Math.floor(under.y + 0.01) === b.room.box.min.y, `the bot stands on the floor of the room under the last ladder, y ${b.room.box.min.y} (server)`, fmt(under));
            check(seen(o.shaft2.gap[1]) === 'air' && seen(o.shaft2.ladders[0]) === 'ladder' && o.doors.every((d) => seen(d.lower) === 'oak_door'),
                'there the bot sees air above its head, the last ladder 2 blocks above the floor and the double door', `${seen(o.shaft2.gap[1])}, ${seen(o.shaft2.ladders[0])}, ${o.doors.map((d) => seen(d.lower)).join('+')}`);
            // the ladder is out of reach: hold jump under it for 3 s
            let top = under.y;
            agent.bot.setControlState('jump', true);
            const tJump = Date.now();
            while (Date.now() - tJump < 3000) {
                top = Math.max(top, agent.bot.entity.position.y);
                await sleep(50);
            }
            agent.bot.setControlState('jump', false);
            await sleep(1000);
            const after = await entityPos(NAME);
            note(`holding jump under the last ladder for 3 s: the highest feet ${top.toFixed(2)}, at the end ${fmt(after)}`);
            check(top < o.shaft2.bottom && Math.floor(after.y + 0.01) === b.room.box.min.y, `the bot cannot reach the last ladder (y ${o.shaft2.bottom}) from the floor of the room by a jump`, `highest ${top.toFixed(2)}, end ${fmt(after)}`);
            check(s.killed === null, 'the process of the agent lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
