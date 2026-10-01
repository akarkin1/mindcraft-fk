// Texts of the job that the player reads (spec v0.1.4.10, I3), word for word where the spec gives them.
// Pure.
import { jobCommand } from './job_logic.js';

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function joinAnd(words) {
    if (words.length <= 1) {
        return words.join('');
    }
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function capital(text) {
    return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

// The words of the job (`the mining`), from the record or from its kind.
function wordsOf(job) {
    if (typeof job?.words === 'string' && job.words.length > 0) {
        return job.words;
    }
    return jobCommand(job?.kind)?.words ?? 'the job';
}

// `6 of 16 iron` for a job with a count, null without one.
function countText(job) {
    if (!isFiniteNumber(job?.wanted)) {
        return null;
    }
    const got = isFiniteNumber(job.got) ? job.got : 0;
    const thing = jobCommand(job.kind)?.thing(job.args) ?? null;
    return `${got} of ${job.wanted}${thing ? ` ${thing}` : ''}`;
}

/**
 * `I go back to the mining, 6 of 16 iron.`, without a count `I go back to the farming.`
 * @param {object} job
 * @returns {string}
 */
export function resumeText(job) {
    const count = countText(job);
    return count ? `I go back to ${wordsOf(job)}, ${count}.` : `I go back to ${wordsOf(job)}.`;
}

/**
 * `I leave the mining at 6 of 16 iron.`, without a count `I leave the farming.`
 * @param {object} job
 * @returns {string}
 */
export function leaveText(job) {
    const count = countText(job);
    return count ? `I leave ${wordsOf(job)} at ${count}.` : `I leave ${wordsOf(job)}.`;
}

/**
 * `I was mining iron, 6 of 16. I go on.`, without a count `I was farming. I go on.`
 * @param {object} job
 * @returns {string}
 */
export function restartText(job) {
    const verb = jobCommand(job?.kind)?.verb(job?.args) ?? 'working';
    if (!isFiniteNumber(job?.wanted)) {
        return `I was ${verb}. I go on.`;
    }
    return `I was ${verb}, ${isFiniteNumber(job.got) ? job.got : 0} of ${job.wanted}. I go on.`;
}

/**
 * `The mining is done: 16 iron.`, without a count `The farming is done.` The number is what the bot got;
 * when the skill said it is done (it counted itself), at least the wanted number.
 * @param {object} job
 * @returns {string}
 */
export function doneText(job) {
    const words = capital(wordsOf(job));
    if (!isFiniteNumber(job?.wanted)) {
        return `${words} is done.`;
    }
    const got = isFiniteNumber(job.got) ? job.got : 0;
    const n = job.skillDone === true ? Math.max(got, job.wanted) : got;
    const thing = jobCommand(job.kind)?.thing(job.args) ?? null;
    return `${words} is done: ${n}${thing ? ` ${thing}` : ''}.`;
}

// The word of a missing thing: `torches`, `pickaxe`, `stone pickaxe`, `wood`, `food`.
function blockerWord(blocker) {
    const b = isPlainObject(blocker) ? blocker : {};
    const item = typeof b.item === 'string' && b.item.length > 0 ? b.item.replace(/_/g, ' ') : null;
    switch (b.kind) {
        case 'no_torches':
            return 'torches';
        case 'no_wood':
            return 'wood';
        case 'no_pickaxe':
            return item ?? 'pickaxe';
        case 'no_tool':
            return item ?? 'tool';
        default:
            return item ?? 'supplies';
    }
}

// The word of the item of a step check in the plan text: `wood`, `planks`, `sticks`, `torches`, `a stone pickaxe`.
function planWord(check) {
    const item = typeof check?.item === 'string' ? check.item : null;
    if (item === null) {
        return null;
    }
    if (item === 'log' || item.endsWith('_log')) {
        return 'wood';
    }
    if (item === 'planks' || item.endsWith('_planks')) {
        return 'planks';
    }
    const plural = { stick: 'sticks', torch: 'torches', ladder: 'ladders' }[item];
    if (plural) {
        return plural;
    }
    if (!isFiniteNumber(check.count)) {
        return `a ${item.replace(/_/g, ' ')}`;
    }
    return item;
}

// `16 sticks`, `1 torch`, `4 logs`, `a stone pickaxe` for the step text.
function countWord(check) {
    const item = typeof check?.item === 'string' ? check.item : null;
    if (item === null) {
        return 'done';
    }
    if (!isFiniteNumber(check.count)) {
        return `a ${item.replace(/_/g, ' ')}`;
    }
    const n = check.count;
    const plural = { stick: 'sticks', torch: 'torches', ladder: 'ladders', log: 'logs' }[item];
    return `${n} ${n !== 1 && plural ? plural : item}`;
}

/**
 * `I have no torches. I get wood, planks, sticks and torches, then I go on.` The steps as the items of
 * their checks, each once.
 * @param {{kind: string, item: string|null}} blocker
 * @param {{check: {item: string|null, count: number|null}}[]} steps
 * @returns {string}
 */
export function planText(blocker, steps) {
    const words = [];
    for (const step of Array.isArray(steps) ? steps : []) {
        const word = planWord(step?.check);
        if (word && !words.includes(word)) {
            words.push(word);
        }
    }
    const get = words.length > 0 ? joinAnd(words) : 'what I need';
    return `I have no ${blockerWord(blocker)}. I get ${get}, then I go on.`;
}

/**
 * `Step 2 of 4 done: 16 sticks.`
 * @param {number} i the number of the step, from 1
 * @param {number} n the number of steps
 * @param {{check: {item: string|null, count: number|null}}} step
 * @returns {string}
 */
export function stepText(i, n, step) {
    return `Step ${i} of ${n} done: ${countWord(step?.check)}.`;
}

/**
 * `I could not plan the steps for the torches. Tell me what to do.`
 * @param {{kind: string, item: string|null}} blocker
 * @returns {string}
 */
export function noPlanText(blocker) {
    return `I could not plan the steps for the ${blockerWord(blocker)}. Tell me what to do.`;
}

/**
 * `I have no job.`
 * @returns {string}
 */
export function noJobText() {
    return 'I have no job.';
}

/**
 * `I stop the mining: <text>`, when the same failure came 3 times in a row (spec section 5). A text
 * without an end gets a full stop.
 * @param {object} job
 * @param {string} text the text of the failure
 * @returns {string}
 */
export function stopText(job, text) {
    const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    const end = clean.length === 0 ? 'it fails again and again.' : (/[.!?]$/.test(clean) ? clean : `${clean}.`);
    return `I stop ${wordsOf(job)}: ${end}`;
}

/**
 * The line of the knowledge block: `Job: the mining, 6 of 16 iron, step 2 of 4.`; `Job: the farming.`;
 * `, paused` for a paused job. '' without a running or paused job.
 * @param {object|null} job
 * @returns {string}
 */
export function statusText(job) {
    if (!isPlainObject(job) || (job.state !== 'running' && job.state !== 'paused')) {
        return '';
    }
    const parts = [wordsOf(job)];
    const count = countText(job);
    if (count) {
        parts.push(count);
    }
    const steps = Array.isArray(job.steps) ? job.steps : [];
    const next = steps.findIndex(s => s?.state === 'todo');
    if (steps.length > 0 && next >= 0) {
        parts.push(`step ${next + 1} of ${steps.length}`);
    }
    if (job.state === 'paused') {
        parts.push('paused');
    }
    return `Job: ${parts.join(', ')}.`;
}
