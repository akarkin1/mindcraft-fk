// W04 shelter (spec section 8 "Shelter", H3, section 6): home_pack and protected_areas on,
// world_memory on. The bot saves the house around it with !rememberArea("home", "home") (v0.1.4.8: only an
// area of type home is a shelter, spec C4 and D2), is
// teleported 40 blocks away (south-east, so the way in leads around the house to the door on the
// north side) and runs !goToShelter. It must end inside the house with the door closed, through
// the door (not through a wall), and the house must be untouched. A second !goToShelter answers
// that the bot is in the shelter already.
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    entityPos, fmt, startTrace, printTrace, sleep,
} from './helpers.js';
import {
    region, prepareRegion, releaseRegion, housePlan, buildHouse, isOpen, inBox, hdist, distToBox,
    snapshotBox, compareSnapshot, describeDifferences, dropSnapshot,
} from './world.js';

const NAME = 'w_shelter';

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        const h = housePlan(r.ox - 10, r.oz - 10, g);
        await buildHouse(h);
        const snap = await snapshotBox(h.box);

        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, home_pack: true, protected_areas: true, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, h.inside, 0);
            const saved = await command_(agent, '!rememberArea("home", "home")', 30000);
            note(`!rememberArea: ${JSON.stringify(saved)}`);
            // v0.1.4.11 (P1): the answer names the kind, the border, the size and the contents
            check(/I saved "home": an? \w+, \w+, \d+ x \d+( with a roof)?, [^.]*\b1 door\b/.test(saved) && agent.area_store?.get?.('home'), 'precondition: !rememberArea saved the house as "home" with its door (the answer of P1)', JSON.stringify(saved.slice(0, 200)));

            // 32 blocks south-east of the middle of the room: 40.3 blocks from the house (spec section 8, F5)
            const far = { x: h.inside.x + 32, y: g + 1, z: h.inside.z + 32 };
            const at = await placeBot(agent, far, 135);
            note(`the bot starts ${distToBox(at, h.box).toFixed(1)} blocks from the house, ${hdist(at, { x: h.door.x + 0.5, z: h.door.z + 0.5 }).toFixed(1)} from the door`);
            check(distToBox(at, h.box) >= 39.5, 'the bot starts 40 blocks away from the house', fmt(at));

            const trace = startTrace(async () => ({ pos: await entityPos(NAME), open: await isOpen(h.door) }), 300);
            const t0 = Date.now();
            const reply = await command_(agent, '!goToShelter', 90000);
            const ms = Date.now() - t0;
            const end = await entityPos(NAME);
            const doorAtEnd = await isOpen(h.door);
            await sleep(600);
            const rows = await trace.stop();
            printTrace('!goToShelter from 40 blocks away', rows, {
                pos: (x) => fmt(x.pos), toDoor: (x) => hdist(x.pos, { x: h.door.x + 0.5, z: h.door.z + 0.5 }).toFixed(1),
                inside: (x) => (inBox(x.pos, h.interior) ? 'yes' : 'no'), door: (x) => (x.open ? 'open' : 'closed'),
            });
            note(`!goToShelter answered after ${ms} ms: ${JSON.stringify(reply)}`);
            check(reply.includes('I am in the shelter "home". The door is closed.'), 'the reply is: I am in the shelter "home". The door is closed.', JSON.stringify(reply.slice(0, 200)));
            check(inBox(end, h.interior), 'the bot ends inside the house (server position)', fmt(end));
            check(doorAtEnd === false, 'the door is closed when !goToShelter has answered (server)', `open: ${doorAtEnd}`);
            check(rows.some((x) => x.open === true), 'the bot went in through the door (the door was open on the way)');
            const firstInside = rows.findIndex((x) => inBox(x.pos, h.interior));
            const lastOpenBefore = rows.slice(0, Math.max(0, firstInside + 1)).some((x) => x.open === true);
            check(firstInside >= 0 && lastOpenBefore, 'the door was open before the bot was inside (it did not come through a wall)');
            check(hdist(end, { x: h.door.x + 0.5, z: h.door.z + 0.5 }) >= 1.8, 'inside, the bot does not stay in the doorway (H3 step 6)',
                `${hdist(end, { x: h.door.x + 0.5, z: h.door.z + 0.5 }).toFixed(1)} blocks from the door`);
            const cmp = await compareSnapshot(snap, agent.bot);
            check(cmp.same, 'every block of the house is still there', describeDifferences(cmp.differences));

            const again = await command_(agent, '!goToShelter', 30000);
            check(again.includes('I am in the shelter already.'), 'a second !goToShelter answers: I am in the shelter already.', JSON.stringify(again.slice(0, 200)));

            // The doorstep: 1 block in front of the closed door, outside the walls. A scanned box is the
            // house grown by 1 block (A3), so the doorstep lies inside the box of the area although
            // the bot is outside the house.
            const doorstep = { x: h.door.x, y: g + 1, z: h.door.z - 1 };
            const home = agent.area_store?.get?.('home'); // v0.1.4.11 (P1): the answer has no corners; the store has them
            if (home) note(`the saved box is from (${home.min.x}, ${home.min.y}, ${home.min.z}) to (${home.max.x}, ${home.max.y}, ${home.max.z}); the doorstep is (${doorstep.x}, ${doorstep.y}, ${doorstep.z})`);
            await placeBot(agent, doorstep, 180);
            const fromStep = await command_(agent, '!goToShelter', 60000);
            const endStep = await entityPos(NAME);
            note(`from the doorstep: ${JSON.stringify(fromStep)} -> ${fmt(endStep)}`);
            check(inBox(endStep, h.interior) && (await isOpen(h.door)) === false,
                '[spec issue A3/H3] from the doorstep outside the closed door !goToShelter takes the bot into the house (it is outside the walls although inside the grown box)',
                `${JSON.stringify(fromStep.slice(0, 120))}, bot ${fmt(endStep)}`);

            note(`the fake chat model got ${s.chat.requests.length} request(s)`);
            check(s.chat.requests.length === 0, 'no request to the model was needed');
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await dropSnapshot(snap).catch(() => {});
            await releaseRegion(r);
        }
    },
});
exitSoon();
