// Pure builders for the prompt sections about saved skills, and the insertion
// of a section into a prompt. No side effects at import.
import { rankByKeywords } from '../../utils/keyword_rank.js';

const CODING_HEADER = '#### SAVED SKILLS ###';

const CODING_RULES_NEW = [
    'RULES FOR NEW CODE:',
    '- If the task could be needed again, write it as ONE async function with a descriptive camelCase name, `bot` as the first parameter and the values of this task as further parameters. Put a /** ... **/ description with @param lines inside the function body. Put helper code inside that function. Return true on success and false on failure. Then call the function with the values of this task, for example: await buildDirtPlatform(bot, 3);',
    '- Do not write coordinates of this world into the function. Pass them as parameters or compute them from the position of the bot.',
    '- For a small one-off task, write plain statements without a function.',
].join('\n');

const CODING_RULES_SAVED = [
    'RULES FOR SAVED SKILLS:',
    '- Before you write new code, check the saved skills below. If one fits, call it: await customSkills.<name>(bot, ...);',
    '- If a saved skill almost fits, write an improved version of the function under the same name. It replaces the old version.',
    'The following saved skills are available:',
].join('\n');

const CODING_OTHERS = 'Other saved skills:';
const CODING_NONE = 'No skills are saved yet.';

const CONVERSING_INTRO = 'SAVED SKILLS: code you wrote earlier and can run again. To run one, use !newAction and name the skill and its values.';
const CONVERSING_COMMAND = ' You can also run one directly with !useSkill.';

const PLACEHOLDER = '$CUSTOM_SKILLS';

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function warningText(error) {
    try {
        return error?.message ?? String(error);
    } catch {
        return '[unprintable error]';
    }
}

// Same order as Array.prototype.sort without a comparator.
function compareNames(a, b) {
    if (a < b) {
        return -1;
    }
    return a > b ? 1 : 0;
}

function flagOf(flags, key) {
    try {
        return isObject(flags) ? Boolean(flags[key]) : false;
    } catch {
        return false;
    }
}

function activeSkills(skills) {
    if (!Array.isArray(skills)) {
        return [];
    }
    return skills.filter(skill => isObject(skill) && skill.status === 'active');
}

function textOf(value) {
    return typeof value === 'string' ? value : '';
}

function timeOf(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
}

// last_used descending, null (or unreadable) last, then by name
function compareByUse(a, b) {
    const timeA = timeOf(a.last_used);
    const timeB = timeOf(b.last_used);
    if (timeA !== timeB) {
        if (timeA === null) {
            return 1;
        }
        if (timeB === null) {
            return -1;
        }
        return timeB - timeA;
    }
    return compareNames(textOf(a.name), textOf(b.name));
}

function signatureText(skill) {
    const signature = textOf(skill.signature);
    return signature !== '' ? signature : textOf(skill.name);
}

function docText(skill) {
    const doc = textOf(skill.doc);
    return doc !== '' ? doc : textOf(skill.description);
}

function countOf(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * The section about saved skills for the coding prompt. A "skill info" is an
 * index entry of the SkillStore plus `doc`, the doc text of its source.
 * Returns '' when flags.capture and flags.reuse are both false. Otherwise the
 * header, the rules for new code (capture), and with reuse either the rules for
 * saved skills with the full doc of the first `maxDocs` active skills ranked by
 * keywords against the task, followed by at most `maxListed - maxDocs` other
 * active skills (last used first), or `No skills are saved yet.`. Never throws.
 * @param {{flags: {capture: boolean, reuse: boolean}, skills: object[], task: string, maxDocs?: number, maxListed?: number}} options
 * @returns {string} the parts joined with '\n'.
 */
export function buildCodingSection(options) {
    try {
        const { flags, skills, task, maxDocs = 8, maxListed = 50 } = isObject(options) ? options : {};
        const capture = flagOf(flags, 'capture');
        const reuse = flagOf(flags, 'reuse');
        if (!capture && !reuse) {
            return '';
        }
        const parts = [CODING_HEADER];
        if (capture) {
            parts.push(CODING_RULES_NEW);
        }
        if (reuse) {
            const active = activeSkills(skills);
            if (active.length === 0) {
                parts.push(CODING_NONE);
            } else {
                parts.push(CODING_RULES_SAVED);
                const docCount = countOf(maxDocs);
                const ranked = rankByKeywords(task, active, skill => skill.name + ' ' + skill.description)
                    .map(entry => entry.item);
                const withDocs = ranked.slice(0, docCount);
                for (const skill of withDocs) {
                    parts.push('### customSkills.' + textOf(skill.name) + '\n' + docText(skill));
                }
                const shown = new Set(withDocs);
                const others = active
                    .filter(skill => !shown.has(skill))
                    .sort(compareByUse)
                    .slice(0, countOf(countOf(maxListed) - docCount));
                if (others.length > 0) {
                    parts.push(CODING_OTHERS);
                    for (const skill of others) {
                        parts.push('- customSkills.' + signatureText(skill) + ': ' + textOf(skill.description));
                    }
                }
            }
        }
        return parts.join('\n');
    } catch (err) {
        console.warn('Could not build the saved skills section of the coding prompt:', warningText(err));
        return '';
    }
}

/**
 * The section about saved skills for the conversing prompt: one intro line (with
 * a hint to !useSkill when flags.command) and one line `- <signature>: <description>`
 * per active skill, at most `maxListed`, last used first, then by name.
 * Returns '' when flags.reuse is false or no active skill exists. Never throws.
 * @param {{flags: {reuse: boolean, command: boolean}, skills: object[], maxListed?: number}} options
 * @returns {string} the lines joined with '\n'.
 */
export function buildConversingSection(options) {
    try {
        const { flags, skills, maxListed = 20 } = isObject(options) ? options : {};
        if (!flagOf(flags, 'reuse')) {
            return '';
        }
        const active = activeSkills(skills);
        if (active.length === 0) {
            return '';
        }
        const lines = [CONVERSING_INTRO + (flagOf(flags, 'command') ? CONVERSING_COMMAND : '')];
        for (const skill of active.slice().sort(compareByUse).slice(0, countOf(maxListed))) {
            lines.push('- ' + signatureText(skill) + ': ' + textOf(skill.description));
        }
        return lines.join('\n');
    } catch (err) {
        console.warn('Could not build the saved skills section of the conversing prompt:', warningText(err));
        return '';
    }
}

/**
 * Puts a section into a prompt. Every `$CUSTOM_SKILLS` is replaced by the section,
 * so an empty section removes the placeholder. Without that placeholder an empty
 * section leaves the prompt unchanged; otherwise the section and a line break go
 * directly before the last line that is not empty when that line starts with
 * `Conversation`, or the section is appended after a line break. A section that is
 * not a string counts as empty. No replacement strings are used, so a `$` in the
 * section arrives unchanged. Never throws.
 * @param {string} prompt
 * @param {string} section
 * @returns {string}
 */
export function insertSection(prompt, section) {
    if (typeof prompt !== 'string') {
        return prompt;
    }
    const text = typeof section === 'string' ? section : '';
    if (prompt.includes(PLACEHOLDER)) {
        return prompt.split(PLACEHOLDER).join(text);
    }
    if (text === '') {
        return prompt;
    }
    const lines = prompt.split('\n');
    let start = prompt.length;
    for (let i = lines.length - 1; i >= 0; i--) {
        start -= lines[i].length;
        if (lines[i].trim() !== '') {
            if (lines[i].startsWith('Conversation')) {
                return prompt.slice(0, start) + text + '\n' + prompt.slice(start);
            }
            break;
        }
        start -= 1; // the '\n' before this line
    }
    return prompt + '\n' + text;
}
