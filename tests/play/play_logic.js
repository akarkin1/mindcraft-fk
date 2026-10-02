// The pure part of the play test (`npm run test:play`, release v0.1.4.10, spec I7 T4): the arguments, the api of
// a model and the name of its key, the sentences of the player with the world fact each one must bring, and the
// table. No files, no network, no output.
export const PLAYER = 'w_player';
export const BOT = 'w_play';
export const DEFAULT_PROFILE = 'profiles/claude.json';
// The usage the fake model reports per call (as the Claude adapter would), so that the cost meter runs with --fake.
export const FAKE_USAGE = Object.freeze({ input_tokens: 3000, output_tokens: 40 });

export const USAGE = [
    'Usage: npm run test:play -- [--profile <file>] [--fake] [--verbose]',
    `  --profile <file>  the profile with the chat model (default ${DEFAULT_PROFILE})`,
    '  --fake            a fake model that answers each sentence with the command of the journeys; no key, no cost',
    '  --verbose         print every line of the bot',
    'The player says the sentences of the journeys W80 and W84 in plain words; the chat model of the profile chooses',
    'the commands. It costs money: about 10 cents with Luna. It needs the key of the model in the environment.',
].join('\n');

/**
 * The arguments of the play test.
 * @param {string[]} argv
 * @returns {{ok: true, fake: boolean, profile: string, verbose: boolean}|{ok: false, reason: string, help?: boolean}}
 */
export function parseArgs(argv) {
    const list = (Array.isArray(argv) ? argv : []).map(String);
    const a = { fake: false, profile: DEFAULT_PROFILE, verbose: false };
    for (let i = 0; i < list.length; i++) {
        const flag = list[i];
        if (flag === '--help' || flag === '-h') return { ok: false, help: true, reason: USAGE };
        if (flag === '--fake') a.fake = true;
        else if (flag === '--verbose') a.verbose = true;
        else if (flag === '--profile') {
            const v = list[++i];
            if (!v || v.startsWith('--')) return { ok: false, reason: '--profile needs a file' };
            a.profile = v;
        } else return { ok: false, reason: `unknown argument ${flag}` };
    }
    return { ok: true, ...a };
}

// The environment variable of the key of each api (the getKey calls of src/models); null: a local model, no key.
export const KEY_OF_API = Object.freeze({
    anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', azure: 'AZURE_OPENAI_API_KEY', google: 'GEMINI_API_KEY',
    xai: 'XAI_API_KEY', mistral: 'MISTRAL_API_KEY', deepseek: 'DEEPSEEK_API_KEY', qwen: 'QWEN_API_KEY',
    openrouter: 'OPENROUTER_API_KEY', groq: 'GROQCLOUD_API_KEY', cerebras: 'CEREBRAS_API_KEY', glhf: 'GHLF_API_KEY',
    huggingface: 'HUGGINGFACE_API_KEY', hyperbolic: 'HYPERBOLIC_API_KEY', mercury: 'MERCURY_API_KEY',
    novita: 'NOVITA_API_KEY', replicate: 'REPLICATE_API_KEY', ollama: null, lmstudio: null, vllm: null,
});

/**
 * The api of the chat model of a profile, as selectAPI of src/models/_model_map.js chooses it: the `api` of the
 * model, a prefix "<api>/", or the family in the name. null when it cannot be told.
 * @param {object} profile
 * @returns {string|null}
 */
export function apiOf(profile) {
    const m = profile?.model;
    const spec = typeof m === 'string' ? { model: m } : (m && typeof m === 'object' ? m : null);
    if (!spec) return null;
    if (typeof spec.api === 'string' && spec.api) return spec.api.includes('local') ? 'ollama' : spec.api;
    const name = String(spec.model ?? '');
    if (name.includes('local')) return 'ollama';
    const prefix = Object.keys(KEY_OF_API).find((api) => name.startsWith(api + '/') || name === api);
    if (prefix) return prefix;
    if (/gpt|o1|o3/.test(name)) return 'openai';
    if (name.includes('claude')) return 'anthropic';
    if (name.includes('gemini')) return 'google';
    if (name.includes('grok')) return 'xai';
    if (name.includes('mistral')) return 'mistral';
    if (name.includes('deepseek')) return 'deepseek';
    if (name.includes('qwen')) return 'qwen';
    return null;
}

// The name of the chat model of a profile, for the table.
export function modelName(profile) {
    const m = profile?.model;
    return typeof m === 'string' ? m : String(m?.model ?? m?.api ?? '?');
}

/**
 * Whether the play test may run with this profile and environment: { ok, key, api } or { ok: false, reason }.
 * Only whether the variable is set is looked at; its value is never read into a text.
 * @param {object} profile
 * @param {object} env process.env
 * @returns {{ok: boolean, reason?: string, key?: string|null, api?: string}}
 */
export function keyCheck(profile, env) {
    const api = apiOf(profile);
    if (!api || !(api in KEY_OF_API)) return { ok: false, reason: `the api of the model ${modelName(profile)} is not known` };
    const key = KEY_OF_API[api];
    if (key === null) return { ok: true, key: null, api };
    if (!env || typeof env[key] !== 'string' || env[key].trim() === '') {
        return { ok: false, reason: `${key} is not set in the environment: the chat model ${modelName(profile)} (${api}) needs it` };
    }
    return { ok: true, key, api };
}

// The steps: what the player says, where he goes, the command of the journeys (the fake answers with it) and the
// world fact that must hold, checked on the server and the files of the bot. `fact` names the check of play.js.
export const STEPS = Object.freeze([
    { id: 'home', say: 'this is home', expect: '!rememberArea', fake: '!rememberArea("home", "home")', fact: 'an area holds the middle of the house', ms: 60000 },
    { id: 'follow_down', say: 'follow me', expect: '!followPlayer', fake: `!followPlayer("${PLAYER}", 3)`, fact: 'the bot followed down the ladder into the basement', ms: 60000 },
    { id: 'route', say: 'remember the path here', expect: '!rememberRoute', fake: '!rememberRoute("basement")', fact: 'routes.json has a way with a ladder', ms: 30000 },
    { id: 'come_up', say: 'come here', expect: '!goToPlayer', fake: `!goToPlayer("${PLAYER}", 3)`, fact: 'the bot came up into the house', ms: 60000 },
    { id: 'basement', say: 'go to the basement', expect: '!goToRememberedPlace', fake: '!goToRememberedPlace("basement")', fact: 'the bot is in the basement', ms: 60000 },
    { id: 'follow_mine', say: 'follow me', expect: '!followPlayer', fake: `!followPlayer("${PLAYER}", 4)`, fact: 'the bot followed out, down both ladders and into the tunnel', ms: 60000 },
    { id: 'mine', say: 'this is the mine', expect: '!rememberMine', fake: '!rememberMine("mine")', fact: 'mines.json has a mine of the player', ms: 30000 },
    { id: 'iron', say: 'find some iron', expect: '!mineOre', fake: '!mineOre("iron", 4)', fact: 'the bot carries 4 raw_iron', ms: 300000 },
]);

/**
 * The first command in a text of the model ("Following you! !followPlayer("w_player")" -> '!followPlayer').
 * @param {string} text
 * @returns {string|null}
 */
export function commandIn(text) {
    const m = /!([a-zA-Z]\w*)/.exec(String(text ?? ''));
    return m ? `!${m[1]}` : null;
}

/**
 * The row of a step: { say, chose, expect, fact, pass, detail, dollars, calls }.
 * @returns {object}
 */
export function rowOf(step, { chose = null, pass = false, detail = '', dollars = 0, calls = 0, skipped = false } = {}) {
    return { id: step.id, say: step.say, chose, expect: step.expect, fact: step.fact, pass: skipped ? null : Boolean(pass), detail, dollars, calls };
}

const cell = (s) => String(s).replace(/\|/g, '/').replace(/\s+/g, ' ');

/**
 * The table of the play test and the lines under it.
 * @param {object[]} rows of rowOf
 * @param {{fake?: boolean, model?: string, costLine?: string|null}} [info]
 * @returns {string}
 */
export function formatTable(rows, { fake = false, model = '?', costLine = null } = {}) {
    const head = ['Sentence', 'Command chosen', 'Journeys', 'Fact', 'Result', 'Cost'];
    const out = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
    for (const r of rows) {
        const result = r.pass === null ? 'not run' : r.pass ? 'pass' : 'FAIL';
        const calls = r.calls ?? 0;
        const cost = `$${(r.dollars ?? 0).toFixed(3)}, ${calls} call${calls === 1 ? '' : 's'}`;
        out.push(`| "${cell(r.say)}" | ${cell(r.chose ?? 'none')} | ${cell(r.expect)} | ${cell(r.fact)}${r.detail ? `: ${cell(r.detail)}` : ''} | ${result} | ${cost} |`);
    }
    const passed = rows.filter((r) => r.pass === true).length;
    out.push('');
    out.push(`${passed} of ${rows.length} facts hold. The model: ${fake ? `a fake that answers with the commands of the journeys; its cost is of a made-up usage of ${FAKE_USAGE.input_tokens} tokens in and ${FAKE_USAGE.output_tokens} out per call` : model}.`);
    out.push(costLine ? costLine : 'No cost line: the cost meter is off.');
    return out.join('\n');
}
