// Static checks on project source files, done on the syntax tree of espree (the parser that
// ESLint uses), not with regular expressions, so strings and comments never count as code.
//
//   moduleImports(relPath)            the imports of a module
//   assertSkillModuleImports(relPath) the import rules of the new skill modules (spec 0.1)
//   analyseSkillGuards(relPath, ...)  which uses of the skill manager are guarded (spec K9)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import * as espree from 'espree';
import { repoPath, REPO_ROOT } from './paths.js';

const SKIP_KEYS = new Set(['parent', 'range', 'loc', 'start', 'end', 'comments', 'tokens']);
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const EXIT_TYPES = new Set(['ReturnStatement', 'ThrowStatement', 'ContinueStatement', 'BreakStatement']);

export function readRepoFile(relPath) {
    return fs.readFileSync(repoPath(relPath), 'utf8');
}

export function parseModule(text) {
    return espree.parse(text, { ecmaVersion: 'latest', sourceType: 'module', range: true });
}

function children(node) {
    const out = [];
    for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const value = node[key];
        if (Array.isArray(value)) {
            for (const v of value) if (v && typeof v.type === 'string') out.push(v);
        } else if (value && typeof value.type === 'string') {
            out.push(value);
        }
    }
    return out;
}

// All nodes below root (root included) and a map node -> parent.
function indexTree(root) {
    const parents = new Map();
    const nodes = [];
    const stack = [[root, null]];
    while (stack.length) {
        const [node, parent] = stack.pop();
        parents.set(node, parent);
        nodes.push(node);
        for (const c of children(node)) stack.push([c, node]);
    }
    return { parents, nodes };
}

// { specifiers: [static import / re-export sources], dynamic: n, requires: n }
export function moduleImports(relPath) {
    const { nodes } = indexTree(parseModule(readRepoFile(relPath)));
    const specifiers = [];
    let dynamic = 0;
    let requires = 0;
    for (const n of nodes) {
        if ((n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration') && n.source) {
            specifiers.push(n.source.value);
        } else if (n.type === 'ImportExpression') {
            dynamic++;
        } else if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require') {
            requires++;
        }
    }
    return { specifiers, dynamic, requires };
}

function isBuiltin(spec) {
    const name = spec.startsWith('node:') ? spec.slice(5) : spec;
    return builtinModules.includes(name) || builtinModules.includes(name.split('/')[0]);
}

const FORBIDDEN_PACKAGES = [
    /^mineflayer/, /^minecraft-/, /^prismarine-/,
    /^openai$/, /^@anthropic-ai\//, /^@google\//, /^groq-sdk$/, /^@mistralai\//, /^replicate$/,
    /^@huggingface\//, /^@cerebras\//, /^ollama$/,
];
const FORBIDDEN_PROJECT_FILES = [
    /^src\/models\//, /^src\/utils\/mcdata\.js$/, /^src\/agent\/library\/skills\.js$/, /^src\/agent\/library\/world\.js$/,
];
const IO_BUILTINS = ['fs', 'fs/promises', 'child_process', 'net', 'http', 'https', 'worker_threads', 'dgram', 'tls'];

// Spec 0.1: no mineflayer, no model SDK, not skills.js or world.js, no require().
// pure: true additionally forbids built-ins that do I/O, and allows only the listed packages
// (allowPackages) and project files (allowProjectFiles, relative to the repository root)
// besides the sibling modules in src/agent/skills/.
export function assertSkillModuleImports(relPath, { pure = false, allowPackages = [], allowProjectFiles = [] } = {}) {
    const imports = moduleImports(relPath);
    assert.equal(imports.requires, 0, `${relPath}: no require()`);
    const moduleDir = path.dirname(repoPath(relPath));
    for (const spec of imports.specifiers) {
        if (spec.startsWith('.')) {
            const target = path.relative(REPO_ROOT, path.resolve(moduleDir, spec)).split(path.sep).join('/');
            for (const re of FORBIDDEN_PROJECT_FILES) assert.ok(!re.test(target), `${relPath} must not import ${target}`);
            if (pure) {
                const sibling = /^src\/agent\/skills\/skill_[a-z_]+\.js$/.test(target);
                assert.ok(sibling || allowProjectFiles.includes(target), `${relPath} is pure and must not import ${target}`);
            }
        } else if (isBuiltin(spec)) {
            const name = spec.startsWith('node:') ? spec.slice(5) : spec;
            if (pure) assert.ok(!IO_BUILTINS.includes(name), `${relPath} is pure and must not import ${spec}`);
        } else {
            for (const re of FORBIDDEN_PACKAGES) assert.ok(!re.test(spec), `${relPath} must not import the package ${spec}`);
            if (pure) assert.ok(allowPackages.includes(spec), `${relPath} is pure and may import only ${allowPackages.join(', ') || 'no package'}, not ${spec}`);
        }
    }
}

// Finds every use of the skill manager in a source file and tells whether it is guarded.
//
// A "use" is
//   - a member access on the manager: <x>.skill_manager.<m>, manager.<m>, skillManager.<m>, or
//     <alias>.<m> where `const <alias> = <x>.skill_manager`, without optional chaining on it;
//   - a call or `new` of a function imported from a module under skills/skill_*.js
//     (except the names in `exempt`).
// A use is guarded when one of these encloses it:
//   - if / ?: whose test mentions the guard, and the use is in the branch that runs when the
//     guard is there: the consequent of a positive test, the alternate (else) of a negative
//     test such as `!manager` or `manager == null`. The else branch of `if (manager)` runs
//     WITHOUT a manager, so it guards nothing (Amendment 1, A6),
//   - `a && use` or `a || use` or `a ?? use` whose left side mentions the guard,
//   - an earlier statement of an enclosing block of the form `if (!<mentions guard>) ... return/throw`
//     (a negative test: `!`, `== null`, `=== undefined` or `typeof`),
//   - the manager identifier is a parameter of an enclosing function (the caller passes it).
// "Mentions the guard" means the source text matches guardPattern, directly or through the
// initialiser of a variable or the body of a local function or method used in it (two levels).
// Returns { uses: [...], unguarded: [...], notInTry: [...] } with { line, text } items.
export function analyseSkillGuards(relPath, options = {}) {
    return analyseSkillGuardsInText(readRepoFile(relPath), options);
}

export function analyseSkillGuardsInText(text, { guardPattern = /manager/i, exempt = [], tryRequired = [] } = {}) {
    const ast = parseModule(text);
    const { parents, nodes } = indexTree(ast);
    const src = (n) => text.slice(n.range[0], n.range[1]);
    const lineOf = (n) => text.slice(0, n.range[0]).split('\n').length;

    const inits = new Map();
    for (const n of nodes) {
        if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) {
            if (!inits.has(n.id.name)) inits.set(n.id.name, []);
            inits.get(n.id.name).push(n.init);
        }
    }
    const unwrap = (n) => (n && n.type === 'ChainExpression' ? n.expression : n);
    const isSkillManagerMember = (n) => {
        n = unwrap(n);
        return !!n && n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier' && n.property.name === 'skill_manager';
    };
    const managerIds = new Set(['manager', 'skillManager', 'skill_manager']);
    for (const [name, list] of inits) if (list.some(isSkillManagerMember)) managerIds.add(name);
    const isManagerRef = (n) => {
        n = unwrap(n);
        return (!!n && n.type === 'Identifier' && managerIds.has(n.name)) || isSkillManagerMember(n);
    };

    const imported = new Set();
    for (const n of ast.body) {
        if (n.type === 'ImportDeclaration' && /skills\/skill_[a-z_]+(\.js)?$/.test(n.source.value)) {
            for (const s of n.specifiers) if (!exempt.includes(s.local.name)) imported.add(s.local.name);
        }
    }

    // Local functions and methods by name, so a guard can be a helper such as this._skillsOn().
    const functionBodies = new Map();
    const addBody = (name, body) => {
        if (!name || !body) return;
        if (!functionBodies.has(name)) functionBodies.set(name, []);
        functionBodies.get(name).push(body);
    };
    for (const n of nodes) {
        if (n.type === 'FunctionDeclaration' && n.id) addBody(n.id.name, n.body);
        else if ((n.type === 'MethodDefinition' || n.type === 'Property') && !n.computed && n.key.type === 'Identifier' && n.value && FUNCTION_TYPES.has(n.value.type)) addBody(n.key.name, n.value.body);
    }

    const mentions = (node, depth = 0) => {
        if (guardPattern.test(src(node))) return true;
        if (depth >= 2) return false;
        for (const id of indexTree(node).nodes) {
            if (id.type !== 'Identifier') continue;
            for (const init of inits.get(id.name) ?? []) if (mentions(init, depth + 1)) return true;
            for (const body of functionBodies.get(id.name) ?? []) if (mentions(body, depth + 1)) return true;
        }
        return false;
    };
    // `if (!manager) return`, `if (manager == null) return`, `if (typeof manager ...) return`
    const isNegativeTest = (node) => /!|==\s*(null|undefined)|typeof/.test(src(node));
    // A test that is true when the guarded thing is missing: `!x`, `x == null`, `x === undefined`,
    // `typeof x === 'undefined'`. Decided on the tree, so `a != null && b` is positive.
    const isNothing = (n) => (n.type === 'Literal' && (n.value === null || n.value === 'undefined')) || (n.type === 'Identifier' && n.name === 'undefined');
    const isNegatedTest = (node) => {
        const t = unwrap(node);
        if (t.type === 'UnaryExpression' && t.operator === '!') return true;
        return t.type === 'BinaryExpression' && (t.operator === '==' || t.operator === '===') && (isNothing(t.left) || isNothing(t.right));
    };
    // The branch of an if / ?: that runs when the guard is there.
    const isGuardedBranch = (parent, child) => {
        if (child === parent.consequent) return !isNegatedTest(parent.test);
        if (child === parent.alternate) return isNegatedTest(parent.test);
        return false;
    };
    const containsExit = (node) => {
        if (EXIT_TYPES.has(node.type)) return true;
        if (FUNCTION_TYPES.has(node.type)) return false;
        return children(node).some(containsExit);
    };
    const isParameterOfEnclosingFunction = (node) => {
        const id = unwrap(node.object);
        if (!id || id.type !== 'Identifier') return false;
        for (let p = parents.get(node); p; p = parents.get(p)) {
            if (FUNCTION_TYPES.has(p.type) && p.params.some((param) => param.type === 'Identifier' && param.name === id.name)) return true;
        }
        return false;
    };
    const isGuarded = (node) => {
        if (node.type === 'MemberExpression' && isParameterOfEnclosingFunction(node)) return true;
        let child = node;
        let parent = parents.get(node);
        while (parent) {
            if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
                if (isGuardedBranch(parent, child) && mentions(parent.test)) return true;
            } else if (parent.type === 'LogicalExpression') {
                if (child === parent.right && mentions(parent.left)) return true;
            } else if (Array.isArray(parent.body) || parent.type === 'SwitchCase') {
                const list = parent.type === 'SwitchCase' ? parent.consequent : parent.body;
                const idx = list.indexOf(child);
                for (let i = 0; i < idx; i++) {
                    const s = list[i];
                    if (s.type === 'IfStatement' && isNegativeTest(s.test) && mentions(s.test) && containsExit(s.consequent)) return true;
                }
            }
            child = parent;
            parent = parents.get(parent);
        }
        return false;
    };
    const isInTry = (node) => {
        let child = node;
        for (let p = parents.get(node); p; p = parents.get(p)) {
            if (p.type === 'TryStatement' && child === p.block) return true;
            child = p;
        }
        return false;
    };

    const uses = [];
    for (const n of nodes) {
        let name = null;
        if (n.type === 'MemberExpression' && !n.optional && !n.computed && isManagerRef(n.object)) name = n.property.name;
        else if ((n.type === 'CallExpression' || n.type === 'NewExpression') && n.callee.type === 'Identifier' && imported.has(n.callee.name)) name = n.callee.name;
        if (name !== null) uses.push({ node: n, name });
    }
    uses.sort((a, b) => a.node.range[0] - b.node.range[0]);
    const describe = ({ node, name }) => ({ line: lineOf(node), name, text: src(node).split('\n')[0].slice(0, 120) });
    return {
        uses: uses.map(describe),
        unguarded: uses.filter((u) => !isGuarded(u.node)).map(describe),
        notInTry: uses.filter((u) => tryRequired.includes(u.name) && !isInTry(u.node)).map(describe),
    };
}
