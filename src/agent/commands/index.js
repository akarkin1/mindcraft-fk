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
        return `Command ${command.name} was given ${args.length} args, but requires ${params.length} args.`;

    
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
        guard.record(name, args, result);
    } catch (error) {
        console.warn('The repeat guard could not record the command:', error);
    }
}

// True when the command is the order that a player typed in the chat and that runs now (v0.1.4.8).
function typedOrder(agent, name) {
    const order = agent?.last_order;
    return order !== null && typeof order === 'object' && order.typed === true && order.command === name;
}

/**
 * Runs the command in a message. v0.1.4.8: with the setting repeat_guard (agent.repeat_guard), a command
 * of the model that failed the same way again and again is refused before it runs; a command that the
 * player typed is recorded and never refused (see recordRepeat). While it runs, the command is on
 * agent.running_commands ({ name, args, text, typed, pack? }), the last one is the newest.
 * @param {object} agent
 * @param {string} message
 * @param {{typed?: boolean}} [options] typed: the player typed the command in the chat; without it
 *   agent.last_order decides (an order with typed: true and the same command)
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
            return `Command ${command.name} was given ${numArgs} args, but requires ${numParams(command)} args.`;
        else {
            const typed = typeof options?.typed === 'boolean' ? options.typed : typedOrder(agent, command.name);
            const guard = agent?.repeat_guard ?? null;
            if (guard && !typed) {
                const refusal = guard.check(command.name, parsed.args);
                if (refusal) {
                    console.log('Repeat guard:', refusal);
                    return refusal;
                }
            }
            const running = { name: command.name, args: parsed.args, text: commandText(command.name, parsed.args), typed };
            const list = agent && typeof agent === 'object' ? (Array.isArray(agent.running_commands) ? agent.running_commands : (agent.running_commands = [])) : [];
            list.push(running);
            try {
                const result = await command.perform(agent, ...parsed.args);
                recordRepeat(guard, command.name, parsed.args, result, running.pack);
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
