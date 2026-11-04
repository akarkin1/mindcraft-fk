// v0.1.4.12, part G, G2: right after each spawn the 1.21.4+ server waits for the packet player_loaded before it
// takes the bot's actions. Since v0.1.4.14 mineflayer (4.38.0 and later, #3986) writes it itself at every spawn,
// behind the feature sendsPlayerLoadedPacket of minecraft-data, and the agent no longer does. The harness of the
// world tests waits 0.5 s after the spawn, not 3.5 s.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(import.meta.url);
const prismarineRegistry = require('prismarine-registry');
const injectHealth = require('mineflayer/lib/plugins/health.js');

describe('G2: player_loaded at every spawn, by mineflayer', () => {
    test('agent.js does not write player_loaded; mineflayer health.js does, behind sendsPlayerLoadedPacket', () => {
        const agent = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8');
        assert.doesNotMatch(agent, /write\(\s*['"]player_loaded['"]/);
        assert.doesNotMatch(agent, /sendPlayerLoaded/);
        const health = fs.readFileSync(repoPath('node_modules/mineflayer/lib/plugins/health.js'), 'utf8');
        assert.match(health, /if \(bot\.supportFeature\('sendsPlayerLoadedPacket'\)\) bot\._client\.write\('player_loaded', \{\}\)/);
        for (const version of ['1.21.8', '26.1']) {
            const registry = prismarineRegistry(version);
            assert.equal(registry.supportFeature('sendsPlayerLoadedPacket'), true, version);
            const bot = new EventEmitter();
            bot.supportFeature = registry.supportFeature;
            bot.writes = [];
            bot._client = new EventEmitter();
            bot._client.write = (name, params) => { bot.writes.push([name, params]); };
            injectHealth(bot, { respawn: false });
            const health = (h) => bot._client.emit('update_health', { health: h, food: 20, foodSaturation: 5 });
            const loaded = () => bot.writes.filter(([name]) => name === 'player_loaded').length;
            health(20);
            health(18);
            assert.equal(loaded(), 1, `${version}: once for the first spawn`);
            health(0);
            bot._client.emit('respawn', {});
            health(20);
            assert.equal(loaded(), 2, `${version}: once more after the respawn`);
        }
    });

    test('tests/world/helpers.js waits 0.5 s after the spawn, not 3.5 s', () => {
        const src = fs.readFileSync(repoPath('tests/world/helpers.js'), 'utf8');
        assert.doesNotMatch(src, /await sleep\(3500\)/);
        assert.match(src, /player_loaded[\s\S]{0,400}await sleep\(500\);/);
    });
});
