// Tests from the spec v0.1.4.14 (tester T1, round 2), written from SPEC.md and HANDOFF.md, not from the code.
//   describe 'SPEC 4.1 ...'             : package.json carries exactly the versions of the table of SPEC 4.1 (dependencies and
//                                         overrides), mineflayer-pathfinder pinned at 2.4.5, engines.node >=22; the installed
//                                         node_modules/<lib>/package.json agree.
//   describe 'SPEC 4.2 the patch files' : the patch files of the table of SPEC 4.2 (as corrected in round 1, DECISIONS R1-1 to
//                                         R1-3) exist, the four old ones do not.
//   describe 'SPEC 4.2 the hunks'       : what the round 1 tests (xl_entity_action, rta_physics_patch, stf_chat_checksum) do
//                                         not check: the digging material fix before digTime and no isInWater line; the place
//                                         timeout 500; the two chat hunks in the installed chat.js; the trapdoor list of
//                                         prismarine-physics (10 kinds added, every trapdoor of 26.1 known); the use_item
//                                         rotation upstream with the pitch; the explosion knockback upstream as vec3f64.
//   describe 'SPEC 4.2 player_loaded'   : no file of src/ writes player_loaded (wg_spawn checks agent.js alone).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { repoPath } from '../helpers/paths.js';

const require = createRequire(repoPath('package.json'));
const read = (rel) => fs.readFileSync(repoPath(rel), 'utf8').replace(/\r\n/g, '\n');
const pkg = JSON.parse(read('package.json'));
const installed = (lib) => JSON.parse(read(`node_modules/${lib}/package.json`)).version;

// SPEC 4.1, the column "To"
const TABLE = {
    'mineflayer': '4.39.0',
    'minecraft-protocol': '1.68.0',
    'minecraft-data': '3.119.0',
    'prismarine-chunk': '1.41.0',
    'prismarine-physics': '1.11.1',
    'prismarine-recipe': '1.5.0',
    'prismarine-registry': '1.12.0',
    'prismarine-block': '1.23.0',
    'prismarine-item': '1.18.0',
    'prismarine-entity': '2.6.0',
    'prismarine-windows': '2.10.0',
    'prismarine-world': '3.7.0',
    'prismarine-biome': '1.4.0',
    'prismarine-chat': '1.13.0',
    'prismarine-nbt': '2.8.0',
};
// "as today" (v0.1.4.13, 25bb58d)
const AS_TODAY = {
    'mineflayer-pvp': '^1.3.2',
    'mineflayer-collectblock': '^1.4.1',
    'mineflayer-armor-manager': '^2.0.1',
    'mineflayer-auto-eat': '^3.3.6',
    'prismarine-viewer': '^1.32.0',
};

describe('SPEC 4.1 the libraries', () => {
    test('every library of the table: the exact version in dependencies or overrides, never a range', () => {
        for (const [lib, version] of Object.entries(TABLE)) {
            const declared = [pkg.dependencies?.[lib], pkg.overrides?.[lib]].filter((v) => v !== undefined);
            assert.ok(declared.length > 0, `${lib} is declared`);
            for (const v of declared) assert.equal(v, version, `${lib}`);
        }
    });

    test('mineflayer, minecraft-protocol and minecraft-data in dependencies; prismarine-item in both', () => {
        for (const lib of ['mineflayer', 'minecraft-protocol', 'minecraft-data', 'prismarine-item'])
            assert.equal(pkg.dependencies[lib], TABLE[lib], lib);
        for (const lib of ['minecraft-protocol', 'minecraft-data', 'prismarine-item'])
            assert.equal(pkg.overrides[lib], TABLE[lib], `${lib} in overrides`);
    });

    test('every prismarine library of the table is pinned in overrides (the version mineflayer gets)', () => {
        for (const lib of Object.keys(TABLE).filter((l) => l.startsWith('prismarine-')))
            assert.equal(pkg.overrides[lib], TABLE[lib], lib);
    });

    test('mineflayer-pathfinder pinned at 2.4.5 (no ^); the others as today, mineflayer-auto-eat stays ^3.3.6', () => {
        assert.equal(pkg.dependencies['mineflayer-pathfinder'], '2.4.5');
        for (const [lib, version] of Object.entries(AS_TODAY)) assert.equal(pkg.dependencies[lib], version, lib);
        assert.equal(pkg.dependencies.protodef ?? pkg.overrides.protodef, undefined, 'protodef as today: not declared');
    });

    test('engines.node is >=22', () => {
        assert.deepEqual(pkg.engines, { node: '>=22' });
    });

    test('the installed versions agree with the table; pathfinder 2.4.5; protodef stays 1.19.0', () => {
        for (const [lib, version] of Object.entries(TABLE)) assert.equal(installed(lib), version, lib);
        assert.equal(installed('mineflayer-pathfinder'), '2.4.5');
        assert.equal(installed('protodef'), '1.19.0');
        assert.match(installed('mineflayer-auto-eat'), /^3\./);
    });

    test('minecraft-data 3.119.0 holds the data of 26.1 and none of 26.2 (the version list names later protocols only)', () => {
        const minecraftData = require('minecraft-data');
        assert.equal(minecraftData('26.1')?.version.minecraftVersion, '26.1');
        assert.equal(minecraftData('26.2'), null);
    });

    // mineflayer itself is left out: mineflayer-pvp 1.3.2 brings mineflayer-utils with its own old mineflayer 2.41.0, as today
    test('no copy of minecraft-data, minecraft-protocol or a prismarine library sits nested with another version', () => {
        const nested = [];
        const walk = (dir, depth) => {
            if (depth > 4 || !fs.existsSync(dir)) return;
            for (const entry of fs.readdirSync(dir)) {
                if (entry.startsWith('.')) continue;
                if (entry.startsWith('@')) { walk(path.join(dir, entry), depth); continue; }
                const sub = path.join(dir, entry, 'node_modules');
                if (fs.existsSync(sub)) {
                    for (const lib of Object.keys(TABLE).filter((l) => l !== 'mineflayer')) {
                        const p = path.join(sub, lib, 'package.json');
                        if (fs.existsSync(p)) {
                            const v = JSON.parse(fs.readFileSync(p, 'utf8')).version;
                            if (v !== TABLE[lib]) nested.push(`${path.relative(repoPath('.'), p)} ${v}`);
                        }
                    }
                    walk(sub, depth + 1);
                }
            }
        };
        walk(repoPath('node_modules'), 0);
        assert.deepEqual(nested, []);
    });
});

describe('SPEC 4.2 the patch files', () => {
    const files = fs.readdirSync(repoPath('patches')).sort();

    test('the patches of the new versions exist', () => {
        for (const name of ['minecraft-protocol+1.68.0.patch', 'mineflayer+4.39.0.patch', 'mineflayer-pathfinder+2.4.5.patch',
            'mineflayer-pvp+1.3.2.patch', 'prismarine-physics+1.11.1.patch', 'prismarine-viewer+1.33.0.patch', 'protodef+1.19.0.patch'])
            assert.ok(files.includes(name), name);
        assert.equal(files.length, 7, files.join(', '));
    });

    test('the four old files are gone (minecraft-data dropped, the others regenerated)', () => {
        for (const name of ['minecraft-data+3.98.0.patch', 'minecraft-protocol+1.62.0.patch', 'mineflayer+4.33.0.patch', 'prismarine-physics+1.10.0.patch'])
            assert.ok(!files.includes(name), name);
        assert.ok(!files.some((f) => f.startsWith('minecraft-data+')), 'no patch of minecraft-data');
    });

    test('each patch is named after the installed version of its library', () => {
        for (const file of files) {
            const m = file.match(/^(.+)\+(\d+\.\d+\.\d+)\.patch$/);
            assert.ok(m, file);
            assert.equal(installed(m[1]), m[2], file);
        }
    });

    test('the mineflayer patch changes bed.js, chest.js (round 2: the copper chests), craft.js (round 2: one unit at a time), digging.js, entities.js, physics.js, place_block.js and inventory.js (the stale stateId of a closed window, G-4)', () => {
        const patch = read('patches/mineflayer+4.39.0.patch');
        const changed = [...patch.matchAll(/^diff --git a\/node_modules\/mineflayer\/(\S+)/gm)].map((m) => m[1]).sort();
        assert.deepEqual(changed, ['lib/plugins/bed.js', 'lib/plugins/chest.js', 'lib/plugins/craft.js', 'lib/plugins/digging.js', 'lib/plugins/entities.js', 'lib/plugins/inventory.js', 'lib/plugins/physics.js', 'lib/plugins/place_block.js']);
    });
});

describe('SPEC 4.2 the hunks', () => {
    const mfPatch = read('patches/mineflayer+4.39.0.patch');
    const hunkOf = (patch, file) => patch.split(/^diff --git /m).find((h) => h.startsWith(`a/node_modules/${file} `)) ?? '';

    test('digging.js: incorrect_for_wooden_tool is read as mineable/pickaxe before digTime (patch and node_modules)', () => {
        const hunk = hunkOf(mfPatch, 'mineflayer/lib/plugins/digging.js');
        assert.match(hunk, /^\+\s*if \(block\.material === 'incorrect_for_wooden_tool'\)$/m);
        assert.match(hunk, /^\+\s*block\.material = 'mineable\/pickaxe'$/m);
        const src = read('node_modules/mineflayer/lib/plugins/digging.js');
        const fn = src.slice(src.indexOf('function digTime'));
        const fix = fn.indexOf("block.material === 'incorrect_for_wooden_tool'");
        const call = fn.indexOf('block.digTime(');
        assert.ok(fix > 0 && call > 0 && fix < call, 'the fix is in digTime, before the call of block.digTime');
        assert.match(fn.slice(fix, call), /block\.material = 'mineable\/pickaxe'/);
    });

    test('digging.js: the isInWater line is dropped (upstream since 4.37.1)', () => {
        const hunk = hunkOf(mfPatch, 'mineflayer/lib/plugins/digging.js');
        assert.doesNotMatch(hunk.split('\n').filter((l) => /^[+-][^+-]/.test(l)).join('\n'), /isInWater|water/);
    });

    test('place_block.js: the timeout of the block update is 500, not 5000', () => {
        const hunk = hunkOf(mfPatch, 'mineflayer/lib/plugins/place_block.js');
        assert.match(hunk, /^-\s*timeout: 5000,$/m);
        assert.match(hunk, /^\+\s*timeout: 500,$/m);
        const src = read('node_modules/mineflayer/lib/plugins/place_block.js');
        assert.match(src, /timeout: 500,/);
        assert.doesNotMatch(src, /timeout: 5000/);
    });

    test('minecraft-protocol chat.js: both hunks are applied in node_modules, the old checksum call is gone from both', () => {
        const src = read('node_modules/minecraft-protocol/src/client/chat.js');
        const added = 'checksum: computeChatChecksum(acknowledgements.map(signature => ({ signature }))),';
        assert.equal(src.split(added).length - 1, 2, 'two new checksum lines');
        const command = src.slice(src.indexOf('argumentSignatures:'), src.indexOf("'chat_command_signed'"));
        assert.ok(command.includes(added), 'the hunk of the command');
        const message = src.slice(src.indexOf('signature: (client.profileKeys && client._session)'));
        assert.ok(message.slice(0, 400).includes(added), 'the hunk of the chat message');
        assert.doesNotMatch(command + message.slice(0, 400), /computeChatChecksum\(client\._lastSeenMessages\), \/\/ 1\.21\.5\+/);
    });

    test('prismarine-physics index.js: the 10 trapdoor kinds of the patch; every trapdoor block of 26.1 is in the list', () => {
        const patch = read('patches/prismarine-physics+1.11.1.patch');
        const hunk = hunkOf(patch, 'prismarine-physics/index.js');
        const added = [...hunk.matchAll(/^\+\s*if \(blocksByName\.(\w+)\) \{ trapdoorIds\.add\(blocksByName\.\1\.id\) \}/gm)].map((m) => m[1]);
        const copper = ['', 'exposed_', 'weathered_', 'oxidized_'].flatMap((o) => [`${o}copper_trapdoor`, `waxed_${o}copper_trapdoor`]);
        assert.deepEqual(added.sort(), ['bamboo_trapdoor', 'pale_oak_trapdoor', ...copper].sort());
        const src = read('node_modules/prismarine-physics/index.js');
        const listed = new Set([...src.matchAll(/trapdoorIds\.add\(blocksByName\.(\w+)\.id\)/g)].map((m) => m[1]));
        const R = require('minecraft-data')('26.1');
        const trapdoors = R.blocksArray.map((b) => b.name).filter((n) => n.endsWith('_trapdoor'));
        assert.ok(trapdoors.length >= 21, `${trapdoors.length}`);
        assert.deepEqual(trapdoors.filter((n) => !listed.has(n)), []);
    });

    test('prismarine-physics features.json: climbableTrapdoor with 1.21 and 26.1; the climbUsingJump half dropped (R1-2)', () => {
        const patch = read('patches/prismarine-physics+1.11.1.patch');
        const hunk = hunkOf(patch, 'prismarine-physics/lib/features.json');
        const changed = hunk.split('\n').filter((l) => /^[+-][^+-]/.test(l));
        assert.equal(changed.length, 2, changed.join('\n'));
        assert.doesNotMatch(hunk, /climbUsingJump/);
        const features = JSON.parse(read('node_modules/prismarine-physics/lib/features.json'));
        const versions = features.find((f) => f.name === 'climbableTrapdoor').versions;
        assert.ok(versions.includes('1.21') && versions.includes('26.1'));
        assert.ok(features.find((f) => f.name === 'climbUsingJump').versions.includes('26.1'), 'upstream lists 26.1 for climbUsingJump');
    });

    test('inventory.js: use_item carries the yaw and the pitch upstream, so its hunk could go', () => {
        const src = read('node_modules/mineflayer/lib/plugins/inventory.js');
        const write = src.slice(src.indexOf("bot._client.write('use_item'"));
        assert.match(write.slice(0, 300), /rotation: \{\s*x: toNotchianYaw\(bot\.entity\.yaw\),\s*y: toNotchianPitch\(bot\.entity\.pitch\)/);
    });

    test('minecraft-data 3.119.0 reads the knockback of an explosion as vec3f64 on 1.21.8 and 26.1 (the patch could go)', () => {
        for (const version of ['1.21.8', '26.1']) {
            const types = require('minecraft-data')(version).protocol.play.toClient.types;
            const json = JSON.stringify(types.packet_explosion);
            assert.ok(json, `${version}: packet_explosion`);
            assert.match(json, /"playerKnockback",\s*"type":\s*\[\s*"option",\s*"vec3f64"\s*\]|"playerKnockback","type":\["option","vec3f64"\]/, version);
        }
    });
});

describe('SPEC 4.2 player_loaded', () => {
    test('no file of src/ writes player_loaded: mineflayer 4.39.0 sends it (R1-6)', () => {
        const writers = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const p = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(p);
                else if (entry.name.endsWith('.js') && /write\(\s*['"]player_loaded['"]/.test(fs.readFileSync(p, 'utf8'))) writers.push(p);
            }
        };
        walk(repoPath('src'));
        assert.deepEqual(writers, []);
    });
});
