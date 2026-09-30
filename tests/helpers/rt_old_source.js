// T1 of v0.1.4.9: loads a module of the repository as it was at an older revision (default the tag v0.1.4.8), so a
// test can prove that a switch off gives the behaviour of that release: the same input to the old and the new
// function gives the same output.
//
// loadOld(relPath, rev) reads the file and every file it imports by a relative path with `git show <rev>:<path>`
// (read only), writes them into a fresh temp directory with a package.json of type module, imports the module and
// removes the directory again. Only modules without bare imports (no packages) can be loaded this way. Returns null
// when git or the revision is not there (a checkout without tags); a test then skips. Any other failure throws.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './paths.js';
import { makeTmpDir, removeTmpDir } from './tmp.js';

const IMPORT = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|(?:^|\n)\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/g;

function show(rev, relPath) {
    return execFileSync('git', ['show', `${rev}:${relPath}`], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * True when the revision can be read with git.
 * @param {string} [rev]
 * @returns {boolean}
 */
export function oldSourceAvailable(rev = 'v0.1.4.8') {
    try {
        execFileSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: REPO_ROOT, stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * The module at relPath (from the repository root, with '/') as it was at `rev`, or null without the revision.
 * @param {string} relPath
 * @param {string} [rev]
 * @returns {Promise<object|null>}
 */
export async function loadOld(relPath, rev = 'v0.1.4.8') {
    if (!oldSourceAvailable(rev)) return null;
    const dir = makeTmpDir();
    try {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
        const seen = new Set();
        const queue = [relPath];
        while (queue.length > 0) {
            const file = queue.pop();
            if (seen.has(file)) continue;
            seen.add(file);
            const text = show(rev, file);
            const target = path.join(dir, ...file.split('/'));
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, text);
            for (const m of text.matchAll(IMPORT)) {
                const spec = m[1] ?? m[2];
                queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
            }
        }
        return await import(pathToFileURL(path.join(dir, ...relPath.split('/'))).href);
    } finally {
        removeTmpDir(dir);
    }
}
