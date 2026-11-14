// W128 creepers below (entry `creepers_below`; v0.1.4.16 "Stability, and three packs", tester T3; PLAN.md section 4 F1 and 7, SPEC
// section 3 F1 and 7): the creeper reflex counts a creeper only with a line of sight, within 16 blocks and within 3 blocks of the
// bot's level, and it never flees downhill or into a hole. Finding R-1 and Q-2 of the plays: `creeper_safety` fled from creepers in
// caves 12 blocks below, through rock, looped "A creeper keeps following me" and once led the bot into a cave. Against 9a28d07
// (v0.1.4.15) part A fails (the reflex runs for the creepers under the rock: the walk is interrupted, a creeper line is said) and
// part B fails (the flee target lies in the hollow 4 blocks lower: the bot drops into it); on the release every check passes.
//
// The base world with the small base of W126 (small_base.js): the house, the basement under it, the trading hall west of the house
// (x -9), the pens, the field, the cane. The owner saves his home by hand as his real "home" is saved (two floors, the house and the
// basement in one box, y g-9 to g+4: his area "home" spans y 55 to 71, four blocks under his basement floor); without a box that
// reaches within 3 blocks of the creepers' height the reflex of v0.1.4.15 would not even look at them, so the proof of F1 (the sight
// rule, not the height rule) needs that box. A cave 9 x 3 x 9 is carved 12 blocks under the trading hall (air y g-11..g-9, floor at
// g-12), closed on every side. The owner's switches (SUPERVISION_SETTINGS), the modes of his profile, an empty memory, difficulty
// normal (peaceful removes creepers at once). The bot is never moved by the control after the start. Console names of 26.1.
//   A. Three creepers that stand (NoAI) are summoned in the cave, 12 blocks under the hall. The bot stands north-west of the house
//      and walks past the hall at the surface (typed !goToCoordinates, 20 blocks west, closeness 1): A1 the walk ends within 60 s at
//      its goal (server); A2 the mode creeper_safety never ran and no line about a creeper was said (no "A creeper keeps following
//      me", no "A creeper stands near"); A3 the bot's feet never went below the grass (no flee into the basement or the cave). The
//      creepers are killed after A.
//   B. A hollow 4 deep (x 48..92, z -36..-8, the floor at g-4) lies north of a spot 70 blocks east of the house, more than 48 blocks
//      from every area (an area within 48 turns the flee away from it and could steer it past the hollow). The bot walks there
//      (typed). One creeper with its AI is summoned 8 blocks south of it, in sight at its level:
//      B1 the mode creeper_safety runs within 10 s; B2 the reflex ends with one of its texts (`I backed off from a creeper.`, the
//      lured text or the 90 s text); B3 the bot's feet never go below its start minus 1 (the flee target north would be the hollow:
//      v0.1.4.15 walks to the x/z of the target whatever the ground and drops 4 blocks); B4 the bot lives. The creeper is killed
//      once the reflex ran and 15 s passed, at the latest after 45 s.
//   C. The help line `A creeper keeps following me near the base. I stay away from the buildings. Can you help?` is said at most
//      once in any 120 s of the scenario (F1: once per 120 s, not per run).
// Throughout: the process lives, no request reached a real model. The runner runs this scenario up to 3 times (B depends on a
// monster's walk); 2 must pass.
import {
    scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, command, waitFor, startTrace, printTrace,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, dist, entityNumber, hdist } from './world.js';
import { BASE_RADIUS } from './base_world.js';
import { startJourney, saidLines, SUPERVISION_SETTINGS, PLAYER, countEntities } from './journey.js';
import { smallBasePlan, buildSmallBase, verifySmallBase, TAG, run, cellText } from './small_base.js';

const NAME = 'w_below';
const CREEPER_TAG = `${TAG}_below`;
const HELP = 'A creeper keeps following me near the base. I stay away from the buildings. Can you help?';
const REFLEX_TEXTS = /^(I backed off from a creeper\.|I led a creeper away from "[^"]+" and lost it\.|A creeper is still near me after 90 seconds\. I keep away from it and from the buildings\.|I fought a creeper and it is gone\.)$/;
const P = (p) => `${p.x} ${p.y} ${p.z}`;
const MODE = 'mode:creeper_safety';

// The help line at most once in any window of 120 s: the largest count of HELP lines (chat and behaviour log) within 120 s.
function helpWindows(said) {
    const times = said.filter((x) => x.text === HELP || x.text === `[behaviour] ${HELP}`).map((x) => x.t).sort((a, b) => a - b);
    let worst = 0;
    for (let i = 0; i < times.length; i++) {
        let n = 0;
        for (let k = i; k < times.length && times[k] - times[i] < 120000; k++) n++;
        worst = Math.max(worst, n);
    }
    return { count: times.length, worst };
}

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
        // the cave 12 blocks under the trading hall: air y g-11..g-9 (the creepers' feet at g-11), the floor at g-12; closed all round
        const cave = { min: { x: ox - 14, y: g - 11, z: oz - 4 }, max: { x: ox - 6, y: g - 9, z: oz + 4 } };
        await run([`fill ${P(cave.min)} ${P(cave.max)} minecraft:air`], 'the cave under the hall');
        // the spot of B, 70 blocks east (more than 48 from every area), on a patch of its own; the hollow of B north of it: 4 deep, the
        // floor at g-4 (stone), wide enough for a flee of 32 blocks within 40 degrees of north
        const spotB = { x: ox + 70, y: g + 1, z: oz };
        const patchB = { ox: spotB.x, oz: spotB.z, g, radius: 40 };
        await prepareRegion(patchB, 30);
        const hollow = { min: { x: spotB.x - 22, y: g - 3, z: oz - 36 }, max: { x: spotB.x + 22, y: g, z: oz - 8 } };
        await run([`fill ${P(hollow.min)} ${P(hollow.max)} minecraft:air`], 'the hollow');
        const creeperAt = [{ x: ox - 10, y: g - 11, z: oz - 2 }, { x: ox - 10, y: g - 11, z: oz + 2 }, { x: ox - 8, y: g - 11, z: oz }];
        const startA = { x: ox - 1, y: g + 1, z: oz - 6 };
        const goalA = { x: ox - 21, y: g + 1, z: oz - 5 };
        const creeperB = { x: spotB.x, y: g + 1, z: oz + 8 };
        const sel = `@e[type=minecraft:creeper,tag=${CREEPER_TAG}]`;
        let agent = null, orders = null, s = null;
        try {
            const j = await startJourney(NAME, null, {
                botAt: startA, botYaw: 90, playerAt: { x: startA.x + 2, y: g + 1, z: startA.z - 2 }, kit: [],
                settings: SUPERVISION_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            s = j.s;
            const t0 = Date.now();
            let deaths = 0;
            agent.bot.on('death', () => { deaths++; });
            // the owner's home, two floors as his: the house and the basement in one box
            const homeBox = { min: { x: h.box.min.x, y: g - 9, z: h.box.min.z }, max: { x: h.box.max.x, y: g + 4, z: h.box.max.z } };
            const saved = await orders.order(`!setArea("home", "home", ${homeBox.min.x}, ${homeBox.min.y}, ${homeBox.min.z}, ${homeBox.max.x}, ${homeBox.max.y}, ${homeBox.max.z})`, 30000);
            note(`0: the owner saved his home over both floors (${cellText(homeBox.min)} to ${cellText(homeBox.max)}): ${JSON.stringify(saved.slice(0, 200))}`);
            check(/^Area "home" \(home\) saved:/.test(saved), 'precondition: the owner\'s area "home" spans the house and the basement (as his real one spans two floors)', JSON.stringify(saved.slice(0, 160)));
            await commands(['difficulty normal', `gamemode survival ${NAME}`]);

            // ====================================================== A. creepers 12 blocks under the trading hall
            const summonedA = await commands(creeperAt.map((c) => `summon minecraft:creeper ${c.x + 0.5} ${c.y} ${c.z + 0.5} {NoAI:1b,PersistenceRequired:1b,Tags:["${TAG}","${CREEPER_TAG}"]}`));
            await sleep(500);
            const nA = await countEntities(sel);
            note(`A0: ${nA} creepers stand in the cave 12 blocks under the hall at ${creeperAt.map(cellText).join(', ')} (the hall at ${cellText(p.hall.lectern)}): ${summonedA.flat().join(' | ').slice(0, 200)}`);
            check(nA === 3, 'A0: precondition: three creepers stand in the cave under the trading hall (difficulty normal)', `${nA} creepers`);
            const at0 = await entityPos(NAME);
            const traceA = startTrace(async () => ({ bot: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 250);
            const tA = Date.now();
            const walk = await orders.orderInfo(`!goToCoordinates(${goalA.x}, ${goalA.y}, ${goalA.z}, 1)`, 60000);
            const endA = await entityPos(NAME);
            const rowsA = await traceA.stop();
            const arrivedA = Boolean(endA) && hdist(endA, { x: goalA.x + 0.5, z: goalA.z + 0.5 }) <= 2 && Math.abs(endA.y - goalA.y) <= 1;
            const modeRanA = rowsA.filter((x) => String(x.action).startsWith(MODE));
            const saidA = saidLines(s, tA);
            const creeperLinesA = saidA.filter((l) => /creeper/i.test(l));
            const lowestA = Math.min(...rowsA.filter((x) => x.bot).map((x) => x.bot.y));
            printTrace('A: the walk past the hall with creepers 12 blocks below', rowsA, { bot: (x) => fmt(x.bot), action: (x) => x.action }, 60);
            note(`A: from ${fmt(at0)} to ${cellText(goalA)}: the walk ${walk.done ? `ended after ${(walk.ms / 1000).toFixed(1)} s` : 'did NOT end within 60 s'} with ${JSON.stringify(String(walk.reply).slice(0, 160))}; the bot at ${fmt(endA)} (${arrivedA ? 'arrived' : 'NOT at the goal'}); the mode ran in ${modeRanA.length} samples; the lowest feet y ${lowestA.toFixed(2)}; the bot said ${JSON.stringify(saidA.slice(0, 8))}`);
            check(walk.done && arrivedA, 'A1: the walk past the trading hall at the surface ends within 60 s at its goal (the creepers 12 blocks below through rock do not count: F1, no line of sight)', `${walk.done ? (walk.ms / 1000).toFixed(1) + ' s' : 'not ended'}, the bot at ${fmt(endA)}`);
            check(modeRanA.length === 0 && creeperLinesA.length === 0, 'A2: the mode creeper_safety never ran during the walk and the bot said nothing about a creeper (no "keeps following me", no "stands near")', `${modeRanA.length} samples of the mode; said ${JSON.stringify(creeperLinesA.slice(0, 3))}`);
            check(lowestA >= g + 0.5, 'A3: the bot\'s feet never went below the grass: no flee down into the basement or the cave', `lowest y ${lowestA.toFixed(2)} (the grass at ${g}, feet at ${g + 1})`);
            if (!walk.done && agent.actions.executing) note(`A: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await command(`kill ${sel}`);
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });

            // ====================================================== B. a creeper in sight at the bot's level, a hollow behind the bot
            const walkB = await orders.orderInfo(`!goToCoordinates(${spotB.x}, ${spotB.y}, ${spotB.z}, 1)`, 120000);
            const atB = await entityPos(NAME);
            const thereB = Boolean(atB) && hdist(atB, { x: spotB.x + 0.5, z: spotB.z + 0.5 }) <= 2;
            note(`B0: the walk to the spot of B ${cellText(spotB)} answered ${JSON.stringify(String(walkB.reply).slice(0, 120))}; the bot at ${fmt(atB)} (${thereB ? 'there' : 'NOT there'}); the hollow ${cellText(hollow.min)} to ${cellText(hollow.max)} lies 8 blocks north`);
            check(thereB, 'B0: precondition: the bot stands at the spot of B, 8 blocks south of the hollow and more than 48 blocks from every area', fmt(atB));
            if (!thereB && agent.actions.executing) note(`B0: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            await waitFor(() => !agent.actions.executing, { ms: 20000, every: 200 });
            const startB = await entityPos(NAME);
            const tB = Date.now();
            const out = await command(`summon minecraft:creeper ${creeperB.x + 0.5} ${creeperB.y} ${creeperB.z + 0.5} {PersistenceRequired:1b,Tags:["${TAG}","${CREEPER_TAG}"]}`);
            check(out.some((l) => /Summoned new Creeper/.test(l)), `B0: a creeper is summoned 8 blocks south of the bot, in sight at its level (run ${env.run})`, out.join(' | '));
            const traceB = startTrace(async () => ({ bot: await entityPos(NAME), creeper: await entityPos(`${sel.slice(0, -1)},limit=1]`), action: agent.actions.currentActionLabel || '-', hp: await entityNumber(NAME, 'Health') }), 250);
            const reacted = await waitFor(() => traceB.rows.some((x) => String(x.action).startsWith(MODE)), { ms: 10000, every: 100 });
            // the creeper lives until the reflex ran and 15 s passed (the bot had its flee), at the latest 45 s
            await waitFor(() => deaths > 0 || (reacted.ok && Date.now() - tB >= 15000 + reacted.ms) || Date.now() - tB >= 45000, { ms: 45000, every: 250 });
            await command(`kill ${sel}`);
            const ended = await waitFor(() => !String(agent.actions.currentActionLabel || '-').startsWith(MODE) && saidLines(s, tB).some((l) => REFLEX_TEXTS.test(l)), { ms: 100000, every: 250 });
            await sleep(500);
            const rowsB = await traceB.stop();
            printTrace(`B: a creeper in sight at the bot's level, run ${env.run}`, rowsB, { bot: (x) => fmt(x.bot), creeper: (x) => fmt(x.creeper), toBot: (x) => (x.creeper ? dist(x.bot, x.creeper).toFixed(1) : '-'), hp: (x) => x.hp, action: (x) => x.action }, 80);
            const lowestB = Math.min(...rowsB.filter((x) => x.bot).map((x) => x.bot.y));
            const inHollow = rowsB.filter((x) => x.bot && x.bot.x >= hollow.min.x && x.bot.x <= hollow.max.x + 1 && x.bot.z >= hollow.min.z && x.bot.z <= hollow.max.z + 1 && x.bot.y < g + 0.5).length;
            const saidB = saidLines(s, tB);
            const reflexText = saidB.find((l) => REFLEX_TEXTS.test(l)) ?? null;
            note(`B: the reflex ${reacted.ok ? `ran ${(reacted.ms / 1000).toFixed(1)} s after the summon` : 'did NOT run within 10 s'}; it ${ended.ok ? `ended with a text after ${(ended.ms / 1000).toFixed(0)} s` : 'gave no end text within 100 s'}; the bot started at ${fmt(startB)}, lowest feet y ${lowestB.toFixed(2)}, ${inHollow} samples in the hollow; deaths ${deaths}; the bot said ${JSON.stringify(saidB.slice(0, 8))}`);
            check(reacted.ok, 'B1: the mode creeper_safety ran within 10 s of the summon (a creeper in sight at the bot\'s level counts, as before)', reacted.ok ? `${(reacted.ms / 1000).toFixed(1)} s` : 'did not run');
            check(reflexText !== null, 'B2: the reflex ends with one of its existing texts (`I backed off from a creeper.`, the lured text, the 90 s text)', JSON.stringify(reflexText ?? saidB.slice(0, 4)));
            check(Boolean(startB) && lowestB >= startB.y - 1, 'B3: the bot\'s feet never went below its start minus 1: the flee target is never lower than the bot, never in the hollow (F1; v0.1.4.15 walks to the x/z of the target and drops 4 blocks)', `start y ${startB ? startB.y.toFixed(2) : '?'}, lowest ${lowestB.toFixed(2)}, ${inHollow} samples in the hollow`);
            const health = await entityNumber(NAME, 'Health');
            check(deaths === 0 && health > 0, 'B4: the bot lives', `deaths ${deaths}, health ${health}`);
            if (agent.actions.executing) await orders.order('!stop', 20000).catch(() => {});

            // ====================================================== C. the help line once in 120 s
            const all = [...s.chats, ...s.behavior.map((x) => ({ text: `[behaviour] ${x.text}`, t: x.t }))].filter((x) => x.t >= t0);
            const help = helpWindows(all);
            note(`C: the help line was said ${help.count} time(s) in the scenario, at most ${help.worst} within 120 s`);
            check(help.worst <= 1, 'C: the help line `A creeper keeps following me near the base. ...` is said at most once in any 120 s (F1: once per 120 s, not per run)', `${help.count} in all, ${help.worst} within 120 s`);

            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[type=minecraft:creeper,x=${r.ox - 150},y=-64,z=${r.oz - 150},dx=300,dy=400,dz=300]`, `kill @e[tag=${TAG}]`, 'difficulty peaceful']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion({ ox: r.ox + 70, oz: r.oz, g: r.g, radius: 40 }).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
