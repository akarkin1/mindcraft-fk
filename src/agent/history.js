import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { NPCData } from './npc/data.js';
import settings from './settings.js';
import { writeJsonAtomic, readJsonSafe } from '../utils/safe_json.js';
import { isModelErrorResponse } from '../utils/model_errors.js';


export class History {
    constructor(agent, options = {}) {
        this.agent = agent;
        this.name = agent.name;
        this.bots_dir = options?.bots_dir ?? './bots';
        this.memory_fp = `${this.bots_dir}/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`${this.bots_dir}/${this.name}/histories`, { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5; 
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
    }

    getHistory() { // expects an Examples object
        return JSON.parse(JSON.stringify(this.turns));
    }

    async summarizeMemories(turns) {
        console.log("Storing memories...");
        let summary;
        try {
            summary = await this.agent.prompter.promptMemSaving(turns);
        } catch (error) {
            console.warn('Memory summary failed, keeping the previous memory:', error);
            return false;
        }
        if (isModelErrorResponse(summary)) {
            console.warn('Memory summary failed, keeping the previous memory. Model returned:', summary);
            return false;
        }
        this.memory = summary;

        if (this.memory.length > 500) {
            this.memory = this.memory.slice(0, 500);
            this.memory += '...(Memory truncated to 500 chars. Compress it more next time)';
        }

        console.log("Memory updated to: ", this.memory);
        return true;
    }

    async appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = `${this.bots_dir}/${this.name}/histories/${string_timestamp}.json`;
            writeFileSync(this.full_history_fp, '[]', 'utf8');
        }
        try {
            const data = readFileSync(this.full_history_fp, 'utf8');
            let full_history = JSON.parse(data);
            full_history.push(...to_store);
            writeFileSync(this.full_history_fp, JSON.stringify(full_history, null, 4), 'utf8');
        } catch (err) {
            console.error(`Error reading ${this.name}'s full history file: ${err.message}`);
        }
    }

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push({role, content});

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            const summarized = await this.summarizeMemories(chunk);
            if (summarized) {
                await this.appendFullHistory(chunk);
            }
            else if (this.turns.length + chunk.length < 2 * this.max_messages) {
                // summary failed: put the chunk back in front, the next add tries again
                this.turns.unshift(...chunk);
            }
            else {
                // summary keeps failing: drop the chunk from context to bound the growth
                console.warn(`Memory summary failed and history reached ${2 * this.max_messages} turns, dropping ${chunk.length} turns from context without a summary.`);
                await this.appendFullHistory(chunk);
            }
        }
    }

    async save() {
        try {
            const data = {
                memory: this.memory,
                turns: this.turns,
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
                taskStart: this.agent.task.taskStartTime,
                last_sender: this.agent.last_sender
            };
            writeJsonAtomic(this.memory_fp, data, { indent: 2 });
            console.log('Saved memory to:', this.memory_fp);
            return true;
        } catch (error) {
            console.error('Failed to save history:', error);
            return false;
        }
    }

    load() {
        try {
            const result = readJsonSafe(this.memory_fp, { expect: 'object' });
            if (result.status === 'missing') {
                console.log('No memory file found.');
                return null;
            }
            if (result.status !== 'ok') {
                let warning = `Failed to load history from ${this.memory_fp} (${result.status}: ${result.error?.message}).`;
                if (result.quarantinedTo)
                    warning += ` Corrupt file moved to ${result.quarantinedTo}.`;
                console.warn(warning + ' Starting with empty memory.');
                this.memory = '';
                this.turns = [];
                return null;
            }
            const data = result.data;
            this.memory = typeof data.memory === 'string' ? data.memory : '';
            this.turns = Array.isArray(data.turns) ? data.turns : [];
            console.log('Loaded memory:', this.memory);
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
            this.memory = '';
            this.turns = [];
            return null;
        }
    }

    clear() {
        this.turns = [];
        this.memory = '';
    }
}