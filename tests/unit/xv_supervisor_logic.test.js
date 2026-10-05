// Spec v0.1.4.13 4.5 (part N2), the pure parts of the supervisor in the chat (src/agent/watch/supervisor_logic.js):
// the texts word for word, the message event of a line that names the supervisor, presence, the one bot that says
// nobody is here, the relayed line, the hold rule of HANDOFF round 1 from staged clocks (a supervisor's line waits
// while the owner's last line has no bot answer yet, up to 10 s, and for 3 s after a bot line; an update held over
// 20 s is dropped), the arguments of reply and note, the note's expiry and its line in the prompt.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../src/agent/watch/supervisor_logic.js';
import { roleLine } from '../../src/agent/bots_logic.js';
import { eventLine } from '../../src/agent/watch/events_logic.js';

const T0 = new Date(2026, 9, 4, 6, 45, 12).getTime();

describe('the texts of 4.5, word for word', () => {
    test('notHere, message, updatesOff, dropped, noted, the prompt line, the relayed line', () => {
        assert.equal(L.SUPERVISOR_TEXTS.notHere, 'The supervisor is not here.');
        assert.equal(L.SUPERVISOR_TEXTS.message('why is it going to the surface?'), 'Message: "why is it going to the surface?"');
        assert.equal(L.SUPERVISOR_TEXTS.updatesOff, 'Updates are off.');
        assert.equal(L.SUPERVISOR_TEXTS.dropped, 'Dropped: the bot was speaking.');
        assert.equal(L.SUPERVISOR_TEXTS.noted(30, 'the chest at (15, -59, -99) has bread'), 'Noted for 30 min: "the chest at (15, -59, -99) has bread".');
        assert.equal(L.SUPERVISOR_TEXTS.supervisorLine('the chest at (15, -59, -99) has bread.'), 'Supervisor: the chest at (15, -59, -99) has bread.');
        assert.equal(L.relayLine('Opus', 'It is in the tunnel.'), '[Opus] It is in the tunnel.');
    });

    test('the limits: 256 characters a reply, 200 a note, 1 to 120 minutes, 30 by default, 60 s of presence', () => {
        assert.equal(L.SUPERVISOR_RULES.replyMax, 256);
        assert.equal(L.SUPERVISOR_RULES.noteMax, 200);
        assert.equal(L.SUPERVISOR_RULES.minutesMin, 1);
        assert.equal(L.SUPERVISOR_RULES.minutesMax, 120);
        assert.equal(L.SUPERVISOR_RULES.minutesDefault, 30);
        assert.equal(L.SUPERVISOR_RULES.presenceMs, 60000);
        assert.equal(L.SUPERVISOR_RULES.answerWaitMs, 10000);
        assert.equal(L.SUPERVISOR_RULES.afterBotLineMs, 3000);
        assert.equal(L.SUPERVISOR_RULES.dropAfterMs, 20000);
    });
});

describe('the message event', () => {
    test('a line that names the supervisor: the words without the address, data.from and data.text', () => {
        const event = L.messageEvent('Opus, why is it going to the surface?', 'MartyByrde2', 'Opus', T0);
        assert.equal(event.kind, 'message');
        assert.equal(event.text, 'Message: "why is it going to the surface?"');
        assert.deepEqual(event.data, { from: 'MartyByrde2', text: 'why is it going to the surface?' });
        assert.equal(event.t, new Date(T0).toISOString());
        assert.equal(eventLine(event), '[06:45:12] message: Message: "why is it going to the surface?"');
    });

    test('the address of N1: after hey, without case; the address alone is the whole line', () => {
        assert.equal(L.messageText('hey opus where is it?', 'Opus'), 'where is it?');
        assert.equal(L.messageText('ok so Opus: stop it', 'Opus'), 'stop it');
        assert.equal(L.messageText('Opus?', 'Opus'), 'Opus?');
    });

    test('no event: a line for a bot, a name inside, no name set', () => {
        assert.equal(L.messageEvent('claude, come here', 'MartyByrde2', 'Opus', T0), null);
        assert.equal(L.messageEvent('tell Opus to wait', 'MartyByrde2', 'Opus', T0), null);
        assert.equal(L.messageEvent('Opus, where is it?', 'MartyByrde2', '', T0), null);
        assert.equal(L.messageEvent('Opus, where is it?', 'MartyByrde2', undefined, T0), null);
    });

    test('supervisorName: trimmed, "" without one', () => {
        assert.equal(L.supervisorName({ supervisor_name: ' Opus ' }), 'Opus');
        assert.equal(L.supervisorName({ supervisor_name: '' }), '');
        assert.equal(L.supervisorName({}), '');
        assert.equal(L.supervisorName(null), '');
    });
});

describe('presence', () => {
    test('a wait or digest within 60 s', () => {
        assert.equal(L.isConnected(T0 - 12000, T0), true);
        assert.equal(L.isConnected(T0 - 60000, T0), true);
        assert.equal(L.isConnected(T0 - 60001, T0), false);
        assert.equal(L.isConnected(null, T0), false);
        assert.equal(L.isConnected(undefined, T0), false);
    });

    test('a wait still open counts, however old its start', () => {
        assert.equal(L.isConnected(T0 - 90000, T0, 60000, 1), true);
        assert.equal(L.isConnected(null, T0, 60000, 2), true);
        assert.equal(L.isConnected(T0 - 90000, T0, 60000, 0), false);
    });
});

describe('one bot says that nobody is here', () => {
    test('the first agent of the mindserver in the game', () => {
        assert.equal(L.speaksForAll('claude', ['claude', 'gpt']), true);
        assert.equal(L.speaksForAll('gpt', ['claude', 'gpt']), false);
    });

    test('alone, without a list, or not in it: it speaks', () => {
        assert.equal(L.speaksForAll('claude', []), true);
        assert.equal(L.speaksForAll('claude', undefined), true);
        assert.equal(L.speaksForAll('claude', ['gpt']), true);
        assert.equal(L.speaksForAll('claude', ['claude'], { hostsWatch: false, peersOnline: [] }), true);
    });

    test('bots in their own processes (other_bots online): the one with the watch server speaks, the other is quiet', () => {
        assert.equal(L.speaksForAll('claude', ['claude'], { hostsWatch: true, peersOnline: ['gpt'] }), true);
        assert.equal(L.speaksForAll('gpt', ['gpt'], { hostsWatch: false, peersOnline: ['claude'] }), false);
        assert.equal(L.speaksForAll('gpt', ['gpt'], { hostsWatch: false, peersOnline: ['gpt'] }), true, 'itself is no peer');
        // one mindserver: its order wins
        assert.equal(L.speaksForAll('claude', ['claude', 'gpt'], { hostsWatch: false, peersOnline: ['gpt'] }), true);
        assert.equal(L.speaksForAll('gpt', ['claude', 'gpt'], { hostsWatch: true, peersOnline: ['claude'] }), false);
    });
});

describe('the relayed line', () => {
    test('kindOf: answer by default, update, nothing else', () => {
        assert.equal(L.kindOf(undefined), 'answer');
        assert.equal(L.kindOf(''), 'answer');
        assert.equal(L.kindOf('answer'), 'answer');
        assert.equal(L.kindOf('update'), 'update');
        assert.equal(L.kindOf('note'), null);
        assert.equal(L.kindOf(3), null);
    });

    test('relayLine folds blanks; isRelayedLine knows the name in brackets', () => {
        assert.equal(L.relayLine(' Opus ', ' It is\nin  the tunnel. '), '[Opus] It is in the tunnel.');
        assert.equal(L.isRelayedLine('[Opus] It is in the tunnel.', 'Opus'), true);
        assert.equal(L.isRelayedLine('Opus, where is it?', 'Opus'), false);
        assert.equal(L.isRelayedLine('[Opus] x', ''), false);
    });
});

describe('the hold rule: nobody speaks over anybody (staged clocks)', () => {
    const t = (s) => T0 + s * 1000;

    test('W111: an update 300 ms after the owner\'s order waits for the bot\'s answer (1.5 s) and 3 s after it', () => {
        const owner = t(0);
        const queuedAt = t(0.3);
        // before the answer: held
        for (const s of [0.3, 0.8, 1.4])
            assert.equal(L.holdDecision({ now: t(s), kind: 'update', queuedAt, ownerLineAt: owner, botLineAt: null }), 'hold', `at ${s} s`);
        // the answer at 1.5 s: held 3 s more
        for (const s of [1.5, 3.0, 4.4])
            assert.equal(L.holdDecision({ now: t(s), kind: 'update', queuedAt, ownerLineAt: owner, botLineAt: t(1.5) }), 'hold', `at ${s} s`);
        assert.equal(L.holdDecision({ now: t(4.5), kind: 'update', queuedAt, ownerLineAt: owner, botLineAt: t(1.5) }), 'relay');
    });

    test('the owner\'s line without an answer holds up to 10 s, then the line goes', () => {
        const owner = t(0);
        assert.equal(L.holdDecision({ now: t(9.9), kind: 'answer', queuedAt: t(1), ownerLineAt: owner }), 'hold');
        assert.equal(L.holdDecision({ now: t(10), kind: 'answer', queuedAt: t(1), ownerLineAt: owner }), 'relay');
        // an older bot line is no answer to the owner's line
        assert.equal(L.holdDecision({ now: t(5), kind: 'answer', queuedAt: t(1), ownerLineAt: owner, botLineAt: t(-1) }), 'hold');
    });

    test('nobody spoke: at once', () => {
        assert.equal(L.holdDecision({ now: t(0), kind: 'answer', queuedAt: t(0) }), 'relay');
        assert.equal(L.holdDecision({ now: t(0), kind: 'update', queuedAt: t(0), ownerLineAt: t(-30), botLineAt: t(-29) }), 'relay');
    });

    test('an update held over 20 s is dropped; an answer is relayed then', () => {
        const busy = { ownerLineAt: null, botLineAt: t(20.5) }; // the bot spoke again and again
        assert.equal(L.holdDecision({ now: t(20), kind: 'update', queuedAt: t(0), ...busy }), 'hold');
        assert.equal(L.holdDecision({ now: t(20.1), kind: 'update', queuedAt: t(0), ...busy }), 'drop');
        assert.equal(L.holdDecision({ now: t(20.1), kind: 'answer', queuedAt: t(0), ...busy }), 'relay');
    });

    test('holdStep: the answers before the updates, each by its time; the drop per line', () => {
        const a1 = { kind: 'answer', queuedAt: t(2) };
        const u1 = { kind: 'update', queuedAt: t(1) };
        const a2 = { kind: 'answer', queuedAt: t(3) };
        const old = { kind: 'update', queuedAt: t(-25) };
        const free = L.holdStep([u1, a2, old, a1], { now: t(4) });
        assert.deepEqual(free.relay, [a1, a2, u1]);
        assert.deepEqual(free.drop, [old]);
        assert.deepEqual(free.keep, []);
        const busy = L.holdStep([u1, a1, old], { now: t(4), botLineAt: t(3) });
        assert.deepEqual(busy.relay, []);
        assert.deepEqual(busy.drop, [old]);
        assert.deepEqual(busy.keep, [a1, u1]);
        assert.deepEqual(L.holdStep(undefined, { now: t(0) }), { relay: [], drop: [], keep: [] });
    });
});

describe('the arguments of reply and note', () => {
    test('reply: a text of 1 to 256 characters, kind answer or update', () => {
        assert.equal(L.replyRefusal({ text: 'It is in the tunnel.' }), null);
        assert.equal(L.replyRefusal({ text: 'x'.repeat(256), kind: 'update' }), null);
        assert.equal(L.replyRefusal({ text: 'x'.repeat(257) }), 'reply takes a text of 1 to 256 characters.');
        assert.equal(L.replyRefusal({ text: '  ' }), 'reply takes a text of 1 to 256 characters.');
        assert.equal(L.replyRefusal({}), 'reply takes a text of 1 to 256 characters.');
        assert.equal(L.replyRefusal({ text: 'hi', kind: 'shout' }), 'reply takes kind: answer or update, not "shout".');
    });

    test('note: at most 200 characters, "" clears; minutes 1 to 120, also as a string', () => {
        assert.equal(L.noteRefusal({ text: '' }), null);
        assert.equal(L.noteRefusal({ text: 'x'.repeat(200), minutes: 120 }), null);
        assert.equal(L.noteRefusal({ text: 'x'.repeat(201) }), 'note takes a text of at most 200 characters.');
        assert.equal(L.noteRefusal({}), 'note takes a text of at most 200 characters.');
        assert.equal(L.noteRefusal({ text: 'a', minutes: 0 }), 'note takes minutes of 1 to 120, not "0".');
        assert.equal(L.noteRefusal({ text: 'a', minutes: 121 }), 'note takes minutes of 1 to 120, not "121".');
        assert.equal(L.noteRefusal({ text: 'a', minutes: 1.5 }), 'note takes minutes of 1 to 120, not "1.5".');
        assert.equal(L.noteMinutes(undefined), 30);
        assert.equal(L.noteMinutes('45'), 45);
        assert.equal(L.noteMinutes(1), 1);
    });
});

describe('the note: one at a time, expiring, one line in the prompt', () => {
    const NOTE = 'the chest at (15, -59, -99) has bread.';

    test('noteOf: the text, the minutes, until; "" clears', () => {
        assert.deepEqual(L.noteOf(` ${NOTE} `, undefined, T0), { text: NOTE, minutes: 30, at: T0, until: T0 + 30 * 60000 });
        assert.deepEqual(L.noteOf(NOTE, 5, T0), { text: NOTE, minutes: 5, at: T0, until: T0 + 5 * 60000 });
        assert.equal(L.noteOf('', 5, T0), null);
        assert.equal(L.noteOf('   ', 5, T0), null);
    });

    test('noteText: "Supervisor: <text>" until it expires, then nothing', () => {
        const note = L.noteOf(NOTE, 5, T0);
        assert.equal(L.noteText(note, T0), `Supervisor: ${NOTE}`);
        assert.equal(L.noteText(note, T0 + 5 * 60000 - 1), `Supervisor: ${NOTE}`);
        assert.equal(L.noteText(note, T0 + 5 * 60000), '');
        assert.equal(L.noteText(null, T0), '');
        assert.equal(L.noteText(undefined, T0), '');
    });

    const ROLE = 'You are the farmer. gpt is the miner.';
    const W6 = 'A rule about a place names a place you saved; say "this is the aviary" first when it is not saved.';
    const LINE = `Supervisor: ${NOTE}`;

    test('right after the role line of v0.1.4.12', () => {
        const prompt = `Intro.\n${W6}\n${roleLine(ROLE)}\nSummarized memory:'m'\nConversation Begin:`;
        assert.equal(L.insertNoteLine(prompt, LINE, ROLE), `Intro.\n${W6}\n${roleLine(ROLE)}\n${LINE}\nSummarized memory:'m'\nConversation Begin:`);
    });

    test('where the role line would be: after the W6 line, else before "Summarized memory:", else nowhere', () => {
        assert.equal(L.insertNoteLine(`Intro.\n${W6}\nSummarized memory:'m'`, LINE, ''), `Intro.\n${W6}\n${LINE}\nSummarized memory:'m'`);
        assert.equal(L.insertNoteLine("Intro.\nSummarized memory:'m'", LINE, ''), `Intro.\n${LINE}\nSummarized memory:'m'`);
        assert.equal(L.insertNoteLine("Summarized memory:'m'", LINE, ''), `${LINE}\nSummarized memory:'m'`);
        assert.equal(L.insertNoteLine('Intro only.', LINE, ''), 'Intro only.');
    });

    test('no note, or the line there already: the prompt byte for byte', () => {
        const prompt = `Intro.\n${W6}\nSummarized memory:'m'`;
        assert.equal(L.insertNoteLine(prompt, '', ROLE), prompt);
        const once = L.insertNoteLine(prompt, LINE, '');
        assert.equal(L.insertNoteLine(once, LINE, ''), once);
    });

    test('the newer note replaces the older: one line in the prompt', () => {
        const prompt = `Intro.\n${W6}\nSummarized memory:'m'`;
        const older = L.noteOf('the chest has bread.', 30, T0);
        const newer = L.noteOf('the lava is east.', 30, T0 + 1000);
        const now = T0 + 2000;
        const out = L.insertNoteLine(prompt, L.noteText(newer, now), '');
        assert.equal(out.split('\n').filter((l) => l.startsWith('Supervisor: ')).length, 1);
        assert.ok(out.includes('Supervisor: the lava is east.'));
        assert.ok(!out.includes(L.noteText(older, now)));
    });
});
