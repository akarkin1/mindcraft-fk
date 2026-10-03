// v0.1.4.12, part G, G5: `!endConversation` answers `Conversation with ${name} ended.` (the typing error goes);
// skills.goToPlayer for a player without an entity after the wait says `I see no player "Steve". The players I
// see: MartyByrde2.` with the names of bot.players except the bot itself, or `I see no other player.`;
// the `!useOn` description stays as short as before (the prompt size).
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue } from '../helpers/st_glue_env.js';
import { makeBot, registry } from './stb_fake_bot.test.js';

const G = await loadGlue(); // registers the mcdata hooks once
const mcdata = await loadSrc('src/utils/mcdata.js');
const skills = await loadSrc('src/agent/library/skills.js');
const convo = (await loadSrc('src/agent/conversation.js')).default;
mcdata.__setMcdataForTests(registry);

const LIMIT = { timeout: 15000 };
const command = (name) => G.actions.actionsList.find((c) => c.name === name);

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

describe('G5: !endConversation', () => {
    test('"Conversation with bot2 ended."', async () => {
        const before = { convos: convo.convos, active: convo.activeConversation };
        let ended = false;
        convo.convos = { bot2: { active: true, end() { this.active = false; ended = true; } } };
        convo.activeConversation = { name: 'someone_else' };
        try {
            assert.equal(await command('!endConversation').perform({}, 'bot2'), 'Conversation with bot2 ended.');
            assert.equal(ended, true);
        } finally {
            convo.convos = before.convos;
            convo.activeConversation = before.active;
        }
    });

    test('not in a conversation: the old answer', async () => {
        assert.equal(await command('!endConversation').perform({}, 'nobody_here'), 'Not in conversation with nobody_here.');
    });
});

describe('G5: goToPlayer for a player without an entity', () => {
    test('other players in the list: `I see no player "Steve". The players I see: MartyByrde2.`', LIMIT, async () => {
        const bot = makeBot();
        bot.players = { andy: { username: 'andy', entity: bot.entity }, MartyByrde2: { username: 'MartyByrde2', entity: null } };
        assert.equal(await skills.goToPlayer(bot, 'Steve', 3), false);
        assert.match(bot.output, /I see no player "Steve"\. The players I see: MartyByrde2\./);
        assert.doesNotMatch(bot.output, /Could not find/);
    });

    test('two others, joined with a comma; the bot itself never named', LIMIT, async () => {
        const bot = makeBot();
        bot.players = { andy: {}, MartyByrde2: {}, Alex: {} };
        assert.equal(await skills.goToPlayer(bot, 'Steve', 3), false);
        assert.match(bot.output, /I see no player "Steve"\. The players I see: MartyByrde2, Alex\./);
    });

    test('no other player: `I see no player "Steve". I see no other player.`', LIMIT, async () => {
        const bot = makeBot();
        bot.players = { andy: { username: 'andy', entity: bot.entity } };
        assert.equal(await skills.goToPlayer(bot, 'Steve', 3), false);
        assert.match(bot.output, /I see no player "Steve"\. I see no other player\./);
    });

    test('stopped during the wait: no text that claims a look', LIMIT, async () => {
        const bot = makeBot();
        bot.players = { andy: {} };
        setTimeout(() => { bot.interrupt_code = true; }, 100);
        assert.equal(await skills.goToPlayer(bot, 'Steve', 3), false);
        assert.doesNotMatch(bot.output, /I see no player/);
    });
});

describe('G4: the !useOn description', () => {
    test('stays as before (the door behaviour is in the texts); the parameters stay', () => {
        const c = command('!useOn');
        assert.equal(c.description, 'Right click a tool on the nearest target of a type.');
        assert.deepEqual(Object.keys(c.params), ['tool_name', 'target']);
    });
});
