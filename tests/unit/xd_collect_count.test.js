// v0.1.4.14, the play of 2026-11-09 (DECISIONS P-20, SPEC 8.4.1): !collectBlocks("black_bed", 2) answered "I broke 2
// black_bed and got nothing." while the bed stood: mineflayer resolves a dig the server refused (the block is air for a
// moment, then the server puts it back), and collectedText counted the attempts.
//   1. The count is of the blocks that are gone: a block that came back after its dig is not broken; nothing broken and
//      nothing gained: `I broke 0 black_bed: the black_bed at (x, y, z) did not break.`
//   2. A block somebody else built, on an order nobody typed, is refused with `I do not break a black_bed that I did not
//      place; type the order yourself if you want it gone.`; an area's refusal keeps the guard's text; a block the bot
//      placed itself (the guard refuses nothing: placedByBot) is collected on any order.
// The fake bot of stb_fake_bot.test.js (real prismarine blocks), with an event emitter for the block updates.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeBot, registry } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

let skills;
let mcdata;
let W;
let workDir;
let originalCwd;
let cap;
before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir); // nothing may read a keys.json
    cap = captureConsole();
    try {
        mcdata = await loadSrc('src/utils/mcdata.js');
        skills = await loadSrc('src/agent/library/skills.js');
        W = await loadSrc('src/agent/library/way_logic.js');
    } finally {
        process.chdir(originalCwd);
    }
    mcdata.__setMcdataForTests(registry);
});
after(() => {
    mcdata.__setMcdataForTests?.(null);
    cap.restore();
    removeTmpDir(workDir);
});

const NOT_PLACED = 'I do not break a black_bed that I did not place; type the order yourself if you want it gone.';
const BROKE_NONE = 'I broke 0 black_bed: the black_bed at (3, 64, 0) did not break.';

// A black bed 3 blocks east of the bot. `comesBack`: the server refuses the dig and puts the bed back 40 ms after it was
// air (what mineflayer shows); `guard`: the area guard of the bot.
function bedScene({ comesBack = false, guard = null, block = 'black_bed' } = {}) {
    const world = createBlockWorld().flatGround(63);
    world.set(3, 64, 0, block);
    const bot = makeBot({ world });
    const ee = new EventEmitter();
    bot.on = ee.on.bind(ee);
    bot.removeListener = ee.removeListener.bind(ee);
    bot.emit = ee.emit.bind(ee);
    bot.dug = [];
    bot.dig = async (b) => {
        const p = b.position;
        bot.dug.push(`${p.x},${p.y},${p.z}`);
        const old = bot.blockAt(p);
        world.set(p.x, p.y, p.z, 'air');
        bot.emit('blockUpdate', old, bot.blockAt(p)); // mineflayer: the dug block is air at once
        if (comesBack) {
            setTimeout(() => {
                world.set(p.x, p.y, p.z, old.name);
                bot.emit('blockUpdate', { name: 'air', position: p }, bot.blockAt(p)); // the server's answer: the block is back
            }, 40);
        }
    };
    bot.collectBlock = { collect: async (b) => bot.dig(b) };
    if (guard) bot.areaGuard = guard;
    return { world, bot };
}

describe('P-20: the count is of the blocks that are gone', () => {
    test('the server keeps the bed: "I broke 0 black_bed: the black_bed at (3, 64, 0) did not break.", false', async () => {
        const { world, bot } = bedScene({ comesBack: true });
        assert.equal(await skills.collectBlock(bot, 'black_bed', 2), false);
        assert.ok(bot.output.endsWith(`${BROKE_NONE}\n`), bot.output);
        assert.doesNotMatch(bot.output, /I broke [12] black_bed/, bot.output);
        assert.equal(world.get(3, 64, 0), 'black_bed', 'the bed stands');
        assert.ok(bot.dug.length >= 1, 'the dig was tried');
    });

    test('the same with one asked: no "No more" line, the text alone', async () => {
        const { bot } = bedScene({ comesBack: true });
        assert.equal(await skills.collectBlock(bot, 'black_bed', 1), false);
        assert.equal(bot.output, `${BROKE_NONE}\n`);
    });

    test('a bed that breaks: counted as before ("I broke 1 black_bed and got nothing.")', async () => {
        const { world, bot } = bedScene();
        await skills.collectBlock(bot, 'black_bed', 1);
        assert.match(bot.output, /I broke 1 black_bed and got nothing\./);
        assert.equal(world.get(3, 64, 0), 'air');
    });

    test('two beds break and a third comes back: 2 counted, the one that stood named nowhere', async () => {
        const { world, bot } = bedScene();
        world.set(3, 64, 2, 'black_bed');
        world.set(3, 64, 4, 'black_bed');
        const dig = bot.dig;
        bot.dig = async (b) => {
            await dig(b);
            if (b.position.z === 4) {
                setTimeout(() => {
                    world.set(3, 64, 4, 'black_bed');
                    bot.emit('blockUpdate', { name: 'air', position: b.position }, bot.blockAt(b.position));
                }, 40);
            }
        };
        await skills.collectBlock(bot, 'black_bed', 3);
        assert.match(bot.output, /I broke 2 black_bed and got nothing\./, bot.output);
        assert.equal(world.get(3, 64, 4), 'black_bed');
    });

    test('the texts of way_logic.js, word for word', () => {
        assert.equal(W.notPlacedText('black_bed'), NOT_PLACED);
        assert.equal(W.brokeNoneText('black_bed', W.stoodReason('black_bed', { x: 3, y: 64, z: 0 })), BROKE_NONE);
        assert.equal(W.brokeNoneText('oak_fence', 'the server kept it.'), 'I broke 0 oak_fence: the server kept it.', 'one period');
    });
});

describe('P-20: who may break a built block', () => {
    test('a bed somebody else built, on an order nobody typed (the guard: built_block): the refusal, nothing dug', async () => {
        const guard = { refusal: () => ({ reason: 'built_block', area: null, text: 'black_bed is a block that players build with. I do not break it.' }),
            canBreak: () => false, placedByBot: () => false };
        const { world, bot } = bedScene({ guard });
        assert.equal(await skills.collectBlock(bot, 'black_bed', 1), false);
        assert.equal(bot.output, `${NOT_PLACED}\n`);
        assert.deepEqual(bot.dug, []);
        assert.equal(world.get(3, 64, 0), 'black_bed');
    });

    test('a bed in a saved area (the guard: area): the guard\'s text as before', async () => {
        const text = 'black_bed at (3, 64, 0) is in the area "home" (home). I do not break it.';
        const guard = { refusal: () => ({ reason: 'area', area: 'home', text }), canBreak: () => false, placedByBot: () => false };
        const { bot } = bedScene({ guard });
        assert.equal(await skills.collectBlock(bot, 'black_bed', 1), false);
        assert.ok(bot.output.endsWith(`${text}\n`), bot.output); // after the wider search of v0.1.4.8, as before
        assert.ok(!bot.output.includes('did not place'), bot.output);
    });

    test('a bed the bot placed itself (the guard refuses nothing): collected, typed or not', async () => {
        const guard = { refusal: () => null, canBreak: () => true, placedByBot: () => true };
        const { world, bot } = bedScene({ guard });
        await skills.collectBlock(bot, 'black_bed', 1);
        assert.deepEqual(bot.dug, ['3,64,0']);
        assert.equal(world.get(3, 64, 0), 'air');
        assert.match(bot.output, /I broke 1 black_bed and got nothing\./);
    });

    test('the signature of collectBlock stays', () => {
        assert.equal(skills.collectBlock.length, 2, 'bot, blockType (num and exclude have defaults)');
    });
});
