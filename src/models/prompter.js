import { readFileSync, mkdirSync, writeFileSync} from 'fs';
import { Examples } from '../utils/examples.js';
import { getCommandDocs } from '../agent/commands/index.js';
import { SkillLibrary } from "../agent/library/skill_library.js";
import { stringifyTurns } from '../utils/text.js';
import { getCommand } from '../agent/commands/index.js';
import settings from '../agent/settings.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { selectAPI, createModel } from './_model_map.js';
import { insertSection } from '../agent/skills/skill_prompt.js';
import { extractTask } from '../agent/skills/skill_review.js';
import { withPurpose } from '../agent/cost/usage_context.js';
import { buildRulesSection } from '../agent/rules/rule_prompt.js';
import { visibleExamples } from '../agent/rules/example_filter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// With the cost meter, every call of a model is counted under its purpose (v0.1.4.6, G1).
function withPurposeOf(agent, purpose, request) {
    return agent?.cost_meter ? withPurpose(purpose, request) : request();
}

// The rules of the players go into the prompt after the saved skills (v0.1.4.6, R2 and G5).
function withRules(agent, prompt) {
    if (agent?.rule_store) {
        try {
            prompt = insertSection(prompt, buildRulesSection(agent.rule_store.list()));
        } catch (error) {
            console.warn('Could not add the rules of the players to the prompt:', error);
        }
    }
    return prompt;
}

// v0.1.4.8 (C1, I9): the block "what you know" of the agent (agent.knowledgeBlock, knowledgeText of
// src/agent/knowledge), with the setting knowledge_in_prompt; '' without it. Never throws.
function knowledgeOf(agent) {
    if (!settings.knowledge_in_prompt || typeof agent?.knowledgeBlock !== 'function')
        return '';
    try {
        const text = agent.knowledgeBlock();
        return typeof text === 'string' ? text : '';
    } catch (error) {
        console.warn('Could not add what the bot knows to the prompt:', error);
        return '';
    }
}

export class Prompter {
    constructor(agent, profile) {
        this.agent = agent;
        this.profile = profile;
        let default_profile = JSON.parse(readFileSync('./profiles/defaults/_default.json', 'utf8'));
        let base_fp = '';
        if (settings.base_profile.includes('survival')) {
            base_fp = './profiles/defaults/survival.json';
        } else if (settings.base_profile.includes('assistant')) {
            base_fp = './profiles/defaults/assistant.json';
        } else if (settings.base_profile.includes('creative')) {
            base_fp = './profiles/defaults/creative.json';
        } else if (settings.base_profile.includes('god_mode')) {
            base_fp = './profiles/defaults/god_mode.json';
        }
        let base_profile = JSON.parse(readFileSync(base_fp, 'utf8'));

        // first use defaults to fill in missing values in the base profile
        for (let key in default_profile) {
            if (base_profile[key] === undefined)
                base_profile[key] = default_profile[key];
        }
        // then use base profile to fill in missing values in the individual profile
        for (let key in base_profile) {
            if (this.profile[key] === undefined)
                this.profile[key] = base_profile[key];
        }
        // base overrides default, individual overrides base

        this.convo_examples = null;
        this.coding_examples = null;
        
        let name = this.profile.name;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.last_prompt_time = 0;
        this.awaiting_coding = false;

        // for backwards compatibility, move max_tokens to params
        let max_tokens = null;
        if (this.profile.max_tokens)
            max_tokens = this.profile.max_tokens;

        let chat_model_profile = selectAPI(this.profile.model);
        this.chat_model = createModel(chat_model_profile);

        if (this.profile.code_model) {
            let code_model_profile = selectAPI(this.profile.code_model);
            this.code_model = createModel(code_model_profile);
        }
        else {
            this.code_model = this.chat_model;
        }

        if (this.profile.vision_model) {
            let vision_model_profile = selectAPI(this.profile.vision_model);
            this.vision_model = createModel(vision_model_profile);
        }
        else {
            this.vision_model = this.chat_model;
        }

        
        let embedding_model_profile = null;
        if (this.profile.embedding) {
            try {
                embedding_model_profile = selectAPI(this.profile.embedding);
            } catch (e) {
                embedding_model_profile = null;
            }
        }
        // v0.1.4.8: an embedding model that cannot be created (for example a key that is missing) must
        // not stop the start of the bot. Without it the examples are chosen by word overlap.
        try {
            this.embedding_model = embedding_model_profile
                ? createModel(embedding_model_profile)
                : createModel({api: chat_model_profile.api});
        } catch (error) {
            console.warn('Could not create the embedding model, using word-overlap instead:', error?.message ?? error);
            this.embedding_model = null;
        }

        this.skill_libary = new SkillLibrary(agent, this.embedding_model);
        mkdirSync(`./bots/${name}`, { recursive: true });
        writeFileSync(`./bots/${name}/last_profile.json`, JSON.stringify(this.profile, null, 4), (err) => {
            if (err) {
                throw new Error('Failed to save profile:', err);
            }
            console.log("Copy profile saved.");
        });
    }

    getName() {
        return this.profile.name;
    }

    getInitModes() {
        return this.profile.modes;
    }

    async initExamples() {
        try {
            this.convo_examples = new Examples(this.embedding_model, settings.num_examples);
            this.coding_examples = new Examples(this.embedding_model, settings.num_examples);
            this.convo_examples.by_last_request = settings.examples_by_last_request === true;
            this.coding_examples.by_last_request = settings.examples_by_last_request === true;
            
            // examples that use a hidden command are left out (v0.1.4.6, R5): a blocked command or one that does not exist
            const isHidden = (name) => (this.agent?.blocked_actions ?? []).includes(name) || !getCommand(name);
            const visible = (examples) => visibleExamples(examples, isHidden);
            this.convo_examples.filter = visible;
            this.coding_examples.filter = visible;
            // Wait for both examples to load before proceeding
            await Promise.all([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples),
                this.skill_libary.initSkillLibrary()
            ]).catch(error => {
                // Preserve error details
                console.error('Failed to initialize examples. Error details:', error);
                console.error('Stack trace:', error.stack);
                throw error;
            });

            console.log('Examples initialized.');
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            console.error('Stack trace:', error.stack);
            throw error; // Re-throw with preserved details
        }
    }

    async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null) {
        prompt = prompt.replaceAll('$NAME', this.agent.name);

        if (prompt.includes('$STATS')) {
            let stats = await getCommand('!stats').perform(this.agent) + '\n';
            stats += await getCommand('!entities').perform(this.agent) + '\n';
            stats += await getCommand('!nearbyBlocks').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory').perform(this.agent);
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$ACTION')) {
            prompt = prompt.replaceAll('$ACTION', this.agent.actions.currentActionLabel);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs(this.agent));
        if (prompt.includes('$CODE_DOCS')) {
            const code_task_content = messages.slice().reverse().find(msg =>
                msg.role !== 'system' && msg.content.includes('!newAction(')
            )?.content?.match(/!newAction\((.*?)\)/)?.[1] || '';

            prompt = prompt.replaceAll(
                '$CODE_DOCS',
                await this.skill_libary.getRelevantSkillDocs(code_task_content, settings.relevant_docs_count)
            );
        }
        if (prompt.includes('$EXAMPLES') && examples !== null)
            prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));
        if (prompt.includes('$MEMORY'))
            prompt = prompt.replaceAll('$MEMORY', this.agent.history.memory);
        if (prompt.includes('$TO_SUMMARIZE'))
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        if (prompt.includes('$CONVO'))
            prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(messages));
        if (prompt.includes('$SELF_PROMPT')) {
            // if active or paused, show the current goal
            let self_prompt = !this.agent.self_prompter.isStopped() ? `YOUR CURRENT ASSIGNED GOAL: "${this.agent.self_prompter.prompt}"\n` : '';
            prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
        }
        if (prompt.includes('$LAST_GOALS')) {
            let goal_text = '';
            for (let goal in last_goals) {
                if (last_goals[goal])
                    goal_text += `You recently successfully completed the goal ${goal}.\n`
                else
                    goal_text += `You recently failed to complete the goal ${goal}.\n`
            }
            prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
        }
        if (prompt.includes('$BLUEPRINTS')) {
            if (this.agent.npc.constructions) {
                let blueprints = '';
                for (let blueprint in this.agent.npc.constructions) {
                    blueprints += blueprint + ', ';
                }
                prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
            }
        }
        // v0.1.4.8 (C1): what the bot knows, with knowledge_in_prompt, else nothing. Last, and without
        // replacement patterns, so a name in the block is never read as a placeholder.
        if (prompt.includes('$KNOWLEDGE'))
            prompt = prompt.split('$KNOWLEDGE').join(knowledgeOf(this.agent));

        // check if there are any remaining placeholders with syntax $<word>, except $CUSTOM_SKILLS which the caller fills
        let remaining = prompt.match(/\$(?!CUSTOM_SKILLS(?![A-Z_]))[A-Z_]+/g);
        if (remaining !== null) {
            console.warn('Unknown prompt placeholders:', remaining.join(', '));
        }
        return prompt;
    }

    async checkCooldown() {
        let elapsed = Date.now() - this.last_prompt_time;
        if (elapsed < this.cooldown && this.cooldown > 0) {
            await new Promise(r => setTimeout(r, this.cooldown - elapsed));
        }
        this.last_prompt_time = Date.now();
    }

    async promptConvo(messages) {
        this.most_recent_msg_time = Date.now();
        let current_msg_time = this.most_recent_msg_time;

        for (let i = 0; i < 3; i++) { // try 3 times to avoid hallucinations
            await this.checkCooldown();
            if (current_msg_time !== this.most_recent_msg_time) {
                return '';
            }

            let prompt = this.profile.conversing;
            // v0.1.4.8: a profile without $KNOWLEDGE (the profile of the owner) gets the block like the rules
            const knowledge_placeholder = typeof prompt === 'string' && prompt.includes('$KNOWLEDGE');
            prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
            if (this.agent?.skill_manager) {
                try {
                    prompt = insertSection(prompt, this.agent.skill_manager.conversingSection());
                } catch (error) {
                    console.warn('Could not add the saved skills to the conversation prompt:', error);
                    prompt = insertSection(prompt, '');
                }
            } else if (typeof prompt === 'string' && prompt.includes('$CUSTOM_SKILLS')) {
                prompt = insertSection(prompt, ''); // no manager: only the placeholder is removed
            }
            prompt = withRules(this.agent, prompt);
            if (!knowledge_placeholder && settings.knowledge_in_prompt)
                prompt = insertSection(prompt, knowledgeOf(this.agent)); // '' leaves the prompt as it is
            let generation;

            try {
                generation = await withPurposeOf(this.agent, 'chat', () => this.chat_model.sendRequest(messages, prompt));
                if (typeof generation !== 'string') {
                    console.error('Error: Generated response is not a string', generation);
                    throw new Error('Generated response is not a string');
                }
                console.log("Generated response:", generation);
                await this._saveLog(prompt, messages, generation, 'conversation');

            } catch (error) {
                console.error('Error during message generation or file writing:', error);
                continue;
            }

            // Check for hallucination or invalid output
            if (generation?.includes('(FROM OTHER BOT)')) {
                console.warn('LLM hallucinated message as another bot. Trying again...');
                continue;
            }

            if (current_msg_time !== this.most_recent_msg_time) {
                console.warn(`${this.agent.name} received new message while generating, discarding old response.`);
                return '';
            }

            if (generation?.includes('</think>')) {
                const [_, afterThink] = generation.split('</think>')
                generation = afterThink
            }

            return generation;
        }

        return '';
    }

    async promptCoding(messages) {
        if (this.awaiting_coding) {
            console.warn('Already awaiting coding response, returning no response.');
            return '```//no response```';
        }
        this.awaiting_coding = true;
        try {
            await this.checkCooldown();
            let prompt = this.profile.coding;
            prompt = await this.replaceStrings(prompt, messages, this.coding_examples);
            if (this.agent?.skill_manager) {
                try {
                    prompt = insertSection(prompt, this.agent.skill_manager.codingSection(extractTask(messages)));
                } catch (error) {
                    console.warn('Could not add the saved skills to the coding prompt:', error);
                    prompt = insertSection(prompt, '');
                }
            } else if (typeof prompt === 'string' && prompt.includes('$CUSTOM_SKILLS')) {
                prompt = insertSection(prompt, ''); // no manager: only the placeholder is removed
            }
            prompt = withRules(this.agent, prompt);

            let resp = await withPurposeOf(this.agent, 'coding', () => this.code_model.sendRequest(messages, prompt));
            await this._saveLog(prompt, messages, resp, 'coding');
            return resp;
        } finally {
            this.awaiting_coding = false;
        }
    }

    async promptMemSaving(to_summarize) {
        await this.checkCooldown();
        let prompt = this.profile.saving_memory;
        prompt = await this.replaceStrings(prompt, null, null, to_summarize);
        let resp = await withPurposeOf(this.agent, 'memory', () => this.chat_model.sendRequest([], prompt));
        await this._saveLog(prompt, to_summarize, resp, 'memSaving');
        if (resp?.includes('</think>')) {
            const [_, afterThink] = resp.split('</think>')
            resp = afterThink;
        }
        return resp;
    }

    async promptSkillReview(text) {
        await this.checkCooldown();
        let resp = await withPurposeOf(this.agent, 'skill_review', () => this.code_model.sendRequest([], text));
        await this._saveLog(text, [], resp, 'skillReview');
        if (resp?.includes('</think>')) {
            const [_, afterThink] = resp.split('</think>');
            resp = afterThink;
        }
        return resp;
    }

    // v0.1.4.10 (I4): one call of the chat model for the steps of a job (planPrompt of src/agent/job), counted
    // under the purpose 'plan' of the cost meter. Returns the answer, '' for none.
    async promptPlan(prompt) {
        await this.checkCooldown();
        let resp = await withPurposeOf(this.agent, 'plan', () => this.chat_model.sendRequest([], prompt));
        await this._saveLog(prompt, [], resp, 'plan');
        if (resp?.includes('</think>')) {
            const [_, afterThink] = resp.split('</think>');
            resp = afterThink;
        }
        return typeof resp === 'string' ? resp : '';
    }

    async promptShouldRespondToBot(new_message) {
        await this.checkCooldown();
        let prompt = this.profile.bot_responder;
        let messages = this.agent.history.getHistory();
        messages.push({role: 'user', content: new_message});
        prompt = await this.replaceStrings(prompt, null, null, messages);
        let res = await withPurposeOf(this.agent, 'bot_responder', () => this.chat_model.sendRequest([], prompt));
        return res.trim().toLowerCase() === 'respond';
    }

    async promptVision(messages, imageBuffer) {
        await this.checkCooldown();
        let prompt = this.profile.image_analysis;
        prompt = await this.replaceStrings(prompt, messages, null, null, null);
        return await withPurposeOf(this.agent, 'vision', () => this.vision_model.sendVisionRequest(messages, prompt, imageBuffer));
    }

    async promptGoalSetting(messages, last_goals) {
        // deprecated
        let system_message = this.profile.goal_setting;
        system_message = await this.replaceStrings(system_message, messages);

        let user_message = 'Use the below info to determine what goal to target next\n\n';
        user_message += '$LAST_GOALS\n$STATS\n$INVENTORY\n$CONVO'
        user_message = await this.replaceStrings(user_message, messages, null, null, last_goals);
        let user_messages = [{role: 'user', content: user_message}];

        let res = await withPurposeOf(this.agent, 'goal_setting', () => this.chat_model.sendRequest(user_messages, system_message));

        let goal = null;
        try {
            let data = res.split('```')[1].replace('json', '').trim();
            goal = JSON.parse(data);
        } catch (err) {
            console.log('Failed to parse goal:', res, err);
        }
        if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
            console.log('Failed to set goal:', res);
            return null;
        }
        goal.quantity = parseInt(goal.quantity);
        return goal;
    }

    async _saveLog(prompt, messages, generation, tag) {
        if (!settings.log_all_prompts)
            return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let logEntry;
        let task_id = this.agent.task.task_id;
        if (task_id == null) {
            logEntry = `[${timestamp}] \nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        } else {
            logEntry = `[${timestamp}] Task ID: ${task_id}\nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        }
        const logFile = `${tag}_${timestamp}.txt`;
        await this._saveToFile(logFile, logEntry);
    }

    async _saveToFile(logFile, logEntry) {
        let task_id = this.agent.task.task_id;
        let logDir;
        if (task_id == null) {
            logDir = path.join(__dirname, `../../bots/${this.agent.name}/logs`);
        } else {
            logDir = path.join(__dirname, `../../bots/${this.agent.name}/logs/${task_id}`);
        }

        await fs.mkdir(logDir, { recursive: true });

        logFile = path.join(logDir, logFile);
        await fs.appendFile(logFile, String(logEntry), 'utf-8');
    }
}
