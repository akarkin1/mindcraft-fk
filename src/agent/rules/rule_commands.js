// Replies of the commands !rememberRule, !forgetRule and !rules, and the description of
// !rememberRule, word for word from spec v0.1.4.6 R3. The commands are defined in actions.js and
// queries.js; their perform() passes the rule store of the agent to these functions.
// Pure: the store is passed in. Never throws.
import { numberedRules } from './rule_prompt.js';

export const REMEMBER_RULE_DESCRIPTION = 'Save a lasting rule from the player. Use this when the player tells you to always or never do something, or says "remember", "do not forget" or "from now on". Write the rule as one short sentence.';

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
 * @param {{add: function, list: function, max: number}} store - a RuleStore
 * @param {string} text
 * @returns {string} `Rule 3 saved: "<text>"` or the reason why not
 */
export function rememberRuleReply(store, text) {
    try {
        const result = store.add(text);
        if (result.ok) {
            const saved = store.list().find(rule => rule.id === result.id);
            return `Rule ${result.id} saved: "${saved ? saved.text : String(text).trim()}"`;
        }
        switch (result.reason) {
            case 'duplicate':
                return 'That rule is already saved.';
            case 'too_long':
                return 'A rule has at most 200 characters.';
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
