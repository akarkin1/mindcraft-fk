// Part G of v0.1.4.9 (E5): the wires of the routes pack and of the mine of the player in src/agent/agent.js.
//   - _loadWorkPacks imports the routes pack only with routes_pack; routes_pack alone loads no other pack;
//   - start(): the three commands of the routes pack hidden without routes_pack (or without its pack), the three
//     commands of the mine hidden unless mine_routes takes effect (mining_pack, routes_pack, both packs loaded);
//   - the trail (I1): made and started at spawn with <world>/trail.json (null without world_memory) and
//     trail_max_steps; stopped and made again when the world changes; stopped at the exit (cleanKill);
//   - ctx.routes (I4) on homeContext() and packContext(): bindRoutes(bot, ctx, store, trail), once per world,
//     null without routes_pack; the real pack gives walkRoute, walkTo, routeFor and logic;
//   - whereAmI() (I7): extra.mine from mineAt over the mines of the dimension with mine_routes, else null;
//   - knowledgeBlock(): the ore left behind only with mine_routes.
// Agent.prototype methods are called on fake agents made with Object.create(Agent.prototype).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { blockedPushes } from '../helpers/st_glue_env.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const agent = await loadSrc('src/agent/agent.js');
        return { settingsModule, index, agent };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const { Agent } = M.agent;
const ROUTES = await loadSrc('src/agent/packs/routes/index.js');
const MINING = await loadSrc('src/agent/packs/mining/index.js');
const KT = await loadSrc('src/agent/knowledge/knowledge_text.js');
const WHERE = await loadSrc('src/agent/reflex/where_am_i.js');
const SOURCE = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8').replace(/\r\n/g, '\n');

const OFF = { language: 'en', world_memory: true, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false,
    routes_pack: false, mine_routes: false, knowledge_in_prompt: false, blocked_actions: [] };

let cap;
let dir;
const cleanups = [];
beforeEach(() => {
    cap = captureConsole();
    dir = makeTmpDir();
    M.settingsModule.setSettings({ ...OFF });
});
afterEach(() => {
    while (cleanups.length > 0) {
        try {
            cleanups.pop()();
        } catch {
            // the next one
        }
    }
    cap.restore();
    removeTmpDir(dir);
});

const fakeAgent = (fields = {}) => Object.assign(Object.create(Agent.prototype), { name: 'andy', bot: { username: 'andy' }, ...fields });
const warnings = () => cap.of('warn').map((r) => r.text);

// A routes pack that records what the agent does with it.
function recordingRoutesPack() {
    const log = { trails: [], stores: [], binds: [] };
    class RouteStore {
        constructor(file) {
            this.file = file;
            log.stores.push(this);
        }
        load() {
            return 0;
        }
        list() {
            return [];
        }
    }
    return {
        log,
        RouteStore,
        createTrail(bot, ctx, options) {
            const trail = { bot, ctx, options, started: 0, stopped: 0, start() { this.started++; }, stop() { this.stopped++; }, list: () => [] };
            log.trails.push(trail);
            return trail;
        },
        bindRoutes(bot, ctx, store, trail) {
            log.binds.push({ bot, ctx, store, trail });
            return { store, trail, walkTo: async () => ({ ok: false, reason: 'no_route', text: '' }) };
        },
    };
}

describe('_loadWorkPacks: the routes pack only with routes_pack', () => {
    const CASES = [
        [{}, []],
        [{ routes_pack: true }, ['routes']],
        [{ mining_pack: true }, ['storage', 'wood', 'mining']],
        [{ mining_pack: true, routes_pack: true, mine_routes: true }, ['storage', 'wood', 'mining', 'routes']],
        [{ mine_routes: true }, []],
    ];
    for (const [switches, wanted] of CASES) {
        test(`${JSON.stringify(switches)} -> ${wanted.join(', ') || 'nothing'}`, async () => {
            M.settingsModule.setSettings({ ...OFF, ...switches });
            const packs = await fakeAgent()._loadWorkPacks();
            assert.deepEqual(Object.keys(packs).sort(), [...wanted].sort());
            if (packs.routes) assert.equal(packs.routes.bindRoutes, ROUTES.bindRoutes, 'the real routes pack');
        });
    }

    test('a routes pack that cannot be loaded: one warning with its name, its commands stay hidden', async () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true });
        const packs = await fakeAgent()._loadWorkPacks({ routes: () => Promise.reject(new Error('the routes pack is broken')) });
        assert.deepEqual(Object.keys(packs), []);
        assert.equal(warnings().length, 1);
        assert.match(warnings()[0], /^Could not load the routes pack, its commands stay hidden:/);
    });

    test('source: import() of ./packs/routes/index.js behind routes_pack and inside try; the packs are loaded for routes_pack alone too', () => {
        const at = SOURCE.indexOf("import('./packs/routes/index.js')");
        assert.ok(at > 0);
        const before = SOURCE.slice(SOURCE.lastIndexOf('if (settings.routes_pack) {', at), at);
        assert.match(before, /^if \(settings\.routes_pack\) \{\n\s+try \{\n\s+packs\.routes = await \(loaders\.routes \? loaders\.routes\(\) : $/);
        assert.ok(SOURCE.includes('if (settings.storage_pack || settings.farming_pack || settings.wood_pack || settings.mining_pack || settings.routes_pack) {\n            this.work_packs = await this._loadWorkPacks();'));
    });
});

describe('start(): the commands of v0.1.4.9 are hidden while their part is off', () => {
    const pushes = blockedPushes();
    const pushOf = (name) => pushes.find((p) => p.names.includes(name));

    test('the routes pack: !rememberRoute, !routes, !forgetRoute without routes_pack or without its pack', () => {
        assert.deepEqual(pushOf('!rememberRoute'), { test: '!settings.routes_pack || !this.work_packs?.routes', names: ['!rememberRoute', '!routes', '!forgetRoute'] });
    });

    test('the mine of the player: !rememberMine, !rememberTunnel, !collectPassedOre unless mine_routes takes effect', () => {
        assert.deepEqual(pushOf('!rememberMine'), { test: '!this._mineRoutesOn()', names: ['!rememberMine', '!rememberTunnel', '!collectPassedOre'] });
        const at = SOURCE.indexOf("this.blocked_actions.push('!rememberMine'");
        assert.ok(at > 0 && at < SOURCE.indexOf('blacklistCommands(this.blocked_actions);'), 'before the commands are blacklisted');
    });

    test('_mineRoutesOn: the three switches and both packs loaded', () => {
        const packs = { mining: MINING, routes: ROUTES };
        const ON = { mining_pack: true, routes_pack: true, mine_routes: true };
        M.settingsModule.setSettings({ ...OFF, ...ON });
        assert.equal(fakeAgent({ work_packs: packs })._mineRoutesOn(), true);
        assert.equal(fakeAgent({ work_packs: { mining: MINING } })._mineRoutesOn(), false, 'the routes pack did not load');
        assert.equal(fakeAgent({ work_packs: { routes: ROUTES } })._mineRoutesOn(), false, 'the mining pack did not load');
        assert.equal(fakeAgent({})._mineRoutesOn(), false, 'no packs');
        for (const key of Object.keys(ON)) {
            M.settingsModule.setSettings({ ...OFF, ...ON, [key]: false });
            assert.equal(fakeAgent({ work_packs: packs })._mineRoutesOn(), false, `${key} off`);
        }
    });
});

describe('the trail (I1)', () => {
    test('made and started when the world is known, with <world>/trail.json and trail_max_steps; the same world gives the same trail', () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true, trail_max_steps: 800 });
        const pack = recordingRoutesPack();
        const agent = fakeAgent({ work_packs: { routes: pack }, world_memory: { worldDir: null } });
        assert.equal(agent._trail(), null, 'before the world is known');
        assert.equal(pack.log.trails.length, 0);
        agent.world_memory.worldDir = path.join(dir, 'w1');
        const trail = agent._trail();
        assert.equal(pack.log.trails.length, 1);
        assert.deepEqual(trail.options, { file: `${agent.world_memory.worldDir}/trail.json`, maxSteps: 800 });
        assert.equal(trail.bot, agent.bot);
        assert.equal(trail.started, 1);
        assert.equal(agent._trail(), trail, 'the same world');
        assert.equal(trail.started, 1);
    });

    test('another world: the trail of the old one stops, a new one starts', () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true });
        const pack = recordingRoutesPack();
        const agent = fakeAgent({ work_packs: { routes: pack }, world_memory: { worldDir: path.join(dir, 'w1') } });
        const first = agent._trail();
        agent.world_memory.worldDir = path.join(dir, 'w2');
        const second = agent._trail();
        assert.notEqual(second, first);
        assert.equal(first.stopped, 1);
        assert.equal(second.started, 1);
        assert.equal(second.options.file, `${path.join(dir, 'w2')}/trail.json`);
        assert.equal(second.options.maxSteps, 500, 'the default without trail_max_steps');
    });

    test('without world_memory: in memory only (file null); an invalid trail_max_steps counts as 500', () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true, world_memory: false, trail_max_steps: 20 });
        const pack = recordingRoutesPack();
        const trail = fakeAgent({ work_packs: { routes: pack } })._trail();
        assert.deepEqual(trail.options, { file: null, maxSteps: 500 });
    });

    test('without routes_pack or without the pack: no trail; a trail that cannot be made gives a warning and null', () => {
        const pack = recordingRoutesPack();
        assert.equal(fakeAgent({ work_packs: { routes: pack }, world_memory: { worldDir: dir } })._trail(), null);
        assert.equal(pack.log.trails.length, 0);
        M.settingsModule.setSettings({ ...OFF, routes_pack: true });
        assert.equal(fakeAgent({ work_packs: {}, world_memory: { worldDir: dir } })._trail(), null);
        assert.equal(fakeAgent({ world_memory: { worldDir: dir } })._trail(), null);
        const broken = { createTrail() { throw new Error('disk full'); } };
        assert.equal(fakeAgent({ work_packs: { routes: broken }, world_memory: { worldDir: dir } })._trail(), null);
        assert.match(warnings().join('\n'), /Could not start the trail of this world/);
    });

    test('the exit stops the trail (cleanKill runs _atExit); a failing stop does not stop the exit', () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true });
        const pack = recordingRoutesPack();
        const agent = fakeAgent({ work_packs: { routes: pack }, world_memory: { worldDir: dir } });
        const trail = agent._trail();
        agent._atExit('bye');
        assert.equal(trail.stopped, 1);
        const exits = [];
        const realExit = process.exit;
        process.exit = (code) => exits.push(code);
        try {
            trail.stop = () => { throw new Error('boom'); };
            fakeAgent({ history: { add() {}, save() {} }, bot: { chat() {} }, _trail_of: { dir, trail } }).cleanKill('Killing agent process...', 1);
        } finally {
            process.exit = realExit;
        }
        assert.deepEqual(exits, [1]);
        assert.match(warnings().join('\n'), /Could not stop the trail/);
    });

    test('spawn: the trail starts after the stores of the world and before _atSpawn, behind routes_pack', () => {
        const at = SOURCE.indexOf('if (settings.routes_pack && this.work_packs)\n                    this._trail();');
        assert.ok(at > SOURCE.indexOf('this._workStores(); // the chest index'), 'after the stores');
        assert.ok(at < SOURCE.indexOf('await this._atSpawn()'), 'before the spawn steps');
    });

    test('the real trail of the routes pack: the file of the world, started and stopped by the agent, no timer left', () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true, trail_max_steps: 60 });
        const world = createBlockWorld().flatGround(63);
        const bot = { entity: { position: vec(0.5, 64, 0.5), onGround: true }, game: { dimension: 'overworld' }, blockAt: (p) => world.blockAt(p) };
        const agent = fakeAgent({ bot, work_packs: { routes: ROUTES }, world_memory: { worldDir: dir } });
        const trail = agent._trail();
        cleanups.push(() => trail.stop());
        assert.equal(trail.file, `${dir}/trail.json`);
        assert.equal(trail.maxSteps, 60);
        assert.equal(trail.running, true);
        trail.tick();
        assert.equal(trail.list().length, 1);
        agent._atExit('bye');
        assert.equal(trail.running, false);
        assert.ok(fs.existsSync(path.join(dir, 'trail.json')), 'written at the stop');
    });
});

describe('ctx.routes on the contexts (I4)', () => {
    test('null without routes_pack; the home context and the pack context have the key', () => {
        const pack = recordingRoutesPack();
        const agent = fakeAgent({ work_packs: { routes: pack }, world_memory: { worldDir: dir } });
        assert.equal(agent.homeContext().routes, null);
        assert.equal(agent.packContext().routes, null);
        assert.equal(pack.log.binds.length, 0);
        assert.equal(fakeAgent({}).homeContext().routes, null, 'no packs');
    });

    test('with routes_pack: bindRoutes(bot, ctx, the store of routes.json, the trail), once per world, again for another world', () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true });
        const pack = recordingRoutesPack();
        const agent = fakeAgent({ work_packs: { routes: pack }, world_memory: { worldDir: path.join(dir, 'w1') } });
        const ctx = agent.homeContext();
        assert.equal(pack.log.binds.length, 1);
        const bind = pack.log.binds[0];
        assert.equal(bind.bot, agent.bot);
        assert.equal(bind.ctx, ctx, 'the context it is on (bindRoutes never reads ctx.routes)');
        assert.equal(bind.store.file, `${path.join(dir, 'w1')}/routes.json`);
        assert.equal(bind.trail, pack.log.trails[0]);
        assert.equal(ctx.routes.store, bind.store);
        assert.equal(agent.homeContext().routes, ctx.routes, 'cached');
        assert.equal(agent.packContext().routes, ctx.routes, 'the pack context has the same');
        assert.equal(pack.log.binds.length, 1);
        assert.deepEqual(agent._workStores(), { chests: null, mines: null }, 'the route store is not one of the work stores of v0.1.4.7');
        agent.world_memory.worldDir = path.join(dir, 'w2');
        const other = agent.homeContext().routes;
        assert.notEqual(other, ctx.routes);
        assert.equal(pack.log.binds.length, 2);
        assert.equal(other.store.file, `${path.join(dir, 'w2')}/routes.json`);
        assert.equal(pack.log.trails[0].stopped, 1, 'the trail of the world that was left');
    });

    test('before the world is known: null; a pack without bindRoutes: null; bindRoutes that throws: a warning and null', () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true });
        assert.equal(fakeAgent({ work_packs: { routes: recordingRoutesPack() }, world_memory: { worldDir: null } }).homeContext().routes, null);
        assert.equal(fakeAgent({ work_packs: { routes: {} }, world_memory: { worldDir: dir } }).homeContext().routes, null);
        const broken = { ...recordingRoutesPack(), bindRoutes() { throw new Error('broken'); } };
        assert.equal(fakeAgent({ work_packs: { routes: broken }, world_memory: { worldDir: dir } }).homeContext().routes, null);
        assert.match(warnings().join('\n'), /Could not give the routes of this world to the packs/);
    });

    test('the real routes pack: store, trail, walkRoute, walkTo, routeFor and logic; the route store of the world', () => {
        M.settingsModule.setSettings({ ...OFF, routes_pack: true });
        const world = createBlockWorld().flatGround(63);
        const bot = { entity: { position: vec(0.5, 64, 0.5), onGround: true }, game: { dimension: 'overworld' }, blockAt: (p) => world.blockAt(p) };
        const agent = fakeAgent({ bot, work_packs: { routes: ROUTES }, world_memory: { worldDir: dir } });
        const routes = agent.homeContext().routes;
        cleanups.push(() => routes.trail.stop());
        assert.ok(routes.store instanceof ROUTES.RouteStore);
        assert.equal(routes.trail, agent._trail());
        for (const name of ['walkRoute', 'walkTo', 'routeFor']) assert.equal(typeof routes[name], 'function', name);
        assert.equal(typeof routes.logic.skyStart, 'function');
        assert.equal(typeof routes.logic.routeFromSteps, 'function');
        assert.equal(routes.routeFor({ x: 50, y: 64, z: 50 }), null, 'no route known');
    });
});

// A mine of the player as the mining pack stores it (tests/unit/rtb_logic.test.js), with a tunnel at level 30.
const PLAYER_MINE = {
    name: 'mine', source: 'player', ore: 'iron', entrance: { x: 0, y: 64, z: -3 }, level: 34, dimension: 'overworld',
    route: [
        { kind: 'walk', from: { x: 0, y: 64, z: -3 }, to: { x: 0, y: 64, z: -1 } },
        { kind: 'door', kind2: 'trapdoor', name: 'oak_trapdoor', x: 0, y: 63, z: 0, from: { x: 0, y: 64, z: -1 }, to: { x: 0, y: 62, z: 0 } },
        { kind: 'ladder', x: 0, z: 0, top: 62, bottom: 50, face: 'south', entry: { x: 0, y: 64, z: -1 } },
        { kind: 'walk', from: { x: 0, y: 50, z: 0 }, to: { x: 2, y: 50, z: 0 } },
    ],
    room: { center: { x: 1, y: 50, z: 0 }, chest: { x: -2, y: 50, z: 2 }, table: { x: 2, y: 50, z: 2 }, furnace: null },
    tunnels: [{ start: { x: 21, y: 34, z: 2 }, dir: 'south', end: { x: 21, y: 34, z: 13 }, level: 30, length: 12, branches: [] }],
    passed: [{ ore: 'gold', x: 22, y: 34, z: 13, reason: 'pickaxe', seen: '2026-09-30T00:00:00.000Z' },
        { ore: 'gold', x: 22, y: 35, z: 13, reason: 'pickaxe', seen: '2026-09-30T00:00:00.000Z' }],
};
const MINE_ON = { mining_pack: true, routes_pack: true, mine_routes: true, world_memory: false };

// An agent with the real mining pack and a mine store in memory that holds PLAYER_MINE; the bot stands at pos.
function mineAgent(pos, { routes = ROUTES } = {}) {
    const world = createBlockWorld().flatGround(63);
    const bot = { entity: { position: vec(pos.x, pos.y, pos.z) }, game: { dimension: 'overworld', minY: -64, height: 384 }, blockAt: (p) => world.blockAt(p) };
    const agent = fakeAgent({ bot, work_packs: { mining: MINING, routes } });
    const saved = agent._workStores().mines.set(structuredClone(PLAYER_MINE));
    assert.ok(saved, 'the store takes the mine');
    return agent;
}

describe('whereAmI (I7): the mine of the player with mine_routes', () => {
    test('in the tunnel: the name, the tunnel from 0, the level of the tunnel, underground', () => {
        M.settingsModule.setSettings({ ...OFF, ...MINE_ON });
        const where = mineAgent({ x: 21.5, y: 34, z: 7.5 }).whereAmI();
        assert.deepEqual(where.mine, { name: 'mine', tunnel: 0, level: 30, onRoute: false });
        assert.equal(where.underground, true);
    });

    test('on the ladder of the way in: tunnel null, the level of the mine, on the route; in the room: not on the route', () => {
        M.settingsModule.setSettings({ ...OFF, ...MINE_ON });
        assert.deepEqual(mineAgent({ x: 0.5, y: 57, z: 0.5 }).whereAmI().mine, { name: 'mine', tunnel: null, level: 34, onRoute: true });
        const room = mineAgent({ x: 0.5, y: 51, z: 1.5 }).whereAmI();
        assert.deepEqual(room.mine, { name: 'mine', tunnel: null, level: 34, onRoute: false });
        assert.equal(room.underground, true);
    });

    test('outside the mine: null, as in v0.1.4.8', () => {
        M.settingsModule.setSettings({ ...OFF, ...MINE_ON });
        const agent = mineAgent({ x: 40.5, y: 64, z: 40.5 });
        assert.equal(agent.whereAmI().mine, null);
        assert.deepEqual(agent.whereAmI(), WHERE.whereAmI(agent.bot));
    });

    test('mine_routes not in effect (each switch off, or the routes pack not loaded): mine null, the answer of v0.1.4.8', () => {
        for (const off of [{ mine_routes: false }, { routes_pack: false }]) {
            M.settingsModule.setSettings({ ...OFF, ...MINE_ON, ...off });
            const agent = mineAgent({ x: 21.5, y: 34, z: 7.5 });
            assert.deepEqual(agent.whereAmI(), WHERE.whereAmI(agent.bot), JSON.stringify(off));
            assert.equal(agent.whereAmI().mine, null);
        }
        M.settingsModule.setSettings({ ...OFF, ...MINE_ON });
        assert.equal(mineAgent({ x: 21.5, y: 34, z: 7.5 }, { routes: null }).whereAmI().mine, null);
    });

    test('a store that throws: a warning, mine null, whereAmI still answers', () => {
        M.settingsModule.setSettings({ ...OFF, ...MINE_ON });
        const agent = mineAgent({ x: 21.5, y: 34, z: 7.5 });
        agent._workStores = () => ({ chests: null, mines: { list() { throw new Error('broken'); } } });
        assert.equal(agent.whereAmI().mine, null);
        assert.match(warnings().join('\n'), /Could not find the mine the bot is in/);
    });

    test('the modes and the packs ask agent.whereAmI: ctx.whereAmI of the contexts gives the mine', () => {
        M.settingsModule.setSettings({ ...OFF, ...MINE_ON });
        const agent = mineAgent({ x: 21.5, y: 34, z: 7.5 });
        assert.equal(agent.homeContext().whereAmI().mine.name, 'mine');
        assert.equal(agent.packContext().whereAmI().underground, true);
    });
});

describe('knowledgeBlock: the ore left behind only with mine_routes (C for G, 2)', () => {
    test('on: the line of the ore and where the bot is, word for word', () => {
        M.settingsModule.setSettings({ ...OFF, ...MINE_ON, knowledge_in_prompt: true });
        const text = mineAgent({ x: 21.5, y: 34, z: 7.5 }).knowledgeBlock();
        assert.ok(text.includes('Ore left behind: gold 2 in the mine "mine".'), text);
        assert.ok(text.includes('in the mine "mine", tunnel 1 at level 30'), text);
    });

    test('off: the mines without their list, so old entries do not show', () => {
        M.settingsModule.setSettings({ ...OFF, ...MINE_ON, mine_routes: false, knowledge_in_prompt: true });
        const agent = mineAgent({ x: 21.5, y: 34, z: 7.5 });
        const text = agent.knowledgeBlock();
        assert.ok(!text.includes('Ore left behind'), text);
        assert.ok(text.includes('Mines: "mine", entrance (0, 64, -3), level 34.'), text);
        const mines = agent._workStores().mines.list('overworld');
        assert.equal(mines[0].passed.length, 2, 'the store keeps the list');
        assert.equal(text, KT.knowledgeText({ chests: [], areas: [], mines: mines.map(({ passed, ...m }) => m), places: null,
            where: { ...agent.whereAmI(), pos: { x: 21.5, y: 34, z: 7.5 } } }, 600));
    });
});
