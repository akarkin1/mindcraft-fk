// Spec v0.1.4.6 R6 and R7: the routing list tests/routing/sentences.json and the pure helpers of
// scripts/routing_check.js. The list is checked for its shape, for duplicates, for the command
// names (existing commands and the commands of the spec, tests/routing/commands.js) and for the
// parts, which must be settings of section 1 of the spec. The script is imported without running:
// it runs only when started as the main module, and imports project modules only then.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { repoPath } from '../helpers/paths.js';
import { loadSrc } from '../helpers/load.js';
import { importsOf } from '../helpers/hygiene.js';
import { runNodeScript } from '../helpers/child.js';
import { makeTmpDir, removeTmpDir, listDir } from '../helpers/tmp.js';

const T = await loadSrc('tests/routing/commands.js');
const S = await loadSrc('scripts/routing_check.js');
const SENTENCES = JSON.parse(fs.readFileSync(repoPath('tests/routing/sentences.json'), 'utf8'));

// The table of R6, word for word, with the commands the spec expects.
const R6 = [
    [['get to shelter', 'get shelter!', 'it is getting dark', 'go home'], ['!goToShelter']],
    [['go to bed pls', "let's get some sleep", 'sleep'], ['!goToBed']],
    [['eat some food!', 'eat the bread'], ['!eat', '!consume']],
    [['this place is home, remember this'], ['!rememberArea', '!rememberHere']],
    [['do not ever forget to close the door behind yourself'], ['!rememberRule']],
    [["no, don't use wheat seeds, you need them to plant the wheat"], ['!rememberRule']],
    [["do not get logs from the house, you're destroying our shelter"], ['!rememberRule', '!rememberArea']],
    [['follow me', 'follow me my lead'], ['!followPlayer']],
    [['get here pls', 'come here!', 'get you ass here'], ['!goToPlayer']],
    [['collect some logs for me'], ['!collectBlocks']],
    [['stop', 'wait'], ['!stop', '!stay']],
    [['how much did you cost today?'], ['!cost']],
];

const PART_SWITCHES = Object.keys(T.PART_COMMANDS);

describe('tests/routing/commands.js', () => {
    test('pure data module: no imports', () => {
        assert.deepEqual(importsOf('tests/routing/commands.js').static, []);
    });

    test('the settings of section 1 of the spec', () => {
        assert.deepEqual(Object.keys(T.SPEC_SETTINGS), [
            'cost_meter', 'cost_report_minutes', 'cost_warn_per_hour', 'cost_limit_per_hour', 'cost_limit_per_session',
            'model_prices', 'max_command_result_chars', 'protected_areas', 'player_rules', 'rules_max', 'home_pack',
            'home_reflexes', 'creeper_fighting',
            // v0.1.4.7
            'storage_pack', 'farming_pack', 'wood_pack', 'mining_pack', 'mining_max_minutes', 'keep_items',
            // v0.1.4.9
            'routes_pack', 'trail_max_steps', 'mine_routes', 'ore_sense_range', 'skills_over_code',
            // v0.1.4.12
            'watch_and_learn',
        ]);
    });

    test('every part switch is a boolean setting of section 1', () => {
        for (const part of PART_SWITCHES) assert.equal(T.SPEC_SETTINGS[part], 'boolean', part);
    });

    test('every command of a part is a command of the spec with that part, and the other way round', () => {
        const fromParts = Object.entries(T.PART_COMMANDS).flatMap(([part, names]) => names.map((name) => `${part} ${name}`)).sort();
        const fromSpec = T.SPEC_COMMANDS.map((c) => `${c.part} ${c.name}`).sort();
        assert.deepEqual(fromParts, fromSpec);
    });

    test('command names are unique and no spec command exists already', () => {
        assert.equal(new Set(T.ALL_COMMAND_NAMES).size, T.ALL_COMMAND_NAMES.length);
        for (const c of T.SPEC_COMMANDS) assert.ok(!T.EXISTING_COMMANDS.includes(c.name), c.name);
    });

    test('specCommandDef builds a definition as in actions.js, with the defaults of the spec', () => {
        const def = T.specCommandDef(T.SPEC_COMMANDS.find((c) => c.name === '!rememberArea'));
        assert.deepEqual(def.params, { name: { type: 'string', description: 'name' }, type: { type: 'string', description: 'type', default: 'building' } });
        assert.equal(def.fromSpec, true);
        assert.deepEqual(T.specCommandDef(T.SPEC_COMMANDS.find((c) => c.name === '!rules')).params, {});
        assert.equal(T.specCommandDef(T.SPEC_COMMANDS.find((c) => c.name === '!allowChanges')).params.minutes.default, 10);
    });

    test('partIsOn: the switch, the default when absent, protected_areas needs world_memory', () => {
        assert.equal(T.partIsOn({}, 'cost_meter'), true);
        assert.equal(T.partIsOn({ cost_meter: false }, 'cost_meter'), false);
        assert.equal(T.partIsOn({}, 'player_rules'), false);
        assert.equal(T.partIsOn({ player_rules: true }, 'player_rules'), true);
        assert.equal(T.partIsOn({ player_rules: 'yes' }, 'player_rules'), false);
        assert.equal(T.partIsOn({ protected_areas: true }, 'protected_areas'), false);
        assert.equal(T.partIsOn({ protected_areas: true, world_memory: true }, 'protected_areas'), true);
        assert.equal(T.partIsOn(undefined, 'home_pack'), false);
    });

    test('hiddenPartCommands: the commands of every part that is off', () => {
        const packs = { storage_pack: true, farming_pack: true, wood_pack: true, mining_pack: true, routes_pack: true, mine_routes: true, watch_and_learn: true }; // v0.1.4.7, v0.1.4.9, v0.1.4.12
        assert.deepEqual(T.hiddenPartCommands({ player_rules: true, protected_areas: true, world_memory: true, home_pack: true, cost_meter: true, ...packs }), []);
        assert.deepEqual(T.hiddenPartCommands({ player_rules: true, cost_meter: true, ...packs }).sort(),
            [...T.PART_COMMANDS.protected_areas, ...T.PART_COMMANDS.home_pack].sort());
        assert.deepEqual(T.hiddenPartCommands({ cost_meter: false }).sort(), T.SPEC_COMMANDS.map((c) => c.name).sort());
    });
});

describe('tests/routing/sentences.json', () => {
    test('a list of at least 50 sentences', () => {
        assert.ok(Array.isArray(SENTENCES));
        assert.ok(SENTENCES.length >= 50, `${SENTENCES.length} sentences`);
    });

    test('every entry is { say, expect, part }', () => {
        for (const entry of SENTENCES) {
            const label = JSON.stringify(entry);
            assert.deepEqual(Object.keys(entry).sort(), ['expect', 'part', 'say'], label);
            assert.equal(typeof entry.say, 'string', label);
            assert.ok(entry.say.trim() !== '' && entry.say === entry.say.trim(), label);
            assert.ok(!/!\w/.test(entry.say), `a sentence must not contain a command: ${label}`);
            assert.ok(Array.isArray(entry.expect) && entry.expect.length > 0, label);
            for (const name of entry.expect) assert.match(name, /^![a-zA-Z]\w*$/, label);
            assert.equal(new Set(entry.expect).size, entry.expect.length, `repeated command in ${label}`);
            assert.equal(typeof entry.part, 'string', label);
        }
    });

    test('no sentence is in the list twice (ignoring case and spaces at the ends)', () => {
        const seen = new Map();
        for (const entry of SENTENCES) {
            const key = entry.say.trim().toLowerCase();
            assert.ok(!seen.has(key), `duplicate: ${entry.say}`);
            seen.set(key, entry);
        }
    });

    test('every expected command is an existing command or a command of the spec', () => {
        for (const entry of SENTENCES) {
            for (const name of entry.expect) assert.ok(T.ALL_COMMAND_NAMES.includes(name), `${name} in "${entry.say}"`);
        }
    });

    test('every part named is a switch among the settings of section 1 of the spec', () => {
        for (const entry of SENTENCES) {
            if (entry.part === '') continue;
            assert.ok(Object.hasOwn(T.SPEC_SETTINGS, entry.part), `${entry.part} in "${entry.say}"`);
            assert.ok(PART_SWITCHES.includes(entry.part), `${entry.part} is no part switch ("${entry.say}")`);
        }
    });

    // v0.1.4.9: mine_routes is on only with mining_pack and routes_pack (partIsOn)
    test('with only the named part on, at least one expected command is visible', () => {
        for (const entry of SENTENCES) {
            const settings = { world_memory: true, cost_meter: false };
            if (entry.part !== '') settings[entry.part] = true;
            if (entry.part === 'mine_routes') Object.assign(settings, { mining_pack: true, routes_pack: true });
            const hidden = new Set(T.hiddenPartCommands(settings));
            assert.ok(entry.expect.some((name) => !hidden.has(name)), `"${entry.say}" with part "${entry.part}"`);
        }
    });

    test('a sentence whose commands all belong to one part names that part', () => {
        for (const entry of SENTENCES) {
            const parts = new Set(entry.expect.map((name) => PART_SWITCHES.find((p) => T.PART_COMMANDS[p].includes(name)) ?? ''));
            if (parts.size === 1 && !parts.has('')) assert.equal(entry.part, [...parts][0], entry.say);
        }
    });

    test('the sentences of the table R6, word for word, with the commands of the spec', () => {
        for (const [says, commands] of R6) {
            for (const say of says) {
                const entry = SENTENCES.find((e) => e.say === say);
                assert.ok(entry, `missing: ${say}`);
                for (const name of commands) assert.ok(entry.expect.includes(name), `${say}: ${name}`);
            }
        }
    });

    test('every command of this release is expected by at least one sentence', () => {
        const expected = new Set(SENTENCES.flatMap((e) => e.expect));
        for (const c of T.SPEC_COMMANDS) assert.ok(expected.has(c.name), c.name);
    });

    test('frequent old commands are covered', () => {
        const expected = new Set(SENTENCES.flatMap((e) => e.expect));
        for (const name of ['!followPlayer', '!goToPlayer', '!collectBlocks', '!stop', '!stay', '!goToBed', '!consume', '!craftRecipe', '!givePlayer', '!rememberHere', '!goToRememberedPlace', '!attack', '!newAction']) {
            assert.ok(expected.has(name), name);
        }
    });
});

describe('scripts/routing_check.js: import', () => {
    test('imports only node built-ins and tests/routing/commands.js at the top; the rest is loaded when it runs', () => {
        const imports = importsOf('scripts/routing_check.js');
        assert.equal(imports.require, 0);
        for (const spec of imports.static) {
            assert.ok(spec.startsWith('node:') || spec === '../tests/routing/commands.js', spec);
        }
    });

    test('the code never names keys.json (comments aside)', () => {
        const source = fs.readFileSync(repoPath('scripts/routing_check.js'), 'utf8');
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        assert.ok(!/keys\.json/.test(code), 'keys.json appears in the code');
    });
});

describe('scripts/routing_check.js: parseArgs', () => {
    // v0.1.4.9 (D3): profile, model and missing are new
    test('no options', () => {
        assert.deepEqual(S.parseArgs([]), { dryRun: false, allParts: false, help: false, profile: null, model: null, unknown: [], missing: [] });
    });

    test('--dry-run, --all-parts, --help', () => {
        assert.deepEqual(S.parseArgs(['--dry-run', '--all-parts']), { dryRun: true, allParts: true, help: false, profile: null, model: null, unknown: [], missing: [] });
        assert.equal(S.parseArgs(['-h']).help, true);
        assert.equal(S.parseArgs(['--help']).help, true);
    });

    test('unknown options are collected', () => {
        assert.deepEqual(S.parseArgs(['--dry', 'x']).unknown, ['--dry', 'x']);
    });
});

describe('scripts/routing_check.js: settings and sentences', () => {
    const fileSettings = { base_profile: 'assistant', player_rules: false, protected_areas: false, home_pack: false, cost_meter: true, world_memory: true, log_all_prompts: true, blocked_actions: ['!x'] };
    const profile = { name: 'claude', model: 'claude-haiku-4-5-20251001' };

    test('runSettings: a copy of the file settings with the profile, no prompt logs, parts as in the file', () => {
        const s = S.runSettings(fileSettings, profile, false);
        assert.equal(s.profile, profile);
        assert.equal(s.log_all_prompts, false);
        assert.equal(s.player_rules, false);
        assert.deepEqual(s.blocked_actions, ['!x']);
        assert.equal(fileSettings.log_all_prompts, true, 'the file settings are not changed');
    });

    test('runSettings with all parts: every part switch and world_memory are on', () => {
        const s = S.runSettings({ ...fileSettings, world_memory: false, cost_meter: false }, profile, true);
        for (const part of PART_SWITCHES) assert.equal(s[part], true, part);
        assert.equal(s.world_memory, true);
    });

    test('blockedFor: the blocked actions of the settings, the world memory and skill commands, and the parts that are off', () => {
        const blocked = S.blockedFor({ blocked_actions: ['!x'], world_memory: false, player_rules: true, cost_meter: true }, { capture: false, reuse: false, command: false });
        for (const name of ['!x', '!forgetPlace', '!nameWorld', '!skills', '!forgetSkill', '!disableSkill', '!enableSkill', '!useSkill', ...T.PART_COMMANDS.protected_areas, ...T.PART_COMMANDS.home_pack]) {
            assert.ok(blocked.includes(name), name);
        }
        for (const name of [...T.PART_COMMANDS.player_rules, '!cost']) assert.ok(!blocked.includes(name), name);
    });

    test('blockedFor: skill commands stay with their flags, no duplicates', () => {
        const blocked = S.blockedFor({ blocked_actions: ['!useSkill'], world_memory: true, player_rules: true, protected_areas: true, home_pack: true, cost_meter: true,
            storage_pack: true, farming_pack: true, wood_pack: true, mining_pack: true, routes_pack: true, mine_routes: true, watch_and_learn: true }, { capture: true, reuse: false, command: true });
        assert.deepEqual(blocked, ['!useSkill']);
    });

    test('planSentences: a sentence runs when its part is on', () => {
        const list = [
            { say: 'a', expect: ['!stop'], part: '' },
            { say: 'b', expect: ['!rememberRule'], part: 'player_rules' },
            { say: 'c', expect: ['!cost'], part: 'cost_meter' },
        ];
        assert.deepEqual(S.planSentences(list, { player_rules: false, cost_meter: true }).map((e) => e.run), [true, false, true]);
        assert.deepEqual(S.planSentences(list, { player_rules: true, cost_meter: false }).map((e) => e.run), [true, true, false]);
    });
});

describe('scripts/routing_check.js: results', () => {
    test('firstCommand uses the given command finder and returns null without a command', () => {
        const contains = (text) => (text.includes('!stop') ? '!stop' : null);
        assert.equal(S.firstCommand('Sure. !stop', contains), '!stop');
        assert.equal(S.firstCommand('Nothing', contains), null);
        assert.equal(S.firstCommand(undefined, contains), null);
        assert.equal(S.firstCommand('x', () => { throw new Error('boom'); }), null);
    });

    // v0.1.4.9 (D3): the summary with the time per answer and the measured cost (rtd_routing_check.test.js)
    test('summaryLine, as in the spec', () => {
        assert.equal(S.summaryLine(41, 50, { times: [1000], cost: { dollars: 0.5, unpriced_calls: 0 } }),
            'Accuracy: 41 of 50 (82%). Time per answer: median 1.0 s, mean 1.0 s. Cost: 0.50 dollars, measured.');
        assert.match(S.summaryLine(0, 0), /^Accuracy: 0 of 0 \(0%\)\. /);
        assert.match(S.summaryLine(2, 3), /^Accuracy: 2 of 3 \(67%\)\. /);
    });

    test('estimateTokens: 4 characters per token, rounded up', () => {
        assert.equal(S.estimateTokens(0), 0);
        assert.equal(S.estimateTokens(1), 1);
        assert.equal(S.estimateTokens(4000), 1000);
        assert.equal(S.estimateTokens(4001), 1001);
    });

    test('dryRunSummary: average, biggest and the estimated cost', () => {
        const lines = S.dryRunSummary([{ say: 'a', chars: 1000 }, { say: 'b', chars: 3000 }], {
            model: 'claude-haiku-4-5-20251001', price: { input: 1000, output: 5000, cache_read: 100, cache_write: 1250 },
            costOf: (usage, price) => (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1e6,
        });
        assert.deepEqual(lines, [
            'Prompts: 2. Average size: 2000 characters. Biggest: 3000 characters ("b").',
            'Estimated cost of a real run at the prices of claude-haiku-4-5-20251001: $2.00 (1000 input tokens and 200 output tokens, estimated with 4 characters per token and 100 output tokens per answer).',
        ]);
    });

    test('dryRunSummary without a price or without prompts', () => {
        const lines = S.dryRunSummary([{ say: 'a', chars: 10 }], { model: 'mystery-model', price: null, costOf: null });
        assert.equal(lines[1], 'Estimated cost of a real run: unknown, no price for mystery-model.');
        assert.deepEqual(S.dryRunSummary([], { model: 'm', price: null, costOf: null }), ['Prompts: 0.']);
    });

    test('formatTable pads the columns', () => {
        assert.equal(S.formatTable([['a', 'bb'], ['ccc', 'd']]), 'a    bb\nccc  d');
    });
});

describe('scripts/routing_check.js: without a key', () => {
    test('refuses to start without ANTHROPIC_API_KEY, sends nothing, writes nothing', () => {
        const cwd = makeTmpDir();
        try {
            const env = { ...process.env };
            delete env.ANTHROPIC_API_KEY;
            const run = runNodeScript(repoPath('scripts/routing_check.js'), [], { cwd, env });
            assert.equal(run.status, 1, run.stdout + run.stderr);
            assert.match(run.stdout + run.stderr, /ANTHROPIC_API_KEY/);
            assert.deepEqual(listDir(cwd), []);
        } finally {
            removeTmpDir(cwd);
        }
    });

    test('--help prints the usage and ends with 0', () => {
        const run = runNodeScript(repoPath('scripts/routing_check.js'), ['--help']);
        assert.equal(run.status, 0);
        assert.match(run.stdout, /--dry-run/);
        assert.match(run.stdout, /--all-parts/);
    });

    test('an unknown option ends with 2', () => {
        const run = runNodeScript(repoPath('scripts/routing_check.js'), ['--wat']);
        assert.equal(run.status, 2);
        assert.match(run.stdout + run.stderr, /--wat/);
    });
});
