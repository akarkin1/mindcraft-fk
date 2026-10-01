// Tester T1 of v0.1.4.10 "Goals", from the spec (I7, T1, section 8): the scorecard of a log, pure logic in
// scripts/scorecard_logic.js (parseLog(text) -> { lines, events }, scorecard(events) -> rows, formatTable(rows)),
// on the owner's logs of 2026-10-01 cut to 200 lines (tests/fixtures/logs/*.log).
//
// The numbers expected here are read from the fixtures by hand:
//   journey_ten_minutes.log: 6 messages of the player, no "I'm stuck!", 8 "Door service: closed" lines, no "opened";
//   luna_2026-10-01.log: 7 messages of the player (each logged twice, "gpt received message from player" and
//   "received message from player"), 2 "I'm stuck!", 2 "Door service: closed", the process ended on a closed socket,
//   from 03:16:32 to 04:09:22 (about 53 minutes), 10 "Awaiting openai api response from model gpt-6-luna" lines.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';

const SC = await loadSrc('scripts/scorecard_logic.js');

const HEADER = '| Log | Minutes | Processes | Ends | Orders | Without result | Calls | Cost | Stuck | Doors open |';
const COLUMNS = ['Log', 'Minutes', 'Processes', 'Ends', 'Orders', 'Without result', 'Calls', 'Cost', 'Stuck', 'Doors open'];

const read = (name) => fs.readFileSync(repoPath(`tests/fixtures/logs/${name}`), 'utf8');

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** The first data row of the table after the header, as { column: cell }. */
function firstRow(table) {
    const lines = String(table).split(/\r?\n/);
    const at = lines.findIndex((l) => l.trim() === HEADER);
    assert.ok(at >= 0, `the header of I7 in:\n${table}`);
    const row = lines.slice(at + 1).find((l) => l.trim().startsWith('|') && !/^\|[\s:|-]+\|$/.test(l.trim()));
    assert.ok(row, 'a data row');
    const values = cells(row);
    return Object.fromEntries(COLUMNS.map((c, i) => [c, values[i]]));
}

function card(name) {
    const parsed = SC.parseLog(read(name));
    const rows = SC.scorecard(parsed.events);
    return { parsed, rows, table: SC.formatTable(rows) };
}

// The first number of a cell: "674 (gpt-6-luna 10)" gives 674, "$0.13" gives 0.13.
const num = (cell) => Number(String(cell).match(/-?\d+(?:\.\d+)?/)?.[0] ?? NaN);

describe('I7 T1: the fixtures', () => {
    test('two logs of 200 lines or fewer, the player anonymised', () => {
        for (const name of ['journey_ten_minutes.log', 'luna_2026-10-01.log']) {
            const text = read(name);
            assert.ok(text.split('\n').filter(Boolean).length <= 200, name);
            for (const line of text.split('\n').filter((l) => /received message from/.test(l) && !/from system/.test(l))) {
                assert.match(line, /received message from player :/, `${name}: ${line.slice(0, 80)}`);
            }
        }
    });
});

describe('I7 T1: parseLog, scorecard, formatTable', () => {
    test('the exports', () => {
        assert.equal(typeof SC.parseLog, 'function');
        assert.equal(typeof SC.scorecard, 'function');
        assert.equal(typeof SC.formatTable, 'function');
    });

    test('parseLog gives the lines and the events', () => {
        const text = read('luna_2026-10-01.log');
        const parsed = SC.parseLog(text);
        assert.ok(parsed && typeof parsed === 'object');
        assert.ok('lines' in parsed && 'events' in parsed);
        assert.ok(Array.isArray(parsed.events));
        const lines = text.replace(/\n$/, '').split('\n').length;
        const count = Array.isArray(parsed.lines) ? parsed.lines.length : parsed.lines;
        assert.ok(Math.abs(count - lines) <= 1, `${count} lines, the file has ${lines}`);
    });

    test('the table has the header of I7', () => {
        const { table } = card('journey_ten_minutes.log');
        assert.equal(typeof table, 'string');
        assert.ok(table.split(/\r?\n/).some((l) => l.trim() === HEADER), table);
    });

    test('luna: 7 orders, 2 stuck, ended on the socket, about 53 minutes', () => {
        const row = firstRow(card('luna_2026-10-01.log').table);
        assert.equal(num(row.Orders), 7, `Orders ${row.Orders}`);
        assert.equal(num(row.Stuck), 2, `Stuck ${row.Stuck}`);
        assert.match(row.Ends, /socket/, `Ends ${row.Ends}`);
        assert.ok(num(row.Minutes) >= 52 && num(row.Minutes) <= 54, `Minutes ${row.Minutes}`);
        assert.equal(num(row['Doors open']), 2, `Doors open ${row['Doors open']}`);
        assert.ok(num(row.Calls) >= 10, `Calls ${row.Calls}`);
        assert.match(row.Cost, /\$?\d/, `Cost ${row.Cost}`);
    });

    test('journey: 6 orders, no stuck, 8 doors closed by the service', () => {
        const row = firstRow(card('journey_ten_minutes.log').table);
        assert.equal(num(row.Orders), 6, `Orders ${row.Orders}`);
        assert.equal(num(row.Stuck), 0, `Stuck ${row.Stuck}`);
        assert.equal(num(row['Doors open']), 8, `Doors open ${row['Doors open']}`);
    });

    test('pure: an empty log gives a table and never throws', () => {
        const parsed = SC.parseLog('');
        const table = SC.formatTable(SC.scorecard(parsed.events));
        assert.equal(typeof table, 'string');
    });
});
