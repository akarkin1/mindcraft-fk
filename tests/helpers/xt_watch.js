// Fixtures of the tests from the spec (v0.1.4.13, T1, tests/unit/xt_*.test.js): a fake agent and a fake watch
// state for the watch tools (spec 4.1), a fake clock, staged snapshots of the digest, and a block reader over the
// block world for the look tool. Nothing here reads the code under test; the shapes follow the spec and the
// handoff (a snapshot: position, dimension, health, food, the running command and its start, the job line, the
// inventory counts, the item in hand with its uses, the chat and event indexes, the hazards, the nearest chest).
import { Ring } from '../../src/agent/watch/events_logic.js';
import { vec } from './block_world.js';

/** 06:45:12 local time on 2026-10-04, the clock of the spec's example lines. */
export const T0 = new Date(2026, 9, 4, 6, 45, 12).getTime();

/** A clock the tests move by hand: now(), tick(ms), set(ms). */
export function makeClock(start = T0) {
    let t = start;
    return {
        now: () => t,
        tick: (ms) => { t += ms; return t; },
        set: (ms) => { t = ms; return t; },
    };
}

/**
 * A staged snapshot of the digest with the facts of the spec's example as defaults.
 * @param {object} [overrides]
 */
export function makeSnapshot(overrides = {}) {
    return {
        t: T0,
        pos: { x: 31, y: -59, z: -99 },
        dimension: 'overworld',
        health: 20,
        food: 15,
        running: { text: '!mineOre("diamond", 28, false)', startedAt: T0 - 138000 },
        job: 'Job: the mining, 7 of 28 diamond, step 2 of 3.',
        inventory: { diamond: 7, lapis_lazuli: 25, iron_pickaxe: 1, bread: 4 },
        hand: { name: 'iron_pickaxe', uses: 41 },
        chatIndex: 3,
        eventIndex: 1,
        hazards: [{ kind: 'lava', pos: { x: 34, y: -59, z: -101 }, blocks: 4 }],
        chest: { pos: { x: 16, y: -59, z: -98 }, free: 22, blocks: 3 },
        ...overrides,
    };
}

/** A tool item of mineflayer with its wear: `maxDurability - durabilityUsed` uses left. */
export function makeTool(name, usesLeft, maxDurability = 250) {
    return { name, count: 1, maxDurability, durabilityUsed: maxDurability - usesLeft };
}

/**
 * A fake agent as the watch tools read it: a bot with a position, health, food, an inventory, a held item and a
 * block reader; the running command as the agent keeps it; the chest index of the storage pack.
 * @param {{name?: string, pos?: object, dimension?: string, health?: number, food?: number, items?: object[],
 *   held?: object|null, running?: {text: string, startedAt: number}|null, label?: string, chests?: object[],
 *   world?: object, entities?: object[], job?: string}} [options]
 */
export function makeWatchAgent(options = {}) {
    const pos = options.pos ?? { x: 31, y: -59, z: -99 };
    const items = options.items ?? [];
    const world = options.world ?? null;
    const said = [];
    const handled = [];
    const agent = {
        name: options.name ?? 'claude',
        said,
        handled,
        bot: {
            username: options.name ?? 'claude',
            entity: { position: vec(pos.x, pos.y, pos.z), health: options.health ?? 20 },
            health: options.health ?? 20,
            food: options.food ?? 20,
            game: { dimension: options.dimension ?? 'overworld' },
            inventory: { items: () => items.map((i) => ({ ...i })), slots: [] },
            heldItem: options.held ?? null,
            entities: Object.fromEntries((options.entities ?? []).map((e, i) => [i + 1, e])),
            players: {},
            blockAt: (p) => (world ? world.blockAt(p) : { name: 'air', position: vec(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), _properties: {}, getProperties: () => ({}) }),
            chat: (text) => said.push(text),
            time: { timeOfDay: 1000 },
        },
        running_commands: [],
        actions: { executing: false, currentActionLabel: options.label ?? '', last_action_time: 0 },
        openChat: (text) => said.push(text),
        sayText: (text) => said.push(text),
        async handleMessage(from, text) {
            handled.push({ from, text });
            return true;
        },
        _workStores: () => ({
            chests: options.chests ? { list: () => options.chests.map((c) => ({ ...c })) } : null,
            mines: null,
        }),
        job: options.job !== undefined ? { status: () => options.job, describe: () => options.job } : null,
    };
    if (options.running) {
        agent.running_commands.push({ text: options.running.text, started: options.running.startedAt, result: null });
        agent.actions.executing = true;
        agent.actions.currentActionLabel = options.running.text;
        agent.actions.last_action_time = options.running.startedAt;
    }
    return agent;
}

/** How long a played command lasts by default: longer than the queue's poll (50 ms), so its entry is seen. */
export const PLAY_MS = 150;

/**
 * A fake agent whose handleMessage plays a command as the agent does for a typed one: the echo
 * `*<from> used <name>*` through routeResponse, the entry on running_commands ({ name, args, text, typed, by, pack })
 * while it runs (PLAY_MS by default, longer than the queue's poll), the pack result on the entry, then the output
 * through routeResponse. `results[text]` = { ms, pack, output }; the output is the pack's text unless given.
 * Every line the agent routes is in `routed` ({ to, text }); every command played is in `played` ({ from, text, busy:
 * the texts of the commands that still ran when it was handed on }).
 * @param {Object<string, {ms?: number, pack?: object|null, output?: string}>} results
 * @param {object} [options] makeWatchAgent's options
 */
export function makeQueueAgent(results = {}, options = {}) {
    const agent = makeWatchAgent({ name: 'claude', ...options });
    agent.played = [];
    agent.routed = [];
    agent.routeResponse = function (to, text) {
        agent.routed.push({ to, text });
        this.openChat(text); // the agent's routeResponse: a line to a player goes to the open chat
    };
    agent.handleMessage = async function (from, text) {
        agent.played.push({ from, text, busy: agent.running_commands.map((e) => e.text) });
        const m = text.match(/^!(\w+)/);
        const name = m ? `!${m[1]}` : text;
        const play = results[text] ?? { ms: PLAY_MS, pack: { ok: true, reason: null, text: 'Done.' } };
        this.routeResponse(from, `*${from} used ${name.substring(1)}*`);
        const entry = { name, args: [], text, typed: true, by: from };
        agent.running_commands.push(entry);
        agent.actions.executing = true;
        agent.actions.currentActionLabel = `action:${name.substring(1)}`;
        await new Promise((r) => setTimeout(r, play.ms ?? PLAY_MS));
        if (play.pack) entry.pack = play.pack;
        const output = play.output ?? play.pack?.text ?? '';
        const at = agent.running_commands.indexOf(entry);
        if (at >= 0) agent.running_commands.splice(at, 1);
        agent.actions.executing = agent.running_commands.length > 0;
        agent.actions.currentActionLabel = agent.running_commands.length ? `action:${agent.running_commands.at(-1).name.substring(1)}` : '';
        if (output) this.routeResponse(from, output);
        return true;
    };
    return agent;
}

/**
 * A fake watch state: the chat and event rings, the settings, a clock, the presence.
 * @param {{clock?: object, settings?: object, chat?: object[], events?: object[]}} [options]
 */
export function makeWatch(options = {}) {
    const clock = options.clock ?? makeClock();
    const chat = new Ring(100);
    const events = new Ring(100);
    for (const line of options.chat ?? []) chat.push(line);
    for (const event of options.events ?? []) events.push(event);
    return {
        chat,
        events,
        clock,
        now: () => clock.now(),
        settings: { supervisor_name: '', supervisor_updates: false, ...(options.settings ?? {}) },
        presence: { seenAt: null },
        waitTickMs: 5,
        answerMs: options.answerMs,
        longSkillMs: options.longSkillMs,
    };
}

/**
 * The block reader of the look tool over a block world: blockAt(x, y, z) and the entities (drops and players).
 * @param {object} world a BlockWorld
 * @param {{kind: 'item'|'player', name: string, count?: number, position: {x, y, z}}[]} [entities]
 */
export function makeReader(world, entities = []) {
    return {
        blockAt: (x, y, z) => world.blockAt({ x, y, z }),
        entities: () => entities.map((e) => ({ ...e, position: { ...e.position } })),
    };
}

/** A chest index fixture: get(pos) gives the entry with its free_slots, list() every entry. */
export function makeChestIndex(entries) {
    const key = (p) => `${p.x},${p.y},${p.z}`;
    const map = new Map(entries.map((e) => [key(e), { ...e }]));
    return {
        get: (pos) => map.get(key(pos)) ?? null,
        list: () => [...map.values()],
    };
}
