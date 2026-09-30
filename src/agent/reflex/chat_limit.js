// A limit for the chat of the bot (v0.1.4.8, X9). The server kicks a player who sends more than about 10
// lines in quick succession ("Kicked for spamming"); the bot once said 11 lines in 2 s. Every line goes
// through one queue with a token bucket: 6 lines at once, then one new line every 1.2 s. Nothing is lost,
// the lines wait in order. A text that mineflayer would split into several chat lines counts per line.
// Pure: no imports. The clock and the timer are passed in; a timer of the real process does not keep it
// alive, so the lines that still wait when the process ends are dropped.

export const CHAT_LIMIT = Object.freeze({
    burst: 6,         // lines at once
    refillMs: 1200,   // one new line per 1.2 s
    lengthLimit: 256, // the longest chat line of the game (100 for versions with the feature lessCharsInChat)
});

/**
 * The bucket after the time that passed: one token per refillMs, at most burst. A clock that went back
 * counts as no time.
 * @param {{tokens: number, at: number}|null} bucket null: a full bucket
 * @param {number} now
 * @param {{burst: number, refillMs: number}} [rules]
 * @returns {{tokens: number, at: number}}
 */
export function refillBucket(bucket, now, rules = CHAT_LIMIT) {
    if (!bucket || !Number.isFinite(bucket.tokens) || !Number.isFinite(bucket.at))
        return { tokens: rules.burst, at: now };
    const passed = now - bucket.at;
    if (!(passed > 0))
        return { tokens: bucket.tokens, at: now };
    return { tokens: Math.min(rules.burst, bucket.tokens + passed / rules.refillMs), at: now };
}

/**
 * How long until the bucket has a whole token, 0 when it has one.
 * @param {{tokens: number}} bucket
 * @param {{refillMs: number}} [rules]
 * @returns {number} milliseconds
 */
export function waitForToken(bucket, rules = CHAT_LIMIT) {
    const tokens = Number.isFinite(bucket?.tokens) ? bucket.tokens : 0;
    return tokens >= 1 ? 0 : Math.ceil((1 - tokens) * rules.refillMs);
}

/**
 * The chat lines that mineflayer sends for one text, as chatWithHeader of its chat plugin splits it:
 * a command without a header ('/tp ...') is one line; else every line of the text (empty lines are left
 * out), cut into pieces of lengthLimit minus the length of the header. The pieces are without the header.
 * null for a message that is no text and no number (mineflayer throws for it).
 * @param {*} message
 * @param {string} [header] '' for bot.chat, '/tell <name> ' for bot.whisper
 * @param {number} [lengthLimit]
 * @returns {string[]|null}
 */
export function chatLines(message, header = '', lengthLimit = CHAT_LIMIT.lengthLimit) {
    if (typeof message === 'number')
        message = message.toString();
    if (typeof message !== 'string')
        return null;
    if (!header && message.startsWith('/'))
        return [message];
    const size = lengthLimit - header.length;
    if (!(size > 0))
        return [message];
    const lines = [];
    for (const line of message.split('\n')) {
        for (let i = 0; i < line.length; i += size)
            lines.push(line.substring(i, i + size));
    }
    return lines;
}

/**
 * The queue of chat lines. push(send) sends at once while the bucket has a token and nothing waits,
 * else the line waits for its turn. A send that throws is logged and the next line goes on.
 */
export class ChatLimiter {
    /**
     * @param {{now?: Function, schedule?: Function, cancel?: Function, log?: Function, burst?: number, refillMs?: number}} [options]
     *   schedule(fn, ms) returns a handle for cancel(handle); by default setTimeout that does not keep the process alive
     */
    constructor(options = {}) {
        this.rules = {
            burst: Number.isFinite(options.burst) && options.burst >= 1 ? options.burst : CHAT_LIMIT.burst,
            refillMs: Number.isFinite(options.refillMs) && options.refillMs > 0 ? options.refillMs : CHAT_LIMIT.refillMs,
        };
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.schedule = typeof options.schedule === 'function' ? options.schedule : (fn, ms) => {
            const timer = setTimeout(fn, ms);
            timer?.unref?.();
            return timer;
        };
        this.cancel = typeof options.cancel === 'function' ? options.cancel : (timer) => clearTimeout(timer);
        this.log = typeof options.log === 'function' ? options.log : (...args) => console.warn(...args);
        this.bucket = null;
        this.queue = [];
        this.timer = null;
        this.sent = 0;
    }

    /** The number of lines that wait. */
    get waiting() {
        return this.queue.length;
    }

    /**
     * Queues one line: send() is called when it is its turn.
     * @param {Function} send
     */
    push(send) {
        if (typeof send !== 'function')
            return;
        this.queue.push(send);
        this.pump();
    }

    /** Sends the lines whose turn it is and waits for the next token. */
    pump() {
        while (this.queue.length > 0) {
            this.bucket = refillBucket(this.bucket, this.now(), this.rules);
            if (this.bucket.tokens < 1) {
                this._wait(waitForToken(this.bucket, this.rules));
                return;
            }
            this.bucket.tokens -= 1;
            const send = this.queue.shift();
            this.sent++;
            try {
                send();
            } catch (error) {
                try {
                    this.log('Could not send a chat line:', error?.message ?? error);
                } catch {
                    // nothing to log to
                }
            }
        }
    }

    /** Drops the lines that wait (the process ends) and the timer. */
    drop() {
        this.queue = [];
        if (this.timer !== null) {
            try {
                this.cancel(this.timer);
            } catch {
                // already gone
            }
            this.timer = null;
        }
    }

    _wait(ms) {
        if (this.timer !== null)
            return;
        this.timer = this.schedule(() => {
            this.timer = null;
            this.pump();
        }, Math.max(1, ms));
    }
}

/**
 * Puts bot.chat and bot.whisper of a mineflayer bot behind one ChatLimiter. Every chat line of the bot
 * goes through them: the answers, the reflexes, the texts of the skills, the echo of a typed command, the
 * commands of the cheat mode. A text is split into its chat lines first, so each line counts. What is no
 * text goes to mineflayer as before (it throws). Installed once per bot; returns the limiter.
 * @param {object} bot
 * @param {object} [options] the options of ChatLimiter
 * @returns {ChatLimiter|null} null when the bot has no chat yet
 */
export function installChatLimit(bot, options = {}) {
    if (!bot || typeof bot !== 'object')
        return null;
    if (bot.chatLimiter instanceof ChatLimiter)
        return bot.chatLimiter;
    if (typeof bot.chat !== 'function' && typeof bot.whisper !== 'function')
        return null;
    const limiter = new ChatLimiter(options);
    const lengthLimit = () => {
        try {
            return bot.supportFeature?.('lessCharsInChat') ? 100 : CHAT_LIMIT.lengthLimit;
        } catch {
            return CHAT_LIMIT.lengthLimit;
        }
    };
    const chat = typeof bot.chat === 'function' ? bot.chat : null;
    const whisper = typeof bot.whisper === 'function' ? bot.whisper : null;
    if (chat) {
        bot.chat = (message) => {
            const lines = chatLines(message, '', lengthLimit());
            if (lines === null)
                return chat.call(bot, message);
            for (const line of lines)
                limiter.push(() => chat.call(bot, line));
        };
    }
    if (whisper) {
        bot.whisper = (username, message) => {
            const lines = chatLines(message, `/tell ${username} `, lengthLimit());
            if (lines === null)
                return whisper.call(bot, username, message);
            for (const line of lines)
                limiter.push(() => whisper.call(bot, username, line));
        };
    }
    bot.chatLimiter = limiter;
    return limiter;
}
