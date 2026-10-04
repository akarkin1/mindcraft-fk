// A fake world for the job of src/agent/job/index.js, as the glue drives it (v0.1.4.13, part P): a fake agent, a
// fake clock, a fake model and a fake executeCommand that plays the glue (onCommand before, onResult after). The
// handlers are fake packs: command name -> (args, world) -> { result, gain }; a handler may call
// world.job.progress(n) as a pack calls ctx.job.progress(n).
import { loadSrc } from './load.js';

const J = await loadSrc('src/agent/job/index.js');

export const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);

/** The name and the args of a command text, enough for the commands of these tests. */
export function parseCommand(text) {
    const m = text.match(/^!(\w+)(?:\((.*)\))?$/);
    const args = m[2] ? m[2].split(/\s*,\s*/).map(a => (/^-?\d+$/.test(a) ? Number(a) : a === 'true' || a === 'false' ? a === 'true' : a.replace(/^"|"$/g, ''))) : [];
    return { name: `!${m[1]}`, args };
}

/**
 * The world: `run(text, by)` plays the glue for a command, `tick` and `job` are the job's, `said` the texts,
 * `ran` the commands run with who gave them, `prompts` the plan prompts, `inventory` the counts.
 * @param {{handlers?: object, answers?: (string|Error)[], settings?: object, hooks?: boolean}} [options] answers: the
 *   answers of the fake model, in order; hooks false plays a glue that gives no onCommand and onResult for a system order
 */
export function makeJobWorld({ handlers = {}, answers = [], settings = {}, hooks = true } = {}) {
    const w = { t: T0, said: [], ran: [], handlers, prompts: [], inventory: {}, agent: null, job: null, where: { underground: false }, chests: null };
    w.agent = {
        sayText: (text) => w.said.push(text),
        actions: { executing: false, currentActionLabel: '' },
        bot: { inventory: { items: () => Object.entries(w.inventory).map(([name, count]) => ({ name, count })) }, time: { timeOfDay: 1000 }, isSleeping: false },
        whereAmI: () => w.where,
        _workStores: () => ({ chests: w.chests === null ? null : { list: () => w.chests }, mines: null }),
    };
    w.store = new J.JobStore(null, { now: () => new Date(w.t) });
    w.run = async (text, by) => {
        const { name, args } = parseCommand(text);
        w.ran.push({ text, by });
        if (hooks || by !== 'system') {
            w.job.onCommand(name, args, by, text);
        }
        const handler = w.handlers[name];
        const out = handler ? await handler(args, w) : { result: { ok: true, reason: null, text: 'Done.' }, gain: {} };
        for (const [item, n] of Object.entries(out.gain ?? {})) {
            w.inventory[item] = (w.inventory[item] ?? 0) + n;
        }
        if (hooks || by !== 'system') {
            await w.job.onResult(name, out.result, out.gain ?? {});
        }
        return typeof out.result === 'object' && out.result !== null ? out.result.text : out.result;
    };
    w.job = J.createJob(w.agent, w.store, {
        settings: { job_resume_seconds: 60, idle_jobs: [], idle_jobs_minutes: 15, ...settings },
        now: () => w.t,
        executeCommand: (text, options) => w.run(text, options?.by),
        askModel: async (prompt) => {
            w.prompts.push(prompt);
            const answer = answers.shift();
            if (answer instanceof Error) {
                throw answer;
            }
            return answer ?? 'NONE';
        },
    });
    w.wait = (seconds) => {
        w.t += seconds * 1000;
    };
    return w;
}
