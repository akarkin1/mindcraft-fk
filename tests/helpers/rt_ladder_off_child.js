// T1, spec v0.1.4.9 section 13: the child process of tests/unit/rt_ladder_follow.test.js for the switch off. It
// records every module that is resolved (module.registerHooks, Node 22.15 and later), runs followPlayer with
// routes_pack off for up to 12 s with the player 20 blocks below at the foot of a ladder, stops it, and prints one
// line of JSON: { ladderModules, clicks, goals, output, result }. The ladder step has no switch (2026-10-01), so the
// pass runs and the ladder module of the mining pack is loaded.
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
const timer = setTimeout(() => { bot.interrupt_code = true; }, 12000);
const watch = setInterval(() => { if (bot.clicks.length > 0 && Math.floor(bot.entity.position.y) <= 53) bot.interrupt_code = true; }, 100);
const result = await skills.followPlayer(bot, PLAYER, 4);
clearTimeout(timer);
clearInterval(watch);
stop();
const ladderModules = resolved.filter((u) => /packs\/mining\//.test(u));
log(JSON.stringify({ ladderModules, clicks: bot.clicks, goals: bot.goals, output: bot.output, result }));
