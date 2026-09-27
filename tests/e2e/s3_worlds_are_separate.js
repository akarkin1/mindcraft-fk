// S3 worlds_are_separate: one bot name visits world A, world B and world A again, each
// visit in a new process on the same temp directory. Real History (defer_storage), real
// MemoryBank, real WorldMemory, real commands.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, setupSettings, lockdown, createAgent, connectAgent,
    resolveWorld, quitBot, expectedSeedKey, runCommand, importProject, runPhase, emitData, readJson,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'e2e_sep';
const SEED_A = [-971403206, -1197705962];
const SEED_B = [123456789, -987654321];
const KEY_A = expectedSeedKey(...SEED_A);
const KEY_B = expectedSeedKey(...SEED_B);
const MEMORY_A = 'MEMORY-A: the chest with iron is next to the big oak.';
const MEMORY_B = 'MEMORY-B: the mine entrance is under the waterfall.';
const HOME_POS = '10.5,70,-20.5';

// One visit: start the server, build the agent as agent.js does with world_memory on,
// join, resolve with loadMemory true, then run the visit's own steps.
async function visit(serverOpts, steps) {
    const server = await startServer(serverOpts);
    let agent = null;
    try {
        const settings = await setupSettings(NAME, server.port, { world_memory: true });
        await importProject('src/agent/commands/index.js');
        agent = await createAgent(NAME, { worldMemory: true });
        await lockdown(settings);
        await connectAgent(agent, settings, { worldMemory: true });
        const result = await resolveWorld(agent, true);
        note(`resolve ${JSON.stringify({ ...result, saveData: result.saveData ? '(object)' : null })}`);
        await steps(agent, result, server);
    } finally {
        if (agent) await quitBot(agent.bot);
        await server.stop();
    }
}

await scenarioMain({
    async visitA1() {
        await visit({ seedHigh: SEED_A[0], seedLow: SEED_A[1], motd: 'World A', age: 5000, pos: HOME_POS }, async (agent, result) => {
            emitData('a1Date', new Date().toISOString().slice(0, 10));
            check(result.key === KEY_A && result.isNew === true, 'A1: world A is new', `${result.key} isNew=${result.isNew}`);
            const saved = await runCommand(agent, '!rememberHere("home")');
            check(saved === 'Location saved as "home".', 'A1: !rememberHere("home") reply', JSON.stringify(saved));
            await agent.history.add('e2e_player', 'hello in world A');
            await agent.history.add(NAME, 'Hi! I am in world A.');
            agent.history.memory = MEMORY_A;
            const ok = await agent.history.save();
            check(ok === true, 'A1: history.save() resolves true', String(ok));
        });
    },
    async visitB() {
        await visit({ seedHigh: SEED_B[0], seedLow: SEED_B[1], motd: 'World B', age: 700 }, async (agent, result) => {
            check(result.key === KEY_B && result.isNew === true && result.changedWorld === true, 'B: world B is new and a world change',
                `${result.key} isNew=${result.isNew} changedWorld=${result.changedWorld}`);
            check(result.note === 'You are in the world "World B". This is your first visit here: you have no memories and no saved places in this world.',
                'B: first visit note for World B', JSON.stringify(result.note));
            const places = await runCommand(agent, '!savedPlaces');
            check(places === 'Saved places: none', 'B: !savedPlaces lists no place', JSON.stringify(places));
            check(agent.history.memory === '', 'B: history.memory is empty', JSON.stringify(agent.history.memory));
            check(!agent.history.turns.some((t) => String(t.content).includes('world A')), 'B: no turn of world A in the history');
            const go = await runCommand(agent, '!goToRememberedPlace("home")');
            check(go.includes('No location named "home" saved.'), 'B: !goToRememberedPlace("home") does not know home', JSON.stringify(go));
            const saved = await runCommand(agent, '!rememberHere("mine")');
            check(saved === 'Location saved as "mine".', 'B: !rememberHere("mine") reply', JSON.stringify(saved));
            const longName = 'x'.repeat(65);
            const refused = await runCommand(agent, `!rememberHere("${longName}")`);
            check(refused === `Could not save the location "${longName}".`, '[M2] B: !rememberHere with a 65 character name is refused',
                JSON.stringify(refused));
            agent.history.memory = MEMORY_B;
            await agent.history.add('e2e_player', 'hello in world B');
            check(await agent.history.save() === true, 'B: history.save() resolves true');
        });
    },
    async visitA2() {
        const a1Date = process.env.E2E_A1_DATE;
        await visit({ seedHigh: SEED_A[0], seedLow: SEED_A[1], motd: 'World A', age: 9000 }, async (agent, result, server) => {
            check(result.key === KEY_A && result.isNew === false && result.changedWorld === true, 'A2: world A is known, world changed',
                `${result.key} isNew=${result.isNew} changedWorld=${result.changedWorld}`);
            const expectedNote = `You are in the world "World A". Your last visit was on ${a1Date}. Saved places here: home (overworld).`;
            check(result.note === expectedNote, 'A2: known world note names home with its dimension and the last visit date',
                `got ${JSON.stringify(result.note)} expected ${JSON.stringify(expectedNote)}`);
            check(agent.history.turns.some((t) => t.role === 'system' && t.content === result.note), 'A2: note added to the history as a system turn');
            check(agent.history.memory === MEMORY_A, 'A2: history.memory is the text of step 1', JSON.stringify(agent.history.memory));
            check(result.saveData && result.saveData.memory === MEMORY_A, 'A2: saveData carries the memory of world A');
            check(agent.history.turns.some((t) => t.content === 'e2e_player: hello in world A')
                && !agent.history.turns.some((t) => String(t.content).includes('world B')), 'A2: turns of world A loaded, none of world B');
            const places = await runCommand(agent, '!savedPlaces');
            check(places === 'Saved places: home (overworld)', 'A2: !savedPlaces lists home only', JSON.stringify(places));
            const goMine = await runCommand(agent, '!goToRememberedPlace("mine")');
            check(goMine.includes('No location named "mine" saved.'), 'A2: the place mine of world B is absent', JSON.stringify(goMine));
            const before = agent.bot.entity.position.clone();
            const go = await runCommand(agent, '!goToRememberedPlace("home")');
            const chats = await server.chats();
            check(!go.includes('No location named') && go.includes('Teleported to 10.5, 70, -20.5'),
                'A2: !goToRememberedPlace("home") finds the place of step 1', JSON.stringify(go));
            check(chats.includes('/tp @s 10.5 70 -20.5'), 'A2: the server received the move to the saved coordinates',
                `${JSON.stringify(chats)} (bot was at ${before})`);
        });
    },
    async main() {
        const a1 = await runPhase(SELF, 'visitA1');
        await runPhase(SELF, 'visitB');
        await runPhase(SELF, 'visitA2', { E2E_A1_DATE: a1.data.a1Date || 'unknown' });

        const botDir = path.join('bots', NAME);
        const worlds = fs.readdirSync(path.join(botDir, 'worlds')).sort();
        check(JSON.stringify(worlds) === JSON.stringify([KEY_A, KEY_B, 'index.json'].sort()),
            'disk: two world directories and index.json', JSON.stringify(worlds));
        const index = readJson(path.join(botDir, 'worlds', 'index.json'));
        check(Object.keys(index.worlds || {}).sort().join() === [KEY_A, KEY_B].sort().join(),
            'disk: index.json has two entries', JSON.stringify(Object.keys(index.worlds || {})));
        check(index.worlds?.[KEY_A]?.visits === 2 && index.worlds?.[KEY_B]?.visits === 1 && index.last_key === KEY_A,
            'disk: visits 2 and 1, last_key is world A', JSON.stringify({ a: index.worlds?.[KEY_A]?.visits, b: index.worlds?.[KEY_B]?.visits, last: index.last_key }));
        check(index.worlds?.[KEY_A]?.label === 'World A' && index.worlds?.[KEY_B]?.label === 'World B', 'disk: labels of both worlds');
        for (const [key, mem, place, other] of [[KEY_A, MEMORY_A, 'home', 'mine'], [KEY_B, MEMORY_B, 'mine', 'home']]) {
            const dir = path.join(botDir, 'worlds', key);
            const m = fs.existsSync(path.join(dir, 'memory.json')) ? readJson(path.join(dir, 'memory.json')) : null;
            const p = fs.existsSync(path.join(dir, 'places.json')) ? readJson(path.join(dir, 'places.json')) : null;
            check(m && m.memory === mem, `disk: ${key}/memory.json holds its own memory`, JSON.stringify(m && m.memory));
            check(p && p.places && Object.keys(p.places).join() === place && p.places[place].dimension === 'overworld',
                `disk: ${key}/places.json holds only ${place} (not ${other})`, JSON.stringify(p));
            check(fs.existsSync(path.join(dir, 'histories')), `disk: ${key}/histories exists`);
        }
        check(!fs.existsSync(path.join(botDir, 'memory.json')), 'disk: no memory.json directly in the bot directory');
    },
});
