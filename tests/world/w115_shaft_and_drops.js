// W115 no bare shaft, no death drops (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 3.13 and 3.11, SPEC section
// 1 and 4.6 Q7, Q6; part A2 and the refusal text of A by the owner's correction of 2026-10-04: down is fine by a safe way,
// a ladder on every block, never a bare shaft): !goToCoordinates 20 blocks down without ladders is refused in words and
// the bot stands where it stood; with 30 ladders it digs the shaft with a ladder on every block; a player's death drops
// stay on the ground and the bot wears no armour it did not own. v0.1.4.12 digs a bare shaft straight down (the shaft of
// 2026-10-04 killed the owner) and the item reflex picks up the drops: the scenario fails at the check that no block
// below the bot was broken.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches of v0.1.4.12 and of this release (SUPERVISION_SETTINGS), the modes of his profile (item_collecting on), an
// empty memory, a kit of an iron pickaxe and 4 bread. The bot stands on the grass east of the house with 120 layers of
// rock under it; it is never moved by the control. Part B runs first: after A the bot of v0.1.4.12 sits 19 blocks down
// its shaft and cannot reach the drops (the second baseline run), so B would show nothing.
//   B. The player (survival) with iron boots on and 5 iron ingots dies 3 blocks from the bot (the control kills it).
//      After 60 s the iron_boots and the 5 iron_ingot lie within 8 blocks of the death (server entities: a death scatters
//      its drops up to 5 blocks, and 8 is the range of the bot's leave rule); the bot wears
//      no boots and carries no ingot; it said `I leave w_player's things at (x, y, z).` exactly once.
//   A. Typed !goToCoordinates(x, y - 20, z, 1) (20 blocks straight down, rock below, no ladder in the bag): the answer is
//      `I do not dig a shaft 20 blocks down without ladders: I have 0 and need 22. Bring me ladders or show me stairs.`;
//      20 s after the order the bot is within 2 blocks of where it stood; no block of the 3 x 3 columns under it was
//      broken (server).
//   A2. The control gives the bot 30 ladders (as the owner would hand them over); the same order again: the answer says
//      `I dig down 20 blocks with ladders.`; within 2 minutes the bot is within 2 blocks of the target (server); every
//      block of the shaft, from the ground block it stood on down to the target, holds a ladder whose wall is no air or
//      liquid, and the two cells above the top are free: a player can climb out (the control checks the column, the bot
//      need not climb); 10 ladders are left in the bag.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, tp, startTrace, printTrace } from './helpers.js';
import { region, prepareRegion, releaseRegion, inventoryOf, itemsText, findBlocks, blockNames, itemsOnGround, dist } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, PLAYER, saidLines, SUPERVISION_SETTINGS } from './journey.js';

const NAME = 'w_shaft';
const KIT = [['iron_pickaxe', 1], ['bread', 4]];
const DOWN = 20;
const REFUSED = `I do not dig a shaft ${DOWN} blocks down without ladders: I have 0 and need ${DOWN + 2}. Bring me ladders or show me stairs.`;
const LADDERS = 30;
const WITH_LADDERS = `I dig down ${DOWN} blocks with ladders.`;
const FACINGS = ['north', 'south', 'east', 'west'];
const BEHIND = { north: { x: 0, z: 1 }, south: { x: 0, z: -1 }, east: { x: -1, z: 0 }, west: { x: 1, z: 0 } }; // a ladder facing north hangs on the block south of it
const LEAVE = new RegExp(`^I leave ${PLAYER}'s things at \\((-?\\d+), (-?\\d+), (-?\\d+)\\)\\.$`);

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const g = b.g;
        const botAt = { x: b.ox + 30, y: g + 1, z: b.oz - 20 }; // open grass east of the house, rock below
        const playerAt = { x: botAt.x + 3, y: g + 1, z: botAt.z };
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, { botAt, playerAt: { x: botAt.x - 6, y: g + 1, z: botAt.z }, kit: KIT, settings: SUPERVISION_SETTINGS() });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            await sleep(2000);

            // ---------------------------------------------------------- B. the death drops (first: the bot on the surface)
            await commands([`gamemode survival ${PLAYER}`, `clear ${PLAYER}`]);
            await tp(PLAYER, playerAt, 90, 0);
            await commands([`item replace entity ${PLAYER} armor.feet with minecraft:iron_boots 1`, `give ${PLAYER} minecraft:iron_ingot 5`]);
            await sleep(1000);
            const pInv = await inventoryOf(PLAYER);
            const deathAt = await entityPos(PLAYER);
            note(`B: the player at ${fmt(deathAt)}, ${dist(deathAt, await entityPos(NAME)).toFixed(1)} blocks from the bot, carries ${itemsText(pInv)}`);
            check((pInv.iron_boots || 0) === 1 && (pInv.iron_ingot || 0) === 5, 'B: precondition: the player wears iron boots and carries 5 iron ingots (server)', itemsText(pInv));
            const tB = Date.now();
            const killed = await command(`kill ${PLAYER}`);
            note(`B: the control killed the player: ${JSON.stringify(killed)}`);
            const dropBox = { min: { x: Math.floor(deathAt.x) - 8, y: g - 1, z: Math.floor(deathAt.z) - 8 }, max: { x: Math.floor(deathAt.x) + 8, y: g + 4, z: Math.floor(deathAt.z) + 8 } };
            const dropsOf = async () => (await itemsOnGround(dropBox)).filter((x) => /^iron_(boots|ingot)$/.test(x.name ?? ''));
            const dropped = await waitFor(async () => { const d = await dropsOf(); return d.length ? d : null; }, { ms: 5000, every: 200 });
            note(`B: the drops on the ground ${JSON.stringify((dropped.value ?? []).map((x) => `${x.count} ${x.name} at ${fmt(x.pos)}`))}`);
            // the player respawns at the world spawn (mineflayer respawns by itself): back as the owner, 10 blocks away, in creative
            await sleep(1500);
            await commands([`gamemode creative ${PLAYER}`]);
            await tp(PLAYER, { x: botAt.x - 10, y: g + 1, z: botAt.z }, -90, 0);
            // where the drops, the bot and the player are, every 5 s, for the report (the first baseline run lost the
            // drops out of the 4 blocks within the 60 s while the bot was 19 blocks underground)
            const wide = { min: { x: botAt.x - 20, y: g - 25, z: botAt.z - 20 }, max: { x: botAt.x + 20, y: g + 6, z: botAt.z + 20 } };
            const itemTrace = startTrace(async () => ({
                items: (await itemsOnGround(wide)).filter((x) => /^iron_(boots|ingot)$/.test(x.name ?? '')).map((x) => `${x.count} ${x.name} ${fmt(x.pos)}`).join(' '),
                bot: await entityPos(NAME), player: await entityPos(PLAYER), action: agent.actions.currentActionLabel || '-',
            }), 5000);
            await sleep(Math.max(0, 60000 - (Date.now() - tB)));
            const rows = await itemTrace.stop();
            printTrace('B: the drops of the player', rows, { items: (x) => x.items || 'none', bot: (x) => fmt(x.bot), player: (x) => fmt(x.player), action: (x) => x.action }, 20);
            const drops = await dropsOf();
            const boots = drops.filter((x) => x.name === 'iron_boots').reduce((n, x) => n + (x.count || 0), 0);
            const ingots = drops.filter((x) => x.name === 'iron_ingot').reduce((n, x) => n + (x.count || 0), 0);
            const inv = await inventoryOf(NAME);
            const said = saidLines(s, tB);
            const leaves = said.filter((l) => LEAVE.test(l));
            note(`B: 60 s after the death: on the ground ${boots} iron_boots and ${ingots} iron_ingot within 8 blocks of ${fmt(deathAt)}; the bot carries ${itemsText(inv)} at ${fmt(await entityPos(NAME))}; it said ${JSON.stringify(said.slice(0, 10))}`);
            check(boots === 1 && ingots === 5, 'B: after 60 s the iron_boots and the 5 iron_ingot lie within 8 blocks of the death (server entities)', `${boots} boots, ${ingots} ingots`);
            check(!inv.iron_boots && !inv.iron_ingot, 'B: the bot wears no boots and carries no ingot of the player', itemsText(inv));
            check(leaves.length === 1, `B: the bot said \`I leave ${PLAYER}'s things at (x, y, z).\` exactly once`, JSON.stringify(leaves.length ? leaves : said.slice(0, 5)));
            if (leaves.length) {
                const m = LEAVE.exec(leaves[0]);
                const at = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
                check(dist({ x: at.x + 0.5, y: at.y, z: at.z + 0.5 }, deathAt) <= 4, 'B: the leave text names the place of the death (within 4 blocks)', `${fmt(at)} vs ${fmt(deathAt)}`);
            }
            // ---------------------------------------------------------- A. the shaft
            const stood = await entityPos(NAME);
            const target = { x: Math.floor(stood.x), y: Math.floor(stood.y + 0.01) - DOWN, z: Math.floor(stood.z) };
            const underBot = { min: { x: Math.floor(stood.x) - 1, y: g - 8, z: Math.floor(stood.z) - 1 }, max: { x: Math.floor(stood.x) + 1, y: g, z: Math.floor(stood.z) + 1 } };
            const before = await findBlocks(underBot, ['air', 'cave_air']);
            check(before.length === 0, 'A: precondition: the 3 x 3 columns under the bot are solid down to 8 blocks (server)', JSON.stringify(before.map((x) => x.pos)));
            const tA = Date.now();
            const info = await orders.orderInfo(`!goToCoordinates(${target.x}, ${target.y}, ${target.z}, 1)`, 60000);
            note(`A: !goToCoordinates(${target.x}, ${target.y}, ${target.z}, 1) answered after ${((Date.now() - tA) / 1000).toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 300))}`);
            await sleep(Math.max(0, 20000 - (Date.now() - tA)));
            const after = await entityPos(NAME);
            const holes = await findBlocks(underBot, ['air', 'cave_air']);
            const column = await blockNames([0, 1, 2, 3, 4, 5].map((k) => ({ x: Math.floor(stood.x), y: g - k, z: Math.floor(stood.z) })), ['grass_block', 'dirt', 'stone', 'air']);
            note(`A: 20 s after the order the bot is at ${fmt(after)}, ${dist(after, stood).toFixed(1)} blocks from where it stood ${fmt(stood)}; the column under it ${JSON.stringify(column)}; holes ${JSON.stringify(holes.map((x) => x.pos))}; the bot said ${JSON.stringify(saidLines(s, tA).slice(0, 8))}`);
            check(info.reply.includes(REFUSED), `A: the walk 20 blocks down is refused in words: \`${REFUSED}\``, JSON.stringify(info.reply.slice(0, 200)));
            check(after && dist(after, stood) <= 2, 'A: 20 s after the order the bot stands within 2 blocks of where it stood (server)', `${dist(after, stood).toFixed(1)} blocks`);
            check(holes.length === 0, 'A: no block below the bot was broken (the 3 x 3 columns under it, 8 deep, server)', JSON.stringify(holes.map((x) => x.pos)));

            // ---------------------------------------------------------- A2. the shaft with a ladder on every block
            await commands([`give ${NAME} minecraft:ladder ${LADDERS}`]);
            const gotLadders = await waitFor(async () => ((await inventoryOf(NAME)).ladder || 0) >= LADDERS, { ms: 8000, every: 200 });
            check(gotLadders.ok, `A2: precondition: the bot carries ${LADDERS} ladders (server)`, itemsText(await inventoryOf(NAME)));
            const from = await entityPos(NAME);
            const top = { x: Math.floor(from.x), y: Math.floor(from.y + 0.01), z: Math.floor(from.z) }; // the cell of the feet
            const goal = { x: top.x, y: top.y - DOWN, z: top.z };
            const tA2 = Date.now();
            const info2 = await orders.orderInfo(`!goToCoordinates(${goal.x}, ${goal.y}, ${goal.z}, 1)`, 150000);
            note(`A2: !goToCoordinates(${goal.x}, ${goal.y}, ${goal.z}, 1) answered after ${((Date.now() - tA2) / 1000).toFixed(1)} s: ${JSON.stringify(info2.reply.slice(0, 400))}`);
            const reached = await waitFor(async () => { const p = await entityPos(NAME); return p && dist(p, { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 }) <= 2 ? p : null; }, { ms: Math.max(2000, 120000 - (Date.now() - tA2)), every: 1000 });
            await sleep(1500);
            const down = await entityPos(NAME);
            const shaft = Array.from({ length: DOWN }, (_, k) => ({ x: top.x, y: top.y - 1 - k, z: top.z }));
            const facings = await blockNames(shaft, FACINGS.map((f) => `ladder[facing=${f}]`));
            const walls = shaft.map((c, k) => (facings[k] ? { x: c.x + BEHIND[/facing=(\w+)/.exec(facings[k])[1]].x, y: c.y, z: c.z + BEHIND[/facing=(\w+)/.exec(facings[k])[1]].z } : null));
            const wallLoose = await blockNames(walls.map((w, k) => w ?? shaft[k]), ['air', 'cave_air', 'water', 'lava', 'ladder']);
            const bare = shaft.filter((c, k) => !facings[k]).map((c) => c.y);
            const loose = shaft.filter((c, k) => facings[k] && wallLoose[k]).map((c) => c.y);
            const exit = await blockNames([{ ...top }, { ...top, y: top.y + 1 }], ['air', 'cave_air']);
            const inv2 = await inventoryOf(NAME);
            note(`A2: ${((Date.now() - tA2) / 1000).toFixed(0)} s after the order the bot is at ${fmt(down)}, ${dist(down, { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 }).toFixed(1)} blocks from ${fmt(goal)}; the shaft ${JSON.stringify(facings.map((f, k) => `${shaft[k].y}:${f ? f.replace(/^ladder\[facing=|\]$/g, '') : 'none'}`))}; it carries ${itemsText(inv2)}; it said ${JSON.stringify(saidLines(s, tA2).slice(0, 8))}`);
            check(info2.reply.includes(WITH_LADDERS), `A2: the answer says \`${WITH_LADDERS}\``, JSON.stringify(info2.reply.slice(0, 300)));
            check(reached.ok, 'A2: within 2 minutes the bot is within 2 blocks of the target, 20 blocks down (server)', `${fmt(down)} vs ${fmt(goal)}`);
            check(bare.length === 0, `A2: every block of the shaft (y ${top.y - 1} down to ${top.y - DOWN}) holds a ladder (server)`, `without a ladder: ${JSON.stringify(bare)}`);
            check(loose.length === 0, 'A2: every ladder hangs on a wall that is no air, liquid or ladder (server)', `loose at ${JSON.stringify(loose)}`);
            check(exit.every((n) => n !== null), 'A2: the two cells above the top of the shaft are free: a player climbs out (server)', JSON.stringify(exit));
            check((inv2.ladder || 0) === LADDERS - DOWN, `A2: ${LADDERS - DOWN} ladders are left in the bag: one per block (server)`, `${inv2.ladder || 0} ladders`);

            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[type=minecraft:item,x=${botAt.x - 20},y=${g - 25},z=${botAt.z - 20},dx=40,dy=40,dz=40]`]).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
