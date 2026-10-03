// v0.1.4.12, part G, G2: right after each spawn the agent writes the packet player_loaded (new in 1.21.4), so
// the 1.21.8 server takes the bot's actions from the first second. Only when the protocol of the version has
// the packet; never twice for one spawn. mineflayer emits 'spawn' again after a death (health back above 0),
// so the packet goes at every spawn. The harness of the world tests waits 0.5 s after the spawn, not 3.5 s.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { repoPath } from '../helpers/paths.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue } from '../helpers/st_glue_env.js';

const require = createRequire(import.meta.url);
const prismarineRegistry = require('prismarine-registry');
const injectHealth = require('mineflayer/lib/plugins/health.js');
const G = await loadGlue();
const { sendPlayerLoaded } = G.agentModule;

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

function fakeBot(version = '1.21.8') {
    const bot = new EventEmitter();
    bot.version = version;
    bot.registry = prismarineRegistry(version);
    bot.writes = [];
    bot.supportFeature = () => false;
    bot._client = new EventEmitter();
    bot._client.write = (name, params) => { bot.writes.push([name, params]); };
    return bot;
}

describe('G2: sendPlayerLoaded', () => {
    test('1.21.8 has packet_player_loaded: player_loaded with an empty body, one console line', () => {
        const bot = fakeBot('1.21.8');
        assert.equal(sendPlayerLoaded(bot), true);
        assert.deepEqual(bot.writes, [['player_loaded', {}]]);
        assert.equal(cap.records.filter((r) => /player_loaded/.test(r.text)).length, 1, cap.allText());
    });

    test('a version without the packet (1.21.1): nothing is written', () => {
        const bot = fakeBot('1.21.1');
        assert.equal(sendPlayerLoaded(bot), false);
        assert.deepEqual(bot.writes, []);
    });

    test('never throws: a client that throws, no client, no bot', () => {
        const bot = fakeBot();
        bot._client.write = () => { throw new Error('socket closed'); };
        assert.equal(sendPlayerLoaded(bot), false);
        assert.equal(sendPlayerLoaded({ registry: bot.registry }), false);
        assert.equal(sendPlayerLoaded(null), false);
    });
});

describe('G2: once per spawn, with the spawns of mineflayer', () => {
    // the listener as agent.js registers it, on the health plugin of mineflayer, which emits 'spawn'
    function spawningBot() {
        const bot = fakeBot();
        injectHealth(bot, { respawn: false });
        bot.on('spawn', () => sendPlayerLoaded(bot));
        return bot;
    }
    const health = (bot, h) => bot._client.emit('update_health', { health: h, food: 20, foodSaturation: 5 });
    const loaded = (bot) => bot.writes.filter(([name]) => name === 'player_loaded').length;

    test('the first spawn: once; more health packets: no more', () => {
        const bot = spawningBot();
        assert.equal(loaded(bot), 0, 'nothing before the spawn');
        health(bot, 20);
        assert.equal(loaded(bot), 1);
        health(bot, 18);
        health(bot, 20);
        assert.equal(loaded(bot), 1, 'never twice for one spawn');
    });

    test('a death and the respawn: once more', () => {
        const bot = spawningBot();
        health(bot, 20);
        health(bot, 0); // death
        assert.equal(loaded(bot), 1);
        bot._client.emit('respawn', {});
        health(bot, 20); // the new life
        assert.equal(loaded(bot), 2);
        health(bot, 19);
        assert.equal(loaded(bot), 2);
    });

    test('agent.js: the listener on every spawn, registered before the spawn handler of the start', () => {
        const src = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        const listener = src.indexOf("this.bot.on('spawn', () => sendPlayerLoaded(this.bot));");
        const handler = src.indexOf("this.bot.once('spawn', async () => {");
        assert.ok(listener > 0, 'the listener');
        assert.ok(handler > listener, 'before the once handler');
        assert.equal(src.split('sendPlayerLoaded(this.bot)').length - 1, 1, 'registered once');
    });

    test('tests/world/helpers.js waits 0.5 s after the spawn, not 3.5 s', () => {
        const src = fs.readFileSync(repoPath('tests/world/helpers.js'), 'utf8');
        assert.doesNotMatch(src, /await sleep\(3500\)/);
        assert.match(src, /player_loaded[\s\S]{0,400}await sleep\(500\);/);
    });
});
