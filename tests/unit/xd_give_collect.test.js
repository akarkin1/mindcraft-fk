// v0.1.4.14, the owner's first play on a 26.1 world (2026-11-07):
//   1. !givePlayer gives what is asked, as many as the bot has, a stack at a time, and says the count
//      (`I gave you 97 oak_log.`); the kit rule of v0.1.4.13 is a hint after the give (more than 3 kinds within a
//      minute and a chest within 16 blocks), never a refusal; a give that gave nothing says so plainly.
//   2. !collectBlocks("chest") collects a container the bot placed itself when it is empty; one that holds items is
//      left with `The chest at (x, y, z) holds N things; say "empty the chest" first.`; one the bot did not place is
//      never broken (`I do not break a chest that is not mine.`); a block the path search keeps safe is named.
// The fake bots of the skills tests: tests/helpers/xt_bot.js for the give, stb_fake_bot.test.js for the collect.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { MC, makeFakeBot, makeItem, move } from '../helpers/xt_bot.js';
import { makeBot } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

const OWNER = 'MartyByrde2';
const HINT = 'If you want it all, say "put my stuff in the chest".';
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
    mcdata.__setMcdataForTests(MC);
});
after(() => {
    mcdata.__setMcdataForTests?.(null);
    cap.restore();
    removeTmpDir(workDir);
});

// ------------------------------------------------------------------ 1. the give

// The bot with `items`, the player 6 blocks east; with `takes` the player picks up every toss at once.
function giveBot(items, { takes = true, chest = false } = {}) {
    const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
    if (chest) world.set(3, 64, 3, 'chest');
    const player = { type: 'player', name: 'player', username: OWNER, position: { x: 6, y: 64, z: 0 }, height: 1.8 };
    const bot = makeFakeBot({ world, pos: { x: 0, y: 64, z: 0 }, items, entities: [player],
        paths: () => ({ status: 'success', path: [move(1, 64, 0), move(2, 64, 0), move(3, 64, 0)] }) });
    const entity = Object.values(bot.entities)[0];
    bot.players[OWNER] = { username: OWNER, entity };
    const toss = bot.toss;
    bot.toss = async (type, metadata, count) => {
        await toss(type, metadata, count);
        if (takes) {
            const name = MC.items[type]?.name;
            bot.emit('playerCollect', { username: OWNER }, { name: 'item', getDroppedItem: () => ({ name, count }) });
        }
    };
    return bot;
}

describe('!givePlayer gives what is asked (v0.1.4.14)', () => {
    test('97 oak_log asked: two stacks thrown, 64 and 33; "I gave you 97 oak_log.", true', async () => {
        const bot = giveBot([makeItem('oak_log', 64, 36), makeItem('oak_log', 33, 37)]);
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 97), true);
        assert.deepEqual(bot.calls.tossed, [{ name: 'oak_log', count: 64 }, { name: 'oak_log', count: 33 }]);
        assert.ok(bot.output.endsWith('I gave you 97 oak_log.\n'), bot.output);
        assert.ok(!bot.output.includes('That is a lot'), bot.output);
        assert.equal(bot.listenerCount('playerCollect'), 0, 'no listener left');
    });

    test('more asked than the bot has: it gives all it has', async () => {
        const bot = giveBot([makeItem('oak_log', 50, 36)]);
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 94), true);
        assert.deepEqual(bot.calls.tossed, [{ name: 'oak_log', count: 50 }]);
        assert.ok(bot.output.endsWith('I gave you 50 oak_log.\n'), bot.output);
    });

    test('none in the bag: the failure plainly, nothing thrown, false', async () => {
        const bot = giveBot([makeItem('bread', 3, 36)]);
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 5), false);
        assert.equal(bot.output, 'I could not give you oak_log: I have no oak_log.\n');
        assert.deepEqual(bot.calls.tossed, []);
    });

    test('the player out of sight: the failure plainly, false', async () => {
        const bot = giveBot([makeItem('oak_log', 5, 36)]);
        delete bot.players[OWNER];
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 5), false);
        assert.equal(bot.output, `I could not give you oak_log: I cannot find ${OWNER}.\n`);
    });

    test('nobody picks it up: "I could not give you ...", false', async () => {
        const bot = giveBot([makeItem('oak_log', 5, 36)], { takes: false });
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 5), false);
        assert.match(bot.output, /I could not give you 5 oak_log: MartyByrde2 picked up none; 5 lie on the ground at \(/);
    });

    // W122 (a stack beyond the player on a slope, 5 of 15 runs): the player picks up nothing of the first toss; the bot
    // walks to its stack, gets it back and tosses it once more from 1 block
    test('the first toss is not taken: the bot picks its stack up again and tosses it once more; "I gave you 5 oak_log."', async () => {
        const items = [makeItem('oak_log', 5, 36)];
        const bot = giveBot(items, { takes: false });
        let tosses = 0;
        const toss = bot.toss;
        bot.toss = async (type, metadata, count) => {
            await toss(type, metadata, count);
            tosses++;
            if (tosses === 1) {
                bot.entities[900] = { id: 900, name: 'item', type: 'object', position: new Vec3(3.2, 64, 2.1), getDroppedItem: () => ({ name: 'oak_log', count }) };
            } else {
                bot.emit('playerCollect', { username: OWNER }, { name: 'item', getDroppedItem: () => ({ name: 'oak_log', count }) });
            }
        };
        const goto = bot.pathfinder.goto;
        bot.pathfinder.goto = async (goal) => {
            await goto(goal);
            // the walk into a stand of pickupStands next to the stack: the server hands it back
            if (bot.entities[900] && goal?.constructor?.name === 'GoalBlock' && Math.abs(goal.x + 0.5 - 3.2) <= 1.3 && Math.abs(goal.z + 0.5 - 2.1) <= 1.3) {
                delete bot.entities[900];
                items[0].count += 5;
            }
        };
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 5), true);
        assert.deepEqual(bot.calls.tossed, [{ name: 'oak_log', count: 5 }, { name: 'oak_log', count: 5 }], 'tossed twice');
        assert.ok(bot.calls.goals.some((g) => g?.constructor?.name === 'GoalBlock' && Math.abs(g.x - 3) <= 1 && Math.abs(g.z - 2) <= 1), 'walked into a stand by the stack');
        assert.ok(bot.output.endsWith('I gave you 5 oak_log.\n'), bot.output);
    });

    test('the toss is aimed at the player\'s feet', async () => {
        const bot = giveBot([makeItem('oak_log', 2, 36)]);
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 2), true);
        assert.deepEqual({ x: bot.lookingAt.x, y: bot.lookingAt.y, z: bot.lookingAt.z }, { x: 6, y: 64, z: 0 }, 'the cell of the feet, not of the eyes');
    });

    test('the 4th kind within a minute with a chest within 16 blocks: the give, then the hint', async () => {
        const kinds = ['bread', 'apple', 'torch', 'oak_log'];
        const bot = giveBot(kinds.map((k, i) => makeItem(k, 2, 36 + i)), { chest: true });
        for (const k of kinds.slice(0, 3)) {
            bot.output = '';
            assert.equal(await skills.giveToPlayer(bot, k, OWNER, 2), true);
            assert.ok(!bot.output.includes(HINT), `${k}: no hint within 3 kinds`);
        }
        bot.output = '';
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 2), true);
        assert.ok(bot.output.endsWith(`I gave you 2 oak_log. ${HINT}\n`), bot.output);
        assert.equal(bot.calls.tossed.length, 4, 'all four were thrown');
    });

    test('4 kinds without a chest near: no hint', async () => {
        const kinds = ['bread', 'apple', 'torch', 'oak_log'];
        const bot = giveBot(kinds.map((k, i) => makeItem(k, 2, 36 + i)));
        for (const k of kinds) await skills.giveToPlayer(bot, k, OWNER, 2);
        assert.ok(!bot.output.includes(HINT), bot.output);
    });

    test('the texts and the hint rule of way_logic.js', () => {
        assert.equal(W.giveFailedText('oak_log', 'I have no oak_log'), 'I could not give you oak_log: I have no oak_log.');
        assert.equal(W.givenNoneText(OWNER, 1, 'apple', { x: 1.5, y: 64, z: -2.2 }), `I could not give you 1 apple: ${OWNER} picked up none; 1 lies on the ground at (1, 64, -3).`);
        assert.equal(W.KIT_HINT, HINT);
        assert.equal(W.wantsKitHint(4, true), true);
        assert.equal(W.wantsKitHint(4, false), false);
        assert.equal(W.wantsKitHint(1, true), false);
        assert.equal(skills.giveToPlayer.length, 3, 'the signature stays');
    });
});

// ------------------------------------------------------------------ 2. the bot's own chest

// A chest 3 blocks east of the bot on the grass; `placed`: the guard knows the bot placed it; `holds`: the items in it.
function chestScene({ placed = true, holds = [], guard = true, name = 'chest' } = {}) {
    const world = createBlockWorld().flatGround(63);
    world.set(3, 64, 0, name);
    const bot = makeBot({ world });
    bot.dug = [];
    bot.opened = 0;
    bot.dig = async (block) => { bot.dug.push(`${block.position.x},${block.position.y},${block.position.z}`); world.set(block.position.x, block.position.y, block.position.z, 'air'); };
    bot.openContainer = async () => { bot.opened++; return { containerItems: () => holds, close() {} }; };
    if (guard) bot.areaGuard = { placedByBot: (p) => placed && p.x === 3 && p.y === 64 && p.z === 0, canBreak: () => true };
    return { world, bot };
}

describe('!collectBlocks("chest") and the bot\'s own chest (v0.1.4.14)', () => {
    test('an empty chest the bot placed: looked into, then broken', async () => {
        const { world, bot } = chestScene();
        await skills.collectBlock(bot, 'chest', 1);
        assert.equal(bot.opened, 1, 'looked into first');
        assert.deepEqual(bot.dug, ['3,64,0']);
        assert.equal(world.get(3, 64, 0), 'air');
        assert.ok(!bot.output.includes('No chest nearby'), bot.output);
    });

    // W122 ("I broke 1 chest and got nothing", 4 of 15 runs): the chest item rolled a block off under a leaf at head
    // height; the bot walks into a stand of pickupStands and breaks the leaf (no protected area within 8 blocks)
    function rolledUnderLeaves(areaNear) {
        const s = chestScene();
        for (let x = 3; x <= 5; x++) for (let z = -1; z <= 1; z++) s.world.set(x, 65, z, 'oak_leaves');
        s.bot.areaGuard.areaAt = (p) => (areaNear && Math.abs(p.x - 12) <= 4 && Math.abs(p.z) <= 4 ? { name: 'home', type: 'home' } : null);
        s.bot.areaGuard.refusal = () => null;
        const dig = s.bot.dig;
        let broke = false;
        s.bot.dig = async (block) => {
            await dig(block);
            if (block.position.x === 3 && block.position.y === 64 && !broke) { // the chest: its item rolls to (4.5, 64, 0.5)
                broke = true;
                s.bot.entities[50] = { id: 50, name: 'item', type: 'object', position: new Vec3(4.5, 64, 0.5), getDroppedItem: () => ({ name: 'chest', count: 1 }) };
            }
        };
        // the server hands the item over to a bot within its range whose head is free (a leaf there is dug first)
        s.check = () => {
            const p = s.bot.entity.position;
            if (s.bot.entities[50] && Math.abs(p.x - 4.5) <= 1.3 && Math.abs(p.z - 0.5) <= 1.3
                && s.world.get(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z)) === 'air') {
                delete s.bot.entities[50];
                s.bot.inventory.add('chest', 1);
            }
        };
        s.bot.gotoImpl = (goal) => {
            if (Number.isFinite(goal?.x)) s.bot.entity.position = new Vec3(goal.x + 0.5, goal.y ?? 64, goal.z + 0.5);
            s.check();
        };
        const digAgain = s.bot.dig;
        s.bot.dig = async (block) => { await digAgain(block); s.check(); };
        return s;
    }

    test('the chest\'s item rolled under a leaf: picked up from a stand, the leaf at head height broken', async () => {
        const { bot } = rolledUnderLeaves(false);
        await skills.collectBlock(bot, 'chest', 1);
        assert.ok(bot.dug.includes('3,64,0'), 'the chest broken');
        assert.equal(bot.dug.filter((k) => k.split(',')[1] === '65').length, 1, `one leaf broken: ${JSON.stringify(bot.dug)}`);
        assert.equal(bot.inventory.items().filter((i) => i.name === 'chest').reduce((n, i) => n + i.count, 0), 1, bot.output);
        assert.ok(!/got nothing/.test(bot.output), bot.output);
    });

    test('a protected area within 8 blocks of the leaf: no leaf is broken', async () => {
        const { bot } = rolledUnderLeaves(true);
        await skills.collectBlock(bot, 'chest', 1);
        assert.deepEqual(bot.dug.filter((k) => k.split(',')[1] === '65'), [], 'no leaf broken');
    });

    test('its own chest that holds items: not broken, the text, false', async () => {
        const { bot } = chestScene({ holds: [{ name: 'oak_log', count: 5 }, { name: 'bread', count: 3 }] });
        assert.equal(await skills.collectBlock(bot, 'chest', 1), false);
        assert.deepEqual(bot.dug, []);
        assert.ok(bot.output.endsWith('The chest at (3, 64, 0) holds 8 things; say "empty the chest" first.\n'), bot.output);
    });

    test('a chest the bot did not place: never broken, never opened', async () => {
        const { bot } = chestScene({ placed: false });
        assert.equal(await skills.collectBlock(bot, 'chest', 1), false);
        assert.deepEqual(bot.dug, []);
        assert.equal(bot.opened, 0);
        assert.equal(bot.output, 'I do not break a chest that is not mine.\n');
    });

    test('without the guard of protected areas the bot knows no chest of its own: never broken', async () => {
        const { bot } = chestScene({ guard: false });
        assert.equal(await skills.collectBlock(bot, 'chest', 1), false);
        assert.deepEqual(bot.dug, []);
        assert.equal(bot.output, 'I do not break a chest that is not mine.\n');
    });

    test('a copper chest of its own, empty: broken', async () => {
        const { bot } = chestScene({ name: 'weathered_copper_chest' });
        await skills.collectBlock(bot, 'weathered_copper_chest', 1);
        assert.deepEqual(bot.dug, ['3,64,0']);
    });

    test('a block the path search keeps safe: named with the reason, not "No ... nearby"', async () => {
        const world = createBlockWorld().flatGround(63);
        world.set(3, 64, 0, 'sand');
        world.set(3, 64, 1, 'water');
        const bot = makeBot({ world });
        assert.equal(await skills.collectBlock(bot, 'sand', 1), false);
        assert.equal(bot.output, 'I do not break the sand at (3, 64, 0): water or lava would flow in.\n');
    });

    test('the texts of way_logic.js, word for word', () => {
        assert.equal(W.notMineText('chest'), 'I do not break a chest that is not mine.');
        assert.equal(W.notMineText('barrel'), 'I do not break a barrel that is not mine.');
        assert.equal(W.containerFullText('chest', new Vec3(-377, 78, -462), 97), 'The chest at (-377, 78, -462) holds 97 things; say "empty the chest" first.');
        assert.equal(W.unsafeBlockText('chest', { x: 1, y: 2, z: 3 }, 'never'), 'I do not break the chest at (1, 2, 3): it is on the list of blocks I never break.');
        for (const name of ['chest', 'trapped_chest', 'barrel', 'copper_chest', 'waxed_oxidized_copper_chest']) assert.ok(W.isContainerName(name), name);
        assert.ok(!W.isContainerName('oak_shelf') && !W.isContainerName('ender_chest'));
    });
});
