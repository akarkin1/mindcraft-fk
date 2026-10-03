// Release v0.1.4.12, part F (engineer E5): the area sense and the knowledge line underground (SPEC 4.5, F2, F3, F4).
//   - senseTick of src/agent/areas/area_sense.js: in a tunnel of a known mine the sentence of F2 once per tunnel per
//     start; silent in a tunnel of no mine, in a cave, and in any place underground (it never asks for a name); it never
//     touches the controls of the bot (F9: no clearControlStates while an action climbs a ladder);
//   - unsavedEnclosure and enclosureKnowledge for a place in rock; whereLine of src/agent/knowledge/knowledge_text.js
//     names the known tunnel or nothing underground.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

const A = await loadSrc('src/agent/areas/area_sense.js');
const KT = await loadSrc('src/agent/knowledge/knowledge_text.js');
const M = await loadSrc('src/agent/packs/mining/mine_logic.js');

const FEET = 50;
const TUNNEL_LINE = 'I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".';
const MINE = { name: 'mine', tunnel: 0, level: FEET, onRoute: false };
const DEEP = (mine = null) => () => ({ area: null, depth: 20, underground: true, mine });

function rockBot(world, x, z) {
    const bot = { entity: { position: vec(x + 0.5, FEET, z + 0.5) }, entities: {}, game: { dimension: 'overworld' },
        blockAt: (p) => world.blockAt(p), stops: 0 };
    bot.clearControlStates = () => { bot.stops++; };
    return bot;
}

function tunnelWorld() {
    const world = createBlockWorld().flatGround(120, 'stone', 'stone');
    world.fill(0, FEET, 0, 22, FEET + 1, 1, 'air');
    world.fill(23, FEET, -2, 27, FEET + 2, 3, 'air');
    return world;
}

function caveWorld() {
    const world = createBlockWorld().flatGround(120, 'stone', 'stone');
    world.fill(0, FEET, 0, 5, FEET + 2, 5, 'air');
    world.fill(1, FEET, -1, 1, FEET + 1, -3, 'air');
    world.fill(6, FEET, 4, 8, FEET + 1, 4, 'air');
    world.fill(4, FEET, 6, 4, FEET + 1, 8, 'air');
    return world;
}

// A room of planks with a chest and a door deep under the ground: a storage on the surface, nothing underground.
function storageWorld() {
    const world = createBlockWorld().flatGround(120, 'stone', 'stone');
    world.fill(-3, FEET - 1, -3, 3, FEET + 3, 3, 'oak_planks');
    world.fill(-2, FEET, -2, 2, FEET + 2, 2, 'air');
    world.set(2, FEET, 2, 'chest');
    world.set(0, FEET, -3, 'oak_door', { half: 'lower' });
    world.set(0, FEET + 1, -3, 'oak_door', { half: 'upper' });
    return world;
}

// Ticks the sense for `ms` in steps of 1 s; the lines it said.
function run(state, bot, input, from, ms) {
    const said = [];
    for (let now = from; now <= from + ms; now += 1000) {
        const line = A.senseTick(state, bot, { idle: true, areas: [], tunnelAt: M.tunnelAt, ...input, now });
        if (line) said.push(line);
    }
    return said;
}

describe('F3: the sense underground', () => {
    test('in a tunnel of a known mine: the sentence of F2 once per tunnel per start, after 3 s', () => {
        const bot = rockBot(tunnelWorld(), 11, 0);
        const state = A.newSenseState();
        assert.deepEqual(run(state, bot, { whereAmI: DEEP(MINE) }, 0, 2000), []);
        assert.deepEqual(run(state, bot, { whereAmI: DEEP(MINE) }, 3000, 0), [TUNNEL_LINE]);
        bot.entity.position = vec(3.5, FEET, 1.5); // further in the same tunnel
        assert.deepEqual(run(state, bot, { whereAmI: DEEP(MINE) }, 4000, 200000), [], 'once per tunnel');
        assert.equal(bot.stops, 0, 'F9: the sense never touches the controls (a mode ticks while an action climbs)');
    });

    test('in a tunnel of no mine: nothing, also when the mine becomes known it is said then', () => {
        const bot = rockBot(tunnelWorld(), 11, 0);
        const state = A.newSenseState();
        assert.deepEqual(run(state, bot, { whereAmI: DEEP(null) }, 0, 120000), []);
        assert.deepEqual(run(state, bot, { whereAmI: DEEP(MINE) }, 121000, 4000), [TUNNEL_LINE]);
    });

    test('in a cave: nothing, with a mine or without, never a name asked', () => {
        for (const mine of [null, MINE]) {
            const bot = rockBot(caveWorld(), 2, 2);
            assert.deepEqual(run(A.newSenseState(), bot, { whereAmI: DEEP(mine) }, 0, 120000), []);
        }
    });

    test('underground an unsaved room with a chest is no storage: nothing; on the surface the old line', () => {
        const bot = rockBot(storageWorld(), 0, 0);
        assert.deepEqual(run(A.newSenseState(), bot, { whereAmI: DEEP(null) }, 0, 120000), []);
        assert.deepEqual(run(A.newSenseState(), bot, { whereAmI: () => ({ area: null, depth: 8, underground: false, mine: null }) }, 0, 120000), [],
            'a depth of 8 is underground');
        const surface = run(A.newSenseState(), bot, { whereAmI: () => ({ area: null, depth: 0, underground: false, mine: null }) }, 0, 5000);
        assert.equal(surface.length, 1);
        assert.match(surface[0], /storage .*Tell me its name and I keep it\.$/);
    });

    test('a broken whereAmI or tunnelAt never throws', () => {
        const bot = rockBot(tunnelWorld(), 11, 0);
        const bad = () => { throw new Error('x'); };
        assert.deepEqual(run(A.newSenseState(), bot, { whereAmI: bad, tunnelAt: bad }, 0, 10000), []);
        assert.equal(A.isUndergroundHere({ depth: 8 }), true);
        assert.equal(A.isUndergroundHere({ depth: 7, underground: false }), false);
        assert.equal(A.isUndergroundHere(null), false);
    });
});

describe('F3: the knowledge line underground', () => {
    test('a tunnel: kind tunnel, the water not counted; the line names the tunnel of a known mine, else nothing', () => {
        const world = tunnelWorld();
        world.set(5, FEET - 1, 0, 'water');
        const bot = rockBot(world, 11, 0);
        const found = A.unsavedEnclosure(bot, [], { tunnelAt: M.tunnelAt });
        assert.equal(bot.stops, 0, 'F9: the knowledge line never touches the controls');
        assert.equal(found.kind, 'tunnel');
        assert.equal(found.contents.water, 0);
        const enclosure = A.enclosureKnowledge(found);
        assert.deepEqual(enclosure.tunnel, { width: 2, length: 23, dir: 'west' });
        assert.equal(KT.whereLine({ area: null, depth: 20, underground: true, mine: MINE, enclosure }),
            'You are in the mine "mine", tunnel 1 at level 50, 20 blocks under the ground. '
            + 'You stand in a tunnel 2 wide and 23 long, heading west, of the mine "mine".');
        assert.equal(KT.whereLine({ area: null, depth: 20, underground: true, mine: null, enclosure }), 'You are 20 blocks under the ground.');
    });

    test('a cave and an unsaved room underground: nothing', () => {
        const cave = A.enclosureKnowledge(A.unsavedEnclosure(rockBot(caveWorld(), 2, 2), [], { tunnelAt: M.tunnelAt }));
        assert.equal(cave.kind, 'cave');
        assert.equal(KT.whereLine({ area: null, depth: 20, underground: true, mine: MINE, enclosure: cave }),
            'You are in the mine "mine", tunnel 1 at level 50, 20 blocks under the ground.');
        const room = A.enclosureKnowledge(A.unsavedEnclosure(rockBot(storageWorld(), 0, 0), [], { tunnelAt: M.tunnelAt }));
        assert.equal(room.border, 'wall');
        assert.equal(KT.whereLine({ area: null, depth: 20, underground: true, enclosure: room }), 'You are 20 blocks under the ground.');
        assert.match(KT.whereLine({ area: null, depth: 0, underground: false, enclosure: room }), /^You are on the surface\. You stand in a walled enclosure/);
    });
});
