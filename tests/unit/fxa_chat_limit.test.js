// Fix round of v0.1.4.8, X9: the bot was kicked for spamming (11 chat lines in 2 s), and the process ended
// with a wrong reason ("Server is under maintenance or restarting").
//   - src/agent/reflex/chat_limit.js: one queue for every chat line of the bot, a token bucket of 6 lines
//     at once, then 1 line per 1.2 s; nothing is lost, lines wait in order; a text that mineflayer splits
//     into several chat lines counts per line; bot.chat and bot.whisper go through it (installChatLimit);
//     the lines that wait when the process ends are dropped.
//   - src/agent/connection_handler.js: the reason of a kick as the server gave it (in the words of the game
//     with the language table), and a watcher that waits a moment after the end of the connection for the
//     packet of the kick, which can be read after the socket closed.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';
import { loadGlue as loadGlueEnv } from '../helpers/st_glue_env.js';

const C = await loadSrc('src/agent/reflex/chat_limit.js');

// The glue (the real Agent prototype), imported once, quietly, and the limiter module it uses.
let glue = null;
async function loadGlue() {
    if (!glue) {
        const quiet = captureConsole();
        try {
            glue = { ...(await loadGlueEnv()), chatLimit: C };
        } finally {
            quiet.restore();
        }
    }
    return glue;
}

async function importHandler() {
    const cwd = process.cwd();
    const empty = makeTmpDir();
    const cap = captureConsole();
    process.chdir(empty);
    try {
        return await loadSrc('src/agent/connection_handler.js');
    } finally {
        process.chdir(cwd);
        cap.restore();
        removeTmpDir(empty);
    }
}
const CH = await importHandler();
const LANGUAGE = minecraftData('1.21.8').language;

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

// A clock and timers that move only when the test says so.
function fakeTime() {
    let now = 0;
    const timers = [];
    return {
        now: () => now,
        schedule: (fn, ms) => { const t = { at: now + ms, fn, ms }; timers.push(t); return t; },
        cancel: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
        pending: () => timers.length,
        advance(ms) {
            const end = now + ms;
            for (;;) {
                timers.sort((a, b) => a.at - b.at);
                const next = timers[0];
                if (!next || next.at > end) break;
                timers.shift();
                now = next.at;
                next.fn();
            }
            now = end;
        },
    };
}

function limiter(time, extra = {}) {
    return new C.ChatLimiter({ now: time.now, schedule: time.schedule, cancel: time.cancel, log: () => {}, ...extra });
}

describe('the token bucket', () => {
    test('6 lines at once, then one new line per 1.2 s, never more than 6', () => {
        assert.deepEqual(C.CHAT_LIMIT, { burst: 6, refillMs: 1200, lengthLimit: 256 });
        let b = C.refillBucket(null, 1000);
        assert.deepEqual(b, { tokens: 6, at: 1000 });
        b = { tokens: 0, at: 1000 };
        assert.equal(C.refillBucket(b, 1600).tokens, 0.5);
        assert.equal(C.refillBucket(b, 2200).tokens, 1);
        assert.equal(C.refillBucket(b, 1000 + 60000).tokens, 6);
        assert.deepEqual(C.refillBucket({ tokens: 2, at: 5000 }, 4000), { tokens: 2, at: 4000 }, 'a clock that went back is no time');
    });

    test('the wait for the next token', () => {
        assert.equal(C.waitForToken({ tokens: 1 }), 0);
        assert.equal(C.waitForToken({ tokens: 0 }), 1200);
        assert.equal(C.waitForToken({ tokens: 0.5 }), 600);
        assert.equal(C.waitForToken(null), 1200);
    });
});

describe('ChatLimiter: nothing is lost, the lines wait in order', () => {
    test('11 lines in one moment (the kick of the long run): 6 at once, then one every 1.2 s, in order', () => {
        const time = fakeTime();
        const q = limiter(time);
        const sent = [];
        for (let i = 1; i <= 11; i++) q.push(() => sent.push([`line ${i}`, time.now()]));
        assert.deepEqual(sent.map(([l]) => l), ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6']);
        assert.equal(q.waiting, 5);
        time.advance(1199);
        assert.equal(sent.length, 6, 'not before 1.2 s');
        time.advance(1);
        assert.deepEqual(sent.at(-1), ['line 7', 1200]);
        time.advance(4800);
        assert.deepEqual(sent.slice(6), [['line 7', 1200], ['line 8', 2400], ['line 9', 3600], ['line 10', 4800], ['line 11', 6000]]);
        assert.equal(q.waiting, 0);
        assert.equal(time.pending(), 0, 'no timer left');
        assert.equal(q.sent, 11);
    });

    test('never more than 6 lines within 1.2 s, and at most 6 + n in n * 1.2 s', () => {
        const time = fakeTime();
        const q = limiter(time);
        const at = [];
        for (let i = 0; i < 40; i++) q.push(() => at.push(time.now()));
        time.advance(60000);
        assert.equal(at.length, 40);
        for (let i = 0; i < at.length; i++) {
            const within = at.filter((t) => t >= at[i] && t < at[i] + 1200).length;
            assert.ok(within <= 6, `${within} lines from ${at[i]} ms`);
        }
        assert.equal(at.filter((t) => t <= 12000).length, 16, '6 + 10 lines in 12 s');
    });

    test('after a quiet time the bucket is full again', () => {
        const time = fakeTime();
        const q = limiter(time);
        let n = 0;
        for (let i = 0; i < 6; i++) q.push(() => n++);
        time.advance(7200);
        for (let i = 0; i < 6; i++) q.push(() => n++);
        assert.equal(n, 12);
        q.push(() => n++);
        assert.equal(n, 12, 'the 13th waits');
    });

    test('a line that throws is logged; the next lines go on', () => {
        const time = fakeTime();
        const logged = [];
        const q = limiter(time, { log: (...args) => logged.push(args.join(' ')) });
        const sent = [];
        q.push(() => { throw new Error('socket closed'); });
        q.push(() => sent.push('after'));
        assert.deepEqual(sent, ['after']);
        assert.deepEqual(logged, ['Could not send a chat line: socket closed']);
    });

    test('drop(): the lines that wait are dropped (the process ends), the timer is cancelled', () => {
        const time = fakeTime();
        const q = limiter(time);
        const sent = [];
        for (let i = 0; i < 9; i++) q.push(() => sent.push(i));
        assert.equal(time.pending(), 1);
        q.drop();
        assert.equal(q.waiting, 0);
        assert.equal(time.pending(), 0);
        time.advance(10000);
        assert.equal(sent.length, 6);
    });

    test('the default timer does not keep the process alive', () => {
        const q = new C.ChatLimiter({ log: () => {} });
        const t = q.schedule(() => {}, 100000);
        assert.equal(t.hasRef(), false);
        q.cancel(t);
    });
});

describe('chatLines: the chat lines that mineflayer sends for one text', () => {
    test('one line per line of the text; empty lines are left out', () => {
        assert.deepEqual(C.chatLines('one\ntwo\n\nthree'), ['one', 'two', 'three']);
        assert.deepEqual(C.chatLines(''), []);
        assert.deepEqual(C.chatLines(42), ['42']);
    });

    test('a line longer than 256 characters is cut into pieces of 256', () => {
        const text = 'a'.repeat(256) + 'b'.repeat(256) + 'c'.repeat(10);
        assert.deepEqual(C.chatLines(text), ['a'.repeat(256), 'b'.repeat(256), 'c'.repeat(10)]);
        assert.deepEqual(C.chatLines('x'.repeat(150), '', 100), ['x'.repeat(100), 'x'.repeat(50)], 'lessCharsInChat');
    });

    test('a whisper: the header counts for the length', () => {
        const header = '/tell MartyByrde2 ';
        const pieces = C.chatLines('y'.repeat(300), header);
        assert.deepEqual(pieces.map((p) => p.length), [256 - header.length, 300 - (256 - header.length)]);
    });

    test('a command without a header is one line, never cut', () => {
        const cmd = '/tp @s ' + '1 '.repeat(200);
        assert.deepEqual(C.chatLines(cmd), [cmd]);
    });

    test('no text: null (mineflayer throws for it)', () => {
        assert.equal(C.chatLines({}), null);
        assert.equal(C.chatLines(undefined), null);
    });
});

describe('installChatLimit: bot.chat and bot.whisper behind one queue', () => {
    function fakeBot() {
        const sent = [];
        const bot = {
            sent,
            chat(message) {
                if (typeof message !== 'string') throw new Error('Chat message type must be a string or number: ' + typeof message);
                sent.push(['chat', message]);
            },
            whisper(username, message) { sent.push(['whisper', username, message]); },
        };
        return bot;
    }

    test('every chat line counts: a text with 4 lines and 3 more texts, 7 lines: 6 go, the 7th waits', () => {
        const time = fakeTime();
        const bot = fakeBot();
        const q = C.installChatLimit(bot, { now: time.now, schedule: time.schedule, cancel: time.cancel, log: () => {} });
        assert.ok(q instanceof C.ChatLimiter);
        bot.chat('*MartyByrde2 used storeItems*');
        bot.chat('one\ntwo\nthree\nfour');
        bot.whisper('MartyByrde2', 'psst');
        bot.chat("I'm stuck!");
        assert.deepEqual(bot.sent, [['chat', '*MartyByrde2 used storeItems*'], ['chat', 'one'], ['chat', 'two'], ['chat', 'three'], ['chat', 'four'],
            ['whisper', 'MartyByrde2', 'psst']]);
        time.advance(1200);
        assert.deepEqual(bot.sent.at(-1), ['chat', "I'm stuck!"]);
    });

    test('a long text goes out in the pieces that mineflayer would send, each through the queue', () => {
        const time = fakeTime();
        const bot = fakeBot();
        C.installChatLimit(bot, { now: time.now, schedule: time.schedule, cancel: time.cancel });
        bot.chat('z'.repeat(600));
        assert.deepEqual(bot.sent.map(([, m]) => m.length), [256, 256, 88]);
    });

    test('no text goes to mineflayer as before (it throws); installed once; a bot without chat gets nothing', () => {
        const bot = fakeBot();
        const q = C.installChatLimit(bot);
        assert.throws(() => bot.chat({}), /must be a string or number/);
        assert.equal(C.installChatLimit(bot), q, 'the same limiter');
        assert.equal(bot.chatLimiter, q);
        assert.equal(C.installChatLimit({}), null);
        assert.equal(C.installChatLimit(null), null);
    });

    test('lessCharsInChat: pieces of 100', () => {
        const time = fakeTime();
        const bot = fakeBot();
        bot.supportFeature = (name) => name === 'lessCharsInChat';
        C.installChatLimit(bot, { now: time.now, schedule: time.schedule, cancel: time.cancel });
        bot.chat('q'.repeat(150));
        assert.deepEqual(bot.sent.map(([, m]) => m.length), [100, 50]);
    });

    test('module rules: imports nothing, importable without output or files', () => {
        assertImportRules('src/agent/reflex/chat_limit.js', { allowBuiltins: [], allowedRelative: [] });
        assertCleanImport('src/agent/reflex/chat_limit.js');
    });
});

describe('the agent puts the chat of its bot behind the limit (src/agent/agent.js)', () => {
    test('when mineflayer injects its chat plugin (inject_allowed), bot.chat and bot.whisper go through one queue', async () => {
        const G = await loadGlue();
        const agent = Object.create(G.Agent.prototype);
        const listeners = {};
        const sent = [];
        agent.bot = { once(event, fn) { listeners[event] = fn; } };
        agent._limitChat();
        assert.equal(agent.bot.chatLimiter, undefined, 'no chat yet: installed later');
        agent.bot.chat = (m) => sent.push(['chat', m]); // what the chat plugin defines
        agent.bot.whisper = (u, m) => sent.push(['whisper', u, m]);
        listeners.inject_allowed();
        assert.ok(agent.bot.chatLimiter instanceof G.chatLimit.ChatLimiter);
        assert.equal(agent.chat_limiter, agent.bot.chatLimiter);
        for (let i = 0; i < 5; i++) agent.bot.chat(`line ${i}`);
        agent.bot.whisper('MartyByrde2', 'a\nb');
        assert.equal(sent.length, 6, '6 lines at once');
        assert.deepEqual(sent.at(-1), ['whisper', 'MartyByrde2', 'a']);
        assert.equal(agent.bot.chatLimiter.waiting, 1);
        // the process ends: the waiting line is dropped
        G.Agent.prototype._atExit.call(agent, 'bye');
        assert.equal(agent.bot.chatLimiter.waiting, 0);
    });
});

describe('the reason of a kick as the server gave it', () => {
    const SPAM = { type: 'compound', name: '', value: { translate: { type: 'string', value: 'disconnect.spam' } } };

    test('the kick for spamming: "Kicked for spamming", not "Server is under maintenance or restarting"', () => {
        const { type, msg } = CH.handleDisconnection('w_long', SPAM, { language: LANGUAGE, kicked: true });
        assert.equal(type, 'behavior');
        assert.equal(msg, '[LoginGuard] Kicked: Removed from server due to flying, spamming, or invalid movement. The server said: Kicked for spamming');
        assert.ok(cap.allText().includes(msg));
    });

    test('without the language table the key of the game is named', () => {
        const { msg } = CH.handleDisconnection('w_long', SPAM, { kicked: true });
        assert.ok(msg.endsWith('The server said: disconnect.spam'), msg);
    });

    test('translate keys with arguments: %s and %1$s', () => {
        assert.equal(CH.serverReasonText({ translate: 'multiplayer.disconnect.kicked' }, LANGUAGE), 'Kicked by an operator');
        const language = { 'a.b': 'Hello %s and %s', 'c.d': 'Second %2$s, first %1$s, 100%%' };
        assert.equal(CH.serverReasonText({ translate: 'a.b', with: ['Steve', { text: 'Alex' }] }, language), 'Hello Steve and Alex');
        assert.equal(CH.serverReasonText({ translate: 'c.d', with: ['x', 'y'] }, language), 'Second y, first x, 100%');
        assert.equal(CH.serverReasonText({ translate: 'no.such.key', with: ['z'] }, language), 'no.such.key z', 'an unknown key as before');
    });

    test('an end without a kick: the category stays, the raw reason is named', () => {
        const { type, msg } = CH.handleDisconnection('w_long', 'socketClosed');
        assert.equal(type, 'maintenance');
        assert.equal(msg, '[LoginGuard] Connection Failed: Server is under maintenance or restarting. (socketClosed)');
    });

    test('a reason of the fallback type is unchanged', () => {
        const { msg } = CH.handleDisconnection('w_long', { text: 'Bye' });
        assert.equal(msg, '[LoginGuard] Disconnected: Bye');
    });
});

describe('createDisconnectWatcher: the kick that comes after the end of the socket', () => {
    function watch(waitMs = 1000) {
        const time = fakeTime();
        const finals = [];
        const w = CH.createDisconnectWatcher({ onFinal: (event, reason) => finals.push([event, reason]), waitMs, schedule: time.schedule, cancel: time.cancel });
        return { w, finals, time };
    }

    test('the end first, the kick 50 ms later: the kick with its reason decides', () => {
        const { w, finals, time } = watch();
        w.ended('socketClosed');
        assert.equal(w.pending, true);
        time.advance(50);
        w.kicked('disconnect.spam');
        assert.deepEqual(finals, [['Kicked', 'disconnect.spam']]);
        time.advance(5000);
        assert.equal(finals.length, 1, 'once');
        assert.equal(time.pending(), 0);
    });

    test('an end without a kick: decided after the wait', () => {
        const { w, finals, time } = watch();
        w.ended('socketClosed');
        time.advance(999);
        assert.deepEqual(finals, []);
        time.advance(1);
        assert.deepEqual(finals, [['Disconnected', 'socketClosed']]);
        assert.equal(w.settled, true);
    });

    test('a kick first, or an error: at once, and only once', () => {
        const a = watch();
        a.w.kicked('bye');
        a.w.ended('socketClosed');
        a.w.error(new Error('late'));
        assert.deepEqual(a.finals, [['Kicked', 'bye']]);
        const b = watch();
        const err = new Error('ECONNREFUSED');
        b.w.error(err);
        b.w.kicked('bye');
        assert.deepEqual(b.finals, [['Error', err]]);
    });
});
