// Spec v0.1.4.9 D3 and D4: profiles/gpt.json is a valid profile, start-gpt.ps1 loads the keys of both
// of its models by name, test-routing.ps1 takes -Model and -Profile and loads one key by name.
//
// The owner edits the profiles in his checkout, so the profile is checked for its validity, not for its
// values. The PowerShell scripts are read as text: this machine does not run them, and they read
// secrets.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { repoPath } from '../helpers/paths.js';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('scripts/routing_check.js');
const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8');
const lines = (text) => text.split(/\r?\n/);

// A model entry of a profile: a name, or { model, params?, api?, url? }.
function isModelEntry(value) {
    if (typeof value === 'string') return value.length > 0;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    if (typeof value.model !== 'string' || value.model.length === 0) return false;
    return value.params === undefined || (value.params !== null && typeof value.params === 'object' && !Array.isArray(value.params));
}

describe('profiles/gpt.json', () => {
    const profile = JSON.parse(read('profiles/gpt.json'));

    test('a valid profile: a name, a chat model and a code model, texts where texts belong', () => {
        assert.equal(typeof profile.name, 'string');
        assert.ok(profile.name.trim().length > 0);
        assert.ok(isModelEntry(profile.model), 'model');
        assert.ok(profile.code_model === undefined || isModelEntry(profile.code_model), 'code_model');
        for (const key of ['conversing', 'speak_model']) {
            assert.ok(profile[key] === undefined || typeof profile[key] === 'string', key);
        }
    });

    test('the routing check knows the api of every model of it', () => {
        for (const key of ['model', 'code_model']) {
            if (profile[key] !== undefined) assert.ok(S.apiOf(profile[key]) !== null, `${key}: ${JSON.stringify(profile[key])}`);
        }
    });
});

describe('start-gpt.ps1', () => {
    const text = read('start-gpt.ps1');
    const claude = read('start-claude.ps1');

    test('loads both keys by the names of the vault, with the same lines as start-claude.ps1', () => {
        const load = lines(claude).filter((l) => /Get-Secret/.test(l));
        const remove = lines(claude).filter((l) => /Remove-Item Env:/.test(l));
        assert.equal(load.length, 3); // the two keys and the token of the watch server (v0.1.4.12)
        for (const line of [...load, ...remove]) assert.ok(lines(text).includes(line), line.trim());
        assert.match(text, /Get-Secret -Name OpenaiApiKey -AsPlainText/);
        assert.match(text, /Get-Secret -Name AnthropicsApiKey -AsPlainText/);
    });

    test('a comment says why the Anthropic key is needed', () => {
        const i = lines(text).findIndex((l) => /AnthropicsApiKey/.test(l));
        assert.match(lines(text)[i - 1] + lines(text)[i - 2], /code model[\s\S]*Claude|Claude[\s\S]*code model/);
    });

    test('starts the gpt profile and never names keys.json in its commands', () => {
        assert.match(text, /--profiles \.\/profiles\/gpt\.json/);
        const code = lines(text).filter((l) => !l.trim().startsWith('#')).join('\n');
        assert.doesNotMatch(code, /keys\.json/);
    });
});

describe('test-routing.ps1', () => {
    const text = read('test-routing.ps1');
    const code = lines(text).filter((l) => !l.trim().startsWith('#')).join('\n');

    test('takes -Model and -Profile and passes them to the routing check', () => {
        assert.match(code, /param\(/);
        assert.match(code, /\[string\] \$Model/);
        assert.match(code, /\[Alias\('Profile'\)\]/);
        assert.match(code, /'--model', \$Model/);
        assert.match(code, /'--profile', \$ProfilePath/);
        assert.match(code, /scripts\/routing_check\.js/);
    });

    test('loads the key of the chat model by name (OpenaiApiKey for an OpenAI model, else AnthropicsApiKey), and removes both at the end', () => {
        assert.match(code, /\$env:OPENAI_API_KEY = Get-Secret -Name OpenaiApiKey -AsPlainText -ErrorAction Stop/);
        assert.match(code, /\$env:ANTHROPIC_API_KEY = Get-Secret -Name AnthropicsApiKey -AsPlainText -ErrorAction Stop/);
        assert.match(code, /finally \{[\s\S]*Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue[\s\S]*Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue/);
    });

    test('the other key is loaded too when the vault has it, and set only when it is not empty', () => {
        assert.match(code, /\$other = Get-Secret -Name AnthropicsApiKey -AsPlainText -ErrorAction SilentlyContinue\s+if \(\$other\) \{ \$env:ANTHROPIC_API_KEY = \$other \}/);
        assert.match(code, /\$other = Get-Secret -Name OpenaiApiKey -AsPlainText -ErrorAction SilentlyContinue\s+if \(\$other\) \{ \$env:OPENAI_API_KEY = \$other \}/);
    });

    test('the value of a key is only assigned: no output command names it', () => {
        for (const line of lines(code)) {
            if (/Write-|Out-|echo|Tee-Object/.test(line)) assert.doesNotMatch(line, /API_KEY|Get-Secret/, line.trim());
        }
        assert.doesNotMatch(code, /keys\.json/);
    });
});
