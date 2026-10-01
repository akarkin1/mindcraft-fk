// The journey scenarios W80 to W84 (tester T3): the owner's first minutes with the bot in the owner variant of the
// base (base_world.js, basePlan(r, { owner: true })), from the player's side. The player is a second bot that types
// the commands the owner's model chose in the play logs of 2026-10-01, and walks the way with the test control.
//
// The rule of these scenarios: the bot under test is NEVER moved by the control. The control builds the world, puts
// the bot and the player at their places at the start, moves the player, gives the bot its kit at the start, and
// reads the world. Whatever the bot cannot do by itself is a failure of the bot.
//
// The memory of the bot is empty at the start: every scenario runs in a fresh working directory with an empty
// bots/ folder (run.js), and a journey saves no place, area or route itself (no saveHomePlace).
import {
    check, note, startAgent, settings0149, resetBot, orderChannel, commands, placeBot, waitFor, entityPos, sleep, tp, fmt,
    setTrapdoor, startTrace, printTrace, readWorldFile, giveItems, recordMoves,
} from './helpers.js';
import { inBox, isOpen, dist, setOpen, chestItems, findBlocks, blockNames } from './world.js';

export const PLAYER = 'w_player';

// The owner's switches of PLAYTEST.md section 2 (v0.1.4.9): the switches he kept (every pack, protected areas, rules,
// world memory), the settings of v0.1.4.8 on (stuck_restart_after 3, knowledge_in_prompt among them), routes_pack,
// mine_routes, skills_over_code on, ore_sense_range 0, and the modes of his profile with the reflexes (MODES_PROFILE).
export const JOURNEY_SETTINGS = () => settings0149({ skills_over_code: true, ore_sense_range: 0, stuck_restart_after: 3 });

// v0.1.4.10 "Goals" (W85 to W90): the owner's switches as above with job_memory on (the owner's switch of the
// release), and what a journey needs on top (`extra`: idle_jobs, area_floors, ...).
export const GOALS_SETTINGS = (extra = {}) => settings0149({ skills_over_code: true, ore_sense_range: 0, stuck_restart_after: 3, job_memory: true, ...extra });

// Starts the agent with an empty memory and the player. botAt and playerAt are cells; kit is a list of [item, count]
// (the owner's chest would hold it). Returns { s, agent, orders }.
export async function startJourney(name, b, { botAt, botYaw = 180, playerAt, kit = [], settings = null } = {}) {
    const s = await startAgent(name, settings ?? JOURNEY_SETTINGS());
    const agent = s.agent;
    await resetBot(name);
    await commands(['gamerule doDaylightCycle false', 'time set 6000']);
    await placeBot(agent, botAt, botYaw);
    if (kit.length) await giveItems(name, kit, agent.bot);
    const orders = await orderChannel(s, { name: PLAYER, at: playerAt });
    const areas = agent.area_store?.list?.() ?? [];
    const keys = agent.memory_bank?.getKeys?.();
    const places = Array.isArray(keys) ? keys : String(keys ?? '').split(/,\s*/).filter(Boolean);
    const routes = readWorldFile(agent, 'routes.json').json;
    const mines = readWorldFile(agent, 'mines.json').json;
    note(`the memory at the start: areas ${JSON.stringify(areas.map((a) => a.name))}, places ${JSON.stringify(places)}, routes.json ${routes ? 'present' : 'missing'}, mines.json ${mines ? 'present' : 'missing'}`);
    check(areas.length === 0 && places.length === 0 && !routes && !mines, 'precondition: the memory of the bot is empty (no area, no place, no route, no mine)',
        `areas ${areas.length}, places ${JSON.stringify(places)}, routes ${routes ? 'present' : 'none'}, mines ${mines ? 'present' : 'none'}`);
    return { s, agent, orders };
}

// A trace of the bot, the player, the trapdoor and the action, every 400 ms, for the report of a failure.
export function journeyTrace(agent, b) {
    return startTrace(async () => ({
        bot: await entityPos(agent.name), player: await entityPos(PLAYER), trap: await isOpen(b.trapdoor, 'oak_trapdoor'),
        action: agent.actions.currentActionLabel || '-',
    }), 400);
}

export function printJourney(title, rows) {
    printTrace(title, rows, { bot: (x) => fmt(x.bot), player: (x) => fmt(x.player), trapdoor: (x) => (x.trap ? 'open' : 'closed'), action: (x) => x.action }, 160);
}

// ------------------------------------------------------------------ the player walks

// Moves the player cell by cell (the test control: the player only).
export async function walkPlayer(cells, ms = 300) {
    for (const c of cells) {
        await tp(PLAYER, c);
        await sleep(ms);
    }
    return entityPos(PLAYER);
}

// The cells of a straight walk from a to b at the height of a (x first, then z), without a.
export function line(a, b) {
    const out = [];
    let x = a.x, z = a.z;
    while (x !== b.x) { x += Math.sign(b.x - x); out.push({ x, y: a.y, z }); }
    while (z !== b.z) { z += Math.sign(b.z - z); out.push({ x, y: a.y, z }); }
    return out;
}

const col = (x, z, from, to) => {
    const out = [];
    const step = to >= from ? 1 : -1;
    for (let y = from; step > 0 ? y <= to : y >= to; y += step) out.push({ x, y, z });
    return out;
};

// The places of the owner variant that the journeys use.
export function spots(b) {
    const g = b.g;
    const o = b.owner;
    const s1 = b.shaft.column;
    const s2 = o.shaft2.column;
    return {
        besideTrapdoor: { x: s1.x, y: g + 1, z: s1.z + 1 }, // in the house, south of the trapdoor
        houseMiddle: { ...b.house.home },
        outside: { x: b.house.door.x, y: g + 1, z: b.house.door.z - 6 }, // 6 blocks north of the door, open sky
        basementFoot: { x: s1.x, y: o.basement.box.min.y, z: s1.z + 1 }, // the basement cell south of the foot of ladder 1
        basementWait: { ...o.basement.middle }, // more than 3 blocks from the foot of ladder 1
        aboveHole: { x: s2.x, y: o.basement.box.min.y, z: s2.z }, // the basement cell over the hole of ladder 2
        roomUnder: o.shaft2.gap[0], // the floor of the room under the last ladder
        roomWait: { x: b.room.middle.x - 1, y: b.room.box.min.y, z: b.room.middle.z - 1 },
        stepOne: b.steps[0].feet,
        tunnelEnd: b.tunnel.end,
    };
}

// The player opens the house door (both halves) and walks out to the open sky, `out` blocks north of the door.
export async function playerOutOfHouse(b, from) {
    const sp = spots(b);
    const inside = { x: b.house.door.x, y: b.g + 1, z: b.house.door.z + 1 };
    await walkPlayer(line(from, inside));
    await setOpen(b.house.door, true);
    await sleep(300);
    return walkPlayer([b.house.door, ...line(b.house.door, sp.outside)]);
}

// From outside through the open door to beside the trapdoor (the door stays as it is).
export async function playerIntoHouse(b, from) {
    const sp = spots(b);
    if (!(await isOpen(b.house.door))) await setOpen(b.house.door, true);
    const inside = { x: b.house.door.x, y: b.g + 1, z: b.house.door.z + 1 };
    await walkPlayer([...line(from, b.house.door), inside]);
    return walkPlayer(line(inside, sp.besideTrapdoor));
}

// From beside the trapdoor: opens it, climbs down ladder 1 and walks into the basement to basementWait. The trapdoor
// is left open behind him (the owner's way: the bot passes after him; its door service closes what it passed).
export async function playerDownToBasement(b, { to = null } = {}) {
    const sp = spots(b);
    const s1 = b.shaft.column;
    await setTrapdoor(b, true);
    await sleep(300);
    await walkPlayer([{ x: s1.x, y: b.g, z: s1.z }, ...col(s1.x, s1.z, b.g - 1, b.owner.basement.box.min.y)], 250);
    await walkPlayer([sp.basementFoot]);
    return walkPlayer(line(sp.basementFoot, to ?? sp.basementWait));
}

// From the basement up ladder 1 into the house beside the trapdoor (opening it when it is closed; it stays open).
export async function playerUpToHouse(b, from) {
    const sp = spots(b);
    const s1 = b.shaft.column;
    await walkPlayer(line(from, sp.basementFoot));
    await walkPlayer(col(s1.x, s1.z, b.owner.basement.box.min.y, b.g - 1), 250);
    if (!(await isOpen(b.trapdoor, 'oak_trapdoor'))) await setTrapdoor(b, true);
    await sleep(300);
    return walkPlayer([{ x: s1.x, y: b.g, z: s1.z }, sp.besideTrapdoor], 400);
}

// From the basement down ladder 2 (it ends 2 blocks above the floor: the player drops) into the room to roomWait.
export async function playerDownToRoom(b, from) {
    const sp = spots(b);
    const s2 = b.owner.shaft2.column;
    await walkPlayer(line(from, sp.aboveHole));
    await walkPlayer(col(s2.x, s2.z, b.owner.basement.box.min.y - 1, b.owner.shaft2.bottom), 250);
    await walkPlayer([b.owner.shaft2.gap[1], sp.roomUnder], 400);
    return walkPlayer(line(sp.roomUnder, sp.roomWait));
}

// The double door of the room: opened or closed by the player (both doors, as the owner opens both).
export async function setDoubleDoor(b, open) {
    const cmds = [];
    for (const d of b.owner.doors) {
        cmds.push(`setblock ${d.lower.x} ${d.lower.y} ${d.lower.z} minecraft:oak_door[facing=west,half=lower,hinge=${d.hinge},open=${open}]`);
        cmds.push(`setblock ${d.upper.x} ${d.upper.y} ${d.upper.z} minecraft:oak_door[facing=west,half=upper,hinge=${d.hinge},open=${open}]`);
    }
    return commands(cmds);
}

export async function doubleDoorState(b) {
    return Promise.all(b.owner.doors.map((d) => isOpen(d.lower)));
}

// From the room through the double door (opened by the player, left open), down the descent and the landing into
// the tunnel, to its end.
export async function playerToTunnelEnd(b, from) {
    const sp = spots(b);
    const door = b.owner.doors[1].lower; // the south door, in the line of the descent
    await setDoubleDoor(b, true);
    await sleep(300);
    await walkPlayer(line(from, { x: door.x - 1, y: door.y, z: door.z }));
    await walkPlayer([door, ...b.steps.map((s) => s.feet)], 350);
    const landing = { x: b.tunnel.start.x, y: b.landing.middle.y, z: b.steps[b.steps.length - 1].feet.z };
    await walkPlayer(line(b.steps[b.steps.length - 1].feet, landing), 350);
    return walkPlayer(line(landing, sp.tunnelEnd), 350);
}

// ------------------------------------------------------------------ waiting for the bot

// Waits until pred(botPos, playerPos) holds; notes how long it took. Resolves with { ok, ms, bot }.
export async function waitBot(agent, label, pred, ms) {
    const t0 = Date.now();
    const got = await waitFor(async () => {
        const [a, p] = [await entityPos(agent.name), await entityPos(PLAYER)];
        return a && pred(a, p) ? a : null;
    }, { ms, every: 400 });
    const bot = got.value ?? await entityPos(agent.name);
    note(`${label}: ${got.ok ? `yes after ${((Date.now() - t0) / 1000).toFixed(1)} s` : `NO within ${ms / 1000} s`}; the bot at ${fmt(bot)}, the player at ${fmt(await entityPos(PLAYER))}`);
    return { ok: got.ok, ms: Date.now() - t0, bot };
}

export const near = (n) => (a, p) => dist(a, p) <= n;
export const inside = (box) => (a) => inBox(a, box);

// In the basement: its box, or the foot cell of ladder 1 with the feet on the floor of the basement (the column opens
// into it; the place "basement" of a route may lie there). A bot hanging on the ladder above the floor is not in it.
export function inBasement(b, a) {
    const s1 = b.shaft.column;
    const bm = b.owner.basement.box;
    if (!a) return false;
    const onFloor = a.y >= bm.min.y - 0.01 && a.y < bm.min.y + 0.5;
    return (inBox(a, bm) && onFloor) || (Math.floor(a.x) === s1.x && Math.floor(a.z) === s1.z && onFloor);
}

// Finds when the bot passed the trapdoor in a trace (its feet below the trapdoor, in the column) and whether the
// trapdoor was closed within `ms` after that. Resolves with { passedAt, closedAt, ok } (times in s of the trace).
export function trapdoorAfterPass(rows, b, ms = 10000, from = 0) {
    const s1 = b.shaft.column;
    const i = rows.findIndex((x, k) => k >= from && x.bot && Math.floor(x.bot.x) === s1.x && Math.floor(x.bot.z) === s1.z && x.bot.y < b.trapdoor.y - 0.5);
    if (i < 0) return { passedAt: null, closedAt: null, ok: false };
    // the bot is through when its feet are 2 blocks under the trapdoor or it left the column below
    const j = rows.findIndex((x, k) => k >= i && x.bot && (x.bot.y < b.trapdoor.y - 2 || !(Math.floor(x.bot.x) === s1.x && Math.floor(x.bot.z) === s1.z)));
    const through = j >= 0 ? j : i;
    const c = rows.findIndex((x, k) => k >= through && x.trap === false);
    const passedAt = rows[through].t;
    const closedAt = c >= 0 ? rows[c].t : null;
    return { passedAt, closedAt, ok: closedAt !== null && closedAt - passedAt <= ms / 1000 };
}

// ------------------------------------------------------------------ the parts of the owner's first minutes

// What the bot said (its chat and the behaviour log) since t, for the report.
export function saidLines(s, t = 0) {
    return [...s.chats.filter((x) => x.t >= t).map((x) => x.text), ...s.behavior.filter((x) => x.t >= t).map((x) => `[behaviour] ${x.text}`)];
}

// Part A, "this is home" and the basement (W80). The bot and the player stand in the house, the trapdoor is closed.
//   A0 the player types !rememberArea("home", "home") (the owner: "you're exactly at home, buddy. Inside the house")
//   A1 !followPlayer("w_player", 3) (the owner: "follow me, down the basement"); the player opens the trapdoor, climbs
//      down and waits in the basement more than 3 blocks from the ladder: within 60 s the bot is in the basement;
//   A2 the trapdoor is closed within 10 s after the bot passed it;
//   A3 !rememberRoute("basement") (the owner: "Remember the path here from the house") names 1 ladder and 1 trapdoor;
//   A4 the player climbs back into the house and types !goToPlayer("w_player", 3) ("come here"): within 60 s the bot
//      is in the house;
//   A5 !goToRememberedPlace("basement") ("now, go to the basement"): within 60 s the bot is in the basement.
// Resolves with { ok } (every check of the part passed).
export async function partFirstMinutes(ctx) {
    const { s, agent, orders, b } = ctx;
    const sp = spots(b);
    const g = b.g;
    const results = [];
    const ok = (cond, label, detail) => { results.push(Boolean(cond)); check(cond, label, detail); return cond; };
    const tPart = Date.now();
    const trace = journeyTrace(agent, b);
    const climbs = climbSampler(agent);
    const c0 = Date.now();
    // the climbs of the bot between two moments of this part (the owner: "the climbing looked jerky")
    const climbStep = (label, from, to, expect = 1) => {
        note(`${label}: the order was given at t=${((from - c0) / 1000).toFixed(1)}s of the samples`);
        const list = checkClimbs(label, climbs.rows, b, { expect, window: { from: (from - c0) / 1000, to: (to - c0) / 1000 } });
        results.push(list.length >= expect && list.every(smooth));
    };
    try {
        const home = await orders.order('!rememberArea("home", "home")', 60000);
        note(`A0: !rememberArea("home", "home") answered ${JSON.stringify(home)}`);
        const area = agent.area_store?.list?.().find((a) => a.name === 'home');
        note(`A0: the area "home": ${JSON.stringify(area ? { min: area.min, max: area.max } : null)}; the basement is y ${b.owner.basement.box.min.y} to ${b.owner.basement.box.max.y}`);

        const tFollow = Date.now();
        const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 3)`, 5000);
        note(`A1: !followPlayer answered ${JSON.stringify(follow.reply)}`);
        await sleep(2000);
        await playerDownToBasement(b);
        const down = await waitBot(agent, 'A1: the bot is in the basement', (a) => inBasement(b, a), Math.max(1000, 60000 - (Date.now() - tFollow)));
        ok(down.ok, 'A1: within 60 s of "follow me" the bot followed the player down the ladder into the basement, without help', fmt(down.bot));
        await sleep(11000); // the door service has 10 s after the pass
        climbStep('A1 climb (follow down ladder 1)', tFollow, Date.now());
        const pass = trapdoorAfterPass(trace.rows, b);
        note(`A2: the bot passed the trapdoor at t=${pass.passedAt}s of the trace, the trapdoor was closed at t=${pass.closedAt}s; it is ${(await isOpen(b.trapdoor, 'oak_trapdoor')) ? 'open' : 'closed'} now`);
        ok(pass.ok, 'A2: the trapdoor is closed within 10 s after the bot passed it (the player is in the basement)', JSON.stringify(pass));

        const said = await orders.order('!rememberRoute("basement")', 20000);
        note(`A3: !rememberRoute("basement") answered ${JSON.stringify(said)}`);
        ok(/\b1 ladder\b/.test(said) && /\b1 trapdoor\b/.test(said), 'A3: !rememberRoute("basement") remembers a way with 1 ladder and 1 trapdoor', JSON.stringify(said));
        note(`A3: routes.json: ${JSON.stringify(readWorldFile(agent, 'routes.json').json)}`);

        await playerUpToHouse(b, sp.basementWait);
        await walkPlayer(line(sp.besideTrapdoor, { x: sp.houseMiddle.x, y: g + 1, z: sp.besideTrapdoor.z }));
        const tUp = Date.now();
        const go = orders.orderInfo(`!goToPlayer("${PLAYER}", 3)`, 60000);
        const up = await waitBot(agent, 'A4: the bot is in the house', inside(b.house.interior), 60000);
        const goInfo = await go;
        note(`A4: !goToPlayer answered ${JSON.stringify(goInfo.reply.slice(0, 300))}`);
        ok(up.ok, 'A4: after "come here" from the house the bot climbed up into the house by itself within 60 s', fmt(up.bot));

        await sleep(2000);
        climbStep('A4 climb (come here, up ladder 1)', tUp, Date.now());
        const tB = Date.now();
        const goB = orders.orderInfo('!goToRememberedPlace("basement")', 90000);
        const there = await waitBot(agent, 'A5: the bot is in the basement', (a) => inBasement(b, a), 60000);
        const bInfo = await goB;
        await sleep(1000);
        const after = await entityPos(agent.name);
        note(`A5: !goToRememberedPlace("basement") answered ${JSON.stringify(bInfo.reply.slice(0, 300))}; after the answer the bot is at ${fmt(after)}`);
        ok(there.ok && inBasement(b, after), 'A5: "go to the basement" from the house brings the bot into the basement within 60 s (on its floor, also after the answer)', `${fmt(there.bot)}, after the answer ${fmt(after)}`);
        climbStep('A5 climb (route down ladder 1)', tB, Date.now());
    } finally {
        await climbs.stop();
        const rows = await trace.stop();
        printJourney('part A: home and the basement', rows);
        note(`part A: the bot said ${JSON.stringify(saidLines(s, tPart).slice(0, 30))}`);
    }
    return { ok: results.every(Boolean) };
}

// Part B, the first mine (W81). from 'outside': the bot and the player stand outside in front of the house door.
// from 'basement': both are in the basement (after part A); the player first leads the bot up and out under the open
// sky (PLAYTEST step 1: the walk into the mine starts outside).
//   B1 !followPlayer("w_player", 4) (the owner: "follow me, I'll show you the mine"); the player walks into the house,
//      down ladder 1, through the basement, down ladder 2 (which ends 2 blocks above the floor of the room), through the
//      double door, down the descent to the end of the tunnel, waiting for the bot after every ladder: the bot follows
//      (60 s per leg);
//   B2 !rememberMine("mine") ("this is the mine") names 2 ladders and the room;
//   B3 12 iron ore in a line ahead of the end of the tunnel; !mineOre("iron", 12) ("find some iron"): within 5 minutes
//      the bot has 12 raw_iron, is back on the surface (feet at y g+1 or higher, outside the mine box), the trapdoor it
//      passed is closed; it still carries torches and put none into the chest of the room; the tunnel grew by 8 blocks
//      or more and a torch stands in its new part.
export async function partFirstMine(ctx, { from = 'outside' } = {}) {
    const { s, agent, orders, b } = ctx;
    const sp = spots(b);
    const g = b.g;
    const results = [];
    const ok = (cond, label, detail) => { results.push(Boolean(cond)); check(cond, label, detail); return cond; };
    const tPart = Date.now();
    const trace = journeyTrace(agent, b);
    const outsideBox = { min: { x: b.house.box.min.x - 6, y: g + 1, z: b.house.box.min.z - 12 }, max: { x: b.house.box.max.x + 6, y: g + 3, z: b.house.box.min.z - 1 } };
    let aborted = false;
    const leg = async (label, pred, ms = 60000) => {
        if (aborted) return false;
        const w = await waitBot(agent, label, pred, ms);
        ok(w.ok, `${label} within ${ms / 1000} s, by itself`, fmt(w.bot));
        if (!w.ok) aborted = true;
        return w.ok;
    };
    try {
        const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 4)`, 5000);
        note(`B1: !followPlayer answered ${JSON.stringify(follow.reply)}`);
        await sleep(2000);
        if (from === 'basement') {
            await playerUpToHouse(b, sp.basementWait);
            await leg('B1: the bot followed up ladder 1 into the house', inside(b.house.interior));
            if (!aborted) await playerOutOfHouse(b, sp.besideTrapdoor);
            await leg('B1: the bot followed out of the house under the open sky', inside(outsideBox));
            await sleep(3000);
        }
        if (!aborted) {
            // the owner walks on to the trapdoor and down without waiting in the house (PLAYTEST step 2: he waits at
            // the foot of the ladder); where the bot stands meanwhile is noted
            await playerIntoHouse(b, sp.outside);
            await sleep(2000);
            const p = await entityPos(agent.name);
            note(`B1: with the player beside the trapdoor the bot is ${inBox(p, b.house.interior) ? 'in the house' : 'NOT in the house'} at ${fmt(p)}, ${dist(p, await entityPos(PLAYER)).toFixed(1)} blocks from the player`);
            await playerDownToBasement(b);
        }
        await leg('B1: the bot followed down ladder 1 into the basement', (a) => inBasement(b, a));
        if (!aborted) await playerDownToRoom(b, sp.basementWait);
        await leg('B1: the bot followed down ladder 2 (ending 2 blocks above the floor) into the room', inside(b.room.box));
        if (!aborted) await playerToTunnelEnd(b, sp.roomWait);
        await leg('B1: the bot followed through the double door and down the descent into the tunnel (within 5 blocks of the player)', (a, p) => dist(a, p) <= 5 && a.y < LANDING_TOP, 90000);
        if (aborted) {
            note('B: the bot did not follow the player into the mine; the rest of the part is not run');
            return { ok: false };
        }
        await sleep(1500);
        const said = await orders.order('!rememberMine("mine")', 30000);
        note(`B2: !rememberMine("mine") answered ${JSON.stringify(said)}`);
        ok(/\b2 ladders\b/.test(said) && /\bthe room\b/.test(said), 'B2: !rememberMine("mine") names 2 ladders and the room', JSON.stringify(said));
        note(`B2: mines.json: ${JSON.stringify(readWorldFile(agent, 'mines.json').json?.mines?.mine?.route ?? null)}`);

        const t = b.tunnel;
        // 12 iron ore ahead of the end, at the feet and the head every 2 blocks: the dig is 12 blocks long, so a torch is due
        const ores = [2, 4, 6, 8, 10, 12].flatMap((k) => [0, 1].map((dy) => ({ x: t.end.x, y: t.end.y + dy, z: t.end.z + k })));
        const lengthBefore = readWorldFile(agent, 'mines.json').json?.mines?.mine?.tunnels?.[0]?.length ?? t.cells.length;
        const roomBefore = await chestItemsSafe(b.room.chest);
        await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
        const before = countItem(agent, 'raw_iron');
        const laddersBefore = countItem(agent, 'ladder');
        const moves = recordMoves(agent);
        const places = recordPlacing(agent);
        const t0 = Date.now();
        const info = await orders.orderInfo('!mineOre("iron", 12)', 300000);
        const secs = (Date.now() - t0) / 1000;
        moves.stop();
        places.stop();
        const gap = await blockNames(b.owner.shaft2.gap, ['air', 'ladder', 'cobblestone', 'dirt', 'stone']);
        note(`B3: ladders in the bag ${laddersBefore} before, ${countItem(agent, 'ladder')} after; the 2 cells under ladder 2 are ${JSON.stringify(gap)} now; placed blocks ${JSON.stringify(places.lines)}; clicks ${JSON.stringify(moves.lines.filter((l) => /activateBlock/.test(l)).slice(0, 12))}`);
        note(`B3: !mineOre("iron", 12) answered after ${secs.toFixed(1)} s: ${JSON.stringify(info.reply)}`);
        const end = await entityPos(agent.name);
        const iron = countItem(agent, 'raw_iron') - before;
        const room = await chestItemsSafe(b.room.chest);
        note(`B3: the bot carries ${iron} raw_iron more than before the order; the chest of the room holds ${JSON.stringify(room)}; the bot is at ${fmt(end)}`);
        ok(info.done, 'B3: !mineOre("iron", 12) ended within 5 minutes', info.reply);
        ok(iron >= 12, 'B3: the bot has 12 raw_iron (in its inventory) at the end', `${iron} raw_iron; the chest of the room ${room?.raw_iron || 0}`);
        ok(Boolean(end) && end.y >= g + 1 - 0.01 && !inBox(end, b.mineBox) && !inBasement(b, end), `B3: the bot is back on the surface (feet at y ${g + 1} or higher, not in the mine or the basement)`, fmt(end));
        const trap = await isOpen(b.trapdoor, 'oak_trapdoor');
        ok(trap === false, 'B3: the trapdoor the bot passed is closed at the end', String(trap));
        note(`B3: the double door is ${JSON.stringify(await doubleDoorState(b))} (open per door) at the end`);
        // the torches: the bot keeps them for the trip (none put into the chest of the room), and a dig of 8 blocks or
        // more has a torch in its new part (one torch every 8 blocks)
        const torchesLeft = countItem(agent, 'torch');
        const roomTorches = (room?.torch || 0) - (roomBefore?.torch || 0);
        note(`B3: the bot carries ${torchesLeft} torches after the trip; the chest of the room held ${roomBefore?.torch || 0} torches before and ${room?.torch || 0} after`);
        ok(torchesLeft > 0 && roomTorches <= 0, 'B3: the bot still carries torches after the trip and put none into the chest of the room', `carries ${torchesLeft}, the room chest ${roomTorches >= 0 ? '+' : ''}${roomTorches}`);
        const lengthAfter = readWorldFile(agent, 'mines.json').json?.mines?.mine?.tunnels?.[0]?.length ?? null;
        const grew = lengthAfter === null ? null : lengthAfter - lengthBefore;
        const dug = { min: { x: t.end.x - 1, y: t.end.y - 1, z: t.end.z + 1 }, max: { x: t.end.x + 1, y: t.end.y + 2, z: t.end.z + 16 } };
        const torches = await findBlocksSafe(dug, ['torch', 'wall_torch']);
        note(`B3: the tunnel was ${lengthBefore} blocks long and is ${lengthAfter} now (grew by ${grew}); torches in the new part: ${JSON.stringify(torches.map((x) => x.pos))}`);
        ok(grew !== null && grew >= 8, 'B3: the dig is 8 blocks or longer (12 iron ore in a line ahead of the end)', `grew by ${grew}`);
        if (grew !== null && grew >= 8) ok(torches.length > 0, 'B3: the tunnel grew by 8 blocks or more: a torch stands in its new part', `${torches.length} torches, grew by ${grew}`);
    } finally {
        const rows = await trace.stop();
        printJourney('part B: the first mine', rows);
        note(`part B: the bot said ${JSON.stringify(saidLines(s, tPart).slice(0, 40))}`);
    }
    return { ok: !aborted && results.every(Boolean) };
}

const LANDING_TOP = 28; // feet below this: the landing or the tunnel of the base (y 25)

export function countItem(agent, name) {
    return agent.bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0);
}

// Records every placeBlock of the bot (the block it places against, the face, what it holds, where it stands), for the
// report; nothing is changed: the wrapper calls the original. Returns { lines, stop() }.
export function recordPlacing(agent) {
    const bot = agent.bot;
    const lines = [];
    const orig = bot.placeBlock;
    bot.placeBlock = function recordedPlace(ref, face, ...rest) {
        const p = bot.entity?.position;
        lines.push(`${bot.heldItem?.name ?? 'nothing'} against ${ref?.name} (${ref?.position?.x}, ${ref?.position?.y}, ${ref?.position?.z}) face (${face?.x}, ${face?.y}, ${face?.z}) from ${p ? fmt(p) : '?'}`);
        return orig.call(this, ref, face, ...rest);
    };
    return { lines, stop() { bot.placeBlock = orig; return lines; } };
}

const chestItemsSafe = (p) => chestItems(p).catch(() => null);
const findBlocksSafe = (box, names) => findBlocks(box, names).catch(() => []);

// ------------------------------------------------------------------ the smoothness of a climb (the owner: "jerky")

// Samples the bot's own position every 100 ms (the position its client sends to the server) until stop().
export function climbSampler(agent) {
    return startTrace(async () => {
        const p = agent.bot?.entity?.position;
        return p ? { x: p.x, y: p.y, z: p.z } : {};
    }, 100);
}

// The ladder columns of the owner variant with the heights between which the bot is on the way: shaft 1 between the
// basement floor and the house floor, shaft 2 between the room floor and the basement floor.
function ladderColumns(b) {
    return [
        { name: 'ladder 1', x: b.shaft.column.x, z: b.shaft.column.z, low: b.owner.basement.box.min.y, high: b.g + 1 },
        { name: 'ladder 2', x: b.owner.shaft2.column.x, z: b.owner.shaft2.column.z, low: b.room.box.min.y, high: b.owner.basement.box.min.y },
    ];
}

// Splits the samples into climbs: runs of samples in a ladder column strictly between its two floors, covering 2 blocks
// or more. For each: direction, blocks, seconds, seconds per block, stalls (runs of more than 1 s without a height
// change of 0.02), reversals (steps against the direction of more than 0.2 block; a hop of 0.15 at the step into a column is no flinch) and the largest of them.
export function climbsOf(rows, b) {
    const out = [];
    for (const c of ladderColumns(b)) {
        const inCol = (r) => typeof r.y === 'number' && Math.abs(r.x - (c.x + 0.5)) < 0.8 && Math.abs(r.z - (c.z + 0.5)) < 0.8 && r.y > c.low + 0.05 && r.y < c.high - 0.05;
        let run = [];
        const flush = () => {
            if (run.length >= 2) {
                const first = run[0], last = run[run.length - 1];
                const lo = Math.min(...run.map((r) => r.y)), hi = Math.max(...run.map((r) => r.y));
                if (hi - lo >= 2) {
                    const dir = last.y >= first.y ? 'up' : 'down';
                    const sign = dir === 'up' ? 1 : -1;
                    let reversals = 0, worst = 0, stalls = 0, longest = 0;
                    const where = [];
                    for (let i = 1; i < run.length; i++) {
                        const back = -sign * (run[i].y - run[i - 1].y);
                        // the start of a climb is the step into the column: a hop of up to 0.25 at the top rung when
                        // the bot drops in from the floor (1.5 s on the way down), no flinch
                        if (back > 0.2 && run[i].t - run[0].t > (dir === 'down' ? 1.5 : 0.5)) { reversals++; worst = Math.max(worst, back); where.push(`t=${run[i].t.toFixed(1)}s y ${run[i - 1].y.toFixed(2)}->${run[i].y.toFixed(2)}`); }
                    }
                    let s = 0;
                    for (let i = 1; i <= run.length; i++) {
                        if (i === run.length || Math.abs(run[i].y - run[s].y) >= 0.02) {
                            const d = run[i - 1].t - run[s].t;
                            if (d > 1.0) stalls++;
                            longest = Math.max(longest, d);
                            s = i;
                        }
                    }
                    const blocks = Math.abs(last.y - first.y);
                    const seconds = last.t - first.t;
                    out.push({
                        column: c.name, dir, from: first.y, to: last.y, at: first.t, blocks, seconds, perBlock: blocks > 0 ? seconds / blocks : Infinity,
                        stalls, longestStall: longest, reversals, worstReversal: worst, where,
                    });
                }
            }
            run = [];
        };
        for (const r of rows) {
            if (inCol(r)) run.push(r);
            else flush();
        }
        flush();
    }
    return out.sort((a, b2) => a.at - b2.at);
}

export const smooth = (c) => c.reversals === 0 && c.stalls <= 1 && c.perBlock < 0.8;

export function climbText(c) {
    return `${c.column} ${c.dir} from y ${c.from.toFixed(1)} to ${c.to.toFixed(1)}: ${c.blocks.toFixed(1)} blocks in ${c.seconds.toFixed(1)} s, ${c.perBlock.toFixed(2)} s per block, ` +
        `${c.stalls} stall(s) over 1 s (longest ${c.longestStall.toFixed(1)} s), ${c.reversals} reversal(s) over 0.2 (largest ${c.worstReversal.toFixed(2)})` +
        (c.where.length ? ` at ${c.where.join(', ')} (climb from t=${c.at.toFixed(1)}s)` : '');
}

// The checks of the owner's "jerky climb" for every climb of the bot in the samples: no reversal of more than 0.1 block,
// at most one stall of more than 1 s, under 0.8 s per block. `label` names the step. Resolves with the climbs.
// window { from, to } (seconds of the samples): only the climbs that overlap it, each measured whole (a climb begun
// under one order and finished under the next is one climb).
export function checkClimbs(label, rows, b, { expect = 1, window = null } = {}) {
    const climbs = climbsOf(rows, b).filter((c) => !window || (c.at <= window.to && c.at + c.seconds >= window.from));
    note(`${label}: ${climbs.length} climb(s) of the bot: ${climbs.length ? climbs.map(climbText).join(' | ') : 'none'}`);
    check(climbs.length >= expect, `${label}: the samples hold the bot's climb(s) on the ladder (${expect} or more)`, `${climbs.length}`);
    for (const c of climbs) {
        check(smooth(c),
            `${label}: the climb is smooth (${c.column} ${c.dir}): no step against the direction of more than 0.2 block, at most one stall over 1 s, under 0.8 s per block`, climbText(c));
    }
    return climbs;
}

// ------------------------------------------------------------------ v0.1.4.10 "Goals" (W85 to W90)

// The lines of the ladder step of v0.1.4.9 (the fallback since v0.1.4.10) that the agent printed on its console:
// "I go down the ladder at ..." and "I climb up the ladder at ..." (the ladder step logs each pass once; the lines of
// the test itself, NOTE, CHECK, TRACE, MODEL, are left out). In the order printed.
export const LADDER_FALLBACK = /^(I go down the ladder at|I climb up the ladder at)/;
const TEST_LINE = /^(NOTE|CHECK|TRACE|MODEL|PLAN|order) /;
export function ladderFallbackLines(s) {
    return (s.logs ?? []).filter((entry) => !TEST_LINE.test(entry))
        .flatMap((entry) => String(entry).split('\n').map((l) => l.trim()))
        .filter((l) => LADDER_FALLBACK.test(l));
}

// The player teaches the bot the mine (the owner's way of W81): the bot and the player stand outside in front of the
// house door, under the open sky (a mine of the player starts there: "I have not been under open sky since I
// started" from the house, first run of W85). !followPlayer("w_player", 4); the player walks into the house, down
// ladder 1, down ladder 2, through the double door to the end of the tunnel, waiting for the bot after every ladder
// (60 s each, 90 s for the last); then !rememberMine("mine"). Resolves with { ok, said } (ok: the bot followed every
// leg and the answer names 2 ladders).
export async function partTeachMine(ctx) {
    const { agent, orders, b } = ctx;
    const sp = spots(b);
    const trace = journeyTrace(agent, b);
    let ok = true;
    const leg = async (label, pred, ms = 60000) => {
        if (!ok) return false;
        const w = await waitBot(agent, label, pred, ms);
        check(w.ok, `${label} within ${ms / 1000} s, by itself`, fmt(w.bot));
        ok = w.ok;
        return w.ok;
    };
    let said = '';
    try {
        const follow = await orders.orderInfo(`!followPlayer("${PLAYER}", 4)`, 5000);
        note(`teach: !followPlayer answered ${JSON.stringify(follow.reply)}`);
        await sleep(2000);
        await playerIntoHouse(b, sp.outside);
        await sleep(2000);
        await playerDownToBasement(b);
        await leg('teach: the bot followed down ladder 1 into the basement', (a) => inBasement(b, a));
        if (ok) await playerDownToRoom(b, sp.basementWait);
        await leg('teach: the bot followed down ladder 2 into the room', inside(b.room.box));
        if (ok) await playerToTunnelEnd(b, sp.roomWait);
        await leg('teach: the bot followed through the double door into the tunnel (within 5 blocks of the player)', (a, p) => dist(a, p) <= 5 && a.y < LANDING_TOP, 90000);
        if (!ok) return { ok, said };
        await sleep(1500);
        said = await orders.order('!rememberMine("mine")', 30000);
        note(`teach: !rememberMine("mine") answered ${JSON.stringify(said)}`);
        ok = /\b2 ladders\b/.test(said);
        check(ok, 'teach: !rememberMine("mine") remembers the mine with 2 ladders', JSON.stringify(said));
    } finally {
        printJourney('the player teaches the mine', await trace.stop());
    }
    return { ok, said };
}

// Iron ore beyond the end of the tunnel of the base, in its line (2 high): `pairs` cells at 2, 4, 6, ... blocks
// after the end, or at the distances of `at`. Resolves with the positions.
export async function oreBeyondTunnel(b, pairs, { at = null } = {}) {
    const t = b.tunnel;
    const ores = [];
    const offsets = at ?? Array.from({ length: pairs }, (_, i) => 2 + 2 * i);
    for (const k of offsets) for (const dy of [0, 1]) ores.push({ x: t.end.x, y: t.end.y + dy, z: t.end.z + k });
    await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
    return ores;
}

// The way out of the mine for the player: the cells of the tunnel back to its start, the landing, the steps of the
// descent up to the double door. From the tunnel cell nearest to `from`.
export function wayOutOfMine(b, from) {
    const cells = [...b.tunnel.cells].reverse();
    const last = b.steps[b.steps.length - 1].feet;
    const landing = { x: b.tunnel.start.x, y: b.landing.middle.y, z: last.z };
    const way = [...cells, ...line(cells[cells.length - 1], landing), ...line(landing, last).slice(0, -1), ...[...b.steps].reverse().map((s) => s.feet)];
    let k = 0;
    if (from) {
        let best = Infinity;
        way.forEach((c, i) => { const d = dist({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, from); if (d < best) { best = d; k = i; } });
    }
    return way.slice(k);
}

// The surface: feet at y g+1 or higher, outside the mine box and the basement.
export function onSurface(b, a) {
    return Boolean(a) && a.y >= b.g + 1 - 0.01 && !inBox(a, b.mineBox) && !inBasement(b, a);
}

// Samples the action of the agent every `every` ms: resolves stop() with the runs of the same label
// [{ label, from, to }] (times in ms since the epoch).
export function actionRuns(agent, every = 500) {
    const runs = [];
    let cur = null;
    const tick = () => {
        const label = agent.actions?.currentActionLabel || '-';
        const t = Date.now();
        if (cur && cur.label === label) cur.to = t;
        else { cur = { label, from: t, to: t }; runs.push(cur); }
    };
    tick();
    const id = setInterval(tick, every);
    return { runs, stop() { clearInterval(id); tick(); return runs; } };
}
