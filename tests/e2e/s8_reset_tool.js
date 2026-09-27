// S8 reset_tool: the real command line entry scripts/bot_reset.js runs as a child process with
// the temp directory as working directory, against a tree made by two world visits (as in S3).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, setupSettings, lockdown, createAgent, connectAgent,
    resolveWorld, quitBot, expectedSeedKey, runCommand, importProject, runPhase, listFiles, ROOT,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'e2e_reset';
const SEED_A = [-971403206, -1197705962];
const SEED_B = [123456789, -987654321];
const KEY_A = expectedSeedKey(...SEED_A);
const KEY_B = expectedSeedKey(...SEED_B);
const MEMORY_A = 'MEMORY-A for the reset test.';
const RESET = path.join(ROOT, 'scripts', 'bot_reset.js');

async function visit(seed, motd, steps) {
    const server = await startServer({ seedHigh: seed[0], seedLow: seed[1], motd });
    let agent = null;
    try {
        const settings = await setupSettings(NAME, server.port, { world_memory: true });
        await importProject('src/agent/commands/index.js');
        agent = await createAgent(NAME, { worldMemory: true });
        await lockdown(settings);
        await connectAgent(agent, settings, { worldMemory: true });
        const result = await resolveWorld(agent, true);
        note(`resolve ${JSON.stringify({ ...result, saveData: result.saveData ? '(object)' : null })}`);
        await steps(agent, result);
    } finally {
        if (agent) await quitBot(agent.bot);
        await server.stop();
    }
}

function snapshot() {
    const map = {};
    for (const f of listFiles('bots')) map[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join('bots', f))).digest('hex');
    return map;
}

function reset(...args) {
    const r = spawnSync(process.execPath, [RESET, ...args], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 15000 });
    const out = (r.stdout || '') + (r.stderr || '');
    for (const l of out.split(/\r?\n/)) if (l) console.log(`  [bot_reset ${args.join(' ')}] ${l}`);
    return { code: r.status, out };
}

await scenarioMain({
    async worldA() {
        await visit(SEED_A, 'World A', async (agent) => {
            check(await runCommand(agent, '!rememberHere("home")') === 'Location saved as "home".', 'A: home saved');
            await agent.history.add('e2e_player', 'hello A');
            agent.history.memory = MEMORY_A;
            check(await agent.history.save() === true, 'A: memory saved');
        });
    },
    async worldB() {
        await visit(SEED_B, 'World B', async (agent) => {
            check(await runCommand(agent, '!rememberHere("mine")') === 'Location saved as "mine".', 'B: mine saved');
            agent.history.memory = 'MEMORY-B';
            check(await agent.history.save() === true, 'B: memory saved');
        });
    },
    async worldAAgain() {
        await visit(SEED_A, 'World A', async (agent, result) => {
            const places = await runCommand(agent, '!savedPlaces');
            check(places === 'Saved places: none', 'after the reset: world A has no places', JSON.stringify(places));
            check(agent.history.memory === MEMORY_A, 'after the reset: world A still has its memory', JSON.stringify(agent.history.memory));
            check(typeof result.note === 'string' && result.note.endsWith('Saved places here: none.'), 'after the reset: note says no saved places',
                JSON.stringify(result.note));
        });
    },
    async main() {
        await runPhase(SELF, 'worldA');
        await runPhase(SELF, 'worldB');
        // a guard file directly in the bot directory, as a flag-on bot with a resumed goal has it
        fs.writeFileSync(path.join('bots', NAME, 'resume_guard.json'), JSON.stringify({ version: 1, prompt: 'x', resumes: [Date.now()] }));

        const before = snapshot();
        const placesA = `${NAME}/worlds/${KEY_A}/places.json`;
        check(before[placesA] && before[`${NAME}/worlds/${KEY_B}/places.json`], 'tree has places.json in both worlds', JSON.stringify(Object.keys(before)));

        let r = reset(NAME, '--places', '--world', 'World A', '--dry-run');
        check(r.code === 0 && r.out.includes(`worlds/${KEY_A}/places.json`) && !r.out.includes(`worlds/${KEY_B}/places.json`),
            '--dry-run exits 0 and plans only the places.json of world A', `exit ${r.code}`);
        check(JSON.stringify(snapshot()) === JSON.stringify(before), '--dry-run changes nothing on disk');

        r = reset(NAME, '--memory', '--world', 'World A', '--dry-run');
        check(r.code === 0 && r.out.includes(`worlds/${KEY_A}/memory.json`) && !r.out.includes('resume_guard.json'),
            '[M3] --memory --world moves only the memory of that world, not resume_guard.json of the bot directory', `exit ${r.code}`);

        r = reset('_archive', '--all', '--dry-run');
        check(r.code === 1, '[M3] the name _archive is refused', `exit ${r.code}`);

        r = reset(NAME, '--places', '--world', 'Nowhere', '--dry-run');
        check(r.code === 1, 'an unknown world is an error (exit 1)', `exit ${r.code}`);

        const countBefore = listFiles('bots').length;
        r = reset(NAME, '--places', '--world', 'World A');
        const after = snapshot();
        const countAfter = Object.keys(after).length;
        check(r.code === 0, '--places --world "World A" exits 0', `exit ${r.code}`);
        const gone = Object.keys(before).filter((f) => !(f in after));
        const added = Object.keys(after).filter((f) => !(f in before));
        const changed = Object.keys(before).filter((f) => f in after && before[f] !== after[f]);
        check(gone.length === 1 && gone[0] === placesA, 'exactly the places.json of world A left its place', JSON.stringify(gone));
        check(added.length === 1 && /^_archive\/e2e_reset-\d{8}-\d{6}\//.test(added[0]) && added[0].endsWith(`/worlds/${KEY_A}/places.json`)
            && after[added[0]] === before[placesA], 'it was moved unchanged into bots/_archive/<name>-<stamp>/worlds/<key>/places.json', JSON.stringify(added));
        check(changed.length === 0, 'no other file changed', JSON.stringify(changed));
        check(countBefore === countAfter, 'file count under bots/ equal before and after the reset', `${countBefore} -> ${countAfter}`);
        const index = JSON.parse(fs.readFileSync(path.join('bots', NAME, 'worlds', 'index.json'), 'utf8'));
        check(index.worlds?.[KEY_A] && index.worlds?.[KEY_B], 'both worlds stay in index.json');

        await runPhase(SELF, 'worldAAgain');
        note(`file count under bots/ after world A was joined again: ${listFiles('bots').length}`);
    },
});
