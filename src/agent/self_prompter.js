const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2

// v0.1.4.16 (V-13; review 16b, finding 5): who set a goal: the given name ('model' for the model's own), else a player
function goalSetter(by) {
    return typeof by === 'string' && by !== '' ? by : 'player';
}

export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this.prompt = '';
        this.idle_time = 0;
        this.cooldown = 2000;
    }

    // by (v0.1.4.16, V-13; review 16b, finding 5): who set the goal, from the chain of the !goal command (goalSetter); a resume
    // (no prompt) keeps who set it; a goal loaded after a restart (no by) counts as a player's
    start(prompt, by = undefined) {
        console.log('Self-prompting started.');
        const fresh = Boolean(prompt);
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.state = ACTIVE;
        this.prompt = prompt;
        // its self prompts carry that order (agent.js: a player's goal may start work commands)
        this.started_by = fresh ? goalSetter(by) : (this.started_by ?? 'player');
        this.startLoop();
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        if (state == undefined)
            state = STOPPED;
        this.state = state;
        this.prompt = prompt;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (state === ACTIVE) {
            await this.start(prompt);
        }
    }

    setPromptPaused(prompt, by = undefined) {
        this.prompt = prompt;
        this.state = PAUSED;
        this.started_by = goalSetter(by); // review 16b, finding 5: the resume after the conversation keeps it
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        let no_command_count = 0;
        const MAX_NO_COMMAND = 3;
        while (!this.interrupt) {
            if (!this._costAllows())
                break; // the cost limit is reached: update() starts the loop again when the cost is below it
            const msg = `You are self-prompting with the goal: '${this.prompt}'. Your next response MUST contain a command with this syntax: !commandName. Respond:`;
            
            let used_command = await this.agent.handleMessage('system', msg, -1);
            if (!used_command) {
                no_command_count++;
                if (no_command_count >= MAX_NO_COMMAND) {
                    let out = `Agent did not use command in the last ${MAX_NO_COMMAND} auto-prompts. Stopping auto-prompting.`;
                    this.agent.openChat(out);
                    console.warn(out);
                    this.state = STOPPED;
                    break;
                }
            }
            else {
                no_command_count = 0;
                await new Promise(r => setTimeout(r, this.cooldown));
            }
        }
        console.log('self prompt loop stopped')
        this.loop_active = false;
        this.interrupt = false;
    }

    _costAllows() {
        // false only while the cost meter is in the state saving (v0.1.4.6, G1). Never throws.
        const meter = this.agent.cost_meter;
        if (!meter)
            return true;
        try {
            return meter.allows('self_prompt') !== false;
        } catch (error) {
            console.warn('Could not ask the cost meter:', error);
            return true;
        }
    }

    update(delta) {
        if (this.loop_active && !this._costAllows()) {
            this.stopLoop(); // the cost limit is reached
            return;
        }
        // automatically restarts loop
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt && this._costAllows()) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop();
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (this.interrupt)
            return;
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        while (this.loop_active) {
            await new Promise(r => setTimeout(r, 500));
        }
        this.interrupt = false;
    }

    async stop(stop_action=true) {
        this.interrupt = true;
        if (stop_action)
            await this.agent.actions.stop();
        this.stopLoop();
        this.state = STOPPED;
    }

    async pause() {
        this.interrupt = true;
        await this.agent.actions.stop();
        this.stopLoop();
        this.state = PAUSED;
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && (this.state === ACTIVE || this.state === PAUSED) && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}