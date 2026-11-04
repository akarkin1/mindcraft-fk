// Tests from the spec v0.1.4.14 (tester T1, round 2): the rules 24 to 27 of SPEC 0, where a unit test can prove them.
//   describe 'rule 26: no literal id in src/' : no file under src/ compares a registry lookup (blocksByName, itemsByName,
//                                               entitiesByName ... .id), a block or item type, or a held item's type with a
//                                               number literal, indexes a registry table by a number literal, or writes
//                                               harvest tools with numeric keys.
//   describe 'rule 26: the tests take ids by name' : no unit test or helper writes a literal block or item id in the
//                                               shapes the spec names (`type: 892`, `harvestTools: { 721: true }`).
//   describe 'rule 27: the patches are applied' : every hunk of every patch, as it reads after the patch (context and
//                                               added lines in order), is a block of the installed file.
//   describe 'rule 25 and SPEC 2: one switch'  : the only new setting is new_things_in_prompt, a boolean off by default in
//                                               settings_spec.json; the upgrade has none.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoPath } from '../helpers/paths.js';

function jsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...jsFiles(p)); }
        else if (/\.(c|m)?js$/.test(entry.name)) out.push(p);
    }
    return out;
}

// strips // and /* */ comments well enough for a grep (a URL in a string keeps its //: the patterns below need code)
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const SRC_PATTERNS = [
    ['a registry lookup compared with a number', /(blocksByName|itemsByName|entitiesByName|blocks|items)\b[^;\n]{0,60}\.id\s*[!=]==?\s*\d+\b/],
    ['a number compared with a registry lookup', /\b\d+\s*[!=]==?\s*[^;\n]{0,40}(blocksByName|itemsByName|entitiesByName)/],
    ['a block or item type compared with a number', /\.(type|blockId|itemId|stateId|blockStateId)\s*[!=]==?\s*\d+\b/],
    ['a number compared with a block or item type', /\b\d+\s*[!=]==?\s*[\w.?]+\.(type|blockId|itemId|stateId)\b/],
    ['a registry table indexed by a number', /\b(registry|mcData|mcdata|mc_data|minecraftData|data)\.(blocks|items|entities|blockStates|foods)\s*\[\s*\d+\s*\]/],
    ['harvest tools with a numeric key', /harvestTools[^;\n]{0,40}[{,]\s*['"]?\d+['"]?\s*:/],
    ['an id of a type written as a number', /\b(blockType|itemType|blockId|itemId)\s*[:=]\s*\d{2,}\b/],
];

describe('rule 26: no literal id in src/', () => {
    const files = jsFiles(repoPath('src'));

    test('src/ is read: more than 100 files', () => {
        assert.ok(files.length > 100, `${files.length}`);
    });

    for (const [what, pattern] of SRC_PATTERNS) {
        test(`no ${what}`, () => {
            const hits = [];
            for (const file of files) {
                code(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
                    if (pattern.test(line)) hits.push(`${path.relative(repoPath('.'), file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
                });
            }
            assert.deepEqual(hits, []);
        });
    }

    test('the patterns find what they are for (a self-check on made-up lines)', () => {
        const bad = ['if (block.type === 892) {', 'harvestTools: { 721: true }', 'bot.registry.items[721]', "mcData.blocksByName.stone.id === 1",
            'if (held?.type == 845) x()'];
        for (const line of bad) assert.ok(SRC_PATTERNS.some(([, p]) => p.test(line)), line);
        const good = ['if (blocks[0]) {', "if (block.name === 'stone') {", 'const id = registry.itemsByName[name]?.id;', 'if (list.length === 0) {'];
        for (const line of good) assert.ok(!SRC_PATTERNS.some(([, p]) => p.test(line)), line);
    });
});

describe('rule 26: the tests take ids by name', () => {
    test('no unit test or helper writes `type: <id>` for an item or block, or harvest tools by number', () => {
        const hits = [];
        const files = [...jsFiles(repoPath('tests/unit')), ...jsFiles(repoPath('tests/helpers'))];
        for (const file of files) {
            if (path.basename(file) === 'xt26_rules.test.js') continue;
            code(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
                if (/harvestTools\s*:\s*\{\s*['"]?\d+['"]?\s*:/.test(line) || /\{[^{}]*\bname:\s*'[a-z_]+'[^{}]*\btype:\s*\d{2,}/.test(line)
                    || /\{[^{}]*\btype:\s*\d{2,}[^{}]*\bname:\s*'[a-z_]+'/.test(line)) hits.push(`${path.relative(repoPath('.'), file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
            });
        }
        assert.deepEqual(hits, []);
    });
});

describe('rule 27: the patches are applied', () => {
    const patches = fs.readdirSync(repoPath('patches')).filter((f) => f.endsWith('.patch'));

    for (const name of patches) {
        test(`${name}: every hunk is applied in node_modules`, () => {
            const text = fs.readFileSync(repoPath(`patches/${name}`), 'utf8').replace(/\r\n/g, '\n');
            assert.equal(text.includes('\r'), false, 'LF');
            const missing = [];
            for (const part of text.split(/^diff --git /m).slice(1)) {
                const file = part.match(/^a\/(\S+)/)[1];
                assert.ok(fs.existsSync(repoPath(file)), file);
                const installed = fs.readFileSync(repoPath(file), 'utf8').replace(/\r\n/g, '\n');
                // each hunk after the patch (its context and its added lines, in order) is a block of the installed file
                for (const hunk of part.split(/^@@[^\n]*\n/m).slice(1)) {
                    const lines = hunk.split('\n').filter((l) => /^[ +-]/.test(l) || l === '');
                    while (lines.length && lines.at(-1) === '') lines.pop();
                    const after = lines.filter((l) => !l.startsWith('-')).map((l) => l.slice(1)).join('\n');
                    if (!installed.includes(after)) missing.push(`${file}: the hunk is not applied: ${after.slice(0, 120)}`);
                }
            }
            assert.deepEqual(missing, []);
        });
    }
});

describe('rule 25 and SPEC 2: one switch', () => {
    test('new_things_in_prompt: a boolean, off by default, in settings_spec.json and settings.js', () => {
        const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
        assert.equal(spec.new_things_in_prompt.type, 'boolean');
        assert.equal(spec.new_things_in_prompt.default, false);
        assert.match(fs.readFileSync(repoPath('settings.js'), 'utf8'), /^\s*"new_things_in_prompt": (true|false),/m, 'a key of settings.js');
    });

    test('no setting names the version, the libraries or the data of 26.1', () => {
        const spec = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
        const keys = Object.keys(spec).filter((k) => /26_?1|1_21|copper|bucket|knockback|lpvec|velocity|dig_fix|upgrade/i.test(k));
        assert.deepEqual(keys, []);
    });
});
