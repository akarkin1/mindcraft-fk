// Fixed sentences that the model wrappers in src/models/*.js return as the
// "reply" when the API call fails or returns nothing. They must never be
// treated as real model output (for example stored as the bot's memory).
export const MODEL_ERROR_RESPONSES = Object.freeze([
    'My brain disconnected, try again.',                // most wrappers, API error
    'No response from Claude.',                         // claude.js, no text content
    'No response data.',                                // ollama.js, empty API response
    'No response received.',                            // openrouter.js, no choices
    'Vision is only supported by certain models.',      // claude, gemini, gpt, grok, groq, mercury, mistral
    'An unexpected error occurred, please try again.',  // gemini.js, vision error
    'I thought too hard, sorry, try again.',            // huggingface, hyperbolic, ollama: no valid <think> reply
    'I thought too hard, sorry, try again',             // glhf.js, same case without the period
]);

const NORMALISED_RESPONSES = MODEL_ERROR_RESPONSES.map(s => s.toLowerCase());

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/**
 * True when text is not usable model output: not a string, empty or
 * whitespace only, or one of MODEL_ERROR_RESPONSES (case-insensitive,
 * exact or as a prefix). A <think>...</think> block at the start is ignored.
 * @param {*} text
 * @returns {boolean}
 */
export function isModelErrorResponse(text) {
    if (typeof text !== 'string' || text.trim() === '') {
        return true;
    }
    let body = text;
    if (body.trimStart().startsWith(THINK_OPEN)) {
        const end = body.indexOf(THINK_CLOSE);
        if (end !== -1) {
            body = body.slice(end + THINK_CLOSE.length);
        }
    }
    body = body.trim().toLowerCase();
    if (body === '') {
        return true;
    }
    return NORMALISED_RESPONSES.some(sentence => body.startsWith(sentence));
}
