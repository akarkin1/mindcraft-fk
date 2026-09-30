// Part G of v0.1.4.9 (E5): the settings of section 2 in the fork's settings.js and in
// src/mindcraft/public/settings_spec.json, the effective switch mine_routes (mineRoutesOn), the value of
// trail_max_steps (trailMaxSteps), and the warning at the start for mine_routes without routes_pack.
//
// settings.js is the owner's live configuration, so its VALUES are not asserted: each new key must exist and
// hold a valid value of its type. The entries of settings_spec.json hold the defaults in code and are asserted
// exactly.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { parseModule } from '../helpers/source_ast.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const agent = await loadSrc('src/agent/agent.js');
        return { index, actions, agent };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const settings = (await loadSrc('settings.js')).default;
const settingsSource = fs.readFileSync(repoPath('settings.js'), 'utf8');
const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
const agentSource = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8').replace(/\r\n/g, '\n');

const isBoolean = (v) => typeof v === 'boolean';
// key, type in settings_spec.json, default in code (section 2), the check of a valid value of the owner
const NEW_KEYS = [
    ['routes_pack', 'boolean', false, isBoolean],
    ['trail_max_steps', 'number', 500, (v) => Number.isInteger(v) && v >= 50],
    ['mine_routes', 'boolean', false, isBoolean],
    ['ore_sense_range', 'number', 0, (v) => v === 0 || v === 3],
    ['skills_over_code', 'boolean', false, isBoolean],
];
const KEYS = NEW_KEYS.map(([key]) => key);

describe('settings.js: the settings of v0.1.4.9', () => {
    for (const [key, , , valid] of NEW_KEYS) {
        test(`${key} exists and holds a valid value`, () => {
            assert.ok(Object.hasOwn(settings, key), `${key} is missing`);
            assert.ok(valid(settings[key]), `${key}: ${JSON.stringify(settings[key])}`);
        });
    }

    test('the keys form one block directly after examples_by_last_request, in the order of the spec', () => {
        const keys = Object.keys(settings);
        const at = keys.indexOf('examples_by_last_request');
        assert.ok(at >= 0);
        assert.deepEqual(keys.slice(at + 1, at + 1 + KEYS.length), KEYS);
    });

    test('each key has a short comment on its line; the switches that need others name them', () => {
        const lines = settingsSource.split(/\r?\n/);
        const commentOf = (key) => lines.find((l) => l.includes(`"${key}"`))?.split('//')[1]?.trim() ?? '';
        for (const key of KEYS) {
            const comment = commentOf(key);
            assert.ok(comment.length > 10 && comment.length <= 140, `comment of ${key}: ${comment}`);
        }
        assert.match(commentOf('trail_max_steps'), /routes_pack/);
        assert.match(commentOf('mine_routes'), /mining_pack and routes_pack/);
        assert.match(commentOf('ore_sense_range'), /\b0\b.*\b3\b/);
        for (const name of ['!rememberRoute', '!routes', '!forgetRoute']) assert.ok(commentOf('routes_pack').includes(name), name);
        for (const name of ['!rememberMine', '!rememberTunnel', '!collectPassedOre']) assert.ok(commentOf('mine_routes').includes(name), name);
    });

    test('the file keeps one kind of line ending', () => {
        const crlf = settingsSource.split('\r\n').length - 1;
        const lf = settingsSource.split('\n').length - 1;
        assert.ok(crlf === lf || crlf === 0, `every line ends with CRLF or every line ends with LF (${crlf} of ${lf})`);
    });
});

describe('settings_spec.json: the settings of v0.1.4.9', () => {
    for (const [key, type, codeDefault] of NEW_KEYS) {
        test(`${key}: type "${type}", default ${JSON.stringify(codeDefault)}, a description`, () => {
            const entry = spec[key];
            assert.ok(entry, `entry ${key} exists`);
            assert.equal(entry.type, type);
            assert.deepEqual(entry.default, codeDefault);
            assert.ok(typeof entry.description === 'string' && entry.description.trim().length > 20, key);
        });
    }

    test('the entries come directly after examples_by_last_request, in the order of the spec', () => {
        const keys = Object.keys(spec);
        const at = keys.indexOf('examples_by_last_request');
        assert.ok(at >= 0);
        assert.deepEqual(keys.slice(at + 1, at + 1 + KEYS.length), KEYS);
    });

    test('ore_sense_range is a number, 0 or 3; the switches name their commands and what they need', () => {
        assert.deepEqual(spec.ore_sense_range.options, [0, 3]);
        assert.match(spec.ore_sense_range.description, /^0 or 3\./);
        assert.match(spec.routes_pack.description, /!rememberRoute, !routes and !forgetRoute/);
        assert.match(spec.mine_routes.description, /!rememberMine, !rememberTunnel and !collectPassedOre/);
        assert.match(spec.mine_routes.description, /mining_pack and routes_pack/);
        assert.match(spec.trail_max_steps.description, /50 or more/);
        assert.match(spec.skills_over_code.description, /!newAction/);
    });

    test('every switch is off by default (section 0, rule 6)', () => {
        for (const key of ['routes_pack', 'mine_routes', 'skills_over_code']) assert.equal(spec[key].default, false, key);
        assert.equal(spec.ore_sense_range.default, 0);
    });
});

describe('mineRoutesOn: mine_routes as it takes effect', () => {
    test('only with mining_pack, routes_pack and mine_routes; mine_routes exactly true, as the mining pack reads it', () => {
        const { mineRoutesOn } = M.actions;
        for (let mask = 0; mask < 8; mask++) {
            const s = { mining_pack: Boolean(mask & 1), routes_pack: Boolean(mask & 2), mine_routes: Boolean(mask & 4) };
            assert.equal(mineRoutesOn(s), mask === 7, JSON.stringify(s));
        }
        assert.equal(mineRoutesOn({}), false, 'an older settings.js');
        assert.equal(mineRoutesOn(null), false);
        assert.equal(mineRoutesOn({ mining_pack: true, routes_pack: true, mine_routes: 'yes' }), false);
    });

    test('one helper: agent.js takes it from the commands, and it reads the settings of the agent without an argument', () => {
        assert.ok(agentSource.includes("import { mineRoutesOn } from './commands/actions.js';"));
        assert.ok(!/function mineRoutesOn/.test(agentSource), 'no second copy in agent.js');
    });
});

describe('trail_max_steps and the warning of mine_routes', () => {
    test('trailMaxSteps: a whole number of 50 or more, else 500', () => {
        const { trailMaxSteps, TRAIL_MAX_STEPS } = M.agent;
        assert.equal(TRAIL_MAX_STEPS, 500);
        for (const [value, steps] of [[500, 500], [50, 50], [2000, 2000], [49, 500], [0, 500], [-5, 500], [120.5, 500], ['800', 500], [undefined, 500], [null, 500], [NaN, 500]]) {
            assert.equal(trailMaxSteps(value), steps, String(value));
        }
    });

    test('the warning word for word, once in start(), for mine_routes without routes_pack', () => {
        assert.equal(M.agent.MINE_ROUTES_WARNING, 'mine_routes needs routes_pack. The mine routes are off.');
        const start = agentSource.slice(agentSource.indexOf('async start('), agentSource.indexOf('_archiveMemory() {'));
        assert.ok(start.includes('if (settings.mine_routes && !settings.routes_pack)\n            console.warn(MINE_ROUTES_WARNING);'));
        assert.equal(agentSource.split('console.warn(MINE_ROUTES_WARNING)').length, 2, 'once');
        assert.doesNotThrow(() => parseModule(agentSource));
    });
});
