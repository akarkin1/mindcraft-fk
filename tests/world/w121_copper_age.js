// W121 the Copper Age (journey of v0.1.4.14 "Minecraft 26.1", tester T3; SPEC 4.5, the goals of SPEC section 1 for the
// copper pickaxe, the copper chest, the food choice, part K and the two library defects of SPEC 4.8). The bot on a 26.1
// server meets the things of 1.21.9 to 26.1 that its data must know: a copper pickaxe is a stone-tier pickaxe with 190
// uses, a copper chest is a chest, a fish bucket is no food, the model is told what is new, a hit knocks the bot back and
// iron ore takes the time of the game to dig.
//
// The rule "fails on the old code" of the process does not apply to this scenario: v0.1.4.13 (mineflayer 4.33.0,
// minecraft-data 3.98.0) cannot connect to a 26.1 server at all, so it fails before the kit (and a 1.21.8 server has no
// copper_pickaxe and no copper_chest to give). The checks below prove the behaviour on 26.1 only.
//
// The owner variant of the base with the room tunnel of base_world.js, the owner's switches of v0.1.4.12 and v0.1.4.13
// (SUPERVISION_SETTINGS) with watch_server (for `look`) and new_things_in_prompt on, the modes of his profile, an empty
// memory. The kit: a copper_pickaxe worn to 12 uses (damage 178 of 190), 16 torches, 8 ladders, 4 bread, 8 cobblestone,
// 2 sticks, no other pickaxe. The bot is never moved by the control. The console commands use the 26.1 names.
//   A. The copper pickaxe. The player teaches the mine in the room with its tunnel (journey.js partTeachMineInRoom);
//      6 iron ore beyond the rock face, feet and head at 2, 4 and 6 blocks (as W114). Typed !mineOre("iron", 6): within
//      3 minutes the bag holds 6 raw_iron (server); the copper pickaxe dug (its damage rose above 178) and was replaced
//      at 10 uses or fewer by a stone one (`My copper_pickaxe is nearly worn: N uses left. I made a new one.`, or the
//      spare text of W114); the bag holds the old copper one and a stone_pickaxe, no second copper one; the craft of
//      the stone pickaxe spent 3 cobblestone (every bot.craft is recorded: the cobblestone before and after).
//   B. The copper chest. The bot in the room (when the trip of A ended on the surface, the player in the room says
//      "come here", !goToPlayer). The room's chest is taken away (no other chest within 16); a copper_chest with 20
//      bread is set about 4 blocks from the bot in the room; `look 16` of the watch server lists its cell under
//      `Chests:` (asked before the order, while the bot stands there). Difficulty easy, the food 4 (foodTo). Typed
//      !mineOre("iron", 2): the supply text names the chest, `I get my supplies: N bread from the chest at (x, y, z).`
//      with the copper chest's cell; its bread count fell (server); the warnings of the storage pack are noted. Then
//      !stop; the copper chest is taken away (part D needs no copper chest in view, see there).
//   C. The food choice. The bag holds 3 bread, 3 cooked_beef and a cod_bucket; the food is set to 4: within 30 s the bot
//      ate cooked beef (its count fell, the bread stays 3, the bucket stays; server). The food is brought down before the
//      foods are given (the hunger reflex eats at 14 and below). The count after is noted, not checked: the spec's
//      "fell to 2" does not hold with the reflex's rule (from 4 it eats a second beef at 12).
//   D. What the model does not know. With the copper pickaxe of A in the bag, the player asks "what do you carry?": the
//      chat prompt (recorded by the fake model) holds `NEW SINCE 1.21.8 (true, even if you do not know it):` and the copper
//      tools line. "make me a spear": that prompt holds the spear line; the fake model answers
//      `!craftRecipe("stone_spear", 1)` and the bag holds a stone_spear (server; 2 sticks, a cobblestone and a crafting
//      table are given for it: the sticks of the kit went into the stone pickaxe, and the bot may stand on the surface). The control takes the copper pickaxe and the spear out of
//      the bag (stored); the conversation moves on by three lines and a newer command (the selection reads the last 3
//      chat lines and the last command, so the prompt right after "make me a spear" still names the spear: noted); the
//      prompt of the third line holds no `NEW SINCE` header.
//   E. Knockback and dig time (SPEC 4.8). A second bot of the control (w_hitter, survival) 1.5 blocks east of the bot
//      (another side when the bot stands with a wall to its west) hits it once with its fist: within 1 s the bot's server
//      position moved at least 0.3 blocks away from the hitter, every component of bot.entity.velocity stayed finite
//      (every physics tick for 3 s), onGround is true again within 3 s. Then an iron_ore set next to the bot (a stone of
//      the wall beside it, or a free cell at its feet beside it) and an iron_pickaxe given as the only pickaxe (the bot
//      takes the cheapest pickaxe that mines the ore): typed !collectBlocks("iron_ore", 1) takes at most 1,500 ms from
//      the first block_dig the bot sends to the server's block update to air (and to the server's
//      `execute if block ... air`), not 4,550.
// Throughout: the process lives, no request reached a real model, the server log holds no `Unknown packet` and no
// disconnect of the bot.
import crypto from 'node:crypto';
import { Vec3 } from 'vec3';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, itemDamages, foodTo, giveItems, connectPlayer, quitPlayer } from './helpers.js';
import { serverMark, serverLog } from './control.js';
import { region, prepareRegion, releaseRegion, inventoryOf, itemsText, blockNames, buildChest, chestItems, entityNumber, inBox, blockIs } from './world.js';
import { basePlan, buildBase, buildRoomTunnel, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMineInRoom, spots, saidLines, SUPERVISION_SETTINGS, journeyTrace, printJourney, countItem, PLAYER, waitBot, inside, freePort } from './journey.js';
import { Supervisor } from './supervisor.js';

const NAME = 'w_copper';
const HITTER = 'w_hitter';
const SUPERVISOR = 'Opus';
const KIT = [['torch', 16], ['ladder', 8], ['bread', 4], ['cobblestone', 8], ['stick', 2]];
const DURABILITY = 190; // of a copper pickaxe (26.1)
const USES = 12;
const BREAD = 20;
const WEAR = /^My copper_pickaxe is nearly worn: (\d+) uses left\. I (made a new one|take my spare one)\.$/;
const SPARE_MADE = /^I get my supplies: .*\ba second pickaxe\b/;
const BROKEN_STOP = /I stopped because my pickaxe is nearly broken/;
// SPEC 4.7, word for word
const HEADER = 'NEW SINCE 1.21.8 (true, even if you do not know it):';
const COPPER_LINE = 'Copper tools and armour exist since 1.21.9: like stone but faster, 190 uses, from copper ingots; a copper pickaxe mines iron, copper and lapis, not diamond or gold.';
const SPEAR_LINE = 'A spear is a weapon with long reach since 1.21.11: a quick jab or a charge while running; wood to netherite; it breaks no blocks.';
const CHEST_LINE = 'A copper chest is a chest with 27 slots; it oxidizes unless waxed; a copper golem takes items out of it.';
const DIG_LIMIT_MS = 1500;
// the hunger effect of foodTo: amplifier 100 takes about 1 food point every 0.4 s, quick enough that the hunger reflex
// does not hold the level up by eating, slow enough that the poll stops at 4
const FOOD_DRAIN = { ms: 60000, amplifier: 100 };
const CONTAINERS = ['chest', 'trapped_chest', 'barrel', 'copper_chest', 'exposed_copper_chest', 'weathered_copper_chest', 'oxidized_copper_chest',
    'waxed_copper_chest', 'waxed_exposed_copper_chest', 'waxed_weathered_copper_chest', 'waxed_oxidized_copper_chest'];

const P = (p) => `${p.x} ${p.y} ${p.z}`;
const cellText = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const cellOf = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) });
const same = (a, b) => Boolean(a && b) && a.x === b.x && a.y === b.y && a.z === b.z;

// Every bot.craft of the agent: the item made, the cobblestone of the bag before and after (nothing is changed: the
// wrapper calls the original).
function recordCrafts(agent) {
    const bot = agent.bot;
    const rows = [];
    const orig = bot.craft;
    bot.craft = async function recordedCraft(recipe, ...rest) {
        const item = bot.registry.items[recipe?.result?.id]?.name ?? '?';
        const row = { item, cobbleBefore: countItem(agent, 'cobblestone'), cobbleAfter: null, t: Date.now(), error: null };
        rows.push(row);
        try {
            return await orig.call(this, recipe, ...rest);
        } catch (e) {
            row.error = String(e?.message ?? e);
            throw e;
        } finally {
            row.cobbleAfter = countItem(agent, 'cobblestone');
        }
    };
    return { rows, stop() { bot.craft = orig; return rows; } };
}

// The chat requests of the fake model whose last turn matches re (the prompt is the system message).
function chatRequests(s, re) {
    return s.chat.requests.filter((r) => r.kind === 'chat' && Array.isArray(r.turns) && r.turns.length
        && re.test(String(r.turns[r.turns.length - 1].content)));
}

// The block of the new things in a prompt: the header and the lines after it up to the next empty line, for the note.
function newThingsBlock(prompt) {
    const i = prompt.indexOf(HEADER);
    if (i < 0) return '';
    const lines = prompt.slice(i).split('\n');
    const end = lines.findIndex((l, k) => k > 0 && (l.trim() === '' || /^Examples of how to respond/.test(l)));
    return lines.slice(0, end < 0 ? 4 : Math.min(end, 4)).join('\n');
}

// The player says `text`; the fake model answers `reply` to it. Resolves with the request of that line (or null).
async function sayAndRecord(s, orders, text, reply, ms = 20000) {
    const re = new RegExp(`^${PLAYER}: ${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const before = chatRequests(s, re).length;
    s.route(re, reply);
    orders.say(text);
    const got = await waitFor(() => chatRequests(s, re).length > before, { ms, every: 100 });
    return got.ok ? chatRequests(s, re)[before] : null;
}

// Samples the bot's own view on every physics tick: position, velocity, onGround (part E).
function physicsSampler(bot) {
    const rows = [];
    const on = () => {
        const e = bot.entity;
        if (!e) return;
        rows.push({ t: Date.now(), x: e.position.x, y: e.position.y, z: e.position.z, vx: e.velocity.x, vy: e.velocity.y, vz: e.velocity.z, og: e.onGround });
    };
    const vel = [];
    const onVel = (p) => { if (p.entityId === bot.entity?.id) vel.push({ t: Date.now(), raw: p.velocity, after: null }); };
    bot.on('physicsTick', on);
    bot._client.on('entity_velocity', onVel);
    return {
        rows, vel,
        stop() { bot.removeListener('physicsTick', on); bot._client.removeListener('entity_velocity', onVel); return { rows, vel }; },
    };
}

// The first block_dig the bot sends for `cell`, the item in hand and bot.digTime then, and the server's block update of
// the cell to air (part E). Nothing is changed: the write is passed on.
function digRecorder(agent, cell) {
    const bot = agent.bot;
    const c = bot._client;
    const rec = { digAt: null, held: null, digTime: null, statuses: [], airAt: null };
    const write = c.write;
    c.write = function recordedWrite(name, params, ...rest) {
        if (name === 'block_dig' && params?.location && same(params.location, cell)) {
            rec.statuses.push({ status: params.status, t: Date.now() });
            if (rec.digAt === null) {
                rec.digAt = Date.now();
                rec.held = bot.heldItem?.name ?? 'nothing';
                try { rec.digTime = bot.digTime(bot.blockAt(new Vec3(cell.x, cell.y, cell.z))); } catch { rec.digTime = null; }
            }
        }
        return write.call(this, name, params, ...rest);
    };
    const onPacket = (data, meta) => {
        if (rec.airAt !== null || meta?.name !== 'block_change' || !data?.location || !same(data.location, cell)) return;
        const n = bot.registry.blocksByStateId?.[data.type]?.name;
        if (n === 'air' || n === 'cave_air') rec.airAt = Date.now();
    };
    c.on('packet', onPacket);
    return { rec, stop() { c.write = write; c.removeListener('packet', onPacket); return rec; } };
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const t = await buildRoomTunnel(b);
        const sp = spots(b);
        const roomY = b.room.box.min.y;
        const mark = await serverMark();
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN;
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server', String(port));
        const sup = new Supervisor({ url: `http://127.0.0.1:${port}/mcp`, token: TOKEN, name: SUPERVISOR });
        let agent = null, orders = null, trace = null, hitter = null, crafts = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT,
                settings: SUPERVISION_SETTINGS({ watch_server: true, watch_port: port, new_things_in_prompt: true }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            check(agent.bot.registry.version.minecraftVersion === '26.1', 'precondition: the bot plays Minecraft 26.1', agent.bot.registry.version.minecraftVersion);
            // the worn copper pickaxe: given with its damage (the control gives it, as the owner's chest would)
            const gave = await commands([`give ${NAME} minecraft:copper_pickaxe[minecraft:damage=${DURABILITY - USES}] 1`]);
            note(`the give of the copper pickaxe answered ${JSON.stringify(gave.flat())}`);
            await waitFor(() => countItem(agent, 'copper_pickaxe') >= 1, { ms: 8000, every: 100 });
            await sleep(300);
            const damages0 = await itemDamages(NAME, 'copper_pickaxe');
            const inv0 = await inventoryOf(NAME);
            note(`the bot carries ${itemsText(inv0)}; the damage of its copper_pickaxe ${JSON.stringify(damages0)} (${USES} uses left of ${DURABILITY})`);
            check(damages0.length === 1 && damages0[0] === DURABILITY - USES && !Object.keys(inv0).some((k) => k !== 'copper_pickaxe' && /_pickaxe$/.test(k)),
                `precondition: the bot carries one copper_pickaxe worn to ${USES} uses (damage ${DURABILITY - USES}) and no other pickaxe`, `${JSON.stringify(damages0)}, ${itemsText(inv0)}`);

            // ====================================================== A. the copper pickaxe
            const taught = await partTeachMineInRoom({ ...j, b }, { tunnel: t });
            if (!taught.ok) {
                check(false, 'A0: the bot learned the mine and its tunnel (precondition of the job); the rest is not run');
                return;
            }
            const ores = [2, 4, 6].flatMap((k) => [0, 1].map((dy) => ({ ...t.beyond(k), y: t.level + dy })));
            await commands(ores.map((p) => `setblock ${P(p)} minecraft:iron_ore`));
            const damagesA0 = await itemDamages(NAME, 'copper_pickaxe');
            note(`A0: 6 iron ore beyond the rock face at ${ores.map(fmt).join(' ')}; the copper pickaxe's damage ${JSON.stringify(damagesA0)} after the walk`);
            crafts = recordCrafts(agent);
            trace = journeyTrace(agent, b);
            const tA = Date.now();
            const orderA = orders.orderInfo('!mineOre("iron", 6)', 300000);
            const mined = await waitFor(async () => ((await inventoryOf(NAME)).raw_iron || 0) >= 6, { ms: 180000, every: 2000 });
            await sleep(1000);
            const invA = await inventoryOf(NAME);
            const copperA = await itemDamages(NAME, 'copper_pickaxe');
            const saidA = saidLines(s, tA);
            const wear = saidA.find((l) => WEAR.test(l)) ?? null;
            const spareMade = saidA.find((l) => SPARE_MADE.test(l)) ?? null;
            note(`A1: ${((Date.now() - tA) / 1000).toFixed(0)} s after the order the bot carries ${itemsText(invA)} at ${fmt(await entityPos(NAME))}; the damage of its copper_pickaxe ${JSON.stringify(copperA)} (was ${DURABILITY - USES})`);
            note(`A1: the bot said ${JSON.stringify(saidA.slice(0, 30))}`);
            note(`A1: the crafts ${JSON.stringify(crafts.rows.map((c) => ({ item: c.item, cobblestone: `${c.cobbleBefore} -> ${c.cobbleAfter}`, error: c.error })))}`);
            check(mined.ok && (invA.raw_iron || 0) >= 6, 'A1: the mining with the copper pickaxe ends with 6 raw_iron in the bag (server) within 3 minutes', `${invA.raw_iron || 0} raw_iron after ${((Date.now() - tA) / 1000).toFixed(0)} s`);
            check(copperA.length >= 1 && Math.max(...copperA) > DURABILITY - USES, `A1: the copper pickaxe dug: its damage rose above ${DURABILITY - USES} (server)`, `damages ${JSON.stringify(copperA)}`);
            check(Boolean(wear || spareMade), 'A1: the wear text was said: `My copper_pickaxe is nearly worn: N uses left. I made a new one.` (or `... I take my spare one.`, or the spare made before the trip: `I get my supplies: ... a second pickaxe ...`)',
                JSON.stringify(saidA.filter((l) => /worn|pickaxe/i.test(l)).slice(0, 4)));
            if (wear) check(Number(WEAR.exec(wear)[1]) <= 10, 'A1: the copper pickaxe was replaced at 10 uses or fewer (the number of the wear text)', wear);
            check(copperA.length === 1 && Math.max(...copperA) >= DURABILITY - 10, 'A1: the bag holds the old copper pickaxe, used down to 10 uses or fewer, and no second copper one (server)',
                `damages ${JSON.stringify(copperA)} (10 uses left is damage ${DURABILITY - 10})`);
            check((invA.stone_pickaxe || 0) >= 1, 'A1: the bag holds a stone_pickaxe: the copper one was replaced by the cheapest pickaxe of its tier (server)', itemsText(invA));
            const stoneCraft = crafts.rows.find((c) => c.item === 'stone_pickaxe' && !c.error) ?? null;
            check(Boolean(stoneCraft) && stoneCraft.cobbleBefore - stoneCraft.cobbleAfter === 3, 'A1: the stone pickaxe was crafted from the cobblestone of the bag: the craft spent 3 cobblestone',
                stoneCraft ? `cobblestone ${stoneCraft.cobbleBefore} -> ${stoneCraft.cobbleAfter}` : `no stone_pickaxe craft; crafts ${JSON.stringify(crafts.rows.map((c) => c.item))}`);
            check(!crafts.rows.some((c) => c.item === 'copper_pickaxe'), 'A1: the bot never crafted a copper pickaxe', JSON.stringify(crafts.rows.map((c) => c.item)));
            check(!saidA.some((l) => BROKEN_STOP.test(l)), 'A1: no "nearly broken" stop', JSON.stringify(saidA.filter((l) => BROKEN_STOP.test(l))));
            const infoA = await Promise.race([orderA, sleep(90000).then(() => null)]);
            note(`A1: the order ${infoA ? `answered after ${((Date.now() - tA) / 1000).toFixed(0)} s: ${JSON.stringify(infoA.reply.slice(0, 300))}` : 'still runs 90 s after the iron: stopped'}`);
            if (!infoA) note(`A1: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            if (trace) printJourney('A: the copper pickaxe', await trace.stop());
            trace = null;

            // ====================================================== B. the copper chest
            let botB = await entityPos(NAME);
            note(`B0: the bot at ${fmt(botB)}, the player at ${fmt(await entityPos(PLAYER))}; in the room: ${inBox(botB, b.room.box)}`);
            if (!inBox(botB, b.room.box)) {
                const come = orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 150000);
                const w = await waitBot(agent, 'B0: "come here" from the player in the room: the bot is in the room', inside(b.room.box), 150000);
                note(`B0: "come here" answered ${JSON.stringify((await Promise.race([come, sleep(5000).then(() => ({ reply: '(still running)' }))])).reply.slice(0, 200))}`);
                check(w.ok, 'B0: precondition: the bot came down into the room by itself', fmt(w.bot));
                if (!w.ok) return;
                await sleep(1500);
                botB = await entityPos(NAME);
            }
            // the room's chest away: no other chest within 16 blocks
            await commands([`setblock ${P(b.room.chest)} minecraft:air`, `kill @e[type=minecraft:item,x=${b.room.box.min.x - 2},y=${roomY - 2},z=${b.room.box.min.z - 2},dx=10,dy=6,dz=10]`]);
            const botCell = cellOf(botB);
            const playerCell = cellOf(await entityPos(PLAYER) ?? { x: 1e9, y: 0, z: 0 });
            const busy = [b.room.table, b.room.furnace, b.room.torch, b.room.chest, ...(b.owner.shaft2.gap ?? []), ...b.owner.doors.map((d) => ({ x: d.lower.x - 1, y: roomY, z: d.lower.z })),
                { x: t.start.x + 1, y: roomY, z: t.start.z }];
            const cand = [];
            for (let x = b.room.box.min.x; x <= b.room.box.max.x; x++) {
                for (let z = b.room.box.min.z; z <= b.room.box.max.z; z++) {
                    const c = { x, y: roomY, z };
                    if (busy.some((q) => q && q.x === x && q.z === z) || same(c, botCell) || same(c, playerCell)) continue;
                    cand.push({ c, d: Math.hypot(x + 0.5 - botB.x, z + 0.5 - botB.z) });
                }
            }
            const free = await blockNames(cand.map((k) => k.c), ['air']);
            const ok = cand.filter((k, i) => free[i] === 'air').sort((a, z) => Math.abs(a.d - 4) - Math.abs(z.d - 4));
            check(ok.length > 0, 'B0: precondition: a free cell of the room floor for the copper chest', JSON.stringify(cand.map((k) => k.c)));
            if (!ok.length) return;
            const chest = ok[0].c;
            await buildChest(chest, { bread: BREAD }, { kind: 'copper_chest', facing: 'north' });
            const chestB0 = await chestItems(chest);
            const isCopper = await blockIs(chest, 'copper_chest');
            const others = await blockNames([b.house.chest, b.room.chest], CONTAINERS);
            note(`B0: the copper chest at ${cellText(chest)}, ${ok[0].d.toFixed(1)} blocks from the bot at ${fmt(botB)}, holds ${itemsText(chestB0)}; the room's chest cell ${JSON.stringify(others[1])}; the house chest ${JSON.stringify(others[0])} at ${(Math.hypot(b.house.chest.x + 0.5 - botB.x, b.house.chest.y - botB.y, b.house.chest.z + 0.5 - botB.z)).toFixed(1)} blocks`);
            check(isCopper && (chestB0?.bread || 0) === BREAD && others[1] === null, `B0: precondition: a copper_chest with ${BREAD} bread about 4 blocks from the bot, the room's chest gone`, `${isCopper ? 'copper_chest' : 'NOT a copper_chest'}, ${itemsText(chestB0)}, ${ok[0].d.toFixed(1)} blocks`);
            await commands(['difficulty easy', `gamemode survival ${NAME}`]);
            const foodB = await foodTo(NAME, 4, FOOD_DRAIN);
            note(`B0: the food level ${foodB} of 20; the bot carries ${itemsText(await inventoryOf(NAME))}`);
            // look 16 while the bot stands in the room, 4 blocks from the copper chest (after the order it may leave)
            const look = await sup.look(16);
            const chestsLine = look.text.split('\n').find((l) => /^Chests: /.test(l.trim())) ?? '';
            note(`B0: look 16 answered ${look.ok ? 'ok' : 'NOT ok'} after ${look.ms} ms: ${JSON.stringify(look.text.slice(0, 700))}`);
            check(look.ok && chestsLine.includes(cellText(chest)), `B0: \`look 16\` of the watch server lists the copper chest ${cellText(chest)} under \`Chests:\``, JSON.stringify(chestsLine || look.text.slice(0, 200)));
            const warns = [];
            const warn = console.warn;
            console.warn = function recordedWarn(...a) { warns.push(a.map(String).join(' ')); return warn.apply(this, a); };
            const SUPPLY = new RegExp(`^I get my supplies: .*\\b(\\d+) bread from the chest at \\(${chest.x}, ${chest.y}, ${chest.z}\\)[,.]`);
            trace = journeyTrace(agent, b);
            const tB = Date.now();
            const orderB = orders.orderInfo('!mineOre("iron", 2)', 240000);
            const took = await waitFor(async () => {
                const c = await chestItems(chest);
                const said = saidLines(s, tB).find((l) => SUPPLY.test(l));
                return (c?.bread ?? BREAD) < BREAD && said ? { c, said } : null;
            }, { ms: 60000, every: 1000 });
            const chestB1 = took.value?.c ?? await chestItems(chest);
            const saidB = saidLines(s, tB);
            const supply = saidB.find((l) => SUPPLY.test(l)) ?? null;
            const known = agent.packContext().chests?.get?.(chest) ?? null;
            console.warn = warn;
            const notOpened = warns.filter((l) => /did not open|could not|failed/i.test(l));
            note(`B1: the warnings of the agent while it got its supplies: ${notOpened.length} ${JSON.stringify(notOpened.slice(0, 3))}`);
            note(`B1: ${((Date.now() - tB) / 1000).toFixed(1)} s after the order the copper chest holds ${itemsText(chestB1)}, the bot carries ${itemsText(await inventoryOf(NAME))}; the chest index has ${JSON.stringify(known ? { kind: known.kind, items: known.items } : null)}`);
            note(`B1: the bot said ${JSON.stringify(saidB.slice(0, 20))}`);
            check(Boolean(supply), `B1: the supply text names the copper chest: \`I get my supplies: N bread from the chest at ${cellText(chest)}.\``, JSON.stringify(saidB.filter((l) => /suppl|bread|chest/i.test(l)).slice(0, 5)));
            check((chestB1?.bread ?? BREAD) < BREAD, `B1: the bread count of the copper chest fell below ${BREAD} (server)`, `${chestB1?.bread ?? '?'} bread`);
            note(`B1: the bot at ${fmt(await entityPos(NAME))} at the end of the part`);
            note(`B1: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            const infoB = await Promise.race([orderB, sleep(15000).then(() => null)]);
            note(`B1: the order ${infoB ? `answered ${JSON.stringify(infoB.reply.slice(0, 300))}` : 'did not answer within 15 s of the stop'}`);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            if (trace) printJourney('B: the copper chest', await trace.stop());
            trace = null;
            // part D needs no copper chest in view: with the copper pickaxe in the bag and the chest within 8 blocks, the
            // spear line does not fit the 360 characters of the block (R1-7) and is skipped
            await commands([`setblock ${P(chest)} minecraft:air`, `kill @e[type=minecraft:item,x=${chest.x - 3},y=${chest.y - 2},z=${chest.z - 3},dx=6,dy=4,dz=6]`]);

            // ====================================================== C. the food choice
            // the food level is brought down first with no food in the bag (the hunger reflex eats at 14 and below, so it
            // would eat during the descent), then the foods are given: the choice is made among them at food 4
            await commands([`clear ${NAME} minecraft:bread`, `clear ${NAME} minecraft:cooked_beef`]);
            await sleep(500);
            const foodC = await foodTo(NAME, 4, FOOD_DRAIN);
            await giveItems(NAME, [['bread', 3], ['cooked_beef', 3], ['cod_bucket', 1]], agent.bot);
            const tC = Date.now();
            const invC0 = await inventoryOf(NAME);
            note(`C0: the bot at ${fmt(await entityPos(NAME))} carries ${itemsText(invC0)}; food ${foodC} before the give`);
            check(invC0.bread === 3 && invC0.cooked_beef === 3 && invC0.cod_bucket === 1 && foodC <= 4, 'C0: precondition: the bag holds 3 bread, 3 cooked_beef and a cod_bucket, the food is 4 (or just under)', `${itemsText(invC0)}, food ${foodC}`);
            const ate = await waitFor(async () => {
                const inv = await inventoryOf(NAME);
                return (inv.cooked_beef ?? 0) < 3 || (inv.bread ?? 0) < 3 || (inv.cod_bucket ?? 0) < 1 ? inv : null;
            }, { ms: 30000, every: 500 });
            await sleep(3000);
            const invC1 = await inventoryOf(NAME);
            const firstC = ate.value ?? invC1;
            note(`C1: food ${foodC} at the start; ${ate.ok ? `the bag changed after ${(ate.ms / 1000).toFixed(1)} s: ${itemsText(firstC)}` : 'the bag did not change within 30 s'}; 3 s later ${itemsText(invC1)}, food ${await entityNumber(NAME, 'foodLevel')}`);
            note(`C1: the bot said ${JSON.stringify(saidLines(s, tC).slice(0, 10))}`);
            check(ate.ok && (firstC.cooked_beef ?? 0) < 3 && (firstC.bread ?? 0) === 3, 'C1: within 30 s of food 4 the bot ate cooked beef, not bread: the beef count fell, the bread stays 3 (server)',
                `${ate.ok ? `after ${(ate.ms / 1000).toFixed(1)} s` : 'no change in 30 s'}: cooked_beef ${firstC.cooked_beef ?? 0}, bread ${firstC.bread ?? 0}`);
            note(`C1: the cooked beef ${invC1.cooked_beef ?? 0} of 3 after 3 s (the spec says 2; the hunger reflex eats while the food is 14 or below and it carries food, so from 4 one beef gives 12 and a second follows)`);
            check((invC1.bread ?? 0) === 3 && (invC1.cod_bucket ?? 0) === 1, 'C1: the bread stays 3 and the cod_bucket stays: a fish bucket is no food (server)', `bread ${invC1.bread ?? 0}, cod_bucket ${invC1.cod_bucket ?? 0}`);
            await command(`effect give ${NAME} minecraft:saturation 1 10 true`);

            // ====================================================== D. what the model does not know
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            // the spear needs a crafting table: the bot may stand on the surface, where the base has none
            await giveItems(NAME, [['stick', 2], ['cobblestone', 1], ['crafting_table', 1]], agent.bot);
            const invD0 = await inventoryOf(NAME);
            note(`D0: the bot at ${fmt(await entityPos(NAME))} carries ${itemsText(invD0)}`);
            check((invD0.copper_pickaxe || 0) === 1, 'D0: precondition: the copper pickaxe of part A is in the bag', itemsText(invD0));
            const d1 = await sayAndRecord(s, orders, 'what do you carry?', 'I carry a copper pickaxe.');
            note(`D1: "what do you carry?": ${d1 ? `the prompt's block of the new things ${JSON.stringify(newThingsBlock(d1.prompt))}` : 'NO request of the chat model within 20 s'}`);
            check(Boolean(d1) && d1.prompt.includes(HEADER) && d1.prompt.includes(COPPER_LINE), `D1: with the copper pickaxe in the bag the chat prompt holds \`${HEADER}\` and the copper tools line`,
                d1 ? JSON.stringify(newThingsBlock(d1.prompt) || '(no header)') : 'no request');
            await sleep(3000);
            const d2 = await sayAndRecord(s, orders, 'make me a spear', '!craftRecipe("stone_spear", 1)');
            note(`D2: "make me a spear": ${d2 ? `the prompt's block of the new things ${JSON.stringify(newThingsBlock(d2.prompt))}` : 'NO request of the chat model within 20 s'}`);
            check(Boolean(d2) && d2.prompt.includes(HEADER) && d2.prompt.includes(SPEAR_LINE), 'D2: "make me a spear": that prompt holds the spear line', d2 ? JSON.stringify(newThingsBlock(d2.prompt) || '(no header)') : 'no request');
            const spear = await waitFor(async () => ((await inventoryOf(NAME)).stone_spear || 0) >= 1, { ms: 45000, every: 1000 });
            const invD2 = await inventoryOf(NAME);
            const craftTurn = s.added.filter((a) => a.name === 'system' && /craftRecipe|spear/i.test(a.content)).map((a) => a.content.slice(0, 200));
            note(`D2: the bag ${itemsText(invD2)}; the results in the history ${JSON.stringify(craftTurn.slice(-3))}`);
            check(spear.ok, 'D2: the fake model\'s !craftRecipe("stone_spear", 1) made a stone_spear: the bag holds one (server)', `${invD2.stone_spear || 0} stone_spear after ${(spear.ms / 1000).toFixed(1)} s`);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            await sleep(2000);
            // the copper pickaxe and the spear stored (the control takes them out of the bag); nothing new within view
            await commands([`clear ${NAME} minecraft:copper_pickaxe`, `clear ${NAME} minecraft:stone_spear`]);
            await waitFor(() => countItem(agent, 'copper_pickaxe') === 0 && countItem(agent, 'stone_spear') === 0, { ms: 5000, every: 100 });
            const invD3 = await inventoryOf(NAME);
            const d3a = await sayAndRecord(s, orders, 'list your things', '!inventory');
            note(`D3: the prompt right after (the last command !craftRecipe("stone_spear", 1) and "make me a spear" are still among the last lines): ${d3a ? JSON.stringify(newThingsBlock(d3a.prompt) || '(no header)') : 'no request'}`);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            await sleep(3000);
            const d3b = await sayAndRecord(s, orders, 'ok', 'Good.');
            await sleep(3000);
            const d3c = await sayAndRecord(s, orders, 'and now?', 'Fine.');
            const lastTurns = d3c ? d3c.turns.filter((x) => x.role !== 'system').slice(-3).map((x) => String(x.content).slice(0, 80)) : [];
            note(`D3: the bag ${itemsText(invD3)}; the prompt of "ok" ${d3b ? JSON.stringify(newThingsBlock(d3b.prompt) || '(no header)') : 'no request'}; of "and now?" ${d3c ? JSON.stringify(newThingsBlock(d3c.prompt) || '(no header)') : 'no request'}, its last chat turns ${JSON.stringify(lastTurns)}`);
            check(Boolean(d3c) && !d3c.prompt.includes('NEW SINCE'), 'D3: the pickaxe and the spear stored, nothing new near and the conversation moved on: the prompt holds no `NEW SINCE` header',
                d3c ? JSON.stringify(newThingsBlock(d3c.prompt) || '(no header)') : 'no request');

            // ====================================================== E. knockback and dig time
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            await sleep(1000);
            const pE = await entityPos(NAME);
            const cE = cellOf(pE);
            // the hitter east of the bot (the test of 2026-11-04); another side when the bot has no room to its west
            const sides = [{ name: 'east', dx: 1, dz: 0 }, { name: 'north', dx: 0, dz: -1 }, { name: 'south', dx: 0, dz: 1 }, { name: 'west', dx: -1, dz: 0 }];
            let side = null;
            for (const sd of sides) {
                // the hitter's cell (1.5 blocks out) and the cell behind the bot (room to be knocked into), feet and head
                const hc = cellOf({ x: pE.x + sd.dx * 1.5, y: pE.y, z: pE.z + sd.dz * 1.5 });
                const bc = cellOf({ x: pE.x - sd.dx * 1, y: pE.y, z: pE.z - sd.dz * 1 });
                const cells = [hc, { ...hc, y: hc.y + 1 }, bc, { ...bc, y: bc.y + 1 }];
                if (same(hc, cE) || same(bc, cE)) continue;
                const names = await blockNames(cells, ['air', 'cave_air', 'torch', 'wall_torch']);
                if (names.every(Boolean)) { side = sd; break; }
            }
            note(`E0: the bot at ${fmt(pE)}; the hitter's side ${side ? side.name : 'NONE free'}`);
            check(Boolean(side), 'E0: precondition: a free cell for the hitter 1.5 blocks to one side of the bot and a free cell behind the bot for the knockback', fmt(pE));
            if (!side) return;
            hitter = await connectPlayer(HITTER);
            await commands([`gamemode survival ${HITTER}`, `effect give ${NAME} minecraft:instant_health 1 10 true`]);
            const hx = pE.x + side.dx * 1.5, hz = pE.z + side.dz * 1.5;
            await command(`tp ${HITTER} ${hx.toFixed(3)} ${pE.y} ${hz.toFixed(3)}`);
            await waitFor(() => hitter.entity && Math.hypot(hitter.entity.position.x - hx, hitter.entity.position.z - hz) < 0.3 && hitter.entity.onGround, { ms: 8000, every: 50 });
            const seen = await waitFor(() => hitter.players[NAME]?.entity ?? null, { ms: 8000, every: 100 });
            await waitFor(() => agent.bot.entity.onGround, { ms: 5000, every: 50 });
            await sleep(800);
            const p0 = await entityPos(NAME);
            const h0 = await entityPos(HITTER);
            const health0 = agent.bot.health;
            const phys = physicsSampler(agent.bot);
            await hitter.lookAt(seen.value.position.offset(0, 1.62, 0), true);
            const tHit = Date.now();
            hitter.attack(seen.value);
            const pos = [];
            while (Date.now() - tHit < 1000) {
                const p = await entityPos(NAME);
                if (p) pos.push({ t: Date.now() - tHit, p });
            }
            await sleep(Math.max(0, 3000 - (Date.now() - tHit)));
            const { rows, vel } = phys.stop();
            const away = (p) => -((p.x - p0.x) * side.dx + (p.z - p0.z) * side.dz); // along the line from the hitter
            const best = pos.reduce((m, x) => (away(x.p) > m.d ? { d: away(x.p), t: x.t, p: x.p } : m), { d: -Infinity, t: null, p: null });
            const after = rows.filter((x) => x.t >= tHit);
            const finite = after.every((x) => [x.x, x.y, x.z, x.vx, x.vy, x.vz].every(Number.isFinite));
            const firstAir = after.find((x) => !x.og) ?? null;
            const backOn = firstAir ? after.find((x) => x.t > firstAir.t && x.og) ?? null : null;
            const groundOk = firstAir ? Boolean(backOn) && backOn.t - tHit <= 3000 : after.length > 0 && after[after.length - 1].og;
            const maxV = after.reduce((m, x) => Math.max(m, Math.hypot(x.vx, x.vz)), 0);
            note(`E1: the hitter at ${fmt(h0)} (${side.name} of the bot at ${fmt(p0)}, ${Math.hypot(h0.x - p0.x, h0.z - p0.z).toFixed(2)} blocks), health ${health0} -> ${agent.bot.health}; entity_velocity packets ${JSON.stringify(vel.map((v) => ({ ms: v.t - tHit, raw: v.raw })))}`);
            note(`E1: the server position within 1 s: ${pos.length} samples, the farthest ${best.d.toFixed(3)} blocks away from the hitter after ${best.t} ms at ${fmt(best.p)}; the largest horizontal speed of the bot ${maxV.toFixed(4)} blocks per tick in ${after.length} physics ticks; the first tick off the ground ${firstAir ? `${firstAir.t - tHit} ms` : 'none'}, back on the ground ${backOn ? `${backOn.t - tHit} ms` : (firstAir ? 'NEVER within 3 s' : '-')}`);
            check(best.d >= 0.3, `E1: knockback: within 1 s of the fist the bot's position moved at least 0.3 blocks away from the hitter (${side.name === 'east' ? 'west' : `away from the ${side.name}`}; server)`, `${best.d.toFixed(3)} blocks after ${best.t} ms`);
            check(finite && after.length > 0, 'E1: every component of bot.entity.velocity (and the position) stayed a finite number on every physics tick for 3 s', `${after.length} ticks, finite ${finite}`);
            check(groundOk, 'E1: onGround is true again within 3 s of the hit', firstAir ? `off at ${firstAir.t - tHit} ms, back at ${backOn ? backOn.t - tHit : 'never'} ms` : `never off the ground; last tick onGround ${after[after.length - 1]?.og}`);
            await quitPlayer(hitter);
            hitter = null;
            await sleep(1500);

            // the dig time
            // the iron pickaxe is the only pickaxe: the bot takes the cheapest pickaxe that mines the ore (the stone one of
            // part A would be taken, W114), and the spec measures the dig with the iron one in hand
            await commands([`clear ${NAME} minecraft:stone_pickaxe`, `clear ${NAME} minecraft:copper_pickaxe`]);
            await giveItems(NAME, [['iron_pickaxe', 1]], agent.bot);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            const pD = await entityPos(NAME);
            const cD = cellOf(pD);
            const walls = [];
            for (const sd of sides) for (const dy of [0, 1]) walls.push({ x: cD.x + sd.dx, y: cD.y + dy, z: cD.z + sd.dz });
            // a stone block of a wall beside the bot, else a free cell at its feet beside it (on the surface)
            const wallNames = await blockNames(walls, ['stone', 'cobblestone', 'deepslate', 'air']);
            const oreCell = walls.find((w, i) => wallNames[i] && wallNames[i] !== 'air') ?? walls.find((w, i) => w.y === cD.y && wallNames[i] === 'air') ?? null;
            check(Boolean(oreCell), 'E2: precondition: a stone block or a free cell next to the bot for the iron ore', JSON.stringify(wallNames));
            if (!oreCell) return;
            await commands([`setblock ${P(oreCell)} minecraft:iron_ore`]);
            await waitFor(() => agent.bot.blockAt(new Vec3(oreCell.x, oreCell.y, oreCell.z))?.name === 'iron_ore', { ms: 5000, every: 50 });
            const dig = digRecorder(agent, oreCell);
            const tD = Date.now();
            const orderE = orders.orderInfo('!collectBlocks("iron_ore", 1)', 60000);
            let serverAirAt = null;
            while (Date.now() - tD < 30000) {
                if (await blockIs(oreCell, 'air')) { serverAirAt = Date.now(); break; }
                await sleep(20);
            }
            await sleep(500);
            const rec = dig.stop();
            const infoE = await Promise.race([orderE, sleep(20000).then(() => null)]);
            const packetMs = rec.digAt !== null && rec.airAt !== null ? rec.airAt - rec.digAt : null;
            const pollMs = rec.digAt !== null && serverAirAt !== null ? serverAirAt - rec.digAt : null;
            note(`E2: the iron ore at ${cellText(oreCell)} beside the bot at ${fmt(pD)}; the first block_dig ${rec.digAt !== null ? `${rec.digAt - tD} ms after the order` : 'NEVER'} with ${rec.held} in hand, bot.digTime ${rec.digTime} ms; the statuses ${JSON.stringify(rec.statuses.map((x) => ({ status: x.status, ms: x.t - (rec.digAt ?? tD) })))}; the server's block update to air ${packetMs !== null ? `${packetMs} ms` : 'none'} after it, the server's execute if block air ${pollMs !== null ? `${pollMs} ms` : 'never'} after it (the game: 750 ms; the bug: 4,550)`);
            note(`E2: the order answered ${infoE ? JSON.stringify(infoE.reply.slice(0, 200)) : '(still running)'}; the bag ${itemsText(await inventoryOf(NAME))}`);
            check(rec.held === 'iron_pickaxe', 'E2: the bot dug the iron ore with the iron pickaxe in hand', String(rec.held));
            check(packetMs !== null && packetMs <= DIG_LIMIT_MS, `E2: dig time: from the first block_dig to the server's block update to air at most ${DIG_LIMIT_MS} ms (not 4,550)`, `${packetMs} ms (bot.digTime ${rec.digTime} ms)`);
            check(pollMs !== null && pollMs <= DIG_LIMIT_MS + 100, `E2: the server reports the cell as air (execute if block) at most ${DIG_LIMIT_MS} ms after the first block_dig (plus 100 ms of polling)`, `${pollMs} ms`);

            // ====================================================== throughout
            const log = await serverLog(mark);
            const bad = log.lines.filter((l) => /Unknown packet/i.test(l) || new RegExp(`${NAME} (lost connection|left the game)|Disconnecting ${NAME}|${NAME}.*(was kicked|kicked from)`).test(l));
            note(`the server log since the start: ${log.lines.length} lines, ${bad.length} of a disconnect or an unknown packet ${JSON.stringify(bad.slice(0, 5))}`);
            check(bad.length === 0, 'the server log holds no `Unknown packet` and no disconnect of the bot', JSON.stringify(bad.slice(0, 3)));
            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            check(!inLogs, 'the watch token is in no console line of the agent', inLogs ? 'HAS it' : 'no');
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (crafts) crafts.stop();
            await commands([`effect clear ${NAME}`, 'difficulty peaceful']).catch(() => {});
            if (trace) printJourney('W121', await trace.stop());
            if (hitter) await quitPlayer(hitter);
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
