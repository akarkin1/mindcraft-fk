// Engineer E1 of v0.1.4.11, part W, spec W2 and W3: the texts of the tunnel and of the new mine underground in
// src/agent/packs/mining/texts.js, word for word. Part M (engineer E2) calls them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const T = await loadSrc('src/agent/packs/mining/texts.js');

const TUNNEL = { start: { x: 10, y: 30, z: 6 }, dir: 'north', end: { x: 10, y: 30, z: 2 }, length: 5, level: 30 };

describe('W2: the tunnel', () => {
    test('measured from the bot, 1 wide', () => {
        assert.equal(T.rememberTunnelText(TUNNEL),
            'I measured the tunnel: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30. I dig on at its end when you ask for ore.');
        assert.equal(T.rememberTunnelText({ ...TUNNEL, width: 1 }), T.rememberTunnelText(TUNNEL), 'width 1 is not said');
    });

    test('2 wide', () => {
        assert.equal(T.rememberTunnelText({ ...TUNNEL, width: 2 }),
            'I measured the tunnel: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30, 2 wide. I dig on at its end when you ask for ore.');
    });

    test('from where the player stands, 1 and 2 wide', () => {
        assert.equal(T.rememberTunnelText({ ...TUNNEL, fromPlayer: true }),
            'I measured the tunnel from where you stand: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30. I dig on at its end when you ask for ore.');
        assert.equal(T.rememberTunnelText({ ...TUNNEL, fromPlayer: true, width: 2 }),
            'I measured the tunnel from where you stand: it starts at (10, 30, 6), goes north, and ends at (10, 30, 2) after 5 blocks, at level 30, 2 wide. I dig on at its end when you ask for ore.');
    });

    test('no tunnel: open sides, the width ahead, the ceiling', () => {
        assert.equal(T.noCorridorText({ kind: 'open_sides', at: { x: 10, y: 30, z: 6 }, sides: 3 }),
            'I stand in no tunnel: it is open on 3 sides at (10, 30, 6). Stand in the tunnel and say "dig here".');
        assert.equal(T.noCorridorText({ kind: 'wide', at: { x: 10, y: 30, z: 5 }, width: 3 }),
            'I stand in no tunnel: the way ahead at (10, 30, 5) is 3 wide. A tunnel is 1 or 2 wide and 2 high.');
        assert.equal(T.noCorridorText({ kind: 'ceiling', at: { x: 10.4, y: 32, z: 6.9 } }),
            'I stand in no tunnel: the ceiling at (10, 32, 6) is open. A tunnel is 1 or 2 wide and 2 high.');
    });

    test('no tunnel without a cause it knows: the text of v0.1.4.9', () => {
        for (const cause of [null, {}, { kind: 'odd', at: { x: 1, y: 2, z: 3 } }, { kind: 'ceiling' }])
            assert.equal(T.noCorridorText(cause), T.TEXTS.noCorridor, JSON.stringify(cause));
    });
});

describe('W3: the new mine underground', () => {
    test('a shaft from inside a known mine', () => {
        assert.equal(T.shaftFromHereText(-58, 'diamond'), 'I dig a shaft down from here to level -58 for diamond.');
        assert.equal(T.shaftFromHereText(16, 'diamond_ore'), 'I dig a shaft down from here to level 16 for diamond.', 'the ore of the ore table');
    });

    test('underground, in no mine the bot knows', () => {
        assert.equal(T.TEXTS.undergroundNoMine,
            'I am underground, not in a mine I know. A new mine starts from the surface: say "leave the mine" or "go to the surface" first.');
    });

    test('in a known mine with mine_from_inside off', () => {
        assert.equal(T.inMineText({ name: 'mine', entrance: { x: 9, y: 67, z: 52 } }),
            'I am in the mine "mine". A new shaft from inside needs the setting mine_from_inside; say "leave the mine" first for a new mine from the surface.');
        assert.equal(T.inMineText({ entrance: { x: 20, y: 64, z: -14 } }),
            'I am in the mine at (20, 64, -14). A new shaft from inside needs the setting mine_from_inside; say "leave the mine" first for a new mine from the surface.');
    });
});
