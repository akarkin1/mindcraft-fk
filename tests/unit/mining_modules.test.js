// Spec v0.1.4.7 section 0.1 and M: the modules of src/agent/packs/mining import without side
// effects, the pure ones import nothing but pure modules, none imports src/agent/library or another
// pack except its pure modules and the allowed home modules, and index.js exports what the spec names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/mining/';
const ALL = ['ore_table', 'mine_logic', 'texts', 'mine_store', 'dig', 'ladder', 'mining', 'index'];
const HOME_ALLOWED = ['../home/motion.js', '../home/context.js', '../home/box_math.js', '../home/food_logic.js'];

describe('import rules', () => {
    test('ore_table.js is pure and imports nothing', () => {
        assertImportRules(`${DIR}ore_table.js`, { allowBuiltins: [], allowedRelative: [] });
        assert.deepEqual(importsOf(`${DIR}ore_table.js`).static, []);
    });

    test('mine_logic.js is pure: pure home modules and the ore table only', () => {
        assertImportRules(`${DIR}mine_logic.js`, { allowBuiltins: [], allowedRelative: ['box_math.js', 'food_logic.js', 'ore_table.js'] });
        assert.deepEqual(importsOf(`${DIR}mine_logic.js`).static.sort(), ['../home/box_math.js', '../home/food_logic.js', './ore_table.js']);
    });

    test('texts.js is pure: the texts of the storage pack and the ore table', () => {
        assert.deepEqual(importsOf(`${DIR}texts.js`).static.sort(), ['../storage/texts.js', './ore_table.js']);
    });

    test('mine_store.js imports the safe json helper and the pure modules only', () => {
        assert.deepEqual(importsOf(`${DIR}mine_store.js`).static.sort(), ['../../../utils/safe_json.js', './mine_logic.js', './ore_table.js']);
    });

    for (const name of ['dig', 'ladder', 'mining', 'index']) {
        test(`${name}.js imports no library, no models, no mineflayer, no other pack but pure and allowed modules`, () => {
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
    test('M1 to M4 and the helpers of the commands', async () => {
        const P = await loadSrc(`${DIR}index.js`);
        for (const name of ['oreOf', 'isOreBlock', 'targetLevel', 'pickaxeFor', 'ORES', 'tripNeeds', 'shaftStep', 'tunnelStep', 'veinOrder',
            'shouldReturn', 'staircaseStep', 'MineStore', 'MINE_FILE', 'prepareMiningTrip', 'descendToLevel', 'setupMineBase', 'digTunnel',
            'depositAtBase', 'climbToSurface', 'mineOre', 'goToMine', 'leaveMine', 'currentMine', 'mineOreText', 'unknownOreText',
            'cannotMineText', 'TEXTS', 'STOP_REASONS', 'placeLadder', 'slideDown', 'climbUp']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
        assert.equal(P.MINE_FILE, 'mines.json');
        assert.equal(typeof P.MineStore, 'function');
        assert.equal(P.DEFAULT_MAX_MINUTES, 30);
    });
});
