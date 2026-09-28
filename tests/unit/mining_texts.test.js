// Spec v0.1.4.7 M4: the texts of mineOre word for word, and the other texts of the mining pack.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const T = await loadSrc('src/agent/packs/mining/texts.js');

const MINE = { entrance: { x: 20, y: 64, z: -14 }, length: 37, level: 16 };

describe('texts of mineOre (spec M4)', () => {
    test('done', () => {
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 8, wanted: 8, mine: MINE, stored: { cobblestone: 96 } }),
            'I mined 8 raw_iron. The mine is at (20, 64, -14), its tunnel is 37 blocks long at level 16. I also stored 96 cobblestone in the chest of the mine.');
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 9, wanted: 8, mine: MINE }),
            'I mined 9 raw_iron. The mine is at (20, 64, -14), its tunnel is 37 blocks long at level 16.');
    });

    test('less than asked, with every reason', () => {
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 5, wanted: 8, reason: 'pickaxe', mine: MINE }),
            'I mined 5 raw_iron of 8. I stopped because my pickaxe is nearly broken. The mine is at (20, 64, -14), its tunnel is 37 blocks long at level 16.');
        const reasons = { health: 'my health is low', hungry: 'I am hungry and have no food', time: 'the time for one trip is over', interrupted: 'you stopped me' };
        for (const [reason, words] of Object.entries(reasons)) {
            assert.ok(T.mineOreText({ item: 'coal', mined: 0, wanted: 8, reason, mine: MINE }).startsWith(`I mined 0 coal of 8. I stopped because ${words}. The mine is at`), reason);
        }
        assert.match(T.mineOreText({ item: 'coal', mined: 1, wanted: 2, reason: 'whatever' }), /because something went wrong\.$/);
        assert.equal(T.mineOreText({ item: 'coal', mined: 1, wanted: 2, reason: 'time', extra: 'I am in the mine.' }),
            'I mined 1 coal of 2. I stopped because the time for one trip is over. I am in the mine.');
    });

    test('cannot go, unknown ore', () => {
        assert.equal(T.cannotMineText('diamond', 'iron', 'stone_pickaxe'), 'I cannot mine diamond. I need an iron pickaxe and have a stone_pickaxe.');
        assert.equal(T.cannotMineText('coal', 'stone', null), 'I cannot mine coal. I need a stone pickaxe and have no pickaxe.');
        assert.equal(T.cannotMineText('diamond_ore', 'iron', 'iron_pickaxe'), 'I cannot mine diamond. I need an iron pickaxe and have an iron_pickaxe.');
        assert.equal(T.cannotMineText('mithril', 'iron', ''), 'I cannot mine mithril. I need an iron pickaxe and have no pickaxe.');
        assert.equal(T.unknownOreText('mithril'), 'I do not know the ore "mithril". I know coal, copper, iron, lapis, gold, redstone and diamond.');
        assert.equal(T.unknownOreText(null), 'I do not know the ore "". I know coal, copper, iron, lapis, gold, redstone and diamond.');
    });

    test('the mine sentence and lists', () => {
        assert.equal(T.mineText({ ...MINE, length: 1 }), 'The mine is at (20, 64, -14), its tunnel is 1 block long at level 16.');
        assert.equal(T.mineText({ entrance: { x: 1, y: 2, z: 3 }, level: 5 }), 'The mine is at (1, 2, 3), its tunnel is 0 blocks long at level 5.');
        assert.equal(T.mineText(null), '');
        const stored = { cobblestone: 96, dirt: 12, a: 1, b: 1, c: 1, d: 1, e: 1 };
        assert.match(T.mineOreText({ item: 'coal', mined: 2, wanted: 2, stored }), /I also stored 96 cobblestone, 12 dirt, 1 a, 1 b, 1 c, 1 d and 1 more kinds in the chest of the mine\.$/);
        assert.equal(T.article('iron'), 'an');
        assert.equal(T.article('stone'), 'a');
    });
});

describe('texts of the other functions', () => {
    test('descend', () => {
        assert.equal(T.descendText({ level: 16, mine: MINE, dug: 48, ladders: 45, patches: 3 }),
            'I went down to level 16 in the mine at (20, 64, -14): I dug 48 blocks, placed 45 ladders and closed 3 holes.');
        assert.equal(T.descendText({ level: 16, dug: 60, ladders: 10, stairs: 35, patches: 0 }),
            'I went down to level 16: I dug 60 blocks, placed 10 ladders, made 35 steps of a staircase and closed 0 holes.');
        assert.equal(T.descendText({ level: 16, mine: MINE, climbed: true }), 'I went down to level 16 in the mine at (20, 64, -14).');
    });

    test('tunnel', () => {
        assert.equal(T.tunnelText({ steps: 8, length: 32, collected: { raw_iron: 3 }, torches: 1, patches: 2 }),
            'I dug 8 steps of the tunnel, it is 32 blocks long now. I collected 3 raw_iron, placed 1 torches and closed 2 holes.');
        assert.equal(T.tunnelText({ steps: 2, length: 2, reason: 'blocked' }),
            'I dug 2 steps of the tunnel, it is 2 blocks long now. I collected no ore, placed 0 torches and closed 0 holes. I stopped because my way is blocked by lava, water or caves.');
        assert.equal(T.tunnelText(null), 'I dug 0 steps of the tunnel, it is 0 blocks long now. I collected no ore, placed 0 torches and closed 0 holes.');
    });
});
