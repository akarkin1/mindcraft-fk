// Tools and the crafting of tools and supplies (spec v0.1.4.7 T3). Pure: inventories are lists of
// { name, count, slot, uses_left } as inventoryOf (inventory.js) builds them.
//
// The recipes of minecraft-data list one variant per kind of planks: three birch planks make a
// pickaxe, two oak and one birch planks make nothing. So the planner uses the wood of one kind,
// the kind of which the bot has most, and counts planks of other kinds as nothing.
import { WOOD_KINDS, logItemOf, planksOf } from './tree_logic.js';

/** Materials of tools, weakest first, each with the item to craft from (spec T3). */
export const MATERIALS = Object.freeze([
    Object.freeze({ name: 'wooden', item: 'planks', level: 0, craftable: true }),
    Object.freeze({ name: 'stone', item: 'cobblestone', level: 1, craftable: true, accepts: Object.freeze(['cobblestone', 'cobbled_deepslate', 'blackstone']) }),
    Object.freeze({ name: 'iron', item: 'iron_ingot', level: 2, craftable: true }),
    Object.freeze({ name: 'diamond', item: 'diamond', level: 3, craftable: true }),
    Object.freeze({ name: 'netherite', item: 'netherite_ingot', level: 4, craftable: false }),
]);
/** Golden tools are known but never crafted. They mine like wooden ones. */
export const GOLDEN = Object.freeze({ name: 'golden', item: 'gold_ingot', level: 0, craftable: false });
/** Uses until a tool breaks. */
export const TOOL_USES = Object.freeze({ wooden: 59, stone: 131, iron: 250, golden: 32, diamond: 1561, netherite: 2031 });
/** Material and sticks per tool. */
export const RECIPES = Object.freeze({
    pickaxe: Object.freeze({ material: 3, sticks: 2 }),
    axe: Object.freeze({ material: 3, sticks: 2 }),
    shovel: Object.freeze({ material: 1, sticks: 2 }),
    hoe: Object.freeze({ material: 2, sticks: 2 }),
    sword: Object.freeze({ material: 2, sticks: 1 }),
});
/** The kinds of tools. */
export const TOOL_KINDS = Object.freeze(Object.keys(RECIPES));
/** What craftSupplies makes. `planks` stands for the planks of any wood. */
export const SUPPLY_NAMES = Object.freeze(['torch', 'ladder', 'chest', 'crafting_table', 'stick', 'planks']);

// Preference between tools of one kind (spec S2): netherite, diamond, iron, stone, golden, wooden.
const RANK = Object.freeze({ wooden: 0, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 });
const ALL_MATERIALS = [...MATERIALS, GOLDEN];
const MATERIAL_WORDS = Object.freeze({ wood: 'wooden', gold: 'golden', cobblestone: 'stone', cobble: 'stone', diamonds: 'diamond' });
const COAL = ['coal', 'charcoal'];

const PLANKS_PER_LOG = 4;
const STICKS_PER_CRAFT = 4;
const PLANKS_PER_STICK_CRAFT = 2;
const PLANKS_PER_TABLE = 4;

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function baseName(name) {
    return typeof name === 'string' ? name.replace(/^minecraft:/, '') : null;
}

function materialOf(name) {
    return ALL_MATERIALS.find(m => m.name === name) ?? null;
}

// Counts by name of a list of items; bad entries are left out.
function countsOf(inventory) {
    const counts = {};
    for (const item of Array.isArray(inventory) ? inventory : []) {
        const name = baseName(item?.name);
        if (name && isFiniteNumber(item.count) && item.count > 0) {
            counts[name] = (counts[name] ?? 0) + item.count;
        }
    }
    return counts;
}

function positiveInt(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The name of a tool: `iron_pickaxe`.
 * @param {string} kind
 * @param {string} material
 * @returns {string}
 */
export function toolName(kind, material) {
    return `${material}_${kind}`;
}

/**
 * `{ kind, material }` of the name of a tool, null for anything else.
 * @param {string} name for example `stone_pickaxe`
 * @returns {{kind: string, material: string}|null}
 */
export function parseTool(name) {
    const n = baseName(name);
    if (!n) {
        return null;
    }
    const cut = n.indexOf('_');
    if (cut < 0) {
        return null;
    }
    const material = n.slice(0, cut);
    const kind = n.slice(cut + 1);
    return RECIPES[kind] && materialOf(material) ? { kind, material } : null;
}

/**
 * The mining level of a material: wooden and golden 0, stone 1, iron 2, diamond 3, netherite 4.
 * An empty material is wooden. null for an unknown material.
 * @param {string} material
 * @returns {number|null}
 */
export function materialLevel(material) {
    if (material === '' || material === null || material === undefined) {
        return 0;
    }
    return materialOf(material)?.level ?? null;
}

/**
 * The uses left of an item: its `uses_left`, for a tool without it the uses of a new one, null
 * for anything that is no tool.
 * @param {{name: string, uses_left?: number|null}} item
 * @returns {number|null}
 */
export function usesLeft(item) {
    if (!item) {
        return null;
    }
    if (isFiniteNumber(item.uses_left)) {
        return Math.max(0, item.uses_left);
    }
    const tool = parseTool(item.name);
    return tool ? TOOL_USES[tool.material] : null;
}

/**
 * The tools of a kind in the inventory that are at least of the material and not broken, best
 * first: by material (netherite, diamond, iron, stone, golden, wooden), then by uses left.
 * @param {object[]} inventory
 * @param {string} kind
 * @param {string} [minMaterial] empty: wooden
 * @returns {object[]} the entries of the inventory
 */
export function toolsOf(inventory, kind, minMaterial = 'wooden') {
    const min = materialLevel(minMaterial);
    if (min === null || !Array.isArray(inventory)) {
        return [];
    }
    return inventory
        .filter(item => {
            const tool = parseTool(item?.name);
            return tool && tool.kind === kind && materialOf(tool.material).level >= min && (usesLeft(item) ?? 1) > 0;
        })
        .sort((a, b) => RANK[parseTool(b.name).material] - RANK[parseTool(a.name).material] || usesLeft(b) - usesLeft(a));
}

/**
 * The best tool of the kind that is at least of that material, or null (spec T3).
 * @param {object[]} inventory
 * @param {string} kind
 * @param {string} [minMaterial] empty: wooden
 * @returns {object|null} the entry of the inventory
 */
export function bestTool(inventory, kind, minMaterial = 'wooden') {
    return toolsOf(inventory, kind, minMaterial)[0] ?? null;
}

/**
 * True for a log or stem the planks recipes take: `oak_log`, `crimson_stem` (not stripped).
 * @param {string} name
 * @returns {boolean}
 */
export function isWoodItem(name) {
    return WOOD_KINDS.some(kind => logItemOf(kind) === name);
}

/**
 * The wood of the inventory: the kind with most wood (planks plus 4 for each log), its planks and
 * its logs. Without wood the preferred kind or oak.
 * @param {object[]} inventory
 * @param {string} [prefer]
 * @returns {{kind: string, planks: number, logs: number}}
 */
export function woodOfInventory(inventory, prefer = null) {
    const counts = countsOf(inventory);
    let best = null;
    for (const kind of WOOD_KINDS) {
        const planks = counts[planksOf(kind)] ?? 0;
        const logs = counts[logItemOf(kind)] ?? 0;
        const wood = planks + PLANKS_PER_LOG * logs;
        if (wood > 0 && (!best || wood > best.wood)) {
            best = { kind, planks, logs, wood };
        }
    }
    if (!best) {
        return { kind: WOOD_KINDS.includes(prefer) ? prefer : 'oak', planks: 0, logs: 0 };
    }
    return { kind: best.kind, planks: best.planks, logs: best.logs };
}

/**
 * The kind of log to make planks from (fix round F24, item 2): the preferred kind when it has the
 * logs for `crafts` crafts, else oak when it has them, else the kind with most logs, oak first among
 * equals. null when the bot carries no log of any kind.
 * @param {object[]} inventory
 * @param {number} crafts the planks crafts needed (1 log each)
 * @param {string|null} [prefer]
 * @returns {string|null}
 */
export function logKindFor(inventory, crafts, prefer = null) {
    const counts = countsOf(inventory);
    const logs = kind => counts[logItemOf(kind)] ?? 0;
    const n = Math.max(1, Number.isFinite(crafts) ? crafts : 1);
    if (WOOD_KINDS.includes(prefer) && logs(prefer) >= n) {
        return prefer;
    }
    if (logs('oak') >= n) {
        return 'oak';
    }
    let best = null;
    for (const kind of WOOD_KINDS) {
        if (logs(kind) > 0 && (!best || logs(kind) > logs(best))) {
            best = kind;
        }
    }
    return best;
}

// The planner behind craftSteps and supplySteps. `need` lists what one product needs in all:
// planks, sticks, other items ({ name, count, accepts, sum }), a crafting table. The steps are:
// the things to get, planks from logs, sticks from planks, the crafting table, the product.
function plan(inventory, need, options) {
    const counts = countsOf(inventory);
    const wood = need.woodKind
        ? { kind: need.woodKind, planks: counts[planksOf(need.woodKind)] ?? 0, logs: counts[logItemOf(need.woodKind)] ?? 0 }
        : woodOfInventory(inventory);
    const missing = [];
    for (const o of need.other ?? []) {
        const accepts = o.accepts ?? [o.name];
        const have = o.sum ? accepts.reduce((s, n) => s + (counts[n] ?? 0), 0) : Math.max(...accepts.map(n => counts[n] ?? 0));
        if (have < o.count) {
            missing.push({ name: o.name, count: o.count - (o.sum ? have : (counts[o.name] ?? 0)) });
        }
    }
    const sticks = need.sticks ?? 0;
    const stickCrafts = Math.ceil(Math.max(0, sticks - (counts.stick ?? 0)) / STICKS_PER_CRAFT) + (need.stickCrafts ?? 0);
    const tableCrafts = need.table && !(counts.crafting_table > 0) && options?.table !== true ? 1 : 0;
    // Fix round F24 (item 2): sticks take 2 planks of one kind per craft, of any kind: when sticks
    // are the only use of planks (torches, sticks), the pairs of the planks of the other kinds count
    // for them; otherwise (a table, a chest, a wooden tool need planks of one kind, and the library
    // may take any kind for the sticks) one kind as before. Planks are made from logs: the kind with
    // the fewest logs short, the kind with most wood first, else the logs the bot carries, oak first.
    const otherPlanks = (need.planks ?? 0) + tableCrafts * PLANKS_PER_TABLE;
    const stickPlanks = stickCrafts * PLANKS_PER_STICK_CRAFT;
    const crafting = kind => {
        const planks = counts[planksOf(kind)] ?? 0;
        const pairs = need.woodKind || otherPlanks > 0 ? 0 : WOOD_KINDS.filter(k => k !== kind)
            .reduce((sum, k) => sum + Math.floor((counts[planksOf(k)] ?? 0) / PLANKS_PER_STICK_CRAFT) * PLANKS_PER_STICK_CRAFT, 0);
        const needed = otherPlanks + Math.max(0, stickPlanks - pairs);
        return Math.ceil(Math.max(0, needed - planks) / PLANKS_PER_LOG) + (need.plankCrafts ?? 0);
    };
    let plankCrafts = crafting(wood.kind);
    if (!need.woodKind && plankCrafts > wood.logs) {
        const kind = logKindFor(inventory, plankCrafts);
        if (kind && kind !== wood.kind) {
            const crafts = crafting(kind);
            const logs = counts[logItemOf(kind)] ?? 0;
            if (Math.max(0, crafts - logs) <= Math.max(0, plankCrafts - wood.logs)) {
                wood.kind = kind;
                wood.planks = counts[planksOf(kind)] ?? 0;
                wood.logs = logs;
                plankCrafts = crafts;
            }
        }
    }
    const logsShort = Math.max(0, plankCrafts - wood.logs);
    if (logsShort > 0) {
        missing.push({ name: logItemOf(wood.kind), count: logsShort });
    }
    const steps = missing.map(m => ({ action: 'get', item: m.name, count: m.count }));
    const craft = (item, times, per) => {
        if (times > 0) {
            steps.push({ action: 'craft', item, times, makes: times * per });
        }
    };
    craft(planksOf(wood.kind), plankCrafts, PLANKS_PER_LOG);
    if (!need.woodKind && plankCrafts > 0) {
        steps[steps.length - 1].anyWood = true; // the kind of log may change at run time (logKindFor)
    }
    craft('stick', stickCrafts, STICKS_PER_CRAFT);
    craft('crafting_table', tableCrafts, 1);
    if (need.product) {
        craft(need.product, need.times, need.per);
    }
    return { steps, missing };
}

/**
 * The things to craft and to get for a tool, in order: planks from logs, sticks from planks, the
 * crafting table, the tool (spec T3). `missing` lists what cannot be crafted from the inventory,
 * as { name, count }; the steps start with a `get` step for each. A tool that is never crafted
 * (golden, netherite) or unknown has no steps and itself as missing.
 * @param {string} kind pickaxe, axe, shovel, hoe or sword
 * @param {string} material wooden, stone, iron or diamond
 * @param {object[]} inventory
 * @param {{table?: boolean}} [options] table: a crafting table stands nearby
 * @returns {{steps: ({action: 'get', item: string, count: number}|{action: 'craft', item: string, times: number, makes: number})[],
 *   missing: {name: string, count: number}[]}}
 */
export function craftSteps(kind, material, inventory, options = {}) {
    const recipe = RECIPES[kind];
    const mat = materialOf(material);
    if (!recipe || !mat || !mat.craftable) {
        return { steps: [], missing: [{ name: toolName(kind, material), count: 1 }] };
    }
    const need = { sticks: recipe.sticks, table: true, product: toolName(kind, material), times: 1, per: 1 };
    if (mat.name === 'wooden') {
        need.planks = recipe.material;
    } else {
        need.other = [{ name: mat.item, count: recipe.material, accepts: mat.accepts }];
    }
    return plan(inventory, need, options);
}

// The items of the known chests as inventory entries: a list of { name, count } or an object of counts.
function chestEntries(chests) {
    if (Array.isArray(chests)) {
        return chests.filter(e => e && typeof e.name === 'string');
    }
    if (chests && typeof chests === 'object') {
        return Object.entries(chests).map(([name, count]) => ({ name, count }));
    }
    return [];
}

/** The strongest material an empty material may choose (spec v0.1.4.8 E3): stone. */
export const OPEN_MATERIAL_MAX = 'stone';

/**
 * The best material for a tool of the kind that the inventory allows, at least minMaterial:
 * the strongest craftable material whose steps miss nothing but wood (wood is collected).
 * Without one: minMaterial itself (empty and golden: wooden).
 * Since v0.1.4.8 (E3): what the known chests hold counts as if carried (`options.chests`, counts
 * by name or a list of { name, count }), and an empty material chooses the best material up to
 * stone (OPEN_MATERIAL_MAX): iron and diamond are used only when the caller names them.
 * @param {string} kind
 * @param {string} minMaterial
 * @param {object[]} inventory
 * @param {{table?: boolean, chests?: object}} [options]
 * @returns {string}
 */
export function chooseMaterial(kind, minMaterial, inventory, options = {}) {
    const min = materialLevel(minMaterial) ?? 0;
    const open = minMaterial === '' || minMaterial === null || minMaterial === undefined;
    const max = open ? materialLevel(OPEN_MATERIAL_MAX) : Infinity;
    const all = [...(Array.isArray(inventory) ? inventory : []), ...chestEntries(options?.chests)];
    const craftable = MATERIALS.filter(m => m.craftable && m.level >= min && m.level <= max).reverse();
    for (const m of craftable) {
        const { missing } = craftSteps(kind, m.name, all, options);
        if (missing.every(x => isWoodItem(x.name))) {
            return m.name;
        }
    }
    if (!minMaterial || minMaterial === 'golden') {
        return 'wooden';
    }
    return minMaterial;
}

// The planks of the single kind of wood the inventory has most of: { name, count }.
function bestPlanks(counts) {
    let best = { name: 'planks', count: 0 };
    for (const kind of WOOD_KINDS) {
        const n = counts[planksOf(kind)] ?? 0;
        if (n > best.count) {
            best = { name: planksOf(kind), count: n };
        }
    }
    return best;
}

/**
 * What one craft step of craftSteps or supplySteps takes from the inventory (spec v0.1.4.8 E3,
 * M12): `{ name, need, have }` per ingredient for all its `times`. Planks count one kind of wood
 * (the kind the inventory has most of); a stone tool takes one of the kinds of cobblestone; a
 * torch takes coal or charcoal. [] for a step it does not know.
 * @param {{item: string, times: number}} step
 * @param {object[]} inventory
 * @returns {{name: string, need: number, have: number}[]}
 */
export function stepIngredients(step, inventory) {
    const item = baseName(step?.item);
    const times = positiveInt(step?.times, 1);
    if (!item) {
        return [];
    }
    const counts = countsOf(inventory);
    const planks = bestPlanks(counts);
    const out = [];
    const add = (name, per, have) => out.push({ name, need: per * times, have });
    const tool = parseTool(item);
    if (item.endsWith('_planks') && WOOD_KINDS.includes(item.replace(/_planks$/, ''))) {
        const log = logItemOf(item.replace(/_planks$/, ''));
        add(log, 1, counts[log] ?? 0);
    } else if (item === 'stick') {
        // fix round F24 (item 2): a stick craft takes 2 planks of one kind, any kind: the pairs of every kind count
        const pairs = WOOD_KINDS.reduce((sum, k) => sum + Math.floor((counts[planksOf(k)] ?? 0) / PLANKS_PER_STICK_CRAFT) * PLANKS_PER_STICK_CRAFT, 0);
        add(planks.name, PLANKS_PER_STICK_CRAFT, pairs);
    } else if (item === 'crafting_table') {
        add(planks.name, PLANKS_PER_TABLE, planks.count);
    } else if (item === 'chest') {
        add(planks.name, 8, planks.count);
    } else if (item === 'ladder') {
        add('stick', 7, counts.stick ?? 0);
    } else if (item === 'torch') {
        add('stick', 1, counts.stick ?? 0);
        add('coal', 1, COAL.reduce((s, n) => s + (counts[n] ?? 0), 0));
    } else if (tool) {
        const recipe = RECIPES[tool.kind];
        const mat = materialOf(tool.material);
        if (mat.name === 'wooden') {
            add(planks.name, recipe.material, planks.count);
        } else {
            const accepts = mat.accepts ?? [mat.item];
            const have = Math.max(...accepts.map(n => counts[n] ?? 0));
            add(mat.item, recipe.material, have);
        }
        add('stick', recipe.sticks, counts.stick ?? 0);
    }
    return out;
}

/**
 * The first ingredient of a craft step that the inventory lacks, or null.
 * @param {{item: string, times: number}} step
 * @param {object[]} inventory
 * @returns {{name: string, need: number, have: number}|null}
 */
export function missingIngredient(step, inventory) {
    return stepIngredients(step, inventory).find(i => i.have < i.need) ?? null;
}

/**
 * The tool a player or the model asks for: `pickaxe`, `Pickaxes`, `iron_pickaxe`; materials
 * `stone`, `wood`, `gold`. An empty material is wooden; a material given apart wins over the one
 * in the name. `{ error: 'kind' }` or `{ error: 'material' }` for words that are not known.
 * @param {*} kind
 * @param {*} [material]
 * @returns {{kind: string, material: string}|{error: 'kind'|'material'}}
 */
export function normaliseToolRequest(kind, material = '') {
    const word = typeof kind === 'string' ? kind.trim().toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_') : '';
    let k = word;
    let m = '';
    const parsed = parseTool(word);
    if (parsed) {
        k = parsed.kind;
        m = parsed.material;
    } else if (!RECIPES[k] && k.endsWith('s') && RECIPES[k.slice(0, -1)]) {
        k = k.slice(0, -1);
    }
    if (!RECIPES[k]) {
        return { error: 'kind' };
    }
    const given = typeof material === 'string' ? material.trim().toLowerCase().replace(/^minecraft:/, '') : '';
    if (given !== '') {
        m = MATERIAL_WORDS[given] ?? given;
    }
    if (m === '') {
        m = 'wooden';
    }
    return materialOf(m) ? { kind: k, material: m } : { error: 'material' };
}

/**
 * The supply a player or the model asks for: torch, ladder, chest, crafting_table, stick, planks
 * or the planks of a kind (`birch_planks`). Plurals and spaces are understood. null otherwise.
 * @param {*} value
 * @returns {string|null}
 */
export function normaliseSupply(value) {
    if (typeof value !== 'string') {
        return null;
    }
    let v = value.trim().toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_');
    if (v === 'torches') {
        v = 'torch';
    } else if (v === 'table') {
        v = 'crafting_table';
    } else if (v.endsWith('s') && SUPPLY_NAMES.includes(v.slice(0, -1))) {
        v = v.slice(0, -1);
    }
    if (SUPPLY_NAMES.includes(v)) {
        return v;
    }
    const kind = v.replace(/_planks$/, '');
    return v.endsWith('_planks') && WOOD_KINDS.includes(kind) ? v : null;
}

/**
 * The things to craft and to get for supplies (spec T4, craftSupplies): torches (4 per craft, a
 * stick and coal or charcoal each), ladders (3 per craft, 7 sticks, a crafting table), chests (8
 * planks, a table), crafting tables (4 planks), sticks (4 per craft from 2 planks; crafted also
 * when the bot carries some) and planks (4 per log; `planks` means the wood the bot has most of).
 * The count is rounded up to what the recipe gives (`makes`). null for anything else.
 * @param {string} item
 * @param {number} count
 * @param {object[]} inventory
 * @param {{table?: boolean}} [options]
 * @returns {{item: string, makes: number, steps: object[], missing: {name: string, count: number}[]}|null}
 */
export function supplySteps(item, count, inventory, options = {}) {
    const name = normaliseSupply(item);
    if (!name) {
        return null;
    }
    const n = positiveInt(count, 1);
    const need = { times: 0, per: 1 };
    if (name === 'torch') {
        need.per = 4;
        need.times = Math.ceil(n / 4);
        need.sticks = need.times;
        need.other = [{ name: 'coal', count: need.times, accepts: COAL, sum: true }];
    } else if (name === 'ladder') {
        need.per = 3;
        need.times = Math.ceil(n / 3);
        need.sticks = 7 * need.times;
        need.table = true;
    } else if (name === 'chest') {
        need.times = n;
        need.planks = 8 * n;
        need.table = true;
    } else if (name === 'crafting_table') {
        need.times = n;
        need.planks = PLANKS_PER_TABLE * n;
    } else if (name === 'stick') {
        need.stickCrafts = Math.ceil(n / STICKS_PER_CRAFT);
        const res = plan(inventory, need, options);
        return { item: 'stick', makes: need.stickCrafts * STICKS_PER_CRAFT, ...res };
    } else {
        const kind = name === 'planks' ? woodOfInventory(inventory).kind : name.replace(/_planks$/, '');
        need.woodKind = kind;
        need.plankCrafts = Math.ceil(n / PLANKS_PER_LOG);
        const res = plan(inventory, need, options);
        return { item: planksOf(kind), makes: need.plankCrafts * PLANKS_PER_LOG, ...res };
    }
    need.product = name;
    const res = plan(inventory, need, options);
    return { item: name, makes: need.times * need.per, ...res };
}
