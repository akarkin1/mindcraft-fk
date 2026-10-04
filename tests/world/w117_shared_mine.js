// W117 the shared mine (journey of v0.1.4.13 "Supervision", tester T3; PLAN.md 4.1, SPEC section 1 and 4.7 M1): with
// shared_memory the mine one bot saved is known to the other. Today (v0.1.4.12) every bot has its own memory: the second
// bot knows no mine, !mines names none, and the scenario fails there.
//
// Two agents in one region of the base, both with the owner's switches of v0.1.4.12, the switches of this release and
// shared_memory on (SUPERVISION_SETTINGS), the modes of his profile, an empty memory: w_bot_a in this process, listening
// to the player w_player; w_bot_b in a phase of this file (a second node process, started after the mine is saved),
// listening to its own player w_player_b (only_chat_with: an order of one owner reaches one bot). The bots are never
// moved by the control.
//   0. Bot A: the player teaches the mine in the room (journey.js partTeachMineInRoom): !rememberMine("deep") in the
//      room. The file mines.json of the shared folder bots/shared/worlds/<seed>/ holds the mine "deep" (a fact of the
//      memory of the world, PLAN 4.1).
//   1. Bot B starts outside in front of the house door, 20 blocks and more from the room: typed !mines names "deep".
//   2. Typed !goToMine("deep"): within 90 s bot B is in the room (server).
// Throughout: the process of each lives, no request reached a real model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, fmt, sleep, waitFor, startAgent, resetBot, placeBot, runPhase, orderChannel, entityPos } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, PLAYER, SUPERVISION_SETTINGS, partTeachMineInRoom, spots, readSharedWorldFile, saidLines } from './journey.js';

const SELF = fileURLToPath(import.meta.url);
const A = 'w_bot_a';
const B = 'w_bot_b';
const PLAYER_B = 'w_player_b';
const MINE = 'deep';
const GO = () => path.join(process.cwd(), 'w117_go');

const settingsOf = (name) => SUPERVISION_SETTINGS({ shared_memory: true, only_chat_with: [name === A ? PLAYER : PLAYER_B] });

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
        fs.rmSync(GO(), { force: true });
        let agent = null, orders = null, phase = null;
        try {
            const j = await startJourney(A, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: [['ladder', 8], ['torch', 16]], settings: settingsOf(A),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;

            // ---------------------------------------------------------- 0. bot A saves the mine
            const taught = await partTeachMineInRoom({ ...j, b }, { name: MINE });
            if (!taught.ok) {
                check(false, '0: bot A learned the mine (precondition); the rest is not run');
                return;
            }
            const shared = readSharedWorldFile('mines.json');
            const mines = shared.json?.mines;
            const names = Array.isArray(mines) ? mines.map((m) => m.name) : Object.keys(mines ?? {});
            note(`0: the shared world folders ${JSON.stringify(shared.worlds)}; mines.json ${shared.file ? `at ${shared.file}` : 'missing'} with the mines ${JSON.stringify(names)}; bot A said ${JSON.stringify(saidLines(s).slice(-5))}`);
            check(Boolean(shared.json) && names.includes(MINE), `0: the mine "${MINE}" is in mines.json of the shared folder bots/shared/worlds/<seed>/ (PLAN 4.1)`, shared.file ? JSON.stringify(names) : `no shared mines.json (${JSON.stringify(shared.worlds)})`);

            // ---------------------------------------------------------- 1, 2. bot B (a second process)
            fs.writeFileSync(GO(), 'go');
            phase = await runPhase(SELF, 'second', {}, 240000);
            check(phase.code === 0 && phase.failed.length === 0, 'the phase of bot B passed every check', `exit ${phase.code}, ${phase.failed.length} failed`);
            check(s.killed === null, 'the process of bot A lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request of bot A reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            fs.rmSync(GO(), { force: true });
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },

    // Bot B with its own player: started outside the house, !mines, !goToMine("deep").
    async second() {
        const r = region(BASE_RADIUS);
        const b = basePlan(r, { owner: true, dump: loadDump() });
        const sp = spots(b);
        let agent = null, orders = null;
        try {
            const s = await startAgent(B, settingsOf(B));
            agent = s.agent;
            await resetBot(B);
            await placeBot(agent, { ...sp.outside, x: sp.outside.x + 2 }, 180);
            orders = await orderChannel(s, { name: PLAYER_B, at: { ...sp.outside, x: sp.outside.x + 4 } });
            const at = await entityPos(B);
            const room = b.room.box;
            note(`B: bot B at ${fmt(at)}, ${dist(at, { x: b.room.middle.x + 0.5, y: room.min.y, z: b.room.middle.z + 0.5 }).toFixed(1)} blocks from the middle of the room; the areas of its own memory ${JSON.stringify((agent.area_store?.list?.() ?? []).map((a) => a.name))}`);
            await sleep(3000);

            // ---------------------------------------------------------- 1. !mines
            const listed = await orders.order('!mines', 20000);
            note(`1: !mines of bot B answered ${JSON.stringify(listed.slice(0, 300))}`);
            check(new RegExp(`\\b${MINE}\\b`).test(listed), `1: bot B's !mines names "${MINE}" (the mine bot A saved, through the shared memory)`, JSON.stringify(listed.slice(0, 200)));

            // ---------------------------------------------------------- 2. !goToMine
            const t2 = Date.now();
            const go = orders.orderInfo(`!goToMine("${MINE}")`, 120000);
            const there = await waitFor(async () => { const p = await entityPos(B); return inBox(p, room) ? p : null; }, { ms: 90000, every: 500 });
            const end = await entityPos(B);
            note(`2: !goToMine("${MINE}"): bot B ${there.ok ? `is in the room after ${(there.ms / 1000).toFixed(1)} s` : 'is NOT in the room within 90 s'}, at ${fmt(end)}`);
            check(there.ok, `2: bot B reaches the room of the mine "${MINE}" within 90 s of !goToMine (server)`, fmt(end));
            const info = await Promise.race([go, sleep(5000).then(() => null)]);
            note(`2: the order ${info ? `answered ${JSON.stringify(info.reply.slice(0, 300))}` : 'still runs'}; bot B said ${JSON.stringify(saidLines(s).slice(0, 10))}`);
            check(s.killed === null, 'the process of bot B lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request of bot B reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
        }
    },
});
exitSoon();
