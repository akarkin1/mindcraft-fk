// Paths shared by the unit tests.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Repository root: tests/helpers/../..
export const REPO_ROOT = path.resolve(here, '..', '..');
export const FIXTURES_DIR = path.resolve(here, '..', 'fixtures');

// Absolute path of a file given relative to the repository root ('src/utils/x.js').
export function repoPath(relPath) {
    return path.join(REPO_ROOT, ...relPath.split('/'));
}

// file:// URL of a file given relative to the repository root, for dynamic import().
export function repoUrl(relPath) {
    return pathToFileURL(repoPath(relPath)).href;
}
