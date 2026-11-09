// v0.1.4.14, part L (engineer E1), fix round part 8 (P-17, spec 8.1.3): the time listener of agent.js takes the crossing
// of the marks of the day since the last time event (sunrise 0, noon 6000, sunset 12000, midnight 18000) instead of the
// exact values, so a sunrise is neither missed (the clock of 26.1 runs between packets and the event comes every 20
// ticks) nor doubled. src/agent/clock_logic.js is pure; the listener's text is checked in agent.js.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { repoPath } from '../helpers/paths.js';
import { DAY_MARKS, DAY_TICKS, JUMP_TICKS, crossedMarks } from '../../src/agent/clock_logic.js';

const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');

describe('L: the marks of the day the clock crossed (clock_logic.js)', () => {
    test('the marks and the constants', () => {
        assert.deepEqual(DAY_MARKS, { sunrise: 0, noon: 6000, sunset: 12000, midnight: 18000 });
        assert.equal(DAY_TICKS, 24000);
        assert.equal(JUMP_TICKS, 12000);
    });

    test('the clock runs over a mark between two events: the mark once, not missed', () => {
        assert.deepEqual(crossedMarks(11990, 12010), ['sunset']);
        assert.deepEqual(crossedMarks(5999, 6000), ['noon'], 'landing on the mark counts');
        assert.deepEqual(crossedMarks(6000, 6020), [], 'the mark stood on at the last event is not doubled');
        assert.deepEqual(crossedMarks(17985, 18005), ['midnight']);
    });

    test('the wrap of the day: 23990 to 10 crosses the sunrise', () => {
        assert.deepEqual(crossedMarks(23990, 10), ['sunrise']);
        assert.deepEqual(crossedMarks(23990, 0), ['sunrise']);
        assert.deepEqual(crossedMarks(0, 20), []);
    });

    test('a long gap crosses several marks, in order', () => {
        assert.deepEqual(crossedMarks(5000, 13000), ['noon', 'sunset']);
        assert.deepEqual(crossedMarks(17000, 1000), ['midnight', 'sunrise']);
        assert.deepEqual(crossedMarks(100, 11999), ['noon']);
    });

    test('the first event (no previous value): only a mark stood on exactly, as the old rule said', () => {
        assert.deepEqual(crossedMarks(null, 0), ['sunrise']);
        assert.deepEqual(crossedMarks(undefined, 12000), ['sunset']);
        assert.deepEqual(crossedMarks(null, 12700), []);
    });

    test('a jump of half a day or more (time set) is no run of the clock: only a mark landed on exactly', () => {
        assert.deepEqual(crossedMarks(12700, 1000), [], 'time set 1000 from the evening crosses nothing');
        assert.deepEqual(crossedMarks(12700, 0), ['midnight', 'sunrise'], 'less than half a day forward (the sleep skips the night): a run');
        assert.deepEqual(crossedMarks(13000, 0), ['midnight', 'sunrise'], 'the morning after a sleep');
        assert.deepEqual(crossedMarks(1000, 13000), [], 'time set 13000 from the morning: exactly 12000 forward is a jump');
        assert.deepEqual(crossedMarks(1000, 12999), ['noon', 'sunset'], 'one tick less is a run');
        assert.deepEqual(crossedMarks(1000, 18000), ['midnight']);
    });

    test('no movement and bad values: nothing', () => {
        assert.deepEqual(crossedMarks(500, 500), []);
        assert.deepEqual(crossedMarks(500, NaN), []);
        assert.deepEqual(crossedMarks(500, null), []);
        assert.deepEqual(crossedMarks(NaN, 6000), ['noon'], 'a bad previous value counts as none');
        assert.deepEqual(crossedMarks(23999.5, 30000), ['sunrise', 'noon'], 'a time beyond 24000 is taken within the day; fractions are floored');
    });

    test('the time listener of agent.js uses crossedMarks and emits the marks', () => {
        const src = read('src/agent/agent.js');
        assert.match(src, /import \{ crossedMarks \} from '\.\/clock_logic\.js'/);
        const at = src.indexOf("this.bot.on('time', () => {");
        assert.ok(at > 0, 'the time listener');
        const body = src.slice(at, src.indexOf('});', at));
        assert.match(body, /for \(const mark of crossedMarks\(lastTimeOfDay, timeOfDay\)\)/);
        assert.match(body, /this\.bot\.emit\(mark\)/);
        assert.doesNotMatch(body, /timeOfDay == 0|== 6000|== 12000|== 18000/, 'no exact comparison is left');
    });
});
