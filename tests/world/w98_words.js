// W98 the words (journey of v0.1.4.11 "Navigation and words", tester T3; PLAN.md 1.1, 1.3 and 1.5, SPEC section 7, W1,
// W5 and W7): every failure text names the cause and the next step. Today (v0.1.4.10) a route failure ends with "Show
// me the way again.", the refusal of dig code names every digging command wherever the bot stands, a command with the
// wrong number of arguments answers with its counts, and !givePlayer says "w_player received wheat." (PLAN.md section 1).
//
// The owner variant of the base (the dump of the owner's region when tests/world/owner_region.json exists), the owner's
// switches with the three of v0.1.4.11 on (mine_from_inside among them) and allow_insecure_coding, the modes of his
// profile, an empty memory, the kit of the owner's chest (8 ladders, 16 torches, a stone pickaxe) and 4 wheat. The bot
// is never moved by the control.
//   1. Outside in front of the house, no mine known: "go to the mine" !goToMine: the answer holds no `Show me the way
//      again`.
//   2. On the surface the owner says "dig a tunnel"; the fake model answers !newAction("dig a tunnel"): the result is
//      `I do not write code for digging. From here: !mineOre("iron", 8, true).` (W7); the code model gets no request.
//   3. !rememberRoute("a", "b"): `!rememberRoute takes 1 argument (name): !rememberRoute("name").` (W5).
//   4. The player (his wheat cleared) stands still on open ground 6 blocks from the bot, as in W44. "give me 4 wheat"
//      !givePlayer("w_player", "wheat", 4): `Gave 4 wheat to w_player.`; within 8 s the player has 4 wheat more (server)
//      and the bot 4 less.
//   5. The player teaches the mine (journey.js partTeachMine); at the end of the tunnel "dig a tunnel", the model's
//      !newAction("dig a tunnel"): `I do not write code for digging. From here: !mineOre("iron", 8).`
//   6. The player walks back into the room, "come here" !goToPlayer("w_player", 2); "dig a tunnel", the model's
//      !newAction: `I do not write code for digging. From here: !mineOre("iron", 8, true).` (in a known mine with
//      mine_from_inside).
//   7. "get out" !leaveMine; the owner locks the way in (decision F10): the trapdoor of the house over ladder 1 becomes
//      a closed iron trapdoor; "go to the mine" !goToMine: `I find no way from (x, y, z) to the trapdoor at <the
//      trapdoor>: it is closed and I cannot open it.` (N1), the bot did not move (within 1 block), and the answer holds
//      no `Show me the way again`. The oak trapdoor is put back at the end.
// Throughout: no answer and no line of the bot holds `Show me the way again`; the process lives, no request reached a
// real model.
import { scenarioMain, check, note, exitSoon, stopRealAgent, env, entityPos, fmt, sleep, tp, commands, waitFor, waitIdle } from './helpers.js';
import { region, prepareRegion, releaseRegion, inBox, dist, inventoryOf, itemsOnGround } from './world.js';
import { basePlan, buildBase, BASE_RADIUS } from './base_world.js';
import { loadDump } from './owner_region.js';
import { startJourney, JOURNEY_SETTINGS, spots, PLAYER, partTeachMine, wayOutOfMine, walkPlayer, line, onSurface, saidLines } from './journey.js';

const NAME = 'w_words';
const KIT = [['ladder', 8], ['torch', 16], ['stone_pickaxe', 1], ['wheat', 4]];
const SETTINGS = () => ({ ...JOURNEY_SETTINGS(), job_memory: true, area_floors: true, allow_insecure_coding: true });
const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const AGAIN = /Show me the way again/;
const REFUSAL = (call) => `I do not write code for digging. From here: ${call}.`;

// The model's !newAction("dig a tunnel") after the owner says "dig a tunnel": resolves with the result the agent put
// into the history ('' when none came within 60 s) and the number of requests of the code model meanwhile.
async function modelDigs(s, orders, agent) {
    const t = Date.now();
    const code0 = s.code.requests.length;
    s.route(/w_player: dig a tunnel/, '!newAction("dig a tunnel")');
    orders.say('dig a tunnel');
    const back = await waitFor(() => s.added.find((a) => a.t >= t && a.name === 'system' && a.content.includes('I do not write code')), { ms: 60000, every: 250 });
    await waitIdle(agent, 30000);
    await sleep(1500);
    return { result: back.value?.content ?? '', code: s.code.requests.length - code0 };
}

// The trapdoor of the house over ladder 1 (b.trapdoor) as the oak one of base_world.js or an iron one (the owner locked
// it), closed, in the same state. The cell is set to air first.
function setTrapdoorKind(b, kind) {
    const t = b.trapdoor;
    return commands([`setblock ${t.x} ${t.y} ${t.z} minecraft:air`, `setblock ${t.x} ${t.y} ${t.z} minecraft:${kind}[facing=south,half=top,open=false]`]);
}

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const dump = loadDump();
        note(`the base: ${dump ? 'from the dump of the owner\'s region' : 'the hand-built owner variant (no owner_region.json)'}`);
        const b = basePlan(r, { owner: true, dump });
        await buildBase(b);
        const sp = spots(b);
        let agent = null, orders = null;
        try {
            const j = await startJourney(NAME, b, {
                botAt: { ...sp.outside, z: sp.outside.z - 2 }, playerAt: sp.outside, kit: KIT, settings: SETTINGS(),
            });
            agent = j.agent;
            orders = j.orders;
            const s = j.s;
            const replies = [];

            // ---------------------------------------------------------- 1. no mine
            const one = await orders.order('!goToMine', 60000);
            replies.push(one);
            note(`1: !goToMine with no mine answered ${JSON.stringify(one.slice(0, 300))}`);
            check(!AGAIN.test(one), '1: "go to the mine" with no mine: the answer holds no `Show me the way again`', JSON.stringify(one.slice(0, 200)));

            // ---------------------------------------------------------- 2. the refusal on the surface
            const d2 = await modelDigs(s, orders, agent);
            note(`2: on the surface at ${fmt(await entityPos(NAME))} the model's !newAction("dig a tunnel") gave ${JSON.stringify(d2.result.slice(0, 300))}; the code model got ${d2.code} requests`);
            check(d2.result.includes(REFUSAL('!mineOre("iron", 8, true)')), `2: on the surface the refusal names the call: \`${REFUSAL('!mineOre("iron", 8, true)')}\` (W7)`, JSON.stringify(d2.result.slice(0, 300)));
            check(d2.code === 0, '2: the code model got no request', `${d2.code}`);

            // ---------------------------------------------------------- 3. the arguments
            const three = await orders.order('!rememberRoute("a", "b")', 30000);
            replies.push(three);
            note(`3: !rememberRoute("a", "b") answered ${JSON.stringify(three.slice(0, 300))}`);
            check(three.includes('!rememberRoute takes 1 argument (name): !rememberRoute("name").'), '3: the wrong number of arguments: `!rememberRoute takes 1 argument (name): !rememberRoute("name").` (W5)', JSON.stringify(three.slice(0, 200)));

            // ---------------------------------------------------------- 4. give
            // as W44 proves a give to the control player: the player's wheat cleared, the player 6 blocks from the bot on
            // open ground, standing still; the bot walks to him and tosses
            await commands([`clear ${PLAYER} minecraft:wheat`]);
            const botAt4 = await entityPos(NAME);
            const giveAt = { x: Math.floor(botAt4.x) - 6, y: b.g + 1, z: Math.floor(botAt4.z) + 2 };
            await tp(PLAYER, giveAt);
            await sleep(1000);
            const pw0 = (await inventoryOf(PLAYER)).wheat || 0;
            const bw0 = (await inventoryOf(NAME)).wheat || 0;
            note(`4: the bot at ${fmt(botAt4)} with ${bw0} wheat, the player at ${fmt(await entityPos(PLAYER))} with ${pw0} wheat`);
            const four = await orders.order(`!givePlayer("${PLAYER}", "wheat", 4)`, 60000);
            replies.push(four);
            const got = await waitFor(async () => ((await inventoryOf(PLAYER)).wheat || 0) - pw0 >= 4, { ms: 8000, every: 250 });
            note(`4: the player's wheat rose by 4 ${got.ok ? `within ${(got.ms / 1000).toFixed(1)} s after the answer` : 'NOT within 8 s after the answer'}; wheat on the ground near him: ${JSON.stringify(await itemsOnGround({ min: { x: giveAt.x - 4, y: giveAt.y - 1, z: giveAt.z - 4 }, max: { x: giveAt.x + 4, y: giveAt.y + 2, z: giveAt.z + 4 } }))}`);
            const pw = ((await inventoryOf(PLAYER)).wheat || 0) - pw0;
            const bw = bw0 - ((await inventoryOf(NAME)).wheat || 0);
            note(`4: !givePlayer answered ${JSON.stringify(four.slice(0, 300))}; the player has ${pw} wheat more, the bot ${bw} less`);
            check(four.includes(`Gave 4 wheat to ${PLAYER}.`), `4: "give me 4 wheat": \`Gave 4 wheat to ${PLAYER}.\` (W5)`, JSON.stringify(four.slice(0, 200)));
            check(pw === 4 && bw === 4, '4: the player has 4 wheat more and the bot 4 less (server)', `player +${pw}, bot -${bw}`);

            // ---------------------------------------------------------- 5. the refusal in the tunnel
            await tp(PLAYER, sp.outside);
            await sleep(1000);
            const taught = await partTeachMine({ ...j, b });
            if (!taught.ok) {
                check(false, 'the bot learned the mine (precondition of the refusals in the mine); the rest is not run');
                return;
            }
            note(`5: !stop answered ${JSON.stringify(await orders.order('!stop', 20000))}`);
            const a5 = await entityPos(NAME);
            check(inBox(a5, b.tunnel.box) || inBox(a5, { min: { ...b.tunnel.box.min, y: b.tunnel.box.min.y - 1 }, max: b.tunnel.box.max }), '5: precondition: the bot stands in the tunnel of the mine', fmt(a5));
            const d5 = await modelDigs(s, orders, agent);
            note(`5: in the tunnel at ${fmt(a5)} the model's !newAction("dig a tunnel") gave ${JSON.stringify(d5.result.slice(0, 300))}`);
            check(d5.result.includes(REFUSAL('!mineOre("iron", 8)')), `5: in the tunnel the refusal names the call: \`${REFUSAL('!mineOre("iron", 8)')}\` (W7)`, JSON.stringify(d5.result.slice(0, 300)));

            // ---------------------------------------------------------- 6. the refusal in the room
            const pAt = await entityPos(PLAYER);
            const way = wayOutOfMine(b, pAt);
            const door = b.owner.doors[1].lower;
            await walkPlayer(way.slice(1), 200);
            await walkPlayer([door, ...line(door, sp.roomWait)], 250);
            const come = await orders.orderInfo(`!goToPlayer("${PLAYER}", 2)`, 90000);
            await sleep(1500);
            const a6 = await entityPos(NAME);
            note(`6: "come here" answered ${JSON.stringify(come.reply.slice(0, 200))}; the bot at ${fmt(a6)}`);
            check(inBox(a6, b.room.box), '6: precondition: "come here" brings the bot into the room', fmt(a6));
            const d6 = await modelDigs(s, orders, agent);
            note(`6: in the room the model's !newAction("dig a tunnel") gave ${JSON.stringify(d6.result.slice(0, 300))}`);
            check(d6.result.includes(REFUSAL('!mineOre("iron", 8, true)')), `6: in the room of a known mine with mine_from_inside the refusal names the call: \`${REFUSAL('!mineOre("iron", 8, true)')}\` (W7)`, JSON.stringify(d6.result.slice(0, 300)));

            // ---------------------------------------------------------- 7. a blocked way
            const leave = await orders.orderInfo('!leaveMine', 300000);
            replies.push(leave.reply);
            await sleep(1000);
            const a7 = await entityPos(NAME);
            note(`7: !leaveMine answered ${JSON.stringify(leave.reply.slice(0, 300))}; the bot at ${fmt(a7)}`);
            check(onSurface(b, a7), '7: precondition: "get out" brings the bot to the surface', fmt(a7));
            await setTrapdoorKind(b, 'iron_trapdoor');
            await sleep(500);
            const before7 = await entityPos(NAME);
            const seven = await orders.order('!goToMine', 300000);
            replies.push(seven);
            await sleep(1000);
            const after7 = await entityPos(NAME);
            const trapText = `to the trapdoor at ${P(b.trapdoor)}: it is closed and I cannot open it.`;
            note(`7: with the iron trapdoor !goToMine answered ${JSON.stringify(seven.slice(0, 400))}; the bot stood at ${fmt(before7)}, is at ${fmt(after7)}`);
            check(/I find no way from \(-?\d+, -?\d+, -?\d+\) /.test(seven) && seven.includes(trapText), `7: the answer is the text of N1: \`I find no way from (x, y, z) ${trapText}\``, JSON.stringify(seven.slice(0, 300)));
            check(dist(after7, before7) <= 1, '7: the bot did not move: within 1 block of where it stood, after the answer', `${dist(after7, before7).toFixed(2)} blocks`);
            check(!AGAIN.test(seven), '7: the answer holds no `Show me the way again`', JSON.stringify(seven.slice(0, 300)));
            await setTrapdoorKind(b, 'oak_trapdoor');

            const said = saidLines(s);
            check(![...replies, ...said].some((l) => AGAIN.test(l)), 'no answer and no line of the bot holds `Show me the way again`', JSON.stringify([...replies, ...said].filter((l) => AGAIN.test(l)).slice(0, 3)));
            note(`the bot said ${JSON.stringify(said.slice(0, 40))}`);
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
