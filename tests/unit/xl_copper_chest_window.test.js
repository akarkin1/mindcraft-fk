// v0.1.4.14, part L (engineer E1), round 4: bot.openContainer of mineflayer 4.39.0 opens a block only when its name is in
// allowedWindowTypes of lib/plugins/chest.js; the 8 copper chests of 26.1 were not, so the storage pack could not open
// one ("containerToOpen is neither a block nor an entity"). patches/mineflayer+4.39.0.patch appends them, the names of
// COPPER_CHESTS of src/agent/packs/storage/storage_logic.js with the prefix minecraft:. The window of a copper chest is
// minecraft:generic_9x3 (9x6 for a double one), which matchWindowType takes through minecraft:generic.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(import.meta.url);
const injectChest = require('mineflayer/lib/plugins/chest.js');
const ST = await loadSrc('src/agent/packs/storage/storage_logic.js');

const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');
const PREFIXED = ST.COPPER_CHESTS.map((name) => `minecraft:${name}`);
const quotedNames = (text) => [...text.matchAll(/'(minecraft:[a-z_]*copper_chest)'/g)].map((m) => m[1]);

class Block { constructor(name) { this.name = name; } }

function chestBot(windowType = 'minecraft:generic_9x3') {
    const bot = { opened: [] };
    bot.openBlock = async (block) => { bot.opened.push(block.name); return { type: windowType }; };
    bot.openEntity = async () => { throw new Error('no entity here'); };
    injectChest(bot);
    return bot;
}

describe('L: the copper chests open as chests (mineflayer chest.js)', () => {
    test('COPPER_CHESTS of storage_logic.js: the 8 copper chests', () => {
        assert.equal(ST.COPPER_CHESTS.length, 8);
    });

    test('the patch file appends the 8 names of COPPER_CHESTS, with the prefix, to allowedWindowTypes', () => {
        const patch = read('patches/mineflayer+4.39.0.patch');
        const hunk = patch.slice(patch.indexOf('diff --git a/node_modules/mineflayer/lib/plugins/chest.js'));
        assert.ok(hunk.length < patch.length, 'a hunk for chest.js');
        const end = hunk.indexOf('\ndiff --git', 1);
        const added = (end > 0 ? hunk.slice(0, end) : hunk).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
        assert.match(added, /v0\.1\.4\.14/);
        assert.match(added, /allowedWindowTypes\.push\(/);
        assert.deepEqual(quotedNames(added), PREFIXED);
    });

    test('the patched chest.js holds them after the list of upstream', () => {
        const src = read('node_modules/mineflayer/lib/plugins/chest.js');
        const pushed = src.slice(src.indexOf('allowedWindowTypes.push('), src.indexOf('function matchWindowType'));
        assert.deepEqual(quotedNames(pushed), PREFIXED);
    });

    for (const name of ST.COPPER_CHESTS) {
        test(`openContainer opens a ${name} block; its generic_9x3 window passes matchWindowType`, async () => {
            const bot = chestBot();
            const window = await bot.openContainer(new Block(name));
            assert.deepEqual(window, { type: 'minecraft:generic_9x3' });
            assert.deepEqual(bot.opened, [name]);
        });
    }

    test('a double copper chest: generic_9x6 passes; a chest still opens; a crafting table is still refused', async () => {
        assert.deepEqual(await chestBot('minecraft:generic_9x6').openContainer(new Block('copper_chest')), { type: 'minecraft:generic_9x6' });
        assert.deepEqual(await chestBot().openContainer(new Block('chest')), { type: 'minecraft:generic_9x3' });
        await assert.rejects(chestBot().openContainer(new Block('crafting_table')), /neither a block nor an entity/);
        await assert.rejects(chestBot('minecraft:crafting').openContainer(new Block('copper_chest')), /Non-container window/);
    });
});
