import { MAX_OUT, outputSummary, stopperText } from './reflex/output_logic.js';

// v0.1.4.8, I5: who stopped an action when nobody said it (for example the death of the bot)
const UNKNOWN_STOPPER = 'an interrupt';

export class ActionManager {
    constructor(agent) {
        this.agent = agent;
        this.executing = false;
        this.currentActionLabel = '';
        this.currentActionFn = null;
        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';
        this.last_action_time = 0;
        this.recent_action_counter = 0;
        this.stopped_by = null; // v0.1.4.8, A4: who stops the running action, the first one counts
        this.command_serial = 0; // v0.1.4.8, A2: counts the commands (actions action:*) that started
    }

    async resumeAction(actionFn, timeout) {
        return this._executeResume(actionFn, timeout);
    }

    async runAction(actionLabel, actionFn, { timeout, resume = false } = {}) {
        if (typeof actionLabel === 'string' && actionLabel.startsWith('action:')) {
            this.command_serial++;
            // v0.1.4.8, A5: a newer command ends the resume function of an older one; a mode does not
            if (!resume)
                this.cancelResume();
        }
        if (resume) {
            return this._executeResume(actionLabel, actionFn, timeout);
        } else {
            return this._executeAction(actionLabel, actionFn, timeout);
        }
    }

    // by: who stops, the label of the new action ('mode:unstuck', 'action:mineOre') or a text of the
    // agent ('!stop', 'a new message'). Only the first one counts for the running action.
    async stop(by = null) {
        if (!this.executing) return;
        this.noteStop(by);
        const timeout = setTimeout(() => {
            this.agent.cleanKill('Code execution refused stop after 10 seconds. Killing process.');
        }, 10000);
        while (this.executing) {
            this.agent.requestInterrupt(by);
            console.log('waiting for code to finish executing...');
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        clearTimeout(timeout);
    }

    // v0.1.4.8, A4: notes who stops the running action, for a stop that does not go through stop().
    noteStop(by) {
        if (this.executing && this.stopped_by === null && typeof by === 'string' && by !== '')
            this.stopped_by = by;
    }

    cancelResume() {
        this.resume_func = null;
        this.resume_name = null;
    }

    async _executeResume(actionLabel = null, actionFn = null, timeout = 10) {
        const new_resume = actionFn != null;
        if (new_resume) { // start new resume
            this.resume_func = actionFn;
            assert(actionLabel != null, 'actionLabel is required for new resume');
            this.resume_name = actionLabel;
        }
        if (this.resume_func != null && (this.agent.isIdle() || new_resume) && (!this.agent.self_prompter.isActive() || new_resume)) {
            this.currentActionLabel = this.resume_name;
            let res = await this._executeAction(this.resume_name, this.resume_func, timeout);
            this.currentActionLabel = '';
            return res;
        } else {
            return { success: false, message: null, interrupted: false, timedout: false };
        }
    }

    // The result of an action; when it was interrupted also who stopped it (I5).
    _result(success, message, interrupted, timedout, stopped_by) {
        const result = { success, message, interrupted, timedout };
        if (interrupted)
            result.stopped_by = stopperText(stopped_by) ?? UNKNOWN_STOPPER;
        return result;
    }

    async _executeAction(actionLabel, actionFn, timeout = 10) {
        let TIMEOUT;
        try {
            if (this.last_action_time > 0) {
                let time_diff = Date.now() - this.last_action_time;
                if (time_diff < 20) {
                    this.recent_action_counter++;
                }
                else {
                    this.recent_action_counter = 0;
                }
                if (this.recent_action_counter > 3) {
                    console.warn('Fast action loop detected, cancelling resume.');
                    this.cancelResume(); // likely cause of repetition
                }
                if (this.recent_action_counter > 5) {
                    console.error('Infinite action loop detected, shutting down.');
                    this.agent.cleanKill('Infinite action loop detected, shutting down.');
                    return { success: false, message: 'Infinite action loop detected, shutting down.', interrupted: false, timedout: false };
                }
            }
            this.last_action_time = Date.now();
            console.log('executing code...\n');

            // await current action to finish (executing=false), with 10 seconds timeout
            // also tell agent.bot to stop various actions
            if (this.executing) {
                console.log(`action "${actionLabel}" trying to interrupt current action "${this.currentActionLabel}"`);
            }
            await this.stop(actionLabel);

            // clear bot logs and reset interrupt code
            this.agent.clearBotLogs();

            this.executing = true;
            this.currentActionLabel = actionLabel;
            this.currentActionFn = actionFn;
            this.timedout = false; // a timeout of an earlier action does not count for this one
            this.stopped_by = null; // nobody stopped this one yet

            // timeout in minutes
            if (timeout > 0) {
                TIMEOUT = this._startTimeout(timeout);
            }

            // start the action
            await actionFn();

            // mark action as finished + cleanup
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionFn = null;
            clearTimeout(TIMEOUT);

            // get bot activity summary
            let output = this.getBotOutputSummary();
            let interrupted = this.agent.bot.interrupt_code;
            let timedout = this.timedout;
            let stopped_by = this.stopped_by;
            this.agent.clearBotLogs();

            // if not interrupted and not generating, emit idle event
            if (!interrupted) {
                this.agent.bot.emit('idle');
            }

            // return action status report
            return this._result(true, output, interrupted, timedout, stopped_by);
        } catch (err) {
            this.executing = false;
            this.currentActionLabel = '';
            this.currentActionFn = null;
            clearTimeout(TIMEOUT);
            this.cancelResume();
            let stopped_by = this.stopped_by;
            console.error("Code execution triggered catch:", err);
            // Log the full stack trace
            console.error(err.stack);
            await this.stop();
            err = err.toString();

            let message = this.getBotOutputSummary() +
                '!!Code threw exception!!\n' +
                'Error: ' + err + '\n' +
                'Stack trace:\n' + err.stack+'\n';

            let interrupted = this.agent.bot.interrupt_code;
            this.agent.clearBotLogs();
            if (!interrupted) {
                this.agent.bot.emit('idle');
            }
            return this._result(false, message, interrupted, false, stopped_by);
        }
    }

    // v0.1.4.8, A4: also the output of an interrupted action (the output so far). Longer than MAX_OUT
    // characters: whole lines from the start and from the end.
    getBotOutputSummary() {
        const { bot } = this.agent;
        let output = outputSummary(bot.output, MAX_OUT);
        bot.output = '';
        return output;
    }

    _startTimeout(TIMEOUT_MINS = 10) {
        return setTimeout(async () => {
            console.warn(`Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            this.timedout = true;
            this.agent.history.add('system', `Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            await this.stop('the time limit'); // last attempt to stop
        }, TIMEOUT_MINS * 60 * 1000);
    }

}