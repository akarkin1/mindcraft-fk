// The two parts of the conversing prompt with prompt_cache (v0.1.4.13, M2): the fixed part is the template up to
// and including $COMMAND_DOCS without the placeholders that change with every call ($MEMORY, $STATS, $INVENTORY,
// $KNOWLEDGE, $EXAMPLES, and $CUSTOM_SKILLS of the saved skills); the changing part holds those placeholders in the
// order of the template and the rest of the template after $COMMAND_DOCS. The prompter fills each part with
// replaceStrings, puts the role line, the note and the sections into the changing part, and hands the Anthropic
// adapter the two parts (the fixed one cache-marked) and every other model the joined string. Pure: no imports.

/** The placeholder that ends the fixed part. */
export const FIXED_END = '$COMMAND_DOCS';

/** The placeholders of the changing part, moved out of the fixed part. */
export const CHANGING_PLACEHOLDERS = Object.freeze(['$MEMORY', '$STATS', '$INVENTORY', '$KNOWLEDGE', '$EXAMPLES', '$CUSTOM_SKILLS']);

const PLACEHOLDER = /\$[A-Z_]+/g;

// The placeholders of a line, in their order, as [{ name, changing }].
function placeholdersOf(line) {
    const found = [];
    for (const match of line.matchAll(PLACEHOLDER)) {
        const name = match[0];
        // $CUSTOM_SKILLS is one placeholder, not $CUSTOM_SKILL and S; a longer name that starts with a changing one is not it
        found.push({ name, changing: CHANGING_PLACEHOLDERS.includes(name) });
    }
    return found;
}

/**
 * Splits a template at the end of `$COMMAND_DOCS`. A line of the fixed part that holds changing placeholders and no
 * other placeholder moves whole into the changing part (its text with them, so "Summarized memory:'$MEMORY'" keeps
 * its label); on a line with both kinds only the changing placeholders are cut out, each onto its own line of the
 * changing part. The fixed part ends with a line break; the changing part is the moved lines, then the rest of the
 * template after `$COMMAND_DOCS`. Both parts are templates still: fill them with replaceStrings.
 * @param {string} template the conversing template of the profile
 * @returns {{fixed: string, changing: string}|null} null for a template without `$COMMAND_DOCS` (no split)
 */
export function splitTemplate(template) {
    if (typeof template !== 'string') {
        return null;
    }
    const at = template.indexOf(FIXED_END);
    if (at < 0) {
        return null;
    }
    const cut = at + FIXED_END.length;
    const head = template.slice(0, cut);
    const tail = template.slice(cut);
    const kept = [];
    const moved = [];
    for (const line of head.split('\n')) {
        const found = placeholdersOf(line);
        if (!found.some(p => p.changing)) {
            kept.push(line);
            continue;
        }
        if (found.every(p => p.changing)) {
            moved.push(line);
            continue;
        }
        let rest = line;
        for (const p of found) {
            if (p.changing) {
                moved.push(p.name);
                rest = rest.replace(p.name, '');
            }
        }
        kept.push(rest);
    }
    let changing = moved.join('\n') + tail;
    if (moved.length === 0 && tail.startsWith('\n')) {
        changing = tail.slice(1);
    }
    return { fixed: kept.join('\n') + '\n', changing };
}

/**
 * The one system prompt of the two parts, for a model that takes a string and for the log.
 * @param {string} fixed
 * @param {string} changing
 * @returns {string}
 */
export function joinParts(fixed, changing) {
    return `${typeof fixed === 'string' ? fixed : ''}${typeof changing === 'string' ? changing : ''}`;
}

/**
 * The changing part with the lines that must stand in it: each line that is not empty and not in the text yet goes
 * in front, in the given order (the role line and the note, when their anchor "Summarized memory:" is missing).
 * @param {string} changing
 * @param {string[]} lines
 * @returns {string}
 */
export function withLeadingLines(changing, lines) {
    const text = typeof changing === 'string' ? changing : '';
    const missing = (Array.isArray(lines) ? lines : []).filter(l => typeof l === 'string' && l !== '' && !text.includes(l));
    return missing.length === 0 ? text : `${missing.join('\n')}\n${text}`;
}

/**
 * The system prompt as the Anthropic API takes it with the cache mark: a text block per part, the fixed part (the
 * first) with `cache_control: { type: 'ephemeral' }`; an empty part is left out (the API refuses an empty text
 * block), and the changing part never carries the mark.
 * @param {string[]} parts the fixed part first, then the changing part
 * @returns {object[]}
 */
export function systemBlocks(parts) {
    const blocks = [];
    (Array.isArray(parts) ? parts : []).forEach((text, i) => {
        if (typeof text !== 'string' || text.length === 0) {
            return;
        }
        blocks.push(i === 0 ? { type: 'text', text, cache_control: { type: 'ephemeral' } } : { type: 'text', text });
    });
    return blocks;
}
