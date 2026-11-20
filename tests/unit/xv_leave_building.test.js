// Spec v0.1.4.16, F4 (engineer E2): leaveBuilding(bot, ctx) of src/agent/packs/home/shelter.js on the home fake bot: a bot
// inside the house walks out through the door (passThrough outward, without digging) and the door is closed behind it;
// outside every building nothing moves; a house without a door cannot be left; a farm is no building. The farming pack
// calls it before the field through ctx.home (farming_actions has that case).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeWorld, makeFakeBot, buildHouse } from './home_fake_bot.test.js';

const S = await loadSrc('src/agent/packs/home/shelter.js');
const L = await loadSrc('src/agent/packs/home/shelter_logic.js');
const H = await loadSrc('src/agent/packs/home/index.js');

const FAST = { checkMs: 40 };
const isOpen = (world, x, y, z) => world.propsAt(x, y, z).open === true;

function scene({ botAt = [4.5, 64, 4.5], withDoor = true, areas = null } = {}) {
    const world = makeWorld();
    const area = buildHouse(world, { withDoor });
    const bot = makeFakeBot({ world, pos: botAt });
    const logs = [];
    const ctx = { areas: areas ?? [area], settings: {}, log: t => logs.push(t), now: () => Date.now() };
    return { world, area, bot, ctx, logs };
}

describe('leaveBuilding (F4)', () => {
    test('inside the house: out through the door, the door closed, the area named; the home pack exports it', async () => {
        const { world, area, bot, ctx, logs } = scene();
        assert.equal(L.isInsideArea(area, bot.entity.position), true);
        const res = await S.leaveBuilding(bot, ctx, FAST);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.area.name, 'home');
        assert.equal(res.reason, 'left');
        assert.equal(L.isInsideArea(area, bot.entity.position), false, 'the bot stands outside');
        assert.ok(bot.entity.position.z > 7, `beyond the south wall: ${bot.entity.position}`);
        assert.equal(isOpen(world, 4, 64, 7), false, 'the door is closed behind the bot');
        assert.ok(bot.calls.some(c => c[0] === 'activate'), 'the door was opened and closed, not dug');
        assert.equal(bot.calls.filter(c => c[0] === 'dig').length, 0, 'never digs');
        assert.ok(logs.some(l => /^I left "home" through the door at \(4, 64, 7\)\.$/.test(l)), logs.join(' | '));
        assert.equal(H.leaveBuilding, S.leaveBuilding, 'the home pack index exports it for the agent');
    });

    test('outside every building nothing moves; a farm around the bot is no building', async () => {
        const { bot, ctx } = scene({ botAt: [4.5, 64, 20.5] });
        const before = bot.entity.position.clone();
        assert.deepEqual(await S.leaveBuilding(bot, ctx, FAST), { ok: true, area: null, reason: 'outside', text: '' });
        assert.ok(bot.entity.position.equals(before));
        assert.equal(bot.calls.length, 0);
        const farm = { name: 'wheat_farm', type: 'farm', dimension: 'overworld', min: { x: 0, y: 63, z: 0 }, max: { x: 8, y: 69, z: 8 }, entrances: [{ x: 4, y: 64, z: 7, kind: 'gate' }] };
        const inFarm = scene({ areas: [farm] });
        assert.deepEqual(await S.leaveBuilding(inFarm.bot, inFarm.ctx, FAST), { ok: true, area: null, reason: 'outside', text: '' });
        assert.equal(inFarm.bot.calls.length, 0);
    });

    test('a house without a door: cannot be left, the text names the area; nothing throws without a bot', async () => {
        const { bot, ctx } = scene({ withDoor: false });
        const res = await S.leaveBuilding(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'no_entrance');
        assert.equal(res.area.name, 'home');
        assert.equal(res.text, 'I cannot get out of "home".');
        const none = await S.leaveBuilding(null, ctx, FAST);
        assert.equal(none.ok, true, 'no bot: no position, no building');
    });

    test('an interrupt on the way out', async () => {
        const { bot, ctx } = scene();
        bot.interrupt_code = true;
        const res = await S.leaveBuilding(bot, ctx, FAST);
        assert.equal(res.ok, false);
        assert.equal(res.reason, 'interrupted');
    });
});
