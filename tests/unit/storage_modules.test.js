// Spec v0.1.4.7 section 0.1 and S: the modules of src/agent/packs/storage import without side
// effects, the pure ones import nothing but pure modules, none imports src/agent/library or
// another pack except its pure modules and the allowed home modules, and index.js exports what
// the spec names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/storage/';
const PURE = ['storage_logic', 'texts'];
const ALL = [...PURE, 'chest_index', 'storage', 'index'];
const HOME_ALLOWED = ['../home/motion.js', '../home/context.js', '../home/food_logic.js'];

describe('import rules', () => {
    test('storage_logic.js is pure: only the pure food module of the home pack', () => {
        assertImportRules(`${DIR}storage_logic.js`, { allowBuiltins: [], allowedRelative: ['food_logic.js'] });
        assert.deepEqual(importsOf(`${DIR}storage_logic.js`).static, ['../home/food_logic.js']);
    });

    test('texts.js is pure', () => {
        assertImportRules(`${DIR}texts.js`, { allowBuiltins: [], allowedRelative: ['storage_logic.js'] });
    });

    test('chest_index.js imports the safe json helper and the logic only', () => {
        assert.deepEqual(importsOf(`${DIR}chest_index.js`).static.sort(), ['../../../utils/safe_json.js', './storage_logic.js']);
    });

    for (const name of ['storage', 'index']) {
        test(`${name}.js imports no library, no models, no mineflayer, no other pack but allowed home modules`, () => {
            const { static: specs, require, dynamic } = importsOf(`${DIR}${name}.js`);
            assert.equal(require, 0);
            assert.equal(dynamic, 0);
            for (const spec of specs) {
                if (spec.startsWith('../')) {
                    assert.ok(HOME_ALLOWED.includes(spec), `${name}.js imports ${spec}`);
                } else {
                    assert.ok(spec.startsWith('./') || spec === 'vec3', `${name}.js imports ${spec}`);
                }
            }
        });
    }

    for (const name of ALL) {
        test(`${name}.js imports without side effects`, () => {
            assertCleanImport(`${DIR}${name}.js`);
        });
    }
});

describe('index.js exports what the spec names', () => {
    test('the members of S1, S2 and S3', async () => {
        const P = await loadSrc(`${DIR}index.js`);
        for (const name of ['ChestIndex', 'keepPlan', 'chooseChest', 'lookIntoChests', 'storeItems', 'fetchItem', 'chestsText',
            'bindStorage', 'lookIntoChest', 'recordContainer', 'TEXTS', 'CHEST_FILE', 'CONTAINER_KINDS']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
        assert.equal(typeof P.ChestIndex, 'function');
        assert.equal(typeof P.storeItems, 'function');
    });
});
