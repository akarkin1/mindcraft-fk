// v0.1.4.14, part L (engineer E1), fix round part 8 (P-30, spec 8.9): `run` of the watch server counts a result whose
// last line is `You have reached (x, y, z)` as a success whatever the lines before it. The path finder says "Path not
// found, but attempting to navigate anyway using destructive movements" and then walks; the queue read the first line
// as a failure (FAILURE_STARTS) and stopped the rest of the call (the owner worked around it with stop_on_failure
// false). queue.js: endsReached, isFailureResult with the reached rule, and the captured lines judged together.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { REACHED_START, createQueue, endsReached, isFailureResult } from '../../src/agent/watch/queue.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DESTRUCTIVE = 'Path not found, but attempting to navigate anyway using destructive movements.';
const REACHED = 'You have reached (-506, 63, 200).';

// A fake agent as in xs_queue.test.js; a step may route several lines one after the other (`lines`).
function fakeAgent(script) {
    const agent = {
        name: 'Luna',
        bot: { username: 'Luna' },
        running_commands: [],
        handled: [],
        routed: [],
        actions: { currentActionLabel: '', executing: false, last_action_time: 0 },
        async routeResponse(to, message) {
            this.routed.push([to, message]);
        },
        async handleMessage(source, message) {
            this.handled.push([source, message]);
            const name = message.match(/^!(\w+)/)?.[1];
            const step = script[name] ?? { lines: [`ran ${name}`], ms: 5 };
            this.routeResponse(source, `*${source} used ${name}*`);
            const entry = { name: `!${name}`, text: message, typed: true, by: source };
            this.running_commands.push(entry);
            await sleep(step.ms ?? 5);
            if (step.pack)
                entry.pack = step.pack;
            this.running_commands.splice(this.running_commands.indexOf(entry), 1);
            for (const line of step.lines ?? [])
                this.routeResponse(source, line);
            return true;
        },
    };
    return agent;
}

describe('L: a walk that arrived is a success of run (queue.js)', () => {
    test('endsReached: the last line that says anything', () => {
        assert.equal(REACHED_START.test(REACHED), true);
        assert.equal(endsReached(REACHED), true);
        assert.equal(endsReached(`${DESTRUCTIVE}\n${REACHED}`), true);
        assert.equal(endsReached(`${DESTRUCTIVE}\n${REACHED}\n   \n`), true);
        assert.equal(endsReached(`${REACHED}\nFailed to open the door.`), false);
        assert.equal(endsReached('I stopped at (1, 2, 3), 9 blocks from the goal.'), false);
        assert.equal(endsReached(''), false);
        assert.equal(endsReached(null), false);
    });

    test('isFailureResult: the reached line last is no failure whatever the lines before it', () => {
        assert.equal(isFailureResult(null, `${DESTRUCTIVE}\n${REACHED}`), false);
        assert.equal(isFailureResult(null, `Failed to dig.\nI could not open it.\n${REACHED}`), false);
        assert.equal(isFailureResult(null, DESTRUCTIVE), true, 'without the arrival the line is the failure it was');
        assert.equal(isFailureResult(null, `${REACHED}\nFailed to open the door.`), true, 'a failure after the arrival counts');
        assert.equal(isFailureResult({ ok: false, text: 'I mined 0 of 28.' }, REACHED), true, 'the pack\'s own verdict stands');
        assert.equal(isFailureResult(null, 'Path not found to the farm.'), true);
    });

    test('run: the walk that says Path not found and then arrives does not stop the queue', async () => {
        const agent = fakeAgent({
            goToCoordinates: { lines: [DESTRUCTIVE, REACHED], ms: 10 },
            stats: { lines: ['STATS'], ms: 5 },
        });
        const queue = createQueue(agent, { longSkillMs: 200 });
        const answer = await queue.run(['!goToCoordinates(-506, 63, 200, 2)', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), [
            'Ran 2 of 2.',
            `1. !goToCoordinates(-506, 63, 200, 2): ${REACHED}`,
            '2. !stats: STATS',
        ]);
        queue.close();
    });

    test('run: the walk that says Path not found and stops short still stops the queue', async () => {
        const agent = fakeAgent({
            goToCoordinates: { lines: [DESTRUCTIVE, 'I stopped at (-500, 63, 190), 11 blocks from the goal.'], ms: 10 },
            stats: { lines: ['STATS'], ms: 5 },
        });
        const queue = createQueue(agent, { longSkillMs: 200 });
        const answer = await queue.run(['!goToCoordinates(-506, 63, 200, 2)', '!stats'], { by: 'MartyByrde2' });
        assert.deepEqual(answer.split('\n'), [
            'Ran 1 of 2.',
            '1. !goToCoordinates(-506, 63, 200, 2): I stopped at (-500, 63, 190), 11 blocks from the goal.',
            'Stopped at 1 of 2.',
        ]);
        queue.close();
    });
});
