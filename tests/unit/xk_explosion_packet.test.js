// Spec v0.1.4.13, 4.3 (part K, engineer E2): the cause of F10 of v0.1.4.12, the creeper loop that ran until the heap
// was gone. The 1.21.8 server writes the player knockback of an explosion as three doubles (FriendlyByteBuf.writeVec3);
// minecraft-data 3.98.0 read it as three floats (vec3f). The second float was the low mantissa word of the x double, now
// and then a number like 5.2e14, which mineflayer added to the velocity of the bot; the next physics tick then walked a
// bounding box 5.2e14 blocks high, block by block, in one synchronous call, until the heap was gone. The correction is
// the one of minecraft-data 3.117.0 (vec3f64), applied to the pinned 3.98.0 through patches/minecraft-data+3.98.0.patch.
//   - the definition of the packet says vec3f64 (the patch is applied);
//   - a packet as the server writes it is read whole, with the knockback's doubles exact; without knockback too;
//   - the velocity mineflayer adds from such a packet is finite and small.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { repoUrl } from '../helpers/paths.js';

const require = createRequire(repoUrl('package.json'));
const mcData = require('minecraft-data')('1.21.8');
const { createDeserializer } = require('minecraft-protocol/src/transforms/serializer');

const KNOCK = { x: -0.5305555555555556, y: 0.1234567890123, z: 1.3999999999 };

// The bytes of an explosion packet of the 1.21.8 server: the packet id, the centre (3 doubles), the optional knockback
// (a boolean, then 3 doubles), the particle (a varint id, minecraft:explosion carries no data), the sound (a registry id + 1).
function explosionPacket(knockback) {
    const bytes = [];
    const varint = (n) => { while (n >= 0x80) { bytes.push((n & 0x7f) | 0x80); n >>>= 7; } bytes.push(n); };
    const double = (v) => { const b = Buffer.alloc(8); b.writeDoubleBE(v); bytes.push(...b); };
    const packetIds = mcData.protocol.play.toClient.types.packet[1][0].type[1].mappings;
    varint(Number(Object.entries(packetIds).find(([, name]) => name === 'explosion')[0]));
    double(422.5); double(25); double(2.5);
    if (knockback) {
        bytes.push(1);
        double(knockback.x); double(knockback.y); double(knockback.z);
    } else {
        bytes.push(0);
    }
    varint(mcData.particlesByName.explosion.id);
    varint(1);
    return Buffer.from(bytes);
}

describe('K: the player knockback of the explosion packet is three doubles', () => {
    test('the definition of minecraft-data for 1.21.8 says vec3f64 (patches/minecraft-data+3.98.0.patch)', () => {
        const field = mcData.protocol.play.toClient.types.packet_explosion[1].find((f) => f.name === 'playerKnockback');
        assert.deepEqual(field.type, ['option', 'vec3f64']);
        assert.deepEqual(mcData.protocol.types.vec3f64[1].map((f) => f.type), ['f64', 'f64', 'f64']);
    });

    test('a packet as the server writes it is read whole, the knockback exact', () => {
        const parser = createDeserializer({ state: 'play', isServer: false, version: '1.21.8', noErrorLogging: true });
        const bytes = explosionPacket(KNOCK);
        const packet = parser.parsePacketBuffer(bytes);
        assert.equal(packet.data.name, 'explosion');
        assert.deepEqual(packet.data.params.playerKnockback, KNOCK, 'the three doubles, bit for bit');
        assert.deepEqual({ x: packet.data.params.x, y: packet.data.params.y, z: packet.data.params.z }, { x: 422.5, y: 25, z: 2.5 });
        assert.equal(packet.data.params.explosionParticle.type, 'explosion', 'the particle after the knockback is the right one');
        assert.equal(packet.metadata.size, bytes.length, 'every byte of the packet is read');
    });

    test('a packet without knockback: undefined, read whole', () => {
        const parser = createDeserializer({ state: 'play', isServer: false, version: '1.21.8', noErrorLogging: true });
        const bytes = explosionPacket(null);
        const packet = parser.parsePacketBuffer(bytes);
        assert.equal(packet.data.params.playerKnockback, undefined);
        assert.equal(packet.data.params.explosionParticle.type, 'explosion');
        assert.equal(packet.metadata.size, bytes.length);
    });

    test('the velocity mineflayer adds from such a packet is finite and within what an explosion gives', () => {
        const parser = createDeserializer({ state: 'play', isServer: false, version: '1.21.8', noErrorLogging: true });
        // the knockback values of play are a few blocks per tick at most; the mantissa bits of these are the kind that
        // read as a huge float
        for (const knock of [KNOCK, { x: -1.2345678912345, y: 0.4123456789, z: -0.08 }, { x: 3.999999999999, y: -3.5, z: 2.0000000001 }]) {
            const velocity = { x: 0.1, y: -0.08, z: 0.2 };
            const { playerKnockback } = parser.parsePacketBuffer(explosionPacket(knock)).data.params;
            velocity.x += playerKnockback.x;
            velocity.y += playerKnockback.y;
            velocity.z += playerKnockback.z;
            for (const axis of ['x', 'y', 'z']) {
                assert.ok(Number.isFinite(velocity[axis]) && Math.abs(velocity[axis]) < 8, `${axis}: ${velocity[axis]}`);
            }
        }
    });
});
