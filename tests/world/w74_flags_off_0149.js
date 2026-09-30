// W74 flags off (v0.1.4.9 spec section 0.6, section 2, 11 TW 3): with every new setting of v0.1.4.9 at its default
// (FLAGS_0149_OFF) the behaviour is that of v0.1.4.8, except the corrections of defects and the decision of the
// owner that ore_sense_range 0 (the default) changes !collectBlocks for ore also with every switch off (HANDOFF
// part C). The switches of v0.1.4.6 to v0.1.4.8 are on as the owner plays, the modes of the owner on.
// Not a defect of the play test: it guards the promise of the switches (a new behaviour must not come on by itself).
//   A  routes_pack off: after a walk through the door into the house there is no trail.json and no routes.json in
//      the folder of the world; the packs get no routes (ctx.routes null); whereAmI has no mine.
//   B  the six commands of v0.1.4.9 are not in the conversing prompt of the model, and each typed by the player does
//      not exist ("Command '!x' does not exist.", as W29 accepts it).
//   C  !mineOre("iron", 8) with no mine the bot dug asks as in v0.1.4.8 (W54): "I know no mine for iron. I can dig a
//      new one at (x, y, z), N blocks from your house. Tell me to do it, or show me your mine."; no mine is saved.
//   D  ore_sense_range 0 (the decision of the owner): in the tunnel, with one iron ore in the wall and one 5 blocks
//      inside the rock, !collectBlocks("iron_ore", 2) takes the one in the wall, says the text of C1, and digs
//      nothing towards the other.
//   E  skills_over_code off: the model answers "dig a tunnel to the east" with !newAction("dig a tunnel to the
//      east"): the code model is asked (the code runs as in v0.1.4.8).
// F4 of T2 (the first run, 2026-09-30; corrected in the fix round): part D fails as W70 does: "I am underground. I start a new mine only from
// the surface." (the check of M5 in actions.js does not see the ore at the feet in the wall; see W70).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_ON, FLAGS_0149_OFF, COMMANDS_0149, withModes,
    resetBot, fmt, env, orderChannel, commands, placeBot, giveItems, waitFor, waitIdle, walkTyped, readWorldFile, worldDirOf, sleep, entityPos,
} from './helpers.js';
import { codeReply } from '../e2e/helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, stableInventory, itemsText, inBox } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_off9';
const PLAYER = 'w_player';
const ASK = /I know no mine for iron\. I can dig a new one at \((-?\d+), (-?\d+), (-?\d+)\), (\d+) blocks from your house\. Tell me to do it, or show me your mine\./;
const C1 = 'I see no iron_ore. I know that there is some within 16 blocks, but it is inside the rock. Tell me to mine iron and I get it from a mine.';

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const cell = b.tunnel.cells[6];
        const exposed = { x: cell.x + 1, y: cell.y, z: cell.z };
        const hidden = { x: cell.x + 5, y: cell.y, z: cell.z };

        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_ON, ...FLAGS_0149_OFF, mining_max_minutes: 12 }));
            agent = s.agent;
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await commands(['gamerule doDaylightCycle false', 'time set 6000']);
            const start = { x: b.house.door.x, y: g + 1, z: b.house.door.z - 12 };
            await placeBot(agent, start, 180);
            orders = await orderChannel(s, { name: PLAYER, at: { x: start.x + 10, y: g + 1, z: start.z - 6 } });

            // ---------------------------------------------------------- A: no trail
            const walk = await walkTyped(orders, agent, b.house.home);
            check(walk.arrived && inBox(walk.pos, b.house.interior), 'A: precondition: the bot walked through the door into the house', fmt(walk.pos));
            await sleep(6000);
            const trail = readWorldFile(agent, 'trail.json');
            const routes = readWorldFile(agent, 'routes.json');
            note(`A: the folder of the world ${worldDirOf(agent)}; trail.json: ${trail.error ?? 'exists'}; routes.json: ${routes.error ?? 'exists'}`);
            check(Boolean(worldDirOf(agent)) && trail.error === 'missing' && routes.error === 'missing', 'A: routes_pack off: no trail.json and no routes.json in the folder of the world', `${trail.error}, ${routes.error}`);
            check(agent.homeContext().routes === null, 'A: the packs get no routes (ctx.routes is null)', String(agent.homeContext().routes));
            const where = agent.whereAmI();
            check(where?.mine === null, 'A: whereAmI has no mine (mine: null)', JSON.stringify(where));

            // ---------------------------------------------------------- B: the six commands
            const six = [...COMMANDS_0149.routes_pack, ...COMMANDS_0149.mine_routes];
            s.route(/w_player: hello there/, 'Hello!');
            const tB = Date.now();
            orders.say('hello there');
            const asked = await waitFor(() => s.chat.requests.find((q) => q.turns.some((x) => String(x.content).includes('hello there'))), { ms: 30000 });
            const prompt = asked.ok ? String(asked.value.prompt) : '';
            const shown = six.filter((c) => prompt.includes(c + ':') || prompt.includes(c + ' '));
            check(prompt.includes('*COMMAND DOCS') && shown.length === 0, 'B: none of the six commands of v0.1.4.9 is in the conversing prompt of the model', JSON.stringify(shown));
            await waitIdle(agent, 15000);
            await sleep(Math.max(0, 2000 - (Date.now() - tB)));
            const refused = [];
            for (const c of six) {
                const text = c === '!collectPassedOre' ? '!collectPassedOre("coal", 1)' : ['!rememberRoute', '!forgetRoute', '!rememberMine'].includes(c) ? `${c}("x")` : c;
                const reply = await orders.order(text, 20000);
                if (/is not a command|does not exist/i.test(reply)) refused.push(c);
                else note(`B: ${text} answered ${JSON.stringify(reply.slice(0, 200))}`);
                await sleep(1500);
            }
            check(refused.length === six.length, 'B: each of the six commands typed by the player does not exist (not a command)', JSON.stringify(six.filter((c) => !refused.includes(c))));

            // ---------------------------------------------------------- C: !mineOre asks
            await placeBot(agent, { x: b.house.door.x, y: g + 1, z: b.house.door.z - 6 }, 180);
            const ask = await orders.order('!mineOre("iron", 8)', 120000);
            note(`C: !mineOre("iron", 8) answered ${JSON.stringify(ask)}`);
            check(ASK.test(ask), 'C: !mineOre asks as in v0.1.4.8: "I know no mine for iron. I can dig a new one at (x, y, z), N blocks from your house. Tell me to do it, or show me your mine."', JSON.stringify(ask));
            check((agent.packContext().mines?.list() ?? []).length === 0, 'C: no mine is saved');

            // ---------------------------------------------------------- D: ore_sense_range 0, !collectBlocks
            await commands([`setblock ${exposed.x} ${exposed.y} ${exposed.z} minecraft:iron_ore`, `setblock ${hidden.x} ${hidden.y} ${hidden.z} minecraft:iron_ore`]);
            await placeBot(agent, cell, -90);
            await giveItems(NAME, [['stone_pickaxe', 1]], agent.bot);
            const collect = await orders.order('!collectBlocks("iron_ore", 2)', 180000);
            note(`D: !collectBlocks("iron_ore", 2) answered ${JSON.stringify(collect)}; the bot is at ${fmt(await entityPos(NAME))}`);
            const got = await blockNames([exposed, hidden, ...[2, 3, 4].map((k) => ({ x: cell.x + k, y: cell.y, z: cell.z }))], ['iron_ore', 'stone']);
            const inv = await stableInventory(NAME);
            note(`D: the ore in the wall ${got[0]}, in the rock ${got[1]}, between ${JSON.stringify(got.slice(2))}; the bot carries ${itemsText(inv.items)}`);
            check(collect.includes(C1), 'D: ore_sense_range 0 (the default): the answer has the text of C1', JSON.stringify(collect));
            check(got[0] === null && got[1] === 'iron_ore' && got.slice(2).every((x) => x === 'stone'), 'D: the ore in the wall is taken, the ore inside the rock and the stone before it stay', JSON.stringify(got));

            // ---------------------------------------------------------- E: !newAction runs
            const codeBefore = s.code.requests.length;
            s.code.replies.push(codeReply("log(bot, 'I only looked around.');"));
            const tE = Date.now();
            s.route(/w_player: dig a tunnel to the east/, '!newAction("dig a tunnel to the east")');
            orders.say('dig a tunnel to the east');
            const ran = await waitFor(() => s.code.requests.length > codeBefore, { ms: 60000, every: 250 });
            await waitIdle(agent, 60000);
            await sleep(1500);
            const lines = s.added.filter((a) => a.t >= tE && a.name === 'system').map((a) => a.content.slice(0, 200));
            note(`E: the code model got ${s.code.requests.length - codeBefore} request(s); the system lines: ${JSON.stringify(lines)}`);
            check(ran.ok, 'E: skills_over_code off: the !newAction of the model runs, the code model is asked');
            check(!lines.some((l) => l.includes('I do not write code for digging')), 'E: no refusal of I8');
            check(s.killed === null, 'the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
