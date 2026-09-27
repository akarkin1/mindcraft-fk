// Spec S4: getSkillDocs() over the real src/agent/library/skills.js and world.js.
//
// "Every exported function must have a doc block INSIDE its body as the first statement.
//  Acceptance: getSkillDocs() returns one entry for every exported function of both modules.
//  No entry contains the text `function ` in its second line, and no entry contains `*/`."
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const index = await loadSrc('src/agent/library/index.js');
const skills = await loadSrc('src/agent/library/skills.js');
const world = await loadSrc('src/agent/library/world.js');

const MODULES = [['skills', skills], ['world', world]];

function exportedFunctions() {
    const list = [];
    for (const [modName, mod] of MODULES) {
        for (const [exportName, value] of Object.entries(mod)) {
            if (typeof value === 'function') list.push({ modName, exportName, fn: value, key: `${modName}.${exportName}` });
        }
    }
    return list;
}

const firstLine = (entry) => entry.split('\n')[0];

describe('getSkillDocs (real skills.js and world.js)', () => {
    test('both modules export only functions (precondition of the checks below)', () => {
        for (const [modName, mod] of MODULES) {
            for (const [name, value] of Object.entries(mod)) {
                assert.equal(typeof value, 'function', `${modName}.${name}`);
            }
        }
    });

    test('export names equal function names (entries use fn.name)', () => {
        for (const { key, exportName, fn } of exportedFunctions()) assert.equal(fn.name, exportName, key);
    });

    test('every exported function has EXACTLY one entry', () => {
        const docs = index.getSkillDocs();
        const counts = new Map();
        for (const entry of docs) counts.set(firstLine(entry), (counts.get(firstLine(entry)) || 0) + 1);
        const missing = [];
        const duplicated = [];
        for (const { key } of exportedFunctions()) {
            const n = counts.get(key) || 0;
            if (n === 0) missing.push(key);
            if (n > 1) duplicated.push(key);
        }
        assert.deepEqual(missing, [], `functions without a doc entry: ${missing.join(', ')}`);
        assert.deepEqual(duplicated, [], `functions with more than one entry: ${duplicated.join(', ')}`);
    });

    test('there are no extra entries: entry count equals the number of exported functions', () => {
        assert.equal(index.getSkillDocs().length, exportedFunctions().length);
    });

    test('known gaps of v0.1.4.1 are documented now', () => {
        const names = new Set(index.getSkillDocs().map(firstLine));
        const gaps = [
            'skills.log', 'skills.showVillagerTrades', 'skills.tradeWithVillager',
            'world.getNearbyEntities', 'world.getNearestEntityWhere', 'world.getNearbyPlayers',
            'world.getVillagerProfession', 'world.shouldPlaceTorch',
        ];
        assert.deepEqual(gaps.filter((g) => !names.has(g)), []);
    });

    test('each entry starts with "skills." or "world." plus the function name as its whole first line', () => {
        const valid = new Set(exportedFunctions().map((f) => f.key));
        for (const entry of index.getSkillDocs()) {
            assert.match(entry, /^(skills|world)\.[A-Za-z_$][\w$]*\n/, JSON.stringify(entry.slice(0, 60)));
            assert.ok(valid.has(firstLine(entry)), `unknown entry ${firstLine(entry)}`);
        }
    });

    test('shape unchanged: all skills entries first, then all world entries', () => {
        const prefixes = index.getSkillDocs().map((e) => firstLine(e).split('.')[0]);
        const firstWorld = prefixes.indexOf('world');
        assert.ok(firstWorld > 0);
        assert.ok(prefixes.slice(0, firstWorld).every((p) => p === 'skills'));
        assert.ok(prefixes.slice(firstWorld).every((p) => p === 'world'));
    });

    test('no entry has "function " in its second line', () => {
        const bad = index.getSkillDocs().filter((e) => (e.split('\n')[1] ?? '').includes('function ')).map(firstLine);
        assert.deepEqual(bad, []);
    });

    test('no entry contains "*/"', () => {
        const bad = index.getSkillDocs().filter((e) => e.includes('*/')).map(firstLine);
        assert.deepEqual(bad, []);
    });

    test('every entry has a non-empty description line', () => {
        const bad = index.getSkillDocs().filter((e) => (e.split('\n')[1] ?? '').replace(/^\s*\*\s*/, '').trim() === '').map(firstLine);
        assert.deepEqual(bad, []);
    });

    test('every exported function has its doc block INSIDE the body, as the first statement', () => {
        const bad = [];
        for (const { key, fn } of exportedFunctions()) {
            const src = fn.toString();
            const open = src.indexOf('/**');
            if (open < 0) {
                bad.push(`${key}: no /**`);
                continue;
            }
            // Only whitespace between the opening brace of the body and the doc block.
            const before = src.slice(0, open).trimEnd();
            if (!before.endsWith('{')) bad.push(`${key}: doc is not the first statement`);
            // The doc must start after the parameter list: the header before it contains ")".
            if (!before.includes(')')) bad.push(`${key}: doc before the parameter list`);
        }
        assert.deepEqual(bad, []);
    });
});
