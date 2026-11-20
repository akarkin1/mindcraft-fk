// Replies of the commands !rememberRule, !forgetRule and !rules, and the description of
// !rememberRule, word for word from spec v0.1.4.6 R3. The commands are defined in actions.js and
// queries.js; their perform() passes the rule store of the agent to these functions.
// Pure: the store is passed in. Never throws.
import { numberedRules } from './rule_prompt.js';

export const REMEMBER_RULE_DESCRIPTION = 'Save a lasting rule from the player: "always", "never", "remember", "do not forget", "from now on". One short sentence.';

// Not in the spec: the answer when the store is missing or fails.
const NOT_AVAILABLE = 'The rules are not available.';

function warn(what, error) {
    try {
        console.warn(`Could not ${what}:`, error?.message ?? String(error));
    } catch {
        // nothing more to do
    }
}

/**
 * v0.1.4.16 (F3): the cap of a rule with the count of the text given: `A rule has at most 200 characters; yours has 231.`
 * @param {number} n the length of the text, as the store counts it (trimmed, line breaks as spaces)
 * @returns {string}
 */
export function ruleTooLongText(n) {
    return `A rule has at most 200 characters; yours has ${Number.isInteger(n) && n >= 0 ? n : 0}.`;
}

// The length of a text as the store counts it (RuleStore.add's cleanText: line breaks as spaces, trimmed).
function textLength(text) {
    return typeof text === 'string' ? text.replace(/\r\n|\r|\n/g, ' ').trim().length : 0;
}

/**
 * @param {{add: function, list: function, max: number}} store - a RuleStore
 * @param {string} text
 * @param {(line: string) => void} [say] v0.1.4.16 (F3): says the cap line itself (agent.sayText) when the text is too long
 * @returns {string} `Rule 3 saved: "<text>"` or the reason why not
 */
export function rememberRuleReply(store, text, say = null) {
    try {
        const result = store.add(text);
        if (result.ok) {
            const saved = store.list().find(rule => rule.id === result.id);
            return `Rule ${result.id} saved: "${saved ? saved.text : String(text).trim()}"`;
        }
        switch (result.reason) {
            case 'duplicate':
                return 'That rule is already saved.';
            case 'too_long': {
                const line = ruleTooLongText(textLength(text));
                if (typeof say === 'function') {
                    try {
                        say(line); // the bot says the cap itself; the model gets the same line
                    } catch (error) {
                        warn('say the cap of a rule', error);
                    }
                }
                return line;
            }
            case 'full':
                return `I already have ${store.max} rules. Forget one first with !forgetRule.`;
            case 'empty':
                return 'A rule needs a text.';
            default:
                warn('save the rule', new Error(`unknown reason ${result.reason}`));
                return NOT_AVAILABLE;
        }
    } catch (error) {
        warn('save the rule', error);
        return NOT_AVAILABLE;
    }
}

/**
 * @param {{remove: function}} store - a RuleStore
 * @param {number} number
 * @returns {string} `Forgot rule 3.` or `There is no rule 3.`
 */
export function forgetRuleReply(store, number) {
    try {
        return store.remove(number) ? `Forgot rule ${number}.` : `There is no rule ${number}.`;
    } catch (error) {
        warn('forget the rule', error);
        return NOT_AVAILABLE;
    }
}

/**
 * @param {{list: function}} store - a RuleStore
 * @returns {string} the numbered list, one rule per line, or `No rules are saved yet.`
 */
export function rulesReply(store) {
    try {
        const lines = numberedRules(store.list());
        return lines.length > 0 ? lines.join('\n') : 'No rules are saved yet.';
    } catch (error) {
        warn('list the rules', error);
        return NOT_AVAILABLE;
    }
}
