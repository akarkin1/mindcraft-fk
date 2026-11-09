// v0.1.4.14, part L (engineer E1), fix round part 8 (W123's riding part, E2's !leaveBoat): bot.dismount() did nothing on
// 26.1: `I could not leave the boat.`, the server's RootVehicle still set 10 s later. Since 1.21.2 the client leaves a
// vehicle with the shift input of the player_input packet (the unmount flag 0x02 of steer_vehicle before);
// mineflayer 4.39.0 sent player_input with jump, which the server reads as the vehicle's jump.
// patches/mineflayer+4.39.0.patch, lib/plugins/entities.js: dismount writes player_input with shift held, and releases
// it (to the sneak control's state) when the dismount event comes or after 200 ms; the old shape (steer_vehicle with
// jump 0x02) is unchanged.
//
// The fake bot below has the real entities plugin of mineflayer; its client records what it writes.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';
import { TEST_MC_VERSION } from '../helpers/load.js';

const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const injectEntities = require('mineflayer/lib/plugins/entities.js');
const prismarineRegistry = require('prismarine-registry');

const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ridingBot({ version = TEST_MC_VERSION, newInput = null, sneak = false } = {}) {
    const registry = prismarineRegistry(version);
    const bot = new EventEmitter();
    bot.registry = registry;
    bot.version = version;
    bot.supportFeature = (name) => (name === 'newPlayerInputPacket' && newInput !== null ? newInput : registry.supportFeature(name));
    bot.game = { dimension: 'overworld' };
    bot.entity = { id: 1, position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0 };
    bot.getControlState = (control) => (control === 'sneak' ? sneak : false);
    bot._client = new EventEmitter();
    bot._client.state = 'play';
    const writes = [];
    bot._client.write = (name, params) => { writes.push({ name, params }); };
    injectEntities(bot);
    bot.vehicle = { id: 7, name: 'oak_boat' };
    return { bot, writes };
}

describe('L: bot.dismount() leaves the vehicle with the shift input (mineflayer entities.js)', () => {
    test('the patch file and the patched entities.js hold the hunk', () => {
        const patch = read('patches/mineflayer+4.39.0.patch');
        const src = read('node_modules/mineflayer/lib/plugins/entities.js');
        for (const line of [
            "bot._client.write('player_input', { inputs: { shift: true } })",
            "bot._client.write('player_input', { inputs: { shift: bot.getControlState?.('sneak') === true } })",
            "bot.once('dismount', release)",
            'if (vehicle && bot.vehicle === vehicle && !passengers.includes(bot.entity.id)) {',
        ]) {
            assert.ok(src.includes(line), `entities.js: ${line}`);
            assert.ok(patch.includes(`+${src.split('\n').find((l) => l.includes(line))}`), `patch: ${line}`);
        }
        const at = src.indexOf('function dismount ()');
        const body = src.slice(at, src.indexOf('function useEntity', at));
        assert.doesNotMatch(body, /jump: true/, 'no jump input in the dismount');
        assert.match(body, /jump: 0x02/, 'the old shape keeps its unmount flag');
    });

    test('26.1: player_input with shift held, released after the dismount event', async () => {
        const { bot, writes } = ridingBot();
        bot.dismount();
        assert.deepEqual(writes, [{ name: 'player_input', params: { inputs: { shift: true } } }]);
        bot.emit('dismount', bot.vehicle); // the server took the bot out: set_passengers without it
        assert.equal(writes.length, 2);
        assert.deepEqual(writes[1], { name: 'player_input', params: { inputs: { shift: false } } });
        await sleep(260);
        assert.equal(writes.length, 2, 'the timer releases nothing a second time');
    });

    test('no dismount event: the flag is released after 200 ms, to the sneak control\'s state', async () => {
        const { bot, writes } = ridingBot({ sneak: true });
        bot.dismount();
        await sleep(120);
        assert.equal(writes.length, 1, 'held for at least the first ticks');
        await sleep(160);
        assert.deepEqual(writes[1], { name: 'player_input', params: { inputs: { shift: true } } }, 'the bot was sneaking: it goes on sneaking');
        assert.equal(bot.listenerCount('dismount'), 0, 'the one-time listener is gone');
    });

    test('the server of 26.1 answers with the boat and a list without the bot: bot.vehicle clears, dismount fires', () => {
        const { bot, writes } = ridingBot();
        const boat = { id: 7, name: 'oak_boat', passengers: [bot.entity] };
        bot.entities[7] = boat;
        bot.entity.vehicle = boat;
        bot.vehicle = boat;
        const events = [];
        bot.on('dismount', (v) => events.push(v?.id));
        bot.dismount();
        bot._client.emit('set_passengers', { entityId: 7, passengers: [] });
        assert.equal(bot.vehicle, null, 'the bot left the boat');
        assert.deepEqual(events, [7]);
        assert.deepEqual(boat.passengers, [], 'the boat holds no passenger');
        assert.equal(bot.entity.vehicle, null);
        assert.deepEqual(writes.map((w) => w.params.inputs.shift), [true, false], 'the shift input released on the dismount');
        // the list with another passenger only: the same
        const { bot: other } = ridingBot();
        const boat2 = { id: 8, name: 'oak_boat', passengers: [other.entity] };
        other.entities[8] = boat2;
        other.vehicle = boat2;
        other._client.emit('set_passengers', { entityId: 8, passengers: [99] });
        assert.equal(other.vehicle, null);
        assert.equal(boat2.passengers.length, 1, 'the other passenger is in');
        // a list that still holds the bot: nothing changes
        const { bot: still } = ridingBot();
        const boat3 = { id: 9, name: 'oak_boat', passengers: [still.entity] };
        still.entities[9] = boat3;
        still.vehicle = boat3;
        still._client.emit('set_passengers', { entityId: 9, passengers: [still.entity.id] });
        assert.equal(still.vehicle, boat3);
    });

    test('the old packet shape (before 1.21.2): steer_vehicle with the unmount flag, unchanged', () => {
        const { bot, writes } = ridingBot({ newInput: false });
        bot.dismount();
        assert.deepEqual(writes, [{ name: 'steer_vehicle', params: { sideways: 0.0, forward: 0.0, jump: 0x02 } }]);
    });

    test('not mounted: an error event, no packet', () => {
        const { bot, writes } = ridingBot();
        bot.vehicle = null;
        const errors = [];
        bot.on('error', (e) => errors.push(e.message));
        bot.dismount();
        assert.deepEqual(writes, []);
        assert.deepEqual(errors, ['dismount: not mounted']);
    });
});
