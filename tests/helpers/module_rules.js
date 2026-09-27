// Import rules of the new modules of v0.1.4.3 (spec section 0: importable without side effects,
// no mineflayer, no model SDK).
import assert from 'node:assert/strict';
import path from 'node:path';
import { importsOf, isBuiltin, importInCleanProcess } from './hygiene.js';
import { describeRun } from './child.js';

// allowedRelative: basenames of project files the module may import; null means any project
// file outside src/models and src/utils/mcdata.js.
export function assertImportRules(relPath, { allowBuiltins = null, allowedRelative = null } = {}) {
    const imports = importsOf(relPath);
    assert.equal(imports.require, 0, 'no require()');
    for (const spec of imports.static) {
        if (spec.startsWith('.')) {
            assert.ok(!/models\/|mcdata/.test(spec), `${relPath} must not import ${spec}`);
            if (allowedRelative) assert.ok(allowedRelative.includes(path.posix.basename(spec)), `${relPath} must not import ${spec}`);
        } else {
            assert.ok(isBuiltin(spec), `${relPath} imports the package ${spec}; only node built-ins and project files are allowed`);
            if (allowBuiltins) {
                const name = spec.startsWith('node:') ? spec.slice(5) : spec;
                assert.ok(allowBuiltins.includes(name), `${relPath} must not import ${spec}`);
            }
        }
    }
}

export function assertCleanImport(relPath) {
    const { run, filesCreated } = importInCleanProcess(relPath);
    assert.equal(run.status, 0, describeRun(run));
    assert.equal(run.stdout, '', describeRun(run));
    assert.equal(run.stderr, '', describeRun(run));
    assert.deepEqual(filesCreated, []);
}
