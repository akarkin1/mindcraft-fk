// Routing check (spec v0.1.4.6 R7): do plain sentences of the player lead to the right command?
//
// For every sentence of tests/routing/sentences.json the script builds the real conversing prompt
// the way the agent does (a real Prompter with profiles/claude.json, its promptConvo, the command
// docs and the examples of the profile), with an empty memory and a fixed fake state for $STATS and
// $INVENTORY. It sends one request per sentence to the chat model of the profile and reads the first
// command of the answer. At the end it prints how many sentences led to an expected command and the
// cost of the run from the cost meter.
//
//   node scripts/routing_check.js --dry-run [--all-parts]   build the prompts, print their sizes and
//                                                           the estimated cost; sends nothing, needs no key
//   node scripts/routing_check.js [--all-parts]             the real run; needs ANTHROPIC_API_KEY
//
// Without --all-parts, the parts (player_rules, protected_areas, home_pack, cost_meter) are as in
// settings.js, and sentences of a part that is off are skipped. With --all-parts every part is on.
//
// The key is taken only from the environment variable ANTHROPIC_API_KEY (test-routing.ps1 sets it
// from the secret vault). The script runs in a fresh temporary working directory: src/utils/keys.js
// looks for a key file in the working directory when it is imported, and there is none there. The
// Prompter reads ./profiles/defaults/*.json and writes ./bots/<name>/last_profile.json relative to
// the working directory, so the default profiles are copied there; the directory is removed at the
// end. Nothing is written into the repository.
/* global process */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { format } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PART_COMMANDS, hiddenPartCommands, partIsOn } from '../tests/routing/commands.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE_PATH = 'profiles/claude.json';
const SENTENCES_PATH = 'tests/routing/sentences.json';
const PLAYER = 'steve';
const CHARS_PER_TOKEN = 4;
const OUTPUT_TOKENS_PER_ANSWER = 100;
// The Claude adapter needs some key to be constructed; in a dry run nothing is ever sent.
const DRY_RUN_KEY = 'dry-run-placeholder-not-a-key';
// What the Claude adapter answers when a request fails.
const MODEL_ERROR_ANSWER = 'My brain disconnected, try again.';

const USAGE = [
    'Usage: node scripts/routing_check.js [--dry-run] [--all-parts]',
    '  --dry-run    build the prompts and print their sizes and the estimated cost, send nothing',
    '  --all-parts  switch every part of this release on (player_rules, protected_areas, home_pack, cost_meter)',
    'Without --dry-run the key must be in the environment variable ANTHROPIC_API_KEY (see test-routing.ps1).',
].join('\n');

// ---------------------------------------------------------------- pure helpers (unit tested)

export function parseArgs(argv) {
    const result = { dryRun: false, allParts: false, help: false, unknown: [] };
    for (const arg of argv) {
        if (arg === '--dry-run') result.dryRun = true;
        else if (arg === '--all-parts') result.allParts = true;
        else if (arg === '--help' || arg === '-h') result.help = true;
        else result.unknown.push(arg);
    }
    return result;
}

// The settings of the run: a copy of settings.js with the profile, as main.js gives them to the
// agent, without prompt logs. With allParts every part switch and world_memory are on.
export function runSettings(fileSettings, profile, allParts) {
    const settings = JSON.parse(JSON.stringify(fileSettings));
    settings.profile = profile;
    settings.log_all_prompts = false;
    if (allParts) {
        for (const part of Object.keys(PART_COMMANDS)) settings[part] = true;
        settings.world_memory = true;
    }
    return settings;
}

// The blocked commands as Agent.start computes them: settings.blocked_actions, the world memory
// commands without world memory, the skill commands without their flags, the commands of every
// part that is off. skillFlags: the flags of the skill manager, or {} without one.
export function blockedFor(settings, skillFlags) {
    const blocked = [...(settings.blocked_actions ?? [])];
    if (!settings.world_memory) blocked.push('!forgetPlace', '!nameWorld');
    const flags = skillFlags ?? {};
    const manager = flags.capture || flags.reuse || flags.command ? flags : {};
    if (!manager.capture && !manager.reuse) blocked.push('!skills', '!forgetSkill', '!disableSkill', '!enableSkill');
    if (!manager.command) blocked.push('!useSkill');
    blocked.push(...hiddenPartCommands(settings));
    return [...new Set(blocked)];
}

// Every sentence with `run`: true when it has no part or its part is on.
export function planSentences(sentences, settings) {
    return sentences.map((entry) => ({ ...entry, run: entry.part === '' || partIsOn(settings, entry.part) }));
}

// The first command of an answer, found with the parser's containsCommand, or null.
export function firstCommand(answer, containsCommand) {
    if (typeof answer !== 'string') return null;
    try {
        return containsCommand(answer) ?? null;
    } catch {
        return null;
    }
}

export function summaryLine(passed, total) {
    const percent = total > 0 ? Math.round((100 * passed) / total) : 0;
    return `${passed} of ${total} sentences led to an expected command (${percent} percent).`;
}

export function estimateTokens(chars) {
    return Math.ceil(chars / CHARS_PER_TOKEN);
}

// Summary of a dry run. results: [{ say, chars }]. price and costOf come from the price table of
// the cost meter (src/agent/cost/price_table.js); without them the cost is unknown.
export function dryRunSummary(results, { model, price, costOf }) {
    if (results.length === 0) return ['Prompts: 0.'];
    const total = results.reduce((sum, r) => sum + r.chars, 0);
    const biggest = results.reduce((a, b) => (b.chars > a.chars ? b : a));
    const lines = [`Prompts: ${results.length}. Average size: ${Math.round(total / results.length)} characters. Biggest: ${biggest.chars} characters ("${biggest.say}").`];
    const input = results.reduce((sum, r) => sum + estimateTokens(r.chars), 0);
    const output = results.length * OUTPUT_TOKENS_PER_ANSWER;
    const dollars = price && typeof costOf === 'function'
        ? costOf({ model, input_tokens: input, output_tokens: output, cache_read_tokens: 0, cache_write_tokens: 0 }, price)
        : null;
    if (typeof dollars === 'number' && Number.isFinite(dollars)) {
        lines.push(`Estimated cost of a real run at the prices of ${model}: $${dollars.toFixed(2)} (${input} input tokens and ${output} output tokens, estimated with ${CHARS_PER_TOKEN} characters per token and ${OUTPUT_TOKENS_PER_ANSWER} output tokens per answer).`);
    } else {
        lines.push(`Estimated cost of a real run: unknown, no price for ${model}.`);
    }
    return lines;
}

// Rows of cells as text columns, two spaces apart, no spaces at the end of a line.
export function formatTable(rows) {
    const widths = [];
    for (const row of rows) row.forEach((cell, i) => { widths[i] = Math.max(widths[i] ?? 0, String(cell).length); });
    return rows.map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}

// ---------------------------------------------------------------- the fixed fake state

const pad = (text) => '\n' + text + '\n';

function fakeStats(modes) {
    const modeLines = Object.entries(modes ?? {}).map(([name, on]) => `- ${name}(${on ? 'ON' : 'OFF'})`);
    const stats = [
        'STATS',
        '- Position: x: 12.50, y: 64.00, z: -3.30',
        '- Gamemode: survival',
        '- Health: 20 / 20',
        '- Hunger: 17 / 20',
        '- Biome: plains',
        '- Weather: Clear',
        '- Time: Afternoon',
        '- Current Action: Idle',
        `- Nearby Human Players: ${PLAYER}`,
        '- Nearby Bot Players: None.',
        ['Agent Modes:', ...modeLines].join('\n'),
    ].join('\n') + '\n';
    const entities = ['NEARBY_ENTITIES', `- Human player: ${PLAYER}`, '- entities: 2 cow(s)', '- entities: 1 chicken(s)'].join('\n');
    const blocks = ['NEARBY_BLOCKS', '- grass_block', '- dirt', '- oak_log', '- oak_leaves', '- stone', '- oak_planks', '- oak_door',
        '- Block Below: grass_block', '- Block at Legs: air', '- Block at Head: air', '- First Solid Block Above Head: none'].join('\n');
    return pad(stats) + '\n' + pad(entities) + '\n' + pad(blocks);
}

const FAKE_INVENTORY = pad(['INVENTORY', '- oak_log: 12', '- oak_planks: 8', '- cobblestone: 34', '- bread: 6', '- apple: 3',
    '- wheat_seeds: 14', '- torch: 9', '- raw_iron: 5', '- stone_sword: 1', '- stone_pickaxe: 1', 'WEARING: Nothing'].join('\n'));

// ---------------------------------------------------------------- the run

function say(text = '') {
    process.stdout.write(text + '\n');
}

// Console output of the bot code is kept out of the table: log, info and debug are recorded per
// sentence (shown when a request fails), warn and error are collected and shown once at the end.
function quietConsole() {
    const original = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
    const recent = [];
    const warnings = [];
    for (const m of ['log', 'info', 'debug']) console[m] = (...args) => { recent.push(format(...args)); };
    for (const m of ['warn', 'error']) console[m] = (...args) => { warnings.push(format(...args)); };
    return {
        recent,
        warnings,
        restore() { Object.assign(console, original); },
    };
}

function copyProfiles(workDir) {
    const from = path.join(ROOT, 'profiles', 'defaults');
    const to = path.join(workDir, 'profiles', 'defaults');
    fs.mkdirSync(to, { recursive: true });
    for (const file of fs.readdirSync(from)) {
        if (file.endsWith('.json')) fs.copyFileSync(path.join(from, file), path.join(to, file));
    }
}

const importProject = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

async function importOptional(rel) {
    try {
        return await importProject(rel);
    } catch {
        return null;
    }
}

// A stand-in for the chat model that records the prompt; in a real run it passes the request on.
function recordingModel(real, dryRun) {
    const model = {
        model_name: real?.model_name,
        last: null,
        async sendRequest(turns, systemMessage) {
            model.last = { turns, systemMessage: String(systemMessage ?? '') };
            if (dryRun) return '';
            return await real.sendRequest(turns, systemMessage);
        },
        sendVisionRequest() { return Promise.reject(new Error('routing check: no vision requests')); },
        embed() { return Promise.reject(new Error('routing check: no embeddings')); },
    };
    return model;
}

async function run(args) {
    const sentences = JSON.parse(fs.readFileSync(path.join(ROOT, SENTENCES_PATH), 'utf8'));
    const profile = JSON.parse(fs.readFileSync(path.join(ROOT, PROFILE_PATH), 'utf8'));

    // settings first, as main.js does before the agent starts
    const fileSettings = (await importProject('settings.js')).default;
    const settingsModule = await importProject('src/agent/settings.js');
    const settings = runSettings(fileSettings, profile, args.allParts);
    settingsModule.setSettings(settings);

    const commands = await importProject('src/agent/commands/index.js'); // before actions.js: import cycle
    const { Prompter } = await importProject('src/models/prompter.js');
    const skillModule = await importOptional('src/agent/skills/skill_manager.js');
    const usageContext = await importOptional('src/agent/cost/usage_context.js');
    const priceTable = await importOptional('src/agent/cost/price_table.js');
    const costMeterModule = await importOptional('src/agent/cost/cost_meter.js');

    let skillFlags = {};
    try {
        skillFlags = skillModule?.skillFlags?.(settings) ?? {};
    } catch {
        skillFlags = {};
    }
    const blocked = blockedFor(settings, skillFlags);

    const agent = {
        name: profile.name,
        blocked_actions: blocked,
        history: { memory: '' },
        self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
        actions: { currentActionLabel: '' },
        task: { task_id: null },
        npc: {},
    };
    const prompter = new Prompter(agent, settings.profile);
    agent.prompter = prompter;
    agent.name = prompter.getName();
    commands.blacklistCommands(blocked);

    // the fixed fake state; everything else of the prompt is built by the Prompter
    prompter.profile.conversing = prompter.profile.conversing
        .replaceAll('$STATS', fakeStats(prompter.profile.modes))
        .replaceAll('$INVENTORY', FAKE_INVENTORY);

    const chat = recordingModel(prompter.chat_model, args.dryRun);
    const modelName = prompter.chat_model?.model_name ?? String(profile.model);
    prompter.chat_model = chat;
    if (args.dryRun) {
        prompter.code_model = chat;
        prompter.vision_model = chat;
        prompter.cooldown = 0;
    }

    let meter = null;
    if (!args.dryRun && costMeterModule?.CostMeter && usageContext?.setUsageSink) {
        meter = new costMeterModule.CostMeter({ settings: { ...settings, cost_meter: true }, filePath: null });
        usageContext.setUsageSink((report) => meter.record(report));
        agent.cost_meter = meter;
    }

    await prompter.initExamples();
    return { sentences, settings, commands, prompter, chat, modelName, meter, usageContext, priceTable };
}

async function main(argv) {
    const args = parseArgs(argv);
    if (args.help) {
        say(USAGE);
        return 0;
    }
    if (args.unknown.length > 0) {
        say(`Unknown option: ${args.unknown.join(' ')}`);
        say(USAGE);
        return 2;
    }
    if (!args.dryRun && !process.env.ANTHROPIC_API_KEY) {
        say('The routing check needs the key in the environment variable ANTHROPIC_API_KEY. Start it with test-routing.ps1, or use --dry-run to only build the prompts.');
        return 1;
    }

    const originalCwd = process.cwd();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-routing-'));
    const placeholderKey = args.dryRun && !process.env.ANTHROPIC_API_KEY;
    const quiet = quietConsole();
    let ctx = null;
    try {
        copyProfiles(workDir);
        process.chdir(workDir);
        if (placeholderKey) process.env.ANTHROPIC_API_KEY = DRY_RUN_KEY;

        ctx = await run(args);
        const plan = planSentences(ctx.sentences, ctx.settings);
        const skipped = plan.filter((e) => !e.run);
        const partsOn = Object.keys(PART_COMMANDS).filter((p) => partIsOn(ctx.settings, p));
        say(`Routing check with ${PROFILE_PATH}, chat model ${ctx.modelName}${args.dryRun ? ', dry run: nothing is sent' : ''}.`);
        say(`Parts on: ${partsOn.length > 0 ? partsOn.join(', ') : 'none'}.`);
        say();

        const rows = args.dryRun ? [['#', 'chars', 'part', 'sentence']] : [['#', 'result', 'got', 'expected', 'sentence']];
        const results = [];
        let passed = 0;
        for (const [i, entry] of plan.entries()) {
            if (!entry.run) continue;
            const messages = [{ role: 'user', content: `${PLAYER}: ${entry.say}` }];
            ctx.chat.last = null;
            quiet.recent.length = 0;
            const answer = await ctx.prompter.promptConvo(messages);
            const prompt = ctx.chat.last?.systemMessage ?? '';
            const chars = prompt.length + messages.reduce((sum, m) => sum + m.content.length, 0);
            if (args.dryRun) {
                rows.push([i + 1, chars, entry.part || '-', entry.say]);
                results.push({ say: entry.say, chars });
                continue;
            }
            const got = answer === MODEL_ERROR_ANSWER ? 'error' : firstCommand(answer, ctx.commands.containsCommand);
            const pass = entry.expect.includes(got);
            if (pass) passed++;
            rows.push([i + 1, pass ? 'pass' : 'FAIL', got ?? '(none)', entry.expect.join(' or '), entry.say]);
            results.push({ say: entry.say, chars, answer, got, pass });
            if (got === 'error') quiet.warnings.push(`Request for "${entry.say}" failed:\n${quiet.recent.slice(-5).join('\n')}`);
        }

        say(formatTable(rows));
        say();
        if (skipped.length > 0) {
            const byPart = {};
            for (const e of skipped) byPart[e.part] = (byPart[e.part] ?? 0) + 1;
            say(`Skipped ${skipped.length} sentences whose part is off: ${Object.entries(byPart).map(([p, n]) => `${p} (${n})`).join(', ')}. Use --all-parts to include them.`);
        }
        if (args.dryRun) {
            let price = null;
            try {
                price = ctx.priceTable?.priceFor?.(ctx.modelName, ctx.settings.model_prices ?? {}) ?? null;
            } catch {
                price = null;
            }
            for (const line of dryRunSummary(results, { model: ctx.modelName, price, costOf: ctx.priceTable?.costOf ?? null })) say(line);
        } else {
            say(summaryLine(passed, results.length));
            say(ctx.meter ? ctx.meter.reportLine() : 'Cost: unknown, the cost meter (src/agent/cost/) is not available.');
        }
        return 0;
    } finally {
        try {
            ctx?.usageContext?.setUsageSink?.(null);
        } catch {
            // nothing to undo
        }
        if (placeholderKey) delete process.env.ANTHROPIC_API_KEY;
        process.chdir(originalCwd);
        quiet.restore();
        fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        const warnings = [...new Set(quiet.warnings)];
        if (warnings.length > 0) {
            say();
            say('Messages of the bot code during the run:');
            for (const w of warnings) say('  ' + w.split('\n').join('\n  '));
        }
    }
}

function isMainModule() {
    if (!process.argv[1]) return false;
    const self = fileURLToPath(import.meta.url);
    const started = path.resolve(process.argv[1]);
    return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

if (isMainModule()) {
    main(process.argv.slice(2)).then(
        (code) => {
            process.exitCode = code;
            // the model client may keep a connection open for a while
            setTimeout(() => process.exit(code), 2000).unref();
        },
        (error) => {
            console.error('Routing check failed:', error);
            process.exitCode = 1;
            setTimeout(() => process.exit(1), 2000).unref();
        },
    );
}
