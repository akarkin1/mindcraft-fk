// Spec v0.1.4.15 section 0 and 2 (engineer E1): the modules of src/agent/packs/survey import without side effects, the pure
// ones import only the pure modules the spec names (survey_logic.js and underground_logic.js: area_scan.js, area_kind.js,
// open_farm.js and the box math of the home pack; texts.js nothing), the executing ones import no library, no model, no
// registry and no other pack by code (the areas, the world stores and the home helpers are shared code, not a pack), and
// index.js exports what the spec names. E4's modules (underground_logic, survey, index) are checked once they are in the tree.
import fs from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { repoPath } from '../helpers/paths.js';
import { assertCleanImport, assertImportRules } from '../helpers/module_rules.js';

const DIR = 'src/agent/packs/survey/';
const SCANS = ['area_scan.js', 'area_kind.js', 'open_farm.js', 'box_math.js'];
const PURE = { survey_logic: SCANS, underground_logic: SCANS, texts: [] };
const EXECUTING = ['survey', 'index'];
const PACKAGES = ['vec3'];
// What an executing module of the pack may import besides its siblings (`./`): the home helpers of the other packs, the
// areas and the world stores. Never src/agent/library, src/models, mcdata or another pack's code.
const SHARED = ['../home/box_math.js', '../home/context.js', '../home/motion.js', '../home/pickup_logic.js', '../home/doors.js'];
const SHARED_DIRS = ['../../areas/', '../../world/'];

const present = (name) => fs.existsSync(repoPath(`${DIR}${name}.js`));
const missing = (name) => (present(name) ? false : `${name}.js is E4's and not in this tree yet`);

describe('import rules', () => {
    for (const [name, allowed] of Object.entries(PURE)) {
        test(`${name}.js is pure: only ${allowed.length > 0 ? allowed.join(', ') : 'nothing'}`, { skip: missing(name) }, () => {
            assertImportRules(`${DIR}${name}.js`, { allowBuiltins: [], allowedRelative: allowed });
        });
    }

    for (const name of EXECUTING) {
        test(`${name}.js imports no library, no models, no registry, no other pack but the home helpers`, { skip: missing(name) }, () => {
            const { static: specs, require } = importsOf(`${DIR}${name}.js`);
            assert.equal(require, 0);
            for (const spec of specs) {
                if (spec.startsWith('.')) {
                    const ok = spec.startsWith('./') || SHARED.includes(spec) || SHARED_DIRS.some(d => spec.startsWith(d) && !spec.slice(d.length).includes('/'));
                    assert.ok(ok && !/library|models|mcdata/.test(spec), `${name}.js imports ${spec}`);
                } else {
                    assert.ok(PACKAGES.includes(spec), `${name}.js imports the package ${spec}`);
                }
            }
        });
    }

    for (const name of [...Object.keys(PURE), ...EXECUTING]) {
        test(`${name}.js imports without side effects`, { skip: missing(name) }, () => {
            assertCleanImport(`${DIR}${name}.js`);
        });
    }

    test('no module of the pack imports another pack by code (packs reach each other through ctx)', () => {
        for (const name of [...Object.keys(PURE), ...EXECUTING].filter(present)) {
            for (const spec of importsOf(`${DIR}${name}.js`).static) {
                assert.ok(!/^\.\.\/(farming|mining|routes|storage|watch|wood)\//.test(spec), `${name}.js imports the pack ${spec}`);
            }
        }
    });
});

describe('the exports of the spec', () => {
    test('survey_logic.js exports SEED_NAMES, oreBlind, seedsOf and findPlaces (2.1, 2.2)', async () => {
        const L = await loadSrc(`${DIR}survey_logic.js`);
        for (const n of ['SEED_NAMES', 'SEED_CATEGORIES', 'oreBlind', 'isOreName', 'seedsOf', 'findPlaces', 'farmName', 'penName', 'uniqueName']) {
            assert.equal(typeof L[n], n === 'SEED_NAMES' ? 'object' : n === 'SEED_CATEGORIES' ? 'object' : 'function', n);
        }
        assert.ok(Object.isFrozen(L.SEED_NAMES));
    });

    test('texts.js exports the texts of 2.5', async () => {
        const T = await loadSrc(`${DIR}texts.js`);
        for (const n of ['reportText', 'itemText', 'keptText', 'tiedRuleText', 'nothingText', 'nothingFoundText', 'againText', 'renamedText',
            'unknownPlaceText', 'placeExistsText', 'forgotBaseText', 'atBaseText', 'noBaseText', 'roleOf']) {
            assert.equal(typeof T[n], 'function', n);
        }
    });

    test('index.js exports the names of the spec', { skip: missing('index') }, async () => {
        const I = await loadSrc(`${DIR}index.js`);
        for (const n of ['SEED_NAMES', 'oreBlind', 'seedsOf', 'findPlaces', 'reportText', 'nothingText', 'againText', 'surveyBase']) {
            assert.ok(n in I, `index.js exports ${n}`);
        }
    });
});
