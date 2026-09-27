// Builds and inspects small directory trees for tests.
import fs from 'node:fs';
import path from 'node:path';

// Creates files under root. spec: { 'a/b.json': 'text' or object (written as JSON), 'dir/': null }.
// A key ending in '/' creates an empty directory.
export function writeTree(root, spec) {
    for (const [rel, content] of Object.entries(spec)) {
        const full = path.join(root, ...rel.split('/').filter(Boolean));
        if (rel.endsWith('/')) {
            fs.mkdirSync(full, { recursive: true });
            continue;
        }
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const text = typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content, null, 2);
        fs.writeFileSync(full, text);
    }
}

// All files (not directories) below root, as sorted paths relative to root with '/' separators.
export function listFiles(root) {
    const out = [];
    const walk = (dir, prefix) => {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const rel = prefix ? `${prefix}/${e.name}` : e.name;
            if (e.isDirectory()) walk(path.join(dir, e.name), rel);
            else out.push(rel);
        }
    };
    walk(root, '');
    return out.sort();
}

// Map of relative file path -> content (utf8) for every file below root.
export function snapshot(root) {
    const map = {};
    for (const rel of listFiles(root)) map[rel] = fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
    return map;
}

// Path of p relative to base with '/' separators ('' when equal). Both are resolved first.
export function relSlash(base, p) {
    return path.relative(path.resolve(base), path.resolve(p)).split(path.sep).join('/');
}

export function samePath(a, b) {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
