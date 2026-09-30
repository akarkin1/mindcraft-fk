// W14 a creeper that stands (Amendment 2 F3): home_pack and protected_areas on, creeper_fighting off,
// world_memory on, difficulty normal, the modes of the owner's base profile (as in w09). The creeper
// is summoned with NoAI, so it stands near the house and never follows the bot: the case that the
// real server showed before F3, where the bot waited 90 s for a creeper that did not come.
//   1. The bot stands at the door of the saved house, the creeper 10 blocks north of the house. The
//      creeper_safety reflex leads away, walks back twice to be seen (never closer than 8 blocks) and
//      leaves the creeper alone (leave_it) well within the 90 s of H6. The creeper counts as standing,
//      the house is untouched, the door was not opened while the creeper was within 16 blocks of it.
//   2. At night the player orders !goToShelter. The only door is within 16 blocks of the standing
//      creeper: the bot does not open it and digs in at least 24 blocks from the creeper.
// The creeper does not move, so this scenario does not depend on the behaviour of a monster.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, MODES_OFF, placeBot, resetBot,
    command_, waitFor, entityPos, fmt, startTrace, printTrace, sleep, command, commands, importProject, recordConsole,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, isOpen, hdist, dist,
    snapshotBox, compareSnapshot, describeDifferences, dropSnapshot, entityNumber,
} from './world.js';

const NAME = 'w_standing';
const TAG = 'mcw_standing';
const ASSISTANT_MODES = { ...MODES_OFF, self_preservation: true, unstuck: true, self_defense: true, item_collecting: true,
    torch_placing: true, elbow_room: true, idle_staring: true };
const STANDS = 'A creeper stands near "home" and does not follow me. I keep away from it.';

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        const h = housePlan(r.ox - 3, r.oz + 8, g);
        await buildHouse(h);
        const selector = `@e[type=minecraft:creeper,tag=${TAG},limit=1]`;

        let agent = null;
        let snap = null;
        try {
            const s = await startAgent(NAME, {
                ...NEW_FLAGS_OFF, home_pack: true, protected_areas: true, creeper_fighting: false, world_memory: true,
                profile: { modes: ASSISTANT_MODES },
            });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, h.inside, 0);
            const saved = await command_(agent, '!rememberArea("home", "home")', 30000); // v0.1.4.8: a shelter is an area of type home (C4)
            check(/Area "home" \(home\) saved: .*\b1 door\b/.test(saved), 'precondition: !rememberArea saved the house as "home" with its door', JSON.stringify(saved.slice(0, 200)));
            snap = await snapshotBox(h.box);
            const K = await importProject('src/agent/packs/home/creeper.js');

            // ---------------------------------------------------------- 1. the reflex leaves it alone
            const atDoor = { x: h.door.x, y: g + 1, z: h.door.z - 1 };
            await placeBot(agent, atDoor, 180);
            await commands(['difficulty normal', `gamemode survival ${NAME}`]);
            const spawnAt = { x: h.door.x, y: g + 1, z: h.box.min.z - 10 };
            const out = await command(`summon minecraft:creeper ${spawnAt.x + 0.5} ${spawnAt.y} ${spawnAt.z + 0.5} {NoAI:1b,PersistenceRequired:1b,Tags:["${TAG}"]}`);
            check(out.some((l) => /Summoned new Creeper/.test(l)), 'a creeper that does not move is summoned 10 blocks north of the house', out.join(' | '));
            const creeperAt = await entityPos(selector);
            const doorCenter = { x: h.door.x + 0.5, y: h.door.y, z: h.door.z + 0.5 };
            const tSummon = Date.now();
            const trace = startTrace(async () => ({
                bot: await entityPos(NAME), open: await isOpen(h.door), action: agent.actions.currentActionLabel || '-',
            }), 300);
            const ended = await waitFor(() => {
                const rows = trace.rows;
                const ran = rows.some((x) => String(x.action).startsWith('mode:creeper_safety'));
                const last = rows[rows.length - 1];
                return ran && last && !String(last.action).startsWith('mode:creeper_safety');
            }, { ms: 100000, every: 300 });
            const tEnd = Date.now();
            await sleep(1000);
            const rows = await trace.stop();
            printTrace('1: a creeper that stands', rows, {
                bot: (x) => fmt(x.bot), toCreeper: (x) => dist(x.bot, creeperAt).toFixed(1), door: (x) => (x.open ? 'OPEN' : 'closed'), action: (x) => x.action,
            });
            const seconds = (tEnd - tSummon) / 1000;
            note(`1: the reflex ended ${ended.ok ? 'after ' + seconds.toFixed(1) + ' s' : 'never (100 s)'}`);
            check(rows.some((x) => String(x.action).startsWith('mode:creeper_safety')), '1: the creeper_safety reflex ran');
            check(ended.ok && seconds < 75, '1: the reflex ended well within the 90 s of H6 (it did not wait for the creeper)', ended.ok ? `${seconds.toFixed(1)} s` : 'did not end');
            const standing = K.creeperMemory(agent.bot).watch.standingIds(Date.now());
            const seen = Object.values(agent.bot.entities).find((e) => e.name === 'creeper');
            check(Boolean(seen) && standing.includes(seen.id), '1: the creeper counts as standing (leave_it)', JSON.stringify({ standing, id: seen?.id }));
            const closest = Math.min(...rows.filter((x) => x.bot).map((x) => dist(x.bot, creeperAt)));
            check(closest >= 7.5, '1: the bot never came closer than 8 blocks to the creeper (7.5 with the tolerance of the sampling)', `closest ${closest.toFixed(1)}`);
            const bad = rows.filter((x) => x.open === true && hdist(creeperAt, doorCenter) <= 16);
            check(bad.length === 0, '1: the bot did not open the door while the creeper was within 16 blocks of it');

            // ---------------------------------------------------------- 2. night: dig in away from it
            await command(`give ${NAME} minecraft:dirt 4`);
            await waitFor(() => agent.bot.inventory.items().some((i) => i.name === 'dirt'), { ms: 5000 });
            const logLines = recordConsole('log'); // the result of a mode goes to the console
            const trace2 = startTrace(async () => ({ bot: await entityPos(NAME), open: await isOpen(h.door), action: agent.actions.currentActionLabel || '-' }), 400);
            await command('time set 13000');
            const night = await waitFor(() => {
                const r2 = trace2.rows;
                const ran = r2.some((x) => String(x.action).startsWith('mode:night_shelter'));
                const last = r2[r2.length - 1];
                return ran && last && !String(last.action).startsWith('mode:night_shelter');
            }, { ms: 90000, every: 400 });
            await sleep(800);
            const end = await entityPos(NAME);
            const rows2 = await trace2.stop();
            printTrace('2: night comes with the creeper standing at the door', rows2, {
                bot: (x) => fmt(x.bot), toCreeper: (x) => dist(x.bot, creeperAt).toFixed(1), door: (x) => (x.open ? 'OPEN' : 'closed'), action: (x) => x.action,
            });
            const result = logLines.filter((l) => l.startsWith('Mode night_shelter finished executing')).join('\n');
            note(`2: the result of the night reflex: ${JSON.stringify(result.slice(-300))}`);
            check(night.ok, '2: at night the night reflex ran and ended, without any message');
            check(!rows2.some((x) => x.open === true), '2: the bot did not open the door with the creeper 10 blocks from it');
            check(/I have no shelter\. I dug in at \(-?\d+, -?\d+, -?\d+\) and closed the hole\./.test(result), '2: the bot dug in (emergency shelter)', JSON.stringify(result.slice(-200)));
            check(dist(end, creeperAt) >= 24, '2: it dug in at least 24 blocks from the creeper', `${dist(end, creeperAt).toFixed(1)} blocks`);
            const roof = { x: Math.floor(end.x), y: g, z: Math.floor(end.z) };
            check(end.y < g && (await command(`execute if block ${roof.x} ${roof.y} ${roof.z} minecraft:air`)).some((l) => /Test failed/.test(l)),
                '2: the bot is below the ground and the hole above it is closed (server)', `bot ${fmt(end)}`);

            const cmp = await compareSnapshot(snap, agent.bot);
            check(cmp.same, 'every block of the house is still there', describeDifferences(cmp.differences));
            const health = await entityNumber(NAME, 'Health');
            check(health > 0, 'the bot lives', `health ${health}`);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[type=minecraft:creeper,x=${r.ox - 150},y=-64,z=${r.oz - 150},dx=300,dy=200,dz=300]`, 'difficulty peaceful', 'time set 6000']).catch(() => {});
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
