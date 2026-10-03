// v0.1.4.12, part G, G4: skills.useToolOn / useToolOnBlock on a door, a fence gate or a trapdoor read the state
// (the property open) before and after the click and say which way it went: `I opened the door at (x, y, z).`,
// `I closed the door at (x, y, z).`, with the kind word door, gate or trapdoor; `The door at (x, y, z) was open
// already.` when it was open and stayed open; an iron door or trapdoor: `The iron door at (x, y, z) does not open
// by hand.` and no click. The signature stays (bot, tool, target); the result is true when the state changed.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import prismarineBlock from 'prismarine-block';
import { Vec3 } from 'vec3';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { makeBot, registry } from './stb_fake_bot.test.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
mcdata.__setMcdataForTests(registry);
const Block = prismarineBlock(registry);

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

/**
 * The fake bot of the library with blocks that carry their state, a door (or gate, trapdoor) 2 blocks away
 * and a click that toggles `open` of the block (both halves of a door) after `delayMs`, or never (`toggles`
 * false). bot.clicks counts the clicks.
 */
function scene(name, { open = false, toggles = true, delayMs = 20, door = true } = {}) {
    const bot = makeBot({ pos: [0.5, 64, 0.5] });
    const world = bot.world;
    const props = { open };
    if (name.endsWith('_door')) {
        world.set(2, 64, 0, name, { ...props, half: 'lower', facing: 'east', hinge: 'left' });
        world.set(2, 65, 0, name, { ...props, half: 'upper', facing: 'east', hinge: 'left' });
    } else if (door) {
        world.set(2, 64, 0, name, { ...props, facing: 'east' });
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
    bot.clicks = 0;
    bot.activateBlock = async (block) => {
        bot.clicks++;
        if (!toggles) return;
        setTimeout(() => {
            for (const y of [64, 65]) {
                const b = world.blockAt({ x: 2, y, z: 0 });
                if (b.name === block.name) world.set(2, y, 0, b.name, { ...b.getProperties(), open: !b.getProperties().open });
            }
        }, delayMs);
    };
    return bot;
}

describe('G4: useToolOn on a door, a gate, a trapdoor', () => {
    test('a closed oak door: "I opened the door at (2, 64, 0)." and true', async () => {
        const bot = scene('oak_door');
        assert.equal(await skills.useToolOn(bot, 'hand', 'oak_door'), true);
        assert.equal(bot.clicks, 1);
        assert.match(bot.output, /I opened the door at \(2, 64, 0\)\./);
        assert.doesNotMatch(bot.output, /Used hand on/);
        assert.equal(bot.world.blockAt({ x: 2, y: 64, z: 0 }).getProperties().open, true, 'the world: open');
    });

    test('an open oak door: the click closes it, "I closed the door at (2, 64, 0)."', async () => {
        const bot = scene('oak_door', { open: true });
        assert.equal(await skills.useToolOn(bot, 'hand', 'oak_door'), true);
        assert.match(bot.output, /I closed the door at \(2, 64, 0\)\./);
    });

    test('the upper half as the target names the lower half', async () => {
        const bot = scene('oak_door');
        const upper = bot.blockAt({ x: 2, y: 65, z: 0 });
        assert.equal(await skills.useToolOnBlock(bot, 'hand', upper), true);
        assert.match(bot.output, /I opened the door at \(2, 64, 0\)\./);
    });

    test('a fence gate: the word gate', async () => {
        const bot = scene('oak_fence_gate');
        assert.equal(await skills.useToolOn(bot, 'hand', 'oak_fence_gate'), true);
        assert.match(bot.output, /I opened the gate at \(2, 64, 0\)\./);
    });

    test('a trapdoor: the word trapdoor', async () => {
        const bot = scene('spruce_trapdoor', { open: true });
        assert.equal(await skills.useToolOn(bot, 'hand', 'spruce_trapdoor'), true);
        assert.match(bot.output, /I closed the trapdoor at \(2, 64, 0\)\./);
    });

    test('an open door that the click does not move: "The door at (2, 64, 0) was open already." and false', async () => {
        const bot = scene('oak_door', { open: true, toggles: false });
        assert.equal(await skills.useToolOn(bot, 'hand', 'oak_door'), false);
        assert.match(bot.output, /The door at \(2, 64, 0\) was open already\./);
        assert.doesNotMatch(bot.output, /I (opened|closed)/);
    });

    test('a closed door that the click does not move: the text says it did not open, false', async () => {
        const bot = scene('oak_door', { toggles: false });
        assert.equal(await skills.useToolOn(bot, 'hand', 'oak_door'), false);
        assert.match(bot.output, /The door at \(2, 64, 0\) did not open\./);
        assert.doesNotMatch(bot.output, /I opened/);
    });

    test('an iron door: "The iron door at (2, 64, 0) does not open by hand.", no click, false', async () => {
        const bot = scene('iron_door');
        assert.equal(await skills.useToolOn(bot, 'hand', 'iron_door'), false);
        assert.equal(bot.clicks, 0);
        assert.match(bot.output, /The iron door at \(2, 64, 0\) does not open by hand\./);
    });

    test('an iron trapdoor: "The iron trapdoor at (2, 64, 0) does not open by hand."', async () => {
        const bot = scene('iron_trapdoor');
        assert.equal(await skills.useToolOn(bot, 'hand', 'iron_trapdoor'), false);
        assert.match(bot.output, /The iron trapdoor at \(2, 64, 0\) does not open by hand\./);
    });

    test('another block: the old text "Used hand on crafting_table."', async () => {
        const bot = scene('crafting_table', { door: false });
        bot.world.set(2, 64, 0, 'crafting_table');
        assert.equal(await skills.useToolOn(bot, 'hand', 'crafting_table'), true);
        assert.match(bot.output, /Used hand on crafting_table\./);
    });

    test('the signature stays: (bot, toolName, targetName) and (bot, toolName, block)', () => {
        assert.equal(skills.useToolOn.length, 3);
        assert.equal(skills.useToolOnBlock.length, 3);
    });
});
