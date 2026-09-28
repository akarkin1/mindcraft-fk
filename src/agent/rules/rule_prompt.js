// The section with the rules of the player for the conversing and the coding prompt (spec
// v0.1.4.6 R2). Pure: no imports, no side effects. The section is put into a prompt with
// insertSection of src/agent/skills/skill_prompt.js, after the skill section if there is one.

export const RULES_HEADER = 'RULES FROM THE PLAYER (always follow them, they are more important than your own ideas):';

function textOf(rule) {
    const text = typeof rule === 'string' ? rule : rule?.text;
    return typeof text === 'string' ? text.replace(/\r\n|\r|\n/g, ' ').trim() : '';
}

/**
 * One line `<number>. <text>` per rule. A rule is `{ id, text }` or a plain text. The number is
 * the id when it is a whole number of 1 or more, otherwise the position in the list. Rules without
 * a text, or that cannot be read, are left out. Never throws.
 * @param {Array<{id: number, text: string}|string>} rules
 * @returns {string[]}
 */
export function numberedRules(rules) {
    const lines = [];
    try {
        if (!Array.isArray(rules))
            return lines;
        for (let i = 0; i < rules.length; i++) {
            try {
                const rule = rules[i];
                const text = textOf(rule);
                if (text === '')
                    continue;
                const id = rule !== null && typeof rule === 'object' ? rule.id : undefined;
                const number = Number.isSafeInteger(id) && id >= 1 ? id : i + 1;
                lines.push(`${number}. ${text}`);
            } catch {
                // an entry that cannot be read is left out
            }
        }
    } catch {
        return [];
    }
    return lines;
}

/**
 * The rules section: the header and one numbered line per rule, joined with '\n'. '' without
 * rules. Never throws.
 * @param {Array<{id: number, text: string}|string>} rules
 * @returns {string}
 */
export function buildRulesSection(rules) {
    const lines = numberedRules(rules);
    if (lines.length === 0)
        return '';
    return [RULES_HEADER, ...lines].join('\n');
}
