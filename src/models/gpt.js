import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';
import { reportUsage } from '../agent/cost/usage_context.js';

function tokenCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

// cost meter (v0.1.4.9, I9): the usage of a successful request, reported like claude.js does.
// OpenAI counts the cached input tokens inside the input tokens; the meter counts them apart.
// The reasoning tokens are inside the output tokens. Without a usage object nothing is reported.
function reportOpenAIUsage(model, usage, input, output, cached) {
    if (usage === null || typeof usage !== 'object')
        return;
    const cache_read_tokens = tokenCount(cached);
    reportUsage({
        model: model,
        input_tokens: Math.max(0, tokenCount(input) - cache_read_tokens),
        output_tokens: tokenCount(output),
        cache_read_tokens: cache_read_tokens,
        cache_write_tokens: 0,
    });
}

export class GPT {
    static prefix = 'openai';
    // options.client: an object with the methods of the OpenAI client that this adapter calls
    // (responses.create, chat.completions.create, embeddings.create), used instead of a client made
    // with the key; for the tests (v0.1.4.9, D1). Without it the key is needed, as before.
    constructor(model_name, url, params, options = {}) {
        this.model_name = model_name;
        this.params = params;
        this.url = url; // store so that we know whether a custom URL has been set

        if (options?.client) {
            this.openai = options.client;
            return;
        }

        let config = {};
        if (url)
            config.baseURL = url;

        if (hasKey('OPENAI_ORG_ID'))
            config.organization = getKey('OPENAI_ORG_ID');

        config.apiKey = getKey('OPENAI_API_KEY');

        this.openai = new OpenAIApi(config);
    }

    async sendRequest(turns, systemMessage, stop_seq='***') {
        let messages = strictFormat(turns);
        messages = messages.map(message => {
            message.content += stop_seq;
            return message;
        });
        let model = this.model_name || "gpt-4o-mini";

        let res = null;

        try {
            console.log('Awaiting openai api response from model', model);
            // if a custom URL is set, use chat.completions
            // because custom "OpenAI-compatible" endpoints likely do not have responses endpoint
            if (this.url) {
                let messages = [{'role': 'system', 'content': systemMessage}].concat(turns);
                messages = strictFormat(messages);
                const pack = {
                    model: model,
                    messages,
                    stop: stop_seq,
                    ...(this.params || {})
                };
                if (model.includes('o1') || model.includes('o3') || model.includes('5')) {
                    delete pack.stop;
                }
                let completion = await this.openai.chat.completions.create(pack);
                // counted before the length check: a cut answer is paid for as well
                const usage = completion?.usage;
                reportOpenAIUsage(model, usage, usage?.prompt_tokens, usage?.completion_tokens, usage?.prompt_tokens_details?.cached_tokens);
                if (completion.choices[0].finish_reason == 'length')
                    throw new Error('Context length exceeded'); 
                console.log('Received.');
                res = completion.choices[0].message.content;
            } 
            // otherwise, use responses
            else {
                let messages = strictFormat(turns);
                messages = messages.map(message => {
                    message.content += stop_seq;
                    return message;
                });
                const response = await this.openai.responses.create({
                    model: model,
                    instructions: systemMessage,
                    input: messages,
                    ...(this.params || {})
                });
                const usage = response?.usage;
                reportOpenAIUsage(model, usage, usage?.input_tokens, usage?.output_tokens, usage?.input_tokens_details?.cached_tokens);
                console.log('Received.');
                res = response.output_text;
                let stop_seq_index = res.indexOf(stop_seq);
                res = stop_seq_index !== -1 ? res.slice(0, stop_seq_index) : res;
            }
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq);
            } else if (err.message.includes('image_url')) {
                console.log(err);
                res = 'Vision is only supported by certain models.';
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        return res;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "input_text", text: systemMessage },
                {
                    type: "input_image",
                    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        if (text.length > 8191)
            text = text.slice(0, 8191);
        const model = this.model_name || "text-embedding-3-small";
        const embedding = await this.openai.embeddings.create({
            model: model,
            input: text,
            encoding_format: "float",
        });
        // usage_context has no purpose for embeddings: the purpose is the one of the caller
        reportOpenAIUsage(model, embedding?.usage, embedding?.usage?.prompt_tokens, 0, 0);
        return embedding.data[0].embedding;
    }

}

const sendAudioRequest = async (text, model, voice, url) => {
    const payload = {
        model: model,
        voice: voice,
        input: text
    }

    let config = {};

    if (url)
        config.baseURL = url;

    if (hasKey('OPENAI_ORG_ID'))
        config.organization = getKey('OPENAI_ORG_ID');

    config.apiKey = getKey('OPENAI_API_KEY');

    const openai = new OpenAIApi(config);

    const mp3 = await openai.audio.speech.create(payload);
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const base64 = buffer.toString("base64");
    return base64;
}

export const TTSConfig = {
    sendAudioRequest: sendAudioRequest,
    baseUrl: 'https://api.openai.com/v1',
}
