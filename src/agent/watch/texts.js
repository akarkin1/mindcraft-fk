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
    streamEnded: 'The stream of events ended.',
});
