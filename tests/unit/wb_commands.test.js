// Spec v0.1.4.12, sections 2 and 4.4 (part B, engineer E4): the setting watch_and_learn in settings.js and
// settings_spec.json; the three commands !watchMe, !continueLike, !buildWatched with the descriptions of the spec; off
// without the switch (no pack touched); !watchMe runs as an action until the next order interrupts it, then says what
// it watched without a turn of the model; !continueLike and !buildWatched give the text of the pack word for word;
// _loadWorkPacks loads the watching pack only with watch_and_learn; the examples and the routing sentences.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { captureConsole } from '../helpers/console_capture.js';
import { loadGlue, makeGlueAgent } from '../helpers/st_glue_env.js';

const G = await loadGlue();
const settings = (await loadSrc('settings.js')).default;
const SPEC = JSON.parse(fs.readFileSync(repoPath('src/mindcraft/public/settings_spec.json'), 'utf8'));
const PROFILE = JSON.parse(fs.readFileSync(repoPath('profiles/defaults/_default.json'), 'utf8'));
const SENTENCES = JSON.parse(fs.readFileSync(repoPath('tests/routing/sentences.json'), 'utf8'));
const WATCH = await loadSrc('src/agent/packs/watch/index.js');

const LIMIT = { timeout: 30000 };
const BASE = { language: 'en', blocked_actions: [], max_commands: -1, show_command_syntax: 'full', world_memory: false, protected_areas: false,
    home_pack: false, storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false, routes_pack: false, protect_built_blocks: false,
    allow_insecure_coding: false, narrate_behavior: false, watch_and_learn: false };

let cap;
beforeEach(() => {
    cap = captureConsole();
    G.settingsModule.setSettings({ ...BASE });
});
afterEach(() => {
    cap.restore();
});

const set = (extra) => G.settingsModule.setSettings({ ...BASE, ...extra });
const command = (name) => G.actions.actionsList.find((c) => c.name === name);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the setting watch_and_learn', () => {
    test('settings_spec.json: a boolean, off by default, a description, right after watch_port', () => {
        assert.deepEqual([SPEC.watch_and_learn?.type, SPEC.watch_and_learn?.default], ['boolean', false]);
        assert.ok(SPEC.watch_and_learn.description.length > 0);
        assert.deepEqual(Object.keys(SPEC.watch_and_learn).sort(), Object.keys(SPEC.watch_port).sort());
        const keys = Object.keys(SPEC);
        assert.equal(keys.indexOf('watch_and_learn'), keys.indexOf('watch_port') + 1);
    });

    test('settings.js has the key with a boolean value, in the style of the others, after watch_port (the value is the owner\'s)', () => {
        assert.ok(Object.hasOwn(settings, 'watch_and_learn'));
        assert.equal(typeof settings.watch_and_learn, 'boolean');
        const source = fs.readFileSync(repoPath('settings.js'), 'utf8');
        assert.match(source, /^\s*"watch_and_learn":\s*(true|false),\s*\/\/ \S/m);
        assert.ok(source.indexOf('"watch_and_learn"') > source.indexOf('"watch_port"'));
        assert.ok(!source.includes('\r\n'));
    });
});

describe('the three commands', () => {
    // the descriptions are shorter than in SPEC 4.4 on the lead's order: the prompt with every switch on (17,000 characters)
    test('names, descriptions and params (shortened on the lead\'s order)', () => {
        assert.equal(command('!watchMe').description, 'Watch me build.');
        assert.equal(command('!watchMe').params, undefined);
        assert.equal(command('!continueLike').description, 'Say the pattern you watched.');
        assert.deepEqual(Object.keys(command('!continueLike').params), ['size']);
        assert.equal(command('!continueLike').params.size.type, 'string');
        assert.equal(command('!buildWatched').description, 'Build or dig it after my yes.');
        assert.equal(command('!buildWatched').params, undefined);
        assert.equal(command('!stopWatching'), undefined, 'not a command: any order ends the watching');
    });

    // after !stay: the docs from !rememberRoute to !stay are pinned word for word by rtg_prompt.test.js
    test('after !stay, before !setMode', () => {
        const names = G.actions.actionsList.map((c) => c.name);
        const at = names.indexOf('!stay');
        assert.deepEqual(names.slice(at + 1, at + 5), ['!watchMe', '!continueLike', '!buildWatched', '!setMode']);
    });

    test('watch_and_learn off: "Learning by watching is off." and no pack touched', LIMIT, async () => {
        const agent = makeGlueAgent(G, { fields: {} });
        Object.defineProperty(agent, 'work_packs', { get() { throw new Error('work_packs was used with the switch off'); } });
        for (const [name, args] of [['!watchMe', []], ['!continueLike', ['12 long']], ['!buildWatched', []]])
            assert.equal(await command(name).perform(agent, ...args), 'Learning by watching is off.', name);
    });

    test('watch_and_learn on without a work pack switch: the commands say what they need', LIMIT, async () => {
        set({ watch_and_learn: true });
        const agent = makeGlueAgent(G, { fields: {} });
        assert.match(await command('!watchMe').perform(agent), /^Learning by watching needs one of storage_pack/);
    });
});

describe('the commands with the pack (fake pack)', () => {
    function fakePack(log) {
        return {
            async watchMe(bot, ctx, player) {
                log.push(['watchMe', player, typeof ctx]);
                while (!bot.interrupt_code) await sleep(5);
                return { ok: true, reason: null, text: 'I watched you: 4 blocks placed, 0 broken.' };
            },
            async continueLike(bot, ctx, size) {
                log.push(['continueLike', size]);
                return { ok: true, reason: null, text: 'I understood: a line of oak_planks 12 long from (1, 64, 2) eastwards; 8 oak_planks more, I carry 20. Say yes to build it.' };
            },
            async buildWatched() {
                log.push(['buildWatched']);
                return { ok: true, reason: null, text: 'I built the line: 8 oak_planks.' };
            },
        };
    }

    test('!watchMe typed: watches the player who typed it until the next order; then `I watched you: ...` is said, no turn of the model', LIMIT, async () => {
        set({ watch_and_learn: true, storage_pack: true });
        const log = [];
        const agent = makeGlueAgent(G, { fields: { work_packs: { watch: fakePack(log) } } });
        const watching = G.index.executeCommand(agent, '!watchMe', { typed: true, by: 'steve' });
        await sleep(50);
        assert.equal(agent.actions.executing, true, 'the watching runs as an action');
        assert.deepEqual(log, [['watchMe', 'steve', 'object']]);
        const cont = await G.index.executeCommand(agent, '!continueLike("12 long")', { typed: true, by: 'steve' });
        assert.equal(await watching, undefined, 'the watching returns nothing: its text is said');
        assert.ok(agent.chats.includes('I watched you: 4 blocks placed, 0 broken.'), JSON.stringify(agent.chats));
        assert.ok(!agent.turns.some(([, text]) => /was stopped by/.test(text)), 'not reported as a stopped command');
        assert.equal(cont, 'I understood: a line of oak_planks 12 long from (1, 64, 2) eastwards; 8 oak_planks more, I carry 20. Say yes to build it.');
        assert.deepEqual(log[1], ['continueLike', '12 long']);
        const built = await G.index.executeCommand(agent, '!buildWatched', { typed: true, by: 'steve' });
        assert.equal(built, 'I built the line: 8 oak_planks.');
        assert.equal(agent.prompter.calls, 0, 'no call of the model');
    });

    test('!watchMe from the model: the player of the order', LIMIT, async () => {
        set({ watch_and_learn: true, mining_pack: true });
        const log = [];
        const agent = makeGlueAgent(G, { fields: { work_packs: { watch: fakePack(log) } } });
        agent.last_order = { by: 'alex', command: '!watchMe', typed: false };
        const watching = G.index.executeCommand(agent, '!watchMe', { typed: false });
        await sleep(30);
        await agent.actions.stop('!stop');
        await watching;
        assert.equal(log[0][1], 'alex');
    });

    test('without the pack: "The watch pack could not be loaded."', LIMIT, async () => {
        set({ watch_and_learn: true, storage_pack: true });
        const agent = makeGlueAgent(G, { fields: { work_packs: {} } });
        assert.equal(await command('!watchMe').perform(agent), 'The watch pack could not be loaded.');
        assert.equal(await command('!buildWatched').perform(agent), 'The watch pack could not be loaded.');
    });
});

describe('_loadWorkPacks', () => {
    const fakeAgent = () => Object.assign(Object.create(G.Agent.prototype), { name: 'andy', bot: { username: 'andy' } });

    test('the watching pack only with watch_and_learn', LIMIT, async () => {
        set({ storage_pack: true });
        assert.deepEqual(Object.keys(await fakeAgent()._loadWorkPacks()).sort(), ['storage']);
        set({ storage_pack: true, watch_and_learn: true });
        const packs = await fakeAgent()._loadWorkPacks();
        assert.deepEqual(Object.keys(packs).sort(), ['storage', 'watch']);
        assert.equal(packs.watch.watchMe, WATCH.watchMe, 'the real pack');
        for (const name of ['watchMe', 'continueLike', 'buildWatched', 'stopWatching', 'record']) assert.equal(typeof packs.watch[name], 'function', name);
    });

    test('a watching pack that cannot be loaded: one warning, the others are loaded', LIMIT, async () => {
        set({ storage_pack: true, watch_and_learn: true });
        const packs = await fakeAgent()._loadWorkPacks({ watch: () => Promise.reject(new Error('broken')) });
        assert.deepEqual(Object.keys(packs), ['storage']);
        assert.ok(cap.of('warn').some((r) => /^Could not load the watch pack, its commands stay hidden:/.test(r.text)));
    });

    test('source: import() of ./packs/watch/index.js behind watch_and_learn and inside try', () => {
        const source = fs.readFileSync(repoPath('src/agent/agent.js'), 'utf8').replace(/\r\n/g, '\n');
        assert.match(source, /if \(settings\.watch_and_learn && \(settings\.storage_pack \|\| settings\.farming_pack \|\| settings\.wood_pack \|\| settings\.mining_pack \|\| settings\.routes_pack\)\) \{\n\s+try \{\n\s+packs\.watch = await \(loaders\.watch \? loaders\.watch\(\) : import\('\.\/packs\/watch\/index\.js'\)\);/);
        assert.equal(source.match(/packs\/watch\//g).length, 1);
    });
});

describe('the examples and the routing sentences', () => {
    const example = (sentence) => PROFILE.conversation_examples.find((e) => e.some((t) => t.role === 'user' && t.content.endsWith(': ' + sentence)));

    test('"watch me" -> !watchMe; "continue like this, 7 by 10" -> !continueLike("7 by 10"); "yes, build it" after an understood text -> !buildWatched', () => {
        const turnAfter = (e, sentence) => e[e.findIndex((t) => t.role === 'user' && t.content.endsWith(': ' + sentence)) + 1].content;
        assert.match(turnAfter(example('watch me'), 'watch me'), /!watchMe$/);
        assert.match(turnAfter(example('continue like this, 7 by 10'), 'continue like this, 7 by 10'), /!continueLike\("7 by 10"\)$/);
        const yes = example('yes, build it');
        assert.match(turnAfter(yes, 'yes, build it'), /!buildWatched$/);
        const before = yes.slice(0, yes.findIndex((t) => t.content.endsWith(': yes, build it')));
        assert.ok(before.some((t) => /^I understood: .* Say yes to build it\.$/.test(t.content)), 'an understood text comes first');
    });

    test('three sentences for the three commands, part watch_and_learn', () => {
        const rows = SENTENCES.filter((s) => s.part === 'watch_and_learn');
        assert.deepEqual(rows.map((s) => [s.say, s.expect]), [
            ['watch me', ['!watchMe']], ['continue like this, 7 by 10', ['!continueLike']], ['yes, build it', ['!buildWatched']],
        ]);
    });
});
