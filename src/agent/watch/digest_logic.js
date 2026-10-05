// v0.1.4.13 (part S): the digest of the watch server (spec 4.1). A snapshot is what the bot's facts are at
// one time (snapshotOf reads them from the agent and the state of the server, nothing else); digestLines
// takes two snapshots and returns the lines whose fact changed, in the order of the spec; the cursor store
// keeps the last 50 snapshots under a counter; wakeReason is the rule of the wait tool. Nothing here throws.
import { TEXTS } from './texts.js';
import { clockText, distance, eventLine, plainDimension, pointsText, posText } from './events_logic.js';
import { isExposed } from './look_logic.js'; // v0.1.4.13 fix1: no lava behind a wall

export const DIGEST_RULES = Object.freeze({
    cursorSize: 50,     // the snapshots the server keeps
    hazardRange: 8,     // blocks: lava, water and dropped items within this range are hazards
    dropsMax: 3,        // dropped items in the hazards line
    listMax: 10,        // chat lines and events listed in full up to this many new ...
    listTail: 3,        // ... else the count and the last 3
    idleMs: 3000,       // wait idle: nothing ran for this long
    longSkillMs: 2000,  // run: a skill that ran this long without a failure counts as started
});

export const WAIT_RULES = Object.freeze(['event', 'idle', 'done', 'any']);

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPoint(p) {
    return p !== null && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
}

function cellOf(p) {
    return isPoint(p) ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : null;
}

function sameCell(a, b) {
    if (!isPoint(a) || !isPoint(b))
        return a === b;
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

function compareNames(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}

/** `[13:45:02] MartyByrde2: go to the farm` */
export function chatLine(entry) {
    return `[${clockText(entry?.t)}] ${entry?.name ?? '?'}: ${entry?.text ?? ''}`;
}

/** The cursor of a digest call as a number, null for anything that is no whole number. */
export function parseCursor(value) {
    if (value === undefined || value === null || value === '')
        return null;
    const text = typeof value === 'number' ? String(value) : (typeof value === 'string' ? value.trim() : '');
    if (!/^\d+$/.test(text))
        return null;
    return Number(text);
}

// ---- the snapshot ----

/**
 * The command that runs: `{ text, startedAt }` from the action label of the agent (the entry of
 * agent.running_commands with its text, `the reflex <name>` for a mode), null when nothing runs.
 * @param {object} agent
 * @returns {{text: string, startedAt: number}|null}
 */
export function runningOf(agent, options = {}) {
    const label = agent?.actions?.currentActionLabel;
    if (typeof label !== 'string' || label === '')
        return null;
    let text = label;
    if (label.startsWith('action:')) {
        const name = `!${label.slice('action:'.length)}`;
        const list = Array.isArray(agent.running_commands) ? agent.running_commands : [];
        const running = [...list].reverse().find((c) => c?.name === name && typeof c.text === 'string');
        text = running ? running.text : name;
    } else if (label.startsWith('mode:')) {
        // a reflex is no command: the digest, the wake rules and the queue see nothing running (a finding of the
        // journey tester); only the state tool of v0.1.4.12 names it, with options.reflexes
        if (options?.reflexes !== true)
            return null;
        text = `the reflex ${label.slice('mode:'.length)}`;
    } else {
        return null;
    }
    const started = agent.actions?.last_action_time;
    return { text, startedAt: isFiniteNumber(started) && started > 0 ? started : 0 };
}

function sameRunning(a, b) {
    if (!a || !b)
        return a === b || (!a && !b);
    return a.text === b.text && a.startedAt === b.startedAt;
}

/** The uses left of an item of mineflayer (maxDurability minus durabilityUsed), null for an item without wear. */
export function usesLeft(item) {
    const max = item?.maxDurability;
    if (!isFiniteNumber(max) || max <= 0)
        return null;
    const used = isFiniteNumber(item.durabilityUsed) ? item.durabilityUsed : 0;
    return Math.max(0, Math.floor(max - used));
}

function inventoryOf(bot) {
    const counts = {};
    let items = [];
    try {
        items = bot?.inventory?.items?.() ?? [];
    } catch {
        items = [];
    }
    for (const item of items) {
        if (typeof item?.name === 'string' && isFiniteNumber(item.count))
            counts[item.name] = (counts[item.name] ?? 0) + item.count;
    }
    return counts;
}

function handOf(bot) {
    const item = bot?.heldItem;
    if (!item || typeof item.name !== 'string')
        return null;
    return { name: item.name, uses: usesLeft(item) };
}

function blockNameAt(bot, x, y, z) {
    try {
        return bot.blockAt?.({ x, y, z })?.name ?? null;
    } catch {
        return null;
    }
}

function droppedItemOf(entity) {
    try {
        const item = typeof entity?.getDroppedItem === 'function' ? entity.getDroppedItem() : null;
        if (item && typeof item.name === 'string')
            return { name: item.name, count: isFiniteNumber(item.count) ? item.count : 1 };
    } catch {
        // no item in the metadata
    }
    return { name: 'item', count: 1 };
}

/**
 * The hazards within 8 blocks: the nearest lava block with an open side (v0.1.4.13 fix1: none behind a wall), the nearest water block at the bot's feet, one
 * below or one above (a block the bot could walk into), the nearest dropped items (at most 3). Nearest first.
 * @param {object} bot
 * @param {{x, y, z}} cell the cell of the bot
 * @returns {Array<{kind: string, pos: {x, y, z}, blocks: number, name?: string, count?: number}>}
 */
export function hazardsOf(bot, cell) {
    const out = [];
    if (!isPoint(cell) || typeof bot?.blockAt !== 'function')
        return out;
    const r = DIGEST_RULES.hazardRange;
    let lava = null;
    let water = null;
    const reader = { blockAt: (x, y, z) => ({ name: blockNameAt(bot, x, y, z) }) };
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (d > r)
                    continue;
                const name = blockNameAt(bot, cell.x + dx, cell.y + dy, cell.z + dz);
                if (name === 'lava' && (lava === null || d < lava.d) && isExposed(reader, cell.x + dx, cell.y + dy, cell.z + dz, 'lava'))
                    lava = { d, pos: { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz } };
                else if (name === 'water' && dy >= -1 && dy <= 1 && (water === null || d < water.d))
                    water = { d, pos: { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz } };
            }
        }
    }
    if (lava)
        out.push({ kind: 'lava', pos: lava.pos, blocks: Math.round(lava.d) });
    if (water)
        out.push({ kind: 'water', pos: water.pos, blocks: Math.round(water.d) });
    const drops = [];
    for (const entity of Object.values(bot.entities ?? {})) {
        if (entity?.name !== 'item' || !isPoint(entity.position))
            continue;
        const d = distance(cell, cellOf(entity.position));
        if (d > r)
            continue;
        const item = droppedItemOf(entity);
        drops.push({ kind: 'drop', pos: cellOf(entity.position), blocks: Math.round(d), name: item.name, count: item.count, d });
    }
    drops.sort((a, b) => a.d - b.d || compareNames(a.name, b.name));
    for (const drop of drops.slice(0, DIGEST_RULES.dropsMax))
        out.push({ kind: 'drop', pos: drop.pos, blocks: drop.blocks, name: drop.name, count: drop.count });
    out.sort((a, b) => a.blocks - b.blocks);
    return out;
}

function chestOf(agent, cell, dimension) {
    try {
        const index = agent?._workStores?.()?.chests ?? null;
        if (!index || typeof index.nearest !== 'function' || !isPoint(cell))
            return null;
        const chest = index.nearest(cell, dimension, (c) => isFiniteNumber(c?.free_slots) && c.free_slots >= 1);
        if (!chest)
            return null;
        const pos = { x: chest.x, y: chest.y, z: chest.z };
        return { pos, free: chest.free_slots, blocks: Math.round(distance(cell, pos)) };
    } catch {
        return null;
    }
}

/**
 * The snapshot of the facts of the bot now.
 * @param {object} agent
 * @param {object} [watch] the state of the server: chat and events (Rings with total), now()
 * @returns {object} { t, pos, dimension, health, food, running, job, inventory, hand, chatIndex, eventIndex, hazards, chest }
 */
export function snapshotOf(agent, watch = {}) {
    const t = typeof watch?.now === 'function' ? Number(watch.now()) : Date.now();
    const bot = agent?.bot;
    let pos = null;
    try {
        pos = cellOf(bot?.entity?.position);
    } catch {
        pos = null;
    }
    const dimension = plainDimension(bot?.game?.dimension);
    let job = '';
    try {
        // only the line of a job that exists (`Job: ...`); `Last job: ...` of a done or left job is none for the digest
        const line = agent?.job?.status?.();
        job = typeof line === 'string' && /^Job:/.test(line.trim()) ? line.trim() : '';
    } catch {
        job = '';
    }
    let hazards = [];
    try {
        hazards = hazardsOf(bot, pos);
    } catch {
        hazards = [];
    }
    return {
        t: Number.isFinite(t) ? t : Date.now(),
        pos,
        dimension,
        health: isFiniteNumber(bot?.health) ? Math.round(bot.health * 10) / 10 : null,
        food: isFiniteNumber(bot?.food) ? Math.round(bot.food) : null,
        running: runningOf(agent),
        job,
        inventory: inventoryOf(bot),
        hand: handOf(bot),
        chatIndex: isFiniteNumber(watch?.chat?.total) ? watch.chat.total : 0,
        eventIndex: isFiniteNumber(watch?.events?.total) ? watch.events.total : 0,
        hazards,
        chest: chestOf(agent, pos, bot?.game?.dimension),
    };
}

// ---- the cursor store ----

/**
 * The last `size` snapshots under a counter. add() returns the cursor of the snapshot; get() the snapshot of a
 * cursor or null when it is unknown (older than the last 50, or never given).
 * @param {number} [size]
 */
export function createCursorStore(size = DIGEST_RULES.cursorSize) {
    const max = Number.isInteger(size) && size > 0 ? size : DIGEST_RULES.cursorSize;
    const kept = new Map();
    let counter = 0;
    return {
        add(snapshot) {
            counter++;
            kept.set(counter, snapshot);
            while (kept.size > max)
                kept.delete(kept.keys().next().value);
            return counter;
        },
        get(cursor) {
            const n = parseCursor(cursor);
            return n === null ? null : (kept.get(n) ?? null);
        },
        last() {
            return counter === 0 ? null : (kept.get(counter) ?? null);
        },
        get cursor() {
            return counter;
        },
        get size() {
            return kept.size;
        },
    };
}

// ---- the lines ----

/** `+7 diamond, +25 lapis_lazuli, -1 iron_pickaxe, -4 bread`: the gains, then the losses, each the smaller first. */
export function inventoryChanges(before, after) {
    const names = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    const gains = [];
    const losses = [];
    for (const name of names) {
        const delta = (after?.[name] ?? 0) - (before?.[name] ?? 0);
        if (delta > 0)
            gains.push({ name, delta });
        else if (delta < 0)
            losses.push({ name, delta });
    }
    const byCount = (a, b) => Math.abs(a.delta) - Math.abs(b.delta) || compareNames(a.name, b.name);
    gains.sort(byCount);
    losses.sort(byCount);
    return [...gains, ...losses].map((c) => `${c.delta > 0 ? '+' : '-'}${Math.abs(c.delta)} ${c.name}`);
}

function inventoryList(counts) {
    return Object.entries(counts ?? {})
        .filter(([, n]) => isFiniteNumber(n) && n > 0)
        .sort((a, b) => b[1] - a[1] || compareNames(a[0], b[0]))
        .map(([name, n]) => `${n} ${name}`);
}

function hazardKey(h) {
    return `${h.kind}|${h.name ?? ''}|${h.count ?? ''}|${posText(h.pos)}`;
}

function sameHazards(a, b) {
    const left = (a ?? []).map(hazardKey);
    const right = (b ?? []).map(hazardKey);
    return left.length === right.length && left.every((k, i) => k === right[i]);
}

function hazardText(h) {
    if (h.kind === 'drop')
        return TEXTS.hazardDrop(h.count ?? 1, h.name ?? 'item', h.blocks, posText(h.pos));
    return TEXTS.hazard(h.kind, h.blocks, posText(h.pos));
}

function sameChest(a, b) {
    if (!a || !b)
        return !a && !b;
    return sameCell(a.pos, b.pos) && a.free === b.free;
}

function handLine(hand) {
    if (!hand)
        return TEXTS.handEmpty;
    return hand.uses === null || hand.uses === undefined ? TEXTS.handPlain(hand.name) : TEXTS.hand(hand.name, hand.uses);
}

function sameHand(a, b) {
    if (!a || !b)
        return !a && !b;
    return a.name === b.name && a.uses === b.uses;
}

function listed(entries, toLine) {
    const list = Array.isArray(entries) ? entries : [];
    const shown = list.length <= DIGEST_RULES.listMax ? list : list.slice(-DIGEST_RULES.listTail);
    return shown.map(toLine);
}

/**
 * The lines of the digest: only the lines whose fact changed from `before` to `after`, in the order of the
 * spec, `Cursor` first; without `before` every line. `Nothing changed.` when no line changed.
 * @param {object|null} before the snapshot of the cursor, null for every line
 * @param {object} after the snapshot now
 * @param {{cursor: number|string, chat?: object, events?: object}} options chat, events: the Rings of the server
 *   (their entries since before.chatIndex / before.eventIndex are listed)
 * @returns {string[]}
 */
export function digestLines(before, after, options = {}) {
    const out = [TEXTS.cursor(options?.cursor ?? 0)];
    if (!after)
        return [...out, TEXTS.nothingChanged];
    const first = !before;

    // At
    if (first || !sameCell(before.pos, after.pos) || before.dimension !== after.dimension) {
        if (!after.pos)
            out.push(TEXTS.at('(unknown)', after.dimension));
        else if (first || !before.pos || before.dimension !== after.dimension)
            out.push(TEXTS.at(posText(after.pos), after.dimension));
        else
            out.push(TEXTS.atMoved(posText(after.pos), after.dimension, Math.round(distance(before.pos, after.pos))));
    }
    // Health, food
    if (first || before.health !== after.health || before.food !== after.food)
        out.push(TEXTS.healthFood(pointsText(after.health), after.food === null ? '?' : after.food));
    // Running
    if (first || !sameRunning(before.running, after.running)) {
        if (!after.running)
            out.push(TEXTS.runningNothing);
        else
            out.push(TEXTS.running(after.running.text, after.running.startedAt > 0 ? Math.max(0, Math.round((after.t - after.running.startedAt) / 1000)) : 0));
    }
    // Job
    if (first || before.job !== after.job)
        out.push(after.job === '' ? TEXTS.noJob : after.job);
    // Inventory
    if (first) {
        const list = inventoryList(after.inventory);
        out.push(list.length === 0 ? TEXTS.inventoryEmpty : TEXTS.inventory(list.join(', ')));
    } else {
        const changes = inventoryChanges(before.inventory, after.inventory);
        if (changes.length > 0)
            out.push(TEXTS.inventoryChanges(changes.join(', ')));
    }
    // Hand
    if (first || !sameHand(before.hand, after.hand))
        out.push(handLine(after.hand));
    // Chat
    const chatFrom = first ? 0 : before.chatIndex;
    if (after.chatIndex > chatFrom) {
        const entries = typeof options?.chat?.since === 'function' ? options.chat.since(chatFrom) : [];
        out.push(TEXTS.chatNew(after.chatIndex - chatFrom), ...listed(entries, chatLine));
    }
    // Events
    const eventsFrom = first ? 0 : before.eventIndex;
    if (after.eventIndex > eventsFrom) {
        const entries = typeof options?.events?.since === 'function' ? options.events.since(eventsFrom) : [];
        out.push(TEXTS.eventsNew(after.eventIndex - eventsFrom), ...listed(entries, eventLine));
    }
    // Hazards
    if (first || !sameHazards(before.hazards, after.hazards)) {
        const list = after.hazards ?? [];
        out.push(list.length === 0 ? TEXTS.noHazards : TEXTS.hazards(list.map(hazardText).join('; ')));
    }
    // Chest
    if (first || !sameChest(before.chest, after.chest))
        out.push(after.chest ? TEXTS.chest(posText(after.chest.pos), after.chest.free, after.chest.blocks) : TEXTS.noChest);

    return out.length === 1 ? [...out, TEXTS.nothingChanged] : out;
}

// ---- the wake rules of wait ----

/** True for a chat entry of a player (not the bot's own line, not a line the watch handed in). */
export function isPlayerLine(entry, botName) {
    const name = entry?.name;
    if (typeof name !== 'string' || name === '')
        return false;
    return name !== botName && !name.endsWith(' (by watch)');
}

/**
 * The facts of the digest that wake `wait any` when they changed: not the bot's own progress (the position,
 * the inventory, the job's count, the uses of the tool, its own chat lines), which changes with every step
 * of its work, but its situation: health, food, the running command, the item in hand, the hazards, the
 * chest, a line of a player, an event.
 * @param {object} base the snapshot at the call
 * @param {object} now the snapshot now
 * @param {{playerLines?: number}} [extra] playerLines: the chat lines of players since base
 * @returns {string[]} the names of the facts that changed
 */
export function changedFacts(base, now, extra = {}) {
    const changed = [];
    if (!base || !now)
        return changed;
    if (base.health !== now.health)
        changed.push('health');
    if (base.food !== now.food)
        changed.push('food');
    if (!sameRunning(base.running, now.running))
        changed.push('running');
    if ((base.hand?.name ?? null) !== (now.hand?.name ?? null))
        changed.push('hand');
    if (!sameHazards(base.hazards, now.hazards))
        changed.push('hazards');
    if (!sameChest(base.chest, now.chest))
        changed.push('chest');
    if (isFiniteNumber(extra?.playerLines) && extra.playerLines > 0)
        changed.push('chat');
    if (now.eventIndex > base.eventIndex)
        changed.push('events');
    return changed;
}

/**
 * The reason a wait wakes, or null while it waits on.
 *   event: a new event since the call; idle: nothing runs and nothing ran for 3 s; done: the command that ran
 *   when the call came has ended (at once when none ran); any: an event, the end or start of a command, or a
 *   change of the facts of changedFacts.
 * @param {string} rule one of WAIT_RULES
 * @param {{base: object, now: object, runningAtStart: object|null, running: object|null, idleMs: number, playerLines?: number}} state
 *   idleMs: ms since something last ran (Infinity when nothing ran as far as the server knows)
 * @returns {'event'|'idle'|'done'|'changed'|null}
 */
export function wakeReason(rule, state = {}) {
    const base = state?.base ?? null;
    const now = state?.now ?? null;
    const newEvents = base && now ? now.eventIndex - base.eventIndex : 0;
    switch (rule) {
        case 'event':
            return newEvents > 0 ? 'event' : null;
        case 'idle':
            return !state.running && typeof state.idleMs === 'number' && state.idleMs >= DIGEST_RULES.idleMs ? 'idle' : null;
        case 'done':
            // v0.1.4.13 (the lead): an event (the owner's message to the supervisor, a help, a death, an explosion)
            // wakes a wait for done too, so the supervisor answers the owner while a long skill runs
            if (newEvents > 0)
                return 'event';
            if (!state.runningAtStart)
                return 'done';
            return sameRunning(state.runningAtStart, state.running) ? null : 'done';
        case 'any':
            return changedFacts(base, now, { playerLines: state.playerLines }).length > 0 ? 'changed' : null;
        default:
            return null;
    }
}

/** The number of seconds of a wait: an integer 1 to 55, default 55; null for anything else. */
export function waitTimeout(value, max = 55) {
    if (value === undefined || value === null || value === '')
        return max;
    const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (!Number.isInteger(n) || n < 1 || n > max)
        return null;
    return n;
}
