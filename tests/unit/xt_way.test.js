// WAITS FOR PART Q (SPEC 4.6, engineer E4, round 2): written from the spec before the part landed; the tests of Q5,
// Q7 and Q8 are expected to fail until it does. Tests from the spec (v0.1.4.13, section 6, T1):
// Q5 the kit rule of `!givePlayer` (giveToPlayer): `num` more than 8 of one kind gives
//    `That is a lot. Say "put my stuff in the chest" and I put it in the nearest chest.` and nothing is thrown.
// Q7 no shaft (`!goToCoordinates`, goToPosition): a target more than 3 blocks below the bot with a path that is
//    destructive straight down (every step within 1 block of the vertical line) is refused:
//    `I do not dig a shaft 64 blocks down. Say "dig down" if you mean it, or show me stairs.`; a target reached by
//    stairs, a ladder or a slope is walked. Three paths of the spec (straight down, stairs, a slope) and a ladder.
// Q8 the pen: isKeepOutArea holds for a saved area of kind pen or farm; the gate of an enclosure with animals is
//    never opened by `!useOn` when the bot is within 8 blocks of it, and the bot says
//    `That is a pen with 26 chickens; I do not open its gate. Say "open the pen" if you mean it.`
// The bot is a fake mineflayer bot (tests/helpers/xt_bot.js); the pathfinder answers staged paths. The test checks
// what the bot did (walked, dug, tossed, opened), not only the text. A failing test is a finding.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld } from '../helpers/block_world.js';
import { MC, makeFakeBot, makeItem, move } from '../helpers/xt_bot.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

const OWNER = 'MartyByrde2';
const KIT_TEXT = 'That is a lot. Say "put my stuff in the chest" and I put it in the nearest chest.';
const shaftText = (n) => `I do not dig a shaft ${n} blocks down. Say "dig down" if you mean it, or show me stairs.`;
const PEN_TEXT = 'That is a pen with 26 chickens; I do not open its gate. Say "open the pen" if you mean it.';

let skills;
let mcdata;
let keepOut;
let penGate;
let workDir;
let originalCwd;
let cap;
before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    process.chdir(workDir); // nothing may read a keys.json
    cap = captureConsole();
    try {
        mcdata = await loadSrc('src/utils/mcdata.js');
        skills = await loadSrc('src/agent/library/skills.js');
        keepOut = await loadSrc('src/agent/areas/keep_out_logic.js');
        penGate = await loadSrc('src/agent/areas/pen_gate.js');
    } finally {
        process.chdir(originalCwd);
    }
    mcdata.__setMcdataForTests(MC);
});
after(() => {
    mcdata.__setMcdataForTests?.(null);
    cap.restore();
    removeTmpDir(workDir);
});

/** The answer of a skill within `ms`, or an error; the timer is cleared either way. */
async function within(ms, promise) {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); });
    try {
        return await Promise.race([promise, limit]);
    } finally {
        clearTimeout(timer);
    }
}

describe('SPEC 4.6 Q5: the kit rule of !givePlayer', () => {
    function giveBot() {
        const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
        const player = { type: 'player', name: 'player', username: OWNER, position: { x: 6, y: 64, z: 0 }, height: 1.8 };
        const bot = makeFakeBot({ world, pos: { x: 0, y: 64, z: 0 }, items: [makeItem('iron_ingot', 20), makeItem('bread', 12, 37)], entities: [player],
            paths: () => ({ status: 'success', path: [move(1, 64, 0), move(2, 64, 0), move(3, 64, 0)] }) });
        const entity = Object.values(bot.entities)[0];
        bot.players[OWNER] = { username: OWNER, entity };
        return bot;
    }

    test('9 of one kind: the text, and nothing is thrown', async () => {
        const bot = giveBot();
        await within(8000, skills.giveToPlayer(bot, 'iron_ingot', OWNER, 9)).catch((e) => { bot.output += `\n[${e.message}]`; });
        assert.ok(bot.output.includes(KIT_TEXT), `the kit text: ${bot.output}`);
        assert.deepEqual(bot.calls.tossed, [], 'nothing is thrown');
    });

    test('8 of one kind is no kit: no such text', async () => {
        const bot = giveBot();
        await within(8000, skills.giveToPlayer(bot, 'bread', OWNER, 8)).catch(() => {});
        assert.ok(!bot.output.includes(KIT_TEXT), bot.output);
    });
});

describe('SPEC 4.6 Q7: no shaft, on three paths', () => {
    const FROM = { x: 0, y: 64, z: 0 };

    /** A world of rock below the bot's ground; the ladder shaft and the stairs are what the staged paths say. */
    function rockWorld() {
        return createBlockWorld().flatGround(63, 'stone', 'stone');
    }

    /**
     * A staged pathfinder: the path found, whatever the movements (the "non-destructive" search of the library only
     * makes digging dear, so a shaft through rock comes back from it too, with the blocks it breaks).
     */
    function paths({ digging = null, walking = null }) {
        const path = digging ?? walking;
        return () => (path ? { status: 'success', path } : { status: 'noPath', path: [] });
    }

    const straightDown = (depth) => Array.from({ length: depth }, (_, i) => move(0, 63 - i, 0, [{ x: 0, y: 63 - i, z: 0 }]));
    const ladderDown = (depth) => Array.from({ length: depth }, (_, i) => move(0, 63 - i, 0));
    const stairsDown = (depth) => Array.from({ length: depth }, (_, i) => move(i + 1, 63 - i, 0));
    // a slope: two steps forward for each step down, digging the rock in the way
    const slopeDown = (depth) => Array.from({ length: depth * 2 }, (_, i) => move(i + 1, 64 - Math.ceil((i + 1) / 2), 0, [{ x: i + 1, y: 64 - Math.ceil((i + 1) / 2) + 1, z: 0 }]));

    async function walk(bot, x, y, z) {
        let result;
        try {
            result = await within(8000, skills.goToPosition(bot, x, y, z, 1));
        } catch (e) {
            result = `[${e.message}]`;
        }
        return result;
    }

    test('straight down 20 blocks, destructive: refused in words, the bot stays, nothing dug', async () => {
        const bot = makeFakeBot({ world: rockWorld(), pos: FROM, paths: paths({ digging: straightDown(20) }) });
        const result = await walk(bot, 0, 44, 0);
        assert.ok(bot.output.includes(shaftText(20)), `the refusal: ${bot.output} ${result}`);
        assert.deepEqual(bot.calls.walked, [], 'the bot did not walk');
        assert.deepEqual(bot.calls.dug, [], 'no block below the bot was broken');
        assert.equal(bot.entity.position.y, 64);
    });

    test('straight down 3 blocks is not more than 3: walked', async () => {
        const bot = makeFakeBot({ world: rockWorld(), pos: FROM, paths: paths({ digging: straightDown(3) }) });
        await walk(bot, 0, 61, 0);
        assert.ok(!bot.output.includes('I do not dig a shaft'), bot.output);
        assert.equal(bot.calls.walked.length, 1, `the bot walked: ${bot.output}`);
    });

    test('stairs 20 blocks down: walked, no refusal', async () => {
        const bot = makeFakeBot({ world: rockWorld(), pos: FROM, paths: paths({ walking: stairsDown(20) }) });
        await walk(bot, 20, 44, 0);
        assert.ok(!bot.output.includes('I do not dig a shaft'), bot.output);
        assert.equal(bot.calls.walked.length, 1, `the bot walked: ${bot.output}`);
        assert.equal(bot.entity.position.y, 44);
    });

    test('a slope 20 blocks down, dug on the way: walked, no refusal', async () => {
        const bot = makeFakeBot({ world: rockWorld(), pos: FROM, paths: paths({ digging: slopeDown(20) }) });
        await walk(bot, 40, 44, 0);
        assert.ok(!bot.output.includes('I do not dig a shaft'), bot.output);
        assert.equal(bot.calls.walked.length, 1, `the bot walked: ${bot.output}`);
    });

    test('a ladder 20 blocks down (straight, not destructive): walked, no refusal', async () => {
        const bot = makeFakeBot({ world: rockWorld(), pos: FROM, paths: paths({ walking: ladderDown(20) }) });
        await walk(bot, 0, 44, 0);
        assert.ok(!bot.output.includes('I do not dig a shaft'), bot.output);
        assert.equal(bot.calls.walked.length, 1, `the bot walked: ${bot.output}`);
    });
});

describe('SPEC 4.6 Q8: the pen', () => {
    test('isKeepOutArea holds for a saved area of kind pen or farm', () => {
        const box = { min: { x: 0, y: 63, z: 0 }, max: { x: 6, y: 66, z: 6 }, dimension: 'overworld' };
        assert.equal(keepOut.isKeepOutArea({ name: 'pen', type: 'pen', ...box }), true);
        assert.equal(keepOut.isKeepOutArea({ name: 'wheat', type: 'farm', ...box }), true);
        assert.equal(keepOut.isKeepOutArea({ name: 'store', type: 'storage', ...box }), false);
    });

    /** An unsaved pen: oak fence around 7 by 7 on grass at y 63, the gate in the north side at (3, 64, -3). */
    function penWorld() {
        const world = createBlockWorld().flatGround(63, 'grass_block', 'dirt');
        for (let i = -3; i <= 3; i++) {
            world.set(i, 64, -3, 'oak_fence');
            world.set(i, 64, 3, 'oak_fence');
            world.set(-3, 64, i, 'oak_fence');
            world.set(3, 64, i, 'oak_fence');
        }
        world.set(0, 64, -3, 'oak_fence_gate', { open: false, facing: 'north', in_wall: false, powered: false });
        return world;
    }

    /**
     * The bot as the agent sets it up: the guard of the pens installed on it (installPenGuard of Q8, with no saved
     * area and no permit, the chat of the bot as `say`) when the part provides it.
     */
    function guarded(bot) {
        try {
            penGate.installPenGuard(bot, { areas: () => [], permits: () => [], say: (text) => bot.calls.chat.push(text) });
        } catch {
            // the part is not built yet: the bot has no guard
        }
        return bot;
    }

    /** What the bot said: its output and its chat. */
    const saidBy = (bot) => `${bot.output}\n${bot.calls.chat.join('\n')}`;

    function chickens(n) {
        return Array.from({ length: n }, (_, i) => ({ type: 'animal', name: 'chicken', displayName: 'Chicken', position: { x: -2 + (i % 5), y: 64, z: -2 + Math.floor(i / 5) % 5 }, height: 0.7, health: 4 }));
    }

    test('an unsaved pen with 26 chickens, the bot 2 blocks from its gate: !useOn does not open it, the pen text', async () => {
        const bot = guarded(makeFakeBot({ world: penWorld(), pos: { x: 0, y: 64, z: -5 }, entities: chickens(26), paths: () => ({ status: 'success', path: [move(0, 64, -4)] }) }));
        try {
            await within(8000, skills.useToolOn(bot, 'hand', 'oak_fence_gate'));
        } catch (e) {
            bot.output += `\n[${e.message}]`;
        }
        assert.deepEqual(bot.calls.activated, [], 'the gate was not used');
        assert.ok(saidBy(bot).includes(PEN_TEXT), `the pen text: ${saidBy(bot)}`);
    });

    test('the pen text is said once per minute', async () => {
        const bot = guarded(makeFakeBot({ world: penWorld(), pos: { x: 0, y: 64, z: -5 }, entities: chickens(26), paths: () => ({ status: 'success', path: [move(0, 64, -4)] }) }));
        for (let i = 0; i < 2; i++) {
            try {
                await within(8000, skills.useToolOn(bot, 'hand', 'oak_fence_gate'));
            } catch (e) {
                bot.output += `\n[${e.message}]`;
            }
        }
        assert.equal(saidBy(bot).split(PEN_TEXT).length - 1, 1, `once: ${saidBy(bot)}`);
        assert.deepEqual(bot.calls.activated, []);
    });

    test('the same fence with no animals is no pen: no pen text', async () => {
        const bot = guarded(makeFakeBot({ world: penWorld(), pos: { x: 0, y: 64, z: -5 }, paths: () => ({ status: 'success', path: [move(0, 64, -4)] }) }));
        try {
            await within(8000, skills.useToolOn(bot, 'hand', 'oak_fence_gate'));
        } catch (e) {
            bot.output += `\n[${e.message}]`;
        }
        assert.ok(!saidBy(bot).includes('That is a pen'), saidBy(bot));
    });
});
