// T1, spec v0.1.4.9 C1: oreInSight(getName, pos, range) of src/agent/library/ore_sight_logic.js and collectBlock of
// skills.js for an ore. range 0: the ore has a face towards a non-solid cell (air, cave air, water, torch, ladder,
// or a cell dug in this call); range 3: a non-solid cell within 3 blocks (Chebyshev). When every candidate is out
// of sight the text of C1: the long one with !mineOre on (handoff: mining_pack on, a hidden ore within 16 blocks,
// an ore the pack mines), else the short one. The signature of collectBlock does not change. The rule holds also
// without the mining pack (a property of ore_sense_range). The small world: a Map of cells, everything else stone.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry, HOTBAR } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const O = await loadSrc('src/agent/library/ore_sight_logic.js');
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
const agentSettings = await loadSrc('src/agent/settings.js');
mcdata.__setMcdataForTests(registry);

const LONG = 'I see no iron_ore. I know that there is some within 16 blocks, but it is inside the rock. Tell me to mine iron and I get it from a mine.';
const SHORT = 'I see no iron_ore within 16 blocks.';

// getName over a Map: the cells that are set, stone elsewhere
function rock(cells = {}) {
    const map = new Map(Object.entries(cells));
    return (x, y, z) => map.get(`${x},${y},${z}`) ?? 'stone';
}
const ORE = { x: 0, y: 20, z: 0 };
const withOre = (extra) => ({ '0,20,0': 'iron_ore', ...extra });

describe('C1: oreInSight, range 0', () => {
    test('stone on all six faces: not in sight', () => {
        assert.equal(O.oreInSight(rock(withOre()), ORE, 0), false);
    });

    for (const open of ['air', 'cave_air', 'water', 'torch', 'ladder']) {
        test(`a face towards ${open}: in sight`, () => {
            assert.equal(O.oreInSight(rock(withOre({ '0,21,0': open })), ORE, 0), true);
            assert.equal(O.oreInSight(rock(withOre({ '-1,20,0': open })), ORE, 0), true);
        });
    }

    test('air only at an edge or a corner (no face): not in sight', () => {
        assert.equal(O.oreInSight(rock(withOre({ '1,21,0': 'air', '1,21,1': 'air' })), ORE, 0), false);
    });

    test('air two blocks away: not in sight with range 0', () => {
        assert.equal(O.oreInSight(rock(withOre({ '2,20,0': 'air' })), ORE, 0), false);
    });

    test('another ore or a solid block on the face: not in sight', () => {
        assert.equal(O.oreInSight(rock(withOre({ '0,21,0': 'iron_ore', '0,19,0': 'dirt', '1,20,0': 'deepslate' })), ORE, 0), false);
    });
});

describe('C1: oreInSight, range 3 (Chebyshev)', () => {
    test('air 2 and 3 blocks away, also on a diagonal: in sight', () => {
        assert.equal(O.oreInSight(rock(withOre({ '2,20,0': 'air' })), ORE, 3), true);
        assert.equal(O.oreInSight(rock(withOre({ '0,20,-3': 'air' })), ORE, 3), true);
        assert.equal(O.oreInSight(rock(withOre({ '3,23,3': 'cave_air' })), ORE, 3), true);
        assert.equal(O.oreInSight(rock(withOre({ '-3,17,2': 'water' })), ORE, 3), true);
    });

    test('air 4 blocks away: not in sight', () => {
        assert.equal(O.oreInSight(rock(withOre({ '4,20,0': 'air' })), ORE, 3), false);
        assert.equal(O.oreInSight(rock(withOre({ '1,24,1': 'air' })), ORE, 3), false);
    });

    test('a face in the open: in sight with range 3 too', () => {
        assert.equal(O.oreInSight(rock(withOre({ '0,21,0': 'air' })), ORE, 3), true);
    });
});

// ------------------------------------------------------------------------------ collectBlock

const DROPS = { iron_ore: [['raw_iron', 1]] };
function scene(blocks) {
    const world = createBlockWorld().flatGround(63);
    for (const [name, x, y, z] of blocks) world.set(x, y, z, name);
    const bot = makeBot({ world });
    bot.inventory.put('stone_pickaxe', 1, HOTBAR);
    bot.broken = [];
    const breakIt = (block) => {
        const p = block.position;
        bot.broken.push(`${p.x},${p.y},${p.z}`);
        world.set(p.x, p.y, p.z, 'air');
        for (const [name, n] of DROPS[block.name] ?? []) bot.inventory.add(name, n);
    };
    bot.collectBlock = { async collect(block) { breakIt(block); } };
    bot.dig = async (block) => { breakIt(block); };
    return { world, bot };
}

let cap;
beforeEach(() => {
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    agentSettings.setSettings({});
});

describe('C1: collectBlock for an ore', () => {
    // exposed: in the grass layer, its top face in the air; at y 61: 2 blocks under the grass, 3 under the air;
    // at y 56: 7 under the air
    test('ore_sense_range 0, mining pack off: the exposed ore is taken; the one inside the rock stays; the short text', async () => {
        agentSettings.setSettings({ ore_sense_range: 0, mining_pack: false });
        const { world, bot } = scene([['iron_ore', 3, 63, 0], ['iron_ore', 5, 56, 0]]);
        const ok = await skills.collectBlock(bot, 'iron_ore', 2);
        assert.equal(ok, true);
        assert.deepEqual(bot.broken, ['3,63,0']);
        assert.equal(world.get(5, 56, 0), 'iron_ore');
        assert.ok(bot.output.includes(SHORT), bot.output);
        assert.ok(!bot.output.includes(LONG));
    });

    test('ore_sense_range 0, only ore inside the rock, mining pack off: nothing dug, `I see no iron_ore within 16 blocks.`', async () => {
        agentSettings.setSettings({ ore_sense_range: 0, mining_pack: false });
        const { bot } = scene([['iron_ore', 3, 61, 0]]);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.deepEqual(bot.broken, []);
        assert.equal(bot.output.trim(), SHORT);
    });

    test('ore_sense_range 0, only ore inside the rock, mining pack on (!mineOre on): the long text', async () => {
        agentSettings.setSettings({ ore_sense_range: 0, mining_pack: true });
        const { bot } = scene([['iron_ore', 3, 61, 0]]);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.deepEqual(bot.broken, []);
        assert.equal(bot.output.trim(), LONG);
    });

    test('ore_sense_range 3: the ore 3 blocks under the air is in sight and taken', async () => {
        agentSettings.setSettings({ ore_sense_range: 3, mining_pack: false });
        const { bot } = scene([['iron_ore', 3, 61, 0]]);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), true);
        assert.deepEqual(bot.broken, ['3,61,0']);
    });

    test('ore_sense_range 3: an ore 7 blocks inside the rock stays', async () => {
        agentSettings.setSettings({ ore_sense_range: 3, mining_pack: false });
        const { bot } = scene([['iron_ore', 3, 56, 0]]);
        assert.equal(await skills.collectBlock(bot, 'iron_ore', 1), false);
        assert.deepEqual(bot.broken, []);
        assert.equal(bot.output.trim(), SHORT);
    });

    test('the signature of collectBlock is unchanged: (bot, blockType, num = 1, exclude = null)', () => {
        assert.equal(skills.collectBlock.length, 2);
        const src = skills.collectBlock.toString();
        assert.match(src, /^async function collectBlock\(bot, blockType, num\s*=\s*1, exclude\s*=\s*null\)/);
    });
});
