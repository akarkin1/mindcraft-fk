// W12 rules (spec section 8 "Rules", R1 to R3): player_rules on, world_memory on. Two agent processes
// one after the other on the real server, with the same bot name and working directory (a restart).
//   first   the player says "do not ever forget to close the door behind yourself"; the fake model
//           answers !rememberRule("Close the door behind you."); the rule is saved (reply of R3,
//           bots/<name>/rules.json of R1).
//   second  after the restart !rules lists the rule, and the conversing prompt that the model gets
//           for the next message of the player contains the rules section of R2 with the rule.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    scenarioMain, check, note, exitSoon, startAgent, stopRealAgent, NEW_FLAGS_OFF, placeBot, resetBot, command_,
    waitFor, connectPlayer, quitPlayer, runPhase, sleep, env,
} from './helpers.js';
import { region, prepareRegion, releaseRegion } from './world.js';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'w_rules';
const PLAYER = 'w_player';
const RULE = 'Close the door behind you.';
const SECTION = 'RULES FROM THE PLAYER (always follow them, they are more important than your own ideas):\n1. Close the door behind you.';
const RULES_FILE = path.join('bots', NAME, 'rules.json');
const SETTINGS = { ...NEW_FLAGS_OFF, player_rules: true, world_memory: true };

await scenarioMain({
    async first() {
        const r = region(16);
        let agent = null, player = null;
        try {
            const s = await startAgent(NAME, SETTINGS);
            agent = s.agent;
            await resetBot(NAME);
            await placeBot(agent, { x: r.ox, y: r.g + 1, z: r.oz }, 0);
            player = await connectPlayer(PLAYER);
            s.route(/w_player: do not ever forget to close the door behind yourself/, `!rememberRule("${RULE}")`);
            player.chat('do not ever forget to close the door behind yourself');
            const done = await waitFor(() => fs.existsSync(RULES_FILE) && s.chat.requests.length >= 2, { ms: 30000, every: 200 });
            await sleep(500);
            const turns = agent.history.turns.map((t) => String(t.content));
            const result = turns.find((t) => t.includes('Rule 1 saved'));
            note(`first: history ${JSON.stringify(turns.slice(-4))}`);
            check(done.ok, 'first: the rule file bots/<name>/rules.json is written after the model answered !rememberRule');
            check(result && result.includes(`Rule 1 saved: "${RULE}"`), `first: the command replied: Rule 1 saved: "${RULE}"`, JSON.stringify(result));
            const again = await command_(agent, `!rememberRule("close the door behind you")`, 10000);
            check(again.includes('That rule is already saved.'), 'first: the same rule in other case and without the full stop is a duplicate', JSON.stringify(again));
            check(s.realCalls.length === 0, 'first: no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await quitPlayer(player);
            await stopRealAgent(agent);
        }
    },
    async second() {
        const r = region(16);
        let agent = null, player = null;
        try {
            const s = await startAgent(NAME, SETTINGS);
            agent = s.agent;
            await placeBot(agent, { x: r.ox, y: r.g + 1, z: r.oz }, 0);
            const list = await command_(agent, '!rules', 10000);
            note(`second: !rules ${JSON.stringify(list)}`);
            check(list.includes(`1. ${RULE}`), 'second: after the restart !rules lists "1. Close the door behind you."', JSON.stringify(list));
            player = await connectPlayer(PLAYER);
            s.route(/w_player: hello again/, 'Hello!');
            player.chat('hello again');
            const asked = await waitFor(() => s.chat.requests.some((q) => q.turns.some((t) => String(t.content).includes('hello again'))), { ms: 20000 });
            const req = s.chat.requests.find((q) => q.turns.some((t) => String(t.content).includes('hello again')));
            const prompt = req ? req.prompt : '';
            const at = prompt.indexOf('RULES FROM THE PLAYER');
            note(`second: the rules section in the prompt: ${JSON.stringify(at >= 0 ? prompt.slice(at, at + 200) : '(none)')}`);
            check(asked.ok && prompt.includes(SECTION), 'second: the conversing prompt contains the rules section of R2 with the rule', at >= 0 ? '' : 'no section');
            check(s.realCalls.length === 0, 'second: no request reached a real model class', JSON.stringify(s.realCalls));
        } finally {
            await quitPlayer(player);
            await stopRealAgent(agent);
        }
    },
    async main() {
        const r = region(16);
        await prepareRegion(r);
        try {
            await runPhase(SELF, 'first', {}, 80000);
            let json = null;
            try { json = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')); } catch (e) { note('rules.json: ' + e.message); }
            note(`rules.json after the first run: ${JSON.stringify(json)}`);
            const rule = json?.rules?.[0];
            check(json?.version === 1 && json.rules.length === 1 && rule.id === 1 && rule.text === RULE && typeof rule.created === 'string',
                'rules.json is { version 1, rules: [ { id 1, text, created } ] }', JSON.stringify(json));
            await runPhase(SELF, 'second', {}, 80000);
            void env;
        } finally {
            await releaseRegion(r);
        }
    },
});
exitSoon();
