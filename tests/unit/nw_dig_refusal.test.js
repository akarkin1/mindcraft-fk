// Engineer E1 of v0.1.4.11, part W, spec W7 and I2: the refusal of !newAction for digging names the one call to
// make from where the bot stands. digRefusalText(commands, place) of src/agent/dig_request_logic.js, the ore of
// the request (oreOfRequest), and the glue of !newAction that builds `place` from agent.whereAmI().
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { vec } from '../helpers/block_world.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

const D = await loadSrc('src/agent/dig_request_logic.js');

const ON = ['!mineOre', '!rememberTunnel', '!collectBlocks'];
const START = 'I do not write code for digging.';

describe('W7: the refusal for each place, word for word', () => {
    test('in a tunnel of a known mine', () => {
        assert.equal(D.digRefusalText(ON, { inMine: true, inTunnel: true, underground: true, fromInside: false, ore: 'iron' }),
            'I do not write code for digging. From here: !mineOre("iron", 8).');
        assert.equal(D.digRefusalText(ON, { inMine: true, inTunnel: true, underground: true, fromInside: true, ore: 'iron' }),
            'I do not write code for digging. From here: !mineOre("iron", 8).', 'in a tunnel the tunnel wins');
    });

    test('on the surface, or inside a known mine with mine_from_inside', () => {
        assert.equal(D.digRefusalText(ON, { inMine: false, inTunnel: false, underground: false, fromInside: false, ore: 'diamond' }),
            'I do not write code for digging. From here: !mineOre("diamond", 8, true).');
        assert.equal(D.digRefusalText(ON, { inMine: true, inTunnel: false, underground: true, fromInside: true, ore: 'diamond' }),
            'I do not write code for digging. From here: !mineOre("diamond", 8, true).');
    });

    test('in a known mine, not in a tunnel, the switch off', () => {
        assert.equal(D.digRefusalText(ON, { inMine: true, inTunnel: false, underground: true, fromInside: false, ore: 'iron' }),
            'I do not write code for digging. From here: !rememberTunnel, then !mineOre("iron", 8).');
    });

    test('underground, no known mine', () => {
        assert.equal(D.digRefusalText(ON, { inMine: false, inTunnel: false, underground: true, fromInside: false, ore: 'iron' }),
            'I do not write code for digging. From here: say "leave the mine", then !mineOre("iron", 8, true).');
        assert.equal(D.digRefusalText(ON, { inMine: false, inTunnel: true, underground: true, fromInside: false, ore: 'iron' }),
            'I do not write code for digging. From here: say "leave the mine", then !mineOre("iron", 8, true).', 'a tunnel counts only in a mine');
    });

    test('no digging command on: as today', () => {
        assert.equal(D.digRefusalText([], { inMine: true, inTunnel: true, underground: true, fromInside: false, ore: 'iron' }),
            'I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.');
    });

    test('the ore: one of the ore table, else iron; the count is 8', () => {
        const place = { inMine: true, inTunnel: true, underground: true, fromInside: false };
        assert.equal(D.digRefusalText(ON, { ...place, ore: 'gold' }), `${START} From here: !mineOre("gold", 8).`);
        assert.equal(D.digRefusalText(ON, { ...place, ore: 'mithril' }), `${START} From here: !mineOre("iron", 8).`);
        assert.equal(D.digRefusalText(ON, { ...place, ore: null }), `${START} From here: !mineOre("iron", 8).`);
        assert.equal(D.DIG_COUNT, 8);
    });

    test('without place, or without the commands the call needs: the text of v0.1.4.9', () => {
        assert.equal(D.digRefusalText(ON), D.digRefusalText(ON, null));
        assert.match(D.digRefusalText(ON), /^I do not write code for digging\. I have skills for it: /);
        assert.equal(D.digRefusalText(['!collectBlocks'], { inMine: false, underground: false }),
            'I do not write code for digging. I have skills for it: !collectBlocks for blocks in sight.');
        assert.match(D.digRefusalText(['!mineOre', '!collectBlocks'], { inMine: true, inTunnel: false, underground: true, fromInside: false }),
            /I have skills for it/, 'no !rememberTunnel: it is not named');
    });
});

describe('oreOfRequest: the ore that the request names', () => {
    test('with an ore of the table, in any form', () => {
        assert.equal(D.oreOfRequest('find diamonds'), 'diamond');
        assert.equal(D.oreOfRequest('get me some Iron'), 'iron');
        assert.equal(D.oreOfRequest('deepslate_gold_ore please'), 'gold');
        assert.equal(D.oreOfRequest('Strip-mine for Diamond ore'), 'diamond');
        assert.equal(D.oreOfRequest('dig for coal ore and iron ore'), 'coal', 'the first one');
    });

    test('none: null, never throws', () => {
        for (const text of ['dig a tunnel', 'craft an iron pickaxe', '', null, 5, {}]) assert.equal(D.oreOfRequest(text), null, String(text));
    });
});

// ------------------------------------------------------------------ the glue of !newAction (I2)

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        await loadSrc('src/agent/commands/index.js'); // first, as the agent loads them: actions.js imports it back
        const actions = await loadSrc('src/agent/commands/actions.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, actions, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const BASE = { language: 'en', mining_pack: true, routes_pack: true, mine_routes: true, skills_over_code: true, allow_insecure_coding: true,
    blocked_actions: [], mine_from_inside: false };

let cap;
before(() => M.mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => M.mcdata.__setMcdataForTests(null));
beforeEach(() => {
    cap = captureConsole();
    M.settingsModule.setSettings({ ...BASE });
});
afterEach(() => cap.restore());

const newAction = M.actions.actionsList.find((c) => c.name === '!newAction');

function agentAt(where) {
    const agent = {
        name: 'andy', turns: [],
        bot: { username: 'andy', output: '', interrupt_code: false, entity: { position: vec(0.5, 64, 0.5) }, game: { dimension: 'overworld' }, players: {} },
        history: { add: async () => {}, getHistory: () => agent.turns.map(([name, content]) => ({ role: 'user', content: `${name}: ${content}` })) },
        coder: { calls: 0, async generateCode() { this.calls++; return 'code ran'; } },
        actions: { async runAction(label, fn) { await fn(); return { success: true, message: 'code ran', interrupted: false, timedout: false }; } },
        running_commands: [],
        work_packs: {},
    };
    if (where !== undefined) agent.whereAmI = () => where;
    return agent;
}

describe('I2: the glue of !newAction builds the place from whereAmI()', () => {
    test('in the tunnel of the mine "mine": !mineOre of the ore of the request', async () => {
        const agent = agentAt({ underground: true, mine: { name: 'mine', tunnel: 0, level: 30, onRoute: false } });
        assert.equal(await newAction.perform(agent, 'dig a tunnel for gold ore'), 'I do not write code for digging. From here: !mineOre("gold", 8).');
        assert.equal(agent.coder.calls, 0);
    });

    test('in the room of the mine, the switch off and on', async () => {
        const agent = agentAt({ underground: true, mine: { name: 'mine', tunnel: null, level: 41, onRoute: false } });
        assert.equal(await newAction.perform(agent, 'dig a tunnel'), 'I do not write code for digging. From here: !rememberTunnel, then !mineOre("iron", 8).');
        M.settingsModule.setSettings({ ...BASE, mine_from_inside: true });
        assert.equal(await newAction.perform(agent, 'find diamonds'), 'I do not write code for digging. From here: !mineOre("diamond", 8, true).');
    });

    test('underground in no mine, and on the surface', async () => {
        assert.equal(await newAction.perform(agentAt({ underground: true, mine: null }), 'dig a tunnel'),
            'I do not write code for digging. From here: say "leave the mine", then !mineOre("iron", 8, true).');
        assert.equal(await newAction.perform(agentAt({ underground: false, mine: null }), 'dig a tunnel'),
            'I do not write code for digging. From here: !mineOre("iron", 8, true).');
    });

    test('the ore of the player\'s last message when the prompt names none', async () => {
        const agent = agentAt({ underground: false, mine: null });
        agent.turns.push(['MartyByrde2', 'get me some coal']);
        assert.equal(await newAction.perform(agent, 'Write a loop that digs forward.'), 'I do not write code for digging. From here: !mineOre("coal", 8, true).');
    });

    test('without whereAmI: the text of v0.1.4.9', async () => {
        assert.match(await newAction.perform(agentAt(undefined), 'dig a tunnel'), /^I do not write code for digging\. I have skills for it: /);
    });
});
