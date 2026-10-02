// Spec v0.1.4.6 R4: the command parser in src/agent/commands/index.js, always active.
//   * An argument in single quotes is read like one in double quotes: !collectBlocks('stone', 10).
//   * A parameter may have `default`. When a call gives fewer arguments than parameters and every
//     missing parameter at the end has a default, the defaults are used. Without defaults the old
//     error stays. getCommandDocs writes "(optional, default 4)" after such a parameter.
// A call that the parser read correctly before is read the same way now: a copy of the old
// tokenizer below is the reference for a list of calls and for generated calls.
//
// The tests use command definitions that they build themselves: parseCommandMessage(message,
// lookup) takes the function that finds a command by name, getCommandDocs(agent, commands) the list.
// So that the parser is tested on its own, a loader hook (inline below) replaces actions.js and
// queries.js with empty command lists: commands/index.js then imports only mcdata.js. The checks
// with the real command list are in examples_valid.test.js. commands/index.js is imported with an
// empty temp directory as working directory. The hook of helpers/mcdata_hooks.js installs the
// real minecraft-data for the block and item names.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const EMPTY_LISTS_HOOK = `
export async function load(url, context, nextLoad) {
    if (url.endsWith('/src/agent/commands/actions.js'))
        return { format: 'module', source: 'export const actionsList = [];', shortCircuit: true };
    if (url.endsWith('/src/agent/commands/queries.js'))
        return { format: 'module', source: 'export const queryList = [];', shortCircuit: true };
    return nextLoad(url, context);
}`;
register('data:text/javascript,' + encodeURIComponent(EMPTY_LISTS_HOOK));
register('../helpers/mcdata_hooks.js', import.meta.url);

async function importCommands() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const index = await loadSrc('src/agent/commands/index.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { index, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const { index, mcdata } = await importCommands();

before(() => mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => mcdata.__setMcdataForTests(null));

// ---------------------------------------------------------------- own command definitions

const param = (type, extra = {}) => ({ type, description: `A ${type}.`, ...extra });

const DEFS = {
    '!stop': { name: '!stop', description: 'Stop.' },
    '!say': { name: '!say', description: 'Say.', params: { text: param('string') } },
    '!two': { name: '!two', description: 'Two strings.', params: { a: param('string'), b: param('string') } },
    '!goToPlayer': { name: '!goToPlayer', description: 'Go.', params: { player_name: param('string'), closeness: param('float', { domain: [0, Infinity] }) } },
    '!follow': { name: '!follow', description: 'Follow.', params: { player_name: param('string'), follow_dist: param('float', { domain: [0, Infinity], default: 4 }) } },
    '!collect': { name: '!collect', description: 'Collect.', params: { type: param('BlockName'), num: param('int', { domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }) } },
    '!craft': { name: '!craft', description: 'Craft.', params: { recipe_name: param('ItemName'), num: param('int', { default: 1 }) } },
    '!place': { name: '!place', description: 'Place.', params: { type: param('BlockOrItemName') } },
    '!setMode': { name: '!setMode', description: 'Mode.', params: { mode_name: param('string'), on: param('boolean') } },
    '!stay': { name: '!stay', description: 'Stay.', params: { type: param('int', { domain: [-1, Number.MAX_SAFE_INTEGER], default: 30 }) } },
    '!coords': { name: '!coords', description: 'Coordinates.', params: { x: param('float'), y: param('float', { domain: [-64, 320] }), z: param('float'), closeness: param('float', { default: 1 }) } },
    '!area': { name: '!area', description: 'Area.', params: { name: param('string'), type: param('string', { default: 'building' }) } },
    '!middle': { name: '!middle', description: 'Default in the middle.', params: { a: param('string'), b: param('int', { default: 5 }), c: param('int') } },
    '!allOptional': { name: '!allOptional', description: 'All optional.', params: { a: param('int', { default: 7 }), b: param('boolean', { default: false }) } },
    '!odd': { name: '!odd', description: 'Unknown type.', params: { a: param('vector') } },
};
const lookup = (name) => DEFS[name];
const parse = (message) => index.parseCommandMessage(message, lookup);
const ok = (commandName, args) => ({ commandName, args });

// ---------------------------------------------------------------- the old tokenizer (reference)

const OLD_COMMAND_REGEX = /!(\w+)(?:\(((?:-?\d+(?:\.\d+)?|true|false|"[^"]*")(?:\s*,\s*(?:-?\d+(?:\.\d+)?|true|false|"[^"]*"))*)\))?/;
const OLD_ARG_REGEX = /-?\d+(?:\.\d+)?|true|false|"[^"]*"/g;

function oldRead(message) {
    const m = message.match(OLD_COMMAND_REGEX);
    if (!m) return null;
    const tokens = m[2] ? m[2].match(OLD_ARG_REGEX) : [];
    return { name: '!' + m[1], group: m[2], matched: m[0], index: m.index, tokens };
}

const strip = (token) => (token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token);

// A lookup that answers every name with a command of n string parameters.
const stringsLookup = (n) => (name) => {
    const params = {};
    for (let i = 0; i < n; i++) params['p' + i] = param('string');
    return { name, description: 'x', params };
};

describe('module', () => {
    test('exports the parser functions', () => {
        for (const name of ['parseCommandMessage', 'containsCommand', 'truncCommandMessage', 'getCommandDocs', 'executeCommand', 'commandExists', 'getCommand']) {
            assert.equal(typeof index[name], 'function', name);
        }
    });

    test('the command lists are replaced by empty ones in this file', () => {
        assert.equal(index.commandExists('!stop'), false);
        assert.equal(index.parseCommandMessage('!stop'), '!stop is not a command.');
    });
});

describe('calls that were read before are read the same way', () => {
    test('no arguments', () => {
        assert.deepEqual(parse('Sure. !stop'), ok('!stop', []));
        assert.deepEqual(parse('!stop()'), ok('!stop', []));
    });

    test('double quoted strings and numbers', () => {
        assert.deepEqual(parse('On my way! !goToPlayer("zZZn98", 3)'), ok('!goToPlayer', ['zZZn98', 3]));
        assert.deepEqual(parse('!goToPlayer("steve",0.5)'), ok('!goToPlayer', ['steve', 0.5]));
        // v0.1.4.11, W5 (engineer E1): a wrong number of arguments is answered with the form of the command
        assert.deepEqual(parse('!goToPlayer( "steve" , 2)'), '!goToPlayer takes 2 arguments (player_name, closeness): !goToPlayer("player_name", closeness).', 'a space after ( was never allowed');
    });

    test('negative numbers', () => {
        assert.deepEqual(parse('!coords(-154, -60, -228.5, 2)'), ok('!coords', [-154, -60, -228.5, 2]));
        assert.deepEqual(parse('!stay(-1)'), ok('!stay', [-1]));
    });

    test('booleans', () => {
        assert.deepEqual(parse('!setMode("hunting", false)'), ok('!setMode', ['hunting', false]));
        assert.deepEqual(parse('!setMode("hunting", true)'), ok('!setMode', ['hunting', true]));
        assert.deepEqual(parse('!setMode("hunting", "off")'), ok('!setMode', ['hunting', false]));
        assert.equal(parse('!setMode("hunting", "maybe")'), "Error: Param 'on' must be of type boolean.");
    });

    test('a number for a string parameter stays text', () => {
        assert.deepEqual(parse('!say(5)'), ok('!say', ['5']));
        assert.deepEqual(parse('!say(true)'), ok('!say', ['true']));
    });

    test('an apostrophe inside a double quoted string', () => {
        assert.deepEqual(parse(`!say("don't break the house")`), ok('!say', ["don't break the house"]));
        assert.deepEqual(parse(`!two("it's", "don't")`), ok('!two', ["it's", "don't"]));
    });

    test('parentheses and commas inside a double quoted string', () => {
        assert.deepEqual(parse('!say("build (small), then stop")'), ok('!say', ['build (small), then stop']));
    });

    test('text after the call is ignored', () => {
        assert.deepEqual(parse('!two("john_goodman", "Hey John"))'), ok('!two', ['john_goodman', 'Hey John']));
        assert.deepEqual(parse(`!say("x") and then I'll go`), ok('!say', ['x']));
    });

    test('only the first command counts', () => {
        assert.deepEqual(parse('!say("a") !stop'), ok('!say', ['a']));
    });

    // v0.1.4.11, W5 (engineer E1): the text of a wrong number of arguments is the form of the command, built from its params
    test('too many arguments', () => {
        assert.equal(parse('!goToPlayer("a", 1, 2)'), '!goToPlayer takes 2 arguments (player_name, closeness): !goToPlayer("player_name", closeness).');
        assert.equal(parse('!stop("now")'), '!stop takes no arguments: !stop.');
    });

    test('too few arguments without defaults: the form of the command (W5)', () => {
        assert.equal(parse('!goToPlayer("a")'), '!goToPlayer takes 2 arguments (player_name, closeness): !goToPlayer("player_name", closeness).');
        assert.equal(parse('!goToPlayer'), '!goToPlayer takes 2 arguments (player_name, closeness): !goToPlayer("player_name", closeness).');
    });

    test('not a command and badly formatted text', () => {
        assert.equal(parse('!nothing("x")'), '!nothing is not a command.');
        assert.equal(parse('no command here'), 'Command is incorrectly formatted');
    });

    test('types, domains and names are checked as before', () => {
        assert.equal(parse('!goToPlayer("a", -1)'), "Error: Param 'closeness' must be an element of [0, Infinity).");
        assert.equal(parse('!coords(1, 999, 1, 1)'), "Error: Param 'y' must be an element of [-64, 320).");
        assert.equal(parse('!collect("not_a_block", 1)'), 'Invalid block type: not_a_block.');
        assert.equal(parse('!craft("not_an_item", 1)'), 'Invalid item type: not_an_item.');
        assert.equal(parse('!place("not_a_thing")'), 'Invalid block or item type: not_a_thing.');
        assert.deepEqual(parse('!place("torch")'), ok('!place', ['torch']));
        assert.deepEqual(parse('!craft("oak_plank", 2)'), ok('!craft', ['oak_planks', 2]), 'the plank fix stays');
        assert.deepEqual(parse('!collect("oak_log", 2.9)'), ok('!collect', ['oak_log', 2]), 'int is parsed with parseInt');
        assert.throws(() => parse('!odd("x")'), /unknown type: vector/);
    });

    test('containsCommand and truncCommandMessage as before', () => {
        assert.equal(index.containsCommand('Sure! !goToPlayer("bob", 3) now'), '!goToPlayer');
        assert.equal(index.containsCommand('Hey! What are you up to?'), null);
        assert.equal(index.truncCommandMessage('Sure! !goToPlayer("bob", 3) and more text'), 'Sure! !goToPlayer("bob", 3)');
        assert.equal(index.truncCommandMessage('no command'), 'no command');
    });

    test('a list of calls: same tokens as the old tokenizer', () => {
        const calls = [
            '!stop', 'Sure. !stop', '!say("")', '!say("a b c")', '!say(-0)', '!say(1.25)',
            '!two("a", "b")', '!two("a","b")', '!two("a" , "b")', '!two("a",\n"b")', '!two(true, false)',
            '!two(-1, 2.5)', '!two("x", 3) trailing', `!two("don't", "it's")`, '!two("(", ")")',
            '!two("a, b", "c, d")', 'text !two("a", "b") !say("c")', '!two("!say(1)", "x")',
            'I\'m going. !two("x", "y")', '!two("tab\there", "new\nline")',
        ];
        for (const message of calls) {
            const old = oldRead(message);
            assert.ok(old && (old.group !== undefined || !message.includes(old.matched + '(')), `the old parser read ${message}`);
            const result = index.parseCommandMessage(message, stringsLookup(old.tokens.length));
            assert.deepEqual(result, ok(old.name, old.tokens.map(strip)), message);
            assert.equal(index.containsCommand(message), old.name, message);
            assert.equal(index.truncCommandMessage(message), message.substring(0, old.index + old.matched.length), message);
        }
    });

    test('generated calls: wherever the old parser read the arguments, the new one reads the same', () => {
        let seed = 20260928;
        const random = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        const pick = (list) => list[Math.floor(random() * list.length)];
        const chars = ['a', 'b', 'Z', ' ', ',', '(', ')', "'", '!', '-', '1', '.', '\n', 'x_y', 'é'];
        const text = (max) => Array.from({ length: Math.floor(random() * max) }, () => pick(chars)).join('');
        const token = () => pick([
            () => String(Math.floor(random() * 200) - 100),
            () => (random() * 100 - 50).toFixed(2),
            () => pick(['true', 'false']),
            () => `"${text(8).replaceAll('"', '')}"`,
            () => `'${text(6).replaceAll("'", '')}'`,
        ])();
        let compared = 0;
        for (let i = 0; i < 3000; i++) {
            const count = Math.floor(random() * 4);
            const args = Array.from({ length: count }, token);
            const sep = pick([', ', ',', ' , ', ',  ']);
            const call = `!${pick(['go', 'say', 'x1'])}${count > 0 || random() < 0.5 ? `(${args.join(sep)})` : ''}`;
            const message = `${text(5)} ${call}${pick(['', ')', ' done', "'", ' !stop'])}`;
            const old = oldRead(message);
            if (!old || old.group === undefined) continue; // the old parser did not read arguments here
            compared++;
            const result = index.parseCommandMessage(message, stringsLookup(old.tokens.length));
            assert.deepEqual(result, ok(old.name, old.tokens.map(strip)), JSON.stringify(message));
            assert.equal(index.truncCommandMessage(message), message.substring(0, old.index + old.matched.length), JSON.stringify(message));
            const wrongCount = index.parseCommandMessage(message, stringsLookup(old.tokens.length + 1));
            // v0.1.4.11, W5 (engineer E1): the form of the command instead of "was given N args, but requires M args"
            const names = Array.from({ length: old.tokens.length + 1 }, (_, i) => `p${i}`);
            const takes = names.length === 1 ? '1 argument' : `${names.length} arguments`;
            assert.equal(wrongCount, `${old.name} takes ${takes} (${names.join(', ')}): ${old.name}(${names.map((n) => `"${n}"`).join(', ')}).`);
        }
        assert.ok(compared > 500, `compared ${compared} calls`);
    });
});

describe('single quotes', () => {
    test('an argument in single quotes is read like one in double quotes', () => {
        assert.deepEqual(parse("!collect('stone', 10)"), ok('!collect', ['stone', 10]));
        assert.deepEqual(parse("Alright, I'll start. !collect('stone', 10)"), ok('!collect', ['stone', 10]));
        assert.deepEqual(parse("!say('')"), ok('!say', ['']));
    });

    test('mixed quotes in one call', () => {
        assert.deepEqual(parse(`!two('john_goodman', "Hey John")`), ok('!two', ['john_goodman', 'Hey John']));
        assert.deepEqual(parse(`!two("john_goodman", 'Hey John')`), ok('!two', ['john_goodman', 'Hey John']));
    });

    test('a double quote inside a single quoted string', () => {
        assert.deepEqual(parse(`!say('say "hi" to bob')`), ok('!say', ['say "hi" to bob']));
    });

    test('a single quote inside a double quoted string', () => {
        assert.deepEqual(parse(`!say("say 'hi' to bob")`), ok('!say', ["say 'hi' to bob"]));
    });

    test('an apostrophe inside a single quoted string, when it is not followed by a comma or a parenthesis', () => {
        assert.deepEqual(parse(`!say('Don't break the house, it's ours.')`), ok('!say', ["Don't break the house, it's ours."]));
        assert.deepEqual(parse(`!two('I'm here', 'you're there')`), ok('!two', ["I'm here", "you're there"]));
    });

    test('commas and parentheses inside a single quoted string', () => {
        assert.deepEqual(parse(`!say('build (small), then stop')`), ok('!say', ['build (small), then stop']));
        assert.deepEqual(parse(`!two('a, b', 'c')`), ok('!two', ['a, b', 'c']));
    });

    test('numbers and booleans with single quoted strings', () => {
        assert.deepEqual(parse(`!setMode('hunting', false)`), ok('!setMode', ['hunting', false]));
        assert.deepEqual(parse(`!goToPlayer('billy',3)`), ok('!goToPlayer', ['billy', 3]));
        assert.deepEqual(parse(`!coords(-1, 64, '-2.5', 1)`), ok('!coords', [-1, 64, -2.5, 1]));
    });

    test('types are checked as for double quotes', () => {
        assert.equal(parse("!collect('not_a_block', 1)"), 'Invalid block type: not_a_block.');
        assert.deepEqual(parse("!craft('oak_plank', 1)"), ok('!craft', ['oak_planks', 1]));
    });

    test('too many and too few arguments give the form of the command (v0.1.4.11, W5)', () => {
        // v0.1.4.11, W5: the form of the command
        assert.equal(parse("!goToPlayer('a', 1, 'b')"), '!goToPlayer takes 2 arguments (player_name, closeness): !goToPlayer("player_name", closeness).');
        assert.equal(parse("!goToPlayer('a')"), '!goToPlayer takes 2 arguments (player_name, closeness): !goToPlayer("player_name", closeness).');
    });

    test('containsCommand and truncCommandMessage keep the whole call', () => {
        const message = "Collecting dirt !collectBlocks('dirt',10). Then I rest.";
        assert.equal(index.containsCommand(message), '!collectBlocks');
        assert.equal(index.truncCommandMessage(message), "Collecting dirt !collectBlocks('dirt',10)");
    });

    test('an unclosed single quote is not an argument', () => {
        assert.equal(parse("!say('never closed)"), '!say takes 1 argument (text): !say("text").', 'v0.1.4.11, W5');
    });
});

describe('default values', () => {
    test('a missing last argument with a default gets the default', () => {
        assert.deepEqual(parse('!follow("steve")'), ok('!follow', ['steve', 4]));
        assert.deepEqual(parse("!follow('steve')"), ok('!follow', ['steve', 4]));
        assert.deepEqual(parse('!collect("oak_log")'), ok('!collect', ['oak_log', 1]));
        assert.deepEqual(parse('!area("home")'), ok('!area', ['home', 'building']));
    });

    test('a given argument wins over the default', () => {
        assert.deepEqual(parse('!follow("steve", 2)'), ok('!follow', ['steve', 2]));
        assert.deepEqual(parse('!area("barn", "farm")'), ok('!area', ['barn', 'farm']));
    });

    test('all parameters optional: no arguments at all, with or without parentheses', () => {
        assert.deepEqual(parse('!allOptional'), ok('!allOptional', [7, false]));
        assert.deepEqual(parse('!allOptional()'), ok('!allOptional', [7, false]));
        assert.deepEqual(parse('!allOptional(3)'), ok('!allOptional', [3, false]));
        assert.deepEqual(parse('!stay'), ok('!stay', [30]));
    });

    test('the default is used as it is, without a type or domain check', () => {
        const defs = { '!x': { name: '!x', params: { a: param('int', { domain: [1, 5], default: 99 }) } } };
        assert.deepEqual(index.parseCommandMessage('!x', (n) => defs[n]), ok('!x', [99]));
    });

    test('a missing argument without a default in the middle gives the form of the command (W5)', () => {
        // v0.1.4.11, W5: the form of the command; a default before a required parameter cannot be left out
        assert.equal(parse('!middle("a")'), '!middle takes 3 arguments (a, b, c): !middle("a", b, c).');
        assert.deepEqual(parse('!middle("a", 1, 2)'), ok('!middle', ['a', 1, 2]));
    });

    test('a missing argument without a default at the end gives the form of the command (W5)', () => {
        // v0.1.4.11, W5: the form of the command, the defaults at the end counted in the range
        assert.equal(parse('!middle("a", 1)'), '!middle takes 3 arguments (a, b, c): !middle("a", b, c).');
        assert.equal(parse('!coords(1, 2)'), '!coords takes 3 or 4 arguments (x, y, z, closeness): !coords(x, y, z).');
        assert.deepEqual(parse('!coords(1, 2, 3)'), ok('!coords', [1, 2, 3, 1]));
    });

    test('too many arguments stay an error with defaults', () => {
        assert.equal(parse('!follow("a", 1, 2)'), '!follow takes 1 or 2 arguments (player_name, follow_dist): !follow("player_name").', 'v0.1.4.11, W5');
    });

    test('a default of undefined is no default', () => {
        const defs = { '!x': { name: '!x', params: { a: param('int', { default: undefined }) } } };
        assert.equal(index.parseCommandMessage('!x', (n) => defs[n]), '!x takes 1 argument (a): !x(a).', 'v0.1.4.11, W5');
    });

    test('falsy defaults work: 0, false and the empty text', () => {
        const defs = { '!x': { name: '!x', params: { a: param('int', { default: 0 }), b: param('boolean', { default: false }), c: param('string', { default: '' }) } } };
        assert.deepEqual(index.parseCommandMessage('!x', (n) => defs[n]), ok('!x', [0, false, '']));
    });

    test('the definition is not changed by parsing', () => {
        const before = JSON.stringify(DEFS['!follow']);
        parse('!follow("steve")');
        assert.equal(JSON.stringify(DEFS['!follow']), before);
    });
});

describe('executeCommand', () => {
    test('a parse error is returned as text', async () => {
        assert.equal(await index.executeCommand({}, '!noSuchCommand'), '!noSuchCommand is not a command.');
    });
});

describe('getCommandDocs(agent, commands)', () => {
    const docsOf = (commands, blocked = []) => index.getCommandDocs({ blocked_actions: blocked }, commands);

    test('a parameter with a default: "(optional, default 4)" after its description', () => {
        const docs = docsOf([DEFS['!follow']]);
        assert.ok(docs.includes('!follow: Follow.\nParams:\nplayer_name: (string) A string.\nfollow_dist: (number) A float. (optional, default 4)\n'), docs);
    });

    test('a text default is written in double quotes, a boolean as it is', () => {
        assert.ok(docsOf([DEFS['!area']]).includes('type: (string) A string. (optional, default "building")\n'));
        assert.ok(docsOf([DEFS['!allOptional']]).includes('b: (bool) A boolean. (optional, default false)\n'));
    });

    test('parameters without a default are written as before', () => {
        const docs = docsOf([DEFS['!goToPlayer'], DEFS['!stop']]);
        assert.ok(docs.includes('!goToPlayer: Go.\nParams:\nplayer_name: (string) A string.\ncloseness: (number) A float.\n!stop: Stop.\n'), docs);
    });

    test('the header and the end are unchanged', () => {
        const docs = docsOf([]);
        assert.equal(docs, '\n*COMMAND DOCS\n You can use the following commands to perform actions and get information about the world. \n'
            + '    Use the commands with the syntax: !commandName or !commandName("arg1", 1.2, ...) if the command takes arguments.\n\n'
            + '    Do not use codeblocks. Use double quotes for strings. Only use one command in each response, trailing commands and comments will be ignored.\n'
            + '*\n');
    });

    test('blocked commands are left out', () => {
        const docs = docsOf([DEFS['!stop'], DEFS['!say']], ['!stop']);
        assert.ok(!docs.includes('!stop:'));
        assert.ok(docs.includes('!say: Say.'));
    });

    test('without a list the command list of the module is documented (empty in this file)', () => {
        assert.equal(index.getCommandDocs({ blocked_actions: [] }), docsOf([]));
    });
});
