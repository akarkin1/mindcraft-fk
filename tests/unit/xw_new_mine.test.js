// E3, spec v0.1.4.16 F5 (the play of 2026-11-11: new_mine true walked to the old mine): on the surface tripStart answers
// `new` when newMine is true, before `use` of a known mine; mineOre then starts the new mine where the bot stands, says
// `I start a new mine here, as you said.` first, and never uses the known mine (not for the way down, not for the
// tunnel). Under the ground the rules of W3 and I4 stay (a new mine starts only from the surface; a known mine is used;
// a shaft from inside needs its setting): E3's decision, since "the surface above the bot" has no entrance the shaft
// rules allow in a known mine and the spec's underground flows (nm_player, nm_logic) would all change.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeMiningBot, makeClock, makeCtx, give } from './mining_fake_bot.test.js';

const L = await loadSrc('src/agent/packs/mining/mine_logic.js');
const M = await loadSrc('src/agent/packs/mining/mining.js');
const T = await loadSrc('src/agent/packs/mining/texts.js');

const MINE = { level: 16, entrance: { x: 20, y: 64, z: -14 } };

describe('F5: tripStart with newMine', () => {
    test('on the surface newMine comes first: new with a known mine', () => {
        assert.equal(L.tripStart({ mine: MINE, newMine: true }), 'new');
        assert.equal(L.tripStart({ mine: MINE, underground: false, newMine: true }), 'new');
        assert.equal(L.tripStart({ mine: null, newMine: true }), 'new');
        assert.equal(L.tripStart({ mine: null, underground: false, inMine: true, fromInside: true, newMine: true }), 'new');
    });

    test('under the ground the rules of W3 and I4 stay, newMine or not', () => {
        assert.equal(L.tripStart({ mine: MINE, underground: true, newMine: true }), 'use', 'a known mine is used from under the ground');
        assert.equal(L.tripStart({ mine: null, underground: true, newMine: true }), 'underground', 'a new mine starts only from the surface');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true, fromInside: true, newMine: true }), 'inside');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true, newMine: true }), 'in_mine');
    });

    test('without newMine everything is as before', () => {
        assert.equal(L.tripStart({ mine: MINE }), 'use');
        assert.equal(L.tripStart({ mine: MINE, underground: true }), 'use');
        assert.equal(L.tripStart({ mine: null, underground: true }), 'underground');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true, fromInside: true }), 'inside');
        assert.equal(L.tripStart({ mine: null, underground: true, inMine: true }), 'in_mine');
        assert.equal(L.tripStart({ mine: null }), 'ask');
        assert.equal(L.tripStart({ mine: null, newMine: false }), 'ask');
        assert.equal(L.tripStart(undefined), 'ask');
    });
});

async function scene({ world = makeWorld(), pos = [0.5, 64, 0.5] } = {}) {
    const bot = makeMiningBot({ world, pos });
    const clock = makeClock(bot);
    const ctx = await makeCtx(clock);
    const said = [];
    ctx.say = t => said.push(t);
    return { world, bot, clock, ctx, said, opts: { now: clock.now, wait: clock.wait } };
}

function kit(bot) {
    give(bot, 'iron_pickaxe', 1);
    give(bot, 'ladder', 64);
    give(bot, 'cobblestone', 64);
    give(bot, 'torch', 16);
    give(bot, 'bread', 8);
    give(bot, 'chest', 2);
}

describe('F5: mineOre with newMine and a known mine', () => {
    test('the text of the first line, word for word', () => {
        assert.equal(T.TEXTS.newMineHere, 'I start a new mine here, as you said.');
    });

    test('a known mine for coal 40 blocks away: the trip says the line first and digs a new mine at the bot\'s cell', async () => {
        const world = makeWorld();
        world.set(1, 56, -5, 'coal_ore').set(1, 57, -5, 'coal_ore').set(-1, 56, -8, 'coal_ore');
        const s = await scene({ world });
        kit(s.bot);
        s.ctx.storage = { async storeItems() { return { ok: true, reason: null, stored: {}, left: {}, text: 'I stored nothing.' }; } };
        const level = 56;
        const old = s.ctx.mines.set({
            ore: 'coal', entrance: { x: 40, y: 64, z: 40 }, level, base: { x: 40, y: level, z: 44 }, chest: null, direction: 'north', length: 4, shaft: 'ladder',
            dimension: 'overworld', end: { x: 40, y: level, z: 48 }, tunnel: [{ x: 40, y: level, z: 44 }, { x: 40, y: level, z: 48 }],
            route: [{ kind: 'ladder', x: 40, z: 40, top: 63, bottom: level, face: 'north', entry: { x: 40, y: 64, z: 41 } }],
        });
        assert.ok(old, 'the old mine is in the store');
        const r = await M.mineOre(s.bot, s.ctx, 'coal', 1, { ...s.opts, newMine: true });
        assert.equal(s.said[0], 'I start a new mine here, as you said.', s.said.join(' | '));
        assert.ok(r.mine, r.text);
        assert.deepEqual({ x: r.mine.entrance.x, z: r.mine.entrance.z }, { x: 0, z: 0 }, `the new mine is where the bot stood, not at the old one: ${JSON.stringify(r.mine.entrance)}`);
        assert.ok(s.ctx.logs.some(t => /^I start a mine at \(0, 64, 0\)/.test(t)), s.ctx.logs.join(' | '));
        assert.ok(!s.ctx.logs.some(t => /I go to the mine at \(40, 64, 40\)/.test(t)), 'the old mine was not walked to');
        assert.equal(s.ctx.mines.list('overworld').length, 2, 'two mines in the store now');
        assert.equal(r.ok, true, r.text);
    });

    test('without newMine the known mine is used, as before', async () => {
        const world = makeWorld();
        const s = await scene({ world });
        kit(s.bot);
        const level = 56;
        s.ctx.mines.set({
            ore: 'coal', entrance: { x: 0, y: 64, z: 0 }, level, base: { x: 0, y: level, z: 4 }, chest: null, direction: 'north', length: 4, shaft: 'ladder',
            dimension: 'overworld', end: { x: 0, y: level, z: 8 }, tunnel: [{ x: 0, y: level, z: 4 }, { x: 0, y: level, z: 8 }],
            route: [{ kind: 'ladder', x: 0, z: 0, top: 63, bottom: level, face: 'north', entry: { x: 0, y: 64, z: 1 } }],
        });
        assert.equal(L.tripStart({ mine: s.ctx.mines.get('coal', 'overworld'), newMine: false }), 'use');
        assert.ok(!s.said.includes('I start a new mine here, as you said.'));
    });
});
