// W55 the reflex switch (v0.1.4.8 spec section 11.8; finding R4, decision of the owner "only you switch the
// safety reflexes off").
// Defect of the play test: the model switched the creeper reflex off with !setMode("creeper_safety", false);
// nothing forbade it, and an example of the prompt showed a mode being switched off. Against v0.1.4.7 the
// model's command answers "Mode creeper_safety is now off." and the reflex is off.
//
// Flat world, the modes of the owner (all five safety reflexes exist: self_preservation, creeper_safety,
// night_shelter, door_closing, hunger).
//   1. For each of the five: the player writes "switch off <mode>"; the fake model answers
//      !setMode("<mode>", false). The result that goes back to the model is "Only the player switches the
//      reflex <mode>. The player can type !setMode("<mode>", false) in the chat." and the mode stays on.
//   2. The player types !setMode("creeper_safety", false) himself: the answer is "Mode creeper_safety is now
//      off." and the mode is off. The player types !setMode("creeper_safety", true): it is on again.
//   3. A mode that is no safety reflex (idle_staring) is switched by the model as before.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, waitIdle, orderChannel,
} from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';

const NAME = 'w_switch';
const PLAYER = 'w_player';
const SAFETY = ['self_preservation', 'creeper_safety', 'night_shelter', 'door_closing', 'hunger'];
const refusal = (m) => `Only the player switches the reflex ${m}. The player can type !setMode("${m}", false) in the chat.`;

await scenarioMain({
    async main() {
        const r = region(24);
        const g = r.g;
        await prepareRegion(r);
        let agent = null, orders = null;
        try {
            const s = await startAgent(NAME, withModes({ ...NEW_FLAGS_OFF, ...FLAGS_0148_OFF, world_memory: true }));
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: g + 1, z: r.oz }, 0);
            orders = await orderChannel(s, { name: PLAYER, at: { x: r.ox + 8, y: g + 1, z: r.oz } });
            const modes = agent.bot.modes;

            // ---------------------------------------------------------- 1. the model is refused
            for (const m of SAFETY) {
                check(modes.exists(m) && modes.isOn(m), `1 ${m}: precondition: the mode exists and is on`);
                const t0 = Date.now();
                s.route(new RegExp(`w_player: switch off ${m}`), `!setMode("${m}", false)`);
                orders.say(`switch off ${m}`);
                const routed = await waitFor(() => s.routes.length === 0, { ms: 20000 });
                const back = await waitFor(() => s.added.find((a) => a.t >= t0 && a.name === 'system' && a.content.includes(m)), { ms: 20000, every: 100 });
                await waitIdle(agent, 10000);
                const text = back.ok ? back.value.content : '';
                note(`1 ${m}: the result that went back to the model: ${JSON.stringify(text)}`);
                check(routed.ok, `1 ${m}: the model answered !setMode("${m}", false)`);
                check(text.includes(refusal(m)), `1 ${m}: the command of the model is refused: "${refusal(m)}"`, JSON.stringify(text));
                check(modes.isOn(m), `1 ${m}: the mode is still on`);
            }

            // ---------------------------------------------------------- 2. the player may
            const off = await orders.order('!setMode("creeper_safety", false)', 20000);
            note(`2: the player's command answered ${JSON.stringify(off)}`);
            check(off.includes('Mode creeper_safety is now off.'), '2: typed by the player, !setMode("creeper_safety", false) answers "Mode creeper_safety is now off."', JSON.stringify(off));
            check(!modes.isOn('creeper_safety'), '2: the mode creeper_safety is off');
            const on = await orders.order('!setMode("creeper_safety", true)', 20000);
            check(on.includes('Mode creeper_safety is now on.') && modes.isOn('creeper_safety'), '2: typed by the player, !setMode("creeper_safety", true) switches it on again', JSON.stringify(on));

            // ---------------------------------------------------------- 3. another mode as before
            const t3 = Date.now();
            s.route(/w_player: stop looking around/, '!setMode("idle_staring", false)');
            orders.say('stop looking around');
            const back3 = await waitFor(() => s.added.find((a) => a.t >= t3 && a.name === 'system' && a.content.includes('idle_staring')), { ms: 20000, every: 100 });
            await waitIdle(agent, 10000);
            note(`3: ${JSON.stringify(back3.value?.content)}`);
            check(back3.ok && back3.value.content.includes('Mode idle_staring is now off.') && !modes.isOn('idle_staring'), '3: the model switches idle_staring (no safety reflex) as before', JSON.stringify(back3.value?.content));
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
