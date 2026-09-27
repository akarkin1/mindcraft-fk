// Temporarily replaces a function of node:fs for the code under test.
//
// Works for every import style the implementation may use:
//   import fs from 'fs'              -> the patched property of the shared object
//   import * as fs / { renameSync }  -> synced with module.syncBuiltinESMExports()
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

export function patchFs(name, replacement) {
    const original = fs[name];
    if (typeof original !== 'function') throw new Error(`fs.${name} is not a function`);
    fs[name] = replacement(original);
    syncBuiltinESMExports();
    let restored = false;
    return function restore() {
        if (restored) return;
        restored = true;
        fs[name] = original;
        syncBuiltinESMExports();
    };
}

// An Error that looks like a failed fs call.
export function fsError(code, message = `${code}: simulated failure`) {
    const err = new Error(message);
    err.code = code;
    return err;
}
