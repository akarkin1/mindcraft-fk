// W106 the scans underground (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md package 4, SPEC
// section 5 and 4.5 F1 to F3): in the tunnel of its mine the bot names the tunnel of the mine; in a cave it says nothing;
// underground it never asks for a name and never calls rock a storage. Today (v0.1.4.11) the sense said "I am in a walled
// storage 13 x 26 with 207 water blocks" in the owner's corridor of rock (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches of v0.1.4.11 (area_sense on), the modes of his profile, an empty memory. The bot is never moved by the control.
//   0. The player teaches the mine (journey.js partTeachMine: "follow me" down both ladders to the end of the tunnel,
//      "this is the mine" !rememberMine("mine")). "get out" !leaveMine: the bot on the surface (precondition).
//   1. "go to the mine" !goToMine, then a typed walk into the middle of the tunnel (!goToCoordinates): from the moment the
//      mine was saved to 20 s after the bot stands in the tunnel, the bot said F2's sentence of the tunnel of the mine,
//      `I am in a tunnel 1 wide and N long, heading <north|south>, of the mine "mine".`; underground it never said a line
//      with "storage" nor "Tell me its name".
//   2. The control digs a cave beside the room tunnel (the tunnel of 8 out of the west wall of the room, base_world.js):
//      6 x 3 x 6 blocks of air, feet at y 40 (one below the room tunnel), open to the tunnel by a cell 2 high. A typed
//      !goToCoordinates to the middle of the cave: no line of the sense (no "I am in a tunnel", "I am in a cave", no
//      "storage", no "Tell me its name") from the order to 20 s after the bot stands in the cave.
//   3. !rememberArea("x") in the cave answers the refusal of F1 (`I am in a cave ...` or `I am in a tunnel; a tunnel is
//      saved with "this is the mine" or "dig here".`) and no area "x" is saved.
// Throughout: the process lives, no request reached a real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, commands, waitFor, walkTyped } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, blockNames } from './world.js';
import { basePlan, buildBase, BASE_RADIUS, buildRoomTunnel } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, partTeachMine, spots, saidLines, RELEASE_SETTINGS, onSurface } from './journey.js';

const NAME = 'w_under';
const KIT = [['stone_pickaxe', 1], ['torch', 16], ['bread', 8], ['ladder', 8]]; // ladders as the owner's bot carries them (T3-2: shaft 2 ends above the room floor)
const TUNNEL_SAID = /I am in a tunnel 1 wide and (\d+) long, heading (north|south), of the mine "mine"\./;
const NEVER = /\bstorage\b|Tell me its name/;
const SENSE = /I am in a (tunnel|cave)\b|\bstorage\b|Tell me its name/;
const REFUSAL = /^I am in a (cave|tunnel)\b/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const sp = spots(b);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: RELEASE_SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();

            // ---------------------------------------------------------- 0. the mine
            const taught = await partTeachMine({ ...j, b });
            const tSaved = Date.now();
            if (!taught.ok) {
                check(false, '0: the bot learned the mine (precondition); the rest is not run');
                return;
            }
            const out = await orders.orderInfo('!leaveMine', 300000);
            await sleep(1000);
            const a0 = await entityPos(NAME);
            note(`0: !leaveMine answered ${JSON.stringify(out.reply.slice(0, 300))}; the bot at ${fmt(a0)}`);
            check(onSurface(b, a0), '0: precondition: "get out" brings the bot to the surface', fmt(a0));

            // ---------------------------------------------------------- 1. the tunnel of the mine
            const go = await orders.orderInfo('!goToMine', 300000);
            note(`1: !goToMine answered after ${(go.ms / 1000).toFixed(1)} s: ${JSON.stringify(go.reply.slice(0, 300))}; the bot at ${fmt(await entityPos(NAME))}`);
            const mid = b.tunnel.cells[Math.floor(b.tunnel.cells.length / 2)];
            const walk = await walkTyped(orders, agent, mid, 180000);
            const inTunnel = inBox(walk.pos, { min: { ...b.tunnel.box.min, y: b.tunnel.box.min.y - 1 }, max: b.tunnel.box.max });
            check(inTunnel, '1: precondition: the typed walk brings the bot into the tunnel of the mine', fmt(walk.pos));
            const tIn = Date.now();
            const heard = await waitFor(() => saidLines(s, tSaved).find((l) => TUNNEL_SAID.test(l)) ?? null, { ms: 20000, every: 500 });
            const under = saidLines(s, t0);
            note(`1: from the saving of the mine on the bot said ${JSON.stringify(saidLines(s, tSaved).slice(0, 20))}`);
            check(heard.ok, '1: the bot said F2\'s sentence of the tunnel of its mine (`I am in a tunnel 1 wide and N long, heading ..., of the mine "mine".`) by 20 s after it stood in the tunnel',
                `${((Date.now() - tIn) / 1000).toFixed(0)} s after; ${JSON.stringify(saidLines(s, tSaved).filter((l) => /I am in a/.test(l)).slice(0, 4))}`);
            const bad1 = under.filter((l) => NEVER.test(l));
            check(bad1.length === 0, '1: underground the bot never said "storage" nor "Tell me its name"', JSON.stringify(bad1.slice(0, 4)));

            // ---------------------------------------------------------- 2. a cave
            const rt = await buildRoomTunnel(b);
            const y = b.room.box.min.y - 1; // the feet of the cave, one below the room tunnel
            const cx0 = rt.end.x + 1, cz0 = rt.start.z + 2; // 6 x 6 south of the room tunnel
            const cave = { min: { x: cx0, y, z: cz0 }, max: { x: cx0 + 5, y: y + 2, z: cz0 + 5 } };
            const door = { x: cx0 + 2, z: rt.start.z + 1 };
            await commands([
                `fill ${cave.min.x} ${cave.min.y} ${cave.min.z} ${cave.max.x} ${cave.max.y} ${cave.max.z} minecraft:air`,
                `fill ${door.x} ${y + 1} ${door.z} ${door.x} ${y + 2} ${door.z} minecraft:air`,
            ]);
            const caveMid = { x: cx0 + 2, y, z: cz0 + 3 };
            const caveAir = await blockNames([caveMid, { ...caveMid, y: y + 2 }, { x: door.x, y: y + 1, z: door.z }], ['air']);
            check(caveAir.every(Boolean), 'precondition: the cave beside the room tunnel is dug and open to it', JSON.stringify(caveAir));
            note(`2: the room tunnel from (${rt.start.x}, ${rt.start.y}, ${rt.start.z}) west to (${rt.end.x}, ${rt.end.y}, ${rt.end.z}); the cave (${cave.min.x}, ${cave.min.y}, ${cave.min.z}) to (${cave.max.x}, ${cave.max.y}, ${cave.max.z}), open at (${door.x}, ${y + 1}, ${door.z})`);
            const tCave = Date.now();
            const toCave = await walkTyped(orders, agent, caveMid, 240000);
            const inCave = inBox(toCave.pos, cave);
            check(inCave, '2: precondition: the typed walk brings the bot into the cave', fmt(toCave.pos));
            await sleep(20000);
            const caveSaid = saidLines(s, tCave);
            const sense = caveSaid.filter((l) => SENSE.test(l));
            note(`2: from the order to 20 s in the cave the bot said ${JSON.stringify(caveSaid.slice(0, 12))}`);
            check(sense.length === 0, '2: in the tunnel of no mine and in the cave the sense says nothing (no tunnel or cave line, no "storage", no "Tell me its name")', JSON.stringify(sense.slice(0, 4)));

            // ---------------------------------------------------------- 3. no area underground
            const x = await orders.order('!rememberArea("x")', 60000);
            const areaX = agent.area_store?.get?.('x') ?? null;
            note(`3: !rememberArea("x") in the cave answered ${JSON.stringify(x.slice(0, 300))}; the areas ${JSON.stringify((agent.area_store?.list?.() ?? []).map((a) => [a.name, a.type]))}`);
            check(REFUSAL.test(x) && !areaX, '3: !rememberArea("x") in the cave answers the refusal of F1 and saves no area', JSON.stringify(x.slice(0, 200)));
            const bad = saidLines(s, t0).filter((l) => NEVER.test(l));
            check(bad.length === 0 && !NEVER.test(x), 'underground the bot never said "storage" nor "Tell me its name" (the whole journey)', JSON.stringify(bad.slice(0, 4)));

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
