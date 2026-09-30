// Spec v0.1.4.9 D3 (and section 2, I10): the tables of tests/routing/commands.js know the settings and
// the commands of this release, so that the routing check and its list can use them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const T = await loadSrc('tests/routing/commands.js');
const S = await loadSrc('scripts/routing_check.js');

const NEW_SETTINGS = { routes_pack: 'boolean', trail_max_steps: 'number', mine_routes: 'boolean', ore_sense_range: 'number', skills_over_code: 'boolean' };
const NEW_PARTS = {
    routes_pack: ['!rememberRoute', '!routes', '!forgetRoute'],
    mine_routes: ['!rememberMine', '!rememberTunnel', '!collectPassedOre'],
};

describe('SPEC_SETTINGS', () => {
    test('the five settings of section 2 with their types', () => {
        for (const [key, type] of Object.entries(NEW_SETTINGS)) assert.equal(T.SPEC_SETTINGS[key], type, key);
    });

    test('the settings of the earlier releases are still there', () => {
        for (const key of ['cost_meter', 'home_pack', 'mining_pack', 'keep_items']) assert.ok(Object.hasOwn(T.SPEC_SETTINGS, key), key);
    });
});

describe('PART_COMMANDS', () => {
    test('routes_pack and mine_routes with the commands of I10', () => {
        assert.deepEqual(T.PART_COMMANDS.routes_pack, NEW_PARTS.routes_pack);
        assert.deepEqual(T.PART_COMMANDS.mine_routes, NEW_PARTS.mine_routes);
    });

    test('the six commands are hidden while their switch is off, and shown while it is on', () => {
        const hiddenOff = new Set(T.hiddenPartCommands({ cost_meter: true }));
        for (const name of Object.values(NEW_PARTS).flat()) assert.ok(hiddenOff.has(name), name);
        const hiddenOn = new Set(T.hiddenPartCommands({ cost_meter: true, routes_pack: true, mine_routes: true }));
        for (const name of Object.values(NEW_PARTS).flat()) assert.ok(!hiddenOn.has(name), name);
    });

    test('a part switch that is absent is off', () => {
        assert.equal(T.partIsOn({}, 'routes_pack'), false);
        assert.equal(T.partIsOn({}, 'mine_routes'), false);
        assert.equal(T.partIsOn({ routes_pack: true }, 'routes_pack'), true);
    });

    test('the routing check with --all-parts switches both on', () => {
        const settings = S.runSettings({ routes_pack: false, mine_routes: false }, { name: 'x' }, true);
        assert.equal(settings.routes_pack, true);
        assert.equal(settings.mine_routes, true);
        assert.deepEqual(S.blockedFor(settings, {}).filter((name) => Object.values(NEW_PARTS).flat().includes(name)), []);
    });
});

describe('SPEC_COMMANDS: names, parameters and defaults of I10', () => {
    const I10 = [
        ['!rememberRoute', 'routes_pack', [['name', 'string', undefined]]],
        ['!routes', 'routes_pack', []],
        ['!forgetRoute', 'routes_pack', [['name', 'string', undefined]]],
        ['!rememberMine', 'mine_routes', [['name', 'string', 'mine']]],
        ['!rememberTunnel', 'mine_routes', [['name', 'string', '']]],
        ['!collectPassedOre', 'mine_routes', [['ore', 'string', undefined], ['num', 'int', 8]]],
    ];
    for (const [name, part, params] of I10) {
        test(name, () => {
            const entry = T.SPEC_COMMANDS.find((c) => c.name === name);
            assert.ok(entry, name);
            assert.equal(entry.part, part);
            assert.deepEqual(entry.params.map((p) => [p.name, p.type, p.default]), params);
            assert.ok(T.ALL_COMMAND_NAMES.includes(name));
            const def = T.specCommandDef(entry);
            assert.deepEqual(Object.keys(def.params), params.map(([p]) => p));
        });
    }
});
