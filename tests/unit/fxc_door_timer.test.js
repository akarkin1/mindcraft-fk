// v0.1.4.8, fix round, X7 (DEFECTS_WORLD_0148.md): with home_pack off, !goToCoordinates into a house swung
// in the doorway for 60 s. Found on the real server with a trace of the path search: the path search
// (mineflayer-pathfinder, patched) opens the closed door itself and then heads for the corner of the door
// block; the bot stands still at the door frame; the old door timer of goToGoal (startDoorInterval, 1.2 s
// without movement) toggled the door that the path search had just opened, the next path planned through a
// closed door again, and so on. The timer now only opens a closed door, gate or trapdoor; it never closes
// an open one. It still opens a closed door as in v0.1.4.7.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import prismarineBlock from 'prismarine-block';
import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { register } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

register('../helpers/mcdata_hooks.js', import.meta.url);
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');

const registry = minecraftData('1.21.8');
const Block = prismarineBlock(registry);
mcdata.__setMcdataForTests(registry);

const WALK_MS = 1900; // longer than the 1.2 s after which the timer acts

// A bot of home_pack off (no mode door_closing) that stands still next to a door at (1, 64, 0) whose
// state the test sets; activateBlock toggles it, as the server does.
function makeBot(kind, open) {
    const state = { open };
    const activated = [];
    const bot = {
        username: 'andy',
        registry,
        output: '',
        interrupt_code: false,
        entity: { position: new Vec3(0.5, 64, 0.5) },
        entities: {},
        players: {},
        game: { dimension: 'overworld', gameMode: 'survival' },
        modes: { exists: () => false, isOn: () => false, pause() {}, unpause() {} },
        on() {},
        once() {},
        blockAt(pos) {
            const p = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
            let block;
            if (p.x === 1 && p.z === 0 && (p.y === 64 || (kind === 'oak_door' && p.y === 65))) {
                const props = kind === 'oak_door'
                    ? { facing: 'south', half: p.y === 64 ? 'lower' : 'upper', hinge: 'left', open: String(state.open), powered: 'false' }
                    : { facing: 'south', in_wall: 'false', open: String(state.open), powered: 'false' };
                block = Block.fromProperties(kind, props, 0);
            } else {
                block = Block.fromStateId(registry.blocksByName[p.y <= 63 ? 'grass_block' : 'air'].defaultState, 0);
            }
            block.position = p;
            return block;
        },
        activateBlock(block) {
            activated.push([block.name, block.getProperties().open]);
            state.open = !state.open;
            return Promise.resolve();
        },
        pathfinder: {
            getPathTo: () => ({ status: 'success' }),
            setMovements() {},
            setGoal() {},
            stop() {},
            goto: () => new Promise((resolve) => setTimeout(resolve, WALK_MS)),
        },
        activated,
        state,
    };
    return bot;
}

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('X7: the old door timer of goToGoal (home_pack off) only opens', () => {
    test('the fake blocks carry the open state', () => {
        assert.equal(makeBot('oak_door', true).blockAt(new Vec3(1, 64, 0)).getProperties().open, true);
        assert.equal(makeBot('oak_door', false).blockAt(new Vec3(1, 65, 0)).getProperties().open, false);
    });

    test('an open door next to a bot that stands still stays open (the path search opened it)', async () => {
        const bot = makeBot('oak_door', true);
        assert.equal(await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1)), true);
        assert.deepEqual(bot.activated, []);
        assert.equal(bot.state.open, true);
    });

    test('a closed door is opened once, as in v0.1.4.7, and then left open', async () => {
        const bot = makeBot('oak_door', false);
        await skills.goToGoal(bot, new pf.goals.GoalNear(5, 64, 0, 1));
        assert.deepEqual(bot.activated, [['oak_door', false]]);
        assert.equal(bot.state.open, true);
    });

    test('the same for a fence gate', async () => {
        const open = makeBot('oak_fence_gate', true);
        await skills.goToGoal(open, new pf.goals.GoalNear(5, 64, 0, 1));
        assert.deepEqual(open.activated, []);
        const closed = makeBot('oak_fence_gate', false);
        await skills.goToGoal(closed, new pf.goals.GoalNear(5, 64, 0, 1));
        assert.deepEqual(closed.activated, [['oak_fence_gate', false]]);
    });
});
