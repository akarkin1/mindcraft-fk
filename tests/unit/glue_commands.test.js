// Spec v0.1.4.6, the commands of parts A (section 6), R (R3, R4) and G: their replies word for word,
// with the real AreaStore, RuleStore, scans and area guard in a temp directory and a small block
// world (tests/helpers/block_world.js) as the world of a fake bot.
//
// Import notes as in commands_places.test.js: commands/index.js is imported first, with an empty
// temp directory as working directory.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';

async function importCommands() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const queries = await loadSrc('src/agent/commands/queries.js');
        return { settingsModule, index, actions, queries };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { settingsModule, index, actions, queries } = await importCommands();
const AS = await loadSrc('src/agent/areas/area_store.js');
const AG = await loadSrc('src/agent/areas/area_guard.js');
const RS = await loadSrc('src/agent/rules/rule_store.js');
const MB = await loadSrc('src/agent/memory_bank.js');

settingsModule.setSettings({ language: 'en', protected_areas: true, world_memory: true, player_rules: true, home_pack: false });

const command = (name) => {
    const cmd = actions.actionsList.find((c) => c.name === name) ?? queries.queryList.find((c) => c.name === name);
    assert.ok(cmd, `${name} exists`);
    return cmd;
};

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

// A house of 7 x 7 blocks at (0, 63, 0) with its door in the south wall, on flat ground.
function makeWorld() {
    const world = createBlockWorld().flatGround(63);
    const house = world.house({ x: 0, y: 63, z: 0 });
    const field = world.field({ x: 20, y: 63, z: 0 });
    return { world, house, field };
}

function makeAgent({ at, world = makeWorld().world, areas = true, rules = true } = {}) {
    const store = new AS.AreaStore(path.join(dir, 'areas.json'), { now: () => new Date(Date.UTC(2026, 0, 1)) });
    store.load();
    const bot = {
        username: 'andy',
        entity: { position: vec(at.x, at.y, at.z) },
        game: { dimension: 'overworld', gameMode: 'survival' },
        output: '',
        interrupt_code: false,
        blockAt: (pos) => world.blockAt(pos),
    };
    const agent = { name: 'andy', bot, memory_bank: new MB.MemoryBank() };
    if (areas) {
        agent.area_store = store;
        agent.area_guard = AG.installAreaGuard(bot, { store: () => agent.area_store, log() {} }); // as agent.js (F2)
    }
    if (rules) {
        agent.rule_store = new RS.RuleStore(path.join(dir, 'rules.json'), { now: () => new Date(Date.UTC(2026, 0, 1)) });
        agent.rule_store.load();
    }
    return agent;
}

describe('!rememberArea(name, type)', () => {
    test('a building: the reply of the spec, the area is saved with its door', async () => {
        const { world, house } = makeWorld();
        const agent = makeAgent({ at: { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 }, world });
        const reply = await command('!rememberArea').perform(agent, 'home', 'building');
        // v0.1.4.11 (P1): without a type the kind is concluded: the house has a roof, a door and a bed, so it is a home
        assert.match(reply, /^I saved "home": a home, walled, \d+ x \d+ with a roof, 1 door, 1 bed, 1 chest\. I shelter there at night\.$/);
        const area = agent.area_store.get('home');
        assert.equal(area.type, 'home');
        assert.equal(area.kind, 'home');
        assert.equal(area.source, 'scan');
        assert.deepEqual(area.entrances.map((e) => e.kind), ['door']);
        const size = { x: area.max.x - area.min.x + 1, z: area.max.z - area.min.z + 1 };
        assert.ok(reply.includes(`${size.x} x ${size.z} with a roof`));
    });

    test('a farm: the gate is counted', async () => {
        const { world, field } = makeWorld();
        const agent = makeAgent({ at: { x: field.inside.x + 0.5, y: field.inside.y, z: field.inside.z + 0.5 }, world });
        const reply = await command('!rememberArea').perform(agent, 'wheat_farm', 'farm');
        assert.match(reply, /^I saved "wheat_farm": a farm, fenced, \d+ x \d+, 1 gate, 25 wheat\. I only plant and harvest there\.$/); // v0.1.4.11 (P1)
        assert.equal(agent.area_store.get('wheat_farm').type, 'farm');
    });

    test('no building found: a box of 25 x 13 x 25 blocks around the bot, source radius', async () => {
        const agent = makeAgent({ at: { x: 100.5, y: 64, z: 100.5 } });
        // v0.1.4.11 (P1): without a type nothing is saved where no border is found; with the type home the box as before
        assert.equal(await command('!rememberArea').perform(agent, 'home', 'building'),
            'I find no border around me: no fence, wall, hedge or water within 24 blocks. Stand inside the place and say it again.');
        assert.equal(agent.area_store.size, 0);
        const reply = await command('!rememberArea').perform(agent, 'home', 'home');
        assert.equal(reply, 'I found no building here. I saved a box of 25 x 13 x 25 blocks around this place as "home". Use !setArea to correct it.');
        const area = agent.area_store.get('home');
        assert.deepEqual([area.min, area.max], [{ x: 88, y: 60, z: 88 }, { x: 112, y: 72, z: 112 }]);
        assert.equal(area.source, 'radius');
    });

    // v0.1.4.8 (D5, part G): the farm is looked for with findFencedGroundNear, its reason gives the text
    test('a farm without a fence: the text of the scan, nothing is saved', async () => {
        const agent = makeAgent({ at: { x: 100.5, y: 64, z: 100.5 } });
        assert.equal(await command('!rememberArea').perform(agent, 'farm', 'farm'), 'I see no fence within 6 blocks of me. Stand inside the fence or next to its gate and try again.');
        assert.equal(agent.area_store.size, 0);
    });

    test('the default type is building (R4): one argument parses', async () => {
        const { world, house } = makeWorld();
        const agent = makeAgent({ at: { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 }, world });
        agent.blocked_actions = [];
        const reply = await index.executeCommand(agent, '!rememberArea("home")');
        assert.match(reply, /^I saved "home": a home, /); // v0.1.4.11 (P1): the default "building" is no type, the kind is concluded
    });

    test('an unknown type, a bad name, no store', async () => {
        const agent = makeAgent({ at: { x: 100.5, y: 64, z: 100.5 } });
        assert.equal(await command('!rememberArea').perform(agent, 'home', 'house'), 'The type of an area is "home", "building", "farm", "pen" or "mine".'); // v0.1.4.8, I4
        assert.equal(await command('!rememberArea').perform(agent, '   ', 'building'), 'An area needs a name of 1 to 64 characters.');
        assert.equal(await command('!rememberArea').perform(makeAgent({ at: { x: 0, y: 64, z: 0 }, areas: false }), 'home', 'building'), 'Protected areas are off.');
    });
});

describe('!setArea, !forgetArea, !areas, !allowChanges', () => {
    test('!setArea: the saved text, corners in any order; too big', async () => {
        const agent = makeAgent({ at: { x: 0, y: 64, z: 0 } });
        const reply = await command('!setArea').perform(agent, 'home', 'building', 0, 67, 31, -8, 62, 25);
        assert.equal(reply, 'Area "home" (building) saved: 9 x 6 x 7 blocks, from (-8, 62, 25) to (0, 67, 31), 0 doors.');
        assert.equal(agent.area_store.get('home').source, 'manual');
        assert.equal(await command('!setArea').perform(agent, 'big', 'building', 0, 60, 0, 64, 70, 10), 'That area is too big. An area has at most 64 x 48 x 64 blocks.');
        assert.equal(agent.area_store.get('big'), undefined);
    });

    test('!setArea keeps the doors of a scanned area that are inside the new box', async () => {
        const { world, house } = makeWorld();
        const agent = makeAgent({ at: { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 }, world });
        await command('!rememberArea').perform(agent, 'home', 'building');
        const door = agent.area_store.get('home').entrances[0];
        const reply = await command('!setArea').perform(agent, 'home', 'building', -2, 62, -2, 10, 70, 10);
        assert.ok(reply.endsWith(', 1 door.'), reply);
        assert.deepEqual(agent.area_store.get('home').entrances, [door]);
    });

    // v0.1.4.7 Amendment 2, I6: the doors and fence gates inside the box are looked up in the world.
    test('!setArea for a fenced field counts its gate and saves it as an entrance', async () => {
        const { world, field } = makeWorld();
        const agent = makeAgent({ at: { x: 30.5, y: 64, z: 10.5 }, world });
        const { min, max } = field.ring;
        const reply = await command('!setArea').perform(agent, 'wheat_farm', 'farm', min.x, 62, min.z, max.x, 67, max.z);
        assert.equal(reply, `Area "wheat_farm" (farm) saved: 7 x 6 x 7 blocks, from (${min.x}, 62, ${min.z}) to (${max.x}, 67, ${max.z}), 1 gate.`);
        assert.deepEqual(agent.area_store.get('wheat_farm').entrances, [{ ...field.gate, kind: 'gate' }]);
    });

    test('!setArea for a house saves the lower block of its door only', async () => {
        const { world, house } = makeWorld();
        const agent = makeAgent({ at: { x: 30.5, y: 64, z: 10.5 }, world });
        assert.equal(world.get(house.door.x, house.door.y + 1, house.door.z), 'oak_door', 'a door of two blocks');
        const reply = await command('!setArea').perform(agent, 'home', 'building', house.min.x, house.min.y, house.min.z, house.max.x, house.max.y, house.max.z);
        assert.ok(reply.endsWith(', 1 door.'), reply);
        assert.deepEqual(agent.area_store.get('home').entrances, [{ ...house.door, kind: 'door' }]);
    });

    test('!setArea: a box over the house and the field counts both kinds; a door taken away is gone', async () => {
        const { world, house, field } = makeWorld();
        const agent = makeAgent({ at: { x: 30.5, y: 64, z: 10.5 }, world });
        const reply = await command('!setArea').perform(agent, 'yard', 'building', house.min.x, 62, field.ring.min.z, field.ring.max.x, 67, house.max.z);
        assert.ok(reply.endsWith(', 1 door, 1 gate.'), reply);
        world.set(house.door.x, house.door.y, house.door.z, 'air');
        world.set(house.door.x, house.door.y + 1, house.door.z, 'air');
        const again = await command('!setArea').perform(agent, 'yard', 'building', house.min.x, 62, field.ring.min.z, field.ring.max.x, 67, house.max.z);
        assert.ok(again.endsWith(', 0 doors, 1 gate.'), again);
    });

    test('!forgetArea', async () => {
        const agent = makeAgent({ at: { x: 0, y: 64, z: 0 } });
        await command('!setArea').perform(agent, 'home', 'building', 0, 62, 0, 8, 67, 6);
        assert.equal(await command('!forgetArea').perform(agent, 'home'), 'Forgot the area "home".');
        assert.equal(await command('!forgetArea').perform(agent, 'home'), 'No area named "home" is saved.');
    });

    test('!areas: the list of the spec, or the text without areas', async () => {
        const agent = makeAgent({ at: { x: 0, y: 64, z: 0 } });
        assert.equal(command('!areas').perform(agent), 'No areas are saved in this world.');
        agent.area_store.set({ name: 'home', type: 'building', min: { x: -8, y: 62, z: 25 }, max: { x: 0, y: 67, z: 31 }, entrances: [{ x: -4, y: 63, z: 31, kind: 'door' }], source: 'scan' });
        agent.area_store.set({ name: 'wheat_farm', type: 'farm', min: { x: 20, y: 62, z: 0 }, max: { x: 26, y: 67, z: 6 }, entrances: [{ x: 22, y: 64, z: 6, kind: 'gate' }], source: 'scan' });
        assert.equal(command('!areas').perform(agent), [
            'Protected areas in this world:',
            '- home (building): from (-8, 62, 25) to (0, 67, 31), 1 door',
            '- wheat_farm (farm): from (20, 62, 0) to (26, 67, 6), 1 gate',
        ].join('\n'));
    });

    test('!allowChanges: the permit of the guard, default 10 minutes (R4)', async () => {
        const agent = makeAgent({ at: { x: 0, y: 64, z: 0 } });
        agent.blocked_actions = [];
        await command('!setArea').perform(agent, 'home', 'building', 0, 62, 0, 8, 67, 6);
        const block = { name: 'oak_planks', position: vec(1, 63, 1) };
        assert.equal(agent.bot.areaGuard.canBreak(block), false);
        assert.equal(await index.executeCommand(agent, '!allowChanges("home")'), 'You may change blocks in "home" for 10 minutes.');
        assert.equal(agent.bot.areaGuard.canBreak(block), true);
        assert.equal(await command('!allowChanges').perform(agent, 'barn', 5), 'No area named "barn" is saved.');
        assert.ok(String(await index.executeCommand(agent, '!allowChanges("home", 61)')).includes('minutes'), 'at most 60 minutes');
    });

    test('F2: !allowChanges uses the guard of the agent; bot.areaGuard, which code gets, has no permit', async () => {
        const agent = makeAgent({ at: { x: 0, y: 64, z: 0 } });
        await command('!setArea').perform(agent, 'home', 'building', 0, 62, 0, 8, 67, 6);
        assert.equal(agent.bot.areaGuard.permit, undefined);
        assert.equal(agent.bot.areaGuard.revoke, undefined);
        assert.ok(Object.isFrozen(agent.bot.areaGuard));
        const withoutGuard = { ...agent, area_guard: undefined };
        assert.equal(await command('!allowChanges').perform(withoutGuard, 'home', 5), 'Protected areas are off.');
        assert.equal(agent.bot.areaGuard.canBreak({ name: 'oak_planks', position: vec(1, 63, 1) }), false, 'no permit was given');
    });
});

describe('!rememberHere with protected areas', () => {
    test('inside a building and no area of that name: the area is saved too', async () => {
        const { world, house } = makeWorld();
        const agent = makeAgent({ at: { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 }, world });
        const reply = await command('!rememberHere').perform(agent, 'home');
        assert.match(reply, /^Location saved as "home"\. I also saved the building around it as a protected area: \d+ x \d+ x \d+ blocks, 1 door\.$/);
        // v0.1.4.8 (part G): the building of the place "home" is an area of the type home, the only shelter (C4)
        assert.equal(agent.area_store.get('home').type, 'home');
        assert.match(await command('!rememberHere').perform(agent, 'barn'), /^Location saved as "barn"\. I also saved the building around it/);
        assert.equal(agent.area_store.get('barn').type, 'building', 'another name: a building');
    });

    test('an area of that name exists already, or no building, or no store: as before', async () => {
        const { world, house } = makeWorld();
        const inside = { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 };
        const agent = makeAgent({ at: inside, world });
        await command('!setArea').perform(agent, 'home', 'farm', 50, 62, 50, 55, 66, 55);
        assert.equal(await command('!rememberHere').perform(agent, 'home'), 'Location saved as "home".');
        assert.equal(agent.area_store.get('home').type, 'farm', 'the saved area is not replaced');
        assert.equal(await command('!rememberHere').perform(makeAgent({ at: { x: 100.5, y: 64, z: 100.5 } }), 'spot'), 'Location saved as "spot".');
        assert.equal(await command('!rememberHere').perform(makeAgent({ at: inside, world, areas: false }), 'home'), 'Location saved as "home".');
    });
});

describe('the commands of the rules (R3)', () => {
    test('!rememberRule, !rules, !forgetRule with the texts of the spec', async () => {
        const agent = makeAgent({ at: { x: 0, y: 64, z: 0 }, areas: false });
        assert.equal(command('!rules').perform(agent), 'No rules are saved yet.');
        assert.equal(await command('!rememberRule').perform(agent, 'Close the door behind you.'), 'Rule 1 saved: "Close the door behind you."');
        assert.equal(await command('!rememberRule').perform(agent, 'close the door behind you'), 'That rule is already saved.');
        assert.equal(await command('!rememberRule').perform(agent, 'Seeds are for planting, never compost them.'), 'Rule 2 saved: "Seeds are for planting, never compost them."');
        assert.equal(command('!rules').perform(agent), '1. Close the door behind you.\n2. Seeds are for planting, never compost them.');
        assert.equal(await command('!forgetRule').perform(agent, 1), 'Forgot rule 1.');
        assert.equal(await command('!forgetRule').perform(agent, 1), 'There is no rule 1.');
    });

    test('the description of !rememberRule, word for word', () => {
        assert.equal(command('!rememberRule').description, 'Save a lasting rule from the player: "always", "never", "remember", "do not forget", "from now on". One short sentence.');
    });
});

describe('the commands of the home pack (H7): the text of the pack is the reply, as an action', () => {
    function homeAgent() {
        const { world, house } = makeWorld();
        const agent = makeAgent({ at: { x: house.inside.x + 0.5, y: house.inside.y, z: house.inside.z + 0.5 }, world });
        // v0.1.4.8, C4: only an area of type home is a shelter
        agent.area_store.set({ name: 'home', type: 'home', min: house.min, max: house.max, source: 'manual' });
        Object.assign(agent.bot, { time: { timeOfDay: 1000 }, thunderState: 0, rainState: 0, food: 20, health: 20, entities: {}, players: {}, findBlocks: () => [] });
        agent.labels = [];
        agent.actions = {
            async runAction(label, fn) {
                agent.labels.push(label);
                await fn();
                return { success: true, message: 'Action output:\n' + agent.bot.output, interrupted: false, timedout: false };
            },
        };
        agent.homeContext = () => ({ areas: agent.area_store, places: agent.memory_bank, settings: settingsModule.default,
            log: (text) => { agent.bot.output += text + '\n'; }, now: () => Date.now(), skills: {}, world: {} });
        return agent;
    }

    test('!goToShelter, !eat and !goToBed with home_pack on', async () => {
        settingsModule.default.home_pack = true;
        try {
            const agent = homeAgent();
            assert.equal(await command('!goToShelter').perform(agent), 'I am in the shelter already.');
            // v0.1.4.8, C1 and C6: the texts name the food level, the health and the time until the night
            assert.equal(await command('!eat').perform(agent), 'I am not hungry. Food 20 of 20, health 20 of 20.');
            assert.equal(await command('!goToBed').perform(agent), 'I cannot sleep now, it is day. The night starts in about 9 minutes.');
            assert.deepEqual(agent.labels, ['action:goToShelter', 'action:eat', 'action:goToBed']);
        } finally {
            settingsModule.default.home_pack = false;
        }
    });

    test('with home_pack off: !goToShelter and !eat do nothing, !goToBed is the old action', async () => {
        const agent = homeAgent();
        assert.equal(await command('!goToShelter').perform(agent), 'The home pack is off.');
        assert.equal(await command('!eat').perform(agent), 'The home pack is off.');
        const reply = await command('!goToBed').perform(agent);
        assert.equal(reply, 'Action output:\nCould not find a bed to sleep in.\n');
        assert.deepEqual(agent.labels, ['action:goToBed']);
    });
});

describe('the descriptions of the spec', () => {
    // v0.1.4.8 (part G): the descriptions say what the commands do now (five types, only a home as shelter,
    // eat until full); the size of the prompt made them shorter (tests/routing/commands.js holds them too)
    test('!rememberArea and !allowChanges', () => {
        assert.equal(command('!rememberArea').description, 'Save the place you stand in as a protected area; without a type you conclude the kind (home, building, farm, pen, mine) from what is there. Use this when the player says "this is home", "this is the farm" or "this is the mine".');
        assert.equal(command('!allowChanges').description, 'Allow yourself to break and place blocks in a protected area for some minutes, only when the player asks you to build, repair or break something there.');
    });

    test('!goToShelter and !eat, and !goToBed with and without the home pack', () => {
        assert.equal(command('!goToShelter').description, 'Go into your home and close the door. Use this when night comes, when monsters are near, when the player says "get to shelter", "go home" or "go inside".');
        assert.equal(command('!eat').description, 'Eat until you are full, and until your health is full while you have food. Use this when the player tells you to eat, or when you are hungry or hurt.');
        assert.equal(command('!goToBed').description, 'Go to the nearest bed and sleep.');
        settingsModule.default.home_pack = true;
        try {
            assert.equal(command('!goToBed').description, 'Go to the nearest bed and sleep. Use this at night, or when the player says "sleep" or "go to bed".');
        } finally {
            settingsModule.default.home_pack = false;
        }
    });
});

describe('the defaults of R4 in the parameter definitions', () => {
    const DEFAULTS = [
        ['!followPlayer', 'follow_dist', 4], ['!goToPlayer', 'closeness', 3], ['!collectBlocks', 'num', 1], ['!craftRecipe', 'num', 1],
        ['!goToCoordinates', 'closeness', 1], ['!searchForBlock', 'search_range', 64], ['!searchForEntity', 'search_range', 64],
        ['!givePlayer', 'num', 1], ['!stay', 'type', 30], ['!rememberArea', 'type', 'building'], ['!allowChanges', 'minutes', 10],
    ];
    for (const [name, param, value] of DEFAULTS) {
        test(`${name}: ${param} has the default ${JSON.stringify(value)}, and it is the last parameter or all after it have one`, () => {
            const params = command(name).params;
            assert.strictEqual(params[param].default, value);
            const names = Object.keys(params);
            for (const later of names.slice(names.indexOf(param))) assert.ok('default' in params[later], `${name} ${later}`);
        });
    }

    test('a call without the parameter gets the default', async () => {
        const seen = [];
        const cmd = command('!goToPlayer');
        const original = cmd.perform;
        cmd.perform = async (agent, name, closeness) => {
            seen.push([name, closeness]);
            return 'ok';
        };
        try {
            await index.executeCommand({ blocked_actions: [] }, '!goToPlayer("bob")');
            await index.executeCommand({ blocked_actions: [] }, "!goToPlayer('bob', 5)");
        } finally {
            cmd.perform = original;
        }
        assert.deepEqual(seen, [['bob', 3], ['bob', 5]]);
    });
});
