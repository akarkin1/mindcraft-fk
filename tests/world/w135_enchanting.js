// W135 the enchanting table (entry `the_table`; v0.1.4.16 "Stability, and three packs", round two, tester T5; PLAN.md section 5
// "Enchanting", SPEC sections 8.1, 8.3 and 8.6): the enchanting pack. The bot reads the three offers of the table and says them, the
// owner chooses with "take N", the lapis comes from a known chest with the owner's standing permit, a level too low spends nothing, a
// choice given in the order takes its offer without the question, a name the table does not offer takes the item back, no table is
// said. Against 5abf721 (round one, no pack) the typed `!allowTaking` answers `Command '!allowTaking' does not exist.` and every check
// of 1 to 7 fails from there; on the release every check passes.
//
// The base world, the flat grass of the region: an enchanting table at the origin with 15 bookshelves on the ring two blocks around it
// (16 cells at the table's level, the south one left open as the way in; the ring one block around it is air, so every shelf counts:
// the table reaches level 30), a chest with 32 lapis 5 blocks away, the bot 5 blocks south of the table, the player beside it. The
// owner's switches (SUPERVISION_SETTINGS) with the switch of the pack, `enchanting`, on; the modes of his profile, an empty memory.
// Console names of 26.1.
//   1. Typed `!viewChest` (the bot learns the lapis chest); typed `!allowTaking("lapis_lazuli", true)`: `I may take lapis_lazuli from
//      the chests now.` and permits.json holds the permit (SPEC 8.1).
//   2. `/xp set <bot> 30 levels`, a diamond pickaxe given; typed `!enchant("diamond_pickaxe")`: within 90 s the bot says `I took 3
//      lapis_lazuli from the chest at (x, y, z).` (the chest holds 29) and the offers line `The table offers for your diamond_pickaxe:
//      1) <Name> (<n> levels, 1 lapis), 2) <Name> (<n> levels, 2 lapis), 3) <Name> (<n> levels, 3 lapis). Say "take 1", "take 2",
//      "take 3" or "none".` with the lapis 1, 2, 3 (the index + 1).
//   3. Typed `!enchantTake(1)` while the window waits: `I enchanted your diamond_pickaxe: <Name of offer 1> (<n> levels, 1 lapis).`,
//      the pickaxe in the bag carries the component `minecraft:enchantments` (server), the level fell below 30, one lapis left the bag.
//   4. A fresh pickaxe, `/xp set <bot> 12 levels`, typed `!enchant("diamond_pickaxe")`: the offers line again; typed `!enchantTake(k)`
//      of the offer whose cost is above 12 (with 15 shelves the third costs 30: the game's offers rise from the first to the third; the
//      spec's example lists them the other way round): `Level 12, offer k needs <cost>.`, the pickaxe back in the bag without an
//      enchantment, the level still 12, no lapis spent.
//   5. `/xp set 30`; typed `!enchant("diamond_pickaxe", "mending")` (a treasure enchantment the table never offers): the offers line
//      ends `; none of them is mending.` instead of the "Say ..." tail, the pickaxe back unenchanted.
//   6. Typed `!enchant("diamond_pickaxe", "<name of offer 2>")` (the same seed gives the same offers): the enchanted line with that
//      name, no offers question said, the pickaxe enchanted (server).
//   7. The table taken away, a fresh pickaxe: typed `!enchant("diamond_pickaxe")` answers `No enchanting table within 32 blocks.`
// Throughout: the process lives, zero model calls (typed orders ask no model), no request reached a real model.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, giveItems, readWorldFile,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, buildChest, chestItems, blockNames, hdist } from './world.js';
import { BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, countItem } from './journey.js';
import { run, cellText } from './small_base.js';

const NAME = 'w_table';
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const LAPIS = 32;

// ---- SPEC 8.1 and 8.3, the texts word for word
const ALLOWED_LAPIS = 'I may take lapis_lazuli from the chests now.';
const TOOK_LAPIS = /^I took 3 lapis_lazuli from the chest at \((-?\d+), (-?\d+), (-?\d+)\)\.$/;
const OFFER = String.raw`(.+?) \((\d+) levels?, (\d+) lapis\)`;
const OFFERS = new RegExp(String.raw`^The table offers for your diamond_pickaxe: 1\) ${OFFER}, 2\) ${OFFER}, 3\) ${OFFER}\. Say "take 1", "take 2", "take 3" or "none"\.$`);
const OFFERS_NONE = (name) => new RegExp(String.raw`^The table offers for your diamond_pickaxe: 1\) ${OFFER}, 2\) ${OFFER}, 3\) ${OFFER}; none of them is ${name}\.$`);
const ENCHANTED = /^I enchanted your diamond_pickaxe: (.+?) \((\d+) levels?, (\d+) lapis\)\.$/;
const LEVEL_LINE = (level, n, need) => `Level ${level}, offer ${n} needs ${need}.`;
const TOOK_BACK = 'I took the diamond_pickaxe back; say "enchant my pickaxe" again when you have chosen.';
const NO_TABLE = 'No enchanting table within 32 blocks.';
const NO_COMMAND = /does not exist/;

const textOf = (s, t, re, reply) => saidLines(s, t).find((l) => re.test(l)) ?? (re.test(String(reply ?? '')) ? String(reply) : null);
const exact = (text) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
// The offers of an offers line: [{ n, name, cost, lapis }].
const offersOf = (line) => {
    const m = OFFERS.exec(line ?? '') ?? OFFERS_NONE('[^.]+').exec(line ?? '');
    return m ? [1, 2, 3].map((n) => ({ n, name: m[(n - 1) * 3 + 1], cost: Number(m[(n - 1) * 3 + 2]), lapis: Number(m[(n - 1) * 3 + 3]) })) : [];
};
// The name of an enchantment as the owner says it: the display name without its roman numeral, lower case ("Unbreaking II" -> "unbreaking").
const plainName = (display) => String(display).replace(/\s+(?:X{0,3}(?:IX|IV|V?I{0,3}))$/, '').trim().toLowerCase();

// The diamond pickaxes of the bot from the server: [{ enchanted, enchantments: { name: level } }].
async function pickaxesOf(name) {
    const out = await command(`data get entity ${name} Inventory`);
    const line = out.find((l) => /has the following entity data: /.test(l));
    if (!line) return [];
    const text = line.slice(line.indexOf('entity data: ') + 13);
    const objects = [];
    let depth = 0, from = -1, quote = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"' && text[i - 1] !== '\\') quote = !quote;
        if (quote) continue;
        if (ch === '{') { if (depth === 0) from = i; depth++; }
        else if (ch === '}') { depth--; if (depth === 0 && from >= 0) { objects.push(text.slice(from, i + 1)); from = -1; } }
    }
    return objects.filter((o) => /id: "(?:minecraft:)?diamond_pickaxe"/.test(o)).map((o) => {
        const comp = /"minecraft:enchantments": \{([^}]*)\}/.exec(o);
        const enchantments = {};
        if (comp) for (const m of comp[1].matchAll(/"(?:minecraft:)?(\w+)": (\d+)/g)) enchantments[m[1]] = Number(m[2]);
        return { enchanted: Boolean(comp), enchantments, text: o.slice(0, 200) };
    });
}

// The level and the points of a player (server).
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
        const { ox, oz, g } = r;
        const table = { x: ox, y: g + 1, z: oz };
        const gap = { x: ox, y: g + 1, z: oz + 2 };
        const shelves = [];
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
            if (dx === gap.x - ox && dz === gap.z - oz) continue;
            shelves.push({ x: ox + dx, y: g + 1, z: oz + dz });
        }
        const chest = { x: ox - 5, y: g + 1, z: oz + 4 };
        const botAt = { x: ox, y: g + 1, z: oz + 5 };
        await run([
            `fill ${ox - 2} ${g + 1} ${oz - 2} ${ox + 2} ${g + 2} ${oz + 2} minecraft:air`,
            `setblock ${P(table)} minecraft:enchanting_table`,
            ...shelves.map((b) => `setblock ${P(b)} minecraft:bookshelf`),
        ], 'the table and its shelves');
        await buildChest(chest, { lapis_lazuli: LAPIS });
        const names = await blockNames([table, ...shelves, gap, { x: ox + 1, y: g + 1, z: oz + 1 }], ['enchanting_table', 'bookshelf', 'air']);
        const shelvesOk = names.slice(1, 1 + shelves.length).filter((n) => n === 'bookshelf').length;
        note(`build: the table at ${cellText(table)} (${names[0]}), ${shelvesOk} of ${shelves.length} bookshelves on the ring, the way in at ${cellText(gap)} is ${names[1 + shelves.length]}, the inner ring is ${names[2 + shelves.length]}; the chest at ${cellText(chest)} holds ${JSON.stringify(await chestItems(chest))}`);
        check(names[0] === 'enchanting_table' && shelvesOk === 15 && names[1 + shelves.length] === 'air' && names[2 + shelves.length] === 'air', 'precondition: an enchanting table with 15 bookshelves two blocks around it, the inner ring free (level 30 offers)', `${shelvesOk} shelves`);
        let agent = null, orders = null, s = null;
        try {
            const j = await startJourney(NAME, null, {
                botAt, botYaw: 180, playerAt: { x: botAt.x + 2, y: g + 1, z: botAt.z }, kit: [],
                settings: SUPERVISION_SETTINGS({ enchanting: true }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            const requests0 = s.chat.requests.length;
            const lapisInBag = () => countItem(agent, 'lapis_lazuli');
            const idle = () => waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            // a fresh, unenchanted pickaxe as the only diamond pickaxe of the bag
            const freshPickaxe = async () => {
                await commands([`clear ${NAME} minecraft:diamond_pickaxe`]);
                await waitFor(() => countItem(agent, 'diamond_pickaxe') === 0, { ms: 5000, every: 50 });
                await giveItems(NAME, [['diamond_pickaxe', 1]], agent.bot);
            };
            // a typed !enchant with the choice '' and the typed answer `!enchantTake(n)` once the offers line is said:
            // { info, offersLine, offers, answer, said }
            const enchantAndTake = async (chooseN, label) => {
                const t = Date.now();
                const info = orders.orderInfo('!enchant("diamond_pickaxe")', 120000);
                const offered = await waitFor(() => saidLines(s, t).find((l) => OFFERS.test(l)) ?? null, { ms: 90000, every: 250 });
                let answer = null;
                let n = null;
                if (offered.ok) {
                    n = typeof chooseN === 'function' ? chooseN(offersOf(offered.value)) : chooseN;
                    const tTake = Date.now();
                    answer = await orders.orderInfo(`!enchantTake(${n})`, 60000);
                    note(`${label}: the offers came after ${(offered.ms / 1000).toFixed(1)} s; !enchantTake(${n}) answered after ${((Date.now() - tTake) / 1000).toFixed(1)} s: ${JSON.stringify(String(answer.reply).slice(0, 160))}`);
                } else {
                    note(`${label}: no offers line within 90 s; the bot said ${JSON.stringify(saidLines(s, t).slice(0, 6))}`);
                }
                const done = await info;
                return { info: done, offersLine: offered.value ?? null, offers: offersOf(offered.value), n, answer, said: saidLines(s, t), t };
            };

            // ====================================================== 1. the chest and the permit
            const viewed = await orders.orderInfo('!viewChest', 60000);
            note(`1: !viewChest answered after ${(viewed.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(viewed.reply).slice(0, 160))}`);
            check(viewed.done && new RegExp(`The chest at \\(${chest.x}, ${chest.y}, ${chest.z}\\) contains: lapis_lazuli ${LAPIS}`).test(String(viewed.reply)), 'precondition: the bot knows the lapis chest (a typed !viewChest; the pack takes lapis from the chests it knows)', JSON.stringify(String(viewed.reply).slice(0, 160)));
            await idle();
            const t1 = Date.now();
            const allow = await orders.orderInfo('!allowTaking("lapis_lazuli", true)', 30000);
            const allowed = textOf(s, t1, exact(ALLOWED_LAPIS), allow.reply);
            const permits = readWorldFile(agent, 'permits.json');
            note(`1: !allowTaking("lapis_lazuli", true) answered ${JSON.stringify(String(allow.reply).slice(0, 160))}; said ${JSON.stringify(saidLines(s, t1).slice(0, 3))}; permits.json ${JSON.stringify(permits.json ?? permits.error)}`);
            check(allow.done && !NO_COMMAND.test(String(allow.reply)) && allowed !== null, `1a: the typed \`!allowTaking("lapis_lazuli", true)\` says \`${ALLOWED_LAPIS}\` (SPEC 8.1)`, JSON.stringify(String(allow.reply).slice(0, 160)));
            check(permits.json?.items?.lapis_lazuli?.allowed === true, '1b: permits.json of the world holds the permit (`{ version: 1, items: { lapis_lazuli: { allowed: true, at } } }`)', JSON.stringify(permits.json ?? permits.error));

            // ====================================================== 2 and 3. the offers at level 30, the owner takes offer 1
            await commands([`xp set ${NAME} 30 levels`, `xp set ${NAME} 0 points`]);
            await giveItems(NAME, [['diamond_pickaxe', 1]], agent.bot);
            await waitFor(() => agent.bot.experience?.level === 30, { ms: 5000, every: 50 });
            const xp2 = await xpOf(NAME);
            check(xp2.level === 30 && agent.bot.experience?.level === 30, 'precondition: the bot is at level 30 (server and its own view) with a diamond pickaxe', `server ${JSON.stringify(xp2)}, bot ${agent.bot.experience?.level}`);
            const e2 = await enchantAndTake(1, '2');
            const took = e2.said.find((l) => TOOK_LAPIS.test(l)) ?? null;
            const tookAt = took ? TOOK_LAPIS.exec(took) : null;
            const chest2 = await chestItems(chest);
            const enchantedLine = textOf(s, e2.t, ENCHANTED, e2.answer?.reply);
            const picks3 = await pickaxesOf(NAME);
            const xp3 = await xpOf(NAME);
            note(`2: !enchant("diamond_pickaxe") answered after ${(e2.info.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(e2.info.reply).slice(0, 200))}; the bot said ${JSON.stringify(e2.said.slice(0, 8))}; the offers ${JSON.stringify(e2.offers)}; the chest holds ${JSON.stringify(chest2)}; lapis in the bag ${lapisInBag()}`);
            note(`3: the pickaxes of the bag (server) ${JSON.stringify(picks3.map((x) => x.enchantments))}; xp ${JSON.stringify(xp3)}`);
            check(!NO_COMMAND.test(String(e2.info.reply)) && took !== null && Number(tookAt?.[1]) === chest.x && Number(tookAt?.[3]) === chest.z && (chest2?.lapis_lazuli ?? 0) === LAPIS - 3, `2a: with the permit the bot takes 3 lapis from the known chest and says \`I took 3 lapis_lazuli from the chest at (x, y, z).\`; the chest holds ${LAPIS - 3} (server)`, `${JSON.stringify(took)}; the chest ${JSON.stringify(chest2)}`);
            check(e2.offersLine !== null && e2.offers.length === 3 && e2.offers.every((o) => o.lapis === o.n) && e2.offers.every((o) => o.cost >= 1 && o.cost <= 30), '2b: the bot says the offers line `The table offers for your diamond_pickaxe: 1) <Name> (<n> levels, 1 lapis), 2) ... (.., 2 lapis), 3) ... (.., 3 lapis). Say "take 1", "take 2", "take 3" or "none".` (three offers, the lapis the index + 1; SPEC 8.3)', JSON.stringify(e2.offersLine ?? e2.said.slice(0, 3)));
            if (e2.offers.length === 3 && !(e2.offers[0].cost <= e2.offers[1].cost && e2.offers[1].cost <= e2.offers[2].cost)) note('2b: the costs do not rise from offer 1 to 3 as the game orders them: a wording to check in the pack');
            const offer1 = e2.offers[0] ?? null;
            const enchantedM = enchantedLine ? ENCHANTED.exec(enchantedLine) : null;
            // the line names every enchantment the result carries (the game can add more than the offer's clue: DECISIONS B-9)
            check(e2.info.done && enchantedLine !== null && Boolean(offer1) && String(enchantedM?.[1] ?? '').split(', ').includes(offer1.name) && Number(enchantedM?.[2]) === offer1.cost && Number(enchantedM?.[3]) === 1, '3a: the typed `!enchantTake(1)` while the window waits enchants and the bot says `I enchanted your diamond_pickaxe: <the enchantments, offer 1\'s among them> (<n> levels, 1 lapis).`', `${JSON.stringify(enchantedLine)}; offer 1 ${JSON.stringify(offer1)}`);
            check(picks3.length === 1 && picks3[0].enchanted && Object.keys(picks3[0].enchantments).length >= 1, '3b: the diamond pickaxe in the bag carries the component `minecraft:enchantments` (data get entity, 26.1 components)', JSON.stringify(picks3.map((x) => x.enchantments)));
            check(xp3.level < 30 && xp3.level >= 27 && lapisInBag() === 2, '3c: the enchant spent levels (below 30, at most 3) and one lapis (2 of the 3 taken are left in the bag)', `xp ${JSON.stringify(xp3)}, lapis ${lapisInBag()}`);
            await idle();

            // ====================================================== 4. level 12: the costly offer is refused, nothing spent
            await freshPickaxe();
            await commands([`xp set ${NAME} 12 levels`, `xp set ${NAME} 0 points`]);
            await waitFor(() => agent.bot.experience?.level === 12, { ms: 5000, every: 50 });
            const lapis4 = lapisInBag();
            const chest4 = await chestItems(chest);
            const e4 = await enchantAndTake((offers) => (offers.find((o) => o.cost > 12) ?? offers[2] ?? { n: 3 }).n, '4');
            const offer4 = e4.offers.find((o) => o.n === e4.n) ?? null;
            const levelLine = offer4 ? textOf(s, e4.t, exact(LEVEL_LINE(12, offer4.n, offer4.cost)), e4.answer?.reply) : null;
            const picks4 = await pickaxesOf(NAME);
            const xp4 = await xpOf(NAME);
            note(`4: at level 12 !enchant("diamond_pickaxe") answered after ${(e4.info.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(e4.info.reply).slice(0, 200))}; the offers ${JSON.stringify(e4.offers)}; !enchantTake(${e4.n}) -> ${JSON.stringify(String(e4.answer?.reply ?? '(no answer)').slice(0, 160))}; the bot said ${JSON.stringify(e4.said.slice(0, 8))}; pickaxes ${JSON.stringify(picks4.map((x) => x.enchantments))}; xp ${JSON.stringify(xp4)}; lapis ${lapis4} -> ${lapisInBag()}; the chest ${JSON.stringify(await chestItems(chest))} (was ${JSON.stringify(chest4)})`);
            check(e4.offersLine !== null && Boolean(offer4) && offer4.cost > 12, '4a: the offers line again; an offer costs more than 12 levels (the third costs 30 with 15 shelves)', JSON.stringify(e4.offers));
            check(e4.info.done && levelLine !== null, `4b: the owner's choice of that offer is refused with \`${offer4 ? LEVEL_LINE(12, offer4.n, offer4.cost) : 'Level 12, offer k needs <cost>.'}\` (SPEC 8.3, the levels)`, `${JSON.stringify(e4.answer?.reply ?? null)}; said ${JSON.stringify(e4.said.slice(0, 6))}`);
            check(picks4.length === 1 && !picks4[0].enchanted && xp4.level === 12 && lapisInBag() === lapis4, '4c: nothing spent: the pickaxe is back in the bag unenchanted, the level is still 12, the lapis count is unchanged', `pickaxes ${JSON.stringify(picks4.map((x) => x.enchantments))}, xp ${JSON.stringify(xp4)}, lapis ${lapisInBag()}`);
            await idle();

            // ====================================================== 5. a name the table does not offer
            await commands([`xp set ${NAME} 30 levels`, `xp set ${NAME} 0 points`]);
            await waitFor(() => agent.bot.experience?.level === 30, { ms: 5000, every: 50 });
            const t5 = Date.now();
            const e5 = await orders.orderInfo('!enchant("diamond_pickaxe", "mending")', 120000);
            const none5 = textOf(s, t5, OFFERS_NONE('mending'), e5.reply);
            const picks5 = await pickaxesOf(NAME);
            note(`5: !enchant("diamond_pickaxe", "mending") answered after ${(e5.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(e5.reply).slice(0, 200))}; said ${JSON.stringify(saidLines(s, t5).slice(0, 6))}; pickaxes ${JSON.stringify(picks5.map((x) => x.enchantments))}`);
            check(e5.done && none5 !== null, '5a: a name the table does not offer: the offers line ends `; none of them is mending.` instead of the "Say ..." tail (SPEC 8.3, the choice)', JSON.stringify(none5 ?? String(e5.reply).slice(0, 160)));
            check(picks5.length === 1 && !picks5[0].enchanted, '5b: the pickaxe is back in the bag unenchanted', JSON.stringify(picks5.map((x) => x.enchantments)));
            await idle();

            // ====================================================== 6. the choice in the order: offer 2 by its name, no question
            const offers6 = offersOf(none5).length === 3 ? offersOf(none5) : e4.offers;
            const chosen = offers6[1] ?? null;
            const name6 = chosen ? plainName(chosen.name) : 'unbreaking';
            const lapis6 = lapisInBag();
            const t6 = Date.now();
            const e6 = await orders.orderInfo(`!enchant("diamond_pickaxe", "${name6}")`, 120000);
            const said6 = saidLines(s, t6);
            const enchanted6 = textOf(s, t6, ENCHANTED, e6.reply);
            const m6 = enchanted6 ? ENCHANTED.exec(enchanted6) : null;
            const asked6 = said6.filter((l) => /Say "take 1"/.test(l));
            const picks6 = await pickaxesOf(NAME);
            const xp6 = await xpOf(NAME);
            note(`6: !enchant("diamond_pickaxe", "${name6}") (offer 2 of ${JSON.stringify(offers6)}) answered after ${(e6.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(e6.reply).slice(0, 200))}; said ${JSON.stringify(said6.slice(0, 6))}; pickaxes ${JSON.stringify(picks6.map((x) => x.enchantments))}; xp ${JSON.stringify(xp6)}; lapis ${lapis6} -> ${lapisInBag()}`);
            check(e6.done && enchanted6 !== null && Boolean(chosen) && String(m6?.[1] ?? '').split(', ').includes(chosen.name) && Number(m6?.[3]) === 2, `6a: a choice in the order takes its offer without asking: \`I enchanted your diamond_pickaxe: <the enchantments, ${chosen?.name ?? '<Name>'} among them> (<n> levels, 2 lapis).\``, `${JSON.stringify(enchanted6)}; offer 2 ${JSON.stringify(chosen)}`);
            check(asked6.length === 0, '6b: no offers question was said (the "Say \\"take 1\\" ..." line)', JSON.stringify(asked6));
            check(picks6.length === 1 && picks6[0].enchanted && Object.keys(picks6[0].enchantments).length >= 1 && xp6.level < 30, '6c: the pickaxe in the bag is enchanted (server) and levels were spent', `pickaxes ${JSON.stringify(picks6.map((x) => x.enchantments))}, xp ${JSON.stringify(xp6)}`);
            if (picks6[0]?.enchanted && !Object.keys(picks6[0].enchantments).some((k) => k.split('_').some((w) => name6.includes(w)))) note(`6: the component names ${JSON.stringify(Object.keys(picks6[0].enchantments))} while the owner said "${name6}": the display name and the id differ (a curse is "..._curse")`);
            await idle();

            // ====================================================== 7. no table
            await freshPickaxe();
            await commands([`setblock ${P(table)} minecraft:air`]);
            await sleep(500);
            const t7 = Date.now();
            const e7 = await orders.orderInfo('!enchant("diamond_pickaxe")', 60000);
            const none7 = textOf(s, t7, exact(NO_TABLE), e7.reply);
            const at7 = await entityPos(NAME);
            note(`7: the table taken away; !enchant("diamond_pickaxe") answered after ${(e7.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(e7.reply).slice(0, 160))}; said ${JSON.stringify(saidLines(s, t7).slice(0, 3))}; the bot at ${fmt(at7)}, ${hdist(at7, { x: table.x + 0.5, z: table.z + 0.5 }).toFixed(1)} blocks from the table's cell`);
            check(e7.done && none7 !== null, `7: without a table within 32 blocks: \`${NO_TABLE}\``, JSON.stringify(String(e7.reply).slice(0, 160)));

            const requests = s.chat.requests.slice(requests0).map((q) => String(q?.turns?.[q.turns.length - 1]?.content ?? '').slice(0, 100));
            check(requests.length === 0, 'zero model calls: typed orders ask no model and the pack asks none (SPEC 8.0)', JSON.stringify(requests));
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['gamerule advance_time false', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
