// Pure helpers for the source text of generated code and saved skills (spec K1).
// Generated code is the body of an async function with the parameter `bot`.
import * as espree from 'espree';

const WRAP_PREFIX = '(async (bot) => {\n';
const WRAP_SUFFIX = '\n})';
const INDENT = '    ';

function parseOptions() {
    return { ecmaVersion: 'latest', sourceType: 'script', range: true, comment: true };
}

function isNode(value) {
    return value !== null && typeof value === 'object' && typeof value.type === 'string';
}

// Pre-order walk in source order. Iterative, so deep nesting cannot overflow the stack.
function forEachNode(root, visit) {
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!isNode(node)) {
            continue;
        }
        visit(node);
        const keys = espree.VisitorKeys[node.type] ?? Object.keys(node);
        for (let i = keys.length - 1; i >= 0; i--) {
            const child = node[keys[i]];
            if (Array.isArray(child)) {
                for (let j = child.length - 1; j >= 0; j--) {
                    stack.push(child[j]);
                }
            } else if (isNode(child)) {
                stack.push(child);
            }
        }
    }
}

function errorText(err) {
    if (typeof err?.message === 'string' && err.message !== '') {
        return err.message;
    }
    try {
        return String(err);
    } catch {
        return 'Unknown error';
    }
}

// Name of a parameter; null for a destructured or rest parameter.
function paramName(param) {
    if (param?.type === 'Identifier') {
        return param.name;
    }
    if (param?.type === 'AssignmentPattern' && param.left?.type === 'Identifier') {
        return param.left.name;
    }
    return null;
}

function paramText(param, position) {
    return typeof param === 'string' && param !== '' ? param : `arg${position}`;
}

// The block of the wrapping arrow function, or null when the code breaks out of it.
function wrapperBody(ast, length) {
    if (ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement') {
        return null;
    }
    const arrow = ast.body[0].expression;
    if (arrow?.type !== 'ArrowFunctionExpression' || arrow.body?.type !== 'BlockStatement') {
        return null;
    }
    const [start, end] = arrow.body.range;
    if (start !== WRAP_PREFIX.length - 2 || end !== length - 1) {
        return null;
    }
    return arrow.body;
}

// The outermost function with a block body that starts first, and the comment list.
function findFunction(source) {
    if (typeof source !== 'string') {
        return null;
    }
    let ast;
    try {
        ast = espree.parse(source, parseOptions());
    } catch {
        return null;
    }
    let found = null;
    forEachNode(ast, node => {
        const isFunction = node.type === 'FunctionDeclaration'
            || node.type === 'FunctionExpression'
            || node.type === 'ArrowFunctionExpression';
        if (isFunction && node.body?.type === 'BlockStatement'
            && (found === null || node.range[0] < found.range[0])) {
            found = node;
        }
    });
    return found === null ? null : { fn: found, comments: ast.comments ?? [] };
}

/**
 * Normalizes source text: CRLF becomes LF, trailing whitespace at the end is
 * removed, and the result ends with exactly one line break.
 * @param {string} text
 * @returns {string} the normalized text, '' when text is not a string
 */
export function normalizeSource(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text.split('\r\n').join('\n').trimEnd() + '\n';
}

/**
 * Parses generated code as the body of `async (bot) => { ... }`. Never throws.
 * `functions` holds the function declarations that are direct statements of the body,
 * `topLevelCalls` the names called with a plain identifier as callee anywhere in the
 * other direct statements, without duplicates, in order of first appearance.
 * @param {string} code
 * @returns {{ok: boolean, error: string|null,
 *   functions: {name: string, async: boolean, params: (string|null)[], source: string}[],
 *   topLevelCalls: string[]}}
 */
export function parseGeneratedCode(code) {
    const failed = error => ({ ok: false, error, functions: [], topLevelCalls: [] });
    if (typeof code !== 'string') {
        return failed('The code is not a string.');
    }
    try {
        const wrapped = WRAP_PREFIX + code + WRAP_SUFFIX;
        const ast = espree.parse(wrapped, parseOptions());
        const body = wrapperBody(ast, wrapped.length);
        if (body === null) {
            return failed('The code closes the function body it is wrapped in.');
        }
        const offset = WRAP_PREFIX.length;
        const functions = [];
        const calls = [];
        for (const statement of body.body) {
            if (statement.type === 'FunctionDeclaration') {
                functions.push({
                    name: statement.id?.name ?? null,
                    async: statement.async === true,
                    params: statement.params.map(paramName),
                    source: code.slice(statement.range[0] - offset, statement.range[1] - offset),
                });
                continue;
            }
            forEachNode(statement, node => {
                if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
                    calls.push({ at: node.callee.range[0], name: node.callee.name });
                }
            });
        }
        calls.sort((a, b) => a.at - b.at);
        const topLevelCalls = [];
        for (const call of calls) {
            if (!topLevelCalls.includes(call.name)) {
                topLevelCalls.push(call.name);
            }
        }
        return { ok: true, error: null, functions, topLevelCalls };
    } catch (err) {
        return failed(errorText(err));
    }
}

/**
 * Picks the one function of parsed generated code that can become a skill.
 * Reasons, first failing wins: parse_error, no_function, several_functions,
 * not_async, first_parameter_not_bot, not_called.
 * @param {object} parsed result of parseGeneratedCode
 * @returns {{candidate: object|null, reason: string|null}}
 */
export function pickSkillCandidate(parsed) {
    const fail = reason => ({ candidate: null, reason });
    try {
        if (!parsed?.ok) {
            return fail('parse_error');
        }
        const functions = Array.isArray(parsed.functions) ? parsed.functions : [];
        if (functions.length === 0) {
            return fail('no_function');
        }
        if (functions.length > 1) {
            return fail('several_functions');
        }
        const fn = functions[0];
        if (!fn?.async) {
            return fail('not_async');
        }
        const params = Array.isArray(fn.params) ? fn.params : [];
        if (params[0] !== 'bot') {
            return fail('first_parameter_not_bot');
        }
        const calls = Array.isArray(parsed.topLevelCalls) ? parsed.topLevelCalls : [];
        if (!calls.includes(fn.name)) {
            return fail('not_called');
        }
        return { candidate: fn, reason: null };
    } catch {
        return fail('parse_error');
    }
}

/**
 * Finds the first block comment starting with `/**` after the opening brace of the
 * function body. Uses the parser, so a `/**` inside a string does not count.
 * @param {string} functionSource
 * @returns {{text: string, raw: string}|null} text without delimiters and trimmed,
 *   raw including the delimiters
 */
export function getDocBlock(functionSource) {
    const found = findFunction(functionSource);
    if (found === null) {
        return null;
    }
    const [start, end] = found.fn.body.range;
    for (const comment of found.comments) {
        if (comment.type !== 'Block' || !comment.value.startsWith('*')) {
            continue;
        }
        if (comment.range[0] <= start || comment.range[1] > end) {
            continue;
        }
        let text = comment.value.slice(1);
        if (text.endsWith('*')) {
            // closed with **/
            text = text.slice(0, -1);
        }
        return { text: text.trim(), raw: functionSource.slice(comment.range[0], comment.range[1]) };
    }
    return null;
}

/**
 * The first line of a doc text that contains a letter, without a leading `*`
 * and without surrounding whitespace.
 * @param {string} docText
 * @returns {string} the line, '' if there is none
 */
export function firstDocLine(docText) {
    if (typeof docText !== 'string') {
        return '';
    }
    for (const line of docText.split(/\r\n|\r|\n/)) {
        if (/\p{L}/u.test(line)) {
            return line.replace(/^\s*\*?/, '').trim();
        }
    }
    return '';
}

// Parameters after `bot` with their position in the function, counted from 1.
function furtherParams(params) {
    const list = Array.isArray(params) ? params : [];
    if (list[0] === 'bot') {
        return list.slice(1).map((param, i) => paramText(param, i + 2));
    }
    return list.map((param, i) => paramText(param, i + 2));
}

function safeString(value) {
    if (value === undefined || value === null) {
        return '';
    }
    try {
        return String(value);
    } catch {
        return '';
    }
}

// One line, and a `*/` in it cannot end the comment early.
function docDescription(description) {
    return safeString(description).split(/\r\n|\r|\n/).join(' ').split('*/').join('* /').trim();
}

/**
 * Builds a doc comment in the style of the built-in skills, lines joined with LF.
 * `params` are the parameter names of the function including `bot` first; a null
 * name is written arg<position>.
 * @param {{name: string, params: (string|null)[], description: string}} info
 * @returns {string}
 */
export function buildDocBlock(info = {}) {
    const { name, params, description } = info ?? {};
    const skillName = safeString(name);
    const further = furtherParams(params);
    const lines = [
        '/**',
        ` * ${docDescription(description)}`,
        ' * @param {MinecraftBot} bot, reference to the minecraft bot.',
    ];
    for (const param of further) {
        lines.push(` * @param {*} ${param}`);
    }
    lines.push(
        ' * @returns {Promise<boolean>} true if the skill succeeded, false otherwise.',
        ' * @example',
        ` * await customSkills.${skillName}(${['bot', ...further].join(', ')});`,
        ' **/',
    );
    return lines.join('\n');
}

/**
 * Returns the source unchanged when it has a doc block. Otherwise inserts the block
 * of buildDocBlock(info), every line indented by 4 spaces and followed by a line
 * break, after the opening brace of the body: on the line after the brace when the
 * brace ends its line, else directly after the brace on a new line. `info.name` and
 * `info.params` default to those of the parsed function. A source that does not
 * parse is returned unchanged.
 * @param {string} functionSource
 * @param {{name?: string, params?: (string|null)[], description?: string}} info
 * @returns {string}
 */
export function ensureDocBlock(functionSource, info = {}) {
    if (typeof functionSource !== 'string') {
        return '';
    }
    if (getDocBlock(functionSource) !== null) {
        return functionSource;
    }
    const found = findFunction(functionSource);
    if (found === null) {
        return functionSource;
    }
    const { fn } = found;
    const given = info !== null && typeof info === 'object' ? info : {};
    const block = buildDocBlock({
        name: given.name ?? fn.id?.name ?? '',
        params: Array.isArray(given.params) ? given.params : fn.params.map(paramName),
        description: given.description,
    }).split('\n').map(line => INDENT + line);

    const afterBrace = fn.body.range[0] + 1;
    const rest = functionSource.slice(afterBrace);
    const lineEnd = /^[ \t]*(\r?\n)/.exec(rest);
    if (lineEnd !== null) {
        const eol = lineEnd[1];
        const at = afterBrace + lineEnd[0].length;
        return functionSource.slice(0, at) + block.join(eol) + eol + functionSource.slice(at);
    }
    return functionSource.slice(0, afterBrace) + '\n' + block.join('\n') + '\n' + rest;
}

/**
 * The call signature of an entry of parseGeneratedCode().functions, like
 * `name(bot, a, b)`. A null parameter is written arg<position>, counted from 1.
 * @param {{name: string, params: (string|null)[]}} fn
 * @returns {string} '' when fn is not an object
 */
export function signatureOf(fn) {
    if (fn === null || typeof fn !== 'object') {
        return '';
    }
    const name = typeof fn.name === 'string' ? fn.name : '';
    const params = Array.isArray(fn.params) ? fn.params : [];
    return `${name}(${params.map((param, i) => paramText(param, i + 1)).join(', ')})`;
}

/**
 * Prepares source for the sandbox like Coder._stageCode does for generated code,
 * after normalizeSource: `console.log(` becomes `log(bot,`, `log("` becomes
 * `log(bot,"`, and every `;\n` gets an interrupt check.
 * @param {string} source
 * @returns {string}
 */
export function instrument(source) {
    return normalizeSource(source)
        .split('console.log(').join('log(bot,')
        .split('log("').join('log(bot,"')
        .split(';\n').join('; if(bot.interrupt_code) {log(bot, "Code interrupted.");return;}\n');
}

/**
 * Whether a text is exactly one async function declaration with this name (not a
 * generator) and nothing else, parsed as a script. The loader evaluates
 * '(' + text + ')'; for such a text that is the function and runs no code
 * (Amendment 2, B2). Never throws.
 * @param {string} name
 * @param {string} text
 * @returns {boolean}
 */
export function isSingleFunction(name, text) {
    if (typeof name !== 'string' || name === '' || typeof text !== 'string') {
        return false;
    }
    try {
        const ast = espree.parse(text, { ecmaVersion: 'latest', sourceType: 'script' });
        if (ast.body.length !== 1) {
            return false;
        }
        const statement = ast.body[0];
        return statement.type === 'FunctionDeclaration'
            && statement.async === true
            && statement.generator !== true
            && statement.id?.name === name;
    } catch {
        return false;
    }
}
