// Command names for the routing list (tests/routing/sentences.json), the example check
// (tests/unit/examples_valid.test.js) and the routing check (scripts/routing_check.js).
// Pure data, no imports, no side effects.
//
// SPEC_COMMANDS are the commands of releases v0.1.4.6 to v0.1.4.10 that belong to a part, TAKEN FROM THE SPECS,
// because they do not exist in the code while the parts are written. At the join the real
// definitions in src/agent/commands/actions.js and queries.js take over: the example check
// prefers a real definition over an entry of this table, and has a switch to use only the real
// list (USE_SPEC_TABLE in tests/unit/examples_valid.test.js).

// Section 1 of the spec: the settings of this release and their types.
export const SPEC_SETTINGS = {
    cost_meter: 'boolean',
    cost_report_minutes: 'number',
    cost_warn_per_hour: 'number',
    cost_limit_per_hour: 'number',
    cost_limit_per_session: 'number',
    model_prices: 'object',
    max_command_result_chars: 'number',
    protected_areas: 'boolean',
    player_rules: 'boolean',
    rules_max: 'number',
    home_pack: 'boolean',
    home_reflexes: 'object',
    creeper_fighting: 'boolean',
    // v0.1.4.7, section 1 of its spec
    storage_pack: 'boolean',
    farming_pack: 'boolean',
    wood_pack: 'boolean',
    mining_pack: 'boolean',
    mining_max_minutes: 'number',
    keep_items: 'object',
    // v0.1.4.9, section 2 of its spec
    routes_pack: 'boolean',
    trail_max_steps: 'number',
    mine_routes: 'boolean',
    ore_sense_range: 'number',
    skills_over_code: 'boolean',
    // v0.1.4.12, section 2 of its spec
    watch_and_learn: 'boolean',
};

// The switches of the parts whose commands are hidden while the switch is off.
// cost_meter hides !cost: section 0 ("with its switch off, a part changes nothing") and the
// "Flags off" scenario of section 8 ("none of the new commands exists for the model") say so;
// the reply "The cost meter is off." of section 7 G1 is read as the answer when the switch is on
// but the meter could not start. This is an interpretation, see the report of Engineer R.
export const PART_COMMANDS = {
    player_rules: ['!rememberRule', '!forgetRule', '!rules'],
    protected_areas: ['!rememberArea', '!setArea', '!forgetArea', '!areas', '!allowChanges'],
    home_pack: ['!goToShelter', '!eat', '!closeDoor'],
    cost_meter: ['!cost'],
    // v0.1.4.7: the commands of the four sets (S4, F3, T5, M5 of its spec)
    storage_pack: ['!storeItems', '!fetchItem', '!chests'],
    farming_pack: ['!farmCycle', '!harvest', '!plant', '!makeBoneMeal', '!fertilize'],
    wood_pack: ['!chopTrees', '!getTool', '!craftSupplies'],
    mining_pack: ['!mineOre', '!goToMine', '!leaveMine', '!mines', '!forgetMine'], // v0.1.4.10 (R4): !mines, !forgetMine
    // v0.1.4.9: the commands of the routes pack and of the mine routes (I10 of its spec)
    routes_pack: ['!rememberRoute', '!routes', '!forgetRoute'],
    mine_routes: ['!rememberMine', '!rememberTunnel', '!collectPassedOre'],
    // v0.1.4.12 (part B): learning by watching
    watch_and_learn: ['!watchMe', '!continueLike', '!buildWatched'],
};

// Commands of this release, from the spec. `params` in order; `default` where the spec gives one.
// `assumed` marks what the spec leaves open.
export const SPEC_COMMANDS = [
    // v0.1.4.12 (part B, SPEC 4.4): learning by watching
    { name: '!watchMe', section: '4.4', part: 'watch_and_learn', params: [], description: 'Watch what I do and learn the pattern.' },
    { name: '!continueLike', section: '4.4', part: 'watch_and_learn', params: [{ name: 'size', type: 'string' }],
        description: 'Continue the pattern you watched, for a size.' },
    { name: '!buildWatched', section: '4.4', part: 'watch_and_learn', params: [], description: 'Build or dig what you understood, after I said yes.' },
    { name: '!rememberRule', section: 'R3', part: 'player_rules', params: [{ name: 'text', type: 'string' }],
        description: 'Save a lasting rule from the player: "always", "never", "remember", "do not forget", "from now on". One short sentence.' },
    { name: '!forgetRule', section: 'R3', part: 'player_rules', params: [{ name: 'number', type: 'int' }] },
    { name: '!rules', section: 'R3', part: 'player_rules', params: [] },
    { name: '!rememberArea', section: '6', part: 'protected_areas',
        params: [{ name: 'name', type: 'string' }, { name: 'type', type: 'string', default: 'building' }],
        description: 'Save the place you stand in as a protected area; without a type you conclude the kind (home, building, farm, pen, mine) from what is there. Use this when the player says "this is home", "this is the farm" or "this is the mine".' },
    { name: '!setArea', section: '6', part: 'protected_areas', assumed: 'types of the coordinates (float, as in actions.js)',
        params: [{ name: 'name', type: 'string' }, { name: 'type', type: 'string' },
            ...['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].map((name) => ({ name, type: 'float' }))] },
    { name: '!forgetArea', section: '6', part: 'protected_areas', params: [{ name: 'name', type: 'string' }] },
    { name: '!areas', section: '6', part: 'protected_areas', params: [] },
    { name: '!allowChanges', section: '6', part: 'protected_areas',
        params: [{ name: 'name', type: 'string' }, { name: 'minutes', type: 'int', default: 10 }],
        description: 'Allow yourself to break and place blocks in a protected area for some minutes, only when the player asks you to build, repair or break something there.' },
    { name: '!goToShelter', section: 'H7', part: 'home_pack', params: [],
        description: 'Go into your home and close the door. Use this when night comes, when monsters are near, when the player says "get to shelter", "go home" or "go inside".' },
    { name: '!eat', section: 'H7', part: 'home_pack', params: [],
        description: 'Eat until you are full, and until your health is full while you have food. Use this when the player tells you to eat, or when you are hungry or hurt.' },
    // v0.1.4.8 (section 11 of its spec): the command of the door service
    { name: '!closeDoor', section: '11', part: 'home_pack', params: [], description: 'Close the open doors, gates and trapdoors within 6 blocks of you.' },
    { name: '!cost', section: 'G1', part: 'cost_meter', params: [] },
    // v0.1.4.7 (sections S4, F3, T5 and M5 of its spec)
    { name: '!storeItems', section: 'S4', part: 'storage_pack', params: [],
        description: 'Put what you carry into a chest. You keep your tools, food and torches. Use this when your inventory is full, or when the player says "store", "stash" or "put it in the chest".' },
    { name: '!fetchItem', section: 'S4', part: 'storage_pack', params: [{ name: 'item_name', type: 'ItemName' }, { name: 'num', type: 'int', default: 1 }],
        description: 'Get an item out of a chest you know. Use this when you need something you do not carry, or when the player says "get" or "fetch" something from the chest.' },
    { name: '!chests', section: 'S4', part: 'storage_pack', params: [{ name: 'item', type: 'string', default: '' }], description: 'List the chests you know and what is in them, or which ones hold an item. From memory, no walk.' },
    { name: '!farmCycle', section: 'F3', part: 'farming_pack', params: [{ name: 'area', type: 'string', default: '' }],
        description: 'Do the whole farm round: harvest, store, plant, make bone meal in the composter and use it, close the gate. Use this when the player says "farm" or "take care of the wheat".' },
    { name: '!harvest', section: 'F3', part: 'farming_pack', params: [{ name: 'area', type: 'string', default: '' }],
        description: 'Harvest the ripe plants of a farm and plant them again. Use this when the player says "harvest" or "collect the wheat".' },
    { name: '!plant', section: 'F3', part: 'farming_pack', params: [{ name: 'seed', type: 'string', default: 'wheat_seeds' }, { name: 'area', type: 'string', default: '' }],
        description: 'Plant seeds on the free ground of a farm. Use this when the player says "plant", "seed" or "sow".' },
    { name: '!makeBoneMeal', section: 'F3', part: 'farming_pack', params: [{ name: 'num', type: 'int', default: 1 }],
        description: 'Make bone meal in the composter from compost items you carry, fetch from the chests you know or pick near the farm. Never seeds or food.' },
    { name: '!fertilize', section: 'F3', part: 'farming_pack', params: [{ name: 'area', type: 'string', default: '' }],
        description: 'Use your bone meal on the plants of a farm, so they grow faster.' },
    { name: '!chopTrees', section: 'T5', part: 'wood_pack', params: [{ name: 'num', type: 'IntOrString', default: 8 }, { name: 'kind', type: 'string', default: '' }],
        description: 'Cut whole trees and pick up the logs until you have that many, with an axe if you can get one. Only real trees. Use this when the player asks for wood.' },
    { name: '!getTool', section: 'T5', part: 'wood_pack', params: [{ name: 'kind', type: 'string' }, { name: 'material', type: 'string', default: '' }],
        description: 'Get a tool: from a chest you know, or crafted with everything it needs.' },
    { name: '!craftSupplies', section: 'T5', part: 'wood_pack', params: [{ name: 'item', type: 'string' }, { name: 'num', type: 'int', default: 1 }],
        description: 'Craft torches, ladders, a chest or a crafting table, and collect the wood for it.' },
    { name: '!mineOre', section: 'M5', part: 'mining_pack', params: [{ name: 'ore', type: 'string' }, { name: 'num', type: 'int', default: 8 }, { name: 'new_mine', type: 'boolean', default: false }],
        description: 'Mine an ore and come back. Without a known mine you first ask the player. Use this when the player asks for an ore.' },
    // v0.1.4.11 (part W, engineer E1): the descriptions of !goToMine and !leaveMine are shorter, so that the prompt with
    // the two lines of W6 and the description of !goToSurface (W4) stays at 17,000 characters
    { name: '!goToMine', section: 'M5', part: 'mining_pack', params: [{ name: 'ore', type: 'string', default: '' }],
        description: 'Go into your mine.' },
    { name: '!leaveMine', section: 'M5', part: 'mining_pack', params: [], description: 'Climb out of the mine.' },
    // v0.1.4.10 (R4 of its spec): the mines the bot knows; the descriptions are the glue's
    { name: '!mines', section: 'R4', part: 'mining_pack', params: [], description: 'List your mines.' },
    { name: '!forgetMine', section: 'R4', part: 'mining_pack', assumed: 'type of the parameter (string)', params: [{ name: 'name', type: 'string' }],
        description: 'Forget a mine.' },
    // v0.1.4.9 (I10 of its spec): names, parameters and defaults; the descriptions are the glue's
    { name: '!rememberRoute', section: 'I10', part: 'routes_pack', assumed: 'type of the parameter (string)', params: [{ name: 'name', type: 'string' }] },
    { name: '!routes', section: 'I10', part: 'routes_pack', params: [] },
    { name: '!forgetRoute', section: 'I10', part: 'routes_pack', assumed: 'type of the parameter (string)', params: [{ name: 'name', type: 'string' }] },
    { name: '!rememberMine', section: 'I10', part: 'mine_routes', assumed: 'type of the parameter (string)', params: [{ name: 'name', type: 'string', default: 'mine' }] },
    { name: '!rememberTunnel', section: 'I10', part: 'mine_routes', assumed: 'type of the parameter (string)', params: [{ name: 'name', type: 'string', default: '' }] },
    { name: '!collectPassedOre', section: 'I10', part: 'mine_routes', assumed: 'types of the parameters (string, int)',
        params: [{ name: 'ore', type: 'string' }, { name: 'num', type: 'int', default: 8 }] },
];

// The commands that exist in the code before this release (actions.js and queries.js of v0.1.4.5).
// tests/unit/examples_valid.test.js checks that each of them is in the real command list.
export const EXISTING_COMMANDS = [
    '!newAction', '!stop', '!stfu', '!restart', '!clearChat', '!goToPlayer', '!followPlayer',
    '!goToCoordinates', '!searchForBlock', '!searchForEntity', '!moveAway', '!rememberHere',
    '!goToRememberedPlace', '!forgetPlace', '!nameWorld', '!givePlayer', '!consume', '!equip',
    '!putInChest', '!takeFromChest', '!viewChest', '!discard', '!collectBlocks', '!craftRecipe',
    '!smeltItem', '!clearFurnace', '!placeHere', '!attack', '!attackPlayer', '!goToBed', '!stay',
    '!setMode', '!goal', '!endGoal', '!showVillagerTrades', '!tradeWithVillager',
    '!startConversation', '!endConversation', '!lookAtPlayer', '!lookAtPosition', '!digDown',
    '!goToSurface', '!useOn', '!forgetSkill', '!disableSkill', '!enableSkill', '!useSkill',
    '!stats', '!inventory', '!nearbyBlocks', '!craftable', '!entities', '!modes', '!savedPlaces',
    '!skills', '!checkBlueprintLevel', '!checkBlueprint', '!getBlueprint', '!getBlueprintLevel',
    '!getCraftingPlan', '!searchWiki', '!help',
];

// Commands of v0.1.4.8 that belong to no part: they are always offered (section 11 of its spec).
export const ALWAYS_COMMANDS = ['!pickUpItems'];

// Every command name that a sentence may expect.
export const ALL_COMMAND_NAMES = [...EXISTING_COMMANDS, ...ALWAYS_COMMANDS, ...SPEC_COMMANDS.map((c) => c.name)];

// A command definition in the form of actions.js for an entry of SPEC_COMMANDS, for the parser.
export function specCommandDef(entry) {
    const params = {};
    for (const p of entry.params) {
        params[p.name] = { type: p.type, description: p.name };
        if (p.default !== undefined) params[p.name].default = p.default;
    }
    return { name: entry.name, description: entry.description ?? entry.name, params, fromSpec: true };
}

// Default in code of each switch when the key is absent (section 1).
export const PART_DEFAULTS = { player_rules: false, protected_areas: false, home_pack: false, cost_meter: true,
    storage_pack: false, farming_pack: false, wood_pack: false, mining_pack: false };

// Whether a part is on: its switch, or its default when the key is absent. protected_areas also
// needs world_memory (section 1). mine_routes is the effective switch of v0.1.4.9: it also needs
// mining_pack and routes_pack, as the agent hides the mine commands otherwise.
export function partIsOn(settings, part) {
    const value = settings?.[part];
    const on = value === undefined ? PART_DEFAULTS[part] === true : value === true;
    if (part === 'protected_areas') return on && Boolean(settings?.world_memory);
    if (part === 'mine_routes') return on && partIsOn(settings, 'mining_pack') && partIsOn(settings, 'routes_pack');
    return on;
}

// The commands hidden for the model while the given settings are in effect: the commands of every
// part that is off.
export function hiddenPartCommands(settings) {
    const hidden = [];
    for (const [part, names] of Object.entries(PART_COMMANDS)) {
        if (!partIsOn(settings, part)) hidden.push(...names);
    }
    return hidden;
}
