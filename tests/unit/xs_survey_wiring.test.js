// Spec v0.1.4.15, S 2.1, 2.4, 2.5 (E4): survey.js on a fake bot with a fake findBlocks over a synthetic base. The seeds pass (one
// read per category with the ids of SEED_NAMES from the registry, within min(survey_radius, 128), a yield after each), the
// slices, the saves through real stores in a temp folder (areas with source survey and the base, the basement under the house,
// the keep-out cave mouth, the mine entrance as a place, the route with the trapdoor and the ladder legs, bases.json), the
// report word for word, the difference line of a second survey, the owner's area kept, !renameArea, !forgetArea of a base,
// !goToBase, nothing found, the interrupt, and the ore guard.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const S = await loadSrc('src/agent/packs/survey/survey.js');
const L = await loadSrc('src/agent/packs/survey/survey_logic.js');
const AS = await loadSrc('src/agent/areas/area_store.js');
const PS = await loadSrc('src/agent/world/place_store.js');
const MB = await loadSrc('src/agent/memory_bank.js');
const RS = await loadSrc('src/agent/packs/routes/route_store.js');
const BS = await loadSrc('src/agent/world/base_store.js');
const SCAN = await loadSrc('src/agent/areas/area_scan.js');
const ML = await loadSrc('src/agent/packs/mining/mine_logic.js');

// as agent.js does with mining_pack on: the measure of a tunnel for the scans of the areas
SCAN.useTunnelMeasure(ML.tunnelAt);

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);

// The names of the world and of SEED_NAMES get ids by name (no numeric id in the code; the test's registry is its own).
const NAMES = [...new Set([...Object.values(L.SEED_NAMES).flat(), 'air', 'stone', 'dirt', 'grass_block', 'oak_planks', 'oak_log', 'water', 'iron_ore',
    'deepslate_iron_ore', 'oak_fence', 'glass_pane', 'torch'])];
const registry = { blocksByName: Object.fromEntries(NAMES.map((name, i) => [name, { id: i + 1, name }])) };
const idOf = (name) => registry.blocksByName[name]?.id ?? null;

// The synthetic base: the house (floor y 60, door (4, 61, 0), a bed), the basement dug under it (y 54..57, a chest, a
// furnace, the ladder of 6 under the trapdoor (1, 60, 4)), the tunnel east (x 8..19, y 54..55, z 3..4), the cave north; an
// unfenced potato field 9 x 5 beside the house (x 12..20, z 2..6, farmland at y 59); a fenced pen 5 x 5 with 5 cows (x 25..29,
// z 1..5, its gate on the west side).
function base(options = {}) {
    const w = createBlockWorld();
    w.fill(-40, 20, -40, 60, 58, 60, 'stone');
    w.fill(-40, 59, -40, 60, 59, 60, 'grass_block');
    if (options.ore) {
        w.fill(-2, 48, -2, 10, 58, 10, 'iron_ore');
    }
    w.fill(0, 60, 0, 8, 65, 8, 'oak_planks');
    w.fill(1, 61, 1, 7, 64, 7, 'air');
    w.set(4, 61, 0, 'oak_door', { half: 'lower', open: false }).set(4, 62, 0, 'oak_door', { half: 'upper', open: false });
    w.set(6, 61, 6, 'red_bed', { part: 'head' }).set(5, 61, 6, 'red_bed', { part: 'foot' });
    w.fill(1, 54, 1, 7, 57, 7, 'air');
    w.fill(1, 54, 4, 1, 59, 4, 'ladder', { facing: 'east' });
    w.set(1, 60, 4, 'oak_trapdoor', { open: false });
    w.set(6, 54, 6, 'chest').set(6, 54, 5, 'furnace');
    w.fill(8, 54, 3, 19, 55, 4, 'air');
    w.fill(5, 54, -2, 6, 55, 0, 'air');
    w.fill(3, 54, -8, 7, 57, -3, 'air');
    if (options.farm !== false) {
        w.fill(12, 59, 2, 20, 59, 6, 'farmland');
        w.fill(12, 60, 2, 20, 60, 6, 'potatoes');
    }
    if (options.pen !== false) {
        w.field({ x: 25, y: 59, z: 1, width: 5, depth: 5, ground: 'grass_block', crop: null, gateSide: 'west' });
    }
    return w;
}

function cows(n, from = 60) {
    const out = {};
    for (let i = 0; i < n; i++) {
        out[from + i] = { id: from + i, name: 'cow', type: 'animal', position: vec(26.5 + (i % 3), 60, 2.5 + Math.floor(i / 3)) };
    }
    return out;
}

// A fake bot over the world: blockAt and findBlocks (the loaded blocks within maxDistance by the ids given), its entities.
function fakeBot(world, options = {}) {
    const at = options.at ?? { x: 4.5, y: 61, z: 4.5 };
    const calls = [];
    const bot = {
        registry,
        entity: { position: vec(at.x, at.y, at.z) },
        entities: { ...(options.entities ?? cows(5)) },
        game: { dimension: 'overworld' },
        interrupt_code: false,
        blockAt: (pos) => world.blockAt(pos),
        findBlocks({ matching, maxDistance, count }) {
            calls.push({ matching: [...matching], maxDistance, count });
            const ids = new Set(matching);
            const me = bot.entity.position;
            return world.positionsOf((name) => ids.has(idOf(name)))
                .map((p) => ({ p, d: Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) }))
                .filter(({ d }) => d <= maxDistance)
                .sort((a, b) => a.d - b.d)
                .slice(0, count)
                .map(({ p }) => vec(p.x, p.y, p.z));
        },
        calls,
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

// The real stores in the temp folder, as the agent gives them to the packs through ctx.
function stores(options = {}) {
    const areas = new AS.AreaStore(path.join(dir, 'areas.json'), { now: () => new Date(T0) });
    areas.load();
    const placeStore = new PS.PlaceStore(path.join(dir, 'places.json'), { now: () => new Date(T0) });
    placeStore.load();
    const places = new MB.MemoryBank();
    places.attachStore(placeStore, () => 'overworld');
    const routeStore = new RS.RouteStore(path.join(dir, 'routes.json'), { now: () => new Date(T0) });
    routeStore.load();
    const bases = new BS.BaseStore(path.join(dir, 'bases.json'), { now: () => new Date(T0) });
    bases.load();
    const logs = [];
    const said = []; // v0.1.4.16 (F2): the lines the bot says itself through ctx.say
    const ctx = {
        areas, places, bases, settings: { survey_radius: 64, ...(options.settings ?? {}) }, now: () => T0, log: (t) => logs.push(t), say: (t) => said.push(t),
        world: { getVillagerProfession: () => 'Farmer L2' },
        routes: { store: routeStore, walkTo: options.walkTo ?? (async () => ({ ok: false, reason: 'no_route', text: '' })) },
        logs, said,
    };
    return { ctx, areas, placeStore, places, routeStore, bases, said };
}

// v0.1.4.16 (F2): the result of a command the bot says itself: the line is said once and the model gets the short answer.
const SAID = 'Done; I said it in the chat.';

const clock = () => {
    const c = { waits: 0, now: () => T0, wait: async () => { c.waits++; } };
    return c;
};

const REPORT = 'I found 6 places: house (1 bed), basement (1 chest, 1 furnace), potato farm 9 x 5, cow pen (5 cows), a mine entrance at (8, 54, 3), '
    + 'a cave mouth at (5, 54, 0) that I keep out of. All saved. Say "rename X to Y" or "forget X" to correct.';

describe('surveyBase: the seeds pass (2.1)', () => {
    test('one findBlocks per category with the ids of SEED_NAMES, within min(survey_radius, 128), 20000 at most; a yield after each', async () => {
        const w = base();
        const bot = fakeBot(w);
        const { ctx } = stores();
        const c = clock();
        const r = await S.surveyBase(bot, ctx, 'east', c);
        assert.equal(r.ok, true, r.text);
        assert.equal(bot.calls.length, L.SEED_CATEGORIES.length);
        for (const [i, category] of L.SEED_CATEGORIES.entries()) {
            const expected = [...new Set(L.SEED_NAMES[category].map(idOf).filter(Number.isInteger))];
            assert.deepEqual(bot.calls[i].matching, expected, category);
            assert.equal(bot.calls[i].maxDistance, 64);
            assert.equal(bot.calls[i].count, 20000);
        }
        assert.ok(c.waits >= L.SEED_CATEGORIES.length + 2, `${c.waits} yields: the categories, the places, each building`);
        assert.equal(r.radius, 64);
    });

    test('the radius is capped at 128 and 128 without a number', () => {
        assert.equal(S.surveyRadius({ survey_radius: 500 }), 128);
        assert.equal(S.surveyRadius({ survey_radius: 40.7 }), 40);
        assert.equal(S.surveyRadius({}), 128);
        assert.equal(S.surveyRadius({ survey_radius: 0 }), 128);
        assert.equal(S.surveyRadius(null), 128);
    });

    test('an interrupt between the slices ends the survey with nothing saved', async () => {
        const w = base();
        const bot = fakeBot(w);
        bot.interrupt_code = true;
        const { ctx, areas } = stores();
        const r = await S.surveyBase(bot, ctx, 'east', clock());
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(areas.size, 0);
    });
});

describe('surveyBase: the saves and the report (2.4, 2.5)', () => {
    test('the report word for word, and every place saved at once with source survey and the base', async () => {
        const w = base();
        const bot = fakeBot(w);
        const { ctx, areas, places, routeStore, bases, said } = stores();
        const r = await S.surveyBase(bot, ctx, 'east', clock());
        // v0.1.4.16 (F2): the report is the bot's own line (ctx.say), the answer to the model the short one
        assert.equal(r.said, REPORT);
        assert.deepEqual(said, [REPORT]);
        assert.equal(r.text, SAID);
        assert.equal(S.SAID_TEXT, SAID);
        assert.equal(r.ok, true);
        assert.deepEqual(areas.list().map(a => a.name), ['basement', 'cave_mouth', 'cow_pen', 'house', 'potato_farm']);
        for (const a of areas.list()) {
            assert.equal(a.source, 'survey', a.name);
            assert.equal(a.base, 'east', a.name);
        }
        const house = areas.get('house');
        assert.equal(house.type, 'home');
        assert.equal(house.kind, 'home');
        assert.ok(house.entrances.some(e => e.kind === 'door' && e.x === 4 && e.y === 61 && e.z === 0), JSON.stringify(house.entrances));
        const basement = areas.get('basement');
        assert.equal(basement.type, 'building');
        assert.equal(basement.under, 'house');
        assert.deepEqual({ min: basement.min, max: basement.max }, { min: { x: 0, y: 53, z: 0 }, max: { x: 8, y: 58, z: 8 } });
        assert.ok(basement.entrances.some(e => e.kind === 'trapdoor' && e.x === 1 && e.y === 60 && e.z === 4));
        assert.equal(AS.isShelterType(basement.type, basement), true, 'the basement counts as shelter');
        const farm = areas.get('potato_farm');
        assert.equal(farm.type, 'farm');
        assert.equal(farm.border, 'open');
        assert.equal(farm.contents.crops.potatoes, 45);
        const pen = areas.get('cow_pen');
        assert.equal(pen.type, 'pen');
        assert.equal(pen.contents.animals.cow, 5);
        const cave = areas.get('cave_mouth');
        assert.equal(cave.type, 'building');
        assert.deepEqual(cave.flags, { no_enter: true });
        assert.deepEqual({ min: cave.min, max: cave.max }, { min: { x: 4, y: 53, z: -1 }, max: { x: 6, y: 55, z: 1 } });
        assert.deepEqual(places.recallPlaceInfo('mine_entrance'), { x: 8, y: 54, z: 3, dimension: 'overworld', base: 'east' });
        const route = routeStore.get('house_to_mine_entrance', 'overworld');
        assert.ok(route, 'the route house to mine entrance');
        assert.deepEqual(route.legs.map(l => l.kind + (l.kind2 ? `:${l.kind2}` : '')), ['walk', 'door:trapdoor', 'ladder', 'walk']);
        assert.equal(route.legs[2].face, 'east', 'the facing of the ladder blocks from the world');
        assert.equal(route.source, 'survey');
        assert.deepEqual(route.from, { name: 'house', kind: 'area', x: 4, y: 61, z: 0 });
        assert.ok(routeStore.get('house_to_cave_mouth', 'overworld'));
        const east = bases.get('east');
        assert.deepEqual(east.door, { x: 4, y: 61, z: 0 });
        assert.equal(east.dimension, 'overworld');
        assert.deepEqual([...east.places].sort(), ['basement', 'cave_mouth', 'cow_pen', 'house', 'mine_entrance', 'potato_farm']);
        assert.deepEqual(east.kept, [], 'v0.1.4.16 (F2): no area of the owner in the base');
        assert.deepEqual(r.leftOut, [], 'one cluster');
        assert.equal(east.surveyed, new Date(T0).toISOString());
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'bases.json'), 'utf8')).bases.east.name, 'east');
        assert.deepEqual(r.places.map(p => p.name).sort(), east.places.slice().sort());
    });

    test('a route of the name is never replaced', async () => {
        const w = base();
        const { ctx, routeStore } = stores();
        routeStore.set({ name: 'house_to_mine_entrance', dimension: 'overworld', from: { name: 'house', kind: 'area', x: 4, y: 61, z: 0 },
            to: { name: 'mine_entrance', x: 8, y: 54, z: 3 }, legs: [{ kind: 'walk', from: { x: 4, y: 61, z: 0 }, to: { x: 8, y: 54, z: 3 } }], source: 'trail' });
        await S.surveyBase(fakeBot(w), ctx, 'east', clock());
        const route = routeStore.get('house_to_mine_entrance', 'overworld');
        assert.equal(route.legs.length, 1);
        assert.equal(route.source, 'trail');
    });

    test('the name defaults to "base", then "base_2" when "base" is taken', async () => {
        const w = base();
        const { ctx, bases } = stores();
        const first = await S.surveyBase(fakeBot(w), ctx, '', clock());
        assert.equal(first.base.name, 'base');
        const second = await S.surveyBase(fakeBot(w), ctx, '', clock());
        assert.equal(second.base.name, 'base_2');
        assert.deepEqual(bases.list().map(b => b.name), ['base', 'base_2']);
    });

    test('a tied animal: its place at the knot and the one sentence after the report', async () => {
        const w = base();
        w.set(30, 60, 10, 'oak_fence');
        const entities = { ...cows(5), 90: { id: 90, name: 'leash_knot', type: 'other', position: vec(30.5, 61, 10.5) },
            91: { id: 91, name: 'happy_ghast', type: 'mob', position: vec(31.5, 63, 12.5) } };
        const { ctx, places } = stores();
        const r = await S.surveyBase(fakeBot(w, { entities }), ctx, 'east', clock());
        assert.ok(r.said.includes(', a tied happy ghast at (30, 61, 10), a mine entrance at (8, 54, 3)'), r.said);
        assert.ok(r.said.endsWith(' to correct. Never untie, never break that post.'), r.said);
        assert.equal(r.said.startsWith('I found 7 places: '), true);
        assert.deepEqual(places.recallPlaceInfo('tied_happy_ghast'), { x: 30, y: 61, z: 10, dimension: 'overworld', base: 'east' });
    });

    test('nothing found: the text with the radius, nothing saved, no base', async () => {
        const w = createBlockWorld().flatGround(59);
        const { ctx, areas, bases, said } = stores({ settings: { survey_radius: 32 } });
        const r = await S.surveyBase(fakeBot(w, { entities: {} }), ctx, 'east', clock());
        assert.equal(r.ok, true);
        assert.equal(r.said, 'I found no place of a base within 32 blocks. Stand in the base and say it again.');
        assert.deepEqual(said, [r.said]);
        assert.equal(r.text, SAID);
        assert.equal(areas.size, 0);
        assert.equal(bases.get('east'), null);
    });
});

describe('surveyBase: the owner\'s words (2.2, 2.4, PLAN 4 decision 6)', () => {
    test('a find inside the owner\'s area is kept as the owner\'s, reported after the farms, and the owner\'s area is unchanged', async () => {
        const w = base();
        const { ctx, areas } = stores();
        const wheat = areas.set({ name: 'wheat_farm', type: 'farm', kind: 'farm', min: { x: 10, y: 58, z: 0 }, max: { x: 16, y: 62, z: 8 }, source: 'manual' });
        const r = await S.surveyBase(fakeBot(w), ctx, 'east', clock());
        assert.ok(r.said.includes('cow pen (5 cows)'), r.said);
        assert.ok(r.said.includes(' inside your "wheat farm" (kept as yours), cow pen (5 cows)'), r.said);
        assert.ok(!r.said.includes('potato farm'), r.said);
        assert.equal(areas.get('potato_farm'), undefined);
        assert.deepEqual(areas.get('wheat_farm'), wheat);
        assert.equal(r.kept.length, 1);
        assert.deepEqual(ctx.bases.get('east').kept, ['wheat_farm'], 'v0.1.4.16 (F2): the owner\'s area is in the base as kept');
    });

    test('W126 C: the owner saves a farm over half the field before a re-survey: the again-line names the kept field, the owner\'s area is unchanged', async () => {
        const w = base();
        const { ctx, areas } = stores();
        const bot = fakeBot(w);
        await S.surveyBase(bot, ctx, 'east', clock());
        assert.equal(areas.get('potato_farm').source, 'survey');
        const wheat = areas.set({ name: 'wheat_farm', type: 'farm', kind: 'farm', min: { x: 10, y: 58, z: 0 }, max: { x: 16, y: 62, z: 8 }, source: 'manual' });
        const again = await S.surveyBase(bot, ctx, 'east', clock());
        assert.match(again.said, /^I surveyed "east" again: a field at \(\d+, \d+, \d+\) inside your "wheat farm" \(kept as yours\)\. The rest as saved\.$/);
        assert.equal(again.text, SAID);
        assert.deepEqual(areas.get('wheat_farm'), wheat, 'the owner\'s words stand');
        assert.equal(areas.get('potato_farm').source, 'survey', 'the survey\'s farm stays: its farmland still stands');
    });
});

describe('surveyBase again: the difference line (2.4)', () => {
    test('nothing changed; a forgotten pen is new; more cows; a field that is gone is forgotten', async () => {
        const w = base();
        const { ctx, areas } = stores();
        const bot = fakeBot(w);
        await S.surveyBase(bot, ctx, 'east', clock());
        const again = await S.surveyBase(bot, ctx, 'east', clock());
        assert.equal(again.said, 'I surveyed "east" again: nothing changed.');
        assert.equal(again.text, SAID);
        assert.equal(areas.size, 5, 'the places are saved again under their names');
        areas.remove('cow_pen');
        const third = await S.surveyBase(bot, ctx, 'east', clock());
        assert.equal(third.said, 'I surveyed "east" again: the cow pen is new. The rest as saved.');
        assert.equal(areas.get('cow_pen').type, 'pen');
        Object.assign(bot.entities, cows(2, 70));
        const fourth = await S.surveyBase(bot, ctx, 'east', clock());
        assert.equal(fourth.said, 'I surveyed "east" again: 2 more cows in the cow pen. The rest as saved.');
        assert.equal(areas.get('cow_pen').contents.animals.cow, 7);
        w.fill(12, 59, 2, 20, 59, 6, 'grass_block');
        w.fill(12, 60, 2, 20, 60, 6, 'air');
        const fifth = await S.surveyBase(bot, ctx, 'east', clock());
        assert.equal(fifth.said, 'I surveyed "east" again: the potato farm is gone. The rest as saved.');
        assert.equal(areas.get('potato_farm'), undefined, 'a place of the survey whose seeds are gone is forgotten');
        assert.ok(!ctx.bases.get('east').places.includes('potato_farm'));
    });
});

describe('renameArea, forgetSurveyed, goToBase (2.5)', () => {
    async function surveyed(options = {}) {
        const w = base();
        const s = stores(options);
        await S.surveyBase(fakeBot(w), s.ctx, 'east', clock());
        return { w, ...s };
    }

    test('renameArea: an area, then a place; the texts word for word', async () => {
        const { ctx, areas, places, said } = await surveyed();
        said.length = 0;
        // v0.1.4.16 (F2): a success is said by the bot, the model gets the short answer; a failure is the answer as before
        assert.deepEqual(S.renameArea(ctx, 'potato_farm', 'Spuds'), { ok: true, reason: null, text: SAID, said: 'I renamed "potato_farm" to "spuds".', kind: 'area' });
        assert.deepEqual(said, ['I renamed "potato_farm" to "spuds".']);
        assert.equal(areas.get('potato_farm'), undefined);
        assert.equal(areas.get('spuds').type, 'farm');
        assert.equal(S.renameArea(ctx, 'carrot_farm', 'wheat_farm').text, 'I know no place "carrot_farm".');
        assert.equal(S.renameArea(ctx, 'spuds', 'cow_pen').text, 'There is a place "cow_pen" already.');
        assert.equal(S.renameArea(ctx, 'spuds', 'mine_entrance').text, 'There is a place "mine_entrance" already.', 'a place of the new name counts too');
        assert.equal(said.length, 1, 'a failure is not said');
        assert.deepEqual(S.renameArea(ctx, 'mine_entrance', 'mine'), { ok: true, reason: null, text: SAID, said: 'I renamed "mine_entrance" to "mine".', kind: 'place' });
        assert.equal(places.recallPlaceInfo('mine_entrance'), undefined);
        assert.equal(places.recallPlaceInfo('mine').base, 'east');
        assert.equal(S.renameArea(ctx, 'mine', 'house').text, 'There is a place "house" already.');
        assert.equal(S.renameArea(ctx, '', 'x').ok, false);
        const listed = ctx.bases.get('east').places;
        assert.ok(listed.includes('spuds') && listed.includes('mine') && !listed.includes('potato_farm') && !listed.includes('mine_entrance'),
            `the base lists the new names: ${listed.join(', ')}`);
    });

    test('forgetSurveyed: a base with its places and its routes; a place; nothing', async () => {
        const { ctx, areas, places, routeStore, bases, said } = await surveyed();
        said.length = 0;
        areas.set({ name: 'shed', type: 'building', kind: 'building', min: { x: 40, y: 60, z: 40 }, max: { x: 44, y: 63, z: 44 }, source: 'scan' });
        const r = S.forgetSurveyed(ctx, 'East');
        // v0.1.4.16 (F2): said by the bot, the short answer to the model
        assert.deepEqual(r, { ok: true, reason: null, text: SAID, said: 'I forgot the base "east" and its 6 places.', kind: 'base', count: 6 });
        assert.deepEqual(said, ['I forgot the base "east" and its 6 places.']);
        assert.deepEqual(areas.list().map(a => a.name), ['shed'], 'the owner\'s area stays');
        assert.equal(places.recallPlaceInfo('mine_entrance'), undefined);
        assert.equal(routeStore.size, 0, 'the survey\'s routes to the places of the base');
        assert.equal(bases.get('east'), null);
        places.rememberPlace('bed', 1, 2, 3, 'overworld');
        assert.deepEqual(S.forgetSurveyed(ctx, 'bed'), { ok: true, reason: null, text: SAID, said: 'Forgot the place "bed".', kind: 'place', count: 1 });
        assert.deepEqual(S.forgetSurveyed(ctx, 'nothing'), { ok: false, reason: 'unknown', text: '', kind: null, count: 0 });
        assert.equal(said.length, 2, 'nothing to forget is not said');
    });

    test('goToBase: no base; by a route; by the path search when no route serves; the failure', async () => {
        const walks = [];
        const { ctx, w, said } = await surveyed({ walkTo: async (bot, target) => { walks.push(['route', target]); return { ok: true, reason: null, text: 'walked' }; } });
        said.length = 0;
        const bot = fakeBot(w);
        assert.deepEqual(await S.goToBase(bot, ctx, 'west'), { ok: false, reason: 'unknown', text: 'I know no base "west".', base: null });
        const byRoute = await S.goToBase(bot, ctx, 'east');
        // v0.1.4.16 (F2): the arrival is the bot's own line
        assert.equal(byRoute.said, 'I am at the base "east".');
        assert.equal(byRoute.text, SAID);
        assert.deepEqual(said, ['I am at the base "east".']);
        assert.deepEqual(walks, [['route', { x: 4, y: 61, z: 0 }]], 'the door of the home');
        ctx.routes.walkTo = async () => ({ ok: false, reason: 'no_route', text: '' });
        const direct = await S.goToBase(bot, ctx, 'east', { walk: async (b, target, range) => { walks.push(['walk', target, range]); return { ok: true, reason: null }; } });
        assert.equal(direct.said, 'I am at the base "east".');
        assert.deepEqual(walks[1], ['walk', { x: 4, y: 61, z: 0 }, 2]);
        const failed = await S.goToBase(bot, ctx, 'east', { walk: async () => ({ ok: false, reason: 'no_path' }) });
        assert.deepEqual({ ok: failed.ok, reason: failed.reason, text: failed.text }, { ok: false, reason: 'no_path', text: 'I found no way to the base "east".' });
        ctx.routes.walkTo = async () => ({ ok: false, reason: 'blocked_door', text: 'The trapdoor at (1, 60, 4) does not open.' });
        const blocked = await S.goToBase(bot, ctx, 'east');
        assert.equal(blocked.text, 'The trapdoor at (1, 60, 4) does not open.', 'the walk\'s own failure text');
    });
});

describe('the ore guard (PLAN 9, SPEC 0 rule 28)', () => {
    test('with iron ore all around the basement nothing saved or said names an ore', async () => {
        const w = base({ ore: true });
        const { ctx } = stores();
        const r = await S.surveyBase(fakeBot(w), ctx, 'east', clock());
        assert.equal(r.said, REPORT);
        const everything = ['areas.json', 'places.json', 'routes.json', 'bases.json'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
        assert.ok(!everything.includes('_ore'));
        assert.ok(!JSON.stringify(r).includes('_ore'));
    });
});
