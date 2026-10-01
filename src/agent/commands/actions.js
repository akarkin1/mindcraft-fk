import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import settings from '../settings.js';
import convoManager from '../conversation.js';
import { Vec3 } from 'vec3';
import { normalizeBox, contains, boxSize } from '../areas/area_geometry.js';
import { scanBuilding, findFencedGroundNear } from '../areas/area_scan.js';
import { AREA_TYPES, normalizeAreaName, replaceRefusal } from '../areas/area_store.js';
import { goToShelter, sleepInBed, eatBestFood, enterBuilding, passThrough, closeNear } from '../packs/home/index.js';
import { REMEMBER_RULE_DESCRIPTION, rememberRuleReply, forgetRuleReply } from '../rules/rule_commands.js';
import { isDiggingRequest, digRefusalText } from '../dig_request_logic.js';
import { oreInSight, sightRange } from '../library/ore_sight_logic.js';


// v0.1.4.8, I5 (S3, S4): a command that was stopped starts no turn of the model. What it did so far goes
// into the history as a system message: `Command !mineOre was stopped by the reflex unstuck. Done so far:
// <text>`, without the second sentence when there is no text. text: the text of a pack (I6), else the
// output of the action. X4: when a player typed the command in the chat, the line also goes to the chat of
// that player (the way the agent answers a typed command); a command of the model stays in the history
// only. Never throws.
function reportStopped(agent, label, code_return, text = null) {
    // an action that comes back by itself (!followPlayer, stopped by a reflex) is not worth a line in the history
    if (agent?.actions?.resume_func && String(code_return?.stopped_by ?? '').startsWith('the reflex '))
        return;
    const by = typeof code_return?.stopped_by === 'string' && code_return.stopped_by.trim() !== '' ? code_return.stopped_by : 'an interrupt';
    const done = doneText(text) ?? doneText(code_return?.message);
    const line = `Command !${label} was stopped by ${by}.` + (done ? ` Done so far: ${done}` : '');
    console.log(line);
    try {
        const added = agent?.history?.add?.('system', line);
        Promise.resolve(added).catch((error) => console.warn('Could not note the stopped command:', error));
    } catch (error) {
        console.warn('Could not note the stopped command:', error);
    }
    const player = typedCommandPlayer(agent, `!${label}`);
    if (player === null)
        return;
    try {
        const said = agent.routeResponse?.(player, line);
        Promise.resolve(said).catch((error) => console.warn('Could not tell the player about the stopped command:', error));
    } catch (error) {
        console.warn('Could not tell the player about the stopped command:', error);
    }
}

// v0.1.4.8 (X4): the player who typed the command `name` that runs (its newest entry of agent.running_commands,
// see executeCommand), or the player of agent.last_order when the order was typed and is that command; null
// for a command of the model.
function typedCommandPlayer(agent, name) {
    const list = Array.isArray(agent?.running_commands) ? agent.running_commands : [];
    for (let i = list.length - 1; i >= 0; i--) {
        const entry = list[i];
        if (entry?.name !== name)
            continue;
        if (entry.typed !== true)
            return null;
        if (typeof entry.by === 'string' && entry.by !== '')
            return entry.by;
        break;
    }
    const order = agent?.last_order;
    if (order !== null && typeof order === 'object' && order.typed === true && order.command === name && typeof order.by === 'string' && order.by !== '')
        return order.by;
    return null;
}

// What a stopped command did, without the heading "Action output:" of the output; null for nothing.
function doneText(text) {
    if (typeof text !== 'string')
        return null;
    const clean = text.replace(/^Action output:\s*/, '').trim();
    return clean === '' ? null : clean;
}

// v0.1.4.8, I1: a pack command pauses the reflex unstuck from its start until the bot is idle again. Never throws.
function pauseUnstuck(agent) {
    try {
        agent.bot?.modes?.pause?.('unstuck');
    } catch (error) {
        console.warn('Could not pause the mode unstuck:', error);
    }
}

function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout) {
            reportStopped(agent, actionLabel, code_return); // v0.1.4.8, I5
            return;
        }
        return code_return.message;
    }

    return wrappedAction;
}

// The arguments of !useSkill: a JSON array as text, single quotes are accepted in place of
// double quotes, an empty text means no arguments. Returns null when the text is not an array.
function parseSkillArgs(text) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (trimmed === '')
        return [];
    for (const candidate of [trimmed, trimmed.replaceAll("'", '"')]) {
        try {
            const value = JSON.parse(candidate);
            if (Array.isArray(value))
                return value;
        } catch (error) {
            // not JSON in this form
        }
    }
    return null;
}

// Appends a line to a result text: trailing whitespace and line breaks of the text are removed
// first, so exactly one line break separates them.
function appendLine(text, line) {
    return String(text).trimEnd() + '\n' + line;
}

// Appends the notices of the skill manager to a result text, each on its own line, for example
// that a skill was switched off after errors in a row. With flags.reuse only.
function withSkillNotices(agent, text) {
    if (!agent.skill_manager)
        return text;
    try {
        if (agent.skill_manager.flags.reuse) {
            for (const notice of agent.skill_manager.takeNotices())
                text = appendLine(text, notice);
        }
    } catch (error) {
        console.warn('Could not read the notices of the skills:', error);
    }
    return text;
}

// false only while the cost meter is in the state saving (v0.1.4.6, G1). Never throws.
function costAllows(agent, what) {
    if (!agent.cost_meter)
        return true;
    try {
        return agent.cost_meter.allows(what) !== false;
    } catch (error) {
        console.warn('Could not ask the cost meter:', error);
        return true;
    }
}

// Runs fn as the action `action:<label>`, like runAsAction, and returns the text that fn returns
// (the replies of the home pack, v0.1.4.6). Without a text: the output of the action. Nothing when
// the action was interrupted: then what it did goes into the history (v0.1.4.8, I5). timeout in
// minutes, -1 for none. options.pack (v0.1.4.8): a command of a pack, fn returns the result of the
// pack ({ ok, reason, text }); it pauses unstuck at its start, a result with the reason 'interrupted'
// counts as stopped (I6), its text is noted as agent.last_pack_text for the setting say_results, and
// the result goes to the entry of the command in agent.running_commands for the repeat guard.
async function runForText(agent, label, fn, timeout = -1, options = {}) {
    let text = null;
    let result = null;
    const pack = options?.pack === true;
    const entry = pack && Array.isArray(agent.running_commands) ? agent.running_commands[agent.running_commands.length - 1] ?? null : null;
    const code_return = await agent.actions.runAction(`action:${label}`, async () => {
        if (pack)
            pauseUnstuck(agent);
        const value = await fn();
        if (pack && value !== null && typeof value === 'object') {
            result = value;
            text = typeof value.text === 'string' ? value.text : null;
        } else {
            text = value;
        }
    }, { timeout, resume: false });
    const stopped = !code_return.timedout && (code_return.interrupted || result?.reason === 'interrupted');
    if (entry)
        entry.pack = { ok: result ? result.ok : undefined, reason: stopped ? 'interrupted' : (result?.reason ?? null), text };
    if (stopped) {
        reportStopped(agent, label, code_return, typeof text === 'string' ? text : null);
        return;
    }
    if (code_return.success && typeof text === 'string' && text !== '') {
        if (pack)
            agent.last_pack_text = text;
        return text;
    }
    return code_return.message;
}

// v0.1.4.8: runs a command of the home pack (fn returns the result of the pack) as a pack command.
async function runHome(agent, label, fn) {
    return await runForText(agent, label, fn, -1, { pack: true });
}

// The protected areas of v0.1.4.6 (section 6); the five types of v0.1.4.8 (I4) come from the area store.
const AREAS_OFF = 'Protected areas are off.';
const AREA_TYPE_TEXT = 'The type of an area is "home", "building", "farm", "pen" or "mine".';
const pointText = (p) => `(${p.x}, ${p.y}, ${p.z})`;
const countText = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const GATED_TYPES = ['farm', 'pen']; // areas with a fence: their gates are counted first

// "1 door" for a house, "1 gate" for a farm or a pen; the other kind only when there is one.
function entrancesText(area) {
    const entrances = Array.isArray(area.entrances) ? area.entrances : [];
    const doors = entrances.filter(e => e.kind !== 'gate').length;
    const gates = entrances.length - doors;
    const gated = GATED_TYPES.includes(area.type);
    const parts = gated ? [countText(gates, 'gate')] : [countText(doors, 'door')];
    if (gated && doors > 0)
        parts.push(countText(doors, 'door'));
    if (!gated && gates > 0)
        parts.push(countText(gates, 'gate'));
    return parts.join(', ');
}

function sizeText(area) {
    const size = boxSize(area);
    return `${size.x} x ${size.y} x ${size.z} blocks`;
}

function areaSavedText(area) {
    return `Area "${area.name}" (${area.type}) saved: ${sizeText(area)}, from ${pointText(area.min)} to ${pointText(area.max)}, ${entrancesText(area)}.`;
}

function areaErrorText(error, name) {
    if (error instanceof RangeError)
        return 'That area is too big. An area has at most 64 x 48 x 64 blocks.';
    const length = typeof name === 'string' ? name.trim().length : 0;
    if (length < 1 || length > 64)
        return 'An area needs a name of 1 to 64 characters.';
    console.warn('Could not save the area:', error);
    return `Could not save the area "${name}".`;
}

// The name of the block at x, y, z for the scans, null when it is not loaded.
const blockNameOf = (bot) => (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null;

// v0.1.4.7 Amendment 2, I6: the doors (the lower block only) and fence gates in the box, from the
// world. An entrance that was saved before stays where its block is not loaded.
function entrancesInBox(bot, box, saved) {
    const found = [];
    for (let x = box.min.x; x <= box.max.x; x++) {
        for (let z = box.min.z; z <= box.max.z; z++) {
            for (let y = box.min.y; y <= box.max.y; y++) {
                const block = bot.blockAt(new Vec3(x, y, z), false); // no extra infos: up to 196608 blocks
                const name = block?.name;
                if (typeof name !== 'string')
                    continue;
                if (name.endsWith('_fence_gate')) {
                    found.push({ x, y, z, kind: 'gate' });
                } else if (name.endsWith('_door')) {
                    const half = block.getProperties?.()?.half;
                    if (half === 'lower' || (half !== 'upper' && bot.blockAt(new Vec3(x, y - 1, z))?.name !== name))
                        found.push({ x, y, z, kind: 'door' });
                }
            }
        }
    }
    const unloaded = saved.filter(e => bot.blockAt(new Vec3(e.x, e.y, e.z)) === null);
    return [...found, ...unloaded];
}

// v0.1.4.6, !rememberHere: the building around the bot as an area, when one is found and no area of
// that name exists. Returns the sentence for the reply, or null. Never throws.
function saveBuildingAround(agent, name) {
    try {
        const store = agent.area_store;
        if (!store || store.get(name))
            return null;
        const bot = agent.bot;
        const scan = scanBuilding(blockNameOf(bot), bot.entity.position);
        if (!scan?.found)
            return null;
        // v0.1.4.8: the place "home" is the house, so its building is an area of the type home (D6)
        const type = normalizeAreaName(name) === 'home' ? 'home' : 'building';
        const area = store.set({ name, type, min: scan.min, max: scan.max, dimension: bot.game?.dimension,
            entrances: scan.entrances ?? [], source: 'scan' });
        return `I also saved the building around it as a protected area: ${sizeText(area)}, ${entrancesText(area)}.`;
    } catch (error) {
        console.warn('Could not save the building around the place:', error);
        return null;
    }
}

// v0.1.4.6, H7: with the home pack and protected areas, a place inside a building area is entered
// with enterBuilding of the home pack: through the entrance nearest to the bot with passThrough,
// which closes the door behind it. v0.1.4.8: also a home and a pen. Never throws.
const ENTERED_TYPES = ['building', 'home', 'pen'];
async function enterBuildingAround(agent, pos, dimension) {
    if (!settings.home_pack || !agent.area_store)
        return;
    try {
        const bot = agent.bot;
        const area = agent.area_store.areasAt({ x: pos[0], y: pos[1], z: pos[2] }, dimension).find(a => ENTERED_TYPES.includes(a.type));
        if (!area)
            return;
        const result = await enterBuilding(bot, area, agent.homeContext());
        if (!result?.ok && result?.text)
            skills.log(bot, result.text);
    } catch (error) {
        console.warn('Could not enter the building through the door:', error);
    }
}

// The work skills of v0.1.4.7 (spec section 7, part G). The packs come from agent.work_packs, which
// the agent fills only while a switch needs them; nothing here imports a pack.
const STORAGE_OFF = 'The storage pack is off.';
const FARMING_OFF = 'The farming pack is off.';
const WOOD_OFF = 'The wood pack is off.';
const MINING_OFF = 'The mining pack is off.';
const UNKNOWN_ORE = (ore) => `I do not know the ore "${ore}". I know coal, copper, iron, lapis, gold, redstone and diamond.`;
// v0.1.4.9 (I10): the commands of the routes pack and of the mine of the player
const ROUTES_OFF = 'The routes pack is off.';
const MINE_ROUTES_OFF = 'The mine routes are off. They need mine_routes, mining_pack and routes_pack.';

/**
 * v0.1.4.9 (section 2): mine_routes as it takes effect. It needs mining_pack and routes_pack; without
 * routes_pack the agent warns once at the start and the mine routes are off. The agent, the commands
 * and the guard of !newAction ask this one helper.
 * @param {object} [s] the settings, those of the agent without it
 * @returns {boolean}
 */
export function mineRoutesOn(s = settings) {
    // mine_routes exactly true, as the mining pack reads it (mine_way.js)
    return Boolean(s?.mining_pack) && Boolean(s?.routes_pack) && s?.mine_routes === true;
}

// Runs fn(pack, bot, ctx) of a work pack as the action `action:<label>` and returns the text of its
// result word for word, like the commands of the home pack. Nothing when the action was interrupted:
// then the text of the pack goes into the history (v0.1.4.8, I5, I6). It pauses unstuck at its start (I1).
async function runPack(agent, label, pack, name, fn) {
    if (!pack)
        return `The ${name} pack could not be loaded.`;
    return await runForText(agent, label, async () => await fn(pack, agent.bot, agent.packContext()), -1, { pack: true });
}

// v0.1.4.9 (decision of the tech lead): a command of a pack that does not move the bot is no action: its
// perform awaits fn(pack) and returns the text of the result ({ ok, reason, text } or a text) word for word, so a
// running action (!followPlayer into the mine) keeps running. Like runForText it notes the text for say_results
// and the result on the entry of the command for the repeat guard. The caller builds the pack context. Never throws.
async function runPlain(agent, pack, name, fn) {
    if (!pack)
        return `The ${name} pack could not be loaded.`;
    const entry = Array.isArray(agent.running_commands) ? agent.running_commands[agent.running_commands.length - 1] ?? null : null;
    let result = null;
    let text = null;
    try {
        const value = await fn(pack);
        if (value !== null && typeof value === 'object') {
            result = value;
            text = typeof value.text === 'string' ? value.text : null;
        } else if (typeof value === 'string') {
            text = value;
        }
    } catch (error) {
        console.warn(`The ${name} pack failed:`, error);
        text = `The ${name} pack failed: ${error?.message ?? error}`;
        result = { ok: false, reason: 'error', text };
    }
    if (entry)
        entry.pack = { ok: result ? result.ok : undefined, reason: result?.reason ?? null, text };
    if (typeof text !== 'string' || text === '')
        return '';
    agent.last_pack_text = text;
    return text;
}

// S4: the position of the chest that !putInChest, !takeFromChest and !viewChest will use, the nearest
// chest within 32 blocks as skills.js finds it; null while storage_pack is off. Never throws.
function chestToRecord(agent) {
    if (!settings.storage_pack || !agent.work_packs?.storage)
        return null;
    try {
        return world.getNearestBlock(agent.bot, 'chest', 32)?.position ?? null;
    } catch (error) {
        console.warn('Could not find the chest for the chest index:', error);
        return null;
    }
}

// S4, Amendment 1: after the old chest commands the chest index is updated with lookIntoChest of the
// storage pack. Its messages go to the console, not into the output of the command. Never throws.
async function recordChest(agent, pos) {
    if (!settings.storage_pack || !pos)
        return;
    try {
        const ctx = agent.packContext();
        ctx.log = (text) => console.log(text);
        await agent.work_packs.storage.lookIntoChest(agent.bot, ctx, pos);
    } catch (error) {
        console.warn('Could not update the chest index:', error);
    }
}

// M5: true when a block of the ore, in stone or deepslate, is within 16 blocks and in sight. v0.1.4.9 (F4, decision
// of the tech lead): in sight by the rule of part C (oreInSight of library/ore_sight_logic.js, the range of
// ore_sense_range): 0 a face in the open, 3 an open cell within 3 blocks. The ray from the eyes of v0.1.4.7
// (bot.canSeeBlock) missed an ore in the wall at the height of the feet. Never throws.
function oreVisible(bot, type) {
    try {
        const base = type.replace(/^deepslate_/, '');
        const range = sightRange(settings.ore_sense_range);
        const read = blockNameOf(bot);
        const nameAt = (x, y, z) => {
            try {
                return read(x, y, z);
            } catch (error) {
                return null; // not loaded: rock
            }
        };
        return world.getNearestBlocks(bot, [base, `deepslate_${base}`], 16, 32)
            .some((block) => Boolean(block?.position) && oreInSight(nameAt, block.position, range));
    } catch (error) {
        console.warn('Could not look for the ore:', error);
        return false;
    }
}

// v0.1.4.9 (F4): true when agent.whereAmI() says the bot is underground (deep, in a mine area or a mine). Never throws.
function isUnderground(agent) {
    try {
        return typeof agent?.whereAmI === 'function' && agent.whereAmI()?.underground === true;
    } catch (error) {
        console.warn('Could not ask where the bot is:', error);
        return false;
    }
}

// F3, T5, M5: the skill of a work pack that !collectBlocks leads to for a block, or null for the old
// collecting. Decided by the name of the block and the switches. Never throws. v0.1.4.9 (F4): an ore out of sight
// goes to !mineOre only on the surface; underground the old collecting runs, and the text of the library (C1) is
// the answer (!mineOre starts no mine underground).
function collectWork(agent, type) {
    try {
        if (settings.farming_pack && agent.work_packs?.farming?.harvestTarget(type))
            return { name: 'farming', pack: agent.work_packs.farming, run: (pack, bot, ctx, num) => pack.harvestCrops(bot, ctx, '', { limit: num }) };
        if (settings.wood_pack && agent.work_packs?.wood?.woodKind(type))
            return { name: 'wood', pack: agent.work_packs.wood, run: (pack, bot, ctx, num) => pack.chopTrees(bot, ctx, num, pack.woodKind(type)) };
        const ore = settings.mining_pack ? agent.work_packs?.mining?.oreOf(type) : null;
        if (ore && !oreVisible(agent.bot, type) && !isUnderground(agent))
            return { name: 'mining', pack: agent.work_packs.mining, run: (pack, bot, ctx, num) => pack.mineOre(bot, ctx, ore.ore ?? type, num) };
    } catch (error) {
        console.warn('Could not choose the skill for !collectBlocks:', error);
    }
    return null;
}

// M5: !goToMine goes down into the mine of the ore, without an ore into the nearest mine of the store,
// with descendToLevel of the mining pack.

// v0.1.4.9 (B3, I10): the yaw of the player who gave the order that runs (agent.last_order), in radians as
// mineflayer gives it, when that player is in bot.players and has an entity; else undefined. Never throws.
function orderPlayerYaw(agent) {
    try {
        const by = agent?.last_order?.by;
        const yaw = typeof by === 'string' && by !== '' ? agent.bot?.players?.[by]?.entity?.yaw : undefined;
        return typeof yaw === 'number' && Number.isFinite(yaw) ? yaw : undefined;
    } catch (error) {
        return undefined;
    }
}

// v0.1.4.9 (F2, decision of the tech lead): !goToRememberedPlace with routes_pack walks a way that the player showed
// FIRST when ctx.routes.routeFor finds one for the place (one end within 4 blocks of the place, the other within 32
// of the bot); the path search only does the rest (the path search alone stood on the closed trapdoor until the
// reflex unstuck stopped the command). Unstuck is paused from here to the end of the command, as runPack does. The
// text of the route goes into the output. Returns 'none' without such a route (the command goes on as before),
// 'walked' when the route arrived, 'failed' when it failed or was stopped: then nothing else is tried. Never throws.
async function routeFirst(agent, pos) {
    try {
        const routes = agent.homeContext().routes;
        const place = { x: pos[0], y: pos[1], z: pos[2] };
        if (typeof routes?.routeFor !== 'function' || typeof routes.walkTo !== 'function' || !routes.routeFor(place))
            return 'none';
        pauseUnstuck(agent);
        const result = await routes.walkTo(agent.bot, place);
        if (!result || result.reason === 'no_route')
            return 'none';
        if (typeof result.text === 'string' && result.text !== '')
            skills.log(agent.bot, result.text);
        return result.ok === true && !agent.bot.interrupt_code ? 'walked' : 'failed';
    } catch (error) {
        console.warn('Could not walk the way to the place:', error);
        return 'none';
    }
}

// v0.1.4.9 (I4): !goToRememberedPlace, after the walk of the path search: when the bot is still more than
// 2 blocks from the place, a way that the player showed (ctx.routes.walkTo of the routes pack). Its text
// goes into the output, unless no way leads there (reason no_route). Never throws.
const PLACE_REACHED = 2;
async function walkRememberedWay(agent, pos) {
    try {
        const bot = agent.bot;
        const at = bot.entity?.position;
        if (!at || Math.hypot(at.x - pos[0], at.y - pos[1], at.z - pos[2]) <= PLACE_REACHED)
            return;
        const routes = agent.homeContext().routes;
        if (typeof routes?.walkTo !== 'function')
            return;
        pauseUnstuck(agent); // the walk of a way is progress, not being stuck
        const result = await routes.walkTo(bot, { x: pos[0], y: pos[1], z: pos[2] });
        if (result && result.reason !== 'no_route' && typeof result.text === 'string' && result.text !== '')
            skills.log(bot, result.text);
    } catch (error) {
        console.warn('Could not walk a way to the place:', error);
    }
}

// v0.1.4.9 (I8): the digging commands that are on, for digRefusalText: !mineOre with mining_pack, !rememberTunnel
// with the mine routes, !collectBlocks always; none that settings.blocked_actions or the agent hides.
function diggingCommands(agent) {
    const hidden = new Set([...(Array.isArray(settings.blocked_actions) ? settings.blocked_actions : []),
        ...(Array.isArray(agent?.blocked_actions) ? agent.blocked_actions : [])]);
    const on = [];
    if (settings.mining_pack)
        on.push('!mineOre');
    if (mineRoutesOn())
        on.push('!rememberTunnel');
    on.push('!collectBlocks');
    return on.filter((name) => !hidden.has(name));
}

// v0.1.4.9 (I8): the text of a player's last message in the history, without the name in front; '' without one.
function lastPlayerMessage(agent) {
    const turns = agent?.history?.getHistory?.() ?? [];
    for (let i = turns.length - 1; i >= 0; i--) {
        const turn = turns[i];
        if (turn?.role === 'user' && typeof turn.content === 'string')
            return turn.content.replace(/^[^:\s]+:\s*/, '');
    }
    return '';
}

// v0.1.4.9 (I8, skills_over_code): the answer of !newAction when the model asks for code about digging (its
// prompt or the last message of a player is a digging request); null when the code may be written, also
// always for a !newAction that the player typed. Never throws.
function digCodeRefusal(agent, prompt) {
    try {
        if (typedByPlayer(agent, '!newAction'))
            return null;
        if (!isDiggingRequest(prompt).digging && !isDiggingRequest(lastPlayerMessage(agent)).digging)
            return null;
        return digRefusalText(diggingCommands(agent));
    } catch (error) {
        console.warn('Could not check the code request for digging:', error);
        return null;
    }
}

// v0.1.4.8: true while the command `name` runs as the order that a player typed in the chat (the newest
// entry of agent.running_commands, see executeCommand, or agent.last_order). A call of the model is false.
function typedByPlayer(agent, name) {
    const running = Array.isArray(agent?.running_commands) ? agent.running_commands[agent.running_commands.length - 1] : null;
    if (running && running.name === name)
        return running.typed === true;
    const order = agent?.last_order;
    return order !== null && typeof order === 'object' && order.typed === true && order.command === name;
}

// v0.1.4.8 (R4, decision of the owner): the reflexes that keep the bot alive. The model may not switch
// them off; the player may, by typing !setMode in the chat. Switching one on is always allowed.
const SAFETY_REFLEXES = ['self_preservation', 'creeper_safety', 'night_shelter', 'door_closing', 'hunger'];

// v0.1.4.8 (T5): !chopTrees takes the number of logs and the kind in either order: chopTrees(8, "oak"),
// chopTrees("oak", 8), chopTrees("", 8). Returns { num, kind } with num a number.
function logsAndKind(num, kind) {
    const isCount = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^\s*\d+\s*$/.test(v));
    if (!isCount(num) && isCount(kind))
        [num, kind] = [kind, num];
    const count = typeof num === 'string' ? Number.parseInt(num, 10) : num;
    return { num: Number.isInteger(count) && count > 0 ? count : 8, kind: typeof kind === 'string' ? kind : '' };
}

// v0.1.4.8 (C6): !givePlayer first fetches from a known chest what the bot does not carry, with the
// storage pack. Its text goes into the output of the action. Never throws.
async function fetchToGive(agent, item_name, num) {
    if (!settings.storage_pack || !agent.work_packs?.storage)
        return;
    try {
        const carried = world.getInventoryCounts(agent.bot)[item_name] ?? 0;
        if (carried >= num)
            return;
        pauseUnstuck(agent); // the walk to the chest is progress, not being stuck
        const ctx = agent.packContext();
        const result = await ctx.storage?.fetchItem?.(item_name, num - carried);
        if (result?.text)
            skills.log(agent.bot, result.text);
    } catch (error) {
        console.warn('Could not fetch the item to give from a chest:', error);
    }
}

// v0.1.4.8 (D5, P5): !rememberArea for a farm or a pen: the fenced ground at or near the bot. From
// outside the fence the ground behind the gate is saved, and with the home pack the bot walks in through
// the gate with passThrough. Returns the reply.
async function rememberFenced(agent, store, name, type) {
    if (!store)
        return AREAS_OFF;
    const bot = agent.bot;
    const scan = findFencedGroundNear(blockNameOf(bot), bot.entity.position, 6, { type });
    if (!scan?.found)
        return scan?.text || `I found no fenced ground here. Stand inside the fence and try again.`;
    const area = store.set({ name, type, min: scan.min, max: scan.max, dimension: bot.game?.dimension, entrances: scan.entrances ?? [], source: 'scan' });
    const saved = `${areaSavedText(area)} Tell me if that is wrong.`;
    if (scan.inside)
        return saved;
    // outside, on the fence or in the gate: the ground behind it is saved; then in through the gate
    const outside = (scan.text || '').replace(/\s*I can save the ground behind it\.$/, '');
    if (!settings.home_pack || !scan.gate)
        return `${outside} ${saved}`.trim();
    // stopped on the way: nothing, what it did goes into the history (I5); the area is saved all the same
    return await runForText(agent, 'rememberArea', async () => {
        pauseUnstuck(agent);
        const walk = await passThrough(bot, { ...scan.gate, kind: 'gate' }, agent.homeContext(), { inside: area });
        return walk?.ok ? `I went in through the gate at ${pointText(scan.gate)}. ${saved}` : `${outside} ${saved} I could not go in: ${walk?.text ?? 'the walk failed.'}`;
    });
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            // v0.1.4.9 (I8): with skills_over_code no code for digging where a command does it; the code model is not called
            const refusal = settings.skills_over_code ? digCodeRefusal(agent, prompt) : null;
            if (refusal)
                return refusal;
            if (!costAllows(agent, 'coding'))
                return 'I reached my cost limit and do not write new code now. Use the commands I have.';
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            const code_return = await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            if (agent.skill_manager && agent.coder.last_run != null) {
                try {
                    const capture = await agent.skill_manager.captureFromRun(agent.coder.last_run);
                    if (typeof capture.message === 'string' && capture.message !== '')
                        result = appendLine(result, capture.message);
                } catch (error) {
                    console.warn('Could not save the code as a skill:', error);
                }
            }
            // v0.1.4.8 (S4): the late result of a stopped !newAction starts no second turn of the model
            if (code_return?.interrupted && !code_return.timedout) {
                reportStopped(agent, 'newAction', code_return, typeof result === 'string' ? result : null);
                return;
            }
            return withSkillNotices(agent, result);
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            await agent.actions.stop('!stop'); // v0.1.4.8, I5: who stopped the action
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.last_order = null; // v0.1.4.6, G3
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity], default: 3}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity], default: 4}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity], default: 1}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Go to the nearest block of a type within a range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512], default: 64 }
        },
        perform: runAsAction(async (agent, block_type, range) => {
            if (range < 32) {
                skills.log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            await skills.goToNearestBlock(agent.bot, block_type, 4, range);
        })
    },
    {
        name: '!searchForEntity',
        description: 'Go to the nearest entity of a type within a range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512], default: 64 }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move this far away from here, in any direction.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            const saved = agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z, agent.bot.game?.dimension);
            if (saved === false)
                return `Could not save the location "${name}".`;
            if (agent.area_store) {
                const building = saveBuildingAround(agent, name);
                if (building)
                    return `Location saved as "${name}". ${building}`;
            }
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            const place_dimension = agent.memory_bank.recallPlaceInfo?.(name)?.dimension;
            const current_dimension = agent.bot.game?.dimension;
            if (place_dimension && typeof current_dimension === 'string' && current_dimension !== '' && place_dimension !== current_dimension) {
                skills.log(agent.bot, `"${name}" is in the dimension ${place_dimension}, but you are in ${current_dimension}. You cannot travel between dimensions by yourself.`);
                return;
            }
            // v0.1.4.9 (F2): a way that the player showed to the place goes first (it knows the doors, so no
            // enterBuildingAround before it); after it the path search does the rest; a failed way is the answer
            const way = settings.routes_pack ? await routeFirst(agent, pos) : 'none';
            if (way === 'failed' || agent.bot.interrupt_code)
                return;
            if (way === 'walked') {
                await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
                return;
            }
            if (settings.home_pack && agent.area_store) {
                await enterBuildingAround(agent, pos, place_dimension ?? current_dimension);
                if (agent.bot.interrupt_code)
                    return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
            // v0.1.4.9 (I4): where the path search did not arrive, a way that the player showed
            if (settings.routes_pack && !agent.bot.interrupt_code)
                await walkRememberedWay(agent, pos);
        })
    },
    {
        name: '!forgetPlace',
        description: 'Delete a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to forget.' }},
        perform: async function (agent, name) {
            if (agent.memory_bank.forgetPlace(name))
                return `Forgot the place "${name}".`;
            return `No location named "${name}" saved.`;
        }
    },
    {
        name: '!nameWorld',
        description: 'Give the current world a name, so you recognize it when you come back.',
        params: {'name': { type: 'string', description: 'The name to give the world.' }},
        perform: async function (agent, name) {
            if (!agent.world_memory)
                return 'World memory is off.';
            try {
                if (agent.world_memory.setLabel(name))
                    return `This world is now called "${name}".`;
            } catch (error) {
                console.warn('Could not name the world:', error);
            }
            return 'Could not name the world.';
        }
    },
    {
        name: '!rememberArea',
        description: 'Save the place you stand in as a protected area: home (the house), building, farm (only plant and harvest), pen (animals) or mine (only natural blocks). Use this when the player says "this is home", "this is the farm" or "this is the mine".',
        params: {
            'name': { type: 'string', description: 'The name of the area, for example "home".' },
            'type': { type: 'string', description: 'home, building, farm, pen or mine.', default: 'building' }
        },
        perform: async function (agent, name, type) {
            const store = agent.area_store;
            if (!store)
                return AREAS_OFF;
            if (!AREA_TYPES.includes(type))
                return AREA_TYPE_TEXT;
            try {
                // v0.1.4.8 (D5): a farm or a pen is the fenced ground at or near the bot, also from outside the gate
                if (type === 'farm' || type === 'pen')
                    return await rememberFenced(agent, store, name, type);
                const bot = agent.bot;
                const origin = bot.entity.position;
                const dimension = bot.game?.dimension;
                const scan = scanBuilding(blockNameOf(bot), origin);
                if (scan?.found) {
                    const area = store.set({ name, type, min: scan.min, max: scan.max, dimension, entrances: scan.entrances ?? [], source: 'scan' });
                    return `${areaSavedText(area)} Tell me if that is wrong.`;
                }
                // no building found: a box around the bot, 12 blocks in x and z, 4 below and 8 above
                const x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
                const box = normalizeBox({ x: x - 12, y: y - 4, z: z - 12 }, { x: x + 12, y: y + 8, z: z + 12 });
                const area = store.set({ name, type, min: box.min, max: box.max, dimension, entrances: [], source: 'radius' });
                if (type === 'mine')
                    return `I saved a box of ${sizeText(area)} around this place as the mine "${area.name}". Use !setArea to correct it.`;
                return `I found no building here. I saved a box of ${sizeText(area)} around this place as "${area.name}". Use !setArea to correct it.`;
            } catch (error) {
                return areaErrorText(error, name);
            }
        }
    },
    {
        name: '!setArea',
        description: 'Save a protected area with the given corners, or correct a saved one.',
        params: {
            'name': { type: 'string', description: 'The name of the area.' },
            'type': { type: 'string', description: 'home, building, farm, pen or mine.' },
            'x1': { type: 'float', description: 'Corner 1, x.', domain: [-Infinity, Infinity] },
            'y1': { type: 'float', description: 'Corner 1, y.', domain: [-64, 320] },
            'z1': { type: 'float', description: 'Corner 1, z.', domain: [-Infinity, Infinity] },
            'x2': { type: 'float', description: 'Corner 2, x.', domain: [-Infinity, Infinity] },
            'y2': { type: 'float', description: 'Corner 2, y.', domain: [-64, 320] },
            'z2': { type: 'float', description: 'Corner 2, z.', domain: [-Infinity, Infinity] }
        },
        perform: async function (agent, name, type, x1, y1, z1, x2, y2, z2) {
            const store = agent.area_store;
            if (!store)
                return AREAS_OFF;
            if (!AREA_TYPES.includes(type))
                return AREA_TYPE_TEXT;
            try {
                const box = normalizeBox({ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 });
                // v0.1.4.8 (D7, P4): the model may not save a thin box or shrink an area; the player may, by typing it
                const refusal = replaceRefusal(store.get(name), box, typedByPlayer(agent, '!setArea'));
                if (refusal)
                    return refusal.text;
                // the doors of a saved area of that name stay when they are inside the new box
                const entrances = (store.get(name)?.entrances ?? []).filter(e => contains(box, e));
                const dimension = agent.bot.game?.dimension;
                let area = store.set({ name, type, min: box.min, max: box.max, dimension, entrances, source: 'manual' });
                // v0.1.4.7 Amendment 2, I6: then the doors and gates in the box are looked up in the world
                try {
                    const found = entrancesInBox(agent.bot, area, entrances);
                    area = store.set({ name, type, min: area.min, max: area.max, dimension, entrances: found, source: 'manual' });
                } catch (error) {
                    console.warn('Could not look up the doors and gates of the area:', error);
                }
                return areaSavedText(area);
            } catch (error) {
                return areaErrorText(error, name);
            }
        }
    },
    {
        name: '!forgetArea',
        description: 'Delete a protected area.',
        params: {'name': { type: 'string', description: 'The name of the area to forget.' }},
        perform: async function (agent, name) {
            const store = agent.area_store;
            if (!store)
                return AREAS_OFF;
            try {
                if (store.remove(name))
                    return `Forgot the area "${name}".`;
            } catch (error) {
                console.warn('Could not forget the area:', error);
            }
            return `No area named "${name}" is saved.`;
        }
    },
    {
        name: '!allowChanges',
        description: 'Allow yourself to break and place blocks in a protected area for some minutes. ONLY when the player tells you to build, repair or break something there.',
        params: {
            'name': { type: 'string', description: 'The name of the area.' },
            'minutes': { type: 'int', description: 'For how many minutes, at most 60.', domain: [1, 60, '[]'], default: 10 }
        },
        perform: async function (agent, name, minutes) {
            const store = agent.area_store;
            const guard = agent.area_guard; // the full guard: bot.areaGuard has no permit (Amendment 2, F2)
            if (!store || !guard)
                return AREAS_OFF;
            try {
                if (!store.get(name))
                    return `No area named "${name}" is saved.`;
                guard.permit(name, minutes);
                return `You may change blocks in "${name}" for ${minutes} minutes.`;
            } catch (error) {
                console.warn('Could not allow changes in the area:', error);
                return `Could not allow changes in "${name}".`;
            }
        }
    },
    {
        name: '!rememberRule',
        description: REMEMBER_RULE_DESCRIPTION,
        params: {'text': { type: 'string', description: 'The rule as one short sentence.' }},
        perform: async function (agent, text) {
            return rememberRuleReply(agent.rule_store, text); // never throws, also without a store
        }
    },
    {
        name: '!forgetRule',
        description: 'Delete a saved rule by its number.',
        params: {'number': { type: 'int', description: 'The number of the rule, as !rules shows it.' }},
        perform: async function (agent, number) {
            return forgetRuleReply(agent.rule_store, number); // never throws, also without a store
        }
    },
    {
        name: '!givePlayer',
        // v0.1.4.8 (C6): with the storage pack the bot first fetches from a known chest what it does not carry
        get description() {
            if (settings.storage_pack)
                return 'Give an item to a player. What you do not carry you first fetch from a chest you know.';
            return 'Give the specified item to the given player.';
        },
        params: {
            'player_name': { type: 'string', description: 'The name of the player.' },
            'item_name': { type: 'ItemName', description: 'The item to give.' },
            'num': { type: 'int', description: 'How many to give.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            await fetchToGive(agent, item_name, num);
            if (agent.bot.interrupt_code)
                return;
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const chest = chestToRecord(agent); // v0.1.4.7, S4: null while storage_pack is off
            await skills.putInChest(agent.bot, item_name, num);
            await recordChest(agent, chest);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const chest = chestToRecord(agent); // v0.1.4.7, S4: null while storage_pack is off
            await skills.takeFromChest(agent.bot, item_name, num);
            await recordChest(agent, chest);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            const chest = chestToRecord(agent); // v0.1.4.7, S4: null while storage_pack is off
            await skills.viewChest(agent.bot);
            await recordChest(agent, chest);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The item to discard.' },
            'num': { type: 'int', description: 'How many to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            // v0.1.4.8 (S14): the walk away before the toss has a limit and never digs; the walk back only when the bot moved
            const pos = agent.bot.entity.position;
            const start = { x: pos.x, y: pos.y, z: pos.z };
            await skills.discard(agent.bot, item_name, num, 5);
            const now = agent.bot.entity.position;
            if (!agent.bot.interrupt_code && Math.hypot(now.x - start.x, now.y - start.y, now.z - start.z) >= 1)
                await skills.goToPosition(agent.bot, start.x, start.y, start.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }
        },
        perform: async function (agent, type, num) {
            // v0.1.4.7 (F3, T5, M5): while a switch is on, crops, logs and ores lead to the skill of the pack
            const work = collectWork(agent, type);
            if (work)
                return await runPack(agent, 'collectBlocks', work.pack, work.name, (pack, bot, ctx) => work.run(pack, bot, ctx, num));
            return await runForText(agent, 'collectBlocks', async () => {
                await skills.collectBlock(agent.bot, type, num);
            }, 10); // 10 minute timeout
        }
    },
    {
        name: '!pickUpItems',
        description: 'Pick up items that lie on the ground near you. Use this when the player says "pick up what I dropped".',
        params: {
            'item': { type: 'string', description: 'The item to pick up, empty for all.', default: '' },
            'range': { type: 'int', description: 'How far to look, in blocks.', domain: [1, 65], default: 16 }
        },
        perform: runAsAction(async (agent, item, range) => {
            await skills.pickUpItems(agent.bot, item ?? '', range ?? 16);
        })
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'How many times to craft the recipe. NOT the number of items: one craft can make several.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The item to smelt.' },
            'num': { type: 'int', description: 'How many times to smelt it.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            if (success) {
                setTimeout(() => {
                    agent.cleanKill('Safely restarting to update inventory.');
                }, 500);
            }
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place a block where you stand. Only single blocks or torches, NOT to build.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            let pos = agent.bot.entity.position;
            await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        // v0.1.4.6, H7: with the home pack another description and sleepInBed
        get description() {
            if (settings.home_pack)
                return 'Go to the nearest bed and sleep. Use this at night, or when the player says "sleep" or "go to bed".';
            return 'Go to the nearest bed and sleep.';
        },
        perform: async function (agent) {
            if (settings.home_pack)
                return await runHome(agent, 'goToBed', async () => await sleepInBed(agent.bot, agent.homeContext()));
            return await runForText(agent, 'goToBed', async () => {
                await skills.goToBed(agent.bot);
            });
        }
    },
    {
        name: '!goToShelter',
        description: 'Go into your home and close the door. Use this when night comes, when monsters are near, when the player says "get to shelter", "go home" or "go inside".',
        perform: async function (agent) {
            if (!settings.home_pack)
                return 'The home pack is off.';
            return await runHome(agent, 'goToShelter', async () => await goToShelter(agent.bot, agent.homeContext()));
        }
    },
    {
        name: '!eat',
        description: 'Eat until you are full, and until your health is full while you have food. Use this when the player tells you to eat, or when you are hungry or hurt.',
        perform: async function (agent) {
            if (!settings.home_pack)
                return 'The home pack is off.';
            // v0.1.4.8 (C1): with the chest index of the storage pack the text can name a chest with food
            const ctx = settings.storage_pack ? agent.packContext() : agent.homeContext();
            return await runHome(agent, 'eat', async () => await eatBestFood(agent.bot, ctx));
        }
    },
    {
        name: '!closeDoor',
        description: 'Close the open doors, gates and trapdoors within 6 blocks of you.',
        perform: async function (agent) {
            if (!settings.home_pack)
                return 'The home pack is off.';
            // v0.1.4.8 (C5, R7): the door service of the agent, else closeNear of the home pack
            return await runHome(agent, 'closeDoor', async () => {
                const service = agent.door_service;
                if (typeof service?.closeNear === 'function')
                    return await service.closeNear(6);
                return await closeNear(agent.bot, { ...agent.homeContext(), log: (text) => console.log(text) }, 6);
            });
        }
    },
    {
        name: '!storeItems',
        description: 'Put what you carry into a chest. You keep your tools, food and torches. Use this when your inventory is full, or when the player says "store", "stash" or "put it in the chest".',
        perform: async function (agent) {
            if (!settings.storage_pack)
                return STORAGE_OFF;
            return await runPack(agent, 'storeItems', agent.work_packs?.storage, 'storage', (pack, bot, ctx) => pack.storeItems(bot, ctx, {}));
        }
    },
    {
        name: '!fetchItem',
        description: 'Get an item out of a chest you know. Use this when you need something you do not carry, or when the player says "get" or "fetch" something from the chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to get.' },
            'num': { type: 'int', description: 'The number of items to get.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }
        },
        perform: async function (agent, item_name, num) {
            if (!settings.storage_pack)
                return STORAGE_OFF;
            return await runPack(agent, 'fetchItem', agent.work_packs?.storage, 'storage', (pack, bot, ctx) => pack.fetchItem(bot, ctx, item_name, num));
        }
    },
    {
        name: '!farmCycle',
        description: 'Do the whole farm round: harvest, store, plant, make bone meal in the composter and use it, close the gate. Use this when the player says "farm" or "take care of the wheat".',
        params: {'area': { type: 'string', description: 'The farm, empty for the nearest.', default: '' }},
        perform: async function (agent, area) {
            if (!settings.farming_pack)
                return FARMING_OFF;
            return await runPack(agent, 'farmCycle', agent.work_packs?.farming, 'farming', (pack, bot, ctx) => pack.farmCycle(bot, ctx, area));
        }
    },
    {
        name: '!harvest',
        description: 'Harvest the ripe plants of a farm and plant them again. Use this when the player says "harvest" or "collect the wheat".',
        params: {'area': { type: 'string', description: 'The farm, empty for the nearest.', default: '' }},
        perform: async function (agent, area) {
            if (!settings.farming_pack)
                return FARMING_OFF;
            return await runPack(agent, 'harvest', agent.work_packs?.farming, 'farming', (pack, bot, ctx) => pack.harvestCrops(bot, ctx, area));
        }
    },
    {
        name: '!plant',
        description: 'Plant seeds on the free ground of a farm. Use this when the player says "plant", "seed" or "sow".',
        params: {
            'seed': { type: 'string', description: 'The seed to plant: wheat_seeds, carrot, potato or beetroot_seeds.', default: 'wheat_seeds' },
            'area': { type: 'string', description: 'The farm, empty for the nearest.', default: '' }
        },
        perform: async function (agent, seed, area) {
            if (!settings.farming_pack)
                return FARMING_OFF;
            return await runPack(agent, 'plant', agent.work_packs?.farming, 'farming', (pack, bot, ctx) => pack.plantField(bot, ctx, area, seed));
        }
    },
    {
        name: '!makeBoneMeal',
        description: 'Make bone meal in the composter from compost items you carry, fetch from the chests you know or pick near the farm. Never seeds or food.',
        params: {'num': { type: 'int', description: 'The number of bone meal to make.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }},
        perform: async function (agent, num) {
            if (!settings.farming_pack)
                return FARMING_OFF;
            return await runPack(agent, 'makeBoneMeal', agent.work_packs?.farming, 'farming', (pack, bot, ctx) => pack.makeBoneMeal(bot, ctx, num));
        }
    },
    {
        name: '!fertilize',
        description: 'Use your bone meal on the plants of a farm, so they grow faster.',
        params: {'area': { type: 'string', description: 'The farm, empty for the nearest.', default: '' }},
        perform: async function (agent, area) {
            if (!settings.farming_pack)
                return FARMING_OFF;
            return await runPack(agent, 'fertilize', agent.work_packs?.farming, 'farming', (pack, bot, ctx) => pack.fertilize(bot, ctx, area));
        }
    },
    {
        name: '!chopTrees',
        description: 'Cut whole trees and pick up the logs until you have that many, with an axe if you can get one. Only real trees. Use this when the player asks for wood.',
        params: {
            // v0.1.4.8 (T5): either order of the arguments, !chopTrees("oak", 8) too
            'num': { type: 'IntOrString', description: 'The number of logs to get.', domain: [1, Number.MAX_SAFE_INTEGER], default: 8 },
            'kind': { type: 'string', description: 'The kind of wood, for example "oak", empty for any.', default: '' }
        },
        perform: async function (agent, num, kind) {
            if (!settings.wood_pack)
                return WOOD_OFF;
            const logs = logsAndKind(num, kind);
            return await runPack(agent, 'chopTrees', agent.work_packs?.wood, 'wood', (pack, bot, ctx) => pack.chopTrees(bot, ctx, logs.num, logs.kind));
        }
    },
    {
        name: '!getTool',
        description: 'Make sure you have a tool. You take it from a chest you know or craft it, with everything that needs.',
        params: {
            'kind': { type: 'string', description: 'The tool: pickaxe, axe, shovel, hoe or sword.' },
            'material': { type: 'string', description: 'The weakest material that is good enough: wooden, stone, iron or diamond. Empty: the best you can make, up to stone.', default: '' }
        },
        perform: async function (agent, kind, material) {
            if (!settings.wood_pack)
                return WOOD_OFF;
            return await runPack(agent, 'getTool', agent.work_packs?.wood, 'wood', (pack, bot, ctx) => pack.ensureTool(bot, ctx, kind, material));
        }
    },
    {
        name: '!craftSupplies',
        description: 'Craft torches, ladders, a chest or a crafting table, and collect the wood for it.',
        params: {
            'item': { type: 'string', description: 'The item: torch, ladder, chest, crafting_table, stick or planks.' },
            'num': { type: 'int', description: 'The number of items.', domain: [1, Number.MAX_SAFE_INTEGER], default: 1 }
        },
        perform: async function (agent, item, num) {
            if (!settings.wood_pack)
                return WOOD_OFF;
            return await runPack(agent, 'craftSupplies', agent.work_packs?.wood, 'wood', (pack, bot, ctx) => pack.craftSupplies(bot, ctx, item, num));
        }
    },
    {
        name: '!mineOre',
        description: 'Mine an ore and come back. Without a known mine you first ask the player. Use this when the player asks for an ore or for mining.',
        params: {
            'ore': { type: 'string', description: 'The ore: coal, copper, iron, lapis, gold, redstone or diamond.' },
            'num': { type: 'int', description: 'The number of ore items to bring.', domain: [1, Number.MAX_SAFE_INTEGER], default: 8 },
            'new_mine': { type: 'boolean', description: 'true only after the player said yes to a new mine.', default: false }
        },
        perform: async function (agent, ore, num, new_mine) {
            if (!settings.mining_pack)
                return MINING_OFF;
            // v0.1.4.8 (E4): without a known mine the pack asks; with new_mine it digs a new one
            return await runPack(agent, 'mineOre', agent.work_packs?.mining, 'mining', (pack, bot, ctx) => pack.mineOre(bot, ctx, ore, num, { newMine: new_mine === true }));
        }
    },
    {
        name: '!goToMine',
        description: 'Go down into your mine.',
        params: {'ore': { type: 'string', description: 'The ore of the mine, empty for the nearest mine.', default: '' }},
        perform: async function (agent, ore) {
            if (!settings.mining_pack)
                return MINING_OFF;
            return await runPack(agent, 'goToMine', agent.work_packs?.mining, 'mining', (pack, bot, ctx) => pack.goToMine(bot, ctx, ore));
        }
    },
    {
        name: '!leaveMine',
        description: 'Come up from the mine to the surface.',
        perform: async function (agent) {
            if (!settings.mining_pack)
                return MINING_OFF;
            return await runPack(agent, 'leaveMine', agent.work_packs?.mining, 'mining', (pack, bot, ctx) => pack.climbToSurface(bot, ctx));
        }
    },
    // v0.1.4.9 (I10): the ways of the player (routes_pack) and the mine of the player (mine_routes). All but
    // !collectPassedOre (it walks) are plain commands that do not move the bot and stop no running action.
    {
        name: '!rememberRoute',
        description: 'Remember the way you walked here from a place you know. Use this when the player says "remember this way".',
        params: {'name': { type: 'string', description: 'The name of the way, for example "bed".' }},
        perform: async function (agent, name) {
            if (!settings.routes_pack)
                return ROUTES_OFF;
            // no action: a running !followPlayer keeps running (decision of the tech lead)
            return await runPlain(agent, agent.work_packs?.routes, 'routes', (pack) => pack.rememberRoute(agent.bot, agent.packContext(), name));
        }
    },
    {
        name: '!routes',
        description: 'List the ways you remember.',
        perform: async function (agent) {
            if (!settings.routes_pack)
                return ROUTES_OFF;
            return await runPlain(agent, agent.work_packs?.routes, 'routes', (pack) => pack.routesText(agent.packContext(), agent.bot.game?.dimension));
        }
    },
    {
        name: '!forgetRoute',
        description: 'Forget a way you remember.',
        params: {'name': { type: 'string', description: 'The name of the way.' }},
        perform: async function (agent, name) {
            if (!settings.routes_pack)
                return ROUTES_OFF;
            return await runPlain(agent, agent.work_packs?.routes, 'routes', (pack) => pack.forgetRoute(agent.packContext(), name, agent.bot.game?.dimension));
        }
    },
    {
        name: '!rememberMine',
        description: 'Learn the mine you walked into: the way in, the room and a tunnel. Use this when the player says "remember this mine".',
        params: {'name': { type: 'string', description: 'The name of the mine.', default: 'mine' }},
        perform: async function (agent, name) {
            if (!mineRoutesOn())
                return MINE_ROUTES_OFF;
            const playerYaw = orderPlayerYaw(agent);
            return await runPlain(agent, agent.work_packs?.mining, 'mining', (pack) => pack.rememberMine(agent.bot, agent.packContext(), name, { playerYaw }));
        }
    },
    {
        name: '!rememberTunnel',
        description: 'Measure the tunnel you stand in, to dig on at its end later. Use this when the player says "dig here".',
        params: {'name': { type: 'string', description: 'The mine, empty for the one here.', default: '' }},
        perform: async function (agent, name) {
            if (!mineRoutesOn())
                return MINE_ROUTES_OFF;
            const playerYaw = orderPlayerYaw(agent);
            return await runPlain(agent, agent.work_packs?.mining, 'mining', (pack) => pack.rememberTunnel(agent.bot, agent.packContext(), name, { playerYaw }));
        }
    },
    {
        name: '!collectPassedOre',
        description: 'Collect the ore you left behind in the mine, when the player asks for it.',
        params: {
            'ore': { type: 'string', description: 'The ore, for example "coal", empty for all.' },
            'num': { type: 'int', description: 'The most ore blocks to take.', domain: [1, Number.MAX_SAFE_INTEGER], default: 8 }
        },
        perform: async function (agent, ore, num) {
            if (!mineRoutesOn())
                return MINE_ROUTES_OFF;
            return await runPack(agent, 'collectPassedOre', agent.work_packs?.mining, 'mining', (pack, bot, ctx) => pack.collectPassedOre(bot, ctx, ore, num));
        }
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER], default: 30 }},
        perform: runAsAction(async (agent, seconds) => {
            await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode on or off. A mode is an automatic behavior that reacts to the world. Only the player switches a safety reflex off.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            // v0.1.4.8 (R4, decision of the owner): the model may not switch a safety reflex off, the player may
            if (on === false && SAFETY_REFLEXES.includes(mode_name) && !typedByPlayer(agent, '!setMode'))
                return `Only the player switches the reflex ${mode_name}. The player can type !setMode("${mode_name}", false) in the chat.`;
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            if (!costAllows(agent, 'self_prompt'))
                return 'I reached my cost limit and do not work on goals by myself now.';
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you reached your goal. It stops self-prompting and the current action.',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id of the villager.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id of the villager.' },
            'index': { type: 'int', description: 'The number of the trade, from 1.', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times to trade.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the bot.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the bot.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player, or where the player looks.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: '"at": look at the player; "with": look where the player looks.',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Dig down a distance. Stops at lava, water or a drop of 4 blocks or more.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Go up to the highest block above you, usually the surface.',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Right click a tool on the nearest target of a type.',
        params: {
            'tool_name': { type: 'string', description: 'The tool, or "hand" for none.' },
            'target': { type: 'string', description: 'An entity type, a block type, or "nothing".' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
    {
        name: '!forgetSkill',
        description: 'Delete a saved skill.',
        params: {'name': { type: 'string', description: 'The name of the skill to forget.' }},
        perform: function (agent, name) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            try {
                if (agent.skill_manager.forget(name))
                    return `Forgot the skill "${name}".`;
            } catch (error) {
                console.warn('Could not forget the skill:', error);
            }
            return `No skill named "${name}" is saved.`;
        }
    },
    {
        name: '!disableSkill',
        description: 'Stop offering a saved skill without deleting it.',
        params: {'name': { type: 'string', description: 'The name of the skill to disable.' }},
        perform: function (agent, name) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            try {
                if (agent.skill_manager.setStatus(name, 'disabled'))
                    return `Disabled the skill "${name}".`;
            } catch (error) {
                console.warn('Could not disable the skill:', error);
            }
            return `No skill named "${name}" is saved.`;
        }
    },
    {
        name: '!enableSkill',
        description: 'Offer a disabled skill again.',
        params: {'name': { type: 'string', description: 'The name of the skill to enable.' }},
        perform: function (agent, name) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            try {
                if (agent.skill_manager.setStatus(name, 'active'))
                    return `Enabled the skill "${name}".`;
            } catch (error) {
                console.warn('Could not enable the skill:', error);
            }
            return `No skill named "${name}" is saved.`;
        }
    },
    {
        name: '!useSkill',
        description: 'Run a saved skill with the given values.',
        params: {
            'name': { type: 'string', description: 'The name of the saved skill.' },
            'args': { type: 'string', description: 'The values after bot as a list, for example "[3, \'oak_log\']". Empty for no values.' }
        },
        perform: async function (agent, name, args) {
            if (!agent.skill_manager)
                return 'Skill learning is off.';
            // checked before runAction, so an unknown name does not stop the running action
            let known = false;
            try {
                known = agent.skill_manager.has(name);
            } catch (error) {
                console.warn('Could not look up the skill:', error);
            }
            if (!known)
                return `No skill named "${name}" is saved.`;
            const values = parseSkillArgs(args);
            if (values === null)
                return `Could not read the arguments. Write them as a list, for example "[3, 'oak_log']".`;
            let run = null;
            const actionFn = async () => {
                run = await agent.skill_manager.run(name, values, agent.bot);
            };
            const code_return = await agent.actions.runAction('action:useSkill', actionFn, {timeout: settings.code_timeout_mins});
            if (run?.error === 'unknown_skill')
                return withSkillNotices(agent, `No skill named "${name}" is saved.`);
            if (code_return.interrupted && !code_return.timedout)
                return;
            if (run && !run.ok && run.error)
                return withSkillNotices(agent, `The skill "${name}" failed: ${run.error}`);
            const output = code_return.message;
            if (!output || output.trim() === 'Action output:')
                return withSkillNotices(agent, `The skill "${name}" finished.`);
            return withSkillNotices(agent, output);
        }
    },
];
