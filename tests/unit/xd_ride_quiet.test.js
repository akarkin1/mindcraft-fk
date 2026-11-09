// v0.1.4.14, the play of 2026-11-09 (DECISIONS P-27, SPEC 8.4.4): the unstuck reflex fought the owner's boat ("I'm stuck!"
// and !moveAway(3) while riding). The mode unstuck is quiet while bot.vehicle is set; once the bot is out, its stuck time
// starts over. The real modes with the real ActionManager on the fake bot of tests/helpers/st_modes_env.js.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { captureConsole } from '../helpers/console_capture.js';
import { loadModes, makeFakeBot, makeFakeAgent, freshPos } from '../helpers/st_modes_env.js';

const M = await loadModes();
await import('ses'); // the global assert of the agent process, for resume actions

const BASE = { language: 'en', narrate_behavior: false, home_pack: true };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realNow = Date.now;
let offset = 0;
let cap;
before(() => { Date.now = () => realNow() + offset; });
after(() => { Date.now = realNow; });
beforeEach(() => {
    cap = captureConsole();
    offset += 10 * 60 * 1000;
});
afterEach(() => cap.restore());

// A command that runs at the same place until it is interrupted.
function command(agent) {
    return agent.actions.runAction('action:followPlayer', async () => {
        while (!agent.bot.interrupt_code) await sleep(10);
    });
}

async function settle(agent, ms = 15000) {
    await sleep(350);
    const end = realNow() + ms;
    while (agent.actions.executing && realNow() < end) await sleep(10);
    await sleep(50);
}

describe('P-27: the mode unstuck is quiet while the bot rides', () => {
    test('42 s at the same place in a boat: no "I\'m stuck!"; out of the boat, the stuck time starts over and the reflex fires after 21 s', { timeout: 40000 }, async () => {
        M.settingsModule.setSettings(BASE);
        const bot = makeFakeBot({ pos: freshPos() });
        bot.vehicle = { id: 77, name: 'oak_boat', position: bot.entity.position };
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        command(agent);
        await sleep(30);
        await bot.modes.update();
        offset += 21000;
        await bot.modes.update();
        offset += 21000;
        await bot.modes.update();
        await sleep(100); // the say of the mode is asynchronous
        assert.deepEqual(agent.messages, [], 'quiet in the boat');
        assert.ok(!agent.labels.includes('mode:unstuck'), 'no escape');

        bot.vehicle = null;
        await bot.modes.update(); // on foot: the stuck time starts now
        offset += 5000;
        await bot.modes.update();
        await sleep(100);
        assert.deepEqual(agent.messages, [], '5 s on foot: not yet');
        offset += 16000;
        await bot.modes.update();
        await sleep(100);
        assert.ok(agent.messages.some((m) => m.includes("I'm stuck!")), `now it fires: ${JSON.stringify(agent.messages)}`);
        agent.requestInterrupt('the test');
        await settle(agent);
    });

    test('in a minecart with the time already counted: getting in resets the count', { timeout: 40000 }, async () => {
        M.settingsModule.setSettings(BASE);
        const bot = makeFakeBot({ pos: freshPos() });
        const agent = makeFakeAgent(M, bot, { on: ['unstuck'] });
        command(agent);
        await sleep(30);
        await bot.modes.update();
        offset += 15000;
        await bot.modes.update();
        bot.vehicle = { id: 78, name: 'minecart', position: bot.entity.position };
        offset += 10000;
        await bot.modes.update();
        await sleep(100);
        assert.deepEqual(agent.messages, [], '25 s, the last 10 riding: quiet');
        bot.vehicle = null;
        await bot.modes.update();
        offset += 10000;
        await bot.modes.update();
        await sleep(100);
        assert.deepEqual(agent.messages, [], '10 s after the ride: the count started over');
        agent.requestInterrupt('the test');
        await settle(agent);
    });
});
