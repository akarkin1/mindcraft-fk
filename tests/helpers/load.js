// Loads a project module for a test file.
//
// If the import fails (for example ERR_MODULE_NOT_FOUND because the module does
// not exist yet), the returned object is a proxy that rethrows the ORIGINAL import
// error as soon as any export is accessed. Every test that uses the module then
// fails individually with the real reason, instead of the whole file failing once.
import { repoUrl } from './paths.js';

// The Minecraft version the bot plays, the registry the unit tests load (v0.1.4.14: 26.1). A test about the history
// of an older version names that version itself, with a comment saying why.
export const TEST_MC_VERSION = '26.1';

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
