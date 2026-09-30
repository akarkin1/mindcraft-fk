// Cutting trees (spec v0.1.4.7 T2). The decisions are in tree_logic.js; this module walks, digs,
// builds the pillar, picks up the drops and plants the saplings.
//
// ctx: { areas, log, now } of the home pack. Since v0.1.4.8 (E3) also tools.ensureTool (optional):
// the axe before the first tree.
import { Vec3 } from 'vec3';
import { distanceToBox } from '../home/box_math.js';
import { botPos, clockOf, dimensionOf, entitiesWhere, listAreas, logTo } from '../home/context.js';
import { goals, gotoGoal, makeMovements, stopMoving } from '../home/motion.js';
import { EXEC_REACH, PLACE_LIMIT_MS, digBlock, eyeOfBot, feetOf, isAirLike, nameAt, settle, vec, waitUntil } from './actions.js';
import { findItem, inventoryOf, itemCounts } from './inventory.js';
import { chopStoppedText, chopText, unknownWoodText } from './texts.js';
import { bestTool } from './tool_logic.js';
import { DEFAULT_REACH, TREE_DEFAULTS, chopPlan, findTrees, inReach, isLeaves, isTrunkLog, normaliseWoodKind,
    pickTree, saplingOf, treeKey, treeNearAreas } from './tree_logic.js';

/** Upper limit of one chopTrees; checked before each tree. */
export const CHOP_LIMIT_MS = 10 * 60 * 1000;
/**
 * Upper limit of one tree. On the real server a dark oak of 52 logs took 3 minutes by hand; a
 * giant jungle tree has more than twice as many logs.
 */
export const TREE_LIMIT_MS = 8 * 60 * 1000;
/** How long the bot waits for saplings of leaves that decay. */
export const SAPLING_WAIT_MS = 10000;
/** Drops within this distance of the base are picked up. */
export const DROP_RADIUS = 8;
/** After the last log: how long the bot waits for the logs of the tree to be picked up (Amendment 2, I1). */
export const LOG_DROP_WAIT_MS = 5000;
/** Logs that lie within this distance of the trunk are waited for (I1). */
export const LOG_DROP_RADIUS = 6;
/** Logs are counted from an inventory that did not change for this long (I1). */
export const INVENTORY_QUIET_MS = 500;
/** Within this distance of a protected area the bot never digs to get somewhere (spec 0.1). */
export const NO_DIG_NEAR_AREA = 8;
/** After each tree the drops are picked up for at least this long, also when the time of the tree is over (v0.1.4.8, E3). */
export const DROP_PICKUP_MS = 30000;

const MAX_TREES_PER_SEARCH = 8;
const MAX_LOG_CANDIDATES = 512;
const PLANTABLE = new Set(['dirt', 'grass_block', 'podzol', 'coarse_dirt', 'rooted_dirt', 'moss_block', 'mud', 'mycelium',
    'muddy_mangrove_roots', 'farmland', 'pale_moss_block', 'crimson_nylium', 'warped_nylium']);

function positiveInt(value, fallback) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

function logCounts(bot) {
    const out = {};
    for (const [name, n] of Object.entries(itemCounts(bot))) {
        if (isTrunkLog(name)) {
            out[name] = n;
        }
    }
    return out;
}

function gainedLogs(bot, before) {
    const now = logCounts(bot);
    const out = {};
    for (const [name, n] of Object.entries(now)) {
        const d = n - (before[name] ?? 0);
        if (d > 0) {
            out[name] = d;
        }
    }
    return out;
}

function sum(counts) {
    return Object.values(counts).reduce((s, n) => s + n, 0);
}

// Breaks a block of the tree (a log by default), holding the best axe or an empty hand, never a
// pickaxe (v0.1.4.8, E3). A dig is progress for the reflex unstuck (I1).
async function digAt(bot, pos, run, accept = isTrunkLog) {
    const ok = await digBlock(bot, pos, run.clock, accept, 'axe', { handIfNone: true });
    if (ok) {
        try {
            bot.modes?.noteProgress?.('wood');
        } catch {
            // the modes are optional
        }
    }
    return ok;
}

// Movements: never place; dig only leaves, and only far from protected areas.
function movementsFor(bot, tree, areas) {
    const list = [makeMovements(bot, { dig: false })];
    const far = areas.every(a => distanceToBox(a, tree.base) > NO_DIG_NEAR_AREA);
    if (far) {
        try {
            const m = makeMovements(bot, { dig: true, areas });
            const ids = (bot.registry?.blocksArray ?? []).filter(b => !isLeaves(b.name)).map(b => b.id);
            m.blocksCantBreak = new Set(ids);
            list.push(m);
        } catch {
            // without leaves digging
        }
    }
    return list;
}

async function walkTo(bot, goal, run, test) {
    for (const movements of run.movements) {
        if (test()) {
            return true;
        }
        const res = await gotoGoal(bot, goal, { movements, timeoutMs: 20000, clock: run.clock });
        if (res.reason === 'interrupted') {
            return test();
        }
    }
    return test();
}

function inColumn(bot, base) {
    const f = feetOf(bot);
    return !!f && f.x === base.x && f.z === base.z;
}

function pillarItem(bot, tree) {
    const counts = itemCounts(bot);
    if ((counts.dirt ?? 0) > 0) {
        return findItem(bot, 'dirt');
    }
    const logs = Object.keys(counts).filter(n => isTrunkLog(n) && counts[n] > 0)
        .sort((a, b) => (b.startsWith(`${tree.kind}_`) ? 1 : 0) - (a.startsWith(`${tree.kind}_`) ? 1 : 0) || counts[b] - counts[a]);
    return logs.length > 0 ? findItem(bot, logs[0]) : null;
}

// One block up: clear the two blocks above the head (leaves and logs only), jump, place a block
// where the feet were. Returns false when it did not work.
async function pillarUp(bot, tree, state, run) {
    const feet = feetOf(bot);
    if (!feet || state.pillarFailed) {
        return false;
    }
    for (const dy of [2, 3]) {
        const p = { x: feet.x, y: feet.y + dy, z: feet.z };
        const name = nameAt(bot, p);
        if (name === null) {
            return fail(state);
        }
        if (isAirLike(name)) {
            continue;
        }
        if (!(isLeaves(name) || isTrunkLog(name)) || !(await digAt(bot, p, run, n => isLeaves(n) || isTrunkLog(n)))) {
            return fail(state);
        }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        const item = pillarItem(bot, tree);
        if (!item) {
            return fail(state);
        }
        const res = await jumpAndPlace(bot, feet, item, run);
        if (bot.interrupt_code) {
            return fail(state);
        }
        const placed = nameAt(bot, feet);
        const now = feetOf(bot);
        if (res && placed === item.name && now && now.y === feet.y + 1) {
            state.pillar.push({ pos: feet, name: placed });
            return true;
        }
    }
    return fail(state);
}

function fail(state) {
    state.pillarFailed = true;
    return false;
}

async function jumpAndPlace(bot, feet, item, run) {
    let ok = false;
    try {
        await bot.equip(item, 'hand');
        const ref = bot.blockAt(new Vec3(feet.x, feet.y - 1, feet.z));
        if (!ref) {
            return false;
        }
        bot.setControlState('jump', true);
        const up = await waitUntil(run.clock, () => (botPos(bot)?.y ?? feet.y) >= feet.y + 1, 1000);
        if (up) {
            const res = await settle(bot, run.clock, () => bot.placeBlock(ref, new Vec3(0, 1, 0)), PLACE_LIMIT_MS);
            ok = res.ok;
        }
    } catch {
        ok = false;
    } finally {
        try {
            bot.setControlState('jump', false);
        } catch {
            // released anyway on the next stop
        }
    }
    await waitUntil(run.clock, () => bot.entity?.onGround !== false, 1500);
    return ok;
}

// Digs the pillar under the bot away, block by block, down to the base of the trunk.
async function takePillarDown(bot, state, run) {
    while (state.pillar.length > 0 && !bot.interrupt_code) {
        const top = state.pillar[state.pillar.length - 1];
        const feet = feetOf(bot);
        if (!feet || feet.x !== top.pos.x || feet.z !== top.pos.z || feet.y !== top.pos.y + 1) {
            break;
        }
        if (!(await digAt(bot, top.pos, run, n => n === top.name))) {
            break;
        }
        // Found on the real server: a dig that starts while the bot still falls takes five times
        // as long (15 s for a log by hand), so the bot lands first.
        await waitUntil(run.clock, () => (feetOf(bot)?.y ?? top.pos.y) <= top.pos.y && bot.entity?.onGround !== false, 2000);
        state.pillar.pop();
    }
    return state.pillar.length === 0;
}

function droppedName(entity) {
    try {
        return entity.getDroppedItem?.()?.name ?? null;
    } catch {
        return null;
    }
}

function dropsNear(bot, center, test = () => true) {
    return entitiesWhere(bot, 32, e => {
        if (e.name !== 'item' || e.isValid === false) {
            return false;
        }
        const p = e.position;
        return Math.hypot(p.x - (center.x + 0.5), p.z - (center.z + 0.5)) <= DROP_RADIUS && Math.abs(p.y - center.y) <= 3
            && test(droppedName(e));
    });
}

// Walks to the drops that lie on the ground around the base.
async function collectDrops(bot, centers, run, test = () => true) {
    const skip = new Set();
    for (let pass = 0; pass < 3; pass++) {
        const items = centers.flatMap(c => dropsNear(bot, c, test)).filter(e => !skip.has(e.id));
        if (items.length === 0) {
            return;
        }
        for (const e of items.slice(0, 16)) {
            if (bot.interrupt_code || run.clock.now() >= run.deadline) {
                return;
            }
            if (e.isValid === false) {
                continue;
            }
            skip.add(e.id);
            const p = e.position;
            await gotoGoal(bot, new goals.GoalNear(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 1), {
                movements: run.movements[0], timeoutMs: 8000, clock: run.clock,
            });
        }
        await run.clock.wait(250);
    }
}

// Items of the logs of the tree that lie, or still fall, within 6 blocks of its trunk. An item
// whose name is not known yet counts.
function logDropsNear(bot, tree, test) {
    const top = tree.base.y + (tree.height ?? 1) + 2;
    return entitiesWhere(bot, 64, e => {
        if (e.name !== 'item' || e.isValid === false) {
            return false;
        }
        const p = e.position;
        return Math.hypot(p.x - (tree.base.x + 0.5), p.z - (tree.base.z + 0.5)) <= LOG_DROP_RADIUS
            && p.y >= tree.base.y - 3 && p.y <= top && test(droppedName(e));
    });
}

// Waits until the counts of the inventory did not change for 500 ms, at most `ms`.
async function quietInventory(bot, clock, ms = 3000) {
    const snap = () => JSON.stringify(Object.entries(itemCounts(bot)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    let last = snap();
    let since = clock.now();
    const start = since;
    while (clock.now() - since < INVENTORY_QUIET_MS && clock.now() - start < ms && !bot.interrupt_code) {
        await clock.wait(100);
        const now = snap();
        if (now !== last) {
            last = now;
            since = clock.now();
        }
    }
}

// Found on the real server (Amendment 2, I1): a log cut from the ground falls for about a second,
// so the answer came before the last log was picked up. After the last log the bot picks up the
// logs of the tree until none lies within 6 blocks of the trunk, at most 5 seconds.
async function waitForLogDrops(bot, tree, run) {
    const test = n => n === null || (isTrunkLog(n) && n.startsWith(`${tree.kind}_`));
    const start = run.clock.now();
    const sub = { ...run, deadline: start + LOG_DROP_WAIT_MS };
    while (!bot.interrupt_code && run.clock.now() - start < LOG_DROP_WAIT_MS && logDropsNear(bot, tree, test).length > 0) {
        const t = run.clock.now();
        await collectDrops(bot, [tree.base], sub, test);
        if (run.clock.now() - t < 250) {
            await run.clock.wait(250);
        }
    }
    await quietInventory(bot, run.clock);
}

// Gets the bot within reach of the log of a step, by walking or by building the pillar.
async function getInReach(bot, step, tree, state, run) {
    const reach = () => inReach(eyeOfBot(bot), step.log, EXEC_REACH);
    if (reach()) {
        return true;
    }
    if (step.from === 'ground') {
        if (state.pillar.length > 0) {
            return false;
        }
        if (step.stand) {
            await walkTo(bot, new goals.GoalBlock(step.stand.x, step.stand.y, step.stand.z), run, reach);
        }
        if (!reach()) {
            await walkTo(bot, new goals.GoalNear(step.log.x, step.log.y, step.log.z, 3), run, reach);
        }
        return reach();
    }
    const base = tree.base;
    if (state.pillar.length === 0 && !(inColumn(bot, base) && feetOf(bot)?.y === base.y)) {
        const there = () => inColumn(bot, base) && feetOf(bot)?.y === base.y;
        await walkTo(bot, new goals.GoalBlock(base.x, base.y, base.z), run, there);
        if (!there()) {
            return reach();
        }
        stopMoving(bot);
    }
    while (!reach() && state.pillar.length < step.pillar) {
        if (!(await pillarUp(bot, tree, state, run))) {
            return false;
        }
    }
    return reach();
}

/**
 * Cuts one tree by its plan. The pillar is taken away at the end and the drops are picked up, also
 * when the time of the tree is over (v0.1.4.8, E3); `cut` counts the logs broken by name.
 * @returns {Promise<{broken: number, cut: Object<string, number>, leftover: number, stopped: string|null}>}
 */
async function cutTree(bot, tree, run) {
    const plan = chopPlan(tree, DEFAULT_REACH);
    const state = { pillar: [], pillarFailed: false };
    const cut = {};
    let broken = 0;
    let leftover = plan.leftover.length;
    let stopped = null;
    for (const step of plan.steps) {
        if (bot.interrupt_code) {
            stopped = 'interrupted';
            break;
        }
        if (run.clock.now() >= run.deadline) {
            stopped = 'time';
        }
        const name = nameAt(bot, step.log);
        if (!isTrunkLog(name)) {
            continue;
        }
        if (stopped || !(await getInReach(bot, step, tree, state, run))) {
            leftover++;
            continue;
        }
        if (await digAt(bot, step.log, run)) {
            broken++;
            cut[name] = (cut[name] ?? 0) + 1;
        } else if (isTrunkLog(nameAt(bot, step.log))) {
            leftover++;
        }
    }
    await takePillarDown(bot, state, run);
    const pick = { ...run, deadline: Math.max(run.deadline, run.clock.now() + DROP_PICKUP_MS) };
    if (!bot.interrupt_code) {
        await collectDrops(bot, [tree.base], pick);
    }
    if (!bot.interrupt_code && broken > 0) {
        await waitForLogDrops(bot, tree, pick);
    }
    return { broken, cut, leftover, stopped: stopped ?? (bot.interrupt_code ? 'interrupted' : null), pillarLeft: state.pillar.length };
}

// The axe before the first tree (v0.1.4.8, E3): ctx.tools.ensureTool from what the bot carries and
// what the chests hold, never by cutting trees or breaking stone for it. Without it: by hand.
async function getAxe(bot, ctx, options) {
    if (options.axe === false || bestTool(inventoryOf(bot), 'axe') || typeof ctx?.tools?.ensureTool !== 'function') {
        return;
    }
    try {
        const r = await ctx.tools.ensureTool(bot, ctx, 'axe', '', { collect: false, now: options.now, wait: options.wait });
        if (!r?.ok && r?.text) {
            logTo(ctx, `I cut by hand. ${r.text}`);
        }
    } catch (err) {
        console.warn('Wood pack: getting an axe failed:', err?.message ?? err);
    }
}

/**
 * The arguments of chopTrees in either order (spec v0.1.4.8 E3, T5): `(8, 'oak')` and `('oak', 8)`,
 * also `('', 8)`. Pure.
 * @param {*} count
 * @param {*} kind
 * @returns {{count: *, kind: *}}
 */
export function chopArgs(count, kind) {
    const isNum = v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*\d+\s*$/.test(v));
    const isWord = v => v === undefined || v === null || (typeof v === 'string' && !isNum(v));
    if (!isNum(count) && isWord(count) && isNum(kind)) {
        return { count: kind, kind: count ?? '' };
    }
    return { count, kind };
}

function getBlockNameOf(bot) {
    return (x, y, z) => {
        const b = bot.blockAt(new Vec3(x, y, z));
        return b ? b.name : null;
    };
}

function logCandidates(bot, range) {
    try {
        const found = bot.findBlocks({ matching: b => !!b && isTrunkLog(b.name), maxDistance: range, count: MAX_LOG_CANDIDATES });
        return Array.isArray(found) ? found.map(p => ({ x: p.x, y: p.y, z: p.z })) : null;
    } catch {
        return null;
    }
}

// Of the nearest trees that are not near a protected area and were not tried yet, the one that
// gives the logs still wanted in the least time (pickTree).
function nextTree(bot, kind, done, areas, range, need) {
    const origin = feetOf(bot);
    if (!origin) {
        return null;
    }
    const candidates = logCandidates(bot, range);
    const options = { range, kind, max: MAX_TREES_PER_SEARCH, exclude: done };
    if (candidates) {
        options.candidates = candidates;
    }
    for (let round = 0; round < 4; round++) {
        const trees = findTrees(getBlockNameOf(bot), origin, options);
        if (trees.length === 0) {
            return null;
        }
        const free = trees.filter(t => !treeNearAreas(t, areas, 2));
        if (free.length > 0) {
            return pickTree(free, need, origin);
        }
        for (const t of trees) {
            done.add(treeKey(t));
        }
    }
    return null;
}

function plantableTrees(bot, trees) {
    return trees.filter(t => saplingOf(t.kind) && PLANTABLE.has(nameAt(bot, { x: t.base.x, y: t.base.y - 1, z: t.base.z }))
        && isAirLike(nameAt(bot, t.base)));
}

function saplingsNeeded(bot, trees) {
    const need = {};
    for (const t of plantableTrees(bot, trees)) {
        const s = saplingOf(t.kind);
        need[s] = (need[s] ?? 0) + 1;
    }
    return need;
}

function haveSaplings(bot, need) {
    const counts = itemCounts(bot);
    return Object.entries(need).every(([name, n]) => (counts[name] ?? 0) >= n);
}

// Waits up to 10 seconds for saplings of the leaves that decay, and picks them up.
async function waitForSaplings(bot, trees, run) {
    const need = saplingsNeeded(bot, trees);
    if (Object.keys(need).length === 0) {
        return;
    }
    const start = run.clock.now();
    while (!haveSaplings(bot, need) && !bot.interrupt_code && run.clock.now() - start < SAPLING_WAIT_MS) {
        const before = run.clock.now();
        await collectDrops(bot, trees.map(t => t.base), { ...run, deadline: start + SAPLING_WAIT_MS }, n => n in need);
        if (run.clock.now() - before < 500) {
            await run.clock.wait(500);
        }
    }
}

// Plants one sapling where each tree stood.
async function plantSaplings(bot, trees, run) {
    let planted = 0;
    for (const t of plantableTrees(bot, trees)) {
        if (bot.interrupt_code) {
            break;
        }
        const sapling = saplingOf(t.kind);
        const item = findItem(bot, sapling);
        if (!item) {
            continue;
        }
        const ground = { x: t.base.x, y: t.base.y - 1, z: t.base.z };
        const clear = () => !inColumn(bot, t.base) && inReach(eyeOfBot(bot), ground, EXEC_REACH);
        if (!clear()) {
            if (t.stand) {
                await walkTo(bot, new goals.GoalBlock(t.stand.x, t.stand.y, t.stand.z), run, clear);
            }
            if (!clear()) {
                await walkTo(bot, new goals.GoalNear(t.base.x, t.base.y, t.base.z, 2), run, clear);
            }
        }
        try {
            await bot.equip(item, 'hand');
            const block = bot.blockAt(vec(ground));
            await settle(bot, run.clock, () => bot.placeBlock(block, new Vec3(0, 1, 0)), PLACE_LIMIT_MS);
        } catch {
            // checked below
        }
        if (nameAt(bot, t.base) === sapling) {
            planted++;
        }
    }
    return planted;
}

/**
 * Cuts whole trees until the bot got `count` logs (spec T2). Of the 8 nearest trees it takes the
 * one that gives the logs still wanted in the least time (pickTree). A tree that was started is
 * finished, so no trunk hangs in the air; logs out of reach of a pillar of 12 blocks are left
 * and counted. Trees inside a protected area and within 2 blocks of one are left alone, and
 * only natural trees count (findTrees): logs of buildings are never taken. The pillar is built
 * of dirt or of logs it has cut and is taken away. It picks up the drops, waits up to 10 seconds
 * for saplings of leaves that decay, and plants one sapling where each tree stood. It holds the
 * best axe it has, or works by hand. Ends on bot.interrupt_code and after 10 minutes. Never throws.
 * Since v0.1.4.8 (E3): `count` is the number of logs wanted (whole trees are cut until the
 * inventory gained that many or more); the arguments are taken in either order (chopArgs); before
 * the first tree it gets an axe through ctx.tools.ensureTool (from the inventory and the chests
 * only) and without one it cuts by hand, never with a pickaxe; the drops are picked up after each
 * tree; stopped, it says what it cut and what it picked up (I6).
 * @param {object} bot
 * @param {object} ctx { areas, log, now, tools? }
 * @param {number} [count] logs wanted, default 8
 * @param {string} [kind] kind of wood, empty for any
 * @param {{range?: number, timeoutMs?: number, now?: Function, wait?: Function, axe?: boolean}} [options]
 *   axe: false leaves the axe out (ensureTool itself cuts trees for wood)
 * @returns {Promise<{ok: boolean, reason: string|null, logs: number, cut: number, trees: number, saplings: number, text: string}>}
 *   logs: the logs gained; cut: the logs broken; trees: the trees cut; saplings: the saplings planted
 */
export async function chopTrees(bot, ctx = {}, count = 8, kind = '', options = {}) {
    ({ count, kind } = chopArgs(count, kind));
    const wanted = Math.min(positiveInt(count, 8), 1024);
    const request = normaliseWoodKind(kind ?? '');
    if (!request.known) {
        return { ok: false, reason: 'unknown_kind', logs: 0, cut: 0, trees: 0, saplings: 0, text: unknownWoodText(kind) };
    }
    try {
        const clock = clockOf(ctx, options);
        const start = clock.now();
        const limit = Number.isFinite(options.timeoutMs) ? options.timeoutMs : CHOP_LIMIT_MS;
        const range = Number.isFinite(options.range) && options.range > 0 ? options.range : TREE_DEFAULTS.range;
        const areas = listAreas(ctx, dimensionOf(bot));
        const before = logCounts(bot);
        const done = new Set();
        const cut = [];
        const broken = {};
        let found = 0;
        let leftover = 0;
        let stopped = null;
        let noMore = false;
        while (sum(gainedLogs(bot, before)) < wanted) {
            if (bot.interrupt_code) {
                stopped = 'interrupted';
                break;
            }
            if (clock.now() - start >= limit) {
                stopped = 'time';
                break;
            }
            const tree = nextTree(bot, request.kind, done, areas, range, wanted - sum(gainedLogs(bot, before)));
            if (!tree) {
                noMore = cut.length > 0;
                break;
            }
            if (found === 0) {
                await getAxe(bot, ctx, options);
                if (bot.interrupt_code) {
                    stopped = 'interrupted';
                    break;
                }
            }
            found++;
            done.add(treeKey(tree));
            logTo(ctx, `Cutting the ${tree.kind} tree at (${tree.base.x}, ${tree.base.y}, ${tree.base.z}).`);
            // A started tree is finished: its own limit, not the rest of the whole limit.
            const run = { clock, deadline: clock.now() + TREE_LIMIT_MS, movements: movementsFor(bot, tree, areas) };
            const res = await cutTree(bot, tree, run);
            for (const [name, n] of Object.entries(res.cut ?? {})) {
                broken[name] = (broken[name] ?? 0) + n;
            }
            if (res.broken > 0) {
                cut.push(tree);
                leftover += res.leftover;
            }
            if (res.stopped) {
                stopped = res.stopped;
                break;
            }
        }
        let planted = 0;
        if (cut.length > 0 && stopped !== 'interrupted') {
            const run = { clock, deadline: clock.now() + SAPLING_WAIT_MS + 30000, movements: [makeMovements(bot, { dig: false })] };
            await waitForSaplings(bot, cut, run);
            planted = await plantSaplings(bot, cut, run);
        }
        if (bot.interrupt_code) {
            stopped = 'interrupted';
        } else if (cut.length > 0) {
            // the number in the text is what the inventory gained, read when it is quiet (I1)
            await quietInventory(bot, clock);
        }
        const logs = gainedLogs(bot, before);
        // I6: stopped, the text says what was cut and what was picked up
        const text = stopped === 'interrupted' ? chopStoppedText({ cut: broken, picked: sum(logs) })
            : chopText({ trees: cut.map(t => t.kind), logs, planted, leftover, noMore, stopped, found, kind: request.kind, range });
        logTo(ctx, text);
        const ok = cut.length > 0 && stopped !== 'interrupted';
        let reason = null;
        if (!ok) {
            reason = stopped ?? (found > 0 ? 'unreachable' : 'no_tree');
        }
        return { ok, reason, logs: sum(logs), cut: sum(broken), trees: cut.length, saplings: planted, text };
    } catch (err) {
        console.warn('Wood pack: cutting trees failed:', err?.message ?? err);
        stopMoving(bot);
        return { ok: false, reason: 'error', logs: 0, cut: 0, trees: 0, saplings: 0, text: `I could not cut trees: ${err?.message ?? err}` };
    }
}
