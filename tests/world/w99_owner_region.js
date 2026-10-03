// W99 the owner's region (journey of v0.1.4.11 "Navigation and words", tester T3; DECISIONS.md F24 and F25): the
// owner's real geometry from his region dump, black box from the player's side.
//
// The dump (MCW_OWNER_DUMP names its file; the scenario skips with a note when it is unset or missing) is built in the
// region of the scenario with its center on the middle of the region at y 38, the y of the center of the dump: every
// y is the owner's own, x and z are shifted (the shift is noted). The dump is NOT tests/world/owner_region.json: that
// file is centred on the bed and switches the base-world scenarios; this one is centred at the mine level (9, 38, 33).
// The owner's switches with the three of v0.1.4.11 on, job_memory and area_floors (as W97), the modes of his profile,
// an empty memory, a stone pickaxe and 16 cobblestone (a bot that may dig or place, as the owner's bot).
// The bot is placed by the control at the start of each part and never moved during a part.
//
// The owner's staircase (found in the dump): 2 wide (x 9 and 10), 11 bottom cobblestone stairs facing south, from
// (9..10, 30, 25) up to (9..10, 40, 35); its foot is a tunnel at feet y 30 going north, its head the corridor of the
// mine room at feet y 41 (the double door at z 43, the chest at (11, 41, 44)).
//   1. F24, the stairs are walkable: the player stands at the head of the staircase (9, 41, 38), the bot at its foot
//      (9, 30, 22). "come here" !goToPlayer("w_player", 2): within 90 s the bot is within 2 blocks of him; no block of
//      the staircase and its walls (the box x 8..11, y 29..43, z 24..36) was broken, no block was placed in its air
//      (the cells above the stairs counted on their own); no line of a destructive walk in the console of the agent.
//      Then the reverse: the player at the foot, the bot where it arrived; "come here" again, the same checks.
//   2. F25, the basement is a shelter: the bot is placed in the basement (10, 59, 50); the player saves the house as
//      !setArea("home", "home", 10, 66, 50, 14, 70, 54) (the owner's area home, so the night reflex has a shelter to
//      go to) and the basement as !setArea("basement", "building", 7, 58, 46, 14, 62, 54). Night (time 13500, the
//      daylight cycle off): within 60 s the bot says neither `I cannot get into the shelter` nor `It is getting dark.
//      I go to the shelter.`; for 30 s (a sample every 500 ms) it stays inside the basement box; then !goToShelter
//      answers `I am in the shelter "basement"`.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, placeBot, tp, startTrace, printTrace } from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, dist, inBox } from './world.js';
import { loadDump, buildFromDump, placeOf } from './owner_region.js';
import { startJourney, JOURNEY_SETTINGS, PLAYER, saidLines } from './journey.js';

const NAME = 'w_owner';
const KIT = [['stone_pickaxe', 1], ['cobblestone', 16]];
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true });
const RADIUS = 50; // the box of the dump is 97 wide (radius 48); the regions are 200 blocks apart
const FLUID = /^(water|lava|bubble_column)$/; // not compared: a fluid cell of the dump may flow away after the build
// within 2 blocks, measured between the block cells of the bot and the player, as GoalNear of the path search does
// (run 2: the bot stopped 2 cells away and the float distance was 2.026, the player stands off the middle of its cell)
const cell = (p) => (p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null);
const cellDist = (a, b) => dist(cell(a), cell(b));
const DESTRUCTIVE = /(?<!non-)destructive (path|movements)/; // as W97
const NO_SHELTER = 'I cannot get into the shelter';
const GOING = 'It is getting dark. I go to the shelter.';
const IN_SHELTER = 'I am in the shelter "basement"';

// the owner's places (absolute coordinates of his world)
const OWNER = {
    foot: { x: 9, y: 30, z: 22 }, // in the tunnel, 3 cells north of the lowest stair
    head: { x: 9, y: 41, z: 38 }, // in the corridor, 3 cells south of the highest stair
    stairsBox: { min: { x: 8, y: 29, z: 24 }, max: { x: 11, y: 43, z: 36 } },
    basement: { min: { x: 7, y: 58, z: 46 }, max: { x: 14, y: 62, z: 54 } },
    home: { min: { x: 10, y: 66, z: 50 }, max: { x: 14, y: 70, z: 54 } },
    inBasement: { x: 10, y: 59, z: 50 },
    playerInBasement: { x: 9, y: 59, z: 52 },
};
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;

await scenarioMain({
    async main() {
        const file = process.env.MCW_OWNER_DUMP;
        const dump = file ? loadDump(file) : null;
        if (!dump) {
            note(`skipped: MCW_OWNER_DUMP ${file ? `names ${file}, which is missing or no dump of version 1` : 'is not set'}`);
            return;
        }
        const r = region(RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        check(dump.radius <= RADIUS, `precondition: the dump fits the region (radius ${dump.radius} <= ${RADIUS})`, String(dump.radius));
        const origin = { x: r.ox, y: dump.center.y, z: r.oz };
        const at = (p) => placeOf(p, dump, origin);
        const shift = { x: origin.x - dump.center.x, z: origin.z - dump.center.z };
        const box = (b) => ({ min: at(b.min), max: at(b.max) });
        note(`the dump: ${dump.blocks.length} blocks, center ${P(dump.center)}, radius ${dump.radius}; built with its center at ${P(origin)}: the owner's y, x + ${shift.x}, z + ${shift.z}`);
        await prepareRegion(r, 30);
        const tb = Date.now();
        const built = await buildFromDump(dump, origin);
        const buildS = (Date.now() - tb) / 1000;
        note(`the build: ${built.commands} commands in ${buildS.toFixed(0)} s${buildS > 480 ? ' (slower than 8 minutes)' : ''}; ${built.failed.length} failed: ${JSON.stringify(built.failed.slice(0, 5))}`);
        check(built.ok, 'precondition: every command of the build succeeded', JSON.stringify(built.failed.slice(0, 5)));

        // the staircase and its box, from the dump
        const key = (x, y, z) => `${x},${y},${z}`;
        const dumpAt = new Map();
        const sb = OWNER.stairsBox;
        for (const bl of dump.blocks) {
            if (bl[0] >= sb.min.x && bl[0] <= sb.max.x && bl[1] >= sb.min.y && bl[1] <= sb.max.y && bl[2] >= sb.min.z && bl[2] <= sb.max.z) dumpAt.set(key(bl[0], bl[1], bl[2]), bl[3]);
        }
        const stairs = dump.blocks.filter((bl) => /_stairs$/.test(bl[3]) && dumpAt.has(key(bl[0], bl[1], bl[2])))
            .map((bl) => ({ x: bl[0], y: bl[1], z: bl[2] }));
        const solid = []; // [{ p (test world), name }] the stairs and their walls
        const air = []; // the air of the box (test world), fluids left out
        for (let x = sb.min.x; x <= sb.max.x; x++) {
            for (let y = sb.min.y; y <= sb.max.y; y++) {
                for (let z = sb.min.z; z <= sb.max.z; z++) {
                    const name = dumpAt.get(key(x, y, z));
                    if (name && FLUID.test(name)) continue; // water and lava flow by themselves (seen in run 1)
                    if (name) solid.push({ p: at({ x, y, z }), name });
                    else air.push(at({ x, y, z }));
                }
            }
        }
        const aboveStairs = new Set(stairs.flatMap((s) => [1, 2].map((k) => key(...Object.values(at({ x: s.x, y: s.y + k, z: s.z }))))));
        // reads the box: the solid cells that are no longer their block, the air cells that hold a block
        const readStairs = async () => {
            const byName = new Map();
            for (const c of solid) { if (!byName.has(c.name)) byName.set(c.name, []); byName.get(c.name).push(c.p); }
            const broken = [];
            for (const [name, cells] of byName) {
                const got = await blockNames(cells, [name]);
                cells.forEach((p, i) => { if (!got[i]) broken.push({ ...p, was: name }); });
            }
            const gotAir = await blockNames(air, ['air', 'cave_air']);
            const placed = air.filter((p, i) => !gotAir[i]);
            const placedOnStairs = placed.filter((p) => aboveStairs.has(key(p.x, p.y, p.z)));
            return { broken, placed, placedOnStairs };
        };
        const cellsText = (list) => list.slice(0, 12).map((p) => P(p) + (p.was ? ' ' + p.was : '')).join(' ');
        const s0 = await readStairs();
        note(`the staircase: ${stairs.length} stairs from ${P(at(stairs[0]))} to ${P(at(stairs[stairs.length - 1]))} (the owner's ${P(stairs[0])} to ${P(stairs[stairs.length - 1])}); its box ${P(at(sb.min))} to ${P(at(sb.max))}: ${solid.length} blocks (fluids left out), ${air.length} cells of air`);
        check(stairs.length === 22 && s0.broken.length === 0 && s0.placed.length === 0, 'precondition: the staircase and its box are built as in the dump (22 stairs)',
            `${stairs.length} stairs, missing ${cellsText(s0.broken)}, blocks in the air ${cellsText(s0.placed)}`);

        let agent = null, orders = null;
        try {
            const foot = at(OWNER.foot), head = at(OWNER.head);
            const j = await startJourney(NAME, { owner: true }, { botAt: foot, botYaw: 0, playerAt: head, kit: KIT, settings: SETTINGS() });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const destructiveLines = (from) => (s.logs ?? []).slice(from).flatMap((l) => String(l).split('\n')).filter((l) => DESTRUCTIVE.test(l));
            const t0 = Date.now();

            // ---------------------------------------------------------- 1. F24 the stairs are walkable
            const comeHere = async (label) => {
                const log = (s.logs ?? []).length;
                const a0 = await entityPos(NAME);
                const p0 = await entityPos(PLAYER);
                note(`${label}: the bot at ${fmt(a0)}, the player at ${fmt(p0)}, ${dist(a0, p0).toFixed(1)} blocks apart`);
                const trace = startTrace(async () => ({ bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 1000);
                const t = Date.now();
                const res = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 90000);
                await sleep(1000);
                const rows = await trace.stop();
                const a = await entityPos(NAME);
                const p = await entityPos(PLAYER);
                const after = await readStairs();
                const lines = destructiveLines(log);
                const reached = res.done && cellDist(a, p) <= 2;
                note(`${label}: "come here" answered after ${((Date.now() - t) / 1000).toFixed(1)} s: ${JSON.stringify(res.reply.slice(0, 300))}; the bot at ${fmt(a)}, ${dist(a, p).toFixed(3)} blocks from the player (${cellDist(a, p).toFixed(2)} between the cells); broken ${after.broken.length}, placed ${after.placed.length} (${after.placedOnStairs.length} above the stairs)`);
                check(reached, `${label}: "come here" brings the bot within 2 blocks of the player (between the cells) within 90 s (F24)`, `${cellDist(a, p).toFixed(2)} between the cells (${dist(a, p).toFixed(3)} blocks), done ${res.done}, answer ${JSON.stringify(res.reply.slice(0, 200))}`);
                check(after.broken.length === 0, `${label}: no block of the staircase and its walls was broken`, cellsText(after.broken));
                check(after.placedOnStairs.length === 0 && after.placed.length === 0, `${label}: no block was placed on the stairs or in the air of the staircase`, `above the stairs ${cellsText(after.placedOnStairs)}; elsewhere ${cellsText(after.placed)}`);
                check(lines.length === 0 && !DESTRUCTIVE.test(res.reply), `${label}: no line of a destructive walk in the answer or in the console of the agent`, JSON.stringify(lines.slice(0, 3)));
                if (!reached || after.broken.length || after.placed.length || lines.length) {
                    printTrace(`${label}: the bot every 1 s`, rows, { bot: (x) => fmt(x.bot), action: (x) => x.action });
                }
                return { ok: reached && after.broken.length === 0 && after.placed.length === 0 && lines.length === 0 };
            };
            const up = await comeHere('1a up the stairs');
            // the reverse: the player goes to the foot, the bot stays where it arrived
            await tp(PLAYER, foot);
            await sleep(1000);
            const down = await comeHere('1b down the stairs');
            note(`1: up ${up.ok ? 'ok' : 'FAILED'}, down ${down.ok ? 'ok' : 'FAILED'}`);

            // ---------------------------------------------------------- 2. F25 the basement is a shelter
            const bm = box(OWNER.basement);
            const hm = box(OWNER.home);
            await tp(PLAYER, at(OWNER.playerInBasement));
            await placeBot(agent, at(OWNER.inBasement), 0);
            note(`2: the bot placed in the basement at ${fmt(await entityPos(NAME))} (the start of the part); the basement box ${P(bm.min)} to ${P(bm.max)}`);
            const homeAnswer = await orders.order(`!setArea("home", "home", ${hm.min.x}, ${hm.min.y}, ${hm.min.z}, ${hm.max.x}, ${hm.max.y}, ${hm.max.z})`, 30000);
            note(`2: !setArea home answered ${JSON.stringify(homeAnswer.slice(0, 300))}`);
            check(homeAnswer.startsWith('Area "home" (home) saved:'), '2: the house is saved as the area "home" (the owner\'s area)', JSON.stringify(homeAnswer.slice(0, 200)));
            const bAnswer = await orders.order(`!setArea("basement", "building", ${bm.min.x}, ${bm.min.y}, ${bm.min.z}, ${bm.max.x}, ${bm.max.y}, ${bm.max.z})`, 30000);
            note(`2: !setArea basement answered ${JSON.stringify(bAnswer.slice(0, 300))}`);
            check(bAnswer.startsWith('Area "basement" (building) saved:'), '2: the basement is saved as the area "basement" of type building', JSON.stringify(bAnswer.slice(0, 200)));
            const modes = agent.bot.modes;
            check(modes.exists('night_shelter') && modes.isOn('night_shelter'), '2: the mode night_shelter is on', JSON.stringify(modes.getJson()));
            const tn = Date.now();
            await commands(['gamerule doDaylightCycle false', 'time set 13500']);
            const samples = [];
            while (Date.now() - tn < 30000) {
                samples.push({ t: (Date.now() - tn) / 1000, bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' });
                await sleep(500);
            }
            const outside = samples.filter((x) => !inBox(x.bot, bm));
            await sleep(Math.max(0, 60000 - (Date.now() - tn)));
            const night = saidLines(s, tn);
            const bad = night.filter((l) => l.includes(NO_SHELTER) || l.includes(GOING));
            note(`2: the bot said at night (60 s): ${JSON.stringify(night.slice(0, 12))}; ${samples.length} samples, ${outside.length} outside the basement; the bot at ${fmt(await entityPos(NAME))}; time of day ${agent.bot.time?.timeOfDay}`);
            check(bad.length === 0, `2: within 60 s of night in the basement the bot says neither \`${NO_SHELTER}\` nor \`${GOING}\` (F25)`, JSON.stringify(bad.slice(0, 4)));
            check(samples.length >= 50 && outside.length === 0, '2: the bot stays inside the basement box for 30 s (a sample every 500 ms)',
                `${outside.length} of ${samples.length} outside, first ${outside[0] ? `t=${outside[0].t.toFixed(1)}s ${fmt(outside[0].bot)} ${outside[0].action}` : '-'}`);
            if (outside.length) printTrace('2: the bot at night', samples, { bot: (x) => fmt(x.bot), action: (x) => x.action });
            const shelter = await orders.orderInfo('!goToShelter', 60000);
            note(`2: !goToShelter answered after ${(shelter.ms / 1000).toFixed(1)} s: ${JSON.stringify(shelter.reply.slice(0, 300))}; the bot at ${fmt(await entityPos(NAME))}`);
            check(shelter.reply.includes(IN_SHELTER), `2: !goToShelter in the basement answers \`${IN_SHELTER}\` (F25)`, JSON.stringify(shelter.reply.slice(0, 200)));
            check(inBox(await entityPos(NAME), bm), '2: after !goToShelter the bot is still in the basement', fmt(await entityPos(NAME)));

            note(`the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 30))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r, 30);
        }
    },
});
exitSoon();
