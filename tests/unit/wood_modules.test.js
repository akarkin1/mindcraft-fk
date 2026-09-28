// Spec v0.1.4.7 section 0.1 and T: the modules of src/agent/packs/wood import without side effects,
// the pure ones import nothing but pure modules, none imports src/agent/library, and index.js
// exports what the spec names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { assertCleanImport, assertImportRules } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/wood/';
const PURE = { tree_logic: ['area_scan.js', 'box_math.js'], tool_logic: ['tree_logic.js'], texts: ['tree_logic.js'], inventory: [] };
const EXECUTING = ['actions', 'wood', 'tools', 'index'];
const PACKAGES = ['vec3'];

describe('import rules', () => {
    for (const [name, allowed] of Object.entries(PURE)) {
        test(`${name}.js is pure`, () => {
            assertImportRules(`${DIR}${name}.js`, { allowBuiltins: [], allowedRelative: allowed });
        });
    }

    for (const name of EXECUTING) {
        test(`${name}.js imports no library, no models, no other pack but the home helpers`, () => {
            const { static: specs, require } = importsOf(`${DIR}${name}.js`);
            assert.equal(require, 0);
            for (const spec of specs) {
                if (spec.startsWith('.')) {
                    const ok = spec.startsWith('./') || ['../home/box_math.js', '../home/context.js', '../home/motion.js'].includes(spec);
                    assert.ok(ok && !/library|models|mcdata/.test(spec), `${name}.js imports ${spec}`);
                } else {
                    assert.ok(PACKAGES.includes(spec), `${name}.js imports the package ${spec}`);
                }
            }
        });
    }

    for (const name of [...Object.keys(PURE), ...EXECUTING]) {
        test(`${name}.js imports without side effects`, () => {
            assertCleanImport(`${DIR}${name}.js`);
        });
    }
});

describe('index.js', () => {
    test('exports every name of the spec, and ctx.tools and ctx.wood', async () => {
        const W = await loadSrc(`${DIR}index.js`);
        for (const n of ['findTrees', 'chopPlan', 'chopTrees', 'MATERIALS', 'TOOL_USES', 'RECIPES', 'parseTool', 'bestTool', 'usesLeft',
            'craftSteps', 'ensureTool', 'craftSupplies', 'inventoryOf', 'itemUsesLeft']) {
            assert.ok(n in W, `index.js exports ${n}`);
        }
        assert.deepEqual(Object.keys(W.TOOLS_API).sort(), ['craftSupplies', 'ensureTool']);
        assert.deepEqual(Object.keys(W.WOOD_API), ['chopTrees']);
        assert.equal(W.WOOD_API.chopTrees, W.chopTrees);
    });
});
