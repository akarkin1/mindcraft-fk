// Spec v0.1.4.12, 4.4 (part B, engineer E4): the recorder. Staged blockUpdate events on a fake bot with fake players:
// a block that became air is `break`, a block that became non-air is `place`; credited to the watched player when that
// player is within 6 blocks of the block and is the nearest player, never the bot; the facing of a gate; at most 500
// entries, newest last; a new watchMe empties the record; the watching ends when the action is interrupted and says
// `I watched you: ...`; no listener or timer stays.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';

const R = await loadSrc('src/agent/packs/watch/recorder.js');
const W = await loadSrc('src/agent/packs/watch/index.js');

const block = (name, x, y, z, props = {}) => ({ name, position: new Vec3(x, y, z), getProperties: () => ({ ...props }) });

function fakeBot(players = {}) {
    const bot = new EventEmitter();
    bot.username = 'andy';
    bot.entity = { position: new Vec3(0, 64, 0) };
    bot.players = { andy: { username: 'andy', entity: bot.entity } };
    for (const [name, pos] of Object.entries(players)) bot.players[name] = { username: name, entity: { position: new Vec3(...pos), height: 1.8 } };
    bot.interrupt_code = false;
    bot.lookAt = async () => {};
    bot.blockAt = () => null;
    return bot;
}

describe('changeOf: what a block update is', () => {
    test('air to a block is a place, a block to air is a break; the name of the block', () => {
        assert.deepEqual(R.changeOf(block('air', 1, 64, 2), block('oak_planks', 1, 64, 2)), { kind: 'place', name: 'oak_planks', x: 1, y: 64, z: 2, props: {} });
        assert.deepEqual(R.changeOf(block('stone', 1, 40, 2), block('air', 1, 40, 2)), { kind: 'break', name: 'stone', x: 1, y: 40, z: 2, props: {} });
        assert.deepEqual(R.changeOf(block('stone', 1, 40, 2), block('cave_air', 1, 40, 2)).kind, 'break');
        assert.equal(R.changeOf(block('short_grass', 1, 64, 2), block('oak_fence', 1, 64, 2)).kind, 'place', 'placed into the grass');
        assert.equal(R.changeOf(null, block('dirt', 1, 64, 2)).kind, 'place', 'an old block not known');
    });

    test('the facing of a gate or a door, nothing else', () => {
        assert.deepEqual(R.changeOf(block('air', 0, 64, 0), block('oak_fence_gate', 0, 64, 0, { facing: 'east', open: false })).props, { facing: 'east' });
        assert.deepEqual(R.changeOf(block('air', 0, 64, 0), block('oak_door', 0, 64, 0, { facing: 'north', half: 'lower' })).props, { facing: 'north' });
        assert.deepEqual(R.changeOf(block('air', 0, 64, 0), block('oak_stairs', 0, 64, 0, { facing: 'north' })).props, {});
    });

    test('no change: the same block in another state, a block into another block, liquids, plants, leaves, the upper half', () => {
        assert.equal(R.changeOf(block('oak_fence', 0, 64, 0), block('oak_fence', 0, 64, 0, { east: true })), null);
        assert.equal(R.changeOf(block('grass_block', 0, 63, 0), block('dirt', 0, 63, 0)), null);
        assert.equal(R.changeOf(block('air', 0, 64, 0), block('water', 0, 64, 0)), null);
        assert.equal(R.changeOf(block('short_grass', 0, 64, 0), block('air', 0, 64, 0)), null);
        assert.equal(R.changeOf(block('oak_leaves', 0, 70, 0), block('air', 0, 70, 0)), null);
        assert.equal(R.changeOf(block('air', 0, 65, 0), block('oak_door', 0, 65, 0, { half: 'upper' })), null);
        assert.equal(R.changeOf(block('air', 0, 64, 0), null), null);
        assert.equal(R.changeOf(undefined, undefined), null);
    });
});

describe('creditedTo: the watched player, within 6 blocks, the nearest', () => {
    test('within 6 and the nearest: credited', () => {
        const bot = fakeBot({ steve: [2, 64, 0], alex: [20, 64, 0] });
        assert.equal(R.creditedTo(bot, 'steve', { x: 4, y: 64, z: 0 }), true);
    });

    test('farther than 6: not credited', () => {
        const bot = fakeBot({ steve: [2, 64, 0] });
        assert.equal(R.creditedTo(bot, 'steve', { x: 9, y: 64, z: 0 }), false);
    });

    test('another player nearer: not credited', () => {
        const bot = fakeBot({ steve: [0, 64, 0], alex: [4, 64, 0] });
        assert.equal(R.creditedTo(bot, 'steve', { x: 4, y: 64, z: 1 }), false);
        assert.equal(R.creditedTo(bot, 'alex', { x: 4, y: 64, z: 1 }), true);
    });

    test('the bot is never credited and never counts as the nearer player', () => {
        const bot = fakeBot({ steve: [4, 64, 0] });
        bot.entity.position = new Vec3(6, 64, 0);
        assert.equal(R.creditedTo(bot, 'andy', { x: 6, y: 64, z: 0 }), false);
        assert.equal(R.creditedTo(bot, 'steve', { x: 6, y: 64, z: 0 }), true);
    });

    test('a player without an entity (out of sight) is not credited', () => {
        const bot = fakeBot({});
        bot.players.steve = { username: 'steve', entity: null };
        assert.equal(R.creditedTo(bot, 'steve', { x: 0, y: 64, z: 0 }), false);
    });
});

describe('startRecorder: staged events', () => {
    test('the changes of the watched player, with the time, newest last; stop removes the listener', () => {
        const bot = fakeBot({ steve: [10, 64, 2], alex: [-20, 64, 0] });
        const record = R.createRecord();
        let t = 100;
        const stop = R.startRecorder(bot, 'steve', record, () => t++);
        for (let i = 0; i < 4; i++) bot.emit('blockUpdate', block('air', 10 + i, 64, 0), block('oak_planks', 10 + i, 64, 0));
        bot.emit('blockUpdate', block('air', -20, 64, 1), block('dirt', -20, 64, 1)); // alex
        bot.emit('blockUpdate', block('oak_planks', 11, 64, 0), block('oak_planks', 11, 64, 0, { waterlogged: false })); // no change
        bot.emit('blockUpdate', block('air', 30, 64, 0), block('stone', 30, 64, 0)); // nobody near
        assert.deepEqual(record.entries.map(e => [e.kind, e.name, e.x, e.t]), [['place', 'oak_planks', 10, 100], ['place', 'oak_planks', 11, 101],
            ['place', 'oak_planks', 12, 102], ['place', 'oak_planks', 13, 103]]);
        assert.deepEqual(record.counts(), { placed: 4, broken: 0 });
        assert.equal(bot.listenerCount('blockUpdate'), 1);
        stop();
        stop();
        assert.equal(bot.listenerCount('blockUpdate'), 0);
        bot.emit('blockUpdate', block('air', 12, 64, 1), block('stone', 12, 64, 1));
        assert.equal(record.entries.length, 4);
    });

    test('at most 500 entries, the oldest go first', () => {
        const record = R.createRecord();
        for (let i = 0; i < 510; i++) record.add({ kind: 'place', name: 'dirt', x: i, y: 64, z: 0, t: i });
        assert.equal(record.entries.length, 500);
        assert.equal(record.entries[0].x, 10);
        assert.equal(R.RECORD_MAX, 500);
        assert.equal(R.CREDIT_RANGE, 6);
    });
});

describe('watchMe: the watching as the action runs it', () => {
    function ctxFor(bot, follows) {
        const said = [];
        return {
            said,
            say: (text) => said.push(text),
            log: () => {},
            skills: {
                async followPlayer(b, name, distance) {
                    follows.push([name, distance]);
                    while (!b.interrupt_code) await new Promise((resolve) => setTimeout(resolve, 5));
                    return true;
                },
            },
        };
    }

    test('follows the player within 16 blocks, records until the interrupt, then `I watched you: ...`; nothing stays open', async () => {
        const bot = fakeBot({ steve: [10, 64, 2] });
        const follows = [];
        const ctx = ctxFor(bot, follows);
        const running = W.watchMe(bot, ctx, 'steve');
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(ctx.said, ['I watch you.']);
        assert.deepEqual(follows, [['steve', 16]]);
        for (let i = 0; i < 4; i++) bot.emit('blockUpdate', block('air', 10 + i, 64, 0), block('oak_planks', 10 + i, 64, 0));
        bot.emit('blockUpdate', block('stone', 9, 63, 0), block('air', 9, 63, 0));
        bot.interrupt_code = true; // the next order
        const result = await running;
        assert.deepEqual(result, { ok: true, reason: null, text: 'I watched you: 4 blocks placed, 1 broken.', placed: 4, broken: 1 });
        assert.equal(bot.listenerCount('blockUpdate'), 0, 'the recorder stopped');
        assert.equal(W.record(bot).length, 5, 'the record stays');
        assert.ok(Object.isFrozen(W.record(bot)));
        bot.emit('blockUpdate', block('air', 14, 64, 0), block('oak_planks', 14, 64, 0));
        assert.equal(W.record(bot).length, 5);
    });

    test('a new watchMe empties the record; without a name the nearest player; nobody: `I see no player to watch.`', async () => {
        const bot = fakeBot({ steve: [10, 64, 2] });
        const follows = [];
        const ctx = ctxFor(bot, follows);
        let running = W.watchMe(bot, ctx, 'steve');
        await new Promise((resolve) => setTimeout(resolve, 10));
        bot.emit('blockUpdate', block('air', 10, 64, 0), block('dirt', 10, 64, 0));
        bot.interrupt_code = true;
        await running;
        assert.equal(W.record(bot).length, 1);
        bot.interrupt_code = false;
        running = W.watchMe(bot, ctx, null);
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(W.record(bot).length, 0, 'emptied');
        assert.deepEqual(follows.at(-1), ['steve', 16]);
        bot.interrupt_code = true;
        assert.equal((await running).text, 'I watched you: 0 blocks placed, 0 broken.');
        const alone = fakeBot({});
        assert.deepEqual(await W.watchMe(alone, ctx, null), { ok: false, reason: 'no_player', text: 'I see no player to watch.' });
    });

    test('continueLike before any watching: `I have watched nothing yet. Say "watch me" first.`; buildWatched without a plan', async () => {
        const bot = fakeBot({});
        assert.deepEqual(await W.continueLike(bot, {}, '12 long'), { ok: false, reason: 'nothing_watched', text: 'I have watched nothing yet. Say "watch me" first.' });
        assert.deepEqual(await W.buildWatched(bot, {}), { ok: false, reason: 'no_plan', text: 'I have no plan. Say "continue like this" first.' });
        assert.equal(W.stopWatching(bot).reason, 'nothing_watched');
    });

    test('continueLike after a watching: the understood text, the pattern kept for buildWatched', async () => {
        const bot = fakeBot({ steve: [10, 64, 2] });
        bot.blockAt = (p) => ({ name: p.y > 63 ? 'air' : 'grass_block', position: p });
        bot.inventory = { items: () => [{ name: 'oak_planks', count: 20 }] };
        const ctx = ctxFor(bot, []);
        const running = W.watchMe(bot, ctx, 'steve');
        await new Promise((resolve) => setTimeout(resolve, 10));
        for (let i = 0; i < 4; i++) bot.emit('blockUpdate', block('air', 10 + i, 64, 0), block('oak_planks', 10 + i, 64, 0));
        bot.interrupt_code = true;
        await running;
        bot.interrupt_code = false;
        const r = await W.continueLike(bot, ctx, '12 long');
        assert.equal(r.text, 'I understood: a line of oak_planks 12 long from (10, 64, 0) eastwards; 8 oak_planks more, I carry 20. Say yes to build it.');
        assert.equal(r.ok, true);
        const none = await W.continueLike(bot, ctx, '');
        assert.equal(none.pattern.length, 16);
    });
});
