// Spec v0.1.4.13 4.1 (part S): the server tool from a fixture agent: uptime, heap, tick lag, the players, time
// and weather, the cost meter's session line, the switches on, the presence of a supervisor; the setting
// watch_report_seconds in settings.js and the spec of the settings (valid, never a value asserted).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_HANDLERS, sessionText, switchesOn, upText } from '../../src/agent/watch/tools.js';
import { TEXTS } from '../../src/agent/watch/texts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const T0 = new Date(2026, 9, 4, 6, 45, 12).getTime();

function fixture() {
    return {
        name: 'Luna',
        bot: {
            username: 'Luna',
            players: { gpt: {}, MartyByrde2: {}, Luna: {} },
            time: { timeOfDay: 14290 },
            isRaining: false,
            thunderState: 0,
        },
        cost_meter: { totals: () => ({ calls: 177, dollars: 0.04, by_purpose: { memory: { calls: 3, dollars: 0.01 }, chat: { calls: 174, dollars: 0.03 } } }) },
    };
}

describe('the server tool', () => {
    test('the six lines of the spec', async () => {
        const watch = { now: () => T0, uptime: () => 42 * 60 + 7, tickLag: { lag: () => 0 }, settings: { watch_server: true, smelting: true, voice_ui: true, mining_pack: false, watch_port: 8090 }, presence: { seenAt: T0 - 12000 } };
        const lines = (await TOOL_HANDLERS.server(fixture(), {}, watch)).split('\n');
        assert.match(lines[0], /^Up 42 min, heap \d+ of \d+ MB, tick lag 0 ms\.$/);
        assert.equal(lines[1], 'Players: MartyByrde2, gpt.');
        assert.equal(lines[2], 'Time 14290 (night), weather clear.');
        assert.equal(lines[3], 'Model calls 177, session $0.04 (chat $0.03, memory $0.01).');
        assert.equal(lines[4], 'Switches on: smelting, voice_ui, watch_server.');
        assert.equal(lines[5], 'Supervisor: connected 12 s ago.');
        assert.equal(lines.length, 6);
    });

    test('no players, rain and thunder, no cost meter, no switches, no supervisor', async () => {
        const agent = fixture();
        agent.bot.players = { Luna: {} };
        agent.bot.isRaining = true;
        agent.cost_meter = undefined;
        const watch = { now: () => T0, uptime: () => 30, tickLag: { lag: () => 250 }, settings: { watch_server: false }, presence: { seenAt: T0 - 61000 } };
        const lines = (await TOOL_HANDLERS.server(agent, {}, watch)).split('\n');
        assert.match(lines[0], /^Up 30 s, heap \d+ of \d+ MB, tick lag 250 ms\.$/);
        assert.equal(lines[1], 'Players: none.');
        assert.equal(lines[2], 'Time 14290 (night), weather rain.');
        assert.equal(lines[3], 'Model calls: no cost meter.');
        assert.equal(lines[4], 'Switches on: none.');
        assert.equal(lines[5], 'Supervisor: none.');
        agent.bot.thunderState = 1;
        assert.equal((await TOOL_HANDLERS.server(agent, {}, watch)).split('\n')[2], 'Time 14290 (night), weather thunder.');
        assert.equal(TEXTS.noSupervisor, 'Supervisor: none.');
    });

    test('upText, sessionText, switchesOn', () => {
        assert.equal(upText(59), '59 s');
        assert.equal(upText(42 * 60 + 59), '42 min');
        assert.equal(upText(2 * 3600 + 5 * 60), '2 h 5 min');
        assert.equal(sessionText({ dollars: 0, by_purpose: {} }), '$0.00');
        assert.equal(sessionText({ dollars: 1.005, by_purpose: { chat: { calls: 1, dollars: 1.005 } } }), '$1.01 (chat $1.01)');
        assert.deepEqual(switchesOn({ b: true, a: true, c: false, d: 'true', e: 1 }), ['a', 'b']);
    });
});

describe('the setting', () => {
    test('watch_report_seconds is valid in settings.js and in the spec of the settings', async () => {
        const settings = (await import('../../settings.js')).default;
        assert.ok(Number.isInteger(settings.watch_report_seconds) && settings.watch_report_seconds >= 0);
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'mindcraft', 'public', 'settings_spec.json'), 'utf8'));
        assert.equal(spec.watch_report_seconds.type, 'number');
        assert.equal(spec.watch_report_seconds.default, 0);
        assert.equal(typeof spec.watch_report_seconds.description, 'string');
        const keys = Object.keys(spec);
        // watch_local_only of v0.1.4.13 sits between them
        assert.equal(keys[keys.indexOf('voice_language') + 1], 'watch_local_only');
        assert.equal(keys[keys.indexOf('watch_local_only') + 1], 'watch_report_seconds');
    });
});
