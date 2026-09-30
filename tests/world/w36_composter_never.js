// W36 composter never (v0.1.4.8 fix round, X1 part 1 and X2; spec E2).
// Defect found on the real server in stage 2: in the long run (w60) !farmCycle was stopped by night_shelter
// while the bot worked at the composter of the saved farm; from then on the bot stood inside the composter (a
// hollow block with an open top) and never came out: every order that walks was stopped by unstuck, nine times
// "I am stuck at (...) and could not walk away.", the process ended at minute 32. In the trials of the fix
// round (this base, unripe wheat, a full composter) the bot stood inside the composter in 6 of 15 cycles, by
// day and at dusk; once farmland beside it became dirt (X2). Against the build before the fix round: samples
// of the bot in the cell of the composter, and a bot that ends in it.
//
// Base world, the modes of the owner, the owner's packs. Every wheat is unripe (age 5), the composter of the
// farm is at level 8 (a bone meal is ready), the chest of the house holds 64 leaf litter and the bot knows it
// (!viewChest). The field is saved as the farm "farm". Four rounds; in each the bot stands outside the gate and
// the player types !farmCycle. Rounds 2 and 4 are at dusk: 24 and 32 s after the order the time is set to 13000
// (night_shelter stops the cycle), 25 s later it is day again. The position of the bot is sampled every 250 ms
// (server). Before each round the house and the farm are built again and the composter filled.
// Every round:
//   - no sample of the bot inside the cell of the composter, none on top of it (X1: never in or on it);
//   - at the end the bot is not in the composter;
//   - no farmland became dirt (X2);
//   - the order ended (it answered, or it was stopped by the reflex at dusk).
// At the end: no "I am stuck at ... and could not walk away.", a typed !goToCoordinates reaches its goal,
// the process lives.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, orderChannel, env, startTrace, printTrace, entityPos, fmt, commands, command, sleep, waitFor, waitIdle,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, buildComposter, composterLevel, itemsText, chestItems, countsOf } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_compost';
const PLAYER = 'w_player';
const ROUNDS = [{ dusk: null }, { dusk: 24 }, { dusk: null }, { dusk: 32 }];
const GIVE_UP = /I am stuck at \(-?\d+, -?\d+, -?\d+\) and could not walk away\./;

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r, { crops: () => ({ crop: 'wheat', age: 5 }) });
        await buildBase(b);
        const g = b.g;
        const f = b.farm;
        const c = f.composter;
        const inCell = (p) => Boolean(p) && Math.floor(p.x) === c.x && Math.floor(p.z) === c.z;
        const soil = f.cells.filter((x) => x.spec.ground === 'farmland');
        const itemsBox = `x=${f.box.min.x - 6},y=${g - 2},z=${f.box.min.z - 6},dx=${f.box.max.x - f.box.min.x + 12},dy=8,dz=${f.box.max.z - f.box.min.z + 12}`;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            orders = await orderChannel(s, { name: PLAYER, at: { x: f.outsideGate.x + 4, y: g + 1, z: f.outsideGate.z - 8 } });
            await placeBot(agent, f.inside, 0);
            const { min, max } = f.box;
            const set = await orders.order(`!setArea("farm", "farm", ${min.x}, ${g - 1}, ${min.z}, ${max.x}, ${g + 3}, ${max.z})`, 20000);
            check(set.includes('Area "farm" (farm) saved:'), 'precondition: the field is saved as the farm "farm"', JSON.stringify(set.slice(0, 200)));
            const t0 = Date.now();

            for (let k = 0; k < ROUNDS.length; k++) {
                const round = ROUNDS[k];
                const R = `round ${k + 1} (${round.dusk ? `dusk ${round.dusk} s after the order` : 'day'})`;
                // ------------------------------------------------ the same start every round
                await command('time set 6000');
                await waitIdle(agent, 30000);
                await placeBot(agent, f.outsideGate, 180);
                await buildBase(b, { parts: ['house', 'farm'] });
                await buildComposter(c, 8);
                // the drops of the last round and of the rebuild (the bed of the house breaks and drops)
                await sleep(500);
                await commands([`kill @e[type=minecraft:item,${itemsBox}]`, `kill @e[type=minecraft:item,x=${b.house.box.min.x - 4},y=${g - 2},z=${b.house.box.min.z - 4},dx=16,dy=10,dz=18]`, `clear ${NAME}`]);
                await placeBot(agent, { x: b.house.chest.x - 1, y: g + 1, z: b.house.chest.z }, -90);
                const seen = await orders.order('!viewChest', 30000);
                const known = agent.packContext().chests?.get(b.house.chest);
                check((known?.items?.leaf_litter || 0) === 64, `${R}: precondition: the bot knows the chest of the house with 64 leaf_litter`, `${JSON.stringify(known?.items)}; ${JSON.stringify(seen.slice(0, 120))}`);
                check(await composterLevel(c) === 8, `${R}: precondition: the composter is at level 8`);
                await placeBot(agent, f.outsideGate, 180);
                await sleep(500);

                // ------------------------------------------------ the cycle
                const trace = startTrace(async () => ({ pos: await entityPos(NAME), action: agent.actions.currentActionLabel || '-' }), 250);
                let duskTimer = null;
                if (round.dusk) duskTimer = setTimeout(() => { command('time set 13000').catch(() => {}); }, round.dusk * 1000);
                const info = await orders.orderInfo('!farmCycle', 300000);
                if (duskTimer) clearTimeout(duskTimer);
                if (round.dusk) {
                    await sleep(25000); // the reflex takes the bot home; then day again
                    await command('time set 6000');
                    await waitFor(() => !agent.bot.isSleeping, { ms: 10000, every: 200 });
                    await sleep(3000);
                }
                const rows = await trace.stop();
                const inside = rows.filter((x) => inCell(x.pos) && x.pos.y < c.y + 0.9);
                const onTop = rows.filter((x) => inCell(x.pos) && x.pos.y >= c.y + 0.9 && x.pos.y < c.y + 2.5);
                const end = await entityPos(NAME);
                const ground = await blockNames(soil.map((x) => x.ground), ['farmland', 'dirt', 'grass_block', 'air']);
                const trampled = soil.filter((x, i) => ground[i] !== 'farmland').map((x) => fmt(x.ground));
                printTrace(`${R}: !farmCycle`, rows, { pos: (x) => fmt(x.pos), y: (x) => x.pos?.y?.toFixed(3), composter: (x) => (inCell(x.pos) ? 'CELL' : '-'), action: (x) => x.action }, 40);
                for (const x of [...inside, ...onTop].slice(0, 6)) note(`${R}: in or on the composter at t=${x.t.toFixed(1)} s: ${fmt(x.pos)} y=${x.pos.y.toFixed(3)} action ${x.action}`);
                note(`${R}: !farmCycle answered after ${(info.ms / 1000).toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 300))}; stopped ${JSON.stringify(info.stopped.map((x) => x.slice(0, 160)))}`);
                note(`${R}: the bot ends at ${fmt(end)}; it carries ${itemsText(countsOf(agent.bot.inventory.items()))}; the chest of the house holds ${itemsText(await chestItems(b.house.chest))}`);
                check(info.done, `${R}: the order ended (an answer or a stop by the reflex)`, `${(info.ms / 1000).toFixed(1)} s, ${JSON.stringify(info.reply.slice(0, 80))}`);
                check(inside.length === 0, `${R}: the bot never stood inside the composter (X1)`, `${inside.length} of ${rows.length} samples${inside[0] ? `, first at ${inside[0].t.toFixed(1)} s` : ''}`);
                check(onTop.length === 0, `${R}: the bot never stood on the composter (X1: the walk never goes over it)`, `${onTop.length} of ${rows.length} samples`);
                check(!(inCell(end) && end.y < c.y + 2.5), `${R}: at the end the bot is not in or on the composter`, fmt(end));
                check(trampled.length === 0, `${R}: no farmland became dirt (X2)`, JSON.stringify(trampled));
                check(s.killed === null, `${R}: the process lives`, String(s.killed));
                if (s.killed !== null) break;
            }

            // ------------------------------------------------ the bot is free at the end
            await command('time set 6000');
            await waitIdle(agent, 30000);
            const goal = b.house.outsideDoor;
            const walk = await orders.orderInfo(`!goToCoordinates(${goal.x}, ${goal.y}, ${goal.z}, 1)`, 90000);
            note(`the last walk: ${JSON.stringify(walk.reply.slice(0, 200))}, stopped ${JSON.stringify(walk.stopped)}`);
            check(/You have reached/.test(walk.reply) && walk.stopped.length === 0, 'after the rounds a typed !goToCoordinates reaches its goal (the bot is not trapped)', JSON.stringify(walk.reply.slice(0, 200)));
            const behaviour = s.behavior.filter((x) => x.t >= t0).map((x) => x.text);
            note(`the behaviour log since the first round: ${JSON.stringify(behaviour.slice(-20))}`);
            check(!behaviour.some((l) => GIVE_UP.test(l)), 'no "I am stuck at ... and could not walk away." in all rounds', JSON.stringify(behaviour.filter((l) => GIVE_UP.test(l)).slice(0, 2)));
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await commands(['time set 6000']).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
