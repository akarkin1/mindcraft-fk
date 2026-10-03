// W97 "come here" without digging (journey of v0.1.4.11 "Navigation and words", tester T3; PLAN.md 4.5, SPEC section 7
// and N2): !goToPlayer never digs toward the owner; when no walk exists it says so and stops. Today (v0.1.4.10) the walk
// falls back to destructive movements: 9 destructive attempts in one session of the owner (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists) with the stone
// box of base_world.js (sealed, one cell of air 2 high inside, north of the house), the owner's switches with the three
// of v0.1.4.11 on, the modes of his profile, an empty memory, a stone pickaxe (the owner's bot carries one). The bot is
// never moved by the control.
//   1. The player stands in the sealed box; the bot stands 3 blocks north of its north wall. "come here"
//      !goToPlayer("w_player", 1): the answer holds `I find no way to you from here without digging. Come closer or
//      tell me to dig.` (N2); no block of the box was broken; neither the answer nor the console of the agent has a line
//      of a destructive walk (`Found destructive path.` or `... using destructive movements.`).
//   2. The owner opens the box (the 2 cells of its north wall, the side of the bot). "come here" again: the bot reaches
//      him (within 2 blocks) within 60 s; the rest of the box stands.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands } from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, dist } from './world.js';
import { basePlan, buildBase, buildStoneBox, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, JOURNEY_SETTINGS, PLAYER, saidLines } from './journey.js';

const NAME = 'w_nodig';
const KIT = [['stone_pickaxe', 1]];
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true });
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const NO_WAY = 'I find no way to you from here without digging. Come closer or tell me to dig.';
// a line of the destructive fallback of the walk ("Found non-destructive path." is the walk without digging)
const DESTRUCTIVE = /(?<!non-)destructive (path|movements)/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const box = await buildStoneBox(b);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, { botAt: box.outside, botYaw: 0, playerAt: box.inner, kit: KIT, settings: SETTINGS() });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const destructiveLines = (from) => (s.logs ?? []).slice(from).flatMap((l) => String(l).split('\n')).filter((l) => DESTRUCTIVE.test(l));
            const shell = async (cells) => {
                const got = await blockNames(cells, ['stone']);
                return cells.filter((c, i) => !got[i]);
            };
            const p0 = await entityPos(PLAYER);
            const missing0 = await shell(box.shell);
            note(`the player stands in the box at ${fmt(p0)}, the bot at ${fmt(await entityPos(NAME))}; the box is ${box.shell.length - missing0.length} of ${box.shell.length} stone`);
            check(missing0.length === 0, 'precondition: the box is sealed (every block of its shell is stone)', missing0.map(P).join(' '));

            // ---------------------------------------------------------- 1. sealed
            const log1 = (s.logs ?? []).length;
            const t1 = Date.now();
            const one = await orders.orderInfo(`!goToPlayer("${PLAYER}", 1)`, 120000);
            await sleep(1000);
            const broken = await shell(box.shell);
            const lines1 = destructiveLines(log1);
            note(`1: "come here" answered after ${((Date.now() - t1) / 1000).toFixed(1)} s: ${JSON.stringify(one.reply.slice(0, 400))}; the bot at ${fmt(await entityPos(NAME))}; ${broken.length} blocks of the box are no stone: ${broken.map(P).join(' ')}`);
            check(one.reply.includes(NO_WAY), `1: the answer is \`${NO_WAY}\` (N2)`, JSON.stringify(one.reply.slice(0, 300)));
            check(broken.length === 0, '1: no block of the box was broken', broken.map(P).join(' '));
            check(!DESTRUCTIVE.test(one.reply) && lines1.length === 0, '1: no line of a destructive walk in the answer or in the console of the agent', JSON.stringify([...lines1.slice(0, 3), DESTRUCTIVE.test(one.reply) ? one.reply.slice(0, 200) : '']));

            // ---------------------------------------------------------- 2. open
            await commands(box.door.map((c) => `setblock ${c.x} ${c.y} ${c.z} minecraft:air`));
            await sleep(500);
            const t2 = Date.now();
            const two = await orders.orderInfo(`!goToPlayer("${PLAYER}", 1)`, 60000);
            await sleep(1000);
            const a2 = await entityPos(NAME);
            const p2 = await entityPos(PLAYER);
            const rest = box.shell.filter((c) => !box.door.some((d) => d.x === c.x && d.y === c.y && d.z === c.z));
            const broken2 = await shell(rest);
            note(`2: with the box open "come here" answered after ${((Date.now() - t2) / 1000).toFixed(1)} s: ${JSON.stringify(two.reply.slice(0, 300))}; the bot at ${fmt(a2)}, ${dist(a2, p2).toFixed(1)} blocks from the player`);
            check(two.done && dist(a2, p2) <= 2, '2: with the box open "come here" brings the bot to the player (within 2 blocks) within 60 s', `${dist(a2, p2).toFixed(1)} blocks`);
            check(broken2.length === 0, '2: the rest of the box stands', broken2.map(P).join(' '));

            note(`the bot said ${JSON.stringify(saidLines(s, t1).slice(0, 20))}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
