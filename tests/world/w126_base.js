// W126 the base (entry `survey_base`; v0.1.4.15 "The base survey and Routines", tester T3; PLAN.md section 4, SPEC sections 2 and
// 7.1): "here is the base, scan it". The bot finds every place of a base from the loaded blocks around it, saves them all at once with the source
// `survey`, reports in one line and takes the owner's corrections by name; the owner's own areas are never renamed, re-boxed or
// forgotten by a survey; the ladder through the trapdoor to the basement is proven on the server (PLAN 9); the survey never finds
// ore (the x-ray guard). Against a857593 (v0.1.4.14 plus the spec) the first survey answers `Command '!surveyBase' does not exist.`
// and parts A to E fail from there; on the release every check passes.
//
// The base world with nothing of base_world.js built: the control builds the small base of SPEC 7.1 (small_base.js) in the free
// space of the region (the offsets from the origin (ox, oz), g the grass at y 60): a house of housePlan (7 x 5 x 7, x -3..3, z -3..3,
// the oak door in the north wall at (0, g+1, -3), a red bed, a chest, a crafting table, 2 cats); in its floor an oak trapdoor at
// (1, g, 0) over a ladder of 6 (y g-6..g-1, facing south) down to a dug basement (air x -1..3, y g-6..g-4, z 0..4, stone floor at
// g-7) with a chest, a furnace and a torch; from the basement's east wall a tunnel of 12 into the rock (x 4..15, 2 wide z 1..2, 2
// high) and in its west wall an opening (x -3..-2, z 2) into a dark cave of 5 x 5 x 4 (x -8..-4, y g-6..g-3, z 0..4); an unfenced
// potato field 9 x 5 north of the house (x -4..4, z -15..-11, 44 ripe potatoes and a water cell); a fenced pen 9 x 9 east of the
// house (x 8..16, z -4..4) with 5 cows and a roof of oak planks at g+4; a fenced pen 9 x 9 (x 8..16, z 8..16) with 4 pigs; a lectern
// and a composter west of the house (x -9) with 3 villagers (2 librarians, 1 farmer; `summon villager` with VillagerData); a row of
// 12 sugar cane (x -6..5, z 8) by a pool (x -6..5, z 9..10); a happy ghast leashed to a lone fence post (x 22, z -14) when `summon`
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
//
// v0.1.4.16 (tester T3; SPEC 7 "W126 A1", F2): the report line is the bot's own. A1 reads the report from the said lines
// (saidLines) and demands the typed command's reply `Done; I said it in the chat.` (on 9a28d07 the reply is the report itself: A1
// fails there). The lines of B1 (!renameArea), B2 (!forgetArea), B3 and C2 (the surveys again) are read from the said lines, or
// from the reply where the code still answers with the text, so those checks hold before and after the fix. The builder of the
// small base moved to small_base.js, so that W128 and W129 build the same base without running this file.
import crypto from 'node:crypto';
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, placeBot,
    readWorldFile, routesInFile, serverSleeping, recordMoves, startTrace, printTrace,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, hdist } from './world.js';
import { BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, freePort } from './journey.js';
import { Supervisor } from './supervisor.js';
import { smallBasePlan, buildSmallBase, verifySmallBase, TAG, cellText } from './small_base.js';

const NAME = 'w_base';
const SUPERVISOR = 'Opus';
const BASE = 'east';
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const SURVEY_MS = 60000;
/** v0.1.4.16 (F2): the short answer of the say-commands (!surveyBase, !renameArea, !forgetArea, !goToBase) to the model and to a typed order. */
const DONE_SAID = 'Done; I said it in the chat.';

// ---- SPEC 2.5, the texts
const REPORT_HEAD = /^I found (\d+) places?: /;
// SPEC 2.2: with a tied animal the report says "never untie, never break that post" once; the survey puts the sentence after the tail
const REPORT_TAIL = /\. All saved\. Say "rename X to Y" or "forget X" to correct\.( Never untie, never break that post\.)?$/;
const AGAIN_PIG_PEN = /^I surveyed "east" again: the pig pen is new\. The rest as saved\.$/;
const RENAMED = /^I renamed "potato_farm" to "spuds"\.$/;
const FORGOT_PIG_PEN = /^Forgot the area "pig_pen"\.$/;
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

// The items of a report line, split at the commas outside parentheses (the sentences after `All saved.` left out).
function splitItems(text) {
    const m = REPORT_HEAD.exec(text);
    if (!m) return [];
    let body = text.slice(m[0].length);
    const tail = body.indexOf('. All saved.');
    body = tail >= 0 ? body.slice(0, tail) : body.replace(REPORT_TAIL, '');
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

// v0.1.4.16 (F2): the text of a say-command: the first said line since t that matches re, else the reply (the code of 9a28d07 answers
// with the text). { text, said } where said tells where it came from.
function textOf(s, t, re, reply) {
    const line = saidLines(s, t).find((l) => re.test(l)) ?? null;
    if (line !== null) return { text: line, said: true };
    return { text: String(reply ?? ''), said: false };
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
            // v0.1.4.16 (F2, W126 A1): the report is the bot's own line (said), the reply the short answer
            const saidA = saidLines(s, tA).find((l) => REPORT_HEAD.test(l)) ?? null;
            const replyA = saidA ?? String(one.reply);
            replies.push(replyA);
            const items = splitItems(replyA);
            const head = REPORT_HEAD.exec(replyA);
            note(`A1: !surveyBase("east") answered after ${(one.ms / 1000).toFixed(1)} s: ${JSON.stringify(String(one.reply))}; the report ${saidA ? 'was said by the bot' : 'was NOT among the said lines (the reply is read instead)'}: ${JSON.stringify(replyA)}`);
            note(`A1: the items of the report (${items.length}, ${expectedItems} expected): ${JSON.stringify(items)}; the bot said ${JSON.stringify(saidLines(s, tA).slice(0, 6))}`);
            check(one.done && one.ms <= SURVEY_MS && saidA !== null && REPORT_TAIL.test(saidA), 'A1: within 60 s the bot itself says one report line `I found N places: ... All saved. Say "rename X to Y" or "forget X" to correct.` (SPEC 2.5 of v0.1.4.15; F2 of v0.1.4.16: the line is in the said lines, not only the command\'s answer)', `${(one.ms / 1000).toFixed(1)} s: said ${JSON.stringify(saidA?.slice(0, 200) ?? null)}`);
            check(one.done && String(one.reply) === DONE_SAID, `A1: the typed command answers \`${DONE_SAID}\` (F2: the report is the bot's own, the command's answer one short line)`, JSON.stringify(String(one.reply).slice(0, 200)));
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
            const tB1 = Date.now();
            const renamedReply = await orders.order('!renameArea("potato_farm", "spuds")', 30000);
            const renamed = textOf(s, tB1, RENAMED, renamedReply);
            const spuds = area('spuds');
            note(`B1: !renameArea("potato_farm", "spuds") answered ${JSON.stringify(renamedReply)}; the line ${renamed.said ? 'was said by the bot' : 'is the reply'}: ${JSON.stringify(renamed.text)}; spuds ${areaText(spuds)}; potato_farm ${areaText(area('potato_farm'))}`);
            check(RENAMED.test(renamed.text), 'B1: `I renamed "potato_farm" to "spuds".` (said by the bot, or the answer)', JSON.stringify(renamed.text));
            check(Boolean(spuds) && !area('potato_farm') && (!farmBefore || sameBox(spuds, farmBefore)), 'B1: the area is "spuds" now with the same box, and "potato_farm" is gone', `spuds ${areaText(spuds)}; potato_farm ${area('potato_farm') ? 'STILL there' : 'gone'}`);
            const tB2 = Date.now();
            const forgotReply = await orders.order('!forgetArea("pig_pen")', 30000);
            const forgot = textOf(s, tB2, FORGOT_PIG_PEN, forgotReply);
            note(`B2: !forgetArea("pig_pen") answered ${JSON.stringify(forgotReply)}; the line ${forgot.said ? 'was said by the bot' : 'is the reply'}: ${JSON.stringify(forgot.text)}; pig_pen ${areaText(area('pig_pen'))}`);
            check(!area('pig_pen') && !(areasFile()?.pig_pen), 'B2: !forgetArea("pig_pen") forgets the pen (the area is gone from the store and the file)', JSON.stringify(forgot.text));
            const tB3 = Date.now();
            const two = await orders.orderInfo(`!surveyBase("${BASE}")`, SURVEY_MS + 30000);
            const againB = textOf(s, tB3, /^I surveyed "east" again:/, two.reply);
            const replyB = againB.text;
            replies.push(replyB);
            const pigAgain = area('pig_pen');
            note(`B3: the second !surveyBase("east") answered after ${(two.ms / 1000).toFixed(1)} s: ${JSON.stringify(String(two.reply))}; the line ${againB.said ? 'was said by the bot' : 'is the reply'}: ${JSON.stringify(replyB)}; pig_pen ${areaText(pigAgain)}; the areas ${JSON.stringify(areas().map((a) => a.name))}`);
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
            const tC = Date.now();
            const three = await orders.orderInfo(`!surveyBase("${BASE}")`, SURVEY_MS + 30000);
            const againC = textOf(s, tC, /^I surveyed "east" again:/, three.reply);
            const replyC = againC.text;
            replies.push(replyC);
            const wheatAfter = area('wheat_farm');
            const surveyFarmsOverField = areas().filter((a) => a.source === 'survey' && a.type === 'farm' && overlaps(a, p.field.box));
            note(`C2: the third !surveyBase("east") answered after ${(three.ms / 1000).toFixed(1)} s: ${JSON.stringify(String(three.reply))}; the line ${againC.said ? 'was said by the bot' : 'is the reply'}: ${JSON.stringify(replyC)}; wheat_farm ${areaText(wheatAfter)}; survey farms over the field ${JSON.stringify(surveyFarmsOverField.map(areaText))}`);
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
