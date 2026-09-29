// Spec v0.1.4.8, part F: F5 (repeat guard) -- src/agent/repeat_guard.js, RepeatGuard (I10), and
// looksLikeFailure: only failures count, a success ends the row (change of the tech lead).
// The clock is passed in, so every window is exact.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const MODULE = 'src/agent/repeat_guard.js';
const G = await loadSrc(MODULE);

const T0 = Date.UTC(2026, 8, 29, 1, 0, 0);
const SEC = 1000;
const MIN = 60 * SEC;
const NO_BREAD = 'You do not have any bread to eat.';
const EXAMPLE = 'I tried !consume("bread") 2 times with the same result: You do not have any bread to eat. '
    + 'I do not try a third time. Ask the player what to do.';
const SPEC_READ_ONLY = ['!stats', '!inventory', '!chests', '!areas', '!rules', '!cost', '!nearbyBlocks', '!craftable',
    '!savedPlaces', '!skills', '!help'];

// A guard on a test clock: clock.t is the time, clock.step(ms) moves it.
function newGuard(options = {}) {
    const clock = { t: T0, step(ms) { this.t += ms; } };
    const guard = new G.RepeatGuard({ now: () => clock.t, ...options });
    return { guard, clock };
}

// Runs the command through the guard as part G will: check first, record only when it ran.
function attempt(guard, name, args, result) {
    const refusal = guard.check(name, args);
    if (refusal === null)
        guard.record(name, args, result);
    return refusal;
}

describe('module', () => {
    test('imports nothing', () => {
        assertImportRules(MODULE, { allowBuiltins: [], allowedRelative: [] });
    });

    test('imports without output and without creating files', () => {
        assertCleanImport(MODULE);
    });

    test('exports RepeatGuard, the read-only commands of the spec, commandText', () => {
        assert.equal(typeof G.RepeatGuard, 'function');
        assert.deepEqual([...G.READ_ONLY_COMMANDS].sort(), [...SPEC_READ_ONLY].sort());
        assert.equal(typeof G.commandText, 'function');
        assert.equal(G.REPEAT_WINDOW_MS, 5 * MIN);
    });
});

describe('commandText', () => {
    test('the command as the model writes it', () => {
        assert.equal(G.commandText('!consume', ['bread']), '!consume("bread")');
        assert.equal(G.commandText('mineOre', ['iron', 8]), '!mineOre("iron", 8)');
        assert.equal(G.commandText('!mineOre', ['iron', 8, true]), '!mineOre("iron", 8, true)');
        assert.equal(G.commandText('!stop', []), '!stop');
        assert.equal(G.commandText('!stop'), '!stop');
        assert.equal(G.commandText('!say', ['a "quote"']), '!say("a \\"quote\\"")');
    });
});

describe('RepeatGuard', () => {
    test('the example of the spec, word for word (limit 3)', () => {
        const { guard, clock } = newGuard({ limit: 3 });
        assert.equal(attempt(guard, '!consume', ['bread'], NO_BREAD), null);
        clock.step(10 * SEC);
        assert.equal(attempt(guard, '!consume', ['bread'], NO_BREAD), null);
        clock.step(10 * SEC);
        assert.equal(guard.check('!consume', ['bread']), EXAMPLE);
    });

    test('the Nth identical failure is refused: limit 2 and limit 4', () => {
        const two = newGuard({ limit: 2 }).guard;
        assert.equal(attempt(two, '!consume', ['bread'], NO_BREAD), null);
        assert.equal(two.check('!consume', ['bread']),
            'I tried !consume("bread") 1 time with the same result: You do not have any bread to eat. I do not try a second time. Ask the player what to do.');
        const four = newGuard({ limit: 4 }).guard;
        for (let i = 0; i < 3; i++)
            assert.equal(attempt(four, '!consume', ['bread'], NO_BREAD), null, `try ${i + 1}`);
        assert.match(four.check('!consume', ['bread']), /^I tried !consume\("bread"\) 3 times .* I do not try a fourth time\. /);
    });

    test('0 is off; 1 counts as off too, it would refuse every first try', () => {
        for (const limit of [0, 1, undefined, -3, NaN, 'x']) {
            const { guard } = newGuard({ limit });
            assert.equal(guard.enabled, false, String(limit));
            for (let i = 0; i < 10; i++)
                assert.equal(attempt(guard, '!consume', ['bread'], NO_BREAD), null, `${limit}: try ${i + 1}`);
        }
    });

    test('other arguments are another command', () => {
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['apple']), null);
        assert.notEqual(guard.check('!consume', ['bread']), null);
    });

    test('another failure text starts a new row', () => {
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!givePlayer', ['Marty', 'bread', 1], 'Failed to give bread to Marty, too close.');
        attempt(guard, '!givePlayer', ['Marty', 'bread', 1], 'You do not have any bread to discard.');
        assert.equal(guard.check('!givePlayer', ['Marty', 'bread', 1]), null);
        attempt(guard, '!givePlayer', ['Marty', 'bread', 1], 'You do not have any bread to discard.');
        assert.match(guard.check('!givePlayer', ['Marty', 'bread', 1]), /2 times with the same result: You do not have any bread to discard\. /);
    });

    test('successes never count: "come here" three times in a row is obeyed', () => {
        for (const limit of [2, 3]) {
            const { guard, clock } = newGuard({ limit });
            for (let i = 0; i < 5; i++) {
                assert.equal(attempt(guard, '!goToPlayer', ['steve', 3], 'You have reached steve.'), null, `limit ${limit}, try ${i + 1}`);
                clock.step(20 * SEC);
            }
            assert.equal(guard.check('!goToPlayer', ['steve', 3]), null);
        }
    });

    test('a success ends the row of failures, like a different command', () => {
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        attempt(guard, '!consume', ['bread'], 'Consumed bread.');
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['bread']), null);
    });

    test('the fourth parameter decides: true is a failure, false a success, whatever the text', () => {
        const { guard } = newGuard({ limit: 3 });
        const neutral = 'Farm "farm": 48 plants are growing. Nothing to do now.';
        guard.record('!farmCycle', ['farm'], neutral, true);
        guard.record('!farmCycle', ['farm'], neutral, true);
        assert.match(guard.check('!farmCycle', ['farm']), /^I tried !farmCycle\("farm"\) 2 times with the same result: /);
        const other = newGuard({ limit: 3 }).guard;
        other.record('!consume', ['bread'], NO_BREAD, false);
        other.record('!consume', ['bread'], NO_BREAD, false);
        assert.equal(other.check('!consume', ['bread']), null, 'false: a success, the row ends');
        other.record('!consume', ['bread'], NO_BREAD, true);
        other.record('!consume', ['bread'], NO_BREAD, 'yes');
        assert.equal(other.check('!consume', ['bread']), EXAMPLE, 'not a boolean: the text decides');
    });

    test('without the fourth parameter: ok or success of an object result, else the text', () => {
        const { guard } = newGuard({ limit: 3 });
        const text = 'I stored nothing new.';
        guard.record('!storeItems', [], { ok: false, text });
        guard.record('!storeItems', [], { ok: false, text });
        assert.match(guard.check('!storeItems', []), /2 times with the same result: I stored nothing new\. /);
        const other = newGuard({ limit: 3 }).guard;
        other.record('!consume', ['bread'], { success: true, message: NO_BREAD });
        other.record('!consume', ['bread'], { success: true, message: NO_BREAD });
        assert.equal(other.check('!consume', ['bread']), null);
        const neutral = newGuard({ limit: 3 }).guard;
        neutral.record('!setMode', ['cowardice', true], 'Mode cowardice is now on.');
        neutral.record('!setMode', ['cowardice', true], 'Mode cowardice is now on.');
        assert.equal(neutral.check('!setMode', ['cowardice', true]), null, 'no sign of a failure: no count');
    });

    test('a different command in between ends the row', () => {
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        attempt(guard, '!collectBlocks', ['wheat', 3], 'Collected 3 wheat.');
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['bread']), null, 'only 1 in the row');
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['bread']), EXAMPLE);
    });

    test('commands that only read are never counted and do not end the row', () => {
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        for (const name of SPEC_READ_ONLY)
            assert.equal(attempt(guard, name, [], 'INVENTORY: apple 1'), null, name);
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['bread']), EXAMPLE);
        for (let i = 0; i < 5; i++)
            assert.equal(attempt(guard, '!inventory', [], 'INVENTORY: nothing'), null, 'a read-only command is never refused');
    });

    test('the row counts only within the window of 5 minutes', () => {
        const { guard, clock } = newGuard({ limit: 3 });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        clock.step(4 * MIN);
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        clock.step(MIN); // the first try is now exactly 5 minutes old: out of the window
        assert.equal(guard.check('!consume', ['bread']), null);
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['bread']), EXAMPLE, 'the second and the third try are within 5 minutes');
    });

    test('windowMs can be set', () => {
        const { guard, clock } = newGuard({ limit: 3, windowMs: 10 * SEC });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        clock.step(11 * SEC);
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['bread']), null);
    });

    test('an empty result ends the row (a stopped command returns nothing)', () => {
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        attempt(guard, '!consume', ['bread'], undefined);
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['bread']), null);
        attempt(guard, '!consume', ['bread'], '   ');
        assert.equal(guard.check('!consume', ['bread']), null);
    });

    test('a recorded refusal is ignored; the next try stays refused', () => {
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        const refusal = guard.check('!consume', ['bread']);
        guard.record('!consume', ['bread'], refusal);
        assert.equal(guard.check('!consume', ['bread']), EXAMPLE);
    });

    test('a command that the player runs anyway counts on: the text names the real number', () => {
        const { guard } = newGuard({ limit: 3 });
        for (let i = 0; i < 3; i++)
            guard.record('!consume', ['bread'], NO_BREAD);
        assert.match(guard.check('!consume', ['bread']), /3 times .* I do not try a fourth time\./);
    });

    test('the name with or without "!", the result as a text or as { message }', () => {
        const { guard } = newGuard({ limit: 3 });
        guard.record('consume', ['bread'], NO_BREAD);
        guard.record('!consume', ['bread'], { success: false, message: `  ${NO_BREAD}\n` });
        assert.equal(guard.check('consume', ['bread']), EXAMPLE);
    });

    test('a long result is cut to 200 characters in the refusal; a text without an end gets a period', () => {
        const long = `Could not do it: ${'x'.repeat(400)}`;
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!craftRecipe', ['bread', 1], long);
        attempt(guard, '!craftRecipe', ['bread', 1], long);
        const refusal = guard.check('!craftRecipe', ['bread', 1]);
        const middle = refusal.slice(refusal.indexOf('result: ') + 8, refusal.indexOf(' I do not try'));
        assert.equal(middle.length, 200);
        assert.ok(middle.endsWith('...'));
        const short = newGuard({ limit: 3 }).guard;
        attempt(short, '!craftRecipe', ['bread', 1], 'I cannot craft bread without wheat');
        attempt(short, '!craftRecipe', ['bread', 1], 'I cannot craft bread without wheat');
        assert.match(short.check('!craftRecipe', ['bread', 1]), /same result: I cannot craft bread without wheat\. I do not try/);
    });

    test('ordinals beyond ten', () => {
        const { guard } = newGuard({ limit: 12 });
        for (let i = 0; i < 11; i++)
            guard.record('!consume', ['bread'], NO_BREAD);
        assert.match(guard.check('!consume', ['bread']), /I do not try a 12th time\./);
        for (let i = 0; i < 10; i++)
            guard.record('!consume', ['bread'], NO_BREAD);
        assert.match(guard.check('!consume', ['bread']), /I do not try a 22nd time\./);
    });

    test('reset forgets the row', () => {
        const { guard } = newGuard({ limit: 3 });
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        attempt(guard, '!consume', ['bread'], NO_BREAD);
        guard.reset();
        assert.equal(guard.check('!consume', ['bread']), null);
    });

    test('never throws: odd names, odd arguments, a broken clock', () => {
        const { guard } = newGuard({ limit: 2, now: () => { throw new Error('no clock'); } });
        for (const name of [undefined, null, '', 5, {}, '!consume'])
            for (const args of [undefined, null, 'bread', [{ a: 1 }], [undefined]]) {
                assert.doesNotThrow(() => guard.record(name, args, NO_BREAD));
                assert.doesNotThrow(() => guard.check(name, args));
            }
        const cyclic = [];
        cyclic.push(cyclic);
        assert.doesNotThrow(() => guard.record('!x', [cyclic], 'r'));
        assert.doesNotThrow(() => guard.check('!x', [cyclic]));
    });

    test('the default clock and window', () => {
        const guard = new G.RepeatGuard({ limit: 3 });
        guard.record('!consume', ['bread'], NO_BREAD);
        guard.record('!consume', ['bread'], NO_BREAD);
        assert.equal(guard.check('!consume', ['bread']), EXAMPLE);
        assert.equal(guard.windowMs, 5 * MIN);
    });
});

// Texts of skills.js, actions.js, the packs, and the logs of the play test of v0.1.4.7
// (lines "Agent executed: !x and got: ..."). An action output holds several lines.
const out = (...lines) => ['Action output:', ...lines].join('\n');

describe('looksLikeFailure', () => {
    test('is exported and pure', () => {
        assert.equal(typeof G.looksLikeFailure, 'function');
    });

    test('the failures of the play test count', () => {
        const failures = [
            'You do not have any bread to eat.',
            out('You do not have any bread to eat.'),
            'I have no food.',
            'I carry no food. The chest at (11, 67, 53) has 5 apple.',
            'I carry no food and know no chest with food.',
            'I found no fenced ground here. Stand inside the fence and try again.',
            'I found no composter within 32 blocks.',
            'I found nothing to compost. I do not use seeds for that. I have no shears, so I can only collect flowers and saplings.',
            'I know no mine for iron.',
            'I know no mine for iron. I can dig a new one at (4, 70, -20), 30 blocks from your house. Tell me to do it, or show me your mine.',
            'I know no chest with oak_planks.',
            'I cannot sleep now, it is not night.',
            'I cannot sleep now, it is day. The night starts in about 5 minutes.',
            'Don\'t have any oak_door to place.',
            out('Don\'t have any oak_door to place.'),
            'It requires: cobblestone: 3, stick: 2.',
            out('You do not have the resources to craft a stone_pickaxe. It requires: cobblestone: 3, stick: 2.'),
            'Failed to give bread to MartyByrde2, too close.',
            out('Found non-destructive path.', 'You have reached MartyByrde2.', '1', 'Failed to give bread to MartyByrde2, too close.'),
            out('Found non-destructive path.', 'You have reached MartyByrde2.', '1', 'You do not have any wheat to discard.',
                'Failed to give wheat to MartyByrde2, it was never received.'),
            'Error: Param \'num\' must be of type int.',
            'Error: Param \'search_range\' must be an element of [32, 512).',
            out('Found non-destructive path.', 'You have reached at 11, 67, 53.', 'Could not find any bread in the chest.'),
            out('Could not find any poppy in 32 blocks.'),
            'Invalid block type: grass.',
            out('Cannot smelt wheat_seeds. Hint: make sure you are smelting the \'raw\' item.'),
            out('No dandelion nearby to collect.', 'Collected 0 dandelion.'),
            'I could not get to a chest nearby or open it. I still carry 29 wheat_seeds, 17 wheat, 6 leaf_litter.',
            'I mined 0 raw_iron of 8. I stopped because I found no way there. I could not get to the place for the mine at (-3, 27, 55).',
            'I know no farm here. Stand in the farm and tell me that this is the farm.',
            'I broke 10 tall_grass and got nothing. tall_grass drops nothing without shears.',
            'I stopped at (4, 64, 9), 12 blocks from the goal.',
            'I see no items on the ground within 16 blocks.',
            'Farm "farm": I found no composter at the farm or within 32 blocks.',
        ];
        for (const text of failures)
            assert.equal(G.looksLikeFailure(text), true, text);
    });

    test('the successes of the play test do not count', () => {
        const successes = [
            'You have reached (12, 67, 53).',
            'You have reached MartyByrde2.',
            out('Found non-destructive path.', 'You have reached MartyByrde2.'),
            out('Path not found, but attempting to navigate anyway using destructive movements.', 'You have reached at 12, 67, 53.'),
            'Collected 3 oak_log.',
            out('Failed to collect leaf_litter: Timeout: Took to long to decide path to goal!.', 'Collected 2 leaf_litter.'),
            'I stored 15 granite, 15 wheat_seeds in the chest at (11, 67, 53).',
            'I harvested 6 wheat and planted 6 again. 52 plants are not ripe yet.',
            'Consumed bread.',
            out('Consumed bread.'),
            'I slept. It is morning.',
            'Location saved as "home".',
            'Agent stopped.',
            'I ate 2 bread. Food 19 of 20, health 12 of 20.',
            'I crafted a stone_pickaxe.',
            'I took 3 coal from the chest at (11, 67, 53).',
            out('Found non-destructive path.', 'You have reached MartyByrde2.', '3', 'Discarded 3 wheat.', 'MartyByrde2 received wheat.'),
            out('Found non-destructive path.', 'You have reached at 11, 67, 53.', 'Successfully took 3 apple from the chest.'),
            'I found no building here. I saved a box of 25 x 13 x 25 blocks around this place as "pen". Use !setArea to correct it.',
            'I made 1 bone_meal from 19 items. The composter is at level 4 of 7, I have nothing more to compost. I have no shears, so I can only collect flowers and saplings.',
            'Rule 3 saved: "Always close the door."',
            'Area "farm" (farm) saved: 8 x 5 x 12 blocks, from (-13, 61, 23) to (-6, 65, 34), 1 gate. Tell me if that is wrong.',
            out('Found non-destructive path.', 'Moved away from (1, 64, 1) to (6, 64, 1).'),
        ];
        for (const text of successes)
            assert.equal(G.looksLikeFailure(text), false, text);
    });

    test('in doubt: no failure', () => {
        const unclear = [
            '', '   ', 'Mode creeper_safety is now off.', out('Found non-destructive path.'),
            'Farm "farm": Nothing is ripe yet. 58 plants are growing. I planted 0 wheat_seeds. I have no hoe, so I planted only where the ground was farmland. The gate is closed.',
            'I cut 3 oak_log and picked up 2. I was stopped before I picked up the rest.',
            'I am not hungry. Food 19 of 20, health 20 of 20.',
            'Chests I know in this world:', 'Stayed for 30 seconds.', 'No creeper is near me.',
            'Path not found, but attempting to navigate anyway using destructive movements.',
            'The chest at (11, 67, 53) contains: leaf_litter 104, cobblestone 81.',
            'I tried !consume("bread") 2 times with the same result: You do not have any bread to eat. I do not try a third time. Ask the player what to do.',
        ];
        for (const text of unclear)
            assert.equal(G.looksLikeFailure(text), false, JSON.stringify(text));
        for (const value of [undefined, null, 5, {}, ['I have no food.']])
            assert.equal(G.looksLikeFailure(value), false, String(value));
    });
});
