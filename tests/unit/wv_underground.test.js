// Tester T1 of v0.1.4.12 "Understanding and watching", from the spec 4.5 (part F, the scans underground), F1 and F2:
//   - a corridor of natural rock 2 wide, 2 high and 23 long going west, with pockets of water in its walls and floor:
//     scanEnclosure gives border 'rock' (2/3 or more of the border natural), kindOf 'tunnel' (tunnelAt of the mining
//     pack accepts the origin), nothing found to save and the refusal of !rememberArea without a type;
//   - a hollow of rock 6 x 3 x 6 that is no tunnel: border 'rock', kindOf 'cave';
//   - countContents does not count water when the border is rock, and does when it is not;
//   - the three sentences of F2 word for word, and rockText of the corridor with and without its mine.
// Part F was in work by E5 while these tests were written; a failure here is a finding against the spec.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';

const S = await loadSrc('src/agent/areas/area_scan.js');
const K = await loadSrc('src/agent/areas/area_kind.js');
const SE = await loadSrc('src/agent/areas/area_sense.js');
const M = await loadSrc('src/agent/packs/mining/mine_logic.js');

const key = (x, y, z) => `${x},${y},${z}`;

// Natural rock everywhere from y 0 to 59 (stone, with deepslate below 20), air above; then the cells of `open` and
// `water` changed.
function rockWorld({ open = [], water = [] } = {}) {
    const cells = new Map();
    for (const c of open) cells.set(key(c.x, c.y, c.z), 'air');
    for (const c of water) cells.set(key(c.x, c.y, c.z), 'water');
    const getBlockName = (x, y, z) => {
        if (y < -64 || y > 319) return null;
        const own = cells.get(key(x, y, z));
        if (own) return own;
        if (y >= 60) return 'air';
        if ((x + z) % 7 === 0) return 'andesite';
        return y < 20 ? 'deepslate' : 'stone';
    };
    const bot = {
        entities: {},
        blockAt: (p) => {
            const name = getBlockName(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
            return name ? { name, position: p, getProperties: () => ({ level: 0 }), _properties: { level: 0 } } : null;
        },
    };
    return { getBlockName, bot };
}

// The corridor: x 78..100, z 50..51, y 30..31 (23 long, 2 wide, 2 high), rock beyond its ends.
function corridor() {
    const open = [];
    for (let x = 78; x <= 100; x++) for (const z of [50, 51]) for (const y of [30, 31]) open.push({ x, y, z });
    const water = [{ x: 90, y: 30, z: 49 }, { x: 85, y: 31, z: 52 }, { x: 80, y: 29, z: 50 }, { x: 95, y: 29, z: 51 }];
    return rockWorld({ open, water });
}

// The hollow: x 0..5, y 40..42, z 0..5 (6 x 3 x 6), with a pool of water on its floor.
function hollow() {
    const open = [];
    for (let x = 0; x <= 5; x++) for (let y = 40; y <= 42; y++) for (let z = 0; z <= 5; z++) open.push({ x, y, z });
    const water = [{ x: 5, y: 40, z: 5 }, { x: 4, y: 40, z: 5 }];
    return rockWorld({ open, water });
}

const scanTunnel = () => {
    const w = corridor();
    return { w, e: S.scanEnclosure(w.getBlockName, { x: 100.5, y: 30, z: 50.5 }, { tunnelAt: M.tunnelAt }) };
};

describe('F1: a corridor of natural rock with pockets of water', () => {
    test('border rock', () => {
        const { e } = scanTunnel();
        assert.equal(e.border, 'rock');
    });

    test('kindOf: tunnel', () => {
        const { w, e } = scanTunnel();
        const contents = SE.countContents(w.bot, e.box, { border: e.border });
        assert.equal(K.kindOf(e, contents), 'tunnel');
    });

    test('nothing to save: !rememberArea without a type answers the refusal of the spec', () => {
        const { e } = scanTunnel();
        assert.equal(e.found, false);
        assert.equal(e.text, 'I am in a tunnel; a tunnel is saved with "this is the mine" or "dig here".');
    });

    test('the measured tunnel: 2 wide, 23 long, heading west from the east end', () => {
        const { e } = scanTunnel();
        assert.ok(e.tunnel, 'the tunnel of the scan');
        assert.equal(e.tunnel.width, 2);
        assert.equal(e.tunnel.length, 23);
        assert.equal(e.tunnel.dir, 'west');
    });

    test('rockText of the corridor (F2): with the mine "mine" and without a mine', () => {
        const { e } = scanTunnel();
        assert.equal(K.rockText(e, { name: 'mine' }), 'I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".');
        assert.equal(K.rockText(e, null), 'I am in a tunnel 2 wide and 23 long, heading west, of no mine I know.');
    });

    // FINDING: !rememberArea without a type (actions.js) calls scanEnclosure with no tunnelAt; the measure is only the
    // one area_sense registers (useTunnelMeasure) on its first tick with the mining pack. In a fresh process, with
    // area_sense off or before its first tick, the tunnel is a cave: kindOf 'cave' and the answer "I am in a cave; a
    // cave is nothing I save." instead of the tunnel refusal of F1. The same holds for the knowledge line of agent.js
    // (unsavedEnclosure without tunnelAt, F3). This test scans as the command does, in a process where nothing
    // registered the measure.
    test('the corridor scanned as !rememberArea scans it (no tunnelAt option): tunnel, the measure registered when the mining pack loads (T1-1)', () => {
        // T1 found the scan without the measure answering a cave; the lead registers the measure of the mining pack with
        // useTunnelMeasure in _loadWorkPacks (agent.js), as the agent does here, so the command and the knowledge line see it
        S.useTunnelMeasure(M.tunnelAt);
        const w = corridor();
        const e = S.scanEnclosure(w.getBlockName, { x: 100.5, y: 30, z: 50.5 });
        assert.equal(e.border, 'rock');
        assert.equal(K.kindOf(e, SE.countContents(w.bot, e.box, { border: e.border })), 'tunnel');
        assert.equal(e.text, 'I am in a tunnel; a tunnel is saved with "this is the mine" or "dig here".');
    });
});

describe('F1: a hollow of rock that is no tunnel', () => {
    test('border rock, kindOf cave, not saved', () => {
        const w = hollow();
        const e = S.scanEnclosure(w.getBlockName, { x: 2.5, y: 40, z: 2.5 }, { tunnelAt: M.tunnelAt });
        assert.equal(e.border, 'rock');
        assert.equal(e.found, false);
        assert.equal(K.kindOf(e, SE.countContents(w.bot, e.box, { border: e.border })), 'cave');
    });
});

describe('F1: countContents skips water when the border is rock', () => {
    const box = { min: { x: 0, y: 40, z: 0 }, max: { x: 5, y: 42, z: 5 } };

    test('border rock: water 0', () => {
        const w = hollow();
        assert.equal(SE.countContents(w.bot, box, { border: 'rock' }).water, 0);
    });

    test('another border (or none): the two sources count', () => {
        const w = hollow();
        assert.equal(SE.countContents(w.bot, box, { border: 'wall' }).water, 2);
        assert.equal(SE.countContents(w.bot, box).water, 2);
    });
});

describe('F2: the sentences underground, word for word', () => {
    test('a tunnel of a known mine', () => {
        assert.equal(K.tunnelText({ width: 2, length: 23, dir: 'west' }, { name: 'mine' }),
            'I am in a tunnel 2 wide and 23 long, heading west, of the mine "mine".');
    });

    test('a tunnel of no mine', () => {
        assert.equal(K.tunnelText({ width: 1, length: 9, dir: 'north' }, null),
            'I am in a tunnel 1 wide and 9 long, heading north, of no mine I know.');
    });

    test('a cave', () => {
        assert.equal(K.caveText({ at: { x: 3, y: 40, z: 7 }, width: 6, sides: 3 }),
            'I am in a cave at (3, 40, 7), 6 wide and open on 3 sides.');
    });
});
