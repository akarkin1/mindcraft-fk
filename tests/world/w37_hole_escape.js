// W37 hole escape (v0.1.4.8 fix round, X1 part 2; spec A2).
// Defect found on the real server in stage 2: in the long run (w60) the bot stood inside the composter of the
// farm (a hollow block: its floor 0.125 above the block below, its walls a full block high) and never came out.
// Every order that walks was stopped by unstuck after 20 s; the escape (moveAway) could not leave the block,
// nine times "I am stuck at (...) and could not walk away.", then the process ended. Against the build before
// the fix round: the bot stays in the composter, the order is stopped by unstuck, the reflex gives up.
// The correction: the escape of unstuck gets a last step for a bot in a hole or a hollow block: jump and walk
// towards each of the four sides in turn, 1 s each, and see whether the bot came out.
//
// Flat world, the modes of the owner (MODES_PROFILE), stuck_restart_after 3. Two hollow blocks stand on the
// grass: a composter (level 0) with farmland and wheat to its north and east, as in a farm, and an empty
// cauldron. For each: the bot is put inside, the player types !goToCoordinates to a place 6 blocks east. Then:
//   - the bot gets out of the block (server and its own view: another column, on the ground);
//   - the order reaches its goal ("You have reached"; the server sees the bot there); when unstuck stopped it
//     to escape (seen for the composter: the path search does not get out, the escape's last step does), the
//     same order typed again reaches it;
//   - no "I am stuck at (x, y, z) and could not walk away."; when "I'm stuck!" came, "I'm free." follows;
//   - the process lives.
// The log line of the last step of the escape is noted (whether the path search or the escape got it out).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, entityPos, fmt, commands, orderChannel, sleep, STUCK_SAID, FREE_SAID,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames } from './world.js';

const NAME = 'w_hole';
const PLAYER = 'w_player';
const GIVE_UP = /I am stuck at \(-?\d+, -?\d+, -?\d+\) and could not walk away\./;

const r = region(24);
const g = r.g;
const CASES = [
    { name: 'composter', at: { x: r.ox - 6, y: g + 1, z: r.oz - 6 }, block: 'composter[level=0]' },
    { name: 'cauldron', at: { x: r.ox - 6, y: g + 1, z: r.oz + 6 }, block: 'cauldron' },
];

async function build() {
    const cmds = [];
    for (const c of CASES) {
        cmds.push(`setblock ${c.at.x} ${c.at.y} ${c.at.z} minecraft:${c.block}`);
        // farmland with wheat to the north and to the east of it, as beside the composter of a farm
        cmds.push(`setblock ${c.at.x} ${g} ${c.at.z - 1} minecraft:farmland[moisture=7]`, `setblock ${c.at.x} ${g + 1} ${c.at.z - 1} minecraft:wheat[age=3]`);
        cmds.push(`setblock ${c.at.x + 1} ${g} ${c.at.z} minecraft:farmland[moisture=7]`, `setblock ${c.at.x + 1} ${g + 1} ${c.at.z} minecraft:wheat[age=3]`);
    }
    const out = await commands(cmds);
    if (out.flat().some((l) => /not loaded|Incorrect|Unknown|Invalid|Expected/.test(l))) throw new Error('building failed: ' + out.flat().join(' | '));
}

await scenarioMain({
    async main() {
        await prepareRegion(r);
        let agent = null, orders = null;
        try {
            await build();
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, ...FLAGS_0148_OFF, world_memory: true, stuck_restart_after: 3 }));
            agent = s.agent;
            await resetBot(NAME);
            orders = await orderChannel(s, { name: PLAYER, at: { x: r.ox + 10, y: g + 1, z: r.oz } });

            for (const c of CASES) {
                const inColumn = (p) => Boolean(p) && Math.floor(p.x) === c.at.x && Math.floor(p.z) === c.at.z;
                const [kept] = await blockNames([c.at], [c.name]);
                check(kept === c.name, `${c.name}: precondition: the ${c.name} stands`, String(kept));
                await placeBot(agent, { x: c.at.x, y: g + 1.4, z: c.at.z }, 0);
                await sleep(1500);
                const inside = agent.bot.entity.position.clone();
                const server = await entityPos(NAME);
                note(`${c.name}: the bot at ${fmt(inside)} (y ${inside.y.toFixed(3)}), the server says ${fmt(server)}, the block there: ${agent.bot.blockAt(inside)?.name}`);
                check(inColumn(inside) && inside.y < g + 2 && inColumn(server), `${c.name}: precondition: the bot stands inside the ${c.name}`, fmt(inside));

                const from = s.behavior.length;
                const logsFrom = s.logs.length;
                const t0 = Date.now();
                const target = { x: c.at.x + 6, y: g + 1, z: c.at.z };
                const order = orders.orderInfo(`!goToCoordinates(${target.x}, ${target.y}, ${target.z}, 1)`, 180000);
                const out = await waitFor(async () => {
                    const p = agent.bot.entity.position;
                    return !inColumn(p) && agent.bot.entity.onGround && !inColumn(await entityPos(NAME)) ? p.clone() : null;
                }, { ms: 150000, every: 250 });
                const tOut = (Date.now() - t0) / 1000;
                const info = await order;
                await sleep(1000);
                const lines = s.behavior.slice(from).map((x) => x.text);
                const lastStep = s.logs.slice(logsFrom).filter((l) => /escape/i.test(l) && /jump/i.test(l));
                note(`${c.name}: out after ${out.ok ? tOut.toFixed(1) + ' s' : 'never'}; the behaviour log ${JSON.stringify(lines)}`);
                note(`${c.name}: the order answered after ${(info.ms / 1000).toFixed(1)} s: ${JSON.stringify(info.reply.slice(0, 200))}; stopped ${JSON.stringify(info.stopped.map((x) => x.slice(0, 160)))}`);
                note(`${c.name}: ${lastStep.length ? `the last step of the escape: ${JSON.stringify(lastStep.slice(0, 3))}` : 'no log line of the last step of the escape (the path search got it out)'}`);
                check(out.ok, `${c.name}: the bot got out of the ${c.name}`, out.ok ? fmt(out.value) : fmt(agent.bot.entity.position));
                // unstuck stops the running command before it escapes (the stop is reported, X4); then the same order
                // typed again must reach its goal
                let reply = info.reply;
                if (!/You have reached/.test(reply) && /stopped by the reflex unstuck/.test(reply) && out.ok) {
                    await waitFor(() => !agent.actions.executing, { ms: 20000 });
                    const again = await orders.orderInfo(`!goToCoordinates(${target.x}, ${target.y}, ${target.z}, 1)`, 90000);
                    note(`${c.name}: the order typed again after the escape answered ${JSON.stringify(again.reply.slice(0, 160))}`);
                    reply = again.reply;
                }
                const end = await entityPos(NAME);
                check(/You have reached/.test(reply) && end && Math.hypot(end.x - (target.x + 0.5), end.z - (target.z + 0.5)) < 2,
                    `${c.name}: the order reached its goal, at once or typed again after the escape ("You have reached"; the server sees the bot there)`, `${JSON.stringify(reply.slice(0, 120))}, bot at ${fmt(end)}`);
                check(!lines.some((l) => GIVE_UP.test(l)), `${c.name}: the reflex did not give up ("I am stuck at ... and could not walk away.")`, JSON.stringify(lines));
                const i = lines.indexOf(STUCK_SAID);
                if (i >= 0) check(lines.slice(i + 1).includes(FREE_SAID), `${c.name}: after "${STUCK_SAID}" the escape says "${FREE_SAID}"`, JSON.stringify(lines));
                check(s.killed === null, `${c.name}: the process lives`, String(s.killed));
                await waitFor(() => !agent.actions.executing, { ms: 20000 });
            }
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
