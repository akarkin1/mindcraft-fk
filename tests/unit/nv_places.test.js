// Tester T1 of v0.1.4.11 "Navigation and words", from the spec: part P. I5 the enclosure (scanEnclosure on fixtures,
// countContents with a fake bot, kindOf by each rule and in the order of the rules, the area record with kind, contents,
// border and the type derived from the kind, isKeepOutArea by the facts), I6 and P3 the knowledge line, P1 the answers
// of !rememberArea word for word, P2 the area sense (the texts and the timing rules).
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const K = await loadSrc('src/agent/areas/area_kind.js');
const S = await loadSrc('src/agent/areas/area_scan.js');
const SE = await loadSrc('src/agent/areas/area_sense.js');
const KO = await loadSrc('src/agent/areas/keep_out_logic.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const KT = await loadSrc('src/agent/knowledge/knowledge_text.js');

const box = (x, z) => ({ min: { x: 0, y: 64, z: 0 }, max: { x: x - 1, y: 66, z: z - 1 } });
const gate = { x: 5, y: 64, z: 0, kind: 'gate' };
const door = { x: 4, y: 64, z: 0, kind: 'door' };
const contents = (c = {}) => ({ animals: {}, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0, ...c });
const encl = (e = {}) => ({ found: true, box: box(9, 7), border: 'fence', openings: [], roof: false, floor: 'ground', reason: null, ...e });

// ------------------------------------------------------------------------------------------------ kindOf

describe('I5: kindOf, each rule', () => {
    test('animals of 1 kind and a gate: pen', () => {
        assert.equal(K.kindOf(encl({ openings: [gate] }), contents({ animals: { chicken: 6 } })), 'pen');
    });

    test('animals and a door (no gate): pen', () => {
        assert.equal(K.kindOf(encl({ openings: [door] }), contents({ animals: { cow: 1 } })), 'pen');
    });

    test('animals of 2 kinds and a gate: pen', () => {
        assert.equal(K.kindOf(encl({ openings: [gate] }), contents({ animals: { chicken: 6, cow: 1 } })), 'pen');
    });

    test('crops on a tilled floor: farm', () => {
        assert.equal(K.kindOf(encl({ openings: [gate], floor: 'tilled' }), contents({ crops: { wheat: 40 } })), 'farm');
    });

    test('a roof, a door and a bed: home', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: true, openings: [door], floor: 'built' }), contents({ beds: 1, chests: 2 })), 'home');
    });

    test('a roof and chests: storage', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: true, openings: [door], floor: 'built' }), contents({ chests: 4 })), 'storage');
    });

    test('a roof and furnaces: storage', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: true, openings: [door], floor: 'built' }), contents({ furnaces: 2 })), 'storage');
    });

    test('a roof and a door: building', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: true, openings: [door], floor: 'built' }), contents()), 'building');
    });

    test('else: yard', () => {
        assert.equal(K.kindOf(encl({ openings: [gate] }), contents()), 'yard');
        assert.equal(K.kindOf(encl({ openings: [] }), contents()), 'yard');
    });
});

describe('I5: kindOf, the order of the rules (the first that fits)', () => {
    test('animals with a gate on a tilled floor with crops: pen before farm', () => {
        assert.equal(K.kindOf(encl({ openings: [gate], floor: 'tilled' }), contents({ animals: { chicken: 2 }, crops: { wheat: 40 } })), 'pen');
    });

    test('animals without a gate or door: not a pen; with crops on tilled floor a farm', () => {
        assert.equal(K.kindOf(encl({ openings: [{ x: 1, y: 64, z: 0, kind: 'gap' }], floor: 'tilled' }),
            contents({ animals: { chicken: 2 }, crops: { wheat: 40 } })), 'farm');
    });

    test('animals behind a trapdoor or a gap only: not a pen', () => {
        assert.notEqual(K.kindOf(encl({ openings: [{ x: 1, y: 64, z: 0, kind: 'trapdoor' }] }), contents({ animals: { chicken: 2 } })), 'pen');
        assert.notEqual(K.kindOf(encl({ openings: [{ x: 1, y: 64, z: 0, kind: 'gap' }] }), contents({ animals: { chicken: 2 } })), 'pen');
    });

    test('crops on a floor that is not tilled: not a farm', () => {
        assert.equal(K.kindOf(encl({ openings: [gate], floor: 'ground' }), contents({ crops: { wheat: 40 } })), 'yard');
    });

    test('a farm under a roof with a door and a bed: farm before home', () => {
        assert.equal(K.kindOf(encl({ roof: true, openings: [door], floor: 'tilled' }), contents({ crops: { wheat: 10 }, beds: 1 })), 'farm');
    });

    test('a roof, a door, a bed and chests: home before storage', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: true, openings: [door] }), contents({ beds: 1, chests: 2, furnaces: 1 })), 'home');
    });

    test('a roof, a bed and no door: not home; with chests a storage', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: true, openings: [] }), contents({ beds: 1, chests: 2 })), 'storage');
    });

    test('a roof, a door and chests: storage before building', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: true, openings: [door] }), contents({ chests: 1 })), 'storage');
    });

    test('no roof, a door and a bed: not home, not building: yard', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: false, openings: [door] }), contents({ beds: 1 })), 'yard');
    });

    test('a roof and no door: yard', () => {
        assert.equal(K.kindOf(encl({ border: 'wall', roof: true, openings: [] }), contents()), 'yard');
    });
});

describe('I5: the type from the kind', () => {
    test('pen, farm, home, building as they are; storage and yard map to building', () => {
        assert.deepEqual(['pen', 'farm', 'home', 'storage', 'building', 'yard'].map((k) => K.typeOfKind(k)),
            ['pen', 'farm', 'home', 'building', 'building', 'building']);
    });
});

// ------------------------------------------------------------------------------------------------ P1

describe('P1: the answers of !rememberArea, word for word', () => {
    test('aviary, a pen', () => {
        assert.equal(K.savedText('aviary', 'pen', encl({ border: 'fence', openings: [gate] }), contents({ animals: { chicken: 6 } }), box(9, 7)),
            'I saved "aviary": a pen, fenced, 9 x 7, 1 gate, 6 chickens. I keep its gate closed and pick nothing up inside it.');
    });

    test('wheat_farm, a farm', () => {
        assert.equal(K.savedText('wheat_farm', 'farm', encl({ border: 'fence', openings: [gate], floor: 'tilled' }), contents({ crops: { wheat: 40 } }), box(8, 12)),
            'I saved "wheat_farm": a farm, fenced, 8 x 12, 1 gate, 40 wheat. I only plant and harvest there.');
    });

    test('home, a home', () => {
        assert.equal(K.savedText('home', 'home', encl({ border: 'wall', roof: true, openings: [door] }), contents({ beds: 1, chests: 2 }), box(9, 11)),
            'I saved "home": a home, walled, 9 x 11 with a roof, 1 door, 1 bed, 2 chests. I shelter there at night.');
    });

    test('cellar, a storage', () => {
        assert.equal(K.savedText('cellar', 'storage', encl({ border: 'wall', roof: true, openings: [door] }), contents({ chests: 4, furnaces: 2 }), box(5, 5)),
            'I saved "cellar": a storage, walled, 5 x 5 with a roof, 1 door, 4 chests, 2 furnaces. I use its chests.');
    });

    test('barn, a building', () => {
        assert.equal(K.savedText('barn', 'building', encl({ border: 'wall', roof: true, openings: [door] }), contents(), box(7, 9)),
            'I saved "barn": a building, walled, 7 x 9 with a roof, 1 door. I change nothing in it.');
    });

    test('yard, a yard', () => {
        assert.equal(K.savedText('yard', 'yard', encl({ border: 'fence', openings: [gate] }), contents(), box(12, 12)),
            'I saved "yard": a yard, fenced, 12 x 12, 1 gate. I change nothing in it.');
    });

    test('the kind changed', () => {
        assert.equal(K.kindChangedText('aviary', 'farm'), '"aviary" is a farm now. I only plant and harvest there.');
    });

    test('the same box again (v0.1.4.10, unchanged)', () => {
        assert.equal(AS.sameBoxText('home'), 'That is the area "home" already.');
    });

    test('no border', () => {
        const world = createBlockWorld().flatGround(63);
        const r = S.scanEnclosure(world.getBlockName, { x: 5.5, y: 64, z: 5.5 });
        assert.equal(r.found, false);
        assert.equal(r.reason, 'no_border');
        assert.equal(r.text, 'I find no border around me: no fence, wall, hedge or water within 24 blocks. Stand inside the place and say it again.');
    });

    test('the contents in the order animals (the most first), crops, beds, chests, furnaces, tables, ladders, water; zeros left out', () => {
        const c = contents({ animals: { cow: 1, chicken: 6 }, crops: { wheat: 40 }, beds: 1, chests: 2, furnaces: 0, tables: 1, ladders: 3, water: 2 });
        const text = K.savedText('x', 'yard', encl({ border: 'fence', openings: [gate] }), c, box(9, 7));
        const order = ['6 chickens', '1 cow', '40 wheat', '1 bed', '2 chests', '1 ', '3 ladders', '2 water'];
        let at = text.indexOf('1 gate');
        assert.ok(at > 0, text);
        for (const part of order) {
            const next = text.indexOf(part, at + 1);
            assert.ok(next > at, `${part} after the one before: ${text}`);
            at = next;
        }
        assert.ok(!/\b0 /.test(text), `a count of 0 is left out: ${text}`);
    });

    test('a type given by the owner is said the same way', () => {
        assert.equal(K.savedText('aviary', 'farm', encl({ border: 'fence', openings: [gate] }), contents({ animals: { chicken: 6 } }), box(9, 7)),
            'I saved "aviary": a farm, fenced, 9 x 7, 1 gate, 6 chickens. I only plant and harvest there.');
    });
});

// ------------------------------------------------------------------------------------------------ P2, P3

describe('P2: the area sense, word for word', () => {
    test('a fenced pen', () => {
        assert.equal(K.senseText('pen', encl({ border: 'fence', openings: [gate] }), contents({ animals: { chicken: 6 } }), box(9, 7)),
            'I am in a fenced pen 9 x 7 with 6 chickens and 1 gate that I have not saved. Tell me its name and I keep it.');
    });

    test('a walled building', () => {
        assert.equal(K.senseText('building', encl({ border: 'wall', roof: true, openings: [door] }), contents(), box(7, 9)),
            'I am in a walled building 7 x 9 with a roof and 1 door that I have not saved. Tell me its name and I keep it.');
    });
});

describe('P2: the timing rules (senseStep)', () => {
    const A = 'a';
    const B = 'b';

    test('only after the bot has stood inside for 3 s', () => {
        const s = SE.newSenseState();
        assert.equal(SE.senseStep(s, { now: 0, idle: true, key: A }), false);
        assert.equal(SE.senseStep(s, { now: 2999, idle: true, key: A }), false);
        assert.equal(SE.senseStep(s, { now: 3000, idle: true, key: A }), true);
    });

    test('once per enclosure (its box) per start', () => {
        const s = SE.newSenseState();
        SE.senseStep(s, { now: 0, idle: true, key: A });
        assert.equal(SE.senseStep(s, { now: 3000, idle: true, key: A }), true);
        assert.equal(SE.senseStep(s, { now: 200000, idle: true, key: A }), false, 'the same box later');
        SE.senseStep(s, { now: 300000, idle: true, key: null }); // out
        SE.senseStep(s, { now: 300001, idle: true, key: A }); // in again
        assert.equal(SE.senseStep(s, { now: 400000, idle: true, key: A }), false, 'the same box after leaving it');
        const fresh = SE.newSenseState(); // a new start
        SE.senseStep(fresh, { now: 0, idle: true, key: A });
        assert.equal(SE.senseStep(fresh, { now: 3000, idle: true, key: A }), true);
    });

    test('not within 60 s of the last such line', () => {
        const s = SE.newSenseState();
        SE.senseStep(s, { now: 0, idle: true, key: A });
        assert.equal(SE.senseStep(s, { now: 3000, idle: true, key: A }), true);
        SE.senseStep(s, { now: 10000, idle: true, key: B });
        assert.equal(SE.senseStep(s, { now: 20000, idle: true, key: B }), false, '17 s after the last line');
        assert.equal(SE.senseStep(s, { now: 62999, idle: true, key: B }), false, '59.999 s after the last line');
        assert.equal(SE.senseStep(s, { now: 63000, idle: true, key: B }), true, '60 s after the last line');
    });

    test('not while a command runs', () => {
        const s = SE.newSenseState();
        SE.senseStep(s, { now: 0, idle: true, key: A });
        assert.equal(SE.senseStep(s, { now: 5000, idle: false, key: A }), false);
        assert.equal(SE.senseStep(s, { now: 6000, idle: true, key: A }), false, 'the 3 s count again after the command');
        assert.equal(SE.senseStep(s, { now: 9000, idle: true, key: A }), true);
    });

    test('the key is the box: the same box gives the same key, another box another', () => {
        assert.equal(SE.boxKey(box(9, 7)), SE.boxKey({ min: { ...box(9, 7).max }, max: { ...box(9, 7).min } }));
        assert.notEqual(SE.boxKey(box(9, 7)), SE.boxKey(box(9, 8)));
    });
});

describe('P3 and I6: the knowledge line', () => {
    const where = (enclosure) => ({ area: null, depth: 0, underground: false, enclosure });
    const e = { saved: false, border: 'fence', size: { x: 9, z: 7 }, contents: contents({ animals: { chicken: 6 } }), openings: [gate] };

    test('word for word', () => {
        assert.equal(KT.enclosureLine(e), 'You stand in a fenced enclosure 9 x 7 with 6 chickens and 1 gate that is not saved.');
        assert.ok(KT.whereLine(where(e)).endsWith(' You stand in a fenced enclosure 9 x 7 with 6 chickens and 1 gate that is not saved.'),
            KT.whereLine(where(e)));
    });

    test('nothing for a saved one or without an enclosure', () => {
        assert.ok(!/You stand in/.test(KT.whereLine(where({ ...e, saved: true }))));
        assert.ok(!/You stand in/.test(KT.whereLine(where(null))));
        assert.equal(KT.whereLine(where(null)), 'You are on the surface.');
    });

    test('nothing when the scan found no enclosure (enclosureKnowledge of null)', () => {
        assert.equal(SE.enclosureKnowledge(null), null);
    });

    test('at most once per 10 s', () => {
        assert.equal(SE.ENCLOSURE_KNOWLEDGE_MS, 10000);
    });
});

// ------------------------------------------------------------------------------------------------ scanEnclosure

function ring(world, x1, z1, x2, z2, y, name, height = 1) {
    for (let x = x1; x <= x2; x++) {
        for (let z = z1; z <= z2; z++) {
            if (x === x1 || x === x2 || z === z1 || z === z2) {
                for (let h = 0; h < height; h++) world.set(x, y + h, z, name);
            }
        }
    }
}

function pen() {
    const w = createBlockWorld().flatGround(63);
    ring(w, 0, 0, 10, 8, 64, 'oak_fence');
    w.set(5, 64, 0, 'oak_fence_gate', { facing: 'south', open: false, in_wall: false });
    return w;
}

function house() {
    const w = createBlockWorld().flatGround(63);
    w.fill(0, 63, 0, 8, 63, 10, 'oak_planks');
    ring(w, 0, 0, 8, 10, 64, 'oak_planks', 3);
    w.fill(0, 67, 0, 8, 67, 10, 'oak_planks');
    w.set(4, 64, 0, 'oak_door', { half: 'lower', facing: 'south', open: false, hinge: 'left' });
    w.set(4, 65, 0, 'oak_door', { half: 'upper', facing: 'south', open: false, hinge: 'left' });
    w.set(2, 64, 8, 'red_bed', { part: 'head', facing: 'south' });
    w.set(2, 64, 9, 'red_bed', { part: 'foot', facing: 'south' });
    w.set(6, 64, 9, 'chest', { type: 'single', facing: 'north' });
    w.set(6, 64, 7, 'chest', { type: 'single', facing: 'north' });
    return w;
}

describe('I5: scanEnclosure on fixtures', () => {
    test('a fenced pen with a gate: found, border fence, the gate an opening, no roof', () => {
        const r = S.scanEnclosure(pen().getBlockName, { x: 5.5, y: 64, z: 4.5 });
        assert.equal(r.found, true, r.reason);
        assert.equal(r.border, 'fence');
        assert.ok(r.openings.some((o) => o.x === 5 && o.y === 64 && o.z === 0 && o.kind === 'gate'), JSON.stringify(r.openings));
        assert.equal(r.roof, false);
        assert.ok(['ground', 'mixed'].includes(r.floor), r.floor);
        assert.equal(r.reason, null);
        assert.ok(r.box?.min && r.box?.max, 'a box');
        assert.ok(r.box.min.x <= 5 && r.box.max.x >= 5 && r.box.min.z <= 4 && r.box.max.z >= 4, 'the box holds the origin');
    });

    test('a walled house with a roof and a door: border wall, roof, the door an opening, floor built', () => {
        const r = S.scanEnclosure(house().getBlockName, { x: 4.5, y: 64, z: 5.5 });
        assert.equal(r.found, true, r.reason);
        assert.equal(r.border, 'wall');
        assert.equal(r.roof, true);
        assert.ok(r.openings.some((o) => o.x === 4 && o.y === 64 && o.z === 0 && o.kind === 'door'), JSON.stringify(r.openings));
        assert.equal(r.floor, 'built');
    });

    test('a hedge: border hedge', () => {
        const w = createBlockWorld().flatGround(63);
        ring(w, 0, 0, 10, 8, 64, 'oak_leaves', 2);
        const r = S.scanEnclosure(w.getBlockName, { x: 5.5, y: 64, z: 4.5 });
        assert.equal(r.found, true, r.reason);
        assert.equal(r.border, 'hedge');
    });

    test('a pond around an island: border water', () => {
        const w = createBlockWorld().flatGround(63);
        for (const d of [0, 1]) {
            for (let x = -d; x <= 10 + d; x++) {
                for (let z = -d; z <= 8 + d; z++) {
                    if (x === -d || x === 10 + d || z === -d || z === 8 + d) {
                        w.set(x, 63, z, 'water');
                        w.set(x, 62, z, 'water');
                    }
                }
            }
        }
        const r = S.scanEnclosure(w.getBlockName, { x: 5.5, y: 64, z: 4.5 });
        assert.equal(r.found, true, r.reason);
        assert.equal(r.border, 'water');
    });

    test('glass walls without a roof: border glass', () => {
        const w = createBlockWorld().flatGround(63);
        ring(w, 0, 0, 10, 8, 64, 'glass', 2);
        w.set(5, 64, 0, 'oak_fence_gate', { facing: 'south', open: false });
        w.set(5, 65, 0, 'air');
        const r = S.scanEnclosure(w.getBlockName, { x: 5.5, y: 64, z: 4.5 });
        assert.equal(r.found, true, r.reason);
        assert.equal(r.border, 'glass');
    });

    test('a fence with a gap: no enclosure, or one with an opening of kind gap; never a closed pen', () => {
        const w = pen();
        w.set(10, 64, 4, 'air');
        const r = S.scanEnclosure(w.getBlockName, { x: 5.5, y: 64, z: 4.5 });
        if (r.found) {
            assert.ok(r.openings.some((o) => o.kind === 'gap'), `found without the gap: ${JSON.stringify(r.openings)}`);
        } else {
            assert.equal(typeof r.reason, 'string');
            assert.notEqual(r.reason, 'no_border', 'there is a fence');
        }
    });

    test('no border: found false, border null, reason no_border', () => {
        const r = S.scanEnclosure(createBlockWorld().flatGround(63).getBlockName, { x: 5.5, y: 64, z: 4.5 });
        assert.equal(r.found, false);
        assert.equal(r.border, null);
        assert.equal(r.reason, 'no_border');
    });

    test('the result has the fields of I5', () => {
        const r = S.scanEnclosure(pen().getBlockName, { x: 5.5, y: 64, z: 4.5 });
        for (const k of ['found', 'box', 'border', 'openings', 'roof', 'floor', 'reason']) assert.ok(Object.hasOwn(r, k), k);
        assert.ok(['fence', 'wall', 'glass', 'hedge', 'water', 'mixed', null].includes(r.border));
        assert.ok(['tilled', 'built', 'ground', 'mixed'].includes(r.floor));
        for (const o of r.openings) assert.ok(['door', 'gate', 'trapdoor', 'gap'].includes(o.kind), o.kind);
    });

    test('scanPen, scanBuilding, scanFarm and scanWithoutType stay', () => {
        for (const f of ['scanPen', 'scanBuilding', 'scanFarm', 'scanWithoutType']) assert.equal(typeof S[f], 'function', f);
        assert.equal(S.scanPen(pen().getBlockName, { x: 5.5, y: 64, z: 4.5 }).found, true);
        assert.equal(S.scanBuilding(house().getBlockName, { x: 4.5, y: 64, z: 5.5 }).found, true);
    });
});

// ------------------------------------------------------------------------------------------------ countContents

describe('I5: countContents(bot, box)', () => {
    const at = (x, y, z) => ({ x, y, z });

    test('the shape of I5, animals by kind inside the box only, players and the bot left out', () => {
        const world = pen();
        const self = { name: 'w_bot', type: 'player', position: at(5.5, 64, 4.5) };
        const entities = { 0: self, 99: { name: 'w_player', type: 'player', position: at(4.5, 64, 4.5) } };
        for (let i = 0; i < 6; i++) entities[i + 1] = { name: 'chicken', type: 'animal', position: at(2.5 + i, 64, 3.5) };
        entities[20] = { name: 'cow', type: 'animal', position: at(30.5, 64, 30.5) }; // outside
        const bot = { entity: self, entities, blockAt: (p) => world.blockAt(p) };
        const c = SE.countContents(bot, { min: at(1, 63, 1), max: at(9, 66, 7) });
        assert.deepEqual(Object.keys(c).sort(), ['animals', 'beds', 'chests', 'crops', 'furnaces', 'ladders', 'tables', 'water']);
        assert.deepEqual(c.animals, { chicken: 6 });
        assert.deepEqual(c.crops, {});
        for (const k of ['beds', 'chests', 'furnaces', 'tables', 'ladders', 'water']) assert.equal(c[k], 0, k);
    });

    test('blocks: a bed once, chests, furnaces, crafting tables, ladders, water, crops by kind', () => {
        const world = house();
        world.set(1, 64, 1, 'furnace').set(1, 64, 2, 'crafting_table').set(7, 64, 1, 'ladder').set(7, 65, 1, 'ladder');
        world.set(3, 63, 3, 'water');
        for (let x = 1; x <= 4; x++) world.set(x, 64, 5, 'wheat', { age: 7 });
        world.set(5, 64, 5, 'carrots', { age: 2 });
        const bot = { entity: { position: { x: 4.5, y: 64, z: 5.5 } }, entities: {}, blockAt: (p) => world.blockAt(p) };
        const c = SE.countContents(bot, { min: at(1, 63, 1), max: at(7, 66, 9) });
        assert.deepEqual(c.crops, { wheat: 4, carrots: 1 });
        assert.deepEqual([c.beds, c.chests, c.furnaces, c.tables, c.ladders, c.water], [1, 2, 1, 1, 2, 1]);
    });
});

// ------------------------------------------------------------------------------------------------ record, keep out

describe('I5: the area record gets kind, contents, border; type from the kind', () => {
    const dirs = [];
    after(() => dirs.forEach(removeTmpDir));

    function store() {
        const dir = makeTmpDir();
        dirs.push(dir);
        return new AS.AreaStore(path.join(dir, 'areas.json'), { now: () => new Date(0) });
    }
    const area = (extra) => ({ name: 'x', type: 'building', min: { x: 0, y: 63, z: 0 }, max: { x: 8, y: 66, z: 6 }, ...extra });

    for (const [kind, type] of [['pen', 'pen'], ['farm', 'farm'], ['home', 'home'], ['building', 'building'], ['storage', 'building'], ['yard', 'building']]) {
        test(`kind ${kind}: type ${type}, the kind kept`, () => {
            const saved = store().set(area({ name: kind, kind }));
            assert.equal(saved.kind, kind);
            assert.equal(saved.type, type);
        });
    }

    test('contents (as scanned) and border are kept', () => {
        const c = contents({ animals: { chicken: 6 } });
        const saved = store().set(area({ name: 'aviary', kind: 'pen', contents: c, border: 'fence', entrances: [gate] }));
        assert.deepEqual(saved.contents.animals, { chicken: 6 });
        assert.equal(saved.border, 'fence');
    });

    test('a record of v0.1.4.10 (no kind) keeps its type', () => {
        const saved = store().set(area({ name: 'old', type: 'farm' }));
        assert.equal(saved.type, 'farm');
        assert.ok(!saved.kind);
    });
});

describe('I5: isKeepOutArea by the facts', () => {
    const b = { min: { x: 0, y: 63, z: 0 }, max: { x: 8, y: 66, z: 6 } };

    test('a kind of pen', () => {
        assert.equal(KO.isKeepOutArea({ ...b, name: 'a', type: 'building', kind: 'pen' }), true);
    });

    test('animals in contents and an opening of kind gate, whatever the kind', () => {
        assert.equal(KO.isKeepOutArea({ ...b, name: 'a', type: 'building', kind: 'yard', contents: contents({ animals: { cow: 2 } }), entrances: [gate] }), true);
    });

    test('animals without a gate, or a gate without animals: not by the facts', () => {
        assert.equal(KO.isKeepOutArea({ ...b, name: 'a', type: 'building', kind: 'yard', contents: contents({ animals: { cow: 2 } }), entrances: [door] }), false);
        assert.equal(KO.isKeepOutArea({ ...b, name: 'a', type: 'building', kind: 'yard', contents: contents(), entrances: [gate] }), false);
    });

    test('flags.no_enter, and the types pen and farm as today', () => {
        assert.equal(KO.isKeepOutArea({ ...b, name: 'a', type: 'building', flags: { no_enter: true } }), true);
        assert.equal(KO.isKeepOutArea({ ...b, name: 'a', type: 'pen' }), true);
        assert.equal(KO.isKeepOutArea({ ...b, name: 'a', type: 'farm' }), true);
        assert.equal(KO.isKeepOutArea({ ...b, name: 'a', type: 'home' }), false);
    });

    test('the leave text names the kind (W94): I leave the ... in the pen "aviary"', () => {
        assert.match(KO.leaveText('wheat_seeds', { name: 'aviary', type: 'pen', kind: 'pen' }), /^I leave the wheat_seeds in the pen "aviary"/);
    });
});

describe('I5 end to end: the scan of the pen, its contents, its kind and the P1 answer', () => {
    test('a fenced pen with 6 chickens and a gate: a pen, fenced, 1 gate, 6 chickens', () => {
        const world = pen();
        const entities = {};
        for (let i = 0; i < 6; i++) entities[i + 1] = { name: 'chicken', type: 'animal', position: { x: 2.5 + i, y: 64, z: 3.5 } };
        const bot = { entity: { position: { x: 5.5, y: 64, z: 4.5 } }, entities, blockAt: (p) => world.blockAt(p) };
        const r = S.scanEnclosure(world.getBlockName, bot.entity.position);
        assert.equal(r.found, true, r.reason);
        const c = SE.countContents(bot, r.box);
        const kind = K.kindOf(r, c);
        assert.equal(kind, 'pen');
        assert.match(K.savedText('aviary', kind, r, c, r.box),
            /^I saved "aviary": a pen, fenced, \d+ x \d+, 1 gate, 6 chickens\. I keep its gate closed and pick nothing up inside it\.$/);
    });

    test('the walled house with a bed and 2 chests: a home, walled, with a roof, 1 door, 1 bed, 2 chests', () => {
        const world = house();
        const bot = { entity: { position: { x: 4.5, y: 64, z: 5.5 } }, entities: {}, blockAt: (p) => world.blockAt(p) };
        const r = S.scanEnclosure(world.getBlockName, bot.entity.position);
        assert.equal(r.found, true, r.reason);
        const c = SE.countContents(bot, r.box);
        const kind = K.kindOf(r, c);
        assert.equal(kind, 'home');
        assert.match(K.savedText('home', kind, r, c, r.box),
            /^I saved "home": a home, walled, \d+ x \d+ with a roof, 1 door, 1 bed, 2 chests\. I shelter there at night\.$/);
    });
});
