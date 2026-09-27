// Minimal stand-in for the Agent object that History uses.
export const SELF_PROMPT_ACTIVE = 1;

export function makeFakeAgent(name, overrides = {}) {
    const agent = {
        name,
        prompter: {
            calls: [],
            // Default: a successful summary.
            async promptMemSaving(turns) {
                this.calls.push(JSON.parse(JSON.stringify(turns)));
                return 'summary of the conversation';
            },
        },
        self_prompter: {
            state: SELF_PROMPT_ACTIVE,
            prompt: 'build a small house',
            stopped: false,
            isStopped() {
                return this.stopped;
            },
        },
        task: { taskStartTime: 1_700_000_000_000 },
        last_sender: 'steve',
    };
    return Object.assign(agent, overrides);
}

// Replaces promptMemSaving with a function that records the turns and delegates to impl.
export function setMemSaving(agent, impl) {
    agent.prompter.calls = [];
    agent.prompter.promptMemSaving = async function (turns) {
        this.calls.push(JSON.parse(JSON.stringify(turns)));
        return impl(turns, this.calls.length);
    };
}
