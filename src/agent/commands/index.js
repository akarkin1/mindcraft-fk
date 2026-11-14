import { getBlockId, getItemId } from "../../utils/mcdata.js";
import { actionsList } from './actions.js';
import { queryList } from './queries.js';
import { commandText } from '../repeat_guard.js';

let suppressNoDomainWarning = true;

const commandList = queryList.concat(actionsList);
const commandMap = {};
for (let command of commandList) {
    commandMap[command.name] = command;
}

/**
 * v0.1.4.16 (F8, "orders stay orders", the play of 2026-11-11: the model started !collectBlocks by itself): the commands
 * that are work. The model starts none of them without an order of the player or the supervisor behind it.
 */
export const WORK_COMMANDS = Object.freeze(['!collectBlocks', '!mineOre', '!chopTrees', '!farmCycle', '!harvest', '!plant', '!newAction',
    '!digDown', '!smeltItem', '!craftSupplies',
    // v0.1.4.16 round two: the packs' work (the owner: "no enchanting as it wishes")
    '!breed', '!enchant', '!killFarm']);
/** F8: the commands the model may not use against a command the player or the supervisor typed. */
export const STOP_COMMANDS = Object.freeze(['!stop', '!setMode']);
/**
 * The gate of a96685c (G-2, W132 C): the words of a player's or the supervisor's message that ask for a stop; only such words let
 * the model's !stop end a command someone typed (orderChainOf, orderRefusal).
 */
export const STOP_WORDS = /\b(stop|stops|stopping|halt|cancel|abort|enough|quit|pause|freeze|wait|hold on|never ?mind|forget it|leave it|drop it|end it)\b/i;
/** F8: the answers to the model, returned to it and never said. */
export const ORDER_TEXTS = Object.freeze({
    noOrder: 'I do not start work without an order from the player or the supervisor.',
    playersOrder: "That is the player's order; I do not stop it.",
});

export function getCommand(name) {
    return commandMap[name];
}

export function blacklistCommands(commands) {
    const unblockable = ['!stop', '!stats', '!inventory', '!goal'];
    for (let command_name of commands) {
        if (unblockable.includes(command_name)){
            console.warn(`Command ${command_name} is unblockable`);
            continue;
        }
        delete commandMap[command_name];
        delete commandList.find(command => command.name === command_name);
    }
}

// An argument is a number, true, false, a text in double quotes or a text in single quotes.
// Inside single quotes an apostrophe belongs to the text unless a comma, a closing parenthesis
// or the end follows it, so 'Don't break it' is one argument.
const argPattern = String.raw`-?\d+(?:\.\d+)?|true|false|"[^"]*"|'(?:[^']|'(?!\s*(?:[,)]|$)))*'`;
const commandRegex = new RegExp(String.raw`!(\w+)(?:\(((?:${argPattern})(?:\s*,\s*(?:${argPattern}))*)\))?`);
const argRegex = new RegExp(argPattern, 'g');

export function containsCommand(message) {
    const commandMatch = message.match(commandRegex);
    if (commandMatch)
        return "!" + commandMatch[1];
    return null;
}

export function commandExists(commandName) {
    if (!commandName.startsWith("!"))
        commandName = "!" + commandName;
    return commandMap[commandName] !== undefined;
}

/**
 * Converts a string into a boolean.
 * @param {string} input
 * @returns {boolean | null} the boolean or `null` if it could not be parsed.
 * */
function parseBoolean(input) {
    switch(input.toLowerCase()) {
        case 'false': //These are interpreted as flase;
        case 'f':
        case '0':
        case 'off':
            return false;
        case 'true': //These are interpreted as true;
        case 't':
        case '1':
        case 'on':
            return true;
        default:
            return null;
    }
}

/**
 * @param {number} value - the value to check
 * @param {number} lowerBound
 * @param {number} upperBound
 * @param {string} endpointType - The type of the endpoints represented as a two character string. `'[)'` `'()'` 
 */
function checkInInterval(number, lowerBound, upperBound, endpointType) {
    switch (endpointType) {
        case '[)':
            return lowerBound <= number && number < upperBound;
        case '()':
            return lowerBound < number && number < upperBound;
        case '(]':
            return lowerBound < number && number <= upperBound;
        case '[]':
            return lowerBound <= number && number <= upperBound;
        default:
            throw new Error('Unknown endpoint type:', endpointType)
    }
}



// todo: handle arrays?
/**
 * Returns an object containing the command, the command name, and the comand parameters.
 * If parsing unsuccessful, returns an error message as a string.
 * @param {string} message - A message from a player or language model containing a command.
 * @param {function(string): Object} lookup - Finds a command by name. Default: the command list.
 * @returns {string | Object}
 */
export function parseCommandMessage(message, lookup = getCommand) {
    const commandMatch = message.match(commandRegex);
    if (!commandMatch) return `Command is incorrectly formatted`;

    const commandName = "!"+commandMatch[1];

    let args;
    if (commandMatch[2]) args = commandMatch[2].match(argRegex);
    else args = [];

    const command = lookup(commandName);
    if(!command) return `${commandName} is not a command.`

    const params = commandParams(command);
    const paramNames = commandParamNames(command);
    
    if (args.length !== params.length && !defaultsFill(params, args.length))
        return argumentsText(command); // v0.1.4.11, W5

    
    for (let i = 0; i < args.length; i++) {
        const param = params[i];
        //Remove any extra characters
        let arg = args[i].trim();
        if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
            arg = arg.substring(1, arg.length-1);
        }
        
        //Convert to the correct type
        switch(param.type) {
            case 'int':
                arg = Number.parseInt(arg); break;
            case 'IntOrString':
                // v0.1.4.8: a whole number becomes a number, any other text stays text (!chopTrees takes its
                // arguments in either order, the command sorts them)
                if (/^-?\d+$/.test(arg.trim()))
                    arg = Number.parseInt(arg);
                break;
            case 'float':
                arg = Number.parseFloat(arg); break;
            case 'boolean':
                arg = parseBoolean(arg); break;
            case 'BlockName':
            case 'BlockOrItemName':
            case 'ItemName':
                if (arg.endsWith('plank') || arg.endsWith('seed'))
                    arg += 's'; // add 's' to for common mistakes like "oak_plank" or "wheat_seed"
            case 'string':
                break;
            default:
                throw new Error(`Command '${commandName}' parameter '${paramNames[i]}' has an unknown type: ${param.type}`);
        }
        if(arg === null || Number.isNaN(arg))
            return `Error: Param '${paramNames[i]}' must be of type ${param.type}.`

        if(typeof arg === 'number') { //Check the domain of numbers
            const domain = param.domain;
            if(domain) {
                /**
                 * Javascript has a built in object for sets but not intervals.
                 * Currently the interval (lowerbound,upperbound] is represented as an Array: `[lowerbound, upperbound, '(]']`
                 */
                if (!domain[2]) domain[2] = '[)'; //By default, lower bound is included. Upper is not.

                if(!checkInInterval(arg, ...domain)) {
                    return `Error: Param '${paramNames[i]}' must be an element of ${domain[2][0]}${domain[0]}, ${domain[1]}${domain[2][1]}.`;
                    //Alternatively arg could be set to the nearest value in the domain.
                }
            } else if (!suppressNoDomainWarning) {
                console.warn(`Command '${commandName}' parameter '${paramNames[i]}' has no domain set. Expect any value [-Infinity, Infinity].`)
                suppressNoDomainWarning = true; //Don't spam console. Only give the warning once.
            }
        } else if(param.type === 'BlockName') { //Check that there is a block with this name
            if(getBlockId(arg) == null) return  `Invalid block type: ${arg}.`
        } else if(param.type === 'ItemName') { //Check that there is an item with this name
            if(getItemId(arg) == null) return `Invalid item type: ${arg}.`
        } else if(param.type === 'BlockOrItemName') {
            if(getBlockId(arg) == null && getItemId(arg) == null) return  `Invalid block or item type: ${arg}.`
        }
        args[i] = arg;
    }
    for (let i = args.length; i < params.length; i++)
        args.push(params[i].default);
    
    return { commandName, args };
}

// The parameter types whose value is written in quotes in a call.
const QUOTED_TYPES = new Set(['string', 'ItemName', 'BlockName', 'BlockOrItemName']);

/**
 * The answer to a command called with the wrong number of arguments (v0.1.4.11, W5), built from its params:
 * `!rememberRoute takes 1 argument (name): !rememberRoute("name").`,
 * `!goToCoordinates takes 3 or 4 arguments (x, y, z, closeness): !goToCoordinates(x, y, z).`
 * The names in order; the parameters with a default at the end are counted in the range (`2 to 4 arguments`
 * for two of them); the example names the required ones, a string parameter in quotes. A command without
 * parameters: `!stop takes no arguments: !stop.` Never throws.
 * @param {Object} command
 * @returns {string}
 */
export function argumentsText(command) {
    const name = typeof command?.name === 'string' ? command.name : '!command';
    try {
        const params = commandParams(command);
        const names = commandParamNames(command);
        if (params.length === 0)
            return `${name} takes no arguments: ${name}.`;
        let required = 0;
        params.forEach((param, i) => {
            if (param?.default === undefined)
                required = i + 1; // a parameter with a default before a required one cannot be left out
        });
        const max = params.length;
        let count;
        if (required === max)
            count = `${max} ${max === 1 ? 'argument' : 'arguments'}`;
        else if (max - required === 1)
            count = `${required} or ${max} arguments`;
        else
            count = `${required} to ${max} arguments`;
        const example = names.slice(0, required).map((n, i) => (QUOTED_TYPES.has(params[i]?.type) ? `"${n}"` : n));
        const call = example.length > 0 ? `${name}(${example.join(', ')})` : name;
        return `${name} takes ${count} (${names.join(', ')}): ${call}.`;
    } catch {
        return `${name} was called with the wrong number of arguments.`;
    }
}

// True when fewer arguments than parameters are given and every missing parameter has a default.
function defaultsFill(params, given) {
    return given < params.length && params.slice(given).every(param => param.default !== undefined);
}

// ' (optional, default 4)' for a parameter with a default, '' otherwise. Texts are quoted.
function defaultNote(param) {
    if (param.default === undefined)
        return '';
    const value = typeof param.default === 'string' ? JSON.stringify(param.default) : String(param.default);
    return ` (optional, default ${value})`;
}

export function truncCommandMessage(message) {
    const commandMatch = message.match(commandRegex);
    if (commandMatch) {
        return message.substring(0, commandMatch.index + commandMatch[0].length);
    }
    return message;
}

export function isAction(name) {
    return actionsList.find(action => action.name === name) !== undefined;
}

/**
 * @param {Object} command
 * @returns {Object[]} The command's parameters.
 */
function commandParams(command) {
    if (!command.params)
        return [];
    return Object.values(command.params);
}

/**
 * @param {Object} command
 * @returns {string[]} The names of the command's parameters.
 */
function commandParamNames(command) {
    if (!command.params)
        return [];
    return Object.keys(command.params);
}

function numParams(command) {
    return commandParams(command).length;
}

/**
 * The text of the command in a message, as the player could type it: `!mineOre("iron", 8, false)`, with
 * the defaults filled in and strings in double quotes. The command as written when it does not parse,
 * null for a message without a command (v0.1.4.8, the restart context and the refusals of the guard).
 * @param {string} message
 * @returns {string|null}
 */
export function commandCallText(message) {
    if (typeof message !== 'string')
        return null;
    const match = message.match(commandRegex);
    if (!match)
        return null;
    try {
        const parsed = parseCommandMessage(message);
        if (typeof parsed === 'object' && parsed !== null)
            return commandText(parsed.commandName, parsed.args);
    } catch (error) {
        // the command as written
    }
    return match[0];
}

// v0.1.4.8 (F5): what the repeat guard learns of a command that ran. A command of a pack (pack: the result
// that runForText of actions.js noted on the entry of the command) counts as failed when the pack said
// ok: false, and a stopped one (reason interrupted) is not recorded; any other command gives its text and
// the guard judges it. Never throws.
function recordRepeat(guard, name, args, result, pack) {
    if (!guard)
        return;
    try {
        if (pack && typeof pack === 'object') {
            if (pack.reason !== 'interrupted')
                guard.record(name, args, typeof pack.text === 'string' ? pack.text : result, pack.ok === false);
            return;
        }
        // the heading of an action output is no part of the result that the refusal quotes
        guard.record(name, args, typeof result === 'string' ? result.replace(/^Action output:\s*/, '') : result);
    } catch (error) {
        console.warn('The repeat guard could not record the command:', error);
    }
}

// True when the command is the order that a player typed in the chat and that runs now (v0.1.4.8).
function typedOrder(agent, name) {
    const order = agent?.last_order;
    return order !== null && typeof order === 'object' && order.typed === true && order.command === name;
}

// v0.1.4.8 (X4): the player who typed the command: options.by, else the player of agent.last_order; null
// when it is not known.
function typedBy(agent, options) {
    if (typeof options?.by === 'string' && options.by !== '')
        return options.by;
    const by = agent?.last_order?.by;
    return typeof by === 'string' && by !== '' ? by : null;
}

// v0.1.4.10 (I4): who gave the command, for the job: 'system' for an order of the code (options.by 'system', or
// a call without options.typed that is no typed order, such as the goal of a task), the name of the player (or
// 'player') for a typed command, 'model' for a command of the model.
function orderBy(agent, options, typed) {
    if (options?.by === 'system')
        return 'system';
    if (typed)
        return typedBy(agent, options) ?? 'player';
    // v0.1.4.16 (F8): the supervisor's orders are the player's: a command of the watch's quiet message (F9, E2: handleMessage
    // hands `quiet` on to executeCommand's options) or of a call with by 'supervisor'
    if (options?.quiet === true || options?.by === 'supervisor')
        return typedBy(agent, options) ?? 'player';
    return options?.typed === false ? 'model' : 'system';
}

// v0.1.4.10 (I4): the items the bot carries, { name: count }; {} when they cannot be read. Never throws.
function inventoryCounts(agent) {
    const counts = {};
    try {
        for (const item of agent?.bot?.inventory?.items?.() ?? []) {
            if (item && typeof item.name === 'string' && Number.isFinite(item.count))
                counts[item.name] = (counts[item.name] ?? 0) + item.count;
        }
    } catch (error) {
        // no inventory: no gain
    }
    return counts;
}

// v0.1.4.10 (I4): { name: after - before } for every item whose count changed.
function inventoryGain(before, after) {
    const gain = {};
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const change = (after[name] ?? 0) - (before[name] ?? 0);
        if (change !== 0)
            gain[name] = change;
    }
    return gain;
}

// v0.1.4.13 (P6): the text with which agent.job refuses a command of the model while a skill of the job runs, or null
// (no job, no refusal, a job without the method). Never throws.
function jobRefusal(job, name, by) {
    try {
        const text = typeof job?.refusal === 'function' ? job.refusal(name, by, !isAction(name)) : null;
        return typeof text === 'string' && text.length > 0 ? text : null;
    } catch (error) {
        console.warn('The job could not judge the command:', error);
        return null;
    }
}

/**
 * v0.1.4.16 (review 16, findings 1 and 5, the lead's decision): the order behind the chain of one message, `{ by, at }`, which
 * handleMessage keeps as agent.order_chain and hands to the model's commands of its loop (options.chain of executeCommand).
 * by: the source for a player's message (any source but the bot itself and 'system'; another bot's too, whose line was a
 * player's turn before) and for a quiet message of the watch queue (the supervisor's; 'supervisor' when it carries no player's
 * name); 'model' for an AUTO MESSAGE of a mode (also when it comes in the last sender's name), a self prompt (the self
 * prompter's system line, the bot's own name) and every other system message (the death, the init message, a conversation's
 * timeout). The orders of a job and of a routine never come through handleMessage: they are system orders of executeCommand
 * (by 'system') and need no chain. at: the time of the message in ms. stop (the gate of a96685c, G-2, W132 C): a player's or
 * the supervisor's words that ask for a stop (STOP_WORDS); only then may the model's !stop end a command someone typed
 * (orderRefusal). Never throws.
 * @param {string} source the source of handleMessage
 * @param {string} message
 * @param {{quiet?: boolean, self?: string, at?: number}} [options] quiet: a message of the watch queue; self: the bot's name
 * @returns {{by: string, at: number, stop?: boolean}}
 */
export function orderChainOf(source, message, options = {}) {
    const opts = options !== null && typeof options === 'object' ? options : {};
    const at = typeof opts.at === 'number' && Number.isFinite(opts.at) ? opts.at : Date.now();
    try {
        const name = typeof source === 'string' ? source : '';
        const own = name === '' || name === 'system' || (typeof opts.self === 'string' && opts.self !== '' && name === opts.self);
        if (typeof message === 'string' && message.trimStart().startsWith('(AUTO MESSAGE)'))
            return { by: 'model', at };
        const stop = typeof message === 'string' && STOP_WORDS.test(message);
        if (opts.quiet === true)
            return { by: own ? 'supervisor' : name, at, stop };
        return own ? { by: 'model', at } : { by: name, at, stop };
    } catch (error) {
        console.warn('The order of the message could not be judged:', error);
        return { by: 'model', at };
    }
}

/**
 * v0.1.4.16 (F8; review 16, findings 1 and 5): the answer to the model for a command it may not give, or null. Only a command
 * of the model whose chain is the model's own (orderChainOf: an AUTO MESSAGE of a mode, a self prompt, a system message) is
 * judged: a work command (WORK_COMMANDS) gets ORDER_TEXTS.noOrder; !stop or !setMode while a command the player or the
 * supervisor typed runs (agent.running_commands with typed) gets ORDER_TEXTS.playersOrder. The model's commands in a player's
 * or the supervisor's chain pass (the owner's spoken "stop" works), and so do the player's typed commands and the system orders
 * (a job's resume, a routine's round); only the model's !stop there is judged by the words (the gate of a96685c, G-2, W132 C):
 * while someone's typed command runs it passes when the words asked for a stop (chain.stop, STOP_WORDS) or when the job
 * refused the model's answer in the same loop with "Say !stop first" (chain.jobAsked, review 16c finding 1), else it gets
 * ORDER_TEXTS.playersOrder ("how is it going?" answered with !stop ends nothing). A self prompt of a player's goal (chain.goal
 * true, review 16b finding 4) may start work but gets the !stop and !setMode refusal like the model's own chain. A pack's line
 * in the history and a refusal change nothing: the chain is not read from the history. Without a chain (no handleMessage
 * behind the call) nothing is refused. Never throws.
 * @param {object} agent
 * @param {string} name the command
 * @param {string} by orderBy: 'model', 'system' or the player
 * @param {{by: string, at: number, goal?: boolean, stop?: boolean}|null} [chain] the chain of the loop (options.chain); else
 *   agent.order_chain
 * @returns {string|null}
 */
export function orderRefusal(agent, name, by, chain = null) {
    try {
        if (by !== 'model')
            return null;
        const behind = chain !== null && typeof chain === 'object' ? chain : agent?.order_chain;
        if (behind === null || typeof behind !== 'object')
            return null;
        const typedRuns = () => (Array.isArray(agent?.running_commands) ? agent.running_commands : [])
            .some(r => r && r.typed === true && r.name !== name);
        // review 16b, finding 4: a self prompt of a player's goal (goal: true, agent.js) may start work, but the model stops no
        // command the player or the supervisor typed meanwhile
        const goal = behind.goal === true;
        if (behind.by !== 'model' && !goal) {
            // G-2 (W132 C): a player's or the supervisor's words that did not ask for a stop stop no typed command, unless the job
            // refused the model's answer to them with "Say !stop first" in this loop (review 16c, finding 1: jobAsked)
            return name === '!stop' && behind.stop !== true && behind.jobAsked !== true && typedRuns() ? ORDER_TEXTS.playersOrder : null;
        }
        if (STOP_COMMANDS.includes(name)) {
            return typedRuns() ? ORDER_TEXTS.playersOrder : null;
        }
        return !goal && WORK_COMMANDS.includes(name) ? ORDER_TEXTS.noOrder : null;
    } catch (error) {
        console.warn('The order of the command could not be judged:', error);
        return null;
    }
}

// v0.1.4.10 (I4): onCommand of agent.job (job_memory) before the command runs. Never throws.
function jobBefore(agent, running, by) {
    try {
        agent.job.onCommand(running.name, running.args, by, running.text);
    } catch (error) {
        console.warn('The job could not note the command:', error);
    }
}

// v0.1.4.10 (I4): onResult of agent.job after the command ran: the result of the pack when there is one, else
// the text; undefined for a stopped command; the gain of the inventory. Not awaited (a plan asks the model);
// the part that ends a system order of the job runs at once. Never throws.
function jobAfter(agent, running, result, before) {
    try {
        const value = result === undefined ? undefined : (running.pack ?? result);
        Promise.resolve(agent.job.onResult(running.name, value, inventoryGain(before, inventoryCounts(agent))))
            .catch((error) => console.warn('The job could not note the result:', error));
    } catch (error) {
        console.warn('The job could not note the result:', error);
    }
}

/**
 * Runs the command in a message. v0.1.4.8: with the setting repeat_guard (agent.repeat_guard), a command
 * of the model that failed the same way again and again is refused before it runs; a command that the
 * player typed is recorded and never refused (see recordRepeat). While it runs, the command is on
 * agent.running_commands ({ name, args, text, typed, by?, pack? }), the last one is the newest. by (v0.1.4.8,
 * X4): the player who typed it, options.by or the player of agent.last_order; a stopped command tells him.
 * v0.1.4.10 (I4): with agent.job (job_memory) its onCommand runs before the command and its onResult after it.
 * @param {object} agent
 * @param {string} message
 * @param {{typed?: boolean, by?: string, quiet?: boolean, chain?: {by: string, at: number}}} [options] typed: the player typed the
 *   command in the chat; without it agent.last_order decides (an order with typed: true and the same command). by 'system'
 *   (v0.1.4.10): an order of the job, never typed. chain (review 16): the order behind handleMessage's loop (orderChainOf),
 *   for the model's commands; without it agent.order_chain
 * @returns {Promise<string|undefined>}
 */
export async function executeCommand(agent, message, options = {}) {
    let parsed = parseCommandMessage(message);
    if (typeof parsed === 'string')
        return parsed; //The command was incorrectly formatted or an invalid input was given.
    else {
        console.log('parsed command:', parsed);
        const command = getCommand(parsed.commandName);
        let numArgs = 0;
        if (parsed.args) {
            numArgs = parsed.args.length;
        }
        if (numArgs !== numParams(command))
            return argumentsText(command); // v0.1.4.11, W5
        else {
            const typed = options?.by === 'system' ? false : (typeof options?.typed === 'boolean' ? options.typed : typedOrder(agent, command.name));
            const guard = agent?.repeat_guard ?? null;
            if (guard && !typed) {
                const refusal = guard.check(command.name, parsed.args);
                if (refusal) {
                    console.log('Repeat guard:', refusal);
                    return refusal;
                }
            }
            const running = { name: command.name, args: parsed.args, text: commandText(command.name, parsed.args), typed };
            const by = typed ? typedBy(agent, options) : null;
            if (by)
                running.by = by;
            if (options?.chain && typeof options.chain === 'object')
                running.chain = options.chain; // review 16b, finding 5: !goal reads who set the goal from it (goalSetterOf)
            const job = agent?.job ?? null; // v0.1.4.10: null without job_memory
            // v0.1.4.13 (P6): a command the model picks while a skill of the job runs is not run; the answer goes to the
            // model as a system line (the caller adds the text to the history). !stop, the queries, the owner's typed
            // command and a system order pass.
            const refusal = jobRefusal(job, command.name, orderBy(agent, options, typed));
            if (refusal !== null) {
                console.log('Job:', refusal);
                // review 16c, finding 1: the job asked the model for a !stop first ("come here" while the owner's typed job runs):
                // the !stop of this message's loop goes through (orderRefusal, jobAsked)
                const chain = options?.chain;
                if (chain && typeof chain === 'object' && orderBy(agent, options, typed) === 'model')
                    chain.jobAsked = true;
                return refusal;
            }
            // v0.1.4.16 (F8, "orders stay orders"): the model starts no work on its own and stops no command of the player
            // or the supervisor; the answer goes to the model as a system line (the caller adds it to the history). Review 16
            // (findings 1 and 5): judged by the chain of handleMessage's loop (options.chain, else agent.order_chain)
            const order = orderRefusal(agent, command.name, orderBy(agent, options, typed), options?.chain ?? null);
            if (order !== null) {
                console.log('Order:', order);
                return order;
            }
            const list = agent && typeof agent === 'object' ? (Array.isArray(agent.running_commands) ? agent.running_commands : (agent.running_commands = [])) : [];
            list.push(running);
            const before = job ? inventoryCounts(agent) : null;
            if (job)
                jobBefore(agent, running, orderBy(agent, options, typed));
            try {
                const result = await command.perform(agent, ...parsed.args);
                recordRepeat(guard, command.name, parsed.args, result, running.pack);
                if (job)
                    jobAfter(agent, running, result, before);
                return result;
            } finally {
                const at = list.indexOf(running);
                if (at >= 0)
                    list.splice(at, 1);
            }
        }
    }
}

export function getCommandDocs(agent, commands = commandList) {
    const typeTranslations = {
        //This was added to keep the prompt the same as before type checks were implemented.
        //If the language model is giving invalid inputs changing this might help.
        'float':             'number',
        'int':               'number',
        'BlockName':         'string',
        'ItemName':          'string',
        'BlockOrItemName':   'string',
        'IntOrString':       'number',
        'boolean':           'bool'
    }
    let docs = `\n*COMMAND DOCS\n You can use the following commands to perform actions and get information about the world. 
    Use the commands with the syntax: !commandName or !commandName("arg1", 1.2, ...) if the command takes arguments.\n
    Do not use codeblocks. Use double quotes for strings. Only use one command in each response, trailing commands and comments will be ignored.\n`;
    for (let command of commands) {
        if (agent.blocked_actions.includes(command.name)) {
            continue;
        }
        docs += command.name + ': ' + command.description + '\n';
        if (command.params) {
            docs += 'Params:\n';
            for (let param in command.params) {
                docs += `${param}: (${typeTranslations[command.params[param].type]??command.params[param].type}) ${command.params[param].description}${defaultNote(command.params[param])}\n`;
            }
        }
    }
    return docs + '*\n';
}
