// A rule of the player about an area (spec v0.1.4.10, R2): "never enter the chicken pen" names the
// area "chicken_pen" and says the bot must stay out. !rememberRule saves the rule as before and sets
// the flag no_enter of the area (area_store.setFlag). Pure: no imports. Never throws.

/** The words of a rule that keep the bot out of an area (case free). */
export const KEEP_OUT_WORDS = Object.freeze(['never enter', "don't enter", 'do not enter', 'stay out', 'keep out']);

// Lower case, the typographic apostrophe as ', every run of other signs and spaces one space.
function wordsOf(text) {
    return String(text).toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9']+/g, ' ').trim();
}

function saysKeepOut(words) {
    const padded = ` ${words} `;
    return KEEP_OUT_WORDS.some(phrase => padded.includes(` ${phrase} `));
}

// The words of an area name: "chicken_pen" and "Chicken Pen" give ['chicken', 'pen'].
function nameWords(name) {
    const words = wordsOf(String(name).replace(/_/g, ' '));
    return words.length > 0 ? words.split(' ') : [];
}

/**
 * The area that a rule keeps the bot out of: the rule contains `never enter`, `don't enter`, `do not
 * enter`, `stay out` or `keep out`, and names an area by any of its words, case free. When several
 * areas match, the one with the larger share of its words in the rule wins, then the one with more
 * words, then the first of the list. "never enter the chicken pen" with ["home", "pen", "chicken_pen"]
 * gives chicken_pen.
 * @param {string} ruleText
 * @param {string[]} areaNames the names of the saved areas
 * @returns {{area: string, flag: 'no_enter'}|null}
 */
export function areaFlagOf(ruleText, areaNames) {
    try {
        if (typeof ruleText !== 'string' || !Array.isArray(areaNames)) {
            return null;
        }
        const words = wordsOf(ruleText);
        if (!saysKeepOut(words)) {
            return null;
        }
        const ruleWords = new Set(words.split(' '));
        let best = null;
        for (const name of areaNames) {
            if (typeof name !== 'string') {
                continue;
            }
            const own = nameWords(name);
            const hits = own.filter(word => ruleWords.has(word)).length;
            if (hits === 0) {
                continue;
            }
            const share = hits / own.length;
            if (!best || share > best.share || (share === best.share && hits > best.hits)) {
                best = { name, share, hits };
            }
        }
        return best ? { area: best.name, flag: 'no_enter' } : null;
    } catch {
        return null;
    }
}
