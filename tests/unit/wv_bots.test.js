// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.6 (part D, two bots) and DECISIONS F2:
//   D1 shouldAnswer({ from, text, self, otherBots, onlyChatWith }) -> { answer, why } for every row: the bot itself,
//      another bot of the owner (case-insensitive), a command echo from anyone, a result of a bot from anyone, a name
//      not in only_chat_with when that list is not empty; true otherwise;
//   D3 the role line `${bot_role} A question to all of us gets one line from you.` right after the W6 sentence "A rule
//      about a place names ..." of the conversing prompt, put there by the prompter (no placeholder in the profiles),
//      and the prompt byte for byte unchanged with an empty role.
// Part D was in work by E6 while these tests were written; a failure here is a finding against the spec.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const B = await loadSrc('src/agent/bots_logic.js');

const base = { self: 'w_farmer', otherBots: ['w_miner'], onlyChatWith: [] };
const ask = (over) => B.shouldAnswer({ ...base, from: 'MartyByrde2', text: 'where are you?', ...over });

function no(r, label) {
    assert.equal(r.answer, false, label);
    assert.ok(typeof r.why === 'string' && r.why.length > 0, `${label}: why names the cause`);
}

describe('D1 shouldAnswer: false', () => {
    test('from the bot itself', () => {
        no(ask({ from: 'w_farmer' }), 'self');
    });

    test('from another bot of the owner', () => {
        no(ask({ from: 'w_miner' }), 'other bot');
    });

    test('from another bot, in another case', () => {
        no(ask({ from: 'W_Miner' }), 'case');
        no(B.shouldAnswer({ ...base, otherBots: ['W_MINER'], from: 'w_miner', text: 'hi' }), 'case of the list');
    });

    test('a command echo, from anyone (the owner too)', () => {
        no(ask({ text: '*w_miner used stop*' }), 'echo from the owner');
        no(ask({ from: 'Alex', text: '*MartyByrde2 used goToPlayer*' }), 'echo from another');
    });

    test('a result of a bot, from anyone', () => {
        for (const text of ['Action output: I found 3 iron_ore.', 'Found destructive path.', 'Found non-destructive path.', 'You have reached the target.'])
            no(ask({ text }), text);
        no(ask({ from: 'Alex', text: 'Action output: done' }), 'from another player');
    });

    test('a name not in only_chat_with when the list is not empty', () => {
        no(ask({ from: 'Alex', onlyChatWith: ['MartyByrde2'] }), 'not listened');
    });

    test('another bot that is in only_chat_with is still not answered', () => {
        no(ask({ from: 'w_miner', onlyChatWith: ['MartyByrde2', 'w_miner'] }), 'other bot first');
    });
});

describe('D1 shouldAnswer: true', () => {
    test('the owner, no list', () => {
        assert.equal(ask({}).answer, true);
    });

    test('the owner in only_chat_with', () => {
        assert.equal(ask({ onlyChatWith: ['MartyByrde2'] }).answer, true);
    });

    test('anyone when only_chat_with is empty', () => {
        assert.equal(ask({ from: 'Alex' }).answer, true);
    });

    test('a line that only looks like an echo or a result', () => {
        assert.equal(ask({ text: '*w_miner used stop* and then go home' }).answer, true);
        assert.equal(ask({ text: 'I used the stop command' }).answer, true);
        assert.equal(ask({ text: 'Have you reached the farm?' }).answer, true);
        assert.equal(ask({ text: 'the action output was strange' }).answer, true);
    });

    test('no other bots configured', () => {
        assert.equal(B.shouldAnswer({ from: 'w_miner', text: 'hi', self: 'w_farmer', otherBots: [], onlyChatWith: [] }).answer, true);
    });
});

// ------------------------------------------------------------------------------------------------ D3

const ROLE = 'You are the farmer. w_miner is the miner.';
const LINE = 'You are the farmer. w_miner is the miner. A question to all of us gets one line from you.';
const W6_START = 'A rule about a place names a place you saved';

function conversingOf(file) {
    return JSON.parse(fs.readFileSync(repoPath(file), 'utf8')).conversing;
}

describe('D3 the role line', () => {
    test('the line of a role', () => {
        assert.equal(B.roleLine(ROLE), LINE);
    });

    for (const file of ['profiles/claude.json', 'profiles/gpt.json']) {
        test(`${file}: no placeholder of the role in the profile (DECISIONS F2)`, () => {
            const text = conversingOf(file);
            assert.ok(text.includes(W6_START), 'the W6 sentence is in the profile');
            assert.doesNotMatch(text, /\$ROLE|\$BOT_ROLE|bot_role/i);
        });

        test(`${file}: the role line on its own line right after the W6 sentence`, () => {
            const prompt = conversingOf(file);
            const out = B.insertRoleLine(prompt, ROLE);
            const lines = out.split('\n');
            const at = lines.findIndex((l) => l.includes(W6_START));
            assert.ok(at >= 0);
            assert.equal(lines[at + 1], LINE);
            assert.equal(out.split(LINE).length - 1, 1, 'once');
            assert.equal(out.replace(`\n${LINE}`, ''), prompt, 'nothing else changed');
        });

        test(`${file}: an empty role leaves the prompt byte for byte`, () => {
            const prompt = conversingOf(file);
            assert.equal(B.insertRoleLine(prompt, ''), prompt);
            assert.equal(B.insertRoleLine(prompt, undefined), prompt);
            assert.equal(B.insertRoleLine(prompt, '   '), prompt);
        });
    }

    test('the prompter inserts it with settings.bot_role in the conversing prompt (source)', () => {
        const src = fs.readFileSync(repoPath('src/models/prompter.js'), 'utf8');
        assert.match(src, /insertRoleLine\(\s*prompt\s*,\s*settings\.bot_role\s*\)/);
        assert.match(src, /import\s*\{[^}]*insertRoleLine[^}]*\}\s*from\s*['"]\.\.\/agent\/bots_logic\.js['"]/);
    });

    test('the settings: bot_role "" and other_bots [] by default in settings_spec.json', () => {
        const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
        assert.equal(spec.bot_role?.default, '');
        assert.deepEqual(spec.other_bots?.default, []);
    });
});
