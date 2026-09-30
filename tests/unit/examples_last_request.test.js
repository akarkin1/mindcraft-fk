// v0.1.4.8, setting examples_by_last_request: the prompt examples are chosen by the last request of the
// player, not by the whole conversation. In the play test of 2026-09-30 the example "get back to farming"
// was shown for "get to the shelter" and for "do we have any fence in the chests", because the results of
// the farm commands filled the conversation.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Examples } from '../../src/utils/examples.js';

const example = (request, answer) => [
    { role: 'user', content: `someone: ${request}` },
    { role: 'assistant', content: answer },
];

const EXAMPLES = [
    example('get back to farming', '!farmCycle'),
    example('harvest the wheat pls', '!harvest'),
    example('get to shelter', '!goToShelter'),
    example('whats in the chests?', '!chests'),
];

// A conversation of the play test: long results of farm commands, then a request about something else.
const conversation = (lastRequest) => [
    { role: 'user', content: 'MartyByrde2: get back to farming' },
    { role: 'assistant', content: '!farmCycle' },
    { role: 'system', content: 'Agent executed: !farmCycle and got: Farm "farm": I harvested 10 wheat and planted 10 again. 48 plants are not ripe yet. I stored 10 wheat in the chest. The gate is closed. farming wheat harvest farming wheat' },
    { role: 'assistant', content: 'Done with the farming.' },
    { role: 'user', content: `MartyByrde2: ${lastRequest}` },
];

async function firstExample(byLastRequest, lastRequest) {
    const examples = new Examples(null, 2);
    await examples.load(JSON.parse(JSON.stringify(EXAMPLES)));
    examples.by_last_request = byLastRequest;
    const selected = await examples.getRelevant(conversation(lastRequest));
    return selected[0][0].content;
}

describe('examples by the last request', () => {
    test('off by default: a new Examples compares the whole conversation', async () => {
        assert.equal(new Examples(null, 2).by_last_request, false);
        assert.match(await firstExample(false, 'get to the shelter'), /farming|wheat/);
    });

    test('on: "get to the shelter" gets the example of the shelter', async () => {
        assert.equal(await firstExample(true, 'get to the shelter'), 'someone: get to shelter');
    });

    test('on: a question about the chests gets the example of the chests', async () => {
        assert.equal(await firstExample(true, 'whats in the chests now?'), 'someone: whats in the chests?');
    });

    test('the last request is the last turn of a player, without the name', () => {
        const examples = new Examples(null, 2);
        assert.equal(examples.lastRequestText(conversation('give me some wheat')), 'give me some wheat');
        const withSystemLast = [...conversation('give me some wheat'), { role: 'system', content: 'Agent executed: !givePlayer and got: done' }];
        assert.equal(examples.lastRequestText(withSystemLast), 'give me some wheat');
    });

    test('no turn of a player: the whole conversation is compared, as before', async () => {
        const examples = new Examples(null, 2);
        await examples.load(JSON.parse(JSON.stringify(EXAMPLES)));
        examples.by_last_request = true;
        assert.equal(examples.lastRequestText([{ role: 'system', content: 'Respond with hello world and your name' }]), '');
        const selected = await examples.getRelevant([{ role: 'system', content: 'whats in the chests?' }]);
        assert.equal(selected[0][0].content, 'someone: whats in the chests?');
    });
});
