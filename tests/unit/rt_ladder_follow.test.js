// T1, spec v0.1.4.9 section 13 (Addendum, part L): the follow down a ladder (F14), tested from the spec.
//   ladder_logic.js  ladderColumnAt(getName, feet, { reach = 2, maxHeight = 64 }) and ladderWay(column, feet, target)
//   ladder_pass.js   passLadder(bot, column, way, { clock, timeoutMs }) -> { ok, reason, text }, never throws
//   skills.js        followPlayer and goToPlayer: behind routes_pack (the agent settings first, then the file), a
//                    ladder pass when stuck or without a goal (at most 3 per minute), the log texts, the signatures and
//                    the return values unchanged; the ladder step runs with the switch off too (a correction of the
//                    path search, no switch: decision of the owner and the tech lead on 2026-10-01), and the mining pack is
//                    imported (checked in a child process, tests/helpers/rt_ladder_off_child.js).
// The scene (tests/helpers/rt_ladder_env.js): the base of the world tests on the fake bot of the mining pack; the bot
// beside the closed trapdoor at (2, 60, -2) over ladders facing south at (2, 41..59, -2), the player 20 blocks below.
// Where part L is not written yet, the tests fail with the import error of the missing module or export.
import { describe, test, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeMiningBot, makeClock, tick, REGISTRY } from './mining_fake_bot.test.js';
import { COLUMN, PLAYER, ladderWorld, ladderBot, runPhysics, until } from '../helpers/rt_ladder_env.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
mcdata.__setMcdataForTests(REGISTRY);
const agentSettings = await loadSrc('src/agent/settings.js');
const skills = await loadSrc('src/agent/library/skills.js');
const LL = await loadSrc('src/agent/library/ladder_logic.js');
const LP = await loadSrc('src/agent/library/ladder_pass.js');

let quiet;
before(() => {
    quiet = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = () => {};
});
after(() => {
    console.log = quiet.log;
    console.warn = quiet.warn;
    agentSettings.setSettings({});
});

// getName over the base: the grass at y 60, air above, stone below; the shaft, the ladders, the room and the trapdoor
function names({ trapdoor = true, ladders = [41, 59] } = {}) {
    const cells = new Map();
    const set = (x, y, z, n) => cells.set(`${x},${y},${z}`, n);
    for (let x = 0; x <= 4; x++) for (let y = 41; y <= 43; y++) for (let z = -2; z <= 2; z++) set(x, y, z, 'air');
    for (let y = 44; y <= 59; y++) set(2, y, -2, 'air');
    if (ladders) for (let y = ladders[0]; y <= ladders[1]; y++) set(2, y, -2, 'ladder');
    set(2, 60, -2, trapdoor ? 'oak_trapdoor' : 'air');
    return (x, y, z) => cells.get(`${x},${y},${z}`) ?? (y > 60 ? 'air' : y === 60 ? 'grass_block' : 'stone');
}
const pick = (c) => (c ? { x: c.x, z: c.z, top: c.top, bottom: c.bottom } : c);

// ------------------------------------------------------------------------------ ladderColumnAt

describe('13, L: ladderColumnAt(getName, feet, { reach, maxHeight })', () => {
    test('beside the top, with a trapdoor directly above the top', () => {
        const c = LL.ladderColumnAt(names(), { x: 2, y: 61, z: -1 }, {});
        assert.deepEqual(pick(c), { x: 2, z: -2, top: 59, bottom: 41 });
        assert.deepEqual(c.trapdoor && { x: c.trapdoor.x, y: c.trapdoor.y, z: c.trapdoor.z, name: c.trapdoor.name }, { x: 2, y: 60, z: -2, name: 'oak_trapdoor' });
    });

    test('without a trapdoor: trapdoor null', () => {
        const c = LL.ladderColumnAt(names({ trapdoor: false }), { x: 2, y: 61, z: -1 }, {});
        assert.deepEqual(pick(c), { x: 2, z: -2, top: 59, bottom: 41 });
        assert.equal(c.trapdoor, null);
    });

    test('at the foot: the bottom cell is within reach', () => {
        assert.deepEqual(pick(LL.ladderColumnAt(names(), { x: 2, y: 41, z: -1 }, {})), { x: 2, z: -2, top: 59, bottom: 41 });
    });

    test('the facing from the world: the ladder block\'s own facing (getName may give { name, facing })', () => {
        const plain = names();
        const withFacing = (x, y, z) => (plain(x, y, z) === 'ladder' ? { name: 'ladder', facing: 'south' } : plain(x, y, z));
        assert.equal(LL.ladderColumnAt(withFacing, { x: 2, y: 61, z: -1 }, {})?.facing, 'south');
    });

    test('the facing from names only: the side away from the wall (the shaft opens to the south into the room)', () => {
        // FINDING T1-L-1 (13, low): with names only, the facing is guessed at the top cell alone; in a shaft of 1 x 1
        // every side of the top is rock, so the facing is null although the column opens to the south at its foot.
        // The spec's getName returns names; the handoff-free extension { name, facing } (used by skills.js through
        // ladderReader) avoids it in play.
        assert.equal(LL.ladderColumnAt(names(), { x: 2, y: 61, z: -1 }, {})?.facing, 'south');
    });

    test('out of reach: 3 blocks sideways, or 3 above the top: null', () => {
        assert.equal(LL.ladderColumnAt(names(), { x: 2, y: 61, z: 1 }, {}), null, '3 blocks sideways');
        assert.equal(LL.ladderColumnAt(names(), { x: 2, y: 62, z: -1 }, {}), null, '3 blocks above the top');
        assert.equal(LL.ladderColumnAt(names(), { x: 20, y: 61, z: 20 }, {}), null);
    });

    test('the option reach', () => {
        assert.deepEqual(pick(LL.ladderColumnAt(names(), { x: 2, y: 61, z: 1 }, { reach: 3 })), { x: 2, z: -2, top: 59, bottom: 41 });
    });

    test('a column of one ladder: top and bottom the same cell', () => {
        // UNCLEAR T1-L-U2: the spec lists the case, not the answer; a column of one ladder is taken as a column.
        const c = LL.ladderColumnAt(names({ ladders: [41, 41] }), { x: 2, y: 41, z: -1 }, {});
        assert.deepEqual(pick(c), { x: 2, z: -2, top: 41, bottom: 41 });
    });

    test('no ladder near: null; never throws', () => {
        assert.equal(LL.ladderColumnAt(names({ ladders: null }), { x: 2, y: 61, z: -1 }, {}), null);
        assert.doesNotThrow(() => LL.ladderColumnAt(() => { throw new Error('no world'); }, { x: 0, y: 0, z: 0 }, {}));
    });
});

// ------------------------------------------------------------------------------ ladderWay

describe('13, L: ladderWay(column, feet, target)', () => {
    const top = { x: 2, y: 61, z: -1 };
    const foot = { x: 2, y: 41, z: -1 };

    test('down: the target 2 or more blocks below and within 3 blocks of the column', () => {
        assert.equal(LL.ladderWay(COLUMN, top, { x: 2.5, y: 41, z: -0.5 }), 'down');
        assert.equal(LL.ladderWay(COLUMN, top, { x: 4.5, y: 59, z: 0.5 }), 'down', '2 below, 3 sideways');
    });

    test('up: the target 2 or more blocks above', () => {
        assert.equal(LL.ladderWay(COLUMN, foot, { x: 2.5, y: 61, z: -0.5 }), 'up');
        assert.equal(LL.ladderWay(COLUMN, foot, { x: 2.5, y: 43, z: -0.5 }), 'up');
    });

    test('null: less than 2 blocks of height', () => {
        assert.equal(LL.ladderWay(COLUMN, top, { x: 2.5, y: 60, z: 3.5 }), null);
        assert.equal(LL.ladderWay(COLUMN, top, { x: 5.5, y: 61, z: 5.5 }), null);
    });

    test('null: the target below but too far from the column', () => {
        assert.equal(LL.ladderWay(COLUMN, top, { x: 12.5, y: 41, z: -0.5 }), null);
    });

    test('null: no column', () => {
        assert.equal(LL.ladderWay(null, top, { x: 2.5, y: 41, z: -0.5 }), null);
    });
});

// ------------------------------------------------------------------------------ passLadder

describe('13, L: passLadder on the fake bot of the mining pack', () => {
    const feet = (bot) => ({ x: Math.floor(bot.entity.position.x), y: Math.floor(bot.entity.position.y + 0.01), z: Math.floor(bot.entity.position.z) });

    test('down through the closed trapdoor: clicked open without sneak, the bot at the bottom', { timeout: 30000 }, async () => {
        const world = ladderWorld();
        const bot = ladderBot({ world });
        const clock = makeClock(bot);
        const r = await LP.passLadder(bot, { ...COLUMN }, 'down', { clock });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(bot.clicks.map((c) => [c.x, c.y, c.z, c.sneak]), [[2, 60, -2, false]]);
        assert.equal(world.propsAt(2, 60, -2).open, true);
        assert.deepEqual(feet(bot), { x: 2, y: 41, z: -2 });
        assert.equal(bot.calls.filter((c) => c[0] === 'dig').length, 0);
    });

    test('down through an open trapdoor: no click', { timeout: 30000 }, async () => {
        const world = ladderWorld({ open: true });
        const bot = ladderBot({ world });
        const r = await LP.passLadder(bot, { ...COLUMN }, 'down', { clock: makeClock(bot) });
        assert.equal(r.ok, true, r.text);
        assert.deepEqual(bot.clicks, []);
        assert.equal(feet(bot).y, 41);
    });

    test('up from the foot: the bot climbs to the top', { timeout: 30000 }, async () => {
        const world = ladderWorld({ trapdoor: false });
        const bot = ladderBot({ world, pos: [2.5, 41, -0.5] });
        const r = await LP.passLadder(bot, { ...COLUMN, trapdoor: null }, 'up', { clock: makeClock(bot) });
        assert.equal(r.ok, true, r.text);
        assert.ok(feet(bot).y >= 59, JSON.stringify(feet(bot)));
    });

    test('stopped on the way down: reason interrupted, never throws', { timeout: 30000 }, async () => {
        const world = ladderWorld({ open: true });
        const bot = ladderBot({ world });
        const clock = makeClock(bot);
        clock.onTick = () => {
            if (bot.entity.position.y < 55) bot.interrupt_code = true;
        };
        const r = await LP.passLadder(bot, { ...COLUMN }, 'down', { clock });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(typeof r.text, 'string');
    });

    test('never throws: a bot without a body, no column', async () => {
        const r = await LP.passLadder({ entity: null }, null, 'down', {});
        assert.equal(r.ok, false);
        const bot = makeMiningBot();
        const r2 = await LP.passLadder(bot, { ...COLUMN }, 'sideways', { clock: makeClock(bot) });
        assert.equal(r2.ok, false);
    });
});

// ------------------------------------------------------------------------------ followPlayer, goToPlayer

describe('13, L: followPlayer and goToPlayer with routes_pack', () => {
    beforeEach(() => agentSettings.setSettings({ routes_pack: true }));
    afterEach(() => agentSettings.setSettings({}));

    test('the player 20 blocks below at the foot: one pass down, the follow goal set again, the log text', { timeout: 60000 }, async () => {
        const bot = ladderBot();
        const stop = runPhysics(bot);
        const run = skills.followPlayer(bot, PLAYER, 4);
        try {
            await until(() => bot.entity.position.y < 42.5 && bot.goals.at(-1) === 'GoalFollow' && bot.goals.includes(null), 25000);
        } finally {
            bot.interrupt_code = true;
            await run;
            stop();
        }
        assert.ok(bot.entity.position.y < 42.5, `the bot went down: y ${bot.entity.position.y}`);
        assert.deepEqual(bot.goals, ['GoalFollow', null, 'GoalFollow'], 'the follow, stopped for the pass, then set again');
        assert.equal(bot.clicks.length, 1, 'the trapdoor clicked once: one pass');
        assert.match(bot.output, /I go down the ladder at \(2, -?\d+, -2\) after MartyByrde2\.\n/);
        assert.ok(bot.progress.includes('ladder'), 'noteProgress("ladder") after the pass');
    });

    test('the player above: one pass up, the log text', { timeout: 60000 }, async () => {
        const world = ladderWorld({ trapdoor: false });
        const bot = ladderBot({ world, pos: [2.5, 41, -0.5], player: [2.5, 61, 0.5] });
        const stop = runPhysics(bot);
        const run = skills.followPlayer(bot, PLAYER, 4);
        try {
            await until(() => bot.entity.position.y >= 59 && bot.goals.includes(null) && bot.goals.at(-1) === 'GoalFollow', 25000);
        } finally {
            bot.interrupt_code = true;
            await run;
            stop();
        }
        assert.ok(bot.entity.position.y >= 59, `the bot climbed: y ${bot.entity.position.y}`);
        assert.match(bot.output, /I climb up the ladder at \(2, -?\d+, -2\) after MartyByrde2\.\n/);
    });

    test('at most 3 passes per minute; a failed pass writes its text once', { timeout: 60000 }, async () => {
        // the trapdoor does not open: each pass fails; 65 s of the mocked clock
        mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 });
        const bot = ladderBot({ opens: false });
        const stops = []; // the times (mocked clock) at which the follow was stopped for a pass
        const setGoal = bot.pathfinder.setGoal;
        bot.pathfinder.setGoal = (goal, dynamic) => {
            if (goal === null) stops.push(Date.now());
            return setGoal(goal, dynamic);
        };
        let run;
        try {
            run = skills.followPlayer(bot, PLAYER, 4);
            for (let i = 0; i < 1300; i++) {
                mock.timers.tick(50);
                tick(bot);
                for (let k = 0; k < 3; k++) await new Promise((r) => setImmediate(r));
            }
        } finally {
            bot.interrupt_code = true;
            for (let i = 0; i < 400 && run; i++) {
                mock.timers.tick(100);
                await new Promise((r) => setImmediate(r));
            }
            mock.timers.reset();
        }
        await run;
        assert.ok(stops.length >= 1, 'a pass was tried');
        for (const t0 of stops) {
            const inMinute = stops.filter((t) => t >= t0 && t < t0 + 60000).length;
            assert.ok(inMinute <= 3, `${inMinute} passes within a minute from ${t0}: ${JSON.stringify(stops)}`);
        }
        const failed = bot.output.split('\n').filter((l) => /^I could not go down the ladder at \(2, -?\d+, -2\): .+\.$/.test(l));
        assert.equal(failed.length, 1, bot.output);
    });

    test('goToPlayer with the player below: the pass first, then the path search', { timeout: 60000 }, async () => {
        const bot = ladderBot();
        const gotos = [];
        bot.pathfinder.goto = async (goal) => { gotos.push(goal?.constructor?.name); };
        const stop = runPhysics(bot);
        try {
            await skills.goToPlayer(bot, PLAYER, 3);
        } finally {
            stop();
        }
        assert.equal(bot.clicks.length, 1);
        assert.ok(bot.entity.position.y < 42.5, `y ${bot.entity.position.y}`);
        assert.ok(gotos.length >= 1, 'the path search after the pass');
        assert.match(bot.output, /I go down the ladder at \(2, -?\d+, -2\) after MartyByrde2\./);
        assert.ok(bot.progress.includes('ladder'));
    });
});

// ------------------------------------------------------------------------------ the switch off, the signatures

describe('13, L: routes_pack off, and the signatures', () => {
    test('off: the pass runs all the same, the mining ladder module is loaded on the first pass (child process)', { timeout: 60000 }, (t) => {
        // Decision of the owner and the tech lead on 2026-10-01: the ladder step is a correction of the path search
        // and has no switch. The child runs followPlayer with routes_pack off and the player 20 blocks below.
        const [major, minor] = process.versions.node.split('.').map(Number);
        if (major < 22 || (major === 22 && minor < 15)) return t.skip('module.registerHooks needs Node 22.15');
        const r = spawnSync(process.execPath, [repoPath('tests/helpers/rt_ladder_off_child.js')], { encoding: 'utf8', timeout: 50000, cwd: repoPath('') });
        const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
        assert.ok(line, `${r.stdout}\n${r.stderr}`);
        const out = JSON.parse(line);
        assert.ok(out.ladderModules.some((u) => /packs\/mining\/ladder\.js/.test(u)), `the ladder module of the mining pack: ${out.ladderModules.join(', ')}`);
        assert.equal(out.clicks.length, 1, JSON.stringify(out.clicks));
        assert.ok(out.goals.includes(null), out.goals.join(','));
        assert.ok(/I go down the ladder/.test(out.output), out.output);
        assert.equal(out.result, true);
    });

    test('followPlayer(bot, username, distance = 4) and goToPlayer(bot, username, distance = 3)', () => {
        assert.match(skills.followPlayer.toString(), /^async function followPlayer\(bot, username, distance\s*=\s*4\)/);
        assert.match(skills.goToPlayer.toString(), /^async function goToPlayer\(bot, username, distance\s*=\s*3\)/);
    });

    test('the return values: followPlayer true when stopped, false without the player; goToPlayer true for itself, false without the player', async () => {
        agentSettings.setSettings({ routes_pack: true });
        try {
            const bot = ladderBot({ pos: [20.5, 61, 20.5], player: [22.5, 61, 20.5] });
            bot.interrupt_code = true;
            assert.equal(await skills.followPlayer(bot, PLAYER, 4), true);
            bot.interrupt_code = false;
            bot.players[PLAYER].entity = null;
            assert.equal(await skills.followPlayer(bot, PLAYER, 4), false);
            assert.equal(await skills.goToPlayer(bot, PLAYER, 3), false);
            assert.equal(await skills.goToPlayer(bot, bot.username, 3), true);
        } finally {
            agentSettings.setSettings({});
        }
    });

    test('the console line of a stopped action: `Agent executed: !followPlayer and was stopped.`', async () => {
        const fs = await import('node:fs');
        const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        assert.ok(source.includes('and was stopped.'), 'the new line');
    });
});
