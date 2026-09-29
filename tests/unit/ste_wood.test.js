// Spec v0.1.4.8 E3 (part E, engineer E5): wood and tools. `num` of chopTrees is the number of logs
// wanted, the drops are picked up after each tree, a stopped chopTrees says what it cut and picked
// up (I6), an axe first and never a pickaxe in the hand, chooseMaterial counts the known chests and
// an empty material is the best up to stone, a failed craft names the item and the missing
// ingredient, and the inventory is read again before each craft step.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { count, dropItem, fakeCraftRecipe, give, logsLeft, makeClock, makeWoodBot, makeWorld, plantTree, v } from './wood_fake_bot.test.js';

const W = await loadSrc('src/agent/packs/wood/wood.js');
const K = await loadSrc('src/agent/packs/wood/tools.js');
const L = await loadSrc('src/agent/packs/wood/tool_logic.js');
const T = await loadSrc('src/agent/packs/wood/texts.js');
const P = await loadSrc('src/agent/packs/wood/index.js');

let warn;
let warnings = [];
before(() => {
    warn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
});
after(() => {
    console.warn = warn;
});

function scene({ pos = [0.5, 64, 3.5], areas = [], onWait = null } = {}) {
    const world = makeWorld();
    const bot = makeWoodBot({ world, pos });
    const clock = makeClock(onWait ? (t) => onWait(t, bot, world) : null);
    const lines = [];
    const ctx = { areas, log: (t) => lines.push(t), now: clock.now, skills: { craftRecipe: fakeCraftRecipe(bot) } };
    return { world, bot, ctx, clock, lines, opts: { now: clock.now, wait: clock.wait } };
}

const inv = (...pairs) => {
    const out = [];
    for (let i = 0; i < pairs.length; i += 2) out.push({ name: pairs[i], count: pairs[i + 1] });
    return out;
};
const digs = (bot) => bot.calls.filter(c => c[0] === 'dig');

/** A storage of chests in memory: fetchItem gives what the chests hold. */
function fakeStorage(bot, holds) {
    const calls = [];
    return {
        calls,
        async fetchItem(b, ctx, name, n = 1) {
            calls.push([name, n]);
            const k = Math.min(holds[name] ?? 0, n);
            if (k > 0) {
                give(bot, name, k);
                holds[name] -= k;
            }
            return { ok: k > 0, taken: k, text: '' };
        },
    };
}

describe('chopArgs: both orders of the arguments (T5)', () => {
    test('number first, word first, empty word, numbers as text', () => {
        assert.deepEqual(W.chopArgs(8, 'oak'), { count: 8, kind: 'oak' });
        assert.deepEqual(W.chopArgs('oak', 8), { count: 8, kind: 'oak' });
        assert.deepEqual(W.chopArgs('', 8), { count: 8, kind: '' });
        assert.deepEqual(W.chopArgs('birch', '6'), { count: '6', kind: 'birch' });
        assert.deepEqual(W.chopArgs('6', 'birch'), { count: '6', kind: 'birch' });
        assert.deepEqual(W.chopArgs(undefined, undefined), { count: undefined, kind: undefined });
        assert.deepEqual(W.chopArgs(3), { count: 3, kind: undefined });
    });
});

describe('chopTrees: num is the number of logs wanted (T1)', () => {
    test('chopTrees(1): one whole tree, not more', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        plantTree(s.world, { x: 20, z: 3 });
        give(s.bot, 'oak_sapling', 1);
        const r = await W.chopTrees(s.bot, s.ctx, 1, '', s.opts);
        assert.equal(r.ok, true, r.text);
        assert.equal(r.trees, 1);
        assert.equal(r.logs, 5);
        assert.equal(r.cut, 5);
        assert.equal(logsLeft(s.world).length, 5, 'the second tree stands');
    });

    test('("", 6): the number second is the number of logs, two trees', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        plantTree(s.world, { x: 16, z: 3 });
        const r = await W.chopTrees(s.bot, s.ctx, '', 6, s.opts);
        assert.equal(r.trees, 2, r.text);
        assert.ok(r.logs >= 6);
    });
});

describe('chopTrees: the axe first, never a pickaxe (T4)', () => {
    test('ensureTool of ctx.tools is asked for an axe before the first tree, from inventory and chests only', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        const asked = [];
        s.ctx.tools = {
            async ensureTool(bot, ctx, kind, material, options) {
                asked.push([kind, material, options?.collect]);
                give(bot, 'stone_axe', 1);
                return { ok: true, text: 'I crafted a stone_axe.' };
            },
        };
        await W.chopTrees(s.bot, s.ctx, 4, '', s.opts);
        assert.deepEqual(asked, [['axe', '', false]]);
        assert.ok(s.bot.calls.some(c => c[0] === 'equip' && c[1] === 'stone_axe'));
    });

    test('no axe asked for when the bot has one, or when no tree is found', async () => {
        const s = scene();
        const asked = [];
        s.ctx.tools = { async ensureTool() { asked.push(1); return { ok: false, text: '' }; } };
        await W.chopTrees(s.bot, s.ctx, 4, '', s.opts);
        assert.deepEqual(asked, [], 'no tree');
        plantTree(s.world, { x: 10, z: 3 });
        give(s.bot, 'iron_axe', 1);
        await W.chopTrees(s.bot, s.ctx, 4, '', s.opts);
        assert.deepEqual(asked, [], 'an axe carried');
    });

    test('without an axe and without material: an empty hand, the pickaxe is put away before a log is dug', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        const pick = give(s.bot, 'iron_pickaxe', 1);
        s.bot.heldItem = pick;
        s.bot.unequip = async (dest) => {
            s.bot.calls.push(['unequip', dest]);
            s.bot.heldItem = null;
        };
        const held = [];
        const dig = s.bot.dig;
        s.bot.dig = async (block, look) => {
            held.push(s.bot.heldItem?.name ?? null);
            await dig(block, look);
        };
        s.ctx.tools = K.ensureTool ? { ensureTool: K.ensureTool } : undefined;
        const r = await W.chopTrees(s.bot, s.ctx, 4, '', s.opts);
        assert.equal(r.logs, 5, r.text);
        assert.ok(held.length > 0);
        assert.ok(held.every(n => !/_pickaxe$/.test(n ?? '')), JSON.stringify(held));
        assert.ok(s.bot.calls.some(c => c[0] === 'unequip' && c[1] === 'hand'));
    });

    test('a full inventory cannot take the pickaxe: a block without wear is held instead', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        give(s.bot, 'dirt', 5);
        const pick = give(s.bot, 'stone_pickaxe', 1);
        s.bot.heldItem = pick;
        s.bot.unequip = async () => { throw new Error('inventory full'); };
        const held = [];
        const dig = s.bot.dig;
        s.bot.dig = async (block, look) => {
            held.push(s.bot.heldItem?.name ?? null);
            await dig(block, look);
        };
        await W.chopTrees(s.bot, s.ctx, 4, '', s.opts);
        assert.ok(held.every(n => !/_pickaxe$/.test(n ?? '')), JSON.stringify(held));
    });

    test('the real ensureTool makes a wooden axe from carried logs and cuts no tree for it', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        give(s.bot, 'birch_log', 3);
        s.ctx.tools = { ensureTool: K.ensureTool };
        s.ctx.wood = { chopTrees: async () => { throw new Error('must not cut trees for the axe'); } };
        const r = await W.chopTrees(s.bot, s.ctx, 4, '', s.opts);
        assert.equal(count(s.bot, 'wooden_axe'), 1);
        assert.ok(s.bot.calls.some(c => c[0] === 'equip' && c[1] === 'wooden_axe'));
        assert.equal(r.ok, true, r.text);
    });

    test('options.axe false leaves the axe out', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        const asked = [];
        s.ctx.tools = { async ensureTool() { asked.push(1); return { ok: false, text: '' }; } };
        await W.chopTrees(s.bot, s.ctx, 4, '', { ...s.opts, axe: false });
        assert.deepEqual(asked, []);
    });
});

describe('chopTrees: drops and the stop (T1, I6)', () => {
    // logs that drop 3 blocks away from the trunk and are not picked up by the dig itself
    function farDrops(s) {
        const dig = s.bot.dig;
        s.bot.dig = async (block, look) => {
            const p = block.position;
            const name = s.world.nameAt(p.x, p.y, p.z);
            if (!/_log$/.test(name)) return dig(block, look);
            s.bot.calls.push(['dig', p.x, p.y, p.z]);
            s.world.set(p.x, p.y, p.z, 'air');
            s.bot.fall();
            dropItem(s.bot, name, { x: p.x + 3, y: 64, z: p.z + 3 });
            if (s.onDig) s.onDig();
        };
    }

    test('stopped after 2 logs with the drops on the ground: the text of I6', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3, height: 8 });
        farDrops(s);
        let n = 0;
        s.onDig = () => { if (++n >= 2) s.bot.interrupt_code = true; };
        const r = await W.chopTrees(s.bot, s.ctx, 8, '', s.opts);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'I cut 2 oak_log and picked up 0. I was stopped before I picked up the rest.');
        assert.equal(r.cut, 2);
        assert.equal(r.logs, 0);
    });

    test('a whole tree whose logs fall away: they are picked up after the tree', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        farDrops(s);
        const r = await W.chopTrees(s.bot, s.ctx, 5, '', s.opts);
        assert.equal(r.logs, 5, r.text);
        assert.equal(count(s.bot, 'oak_log'), 5);
    });

    test('the time of the tree is over: the drops are still picked up', async () => {
        const s = scene();
        plantTree(s.world, { x: 10, z: 3 });
        farDrops(s);
        let jumped = false;
        s.onDig = () => {
            if (!jumped) {
                jumped = true;
                s.clock.t += W.TREE_LIMIT_MS + 1000;
            }
        };
        const r = await W.chopTrees(s.bot, s.ctx, 5, '', s.opts);
        assert.equal(r.cut, 1);
        assert.equal(r.logs, 1, r.text);
        assert.equal(count(s.bot, 'oak_log'), 1);
        assert.match(r.text, /The time for cutting trees was over\.$/);
    });
});

describe('texts (E3, I6)', () => {
    test('chopStoppedText', () => {
        assert.equal(T.chopStoppedText({ cut: { oak_log: 3 }, picked: 2 }), 'I cut 3 oak_log and picked up 2. I was stopped before I picked up the rest.');
        assert.equal(T.chopStoppedText({ cut: { oak_log: 3 }, picked: 3 }), 'I cut 3 oak_log and picked up 3. I was stopped.');
        assert.equal(T.chopStoppedText({ cut: { oak_log: 3, birch_log: 2 }, picked: 5 }), 'I cut 3 oak_log, 2 birch_log and picked up 5. I was stopped.');
        assert.equal(T.chopStoppedText({ cut: {}, picked: 0 }), 'I stopped before I cut a tree.');
        assert.equal(T.chopStoppedText(null), 'I stopped before I cut a tree.');
    });

    test('craftFailedText names the item and the missing ingredient', () => {
        assert.equal(T.craftFailedText('stone_pickaxe', { name: 'stick', need: 2, have: 1 }), 'I could not craft stone_pickaxe: I need 2 stick and have 1.');
        assert.equal(T.craftFailedText('stick', { name: 'planks', need: 2, have: 0 }), 'I could not craft stick: I need 2 planks and have none.');
        assert.equal(T.craftFailedText('stick'), 'I could not craft stick.');
    });
});

describe('chooseMaterial counts the known chests; an empty material is the best up to stone (T3)', () => {
    test('rows', () => {
        assert.equal(L.chooseMaterial('pickaxe', '', [], { chests: { cobblestone: 130 } }), 'stone', 'the play test: 130 cobblestone in a chest');
        assert.equal(L.chooseMaterial('pickaxe', '', [], { chests: [{ name: 'cobblestone', count: 3 }] }), 'stone');
        assert.equal(L.chooseMaterial('pickaxe', '', [], { chests: { cobblestone: 2 } }), 'wooden');
        assert.equal(L.chooseMaterial('pickaxe', '', [], { chests: {} }), 'wooden');
        assert.equal(L.chooseMaterial('pickaxe', '', inv('diamond', 3, 'iron_ingot', 3)), 'wooden', 'never iron or diamond without a word');
        assert.equal(L.chooseMaterial('pickaxe', '', inv('diamond', 3, 'cobblestone', 3)), 'stone');
        assert.equal(L.chooseMaterial('pickaxe', 'stone', [], { chests: { iron_ingot: 3 } }), 'iron', 'a material named: the best at least that');
        assert.equal(L.chooseMaterial('pickaxe', 'iron', [], { chests: { diamond: 3 } }), 'diamond');
        assert.equal(L.chooseMaterial('pickaxe', null, [], { chests: { cobblestone: 5 } }), 'stone');
        assert.equal(L.chooseMaterial('axe', '', inv('cobbled_deepslate', 3)), 'stone');
        assert.equal(L.OPEN_MATERIAL_MAX, 'stone');
    });

    test('ensureTool("pickaxe", ""): a stone pickaxe from the cobblestone of a known chest, not a wooden one', async () => {
        const s = scene();
        give(s.bot, 'oak_log', 3);
        s.ctx.storage = fakeStorage(s.bot, { cobblestone: 130 });
        s.ctx.chests = { list: () => [{ x: 11, y: 67, z: 53, items: { cobblestone: 130, leaf_litter: 104 } }] };
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', '', s.opts);
        assert.equal(r.text, 'I crafted a stone_pickaxe.');
        assert.deepEqual(s.ctx.storage.calls, [['cobblestone', 3]]);
        assert.equal(count(s.bot, 'wooden_pickaxe'), 0);
    });

    test('chestCounts adds up the chests of the index; without an index {}', () => {
        const bot = makeWoodBot({ world: makeWorld() });
        const ctx = { chests: { list: () => [{ items: { cobblestone: 81, wheat: 3 } }, { items: { cobblestone: 49, bad: 'x' } }] } };
        assert.deepEqual(K.chestCounts(bot, ctx), { cobblestone: 130, wheat: 3 });
        assert.deepEqual(K.chestCounts(bot, {}), {});
        assert.deepEqual(K.chestCounts(bot, { chests: { list: () => { throw new Error('x'); } } }), {});
    });

    test('with collect false only the chests are asked: no tree is cut, no stone is broken', async () => {
        const s = scene();
        plantTree(s.world, { x: 8, z: 0 });
        s.ctx.wood = { chopTrees: async () => { throw new Error('must not cut trees'); } };
        const r = await K.ensureTool(s.bot, s.ctx, 'axe', '', { ...s.opts, collect: false });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'missing');
        assert.equal(r.text, 'I need 3 oak_log for a wooden_axe and have none.');
        assert.equal(digs(s.bot).length, 0);
    });
});

describe('a craft step: the inventory is read again, a failure names the item and the ingredient (M12)', () => {
    test('stepIngredients and missingIngredient, every kind of step', () => {
        const have = inv('oak_log', 2, 'oak_planks', 5, 'birch_planks', 7, 'stick', 3, 'charcoal', 1, 'cobbled_deepslate', 3);
        assert.deepEqual(L.stepIngredients({ item: 'oak_planks', times: 2 }, have), [{ name: 'oak_log', need: 2, have: 2 }]);
        assert.deepEqual(L.stepIngredients({ item: 'stick', times: 2 }, have), [{ name: 'birch_planks', need: 4, have: 7 }], 'one kind of planks, the most');
        assert.deepEqual(L.stepIngredients({ item: 'crafting_table', times: 1 }, have), [{ name: 'birch_planks', need: 4, have: 7 }]);
        assert.deepEqual(L.stepIngredients({ item: 'chest', times: 1 }, have), [{ name: 'birch_planks', need: 8, have: 7 }]);
        assert.deepEqual(L.stepIngredients({ item: 'ladder', times: 1 }, have), [{ name: 'stick', need: 7, have: 3 }]);
        assert.deepEqual(L.stepIngredients({ item: 'torch', times: 2 }, have), [{ name: 'stick', need: 2, have: 3 }, { name: 'coal', need: 2, have: 1 }]);
        assert.deepEqual(L.stepIngredients({ item: 'stone_pickaxe', times: 1 }, have), [{ name: 'cobblestone', need: 3, have: 3 }, { name: 'stick', need: 2, have: 3 }]);
        assert.deepEqual(L.stepIngredients({ item: 'wooden_sword', times: 1 }, have), [{ name: 'birch_planks', need: 2, have: 7 }, { name: 'stick', need: 1, have: 3 }]);
        assert.deepEqual(L.stepIngredients({ item: 'iron_axe', times: 1 }, []), [{ name: 'iron_ingot', need: 3, have: 0 }, { name: 'stick', need: 2, have: 0 }]);
        assert.deepEqual(L.stepIngredients({ item: 'stick', times: 1 }, []), [{ name: 'planks', need: 2, have: 0 }]);
        assert.deepEqual(L.stepIngredients({ item: 'mystery' }, have), []);
        assert.deepEqual(L.stepIngredients(null, have), []);
        assert.deepEqual(L.missingIngredient({ item: 'chest', times: 1 }, have), { name: 'birch_planks', need: 8, have: 7 });
        assert.deepEqual(L.missingIngredient({ item: 'torch', times: 2 }, have), { name: 'coal', need: 2, have: 1 });
        assert.equal(L.missingIngredient({ item: 'stone_pickaxe', times: 1 }, have), null);
    });

    test('planks gone before the step of the table: the text and the warning name crafting_table and planks', async () => {
        const s = scene();
        give(s.bot, 'oak_log', 3);
        const craft = s.ctx.skills.craftRecipe;
        s.ctx.skills.craftRecipe = async (bot, item, n) => {
            const r = await craft(bot, item, n);
            if (item === 'stick') bot.inventory.list = bot.inventory.list.filter(i => i.name !== 'oak_planks');
            return r;
        };
        warnings = [];
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', '', s.opts);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'craft_failed');
        assert.equal(r.text, 'I could not craft crafting_table: I need 4 planks and have none.');
        assert.ok(warnings.some(w => w === 'Wood pack: crafting crafting_table failed: missing planks, 0 of 4.'), JSON.stringify(warnings));
        assert.ok(!s.bot.calls.some(c => /^craft/.test(c[0]) && c[1] === 'crafting_table'), 'the step is not tried without its ingredient');
    });

    test('an error of mineflayer ("missing ingredient") names the item in the warning', async () => {
        const s = scene();
        give(s.bot, 'oak_log', 3);
        const craft = s.ctx.skills.craftRecipe;
        s.ctx.skills.craftRecipe = async (bot, item, n) => {
            if (item === 'wooden_pickaxe') throw new Error('missing ingredient');
            return craft(bot, item, n);
        };
        warnings = [];
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', '', s.opts);
        assert.equal(r.ok, false);
        assert.equal(r.text, 'I could not craft wooden_pickaxe.');
        assert.ok(warnings.some(w => w.startsWith('Wood pack: crafting wooden_pickaxe failed: missing ingredient')), JSON.stringify(warnings));
    });

    test('an inventory that is late after a craft is waited for before the next step', async () => {
        const s = scene();
        give(s.bot, 'oak_log', 3);
        const craft = s.ctx.skills.craftRecipe;
        let late = null;
        s.ctx.skills.craftRecipe = async (bot, item, n) => {
            if (item === 'oak_planks') {
                // the planks show up in the inventory 300 ms after the craft
                bot.inventory.list = bot.inventory.list.filter(i => i.name !== 'oak_log');
                late = s.clock.t + 300;
                bot.calls.push(['craft', item, n]);
                return true;
            }
            return craft(bot, item, n);
        };
        const wait = s.clock.wait;
        s.clock.wait = async (ms) => {
            await wait(ms);
            if (late !== null && s.clock.t >= late) {
                give(s.bot, 'oak_planks', 12);
                late = null;
            }
        };
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', '', { now: s.clock.now, wait: s.clock.wait });
        assert.equal(r.text, 'I crafted a wooden_pickaxe.');
    });

    test('stopped between two steps: the text names the next item', async () => {
        const s = scene();
        give(s.bot, 'oak_log', 3);
        const craft = s.ctx.skills.craftRecipe;
        s.ctx.skills.craftRecipe = async (bot, item, n) => {
            const r = await craft(bot, item, n);
            if (item === 'stick') bot.interrupt_code = true;
            return r;
        };
        const r = await K.ensureTool(s.bot, s.ctx, 'pickaxe', '', s.opts);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'I was stopped before I crafted crafting_table.');
    });
});

describe('index.js exports the new names', () => {
    test('E3', () => {
        for (const name of ['chopArgs', 'DROP_PICKUP_MS', 'chopStoppedText', 'craftFailedText', 'stepIngredients', 'missingIngredient',
            'OPEN_MATERIAL_MAX', 'chestCounts', 'TOOLS_API', 'WOOD_API']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
    });
});

void v;
