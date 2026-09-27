// Fresh temp directories under os.tmpdir(), prefix 'mc-test-'.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-test-'));
}

// Removes a temp directory created by makeTmpDir. Refuses anything else.
export function removeTmpDir(dir) {
    if (!dir) return;
    const base = path.basename(dir);
    if (!base.startsWith('mc-test-') || path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir())) {
        throw new Error(`refusing to remove non-test directory: ${dir}`);
    }
    // Read-only files block deletion on Windows: make everything writable first.
    const makeWritable = (p) => {
        let st;
        try { st = fs.lstatSync(p); } catch { return; }
        try { fs.chmodSync(p, st.isDirectory() ? 0o777 : 0o666); } catch { /* ignore */ }
        if (st.isDirectory()) {
            for (const entry of fs.readdirSync(p)) makeWritable(path.join(p, entry));
        }
    };
    makeWritable(dir);
    fs.rmSync(dir, { recursive: true, force: true });
}

// Lists a directory, sorted, or [] if it does not exist.
export function listDir(dir) {
    try {
        return fs.readdirSync(dir).sort();
    } catch {
        return [];
    }
}
