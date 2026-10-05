// World test runner of releases v0.1.4.6 and v0.1.4.7 (`npm run test:world`): tests on a REAL
// Minecraft server.
//
// One server process per world type: the official Minecraft 1.21.8 server from MC_TEST_SERVER_DIR
// (default %LOCALAPPDATA%\Mindcraft\test-server) with the Java of MC_TEST_JAVA (default: the Java 21 of
// the Minecraft launcher). It runs on 127.0.0.1, port 25599 or the next free one, offline mode, in a
// fresh temp directory (os.tmpdir()/mc-world-*) that is removed at the end. The server folder is only
// read. Without server or Java: "World tests skipped: no test server found.", exit 0.
// World types (mc_server.js): `flat`, the default flat world with the ground at y -61, for the
// scenarios of v0.1.4.6 and the work above ground; `deep`, bedrock, 120 layers of stone, 3 of dirt and
// grass at y 60, for the mining scenarios; `base` (v0.1.4.8), the layers of `deep` with a base like the
// owner's that each scenario builds in its region (base_world.js). The scenarios of each type run with
// their own server, flat, deep, base; a type none of the selected scenarios needs starts no server.
// A word that names a group (GROUPS, for example all_modes_on) selects the scenarios of the group.
//
// Every scenario runs in its own node process with its own temp directory as working directory
// (bots/ lands there), in its own region of the world (200 blocks from the others). It sends
// console commands to the server through this runner (a small HTTP service on 127.0.0.1 with a
// random token, see control.js). A scenario that depends on monsters runs up to 3 times and passes
// with 2 passing runs.
//
// Usage:
//   node tests/world/run.js                  all scenarios
//   node tests/world/run.js doors shelter    only scenarios whose name contains one of the words
//   node tests/world/run.js --verbose        print the whole output of every scenario
//   node tests/world/run.js --server-log     also print the server lines of every scenario
// Environment: MC_TEST_SERVER_DIR, MC_TEST_JAVA, MCW_LOG_DIR (a folder where the runner copies the
// output of every scenario and the server log; nothing is copied without it).
// MCW_PROFILE (v0.1.4.13, part K): the scenario process, which holds the agent, is started with the
// profiler of node: `cpu` or `1` writes a `.cpuprofile` (--cpu-prof), `heap` a `.heapprofile`
// (--heap-prof), into MCW_LOG_DIR/profile (the run directory without MCW_LOG_DIR). With `1` a heap
// snapshot is also written there when the heap is nearly full (--heapsnapshot-near-heap-limit), for a
// process that dies of "heap out of memory". A profile is written only when the process ends by itself.
//
// Exit code: 0 only if every selected scenario passed and nothing was left behind.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    locateServer, McServer, findFreePort, killPid, pidAlive, OWNER_PORT, WORLD_TYPES, worldProperties, worldProbes,
} from './mc_server.js';

const WORLD_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WORLD_DIR, '..', '..');
const TMP_PREFIX = 'mc-world-';

// name, file, timeout in seconds, depends on monsters, world type ('flat' when not given)
const SCENARIOS = [
    ['baseline', 'w01_baseline.js', 180, false],
    ['flags_off', 'w02_flags_off.js', 240, false],
    ['doors', 'w03_doors.js', 240, false],
    ['shelter', 'w04_shelter.js', 180, false],
    ['night', 'w05_night.js', 300, false],
    ['protected_house', 'w06_protected_house.js', 240, false],
    ['scan', 'w07_scan.js', 180, false],
    ['farm', 'w08_farm.js', 150, false],
    ['creeper', 'w09_creeper.js', 240, true],
    ['sleep', 'w10_sleep.js', 200, false],
    ['eat', 'w11_eat.js', 180, false],
    ['rules', 'w12_rules.js', 200, false],
    ['cost', 'w13_cost.js', 200, false],
    ['creeper_standing', 'w14_creeper_standing.js', 240, false], // NoAI: the creeper does not move (F3)
    // v0.1.4.7: the work skills
    ['storage', 'w15_storage.js', 300, false],
    ['harvest', 'w16_harvest.js', 300, false],
    ['plant', 'w17_plant.js', 420, false],
    ['bone_meal', 'w18_bone_meal.js', 300, false],
    ['farm_cycle', 'w19_farm_cycle.js', 360, false],
    ['farm_old_command', 'w20_farm_old_command.js', 780, false],
    ['trees', 'w21_trees.js', 420, false],
    ['tall_tree', 'w22_tall_tree.js', 420, false],
    ['tools', 'w23_tools.js', 480, false],
    ['flags_off_0147', 'w29_flags_off_0147.js', 300, false],
    // v0.1.4.8 "Stability": one defect of the play test of v0.1.4.7 per scenario, the modes of the owner on
    ['stuck_gives_up', 'w31_stuck_gives_up.js', 660, false],
    ['skill_stands_still', 'w32_skill_stands_still.js', 900, false],
    ['stop_is_hard', 'w34_stop_is_hard.js', 300, false],
    ['offhand_food', 'w41_offhand_food.js', 300, false],
    ['reflex_switch', 'w55_reflex_switch.js', 240, false],
    ['flags_off_0148', 'w57_flags_off_0148.js', 480, false],
    ['hole_escape', 'w37_hole_escape.js', 360, false],
    ['order_after_stuck', 'w38_order_after_stuck.js', 480, false],
    ['chat_burst', 'w40_chat_burst.js', 300, false],
    // the mining scenarios run in the deep world, with a server of their own
    ['mine_basics', 'w24_mine_basics.js', 600, false, 'deep'],
    ['shaft', 'w25_shaft.js', 900, false, 'deep'],
    ['tunnel', 'w26_tunnel.js', 600, false, 'deep'],
    ['mining_trip', 'w27_mining_trip.js', 900, false, 'deep'],
    ['mine_house', 'w28_mine_house.js', 600, false, 'deep'],
    // v0.1.4.8: the world `base`, a base like the owner's (base_world.js), with a server of its own
    ['base_world', 'w58_base_world.js', 300, false, 'base'],
    ['stopped_command_reports', 'w33_stopped_command.js', 480, false, 'base'],
    ['resume_ends', 'w35_resume_ends.js', 360, false, 'base'],
    ['hunger_reflex', 'w42_hunger_reflex.js', 420, false, 'base'],
    ['fence_is_safe', 'w43_fence_is_safe.js', 420, false, 'base'],
    ['pick_up_dropped', 'w44_pick_up_dropped.js', 300, false, 'base'],
    ['shaft_is_underground', 'w45_shaft_underground.js', 300, false, 'base'],
    ['creeper_above', 'w46_creeper_above.js', 300, false, 'base'],
    ['creeper_in_sight', 'w47_creeper_in_sight.js', 300, true, 'base'],
    ['shelter_is_home', 'w48_shelter_is_home.js', 360, false, 'base'],
    ['doors_after_reflex', 'w49_doors_after_reflex.js', 360, false, 'base'],
    ['auto_home', 'w50_auto_home.js', 300, false, 'base'],
    ['chest_at_fence', 'w51_chest_at_fence.js', 300, false, 'base'],
    ['farm_cycle_whole', 'w52_farm_cycle_whole.js', 900, false, 'base'],
    ['trees_with_axe', 'w53_trees_with_axe.js', 600, false, 'base'],
    ['mine_asks', 'w54_mine_asks.js', 300, false, 'base'],
    ['farm_scan', 'w56_farm_scan.js', 300, false, 'base'],
    // v0.1.4.8 fix round: the corrections X1 to X15 that had no scenario
    ['composter_never', 'w36_composter_never.js', 900, false, 'base'],
    ['wake_for_order', 'w39_wake_for_order.js', 360, false, 'base'],
    // v0.1.4.9 "The mine, the routes of the player": the trail, the routes, the mine of the player (spec 11 TW)
    ['trail_records', 'w61_trail_records.js', 240, false, 'base'],
    ['route_to_bed', 'w62_route_to_bed.js', 480, false, 'base'],
    ['route_reverse', 'w63_route_reverse.js', 420, false, 'base'],
    ['route_broken', 'w64_route_broken.js', 420, false, 'base'],
    ['remember_mine', 'w65_remember_mine.js', 420, false, 'base'],
    ['remember_tunnel', 'w66_remember_tunnel.js', 420, false, 'base'],
    ['mine_known', 'w67_mine_known.js', 900, false, 'base'],
    ['passed_ore', 'w68_passed_ore.js', 1200, false, 'base'],
    ['ore_sense', 'w69_ore_sense.js', 1200, false, 'base'],
    ['ore_in_sight', 'w70_ore_in_sight.js', 300, false, 'base'],
    ['dusk_on_route', 'w71_dusk_on_route.js', 480, false, 'base'],
    ['dig_code_refused', 'w72_dig_code_refused.js', 300, false, 'base'],
    ['branches', 'w73_branches.js', 900, false, 'base'],
    ['flags_off_0149', 'w74_flags_off_0149.js', 480, false, 'base'],
    ['follow_ladder', 'w75_follow_ladder.js', 480, false, 'base'], // v0.1.4.9 section 13: the follow down a ladder (F14)
    ['long_run', 'w60_long_run.js', 2700, false, 'base'],
    // the journeys (tester T3): the owner's first minutes with the bot in the owner variant of the base, from the
    // player's side; the bot is never moved by the control
    ['owner_base', 'w59_owner_base.js', 300, false, 'base'],
    ['first_minutes', 'w80_first_minutes.js', 600, false, 'base'],
    ['first_mine', 'w81_first_mine.js', 900, false, 'base'],
    ['come_here_floors', 'w82_come_here_across_floors.js', 600, false, 'base'],
    ['chest_and_torches', 'w83_chest_and_torches.js', 300, false, 'base'],
    ['ten_minutes', 'w84_ten_minutes.js', 1500, false, 'base'],
    // v0.1.4.10 "Goals" (tester T3): the job, the blocker, the standing list, the ladders, the pen gate, the floors
    ['job_comes_back', 'w85_job_comes_back.js', 1500, false, 'base'],
    ['blocker_steps', 'w86_blocker_steps.js', 1800, false, 'base'],
    ['idle_list', 'w87_idle_list.js', 1080, false, 'base'],
    ['ladders_native', 'w88_ladders_native.js', 1500, false, 'base'],
    ['pen_gate_safe', 'w89_pen_gate_safe.js', 600, false, 'base'],
    ['two_floors', 'w90_two_floors.js', 900, false, 'base'],
    // v0.1.4.11 "Navigation and words" (tester T3): the tunnel, the shaft, the sky, the places, the routes, the dry scan,
    // "come here" without digging, the words
    ['tunnel_where_you_stand', 'w91_tunnel_where_you_stand.js', 1200, false, 'base'],
    ['shaft_from_room', 'w92_shaft_from_room.js', 2700, false, 'base'],
    ['open_sky', 'w93_open_sky.js', 900, false, 'base'],
    ['place_from_sentence', 'w94_place_from_sentence.js', 900, false, 'base'],
    ['route_joined', 'w95_route_joined.js', 1500, false, 'base'],
    ['dry_scan', 'w96_dry_scan.js', 1200, false, 'base'],
    ['no_digging_to_player', 'w97_no_digging_to_player.js', 600, false, 'base'],
    ['words', 'w98_words.js', 1500, false, 'base'],
    // the owner's region from his dump (MCW_OWNER_DUMP): his staircase (F24) and his basement as a shelter (F25)
    ['owner_region', 'w99_owner_region.js', 2400, false, 'base'],
    // v0.1.4.12 "Understanding and watching" (tester T3): the watch server, its events, learning by watching (the teacher),
    // the iron pickaxe, the scans underground, the first second and the bed, two bots
    ['watch_server', 'w100_watch_server.js', 600, false, 'base'],
    ['watch_events', 'w101_watch_events.js', 600, false, 'base'],
    ['watch_line', 'w102_watch_line.js', 600, false, 'base'],
    ['watch_fence', 'w103_watch_fence.js', 900, false, 'base'],
    ['watch_tunnel', 'w104_watch_tunnel.js', 900, false, 'base'],
    ['iron_pickaxe', 'w105_iron_pickaxe.js', 1500, false, 'base'],
    ['scan_underground', 'w106_scan_underground.js', 1500, false, 'base'],
    ['spawn_and_bed', 'w107_spawn_and_bed.js', 600, false, 'base'],
    ['two_bots', 'w108_two_bots.js', 600, false, 'base'],
    // v0.1.4.13 "Supervision" (tester T3): the scripted supervisor, the names of two bots, the supervisor in the chat,
    // the corrections of the play of 2026-10-04, the shared memory; each under 6 minutes
    ['supervised_mining', 'w109_supervised_mining.js', 350, false, 'base'],
    ['two_bots_names', 'w110_two_bots_names.js', 300, false, 'base'],
    ['supervisor_chat', 'w111_supervisor_chat.js', 340, false, 'base'],
    ['bread_beside_tunnel', 'w112_bread_beside_tunnel.js', 350, false, 'base'],
    ['furnace_in_bag', 'w113_furnace_in_bag.js', 300, false, 'base'],
    ['worn_pickaxe', 'w114_worn_pickaxe.js', 350, false, 'base'],
    ['shaft_and_drops', 'w115_shaft_and_drops.js', 300, false, 'base'],
    ['unsaved_pen', 'w116_unsaved_pen.js', 330, false, 'base'],
    ['shared_mine', 'w117_shared_mine.js', 350, false, 'base'],
    ['full_bag', 'w118_full_bag.js', 350, false, 'base'],
];

// Words that select a group of scenarios (spec v0.1.4.8, W30: the work scenarios of v0.1.4.7, which run
// with the modes of the owner since v0.1.4.8).
// v0.1.4.9: mine_routes_0149, the scenarios W61 to W74 of the routes and the mine of the player.
const GROUPS = {
    all_modes_on: ['storage', 'harvest', 'plant', 'bone_meal', 'farm_cycle', 'farm_old_command', 'trees', 'tall_tree', 'tools',
        'mine_basics', 'shaft', 'tunnel', 'mining_trip', 'mine_house'],
    mine_routes_0149: ['trail_records', 'route_to_bed', 'route_reverse', 'route_broken', 'remember_mine', 'remember_tunnel', 'mine_known',
        'passed_ore', 'ore_sense', 'ore_in_sight', 'dusk_on_route', 'dig_code_refused', 'branches', 'flags_off_0149', 'follow_ladder'],
    // the journey scenarios W80 to W84 and their base W59 (README, "Journey scenarios")
    journeys: [
        'owner_base', 'first_minutes', 'first_mine', 'come_here_floors', 'chest_and_torches', 'ten_minutes',
        'job_comes_back', 'blocker_steps', 'idle_list', 'ladders_native', 'pen_gate_safe', 'two_floors',
        'tunnel_where_you_stand', 'shaft_from_room', 'open_sky', 'place_from_sentence', 'route_joined', 'dry_scan',
        'no_digging_to_player', 'words', 'owner_region',
        'watch_server', 'watch_events', 'watch_line', 'watch_fence', 'watch_tunnel', 'iron_pickaxe', 'scan_underground', 'spawn_and_bed',
        'two_bots',
    ],
    // v0.1.4.13 "Supervision": the journeys W109 to W118 (README, "Journeys of v0.1.4.13")
    journeys13: [
        'supervised_mining', 'two_bots_names', 'supervisor_chat', 'bread_beside_tunnel', 'furnace_in_bag', 'worn_pickaxe',
        'shaft_and_drops', 'unsaved_pen', 'shared_mine', 'full_bag',
    ],
};

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const showServer = args.includes('--server-log');
const words = args.filter((a) => !a.startsWith('-'));
const selected = SCENARIOS.filter(([name]) => words.length === 0
    || words.some((w) => (GROUPS[w] ? GROUPS[w].includes(name) : name.includes(w))));
const logDir = process.env.MCW_LOG_DIR ? path.resolve(process.env.MCW_LOG_DIR) : null;
const profile = (process.env.MCW_PROFILE || '').trim();

const loc = locateServer();
if (loc.missing) {
    console.log('World tests skipped: no test server found.');
    console.log(`  (missing: ${loc.missing}; set MC_TEST_SERVER_DIR and MC_TEST_JAVA)`);
    process.exit(0);
}

// ------------------------------------------------------------------ hygiene snapshots

function listTree(dir, skipTop = []) {
    const out = [];
    const walk = (d, rel) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (!rel && skipTop.includes(e.name)) continue;
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full, r);
            else {
                let st = null;
                try { st = fs.statSync(full); } catch { /* gone */ }
                out.push(`${r}|${st ? st.size : '?'}|${st ? st.mtimeMs : '?'}`);
            }
        }
    };
    walk(dir, '');
    return out.sort();
}

const repoBots = () => { try { return fs.readdirSync(path.join(ROOT, 'bots')).sort().join(','); } catch { return '(missing)'; } };
const leftoverTemps = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(TMP_PREFIX));

const botsBefore = repoBots();
const serverFolderBefore = listTree(loc.serverDir, ['logs']);
const tempsBefore = new Set(leftoverTemps());

// ------------------------------------------------------------------ the server

const runDir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX + 'run-'));
const servers = []; // every server this run started, one per world type
let server = null; // the server of the world type that runs now
let port = null;

// Creates the server of a world type in its own folder of the run directory (not started yet).
async function makeServer(type) {
    port = await findFreePort();
    if (port === OWNER_PORT) throw new Error('refusing the port of the owner');
    const s = new McServer({ ...loc, dir: path.join(runDir, 'server-' + type), port, echo: null });
    s.worldType = type;
    s.prepare(worldProperties(type));
    servers.push(s);
    return s;
}

let exiting = false;
process.on('exit', () => { for (const s of servers) if (s.pid && s.running) killPid(s.pid); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.on(sig, () => {
        if (exiting) return;
        exiting = true;
        console.log(`\n${sig}: stopping the server and the scenario`);
        for (const c of children) killPid(c.pid);
        for (const s of servers) if (s.pid) killPid(s.pid);
        try { fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* reported below */ }
        process.exit(130);
    });
}

const children = new Set();
const token = crypto.randomBytes(16).toString('hex');

// ------------------------------------------------------------------ the control service

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', (c) => { data += c; if (data.length > 5e6) reject(new Error('body too large')); });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

const control = http.createServer(async (req, res) => {
    const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
    };
    try {
        if (req.headers['x-mcw-token'] !== token) return send(403, { ok: false, error: 'bad token' });
        const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
        if (!server) return send(200, { ok: false, error: 'no server is running' });
        if (req.url === '/commands') {
            const out = await server.commands(body.commands || [], body.ms || 30000);
            return send(200, { ok: true, out });
        }
        if (req.url === '/log') {
            const from = Number(body.from) || 0;
            return send(200, { ok: true, lines: server.lines.slice(from).map((l) => l.text), next: server.lines.length });
        }
        if (req.url === '/wait') {
            const re = new RegExp(body.re, body.flags || '');
            const line = await server.waitLine(re, body.ms || 10000, Number(body.from) || 0);
            return send(200, { ok: true, line: line.text, n: line.n });
        }
        return send(404, { ok: false, error: 'unknown path ' + req.url });
    } catch (e) {
        return send(200, { ok: false, error: String(e && e.message || e) });
    }
});
await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve));
const controlUrl = `http://127.0.0.1:${control.address().port}`;

// ------------------------------------------------------------------ world defaults

// The world state every scenario starts from; a scenario changes what it needs in its region.
const WORLD_DEFAULTS = [
    'gamerule doDaylightCycle false', 'gamerule doWeatherCycle false', 'weather clear',
    'gamerule doMobSpawning false', 'gamerule doInsomnia false', 'gamerule doPatrolSpawning false',
    'gamerule doTraderSpawning false', 'gamerule randomTickSpeed 0', 'gamerule announceAdvancements false',
    'gamerule doImmediateRespawn true', 'gamerule playersSleepingPercentage 100',
    'gamerule doFireTick false', 'gamerule mobGriefing true',
    'difficulty peaceful', 'time set 6000',
];

async function findGround() {
    // the lowest y at 0,0 where the block is air and the block below is not air (the spawn chunk)
    const ys = [];
    for (let y = -64; y <= 100; y++) ys.push(y);
    const out = (await server.commands(['forceload add 0 0', ...ys.map((y) => `execute if block 0 ${y} 0 minecraft:air`), 'forceload remove 0 0'])).slice(1, -1);
    for (let i = 1; i < ys.length; i++) {
        if (out[i].some((l) => l.startsWith('Test passed')) && out[i - 1].some((l) => l.startsWith('Test failed'))) return ys[i] - 1;
    }
    throw new Error('could not find the ground at 0,0');
}

// Proves the layers of the world type at the column 0,0: the lowest and the highest block of each
// layer, y 0 deep in the stone of the deep world, and air above the ground. The server falls back
// to the default flat world without an error when it cannot read `generator-settings`, so a deep
// world is never assumed. Returns { ok, lines, ground }.
async function verifyWorld(type) {
    const { probes, ground } = worldProbes(type);
    const out = (await server.commands(['forceload add 0 0', ...probes.map((p) => `execute if block 0 ${p.y} 0 ${p.block}`), 'forceload remove 0 0'])).slice(1, -1);
    const lines = probes.map((p, i) => `${out[i].some((l) => l.startsWith('Test passed')) ? 'ok' : 'WRONG'} y ${p.y} ${p.block.replace('minecraft:', '')}`);
    return { ok: lines.every((l) => l.startsWith('ok')), lines, ground };
}

// ------------------------------------------------------------------ scenarios

function makeScenarioDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX + 'scn-'));
    fs.mkdirSync(path.join(dir, 'bots'));
    for (const f of ['execTemplate.js', 'lintTemplate.js']) {
        fs.copyFileSync(path.join(ROOT, 'bots', f), path.join(dir, 'bots', f));
    }
    fs.writeFileSync(path.join(dir, 'eslint.config.mjs'),
        `export { default } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'eslint.config.js')).href)};\n`);
    return dir;
}

let regionIndex = 0;
let groundY = null;

// The node flags of MCW_PROFILE (part K of v0.1.4.13), none without it.
function profileArgs() {
    if (!profile) return [];
    const dir = path.join(logDir ?? runDir, 'profile');
    fs.mkdirSync(dir, { recursive: true });
    if (profile === 'heap') return ['--heap-prof', `--heap-prof-dir=${dir}`];
    const args = ['--cpu-prof', `--cpu-prof-dir=${dir}`];
    if (profile === '1') args.push('--heapsnapshot-near-heap-limit=1', `--diagnostic-dir=${dir}`);
    return args;
}

function runScenarioOnce(name, file, timeoutS, run) {
    return new Promise((resolve) => {
        const tmp = makeScenarioDir();
        const region = regionIndex++;
        const ox = 400 + region * 200;
        const oz = 0;
        const t0 = Date.now();
        const lines = [];
        const serverFrom = server.lines.length;
        const child = spawn(process.execPath, [...profileArgs(), path.join(WORLD_DIR, file)], {
            cwd: tmp,
            env: {
                ...process.env,
                ANTHROPIC_API_KEY: 'placeholder-not-a-key',
                MCW_CONTROL: controlUrl, MCW_TOKEN: token, MCW_SERVER_PORT: String(port),
                MCW_REGION_X: String(ox), MCW_REGION_Z: String(oz), MCW_GROUND_Y: String(groundY),
                MCW_RUN: String(run), MCW_REGION: String(region), MCW_TMP: tmp, MCW_WORLD: server.worldType,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        children.add(child);
        const onLine = (line) => {
            lines.push(line);
            if (verbose) console.log(`  | ${line}`);
        };
        readline.createInterface({ input: child.stdout }).on('line', onLine);
        readline.createInterface({ input: child.stderr }).on('line', (l) => onLine('[stderr] ' + l));
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; killPid(child.pid); }, timeoutS * 1000);
        child.on('exit', async (code, signal) => {
            clearTimeout(timer);
            children.delete(child);
            await new Promise((r) => setTimeout(r, 150));
            // the scenario cleans its region; this is the safety net for a scenario that died
            let cleanup = [];
            try {
                cleanup = await server.commands([
                    `kill @e[type=!minecraft:player,x=${ox - 120},y=-64,z=${oz - 120},dx=240,dy=400,dz=240]`,
                    `forceload remove ${ox - 120} ${oz - 120} ${ox + 120} ${oz + 120}`,
                    // v0.1.4.8: the copies of snapshots lie 100 to 300 blocks south of the region (world.js)
                    `forceload remove ${ox - 120} ${oz + 121} ${ox + 120} ${oz + 330}`,
                    ...WORLD_DEFAULTS,
                ]);
            } catch (e) { lines.push('runner cleanup error: ' + e.message); }
            const serverLines = server.lines.slice(serverFrom).map((l) => l.raw);
            const ms = Date.now() - t0;
            let removed = false;
            try {
                fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
                removed = !fs.existsSync(tmp);
            } catch (e) { lines.push('temp dir cleanup error: ' + e.message); }
            const killedMobs = (cleanup[0] || []).join(' ');
            resolve({ name, run, code, signal, timedOut, ms, lines, serverLines, removed, tmp, region, ox, oz, killedMobs });
        });
    });
}

// A line of a scenario, or of one of its phases ("  [phase] "); with log_timestamps on (v0.1.4.8, the long
// run) the console of the agent puts "[HH:MM:SS] " before it.
const LINE_HEAD = String.raw`^(\[\d\d:\d\d:\d\d\] )?(\s*\[\w+\] )?`;
const CHECK_FAIL = new RegExp(LINE_HEAD + 'CHECK FAIL ');
const CHECK_OR_NOTE = new RegExp(LINE_HEAD + '(CHECK|NOTE) ');

function judge(r, timeoutS) {
    const failedChecks = r.lines.filter((l) => CHECK_FAIL.test(l));
    const pass = !r.timedOut && r.code === 0 && failedChecks.length === 0 && r.removed;
    let reason = '';
    if (r.timedOut) reason = `timeout after ${timeoutS} s, process killed`;
    else if (!r.removed) reason = `temp directory ${r.tmp} could not be removed`;
    else if (failedChecks.length) reason = failedChecks.map((l) => l.trim()).join('\n    ');
    else if (r.code !== 0) reason = `exit code ${r.code} ${r.signal || ''}`;
    return { pass, reason, failedChecks };
}

function report(r, timeoutS, label) {
    const j = judge(r, timeoutS);
    const checkLines = r.lines.filter((l) => CHECK_OR_NOTE.test(l));
    if (!verbose) for (const l of checkLines) console.log(`    ${l}`);
    if (!j.pass && !verbose) {
        console.log('    --- last output lines of the scenario ---');
        for (const l of r.lines.slice(-40)) console.log(`    | ${l}`);
    }
    if (showServer || !j.pass) {
        const interesting = r.serverLines.filter((l) => !/mcw_mark_\d+<--\[HERE\]|Unknown or incomplete command|^\S+ \S+ Test (passed|failed)|has the following entity data|Changed the block|Successfully filled|Test passed|Test failed/.test(l));
        console.log(`    --- server lines of this run (${interesting.length} of ${r.serverLines.length}, command answers left out) ---`);
        for (const l of interesting.slice(-40)) console.log(`    S ${l}`);
    }
    if (logDir) {
        fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(path.join(logDir, `${r.name}_run${r.run}.log`), r.lines.join('\n') + '\n');
        fs.writeFileSync(path.join(logDir, `${r.name}_run${r.run}_server.log`), r.serverLines.join('\n') + '\n');
    }
    console.log(`${j.pass ? 'PASS' : 'FAIL'} ${label} (${(r.ms / 1000).toFixed(1)} s, ${server.worldType} world, region x=${r.ox})${j.pass ? '' : '\n    reason: ' + j.reason}`);
    return j.pass;
}

// ------------------------------------------------------------------ main

const tStart = Date.now();
const outcomes = [];
let hygieneProblems = [];
console.log(`world tests v0.1.4.9: node ${process.version}, repository ${ROOT}, ${selected.length} scenario(s)`);
console.log(`server ${loc.jar}\njava ${loc.java}`);

async function runScenario([name, file, timeoutS, monsters]) {
    if (!monsters) {
        const r = await runScenarioOnce(name, file, timeoutS, 1);
        const pass = report(r, timeoutS, name);
        outcomes.push({ name, pass, ms: r.ms, runs: [pass] });
        return;
    }
    const runs = [];
    let totalMs = 0;
    for (let run = 1; run <= 3; run++) {
        const r = await runScenarioOnce(name, file, timeoutS, run);
        totalMs += r.ms;
        runs.push(report(r, timeoutS, `${name} run ${run}`));
        const passes = runs.filter(Boolean).length;
        const fails = runs.length - passes;
        if (passes >= 2 || fails >= 2) break;
    }
    const pass = runs.filter(Boolean).length >= 2;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${runs.filter(Boolean).length} of ${runs.length} runs passed (${runs.map((p) => (p ? 'pass' : 'fail')).join(', ')})`);
    outcomes.push({ name, pass, ms: totalMs, runs });
}

// Runs the scenarios of one world type with a server of their own.
async function runWorld(type, list) {
    server = await makeServer(type);
    try {
        await server.start();
        console.log(`${type} world: server ready on 127.0.0.1:${port} after ${(server.startMs / 1000).toFixed(1)} s (pid ${server.pid})`);
        await server.commands(WORLD_DEFAULTS);
        const layers = await verifyWorld(type);
        console.log(`${type} world: layers at 0,0: ${layers.lines.join(', ')}`);
        if (!layers.ok) throw new Error(`the ${type} world does not have its layers: the server did not accept generator-settings`);
        groundY = await findGround();
        if (groundY !== layers.ground) throw new Error(`the ground of the ${type} world is at y ${groundY}, expected ${layers.ground}`);
        console.log(`${type} world: the top block is at y ${groundY}, a bot stands at y ${groundY + 1}`);
        for (const s of list) await runScenario(s);
    } catch (e) {
        console.log(`RUNNER ERROR (${type} world) ` + (e && e.stack || e));
        hygieneProblems.push(`runner error (${type} world): ` + (e && e.message));
        const tail = server.lines.slice(-30).map((l) => l.raw);
        for (const l of tail) console.log(`    S ${l}`);
    } finally {
        for (const c of children) killPid(c.pid);
        const st = await server.stop(20000);
        console.log(`${type} world: server stopped: ${st.killed ? 'KILLED after 20 s' : 'with "stop"'}, exit ${JSON.stringify(st.exit)}`);
        if (st.killed) hygieneProblems.push(`the server of the ${type} world did not stop within 20 s and was killed`);
        if (logDir) {
            try { fs.copyFileSync(path.join(server.dir, 'logs', 'latest.log'), path.join(logDir, `server_latest_${type}.log`)); } catch { /* none */ }
        }
        if (pidAlive(server.pid)) {
            killPid(server.pid);
            hygieneProblems.push(`server process ${server.pid} (${type} world) was still alive after the stop and was killed`);
        }
    }
}

try {
    for (const type of WORLD_TYPES) {
        const list = selected.filter((s) => (s[4] || 'flat') === type);
        if (list.length) await runWorld(type, list);
    }
} finally {
    for (const c of children) killPid(c.pid);
    await new Promise((resolve) => control.close(resolve));
    try { fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch (e) { hygieneProblems.push('run dir: ' + e.message); }
}

// ------------------------------------------------------------------ hygiene

for (const s of servers) if (pidAlive(s.pid)) hygieneProblems.push(`server process ${s.pid} (${s.worldType} world) is alive`);
const newTemps = leftoverTemps().filter((n) => !tempsBefore.has(n));
if (newTemps.length) hygieneProblems.push(`temp directories left: ${newTemps.join(', ')}`);
const botsAfter = repoBots();
if (botsAfter !== botsBefore) hygieneProblems.push(`repository bots/ changed: before [${botsBefore}] after [${botsAfter}]`);
const serverFolderAfter = listTree(loc.serverDir, ['logs']);
if (JSON.stringify(serverFolderAfter) !== JSON.stringify(serverFolderBefore)) {
    const added = serverFolderAfter.filter((x) => !serverFolderBefore.includes(x));
    const gone = serverFolderBefore.filter((x) => !serverFolderAfter.includes(x));
    hygieneProblems.push(`the server folder changed: new or changed ${JSON.stringify(added.slice(0, 5))}, gone ${JSON.stringify(gone.slice(0, 5))}`);
}
for (const p of hygieneProblems) console.log(`FAIL hygiene: ${p}`);
if (!hygieneProblems.length) console.log(`hygiene: no server process left (pid ${servers.map((s) => s.pid).join(', ')} ended), no ${TMP_PREFIX}* temp directory left, repository bots/ unchanged, server folder unchanged (logs not compared)`);

const failed = outcomes.filter((o) => !o.pass);
const total = ((Date.now() - tStart) / 1000).toFixed(1);
console.log('RESULTS');
for (const o of outcomes) console.log(`  ${o.pass ? 'PASS' : 'FAIL'} ${o.name.padEnd(16)} ${(o.ms / 1000).toFixed(1).padStart(6)} s${o.runs.length > 1 ? `  runs: ${o.runs.map((p) => (p ? 'pass' : 'fail')).join(', ')}` : ''}`);
console.log(`SUMMARY ${outcomes.length - failed.length} passed, ${failed.length} failed` +
    `${failed.length ? ' (' + failed.map((f) => f.name).join(', ') + ')' : ''} in ${total} s`);
process.exitCode = failed.length === 0 && hygieneProblems.length === 0 && outcomes.length === selected.length ? 0 : 1;
