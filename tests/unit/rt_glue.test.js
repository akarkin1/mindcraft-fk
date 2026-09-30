// T1, spec v0.1.4.9 section 10 (part G, the glue) and I10: the real Agent prototype, the real commands and
// executeCommand on the fake bot of tests/helpers/st_glue_env.js.
//   I10   the six commands with their parameters and defaults; each hidden while its switch is off (the blocked
//         commands of Agent.start); with the switch on they reach the pack with the parameters (G4);
//         !rememberTunnel gets the yaw of the player of agent.last_order when the player is in bot.players;
//   G3/I7 agent.whereAmI() gives the mine from mineAt with mine_routes, null without;
//   G4    !goToRememberedPlace: when the bot did not arrive, ctx.routes.walkTo; its text unless no_route;
//   G5/I8 !newAction with skills_over_code: a digging request (the prompt or the last message of a player) gets
//         digRefusalText of the digging commands that are on, before the cost check, and no call of the code model;
//         a command the player typed runs; skills_over_code off: as in v0.1.4.8;
//   G7    the conversing prompt with every switch on stays at 17,000 characters or less (the sizes are printed),
//         the six commands in it; every switch off: none of them;
//   handoff C for G 2: with mine_routes off the ore left behind is not in the knowledge block.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue, makeGlueAgent, makeFakeBot, blockedPushes } from '../helpers/st_glue_env.js';

const G = await loadGlue();
await import('ses'); // the global assert of the agent process
const MINING = await loadSrc('src/agent/packs/mining/index.js');
const ROUTES = await loadSrc('src/agent/packs/routes/index.js');

const LIMIT = { timeout: 30000 };
const BASE = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: true, protected_areas: false,
    home_pack: false, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false, protect_built_blocks: false,
    allow_insecure_coding: false, narrate_behavior: false, routes_pack: false, mine_routes: false, skills_over_code: false, ore_sense_range: 0 };
const ALL_ON = { mining_pack: true, routes_pack: true, mine_routes: true };
const DIG_ALL = 'I do not write code for digging. I have skills for it: !mineOre for an ore, !rememberTunnel and then !mineOre to dig on in a tunnel, !collectBlocks for blocks in sight.';
const DIG_NONE = 'I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.';
const ROUTE_COMMANDS = ['!rememberRoute', '!routes', '!forgetRoute'];
const MINE_COMMANDS = ['!rememberMine', '!rememberTunnel', '!collectPassedOre'];

let cap;
let dir;
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    G.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

const set = (extra) => G.settingsModule.setSettings({ ...BASE, ...extra });
const run = (agent, message, typed) => G.index.executeCommand(agent, message, { typed });

// ------------------------------------------------------------------------------ I10: the table

describe('I10: the six commands, their parameters and defaults', () => {
    const TABLE = [
        ['!rememberRoute', [['name', undefined]]],
        ['!routes', []],
        ['!forgetRoute', [['name', undefined]]],
        ['!rememberMine', [['name', 'mine']]],
        ['!rememberTunnel', [['name', '']]],
        ['!collectPassedOre', [['ore', undefined], ['num', 8]]],
    ];
    for (const [name, params] of TABLE) {
        test(`${name}(${params.map(([p, d]) => (d === undefined ? p : `${p} = ${JSON.stringify(d)}`)).join(', ')})`, () => {
            const cmd = G.index.getCommand(name);
            assert.ok(cmd, `${name} exists`);
            assert.deepEqual(Object.keys(cmd.params ?? {}), params.map(([p]) => p));
            for (const [p, d] of params) {
                assert.deepEqual(cmd.params[p].default, d, `${name} ${p}`);
                assert.equal(typeof cmd.params[p].description, 'string');
            }
            assert.ok(typeof cmd.description === 'string' && cmd.description.length > 10);
        });
    }
});

describe('I10: each command is hidden while its switch is off (the blocked commands of Agent.start)', () => {
    let pushes;
    before(() => {
        pushes = blockedPushes();
    });
    const hiddenBy = (name) => pushes.filter((p) => p.names.includes(name)).map((p) => p.test);

    for (const name of ROUTE_COMMANDS) {
        test(`${name}: hidden without routes_pack`, () => {
            assert.ok(hiddenBy(name).some((t) => t.includes('routes_pack')), JSON.stringify(hiddenBy(name)));
        });
    }
    for (const name of MINE_COMMANDS) {
        test(`${name}: hidden without mine_routes as it takes effect`, () => {
            assert.ok(hiddenBy(name).some((t) => /mine_?routes/i.test(t)), JSON.stringify(hiddenBy(name)));
        });
    }

    test('mine_routes takes effect only with mining_pack and routes_pack, both packs loaded', () => {
        set({ mining_pack: true, routes_pack: false, mine_routes: true });
        const agent = makeGlueAgent(G, { fields: { work_packs: { mining: MINING } } });
        assert.equal(agent._mineRoutesOn(), false, 'without routes_pack');
        set(ALL_ON);
        assert.equal(makeGlueAgent(G, { fields: { work_packs: { mining: MINING, routes: ROUTES } } })._mineRoutesOn(), true);
        set({ ...ALL_ON, mining_pack: false });
        assert.equal(makeGlueAgent(G, { fields: { work_packs: { routes: ROUTES } } })._mineRoutesOn(), false, 'without mining_pack');
    });
});

// ------------------------------------------------------------------------------ G4: the commands reach the packs

describe('G4: the commands reach the packs with their parameters', () => {
    function withPacks() {
        const calls = [];
        const ok = (text) => ({ ok: true, reason: null, text });
        const routes = {
            rememberRoute: (bot, ctx, name) => { calls.push(['rememberRoute', name]); return { ...ok('R'), route: null }; },
            routesText: () => { calls.push(['routes']); return 'I know no routes.'; },
            forgetRoute: (ctx, name) => { calls.push(['forgetRoute', name]); return ok('F'); },
        };
        const mining = {
            ...MINING,
            rememberMine: (bot, ctx, name, options) => { calls.push(['rememberMine', name]); void options; return { ...ok('M'), mine: null }; },
            rememberTunnel: (bot, ctx, name, options) => { calls.push(['rememberTunnel', name, options?.playerYaw]); return { ...ok('T'), mine: null, tunnel: null }; },
            collectPassedOre: async (bot, ctx, ore, num) => { calls.push(['collectPassedOre', ore, num]); return { ...ok('C'), collected: 0 }; },
        };
        return { calls, packs: { routes, mining } };
    }

    test('switches on: each command calls its function of the pack; the defaults of I10', LIMIT, async () => {
        set(ALL_ON);
        const { calls, packs } = withPacks();
        const agent = makeGlueAgent(G, { fields: { work_packs: packs, world_memory: { worldDir: dir } } });
        assert.match(String(await run(agent, '!rememberRoute("bed")', true)), /R/);
        assert.equal(await run(agent, '!routes', true), 'I know no routes.');
        await run(agent, '!forgetRoute("bed")', true);
        await run(agent, '!rememberMine', true);
        await run(agent, '!collectPassedOre("coal")', true);
        assert.deepEqual(calls.filter((c) => c[0] !== 'rememberTunnel'),
            [['rememberRoute', 'bed'], ['routes'], ['forgetRoute', 'bed'], ['rememberMine', 'mine'], ['collectPassedOre', 'coal', 8]]);
    });

    test('!rememberTunnel: the name "" and the yaw of the player who gave the order, when the player is in bot.players', LIMIT, async () => {
        set(ALL_ON);
        const { calls, packs } = withPacks();
        const bot = makeFakeBot();
        bot.players = { MartyByrde2: { username: 'MartyByrde2', entity: { yaw: 1.25, position: new Vec3(3, 64, 3) } } };
        const agent = makeGlueAgent(G, { bot, fields: { work_packs: packs, world_memory: { worldDir: dir } } });
        await agent.handleMessage('MartyByrde2', '!rememberTunnel');
        const call = calls.find((c) => c[0] === 'rememberTunnel');
        assert.ok(call, JSON.stringify(calls));
        assert.deepEqual(call, ['rememberTunnel', '', 1.25]);
    });

    test('!rememberTunnel: the player not in sight: no yaw', LIMIT, async () => {
        set(ALL_ON);
        const { calls, packs } = withPacks();
        const agent = makeGlueAgent(G, { fields: { work_packs: packs, world_memory: { worldDir: dir } } });
        await agent.handleMessage('MartyByrde2', '!rememberTunnel');
        assert.deepEqual(calls.find((c) => c[0] === 'rememberTunnel'), ['rememberTunnel', '', undefined]);
    });

    test('switches off: no pack is called', LIMIT, async () => {
        const { calls, packs } = withPacks();
        const agent = makeGlueAgent(G, { fields: { work_packs: packs, world_memory: { worldDir: dir } } });
        for (const cmd of ['!rememberRoute("bed")', '!routes', '!forgetRoute("bed")', '!rememberMine', '!rememberTunnel', '!collectPassedOre("coal")']) await run(agent, cmd, true);
        set({ mining_pack: true, routes_pack: false, mine_routes: true });
        for (const cmd of ['!rememberMine', '!rememberTunnel', '!collectPassedOre("coal")']) await run(agent, cmd, true);
        assert.deepEqual(calls, []);
    });
});

// ------------------------------------------------------------------------------ G4: !goToRememberedPlace

describe('G4, I4: !goToRememberedPlace takes a way when the path search did not arrive', () => {
    function scene(answer) {
        set({ routes_pack: true });
        const bot = makeFakeBot({ pos: [0.5, 64, 0.5] });
        bot.gotoImpl = async () => {}; // the path search does not move the bot
        const walked = [];
        const agent = makeGlueAgent(G, { bot, fields: {
            memory_bank: { recall: () => null, getJson: () => ({ storage: [20, 41, 5] }), recallPlace: (n) => (n === 'storage' ? [20, 41, 5] : null),
                recallPlaceInfo: (n) => (n === 'storage' ? { x: 20, y: 41, z: 5, dimension: 'overworld' } : undefined) },
        } });
        agent.homeContext = () => ({ routes: { walkTo: async (b, target) => { walked.push(target); return answer; } } });
        return { agent, walked };
    }

    test('the walk did not arrive: walkTo(bot, the place); its failure text is in the output', LIMIT, async () => {
        const BROKEN = 'I could not follow the route "bed" at step 3 of 4, at (2, 61, -3). Show me the way again.';
        const { agent, walked } = scene({ ok: false, reason: 'no_path', text: BROKEN, route: 'bed' });
        const out = await run(agent, '!goToRememberedPlace("storage")', true);
        assert.equal(walked.length, 1);
        assert.deepEqual({ x: walked[0].x, y: walked[0].y, z: walked[0].z }, { x: 20, y: 41, z: 5 });
        assert.ok(String(out).includes(BROKEN), out);
    });

    test('no way (no_route): no text of the routes', LIMIT, async () => {
        const { agent, walked } = scene({ ok: false, reason: 'no_route', text: '', route: null });
        const out = await run(agent, '!goToRememberedPlace("storage")', true);
        assert.equal(walked.length, 1);
        assert.ok(!String(out).includes('route'), out);
    });

    test('routes_pack off: no way is asked (v0.1.4.8)', LIMIT, async () => {
        const { agent, walked } = scene({ ok: true, reason: null, text: 'x', route: 'bed' });
        set({ routes_pack: false });
        await run(agent, '!goToRememberedPlace("storage")', true);
        assert.deepEqual(walked, []);
    });
});

// ------------------------------------------------------------------------------ G3, I7: whereAmI

describe('G3, I7: agent.whereAmI() and the mine', () => {
    function scene(settings) {
        set(settings);
        const store = new MINING.MineStore(null, {});
        store.set({ name: 'mine', source: 'player', ore: 'iron', entrance: { x: 30, y: 60, z: 4 }, level: 41, dimension: 'overworld', route: [],
            room: { center: { x: 30, y: 41, z: 6 }, chest: null, table: null, furnace: null },
            tunnels: [{ start: { x: 22, y: 25, z: 2 }, dir: 'north', end: { x: 22, y: 25, z: -9 }, level: 25, length: 12, branches: [] }], passed: [] });
        const bot = makeFakeBot({ pos: [22.5, 25, -3.5] });
        const agent = makeGlueAgent(G, { bot, fields: { work_packs: { mining: MINING, routes: ROUTES } } });
        agent._workStores = () => ({ mines: store, chests: null });
        return agent;
    }

    test('mine_routes on, the bot in the tunnel: mine { name, tunnel 0, level 25 }, underground', () => {
        const where = scene(ALL_ON).whereAmI();
        assert.equal(where.mine?.name, 'mine', JSON.stringify(where));
        assert.equal(where.mine.tunnel, 0);
        assert.equal(where.mine.level, 25);
        assert.equal(where.underground, true);
    });

    test('mine_routes off: mine null (v0.1.4.8 plus mine null)', () => {
        const where = scene({ mining_pack: true, routes_pack: true, mine_routes: false }).whereAmI();
        assert.equal(where.mine, null);
    });
});

// ------------------------------------------------------------------------------ G5, I8: !newAction

describe('G5, I8: !newAction and skills_over_code', () => {
    function coderAgent(extraFields = {}) {
        const coder = { calls: 0, last_run: null, async generateCode() { this.calls++; return 'Code ran.'; } };
        const agent = makeGlueAgent(G, { fields: { coder, work_packs: { mining: MINING, routes: ROUTES }, ...extraFields } });
        return { agent, coder };
    }

    test('the model asks for digging code: the text of I8 with the three commands; the code model is not called', LIMIT, async () => {
        set({ ...ALL_ON, allow_insecure_coding: true, skills_over_code: true });
        const { agent, coder } = coderAgent();
        const out = await run(agent, '!newAction("dig a tunnel to the east")', false);
        assert.equal(out, DIG_ALL);
        assert.equal(coder.calls, 0);
    });

    test('only the commands that are on: without the mining pack only !collectBlocks', LIMIT, async () => {
        set({ allow_insecure_coding: true, skills_over_code: true });
        const { agent, coder } = coderAgent();
        assert.equal(await run(agent, '!newAction("mine some iron ore for me")', false),
            'I do not write code for digging. I have skills for it: !collectBlocks for blocks in sight.');
        assert.equal(coder.calls, 0);
    });

    test('none on (all blocked): the text without commands', LIMIT, async () => {
        set({ allow_insecure_coding: true, skills_over_code: true, blocked_actions: ['!collectBlocks'] });
        const { agent } = coderAgent();
        assert.equal(await run(agent, '!newAction("dig a shaft")', false), DIG_NONE);
    });

    test('the prompt is harmless, the last message of the player asks for digging: refused', LIMIT, async () => {
        set({ ...ALL_ON, allow_insecure_coding: true, skills_over_code: true });
        const { agent, coder } = coderAgent();
        agent.turns.push(['MartyByrde2', 'dig me a tunnel to the east, 20 blocks']);
        assert.equal(await run(agent, '!newAction("Write a loop that moves step by step.")', false), DIG_ALL);
        assert.equal(coder.calls, 0);
    });

    test('before the cost check: the refusal, not the text of the cost limit', LIMIT, async () => {
        set({ ...ALL_ON, allow_insecure_coding: true, skills_over_code: true });
        const { agent } = coderAgent({ cost_meter: { allows: () => false } });
        assert.equal(await run(agent, '!newAction("dig a tunnel")', false), DIG_ALL);
    });

    test('no digging request: the code model is called', LIMIT, async () => {
        set({ ...ALL_ON, allow_insecure_coding: true, skills_over_code: true });
        const { agent, coder } = coderAgent();
        agent.turns.push(['MartyByrde2', 'build me a small house']);
        await run(agent, '!newAction("craft an iron pickaxe and build a house")', false);
        assert.equal(coder.calls, 1);
    });

    test('typed by the player: it runs', LIMIT, async () => {
        set({ ...ALL_ON, allow_insecure_coding: true, skills_over_code: true });
        const { agent, coder } = coderAgent();
        await run(agent, '!newAction("dig a tunnel to the east")', true);
        assert.equal(coder.calls, 1);
    });

    test('skills_over_code off: as in v0.1.4.8, the code model is called', LIMIT, async () => {
        set({ ...ALL_ON, allow_insecure_coding: true, skills_over_code: false });
        const { agent, coder } = coderAgent();
        await run(agent, '!newAction("dig a tunnel to the east")', false);
        assert.equal(coder.calls, 1);
    });
});

// ------------------------------------------------------------------------------ handoff: the knowledge block

describe('handoff C for G 2: the ore left behind in the knowledge block only with mine_routes', () => {
    function agentWith(settings) {
        set({ knowledge_in_prompt: true, knowledge_max_chars: 600, ...settings });
        const store = new MINING.MineStore(null, {});
        store.set({ name: 'mine', source: 'player', ore: 'iron', entrance: { x: 30, y: 60, z: 4 }, level: 41, dimension: 'overworld', route: [], room: null,
            tunnels: [], passed: [{ ore: 'gold_ore', x: 1, y: 25, z: 1, reason: 'pickaxe', seen: '2026-09-30T10:00:00.000Z' }] });
        const agent = makeGlueAgent(G, { fields: { work_packs: { mining: MINING, routes: ROUTES } } });
        agent._workStores = () => ({ mines: store, chests: null });
        return agent;
    }

    test('mine_routes on: `Ore left behind: gold 1 in the mine "mine".`', () => {
        assert.ok(agentWith(ALL_ON).knowledgeBlock().includes('Ore left behind: gold 1 in the mine "mine".'));
    });

    test('mine_routes off: no line of the ore left behind', () => {
        const block = agentWith({ mining_pack: true }).knowledgeBlock();
        assert.ok(block.includes('Mines:'), block);
        assert.ok(!block.includes('Ore left behind'), block);
    });
});

// ------------------------------------------------------------------------------ G7: the size of the prompt

describe('G7: the conversing prompt', () => {
    let workDir;
    let originalCwd;
    let placeholderKey = false;
    let M;
    const PARTS = ['cost_meter', 'protected_areas', 'player_rules', 'home_pack', 'storage_pack', 'farming_pack', 'wood_pack', 'mining_pack', 'routes_pack'];
    const SWITCHES_ON = { knowledge_in_prompt: true, knowledge_max_chars: 600, protect_built_blocks: true, repeat_guard: 3, restart_context: true,
        say_results: true, flee_below_health: 8, stuck_restart_after: 3, log_timestamps: true, mine_routes: true, skills_over_code: true, ore_sense_range: 3,
        trail_max_steps: 500, allow_insecure_coding: true, skill_learning: true, skill_capture: true, skill_reuse: true, skill_command: true,
        examples_by_last_request: true, creeper_fighting: true };
    // every switch that is not part of a test named here, pinned off, so that the values of the owner's settings.js
    // never decide a test (CLAUDE.md)
    const PINNED_OFF = { allow_insecure_coding: false, skill_learning: false, skill_capture: false, skill_reuse: false, skill_command: false,
        examples_by_last_request: false, creeper_fighting: false };

    before(async () => {
        originalCwd = process.cwd();
        workDir = makeTmpDir();
        const to = path.join(workDir, 'profiles', 'defaults');
        fs.mkdirSync(to, { recursive: true });
        for (const file of fs.readdirSync(repoPath('profiles/defaults'))) {
            if (file.endsWith('.json')) fs.copyFileSync(repoPath(`profiles/defaults/${file}`), path.join(to, file));
        }
        process.chdir(workDir);
        if (!process.env.ANTHROPIC_API_KEY) {
            process.env.ANTHROPIC_API_KEY = 'dry-run-placeholder-not-a-key';
            placeholderKey = true;
        }
        const c = captureConsole();
        try {
            M = {
                fileSettings: (await loadSrc('settings.js')).default,
                prompter: await loadSrc('src/models/prompter.js'),
                skills: await loadSrc('src/agent/skills/skill_manager.js'),
                routing: await loadSrc('scripts/routing_check.js'),
            };
        } finally {
            c.restore();
        }
    });
    after(() => {
        if (placeholderKey) delete process.env.ANTHROPIC_API_KEY;
        process.chdir(originalCwd);
        removeTmpDir(workDir);
    });

    const block600 = () => {
        const lines = ['WHAT YOU KNOW (from memory, no need to check):', 'You are in the mine "mine", on its way in, 12 blocks under the ground.'];
        let i = 0;
        while (lines.join('\n').length < 600) lines.push(`Chest (${i}, 67, ${i++}): leaf_litter 104, cobblestone 81, raw_copper 52, wheat_seeds 52.`);
        return lines.join('\n').slice(0, 600);
    };

    // the fixed fake state of tests/unit/stg_prompt.test.js (the size of 16,807 of the plan was measured with it)
    const pad = (text) => '\n' + text + '\n';
    const FAKE_INVENTORY = pad(['INVENTORY', '- oak_log: 12', '- oak_planks: 8', '- cobblestone: 34', '- bread: 6', '- apple: 3',
        '- wheat_seeds: 14', '- torch: 9', '- raw_iron: 5', '- stone_sword: 1', '- stone_pickaxe: 1', 'In the off-hand: bread 6', 'WEARING: Nothing'].join('\n'));
    function fakeStats(modes, home) {
        const homeModes = home ? { hunger: true, creeper_safety: true, night_shelter: true, door_closing: true } : {};
        const modeLines = Object.entries({ ...(modes ?? {}), ...homeModes }).map(([name, on]) => `- ${name}(${on ? 'ON' : 'OFF'})`);
        const stats = ['STATS', '- Position: x: 12.50, y: 64.00, z: -3.30', '- World: seed-ce66bf80acdefa75', '- Dimension: overworld',
            ...(home ? ['- Area: farm (farm, protected)'] : []), '- Gamemode: survival', '- Health: 20 / 20', '- Hunger: 17 / 20', '- Biome: plains', '- Weather: Clear',
            '- Time: Afternoon', '- Current Action: Idle', '- Nearby Human Players: steve', '- Nearby Bot Players: None.',
            ['Agent Modes:', ...modeLines].join('\n')].join('\n') + '\n';
        const entities = ['NEARBY_ENTITIES', '- Human player: steve', '- entities: 2 cow(s)', '- entities: 1 chicken(s)'].join('\n');
        const blocks = ['NEARBY_BLOCKS', '- grass_block', '- dirt', '- oak_log', '- oak_leaves', '- stone', '- oak_planks', '- oak_door',
            '- Block Below: grass_block', '- Block at Legs: air', '- Block at Head: air', '- First Solid Block Above Head: none'].join('\n');
        return pad(stats) + '\n' + pad(entities) + '\n' + pad(blocks);
    }

    // the prompt that promptConvo sends, with the real Prompter and profiles/claude.json, the blocked commands of the
    // routing check (the copy of Agent.start), no conversation
    async function conversing(switches) {
        const profile = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
        const settings = { ...M.routing.runSettings(M.fileSettings, profile, false), ...switches };
        G.settingsModule.setSettings(settings);
        const blocked = M.routing.blockedFor(settings, M.skills.skillFlags(settings));
        const agent = {
            name: profile.name, blocked_actions: blocked, history: { memory: '' },
            self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
            actions: { currentActionLabel: '' }, task: { task_id: null }, npc: {}, knowledgeBlock: () => block600(),
        };
        const c = captureConsole();
        try {
            const prompter = new M.prompter.Prompter(agent, settings.profile);
            agent.prompter = prompter;
            prompter.profile.conversing = prompter.profile.conversing.replaceAll('$STATS', fakeStats(prompter.profile.modes, settings.home_pack === true))
                .replaceAll('$INVENTORY', FAKE_INVENTORY);
            let last = null;
            const model = { async sendRequest(turns, systemMessage) { last = String(systemMessage ?? ''); return ''; },
                sendVisionRequest: () => Promise.reject(new Error('no vision')), embed: () => Promise.reject(new Error('no embeddings')) };
            Object.assign(prompter, { chat_model: model, code_model: model, vision_model: model, embedding_model: model, cooldown: 0 });
            await prompter.initExamples();
            await prompter.promptConvo([]);
            return last;
        } finally {
            c.restore();
        }
    }

    test('every switch on: at most 17,000 characters; the six commands are in it', LIMIT, async (t) => {
        const prompt = await conversing({ ...Object.fromEntries(PARTS.map((p) => [p, true])), ...SWITCHES_ON, world_memory: true });
        t.diagnostic(`every switch on: ${prompt.length} characters`);
        // FINDING T1-L-2 (G7, medium; seen on hotfix/follow-ladder): with the skill switches on too (skill_learning,
        // skill_command: the owner plays with them since commit 72f1379) the prompt has 17,431 characters, over 17,000.
        // Before, this test read those switches from settings.js, where they were off (16,881).
        for (const name of [...ROUTE_COMMANDS, ...MINE_COMMANDS]) assert.ok(prompt.includes(`\n${name}: `), name);
        assert.ok(prompt.length <= 17000, `${prompt.length} characters`);
    });

    test('every switch off: none of the six commands', LIMIT, async (t) => {
        const prompt = await conversing({ ...Object.fromEntries(PARTS.map((p) => [p, false])), ...PINNED_OFF, knowledge_in_prompt: false, mine_routes: false,
            skills_over_code: false, world_memory: true });
        t.diagnostic(`every switch off: ${prompt.length} characters`);
        for (const name of [...ROUTE_COMMANDS, ...MINE_COMMANDS]) assert.ok(!prompt.includes(`\n${name}: `), name);
        for (const name of [...ROUTE_COMMANDS, ...MINE_COMMANDS]) assert.ok(!prompt.includes(`${name}`), `${name} nowhere, not in an example either`);
    });

    test('mine_routes on without routes_pack: the three mine commands are not offered', LIMIT, async () => {
        const prompt = await conversing({ ...Object.fromEntries(PARTS.map((p) => [p, false])), ...PINNED_OFF, mining_pack: true, mine_routes: true, world_memory: true });
        for (const name of MINE_COMMANDS) assert.ok(!prompt.includes(`\n${name}: `), name);
        assert.ok(prompt.includes('\n!mineOre: '));
    });
});

// ------------------------------------------------------------------------------ G6, G8, D3: examples, sentences, tables

describe('G6: the examples of the new commands; no example switches a safety reflex off', () => {
    const DEFAULT = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
    const examples = DEFAULT.conversation_examples;
    const SAFETY = ['self_preservation', 'creeper_safety', 'night_shelter', 'door_closing', 'hunger'];
    const ROWS = [
        ['this is the mine, remember this', '!rememberMine("mine")'],
        ['dig here', '!rememberTunnel'],
        ['remember this way to the bed', '!rememberRoute("bed")'],
        ['collect the coal you passed', '!collectPassedOre("coal")'],
        ['which ways do you know', '!routes'],
    ];
    for (const [say, command] of ROWS) {
        test(`"${say}" leads to ${command}`, () => {
            const ex = examples.find((turns) => turns[0]?.role === 'user' && turns[0].content.toLowerCase().includes(say));
            assert.ok(ex, `an example for "${say}"`);
            const answer = ex.find((t) => t.role === 'assistant');
            assert.ok(answer?.content.includes(command), JSON.stringify(ex));
        });
    }

    test('no example switches a safety reflex off', () => {
        for (const turns of examples) {
            for (const t of turns) {
                if (t.role !== 'assistant') continue;
                for (const mode of SAFETY) assert.ok(!new RegExp(`!setMode\\(\\s*"${mode}"\\s*,\\s*false`).test(t.content), t.content);
            }
        }
    });
});

describe('G8, D3: the routing list and the table of the routing check', () => {
    test('at least 15 sentences for the new commands, in the parts routes_pack and mine_routes; each command has one', () => {
        const sentences = JSON.parse(fs.readFileSync(repoPath('tests/routing/sentences.json'), 'utf8'));
        const mine = sentences.filter((e) => e.part === 'routes_pack' || e.part === 'mine_routes');
        assert.ok(mine.length >= 15, `${mine.length} sentences`);
        assert.ok(mine.some((e) => e.part === 'routes_pack') && mine.some((e) => e.part === 'mine_routes'));
        for (const name of [...ROUTE_COMMANDS, ...MINE_COMMANDS]) assert.ok(mine.some((e) => e.expect.includes(name)), name);
    });

    test('tests/routing/commands.js: the new settings and the commands of the two parts', async () => {
        const C = await loadSrc('tests/routing/commands.js');
        assert.deepEqual([...C.PART_COMMANDS.routes_pack].sort(), [...ROUTE_COMMANDS].sort());
        assert.deepEqual([...C.PART_COMMANDS.mine_routes].sort(), [...MINE_COMMANDS].sort());
        for (const key of ['routes_pack', 'trail_max_steps', 'mine_routes', 'ore_sense_range', 'skills_over_code']) assert.ok(Object.hasOwn(C.SPEC_SETTINGS, key), key);
    });
});

// ------------------------------------------------------------------------------ G2: the trail and ctx.routes of the world

describe('G2, I1, I4: the trail of the world and the routes on the context', () => {
    function withTrail(extra = {}) {
        set({ routes_pack: true, world_memory: true, ...extra });
        const made = [];
        const routes = {
            ...ROUTES,
            createTrail: (bot, ctx, options) => {
                const t = { options, started: 0, stopped: 0, start() { this.started++; }, stop() { this.stopped++; }, list: () => [], tick() {}, size: 0 };
                made.push(t);
                return t;
            },
        };
        const agent = makeGlueAgent(G, { fields: { work_packs: { routes }, world_memory: { worldDir: dir } } });
        return { agent, made };
    }

    test('the trail of the world: file <worldDir>/trail.json, maxSteps trail_max_steps, started', () => {
        const { agent, made } = withTrail({ trail_max_steps: 120 });
        agent._trail();
        assert.equal(made.length, 1);
        assert.equal(path.resolve(made[0].options.file), path.resolve(path.join(dir, 'trail.json')));
        assert.equal(made[0].options.maxSteps, 120);
        assert.equal(made[0].started, 1);
    });

    test('trail_max_steps below 50 or not a whole number: the default 500', () => {
        for (const bad of [10, 49, 75.5, '200']) {
            const { agent, made } = withTrail({ trail_max_steps: bad });
            agent._trail();
            assert.equal(made[0].options.maxSteps, 500, String(bad));
        }
    });

    test('without world_memory: in memory only (no file)', () => {
        const { agent, made } = withTrail({ world_memory: false });
        agent._trail();
        assert.equal(made[0].options.file ?? null, null);
    });

    test('a world change stops the trail of the old world; the exit stops the trail', () => {
        const { agent, made } = withTrail();
        agent._trail();
        agent.world_memory = { worldDir: path.join(dir, 'other') };
        agent._trail();
        assert.equal(made.length, 2);
        assert.equal(made[0].stopped, 1, 'the old one stopped');
        agent._atExit('test');
        assert.equal(made[1].stopped, 1, 'stopped at the exit');
    });

    test('ctx.routes on homeContext() with routes_pack: the functions of I4 over routes.json of the world', () => {
        set({ routes_pack: true, world_memory: true });
        const agent = makeGlueAgent(G, { fields: { work_packs: { routes: ROUTES }, world_memory: { worldDir: dir } } });
        const r = agent.homeContext().routes;
        assert.ok(r, 'ctx.routes');
        for (const k of ['walkRoute', 'walkTo', 'routeFor']) assert.equal(typeof r[k], 'function', k);
        assert.ok(r.store instanceof ROUTES.RouteStore);
        assert.ok(agent.packContext().routes, 'and on the pack context');
        agent._atExit('test');
    });
});
