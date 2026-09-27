// Spec S4: src/utils/keyword_rank.js -- STOP_WORDS, tokenize, keywordScore, rankByKeywords.
// Amendment 1, A4 replaces the tokenize rules 6 and 7 of S4 by:
//   6. drop the token if it is a stop word;  7. singular rule;
//   8. drop the token if the result of rule 7 is a stop word;  9. remove duplicates.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { importsOf, importInCleanProcess } from '../helpers/hygiene.js';
import { describeRun } from '../helpers/child.js';

const MODULE = 'src/utils/keyword_rank.js';
const kr = await loadSrc(MODULE);

const EXPECTED_STOP_WORDS = [
    'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'is', 'are', 'be', 'it',
    'this', 'that', 'with', 'as', 'by', 'from', 'please', 'you', 'your', 'me', 'my', 'i', 'can',
    'could', 'would', 'some', 'then', 'if', 'do', 'does', 'will', 'there', 'into', 'up', 'out',
];

// Small deterministic PRNG (mulberry32) for property-style checks.
function prng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('STOP_WORDS', () => {
    test('is exactly the list from the spec, in that order', () => {
        assert.deepEqual([...kr.STOP_WORDS], EXPECTED_STOP_WORDS);
    });

    test('is a frozen array', () => {
        assert.ok(Array.isArray(kr.STOP_WORDS));
        assert.ok(Object.isFrozen(kr.STOP_WORDS));
        assert.throws(() => kr.STOP_WORDS.push('zzz'), TypeError);
    });
});

describe('tokenize', () => {
    test('rule 1: not a string gives []', () => {
        for (const value of [undefined, null, 0, 42, {}, ['collectBlock'], true, Symbol('x')]) {
            assert.deepEqual(kr.tokenize(value), [], String(typeof value));
        }
        assert.deepEqual(kr.tokenize(), []);
    });

    test('empty or separator-only strings give []', () => {
        for (const value of ['', '   ', '\r\n\t', '1234', '...---___', '!!!']) {
            assert.deepEqual(kr.tokenize(value), [], JSON.stringify(value));
        }
    });

    test('returns an array of strings', () => {
        const tokens = kr.tokenize('Collect some oak logs');
        assert.ok(Array.isArray(tokens));
        for (const t of tokens) assert.equal(typeof t, 'string');
    });

    describe('rule 2: case boundaries are separators', () => {
        test('spec example: collectBlock gives collect block', () => {
            assert.deepEqual(kr.tokenize('collectBlock'), ['collect', 'block']);
        });

        test('spec example: goToNearestBlock gives go to nearest block ("to" is then a stop word)', () => {
            assert.deepEqual(kr.tokenize('goToNearestBlock'), ['go', 'nearest', 'block']);
        });

        test('spec example: HTMLParser gives html parser', () => {
            assert.deepEqual(kr.tokenize('HTMLParser'), ['html', 'parser']);
        });

        test('run of capitals followed by capital + lower case: XMLHttpRequest, IOError, getHTMLElement', () => {
            assert.deepEqual(kr.tokenize('XMLHttpRequest'), ['xml', 'http', 'request']);
            assert.deepEqual(kr.tokenize('IOError'), ['io', 'error']);
            assert.deepEqual(kr.tokenize('getHTMLElement'), ['get', 'html', 'element']);
        });

        test('an all-capitals word stays one token: LOUD, OAK', () => {
            assert.deepEqual(kr.tokenize('LOUD OAK'), ['loud', 'oak']);
        });

        test('lower-to-upper boundary splits: placeBlockAt, craftRecipe', () => {
            assert.deepEqual(kr.tokenize('placeBlockAt'), ['place', 'block']);
            assert.deepEqual(kr.tokenize('craftRecipe'), ['craft', 'recipe']);
        });

        test('capitalised word after a capital run: ABCd gives ab cd', () => {
            assert.deepEqual(kr.tokenize('ABCd'), ['ab', 'cd']);
        });
    });

    describe('rule 3: every character that is not a-z or A-Z is a separator', () => {
        test('underscore, dot, hyphen, comma, semicolon, slash, brackets, quotes', () => {
            assert.deepEqual(kr.tokenize('oak_log'), ['oak', 'log']);
            assert.deepEqual(kr.tokenize('skills.collectBlock'), ['skill', 'collect', 'block']);
            assert.deepEqual(kr.tokenize('iron-ore,coal;dirt/sand(stone)"wood"'), ['iron', 'ore', 'coal', 'dirt', 'sand', 'stone', 'wood']);
        });

        test('digits are separators: item2name, wood123planks', () => {
            assert.deepEqual(kr.tokenize('item2name'), ['item', 'name']);
            assert.deepEqual(kr.tokenize('wood123planks'), ['wood', 'plank']);
            assert.deepEqual(kr.tokenize('HTML5Parser'), ['html', 'parser']);
        });

        test('non-ASCII letters are separators too', () => {
            assert.deepEqual(kr.tokenize('blöck'), ['bl', 'ck']);
            assert.deepEqual(kr.tokenize('café'), ['caf']);
            assert.deepEqual(kr.tokenize('Привет'), []);
        });
    });

    test('rule 4: tokens are lower case', () => {
        assert.deepEqual(kr.tokenize('OAK Log STONE'), ['oak', 'log', 'stone']);
        for (const t of kr.tokenize('Collect Oak LOGS From The FOREST')) assert.equal(t, t.toLowerCase());
    });

    test('rule 5: tokens shorter than 2 characters are dropped', () => {
        assert.deepEqual(kr.tokenize('x y z ab'), ['ab']);
        assert.deepEqual(kr.tokenize('aB'), []);
        assert.deepEqual(kr.tokenize('x1y2z3'), []);
    });

    describe('rule 7 (A4, was rule 6): singular rule (longer than 3, ends in s but not ss: drop the s)', () => {
        test('spec examples: logs -> log, blocks -> block, grass stays, gas stays', () => {
            assert.deepEqual(kr.tokenize('logs'), ['log']);
            assert.deepEqual(kr.tokenize('blocks'), ['block']);
            assert.deepEqual(kr.tokenize('grass'), ['grass']);
            assert.deepEqual(kr.tokenize('gas'), ['gas']);
        });

        test('boundary: 4 characters are singularised (axes -> axe, ores -> ore), 3 are not (bus, its)', () => {
            assert.deepEqual(kr.tokenize('axes'), ['axe']);
            assert.deepEqual(kr.tokenize('ores'), ['ore']);
            assert.deepEqual(kr.tokenize('bus'), ['bus']);
            assert.deepEqual(kr.tokenize('its'), ['its']);
        });

        test('ss endings stay: boss, glass, process', () => {
            assert.deepEqual(kr.tokenize('boss glass process'), ['boss', 'glass', 'process']);
        });

        test('only one s is removed and it applies after lower-casing: LOGS -> log, status -> statu', () => {
            assert.deepEqual(kr.tokenize('LOGS'), ['log']);
            assert.deepEqual(kr.tokenize('status'), ['statu']);
        });
    });

    describe('rules 6 and 8 (A4): stop words are dropped BEFORE and AFTER the singular rule', () => {
        test('common stop words disappear', () => {
            assert.deepEqual(kr.tokenize('please can you collect the logs from the tree for me'), ['collect', 'log', 'tree']);
            assert.deepEqual(kr.tokenize('it is up to you and your friends'), ['friend']);
        });

        test('A4 example, rule 6: "this" gives no token (a stop word before the singular rule)', () => {
            assert.deepEqual(kr.tokenize('this'), []);
        });

        test('A4 example, rule 6: "does" gives no token (a stop word before the singular rule)', () => {
            assert.deepEqual(kr.tokenize('does'), []);
        });

        test('A4 example, rule 8: "outs" gives no token (the singular rule makes it "out", a stop word)', () => {
            assert.deepEqual(kr.tokenize('outs'), []);
        });

        test('A4 example, rule 7: "logs" gives "log"', () => {
            assert.deepEqual(kr.tokenize('logs'), ['log']);
        });

        test('A4 example, rule 7: "thesis" gives "thesi" (no stop word before or after the singular rule)', () => {
            assert.deepEqual(kr.tokenize('thesis'), ['thesi']);
        });

        test('rule 6 works after lower-casing and on camelCase parts: THIS, Does, DOES, getThisBlock, doesThisWork', () => {
            assert.deepEqual(kr.tokenize('THIS Does This DOES'), []);
            assert.deepEqual(kr.tokenize('getThisBlock'), ['get', 'block']);
            assert.deepEqual(kr.tokenize('doesThisWork'), ['work']);
        });

        test('rule 8: a plural that becomes a stop word through the singular rule is dropped: outs, thens, ands, wills, cans, yours, intos, thats, pleases', () => {
            assert.deepEqual(kr.tokenize('outs thens ands wills cans yours intos thats pleases'), []);
        });

        test('a word that only CONTAINS a stop word is kept: thesis, theses -> these, thistle, doesnt, outside', () => {
            assert.deepEqual(kr.tokenize('thesis theses thistle doesnt outside'), ['thesi', 'these', 'thistle', 'doesnt', 'outside']);
        });

        test('"thi" and "doe" are ordinary tokens (3 characters, no stop words); only "this" and "does" are dropped', () => {
            assert.deepEqual(kr.tokenize('thi doe'), ['thi', 'doe']);
            assert.deepEqual(kr.tokenize('this thi does doe'), ['thi', 'doe']);
        });

        test('rule 7 needs a single final s: "thiss" and "doess" are not singularised and not stop words', () => {
            assert.deepEqual(kr.tokenize('thiss doess'), ['thiss', 'doess']);
        });

        test('3-letter words ending in s are not singularised, so they are not stop words: ups, ifs', () => {
            assert.deepEqual(kr.tokenize('ups ifs'), ['ups', 'ifs']);
        });

        test('stop words are matched case-insensitively (after lower-casing): THE, And, OR', () => {
            assert.deepEqual(kr.tokenize('THE And OR wood'), ['wood']);
        });

        test('a sentence: "Does this block have logs? This does it." gives block, have, log', () => {
            assert.deepEqual(kr.tokenize('Does this block have logs? This does it.'), ['block', 'have', 'log']);
        });
    });

    test('rule 9 (A4, was rule 8): duplicates removed after both stop word checks, order of first appearance kept', () => {
        assert.deepEqual(kr.tokenize('logs this log does logs'), ['log']);
        assert.deepEqual(kr.tokenize('wood stone wood iron stone'), ['wood', 'stone', 'iron']);
        assert.deepEqual(kr.tokenize('blocks block Block BLOCKS'), ['block']);
        assert.deepEqual(kr.tokenize('iron logs oak log'), ['iron', 'log', 'oak']);
    });

    test('a doc-like text: "skills.collectBlock Collect the nearest blocks of the given type."', () => {
        assert.deepEqual(
            kr.tokenize('skills.collectBlock Collect the nearest blocks of the given type.'),
            ['skill', 'collect', 'block', 'nearest', 'given', 'type'],
        );
    });

    test('each call returns a fresh array (mutating a result does not affect the next call)', () => {
        const first = kr.tokenize('collect oak logs');
        first.push('mutated');
        first[0] = 'changed';
        assert.deepEqual(kr.tokenize('collect oak logs'), ['collect', 'oak', 'log']);
    });

    test('property: output tokens are unique, [a-z]{2,}, not stop words, never "long word ending in single s"', () => {
        const rand = prng(12345);
        const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _.-sS';
        const stop = new Set(EXPECTED_STOP_WORDS);
        for (let n = 0; n < 300; n++) {
            let text = '';
            const len = Math.floor(rand() * 40);
            for (let i = 0; i < len; i++) text += alphabet[Math.floor(rand() * alphabet.length)];
            const tokens = kr.tokenize(text);
            assert.equal(new Set(tokens).size, tokens.length, `duplicates for ${JSON.stringify(text)}`);
            for (const t of tokens) {
                assert.match(t, /^[a-z]{2,}$/, `bad token ${t} for ${JSON.stringify(text)}`);
                assert.ok(!stop.has(t), `stop word ${t} for ${JSON.stringify(text)}`);
                assert.ok(!(t.length > 3 && t.endsWith('s') && !t.endsWith('ss')),
                    `not singularised: ${t}`);
            }
        }
    });
});

describe('keywordScore', () => {
    test('Jaccard index: |intersection| / |union|', () => {
        assert.equal(kr.keywordScore(['a1', 'b1', 'c1'], ['b1', 'c1', 'd1']), 2 / 4);
        assert.equal(kr.keywordScore(['oak', 'log'], ['oak']), 1 / 2);
        assert.equal(kr.keywordScore(['xx', 'yy', 'zz'], ['xx']), 1 / 3);
    });

    test('identical sets give 1, disjoint sets give 0', () => {
        assert.equal(kr.keywordScore(['oak', 'log'], ['log', 'oak']), 1);
        assert.equal(kr.keywordScore(['oak'], ['stone']), 0);
    });

    test('returns 0 if either set is empty (also both)', () => {
        assert.equal(kr.keywordScore([], ['oak']), 0);
        assert.equal(kr.keywordScore(['oak'], []), 0);
        assert.equal(kr.keywordScore([], []), 0);
    });

    test('duplicates inside an input array count once', () => {
        assert.equal(kr.keywordScore(['xx', 'xx', 'yy'], ['xx']), 1 / 2);
        assert.equal(kr.keywordScore(['xx', 'xx'], ['xx']), 1);
        assert.equal(kr.keywordScore(['aa', 'bb'], ['aa', 'aa', 'aa', 'cc', 'cc']), 1 / 3);
    });

    test('is symmetric and always between 0 and 1 (deterministic random sets)', () => {
        const rand = prng(777);
        const vocab = ['oak', 'log', 'stone', 'iron', 'craft', 'block', 'wood', 'plank'];
        for (let n = 0; n < 300; n++) {
            const pick = () => Array.from({ length: Math.floor(rand() * 6) }, () => vocab[Math.floor(rand() * vocab.length)]);
            const a = pick();
            const b = pick();
            const ab = kr.keywordScore(a, b);
            const ba = kr.keywordScore(b, a);
            assert.equal(ab, ba, `symmetry ${a} | ${b}`);
            assert.ok(ab >= 0 && ab <= 1, `bounds ${ab}`);
            if (a.length === 0 || b.length === 0) assert.equal(ab, 0);
        }
    });

    test('does not mutate its inputs', () => {
        const a = ['oak', 'oak', 'log'];
        const b = ['log', 'stone'];
        kr.keywordScore(a, b);
        assert.deepEqual(a, ['oak', 'oak', 'log']);
        assert.deepEqual(b, ['log', 'stone']);
    });
});

describe('rankByKeywords', () => {
    test('empty items give [] (a new array)', () => {
        const items = [];
        const result = kr.rankByKeywords('collect oak', items);
        assert.deepEqual(result, []);
        assert.notEqual(result, items);
    });

    test('one element per item with exactly the keys item, score, index', () => {
        const items = ['collect oak logs', 'craft planks', 'fight zombies'];
        const result = kr.rankByKeywords('oak', items);
        assert.equal(result.length, items.length);
        for (const entry of result) assert.deepEqual(Object.keys(entry).sort(), ['index', 'item', 'score']);
        assert.deepEqual(result.map((r) => r.index).sort(), [0, 1, 2]);
        for (const entry of result) assert.equal(entry.item, items[entry.index]);
    });

    test('score is keywordScore(tokenize(query), tokenize(getText(item)))', () => {
        const items = ['collectBlock oak_log', 'craft planks', 'oak', 'the the the'];
        const query = 'please collect some oak logs';
        for (const entry of kr.rankByKeywords(query, items)) {
            assert.equal(entry.score, kr.keywordScore(kr.tokenize(query), kr.tokenize(items[entry.index])));
        }
    });

    test('sorted by score descending (hand-computed example)', () => {
        // query tokens: collect, oak, log
        // 0 'collectBlock oak_log' -> collect, block, oak, log: 3/4
        // 1 'craft planks'         -> craft, plank: 0
        // 2 'oak'                  -> oak: 1/3
        const result = kr.rankByKeywords('collect oak logs', ['collectBlock oak_log', 'craft planks', 'oak']);
        assert.deepEqual(result, [
            { item: 'collectBlock oak_log', score: 3 / 4, index: 0 },
            { item: 'oak', score: 1 / 3, index: 2 },
            { item: 'craft planks', score: 0, index: 1 },
        ]);
    });

    test('ties are ordered by index ascending (at score 0 and at a positive score)', () => {
        const items = ['zzz', 'oak zeta', 'yyy', 'oak alpha', 'xxx', 'oak'];
        const result = kr.rankByKeywords('oak', items);
        assert.deepEqual(result.map((r) => r.index), [5, 1, 3, 0, 2, 4]);
        assert.deepEqual(result.map((r) => r.score), [1, 1 / 2, 1 / 2, 0, 0, 0]);
    });

    test('a query without tokens (or not a string) scores everything 0 and keeps the input order', () => {
        const items = ['collect oak', 'craft planks', 'fight'];
        for (const query of ['', 'the of and', undefined, null, 42]) {
            const result = kr.rankByKeywords(query, items);
            assert.deepEqual(result.map((r) => r.index), [0, 1, 2], String(query));
            assert.deepEqual(result.map((r) => r.score), [0, 0, 0]);
        }
    });

    test('items is not mutated (a frozen array of frozen objects works) and the result is a new array', () => {
        const items = Object.freeze([
            Object.freeze({ id: 1, text: 'fight zombies' }),
            Object.freeze({ id: 2, text: 'craft planks' }),
            Object.freeze({ id: 3, text: 'craft a crafting table' }),
        ]);
        const snapshot = JSON.stringify(items);
        const result = kr.rankByKeywords('craft', items, (x) => x.text);
        assert.notEqual(result, items);
        assert.equal(JSON.stringify(items), snapshot);
        assert.deepEqual(result.map((r) => r.item.id), [2, 3, 1]);
    });

    test('custom getText is used and item is the original object (same reference)', () => {
        const fight = { name: 'fight', doc: 'attack the nearest zombie' };
        const craft = { name: 'craft', doc: 'craft planks from logs' };
        const result = kr.rankByKeywords('craft planks', [fight, craft], (x) => x.doc);
        assert.equal(result[0].item, craft);
        assert.equal(result[0].index, 1);
        assert.equal(result[1].item, fight);
        assert.equal(result[0].score, kr.keywordScore(kr.tokenize('craft planks'), kr.tokenize(craft.doc)));
    });

    test('default getText is the identity; non-string items simply score 0', () => {
        const result = kr.rankByKeywords('oak', [1, 'oak', null, { oak: true }]);
        assert.deepEqual(result, [
            { item: 'oak', score: 1, index: 1 },
            { item: 1, score: 0, index: 0 },
            { item: null, score: 0, index: 2 },
            { item: result[3].item, score: 0, index: 3 },
        ]);
    });

    test('A4 in ranking: "does" and "this" no longer produce the tokens "doe" and "thi" that made unrelated texts match', () => {
        // query tokens: log, work. Under the old rule order also doe, thi, and both items scored 1/2.
        const result = kr.rankByKeywords('does this log work', ['this does', 'log work']);
        assert.deepEqual(result, [
            { item: 'log work', score: 1, index: 1 },
            { item: 'this does', score: 0, index: 0 },
        ]);
    });

    test('a crafting query ranks a crafting text above a fighting text regardless of input order', () => {
        const items = ['Attack and fight the nearest hostile mob.', 'Craft the given recipe a number of times.'];
        const result = kr.rankByKeywords('craft a wooden recipe', items);
        assert.equal(result[0].index, 1);
        assert.ok(result[0].score > result[1].score);
    });
});

describe('module rules (S4: no imports; S0: importable without side effects)', () => {
    test('has no imports at all', () => {
        const imports = importsOf(MODULE);
        assert.deepEqual(imports.static, []);
        assert.equal(imports.dynamic, 0);
        assert.equal(imports.require, 0);
    });

    test('importing the module prints nothing and creates no files', () => {
        const { run, filesCreated } = importInCleanProcess(MODULE);
        assert.equal(run.status, 0, describeRun(run));
        assert.equal(run.stdout, '', describeRun(run));
        assert.equal(run.stderr, '', describeRun(run));
        assert.deepEqual(filesCreated, []);
    });
});
