// v0.1.4.14, the play of 2026-11-09 (DECISIONS P-26 and P-25, SPEC 8.4.3 and 8.4.2):
//   P-26 "Successfully killed sheep. Picked up 0 items." in 5 of 9 kills: after a kill the drops are taken from the stands
//        of pickupStands for up to 3 s after the death (a drop lands late); `Picked up N items.` counts what the bag gained.
//   P-25 the stack of a give flew into the water: before the toss, water or lava on the line from the bot to the player at
//        ground level, or within 2 blocks behind him, sends the bot to a side where the line is dry (up to 3 sides) to toss
//        from 1 block; none: `I could not give you N item: water all around you; come to dry ground.`
// The fake bot of tests/helpers/xt_bot.js; the server's pickup is a timer of the test.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { MC, makeFakeBot, makeItem, move } from '../helpers/xt_bot.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

const OWNER = 'MartyByrde2';
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

const toGoal = (m, goal) => ({ status: 'success', path: [move(goal.x, goal.y, goal.z)] });

// ------------------------------------------------------------------ P-26: the drops of a kill

// A sheep 3 blocks east; the attack kills it after 100 ms; `drops` appear at the death place `afterMs` later
// ({ id, name, count, at: [x, y, z], afterMs }). A timer plays the server: an item within the pickup box goes into the bag.
function killScene(drops = []) {
    const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
    const items = [];
    const sheep = { name: 'sheep', type: 'mob', position: { x: 3.5, y: 64, z: 0.5 }, height: 1.3 };
    const bot = makeFakeBot({ world, pos: { x: 0, y: 64, z: 0 }, items, entities: [sheep], paths: toGoal });
    const entity = Object.values(bot.entities)[0];
    bot.pvp = {
        attack(e) {
            setTimeout(() => {
                delete bot.entities[e.id];
                for (const d of drops) {
                    setTimeout(() => {
                        bot.entities[d.id] = { id: d.id, name: 'item', type: 'object', position: new Vec3(...d.at), getDroppedItem: () => ({ name: d.name, count: d.count }) };
                    }, d.afterMs);
                }
            }, 100);
        },
        stop() {},
    };
    const timer = setInterval(() => {
        for (const e of Object.values(bot.entities)) {
            if (e.name !== 'item') continue;
            const me = bot.entity.position;
            if (Math.abs(e.position.x - me.x) <= 1.3 && Math.abs(e.position.z - me.z) <= 1.3 && Math.abs(e.position.y - me.y) <= 1) {
                const it = e.getDroppedItem();
                delete bot.entities[e.id];
                items.push(makeItem(it.name, it.count, 36 + items.length));
            }
        }
    }, 30);
    return { bot, entity, items, stop: () => clearInterval(timer) };
}

describe('P-26: the drops of a kill from the stands of pickupStands, for up to 3 s', { timeout: 30000 }, () => {
    test('wool at the death, mutton 1.5 s later: both in the bag, "Picked up 3 items."', async () => {
        const { bot, entity, items, stop } = killScene([
            { id: 500, name: 'white_wool', count: 1, at: [3.6, 64, 0.4], afterMs: 0 },
            { id: 501, name: 'mutton', count: 2, at: [3.2, 64, 0.9], afterMs: 1500 },
        ]);
        try {
            const t0 = Date.now();
            assert.equal(await skills.attackEntity(bot, entity, true), true);
            const took = Date.now() - t0;
            assert.equal(bot.output, 'Successfully killed sheep.\nPicked up 3 items.\n');
            assert.deepEqual(items.map((i) => [i.name, i.count]).sort(), [['mutton', 2], ['white_wool', 1]]);
            assert.ok(!Object.values(bot.entities).some((e) => e.name === 'item'), 'nothing left on the ground');
            assert.ok(bot.calls.goals.some((g) => g?.constructor?.name === 'GoalBlock'), 'walked into a stand of pickupStands');
            assert.ok(took >= 3000 && took < 8000, `${took} ms: the window of 3 s after the death`);
        } finally {
            stop();
        }
    });

    test('no drop: "Picked up 0 items." after the window', async () => {
        const { bot, entity, stop } = killScene([]);
        try {
            await skills.attackEntity(bot, entity, true);
            assert.equal(bot.output, 'Successfully killed sheep.\nPicked up 0 items.\n');
        } finally {
            stop();
        }
    });

    test('a drop far from the death place (another mob\'s) is left', async () => {
        const { bot, entity, items, stop } = killScene([{ id: 502, name: 'mutton', count: 1, at: [12.5, 64, 0.5], afterMs: 0 }]);
        try {
            await skills.attackEntity(bot, entity, true);
            assert.equal(bot.output, 'Successfully killed sheep.\nPicked up 0 items.\n');
            assert.deepEqual(items, []);
            assert.ok(bot.entities[502], 'the far item lies');
        } finally {
            stop();
        }
    });

    test('the rules and the signature', () => {
        assert.deepEqual(W.KILL_DROP_RULES, { windowMs: 3000, range: 4 });
        assert.equal(skills.attackEntity.length, 2, 'bot, entity (kill has a default)');
    });
});

// ------------------------------------------------------------------ P-25: the give beside water

// The bot with `items`, the player 6 blocks east in the middle of the cell (6, 64, 0); `water`: cells of water. The player
// takes every toss at once. Walks: a GoalBlock (the side of the player, a stand) arrives; every other walk ends at (3, 64, 0),
// 3 blocks from the player (goToPlayer then says so, as in every give test).
function waterGiveBot(items, water = [], { takes = true } = {}) {
    const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
    for (const [x, y, z] of water) world.set(x, y, z, 'water');
    const player = { type: 'player', name: 'player', username: OWNER, position: { x: 6.5, y: 64, z: 0.5 }, height: 1.8 };
    const bot = makeFakeBot({ world, pos: { x: 0, y: 64, z: 0 }, items, entities: [player],
        paths: (m, goal) => (goal?.constructor?.name === 'GoalBlock' ? toGoal(m, goal)
            : { status: 'success', path: [move(1, 64, 0), move(2, 64, 0), move(3, 64, 0)] }) });
    const entity = Object.values(bot.entities)[0];
    bot.players[OWNER] = { username: OWNER, entity };
    const toss = bot.toss;
    bot.toss = async (type, metadata, count) => {
        await toss(type, metadata, count);
        if (takes) bot.emit('playerCollect', { username: OWNER }, { name: 'item', getDroppedItem: () => ({ name: MC.items[type]?.name, count }) });
    };
    return bot;
}
const sideWalks = (bot) => bot.calls.goals.filter((g) => g?.constructor?.name === 'GoalBlock').map((g) => [g.x, g.y, g.z]);

describe('P-25: the give beside water', () => {
    test('water on the line to the player: the bot walks to a dry side of him and tosses from 1 block', async () => {
        const bot = waterGiveBot([makeItem('oak_log', 3, 36)], [[4, 63, 0], [5, 63, 0]]);
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 3), true);
        assert.deepEqual(sideWalks(bot), [[6, 64, -1]], 'the north side, nearest of the dry ones');
        assert.deepEqual(bot.calls.tossed, [{ name: 'oak_log', count: 3 }]);
        assert.ok(bot.output.endsWith('I gave you 3 oak_log.\n'), bot.output);
    });

    test('water within 2 blocks behind the player: a side too', async () => {
        const bot = waterGiveBot([makeItem('oak_log', 2, 36)], [[7, 63, -1], [8, 63, -1], [7, 63, 0], [8, 63, 0]]);
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 2), true);
        assert.equal(sideWalks(bot).length, 1, 'one side walked');
        assert.deepEqual(bot.calls.tossed, [{ name: 'oak_log', count: 2 }]);
    });

    test('water all around the player: no toss, "I could not give you 3 oak_log: water all around you; come to dry ground.", false', async () => {
        const ring = [];
        for (let x = 2; x <= 10; x++) for (let z = -4; z <= 4; z++) if (!(x === 6 && z === 0)) ring.push([x, 63, z]);
        const bot = waterGiveBot([makeItem('oak_log', 3, 36)], ring);
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 3), false);
        assert.ok(bot.output.endsWith('I could not give you 3 oak_log: water all around you; come to dry ground.\n'), bot.output);
        assert.ok(!bot.output.includes('picked up none'), bot.output);
        assert.deepEqual(bot.calls.tossed, []);
        assert.equal(bot.listenerCount('playerCollect'), 0, 'no listener left');
    });

    test('a dry line: no side walk, the toss as before', async () => {
        const bot = waterGiveBot([makeItem('oak_log', 3, 36)], [[6, 63, 5]]);
        assert.equal(await skills.giveToPlayer(bot, 'oak_log', OWNER, 3), true);
        assert.deepEqual(sideWalks(bot), []);
        assert.ok(bot.output.endsWith('I gave you 3 oak_log.\n'), bot.output);
    });

    test('the rules of way_logic.js: wetLine, drySides, the text', () => {
        const blocks = new Map([['4,63,0', 'water'], ['9,63,0', 'lava'], ['6,64,1', 'kelp'], ['6,62,2', 'stone']]);
        const read = (x, y, z) => blocks.get(`${x},${y},${z}`) ?? (y <= 63 ? 'grass_block' : 'air');
        const player = { x: 6.5, y: 64, z: 0.5 };
        assert.equal(W.wetLine(read, { x: 1.5, y: 64, z: 0.5 }, player), true, 'water under the line');
        assert.equal(W.wetLine(read, { x: 5.5, y: 64, z: 0.5 }, player), false, 'from the west, 2 behind is x 8: dry');
        assert.equal(W.wetLine(read, { x: 4.5, y: 64, z: 0.5 }, player), true, 'the bot stands on the water cell');
        assert.equal(W.wetLine(read, { x: 3.5, y: 64, z: 0.5 }, player, 0), true);
        assert.equal(W.wetLine(read, { x: 5.5, y: 64, z: 0.5 }, player, 3), true, 'lava 3 behind with behind 3');
        assert.equal(W.wetLine(read, { x: 6.5, y: 64, z: -2.5 }, player), true, 'kelp at the feet level 1 behind');
        assert.equal(W.wetLine(null, player, player), false);
        // the sides: west (5, 64, 0) is dry; east (7, 64, 0) looks 2 behind the player, to x 4: water; south (6, 64, 1) stands
        // in kelp: no; north (6, 64, -1) looks past the player at (6, 64, 1): kelp, wet
        assert.deepEqual(W.drySides(read, player, { x: 1.5, y: 64, z: 0.5 }), [{ x: 5, y: 64, z: 0 }]);
        assert.deepEqual(W.drySides(read, player, { x: 5.5, y: 64, z: 0.5 }), [], 'the side the bot stands on is left out');
        const dry = (x, y, z) => (y <= 63 ? 'grass_block' : 'air');
        assert.deepEqual(W.drySides(dry, player, { x: 1.5, y: 64, z: 0.5 }), [{ x: 5, y: 64, z: 0 }, { x: 6, y: 64, z: -1 }, { x: 6, y: 64, z: 1 }], 'at most 3, nearest first');
        assert.equal(W.drySides(read, null).length, 0);
        assert.equal(W.wetGiveText(1, 'black_bed'), 'I could not give you 1 black_bed: water all around you; come to dry ground.');
        assert.deepEqual(W.GIVE_WATER_RULES, { behind: 2, sides: 3, tossFrom: 1 });
        assert.equal(skills.giveToPlayer.length, 3, 'the signature stays');
    });
});
