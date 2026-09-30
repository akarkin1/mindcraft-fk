// A bot in bed and the actions that run (v0.1.4.8, X5). Pure: labels of the action manager ('action:<name>'
// for a command, 'mode:<name>' for a reflex, '' while nothing runs).

export const WAKE_RULES = Object.freeze({
    waitMs: 3000,   // the longest wait until the bot is out of bed
    pollMs: 100,
});

// The actions during which the bot sleeps on purpose.
const SLEEP_ACTIONS = new Set(['action:goToBed', 'mode:night_shelter']);

/**
 * True when the bot must get out of bed before the action starts: it sleeps, and the action is a command
 * other than !goToBed. The actions of the reflexes do not wake it (the night reflex sleeps itself; a hurt
 * player wakes up anyway), and queries run no action at all.
 * @param {string} label the label of the action that starts
 * @param {boolean} sleeping bot.isSleeping
 * @returns {boolean}
 */
export function shouldWakeFor(label, sleeping) {
    return sleeping === true && typeof label === 'string' && label.startsWith('action:') && label !== 'action:goToBed';
}

/**
 * True when sleeping counts as progress for the mode unstuck: while no action runs, while !goToBed runs,
 * and while the night reflex (it sleeps as !goToBed does) runs. A command that runs while the bot still
 * lies in bed is stuck, not asleep.
 * @param {string|null|undefined} label the label of the running action, '' or null for none
 * @returns {boolean}
 */
export function sleepIsProgress(label) {
    if (label === null || label === undefined || label === '')
        return true;
    return typeof label === 'string' && SLEEP_ACTIONS.has(label);
}
