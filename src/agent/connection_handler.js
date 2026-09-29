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

// v0.1.4.8 (X9): the text of a translate key in the language table of the game (minecraft-data, for
// example 'disconnect.spam' -> 'Kicked for spamming'), with the arguments put in for %s and %1$s. null
// without a table or without the key.
function translated(language, key, args) {
    try {
        const template = language && typeof language === 'object' ? language[key] : undefined;
        if (typeof template !== 'string' || template === '') return null;
        let next = 0;
        return template.replace(/%(?:(\d+)\$)?([sd%])/g, (match, index, kind) => {
            if (kind === '%') return '%';
            const at = index !== undefined ? Number(index) - 1 : next++;
            return at >= 0 && at < args.length ? args[at] : '';
        });
    } catch (_) {
        return null;
    }
}

// Text of a chat component (plain or NBT): a string, a list of components (appended), or an
// object whose translate key or text is followed by the texts of `with` and `extra`. With a language
// table (v0.1.4.8) a known translate key becomes the text of the game, its `with` put in.
function componentText(node, depth, seen, language = null) {
    node = unwrapNbt(node);
    if (depth > MAX_DEPTH || node === null || node === undefined) return '';
    if (typeof node === 'string') return node;
    if (typeof node === 'number' || typeof node === 'boolean' || typeof node === 'bigint') return String(node);
    if (typeof node !== 'object' || seen.has(node)) return '';
    seen.add(node);
    if (Array.isArray(node)) return node.map(n => componentText(n, depth + 1, seen, language)).join('');
    const translate = unwrapNbt(node.translate);
    const text = unwrapNbt(node.text);
    const args = unwrapNbt(node.with);
    const argTexts = Array.isArray(args) ? args.map(arg => componentText(arg, depth + 1, seen, language)) : [];
    const known = typeof translate === 'string' && translate !== '' ? translated(language, translate, argTexts) : null;
    let result;
    if (known !== null) {
        result = known;
    } else {
        result = typeof translate === 'string' && translate !== '' ? translate
            : typeof text === 'string' ? text
            : componentText(node[''], depth + 1, seen, language); // NBT lists of mixed types wrap items as { '': value }
        for (const argText of argTexts) {
            if (argText !== '') result += (result === '' ? '' : ' ') + argText;
        }
    }
    result += componentText(node.extra, depth + 1, seen, language);
    return result;
}

// Readable one-line text of a kick reason: a plain string, a JSON string, a chat component or
// the same in NBT form. If nothing readable is found, the JSON of the reason. Never throws.
function reasonText(reason, language = null) {
    try {
        let value = reason;
        if (typeof reason === 'string') {
            try { value = JSON.parse(reason); } catch (_) { /* plain text */ }
        }
        const text = reason instanceof Error ? String(reason) : componentText(value, 0, new WeakSet(), language);
        const oneLine = text.replace(/\s+/g, ' ').trim();
        if (oneLine !== '') return oneLine;
    } catch (_) { /* e.g. a proxy that throws: use the JSON */ }
    return typeof reason === 'string' ? reason : safeJson(reason);
}

/**
 * v0.1.4.8 (X9): the reason as the server gave it, in one line: the text of a chat component, a translate
 * key in the words of the game when a language table is given. Never throws.
 * @param {*} reason
 * @param {object|null} [language] key -> text, for example bot.registry.language
 * @returns {string}
 */
export function serverReasonText(reason, language = null) {
    try {
        return reasonText(reason, language);
    } catch (_) {
        return 'unreadable reason';
    }
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
// v0.1.4.8 (X9): options.language (the language table of the game) and options.kicked (the server sent
// the reason with a kick): the line also names the reason as the server gave it, for example
// `[LoginGuard] Kicked: Removed from server due to flying, spamming, or invalid movement. The server said: Kicked for spamming`.
export function handleDisconnection(agentName, reason, options = {}) {
    const { type, msg } = parseKickReason(reason);

    // Format: [LoginGuard] Error Message
    let finalMsg = `[LoginGuard] ${msg}`;
    if (type !== 'unknown' && type !== 'other') {
        const said = serverReasonText(reason, options?.language ?? null);
        if (said !== '' && !msg.includes(said))
            finalMsg += options?.kicked ? ` The server said: ${said}` : ` (${said})`;
    }

    // Only call log once (it handles console printing)
    log(agentName, finalMsg);

    return { type, msg: finalMsg };
}

/**
 * v0.1.4.8 (X9): decides once how the connection ended. When the server kicks the bot, the socket can close
 * before the packet with the reason is read (the packets pass the decompression one tick later), so 'end'
 * came first and the reason was lost: a kick for spamming ended as "Server is under maintenance or
 * restarting". After an end the watcher waits waitMs for a kick; a kick or an error decides at once. Each
 * event is { event: 'Kicked' | 'Disconnected' | 'Error', reason }. onFinal is called exactly once.
 * @param {{onFinal: Function, waitMs?: number, schedule?: Function, cancel?: Function}} options
 * @returns {{kicked: Function, ended: Function, error: Function, pending: boolean, settled: boolean}}
 */
export function createDisconnectWatcher({ onFinal, waitMs = 1000, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t) } = {}) {
    let timer = null;
    let ended = null;
    const watcher = {
        pending: false,
        settled: false,
        kicked: (reason) => finish({ event: 'Kicked', reason }),
        error: (reason) => finish({ event: 'Error', reason }),
        ended: (reason) => {
            if (watcher.settled || watcher.pending)
                return;
            watcher.pending = true;
            ended = { event: 'Disconnected', reason };
            timer = schedule(() => finish(ended), waitMs);
        },
    };
    function finish(result) {
        if (watcher.settled)
            return;
        watcher.settled = true;
        watcher.pending = false;
        if (timer !== null) {
            try { cancel(timer); } catch (_) { /* already gone */ }
            timer = null;
        }
        if (typeof onFinal === 'function')
            onFinal(result.event, result.reason);
    }
    return watcher;
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