// World identity: derives a stable key for the Minecraft world the bot is
// connected to. Nothing in the protocol names a world; the stable fingerprint
// is the hashed seed of the raw login packet. Pure functions, no side effects.
import crypto from 'node:crypto';

const INT32_MIN = -0x80000000;
const UINT32_MAX = 0xFFFFFFFF;
const ZERO_KEY = '0000000000000000';
const WORLD_ID_MAX = 48;
const MOTD_MAX = 80;
const MAX_DEPTH = 64;

function isWord(value) {
    return typeof value === 'number' && Number.isInteger(value)
        && value >= INT32_MIN && value <= UINT32_MAX;
}

function hex64(value) {
    return BigInt.asUintN(64, value).toString(16).padStart(16, '0');
}

function wordHex(word) {
    return (word >>> 0).toString(16).padStart(8, '0');
}

// Cuts to at most max UTF-16 code units without leaving half a surrogate pair.
function cutText(text, max) {
    if (text.length <= max) {
        return text;
    }
    let cut = text.slice(0, max);
    const last = cut.charCodeAt(cut.length - 1);
    if (last >= 0xD800 && last <= 0xDBFF) {
        cut = cut.slice(0, -1);
    }
    return cut;
}

/**
 * 64-bit value as 16 lowercase hex characters, read as unsigned, or null.
 * Accepts a bigint, a [high, low] pair of 32-bit integers (the form the
 * protocol library uses for 64-bit numbers), a safe integer or a decimal string.
 * @param {*} value
 * @returns {string|null}
 */
export function hashedSeedToKey(value) {
    try {
        if (typeof value === 'bigint') {
            return hex64(value);
        }
        if (typeof value === 'number') {
            return Number.isSafeInteger(value) ? hex64(BigInt(value)) : null;
        }
        if (typeof value === 'string') {
            return /^-?\d+$/.test(value) ? hex64(BigInt(value)) : null;
        }
        if (value !== null && typeof value === 'object' && value.length === 2) {
            const high = value[0];
            const low = value[1];
            if (isWord(high) && isWord(low)) {
                return wordHex(high) + wordHex(low);
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * World id from the settings, reduced to A-Z a-z 0-9 _ - and 48 characters.
 * @param {*} text
 * @returns {string|null}
 */
export function sanitizeWorldId(text) {
    if (typeof text !== 'string') {
        return null;
    }
    const cleaned = text.trim().replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, WORLD_ID_MAX);
    return cleaned.length > 0 ? cleaned : null;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

// Raw text of a chat component (JSON form or NBT form as parsed by prismarine-nbt).
function componentText(node, depth, stack) {
    if (typeof node === 'string') {
        return node;
    }
    if (node === null || typeof node !== 'object' || depth > MAX_DEPTH || stack.has(node)) {
        return '';
    }
    stack.add(node);
    try {
        if (Array.isArray(node)) {
            return node.map(item => componentText(item, depth + 1, stack)).join('');
        }
        if (hasOwn(node, 'text') || hasOwn(node, 'extra') || hasOwn(node, '')) {
            // chat component; in NBT form `text` is a string tag, `extra` a list
            // tag and a list of mixed entries wraps plain text under the key ''
            let text = componentText(hasOwn(node, 'text') ? node.text : node[''], depth + 1, stack);
            text += componentText(node.extra, depth + 1, stack);
            return text;
        }
        if (hasOwn(node, 'type') && hasOwn(node, 'value')) {
            // NBT tag { type, value }
            return componentText(node.value, depth + 1, stack);
        }
        return '';
    } finally {
        stack.delete(node);
    }
}

/**
 * Best-effort plain text of a server description (MOTD). Never throws.
 * @param {*} motd
 * @returns {string}
 */
export function motdToText(motd) {
    try {
        let text = componentText(motd, 0, new Set());
        text = text.replace(/§[\s\S]?/gu, '');            // colour codes
        text = text.replace(/[\t\n\v\f\r]/g, ' ');          // line breaks and tabs separate words
        text = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // other control characters
        text = text.replace(/\s+/g, ' ').trim();
        return cutText(text, MOTD_MAX);
    } catch {
        return '';
    }
}

function boolOrNull(value) {
    return typeof value === 'boolean' ? value : null;
}

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Identifies the world from what the connection revealed. Never throws.
 * @param {{hashedSeed?: *, motd?: *, worldId?: *, isHardcore?: *, isFlat?: *}} input
 * @returns {{key: string, source: 'override'|'seed'|'fallback'|'unknown', label: string,
 *   hashedSeedHex: string|null, isHardcore: boolean|null, isFlat: boolean|null}}
 */
export function resolveWorld(input) {
    try {
        const src = input !== null && typeof input === 'object' ? input : {};
        const hashedSeedHex = hashedSeedToKey(src.hashedSeed);
        const motdText = motdToText(src.motd);
        const override = sanitizeWorldId(src.worldId);

        let key;
        let source;
        if (override !== null) {
            key = `id-${override}`;
            source = 'override';
        } else if (hashedSeedHex !== null && hashedSeedHex !== ZERO_KEY) {
            key = `seed-${hashedSeedHex}`;
            source = 'seed';
        } else if (motdText !== '') {
            key = `motd-${sha256Hex(motdText).slice(0, 16)}`;
            source = 'fallback';
        } else {
            key = 'unknown';
            source = 'unknown';
        }

        return {
            key,
            source,
            label: motdText !== '' ? motdText : key,
            hashedSeedHex,
            isHardcore: boolOrNull(src.isHardcore),
            isFlat: boolOrNull(src.isFlat),
        };
    } catch {
        return {
            key: 'unknown',
            source: 'unknown',
            label: 'unknown',
            hashedSeedHex: null,
            isHardcore: null,
            isFlat: null,
        };
    }
}
