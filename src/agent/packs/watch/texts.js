// The texts of the watching pack (v0.1.4.12, part B, SPEC 4.4), word for word. Pure: no imports, no side effects.
//
// A direction is one of 'east', 'west', 'south', 'north' (+x, -x, +z, -z). A cell is { x, y, z } with whole numbers.

/** The words of the directions: eastwards (+x), westwards (-x), southwards (+z), northwards (-z). */
export const DIR_WORDS = Object.freeze({ east: 'eastwards', west: 'westwards', south: 'southwards', north: 'northwards' });

const P = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const dirWord = (dir) => DIR_WORDS[dir] ?? String(dir);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "30 oak_fence and 1 oak_fence_gate": the parts that are not 0; "0 oak_fence" when both are 0
function materialsText(moreFence, moreGate, name, gateName) {
    const parts = [];
    if (moreFence > 0)
        parts.push(`${moreFence} ${name}`);
    if (moreGate > 0)
        parts.push(`${moreGate} ${gateName}`);
    return parts.length > 0 ? parts.join(' and ') : `0 ${name}`;
}

// The refusals of a build: at most 3 sentences, then ", and N more." in place of the last full stop
function refusalsText(sentences, max = 3) {
    if (!Array.isArray(sentences) || sentences.length === 0)
        return '';
    const shown = sentences.slice(0, max);
    const rest = sentences.length - shown.length;
    let text = shown.join(' ');
    if (rest > 0)
        text = text.replace(/\.$/, '') + `, and ${rest} more.`;
    return text;
}

export const TEXTS = Object.freeze({
    /** `I watched you: 4 blocks placed, 0 broken.` */
    watched: (placed, broken) => `I watched you: ${plural(placed, 'block')} placed, ${broken} broken.`,
    understood: Object.freeze({
        /** `I understood: a line of oak_planks 12 long from (x, y, z) eastwards; 7 oak_planks more, I carry 20.` */
        line: (name, length, from, dir, more, have) =>
            `I understood: a line of ${name} ${length} long from ${P(from)} ${dirWord(dir)}; ${more} ${name} more, I carry ${have}.`,
        /** `I understood: a fence 7 x 10 from (x, y, z) eastwards, the gate in the middle of the south side; 30 oak_fence and 1
         * oak_fence_gate more, I carry 12 oak_fence.` name and gateName: the blocks (oak_fence, oak_fence_gate). */
        fence: (a, b, from, dir, gateWhere, moreFence, moreGate, have, name = 'oak_fence', gateName = `${name}_gate`) =>
            `I understood: a fence ${a} x ${b} from ${P(from)} ${dirWord(dir)}, ${gateWhere}; ${materialsText(moreFence, moreGate, name, gateName)} more, I carry ${have} ${name}.`,
        /** `I understood: a tunnel 12 long from (x, y, z) westwards, 2 high; 9 blocks more to dig.` */
        tunnel: (length, from, dir, more) =>
            `I understood: a tunnel ${length} long from ${P(from)} ${dirWord(dir)}, 2 high; ${more} blocks more to dig.`,
    }),
    sayYesBuild: ' Say yes to build it.',
    sayYesDig: ' Say yes to dig it.',
    gatePlaced: 'the gate where you placed it',
    /** `the gate in the middle of the south side` */
    gateMiddle: (side) => `the gate in the middle of the ${side} side`,
    /** `I see no pattern in what you did: 3 blocks that lie on no line.` / `... : 1 block.` / `... : a fence needs a size, say "7 by 10".` */
    noPattern: (n, why) => {
        const head = 'I see no pattern in what you did: ';
        if (why === 'no_size')
            return head + 'a fence needs a size, say "7 by 10".';
        if (why === 'no_line')
            return head + `${plural(n, 'block')} that lie on no line.`;
        return head + `${plural(n, 'block')}.`;
    },
    nothingWatched: 'I have watched nothing yet. Say "watch me" first.',
    nothingToBuild: 'I have no plan. Say "continue like this" first.',
    built: Object.freeze({
        /** `I built the line: 7 oak_planks.` */
        line: (n, name) => `I built the line: ${n} ${name}.`,
        /** `I built the fence: 30 oak_fence and 1 gate. Say "this is the pen" to save it.` */
        fence: (fences, gates, name = 'oak_fence') =>
            `I built the fence: ${fences} ${name}${gates > 0 ? ` and ${plural(gates, 'gate')}` : ''}. Say "this is the pen" to save it.`,
        /** `I dug the tunnel: 9 blocks.` */
        tunnel: (n) => `I dug the tunnel: ${n} blocks.`,
    }),
    /** `I have 12 oak_fence and need 30. I fetch the rest from the chest.` */
    short: (name, need, have) => `I have ${have} ${name} and need ${need}. I fetch the rest from the chest.`,
    /** `I have 12 oak_fence and need 30. I found no more in the chests; I built 12 of 30.` */
    shortBuilt: (name, need, have, built, total) => `I have ${have} ${name} and need ${need}. I found no more in the chests; I built ${built} of ${total}.`,
    /** `I stopped after 12 of 30.` */
    stopped: (done, total) => `I stopped after ${done} of ${total}.`,
    /** `I placed nothing at (x, y, z): it is inside the area "pen".` */
    refused: (cell, why) => `I placed nothing at ${P(cell)}: ${why}.`,
    /** `I dug nothing at (x, y, z): it is inside the area "home".` (beyond the spec: the refusal of a cell of a tunnel) */
    refusedDig: (cell, why) => `I dug nothing at ${P(cell)}: ${why}.`,
    refusals: refusalsText,
    whyArea: (name) => `it is inside the area "${name}"`,
    whyGuard: 'the area guard does not allow it',
    whyInTheWay: (name) => `${name} is in the way`,
    whyUnreachable: 'I could not get there',
    whyPlaceFailed: 'the block did not stay there',
    whyDigFailed: 'the block is still there',
    whyLava: 'lava is next to it',
    noPlayer: 'I see no player to watch.',
});
