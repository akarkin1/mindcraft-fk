// Spec v0.1.4.6, switch rule (section 0, principle 2, and the note of part G): with cost_meter,
// protected_areas, player_rules and home_pack off, no object of the new parts is created, no new
// command is offered to the model, no new mode exists, and the prompts are the ones of v0.1.4.5.
//
// 1. Source checks on the syntax tree, the same kind as tests/unit/skill_flags_off.test.js: every
//    use of a new object (agent.cost_meter, agent.area_store, bot.areaGuard, agent.rule_store) and
//    every call of a function of a new module is guarded by the object or its switch. The analyser
//    of the skill manager (tests/helpers/source_ast.js, analyseSkillGuardsInText) is reused: the
//    source is rewritten so that the object under test takes the place of `skill_manager` (the
//    skill manager's own names are renamed away first) and imports of the new modules look like
//    imports of skills/skill_*.js. The rewrite keeps every line break, so line numbers stay.
// 2. The runtime with the switches off: the list of modes, the command docs, the prompts, !stats.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { analyseSkillGuardsInText, readRepoFile, parseModule } from '../helpers/source_ast.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

// ---------------------------------------------------------------- 1. source checks

const slug = (spec) => spec.replace(/\.js$/, '').toLowerCase().replace(/[^a-z]+/g, '_');

// The source of relPath with `object` in the place of the skill manager and `modules` as skill modules.
function rewrite(relPath, object, modules) {
    let text = readRepoFile(relPath)
        .replace(/\bskill_manager\b/g, 'skillMgrOf0144')
        .replace(/\bskillManager\b/g, 'skillMgrB0144')
        .replace(/\bmanager\b/g, 'mgrOf0144')
        .replace(/skills\/skill_/g, 'skills/xkill_');
    for (const spec of modules)
        text = text.split(`'${spec}'`).join(`'./skills/skill_${slug(spec)}.js'`);
    if (object)
        text = text.replace(new RegExp(`\\b${object}\\b`, 'g'), 'skill_manager');
    return text;
}

function analyse(relPath, { object = null, modules = [], guard, exempt = [], tryRequired = [] }) {
    const text = rewrite(relPath, object, modules);
    for (const spec of modules)
        assert.ok(text.includes(`skills/skill_${slug(spec)}.js`), `${relPath} imports ${spec}`);
    return analyseSkillGuardsInText(text, { guardPattern: guard, exempt, tryRequired });
}

// [file, what, options]. guard: the renamed object (skill_manager) or the switch of the part.
const CASES = [
    ['src/agent/agent.js', 'the cost meter', { object: 'cost_meter', modules: ['./cost/usage_context.js', './cost/cost_meter.js'], guard: /skill_manager/, tryRequired: ['CostMeter', 'setUsageSink'] }],
    ['src/agent/agent.js', 'the area store and the guard', { object: 'area_store', modules: ['./areas/area_store.js', './areas/area_guard.js'], guard: /skill_manager|protected_areas/, tryRequired: ['AreaStore', 'installAreaGuard', 'load'] }],
    ['src/agent/agent.js', 'the rule store', { object: 'rule_store', modules: ['./rules/rule_store.js'], guard: /skill_manager|player_rules/, tryRequired: ['RuleStore', 'load'] }],
    ['src/agent/agent.js', 'the home pack', { modules: ['./packs/home/index.js'], guard: /home_pack/, tryRequired: ['autoEatOptions'] }],
    ['src/agent/commands/actions.js', 'the cost meter', { object: 'cost_meter', guard: /skill_manager/, tryRequired: ['allows'] }],
    // boxSize only measures an area that the caller has
    ['src/agent/commands/actions.js', 'the area store', { object: 'area_store', modules: ['../areas/area_geometry.js', '../areas/area_scan.js'], guard: /skill_manager/, exempt: ['boxSize'] }],
    // Amendment 2 F2: !allowChanges uses the full guard of the agent, bot.areaGuard has no permit
    ['src/agent/commands/actions.js', 'the area guard', { object: 'area_guard', guard: /skill_manager/, tryRequired: ['permit'] }],
    ['src/agent/commands/actions.js', 'the home pack', { modules: ['../packs/home/index.js'], guard: /home_pack/ }],
    ['src/agent/commands/queries.js', 'the cost meter', { object: 'cost_meter', guard: /skill_manager/, tryRequired: ['summaryText'] }],
    ['src/agent/commands/queries.js', 'the area store', { object: 'area_store', guard: /skill_manager/, tryRequired: ['areasAt', 'list'] }],
    ['src/agent/commands/queries.js', 'the home pack', { modules: ['../packs/home/index.js'], guard: /home_pack/ }],
    ['src/models/prompter.js', 'the cost meter', { object: 'cost_meter', modules: ['../agent/cost/usage_context.js'], guard: /skill_manager/ }],
    ['src/models/prompter.js', 'the rule store', { object: 'rule_store', modules: ['../agent/rules/rule_prompt.js'], guard: /skill_manager/, tryRequired: ['buildRulesSection', 'list'] }],
    ['src/agent/self_prompter.js', 'the cost meter', { object: 'cost_meter', guard: /skill_manager/, tryRequired: ['allows'] }],
    ['src/agent/library/skills.js', 'the area guard', { object: 'areaGuard', guard: /skill_manager/, tryRequired: ['canBreak', 'canPlace'] }],
    ['src/agent/modes.js', 'the area guard', { object: 'areaGuard', guard: /skill_manager/, tryRequired: ['canPlace'] }],
];

describe('source text: every use of a new object is guarded by the object or its switch', () => {
    for (const [file, what, options] of CASES) {
        test(`${file}: ${what}`, () => {
            const result = analyse(file, options);
            assert.ok(result.uses.length > 0, `${file} does not use ${what}`);
            assert.deepEqual(result.unguarded, [], `unguarded uses of ${what} in ${file}`);
            assert.deepEqual(result.notInTry, [], `uses of ${what} in ${file} that must be inside try`);
        });
    }

    test('the rewrite finds an unguarded use (the check is not empty)', () => {
        const text = "import { CostMeter } from './cost/cost_meter.js';\nthis.cost_meter = new CostMeter({});\nthis.cost_meter.check();\nif (this.cost_meter) this.cost_meter.flush();\n";
        const rewritten = text.split("'./cost/cost_meter.js'").join(`'./skills/skill_${slug('./cost/cost_meter.js')}.js'`).replace(/\bcost_meter\b/g, 'skill_manager');
        const result = analyseSkillGuardsInText(rewritten, { guardPattern: /skill_manager/ });
        assert.deepEqual(result.unguarded.map((u) => u.name), ['CostMeter', 'check']);
    });

    test('src/agent/agent.js: the commands of every part are named for blocked_actions', () => {
        const text = readRepoFile('src/agent/agent.js');
        for (const name of ['!cost', '!rememberRule', '!forgetRule', '!rules', '!rememberArea', '!setArea', '!forgetArea', '!areas', '!allowChanges', '!goToShelter', '!eat']) {
            assert.ok(text.includes(`'${name}'`), name);
        }
    });

    test('src/agent/modes.js: the functions of the home pack are called only by the three home modes', () => {
        // The three modes are added to the list by addHomeModes behind settings.home_pack (checked
        // at runtime below and in glue_modes.test.js); outside of their array only helpers that the
        // modes call may use the home pack.
        const text = readRepoFile('src/agent/modes.js');
        const ast = parseModule(text);
        const homeImport = ast.body.find((n) => n.type === 'ImportDeclaration' && n.source.value === './packs/home/index.js');
        assert.ok(homeImport, 'modes.js imports the home pack');
        const imported = new Set(homeImport.specifiers.map((s) => s.local.name));
        const declarator = ast.body.flatMap((n) => (n.type === 'VariableDeclaration' ? n.declarations : [])).find((d) => d.id.name === 'home_modes');
        assert.ok(declarator, 'modes.js has the array home_modes');
        const [start, end] = declarator.init.range;
        const inside = (node) => node.range[0] >= start && node.range[1] <= end;
        const functions = new Map(ast.body.filter((n) => n.type === 'FunctionDeclaration').map((n) => [n.id.name, n]));
        const calls = [];
        const references = new Map();
        const walk = (node, owner) => {
            if (!node || typeof node.type !== 'string') return;
            if (node.type === 'FunctionDeclaration' && node.id) owner = node.id.name;
            if ((node.type === 'CallExpression' || node.type === 'NewExpression') && node.callee.type === 'Identifier' && imported.has(node.callee.name)) calls.push({ node, owner });
            if (node.type === 'Identifier' && functions.has(node.name) && node !== functions.get(node.name).id) {
                if (!references.has(node.name)) references.set(node.name, []);
                references.get(node.name).push(node);
            }
            for (const [key, value] of Object.entries(node)) {
                if (key === 'range' || key === 'loc') continue;
                if (Array.isArray(value)) value.forEach((v) => walk(v, owner));
                else if (value && typeof value.type === 'string') walk(value, owner);
            }
        };
        walk(ast, null);
        assert.ok(calls.length >= 7, `calls of the home pack: ${calls.length}`);
        for (const { node, owner } of calls) {
            if (inside(node)) continue;
            assert.ok(owner, `a call of ${node.callee.name} outside of home_modes and outside of a function`);
            const refs = references.get(owner) ?? [];
            assert.ok(refs.length > 0 && refs.every(inside), `${owner} calls ${node.callee.name} and is used outside of home_modes`);
        }
    });
});

// ---------------------------------------------------------------- 2. runtime with the switches off

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        const modes = await loadSrc('src/agent/modes.js');
        const prompter = await loadSrc('src/models/prompter.js');
        const usage = await loadSrc('src/agent/cost/usage_context.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, index, queries, modes, prompter, usage, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();

const OFF = { cost_meter: false, protected_areas: false, player_rules: false, home_pack: false, world_memory: true, blocked_actions: [] };
M.settingsModule.setSettings({ ...OFF });

const MODES_0145 = ['self_preservation', 'unstuck', 'cowardice', 'self_defense', 'hunting', 'item_collecting', 'torch_placing', 'elbow_room', 'idle_staring', 'cheat'];
const NEW_COMMANDS = ['!cost', '!rememberRule', '!forgetRule', '!rules', '!rememberArea', '!setArea', '!forgetArea', '!areas', '!allowChanges', '!goToShelter', '!eat'];

describe('runtime with the switches off', () => {
    test('initModes: the modes of v0.1.4.5 in their order, none of the three home modes', () => {
        const agent = { bot: {}, prompter: { getInitModes: () => null } };
        M.modes.initModes(agent);
        const docs = agent.bot.modes.getMiniDocs();
        const names = docs.split('\n').slice(1).map((l) => l.replace(/^- /, '').replace(/\((ON|OFF)\)$/, ''));
        assert.deepEqual(names, MODES_0145);
        for (const name of ['creeper_safety', 'night_shelter', 'door_closing']) {
            assert.equal(agent.bot.modes.exists(name), false, name);
        }
        // a second initModes (a restart in the same process) changes nothing either
        M.modes.initModes(agent);
        assert.equal(agent.bot.modes.getMiniDocs(), docs);
    });

    test('the command docs with the blocked commands of agent.js: no new command, !goToBed as in v0.1.4.5', () => {
        const docs = M.index.getCommandDocs({ blocked_actions: [...NEW_COMMANDS] });
        for (const name of NEW_COMMANDS) {
            assert.ok(!docs.includes(`\n${name}:`) && !docs.startsWith(`${name}:`), `${name} is not offered`);
        }
        assert.ok(docs.includes('\n!goToBed: Go to the nearest bed and sleep.\n'), 'the old description of !goToBed');
    });

    test('!stats at night without an area store and with home_pack off: no new line', () => {
        M.mcdata.__setMcdataForTests({ biomes: { 1: { name: 'plains' } } });
        const bot = {
            entity: { position: { x: 1.5, y: 64, z: -3.25 } }, game: { dimension: 'overworld', gameMode: 'survival' },
            health: 20, food: 18, rainState: 0, thunderState: 0, time: { timeOfDay: 15000 }, entities: {}, players: {},
            world: { getBiome: () => 1 }, modes: { getMiniDocs: () => 'MODES' },
        };
        const agent = { name: 'andy', bot, actions: { currentActionLabel: '' }, isIdle: () => true };
        const stats = M.queries.queryList.find((c) => c.name === '!stats').perform(agent);
        assert.ok(!stats.includes('- Area:'), stats);
        assert.ok(!stats.includes('It is night. Stay in the shelter'), stats);
        assert.ok(stats.includes('\n- Time: Night\n- Current Action: Idle'), 'G6: Current Action on its own line');
    });

    test('the prompts: without a cost meter and a rule store the model gets the prompt of v0.1.4.5, outside of a purpose', async () => {
        const seen = [];
        const model = {
            async sendRequest(messages, prompt) {
                seen.push({ prompt, purpose: M.usage.currentPurpose() });
                return 'Hi!';
            },
        };
        const fake = Object.create(M.prompter.Prompter.prototype);
        Object.assign(fake, {
            agent: { name: 'andy', blocked_actions: [], self_prompter: { isStopped: () => true } },
            profile: { conversing: 'You are $NAME.\nConversation Begin:', coding: 'Write code.\nConversation:' },
            cooldown: 0, last_prompt_time: 0, awaiting_coding: false, convo_examples: null, coding_examples: null,
            chat_model: model, code_model: model,
        });
        const cap = captureConsole();
        try {
            assert.equal(await fake.promptConvo([{ role: 'user', content: 'bob: hi' }]), 'Hi!');
            await fake.promptCoding([{ role: 'user', content: 'bob: build' }]);
        } finally {
            cap.restore();
        }
        assert.deepEqual(seen, [
            { prompt: 'You are andy.\nConversation Begin:', purpose: 'other' },
            { prompt: 'Write code.\nConversation:', purpose: 'other' },
        ]);
    });
});
