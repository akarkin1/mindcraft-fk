// Release v0.1.4.10, spec I7 T1 (part T): scripts/scorecard.js and its pure logic scripts/scorecard_logic.js.
//
// The fixtures are two logs cut to 200 lines: tests/fixtures/logs/luna_2026-10-01.log (the owner's session with
// Luna, the player named "player") and tests/fixtures/logs/journey_ten_minutes.log (a journey of the world tests,
// without times). The expected numbers were counted by hand from the files:
//   Luna: 03:16:32 to 04:09:22 = 52 min 50 s; 1 "Initializing agent"; the end "(socketClosed)"; 7 messages of the
//   player (lines 29, 39, 72, 102, 113, 130, 163, each printed twice); without result within 60 s: line 113 (the
//   next answer 03:26:13) and line 163 "stop" (the next result "Agent executed: !moveAway" 100 s later); 10
//   "Awaiting" lines of gpt-6-luna; the last cost line $0.13 and 674 calls; 2 "I'm stuck!" (lines 173, 183); 2
//   "Door service: closed" (112, 160); parsed commands !followPlayer 3 (50, 94, 126), !rememberMine 1 (83).
//   Journey: 1 "Initializing agent"; 6 typed orders (23, 27, 46, 51, 68, 157), each followed by its parsed command;
//   no call, no cost line, no stuck line; 8 "Door service: closed" lines; !followPlayer 2, the others 1.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { assertImportRules, assertCleanImport } from '../helpers/module_rules.js';

const LOGIC = 'scripts/scorecard_logic.js';
const SCRIPT = 'scripts/scorecard.js';
const L = await loadSrc(LOGIC);
const M = await loadSrc(SCRIPT);

const LUNA = path.join(repoPath('tests'), 'fixtures', 'logs', 'luna_2026-10-01.log');
const JOURNEY = path.join(repoPath('tests'), 'fixtures', 'logs', 'journey_ten_minutes.log');
const rowOf = (file) => L.scorecard(L.parseLog(L.decodeLog(fs.readFileSync(file))).events, { name: path.basename(file) })[0];

describe('the modules', () => {
    test('the logic imports nothing, the script only node built-ins and its logic; neither runs when imported', () => {
        assertImportRules(LOGIC, { allowBuiltins: [], allowedRelative: [] });
        assertImportRules(SCRIPT, { allowBuiltins: ['fs', 'path', 'url'], allowedRelative: ['scorecard_logic.js'] });
        assertCleanImport(LOGIC);
        assertCleanImport(SCRIPT);
    });

    test('the columns of the spec', () => {
        assert.deepEqual([...L.COLUMNS], ['Log', 'Minutes', 'Processes', 'Ends', 'Orders', 'Without result', 'Calls', 'Cost', 'Stuck', 'Doors open']);
        assert.equal(L.RESULT_WINDOW_S, 60);
    });
});

describe('the owner\'s Luna log of 2026-10-01', () => {
    const r = rowOf(LUNA);

    test('every number of the row', () => {
        assert.equal(r.log, 'luna_2026-10-01.log');
        assert.equal(r.minutes, 52.8);
        assert.equal(r.timed, true);
        assert.equal(r.processes, 1);
        assert.deepEqual(r.ends, { socket: 1 });
        assert.equal(r.orders, 7);
        assert.equal(r.withoutResult, 2);
        assert.equal(r.calls, 674);
        assert.equal(r.callsFrom, 'cost');
        assert.deepEqual(r.models, { 'gpt-6-luna': 10 });
        assert.equal(r.cost, 0.13);
        assert.equal(r.stuck, 2);
        assert.equal(r.doors, 2);
        assert.equal(r.doorsFailed, 0);
        assert.deepEqual(r.commands, { '!followPlayer': 3, '!rememberMine': 1 });
    });

    test('the events of single lines', () => {
        const { lines, events } = L.parseLog(fs.readFileSync(LUNA, 'utf8'));
        assert.equal(lines.length, 200);
        assert.deepEqual(events[0], { type: 'span', n: 0, t: 3 * 3600 + 16 * 60 + 32, from: 3 * 3600 + 16 * 60 + 32, to: 4 * 3600 + 9 * 60 + 22 });
        const orders = events.filter((e) => e.type === 'order');
        assert.deepEqual(orders.map((e) => e.n), [29, 39, 72, 102, 113, 130, 163]);
        assert.ok(orders.every((e) => e.player === 'player' && e.typed === false));
        assert.equal(orders[6].text, 'stop');
        const end = events.find((e) => e.type === 'end');
        assert.equal(end.n, 195);
        assert.equal(end.code, 1);
        assert.equal(end.reason, 'socket');
        assert.deepEqual(events.filter((e) => e.type === 'cost').map((e) => [e.n, e.dollars, e.calls, e.earlier]), [[129, 0.02, 229, 0], [196, 0.13, 674, 0]]);
        assert.deepEqual(events.filter((e) => e.type === 'door').map((e) => [e.name, e.x, e.y, e.z]), [['oak_door', 10, 41, 43], ['oak_fence_gate', -8, 63, 45]]);
        assert.deepEqual(events.filter((e) => e.type === 'stuck').map((e) => e.n), [173, 183]);
    });
});

describe('the journey log of the world tests', () => {
    const r = rowOf(JOURNEY);

    test('every number of the row', () => {
        assert.equal(r.minutes, null);
        assert.equal(r.timed, false);
        assert.equal(r.processes, 1);
        assert.deepEqual(r.ends, {});
        assert.equal(r.orders, 6);
        assert.equal(r.withoutResult, 0);
        assert.equal(r.calls, 0);
        assert.equal(r.callsFrom, 'log');
        assert.deepEqual(r.models, {});
        assert.equal(r.cost, null);
        assert.equal(r.stuck, 0);
        assert.equal(r.doors, 8);
        assert.deepEqual(r.commands, { '!rememberArea': 1, '!followPlayer': 2, '!rememberRoute': 1, '!goToPlayer': 1, '!goToRememberedPlace': 1 });
    });

    test('the typed orders, with the stream prefix of the runner stripped', () => {
        const { lines, events } = L.parseLog(fs.readFileSync(JOURNEY, 'utf8'));
        assert.equal(lines[3].text, 'keys.json not found. Defaulting to environment variables.');
        const orders = events.filter((e) => e.type === 'order');
        assert.deepEqual(orders.map((e) => e.n), [23, 27, 46, 51, 68, 157]);
        assert.ok(orders.every((e) => e.typed && e.t === null));
        assert.equal(events.some((e) => e.type === 'span'), false);
    });
});

describe('the table', () => {
    test('two logs and the total, the commands most first, the note of a log without times', () => {
        const rows = [rowOf(LUNA), rowOf(JOURNEY)];
        rows.push(L.totalRow(rows));
        assert.equal(L.formatTable(rows), [
            '| Log | Minutes | Processes | Ends | Orders | Without result | Calls | Cost | Stuck | Doors open |',
            '|---|---|---|---|---|---|---|---|---|---|',
            '| luna_2026-10-01.log | 52.8 | 1 | socket 1 | 7 | 2 | 674 (gpt-6-luna 10) | $0.13 | 2 | 2 |',
            '| journey_ten_minutes.log | - | 1 | - | 6 | 0 | 0 | - | 0 | 8 |',
            '| Total | 52.8 | 2 | socket 1 | 13 | 2 | 674 (gpt-6-luna 10) | $0.13 | 2 | 10 |',
            '',
            'Commands chosen, luna_2026-10-01.log: !followPlayer 3, !rememberMine 1',
            'Commands chosen, journey_ten_minutes.log: !followPlayer 2, !goToPlayer 1, !goToRememberedPlace 1, !rememberArea 1, !rememberRoute 1',
            'Commands chosen, Total: !followPlayer 5, !goToPlayer 1, !goToRememberedPlace 1, !rememberArea 1, !rememberMine 1, !rememberRoute 1',
            'journey_ten_minutes.log has no times: an order counts as without result when no result came before the next order.',
        ].join('\n'));
    });
});

describe('single rules on small logs', () => {
    const row = (text) => L.scorecard(L.parseLog(text).events)[0];

    test('the 60 s window: a result 60 s after the order counts, 61 s does not', () => {
        const at = (s) => `[10:00:${String(s).padStart(2, '0')}]`;
        const log = (gap) => [
            `${at(0)} bot received message from ann : dig here`,
            `${at(0)} received message from ann : dig here`,
            `[10:0${Math.floor(gap / 60)}:${String(gap % 60).padStart(2, '0')}] bot full response to ann: ""ok""`,
        ].join('\n');
        assert.equal(row(log(60)).withoutResult, 0);
        assert.equal(row(log(61)).withoutResult, 1);
        assert.equal(row(log(60)).orders, 1);
    });

    test('a chat answer to another player is no result; Agent executed is, also "was stopped"', () => {
        assert.equal(row('[10:00:00] bot received message from ann : hi\n[10:00:05] bot full response to bob: ""hi""').withoutResult, 1);
        assert.equal(row('[10:00:00] bot received message from ann : go\n[10:00:05] Agent executed: !goToPlayer and was stopped.').withoutResult, 0);
    });

    test('messages of system are no orders; a bare message of a player that was not printed before is one', () => {
        const r = row('[10:00:00] received message from system : Respond with hello\n[10:00:01] received message from ann : hello');
        assert.equal(r.orders, 1);
        assert.equal(r.withoutResult, 1);
    });

    test('midnight: the minutes go on over 00:00', () => {
        assert.equal(row('[23:59:00] Initializing agent bot...\n[00:01:30] I\'m stuck!').minutes, 2.5);
    });

    test('ends: one reason per process, the exit code when the process gave none; restarts count processes', () => {
        const r = row([
            'Initializing agent bot...', "Agent process ends with exit code 1: Got stuck and couldn't get unstuck", 'Agent process exited with code 1 and signal null', 'Restarting agent...',
            'Initializing agent bot...', 'Agent process exited with code 1 and signal null', 'Restarting agent...',
            'Initializing agent bot...', 'Agent process ends with exit code 1: [LoginGuard] Kicked: Removed from server due to flying, spamming, or invalid movement.',
            'Initializing agent bot...', 'Agent process ends with exit code 1: Disconnected: socketClosed',
            'Initializing agent bot...', "Agent process ends with exit code 1: Got stuck and couldn't get unstuck",
        ].join('\n'));
        assert.equal(r.processes, 5);
        assert.deepEqual(r.ends, { stuck: 2, 'exit 1': 1, kicked: 1, socket: 1 });
        assert.equal(L.countsText(r.ends), 'stuck 2, exit 1 1, kicked 1, socket 1');
    });

    test('cost: the last line of each process; a line that includes earlier processes replaces the sum', () => {
        const one = row([
            'Initializing agent bot...', 'Cost: session $0.10 (chat $0.10), 10 calls.', 'Cost: session $0.20 (chat $0.20), 20 calls.',
            'Initializing agent bot...', 'Cost: session $0.05 (chat $0.05), 4 calls.',
        ].join('\n'));
        assert.equal(one.cost, 0.25);
        assert.equal(one.calls, 24);
        const launch = row([
            'Initializing agent bot...', 'Cost: session $0.20 (chat $0.20), 20 calls.',
            'Initializing agent bot...', 'Cost: session $0.26 (chat $0.26), rate $0.40 per hour, 25 calls. It includes 1 earlier process since the start of the bot.',
        ].join('\n'));
        assert.equal(launch.cost, 0.26);
        assert.equal(launch.calls, 25);
    });

    test('the model of every kind of Awaiting line', () => {
        assert.equal(L.modelOfAwait('Awaiting openai api response from model gpt-6-luna'), 'gpt-6-luna');
        assert.equal(L.modelOfAwait('Awaiting anthropic response from claude-haiku-4-5-20251001...'), 'claude-haiku-4-5-20251001');
        assert.equal(L.modelOfAwait('Awaiting local response... (model: llama3, attempt: 1)'), 'llama3');
        assert.equal(L.modelOfAwait('Awaiting Hugging Face API response... (model: x/y, attempt: 2)'), 'x/y');
        assert.equal(L.modelOfAwait('Awaiting mercury api response from model mercury-coder'), 'mercury-coder');
        assert.equal(L.modelOfAwait('Awaiting LM Studio response from model qwen'), 'qwen');
        assert.equal(L.modelOfAwait('Awaiting deepseek api response...'), 'deepseek');
        assert.equal(L.modelOfAwait('Awaiting Google API response...'), 'Google');
        assert.equal(L.modelOfAwait('Received.'), null);
        const r = row('Awaiting openai api response from model a\nAwaiting openai api response from model b\nAwaiting openai api response from model a');
        assert.deepEqual(r.models, { a: 2, b: 1 });
        assert.equal(r.calls, 3);
        assert.equal(L.cells(r)[6], '3 (a 2, b 1)');
    });

    test('a door that could not be closed is shown beside the closed ones', () => {
        const r = row('Door service: closed oak_door at (1, 2, 3).\nDoor service: could not close oak_trapdoor at (4, 5, 6).');
        assert.equal(L.cells(r)[9], '1, 1 not closed');
    });

    test('UTF-16 with its mark (PowerShell 5) and UTF-8 with a mark read as the same text', () => {
        const text = '[10:00:00] Initializing agent bot...\r\n[10:00:30] I\'m stuck!\r\n';
        const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
        const u8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
        assert.equal(L.decodeLog(u16), text);
        assert.equal(L.decodeLog(u8), text);
        assert.equal(row(L.decodeLog(u16)).minutes, 0.5);
        assert.equal(row(L.decodeLog(u16)).stuck, 1);
    });

    test('an empty log gives a row of zeros', () => {
        const r = row('');
        assert.deepEqual(L.cells(r), ['log', '-', '0', '-', '0', '0', '0', '-', '0', '0']);
    });
});

describe('the script', () => {
    const run = (argv, files = {}) => {
        const out = [];
        const code = M.main(argv, {
            read: (f) => { if (!(f in files)) { const e = new Error('no such file'); e.code = 'ENOENT'; throw e; } return Buffer.from(files[f]); },
            log: (t) => out.push(t),
        });
        return { code, out: out.join('\n') };
    };

    test('no log or an unknown flag: the usage, exit 1', () => {
        assert.deepEqual(run([]), { code: 1, out: 'Usage: node scripts/scorecard.js <log> [<log>...]' });
        assert.deepEqual(run(['--x']), { code: 1, out: 'Unknown argument --x. Usage: node scripts/scorecard.js <log> [<log>...]' });
    });

    test('a log that cannot be read: one line, exit 1', () => {
        assert.deepEqual(run(['a.log']), { code: 1, out: 'Cannot read a.log: ENOENT.' });
    });

    test('one log: its row and no total', () => {
        const { code, out } = run(['dir/a.log'], { 'dir/a.log': '[10:00:00] Initializing agent bot...\n[10:06:00] I\'m stuck!' });
        assert.equal(code, 0);
        assert.match(out, /^\| a\.log \| 6\.0 \| 1 \| - \| 0 \| 0 \| 0 \| - \| 1 \| 0 \|$/m);
        assert.doesNotMatch(out, /Total/);
    });
});
