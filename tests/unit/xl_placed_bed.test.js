// v0.1.4.14, fix round part 8 (P-20, SPEC 8.4 point 1, engineer E4): placedByBot covers every block the bot placed,
// beds included. The supervisor could not pick up the bed the bot had placed with !placeHere: the place call of a bed
// ends with a timeout of the block update although the bed stands, and only the foot (when at all) was noted.
// area_guard.js now notes the block after a failed call when it stands, and the other part of a bed or a door.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { vec } from '../helpers/block_world.js';

const PS = await loadSrc('src/agent/areas/placed_store.js');
const GUARD = await loadSrc('src/agent/areas/area_guard.js');

// A bot whose world holds the given blocks ({ 'x,y,z': { name, props } }); placeBlock puts the held item there
// (a bed: foot and head) and then resolves, or rejects like the timeout of the server's block update.
function fakeBot({ reject = false } = {}) {
    const blocks = new Map();
    const bot = {
        game: { dimension: 'overworld' },
        heldItem: { name: 'black_bed' },
        inventory: { slots: [] },
        blockAt: (p) => {
            const b = blocks.get(`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`);
            return b ? { name: b.name, position: vec(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), getProperties: () => ({ ...b.props }) }
                : { name: 'air', position: vec(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), getProperties: () => ({}) };
        },
        dig: () => Promise.resolve(),
        placeBlock: (ref, face) => {
            const t = ref.position.plus(face);
            const name = bot.heldItem.name;
            if (name.endsWith('_bed')) {
                blocks.set(`${t.x},${t.y},${t.z}`, { name, props: { facing: 'east', part: 'foot' } });
                blocks.set(`${t.x + 1},${t.y},${t.z}`, { name, props: { facing: 'east', part: 'head' } });
            } else if (name.endsWith('_door')) {
                blocks.set(`${t.x},${t.y},${t.z}`, { name, props: { half: 'lower' } });
                blocks.set(`${t.x},${t.y + 1},${t.z}`, { name, props: { half: 'upper' } });
            } else {
                blocks.set(`${t.x},${t.y},${t.z}`, { name, props: {} });
            }
            return reject ? Promise.reject(new Error('Event blockUpdate:(1, 64, 1) did not fire within timeout of 5000ms')) : Promise.resolve();
        },
        _placeBlockWithOptions: () => Promise.resolve(),
        activateBlock: () => Promise.resolve(),
        pathfinder: { setMovements() {}, getPathTo() {}, movements: { exclusionAreasBreak: [], exclusionAreasPlace: [] } },
        once() {},
    };
    return { bot, blocks };
}

describe('placedByBot covers the bot\'s beds (P-20)', () => {
    test('a bed placed: its foot and its head are the bot\'s', async () => {
        const store = new PS.PlacedStore(null);
        const { bot } = fakeBot();
        const guard = GUARD.installAreaGuard(bot, { placed: () => store, log() {} });
        await bot.placeBlock({ name: 'grass_block', position: vec(1, 63, 1) }, vec(0, 1, 0));
        assert.equal(guard.placedByBot(vec(1, 64, 1)), true, 'the foot');
        assert.equal(guard.placedByBot(vec(2, 64, 1)), true, 'the head');
        assert.equal(store.size, 2);
    });

    test('the place call times out although the bed stands: both halves are noted, the error stays', async () => {
        const store = new PS.PlacedStore(null);
        const { bot } = fakeBot({ reject: true });
        const guard = GUARD.installAreaGuard(bot, { placed: () => store, log() {} });
        await assert.rejects(bot.placeBlock({ name: 'grass_block', position: vec(1, 63, 1) }, vec(0, 1, 0)), /did not fire/);
        assert.equal(guard.placedByBot(vec(1, 64, 1)), true);
        assert.equal(guard.placedByBot(vec(2, 64, 1)), true);
    });

    test('a failed call that placed nothing notes nothing', async () => {
        const store = new PS.PlacedStore(null);
        const { bot } = fakeBot({ reject: true });
        bot.placeBlock = () => Promise.reject(new Error('No block has been placed'));
        GUARD.installAreaGuard(bot, { placed: () => store, log() {} });
        await assert.rejects(bot.placeBlock({ name: 'grass_block', position: vec(1, 63, 1) }, vec(0, 1, 0)));
        assert.equal(store.size, 0);
    });

    test('a bed whose foot alone was noted (the file of before): the head is the bot\'s too; a door\'s upper half', async () => {
        const store = new PS.PlacedStore(null);
        const { bot, blocks } = fakeBot();
        blocks.set('5,64,5', { name: 'black_bed', props: { facing: 'east', part: 'foot' } });
        blocks.set('6,64,5', { name: 'black_bed', props: { facing: 'east', part: 'head' } });
        store.add({ x: 5, y: 64, z: 5 });
        const guard = GUARD.installAreaGuard(bot, { placed: () => store, log() {} });
        assert.equal(guard.placedByBot(vec(6, 64, 5)), true);
        assert.equal(guard.placedByBot(vec(7, 64, 5)), false);
        bot.heldItem = { name: 'oak_door' };
        await bot.placeBlock({ name: 'grass_block', position: vec(9, 63, 9) }, vec(0, 1, 0));
        assert.equal(guard.placedByBot(vec(9, 65, 9)), true, 'the upper half');
    });
});
