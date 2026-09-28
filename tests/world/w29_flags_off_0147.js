// W29 flags off, v0.1.4.7 (spec section 8 "Flags off", section 1, G "Switch rule"): the four switches
// storage_pack, farming_pack, wood_pack and mining_pack off; the parts of v0.1.4.6 on as the owner
// runs them (protected_areas, player_rules, home_pack, world_memory). Proves:
//   - none of the 14 commands of v0.1.4.7 is in the conversing prompt of the model, and each is
//     refused as "not a command";
//   - no object of the new parts is created (agent.work_packs), no chests.json and no mines.json;
//   - !collectBlocks works as in v0.1.4.6: next to a natural oak tree of 5 logs,
//     !collectBlocks("oak_log", 4) answers with the old text, not the text of chopTrees, and collects
//     4 logs (whether it leaves the top log varies); !collectBlocks("iron_ore", 1) with no ore near answers the old text
//     at once and does not go mining.
import path from 'node:path';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, WORK_COMMANDS, placeBot, resetBot,
    command_, waitFor, listFiles, connectPlayer, quitPlayer, entityPos, fmt,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, treePlan, buildTree, blockNames, stableInventory, itemsText } from './world.js';

const NAME = 'w_off7';
const PLAYER = 'w_player';

await scenarioMain({
    async main() {
        const r = region(32);
        const g = r.g;
        await prepareRegion(r, 24);
        const tree = treePlan(r.ox + 5, r.oz, g, 5);
        await buildTree(tree, { natural: true });

        let agent = null, player = null;
        try {
            const settings = { ...NEW_FLAGS_OFF, protected_areas: true, player_rules: true, home_pack: true, world_memory: true };
            const s = await startAgent(NAME, settings);
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, -90);
            const all = Object.values(WORK_COMMANDS).flat();

            // ---------------------------------------------------------- what the model sees
            player = await connectPlayer(PLAYER);
            s.route(/w_player: hello there/, 'Hello!');
            player.chat('hello there');
            const asked = await waitFor(() => s.chat.requests.find((q) => q.turns.some((t) => String(t.content).includes('hello there'))), { ms: 20000 });
            const prompt = asked.ok ? asked.value.prompt : '';
            check(prompt.includes('*COMMAND DOCS'), 'the model got a conversing prompt with the command docs');
            const shown = all.filter((c) => prompt.includes(c));
            check(asked.ok && shown.length === 0, 'four switches off: none of the 14 commands of v0.1.4.7 is in the prompt of the model', JSON.stringify(shown));
            const refused = [];
            for (const c of all) {
                const reply = await command_(agent, c === '!fetchItem' ? '!fetchItem("bread", 1)' : c === '!mineOre' ? '!mineOre("iron", 1)' : c === '!getTool' ? '!getTool("pickaxe")' : c === '!craftSupplies' ? '!craftSupplies("torch")' : c, 10000);
                if (/is not a command|does not exist/i.test(reply)) refused.push(c);
                else note(`${c} answered ${JSON.stringify(reply.slice(0, 160))}`);
            }
            check(refused.length === all.length, 'four switches off: each of the 14 new commands is refused as "not a command"', JSON.stringify(all.filter((c) => !refused.includes(c))));
            check(!agent.work_packs, 'four switches off: no object of the new parts is created (agent.work_packs is not set)', String(agent.work_packs && Object.keys(agent.work_packs)));

            // ---------------------------------------------------------- !collectBlocks as in v0.1.4.6
            const collect = await command_(agent, '!collectBlocks("oak_log", 4)', 120000);
            note(`!collectBlocks("oak_log", 4) answered ${JSON.stringify(collect.slice(0, 400))}`);
            const trunk = await blockNames(tree.logs, ['oak_log']);
            const inv = await stableInventory(NAME);
            note(`logs of the trunk left: ${trunk.filter(Boolean).length} of 5 (heights ${JSON.stringify(tree.logs.filter((p, i) => trunk[i]).map((p) => p.y - g))}); the bot carries ${itemsText(inv.items)}`);
            check(/Collected \d+ oak_log\./.test(collect) && !/I cut \d/.test(collect), 'the old !collectBlocks ran: its text "Collected <n> oak_log.", not the text of chopTrees', JSON.stringify(collect.slice(-200)));
            check((inv.items.oak_log || 0) >= 4, 'the old !collectBlocks collected 4 oak_log', `oak_log ${inv.items.oak_log || 0}`);
            // Not a check (integration round): the old command leaves the top log or takes it, by chance.
            // Seen on the test server with the same code of v0.1.4.6: 1 log left, and 0 left with 5 logs in
            // the inventory after "Collected 4 oak_log.". The text above tells the old command from chopTrees.
            note(`the old !collectBlocks ${trunk.some(Boolean) ? 'left a log of the trunk' : 'took the whole trunk'} (not checked, it varies)`);

            const before = await entityPos(NAME);
            const ore = await command_(agent, '!collectBlocks("iron_ore", 1)', 60000);
            const after = await entityPos(NAME);
            note(`!collectBlocks("iron_ore", 1) answered ${JSON.stringify(ore.slice(0, 300))}; the bot ${fmt(before)} -> ${fmt(after)}`);
            check(/No iron_ore nearby to collect\./.test(ore), 'the old !collectBlocks for an ore that is not near answers "No iron_ore nearby to collect." (no mining trip)', JSON.stringify(ore.slice(0, 200)));
            check(after && before && Math.abs(after.y - before.y) < 0.6, 'the bot did not dig down', `${fmt(before)} -> ${fmt(after)}`);

            // ---------------------------------------------------------- files
            const files = listFiles(path.join('bots', NAME));
            const made = files.filter((f) => /(^|\/)(chests|mines)\.json$/.test(f));
            note(`files of the bot: ${JSON.stringify(files)}`);
            check(made.length === 0, 'four switches off: no chests.json and no mines.json is written', JSON.stringify(made));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await quitPlayer(player);
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
