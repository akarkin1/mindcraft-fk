// Replaces console.log/info/warn/error/debug with recorders, so tests stay quiet
// and can assert on what was logged. Always call restore().
import { format } from 'node:util';

const METHODS = ['log', 'info', 'warn', 'error', 'debug'];

export function captureConsole() {
    const originals = {};
    const records = [];
    for (const m of METHODS) {
        originals[m] = console[m];
        console[m] = (...args) => {
            records.push({ method: m, args, text: format(...args) });
        };
    }
    return {
        records,
        // All records of the given methods (default: all).
        of(...methods) {
            const wanted = methods.length ? methods : METHODS;
            return records.filter((r) => wanted.includes(r.method));
        },
        // Everything that was logged, one record per line.
        allText() {
            return records.map((r) => r.text).join('\n');
        },
        restore() {
            for (const m of METHODS) console[m] = originals[m];
        },
    };
}
