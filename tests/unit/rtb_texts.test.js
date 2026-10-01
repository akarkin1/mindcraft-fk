// Spec v0.1.4.9 part B (engineer E2): the texts of B2, B3, B4 and B6 word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const T = await loadSrc('src/agent/packs/mining/texts.js');

const LEGS = [{ kind: 'walk' }, { kind: 'door', kind2: 'door' }, { kind: 'ladder' }, { kind: 'door', kind2: 'trapdoor' }, { kind: 'walk' }, { kind: 'walk' }];
const ROOM = { center: { x: 1, y: 41, z: 0 }, chest: { x: 0, y: 41, z: 2 }, table: { x: 4, y: 41, z: 2 }, furnace: null };
const TUNNEL = { start: { x: 22, y: 25, z: 2 }, dir: 'north', end: { x: 22, y: 25, z: 13 }, level: 25, length: 12 };

describe('B2: rememberMine', () => {
    test('the text of the spec', () => {
        assert.equal(T.rememberMineText({ name: 'mine', entrance: { x: 30, y: 60, z: 4 }, route: LEGS.filter(l => l.kind2 !== 'door').concat([{ kind: 'walk' }]),
            room: ROOM, tunnel: TUNNEL }),
        'I remember the mine "mine": the entrance at (30, 60, 4), the way in has 6 steps with 1 ladder and 1 trapdoor, the room at level 41 with a chest and a crafting table, one tunnel at level 25, 12 blocks long, going north.');
    });

    test('the variants: all three, no chest, no room, no tunnel, replaced, the area', () => {
        assert.match(T.rememberMineText({ name: 'mine', entrance: { x: 0, y: 0, z: 0 }, route: [], room: { ...ROOM, furnace: { x: 1, y: 41, z: 1 } }, tunnel: TUNNEL }),
            /, the room at level 41 with a chest, a crafting table and a furnace, /);
        assert.match(T.rememberMineText({ name: 'mine', entrance: { x: 0, y: 0, z: 0 }, route: [], room: { ...ROOM, chest: null }, tunnel: TUNNEL }),
            /, the room at level 41 with a crafting table and no chest, /);
        assert.equal(T.rememberMineText({ name: 'mine', entrance: { x: 0, y: 64, z: 0 }, route: [{ kind: 'walk' }], room: null, tunnel: null, replaced: true, area: 'mining_area' }),
            'I know a mine "mine" already. I replace it. I remember the mine "mine": the entrance at (0, 64, 0), the way in has 1 step, no chest, no tunnel yet: stand in a tunnel and say "dig here". It is in the area "mining_area".');
        assert.equal(T.wayWords(LEGS), '6 steps with 1 ladder, 1 door and 1 trapdoor');
        assert.equal(T.wayWords([{ kind: 'ladder' }, { kind: 'ladder' }, { kind: 'door', kind2: 'gate' }]), '3 steps with 2 ladders and 1 gate');
        assert.equal(T.wayWords(null), '0 steps');
    });

    test('no trail, no entrance', () => {
        assert.equal(T.TEXTS.noTrail, 'I have no trail. The routes pack is off.');
        assert.equal(T.noEntranceText(40), 'I have not been under open sky since I started. Walk with me from the entrance of the mine and tell me again.');
        assert.equal(T.noEntranceText(500, 500), 'I was not under open sky in my last 500 steps. Walk with me from the entrance of the mine and tell me again.');
        assert.equal(T.noEntranceText(40, 40), 'I was not under open sky in my last 40 steps. Walk with me from the entrance of the mine and tell me again.');
    });
});

describe('B3: rememberTunnel', () => {
    test('the text of the spec and the refusals', () => {
        assert.equal(T.rememberTunnelText(TUNNEL),
            'I measured the tunnel: it starts at (22, 25, 2), goes north, and ends at (22, 25, 13) after 12 blocks, at level 25. I dig on at its end when you ask for ore.');
        assert.match(T.rememberTunnelText({ ...TUNNEL, length: 1 }), / after 1 block, /);
        assert.equal(T.TEXTS.noMineHere, 'I know no mine here. Tell me "this is the mine" first.');
        assert.equal(T.TEXTS.noCorridor, 'I stand in no tunnel. A tunnel is 1 wide and 2 high and open ahead of me.');
    });
});

describe('B4: a mine of the player without a tunnel for the ore', () => {
    test('plural, singular, several levels, none', () => {
        const mine = { name: 'mine' };
        assert.equal(T.noTunnelText(mine, 'diamond', [{ level: 25 }, { level: 25 }]),
            'Your mine "mine" has no tunnel where diamond is found (from -64 to 16). Its tunnels are at level 25. Show me a tunnel at that depth, or tell me to dig a new mine.');
        assert.equal(T.noTunnelText(mine, 'diamond', [{ level: 25 }]),
            'Your mine "mine" has no tunnel where diamond is found (from -64 to 16). Its tunnel is at level 25. Show me a tunnel at that depth, or tell me to dig a new mine.');
        assert.match(T.noTunnelText(mine, 'redstone_ore', [{ level: 25 }, { level: 40 }]), /where redstone is found \(from -64 to 15\)\. Its tunnels are at levels 40 and 25\. /);
        assert.match(T.noTunnelText(mine, 'coal', []), /\(from 0 to 192\)\. It has no tunnel yet\. Show me/);
    });
});

describe('B6: the ore list', () => {
    test('one sentence per reason, the ores summed by kind', () => {
        const e = (ore, reason) => ({ ore, reason });
        assert.equal(T.passedText([e('gold', 'pickaxe'), e('gold', 'pickaxe')]), 'I left 2 gold_ore behind: I need an iron pickaxe.');
        assert.equal(T.passedText([e('coal', 'lava')]), 'I left 1 coal_ore behind: lava beside it.');
        assert.equal(T.passedText([e('coal', 'inventory'), e('iron', 'inventory'), e('coal', 'inventory')]), 'I left 2 coal_ore and 1 iron_ore behind: my inventory was full.');
        assert.equal(T.passedText([e('iron', 'vein')]), 'I left 1 iron_ore behind: the vein was bigger than 12.');
        assert.equal(T.passedText([e('iron', 'stopped')]), 'I left 1 iron_ore behind: I was stopped.');
        assert.equal(T.passedText([e('iron', 'stopped'), e('diamond', 'pickaxe')]),
            'I left 1 diamond_ore behind: I need an iron pickaxe. I left 1 iron_ore behind: I was stopped.', 'in the order of the reasons');
        assert.equal(T.passedText([]), '');
    });

    test('mineOreText gets the sentences as extra', () => {
        assert.equal(T.mineOreText({ item: 'raw_iron', mined: 2, wanted: 2, mine: { entrance: { x: 0, y: 64, z: -3 }, length: 13, level: 34 },
            extra: T.passedText([{ ore: 'gold', reason: 'pickaxe' }, { ore: 'gold', reason: 'pickaxe' }]) }),
        'I mined 2 raw_iron. The mine is at (0, 64, -3), its tunnel is 13 blocks long at level 34. I left 2 gold_ore behind: I need an iron pickaxe.');
    });

    test('collectPassedOre: the four texts of the spec', () => {
        const mine = { name: 'mine' };
        assert.equal(T.collectPassedText({ ore: 'coal', collected: { coal: 4 }, stay: [{ ore: 'gold', reason: 'pickaxe' }, { ore: 'gold', reason: 'pickaxe' }], mine }),
            'I collected 4 coal_ore that I had passed. 2 gold_ore stay: I need an iron pickaxe.');
        assert.equal(T.collectPassedText({ ore: 'coal', collected: { coal: 4 }, stay: [], mine }), 'I collected 4 coal_ore that I had passed.');
        assert.equal(T.collectPassedText({ ore: 'coal', none: true, mine }), 'I passed no coal in the mine "mine".');
        assert.equal(T.collectPassedText({ ore: 'coal', stopped: true, done: 2, total: 6, mine }), 'I was stopped after 2 of 6 coal_ore.');
        assert.equal(T.collectPassedText({ ore: 'coal', none: true, mine: { entrance: { x: 1, y: 2, z: 3 } } }), 'I passed no coal in the mine at (1, 2, 3).');
    });
});
