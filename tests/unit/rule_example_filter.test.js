// Spec v0.1.4.6 R5: src/agent/rules/example_filter.js -- the pure part of "the prompter leaves out
// examples whose commands are hidden". exampleCommands(example) returns the command names that an
// example uses; visibleExamples(examples, isHidden) returns the examples without a hidden command.
// The filter is called from src/utils/examples.js (glue engineer).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/rules/example_filter.js';
const F = await loadSrc(MODULE);

const user = (content) => ({ role: 'user', content });
const bot = (content) => ({ role: 'assistant', content });
const sys = (content) => ({ role: 'system', content });

describe('module', () => {
    test('pure: imports nothing', () => {
        assertImportRules(MODULE, { allowBuiltins: [], allowedRelative: [] });
    });

    test('importing the module prints nothing and creates no files', () => {
        assertCleanImport(MODULE);
    });
});

describe('exampleCommands(example)', () => {
    test('the command of an assistant turn, with its !', () => {
        assert.deepEqual(F.exampleCommands([user('greg: collect wood'), bot('Sure. !collectBlocks("oak_log", 10)')]), ['!collectBlocks']);
    });

    test('commands without arguments', () => {
        assert.deepEqual(F.exampleCommands([user('abc: stop'), bot('Sure. !stop')]), ['!stop']);
    });

    test('all turns in order of appearance, every name once', () => {
        const example = [
            user('x: hi'),
            bot('Let me look. !nearbyBlocks'),
            sys('NEARBY_BLOCKS\n- oak_log'),
            bot('!collectBlocks("oak_log", 3)'),
            bot('Again. !nearbyBlocks'),
            bot('!goToShelter'),
        ];
        assert.deepEqual(F.exampleCommands(example), ['!nearbyBlocks', '!collectBlocks', '!goToShelter']);
    });

    test('commands in user turns count too: another bot uses them', () => {
        assert.deepEqual(F.exampleCommands([user('zorro_34: (FROM OTHER BOT)Let\'s see... !inventory\nI have a pickaxe'), bot('Okay.')]), ['!inventory']);
    });

    test('system turns are not searched: they are output of the game, not calls', () => {
        const example = [
            sys("You are self-prompting with the goal: 'Get wood'. Your next response MUST contain a command with this syntax: !commandName. Respond:"),
            bot('!collectBlocks("oak_log", 3)'),
            sys('Command !foo is not a command.'),
        ];
        assert.deepEqual(F.exampleCommands(example), ['!collectBlocks']);
    });

    test('code blocks are skipped', () => {
        const example = [
            user('maya: build'),
            bot('```js\nif (!bot.entity) return;\nlet ok = !world.getPosition(bot);\n```'),
            bot('Done. ```\n!notACommand\n``` and then !stop'),
        ];
        assert.deepEqual(F.exampleCommands(example), ['!stop']);
    });

    test('an unclosed code block runs to the end of the turn', () => {
        assert.deepEqual(F.exampleCommands([bot('Here: ```js\nwhile (!done) {}'), bot('!stop')]), ['!stop']);
    });

    test('exclamation marks of normal text are no commands', () => {
        const example = [
            user('miner_32: Hey! What are you up to?'),
            bot('Nothing much!'),
            bot('Wow!!! Great! !!'),
            bot('!!Code threw exception!! twice'),
            bot('Price: 5! 10!'),
        ];
        assert.deepEqual(F.exampleCommands(example), []);
    });

    test('a name must start with a letter', () => {
        assert.deepEqual(F.exampleCommands([bot('!1 !_x !a1')]), ['!a1']);
    });

    test('invalid examples and turns give no commands and do not throw', () => {
        for (const example of [undefined, null, 'text', 42, {}, [null, 'x', 42, { role: 'assistant' }, { role: 'assistant', content: 7 }, { content: '!stop' }]]) {
            assert.deepEqual(F.exampleCommands(example), [], String(example));
        }
    });

    test('a turn whose content cannot be read is skipped', () => {
        const evil = { role: 'assistant', get content() { throw new Error('boom'); } };
        assert.deepEqual(F.exampleCommands([evil, bot('!stop')]), ['!stop']);
    });
});

describe('commandCalls(text)', () => {
    test('name and position of every call, in order, repeats included', () => {
        const text = 'Sure. !stop and !goToPlayer("a", 3) !stop';
        assert.deepEqual(F.commandCalls(text),
            [{ name: '!stop', index: 6 }, { name: '!goToPlayer', index: 16 }, { name: '!stop', index: text.lastIndexOf('!stop') }]);
    });

    test('positions stay right after a skipped code block', () => {
        const text = 'a ```!x``` !stop';
        assert.deepEqual(F.commandCalls(text), [{ name: '!stop', index: text.indexOf('!stop') }]);
    });

    test('not a text: no calls', () => {
        for (const text of [undefined, null, 5, {}]) assert.deepEqual(F.commandCalls(text), []);
    });
});

describe('visibleExamples(examples, isHidden)', () => {
    const shelter = [user('bob: get to shelter'), bot('On my way. !goToShelter')];
    const rule = [user('bob: never break the door'), bot('!rememberRule("Never break the door.")')];
    const both = [user('bob: x'), bot('!goToShelter'), bot('!rememberRule("x")')];
    const chat = [user('miner_32: Hey!'), bot('Hi!')];
    const collect = [user('greg: wood'), bot('!collectBlocks("oak_log", 10)')];
    const all = [shelter, rule, both, chat, collect];

    test('leaves out every example that uses a hidden command, keeps the order of the rest', () => {
        const hidden = new Set(['!goToShelter']);
        assert.deepEqual(F.visibleExamples(all, (name) => hidden.has(name)), [rule, chat, collect]);
    });

    test('with nothing hidden all examples stay', () => {
        assert.deepEqual(F.visibleExamples(all, () => false), all);
    });

    test('isHidden gets the names with their !', () => {
        const asked = [];
        F.visibleExamples([collect], (name) => {
            asked.push(name);
            return false;
        });
        assert.deepEqual(asked, ['!collectBlocks']);
    });

    test('returns a new array with the same example objects, the input is not changed', () => {
        const input = [shelter, chat];
        const copy = JSON.parse(JSON.stringify(input));
        const result = F.visibleExamples(input, (name) => name === '!goToShelter');
        assert.notEqual(result, input);
        assert.equal(result[0], chat);
        assert.deepEqual(input, copy);
    });

    test('without a function isHidden nothing is hidden', () => {
        for (const isHidden of [undefined, null, 'x', {}]) {
            assert.deepEqual(F.visibleExamples(all, isHidden), all);
        }
    });

    test('an isHidden that throws counts as hidden, so no unsure example reaches the prompt', () => {
        const result = F.visibleExamples(all, (name) => {
            if (name === '!rememberRule') throw new Error('boom');
            return false;
        });
        assert.deepEqual(result, [shelter, chat, collect]);
    });

    test('examples that are no lists stay, they have no commands', () => {
        const odd = { not: 'a list' };
        assert.deepEqual(F.visibleExamples([odd, shelter], (name) => name === '!goToShelter'), [odd]);
    });

    test('not a list of examples: empty list', () => {
        for (const examples of [undefined, null, 'x', 42, {}]) {
            assert.deepEqual(F.visibleExamples(examples, () => false), []);
        }
    });
});

describe('the examples of profiles/defaults/_default.json', () => {
    const profile = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
    const examples = [...profile.conversation_examples, ...profile.coding_examples];

    test('coding examples use no commands', () => {
        for (const example of profile.coding_examples) {
            assert.deepEqual(F.exampleCommands(example), [], JSON.stringify(example[0]));
        }
    });

    test('hiding a command removes exactly the examples that call it', () => {
        const names = new Set(examples.flatMap((e) => F.exampleCommands(e)));
        for (const name of names) {
            const visible = F.visibleExamples(examples, (n) => n === name);
            const expected = examples.filter((e) => !F.exampleCommands(e).includes(name));
            assert.deepEqual(visible, expected, name);
            for (const example of visible) {
                assert.ok(!JSON.stringify(example.filter((t) => t.role !== 'system')).includes(name + '(')
                    && !F.exampleCommands(example).includes(name), `${name} still in ${JSON.stringify(example[0])}`);
            }
        }
    });
});
