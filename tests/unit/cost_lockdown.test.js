// Spec v0.1.4.6 C1 and C3 under the SES lockdown of src/agent/library/lockdown.js.
//
// The bot locks the realm down after its modules are imported. The lockdown is global and
// permanent, so each scenario runs in its own child process with an empty temp directory as its
// working directory. The child prints its facts as a RESULT line; this file asserts.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { repoUrl } from '../helpers/paths.js';
import { runNodeModuleSource, describeRun, RESULT_PREFIX } from '../helpers/child.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';

const cwd = makeTmpDir();
after(() => removeTmpDir(cwd));

// importFirst: the cost modules are imported before lockdown() (as in the bot), otherwise after it.
function scenarioSource(importFirst) {
    const url = (rel) => JSON.stringify(repoUrl(rel));
    const usageFile = JSON.stringify(path.join(cwd, importFirst ? 'first' : 'late', 'usage.json'));
    const importCost = `
        U = await import(${url('src/agent/cost/usage_context.js')});
        M = await import(${url('src/agent/cost/cost_meter.js')});`;
    return `
        import fs from 'node:fs';
        const L = await import(${url('src/agent/library/lockdown.js')});
        let U;
        let M;
        ${importFirst ? importCost : ''}
        L.lockdown();
        ${importFirst ? '' : importCost}
        const facts = { locked: L.isLockedDown(), promiseFrozen: Object.isFrozen(Promise.prototype) };
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let clock = Date.UTC(2026, 8, 28, 10, 0, 0);
        const said = [];
        const meter = new M.CostMeter({
            settings: { cost_warn_per_hour: 3, cost_limit_per_hour: 8, cost_limit_per_session: 2 },
            now: () => clock,
            filePath: ${usageFile},
            say: (text) => said.push(text),
            log: () => {},
        });
        U.setUsageSink((report) => meter.record(report));
        async function job(purpose, delay) {
            return U.withPurpose(purpose, async () => {
                await sleep(delay);
                U.reportUsage({ model: 'claude-haiku-4-5-20251001', input_tokens: 500000 });
                await Promise.resolve().then(() => sleep(delay));
                await new Promise((resolve) => setTimeout(() => {
                    U.reportUsage({ model: 'claude-haiku-4-5-20251001', input_tokens: 500000, output_tokens: 0 });
                    resolve();
                }, 1));
                return U.currentPurpose();
            });
        }
        facts.results = await Promise.all([job('chat', 12), job('coding', 1)]);
        facts.outside = U.currentPurpose();
        facts.totals = meter.totals();
        facts.state = meter.check();
        facts.allowsCoding = meter.allows('coding');
        facts.line = meter.reportLine();
        facts.said = said;
        facts.flushed = meter.flush();
        facts.file = JSON.parse(fs.readFileSync(${usageFile}, 'utf8'));
        U.setUsageSink(() => { throw new Error('sink broke'); });
        try { U.reportUsage({ model: 'x' }); facts.sinkThrowCaught = true; } catch { facts.sinkThrowCaught = false; }
        process.stdout.write(${JSON.stringify(RESULT_PREFIX)} + JSON.stringify(facts) + '\\n');
    `;
}

function runScenario(importFirst) {
    const proc = runNodeModuleSource(scenarioSource(importFirst), { cwd });
    let result = null;
    for (const line of proc.stdout.split(/\r?\n/)) {
        if (line.startsWith(RESULT_PREFIX)) result = JSON.parse(line.slice(RESULT_PREFIX.length));
    }
    assert.equal(proc.status, 0, describeRun(proc));
    assert.ok(result, `no RESULT line\n${describeRun(proc)}`);
    return result;
}

for (const importFirst of [true, false]) {
    const label = importFirst ? 'imported before lockdown()' : 'imported after lockdown()';
    describe(`cost modules ${label}`, () => {
        const facts = runScenario(importFirst);

        test('precondition: the realm is locked down', () => {
            assert.equal(facts.locked, true);
            assert.equal(facts.promiseFrozen, true);
        });

        test('withPurpose keeps the purpose of each of two concurrent calls', () => {
            assert.deepEqual(facts.results, ['chat', 'coding']);
            assert.equal(facts.outside, 'other');
            assert.deepEqual(facts.totals.by_purpose, {
                chat: { calls: 2, dollars: 1, input_tokens: 1_000_000, output_tokens: 0 },
                coding: { calls: 2, dollars: 1, input_tokens: 1_000_000, output_tokens: 0 },
            });
        });

        test('reportUsage reaches the CostMeter, which counts and applies the budget', () => {
            assert.equal(facts.totals.calls, 4);
            assert.equal(facts.totals.dollars, 2);
            assert.equal(facts.state, 'saving');
            assert.equal(facts.allowsCoding, false);
            assert.deepEqual(facts.said, ['I reached the cost limit ($2.00 in this session). I stop working on goals by myself and writing new code. Chat and commands still work.']);
            assert.equal(facts.line, 'Cost: session $2.00 (chat $1.00, coding $1.00), 4 calls.');
        });

        test('flush writes usage.json, a throwing sink is caught', () => {
            assert.equal(facts.flushed, true);
            assert.equal(facts.file.version, 1);
            assert.equal(facts.file.sessions.length, 1);
            assert.equal(facts.file.sessions[0].calls, 4);
            assert.equal(facts.sinkThrowCaught, true);
        });
    });
}
