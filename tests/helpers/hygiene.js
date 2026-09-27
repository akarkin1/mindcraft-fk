// Checks for the global rule "New modules must be importable without side effects
// and must not import mineflayer or any model SDK" plus the per-module import rules.
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import { repoPath, repoUrl } from './paths.js';
import { makeTmpDir, removeTmpDir, listDir } from './tmp.js';
import { runNodeModuleSource } from './child.js';

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

// Returns { static: [specifiers], dynamic: n, require: n } for a source file.
export function importsOf(relPath) {
    const source = stripComments(fs.readFileSync(repoPath(relPath), 'utf8'));
    const specs = [];
    const staticRe = /^\s*import\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
    const reexportRe = /^\s*export\s+(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/gm;
    for (const re of [staticRe, reexportRe]) {
        let m;
        while ((m = re.exec(source)) !== null) specs.push(m[1]);
    }
    const dynamic = (source.match(/\bimport\s*\(/g) || []).length;
    const require = (source.match(/\brequire\s*\(/g) || []).length;
    return { static: specs, dynamic, require };
}

export function isBuiltin(spec) {
    const name = spec.startsWith('node:') ? spec.slice(5) : spec;
    return builtinModules.includes(name) || builtinModules.includes(name.split('/')[0]);
}

// Imports the module in a fresh process whose working directory is an empty temp
// directory. Returns { run, filesCreated }.
export function importInCleanProcess(relPath) {
    const cwd = makeTmpDir();
    try {
        const run = runNodeModuleSource(`await import(${JSON.stringify(repoUrl(relPath))});`, { cwd });
        return { run, filesCreated: listDir(cwd) };
    } finally {
        removeTmpDir(cwd);
    }
}
