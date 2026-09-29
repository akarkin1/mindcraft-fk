// Spec v0.1.4.6 section 0.1 and H: the modules of src/agent/packs/home import without side effects,
// the pure ones import nothing but pure siblings, none imports src/agent/library, and index.js
// exports what the spec names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/home/';
const PURE = ['box_math', 'door_logic', 'night_logic', 'creeper_logic', 'shelter_logic', 'sleep_logic', 'food_logic',
    'texts', 'home_settings', 'context', 'area_kinds'];
const EXECUTING = ['motion', 'doors', 'shelter', 'sleep', 'food', 'creeper', 'index'];
const PACKAGES = ['vec3', 'mineflayer-pathfinder'];
// v0.1.4.8: area_kinds.js is the one module of the pack that reads the table of the area types (part D)
const FOREIGN = { area_kinds: ['area_store.js'] };

describe('import rules', () => {
    for (const name of PURE) {
        test(`${name}.js is pure: only pure siblings, no packages`, () => {
            assertImportRules(`${DIR}${name}.js`, { allowBuiltins: [], allowedRelative: [...PURE.map(n => `${n}.js`), ...(FOREIGN[name] ?? [])] });
        });
    }

    test('area_kinds.js reads the area types of src/agent/areas/area_store.js and nothing else of it', () => {
        const { static: specs } = importsOf(`${DIR}area_kinds.js`);
        assert.deepEqual(specs.filter(s => !s.startsWith('./')), ['../../areas/area_store.js']);
    });

    for (const name of EXECUTING) {
        test(`${name}.js imports no library, no models, no mineflayer itself`, () => {
            const { static: specs, require } = importsOf(`${DIR}${name}.js`);
            assert.equal(require, 0);
            for (const spec of specs) {
                if (spec.startsWith('.')) {
                    assert.ok(spec.startsWith('./') && !spec.includes('/library/') && !/models|mcdata/.test(spec), `${name}.js imports ${spec}`);
                } else {
                    assert.ok(PACKAGES.includes(spec), `${name}.js imports the package ${spec}`);
                }
            }
        });
    }

    for (const name of [...PURE, ...EXECUTING]) {
        test(`${name}.js imports without side effects`, () => {
            assertCleanImport(`${DIR}${name}.js`);
        });
    }
});

describe('index.js', () => {
    test('exports every name of the spec and the helpers of the glue', async () => {
        const H = await loadSrc(`${DIR}index.js`);
        const names = [
            'DoorTracker', 'findOpenables', 'closeDoor', 'openDoor', 'passThrough', 'doorIsSafe',
            'goToShelter', 'emergencyShelter', 'isInShelter', 'sleepInBed', 'eatBestFood', 'autoEatOptions',
            'isNight', 'isHostileForShelter', 'shouldShelter', 'decide', 'runCreeperProcedure',
            'isPassingThrough', 'closeDoorsBehind', 'bedInShelter', 'creeperCheck', 'canFightCreeper',
            'readCreepers', 'nightShelterRoutine', 'enterBuilding', 'readHomeSettings', 'reflexOn', 'TEXTS',
            // v0.1.4.8, I7 and I8, C2
            'foodItems', 'moveOffhandBack', 'knownFood', 'createDoorService', 'hungerStep', 'hungerDecision',
        ];
        for (const n of names) {
            assert.ok(n in H, `index.js exports ${n}`);
        }
        assert.equal(H.TEXTS.gettingDark, 'It is getting dark. I go to the shelter.');
    });

    test('nightShelterRoutine: shelter, then the bed inside', async () => {
        const H = await loadSrc(`${DIR}index.js`);
        const { makeWorld, makeFakeBot, buildHouse } = await import('./home_fake_bot.test.js');
        const world = makeWorld();
        const area = buildHouse(world);
        world.bed(2, 64, 2, { facing: 'east' });
        const bot = makeFakeBot({ world, pos: [4.5, 64, 20.5] });
        bot.time.timeOfDay = 13000;
        bot.sleepMs = 0;
        const opts = { checkMs: 40, wait: () => new Promise(r => setTimeout(r, 2)) };
        const res = await H.nightShelterRoutine(bot, { areas: [area] }, opts);
        assert.equal(res.ok, true, JSON.stringify(res));
        assert.equal(res.slept, true);
        assert.equal(res.text, 'I am in the shelter "home". The door is closed. I slept. It is morning.');
        const none = await H.nightShelterRoutine(null, {}, opts);
        assert.equal(none.ok, false);
    });
});
