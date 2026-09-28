// Command names for the routing list (tests/routing/sentences.json), the example check
// (tests/unit/examples_valid.test.js) and the routing check (scripts/routing_check.js).
// Pure data, no imports, no side effects.
//
// SPEC_COMMANDS are the commands of release v0.1.4.6, TAKEN FROM THE SPEC (sections 4 to 7),
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
};

// The switches of the parts whose commands are hidden while the switch is off.
// cost_meter hides !cost: section 0 ("with its switch off, a part changes nothing") and the
// "Flags off" scenario of section 8 ("none of the new commands exists for the model") say so;
// the reply "The cost meter is off." of section 7 G1 is read as the answer when the switch is on
// but the meter could not start. This is an interpretation, see the report of Engineer R.
export const PART_COMMANDS = {
    player_rules: ['!rememberRule', '!forgetRule', '!rules'],
    protected_areas: ['!rememberArea', '!setArea', '!forgetArea', '!areas', '!allowChanges'],
    home_pack: ['!goToShelter', '!eat'],
    cost_meter: ['!cost'],
};

// Commands of this release, from the spec. `params` in order; `default` where the spec gives one.
// `assumed` marks what the spec leaves open.
export const SPEC_COMMANDS = [
    { name: '!rememberRule', section: 'R3', part: 'player_rules', params: [{ name: 'text', type: 'string' }],
        description: 'Save a lasting rule from the player. Use this when the player tells you to always or never do something, or says "remember", "do not forget" or "from now on". Write the rule as one short sentence.' },
    { name: '!forgetRule', section: 'R3', part: 'player_rules', params: [{ name: 'number', type: 'int' }] },
    { name: '!rules', section: 'R3', part: 'player_rules', params: [] },
    { name: '!rememberArea', section: '6', part: 'protected_areas',
        params: [{ name: 'name', type: 'string' }, { name: 'type', type: 'string', default: 'building' }],
        description: 'Remember the building or the fenced farm you are standing in as a protected area. In a building you will not break or place blocks. In a farm you will only plant and harvest. Use this when the player says "this is home", "this is our base", "this is the farm", or tells you not to damage a place.' },
    { name: '!setArea', section: '6', part: 'protected_areas', assumed: 'types of the coordinates (float, as in actions.js)',
        params: [{ name: 'name', type: 'string' }, { name: 'type', type: 'string' },
            ...['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].map((name) => ({ name, type: 'float' }))] },
    { name: '!forgetArea', section: '6', part: 'protected_areas', params: [{ name: 'name', type: 'string' }] },
    { name: '!areas', section: '6', part: 'protected_areas', params: [] },
    { name: '!allowChanges', section: '6', part: 'protected_areas',
        params: [{ name: 'name', type: 'string' }, { name: 'minutes', type: 'int', default: 10 }],
        description: 'Allow yourself to break and place blocks in a protected area for some minutes. Use this ONLY when the player tells you to build, repair or break something inside that area.' },
    { name: '!goToShelter', section: 'H7', part: 'home_pack', params: [],
        description: 'Go to your shelter, get in through the door and close it. Use this when night comes, when monsters are near, when the player says "get to shelter", "go home" or "go inside".' },
    { name: '!eat', section: 'H7', part: 'home_pack', params: [],
        description: 'Eat the best food you have. Use this when you are hungry or hurt, or when the player tells you to eat.' },
    { name: '!cost', section: 'G1', part: 'cost_meter', params: [] },
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

// Every command name that a sentence may expect.
export const ALL_COMMAND_NAMES = [...EXISTING_COMMANDS, ...SPEC_COMMANDS.map((c) => c.name)];

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
export const PART_DEFAULTS = { player_rules: false, protected_areas: false, home_pack: false, cost_meter: true };

// Whether a part is on: its switch, or its default when the key is absent. protected_areas also
// needs world_memory (section 1).
export function partIsOn(settings, part) {
    const value = settings?.[part];
    const on = value === undefined ? PART_DEFAULTS[part] === true : value === true;
    if (part === 'protected_areas') return on && Boolean(settings?.world_memory);
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
