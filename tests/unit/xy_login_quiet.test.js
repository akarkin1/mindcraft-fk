// Spec v0.1.4.16 section 8.3, F13 (K-1, E7): the login guard's lines `[LoginGuard] ...` and every connection error go to the
// log only, never to the game chat, the web chat or the voice. On 2026-11-13 the owner restarted the server for a backup and
// the bot posted `[LoginGuard] Connection Failed: Server is under maintenance or restarting. (socketClosed)` and `[LoginGuard]
// Network Error: Connection timed out or was lost. (Error: connect ECONNREFUSED 127.0.0.1:55914)`; the voice spoke them.
// Two paths carried them:
//   1. the web chat and the voice: log() of connection_handler.js sent every line to the MindServer as bot-output (the
//      page's chat, and voice.onBotOutput). Now it writes console.error only. The fake chat here is the MindServer socket of
//      the proxy: nothing may be emitted.
//   2. the game chat: the exit file kept the guard line as the reason of the end (restart_context on by default), and at the
//      next spawn restartNote gave the model `The process ended because: [LoginGuard] Network Error ... Tell the player what
//      happened.`; the model said it. Now the note says `The connection to the server was lost.` without the error, the
//      address or the port; the exit file keeps the raw reason for the log.
// Both fail on 274f6d4.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        return {
            proxy: await loadSrc('src/agent/mindserver_proxy.js'),
            CH: await loadSrc('src/agent/connection_handler.js'),
            R: await loadSrc('src/agent/restart_context.js'),
        };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}
const { proxy, CH, R } = await importQuietly();

// K-1's two lines, as the bot posted them
const K1_CLOSED = '[LoginGuard] Connection Failed: Server is under maintenance or restarting. (socketClosed)';
const K1_REFUSED = '[LoginGuard] Network Error: Connection timed out or was lost. (Error: connect ECONNREFUSED 127.0.0.1:55914)';
// the error of node's net module as the bot's 'error' event hands it on (code, address and port are enumerable)
const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:55914'), { errno: -111, code: 'ECONNREFUSED', syscall: 'connect', address: '127.0.0.1', port: 55914 });
const RAW = /\[LoginGuard\]|ECONNREFUSED|ETIMEDOUT|socketClosed|127\.0\.0\.1|55914|Network Error|Connection Failed/;

let cap;
let emitted;
let savedSocket;
beforeEach(() => {
    cap = captureConsole();
    emitted = [];
    savedSocket = proxy.serverProxy.socket;
    // the fake chat of the page and the voice: every emit to the MindServer is recorded
    proxy.serverProxy.socket = { emit: (...args) => { emitted.push(args); } };
});
afterEach(() => {
    proxy.serverProxy.socket = savedSocket;
    cap.restore();
});

describe('path 1: the login guard writes to the log, never to the MindServer (web chat, voice)', () => {
    test('log(): console.error once, nothing emitted', () => {
        CH.log('andy', K1_CLOSED);
        assert.deepEqual(emitted, []);
        assert.deepEqual(cap.of('error').map((r) => r.text), [K1_CLOSED]);
    });

    test('the end by a closed socket (K-1 line 1): the line in the log, nothing emitted', () => {
        const { type, msg } = CH.handleDisconnection('andy', 'socketClosed');
        assert.equal(type, 'maintenance');
        assert.equal(msg, K1_CLOSED);
        assert.deepEqual(emitted, []);
        assert.ok(cap.of('error').some((r) => r.text === K1_CLOSED));
    });

    test('a refused connection (K-1 line 2), a timeout, a kick: nothing emitted', () => {
        const { msg } = CH.handleDisconnection('andy', refused());
        assert.equal(msg, K1_REFUSED);
        CH.handleDisconnection('andy', 'ETIMEDOUT');
        CH.handleDisconnection('andy', { text: 'Kicked for spamming' }, { kicked: true });
        CH.handleDisconnection('andy', 'something odd');
        assert.deepEqual(emitted, []);
        assert.ok(cap.of('error').length >= 4);
    });

    test('the name check of the guard: the log only', () => {
        const check = CH.validateNameFormat('x');
        assert.equal(check.success, false);
        CH.log('x', check.msg);
        assert.deepEqual(emitted, []);
        assert.match(cap.of('error')[0].text, /^\[LoginGuard\] Invalid name 'x'/);
    });

    test('the proxy\'s own line for the page is untouched: sendOutputToServer still emits (other callers)', () => {
        proxy.sendOutputToServer('andy', 'a line of the bot');
        assert.deepEqual(emitted, [['bot-output', 'andy', 'a line of the bot']]);
    });
});

describe('path 2: the restart note for the model carries no connection error (the game chat)', () => {
    let dir;
    beforeEach(() => { dir = makeTmpDir(); });
    afterEach(() => removeTmpDir(dir));
    const ORDER = { by: 'MartyByrde2', command: '!mineOre("iron", 8)', text: '!mineOre("iron", 8)' };

    test('K-1 line 2 as the exit reason: the plain sentence, no error, no address, no port', () => {
        const note = R.restartNote({ reason: K1_REFUSED, order: ORDER, position: { x: 8, y: 41, z: 48 } });
        assert.equal(note, 'Before the restart MartyByrde2 had ordered: !mineOre("iron", 8). The connection to the server was lost. You are at (8, 41, 48). Do not repeat the order by yourself. Tell the player what happened.');
        assert.doesNotMatch(note, RAW);
    });

    test('K-1 line 1, a raw socket error, every connection error: the same sentence', () => {
        for (const reason of [K1_CLOSED, 'Error: connect ECONNREFUSED 127.0.0.1:55914', 'connect ETIMEDOUT 10.0.0.2:25565', 'socketClosed',
            'read ECONNRESET', '[LoginGuard] Kicked: Removed from server due to flying, spamming, or invalid movement.']) {
            const note = R.restartNote({ reason });
            assert.equal(note, 'The connection to the server was lost. Tell the player what happened.', reason);
            assert.doesNotMatch(note, RAW, reason);
            assert.ok(R.isConnectionError(reason), reason);
        }
        assert.equal(R.CONNECTION_LOST_TEXT, 'The connection to the server was lost.');
    });

    test('any other reason is as before', () => {
        assert.equal(R.restartNote({ reason: 'Got stuck and couldn\'t get unstuck.' }), 'The process ended because: Got stuck and couldn\'t get unstuck. Tell the player what happened.');
        assert.equal(R.restartNote({ reason: 'left on request' }), 'The process ended because: left on request. Tell the player what happened.');
        for (const reason of [null, undefined, '', 'Killed by the player.', 'refusing to work']) assert.ok(!R.isConnectionError(reason), String(reason));
    });

    test('the whole chain: the guard\'s line into the exit file (kept raw for the log), the note without it', () => {
        const { msg } = CH.handleDisconnection('andy', refused());
        assert.ok(R.writeExit(dir, { reason: msg, order: ORDER, action: null, position: { x: 1, y: 64, z: 2 }, time: Date.now() }));
        const exit = R.readExit(dir);
        assert.equal(exit.reason, K1_REFUSED, 'the exit file keeps the raw reason');
        const note = R.restartNote(exit);
        assert.doesNotMatch(note, RAW);
        assert.match(note, /The connection to the server was lost\./);
        assert.deepEqual(emitted, [], 'and nothing went to the MindServer on the way');
    });
});
