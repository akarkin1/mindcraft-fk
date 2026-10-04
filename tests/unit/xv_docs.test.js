// Spec v0.1.4.13 4.5 (part N2): the skill of the supervisor (.claude/skills/supervise/SKILL.md: the loop, the standing
// rules, the updates, what never to do, the report; it names the tools and the client, nothing of the code) and the
// guide of the owner (docs/SUPERVISOR.md: the token, the tunnel, claude mcp add, the one sentence, the cost).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readRepoFile } from '../helpers/source_ast.js';

describe('the skill supervise', () => {
    const skill = readRepoFile('.claude/skills/supervise/SKILL.md').replace(/\r\n/g, '\n');

    test('a skill: the name and a description in the head', () => {
        assert.match(skill, /^---\nname: supervise\ndescription: \S.+\n---\n/);
    });

    test('the parts of the spec', () => {
        for (const head of ['## The tools', '## The loop', '## Standing rules', '## Updates', '## What never to do', '## The report at the end'])
            assert.ok(skill.includes(head), head);
    });

    test('it names the tools and the client', () => {
        for (const tool of ['wait', 'digest', 'run', 'reply', 'note', 'look', 'server', 'say'])
            assert.ok(skill.includes(`\`${tool}\``), tool);
        assert.ok(skill.includes('node scripts/watch.js'));
        assert.ok(skill.includes('Updates are off.'));
        assert.ok(skill.includes('Dropped: the bot was speaking.'));
        assert.ok(skill.includes('At most one per 2 minutes.'));
        // the owner, 2026-10-04: going down is fine when the way is safe (ladders on every block, stairs, a known way)
        assert.ok(skill.includes('Never a bare shaft down'));
    });

    test('nothing of the code', () => {
        const withoutClient = skill.split('scripts/watch.js').join('');
        assert.doesNotMatch(withoutClient, /src\/|\.js\b/);
        assert.doesNotMatch(skill, /supervisor_logic|registerTool|holdDecision/);
    });
});

describe('the guide docs/SUPERVISOR.md', () => {
    const guide = readRepoFile('docs/SUPERVISOR.md').replace(/\r\n/g, '\n');

    test('the token, the tunnel, claude mcp add word for word, the one sentence, the cost', () => {
        assert.ok(guide.includes('## 2. The token'));
        assert.ok(guide.includes('MindcraftWatchToken'));
        assert.ok(guide.includes('## 3. The tunnel'));
        assert.ok(guide.includes('cloudflared tunnel --url http://127.0.0.1:8090'));
        assert.ok(guide.includes('claude mcp add --transport http mindcraft <url> --header "Authorization: Bearer <token>"'));
        assert.ok(guide.includes('## 5. The one sentence'));
        assert.ok(guide.includes('/supervise '));
        assert.ok(guide.includes('## 7. The cost'));
        assert.ok(guide.includes('about a cent a turn'));
    });

    test('the settings of the supervisor and their defaults', () => {
        for (const row of ['| `supervisor_name` |', '| `supervisor_updates` | `false` |', '| `supervisor_voice` | `"supertonic:M1"` |'])
            assert.ok(guide.includes(row), row);
        assert.ok(guide.includes('The supervisor is not here.'));
    });
});
