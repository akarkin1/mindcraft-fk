// Tests from the spec v0.1.4.14 (tester T1, round 2): SPEC 4.7, what the model does not know. A drift guard between the
// spec and the code: the lines, the header and the numbers are read from docs/releases/0.1.4.14/SPEC.md itself.
//   describe 'SPEC 4.7 the table'   : every `line` of NEW_THINGS appears word for word in the table of part K of SPEC.md, the
//                                     table holds no line the code lacks, and the order is the spec's.
//   describe 'SPEC 4.7 the block'   : NEW_THINGS_LIMIT 3; the header is the text of the spec (SPEC 4.5 D and 4.7); at most
//                                     3 lines and 360 characters; the knowledge block of 600.
//   describe 'SPEC 4.7 the budget'  : every prompt-size test allows 17,400 with the block and holds 17,000 without (read as text).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const N = await loadSrc('src/agent/knowledge/new_things.js');
const K = await loadSrc('src/agent/knowledge/knowledge_text.js');
const SPEC = fs.readFileSync(repoPath('docs/releases/0.1.4.14/SPEC.md'), 'utf8').replace(/\r\n/g, '\n');

// the rows of the table of part K: | names | `line` |
function specLines() {
    const part = SPEC.slice(SPEC.indexOf('### 4.7 Part K'), SPEC.indexOf('**The selection**'));
    return part.split('\n').filter((l) => /^\| .* \| `.*` \|$/.test(l)).map((l) => l.match(/\| `(.*)` \|$/)[1]);
}

describe('SPEC 4.7 the table', () => {
    test('the table of the spec is found: 14 rows', () => {
        assert.equal(specLines().length, 14, specLines().join('\n'));
    });

    test('every line of NEW_THINGS appears word for word in the table of SPEC.md', () => {
        const spec = specLines();
        const missing = N.NEW_THINGS.map((t) => t.line).filter((line) => !spec.includes(line));
        assert.deepEqual(missing, []);
    });

    test('every line of the table is in NEW_THINGS, in the order of the spec', () => {
        assert.deepEqual(N.NEW_THINGS.map((t) => t.line), specLines());
    });
});

describe('SPEC 4.7 the block', () => {
    test('NEW_THINGS_LIMIT is 3; newThingLines gives at most 3 by default', () => {
        assert.equal(N.NEW_THINGS_LIMIT, 3);
        const everything = N.NEW_THINGS.map((t) => t.names[0]);
        assert.equal(N.newThingLines({ inventory: everything }).length, 3);
    });

    test('the header is the text of the spec', () => {
        const header = 'NEW SINCE 1.21.8 (true, even if you do not know it):';
        assert.ok(SPEC.includes(`headed \`${header}\``), 'SPEC 4.7 names the header');
        assert.ok(SPEC.includes(`\`${header}\``), 'SPEC 4.5 D names it');
        assert.equal(K.NEW_THINGS_HEADER, header);
    });

    test('at most 3 lines and 360 characters, whatever is given; the knowledge block stays 600', () => {
        assert.equal(K.NEW_THINGS_MAX_LINES, 3);
        assert.equal(K.NEW_THINGS_MAX_CHARS, 360);
        assert.equal(K.KNOWLEDGE_MAX_CHARS, 600);
        const all = N.NEW_THINGS.map((t) => t.line);
        for (let i = 0; i < all.length; i++) {
            const lines = [...all.slice(i), ...all.slice(0, i)];
            const block = K.newThingsText(lines);
            assert.ok(block.length <= 360, `${block.length}`);
            assert.ok(block.split('\n').length <= 4, 'the header and 3 lines');
            assert.ok(block.startsWith(`${K.NEW_THINGS_HEADER}\n`));
        }
    });
});

describe('SPEC 4.7 the budget', () => {
    const files = fs.readdirSync(repoPath('tests/unit')).filter((f) => f.endsWith('.test.js') && !f.startsWith('xt26_'))
        .filter((f) => /const LIMIT_NEW_THINGS = /.test(fs.readFileSync(repoPath(`tests/unit/${f}`), 'utf8')));

    test('the prompt-size tests are found, gjg_prompt and stg_prompt among them', () => {
        assert.ok(files.includes('gjg_prompt.test.js') && files.includes('stg_prompt.test.js'), files.join(', '));
    });

    test('each allows 17,400 with the block of the new things and holds 17,000 without it', () => {
        for (const f of files) {
            const src = fs.readFileSync(repoPath(`tests/unit/${f}`), 'utf8');
            assert.match(src, /const LIMIT_NEW_THINGS = 17400;/, f);
            const allOn = src.match(/const LIMIT_ALL_ON = (\d+);/);
            if (allOn) assert.equal(allOn[1], '17000', f);
            assert.match(src, /\.length <= (LIMIT_ALL_ON|17000), 'without the block of the new things'\)/, `${f}: the old limit without the block`);
            assert.doesNotMatch(src, /LIMIT_ALL_ON = (?!17000;)\d+/, f);
        }
    });

    test('stg_prompt: LIMIT_ALL_ON 17000 and LIMIT_NEW_THINGS 17400', () => {
        const src = fs.readFileSync(repoPath('tests/unit/stg_prompt.test.js'), 'utf8');
        assert.match(src, /^const LIMIT_ALL_ON = 17000;$/m);
        assert.match(src, /^const LIMIT_NEW_THINGS = 17400;$/m);
    });
});
