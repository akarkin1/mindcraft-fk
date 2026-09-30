// W44 pick up dropped (v0.1.4.8 spec B4, section 11.10 !pickUpItems, A8; finding P2, also T2).
// Defect of the play test: the fences that the bot had dropped were never picked up. item_collecting tried
// once ("Picked up 0 items") and never again, and there was no command to pick up items; the model then took
// the placed fences of !nearbyBlocks for the dropped ones. Against v0.1.4.7: "Command '!pickUpItems' does
// not exist." and the items stay on the ground.
//
// Base world, the modes of the owner, the owner's packs. A second bot (the player, in survival) stands 12
// blocks from the agent (beyond the 8 blocks of item_collecting), north of the house, and drops 8 oak_fence
// and 1 oak_fence_gate on the grass in front of it, then walks away. When the items lie on the ground (server) the player types
// !pickUpItems. Then: the bot carries 8 oak_fence and 1 oak_fence_gate (server), no fence item lies on the
// ground, the answer has the line "I picked up 8 oak_fence, 1 oak_fence_gate." (B4), the process lives.
// v0.1.4.8, X15: then the player types !givePlayer("w_dropper", "oak_fence", 1): the player gets the fence and
// the answer has no stray line with a number (the long run of stage 2 showed "61.125" in it).
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, sleep, command, orderChannel, tp, giveItems, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, itemsText, itemsOnGround } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_pickup';
const PLAYER = 'w_dropper';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        // the agent stands north-east of the house; the items land 12 blocks west of it, on open grass north of
        // the house (5 blocks from its north wall)
        const botAt = { x: r.ox + 18, y: g + 1, z: r.oz - 10 };
        const dropAt = { x: botAt.x - 12, y: g + 1, z: botAt.z };
        const area = { min: { x: dropAt.x - 8, y: g - 1, z: dropAt.z - 8 }, max: { x: dropAt.x + 8, y: g + 4, z: dropAt.z + 8 } };

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await placeBot(agent, botAt, 90);
            orders = await orderChannel(s, { name: PLAYER, at: dropAt, gamemode: 'survival' });
            const p = orders.player;
            await command(`clear ${PLAYER}`);
            await giveItems(PLAYER, [['oak_fence', 8], ['oak_fence_gate', 1]], p);
            await p.look(Math.PI / 2, 0, true); // west (mineflayer: x changes by -sin(yaw)), away from the agent
            for (const name of ['oak_fence', 'oak_fence_gate']) {
                const item = p.inventory.items().find((i) => i.name === name);
                if (item) await p.tossStack(item);
            }
            await sleep(300);
            await tp(PLAYER, { x: dropAt.x, y: g + 1, z: dropAt.z + 16 }); // away, so the player does not pick them up again
            const lying = await waitFor(async () => {
                const items = (await itemsOnGround(area)).filter((x) => /fence/.test(x.name ?? ''));
                return items.reduce((n, x) => n + (x.count || 0), 0) === 9 ? items : null;
            }, { ms: 10000, every: 250 });
            check(lying.ok, 'precondition: 8 oak_fence and 1 oak_fence_gate lie on the ground, 12 blocks from the bot', JSON.stringify(lying.value ?? (await itemsOnGround(area))));
            await sleep(3000); // the pick-up delay of the drops; item_collecting (8 blocks) does not reach them
            check(!(await inventoryOf(NAME)).oak_fence, 'precondition: the bot did not pick them up by itself (they lie beyond the 8 blocks of item_collecting)');

            const reply = await orders.order('!pickUpItems', 90000);
            await sleep(1000);
            const inv = await inventoryOf(NAME);
            const left = (await itemsOnGround(area)).filter((x) => /fence/.test(x.name ?? ''));
            note(`!pickUpItems answered ${JSON.stringify(reply)}; the bot carries ${itemsText(inv)}; left on the ground: ${JSON.stringify(left)}`);
            // the command answers with the output of its action ("Action output:" and the lines of the skill)
            check(reply.split('\n').includes('I picked up 8 oak_fence, 1 oak_fence_gate.'), 'the answer has the line "I picked up 8 oak_fence, 1 oak_fence_gate." (B4)', JSON.stringify(reply));
            check((inv.oak_fence || 0) === 8 && (inv.oak_fence_gate || 0) === 1, 'the bot carries the 8 oak_fence and the oak_fence_gate (server)', itemsText(inv));
            check(left.length === 0, 'no fence item lies on the ground', JSON.stringify(left));
            const seen = agent.bot.blockAt(new Vec3(dropAt.x, g, dropAt.z))?.name;
            note(`the ground where the items lay: ${seen}`);

            // v0.1.4.8, X15: !givePlayer printed a stray line with a number ("61.125") into its output
            await command(`clear ${PLAYER}`);
            await tp(PLAYER, { x: botAt.x - 6, y: g + 1, z: botAt.z + 2 });
            await sleep(1000);
            const give = await orders.order(`!givePlayer("${PLAYER}", "oak_fence", 1)`, 60000);
            const got = await waitFor(async () => ((await inventoryOf(PLAYER)).oak_fence || 0) === 1, { ms: 8000, every: 250 });
            note(`!givePlayer answered ${JSON.stringify(give)}`);
            check(!give.split('\n').some((l) => /^\s*-?\d+(\.\d+)?\s*$/.test(l)), 'the answer of !givePlayer has no line of only a number (X15)', JSON.stringify(give));
            check(got.ok, 'the player received 1 oak_fence (server)', itemsText(await inventoryOf(PLAYER)));
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
