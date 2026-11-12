// v0.1.4.14, the play of 2026-11-09 (DECISIONS P-28, SPEC 8.4.5): no command to board or leave a boat, none to leave the
// game. !boardBoat() boards the nearest boat within 6 blocks (`I boarded the boat.`, `I see no boat within 6 blocks.`);
// !leaveBoat() (`I left the boat.`, `I am not in a boat.`); !leaveGame(reason) says `I leave the game: <reason>.`, writes the
// exit note `left on request` and exits with code 0 (the mind server restarts no exit code 0; start-claude.ps1 runs node
// once; the supervise skill restarts nothing). The skills on the fake bot of tests/helpers/xt_bot.js; the commands of
// actions.js with a fake agent.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { MC, makeFakeBot, move } from '../helpers/xt_bot.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

let M;
let workDir;
let originalCwd;
let cap;
before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir); // nothing may read a keys.json
    cap = captureConsole();
    try {
        M = {
            settingsModule: await loadSrc('src/agent/settings.js'),
            mcdata: await loadSrc('src/utils/mcdata.js'),
            index: await loadSrc('src/agent/commands/index.js'),
            actions: await loadSrc('src/agent/commands/actions.js'),
            skills: await loadSrc('src/agent/library/skills.js'),
            texts: await loadSrc('src/agent/library/skill_texts.js'),
            W: await loadSrc('src/agent/library/way_logic.js'),
            restart: await loadSrc('src/agent/restart_context.js'),
        };
    } finally {
        process.chdir(originalCwd);
    }
    M.mcdata.__setMcdataForTests(MC);
    M.settingsModule.setSettings({ language: 'en', blocked_actions: [] });
});
after(() => {
    M.mcdata.__setMcdataForTests?.(null);
    cap.restore();
    removeTmpDir(workDir);
});

// A boat at `boatAt`; the server seats the bot 50 ms after the mount (`seats`) and lets it out 50 ms after the dismount
// (`lets`); `riding`: the bot sits in it already.
function boatBot({ boatAt = [4, 63, 0], seats = true, lets = true, riding = false } = {}) {
    const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
    const boat = { name: 'oak_boat', type: 'object', position: { x: boatAt[0], y: boatAt[1], z: boatAt[2] } };
    const bot = makeFakeBot({ world, pos: { x: 0, y: 64, z: 0 }, entities: [boat],
        paths: (m, goal) => ({ status: 'success', path: [move(goal.x, goal.y, goal.z)] }) });
    const entity = Object.values(bot.entities)[0];
    bot.vehicle = riding ? entity : null;
    bot.calls.mounted = [];
    bot.calls.dismounted = 0;
    bot.mount = (e) => {
        bot.calls.mounted.push(e.id);
        if (seats) setTimeout(() => { bot.vehicle = e; }, 50);
    };
    bot.dismount = () => {
        bot.calls.dismounted++;
        if (lets) setTimeout(() => { bot.vehicle = null; }, 50);
    };
    return bot;
}

function fakeAgent(bot) {
    const agent = {
        bot,
        said: [],
        kills: [],
        blocked_actions: [],
        async openChat(text) { agent.said.push(text); },
        cleanKill(msg, code) { agent.kills.push([msg, code]); },
        actions: { async runAction(label, fn) { await fn(); return { interrupted: false, timedout: false, message: bot.output }; } },
    };
    return agent;
}
const command = (name) => M.actions.actionsList.find((c) => c.name === name);

describe('P-28: boardBoat and leaveBoat (skills.js)', () => {
    test('a boat 3.7 blocks away: the walk to its side, the mount, "I boarded the boat.", true', async () => {
        const bot = boatBot();
        assert.equal(await M.skills.boardBoat(bot), true);
        assert.equal(bot.output, 'I boarded the boat.\n');
        assert.deepEqual(bot.calls.mounted, [100]);
        assert.ok(bot.calls.goals.some((g) => g?.constructor?.name === 'GoalNear' && g.x === 4 && g.z === 0), 'walked to the boat');
        assert.equal(bot.pathfinder.movements.canDig, false, 'without digging');
    });

    test('no boat within 6 blocks: "I see no boat within 6 blocks.", false, no mount', async () => {
        const bot = boatBot({ boatAt: [7, 63, 0] });
        assert.equal(await M.skills.boardBoat(bot), false);
        assert.equal(bot.output, 'I see no boat within 6 blocks.\n');
        assert.deepEqual(bot.calls.mounted, []);
    });

    test('the server does not seat the bot: a plain failure after 2 s', { timeout: 10000 }, async () => {
        const bot = boatBot({ seats: false });
        assert.equal(await M.skills.boardBoat(bot), false);
        assert.equal(bot.output, 'I could not board the boat at (4, 63, 0).\n');
    });

    test('leaveBoat on foot: "I am not in a boat.", false; riding: "I left the boat.", true', async () => {
        const bot = boatBot();
        assert.equal(await M.skills.leaveBoat(bot), false);
        assert.equal(bot.output, 'I am not in a boat.\n');
        assert.equal(bot.calls.dismounted, 0);
        const riding = boatBot({ riding: true });
        assert.equal(await M.skills.leaveBoat(riding), true);
        assert.equal(riding.output, 'I left the boat.\n');
        assert.equal(riding.calls.dismounted, 1);
        assert.equal(riding.vehicle, null);
    });

    test('isBoatName covers every boat and raft entity of the registry and no minecart', () => {
        const boats = MC.entitiesArray.filter((e) => /_boat$|_raft$/.test(e.name)).map((e) => e.name);
        assert.ok(boats.length >= 20, `${boats.length} boats`);
        for (const name of boats) assert.equal(M.W.isBoatName(name), true, name);
        assert.equal(M.W.isBoatName('minecart'), false);
        assert.equal(M.W.isBoatName('chest_minecart'), false);
        assert.equal(M.W.BOAT_RANGE, 6);
        const near = M.W.nearestBoat([{ name: 'oak_boat', position: { x: 5, y: 63, z: 0 } }, { name: 'bamboo_raft', position: { x: 2, y: 63, z: 0 } }], { x: 0, y: 64, z: 0 });
        assert.equal(near.name, 'bamboo_raft');
        assert.equal(M.W.nearestBoat([{ name: 'oak_boat', position: { x: 7, y: 63, z: 0 } }], { x: 0, y: 64, z: 0 }), null);
    });
});

describe('P-28: the commands of actions.js', () => {
    test('the three commands exist in the list, with their docs', () => {
        // v0.1.4.15: the commands of the survey and the routines come after them in the list, so they are no longer the last three
        const names = ['!boardBoat', '!leaveBoat', '!leaveGame'];
        for (const name of names) assert.ok(M.actions.actionsList.some((c) => c.name === name), name);
        // the docs as short as they can be: the prompt budget of v0.1.4.12 holds them barely
        const docs = M.index.getCommandDocs({ blocked_actions: [] });
        assert.match(docs, /^!boardBoat: Board the nearest boat\.$/m);
        assert.match(docs, /^!leaveBoat: Get out of the boat\.$/m);
        assert.match(docs, /^!leaveGame: Leave the game for good when the player asks\.$/m);
        assert.match(docs, /^reason: \(string\) Why\.$/m);
        const added = docs.length - M.index.getCommandDocs({ blocked_actions: names }).length;
        assert.ok(added <= 180, `${added} characters of docs for the three commands (173 when written)`);
    });

    test('!boardBoat and !leaveBoat run the skills', async () => {
        const agent = fakeAgent(boatBot({ boatAt: [20, 63, 0] }));
        assert.equal(await command('!boardBoat').perform(agent), 'I see no boat within 6 blocks.\n');
        const riding = fakeAgent(boatBot({ riding: true }));
        assert.equal(await command('!leaveBoat').perform(riding), 'I left the boat.\n');
    });

    test('!leaveGame("the owner asked."): the goodbye in the chat, the note "left on request", exit code 0', { timeout: 10000 }, async () => {
        const agent = fakeAgent(boatBot());
        const text = await command('!leaveGame').perform(agent, 'the owner asked.');
        assert.equal(text, 'I leave the game: the owner asked.');
        assert.deepEqual(agent.said, ['I leave the game: the owner asked.'], 'said once, one period');
        assert.deepEqual(agent.kills, [['left on request', 0]]);
    });

    test('!leaveGame without a reason: "I leave the game: you asked me to."', { timeout: 10000 }, async () => {
        const agent = fakeAgent(boatBot());
        assert.equal(await command('!leaveGame').perform(agent, ''), 'I leave the game: you asked me to.');
        assert.deepEqual(agent.kills, [['left on request', 0]]);
    });

    test('the note of the next process: "The process ended because: left on request."', () => {
        const dir = makeTmpDir();
        try {
            assert.equal(M.texts.LEAVE_GAME_NOTE, 'left on request');
            assert.equal(M.restart.writeExit(dir, { reason: M.texts.LEAVE_GAME_NOTE, time: Date.now() }), true);
            assert.equal(M.restart.restartNote(M.restart.readExit(dir)), 'The process ended because: left on request. Tell the player what happened.');
        } finally {
            removeTmpDir(dir);
        }
    });

    test('the texts, word for word', () => {
        assert.deepEqual({ ...M.texts.BOAT_TEXTS, notBoarded: undefined }, { boarded: 'I boarded the boat.', none: 'I see no boat within 6 blocks.',
            left: 'I left the boat.', notIn: 'I am not in a boat.', notLeft: 'I could not leave the boat.', notBoarded: undefined });
        assert.equal(M.texts.leaveGameText('you asked me to'), 'I leave the game: you asked me to.');
    });
});
