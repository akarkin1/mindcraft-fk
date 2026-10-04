// Spec v0.1.4.13 4.1 (part S): the help patterns and the help event (only with a supervisor), the report event
// every watch_report_seconds, the tick lag; through the listeners of events.js with a fake agent. Every listener
// and timer is removed at the end.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HELP_PATTERNS, Ring, asksThePlayer, createTickLagWatch, helpEvent, reportEvent } from '../../src/agent/watch/events_logic.js';
import { startListeners } from '../../src/agent/watch/events.js';

const T0 = new Date(2026, 9, 4, 6, 45, 12).getTime();

describe('the help patterns', () => {
    test('a text that ends with ?, holds Say " or Tell me', () => {
        assert.equal(HELP_PATTERNS.length, 3);
        assert.equal(asksThePlayer('Which chest do you mean?'), true);
        assert.equal(asksThePlayer('Say "mine 3 iron" first.'), true);
        assert.equal(asksThePlayer('I know no mine here. Tell me its name.'), true);
        assert.equal(asksThePlayer('Your mine "deep" has no tunnel where diamond is found. Show me a tunnel at that depth, or tell me to dig a new mine.'), false);
        assert.equal(asksThePlayer('I mined 6 of 6 iron.'), false);
        assert.equal(asksThePlayer(''), false);
        assert.equal(asksThePlayer(null), false);
    });

    test('the help event, word for word, only with a supervisor', () => {
        const text = 'I know no mine here. Tell me its name.';
        const event = helpEvent(text, 'Opus', T0);
        assert.equal(event.kind, 'help');
        assert.equal(event.text, 'Help: "I know no mine here. Tell me its name."');
        assert.deepEqual(event.data, { text });
        assert.equal(helpEvent(text, '', T0), null);
        assert.equal(helpEvent(text, undefined, T0), null);
        assert.equal(helpEvent('I mined 6 of 6 iron.', 'Opus', T0), null);
    });

    test('the report event: the lines joined with ; or Nothing changed.', () => {
        assert.equal(reportEvent(['Cursor: 3.', 'Health 14 of 20, food 15 of 20.', 'Inventory: +2 bread.'], T0).text, 'Health 14 of 20, food 15 of 20.; Inventory: +2 bread.');
        assert.equal(reportEvent([], T0).text, 'Nothing changed.');
        assert.equal(reportEvent(['Cursor: 3.', 'Nothing changed.'], T0).text, 'Nothing changed.');
        assert.equal(reportEvent([], T0).kind, 'report');
    });

    test('the tick lag: what the time packet comes later than a second after the last', () => {
        const lag = createTickLagWatch();
        assert.equal(lag.update(1000), 0);
        assert.equal(lag.update(2000), 0);
        assert.equal(lag.update(3250), 250);
        assert.equal(lag.update(4000), 0);
        assert.equal(lag.lag(), 0);
    });
});

function fakeAgent() {
    const bot = new EventEmitter();
    bot.username = 'Luna';
    bot.entity = { position: { x: 1.5, y: 64, z: 1.5 } };
    bot.health = 20;
    bot.food = 20;
    bot.game = { dimension: 'overworld' };
    bot.blockAt = () => ({ name: 'stone' });
    bot.inventory = { items: () => [{ name: 'bread', count: 3 }], slots: [] };
    bot.heldItem = null;
    bot.entities = {};
    bot._client = new EventEmitter();
    return { name: 'Luna', bot, actions: { currentActionLabel: '' }, running_commands: [], async openChat() {}, async handleMessage() {} };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the listeners', () => {
    test('a line of the bot that asks the player is a help event with supervisor_name, none without', async () => {
        for (const [name, expected] of [['Opus', 1], ['', 0]]) {
            const agent = fakeAgent();
            const events = [];
            const watch = { chat: new Ring(100), events: new Ring(200), now: () => T0, settings: { supervisor_name: name, watch_report_seconds: 0 } };
            const stop = startListeners(agent, watch, (e) => events.push(e), { tickMs: 100000 });
            await agent.openChat('Say "mine 3 iron" first.');
            await agent.openChat('I mined 6 of 6 iron.');
            stop();
            const help = events.filter((e) => e.kind === 'help');
            assert.equal(help.length, expected, `with supervisor_name "${name}"`);
            if (expected)
                assert.equal(help[0].text, 'Help: "Say "mine 3 iron" first."');
        }
    });

    test('the report every watch_report_seconds: the digest since the last report, even when nothing happened', async () => {
        const agent = fakeAgent();
        const events = [];
        const watch = { chat: new Ring(100), events: new Ring(200), now: () => Date.now(), settings: { watch_report_seconds: 0 } };
        const push = (e) => {
            events.push(e);
            watch.events.push(e);
        };
        const stop = startListeners(agent, watch, push, { tickMs: 100000, reportMs: 40 });
        await sleep(60);
        agent.bot.health = 12;
        await sleep(40);
        stop();
        const reports = events.filter((e) => e.kind === 'report');
        assert.ok(reports.length >= 2, `${reports.length} reports`);
        assert.equal(reports[0].text, 'Nothing changed.');
        assert.ok(reports.some((r) => r.text === 'Health 12 of 20, food 20 of 20.'), reports.map((r) => r.text).join(' | '));
        assert.ok(!reports.some((r) => r.text.includes('report:')), 'a report is no news of the next report');
        const none = [];
        const quiet = startListeners(fakeAgent(), { chat: new Ring(100), events: new Ring(200), now: () => Date.now(), settings: { watch_report_seconds: 0 } }, (e) => none.push(e), { tickMs: 100000 });
        await sleep(30);
        quiet();
        assert.equal(none.filter((e) => e.kind === 'report').length, 0);
    });

    test('the tick lag of the bot is on watch.tickLag', async () => {
        const agent = fakeAgent();
        const clock = { t: T0 };
        const watch = { chat: new Ring(100), events: new Ring(200), now: () => clock.t, settings: {} };
        const stop = startListeners(agent, watch, () => {}, { tickMs: 100000 });
        agent.bot.time = { timeOfDay: 1000 };
        agent.bot.emit('time');
        clock.t = T0 + 1300;
        agent.bot.emit('time');
        assert.equal(watch.tickLag.lag(), 300);
        stop();
    });
});
