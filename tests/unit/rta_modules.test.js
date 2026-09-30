// Spec v0.1.4.9, part A (engineer E1) and section 0: the modules of src/agent/packs/routes import without side
// effects; the pure ones import only pure modules; none imports src/agent/library, a model or mineflayer, or
// another pack but the helpers the spec allows (rule 11: packs/home motion, context, door_logic, doors, the
// pure box_math, and the ladder walking of packs/mining/ladder.js); index.js exports what section 5 names.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/routes/';
const ALL = ['trail_logic', 'route_logic', 'texts', 'route_store', 'trail', 'replay', 'index'];
const ALLOWED_OTHER = ['../home/context.js', '../home/door_logic.js', '../home/doors.js', '../home/motion.js', '../home/box_math.js',
    '../mining/ladder.js', '../../../utils/safe_json.js'];

describe('import rules', () => {
    test('the pure modules import only pure modules', () => {
        assert.deepEqual(importsOf(`${DIR}trail_logic.js`).static, ['../home/door_logic.js']);
        assert.deepEqual(importsOf(`${DIR}route_logic.js`).static, ['../home/box_math.js']);
        assert.deepEqual(importsOf(`${DIR}texts.js`).static, ['./route_logic.js']);
        assert.deepEqual(importsOf(`${DIR}route_store.js`).static.sort(), ['../../../utils/safe_json.js', './route_logic.js']);
    });

    for (const name of ['trail', 'replay', 'index']) {
        test(`${name}.js imports no library, no model, no mineflayer, and of other packs only the allowed helpers`, () => {
            const { static: specs, require, dynamic } = importsOf(`${DIR}${name}.js`);
            assert.equal(require, 0);
            assert.equal(dynamic, 0);
            for (const spec of specs) {
                if (spec.startsWith('../')) {
                    assert.ok(ALLOWED_OTHER.includes(spec), `${name}.js imports ${spec}`);
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
    test('section 5 and I1 to I4', async () => {
        const P = await loadSrc(`${DIR}index.js`);
        for (const name of ['createTrail', 'RouteStore', 'walkRoute', 'bindRoutes', 'rememberRoute', 'routesText', 'forgetRoute', 'TEXTS',
            'routeFromSteps', 'routeStart', 'skyStart', 'reverseRoute', 'routeEnds', 'legCells', 'nearestRoute']) {
            assert.ok(P[name] !== undefined, `index.js must export ${name}`);
        }
        assert.equal(P.ROUTE_FILE, 'routes.json');
        assert.equal(P.TRAIL_FILE, 'trail.json');
        assert.equal(typeof P.RouteStore, 'function');
    });

    test('createTrail gives start, stop, tick, list, clear and size, and starts nothing by itself', async () => {
        const P = await loadSrc(`${DIR}index.js`);
        const trail = P.createTrail({ entity: null }, {}, {});
        for (const name of ['start', 'stop', 'tick', 'list', 'clear']) assert.equal(typeof trail[name], 'function', name);
        assert.equal(trail.size, 0);
        assert.equal(trail.running, false);
    });
});
