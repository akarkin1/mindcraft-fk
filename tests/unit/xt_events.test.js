// Tests from the spec (v0.1.4.13, section 6, T1): the help patterns of part S (SPEC 4.1): a text that asks the
// player (ends with `?`, contains `Say "` or `Tell me`) becomes an event of kind help, only with
// settings.supervisor_name set, with the text `Help: "<the line>"`; the spec's own example help text; the report
// event (kind report, the digest lines joined with `; `, or `Nothing changed.`). A failing test is a finding.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { HELP_PATTERNS, asksThePlayer, helpEvent, reportEvent } from '../../src/agent/watch/events_logic.js';
import { T0 } from '../helpers/xt_watch.js';
import { noTunnelText } from '../../src/agent/packs/mining/texts.js';

const EXAMPLE = 'Your mine "deep" has no tunnel where diamond is found. Show me a tunnel at that depth, or tell me to dig a new mine.';

describe('SPEC 4.1 the help patterns', () => {
    test('HELP_PATTERNS is a tested list of patterns', () => {
        assert.ok(Array.isArray(HELP_PATTERNS));
        assert.ok(HELP_PATTERNS.length >= 3);
        for (const p of HELP_PATTERNS)
            assert.ok(p instanceof RegExp, 'each pattern is a regular expression');
    });

    test('a text that ends with ? asks the player', () => {
        assert.equal(asksThePlayer('Which ore do you want?'), true);
        assert.equal(asksThePlayer('Do you want me to dig a new mine? '), true);
    });

    test('a text with Say " asks the player', () => {
        assert.equal(asksThePlayer('That is a lot. Say "put my stuff in the chest" and I put it in the nearest chest.'), true);
        assert.equal(asksThePlayer('I do not dig a shaft 64 blocks down. Say "dig down" if you mean it, or show me stairs.'), true);
    });

    test('a text with Tell me asks the player', () => {
        assert.equal(asksThePlayer('I know no mine here. Tell me where to dig.'), true);
    });

    test('the example help text of the spec asks the player', () => {
        // FINDING (T1-help-1): the spec's one example of a help event, "... Show me a tunnel at that depth, or tell me
        // to dig a new mine.", ends with a full stop and says "tell me" in lower case; the code's patterns are
        // /\?\s*$/, /Say "/ and /Tell me/ (case-sensitive), so the spec's own example gives no help event.
        assert.equal(asksThePlayer(EXAMPLE), true);
    });

    test('the mining pack\'s own text of the example (no tunnel for the ore) asks the player', () => {
        // FINDING (T1-help-1), the same cause: the text the mining pack says in that case, `Your mine "deep" has no
        // tunnel where diamond is found (from -64 to 16). It has no tunnel yet. Show me a tunnel at that depth, or
        // tell me to dig a new mine.`, gives no help event, so a supervisor never hears of it.
        const text = noTunnelText({ name: 'deep' }, 'diamond', []);
        assert.match(text, /Show me a tunnel at that depth, or tell me to dig a new mine\.$/);
        assert.equal(asksThePlayer(text), true, text);
    });

    test('a plain report does not ask the player', () => {
        assert.equal(asksThePlayer('I mined 8 raw_iron. The mine is at (20, 64, -14).'), false);
        assert.equal(asksThePlayer('I go back to the mining, 6 of 16 iron.'), false);
        assert.equal(asksThePlayer('What I say is "hello" and I said it.'), false);
        assert.equal(asksThePlayer(''), false);
    });
});

describe('SPEC 4.1 the help event', () => {
    test('with supervisor_name set: kind help, the text Help: "<line>"', () => {
        const event = helpEvent('Which ore do you want?', 'Opus', T0);
        assert.ok(event);
        assert.equal(event.kind, 'help');
        assert.equal(event.text, 'Help: "Which ore do you want?"');
    });

    test('the example of the spec, word for word', () => {
        // FINDING (T1-help-1), see above: null instead of the event
        const event = helpEvent(EXAMPLE, 'Opus', T0);
        assert.ok(event, 'the example help text of the spec gives a help event');
        assert.equal(event.text, `Help: "${EXAMPLE}"`);
    });

    test('without supervisor_name no event', () => {
        assert.equal(helpEvent('Which ore do you want?', '', T0), null);
        assert.equal(helpEvent('Which ore do you want?', undefined, T0), null);
    });

    test('a text that does not ask gives no event', () => {
        assert.equal(helpEvent('I mined 8 raw_iron.', 'Opus', T0), null);
    });
});

describe('SPEC 4.1 the report event', () => {
    test('the digest lines since the last report, one line joined with ; ', () => {
        const event = reportEvent(['Health 20 of 20, food 15 of 20.', 'Hand: iron_pickaxe, 41 uses left.'], T0);
        assert.equal(event.kind, 'report');
        assert.equal(event.text, 'Health 20 of 20, food 15 of 20.; Hand: iron_pickaxe, 41 uses left.');
    });

    test('Nothing changed. when no line changed', () => {
        assert.equal(reportEvent([], T0).text, 'Nothing changed.');
    });
});
