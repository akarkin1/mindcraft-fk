// W24 basics of the mine (spec v0.1.4.7 section 8 "Basics of the mine", M0, M4, M5), deep world:
// mining_pack on, protected_areas on, world_memory on. What M0 asked, as checks: can the bot go DOWN
// a shaft of 20 blocks with ladders on one wall, and UP again, and how long does each take?
//   The bot digs its own shaft (descendToLevel to 20 blocks under its feet) and sets up the base
//   (setupMineBase), so the mine is in the store. Then, through the commands of M5:
//   !leaveMine: up the ladders to the surface; !goToMine: down again to the base; !leaveMine: up again.
//   Each ends where it should (the surface next to the entrance, the level of the mine next to the
//   base) within 120 s, the bot is never hurt and never falls; the times are noted.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, placeBot, resetBot, command_, giveItems,
    entityPos, fmt, startTrace, printTrace, runSkill, MINING_SETTINGS, MINING_KIT, watchHealth, largestDrop, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockIs, blockNames, hdist, itemsText, stableInventory } from './world.js';

const NAME = 'w_mine0';
const DEPTH = 20;

await scenarioMain({
    async main() {
        const r = region(40);
        const g = r.g;
        await prepareRegion(r);
        check(env.world === 'deep', 'precondition: the scenario runs in the deep world', env.world);
        check(await blockIs({ x: r.ox, y: g - 40, z: r.oz }, 'stone'), `precondition: deep stone under the region (stone at y ${g - 40})`);
        const level = g + 1 - DEPTH;

        let agent = null;
        try {
            const s = await startAgent(NAME, MINING_SETTINGS);
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, 0);
            await giveItems(NAME, MINING_KIT, agent.bot);
            const health = watchHealth(agent.bot);
            const trace = startTrace(async () => ({ pos: await entityPos(NAME) }), 250);

            // ---------------------------------------------------------- the bot digs the shaft and sets up the base
            const down0 = await runSkill(agent, 'test_descend', (bot, ctx) => agent.work_packs.mining.descendToLevel(bot, ctx, level), 480000);
            note(`descendToLevel(${level}) after ${(down0.ms / 1000).toFixed(1)} s: ${JSON.stringify(down0.result?.text)}`);
            check(down0.result?.ok === true, `precondition: the bot dug a shaft down to level ${level}, ${DEPTH} blocks under its feet`, JSON.stringify(down0.result?.text));
            const base0 = await runSkill(agent, 'test_base', (bot, ctx) => agent.work_packs.mining.setupMineBase(bot, ctx), 300000);
            note(`setupMineBase after ${(base0.ms / 1000).toFixed(1)} s: ${JSON.stringify(base0.result?.text)}`);
            const mines = agent.packContext().mines?.list() ?? [];
            const mine = mines[0] ?? null;
            note(`the mine in the store: ${JSON.stringify(mine)}`);
            check(base0.result?.ok === true && mines.length === 1 && mine.level === level, 'precondition: the base is set up and the mine is in the store at its level', JSON.stringify(base0.result?.text));
            if (!mine) return;
            const leg = (mine.route || []).find((l) => l.kind === 'ladder');
            const column = leg ? { x: leg.x, z: leg.z } : { x: mine.entrance.x, z: mine.entrance.z };
            const shaft = [];
            for (let y = level; y <= g; y++) shaft.push({ x: column.x, y, z: column.z });
            const ladders = (await blockNames(shaft, ['ladder'])).filter(Boolean).length;
            note(`ladders in the shaft at (${column.x}, ${column.z}) from y ${level} to ${g}: ${ladders} of ${shaft.length}`);
            check(ladders >= DEPTH - 1, `the shaft of ${DEPTH} blocks has a ladder in (nearly) every block`, `${ladders} of ${shaft.length}`);

            // ---------------------------------------------------------- up, down, up through the commands
            const surface = { x: mine.entrance.x, z: mine.entrance.z };
            const legs = [
                ['!leaveMine', 'up', (p) => p && p.y >= g + 0.9 && hdist(p, surface) <= 4, 'on the surface next to the entrance'],
                ['!goToMine', 'down', (p) => p && Math.floor(p.y + 0.01) === level && hdist(p, { x: mine.base.x + 0.5, z: mine.base.z + 0.5 }) <= 4, 'at the level of the mine next to the base'],
                ['!leaveMine', 'up', (p) => p && p.y >= g + 0.9 && hdist(p, surface) <= 4, 'on the surface next to the entrance'],
            ];
            for (const [cmd, way, where, words] of legs) {
                const t0 = Date.now();
                const reply = await command_(agent, cmd, 180000);
                const secs = (Date.now() - t0) / 1000;
                const p = await entityPos(NAME);
                note(`${cmd} (${way} ${DEPTH} blocks) took ${secs.toFixed(1)} s and answered ${JSON.stringify(reply)}; the bot is at ${fmt(p)}`);
                check(where(p), `${cmd}: the bot went ${way} the ladders of ${DEPTH} blocks and is ${words}`, fmt(p));
                check(secs <= 120, `${cmd}: ${way} ${DEPTH} blocks took at most 120 s`, `${secs.toFixed(1)} s`);
            }
            const rows = await trace.stop();
            const hp = health.stop();
            const drop = largestDrop(rows);
            printTrace('the whole scenario', rows, { pos: (x) => fmt(x.pos) }, 60);
            note(`largest drop between two samples 250 ms apart: ${drop.drop.toFixed(2)} blocks at t=${drop.t.toFixed(1)} s ${fmt(drop.from)} -> ${fmt(drop.to)}; lowest health ${hp.min}`);
            check(hp.min === 20, 'the bot was never hurt (health from its own view, every change)', JSON.stringify(hp.hurt.slice(0, 5)));
            check(drop.drop <= 1.6, 'the bot never fell (no drop of more than 1.6 blocks between two samples 250 ms apart)', `${drop.drop.toFixed(2)} blocks at t=${drop.t.toFixed(1)} s`);
            const inv = await stableInventory(NAME);
            note(`the bot carries ${itemsText(inv.items)}`);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
