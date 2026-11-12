// Spec v0.1.4.16, F2 (engineer E2): the clusters of the survey. clustersOf groups the finds by connectivity with the gap
// (x/z distance between boxes edge to edge, 0 inside, or points); survey.js saves the cluster the bot stands in and reports
// every other one after `All saved.` as `I left out N places about D blocks <dir> (another base or a village): not
// saved; survey it from there for its own name`; the setting survey_cluster_gap (48) is the gap.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const L = await loadSrc('src/agent/packs/survey/survey_logic.js');
const T = await loadSrc('src/agent/packs/survey/texts.js');
const S = await loadSrc('src/agent/packs/survey/survey.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const PS = await loadSrc('src/agent/world/place_store.js');
const MB = await loadSrc('src/agent/memory_bank.js');
const BS = await loadSrc('src/agent/world/base_store.js');
const SETTINGS = (await loadSrc('settings.js')).default;

const box = (x1, z1, x2, z2, y = 60) => ({ box: { min: { x: x1, y, z: z1 }, max: { x: x2, y: y + 5, z: z2 } } });
const point = (x, z, y = 60) => ({ at: { x, y, z } });

describe('xzDistance: edge to edge in x and z, 0 inside', () => {
    test('boxes, points, a box and a point, a kept entry', () => {
        assert.equal(L.xzDistance(box(0, 0, 8, 8), box(12, 0, 20, 8)), 4, 'the difference of the coordinates, as for points');
        assert.equal(L.xzDistance(box(0, 0, 8, 8), box(4, 4, 6, 6)), 0, 'inside');
        assert.equal(L.xzDistance(box(0, 0, 8, 8), box(8, 0, 12, 8)), 0, 'a shared column');
        assert.equal(L.xzDistance(box(0, 0, 8, 8), box(9, 0, 12, 8)), 1, 'side by side');
        assert.equal(L.xzDistance(point(0, 0), point(30, 40)), 50);
        assert.equal(L.xzDistance(box(0, 0, 8, 8), point(8, 108)), 100);
        assert.equal(L.xzDistance(box(0, 0, 8, 8), { x: 11, y: 90, z: 12 }), 5, 'the y is not counted');
        assert.equal(L.xzDistance({ name: 'k', inside: 'yard', place: box(100, 0, 104, 4) }, point(0, 0)), 100);
        assert.equal(L.xzDistance({}, point(0, 0)), Infinity);
    });
});

describe('clustersOf (F2)', () => {
    test('two clusters 100 blocks apart; one cluster within the gap; the order of the first find', () => {
        const house = { name: 'house', ...box(0, 0, 8, 8) };
        const farm = { name: 'potato_farm', ...box(12, 2, 20, 6) };
        const pen = { name: 'cow_pen', ...box(25, 1, 29, 5) };
        const mine = { name: 'mine_entrance', ...point(8, 3, 54) };
        const v1 = { name: 'house_2', ...box(0, 100, 8, 108) };
        const v2 = { name: 'house_3', ...box(12, 100, 18, 106) };
        const hall = { name: 'trading_hall', ...point(10, 112) };
        const clusters = L.clustersOf([house, v1, farm, v2, pen, hall, mine], 48);
        assert.deepEqual(clusters.map(c => c.map(f => f.name)), [['house', 'farm', 'cow_pen', 'mine_entrance'].map(n => (n === 'farm' ? 'potato_farm' : n)), ['house_2', 'house_3', 'trading_hall']]);
        assert.equal(clusters[0][0], house, 'the finds themselves, not copies');
        assert.equal(L.clustersOf([house, farm, pen, mine, v1, v2, hall], 100).length, 1, 'a wider gap joins them');
        assert.equal(L.clustersOf([house, v1], 48).length, 2);
        assert.equal(L.clustersOf([house, { name: 'bridge', ...box(0, 40, 2, 60) }, v1], 48).length, 1, 'connected through a third find');
    });

    test('the gap: 48 without a number, 0 keeps only touching finds together; nothing and junk give no cluster', () => {
        const a = box(0, 0, 8, 8);
        const b = box(20, 0, 28, 8);
        assert.equal(L.CLUSTER_GAP, 48);
        assert.equal(L.clustersOf([a, b]).length, 1);
        assert.equal(L.clustersOf([a, b], 'x').length, 1);
        assert.equal(L.clustersOf([a, b], 12).length, 1, '12 apart: the coordinates 8 and 20');
        assert.equal(L.clustersOf([a, b], 11).length, 2);
        assert.equal(L.clustersOf([a, b], 0).length, 2);
        assert.equal(L.clustersOf([a, box(8, 0, 12, 8)], 0).length, 1);
        assert.deepEqual(L.clustersOf([]), []);
        assert.deepEqual(L.clustersOf(null), []);
        assert.equal(L.clustersOf([a, null, 7, {}], 48).length, 2, 'a find without a position is a cluster of its own');
    });
});

describe('startClusterOf, directionOf, leftOutOf (F2)', () => {
    const base = [box(0, 0, 8, 8), box(12, 2, 20, 6)];
    const village = [box(0, 100, 8, 108), point(10, 112)];

    test('the cluster whose find holds the bot, else the nearest one', () => {
        assert.equal(L.startClusterOf([village, base], { x: 4.5, y: 61, z: 4.5 }), 1, 'inside the house');
        assert.equal(L.startClusterOf([village, base], { x: 30, y: 61, z: 4 }), 1, 'nearest');
        assert.equal(L.startClusterOf([village, base], { x: 5, y: 61, z: 95 }), 0);
        assert.equal(L.startClusterOf([village, base], { x: 4, y: 90, z: 4 }), 1, 'over the house: the nearest in x and z');
        assert.equal(L.startClusterOf([], { x: 0, y: 0, z: 0 }), -1);
        assert.equal(L.startClusterOf([village, base], null), 0);
    });

    test('the eight directions: north is -z, east is +x', () => {
        const from = { x: 0, z: 0 };
        assert.equal(L.directionOf(from, { x: 0, z: -100 }), 'north');
        assert.equal(L.directionOf(from, { x: 0, z: 100 }), 'south');
        assert.equal(L.directionOf(from, { x: 100, z: 0 }), 'east');
        assert.equal(L.directionOf(from, { x: -100, z: 0 }), 'west');
        assert.equal(L.directionOf(from, { x: 100, z: -100 }), 'north-east');
        assert.equal(L.directionOf(from, { x: -100, z: -100 }), 'north-west');
        assert.equal(L.directionOf(from, { x: 100, z: 100 }), 'south-east');
        assert.equal(L.directionOf(from, { x: -100, z: 100 }), 'south-west');
        assert.equal(L.directionOf(from, { x: 10, z: 100 }), 'south', 'a few degrees off stay in the sector');
        assert.equal(L.directionOf(from, from), 'north');
        assert.deepEqual(L.DIRECTIONS, ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']);
    });

    test('leftOutOf: the count, the distance to the nearest find rounded to 10, the direction', () => {
        const left = L.leftOutOf(village, { x: 4.5, y: 61, z: 4.5 });
        assert.deepEqual({ count: left.count, distance: left.distance, dir: left.dir }, { count: 2, distance: 100, dir: 'south' });
        assert.equal(left.finds, village);
        assert.deepEqual(L.leftOutOf([point(-77, 3)], { x: 0, y: 60, z: 0 }).distance, 80);
        assert.deepEqual(L.leftOutOf([point(-77, 3)], { x: 0, y: 60, z: 0 }).dir, 'west');
        assert.deepEqual(L.leftOutOf([], { x: 0, y: 60, z: 0 }), { count: 0, distance: 0, dir: 'north', finds: [] });
    });
});

describe('the left-out sentence (F2), word for word', () => {
    test('leftOutItem and leftOutText', () => {
        assert.equal(T.leftOutItem({ count: 3, distance: 100, dir: 'south' }),
            '3 places about 100 blocks south (another base or a village): not saved; survey it from there for its own name');
        assert.equal(T.leftOutText([{ count: 3, distance: 100, dir: 'south' }, { count: 1, distance: 60, dir: 'north-west' }]),
            'I left out 3 places about 100 blocks south (another base or a village): not saved; survey it from there for its own name; '
            + '1 places about 60 blocks north-west (another base or a village): not saved; survey it from there for its own name.');
        assert.equal(T.leftOutText([]), '');
        assert.equal(T.leftOutText(null), '');
    });

    test('reportText takes the clusters as its fourth argument, after All saved.', () => {
        const C = (more = {}) => ({ animals: {}, crops: {}, beds: 0, chests: 0, furnaces: 0, tables: 0, ladders: 0, water: 0, ...more });
        const house = { kind: 'home', name: 'house', type: 'home', box: box(0, 0, 8, 8).box, at: null, entrances: [], contents: C({ beds: 1 }), border: 'wall', source: 'survey', detail: {} };
        assert.equal(T.reportText([house], [], [], [{ count: 3, distance: 100, dir: 'south' }]),
            'I found 1 place: house (1 bed). All saved. I left out 3 places about 100 blocks south (another base or a village): not saved; '
            + 'survey it from there for its own name. Say "rename X to Y" or "forget X" to correct.');
        assert.equal(T.reportText([house], [], []), 'I found 1 place: house (1 bed). All saved. Say "rename X to Y" or "forget X" to correct.');
    });
});

// --- the survey over two clusters (the base of xs_survey_wiring and a village 100 blocks south) -------------------------------

const NAMES = [...new Set([...Object.values(L.SEED_NAMES).flat(), 'air', 'stone', 'dirt', 'grass_block', 'oak_planks', 'water', 'oak_fence'])];
const registry = { blocksByName: Object.fromEntries(NAMES.map((name, i) => [name, { id: i + 1, name }])) };
const idOf = (name) => registry.blocksByName[name]?.id ?? null;

// A house of planks, floor y 60, its door on the north side, a bed inside.
function house(w, x, z) {
    w.fill(x, 60, z, x + 8, 65, z + 8, 'oak_planks');
    w.fill(x + 1, 61, z + 1, x + 7, 64, z + 7, 'air');
    w.set(x + 4, 61, z, 'oak_door', { half: 'lower', open: false }).set(x + 4, 62, z, 'oak_door', { half: 'upper', open: false });
    w.set(x + 6, 61, z + 6, 'red_bed', { part: 'head' }).set(x + 5, 61, z + 6, 'red_bed', { part: 'foot' });
}

// The base (the house at the origin, a potato field east of it) and a village of two houses 100 blocks south.
function world(options = {}) {
    const w = createBlockWorld();
    w.fill(-40, 20, -40, 60, 58, 160, 'stone');
    w.fill(-40, 59, -40, 60, 59, 160, 'grass_block');
    house(w, 0, 0);
    w.fill(12, 59, 2, 20, 59, 6, 'farmland');
    w.fill(12, 60, 2, 20, 60, 6, 'potatoes');
    if (options.village !== false) {
        house(w, 0, 100);
        house(w, 14, 100);
    }
    return w;
}

function fakeBot(w, at = { x: 4.5, y: 61, z: 4.5 }) {
    const bot = {
        registry, entity: { position: vec(at.x, at.y, at.z) }, entities: {}, game: { dimension: 'overworld' }, interrupt_code: false,
        blockAt: (pos) => w.blockAt(pos),
        findBlocks({ matching, maxDistance, count }) {
            const ids = new Set(matching);
            const me = bot.entity.position;
            return w.positionsOf((name) => ids.has(idOf(name))).map((p) => ({ p, d: Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) }))
                .filter(({ d }) => d <= maxDistance).sort((a, b) => a.d - b.d).slice(0, count).map(({ p }) => vec(p.x, p.y, p.z));
        },
    };
    return bot;
}

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

function stores(settings = {}) {
    const areas = new AS.AreaStore(path.join(dir, 'areas.json'));
    areas.load();
    const placeStore = new PS.PlaceStore(path.join(dir, 'places.json'));
    placeStore.load();
    const places = new MB.MemoryBank();
    places.attachStore(placeStore, () => 'overworld');
    const bases = new BS.BaseStore(path.join(dir, 'bases.json'));
    bases.load();
    const said = [];
    const ctx = { areas, places, bases, settings: { survey_radius: 128, ...settings }, now: () => 0, log: () => {}, say: (t) => said.push(t), routes: null, said };
    return { ctx, areas, places, bases, said };
}

const clock = { now: () => 0, wait: async () => {} };

describe('surveyBase with two clusters (F2)', () => {
    test('the cluster of the start is saved, the village is reported word for word and not saved', async () => {
        const { ctx, areas, bases, said } = stores();
        const r = await S.surveyBase(fakeBot(world()), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(areas.list().map(a => a.name), ['house', 'potato_farm']);
        assert.deepEqual([...bases.get('east').places].sort(), ['house', 'potato_farm']);
        assert.deepEqual(bases.get('east').door, { x: 4, y: 61, z: 0 });
        assert.equal(said.length, 1);
        assert.equal(said[0], 'I found 2 places: house (1 bed), potato farm 9 x 5. All saved. I left out 2 places about 100 blocks south (another base or a village): '
            + 'not saved; survey it from there for its own name. Say "rename X to Y" or "forget X" to correct.');
        assert.equal(r.said, said[0]);
        assert.equal(r.text, 'Done; I said it in the chat.');
        assert.deepEqual(r.leftOut.map(c => ({ count: c.count, distance: c.distance, dir: c.dir })), [{ count: 2, distance: 100, dir: 'south' }]);
    });

    test('from the village the village is the base and the house of the start is reported', async () => {
        const { ctx, areas, said } = stores();
        const r = await S.surveyBase(fakeBot(world(), { x: 4.5, y: 61, z: 104.5 }), ctx, 'village', clock);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(areas.list().map(a => a.name), ['house', 'house_2'], 'the names as if the base of the start were not there');
        assert.ok(said[0].startsWith('I found 2 places: house (1 bed), house 2 (1 bed). All saved. I left out 2 places about 100 blocks north (another base or a village): not saved; survey it from there for its own name. Say '), said[0]);
        assert.deepEqual(areas.list().map(a => a.kind), ['home', 'building'], 'one home: the house nearest the start; the other a building (F2)');
    });

    test('the gap setting: survey_cluster_gap 120 joins the village to the base; the default is 48', async () => {
        const { ctx, areas, said } = stores({ survey_cluster_gap: 120 });
        const r = await S.surveyBase(fakeBot(world()), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(areas.list().map(a => a.name), ['house', 'house_2', 'house_3', 'potato_farm']);
        assert.ok(!said[0].includes('I left out'), said[0]);
        assert.equal(S.clusterGap({}), 48);
        assert.equal(S.clusterGap({ survey_cluster_gap: 120 }), 120);
        assert.equal(S.clusterGap({ survey_cluster_gap: -1 }), 48);
        assert.equal(S.clusterGap({ survey_cluster_gap: 'x' }), 48);
        assert.equal(S.SURVEY_RULES.clusterGap, 48);
        assert.equal(SETTINGS.survey_cluster_gap, 48, 'settings.js has the setting with its default');
    });

    test('without a village nothing is left out and the report is as before', async () => {
        const { ctx, said } = stores();
        const r = await S.surveyBase(fakeBot(world({ village: false })), ctx, 'east', clock);
        assert.equal(r.ok, true, r.text);
        assert.equal(said[0], 'I found 2 places: house (1 bed), potato farm 9 x 5. All saved. Say "rename X to Y" or "forget X" to correct.');
        assert.deepEqual(r.leftOut, []);
    });

    test('a re-survey: a former place of this base that lies in another cluster now is forgotten and left out', async () => {
        const { ctx, areas, bases, said } = stores({ survey_cluster_gap: 120 });
        const bot = fakeBot(world());
        await S.surveyBase(bot, ctx, 'east', clock);
        assert.deepEqual([...bases.get('east').places].sort(), ['house', 'house_2', 'house_3', 'potato_farm']);
        ctx.settings.survey_cluster_gap = 48;
        const again = await S.surveyBase(bot, ctx, 'east', clock);
        assert.equal(again.ok, true, again.text);
        assert.deepEqual(areas.list().map(a => a.name), ['house', 'potato_farm'], 'the village houses are forgotten');
        assert.deepEqual([...bases.get('east').places].sort(), ['house', 'potato_farm']);
        assert.equal(said[1], 'I surveyed "east" again: nothing changed. I left out 2 places about 100 blocks south (another base or a village): not saved; survey it from there for its own name.');
    });
});
