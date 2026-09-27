// Spec S4: src/agent/library/skill_library.js -- initSkillLibrary(docs) and getRelevantSkillDocs.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { captureConsole } from '../helpers/console_capture.js';

const lib = await loadSrc('src/agent/library/skill_library.js');
const index = await loadSrc('src/agent/library/index.js');

const HEADER = '#### RELEVANT CODE DOCS ###\nThe following functions are available to use:\n';
const render = (docs) => HEADER + docs.join('\n### ');

// Injected docs, shaped like getSkillDocs() entries. docSearchText of each (first line up
// to the first @param/@returns/@return/@example line, joined with a space) and its tokens:
//   ATTACK  skill attack nearest fight mob given type
//   CRAFT   skill craft recipe given number time
//   SMELT   skill smelt item put furnace them fuel
//   NEAREST world get nearest block given type
//   CHAT    skill send chat message other player
//   FISH    skill go fishing cast rod catch fish
//   PLACE   skill place block given type position
//   WAIT    skill wait given number millisecond
//   BREAK   skill break block given position
const ATTACK = 'skills.attackNearest\nAttack and fight the nearest mob of the given type.\n@param {MinecraftBot} bot\n@param {string} mobType, the type of mob to attack.\n@returns {Promise<boolean>} true if the mob was killed.';
const CRAFT = 'skills.craftRecipe\nCraft the given recipe a given number of times.\n@param {MinecraftBot} bot, reference to the minecraft bot.\n@param {string} itemName, the item name to craft.\n@returns {Promise<boolean>} true if the recipe was crafted.\n@example\nawait skills.craftRecipe(bot, "stick");';
const SMELT = 'skills.smeltItem\nPut items in a furnace and smelt them with fuel.\n@param {MinecraftBot} bot\n@param {string} itemName, the item to smelt.';
const NEAREST = 'world.getNearestBlock\nGet the nearest block of the given type.\n@param {MinecraftBot} bot';
const CHAT = 'skills.sendChatMessage\nSend a chat message to other players.\n@param {MinecraftBot} bot';
const FISH = 'skills.goFishing\nCast the rod and catch a fish.\n@param {MinecraftBot} bot';
const PLACE = 'skills.placeBlock\nPlace the given block type at the given position.\n@param {MinecraftBot} bot';
const WAIT = 'skills.wait\nWaits for the given number of milliseconds.\n@param {MinecraftBot} bot';
const BREAK = 'skills.breakBlockAt\nBreak the block at the given position.\n@param {MinecraftBot} bot';

const DOCS = [ATTACK, CRAFT, SMELT, NEAREST, CHAT, FISH, PLACE, WAIT, BREAK];
const ALWAYS = [PLACE, WAIT, BREAK];
const CRAFT_QUERY = 'craft some planks'; // tokens: craft, plank -> only CRAFT scores > 0

let consoleCapture;
beforeEach(() => {
    consoleCapture = captureConsole();
});
afterEach(() => {
    consoleCapture.restore();
});

async function makeLibrary(docs, embeddingModel = null) {
    const library = new lib.SkillLibrary({}, embeddingModel);
    await library.initSkillLibrary(docs);
    return library;
}

// Deterministic fake embedding model: 3-dimensional one-hot vectors.
//   text mentions "attack" or "zebra" -> [1, 0, 0]
//   text mentions "craft"             -> [0, 1, 0]
//   anything else                     -> [0, 0, 1]
function fakeEmbedder() {
    const calls = [];
    return {
        calls,
        async embed(text) {
            calls.push(text);
            if (/attack|zebra/i.test(text)) return [1, 0, 0];
            if (/craft/i.test(text)) return [0, 1, 0];
            return [0, 0, 1];
        },
    };
}

function assertNoDuplicates(output) {
    const body = output.slice(HEADER.length);
    const parts = body === '' ? [] : body.split('\n### ');
    assert.equal(new Set(parts).size, parts.length, 'no doc appears twice');
}

describe('initSkillLibrary', () => {
    test('initSkillLibrary(docs) uses the injected docs', async () => {
        const library = await makeLibrary(DOCS);
        assert.deepEqual(library.skill_docs, DOCS);
        assert.deepEqual(await library.getAllSkillDocs(), DOCS);
    });

    test('without argument it still uses getSkillDocs()', async () => {
        const library = new lib.SkillLibrary({}, null);
        await library.initSkillLibrary();
        assert.deepEqual(library.skill_docs, index.getSkillDocs());
    });

    test('a working embedding model gets an embedding for every doc', async () => {
        const model = fakeEmbedder();
        const library = await makeLibrary(DOCS, model);
        assert.equal(library.embedding_model, model);
        for (const doc of DOCS) assert.ok(Array.isArray(library.skill_docs_embeddings[doc]), doc.split('\n')[0]);
    });

    test('embed rejecting (3rd call): embedding_model becomes null AND skill_docs_embeddings is reset to {}', async () => {
        let n = 0;
        const model = {
            async embed() {
                n++;
                if (n === 3) throw new Error('embedding API down');
                return [1, 2, 3];
            },
        };
        const library = await makeLibrary(DOCS, model);
        assert.equal(library.embedding_model, null);
        assert.deepEqual(library.skill_docs_embeddings, {});
    });

    test('embed throwing synchronously: embedding_model null, skill_docs_embeddings {}, no throw', async () => {
        const model = {
            embed() {
                throw new Error('sync failure');
            },
        };
        const library = await makeLibrary(DOCS, model);
        assert.equal(library.embedding_model, null);
        assert.deepEqual(library.skill_docs_embeddings, {});
    });
});

describe('getRelevantSkillDocs without embedding model (keyword ranking)', () => {
    test('output header and separator are exactly as before', async () => {
        const library = await makeLibrary(DOCS);
        const out = await library.getRelevantSkillDocs(CRAFT_QUERY, 1);
        assert.ok(out.startsWith(HEADER));
        assert.equal(out, render([CRAFT, ...ALWAYS]));
    });

    test('select_num === -1: all docs in the order of skill_docs', async () => {
        const library = await makeLibrary(DOCS);
        assert.equal(await library.getRelevantSkillDocs(CRAFT_QUERY, -1), render(DOCS));
    });

    test('select_num === 0: no ranked docs, only the always-show docs', async () => {
        const library = await makeLibrary(DOCS);
        assert.equal(await library.getRelevantSkillDocs(CRAFT_QUERY, 0), render(ALWAYS));
    });

    test('select_num === 0 and no always-show doc exists: just the header', async () => {
        const library = await makeLibrary([ATTACK, CRAFT]);
        assert.equal(await library.getRelevantSkillDocs(CRAFT_QUERY, 0), HEADER);
    });

    test('select_num === 1: the best keyword match, then the always-show docs', async () => {
        const library = await makeLibrary(DOCS);
        assert.equal(await library.getRelevantSkillDocs(CRAFT_QUERY, 1), render([CRAFT, ...ALWAYS]));
    });

    test('select_num === 5: top 5 by score, ties by index, then the always-show docs', async () => {
        const library = await makeLibrary(DOCS);
        assert.equal(
            await library.getRelevantSkillDocs(CRAFT_QUERY, 5),
            render([CRAFT, ATTACK, SMELT, NEAREST, CHAT, ...ALWAYS]),
        );
    });

    test('select_num equal to the doc count: all docs in ranking order, none twice', async () => {
        const library = await makeLibrary(DOCS);
        const out = await library.getRelevantSkillDocs(CRAFT_QUERY, DOCS.length);
        assert.equal(out, render([CRAFT, ATTACK, SMELT, NEAREST, CHAT, FISH, PLACE, WAIT, BREAK]));
    });

    test('select_num larger than the doc count means all docs', async () => {
        const library = await makeLibrary(DOCS);
        const out = await library.getRelevantSkillDocs(CRAFT_QUERY, 50);
        assert.equal(out, render([CRAFT, ATTACK, SMELT, NEAREST, CHAT, FISH, PLACE, WAIT, BREAK]));
    });

    test('an always-show doc that is already selected is not appended again', async () => {
        const library = await makeLibrary(DOCS);
        const out = await library.getRelevantSkillDocs('wait milliseconds', 1);
        assert.equal(out, render([WAIT, PLACE, BREAK]));
        assertNoDuplicates(out);
    });

    test('always-show docs that do not exist are not appended', async () => {
        const library = await makeLibrary([ATTACK, CRAFT]);
        assert.equal(await library.getRelevantSkillDocs(CRAFT_QUERY, 1), render([CRAFT]));
    });

    test('ranking depends on the message: crafting query -> crafting doc, fighting query -> fighting doc', async () => {
        const library = await makeLibrary([ATTACK, CRAFT]);
        assert.equal(await library.getRelevantSkillDocs('craft a wooden pickaxe', 1), render([CRAFT]));
        assert.equal(await library.getRelevantSkillDocs('craft a wooden pickaxe', 2), render([CRAFT, ATTACK]));
        assert.equal(await library.getRelevantSkillDocs('attack the zombie', 1), render([ATTACK]));
        assert.equal(await library.getRelevantSkillDocs('fight that mob', 2), render([ATTACK, CRAFT]));
    });

    for (const falsy of ['', null, undefined]) {
        test(`falsy message (${JSON.stringify(falsy) ?? 'undefined'}) is replaced by "(no message)"`, async () => {
            // "(no message)" tokenizes to: no, message -> only CHAT scores > 0
            const library = await makeLibrary(DOCS);
            assert.equal(await library.getRelevantSkillDocs(falsy, 1), render([CHAT, ...ALWAYS]));
        });
    }

    test('no doc appears twice for any select_num', async () => {
        const library = await makeLibrary(DOCS);
        for (const n of [-1, 0, 1, 2, 5, 8, 9, 10, 100]) {
            assertNoDuplicates(await library.getRelevantSkillDocs('wait for the block', n));
        }
    });

    describe('docSearchText: first line up to (not including) the first @param/@returns/@return/@example line', () => {
        const YAK = 'skills.yak\nFeed the animals.';
        for (const marker of ['@param {string} x', '@returns {boolean}', '@return {boolean}', '@example']) {
            test(`text from the "${marker.split(' ')[0]}" line on is ignored, also on later lines`, async () => {
                // Only the ignored part of XRAY mentions zebra. If it counted, XRAY would win.
                const XRAY = `skills.xray\nLook around.\n     * ${marker} zebra zebra\nzebra zebra zebra`;
                const library = await makeLibrary([YAK, XRAY]);
                assert.equal(await library.getRelevantSkillDocs('zebra', 1), render([YAK]));
            });
        }

        test('the first line (the function name) is part of the search text', async () => {
            const QUARRY = 'skills.quarryStone\nDig things.\n@param {MinecraftBot} bot';
            const library = await makeLibrary([YAK, QUARRY]);
            assert.equal(await library.getRelevantSkillDocs('quarry', 1), render([QUARRY]));
        });

        test('every description line before the first marker counts', async () => {
            const MULTI = 'skills.multi\nFirst line.\nSecond line mentions zebra.\n@param {MinecraftBot} bot';
            const library = await makeLibrary([YAK, MULTI]);
            assert.equal(await library.getRelevantSkillDocs('zebra', 1), render([MULTI]));
        });

        test('lines are joined with a space (name line and a lower-case description stay separate words)', async () => {
            const GAMMA = 'skills.alpha\ngamma rays here.\n@param {MinecraftBot} bot';
            const library = await makeLibrary([YAK, GAMMA]);
            assert.equal(await library.getRelevantSkillDocs('gamma', 1), render([GAMMA]));
        });
    });
});

describe('getRelevantSkillDocs with an embedding model', () => {
    const EMB_DOCS = [CRAFT, ATTACK, SMELT, PLACE, WAIT, BREAK];

    test('all embeddings present: cosine similarity decides (zebra -> ATTACK, keyword order would give CRAFT)', async () => {
        const model = fakeEmbedder();
        const library = await makeLibrary(EMB_DOCS, model);
        assert.equal(await library.getRelevantSkillDocs('zebra', 1), render([ATTACK, ...ALWAYS]));
        assert.ok(model.calls.includes('zebra'), 'the message is embedded');
    });

    test('select_num === -1: all docs in skill_docs order, whatever the embedding state', async () => {
        const library = await makeLibrary(EMB_DOCS, fakeEmbedder());
        assert.equal(await library.getRelevantSkillDocs('zebra', -1), render(EMB_DOCS));
    });

    test('select_num === 0: only the always-show docs', async () => {
        const library = await makeLibrary(EMB_DOCS, fakeEmbedder());
        assert.equal(await library.getRelevantSkillDocs('zebra', 0), render(ALWAYS));
    });

    test('select_num larger than the doc count: every doc exactly once, best match first', async () => {
        const library = await makeLibrary(EMB_DOCS, fakeEmbedder());
        const out = await library.getRelevantSkillDocs('zebra', 50);
        const parts = out.slice(HEADER.length).split('\n### ');
        assert.equal(parts[0], ATTACK);
        assert.deepEqual([...parts].sort(), [...EMB_DOCS].sort());
    });

    test('falsy message: "(no message)" is what gets embedded', async () => {
        const model = fakeEmbedder();
        const library = await makeLibrary(EMB_DOCS, model);
        model.calls.length = 0;
        await library.getRelevantSkillDocs('', 1);
        assert.ok(model.calls.includes('(no message)'), JSON.stringify(model.calls));
    });

    test('an embedding missing for any doc: keyword ranking is used instead', async () => {
        const library = await makeLibrary(EMB_DOCS, fakeEmbedder());
        delete library.skill_docs_embeddings[SMELT];
        // keyword scores for "zebra" are all 0 -> index order -> CRAFT first
        assert.equal(await library.getRelevantSkillDocs('zebra', 1), render([CRAFT, ...ALWAYS]));
        assert.equal(await library.getRelevantSkillDocs(CRAFT_QUERY, 2), render([CRAFT, ATTACK, ...ALWAYS]));
    });

    test('after the embedding model failed during init, keyword ranking is used', async () => {
        const model = {
            async embed(text) {
                if (/smelt/i.test(text)) throw new Error('boom');
                return [1, 0, 0];
            },
        };
        const library = await makeLibrary(EMB_DOCS, model);
        assert.equal(library.embedding_model, null);
        assert.equal(await library.getRelevantSkillDocs('attack the zombie', 1), render([ATTACK, ...ALWAYS]));
        assert.equal(await library.getRelevantSkillDocs(CRAFT_QUERY, 1), render([CRAFT, ...ALWAYS]));
    });
});
