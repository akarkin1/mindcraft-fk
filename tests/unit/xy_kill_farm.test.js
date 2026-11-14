// Spec v0.1.4.16, sections 8.4 and 8.4a (E8): killFarm on the home pack's fake bot in a built kill room, on a virtual
// clock. The room is the probe's: the spot at (0, 64, 0), the kill chests at body height one cell ahead (z 1), the hoppers
// one above the feet from z 1 to 3, a bottom slab over the first hopper row; the creepers land on the first free hopper
// row (z 2) behind the slab. The fake follows the probe's facts: a stone sword hit does 5 damage, a second hit within
// 500 ms is swallowed, a creeper dies at the killing hit (entityDead) and its body goes 1 s later (entityGone), a kill
// gives 5 XP; the forward control moves the sneaking bot at 1.3 blocks/s until the chests' inset stops it at z .70.
// Checks: the sneak and the 700 ms step, the hits with bot.attack at most one per 600 ms, the target hit until it is
// gone, the targets (a skeleton yes, a villager and a creeper out of reach never), the kill count, the stop at "level N",
// the time, the owner's stop, low health, the modes off and paused while it runs and restored on every exit, the store
// trip at 4 free slots, the refusals, the weapons (never diamond, the worn line, the spare, the stone sword made), the
// kill check, the night, the food, the progress line, the start line once.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadSrc } from '../helpers/load.js';
import { addMob, give, makeFakeBot, makeWorld, removeEntity, v } from './home_fake_bot.test.js';

const K = await loadSrc('src/agent/packs/afk_kill/afk_kill.js');
const L = await loadSrc('src/agent/packs/afk_kill/afk_logic.js');
const T = await loadSrc('src/agent/packs/afk_kill/texts.js');

let warn;
before(() => {
    warn = console.warn;
    console.warn = () => {};
});
after(() => {
    console.warn = warn;
});

const SPOT = { x: 0, y: 64, z: 0 };
const FIRST_ROW = { x: 0.5, y: 66, z: 2.5 }; // a creeper's feet on the first free hopper row (the hoppers at y 65)
const DAMAGE = { stone_sword: 5, iron_sword: 6, copper_sword: 5, wooden_sword: 4, golden_sword: 4, diamond_sword: 7 };
const MODES = ['creeper_safety', 'cowardice', 'self_defense', 'self_preservation', 'night_shelter', 'hunger', 'item_collecting', 'unstuck'];

// The level of a number of experience points (levels 0 to 16: points = level^2 + 6 level).
const levelOf = (points) => Math.floor((-6 + Math.sqrt(36 + 4 * points)) / 2);

function fakeModes() {
    const on = Object.fromEntries(MODES.map((n) => [n, true]));
    const m = {
        on, paused: new Set(), log: [],
        exists: (n) => Object.hasOwn(on, n),
        isOn: (n) => on[n],
        setOn: (n, value) => { on[n] = value; m.log.push(['setOn', n, value]); },
        pause: (n) => { m.paused.add(n); m.log.push(['pause', n]); },
        unpause: (n) => { m.paused.delete(n); m.log.push(['unpause', n]); },
    };
    return m;
}

/**
 * The kill room and its creepers. Options: slab (false: none), health of the creepers, spawn: ms between a death and the
 * next creeper (null: no spawner), xp (false: the orbs stay behind the slab), immortal (the hits are swallowed: no hurt),
 * tough (hurt but never dying), pos of the bot, weapon (the item in the bag, null: none), hook(ctx) on every 50 ms step.
 */
function scene(options = {}) {
    const o = { slab: true, health: 4, spawn: 1500, xp: true, weapon: 'stone_sword', pos: [0.5, 64, 0.5], ...options };
    const world = makeWorld({ groundY: 63 });
    for (let x = -1; x <= 1; x++) {
        world.set(x, 64, 1, 'chest');
        for (let z = 1; z <= 3; z++) world.set(x, 65, z, 'hopper');
        if (o.slab) world.set(x, 66, 1, 'stone_slab', { type: 'bottom' });
    }
    const bot = makeFakeBot({ world, pos: o.pos });
    bot.modes = fakeModes();
    bot.experience = { level: 0, points: 0, progress: 0 };
    bot.controls = { sneak: false, forward: false };
    const controlLog = [];
    const attacks = [];
    const looks = [];
    const clock = { t: 1_000_000 };
    bot.setControlState = (name, value) => {
        bot.controls[name] = value;
        controlLog.push({ name, value, t: clock.t });
    };
    bot.lookAt = async (p) => { looks.push({ x: p.x, y: p.y, z: p.z }); };
    if (o.weapon) {
        const sword = give(bot, o.weapon, 1);
        sword.maxDurability = o.maxDurability ?? 131;
        sword.durabilityUsed = o.durabilityUsed ?? 0;
    }
    const creepers = new Map(); // id -> { entity, health, hurtAt, diedAt }
    let lastDeath = -Infinity;
    const summon = (name = 'creeper', at = FIRST_ROW, extra = {}) => {
        const e = addMob(bot, name, [at.x, at.y, at.z], { type: extra.type ?? 'hostile' });
        e.height = extra.height ?? 1.7;
        creepers.set(e.id, { entity: e, health: extra.health ?? o.health, hurtAt: -Infinity, diedAt: null });
        return e;
    };
    bot.onAttack = (entity) => {
        attacks.push({ id: entity.id, name: entity.name, t: clock.t, weapon: bot.heldItem?.name ?? null });
        const c = creepers.get(entity.id);
        if (!c || c.diedAt !== null || o.immortal) return;
        if (clock.t - c.hurtAt < 500) return; // the 10-tick invulnerability swallows the hit
        c.hurtAt = clock.t;
        bot.emit('entityHurt', entity);
        if (o.tough) return;
        c.health -= DAMAGE[bot.heldItem?.name] ?? 1;
        if (bot.heldItem && Number.isFinite(bot.heldItem.maxDurability)) bot.heldItem.durabilityUsed += 1;
        if (c.health <= 0) {
            c.diedAt = clock.t;
            bot.emit('entityDead', entity);
            if (o.xp) {
                bot.experience.points += 5;
                bot.experience.level = levelOf(bot.experience.points);
            }
        }
    };
    const s = {
        world, bot, clock, controlLog, attacks, looks, creepers, summon, o,
        logs: [], said: [], places: { kill_spot: SPOT, ...(o.places ?? {}) },
        stepHook: o.hook ?? null,
        kills: () => [...creepers.values()].filter((c) => c.diedAt !== null).length,
    };
    const step = (dt) => {
        clock.t += dt;
        // the sneaking bot walks forward until the chests' inset stops it at z .70
        if (bot.controls.forward) {
            const p = bot.entity.position;
            const speed = bot.controls.sneak ? 1.3 : 4.3;
            bot.entity.position = v(p.x, p.y, Math.min(0.7, p.z + speed * dt / 1000));
        }
        for (const [id, c] of creepers) {
            if (c.diedAt !== null && clock.t - c.diedAt >= 1000 && bot.entities[id]) {
                removeEntity(bot, c.entity);
                bot.emit('entityGone', c.entity);
                lastDeath = clock.t;
            }
        }
        const alive = [...creepers.values()].some((c) => c.diedAt === null && bot.entities[c.entity.id] && c.entity.name === 'creeper');
        if (o.spawn !== null && !alive && clock.t - lastDeath >= o.spawn) {
            summon();
            lastDeath = clock.t; // the next one only after the next death
        }
        if (s.stepHook) s.stepHook(s);
    };
    s.now = () => clock.t;
    s.wait = async (ms) => {
        let left = Math.max(1, ms);
        while (left > 0) {
            const dt = Math.min(50, left);
            step(dt);
            left -= dt;
        }
        await new Promise((r) => setImmediate(r));
    };
    s.ctx = {
        places: { recall: (name) => (s.places[name] ? { ...s.places[name], dimension: 'overworld' } : undefined) },
        log: (t) => s.logs.push(t),
        say: (t) => s.said.push(t),
        now: s.now,
        chests: o.chests ?? null,
        storage: o.storage ?? null,
        tools: o.tools ?? null,
    };
    s.run = (until = '', extra = {}) => K.killFarm(bot, s.ctx, until, { now: s.now, wait: s.wait, ...extra });
    return s;
}

const modesRestored = (bot) => {
    assert.equal(bot.modes.on.creeper_safety, true, 'creeper_safety on again');
    for (const n of L.PAUSED_MODES) assert.ok(!bot.modes.paused.has(n), `${n} unpaused`);
};

describe('the farm at the kill spot', () => {
    test('"level 2": the sneak, the 700 ms step under the slab, one hit per 600 ms, 4 creepers, the stop line, the modes', async () => {
        let during = null;
        const s = scene({ hook: (sc) => { if (!during && sc.attacks.length > 0) during = { on: { ...sc.bot.modes.on }, paused: [...sc.bot.modes.paused] }; } });
        const r = await s.run('level 2');
        assert.equal(r.ok, true, r.text);
        assert.equal(r.reason, null);
        assert.equal(r.text, 'I stop the farming: level 2 reached; 4 creepers, 0 minutes.', 'no look without the storage pack: the part left out');
        assert.equal(r.kills, 4);
        assert.equal(s.bot.experience.level, 2);
        // the sneak first, then the forward control for 700 ms
        const sneakOn = s.controlLog.find((c) => c.name === 'sneak' && c.value === true);
        const fwdOn = s.controlLog.find((c) => c.name === 'forward' && c.value === true);
        const fwdOff = s.controlLog.find((c) => c.name === 'forward' && c.value === false);
        assert.ok(sneakOn && fwdOn && fwdOff && sneakOn.t <= fwdOn.t, 'sneak before the step');
        assert.equal(fwdOff.t - fwdOn.t, L.STEP_MS);
        assert.ok(s.looks.some((p) => p.z > 1), 'the look at the hopper row');
        assert.ok(s.logs.some((l) => l === 'I stand at (0.50, 64.00, 0.70) under the slab, sneaking.'), s.logs.join(' | '));
        // the hits: creepers only, with the sword, at least 600 ms apart
        assert.ok(s.attacks.length >= 4);
        assert.ok(s.attacks.every((a) => a.name === 'creeper' && a.weapon === 'stone_sword'));
        for (let i = 1; i < s.attacks.length; i++) assert.ok(s.attacks[i].t - s.attacks[i - 1].t >= L.HIT_GAP_MS, `gap ${i}`);
        // the modes while it ran, and after
        assert.equal(during.on.creeper_safety, false, 'creeper_safety off at the spot');
        assert.deepEqual(during.paused.filter((n) => L.PAUSED_MODES.includes(n)).sort(), [...L.PAUSED_MODES].sort());
        modesRestored(s.bot);
        assert.equal(s.bot.controls.sneak, false, 'the sneak ends');
        assert.deepEqual(s.said, [T.TEXTS.start]);
        assert.ok(s.logs.some((l) => /^The kill room: 9 hoppers, the slab at \(0, 66, 1\), the chest at \(0, 64, 1\), the bed unknown\.$/.test(l)), s.logs.join(' | '));
    });

    test('a 20 HP creeper takes 4 hits, each 600 ms or more apart, until it is gone; then the next (the focus)', async () => {
        const s = scene({ health: 20, spawn: null, hook: (sc) => { if (sc.kills() === 2) sc.bot.interrupt_code = true; } });
        const a = s.summon('creeper', FIRST_ROW);
        const b = s.summon('creeper', { x: -0.5, y: 66, z: 2.5 });
        const r = await s.run('');
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'I leave the kill room: you said stop; 2 creepers.');
        const ids = s.attacks.map((x) => x.id);
        assert.deepEqual(ids, [a.id, a.id, a.id, a.id, b.id, b.id, b.id, b.id]);
        modesRestored(s.bot);
    });

    test('the targets (8.4a): a skeleton in reach is hit; a villager on the hopper and a creeper on the next row never', async () => {
        const s = scene({ spawn: null, hook: (sc) => { if (sc.clock.t > 1_000_000 + 20000) sc.bot.interrupt_code = true; } });
        const villager = s.summon('villager', FIRST_ROW, { type: 'passive' });
        const far = s.summon('creeper', { x: 0.5, y: 66, z: 3.5 });
        const skeleton = s.summon('skeleton', { x: -0.5, y: 66, z: 2.5 }, { height: 1.99, health: 20 });
        const r = await s.run('');
        assert.equal(r.reason, 'interrupted');
        assert.ok(s.attacks.length >= 4 && s.attacks.every((x) => x.id === skeleton.id), JSON.stringify(s.attacks.map((x) => x.name)));
        assert.ok(!s.attacks.some((x) => x.id === villager.id || x.id === far.id));
        assert.equal(r.kills, 1, 'the skeleton');
    });

    test('a target gone within 1 s of a hit counts as a kill without the death event', async () => {
        const s = scene({ spawn: null, immortal: true, hook: (sc) => {
            const hit = sc.attacks[0];
            if (hit && sc.bot.entities[hit.id] && sc.clock.t - hit.t >= 400) removeEntity(sc.bot, sc.bot.entities[hit.id]), sc.bot.emit('entityGone', { id: hit.id });
            if (hit && sc.clock.t - hit.t > 3000) sc.bot.interrupt_code = true;
        } });
        s.summon('creeper', FIRST_ROW);
        const r = await s.run('');
        assert.equal(r.kills, 1);
    });

    test('"1 minutes": the time line; the walk to the spot and back to where the order came', async () => {
        const s = scene({ pos: [0.5, 64, -5.5] });
        const r = await s.run('1 minutes');
        assert.equal(r.ok, true);
        assert.match(r.text, /^I stop the farming: 1 minute is over; \d+ creepers\.$/);
        assert.ok(r.kills >= 10, `${r.kills} kills in a minute`);
        const p = s.bot.entity.position;
        assert.ok(Math.hypot(p.x - 0.5, p.z + 5.5) <= 1.5, `back where it stood: ${p}`);
    });

    test('the store trip at 4 free slots: storeItems({ only: KILL_DROPS, chest }) into the nearest chest, the quiet line, the sneak again', async () => {
        const calls = [];
        let free = 4;
        const storage = { storeItems: async (opts) => { calls.push(opts); free = 20; return { ok: true, reason: null, stored: { gunpowder: 64 }, text: '' }; } };
        const s = scene({ storage });
        s.bot.inventory.emptySlotCount = () => free;
        const r = await s.run('1 minutes');
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].only, [...L.KILL_DROPS]);
        assert.deepEqual(calls[0].chest, { x: 0, y: 64, z: 1 });
        assert.ok(s.logs.includes('I stored 64 gunpowder.'));
        assert.match(r.text, /; 64 gunpowder stored\.$/);
        const sneaks = s.controlLog.filter((c) => c.name === 'sneak').map((c) => c.value);
        assert.deepEqual(sneaks.slice(0, 3), [true, false, true], 'off for the trip, on again at the spot');
    });

    // The kill chests the hoppers feed (T5's finding of 2026-11-14): a fake lookIntoChests gives the chests by the spot with the
    // gunpowder the hoppers brought so far (2 per kill into (0, 64, 1), 1 into (1, 64, 1)) and a far chest that never counts.
    function hopperChests(s, looks) {
        return async (range, opts) => {
            looks.push({ range, sneaking: s.bot.controls.sneak, t: s.clock.t, opts: typeof opts?.wait });
            const k = s.kills();
            return [
                { x: 0, y: 64, z: 1, items: { gunpowder: 5 + 2 * k } },
                { x: 1, y: 64, z: 1, items: { gunpowder: 1 * k, string: 2 } },
                { x: 40, y: 64, z: 40, items: { gunpowder: 900 } },
            ];
        };
    }

    test('the stop line\'s figure: the bot looks into the kill chests after the climb and at the stop, not sneaking (T5: 5 and 2 in the chests)', async () => {
        const looks = [];
        const s = scene();
        s.ctx.storage = { lookIntoChests: hopperChests(s, looks) };
        const r = await s.run('level 2');
        assert.equal(r.text, 'I stop the farming: level 2 reached; 4 creepers, 0 minutes; 12 gunpowder stored.', '(5 + 8) - 5 + 4 - 0');
        assert.equal(looks.length, 2, 'the start and the stop');
        assert.ok(looks.every((l) => l.sneaking === false && l.range >= L.LOOK_RANGE && l.opts === 'function'), JSON.stringify(looks));
        const firstHit = s.attacks[0].t;
        assert.ok(looks[0].t < firstHit && looks[1].t > s.attacks[s.attacks.length - 1].t);
        assert.equal(r.gunpowder, 12);
    });

    test('the saved kill_chest takes the drops; its gunpowder is counted once with the hoppers\' (the bot\'s store is in the difference)', async () => {
        const calls = [];
        const looks = [];
        let stored = 0;
        const s = scene({ places: { kill_chest: { x: 0, y: 64, z: 1 } } });
        const look = hopperChests(s, looks);
        s.ctx.storage = {
            storeItems: async (opts) => { calls.push(opts); stored += 10; return { ok: true, stored: { gunpowder: 10 } }; },
            lookIntoChests: async (...args) => (await look(...args)).map((c) => (c.x === 0 && c.z === 1 ? { ...c, items: { gunpowder: c.items.gunpowder + stored } } : c)),
        };
        let free = 4;
        s.bot.inventory.emptySlotCount = () => { const f = free; free = 30; return f; };
        const r = await s.run('1 minutes');
        assert.deepEqual(calls[0].chest, { x: 0, y: 64, z: 1 });
        assert.equal(looks.length, 3, 'the start, after the store trip, the stop');
        assert.equal(r.gunpowder, 3 * r.kills + 10);
        assert.match(r.text, new RegExp(`; ${3 * r.kills + 10} gunpowder stored\\.$`));
    });

    test('a store into a chest the looks do not cover counts as it is', async () => {
        const looks = [];
        const s = scene({ places: { kill_chest: { x: 30, y: 64, z: 30 } } });
        const look = hopperChests(s, looks);
        s.ctx.storage = {
            storeItems: async () => ({ ok: true, stored: { gunpowder: 20 } }),
            lookIntoChests: async (...args) => (await look(...args)).filter((c) => c.x !== 40),
        };
        let free = 4;
        s.bot.inventory.emptySlotCount = () => { const f = free; free = 30; return f; };
        const r = await s.run('1 minutes');
        assert.equal(r.gunpowder, 3 * r.kills + 20);
    });

    test('the progress line: the figure of the last look (a store trip), else the part left out', async () => {
        const looks = [];
        const s = scene({ spawn: 200, hook: (sc) => { if (sc.kills() >= 50 && sc.said.length >= 2) sc.bot.interrupt_code = true; } });
        let free = 36;
        s.bot.inventory.emptySlotCount = () => free;
        s.ctx.storage = { lookIntoChests: hopperChests(s, looks), storeItems: async () => { free = 30; return { ok: true, stored: { gunpowder: 0, bone: 4 } }; } };
        s.stepHook = (sc) => {
            if (sc.kills() === 10 && free === 36) free = 4; // a store trip after 10 kills: the look there gives the figure
            if (sc.kills() >= 50 && sc.said.length >= 2) sc.bot.interrupt_code = true;
        };
        const r = await s.run('');
        assert.equal(r.kills, 50);
        assert.match(s.said[1], /^I killed 50 creepers with 50 hits; level 12; (\d+) gunpowder stored\.$/);
        const figure = Number(/; (\d+) gunpowder/.exec(s.said[1])[1]);
        assert.ok(figure >= 30 && figure <= 33, `the look after 10 or 11 kills: ${figure}`);
        assert.match(r.text, /^I leave the kill room: you said stop; 50 creepers, \d+ gunpowder stored\.$/, 'the owner\'s stop: the last look, no new one');
    });

    test('the owner\'s stop: the stop line, the modes restored, no walk out', async () => {
        const s = scene({ hook: (sc) => { if (sc.kills() >= 3) sc.bot.interrupt_code = true; } });
        const r = await s.run('');
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'interrupted');
        assert.equal(r.text, 'I leave the kill room: you said stop; 3 creepers.');
        modesRestored(s.bot);
    });

    test('health under 10: `I leave the kill room: health 9.`, the modes restored', async () => {
        const s = scene({ hook: (sc) => { if (sc.kills() >= 2) sc.bot.health = 9; } });
        const r = await s.run('');
        assert.equal(r.reason, 'low_health');
        assert.equal(r.text, 'I leave the kill room: health 9.');
        modesRestored(s.bot);
    });

    test('the start line once per 30 minutes: a farm the job brings back does not say it again', async () => {
        let enough = 1;
        const s = scene({ hook: (sc) => { if (sc.kills() >= enough) sc.bot.interrupt_code = true; } });
        await s.run('');
        s.bot.interrupt_code = false;
        enough = 2;
        await s.run('');
        assert.deepEqual(s.said, [T.TEXTS.start]);
        assert.ok(s.logs.includes('I farm creepers at the kill spot again.'));
    });

    test('the progress line every 50 kills, with the hits', async () => {
        const s = scene({ spawn: 200, hook: (sc) => { if (sc.kills() >= 50 && sc.said.length >= 2) sc.bot.interrupt_code = true; } });
        const r = await s.run('');
        assert.equal(r.kills, 50);
        // the line comes with the 50th death; that kill's XP comes after it (in the game with its orbs): 49 kills of XP, level 12
        assert.equal(levelOf(49 * 5), 12);
        assert.equal(s.said[1], 'I killed 50 creepers with 50 hits; level 12.');
    });
});

describe('the refusals: nothing moves, the modes untouched', () => {
    const untouched = (bot) => {
        assert.equal(bot.modes.log.length, 0, JSON.stringify(bot.modes.log));
        assert.equal(bot.calls.filter((c) => c[0] === 'attack').length, 0);
    };

    test('no kill_spot', async () => {
        const s = scene();
        delete s.places.kill_spot;
        const r = await s.run('');
        assert.deepEqual([r.ok, r.reason, r.text], [false, 'no_spot', T.TEXTS.noSpot]);
        assert.equal(s.controlLog.length, 0);
        untouched(s.bot);
        assert.ok(s.logs.includes(T.TEXTS.noSpot), 'one log line');
    });

    test('the slab removed: the refusal line and no farming', async () => {
        const s = scene({ slab: false });
        const r = await s.run('level 2');
        assert.deepEqual([r.ok, r.reason, r.text], [false, 'no_slab', 'The kill room has no slab over the hoppers; I do not farm there.']);
        untouched(s.bot);
        assert.equal(s.bot.modes.on.creeper_safety, true);
    });

    test('after the refusal the bot walks back to where the order came, doors on; the modes as they were (T5, 2026-11-14)', async () => {
        for (const slab of [false, true]) {
            const s = scene({ slab, pos: [0.5, 64, -5.5] });
            if (slab) for (let x = -1; x <= 1; x++) for (let z = 1; z <= 3; z++) s.world.set(x, 65, z, 'stone'); // no hopper
            s.world.door(0, 64, -3, { facing: 'south' }); // a closed door on the way, closed again behind the bot
            s.bot.gotoImpl = async (goal) => {
                const { straightGoto } = await import('./home_fake_bot.test.js');
                await straightGoto(s.bot, goal);
                if (s.world.propsAt(0, 64, -3).open) s.world.toggle(0, 64, -3);
            };
            const r = await s.run('level 2');
            assert.equal(r.reason, slab ? 'no_hopper' : 'no_slab');
            const p = s.bot.entity.position;
            assert.ok(Math.hypot(p.x - 0.5, p.z + 5.5) <= 1.5, `back where it stood: ${p}`);
            const opened = s.bot.calls.filter((c) => c[0] === 'pf_open');
            assert.equal(opened.length, 2, 'the door opened on the way there and on the way back (doors on)');
            untouched(s.bot);
        }
    });

    test('no hopper within 3 blocks', async () => {
        const s = scene();
        for (let x = -1; x <= 1; x++) for (let z = 1; z <= 3; z++) s.world.set(x, 65, z, 'stone');
        const r = await s.run('');
        assert.deepEqual([r.reason, r.text], ['no_hopper', 'I see no hopper within 3 blocks of the kill spot; is this the right spot?']);
        untouched(s.bot);
    });

    test('an until it does not understand', async () => {
        const s = scene();
        const r = await s.run('tomorrow');
        assert.deepEqual([r.reason, r.text], ['bad_until', 'I do not understand "tomorrow": say "level 30" or "20 minutes", or nothing.']);
        untouched(s.bot);
    });
});

describe('the weapons (K-6, 8.4a)', () => {
    test('only a diamond sword: never used; the no-weapon line, the modes restored', async () => {
        const s = scene({ weapon: 'diamond_sword' });
        const r = await s.run('');
        assert.deepEqual([r.reason, r.text], ['no_weapon', 'I have no sword left and cannot make one; I stop the farming at level 0.']);
        assert.ok(!s.bot.calls.some((c) => c[0] === 'equip' && c[1] === 'diamond_sword'));
        modesRestored(s.bot);
    });

    test('a diamond and a stone sword: the stone one', async () => {
        const s = scene({ hook: (sc) => { if (sc.kills() >= 1) sc.bot.interrupt_code = true; } });
        give(s.bot, 'diamond_sword', 1).maxDurability = 1561;
        await s.run('');
        assert.ok(s.attacks.length > 0 && s.attacks.every((a) => a.weapon === 'stone_sword'));
        assert.ok(!s.bot.calls.some((c) => c[0] === 'equip' && c[1] === 'diamond_sword'));
    });

    test('a worn iron sword in hand and a fresh stone sword in the bag: `My iron_sword is worn; I take the stone_sword.`', async () => {
        const s = scene({ weapon: 'stone_sword', hook: (sc) => { if (sc.kills() >= 1) sc.bot.interrupt_code = true; } });
        const iron = give(s.bot, 'iron_sword', 1);
        iron.maxDurability = 250;
        iron.durabilityUsed = 242;
        s.bot.heldItem = iron;
        await s.run('');
        assert.ok(s.said.includes('My iron_sword is worn; I take the stone_sword.'), s.said.join(' | '));
        assert.ok(s.attacks.every((a) => a.weapon === 'stone_sword'));
    });

    test('a stone sword with 30 uses and no spare: an iron sword fetched from a chest within 16 blocks, once', async () => {
        const fetched = [];
        let bot;
        const storage = { fetchItem: async (name, n) => { fetched.push([name, n]); const it = give(bot, name, 1); it.maxDurability = 250; it.durabilityUsed = 0; return { ok: true, taken: 1 }; } };
        const chests = { nearest: () => null, get: () => null, find: (name) => (name === 'iron_sword' ? [{ x: 3, y: 64, z: -2, items: { iron_sword: 1 } }] : []) };
        const s = scene({ storage, chests, durabilityUsed: 101, hook: (sc) => { if (sc.kills() >= 3) sc.bot.interrupt_code = true; } });
        bot = s.bot;
        await s.run('');
        assert.deepEqual(fetched, [['iron_sword', 1]]);
        assert.ok(s.logs.includes('I took a spare iron_sword.'));
    });

    test('no weapon, but cobblestone and a stick: ctx.tools.ensureTool("sword", "stone") makes one', async () => {
        const made = [];
        let bot;
        const tools = { ensureTool: async (b, ctx, kind, material) => { made.push([kind, material]); const it = give(bot, 'stone_sword', 1); it.maxDurability = 131; it.durabilityUsed = 0; return { ok: true, tool: 'stone_sword' }; } };
        const s = scene({ weapon: null, tools, hook: (sc) => { if (sc.kills() >= 1) sc.bot.interrupt_code = true; } });
        bot = s.bot;
        give(bot, 'cobblestone', 2);
        give(bot, 'stick', 1);
        await s.run('');
        assert.deepEqual(made, [['sword', 'stone']]);
        assert.ok(s.attacks.length > 0 && s.attacks.every((a) => a.weapon === 'stone_sword'));
    });
});

describe('the kill check (K-3, the lead\'s rule)', () => {
    test('hits that never land: after 2 minutes `I step closer.` and the step again; after 2 more `I cannot kill from this spot`', async () => {
        const s = scene({ immortal: true, spawn: 0 });
        const r = await s.run('');
        assert.deepEqual([r.reason, r.text], ['no_kill', 'I cannot kill from this spot; check the slab and the hoppers.']);
        const closer = s.said.find((t) => t.startsWith('My hits do not kill'));
        assert.match(closer, /^My hits do not kill from here: (\d+) hits, no XP\. I step closer\.$/);
        assert.ok(Number(/(\d+) hits/.exec(closer)[1]) >= L.CHECK_HITS);
        const forwards = s.controlLog.filter((c) => c.name === 'forward');
        assert.ok(forwards.filter((c) => c.value).length >= 3, 'the first step, the step again and the extra 0.2');
        assert.ok(r.ms >= 2 * L.CHECK_WINDOW_MS);
        modesRestored(s.bot);
    });

    test('a creeper that takes 4 landed hits without dying makes the window bad', async () => {
        const s = scene({ tough: true, spawn: 0, xp: false });
        const r = await s.run('');
        assert.equal(r.reason, 'no_kill');
        assert.ok(s.said.some((t) => t.startsWith('My hits do not kill from here: ')));
    });

    test('kills without XP (the orbs behind a low slab) are no bad window', async () => {
        const s = scene({ xp: false, hook: (sc) => { if (sc.clock.t > 1_000_000 + 5 * 60000) sc.bot.interrupt_code = true; } });
        const r = await s.run('');
        assert.equal(r.reason, 'interrupted');
        assert.ok(!s.said.some((t) => t.startsWith('My hits do not kill')));
    });
});

describe('the night and the food', () => {
    test('at night with the kill bed: sleepInBed with the kill bed as the bot\'s own, then back to the spot, the loop goes on', async () => {
        const sleeps = [];
        const sleep = async (bot, ctx) => {
            sleeps.push(ctx.places.recall('my_bed'));
            bot.time.timeOfDay = 1000;
            return { ok: true, reason: null, text: 'I slept. It is morning.' };
        };
        const s = scene({ places: { kill_bed: { x: 3, y: 64, z: -1 } } });
        s.world.bed(3, 64, -1, { facing: 'east' });
        s.bot.time.timeOfDay = 18000;
        const r = await s.run('1 minutes', { sleep });
        assert.equal(r.ok, true);
        assert.deepEqual(sleeps, [{ x: 3, y: 64, z: -1, dimension: 'overworld' }]);
        assert.ok(s.logs.includes('I slept. It is morning.'));
        assert.ok(r.kills > 0, 'the loop resumed after the sleep');
    });

    test('the kill bed is the only bed: taken, or gone, the bot farms on (no sleep elsewhere)', async () => {
        for (const occupied of [true, null]) {
            const sleeps = [];
            const s = scene({ places: { kill_bed: { x: 3, y: 64, z: -1 } } });
            if (occupied) s.world.bed(3, 64, -1, { facing: 'east', occupied: true });
            s.bot.time.timeOfDay = 18000;
            const r = await s.run('1 minutes', { sleep: async () => { sleeps.push(1); return { ok: true }; } });
            assert.equal(r.ok, true);
            assert.equal(sleeps.length, 0);
            assert.ok(s.logs.includes(occupied ? 'The kill bed is taken; I farm on.' : 'The kill bed at (3, 64, -1) is gone; I farm on.'), s.logs.join(' | '));
            assert.ok(r.kills > 0);
        }
    });

    test('the sleep context of a MemoryBank: my_bed is the kill bed, its places come as JSON (the villagers\' beds check)', async () => {
        let seen = null;
        const s = scene({ places: { kill_bed: { x: 3, y: 64, z: -1 } } });
        s.world.bed(3, 64, -1, { facing: 'east' });
        s.ctx.places = {
            recallPlaceInfo: (name) => (s.places[name] ? { ...s.places[name], dimension: 'overworld' } : undefined),
            getJson: () => ({ trading_hall: [40, 64, 40] }),
        };
        s.bot.time.timeOfDay = 18000;
        await s.run('1 minutes', { sleep: async (bot, ctx) => {
            seen = { bed: ctx.places.recall('my_bed'), spot: ctx.places.recall('kill_spot'), json: ctx.places.getJson?.(), list: typeof ctx.places.list };
            bot.time.timeOfDay = 1000;
            return { ok: true, text: 'I slept. It is morning.' };
        } });
        assert.deepEqual(seen, { bed: { x: 3, y: 64, z: -1, dimension: 'overworld' }, spot: { x: 0, y: 64, z: 0, dimension: 'overworld' },
            json: { trading_hall: [40, 64, 40] }, list: 'undefined' });
    });

    test('at night without a bed: the line once, the farm goes on', async () => {
        const s = scene();
        s.bot.time.timeOfDay = 18000;
        const r = await s.run('1 minutes', { sleep: async () => { throw new Error('no bed: no sleep'); } });
        assert.equal(r.ok, true);
        assert.equal(s.said.filter((t) => t === T.TEXTS.noBed).length, 1);
    });

    test('food at 14: eatBestFood; without food the line once, the farm goes on', async () => {
        const eats = [];
        const s = scene();
        s.bot.food = 14;
        const r = await s.run('2 minutes', { eat: async () => { eats.push(1); return { ok: false, ate: 0, reason: 'no_food', text: '' }; } });
        assert.equal(r.ok, true);
        assert.ok(eats.length >= 2, `${eats.length} tries`);
        assert.equal(s.said.filter((t) => t === T.TEXTS.noFood).length, 1);
        assert.ok(r.kills > 0);
    });
});
