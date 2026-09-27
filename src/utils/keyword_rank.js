// Keyword ranking used to pick relevant code docs when no embedding model is available.
// No imports and no side effects at import.

export const STOP_WORDS = Object.freeze([
    'a', 'an', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or', 'is', 'are', 'be', 'it',
    'this', 'that', 'with', 'as', 'by', 'from', 'please', 'you', 'your', 'me', 'my', 'i', 'can',
    'could', 'would', 'some', 'then', 'if', 'do', 'does', 'will', 'there', 'into', 'up', 'out'
]);

const STOP_WORD_SET = new Set(STOP_WORDS);

/**
 * Split a text into lower case keyword tokens.
 * camelCase and PascalCase words are split, every character that is not an ASCII letter
 * is a separator, and tokens shorter than 2 characters are dropped. Then, in this order:
 * a stop word is dropped, a token longer than 3 characters that ends in `s` but not in
 * `ss` loses the final `s`, a token that has become a stop word is dropped, and
 * duplicates are removed. So `this` and `does` give no token, `outs` gives none
 * either, `logs` gives `log` and `thesis` gives `thesi`.
 * @param {string} text
 * @returns {string[]} unique tokens in order of first appearance, [] if text is not a string.
 */
export function tokenize(text) {
    if (typeof text !== 'string')
        return [];
    const spaced = text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    const seen = new Set();
    const tokens = [];
    for (const part of spaced.split(/[^a-zA-Z]+/)) {
        let token = part.toLowerCase();
        if (token.length < 2)
            continue;
        if (STOP_WORD_SET.has(token))
            continue;
        if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss'))
            token = token.slice(0, -1);
        if (STOP_WORD_SET.has(token))
            continue;
        if (seen.has(token))
            continue;
        seen.add(token);
        tokens.push(token);
    }
    return tokens;
}

function toTokenSet(tokens) {
    if (tokens instanceof Set)
        return tokens;
    return Array.isArray(tokens) ? new Set(tokens) : new Set();
}

/**
 * Jaccard index of two token lists: size of the intersection divided by size of the union.
 * Duplicates inside a list count once.
 * @param {string[]} tokensA
 * @param {string[]} tokensB
 * @returns {number} a value between 0 and 1, 0 if either list is empty.
 */
export function keywordScore(tokensA, tokensB) {
    const setA = toTokenSet(tokensA);
    const setB = toTokenSet(tokensB);
    if (setA.size === 0 || setB.size === 0)
        return 0;
    let intersection = 0;
    for (const token of setA) {
        if (setB.has(token))
            intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return intersection / union;
}

/**
 * Rank items by the keyword similarity of their text to a query.
 * @param {string} query
 * @param {Array} items - not mutated.
 * @param {function} getText - returns the text of an item, default the item itself.
 * @returns {{item: *, score: number, index: number}[]} a new array, sorted by score descending, ties by index ascending.
 */
export function rankByKeywords(query, items, getText = (x) => x) {
    if (!Array.isArray(items))
        return [];
    const queryTokens = tokenize(query);
    const ranked = [];
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const score = keywordScore(queryTokens, tokenize(getText(item)));
        ranked.push({ item, score, index });
    }
    ranked.sort((a, b) => (b.score - a.score) || (a.index - b.index));
    return ranked;
}
