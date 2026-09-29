// W47 creeper in sight (v0.1.4.8 spec C3, I2; finding R3), the counterpart of W46.
// The correction of R3 must not blind the reflex: underground, a creeper that can reach the bot (about the
// same height, in sight) still counts for the bot (C3: |dy| <= 4 and (dBot <= 6 or sight)). This scenario
// fails when the correction of W46 goes too far (for example "underground: never react"). Against v0.1.4.7
// it passes (the old reflex reacted to every creeper within 16 blocks); it guards the new rule.
//
// Base world, the modes of the owner, the owner's packs, difficulty normal, the mine saved as an area of type
// mine (as in W46). The bot stands at the start of the tunnel at y 25; a creeper is summoned 8 blocks away in
// the same tunnel (the tunnel is straight, 1 wide, 2 high: nothing between them).
//   - within 8 s of the summon the mode creeper_safety runs (without any order or model reply);
//   - the bot lives at the end (the creeper is killed after 40 s at the latest).
// Depends on the behaviour of a monster: the runner runs it up to 3 times, 2 must pass.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, command, commands, orderChannel, startTrace, printTrace, sleep, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, dist, entityNumber } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_sight';
const PLAYER = 'w_player';
const TAG = 'mcw_sight';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const box = { min: b.mineBox.min, max: { ...b.mineBox.max, y: g - 6 } };
        const selector = `@e[type=minecraft:creeper,tag=${TAG},limit=1]`;

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await placeBot(agent, b.room.middle, 0);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.outsideDoor.x - 10, y: g + 1, z: b.house.outsideDoor.z - 10 } });
            const set = await orders.order(`!setArea("mine", "mine", ${box.min.x}, ${box.min.y}, ${box.min.z}, ${box.max.x}, ${box.max.y}, ${box.max.z})`, 20000);
            check(/Area "mine" \(mine\) saved:/.test(set), 'precondition: the mine is saved as an area of type mine', JSON.stringify(set.slice(0, 200)));

            let deaths = 0;
            agent.bot.on('death', () => { deaths++; });
            const start = b.tunnel.cells[0];
            await placeBot(agent, start, 0); // facing the tunnel (south is yaw 0 for the teleport)
            await commands(['difficulty normal', `gamemode survival ${NAME}`]);
            const at = b.tunnel.cells[8];
            const out = await command(`summon minecraft:creeper ${at.x + 0.5} ${at.y} ${at.z + 0.5} {PersistenceRequired:1b,Tags:["${TAG}"]}`);
            check(out.some((l) => /Summoned new Creeper/.test(l)), `a creeper is summoned 8 blocks away in the tunnel (run ${env.run})`, out.join(' | '));
            const t0 = Date.now();
            const trace = startTrace(async () => ({ bot: await entityPos(NAME), creeper: await entityPos(selector), action: agent.actions.currentActionLabel || '-', hp: await entityNumber(NAME, 'Health') }), 250);
            const reacted = await waitFor(() => trace.rows.some((x) => String(x.action).startsWith('mode:creeper_safety')), { ms: 8000, every: 100 });
            const ended = await waitFor(() => {
                const last = trace.rows[trace.rows.length - 1];
                return deaths > 0 || (last && !last.creeper) || (reacted.ok && last && !String(last.action).startsWith('mode:creeper_safety') && Date.now() - t0 > 10000);
            }, { ms: 40000, every: 250 });
            await command(`kill ${selector}`);
            await sleep(500);
            const rows = await trace.stop();
            printTrace(`creeper in the tunnel, run ${env.run}`, rows, { bot: (x) => fmt(x.bot), creeper: (x) => fmt(x.creeper), toBot: (x) => (x.creeper ? dist(x.bot, x.creeper).toFixed(1) : '-'), hp: (x) => x.hp, action: (x) => x.action }, 60);
            note(`the reflex ${reacted.ok ? `ran ${(reacted.ms / 1000).toFixed(1)} s after the summon` : 'did not run within 8 s'}; ended ${ended.ok}; deaths ${deaths}`);
            check(reacted.ok, 'the mode creeper_safety ran within 8 s of the summon (a creeper in sight in the same tunnel counts, C3)');
            const health = await entityNumber(NAME, 'Health');
            check(deaths === 0 && health > 0, 'the bot lives', `deaths ${deaths}, health ${health}`);
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[type=minecraft:creeper,x=${r.ox - 150},y=-64,z=${r.oz - 150},dx=300,dy=400,dz=300]`, 'difficulty peaceful']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
