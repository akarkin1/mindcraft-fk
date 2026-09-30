// T1, spec v0.1.4.8 section 10 (part F) and the interface I10, tested from the spec and the handoff:
//   F1 the chat kick (S12): the checksum of the last seen messages is right for 25 messages in a row; the
//      old code of minecraft-protocol 1.62.0 agrees up to message 20 and not after it; the patch file is
//      what node_modules has and patch-package applies it;
//   F2 the cost limit per session counts the processes of one launch; without MINDCRAFT_LAUNCH_ID as v0.1.4.7;
//   F3 restart context: writeExit, readExit (deletes, 10 minutes), restartNote word for word;
//   F4 [HH:MM:SS] before each line of the console; off leaves the console as it was;
//   F5 the repeat guard: the third identical failure is refused, a look at the inventory in between does
//      not end the row, a different command does; the text word for word; 0 is off.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { loadSrc } from '../helpers/load.js';
import { repoPath, repoUrl } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { runNodeModuleSource, describeRun } from '../helpers/child.js';

const restart = await loadSrc('src/agent/restart_context.js');
const repeat = await loadSrc('src/agent/repeat_guard.js');
const costMod = await loadSrc('src/agent/cost/cost_meter.js');
const logTime = await loadSrc('src/utils/log_time.js');

const require = createRequire(repoPath('package.json'));

let dir;
let cap;
beforeEach(() => {
    dir = makeTmpDir();
    cap = captureConsole();
});
afterEach(() => {
    cap.restore();
    removeTmpDir(dir);
});

// ------------------------------------------------------------------------------------------ F1

describe('F1: the checksum of the last seen messages', () => {
    const chatPlugin = require('minecraft-protocol/src/client/chat.js');
    const { computeChatChecksum } = require('minecraft-protocol/src/datatypes/checksums.js');

    // The rule of the game (spec F1): start 1; for each signature of the window, oldest first,
    // 31 * value + the checksum of the signature (java.util.Arrays.hashCode of the bytes, signed, 32-bit);
    // the low byte; 0 becomes 1. As the byte on the wire (0..255).
    function javaHash(bytes) {
        let h = 1;
        for (const b of bytes) h = (Math.imul(31, h) + (b > 127 ? b - 256 : b)) | 0;
        return h;
    }
    function reference(windowOldestFirst) {
        let value = 1;
        for (const sig of windowOldestFirst) value = (Math.imul(31, value) + javaHash(sig)) | 0;
        const low = value & 0xff;
        return low === 0 ? 1 : low;
    }

    // Signatures of 256 bytes from a small generator (xorshift), a different one per message.
    function signatureOf(n) {
        let s = (0x9e3779b9 ^ (n * 2654435761)) >>> 0;
        const out = Buffer.alloc(256);
        for (let i = 0; i < 256; i++) {
            s ^= s << 13; s >>>= 0;
            s ^= s >>> 17;
            s ^= s << 5; s >>>= 0;
            out[i] = s & 0xff;
        }
        return out;
    }

    function client() {
        const c = new EventEmitter();
        c.version = '1.21.8';
        c.packets = [];
        c.write = (name, params) => c.packets.push({ name, params });
        chatPlugin(c, {});
        return c;
    }

    function playerSays(c, n) {
        c.emit('player_chat', {
            globalIndex: n, senderUuid: '11111111-2222-3333-4444-555555555555', index: n, signature: signatureOf(n),
            plainMessage: `message ${n}`, timestamp: BigInt(Date.now()), salt: 0n, previousMessages: [],
            unsignedChatContent: undefined, filterType: 0, type: 1, networkName: '"MartyByrde2"',
        });
    }

    // 25 messages of the player; after each one the bot chats once, as a message and as a command
    function run() {
        const c = client();
        const rows = [];
        for (let n = 1; n <= 25; n++) {
            playerSays(c, n);
            const window = [];
            for (let k = Math.max(1, n - 19); k <= n; k++) window.push(signatureOf(k));
            const expected = reference(window);
            const old = computeChatChecksum(c._lastSeenMessages); // what chat.js computed before the patch
            c._signedChat('hello');
            const message = c.packets.filter((p) => p.name === 'chat_message').at(-1).params;
            c._signedChat('/help');
            const command = c.packets.filter((p) => p.name === 'chat_command' || p.name === 'chat_command_signed').at(-1).params;
            rows.push({ n, expected, old, message: message.checksum, command: command.checksum });
        }
        return rows;
    }

    test('the reference of the rule of the game equals the checksum function of the library for one signature', () => {
        for (let n = 1; n <= 50; n++) assert.equal(computeChatChecksum([{ signature: signatureOf(n) }]), reference([signatureOf(n)]), `signature ${n}`);
        assert.equal(computeChatChecksum([]), 1);
    });

    test('25 messages in a row: every chat and every command carries the checksum of the window', () => {
        const rows = run();
        const wrong = rows.filter((r) => r.message !== r.expected || r.command !== r.expected);
        assert.deepEqual(wrong, []);
    });

    test('the old code agrees up to message 20; after it only the new code matches', () => {
        const rows = run();
        for (const r of rows.filter((x) => x.n <= 20)) assert.equal(r.old, r.expected, `message ${r.n}`);
        const later = rows.filter((x) => x.n >= 21);
        assert.deepEqual(later.filter((r) => r.old === r.expected).map((r) => r.n), [], 'the old code must be wrong after message 20');
    });

    test('the patch file is what node_modules has, and patch-package applies it on install', () => {
        const patch = fs.readFileSync(repoPath('patches/minecraft-protocol+1.62.0.patch'), 'utf8').replace(/\r\n/g, '\n');
        const installed = fs.readFileSync(repoPath('node_modules/minecraft-protocol/src/client/chat.js'), 'utf8').replace(/\r\n/g, '\n');
        const added = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
        const removed = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
        assert.ok(added.length >= 2);
        for (const line of added) assert.ok(installed.includes(line), `installed: ${line}`);
        for (const line of removed) assert.ok(!installed.includes(line), `removed: ${line}`);
        const pkg = JSON.parse(fs.readFileSync(repoPath('package.json'), 'utf8'));
        assert.equal(pkg.scripts.postinstall, 'patch-package');
        assert.equal(pkg.dependencies['minecraft-protocol'], '1.62.0', 'the patch is for this version');
    });
});

// ------------------------------------------------------------------------------------------ F2

describe('F2: cost per launch', () => {
    const PRICES = { 'claude-haiku-4-5': { input: 1, output: 5 } }; // 1 dollar per million input tokens
    const settings = { cost_limit_per_session: 1, model_prices: PRICES };
    const call = (meter, dollars) => meter.record({ model: 'claude-haiku-4-5', purpose: 'chat', input_tokens: dollars * 1e6, output_tokens: 0 });

    test('the limit per session counts all processes of the same launch', () => {
        const file = path.join(dir, 'usage.json');
        const first = new costMod.CostMeter({ settings, filePath: file, launchId: '2026-09-29T10:00:00.000Z' });
        call(first, 0.6);
        assert.equal(first.check(), 'normal');
        first.flush(); // the process ends (a restart)
        const second = new costMod.CostMeter({ settings, filePath: file, launchId: '2026-09-29T10:00:00.000Z' });
        call(second, 0.5);
        assert.equal(second.check(), 'saving', '0.6 + 0.5 is above the limit of 1 per session');
    });

    test('the session in usage.json carries the launch id', () => {
        const file = path.join(dir, 'usage.json');
        const meter = new costMod.CostMeter({ settings, filePath: file, launchId: 'L-1' });
        call(meter, 0.1);
        meter.flush();
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.equal(data.sessions.at(-1).launch_id, 'L-1');
    });

    test('!cost counts all sessions of the same launch', () => {
        const file = path.join(dir, 'usage.json');
        const first = new costMod.CostMeter({ settings: { model_prices: PRICES }, filePath: file, launchId: 'L-2' });
        call(first, 0.25);
        first.flush();
        const second = new costMod.CostMeter({ settings: { model_prices: PRICES }, filePath: file, launchId: 'L-2' });
        call(second, 0.5);
        const line = second.reportLine();
        assert.match(line, /^Cost: session \$0\.75/);
        assert.match(line, /2 calls\./);
    });

    test('another launch does not count', () => {
        const file = path.join(dir, 'usage.json');
        const first = new costMod.CostMeter({ settings, filePath: file, launchId: 'L-a' });
        call(first, 0.6);
        first.flush();
        const second = new costMod.CostMeter({ settings, filePath: file, launchId: 'L-b' });
        call(second, 0.5);
        assert.equal(second.check(), 'normal');
    });

    test('without the variable: the behaviour of v0.1.4.7, each process counts alone', () => {
        const saved = process.env.MINDCRAFT_LAUNCH_ID;
        delete process.env.MINDCRAFT_LAUNCH_ID;
        try {
            const file = path.join(dir, 'usage.json');
            const first = new costMod.CostMeter({ settings, filePath: file });
            call(first, 0.6);
            first.flush();
            const second = new costMod.CostMeter({ settings, filePath: file });
            call(second, 0.5);
            assert.equal(second.check(), 'normal');
            assert.match(second.reportLine(), /^Cost: session \$0\.50/);
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            assert.equal(data.sessions[0].launch_id, undefined);
        } finally {
            if (saved !== undefined) process.env.MINDCRAFT_LAUNCH_ID = saved;
        }
    });

    test('the agent process inherits the variable: the meter reads it from the environment', () => {
        const saved = process.env.MINDCRAFT_LAUNCH_ID;
        process.env.MINDCRAFT_LAUNCH_ID = '2026-09-29T11:11:11.000Z';
        try {
            const file = path.join(dir, 'usage.json');
            const first = new costMod.CostMeter({ settings, filePath: file });
            call(first, 0.6);
            first.flush();
            const second = new costMod.CostMeter({ settings, filePath: file });
            call(second, 0.5);
            assert.equal(second.check(), 'saving');
        } finally {
            if (saved === undefined) delete process.env.MINDCRAFT_LAUNCH_ID;
            else process.env.MINDCRAFT_LAUNCH_ID = saved;
        }
    });

    test('main.js sets MINDCRAFT_LAUNCH_ID once, to the time of its start, before it starts agents; the agent processes are spawned with the inherited environment', () => {
        const main = fs.readFileSync(repoPath('main.js'), 'utf8');
        const sets = main.match(/process\.env\.MINDCRAFT_LAUNCH_ID\s*=/g) ?? [];
        assert.equal(sets.length, 1);
        assert.ok(main.indexOf('process.env.MINDCRAFT_LAUNCH_ID') < main.indexOf('createAgent('));
        const spawner = fs.readFileSync(repoPath('src/process/agent_process.js'), 'utf8');
        assert.ok(!/\benv\s*:/.test(spawner), 'no own env for the child: it inherits process.env');
    });
});

// ------------------------------------------------------------------------------------------ F3

describe('F3: restart context', () => {
    const EXIT = { reason: "Got stuck and couldn't get unstuck", order: { by: 'MartyByrde2', command: '!mineOre', text: '!mineOre("iron", 8)' },
        action: 'action:mineOre', position: { x: 8.51, y: 41, z: 48.37 } };

    test('writeExit writes last_exit.json into the folder of the bot; readExit reads it and deletes it', () => {
        assert.equal(restart.writeExit(dir, { ...EXIT, time: Date.now() }), true);
        assert.equal(fs.existsSync(path.join(dir, 'last_exit.json')), true);
        const exit = restart.readExit(dir);
        assert.ok(exit);
        assert.equal(fs.existsSync(path.join(dir, 'last_exit.json')), false);
        assert.equal(restart.readExit(dir), null, 'read once');
    });

    test('restartNote, word for word (the example of the spec)', () => {
        restart.writeExit(dir, { ...EXIT, time: Date.now() });
        assert.equal(restart.restartNote(restart.readExit(dir)),
            'Before the restart MartyByrde2 had ordered: !mineOre("iron", 8). The process ended because: Got stuck and couldn\'t get unstuck. You are at (8, 41, 48). Do not repeat the order by yourself. Tell the player what happened.');
    });

    test('an exit file older than 10 minutes gives null and is deleted', () => {
        const now = Date.now();
        restart.writeExit(dir, { ...EXIT, time: now - 11 * 60 * 1000 });
        assert.equal(restart.readExit(dir, undefined, () => now), null);
        assert.equal(fs.existsSync(path.join(dir, 'last_exit.json')), false);
        restart.writeExit(dir, { ...EXIT, time: now - 9 * 60 * 1000 });
        assert.ok(restart.readExit(dir, undefined, () => now));
    });

    test('writeExit never throws', () => {
        assert.doesNotThrow(() => restart.writeExit(null, EXIT));
        assert.doesNotThrow(() => restart.writeExit(path.join(dir, 'missing', '\0bad'), EXIT));
        assert.doesNotThrow(() => restart.writeExit(dir, undefined));
    });

    test('readExit never throws on a broken file', () => {
        fs.writeFileSync(path.join(dir, 'last_exit.json'), '{not json');
        assert.doesNotThrow(() => restart.readExit(dir));
        assert.equal(restart.readExit(dir), null);
    });

    test('restartNote of nothing is empty', () => {
        assert.equal(restart.restartNote(null), '');
    });

    test('bots/<name>/last_exit.json is never committed: the folder bots/ is ignored', () => {
        const ignore = fs.readFileSync(repoPath('.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
        assert.ok(ignore.includes('bots/**/') || ignore.includes('bots/'), 'bots/ in .gitignore');
        assert.equal(restart.EXIT_FILE, 'last_exit.json');
    });
});

// ------------------------------------------------------------------------------------------ F4

describe('F4: time in the log', () => {
    const script = (enabled) => `
        const { installLogTime } = await import(${JSON.stringify(repoUrl('src/utils/log_time.js'))});
        installLogTime(${enabled}, () => new Date(2026, 8, 29, 13, 5, 9));
        console.log('hello %s', 'world');
        console.warn('careful');
        console.error('broken');
        installLogTime(${enabled}, () => new Date(2026, 8, 29, 13, 5, 9));
        console.log('again');`;

    test('on: [HH:MM:SS] before each line of console.log, warn and error; a second call wraps nothing again', () => {
        const run = runNodeModuleSource(script(true));
        assert.equal(run.status, 0, describeRun(run));
        assert.deepEqual(run.stdout.trim().split(/\r?\n/), ['[13:05:09] hello world', '[13:05:09] again']);
        assert.deepEqual(run.stderr.trim().split(/\r?\n/), ['[13:05:09] careful', '[13:05:09] broken']);
    });

    test('off (the default log_timestamps false): the output of v0.1.4.7', () => {
        const run = runNodeModuleSource(script(false));
        assert.equal(run.status, 0, describeRun(run));
        assert.deepEqual(run.stdout.trim().split(/\r?\n/), ['hello world', 'again']);
        assert.deepEqual(run.stderr.trim().split(/\r?\n/), ['careful', 'broken']);
    });

    test('installLogTime is called with the setting in main.js and in the start of the agent process', () => {
        for (const file of ['main.js', 'src/process/init_agent.js']) {
            const source = fs.readFileSync(repoPath(file), 'utf8');
            assert.match(source, /installLogTime\(\s*settings\.log_timestamps/, file);
        }
    });

    test('the stamp is local time with two digits', () => {
        assert.equal(logTime.timeStamp(new Date(2026, 0, 2, 3, 4, 5)), '[03:04:05]');
    });
});

// ------------------------------------------------------------------------------------------ F5

describe('F5: the repeat guard', () => {
    const FAIL = 'You do not have any bread to eat.';
    const REFUSAL = 'I tried !consume("bread") 2 times with the same result: You do not have any bread to eat. I do not try a third time. Ask the player what to do.';

    function clock(start = 1_000_000) {
        const c = { t: start };
        c.now = () => c.t;
        return c;
    }

    test('the third identical failure in a row is refused, with the text of the spec', () => {
        const g = new repeat.RepeatGuard({ limit: 3, now: clock().now });
        assert.equal(g.check('!consume', ['bread']), null);
        g.record('!consume', ['bread'], FAIL);
        assert.equal(g.check('!consume', ['bread']), null);
        g.record('!consume', ['bread'], FAIL);
        assert.equal(g.check('!consume', ['bread']), REFUSAL);
    });

    test('a look at the inventory in between does not end the row', () => {
        const g = new repeat.RepeatGuard({ limit: 3, now: clock().now });
        g.record('!consume', ['bread'], FAIL);
        g.record('!inventory', [], 'INVENTORY: nothing');
        g.record('!consume', ['bread'], FAIL);
        g.record('!stats', [], 'STATS');
        assert.equal(g.check('!consume', ['bread']), REFUSAL);
    });

    test('a different command in between ends the row', () => {
        const g = new repeat.RepeatGuard({ limit: 3, now: clock().now });
        g.record('!consume', ['bread'], FAIL);
        g.record('!goToPlayer', ['steve', 3], 'You have reached (1, 64, 1).');
        g.record('!consume', ['bread'], FAIL);
        assert.equal(g.check('!consume', ['bread']), null);
    });

    test('other arguments or another result text are no identical failure', () => {
        const g = new repeat.RepeatGuard({ limit: 3, now: clock().now });
        g.record('!consume', ['bread'], FAIL);
        g.record('!consume', ['bread'], FAIL);
        assert.equal(g.check('!consume', ['apple']), null);
        const h = new repeat.RepeatGuard({ limit: 3, now: clock().now });
        h.record('!consume', ['bread'], FAIL);
        h.record('!consume', ['bread'], 'Consumed bread.');
        assert.equal(h.check('!consume', ['bread']), null);
    });

    test('within the window of 5 minutes only', () => {
        const c = clock();
        const g = new repeat.RepeatGuard({ limit: 3, now: c.now });
        g.record('!consume', ['bread'], FAIL);
        c.t += 3 * 60 * 1000;
        g.record('!consume', ['bread'], FAIL);
        c.t += 2.5 * 60 * 1000; // the first failure is 5.5 minutes old
        assert.equal(g.check('!consume', ['bread']), null);
        assert.equal(repeat.REPEAT_WINDOW_MS, 5 * 60 * 1000);
    });

    test('repeat_guard 0 (the default) is off: never refused', () => {
        for (const limit of [0, undefined]) {
            const g = new repeat.RepeatGuard(limit === undefined ? {} : { limit });
            for (let i = 0; i < 10; i++) g.record('!consume', ['bread'], FAIL);
            assert.equal(g.check('!consume', ['bread']), null);
        }
    });

    test('commands that only read are never counted', () => {
        const readOnly = ['!stats', '!inventory', '!chests', '!areas', '!rules', '!cost', '!nearbyBlocks', '!craftable', '!savedPlaces', '!skills', '!help'];
        for (const name of readOnly) {
            const g = new repeat.RepeatGuard({ limit: 2, now: clock().now });
            for (let i = 0; i < 5; i++) g.record(name, [], 'the same text');
            assert.equal(g.check(name, []), null, name);
        }
    });

    // decided after round 1: only failures count; record(name, args, result, failed), looksLikeFailure(text)
    test('only failures count: a success ends the row', () => {
        const g = new repeat.RepeatGuard({ limit: 3, now: clock().now });
        g.record('!consume', ['bread'], FAIL);
        g.record('!consume', ['bread'], FAIL);
        g.record('!consume', ['bread'], 'Consumed bread.');
        assert.equal(g.check('!consume', ['bread']), null);
        const h = new repeat.RepeatGuard({ limit: 3, now: clock().now });
        for (let i = 0; i < 4; i++) h.record('!goToPlayer', ['steve', 3], 'You have reached steve.');
        assert.equal(h.check('!goToPlayer', ['steve', 3]), null, 'a success repeated is never refused');
    });

    test('the caller decides with failed; an object result decides with ok', () => {
        const g = new repeat.RepeatGuard({ limit: 2, now: clock().now });
        g.record('!mineOre', ['iron', 8], 'I know no mine for iron. I can dig a new one.', true);
        assert.match(g.check('!mineOre', ['iron', 8]) ?? '', /^I tried !mineOre\("iron", 8\) 1 time/);
        const h = new repeat.RepeatGuard({ limit: 2, now: clock().now });
        h.record('!consume', ['bread'], FAIL, false);
        assert.equal(h.check('!consume', ['bread']), null, 'failed false: a success');
        const k = new repeat.RepeatGuard({ limit: 2, now: clock().now });
        k.record('!farmCycle', [''], { ok: false, text: 'Farm "farm": Nothing to do now.' });
        assert.ok(k.check('!farmCycle', ['']));
    });

    test('looksLikeFailure: clear failures yes, successes and doubt no', () => {
        assert.equal(repeat.looksLikeFailure(FAIL), true);
        assert.equal(repeat.looksLikeFailure('Action output:\nYou do not have any bread to eat.\n'), true);
        assert.equal(repeat.looksLikeFailure('You have reached (1, 64, 1).'), false);
        assert.equal(repeat.looksLikeFailure('Consumed bread.'), false);
        assert.equal(repeat.looksLikeFailure('Hello there.'), false, 'in doubt: no');
    });

    test('limit 2: the second identical failure is refused', () => {
        const g = new repeat.RepeatGuard({ limit: 2, now: clock().now });
        g.record('!craftRecipe', ['bread', 1], 'You do not have the resources to craft a bread.');
        assert.equal(g.check('!craftRecipe', ['bread', 1]),
            'I tried !craftRecipe("bread", 1) 1 time with the same result: You do not have the resources to craft a bread. I do not try a second time. Ask the player what to do.');
    });
});
