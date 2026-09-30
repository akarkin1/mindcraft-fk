// W60 long run (v0.1.4.8 spec section 1 "No restart in play", section 12 W60).
// Defect of the play test: 20 restarts of the process in 2 hours (stuck 11, refused stop 3, chat 3, smelt 1,
// kick 1, network 1); no scenario had run longer than a few minutes, none with all reflexes on in a base like
// the owner's. Against v0.1.4.7 this run would end the process within minutes (the first order at the bottom
// of the shaft, a skill that stands at a chest or a bed for 20 s, a !stop during a walk).
//
// Base world with 4 trees north of the house, every part on as the owner plays (OWNER_SWITCHES) with every
// setting of v0.1.4.8 on (FLAGS_0148_ON: stuck_restart_after 3, protect_built_blocks, knowledge in the prompt,
// repeat guard 3, restart context, say_results, flee_below_health 8, time stamps), the modes of the owner with
// all home reflexes; v0.1.4.9 (spec 11 TW 3): the switches of v0.1.4.9 on too (routes_pack, mine_routes,
// ore_sense_range 3, skills_over_code), and orders of the new commands in the list (see ORDERS). Difficulty easy (the food level falls), no monsters, the daylight cycle ON from time 1000:
// dusk comes after about 9 minutes, so the night reflex, the doors and the shelter take part.
// The player types the 60 orders of ORDERS below, in this order, one every 30 s at the earliest and never
// sooner than 15 s after the one before (the next one waits for the answer of the one before, at most its time
// limit; an order that runs on is stopped by the next one). Each order is printed as "ORDER n/60 ..." with the
// time of day, the server position and whether the bot sleeps, so that a failure can be repeated.
// Passes when: the process of the agent never ended (no cleanKill, the scenario reaches its end); every order
// reached the agent; every order has a result text (its answer in the chat, or the history line "Command !x was
// stopped by ..." of I5 when a later order or a reflex stopped it); the bot is alive at the end (server).
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_ON, FLAGS_0149_ON, withModes, placeBot,
    resetBot, waitFor, sleep, commands, orderChannel, giveItems, entityPos, fmt, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, treePlan, buildTree, entityNumber, inventoryOf, itemsText } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const NAME = 'w_long';
const PLAYER = 'w_player';
const PACE_MS = 30000; // one order every 30 s at the earliest: 60 orders, 30 minutes
// and never sooner than 15 s after the one before: after orders that ran long the plan must not catch up with
// a burst (seen on the test server: 7 orders in 2 s made the bot say 11 lines in 2 s, and the server kicked it
// for spamming; no player types that fast)
const MIN_GAP_MS = 15000;
// orders that never end by themselves; the list gives each of them a !stop as the next order
const ENDLESS = ['!followPlayer'];
const DEADLINE_MS = 40 * 60 * 1000; // no order is given after 40 minutes (the runner's limit is 45)

// The 60 orders: [command, time limit in seconds]. `P` holds the places of the base (basePlan).
const xyz = (p, d = 1) => `${p.x + 0.5}, ${p.y}, ${p.z + 0.5}, ${d}`;
// v0.1.4.9: eight orders of the new commands (spec 11 TW 3, W60) took the places of eight repeated queries of
// v0.1.4.8 (a second !chests("..."), !closeDoor, !chests, !eat, !inventory, !stats and !goToRememberedPlace("home")),
// so the run keeps 60 orders and its 30 minutes: the way to the farm (!rememberRoute, !routes, !forgetRoute), the
// mine of the owner (!rememberMine in the room, !rememberTunnel at the end of the tunnel, !mineOre in it,
// !collectPassedOre).
const ORDERS = (P) => [
    ['!stats', 20],
    ['!inventory', 20],
    ['!goToRememberedPlace("home")', 90],
    ['!viewChest', 60],
    ['!chests', 20],
    ['!fetchItem("bread", 3)', 90],
    ['!eat', 45],
    ['!rememberArea("home", "home")', 60],
    ['!areas', 20],
    [`!goToCoordinates(${xyz(P.farm.outsideGate)})`, 90],
    ['!rememberArea("farm", "farm")', 90],
    ['!rememberRoute("farm")', 20],
    ['!routes', 20],
    ['!harvest', 240],
    ['!storeItems', 180],
    ['!plant("wheat_seeds", "farm")', 240],
    ['!makeBoneMeal(2)', 240],
    ['!fertilize', 240],
    ['!farmCycle', 480],
    ['!closeDoor', 30],
    [`!goToCoordinates(${xyz(P.pen.outsideGate)})`, 90],
    ['!rememberArea("pen", "pen")', 90],
    ['!collectBlocks("oak_fence", 4)', 90],
    ['!searchForEntity("cow", 32)', 60],
    [`!goToCoordinates(${xyz(P.trees)})`, 90],
    ['!chopTrees(8)', 420],
    ['!pickUpItems', 90],
    ['!getTool("axe", "")', 240],
    ['!craftSupplies("torch", 8)', 240],
    ['!goToRememberedPlace("home")', 120],
    ['!storeItems', 180],
    ['!goToShelter', 120],
    ['!goToBed', 90],
    ['!mineOre("iron", 4)', 60],
    [`!goToCoordinates(${xyz(P.room.middle)})`, 120],
    ['!rememberMine("mine")', 20],
    [`!goToCoordinates(${xyz(P.tunnel.end)})`, 120],
    ['!rememberTunnel', 20],
    ['!mineOre("iron", 2)', 180],
    ['!collectPassedOre("coal")', 60],
    ['!nearbyBlocks', 20],
    ['!goToSurface', 120],
    ['!rememberHere("field")', 20],
    ['!moveAway(8)', 60],
    ['!goToRememberedPlace("field")', 60],
    [`!followPlayer("${PLAYER}", 3)`, 30],
    ['!stop', 20],
    [`!goToPlayer("${PLAYER}", 3)`, 90],
    [`!givePlayer("${PLAYER}", "bread", 1)`, 90],
    ['!discard("dirt", 4)', 60],
    ['!consume("bread")', 30],
    ['!savedPlaces', 20],
    ['!rememberRule("Never break the fence of the pen.")', 20],
    ['!rules', 20],
    ['!cost', 20],
    ['!craftable', 20],
    ['!fetchItem("leaf_litter", 8)', 90],
    ['!harvest("farm")', 240],
    ['!forgetRoute("farm")', 20],
    ['!goToRememberedPlace("home")', 120],
];

await scenarioMain({
    async main() {
        const r = region(BASE_RADIUS);
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        const b = basePlan(r);
        await buildBase(b);
        const g = b.g;
        const trees = [[-8, -18], [-2, -21], [4, -18], [10, -21]].map(([dx, dz]) => treePlan(r.ox + dx, r.oz + dz, g, 6));
        for (const t of trees) await buildTree(t, { natural: true });
        const P = { ...b, trees: { x: r.ox + 1, y: g + 1, z: r.oz - 13 } };
        const list = ORDERS(P);
        check(list.length === 60, 'precondition: the list has 60 orders', String(list.length));

        let agent = null, orders = null;
        let deaths = 0;
        try {
            const s = await startAgent(NAME, withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_ON, ...FLAGS_0149_ON, ore_sense_range: 3, skills_over_code: true }));
            agent = s.agent;
            agent.bot.on('death', () => { deaths++; });
            await resetBot(NAME);
            saveHomePlace(agent, b);
            await placeBot(agent, b.house.outsideDoor, 180);
            orders = await orderChannel(s, { name: PLAYER, at: { x: b.house.outsideDoor.x + 8, y: g + 1, z: b.house.outsideDoor.z - 5 } });
            await giveItems(NAME, [['bread', 4], ['torch', 8], ['oak_log', 16], ['cobblestone', 32], ['dirt', 16], ['wheat_seeds', 16]], agent.bot);
            await commands(['difficulty easy', `gamemode survival ${NAME}`, 'time set 1000', 'gamerule doDaylightCycle true']);

            const t0 = Date.now();
            const results = [];
            let lastStart = 0;
            for (let i = 0; i < list.length; i++) {
                const [text, limit] = list[i];
                const due = Math.max(t0 + i * PACE_MS, lastStart + MIN_GAP_MS);
                if (Date.now() < due) await sleep(due - Date.now());
                const left = t0 + DEADLINE_MS - Date.now();
                if (left <= 5000) {
                    note(`the deadline of ${DEADLINE_MS / 60000} minutes is reached before order ${i + 1}; the rest is not given`);
                    break;
                }
                const ms = Math.min(limit * 1000, left - 5000);
                lastStart = Date.now();
                const info = await orders.orderInfo(text, ms);
                const pos = await entityPos(NAME);
                const day = agent.bot.time?.timeOfDay;
                results.push({ n: i + 1, text, info });
                const stopped = info.stopped.length ? ` [${info.stopped.map((x) => x.slice(0, 90)).join(' | ')}]` : '';
                console.log(`ORDER ${i + 1}/${list.length} t=${((Date.now() - t0) / 1000).toFixed(0)}s time=${day} at ${fmt(pos)} sleeping=${Boolean(agent.bot.isSleeping)} ${text} -> ${info.done ? '' : '(still running) '}${JSON.stringify(info.reply.slice(0, 160))} (${(info.ms / 1000).toFixed(1)} s)${stopped}`);
                if (s.killed !== null) break;
            }
            // the last order gets its time to end; one that still runs is stopped
            const last = results[results.length - 1];
            if (last && !last.info.record?.done) {
                await waitFor(() => last.info.record?.done, { ms: 60000, every: 500 });
                if (!last.info.record?.done) await orders.orderInfo('!stop', 20000);
            }
            await sleep(3000);
            const minutes = (Date.now() - t0) / 60000;
            note(`the run took ${minutes.toFixed(1)} minutes for ${results.length} orders; deaths ${deaths}`);

            // every order: received, and a result text (the answer, or the line of I5 when it was stopped). An
            // endless order (!followPlayer) has no result of its own: when a reflex stops it, it comes back by
            // itself and writes no line (the glue); it ends with the next order, !stop, whose answer counts.
            const withoutText = [];
            for (const [i, x] of results.entries()) {
                const m = x.info.record;
                const until = (m?.t1 ?? Date.now()) + 2000;
                const stopped = m ? s.added.filter((a) => a.name === 'system' && a.t >= m.t0 && a.t <= until && /^Command !\w+ was stopped by /.test(a.content)) : [];
                const next = results[i + 1];
                const endedByStop = ENDLESS.some((c) => x.text.startsWith(c)) && next?.text === '!stop' && /Agent stopped\./.test(next.info.reply);
                const hasText = endedByStop || (Boolean(m?.done) && ((m.result ?? '') !== '' || stopped.length > 0));
                if (!x.info.arrived || !hasText) withoutText.push(`${x.n} ${x.text}: ${x.info.arrived ? (m?.done ? 'no text' : 'did not end') : 'not received'}`);
            }
            check(results.length === list.length, `all ${list.length} orders were given`, `${results.length} given`);
            check(results.every((x) => x.info.arrived), 'every order reached the agent', results.filter((x) => !x.info.arrived).map((x) => `${x.n} ${x.text}`).join('; '));
            check(withoutText.length === 0, 'no order stayed without a result text (the answer, or "Command !x was stopped by ..." of I5)', withoutText.join('; '));
            check(s.killed === null, 'the process of the agent never ended', String(s.killed));
            const health = await entityNumber(NAME, 'Health');
            check(health > 0 && agent.bot?.entity, 'the bot is alive at the end (server)', `health ${health}, deaths during the run ${deaths}`);
            const prompts = s.chat.requests.map((q) => String(q.prompt).length);
            note(`${s.chat.requests.length} requests to the fake chat model; the longest conversing prompt has ${prompts.length ? Math.max(...prompts) : 0} characters (G12: at most 17,000 with every switch on)`);
            note(`the bot carries ${itemsText(await inventoryOf(NAME))} and stands at ${fmt(await entityPos(NAME))}`);
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await commands(['gamerule doDaylightCycle false', 'time set 6000', 'difficulty peaceful']).catch(() => {});
            if (orders) await orders.quit();
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
