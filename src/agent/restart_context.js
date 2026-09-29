// v0.1.4.8, F3: what the bot knew when its process ended, for the next process. Setting
// restart_context.
//
// writeExit() saves the reason of the end, the order of the player and the position to
// bots/<name>/last_exit.json right before the process exits. readExit() reads it at the next start,
// deletes it and hands it on when it is recent. restartNote() makes the text for the model.
// The folder bots/ is never committed.
import fs from 'node:fs';
import path from 'node:path';
import { readJsonSafe, writeJsonAtomic } from '../utils/safe_json.js';

export const EXIT_FILE = 'last_exit.json';
export const MAX_AGE_MS = 10 * 60 * 1000;
const FILE_VERSION = 1;
const MAX_TEXT = 300;

function warn(text, err) {
    try {
        console.warn(`${text}: ${err?.message ?? err}`);
    } catch {
        // nothing left to report to
    }
}

// A trimmed, one-line text of at most MAX_TEXT characters, or null.
function cleanText(value) {
    if (typeof value !== 'string')
        return null;
    const clean = value.replace(/\s+/g, ' ').trim();
    if (clean.length === 0)
        return null;
    return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 3)}...` : clean;
}

// { by, command } from an order such as agent.last_order, or from the text of a command. The full
// text of the command (order.text) wins over its name (order.command).
function cleanOrder(order) {
    if (typeof order === 'string') {
        const command = cleanText(order);
        return command === null ? null : { by: null, command };
    }
    if (order === null || typeof order !== 'object')
        return null;
    const command = cleanText(order.text) ?? cleanText(order.command);
    if (command === null)
        return null;
    return { by: cleanText(order.by), command };
}

// Whole block coordinates, or null.
function cleanPosition(position) {
    if (position === null || typeof position !== 'object')
        return null;
    const out = {};
    for (const axis of ['x', 'y', 'z']) {
        const value = Number(position[axis]);
        if (!Number.isFinite(value))
            return null;
        out[axis] = Math.floor(value);
    }
    return out;
}

function cleanTime(time) {
    const ms = time instanceof Date ? time.getTime() : time;
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : Date.now();
}

/**
 * Saves the context of the end to <dir>/last_exit.json, synchronously, so it can run right before
 * process.exit(). Never throws.
 * @param {string} dir the folder of the bot, bots/<name>
 * @param {{reason?: string, order?: {by?: string, command?: string, text?: string}|string|null,
 *          action?: string|null, position?: {x: number, y: number, z: number}|null, time?: number|Date}} exit
 *        order: the running order of a player (agent.last_order; text, when given, is the full
 *        command such as '!mineOre("iron", 8)'). action: the label of the running action.
 *        time: default now.
 * @returns {boolean} true when the file was written
 */
export function writeExit(dir, { reason, order, action, position, time } = {}) {
    try {
        if (typeof dir !== 'string' || dir.length === 0)
            return false;
        writeJsonAtomic(path.join(dir, EXIT_FILE), {
            version: FILE_VERSION,
            reason: cleanText(reason),
            order: cleanOrder(order),
            action: cleanText(action),
            position: cleanPosition(position),
            time: cleanTime(time),
        });
        return true;
    } catch (err) {
        warn('Could not save the reason of the end', err);
        return false;
    }
}

/**
 * Reads <dir>/last_exit.json and deletes it, also when it is too old or broken. Never throws.
 * @param {string} dir the folder of the bot, bots/<name>
 * @param {number} maxAgeMs an older file gives null; default 10 minutes
 * @param {() => number} now milliseconds, for tests
 * @returns {{reason: string|null, order: {by: string|null, command: string}|null, action: string|null,
 *            position: {x: number, y: number, z: number}|null, time: number}|null}
 */
export function readExit(dir, maxAgeMs = MAX_AGE_MS, now = Date.now) {
    try {
        if (typeof dir !== 'string' || dir.length === 0)
            return null;
        const file = path.join(dir, EXIT_FILE);
        const result = readJsonSafe(file, { expect: 'object', quarantine: false });
        if (result.status === 'missing')
            return null;
        try {
            fs.rmSync(file, { force: true });
        } catch (err) {
            warn(`Could not delete ${file}`, err);
        }
        if (result.status !== 'ok')
            return null;
        const data = result.data;
        const time = data.time;
        const age = now() - time;
        const limit = typeof maxAgeMs === 'number' && Number.isFinite(maxAgeMs) ? maxAgeMs : MAX_AGE_MS;
        if (typeof time !== 'number' || !Number.isFinite(time) || !(age >= 0) || age > limit)
            return null;
        const exit = {
            reason: cleanText(data.reason),
            order: cleanOrder(data.order),
            action: cleanText(data.action),
            position: cleanPosition(data.position),
            time,
        };
        if (exit.reason === null && exit.order === null && exit.action === null && exit.position === null)
            return null;
        return exit;
    } catch (err) {
        warn('Could not read the reason of the last end', err);
        return null;
    }
}

// A sentence ends with one period.
function sentence(text) {
    return `${text.replace(/[\s.]+$/, '')}.`;
}

/**
 * The text for the model after a restart, for example:
 * `Before the restart MartyByrde2 had ordered: !mineOre("iron", 8). The process ended because: Got
 * stuck and couldn't get unstuck. You are at (8, 41, 48). Do not repeat the order by yourself.
 * Tell the player what happened.`
 * @param {object|null} exit a result of readExit
 * @returns {string} '' without an exit
 */
export function restartNote(exit) {
    if (exit === null || typeof exit !== 'object')
        return '';
    const order = cleanOrder(exit.order);
    const action = cleanText(exit.action);
    const reason = cleanText(exit.reason);
    const position = cleanPosition(exit.position);
    const parts = [];
    if (order !== null)
        parts.push(sentence(`Before the restart ${order.by ?? 'a player'} had ordered: ${order.command}`));
    else if (action !== null)
        parts.push(sentence(`Before the restart you were running: ${action}`));
    if (reason !== null)
        parts.push(sentence(`The process ended because: ${reason}`));
    if (position !== null)
        parts.push(`You are at (${position.x}, ${position.y}, ${position.z}).`);
    if (parts.length === 0)
        return '';
    if (order !== null)
        parts.push('Do not repeat the order by yourself.');
    parts.push('Tell the player what happened.');
    return parts.join(' ');
}
