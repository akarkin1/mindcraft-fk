import { io } from 'socket.io-client';
import convoManager from './conversation.js';
import { setSettings } from './settings.js';
import { getFullState } from './library/full_state.js';

// agent's individual connection to the mindserver
// always connect to localhost

// v0.1.4.14 (P-22, spec 8.8): the lines of the page kept until the agent can answer
export const PENDING_MAX = 20;
export const PENDING_POLL_MS = 200;
export const NOT_READY_TEXT = 'The bot is not ready yet; your line is kept.';

/**
 * Keeps a line of the page: pending holds at most max lines, the oldest dropped. Pure.
 * @param {Array<{from: string, message: string}>} pending
 * @param {{from: string, message: string}} line
 * @param {number} [max]
 * @returns {Array<{from: string, message: string}>} pending
 */
export function keepLine(pending, line, max = PENDING_MAX) {
    pending.push(line);
    while (pending.length > max)
        pending.shift();
    return pending;
}

class MindServerProxy {
    constructor() {
        if (MindServerProxy.instance) {
            return MindServerProxy.instance;
        }
        
        this.socket = null;
        this.connected = false;
        this.agents = [];
        this.pending = []; // v0.1.4.14 (P-22): the lines of the page kept until the agent can answer
        this.pendingTimer = null;
        MindServerProxy.instance = this;
    }

    async connect(name, port) {
        if (this.connected) return;
        
        this.name = name;
        this.socket = io(`http://localhost:${port}`);

        await new Promise((resolve, reject) => {
            this.socket.on('connect', resolve);
            this.socket.on('connect_error', (err) => {
                console.error('Connection failed:', err);
                reject(err);
            });
        });

        this.connected = true;
        console.log(name, 'connected to MindServer');

        this.socket.on('disconnect', () => {
            console.log('Disconnected from MindServer');
            this.connected = false;
            if (this.agent) {
                this.agent.cleanKill('Disconnected from MindServer. Killing agent process.');
            }
        });

        this.socket.on('chat-message', (agentName, json) => {
            convoManager.receiveFromBot(agentName, json);
        });

        this.socket.on('agents-status', (agents) => {
            this.agents = agents;
            convoManager.updateAgents(agents);
            if (this.agent?.task) {
                console.log(this.agent.name, 'updating available agents');
                this.agent.task.updateAvailableAgents(agents);
            }
        });

        this.socket.on('restart-agent', (agentName) => {
            console.log(`Restarting agent: ${agentName}`);
            this.agent.cleanKill();
        });
		
        this.socket.on('send-message', (data) => {
            try {
                // v0.1.4.14 (P-22): kept until the agent set respondFunc, never a TypeError
                this.deliverOrKeep(data);
            } catch (error) {
                console.error('Error: ', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            }
        });

        this.socket.on('get-full-state', (callback) => {
            try {
                const state = getFullState(this.agent);
                callback(state);
            } catch (error) {
                console.error('Error getting full state:', error);
                callback(null);
            }
        });

        // Request settings and wait for response
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Settings request timed out after 5 seconds'));
            }, 5000);

            this.socket.emit('get-settings', name, (response) => {
                clearTimeout(timeout);
                if (response.error) {
                    return reject(new Error(response.error));
                }
                setSettings(response.settings);
                this.socket.emit('connect-agent-process', name);
                resolve();
            });
        });
    }

    setAgent(agent) {
        this.agent = agent;
    }

    // v0.1.4.14 (P-22, spec 8.8): a send-message from the page before the agent set respondFunc (right after a reconnect
    // with the page's Connect button, before Agent.start reached it) was a TypeError and the line was lost. The line is
    // kept (up to PENDING_MAX, the oldest dropped) and delivered in order as soon as respondFunc exists; the page gets
    // NOT_READY_TEXT down bot-output for every kept line.

    /** True when the agent can take a line of the page. */
    get ready() {
        return typeof this.agent?.respondFunc === 'function';
    }

    /**
     * Hands a line of the page to the agent, or keeps it until the agent is ready.
     * @param {{from: string, message: string}} data
     * @returns {boolean} true when the line was delivered now
     */
    deliverOrKeep(data) {
        if (this.ready) {
            this.agent.respondFunc(data.from, data.message);
            return true;
        }
        keepLine(this.pending, { from: data?.from, message: data?.message });
        try {
            this.socket?.emit('bot-output', this.name, NOT_READY_TEXT);
        } catch (error) {
            console.error('Could not answer the page:', error?.message ?? error);
        }
        this.watchPending();
        return false;
    }

    /** Looks every PENDING_POLL_MS for the agent's respondFunc while lines are kept; the timer holds nothing open. */
    watchPending() {
        if (this.pendingTimer)
            return;
        this.pendingTimer = setInterval(() => {
            if (this.ready || this.pending.length === 0)
                this.deliverPending();
        }, PENDING_POLL_MS);
        this.pendingTimer.unref?.();
    }

    /**
     * Delivers the kept lines in order when the agent is ready and stops the watch.
     * @returns {number} the lines delivered
     */
    deliverPending() {
        if (this.pendingTimer) {
            clearInterval(this.pendingTimer);
            this.pendingTimer = null;
        }
        if (!this.ready)
            return 0;
        const lines = this.pending.splice(0);
        for (const line of lines) {
            try {
                this.agent.respondFunc(line.from, line.message);
            } catch (error) {
                console.error('Error: ', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            }
        }
        return lines.length;
    }

    getAgents() {
        return this.agents;
    }

    getNumOtherAgents() {
        return this.agents.length - 1;
    }

    login() {
        this.socket.emit('login-agent', this.agent.name);
    }

    shutdown() {
        this.socket.emit('shutdown');
    }

    getSocket() {
        return this.socket;
    }
}

// Create and export a singleton instance
export const serverProxy = new MindServerProxy();

// for chatting with other bots
export function sendBotChatToServer(agentName, json) {
    serverProxy.getSocket().emit('chat-message', agentName, json);
}

// for sending general output to server for display
export function sendOutputToServer(agentName, message) {
    serverProxy.getSocket().emit('bot-output', agentName, message);
}
