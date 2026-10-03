// v0.1.4.12 (part C): the client of the watch server (spec 4.1).
//
//   node scripts/watch.js <tool> [json args]
//   node scripts/watch.js say "come here"
//   node scripts/watch.js events --follow
//
// MC_WATCH_URL (default http://127.0.0.1:8090/mcp) and MC_WATCH_TOKEN come from the environment; the token is
// never printed. Prints the text of the answer; a refusal is one line and exit code 1; bad arguments exit 2.
// `events --follow` prints every event of the stream until the server ends it. Uses the fetch of Node.
/* global process */
import { DEFAULT_URL, EXIT, createSseParser, parseAnswer, parseCliArgs, requestBody, requestHeaders, streamLine } from './watch_logic.js';
import { TEXTS } from '../src/agent/watch/texts.js';

function causeOf(error) {
    return error?.cause?.code ?? error?.code ?? error?.message ?? String(error);
}

async function call(url, token, tool, args) {
    let response;
    try {
        response = await fetch(url, { method: 'POST', headers: requestHeaders(token), body: JSON.stringify(requestBody(tool, args)) });
    } catch (error) {
        console.log(TEXTS.noAnswer(url, causeOf(error)));
        return EXIT.REFUSED;
    }
    const answer = parseAnswer(response.status, await response.text());
    console.log(answer.text);
    return answer.ok ? EXIT.OK : EXIT.REFUSED;
}

async function follow(url, token) {
    let response;
    try {
        response = await fetch(url, { method: 'GET', headers: requestHeaders(token, 'text/event-stream') });
    } catch (error) {
        console.log(TEXTS.noAnswer(url, causeOf(error)));
        return EXIT.REFUSED;
    }
    if (response.status !== 200 || !response.body) {
        console.log(parseAnswer(response.status, await response.text()).text);
        return EXIT.REFUSED;
    }
    const parser = createSseParser();
    const decoder = new TextDecoder();
    try {
        for await (const chunk of response.body) {
            for (const message of parser.feed(decoder.decode(chunk, { stream: true }))) {
                const line = streamLine(message);
                if (line)
                    console.log(line);
            }
        }
    } catch (error) {
        console.log(TEXTS.noAnswer(url, causeOf(error)));
        return EXIT.REFUSED;
    }
    console.log(TEXTS.streamEnded);
    return EXIT.OK;
}

async function main() {
    const parsed = parseCliArgs(process.argv.slice(2));
    if (parsed.error) {
        console.error(parsed.error);
        return EXIT.USAGE;
    }
    const url = process.env.MC_WATCH_URL || DEFAULT_URL;
    const token = process.env.MC_WATCH_TOKEN || '';
    return parsed.follow ? follow(url, token) : call(url, token, parsed.tool, parsed.args);
}

main().then((code) => {
    process.exitCode = code;
}, (error) => {
    console.log(TEXTS.noAnswer(process.env.MC_WATCH_URL || DEFAULT_URL, causeOf(error)));
    process.exitCode = EXIT.REFUSED;
});
