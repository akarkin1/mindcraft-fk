// T1, spec v0.1.4.9 B6: the sentences of the ore left behind that mineOreText gets as `extra`, one sentence per
// reason, the ores summed by kind: `I left 2 gold_ore behind: I need an iron pickaxe.` / `... behind: lava beside
// it.` / `... behind: my inventory was full.` / `... behind: the vein was bigger than 12.` / `... behind: I was
// stopped.` The pack builds them with passedText(entries) (src/agent/packs/mining/texts.js). Without an extra,
// mineOreText is the text of v0.1.4.8 (compared with the code of the tag).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { loadOld } from '../helpers/rt_old_source.js';

const X = await loadSrc('src/agent/packs/mining/texts.js');
const OLD = await loadOld('src/agent/packs/mining/texts.js');

const e = (ore, reason, i = 0) => ({ ore, x: i, y: 25, z: 0, reason, seen: '2026-09-30T10:00:00.000Z' });

describe('B6: the sentences of the ore left behind', () => {
    const ROWS = [
        ['pickaxe', [e('gold_ore', 'pickaxe', 1), e('gold_ore', 'pickaxe', 2)], 'I left 2 gold_ore behind: I need an iron pickaxe.'],
        ['lava', [e('iron_ore', 'lava')], 'I left 1 iron_ore behind: lava beside it.'],
        ['inventory', [e('coal_ore', 'inventory', 1), e('coal_ore', 'inventory', 2), e('coal_ore', 'inventory', 3)], 'I left 3 coal_ore behind: my inventory was full.'],
        ['vein', [e('iron_ore', 'vein')], 'I left 1 iron_ore behind: the vein was bigger than 12.'],
        ['stopped', [e('copper_ore', 'stopped', 1), e('copper_ore', 'stopped', 2)], 'I left 2 copper_ore behind: I was stopped.'],
    ];
    for (const [reason, entries, text] of ROWS) {
        test(`${reason}: "${text}"`, () => {
            assert.equal(X.passedText(entries), text);
        });
    }

    test('one sentence per reason', () => {
        const text = X.passedText([e('gold_ore', 'pickaxe', 1), e('coal_ore', 'inventory', 2), e('gold_ore', 'pickaxe', 3)]);
        assert.equal(text, 'I left 2 gold_ore behind: I need an iron pickaxe. I left 1 coal_ore behind: my inventory was full.');
    });

    test('the ores summed by kind: gold_ore and deepslate_gold_ore are 2 gold_ore', () => {
        assert.equal(X.passedText([e('gold_ore', 'pickaxe', 1), e('deepslate_gold_ore', 'pickaxe', 2)]), 'I left 2 gold_ore behind: I need an iron pickaxe.');
    });

    test('no entries: no text', () => {
        assert.equal(X.passedText([]), '');
    });

    test('mineOreText gets the sentences as extra, after the text of the trip', () => {
        const extra = X.passedText([e('gold_ore', 'pickaxe', 1), e('gold_ore', 'pickaxe', 2)]);
        const text = X.mineOreText({ item: 'raw_iron', mined: 2, wanted: 2, extra });
        assert.ok(text.startsWith('I mined 2 raw_iron.'), text);
        assert.ok(text.endsWith(' I left 2 gold_ore behind: I need an iron pickaxe.'), text);
    });
});

describe('B6, rule 6: mineOreText without extra is the text of v0.1.4.8', () => {
    const mine = { ore: 'iron', entrance: { x: 20, y: 64, z: -14 }, level: 16, length: 37, direction: 'north' };
    const CASES = [
        { item: 'raw_iron', mined: 8, wanted: 8, mine, stored: { cobblestone: 96 } },
        { item: 'raw_iron', mined: 5, wanted: 8, reason: 'pickaxe', mine },
        { item: 'coal', mined: 0, wanted: 8, reason: 'time', mine: null },
        { item: 'raw_gold', mined: 3, wanted: 3 },
    ];
    for (const r of CASES) {
        test(`${r.item} ${r.mined} of ${r.wanted}${r.reason ? `, ${r.reason}` : ''}`, (t) => {
            if (!OLD) return t.skip('the tag v0.1.4.8 is not in this checkout');
            assert.equal(X.mineOreText(r), OLD.mineOreText(r));
        });
    }
});
