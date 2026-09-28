// End-to-end test runner of release v0.1.4.3 (`npm run test:e2e`).
//
// Runs every scenario in its own child process, one after another. Each scenario gets a
// fresh temp directory (os.tmpdir()/mc-e2e-*) as working directory, with the coder
// templates copied into its bots/ folder; the directory is removed afterwards. The
// scenarios start a simulated Minecraft 1.21.8 server on 127.0.0.1 with a port chosen by
// the operating system. No other network is used.
//
// Usage:
//   node tests/e2e/run.js               all scenarios
//   node tests/e2e/run.js world sandbox only scenarios whose name contains one of the words
//   node tests/e2e/run.js --verbose     print the full output of every scenario
//
// Exit code: 0 only if every selected scenario passed.
import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { E2E_DIR, ROOT, makeTempDir, removeDir } from './helpers.js';

const SCENARIO_TIMEOUT_MS = 60000;

const SCENARIOS = [
    ['sandbox', 's1_sandbox.js'],
    ['world_identity', 's2_world_identity.js'],
    ['worlds_are_separate', 's3_worlds_are_separate.js'],
    ['dimension', 's4_dimension.js'],
    ['flag_off', 's5_flag_off.js'],
    ['legacy_adoption', 's6_legacy_adoption.js'],
    ['resume_policy', 's7_resume_policy.js'],
    ['reset_tool', 's8_reset_tool.js'],
    // v0.1.4.4 skills
    ['skill_capture', 's9_skill_capture.js'],
    ['skill_reuse', 's10_skill_reuse.js'],
    ['skill_sandbox', 's11_skill_sandbox.js'],
    ['skill_prompts_commands', 's12_skill_prompts_commands.js'],
    ['skill_flags_off', 's13_skill_flags_off.js'],
    ['skill_agent_start', 's14_skill_agent_start.js'],
    ['skill_partial_flags', 's15_skill_partial_flags.js'],
    // v0.1.4.5
    ['skill_guardrails', 's16_skill_guardrails.js'],
    ['playtest_fixes', 's17_playtest_fixes.js'],
];

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const words = args.filter((a) => !a.startsWith('-'));
const selected = SCENARIOS.filter(([name]) => words.length === 0 || words.some((w) => name.includes(w)));

function killTree(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
}

function repoBotsListing() {
    try { return fs.readdirSync(path.join(ROOT, 'bots')).sort().join(','); } catch { return '(missing)'; }
}

function runScenario(name, file) {
    return new Promise((resolve) => {
        const tmp = makeTempDir();
        const t0 = Date.now();
        const lines = [];
        const child = spawn(process.execPath, [path.join(E2E_DIR, file)], {
            cwd: tmp,
            env: { ...process.env, ANTHROPIC_API_KEY: 'placeholder-not-a-key', E2E_TMP: tmp },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            detached: process.platform !== 'win32',
        });
        const onLine = (line) => {
            lines.push(line);
            if (verbose) console.log(`  | ${line}`);
        };
        readline.createInterface({ input: child.stdout }).on('line', onLine);
        readline.createInterface({ input: child.stderr }).on('line', (l) => onLine('[stderr] ' + l));
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killTree(child);
        }, SCENARIO_TIMEOUT_MS);
        child.on('exit', (code, signal) => {
            clearTimeout(timer);
            setTimeout(() => {
                const ms = Date.now() - t0;
                let removed = false;
                try { removed = removeDir(tmp); } catch (e) { lines.push('cleanup error: ' + e.message); }
                resolve({ name, code, signal, timedOut, ms, lines, tmp, removed });
            }, 100);
        });
    });
}

const botsBefore = repoBotsListing();
const tStart = Date.now();
const outcomes = [];
console.log(`e2e v0.1.4.3: node ${process.version}, repository ${ROOT}, ${selected.length} scenario(s)`);
for (const [name, file] of selected) {
    const r = await runScenario(name, file);
    const checkLines = r.lines.filter((l) => /^(\s*\[\w+\] )?(CHECK|NOTE) /.test(l));
    const failedChecks = r.lines.filter((l) => /^(\s*\[\w+\] )?CHECK FAIL /.test(l));
    const pass = !r.timedOut && r.code === 0 && failedChecks.length === 0 && r.removed;
    let reason = '';
    if (r.timedOut) reason = `timeout after ${SCENARIO_TIMEOUT_MS / 1000} s, process tree killed`;
    else if (!r.removed) reason = `temp directory ${r.tmp} could not be removed`;
    else if (failedChecks.length) reason = failedChecks.map((l) => l.trim()).join('\n    ');
    else if (r.code !== 0) reason = `exit code ${r.code} ${r.signal || ''}`;
    if (!verbose) for (const l of checkLines) console.log(`    ${l}`);
    if (!pass && !verbose) {
        console.log('    --- last output lines ---');
        for (const l of r.lines.slice(-25)) console.log(`    | ${l}`);
    }
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name} (${(r.ms / 1000).toFixed(1)} s)${pass ? '' : '\n    reason: ' + reason}`);
    outcomes.push({ name, pass, ms: r.ms });
}

const botsAfter = repoBotsListing();
const leftovers = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('mc-e2e-'));
const hygieneOk = botsBefore === botsAfter;
if (!hygieneOk) console.log(`FAIL hygiene: repository bots/ changed: before [${botsBefore}] after [${botsAfter}]`);
if (leftovers.length) console.log(`NOTE mc-e2e-* directories in ${os.tmpdir()}: ${leftovers.join(', ')}`);

const failed = outcomes.filter((o) => !o.pass);
const total = ((Date.now() - tStart) / 1000).toFixed(1);
console.log(`SUMMARY ${outcomes.length - failed.length} passed, ${failed.length} failed` +
    `${failed.length ? ' (' + failed.map((f) => f.name).join(', ') + ')' : ''} in ${total} s`);
process.exitCode = failed.length === 0 && hygieneOk ? 0 : 1;
