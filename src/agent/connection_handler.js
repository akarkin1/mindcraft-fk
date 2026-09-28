import { sendOutputToServer } from './mindserver_proxy.js';

// Definitions of error types, keywords, and full human-readable messages.
const ERROR_DEFINITIONS = {
    'name_conflict': {
        keywords: ['name_taken', 'duplicate_login', 'already connected', 'already logged in', 'username is already'],
        msg: 'Name Conflict: The name is already in use or you are already logged in.',
        isFatal: true
    },
    'access_denied': {
        keywords: ['whitelist', 'not white-listed', 'banned', 'suspended', 'verify'],
        msg: 'Access Denied: You are not whitelisted or banned.',
        isFatal: true
    },
    'server_full': {
        keywords: ['server is full', 'full server'],
        msg: 'Connection Failed: The server is full.',
        isFatal: false
    },
    'version_mismatch': {
        keywords: ['outdated', 'version', 'client'],
        msg: 'Version Mismatch: Client and server versions do not match.',
        isFatal: true
    },
    'maintenance': {
        keywords: ['maintenance', 'updating', 'closed', 'restarting'],
        msg: 'Connection Failed: Server is under maintenance or restarting.',
        isFatal: false
    },
    'network_error': {
        keywords: ['timeout', 'timed out', 'connection lost', 'reset', 'refused', 'keepalive'],
        msg: 'Network Error: Connection timed out or was lost.',
        isFatal: false
    },
    'behavior': {
        keywords: ['flying', 'spam', 'speed'],
        msg: 'Kicked: Removed from server due to flying, spamming, or invalid movement.',
        isFatal: true
    }
};

// Helper to log messages to console (once) and MindServer.
export const log = (agentName, msg) => {
    // Use console.error for visibility in terminal
    console.error(msg);
    try { sendOutputToServer(agentName || 'system', msg); } catch (_) {}
};

// NBT tag types of prismarine-nbt. Minecraft 1.21 sends the kick reason as NBT, where every
// value is wrapped as { type, value } (the root may also have a name).
const NBT_TYPES = new Set(['end', 'byte', 'short', 'int', 'long', 'float', 'double', 'byteArray', 'string', 'list', 'compound', 'intArray', 'longArray']);
const MAX_DEPTH = 64;

// JSON of any value, never throws: cycles become "[Circular]", a bigint its digits.
function safeJson(value) {
    try {
        const json = JSON.stringify(value);
        if (typeof json === 'string') return json;
    } catch (_) { /* cycle, bigint or a throwing toJSON */ }
    try {
        const seen = new WeakSet();
        const json = JSON.stringify(value, (key, val) => {
            if (typeof val === 'bigint') return String(val);
            if (val !== null && typeof val === 'object') {
                if (seen.has(val)) return '[Circular]';
                seen.add(val);
            }
            return val;
        });
        if (typeof json === 'string') return json;
    } catch (_) { /* too deep, or getters that throw */ }
    return 'unreadable reason';
}

// Removes the NBT wrappers { type, value } around a value.
function unwrapNbt(node) {
    for (let i = 0; i < MAX_DEPTH && node !== null && typeof node === 'object' && !Array.isArray(node)
        && NBT_TYPES.has(node.type) && 'value' in node; i++) {
        node = node.value;
    }
    return node;
}

// Text of a chat component (plain or NBT): a string, a list of components (appended), or an
// object whose translate key or text is followed by the texts of `with` and `extra`.
function componentText(node, depth, seen) {
    node = unwrapNbt(node);
    if (depth > MAX_DEPTH || node === null || node === undefined) return '';
    if (typeof node === 'string') return node;
    if (typeof node === 'number' || typeof node === 'boolean' || typeof node === 'bigint') return String(node);
    if (typeof node !== 'object' || seen.has(node)) return '';
    seen.add(node);
    if (Array.isArray(node)) return node.map(n => componentText(n, depth + 1, seen)).join('');
    const translate = unwrapNbt(node.translate);
    const text = unwrapNbt(node.text);
    let result = typeof translate === 'string' && translate !== '' ? translate
        : typeof text === 'string' ? text
        : componentText(node[''], depth + 1, seen); // NBT lists of mixed types wrap items as { '': value }
    const args = unwrapNbt(node.with);
    if (Array.isArray(args)) {
        for (const arg of args) {
            const argText = componentText(arg, depth + 1, seen);
            if (argText !== '') result += (result === '' ? '' : ' ') + argText;
        }
    }
    result += componentText(node.extra, depth + 1, seen);
    return result;
}

// Readable one-line text of a kick reason: a plain string, a JSON string, a chat component or
// the same in NBT form. If nothing readable is found, the JSON of the reason. Never throws.
function reasonText(reason) {
    try {
        let value = reason;
        if (typeof reason === 'string') {
            try { value = JSON.parse(reason); } catch (_) { /* plain text */ }
        }
        const text = reason instanceof Error ? String(reason) : componentText(value, 0, new WeakSet());
        const oneLine = text.replace(/\s+/g, ' ').trim();
        if (oneLine !== '') return oneLine;
    } catch (_) { /* e.g. a proxy that throws: use the JSON */ }
    return typeof reason === 'string' ? reason : safeJson(reason);
}

// Analyzes the kick reason and returns a full, human-readable sentence.
export function parseKickReason(reason) {
    if (!reason) return { type: 'unknown', msg: 'Unknown reason (Empty)', isFatal: true };
    
    const raw = (typeof reason === 'string' ? reason : safeJson(reason)).toLowerCase();

    // Search for keywords in definitions
    for (const [type, def] of Object.entries(ERROR_DEFINITIONS)) {
        if (def.keywords.some(k => raw.includes(k))) {
            console.error(`Disconnected: ${raw}`);
            return { type, msg: def.msg, isFatal: def.isFatal };
        }
    }
    
    // Fallback: readable text of the reason (string, JSON, chat component or NBT)
    const fallback = reasonText(reason);
    
    return { type: 'other', msg: `Disconnected: ${fallback}`, isFatal: true };
}

// Centralized handler for disconnections.
export function handleDisconnection(agentName, reason) {
    const { type, msg } = parseKickReason(reason);
    
    // Format: [LoginGuard] Error Message
    const finalMsg = `[LoginGuard] ${msg}`;
    
    // Only call log once (it handles console printing)
    log(agentName, finalMsg);
    
    return { type, msg: finalMsg };
}

// Validates name format.
export function validateNameFormat(name) {
    if (!name || !/^[a-zA-Z0-9_]{3,16}$/.test(name)) {
        return { 
            success: false, 
            // Added [LoginGuard] prefix here for consistency
            msg: `[LoginGuard] Invalid name '${name}'. Must be 3-16 alphanumeric/underscore characters.` 
        };
    }
    return { success: true };
}