// The small base of SPEC 7.1 of v0.1.4.15 (tester T3), moved out of w126_base.js in v0.1.4.16 so that W128 and W129 build the same
// base without running W126: a house of housePlan (7 x 5 x 7, x -3..3, z -3..3, the oak door in the north wall at (0, g+1, -3), a
// red bed, a chest, a crafting table, 2 cats); in its floor an oak trapdoor at (1, g, 0) over a ladder of 6 (y g-6..g-1, facing
// south) down to a dug basement (air x -1..3, y g-6..g-4, z 0..4, stone floor at g-7) with a chest, a furnace and a torch; from the
// basement's east wall a tunnel of 12 into the rock (x 4..15, 2 wide z 1..2, 2 high) and in its west wall an opening (x -3..-2,
// z 2) into a dark cave of 5 x 5 x 4 (x -8..-4, y g-6..g-3, z 0..4); an unfenced potato field 9 x 5 north of the house (x -4..4,
// z -15..-11, 44 ripe potatoes and a water cell); a fenced pen 9 x 9 east of the house (x 8..16, z -4..4) with 5 cows and a roof of
// oak planks at g+4; a fenced pen 9 x 9 (x 8..16, z 8..16) with 4 pigs; a lectern and a composter west of the house (x -9) with 3
// villagers (2 librarians, 1 farmer); a row of 12 sugar cane (x -6..5, z 8) by a pool (x -6..5, z 9..10); a happy ghast leashed to
// a lone fence post (x 22, z -14) when `summon` with a leash holds on 26.1 (else noted and skipped); a nether portal of 4 x 5
// obsidian (x 10..13, z -20) lit when `setblock nether_portal` holds; 20 iron ore in the rock around the basement. The offsets are
// from the origin (ox, oz), g the grass at y 60. The console commands use the names of 26.1.
import { commands, command, sleep, fmt } from './helpers.js';
import { housePlan, buildHouse, buildChest, blockNames } from './world.js';
import { countEntities } from './journey.js';

export const TAG = 'mcw';
const P = (p) => `${p.x} ${p.y} ${p.z}`;
export const cellText = (p) => `(${p.x}, ${p.y}, ${p.z})`;

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
            // the owner's wheat_farm of W126 part C: 6 of the 9 columns, the rows with a margin of 1 (more than half of the field)
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

/** Runs console commands and throws when one of them failed (the block there already is no failure). */
export async function run(cmds, what) {
    const out = await commands(cmds, 60000);
    const bad = failures(out);
    if (bad.length) throw new Error(`building ${what} failed: ${bad.slice(0, 3).join(' | ')}`);
    return out;
}

/** A `summon` of an entity that stands still (NoAI, persistent) with tags, and more NBT after them. */
export const summon = (kind, p, tags, nbt = '') => `summon minecraft:${kind} ${p.x + (Number.isInteger(p.x) ? 0.5 : 0)} ${p.y} ${p.z + (Number.isInteger(p.z) ? 0.5 : 0)} {NoAI:1b,PersistenceRequired:1b,Tags:[${tags.map((t) => `"${t}"`).join(',')}]${nbt ? ',' + nbt : ''}}`;

// Builds the small base. Resolves with { ghast: { leashed, there, text }, portal: { lit, text }, villagers: [professions read back] }.
// options.ghast false and options.portal false leave those parts out (a scenario that does not read the report's items).
export async function buildSmallBase(p, { ghast: withGhast = true, portal: withPortal = true } = {}) {
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
    // the iron ore in the rock around the basement (W126 part E), before the first survey
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
    if (withGhast) await run([`setblock ${P(p.ghast.post)} minecraft:oak_fence`], 'the post');
    // the portal: the frame, then the portal blocks; the server keeps them when it accepts the frame
    let lit = false;
    let portalOut = [];
    if (withPortal) {
        portalOut = await commands([
            `fill ${P(p.portal.frame.min)} ${P(p.portal.frame.max)} minecraft:obsidian`,
            `fill ${P(p.portal.inner.min)} ${P(p.portal.inner.max)} minecraft:nether_portal[axis=x]`,
        ]);
        await sleep(500);
        lit = (await blockNames([p.portal.lowest, { ...p.portal.lowest, y: p.portal.lowest.y + 2 }], ['nether_portal'])).every((n) => n === 'nether_portal');
    }
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
    let ghast = { leashed: false, there: false, text: 'not built' };
    if (withGhast) {
        const forms = [`leash:[I;${p.ghast.post.x},${p.ghast.post.y},${p.ghast.post.z}]`, `leash:{X:${p.ghast.post.x},Y:${p.ghast.post.y},Z:${p.ghast.post.z}}`];
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
    }
    return {
        ghast,
        portal: { lit, text: portalOut.flat().join(' ') },
        villagers: professions,
    };
}

// Reads the build back (the parts that the checks of W126 A count). Resolves with { ok, lines, counts }.
export async function verifySmallBase(p, built) {
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
    results.push(await expect('tunnel: 12 long, 2 wide, 2 high, rock at its end and under it', tunnelCells, ['air', 'stone']));
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
    lines.push(`${entitiesOk ? 'ok' : 'WRONG'} entities: ${counts.cats} cats in the house, ${counts.cows} cows in the cow pen, ${counts.pigs} pigs in the pig pen, ${counts.villagers} villagers (${JSON.stringify(built?.villagers ?? null)})`);
    results.push(entitiesOk);
    return { ok: results.every(Boolean), lines, counts };
}

export { fmt };
