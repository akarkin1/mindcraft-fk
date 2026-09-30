// Spec v0.1.4.9 part B (engineer E2), rules 10 and 11: the new modules of the mining pack import no
// library, no model, no other pack (the routes pack is reached only through ctx.routes), only static
// imports, without side effects; index.js exports the names of I6 and B2 to B6.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/mining/';
const HOME_ALLOWED = ['../home/motion.js', '../home/context.js', '../home/box_math.js', '../home/food_logic.js'];

describe('import rules of mine_way.js and mine_player.js', () => {
    for (const name of ['mine_way', 'mine_player']) {
        test(`${name}.js: static imports of the pack and the allowed home modules only, no routes pack`, () => {
            const { static: specs, require, dynamic } = importsOf(`${DIR}${name}.js`);
            assert.equal(require, 0);
            assert.equal(dynamic, 0);
            for (const spec of specs) {
                if (spec.startsWith('../')) {
                    assert.ok(HOME_ALLOWED.includes(spec), `${name}.js imports ${spec}`);
                } else {
                    assert.ok(spec.startsWith('./'), `${name}.js imports ${spec}`);
                }
                assert.ok(!spec.includes('routes'), `${name}.js imports ${spec}`);
            }
        });

        test(`${name}.js imports without side effects`, () => {
            assertCleanImport(`${DIR}${name}.js`);
        });
    }

    test('the pure modules stay pure: mine_logic imports the ore table and pure home modules only', () => {
        assert.deepEqual(importsOf(`${DIR}mine_logic.js`).static.sort(), ['../home/box_math.js', '../home/food_logic.js', './ore_table.js']);
    });
});

describe('index.js exports the names of part B', () => {
    test('I6, B2 to B7', async () => {
        const P = await loadSrc(`${DIR}index.js`);
        for (const name of ['mineAt', 'tunnelFor', 'branchPlan', 'measureTunnel', 'corridorDirections', 'tunnelsOf', 'legCells', 'mineKey', 'MineStore',
            'rememberMine', 'rememberTunnel', 'collectPassedOre', 'mineOre', 'digTunnel', 'depositAtBase', 'climbToSurface', 'passedText',
            'noTunnelText', 'rememberMineText', 'rememberTunnelText', 'collectPassedText', 'veinParts', 'senseOres', 'PASSED_REASONS']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
        const store = new P.MineStore(null);
        for (const method of ['byName', 'nearest', 'addPassed', 'removePassed']) {
            assert.equal(typeof store[method], 'function', method);
        }
    });
});
