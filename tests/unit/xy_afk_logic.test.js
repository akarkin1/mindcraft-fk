// Spec v0.1.4.16, sections 8.4 and 8.4a (E8): the pure logic and the texts of the AFK creeper kill pack. The room check
// on grids of block names (the hoppers within 3 blocks, a slab at the hoppers' y + 1 or + 2), the until of the order,
// the target rule (a hostile whose centre is within 3.0 blocks of the eyes: a creeper on the first hopper row behind the
// slab counts, one on the next row or 4 blocks off does not, a skeleton in reach counts, a villager, a player, a pet, an
// animal or a golem never), the focus on the target hit last, the weapons (the owner's order, never diamond or
// netherite, the spare at 30 uses), the kill check's arithmetic (the lead's rule: 4 landed hits without a death, or 20
// hits without a hurt event), usesLeft pinned to the mining pack's usesLeftOf, and every text word for word.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadSrc, TEST_MC_VERSION } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { moduleImports } from '../helpers/source_ast.js';

const L = await loadSrc('src/agent/packs/afk_kill/afk_logic.js');
const T = await loadSrc('src/agent/packs/afk_kill/texts.js');
const P = await loadSrc('src/agent/packs/afk_kill/index.js');
const D = await loadSrc('src/agent/packs/mining/dig.js');

const require = createRequire(import.meta.url);
const Item = require('prismarine-item')(TEST_MC_VERSION);
const registry = require('prismarine-registry')(TEST_MC_VERSION);

// A grid of block names: a map "x,y,z" -> name; air elsewhere.
function grid(cells = {}) {
    return (x, y, z) => cells[`${x},${y},${z}`] ?? 'air';
}

// The owner's room in small (the probe's geometry): the spot at (0, 0, 0), the kill chests at body height one cell ahead
// (z 1), the hoppers one above the feet from z 1 to 3 (x -1..1), a bottom slab over the first hopper row at the hoppers'
// y + 1 (or + 2: a one-block gap above the first hopper row).
function room({ slabDy = 1, slab = true, hopperZ = [1, 2, 3], slabName = 'stone_slab' } = {}) {
    const cells = {};
    for (let x = -1; x <= 1; x++) {
        cells[`${x},0,1`] = 'chest';
        for (const z of hopperZ) cells[`${x},1,${z}`] = 'hopper';
        if (slab) cells[`${x},${1 + slabDy},1`] = slabName;
    }
    return cells;
}

const SPOT = { x: 0, y: 0, z: 0 };
// The eyes of the bot sneaking and stepped 0.2 under the slab (the probe: the chest's inset stops the step at z .70)
const EYE = { x: 0.5, y: 1.27, z: 0.7 };
const mob = (name, type, pos, extra = {}) => ({ id: extra.id ?? 7, name, type, position: pos, height: extra.height ?? 1.7, ...extra });

describe('the room check (8.4)', () => {
    test('the owner\'s room: the hoppers within 3 blocks, the slab at the hoppers\' y + 1, towards +z', () => {
        const r = L.checkRoom(grid(room()), SPOT);
        assert.equal(r.ok, true);
        assert.equal(r.reason, null);
        assert.equal(r.hoppers.length, 9);
        assert.deepEqual(r.slab, { x: 0, y: 2, z: 1 });
        assert.equal(r.hopperY, 1);
        assert.deepEqual(r.towards, { x: 0, z: 1 });
    });

    test('a slab at the hoppers\' y + 2 (a one-block gap above the first hopper row, the probe\'s room where the XP flows) counts', () => {
        const r = L.checkRoom(grid(room({ slabDy: 2 })), SPOT);
        assert.equal(r.ok, true);
        assert.deepEqual(r.slab, { x: 0, y: 3, z: 1 });
    });

    test('any *_slab counts; a slab at y + 3 or only over the spot\'s own column does not', () => {
        assert.equal(L.checkRoom(grid(room({ slabName: 'oak_slab' })), SPOT).ok, true);
        assert.equal(L.checkRoom(grid(room({ slabDy: 3 })), SPOT).reason, 'no_slab');
        const own = { ...room({ slab: false }), '0,2,0': 'stone_slab' };
        assert.equal(L.checkRoom(grid(own), SPOT).reason, 'no_slab');
    });

    test('no slab: the reason no_slab, the hoppers known', () => {
        const r = L.checkRoom(grid(room({ slab: false })), SPOT);
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'no_slab');
        assert.equal(r.hoppers.length, 9);
    });

    test('no hopper within 3 blocks (they are 4 off): no_hopper; a reader that throws: no_hopper; a bad spot: no_spot', () => {
        assert.equal(L.checkRoom(grid(room({ hopperZ: [4] })), SPOT).reason, 'no_hopper');
        assert.equal(L.checkRoom(grid({}), SPOT).reason, 'no_hopper');
        assert.equal(L.checkRoom(() => { throw new Error('unloaded'); }, SPOT).reason, 'no_hopper');
        assert.equal(L.checkRoom(grid(room()), null).reason, 'no_spot');
        assert.equal(L.checkRoom(grid(room()), { x: 'a', y: 0, z: 0 }).reason, 'no_spot');
    });

    test('blockDistance, isSlabName, rowBetween, directionTo', () => {
        assert.equal(L.blockDistance({ x: 0, y: 0, z: 0 }, { x: -1, y: 1, z: 3 }), 3);
        assert.equal(L.isSlabName('prismarine_slab'), true);
        assert.equal(L.isSlabName('slab'), false);
        assert.equal(L.isSlabName(null), false);
        assert.deepEqual(L.rowBetween(SPOT, [{ x: 0, y: 1, z: 2 }]), [{ x: 0, z: 1 }, { x: 0, z: 2 }]);
        assert.deepEqual(L.directionTo(SPOT, [{ x: -2, y: 1, z: 0 }, { x: -3, y: 1, z: 1 }]), { x: -1, z: 0 });
        assert.equal(L.directionTo(SPOT, []), null);
    });
});

describe('the until of the order', () => {
    test('nothing, "level N", "N minutes" (also min, hours), anything else is not understood', () => {
        assert.deepEqual(L.parseUntil(''), { kind: 'open' });
        assert.deepEqual(L.parseUntil(undefined), { kind: 'open' });
        assert.deepEqual(L.parseUntil('  '), { kind: 'open' });
        assert.deepEqual(L.parseUntil('level 30'), { kind: 'level', level: 30 });
        assert.deepEqual(L.parseUntil('Level 2'), { kind: 'level', level: 2 });
        assert.deepEqual(L.parseUntil('until level 14'), { kind: 'level', level: 14 });
        assert.deepEqual(L.parseUntil('20 minutes'), { kind: 'minutes', minutes: 20 });
        assert.deepEqual(L.parseUntil('20 min'), { kind: 'minutes', minutes: 20 });
        assert.deepEqual(L.parseUntil('for 5 minutes'), { kind: 'minutes', minutes: 5 });
        assert.deepEqual(L.parseUntil('1 hour'), { kind: 'minutes', minutes: 60 });
        for (const bad of ['tomorrow', '20', 'level 0', '0 minutes', 'level thirty']) {
            assert.equal(L.parseUntil(bad).kind, 'bad', bad);
        }
        assert.equal(L.parseUntil(' tomorrow ').until, 'tomorrow');
    });

    test('stopReason: health under 10 first, then the level, then the time; null goes on', () => {
        assert.equal(L.stopReason({ kind: 'open' }, { health: 9, level: 0 }), 'health');
        assert.equal(L.stopReason({ kind: 'open' }, { health: 10, level: 99 }), null);
        assert.equal(L.stopReason({ kind: 'level', level: 30 }, { health: 20, level: 30 }), 'level');
        assert.equal(L.stopReason({ kind: 'level', level: 30 }, { health: 20, level: 29 }), null);
        assert.equal(L.stopReason({ kind: 'minutes', minutes: 20 }, { health: 20, elapsedMs: 20 * 60000 }), 'minutes');
        assert.equal(L.stopReason({ kind: 'minutes', minutes: 20 }, { health: 20, elapsedMs: 20 * 60000 - 1 }), null);
        assert.equal(L.stopReason({ kind: 'level', level: 2 }, { health: 9.5, level: 2 }), 'health');
    });
});

describe('the target rule (8.4a)', () => {
    test('a creeper on the first hopper row behind the slab is within 3.0 of the eyes (2.40); the next row (3.21) is not', () => {
        const near = mob('creeper', 'hostile', { x: 0.5, y: 2, z: 2.5 });
        const next = mob('creeper', 'hostile', { x: 0.5, y: 2, z: 3.5 });
        assert.ok(Math.abs(L.distance(EYE, L.centreOf(near)) - 2.40) < 0.01);
        assert.equal(L.isKillTarget(near, EYE), true);
        assert.equal(L.isKillTarget(next, EYE), false);
    });

    test('a creeper 4 blocks off does not count; one standing anywhere in reach does (on the hoppers or not)', () => {
        assert.equal(L.isKillTarget(mob('creeper', 'hostile', { x: 0.5, y: 0, z: 4.7 }), EYE), false);
        assert.equal(L.isKillTarget(mob('creeper', 'hostile', { x: 2.5, y: 0, z: 0.5 }), EYE), true);
    });

    test('a skeleton in reach is hit too (M-6); a slime (type mob) too; a villager, a player, a cat, a cow, an iron golem never', () => {
        const at = { x: 0.5, y: 2, z: 2.5 };
        assert.equal(L.isKillTarget(mob('skeleton', 'hostile', at, { height: 1.99 }), EYE), true);
        assert.equal(L.isKillTarget(mob('slime', 'mob', at, { height: 0.52 }), EYE), true);
        for (const [name, type] of [['villager', 'passive'], ['player', 'player'], ['cat', 'animal'], ['wolf', 'animal'], ['cow', 'animal'],
            ['iron_golem', 'mob'], ['snow_golem', 'mob'], ['copper_golem', 'mob'], ['item', 'other'], ['experience_orb', 'other']]) {
            assert.equal(L.isKillTarget(mob(name, type, at), EYE), false, name);
        }
        assert.equal(L.isHostileEntity({ name: 'villager', type: 'hostile' }), false, 'a villager never, whatever its type');
        assert.equal(L.isKillTarget(null, EYE), false);
        assert.equal(L.isKillTarget(mob('creeper', 'hostile', null), EYE), false);
    });

    test('the centre: the feet plus half the height, 1.7 when the height is not known', () => {
        assert.deepEqual(L.centreOf({ position: { x: 1, y: 2, z: 3 }, height: 2 }), { x: 1, y: 3, z: 3 });
        assert.deepEqual(L.centreOf({ position: { x: 1, y: 2, z: 3 } }), { x: 1, y: 2.85, z: 3 });
        assert.equal(L.centreOf({}), null);
    });

    test('pickTarget: the nearest; the one hit last while it is a target (one hit per 600 ms until it is gone); the dying left out', () => {
        const a = mob('creeper', 'hostile', { x: 0.5, y: 2, z: 2.5 }, { id: 1 });
        const b = mob('creeper', 'hostile', { x: 1.5, y: 2, z: 2.5 }, { id: 2 });
        const far = mob('creeper', 'hostile', { x: 0.5, y: 2, z: 3.5 }, { id: 3 });
        assert.equal(L.pickTarget([b, a, far], EYE), a, 'the nearest');
        assert.equal(L.pickTarget({ 1: a, 2: b }, EYE), a, 'bot.entities works too');
        assert.equal(L.pickTarget([a, b], EYE, { focus: 2 }), b, 'the focus while it is a target');
        assert.equal(L.pickTarget([a, b, far], EYE, { focus: 3 }), a, 'a focus out of reach: the nearest');
        assert.equal(L.pickTarget([a, b], EYE, { skip: new Set([1]) }), b);
        assert.equal(L.pickTarget([a, b], EYE, { skip: [1], focus: 1 }), b, 'a dying focus is left');
        assert.equal(L.pickTarget([far], EYE), null);
    });

    test('eyeOf: 1.62 standing, 1.27 sneaking', () => {
        assert.deepEqual(L.eyeOf({ x: 0.5, y: 64, z: 0.7 }, true), { x: 0.5, y: 65.27, z: 0.7 });
        assert.deepEqual(L.eyeOf({ x: 0.5, y: 64, z: 0.7 }, false), { x: 0.5, y: 65.62, z: 0.7 });
        assert.equal(L.eyeOf(null, true), null);
    });
});

describe('the weapons (K-6, 8.4a)', () => {
    const w = (name, usesLeft = null) => ({ name, usesLeft });

    test('the owner\'s order: iron, stone, copper, golden, wooden swords, then the same axes', () => {
        assert.deepEqual(L.WEAPON_NAMES, ['iron_sword', 'stone_sword', 'copper_sword', 'golden_sword', 'wooden_sword',
            'iron_axe', 'stone_axe', 'copper_axe', 'golden_axe', 'wooden_axe']);
        assert.equal(L.chooseWeapon([w('stone_axe'), w('golden_sword'), w('copper_sword')]).name, 'copper_sword');
        assert.equal(L.chooseWeapon([w('wooden_axe'), w('iron_axe')]).name, 'iron_axe');
        assert.equal(L.chooseWeapon([w('stone_sword', 40), w('stone_sword', 90)]).usesLeft, 90, 'among equals the one with more uses');
    });

    test('never a diamond or netherite weapon: alone they are no weapon', () => {
        assert.equal(L.chooseWeapon([w('diamond_sword'), w('netherite_axe')]), null);
        assert.equal(L.chooseWeapon([w('diamond_sword'), w('wooden_sword')]).name, 'wooden_sword');
        assert.equal(L.isWeaponName('diamond_sword'), false);
        assert.equal(L.isForbiddenItem('diamond_sword'), true);
        assert.equal(L.isForbiddenItem('netherite_pickaxe'), true);
        assert.equal(L.isForbiddenItem('iron_sword'), false);
    });

    test('a worn weapon (10 uses or fewer) only when nothing else is there', () => {
        assert.equal(L.chooseWeapon([w('iron_sword', 9), w('stone_sword', 100)]).name, 'stone_sword');
        assert.equal(L.chooseWeapon([w('iron_sword', 9), w('stone_sword', 5)]).name, 'iron_sword');
        assert.equal(L.isWorn(w('iron_sword', 10)), true);
        assert.equal(L.isWorn(w('iron_sword', 11)), false);
        assert.equal(L.isWorn(w('iron_sword', null)), false, 'unknown uses count as fresh');
    });

    test('the spare (8.4a): fetched when the held one has 30 uses or fewer and the bag has no other weapon that is not worn', () => {
        assert.equal(L.SPARE_AT, 30);
        assert.equal(L.needsSpare(w('stone_sword', 30), []), true);
        assert.equal(L.needsSpare(w('stone_sword', 31), []), false);
        assert.equal(L.needsSpare(w('stone_sword', 30), [w('iron_sword', 200)]), false);
        assert.equal(L.needsSpare(w('stone_sword', 30), [w('iron_sword', 3)]), true, 'a worn spare is none');
        assert.equal(L.needsSpare(w('stone_sword', 30), [w('diamond_sword', 900)]), true, 'a diamond one is none');
        assert.equal(L.needsSpare(null, []), false);
    });

    test('the hits a creeper takes, and the stuck hits of the kill check (the lead\'s 4, more for a weaker sword)', () => {
        assert.equal(L.hitsToKill('stone_sword'), 4);
        assert.equal(L.hitsToKill('iron_sword'), 4);
        assert.equal(L.hitsToKill('wooden_sword'), 5);
        assert.equal(L.hitsToKill('iron_axe'), 3);
        assert.equal(L.stuckHits('stone_sword'), 4);
        assert.equal(L.stuckHits('iron_axe'), 4);
        assert.equal(L.stuckHits('golden_sword'), 5);
        assert.equal(L.stuckHits(null), 4);
    });

    test('usesLeft is the mining pack\'s usesLeftOf for the weapons of 26.1 (the copy the switch-guard rule asks for)', () => {
        assert.equal(L.WEAPON_WEAR, D.WEAR_LIMIT);
        for (const name of [...L.WEAPON_NAMES, 'diamond_sword']) {
            for (const used of [0, 1, 30, 100, 2000]) {
                const item = new Item(registry.itemsByName[name].id, 1);
                item.durabilityUsed = used;
                assert.equal(L.usesLeft(item), D.usesLeftOf(item), `${name} with ${used} used`);
            }
        }
        const stick = new Item(registry.itemsByName.stick.id, 1);
        assert.equal(L.usesLeft(stick), D.usesLeftOf(stick));
        assert.equal(L.usesLeft(null), null);
        assert.equal(L.usesLeft({ maxDurability: 131, durabilityUsed: 101 }), 30);
    });
});

describe('the kill check (K-3, the lead\'s rule of 2026-11-13)', () => {
    test('a window is bad without a kill and without XP, with a stuck target or 20 hits and no hurt event', () => {
        const base = { ...L.newWindow(0, 100) };
        assert.equal(L.windowIsBad({ ...base, hits: 20, landed: 0 }, 100), true);
        assert.equal(L.windowIsBad({ ...base, hits: 19, landed: 0 }, 100), false);
        assert.equal(L.windowIsBad({ ...base, hits: 24, landed: 3 }, 100), false, 'landed hits without a stuck target: the targets die slowly');
        assert.equal(L.windowIsBad({ ...base, hits: 8, landed: 8, stuck: 1 }, 100), true, '4 landed hits without a death');
        assert.equal(L.windowIsBad({ ...base, hits: 30, landed: 0, kills: 1 }, 100), false, 'a kill');
        assert.equal(L.windowIsBad({ ...base, hits: 30, landed: 0 }, 105), false, 'XP gained');
        assert.equal(L.windowIsBad(null), false);
    });

    test('the window is 2 minutes; the first bad window steps closer, the second gives up', () => {
        const win = L.newWindow(1000);
        assert.equal(L.windowOver(win, 1000 + 119999), false);
        assert.equal(L.windowOver(win, 1000 + 120000), true);
        assert.equal(L.badWindowVerdict(0), 'closer');
        assert.equal(L.badWindowVerdict(1), 'give_up');
        assert.equal(L.badWindowVerdict(2), 'give_up');
    });

});

describe('the stored figure (the lead\'s rule of 2026-11-14: the bot looks into the kill chests the hoppers feed)', () => {
    test('gunpowderByChest: the chests within 6 blocks of the spot and the kill chest wherever it is; no gunpowder is 0', () => {
        const chests = [
            { x: 0, y: 0, z: 1, items: { gunpowder: 5 } }, { x: 1, y: 0, z: 1, items: { bone: 3 } },
            { x: 6, y: 0, z: 0, items: { gunpowder: 9 } }, { x: 7, y: 0, z: 0, items: { gunpowder: 40 } },
            { x: 30, y: 64, z: 30, items: { gunpowder: 2 } }, { x: 'a' },
        ];
        assert.deepEqual(L.gunpowderByChest(chests, SPOT), { '0,0,1': 5, '1,0,1': 0, '6,0,0': 9 });
        assert.deepEqual(L.gunpowderByChest(chests, SPOT, { x: 30, y: 64, z: 30 }), { '0,0,1': 5, '1,0,1': 0, '6,0,0': 9, '30,64,30': 2 });
        assert.deepEqual(L.gunpowderByChest(null, SPOT), {});
        assert.equal(L.LOOK_RANGE, 6);
        assert.equal(L.chestKey({ x: -2274.7, y: 170, z: 869.2 }), '-2275,170,869');
    });

    test('storedFigure: the latest look minus the first, the chests seen both times, plus what the bot stored elsewhere', () => {
        // T5's run: the hoppers fed 5 and 2 gunpowder into the two kill chests
        assert.equal(L.storedFigure({ a: 0, b: 0 }, { a: 5, b: 2 }), 7);
        assert.equal(L.storedFigure({ a: 10, b: 3 }, { a: 15, b: 3, c: 99 }), 5, 'a chest not seen at the start does not count');
        assert.equal(L.storedFigure({ a: 10, b: 3 }, { a: 12 }), 2, 'a chest not seen now does not count');
        assert.equal(L.storedFigure({ a: 10 }, { a: 4 }), 0, 'the owner took some: never below 0');
        assert.equal(L.storedFigure({ a: 0 }, { a: 64 }, 0), 64, 'the bot\'s own store into a looked chest is in the difference, once');
        assert.equal(L.storedFigure({ a: 0 }, { a: 5 }, 20), 25, 'plus what it stored into a chest outside the looks');
    });

    test('without a look after the first: null (the lines leave the part out), or what the bot stored elsewhere', () => {
        assert.equal(L.storedFigure(null, null), null);
        assert.equal(L.storedFigure({ a: 5 }, null), null);
        assert.equal(L.storedFigure(null, null, 64), 64);
    });
});

describe('the lines without a stored figure', () => {
    test('the part is left out', () => {
        assert.equal(T.progressText(50, 61, 14, null), 'I killed 50 creepers with 61 hits; level 14.');
        assert.equal(T.progressText(50, 61, 14), 'I killed 50 creepers with 61 hits; level 14.');
        assert.equal(T.stopLevelText(2, 4, 60000, null), 'I stop the farming: level 2 reached; 4 creepers, 1 minute.');
        assert.equal(T.stopMinutesText(20, 70, null), 'I stop the farming: 20 minutes are over; 70 creepers.');
        assert.equal(T.stoppedText(70, null), 'I leave the kill room: you said stop; 70 creepers.');
        assert.equal(T.stoppedText(70, 0), 'I leave the kill room: you said stop; 70 creepers, 0 gunpowder stored.', 'a looked 0 is said');
    });
});

describe('the constants of the spec', () => {
    test('the reach, the pace, the step, the modes, the drops', () => {
        assert.equal(L.KILL_REACH, 3.0);
        assert.equal(L.HIT_GAP_MS, 600);
        assert.equal(L.LOOP_MS, 250);
        assert.equal(L.STEP_MS, 700, '8.4a: the owner\'s 0.7 s');
        assert.equal(L.STORE_FREE_SLOTS, 4);
        assert.equal(L.EAT_AT_FOOD, 14);
        assert.equal(L.LOW_HEALTH, 10);
        assert.equal(L.PROGRESS_EVERY, 50);
        assert.equal(L.CHEST_RANGE, 6);
        assert.equal(L.BED_RANGE, 16);
        assert.deepEqual([...L.PAUSED_MODES], ['cowardice', 'self_defense', 'self_preservation', 'night_shelter', 'hunger', 'item_collecting']);
        assert.equal(L.CREEPER_MODE, 'creeper_safety');
        for (const drop of ['gunpowder', 'bone', 'arrow', 'rotten_flesh', 'string', 'spider_eye']) assert.ok(L.KILL_DROPS.includes(drop), drop);
        for (const keep of ['bread', 'iron_sword', 'stone_sword', 'cobblestone', 'torch']) assert.ok(!L.KILL_DROPS.includes(keep), keep);
    });
});

describe('the texts, word for word (8.4, 8.4a, the lead\'s start line)', () => {
    test('the fixed texts', () => {
        assert.equal(T.TEXTS.noSpot, 'I know no place "kill_spot". Stand at your spot and say "remember here as kill_spot".');
        assert.equal(T.TEXTS.noHopper, 'I see no hopper within 3 blocks of the kill spot; is this the right spot?');
        assert.equal(T.TEXTS.noSlab, 'The kill room has no slab over the hoppers; I do not farm there.');
        assert.equal(T.TEXTS.start, 'I farm creepers at the kill spot. Stay more than 128 blocks away or log out, so the farm\'s monsters get the cap. '
            + 'Leave a one-block gap above the first hopper row, or the XP stays behind the slab.');
        assert.equal(T.TEXTS.noKill, 'I cannot kill from this spot; check the slab and the hoppers.');
        assert.equal(T.TEXTS.noFood, 'I have no food left; I farm on until my health is low.');
        assert.equal(T.TEXTS.noBed, 'No bed within 16 blocks of the kill spot; I farm through the night.');
        assert.ok(Object.isFrozen(T.TEXTS));
    });

    test('the texts with slots', () => {
        assert.equal(T.stepCloserText(24), 'My hits do not kill from here: 24 hits, no XP. I step closer.');
        assert.equal(T.storedLineText({ gunpowder: 64 }), 'I stored 64 gunpowder.');
        assert.equal(T.storedLineText({ gunpowder: 12, bone: 3 }), 'I stored 12 gunpowder, 3 bone.');
        assert.equal(T.noWeaponText(14), 'I have no sword left and cannot make one; I stop the farming at level 14.');
        assert.equal(T.wornWeaponText('stone_sword', 'iron_sword'), 'My stone_sword is worn; I take the iron_sword.');
        assert.equal(T.progressText(50, 61, 14, 62), 'I killed 50 creepers with 61 hits; level 14; 62 gunpowder stored.');
        assert.equal(T.stopLevelText(30, 280, 70 * 60000, 268), 'I stop the farming: level 30 reached; 280 creepers, 1 hour 10 minutes; 268 gunpowder stored.');
        assert.equal(T.stopMinutesText(20, 70, 61), 'I stop the farming: 20 minutes are over; 70 creepers; 61 gunpowder stored.');
        assert.equal(T.stoppedText(70, 61), 'I leave the kill room: you said stop; 70 creepers, 61 gunpowder stored.');
        assert.equal(T.lowHealthText(9), 'I leave the kill room: health 9.');
        assert.equal(T.lowHealthText(9.4), 'I leave the kill room: health 9.');
        assert.equal(T.badUntilText('tomorrow'), 'I do not understand "tomorrow": say "level 30" or "20 minutes", or nothing.');
    });

    test('the numbers in words: 1 creeper, 1 minute, hours', () => {
        assert.equal(T.creepersText(1), '1 creeper');
        assert.equal(T.durationText(0), '0 minutes');
        assert.equal(T.durationText(60000), '1 minute');
        assert.equal(T.durationText(60 * 60000), '1 hour');
        assert.equal(T.durationText(125 * 60000), '2 hours 5 minutes');
        assert.equal(T.progressText(1, 1, 0, 0), 'I killed 1 creeper with 1 hit; level 0; 0 gunpowder stored.');
        assert.equal(T.stopMinutesText(1, 2, 0), 'I stop the farming: 1 minute is over; 2 creepers; 0 gunpowder stored.');
    });
});

describe('the pack\'s modules', () => {
    test('index.js re-exports the logic, the texts and killFarm; no module of the pack imports another pack but the home pack', () => {
        assert.equal(typeof P.killFarm, 'function');
        assert.equal(P.checkRoom, L.checkRoom);
        assert.equal(P.progressText, T.progressText);
        for (const file of ['index.js', 'afk_logic.js', 'texts.js', 'afk_kill.js']) {
            const rel = `src/agent/packs/afk_kill/${file}`;
            assert.ok(fs.existsSync(repoPath(rel)), rel);
            for (const spec of moduleImports(rel).specifiers) {
                assert.ok(spec === 'vec3' || spec.startsWith('./') || spec.startsWith('../home/'), `${rel} imports ${spec}`);
            }
        }
        for (const file of ['afk_logic.js', 'texts.js']) {
            assert.deepEqual(moduleImports(`src/agent/packs/afk_kill/${file}`).specifiers, [], `${file} is pure`);
        }
    });
});
