// Spec S4: src/agent/library/index.js -- docHelper(functions, module_name).
//
// The test functions below are real function declarations with doc blocks inside the
// body, like skills.js. Their source may be checked out with CRLF line endings
// (core.autocrlf=true), so outputs are compared after normalising CRLF to LF.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const index = await loadSrc('src/agent/library/index.js');
const skills = await loadSrc('src/agent/library/skills.js');
const world = await loadSrc('src/agent/library/world.js');

const lf = (s) => (typeof s === 'string' ? s.replace(/\r\n/g, '\n') : s);
const entries = (fns, mod = 'mod') => index.docHelper(fns, mod).map(lf);

// The docHelper of v0.1.4.1, copied verbatim, as the reference for "for every function
// whose doc closes with **/ the entry is identical to what the current code produces".
function oldDocHelper(functions, module_name) {
    let docArray = [];
    for (let skillFunc of functions) {
        let str = skillFunc.toString();
        if (str.includes('/**')) {
            let docEntry = `${module_name}.${skillFunc.name}\n`;
            docEntry += str.substring(str.indexOf('/**') + 3, str.indexOf('**/')).trim();
            docArray.push(docEntry);
        }
    }
    return docArray;
}

// True when the first "*/" after the first "/**" is part of a "**/".
function closesWithStarStarSlash(fn) {
    const str = fn.toString();
    const open = str.indexOf('/**');
    if (open < 0) return false;
    const close = str.indexOf('*/', open + 3);
    return close > open + 3 && str[close - 1] === '*';
}

/* eslint-disable no-unused-vars */
function starStarSlash(bot, count) {
    /**
     * Collect the given block.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if done.
     **/
    return count;
}

function starSlash(name) {
    /**
     * Check if a given name is valid.
     * @param {string} name - The name.
     */
    return name;
}

function noDoc(x) {
    // line comment
    /* block comment, not a doc */
    return x;
}

function unterminated() {
    const marker = '/**';
    return marker;
}

function oneLineStarSlash() { /** Short doc. */ return 1; }

function oneLineStarStarSlash() { /** Short doc two. **/ return 2; }

function emptyDoc() {
    /** **/
    return 0;
}

function twoDocs() {
    /**
     * First doc.
     **/
    /**
     * Second doc.
     **/
    return 2;
}

function mixedDocs() {
    /**
     * First doc.
     */
    /**
     * Second doc.
     **/
    return 3;
}

function commentInParams(a /* not a doc */, b) {
    /**
     * Real doc.
     */
    return a + b;
}

async function asyncStarStarSlash(bot) {
    /**
     * Async doc.
     * @param {MinecraftBot} bot
     **/
    return bot;
}

async function asyncStarSlash(bot) {
    /**
     * Async doc two.
     */
    return bot;
}
/* eslint-enable no-unused-vars */

describe('docHelper', () => {
    test('doc closing with **/: the trailing * is removed and the text trimmed', () => {
        assert.deepEqual(entries([starStarSlash]), [
            'mod.starStarSlash\n* Collect the given block.\n     * @param {MinecraftBot} bot, reference to the minecraft bot.\n     * @returns {Promise<boolean>} true if done.',
        ]);
    });

    test('doc closing with */: the text up to */ is used and trimmed', () => {
        assert.deepEqual(entries([starSlash]), [
            'mod.starSlash\n* Check if a given name is valid.\n     * @param {string} name - The name.',
        ]);
    });

    test('one-line docs with */ and with **/', () => {
        assert.deepEqual(entries([oneLineStarSlash, oneLineStarStarSlash]), [
            'mod.oneLineStarSlash\nShort doc.',
            'mod.oneLineStarStarSlash\nShort doc two.',
        ]);
    });

    test('no /** in the function: the function is skipped', () => {
        assert.deepEqual(entries([noDoc]), []);
    });

    test('/** without a following */ (unterminated): the function is skipped', () => {
        assert.deepEqual(entries([unterminated]), []);
    });

    test('entry format is `${module_name}.${fn.name}` + "\\n" + doc text', () => {
        assert.deepEqual(entries([oneLineStarStarSlash], 'world'), ['world.oneLineStarStarSlash\nShort doc two.']);
        assert.deepEqual(entries([oneLineStarStarSlash], 'skills'), ['skills.oneLineStarStarSlash\nShort doc two.']);
        assert.deepEqual(entries([asyncStarStarSlash], 'custom_module'), ['custom_module.asyncStarStarSlash\n* Async doc.\n     * @param {MinecraftBot} bot']);
    });

    test('the first doc block wins (two **/ docs)', () => {
        assert.deepEqual(entries([twoDocs]), ['mod.twoDocs\n* First doc.']);
    });

    test('the first doc block wins (first closes with */, second with **/)', () => {
        assert.deepEqual(entries([mixedDocs]), ['mod.mixedDocs\n* First doc.']);
    });

    test('the terminator is searched AFTER the /** (a */ in the parameter list is ignored)', () => {
        assert.deepEqual(entries([commentInParams]), ['mod.commentInParams\n* Real doc.']);
    });

    test('async functions are documented like normal ones (**/ and */)', () => {
        assert.deepEqual(entries([asyncStarStarSlash, asyncStarSlash]), [
            'mod.asyncStarStarSlash\n* Async doc.\n     * @param {MinecraftBot} bot',
            'mod.asyncStarSlash\n* Async doc two.',
        ]);
    });

    test('an empty **/ doc gives the name line and an empty doc text (as the old code did)', () => {
        assert.deepEqual(entries([emptyDoc]), ['mod.emptyDoc\n']);
    });

    test('keeps the order of the input and skips undocumented functions', () => {
        assert.deepEqual(
            entries([noDoc, starStarSlash, unterminated, oneLineStarSlash, asyncStarSlash]).map((e) => e.split('\n')[0]),
            ['mod.starStarSlash', 'mod.oneLineStarSlash', 'mod.asyncStarSlash'],
        );
    });

    test('an empty list gives []', () => {
        assert.deepEqual(index.docHelper([], 'mod'), []);
    });

    test('no entry ever contains */ or the function header', () => {
        const all = entries([starStarSlash, starSlash, oneLineStarSlash, oneLineStarStarSlash, twoDocs, mixedDocs,
            commentInParams, asyncStarStarSlash, asyncStarSlash, emptyDoc, noDoc, unterminated]);
        for (const entry of all) {
            assert.ok(!entry.includes('*/'), entry);
            assert.ok(!entry.split('\n')[1].includes('function '), entry);
        }
    });

    test('**/ docs defined here: identical to the v0.1.4.1 docHelper', () => {
        const fns = [starStarSlash, oneLineStarStarSlash, twoDocs, asyncStarStarSlash, emptyDoc];
        for (const fn of fns) {
            assert.ok(closesWithStarStarSlash(fn), `precondition for ${fn.name}`);
            assert.deepEqual(index.docHelper([fn], 'skills'), oldDocHelper([fn], 'skills'), fn.name);
        }
    });

    test('**/ docs of the real skills.js and world.js: identical to the v0.1.4.1 docHelper', () => {
        let checked = 0;
        for (const [modName, mod] of [['skills', skills], ['world', world]]) {
            for (const fn of Object.values(mod)) {
                if (typeof fn !== 'function' || !closesWithStarStarSlash(fn)) continue;
                assert.deepEqual(index.docHelper([fn], modName), oldDocHelper([fn], modName), `${modName}.${fn.name}`);
                checked++;
            }
        }
        assert.ok(checked >= 40, `expected most functions to use **/, checked ${checked}`);
    });
});
