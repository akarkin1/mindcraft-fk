// The output of an action as the model gets it, and who stopped an action (spec v0.1.4.8, A4 and I5).
// Pure: no imports.

export const MAX_OUT = 1500; // longer output is shortened to whole lines from the start and the end

/**
 * Who stopped an action, as a text: 'mode:<name>' becomes 'the reflex <name>', 'action:<name>' becomes
 * 'the command !<name>'; any other text ('!stop', 'a new message') stays as it is; null for nothing.
 * @param {string|null} by the label of the new action, or the text of the agent
 * @returns {string|null}
 */
export function stopperText(by) {
    if (typeof by !== 'string' || by === '')
        return null;
    if (by.startsWith('mode:'))
        return `the reflex ${by.slice('mode:'.length)}`;
    if (by.startsWith('action:'))
        return `the command !${by.slice('action:'.length)}`;
    return by;
}

/**
 * The summary of an action output. Up to max characters: 'Action output:\n' and the output, also when it is
 * one long line (the chest view). Longer: whole lines from the start (up to half of max) and whole lines
 * from the end (up to the rest of max); a line is never cut. Only when not one whole line fits (a single
 * line longer than max), the output is cut at max characters.
 * @param {string} output bot.output
 * @param {number} [max]
 * @returns {string}
 */
export function outputSummary(output, max = MAX_OUT) {
    const text = output === null || output === undefined ? '' : String(output);
    if (text.length <= max)
        return 'Action output:\n' + text;
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '')
        lines.pop(); // the line break at the end of the last line
    const head = [];
    let used = 0;
    for (const line of lines) {
        if (used + line.length + 1 > max / 2)
            break;
        head.push(line);
        used += line.length + 1;
    }
    const tail = [];
    for (let i = lines.length - 1; i >= head.length; i--) {
        if (used + lines[i].length + 1 > max)
            break;
        tail.unshift(lines[i]);
        used += lines[i].length + 1;
    }
    const intro = `Action output is very long (${text.length} chars) and has been shortened.\n`;
    if (head.length === 0 && tail.length === 0)
        return intro + `First outputs:\n${text.substring(0, max)}\n...the rest is cut.`;
    return intro + `First outputs:\n${head.join('\n')}\n...skipping many lines.\nFinal outputs:\n${tail.join('\n')}`;
}
