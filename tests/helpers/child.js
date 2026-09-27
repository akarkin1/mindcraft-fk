// Runs a Node script in a separate process and parses its result line.
import { spawnSync } from 'node:child_process';

export const RESULT_PREFIX = 'RESULT ';

// Runs `node <script> ...args`. Returns { status, stdout, stderr, result }
// where `result` is the JSON of the last line starting with 'RESULT ' (or null).
export function runNodeScript(script, args = [], options = {}) {
    const proc = spawnSync(process.execPath, [script, ...args], {
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
        ...options,
    });
    const stdout = proc.stdout ?? '';
    const stderr = proc.stderr ?? '';
    let result = null;
    for (const line of stdout.split(/\r?\n/)) {
        if (line.startsWith(RESULT_PREFIX)) result = JSON.parse(line.slice(RESULT_PREFIX.length));
    }
    return { status: proc.status, signal: proc.signal, error: proc.error, stdout, stderr, result };
}

// Runs an inline ES module source with `node --input-type=module -e`.
export function runNodeModuleSource(source, options = {}) {
    const proc = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        encoding: 'utf8',
        timeout: 60_000,
        windowsHide: true,
        ...options,
    });
    return { status: proc.status, signal: proc.signal, error: proc.error, stdout: proc.stdout ?? '', stderr: proc.stderr ?? '' };
}

// Human readable dump for assertion messages.
export function describeRun(run) {
    return `status=${run.status} signal=${run.signal}\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`;
}
