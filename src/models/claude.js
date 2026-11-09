import Anthropic from '@anthropic-ai/sdk';
import { strictFormat } from '../utils/text.js';
import { getKey } from '../utils/keys.js';
import { reportUsage } from '../agent/cost/usage_context.js';
import { systemBlocks } from './prompt_parts.js';

// v0.1.4.14 (P-21, spec 8.7): the filler of strictFormat (`_`, a user turn), which closes the list when its last turn is
// the assistant's. The models from Claude 4.6 on take no assistant prefill: a list that ends with the assistant's turn
// is a 400 ("The conversation must end with a user message") and the bot said "My brain disconnected, try again." The
// turns are copied when a filler is needed; a list that ends with a user turn is returned as it is.
export const CLOSING_TURN = Object.freeze({ role: 'user', content: '_' });
export function closedByUser(messages) {
    if (!Array.isArray(messages) || messages.length === 0)
        return [{ ...CLOSING_TURN }];
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant')
        return [...messages, { ...CLOSING_TURN }];
    return messages;
}

export class Claude {
    static prefix = 'anthropic';

    // v0.1.4.13 (M2): the prompter may hand the system prompt as two parts [fixed, changing] with prompt_cache;
    // sendRequest sends them as two text blocks with the cache mark on the first. A string is sent as before.
    get acceptsSystemParts() {
        return true;
    }

    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params || {};

        let config = {};
        if (url)
            config.baseURL = url;
        
        config.apiKey = getKey('ANTHROPIC_API_KEY');

        this.anthropic = new Anthropic(config);
    }

    async sendRequest(turns, systemMessage) {
        const messages = closedByUser(strictFormat(turns));
        let res = null;
        try {
            console.log(`Awaiting anthropic response from ${this.model_name}...`)
            if (!this.params.max_tokens) {
                if (this.params.thinking?.budget_tokens) {
                    this.params.max_tokens = this.params.thinking.budget_tokens + 1000;
                    // max_tokens must be greater than thinking.budget_tokens
                } else {
                    this.params.max_tokens = 4096;
                }
            }
            const model = this.model_name || "claude-sonnet-4-20250514";
            // v0.1.4.13 (M2): two parts become two blocks, cache_control ephemeral on the first; a string stays a string
            const system = Array.isArray(systemMessage) ? systemBlocks(systemMessage) : systemMessage;
            const resp = await this.anthropic.messages.create({
                model: model,
                system: Array.isArray(system) && system.length === 0 ? '' : system,
                messages: messages,
                ...(this.params || {})
            });
            // cost meter (v0.1.4.6): only a successful request is counted
            const usage = resp?.usage || {};
            reportUsage({
                model: model,
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cache_read_tokens: usage.cache_read_input_tokens,
                cache_write_tokens: usage.cache_creation_input_tokens,
            });

            console.log('Received.')
            // get first content of type text
            const textContent = resp.content.find(content => content.type === 'text');
            if (textContent) {
                res = textContent.text;
            } else {
                console.warn('No text content found in the response.');
                res = 'No response from Claude.';
            }
        }
        catch (err) {
            if (err.message.includes("does not support image input")) {
                res = "Vision is only supported by certain models.";
            } else {
                res = "My brain disconnected, try again.";
            }
            console.log(err);
        }
        return res;
    }

    async sendVisionRequest(turns, systemMessage, imageBuffer) {
        const imageMessages = [...turns];
        imageMessages.push({
            role: "user",
            content: [
                {
                    type: "text",
                    text: Array.isArray(systemMessage) ? systemMessage.join('') : systemMessage
                },
                {
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: "image/jpeg",
                        data: imageBuffer.toString('base64')
                    }
                }
            ]
        });

        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Claude.');
    }
}
