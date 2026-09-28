// Checks a skill before it is saved (spec K2). Pure, never throws.
import * as espree from 'espree';
import { Linter } from 'eslint';
import { getDocBlock, firstDocLine } from './skill_source.js';

const NAME_PATTERN = /^[a-z][A-Za-z0-9]{2,39}$/;
const DEFAULT_MAX_LENGTH = 8000;
const COORDINATE_LIMIT = 16;

// The names the sandbox provides, and console (Amendment 2, B3). The standard objects of
// JavaScript come with ecmaVersion 'latest'; no globals of Node.js or of a browser.
const SANDBOX_GLOBALS = Object.freeze(['skills', 'world', 'Vec3', 'log', 'customSkills', 'console']);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
let linter = null; // created at the first check, so importing the module creates nothing

// Names of the sandbox, members of Object.prototype, and names JavaScript reserves.
const RESERVED_NAMES = new Set([
    'bot', 'log', 'skills', 'world', 'customSkills', 'main',
    'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty',
    'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
    'await', 'async', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
    'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
    'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private',
    'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw',
    'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
    'arguments', 'eval', 'undefined',
]);

// A skill is stored as <name>.js; these file names are devices on Windows.
const DEVICE_NAMES = new Set([
    'con', 'prn', 'aux', 'nul',
    'com0', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt0', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

// Checked on the whole source text, including comments and strings. A token matches a whole
// name only (Amendment 1, A1), so `retrieval(` or `item.constructorName` are not refused.
// `(?<![\w$])` means "not preceded by a letter, digit, _ or $", `(?![\w$])` "not followed by one".
// import( (v0.1.4.5, G5): like the sandbox, also `import` followed by optional whitespace and
// `//` or `/*`, and not after a `.` (x.import(1) is a method call), but after a spread `...`.
const FORBIDDEN_TOKENS = Object.freeze([
    { token: 'import(', pattern: /(?:(?<![\w$.])|(?<=\.\.\.))import\s*(?:\(|\/[/*])/ },
    { token: 'eval(', pattern: /(?<![\w$])eval\s*\(/ },
    { token: '<!--', pattern: /<!--/ },
    { token: '-->', pattern: /-->/ },
    { token: 'require(', pattern: /(?<![\w$])require\s*\(/ },
    { token: 'globalThis', pattern: /(?<![\w$])globalThis(?![\w$])/ },
    { token: 'process.', pattern: /(?<![\w$])process\s*\./ },
    { token: '.constructor', pattern: /\.constructor(?![\w$])/ },
    { token: 'Function(', pattern: /(?<![\w$])Function\s*\(/ },
    { token: '__proto__', pattern: /(?<![\w$])__proto__(?![\w$])/ },
    { token: 'setTimeout(', pattern: /(?<![\w$])setTimeout\s*\(/ },
    { token: 'setInterval(', pattern: /(?<![\w$])setInterval\s*\(/ },
]);

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

function quoted(value) {
    if (typeof value === 'string') {
        return `"${value}"`;
    }
    try {
        return String(value);
    } catch {
        return typeof value;
    }
}

function isBuiltin(name, builtinNames) {
    if (Array.isArray(builtinNames)) {
        return builtinNames.includes(name);
    }
    if (builtinNames instanceof Set) {
        return builtinNames.has(name);
    }
    return false;
}

function checkName(name, builtinNames, errors) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
        errors.push({
            code: 'name_format',
            message: `The name ${quoted(name)} must start with a lowercase letter and have 3 to 40 letters or digits.`,
        });
    }
    if (typeof name === 'string' && (RESERVED_NAMES.has(name) || DEVICE_NAMES.has(name.toLowerCase()))) {
        errors.push({ code: 'name_reserved', message: `The name "${name}" is reserved.` });
    }
    if (typeof name === 'string' && isBuiltin(name, builtinNames)) {
        errors.push({ code: 'name_builtin', message: `The name "${name}" is already used by a built-in function.` });
    }
}

function firstParamIsBot(params) {
    const first = params?.[0];
    if (first?.type === 'Identifier') {
        return first.name === 'bot';
    }
    return first?.type === 'AssignmentPattern' && first.left?.type === 'Identifier' && first.left.name === 'bot';
}

// Returns the program, or null after reporting not_one_function for a parse failure.
function checkFunction(source, name, errors) {
    const fail = message => errors.push({ code: 'not_one_function', message });
    if (source === null) {
        fail('The source is not a string.');
        return null;
    }
    let ast;
    try {
        ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'script', range: true });
    } catch (err) {
        fail(`The source does not parse: ${errorText(err)}`);
        return null;
    }
    if (ast.body.length !== 1) {
        fail(`The source must be exactly one statement, found ${ast.body.length}.`);
        return ast;
    }
    const statement = ast.body[0];
    if (statement.type !== 'FunctionDeclaration' || statement.async !== true || statement.generator === true) {
        fail('The source must be one async function declaration.');
        return ast;
    }
    if (statement.id?.name !== name) {
        fail(`The function must be named ${quoted(name)}, found "${statement.id?.name}".`);
    }
    if (!firstParamIsBot(statement.params)) {
        fail('The first parameter of the function must be named "bot".');
    }
    return ast;
}

function checkDoc(source, errors) {
    const doc = source === null ? null : getDocBlock(source);
    if (doc === null || firstDocLine(doc.text) === '') {
        errors.push({
            code: 'no_doc',
            message: 'The function needs a /** ... **/ description directly inside its body.',
        });
    }
}

function checkTokens(source, errors) {
    if (source === null) {
        return;
    }
    for (const { token, pattern } of FORBIDDEN_TOKENS) {
        if (pattern.test(source)) {
            errors.push({ code: 'forbidden_token', message: `The source contains the forbidden text "${token}".` });
        }
    }
}

// A numeric literal, a leading minus allowed. Returns the value or null.
function numericValue(node) {
    if (node?.type === 'Literal' && typeof node.value === 'number') {
        return node.value;
    }
    if (node?.type === 'UnaryExpression' && node.operator === '-'
        && node.argument?.type === 'Literal' && typeof node.argument.value === 'number') {
        return -node.argument.value;
    }
    return null;
}

function findCoordinates(items) {
    if (!Array.isArray(items)) {
        return null;
    }
    for (let i = 0; i + 2 < items.length; i++) {
        const triple = items.slice(i, i + 3);
        const values = triple.map(numericValue);
        if (values.every(value => value !== null) && values.some(value => Math.abs(value) >= COORDINATE_LIMIT)) {
            return triple;
        }
    }
    return null;
}

function checkCoordinates(ast, source, errors) {
    let found = null;
    forEachNode(ast, node => {
        if (found !== null) {
            return;
        }
        if (node.type === 'CallExpression' || node.type === 'NewExpression') {
            found = findCoordinates(node.arguments);
        } else if (node.type === 'ArrayExpression') {
            found = findCoordinates(node.elements);
        }
    });
    if (found !== null) {
        const numbers = found.map(node => source.slice(node.range[0], node.range[1])).join(', ');
        errors.push({
            code: 'hard_coded_coordinates',
            message: `The source contains hard-coded coordinates (${numbers}). `
                + 'Pass coordinates as parameters or compute them from the position of the bot.',
        });
    }
}

// Names the function uses without declaring them (Amendment 2, B3): the rule no-undef of
// ESLint with the names of the sandbox, console and extraGlobals as globals. Comments such as
// /* global x */ or /* eslint-disable */ in the source have no effect. Skipped when the source
// does not parse. One error with the names in order of first use, each once.
function checkNames(source, extraGlobals, errors) {
    let names;
    try {
        linter ??= new Linter();
        const extra = Array.isArray(extraGlobals) ? extraGlobals.filter(n => typeof n === 'string' && IDENTIFIER.test(n)) : [];
        const globals = Object.fromEntries([...SANDBOX_GLOBALS, ...extra].map(n => [n, 'readonly']));
        const messages = linter.verify(source, [{
            languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals },
            linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
            rules: { 'no-undef': 'error' },
        }]);
        if (messages.some(message => message.fatal)) {
            return;
        }
        names = [];
        for (const message of messages) {
            const found = message.ruleId === 'no-undef' ? /'([^']+)'/.exec(message.message) : null;
            if (found && !names.includes(found[1])) {
                names.push(found[1]);
            }
        }
    } catch (err) {
        // fail closed: names that could not be checked are not accepted
        errors.push({ code: 'undefined_name', message: `The names of the source could not be checked: ${errorText(err)}` });
        return;
    }
    if (names.length > 0) {
        errors.push({
            code: 'undefined_name',
            message: `The function uses names that it does not declare: ${names.join(', ')}. `
                + 'They do not exist when the skill runs later. Declare them inside the function or pass them as parameters.',
        });
    }
}

/**
 * Checks a skill before it is saved. All rules are checked, so several errors can
 * come back. Codes: name_format, name_reserved, name_builtin, too_long,
 * not_one_function, no_doc, forbidden_token (one per token), undefined_name and
 * hard_coded_coordinates (both skipped when the source does not parse). Never throws.
 * @param {{name: string, source: string, builtinNames?: string[], maxLength?: number, extraGlobals?: string[]}} options
 *     extraGlobals: further names the function may use besides its own, the sandbox's and the standard ones.
 * @returns {{ok: boolean, errors: {code: string, message: string}[]}}
 */
export function validateSkill(options = {}) {
    const errors = [];
    try {
        const given = options !== null && typeof options === 'object' ? options : {};
        const { name, source, builtinNames = [], maxLength = DEFAULT_MAX_LENGTH, extraGlobals = [] } = given;
        const text = typeof source === 'string' ? source : null;
        const limit = typeof maxLength === 'number' && !Number.isNaN(maxLength) ? maxLength : DEFAULT_MAX_LENGTH;

        checkName(name, builtinNames, errors);
        if (text !== null && text.length > limit) {
            errors.push({ code: 'too_long', message: `The source has ${text.length} characters, the limit is ${limit}.` });
        }
        const ast = checkFunction(text, name, errors);
        checkDoc(text, errors);
        checkTokens(text, errors);
        if (ast !== null) {
            checkNames(text, extraGlobals, errors);
            checkCoordinates(ast, text, errors);
        }
    } catch (err) {
        // fail closed: an unexpected error must never let a skill through
        errors.push({ code: 'not_one_function', message: `The source could not be checked: ${errorText(err)}` });
    }
    return { ok: errors.length === 0, errors };
}
