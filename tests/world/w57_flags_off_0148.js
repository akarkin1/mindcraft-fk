// W57 flags off (v0.1.4.8 spec section 0.7 and section 2): with every new setting of v0.1.4.8 at its default
// (FLAGS_0148_OFF) the behaviour is that of v0.1.4.7, except for the corrections of defects. The switches of
// v0.1.4.6 and v0.1.4.7 are on as the owner plays (OWNER_SWITCHES), the modes of the owner on.
// Not a defect of the play test: it guards the promise of the switches (a new behaviour must not come on by
// itself). Each part fails when the new behaviour runs although its switch is off.
//   A  stuck_restart_after 1: the bot in a closed room of obsidian, an action of the agent walks toward the player 10
//      blocks away again and again (v0.1.4.11: a follow that finds no way says so and ends, N2; see walkOut). As in
//      v0.1.4.7 (decision of the tech lead: "1 is exactly v0.1.4.7, only the time limit of 10 s ends the
//      process"): after "I'm stuck!" the escape returns at once and says "I'm free." although the bot is still
//      in the room; the reflex does not give up with "I am stuck at (x, y, z) and could not walk away.", and
//      nothing ends the process. (v0.1.4.7 ended the process only when the escape did not return in 10 s.)
//   B  protect_built_blocks off: 5 fence posts stand free on the grass, in no area. The model answers "get me
//      3 fences" with !collectBlocks("oak_fence", 3): 3 posts are gone (server), the bot carries 3 oak_fence,
//      the result is "Collected 3 oak_fence." (B1 counts what the inventory gained).
//   C  knowledge_in_prompt off: no request to the model has the block "WHAT YOU KNOW".
//   D  repeat_guard 0: the model answers !consume("bread") three times in a row without bread: all three run
//      and give the same result; none is refused ("I do not try a third time" never comes).
//   E  say_results off: the model answers !storeItems (no chest near) and then nothing: the text of the pack
//      does not go to the chat.
//   F  log_timestamps off: no line of the console starts with [HH:MM:SS].
//   G  restart_context off: no file last_exit.json in the folder of the bot.
//   H  examples_by_last_request off (runs first, while the conversation is short): the prompt examples are
//      chosen by the whole conversation, as before. The player says "do we have wheat", then three times
//      "wait here for a minute" nine times over, then "do we have wheat" again. The first example of the
//      last request is the one of "wait here for a minute" (the earlier conversation wins), not the one the
//      first "do we have wheat" got. (With the switch on the last request alone decides: unit tests.)
// flee_below_health 0 is not tested here: it needs a hostile mob and low health (the unit tests cover it).
import path from 'node:path';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, waitIdle, commands, orderChannel, listFiles, sleep, tp, STUCK_SAID, FREE_SAID, importProject,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, blockNames, inventoryOf, itemsText } from './world.js';

const NAME = 'w_flags0148';
const PLAYER = 'w_player';
const SETTINGS = withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF });
const GIVE_UP = /I am stuck at \(-?\d+, -?\d+, -?\d+\) and could not walk away\./;

const r = region(40);
const g = r.g;
const CELL = { x: r.ox - 20, y: g + 1, z: r.oz - 20 };
const FENCES = [0, 1, 2, 3, 4].map((i) => ({ x: r.ox + 4 + i, y: g + 1, z: r.oz + 6 }));

// v0.1.4.11 (N2, W97): no typed order keeps the bot trying in the closed room any more: a follow that finds no way to
// the player says so and ends, a walk without a way ends within a second (and every new action starts the stuck time
// from zero), !newAction pauses the reflex, and a follow with the player in reach is no being stuck. So in place of the
// order the scenario starts an action of the agent, as a typed command starts one (the label action:walkOut counts as a
// new command for the reflex), that walks toward the player 10 blocks away again and again until it is stopped. It is
// not awaited: the reflex stops it.
let skillsLib = null;
async function walkOut(agent, to) {
    skillsLib ??= await importProject('src/agent/library/skills.js');
    agent.actions.runAction('action:walkOut', async () => {
        for (let i = 0; i < 600 && !agent.bot.interrupt_code; i++) {
            await skillsLib.goToPosition(agent.bot, to.x, to.y, to.z, 1);
            await sleep(500);
        }
    }, { timeout: 15 }).catch(() => {});
}

await scenarioMain({
    async main() {
        await prepareRegion(r);
        try {
            await commands([
                `fill ${CELL.x - 1} ${g} ${CELL.z - 1} ${CELL.x + 1} ${g + 3} ${CELL.z + 1} minecraft:obsidian`,
                `fill ${CELL.x} ${g + 1} ${CELL.z} ${CELL.x} ${g + 2} ${CELL.z} minecraft:air`,
                ...FENCES.map((p) => `setblock ${p.x} ${p.y} ${p.z} minecraft:oak_fence`),
            ]);
            let agent = null, orders = null;
            try {
                const s = await startAgent(NAME, SETTINGS);
                agent = s.agent;
                await resetBot(NAME);

                // H
                await placeBot(agent, { x: r.ox + 6, y: g + 1, z: r.oz + 3 }, 0);
                orders = await orderChannel(s, { name: PLAYER, at: { x: CELL.x + 10, y: g + 1, z: CELL.z } });
                const ask = async (text) => {
                    const n = s.chat.requests.length;
                    orders.say(text);
                    const q = await waitFor(() => s.chat.requests.slice(n).find((x) => String(x.turns?.[x.turns.length - 1]?.content ?? '').includes(text)),
                        { ms: 30000, every: 150 });
                    await waitIdle(agent, 15000);
                    await sleep(1500);
                    return q.ok ? firstExample(q.value.prompt) : '(no request)';
                };
                const e1 = await ask('do we have wheat');
                const flood = 'wait here for a minute '.repeat(9).trim();
                for (let i = 0; i < 3; i++) await ask(flood);
                const e2 = await ask('do we have wheat');
                note(`H: the first example for the first "do we have wheat": ${JSON.stringify(e1.slice(0, 120))}; for the second one: ${JSON.stringify(e2.slice(0, 120))}`);
                check(e1 !== '(no request)' && e2 !== '(no request)', 'H: precondition: both requests "do we have wheat" reached the model with examples', `${e1.slice(0, 60)} | ${e2.slice(0, 60)}`);
                check(e2.includes('wait here for a minute') && !e1.includes('wait here for a minute'),
                    'H: examples_by_last_request off: the whole conversation chose the examples (the second "do we have wheat" got the example of "wait here for a minute")',
                    JSON.stringify(e2.slice(0, 120)));

                // A
                await placeBot(agent, CELL, 0);
                await tp(PLAYER, { x: CELL.x + 10, y: g + 1, z: CELL.z });
                await sleep(500);
                const tA = Date.now();
                const freedNow = () => {
                    const lines = s.behavior.filter((x) => x.t >= tA).map((x) => x.text);
                    const i = lines.indexOf(STUCK_SAID);
                    return i >= 0 && lines.slice(i + 1).includes(FREE_SAID);
                };
                // v0.1.4.11 (N2, W97): a follow that finds no way says so and ends; walkOut keeps the bot trying
                await walkOut(agent, { x: CELL.x + 10, y: g + 1, z: CELL.z });
                const freed = await waitFor(freedNow, { ms: 90000, every: 250 });
                const linesA = s.behavior.filter((x) => x.t >= tA).map((x) => x.text);
                note(`A: the behaviour log: ${JSON.stringify(linesA)}`);
                check(freed.ok, `A: stuck_restart_after 1: after "${STUCK_SAID}" the escape that returned says "${FREE_SAID}" (v0.1.4.7), although the bot is still in the room`);
                check(!linesA.some((l) => GIVE_UP.test(l)), 'A: the reflex does not give up with "I am stuck at (x, y, z) and could not walk away." (new only with stuck_restart_after above 1)', JSON.stringify(linesA));
                check(s.killed === null, 'A: the process lives (the escape returned; as in v0.1.4.7 no timer ended it)', String(s.killed));
                await orders.order('!stop', 20000);
                await placeBot(agent, { x: r.ox + 6, y: g + 1, z: r.oz + 3 }, 0);
                await tp(PLAYER, { x: r.ox - 6, y: g + 1, z: r.oz - 6 });

                // B
                const tB = Date.now();
                s.route(/w_player: get me 3 fences/, '!collectBlocks("oak_fence", 3)');
                orders.say('get me 3 fences');
                const backB = await waitFor(() => s.added.find((a2) => a2.t >= tB && a2.name === 'system' && a2.content.includes('oak_fence')), { ms: 120000, every: 250 });
                await waitIdle(agent, 30000);
                const posts = await blockNames(FENCES, ['oak_fence']);
                const invB = await inventoryOf(NAME);
                note(`B: the result ${JSON.stringify(backB.value?.content?.slice(0, 300))}; posts left ${posts.filter(Boolean).length} of 5; the bot carries ${itemsText(invB)}`);
                check(posts.filter((x) => x === null).length === 3, 'B: protect_built_blocks off: 3 free fence posts were broken (v0.1.4.7)', `${posts.filter((x) => x === null).length} broken`);
                check((invB.oak_fence || 0) === 3, 'B: the bot carries 3 oak_fence', itemsText(invB));
                check(Boolean(backB.value?.content?.includes('Collected 3 oak_fence.')), 'B: the result says "Collected 3 oak_fence."', JSON.stringify(backB.value?.content?.slice(0, 200)));

                // C
                const withKnowledge = s.chat.requests.filter((q) => String(q.prompt).includes('WHAT YOU KNOW'));
                check(s.chat.requests.length > 0 && withKnowledge.length === 0, 'C: knowledge_in_prompt off: no request to the model has the block "WHAT YOU KNOW"', `${withKnowledge.length} of ${s.chat.requests.length}`);

                // D
                await commands([`clear ${NAME} minecraft:bread`]);
                const tD = Date.now();
                s.route(/w_player: eat some bread/, '!consume("bread")');
                s.route(/bread/, '!consume("bread")');
                s.route(/bread/, '!consume("bread")');
                orders.say('eat some bread');
                await waitFor(() => s.routes.length === 0, { ms: 60000, every: 250 });
                await waitIdle(agent, 30000);
                await sleep(1000);
                const resultsD = s.added.filter((a2) => a2.t >= tD && a2.name === 'system' && /bread/.test(a2.content)).map((a2) => a2.content);
                note(`D: the results: ${JSON.stringify(resultsD)}`);
                check(resultsD.length === 3 && new Set(resultsD).size === 1, 'D: repeat_guard 0: the three !consume("bread") ran and gave the same result', `${resultsD.length} results`);
                check(!resultsD.some((t) => /I do not try a third time/.test(t)), 'D: none was refused (no "I do not try a third time")');

                // E
                const tE = Date.now();
                s.route(/w_player: store your things/, '!storeItems');
                orders.say('store your things');
                const backE = await waitFor(() => s.added.find((a2) => a2.t >= tE && a2.name === 'system' && !/^Recent behaviors log/.test(a2.content)), { ms: 60000, every: 250 });
                await waitIdle(agent, 30000);
                await sleep(2000);
                const textE = backE.value?.content ?? '';
                const chatsE = s.chats.filter((c) => c.t >= tE).map((c) => c.text);
                note(`E: the result of !storeItems ${JSON.stringify(textE)}; the chat of the bot since: ${JSON.stringify(chatsE)}`);
                check(textE !== '' && !chatsE.some((c) => c.includes(textE.slice(0, 40))), 'E: say_results off: the text of the pack did not go to the chat', JSON.stringify(chatsE));

                // F
                const stamped = s.logs.filter((l) => /^\[\d\d:\d\d:\d\d\]/.test(l));
                check(s.logs.length > 0 && stamped.length === 0, 'F: log_timestamps off: no line of the console starts with [HH:MM:SS]', JSON.stringify(stamped.slice(0, 3)));
                check(s.killed === null, 'the process lives', String(s.killed));
                check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
            } finally {
                if (orders) await orders.quit();
                await stopRealAgent(agent);
            }
            // G
            const exits = listFiles(path.join('bots', NAME)).filter((f) => /last_exit\.json$/.test(f));
            check(exits.length === 0, 'G: restart_context off: no last_exit.json in the folder of the bot', JSON.stringify(exits));
        } finally {
            await releaseRegion(r);
        }
    },
});
exitSoon();

// The first example in the prompt of a request ('' when the prompt has none).
function firstExample(prompt) {
    const text = String(prompt ?? '');
    const i = text.indexOf('Example 1:');
    if (i < 0) return '';
    const j = text.indexOf('Example 2:', i);
    return text.slice(i + 'Example 1:'.length, j < 0 ? i + 400 : j).trim();
}
