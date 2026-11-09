// v0.1.4.14, part L (engineer E1), fix round part 8 (P-21, spec 8.7): the messages sent to Claude end with a user turn.
// The models from Claude 4.6 on take no assistant prefill: a turn list that ends with the assistant's turn is a 400
// ("This model does not support assistant message prefill. The conversation must end with a user message.", seen with
// claude-haiku-5-5 at 03:41:09 of the owner's play) and the bot said "My brain disconnected, try again.". strictFormat
// of src/utils/text.js merges consecutive assistant turns and puts its filler (`_`) between two assistant turns and at
// the start, but never at the end; claude.js closes the list with the same filler after strictFormat (closedByUser).
//
// No key and no network: the adapter is made with Object.create(Claude.prototype) (the constructor never runs) and
// `anthropic.messages.create` is a fake, as in cost_claude_adapter.test.js; claude.js is imported with the working
// directory in an empty temp directory, so the real keys.json is never read.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { strictFormat } from '../../src/utils/text.js';

async function importClaudeWithoutKeys() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return await loadSrc('src/models/claude.js');
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { Claude, closedByUser, CLOSING_TURN } = await importClaudeWithoutKeys();

function fakeClaude(respond) {
    const requests = [];
    const adapter = Object.create(Claude.prototype);
    adapter.model_name = 'claude-haiku-5-5';
    adapter.params = {};
    adapter.anthropic = {
        messages: {
            async create(request) {
                requests.push(request);
                return respond(request);
            },
        },
    };
    return { adapter, requests };
}

const textResponse = { model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'On my way. !goToPlayer("Marty", 3)' }], usage: { input_tokens: 10, output_tokens: 5 } };

// the turns of a command answer: the player's line, the bot's command, and nothing after it
const COMMAND_ANSWER_TURNS = () => [
    { role: 'user', content: 'MartyByrde2: come to the farm' },
    { role: 'assistant', content: 'On my way. !goToPlayer("MartyByrde2", 3)' },
];

describe('L: the messages to Claude end with a user turn (closedByUser, claude.js)', () => {
    test('the filler of strictFormat closes a list that ends with the assistant turn', () => {
        assert.deepEqual(CLOSING_TURN, { role: 'user', content: '_' });
        const messages = strictFormat(COMMAND_ANSWER_TURNS());
        assert.equal(messages.at(-1).role, 'assistant', 'strictFormat leaves the assistant turn last');
        const closed = closedByUser(messages);
        assert.equal(closed.length, 3);
        assert.deepEqual(closed.at(-1), { role: 'user', content: '_' });
        assert.equal(closed[1].content, 'On my way. !goToPlayer("MartyByrde2", 3)');
        assert.equal(messages.length, 2, 'the list given is not changed');
    });

    test('a list that ends with a user turn is returned as it is; an empty list is one filler', () => {
        const messages = strictFormat([{ role: 'user', content: 'MartyByrde2: hi' }, { role: 'assistant', content: 'Hi!' }, { role: 'system', content: 'Command output: ok' }]);
        assert.equal(closedByUser(messages), messages);
        assert.equal(messages.at(-1).role, 'user');
        assert.deepEqual(closedByUser([]), [{ role: 'user', content: '_' }]);
        assert.deepEqual(closedByUser(undefined), [{ role: 'user', content: '_' }]);
    });

    test('two assistant turns at the end: the filler between them (strictFormat) and one after them', () => {
        const closed = closedByUser(strictFormat([
            { role: 'user', content: 'MartyByrde2: go' },
            { role: 'assistant', content: '!goToPlayer("MartyByrde2", 3)' },
            { role: 'assistant', content: 'I am here.' },
        ]));
        assert.deepEqual(closed.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
        assert.equal(closed.at(-1).content, '_');
    });

    test('sendRequest with the turns of a command answer sends a list that ends with a user turn', async () => {
        const { adapter, requests } = fakeClaude(() => textResponse);
        const cap = captureConsole();
        let res;
        try {
            res = await adapter.sendRequest(COMMAND_ANSWER_TURNS(), 'You are a bot.');
        } finally {
            cap.restore();
        }
        assert.equal(res, 'On my way. !goToPlayer("Marty", 3)');
        assert.equal(requests.length, 1);
        const { messages } = requests[0];
        assert.equal(messages.at(-1).role, 'user', 'the conversation ends with a user message');
        assert.equal(messages.at(-1).content, '_');
        assert.equal(messages.length, 3);
        assert.equal(messages[0].role, 'user');
        assert.equal(messages[1].role, 'assistant');
    });

    test('sendRequest with a list that ends with a user turn adds nothing', async () => {
        const { adapter, requests } = fakeClaude(() => textResponse);
        const cap = captureConsole();
        try {
            await adapter.sendRequest([{ role: 'user', content: 'MartyByrde2: hello' }], 'You are a bot.');
        } finally {
            cap.restore();
        }
        assert.deepEqual(requests[0].messages, [{ role: 'user', content: 'MartyByrde2: hello' }]);
    });

    test('claude.js closes the list right after strictFormat', () => {
        const src = fs.readFileSync(repoPath('src/models/claude.js'), 'utf8');
        assert.match(src, /const messages = closedByUser\(strictFormat\(turns\)\);/);
    });
});
