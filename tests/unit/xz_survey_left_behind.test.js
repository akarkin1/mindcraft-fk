// FX1, review of v0.1.4.16, finding 7 (the lead's decision): a re-survey deleted the base's saved places that now lie in
// another cluster (survey.js: the left-behind finds went to removeArea/removePoint, and a place of an outlying part that the
// survey does not see again, such as the cave mouth under a house there, was judged gone and deleted), with their renames and
// their flags (no_enter on a cave mouth). Now a re-survey never deletes an area or a place because it lies in another cluster:
// it only takes it out of this base's `places` list and says nothing more of it; the stores keep it, its rename and its flags.
// A place of the start's cluster whose seeds are gone is still forgotten (F2, 2.4). The world and the stores are those of
// xv_clusters (the house at the origin, a potato field east of it, a village of two houses 100 blocks south).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const L = await loadSrc('src/agent/packs/survey/survey_logic.js');
const S = await loadSrc('src/agent/packs/survey/survey.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const PS = await loadSrc('src/agent/world/place_store.js');
const MB = await loadSrc('src/agent/memory_bank.js');
const BS = await loadSrc('src/agent/world/base_store.js');

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

function world({ village = true } = {}) {
    const w = createBlockWorld();
    w.fill(-40, 20, -40, 60, 58, 160, 'stone');
    w.fill(-40, 59, -40, 60, 59, 160, 'grass_block');
    house(w, 0, 0);
    w.fill(12, 59, 2, 20, 59, 6, 'farmland');
    w.fill(12, 60, 2, 20, 60, 6, 'potatoes');
    if (village) {
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

// The cave mouth of the survey (underground_logic's caveMouthArea): a yard of type building, the opening's cell grown by 1, the
// flag no_enter, under the basement it opens from; here 62 blocks south of the house (its box ends at z 8), in the rock.
const CAVE_MOUTH = { name: 'cave_mouth', kind: 'yard', type: 'building', min: { x: 3, y: 49, z: 69 }, max: { x: 5, y: 51, z: 71 },
    dimension: 'overworld', entrances: [], source: 'survey', flags: { no_enter: true }, under: 'basement', edge: 'wall' };

// A base saved with an outlying part, as a survey of v0.1.4.15 (no clusters) left it: the survey of the house and the field,
// then the cave mouth of the outlying part saved into the same base.
async function savedWithCaveMouth(ctx, areas, bases, bot) {
    await S.surveyBase(bot, ctx, 'east', clock);
    areas.set({ ...CAVE_MOUTH, base: 'east' });
    bases.set({ ...bases.get('east'), places: [...bases.get('east').places, 'cave_mouth'] });
}

describe('a re-survey never deletes a place that lies in another cluster now (review 16, finding 7)', () => {
    test('the lead\'s case: an outlying cave mouth (no_enter) 62 blocks off stays in the store with its flag; it leaves the base\'s list; nothing said', async () => {
        const { ctx, areas, bases, said } = stores();
        const bot = fakeBot(world({ village: false }));
        await savedWithCaveMouth(ctx, areas, bases, bot);
        assert.ok(L.xzDistance(CAVE_MOUTH, areas.get('house')) > 48, 'more than the gap from the house');
        const again = await S.surveyBase(bot, ctx, 'east', clock);
        assert.equal(again.ok, true, again.text);
        const cave = areas.get('cave_mouth');
        assert.ok(cave, 'the cave mouth is still in the store');
        assert.deepEqual(cave.flags, { no_enter: true }, 'with its flag');
        assert.equal(cave.base, 'east', 'untouched');
        assert.deepEqual([...bases.get('east').places].sort(), ['house', 'potato_farm'], 'out of the base\'s places');
        assert.equal(said[1], 'I surveyed "east" again: nothing changed.', 'it is not reported gone');
        assert.deepEqual(again.changed.gone, []);
    });

    test('the village found again in another cluster: its houses stay in the store, renamed or not; only the base\'s list loses them', async () => {
        const { ctx, areas, bases, said } = stores({ survey_cluster_gap: 120 });
        const bot = fakeBot(world());
        await S.surveyBase(bot, ctx, 'east', clock);
        assert.deepEqual([...bases.get('east').places].sort(), ['house', 'house_2', 'house_3', 'potato_farm']);
        S.renameArea(ctx, 'house_2', 'smithy');
        ctx.settings.survey_cluster_gap = 48;
        const again = await S.surveyBase(bot, ctx, 'east', clock);
        assert.equal(again.ok, true, again.text);
        assert.deepEqual(areas.list().map(a => a.name).sort(), ['house', 'house_3', 'potato_farm', 'smithy'], 'nothing deleted');
        assert.equal(areas.get('smithy').base, 'east');
        assert.deepEqual([...bases.get('east').places].sort(), ['house', 'potato_farm']);
        assert.equal(said.at(-1), 'I surveyed "east" again: nothing changed. I left out 2 places about 100 blocks south (another base or a village): not saved; survey it from there for its own name.');
    });

    test('surveyed again from the outlying part: the house\'s cluster leaves the list and stays in the store', async () => {
        const { ctx, areas, bases } = stores({ survey_cluster_gap: 120 });
        const w = world();
        await S.surveyBase(fakeBot(w), ctx, 'east', clock);
        const again = await S.surveyBase(fakeBot(w, { x: 4.5, y: 61, z: 104.5 }), { ...ctx, settings: { ...ctx.settings, survey_cluster_gap: 48 } }, 'east', clock);
        assert.equal(again.ok, true, again.text);
        for (const name of ['house', 'potato_farm', 'house_2', 'house_3']) assert.ok(areas.get(name), `${name} is still in the store`);
        assert.deepEqual([...bases.get('east').places].sort(), ['house_2', 'house_3']);
    });

    test('a place of the start\'s cluster whose seeds are gone is still forgotten (F2, 2.4)', async () => {
        const { ctx, areas, bases, said } = stores();
        const w = world({ village: false });
        const bot = fakeBot(w);
        await S.surveyBase(bot, ctx, 'east', clock);
        w.fill(12, 59, 2, 20, 59, 6, 'grass_block');
        w.fill(12, 60, 2, 20, 60, 6, 'air');
        const again = await S.surveyBase(bot, ctx, 'east', clock);
        assert.equal(again.ok, true, again.text);
        assert.equal(areas.get('potato_farm'), undefined);
        assert.deepEqual([...bases.get('east').places], ['house']);
        assert.equal(said[1], 'I surveyed "east" again: the potato farm is gone. The rest as saved.');
    });
});
