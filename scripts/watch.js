// v0.1.4.12 (part C): the client of the watch server (spec 4.1).
//
//   node scripts/watch.js <tool> [json args]
//   node scripts/watch.js say "come here"
//   node scripts/watch.js digest 184
//   node scripts/watch.js wait idle 30
//   node scripts/watch.js run '!takeFromChest("bread", 10)' '!mineOre("diamond", 28)'
//   node scripts/watch.js --follow
//   node scripts/watch.js reply update 'The mining is at 2 of 6.'   (v0.1.4.13, part N2; kind answer by default)
//   node scripts/watch.js note 'the chest at (15, -59, -99) has bread' 30
//
// MC_WATCH_URL (default http://127.0.0.1:8090/mcp) and MC_WATCH_TOKEN come from the environment; the token is
// never printed. Prints the text of the answer; a refusal is one line and exit code 1; bad arguments exit 2.
// v0.1.4.13 (part S): `--follow` is a loop of `wait any`, each call with the cursor of the last answer, until
// the server does not answer; `events --follow` of v0.1.4.12 is gone. Uses the fetch of Node.
/* global process */
import { DEFAULT_URL, EXIT, cursorOf, nextWaitArgs, parseAnswer, parseCliArgs, requestBody, requestHeaders } from './watch_logic.js';
import { TEXTS } from '../src/agent/watch/texts.js';

function causeOf(error) {
    return error?.cause?.code ?? error?.code ?? error?.message ?? String(error);
}

async function call(url, token, tool, args) {
    let response;
    try {
        response = await fetch(url, { method: 'POST', headers: requestHeaders(token), body: JSON.stringify(requestBody(tool, args)) });
    } catch (error) {
        return { ok: false, text: TEXTS.noAnswer(url, causeOf(error)), gone: true };
    }
    const answer = parseAnswer(response.status, await response.text());
    return { ok: answer.ok, text: answer.text, gone: false };
}

async function once(url, token, tool, args) {
    const answer = await call(url, token, tool, args);
    console.log(answer.text);
    return answer.ok ? EXIT.OK : EXIT.REFUSED;
}

async function follow(url, token, args) {
    let next = nextWaitArgs(args, null);
    for (;;) {
        const answer = await call(url, token, 'wait', next);
        console.log(answer.text);
        if (!answer.ok)
            return EXIT.REFUSED; // the server is gone or refused the call: the loop ends
        next = nextWaitArgs(next, cursorOf(answer.text));
    }
}

async function main() {
    const parsed = parseCliArgs(process.argv.slice(2));
    if (parsed.error) {
        console.error(parsed.error);
        return EXIT.USAGE;
    }
    const url = process.env.MC_WATCH_URL || DEFAULT_URL;
    const token = process.env.MC_WATCH_TOKEN || '';
    return parsed.follow ? follow(url, token, parsed.args) : once(url, token, parsed.tool, parsed.args);
}

main().then((code) => {
    process.exitCode = code;
}, (error) => {
    console.log(TEXTS.noAnswer(process.env.MC_WATCH_URL || DEFAULT_URL, causeOf(error)));
    process.exitCode = EXIT.REFUSED;
});
