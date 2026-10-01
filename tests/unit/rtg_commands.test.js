// Part G of v0.1.4.9 (E5): the commands in src/agent/commands/actions.js.
//   - the six commands of I10: names, parameters, types and defaults; short descriptions that say when to use
//     them; each answers that its part is off and touches no pack while the switch is off;
//   - with the switches on: rememberRoute(bot, ctx, name), routesText(ctx, dimension), forgetRoute(ctx, name,
//     dimension) of the routes pack, rememberMine and rememberTunnel(bot, ctx, name, { playerYaw }) with the yaw
//     of the player of agent.last_order are plain commands (decision of the tech lead): no action, a running
//     action such as !followPlayer keeps running; collectPassedOre(bot, ctx, ore, num) walks, so it is an action
//     through runPack that pauses unstuck; the texts word for word;
//   - !goToRememberedPlace: a way of the player (ctx.routes.walkTo) when the path search did not arrive; F2: a way
//     that routeFor finds for the place goes first, with unstuck paused, and a failed way is the answer;
//   - F4: !collectBlocks decides whether an ore is in sight by the rule of part C; underground never !mineOre;
//   - F32: !viewChest records the chest it showed with recordChest(ctx, pos, items) of the storage pack;
//   - !newAction with skills_over_code: a digging request gets digRefusalText with the commands that are on,
//     before the cost check, and the code model is never called; a typed !newAction runs.
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
const DIG = await loadSrc('src/agent/dig_request_logic.js');

const BASE = { language: 'en', world_memory: true, mining_pack: false, routes_pack: false, mine_routes: false, skills_over_code: false,
    allow_insecure_coding: true, blocked_actions: [] };
const ROUTES_ON = { routes_pack: true };
const MINE_ON = { mining_pack: true, routes_pack: true, mine_routes: true };
const ROUTE_COMMANDS = ['!rememberRoute', '!routes', '!forgetRoute'];
const MINE_COMMANDS = ['!rememberMine', '!rememberTunnel', '!collectPassedOre'];

let cap;
before(() => M.mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => M.mcdata.__setMcdataForTests(null));
beforeEach(() => {
    cap = captureConsole();
    M.settingsModule.setSettings({ ...BASE });
});
afterEach(() => cap.restore());

const command = (name) => {
    const cmd = M.actions.actionsList.find((c) => c.name === name) ?? M.queries.queryList.find((c) => c.name === name);
    assert.ok(cmd, `${name} exists`);
    return cmd;
};

// A fake agent: runAction runs fn and returns a finished action with the output of the bot; packContext is a
// marked context; bot.modes records the pauses; the packs record their calls.
function makeAgent({ packs = {}, fields = {}, bot = {} } = {}) {
    const agent = {
        name: 'andy', calls: [], pauses: [], turns: [], runs: [],
        bot: {
            username: 'andy', output: '', interrupt_code: false, entity: { position: vec(0.5, 64, 0.5) }, game: { dimension: 'overworld' },
            players: {}, modes: { pause: (name) => agent.pauses.push(name) },
            ...bot,
        },
        work_packs: packs,
        history: { add: async (name, content) => { agent.turns.push([name, content]); }, getHistory: () => [] },
        packContext: () => ({ marker: 'ctx' }),
        actions: {
            async runAction(label, fn, options) {
                agent.runs.push({ label, options });
                await fn();
                const output = 'Action output:\n' + agent.bot.output;
                agent.bot.output = '';
                return { success: true, message: output, interrupted: false, timedout: false };
            },
        },
        running_commands: [],
        ...fields,
    };
    return agent;
}

// The path search of the fake bot: goToPosition in cheat mode teleports with /tp; `stuck` keeps the bot where it is.
function placeAgent({ stuck = true, walk = null } = {}) {
    const agent = makeAgent({
        fields: {
            memory_bank: { recallPlace: () => [12, 45, 8], recallPlaceInfo: () => ({ dimension: 'overworld' }) },
            homeContext: () => ({ routes: walk === null ? null : { walkTo: async (bot, target) => { agent.calls.push(['walkTo', bot, target]); return walk; } } }),
        },
        bot: { modes: { isOn: (name) => name === 'cheat', pause: (name) => agent.pauses.push(name) } },
    });
    agent.bot.chat = (text) => {
        const m = /^\/tp @s (\S+) (\S+) (\S+)$/.exec(text);
        if (m && !stuck) agent.bot.entity.position = vec(Number(m[1]), Number(m[2]), Number(m[3]));
    };
    return agent;
}

// Packs that must not be touched: every property read throws.
function untouchable() {
    const agent = makeAgent();
    for (const key of ['work_packs', 'packContext', 'homeContext']) {
        Object.defineProperty(agent, key, { get() { throw new Error(`${key} was used with the switch off`); } });
    }
    return agent;
}

describe('the six commands of I10: names, parameters and defaults', () => {
    const TABLE = [
        ['!rememberRoute', [['name', 'string', undefined]]],
        ['!routes', []],
        ['!forgetRoute', [['name', 'string', undefined]]],
        ['!rememberMine', [['name', 'string', 'mine']]],
        ['!rememberTunnel', [['name', 'string', '']]],
        ['!collectPassedOre', [['ore', 'string', undefined], ['num', 'int', 8]]],
    ];
    for (const [name, params] of TABLE) {
        test(name, () => {
            const cmd = command(name);
            assert.deepEqual(Object.entries(cmd.params ?? {}).map(([n, p]) => [n, p.type, p.default]), params);
            for (const p of Object.values(cmd.params ?? {})) assert.ok(typeof p.description === 'string' && p.description.length > 0);
            assert.ok(M.index.isAction(name), 'in the list of actions, like !forgetPlace (only !collectPassedOre runs as one)');
        });
    }

    test('the parser fills the defaults', () => {
        const cases = [['!rememberMine', ['mine']], ['!rememberMine("north_mine")', ['north_mine']], ['!rememberTunnel', ['']],
            ['!collectPassedOre("coal")', ['coal', 8]], ['!collectPassedOre("gold", 2)', ['gold', 2]], ['!routes', []], ['!rememberRoute("bed")', ['bed']]];
        for (const [call, args] of cases) assert.deepEqual(M.index.parseCommandMessage(call).args, args, call);
        assert.match(M.index.parseCommandMessage('!forgetRoute'), /was given 0 args/);
    });

    test('the descriptions: short, plain, at most two sentences; the ones that learn say when to use them', () => {
        for (const name of [...ROUTE_COMMANDS, ...MINE_COMMANDS]) {
            const description = command(name).description;
            assert.ok(description.length <= 140, `${name}: ${description}`);
            assert.ok(description.split(/(?<=\.)\s+/).length <= 2, `${name}: ${description}`);
        }
        assert.match(command('!rememberRoute').description, /Use this when the player says "remember this way"\./);
        assert.match(command('!rememberMine').description, /Use this when the player says "remember this mine"\./);
        assert.match(command('!rememberTunnel').description, /Use this when the player says "dig here"\./);
        assert.match(command('!collectPassedOre').description, /left behind/);
    });
});

describe('the switches off: the commands answer that their part is off and touch no pack', () => {
    test('routes_pack off: the three commands of the routes pack', async () => {
        for (const [name, args] of [['!rememberRoute', ['bed']], ['!routes', []], ['!forgetRoute', ['bed']]]) {
            assert.equal(await command(name).perform(untouchable(), ...args), 'The routes pack is off.', name);
        }
    });

    test('mine_routes not in effect: the three commands of the mine, for every switch that is off', async () => {
        for (const off of ['mining_pack', 'routes_pack', 'mine_routes']) {
            M.settingsModule.setSettings({ ...BASE, ...MINE_ON, [off]: false });
            for (const [name, args] of [['!rememberMine', ['mine']], ['!rememberTunnel', ['']], ['!collectPassedOre', ['coal', 8]]]) {
                assert.equal(await command(name).perform(untouchable(), ...args), 'The mine routes are off. They need mine_routes, mining_pack and routes_pack.', `${name}, ${off} off`);
            }
        }
    });

    test('!goToRememberedPlace with routes_pack off: no way of the player is asked for, as in v0.1.4.8', async () => {
        const agent = placeAgent({ walk: { ok: true, reason: null, text: 'I followed the route "bed", 7 steps.', route: 'bed' } });
        let asked = 0;
        agent.homeContext = () => { asked++; return {}; };
        const output = await command('!goToRememberedPlace').perform(agent, 'bed');
        assert.equal(asked, 0);
        assert.equal(agent.calls.length, 0);
        assert.ok(!output.includes('route'), output);
    });
});

describe('the routes pack: !rememberRoute, !routes, !forgetRoute', () => {
    function routesPack(agent) {
        return {
            rememberRoute: (bot, ctx, name, ...rest) => {
                agent.calls.push(['rememberRoute', bot, ctx, name, rest.length]);
                return { ok: true, reason: null, text: 'I remember the way "bed": from the place "storage" to here, 7 steps, 1 ladder, 1 trapdoor. I walk it in both directions.', route: {} };
            },
            routesText: (ctx, dimension) => {
                agent.calls.push(['routesText', ctx, dimension]);
                return 'I know no routes.';
            },
            forgetRoute: (ctx, name, dimension) => {
                agent.calls.push(['forgetRoute', ctx, name, dimension]);
                return { ok: false, reason: 'unknown', text: `I know no route "${name}".` };
            },
        };
    }

    test('plain commands: the text of the pack word for word, the pack context; no action runs, nothing is paused', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const agent = makeAgent();
        agent.work_packs = { routes: routesPack(agent) };
        assert.equal(await command('!rememberRoute').perform(agent, 'bed'),
            'I remember the way "bed": from the place "storage" to here, 7 steps, 1 ladder, 1 trapdoor. I walk it in both directions.');
        assert.equal(await command('!routes').perform(agent), 'I know no routes.');
        assert.equal(await command('!forgetRoute').perform(agent, 'bed'), 'I know no route "bed".');
        assert.deepEqual(agent.calls.map((c) => c.slice(0, 1)), [['rememberRoute'], ['routesText'], ['forgetRoute']]);
        const [remember, list, forget] = agent.calls;
        assert.equal(remember[1], agent.bot);
        assert.deepEqual(remember[2], { marker: 'ctx' });
        assert.equal(remember[3], 'bed');
        assert.equal(remember[4], 0, 'no options');
        assert.deepEqual(list.slice(1), [{ marker: 'ctx' }, 'overworld']);
        assert.deepEqual(forget.slice(1), [{ marker: 'ctx' }, 'bed', 'overworld']);
        assert.deepEqual(agent.runs, [], 'no action');
        assert.deepEqual(agent.pauses, [], 'the bot does not move: unstuck is not paused');
    });

    test('the text is noted for say_results and the result for the repeat guard, as runForText does', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const agent = makeAgent();
        agent.work_packs = { routes: routesPack(agent) };
        const entry = { name: '!forgetRoute', typed: false };
        agent.running_commands = [entry];
        assert.equal(await command('!forgetRoute').perform(agent, 'bed'), 'I know no route "bed".');
        assert.equal(agent.last_pack_text, 'I know no route "bed".');
        assert.deepEqual(entry.pack, { ok: false, reason: 'unknown', text: 'I know no route "bed".' });
        agent.work_packs.routes.forgetRoute = () => { throw new Error('broken store'); };
        assert.equal(await command('!forgetRoute').perform(agent, 'bed'), 'The routes pack failed: broken store');
        assert.deepEqual(entry.pack, { ok: false, reason: 'error', text: 'The routes pack failed: broken store' });
    });

    test('the pack could not be loaded: the text of runPack, no action', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const agent = makeAgent();
        assert.equal(await command('!routes').perform(agent), 'The routes pack could not be loaded.');
        assert.equal(await command('!rememberRoute').perform(agent, 'bed'), 'The routes pack could not be loaded.');
        assert.deepEqual(agent.runs, []);
    });

    test('a running action (!followPlayer) is not stopped by !rememberRoute; it keeps running until it is stopped', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const AM = await loadSrc('src/agent/action_manager.js');
        const agent = makeAgent();
        agent.work_packs = { routes: routesPack(agent) };
        const requests = [];
        Object.assign(agent, {
            requestInterrupt(by) { requests.push(by); agent.bot.interrupt_code = true; },
            clearBotLogs() { agent.bot.output = ''; agent.bot.interrupt_code = false; },
            isIdle: () => !agent.actions.executing,
            cleanKill() { throw new Error('no kill'); },
            self_prompter: { isActive: () => false },
        });
        agent.bot.emit = () => {};
        agent.actions = new AM.ActionManager(agent);
        let ticks = 0;
        const follow = async () => {
            while (!agent.bot.interrupt_code) {
                ticks++;
                await new Promise((r) => setTimeout(r, 5));
            }
        };
        // as a resume action (!followPlayer), without the global assert of the SES lockdown that _executeResume needs
        const following = agent.actions.runAction('action:followPlayer', follow);
        agent.actions.resume_func = follow;
        agent.actions.resume_name = 'action:followPlayer';
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(agent.actions.currentActionLabel, 'action:followPlayer');
        const text = await command('!rememberRoute').perform(agent, 'bed');
        assert.match(text, /^I remember the way "bed"/);
        const before = ticks;
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(agent.actions.executing, true, 'still following');
        assert.equal(agent.actions.currentActionLabel, 'action:followPlayer');
        assert.equal(agent.actions.resume_name, 'action:followPlayer', 'its resume is kept');
        assert.ok(ticks > before, 'the action went on');
        assert.deepEqual(requests, [], 'nobody asked to interrupt');
        assert.equal(agent.bot.interrupt_code, false);
        await agent.actions.stop('!stop');
        const result = await following;
        assert.equal(result.interrupted, true);
        agent.actions.cancelResume();
    });

    test('the real routes pack in memory: remembered, listed and forgotten with the texts of A2 and A3', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const R = await loadSrc('src/agent/packs/routes/index.js');
        const store = new R.RouteStore(null);
        store.load();
        const agent = makeAgent({ packs: { routes: R } });
        agent.packContext = () => ({ routes: { store, trail: { list: () => [] } }, places: null, areas: null, mines: null });
        assert.equal(await command('!routes').perform(agent), 'I know no routes.');
        assert.equal(await command('!forgetRoute').perform(agent, 'bed'), 'I know no route "bed".');
        assert.equal(await command('!rememberRoute').perform(agent, 'bed'), R.TEXTS.noStart);
    });
});

describe('the mine of the player: !rememberMine, !rememberTunnel, !collectPassedOre', () => {
    function miningPack(agent) {
        return {
            rememberMine: async (bot, ctx, name, options) => {
                agent.calls.push(['rememberMine', bot, ctx, name, options]);
                return { ok: true, reason: null, text: 'I remember the mine "mine".', mine: {} };
            },
            rememberTunnel: async (bot, ctx, name, options) => {
                agent.calls.push(['rememberTunnel', bot, ctx, name, options]);
                return { ok: false, reason: 'no_mine', text: 'I know no mine here. Tell me "this is the mine" first.', mine: null, tunnel: null };
            },
            collectPassedOre: async (bot, ctx, ore, count, ...rest) => {
                agent.calls.push(['collectPassedOre', bot, ctx, ore, count, rest.length]);
                return { ok: false, reason: 'none', text: `I passed no ${ore} in the mine "mine".`, collected: 0 };
            },
        };
    }

    test('!rememberMine and !rememberTunnel plain, !collectPassedOre an action through runPack; the texts word for word', async () => {
        M.settingsModule.setSettings({ ...BASE, ...MINE_ON });
        const agent = makeAgent();
        agent.work_packs = { mining: miningPack(agent) };
        assert.equal(await command('!rememberMine').perform(agent, 'mine'), 'I remember the mine "mine".');
        assert.equal(await command('!rememberTunnel').perform(agent, ''), 'I know no mine here. Tell me "this is the mine" first.');
        assert.equal(await command('!collectPassedOre').perform(agent, 'coal', 8), 'I passed no coal in the mine "mine".');
        const [mine, tunnel, ore] = agent.calls;
        assert.deepEqual(mine.slice(2), [{ marker: 'ctx' }, 'mine', { playerYaw: undefined }]);
        assert.equal(mine[1], agent.bot);
        assert.deepEqual(tunnel.slice(2), [{ marker: 'ctx' }, '', { playerYaw: undefined }]);
        assert.deepEqual(ore.slice(2), [{ marker: 'ctx' }, 'coal', 8, 0]);
        assert.deepEqual(agent.runs.map((r) => r.label), ['action:collectPassedOre'], 'only the command that walks is an action');
        assert.deepEqual(agent.pauses, ['unstuck'], 'it pauses unstuck');
    });

    test('playerYaw: the yaw of the player of agent.last_order, when he is in bot.players with an entity', async () => {
        M.settingsModule.setSettings({ ...BASE, ...MINE_ON });
        const cases = [
            [{ by: 'steve', command: '!rememberTunnel', typed: true }, { steve: { entity: { yaw: 1.25 } } }, 1.25],
            [{ by: 'steve', command: '!rememberTunnel', typed: false }, { steve: { entity: { yaw: -3.1 } } }, -3.1],
            [{ by: 'steve', command: '!rememberTunnel' }, { steve: { entity: null } }, undefined],
            [{ by: 'steve', command: '!rememberTunnel' }, { alex: { entity: { yaw: 1 } } }, undefined],
            [null, { steve: { entity: { yaw: 1 } } }, undefined],
            [{ by: 'steve' }, { steve: { entity: { yaw: NaN } } }, undefined],
        ];
        for (const [order, players, yaw] of cases) {
            const agent = makeAgent({ fields: { last_order: order }, bot: { players } });
            agent.work_packs = { mining: miningPack(agent) };
            await command('!rememberTunnel').perform(agent, '');
            await command('!rememberMine').perform(agent, 'mine');
            assert.deepEqual(agent.calls.map((c) => c[4]), [{ playerYaw: yaw }, { playerYaw: yaw }], JSON.stringify({ order, players }));
        }
    });

    test('the pack could not be loaded: the text of runPack', async () => {
        M.settingsModule.setSettings({ ...BASE, ...MINE_ON });
        assert.equal(await command('!collectPassedOre').perform(makeAgent(), 'coal', 8), 'The mining pack could not be loaded.');
        assert.equal(await command('!rememberMine').perform(makeAgent(), 'mine'), 'The mining pack could not be loaded.');
        assert.equal(await command('!rememberTunnel').perform(makeAgent(), ''), 'The mining pack could not be loaded.');
    });
});

describe('!goToRememberedPlace: a way of the player where the path search did not arrive (I4)', () => {

    test('farther than 2 blocks after the walk: walkTo(bot, the place); a failure other than no_route gives its text', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const text = 'I could not follow the route "bed" at step 3 of 7, at (12, 45, 8). Show me the way again.';
        const agent = placeAgent({ walk: { ok: false, reason: 'no_path', text, route: 'bed' } });
        const output = await command('!goToRememberedPlace').perform(agent, 'bed');
        assert.deepEqual(agent.calls.map((c) => [c[0], c[2]]), [['walkTo', { x: 12, y: 45, z: 8 }]]);
        assert.equal(agent.calls[0][1], agent.bot);
        assert.ok(output.includes(text), output);
        assert.ok(agent.pauses.includes('unstuck'), 'the walk of a way pauses unstuck');
    });

    test('no route: nothing more is said; a route that was followed: its text', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const none = placeAgent({ walk: { ok: false, reason: 'no_route', text: '', route: null } });
        const quiet = await command('!goToRememberedPlace').perform(none, 'bed');
        assert.equal(none.calls.length, 1);
        assert.ok(!/route/.test(quiet), quiet);
        const followed = placeAgent({ walk: { ok: true, reason: null, text: 'I followed the route "bed", 7 steps.', route: 'bed' } });
        assert.ok((await command('!goToRememberedPlace').perform(followed, 'bed')).includes('I followed the route "bed", 7 steps.'));
    });

    test('arrived (within 2 blocks): no way is asked for; no routes on the context: nothing happens', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const arrived = placeAgent({ stuck: false, walk: { ok: true, reason: null, text: 'x', route: 'bed' } });
        await command('!goToRememberedPlace').perform(arrived, 'bed');
        assert.equal(arrived.calls.length, 0);
        const without = placeAgent({ walk: null });
        await command('!goToRememberedPlace').perform(without, 'bed');
        assert.equal(without.calls.length, 0);
    });
});

describe('F2: !goToRememberedPlace walks a way of the player first, when routeFor finds one for the place', () => {
    // The events in order: the pause of unstuck, walkTo of the routes, the path search (the /tp of goToPosition in cheat
    // mode), enterBuilding of the home pack (areasAt of the area store).
    function routeAgent({ route = { name: 'bed' }, walk = { ok: true, reason: null, text: 'I followed the route "bed", 4 steps.', route: 'bed' }, stuck = true } = {}) {
        const agent = placeAgent({ stuck, walk });
        agent.events = [];
        const target = [];
        agent.homeContext = () => ({
            routes: {
                routeFor: (place) => { target.push(place); return route === null ? null : { route, reverse: true, distance: 3 }; },
                walkTo: async (bot, place) => { agent.events.push('walkTo'); agent.calls.push(['walkTo', bot, place]); return walk; },
            },
        });
        agent.bot.modes.pause = (name) => agent.events.push(`pause ${name}`);
        const chat = agent.bot.chat;
        agent.bot.chat = (text) => { agent.events.push('goToPosition'); chat(text); };
        agent.area_store = { areasAt: () => { agent.events.push('enterBuilding'); return []; } };
        agent.target = target;
        return agent;
    }

    test('with a route: unstuck paused, walkTo before the path search; the text of the route in the output; no enterBuilding before it', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON, home_pack: true });
        const agent = routeAgent();
        const output = await command('!goToRememberedPlace').perform(agent, 'bed');
        assert.deepEqual(agent.events, ['pause unstuck', 'walkTo', 'goToPosition']);
        assert.deepEqual(agent.target, [{ x: 12, y: 45, z: 8 }], 'routeFor asked for the place');
        assert.deepEqual(agent.calls[0][2], { x: 12, y: 45, z: 8 });
        assert.equal(agent.calls[0][1], agent.bot);
        assert.ok(output.includes('I followed the route "bed", 4 steps.'), output);
    });

    test('a route that fails (not no_route): its text is the output, nothing else is tried', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON, home_pack: true });
        const text = 'I could not follow the route "bed" at step 3 of 4, at (2, 61, -3). Show me the way again.';
        const agent = routeAgent({ walk: { ok: false, reason: 'no_path', text, route: 'bed' } });
        const output = await command('!goToRememberedPlace').perform(agent, 'bed');
        assert.deepEqual(agent.events, ['pause unstuck', 'walkTo'], 'no path search, no second walk');
        assert.equal(output, `Action output:\n${text}\n`);
    });

    test('a route that was stopped: its text, nothing else', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON });
        const agent = routeAgent({ walk: { ok: false, reason: 'interrupted', text: 'I was stopped on the route "bed" at step 2 of 4.', route: 'bed' } });
        const output = await command('!goToRememberedPlace').perform(agent, 'bed');
        assert.deepEqual(agent.events, ['pause unstuck', 'walkTo']);
        assert.ok(output.includes('I was stopped on the route "bed" at step 2 of 4.'), output);
    });

    test('without a route for the place: as before (enterBuilding, the path search, then a way only when it did not arrive), nothing paused first', async () => {
        M.settingsModule.setSettings({ ...BASE, ...ROUTES_ON, home_pack: true });
        const agent = routeAgent({ route: null, walk: { ok: false, reason: 'no_route', text: '', route: null } });
        await command('!goToRememberedPlace').perform(agent, 'bed');
        assert.deepEqual(agent.events, ['enterBuilding', 'goToPosition', 'pause unstuck', 'walkTo']);
        const arrived = routeAgent({ route: null, stuck: false });
        await command('!goToRememberedPlace').perform(arrived, 'bed');
        assert.deepEqual(arrived.events, ['enterBuilding', 'goToPosition'], 'arrived: no way is walked');
    });

    test('routes_pack off: no route is asked for, as in v0.1.4.8', async () => {
        const agent = routeAgent();
        await command('!goToRememberedPlace').perform(agent, 'bed');
        assert.deepEqual(agent.events, ['goToPosition']);
        assert.deepEqual(agent.target, []);
    });
});

describe('F4: !collectBlocks and an ore, by the sight rule of part C (oreInSight with ore_sense_range)', () => {
    // A fake world: the ore at (3, 60, 0), stone around it, air where `open` says. runAction gives the old collecting
    // (timeout 10) without running it, and runs a pack command.
    function oreAgent({ open = [], underground = false, where = true } = {}) {
        const asked = [];
        const bot = {
            findBlocks(options) {
                asked.push(options);
                return [vec(3, 60, 0)];
            },
            blockAt: (pos) => {
                const key = `${pos.x},${pos.y},${pos.z}`;
                const name = key === '3,60,0' ? 'iron_ore' : (open.includes(key) ? 'air' : 'stone');
                return { name, position: pos };
            },
            canSeeBlock() { throw new Error('the ray from the eyes is no longer asked'); },
        };
        const agent = makeAgent({ bot });
        agent.asked = asked;
        if (where)
            agent.whereAmI = () => ({ area: null, depth: underground ? 30 : 0, underground, mine: null });
        agent.work_packs = {
            mining: {
                oreOf: (type) => (/iron/.test(type) ? { ore: 'iron' } : null),
                mineOre: async (b, ctx, ore, num) => { agent.calls.push(['mineOre', ore, num]); return { ok: true, reason: null, text: 'mineOre text' }; },
            },
        };
        agent.actions.runAction = async (label, fn, options) => {
            agent.runs.push({ label, options });
            if (options.timeout === 10)
                return { success: true, message: 'Action output:\nold collecting', interrupted: false, timedout: false };
            await fn();
            return { success: true, message: 'Action output:\n', interrupted: false, timedout: false };
        };
        return agent;
    }

    test('an ore with a face in the open (at the height of the feet): the old collecting, never !mineOre', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, ore_sense_range: 0 });
        const agent = oreAgent({ open: ['2,60,0'] });
        assert.equal(await command('!collectBlocks').perform(agent, 'iron_ore', 2), 'Action output:\nold collecting');
        assert.deepEqual(agent.calls, []);
        assert.equal(agent.asked[0].maxDistance, 16);
        for (const id of ['iron_ore', 'deepslate_iron_ore'].map((n) => M.mcdata.getBlockId(n))) assert.ok(agent.asked[0].matching.includes(id));
    });

    test('none in sight, underground: the old collecting (the text of C1 of the library is the answer), never !mineOre', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, ore_sense_range: 0 });
        const agent = oreAgent({ underground: true });
        assert.equal(await command('!collectBlocks').perform(agent, 'iron_ore', 2), 'Action output:\nold collecting');
        assert.deepEqual(agent.calls, []);
        assert.deepEqual(agent.runs, [{ label: 'action:collectBlocks', options: { timeout: 10, resume: false } }]);
    });

    test('none in sight, on the surface: !mineOre with the ore and the number, as before', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, ore_sense_range: 0 });
        for (const agent of [oreAgent({ underground: false }), oreAgent({ where: false })]) {
            assert.equal(await command('!collectBlocks').perform(agent, 'iron_ore', 3), 'mineOre text');
            assert.deepEqual(agent.calls, [['mineOre', 'iron', 3]]);
        }
    });

    test('ore_sense_range 3: an ore 2 blocks inside the wall of an open cell is in sight; with 0 it is not', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, ore_sense_range: 3 });
        const near = oreAgent({ open: ['5,60,0'] });
        assert.equal(await command('!collectBlocks').perform(near, 'iron_ore', 1), 'Action output:\nold collecting');
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, ore_sense_range: 0 });
        const far = oreAgent({ open: ['5,60,0'] });
        assert.equal(await command('!collectBlocks').perform(far, 'iron_ore', 1), 'mineOre text');
    });
});

describe('F32: !viewChest records the chest it showed in the chest index (recordChest of the storage pack)', () => {
    // A fake bot with one chest at (5, 64, 2); goToPosition in cheat mode teleports; the chest holds `items`.
    function chestAgent(items, { record = true } = {}) {
        const agent = makeAgent({
            bot: {
                modes: { isOn: (name) => name === 'cheat', pause() {} },
                findBlocks: () => [vec(5, 64, 2)],
                blockAt: (pos) => ({ name: 'chest', position: pos }),
                openContainer: async () => ({ containerItems: () => items, close: async () => {} }),
                chat() {},
            },
        });
        agent.recorded = [];
        agent.looked = [];
        agent.work_packs = {
            storage: {
                lookIntoChest: async (bot, ctx, pos) => { agent.looked.push(pos); return { ok: true, text: '' }; },
                ...(record ? { recordChest: (ctx, pos, list) => { agent.recorded.push({ ctx, pos, list }); return { ok: true }; } } : {}),
            },
        };
        return agent;
    }

    test('the position and the items of the text of viewChest; the old look into the chest is not needed', async () => {
        M.settingsModule.setSettings({ ...BASE, storage_pack: true });
        const agent = chestAgent([{ name: 'torch', count: 20 }, { name: 'coal', count: 5 }, { name: 'torch', count: 12 }]);
        const output = await command('!viewChest').perform(agent);
        assert.ok(output.includes('The chest at (5, 64, 2) contains: torch 32, coal 5.'), output);
        assert.equal(agent.recorded.length, 1);
        assert.deepEqual(agent.recorded[0].pos, { x: 5, y: 64, z: 2 });
        assert.deepEqual(agent.recorded[0].list, [{ name: 'torch', count: 32 }, { name: 'coal', count: 5 }]);
        assert.deepEqual(agent.recorded[0].ctx.marker, 'ctx', 'the pack context');
        assert.deepEqual(agent.looked, []);
    });

    test('an empty chest records an empty list', async () => {
        M.settingsModule.setSettings({ ...BASE, storage_pack: true });
        const agent = chestAgent([]);
        assert.ok((await command('!viewChest').perform(agent)).includes('The chest at (5, 64, 2) is empty.'));
        assert.deepEqual(agent.recorded.map((r) => [r.pos, r.list]), [[{ x: 5, y: 64, z: 2 }, []]]);
    });

    test('a storage pack without recordChest: the old lookIntoChest; storage_pack off: nothing is recorded', async () => {
        M.settingsModule.setSettings({ ...BASE, storage_pack: true });
        const old = chestAgent([{ name: 'coal', count: 1 }], { record: false });
        await command('!viewChest').perform(old);
        assert.deepEqual(old.looked.map((p) => [p.x, p.y, p.z]), [[5, 64, 2]]);
        M.settingsModule.setSettings({ ...BASE, storage_pack: false });
        const off = chestAgent([{ name: 'coal', count: 1 }]);
        await command('!viewChest').perform(off);
        assert.deepEqual(off.recorded, []);
        assert.deepEqual(off.looked, []);
    });

    test('viewedChest reads the last text of viewChest in an output', () => {
        const { viewedChest } = M.actions;
        assert.deepEqual(viewedChest('Action output:\nThe chest at (-3, 41, 12) contains: oak_log 64, wheat_seeds 3.\n'),
            { pos: { x: -3, y: 41, z: 12 }, items: [{ name: 'oak_log', count: 64 }, { name: 'wheat_seeds', count: 3 }] });
        assert.deepEqual(viewedChest('The chest at (1, 2, 3) is empty.'), { pos: { x: 1, y: 2, z: 3 }, items: [] });
        assert.equal(viewedChest('Could not find a chest nearby.'), null);
        assert.equal(viewedChest(null), null);
    });
});

describe('!newAction with skills_over_code (I8)', () => {
    const FULL = 'I do not write code for digging. I have skills for it: !mineOre for an ore, !rememberTunnel and then !mineOre to dig on in a tunnel, !collectBlocks for blocks in sight.';

    function coderAgent({ history = [], fields = {} } = {}) {
        const agent = makeAgent({ fields });
        agent.history.getHistory = () => history.map((t) => ({ ...t }));
        agent.coder = { generateCode: async () => { agent.calls.push('coder'); return 'code ran'; }, last_run: null };
        return agent;
    }

    test('a digging prompt: the text of I8 with the commands that are on; the code model is never called', async () => {
        M.settingsModule.setSettings({ ...BASE, ...MINE_ON, skills_over_code: true });
        const agent = coderAgent();
        assert.equal(await command('!newAction').perform(agent, 'dig a tunnel to the east'), FULL);
        assert.deepEqual(agent.calls, []);
        assert.equal(agent.runs.length, 0, 'no action ran');
        assert.equal(FULL, DIG.digRefusalText(['!mineOre', '!rememberTunnel', '!collectBlocks']));
    });

    test('the commands that are on: !mineOre with mining_pack, !rememberTunnel with the mine routes, !collectBlocks always, none that is blocked', async () => {
        const cases = [
            [{ mining_pack: true }, [], ['!mineOre', '!collectBlocks']],
            [{}, [], ['!collectBlocks']],
            [{ ...MINE_ON }, ['!collectBlocks'], ['!mineOre', '!rememberTunnel']],
            [{ ...MINE_ON }, ['!mineOre'], ['!collectBlocks']],
            [{}, ['!collectBlocks'], []],
        ];
        for (const [switches, blocked, on] of cases) {
            M.settingsModule.setSettings({ ...BASE, ...switches, skills_over_code: true, blocked_actions: blocked });
            const agent = coderAgent();
            assert.equal(await command('!newAction').perform(agent, 'build a strip mine'), DIG.digRefusalText(on), JSON.stringify({ switches, blocked }));
        }
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, skills_over_code: true });
        const hidden = coderAgent({ fields: { blocked_actions: ['!mineOre'] } });
        assert.equal(await command('!newAction').perform(hidden, 'dig down'), DIG.digRefusalText(['!collectBlocks']), 'a pack that did not load hides !mineOre');
        assert.equal(DIG.digRefusalText([]), 'I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.');
    });

    test('the last message of a player asks for digging: refused, whatever the prompt says', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, skills_over_code: true });
        const history = [{ role: 'user', content: 'steve: get me some iron' }, { role: 'assistant', content: 'On it.' }, { role: 'system', content: 'Mining.' }];
        const agent = coderAgent({ history });
        assert.equal(await command('!newAction').perform(agent, 'Write a loop that breaks blocks ahead'), DIG.digRefusalText(['!mineOre', '!collectBlocks']));
        assert.deepEqual(agent.calls, []);
    });

    test('no digging request: the code is written; the name of the player does not count', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, skills_over_code: true });
        const agent = coderAgent({ history: [{ role: 'user', content: 'miner_joe: build a small house' }, { role: 'user', content: 'dig: build a wall' }] });
        assert.equal(await command('!newAction').perform(agent, 'Build a wall of 3 oak planks'), 'code ran');
        assert.deepEqual(agent.calls, ['coder']);
    });

    test('a !newAction that the player typed runs', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, skills_over_code: true });
        const agent = coderAgent({ fields: { running_commands: [{ name: '!newAction', typed: true, by: 'steve' }] } });
        assert.equal(await command('!newAction').perform(agent, 'dig a tunnel to the east'), 'code ran');
        const ordered = coderAgent({ fields: { last_order: { by: 'steve', command: '!newAction', typed: true } } });
        assert.equal(await command('!newAction').perform(ordered, 'dig a tunnel to the east'), 'code ran');
        const answered = coderAgent({ fields: { running_commands: [{ name: '!newAction', typed: false }] } });
        assert.equal(await command('!newAction').perform(answered, 'dig a tunnel to the east'), DIG.digRefusalText(['!mineOre', '!collectBlocks']));
    });

    test('before the cost check: in the state saving a digging request gets the text of I8', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true, skills_over_code: true });
        const agent = coderAgent({ fields: { cost_meter: { allows: () => false } } });
        assert.equal(await command('!newAction').perform(agent, 'dig a tunnel'), DIG.digRefusalText(['!mineOre', '!collectBlocks']));
        assert.equal(await command('!newAction').perform(agent, 'build a house'), 'I reached my cost limit and do not write new code now. Use the commands I have.');
    });

    test('skills_over_code off: the code for digging is written, as in v0.1.4.8', async () => {
        M.settingsModule.setSettings({ ...BASE, mining_pack: true });
        const agent = coderAgent({ history: [{ role: 'user', content: 'steve: dig a tunnel' }] });
        assert.equal(await command('!newAction').perform(agent, 'dig a tunnel to the east'), 'code ran');
        assert.deepEqual(agent.calls, ['coder']);
    });

    test('allow_insecure_coding off: the old answer comes first', async () => {
        M.settingsModule.setSettings({ ...BASE, skills_over_code: true, allow_insecure_coding: false });
        const agent = coderAgent({ fields: { openChat: () => {} } });
        assert.equal(await command('!newAction').perform(agent, 'dig a tunnel'), 'newAction not allowed! Code writing is disabled in settings. Notify the user.');
    });
});
