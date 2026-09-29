// Spec v0.1.4.7, section 7 (part G): the commands of S4, F3, T5 and M5 and the old commands that lead
// to the new skills, in src/agent/commands/actions.js and queries.js.
//   - the names, descriptions and parameters of the spec (the table of tests/routing/commands.js);
//   - each command calls its function of the pack with the bot, the pack context and its arguments,
//     runs as the action `action:<name>` without a time limit and answers with the text of the
//     result word for word; nothing when it was interrupted;
//   - a switch that is on while its pack could not be loaded: the command says so;
//   - !collectBlocks: crops, logs and ores lead to harvestCrops, chopTrees and mineOre while their
//     switch is on; an ore in sight is collected the old way;
//   - !putInChest updates the chest index with lookIntoChest; !chests lists the index;
//   - !goToMine finds the mine of the ore or the nearest mine.
// The packs are fakes that are put into agent.work_packs, as the agent does after loading them; the
// real functions of the finished packs are used where the glue calls a helper of them.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { vec } from '../helpers/block_world.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

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
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const T = await loadSrc('tests/routing/commands.js');
const STORAGE = await loadSrc('src/agent/packs/storage/index.js');
const FARMING = await loadSrc('src/agent/packs/farming/index.js');
const WOOD = await loadSrc('src/agent/packs/wood/index.js');

const ON = { world_memory: true, storage_pack: true, farming_pack: true, wood_pack: true, mining_pack: true };
const SWITCHES = ['storage_pack', 'farming_pack', 'wood_pack', 'mining_pack'];
const PACK_OF = { storage_pack: 'storage', farming_pack: 'farming', wood_pack: 'wood', mining_pack: 'mining' };

before(() => M.mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => M.mcdata.__setMcdataForTests(null));

let cap;
beforeEach(() => {
    cap = captureConsole();
    M.settingsModule.setSettings({ ...ON });
});
afterEach(() => cap.restore());

const command = (name) => {
    const cmd = M.actions.actionsList.find((c) => c.name === name) ?? M.queries.queryList.find((c) => c.name === name);
    assert.ok(cmd, `${name} exists`);
    return cmd;
};

// A fake pack: every named function records its arguments and returns { ok, text }.
function fakePack(names, extra = {}) {
    const pack = { calls: [], ...extra };
    for (const name of names) {
        pack[name] = async (...args) => {
            pack.calls.push({ name, args });
            return { ok: true, reason: null, text: `${name} text` };
        };
    }
    return pack;
}

function makePacks() {
    return {
        storage: fakePack(['storeItems', 'fetchItem', 'lookIntoChest'], { chestsText: (ctx, dimension) => `chests of ${dimension} ${ctx.marker}` }),
        farming: fakePack(['farmCycle', 'harvestCrops', 'plantField', 'makeBoneMeal', 'fertilize'], { harvestTarget: FARMING.harvestTarget }),
        wood: fakePack(['chopTrees', 'ensureTool', 'craftSupplies'], { woodKind: WOOD.woodKind }),
        mining: fakePack(['mineOre', 'descendToLevel', 'climbToSurface'], { oreOf: (name) => (/iron|coal|diamond/.test(name) ? { ore: name.match(/iron|coal|diamond/)[0] } : null) }),
    };
}

// A fake agent. runAction runs the action unless it is the old collecting (a 10 minute limit).
function makeAgent({ packs = makePacks(), interrupted = false, bot = {} } = {}) {
    const agent = {
        name: 'andy',
        bot: { username: 'andy', entity: { position: vec(0.5, 64, 0.5) }, game: { dimension: 'overworld' }, output: '', interrupt_code: false, ...bot },
        work_packs: packs,
        contexts: [],
        runs: [],
        mines: null,
        packContext() {
            const ctx = { marker: 'ctx', mines: agent.mines, log: () => {} };
            agent.contexts.push(ctx);
            return ctx;
        },
        actions: {
            async runAction(label, fn, options) {
                agent.runs.push({ label, options });
                if (options.timeout === 10)
                    return { success: true, message: 'Action output:\nold collecting', interrupted: false, timedout: false };
                await fn();
                return { success: true, message: 'Action output:\nlog', interrupted, timedout: false };
            },
        },
    };
    return agent;
}

const NEW = SWITCHES.flatMap((part) => T.PART_COMMANDS[part]);

describe('the commands of v0.1.4.7: names, descriptions and parameters of the spec', () => {
    for (const entry of T.SPEC_COMMANDS.filter((c) => NEW.includes(c.name))) {
        test(entry.name, () => {
            const cmd = command(entry.name);
            assert.equal(cmd.description, entry.description);
            const params = Object.entries(cmd.params ?? {});
            assert.deepEqual(params.map(([name]) => name), entry.params.map((p) => p.name));
            for (const [i, [, param]] of params.entries()) {
                assert.equal(param.type, entry.params[i].type, `${entry.name} ${entry.params[i].name}`);
                assert.equal(param.default, entry.params[i].default, `${entry.name} ${entry.params[i].name} default`);
                assert.equal(typeof param.description, 'string');
            }
            assert.equal(M.index.isAction(entry.name), entry.name !== '!chests', 'every command but !chests is an action');
        });
    }

    test('the parser fills the defaults', () => {
        const cases = [
            // v0.1.4.8 (part G): !chests has an item, !mineOre new_mine, !chopTrees takes a word first too
            ['!storeItems', []], ['!fetchItem("bread")', ['bread', 1]], ['!chests', ['']], ['!farmCycle', ['']], ['!harvest("wheat_farm")', ['wheat_farm']],
            ['!plant', ['wheat_seeds', '']], ['!plant("carrot")', ['carrot', '']], ['!makeBoneMeal', [1]], ['!fertilize', ['']], ['!chopTrees', [8, '']],
            ['!chopTrees(4, "birch")', [4, 'birch']], ['!chopTrees("birch", 4)', ['birch', '4']], ['!chopTrees("", 8)', ['', '8']],
            ['!getTool("pickaxe")', ['pickaxe', '']], ['!craftSupplies("ladder")', ['ladder', 1]],
            ['!mineOre("iron")', ['iron', 8, false]], ['!mineOre("iron", 8, true)', ['iron', 8, true]], ['!goToMine', ['']], ['!leaveMine', []],
        ];
        for (const [message, args] of cases) assert.deepEqual(M.index.parseCommandMessage(message).args, args, message);
        assert.equal(M.index.parseCommandMessage('!fetchItem("not_an_item", 2)'), 'Invalid item type: not_an_item.');
    });
});

describe('each command calls its pack and answers with the text of the result', () => {
    // [command, args, pack, function, expected arguments after bot and ctx]
    const CASES = [
        ['!storeItems', [], 'storage', 'storeItems', [{}]],
        ['!fetchItem', ['bread', 5], 'storage', 'fetchItem', ['bread', 5]],
        ['!farmCycle', ['wheat_farm'], 'farming', 'farmCycle', ['wheat_farm']],
        ['!harvest', [''], 'farming', 'harvestCrops', ['']],
        ['!plant', ['carrot', 'veg'], 'farming', 'plantField', ['veg', 'carrot']],
        ['!makeBoneMeal', [3], 'farming', 'makeBoneMeal', [3]],
        ['!fertilize', [''], 'farming', 'fertilize', ['']],
        ['!chopTrees', [8, 'oak'], 'wood', 'chopTrees', [8, 'oak']],
        ['!getTool', ['pickaxe', 'stone'], 'wood', 'ensureTool', ['pickaxe', 'stone']],
        ['!craftSupplies', ['ladder', 9], 'wood', 'craftSupplies', ['ladder', 9]],
        // v0.1.4.8 (E4): new_mine reaches the pack as options.newMine, false without it
        ['!mineOre', ['iron', 6], 'mining', 'mineOre', ['iron', 6, { newMine: false }]],
        ['!leaveMine', [], 'mining', 'climbToSurface', []],
    ];
    for (const [name, args, pack, fn, expected] of CASES) {
        test(`${name}(${args.map((a) => JSON.stringify(a)).join(', ')}) -> ${pack}.${fn}`, async () => {
            const agent = makeAgent();
            const reply = await command(name).perform(agent, ...args);
            assert.equal(reply, `${fn} text`);
            assert.deepEqual(agent.runs, [{ label: `action:${name.slice(1)}`, options: { timeout: -1, resume: false } }]);
            const calls = agent.work_packs[pack].calls;
            assert.equal(calls.length, 1);
            assert.equal(calls[0].name, fn);
            assert.equal(calls[0].args[0], agent.bot);
            assert.equal(calls[0].args[1], agent.contexts[0], 'the pack context of the agent, made when the action runs');
            assert.deepEqual(calls[0].args.slice(2), expected);
        });
    }

    test('interrupted: nothing', async () => {
        for (const [name, args] of [['!storeItems', []], ['!farmCycle', ['']], ['!chopTrees', [8, '']], ['!mineOre', ['coal', 8]], ['!goToMine', ['']]]) {
            assert.equal(await command(name).perform(makeAgent({ interrupted: true }), ...args), undefined, name);
        }
    });

    test('a result without a text: the output of the action', async () => {
        const packs = makePacks();
        packs.storage.storeItems = async () => ({ ok: false });
        assert.equal(await command('!storeItems').perform(makeAgent({ packs })), 'Action output:\nlog');
    });

    test('a switch on and its pack not loaded: the command says so and runs nothing', async () => {
        for (const part of SWITCHES) {
            const pack = PACK_OF[part];
            for (const name of T.PART_COMMANDS[part]) {
                const packs = makePacks();
                delete packs[pack];
                const agent = makeAgent({ packs });
                const reply = await command(name).perform(agent, ...(name === '!fetchItem' ? ['bread', 1] : []));
                assert.equal(reply, `The ${pack} pack could not be loaded.`, name);
                assert.deepEqual(agent.runs, [], name);
            }
        }
    });

    test('each switch hides nothing of the other parts: one switch off answers only for its own commands', async () => {
        M.settingsModule.setSettings({ ...ON, wood_pack: false });
        assert.equal(await command('!chopTrees').perform(makeAgent(), 8, ''), 'The wood pack is off.');
        assert.equal(await command('!storeItems').perform(makeAgent()), 'storeItems text');
    });
});

describe('!collectBlocks leads to the new skills while their switch is on', () => {
    const noOre = { findBlocks: () => [], blockAt: () => null, canSeeBlock: () => false };

    test('a crop block: harvestCrops of the nearest farm with the number as limit', async () => {
        const agent = makeAgent({ bot: noOre });
        assert.equal(await command('!collectBlocks').perform(agent, 'wheat', 5), 'harvestCrops text');
        assert.deepEqual(agent.work_packs.farming.calls[0].args.slice(2), ['', { limit: 5 }]);
        assert.deepEqual(agent.runs, [{ label: 'action:collectBlocks', options: { timeout: -1, resume: false } }]);
    });

    test('a log: chopTrees with the kind of the log', async () => {
        const agent = makeAgent({ bot: noOre });
        assert.equal(await command('!collectBlocks').perform(agent, 'birch_log', 6), 'chopTrees text');
        assert.deepEqual(agent.work_packs.wood.calls[0].args.slice(2), [6, 'birch']);
        const stem = makeAgent({ bot: noOre });
        await command('!collectBlocks').perform(stem, 'crimson_stem', 2);
        assert.deepEqual(stem.work_packs.wood.calls[0].args.slice(2), [2, 'crimson']);
    });

    test('an ore that is not in sight: mineOre with the ore of the block and the number', async () => {
        const agent = makeAgent({ bot: noOre });
        assert.equal(await command('!collectBlocks').perform(agent, 'iron_ore', 4), 'mineOre text');
        assert.deepEqual(agent.work_packs.mining.calls[0].args.slice(2), ['iron', 4]);
    });

    test('with the ore table of the mining pack, once it exists: every ore block leads to its ore', async (t) => {
        const table = await loadSrc('src/agent/packs/mining/ore_table.js');
        let oreOf;
        try {
            oreOf = table.oreOf;
        } catch {
            t.skip('the ore table of the mining pack is in work');
            return;
        }
        const packs = makePacks();
        packs.mining.oreOf = oreOf;
        for (const [type, ore] of [['coal_ore', 'coal'], ['deepslate_diamond_ore', 'diamond'], ['lapis_ore', 'lapis'], ['redstone_ore', 'redstone']]) {
            const agent = makeAgent({ packs, bot: noOre });
            await command('!collectBlocks').perform(agent, type, 3);
            assert.deepEqual(packs.mining.calls.at(-1).args.slice(2), [ore, 3], type);
        }
        for (const type of ['stone', 'nether_gold_ore', 'ancient_debris']) {
            const agent = makeAgent({ packs, bot: noOre });
            assert.equal(await command('!collectBlocks').perform(agent, type, 1), 'Action output:\nold collecting', type);
        }
    });

    test('an ore within 16 blocks that the bot can see: the old collecting; one it cannot see: mineOre', async () => {
        for (const [see, expected] of [[true, 'Action output:\nold collecting'], [false, 'mineOre text']]) {
            const asked = [];
            const bot = {
                findBlocks(options) {
                    asked.push(options);
                    return [vec(3, 60, 0)];
                },
                blockAt: (pos) => ({ name: 'deepslate_iron_ore', position: pos }),
                canSeeBlock: () => see,
            };
            const agent = makeAgent({ bot });
            assert.equal(await command('!collectBlocks').perform(agent, 'deepslate_iron_ore', 2), expected);
            assert.equal(asked[0].maxDistance, 16);
            const ids = ['iron_ore', 'deepslate_iron_ore'].map((name) => M.mcdata.getBlockId(name));
            for (const id of ids) assert.ok(asked[0].matching.includes(id), 'both stones of the ore');
        }
    });

    test('other blocks, worked wood and blocks of a part that is off: the old collecting', async () => {
        for (const type of ['stone', 'dirt', 'stripped_oak_log', 'oak_planks', 'mushroom_stem', 'farmland']) {
            const agent = makeAgent({ bot: noOre });
            assert.equal(await command('!collectBlocks').perform(agent, type, 1), 'Action output:\nold collecting', type);
            assert.deepEqual(agent.runs, [{ label: 'action:collectBlocks', options: { timeout: 10, resume: false } }], type);
        }
        for (const [part, type] of [['farming_pack', 'wheat'], ['wood_pack', 'oak_log'], ['mining_pack', 'coal_ore']]) {
            M.settingsModule.setSettings({ ...ON, [part]: false });
            const agent = makeAgent({ bot: noOre });
            assert.equal(await command('!collectBlocks').perform(agent, type, 1), 'Action output:\nold collecting', type);
        }
    });

    test('a pack whose helper throws: the old collecting', async () => {
        const packs = makePacks();
        packs.farming.harvestTarget = () => { throw new Error('boom'); };
        assert.equal(await command('!collectBlocks').perform(makeAgent({ packs, bot: noOre }), 'wheat', 1), 'Action output:\nold collecting');
    });
});

describe('storage: the old chest commands and !chests', () => {
    test('!putInChest with storage_pack on: after the old skill, lookIntoChest on the chest it used, its messages to the console', async () => {
        const chestPos = vec(3, 64, 0);
        const chestId = M.mcdata.getBlockId('chest');
        const bot = {
            findBlocks: ({ matching }) => ((Array.isArray(matching) ? matching : [matching]).includes(chestId) ? [chestPos] : []),
            blockAt: (pos) => ({ name: 'chest', position: pos }),
            inventory: { findInventoryItem: () => null },
        };
        const agent = makeAgent({ bot });
        const reply = await command('!putInChest').perform(agent, 'bread', 1);
        assert.match(reply, /log/);
        const calls = agent.work_packs.storage.calls;
        assert.deepEqual(calls.map((c) => c.name), ['lookIntoChest']);
        assert.equal(calls[0].args[0], agent.bot);
        assert.deepEqual(calls[0].args[2], chestPos);
        assert.equal(calls[0].args[1], agent.contexts[0], 'the pack context');
        assert.match(agent.bot.output, /You do not have any bread to put in the chest\./);
        calls[0].args[1].log('not in the output');
        assert.ok(!agent.bot.output.includes('not in the output'));
    });

    test('!putInChest without a chest nearby: no index update', async () => {
        const agent = makeAgent({ bot: { findBlocks: () => [], blockAt: () => null, inventory: { findInventoryItem: () => null } } });
        await command('!putInChest').perform(agent, 'bread', 1);
        assert.deepEqual(agent.work_packs.storage.calls, []);
    });

    // v0.1.4.8 (C2): chestsText(ctx, item, dimension), the item empty for the list of all chests
    test('!chests: chestsText of the pack for the dimension of the bot', () => {
        const packs = makePacks();
        const seen = [];
        packs.storage.chestsText = (ctx, item, dimension) => {
            seen.push([ctx.marker, item, dimension]);
            return `chests of ${dimension} ${ctx.marker}`;
        };
        assert.equal(command('!chests').perform(makeAgent({ packs })), 'chests of overworld ctx');
        assert.equal(command('!chests').perform(makeAgent({ packs }), 'wheat'), 'chests of overworld ctx');
        assert.deepEqual(seen, [['ctx', '', 'overworld'], ['ctx', 'wheat', 'overworld']]);
    });

    test('!chests with the real storage pack and an index in memory', () => {
        const index = new STORAGE.ChestIndex(null);
        const agent = makeAgent({ packs: { storage: STORAGE } });
        agent.packContext = () => ({ chests: index });
        assert.equal(command('!chests').perform(agent), 'I know no chests in this world.');
        index.update({ x: -13, y: 63, z: 28, dimension: 'overworld', kind: 'chest', items: { wheat: 12, wheat_seeds: 3 }, free_slots: 4, seen: '2026-09-28T00:00:00.000Z' });
        assert.equal(command('!chests').perform(agent), 'Chests I know in this world:\n- (-13, 63, 28): 12 wheat, 3 wheat_seeds, 4 free slots');
    });

    test('!chests: switch off, pack missing, an error', () => {
        M.settingsModule.setSettings({ ...ON, storage_pack: false });
        assert.equal(command('!chests').perform(makeAgent()), 'The storage pack is off.');
        M.settingsModule.setSettings({ ...ON });
        assert.equal(command('!chests').perform(makeAgent({ packs: {} })), 'The storage pack could not be loaded.');
        const packs = makePacks();
        packs.storage.chestsText = () => { throw new Error('boom'); };
        assert.equal(command('!chests').perform(makeAgent({ packs })), 'Could not list the chests.');
    });
});

describe('!goToMine', () => {
    const MINES = [
        { ore: 'iron', level: 16, entrance: { x: 20, y: 64, z: -14 } },
        { ore: 'diamond', level: -59, entrance: { x: -5, y: 70, z: 3 } },
    ];
    const store = (list) => ({ list: () => list, get: (ore) => list.find((m) => m.ore === ore) ?? null });

    test('with an ore: descendToLevel to the level of its mine', async () => {
        const agent = makeAgent();
        agent.mines = store(MINES);
        assert.equal(await command('!goToMine').perform(agent, 'iron'), 'descendToLevel text');
        assert.deepEqual(agent.work_packs.mining.calls[0].args.slice(2), [16, { mine: MINES[0] }]);
    });

    test('without an ore: the nearest mine', async () => {
        const agent = makeAgent();
        agent.mines = store(MINES);
        await command('!goToMine').perform(agent, '');
        assert.equal(agent.work_packs.mining.calls[0].args[2], -59);
    });

    test('an unknown ore, an ore without a mine, no mine at all', async () => {
        const agent = makeAgent();
        agent.mines = store(MINES);
        assert.equal(await command('!goToMine').perform(agent, 'mithril'), 'I do not know the ore "mithril". I know coal, copper, iron, lapis, gold, redstone and diamond.');
        assert.equal(await command('!goToMine').perform(agent, 'coal'), 'I know no mine for coal.');
        agent.mines = store([]);
        assert.equal(await command('!goToMine').perform(agent, ''), 'I know no mine in this world.');
        agent.mines = null;
        assert.equal(await command('!goToMine').perform(agent, ''), 'I know no mine in this world.');
        assert.deepEqual(agent.work_packs.mining.calls, []);
    });
});
