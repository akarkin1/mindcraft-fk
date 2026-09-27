// Test runner for `npm test` and `npm run test:coverage` (spec S9).
//
// Node 20 does not expand glob patterns for `node --test`, so this script collects
// tests/unit/**/*.test.js itself and hands the explicit file list to the built-in
// runner. Each test file runs in its own process (node:test default).
//
// Usage:
//   node tests/run.js                      all unit tests
//   node tests/run.js --coverage           same, with the Node coverage report
//   node tests/run.js history keyword      only files whose path contains one of the words
//   node tests/run.js --test-name-pattern=quarantine   extra flags are passed to node
//
// Exit code: 0 only if every test passed, otherwise non-zero.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testsDir, '..');
const unitDir = path.join(testsDir, 'unit');

function collectTestFiles(dir) {
    let found = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return found;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found = found.concat(collectTestFiles(full));
        else if (entry.isFile() && entry.name.endsWith('.test.js')) found.push(full);
    }
    return found;
}

const args = process.argv.slice(2);
const coverage = args.includes('--coverage');
const rest = args.filter((a) => a !== '--coverage');
const nodeFlags = rest.filter((a) => a.startsWith('-'));
const toSlash = (p) => p.split(path.sep).join('/').split('\\').join('/');
const filters = rest.filter((a) => !a.startsWith('-')).map(toSlash);

let files = collectTestFiles(unitDir);
if (filters.length > 0) {
    files = files.filter((f) => filters.some((word) => toSlash(f).includes(word)));
}
if (files.length === 0) {
    console.error(`No test files found under ${unitDir}${filters.length ? ` matching ${filters.join(', ')}` : ''}.`);
    process.exit(1);
}

const nodeArgs = ['--test'];
if (!nodeFlags.some((f) => f.startsWith('--test-reporter'))) {
    // Readable per-test output also when stdout is not a terminal (default would be TAP).
    nodeArgs.push('--test-reporter=spec');
}
if (coverage) nodeArgs.push('--experimental-test-coverage');
nodeArgs.push(...nodeFlags);
nodeArgs.push(...files.map((f) => path.relative(repoRoot, f)));

console.log(`Running ${files.length} test file(s) with Node ${process.version}${coverage ? ' (coverage)' : ''}`);
const child = spawnSync(process.execPath, nodeArgs, { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
if (child.error) {
    console.error('Failed to start the Node test runner:', child.error);
    process.exit(1);
}
if (child.status === null) {
    console.error(`Node test runner was terminated by signal ${child.signal}.`);
    process.exit(1);
}
process.exit(child.status);
