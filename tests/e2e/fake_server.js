// Simulated Minecraft 26.1 server for the end-to-end tests (runs as a child process).
// Listens on 127.0.0.1 only, on a port chosen by the operating system, and prints "PORT=<n>".
// v0.1.4.14 (spec section 4.4): 26.1 in place of 1.21.8. The registries of the configuration phase come
// from minecraft-data's loginPacket of 26.1 (minecraft-protocol sends them); update_time carries the
// clocks of 26.1 (clockUpdates) in place of time and tickDayTime; see the packets below.
//
// Parameters (command line --key=value, or environment variable in brackets):
//   --seed-high=<int32>   [E2E_SEED_HIGH]  high word of the hashed seed
//   --seed-low=<int32>    [E2E_SEED_LOW]   low word of the hashed seed
//   --motd=<text>         [E2E_MOTD]       server description, sent in server_data
//   --age=<number>        [E2E_AGE]        world age, sent in update_time
//   --hardcore=<bool>     [E2E_HARDCORE]   isHardcore of the login packet
//   --dimension=<name>    [E2E_DIMENSION]  overworld, the_nether, the_end
//   --pos=<x,y,z>         [E2E_POS]        spawn position of the player
//   --commands=<bool>     [E2E_COMMANDS]   answer the chat commands "/give <who> <item> [count]"
//                                          (set_slot into the next hotbar slot) and "/tp [who] <x> <y> <z>"
//                                          (position packet) as a vanilla server would; off by default
//   --floor=<y>           [E2E_FLOOR]      send the 3 x 3 chunks around the spawn with a stone floor at
//                                          height y, so the bot has physics and can walk; no chunks by default
//   --time=<ticks>        [E2E_TIME]       the clock of the dimension at login (totalTicks of update_time), 6000
//   --rate=<number>       [E2E_RATE]       the rate of that clock (1: the daylight cycle runs, 0: it stands), 1
//                                          (v0.1.4.14 fix round, part 8, SPEC 8.1.5: the clock runs between packets)
//
// stdin commands: "chat" prints the chat messages received so far on one line
// "CHAT <json array>"; "kick <json>" sends every client a kick_disconnect packet whose reason is
// the given value (the NBT form of Minecraft 1.21, for example
// {"type":"compound","value":{"translate":{"type":"string","value":"multiplayer.disconnect.x"}}})
// and closes its connection; "time <ticks> [rate]" sends every client one more update_time with that clock
// (a time change, as `time set` makes the server send one); "quit" (or closing stdin) stops the server.
import readline from 'node:readline';
import mc from 'minecraft-protocol';
import minecraftData from 'minecraft-data';
import prismarineRegistry from 'prismarine-registry';
import prismarineChunk from 'prismarine-chunk';
import { Vec3 } from 'vec3';

const VERSION = '26.1';
const mcData = minecraftData(VERSION);

function param(name, envName, fallback) {
    const prefix = `--${name}=`;
    const arg = process.argv.slice(2).find((a) => a.startsWith(prefix));
    if (arg !== undefined) return arg.slice(prefix.length);
    if (process.env[envName] !== undefined) return process.env[envName];
    return fallback;
}

const seedHigh = Number(param('seed-high', 'E2E_SEED_HIGH', '0'));
const seedLow = Number(param('seed-low', 'E2E_SEED_LOW', '0'));
const motd = param('motd', 'E2E_MOTD', 'e2e fake server');
const age = Number(param('age', 'E2E_AGE', '1000'));
const hardcore = String(param('hardcore', 'E2E_HARDCORE', 'false')) === 'true';
const dimension = String(param('dimension', 'E2E_DIMENSION', 'overworld')).replace(/^minecraft:/, '');
const [posX, posY, posZ] = String(param('pos', 'E2E_POS', '0.5,64,0.5')).split(',').map(Number);
const answerCommands = String(param('commands', 'E2E_COMMANDS', 'false')) === 'true';
const floorParam = String(param('floor', 'E2E_FLOOR', ''));
const floorY = floorParam === '' ? null : Number(floorParam);
const clockTicks = Number(param('time', 'E2E_TIME', '6000'));
const clockRate = Number(param('rate', 'E2E_RATE', '1'));

const out = (line) => process.stdout.write(line + '\n');
const log = (...parts) => out('[srv] ' + parts.join(' '));

// index of the dimension in the dimension_type registry that the server sends during configuration
const dimEntries = mcData.loginPacket.dimensionCodec['minecraft:dimension_type'].entries;
const dimIndex = dimEntries.findIndex((e) => e.key === `minecraft:${dimension}`);
if (dimIndex < 0) {
    log('unknown dimension', dimension);
    process.exit(2);
}

// The clock of the dimension (26.1): dimension_type names its default_clock, an entry of the world_clock
// registry (overworld and the_end; the nether has none). update_time sends its index with the time.
const clockEntries = mcData.loginPacket.dimensionCodec['minecraft:world_clock']?.entries ?? [];
const defaultClock = dimEntries[dimIndex].value?.value?.default_clock?.value ?? null;
const clockIndex = defaultClock === null ? -1 : clockEntries.findIndex((e) => e.key === defaultClock);

// 64-bit value as the [high, low] pair of signed 32-bit words that the protocol library writes
function toWords(value) {
    const big = BigInt.asUintN(64, BigInt(Math.trunc(value)));
    const high = Number(BigInt.asIntN(32, big >> 32n));
    const low = Number(BigInt.asIntN(32, big & 0xFFFFFFFFn));
    return [high, low];
}

const chats = [];

// The update_time packet of 26.1: the age of the world and the clock of the dimension (totalTicks, partialTick, rate);
// the nether has no clock. totalTicks is a varlong, which minecraft-protocol reads and writes as a plain number.
function timePacket(ticks, rate) {
    return {
        age: toWords(age),
        clockUpdates: clockIndex < 0 ? [] : [{ id: clockIndex, totalTicks: Math.trunc(ticks), partialTick: 0, rate }],
    };
}

// With --floor=<y>: the 3 x 3 chunks around the spawn, stone at height y, full sky light.
function sendFloor(client) {
    const registry = prismarineRegistry(VERSION);
    const Chunk = prismarineChunk(registry);
    const stone = registry.blocksByName.stone.defaultState;
    const scx = Math.floor(posX / 16);
    const scz = Math.floor(posZ / 16);
    for (let cx = scx - 1; cx <= scx + 1; cx++) {
        for (let cz = scz - 1; cz <= scz + 1; cz++) {
            const chunk = new Chunk({ minY: -64, worldHeight: 384 });
            for (let x = 0; x < 16; x++) {
                for (let z = 0; z < 16; z++) {
                    chunk.setBlockStateId(new Vec3(x, floorY, z), stone);
                    for (let y = floorY + 1; y < floorY + 4; y++) chunk.setSkyLight(new Vec3(x, y, z), 15);
                }
            }
            client.write('map_chunk', { x: cx, z: cz, heightmaps: [], chunkData: chunk.dump(), blockEntities: [], ...chunk.dumpLight() });
        }
    }
    log(`floor: 9 chunks around (${scx}, ${scz}) with stone at y=${floorY}`);
}

// With --commands=true: /give puts the items into the next hotbar slot, /tp moves the player.
function answerCommand(client, command) {
    const words = command.trim().split(/\s+/);
    if (words[0] === 'give' && words.length >= 3) {
        const item = mcData.itemsByName[words[2].replace(/^minecraft:/, '')];
        const count = words.length >= 4 ? Number(words[3]) : 1;
        if (!item || !(count > 0)) {
            log('give: unknown item or count:', command);
            return;
        }
        client.e2eSlot = (client.e2eSlot ?? 35) + 1;
        client.write('set_slot', {
            windowId: 0,
            stateId: client.e2eSlot,
            slot: client.e2eSlot,
            item: { itemCount: count, itemId: item.id, addedComponentCount: 0, removedComponentCount: 0, components: [], removeComponents: [] },
        });
        log(`give: ${count} ${item.name} into slot ${client.e2eSlot}`);
    } else if (words[0] === 'tp' && words.length >= 4) {
        const coords = words.slice(-3).map(Number);
        if (coords.some((n) => !Number.isFinite(n))) {
            log('tp: bad coordinates:', command);
            return;
        }
        client.e2eTeleport = (client.e2eTeleport ?? 1) + 1;
        client.write('position', {
            teleportId: client.e2eTeleport,
            x: coords[0], y: coords[1], z: coords[2],
            dx: 0, dy: 0, dz: 0,
            yaw: 0, pitch: 0,
            flags: { _value: 0 },
        });
        log(`tp: ${coords.join(' ')}`);
    }
}

const server = mc.createServer({
    host: '127.0.0.1',
    port: 0,
    'online-mode': false,
    version: VERSION,
    enforceSecureProfile: false,
    motd,
});

server.on('listening', () => out('PORT=' + server.socketServer.address().port));
server.on('error', (err) => log('server error:', (err && err.stack) || String(err)));

server.on('playerJoin', (client) => {
    log('playerJoin', client.username);
    client.on('packet', (data, meta) => {
        if (meta.name === 'chat_message') chats.push(String(data.message));
        if (meta.name === 'chat_command') chats.push('/' + String(data.command));
        if (meta.name === 'chat_command_signed') chats.push('/' + String(data.command));
        if (answerCommands && (meta.name === 'chat_command' || meta.name === 'chat_command_signed')) {
            try { answerCommand(client, String(data.command)); } catch (err) { log('command error:', err && err.message); }
        }
    });
    client.on('error', (err) => log('client error:', err && err.message));
    client.on('end', (reason) => log('client end', JSON.stringify(reason)));

    client.write('login', {
        ...mcData.loginPacket,
        entityId: client.id,
        isHardcore: hardcore,
        enforcesSecureChat: false,
        worldState: {
            ...mcData.loginPacket.worldState,
            dimension: dimIndex,
            name: `minecraft:${dimension}`,
            hashedSeed: [seedHigh, seedLow],
        },
    });
    // server description as an NBT text component, as a 1.21 server sends it
    client.write('server_data', {
        motd: { type: 'compound', name: '', value: { text: { type: 'string', value: motd } } },
        iconBytes: undefined,
    });
    // 26.1: the time of day is the state of a clock (totalTicks, partialTick, rate) in clockUpdates; 1.21.8
    // sent { age, time, tickDayTime }. Time 6000 with the daylight cycle on (rate 1) by default (--time, --rate).
    client.write('update_time', timePacket(clockTicks, clockRate));
    client.write('position', {
        teleportId: 1,
        x: posX, y: posY, z: posZ,
        dx: 0, dy: 0, dz: 0,
        yaw: 0, pitch: 0,
        flags: { _value: 0 },
    });
    if (floorY !== null && Number.isFinite(floorY)) {
        try { sendFloor(client); } catch (err) { log('floor error:', (err && err.stack) || String(err)); }
    }
    // mineflayer emits 'spawn' on the first update_health with health > 0
    client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
    log(`sent login (seed [${seedHigh}, ${seedLow}], dimension ${dimension} #${dimIndex}, hardcore ${hardcore}), server_data, update_time (age ${age}, clock ${clockTicks} rate ${clockRate}), position (${posX}, ${posY}, ${posZ}), update_health`);
});

let stopping = false;
function stop(why) {
    if (stopping) return;
    stopping = true;
    log('stopping (' + why + ')');
    for (const client of Object.values(server.clients || {})) {
        try { client.end('server stopping'); } catch { /* already gone */ }
    }
    try { server.close(); } catch (e) { log('close error', e.message); }
    setTimeout(() => process.exit(0), 100);
    setTimeout(() => { log('forced exit after 5 s'); process.exit(4); }, 5000).unref();
}
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
    const cmd = line.trim();
    if (cmd === 'chat') out('CHAT ' + JSON.stringify(chats));
    else if (cmd === 'quit') stop('quit command');
    else if (cmd.startsWith('time ')) {
        const [ticks, rate] = cmd.slice(5).trim().split(/\s+/).map(Number);
        if (!Number.isFinite(ticks)) { log('time: bad ticks:', cmd); return; }
        const packet = timePacket(ticks, Number.isFinite(rate) ? rate : clockRate);
        for (const client of Object.values(server.clients || {})) {
            try { client.write('update_time', packet); } catch (err) { log('time error:', err && err.message); }
        }
        log(`time: update_time (clock ${Math.trunc(ticks)} rate ${packet.clockUpdates[0]?.rate ?? '-'}) sent to ${Object.keys(server.clients || {}).length} client(s)`);
    }
    else if (cmd.startsWith('kick ')) {
        let reason;
        try { reason = JSON.parse(cmd.slice(5)); } catch (err) { log('kick: bad json:', err.message); return; }
        for (const client of Object.values(server.clients || {})) {
            try {
                client.write('kick_disconnect', { reason });
                log('kick sent to', client.username);
                setTimeout(() => { try { client.socket.end(); } catch { /* gone */ } }, 300);
            } catch (err) { log('kick error:', err && err.message); }
        }
    }
});
rl.on('close', () => stop('stdin closed'));
