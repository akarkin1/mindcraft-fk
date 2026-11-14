// Spec v0.1.4.16, section 8.4a (E8): the AFK creeper kill as a job of the kind kill_farm (src/agent/job), so that a reflex,
// the night or a restart that ends the action is followed by the job resume back to the spot with the same until. The
// store accepts the kind; !killFarm of the owner or the model starts it (the order its command and its one step); a
// stopped farm stays running and tick runs the order again after job_resume_seconds, at night too; a time counts from
// the order; the level or the time reached: done; a refusal or a stop of the pack: paused, never a plan; the owner's !stop
// ends it; the model's work commands are refused while it runs; the restart line. And the wiring: _loadWorkPacks loads the
// pack with afk_kill only (the wood pack too, for the stone sword), !killFarm is hidden while the switch is off or the pack
// is missing, its perform gives the pack's text word for word, the routing and the example.
import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';
import { blockedPushes, loadGlue, makeGlueAgent } from '../helpers/st_glue_env.js';
import * as R from '../routing/commands.js';

const J = await loadSrc('src/agent/job/index.js');
const S = await loadSrc('src/agent/job/job_store.js');
const G = await loadGlue();
const PROFILE = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
const SENTENCES = JSON.parse(fs.readFileSync(repoPath('tests/routing/sentences.json'), 'utf8'));

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const LEVEL_LINE = 'I stop the farming: level 30 reached; 280 creepers, 1 hour 10 minutes; 268 gunpowder stored.';

let cap;
beforeEach(() => { cap = captureConsole(); });
afterEach(() => { cap.restore(); });

function parse(text) {
    const m = text.match(/^!(\w+)(?:\((.*)\))?$/);
    const args = m[2] ? m[2].split(/\s*,\s*/).map(a => (/^-?\d+$/.test(a) ? Number(a) : a.replace(/^"|"$/g, ''))) : [];
    return { name: `!${m[1]}`, args };
}

/** A fake agent and clock with the job, as gja_job_index plays the glue. results: what each run of !killFarm gives. */
function makeWorld({ results = [], night = false } = {}) {
    const w = { t: T0, said: [], quiet: [], ran: [], prompts: [], results: [...results], night };
    w.agent = {
        sayText: (text) => w.said.push(text),
        actions: { executing: false, currentActionLabel: '' },
        bot: { inventory: { items: () => [] }, time: { timeOfDay: night ? 18000 : 1000 }, isSleeping: false },
        whereAmI: () => ({ underground: false }),
    };
    w.store = new J.JobStore(null, { now: () => new Date(w.t) });
    w.run = async (text, by) => {
        const { name, args } = parse(text);
        w.ran.push({ text, by });
        w.job.onCommand(name, args, by, text);
        const result = w.results.length > 0 ? w.results.shift() : undefined; // undefined: stopped again
        await w.job.onResult(name, result, {});
        return result === undefined ? undefined : result.text;
    };
    w.job = J.createJob(w.agent, w.store, {
        settings: { job_resume_seconds: 60, idle_jobs: [], idle_jobs_minutes: 15 },
        now: () => w.t,
        executeCommand: (text, options) => w.run(text, options?.by),
        askModel: async (prompt) => { w.prompts.push(prompt); return 'NONE'; },
        night: () => w.night,
        nightShelter: () => true,
        sayQuiet: (text) => w.quiet.push(text),
    });
    w.wait = (seconds) => { w.t += seconds * 1000; };
    return w;
}

// The owner's order through the job as the glue gives it: onCommand, then the result (undefined: stopped).
async function order(w, text, by, result) {
    const { name, args } = parse(text);
    w.job.onCommand(name, args, by, text);
    return await w.job.onResult(name, result, {});
}

describe('the store accepts the kind kill_farm', () => {
    test('the kind and its command; another command under the kind is no job', () => {
        assert.equal(S.KILL_FARM_KIND, 'kill_farm');
        assert.equal(S.KILL_FARM_COMMAND, '!killFarm');
        const store = new S.JobStore(null);
        const saved = store.set(J.killFarmJob(['level 30'], 'steve', new Date(T0).toISOString()));
        assert.equal(saved.kind, 'kill_farm');
        assert.equal(saved.command, '!killFarm("level 30")');
        assert.deepEqual(saved.steps, [{ command: '!killFarm("level 30")', check: { item: null, count: null }, state: 'todo' }]);
        assert.equal(store.set({ ...saved, command: '!mineOre("iron", 8)' }), null);
    });

    test('the file round trip', () => {
        const dir = makeTmpDir();
        try {
            const file = path.join(dir, 'job.json');
            new S.JobStore(file).set(J.killFarmJob([''], 'model', new Date(T0).toISOString()));
            const back = new S.JobStore(file).load();
            assert.deepEqual([back.kind, back.command, back.by, back.words, back.state], ['kill_farm', '!killFarm("")', 'model', 'the creeper farming', 'running']);
        } finally {
            removeTmpDir(dir);
        }
    });

    test('the resume order: the same until; a time counts from the order (what is left, at least 1 minute); null when over', () => {
        const job = (until) => ({ args: [until], started: new Date(T0).toISOString() });
        assert.equal(J.killFarmResume(job('level 30'), T0 + 3600000), '!killFarm("level 30")');
        assert.equal(J.killFarmResume(job(''), T0 + 3600000), '!killFarm("")');
        assert.equal(J.killFarmResume(job('20 minutes'), T0 + 5 * 60000), '!killFarm("15 minutes")');
        assert.equal(J.killFarmResume(job('20 minutes'), T0 + 19.5 * 60000), '!killFarm("1 minutes")');
        assert.equal(J.killFarmResume(job('20 minutes'), T0 + 20 * 60000), null);
        assert.equal(J.killFarmResume(job('1 hour'), T0 + 10 * 60000), '!killFarm("50 minutes")');
    });
});

describe('the job of the farm (8.4a)', () => {
    test('!killFarm starts the job; stopped by a reflex it stays running; after 60 s quiet the order runs again with the same until', async () => {
        const w = makeWorld({ results: [{ ok: true, reason: null, text: LEVEL_LINE }] });
        await order(w, '!killFarm("level 30")', 'steve', undefined);
        assert.deepEqual([w.job.get().kind, w.job.get().state], ['kill_farm', 'running']);
        w.agent.actions.executing = true; // the reflex runs
        w.wait(120);
        assert.equal((await w.job.tick()).reason, 'wait');
        w.agent.actions.executing = false;
        await w.job.tick(); // the glue gives the result of the system order (onResult), so tick answers with its role
        assert.deepEqual(w.ran, [{ text: '!killFarm("level 30")', by: 'system' }]);
        assert.ok(w.said.includes('I go back to the creeper farming.'));
        assert.equal(w.job.get().state, 'done');
        assert.deepEqual(w.quiet, [LEVEL_LINE], 'the end line of a resumed farm goes to the chat');
        assert.equal(w.prompts.length, 0, 'no model call');
    });

    test('at night too (the pack sleeps by itself); the shelter\'s night holds other jobs back, not this one', async () => {
        const w = makeWorld({ night: true });
        await order(w, '!killFarm("")', 'steve', undefined);
        w.wait(61);
        await w.job.tick();
        assert.deepEqual(w.ran.map((r) => r.text), ['!killFarm("")']);
    });

    test('within 60 s of an order: no resume; an errand of the owner keeps the job', async () => {
        const w = makeWorld();
        await order(w, '!killFarm("")', 'steve', undefined);
        w.wait(30);
        assert.equal((await w.job.tick()).reason, 'wait');
        assert.equal(w.job.onCommand('!goToPlayer', ['steve', 2], 'steve').reason, 'errand');
        w.wait(59);
        assert.equal((await w.job.tick()).reason, 'wait');
        assert.equal(w.job.get().state, 'running');
        w.wait(2);
        await w.job.tick();
        assert.equal(w.ran.length, 1);
    });

    test('"20 minutes": the resume after 15 minutes gets 5; after 20 the job is done without a run', async () => {
        const w = makeWorld();
        await order(w, '!killFarm("20 minutes")', 'steve', undefined);
        w.wait(15 * 60);
        await w.job.tick();
        assert.equal(w.ran[0].text, '!killFarm("5 minutes")');
        w.wait(6 * 60);
        const out = await w.job.tick();
        assert.equal(w.ran.length, 1);
        assert.equal(out.reason, 'done');
        assert.ok(w.said.includes('The creeper farming is done.'));
    });

    test('a refusal or a stop of the pack (health, no slab, no weapon): paused, no plan, no resume', async () => {
        for (const r of [
            { ok: false, reason: 'low_health', text: 'I leave the kill room: health 9.' },
            { ok: false, reason: 'no_slab', text: 'The kill room has no slab over the hoppers; I do not farm there.' },
            { ok: false, reason: 'no_weapon', text: 'I have no sword left and cannot make one; I stop the farming at level 14.' },
            'The AFK kill pack could not be loaded.',
        ]) {
            const w = makeWorld();
            const out = await order(w, '!killFarm("")', 'steve', r);
            assert.equal(out.reason, 'paused', JSON.stringify(r));
            assert.equal(w.job.get().state, 'paused');
            assert.equal(w.job.get().steps[0].state, 'failed');
            w.wait(600);
            await w.job.tick();
            assert.equal(w.ran.length, 0, 'no resume');
            assert.equal(w.prompts.length, 0, 'no plan');
            assert.equal(w.quiet.length, 0, 'the owner\'s own order: the glue answers with the text');
        }
    });

    test('the owner\'s !stop ends the job; the stopped result after it changes nothing', async () => {
        const w = makeWorld();
        w.job.onCommand('!killFarm', ['level 30'], 'steve', '!killFarm("level 30")');
        const stop = w.job.onCommand('!stop', [], 'steve');
        assert.equal(stop.text, 'I leave the creeper farming.');
        await w.job.onResult('!killFarm', undefined, {});
        assert.equal(w.job.get().state, 'left');
        w.wait(600);
        await w.job.tick();
        assert.equal(w.ran.length, 0);
    });

    test('a new !killFarm replaces the farm without the leave line; a farm leaves the mining with it', async () => {
        const w = makeWorld();
        w.job.onCommand('!killFarm', [''], 'steve', '!killFarm("")');
        assert.equal(w.job.onCommand('!killFarm', ['level 30'], 'model', '!killFarm("level 30")').text, '');
        assert.deepEqual([w.job.get().command, w.job.get().by], ['!killFarm("level 30")', 'model']);
        const v = makeWorld();
        v.job.onCommand('!mineOre', ['iron', 16, false], 'steve', '!mineOre("iron", 16)');
        assert.equal(v.job.onCommand('!killFarm', [''], 'steve', '!killFarm("")').text, 'I leave the mining at 0 of 16 iron.');
        assert.equal(v.job.get().kind, 'kill_farm');
    });

    test('while the farm runs the model\'s work command is refused; the owner\'s and !stop are not', () => {
        const w = makeWorld();
        w.job.onCommand('!killFarm', [''], 'steve', '!killFarm("")');
        assert.equal(w.job.refusal('!collectBlocks', 'model'), 'The creeper farming runs. Say !stop first.');
        assert.equal(w.job.refusal('!goToBed', 'model'), 'The creeper farming runs. Say !stop first.', 'the night\'s !goToBed of the model (M-6)');
        assert.equal(w.job.refusal('!collectBlocks', 'steve'), null);
        assert.equal(w.job.refusal('!stop', 'model'), null);
    });

    test('the restart line, and the status line', () => {
        const w = makeWorld();
        w.job.onCommand('!killFarm', [''], 'steve', '!killFarm("")');
        assert.equal(w.job.onRestart().text, 'I was farming creepers. I go on.');
        assert.match(w.job.status(), /^Job: the creeper farming/);
    });

    test('the plan is never asked for the farm', async () => {
        const w = makeWorld();
        w.job.onCommand('!killFarm', [''], 'steve', '!killFarm("")');
        assert.equal((await w.job.plan({ kind: 'no_tool', item: 'sword' })).reason, 'no_plan');
        assert.equal(w.prompts.length, 0);
    });
});

describe('the wiring (8.0, 8.4)', () => {
    const BASE = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: false, protected_areas: false,
        home_pack: false, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false, routes_pack: false, protect_built_blocks: false,
        allow_insecure_coding: false, narrate_behavior: false, watch_and_learn: false, base_survey: false, breeding: false, enchanting: false, afk_kill: false };
    const set = (extra) => G.settingsModule.setSettings({ ...BASE, ...extra });
    const fakeAgent = () => Object.assign(Object.create(G.Agent.prototype), { name: 'andy', bot: { username: 'andy' } });
    const command = () => G.actions.actionsList.find((c) => c.name === '!killFarm');
    const stub = { ok: true };
    const loaders = { storage: async () => stub, wood: async () => stub, afk_kill: async () => ({ killFarm: () => null }) };

    test('_loadWorkPacks: the pack with afk_kill only, with the storage and the wood pack (the chests, the sword)', async () => {
        set({});
        assert.deepEqual(Object.keys(await fakeAgent()._loadWorkPacks(loaders)), []);
        set({ afk_kill: true });
        assert.deepEqual(Object.keys(await fakeAgent()._loadWorkPacks(loaders)).sort(), ['afk_kill', 'storage', 'wood']);
    });

    test('a pack that cannot be loaded: one warning, its command stays hidden', async () => {
        set({ afk_kill: true });
        const packs = await fakeAgent()._loadWorkPacks({ ...loaders, afk_kill: () => Promise.reject(new Error('broken')) });
        assert.ok(!('afk_kill' in packs));
        assert.ok(cap.of('warn').some((r) => /^Could not load the afk_kill pack, its commands stay hidden:/.test(r.text)));
    });

    test('the real pack loads through the real import', async () => {
        set({ afk_kill: true });
        const packs = await fakeAgent()._loadWorkPacks({ storage: async () => stub, wood: async () => stub });
        assert.equal(typeof packs.afk_kill?.killFarm, 'function');
    });

    test('source: import() of ./packs/afk_kill/index.js behind afk_kill, inside try; !killFarm hidden while off or not loaded', () => {
        const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8').replace(/\r\n/g, '\n');
        assert.match(source, /if \(settings\.afk_kill\) \{\n\s+try \{\n\s+packs\.afk_kill = await \(loaders\.afk_kill \? loaders\.afk_kill\(\) : import\('\.\/packs\/afk_kill\/index\.js'\)\);/);
        assert.equal(source.match(/packs\/afk_kill\//g).length, 1);
        const push = blockedPushes().find((p) => p.names.includes('!killFarm'));
        assert.deepEqual(push, { test: '!settings.afk_kill || !this.work_packs?.afk_kill', names: ['!killFarm'] });
    });

    test('!killFarm: off, missing, and the pack\'s text word for word', async () => {
        set({});
        assert.equal(await command().perform(makeGlueAgent(G, { fields: {} }), ''), 'The AFK kill pack is off.');
        set({ afk_kill: true });
        assert.equal(await command().perform(makeGlueAgent(G, { fields: { work_packs: {} } }), ''), 'The AFK kill pack could not be loaded.');
        const calls = [];
        const pack = { killFarm: async (bot, ctx, until) => { calls.push(until); return { ok: true, reason: null, text: LEVEL_LINE }; } };
        const agent = makeGlueAgent(G, { fields: { work_packs: { afk_kill: pack }, packContext: () => ({}) } });
        assert.equal(await command().perform(agent, 'level 30'), LEVEL_LINE);
        assert.deepEqual(calls, ['level 30']);
    });

    test('the docs line and the param of the spec', () => {
        const c = command();
        assert.equal(c.description, 'Farm creepers at the saved kill spot: climb there, kill what lands on the hoppers, store the drops, eat and sleep, until you say stop, or until "level 30" or "20 minutes".');
        assert.deepEqual(Object.keys(c.params), ['until']);
        assert.deepEqual([c.params.until.type, c.params.until.default], ['string', '']);
        const spec = R.SPEC_COMMANDS.find((e) => e.name === '!killFarm');
        assert.equal(spec.description, c.description);
        assert.deepEqual(R.PART_COMMANDS.afk_kill, ['!killFarm']);
    });

    test('two routing sentences of the part afk_kill; one profile example with the order', () => {
        const mine = SENTENCES.filter((s) => s.part === 'afk_kill');
        assert.equal(mine.length, 2);
        assert.ok(mine.every((s) => s.expect.includes('!killFarm')));
        const example = PROFILE.conversation_examples.filter((e) => e.some((t) => t.role === 'assistant' && t.content.includes('!killFarm')));
        assert.equal(example.length, 1);
        assert.ok(example[0].some((t) => t.content === 'ida_2: farm creepers until level 30'));
        assert.ok(example[0].some((t) => t.content.endsWith('!killFarm("level 30")')));
    });
});
