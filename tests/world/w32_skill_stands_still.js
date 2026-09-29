// W32 skill stands still (v0.1.4.8 spec A1, I1, C6; finding S15, also S1).
// Defect of the play test: the skills of the packs and the sleep wait 20 to 40 s at one place (a walk that
// does not go on, the wait at the bed until the night, the composter, the chests) without pausing unstuck.
// unstuck took that for being stuck, said "I'm stuck!", interrupted the skill and ran its escape (end #9 of
// the play test: !goToBed at dusk, stuck at the bed while it waited for the sleep time). Against v0.1.4.7
// part A says "I'm stuck!" after 20 s at the bed and the sleep is interrupted.
//
// Flat world, the modes of the owner (MODES_PROFILE), storage, farming and wood pack on. Every order is typed
// by the player in the chat. Each part is a place of its own in the region:
//   A  !goToBed at 12100 (dusk, the daylight cycle stopped): the bot walks to a bed 2 blocks away and waits
//      there for the sleep time up to 40 s (C6: goToBed pauses unstuck from its start). The wait of 25 s or
//      more at one place is a checked precondition: this part shows the defect.
//   B  !makeBoneMeal(16) with 6 stacks of oak_leaves and a composter 2 blocks away: many uses of the
//      composter at one place.
//   C  !storeItems with 24 stacks of dirt, the bot in the middle of 24 chests with 1 free slot each.
//   D  !getTool("pickaxe", "stone") with 8 oak_log in the inventory and cobblestone only in a chest the bot
//      knows (T3), 3 blocks away.
// On the test server B, C and D took 7, 18 and 12 s (makeBoneMeal stops after 64 items), so they do not stand
// 25 s at one place and cannot show the defect; their standstill is noted, not checked. (A server slowed with
// `tick rate 4` did not make them longer: the actions of a player are not bound to the tick rate; it only
// slowed the last level of the composter, and makeBoneMeal then made nothing.) For them the scenario checks
// what holds anyway: no "I'm stuck!", a text, the result in the world (bone meal made; all 24 stacks of dirt
// stored, since 24 chests have a free slot).
// For each part: no "I'm stuck!" while the command ran; the command answered with a text; the process lives.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, giveItems, entityPos, fmt, commands, orderChannel, startTrace, STUCK_SAID, saidSince, waitIdle,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, buildChest, buildFullChest, buildComposter, stableInventory, itemsText, hdist,
    chestItems, blockIs,
} from './world.js';

const NAME = 'w_still';
const PLAYER = 'w_player';

// The longest time (s) the trace stayed within 2 blocks (horizontal and vertical) of the first sample of a
// stretch.
function longestStandstill(rows) {
    let best = 0;
    let start = 0;
    for (let i = 1; i < rows.length; i++) {
        const a = rows[start].pos, b = rows[i].pos;
        if (!a || !b) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= 2) start = i;
        else best = Math.max(best, rows[i].t - rows[start].t);
    }
    return best;
}

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        const spots = {
            A: { x: r.ox - 30, y: g + 1, z: r.oz - 20 },
            B: { x: r.ox, y: g + 1, z: r.oz - 20 },
            C: { x: r.ox + 30, y: g + 1, z: r.oz - 20 },
            D: { x: r.ox, y: g + 1, z: r.oz + 20 },
        };
        // A: a bed 2 blocks east of the bot
        await commands([
            `setblock ${spots.A.x + 2} ${g + 1} ${spots.A.z} minecraft:red_bed[facing=south,part=foot]`,
            `setblock ${spots.A.x + 2} ${g + 1} ${spots.A.z + 1} minecraft:red_bed[facing=south,part=head]`,
        ]);
        // B: an empty composter 2 blocks east
        const composter = { x: spots.B.x + 2, y: g + 1, z: spots.B.z };
        await buildComposter(composter, 0);
        // C: 24 chests around the bot, 1 or 2 blocks from it, full but for 1 free slot each
        const chestsC = [];
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx || dz) chestsC.push({ x: spots.C.x + dx, y: g + 1, z: spots.C.z + dz });
        for (const p of chestsC) await buildFullChest(p, 'stone', { free: 1 });
        // D: a chest with cobblestone 3 blocks east, that the bot will know (!viewChest)
        const chestD = { x: spots.D.x + 3, y: g + 1, z: spots.D.z };
        await buildChest(chestD, { cobblestone: 16 });

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({
                ...NEW_FLAGS_OFF, ...FLAGS_0148_OFF, world_memory: true, protected_areas: true, storage_pack: true, farming_pack: true, wood_pack: true,
            }));
            agent = s.agent;
            orders = await orderChannel(s, { name: PLAYER, at: { x: r.ox, y: g + 1, z: r.oz } });

            async function part(label, order, ms, { needsWait = false } = {}) {
                const t0 = Date.now();
                const trace = startTrace(async () => ({ pos: await entityPos(NAME) }), 500);
                const info = await orders.orderInfo(order, ms);
                const rows = await trace.stop();
                const still = longestStandstill(rows);
                const stuck = saidSince(s, STUCK_SAID, t0);
                note(`${label}: ${order} answered after ${(info.ms / 1000).toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 300))}; longest standstill ${still.toFixed(1)} s; start ${fmt(rows[0]?.pos)}, end ${fmt(rows[rows.length - 1]?.pos)}`);
                if (needsWait) check(still >= 25, `${label}: precondition: the bot stood at one place for 25 s or more while ${order} ran (else this part cannot show the defect)`, `${still.toFixed(1)} s`);
                check(stuck.length === 0, `${label}: no "${STUCK_SAID}" while ${order} ran`, JSON.stringify(stuck));
                check(info.done && info.reply !== '', `${label}: ${order} answered with a text`, JSON.stringify(info.reply.slice(0, 200)));
                check(s.killed === null, `${label}: the process lives`, String(s.killed));
                await waitIdle(agent, 20000);
                return info;
            }

            // ---------------------------------------------------------- A: the bed at dusk
            await resetBot(NAME);
            await commands(['gamerule doDaylightCycle false', 'time set 12100']);
            await placeBot(agent, spots.A, -90);
            const a = await part('A', '!goToBed', 120000, { needsWait: true });
            check(/I cannot sleep now, it is not night\./.test(a.reply), 'A: after the wait at the bed the text says that it is not night yet', JSON.stringify(a.reply.slice(0, 200)));
            await commands(['time set 6000']);

            // ---------------------------------------------------------- B: the composter
            await resetBot(NAME);
            await placeBot(agent, spots.B, -90);
            await giveItems(NAME, [['oak_leaves', 384]], agent.bot);
            const b = await part('B', '!makeBoneMeal(16)', 400000, {});
            const invB = await stableInventory(NAME);
            note(`B: the bot carries ${itemsText(invB.items)}`);
            check((invB.items.bone_meal || 0) >= 1, 'B: the bot made bone meal', `bone_meal ${invB.items.bone_meal || 0}`);

            // ---------------------------------------------------------- C: many chests
            await resetBot(NAME);
            await placeBot(agent, spots.C, -90);
            await giveItems(NAME, [['dirt', 24 * 64]], agent.bot);
            const c = await part('C', '!storeItems', 600000, {});
            const invC = await stableInventory(NAME);
            note(`C: the bot carries ${itemsText(invC.items)}`);
            // which chests got dirt, and whether each is still a single chest with a free slot (evidence)
            const perChest = [];
            for (const p of chestsC) perChest.push({ p, items: await chestItems(p), single: await blockIs(p, 'chest[type=single]') });
            const used = perChest.filter((x) => (x.items?.dirt || 0) > 0);
            const free = perChest.filter((x) => !(x.items?.dirt) && x.single);
            note(`C: ${used.length} chests got dirt (${used.map((x) => `(${x.p.x - spots.C.x}, ${x.p.z - spots.C.z})`).join(' ')}); ${free.length} single chests with a free slot got none (${free.map((x) => `(${x.p.x - spots.C.x}, ${x.p.z - spots.C.z})`).join(' ')}) (offsets from the bot); ${perChest.filter((x) => !x.single).length} chests are not single`);
            check(!invC.items.dirt, 'C: all 24 stacks of dirt were stored (24 chests within 2 blocks had a free slot)', `dirt ${invC.items.dirt || 0}; ${JSON.stringify(c.reply)}`);

            // ---------------------------------------------------------- D: a tool from a known chest
            await resetBot(NAME);
            await placeBot(agent, spots.D, -90);
            const seen = await orders.order('!viewChest', 30000); // the bot learns the chest (the index of S4)
            note(`D: !viewChest answered ${JSON.stringify(seen.slice(0, 200))}`);
            await giveItems(NAME, [['oak_log', 8]], agent.bot);
            const d = await part('D', '!getTool("pickaxe", "stone")', 400000, {});
            const invD = await stableInventory(NAME);
            note(`D: the bot carries ${itemsText(invD.items)}; it is ${hdist(await entityPos(NAME), chestD).toFixed(1)} blocks from the chest`);
            check((invD.items.stone_pickaxe || 0) >= 1, 'D: the bot has a stone pickaxe', itemsText(invD.items));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
