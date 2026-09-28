// Spec v0.1.4.7, switch rule (section 7, part G): with storage_pack, farming_pack, wood_pack and
// mining_pack off, no object of the new parts is created, no new command is offered to the model,
// the old commands behave as in v0.1.4.6 and the prompts are the ones of v0.1.4.6.
//
// 1. Source checks on the syntax tree (tests/helpers/source_ast.js):
//    - no module outside the four packs imports one of them statically; agent.js imports them with
//      import(), each behind its switch and inside try (a missing pack cannot break the bot);
//    - agent.work_packs, the only way to the packs, is set once, behind the switches;
//    - every use of agent.work_packs and every call of agent.packContext() in agent.js, actions.js and
//      queries.js is guarded by a switch: the analyser of glue_flags_off.test.js, with work_packs in the
//      place of skill_manager;
//    - agent.js names the commands of each part for blocked_actions;
//    - modes.js: the depth check of night_shelter is behind mining_pack.
// 2. The runtime with the switches off: the command docs, the examples, the old commands.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { repoPath, REPO_ROOT } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { analyseSkillGuardsInText, moduleImports, parseModule, readRepoFile } from '../helpers/source_ast.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

const SWITCHES = ['storage_pack', 'farming_pack', 'wood_pack', 'mining_pack'];
const SWITCH_PATTERN = /storage_pack|farming_pack|wood_pack|mining_pack/;
const PACKS = ['storage', 'farming', 'wood', 'mining'];
const PACK_DIR = /(^|\/)src\/agent\/packs\/(storage|farming|wood|mining)\//;
// The switch that must guard the import of each pack (storage serves every part, wood serves mining).
const IMPORT_GUARD = { storage: SWITCHES, farming: ['farming_pack'], wood: ['wood_pack', 'mining_pack'], mining: ['mining_pack'] };

// ---------------------------------------------------------------- 1. source checks

function jsFiles(relDir) {
    const out = [];
    for (const entry of fs.readdirSync(repoPath(relDir), { withFileTypes: true })) {
        const rel = `${relDir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...jsFiles(rel));
        else if (entry.name.endsWith('.js')) out.push(rel);
    }
    return out;
}

// Every node with its parent, in source order.
function walk(ast) {
    const list = [];
    const visit = (node, parent) => {
        if (!node || typeof node.type !== 'string') return;
        list.push({ node, parent });
        for (const [key, value] of Object.entries(node)) {
            if (key === 'range' || key === 'loc') continue;
            if (Array.isArray(value)) value.forEach((v) => visit(v, node));
            else if (value && typeof value.type === 'string') visit(value, node);
        }
    };
    visit(ast, null);
    const parents = new Map(list.map(({ node, parent }) => [node, parent]));
    return { nodes: list.map(({ node }) => node), parents };
}

function ancestors(node, parents) {
    const out = [];
    let child = node;
    for (let p = parents.get(node); p; p = parents.get(p)) {
        out.push({ parent: p, child });
        child = p;
    }
    return out;
}

// The tests of the if statements whose consequent holds the node.
function ifTestsAbove(node, parents, text) {
    return ancestors(node, parents)
        .filter(({ parent, child }) => parent.type === 'IfStatement' && child === parent.consequent)
        .map(({ parent }) => text.slice(parent.test.range[0], parent.test.range[1]));
}

const inTry = (node, parents) => ancestors(node, parents).some(({ parent, child }) => parent.type === 'TryStatement' && child === parent.block);

// The files of the bot outside the packs of v0.1.4.7.
const BOT_FILES = [...jsFiles('src/agent'), ...jsFiles('src/models'), ...jsFiles('src/utils'), 'settings.js', 'main.js']
    .filter((rel) => !PACK_DIR.test(rel) && fs.existsSync(repoPath(rel)));

// The rewrite of glue_flags_off.test.js: `work_packs` takes the place of the skill manager; in the
// command files a call of packContext() and a call of the helper runPack() count as uses too.
// Line breaks are kept.
function rewrite(relPath, { packContext = false } = {}) {
    let text = readRepoFile(relPath)
        .replace(/\bskill_manager\b/g, 'skillMgrOf0144')
        .replace(/\bskillManager\b/g, 'skillMgrB0144')
        .replace(/\bmanager\b/g, 'mgrOf0144')
        .replace(/skills\/skill_/g, 'skills/xkill_')
        .replace(/\bwork_packs\?\./g, 'skill_manager.')
        .replace(/\bwork_packs\b/g, 'skill_manager');
    if (packContext) {
        text = text.replace(/\.packContext\(/g, '.skill_manager.packContext(')
            .replace(/(?<!function )\brunPack\(/g, 'skill_manager.runPack(');
    }
    return text;
}

// The lines of the body of a function declaration of the file, or null.
function linesOfFunction(relPath, name) {
    const text = readRepoFile(relPath);
    const fn = parseModule(text).body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === name);
    if (!fn) return null;
    const lineOf = (offset) => text.slice(0, offset).split('\n').length;
    return [lineOf(fn.body.range[0]), lineOf(fn.body.range[1])];
}

describe('source text: the packs of v0.1.4.7 are reached only behind their switches', () => {
    test('no module of the bot imports one of the four packs statically', () => {
        assert.ok(BOT_FILES.length > 50, `${BOT_FILES.length} files`);
        for (const rel of BOT_FILES) {
            const dir = path.dirname(repoPath(rel));
            for (const spec of moduleImports(rel).specifiers) {
                if (!spec.startsWith('.')) continue;
                const target = path.relative(REPO_ROOT, path.resolve(dir, spec)).split(path.sep).join('/');
                assert.ok(!PACK_DIR.test(target), `${rel} imports ${spec}`);
            }
        }
    });

    test('agent.js imports each pack with import(), behind its switch and inside try; no other module does', () => {
        const found = [];
        for (const rel of BOT_FILES) {
            const text = readRepoFile(rel);
            const { nodes, parents } = walk(parseModule(text));
            for (const node of nodes) {
                if (node.type !== 'ImportExpression') continue;
                const spec = node.source.type === 'Literal' ? String(node.source.value) : null;
                const pack = spec?.match(/packs\/(storage|farming|wood|mining)\//)?.[1] ?? null;
                if (rel !== 'src/agent/agent.js') {
                    // other modules may load their own files by a computed name (the model adapters of _model_map.js)
                    assert.ok(pack === null, `${rel}: import(${text.slice(node.source.range[0], node.source.range[1])})`);
                    continue;
                }
                assert.ok(spec !== null, 'agent.js: every import() names its module');
                if (pack === null) continue;
                found.push(pack);
                assert.equal(spec, `./packs/${pack}/index.js`);
                const tests = ifTestsAbove(node, parents, text);
                assert.ok(tests.length > 0, `import of ${pack} behind an if`);
                for (const name of IMPORT_GUARD[pack]) assert.ok(tests.some((t) => t.includes(`settings.${name}`)), `import of ${pack} behind ${name}`);
                for (const t of tests) assert.ok(SWITCH_PATTERN.test(t) && !/[!=]=|!\s*settings/.test(t), `a positive test of the switches: ${t}`);
                assert.ok(inTry(node, parents), `import of ${pack} inside try`);
            }
        }
        assert.deepEqual(found.sort(), [...PACKS].sort());
    });

    test('agent.work_packs is set once, in agent.js, behind the switches', () => {
        const sets = [];
        for (const rel of BOT_FILES) {
            const text = readRepoFile(rel);
            const { nodes, parents } = walk(parseModule(text));
            for (const node of nodes) {
                if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && node.left.property.name === 'work_packs') {
                    sets.push(rel);
                    const tests = ifTestsAbove(node, parents, text);
                    assert.ok(tests.some((t) => SWITCHES.every((name) => t.includes(`settings.${name}`))), `${rel}: work_packs is set behind the four switches`);
                }
            }
        }
        assert.deepEqual(sets, ['src/agent/agent.js']);
    });

    const CASES = [
        ['src/agent/agent.js', { guard: /skill_manager|storage_pack|farming_pack|wood_pack|mining_pack/ }],
        ['src/agent/commands/actions.js', { guard: SWITCH_PATTERN, packContext: true }],
        ['src/agent/commands/queries.js', { guard: SWITCH_PATTERN, packContext: true }],
    ];
    for (const [file, { guard, packContext }] of CASES) {
        test(`${file}: every use of work_packs${packContext ? ', packContext() and runPack()' : ''} is guarded by a switch`, () => {
            const result = analyseSkillGuardsInText(rewrite(file, { packContext }), { guardPattern: guard });
            assert.ok(result.uses.length > 0, `${file} uses work_packs`);
            // runPack gets the pack from its callers, and every call of runPack is a use that must be guarded
            const helper = packContext ? linesOfFunction(file, 'runPack') : null;
            const unguarded = result.unguarded.filter((u) => !(helper && u.line >= helper[0] && u.line <= helper[1] && u.name === 'packContext'));
            assert.deepEqual(unguarded, [], `unguarded uses in ${file}`);
            if (file.endsWith('actions.js')) assert.ok(result.uses.filter((u) => u.name === 'runPack').length >= 14, 'the calls of runPack are checked');
        });
    }

    test('the check finds an unguarded use (it is not empty)', () => {
        const text = "function f(agent) {\n    return agent.skill_manager.storage.storeItems();\n}\nfunction g(agent) {\n    if (settings.storage_pack) agent.skill_manager.storage.x();\n}\n";
        const result = analyseSkillGuardsInText(text, { guardPattern: SWITCH_PATTERN });
        assert.deepEqual(result.uses.map((u) => u.line), [2, 5]);
        assert.deepEqual(result.unguarded.map((u) => u.line), [2]);
    });

    test('packContext() is called only in the command files', () => {
        for (const rel of BOT_FILES) {
            const calls = [...readRepoFile(rel).matchAll(/\.packContext\(/g)].length;
            if (!['src/agent/commands/actions.js', 'src/agent/commands/queries.js'].includes(rel)) assert.equal(calls, 0, rel);
        }
    });

    test('agent.js names the commands of every part of v0.1.4.7 for blocked_actions, each group behind the switch of its part', () => {
        const text = readRepoFile('src/agent/agent.js');
        const groups = {
            storage_pack: ['!storeItems', '!fetchItem', '!chests'],
            farming_pack: ['!farmCycle', '!harvest', '!plant', '!makeBoneMeal', '!fertilize'],
            wood_pack: ['!chopTrees', '!getTool', '!craftSupplies'],
            mining_pack: ['!mineOre', '!goToMine', '!leaveMine'],
        };
        const pack = { storage_pack: 'storage', farming_pack: 'farming', wood_pack: 'wood', mining_pack: 'mining' };
        for (const [part, names] of Object.entries(groups)) {
            const line = `if (!settings.${part} || !this.work_packs?.${pack[part]})\r\n            this.blocked_actions.push(${names.map((n) => `'${n}'`).join(', ')});`;
            assert.ok(text.includes(line) || text.includes(line.replace('\r\n', '\n')), part);
        }
    });

    test('modes.js: the depth of night_shelter is measured only while mining_pack is on', () => {
        const text = readRepoFile('src/agent/modes.js');
        const { nodes, parents } = walk(parseModule(text));
        const calls = nodes.filter((n) => n.type === 'CallExpression' && n.callee.type === 'Identifier' && ['depthOfBot', 'nightShelterWaits'].includes(n.callee.name));
        assert.ok(calls.length >= 2, `${calls.length} calls`);
        for (const call of calls) {
            const guarded = ancestors(call, parents).some(({ parent, child }) => parent.type === 'LogicalExpression' && parent.operator === '&&' && child === parent.right
                && text.slice(parent.left.range[0], parent.left.range[1]) === 'settings.mining_pack');
            assert.ok(guarded, text.slice(call.range[0], call.range[1]));
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
        const actions = await loadSrc('src/agent/commands/actions.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, index, actions, queries, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
    }
}

const M = await importQuietly();
const T = await loadSrc('tests/routing/commands.js');
const F = await loadSrc('src/agent/rules/example_filter.js');
const PROFILE = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
const NEW_COMMANDS = SWITCHES.flatMap((part) => T.PART_COMMANDS[part]);
const COMMANDS_0146 = ['cost_meter', 'protected_areas', 'player_rules', 'home_pack'].flatMap((part) => T.PART_COMMANDS[part]);

before(() => M.mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => M.mcdata.__setMcdataForTests(null));

const command = (name) => M.actions.actionsList.find((c) => c.name === name) ?? M.queries.queryList.find((c) => c.name === name);

// An agent whose packs and pack context must not be touched.
function untouchable(extra = {}) {
    const agent = { name: 'andy', ...extra };
    for (const key of ['work_packs', 'packContext']) {
        Object.defineProperty(agent, key, { get() { throw new Error(`${key} was used with the switches off`); } });
    }
    return agent;
}

describe('runtime with the four switches off', () => {
    test('the command docs: none of the new commands, the rest exactly as without them', () => {
        M.settingsModule.setSettings({ world_memory: true, blocked_actions: [] });
        const docs = M.index.getCommandDocs({ blocked_actions: [...NEW_COMMANDS] });
        for (const name of NEW_COMMANDS) assert.ok(!docs.includes(`\n${name}:`), name);
        const without = [...M.queries.queryList, ...M.actions.actionsList].filter((c) => !NEW_COMMANDS.includes(c.name));
        assert.equal(docs, M.index.getCommandDocs({ blocked_actions: [] }, without));
    });

    test('the old commands that lead to the new skills have their words of v0.1.4.6', () => {
        const docs = M.index.getCommandDocs({ blocked_actions: [...NEW_COMMANDS] });
        for (const part of [
            '\n!putInChest: Put the given item in the nearest chest.\nParams:\nitem_name: (string) The name of the item to put in the chest.\nnum: (number) The number of items to put in the chest.\n',
            '\n!takeFromChest: Take the given items from the nearest chest.\nParams:\nitem_name: (string) The name of the item to take.\nnum: (number) The number of items to take.\n',
            '\n!viewChest: View the items/counts of the nearest chest.\nParams:\n!discard:',
            '\n!collectBlocks: Collect the nearest blocks of a given type.\nParams:\ntype: (string) The block type to collect.\nnum: (number) The number of blocks to collect. (optional, default 1)\n',
        ]) {
            assert.ok(docs.includes(part), part);
        }
    });

    test('the examples: with the new commands hidden, exactly the examples of v0.1.4.6, for every choice of the parts of v0.1.4.6', () => {
        const old = PROFILE.conversation_examples.filter((e) => !F.exampleCommands(e).some((n) => NEW_COMMANDS.includes(n)));
        assert.equal(old.length, 36, 'the 36 examples of v0.1.4.6');
        assert.deepEqual(PROFILE.conversation_examples.slice(0, 36), old, 'unchanged and first');
        for (let mask = 0; mask < 16; mask++) {
            const hidden = new Set([...NEW_COMMANDS, ...COMMANDS_0146.filter((_, i) => mask & (1 << (i % 4)))]);
            const isHidden = (name) => hidden.has(name);
            assert.deepEqual(F.visibleExamples(PROFILE.conversation_examples, isHidden), F.visibleExamples(old, isHidden));
            assert.deepEqual(F.visibleExamples(PROFILE.coding_examples, isHidden), PROFILE.coding_examples.filter((e) => !F.exampleCommands(e).some(isHidden)));
        }
    });

    test('the new commands answer that their part is off and touch no pack', async () => {
        M.settingsModule.setSettings({ world_memory: true });
        const off = { storage_pack: 'The storage pack is off.', farming_pack: 'The farming pack is off.', wood_pack: 'The wood pack is off.', mining_pack: 'The mining pack is off.' };
        for (const part of SWITCHES) {
            for (const name of T.PART_COMMANDS[part]) {
                const args = { '!fetchItem': ['bread', 1], '!getTool': ['axe', ''], '!craftSupplies': ['torch', 1], '!mineOre': ['iron', 8] }[name] ?? [];
                assert.equal(await command(name).perform(untouchable(), ...args), off[part], name);
            }
        }
    });

    test('!collectBlocks: the old collecting as an action with the 10 minute timeout, no pack consulted', async () => {
        for (const type of ['wheat', 'oak_log', 'iron_ore', 'stone']) {
            M.settingsModule.setSettings({ world_memory: true });
            const runs = [];
            const agent = untouchable({
                bot: { output: '' },
                actions: { async runAction(label, fn, options) { runs.push({ label, options }); return { success: true, message: 'Action output:\nold', interrupted: false, timedout: false }; } },
            });
            assert.equal(await command('!collectBlocks').perform(agent, type, 3), 'Action output:\nold', type);
            assert.deepEqual(runs, [{ label: 'action:collectBlocks', options: { timeout: 10, resume: false } }], type);
        }
    });

    test('!collectBlocks interrupted: nothing, as in v0.1.4.6', async () => {
        M.settingsModule.setSettings({ world_memory: true });
        const agent = untouchable({ actions: { async runAction() { return { success: false, message: 'x', interrupted: true, timedout: false }; } } });
        assert.equal(await command('!collectBlocks').perform(agent, 'stone', 1), undefined);
    });

    test('!putInChest: the chest is looked for once, by the old skill only; no index', async () => {
        M.settingsModule.setSettings({ world_memory: true });
        let finds = 0;
        const bot = {
            output: '', interrupt_code: false, entity: { position: { x: 0, y: 64, z: 0 } },
            findBlocks() { finds++; return []; },
            blockAt: () => null,
        };
        const agent = untouchable({
            bot,
            actions: { async runAction(label, fn) { await fn(); return { success: true, message: bot.output, interrupted: false, timedout: false }; } },
        });
        const cap = captureConsole();
        let reply;
        try {
            reply = await command('!putInChest').perform(agent, 'bread', 1);
        } finally {
            cap.restore();
        }
        assert.equal(finds, 1);
        assert.match(reply, /Could not find a chest nearby\./);
    });

    test('!takeFromChest and !viewChest: the chest for the index is looked for only while storage_pack is on (source)', () => {
        const text = readRepoFile('src/agent/commands/actions.js').replace(/\r\n/g, '\n');
        for (const skill of ['putInChest(agent.bot, item_name, num)', 'takeFromChest(agent.bot, item_name, num)', 'viewChest(agent.bot)']) {
            const block = `            const chest = chestToRecord(agent); // v0.1.4.7, S4: null while storage_pack is off\n            await skills.${skill};\n            await recordChest(agent, chest);\n`;
            assert.ok(text.includes(block), skill);
        }
        const helper = text.slice(text.indexOf('function chestToRecord'), text.indexOf('// S4, Amendment 1'));
        assert.ok(helper.includes('if (!settings.storage_pack || !agent.work_packs?.storage)\n        return null;'), 'chestToRecord returns first while storage_pack is off');
    });
});
