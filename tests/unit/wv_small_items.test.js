// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.3 (part G, the small items):
//   G4 useToolOn(bot, tool, target) on a door, a fence gate, a trapdoor reads the state first and says
//      `I opened the door at (x, y, z).`, `I closed the door at (x, y, z).`, `The door at (x, y, z) was open already.`
//      with the kind word door, gate or trapdoor; the signature stays (no "open"/"close" argument);
//   G5 !endConversation answers `Conversation with ${name} ended.`; goToPlayer for a player without an entity after the
//      wait: `I see no player "Steve". The players I see: MartyByrde2.` or `I see no player "Steve". I see no other player.`
// The world: a fake bot of the library with blocks that carry their state; a click toggles `open` of the target (both
// halves of a door) a moment later, or never.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import prismarineBlock from 'prismarine-block';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue } from '../helpers/st_glue_env.js';
import { makeBot, registry } from './stb_fake_bot.test.js';

const G = await loadGlue(); // registers the mcdata hooks once
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
const convo = (await loadSrc('src/agent/conversation.js')).default;
mcdata.__setMcdataForTests(registry);
const Block = prismarineBlock(registry);

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

const AT = { x: 3, y: 64, z: 1 };

function openable(name, { open = false, toggles = true } = {}) {
    const bot = makeBot({ pos: [0.5, 64, 0.5] });
    const world = bot.world;
    if (name.endsWith('_door')) {
        world.set(AT.x, AT.y, AT.z, name, { open, half: 'lower', facing: 'west', hinge: 'right' });
        world.set(AT.x, AT.y + 1, AT.z, name, { open, half: 'upper', facing: 'west', hinge: 'right' });
    } else {
        world.set(AT.x, AT.y, AT.z, name, { open, facing: 'west' });
    }
    bot.blockAt = (p) => {
        const b = world.blockAt(p);
        if (!b) return null;
        const base = Block.fromStateId(registry.blocksByName[b.name].defaultState, 0);
        const own = b.getProperties();
        const block = Object.keys(own).length === 0 ? base : Block.fromProperties(b.name, { ...base.getProperties(), ...own }, 0);
        block.position = new Vec3(b.position.x, b.position.y, b.position.z);
        return block;
    };
    bot.blockAtCursor = () => null;
    bot.activateBlock = async (block) => {
        if (!toggles) return;
        setTimeout(() => {
            for (const y of [AT.y, AT.y + 1]) {
                const b = world.blockAt({ x: AT.x, y, z: AT.z });
                if (b && b.name === block.name) world.set(AT.x, y, AT.z, b.name, { ...b.getProperties(), open: !b.getProperties().open });
            }
        }, 30);
    };
    return bot;
}

describe('G4: useToolOn on what opens', () => {
    test('a closed door: "I opened the door at (3, 64, 1)."', async () => {
        const bot = openable('oak_door');
        await skills.useToolOn(bot, 'hand', 'oak_door');
        assert.match(bot.output, /I opened the door at \(3, 64, 1\)\./);
        assert.equal(bot.world.blockAt(AT).getProperties().open, true);
    });

    test('an open door: "I closed the door at (3, 64, 1)."', async () => {
        const bot = openable('oak_door', { open: true });
        await skills.useToolOn(bot, 'hand', 'oak_door');
        assert.match(bot.output, /I closed the door at \(3, 64, 1\)\./);
    });

    test('an open door that stays open: "The door at (3, 64, 1) was open already."', async () => {
        const bot = openable('oak_door', { open: true, toggles: false });
        await skills.useToolOn(bot, 'hand', 'oak_door');
        assert.match(bot.output, /The door at \(3, 64, 1\) was open already\./);
        assert.doesNotMatch(bot.output, /I (opened|closed) the door/);
    });

    test('a fence gate: the word gate', async () => {
        const bot = openable('birch_fence_gate');
        await skills.useToolOn(bot, 'hand', 'birch_fence_gate');
        assert.match(bot.output, /I opened the gate at \(3, 64, 1\)\./);
        const back = openable('birch_fence_gate', { open: true });
        await skills.useToolOn(back, 'hand', 'birch_fence_gate');
        assert.match(back.output, /I closed the gate at \(3, 64, 1\)\./);
        const stays = openable('birch_fence_gate', { open: true, toggles: false });
        await skills.useToolOn(stays, 'hand', 'birch_fence_gate');
        assert.match(stays.output, /The gate at \(3, 64, 1\) was open already\./);
    });

    test('a trapdoor: the word trapdoor', async () => {
        const bot = openable('oak_trapdoor');
        await skills.useToolOn(bot, 'hand', 'oak_trapdoor');
        assert.match(bot.output, /I opened the trapdoor at \(3, 64, 1\)\./);
        const stays = openable('oak_trapdoor', { open: true, toggles: false });
        await skills.useToolOn(stays, 'hand', 'oak_trapdoor');
        assert.match(stays.output, /The trapdoor at \(3, 64, 1\) was open already\./);
    });

    test('the signature stays (bot, tool, target)', () => {
        assert.equal(skills.useToolOn.length, 3);
    });
});

describe('G5: !endConversation', () => {
    test('"Conversation with w_miner ended."', async () => {
        const c = G.actions.actionsList.find((x) => x.name === '!endConversation');
        const before = { convos: convo.convos, active: convo.activeConversation };
        convo.convos = { w_miner: { active: true, end() { this.active = false; } } };
        convo.activeConversation = { name: 'someone_else' }; // the active one would need the agent of the module
        try {
            assert.equal(await c.perform({}, 'w_miner'), 'Conversation with w_miner ended.');
        } finally {
            convo.convos = before.convos;
            convo.activeConversation = before.active;
        }
    });
});

describe('G5: goToPlayer for a player without an entity', () => {
    const LIMIT = { timeout: 15000 };

    test('`I see no player "Steve". The players I see: MartyByrde2.`', LIMIT, async () => {
        const bot = makeBot();
        bot.players = { [bot.username]: { username: bot.username, entity: bot.entity }, MartyByrde2: { username: 'MartyByrde2', entity: null } };
        assert.equal(await skills.goToPlayer(bot, 'Steve', 3), false);
        assert.match(bot.output, /I see no player "Steve"\. The players I see: MartyByrde2\./);
    });

    test('`I see no player "Steve". I see no other player.`', LIMIT, async () => {
        const bot = makeBot();
        bot.players = { [bot.username]: { username: bot.username, entity: bot.entity } };
        assert.equal(await skills.goToPlayer(bot, 'Steve', 3), false);
        assert.match(bot.output, /I see no player "Steve"\. I see no other player\./);
    });

    test('the signature stays (bot, username, distance)', () => {
        assert.equal(skills.goToPlayer.length, 2, 'distance has a default');
    });
});
