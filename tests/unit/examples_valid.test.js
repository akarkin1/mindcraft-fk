// Spec v0.1.4.6 R5: the examples in profiles/defaults/_default.json.
//   * Every command call in every example parses with the parser and names an existing command
//     with that number of arguments.
//   * One new example per row of the table R6 that has a command of this release.
//   * No example with a hidden command reaches the prompt (src/agent/rules/example_filter.js).
//
// The commands of this release do not exist in the code while the parts are written. Their names
// and parameters come from the spec, in the table SPEC_COMMANDS of tests/routing/commands.js.
// A real definition in actions.js or queries.js always wins over an entry of that table.
// AT THE JOIN: set USE_SPEC_TABLE (below the imports) to false, then every command must exist in
// the real list.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const USE_SPEC_TABLE = false;

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
const T = await loadSrc('tests/routing/commands.js');
const F = await loadSrc('src/agent/rules/example_filter.js');

before(() => mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => mcdata.__setMcdataForTests(null));

const SPEC_DEFS = Object.fromEntries(T.SPEC_COMMANDS.map((c) => [c.name, T.specCommandDef(c)]));
const lookup = (name) => index.getCommand(name) ?? (USE_SPEC_TABLE ? SPEC_DEFS[name] : undefined);

const PROFILE_TEXT = fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8');
const PROFILE = JSON.parse(PROFILE_TEXT);
const GROUPS = { conversation_examples: PROFILE.conversation_examples, coding_examples: PROFILE.coding_examples };
const ALL_EXAMPLES = [...PROFILE.conversation_examples, ...PROFILE.coding_examples];

// Every turn of every example with a label for messages.
function turns(roles) {
    const found = [];
    for (const [group, examples] of Object.entries(GROUPS)) {
        examples.forEach((example, i) => {
            for (const turn of example) {
                if (roles.includes(turn.role)) found.push({ turn, label: `${group}[${i}] ${turn.role}: ${turn.content}` });
            }
        });
    }
    return found;
}

const PART_COMMAND_NAMES = Object.values(T.PART_COMMANDS).flat();

// The rows of R6 with a command of this release: the sentence and the command its example uses.
const NEW_EXAMPLES = [
    ['get to shelter', '!goToShelter'],
    ['eat some food!', '!eat'],
    ['this place is home, remember this', '!rememberArea'],
    ['do not ever forget to close the door behind yourself', '!rememberRule'],
    ["no, don't use wheat seeds, you need them to plant the wheat", '!rememberRule'],
    ["do not get logs from the house, you're destroying our shelter", '!rememberRule'],
    ['how much did you cost today?', '!cost'],
    // v0.1.4.7, part G: one example per command, from the words of the owner where there are any
    ['put it in the chest', '!storeItems'],
    ['get 5 bread from the chest', '!fetchItem'],
    ['whats in the chests?', '!chests'],
    ['get back to farming', '!farmCycle'],
    ['harvest the wheat pls', '!harvest'],
    ['plant the seeds', '!plant'],
    ['we need some fertilizer', '!makeBoneMeal'],
    ['make the wheat grow faster', '!fertilize'],
    ['collect some logs for me', '!chopTrees'],
    ['make yourself a stone pickaxe', '!getTool'],
    ['we need torches for the cave', '!craftSupplies'],
    ['find some iron', '!mineOre'],
    ['go down into the mine', '!goToMine'],
    ['come back up to the surface', '!leaveMine'],
];

const exampleOf = (sentence) => PROFILE.conversation_examples.find((example) => example.some((t) => t.role === 'user' && t.content.endsWith(': ' + sentence)));

describe('the file', () => {
    test('is valid JSON with the two lists of examples', () => {
        assert.ok(Array.isArray(PROFILE.conversation_examples));
        assert.ok(Array.isArray(PROFILE.coding_examples));
    });

    test('keeps one kind of line ending', () => {
        // The repository stores LF; a Windows checkout with core.autocrlf=true turns every line
        // into CRLF. Either is fine, a mix of the two is not.
        const lf = PROFILE_TEXT.split('\n').length - 1;
        const crlf = PROFILE_TEXT.split('\r\n').length - 1;
        assert.ok(crlf === lf || crlf === 0, `every line ends with CRLF or every line ends with LF (${crlf} of ${lf})`);
    });

    test('every example is a list of turns with a known role and a text', () => {
        for (const example of ALL_EXAMPLES) {
            assert.ok(Array.isArray(example) && example.length > 0, JSON.stringify(example));
            for (const turn of example) {
                assert.deepEqual(Object.keys(turn).sort(), ['content', 'role'], JSON.stringify(turn));
                assert.ok(['user', 'assistant', 'system'].includes(turn.role), JSON.stringify(turn));
                assert.equal(typeof turn.content, 'string', JSON.stringify(turn));
            }
        }
    });
});

describe('the parser with the real command list (R4)', () => {
    test('without a lookup the real command list is used', () => {
        assert.deepEqual(index.parseCommandMessage('!stats'), { commandName: '!stats', args: [] });
        assert.deepEqual(index.parseCommandMessage("!collectBlocks('stone', 10)"), { commandName: '!collectBlocks', args: ['stone', 10] });
        assert.equal(index.parseCommandMessage('!noSuchCommand'), '!noSuchCommand is not a command.');
    });

    test('executeCommand: the default of !getCraftingPlan (quantity 1) reaches perform()', async () => {
        const agent = { bot: { inventory: { items: () => [], slots: [] } } };
        const cap = captureConsole();
        let withDefault;
        let explicit;
        try {
            withDefault = await index.executeCommand(agent, '!getCraftingPlan("stick")');
            explicit = await index.executeCommand(agent, '!getCraftingPlan("stick", 1)');
        } finally {
            cap.restore();
        }
        assert.equal(typeof withDefault, 'string');
        assert.equal(withDefault, explicit);
        assert.ok(!withDefault.includes('was given'), withDefault);
    });

    test('getCommandDocs documents the real commands and writes the default of !getCraftingPlan', () => {
        const docs = index.getCommandDocs({ blocked_actions: [] });
        assert.ok(docs.includes('\n!stats: '));
        assert.ok(docs.includes('\n!goToPlayer: '));
        assert.ok(docs.includes("quantity: (number) The quantity of the item that we are trying to craft (optional, default 1)\n"), 'default of !getCraftingPlan');
    });
});

describe('the command table', () => {
    test('every existing command of the table is in the real command list', () => {
        for (const name of T.EXISTING_COMMANDS) assert.ok(index.commandExists(name), name);
    });

    test(`every command of the spec is known${USE_SPEC_TABLE ? ' (from the real list or the spec table)' : ' in the real list'}`, () => {
        for (const c of T.SPEC_COMMANDS) assert.ok(lookup(c.name), c.name);
    });
});

describe('every command call parses and names an existing command with that number of arguments', () => {
    test('calls in assistant turns', () => {
        let count = 0;
        for (const { turn, label } of turns(['assistant'])) {
            for (const call of F.commandCalls(turn.content)) {
                count++;
                const parsed = index.parseCommandMessage(turn.content.slice(call.index), lookup);
                assert.equal(typeof parsed, 'object', `${label}\n-> ${parsed}`);
                assert.equal(parsed.commandName, call.name, label);
                const def = lookup(call.name);
                assert.equal(parsed.args.length, Object.keys(def.params ?? {}).length, label);
            }
        }
        assert.ok(count >= 30, `${count} calls found`);
    });

    test('calls in user turns (commands of other bots)', () => {
        for (const { turn, label } of turns(['user'])) {
            for (const call of F.commandCalls(turn.content)) {
                const parsed = index.parseCommandMessage(turn.content.slice(call.index), lookup);
                assert.equal(typeof parsed, 'object', `${label}\n-> ${parsed}`);
            }
        }
    });

    test('an assistant turn has at most one command: the agent runs only the first', () => {
        for (const { turn, label } of turns(['assistant'])) {
            assert.ok(F.commandCalls(turn.content).length <= 1, label);
        }
    });

    test('strings are written in double quotes, as the command docs ask', () => {
        for (const { turn, label } of turns(['assistant', 'user'])) {
            for (const call of F.commandCalls(turn.content)) {
                const rest = turn.content.slice(call.index + call.name.length);
                assert.ok(!/^\(\s*'/.test(rest) && !/^\([^)]*,\s*'/.test(rest), label);
            }
        }
    });

    test('a call is followed by nothing that looks like a second closing parenthesis', () => {
        for (const { turn, label } of turns(['assistant', 'user'])) {
            for (const call of F.commandCalls(turn.content)) {
                const kept = index.truncCommandMessage(turn.content.slice(call.index));
                assert.ok(!turn.content.slice(call.index + kept.length).startsWith(')'), label);
            }
        }
    });

    test('every name that the filter finds is a known command, so hiding cannot drop an example by mistake', () => {
        for (const example of ALL_EXAMPLES) {
            for (const name of F.exampleCommands(example)) assert.ok(lookup(name), `${name} in ${JSON.stringify(example[0])}`);
        }
    });
});

describe('the examples of this release', () => {
    test('one example per row of R6 with a command of this release, with the sentence of the owner', () => {
        for (const [sentence, command] of NEW_EXAMPLES) {
            const example = exampleOf(sentence);
            assert.ok(example, `no example for "${sentence}"`);
            assert.ok(F.exampleCommands(example).includes(command), `"${sentence}" uses ${command}`);
        }
    });

    test('each of them uses a command that is hidden while its part is off', () => {
        for (const [sentence] of NEW_EXAMPLES) {
            const names = F.exampleCommands(exampleOf(sentence));
            assert.ok(names.some((n) => PART_COMMAND_NAMES.includes(n)), sentence);
        }
    });

    test('no other example uses a command of this release', () => {
        const mine = new Set(NEW_EXAMPLES.map(([sentence]) => exampleOf(sentence)));
        for (const example of ALL_EXAMPLES) {
            if (mine.has(example)) continue;
            for (const name of F.exampleCommands(example)) assert.ok(!PART_COMMAND_NAMES.includes(name), `${name} in ${JSON.stringify(example[0])}`);
        }
    });
});

describe('no example with a hidden command reaches the prompt', () => {
    const switches = Object.keys(T.PART_COMMANDS);

    test('for every combination of the part switches', () => {
        for (let mask = 0; mask < 1 << switches.length; mask++) {
            const settings = { world_memory: true };
            switches.forEach((part, i) => {
                settings[part] = Boolean(mask & (1 << i));
            });
            const hidden = new Set(T.hiddenPartCommands(settings));
            const isHidden = (name) => hidden.has(name);
            for (const [group, examples] of Object.entries(GROUPS)) {
                const visible = F.visibleExamples(examples, isHidden);
                for (const example of visible) {
                    for (const name of F.exampleCommands(example)) assert.ok(!hidden.has(name), `${group}, ${JSON.stringify(settings)}: ${name}`);
                }
                const expectedCount = examples.filter((e) => !F.exampleCommands(e).some((n) => hidden.has(n))).length;
                assert.equal(visible.length, expectedCount, `${group}, ${JSON.stringify(settings)}`);
            }
        }
    });

    test('with every part off, exactly the examples without a command of this release remain', () => {
        const hidden = new Set(T.hiddenPartCommands({ cost_meter: false }));
        const visible = F.visibleExamples(PROFILE.conversation_examples, (n) => hidden.has(n));
        const withoutNew = PROFILE.conversation_examples.filter((e) => !F.exampleCommands(e).some((n) => PART_COMMAND_NAMES.includes(n)));
        assert.deepEqual(visible, withoutNew);
        assert.equal(visible.length, PROFILE.conversation_examples.length - NEW_EXAMPLES.length);
    });

    test('with every part on, all examples remain', () => {
        const hidden = new Set(T.hiddenPartCommands({ player_rules: true, protected_areas: true, world_memory: true, home_pack: true, cost_meter: true,
            storage_pack: true, farming_pack: true, wood_pack: true, mining_pack: true }));
        assert.equal(hidden.size, 0);
        assert.equal(F.visibleExamples(PROFILE.conversation_examples, (n) => hidden.has(n)).length, PROFILE.conversation_examples.length);
    });
});
