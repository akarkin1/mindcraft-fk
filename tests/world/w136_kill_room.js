// W136 the kill room (entry `the_kill_room`; v0.1.4.16 "Stability, and three packs", round two, tester T5; PLAN.md section 5 "The AFK
// creeper kill", SPEC section 8.4 and 8.6, the facts of lead/creeper-farm-facts.md): the AFK kill pack. The bot climbs the ladder down to
// the saved kill spot, sneaks under the slab, kills what lands on the hoppers with one hit each, the drops go into the chests, the XP to
// the bot, it stops at the level the owner named and at low health, `creeper_safety` is off at the spot and on again outside, and a room
// without the slab is refused. Against 5abf721 (round one, no pack) `!killFarm` answers `Command '!killFarm' does not exist.` and every
// check of 1 to 3 fails from there; on the release every check passes.
//
// The base world; the control builds the room in the sky at y 170 (the owner's hoppers lie at y 170 to 171, 110 blocks over his ground):
// a stone floor at y 169 (7 x 6), walls 3 high around a room of 5 x 4 (x -2..2, z -1..2 from the origin), lit by glowstone in the floor
// (the runner spawns no mobs anyway); three hoppers at y 170 in the row z -1 with a chest under the outer two (the drops of the hoppers
// land in them), the north wall behind them is the 2-block drop face; a row of oak slabs (bottom half) at y 172 over the row z 0, at the
// hoppers' y + 2: the creeper on a hopper stands at y 171 with its eyes at 172.4, the slab breaks its line of sight to the sneaking bot's
// eyes at 171.3 (the facts, "a half block at the creeper's eye level"); the kill spot is the cell (0, 170, 1), one block south of the
// slab row, two from the hoppers; a ladder on the east wall from y 170 up to y 179 (facing west, on a pillar) and a platform of 5 x 5 at
// y 179 east of it with a parapet, the bot's start of the farm at (6, 180, 0), 10 blocks over the room. The owner's switches
// (SUPERVISION_SETTINGS) with the switch of the pack, `afk_kill`, on; the modes of his profile, an empty memory; a stone sword and 8
// bread in the bag. Difficulty normal while creepers are needed (peaceful removes them at once), peaceful again at the end. Console
// names of 26.1.
//   0. The bot starts AT the spot (the control places it there, as at every start) and the owner types `!rememberHere("kill_spot")`
//      (the place is the bot's own position; SPEC 8.4 "the owner saves it standing at his spot"); then a typed `!goToCoordinates` to the
//      platform: the bot climbs the ladder up by itself (checked; the farm starts from there as SPEC 8.6 says).
//   1. `/xp set 0`, difficulty normal; typed `!killFarm("level 2")`. Once the bot is within 3 blocks of the spot (or after 90 s) the
//      control summons a creeper on a hopper every 10 s (`Health:4f`, `NoAI:1b`, persistent, tagged), alternating the two hoppers over the
//      chests, 20 at most, until the order ends. Level 2 is 16 XP, a creeper gives 5: four kills. Within 7 minutes: 1a the start line
//      `I farm creepers at the kill spot. Stay more than 128 blocks away or log out, so the farm's monsters get the cap.` once; 1b the
//      climb down (the trace holds the bot in the ladder column, then at the spot); 1c the sneak at the spot (the bot's own sneak control,
//      and the player's view of the entity: crouching); 1d hits (`bot.attack`, recorded) and kills (summoned creepers gone, 4 or more);
//      1e XP: level 2 or more (server `/xp query` and the bot's `bot.experience`); 1f gunpowder in the chests, the hoppers or the bag (a
//      creeper drops 0 to 2: four kills give none in 1 of 80 runs, noted); 1g the stop line `I stop the farming: level 2 reached; N
//      creepers, <time>; M gunpowder stored.`; 1h the bot leaves by the ladder to where it stood (the platform, y 179 or higher) within
//      90 s; 1i `creeper_safety` is off at the spot (bot.modes), silent (no mode run, no creeper line), and on again after the order.
//   2. Creepers cleared, `/xp set 0`; typed `!killFarm()` (open-ended); creepers again; after the first kill at the spot `/damage <bot>
//      12`: 2a `I leave the kill room: health N.` with N under 10 (20 - 12 = 8; the spec's example says 9: regeneration may add one
//      before the loop reads it); 2b the bot above the room within 90 s; 2c `creeper_safety` on again; 2d the bot never died.
//   3. The slab row taken away; typed `!killFarm("level 2")`: 3a `The kill room has no slab over the hoppers; I do not farm there.`
//      within 120 s and the order ends; 3b no farming: a creeper summoned on a hopper after the refusal is alive 30 s later, no hit, no XP.
// Throughout: the process lives, zero model calls, no request reached a real model.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, readWorldFile, startTrace,
    printTrace, recordMoves,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, buildChest, chestItems, blockNames, inBox, hdist, itemsOnGround, inventoryOf } from './world.js';
import { BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, countEntities } from './journey.js';
import { TAG, run, cellText } from './small_base.js';

const NAME = 'w_killer';
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const RY = 170; // the hoppers' y and the feet of the bot in the room
const CREEPER_TAG = `${TAG}_creeper`;
const MAX_CREEPERS = 20;
const SUMMON_EVERY_MS = 10000;
const MODE = 'mode:creeper_safety';

// ---- SPEC 8.4, the texts word for word
const START_SPEC = "I farm creepers at the kill spot. Stay more than 128 blocks away or log out, so the farm's monsters get the cap.";
// DECISIONS B-10 (E8's probe: the XP orbs reach the bot only with a one-block gap over the first hopper row): the start line asks for it
const START_GAP = 'Leave a one-block gap above the first hopper row, or the XP stays behind the slab.';
const START_LINE = `${START_SPEC} ${START_GAP}`;
const STOP_LEVEL = /^I stop the farming: level 2 reached; (\d+) creepers?, (.+?); (\d+) gunpowder stored\.$/;
const LEAVE_HEALTH = /^I leave the kill room: health (\d+)\.$/;
const NO_SLAB = 'The kill room has no slab over the hoppers; I do not farm there.';
const NO_COMMAND = /does not exist/;
// the lines of the creeper reflex (home/creeper.js) that must not be said while the farm runs
const CREEPER_LINE = /creeper/i;

const textOf = (s, t, re, reply) => saidLines(s, t).find((l) => re.test(l)) ?? (re.test(String(reply ?? '')) ? String(reply) : null);
const exact = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

// The room at the origin: every cell by name, for the build and the checks.
function roomPlan(ox, oz) {
    const floorY = RY - 1;
    const spot = { x: ox, y: RY, z: oz + 1 };
    const hoppers = [-1, 0, 1].map((dx) => ({ x: ox + dx, y: RY, z: oz - 1 }));
    const chests = [hoppers[0], hoppers[2]].map((hp) => ({ x: hp.x, y: floorY, z: hp.z }));
    const slabs = [-1, 0, 1].map((dx) => ({ x: ox + dx, y: RY + 2, z: oz }));
    const interior = { min: { x: ox - 2, y: RY, z: oz - 1 }, max: { x: ox + 2, y: RY + 2, z: oz + 2 } };
    const outer = { min: { x: ox - 3, y: floorY, z: oz - 2 }, max: { x: ox + 3, y: RY + 2, z: oz + 3 } };
    const column = { x: ox + 2, z: oz + 1 };
    const pillar = { x: ox + 3, z: oz + 1 };
    const ladders = [];
    for (let y = RY; y <= RY + 9; y++) ladders.push({ x: column.x, y, z: column.z });
    const platformY = RY + 9; // the blocks; feet at RY + 10 = 180
    const platform = { min: { x: ox + 3, y: platformY, z: oz - 1 }, max: { x: ox + 7, y: platformY, z: oz + 3 } };
    const exit = { x: ox + 3, y: platformY + 1, z: oz + 1 };
    const parapet = [];
    for (let x = platform.min.x; x <= platform.max.x; x++) for (let z = platform.min.z; z <= platform.max.z; z++) {
        const edge = x === platform.min.x || x === platform.max.x || z === platform.min.z || z === platform.max.z;
        if (edge && !(x === exit.x && z === exit.z)) parapet.push({ x, y: platformY + 1, z });
    }
    return {
        floorY, spot, hoppers, chests, slabs, interior, outer, column, pillar, ladders, platform, exit, parapet,
        glow: [[-2, -1], [2, -1], [-2, 2], [2, 2]].map(([dx, dz]) => ({ x: ox + dx, y: floorY, z: oz + dz })),
        botStart: { x: ox + 6, y: platformY + 1, z: oz },
        playerAt: { x: ox + 4, y: platformY + 1, z: oz + 2 },
        roomBox: { min: { x: ox - 3, y: floorY - 1, z: oz - 2 }, max: { x: ox + 3, y: RY + 4, z: oz + 3 } },
    };
}

async function buildRoom(k) {
    const o = k.outer;
    await run([
        `fill ${o.min.x} ${k.floorY - 1} ${o.min.z} ${o.max.x} ${k.platform.max.y + 2} ${k.platform.max.z} minecraft:air`,
        `fill ${o.min.x} ${k.floorY} ${o.min.z} ${o.max.x} ${k.floorY} ${o.max.z} minecraft:stone`,
        `fill ${o.min.x} ${RY} ${o.min.z} ${o.max.x} ${RY + 2} ${o.max.z} minecraft:stone`,
        `fill ${k.interior.min.x} ${k.interior.min.y} ${k.interior.min.z} ${k.interior.max.x} ${k.interior.max.y} ${k.interior.max.z} minecraft:air`,
        ...k.glow.map((p) => `setblock ${P(p)} minecraft:glowstone`),
        `fill ${k.pillar.x} ${k.floorY} ${k.pillar.z} ${k.pillar.x} ${k.platform.max.y} ${k.pillar.z} minecraft:stone`,
        `fill ${P(k.platform.min)} ${P(k.platform.max)} minecraft:stone`,
        ...k.parapet.map((p) => `setblock ${P(p)} minecraft:stone`),
        ...k.ladders.map((p) => `setblock ${P(p)} minecraft:ladder[facing=west]`),
    ], 'the room, the pillar, the platform');
    for (const c of k.chests) await buildChest(c, {}, { facing: 'south' });
    await run([
        ...k.hoppers.map((p) => `setblock ${P(p)} minecraft:hopper[facing=down]`),
        ...k.slabs.map((p) => `setblock ${P(p)} minecraft:oak_slab[type=bottom]`),
    ], 'the hoppers and the slabs');
    const list = [...k.hoppers, ...k.chests, ...k.slabs, ...k.ladders, k.spot, { ...k.spot, y: k.floorY }, { ...k.botStart, y: k.platform.max.y }, k.exit];
    const names = await blockNames(list, ['hopper', 'chest', 'oak_slab[type=bottom]', 'ladder[facing=west]', 'air', 'stone']);
    const want = [...k.hoppers.map(() => 'hopper'), ...k.chests.map(() => 'chest'), ...k.slabs.map(() => 'oak_slab[type=bottom]'), ...k.ladders.map(() => 'ladder[facing=west]'), 'air', 'stone', 'stone', 'air'];
    const wrong = list.filter((p, i) => names[i] !== want[i]).map((p, i) => `${cellText(p)} is ${names[list.indexOf(p)]} not ${want[list.indexOf(p)]}`);
    return { ok: wrong.length === 0, wrong };
}

// Counts the calls of bot.attack (the hits of the kill loop) with the target's name; nothing is changed.
function recordAttacks(bot) {
    const hits = [];
    const orig = bot.attack;
    bot.attack = function recordedAttack(entity, ...rest) {
        hits.push({ t: Date.now(), name: entity?.name ?? null, id: entity?.id ?? null });
        return orig.call(this, entity, ...rest);
    };
    return { hits, stop() { bot.attack = orig; return hits; } };
}

// Every gunpowder of the room: the chests, the hoppers, the bag, the drops on the floor. { total, chests, hoppers, bag, floor }.
async function gunpowderOf(k) {
    let chests = 0, hoppers = 0;
    for (const c of k.chests) chests += (await chestItems(c))?.gunpowder ?? 0;
    for (const hp of k.hoppers) hoppers += (await chestItems(hp))?.gunpowder ?? 0;
    const bag = (await inventoryOf(NAME)).gunpowder ?? 0;
    const floor = (await itemsOnGround(k.roomBox)).filter((it) => it.name === 'gunpowder').reduce((n, it) => n + (it.count ?? 0), 0);
    return { total: chests + hoppers + bag + floor, chests, hoppers, bag, floor };
}

async function xpOf(name) {
    const out = await commands([`xp query ${name} levels`, `xp query ${name} points`]);
    const n = (lines) => Number(/has (\d+)/.exec(lines.join(' '))?.[1] ?? NaN);
    return { level: n(out[0]), points: n(out[1]) };
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 24);
        const { ox, oz } = r;
        const k = roomPlan(ox, oz);
        await command(`forceload add ${ox - 16} ${oz - 16} ${ox + 16} ${oz + 16}`);
        const built = await buildRoom(k);
        note(`build: the kill room at y ${RY} (${cellText(k.interior.min)} to ${cellText(k.interior.max)}): hoppers ${k.hoppers.map(cellText).join(', ')}, chests ${k.chests.map(cellText).join(', ')}, slabs ${k.slabs.map(cellText).join(', ')}, the spot ${cellText(k.spot)}, the ladder at (${k.column.x}, ${RY}..${RY + 9}, ${k.column.z}) facing west, the platform ${cellText(k.platform.min)} to ${cellText(k.platform.max)}, the start ${cellText(k.botStart)}${built.ok ? '' : '; WRONG: ' + built.wrong.join('; ')}`);
        check(built.ok, 'precondition: the kill room is built as planned (every part read back from the server)', built.wrong.join('; ') || 'all ok');
        const spotCenter = { x: k.spot.x + 0.5, y: k.spot.y, z: k.spot.z + 0.5 };
        const atSpot = (p) => Boolean(p) && hdist(p, spotCenter) <= 1.5 && Math.abs(p.y - RY) < 0.8;
        const inColumn = (p) => Boolean(p) && Math.floor(p.x) === k.column.x && Math.floor(p.z) === k.column.z && p.y > RY + 0.5 && p.y < RY + 9.5;
        const aboveRoom = (p) => Boolean(p) && p.y >= k.platform.max.y + 0.9;
        let agent = null, orders = null, s = null;
        let summoned = 0;
        const creepersAlive = () => countEntities(`@e[type=minecraft:creeper,tag=${CREEPER_TAG}]`);
        const summonOne = async () => {
            const hp = k.hoppers[summoned % 2 === 0 ? 0 : 2];
            const out = await command(`summon minecraft:creeper ${hp.x + 0.5} ${RY + 1} ${hp.z + 0.5} {Health:4f,NoAI:1b,PersistenceRequired:1b,Tags:["${TAG}","${CREEPER_TAG}"]}`);
            if (out.some((l) => /Summoned new/.test(l))) summoned++;
            return out;
        };
        // creepers on the hoppers every 10 s while `go()` holds, 20 at most; resolves with the count when it stopped
        const summonLoop = async (go, max = MAX_CREEPERS) => {
            let n = 0;
            while (go() && n < max) {
                await summonOne();
                n++;
                for (let i = 0; i < SUMMON_EVERY_MS / 500 && go(); i++) await sleep(500);
            }
            return n;
        };
        const sampler = () => startTrace(async () => {
            const out = await commands([`data get entity ${NAME} Pos`, `execute if entity @e[type=minecraft:creeper,tag=${CREEPER_TAG}]`]);
            const posLine = out[0].find((l) => /entity data: \[/.test(l));
            const nums = posLine ? posLine.slice(posLine.indexOf('[')).match(/-?\d+(?:\.\d+)?(?:E-?\d+)?/gi).map(Number) : null;
            const view = orders?.player?.players?.[NAME]?.entity ?? null;
            return {
                bot: nums && nums.length >= 3 ? { x: nums[0], y: nums[1], z: nums[2] } : null,
                creepers: Number(/count: (\d+)/.exec(out[1].join(' '))?.[1] ?? 0),
                action: agent.actions.currentActionLabel || '-',
                cs: agent.bot.modes?.exists?.('creeper_safety') ? agent.bot.modes.isOn('creeper_safety') : null,
                sneak: (() => { try { return agent.bot.getControlState('sneak'); } catch { return null; } })(),
                crouch: view ? Boolean(view.crouching) : null,
                level: agent.bot.experience?.level ?? null,
                health: agent.bot.health ?? null,
            };
        }, 400);
        const cols = {
            bot: (x) => fmt(x.bot), act: (x) => x.action, cs: (x) => String(x.cs), sneak: (x) => `${x.sneak}/${x.crouch}`, creepers: (x) => String(x.creepers),
            lvl: (x) => String(x.level), hp: (x) => String(x.health),
        };
        try {
            const j = await startJourney(NAME, null, {
                botAt: k.spot, botYaw: 180, playerAt: k.playerAt, kit: [['stone_sword', 1], ['bread', 8]],
                settings: SUPERVISION_SETTINGS({ afk_kill: true }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            const requests0 = s.chat.requests.length;
            const idle = () => waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            check(agent.bot.modes?.exists?.('creeper_safety') === true && agent.bot.modes.isOn('creeper_safety') === true, 'precondition: the reflex creeper_safety exists and is on at the start (the home pack with its reflexes)', JSON.stringify(agent.bot.modes?.getJson?.() ?? null));

            // ====================================================== 0. the spot saved, the climb up to the platform
            const saved = await orders.orderInfo('!rememberHere("kill_spot")', 30000);
            const place = readWorldFile(agent, 'places.json').json?.places?.kill_spot ?? null;
            note(`0: !rememberHere("kill_spot") at ${fmt(await entityPos(NAME))} answered ${JSON.stringify(String(saved.reply).slice(0, 200))}; places.json kill_spot ${JSON.stringify(place)}`);
            check(saved.done && Boolean(place) && Math.abs(Math.floor(place.x) - k.spot.x) <= 1 && Math.abs(Math.floor(place.z) - k.spot.z) <= 1 && Math.abs(Math.floor(place.y) - k.spot.y) <= 1, 'precondition: the owner saved the place `kill_spot` at the bot\'s cell (places.json)', `${JSON.stringify(place)}; the spot ${cellText(k.spot)}`);
            const moves0 = recordMoves(agent);
            const trace0 = startTrace(async () => ({ bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 400);
            const up = await orders.orderInfo(`!goToCoordinates(${k.botStart.x}, ${k.botStart.y}, ${k.botStart.z}, 1)`, 120000);
            const at0 = await entityPos(NAME);
            const rows0 = await trace0.stop();
            moves0.stop();
            printTrace('0: the climb up to the platform', rows0, { bot: (x) => fmt(x.bot), action: (x) => x.action }, 60);
            note(`0: !goToCoordinates to the platform ${cellText(k.botStart)} answered after ${(up.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(up.reply).slice(0, 160))}; the bot at ${fmt(at0)}; ${rows0.filter((x) => inColumn(x.bot)).length} samples in the ladder column`);
            check(aboveRoom(at0) && inBox(at0, { min: { ...k.platform.min, y: k.platform.max.y + 1 }, max: { ...k.platform.max, y: k.platform.max.y + 2 } }), '0: the bot climbs the ladder up to the platform by itself (the farm starts there; the control never moves it)', fmt(at0));
            if (up.done === false) note(`0: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await idle();
            const standBefore = await entityPos(NAME);

            // ====================================================== 1. !killFarm("level 2")
            await commands([`xp set ${NAME} 0 levels`, `xp set ${NAME} 0 points`, 'difficulty normal', `gamemode survival ${NAME}`]);
            await waitFor(() => agent.bot.experience?.level === 0, { ms: 5000, every: 50 });
            const attacks1 = recordAttacks(agent.bot);
            const tTrace1 = Date.now();
            const trace1 = sampler();
            const t1 = Date.now();
            const farm1 = orders.orderInfo('!killFarm("level 2")', 420000);
            let done1 = false;
            farm1.then(() => { done1 = true; }, () => { done1 = true; });
            const arrived1 = await waitFor(async () => atSpot(await entityPos(NAME)) || done1, { ms: 90000, every: 300 });
            note(`1: the bot ${arrived1.ok && !done1 ? `reached the spot after ${(arrived1.ms / 1000).toFixed(1)} s` : done1 ? 'ended the order before reaching the spot' : 'did not reach the spot within 90 s'}: ${fmt(await entityPos(NAME))}; the creepers start now`);
            const summoning1 = summonLoop(() => !done1);
            const stopped1 = await waitFor(() => saidLines(s, t1).find((l) => STOP_LEVEL.test(l)) ?? (done1 ? 'ended' : null), { ms: 400000, every: 300 });
            const info1 = await farm1;
            const n1 = await summoning1;
            const stopLine1 = textOf(s, t1, STOP_LEVEL, info1.reply);
            // the farm's own time: from the order to the stop line (the finally may restore the modes before the walk out)
            const stopAt1 = s.chats.find((x) => x.t >= t1 && STOP_LEVEL.test(x.text))?.t ?? (t1 + info1.ms);
            const back1 = await waitFor(async () => { const p = await entityPos(NAME); return aboveRoom(p) ? p : null; }, { ms: 90000, every: 400 });
            await sleep(2000);
            const rows1 = await trace1.stop();
            const hits1 = attacks1.stop();
            printTrace('1: !killFarm("level 2")', rows1, cols, 150);
            const said1 = saidLines(s, t1);
            const alive1 = await creepersAlive();
            const kills1 = n1 - alive1;
            const xp1 = await xpOf(NAME);
            const gp1 = await gunpowderOf(k);
            const farmRows = rows1.filter((x) => tTrace1 + x.t * 1000 < stopAt1);
            const spotRows = farmRows.filter((x) => atSpot(x.bot));
            const columnDown = rows1.findIndex((x) => inColumn(x.bot));
            const firstSpot = rows1.findIndex((x) => atSpot(x.bot));
            const sneakRows = spotRows.filter((x) => x.sneak === true || x.crouch === true);
            const modeRan = farmRows.filter((x) => String(x.action).startsWith(MODE));
            const csAtSpot = spotRows.map((x) => x.cs);
            const creeperLines = said1.filter((l) => CREEPER_LINE.test(l) && !l.startsWith(START_SPEC) && !STOP_LEVEL.test(l));
            const stopM = stopLine1 ? STOP_LEVEL.exec(stopLine1) : null;
            const columnUp = rows1.slice(firstSpot >= 0 ? firstSpot : 0).some((x) => inColumn(x.bot));
            note(`1: !killFarm("level 2") answered after ${(info1.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(info1.reply).slice(0, 200))}; the stop line ${stopped1.ok && stopped1.value !== 'ended' ? `came after ${(stopped1.ms / 1000).toFixed(0)} s` : 'was not said before the order ended'}; the bot said ${JSON.stringify(said1.slice(0, 10))}`);
            note(`1: ${n1} creepers summoned, ${alive1} alive, ${kills1} killed; ${hits1.length} hits (${JSON.stringify(hits1.map((h) => h.name).slice(0, 8))}); xp ${JSON.stringify(xp1)} (the bot's view: level ${agent.bot.experience?.level}, points ${agent.bot.experience?.points}); gunpowder ${JSON.stringify(gp1)}; ${spotRows.length} samples at the spot, ${sneakRows.length} of them sneaking (control/view); creeper_safety at the spot ${JSON.stringify([...new Set(csAtSpot)])}, now ${agent.bot.modes.isOn('creeper_safety')}; the mode ran in ${modeRan.length} samples; the bot ${back1.ok ? `is above the room after ${(back1.ms / 1000).toFixed(0)} s` : 'is NOT above the room within 90 s'} at ${fmt(back1.value ?? await entityPos(NAME))} (it stood at ${fmt(standBefore)} when the order came)`);
            check(!NO_COMMAND.test(String(info1.reply)) && said1.filter((l) => l === START_LINE).length === 1, `1a: the start line is said once: \`${START_SPEC}\` (SPEC 8.4) and \`${START_GAP}\` (DECISIONS B-10)`, JSON.stringify(said1.filter((l) => CREEPER_LINE.test(l)).slice(0, 3)));
            check(columnDown >= 0 && firstSpot > columnDown, '1b: the bot climbs down the ladder (the trace holds the ladder column, then the spot)', `column at sample ${columnDown}, the spot at sample ${firstSpot}`);
            check(sneakRows.length >= 1, '1c: the bot sneaks at the spot (its sneak control, or the player\'s view of its pose: crouching)', `${sneakRows.length} of ${spotRows.length} samples at the spot`);
            check(hits1.length >= 4 && hits1.every((h) => h.name === 'creeper') && kills1 >= 4, '1d: hits with bot.attack on creepers only, and the creepers are gone: 4 kills or more (summoned minus alive)', `${hits1.length} hits on ${JSON.stringify([...new Set(hits1.map((h) => h.name))])}, ${kills1} kills`);
            // `xp query <bot> points` is the progress within the level, not the total: the level is the figure
            check(xp1.level >= 2 && (agent.bot.experience?.level ?? 0) >= 2, '1e: the XP of the kills reached the bot: level 2 or more (server `xp query`, and bot.experience)', `server ${JSON.stringify(xp1)}, bot level ${agent.bot.experience?.level}`);
            check(gp1.total >= 1, '1f: gunpowder lies in the chests (through the hoppers), the hoppers or the bag (a creeper drops 0 to 2: four kills give none in about 1 run of 80)', JSON.stringify(gp1));
            check(info1.done && stopLine1 !== null && Number(stopM?.[1]) >= 4, '1g: the stop line `I stop the farming: level 2 reached; N creepers, <time>; M gunpowder stored.` with N the kills (4 or more)', JSON.stringify(stopLine1 ?? String(info1.reply).slice(0, 160)));
            if (stopM) note(`1g: the time slot of the stop line reads ${JSON.stringify(stopM[2])} and the gunpowder slot ${stopM[3]} (the chests hold ${gp1.chests}, the hoppers ${gp1.hoppers}, the bag ${gp1.bag})`);
            check(back1.ok && columnUp, '1h: after the stop the bot leaves by the ladder to where it stood when the order came (above the room, y 179 or higher, within 90 s)', `${fmt(back1.value ?? null)}; the column on the way up: ${columnUp}`);
            check(spotRows.length > 0 && csAtSpot.every((v) => v === false) && modeRan.length === 0 && creeperLines.length === 0, '1i: creeper_safety is off at the spot (bot.modes) and silent: the mode never ran and no creeper line was said while the farm ran (SPEC 8.4, the modes; K-2)', `at the spot ${JSON.stringify([...new Set(csAtSpot)])}; the mode ran in ${modeRan.length} samples; said ${JSON.stringify(creeperLines.slice(0, 3))}`);
            check(agent.bot.modes.isOn('creeper_safety') === true, '1i: creeper_safety is on again after the order (restored in a finally)', String(agent.bot.modes.isOn('creeper_safety')));
            if (!info1.done) note(`1: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await idle();

            // ====================================================== 2. the health stop
            await commands([`kill @e[tag=${CREEPER_TAG}]`, `xp set ${NAME} 0 levels`, `xp set ${NAME} 0 points`, `effect give ${NAME} minecraft:instant_health 1 10 true`]);
            summoned = 0;
            const trace2 = sampler();
            const attacks2 = recordAttacks(agent.bot);
            const t2 = Date.now();
            const farm2 = orders.orderInfo('!killFarm()', 300000);
            let done2 = false;
            farm2.then(() => { done2 = true; }, () => { done2 = true; });
            const arrived2 = await waitFor(async () => atSpot(await entityPos(NAME)) || done2, { ms: 90000, every: 300 });
            note(`2: the bot ${arrived2.ok && !done2 ? `reached the spot after ${(arrived2.ms / 1000).toFixed(1)} s` : 'did not reach the spot (or the order ended)'}; the creepers start now`);
            const summoning2 = summonLoop(() => !done2, 8);
            const firstKill = await waitFor(() => attacks2.hits.length >= 1 || done2, { ms: 60000, every: 250 });
            await sleep(1500);
            const hpBefore = agent.bot.health;
            const dmg = await command(`damage ${NAME} 12`);
            const tDamage = Date.now();
            note(`2: ${firstKill.ok && !done2 ? `the first hit came after ${(firstKill.ms / 1000).toFixed(1)} s` : 'no hit within 60 s'}; /damage ${NAME} 12 at health ${hpBefore}: ${dmg.join(' | ').slice(0, 120)}`);
            const left = await waitFor(() => saidLines(s, tDamage).find((l) => LEAVE_HEALTH.test(l)) ?? (done2 ? 'ended' : null), { ms: 60000, every: 250 });
            const info2 = await Promise.race([farm2, sleep(90000).then(() => null)]);
            await summoning2;
            const leaveLine = textOf(s, t2, LEAVE_HEALTH, info2?.reply);
            const back2 = await waitFor(async () => { const p = await entityPos(NAME); return aboveRoom(p) ? p : null; }, { ms: 90000, every: 400 });
            await sleep(1500);
            const rows2 = await trace2.stop();
            const hits2 = attacks2.stop();
            printTrace('2: !killFarm() and /damage 12', rows2, cols, 120);
            const leaveM = leaveLine ? LEAVE_HEALTH.exec(leaveLine) : null;
            const died = rows2.some((x) => typeof x.health === 'number' && x.health <= 0) || (agent.bot.health ?? 20) <= 0;
            note(`2: !killFarm() ${info2 ? `answered after ${(info2.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(info2.reply).slice(0, 200))}` : 'did not end within 90 s of the damage'}; said ${JSON.stringify(saidLines(s, t2).slice(0, 8))}; ${hits2.length} hits; the bot at ${fmt(back2.value ?? await entityPos(NAME))}, health ${agent.bot.health}; creeper_safety ${agent.bot.modes.isOn('creeper_safety')}`);
            check(left.ok && leaveLine !== null && Number(leaveM?.[1]) < 10, '2a: health under 10 ends the farm with `I leave the kill room: health N.` (N under 10; 20 - 12 = 8, the spec\'s example says 9)', JSON.stringify(leaveLine ?? saidLines(s, tDamage).slice(0, 3)));
            check(Boolean(info2?.done) && back2.ok, '2b: the order ends and the bot is above the room (the platform) within 90 s', `${info2 ? 'ended' : 'running'}; ${fmt(back2.value ?? null)}`);
            check(agent.bot.modes.isOn('creeper_safety') === true, '2c: creeper_safety is on again after the health stop', String(agent.bot.modes.isOn('creeper_safety')));
            check(!died && s.killed === null, '2d: the bot never died (health never 0)', `health ${agent.bot.health}`);
            if (!info2) note(`2: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await idle();

            // ====================================================== 3. no slab: refused, no farming
            await commands([`kill @e[tag=${CREEPER_TAG}]`, `xp set ${NAME} 0 levels`, `xp set ${NAME} 0 points`, `effect give ${NAME} minecraft:instant_health 1 10 true`, ...k.slabs.map((p) => `setblock ${P(p)} minecraft:air`)]);
            const slabNames = await blockNames(k.slabs, ['air']);
            check(slabNames.every((n) => n === 'air'), 'precondition: the slab row over the hoppers is gone', JSON.stringify(slabNames));
            summoned = 0;
            const attacks3 = recordAttacks(agent.bot);
            const t3 = Date.now();
            const info3 = await orders.orderInfo('!killFarm("level 2")', 120000);
            const refused = textOf(s, t3, exact(NO_SLAB), info3.reply);
            await summonOne();
            await sleep(30000);
            const hits3 = attacks3.stop();
            const alive3 = await creepersAlive();
            const xp3 = await xpOf(NAME);
            note(`3: without the slab !killFarm("level 2") answered after ${(info3.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(info3.reply).slice(0, 200))}; said ${JSON.stringify(saidLines(s, t3).slice(0, 6))}; a creeper summoned after the answer: ${alive3} alive 30 s later, ${hits3.length} hits, xp ${JSON.stringify(xp3)}; the bot at ${fmt(await entityPos(NAME))}`);
            check(info3.done && refused !== null, `3a: the room without a slab is refused within 120 s: \`${NO_SLAB}\``, JSON.stringify(String(info3.reply).slice(0, 160)));
            check(hits3.length === 0 && alive3 === 1 && xp3.level === 0 && xp3.points === 0, '3b: no farming: no hit, the creeper summoned after the refusal is alive 30 s later, no XP', `${hits3.length} hits, ${alive3} alive, xp ${JSON.stringify(xp3)}`);
            if (agent.actions.executing) note(`3: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);

            const requests = s.chat.requests.slice(requests0).map((q) => String(q?.turns?.[q.turns.length - 1]?.content ?? '').slice(0, 100));
            check(requests.length === 0, 'zero model calls: typed orders ask no model and the pack asks none (SPEC 8.0)', JSON.stringify(requests));
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[tag=${TAG}]`, `kill @e[type=minecraft:creeper,x=${ox - 60},y=${RY - 20},z=${oz - 60},dx=120,dy=40,dz=120]`, 'difficulty peaceful', 'gamerule advance_time false', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await commands([`forceload remove ${ox - 16} ${oz - 16} ${ox + 16} ${oz + 16}`]).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
