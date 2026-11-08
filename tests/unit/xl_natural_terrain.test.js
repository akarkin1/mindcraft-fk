// v0.1.4.14, fix round (engineer E4): the owner's first play on a new 26.1 world. The knowledge block said "You stand in
// a walled yard 7 x 7 with a roof and 1 gap that is not saved" while the bot stood among oak trees on a hillside: the
// trunks of the trees were walls, the leaves a hedge and a roof, and a crafting table and a torch the bot had placed
// among the trunks started the scan of a building. scanEnclosure of src/agent/areas/area_scan.js now counts no natural
// terrain as a wall or a roof (the logs of a tree, leaves of a crown, rock and dirt above ground), and a building above
// ground needs walls that are made for the most part. The base's house, pen, farm, hedge and the room in the rock stay.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld } from '../helpers/block_world.js';

const S = await loadSrc('src/agent/areas/area_scan.js');

// A wood on a hillside: oaks every 4 blocks around the origin (their crowns touch), a slope of dirt 2 and 3 high to the
// east and the north. The origin is a cell of grass among the trunks, under the crowns.
function wood() {
    const w = createBlockWorld().flatGround(63);
    for (let x = -12; x <= 12; x++) {
        for (let z = -12; z <= 12; z++) {
            if (x >= 6) w.fill(x, 64, z, x, x >= 9 ? 66 : 65, z, 'dirt');
            else if (z <= -6) w.fill(x, 64, z, x, z <= -9 ? 66 : 65, z, 'dirt');
        }
    }
    for (const x of [-8, -4, 0, 4]) {
        for (const z of [-4, 0, 4, 8]) {
            if (x === 0 && z === 0) continue;
            w.tree({ x, y: 63, z });
        }
    }
    return w;
}

// The place of the owner's log: a clearing of 7 x 7 among oaks on a hillside. Trunks every 2 blocks to the west, the north
// and the south with their low leaves between them, the slope of the hill (dirt 3 high) to the east, the crowns a canopy
// over the clearing.
function clearing() {
    const w = createBlockWorld().flatGround(63);
    const ring = [];
    for (let i = -1; i <= 7; i++) ring.push([i, -1], [i, 7]);
    for (let i = 0; i <= 6; i++) ring.push([-1, i], [7, i]);
    for (const [x, z] of ring) {
        if (x === 7) {
            w.fill(x, 64, z, x + 3, 66, z, 'dirt'); // the hill
        } else if ((x + z) % 2 === 0) {
            w.fill(x, 64, z, x, 68, z, 'oak_log'); // a trunk
        } else {
            w.fill(x, 64, z, x, 65, z, 'oak_leaves'); // low leaves between the trunks
        }
    }
    w.fill(-2, 69, -2, 8, 69, 8, 'oak_leaves'); // the canopy
    w.fill(-2, 70, -2, 8, 70, 8, 'oak_leaves');
    return w;
}

const inside = (r, p) => r.found && p.x >= r.box.min.x && p.x <= r.box.max.x + 1 && p.z >= r.box.min.z && p.z <= r.box.max.z + 1;

describe('natural terrain is no building and no yard', () => {
    test('among the trunks and under the crowns of a wood on a hillside: no enclosure, no roof', () => {
        const w = wood();
        for (const o of [{ x: 0.5, y: 64, z: 0.5 }, { x: 2.5, y: 64, z: 2.5 }, { x: -2.5, y: 64, z: 1.5 }, { x: 4.5, y: 64, z: -2.5 }]) {
            const r = S.scanEnclosure(w.getBlockName, o);
            assert.equal(inside(r, o), false, `${JSON.stringify(o)}: ${r.border} ${r.roof} ${r.source} ${JSON.stringify(r.box)}`);
        }
    });

    test('the clearing among oaks on a hillside (the owner\'s log): no yard, no roof', () => {
        const w = clearing();
        const o = { x: 3.5, y: 64, z: 3.5 };
        const r = S.scanEnclosure(w.getBlockName, o);
        assert.equal(inside(r, o), false, `${r.border} roof ${r.roof} ${r.source} ${JSON.stringify(r.box)}`);
    });

    test('a crafting table and a torch of the bot in the clearing start no building', () => {
        const w = clearing();
        w.set(1, 64, 1, 'crafting_table');
        w.set(5, 64, 1, 'torch');
        w.set(1, 64, 5, 'torch');
        const o = { x: 3.5, y: 64, z: 3.5 };
        const r = S.scanEnclosure(w.getBlockName, o);
        assert.equal(inside(r, o), false, `${r.border} roof ${r.roof} ${r.source} ${JSON.stringify(r.box)}`);
    });

    test('a crafting table and a torch of the bot among the trunks start no building', () => {
        const w = wood();
        w.set(1, 64, 0, 'crafting_table');
        w.set(-1, 64, 1, 'torch');
        w.set(1, 64, 3, 'torch');
        const o = { x: 0.5, y: 64, z: 1.5 };
        const r = S.scanEnclosure(w.getBlockName, o);
        assert.equal(inside(r, o), false, `${r.border} ${r.roof} ${r.source}`);
    });

    test('the house in the wood is still a home with walls and a roof; a pen under a crown is still a pen', () => {
        const w = wood();
        for (let x = -11; x <= -5; x++) for (let z = -11; z <= -5; z++) w.fill(x, 64, z, x, 70, z, 'air'); // a clearing
        const house = w.house({ x: -11, y: 63, z: -11, width: 7, depth: 7 });
        const h = S.scanEnclosure(w.getBlockName, { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 });
        assert.equal(h.found, true, h.reason);
        assert.equal(h.border, 'wall');
        assert.equal(h.roof, true);
        const p = createBlockWorld().flatGround(63);
        const pen = p.field({ x: 0, y: 63, z: 0, width: 5, depth: 5, ground: 'grass_block', crop: null });
        p.tree({ x: 2, y: 63, z: 7 }); // its crown hangs over the south part of the pen
        for (let x = 0; x <= 4; x++) for (let z = 0; z <= 4; z++) if (p.isAir(x, 67, z)) p.set(x, 67, z, 'oak_leaves');
        const r = S.scanEnclosure(p.getBlockName, { x: pen.inside.x + 0.5, y: pen.inside.y, z: pen.inside.z + 0.5 });
        assert.equal(r.found, true, r.reason);
        assert.equal(r.border, 'fence');
        assert.equal(r.roof, false, 'leaves over a pen are no roof');
        assert.equal(S.scanPen(p.getBlockName, { x: pen.inside.x + 0.5, y: pen.inside.y, z: pen.inside.z + 0.5 }).found, true);
    });

    test('a farm under the crown of a tree is a farm; under a ceiling of stone it is a room', () => {
        const f = createBlockWorld().flatGround(63);
        const field = f.field({ x: 0, y: 63, z: 0, width: 4, depth: 4 });
        f.fill(0, 67, 0, 3, 67, 3, 'oak_leaves');
        assert.equal(S.scanFarm(f.getBlockName, { x: field.inside.x + 0.5, y: 64, z: field.inside.z + 0.5 }).found, true, 'leaves');
        f.fill(0, 67, 0, 3, 67, 3, 'stone');
        assert.equal(S.scanFarm(f.getBlockName, { x: field.inside.x + 0.5, y: 64, z: field.inside.z + 0.5 }).found, false, 'stone');
    });

    test('a hedge of leaves planted on the grass is still a hedge; the trunks of trees are no wall, a log cabin is', () => {
        const w = createBlockWorld().flatGround(63);
        for (let x = -1; x <= 5; x++) for (const z of [-1, 5]) w.fill(x, 64, z, x, 65, z, 'oak_leaves');
        for (let z = 0; z <= 4; z++) for (const x of [-1, 5]) w.fill(x, 64, z, x, 65, z, 'oak_leaves');
        assert.equal(S.scanEnclosure(w.getBlockName, { x: 2.5, y: 64, z: 2.5 }).border, 'hedge');
        // a ring of trunks (logs of trees on the grass, 3 high) without leaves: no wall
        const t = createBlockWorld().flatGround(63);
        for (let x = -1; x <= 5; x++) for (const z of [-1, 5]) t.fill(x, 64, z, x, 66, z, 'oak_log');
        for (let z = 0; z <= 4; z++) for (const x of [-1, 5]) t.fill(x, 64, z, x, 66, z, 'oak_log');
        const ring = S.scanEnclosure(t.getBlockName, { x: 2.5, y: 64, z: 2.5 });
        assert.equal(ring.found, false, `${ring.border}`);
        // the same ring on a floor of planks, under a roof of planks: a log cabin, walled
        t.fill(-1, 63, -1, 5, 63, 5, 'oak_planks');
        t.fill(-1, 67, -1, 5, 67, 5, 'oak_planks');
        const cabin = S.scanEnclosure(t.getBlockName, { x: 2.5, y: 64, z: 2.5 });
        assert.equal(cabin.found, true, cabin.reason);
        assert.equal(cabin.border, 'wall');
        assert.equal(cabin.roof, true);
    });
});
