// W07 scan (spec section 8 "Scan", A3, section 6 !rememberArea and !areas): protected_areas on,
// world_memory on. The areas are read from the reply and from <worldDir>/areas.json.
//   1. inside a built house: !rememberArea("home", "building") saves a box that covers the house and
//      is at most 2 blocks bigger on every side, and the door is found;
//   2. inside a fenced field: !rememberArea("wheat_farm", "farm") finds the farm and its gate;
//   3. on an open field: !rememberArea("field", "farm") saves nothing;
//   4. on an open field, type building: the fallback box of section 6 is saved with its text
//      (section 8 says "nothing is saved" only for the farm; section 6 defines the building case);
//   5. !areas lists the areas.
import fs from 'node:fs';
import path from 'node:path';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
} from './helpers.js';
import { region, prepareRegion, releaseRegion, housePlan, buildHouse, farmPlan, buildFarm } from './world.js';

const NAME = 'w_scan';
const B = (b) => `(${b.min.x}, ${b.min.y}, ${b.min.z}) to (${b.max.x}, ${b.max.y}, ${b.max.z})`;

function readAreas(agent) {
    const dir = agent.world_memory?.worldDir;
    if (!dir) return { file: null, areas: null };
    const file = path.join(dir, 'areas.json');
    try { return { file, json: JSON.parse(fs.readFileSync(file, 'utf8')), areas: JSON.parse(fs.readFileSync(file, 'utf8')).areas }; } catch (e) { return { file, areas: null, error: e.message }; }
}

const covers = (box, inner) => ['x', 'y', 'z'].every((k) => box.min[k] <= inner.min[k] && box.max[k] >= inner.max[k]);
const atMostBigger = (box, inner, n) => ['x', 'y', 'z'].every((k) => box.min[k] >= inner.min[k] - n && box.max[k] <= inner.max[k] + n);

await scenarioMain({
    async main() {
        const r = region(48);
        const g = r.g;
        await prepareRegion(r);
        const h = housePlan(r.ox - 20, r.oz - 20, g);
        const f = farmPlan(r.ox + 5, r.oz - 20, g);
        const open = { x: r.ox, y: g + 1, z: r.oz + 20 };
        await buildHouse(h);
        await buildFarm(f);

        let agent = null;
        try {
            const s = await startAgent(NAME, { ...NEW_FLAGS_OFF, protected_areas: true, world_memory: true });
            agent = s.agent;
            await resetBot(NAME);

            // ---------------------------------------------------------- 1. the house
            await placeBot(agent, h.inside, 0);
            const r1 = await command_(agent, '!rememberArea("home", "building")', 30000);
            note(`1: ${JSON.stringify(r1)}`);
            const m1 = /Area "home" \(building\) saved: (\d+) x (\d+) x (\d+) blocks, from \((-?\d+), (-?\d+), (-?\d+)\) to \((-?\d+), (-?\d+), (-?\d+)\), 1 door\. Tell me if that is wrong\./.exec(r1);
            check(m1, '1: the reply is "Area "home" (building) saved: <x> x <y> x <z> blocks, from (...) to (...), 1 door. Tell me if that is wrong."', JSON.stringify(r1.slice(0, 240)));
            const a1 = readAreas(agent);
            const home = a1.areas?.home;
            note(`1: areas.json ${a1.file}: ${JSON.stringify(home)}`);
            check(a1.json?.version === 1 && home, '1: areas.json (version 1) holds the area "home"', a1.error || '');
            check(home?.type === 'building' && home?.source === 'scan', '1: the area is a building found by a scan', `${home?.type} ${home?.source}`);
            check(home && covers(home, h.box), `1: the box covers the house ${B(h.box)}`, home ? B(home) : '');
            check(home && atMostBigger(home, h.box, 2), '1: the box is at most 2 blocks bigger than the house on every side', home ? B(home) : '');
            const door = (home?.entrances || []).find((e) => e.x === h.door.x && e.y === h.door.y && e.z === h.door.z);
            check(door && door.kind === 'door' && home.entrances.length === 1, `1: the door is found: one entrance, the lower block of the door (${h.door.x}, ${h.door.y}, ${h.door.z}), kind door`,
                JSON.stringify(home?.entrances));
            if (m1 && home) {
                const size = [Number(m1[1]), Number(m1[2]), Number(m1[3])];
                const expectSize = ['x', 'y', 'z'].map((k) => home.max[k] - home.min[k] + 1);
                check(JSON.stringify(size) === JSON.stringify(expectSize) && r1.includes(`from ${B(home)}`),
                    '1: the size and corners in the reply are those of the saved box', `${JSON.stringify(size)} vs ${JSON.stringify(expectSize)}, ${B(home)}`);
            }

            // ---------------------------------------------------------- 2. the fenced field
            await placeBot(agent, f.inside, 0);
            const r2 = await command_(agent, '!rememberArea("wheat_farm", "farm")', 30000);
            note(`2: ${JSON.stringify(r2)}`);
            check(/Area "wheat_farm" \(farm\) saved: \d+ x \d+ x \d+ blocks, .*1 gate\./.test(r2), '2: the reply is "Area "wheat_farm" (farm) saved: ..., 1 gate."', JSON.stringify(r2.slice(0, 240)));
            const farm = readAreas(agent).areas?.wheat_farm;
            note(`2: ${JSON.stringify(farm)}`);
            check(farm?.type === 'farm', '2: the farm is found and saved as type farm', JSON.stringify(farm?.type));
            const fence = { min: { x: f.box.min.x, y: g, z: f.box.min.z }, max: { x: f.box.max.x, y: g + 1, z: f.box.max.z } };
            check(farm && covers(farm, fence), `2: the box covers the field and its fence ${B(fence)}`, farm ? B(farm) : '');
            check(farm && farm.min.x === fence.min.x && farm.max.x === fence.max.x && farm.min.z === fence.min.z && farm.max.z === fence.max.z
                && farm.min.y === g - 1 && farm.max.y === g + 3,
            `2: the box is the field with its fence, from 1 block below the ground (farmland at y ${g}) to 3 above (A3)`, farm ? B(farm) : '');
            const gate = (farm?.entrances || []).find((e) => e.x === f.gate.x && e.y === f.gate.y && e.z === f.gate.z);
            check(gate && gate.kind === 'gate' && farm.entrances.length === 1, `2: the gate is found: one entrance (${f.gate.x}, ${f.gate.y}, ${f.gate.z}), kind gate`,
                JSON.stringify(farm?.entrances));

            // ---------------------------------------------------------- 3. an open field, farm
            await placeBot(agent, open, 0);
            const r3 = await command_(agent, '!rememberArea("field", "farm")', 30000);
            note(`3: ${JSON.stringify(r3)}`);
            check(r3.includes('I found no fenced ground here. Stand inside the fence and try again.'), '3: open field, farm: the reply is "I found no fenced ground here. Stand inside the fence and try again."',
                JSON.stringify(r3.slice(0, 200)));
            const after3 = readAreas(agent).areas || {};
            check(!('field' in after3) && Object.keys(after3).length === 2, '3: open field, farm: nothing is saved', JSON.stringify(Object.keys(after3)));

            // ---------------------------------------------------------- 4. an open field, building
            const r4 = await command_(agent, '!rememberArea("camp", "building")', 30000);
            note(`4: ${JSON.stringify(r4)}`);
            check(r4.includes('I found no building here. I saved a box of 25 x 13 x 25 blocks around this place as "camp". Use !setArea to correct it.'),
                '4: open field, building: the fallback text of section 6', JSON.stringify(r4.slice(0, 220)));
            const camp = readAreas(agent).areas?.camp;
            check(camp && camp.max.x - camp.min.x + 1 === 25 && camp.max.y - camp.min.y + 1 === 13 && camp.max.z - camp.min.z + 1 === 25
                && camp.min.x === open.x - 12 && camp.min.y === open.y - 4 && camp.min.z === open.z - 12,
            '4: open field, building: a box of 25 x 13 x 25 around the bot is saved (12 around in x and z, 4 below to 8 above)', camp ? B(camp) : 'not saved');

            // ---------------------------------------------------------- 5. !areas
            const list = await command_(agent, '!areas', 10000);
            note(`5: ${JSON.stringify(list)}`);
            check(list.includes('Protected areas in this world:') && home && list.includes(`- home (building): from ${B(home)}, 1 door`),
                '5: !areas lists "- home (building): from (...) to (...), 1 door"', JSON.stringify(list.slice(0, 300)));
            check(list.includes('- wheat_farm (farm):'), '5: !areas lists the farm');

            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await releaseRegion(r);
        }
    },
});
exitSoon();
