// W129 the base by the village (entry `the_base_by_the_village`; v0.1.4.16 "Stability, and three packs", tester T3; PLAN.md section 4
// F2 and F6, section 7; SPEC section 3 F2 and F6, section 7): a village near the base is not the base, the base's centre and door are
// the house's, the report line is the bot's own, village houses are no shelter and their beds are not the bot's. Findings R-2 to R-4
// (the base "base" had a village's centre and door, the report reached the owner as the model's summary, village houses were saved as
// `home`) and R-8 (`!goToBed` near the trading hall chose villager beds). Against 9a28d07 (v0.1.4.15) the survey saves the village
// houses as homes, the centre moves south, the model gets the report instead of the bot saying it, `!forgetArea` leaves the name in
// the base's list, bases.json has no `kept`, and `!goToBed` by the village sleeps in a villager's bed; on the release every check
// passes.
//
// The base world with the small base of W126 (small_base.js) and a village 84 blocks south of the house: three houses of housePlan in
// a row (x -11..-5, -3..3, 5..11; the doors in their north walls at z 84), each with a bed, a chest and a lectern, a librarian (NoAI)
// in the middle one. The village lies within the 6 chunks of the server's view distance (the bot sees 95 blocks south of its
// start; the plan's "100 blocks" would be out of its view), and more than the cluster gap of 48 from the nearest find of the base
// (the pig pen ends at z 16, the cane at z 10). The owner's switches (SUPERVISION_SETTINGS) with base_survey and survey_radius 128,
// the modes of his profile, an empty memory. The bot stands outside the house door, the player beside it. Console names of 26.1.
//   1. The owner saves `wheat_farm` by hand over more than half of the potato field (as W126 C), before the survey.
//   2. The owner says "here is the base, scan it"; the fake model answers `!surveyBase("east")`, and answers the command's result with
//      a summary line of its own ("The base is scanned."). Within 100 s: 2a the bot itself says the report line (`I found N places: ...
//      All saved. ... Say "rename X to Y" or "forget X" to correct.`); 2b the report holds, after `All saved.`, the sentence `I left out
//      3 places about D blocks south (another base or a village): not saved; survey it from there for its own name` with D the distance
//      to the village rounded to 10 (80 to 100 here); 2c the model got the short answer `Done; I said it in the chat.` as the
//      command's result, not the report; 2d the report names one house (`house (1 bed)`) and no second one.
//   3. The files: bases.json "east" has the house's door, a centre within 10 blocks of the house, `kept` with `wheat_farm`; areas.json
//      has exactly one area of kind home (the house) and no area in the village (z over oz+50); every name of the base's `places`
//      is a saved area or place.
//   4. Typed `!forgetArea("pig_pen")`: the pen is gone from areas.json and from the base's `places`.
//   5. The bot walks to the village by itself (typed !goToCoordinates, 90 blocks south, 6 blocks north of the middle house); `time set
//      13000`; typed `!goToBed`: the answer (or the said line) is `The beds nearby are the villagers'; I found no bed of mine.` and the
//      bot never lies in a bed (server, sampled every 500 ms): the village beds stand within 8 blocks of a lectern and of a villager,
//      the house's bed 90 blocks north is out of reach, and the bot has no bed of its own (it never slept).
// Throughout: the process lives, no request reached a real model.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, readWorldFile, serverSleeping,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, housePlan, buildHouse, blockNames, hdist } from './world.js';
import { BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER, countEntities } from './journey.js';
import { smallBasePlan, buildSmallBase, verifySmallBase, TAG, run, summon, cellText } from './small_base.js';

const NAME = 'w_village';
const BASE = 'east';
const VILLAGE_DZ = 84; // the north walls of the village houses, south of the origin
const DONE_SAID = 'Done; I said it in the chat.';
const VILLAGERS_BEDS = "The beds nearby are the villagers'; I found no bed of mine.";
const SUMMARY = 'The base is scanned.';
const REPORT_HEAD = /^I found (\d+) places?: /;
const ALL_SAVED = /\. All saved\./;
const TAIL = /Say "rename X to Y" or "forget X" to correct\./;
// SPEC F2 (the lead's correction of 2026-11-12): `I left out 2 places about 100 blocks south (another base or a village): not saved; survey it from there for its own name.`
const LEFT_OUT = /I left out (\d+) places? about (\d+) blocks (north|south|east|west|north-east|north-west|south-east|south-west) \(another base or a village\): not saved; survey it from there for its own name\./;
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const holds = (area, c) => Boolean(area?.min && area?.max) && inBox({ x: c.x + 0.5, y: c.y, z: c.z + 0.5 }, area);
const areaText = (a) => (a ? `${a.name} (type ${a.type}, kind ${a.kind}, source ${a.source ?? '-'}, base ${a.base ?? '-'}) ${cellText(a.min)} to ${cellText(a.max)}` : 'none');
const lastTurn = (q) => String(q?.turns?.[q.turns.length - 1]?.content ?? '');

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const p = smallBasePlan(r);
        const { ox, oz, g } = p;
        const h = p.house;
        const built = await buildSmallBase(p);
        const verified = await verifySmallBase(p, built);
        for (const l of verified.lines) note(`build: ${l}`);
        check(verified.ok, 'precondition: the small base of W126 is built as planned (every part read back from the server)', verified.lines.filter((l) => l.startsWith('WRONG')).join('; ') || 'all ok');
        // the village: a second prepared patch 84 blocks south, three houses with a bed, a chest and a lectern each, one librarian
        const vz = oz + VILLAGE_DZ;
        const village = { ox, oz: vz + 3, g, radius: 16 };
        await prepareRegion(village, 24);
        const houses = [ox - 11, ox - 3, ox + 5].map((x) => housePlan(x, vz, g));
        for (const vh of houses) await buildHouse(vh);
        const lecterns = houses.map((vh) => ({ x: vh.box.min.x + 5, y: g + 1, z: vz + 2 }));
        await run(lecterns.map((l) => `setblock ${P(l)} minecraft:lectern[facing=west]`), 'the lecterns of the village');
        const villagerAt = { x: houses[1].box.min.x + 3, y: g + 1, z: vz + 3 };
        await run([summon('villager', villagerAt, [TAG, `${TAG}_village`], 'VillagerData:{profession:"minecraft:librarian",level:1,type:"minecraft:plains"}')], 'the villager');
        const beds = houses.map((vh) => vh.bedHead);
        const bedNames = await blockNames(beds, ['red_bed[part=head]']);
        const lecternNames = await blockNames(lecterns, ['lectern']);
        const villagers = await countEntities(`@e[type=minecraft:villager,tag=${TAG}_village]`);
        note(`build: the village ${VILLAGE_DZ} blocks south: beds ${JSON.stringify(bedNames)}, lecterns ${JSON.stringify(lecternNames)}, ${villagers} villager in the middle house at ${cellText(villagerAt)}; the houses from ${cellText(houses[0].box.min)} to ${cellText(houses[2].box.max)}`);
        check(bedNames.every(Boolean) && lecternNames.every(Boolean) && villagers === 1, 'precondition: the village has three houses with a bed and a lectern each and one villager', `beds ${bedNames.filter(Boolean).length}, lecterns ${lecternNames.filter(Boolean).length}, villagers ${villagers}`);
        const villageDistance = Math.hypot(0, vz - h.outsideDoor.z); // from the start to the nearest house wall
        let agent = null, orders = null, s = null;
        try {
            const j = await startJourney(NAME, null, {
                botAt: h.outsideDoor, botYaw: 0, playerAt: { x: h.outsideDoor.x + 2, y: g + 1, z: h.outsideDoor.z }, kit: [],
                settings: SUPERVISION_SETTINGS({ base_survey: true, survey_radius: 128 }),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            const areas = () => agent.area_store?.list?.() ?? [];
            const areasFile = () => readWorldFile(agent, 'areas.json').json?.areas ?? null;
            const placesFile = () => readWorldFile(agent, 'places.json').json?.places ?? null;
            const basesFile = () => readWorldFile(agent, 'bases.json').json?.bases ?? null;
            // the fake model: the owner's words become the survey, and the command's result gets a summary of the model's own
            s.route(/here is the base, scan it/, `!surveyBase("${BASE}")`);
            s.route(/I found \d+ places?:|Done; I said it in the chat\./, SUMMARY);

            // ====================================================== 1. the owner's wheat_farm
            const o = p.field.ownerHalf;
            const setArea = await orders.order(`!setArea("wheat_farm", "farm", ${o.min.x}, ${o.min.y}, ${o.min.z}, ${o.max.x}, ${o.max.y}, ${o.max.z})`, 30000);
            note(`1: !setArea("wheat_farm", "farm", ...) over ${cellText(o.min)} to ${cellText(o.max)} answered ${JSON.stringify(setArea.slice(0, 160))}`);
            check(/^Area "wheat_farm" \(farm\) saved:/.test(setArea), '1: precondition: the owner saved "wheat_farm" by hand over more than half of the potato field', JSON.stringify(setArea.slice(0, 120)));

            // ====================================================== 2. "here is the base, scan it" through the model
            const t2 = Date.now();
            const requests0 = s.chat.requests.length;
            orders.say('here is the base, scan it');
            const reportSaid = await waitFor(() => saidLines(s, t2).find((l) => REPORT_HEAD.test(l)) ?? null, { ms: 100000, every: 500 });
            // the model's answer to the result comes a moment later
            await waitFor(() => s.chat.requests.length - requests0 >= 2, { ms: 20000, every: 250 });
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            const report = reportSaid.value ?? null;
            const said2 = saidLines(s, t2);
            const requests2 = s.chat.requests.slice(requests0);
            const resultTurns = requests2.map(lastTurn).filter((t) => !/here is the base/.test(t));
            const gotDone = resultTurns.some((t) => t.includes(DONE_SAID));
            // the report may stand in the history as the bot's own (assistant) line: that is F2's point; it must not be the
            // command's result (a system or user turn)
            const resultOnly = requests2.map((q) => q?.turns?.[q.turns.length - 1]).filter((t) => t && t.role !== 'assistant')
                .map((t) => String(t.content ?? '')).filter((t) => !/here is the base/.test(t));
            const gotReport = resultOnly.some((t) => REPORT_HEAD.test(t.replace(/^[^:]*:\s*/, '')) || /I found \d+ places?:/.test(t));
            const left = report ? LEFT_OUT.exec(report) : null;
            const leftAfterSaved = Boolean(report && left) && report.indexOf(left[0]) > report.indexOf('All saved.');
            const houseItems = report ? (report.match(/\bhouse(?:_\d+| \d+)? \([^)]*\)/g) ?? []) : [];
            note(`2: ${(reportSaid.ms / 1000).toFixed(1)} s after the owner's words the report ${report ? 'was said by the bot' : 'was NOT said within 100 s'}: ${JSON.stringify(report)}; the model got ${requests2.length} request(s), the last turns ${JSON.stringify(resultTurns.map((t) => t.slice(0, 160)))}; the bot said ${JSON.stringify(said2.slice(0, 8))}`);
            check(report !== null && ALL_SAVED.test(report) && TAIL.test(report), '2a: the bot itself says the report line `I found N places: ... All saved. ... Say "rename X to Y" or "forget X" to correct.` (F2: the report is the bot\'s own line, not the model\'s summary)', JSON.stringify(report?.slice(0, 200) ?? said2.slice(0, 3)));
            check(Boolean(left) && leftAfterSaved && Number(left[1]) === 3 && Number(left[2]) >= 80 && Number(left[2]) <= 100 && /^south/.test(left[3]), `2b: after \`All saved.\` the report says \`I left out 3 places about D blocks south (another base or a village): not saved; survey it from there for its own name.\` with D about ${Math.round(villageDistance / 10) * 10} (the village: 3 houses, more than 48 blocks from the base's finds)`, left ? `${JSON.stringify(left[0])}, after "All saved.": ${leftAfterSaved}` : 'no such sentence');
            check(gotDone && !gotReport, `2c: the model got the command's short answer \`${DONE_SAID}\` as the result, not the report`, JSON.stringify(resultTurns.map((t) => t.slice(0, 120))));
            check(houseItems.length === 1 && /^house \(1 bed/.test(houseItems[0]), '2d: the report names one house (`house (1 bed)`) and no second one: the village houses are not the base\'s', JSON.stringify(houseItems));

            // ====================================================== 3. the files
            const af = areasFile();
            const list = areas();
            const bf = basesFile();
            const east = bf?.[BASE] ?? null;
            const pf = placesFile();
            const homes = list.filter((a) => a.kind === 'home');
            const inVillage = list.filter((a) => a.min && a.min.z > oz + 50);
            const saved = new Set([...Object.keys(af ?? {}), ...list.map((a) => a.name), ...Object.keys(pf ?? {})]);
            const unsaved = (east?.places ?? []).filter((n) => !saved.has(n));
            const centre = east?.centre ?? east?.center ?? null;
            note(`3: bases.json ${bf ? JSON.stringify(bf) : 'is MISSING'}; areas ${JSON.stringify(list.map(areaText))}; places ${JSON.stringify(Object.keys(pf ?? {}))}`);
            check(Boolean(east) && east.door && Math.floor(east.door.x) === h.door.x && Math.floor(east.door.z) === h.door.z && Math.abs(Math.floor(east.door.y) - h.door.y) <= 1, '3a: bases.json "east" has the house\'s door (the house with the bed, nearest the start)', `${JSON.stringify(east?.door ?? null)}; the door ${cellText(h.door)}`);
            check(Boolean(centre) && hdist(centre, h.inside) <= 10, '3b: the base\'s centre lies within 10 blocks of the house (the village is no part of the average)', `${JSON.stringify(centre)}; the house ${cellText(h.inside)}`);
            check(Array.isArray(east?.kept) && east.kept.includes('wheat_farm'), '3c: bases.json "east" lists the owner\'s "wheat_farm" in `kept` (your own areas around the start join the base)', JSON.stringify(east?.kept ?? null));
            check(homes.length === 1 && holds(homes[0], h.inside), '3d: areas.json holds exactly one area of kind home, the house', JSON.stringify(homes.map(areaText)));
            check(inVillage.length === 0, '3e: no area of the village was saved (another cluster: reported, not saved)', JSON.stringify(inVillage.map(areaText)));
            check(Boolean(east) && east.places.length > 0 && unsaved.length === 0, '3f: every name of the base\'s `places` is a saved area or place (only saved names are listed)', `unsaved ${JSON.stringify(unsaved)} of ${JSON.stringify(east?.places ?? null)}`);

            // ====================================================== 4. forgetting a survey place
            const t4 = Date.now();
            const forgotReply = await orders.order('!forgetArea("pig_pen")', 30000);
            const east4 = basesFile()?.[BASE] ?? null;
            note(`4: !forgetArea("pig_pen") answered ${JSON.stringify(forgotReply)}; the bot said ${JSON.stringify(saidLines(s, t4).slice(0, 3))}; the base's places now ${JSON.stringify(east4?.places ?? null)}`);
            check(!areas().some((a) => a.name === 'pig_pen') && !(areasFile()?.pig_pen), '4a: the pig pen is gone from the areas', JSON.stringify(forgotReply));
            check(Boolean(east4) && !east4.places.includes('pig_pen'), '4b: !forgetArea removes the place from its base: "pig_pen" left the base\'s `places`', JSON.stringify(east4?.places ?? null));

            // ====================================================== 5. !goToBed by the village: no villager's bed
            const byVillage = { x: ox, y: g + 1, z: vz - 6 };
            const walk = await orders.orderInfo(`!goToCoordinates(${byVillage.x}, ${byVillage.y}, ${byVillage.z}, 2)`, 150000);
            const at5 = await entityPos(NAME);
            const there = Boolean(at5) && hdist(at5, { x: byVillage.x + 0.5, z: byVillage.z + 0.5 }) <= 4;
            note(`5: the walk to the village (${cellText(byVillage)}) answered after ${(walk.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(walk.reply).slice(0, 160))}; the bot at ${fmt(at5)} (${there ? 'there' : 'NOT there'})`);
            check(there, '5: precondition: the bot walked to the village by itself (6 blocks north of the middle house)', fmt(at5));
            if (!there && agent.actions.executing) note(`5: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await commands(['gamerule advance_time false', 'time set 13000']);
            await sleep(1500);
            const t5 = Date.now();
            let slept = 0;
            const sampler = (async () => {
                while (Date.now() - t5 < 95000) {
                    if (await serverSleeping(NAME)) slept++;
                    await sleep(500);
                }
            })();
            const bed = await orders.orderInfo('!goToBed', 90000);
            const bedSaid = saidLines(s, t5).find((l) => l === VILLAGERS_BEDS) ?? null;
            const sleepingNow = await serverSleeping(NAME);
            const at5b = await entityPos(NAME);
            const inHouse = houses.some((vh) => inBox(at5b, vh.interior));
            note(`5: !goToBed at night by the village answered after ${(bed.ms / 1000).toFixed(0)} s: ${JSON.stringify(String(bed.reply).slice(0, 160))}; the line ${bedSaid ? 'was said by the bot' : 'is not among the said lines'}; sleeping now ${sleepingNow}, ${slept} samples asleep so far; the bot at ${fmt(at5b)}${inHouse ? ' (inside a village house)' : ''}; the bot said ${JSON.stringify(saidLines(s, t5).slice(0, 6))}`);
            check(bed.done && (String(bed.reply) === VILLAGERS_BEDS || bedSaid !== null), `5a: \`${VILLAGERS_BEDS}\` (F6: every bed within 32 blocks is a villager's: within 8 blocks of a lectern and of a villager; no own bed, the house's bed 90 blocks away)`, JSON.stringify(String(bed.reply).slice(0, 160)));
            check(!sleepingNow && slept === 0, '5b: the bot never lay in a villager\'s bed (server, sampled every 500 ms)', `sleeping now ${sleepingNow}, ${slept} samples asleep`);
            if (sleepingNow || agent.actions.executing) note(`5: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await commands(['time set 6000']);
            await sampler;

            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[tag=${TAG}]`, 'gamerule advance_time false', 'time set 6000']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(village).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
