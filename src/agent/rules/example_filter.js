// The pure part of "the prompter leaves out examples whose commands are hidden" (spec v0.1.4.6 R5).
// An example is a list of turns { role, content } as in profiles/defaults/_default.json.
// No imports, no side effects. Never throws.

// A command: ! and a name that starts with a letter. An ! right after another ! is text ("!!Error").
const CALL = /(?<!!)!([A-Za-z]\w*)/g;
const CODE_BLOCK = /```[\s\S]*?(?:```|$)/g;

// Roles whose turns can call commands: the bot itself and other bots (user turns). System turns
// hold output of the game, such as "... with this syntax: !commandName".
const CALLING_ROLES = ['assistant', 'user'];

/**
 * Every command call in a text, outside of code blocks (``` ... ```, an unclosed block runs to the
 * end), in order.
 * @param {string} text
 * @returns {{name: string, index: number}[]} the name with its ! and the position of the !
 */
export function commandCalls(text) {
    if (typeof text !== 'string')
        return [];
    const masked = text.replace(CODE_BLOCK, block => ' '.repeat(block.length));
    const calls = [];
    for (const match of masked.matchAll(CALL))
        calls.push({ name: '!' + match[1], index: match.index });
    return calls;
}

/**
 * The command names that an example uses, with their !, each once, in order of appearance.
 * Assistant and user turns are searched, system turns and code blocks are not.
 * @param {{role: string, content: string}[]} example
 * @returns {string[]}
 */
export function exampleCommands(example) {
    const names = [];
    if (!Array.isArray(example))
        return names;
    for (const turn of example) {
        let calls = [];
        try {
            if (turn !== null && typeof turn === 'object' && CALLING_ROLES.includes(turn.role))
                calls = commandCalls(turn.content);
        } catch {
            calls = []; // a turn that cannot be read is skipped
        }
        for (const call of calls) {
            if (!names.includes(call.name))
                names.push(call.name);
        }
    }
    return names;
}

/**
 * The examples without a hidden command, in their order, as a new list of the same example
 * objects. When isHidden throws for a name, the example counts as hidden. Without a function
 * isHidden nothing is hidden.
 * @param {Array} examples
 * @param {function(string): boolean} isHidden - gets a command name with its !
 * @returns {Array}
 */
export function visibleExamples(examples, isHidden) {
    if (!Array.isArray(examples))
        return [];
    if (typeof isHidden !== 'function')
        return examples.slice();
    const hidden = (name) => {
        try {
            return Boolean(isHidden(name));
        } catch {
            return true;
        }
    };
    return examples.filter(example => !exampleCommands(example).some(hidden));
}
