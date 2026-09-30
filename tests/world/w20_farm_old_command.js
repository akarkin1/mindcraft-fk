// W20 old command, farm (spec v0.1.4.7 section 8 "Old command, farm", F3 last paragraph, G "Old
// commands lead to the new skills"): protected_areas on, world_memory on. Two fields of 9 x 9, each
// with 7 wheat of age 7 on one row and 7 of age 2 on another. The player writes "collect 5 wheat",
// the fake model answers !collectBlocks("wheat", 5).
//   on   farming_pack on, the bot outside the gate of "farm_on" with 8 wheat_seeds: the command runs the
//        harvest with 5 as limit. 5 ripe plants were taken and planted again (age 0), 2 ripe plants
//        and all 7 young ones stand, no farmland became dirt, the bot carries 5 wheat.
//   off  farming_pack off (a new agent process), the bot 3 blocks north of the second field, which
//        has no fence and is NOT saved as a farm: the old command of v0.1.4.6 runs. It breaks wheat
//        and plants nothing again; which wheat it took (ripe or not) is noted, it is what the owner
//        saw in the play test. Why no fence and no area: seen on the test server, the old command of
//        v0.1.4.6 did nothing inside a saved farm (its area guard refused every crop because the air
//        above it belongs to the farm: "All wheat blocks nearby belong to a protected area"; fixed
//        by Amendment 2, I5, see "saved"), and at a closed fenced field that is not saved it did
//        nothing for 210 s without an answer (known, not fixed).
//   saved (Amendment 2, I5) farming_pack off (a new agent process), a third field without a fence,
//        saved as the farm "farm_saved" with !setArea; the bot stands inside it. !collectBlocks("wheat",
//        5) does not say that the wheat belongs to a protected area, it breaks wheat of the farm and
//        answers "Collected <n> wheat.", no farmland becomes dirt.
//   on   also (Amendment 2, I6): !setArea of the fenced field counts its gate: "..., 1 gate."
// v0.1.4.8, B1: the old collecting counts what the inventory gained, every kind: "Collected 17 wheat_seeds,
// 5 wheat." (v0.1.4.7: "Collected 5 wheat."); the checks accept the list when it names the wheat.
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    giveItems, connectPlayer, quitPlayer, waitFor, waitIdle, historyTurn, runPhase, withModes,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, fieldPlan, buildField, cropAges, blockNames, stableInventory, itemsText,
} from './world.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_oldfarm';
const PLAYER = 'w_player';
const BASE = { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true };
// "Collected <list>." of B1 with <n> wheat in the list ("Collected 17 wheat_seeds, 5 wheat.")
const COLLECTED_WHEAT = /Collected (?:\d+ \w+, )*[1-9]\d* wheat(?:, \d+ \w+)*\./;

const r = region(32);
const g = r.g;
const layout = (i, j) => (j === 2 ? { crop: 'wheat', age: 7 } : j === 6 ? { crop: 'wheat', age: 2 } : {});
const FIELD = {
    on: fieldPlan(r.ox - 14, r.oz - 4, g, layout), off: fieldPlan(r.ox + 5, r.oz - 4, g, layout),
    // 12 blocks south of "off": from its inside the nearest wheat is its own
    saved: fieldPlan(r.ox + 5, r.oz + 16, g, layout),
};

async function part(which, settings) {
    const f = FIELD[which];
    const name = `farm_${which}`;
    const ripe = f.cells.filter((c) => c.spec.age === 7);
    const young = f.cells.filter((c) => c.spec.age === 2);
    let agent = null, player = null;
    try {
        const s = await startAgent(NAME, settings);
        agent = s.agent;
        await resetBot(NAME);
        if (which === 'on') {
            await placeBot(agent, f.inside, 0);
            const { min, max } = f.box;
            const set = await command_(agent, `!setArea("${name}", "farm", ${min.x}, ${g - 1}, ${min.z}, ${max.x}, ${g + 3}, ${max.z})`, 20000);
            check(set.includes(`Area "${name}" (farm) saved:`), `${which}: precondition: the field is saved as the farm "${name}"`, JSON.stringify(set.slice(0, 200)));
            check(set.endsWith(', 1 gate.'), `${which} (Amendment 2, I6): the answer of !setArea counts the gate of the fence: "..., 1 gate."`, JSON.stringify(set.slice(0, 200)));
        }
        await placeBot(agent, f.outsideGate, 0);
        if (which === 'on') await giveItems(NAME, [['wheat_seeds', 8]], agent.bot);

        player = await connectPlayer(PLAYER);
        s.route(/w_player: collect 5 wheat/, '!collectBlocks("wheat", 5)');
        const t0 = Date.now();
        player.chat('collect 5 wheat');
        const routed = await waitFor(() => s.routes.length === 0, { ms: 20000 });
        check(routed.ok, `${which}: the model got "collect 5 wheat" and answered !collectBlocks("wheat", 5)`);
        // the command's result comes back to the model as the next request after the command ran
        const back = await waitFor(() => s.chat.requests.length >= 2 && !agent.actions.executing, { ms: 180000, every: 500 });
        await waitIdle(agent, 30000);
        const result = which === 'on' ? historyTurn(agent, 'I harvested') : historyTurn(agent, 'Collected');
        note(`${which}: the command ran ${((Date.now() - t0) / 1000).toFixed(1)} s; its result in the history: ${JSON.stringify(result.slice(0, 300))}`);
        check(back.ok, `${which}: the result of the command came back to the model`);

        const ripeNow = await cropAges(ripe.map((c) => c.above));
        const youngNow = await cropAges(young.map((c) => c.above));
        const ground = await blockNames(f.cells.map((c) => c.ground), ['farmland', 'dirt', 'grass_block', 'air']);
        const inv = await stableInventory(NAME);
        note(`${which}: where the ripe wheat stood: ${JSON.stringify(ripeNow)}; the young wheat: ${JSON.stringify(youngNow)}; the bot carries ${itemsText(inv.items)}`);
        if (which === 'on') {
            check(ripeNow.filter((a) => a === 0).length === 5 && ripeNow.filter((a) => a === 7).length === 2,
                'on: !collectBlocks("wheat", 5) took 5 ripe plants and planted them again (5 cells of age 0), 2 ripe plants stand', JSON.stringify(ripeNow));
            check(youngNow.every((a) => a === 2), 'on: every unripe plant stands (the old command is led to the harvest, which takes ripe wheat only)', JSON.stringify(youngNow));
            check((inv.items.wheat || 0) === 5, 'on: the bot carries 5 wheat', `wheat ${inv.items.wheat || 0}`);
            check(result.includes('I harvested 5 wheat and planted 5 again.'), 'on: the result is the text of the harvest "I harvested 5 wheat and planted 5 again. ..."', JSON.stringify(result.slice(0, 200)));
        } else {
            const broken = [...ripeNow, ...youngNow].filter((a) => a === null).length;
            const replanted = [...ripeNow, ...youngNow].filter((a) => a === 0).length;
            note(`off: the old command broke ${ripeNow.filter((a) => a === null).length} ripe and ${youngNow.filter((a) => a === null).length} unripe plants`);
            check(broken >= 1 && replanted === 0, 'off (old behaviour): !collectBlocks broke wheat and planted nothing again (the harvest of the farming pack did not run)',
                `broken ${broken}, cells of age 0: ${replanted}`);
            check(COLLECTED_WHEAT.test(result) && !result.includes('I harvested'), 'off: the result is the old one ("Collected ... <n> wheat ...", B1), not the text of the farming pack', JSON.stringify(result.slice(-200)));
        }
        check(ground.every((x) => x === 'farmland'), `${which}: no block of farmland became dirt`, JSON.stringify(f.cells.filter((c, i) => ground[i] !== 'farmland').map((c) => c.ground)));
        check(s.realCalls.length === 0, `${which}: no request reached a real model class`, JSON.stringify(s.realCalls));
    } finally {
        await quitPlayer(player);
        await stopRealAgent(agent);
    }
}

// Amendment 2, I5: with farming_pack off the old command takes wheat inside a saved farm.
async function savedFarm() {
    const f = FIELD.saved;
    const name = 'farm_saved';
    const ripe = f.cells.filter((c) => c.spec.age === 7);
    const young = f.cells.filter((c) => c.spec.age === 2);
    let agent = null;
    try {
        const s = await startAgent(NAME, { ...BASE, farming_pack: false });
        agent = s.agent;
        await resetBot(NAME);
        await placeBot(agent, f.inside, 0);
        const { min, max } = f.box;
        const set = await command_(agent, `!setArea("${name}", "farm", ${min.x}, ${g - 1}, ${min.z}, ${max.x}, ${g + 3}, ${max.z})`, 20000);
        check(set.includes(`Area "${name}" (farm) saved:`), `saved: precondition: the field is saved as the farm "${name}"`, JSON.stringify(set.slice(0, 200)));
        const t0 = Date.now();
        const reply = await command_(agent, '!collectBlocks("wheat", 5)', 180000);
        note(`saved: !collectBlocks("wheat", 5) ran ${((Date.now() - t0) / 1000).toFixed(1)} s and answered ${JSON.stringify(reply.slice(0, 300))}`);
        const ripeNow = await cropAges(ripe.map((c) => c.above));
        const youngNow = await cropAges(young.map((c) => c.above));
        const ground = await blockNames(f.cells.map((c) => c.ground), ['farmland', 'dirt', 'grass_block', 'air']);
        const inv = await stableInventory(NAME);
        const broken = [...ripeNow, ...youngNow].filter((a) => a === null).length;
        note(`saved: where the ripe wheat stood: ${JSON.stringify(ripeNow)}; the young wheat: ${JSON.stringify(youngNow)}; the bot carries ${itemsText(inv.items)}`);
        check(!reply.includes('belong to a protected area'), 'saved (I5): the old command does not call the wheat of the saved farm protected', JSON.stringify(reply.slice(0, 300)));
        check(COLLECTED_WHEAT.test(reply) && broken >= 1, 'saved (I5): !collectBlocks("wheat", 5) broke wheat inside the saved farm and answered "Collected ... <n> wheat ..." (B1)',
            `broken ${broken}, ${JSON.stringify(reply.slice(-200))}`);
        check(ground.every((x) => x === 'farmland'), 'saved: no block of farmland became dirt (the guard of the farm)', JSON.stringify(f.cells.filter((c, i) => ground[i] !== 'farmland').map((c) => c.ground)));
        check(s.realCalls.length === 0, 'saved: no request reached a real model class', JSON.stringify(s.realCalls));
    } finally {
        await stopRealAgent(agent);
    }
}

await scenarioMain({
    // v0.1.4.8 (W30): the part with the pack on runs with the modes of the owner; "off" and "saved" test a
    // switch that is off and keep the modes off (spec v0.1.4.8 section 12, T2.1)
    async on() { await part('on', withModes({ ...BASE, farming_pack: true })); },
    async off() { await part('off', { ...BASE, farming_pack: false }); },
    async saved() { await savedFarm(); },
    async main() {
        await prepareRegion(r);
        try {
            await buildField(FIELD.on);
            await buildField(FIELD.off, { fence: false });
            await buildField(FIELD.saved, { fence: false });
            await runPhase(SELF, 'on', {}, 240000);
            await runPhase(SELF, 'off', {}, 240000);
            await runPhase(SELF, 'saved', {}, 240000);
        } finally {
            await releaseRegion(r);
        }
    },
});
exitSoon();
