// W02 flags off: every setting of this release off (cost_meter, protected_areas, player_rules,
// home_pack, creeper_fighting false, max_command_result_chars 0), world_memory on as the owner has it.
// Proves (spec section 8, "Flags off"): none of the new commands reaches the model, no new mode
// exists, the bot digs in the house as before, no file of this release is written except usage.json.
// It also documents the problems of today that the release fixes when its flags are on:
//   - the bot walks through a door into the house and leaves the door open;
//   - !collectBlocks("oak_log", 4) next to a house with oak log corner posts takes logs of the house.
import fs from 'node:fs';
import path from 'node:path';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, NEW_COMMANDS, NEW_MODES,
    placeBot, resetBot, command_, waitFor, entityPos, fmt, listFiles, connectPlayer, quitPlayer, sleep, startTrace, printTrace,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, treePlan, buildTree, isOpen, inBox,
    snapshotBox, compareSnapshot, describeDifferences, dropSnapshot, blockIs,
} from './world.js';

const NAME = 'w_off';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(40);
        const g = r.g;
        await prepareRegion(r);
        const h = housePlan(r.ox, r.oz, g);
        const tree = treePlan(h.box.max.x + 4, h.box.min.z + 3, g, 5);
        await buildHouse(h);
        await buildTree(tree);
        const snap = await snapshotBox(h.box);

        let agent = null, player = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            player = await connectPlayer(PLAYER);
            await placeBot(agent, h.outsideDoor, 180);
            await command_(agent, `!stop`, 5000); // nothing runs; keeps the chat quiet

            // ---------------------------------------------------------- what the model sees
            s.chat.replies.push('Hello!');
            player.chat('hello there');
            const asked = await waitFor(() => s.chat.requests.length >= 1, { ms: 15000 });
            const prompt = asked.ok ? s.chat.requests[0].prompt : '';
            check(asked.ok && prompt.includes('*COMMAND DOCS'), 'the model got a conversing prompt with the command docs');
            const shown = Object.values(NEW_COMMANDS).flat().filter((c) => prompt.includes(c + ':') || prompt.includes(c + '('));
            check(asked.ok && shown.length === 0, 'flags off: none of the new commands of parts A, R and H is in the prompt of the model', JSON.stringify(shown));
            note(`!cost in the prompt: ${prompt.includes('!cost')} (spec G1: "!cost" answers "The cost meter is off." while the meter is off)`);
            for (const c of Object.values(NEW_COMMANDS).flat()) {
                const reply = await command_(agent, c === '!rememberArea' ? `${c}("home", "building")` : c, 10000);
                if (!/is not a command|does not exist/i.test(reply)) {
                    check(false, `flags off: ${c} is not a command`, JSON.stringify(reply.slice(0, 160)));
                }
            }
            check(true, 'flags off: every new command of parts A, R and H is refused as "not a command" (a failing one is listed above)');

            // ---------------------------------------------------------- modes
            const modes = NEW_MODES.filter((m) => agent.bot.modes.exists(m));
            check(modes.length === 0, 'flags off: no new mode exists (creeper_safety, night_shelter, door_closing)', JSON.stringify(modes));
            const modeDocs = await command_(agent, '!modes', 10000);
            check(!NEW_MODES.some((m) => modeDocs.includes(m)), 'flags off: !modes lists none of the new modes');

            // ---------------------------------------------------------- the door stays open (old behaviour)
            check(await isOpen(h.door) === false, 'before: the door of the house is closed (server)');
            const trace = startTrace(async () => ({ pos: await entityPos(NAME), open: await isOpen(h.door) }), 400);
            const walkIn = await command_(agent, `!goToCoordinates(${h.inside.x + 0.5}, ${h.inside.y}, ${h.inside.z + 0.5}, 1)`, 60000);
            const inside = await entityPos(NAME);
            await sleep(3000);
            const rows = await trace.stop();
            printTrace('walk into the house (flags off)', rows, { pos: (x) => fmt(x.pos), door: (x) => (x.open ? 'open' : 'closed') });
            note(`walk in: ${JSON.stringify(walkIn.slice(0, 200))}`);
            check(inBox(inside, h.interior), 'flags off: the bot walked into the house through the door', fmt(inside));
            check(rows.some((x) => x.open === true), 'flags off: the path finder opened the door on the way in');
            const openAfter = await isOpen(h.door);
            check(openAfter === true, 'flags off (old behaviour): 3 s after the bot arrived inside, the door is still open', `door open: ${openAfter}`);

            // ---------------------------------------------------------- logs from the house (old behaviour)
            await placeBot(agent, { x: h.box.min.x - 2, y: g + 1, z: h.box.min.z + 3 }, 90);
            const collect = await command_(agent, '!collectBlocks("oak_log", 4)', 90000);
            note(`collect: ${JSON.stringify(collect.slice(0, 300))}`);
            const cmp = await compareSnapshot(snap, agent.bot);
            const houseLogsGone = [];
            for (const p of h.logs) if (!(await blockIs(p, 'oak_log'))) houseLogsGone.push(p);
            const treeLogsLeft = [];
            for (const p of tree.logs) if (await blockIs(p, 'oak_log')) treeLogsLeft.push(p);
            note(`house: ${describeDifferences(cmp.differences)}`);
            note(`house logs gone: ${houseLogsGone.length} of ${h.logs.length}, tree logs left: ${treeLogsLeft.length} of ${tree.logs.length}`);
            check(houseLogsGone.length > 0 && !cmp.same, 'flags off (old behaviour): !collectBlocks("oak_log", 4) took logs of the house');

            // ---------------------------------------------------------- files
            const files = listFiles(path.join('bots', NAME));
            note(`files of the bot: ${JSON.stringify(files)}`);
            const released = files.filter((f) => /(^|\/)(areas|rules)\.json$/.test(f));
            check(released.length === 0, 'flags off: no areas.json and no rules.json is written', JSON.stringify(released));
            if (files.some((f) => /(^|\/)usage\.json$/.test(f))) note('usage.json was written although cost_meter is off (the spec allows usage.json here)');
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await quitPlayer(player);
            await stopRealAgent(agent);
            await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
        void fs;
    },
});
exitSoon();
