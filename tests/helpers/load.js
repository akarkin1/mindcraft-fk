// Loads a project module for a test file.
//
// If the import fails (for example ERR_MODULE_NOT_FOUND because the module does
// not exist yet), the returned object is a proxy that rethrows the ORIGINAL import
// error as soon as any export is accessed. Every test that uses the module then
// fails individually with the real reason, instead of the whole file failing once.
import { repoUrl } from './paths.js';

export async function loadSrc(relPath) {
    try {
        return await import(repoUrl(relPath));
    } catch (importError) {
        return new Proxy({}, {
            get(_target, prop) {
                if (prop === 'then') return undefined; // not a thenable
                throw importError;
            },
            has() {
                throw importError;
            },
        });
    }
}
