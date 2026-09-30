// S17 playtest_fixes (v0.1.4.5, part "play test fixes"): the fixes checked with the real parts.
// kicked   a real agent process (Agent.start on the simulated server) is kicked with a reason in
//          the NBT form of Minecraft 1.21 (translate multiplayer.disconnect.invalid_player_movement).
//          The process prints "Disconnected: multiplayer.disconnect.invalid_player_movement",
//          never "[object Object]", prints "Agent process ends with exit code 1: ..." and exits
//          with code 1.
// agent    !craftRecipe("farmland", 15) through the real command execution answers that the item
//          has no crafting recipe and throws nothing. Then the real unstuck mode: a saved skill
//          waits (run with !useSkill, which does not pause the mode) on a stone floor that the fake
//          server sends (without chunks mineflayer runs no physics and the pathfinder can neither
//          move nor stop, so the move would never end and the kill timer would fire rightly). The
//          clock of the process is moved 25 s forward so the mode finds the bot stuck, it starts
//          moveAway, !stop interrupts it (the move ends short of its 5 blocks, without "I'm free."), and
//          the process is still alive 11 s later (the kill timer of 10 s was cleared). Date.now can only be moved without the SES lockdown, so this
//          phase runs with sandbox_lockdown false.
// main     text to speech without sound: systemSpeechCommand builds a command without the text for
//          a hostile text (win32, darwin, linux); speak.js starts no shell; on Windows the real
//          PowerShell script runs with volume 0 and output to null and gets the hostile text
//          through the environment: the canary files the text tries to create do not appear.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, startServer, startRealAgent, stopRealAgent, exitSoon, runCommand, runPhase,
    importProject, withTimeout, sleep, recordConsole, MODES_OFF, ROOT,
} from './helpers.js';

const SELF = fileURLToPath(import.meta.url);
const KICK_KEY = 'multiplayer.disconnect.invalid_player_movement';
const KICK_REASON = { type: 'compound', name: '', value: { translate: { type: 'string', value: KICK_KEY } } };

async function ttsChecks() {
    const { systemSpeechCommand } = await importProject('src/agent/speak.js');
    const canaries = ['canary_a.txt', 'canary_b.txt', 'canary_c.txt', 'canary_d.txt'].map((f) => path.resolve(f));
    const hostile = `hello'); New-Item -ItemType File -Force -Path '${canaries[0]}'; ('`
        + ` $(New-Item -ItemType File -Force -Path '${canaries[1]}')`
        + ` " & echo pwned > "${canaries[2]}" & "`
        + `\n; New-Item -ItemType File -Force -Path '${canaries[3]}'\t\`$x`;
    const clean = hostile.replace(/[\n\t]/g, ' ');

    const win = systemSpeechCommand(hostile, 'win32');
    const script = win.args?.[3] ?? '';
    check(win.command === 'powershell' && JSON.stringify(win.args.slice(0, 3)) === JSON.stringify(['-NoProfile', '-NonInteractive', '-Command']),
        'TTS win32: powershell with a fixed script', JSON.stringify(win.args?.slice(0, 3)));
    check(script.includes('$s.Speak($env:MINDCRAFT_TTS_TEXT)') && !/hello|New-Item|canary|pwned/i.test(script),
        'TTS win32: the script reads the text from the environment and does not contain it', script);
    check(win.env?.MINDCRAFT_TTS_TEXT === clean, 'TTS win32: the text goes into the environment of the child, line breaks and tabs as spaces');
    for (const [platform, command] of [['darwin', 'say'], ['linux', 'espeak']]) {
        const c = systemSpeechCommand(hostile, platform);
        check(c.command === command && JSON.stringify(c.args) === JSON.stringify(['--', clean]) && Object.keys(c.env).length === 0,
            `TTS ${platform}: ${command} gets the text as one argument after --`, JSON.stringify(c));
    }
    const source = fs.readFileSync(path.join(ROOT, 'src', 'agent', 'speak.js'), 'utf8');
    const imports = /import\s*\{([^}]*)\}\s*from\s*'child_process'/.exec(source)?.[1].split(',').map((x) => x.trim()).sort();
    check(JSON.stringify(imports) === JSON.stringify(['execFile', 'spawn']) && !/\bexec\s*\(/.test(source) && !/execSync|spawnSync|shell\s*:/.test(source)
        && !/cmd\.exe|\/bin\/sh/.test(source),
    'TTS: speak.js starts no shell (only execFile and spawn, no exec, no shell option)', JSON.stringify(imports));

    if (process.platform !== 'win32') {
        note(`TTS: not on Windows (${process.platform}), the PowerShell script was not run`);
        return;
    }
    // the real script with volume 0 and output to null; it prints the length of the text it got
    const silent = script.replace('$s.Rate=2; ', '$s.Rate=2; $s.Volume=0; $s.SetOutputToNull(); ')
        + "; [Console]::Out.Write('LEN=' + $env:MINDCRAFT_TTS_TEXT.Length)";
    if (!silent.includes('$s.SetOutputToNull();')) {
        check(false, 'TTS win32: the silent variant of the script could be built (not run, it would play sound)', script);
        return;
    }
    const t0 = Date.now();
    const res = await new Promise((resolve) => {
        execFile(win.command, [...win.args.slice(0, 3), silent], { env: { ...process.env, ...win.env }, windowsHide: true, timeout: 30000 },
            (err, stdout, stderr) => resolve({ err, stdout: String(stdout), stderr: String(stderr) }));
    });
    note(`TTS win32: the silent script ran in ${Date.now() - t0} ms, stdout ${JSON.stringify(res.stdout)}${res.err ? ', error ' + res.err.message : ''}`);
    check(!res.err && res.stdout.includes('LEN=' + clean.length), 'TTS win32: the real script ran silently and got the whole hostile text as data',
        JSON.stringify(res.stderr.slice(0, 200)));
    const made = canaries.filter((f) => fs.existsSync(f));
    check(made.length === 0, 'TTS win32: none of the canary files that the text tries to create appeared', JSON.stringify(made));
}

await scenarioMain({
    async kicked() {
        const server = await startServer({ seedHigh: 17, seedLow: 9, motd: 'Kick World' });
        await startRealAgent('e2e_kicked', server.port, {});
        note('agent started, the server kicks it now');
        server.kick(KICK_REASON);
        await sleep(10000);
        check(false, 'the agent process ended within 10 s after the kick');
        process.exit(3);
    },
    async agent() {
        const NAME = 'e2e_unstuck';
        const logs = recordConsole('log');
        const realNow = Date.now;
        let offset = 0;
        Date.now = () => realNow() + offset;
        const server = await startServer({ seedHigh: 17, seedLow: 10, motd: 'Unstuck World', floor: '63' });
        let agent = null;
        try {
            const s = await startRealAgent(NAME, server.port, {
                sandbox_lockdown: false, allow_insecure_coding: true, skill_learning: true, skill_command: true,
                profile: { modes: { ...MODES_OFF, unstuck: true } },
            });
            agent = s.agent;

            // craftRecipe with an item that has no crafting recipe
            const craft = await withTimeout(runCommand(agent, '!craftRecipe("farmland", 15)'), 15000, 'craftRecipe');
            check(craft.includes('farmland is either not an item, or it does not have a crafting recipe!') && !/threw exception|TypeError/i.test(craft),
                '!craftRecipe("farmland", 15) answers that the item has no crafting recipe and throws nothing', JSON.stringify(craft));

            // unstuck: a long action, the bot does not move
            const running = runCommand(agent, '!useSkill("waitLong", "[60000]")');
            const t0 = realNow();
            while (!String(agent.bot.output).includes('waiting long') && realNow() - t0 < 10000) await sleep(20);
            check(agent.actions.executing && agent.actions.currentActionLabel === 'action:useSkill', 'unstuck: a long action is running');
            await sleep(900); // a few updates of the modes: the mode remembers the position
            offset += 25000;
            let stuckAt = null;
            while (realNow() - t0 < 15000) {
                if (String(agent.bot.modes.behavior_log).includes("I'm stuck!") && agent.actions.currentActionLabel === 'mode:unstuck') {
                    stuckAt = realNow();
                    break;
                }
                if (logs.some((l) => l.includes('Mode unstuck finished executing'))) break;
                await sleep(20);
            }
            check(String(agent.bot.modes.behavior_log).includes("I'm stuck!"), 'unstuck: the real unstuck mode found the bot stuck', JSON.stringify(agent.bot.modes.behavior_log));
            if (stuckAt !== null) {
                await sleep(300);
                const label = agent.actions.currentActionLabel;
                const stopped = await withTimeout(runCommand(agent, '!stop'), 15000, '!stop');
                note(`unstuck: !stop sent while "${label}" was running: ${JSON.stringify(stopped)}`);
            } else {
                note('unstuck: moveAway ended before !stop could be sent');
            }
            await withTimeout(running, 15000, 'the interrupted !useSkill').catch((e) => note(e.message));
            const finished = logs.find((l) => l.includes('Mode unstuck finished executing')) ?? '(no line)';
            const flat = finished.replace(/\s+/g, ' ');
            note(`unstuck: ${flat.slice(0, 220)}`);
            // v0.1.4.8 (part B): an interrupted walk ends quietly and moveAway says where it stopped ("Moved away
            // from (x, y, z) to (x, y, z)."); before, the stop showed as PathStopped. moveAway(5) of the escape that
            // ends short of its 5 blocks, without "I'm free.", was cut short by the stop.
            const moved = /Moved away from \((-?\d+), (-?\d+), (-?\d+)\) to \((-?\d+), (-?\d+), (-?\d+)\)/.exec(flat);
            const walked = moved ? Math.hypot(Number(moved[4]) - Number(moved[1]), Number(moved[6]) - Number(moved[3])) : null;
            const freeSaid = String(agent.bot.modes.behavior_log).includes("I'm free.");
            check(stuckAt !== null && (flat.includes('PathStopped') || (walked !== null && walked < 5)) && !freeSaid,
                'unstuck: !stop interrupted the move of the mode (moveAway(5) ended short of its 5 blocks, or with PathStopped, and the mode did not say "I\'m free.")',
                `${flat.slice(0, 160)}; walked ${walked === null ? '?' : walked.toFixed(1)} blocks; "I'm free." ${freeSaid}`);
            const tStop = realNow();
            await sleep(11500);
            const killed = logs.some((l) => l.includes('Agent process ends with exit code')) || logs.some((l) => l.includes("couldn't get unstuck"));
            check(!killed && realNow() - tStop >= 11000, 'unstuck: 11 s after the interrupted move the process is still running (the 10 s kill timer was cleared)');
            check(s.realCalls.length === 0, 'no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await stopRealAgent(agent);
            await server.stop();
        }
    },
    async main() {
        const k = await runPhase(SELF, 'kicked', {}, 40000, 1);
        check(k.lines.some((l) => l.includes('Disconnected: ' + KICK_KEY)), `kick: the agent process prints "Disconnected: ${KICK_KEY}"`,
            JSON.stringify(k.lines.filter((l) => l.includes('Disconnected')).slice(0, 3)));
        check(!k.lines.some((l) => l.includes('[object Object]')), 'kick: the output never contains [object Object]');
        const endLine = k.lines.find((l) => l.includes('Agent process ends with exit code 1: '));
        check(endLine !== undefined, 'kick: the agent process prints "Agent process ends with exit code 1: ..." before it exits', JSON.stringify(endLine));
        check(k.code === 1, 'kick: the agent process exits with code 1', String(k.code));

        const dir = path.join('bots', 'e2e_unstuck', 'skills');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'waitLong.js'), [
            'async function waitLong(bot, ms) {',
            '    /**',
            '     * Waits a long time without moving.',
            '     **/',
            "    log(bot, 'waiting long');",
            '    await skills.wait(bot, ms);',
            "    log(bot, 'waited long');",
            '    return true;',
            '}',
        ].join('\n') + '\n');
        await runPhase(SELF, 'agent', {}, 50000);

        await ttsChecks();
    },
});
exitSoon();
