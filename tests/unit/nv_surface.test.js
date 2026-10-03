// Tester T1 of v0.1.4.11 "Navigation and words", from the spec W4: "Open sky" means no block above the bot up to the
// top of the world; elsewhere the skill walks to the nearest column with open sky within 16 blocks; no digging. On the
// fake bot of the skills (stb_fake_bot.test.js). The house and the mine are covered by part W's own tests.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');

let cap;
beforeEach(() => {
    mcdata.__setMcdataForTests(registry);
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    mcdata.__setMcdataForTests(null);
});

const feet = (bot) => [Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y + 0.01), Math.floor(bot.entity.position.z)];
const digs = (bot) => bot.calls.filter((c) => c[0] === 'dig').length;

describe('W4: open sky is no block above the bot up to the top of the world', () => {
    test('a single block far above the bot (y 300): not the open sky; the bot steps beside it, on the ground', async () => {
        const world = createBlockWorld().flatGround(63);
        world.set(0, 300, 0, 'stone');
        const bot = makeBot({ world, pos: [0.5, 64, 0.5] });
        const ok = await skills.goToSurface(bot);
        assert.ok(!bot.output.includes('I am under the open sky already.'), bot.output);
        assert.equal(ok, true, bot.output);
        const [x, y, z] = feet(bot);
        assert.equal(y, 64, 'on the ground');
        assert.ok(x !== 0 || z !== 0, `beside the column: ${feet(bot)}`);
        assert.equal(bot.output, `I climbed to the open sky at (${x}, 64, ${z}).\n`);
        assert.equal(digs(bot), 0);
    });

    test('leaves of a tree above the bot: not the open sky', async () => {
        const world = createBlockWorld().flatGround(63);
        for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.set(x, 70, z, 'oak_leaves');
        const bot = makeBot({ world, pos: [0.5, 64, 0.5] });
        await skills.goToSurface(bot);
        assert.ok(!bot.output.includes('already'), bot.output);
        const [x, y, z] = feet(bot);
        assert.equal(y, 64, 'on the ground, not on the leaves');
        assert.ok(Math.max(Math.abs(x), Math.abs(z)) >= 2, `out from under the leaves: ${feet(bot)}`);
    });

    test('nothing above: the open sky already, the bot does not move', async () => {
        const bot = makeBot();
        assert.equal(await skills.goToSurface(bot), true);
        assert.equal(bot.output, 'I am under the open sky already.\n');
        assert.deepEqual(feet(bot), [0, 64, 0]);
    });

    test('open sky 17 blocks away and none nearer: the text of no way (16 blocks), nothing dug', async () => {
        const world = createBlockWorld().flatGround(63);
        for (let x = -16; x <= 16; x++) for (let z = -16; z <= 16; z++) world.set(x, 80, z, 'stone');
        const bot = makeBot({ world, pos: [0.5, 64, 0.5] });
        assert.equal(await skills.goToSurface(bot), false);
        assert.equal(bot.output, 'I find no way to the open sky from (0, 64, 0).\n');
        assert.equal(digs(bot), 0);
    });
});
