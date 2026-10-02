// Release v0.1.4.11, part P (engineer E3): the area sense and the enclosure line (SPEC I6, P2, P3).
//   - senseStep of src/agent/areas/area_sense.js: once per enclosure (its box) per start, not while a command runs,
//     not within 60 s of the last line, only after 3 s inside;
//   - senseTick with a fake bot in a pen and in a barn: the lines of P2 word for word; nothing in a saved area;
//   - the knowledge line: enclosureLine and whereLine of src/agent/knowledge/knowledge_text.js (P3), the input of
//     unsavedEnclosure and enclosureKnowledge, and knowledgeBlock of src/agent/agent.js (at most one scan per 10 s);
//   - the mode area_sense of src/agent/modes.js exists only with the setting area_sense, and says the line once.
import { describe, test, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { createBlockWorld, vec } from '../helpers/block_world.js';
import { loadModes, makeFakeBot, makeFakeAgent } from '../helpers/st_modes_env.js';

const A = await loadSrc('src/agent/areas/area_sense.js');
const KT = await loadSrc('src/agent/knowledge/knowledge_text.js');

const PEN_LINE = 'I am in a fenced pen 9 x 7 with 6 chickens and 1 gate that I have not saved. Tell me its name and I keep it.';
const BARN_LINE = 'I am in a walled building 7 x 9 with a roof and 1 door that I have not saved. Tell me its name and I keep it.';
const PEN_KNOWLEDGE = 'You stand in a fenced enclosure 9 x 7 with 6 chickens and 1 gate that is not saved.';

// A pen of 7 x 5 grass behind an oak fence (9 x 7 with the fence) at x0, with 6 chickens; the bot inside.
function penScene(x0 = 0) {
    const world = createBlockWorld().flatGround(63);
    const pen = world.field({ x: x0, y: 63, z: 0, width: 7, depth: 5, ground: 'grass_block', crop: null });
    const bot = { entity: { id: 1, name: 'player', type: 'player', position: vec(pen.inside.x + 0.5, 64, pen.inside.z + 0.5) },
        game: { dimension: 'overworld' }, blockAt: (pos) => world.blockAt(pos) };
    bot.entities = { 1: bot.entity };
    for (let i = 0; i < 6; i++) bot.entities[10 + i] = { id: 10 + i, name: 'chicken', type: 'animal', position: vec(x0 + 0.5 + i, 64, 0.5) };
    return { world, pen, bot };
}

function barnScene() {
    const world = createBlockWorld().flatGround(63);
    const house = world.house({ x: 0, y: 63, z: 0, width: 5, depth: 7, bed: null, chest: null });
    const bot = { entity: { position: vec(house.inside.x + 0.5, house.inside.y, house.inside.z + 0.5) }, game: { dimension: 'overworld' },
        entities: {}, blockAt: (pos) => world.blockAt(pos) };
    return { world, house, bot };
}

describe('senseStep: the rules of P2', () => {
    test('only after 3 s in the same enclosure, then once per box', () => {
        const s = A.newSenseState();
        assert.equal(A.senseStep(s, { now: 0, idle: true, key: 'a' }), false);
        assert.equal(A.senseStep(s, { now: 2999, idle: true, key: 'a' }), false);
        assert.equal(A.senseStep(s, { now: 3000, idle: true, key: 'a' }), true);
        assert.equal(A.senseStep(s, { now: 200000, idle: true, key: 'a' }), false, 'once per box per start');
    });

    test('not within 60 s of the last line, also for another box', () => {
        const s = A.newSenseState();
        A.senseStep(s, { now: 0, idle: true, key: 'a' });
        assert.equal(A.senseStep(s, { now: 3000, idle: true, key: 'a' }), true);
        assert.equal(A.senseStep(s, { now: 10000, idle: true, key: 'b' }), false);
        assert.equal(A.senseStep(s, { now: 62999, idle: true, key: 'b' }), false);
        assert.equal(A.senseStep(s, { now: 63000, idle: true, key: 'b' }), true);
    });

    test('not while a command runs; leaving or a command starts the 3 s again', () => {
        const s = A.newSenseState();
        A.senseStep(s, { now: 0, idle: true, key: 'a' });
        assert.equal(A.senseStep(s, { now: 2000, idle: false, key: 'a' }), false);
        assert.equal(A.senseStep(s, { now: 4000, idle: true, key: 'a' }), false, 'the 3 s start after the command');
        assert.equal(A.senseStep(s, { now: 6000, idle: true, key: null }), false);
        assert.equal(A.senseStep(s, { now: 7000, idle: true, key: 'a' }), false);
        assert.equal(A.senseStep(s, { now: 10000, idle: true, key: 'a' }), true);
    });
});

describe('senseTick: the lines of P2 in the world', () => {
    test('in a pen with 6 chickens: the line after 3 s, once', () => {
        const { bot } = penScene();
        const s = A.newSenseState();
        assert.equal(A.senseTick(s, bot, { now: 1000, idle: true, areas: [] }), null);
        assert.equal(A.senseTick(s, bot, { now: 3000, idle: true, areas: [] }), null);
        assert.equal(A.senseTick(s, bot, { now: 4000, idle: true, areas: [] }), PEN_LINE);
        assert.equal(A.senseTick(s, bot, { now: 70000, idle: true, areas: [] }), null);
    });

    test('in a barn: a walled building with a roof and a door', () => {
        const { bot } = barnScene();
        const s = A.newSenseState();
        A.senseTick(s, bot, { now: 0, idle: true, areas: [] });
        assert.equal(A.senseTick(s, bot, { now: 3000, idle: true, areas: [] }), BARN_LINE);
    });

    test('nothing in a saved area, nothing outside an enclosure, nothing while a command runs', () => {
        const { bot, pen } = penScene();
        const saved = [{ name: 'aviary', type: 'pen', dimension: 'overworld', min: { x: pen.ring.min.x, y: 62, z: pen.ring.min.z },
            max: { x: pen.ring.max.x, y: 66, z: pen.ring.max.z } }];
        const s = A.newSenseState();
        for (const now of [0, 3000, 6000]) assert.equal(A.senseTick(s, bot, { now, idle: true, areas: saved }), null);
        const other = saved.map((a) => ({ ...a, dimension: 'the_nether' }));
        const t = A.newSenseState();
        A.senseTick(t, bot, { now: 0, idle: false, areas: other });
        A.senseTick(t, bot, { now: 1000, idle: true, areas: other });
        assert.equal(A.senseTick(t, bot, { now: 3500, idle: false, areas: other }), null);
        const open = { entity: { position: vec(100.5, 64, 100.5) }, entities: {}, blockAt: (p) => createBlockWorld().flatGround(63).blockAt(p) };
        const u = A.newSenseState();
        for (const now of [0, 3000, 6000]) assert.equal(A.senseTick(u, open, { now, idle: true, areas: [] }), null);
    });

    test('a broken bot gives nothing and never throws', () => {
        const s = A.newSenseState();
        assert.equal(A.senseTick(s, null, { now: 0, idle: true, areas: [] }), null);
        assert.equal(A.senseTick(s, { entity: { position: vec(0, 64, 0) }, blockAt() { throw new Error('x'); } }, { now: 0, idle: true, areas: [] }), null);
    });
});

describe('the knowledge line (I6, P3)', () => {
    test('enclosureLine and whereLine, word for word', () => {
        const enclosure = { saved: false, border: 'fence', size: { x: 9, z: 7 }, contents: { animals: { chicken: 6 } }, openings: [{ kind: 'gate' }] };
        assert.equal(KT.enclosureLine(enclosure), PEN_KNOWLEDGE);
        assert.equal(KT.whereLine({ area: null, depth: 0, underground: false, enclosure }), `You are on the surface. ${PEN_KNOWLEDGE}`);
        assert.equal(KT.whereLine({ area: null, depth: 0, underground: false }), 'You are on the surface.', 'as before without it');
        assert.equal(KT.enclosureLine({ ...enclosure, saved: true }), '', 'a saved one: nothing');
        assert.equal(KT.enclosureLine(null), '');
        assert.equal(KT.enclosureLine({ saved: false, border: 'wall', size: { x: 7, z: 9 }, roof: true, contents: { chests: 2 }, openings: [{ kind: 'door' }] }),
            'You stand in a walled enclosure 7 x 9 with a roof, 2 chests and 1 door that is not saved.');
    });

    test('unsavedEnclosure and enclosureKnowledge give the input of the line; nothing when an area holds it', () => {
        const { bot, pen } = penScene();
        const found = A.unsavedEnclosure(bot, []);
        assert.equal(found.kind, 'pen');
        assert.equal(KT.whereLine({ area: null, depth: 0, underground: false, enclosure: A.enclosureKnowledge(found) }), `You are on the surface. ${PEN_KNOWLEDGE}`);
        const saved = [{ name: 'aviary', type: 'pen', dimension: 'overworld', min: { x: pen.ring.min.x, y: 62, z: pen.ring.min.z },
            max: { x: pen.ring.max.x, y: 66, z: pen.ring.max.z } }];
        assert.equal(A.unsavedEnclosure(bot, saved), null);
        assert.equal(A.enclosureKnowledge(null), null);
        const open = { entity: { position: vec(100.5, 64, 100.5) }, entities: {}, blockAt: (p) => createBlockWorld().flatGround(63).blockAt(p) };
        assert.equal(A.unsavedEnclosure(open, []), null, 'found false: nothing');
    });
});

describe('knowledgeBlock of the agent: the enclosure line, at most one scan per 10 s', () => {
    let M;
    before(async () => {
        const cwd = process.cwd();
        const empty = makeTmpDir();
        const cap = captureConsole();
        process.chdir(empty);
        try {
            M = { settingsModule: await loadSrc('src/agent/settings.js'), agent: await loadSrc('src/agent/agent.js') };
        } finally {
            process.chdir(cwd);
            cap.restore();
            removeTmpDir(empty);
        }
    });

    function knowingAgent(bot, areas = []) {
        return Object.assign(Object.create(M.agent.Agent.prototype), {
            name: 'andy', bot,
            _workStores: () => ({ chests: null, mines: null }),
            area_store: { list: () => areas },
            memory_bank: { getJson: () => ({}) },
            whereAmI: () => ({ area: null, depth: 0, underground: false }),
        });
    }

    test('in an unsaved pen the line follows the where line; the scan is kept for 10 s', () => {
        M.settingsModule.setSettings({ language: 'en', knowledge_in_prompt: true, area_floors: false });
        const { bot } = penScene();
        const agent = knowingAgent(bot);
        assert.equal(agent.knowledgeBlock(), `WHAT YOU KNOW (from memory, no need to check):\nYou are on the surface. ${PEN_KNOWLEDGE}`);
        bot.entity.position = vec(100.5, 64, 100.5);
        assert.match(agent.knowledgeBlock(), /You stand in a fenced enclosure/, 'the last scan stands within 10 s');
        agent._enclosure.at -= 10000;
        assert.equal(agent.knowledgeBlock(), 'WHAT YOU KNOW (from memory, no need to check):\nYou are on the surface.');
    });

    test('without protected areas or in a saved area: no line', () => {
        M.settingsModule.setSettings({ language: 'en', knowledge_in_prompt: true });
        const { bot, pen } = penScene();
        const none = knowingAgent(bot);
        none.area_store = undefined;
        assert.equal(none.knowledgeBlock(), 'WHAT YOU KNOW (from memory, no need to check):\nYou are on the surface.');
        const saved = knowingAgent(bot, [{ name: 'aviary', type: 'pen', dimension: 'overworld', entrances: [],
            min: { x: pen.ring.min.x, y: 62, z: pen.ring.min.z }, max: { x: pen.ring.max.x, y: 66, z: pen.ring.max.z } }]);
        assert.ok(!saved.knowledgeBlock().includes('You stand in'));
    });
});

describe('the setting and the mode area_sense (P2)', () => {
    test('area_sense: off by default in settings_spec.json, a switch in settings.js', () => {
        const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
        assert.equal(spec.area_sense.type, 'boolean');
        assert.equal(spec.area_sense.default, false);
        assert.match(fs.readFileSync(repoPath('settings.js'), 'utf8'), /\n {4}"area_sense": (true|false), \/\/ /);
    });

    let M;
    let cap;
    before(async () => {
        M = await loadModes();
    });
    beforeEach(() => {
        cap = captureConsole();
    });
    afterEach(() => {
        mock.timers.reset();
        cap.restore();
    });

    // the pen at the place of the fake bot, the agent of the modes with the area store and sayText
    function senseAgent(on) {
        const world = createBlockWorld().flatGround(63);
        world.field({ x: 2000, y: 63, z: 0, width: 7, depth: 5, ground: 'grass_block', crop: null });
        const bot = makeFakeBot({ world, pos: [2003.5, 64, 2.5] });
        for (let i = 0; i < 6; i++) bot.entities[100 + i] = { id: 100 + i, name: 'chicken', type: 'animal', position: vec(2000.5 + i, 64, 0.5) };
        const agent = makeFakeAgent(M, bot, { on });
        agent.area_store = { list: () => [] };
        agent.said = [];
        agent.sayText = (text) => agent.said.push(text);
        return agent;
    }

    test('off: the mode does not exist, the list of the modes is that of v0.1.4.10', () => {
        M.settingsModule.setSettings({ language: 'en', protected_areas: true, area_sense: false, home_pack: false });
        const agent = senseAgent([]);
        assert.equal(agent.bot.modes.exists('area_sense'), false);
        assert.ok(!agent.bot.modes.getDocs().includes('area_sense'));
    });

    test('on: listed with the others; standing idle in the pen for 3 s it says the line once', async () => {
        M.settingsModule.setSettings({ language: 'en', protected_areas: true, area_sense: true, home_pack: false });
        mock.timers.enable({ apis: ['Date'], now: 1000000 });
        const agent = senseAgent(['area_sense']);
        assert.equal(agent.bot.modes.exists('area_sense'), true);
        assert.match(agent.bot.modes.getDocs(), /\n- area_sense\(ON\): /);
        await agent.bot.modes.update();
        assert.deepEqual(agent.said, []);
        mock.timers.tick(3000);
        await agent.bot.modes.update();
        assert.deepEqual(agent.said, [PEN_LINE]);
        assert.ok(agent.bot.modes.behavior_log.includes(PEN_LINE));
        mock.timers.tick(120000);
        await agent.bot.modes.update();
        assert.deepEqual(agent.said, [PEN_LINE], 'once per enclosure');
        assert.deepEqual(agent.labels, [], 'no action: it interrupts nothing');
    });
});
