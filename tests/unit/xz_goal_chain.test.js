// v0.1.4.16, review 16 V-1 (the lead): a goal (!goal) is a standing order of whoever set it. The self prompter records the
// order chain's `by` when it starts; agent.js gives the goal's self prompts that chain, so a player's goal may start work
// commands while a goal the model set itself (from an AUTO MESSAGE) stays the model's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const { SelfPrompter } = await loadSrc('src/agent/self_prompter.js');

function started(chain) {
    const agent = chain === undefined ? {} : { order_chain: chain };
    const sp = new SelfPrompter(agent);
    sp.startLoop = () => {};
    sp.start('build a house');
    return sp.started_by;
}

test('a goal started in a player\'s chain carries the player', () => {
    assert.equal(started({ by: 'MartyByrde2', at: 1 }), 'MartyByrde2');
});

test('a goal the model set on its own stays the model\'s', () => {
    assert.equal(started({ by: 'model', at: 1 }), 'model');
});

test('a goal loaded after a restart, with no chain, counts as a player\'s standing order', () => {
    assert.equal(started(undefined), 'player');
});
