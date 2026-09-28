// Spec v0.1.4.7 section 0.1 and F: the modules of src/agent/packs/farming import without side
// effects, the pure ones import nothing but pure modules, none imports src/agent/library or
// another pack's executing code, and index.js exports what the spec names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/farming/';
const PURE = ['crop_logic', 'field_logic', 'texts'];
const EXECUTING = ['farming', 'index'];
// What an executing module of a pack may import (spec 0.1).
const ALLOWED = ['./crop_logic.js', './field_logic.js', './texts.js', './farming.js', '../home/motion.js', '../home/context.js',
    '../home/box_math.js', '../home/doors.js', '../../areas/area_scan.js'];

describe('import rules', () => {
    for (const name of PURE) {
        test(`${name}.js is pure: only pure modules, no packages`, () => {
            assertImportRules(`${DIR}${name}.js`, { allowBuiltins: [], allowedRelative: [...PURE.map(n => `${n}.js`), 'box_math.js'] });
        });
    }

    for (const name of EXECUTING) {
        test(`${name}.js imports no library, no model, no other pack by code`, () => {
            const { static: specs, require } = importsOf(`${DIR}${name}.js`);
            assert.equal(require, 0);
            for (const spec of specs) {
                if (spec.startsWith('.')) {
                    assert.ok(ALLOWED.includes(spec), `${name}.js imports ${spec}`);
                } else {
                    assert.ok(['vec3', 'mineflayer-pathfinder'].includes(spec), `${name}.js imports the package ${spec}`);
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
    test('exports every name of the spec', async () => {
        const F = await loadSrc(`${DIR}index.js`);
        for (const n of ['CROPS', 'cropOf', 'isRipe', 'COMPOSTABLE', 'isCompostable', 'cellPlan', 'visitOrder',
            'harvestCrops', 'plantField', 'makeBoneMeal', 'fertilize', 'farmCycle', 'harvestTarget', 'findFarm', 'TEXTS']) {
            assert.ok(n in F, `index.js exports ${n}`);
        }
        for (const fn of ['harvestCrops', 'plantField', 'makeBoneMeal', 'fertilize', 'farmCycle']) {
            assert.equal(typeof F[fn], 'function');
        }
    });
});
