// W126 the base (entry `survey_base`; v0.1.4.15 "The base survey and Routines", tester T3; PLAN.md section 4, SPEC sections 2 and
// 7.1): "here is the base, scan it". The bot finds every place of a base from the loaded blocks around it, saves them all at once with the source
// `survey`, reports in one line and takes the owner's corrections by name; the owner's own areas are never renamed, re-boxed or
// forgotten by a survey; the ladder through the trapdoor to the basement is proven on the server (PLAN 9); the survey never finds
// ore (the x-ray guard). Against a857593 (v0.1.4.14 plus the spec) the first survey answers `Command '!surveyBase' does not exist.`
// and parts A to E fail from there; on the release every check passes.
//
// The base world with nothing of base_world.js built: the control builds the small base of SPEC 7.1 in the free space of the
// region (the offsets from the origin (ox, oz), g the grass at y 60): a house of housePlan (7 x 5 x 7, x -3..3, z -3..3, the oak
// door in the north wall at (0, g+1, -3), a red bed, a chest, a crafting table, 2 cats); in its floor an oak trapdoor at (1, g, 0)
// over a ladder of 6 (y g-6..g-1, facing south) down to a dug basement (air x -1..3, y g-6..g-4, z 0..4, stone floor at g-7) with a
// chest, a furnace and a torch; from the basement's east wall a tunnel of 12 into the rock (x 4..15, 2 wide z 1..2, 2 high) and in
// its west wall an opening (x -3..-2, z 2) into a dark cave of 5 x 5 x 4 (x -8..-4, y g-6..g-3, z 0..4); an unfenced potato field
// 9 x 5 north of the house (x -4..4, z -15..-11, 44 ripe potatoes and a water cell); a fenced pen 9 x 9 east of the house
// (x 8..16, z -4..4) with 5 cows and a roof of oak planks at g+4; a fenced pen 9 x 9 (x 8..16, z 8..16) with 4 pigs; a lectern and a
// composter west of the house (x -9) with 3 villagers (2 librarians, 1 farmer; `summon villager` with VillagerData); a row of 12
// sugar cane (x -6..5, z 8) by a pool (x -6..5, z 9..10); a happy ghast leashed to a lone fence post (x 22, z -14) when `summon`
// with `leash:{X,Y,Z}` holds on 26.1 (else noted and skipped); a nether portal of 4 x 5 obsidian (x 10..13, z -20) lit with
// `setblock nether_portal` when that holds (else noted and skipped); 20 iron ore in the rock around the basement (10 under its
// floor at g-8, 10 behind its south wall at z 6), placed before the first survey (part E). The owner's switches
// (SUPERVISION_SETTINGS) with the watch server on and the two switches of this release on (base_survey, routines; survey_radius
// 128), the modes of his profile, an empty memory. The bot stands outside the house door, the player beside it. The console
// commands use the names of 26.1.
//   A. Typed `!surveyBase("east")`: within 60 s one report line `I found N places: house (1 bed), basement (1 chest, 1 furnace),
//      trading hall (3 villagers), potato farm 9 x 5, cow pen (5 cows), pig pen (4 pigs), cane by the water (12), a tied happy ghast
//      at (x, y, z), a portal ..., a mine entrance at (x, y, z), a cave mouth at (x, y, z) that I keep out of. All saved. Say
//      "rename X to Y" or "forget X" to correct.` with the counts the control knows (SPEC 2.5; N equals the items of the line; the
//      ghast and the portal only when the build held them). The files of the world: areas.json holds the house as a home, the
//      basement as a building under it, the two pens (kind pen, 5 cows and 4 pigs in their contents), the potato farm with the
//      border `open`, the cane and the cave mouth with the flag no_enter, every one with source `survey` and base `east`;
//      places.json the mine entrance (and the tied ghast); routes.json the route house_to_mine_entrance with a trapdoor leg and a
//      ladder leg; bases.json the base "east" with the house door.
//   B. Typed `!renameArea("potato_farm", "spuds")`: `I renamed "potato_farm" to "spuds".`, the area keeps its box under the new
//      name; typed `!forgetArea("pig_pen")` forgets the pen; a second `!surveyBase("east")` answers `I surveyed "east" again: the
//      pig pen is new. The rest as saved.` and the pig pen is saved again.
//   C. The owner's words win: the field is set free (`!forgetArea("spuds")`, noted) and the owner saves `wheat_farm` by hand with
//      `!setArea` over more than half of the potato field; a third `!surveyBase("east")` says the field lies inside his
//      "wheat_farm" and is kept (`a field at (x, y, z) inside your "wheat_farm" (kept as yours)`); wheat_farm keeps its box and
//      its source, and no survey farm is saved over the field.
//   D. The underground in use (PLAN 9): the bot walks to the mine entrance by itself (typed `!goToRememberedPlace("mine_entrance")`,
//      the route of 2.3.4 down; when it does not arrive within 150 s the control stands it there, noted, so that the way up is
//      proven on its own); `time set 13000`; typed `!goToBed`: within 120 s the bot lies in the house's bed (server, sleeping_pos),
//      the trace of its position holds the climb of the ladder column (between the basement and the house floor), and the bot was
//      never in the cave.
//   E. The x-ray guard: no report, no area, no place, no route and no base names an ore; the typed `!stats` and the watch `state`
//      show no ore knowledge; nothing the bot said names one.
// Throughout: the process lives, no request reached a real model, the token is in no console line.
import crypto from 'node:crypto';
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, placeBot,
    readWorldFile, routesInFile, serverSleeping, recordMoves, startTrace, printTrace,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, blockNames, housePlan, buildHouse, buildChest, hdist } from './world.js';
import { BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER, freePort, countEntities } from './journey.js';
import { Supervisor } from './supervisor.js';

const NAME = 'w_base';
const SUPERVISOR = 'Opus';
const TAG = 'mcw';
const BASE = 'east';
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const cellText = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const SURVEY_MS = 60000;

// ---- SPEC 2.5, the texts
const REPORT_HEAD = /^I found (\d+) places?: /;
// SPEC 2.2: with a tied animal the report says "never untie, never break that post" once; the survey puts the sentence after the tail
const REPORT_TAIL = /\. All saved\. Say "rename X to Y" or "forget X" to correct\.( Never untie, never break that post\.)?$/;
const AGAIN_PIG_PEN = /^I surveyed "east" again: the pig pen is new\. The rest as saved\.$/;
const RENAMED = /^I renamed "potato_farm" to "spuds"\.$/;
const KEPT = /a field at \((-?\d+), (-?\d+), (-?\d+)\) inside your "wheat[ _]farm" \(kept as yours\)/;
const AT = String.raw`\((-?\d+), (-?\d+), (-?\d+)\)`;
const ITEMS = {
    house: /\bhouse \(1 bed\b[^)]*\)/,
    basement: /\bbasement \(1 chest, 1 furnace\)/,
    hall: /\btrading hall \(3 villagers\)/,
    farm: /\bpotato farm 9 x 5\b/,
    cows: /\bcow pen \(5 cows\)/,
    pigs: /\bpig pen \(4 pigs\)/,
    cane: /\bcane by the water \(12\)/,
    ghast: new RegExp(String.raw`\ba tied happy ghast at ${AT}`),
    portal: /\bportal\b/,
    mine: new RegExp(String.raw`\ba mine entrance at ${AT}`),
    cave: new RegExp(String.raw`\ba cave mouth at ${AT} that I keep out of`),
};
// an ore word: iron_ore, deepslate_iron_ore, ore, ores (not "more", "before", "store", "source")
const ORE_WORD = /(?:^|[^a-z])(?:[a-z]+_)?ores?\b/i;

// The items of a report line, split at the commas outside parentheses.
function splitItems(text) {
    const m = REPORT_HEAD.exec(text);
    if (!m) return [];
    let body = text.slice(m[0].length).replace(REPORT_TAIL, '');
    const items = [];
    let depth = 0, from = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) { items.push(body.slice(from, i).trim()); from = i + 1; }
    }
    items.push(body.slice(from).trim());
    return items.filter(Boolean);
}

const near = (re, text, p, within = 2) => {
    const m = re.exec(text);
    if (!m) return false;
    const at = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
    return Math.abs(at.x - p.x) <= within && Math.abs(at.y - p.y) <= within + 1 && Math.abs(at.z - p.z) <= within;
};
const holds = (area, c) => Boolean(area?.min && area?.max) && inBox({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, area);
const sameBox = (a, b) => Boolean(a?.min && b?.min) && ['x', 'y', 'z'].every((k) => a.min[k] === b.min[k] && a.max[k] === b.max[k]);
const areaText = (a) => (a ? `${a.name} (type ${a.type}, kind ${a.kind}, border ${a.border ?? '-'}, source ${a.source ?? '-'}, base ${a.base ?? '-'}${a.flags?.no_enter ? ', no_enter' : ''}) ${cellText(a.min)} to ${cellText(a.max)}` : 'none');
const overlaps = (a, box) => Boolean(a?.min) && !(a.max.x < box.min.x || a.min.x > box.max.x || a.max.z < box.min.z || a.min.z > box.max.z);

// ------------------------------------------------------------------ the small base of SPEC 7.1

function penPlan(x, z, g, size, { roofY = null } = {}) {
    const mid = Math.floor(size / 2);
    const ring = [];
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) if (i === 0 || j === 0 || i === size - 1 || j === size - 1) ring.push({ x: x + i, y: g + 1, z: z + j });
    const spots = [];
    for (let j = 2; j <= size - 3; j += 2) for (let i = 2; i <= size - 3; i += 2) spots.push({ x: x + i, y: g + 1, z: z + j });
    return {
        box: { min: { x, y: g, z }, max: { x: x + size - 1, y: g + 2, z: z + size - 1 } },
        inner: { min: { x: x + 1, y: g, z: z + 1 }, max: { x: x + size - 2, y: g + 3, z: z + size - 2 } },
        gate: { x: x + mid, y: g + 1, z },
        inside: { x: x + mid, y: g + 1, z: z + mid },
        ring, roofY, spots,
        ringBlock: (p) => (p.x === x + mid && p.z === z ? 'oak_fence_gate' : 'oak_fence'),
    };
}

export function smallBasePlan(r) {
    const { ox, oz, g } = r;
    const house = housePlan(ox - 3, oz - 3, g);
    const field = (() => {
        const x0 = ox - 4, x1 = ox + 4, z0 = oz - 15, z1 = oz - 11;
        const ground = [];
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) ground.push({ x, y: g, z });
        const water = { x: ox, y: g, z: oz - 13 };
        return {
            box: { min: { x: x0, y: g, z: z0 }, max: { x: x1, y: g + 1, z: z1 } },
            ground, water,
            farmland: ground.filter((c) => !(c.x === water.x && c.z === water.z)),
            potatoes: ground.filter((c) => !(c.x === water.x && c.z === water.z)).map((c) => ({ x: c.x, y: g + 1, z: c.z })),
            // the owner's wheat_farm of part C: 6 of the 9 columns, the rows with a margin of 1 (more than half of the field)
            ownerHalf: { min: { x: x0, y: g, z: z0 - 1 }, max: { x: x0 + 5, y: g + 1, z: z1 + 1 } },
        };
    })();
    const ladders = [];
    for (let y = g - 6; y <= g - 1; y++) ladders.push({ x: ox + 1, y, z: oz });
    const canes = [], water = [];
    for (let x = ox - 6; x <= ox + 5; x++) {
        canes.push({ x, y: g + 1, z: oz + 8 });
        water.push({ x, y: g, z: oz + 9 }, { x, y: g, z: oz + 10 });
    }
    const ore = [];
    for (let x = ox - 1; x <= ox + 3; x++) for (const z of [oz + 1, oz + 2]) ore.push({ x, y: g - 8, z });
    for (let x = ox - 1; x <= ox + 3; x++) for (const y of [g - 6, g - 5]) ore.push({ x, y, z: oz + 6 });
    return {
        ox, oz, g, house,
        table: { x: ox + 2, y: g + 1, z: oz - 2 },
        cats: [{ x: ox - 1, y: g + 1, z: oz - 1 }, { x: ox + 2, y: g + 1, z: oz }],
        trapdoor: { x: ox + 1, y: g, z: oz },
        ladders,
        column: { x: ox + 1, z: oz },
        basement: {
            box: { min: { x: ox - 1, y: g - 6, z: oz }, max: { x: ox + 3, y: g - 4, z: oz + 4 } },
            floorY: g - 7,
            chest: { x: ox - 1, y: g - 6, z: oz + 4 },
            furnace: { x: ox + 3, y: g - 6, z: oz + 4 },
            torch: { x: ox + 1, y: g - 6, z: oz + 4 },
            middle: { x: ox + 1, y: g - 6, z: oz + 2 },
        },
        tunnel: {
            box: { min: { x: ox + 4, y: g - 6, z: oz + 1 }, max: { x: ox + 15, y: g - 5, z: oz + 2 } },
            mouth: { x: ox + 4, y: g - 6, z: oz + 1 },
            end: { x: ox + 15, y: g - 6, z: oz + 1 },
            length: 12,
        },
        cave: {
            box: { min: { x: ox - 8, y: g - 6, z: oz }, max: { x: ox - 4, y: g - 3, z: oz + 4 } },
            opening: { min: { x: ox - 3, y: g - 6, z: oz + 2 }, max: { x: ox - 2, y: g - 5, z: oz + 2 } },
            mouth: { x: ox - 2, y: g - 6, z: oz + 2 },
            middle: { x: ox - 6, y: g - 6, z: oz + 2 },
        },
        field,
        cowPen: penPlan(ox + 8, oz - 4, g, 9, { roofY: g + 4 }),
        pigPen: penPlan(ox + 8, oz + 8, g, 9),
        hall: {
            lectern: { x: ox - 9, y: g + 1, z: oz - 1 },
            composter: { x: ox - 9, y: g + 1, z: oz + 1 },
            villagers: [
                { pos: { x: ox - 10, y: g + 1, z: oz - 1 }, profession: 'librarian' },
                { pos: { x: ox - 10, y: g + 1, z: oz + 1 }, profession: 'farmer' },
                { pos: { x: ox - 8, y: g + 1, z: oz }, profession: 'librarian' },
            ],
        },
        cane: { canes, water },
        ghast: { post: { x: ox + 22, y: g + 1, z: oz - 14 }, at: { x: ox + 22.5, y: g + 2, z: oz - 10.5 } },
        portal: {
            frame: { min: { x: ox + 10, y: g + 1, z: oz - 20 }, max: { x: ox + 13, y: g + 5, z: oz - 20 } },
            inner: { min: { x: ox + 11, y: g + 2, z: oz - 20 }, max: { x: ox + 12, y: g + 4, z: oz - 20 } },
            lowest: { x: ox + 11, y: g + 2, z: oz - 20 },
        },
        ore,
    };
}

function failures(out) {
    // "Could not set the block": the block is there already; the builders accept that answer
    return out.flat().filter((l) => /not loaded|Incorrect|Unknown|Expected|Invalid|Too many|Cannot place|Unable to summon/.test(l));
}

async function run(cmds, what) {
    const out = await commands(cmds, 60000);
    const bad = failures(out);
    if (bad.length) throw new Error(`building ${what} failed: ${bad.slice(0, 3).join(' | ')}`);
    return out;
}

const summon = (kind, p, tags, nbt = '') => `summon minecraft:${kind} ${p.x + (Number.isInteger(p.x) ? 0.5 : 0)} ${p.y} ${p.z + (Number.isInteger(p.z) ? 0.5 : 0)} {NoAI:1b,PersistenceRequired:1b,Tags:[${tags.map((t) => `"${t}"`).join(',')}]${nbt ? ',' + nbt : ''}}`;

// Builds the small base. Resolves with { ghast: { leashed, text }, portal: { lit, text }, villagers: [professions read back] }.
async function buildSmallBase(p) {
    const g = p.g;
    await buildHouse(p.house, { chest: false });
    await buildChest(p.house.chest, { bread: 8 }, { facing: 'north' });
    await run([`setblock ${P(p.table)} minecraft:crafting_table`], 'the table');
    // the basement, the ladder column (its wall to the north is the rock), the trapdoor in the floor
    const b = p.basement;
    const col = p.column;
    await run([
        `fill ${P(b.box.min)} ${P(b.box.max)} minecraft:air`,
        `fill ${col.x} ${b.box.max.y + 1} ${col.z} ${col.x} ${g - 1} ${col.z} minecraft:air`,
        `fill ${col.x} ${b.box.min.y} ${col.z - 1} ${col.x} ${g - 1} ${col.z - 1} minecraft:stone replace minecraft:air`,
        `fill ${col.x} ${b.box.min.y} ${col.z} ${col.x} ${g - 1} ${col.z} minecraft:ladder[facing=south]`,
        `setblock ${P(p.trapdoor)} minecraft:oak_trapdoor[facing=south,half=top,open=false]`,
        `setblock ${P(b.furnace)} minecraft:furnace[facing=west]`,
        `setblock ${P(b.torch)} minecraft:torch`,
    ], 'the basement');
    await buildChest(b.chest, { cobblestone: 16 }, { facing: 'east' });
    // the tunnel into the rock, the opening into the cave, the cave (dark)
    await run([
        `fill ${P(p.tunnel.box.min)} ${P(p.tunnel.box.max)} minecraft:air`,
        `fill ${P(p.cave.opening.min)} ${P(p.cave.opening.max)} minecraft:air`,
        `fill ${P(p.cave.box.min)} ${P(p.cave.box.max)} minecraft:air`,
    ], 'the tunnel and the cave');
    // the iron ore in the rock around the basement (part E), before the first survey
    await run(p.ore.map((o) => `setblock ${P(o)} minecraft:iron_ore`), 'the ore');
    // the potato field
    const f = p.field;
    await run([
        `fill ${f.box.min.x} ${g - 1} ${f.box.min.z} ${f.box.max.x} ${g - 1} ${f.box.max.z} minecraft:dirt`,
        `fill ${f.box.min.x} ${g} ${f.box.min.z} ${f.box.max.x} ${g} ${f.box.max.z} minecraft:farmland[moisture=7]`,
        `fill ${f.box.min.x} ${g + 1} ${f.box.min.z} ${f.box.max.x} ${g + 1} ${f.box.max.z} minecraft:air`,
        `setblock ${P(f.water)} minecraft:water`,
        ...f.potatoes.map((c) => `setblock ${P(c)} minecraft:potatoes[age=7]`),
    ], 'the potato field');
    // the pens
    for (const [pen, roof] of [[p.cowPen, true], [p.pigPen, false]]) {
        const { min, max } = pen.box;
        const cmds = [
            `fill ${min.x} ${g - 1} ${min.z} ${max.x} ${g - 1} ${max.z} minecraft:dirt`,
            `fill ${min.x} ${g} ${min.z} ${max.x} ${g} ${max.z} minecraft:grass_block`,
            `fill ${min.x} ${g + 1} ${min.z} ${max.x} ${g + 1} ${max.z} minecraft:oak_fence`,
            `fill ${min.x + 1} ${g + 1} ${min.z + 1} ${max.x - 1} ${g + 3} ${max.z - 1} minecraft:air`,
            `setblock ${P(pen.gate)} minecraft:oak_fence_gate[facing=south,open=false]`,
        ];
        if (roof) cmds.push(`fill ${min.x} ${pen.roofY} ${min.z} ${max.x} ${pen.roofY} ${max.z} minecraft:oak_planks`);
        await run(cmds, 'a pen');
    }
    // the trading hall: a lectern, a composter, 3 villagers of those professions
    await run([`setblock ${P(p.hall.lectern)} minecraft:lectern[facing=east]`, `setblock ${P(p.hall.composter)} minecraft:composter[level=0]`], 'the job sites');
    // the cane by the pool
    await run([
        ...p.cane.water.map((w) => `setblock ${P(w)} minecraft:water`),
        ...p.cane.canes.map((c) => `setblock ${P(c)} minecraft:sugar_cane[age=0]`),
    ], 'the cane');
    // the fence post of the ghast
    await run([`setblock ${P(p.ghast.post)} minecraft:oak_fence`], 'the post');
    // the portal: the frame, then the portal blocks; the server keeps them when it accepts the frame
    const portalOut = await commands([
        `fill ${P(p.portal.frame.min)} ${P(p.portal.frame.max)} minecraft:obsidian`,
        `fill ${P(p.portal.inner.min)} ${P(p.portal.inner.max)} minecraft:nether_portal[axis=x]`,
    ]);
    await sleep(500);
    const lit = (await blockNames([p.portal.lowest, { ...p.portal.lowest, y: p.portal.lowest.y + 2 }], ['nether_portal'])).every((n) => n === 'nether_portal');
    // the entities
    await commands([`kill @e[tag=${TAG}]`]);
    const ent = [
        ...p.cats.map((c) => summon('cat', c, [TAG, `${TAG}_cat`])),
        ...p.cowPen.spots.slice(0, 5).map((c) => summon('cow', c, [TAG, `${TAG}_cow`])),
        ...p.pigPen.spots.slice(0, 4).map((c) => summon('pig', c, [TAG, `${TAG}_pig`])),
        ...p.hall.villagers.map((v, i) => summon('villager', v.pos, [TAG, `${TAG}_villager`, `${TAG}_villager_${i}`], `VillagerData:{profession:"minecraft:${v.profession}",level:1,type:"minecraft:plains"}`)),
    ];
    const summoned = await commands(ent);
    const bad = summoned.flat().filter((l) => !/Summoned new/.test(l));
    if (bad.length) throw new Error('summoning the animals and the villagers failed: ' + bad.slice(0, 3).join(' | '));
    const professions = [];
    for (let i = 0; i < p.hall.villagers.length; i++) {
        const out = await command(`data get entity @e[tag=${TAG}_villager_${i},limit=1] VillagerData.profession`);
        professions.push((/entity data: "?(?:minecraft:)?(\w+)"?/.exec(out.join(' ')) ?? [])[1] ?? null);
    }
    // the happy ghast on a leash to the post: the field `leash` of 26.1 is an int array with the block of the knot (the server
    // of 26.1 refuses the compound `{X,Y,Z}` of 1.21.5: "Not a list; No key UUID"), the compound is tried second; else noted
    const forms = [`leash:[I;${p.ghast.post.x},${p.ghast.post.y},${p.ghast.post.z}]`, `leash:{X:${p.ghast.post.x},Y:${p.ghast.post.y},Z:${p.ghast.post.z}}`];
    let ghast = { leashed: false, there: false, text: '' };
    for (const form of forms) {
        await commands([`kill @e[tag=${TAG}_ghast]`, `kill @e[type=minecraft:leash_knot,x=${p.ghast.post.x},y=${p.ghast.post.y},z=${p.ghast.post.z},distance=..3]`]);
        const ghastOut = await command(summon('happy_ghast', p.ghast.at, [TAG, `${TAG}_ghast`], form));
        await sleep(500);
        const leashData = await command(`data get entity @e[tag=${TAG}_ghast,limit=1] leash`);
        const knots = await countEntities(`@e[type=minecraft:leash_knot,x=${p.ghast.post.x},y=${p.ghast.post.y},z=${p.ghast.post.z},distance=..3]`);
        const ghastThere = await countEntities(`@e[tag=${TAG}_ghast]`);
        const leashed = ghastThere === 1 && knots >= 1 && leashData.some((l) => /entity data: [[{]/.test(l));
        ghast = { leashed, there: ghastThere === 1, text: `${form}: ${ghastOut.join(' ').slice(0, 200)} | leash: ${leashData.join(' ').slice(0, 120)} | knots at the post: ${knots}` };
        if (leashed) break;
    }
    return {
        ghast,
        portal: { lit, text: portalOut.flat().join(' ') },
        villagers: professions,
    };
}

// Reads the build back (the parts that the checks of A count). Resolves with { ok, lines }.
async function verifySmallBase(p, built) {
    const lines = [];
    const expect = async (what, list, names) => {
        const got = await blockNames(list.map((x) => x.pos), [...new Set(names)]);
        const wrong = list.filter((x, i) => got[i] !== x.name);
        lines.push(`${wrong.length ? 'WRONG' : 'ok'} ${what}: ${list.length - wrong.length} of ${list.length}${wrong.length ? ` (${wrong.slice(0, 3).map((x) => `${cellText(x.pos)} is ${got[list.indexOf(x)] ?? 'other'}`).join('; ')})` : ''}`);
        return wrong.length === 0;
    };
    const h = p.house;
    const results = [];
    results.push(await expect('house: door, bed, chest, table, trapdoor', [
        { pos: h.door, name: 'oak_door[half=lower,open=false]' }, { pos: h.bedFoot, name: 'red_bed[part=foot]' }, { pos: h.bedHead, name: 'red_bed[part=head]' },
        { pos: h.chest, name: 'chest' }, { pos: p.table, name: 'crafting_table' }, { pos: p.trapdoor, name: 'oak_trapdoor[half=top,open=false,facing=south]' },
    ], ['oak_door[half=lower,open=false]', 'red_bed[part=foot]', 'red_bed[part=head]', 'chest', 'crafting_table', 'oak_trapdoor[half=top,open=false,facing=south]']));
    results.push(await expect('ladder of 6', p.ladders.map((pos) => ({ pos, name: 'ladder[facing=south]' })), ['ladder[facing=south]']));
    results.push(await expect('basement: air, chest, furnace, stone floor', [
        { pos: p.basement.middle, name: 'air' }, { pos: { ...p.basement.middle, y: p.basement.box.max.y }, name: 'air' }, { pos: p.basement.chest, name: 'chest' },
        { pos: p.basement.furnace, name: 'furnace' }, { pos: { ...p.basement.middle, y: p.basement.floorY }, name: 'stone' },
    ], ['air', 'chest', 'furnace', 'stone']));
    const t = p.tunnel;
    const tunnelCells = [];
    for (let x = t.box.min.x; x <= t.box.max.x; x++) tunnelCells.push({ pos: { x, y: t.box.min.y, z: t.box.min.z }, name: 'air' }, { pos: { x, y: t.box.max.y, z: t.box.max.z }, name: 'air' });
    tunnelCells.push({ pos: { x: t.box.max.x + 1, y: t.box.min.y, z: t.box.min.z }, name: 'stone' }, { pos: { x: t.box.min.x + 6, y: t.box.min.y - 1, z: t.box.min.z }, name: 'stone' });
    results.push(await expect(`tunnel: 12 long, 2 wide, 2 high, rock at its end and under it`, tunnelCells, ['air', 'stone']));
    results.push(await expect('cave: air, the opening, no torch', [
        { pos: p.cave.middle, name: 'air' }, { pos: { ...p.cave.middle, y: p.cave.box.max.y }, name: 'air' }, { pos: p.cave.opening.min, name: 'air' }, { pos: p.cave.mouth, name: 'air' },
        { pos: { ...p.cave.middle, y: p.cave.box.min.y - 1 }, name: 'stone' },
    ], ['air', 'stone']));
    results.push(await expect('field: farmland and water', [...p.field.farmland.map((pos) => ({ pos, name: 'farmland' })), { pos: p.field.water, name: 'water' }], ['farmland', 'water']));
    results.push(await expect('field: 44 ripe potatoes', p.field.potatoes.map((pos) => ({ pos, name: 'potatoes[age=7]' })), ['potatoes[age=7]']));
    for (const [label, pen] of [['cow pen', p.cowPen], ['pig pen', p.pigPen]]) {
        results.push(await expect(`${label}: fence ring with gate`, pen.ring.map((pos) => ({ pos, name: pen.ringBlock(pos) })), ['oak_fence', 'oak_fence_gate']));
    }
    results.push(await expect('cow pen: roof of planks', [{ pos: { ...p.cowPen.inside, y: p.cowPen.roofY }, name: 'oak_planks' }, { pos: { ...p.cowPen.box.min, y: p.cowPen.roofY }, name: 'oak_planks' }], ['oak_planks']));
    results.push(await expect('trading hall: lectern and composter', [{ pos: p.hall.lectern, name: 'lectern' }, { pos: p.hall.composter, name: 'composter' }], ['lectern', 'composter']));
    results.push(await expect('cane: 12 sugar cane by the water', [...p.cane.canes.map((pos) => ({ pos, name: 'sugar_cane' })), { pos: p.cane.water[0], name: 'water' }], ['sugar_cane', 'water']));
    results.push(await expect('ore: 20 iron ore in the rock', p.ore.map((pos) => ({ pos, name: 'iron_ore' })), ['iron_ore']));
    const counts = {
        cats: await countEntities(`@e[type=minecraft:cat,x=${h.box.min.x},y=${h.box.min.y},z=${h.box.min.z},dx=${h.box.max.x - h.box.min.x},dy=5,dz=${h.box.max.z - h.box.min.z}]`),
        cows: await countEntities(`@e[type=minecraft:cow,x=${p.cowPen.box.min.x},y=${p.g},z=${p.cowPen.box.min.z},dx=8,dy=4,dz=8]`),
        pigs: await countEntities(`@e[type=minecraft:pig,x=${p.pigPen.box.min.x},y=${p.g},z=${p.pigPen.box.min.z},dx=8,dy=4,dz=8]`),
        villagers: await countEntities(`@e[type=minecraft:villager,tag=${TAG}_villager]`),
    };
    const entitiesOk = counts.cats === 2 && counts.cows === 5 && counts.pigs === 4 && counts.villagers === 3;
    lines.push(`${entitiesOk ? 'ok' : 'WRONG'} entities: ${counts.cats} cats in the house, ${counts.cows} cows in the cow pen, ${counts.pigs} pigs in the pig pen, ${counts.villagers} villagers (${JSON.stringify(built.villagers)})`);
    results.push(entitiesOk);
    return { ok: results.every(Boolean), lines, counts };
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const p = smallBasePlan(r);
        const g = p.g;
        const h = p.house;
        const built = await buildSmallBase(p);
        const verified = await verifySmallBase(p, built);
        for (const l of verified.lines) note(`build: ${l}`);
        note(`build: the happy ghast ${built.ghast.leashed ? 'is leashed to the post' : built.ghast.there ? 'stands but is NOT leashed (the leash is noted and skipped)' : 'could NOT be summoned (noted and skipped)'}: ${built.ghast.text}`);
        note(`build: the nether portal ${built.portal.lit ? 'holds its portal blocks' : 'did NOT keep its portal blocks (noted and skipped)'}: ${JSON.stringify(built.portal.text.slice(0, 160))}`);
        check(verified.ok, 'precondition: the small base of SPEC 7.1 is built as planned (every part read back from the server)', verified.lines.filter((l) => l.startsWith('WRONG')).join('; ') || 'all ok');
        check(built.villagers.filter((v) => v === 'librarian').length === 2 && built.villagers.filter((v) => v === 'farmer').length === 1, 'precondition: the 3 villagers have their professions (2 librarians, 1 farmer; VillagerData of 26.1)', JSON.stringify(built.villagers));
        const expectedItems = 9 + (built.ghast.leashed ? 1 : 0) + (built.portal.lit ? 1 : 0);
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the environment of the agent, which runs in this process; never printed
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server', String(port));
        const sup = new Supervisor({ url: `http://127.0.0.1:${port}/mcp`, token: TOKEN, name: SUPERVISOR });
        let agent = null, orders = null, s = null;
        const replies = []; // every survey report, for part E
        try {
            const j = await startJourney(NAME, null, {
                botAt: h.outsideDoor, botYaw: 0, playerAt: { x: h.outsideDoor.x + 2, y: g + 1, z: h.outsideDoor.z }, kit: [],
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port, base_survey: true, survey_radius: 128, routines: true }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            const t0 = Date.now();
            const areas = () => agent.area_store?.list?.() ?? [];
            const area = (name) => areas().find((a) => a.name === name) ?? null;
            const areasFile = () => readWorldFile(agent, 'areas.json').json?.areas ?? null;
            const placesFile = () => readWorldFile(agent, 'places.json').json?.places ?? null;
            const basesFile = () => readWorldFile(agent, 'bases.json').json?.bases ?? null;
            const at0 = await entityPos(NAME);
            check(Boolean(at0) && Math.abs(at0.x - (h.outsideDoor.x + 0.5)) < 1 && Math.abs(at0.z - (h.outsideDoor.z + 0.5)) < 1, 'precondition: the bot stands outside the house door', fmt(at0));

            // ====================================================== A. the first survey
            const tA = Date.now();
            const one = await orders.orderInfo(`!surveyBase("${BASE}")`, SURVEY_MS + 30000);
            const replyA = String(one.reply);
            replies.push(replyA);
            const items = splitItems(replyA);
            const head = REPORT_HEAD.exec(replyA);
            note(`A1: !surveyBase("east") answered after ${(one.ms / 1000).toFixed(1)} s: ${JSON.stringify(replyA)}`);
            note(`A1: the items of the report (${items.length}, ${expectedItems} expected): ${JSON.stringify(items)}; the bot said ${JSON.stringify(saidLines(s, tA).slice(0, 6))}`);
            check(one.done && one.ms <= SURVEY_MS && Boolean(head) && REPORT_TAIL.test(replyA), 'A1: within 60 s one report line `I found N places: ... All saved. Say "rename X to Y" or "forget X" to correct.` (SPEC 2.5)', `${(one.ms / 1000).toFixed(1)} s: ${JSON.stringify(replyA.slice(0, 200))}`);
            check(Boolean(head) && Number(head[1]) === items.length && items.length === expectedItems, `A1: N of "I found N places" is the number of items of the line, and the line has the ${expectedItems} places the control built`, `N ${head ? head[1] : '?'}, ${items.length} items`);
            check(ITEMS.house.test(replyA), 'A2: the report names the house with its bed: `house (1 bed)`', JSON.stringify(replyA.match(/\bhouse[^,]*/)?.[0] ?? 'no house'));
            check(ITEMS.basement.test(replyA), 'A2: the report names the basement with its contents: `basement (1 chest, 1 furnace)`', JSON.stringify(replyA.match(/\bbasement[^,]*(,[^,]*)?/)?.[0] ?? 'no basement'));
            check(ITEMS.hall.test(replyA), 'A2: the report names the trading hall with 3 villagers: `trading hall (3 villagers)`', JSON.stringify(replyA.match(/\btrading hall[^,]*/)?.[0] ?? 'no trading hall'));
            check(ITEMS.farm.test(replyA), 'A2: the report names the open potato field by its size: `potato farm 9 x 5`', JSON.stringify(replyA.match(/\b\w+ farm[^,]*/)?.[0] ?? 'no farm'));
            check(ITEMS.cows.test(replyA), 'A2: the report names the roofed pen by its animals: `cow pen (5 cows)`', JSON.stringify(replyA.match(/\bcow pen[^,]*/)?.[0] ?? 'no cow pen'));
            check(ITEMS.pigs.test(replyA), 'A2: the report names the pig pen: `pig pen (4 pigs)`', JSON.stringify(replyA.match(/\bpig pen[^,]*/)?.[0] ?? 'no pig pen'));
            check(ITEMS.cane.test(replyA), 'A2: the report names the cane with its count: `cane by the water (12)`', JSON.stringify(replyA.match(/\bcane[^,]*/)?.[0] ?? 'no cane'));
            if (built.ghast.leashed) check(near(ITEMS.ghast, replyA, p.ghast.post, 3), 'A2: the report names the tied ghast at its knot: `a tied happy ghast at (x, y, z)` (the fence post)', `${JSON.stringify(replyA.match(/\ba tied[^,]*/)?.[0] ?? 'no tied animal')}; the post ${cellText(p.ghast.post)}`);
            else note('A2: the ghast is not leashed in this run (26.1 summon with a leash): the tied-animal item is not checked');
            if (built.portal.lit) check(ITEMS.portal.test(replyA), 'A2: the report names the portal', JSON.stringify(replyA.match(/[^,]*portal[^,]*/)?.[0] ?? 'no portal'));
            else note('A2: the portal did not hold in this run: the portal item is not checked');
            check(near(ITEMS.mine, replyA, p.tunnel.mouth, 2), 'A2: the report names the mine entrance at the opening of the tunnel: `a mine entrance at (x, y, z)`', `${JSON.stringify(replyA.match(/\ba mine entrance[^,]*/)?.[0] ?? 'no mine entrance')}; the mouth ${cellText(p.tunnel.mouth)}`);
            check(near(ITEMS.cave, replyA, p.cave.mouth, 2), 'A2: the report names the cave mouth at the opening: `a cave mouth at (x, y, z) that I keep out of`', `${JSON.stringify(replyA.match(/\ba cave mouth[^,]*/)?.[0] ?? 'no cave mouth')}; the opening ${cellText(p.cave.mouth)}`);
            // the files of the world
            const af = areasFile();
            const list = areas();
            note(`A3: areas.json ${af ? `holds ${Object.keys(af).length} areas` : 'is MISSING'}: ${JSON.stringify(list.map(areaText))}`);
            const home = list.find((a) => a.kind === 'home');
            check(Boolean(home) && holds(home, h.inside) && home.source === 'survey' && home.base === BASE, 'A3: areas.json holds the house as a home (its box holds the room), source survey, base east', areaText(home));
            const basement = area('basement');
            check(Boolean(basement) && basement.type === 'building' && holds(basement, p.basement.middle) && basement.source === 'survey', 'A3: areas.json holds the basement as a building under the house (its box holds the dug room)', areaText(basement));
            const cowPen = area('cow_pen'), pigPen = area('pig_pen');
            check(Boolean(cowPen) && cowPen.kind === 'pen' && holds(cowPen, p.cowPen.inside) && (cowPen.contents?.animals?.cow ?? 0) === 5, 'A3: areas.json holds the cow pen (kind pen, its box holds the pen, 5 cows in its contents)', areaText(cowPen) + ` contents ${JSON.stringify(cowPen?.contents ?? null)}`);
            check(Boolean(pigPen) && pigPen.kind === 'pen' && holds(pigPen, p.pigPen.inside) && (pigPen.contents?.animals?.pig ?? 0) === 4, 'A3: areas.json holds the pig pen (kind pen, 4 pigs in its contents)', areaText(pigPen) + ` contents ${JSON.stringify(pigPen?.contents ?? null)}`);
            const farm = area('potato_farm');
            check(Boolean(farm) && farm.type === 'farm' && farm.border === 'open' && p.field.farmland.every((c) => holds(farm, c)), 'A3: areas.json holds the potato farm with the border `open`, its box holding every farmland cell', areaText(farm));
            const cane = list.find((a) => /^cane/.test(a.name));
            check(Boolean(cane) && cane.type === 'farm' && holds(cane, p.cane.canes[0]) && holds(cane, p.cane.canes[11]), 'A3: areas.json holds the cane (type farm) over the row of 12', areaText(cane));
            const caveMouth = list.find((a) => /^cave_mouth/.test(a.name));
            check(Boolean(caveMouth) && caveMouth.flags?.no_enter === true && holds(caveMouth, p.cave.mouth), 'A3: areas.json holds the cave mouth with the flag no_enter, its box at the opening', areaText(caveMouth));
            check(list.length > 0 && list.every((a) => a.source === 'survey' && a.base === BASE), 'A3: every area of the survey carries source `survey` and base `east`', JSON.stringify(list.map((a) => [a.name, a.source, a.base ?? null])));
            const pf = placesFile();
            const placeNames = pf ? Object.keys(pf) : [];
            const mine = pf?.mine_entrance ?? null;
            note(`A4: places.json ${pf ? `holds ${JSON.stringify(placeNames)}` : 'is MISSING'}; mine_entrance ${JSON.stringify(mine)}; tied ${JSON.stringify(pf?.tied_happy_ghast ?? null)}; trading hall ${JSON.stringify(pf?.trading_hall ?? null)}`);
            check(Boolean(mine) && Math.abs(Math.floor(mine.x) - p.tunnel.mouth.x) <= 2 && Math.abs(Math.floor(mine.z) - p.tunnel.mouth.z) <= 2 && Math.abs(Math.floor(mine.y) - p.tunnel.mouth.y) <= 2, 'A4: places.json holds the mine entrance at the opening of the tunnel', `${JSON.stringify(mine)}; the mouth ${cellText(p.tunnel.mouth)}`);
            if (built.ghast.leashed) check(Boolean(pf?.tied_happy_ghast), 'A4: places.json holds the tied ghast (tied_happy_ghast)', JSON.stringify(pf?.tied_happy_ghast ?? null));
            const routes = routesInFile(agent);
            const route = routes.find((x) => x.name === 'house_to_mine_entrance') ?? routes.find((x) => /_to_mine_entrance$/.test(String(x.name))) ?? null;
            const legs = route?.legs ?? [];
            note(`A5: routes.json holds ${JSON.stringify(routes.map((x) => `${x.name} (${(x.legs ?? []).map((l) => l.kind + (l.kind2 ? ':' + l.kind2 : '')).join(', ')}; source ${x.source})`))}`);
            check(Boolean(route) && legs.some((l) => l.kind === 'door' && l.kind2 === 'trapdoor') && legs.some((l) => l.kind === 'ladder'), 'A5: routes.json holds the route house_to_mine_entrance with a trapdoor leg and a ladder leg (2.3.4)', route ? JSON.stringify(legs.map((l) => `${l.kind}${l.kind2 ? ':' + l.kind2 : ''}`)) : 'no route');
            const bf = basesFile();
            const east = bf?.[BASE] ?? null;
            note(`A6: bases.json ${bf ? JSON.stringify(bf) : 'is MISSING'}`);
            check(Boolean(east) && east.door && Math.floor(east.door.x) === h.door.x && Math.floor(east.door.z) === h.door.z && Math.abs(Math.floor(east.door.y) - h.door.y) <= 1, 'A6: bases.json holds the base "east" with the house door', `${JSON.stringify(east?.door ?? null)}; the door ${cellText(h.door)}`);

            // ====================================================== B. rename, forget, survey again
            const farmBefore = area('potato_farm');
            const renamed = await orders.order('!renameArea("potato_farm", "spuds")', 30000);
            const spuds = area('spuds');
            note(`B1: !renameArea("potato_farm", "spuds") answered ${JSON.stringify(renamed)}; spuds ${areaText(spuds)}; potato_farm ${areaText(area('potato_farm'))}`);
            check(RENAMED.test(renamed), 'B1: `I renamed "potato_farm" to "spuds".`', JSON.stringify(renamed));
            check(Boolean(spuds) && !area('potato_farm') && (!farmBefore || sameBox(spuds, farmBefore)), 'B1: the area is "spuds" now with the same box, and "potato_farm" is gone', `spuds ${areaText(spuds)}; potato_farm ${area('potato_farm') ? 'STILL there' : 'gone'}`);
            const forgot = await orders.order('!forgetArea("pig_pen")', 30000);
            note(`B2: !forgetArea("pig_pen") answered ${JSON.stringify(forgot)}; pig_pen ${areaText(area('pig_pen'))}`);
            check(!area('pig_pen') && !(areasFile()?.pig_pen), 'B2: !forgetArea("pig_pen") forgets the pen (the area is gone from the store and the file)', JSON.stringify(forgot));
            const two = await orders.orderInfo(`!surveyBase("${BASE}")`, SURVEY_MS + 30000);
            const replyB = String(two.reply);
            replies.push(replyB);
            const pigAgain = area('pig_pen');
            note(`B3: the second !surveyBase("east") answered after ${(two.ms / 1000).toFixed(1)} s: ${JSON.stringify(replyB)}; pig_pen ${areaText(pigAgain)}; the areas ${JSON.stringify(areas().map((a) => a.name))}`);
            check(two.done && two.ms <= SURVEY_MS && AGAIN_PIG_PEN.test(replyB), 'B3: the second survey reports the difference only: `I surveyed "east" again: the pig pen is new. The rest as saved.`', JSON.stringify(replyB.slice(0, 200)));
            check(Boolean(pigAgain) && pigAgain.kind === 'pen' && (pigAgain.contents?.animals?.pig ?? 0) === 4 && Boolean(area('spuds')), 'B3: the pig pen is saved again (4 pigs) and "spuds" stays as the owner named it', `pig_pen ${areaText(pigAgain)}; spuds ${areaText(area('spuds'))}`);

            // ====================================================== C. the owner's words win
            const freed = await orders.order('!forgetArea("spuds")', 30000);
            note(`C0: the field is set free for the owner's area: !forgetArea("spuds") answered ${JSON.stringify(freed)} (the owner's choice, so that only his wheat_farm lies over the field)`);
            const o = p.field.ownerHalf;
            const setArea = await orders.order(`!setArea("wheat_farm", "farm", ${o.min.x}, ${o.min.y}, ${o.min.z}, ${o.max.x}, ${o.max.y}, ${o.max.z})`, 30000);
            const wheatBefore = area('wheat_farm');
            note(`C1: !setArea("wheat_farm", "farm", ...) over ${cellText(o.min)} to ${cellText(o.max)} (6 of the 9 columns of the field) answered ${JSON.stringify(setArea.slice(0, 200))}; wheat_farm ${areaText(wheatBefore)}`);
            check(Boolean(wheatBefore) && wheatBefore.type === 'farm' && wheatBefore.source !== 'survey', 'C1: precondition: the owner saved "wheat_farm" by hand over more than half of the potato field', areaText(wheatBefore));
            const three = await orders.orderInfo(`!surveyBase("${BASE}")`, SURVEY_MS + 30000);
            const replyC = String(three.reply);
            replies.push(replyC);
            const wheatAfter = area('wheat_farm');
            const surveyFarmsOverField = areas().filter((a) => a.source === 'survey' && a.type === 'farm' && overlaps(a, p.field.box));
            note(`C2: the third !surveyBase("east") answered after ${(three.ms / 1000).toFixed(1)} s: ${JSON.stringify(replyC)}; wheat_farm ${areaText(wheatAfter)}; survey farms over the field ${JSON.stringify(surveyFarmsOverField.map(areaText))}`);
            check(three.done && KEPT.test(replyC), 'C2: the report says the field lies inside the owner\'s "wheat_farm" and is kept: `a field at (x, y, z) inside your "wheat_farm" (kept as yours)` (PLAN 4, decision 6)', JSON.stringify(replyC.slice(0, 300)));
            check(Boolean(wheatAfter) && sameBox(wheatAfter, wheatBefore) && wheatAfter.source === wheatBefore?.source && wheatAfter.type === 'farm', 'C3: "wheat_farm" is unchanged by the survey (box, type, source)', `${areaText(wheatBefore)} -> ${areaText(wheatAfter)}`);
            check(surveyFarmsOverField.length === 0, 'C3: the kept find was not saved: no farm of source survey lies over the field', JSON.stringify(surveyFarmsOverField.map((a) => a.name)));

            // ====================================================== D. the underground in use: the way up at night
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            const moves = recordMoves(agent);
            const tD = Date.now();
            const down = await orders.orderInfo('!goToRememberedPlace("mine_entrance")', 150000);
            let atMouth = await entityPos(NAME);
            const arrived = Boolean(atMouth) && hdist(atMouth, { x: p.tunnel.mouth.x + 0.5, z: p.tunnel.mouth.z + 1 }) <= 3 && Math.abs(atMouth.y - p.tunnel.mouth.y) <= 1.5;
            note(`D0: !goToRememberedPlace("mine_entrance") answered after ${((Date.now() - tD) / 1000).toFixed(0)} s: ${JSON.stringify(String(down.reply).slice(0, 200))}; the bot at ${fmt(atMouth)}, the mouth ${cellText(p.tunnel.mouth)}: ${arrived ? 'arrived (the route down was walked by the bot)' : 'NOT at the mouth'}`);
            if (!arrived) {
                if (agent.actions.executing) note(`D0: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
                await placeBot(agent, { x: p.tunnel.mouth.x + 1, y: p.tunnel.mouth.y, z: p.tunnel.mouth.z }, -90);
                atMouth = await entityPos(NAME);
                note(`D0: the control stood the bot in the mouth of the tunnel at ${fmt(atMouth)} (noted: the way down is not what D proves; the way up is)`);
            }
            await commands(['gamerule advance_time false', `setblock ${P(p.trapdoor)} minecraft:oak_trapdoor[facing=south,half=top,open=false]`, 'time set 13000']);
            await sleep(1000);
            const trace = startTrace(async () => ({ bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 300);
            const tBed = Date.now();
            const bed = orders.orderInfo('!goToBed', 150000);
            const asleep = await waitFor(() => serverSleeping(NAME), { ms: 120000, every: 500 });
            const sleepPos = await command(`data get entity ${NAME} sleeping_pos`);
            const spm = /\[I; (-?\d+), (-?\d+), (-?\d+)\]/.exec(sleepPos.join(' '));
            const inBed = spm ? { x: Number(spm[1]), y: Number(spm[2]), z: Number(spm[3]) } : null;
            const rows = await trace.stop();
            moves.stop();
            const climb = rows.filter((x) => x.bot && Math.floor(x.bot.x) === p.column.x && Math.floor(x.bot.z) === p.column.z && x.bot.y > p.basement.box.min.y + 0.5 && x.bot.y < g + 0.5);
            const inCave = rows.filter((x) => x.bot && inBox(x.bot, p.cave.box));
            printTrace('D: !goToBed from the mine entrance', rows, { bot: (x) => fmt(x.bot), action: (x) => x.action }, 120);
            note(`D1: !goToBed typed at night from ${fmt(atMouth)}: the bot ${asleep.ok ? `sleeps after ${(asleep.ms / 1000).toFixed(1)} s` : 'does NOT sleep within 120 s'} at ${fmt(await entityPos(NAME))}; sleeping_pos ${JSON.stringify(inBed)} (the bed ${cellText(h.bedFoot)} / ${cellText(h.bedHead)}); ${climb.length} samples in the ladder column between the basement and the house, ${inCave.length} in the cave; the bot said ${JSON.stringify(saidLines(s, tBed).slice(0, 8))}; clicks ${JSON.stringify(moves.lines.filter((l) => /activateBlock/.test(l)).slice(-6))}`);
            check(asleep.ok, 'D1: at night the typed !goToBed from the mine entrance ends with the bot asleep within 120 s (server)', asleep.ok ? `${(asleep.ms / 1000).toFixed(1)} s` : `not asleep; said ${JSON.stringify(saidLines(s, tBed).slice(0, 4))}`);
            check(Boolean(inBed) && ((inBed.x === h.bedFoot.x && inBed.z === h.bedFoot.z) || (inBed.x === h.bedHead.x && inBed.z === h.bedHead.z)), 'D2: the bot sleeps in the house\'s bed (sleeping_pos of the server)', `${JSON.stringify(inBed)}; the bed ${cellText(h.bedFoot)}`);
            check(climb.length >= 2, 'D3: the way up took the ladder through the trapdoor: the trace holds the bot in the ladder column between the basement and the house floor (the route of 2.3.4)', `${climb.length} samples: ${JSON.stringify(climb.slice(0, 4).map((x) => fmt(x.bot)))}`);
            check(inCave.length === 0, 'D4: the bot never stood in the cave', `${inCave.length} samples in the cave`);
            if (asleep.ok) {
                await sleep(1500);
                note(`D: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
                await waitFor(async () => !(await serverSleeping(NAME)), { ms: 10000, every: 250 });
            }
            const bedInfo = await Promise.race([bed, sleep(20000).then(() => null)]);
            note(`D: !goToBed answered ${bedInfo ? JSON.stringify(String(bedInfo.reply).slice(0, 200)) : '(no answer within 20 s of the stop)'}`);
            if (!bedInfo && agent.actions.executing) note(`D: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await commands(['time set 6000']);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });

            // ====================================================== E. the x-ray guard
            const stats = await orders.order('!stats', 20000);
            const state = await sup.call('state');
            const files = { areas: JSON.stringify(areasFile()), places: JSON.stringify(placesFile()), routes: JSON.stringify(routesInFile(agent)), bases: JSON.stringify(basesFile()) };
            const oreIn = (text) => ORE_WORD.exec(String(text ?? ''))?.[0] ?? null;
            const said = saidLines(s, t0);
            note(`E: 20 iron ore lie in the rock around the basement (${verified.lines.find((l) => /ore/.test(l))}); !stats ${JSON.stringify(stats.slice(0, 200))}; the watch state ${JSON.stringify(state.text.split('\n').slice(0, 3))}`);
            check(replies.every((t) => oreIn(t) === null), 'E1: no report of the three surveys names an ore', JSON.stringify(replies.map(oreIn)));
            check(Object.values(files).every((t) => oreIn(t) === null), 'E2: no area, place, route or base of the world files names an ore (the ore-blind reader, SPEC 2.1)', JSON.stringify(Object.fromEntries(Object.entries(files).map(([k, t]) => [k, oreIn(t)]))));
            check(oreIn(stats) === null, 'E3: the typed !stats shows no ore knowledge', JSON.stringify(oreIn(stats)));
            check(state.ok && oreIn(state.text) === null, 'E4: the watch `state` shows no ore knowledge', JSON.stringify(oreIn(state.text)));
            check(said.every((l) => oreIn(l) === null), 'E5: nothing the bot said names an ore', JSON.stringify(said.filter((l) => oreIn(l) !== null).slice(0, 3)));

            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            check(!inLogs, 'the watch token is in no console line of the agent', inLogs ? 'HAS it' : 'no');
            note(`the areas at the end ${JSON.stringify(areas().map(areaText))}; the places ${JSON.stringify(Object.keys(placesFile() ?? {}))}; the bot said ${JSON.stringify(said.filter((l) => !/^\*w_player used/.test(l)).slice(0, 20))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[tag=${TAG}]`, 'gamerule advance_time false', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
