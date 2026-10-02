// W09 creeper (spec section 8 "Creeper", H6, G4 creeper_safety): home_pack and protected_areas on,
// creeper_fighting off, world_memory on, difficulty normal, the bot in survival. The modes of the
// profile are those of the owner's base profile "assistant" (self_preservation, unstuck, self_defense,
// item_collecting, torch_placing, elbow_room, idle_staring on; cowardice, hunting off), so the test
// also sees whether self_defense leaves the creeper to creeper_safety (G4).
// The bot saves the house, stands at its door (outside), and a creeper is summoned 10 blocks from the
// house (9 from the bot). No model reply is needed: the fake model answers every request with ''.
// Proves: the bot leads the creeper away; at the end the creeper is at least 16 blocks from the house
// or gone; every block of the house is still there; the bot lives; the bot never opened the door
// while the creeper was within 16 blocks of it. The distance of the creeper over time is printed.
// Depends on the behaviour of a monster: the runner runs it up to 3 times, 2 passing runs pass.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, MODES_OFF, placeBot, resetBot,
    command_, waitFor, entityPos, fmt, startTrace, printTrace, sleep, command, commands, env,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, isOpen, inBox, hdist, distToBox,
    snapshotBox, compareSnapshot, describeDifferences, dropSnapshot, entityNumber,
} from './world.js';

const NAME = 'w_creeper';
const TAG = 'mcw_creeper';
const ASSISTANT_MODES = { ...MODES_OFF, self_preservation: true, unstuck: true, self_defense: true, item_collecting: true,
    torch_placing: true, elbow_room: true, idle_staring: true };

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
            check(agent.bot.modes.exists('creeper_safety') && agent.bot.modes.isOn('creeper_safety'), 'home_pack on: the mode creeper_safety exists and is on');
            await placeBot(agent, h.inside, 0);
            const saved = await command_(agent, '!rememberArea("home", "building")', 30000);
            // v0.1.4.11 (P1): the answer names the kind, the border, the size and the contents
            check(/I saved "home": an? \w+, \w+, \d+ x \d+( with a roof)?, [^.]*\b1 door\b/.test(saved), 'precondition: !rememberArea saved the house as "home" with its door (the answer of P1)', JSON.stringify(saved.slice(0, 200)));
            snap = await snapshotBox(h.box);

            let deaths = 0;
            agent.bot.on('death', () => { deaths++; });
            let explosions = 0;
            agent.bot._client.on('explosion', () => { explosions++; });

            const atDoor = { x: h.door.x, y: g + 1, z: h.door.z - 1 };
            await placeBot(agent, atDoor, 180);
            await commands(['difficulty normal', `gamemode survival ${NAME}`]);
            const spawnAt = { x: h.door.x, y: g + 1, z: h.box.min.z - 10 };
            const out = await command(`summon minecraft:creeper ${spawnAt.x + 0.5} ${spawnAt.y} ${spawnAt.z + 0.5} {PersistenceRequired:1b,Tags:["${TAG}"]}`);
            check(out.some((l) => /Summoned new Creeper/.test(l)), `a creeper is summoned 10 blocks north of the house (run ${env.run})`, out.join(' | '));
            const tSummon = Date.now();
            const requestsBefore = s.chat.requests.length;
            const doorCenter = { x: h.door.x + 0.5, y: h.door.y, z: h.door.z + 0.5 };

            const trace = startTrace(async () => {
                const [c, b] = [await entityPos(selector), await entityPos(NAME)];
                const seen = Object.values(agent.bot.entities).find((e) => e.name === 'creeper');
                return {
                    creeper: c, bot: b, open: await isOpen(h.door), health: await entityNumber(NAME, 'Health'),
                    fuse: seen ? seen.metadata?.[16] : undefined, action: agent.actions.currentActionLabel || '-',
                };
            }, 250);
            // the end: the creeper is gone or 16 blocks from the house, and the reflex has finished
            const ended = await waitFor(() => {
                const rows = trace.rows;
                if (rows.length < 8 || deaths > 0) return deaths > 0;
                const last = rows[rows.length - 1];
                const far = !last.creeper || distToBox(last.creeper, h.box) >= 16;
                const reflexDone = !String(last.action).startsWith('mode:creeper_safety');
                const ranReflex = rows.some((x) => String(x.action).startsWith('mode:creeper_safety'));
                return far && reflexDone && (ranReflex || !last.creeper) && Date.now() - tSummon > 5000;
            }, { ms: 110000, every: 500 });
            await sleep(1500);
            const rows = await trace.stop();
            printTrace(`creeper run ${env.run}`, rows, {
                creeper: (x) => fmt(x.creeper), toHouse: (x) => (x.creeper ? distToBox(x.creeper, h.box).toFixed(1) : 'gone'),
                toDoor: (x) => (x.creeper ? hdist(x.creeper, doorCenter).toFixed(1) : '-'), toBot: (x) => (x.creeper ? hdist(x.creeper, x.bot).toFixed(1) : '-'),
                bot: (x) => fmt(x.bot), fuse: (x) => String(x.fuse), health: (x) => x.health, door: (x) => (x.open ? 'OPEN' : 'closed'), action: (x) => x.action,
            });
            const last = rows[rows.length - 1] || {};
            note(`ended ${ended.ok ? 'after ' + (ended.ms / 1000).toFixed(1) + ' s' : 'by the time limit of 110 s'}; deaths ${deaths}, explosions ${explosions}`);

            check(rows.some((x) => String(x.action).startsWith('mode:creeper_safety')), 'the creeper_safety reflex ran (without any command of the model)');
            const maxToHouse = Math.max(...rows.filter((x) => x.creeper).map((x) => distToBox(x.creeper, h.box)));
            check(!last.creeper || distToBox(last.creeper, h.box) >= 16, 'at the end the creeper is at least 16 blocks from the house or gone',
                last.creeper ? `${distToBox(last.creeper, h.box).toFixed(1)} blocks (the farthest it was: ${maxToHouse.toFixed(1)})` : 'gone');
            check(explosions === 0, 'the bot led the creeper away: it did not explode (no explosion packet reached the bot)', `explosions ${explosions}`);
            const cmp = await compareSnapshot(snap, agent.bot);
            check(cmp.same, 'every block of the house is still there', describeDifferences(cmp.differences));
            const health = await entityNumber(NAME, 'Health');
            check(deaths === 0 && health > 0, 'the bot lives', `deaths ${deaths}, health ${health}`);
            const bad = rows.filter((x) => x.open === true && x.creeper && hdist(x.creeper, doorCenter) <= 16);
            check(bad.length === 0, 'the bot did not open the door while the creeper was within 16 blocks of it',
                bad.slice(0, 3).map((x) => `t=${x.t.toFixed(1)}s creeper ${hdist(x.creeper, doorCenter).toFixed(1)} from the door`).join('; '));

            const after = s.sent.filter((x) => x.t >= tSummon);
            note(`the fake model got ${s.chat.requests.length - requestsBefore} request(s) after the creeper was summoned: ${JSON.stringify(after.map((x) => x.reply))}`);
            check(after.every((x) => x.reply.trim() === ''), 'no reply of the model contained a command (the reflex acted alone)');
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands([`kill @e[type=minecraft:creeper,x=${r.ox - 150},y=-64,z=${r.oz - 150},dx=300,dy=200,dz=300]`, 'difficulty peaceful']).catch(() => {});
            await stopRealAgent(agent);
            if (snap) await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
