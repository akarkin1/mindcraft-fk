// W122 a fresh world (journey of the v0.1.4.14 fix round, tester T3; DECISIONS P-2 to P-5, the play of 2026-11-07): the
// owner's first hour on a new 26.1 world. The area sense read a forest as a walled yard with a roof and kept asking for its
// name (P-4); !chopTrees answered "Logs of buildings are not mine to take." beside natural oaks (P-3); !givePlayer refused
// every give above 8 (P-2); the bot's own emptied chest could not be collected (P-5). Before the fixes of E4 parts A and
// B fail (P-4, P-3); parts C and D pass since commit 57add90 (P-2, P-5).
//
// The natural world (seed 8675309, README "World types"): no base, nothing built; the runner gives the world spawn
// (env.spawn). The trees differ from run to run, so the scenario reads the trees of its own run (treesNear of helpers.js
// through the player bot) and names none by position. The owner's switches (SUPERVISION_SETTINGS) with
// new_things_in_prompt on, the modes of his profile, an empty memory; the bag: a stone axe and 4 bread. The fake model
// answers every plain line of the player with one line (as W119), so every prompt is recorded. The console commands use
// the 26.1 names.
//   A. The forest is no building. The bot stands at the world spawn (under the oak canopy, noted) for 60 s, then (moved by
//      the control) on a slope of the hill for 60 s; the player speaks to it twice at each place. The knowledge block of
//      every prompt (from `WHAT YOU KNOW` to the first empty line, with the block of the new things after it) never holds
//      "yard", "roof", "walled", "enclosure" or "ask ... name"; the bot says no line about a place it has not saved.
//   B. Natural trees are trees. random_tick_speed 30 while the bot cuts (leaves decay as in a played world, so saplings
//      fall; 0 again after). Typed !chopTrees(8, "oak"): within 120 s the bag holds 8 oak logs more (server); the answer
//      never holds "Logs of buildings"; it says saplings were planted (`I planted N saplings.`). Then a fallen trunk of
//      this run (treesNear, still whole): the control stands the bot 2 blocks from it; !chopTrees(2, "oak"): its logs are
//      gone (server), the bag grew by its length or more, no "buildings" text. A run without a fallen trunk notes it and
//      skips the check.
//   C. The give gives. The player 2 blocks from the bot, with no logs; typed !givePlayer("w_player", "oak_log", N) with N
//      all the bot's oak logs (server): within 15 s the player holds N and the bot none (server), the answer has
//      `I gave you N oak_log.` and never "That is a lot". The control gives the logs back to the bot.
//   D. The bot's own chest. Typed !craftSupplies("chest", 1), !placeHere("chest"), !storeItems: the chest holds the bot's
//      logs (server). !collectBlocks("chest", 1) with it full: `The chest at (x, y, z) holds N things; say "empty the
//      chest" first.` and the chest stands. !fetchItem("oak_log", N) (and every other kind it holds), then
//      !collectBlocks("chest", 1): the chest is gone (server), the bag holds one chest more, the answer is not
//      "No chest nearby to collect".
//   The world back: the saplings and the chest's cell stay as they are (natural); the control clears the bags of the bot
//   and the player (nothing taken out of the world by the player).
// Throughout: the process lives, no request reached a real model class.
import { Vec3 } from 'vec3';
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, giveItems,
    placeBot, treesNear, chunksMissing, tp,
} from './helpers.js';
import { inventoryOf, itemsText, blockNames, blockIs, chestItems, hdist } from './world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER } from './journey.js';

const NAME = 'w_fresh';
const RADIUS = 48;
const KNOWLEDGE_HEADER = 'WHAT YOU KNOW (from memory, no need to check):';
const BUILDING_WORDS = /\byard\b|\broofs?\b|\bwalled\b|\benclosures?\b|\bask\b[^\n]*\bname\b/i;
const NOT_SAVED = /that I have not saved|Tell me its name|not saved/i;
const BOT_LINE = 'I am here.';
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;

// ------------------------------------------------------------------ the world as the player bot sees it

const solid = (b) => Boolean(b) && b.boundingBox === 'block' && !/leaves$|_log$|_wood$/.test(b.name);
const free = (b) => Boolean(b) && b.boundingBox === 'empty' && !/water|lava/.test(b.name);
const at = (bot, x, y, z) => bot.blockAt(new Vec3(x, y, z));
const standable = (bot, x, y, z) => solid(at(bot, x, y - 1, z)) && free(at(bot, x, y, z)) && free(at(bot, x, y + 1, z));

// The top block of the ground of a column (no leaves, no log), or null.
function groundTop(bot, x, z) {
    for (let y = 140; y > 30; y--) {
        const b = at(bot, x, y, z);
        if (b && b.boundingBox === 'block') {
            if (solid(b)) return y;
        }
    }
    return null;
}

// A cell where a player can stand, about `d` blocks (horizontally) from p, within 2 blocks of its height; not in `avoid`.
function standNear(bot, p, d, avoid = []) {
    const best = [];
    const r = Math.ceil(d) + 1;
    for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
            const dist = Math.hypot(dx, dz);
            if (Math.abs(dist - d) > 0.75) continue;
            for (let dy = -2; dy <= 2; dy++) {
                const c = { x: Math.floor(p.x) + dx, y: Math.floor(p.y) + dy, z: Math.floor(p.z) + dz };
                if (avoid.some((q) => q.x === c.x && q.z === c.z)) continue;
                if (standable(bot, c.x, c.y, c.z)) best.push({ c, score: Math.abs(dist - d) + Math.abs(dy) * 0.3 });
            }
        }
    }
    best.sort((a, b) => a.score - b.score);
    return best[0]?.c ?? null;
}

// A cell on a slope of the hill near the spawn: the ground 3 blocks or more higher or lower 2 blocks away; standable.
function slopeNear(bot, spawn, from = 6, to = 32) {
    const out = [];
    for (let dx = -to; dx <= to; dx++) {
        for (let dz = -to; dz <= to; dz++) {
            const dist = Math.hypot(dx, dz);
            if (dist < from || dist > to) continue;
            const x = spawn.x + dx, z = spawn.z + dz;
            const h = groundTop(bot, x, z);
            if (h === null || !standable(bot, x, h + 1, z)) continue;
            const around = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(([a, b]) => groundTop(bot, x + a, z + b)).filter((y) => y !== null);
            const step = around.length ? Math.max(...around.map((y) => Math.abs(y - h))) : 0;
            if (step >= 3) out.push({ c: { x, y: h + 1, z }, step, dist });
        }
    }
    out.sort((a, b) => a.dist - b.dist);
    return out[0] ?? null;
}

// How many oak leaves the column above the bot and its 8 neighbours hold within 12 blocks (the canopy over it).
function canopyOver(bot, p) {
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 2; dy <= 12; dy++) {
        const b = at(bot, Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz);
        if (b && /leaves$/.test(b.name)) n++;
    }
    return n;
}

// The knowledge block of a prompt: from its header to the first empty line (the block of the new things follows it).
function knowledgeBlock(prompt) {
    const i = prompt.indexOf(KNOWLEDGE_HEADER);
    if (i < 0) return null;
    const lines = prompt.slice(i).split('\n');
    const end = lines.findIndex((l, k) => k > 0 && (l.trim() === '' || /^Examples of how to respond/.test(l)));
    return lines.slice(0, end < 0 ? lines.length : end).join('\n');
}

// The fake model: one line for every plain line of the player (W119), each request kept with its time.
function oneLineModel(s) {
    const chat = s.chat;
    const send = chat.sendRequest;
    chat.sendRequest = async function oneLine(turns, systemMessage) {
        const last = Array.isArray(turns) && turns.length ? String(turns[turns.length - 1].content) : '';
        if (new RegExp(`^${PLAYER}: (?!!)`).test(last)) {
            chat.requests.push({ kind: 'chat', prompt: String(systemMessage ?? ''), turns: [{ role: 'user', content: last }], t: Date.now() });
            return BOT_LINE;
        }
        return send.call(this, turns, systemMessage);
    };
}

const countOf = async (name, item) => (await inventoryOf(name))[item] || 0;
const reply = (info) => String(info?.reply ?? '');

await scenarioMain({
    async main() {
        check(env.world === 'natural', 'precondition: the scenario runs in the natural world', env.world);
        const spawn = env.spawn;
        check(Boolean(spawn), 'precondition: the runner gives the world spawn', JSON.stringify(spawn));
        if (!spawn) return;
        let agent = null, orders = null, s = null;
        try {
            const j = await startJourney(NAME, null, {
                botAt: spawn, playerAt: spawn, kit: [['stone_axe', 1], ['bread', 4]],
                settings: SUPERVISION_SETTINGS({ new_things_in_prompt: true }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            oneLineModel(s);
            const player = orders.player;
            await player.waitForChunksToLoad();
            const loaded = await waitFor(() => chunksMissing(player, spawn, RADIUS).length === 0, { ms: 30000, every: 250 });
            note(`the player's chunks within ${RADIUS} blocks: ${loaded.ok ? `all after ${(loaded.ms / 1000).toFixed(1)} s` : `${chunksMissing(player, spawn, RADIUS).length} missing`}`);
            const trees0 = treesNear(player, spawn, RADIUS);
            note(`the trees of this run within ${RADIUS} blocks of the spawn ${P(spawn)}: ${trees0.logs} oak logs, ${trees0.trunks.length} trunks, ${trees0.fallen.length} fallen trunks `
                + `${JSON.stringify(trees0.fallen.map((f) => `${f.length} along ${f.axis} from ${P(f.from)}`))}, ${trees0.branches.length} branches, ${trees0.leaves} oak leaves`);
            // the player beside the bot, not in its cell
            const besideSpawn = standNear(player, spawn, 2);
            if (besideSpawn) await tp(PLAYER, besideSpawn);
            const inv0 = await inventoryOf(NAME);
            note(`the bot at ${fmt(await entityPos(NAME))} carries ${itemsText(inv0)}; the player at ${fmt(await entityPos(PLAYER))}`);
            check(inv0.stone_axe === 1 && inv0.bread === 4 && Object.keys(inv0).length === 2, 'precondition: the bag holds a stone axe and 4 bread, nothing else', itemsText(inv0));

            // ====================================================== A. the forest is no building
            const tA = Date.now();
            const reqA = s.chat.requests.length;
            const pA1 = await entityPos(NAME);
            note(`A1: the bot at the spawn ${fmt(pA1)}: ${canopyOver(player, pA1)} oak leaves over it (the canopy, the player's view)`);
            await sleep(20000);
            orders.say('what do you see here?');
            await sleep(20000);
            orders.say('is this a good place?');
            await sleep(Math.max(0, 60000 - (Date.now() - tA)));
            const slope = slopeNear(player, spawn);
            note(`A2: the slope ${slope ? `${P(slope.c)}, the ground ${slope.step} blocks higher or lower 2 blocks away, ${slope.dist.toFixed(1)} blocks from the spawn` : 'NONE found within 32 blocks'}`);
            check(Boolean(slope), 'A2: precondition: a slope of the hill near the spawn (the ground 3 blocks or more higher or lower 2 blocks away)', slope ? P(slope.c) : 'none');
            if (slope) {
                const tA2 = Date.now();
                await placeBot(agent, slope.c, 0);
                const near = standNear(player, slope.c, 2);
                if (near) await tp(PLAYER, near);
                note(`A2: the bot on the slope at ${fmt(await entityPos(NAME))} (${canopyOver(player, slope.c)} oak leaves over it), the player at ${fmt(await entityPos(PLAYER))}`);
                await sleep(20000);
                orders.say('and what about here?');
                await sleep(20000);
                orders.say('do you like this hill?');
                await sleep(Math.max(0, 60000 - (Date.now() - tA2)));
            }
            const prompts = s.chat.requests.slice(reqA).filter((r) => r.kind === 'chat');
            const blocks = prompts.map((r) => knowledgeBlock(r.prompt));
            const bad = blocks.map((b, i) => ({ i, b, m: b ? BUILDING_WORDS.exec(b) : null })).filter((x) => x.m);
            note(`A: ${prompts.length} prompts of the chat model; ${blocks.filter(Boolean).length} with a knowledge block; the blocks ${JSON.stringify([...new Set(blocks.map((b) => b ?? '(none)'))].slice(0, 4))}`);
            const saidA = saidLines(s, tA);
            const notSaved = saidA.filter((l) => NOT_SAVED.test(l));
            note(`A: the bot said ${JSON.stringify(saidA.slice(0, 12))}`);
            check(prompts.length >= 2, 'A: precondition: the chat model got prompts while the bot stood in the forest', `${prompts.length} prompts`);
            check(bad.length === 0, 'A: the knowledge block of every prompt holds no "yard", "roof", "walled", "enclosure" or "ask ... name": the forest is no building',
                bad.length ? `${bad.length} of ${prompts.length}: ${JSON.stringify(bad[0].m[0])} in ${JSON.stringify(bad[0].b)}` : `0 of ${prompts.length}`);
            check(notSaved.length === 0, 'A: the bot says no line about a place it has not saved', JSON.stringify(notSaved.slice(0, 3)));

            // ====================================================== B. natural trees are trees
            await commands(['gamerule random_tick_speed 30']);
            const logsB0 = await countOf(NAME, 'oak_log');
            const tB = Date.now();
            const chop = orders.orderInfo('!chopTrees(8, "oak")', 180000);
            const got = await waitFor(async () => (await countOf(NAME, 'oak_log')) >= logsB0 + 8, { ms: 120000, every: 2000 });
            const chopInfo = await Promise.race([chop, sleep(60000).then(() => null)]);
            const logsB1 = await countOf(NAME, 'oak_log');
            const textB = reply(chopInfo);
            note(`B1: ${got.ok ? `8 oak logs more after ${(got.ms / 1000).toFixed(0)} s` : 'NOT 8 oak logs more within 120 s'}; the bag ${itemsText(await inventoryOf(NAME))}; the answer ${chopInfo ? JSON.stringify(textB.slice(0, 400)) : '(still running after 60 s more)'}`);
            check(got.ok && logsB1 - logsB0 >= 8, 'B1: !chopTrees(8, "oak") in the forest: within 120 s the bag holds 8 oak logs more (server)', `${logsB0} -> ${logsB1} oak_log after ${((Date.now() - tB) / 1000).toFixed(0)} s`);
            check(Boolean(chopInfo) && !/Logs of buildings/.test(textB), 'B1: the answer never holds "Logs of buildings": natural oaks are no building', chopInfo ? JSON.stringify(textB.slice(0, 200)) : 'no answer');
            const planted = /I planted (\d+) saplings?\./.exec(textB);
            check(Boolean(planted) && Number(planted[1]) > 0, 'B1: saplings were planted: the answer says `I planted N saplings.`', JSON.stringify((/I planted[^.]*\.|I had no sapling to plant\./.exec(textB) ?? ['(no sapling text)'])[0]));
            if (!chopInfo) note(`B1: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await commands(['gamerule random_tick_speed 0']);

            // the fallen trunk of this run
            await tp(PLAYER, besideSpawn ?? spawn);
            await sleep(1500);
            const trees1 = treesNear(player, spawn, RADIUS);
            const whole = [];
            for (const f of trees1.fallen) {
                const cells = Array.from({ length: f.length }, (_, k) => ({ ...f.from, [f.axis]: f.from[f.axis] + k }));
                const names = await blockNames(cells, ['oak_log']);
                if (names.every((n) => n === 'oak_log')) whole.push({ ...f, cells, d: hdist(f.from, spawn) });
            }
            whole.sort((a, b) => a.d - b.d);
            note(`B2: the fallen trunks after the cut: ${JSON.stringify(trees1.fallen.map((f) => `${f.length} along ${f.axis} from ${P(f.from)}`))}, whole on the server ${whole.length}`);
            const trunk = whole[0] ?? null;
            if (!trunk) {
                note('B2: this run has no whole fallen trunk within 48 blocks: the check of the fallen trunk is skipped');
            } else {
                const middle = trunk.cells[Math.floor(trunk.cells.length / 2)];
                const stand = standNear(player, middle, 2, trunk.cells);
                check(Boolean(stand), 'B2: precondition: a cell 2 blocks from the fallen trunk where the bot can stand', stand ? P(stand) : 'none');
                if (stand) {
                    await placeBot(agent, stand, 0);
                    // the player 10 blocks away, so that it does not pick up the logs of the trunk
                    await tp(PLAYER, standNear(player, stand, 10, trunk.cells) ?? standNear(player, stand, 7, trunk.cells) ?? stand);
                    const logsB2 = await countOf(NAME, 'oak_log');
                    const tB2 = Date.now();
                    const info = await orders.orderInfo('!chopTrees(2, "oak")', 120000);
                    const left = await blockNames(trunk.cells, ['oak_log']);
                    const logsB3 = await countOf(NAME, 'oak_log');
                    note(`B2: the fallen trunk of ${trunk.length} logs along ${trunk.axis} from ${P(trunk.from)}; the bot at ${fmt(await entityPos(NAME))}; after ${((Date.now() - tB2) / 1000).toFixed(0)} s its cells ${JSON.stringify(left)}, the bag ${logsB2} -> ${logsB3} oak_log; the answer ${JSON.stringify(reply(info).slice(0, 300))}`);
                    check(left.every((n) => n === null), 'B2: !chopTrees(2, "oak") 2 blocks from a fallen trunk: its logs are gone (server)', `${left.filter(Boolean).length} of ${trunk.length} left`);
                    check(logsB3 - logsB2 >= trunk.length, `B2: the bag grew by the fallen trunk's ${trunk.length} logs or more (server)`, `${logsB2} -> ${logsB3}`);
                    check(!/buildings/.test(reply(info)), 'B2: the answer holds no "buildings" text', JSON.stringify(reply(info).slice(0, 200)));
                }
            }

            // ====================================================== C. the give gives
            const pC = await entityPos(NAME);
            // no stray drops near the bot (a log the cut left), and the player's bag without logs
            await commands([`kill @e[type=minecraft:item,x=${Math.floor(pC.x)},y=${Math.floor(pC.y)},z=${Math.floor(pC.z)},distance=..16]`, `clear ${PLAYER} minecraft:oak_log`]);
            const stC = standNear(player, pC, 2);
            if (stC) await tp(PLAYER, stC);
            await sleep(1000);
            const N = await countOf(NAME, 'oak_log');
            note(`C: the bot at ${fmt(pC)} carries ${N} oak_log; the player at ${fmt(await entityPos(PLAYER))}, ${hdist(await entityPos(PLAYER), pC).toFixed(1)} blocks away, ${await countOf(PLAYER, 'oak_log')} oak_log`);
            check(N > 0 && Boolean(stC), 'C: precondition: the bot carries oak logs and the player stands 2 blocks away', `${N} oak_log, the player's cell ${stC ? P(stC) : 'none'}`);
            const tC = Date.now();
            const give = orders.orderInfo(`!givePlayer("${PLAYER}", "oak_log", ${N})`, 30000);
            const gave = await waitFor(async () => (await countOf(PLAYER, 'oak_log')) >= N && (await countOf(NAME, 'oak_log')) === 0, { ms: 15000, every: 500 });
            const giveInfo = await give;
            const pl = await countOf(PLAYER, 'oak_log'), bl = await countOf(NAME, 'oak_log');
            note(`C: after ${((Date.now() - tC) / 1000).toFixed(1)} s the player holds ${pl} oak_log, the bot ${bl}; the answer ${JSON.stringify(reply(giveInfo).slice(0, 300))}`);
            check(gave.ok && pl >= N && bl === 0, `C: within 15 s the player holds all ${N} oak logs and the bot none (server)`, `player ${pl}, bot ${bl}${gave.ok ? ` after ${(gave.ms / 1000).toFixed(1)} s` : ''}`);
            check(reply(giveInfo).includes(`I gave you ${N} oak_log.`), `C: the answer is \`I gave you ${N} oak_log.\``, JSON.stringify(reply(giveInfo).slice(0, 200)));
            check(!/That is a lot/.test(reply(giveInfo)), 'C: no "That is a lot"', JSON.stringify(reply(giveInfo).slice(0, 200)));
            // the logs back for part D
            await commands([`clear ${PLAYER} minecraft:oak_log`]);
            if (N > 0) await giveItems(NAME, [['oak_log', N]], agent.bot);

            // ====================================================== D. the bot's own chest
            const craft = await orders.orderInfo('!craftSupplies("chest", 1)', 60000);
            const invD0 = await inventoryOf(NAME);
            note(`D1: !craftSupplies("chest", 1) answered ${JSON.stringify(reply(craft).slice(0, 200))}; the bag ${itemsText(invD0)}`);
            check((invD0.chest || 0) >= 1, 'D1: precondition: the bot crafted a chest (server)', itemsText(invD0));
            const chestId = agent.bot.registry.blocksByName.chest.id;
            const before = agent.bot.findBlocks({ matching: chestId, maxDistance: 8, count: 16 }).map((p) => P(p));
            const place = await orders.orderInfo('!placeHere("chest")', 30000);
            await sleep(1000);
            const placed = agent.bot.findBlocks({ matching: chestId, maxDistance: 8, count: 16 }).find((p) => !before.includes(P(p))) ?? null;
            const chest = placed ? { x: placed.x, y: placed.y, z: placed.z } : null;
            note(`D1: !placeHere("chest") answered ${JSON.stringify(reply(place).slice(0, 200))}; the chest ${chest ? P(chest) : 'NOT found'}`);
            check(Boolean(chest) && await blockIs(chest, 'chest'), 'D1: precondition: the bot placed its chest (server)', chest ? P(chest) : 'none');
            if (!chest) return;
            const logsD = await countOf(NAME, 'oak_log');
            const store = await orders.orderInfo('!storeItems', 60000);
            const inChest = await chestItems(chest);
            note(`D2: !storeItems answered ${JSON.stringify(reply(store).slice(0, 300))}; the chest holds ${itemsText(inChest)}; the bag ${itemsText(await inventoryOf(NAME))}`);
            check((inChest?.oak_log || 0) === logsD && logsD > 0, `D2: the chest holds the bot's ${logsD} oak logs (server)`, `${inChest?.oak_log || 0} oak_log in the chest`);
            const total = Object.values(inChest ?? {}).reduce((a, b) => a + b, 0);
            const full = await orders.orderInfo('!collectBlocks("chest", 1)', 60000);
            const FULL = new RegExp(`The chest at \\(${chest.x}, ${chest.y}, ${chest.z}\\) holds (\\d+) things?; say "empty the chest" first\\.`);
            const fm = FULL.exec(reply(full));
            const stands = await blockIs(chest, 'chest');
            note(`D3: !collectBlocks("chest", 1) with the chest full (${total} items) answered ${JSON.stringify(reply(full).slice(0, 300))}; the chest ${stands ? 'stands' : 'is GONE'}`);
            check(Boolean(fm), `D3: the answer is \`The chest at ${P(chest)} holds N things; say "empty the chest" first.\``, JSON.stringify(reply(full).slice(0, 200)));
            if (fm) note(`D3: N in the answer ${fm[1]}, the chest's items ${total}`);
            check(stands, 'D3: the full chest stands (server)', stands ? 'stands' : 'gone');
            for (const [kind, n] of Object.entries(inChest ?? {}).sort(([a], [b]) => (a === 'oak_log' ? -1 : b === 'oak_log' ? 1 : 0))) {
                const f = await orders.orderInfo(`!fetchItem("${kind}", ${n})`, 60000);
                note(`D4: !fetchItem("${kind}", ${n}) answered ${JSON.stringify(reply(f).slice(0, 200))}`);
            }
            const emptied = await chestItems(chest);
            const chests0 = await countOf(NAME, 'chest');
            const collect = await orders.orderInfo('!collectBlocks("chest", 1)', 60000);
            await sleep(1500);
            const gone = !(await blockIs(chest, 'chest'));
            const chests1 = await countOf(NAME, 'chest');
            note(`D4: the chest held ${itemsText(emptied)} before; !collectBlocks("chest", 1) answered ${JSON.stringify(reply(collect).slice(0, 300))}; the chest ${gone ? 'is gone' : 'STANDS'}; the bag ${chests0} -> ${chests1} chest`);
            check(gone, 'D4: the emptied chest of the bot was collected: it is gone (server)', gone ? 'gone' : 'stands');
            check(chests1 === chests0 + 1, 'D4: the bag holds one chest more (server)', `${chests0} -> ${chests1}`);
            check(!/No chest nearby to collect/.test(reply(collect)), 'D4: the answer is not "No chest nearby to collect"', JSON.stringify(reply(collect).slice(0, 200)));

            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['gamerule random_tick_speed 0', `clear ${NAME}`, `clear ${PLAYER}`]).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
        }
    },
});
exitSoon();
