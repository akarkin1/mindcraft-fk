// W101 the events of the watch server (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md 1.3, SPEC
// section 5): missing chickens and an explosion near a saved area become events, kept for `events` and sent to a listening
// session (`events --follow`). Today (v0.1.4.11) there is no server and no client: the scenario fails at its first check.
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists): the pen holds
// its cow, its chicken and 5 more chickens (6 chickens). The owner's switches of v0.1.4.11 with watch_server on and a free
// port, the modes of his profile, an empty memory, the random token of the harness in the environment of the agent (never
// printed). The bot stands in the pen; it is never moved by the control.
//   0. scripts/watch.js exists. `events --follow` runs as a child process from here on.
//   1. Typed !rememberArea("pen") in the pen (the pen saved with its chickens) and !setArea("home", "home", <the house>).
//   2. The control kills 4 of the 6 chickens (`kill @e[type=chicken,limit=4,...]`): within 90 s `events` has
//      `The pen "pen" has 2 chickens, the record says 6.`
//   3. The control summons a primed TNT 8 blocks north of the house: within 30 s `events` has `Explosion N blocks from
//      the area "home"` (or "pen"); the north wall of the house stands, or the explosion was 8 or more from the house.
//   4. The stream printed both events.
// Throughout: the token is in no console line and no output, the process lives, no request reached a real model.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, fmt, sleep, commands, command, waitFor } from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, distToBox } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, saidLines, RELEASE_SETTINGS, freePort, WATCH_CLIENT, runWatchClient, followWatchEvents, redact,
} from './journey.js';

const NAME = 'w_events';
const EXTRA_CHICKENS = 5;
const MISSING = 'The pen "pen" has 2 chickens, the record says 6.';
const EXPLOSION = /Explosion \d+ blocks from the area "(home|pen)"/;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        const haveClient = fs.existsSync(WATCH_CLIENT);
        check(haveClient, '0: the client of the watch server exists (scripts/watch.js, PLAN 1.4)', haveClient ? WATCH_CLIENT : `${WATCH_CLIENT} is missing: no watch server and no client (part C of v0.1.4.12 is not built)`);
        if (!haveClient) return;
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const g = b.g;
        const pen = b.pen;
        const h = b.house;
        const extra = [];
        for (let k = 0; k < EXTRA_CHICKENS; k++) {
            const p = { x: pen.inner.min.x + 1 + k, y: g + 1, z: pen.inner.max.z - 1 };
            extra.push(`summon minecraft:chicken ${p.x + 0.5} ${p.y} ${p.z + 0.5} {PersistenceRequired:1b,Tags:["${pen.tag}","${pen.tag}_extra"]}`);
        }
        await commands(extra);
        const penSel = `@e[type=minecraft:chicken,x=${pen.box.min.x},y=${g - 1},z=${pen.box.min.z},dx=${pen.box.max.x - pen.box.min.x},dy=5,dz=${pen.box.max.z - pen.box.min.z}]`;
        const chickens = async () => Number((/count: (\d+)/.exec((await command(`execute if entity ${penSel}`)).join(' ')) ?? [0, 0])[1]);
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the environment of the agent, which runs in this process
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server in 8090..8190', String(port));
        const url = `http://127.0.0.1:${port}/mcp`;
        const outputs = [];
        const watch = async (args) => {
            const res = await runWatchClient(args, { url, token: TOKEN });
            outputs.push(res.out, res.err);
            return res;
        };
        let agent = null, orders = null, stream = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: pen.inside, playerAt: { x: pen.inside.x, y: g + 1, z: pen.inside.z - 2 },
                settings: RELEASE_SETTINGS({ watch_server: true, watch_port: port }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();
            note(`the watch port ${port}; the token is set in the environment of the agent (not printed)`);
            await sleep(2000);
            stream = followWatchEvents({ url, token: TOKEN });

            // ---------------------------------------------------------- 1. the pen and the house
            const n0 = await chickens();
            const saved = await orders.order('!rememberArea("pen")', 90000);
            note(`1: ${n0} chickens in the pen; !rememberArea("pen") answered ${JSON.stringify(saved.slice(0, 300))}`);
            const area = agent.area_store?.get?.('pen') ?? null;
            check(area?.type === 'pen' && n0 === 6, '1: precondition: the pen is saved as the area "pen" of type pen, with its 6 chickens', `${area ? `type ${area.type}` : 'no area "pen"'}, ${n0} chickens`);
            const hb = h.box;
            const homeSaid = await orders.order(`!setArea("home", "home", ${hb.min.x}, ${hb.min.y}, ${hb.min.z}, ${hb.max.x}, ${hb.max.y}, ${hb.max.z})`, 30000);
            note(`1: !setArea("home", ...) answered ${JSON.stringify(homeSaid.slice(0, 200))}`);
            check(homeSaid.startsWith('Area "home" (home) saved:'), '1: precondition: the house is saved as the area "home"', JSON.stringify(homeSaid.slice(0, 200)));

            // ---------------------------------------------------------- 2. 4 chickens killed
            const killed = await command(`kill @e[type=minecraft:chicken,limit=4,x=${pen.box.min.x},y=${g - 1},z=${pen.box.min.z},dx=${pen.box.max.x - pen.box.min.x},dy=5,dz=${pen.box.max.z - pen.box.min.z}]`);
            const n2 = await chickens();
            const tKill = Date.now();
            note(`2: the control killed 4 chickens (${JSON.stringify(killed)}); ${n2} chickens in the pen`);
            check(n2 === 2, '2: precondition: 2 chickens are left in the pen', `${n2}`);
            let last = '';
            const missing = await waitFor(async () => {
                const ev = await watch(['events']);
                last = ev.out;
                return ev.code === 0 && ev.out.includes(MISSING) ? ev.out : null;
            }, { ms: 90000, every: 10000 });
            note(`2: \`events\` after ${((Date.now() - tKill) / 1000).toFixed(0)} s: ${JSON.stringify(redact(last, TOKEN).slice(-600))}`);
            check(missing.ok, `2: within 90 s \`events\` has \`${MISSING}\` (animals_missing)`, JSON.stringify(redact(last, TOKEN).slice(-300)));

            // ---------------------------------------------------------- 3. an explosion
            const tnt = { x: h.door.x, y: g + 1, z: hb.min.z - 8 };
            const far = distToBox({ x: tnt.x + 0.5, y: tnt.y, z: tnt.z + 0.5 }, hb);
            const wall = [];
            for (let x = hb.min.x; x <= hb.max.x; x++) for (let y = g + 1; y <= g + 4; y++) if (!(x === h.door.x && (y === g + 1 || y === g + 2))) wall.push({ x, y, z: hb.min.z });
            await commands([`summon minecraft:tnt ${tnt.x + 0.5} ${tnt.y} ${tnt.z + 0.5} {fuse:20}`]);
            const tBoom = Date.now();
            note(`3: a primed TNT at (${tnt.x}, ${tnt.y}, ${tnt.z}), ${far.toFixed(1)} blocks from the house; the bot in the pen`);
            const boom = await waitFor(async () => {
                const ev = await watch(['events']);
                last = ev.out;
                return ev.code === 0 && EXPLOSION.test(ev.out) ? ev.out : null;
            }, { ms: 30000, every: 3000 });
            note(`3: \`events\` after ${((Date.now() - tBoom) / 1000).toFixed(0)} s: ${JSON.stringify(redact(last, TOKEN).slice(-600))}`);
            check(boom.ok, '3: within 30 s `events` has `Explosion N blocks from the area "home"` (or "pen")', JSON.stringify(redact(last, TOKEN).slice(-300)));
            const air = await blockNames(wall, ['air']);
            const holes = wall.filter((p, i) => air[i]);
            check(holes.length === 0 || far >= 8, '3: the house blocks stand, or the explosion was 8 or more from the house', `${holes.length} wall cells are air; ${far.toFixed(1)} blocks`);

            // ---------------------------------------------------------- 4. the stream
            await sleep(2000);
            await stream.stop();
            note(`4: \`events --follow\` printed ${JSON.stringify(redact(stream.text, TOKEN).slice(-800))}${stream.err ? `; err ${JSON.stringify(redact(stream.err, TOKEN).slice(0, 200))}` : ''}`);
            outputs.push(stream.text, stream.err);
            check(stream.text.includes(MISSING) && EXPLOSION.test(stream.text), '4: the stream (`events --follow`) printed both events', `missing chickens ${stream.text.includes(MISSING)}, explosion ${EXPLOSION.test(stream.text)}`);

            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            const inOut = outputs.some((o) => String(o).includes(TOKEN));
            check(!inLogs && !inOut, 'the token is in no console line of the agent and in no output of the client', `console ${inLogs ? 'HAS it' : 'no'}, client ${inOut ? 'HAS it' : 'no'}`);
            note(`the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 20))}; it is at ${fmt(agent.bot.entity?.position)}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (stream) await stream.stop();
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
