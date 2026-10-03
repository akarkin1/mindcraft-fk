// W100 the watch server (journey of v0.1.4.12 "Understanding and watching", tester T3; PLAN.md package 1, SPEC section 5):
// a Claude session watches the bot through a small MCP server in the bot's process and can step in with `say`. Today
// (v0.1.4.11) there is no server and no client: the scenario fails at its first check (scripts/watch.js is missing).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches of v0.1.4.11 with watch_server on and watch_port a free port of 8090..8190, the modes of his profile, an empty
// memory. The harness sets a random token as MC_WATCH_TOKEN in the environment of the agent (the agent runs in this
// process) and never prints it. The client is `node scripts/watch.js` with MC_WATCH_URL and the same token. The bot stands
// in the house; it is never moved by the control.
//   0. scripts/watch.js exists; the server answers `initialize` on 127.0.0.1:<port> with the token (serverInfo
//      mindcraft-watch); a POST without the token is 401 with the JSON-RPC error -32001 and no state.
//   1. `state`: the bot's name, its position within 1 block of the server's, `in overworld`, `Time N` within 100 of the
//      server's time of day.
//   2. `inventory`: the kit (16 cobblestone, 5 bread, 1 stone_pickaxe).
//   3. Typed !rememberArea("home", "home") ("this is home"); `places` names `home (home)`.
//   4. `chat`: the owner's last line (`w_player: !rememberArea("home", "home")`) and the bot's answer.
//   5. Without the token and with another token: exit 1, the text says unauthorized, nothing of the state in the output.
//   6. The player 8 blocks away outside the door; `say {"text":"come here"}` answers `Said as w_player: "come here".`; the
//      fake model answers the line with !goToPlayer("w_player", 2): the bot comes within 2 blocks (between the block cells,
//      as the path search measures it and W99 checks it) within 60 s.
//   7. `say {"text":"/kill"}` is refused (exit 1, `I do not run server commands.`), the bot lives.
// Throughout: the token is in no console line of the agent and no output of the client, the process lives, no request
// reached a real model.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, command, waitFor } from './helpers.js';
import { region, prepareRegion, releaseRegion, dist, inventoryOf, itemsText, entityNumber } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import {
    startJourney, PLAYER, saidLines, RELEASE_SETTINGS, freePort, WATCH_CLIENT, runWatchClient, rawMcp, redact,
} from './journey.js';

const NAME = 'w_watch';
const KIT = [['stone_pickaxe', 1], ['cobblestone', 16], ['bread', 5]];
const REFUSED_SLASH = 'I do not run server commands.';
const POS = /\bat \((-?\d+), (-?\d+), (-?\d+)\) in (\w+)/;
// within 2 blocks, measured between the block cells of the bot and the player, as the path search's GoalNear does (as W99)
const cell = (p) => (p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null);
const cellDist = (a, b) => dist(cell(a), cell(b));

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
        const h = b.house;
        const TOKEN = crypto.randomBytes(16).toString('hex');
        process.env.MC_WATCH_TOKEN = TOKEN; // the environment of the agent, which runs in this process
        const port = await freePort();
        check(port !== null, 'precondition: a free port for the watch server in 8090..8190', String(port));
        const url = `http://127.0.0.1:${port}/mcp`;
        const outputs = []; // every output of the client, for the check of the token
        const watch = async (args, opts = {}) => {
            const res = await runWatchClient(args, { url, token: TOKEN, ...opts });
            outputs.push(res.out, res.err);
            note(`watch ${args.join(' ')}${opts.token === null ? ' (no token)' : opts.token ? ' (another token)' : ''}: exit ${res.code} after ${res.ms} ms; out ${JSON.stringify(redact(res.out, TOKEN).slice(0, 600))}${res.err ? `; err ${JSON.stringify(redact(res.err, TOKEN).slice(0, 300))}` : ''}`);
            return res;
        };
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: h.home, playerAt: { x: h.home.x + 2, y: g + 1, z: h.home.z }, kit: KIT,
                settings: RELEASE_SETTINGS({ watch_server: true, watch_port: port }),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const t0 = Date.now();
            note(`the watch port ${port}; the token is set in the environment of the agent (${TOKEN.length} hex characters, not printed)`);

            // ---------------------------------------------------------- 0. the server
            const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'w100', version: '1' } } };
            const up = await waitFor(async () => {
                const res = await rawMcp(url, init, { token: TOKEN });
                return res.status === 200 ? res : null;
            }, { ms: 15000, every: 500 });
            const answer = up.value ?? await rawMcp(url, init, { token: TOKEN });
            note(`0: initialize answered status ${answer.status}: ${JSON.stringify(redact(answer.text, TOKEN).slice(0, 300))}`);
            check(up.ok && answer.json?.result?.serverInfo?.name === 'mindcraft-watch', `0: the watch server answers initialize on 127.0.0.1:${port} with the token (serverInfo mindcraft-watch)`, `status ${answer.status}, ${redact(answer.text, TOKEN).slice(0, 200)}`);
            const bare = await rawMcp(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
            note(`0: tools/list without the token answered status ${bare.status}: ${JSON.stringify(bare.text.slice(0, 200))}`);
            check(bare.status === 401 && bare.json?.error?.code === -32001 && !bare.text.includes(NAME) && !/"tools"/.test(bare.text),
                '0: a POST without the token is 401 with the JSON-RPC error -32001 "unauthorized" and nothing else', `status ${bare.status}, ${bare.text.slice(0, 200)}`);

            // ---------------------------------------------------------- 1. state
            const st = await watch(['state']);
            const server = await entityPos(NAME);
            const timeLine = (await command('time query daytime')).join(' ');
            const serverTime = Number((/The time is (\d+)/.exec(timeLine) ?? [])[1]);
            const m = POS.exec(st.out);
            const pos = m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
            const near1 = pos && server && Math.abs(pos.x - Math.floor(server.x)) <= 1 && Math.abs(pos.y - Math.floor(server.y + 0.01)) <= 1 && Math.abs(pos.z - Math.floor(server.z)) <= 1;
            const time = Number((/\bTime (\d+)\b/.exec(st.out) ?? [])[1]);
            note(`1: the server says the bot is at ${fmt(server)}, the time of day ${serverTime}`);
            check(st.code === 0 && st.out.includes(NAME), '1: `state` answers (exit 0) and names the bot', `exit ${st.code}`);
            check(near1, '1: `state` names the bot\'s position within 1 block of the server\'s', `state ${pos ? JSON.stringify(pos) : 'no position'}, server ${fmt(server)}`);
            check(m?.[4] === 'overworld', '1: `state` names the dimension (overworld)', m ? m[4] : 'no "in <dimension>"');
            check(Number.isFinite(time) && Number.isFinite(serverTime) && Math.abs(time - serverTime) <= 100, '1: `state` names the time of day (within 100 of the server\'s)', `state ${time}, server ${serverTime}`);

            // ---------------------------------------------------------- 2. inventory
            const inv = await watch(['inventory']);
            note(`2: the server says the bot carries ${itemsText(await inventoryOf(NAME))}`);
            check(inv.code === 0 && /^Inventory: /m.test(inv.out) && /\b16 cobblestone\b/.test(inv.out) && /\b5 bread\b/.test(inv.out) && /\b1 stone_pickaxe\b/.test(inv.out),
                '2: `inventory` names the kit: 16 cobblestone, 5 bread, 1 stone_pickaxe', `exit ${inv.code}, ${JSON.stringify(inv.out.slice(0, 200))}`);

            // ---------------------------------------------------------- 3. places
            const home = await orders.order('!rememberArea("home", "home")', 90000);
            note(`3: !rememberArea("home", "home") answered ${JSON.stringify(home.slice(0, 300))}`);
            const area = agent.area_store?.get?.('home') ?? null;
            check(Boolean(area), '3: precondition: the area "home" is saved', JSON.stringify(home.slice(0, 200)));
            const places = await watch(['places']);
            check(places.code === 0 && places.out.includes('home (home)'), '3: `places` names the saved area `home (home)`', `exit ${places.code}, ${JSON.stringify(places.out.slice(0, 300))}`);

            // ---------------------------------------------------------- 4. chat
            const chat = await watch(['chat']);
            const ownerLine = `${PLAYER}: !rememberArea("home", "home")`;
            const botLine = `${NAME}: ${home.split('\n')[0].slice(0, 30)}`;
            check(chat.code === 0 && chat.out.includes(ownerLine), '4: `chat` holds the owner\'s last line', `${JSON.stringify(ownerLine)} in ${JSON.stringify(chat.out.slice(-600))}`);
            check(home.length > 0 && chat.out.includes(botLine), '4: `chat` holds the bot\'s answer', `${JSON.stringify(botLine)} in ${JSON.stringify(chat.out.slice(-600))}`);

            // ---------------------------------------------------------- 5. refused without the token
            for (const [label, token] of [['without the token', null], ['with another token', crypto.randomBytes(16).toString('hex')]]) {
                const res = await watch(['state'], { token });
                const text = res.out + res.err;
                const leaked = text.includes(NAME) || /\(-?\d+, -?\d+, -?\d+\)/.test(text) || /\bTime \d+/.test(text);
                check(res.code === 1 && /unauthorized/i.test(text) && !leaked, `5: \`state\` ${label} is refused: exit 1, the text says unauthorized, nothing of the state`,
                    `exit ${res.code}, ${JSON.stringify(redact(text, TOKEN).slice(0, 200))}`);
            }

            // ---------------------------------------------------------- 6. say "come here"
            const away = h.outsideDoor; // 2 blocks in front of the door, outside
            await command(`tp ${PLAYER} ${away.x + 0.5} ${away.y} ${away.z + 0.5} 180 0`);
            await sleep(1000);
            const a6 = await entityPos(NAME);
            const p6 = await entityPos(PLAYER);
            note(`6: the player at ${fmt(p6)}, the bot at ${fmt(a6)}, ${dist(a6, p6).toFixed(1)} blocks apart`);
            s.route(/come here/, `!goToPlayer("${PLAYER}", 2)`);
            const said = await watch(['say', JSON.stringify({ text: 'come here' })]);
            check(said.code === 0 && said.out.includes(`Said as ${PLAYER}: "come here".`), `6: \`say\` answers at once \`Said as ${PLAYER}: "come here".\``, `exit ${said.code}, ${JSON.stringify(said.out.slice(0, 200))}`);
            const came = await waitFor(async () => {
                const [a, p] = [await entityPos(NAME), await entityPos(PLAYER)];
                return a && p && cellDist(a, p) <= 2 ? a : null;
            }, { ms: 60000, every: 500 });
            const a6b = await entityPos(NAME);
            note(`6: after \`say\` the bot is at ${fmt(a6b)}, ${dist(a6b, await entityPos(PLAYER)).toFixed(1)} blocks from the player; the model was asked ${s.chat.requests.length} time(s)`);
            check(came.ok, '6: after `say "come here"` the bot comes within 2 blocks of the player (between the cells) within 60 s', `${fmt(a6b)}, ${cellDist(a6b, await entityPos(PLAYER)).toFixed(2)} between the cells`);

            // ---------------------------------------------------------- 7. say "/kill"
            const slash = await watch(['say', JSON.stringify({ text: '/kill' })]);
            await sleep(3000);
            const health = await entityNumber(NAME, 'Health');
            check(slash.code === 1 && (slash.out + slash.err).includes(REFUSED_SLASH), `7: \`say "/kill"\` is refused: exit 1, \`${REFUSED_SLASH}\``, `exit ${slash.code}, ${JSON.stringify((slash.out + slash.err).slice(0, 200))}`);
            check(health !== null && health > 0 && (agent.bot.health ?? 0) > 0, '7: the bot lives after `say "/kill"`', `server Health ${health}, the bot's view ${agent.bot.health}`);

            // ---------------------------------------------------------- throughout
            const inLogs = (s.logs ?? []).some((l) => String(l).includes(TOKEN));
            const inOut = outputs.some((o) => String(o).includes(TOKEN));
            check(!inLogs && !inOut, 'the token is in no console line of the agent and in no output of the client', `console ${inLogs ? 'HAS it' : 'no'}, client ${inOut ? 'HAS it' : 'no'}`);
            note(`the bot said ${JSON.stringify(saidLines(s, t0).slice(0, 20))}`);
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
