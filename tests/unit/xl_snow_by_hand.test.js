// v0.1.4.14, part L (engineer E1), fix round part 8 (P-19 point 2, spec 8.3.2): snow (the layer) and snow_block are
// breakable by hand for the path finder. minecraft-data lists the shovels as their harvestTools because only the drop
// (snowballs) needs one; the game breaks both by hand (0.5 s and 1 s). The path finder digs them by hand already
// (its dig cost comes from digTime, which is finite); the rule that stopped the owner's bot ("Pathfinding stopped:
// Cannot break snow with current tools", goToPosition of skills.js) read canHarvest, which is false without a shovel.
// The check now lets snow and snow_block through; every other block that needs a tool still stops the walk.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';
import { TEST_MC_VERSION } from '../helpers/load.js';

const require = createRequire(import.meta.url);
const registry = require('prismarine-registry')(TEST_MC_VERSION);
const Block = require('prismarine-block')(registry);

const blockOf = (name) => Block.fromStateId(registry.blocksByName[name].defaultState, 0);
const byHand = (block) => block.digTime(null, false, false, false, [], {});

describe('L: snow and snow_block break by hand (the data of 26.1 and the check of skills.js)', () => {
    test('the game needs the shovel for the drop only: harvestTools lists shovels, the dig by hand is short', () => {
        for (const name of ['snow', 'snow_block']) {
            const block = blockOf(name);
            const tools = Object.keys(block.harvestTools ?? {}).map((id) => registry.items[id].name);
            assert.ok(tools.length > 0 && tools.every((t) => t.endsWith('_shovel')), `${name}: harvestTools are shovels (${tools.join(', ')})`);
            assert.equal(Boolean(block.canHarvest(null)), false, `${name}: canHarvest by hand is false (no drop)`);
            assert.ok(Number.isFinite(byHand(block)) && byHand(block) <= 1000, `${name}: breaks by hand in ${byHand(block)} ms`);
        }
        assert.equal(byHand(blockOf('snow')), 500);
        assert.equal(byHand(blockOf('snow_block')), 1000);
        assert.equal(blockOf('snow').material, 'mineable/shovel');
    });

    test('stone by hand is the slow dig the check is for', () => {
        const stone = blockOf('stone');
        assert.equal(Boolean(stone.canHarvest(null)), false);
        assert.equal(byHand(stone), 7500);
    });

    test('the check of goToPosition lets snow and snow_block through and stops on every other unharvestable block', () => {
        const src = fs.readFileSync(repoPath('src/agent/library/skills.js'), 'utf8');
        assert.match(src, /const BREAKS_BY_HAND = new Set\(\['snow', 'snow_block'\]\);/);
        assert.match(src, /if \(!targetBlock\.canHarvest\(itemId\) && !BREAKS_BY_HAND\.has\(targetBlock\.name\)\) \{\s*\n\s*log\(bot, `Pathfinding stopped: Cannot break \$\{targetBlock\.name\} with current tools\.`\);/);
        // the rule as the check applies it, on the data of 26.1
        const BREAKS_BY_HAND = new Set(['snow', 'snow_block']);
        const stops = (name, itemId = null) => !blockOf(name).canHarvest(itemId) && !BREAKS_BY_HAND.has(name);
        assert.equal(stops('snow'), false);
        assert.equal(stops('snow_block'), false);
        assert.equal(stops('powder_snow'), false, 'no harvestTools: by hand anyway');
        assert.equal(stops('dirt'), false);
        assert.equal(stops('stone'), true);
        assert.equal(stops('iron_ore'), true);
        assert.equal(stops('stone', registry.itemsByName.wooden_pickaxe.id), false);
        assert.equal(stops('snow', registry.itemsByName.wooden_shovel.id), false);
    });
});
