// W124 the open farm and the cats (v0.1.4.14 fix round, part 8, tester T3; SPEC 8.2, 8.5 and 8.10, DECISIONS P-18 and P-23,
// the play of 2026-11-09): the owner's house with two cats was saved as a pen ("a pen, walled, 6 x 8 with a roof, 2 doors,
// 2 cats"), his farms without a fence could not be saved at all ("I see no fence within 6 blocks"), and the bot's own dig
// pits were "a walled yard 7 x 7 with a roof", a help event each. Against 2c368e7 parts A and B fail (the house is a pen,
// the open farm is refused); part D fails when the area sense still reads a pit as a yard.
//
// The base world (the house with its bed and chest, the fenced farm with wheat, the pen with its cow and chicken), the
// owner's switches (SUPERVISION_SETTINGS) with the watch server on, the modes of his profile (area_sense on), an empty
// memory. The bot starts in the house, the player beside it. The console commands keep the names of 1.21.8 (translated).
//   A. The house with 2 cats and a bed. Two cats are summoned in the house (`summon cat`, tagged). Typed
//      `!rememberArea("house")` (untyped: the kind the bot concludes): `I saved "house": a home, walled, 9 x 11 with a
//      roof, 1 door, 1 trapdoor, 2 cats, 1 bed, 1 chest. I shelter there at night.` (8.2.1: a home before a pen, cats are
//      pets); the area is forgotten again (`!forgetArea`). Typed `!rememberArea("home", "building")`: `I saved "home": a
//      building, walled, 9 x 11 with a roof, ..., 2 cats, 1 bed, 1 chest. I change nothing in it.` (8.2.2: the typed kind
//      wins, the answer describes what was found); the area "home" is a building whose box holds the house; never a pen.
//   B. The open farm. A field of 9 x 5 farmland north of the house, no fence: 27 ripe carrots on three rows, a water
//      source and empty farmland on the fourth, 9 young potatoes on the fifth. The bot walks to its edge (typed
//      !goToCoordinates). Typed `!rememberArea("carrots", "farm")`: `I saved "carrots": an open farm 9 x 5 with 27 carrots
//      and 9 potatoes.` (8.11); the area "carrots" is a farm with the border `open`, its box holds every farmland cell and
//      nothing of the house or the fenced farm. Then the farming pack works it: typed `!harvest("carrots")`: `I harvested
//      N carrots and planted N again.` with N 20 or more, the carrot cells hold young carrots again (age below 7), the
//      bag holds carrots (server), the farmland stays farmland.
//   C. The pen stays a pen, roof or not (the owner's rule: a fenced enclosure with animals is a pen; the border decides,
//      fence = pen, wall = building or home): a roof of oak planks goes over the base's pen, 3 chickens more in it (4
//      chickens, 1 cow); the control stands the bot in the pen; within 25 s the area sense says `I am in a fenced pen 9 x 9
//      with a roof, ... that I have not saved. Tell me its name and I keep it.`; typed `!rememberArea("pen")`: `I saved
//      "pen": a pen, fenced, 9 x 9 with a roof, 1 gate, 4 chickens, 1 cow. I keep its gate closed and pick nothing up inside
//      it.`; the area is a pen.
//   D. A pit beside the house raises no yard (8.5), two shapes, the bot idle 70 s on the floor of each: an open hollow of
//      5 x 5, 3 deep, 3 blocks from the north-east corner of the house (its walls dirt and grass: the ground itself); and
//      the owner's dig cavity, 5 x 5 x 3 under the grass 3 blocks west of the house with one hole of 1 x 1 from the surface
//      (a roof and 1 gap, walls of dirt and stone: "a walled yard 7 x 7 with a roof and 1 gap" in his play). The bot says no
//      line of the area sense about either (no "yard", no "that I have not saved", no "Tell me its name"), and the watch
//      `events` since then holds no help event of the sense (a job's `Help:` line is another matter and is only noted).
//      Against 2c368e7 the open hollow raised nothing (noted), the cavity is the shape that did.
// Throughout: the process lives, no request reached a real model, the token is in no console line.
import crypto from 'node:crypto';
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, placeBot, walkTyped,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, blockNames, cropAges, inventoryOf, itemsText, stableInventory } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER, freePort, countEntities } from './journey.js';
import { Supervisor } from './supervisor.js';

const NAME = 'w_openfarm';
const SUPERVISOR = 'Opus';
const TAG = 'mcw';
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const cellText = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const areaText = (a) => (a ? `${a.name} (type ${a.type}, kind ${a.kind}, border ${a.border ?? '-'}) (${a.min.x}, ${a.min.y}, ${a.min.z}) to (${a.max.x}, ${a.max.y}, ${a.max.z})` : 'none');
// SPEC 8.2 and 8.11, word for word (the size of the house box: 9 x 11 outside, 7 x 9 inside, as W94 accepts)
const HOUSE_HOME = /^I saved "house": a home, walled, (9 x 11|7 x 9) with a roof, 1 door(, 1 trapdoor)?, 2 cats, 1 bed, 1 chest\. I shelter there at night\./;
const HOME_BUILDING = /^I saved "home": a building, walled, (9 x 11|7 x 9) with a roof, 1 door(, 1 trapdoor)?, 2 cats, 1 bed, 1 chest\. I change nothing in it\./;
const OPEN_FARM = /^I saved "carrots": an open farm (\d+) x (\d+) with (\d+) carrots and (\d+) potatoes\.$/;
const HARVESTED = /I harvested (\d+) carrots? and planted (\d+) again\./;
// the size of the pen: 9 x 9 (the fence ring), 7 x 7 (its inside) or 11 x 11 (the ring with its margin, which a scan with a roof gave)
const PEN = /^I saved "pen": a pen, fenced, (9 x 9|7 x 7|11 x 11) with a roof, 1 gate, 4 chickens, 1 cow\. I keep its gate closed and pick nothing up inside it\./;
const PEN_SENSED = /^I am in a fenced pen (9 x 9|7 x 7|11 x 11) with a roof\b.*that I have not saved\. Tell me its name and I keep it\./;
const SENSE_LINE = /\byard\b|that I have not saved|Tell me its name/;
// a help event of the area sense (not one of a job, such as `Help: "I stop the harvest: ..."`)
const HELP_EVENT = /\bhelp: .*(\byard\b|that I have not saved|Tell me its name|\bwalled\b|\benclosure\b)/;

// The area holds `inner` and lies within `box` grown by 1 block in x and z (W94).
function holds(area, box, inner) {
    if (!area?.min || !area?.max) return false;
    const c = { x: inner.x + 0.5, y: inner.y, z: inner.z + 0.5 };
    const within = area.min.x >= box.min.x - 1 && area.max.x <= box.max.x + 1 && area.min.z >= box.min.z - 1 && area.max.z <= box.max.z + 1;
    return within && inBox(c, area);
}
const overlaps = (area, box) => Boolean(area) && !(area.max.x < box.min.x || area.min.x > box.max.x || area.max.z < box.min.z || area.min.z > box.max.z);

// The open field north of the house (9 x 5): the farmland cells, the water, the carrots (ripe) and the potatoes (young).
function openFieldPlan(b) {
    const g = b.g;
    const x0 = b.ox - 4, x1 = b.ox + 4, z0 = b.oz - 22, z1 = b.oz - 18;
    const ground = [];
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) ground.push({ x, y: g, z });
    const water = { x: b.ox, y: g, z: z0 + 3 };
    const carrots = ground.filter((c) => c.z <= z0 + 2).map((c) => ({ x: c.x, y: g + 1, z: c.z }));
    const potatoes = ground.filter((c) => c.z === z1).map((c) => ({ x: c.x, y: g + 1, z: c.z }));
    return {
        box: { min: { x: x0, y: g, z: z0 }, max: { x: x1, y: g + 1, z: z1 } },
        ground, water, carrots, potatoes,
        farmland: ground.filter((c) => !(c.x === water.x && c.z === water.z)),
        edge: { x: b.ox, y: g + 1, z: z1 + 1 }, // on the grass 1 block south of the field, towards the house
    };
}

async function buildOpenField(f) {
    const { min, max } = f.box;
    const cmds = [
        `fill ${min.x} ${min.y - 1} ${min.z} ${max.x} ${min.y - 1} ${max.z} minecraft:dirt`,
        `fill ${min.x} ${min.y} ${min.z} ${max.x} ${min.y} ${max.z} minecraft:farmland[moisture=7]`,
        `fill ${min.x} ${min.y + 1} ${min.z} ${max.x} ${min.y + 1} ${max.z} minecraft:air`,
        `setblock ${P(f.water)} minecraft:water`,
        ...f.carrots.map((p) => `setblock ${P(p)} minecraft:carrots[age=7]`),
        ...f.potatoes.map((p) => `setblock ${P(p)} minecraft:potatoes[age=3]`),
    ];
    const out = await commands(cmds, 60000);
    const bad = out.flat().filter((l) => /not loaded|Incorrect|Unknown|Expected|Invalid/.test(l));
    if (bad.length) throw new Error('building the open field failed: ' + bad.slice(0, 3).join(' | '));
}

// The pit beside the house (8.5): 5 x 5, 3 deep, 3 blocks east and north of the north-east corner; its walls are dirt and
// grass (the ground of the base world: grass at g, dirt g-1..g-3, stone below), its floor dirt at g-3.
function pitPlan(b) {
    const g = b.g;
    const x0 = b.house.box.max.x + 3, z1 = b.house.box.min.z - 2;
    return {
        box: { min: { x: x0, y: g - 2, z: z1 - 4 }, max: { x: x0 + 4, y: g, z: z1 } },
        floor: { x: x0 + 2, y: g - 2, z: z1 - 2 }, // where the bot stands: its feet on the dirt at g-3
    };
}

// The owner's dig cavity (P-23): 5 x 5 x 3 under the grass, 3 blocks west of the north-west corner of the house, its roof the
// dirt and grass of the ground (g-1, g), its walls dirt (g-3, g-2) and stone (g-4), its floor stone at g-5; one hole of 1 x 1
// from the surface down into it at its east edge (the gap the owner's bot dug in through).
function cavityPlan(b) {
    const g = b.g;
    const x1 = b.house.box.min.x - 3, z1 = b.house.box.min.z - 2;
    return {
        box: { min: { x: x1 - 4, y: g - 4, z: z1 - 4 }, max: { x: x1, y: g - 2, z: z1 } },
        hole: [{ x: x1, y: g - 1, z: z1 - 2 }, { x: x1, y: g, z: z1 - 2 }],
        floor: { x: x1 - 2, y: g - 4, z: z1 - 2 }, // where the bot stands: its feet on the stone at g-5
        roof: { x: x1 - 2, y: g - 1, z: z1 - 2 },
    };
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const h = b.house;
        const pen = b.pen;
        const field = openFieldPlan(b);
        await buildOpenField(field);
        const pit = pitPlan(b);
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the environment of the agent, which runs in this process; never printed
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server', String(port));
        const sup = new Supervisor({ url: `http://127.0.0.1:${port}/mcp`, token: TOKEN, name: SUPERVISOR });
        let agent = null, orders = null, s = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: h.home, playerAt: { x: h.home.x + 2, y: g + 1, z: h.home.z }, kit: [],
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            const area = (name) => agent.area_store?.get?.(name) ?? null;
            const t0 = Date.now();

            // ====================================================== A. the house with 2 cats and a bed
            const catCells = [{ x: h.home.x - 1, y: g + 1, z: h.home.z + 2 }, { x: h.home.x + 2, y: g + 1, z: h.home.z - 2 }];
            const summoned = await commands(catCells.map((c) => `summon minecraft:cat ${c.x + 0.5} ${c.y} ${c.z + 0.5} {PersistenceRequired:1b,Tags:["${TAG}","${TAG}_cat"]}`));
            const seen = await waitFor(() => Object.values(agent.bot.entities).filter((e) => e?.name === 'cat' && inBox(e.position, h.interior)).length >= 2, { ms: 10000, every: 200 });
            const catsServer = await countEntities(`@e[type=minecraft:cat,tag=${TAG}_cat]`);
            note(`A0: ${JSON.stringify(summoned.flat())}; the server has ${catsServer} cats; the bot sees ${seen.ok ? '2 cats in the house' : 'NOT 2 cats in the house within 10 s'}; the bot at ${fmt(await entityPos(NAME))}`);
            check(catsServer === 2 && seen.ok, 'A0: precondition: 2 cats in the house, seen by the bot', `${catsServer} on the server, seen ${seen.ok}`);
            const one = await orders.order('!rememberArea("house")', 90000);
            const aHouse = area('house');
            note(`A1: !rememberArea("house") (untyped) answered ${JSON.stringify(one)}; the area ${areaText(aHouse)}`);
            check(HOUSE_HOME.test(one), 'A1: the untyped scan of the house with 2 cats and a bed is a home: `I saved "house": a home, walled, 9 x 11 with a roof, 1 door, 1 trapdoor, 2 cats, 1 bed, 1 chest. I shelter there at night.` (8.2.1: a home before a pen, cats are pets)', JSON.stringify(one));
            check(aHouse?.kind === 'home' && holds(aHouse, h.box, h.home), 'A1: the area "house" is of kind home and holds the house', areaText(aHouse));
            const forgot = await orders.order('!forgetArea("house")', 30000);
            note(`A1: !forgetArea("house") answered ${JSON.stringify(forgot)}; areas ${JSON.stringify((agent.area_store?.list?.() ?? []).map((a) => a.name))}`);
            const two = await orders.order('!rememberArea("home", "building")', 90000);
            const aHome = area('home');
            note(`A2: !rememberArea("home", "building") answered ${JSON.stringify(two)}; the area ${areaText(aHome)}`);
            check(HOME_BUILDING.test(two), 'A2: the typed kind wins and the answer describes what was found: `I saved "home": a building, walled, 9 x 11 with a roof, 1 door, 1 trapdoor, 2 cats, 1 bed, 1 chest. I change nothing in it.` (8.2.2)', JSON.stringify(two));
            check(aHome?.kind === 'building' && aHome?.type === 'building' && holds(aHome, h.box, h.home), 'A2: the area "home" is a building (kind and type) whose box holds the house', areaText(aHome));
            check(!/\ba pen\b/.test(one) && !/\ba pen\b/.test(two) && aHouse?.kind !== 'pen' && aHome?.kind !== 'pen', 'A: the house is never a pen (P-18)', JSON.stringify([one.slice(0, 60), two.slice(0, 60)]));

            // ====================================================== B. the open farm
            const walk = await walkTyped(orders, agent, field.edge, 120000);
            check(walk.arrived, 'B0: precondition: the bot walked out of the house to the edge of the open field (typed !goToCoordinates)', fmt(walk.pos));
            const ages0 = await cropAges(field.carrots, 'carrots', 7);
            check(ages0.every((a) => a === 7), 'B0: precondition: 27 ripe carrots stand on the open field (server)', JSON.stringify(ages0));
            const three = await orders.order('!rememberArea("carrots", "farm")', 90000);
            const aFarm = area('carrots');
            const m3 = OPEN_FARM.exec(three);
            note(`B1: !rememberArea("carrots", "farm") answered ${JSON.stringify(three)}; the area ${areaText(aFarm)}; the field box ${cellText(field.box.min)} to ${cellText(field.box.max)}`);
            check(Boolean(m3) && Number(m3[1]) === 9 && Number(m3[2]) === 5 && Number(m3[3]) === field.carrots.length && Number(m3[4]) === field.potatoes.length, `B1: a farm with no fence is saved as the open farm, the size that of the field itself: \`I saved "carrots": an open farm 9 x 5 with ${field.carrots.length} carrots and ${field.potatoes.length} potatoes.\` (8.2.3, 8.11; the saved box keeps its margin, 11 x 7)`, JSON.stringify(three));
            check(aFarm?.type === 'farm' && aFarm?.border === 'open', 'B1: the area "carrots" is a farm with the border `open`', areaText(aFarm));
            check(Boolean(aFarm) && field.ground.every((c) => inBox({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, aFarm)), 'B1: the box of the open farm holds every farmland cell of the field', areaText(aFarm));
            check(Boolean(aFarm) && !overlaps(aFarm, h.box) && !overlaps(aFarm, b.farm.box), 'B1: the box holds nothing of the house or the fenced farm', areaText(aFarm));
            const inv0 = await inventoryOf(NAME);
            const tH = Date.now();
            const harvest = await orders.orderInfo('!harvest("carrots")', 300000);
            const ages1 = await cropAges(field.carrots, 'carrots', 7);
            const potatoes1 = await cropAges(field.potatoes, 'potatoes', 7);
            const ground1 = await blockNames(field.ground, ['farmland', 'water', 'dirt', 'grass_block', 'air']);
            const inv1 = await stableInventory(NAME);
            const mH = HARVESTED.exec(harvest.reply);
            const young = ages1.filter((a) => a !== null && a < 7).length;
            const notFarmland = field.ground.filter((c, i) => !(ground1[i] === 'farmland' || (c.x === field.water.x && c.z === field.water.z && ground1[i] === 'water')));
            note(`B2: !harvest("carrots") answered after ${((Date.now() - tH) / 1000).toFixed(0)} s: ${JSON.stringify(harvest.reply.slice(0, 300))}; the carrot cells ${JSON.stringify(ages1)}; the potatoes ${JSON.stringify(potatoes1)}; cells not farmland ${JSON.stringify(notFarmland.map((c, i) => `${cellText(c)} ${ground1[field.ground.indexOf(c)]}`))}; the bag ${itemsText(inv0)} -> ${itemsText(inv1.items)}; the bot at ${fmt(await entityPos(NAME))}`);
            check(harvest.done && Boolean(mH) && Number(mH[1]) >= 20, 'B2: the farming pack works the open farm: `I harvested N carrots and planted N again.` with N 20 or more (8.2.3)', JSON.stringify(harvest.reply.slice(0, 200)));
            check(young >= 20, 'B2: the carrot cells hold young carrots again (20 or more of 27 below age 7; server)', `${young} of ${field.carrots.length} young: ${JSON.stringify(ages1)}`);
            check((inv1.items.carrot || 0) > (inv0.carrot || 0), 'B2: the bag holds carrots of the harvest (server)', `${inv0.carrot || 0} -> ${inv1.items.carrot || 0} carrot`);
            check(notFarmland.length === 0, 'B2: the farmland stays farmland (nothing trampled or dug)', JSON.stringify(notFarmland.map(cellText)));
            check(potatoes1.every((a) => a === 3), 'B2: the young potatoes stand (age 3)', JSON.stringify(potatoes1));

            // ====================================================== C. the pen stays a pen, roof or not
            // the owner's rule: a fenced enclosure with animals is a pen, roof or not; a roof of oak planks goes over the pen
            const roofY = g + 4;
            const extra = [`fill ${pen.box.min.x} ${roofY} ${pen.box.min.z} ${pen.box.max.x} ${roofY} ${pen.box.max.z} minecraft:oak_planks`];
            for (let k = 0; k < 3; k++) {
                const p = { x: pen.inner.min.x + 1 + k, y: g + 1, z: pen.inner.max.z - 1 };
                extra.push(`summon minecraft:chicken ${p.x + 0.5} ${p.y} ${p.z + 0.5} {PersistenceRequired:1b,Tags:["${pen.tag}","${pen.tag}_extra"]}`);
            }
            const roofed = await commands(extra);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            const tC = Date.now();
            await placeBot(agent, pen.inside, 0); // the control stands the bot in the pen (noted: this part reads the kind, not the way in)
            const inPen = await waitFor(() => Object.values(agent.bot.entities).filter((e) => e?.name === 'chicken' && inBox(e.position, pen.inner)).length >= 4, { ms: 10000, every: 200 });
            const roofBlock = await blockNames([{ x: pen.inside.x, y: roofY, z: pen.inside.z }], ['oak_planks']);
            note(`C0: the roof ${JSON.stringify(roofed[0])} (over the bot: ${roofBlock[0]}); the control stood the bot in the pen at ${fmt(await entityPos(NAME))}; the bot sees ${inPen.ok ? '4 chickens' : 'NOT 4 chickens'} in it; the server counts ${await countEntities(`@e[type=minecraft:chicken,tag=${pen.tag}]`)} chickens of the pen`);
            check(roofBlock[0] === 'oak_planks' && inPen.ok, 'C0: precondition: a roof of planks over the pen, 4 chickens in it, the bot inside', `roof ${roofBlock[0]}, chickens seen ${inPen.ok}`);
            const sensed = await waitFor(() => saidLines(s, tC).find((l) => /^I am in an? [\w-]+ \w+\b.*that I have not saved/.test(l)) ?? null, { ms: 25000, every: 500 });
            note(`C0: the area sense ${sensed.ok ? `said after ${(sensed.ms / 1000).toFixed(1)} s: ${JSON.stringify(sensed.value)}` : `said nothing of the place within 25 s; the bot said ${JSON.stringify(saidLines(s, tC).slice(0, 4))}`}`);
            check(sensed.ok && PEN_SENSED.test(sensed.value), 'C0: the area sense reads the roofed pen as a pen: `I am in a fenced pen 9 x 9 with a roof, ... that I have not saved. Tell me its name and I keep it.` (fence = pen, roof or not)', sensed.ok ? JSON.stringify(sensed.value) : 'no line');
            const four = await orders.order('!rememberArea("pen")', 90000);
            const aPen = area('pen');
            note(`C1: !rememberArea("pen") answered ${JSON.stringify(four)}; the area ${areaText(aPen)}`);
            check(PEN.test(four), 'C1: the roofed pen with its chickens stays a pen: `I saved "pen": a pen, fenced, 9 x 9 with a roof, 1 gate, 4 chickens, 1 cow. I keep its gate closed and pick nothing up inside it.`', JSON.stringify(four));
            check(aPen?.kind === 'pen' && holds(aPen, pen.box, pen.inside), 'C1: the area "pen" is of kind pen and holds the pen', areaText(aPen));

            // ====================================================== D. a pit beside the house raises no yard
            await commands([`fill ${P(pit.box.min)} ${P(pit.box.max)} minecraft:air`, `kill @e[type=!minecraft:player,x=${pit.box.min.x - 1},y=${pit.box.min.y - 1},z=${pit.box.min.z - 1},dx=7,dy=6,dz=7]`]);
            const walls = await blockNames([
                { x: pit.box.min.x - 1, y: g - 1, z: pit.floor.z }, { x: pit.box.max.x + 1, y: g - 1, z: pit.floor.z },
                { x: pit.floor.x, y: g - 1, z: pit.box.min.z - 1 }, { x: pit.floor.x, y: g - 1, z: pit.box.max.z + 1 },
                { x: pit.floor.x, y: g, z: pit.box.min.z - 1 }, { x: pit.floor.x, y: g - 3, z: pit.floor.z },
            ], ['dirt', 'grass_block', 'stone', 'air']);
            note(`D0: the pit ${cellText(pit.box.min)} to ${cellText(pit.box.max)}; its walls at g-1 ${JSON.stringify(walls.slice(0, 4))}, the grass at g ${walls[4]}, the floor ${walls[5]}`);
            check(walls.slice(0, 4).every((w) => w === 'dirt') && walls[4] === 'grass_block' && walls[5] === 'dirt', 'D0: precondition: the pit is a hollow in the ground (dirt walls, grass above, a dirt floor)', JSON.stringify(walls));
            // the bot idle in a hollow for 70 s: what the area sense says and the help events of the watch since
            const idleIn = async (label, floor, box) => {
                await placeBot(agent, floor, 0);
                const tD = Date.now();
                const sinceD = new Date(tD).toISOString();
                const atD = await entityPos(NAME);
                check(inBox(atD, box) && Math.floor(atD.y + 0.01) === floor.y, `${label}: precondition: the bot stands on the floor of the hollow`, fmt(atD));
                await sleep(70000);
                const saidD = saidLines(s, tD);
                const ev = await sup.call('events', { since: sinceD });
                const helpLines = ev.text.split('\n').filter((l) => HELP_EVENT.test(l));
                const otherHelp = ev.text.split('\n').filter((l) => /\bhelp: /.test(l) && !HELP_EVENT.test(l));
                const senseLines = saidD.filter((l) => SENSE_LINE.test(l));
                note(`${label}: after 70 s in the hollow (the bot at ${fmt(await entityPos(NAME))}, action ${agent.actions.currentActionLabel || 'idle'}) the bot said ${JSON.stringify(saidD.slice(0, 8))}; the watch events since ${sinceD}: ${JSON.stringify(ev.text.split('\n').slice(0, 6))}${otherHelp.length ? `; help events of another source (noted, not the sense): ${JSON.stringify(otherHelp.slice(0, 2))}` : ''}`);
                check(senseLines.length === 0, `${label}: the area sense says no line about the hollow (no "yard", no "that I have not saved", no "Tell me its name"): a hollow in the ground is a pit, no building (8.5)`, JSON.stringify(senseLines.slice(0, 3)));
                check(ev.ok && helpLines.length === 0, `${label}: the watch \`events\` since the bot stood in the hollow holds no help event of the area sense`, JSON.stringify(helpLines.slice(0, 3)));
            };
            await idleIn('D1 (the open pit)', pit.floor, pit.box);
            // the owner's cavity: 5 x 5 x 3 under the grass, a hole of 1 x 1 from the surface
            const cav = cavityPlan(b);
            await commands([`fill ${P(cav.box.min)} ${P(cav.box.max)} minecraft:air`, ...cav.hole.map((c) => `setblock ${P(c)} minecraft:air`),
                `kill @e[type=!minecraft:player,x=${cav.box.min.x - 1},y=${cav.box.min.y - 1},z=${cav.box.min.z - 1},dx=7,dy=7,dz=7]`]);
            const cavWalls = await blockNames([
                { x: cav.box.min.x - 1, y: g - 3, z: cav.floor.z }, { x: cav.box.max.x + 1, y: g - 3, z: cav.floor.z }, { x: cav.floor.x, y: g - 4, z: cav.box.min.z - 1 },
                cav.roof, { ...cav.roof, y: g }, { ...cav.floor, y: g - 5 }, cav.hole[0], cav.hole[1],
            ], ['dirt', 'grass_block', 'stone', 'air']);
            note(`D2: the cavity ${cellText(cav.box.min)} to ${cellText(cav.box.max)} with the hole at ${cellText(cav.hole[0])}: walls ${JSON.stringify(cavWalls.slice(0, 3))}, the roof ${cavWalls[3]} and ${cavWalls[4]}, the floor ${cavWalls[5]}, the hole ${JSON.stringify(cavWalls.slice(6))}`);
            check(cavWalls[3] === 'dirt' && cavWalls[4] === 'grass_block' && cavWalls[5] === 'stone' && cavWalls.slice(6).every((n) => n === 'air') && cavWalls.slice(0, 3).every((n) => n === 'dirt' || n === 'stone'),
                'D2: precondition: the cavity lies under the grass with a roof of the ground, walls of dirt and stone and one hole from the surface', JSON.stringify(cavWalls));
            await idleIn('D2 (the dig cavity)', cav.floor, cav.box);

            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            check(!inLogs, 'the watch token is in no console line of the agent', inLogs ? 'HAS it' : 'no');
            note(`the areas at the end ${JSON.stringify((agent.area_store?.list?.() ?? []).map(areaText))}; the bot said ${JSON.stringify(saidLines(s, t0).filter((l) => !/^\*w_player used/.test(l)).slice(0, 16))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[tag=${TAG}_cat]`, `kill @e[tag=${b.pen.tag}_extra]`]).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
