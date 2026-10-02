// Tester T1 of v0.1.4.11 "Navigation and words", from the spec: the texts of section 5 of part W, word for word.
// W1 the route texts with the causes of I1, W4 the surface (texts and the description of !goToSurface), W5 the give
// texts and the argument text built from params, W6 the two lines of the prompt, W7 the dig refusal for each place
// of I2, W8 the failure texts of the scorecard. And "Show me the way again." is gone.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { repoPath, REPO_ROOT } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

register('../helpers/mcdata_hooks.js', import.meta.url);

async function importQuietly() {
    const originalCwd = process.cwd();
    const emptyDir = makeTmpDir();
    const cap = captureConsole();
    process.chdir(emptyDir);
    try {
        const settingsModule = await loadSrc('src/agent/settings.js');
        const index = await loadSrc('src/agent/commands/index.js');
        const actions = await loadSrc('src/agent/commands/actions.js');
        const mcdata = await loadSrc('src/utils/mcdata.js');
        return { settingsModule, index, actions, mcdata };
    } finally {
        process.chdir(originalCwd);
        cap.restore();
        removeTmpDir(emptyDir);
    }
}

const M = await importQuietly();
const RT = await loadSrc('src/agent/packs/routes/texts.js');
const ST = await loadSrc('src/agent/library/skill_texts.js');
const D = await loadSrc('src/agent/dig_request_logic.js');
const SC = await loadSrc('scripts/scorecard_logic.js');

before(() => M.mcdata.__setMcdataForTests(minecraftData('1.21.8')));
after(() => M.mcdata.__setMcdataForTests(null));

// ------------------------------------------------------------------------------------------------ W1

describe('W1 and I1: routeFailedText(route, step, total, at, cause), word for word', () => {
    const route = { name: 'mine', legs: [] };
    const at = { x: 8, y: 41, z: 46 };

    test('door, closed', () => {
        assert.equal(RT.routeFailedText(route, 6, 12, at, { kind: 'door', name: 'door', x: 9, y: 41, z: 43, state: 'closed' }),
            'I could not follow the route "mine" at step 6 of 12: the door at (9, 41, 43) is closed and I could not open it.');
    });

    test('gate, blocked', () => {
        assert.equal(RT.routeFailedText(route, 6, 12, at, { kind: 'door', name: 'gate', x: -6, y: 63, z: 28, state: 'blocked' }),
            'I could not follow the route "mine" at step 6 of 12: the gate at (-6, 63, 28) is blocked.');
    });

    test('ladder with a gap', () => {
        assert.equal(RT.routeFailedText(route, 4, 12, at, { kind: 'ladder', x: 13, z: 51, y: 61, gap: 2 }),
            'I could not follow the route "mine" at step 4 of 12: the ladder at (13, 51) has a gap of 2 at y 61. I need 2 ladders to go on.');
    });

    test('no path', () => {
        assert.equal(RT.routeFailedText(route, 2, 12, at, { kind: 'no_path', from: { x: 11, y: 67, z: 52 }, to: { x: 13, y: 68, z: 51 } }),
            'I could not follow the route "mine" at step 2 of 12: I found no way from (11, 67, 52) to (13, 68, 51).');
    });

    test('stuck', () => {
        assert.equal(RT.routeFailedText(route, 7, 12, at, { kind: 'stuck', at: { x: 8, y: 41, z: 46 } }),
            'I could not follow the route "mine" at step 7 of 12: I got stuck at (8, 41, 46).');
    });

    test('a trapdoor is named a trapdoor', () => {
        assert.equal(RT.routeFailedText(route, 3, 12, at, { kind: 'door', name: 'trapdoor', x: 13, y: 67, z: 51, state: 'closed' }),
            'I could not follow the route "mine" at step 3 of 12: the trapdoor at (13, 67, 51) is closed and I could not open it.');
    });

    test('noWayToStartText', () => {
        assert.equal(RT.noWayToStartText(route, { x: 9, y: 67, z: 52 }, { x: 11, y: 67, z: 52 }),
            'I find no way from (11, 67, 52) to the start of the route "mine" at (9, 67, 52).');
    });

    test('no text of a cause asks the owner to show the way again', () => {
        const causes = [
            { kind: 'door', name: 'door', x: 1, y: 2, z: 3, state: 'closed' },
            { kind: 'ladder', x: 1, z: 3, y: 2, gap: 1 },
            { kind: 'no_path', from: { x: 1, y: 2, z: 3 }, to: { x: 4, y: 5, z: 6 } },
            { kind: 'stuck', at: { x: 1, y: 2, z: 3 } },
            { kind: 'interrupted' },
            null,
        ];
        for (const c of causes) assert.ok(!/show me the way/i.test(RT.routeFailedText(route, 1, 2, at, c)), JSON.stringify(c));
    });
});

describe('W1: "Show me the way again." goes', () => {
    test('no texts.js of a pack holds it', () => {
        const packs = repoPath('src/agent/packs');
        const files = fs.readdirSync(packs).map((d) => path.join(packs, d, 'texts.js')).filter((f) => fs.existsSync(f));
        assert.ok(files.length >= 3, `texts.js files: ${files.length}`);
        for (const f of files) assert.ok(!/show me the way again/i.test(fs.readFileSync(f, 'utf8')), f);
    });

    test('no file under src/ says it', () => {
        const hits = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, e.name);
                if (e.isDirectory()) walk(p);
                else if (/\.(js|json)$/.test(e.name) && /show me the way again/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(REPO_ROOT, p));
            }
        };
        walk(repoPath('src'));
        assert.deepEqual(hits, []);
    });
});

// ------------------------------------------------------------------------------------------------ W4

describe('W4: the surface, word for word', () => {
    test('the four texts', () => {
        assert.equal(ST.SURFACE_TEXTS.already(), 'I am under the open sky already.');
        assert.equal(ST.SURFACE_TEXTS.door('door', { x: 10, y: 67, z: 52 }, { x: 8, y: 67, z: 50 }),
            'I went out through the door at (10, 67, 52) and stand under the open sky at (8, 67, 50).');
        assert.equal(ST.SURFACE_TEXTS.climbed({ x: 9, y: 67, z: 52 }), 'I climbed to the open sky at (9, 67, 52).');
        assert.equal(ST.SURFACE_TEXTS.noWay({ x: 10, y: 48, z: -26 }), 'I find no way to the open sky from (10, 48, -26).');
    });

    test('the description of !goToSurface', () => {
        assert.equal(M.index.getCommand('!goToSurface')?.description,
            'Go out under the open sky: out of a building through its door, up from a mine. Use this when the player says "get to the surface" or "get out".');
    });

    test('goToSurface keeps its first parameter bot (rule 16), the context is optional', async () => {
        const skills = await loadSrc('src/agent/library/skills.js');
        assert.equal(typeof skills.goToSurface, 'function');
        assert.match(String(skills.goToSurface).split('{')[0], /\(\s*bot\b/);
    });
});

// ------------------------------------------------------------------------------------------------ W5

describe('W5: give and the arguments, word for word', () => {
    test('the give texts', () => {
        assert.equal(ST.GIVE_TEXTS.given(44, 'wheat', 'MartyByrde2'), 'Gave 44 wheat to MartyByrde2.');
        assert.equal(ST.GIVE_TEXTS.partly('MartyByrde2', 40, 44, 'wheat', { x: 8, y: 63, z: 28 }),
            'MartyByrde2 took 40 of 44 wheat; 4 lie on the ground at (8, 63, 28).');
    });

    test('!rememberRoute with 2 arguments answers with its form', () => {
        const cmd = M.index.getCommand('!rememberRoute');
        assert.ok(cmd, '!rememberRoute');
        const expected = '!rememberRoute takes 1 argument (name): !rememberRoute("name").';
        assert.equal(M.index.argumentsText(cmd), expected);
        assert.equal(M.index.parseCommandMessage('!rememberRoute("a", "b")'), expected);
    });

    test('!goToCoordinates with 2 arguments answers with its form', () => {
        const cmd = M.index.getCommand('!goToCoordinates');
        const expected = '!goToCoordinates takes 3 or 4 arguments (x, y, z, closeness): !goToCoordinates(x, y, z).';
        assert.equal(M.index.argumentsText(cmd), expected);
        assert.equal(M.index.parseCommandMessage('!goToCoordinates(1, 2)'), expected);
    });

    test('the text is built from params: the names in order, the optional ones in the range, strings in quotes', () => {
        const cmd = {
            name: '!fake',
            params: {
                who: { type: 'string', description: '' },
                n: { type: 'int', description: '' },
                far: { type: 'float', description: '', default: 1 },
                near: { type: 'boolean', description: '', default: false },
            },
        };
        const text = M.index.argumentsText(cmd);
        assert.ok(text.startsWith('!fake takes 2 to 4 arguments (who, n, far, near): '), text);
        assert.ok(text.endsWith(': !fake("who", n).'), text);
    });
});

// ------------------------------------------------------------------------------------------------ W6

const W6 = [
    'Answer a question with words, not with a command, and never stop a running command for a question.',
    'A rule about a place names a place you saved; say "this is the aviary" first when it is not saved.',
];
const FUN = 'take a deep breath and have fun :)';

function baseProfile(rel) {
    try {
        return JSON.parse(execFileSync('git', ['show', `origin/main:${rel}`], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
        return null;
    }
}

describe('W6: the two lines of the prompt in both profiles', () => {
    for (const rel of ['profiles/claude.json', 'profiles/gpt.json']) {
        test(`${rel}: the two lines right after "${FUN}"`, () => {
            const p = JSON.parse(fs.readFileSync(repoPath(rel), 'utf8'));
            assert.ok(p.conversing.includes(`${FUN}\n${W6[0]}\n${W6[1]}\n`), 'the two lines, in order, after the sentence of fun');
            for (const line of W6) assert.equal(p.conversing.split(line).length - 1, 1, `once: ${line}`);
        });
    }

    test('profiles/claude.json: nothing else changed against main (rule 17)', (t) => {
        const base = baseProfile('profiles/claude.json');
        if (!base) return t.skip('origin/main is not reachable');
        const now = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
        const strip = (p) => ({ ...p, conversing: p.conversing.replace(`\n${W6[0]}\n${W6[1]}`, '') });
        assert.deepEqual(strip(now), strip(base));
    });

    test('the two lines are about 150 characters (plan 1.6), not more than 250', () => {
        const n = W6.join('\n').length;
        assert.ok(n <= 250, `${n}`);
    });
});

// ------------------------------------------------------------------------------------------------ W7

describe('W7 and I2: the dig refusal for each place', () => {
    const ALL = ['!mineOre', '!rememberTunnel', '!collectBlocks'];
    const place = (p) => ({ inTunnel: false, inMine: false, underground: false, fromInside: false, ore: null, ...p });

    test('in a tunnel of a known mine', () => {
        assert.equal(D.digRefusalText(ALL, place({ inTunnel: true, inMine: true, underground: true, ore: 'iron' })),
            'I do not write code for digging. From here: !mineOre("iron", 8).');
    });

    test('on the surface', () => {
        assert.equal(D.digRefusalText(ALL, place({ ore: 'diamond' })),
            'I do not write code for digging. From here: !mineOre("diamond", 8, true).');
    });

    test('inside a known mine with mine_from_inside', () => {
        assert.equal(D.digRefusalText(ALL, place({ inMine: true, underground: true, fromInside: true, ore: 'diamond' })),
            'I do not write code for digging. From here: !mineOre("diamond", 8, true).');
    });

    test('in a known mine, not in a tunnel, switch off', () => {
        assert.equal(D.digRefusalText(ALL, place({ inMine: true, underground: true, ore: 'iron' })),
            'I do not write code for digging. From here: !rememberTunnel, then !mineOre("iron", 8).');
    });

    test('underground, no known mine', () => {
        assert.equal(D.digRefusalText(ALL, place({ underground: true, ore: 'iron' })),
            'I do not write code for digging. From here: say "leave the mine", then !mineOre("iron", 8, true).');
    });

    test('no digging command on, as today', () => {
        const text = 'I do not write code for digging. Switch on the mining pack, or type the command !newAction in the chat yourself.';
        assert.equal(D.digRefusalText([], place({ inTunnel: true, inMine: true, underground: true, ore: 'iron' })), text);
        assert.equal(D.digRefusalText([], place({})), text);
    });

    test('the ore: the one of the request when it is in the ore table, else iron; the count 8', () => {
        assert.equal(D.digRefusalText(ALL, place({ inTunnel: true, inMine: true, underground: true, ore: null })),
            'I do not write code for digging. From here: !mineOre("iron", 8).');
        assert.equal(D.digRefusalText(ALL, place({ inTunnel: true, inMine: true, underground: true, ore: 'gold' })),
            'I do not write code for digging. From here: !mineOre("gold", 8).');
        assert.equal(D.DIG_COUNT, 8);
        assert.equal(D.oreOfRequest('dig a tunnel to find diamonds'), 'diamond');
        assert.equal(D.oreOfRequest('dig a tunnel'), null);
    });
});

// ------------------------------------------------------------------------------------------------ W8

describe('W8: the scorecard counts the failure texts', () => {
    test('the beginnings', () => {
        assert.deepEqual([...SC.FAILURE_STARTS].sort(),
            ['I am underground', 'I cannot', 'I could not', 'I find no', 'I stand in no'].sort());
    });

    test('a result text is cut at the first colon or period', () => {
        assert.deepEqual(SC.failureTexts('I could not follow the route "mine" at step 6 of 12: the gate at (1, 2, 3) is blocked.'),
            ['I could not follow the route "mine" at step 6 of 12']);
        assert.deepEqual(SC.failureTexts('I stand in no tunnel: it is open on 3 sides at (10, 30, 6). Stand in the tunnel and say "dig here".'),
            ['I stand in no tunnel']);
        assert.deepEqual(SC.failureTexts('I am underground, not in a mine I know. A new mine starts from the surface.'),
            ['I am underground, not in a mine I know']);
        assert.deepEqual(SC.failureTexts('I find no way to the open sky from (10, 48, -26).'),
            ['I find no way to the open sky from (10, 48, -26)']);
        assert.deepEqual(SC.failureTexts('I mined 8 raw_iron.'), []);
        assert.deepEqual(SC.failureTexts('Gave 4 wheat to w_player.'), []);
    });

    test('a log: counted, the most frequent first, after the table, "Failure texts, <log>: <text> N, ..."', () => {
        const log = [
            '[10:00:00] Initializing agent claude...',
            '[10:00:01] Agent executed: !rememberTunnel and got: I stand in no tunnel: it is open on 3 sides at (10, 30, 6).',
            '[10:00:02] Agent executed: !goToSurface and got: I cannot see the sky.',
            '[10:00:03] Agent executed: !rememberTunnel and got: I stand in no tunnel: the ceiling at (10, 32, 6) is open.',
            '[10:00:04] Agent executed: !mineOre and got: I mined 8 raw_iron.',
        ].join('\n');
        const { events } = SC.parseLog(log);
        const row = SC.scorecard(events, { name: 'a.log' });
        assert.deepEqual(row.failures ?? row[0]?.failures, { 'I stand in no tunnel': 2, 'I cannot see the sky': 1 });
        const rows = Array.isArray(row) ? row : [row];
        assert.equal(SC.formatFailures(rows), 'Failure texts, a.log: I stand in no tunnel 2, I cannot see the sky 1');
    });

    test('at most 10', () => {
        const failures = {};
        for (let i = 0; i < 14; i++) failures[`I could not do ${String.fromCharCode(97 + i)}`] = 20 - i;
        const line = SC.formatFailures([{ log: 'b.log', failures }]);
        assert.equal(line.slice(line.indexOf(': ') + 2).split(', ').length, 10, line);
        assert.ok(line.startsWith('Failure texts, b.log: I could not do a 20, I could not do b 19'), line);
    });
});
