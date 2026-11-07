// v0.1.4.14 (round 3, W101 on the real server): the explosion event of the watch server on 26.1. The packet `explosion`
// of 26.1 carries its position in `center`, the one of 1.21.8 had x, y, z at the top level; explosionEvent of
// events_logic.js takes both, so both give the same event.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';

const E = await loadSrc('src/agent/watch/events_logic.js');

// the field names of a container type of protodef: ['container', [{ name, type }, ...]]
function fieldsOf(version) {
    const type = minecraftData(version).protocol.play.toClient.types.packet_explosion;
    assert.equal(type[0], 'container', `${version}: packet_explosion is a container`);
    return type[1].map((f) => f.name);
}

const AREAS = [{ name: 'farm', type: 'farm', dimension: 'overworld', min: { x: 0, y: 60, z: 0 }, max: { x: 10, y: 70, z: 10 } }];

describe('the packet explosion of 26.1 and of 1.21.8', () => {
    test('the shapes of the registries: `center` in 26.1, `x`, `y`, `z` in 1.21.8', () => {
        const new26 = fieldsOf('26.1');
        const old = fieldsOf('1.21.8');
        assert.ok(new26.includes('center') && !new26.includes('x'), new26.join(', '));
        assert.ok(old.includes('x') && old.includes('y') && old.includes('z') && !old.includes('center'), old.join(', '));
    });

    test('the same event, text and blocks, from either shape', () => {
        const at = { x: 15.5, y: 64, z: 5.25 };
        const p26 = { center: at, radius: 3, blockCount: 0, playerKnockback: null, explosionParticle: {}, sound: {}, blockParticles: [] };
        const p1218 = { ...at, playerKnockback: null, explosionParticle: {}, sound: {} };
        const a = E.explosionEvent(p26, AREAS, 'overworld', 1000);
        const b = E.explosionEvent(p1218, AREAS, 'overworld', 1000);
        assert.ok(a, 'the 26.1 packet gives an event');
        assert.deepEqual(a, b);
        assert.equal(a.text, 'Explosion 5 blocks from the area "farm" at (15, 64, 5).');
        assert.equal(a.data.blocks, 5);
        assert.deepEqual(a.data.pos, { x: 15, y: 64, z: 5 });
    });

    test('explosionCenter: center first, the top level else, null for anything else', () => {
        assert.deepEqual(E.explosionCenter({ center: { x: 1, y: 2, z: 3 }, x: 9, y: 9, z: 9 }), { x: 1, y: 2, z: 3 });
        assert.deepEqual(E.explosionCenter({ x: 1, y: 2, z: 3 }), { x: 1, y: 2, z: 3 });
        for (const bad of [null, undefined, {}, { center: {} }, { center: { x: 1 } }, 'x'])
            assert.equal(E.explosionCenter(bad), null);
        assert.equal(E.explosionEvent({ center: { x: 100, y: 64, z: 100 } }, AREAS, 'overworld'), null, 'far from every area');
        assert.equal(E.explosionEvent({ radius: 3 }, AREAS, 'overworld'), null, 'no position');
    });
});
