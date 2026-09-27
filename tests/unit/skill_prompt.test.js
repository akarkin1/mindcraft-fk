// Spec v0.1.4.4 K6: src/agent/skills/skill_prompt.js -- buildCodingSection, buildConversingSection,
// insertSection. A "skill info" is an index entry plus `doc`, the doc text of its source.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertSkillModuleImports } from '../helpers/source_ast.js';
import { assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/skills/skill_prompt.js';
const P = await loadSrc(MODULE);

const HEADER = '#### SAVED SKILLS ###';
const NEW_CODE_RULES = [
    'RULES FOR NEW CODE:',
    '- If the task could be needed again, write it as ONE async function with a descriptive camelCase name, `bot` as the first parameter and the values of this task as further parameters. Put a /** ... **/ description with @param lines inside the function body. Put helper code inside that function. Return true on success and false on failure. Then call the function with the values of this task, for example: await buildDirtPlatform(bot, 3);',
    '- Do not write coordinates of this world into the function. Pass them as parameters or compute them from the position of the bot.',
    '- For a small one-off task, write plain statements without a function.',
].join('\n');
const SAVED_RULES = [
    'RULES FOR SAVED SKILLS:',
    '- Before you write new code, check the saved skills below. If one fits, call it: await customSkills.<name>(bot, ...);',
    '- If a saved skill almost fits, write an improved version of the function under the same name. It replaces the old version.',
    'The following saved skills are available:',
].join('\n');
const NONE_SAVED = 'No skills are saved yet.';
const OTHER = 'Other saved skills:';
const CONVO_FIRST = 'SAVED SKILLS: code you wrote earlier and can run again. To run one, use !newAction and name the skill and its values.';
const CONVO_COMMAND = ' You can also run one directly with !useSkill.';

const OFF = { capture: false, reuse: false, command: false };
const CAPTURE = { capture: true, reuse: false, command: false };
const REUSE = { capture: false, reuse: true, command: false };
const BOTH = { capture: true, reuse: true, command: false };
const ALL = { capture: true, reuse: true, command: true };

function info(name, signature, description, { status = 'active', last_used = null, doc } = {}) {
    return {
        name, signature, description, status, version: 1,
        created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
        uses: 0, failures: 0, consecutive_failures: 0, last_used, last_error: null,
        source_task: 'a task', hash: 'h'.repeat(64),
        doc: doc ?? `${description}\n@param {MinecraftBot} bot, reference to the minecraft bot.`,
    };
}

// Sorted by name like store.list(). For the task 'dig a deep hole' only digHole has a keyword
// score above 0, so rankByKeywords gives digHole, then buildWall, fishInLake, plantWheat (ties by index).
const WALL = info('buildWall', 'buildWall(bot, length)', 'Builds a wall of dirt blocks.', { last_used: '2026-09-19T10:00:00.000Z' });
const HOLE = info('digHole', 'digHole(bot, depth)', 'Digs a hole straight down.');
const FISH = info('fishInLake', 'fishInLake(bot)', 'Catches fish with a rod.');
const OLD = info('oldSkill', 'oldSkill(bot)', 'A disabled skill.', { status: 'disabled', last_used: '2026-09-25T10:00:00.000Z' });
const WHEAT = info('plantWheat', 'plantWheat(bot, seeds)', 'Plants wheat seeds on farmland.', { last_used: '2026-09-20T10:00:00.000Z' });
const SKILLS = [WALL, HOLE, FISH, OLD, WHEAT];
const TASK = 'dig a deep hole';

const docBlock = (s) => `### customSkills.${s.name}\n${s.doc}`;
const otherLine = (s) => `- customSkills.${s.signature}: ${s.description}`;
const convoLine = (s) => `- ${s.signature}: ${s.description}`;

describe('buildCodingSection({ flags, skills, task, maxDocs, maxListed })', () => {
    test("capture and reuse both false: ''", () => {
        assert.equal(P.buildCodingSection({ flags: OFF, skills: SKILLS, task: TASK }), '');
        assert.equal(P.buildCodingSection({ flags: { ...OFF, command: true }, skills: SKILLS, task: TASK }), '');
    });

    test('capture only: header and the rules for new code, exact text', () => {
        const expected = [HEADER, NEW_CODE_RULES].join('\n');
        assert.equal(P.buildCodingSection({ flags: CAPTURE, skills: SKILLS, task: TASK }), expected);
        assert.equal(P.buildCodingSection({ flags: CAPTURE, skills: [], task: TASK }), expected);
    });

    test('reuse without skills: header and "No skills are saved yet."', () => {
        assert.equal(P.buildCodingSection({ flags: REUSE, skills: [], task: TASK }), [HEADER, NONE_SAVED].join('\n'));
    });

    test('reuse with only disabled skills counts as no skill', () => {
        assert.equal(P.buildCodingSection({ flags: REUSE, skills: [OLD], task: TASK }), [HEADER, NONE_SAVED].join('\n'));
    });

    test('capture and reuse without skills: header, rules for new code, "No skills are saved yet."', () => {
        assert.equal(P.buildCodingSection({ flags: BOTH, skills: [], task: TASK }), [HEADER, NEW_CODE_RULES, NONE_SAVED].join('\n'));
    });

    test('reuse, all active skills fit into maxDocs: full docs in rank order, no "Other" list, disabled left out', () => {
        const expected = [HEADER, SAVED_RULES, docBlock(HOLE), docBlock(WALL), docBlock(FISH), docBlock(WHEAT)].join('\n');
        assert.equal(P.buildCodingSection({ flags: REUSE, skills: SKILLS, task: TASK }), expected);
    });

    test('capture and reuse, maxDocs 2: two docs by rank, then "Other saved skills:" by last_used desc (null last)', () => {
        const expected = [HEADER, NEW_CODE_RULES, SAVED_RULES, docBlock(HOLE), docBlock(WALL), OTHER, otherLine(WHEAT), otherLine(FISH)].join('\n');
        assert.equal(P.buildCodingSection({ flags: BOTH, skills: SKILLS, task: TASK, maxDocs: 2, maxListed: 50 }), expected);
    });

    test('the "Other" list has at most maxListed - maxDocs lines', () => {
        const expected = [HEADER, SAVED_RULES, docBlock(HOLE), docBlock(WALL), OTHER, otherLine(WHEAT)].join('\n');
        assert.equal(P.buildCodingSection({ flags: REUSE, skills: SKILLS, task: TASK, maxDocs: 2, maxListed: 3 }), expected);
    });

    test('the "Other" list: ties of last_used ordered by name', () => {
        const a = info('alphaSkill', 'alphaSkill(bot)', 'Alpha.', { last_used: '2026-09-10T00:00:00.000Z' });
        const b = info('betaSkill', 'betaSkill(bot)', 'Beta.', { last_used: '2026-09-10T00:00:00.000Z' });
        const c = info('gammaSkill', 'gammaSkill(bot)', 'Gamma.');
        const d = info('deltaSkill', 'deltaSkill(bot)', 'Delta.');
        const zulu = info('zuluSkill', 'zuluSkill(bot)', 'Zulu.');
        // task 'zulu': only zuluSkill has a keyword score above 0, so it gets the only doc
        const section = P.buildCodingSection({ flags: REUSE, skills: [a, b, d, c, zulu], task: 'zulu', maxDocs: 1, maxListed: 10 });
        assert.ok(section.includes('### customSkills.zuluSkill'), section);
        const lines = section.split('\n');
        const at = lines.indexOf(OTHER);
        assert.ok(at > 0, section);
        assert.deepEqual(lines.slice(at + 1), [otherLine(a), otherLine(b), otherLine(d), otherLine(c)]);
    });

    test('defaults maxDocs 8 and maxListed 50', () => {
        const many = Array.from({ length: 60 }, (_, i) => {
            const n = String(i).padStart(2, '0');
            return info(`skill${n}`, `skill${n}(bot)`, `Does thing ${n}.`, { doc: `Doc ${n}.` });
        });
        const lines = P.buildCodingSection({ flags: REUSE, skills: many, task: '' }).split('\n');
        assert.equal(lines.filter((l) => l.startsWith('### customSkills.')).length, 8);
        assert.equal(lines.filter((l) => l.startsWith('- customSkills.')).length, 42);
        assert.deepEqual(lines.filter((l) => l.startsWith('### customSkills.')), many.slice(0, 8).map((s) => `### customSkills.${s.name}`));
        assert.equal(lines[lines.length - 42], otherLine(many[8]));
    });

    test('$ characters in docs and descriptions are kept', () => {
        const s = info('payUp', 'payUp(bot, amount)', 'Pays $& and $1.', { doc: 'Pays $& and $1 and $$.' });
        const section = P.buildCodingSection({ flags: REUSE, skills: [s], task: 'pay' });
        assert.equal(section, [HEADER, SAVED_RULES, '### customSkills.payUp', 'Pays $& and $1 and $$.'].join('\n'));
    });
});

describe('buildConversingSection({ flags, skills, maxListed })', () => {
    test("reuse false: ''", () => {
        assert.equal(P.buildConversingSection({ flags: CAPTURE, skills: SKILLS }), '');
        assert.equal(P.buildConversingSection({ flags: { capture: true, reuse: false, command: true }, skills: SKILLS }), '');
    });

    test("no active skill: ''", () => {
        assert.equal(P.buildConversingSection({ flags: BOTH, skills: [] }), '');
        assert.equal(P.buildConversingSection({ flags: BOTH, skills: [OLD] }), '');
    });

    test('first line and one line per active skill, ordered by last_used desc (null last), then by name', () => {
        const expected = [CONVO_FIRST, convoLine(WHEAT), convoLine(WALL), convoLine(HOLE), convoLine(FISH)].join('\n');
        assert.equal(P.buildConversingSection({ flags: BOTH, skills: SKILLS }), expected);
    });

    test('command true: the !useSkill sentence is appended to the first line', () => {
        const expected = [CONVO_FIRST + CONVO_COMMAND, convoLine(WHEAT), convoLine(WALL), convoLine(HOLE), convoLine(FISH)].join('\n');
        assert.equal(P.buildConversingSection({ flags: ALL, skills: SKILLS }), expected);
    });

    test('at most maxListed lines', () => {
        assert.equal(P.buildConversingSection({ flags: BOTH, skills: SKILLS, maxListed: 2 }), [CONVO_FIRST, convoLine(WHEAT), convoLine(WALL)].join('\n'));
    });

    test('default maxListed 20', () => {
        const many = Array.from({ length: 25 }, (_, i) => info(`skill${String(i).padStart(2, '0')}`, `s${i}(bot)`, `D${i}.`));
        const lines = P.buildConversingSection({ flags: REUSE, skills: many }).split('\n');
        assert.equal(lines.length, 21);
        assert.equal(lines[0], CONVO_FIRST);
    });
});

describe('insertSection(prompt, section)', () => {
    test('empty section and no $CUSTOM_SKILLS: the prompt unchanged (also with a Conversation line)', () => {
        for (const prompt of ['Plain prompt.', 'Intro\nConversation Begin:', '', 'x\r\ny $& $1', 'A $CUSTOM B', 'A $CUSTOM_SKILL B']) {
            assert.equal(P.insertSection(prompt, ''), prompt);
        }
    });

    // Amendment 1, A6: the placeholder never reaches the model.
    test('empty section: every $CUSTOM_SKILLS is removed, nothing else changes', () => {
        assert.equal(P.insertSection('A $CUSTOM_SKILLS B', ''), 'A  B');
        assert.equal(P.insertSection('$CUSTOM_SKILLS', ''), '');
        assert.equal(P.insertSection('X\n$CUSTOM_SKILLS\nConversation Begin:', ''), 'X\n\nConversation Begin:');
        assert.equal(P.insertSection('$CUSTOM_SKILLS$CUSTOM_SKILLS a $CUSTOM_SKILLS $& $1', ''), ' a  $& $1');
    });

    test('a section that is not a string counts as empty: the prompt unchanged, or the placeholder removed', () => {
        for (const section of [undefined, null, 42, {}]) {
            assert.equal(P.insertSection('Intro\nConversation Begin:', section), 'Intro\nConversation Begin:');
            assert.equal(P.insertSection('A $CUSTOM_SKILLS B', section), 'A  B');
        }
    });

    test('a prompt that is not a string is returned as it is', () => {
        for (const prompt of [undefined, null, 42]) {
            assert.equal(P.insertSection(prompt, 'SECTION'), prompt);
            assert.equal(P.insertSection(prompt, ''), prompt);
        }
    });

    test('$CUSTOM_SKILLS: every occurrence is replaced by the section', () => {
        assert.equal(P.insertSection('A $CUSTOM_SKILLS B $CUSTOM_SKILLS C', 'SECTION'), 'A SECTION B SECTION C');
    });

    test('$CUSTOM_SKILLS wins over a Conversation line', () => {
        assert.equal(P.insertSection('X\n$CUSTOM_SKILLS\nConversation Begin:', 'SECTION'), 'X\nSECTION\nConversation Begin:');
    });

    test('$ characters in the section are inserted literally', () => {
        const section = 'cost $& $1 $$ $` $\' $CUSTOM';
        assert.equal(P.insertSection('before $CUSTOM_SKILLS after', section), `before ${section} after`);
        assert.equal(P.insertSection('Intro\nConversation Begin:', section), `Intro\n${section}\nConversation Begin:`);
        assert.equal(P.insertSection('No marker', section), `No marker\n${section}`);
    });

    test('last non-empty line starts with Conversation: section and a line break inserted directly before it', () => {
        assert.equal(P.insertSection('Intro\n$STATS\nConversation Begin:', 'SECTION'), 'Intro\n$STATS\nSECTION\nConversation Begin:');
        assert.equal(P.insertSection('Intro\nConversation:', 'A\nB'), 'Intro\nA\nB\nConversation:');
    });

    test('trailing empty lines after the Conversation line are kept', () => {
        assert.equal(P.insertSection('Intro\nConversation Begin:\n\n', 'SECTION'), 'Intro\nSECTION\nConversation Begin:\n\n');
    });

    test('the Conversation line is the first line', () => {
        assert.equal(P.insertSection('Conversation Begin:', 'SECTION'), 'SECTION\nConversation Begin:');
    });

    test('CRLF prompt: the rest of the prompt is not changed', () => {
        assert.equal(P.insertSection('Intro\r\nConversation Begin:', 'SECTION'), 'Intro\r\nSECTION\nConversation Begin:');
    });

    test('otherwise: appended after a line break', () => {
        assert.equal(P.insertSection('Some prompt', 'SECTION'), 'Some prompt\nSECTION');
        assert.equal(P.insertSection('A Conversation in the middle\nlast line', 'SECTION'), 'A Conversation in the middle\nlast line\nSECTION');
    });

    test('works with a built section and a prompt like the default profile', () => {
        const prompt = "Intro\nSummarized memory:'$MEMORY'\n$STATS\n$INVENTORY\n$CODE_DOCS\n$EXAMPLES\nConversation:";
        const section = P.buildCodingSection({ flags: BOTH, skills: [WALL], task: 'wall' });
        const result = P.insertSection(prompt, section);
        assert.equal(result, "Intro\nSummarized memory:'$MEMORY'\n$STATS\n$INVENTORY\n$CODE_DOCS\n$EXAMPLES\n" + section + '\nConversation:');
    });
});

describe('module rules', () => {
    test('pure: imports only keyword_rank.js, sibling skill modules and built-ins without I/O', () => {
        assertSkillModuleImports(MODULE, { pure: true, allowProjectFiles: ['src/utils/keyword_rank.js'] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});
