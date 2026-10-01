import assert from 'node:assert';
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
        // v0.1.4.8, X3: two actions that wait for the same running one must not both start. Every request to
        // start an action and every stop from outside takes the next ticket; an action that waited starts
        // only when its ticket is still the newest one, else the newer request (start_by) replaced it.
        this.start_ticket = 0;
        this.start_by = null;
        this.action_serial = 0; // v0.1.4.8, X3: counts the actions that really started; unstuck starts its time again
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
    // v0.1.4.8, X3: a stop from outside (!stop, the time limit, the death of the bot) also drops an action
    // that waits to start.
    async stop(by = null) {
        this._takeTicket(by);
        await this._stopRunning(by, null);
    }

    // v0.1.4.8, X3: the next ticket, for a request to start an action or a stop from outside.
    _takeTicket(by) {
        this.start_ticket++;
        this.start_by = typeof by === 'string' && by !== '' ? by : null;
        return this.start_ticket;
    }

    // Interrupts the running action until it ended. With a ticket (an action that waits to start) it stops
    // waiting as soon as a newer ticket was taken: the newer request interrupts on its own.
    async _stopRunning(by, ticket) {
        if (!this.executing) return;
        this.noteStop(by);
        const timeout = setTimeout(() => {
            this.agent.cleanKill('Code execution refused stop after 10 seconds. Killing process.');
        }, 10000);
        // F36 of the journeys (the hand-over): the next action started up to 300 ms after the stopped one ended, and
        // a bot stopped on a ladder slid in the gap. The end of the action is polled every 50 ms; the interrupt is
        // asked again every 300 ms as before.
        let asked = 0;
        while (this.executing && (ticket === null || ticket === this.start_ticket)) {
            if (Date.now() - asked >= 300) {
                this.agent.requestInterrupt(by);
                console.log('waiting for code to finish executing...');
                asked = Date.now();
            }
            await new Promise(resolve => setTimeout(resolve, 50));
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
            if (!this.executing) // v0.1.4.8, X3: a newer action that replaced this one keeps its label
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
            const ticket = this._takeTicket(actionLabel); // v0.1.4.8, X3

            // await current action to finish (executing=false), with 10 seconds timeout
            // also tell agent.bot to stop various actions
            if (this.executing) {
                console.log(`action "${actionLabel}" trying to interrupt current action "${this.currentActionLabel}"`);
            }
            await this._stopRunning(actionLabel, ticket);

            // v0.1.4.8, X3: a newer action (or a stop) came while this one waited for the one before: this one
            // does not start, and it does not stop the newer one. So a reflex that decided to act a moment
            // before the player typed a command no longer stops that command 0.2 s after its start.
            if (ticket !== this.start_ticket) {
                console.log(`action "${actionLabel}" does not start: ${this.start_by ?? 'a stop'} came after it`);
                return this._result(false, '', true, false, this.start_by);
            }

            // clear bot logs and reset interrupt code
            this.agent.clearBotLogs();

            this.executing = true;
            this.currentActionLabel = actionLabel;
            this.currentActionFn = actionFn;
            this.timedout = false; // a timeout of an earlier action does not count for this one
            this.stopped_by = null; // nobody stopped this one yet
            this.action_serial++; // v0.1.4.8, X3: a new action; the mode unstuck starts its time again

            // timeout in minutes
            if (timeout > 0) {
                TIMEOUT = this._startTimeout(timeout);
            }

            // v0.1.4.8, X5: a command that is not !goToBed gets the bot out of bed first (the agent decides)
            await this._wakeFor(actionLabel);

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
            await this._stopRunning(null, null); // v0.1.4.8, X3: not a stop from outside, a waiting action may start
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

    // v0.1.4.8, X5: agent.wakeForAction(label) gets a sleeping bot out of bed before a command. Never throws.
    async _wakeFor(actionLabel) {
        if (typeof this.agent?.wakeForAction !== 'function')
            return;
        try {
            await this.agent.wakeForAction(actionLabel);
        } catch (error) {
            console.warn('Could not get out of bed before the action:', error?.message ?? error);
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