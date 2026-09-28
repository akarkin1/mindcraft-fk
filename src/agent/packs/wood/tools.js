// Tools and supplies (spec v0.1.4.7 T4). The decisions are in tool_logic.js; this module gets what
// is missing (chests, trees, stone) and crafts through ctx.skills.craftRecipe.
//
// ctx: { areas, log, now } of the home pack, and
// - skills.craftRecipe(bot, name, times): crafting of the library (required);
// - wood.chopTrees(bot, ctx, count): part T; without it the chopTrees of this pack;
// - storage.fetchItem(bot, ctx, name, count): part S, optional: without it no chest is asked;
// - chests: the chest index, optional: it tells which wood the chests hold.
import { containsPos, expandBox } from '../home/box_math.js';
import { clockOf, dimensionOf, entitiesWhere, listAreas, logTo } from '../home/context.js';
import { goals, gotoGoal, makeMovements, walkNear } from '../home/motion.js';
import { EXEC_REACH, digBlock, eyeOfBot, feetOf, isAirLike, nameAt } from './actions.js';
import { countItems, inventoryOf } from './inventory.js';
import { chopTrees } from './wood.js';
import { craftedSupplyText, craftedToolsText, haveToolText, needText, notCraftableText, unknownMaterialText,
    unknownSupplyText, unknownToolText, withArticle } from './texts.js';
import { bestTool, chooseMaterial, craftSteps, isWoodItem, normaliseSupply, normaliseToolRequest, supplySteps, toolName,
    toolsOf, usesLeft } from './tool_logic.js';
import { WOOD_KINDS, inReach } from './tree_logic.js';

/** Stone is broken for cobblestone within this distance. */
export const STONE_RANGE = 16;
/** Upper limit of breaking stone. */
export const STONE_LIMIT_MS = 2 * 60 * 1000;
/** Text when there is no stone to break. */
export const NO_STONE_TEXT = `I found no stone within ${STONE_RANGE} blocks that I may break.`;

const MAX_DEPTH = 2;
const FALLING = new Set(['sand', 'red_sand', 'gravel', 'suspicious_sand', 'suspicious_gravel']);
const LIQUID = new Set(['water', 'lava']);
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function positiveInt(value, fallback) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    return Number.isInteger(n) && n > 0 ? n : fallback;
}

function toolResult(ok, reason, tool, crafted, text) {
    return { ok, reason: ok ? null : reason, tool, crafted: [...crafted], text };
}

function withCrafted(crafted, text) {
    return crafted.length > 0 ? `${craftedToolsText(crafted)} ${text}` : text;
}

/**
 * True when a crafting table stands within 16 blocks (craftRecipe uses it). Never throws.
 * @param {object} bot
 * @returns {boolean}
 */
export function tableNear(bot) {
    try {
        const found = bot.findBlocks({ matching: b => !!b && b.name === 'crafting_table', maxDistance: 16, count: 1 });
        return Array.isArray(found) && found.length > 0;
    } catch {
        return false;
    }
}

// How many of the missing item the bot has, and the text that it needs more.
function needFor(bot, missing, target) {
    const have = missing.name === 'coal' ? countItems(bot, n => n === 'coal' || n === 'charcoal') : countItems(bot, missing.name);
    return needText(missing.name, have + missing.count, have, target);
}

// Names of wood the chests of the index hold, most first; without an index the missing name.
function woodInChests(bot, ctx, fallback) {
    const totals = {};
    try {
        const chests = typeof ctx.chests?.list === 'function' ? ctx.chests.list(dimensionOf(bot)) : [];
        for (const chest of Array.isArray(chests) ? chests : []) {
            for (const [name, n] of Object.entries(chest?.items ?? {})) {
                const planks = name.endsWith('_planks') && WOOD_KINDS.includes(name.replace(/_planks$/, ''));
                if ((isWoodItem(name) || planks) && n > 0) {
                    totals[name] = (totals[name] ?? 0) + n;
                }
            }
        }
    } catch {
        return [fallback];
    }
    const names = Object.keys(totals).sort((a, b) => totals[b] - totals[a] || (a < b ? -1 : 1));
    return names.length > 0 ? names.slice(0, 3) : [fallback];
}

async function fetchFromChests(bot, ctx, plan, planFn) {
    for (const m of plan.missing) {
        if (bot.interrupt_code) {
            return;
        }
        if (!isWoodItem(m.name)) {
            await ctx.storage.fetchItem(bot, ctx, m.name, m.count);
            continue;
        }
        for (const name of woodInChests(bot, ctx, m.name)) {
            const short = planFn().missing.find(x => isWoodItem(x.name));
            if (!short) {
                break;
            }
            await ctx.storage.fetchItem(bot, ctx, name, name.endsWith('_planks') ? short.count * 4 : short.count);
        }
    }
}

function stoneIsBreakable(bot, p, feet) {
    if (feet && p.x === feet.x && p.z === feet.z && p.y < feet.y) {
        return false;
    }
    let open = false;
    for (const [dx, dy, dz] of FACES) {
        const name = nameAt(bot, { x: p.x + dx, y: p.y + dy, z: p.z + dz });
        if (name === null || LIQUID.has(name)) {
            return false;
        }
        if (dy === 1 && FALLING.has(name)) {
            return false;
        }
        open = open || isAirLike(name);
    }
    return open;
}

async function pickUpNear(bot, pos, clock) {
    const items = entitiesWhere(bot, 16, e => e.name === 'item' && e.isValid !== false
        && Math.hypot(e.position.x - (pos.x + 0.5), e.position.z - (pos.z + 0.5)) <= 3 && Math.abs(e.position.y - pos.y) <= 3);
    for (const e of items.slice(0, 4)) {
        await gotoGoal(bot, new goals.GoalNear(Math.floor(e.position.x), Math.floor(e.position.y), Math.floor(e.position.z), 1), {
            movements: makeMovements(bot, { dig: false }), timeoutMs: 8000, clock,
        });
    }
}

/**
 * Breaks stone within 16 blocks, outside of protected areas and 2 blocks around them, until the
 * bot has `need` more cobblestone. Only stone with a face in the air, nothing liquid beside it and
 * nothing falling above it; never the block under the bot. Needs a pickaxe. Never throws.
 * @param {object} bot
 * @param {object} ctx
 * @param {number} need
 * @param {{now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, got: number, text: string}>}
 */
export async function collectCobblestone(bot, ctx, need, options = {}) {
    const clock = clockOf(ctx, options);
    const before = countItems(bot, 'cobblestone');
    try {
        if (!bestTool(inventoryOf(bot), 'pickaxe')) {
            return { ok: false, got: 0, text: 'I have no pickaxe to break stone.' };
        }
        const areas = listAreas(ctx, dimensionOf(bot)).map(a => expandBox(a, 2)).filter(Boolean);
        let found = [];
        try {
            found = bot.findBlocks({ matching: b => !!b && b.name === 'stone', maxDistance: STONE_RANGE, count: 64 }) ?? [];
        } catch {
            found = [];
        }
        const feet = feetOf(bot);
        const stones = found.map(p => ({ x: p.x, y: p.y, z: p.z }))
            .filter(p => !areas.some(a => containsPos(a, p)) && stoneIsBreakable(bot, p, feet));
        if (stones.length === 0) {
            return { ok: false, got: 0, text: NO_STONE_TEXT };
        }
        const start = clock.now();
        let tries = 0;
        for (const p of stones) {
            if (countItems(bot, 'cobblestone') - before >= need || bot.interrupt_code || clock.now() - start >= STONE_LIMIT_MS
                || tries >= need + 8) {
                break;
            }
            tries++;
            if (!inReach(eyeOfBot(bot), p, EXEC_REACH)) {
                await walkNear(bot, p, 3, { clock, timeoutMs: 15000 });
            }
            const f = feetOf(bot);
            if (!inReach(eyeOfBot(bot), p, EXEC_REACH) || (f && f.x === p.x && f.z === p.z && p.y < f.y)) {
                continue;
            }
            if (await digBlock(bot, p, clock, n => n === 'stone', 'pickaxe')) {
                await pickUpNear(bot, p, clock);
            }
        }
        const got = countItems(bot, 'cobblestone') - before;
        return { ok: got >= need, got, text: got >= need ? '' : 'I could not break enough stone nearby.' };
    } catch (err) {
        return { ok: false, got: countItems(bot, 'cobblestone') - before, text: `I could not break stone: ${err?.message ?? err}` };
    }
}

// Gets what the plan misses: from chests, then cobblestone by breaking stone (with a wooden
// pickaxe made first when needed), then logs by cutting trees.
async function gather(bot, ctx, planFn, target, run) {
    let plan = planFn();
    if (plan.missing.length === 0) {
        return { ok: true, plan };
    }
    if (typeof ctx.storage?.fetchItem === 'function') {
        await fetchFromChests(bot, ctx, plan, planFn);
        plan = planFn();
    }
    const hard = plan.missing.find(m => !isWoodItem(m.name) && m.name !== 'cobblestone');
    if (hard) {
        return { ok: false, reason: 'missing', text: needFor(bot, hard, target) };
    }
    const cobble = plan.missing.find(m => m.name === 'cobblestone');
    if (cobble) {
        if (!bestTool(inventoryOf(bot), 'pickaxe')) {
            if (run.depth >= MAX_DEPTH) {
                return { ok: false, reason: 'missing', text: needFor(bot, cobble, target) };
            }
            const sub = await ensureTool(bot, ctx, 'pickaxe', 'wooden', { ...run.options, depth: run.depth + 1, count: 1, minUses: 1 });
            run.crafted.push(...sub.crafted);
            if (!sub.ok) {
                return { ok: false, reason: sub.reason, text: sub.text, nested: true };
            }
        }
        const res = await collectCobblestone(bot, ctx, cobble.count, run.options);
        plan = planFn();
        const still = plan.missing.find(m => m.name === 'cobblestone');
        if (still) {
            return { ok: false, reason: bot.interrupt_code ? 'interrupted' : 'missing', text: `${needFor(bot, still, target)} ${res.text}`.trim() };
        }
    }
    const wood = plan.missing.find(m => isWoodItem(m.name));
    if (wood) {
        if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted', text: 'I was interrupted.' };
        }
        const chop = typeof ctx.wood?.chopTrees === 'function' ? ctx.wood.chopTrees : chopTrees;
        let res = null;
        try {
            res = await chop(bot, ctx, wood.count, '', { now: run.options.now, wait: run.options.wait });
        } catch (err) {
            res = { text: `I could not cut trees: ${err?.message ?? err}` };
        }
        plan = planFn();
        const still = plan.missing.find(m => isWoodItem(m.name));
        if (still) {
            return { ok: false, reason: bot.interrupt_code ? 'interrupted' : 'missing', text: `${needFor(bot, still, target)} ${res?.text ?? ''}`.trim() };
        }
    }
    if (plan.missing.length > 0) {
        return { ok: false, reason: 'missing', text: needFor(bot, plan.missing[0], target) };
    }
    return { ok: true, plan };
}

// Found on the real server: right after craftRecipe the inventory of mineflayer can be stale or
// show items twice for a moment. The count is read when it has not changed for 400 ms.
async function settledCount(bot, clock, item, ms = 2000) {
    let last = countItems(bot, item);
    let since = clock.now();
    const start = clock.now();
    while (clock.now() - start < ms && clock.now() - since < 400) {
        await clock.wait(100);
        const now = countItems(bot, item);
        if (now !== last) {
            last = now;
            since = clock.now();
        }
    }
    return last;
}

// Crafts the craft steps in order through ctx.skills.craftRecipe. A step that makes less than
// planned is tried again with the rest (a recipe variant runs out: coal, then charcoal).
async function runSteps(bot, ctx, steps, clock) {
    const craft = ctx.skills?.craftRecipe;
    if (typeof craft !== 'function') {
        return { ok: false, reason: 'craft_failed', text: 'I cannot craft: the crafting skill is missing.' };
    }
    for (const s of steps) {
        if (s.action !== 'craft') {
            continue;
        }
        if (bot.interrupt_code) {
            return { ok: false, reason: 'interrupted', text: 'I was interrupted.' };
        }
        const per = s.makes / s.times;
        let made = 0;
        for (let i = 0; i < 3 && made < s.makes; i++) {
            const before = await settledCount(bot, clock, s.item);
            let done = false;
            try {
                done = await craft(bot, s.item, Math.ceil((s.makes - made) / per)) === true;
            } catch (err) {
                console.warn('Wood pack: crafting failed:', err?.message ?? err);
            }
            const gained = (await settledCount(bot, clock, s.item)) - before;
            if (gained <= 0 || !done) {
                made += Math.max(0, gained);
                break;
            }
            made += gained;
        }
        if (made === 0) {
            return { ok: false, reason: 'craft_failed', text: `I could not craft ${s.item}.` };
        }
    }
    return { ok: true };
}

/**
 * Makes sure the bot has a tool of the kind (spec T4). With a tool of the kind that is good
 * enough: `I have a stone_pickaxe.` Otherwise it crafts the best tool the inventory allows, at
 * least minMaterial (empty: wooden; golden counts as wooden, netherite is never crafted). What is
 * missing it looks for in chests (ctx.storage.fetchItem), then gets by itself where that is
 * simple: logs through ctx.wood.chopTrees, cobblestone by breaking stone within 16 blocks outside
 * of protected areas (with a wooden pickaxe it crafts first). It does not smelt and does not mine
 * for iron or diamonds: `I need 3 iron_ingot for an iron_pickaxe and have 1.` Texts:
 * `I crafted a stone_pickaxe.`, `I crafted a wooden_pickaxe and a stone_pickaxe.` Never throws.
 * @param {object} bot
 * @param {object} ctx { areas, log, now, skills: { craftRecipe }, wood?, storage?, chests? }
 * @param {string} kind pickaxe, axe, shovel, hoe or sword; a full name such as `iron_pickaxe` works too
 * @param {string} [minMaterial] wooden, stone, iron, diamond, netherite; empty: wooden
 * @param {{minUses?: number, count?: number, now?: Function, wait?: Function}} [options]
 *   minUses: a tool with fewer uses left does not count (default 1); count: how many such tools
 *   the bot wants (default 1), for a second pickaxe on a long trip
 * @returns {Promise<{ok: boolean, reason: string|null, tool: string|null, crafted: string[], text: string}>}
 *   reasons: unknown_kind, unknown_material, not_craftable, missing, craft_failed, interrupted, error
 */
export async function ensureTool(bot, ctx = {}, kind = '', minMaterial = '', options = {}) {
    const request = normaliseToolRequest(kind, minMaterial);
    if (request.error === 'kind') {
        return toolResult(false, 'unknown_kind', null, [], unknownToolText(kind));
    }
    if (request.error === 'material') {
        return toolResult(false, 'unknown_material', null, [], unknownMaterialText(minMaterial));
    }
    const crafted = [];
    try {
        const depth = Number.isInteger(options.depth) ? options.depth : 0;
        const minUses = positiveInt(options.minUses, 1);
        const want = positiveInt(options.count, 1);
        const good = toolsOf(inventoryOf(bot), request.kind, request.material).filter(t => (usesLeft(t) ?? minUses) >= minUses);
        if (good.length >= want) {
            return toolResult(true, null, good[0].name, [], haveToolText(good[0].name));
        }
        if (request.material === 'netherite') {
            return toolResult(false, 'not_craftable', null, [], notCraftableText(toolName(request.kind, 'netherite')));
        }
        const target = chooseMaterial(request.kind, request.material, inventoryOf(bot), { table: tableNear(bot) });
        const name = toolName(request.kind, target);
        const planFn = () => craftSteps(request.kind, target, inventoryOf(bot), { table: tableNear(bot) });
        const got = await gather(bot, ctx, planFn, withArticle(name), { depth, crafted, options });
        if (!got.ok) {
            return toolResult(false, got.reason, null, crafted, got.nested ? got.text : withCrafted(crafted, got.text));
        }
        const made = await runSteps(bot, ctx, got.plan.steps, clockOf(ctx, options));
        if (!made.ok) {
            return toolResult(false, made.reason, null, crafted, withCrafted(crafted, made.text));
        }
        crafted.push(name);
        const text = craftedToolsText(crafted);
        if (depth === 0) {
            logTo(ctx, text);
        }
        return toolResult(true, null, name, crafted, text);
    } catch (err) {
        console.warn('Wood pack: getting a tool failed:', err?.message ?? err);
        return toolResult(false, 'error', null, crafted, `I could not get ${withArticle(request.kind)}: ${err?.message ?? err}`);
    }
}

/**
 * Crafts supplies (spec T4): torch, ladder, chest, crafting_table, stick or planks (`planks` is
 * the wood the bot has most of; `birch_planks` works too). The count is rounded up to what the
 * recipe gives. Wood is collected when it is missing (chests first when ctx.storage is there,
 * then trees). Torches need coal or charcoal: `I need 2 coal for 8 torch and have none.`
 * Text: `I crafted 9 ladder.` Never throws.
 * @param {object} bot
 * @param {object} ctx as ensureTool
 * @param {string} item
 * @param {number} [count]
 * @param {{now?: Function, wait?: Function}} [options]
 * @returns {Promise<{ok: boolean, reason: string|null, item: string, count: number, text: string}>}
 *   count: how many were crafted
 */
export async function craftSupplies(bot, ctx = {}, item = '', count = 1, options = {}) {
    const name = normaliseSupply(item);
    if (!name) {
        return { ok: false, reason: 'unknown_item', item: String(item), count: 0, text: unknownSupplyText(item) };
    }
    const n = positiveInt(count, 1);
    let product = name;
    try {
        const planFn = () => supplySteps(name, n, inventoryOf(bot), { table: tableNear(bot) });
        const first = planFn();
        product = first.item;
        const got = await gather(bot, ctx, planFn, `${first.makes} ${first.item}`, { depth: 0, crafted: [], options });
        if (!got.ok) {
            return { ok: false, reason: got.reason, item: product, count: 0, text: got.text };
        }
        product = got.plan.item;
        const clock = clockOf(ctx, options);
        const before = await settledCount(bot, clock, product);
        const made = await runSteps(bot, ctx, got.plan.steps, clock);
        const gained = Math.max(0, (await settledCount(bot, clock, product)) - before);
        if (!made.ok) {
            return { ok: false, reason: made.reason, item: product, count: gained, text: made.text };
        }
        const text = craftedSupplyText(gained, product);
        logTo(ctx, text);
        return { ok: true, reason: null, item: product, count: gained, text };
    } catch (err) {
        console.warn('Wood pack: crafting supplies failed:', err?.message ?? err);
        return { ok: false, reason: 'error', item: product, count: 0, text: `I could not craft ${product}: ${err?.message ?? err}` };
    }
}
