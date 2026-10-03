// The scorecard of play logs (release v0.1.4.10, spec I7 T1): one row per log and a total, then the commands
// chosen, most first; v0.1.4.11 (W8): then the failure texts of each log, most first.
//
//   node scripts/scorecard.js <log> [<log>...]
//
// | Log | Minutes | Processes | Ends | Orders | Without result | Calls | Cost | Stuck | Doors open |
// What each column counts is in scripts/scorecard_logic.js and in the README of the tests. The log is the console
// output of the bot (`npm start > play.log`, UTF-8 or the UTF-16 of PowerShell) or of a scenario of the world tests.
// Exit codes: 0 the table, 1 no log given or a log that cannot be read (one line says why).
/* global process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USAGE, decodeLog, parseLog, scorecard, totalRow, formatTable, formatFailures } from './scorecard_logic.js';

/**
 * @param {string[]} argv the arguments after the script name
 * @param {{read?: function(string): Buffer, log?: function(string): void}} [deps]
 * @returns {number} the exit code
 */
export function main(argv, { read = (file) => fs.readFileSync(file), log = (text) => console.log(text) } = {}) {
    const files = (Array.isArray(argv) ? argv : []).map(String);
    const bad = files.find((f) => f.startsWith('-'));
    if (files.length === 0 || bad !== undefined) {
        log(bad !== undefined && bad !== '--help' && bad !== '-h' ? `Unknown argument ${bad}. ${USAGE}` : USAGE);
        return 1;
    }
    const rows = [];
    for (const file of files) {
        let data;
        try {
            data = read(file);
        } catch (error) {
            log(`Cannot read ${file}: ${error?.code ?? error?.message ?? error}.`);
            return 1;
        }
        const { events } = parseLog(decodeLog(data));
        rows.push(...scorecard(events, { name: path.basename(file) }));
    }
    if (rows.length > 1) rows.push(totalRow(rows));
    log(formatTable(rows));
    log(formatFailures(rows));
    return 0;
}

function isMainModule() {
    if (!process.argv[1]) return false;
    const self = fileURLToPath(import.meta.url);
    const started = path.resolve(process.argv[1]);
    return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

if (isMainModule()) process.exitCode = main(process.argv.slice(2));
