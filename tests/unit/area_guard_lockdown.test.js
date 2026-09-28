// Spec v0.1.4.6 A4 under the SES lockdown: the bot runs locked down (src/agent/library/lockdown.js),
// and the guard wraps functions of the bot after that. SES lockdown is global and permanent, so the
// scenario runs in its own child process, like tests/unit/sandbox.test.js. The child prints facts as
// one line "RESULT <json>"; this file asserts.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { repoUrl } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { runNodeModuleSource, describeRun, RESULT_PREFIX } from '../helpers/child.js';

const url = (rel) => JSON.stringify(repoUrl(rel));

// Modules are loaded before the lockdown, as in the agent (static imports); the bot, the store,
// the registry and the Movements object are created after it, as in the running bot.
const SOURCE = `
import path from 'node:path';
import { createRequire } from 'node:module';
import { lockdown, isLockedDown } from ${url('src/agent/library/lockdown.js')};
import { installAreaGuard, ProtectedAreaError } from ${url('src/agent/areas/area_guard.js')};
import { AreaStore } from ${url('src/agent/areas/area_store.js')};
const require = createRequire(${url('package.json')});
const prismarineRegistry = require('prismarine-registry');
const prismarineBlock = require('prismarine-block');
const { Vec3 } = require('vec3');
const Movements = require('mineflayer-pathfinder/lib/movements');

const facts = {};
const outcome = (promise) => promise.then((value) => ({ value }), (err) => ({ error: err.name, message: err.message }));
try {
    lockdown();
    facts.lockedDown = isLockedDown();
    facts.frozen = Object.isFrozen(Object.prototype) && Object.isFrozen(Function.prototype) && Object.isFrozen(Error.prototype);

    const store = new AreaStore(path.join(process.cwd(), 'areas.json'));
    store.load();
    store.set({ name: 'home', type: 'building', min: { x: 0, y: 63, z: 0 }, max: { x: 6, y: 67, z: 6 } });

    const calls = [];
    const initial = { exclusionAreasBreak: [], exclusionAreasPlace: [] };
    const bot = {
        game: { dimension: 'overworld' },
        heldItem: { name: 'oak_planks' },
        controlState: { sneak: false },
        dig(...args) { calls.push(['dig', args.length, this === bot]); return Promise.resolve('dug'); },
        placeBlock(...args) { calls.push(['placeBlock', args.length, this === bot]); return Promise.resolve('placed'); },
        activateBlock(...args) { calls.push(['activateBlock', args.length, this === bot]); return Promise.resolve('activated'); },
        pathfinder: {
            setMovements(movements) { calls.push(['setMovements', 1, this === bot.pathfinder]); return 'set'; },
            getPathTo(...args) { calls.push(['getPathTo', args.length, this === bot.pathfinder]); return { status: 'success' }; },
            movements: initial,
        },
    };
    const guard = installAreaGuard(bot, { store, log: () => {} });
    // F2: bot.areaGuard is a frozen view of the guard without permit, revoke and permits
    facts.sameGuard = bot.areaGuard.canBreak === guard.canBreak && bot.areaGuard.permit === undefined
        && Object.isFrozen(bot.areaGuard) && installAreaGuard(bot, { store }) === guard;

    const wall = { name: 'oak_planks', position: { x: 2, y: 64, z: 2 } };
    const stone = { name: 'stone', position: { x: 50, y: 60, z: 50 } };
    try {
        await bot.dig(wall);
        facts.refused = 'not refused';
    } catch (err) {
        facts.refused = { name: err.name, message: err.message, isError: err instanceof Error,
            isProtected: err instanceof ProtectedAreaError, text: String(err) };
    }
    facts.allowed = await outcome(bot.dig(stone, true, 'raycast'));
    facts.placeRefused = await outcome(bot.placeBlock({ name: 'grass_block', position: { x: 7, y: 63, z: 3 } }, { x: -1, y: 1, z: 0 }));
    facts.placeAllowed = await outcome(bot.placeBlock({ name: 'grass_block', position: { x: 20, y: 63, z: 3 } }, { x: 0, y: 1, z: 0 }));
    facts.door = await outcome(bot.activateBlock({ name: 'oak_door', position: { x: 3, y: 64, z: 6 } }, 1, 2));

    const registry = prismarineRegistry('1.21.8');
    const Block = prismarineBlock(registry);
    const airState = registry.blocksByName.air.defaultState;
    const movementsBot = {
        registry,
        game: { minY: -64 },
        entity: { position: new Vec3(0, 64, 0), effects: {} },
        entities: {},
        inventory: { items: () => [] },
        pathfinder: { bestHarvestTool: () => null },
        blockAt(pos) {
            const b = Block.fromStateId(airState, 0);
            b.position = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
            return b;
        },
    };
    const movements = new Movements(movementsBot);
    const plank = (x, y, z) => {
        const b = Block.fromStateId(registry.blocksByName.oak_planks.defaultState, 0);
        b.position = new Vec3(x, y, z);
        return b;
    };
    facts.safeToBreakBefore = movements.safeToBreak(plank(2, 64, 2));
    facts.setMovements = bot.pathfinder.setMovements(movements);
    facts.getPathTo = bot.pathfinder.getPathTo(movements, null, 10);
    facts.breakFunctions = movements.exclusionAreasBreak.length;
    facts.safeToBreakInside = movements.safeToBreak(plank(2, 64, 2));
    facts.safeToBreakOutside = movements.safeToBreak(plank(30, 64, 30));
    facts.initialProtected = initial.exclusionAreasBreak.length;
    facts.permitType = typeof guard.permit('home', 5);
    facts.afterPermit = await outcome(bot.dig(wall));
    facts.calls = calls;
} catch (err) {
    facts.fixtureError = String((err && err.stack) || err);
}
process.stdout.write('\\n${RESULT_PREFIX}' + JSON.stringify(facts) + '\\n');
`;

let cwd;
let run;
let facts;
before(() => {
    cwd = makeTmpDir();
    run = runNodeModuleSource(SOURCE, { cwd });
    const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith(RESULT_PREFIX));
    facts = line ? JSON.parse(line.slice(RESULT_PREFIX.length)) : null;
});
after(() => removeTmpDir(cwd));

function checked() {
    assert.equal(run.status, 0, describeRun(run));
    assert.ok(facts, `no RESULT line\n${describeRun(run)}`);
    assert.equal(facts.fixtureError, undefined, `${facts.fixtureError}\n${describeRun(run)}`);
    return facts;
}

describe('the guard after the SES lockdown (child process)', () => {
    test('precondition: the lockdown ran and froze the intrinsics', () => {
        const f = checked();
        assert.equal(f.lockedDown, true);
        assert.equal(f.frozen, true);
    });

    test('installAreaGuard works; a second call returns the same guard', () => {
        assert.equal(checked().sameGuard, true);
    });

    test('dig in the building is refused with a ProtectedAreaError', () => {
        const { refused } = checked();
        assert.deepEqual(refused, {
            name: 'ProtectedAreaError',
            message: 'The block at (2, 64, 2) belongs to the protected area "home". I do not break or place blocks there.',
            isError: true,
            isProtected: true,
            text: 'ProtectedAreaError: The block at (2, 64, 2) belongs to the protected area "home". I do not break or place blocks there.',
        });
    });

    test('outside: the original runs with the same arguments, this and result', () => {
        const f = checked();
        assert.deepEqual(f.allowed, { value: 'dug' });
        assert.deepEqual(f.placeAllowed, { value: 'placed' });
        assert.deepEqual(f.door, { value: 'activated' });
        assert.deepEqual(f.calls, [
            ['dig', 3, true],
            ['placeBlock', 2, true],
            ['activateBlock', 3, true],
            ['setMovements', 1, true],
            ['getPathTo', 3, true],
            ['dig', 1, true],
        ]);
    });

    test('placeBlock into the building is refused', () => {
        assert.equal(checked().placeRefused.error, 'ProtectedAreaError');
    });

    test('a real Movements created after the lockdown: safeToBreak refuses a block in the building', () => {
        const f = checked();
        assert.equal(f.safeToBreakBefore, true);
        assert.equal(f.setMovements, 'set');
        assert.deepEqual(f.getPathTo, { status: 'success' });
        assert.equal(f.breakFunctions, 1);
        assert.equal(f.safeToBreakInside, false);
        assert.equal(f.safeToBreakOutside, true);
        assert.equal(f.initialProtected, 1);
    });

    test('a permit opens the area', () => {
        const f = checked();
        assert.equal(f.permitType, 'number');
        assert.deepEqual(f.afterPermit, { value: 'dug' });
    });
});
