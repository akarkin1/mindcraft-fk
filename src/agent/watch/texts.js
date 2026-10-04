// v0.1.4.12 (part C): the texts of the watch server, word for word where the spec (section 4.1) gives them.
// Pure: no imports, every function returns a string.

function plural(n, word) {
    if (n === 1)
        return word;
    if (word === 'sheep')
        return word;
    return `${word}s`;
}

export const TEXTS = Object.freeze({
    // spec 4.1, word for word
    noToken: 'The watch server does not start: MC_WATCH_TOKEN is not set.',
    started: (port) => `The watch server listens on 127.0.0.1:${port}.`,
    // v0.1.4.13 (watch_local_only)
    startedLocal: (port) => `The watch server listens on 127.0.0.1:${port}, for this machine only, without a token.`,
    localOnly: (why) => `This watch server is for this machine only: ${why}.`,
    noCommands: 'I do not run server commands.',

    // the start (decided by E1)
    badPort: (port) => `The watch server does not start: "${port}" is no port number from 1 to 65535.`,
    listenFailed: (port, code) => `The watch server does not start: port ${port} on 127.0.0.1 is not free (${code}).`,

    // the protocol
    unauthorized: 'unauthorized',
    tooLarge: 'The request is larger than 64 KB.',
    parseError: 'The body is no JSON.',
    invalidRequest: 'The body is no JSON-RPC 2.0 request.',
    unknownMethod: (method) => `Unknown method: ${method}.`,
    unknownTool: (name) => `Unknown tool: ${name}.`,
    toolFailed: (name, cause) => `The tool ${name} failed: ${cause}.`,

    // the tools
    noWorld: (name) => `${name} is not in a world yet.`,
    position: (name, pos, dimension, under, time, phase, health, food) =>
        `${name} at ${pos} in ${dimension}, on ${under}. Time ${time} (${phase}). Health ${health} of 20, food ${food} of 20.`,
    running: (what, seconds) => `Running: ${what} for ${seconds} s.`,
    runningNothing: 'Running: nothing.',
    noJob: 'Job: none.',
    lastOrder: (text, by, ago) => `Last order: "${text}" by ${by}, ${ago}.`,
    noLastOrder: 'Last order: none.',
    home: (pos, blocks) => `Home: ${pos}, ${blocks} ${plural(blocks, 'block')} away.`,
    homeElsewhere: (pos, dimension) => `Home: ${pos} in ${dimension}.`,
    noHome: 'Home: unknown.',
    inventory: (list) => `Inventory: ${list}.`,
    inventoryEmpty: 'Inventory: empty.',
    hands: (hand, offHand) => `Hand: ${hand}. Off-hand: ${offHand}.`,
    noChat: 'No chat yet.',
    areas: (list) => `Areas: ${list}.`,
    noAreas: 'No areas.',
    mines: (list) => `Mines: ${list}.`,
    mine: (name, entrance, tunnels) => `${name}, entrance ${entrance}, ${tunnels} ${plural(tunnels, 'tunnel')}`,
    noMines: 'No mines.',
    routes: (list) => `Routes: ${list}.`,
    noRoutes: 'No routes.',
    rules: (list) => `Rules: ${list}`,
    noRules: 'No rules.',
    noEvents: 'No events.',
    badSince: (since) => `The time "${since}" is no ISO time like 2026-10-03T13:45:02Z.`,
    badText: 'The text must have 1 to 256 characters.',
    said: (name, text) => `Said as ${name}: "${text}".`,
    sayFailed: (cause) => `The line was not handed to the bot: ${cause}.`,

    // the events (spec 4.1, word for word)
    explosion: (blocks, area, pos) => `Explosion ${blocks} blocks from the area "${area}" at ${pos}.`,
    health: (from, to, pos) => `Health fell from ${from} to ${to} at ${pos}.`,
    animalsMissing: (pen, parts) => `The pen "${pen}" has ${parts.join('; ')}.`,
    animalsPart: (count, animal, record) => `${count} ${plural(count, animal)}, the record says ${record}`,
    nightAwake: 'The night passed without sleep.',
    jobStalled: (job, minutes) => `The job (${job}) made no progress for ${minutes} minutes.`,
    failureRepeated: (times, text) => `The same failure ${times} times: "${text}".`,
    farFromHome: (name, blocks, pos) => `${name} is ${blocks} blocks from home at ${pos}.`,
    death: (name, pos) => `${name} died at ${pos}.`,
    restart: (name) => `${name} started.`,

    // the client (scripts/watch.js)
    refused: (cause) => `The watch server refused the call: ${cause}.`,
    noAnswer: (url, cause) => `The watch server at ${url} does not answer: ${cause}.`,

    // v0.1.4.13 (part S): the digest (spec 4.1, word for word)
    cursor: (n) => `Cursor: ${n}.`,
    nothingChanged: 'Nothing changed.',
    at: (pos, dimension) => `At ${pos} in ${dimension}.`,
    atMoved: (pos, dimension, blocks) => `At ${pos} in ${dimension}, moved ${blocks} ${plural(blocks, 'block')}.`,
    healthFood: (health, food) => `Health ${health} of 20, food ${food} of 20.`,
    inventoryChanges: (list) => `Inventory: ${list}.`,
    hand: (name, uses) => `Hand: ${name}, ${uses} ${plural(uses, 'use')} left.`,
    handPlain: (name) => `Hand: ${name}.`,
    handEmpty: 'Hand: empty.',
    chatNew: (n) => `Chat: ${n} new ${plural(n, 'line')}.`,
    eventsNew: (n) => `Events: ${n} new.`,
    hazards: (list) => `Hazards: ${list}.`,
    hazard: (kind, blocks, pos) => `${kind} ${blocks} ${plural(blocks, 'block')} away at ${pos}`,
    hazardDrop: (count, name, blocks, pos) => `${count} ${name} on the ground ${blocks} ${plural(blocks, 'block')} away at ${pos}`,
    noHazards: 'Hazards: none.',
    chest: (pos, free, blocks) => `Chest: ${pos}, ${free} free ${plural(free, 'slot')}, ${blocks} ${plural(blocks, 'block')} away.`,
    noChest: 'Chest: none.',

    // wait
    woke: (reason) => `Woke: ${reason}.`,
    tooManyWaits: (n) => `Too many waits: ${n} are open.`,
    badWaitFor: (value) => `wait takes for: event, idle, done or any, not "${value}".`, // decided by E1
    badTimeout: (value) => `wait takes a timeout of 1 to 55 seconds, not "${value}".`, // decided by E1

    // run
    ran: (done, total) => `Ran ${done} of ${total}.`,
    ranLine: (n, command, text) => `${n}. ${command}: ${text}`,
    runStarted: 'started.',
    stillRunning: (n, total) => `Still running: ${n} of ${total}.`,
    commandsOnly: 'run takes commands only; use say for words.',
    badCommands: 'run takes commands: an array of 1 to 10 strings.', // decided by E1
    stoppedAt: (n, total) => `Stopped at ${n} of ${total}.`, // decided by E1: the stop rule
    stoppedBy: (who, n, total) => `Stopped by ${who} at ${n} of ${total}.`, // decided by E1: !stop of the owner
    queued: (n) => `Queued: I run it after ${n} ${plural(n, 'command')}.`, // decided by E1: the owner's command behind the queue
    notRun: 'not run', // decided by E1: the line of a command the queue never reached
    runFailed: (cause) => `The command was not handed to the bot: ${cause}.`, // decided by E1

    // look
    ores: (list) => `Ores: ${list}.`,
    oreVein: (name, count, pos) => `${name} ${count} at ${pos}`,
    oreSpread: (name, count, pos) => `${name} ${count} nearest at ${pos}`,
    lava: (blocks, pos) => `Lava: ${blocks} ${plural(blocks, 'block')} away at ${pos}.`,
    noLava: (radius) => `Lava: none within ${radius}.`,
    water: (blocks, pos) => `Water: ${blocks} ${plural(blocks, 'block')} away at ${pos}.`,
    noWater: (radius) => `Water: none within ${radius}.`,
    chests: (list) => `Chests: ${list}.`,
    chestEntry: (pos, free) => `${pos} ${free} free ${plural(free, 'slot')}`,
    chestUnknown: (pos) => `${pos}`, // decided by E1: a chest the index does not know
    furnaces: (list) => `Furnaces: ${list}.`,
    ladders: (list) => `Ladders: ${list}.`,
    ladder: (pos, height) => `${pos} up to ${height}`,
    doors: (list) => `Doors and gates: ${list}.`,
    door: (name, pos, state) => `${name} at ${pos}, ${state}`,
    drops: (list) => `Drops: ${list}.`,
    drop: (count, name, pos) => `${count} ${name} at ${pos}`,
    players: (list) => `Players: ${list}.`,
    player: (name, pos, blocks) => `${name} at ${pos}, ${blocks} ${plural(blocks, 'block')} away`,
    badRadius: (value) => `look takes a radius of 4 to 32, not "${value}".`, // decided by E1

    // server
    up: (minutes, heap, limit, lag) => `Up ${minutes}, heap ${heap} of ${limit} MB, tick lag ${lag} ms.`,
    playersOnline: (list) => `Players: ${list}.`,
    noPlayers: 'Players: none.', // decided by E1
    timeWeather: (time, phase, weather) => `Time ${time} (${phase}), weather ${weather}.`,
    modelCalls: (calls, session) => `Model calls ${calls}, session ${session}.`,
    noCostMeter: 'Model calls: no cost meter.', // decided by E1
    switchesOn: (list) => `Switches on: ${list}.`,
    noSwitches: 'Switches on: none.', // decided by E1
    supervisorConnected: (ago) => `Supervisor: connected ${ago}.`,
    noSupervisor: 'Supervisor: none.',

    // the help event
    help: (text) => `Help: "${text}"`,
});
