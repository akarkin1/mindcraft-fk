// Part K of v0.1.4.14 (SPEC 4.7): what the model does not know.
//   - the table: the lines word for word; every name is in the 26.1 registry (items, blocks, entities or effects),
//     none in 1.21.8's except name_tag, zombie_horse and mannequin;
//   - the selection: by bag, by view, by line, in that order, each once, the limit; the whole-word match ("copper"
//     alone matches nothing; "copper pickaxe", "spears", "shelf");
//   - the block: the header, at most 3 lines and 360 characters;
//   - the prompt: with new_things_in_prompt on the header and the lines after the knowledge block (or alone), with it
//     off the prompt is the one of v0.1.4.13 byte for byte.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { loadSrc } from '../helpers/load.js';
import { repoPath } from '../helpers/paths.js';
import { makeTmpDir, removeTmpDir } from '../helpers/tmp.js';
import { captureConsole } from '../helpers/console_capture.js';

const R = minecraftData('26.1');
const OLD = minecraftData('1.21.8');
const N = await loadSrc('src/agent/knowledge/new_things.js');
const K = await loadSrc('src/agent/knowledge/knowledge_text.js');

const HEADER = 'NEW SINCE 1.21.8 (true, even if you do not know it):';
const LINES = {
    copperTools: 'Copper tools and armour exist since 1.21.9: like stone but faster, 190 uses, from copper ingots; a copper pickaxe mines iron, copper and lapis, not diamond or gold.',
    copperChest: 'A copper chest is a chest with 27 slots; it oxidizes unless waxed; a copper golem takes items out of it.',
    copperGolem: 'A copper golem sorts items: it carries up to 16 from a copper chest into a chest that is empty or holds that kind, within 32 blocks; a pumpkin on a copper block spawns one.',
    shelf: 'A shelf holds 3 item stacks; using a slot swaps it with the item in hand. It is not a chest.',
    copperLights: 'Copper torches, lanterns, bars and chains work like the iron ones; the chain is called iron_chain now.',
    spear: 'A spear is a weapon with long reach since 1.21.11: a quick jab or a charge while running; wood to netherite; it breaks no blocks.',
    parched: 'A parched is a desert skeleton that does not burn in sunlight and shoots arrows of weakness.',
    camelHusk: 'A camel husk is an undead camel; with its husk and parched riders it is hostile, without them harmless.',
    nautilus: 'A nautilus is a neutral ocean mob that dashes when hit and is tamed with pufferfish; a zombie nautilus carries a drowned with a trident.',
    zombieHorse: 'Zombie horses spawn at night with a zombie rider that holds a spear.',
    dandelion: 'A golden dandelion, used on a baby animal, stops it from growing; used again, it grows.',
    nameTag: 'A name tag is crafted from 1 paper and 1 nugget of any metal since 26.1.',
    mannequin: 'A mannequin is a player-shaped figure placed by command, not a mob.',
    breath: 'Breath of the nautilus pauses the use of air under water.',
};

const inRegistry = (r, name) => Boolean(r.itemsByName[name] || r.blocksByName[name] || r.entitiesByName[name] || r.effectsByName[name]);

describe('the table NEW_THINGS (SPEC 4.7)', () => {
    test('the lines of the spec, word for word, in its order', () => {
        assert.deepEqual(N.NEW_THINGS.map((t) => t.line), Object.values(LINES));
    });

    test('frozen; since is 1.21.9, 1.21.11 or 26.1', () => {
        assert.ok(Object.isFrozen(N.NEW_THINGS));
        for (const thing of N.NEW_THINGS) {
            assert.ok(Object.isFrozen(thing) && Object.isFrozen(thing.names), thing.line);
            assert.ok(['1.21.9', '1.21.11', '26.1'].includes(thing.since), thing.since);
            assert.ok(thing.names.length > 0);
        }
    });

    test('every name is in the 26.1 registry, none in 1.21.8 except name_tag, zombie_horse and mannequin', () => {
        const existed = ['name_tag', 'zombie_horse', 'mannequin'];
        for (const thing of N.NEW_THINGS) {
            for (const name of thing.names) {
                assert.ok(inRegistry(R, name), `${name} in 26.1`);
                if (!existed.includes(name)) assert.ok(!inRegistry(OLD, name), `${name} not in 1.21.8`);
            }
        }
    });

    test('every variant is listed: 10 copper tools and armour, 8 copper chests, 12 shelves, 7 spears', () => {
        const names = (line) => N.NEW_THINGS.find((t) => t.line === line).names;
        assert.equal(names(LINES.copperTools).length, 10);
        assert.equal(names(LINES.copperChest).length, 8);
        assert.equal(names(LINES.shelf).length, 12);
        assert.equal(names(LINES.spear).length, 7);
        assert.ok(names(LINES.copperGolem).includes('copper_golem') && names(LINES.copperGolem).includes('waxed_oxidized_copper_golem_statue'));
        for (const n of ['copper_torch', 'copper_wall_torch', 'iron_chain', 'copper_chain', 'waxed_oxidized_copper_chain', 'exposed_copper_lantern', 'copper_bars'])
            assert.ok(names(LINES.copperLights).includes(n), n);
        // every new item and block of 26.1 that the table means is in it
        const all = new Set(N.NEW_THINGS.flatMap((t) => t.names));
        const newBlocks = R.blocksArray.map((b) => b.name).filter((n) => !OLD.blocksByName[n]);
        for (const n of newBlocks.filter((n) => /(copper_(chest|golem_statue|lantern|bars|chain|torch|wall_torch)|_shelf|iron_chain|golden_dandelion)$/.test(n)))
            assert.ok(all.has(n), n);
    });
});

describe('newThingLines (SPEC 4.7)', () => {
    test('nothing new: an empty list', () => {
        assert.deepEqual(N.newThingLines({}), []);
        assert.deepEqual(N.newThingLines({ inventory: ['stone_pickaxe', 'bread'], near: ['chest', 'zombie'], lines: ['steve: bring me some iron'] }), []);
        assert.deepEqual(N.newThingLines(), []);
    });

    test('by bag: a copper pickaxe gives the copper tools line; an item object counts by its name', () => {
        assert.deepEqual(N.newThingLines({ inventory: ['copper_pickaxe'] }), [LINES.copperTools]);
        assert.deepEqual(N.newThingLines({ inventory: [{ name: 'copper_pickaxe', count: 1 }, { name: 'copper_boots', count: 1 }] }), [LINES.copperTools], 'once');
    });

    test('by view: a waxed copper chest and a parched', () => {
        assert.deepEqual(N.newThingLines({ near: ['waxed_weathered_copper_chest', 'parched'] }), [LINES.copperChest, LINES.parched]);
    });

    test('by line: whole words with spaces or underscores, singular or plural', () => {
        const by = (line) => N.newThingLines({ lines: [line] });
        assert.deepEqual(by('steve: make me a spear'), [LINES.spear]);
        assert.deepEqual(by('steve: are spears any good?'), [LINES.spear]);
        assert.deepEqual(by('!craftRecipe("stone_spear", 1)'), [LINES.spear]);
        assert.deepEqual(by('steve: put a shelf there'), [LINES.shelf]);
        assert.deepEqual(by('steve: two shelves please'), [LINES.shelf]);
        assert.deepEqual(by('steve: use your copper pickaxe'), [LINES.copperTools]);
        assert.deepEqual(by('steve: COPPER_PICKAXE'), [LINES.copperTools]);
        assert.deepEqual(by('steve: hang an iron chain'), [LINES.copperLights]);
        assert.deepEqual(by('steve: name tags'), [LINES.nameTag]);
        assert.deepEqual(by('steve: zombie horses at night'), [LINES.zombieHorse]);
        assert.deepEqual(by('steve: the copper chest'), [LINES.copperChest]);
        assert.deepEqual(by('steve: what is breath of the nautilus?'), [LINES.nautilus, LINES.breath]);
    });

    test('"copper" alone, and words that only contain a name, match nothing', () => {
        for (const line of ['steve: get copper', 'steve: mine copper ore', 'steve: smelt raw copper into copper ingots', 'steve: a chest',
            'steve: chain', 'steve: spearmint', 'steve: shelfish', 'steve: pickaxe', 'steve: a copper block'])
            assert.deepEqual(N.newThingLines({ lines: [line] }), [], line);
    });

    test('the order: bag, then view, then lines; each once', () => {
        const out = N.newThingLines({ inventory: ['oak_shelf'], near: ['copper_golem', 'oak_shelf'], lines: ['steve: a spear and a shelf'] });
        assert.deepEqual(out, [LINES.shelf, LINES.copperGolem, LINES.spear]);
    });

    test('at most `limit`, 3 by default; a larger limit gives more', () => {
        const input = { inventory: ['copper_pickaxe', 'copper_chest', 'iron_chain', 'name_tag'], near: ['parched'] };
        assert.deepEqual(N.newThingLines(input), [LINES.copperTools, LINES.copperChest, LINES.copperLights]);
        assert.equal(N.newThingLines({ ...input, limit: 1 }).length, 1);
        assert.equal(N.newThingLines({ ...input, limit: 10 }).length, 5);
        assert.equal(N.NEW_THINGS_LIMIT, 3);
    });

    test('never throws', () => {
        assert.deepEqual(N.newThingLines({ inventory: 'x', near: 5, lines: [null, 3, {}] }), []);
        assert.deepEqual(N.newThingLines(null ?? undefined), []);
    });
});

describe('nearThingNames: the view through the scan of the look tool', () => {
    const center = { x: 0.5, y: 64, z: 0.5 };
    const readerOf = (blocks) => ({ blockAt: (x, y, z) => ({ name: blocks[`${x},${y},${z}`] ?? 'air' }) });

    test('blocks within 8, not beyond; entities within 16, not beyond; only names of the table', () => {
        const reader = readerOf({ '3,64,0': 'copper_chest', '0,65,7': 'oak_shelf', '9,64,0': 'copper_lantern', '1,64,0': 'chest' });
        const entities = [{ name: 'parched', position: { x: 15, y: 64, z: 0 } }, { name: 'nautilus', position: { x: 17, y: 64, z: 0 } },
            { name: 'zombie', position: { x: 1, y: 64, z: 0 } }];
        assert.deepEqual(N.nearThingNames({ reader, center, entities }).sort(), ['copper_chest', 'oak_shelf', 'parched']);
    });

    test('without a reader or a position: nothing; a throwing reader: nothing', () => {
        assert.deepEqual(N.nearThingNames({}), []);
        assert.deepEqual(N.nearThingNames({ reader: { blockAt() { throw new Error('x'); } }, center }), []);
    });
});

describe('newThingsText: the block (SPEC 4.7)', () => {
    test('the header and the lines', () => {
        assert.equal(K.NEW_THINGS_HEADER, HEADER);
        assert.equal(K.newThingsText([LINES.copperTools]), `${HEADER}\n${LINES.copperTools}`);
        assert.equal(K.newThingsText([]), '');
        assert.equal(K.newThingsText(null), '');
    });

    test('at most 3 lines and 360 characters, the header included; a line that does not fit is skipped', () => {
        const short = [LINES.breath, LINES.mannequin, LINES.zombieHorse, LINES.nameTag];
        const text = K.newThingsText(short);
        assert.equal(text.split('\n').length, 4, 'the header and 3 lines');
        assert.ok(text.length <= 360);
        const longest = Object.values(LINES).sort((a, b) => b.length - a.length).slice(0, 3);
        const block = K.newThingsText(longest);
        assert.ok(block.length <= 360, `${block.length}`);
        assert.equal(block, `${HEADER}\n${longest[0]}`, 'the two longest do not fit together with the header');
        assert.equal(K.newThingsText([LINES.copperGolem, LINES.copperTools, LINES.parched]), `${HEADER}\n${LINES.copperGolem}\n${LINES.parched}`);
    });
});

// ------------------------------------------------------------------ the prompt
let workDir;
let originalCwd;
let placeholderKey = false;
let M;

before(async () => {
    originalCwd = process.cwd();
    workDir = makeTmpDir();
    const to = path.join(workDir, 'profiles', 'defaults');
    fs.mkdirSync(to, { recursive: true });
    for (const file of fs.readdirSync(repoPath('profiles/defaults'))) {
        if (file.endsWith('.json')) fs.copyFileSync(repoPath(`profiles/defaults/${file}`), path.join(to, file));
    }
    process.chdir(workDir);
    if (!process.env.ANTHROPIC_API_KEY) {
        process.env.ANTHROPIC_API_KEY = 'dry-run-placeholder-not-a-key'; // no model is called: the fake model below answers
        placeholderKey = true;
    }
    const cap = captureConsole();
    try {
        M = {
            fileSettings: (await loadSrc('settings.js')).default,
            settingsModule: await loadSrc('src/agent/settings.js'),
            prompter: await loadSrc('src/models/prompter.js'),
        };
    } finally {
        cap.restore();
    }
});

after(() => {
    if (placeholderKey) delete process.env.ANTHROPIC_API_KEY;
    process.chdir(originalCwd);
    removeTmpDir(workDir);
});

describe('the chat prompt (SPEC 4.7)', () => {
    const KNOWLEDGE = 'WHAT YOU KNOW (from memory, no need to check):\nYou are on the surface.';
    function fakeBot(items) {
        return {
            inventory: { items: () => items.map((name) => ({ name, count: 1 })), slots: [] },
            entity: { position: { x: 0.5, y: 64, z: 0.5 } },
            blockAt: () => null,
            entities: {},
        };
    }

    async function prompt(profileFile, switches, { items = [], messages = [], knowledge = KNOWLEDGE } = {}) {
        // the profile of the owner; the default profile lends its conversing text (with $KNOWLEDGE), its model being none
        const profile = JSON.parse(fs.readFileSync(repoPath('profiles/claude.json'), 'utf8'));
        profile.conversing = JSON.parse(fs.readFileSync(repoPath(profileFile), 'utf8')).conversing;
        const settings = { ...M.fileSettings, profile, prompt_cache: false, skill_learning: false, skill_command: false, ...switches };
        M.settingsModule.setSettings(settings);
        const agent = {
            name: profile.name, blocked_actions: [], history: { memory: '' }, bot: fakeBot(items),
            self_prompter: { isStopped: () => true, isActive: () => false, isPaused: () => false, prompt: '' },
            actions: { currentActionLabel: '' }, task: { task_id: null }, npc: {}, knowledgeBlock: () => knowledge,
        };
        const cap = captureConsole();
        try {
            const prompter = new M.prompter.Prompter(agent, profile);
            prompter.profile.conversing = prompter.profile.conversing.replaceAll('$STATS', 'STATS').replaceAll('$INVENTORY', 'INVENTORY');
            let last = null;
            const model = { async sendRequest(turns, systemMessage) { last = String(systemMessage ?? ''); return ''; },
                sendVisionRequest: () => Promise.reject(new Error('no vision')), embed: () => Promise.reject(new Error('no embeddings')) };
            Object.assign(prompter, { chat_model: model, code_model: model, vision_model: model, embedding_model: model, cooldown: 0 });
            await prompter.initExamples();
            await prompter.promptConvo(messages);
            return last;
        } finally {
            cap.restore();
        }
    }

    for (const file of ['profiles/claude.json', 'profiles/defaults/_default.json']) {
        test(`${file}: switch on, a copper pickaxe in the bag: the header and the line right after the knowledge block`, async () => {
            const text = await prompt(file, { knowledge_in_prompt: true, new_things_in_prompt: true }, { items: ['copper_pickaxe'] });
            assert.ok(text.includes(`${KNOWLEDGE}\n${HEADER}\n${LINES.copperTools}\n`), text.slice(-800));
            assert.equal(text.split(HEADER).length, 2, 'once');
        });

        test(`${file}: switch on, the knowledge block off: the block alone`, async () => {
            const text = await prompt(file, { knowledge_in_prompt: false, new_things_in_prompt: true }, { items: ['copper_pickaxe'] });
            assert.ok(text.includes(`${HEADER}\n${LINES.copperTools}\n`));
            assert.ok(!text.includes('WHAT YOU KNOW'));
        });

        test(`${file}: switch off: byte for byte the prompt without the setting`, async () => {
            for (const knowledge_in_prompt of [true, false]) {
                const opts = { items: ['copper_pickaxe'], messages: [{ role: 'user', content: 'steve: make me a spear' }] };
                const before = await prompt(file, { knowledge_in_prompt, new_things_in_prompt: undefined }, opts);
                const off = await prompt(file, { knowledge_in_prompt, new_things_in_prompt: false }, opts);
                assert.equal(off, before);
                assert.ok(!off.includes('NEW SINCE'));
            }
        });
    }

    test('a spear in the line of the player: the spear line; nothing new near: no header', async () => {
        const spear = await prompt('profiles/claude.json', { knowledge_in_prompt: true, new_things_in_prompt: true },
            { messages: [{ role: 'user', content: 'steve: make me a spear' }] });
        assert.ok(spear.includes(`${HEADER}\n${LINES.spear}\n`));
        const command = await prompt('profiles/claude.json', { knowledge_in_prompt: true, new_things_in_prompt: true },
            { messages: [{ role: 'user', content: 'steve: hi' }, { role: 'assistant', content: '!craftRecipe("stone_spear", 1)' },
                { role: 'system', content: 'Code output: done' }, { role: 'user', content: 'steve: thanks' }, { role: 'user', content: 'steve: ok' }] });
        assert.ok(command.includes(LINES.spear), 'the last command text counts');
        const nothing = await prompt('profiles/claude.json', { knowledge_in_prompt: true, new_things_in_prompt: true },
            { items: ['stone_pickaxe'], messages: [{ role: 'user', content: 'steve: bring me iron' }] });
        assert.ok(!nothing.includes('NEW SINCE'));
        assert.ok(nothing.includes(`${KNOWLEDGE}\nConversation Begin:`));
    });

    test('the oldest of more than 3 chat lines does not count', async () => {
        const text = await prompt('profiles/claude.json', { knowledge_in_prompt: true, new_things_in_prompt: true },
            { messages: ['steve: a shelf', 'steve: a', 'steve: b', 'steve: c'].map((content) => ({ role: 'user', content })) });
        assert.ok(!text.includes('NEW SINCE'));
    });

    test('with prompt_cache the block is in the changing part, after the knowledge block', async () => {
        const text = await prompt('profiles/defaults/_default.json', { knowledge_in_prompt: true, new_things_in_prompt: true, prompt_cache: true },
            { items: ['copper_pickaxe'] });
        assert.ok(text.includes(`${KNOWLEDGE}\n${HEADER}\n${LINES.copperTools}`));
    });
});
