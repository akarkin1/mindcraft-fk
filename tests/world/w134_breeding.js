// W134 the pens (entry `the_pens`; v0.1.4.16 "Stability, and three packs", round two, tester T5; PLAN.md section 5 "Breeding",
// SPEC sections 8.1, 8.2 and 8.6): the breeding pack. "breed the cows" feeds pairs over the fence from the ring outside the pen,
// the gate stays shut, calves come, the cap of 12 holds, feed from a known chest is taken only with the owner's permit, which he
// gives once in words. Against 5abf721 (round one, no pack) the first `!breed` answers `Command '!breed' does not exist.` and every
// check of A to C fails from there; on the release every check passes.
//
// The base world with the small base of W126 (small_base.js: the cow pen 9 x 9 east of the house with 5 cows and a roof, the pig pen
// 9 x 9 south of it with 4 pigs, both with an oak fence and a gate facing south). The animals of the small base stand still (NoAI); here
// they are summoned again WITH their AI, so that they come to the fence for the feed the bot holds, as the owner's animals do (the
// pack waits for the animals to come within reach; a cow that never moves never comes). The owner's switches (SUPERVISION_SETTINGS)
// with base_survey, survey_radius 128 and the switch of the pack, `breeding`, on; the modes of his profile, an empty memory. The bot
// stands outside the house door, the player beside it. Console names of 26.1.
//   0. Typed `!surveyBase("east")` saves the pens as the survey finds them (W126 A3: `cow_pen` with 5 cows, `pig_pen` with 4 pigs,
//      kind pen): the pack breeds a saved pen by name (SPEC 8.2). A precondition, not what this scenario proves.
//   A. 8 wheat in the bag; typed `!breed("cow_pen", 2)`. Within 7 minutes (one game cooldown of 5 minutes may fall in): A1 the pair
//      line `I fed 2 cows in the cow pen.` was said and the order ends with `I fed 4 cows in the cow pen; 2 calves.`; A2 cows fell in
//      love (`InLove` of the server, sampled every 250 ms; two distinct cows, or one and a calf, which only two in love make); A3 two
//      calves stand in the pen (cows without the tag of the summoned ones, `Age` negative); A4 when the first cow fell in love the bot
//      stood outside the fence ring within 2.5 blocks of it; A5 the bot never stood inside the fence box; A6 the gate held `open=false`
//      in every sample and at the end; A7 the pen is as built (snapshot: no block placed or taken, the fence whole); A8 4 wheat left
//      the bag (two per pair). The control resets the parents' cooldown (`/data merge entity ... {Age:0}`) each time a calf appears,
//      so a second feed of the same pair breeds at once (SPEC 8.6).
//   B. Cows summoned until the pen holds 12 animals, calves counted; typed `!breed("cow_pen", 2)`: `The cow pen is full: 12 animals;
//      I breed no more there.`, no wheat used.
//   C. 16 carrots put into the house chest (known to the bot from a typed `!viewChest`), no carrot in the bag, no permit: typed
//      `!breed("pig_pen", 1)` asks `May I take 2 carrot from the chest at (x, y, z) for the feeding? Say yes or no.`; the owner says
//      "yes" and the fake model maps it to `!allowTaking("carrot", true)` (SPEC 8.1): the bot says `I may take carrot from the chests
//      now.`, then `I took 2 carrot from the chest at (x, y, z).` (the chest holds 14), feeds (`I fed 2 pigs in the pig pen.`, two pigs
//      in love, a piglet) and ends with `I fed 2 pigs in the pig pen; 1 piglet.`; permits.json of the world holds the permit; the pig
//      gate stays closed and the bot never stands inside the pig pen.
// Throughout: the process lives, no request reached a real model; the only requests to the fake model are the owner's "yes" and the
// result of the command it chose.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, fmt, sleep, commands, command, waitFor, giveItems, readWorldFile, printTrace,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, isOpen, chestItems, snapshotBox, compareSnapshot, dropSnapshot, describeDifferences } from './world.js';
import { BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, countEntities, countItem } from './journey.js';
import { smallBasePlan, buildSmallBase, verifySmallBase, TAG, run, cellText } from './small_base.js';

const NAME = 'w_pens';
const BASE = 'east';
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const COW_TAG = `${TAG}_cow`;
const PIG_TAG = `${TAG}_pig`;
const PEN_CAP = 12;
const BREED_MS = 420000; // two pairs at once, or one game cooldown of 5 minutes between them (SPEC 8.2, the pace)

// ---- SPEC 8.1 and 8.2, the texts word for word (the pen's name with a space, the species' young)
const PAIR_COWS = 'I fed 2 cows in the cow pen.';
const END_COWS = 'I fed 4 cows in the cow pen; 2 calves.';
const FULL_COWS = (n) => `The cow pen is full: ${n} animals; I breed no more there.`;
// the item name as the spec writes it (`8 wheat`): "2 carrot"; a plural "2 carrots" is accepted and noted
const ASK_CARROT = /^May I take 2 carrots? from the chest at \((-?\d+), (-?\d+), (-?\d+)\) for the feeding\? Say yes or no\.$/;
const ALLOWED_CARROT = 'I may take carrot from the chests now.';
const TOOK_CARROT = /^I took 2 carrots? from the chest at \((-?\d+), (-?\d+), (-?\d+)\)\.$/;
const PAIR_PIGS = 'I fed 2 pigs in the pig pen.';
const END_PIGS = 'I fed 2 pigs in the pig pen; 1 piglet.';
const NO_COMMAND = /does not exist/;

// A summon of an animal WITH its AI (small_base's `summon` makes them stand still), persistent, with tags.
const summonLive = (kind, p, tags) => `summon minecraft:${kind} ${p.x + 0.5} ${p.y} ${p.z + 0.5} {PersistenceRequired:1b,Tags:[${tags.map((t) => `"${t}"`).join(',')}]}`;
// the entities of a pen (the box of its fence, one block under the grass to 4 above it), as verifySmallBase counts them
const penSelector = (pen, g, type, more = '') => `@e[type=minecraft:${type},x=${pen.box.min.x},y=${g - 1},z=${pen.box.min.z},dx=8,dy=5,dz=8${more}]`;
const numberIn = (lines) => { const m = /entity data: (-?\d+)/.exec((lines ?? []).join(' ')); return m ? Number(m[1]) : null; };
// the horizontal distance of a position to the fence ring box (0 inside or on it)
const ringDistance = (p, box) => Math.hypot(Math.max(box.min.x - p.x, 0, p.x - (box.max.x + 1)), Math.max(box.min.z - p.z, 0, p.z - (box.max.z + 1)));
const textOf = (s, t, re, reply) => saidLines(s, t).find((l) => re.test(l)) ?? (re.test(String(reply ?? '')) ? String(reply) : null);
const areaText = (a) => (a ? `${a.name} (type ${a.type}, kind ${a.kind}, source ${a.source ?? '-'}) ${cellText(a.min)} to ${cellText(a.max)} animals ${JSON.stringify(a.contents?.animals ?? null)}` : 'none');

// Samples a pen every `every` ms in one batch of console commands: the bot's position, the gate, the love of every tagged animal
// (by its index tag), the untagged young of the species in the box, the action of the agent. { rows, lovers, stop() }.
function penSampler(agent, pen, g, type, tagBase, count, every = 250) {
    const rows = [];
    const lovers = new Set();
    const t0 = Date.now();
    let stopped = false;
    const young = penSelector(pen, g, type, `,tag=!${tagBase}`);
    const loop = (async () => {
        while (!stopped) {
            const t = (Date.now() - t0) / 1000;
            try {
                const out = await commands([
                    `data get entity ${NAME} Pos`,
                    `execute if block ${P(pen.gate)} minecraft:oak_fence_gate[open=false]`,
                    `execute if entity ${young}`,
                    ...Array.from({ length: count }, (_, i) => `data get entity @e[tag=${tagBase}_${i},limit=1] InLove`),
                ]);
                const posLine = out[0].find((l) => /entity data: \[/.test(l));
                const nums = posLine ? posLine.slice(posLine.indexOf('[')).match(/-?\d+(?:\.\d+)?(?:E-?\d+)?/gi).map(Number) : null;
                const bot = nums && nums.length >= 3 ? { x: nums[0], y: nums[1], z: nums[2] } : null;
                const gateClosed = out[1].some((l) => /^Test passed/.test(l));
                const youngCount = Number(/count: (\d+)/.exec(out[2].join(' '))?.[1] ?? 0);
                const love = Array.from({ length: count }, (_, i) => numberIn(out[3 + i]));
                love.forEach((v, i) => { if (v !== null && v > 0) lovers.add(i); });
                rows.push({ t, bot, gateClosed, young: youngCount, love, action: agent.actions.currentActionLabel || '-' });
            } catch (e) {
                rows.push({ t, error: e.message });
            }
            await sleep(every);
        }
    })();
    return { rows, lovers, async stop() { stopped = true; await loop; return rows; } };
}

const traceCols = {
    bot: (x) => fmt(x.bot), gate: (x) => (x.gateClosed ? 'closed' : 'OPEN'), love: (x) => JSON.stringify(x.love), young: (x) => String(x.young), action: (x) => x.action,
};

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const p = smallBasePlan(r);
        const { ox, oz, g } = p;
        const h = p.house;
        const built = await buildSmallBase(p, { ghast: false, portal: false });
        const verified = await verifySmallBase(p, built);
        for (const l of verified.lines) note(`build: ${l}`);
        check(verified.ok, 'precondition: the small base of W126 is built as planned (every part read back from the server)', verified.lines.filter((l) => l.startsWith('WRONG')).join('; ') || 'all ok');
        // the animals again, with their AI: 5 cows, 4 pigs, each with an index tag for the love sampler
        // a /kill drops the loot: the beef, the leather and the porkchops of the standing animals are cleared too
        await commands([`kill @e[tag=${COW_TAG}]`, `kill @e[tag=${PIG_TAG}]`]);
        await sleep(300);
        await commands([`kill @e[type=minecraft:item,x=${ox - 30},y=${g - 2},z=${oz - 30},dx=60,dy=12,dz=60]`, `kill @e[type=minecraft:experience_orb,x=${ox - 30},y=${g - 2},z=${oz - 30},dx=60,dy=12,dz=60]`]);
        const live = await commands([
            ...p.cowPen.spots.slice(0, 5).map((c, i) => summonLive('cow', c, [TAG, COW_TAG, `${COW_TAG}_${i}`])),
            ...p.pigPen.spots.slice(0, 4).map((c, i) => summonLive('pig', c, [TAG, PIG_TAG, `${PIG_TAG}_${i}`])),
        ]);
        const badLive = live.flat().filter((l) => !/Summoned new/.test(l));
        const cows0 = await countEntities(penSelector(p.cowPen, g, 'cow'));
        const pigs0 = await countEntities(penSelector(p.pigPen, g, 'pig'));
        note(`build: the animals summoned again with their AI: ${cows0} cows in the cow pen, ${pigs0} pigs in the pig pen${badLive.length ? '; refused: ' + badLive.join(' | ') : ''}`);
        check(badLive.length === 0 && cows0 === 5 && pigs0 === 4, 'precondition: 5 cows with their AI stand in the cow pen and 4 pigs in the pig pen (they come to the fence for the feed, as the owner\'s animals)', `${cows0} cows, ${pigs0} pigs`);
        const cowBox = { min: { x: p.cowPen.box.min.x, y: g, z: p.cowPen.box.min.z }, max: { x: p.cowPen.box.max.x, y: p.cowPen.roofY, z: p.cowPen.box.max.z } };
        const cowSnap = await snapshotBox(cowBox, { slot: 0 });
        const pigSnap = await snapshotBox(p.pigPen.box, { slot: 1 });
        let agent = null, orders = null, s = null;
        try {
            const j = await startJourney(NAME, null, {
                botAt: h.outsideDoor, botYaw: 0, playerAt: { x: h.outsideDoor.x + 2, y: g + 1, z: h.outsideDoor.z }, kit: [],
                settings: SUPERVISION_SETTINGS({ base_survey: true, survey_radius: 128, breeding: true }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            const areas = () => agent.area_store?.list?.() ?? [];
            const area = (name) => areas().find((a) => a.name === name) ?? null;
            const wheat = () => countItem(agent, 'wheat');
            const requests0 = s.chat.requests.length;

            // ====================================================== 0. the survey saves the pens (W126 A3)
            const survey = await orders.orderInfo(`!surveyBase("${BASE}")`, 90000);
            const cowPen = area('cow_pen'), pigPen = area('pig_pen');
            note(`0: !surveyBase("east") answered after ${(survey.ms / 1000).toFixed(1)} s: ${JSON.stringify(String(survey.reply).slice(0, 160))}; cow_pen ${areaText(cowPen)}; pig_pen ${areaText(pigPen)}; the areas ${JSON.stringify(areas().map((a) => a.name))}`);
            check(Boolean(cowPen) && cowPen.kind === 'pen' && (cowPen.contents?.animals?.cow ?? 0) === 5 && Boolean(pigPen) && pigPen.kind === 'pen' && (pigPen.contents?.animals?.pig ?? 0) === 4,
                'precondition: the survey saved `cow_pen` (kind pen, 5 cows) and `pig_pen` (kind pen, 4 pigs): the pens the pack breeds by name (SPEC 8.2)', `cow_pen ${areaText(cowPen)}; pig_pen ${areaText(pigPen)}`);
            // the saved box against the fence: SPEC 8.2 puts the stand ring one block outside the fence AND at "the box grown by 2 minus
            // the box grown by 1"; the two agree only when the saved box leaves the fence out. Noted for the report.
            if (cowPen?.min) note(`0: the saved box of cow_pen ${cellText(cowPen.min)} to ${cellText(cowPen.max)} against the fence ring ${cellText(p.cowPen.box.min)} to ${cellText(p.cowPen.box.max)}: the box ${cowPen.min.x <= p.cowPen.box.min.x && cowPen.max.x >= p.cowPen.box.max.x ? 'HOLDS the fence cells (the ring "box grown by 2 minus box grown by 1" lies 2 blocks outside the fence)' : 'leaves the fence out (the ring of SPEC 8.2 lies one block outside the fence)'}`);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });

            // ====================================================== A. breed the cows: two pairs over the fence
            await giveItems(NAME, [['wheat', 8]], agent.bot);
            const wheatA = wheat();
            const samplerA = penSampler(agent, p.cowPen, g, 'cow', COW_TAG, 5);
            const tA = Date.now();
            const breedA = orders.orderInfo('!breed("cow_pen", 2)', BREED_MS);
            let doneA = false;
            breedA.then(() => { doneA = true; }, () => { doneA = true; });
            // the cooldown reset of SPEC 8.6: each new calf resets the parents (Age 6000 after breeding) to 0, so that the next pair
            // of the same adults breeds at once; the babies have no tag and keep their negative Age
            let calvesSeen = 0;
            let firstLoveAt = null;
            const watcher = (async () => {
                while (!doneA) {
                    const last = samplerA.rows[samplerA.rows.length - 1];
                    if (last && !last.error) {
                        if (firstLoveAt === null && last.love.some((v) => v !== null && v > 0)) firstLoveAt = { t: last.t, bot: last.bot, love: last.love };
                        if (last.young > calvesSeen) {
                            calvesSeen = last.young;
                            const reset = await commands([`execute as @e[type=minecraft:cow,tag=${COW_TAG}] run data merge entity @s {Age:0}`]);
                            note(`A: calf ${calvesSeen} appeared at t=${last.t.toFixed(1)}s of the samples; the cooldown of the ${reset[0].filter((l) => /Modified entity data/.test(l)).length} tagged cows was reset (Age 0)`);
                        }
                    }
                    await sleep(250);
                }
            })();
            const infoA = await breedA;
            await watcher;
            await sleep(1500);
            const rowsA = await samplerA.stop();
            printTrace('A: !breed("cow_pen", 2)', rowsA, traceCols, 120);
            const saidA = saidLines(s, tA);
            const pairLinesA = saidA.filter((l) => l === PAIR_COWS);
            const endA = textOf(s, tA, new RegExp(`^${END_COWS.replace(/[.;]/g, '\\$&')}$`), infoA.reply);
            const calvesA = await countEntities(penSelector(p.cowPen, g, 'cow', `,tag=!${COW_TAG}`));
            const calfAge = calvesA > 0 ? numberIn(await command(`data get entity ${penSelector(p.cowPen, g, 'cow', `,tag=!${COW_TAG},limit=1`)} Age`)) : null;
            const insideA = rowsA.filter((x) => x.bot && inBox(x.bot, p.cowPen.box));
            const gateOpenA = rowsA.filter((x) => !x.error && !x.gateClosed);
            const gateA = await isOpen(p.cowPen.gate, 'oak_fence_gate');
            const cmpA = await compareSnapshot(cowSnap);
            const wheatUsed = wheatA - wheat();
            note(`A: !breed("cow_pen", 2) answered after ${(infoA.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(infoA.reply).slice(0, 200))}; the bot said ${JSON.stringify(saidA.slice(0, 10))}`);
            note(`A: cows in love (by index) ${JSON.stringify([...samplerA.lovers])}; the first love at ${firstLoveAt ? `t=${firstLoveAt.t.toFixed(1)}s with the bot at ${fmt(firstLoveAt.bot)}, ${ringDistance(firstLoveAt.bot, p.cowPen.box).toFixed(2)} blocks outside the fence ring` : 'never'}; ${calvesA} calves (Age of one: ${calfAge}); ${insideA.length} samples inside the fence box; the gate open in ${gateOpenA.length} samples, ${gateA ? 'OPEN' : 'closed'} now; wheat ${wheatA} -> ${wheat()}; the pen ${cmpA.same ? 'as built' : 'CHANGED: ' + describeDifferences(cmpA.differences)}`);
            check(!NO_COMMAND.test(String(infoA.reply)) && pairLinesA.length >= 1, `A1: the bot says the pair line \`${PAIR_COWS}\` (one per pair fed; SPEC 8.2)`, `${pairLinesA.length} pair lines; the answer ${JSON.stringify(String(infoA.reply).slice(0, 120))}`);
            check(infoA.done && endA !== null, `A1: the order ends within ${BREED_MS / 60000} minutes with the end line \`${END_COWS}\` (said, or the typed command's answer)`, infoA.done ? JSON.stringify(String(infoA.reply).slice(0, 160)) : 'no answer (the command keeps running)');
            check(samplerA.lovers.size >= 2 || (samplerA.lovers.size >= 1 && calvesA >= 1), 'A2: cows fell in love from the feed over the fence: `InLove` of two distinct cows seen by the server (or one and a calf, which only two in love make)', `in love ${JSON.stringify([...samplerA.lovers])}, calves ${calvesA}`);
            check(calvesA >= 2 && calfAge !== null && calfAge < 0, 'A3: two calves stand in the pen (cows without the tag of the summoned ones, `Age` negative)', `${calvesA} calves, Age ${calfAge}`);
            check(Boolean(firstLoveAt?.bot) && !inBox(firstLoveAt.bot, p.cowPen.box) && ringDistance(firstLoveAt.bot, p.cowPen.box) <= 2.5, 'A4: when the first cow fell in love the bot stood outside the fence ring, within 2.5 blocks of it (the stand ring of SPEC 8.2; the walk never crosses the pen)', firstLoveAt ? `${fmt(firstLoveAt.bot)}, ${ringDistance(firstLoveAt.bot, p.cowPen.box).toFixed(2)} outside` : 'no cow fell in love');
            check(insideA.length === 0, 'A5: the bot never stood inside the fence box of the cow pen (sampled every 250 ms)', `${insideA.length} samples inside`);
            check(gateOpenA.length === 0 && gateA === false, 'A6: the gate of the cow pen held `open=false` in every sample and is closed at the end (the pack never clicks a gate)', `open in ${gateOpenA.length} samples; now ${gateA === false ? 'closed' : gateA === true ? 'OPEN' : 'missing'}`);
            check(cmpA.same, 'A7: nothing was placed in or by the pen and the fence is whole (the pen box as built; a gate state alone would not count)', describeDifferences(cmpA.differences));
            check(wheatUsed === 4, 'A8: 4 wheat left the bag: two per pair, two pairs (SPEC 8.2, the feed)', `${wheatA} -> ${wheat()} (${wheatUsed} used)`);
            if (!infoA.done) note(`A: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });

            // ====================================================== B. the cap: 12 animals in the pen
            const cowsNow = await countEntities(penSelector(p.cowPen, g, 'cow'));
            const more = Math.max(0, PEN_CAP - cowsNow);
            if (more > 0) {
                const spots = p.cowPen.spots;
                const out = await commands(Array.from({ length: more }, (_, i) => summonLive('cow', spots[(5 + i) % spots.length], [TAG, COW_TAG, `${COW_TAG}_more`])));
                note(`B: ${out.flat().filter((l) => /Summoned new/.test(l)).length} cows more summoned (${cowsNow} were there)`);
            }
            const cowsB = await countEntities(penSelector(p.cowPen, g, 'cow'));
            check(cowsB === PEN_CAP, `B0: precondition: the cow pen holds ${PEN_CAP} animals (adults and calves)`, `${cowsB} cows`);
            const wheatB = wheat();
            const tB = Date.now();
            const infoB = await orders.orderInfo('!breed("cow_pen", 2)', 120000);
            const fullB = textOf(s, tB, new RegExp(`^${FULL_COWS(cowsB).replace(/[.;:]/g, '\\$&')}$`), infoB.reply);
            note(`B: !breed("cow_pen", 2) with ${cowsB} animals answered after ${(infoB.ms / 1000).toFixed(1)} s: ${JSON.stringify(String(infoB.reply).slice(0, 160))}; the bot said ${JSON.stringify(saidLines(s, tB).slice(0, 4))}; wheat ${wheatB} -> ${wheat()}`);
            check(infoB.done && fullB !== null, `B1: the full pen is refused with \`${FULL_COWS(cowsB)}\` (PEN_CAP 12, adults plus babies; SPEC 8.2)`, JSON.stringify(String(infoB.reply).slice(0, 160)));
            check(wheat() === wheatB, 'B2: no wheat was used at the full pen', `${wheatB} -> ${wheat()}`);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });

            // ====================================================== C. the pigs: carrots in a chest, the permit asked once
            await run([`item replace block ${P(h.chest)} container.1 with minecraft:carrot 16`], 'the carrots in the house chest');
            const chestC0 = await chestItems(h.chest);
            const viewed = await orders.orderInfo('!viewChest', 90000);
            note(`C0: the house chest ${cellText(h.chest)} holds ${JSON.stringify(chestC0)}; the typed !viewChest answered after ${(viewed.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(viewed.reply).slice(0, 200))}`);
            check(viewed.done && new RegExp(`The chest at \\(${h.chest.x}, ${h.chest.y}, ${h.chest.z}\\) contains: .*carrot 16`).test(String(viewed.reply)), 'C0: precondition: the bot knows the house chest with the 16 carrots (a typed !viewChest; the pack takes feed from the chests it knows)', JSON.stringify(String(viewed.reply).slice(0, 160)));
            check(countItem(agent, 'carrot') === 0 && readWorldFile(agent, 'permits.json').json?.items?.carrot?.allowed !== true, 'C0: precondition: no carrot in the bag and no permit for carrots yet', `carrots ${countItem(agent, 'carrot')}, permits.json ${JSON.stringify(readWorldFile(agent, 'permits.json').json ?? null)}`);
            await waitFor(() => !agent.actions.executing, { ms: 15000, every: 200 });
            // the fake model: the owner's "yes" after the question becomes the permit (SPEC 8.1: "the model maps the owner's 'yes, take it'")
            s.route(/^w_player: yes\b/, '!allowTaking("carrot", true)');
            const requestsC0 = s.chat.requests.length;
            const samplerC = penSampler(agent, p.pigPen, g, 'pig', PIG_TAG, 4);
            const tC = Date.now();
            const breedC = orders.orderInfo('!breed("pig_pen", 1)', 300000);
            const asked = await waitFor(() => saidLines(s, tC).find((l) => ASK_CARROT.test(l)) ?? null, { ms: 90000, every: 250 });
            note(`C1: the question ${asked.ok ? `came after ${(asked.ms / 1000).toFixed(1)} s` : 'did NOT come within 90 s'}: ${JSON.stringify(asked.value ?? saidLines(s, tC).slice(0, 4))}`);
            const tYes = Date.now();
            orders.say('yes');
            const allowed = await waitFor(() => saidLines(s, tYes).find((l) => l === ALLOWED_CARROT) ?? null, { ms: 30000, every: 250 });
            const took = await waitFor(() => saidLines(s, tYes).find((l) => TOOK_CARROT.test(l)) ?? null, { ms: 90000, every: 250 });
            const infoC = await breedC;
            await sleep(1500);
            const rowsC = await samplerC.stop();
            printTrace('C: !breed("pig_pen", 1)', rowsC, traceCols, 120);
            const saidC = saidLines(s, tC);
            const askLine = asked.value ?? null;
            const askAt = askLine ? ASK_CARROT.exec(askLine) : null;
            const tookAt = took.value ? TOOK_CARROT.exec(took.value) : null;
            const chestC = await chestItems(h.chest);
            const pigletsC = await countEntities(penSelector(p.pigPen, g, 'pig', `,tag=!${PIG_TAG}`));
            const pigletAge = pigletsC > 0 ? numberIn(await command(`data get entity ${penSelector(p.pigPen, g, 'pig', `,tag=!${PIG_TAG},limit=1`)} Age`)) : null;
            const endC = textOf(s, tC, new RegExp(`^${END_PIGS.replace(/[.;]/g, '\\$&')}$`), infoC.reply);
            const insideC = rowsC.filter((x) => x.bot && inBox(x.bot, p.pigPen.box));
            const gateOpenC = rowsC.filter((x) => !x.error && !x.gateClosed);
            const gateC = await isOpen(p.pigPen.gate, 'oak_fence_gate');
            const permits = readWorldFile(agent, 'permits.json');
            const requestsC = s.chat.requests.slice(requestsC0).map((q) => String(q?.turns?.[q.turns.length - 1]?.content ?? '').slice(0, 120));
            const chosen = s.sent.filter((x) => x.t >= tYes).map((x) => x.reply);
            const cmpC = await compareSnapshot(pigSnap);
            note(`C: !breed("pig_pen", 1) answered after ${(infoC.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(infoC.reply).slice(0, 200))}; the bot said ${JSON.stringify(saidC.slice(0, 12))}; the model got ${JSON.stringify(requestsC)} and answered ${JSON.stringify(chosen)}; the chest holds ${JSON.stringify(chestC)}; pigs in love ${JSON.stringify([...samplerC.lovers])}; ${pigletsC} piglets (Age ${pigletAge}); permits.json ${JSON.stringify(permits.json ?? permits.error)}`);
            check(asked.ok && Boolean(askAt) && Number(askAt[1]) === h.chest.x && Number(askAt[2]) === h.chest.y && Number(askAt[3]) === h.chest.z, 'C1: without a permit the bot asks `May I take 2 carrot from the chest at (x, y, z) for the feeding? Say yes or no.` naming the house chest (SPEC 8.1, the asking rule)', JSON.stringify(askLine ?? saidC.slice(0, 3)));
            if (askLine && /carrots from/.test(askLine)) note('C1: the question says "2 carrots" (plural); the spec writes the item name as it is ("8 wheat"): a wording to settle');
            check(chosen.includes('!allowTaking("carrot", true)') && allowed.ok, `C2: the owner's "yes" reaches the fake model, which answers \`!allowTaking("carrot", true)\`, and the bot says \`${ALLOWED_CARROT}\``, `answers ${JSON.stringify(chosen)}; said ${JSON.stringify(saidLines(s, tYes).slice(0, 4))}`);
            check(took.ok && Boolean(tookAt) && Number(tookAt[1]) === h.chest.x && Number(tookAt[3]) === h.chest.z && (chestC?.carrot ?? 0) === 14, 'C3: with the permit the bot takes the feed and says `I took 2 carrot from the chest at (x, y, z).`; the chest holds 14 carrots (server)', `${JSON.stringify(took.value ?? null)}; the chest ${JSON.stringify(chestC)}`);
            check(saidC.includes(PAIR_PIGS) && (samplerC.lovers.size >= 2 || (samplerC.lovers.size >= 1 && pigletsC >= 1)) && pigletsC >= 1 && pigletAge !== null && pigletAge < 0, `C4: the pigs are fed over the fence: \`${PAIR_PIGS}\`, two pigs in love (server), a piglet in the pen (Age negative)`, `pair line ${saidC.includes(PAIR_PIGS)}; in love ${JSON.stringify([...samplerC.lovers])}; piglets ${pigletsC} (Age ${pigletAge})`);
            check(infoC.done && endC !== null, `C4: the order ends with \`${END_PIGS}\``, JSON.stringify(String(infoC.reply).slice(0, 160)));
            check(permits.json?.items?.carrot?.allowed === true && Number(permits.json?.items?.carrot?.at) > 0, 'C5: permits.json of the world holds the permit for carrots (`{ items: { carrot: { allowed: true, at } } }`, SPEC 8.1)', JSON.stringify(permits.json ?? permits.error));
            check(insideC.length === 0 && gateOpenC.length === 0 && gateC === false && cmpC.same, 'C6: the bot never stood inside the pig pen, its gate stayed closed and the pen is as built', `${insideC.length} samples inside; gate open in ${gateOpenC.length} samples, now ${gateC === false ? 'closed' : 'OPEN or missing'}; ${describeDifferences(cmpC.differences)}`);
            if (!infoC.done) note(`C: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);

            const requestsAll = s.chat.requests.slice(requests0).map((q) => String(q?.turns?.[q.turns.length - 1]?.content ?? '').slice(0, 100));
            note(`the fake model got ${requestsAll.length} request(s) in all: ${JSON.stringify(requestsAll)}`);
            // the result of the model's !allowTaking: its line is said by the bot, the model gets the short answer of F2
            check(requestsAll.length <= 2 && requestsAll.every((t) => /^w_player: yes\b/.test(t) || /allowTaking|I may take|^Done; I said it in the chat\.$/.test(t)), 'zero model calls inside the pack: the only requests are the owner\'s "yes" and the result of the command the model chose (SPEC 8.0)', JSON.stringify(requestsAll));
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[tag=${TAG}]`, `kill @e[type=minecraft:cow,x=${ox - 60},y=${g - 2},z=${oz - 60},dx=120,dy=20,dz=120]`, `kill @e[type=minecraft:pig,x=${ox - 60},y=${g - 2},z=${oz - 60},dx=120,dy=20,dz=120]`, 'gamerule advance_time false', 'time set 6000']).catch(() => {});
            await dropSnapshot(cowSnap).catch(() => {});
            await dropSnapshot(pigSnap).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
