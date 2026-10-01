// The child process of the play test (release v0.1.4.10, spec I7 T4), started by tests/play/run.js with the control
// of the test server in its environment (MCW_CONTROL, as a scenario of the world tests). It builds the owner variant
// of the base, starts the bot with the chat model of the profile (PLAY_PROFILE) or, with PLAY_FAKE=1, with the fake
// model of the world tests, and lets a second bot, the player, say the sentences of STEPS (play_logic.js) in plain
// words while it walks the way of the journeys W80 and W84. After each sentence it waits for the world fact on the
// server and in the files of the bot. It prints one line `PLAY_ROW <json>` per sentence, `PLAY_COST <line>` and
// `PLAY_END`; run.js makes the table.
//
// The rule of the journeys holds: the bot is never moved by the control; only the player is.
/* global process */
import fs from 'node:fs';
import path from 'node:path';
import {
    note, exitSoon, sleep, withTimeout, startAgent, stopRealAgent, recordAgent, resetBot, orderChannel, commands, placeBot,
    giveItems, waitFor, entityPos, fmt, readWorldFile, routesInFile, minesInFile, recordConsole, importProject, ROOT, env,
    requireControl, MODEL,
} from '../world/helpers.js';
import { setupSettings, copyProfiles } from '../e2e/helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist } from '../world/world.js';
import { basePlan, buildBase, BASE_RADIUS } from '../world/base_world.js';
import {
    JOURNEY_SETTINGS, spots, inBasement, walkPlayer, line, playerDownToBasement, playerUpToHouse, playerOutOfHouse,
    playerIntoHouse, playerDownToRoom, playerToTunnelEnd, countItem, waitBot,
} from '../world/journey.js';
import { STEPS, PLAYER, BOT, FAKE_USAGE, commandIn, rowOf } from './play_logic.js';

const FAKE = process.env.PLAY_FAKE === '1';
const PROFILE = process.env.PLAY_PROFILE || path.join(ROOT, 'profiles', 'claude.json');
const KIT = [['ladder', 8], ['torch', 16], ['stone_pickaxe', 1]];
const LANDING_TOP = 28; // feet below this: the landing or the tunnel of the base

// The bot with the chat model of the profile: the real Agent.start as startRealAgent of the end-to-end tests, without
// the fake models and without blocking the model classes.
async function startWithModel(name, overrides) {
    requireControl();
    const logs = recordConsole('log');
    copyProfiles();
    const fileProfile = JSON.parse(fs.readFileSync(PROFILE, 'utf8'));
    const settings = await setupSettings(name, env.port, {
        world_memory: false, speak: false, render_bot_view: false, log_all_prompts: false,
        allow_vision: false, only_chat_with: [], code_timeout_mins: -1,
        ...overrides,
        profile: { ...fileProfile, ...(overrides.profile || {}), name, cooldown: 0 },
    });
    const { Agent } = await importProject('src/agent/agent.js');
    const { serverProxy } = await importProject('src/agent/mindserver_proxy.js');
    serverProxy.socket = { emit() {}, on() {} };
    const agent = new Agent();
    serverProxy.setAgent(agent);
    await withTimeout(agent.start(false, null, 0, false), 30000, 'Agent.start');
    await withTimeout(new Promise((r) => agent.bot.once('spawn', r)), 20000, 'agent spawn');
    const t0 = Date.now();
    while (typeof agent.respondFunc !== 'function') {
        if (Date.now() - t0 > 10000) throw new Error('spawn handler did not set up the event handlers within 10 s');
        await sleep(50);
    }
    const started = { agent, settings, logs, realCalls: [], route() { /* the real model chooses */ } };
    recordAgent(started);
    await sleep(3500); // the server ignores actions for 3 s after a spawn (README of the world tests)
    return started;
}

const costOf = (agent) => {
    const t = agent.cost_meter?.totals?.();
    return t ? { dollars: t.dollars, calls: t.calls } : { dollars: 0, calls: 0 };
};

function boxHolds(area, p) {
    const min = area?.min, max = area?.max;
    return Boolean(min && max) && p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y && p.z >= min.z && p.z <= max.z;
}

async function main() {
    const r = region(BASE_RADIUS);
    if (env.world !== 'base') throw new Error(`the play test runs in the base world, not in ${env.world}`);
    await prepareRegion(r, 30);
    const b = basePlan(r, { owner: true });
    await buildBase(b);
    const sp = spots(b);
    const g = b.g;
    const settings = { ...JOURNEY_SETTINGS(), cost_meter: true };
    let s = null, agent = null, orders = null;
    const rows = [];
    try {
        s = FAKE
            ? await startAgent(BOT, settings, { usage: () => ({ model: MODEL, ...FAKE_USAGE }) })
            : await startWithModel(BOT, settings);
        agent = s.agent;
        await resetBot(BOT);
        await commands(['gamerule doDaylightCycle false', 'time set 6000']);
        await placeBot(agent, { x: sp.houseMiddle.x - 1, y: g + 1, z: sp.houseMiddle.z + 1 }, 180);
        await giveItems(BOT, KIT, agent.bot);
        orders = await orderChannel(s, { name: PLAYER, at: sp.besideTrapdoor });

        // Says the sentence of a step and finds the command the model chose (its first command after the sentence).
        const say = async (step) => {
            if (FAKE) s.route(new RegExp(`${PLAYER}: ${step.say}`, 'i'), step.fake);
            const from = s.added.length;
            const before = costOf(agent);
            orders.say(step.say);
            const chose = await waitFor(() => s.added.slice(from).map((a) => (a.name === agent.name ? commandIn(a.content) : null)).find(Boolean), { ms: 30000, every: 200 });
            return { chose: chose.value ?? null, before };
        };
        const finish = (step, said, fact) => {
            const after = costOf(agent);
            const row = rowOf(step, { chose: said.chose, pass: fact.ok, detail: fact.detail, dollars: after.dollars - said.before.dollars, calls: after.calls - said.before.calls });
            rows.push(row);
            console.log(`PLAY_ROW ${JSON.stringify(row)}`);
            return fact.ok;
        };
        const step = (id) => STEPS.find((x) => x.id === id);
        const wait = (st, pred) => waitFor(pred, { ms: st.ms, every: 400 });

        // "this is home": an area holds the middle of the house
        let st = step('home');
        let said = await say(st);
        let w = await wait(st, () => (agent.area_store?.list?.() ?? []).find((a) => boxHolds(a, sp.houseMiddle)));
        finish(st, said, { ok: w.ok, detail: w.ok ? `"${w.value.name}"` : `areas ${JSON.stringify((agent.area_store?.list?.() ?? []).map((a) => a.name))}` });

        // "follow me": the player goes down ladder 1 into the basement
        st = step('follow_down');
        said = await say(st);
        await sleep(2000);
        await playerDownToBasement(b);
        let wb = await waitBot(agent, 'follow me: the bot is in the basement', (a) => inBasement(b, a), st.ms);
        finish(st, said, { ok: wb.ok, detail: fmt(wb.bot) });

        // "remember the path here": a way with a ladder
        st = step('route');
        said = await say(st);
        w = await wait(st, () => routesInFile(agent).find((x) => (x.legs ?? []).some((l) => l.kind === 'ladder')));
        finish(st, said, { ok: w.ok, detail: w.ok ? `"${w.value.name}"` : `${routesInFile(agent).length} routes` });

        // "come here": the player is back in the house
        st = step('come_up');
        await playerUpToHouse(b, sp.basementWait);
        await walkPlayer(line(sp.besideTrapdoor, { x: sp.houseMiddle.x, y: g + 1, z: sp.besideTrapdoor.z }));
        said = await say(st);
        wb = await waitBot(agent, 'come here: the bot is in the house', (a) => inBox(a, b.house.interior), st.ms);
        finish(st, said, { ok: wb.ok, detail: fmt(wb.bot) });

        // "go to the basement"
        st = step('basement');
        await sleep(2000);
        said = await say(st);
        wb = await waitBot(agent, 'go to the basement: the bot is in the basement', (a) => inBasement(b, a), st.ms);
        finish(st, said, { ok: wb.ok, detail: fmt(wb.bot) });

        // "follow me" from the basement: up, out under the open sky, back in, down both ladders, into the tunnel
        st = step('follow_mine');
        const here = await entityPos(PLAYER);
        await walkPlayer(line({ x: Math.floor(here.x), y: g + 1, z: Math.floor(here.z) }, sp.besideTrapdoor));
        await playerDownToBasement(b);
        await sleep(2000);
        said = await say(st);
        await sleep(2000);
        const outsideBox = { min: { x: b.house.box.min.x - 6, y: g + 1, z: b.house.box.min.z - 12 }, max: { x: b.house.box.max.x + 6, y: g + 3, z: b.house.box.min.z - 1 } };
        const legs = [
            ['up ladder 1 into the house', () => playerUpToHouse(b, sp.basementWait), (a) => inBox(a, b.house.interior), 60000],
            ['out of the house', () => playerOutOfHouse(b, sp.besideTrapdoor), (a) => inBox(a, outsideBox), 60000],
            ['down ladder 1 into the basement', async () => { await sleep(3000); await playerIntoHouse(b, sp.outside); await sleep(2000); await playerDownToBasement(b); }, (a) => inBasement(b, a), 60000],
            ['down ladder 2 into the room', () => playerDownToRoom(b, sp.basementWait), (a) => inBox(a, b.room.box), 60000],
            ['into the tunnel', () => playerToTunnelEnd(b, sp.roomWait), (a, p) => dist(a, p) <= 5 && a.y < LANDING_TOP, 90000],
        ];
        let failedLeg = null;
        for (const [label, walk, pred, ms] of legs) {
            await walk();
            const lw = await waitBot(agent, `follow me: ${label}`, pred, ms);
            if (!lw.ok) { failedLeg = `${label}: no, the bot at ${fmt(lw.bot)}`; break; }
        }
        const followed = finish(st, said, { ok: failedLeg === null, detail: failedLeg ?? 'every leg' });

        if (!followed) {
            for (const id of ['mine', 'iron']) {
                const row = rowOf(step(id), { skipped: true, detail: 'the bot did not follow into the mine' });
                rows.push(row);
                console.log(`PLAY_ROW ${JSON.stringify(row)}`);
            }
        } else {
            // "this is the mine"
            st = step('mine');
            await sleep(1500);
            said = await say(st);
            w = await wait(st, () => minesInFile(agent).find((m) => m.source === 'player'));
            finish(st, said, { ok: w.ok, detail: w.ok ? `"${w.value.name}"` : `${minesInFile(agent).length} mines` });

            // "find some iron": 4 iron ore beyond the end of the tunnel
            st = step('iron');
            const t = b.tunnel;
            const ores = [2, 4].flatMap((k) => [0, 1].map((dy) => ({ x: t.end.x, y: t.end.y + dy, z: t.end.z + k })));
            await commands(ores.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:iron_ore`));
            const before = countItem(agent, 'raw_iron');
            said = await say(st);
            w = await wait(st, () => countItem(agent, 'raw_iron') - before >= 4);
            finish(st, said, { ok: w.ok, detail: `${countItem(agent, 'raw_iron') - before} raw_iron, the bot at ${fmt(await entityPos(BOT))}` });
        }
        const line_ = agent.cost_meter?.reportLine?.() ?? null;
        console.log(`PLAY_COST ${line_ ?? ''}`);
        if (FAKE) note(`requests that reached a real model class: ${s.realCalls.length}`);
    } finally {
        if (orders) await orders.quit();
        await stopRealAgent(agent);
        await releaseRegion(r).catch(() => {});
    }
    console.log(`PLAY_END ${rows.length}`);
}

main().then(
    () => { process.exitCode = 0; exitSoon(); },
    (e) => { console.log(`PLAY_ERROR ${e?.stack ?? e}`); process.exitCode = 1; exitSoon(); },
);
