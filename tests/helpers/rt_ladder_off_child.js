// T1, spec v0.1.4.9 section 13: the child process of tests/unit/rt_ladder_follow.test.js for the switch off. It
// records every module that is resolved (module.registerHooks, Node 22.15 and later), runs followPlayer with
// routes_pack off for 4.5 s with the player 20 blocks below at the foot of a ladder, stops it, and prints one line
// of JSON: { ladderModules, clicks, goals, output, result }. The mining pack must not be imported at all.
import module from 'node:module';
import { register } from 'node:module';

const resolved = [];
module.registerHooks({
    resolve(specifier, context, next) {
        const r = next(specifier, context);
        resolved.push(r.url);
        return r;
    },
});
register('./mcdata_hooks.js', import.meta.url);

const { loadSrc } = await import('./load.js');
const { REGISTRY } = await import('../unit/mining_fake_bot.test.js');
const { ladderBot, runPhysics, PLAYER } = await import('./rt_ladder_env.js');
const mcdata = await loadSrc('src/utils/mcdata.js');
mcdata.__setMcdataForTests(REGISTRY);
const agentSettings = await loadSrc('src/agent/settings.js');
const skills = await loadSrc('src/agent/library/skills.js');
agentSettings.setSettings({ routes_pack: false });

const log = console.log;
console.log = () => {};
console.warn = () => {};
const bot = ladderBot();
const stop = runPhysics(bot);
const timer = setTimeout(() => { bot.interrupt_code = true; }, 4500);
const result = await skills.followPlayer(bot, PLAYER, 4);
clearTimeout(timer);
stop();
const ladderModules = resolved.filter((u) => /packs\/mining\//.test(u));
log(JSON.stringify({ ladderModules, clicks: bot.clicks, goals: bot.goals, output: bot.output, result }));
