// W50 auto home (v0.1.4.8 spec D6, section 11.6; findings M5 and R2).
// Defect of the play test: the owner's house was a place only ("home" in places.json), never an area. So no
// rule protected it: the shaft of the second session went in 6.5 blocks from home, and the night reflex took
// the mine and the pen for the shelter. Against v0.1.4.7: after the restart there is still no area, and the
// start of the bot says nothing about the house.
//
// Base world, the modes of the owner, the owner's packs (protected_areas on).
//   first   The agent starts, the place "home" is saved in its memory (a place, no area, as the owner had it),
//           the bot stands in the house. The agent stops. No area exists.
//   second  A new agent process starts in the same world, the bot in the house: at the spawn autoHome scans
//           the building at the place and saves it as the area "home" of type home, source auto (D6). The box
//           holds the house; the bot says "I saved your house as the area "home": X x Y x Z blocks, N door(s).
//           Tell me if that is wrong." The file areas.json of the world has the area.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, OWNER_SWITCHES, FLAGS_0148_OFF, withModes, placeBot,
    resetBot, waitFor, runPhase, listFiles, emitData, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';
import { basePlan, buildBase, saveHomePlace, BASE_RADIUS } from './base_world.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_autohome';
const SETTINGS = withModes({ ...OWNER_SWITCHES, ...FLAGS_0148_OFF });
const SAID = /I saved your house as the area "home": (\d+) x (\d+) x (\d+) blocks, (\d+) doors?\. Tell me if that is wrong\./;

const r = region(BASE_RADIUS);
const b = basePlan(r);

const covers = (area, box) => area && area.min.x <= box.min.x && area.min.z <= box.min.z && area.max.x >= box.max.x && area.max.z >= box.max.z
    && area.min.y <= box.min.y + 1 && area.max.y >= box.max.y - 1;

await scenarioMain({
    async first() {
        let agent = null;
        try {
            const s = await startAgent(NAME, SETTINGS);
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, b.house.home, 180);
            check(saveHomePlace(agent, b) !== false, 'first: the place "home" is saved (a place, no area)');
            check((agent.area_store?.list() ?? []).length === 0, 'first: no area exists', JSON.stringify(agent.area_store?.list()));
            check(s.killed === null, 'first: the process lives', String(s.killed));
        } finally {
            await stopRealAgent(agent);
        }
    },

    async second() {
        let agent = null;
        try {
            const s = await startAgent(NAME, SETTINGS);
            agent = s.agent;
            const found = await waitFor(() => agent.area_store?.get('home'), { ms: 15000, every: 200 });
            const area = found.ok ? found.value : null;
            note(`second: the areas after the spawn: ${JSON.stringify(agent.area_store?.list())}`);
            // the text may come before the recorders of the scenario were installed: the history and the
            // console are searched too
            const texts = [...s.chats.map((x) => x.text), ...s.added.map((a) => a.content), ...(agent.history?.turns ?? []).map((t) => String(t.content)), ...s.logs];
            const said = texts.map((t) => SAID.exec(t)?.[0]).find(Boolean) ?? '';
            note(`second: the bot said ${JSON.stringify(said)}; all it said: ${JSON.stringify(s.chats.map((x) => x.text))}`);
            check(Boolean(area), 'second: at the spawn the area "home" was saved (autoHome, D6)');
            check(area?.type === 'home' && area?.source === 'auto', 'second: the area is of type home and has the source auto', `${area?.type} ${area?.source}`);
            check(covers(area, b.house.box), 'second: the box of the area holds the house', `area ${JSON.stringify(area && { min: area.min, max: area.max })}, house ${JSON.stringify(b.house.box)}`);
            check(Boolean(said), 'second: the bot says "I saved your house as the area "home": X x Y x Z blocks, N door(s). Tell me if that is wrong." (D6)', JSON.stringify(said));
            const m = SAID.exec(said);
            if (m && area) {
                const size = [area.max.x - area.min.x + 1, area.max.y - area.min.y + 1, area.max.z - area.min.z + 1];
                check(Number(m[1]) === size[0] && Number(m[2]) === size[1] && Number(m[3]) === size[2], 'second: the size in the text is the size of the saved box', `text ${m.slice(1, 4).join(' x ')}, box ${size.join(' x ')}`);
                check(Number(m[4]) >= 1, 'second: the text counts the door of the house', m[4]);
            }
            emitData('area', area);
            check(s.killed === null, 'second: the process lives', String(s.killed));
            check(s.realCalls.length === 0, 'second: no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
        }
    },

    async main() {
        check(env.world === 'base', 'precondition: the scenario runs in the base world', env.world);
        await prepareRegion(r, 30);
        try {
            await buildBase(b);
            await runPhase(SELF, 'first', {}, 120000);
            const areasFiles = listFiles(path.join('bots', NAME)).filter((f) => /(^|\/)areas\.json$/.test(f));
            const before = areasFiles.length ? JSON.parse(fs.readFileSync(path.join('bots', NAME, areasFiles[0]), 'utf8')) : null;
            note(`after the first start: areas.json ${JSON.stringify(before)}`);
            const res = await runPhase(SELF, 'second', {}, 120000);
            const files = listFiles(path.join('bots', NAME)).filter((f) => /(^|\/)areas\.json$/.test(f));
            let json = null;
            try { json = JSON.parse(fs.readFileSync(path.join('bots', NAME, files[0] || 'none'), 'utf8')); } catch (e) { note('areas.json: ' + e.message); }
            const saved = JSON.stringify(json ?? {}).includes('"home"');
            check(saved, 'the area "home" is in areas.json of the world', JSON.stringify(json)?.slice(0, 300));
            note(`the area of the second start: ${JSON.stringify(res.data.area)}`);
        } finally {
            await releaseRegion(r);
        }
    },
});
exitSoon();
