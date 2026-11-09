// W125 the open ground (v0.1.4.14 fix round, part 8, tester T3; SPEC 8.3, 8.4, 8.6, 8.10 and 8.11, DECISIONS P-19, P-24,
// P-25, P-26, the play of 2026-11-09): what the bot does on a natural landscape. A bed placed on a slope failed or lay on a
// pillar (P-24); a give beside water flew into the water (P-25); 5 of 9 sheep kills picked up nothing (P-26); without a
// shovel the bot stopped at snow and the long walks dug tunnels under the hills (P-19).
//
// The natural world (seed 8675309, README "World types"): the runner gives the world spawn (env.spawn); the trees differ
// from run to run, so the scenario reads the ground of its own run through the player bot and names nothing by position.
// The owner's switches (SUPERVISION_SETTINGS), the modes of his profile, an empty memory; the control gives the bot what
// each part needs and stands it where the part starts (noted). Every part is independent: a failing part never hides the
// others (!stop between them). The world is put back: the bed, the pond and the snow are removed at the end.
//   A. The bed on a slope (8.6). The control gives a red bed and stands the bot on a slope of the hill near the spawn (the
//      ground 3 blocks or more higher or lower 2 blocks away). Typed !placeHere("red_bed"): within 4 blocks of the bot a red
//      bed lies on level ground (server: both halves at one height, both support blocks solid at one height with air above,
//      each support with 2 solid neighbours or more at its level, a free cell beside the bed), or the answer is `I found no
//      level ground for the bed within 4 blocks.`. Night (time set 13000), typed !goToBed: the bot sleeps in it (server).
//   B. The give beside a pond (8.4, P-25). A pond of 3 x 3 water is made on a flat patch (if the world offers none within
//      reach of a straight dry line: the scenario makes its own); the player stands at its edge with the water right behind
//      him, the bot 4 blocks in front of him; 8 bread given to the bot. Typed !givePlayer("w_player", "bread", 8): within
//      20 s the player holds the 8 bread and the bot none (server), the answer is `I gave you 8 bread.`, no bread lies in
//      the water.
//   C. A summoned sheep killed (8.4, P-26). A sheep 3 blocks from the bot, a stone sword in the bag. Typed !attack("sheep"):
//      the sheep is gone within 60 s, the bag holds its wool and its mutton within 10 s after (server), the answer says
//      `Successfully killed sheep.` and `Picked up N items.` with N 1 or more, no drop lies within 8 blocks.
//   D. Snow (8.3.2, P-19), no shovel in the bag. D1: a layer of snow on every cell of a flat patch of 6 x 6 grass, the bot
//      in its middle; typed !goToCoordinates to a cell 8 blocks beyond the field: the bot arrives within 120 s (server), the
//      answer holds no `Cannot break snow` (a single layer never blocks the path finder: every state of `snow` is "empty"
//      in the 26.1 data, so this part passed before the fix too; noted). D2: a ring of snow blocks 2 high around the bot
//      in the middle of the field; the same goal: the path finder must break snow blocks, which only drop with a shovel:
//      before the fix `Pathfinding stopped: Cannot break snow_block with current tools` and the bot stays; after it digs
//      them by hand, some snow blocks are gone and the bot arrives within 150 s.
//   E. A way of 60 blocks to a goal behind the hill (8.3.1). From a cell near the spawn to a standable cell 60 blocks away
//      in the direction where the ground rises most between; every bot.dig is recorded. Typed !goToCoordinates (240 s): no
//      block was dug below the start level minus 1 (the cells the bot dug, read back from the server); the walk had no
//      destructive fallback line (`Path not found, but attempting to navigate anyway`); the bot arrived within 2 blocks, or
//      its answer is `I found no way to (x, y, z) without digging; I stopped at (x, y, z), N blocks away.` (8.11) with the
//      goal, a stop within 2 blocks of where it stands and N the distance.
// Throughout: the process lives, no request reached a real model.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, giveItems, placeBot,
    tp, chunksMissing, serverSleeping, startTrace, errText,
} from './helpers.js';
import { inventoryOf, itemsText, blockNames, blockIs, hdist, itemsOnGround, dist } from './world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER, countEntities } from './journey.js';

const NAME = 'w_ground';
const RADIUS = 72;
const TAG = 'mcw';
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const S = (p) => `${p.x} ${p.y} ${p.z}`;
const reply = (info) => String(info?.reply ?? '');
const NO_LEVEL_GROUND = 'I found no level ground for the bed within 4 blocks.';
const NO_WAY = /I found no way to \((-?\d+), (-?\d+), (-?\d+)\) without digging; I stopped at \((-?\d+), (-?\d+), (-?\d+)\), (\d+) blocks away\./;
const FALLBACK = /Path not found, but attempting to navigate anyway/;
const CANNOT_BREAK_SNOW = /Cannot break snow/;
// the top blocks of the natural ground a part may stand on, build on or put back
const GROUND = ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mud', 'sand', 'gravel', 'stone', 'clay', 'mycelium'];
const NOT_SOLID = ['air', 'cave_air', 'water', 'lava', 'oak_leaves', 'birch_leaves', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'snow', 'oak_log', 'birch_log'];

// ------------------------------------------------------------------ the world as the player bot sees it (W122)

const solid = (b) => Boolean(b) && b.boundingBox === 'block' && !/leaves$|_log$|_wood$/.test(b.name);
const free = (b) => Boolean(b) && b.boundingBox === 'empty' && !/water|lava/.test(b.name);
const at = (bot, x, y, z) => bot.blockAt(new Vec3(x, y, z));
const standable = (bot, x, y, z) => solid(at(bot, x, y - 1, z)) && free(at(bot, x, y, z)) && free(at(bot, x, y + 1, z));

// The top block of the ground of a column (no leaves, no log), or null; cached per column.
const tops = new Map();
function groundTop(bot, x, z) {
    const key = `${x},${z}`;
    if (tops.has(key)) return tops.get(key);
    let found = null;
    for (let y = 140; y > 30; y--) {
        const b = at(bot, x, y, z);
        if (b && b.boundingBox === 'block' && solid(b)) { found = y; break; }
    }
    tops.set(key, found);
    return found;
}

// A cell where a player can stand, about `d` blocks (horizontally) from p, within 2 blocks of its height; not in `avoid`.
function standNear(bot, p, d, avoid = []) {
    const best = [];
    const r = Math.ceil(d) + 1;
    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            const h = Math.hypot(dx, dz);
            if (Math.abs(h - d) > 0.75) continue;
            for (let dy = -2; dy <= 2; dy++) {
                const c = { x: Math.floor(p.x) + dx, y: Math.floor(p.y) + dy, z: Math.floor(p.z) + dz };
                if (avoid.some((q) => q.x === c.x && q.z === c.z)) continue;
                if (standable(bot, c.x, c.y, c.z)) best.push({ c, score: Math.abs(h - d) + Math.abs(dy) * 0.3 });
            }
        }
    }
    best.sort((a, b) => a.score - b.score);
    return best[0]?.c ?? null;
}

// A cell on a slope of the hill near the spawn: the ground 3 blocks or more higher or lower 2 blocks away; standable.
function slopeNear(bot, spawn, from = 6, to = 32, avoid = []) {
    const out = [];
    for (let dx = -to; dx <= to; dx++) {
        for (let dz = -to; dz <= to; dz++) {
            const d = Math.hypot(dx, dz);
            if (d < from || d > to) continue;
            const x = spawn.x + dx, z = spawn.z + dz;
            if (avoid.some((b) => inBoxXZ({ x, z }, b))) continue;
            const h = groundTop(bot, x, z);
            if (h === null || !standable(bot, x, h + 1, z)) continue;
            const around = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([a, b]) => groundTop(bot, x + a, z + b)).filter((y) => y !== null);
            const step = around.length ? Math.max(...around.map((y) => Math.abs(y - h))) : 0;
            if (step >= 3) out.push({ c: { x, y: h + 1, z }, step, d });
        }
    }
    out.sort((a, b) => a.d - b.d);
    return out[0] ?? null;
}

const inBoxXZ = (p, b) => p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z;
const grown = (b, n) => ({ min: { x: b.min.x - n, z: b.min.z - n }, max: { x: b.max.x + n, z: b.max.z + n } });

// The nearest flat patch of w x d columns (the north-west corner returned) within `to` blocks of the center: every top a
// ground block (GROUND), the tops within `maxStep` of each other (0: level), the 2 cells above every top free (no trunk), not
// within 2 blocks of a box of `avoid`. `exact` names a sub-box (offsets) whose tops must be level.
function flatPatch(bot, center, w, d, { to = 40, maxStep = 1, avoid = [], exact = null } = {}) {
    const groundNames = new Set(GROUND);
    let best = null;
    for (let dx = -to; dx <= to; dx++) {
        for (let dz = -to; dz <= to; dz++) {
            const x0 = center.x + dx, z0 = center.z + dz;
            const dd = Math.hypot(dx + w / 2, dz + d / 2);
            if (best && dd >= best.d) continue;
            const box = { min: { x: x0, z: z0 }, max: { x: x0 + w - 1, z: z0 + d - 1 } };
            if (avoid.some((a) => !(box.max.x < a.min.x - 2 || box.min.x > a.max.x + 2 || box.max.z < a.min.z - 2 || box.min.z > a.max.z + 2))) continue;
            let lo = Infinity, hi = -Infinity, ok = true;
            const ys = [];
            for (let i = 0; i < w && ok; i++) {
                for (let k = 0; k < d && ok; k++) {
                    const x = x0 + i, z = z0 + k;
                    const h = groundTop(bot, x, z);
                    if (h === null || !groundNames.has(at(bot, x, h, z)?.name) || !free(at(bot, x, h + 1, z)) || !free(at(bot, x, h + 2, z))) { ok = false; break; }
                    ys.push({ i, k, h });
                    lo = Math.min(lo, h); hi = Math.max(hi, h);
                }
            }
            if (!ok || hi - lo > maxStep) continue;
            if (exact) {
                const sub = ys.filter((c) => c.i >= exact.min.i && c.i <= exact.max.i && c.k >= exact.min.k && c.k <= exact.max.k).map((c) => c.h);
                if (Math.max(...sub) !== Math.min(...sub)) continue;
            }
            best = { x0, z0, y: lo, hi, d: dd, box, tops: ys };
        }
    }
    return best;
}

// Every bot.dig of the agent recorded (nothing is changed: the wrapper calls the original).
function recordDigs(bot) {
    const digs = [];
    const orig = bot.dig;
    bot.dig = async function recordedDig(block, ...rest) {
        if (block?.position) digs.push({ x: block.position.x, y: block.position.y, z: block.position.z, name: block.name, t: Date.now() });
        return orig.call(this, block, ...rest);
    };
    return { digs, stop() { bot.dig = orig; return digs; } };
}

const countOf = async (name, item) => (await inventoryOf(name))[item] || 0;

await scenarioMain({
    async main() {
        check(env.world === 'natural', 'precondition: the scenario runs in the natural world', env.world);
        const spawn = env.spawn;
        check(Boolean(spawn), 'precondition: the runner gives the world spawn', JSON.stringify(spawn));
        if (!spawn) return;
        let agent = null, orders = null, s = null;
        const made = { bed: [], pond: null, snow: null, ring: null }; // what the scenario put into the world, to take back
        try {
            const j = await startJourney(NAME, null, { botAt: spawn, playerAt: spawn, kit: [], settings: SUPERVISION_SETTINGS() });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            const player = orders.player;
            await commands([`gamemode creative ${PLAYER}`]);
            await player.waitForChunksToLoad();
            const loaded = await waitFor(() => chunksMissing(player, spawn, RADIUS).length === 0, { ms: 40000, every: 250 });
            note(`the player's chunks within ${RADIUS} blocks of the spawn ${P(spawn)}: ${loaded.ok ? `all after ${(loaded.ms / 1000).toFixed(1)} s` : `${chunksMissing(player, spawn, RADIUS).length} missing`}`);
            const used = []; // the boxes the parts take (x, z), kept apart
            const stopAll = async () => {
                if (agent.actions.executing) await orders.order('!stop', 15000);
                await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            };
            const part = async (label, fn) => {
                try { await fn(); } catch (e) { check(false, `${label}: the part ran without an exception of the harness`, errText(e).slice(0, 300)); }
                try { await stopAll(); } catch { /* the next part starts anyway */ }
            };
            const logFrom = () => (s.logs ?? []).length;
            const logLines = (from, re) => (s.logs ?? []).slice(from).flatMap((l) => String(l).split('\n')).filter((l) => re.test(l));

            // ====================================================== A. the bed on a slope
            await part('A', async () => {
                const slope = slopeNear(player, spawn, 6, 32);
                check(Boolean(slope), 'A0: precondition: a slope of the hill near the spawn (the ground 3 blocks or more higher or lower 2 blocks away)', slope ? `${P(slope.c)}, step ${slope.step}` : 'none within 32 blocks');
                if (!slope) return;
                used.push({ min: { x: slope.c.x - 6, z: slope.c.z - 6 }, max: { x: slope.c.x + 6, z: slope.c.z + 6 } });
                await placeBot(agent, slope.c, 0);
                const near = standNear(player, slope.c, 3);
                if (near) await tp(PLAYER, near);
                await giveItems(NAME, [['red_bed', 1]], agent.bot);
                const at0 = await entityPos(NAME);
                const around = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([a, b]) => groundTop(player, slope.c.x + a, slope.c.z + b));
                note(`A0: the bot on the slope at ${fmt(at0)} (the ground 2 blocks away at y ${JSON.stringify(around)}, its own ground y ${slope.c.y - 1}), the player at ${fmt(await entityPos(PLAYER))}; the bag ${itemsText(await inventoryOf(NAME))}`);
                const info = await orders.orderInfo('!placeHere("red_bed")', 60000);
                await sleep(1500);
                const bedId = player.registry.blocksByName.red_bed.id;
                const found = player.findBlocks({ point: new Vec3(at0.x, at0.y, at0.z), matching: bedId, maxDistance: 10, count: 8 }).map((p) => ({ x: p.x, y: p.y, z: p.z }));
                const halves = (await blockNames(found, ['red_bed[part=head]', 'red_bed[part=foot]'])).map((n, i) => ({ ...found[i], part: n }));
                const head = halves.find((h) => h.part === 'red_bed[part=head]') ?? null;
                const foot = halves.find((h) => h.part === 'red_bed[part=foot]') ?? null;
                note(`A1: !placeHere("red_bed") answered ${JSON.stringify(reply(info).slice(0, 300))}; red bed blocks within 10 blocks (server) ${JSON.stringify(halves)}; the bot at ${fmt(await entityPos(NAME))}, the bag ${itemsText(await inventoryOf(NAME))}`);
                if (head && foot) made.bed = [head, foot];
                const noLevel = reply(info).includes(NO_LEVEL_GROUND);
                if (!(head && foot)) {
                    check(noLevel, `A1: the bed was placed, or the answer is \`${NO_LEVEL_GROUND}\``, JSON.stringify(reply(info).slice(0, 200)));
                    if (noLevel) note('A1: no level ground within 4 blocks of this slope: the bed checks and the sleep are skipped (the text of 8.11 was said)');
                    return;
                }
                const supports = [{ ...head, y: head.y - 1 }, { ...foot, y: foot.y - 1 }];
                const above = [{ ...head, y: head.y + 1 }, { ...foot, y: foot.y + 1 }];
                const supportNames = await blockNames(supports, NOT_SOLID);
                const aboveNames = await blockNames(above, ['air', 'cave_air']);
                const neighbours = supports.flatMap((sp) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ x: sp.x + a, y: sp.y, z: sp.z + b })));
                const nbNames = await blockNames(neighbours, NOT_SOLID);
                const solidNb = [0, 1].map((i) => nbNames.slice(i * 4, i * 4 + 4).filter((n) => n === null).length);
                const sides = [head, foot].flatMap((h) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ x: h.x + a, y: h.y, z: h.z + b })))
                    .filter((c) => !(c.x === head.x && c.z === head.z) && !(c.x === foot.x && c.z === foot.z));
                const sideAir = await blockNames(sides, ['air', 'cave_air']);
                const sideFloor = await blockNames(sides.map((c) => ({ ...c, y: c.y - 1 })), NOT_SOLID);
                const standCells = sides.filter((c, i) => sideAir[i] && sideFloor[i] === null);
                const level = head.y === foot.y && supportNames.every((n) => n === null) && aboveNames.every(Boolean);
                note(`A1: the bed ${P(foot)} -> ${P(head)}, ${hdist(foot, at0).toFixed(1)} blocks from where the bot stood; the supports ${JSON.stringify(supportNames)} (null: solid), above ${JSON.stringify(aboveNames)}, solid neighbours of the supports ${JSON.stringify(solidNb)}, cells to stand on beside it ${standCells.length}`);
                check(level, 'A1: the bed lies on level ground: both halves at one height, both support blocks solid, air above both (server)', `heights ${foot.y}/${head.y}, supports ${JSON.stringify(supportNames)}, above ${JSON.stringify(aboveNames)}`);
                check(solidNb.every((n) => n >= 2), 'A1: each support block has 2 solid neighbours or more at its level (no pillar)', JSON.stringify(solidNb));
                check(standCells.length >= 1, 'A1: a free cell beside the bed to stand on', `${standCells.length}`);
                check(hdist(foot, at0) <= 4.5 || hdist(head, at0) <= 4.5, 'A1: the bed lies within 4 blocks of where the bot stood when ordered', `${Math.min(hdist(foot, at0), hdist(head, at0)).toFixed(1)} blocks`);
                await commands(['time set 13000']);
                const tBed = Date.now();
                const bed = orders.orderInfo('!goToBed', 120000);
                const asleep = await waitFor(() => serverSleeping(NAME), { ms: 60000, every: 500 });
                note(`A2: at night !goToBed: the bot ${asleep.ok ? `sleeps after ${(asleep.ms / 1000).toFixed(1)} s` : 'does NOT sleep within 60 s'} at ${fmt(await entityPos(NAME))}; it said ${JSON.stringify(saidLines(s, tBed).slice(0, 6))}`);
                check(asleep.ok, 'A2: at night the typed !goToBed sleeps in the bed on the slope (server)', asleep.ok ? `${(asleep.ms / 1000).toFixed(1)} s` : JSON.stringify(saidLines(s, tBed).slice(0, 4)));
                if (asleep.ok) {
                    await sleep(1500);
                    await orders.order('!stop', 10000);
                    await waitFor(async () => !(await serverSleeping(NAME)), { ms: 10000, every: 250 });
                }
                const bedInfo = await Promise.race([bed, sleep(15000).then(() => null)]);
                note(`A2: !goToBed answered ${bedInfo ? JSON.stringify(reply(bedInfo).slice(0, 200)) : '(no answer within 15 s of the stop)'}`);
                await commands(['time set 6000']);
            });

            // ====================================================== B. the give beside a pond
            await part('B', async () => {
                // a flat patch of 5 x 8: the pond in its south part (columns 1..3, rows 5..7), the player at row 4, the bot at row 0
                const patch = flatPatch(player, spawn, 5, 8, { to: 40, maxStep: 1, avoid: used, exact: { min: { i: 1, k: 5 }, max: { i: 3, k: 7 } } });
                check(Boolean(patch), 'B0: precondition: a flat patch of 5 x 8 for the pond within 40 blocks of the spawn', patch ? `${P({ x: patch.x0, y: patch.y, z: patch.z0 })}, ${patch.d.toFixed(1)} blocks` : 'none');
                if (!patch) return;
                used.push(grown(patch.box, 0));
                const topAt = (i, k) => patch.tops.find((c) => c.i === i && c.k === k).h;
                const pond = [];
                for (let i = 1; i <= 3; i++) for (let k = 5; k <= 7; k++) pond.push({ x: patch.x0 + i, y: topAt(i, k), z: patch.z0 + k });
                const before = await blockNames(pond, GROUND);
                await commands(pond.map((p) => `setblock ${S(p)} minecraft:water`));
                made.pond = pond.map((p, i) => ({ ...p, was: before[i] ?? 'grass_block' }));
                const playerCell = { x: patch.x0 + 2, y: topAt(2, 4) + 1, z: patch.z0 + 4 };
                const botCell = { x: patch.x0 + 2, y: topAt(2, 0) + 1, z: patch.z0 };
                await tp(PLAYER, playerCell, 180, 0);
                await placeBot(agent, botCell, 0);
                await commands([`clear ${PLAYER} minecraft:bread`, `kill @e[type=minecraft:item,x=${patch.x0 - 4},y=${patch.y - 3},z=${patch.z0 - 4},dx=13,dy=8,dz=16]`]);
                await giveItems(NAME, [['bread', 8]], agent.bot);
                const isWater = await blockNames(pond, ['water']);
                const pp = await entityPos(PLAYER), bp = await entityPos(NAME);
                note(`B0: the pond ${P(pond[0])} to ${P(pond[8])} (${isWater.filter(Boolean).length} of 9 water; was ${JSON.stringify(before)}); the player at ${fmt(pp)} with the water 1 block behind him, the bot at ${fmt(bp)}, ${hdist(bp, pp).toFixed(1)} blocks in front of him; the bot carries ${await countOf(NAME, 'bread')} bread, the player ${await countOf(PLAYER, 'bread')}`);
                check(isWater.every(Boolean) && (await countOf(NAME, 'bread')) === 8 && (await countOf(PLAYER, 'bread')) === 0, 'B0: precondition: 9 water blocks behind the player, 8 bread with the bot, none with the player', `${isWater.filter(Boolean).length} water, bot ${await countOf(NAME, 'bread')}, player ${await countOf(PLAYER, 'bread')}`);
                const trace = startTrace(async () => ({ bot: await entityPos(NAME) }), 500);
                const tG = Date.now();
                const give = orders.orderInfo('!givePlayer("w_player", "bread", 8)', 60000);
                const got = await waitFor(async () => (await countOf(PLAYER, 'bread')) >= 8 && (await countOf(NAME, 'bread')) === 0, { ms: 20000, every: 500 });
                const info = await Promise.race([give, sleep(40000).then(() => null)]);
                const rows = await trace.stop();
                const pondBox = { min: { x: patch.x0, y: patch.y - 1, z: patch.z0 + 4 }, max: { x: patch.x0 + 4, y: patch.y + 3, z: patch.z0 + 8 } };
                const inWater = (await itemsOnGround(pondBox)).filter((x) => x.name === 'bread');
                const pl = await countOf(PLAYER, 'bread'), bl = await countOf(NAME, 'bread');
                const nearest = rows.map((r) => r.bot).filter(Boolean).reduce((m, p) => (hdist(p, pp) < m.d ? { d: hdist(p, pp), p } : m), { d: Infinity, p: null });
                note(`B1: after ${((Date.now() - tG) / 1000).toFixed(1)} s the player holds ${pl} bread, the bot ${bl}; bread in the pond ${JSON.stringify(inWater)}; the bot came as near as ${nearest.d.toFixed(1)} blocks at ${fmt(nearest.p)}; the answer ${info ? JSON.stringify(reply(info).slice(0, 300)) : '(still running)'}; the bot said ${JSON.stringify(saidLines(s, tG).slice(0, 5))}`);
                check(got.ok && pl >= 8 && bl === 0, 'B1: within 20 s the player at the edge of the pond holds the 8 bread and the bot none (server)', `player ${pl}, bot ${bl}${got.ok ? ` after ${(got.ms / 1000).toFixed(1)} s` : ''}`);
                check(Boolean(info) && reply(info).includes('I gave you 8 bread.'), 'B1: the answer is `I gave you 8 bread.`', info ? JSON.stringify(reply(info).slice(0, 200)) : 'no answer');
                check(inWater.length === 0, 'B1: no bread lies in the pond', JSON.stringify(inWater));
            });

            // ====================================================== C. a summoned sheep killed
            await part('C', async () => {
                const bp = await entityPos(NAME);
                const here = { x: Math.floor(bp.x), y: Math.floor(bp.y + 0.01), z: Math.floor(bp.z) };
                const spot = standNear(player, here, 3) ?? standNear(player, here, 2);
                check(Boolean(spot), 'C0: precondition: a cell 3 blocks from the bot for the sheep', spot ? P(spot) : 'none');
                if (!spot) return;
                await commands([`kill @e[type=minecraft:item,x=${here.x - 10},y=${here.y - 4},z=${here.z - 10},dx=20,dy=10,dz=20]`, `clear ${NAME} minecraft:white_wool`, `clear ${NAME} minecraft:mutton`]);
                await giveItems(NAME, [['stone_sword', 1]], agent.bot);
                const away = standNear(player, here, 8) ?? standNear(player, here, 6);
                if (away) await tp(PLAYER, away);
                const summoned = await command(`summon minecraft:sheep ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5} {PersistenceRequired:1b,Color:0b,Tags:["${TAG}","${TAG}_sheep"]}`);
                const seen = await waitFor(() => Object.values(agent.bot.entities).some((e) => e?.name === 'sheep'), { ms: 8000, every: 100 });
                note(`C0: ${JSON.stringify(summoned)} at ${P(spot)}, ${hdist(spot, bp).toFixed(1)} blocks from the bot at ${fmt(bp)}; the bot sees it: ${seen.ok}; the bag ${itemsText(await inventoryOf(NAME))}`);
                check(seen.ok && (await countEntities(`@e[type=minecraft:sheep,tag=${TAG}_sheep]`)) === 1, 'C0: precondition: one sheep 3 blocks from the bot, seen by it', String(seen.ok));
                const tK = Date.now();
                const kill = orders.orderInfo('!attack("sheep")', 90000);
                const dead = await waitFor(async () => (await countEntities(`@e[type=minecraft:sheep,tag=${TAG}_sheep]`)) === 0, { ms: 60000, every: 500 });
                const tDead = Date.now();
                const picked = await waitFor(async () => { const inv = await inventoryOf(NAME); return (inv.white_wool || 0) >= 1 && (inv.mutton || 0) >= 1 ? inv : null; }, { ms: 10000, every: 500 });
                const info = await Promise.race([kill, sleep(20000).then(() => null)]);
                const inv = picked.value ?? await inventoryOf(NAME);
                const kp = await entityPos(NAME);
                const left = (await itemsOnGround({ min: { x: Math.floor(kp.x) - 8, y: Math.floor(kp.y) - 4, z: Math.floor(kp.z) - 8 }, max: { x: Math.floor(kp.x) + 8, y: Math.floor(kp.y) + 4, z: Math.floor(kp.z) + 8 } })).filter((x) => /wool|mutton/.test(x.name ?? ''));
                const m = /Picked up (\d+) items?\./.exec(reply(info));
                note(`C1: the sheep ${dead.ok ? `died after ${(dead.ms / 1000).toFixed(1)} s` : 'is NOT dead after 60 s'}; the bag ${picked.ok ? `held wool and mutton ${((Date.now() - tDead) / 1000).toFixed(1)} s after the death` : 'holds no wool and mutton 10 s after'}: ${itemsText(inv)}; drops left within 8 blocks ${JSON.stringify(left)}; the answer ${info ? JSON.stringify(reply(info).slice(0, 300)) : '(still running)'}; the bot said ${JSON.stringify(saidLines(s, tK).slice(0, 5))}`);
                check(dead.ok, 'C1: !attack("sheep") kills the sheep within 60 s (server)', dead.ok ? `${(dead.ms / 1000).toFixed(1)} s` : 'alive');
                check(picked.ok, 'C1: within 10 s of the death the bag holds the wool and the mutton of the sheep (server; the drop lands late, P-26)', itemsText(inv));
                check(Boolean(info) && /Successfully killed sheep\./.test(reply(info)) && Boolean(m) && Number(m[1]) >= 1, 'C1: the answer says `Successfully killed sheep.` and `Picked up N items.` with N 1 or more (what the bag gained)', info ? JSON.stringify(reply(info).slice(0, 200)) : 'no answer');
                check(left.length === 0, 'C1: no wool or mutton lies on the ground within 8 blocks of the bot', JSON.stringify(left));
            });

            // ====================================================== D. a snow field crossed without a shovel
            await part('D', async () => {
                const patch = flatPatch(player, spawn, 6, 6, { to: 40, maxStep: 1, avoid: used });
                check(Boolean(patch), 'D0: precondition: a flat patch of 6 x 6 grass for the snow field within 40 blocks of the spawn', patch ? `${P({ x: patch.x0, y: patch.y, z: patch.z0 })}, ${patch.d.toFixed(1)} blocks` : 'none');
                if (!patch) return;
                used.push(grown(patch.box, 0));
                const mid = { x: patch.x0 + 3, z: patch.z0 + 3 };
                const midTop = groundTop(player, mid.x, mid.z);
                // a goal 8 blocks beyond an edge of the field, on standable ground within 3 blocks of the field's height
                let goal = null;
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const gx = mid.x + dx * 11, gz = mid.z + dz * 11;
                    const h = groundTop(player, gx, gz);
                    if (h !== null && Math.abs(h - midTop) <= 3 && standable(player, gx, h + 1, gz)) { goal = { x: gx, y: h + 1, z: gz, dir: `${dx},${dz}` }; break; }
                }
                check(Boolean(goal), 'D0: precondition: a standable goal 8 blocks beyond an edge of the field', goal ? P(goal) : 'none');
                if (!goal) return;
                await commands([`clear ${NAME}`]);
                const snow = { min: { x: patch.x0, y: patch.y, z: patch.z0 }, max: { x: patch.x0 + 5, y: patch.hi + 2, z: patch.z0 + 5 } };
                const snowCells = patch.tops.map((c) => ({ x: patch.x0 + c.i, y: c.h + 1, z: patch.z0 + c.k }));
                // one layer of snow on every cell, a setblock each (a fill that replaces air leaves the cells with a grass plant bare)
                const fill = (await commands(snowCells.map((c) => `setblock ${S(c)} minecraft:snow`))).flat().filter((l) => /Changed the block/.test(l)).length;
                made.snow = snow;
                await placeBot(agent, { x: mid.x, y: midTop + 1, z: mid.z }, 0);
                const laid = (await blockNames(snowCells, ['snow'])).filter(Boolean).length;
                const far = standNear(player, { x: goal.x, y: goal.y, z: goal.z }, 3);
                if (far) await tp(PLAYER, far);
                const inv0 = await inventoryOf(NAME);
                note(`D0: the snow field ${P(snow.min)} to ${P(snow.max)}: ${JSON.stringify(fill)}, ${laid} of 36 cells hold snow; the bot in its middle at ${fmt(await entityPos(NAME))}; the goal ${P(goal)} (direction ${goal.dir}); the bag ${itemsText(inv0)}`);
                check(laid >= 30 && !Object.keys(inv0).some((k) => /shovel/.test(k)), 'D0: precondition: snow layers on the field (30 of 36 cells or more), no shovel in the bag', `${laid} snow, ${itemsText(inv0)}`);
                const from = logFrom();
                const tW = Date.now();
                const walk = orders.orderInfo(`!goToCoordinates(${goal.x}, ${goal.y}, ${goal.z}, 1)`, 120000);
                const there = await waitFor(async () => { const p = await entityPos(NAME); return p && dist(p, { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 }) <= 2.5 ? p : null; }, { ms: 120000, every: 500 });
                const info = await Promise.race([walk, sleep(20000).then(() => null)]);
                const cannot = logLines(from, CANNOT_BREAK_SNOW);
                const snowLeft = (await blockNames(snowCells, ['snow'])).filter(Boolean).length;
                note(`D1: ${there.ok ? `the bot arrived after ${(there.ms / 1000).toFixed(1)} s` : 'the bot did NOT arrive within 120 s'} at ${fmt(await entityPos(NAME))}; the answer ${info ? JSON.stringify(reply(info).slice(0, 300)) : '(still running)'}; "Cannot break snow" lines ${cannot.length}; ${snowLeft} of ${laid} snow layers left; the bot said ${JSON.stringify(saidLines(s, tW).slice(0, 5))}`);
                check(there.ok, 'D1: the bot crosses the snow field without a shovel: within 120 s it stands within 2 blocks of the goal beyond it (server)', fmt(await entityPos(NAME)));
                check(cannot.length === 0 && !CANNOT_BREAK_SNOW.test(reply(info)), 'D1: no `Cannot break snow with current tools` (snow is breakable by hand, 8.3.2)', JSON.stringify([...cannot.slice(0, 2), reply(info).slice(0, 120)]));
                if (!info) note(`D1: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
                await stopAll();

                // D2: snow blocks in the way: a ring of snow_block 2 high around the bot back in the middle of the field (3 x 3
                // inside); the same goal beyond. The path finder must break snow blocks (they drop only with a shovel): before
                // the fix "Pathfinding stopped: Cannot break snow_block with current tools" and the bot stays, after it digs by hand
                await placeBot(agent, { x: mid.x, y: midTop + 1, z: mid.z }, 0);
                const ring = [];
                for (let dx = -2; dx <= 2; dx++) {
                    for (let dz = -2; dz <= 2; dz++) {
                        if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
                        const h = groundTop(player, mid.x + dx, mid.z + dz) ?? midTop;
                        ring.push({ x: mid.x + dx, y: h + 1, z: mid.z + dz }, { x: mid.x + dx, y: h + 2, z: mid.z + dz });
                    }
                }
                await commands(ring.map((c) => `setblock ${S(c)} minecraft:snow_block`));
                made.ring = ring;
                const ringLaid = (await blockNames(ring, ['snow_block'])).filter(Boolean).length;
                note(`D2: a ring of ${ringLaid} of ${ring.length} snow blocks, 2 high, around the bot at ${fmt(await entityPos(NAME))}; the goal ${P(goal)} again; the bag ${itemsText(await inventoryOf(NAME))}`);
                check(ringLaid >= ring.length - 4, 'D2: precondition: a ring of snow blocks 2 high stands around the bot', `${ringLaid} of ${ring.length}`);
                const from2 = logFrom();
                const tW2 = Date.now();
                const walk2 = orders.orderInfo(`!goToCoordinates(${goal.x}, ${goal.y}, ${goal.z}, 1)`, 150000);
                const there2 = await waitFor(async () => { const p = await entityPos(NAME); return p && dist(p, { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 }) <= 2.5 ? p : null; }, { ms: 150000, every: 500 });
                const info2 = await Promise.race([walk2, sleep(20000).then(() => null)]);
                const cannot2 = logLines(from2, CANNOT_BREAK_SNOW);
                const ringLeft = (await blockNames(ring, ['snow_block'])).filter(Boolean).length;
                note(`D2: ${there2.ok ? `the bot arrived after ${(there2.ms / 1000).toFixed(1)} s` : 'the bot did NOT arrive within 150 s'} at ${fmt(await entityPos(NAME))}; the answer ${info2 ? JSON.stringify(reply(info2).slice(0, 300)) : '(still running)'}; "Cannot break snow" lines ${cannot2.length}; ${ringLeft} of ${ringLaid} snow blocks left; the bot said ${JSON.stringify(saidLines(s, tW2).slice(0, 5))}`);
                check(there2.ok && ringLeft < ringLaid, 'D2: ringed by snow blocks without a shovel, the bot breaks through (snow blocks gone) and reaches the goal within 150 s (server)', `arrived ${there2.ok}, ${ringLeft} of ${ringLaid} snow blocks left`);
                check(cannot2.length === 0 && !CANNOT_BREAK_SNOW.test(reply(info2)), 'D2: no `Cannot break snow_block with current tools` (snow blocks break by hand, 8.3.2)', JSON.stringify([...cannot2.slice(0, 2), reply(info2).slice(0, 120)]));
                if (!info2) note(`D2: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            });

            // ====================================================== E. a way of 60 blocks behind the hill
            await part('E', async () => {
                const start = standNear(player, spawn, 2) ?? spawn;
                const startTop = groundTop(player, start.x, start.z) ?? start.y - 1;
                // the direction in which the ground rises most within 50 blocks (a hill between), with a standable goal at 60
                const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => { const n = Math.hypot(a, b); return [a / n, b / n]; });
                let best = null;
                for (const [ux, uz] of dirs) {
                    let rise = -Infinity;
                    for (let d = 10; d <= 50; d += 5) {
                        const h = groundTop(player, Math.round(start.x + ux * d), Math.round(start.z + uz * d));
                        if (h !== null) rise = Math.max(rise, h - startTop);
                    }
                    let goal = null;
                    for (let r = 0; r <= 6 && !goal; r++) {
                        for (let dd = -r; dd <= r && !goal; dd++) {
                            const gx = Math.round(start.x + ux * 60) + dd, gz = Math.round(start.z + uz * 60) + (r - Math.abs(dd));
                            const h = groundTop(player, gx, gz);
                            if (h !== null && standable(player, gx, h + 1, gz) && Math.abs(hdist({ x: gx, z: gz }, start) - 60) <= 6) goal = { x: gx, y: h + 1, z: gz };
                        }
                    }
                    if (goal && rise > -Infinity && (!best || rise > best.rise)) best = { goal, rise, dir: `${ux.toFixed(1)},${uz.toFixed(1)}` };
                }
                check(Boolean(best), 'E0: precondition: a standable goal 60 blocks from the start with the ground rising between (the hill)', best ? `${P(best.goal)}, the ground rises ${best.rise} blocks on the way` : 'none');
                if (!best) return;
                const goal = best.goal;
                await commands([`clear ${NAME}`]);
                await giveItems(NAME, [['stone_pickaxe', 1], ['bread', 4]], agent.bot);
                await placeBot(agent, start, 0);
                const far = standNear(player, goal, 3);
                if (far) await tp(PLAYER, far);
                const at0 = await entityPos(NAME);
                const startY = Math.floor(at0.y + 0.01);
                note(`E0: the bot at ${fmt(at0)} (start level y ${startY}, the ground y ${startTop}); the goal ${P(goal)}, ${hdist(goal, at0).toFixed(1)} blocks away in direction ${best.dir}, the ground rises ${best.rise} blocks between; the bag ${itemsText(await inventoryOf(NAME))}`);
                const digs = recordDigs(agent.bot);
                const trace = startTrace(async () => ({ bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 500);
                const from = logFrom();
                const tW = Date.now();
                const walk = orders.orderInfo(`!goToCoordinates(${goal.x}, ${goal.y}, ${goal.z}, 1)`, 240000);
                const there = await waitFor(async () => { const p = await entityPos(NAME); return p && dist(p, { x: goal.x + 0.5, y: goal.y, z: goal.z + 0.5 }) <= 2.5 ? p : null; }, { ms: 240000, every: 500 });
                const info = there.ok ? await Promise.race([walk, sleep(20000).then(() => null)]) : await Promise.race([walk, sleep(5000).then(() => null)]);
                const rows = await trace.stop();
                const dug = digs.stop();
                const end = await entityPos(NAME);
                const gone = dug.length ? await blockNames(dug.map((d) => ({ x: d.x, y: d.y, z: d.z })), ['air', 'cave_air']) : [];
                const dugCells = dug.filter((d, i) => gone[i]);
                const below = dugCells.filter((d) => d.y < startY - 1);
                const lowest = rows.map((r) => r.bot?.y).filter(Number.isFinite).reduce((m, y) => Math.min(m, y), Infinity);
                const fallback = logLines(from, FALLBACK);
                const paths = logLines(from, /Found (non-)?destructive path\./);
                const text = reply(info);
                const m = NO_WAY.exec(text);
                const stopNear = m ? dist({ x: Number(m[4]) + 0.5, y: Number(m[5]), z: Number(m[6]) + 0.5 }, end) <= 2.5 : false;
                const goalNamed = m ? Number(m[1]) === goal.x && Number(m[2]) === goal.y && Number(m[3]) === goal.z : false;
                const nOk = m ? Math.abs(Number(m[7]) - hdist(end, goal)) <= 3 : false;
                note(`E1: after ${((Date.now() - tW) / 1000).toFixed(0)} s the bot is at ${fmt(end)}, ${hdist(end, goal).toFixed(1)} blocks from the goal (${there.ok ? 'arrived' : 'not arrived'}); the lowest feet on the way y ${lowest.toFixed(1)} (start ${startY}); ${dug.length} dig calls, ${dugCells.length} cells gone, ${below.length} below the start level minus 1 ${JSON.stringify(below.slice(0, 6).map((d) => `${d.name} ${P(d)}`))}; path lines ${JSON.stringify(paths.slice(0, 4))}, fallback lines ${fallback.length}; the answer ${info ? JSON.stringify(text.slice(0, 300)) : '(still running)'}`);
                check(below.length === 0, 'E1: no block was dug below the start level minus 1 on the way of 60 blocks (no tunnel; the cells the bot dug, read from the server) (8.3.1)', `${below.length} of ${dugCells.length} dug cells below y ${startY - 1}: ${JSON.stringify(below.slice(0, 4).map(P))}`);
                check(fallback.length === 0 && !FALLBACK.test(text), 'E2: a way longer than 32 blocks has no destructive fallback (`Path not found, but attempting to navigate anyway`) (8.3.1)', JSON.stringify(fallback.slice(0, 2)));
                check(there.ok || (Boolean(m) && goalNamed && stopNear && nOk), 'E3: the bot arrived within 2 blocks of the goal, or its answer is `I found no way to (x, y, z) without digging; I stopped at (x, y, z), N blocks away.` with the goal, where it stands and the distance (8.11)',
                    there.ok ? `arrived at ${fmt(end)}` : `${JSON.stringify(text.slice(0, 200))}; goal named ${goalNamed}, stop within 2 blocks ${stopNear}, N right ${nOk}`);
                if (!info) note(`E3: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            });

            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            // the world back: the bed, the pond, the snow and what the parts left
            try {
                const back = [];
                for (const h of made.bed) back.push(`setblock ${S(h)} minecraft:air`);
                if (made.pond) for (const p of made.pond) back.push(`setblock ${S(p)} minecraft:${p.was}`);
                if (made.snow) back.push(`fill ${S({ x: made.snow.min.x, y: made.snow.min.y + 1, z: made.snow.min.z })} ${S(made.snow.max)} minecraft:air replace minecraft:snow`);
                if (made.ring) for (const c of made.ring) back.push(`setblock ${S(c)} minecraft:air`);
                back.push(`kill @e[tag=${TAG}_sheep]`, `kill @e[type=minecraft:item,x=${spawn.x - 80},y=-64,z=${spawn.z - 80},dx=160,dy=400,dz=160]`, `clear ${NAME}`, `clear ${PLAYER}`, 'time set 6000');
                const out = await commands(back, 60000);
                note(`the world back: ${made.bed.length} bed blocks, ${made.pond ? made.pond.length : 0} pond blocks, ${made.snow ? 'the snow' : 'no snow'}; ${out.flat().filter((l) => /Could not|Unknown|Incorrect/.test(l)).length} commands refused`);
            } catch (e) { note(`the world back: ${errText(e).slice(0, 200)}`); }
            if (orders) await orders.quit();
            await stopRealAgent(agent);
        }
    },
});
exitSoon();
