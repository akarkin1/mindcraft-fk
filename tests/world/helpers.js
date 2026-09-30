// Shared code of the world tests: the real agent on the real server, a plain mineflayer bot that
// plays the player, waiting for observable state, traces for the report of a failing scenario.
//
// The checks, the phases, the fake language model and the start of the real agent come from the
// end-to-end framework of the earlier releases (tests/e2e/helpers.js) and are imported, not copied.
import mineflayer from 'mineflayer';
import {
    check, note, scenarioMain, sleep, withTimeout, errText, importProject, startRealAgent, stopRealAgent,
    runCommand, runPhase, emitData, recordConsole, readJson, listFiles, exitSoon, MODES_OFF, MODEL, ROOT,
} from '../e2e/helpers.js';
import { env, haveControl, command, commands } from './control.js';
import { OWNER_PORT } from './mc_server.js';
import { entityPos, positions, fmt, tp } from './world.js';

export {
    check, note, scenarioMain, sleep, withTimeout, errText, importProject, stopRealAgent, runCommand, runPhase,
    emitData, recordConsole, readJson, listFiles, exitSoon, MODES_OFF, MODEL, ROOT, env,
};

// The settings of releases v0.1.4.6 and v0.1.4.7, all off (the "Flags off" scenarios and the base of
// the others). The four switches of v0.1.4.7 are off here too, so the scenarios of v0.1.4.6 run as
// before whatever the owner sets in settings.js.
export const NEW_FLAGS_OFF = {
    cost_meter: false, protected_areas: false, player_rules: false, home_pack: false, creeper_fighting: false,
    max_command_result_chars: 0,
    storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false,
};

// The switches of v0.1.4.6 and v0.1.4.7 as the owner plays (his settings.js of the play test of v0.1.4.7:
// every pack on, protected areas and rules on, creeper_fighting off). The base of the scenarios of v0.1.4.8
// in the base world; the settings of v0.1.4.8 come on top (FLAGS_0148_OFF, FLAGS_0148_ON).
export const OWNER_SWITCHES = Object.freeze({
    ...NEW_FLAGS_OFF, world_memory: true, protected_areas: true, player_rules: true, home_pack: true, creeper_fighting: false,
    storage_pack: true, farming_pack: true, wood_pack: true, mining_pack: true, max_command_result_chars: 3000, keep_items: {},
});

// The commands of release v0.1.4.6 that the model may see only while their part is on.
export const NEW_COMMANDS = {
    protected_areas: ['!rememberArea', '!setArea', '!forgetArea', '!areas', '!allowChanges'],
    player_rules: ['!rememberRule', '!forgetRule', '!rules'],
    home_pack: ['!goToShelter', '!eat'],
};
export const NEW_MODES = ['creeper_safety', 'night_shelter', 'door_closing'];

// The commands of release v0.1.4.7 by switch (spec S4, F3, T5, M5).
export const WORK_COMMANDS = {
    storage_pack: ['!storeItems', '!fetchItem', '!chests'],
    farming_pack: ['!farmCycle', '!harvest', '!plant', '!makeBoneMeal', '!fertilize'],
    wood_pack: ['!chopTrees', '!getTool', '!craftSupplies'],
    mining_pack: ['!mineOre', '!goToMine', '!leaveMine'],
};

// Gives items to a player through the console: { name: count } or [[name, count], ...]. With the
// agent's bot as `bot`, it waits until the bot's own view of its inventory has them (the server
// confirms the give before the bot has the packet; a command that starts at once would not see them).
export async function giveItems(player, items, bot = null) {
    const list = Array.isArray(items) ? items : Object.entries(items);
    const count = (name) => (bot ? bot.inventory.items().filter((i) => i.name === name).reduce((n, i) => n + i.count, 0) : 0);
    const before = Object.fromEntries(list.map(([n]) => [n, count(n)]));
    const out = await commands(list.map(([n, c]) => `give ${player} ${n.includes(':') ? n : 'minecraft:' + n} ${c}`));
    const bad = out.flat().filter((l) => /Unknown item|Expected|Invalid|No player was found|Can't give/.test(l));
    if (bad.length) throw new Error('give failed: ' + bad.slice(0, 3).join(' | '));
    if (bot) {
        const want = {};
        for (const [n, c] of list) want[n] = (want[n] ?? before[n]) + c;
        const seen = await waitFor(() => Object.entries(want).every(([n, c]) => count(n) >= c), { ms: 8000, every: 50 });
        if (!seen.ok) note(`give: the bot does not see all items yet: ${Object.keys(want).map((n) => `${n} ${count(n)} of ${want[n]}`).join(', ')}`);
        await sleep(200);
    }
    return out;
}

// Runs fn(bot, ctx) of a work pack as an action of the agent, the way the commands of the glue do
// (`ctx` is agent.packContext()), for the functions of the spec that have no command of their own.
// Resolves with { result, action, ms }: the result object of the pack function, or
// { ok: false, reason: 'threw', text } when it threw (the spec says it never throws).
// v0.1.4.8, I1: the glue pauses the mode unstuck at the start of every pack command (runPack); a pack
// function run here gets the same, so that with the modes of the owner on it runs as it would inside
// its command (!mineOre runs descendToLevel, setupMineBase and digTunnel).
export async function runSkill(agent, label, fn, ms = 300000) {
    const t0 = Date.now();
    let result = null;
    const action = await withTimeout(agent.actions.runAction(`action:${label}`, async () => {
        try {
            if (agent.bot.modes?.exists?.('unstuck')) agent.bot.modes.pause('unstuck');
            result = await fn(agent.bot, agent.packContext());
        } catch (e) {
            result = { ok: false, reason: 'threw', text: errText(e) };
        }
    }, { timeout: ms / 60000 }), ms + 10000, label).catch((e) => ({ error: e.message }));
    return { result, action, ms: Date.now() - t0 };
}

// ------------------------------------------------------------------ mining (v0.1.4.7, part M)

// The settings of the mining scenarios: the owner's parts of v0.1.4.6 that matter underground and
// the mining pack with a time limit that fits a test.
export const MINING_SETTINGS = {
    ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true, mining_pack: true, mining_max_minutes: 12,
};

// What a bot takes on a mining trip when the scenario is not about preparing it (tripNeeds of M2:
// ladders for the depth, 16 torches, 32 cobblestone, 8 food, a pickaxe and a spare, a chest).
export const MINING_KIT = [
    ['iron_pickaxe', 2], ['ladder', 64], ['torch', 32], ['cobblestone', 64], ['bread', 16], ['chest', 2],
];

// Watches the health of the agent's bot from its own view (every change, not samples: in peaceful
// the health comes back within seconds). stop() resolves with { min, hurt: [{ t, health }] }.
export function watchHealth(bot) {
    const t0 = Date.now();
    const hurt = [];
    let min = bot.health ?? 20;
    let last = bot.health ?? 20;
    const on = () => {
        const h = bot.health;
        if (typeof h !== 'number') return;
        if (h < last) hurt.push({ t: (Date.now() - t0) / 1000, health: h });
        last = h;
        min = Math.min(min, h);
    };
    bot.on('health', on);
    return {
        stop() { bot.removeListener('health', on); return { min, hurt }; },
    };
}

// The largest drop of the feet between two samples of a trace of { pos } rows, and where it was.
export function largestDrop(rows) {
    let best = { drop: 0, from: null, to: null, t: 0 };
    for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1].pos, b = rows[i].pos;
        if (!a || !b) continue;
        const d = a.y - b.y;
        if (d > best.drop) best = { drop: d, from: a, to: b, t: rows[i].t };
    }
    return best;
}

// The first turn of the agent's history that contains `part` (the result of a command that the
// model gave, as the agent adds it), or ''.
export function historyTurn(agent, part) {
    const turns = (agent.history?.turns ?? []).map((t) => String(t.content));
    return turns.find((t) => t.includes(part)) ?? '';
}

export function requireControl() {
    if (!haveControl()) throw new Error('this scenario runs only through tests/world/run.js (MCW_CONTROL is not set)');
    if (env.port === OWNER_PORT) throw new Error('refusing the port of the owner');
}

// ------------------------------------------------------------------ the real agent

// Starts the real Agent (Agent.start, its lockdown, prompter, modes, spawn handler) against the real
// server. The language model is the fake of the end-to-end tests; every request is printed as a
// MODEL line. Returns { agent, settings, chat, code, realCalls, route }.
//
// route(re, reply): the next chat request whose last turn matches re gets this reply (once). A
// request that matches no route gets the next queued reply of the fake (chat.replies), or ''.
// So a late automatic request (the AUTO MESSAGE after a reflex) cannot take the reply that is meant
// for a player's message.
// options.usage(request): when given, every request of either fake model reports this usage
// ({ model, input_tokens, output_tokens }) through reportUsage of src/agent/cost/usage_context.js,
// the way the Claude adapter does (spec C4, amendment 1: fakes report usage themselves).
//
// v0.1.4.8: every started agent is recorded (see recordAgent): the messages it handles, what it says,
// its behaviour log, its history and every line of its console (started.logs). options.killExpected:
// cleanKill ends the process as in play; without this option it also prints a failed check first, so
// the report says why the scenario ended. When the profile sets modes, a check proves that they are
// set as asked (a mode that the settings leave out would otherwise go unnoticed).
export async function startAgent(name, overrides = {}, options = {}) {
    requireControl();
    let reportUsage = null;
    if (options.usage) ({ reportUsage } = await importProject('src/agent/cost/usage_context.js'));
    const logs = recordConsole('log'); // before the lockdown, which wraps console.log like the original
    const started = await startRealAgent(name, env.port, { ...overrides });
    started.logs = logs;
    recordAgent(started, options);
    const wanted = overrides.profile?.modes;
    if (wanted && typeof wanted === 'object') {
        const modes = started.agent.bot.modes;
        const wrong = Object.entries(wanted).filter(([m, on]) => (modes.exists(m) ? modes.isOn(m) !== on : on === true));
        note(`modes of the agent: ${JSON.stringify(modes.getJson())}`);
        check(wrong.length === 0, 'the modes of the agent are as the profile of the scenario sets them',
            wrong.map(([m, on]) => `${m}: wanted ${on}, ${modes.exists(m) ? 'is ' + modes.isOn(m) : 'does not exist'}`).join('; '));
    }
    // The 1.21.8 server ignores every action of a player (dig, place, use) until the client reports
    // that it has loaded the world (packet player_loaded, new in 1.21.4) or 60 ticks have passed.
    // mineflayer 4.33 never sends that packet: a dig in the first 3 s after the spawn is dropped
    // without an answer (seen on the test server). Wait until the server accepts actions.
    await sleep(3500);
    const { chat, code } = started;
    const routes = [];
    started.route = (re, reply) => { routes.push({ re, reply }); };
    started.routes = routes;
    started.sent = []; // every reply of the fakes: { label, reply, t }
    for (const m of [chat, code]) {
        const orig = m.sendRequest;
        m.sendRequest = async function (turns, systemMessage) {
            const last = Array.isArray(turns) && turns.length ? turns[turns.length - 1] : null;
            const lastText = last ? String(last.content) : '';
            const text = lastText.replace(/\s+/g, ' ').slice(0, 160);
            let reply;
            const i = m.label === 'chat' ? routes.findIndex((r) => r.re.test(lastText)) : -1;
            if (i >= 0) {
                const rt = routes.splice(i, 1)[0];
                m.requests.push({ kind: m.label, prompt: String(systemMessage ?? ''), turns: JSON.parse(JSON.stringify(turns ?? [])), routed: true });
                reply = typeof rt.reply === 'function' ? rt.reply() : rt.reply;
            } else {
                reply = await orig.call(m, turns, systemMessage);
            }
            if (reportUsage) reportUsage(options.usage(m.requests[m.requests.length - 1]));
            started.sent.push({ label: m.label, reply: String(reply), t: Date.now() });
            console.log(`MODEL ${m.label} request ${m.requests.length}: last turn ${JSON.stringify(text)} -> reply ${JSON.stringify(String(reply).slice(0, 120))}`);
            return reply;
        };
    }
    return started;
}

// ------------------------------------------------------------------ v0.1.4.8: the modes of the owner

// The reflexes of the home pack (settings.home_reflexes). The modes exist only while home_pack is on.
export const HOME_REFLEXES = Object.freeze({ door_closing: true, night_shelter: true, creeper_safety: true, hunger: true });

// The modes of profiles/defaults/assistant.json, the base profile of the owner, plus the home reflexes
// (spec v0.1.4.8 section 12, T2.1). Every scenario that tests a skill runs with them.
export const MODES_PROFILE = Object.freeze({
    self_preservation: true, unstuck: true, cowardice: false, self_defense: true, hunting: false,
    item_collecting: true, torch_placing: true, elbow_room: true, idle_staring: true, cheat: false,
    ...HOME_REFLEXES,
});

// The settings of a scenario with the modes of the owner: home_pack on with all its reflexes (the pack
// brings the reflexes), and MODES_PROFILE as the modes of the profile. `modes` changes single modes.
export function withModes(settings = {}, modes = {}) {
    return {
        ...settings,
        home_pack: true,
        home_reflexes: { ...(settings.home_reflexes || {}), ...HOME_REFLEXES },
        profile: { ...(settings.profile || {}), modes: { ...MODES_PROFILE, ...modes } },
    };
}

// The new settings of v0.1.4.8 (spec section 2) with their defaults: the behaviour of v0.1.4.7. The
// flags-off scenario and the base of the others; a scenario switches on what it tests.
export const FLAGS_0148_OFF = Object.freeze({
    stuck_restart_after: 1, protect_built_blocks: false, knowledge_in_prompt: false, knowledge_max_chars: 600,
    repeat_guard: 0, restart_context: false, say_results: false, flee_below_health: 0, log_timestamps: false,
    examples_by_last_request: false,
});

// Every setting of v0.1.4.8 on, as the owner will play with it (the long run W60).
export const FLAGS_0148_ON = Object.freeze({
    stuck_restart_after: 3, protect_built_blocks: true, knowledge_in_prompt: true, knowledge_max_chars: 600,
    repeat_guard: 3, restart_context: true, say_results: true, flee_below_health: 8, log_timestamps: true,
    examples_by_last_request: true,
});

// The commands of v0.1.4.8 by switch (spec section 11, 10). !chests and !mineOre existed before.
export const COMMANDS_0148 = { always: ['!pickUpItems'], home_pack: ['!closeDoor'] };

// The texts of the mode unstuck (spec A2).
export const STUCK_SAID = "I'm stuck!";
export const FREE_SAID = "I'm free.";

// ------------------------------------------------------------------ v0.1.4.8: what the agent did

// Records what a started agent does, without changing it (every wrapper calls the original):
//   started.messages  every call of handleMessage: { source, message, t0, t1, done, value, error, result }
//                     `result` is the text that a command typed by a player answered in the chat
//   started.routeCalls every routeResponse: { to, message, t, claimed } (started.routes is the list of the
//                     routed replies of the fake model, see startAgent)
//   started.chats     every openChat (the chat of the bot, also the texts of the modes): { text, t }
//   started.behavior  every line that went into the behaviour log of the modes: { text, t }
//   started.added     every history.add: { name, content, t }
//   started.killed    the text of cleanKill, or null
// A rejection of handleMessage stays unhandled, as without the recorder.
const USED_LINE = /^\*\S+ used \S+\*$/;

function claimResult(started, m) {
    const found = started.routeCalls.slice(m.routeFrom).filter((x) => x.to === m.source && !x.claimed && !USED_LINE.test(x.message));
    const last = found[found.length - 1];
    if (!last) return '';
    last.claimed = true;
    return last.message;
}

export function recordAgent(started, options = {}) {
    const agent = started.agent;
    if (started.messages) return started;
    Object.assign(started, { messages: [], routeCalls: [], chats: [], behavior: [], added: [], killed: null });
    const handle = agent.handleMessage;
    agent.handleMessage = function recordedHandle(source, message, max) {
        const m = { source, message: String(message), t0: Date.now(), t1: null, done: false, routeFrom: started.routeCalls.length, addedFrom: started.added.length };
        started.messages.push(m);
        const p = handle.call(this, source, message, max);
        p.then((v) => { m.t1 = Date.now(); m.value = v; m.result = claimResult(started, m); m.done = true; },
            (e) => { m.t1 = Date.now(); m.error = e; m.done = true; throw e; });
        return p;
    };
    const route = agent.routeResponse;
    agent.routeResponse = function recordedRoute(to, message) {
        started.routeCalls.push({ to, message: String(message), t: Date.now(), claimed: false });
        return route.call(this, to, message);
    };
    const open = agent.openChat;
    agent.openChat = function recordedChat(message) {
        started.chats.push({ text: String(message), t: Date.now() });
        return open.call(this, message);
    };
    started.killExpected = Boolean(options.killExpected); // a scenario may set it before a kill it expects
    const kill = agent.cleanKill;
    agent.cleanKill = function recordedKill(msg, code) {
        started.killed = String(msg ?? '');
        console.log(`${started.killExpected ? 'NOTE' : 'CHECK FAIL'} the agent process was ended by cleanKill: ${msg}`);
        return kill.call(this, msg, code);
    };
    const history = agent.history;
    const add = history.add;
    history.add = function recordedAdd(name, content) {
        started.added.push({ name, content: String(content), t: Date.now() });
        return add.apply(this, arguments);
    };
    const modes = agent.bot?.modes;
    if (modes) {
        let value = String(modes.behavior_log ?? '');
        Object.defineProperty(modes, 'behavior_log', {
            configurable: true, enumerable: true,
            get() { return value; },
            set(v) {
                const s = String(v);
                if (s.length > value.length && s.startsWith(value)) {
                    for (const line of s.slice(value.length).split('\n')) if (line.trim()) started.behavior.push({ text: line, t: Date.now() });
                }
                value = s;
            },
        });
    }
    return started;
}

// Lines of the behaviour log (and of the chat of the bot) since t that contain `part`.
export function saidSince(started, part, t = 0) {
    const lines = [...started.behavior.filter((x) => x.t >= t).map((x) => x.text), ...started.chats.filter((x) => x.t >= t).map((x) => x.text)];
    return lines.filter((l) => l.includes(part));
}

// ------------------------------------------------------------------ v0.1.4.8: orders in the chat

// The player who gives the orders (spec section 12, T2.1: "gives the order as a chat command"): a plain
// mineflayer bot types the command in the chat, and the agent runs it through its real path (respondFunc,
// handleMessage, the branch of a command typed by a player: last_order is set, the model is not asked).
//   ch.order(text, ms)      types a command and waits for its answer; resolves with the text the agent
//                           answered in the chat, '' when it answered nothing, '(timeout)' when it did not
//                           end within ms (it keeps running), '(not received)' when the agent never got it
//   ch.orderInfo(text, ms)  the same with details: { reply, text, arrived, done, ms, stopped, record }
//                           `stopped`: the history lines "... was stopped by ..." added while it ran (I5)
//   ch.say(text)            a chat message (for the model); ch.player, ch.quit()
// The player is in creative mode (monsters leave it alone) and stands at `at`.
export async function orderChannel(started, { name = 'w_player', at = null, gamemode = 'creative' } = {}) {
    recordAgent(started);
    const player = await connectPlayer(name);
    await command(`gamemode ${gamemode} ${name}`);
    if (at) {
        await tp(name, at);
        await waitFor(() => player.entity && Math.hypot(player.entity.position.x - (at.x + 0.5), player.entity.position.z - (at.z + 0.5)) < 1, { ms: 5000, every: 50 });
    }
    const agentSees = await waitFor(() => Boolean(started.agent.bot.players?.[name]), { ms: 10000, every: 100 });
    if (!agentSees.ok) note(`the agent does not list the player ${name} yet`);
    const ch = { player, name, log: [] };
    ch.say = (text) => player.chat(text);
    ch.quit = () => quitPlayer(player);
    ch.orderInfo = async (text, ms = 60000) => {
        const from = started.messages.length;
        const t0 = Date.now();
        player.chat(text);
        const got = await waitFor(() => started.messages.slice(from).find((m) => m.source === name && m.message === text), { ms: 15000, every: 50 });
        if (!got.ok) {
            const info = { text, reply: '(not received)', arrived: false, done: false, ms: Date.now() - t0, stopped: [], record: null };
            ch.log.push(info);
            note(`order ${text}: the agent did not receive it within 15 s`);
            return info;
        }
        const m = got.value;
        const done = await waitFor(() => m.done, { ms, every: 100 });
        const stopped = started.added.slice(m.addedFrom).filter((a) => a.name === 'system' && /was stopped by/.test(a.content)).map((a) => a.content);
        const info = {
            text, arrived: true, done: done.ok, ms: Date.now() - t0, stopped, record: m,
            reply: done.ok ? (m.result ?? '') : '(timeout)',
        };
        if (!done.ok) note(`order ${text}: no answer within ${ms} ms, it keeps running`);
        ch.log.push(info);
        return info;
    };
    ch.order = async (text, ms = 60000) => (await ch.orderInfo(text, ms)).reply;
    return ch;
}

// ------------------------------------------------------------------ the player

// A plain mineflayer bot (no plugins) that plays the player: it chats, stands in doorways and is
// moved by console commands. Everything it hears is kept in `heard` as { from, text, t }.
export async function connectPlayer(name, { ms = 20000 } = {}) {
    requireControl();
    const bot = mineflayer.createBot({
        host: '127.0.0.1', port: env.port, username: name, auth: 'offline', version: '1.21.8',
        checkTimeoutInterval: 60000, hideErrors: true,
    });
    bot.heard = [];
    bot.on('chat', (from, text) => { bot.heard.push({ from, text, t: Date.now() }); });
    bot.on('messagestr', (text, position) => {
        if (position === 'system' || position === 'game_info') bot.heard.push({ from: null, text, t: Date.now() });
    });
    bot.on('error', (e) => console.log(`  [player ${name} error] ${errText(e)}`));
    bot.on('kicked', (r) => console.log(`  [player ${name} kicked] ${JSON.stringify(r)}`));
    await withTimeout(new Promise((resolve) => bot.once('spawn', resolve)), ms, `player ${name} spawn`);
    return bot;
}

export async function quitPlayer(bot) {
    if (!bot) return;
    const endP = new Promise((r) => bot.once('end', r));
    try { bot.quit(); } catch { /* gone */ }
    await withTimeout(endP, 5000, 'player end').catch((e) => note(e.message));
}

// What `from` said in the chat since time t (the agent's chat seen by the player).
export function heardFrom(player, from, since = 0) {
    return player.heard.filter((h) => h.from === from && h.t >= since).map((h) => h.text);
}

// ------------------------------------------------------------------ waiting

// Polls fn (may be async) until it returns a truthy value; resolves with { ok, value, ms }.
export async function waitFor(fn, { ms = 10000, every = 250, label = '' } = {}) {
    const t0 = Date.now();
    let value;
    for (;;) {
        try { value = await fn(); } catch (e) { value = undefined; if (Date.now() - t0 >= ms) note(`${label}: ${e.message}`); }
        if (value) return { ok: true, value, ms: Date.now() - t0 };
        if (Date.now() - t0 >= ms) return { ok: false, value, ms: Date.now() - t0 };
        await sleep(every);
    }
}

// Waits until the agent is idle (no action runs), at most ms.
export async function waitIdle(agent, ms = 30000) {
    return waitFor(() => !agent.actions.executing, { ms, every: 100, label: 'agent idle' });
}

// Runs a command through the real parser with a time limit; resolves with its reply or with
// "(timeout)" (the command keeps running; the caller may !stop it).
export async function command_(agent, text, ms = 60000) {
    try {
        return await withTimeout(runCommand(agent, text), ms, text);
    } catch (e) {
        note(`${text}: ${e.message}`);
        return '(timeout)';
    }
}

// ------------------------------------------------------------------ traces

// Samples fn every `every` ms into rows until stop(); every row is { t (s since start), ...fn() }.
export function startTrace(fn, every = 500) {
    const rows = [];
    const t0 = Date.now();
    let stopped = false;
    const loop = (async () => {
        while (!stopped) {
            const t = (Date.now() - t0) / 1000;
            try { rows.push({ t, ...(await fn()) }); } catch (e) { rows.push({ t, error: e.message }); }
            await sleep(every);
        }
    })();
    return {
        rows,
        async stop() { stopped = true; await loop; return rows; },
    };
}

// Prints a trace as TRACE lines: one line per row, the values formatted by `cols`.
export function printTrace(title, rows, cols, max = 80) {
    console.log(`TRACE ${title} (${rows.length} samples${rows.length > max ? ', every ' + Math.ceil(rows.length / max) + '. shown' : ''})`);
    const step = Math.max(1, Math.ceil(rows.length / max));
    for (let i = 0; i < rows.length; i += step) {
        const r = rows[i];
        console.log(`TRACE   t=${r.t.toFixed(1)}s ` + (r.error ? 'error ' + r.error : Object.entries(cols).map(([k, f]) => `${k}=${f(r)}`).join(' ')));
    }
}

// The position of the agent's bot from the server (authoritative) and from its own view.
export async function botWhere(agent) {
    const server = await entityPos(agent.name);
    const view = agent.bot?.entity?.position ?? null;
    return { server, view: view ? { x: view.x, y: view.y, z: view.z } : null };
}

export { entityPos, positions, fmt, tp, command, commands };

// Puts the agent's bot at a place: teleport, wait until the bot's own view arrived there, and clear
// its velocity. Returns the server position.
export async function placeBot(agent, p, yaw = 0) {
    await tp(agent.name, p, yaw, 0);
    const target = { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
    await waitFor(() => {
        const v = agent.bot?.entity?.position;
        return v && Math.hypot(v.x - target.x, v.z - target.z) < 0.3 && Math.abs(v.y - target.y) < 1.1;
    }, { ms: 5000, every: 50, label: 'bot teleported' });
    await sleep(300);
    return entityPos(agent.name);
}

// Survival mode, full health and food, empty inventory, no effects.
export async function resetBot(name, { gamemode = 'survival' } = {}) {
    return commands([
        `gamemode ${gamemode} ${name}`, `clear ${name}`, `effect clear ${name}`,
        `effect give ${name} minecraft:instant_health 1 10 true`, `effect give ${name} minecraft:saturation 1 10 true`,
    ]);
}

// The labels of the actions the agent ran, from the console lines of the action manager.
export function actionLabels(logLines) {
    return logLines.map((l) => /executing code\.\.\.|Mode (\w+) finished executing/.exec(l)).filter(Boolean).map((m) => m[0]);
}
